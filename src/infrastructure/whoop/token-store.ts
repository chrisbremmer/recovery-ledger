// Load-bearing token-store module — ADR-0002 three-layer single-flight gate.
//
// ADR-0002 §Decision: every refresh path goes through (1) in-process
// `Promise<Tokens> | null` single-flight, (2) cross-process advisory lock via
// `proper-lockfile`, (3) atomic temp-and-rename write. There is no second
// refresh path — this module is the sole consumer of WHOOP_TOKEN_URL across
// `src/` (CI grep Gate E enforces).
//
// ADR-0001 §Decision: no console calls, no direct stdout writes from this
// module — all output goes through the Pino logger bound to fd 2. Log lines
// emit only structured fields (event names, status codes); token material is
// never inlined into log strings (Pitfall C defense-in-depth).
//
// ADR-0007: read-only with respect to WHOOP — this module only ever issues
// POST requests to the token endpoint to refresh credentials WHOOP itself
// issued. No write paths to any non-OAuth WHOOP resource live here.
//
// Backend split (D-04/D-05): keyring is primary (`@napi-rs/keyring`), file is
// fallback. Selection happens at first write and is cached in the
// `storage-mode` marker file (Pitfall E mitigation — no mid-session flipping).
// `Entry.setPassword` succeeding + `getPassword` returning a mismatched blob
// is Pitfall F: cheap defense-in-depth that we own; ADR-0002 doesn't mandate
// it but the cost is one extra read per refresh and a few extra LOC.

import { mkdir, open, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { Entry } from '@napi-rs/keyring';
import * as lockfile from 'proper-lockfile';
import { z } from 'zod';
import { logger } from '../config/logger.js';
import { paths as defaultPaths, type ResolvedPaths } from '../config/paths.js';
import { AuthError } from './errors.js';

// -----------------------------------------------------------------------------
// Constants — exported so callers can re-use the same buffer (Plan 02-04 and
// Plan 02-06 both check the same window) and the test suite can pin the URL.
// -----------------------------------------------------------------------------

/** D-14: refresh trigger fires when the access token is within 5 minutes of
 *  expiry. The buffer absorbs typical NTP skew (sub-100ms) and gives the
 *  refresh request time to complete before any caller would see a 401. */
export const REFRESH_BUFFER_MS = 5 * 60 * 1000;

/** Cap on a single token-endpoint POST. A stalled WHOOP token endpoint
 *  would otherwise hold the in-process single-flight `inFlightRefresh`
 *  promise indefinitely, blocking every concurrent WHOOP call until OS TCP
 *  timeout. Mirrors `HTTP_REQUEST_TIMEOUT_MS` in `client.ts` for the API
 *  fetch path. */
export const TOKEN_REQUEST_TIMEOUT_MS = 30_000;

/** `proper-lockfile` stale-lock threshold (#31). The lock-holding process
 *  is inside the WHOOP token-endpoint POST; if it exceeds this window the
 *  lock is reclaimable as stale by a sibling, which could then POST the
 *  same refresh_token and prompt WHOOP to revoke the token family. The
 *  ceiling is set safely above `TOKEN_REQUEST_TIMEOUT_MS` (30s) so the
 *  in-process POST timeout fires first and releases the lock cleanly;
 *  60s only matters when a process actually crashes mid-refresh, in
 *  which case the sibling waits 60s before reclaiming — the safer
 *  failure mode than burning the refresh family. */
export const STALE_LOCK_MS = 60_000;

/** WHOOP token-endpoint URL. Read once at module load from
 *  `process.env.WHOOP_TOKEN_URL` (the test-only override used by Plan 02-08's
 *  cross-process integration test); production never sets the env var. */
export const WHOOP_TOKEN_URL =
  process.env.WHOOP_TOKEN_URL ?? 'https://api.prod.whoop.com/oauth/oauth2/token';

const KEYRING_SERVICE = 'recovery-ledger';
const KEYRING_ACCOUNT = 'whoop';

// -----------------------------------------------------------------------------
// Types — the public surface Plans 03/04/05/06 consume.
// -----------------------------------------------------------------------------

export interface Tokens {
  accessToken: string;
  refreshToken: string;
  tokenType: 'bearer';
  scope: string;
  /** Wall-clock ms when the token was obtained (Date.now() captured BEFORE
   *  the fetch — see Anti-Patterns in 02-RESEARCH.md line 524). */
  obtainedAt: number;
  /** Wall-clock ms when the token expires. Computed as
   *  `obtainedAt + expires_in * 1000`. */
  expiresAt: number;
}

export type StorageMode = 'keychain' | 'file';

export interface TokenStoreOptions {
  paths?: ResolvedPaths;
  now?: () => number;
  fetch?: typeof globalThis.fetch;
  /** When true, skip the keyring attempt entirely and go straight to file
   *  backend. Equivalent to `process.env.RECOVERY_LEDGER_FORCE_FILE_STORE=1`
   *  (D-25). Test seam — production callers never set this. */
  forceFileStore?: boolean;
  /** Optional override for the client credentials sent to the token endpoint.
   *  Default reads from `process.env.WHOOP_CLIENT_ID` / `WHOOP_CLIENT_SECRET`
   *  (Plan 02-05 wires the config-file path before this lookup happens). */
  clientCreds?: () => { clientId: string; clientSecret: string };
}

export interface TokenStore {
  getValidAccessToken(): Promise<string>;
  read(): Promise<Tokens | null>;
  write(t: Tokens): Promise<void>;
  clear(): Promise<void>;
  readStorageMode(): Promise<StorageMode | null>;
}

// -----------------------------------------------------------------------------
// Validation — Zod-parse the token-endpoint response at the boundary
// (conventions.md §Validation). `.passthrough()` per Pitfall J — accept new
// fields WHOOP may add without failing.
// -----------------------------------------------------------------------------

const TokenResponseSchema = z
  .object({
    access_token: z.string(),
    refresh_token: z.string(),
    expires_in: z.number().int().positive(),
    scope: z.string(),
    token_type: z.literal('bearer'),
  })
  .passthrough();

const StoredTokensSchema = z.object({
  accessToken: z.string(),
  refreshToken: z.string(),
  tokenType: z.literal('bearer'),
  scope: z.string(),
  obtainedAt: z.number().int().nonnegative(),
  expiresAt: z.number().int().nonnegative(),
});

// -----------------------------------------------------------------------------
// Factory + singleton — mirrors `src/infrastructure/config/logger.ts`. The
// production singleton binds module-load defaults; tests construct fresh
// instances via the factory so the in-process gate is per-instance.
// -----------------------------------------------------------------------------

export function createTokenStore(opts: TokenStoreOptions = {}): TokenStore {
  const resolvedPaths = opts.paths ?? defaultPaths;
  const now = opts.now ?? Date.now;
  const fetchFn = opts.fetch ?? globalThis.fetch;
  const forceFile =
    opts.forceFileStore === true || process.env.RECOVERY_LEDGER_FORCE_FILE_STORE === '1';
  const readClientCreds =
    opts.clientCreds ??
    (() => ({
      clientId: process.env.WHOOP_CLIENT_ID ?? '',
      clientSecret: process.env.WHOOP_CLIENT_SECRET ?? '',
    }));

  // GATE 1: in-process single-flight. Per-instance Promise — second caller
  // arrives, sees the in-flight Promise, awaits the same result. Cleared in
  // `.finally` so the next refresh cycle gets a fresh gate.
  let inFlightRefresh: Promise<Tokens> | null = null;

  // Storage-mode cache — populated on first read or write. Pitfall E: never
  // probe the backend twice in one session.
  let cachedMode: StorageMode | null = null;

  async function readStorageMode(): Promise<StorageMode | null> {
    if (cachedMode !== null) return cachedMode;
    try {
      const raw = (await readFile(resolvedPaths.storageModeFile, 'utf8')).trim();
      if (raw === 'keychain' || raw === 'file') {
        cachedMode = raw;
        return cachedMode;
      }
      return null;
    } catch (err) {
      if (isNotFound(err)) return null;
      throw err;
    }
  }

  async function read(): Promise<Tokens | null> {
    const mode = await readStorageMode();
    if (mode === null) return null;
    const raw = mode === 'keychain' ? readKeyringBlob() : await readFileBlob();
    if (raw === null) return null;
    try {
      const parsed = JSON.parse(raw) as unknown;
      return StoredTokensSchema.parse(parsed);
    } catch (err) {
      logger.warn({ event: 'tokens_parse_failed' });
      throw new AuthError({ kind: 'refresh_failed', cause: err });
    }
  }

  async function readFileBlob(): Promise<string | null> {
    try {
      return await readFile(resolvedPaths.tokensFile, 'utf8');
    } catch (err) {
      if (isNotFound(err)) return null;
      throw err;
    }
  }

  function readKeyringBlob(): string | null {
    try {
      const value = new Entry(KEYRING_SERVICE, KEYRING_ACCOUNT).getPassword();
      return value && value.length > 0 ? value : null;
    } catch {
      return null;
    }
  }

  // Public write — acquires the same cross-process lock that `doRefresh` uses,
  // so a CLI `auth` write cannot race a concurrent MCP-server refresh. The
  // refresh path uses `writeUnderLock` directly (the lock is already held by
  // its enclosing scope; re-entering would deadlock).
  //
  // WR-03: storage-mode file is the single source of truth for backend
  // selection. Before this fix, `runAuthCommand` called write() without
  // acquiring the lock — a parallel doRefresh on the keychain backend could
  // interleave its storage-mode write with the auth file-backend write and
  // leave the marker pointing at the wrong backend.
  async function write(tokens: Tokens): Promise<void> {
    // SECH-02 / #95: mode 0o700 parity with init.ts:102 so MCP-driven first-write
    // creates the config dir with the same permissions as CLI-driven init.
    await mkdir(resolvedPaths.configDir, { recursive: true, mode: 0o700 });
    await writeFile(resolvedPaths.tokensLockFile, '', { flag: 'a' });
    const release = await lockfile.lock(resolvedPaths.tokensLockFile, {
      retries: { retries: 10, factor: 1.2, minTimeout: 50 },
      stale: STALE_LOCK_MS,
    });
    try {
      await writeUnderLock(tokens);
    } finally {
      await release();
    }
  }

  // Internal write — no lock acquisition. Callers MUST hold the cross-process
  // advisory lock on `tokensLockFile` for the duration of this call (the
  // refresh path does; the public `write` wraps this in a lock acquisition).
  async function writeUnderLock(tokens: Tokens): Promise<void> {
    await mkdir(resolvedPaths.configDir, { recursive: true, mode: 0o700 });
    const blob = JSON.stringify(tokens);
    let mode: StorageMode = 'file';

    if (!forceFile) {
      // Try keyring first (D-04). On any thrown error OR Pitfall F mismatch,
      // fall back to file.
      try {
        const entry = new Entry(KEYRING_SERVICE, KEYRING_ACCOUNT);
        entry.setPassword(blob);
        // Pitfall F defense-in-depth: read back and verify byte-equal.
        const roundtrip = entry.getPassword();
        if (roundtrip === blob) {
          mode = 'keychain';
        } else {
          logger.warn({ event: 'keyring_roundtrip_mismatch' });
        }
      } catch {
        logger.warn({ event: 'keyring_setpassword_failed' });
      }
    }

    if (mode === 'file') {
      // WR-D: best-effort delete any prior keychain entry so a future
      // session that somehow reverts the storage-mode marker (manual edit
      // or a future bug) does not silently re-emerge with stale tokens.
      // Symmetry with clear(), which also best-effort-deletes the keychain
      // entry whenever the mode was 'keychain'. Skip when forceFile is
      // true (D-25 / RECOVERY_LEDGER_FORCE_FILE_STORE=1): the user
      // explicitly disabled the keyring, so we do not touch it at all.
      if (!forceFile) {
        try {
          new Entry(KEYRING_SERVICE, KEYRING_ACCOUNT).deletePassword();
        } catch {
          // best-effort — keychain may not be available, or no entry exists
        }
      }
      await writeFileAtomic(resolvedPaths.tokensFile, blob);
    }

    await writeFileAtomic(resolvedPaths.storageModeFile, `${mode}\n`);
    cachedMode = mode;
  }

  async function clear(): Promise<void> {
    const mode = await readStorageMode();
    if (mode === 'keychain') {
      try {
        new Entry(KEYRING_SERVICE, KEYRING_ACCOUNT).deletePassword();
      } catch {
        // best-effort
      }
    }
    await unlinkIfExists(resolvedPaths.tokensFile);
    await unlinkIfExists(resolvedPaths.storageModeFile);
    cachedMode = null;
  }

  async function getValidAccessToken(): Promise<string> {
    const current = await read();
    if (current !== null && current.expiresAt > now() + REFRESH_BUFFER_MS) {
      return current.accessToken;
    }
    // GATE 1: in-process single-flight gate.
    if (inFlightRefresh === null) {
      inFlightRefresh = doRefresh(current).finally(() => {
        inFlightRefresh = null;
      });
    }
    const refreshed = await inFlightRefresh;
    return refreshed.accessToken;
  }

  async function doRefresh(stale: Tokens | null): Promise<Tokens> {
    await mkdir(resolvedPaths.configDir, { recursive: true, mode: 0o700 });
    // proper-lockfile requires the lock target to exist before `.lock()`.
    await writeFile(resolvedPaths.tokensLockFile, '', { flag: 'a' });

    // GATE 2: cross-process advisory lock. Options per ADR-0002 §Decision:
    // retries 10, factor 1.2, minTimeout 50ms. `stale` is raised to
    // STALE_LOCK_MS (60s) so the lock cannot be reclaimed as stale while a
    // slow WHOOP token-endpoint POST is still in flight — issue #31. The
    // tradeoff (a crashed process holds the lock 60s instead of 5s) is
    // the cheaper failure mode: a crashed-mid-refresh sibling that re-POSTs
    // the same refresh_token would prompt WHOOP to revoke the whole token
    // family. The 60s ceiling stays well below the human attention span,
    // and `doctor` surfaces a stuck lock for manual recovery.
    const release = await lockfile.lock(resolvedPaths.tokensLockFile, {
      retries: { retries: 10, factor: 1.2, minTimeout: 50 },
      stale: STALE_LOCK_MS,
    });
    try {
      // Re-read after acquiring lock — a sibling process may have refreshed
      // while we were waiting. If so, we are done (RESEARCH lines 380-385).
      //
      // WR-02: read() can throw refresh_failed on parse/Zod failure (e.g., an
      // external tool dropped a malformed blob in place — `cat > tokens.json`,
      // an editor save, a backup-restore). That is NOT the same failure mode
      // as "WHOOP rejected the refresh request" and conflating them produces
      // a confusing remediation message ("token refresh failed" when the
      // actual problem is unrecoverable on-disk state). Catch read failures
      // here, log for diagnostic visibility, treat as null, and let the fall-
      // through use the pre-lock `stale` snapshot (which is still in memory
      // from this process's earlier successful read). If `stale` is also null,
      // callRefreshEndpoint will throw `auth_missing` ("re-run init") — the
      // correct remediation for an unrecoverable token-store state.
      let fresh: Tokens | null;
      try {
        fresh = await read();
      } catch (readErr) {
        logger.warn({
          event: 'tokens_reread_failed_inside_lock',
          error: readErr instanceof Error ? readErr.message : String(readErr),
        });
        fresh = null;
      }
      if (fresh !== null && fresh.expiresAt > now() + REFRESH_BUFFER_MS) {
        logger.debug({ event: 'refresh_skipped_sibling' });
        return fresh;
      }
      // Prefer the freshest on-disk refresh_token. `fresh` carries any
      // sibling's rotated refresh token (the sibling consumed `stale.refreshToken`
      // and replaced it on disk); `stale` is the pre-lock snapshot and is the
      // exact token WHOOP would reject as a token-family-revocation event per
      // ADR-0002 §Context. Falling back to `stale` only when `fresh` is null
      // (file vanished, storage-mode marker cleared, or the WR-02 parse-error
      // path swallowed a malformed on-disk blob).
      const next = await callRefreshEndpoint(fresh ?? stale);
      // GATE 3: atomic write. Call writeUnderLock — the cross-process lock is
      // already held by `doRefresh`'s outer scope; the public `write()` would
      // try to re-acquire the same lock and deadlock.
      try {
        await writeUnderLock(next);
      } catch (writeErr) {
        // ERRC-02 (#87): the rotated token landed in memory but persistence
        // failed (mkdir EACCES, EROFS, disk full, keyring setPassword threw,
        // atomic-rename error). WHOOP has already consumed the prior refresh
        // token, so leaving the OLD refreshToken on disk would burn the
        // family on the NEXT process start. Surface a loud typed
        // `refresh_failed` so the caller forces re-auth instead of silently
        // retrying with the stale on-disk token. ADR-0002 §Enforcement makes
        // this rule explicit: a refresh whose HTTP response succeeded but
        // whose write failed MUST force re-auth.
        //
        // The in-flight session can still use `next` from memory — that
        // window is intentional (the rotated access token works for ~1h),
        // but the caller can prefer the loud error if it'd rather re-auth
        // immediately. We throw here so the typed signal reaches the
        // refresh-orchestrator chokepoint unambiguously.
        throw new AuthError({
          kind: 'refresh_failed',
          detail: 'rotated tokens received but write failed — run `recovery-ledger auth`',
          cause: writeErr,
        });
      }
      return next;
    } finally {
      await release();
    }
  }

  async function callRefreshEndpoint(stale: Tokens | null): Promise<Tokens> {
    if (stale === null || stale.refreshToken.length === 0) {
      throw new AuthError({ kind: 'auth_missing', detail: 'no refresh token on disk' });
    }
    const creds = readClientCreds();
    // RFC 6749 §6: omit `scope` so the authorization server retains the
    // originally-granted scope set. Sending `scope: 'offline'` here would
    // silently NARROW the token to just the offline scope on every refresh,
    // dropping the seven read scopes the user granted at `init` time and
    // breaking every Phase 3 `read:*` API call with a 403. Mirrors
    // `exchangeCode` (oauth.ts) which also omits scope from its token-endpoint
    // POST body — scope belongs in the authorize URL, not the refresh body.
    const body = new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: stale.refreshToken,
      client_id: creds.clientId,
      client_secret: creds.clientSecret,
    });

    // Capture obtainedAt BEFORE the fetch so a slow network does not push
    // expiresAt past the actual token lifetime (Anti-Patterns line 524).
    const obtainedAt = now();
    // AbortController guard against a stalled token endpoint. Without this,
    // the in-process `inFlightRefresh` promise would hold indefinitely and
    // block every concurrent WHOOP call until OS TCP timeout.
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), TOKEN_REQUEST_TIMEOUT_MS);
    let res: Response;
    try {
      res = await fetchFn(WHOOP_TOKEN_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body,
        signal: controller.signal,
      });
    } catch (err) {
      if (controller.signal.aborted) {
        logger.warn({ event: 'refresh_timeout', timeoutMs: TOKEN_REQUEST_TIMEOUT_MS });
        throw new AuthError({
          kind: 'refresh_failed',
          detail: `token endpoint timeout after ${TOKEN_REQUEST_TIMEOUT_MS}ms`,
          cause: err,
        });
      }
      throw err;
    } finally {
      clearTimeout(timeoutId);
    }
    if (!res.ok) {
      // Status only — never inline body text (Pitfall C defense-in-depth;
      // the sanitizer covers the cause chain but we do not help leakers).
      logger.warn({ event: 'refresh_failed', status: res.status });
      throw new AuthError({
        kind: 'refresh_failed',
        detail: `token endpoint ${res.status}`,
      });
    }
    let parsed: z.infer<typeof TokenResponseSchema>;
    try {
      const json = (await res.json()) as unknown;
      parsed = TokenResponseSchema.parse(json);
    } catch (err) {
      logger.warn({ event: 'refresh_parse_failed' });
      throw new AuthError({ kind: 'refresh_failed', cause: err });
    }
    return {
      accessToken: parsed.access_token,
      refreshToken: parsed.refresh_token,
      tokenType: 'bearer',
      scope: parsed.scope,
      obtainedAt,
      expiresAt: obtainedAt + parsed.expires_in * 1000,
    };
  }

  return { getValidAccessToken, read, write, clear, readStorageMode };
}

// -----------------------------------------------------------------------------
// File helpers — RESEARCH Pattern 2 (atomic temp-and-rename with fsync). Same
// directory rename is critical (Pitfall D); fsync before rename guards
// against partial writes on crash.
// -----------------------------------------------------------------------------

async function writeFileAtomic(target: string, contents: string): Promise<void> {
  const tmp = `${target}.tmp`;
  // `open(..., 'w', 0o600)` forces mode 0600 on create (Pitfall D — `writeFile`
  // with `{mode}` only sets it on create, not if the file already exists from
  // a prior crashed write).
  const fd = await open(tmp, 'w', 0o600);
  try {
    await fd.writeFile(contents);
    await fd.sync();
  } finally {
    await fd.close();
  }
  await rename(tmp, target);
}

async function unlinkIfExists(p: string): Promise<void> {
  try {
    await unlink(p);
  } catch (err) {
    if (!isNotFound(err)) throw err;
  }
}

function isNotFound(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    (err as { code?: string }).code === 'ENOENT'
  );
}

// Production singleton — bound at module load to the default paths + global
// fetch. Plans 03/04/05/06 import this directly; tests construct their own
// via `createTokenStore({paths, now})`.
export const tokenStore: TokenStore = createTokenStore();
