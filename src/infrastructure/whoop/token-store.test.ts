// Unit coverage for the load-bearing token-store module (ADR-0002 three-layer
// single-flight gate + dual keyring/file backends + atomic temp-and-rename
// write).
//
// AUTH-05 unit half lives here (D-23.1, load-bearing per D-24):
//   "10 parallel callers to getValidAccessToken() with an expired token
//    produce exactly one POST to the WHOOP token endpoint, and all 10
//    callers receive the same access_token string."
// The cross-process integration half ships in Plan 02-08.
//
// Test harness shape (PATTERNS Reference §`src/cli/commands/doctor.test.ts`
// lines 64-87): per-test `vi.resetModules()` + `vi.doMock('@napi-rs/keyring')
// + vi.doMock('proper-lockfile')` + dynamic `await import('./token-store.js')`
// so each test exercises an isolated `createTokenStore` factory call —
// the module-level `inFlightRefresh` lives INSIDE `createTokenStore`, so
// each `createTokenStore()` invocation gives a fresh gate.
//
// MSW intercepts `fetch` for the WHOOP token endpoint (RESEARCH §Test-Mechanism
// Recipes lines 962-994); the shared `createWhoopOauthHelper()` from
// `tests/helpers/msw-whoop-oauth.ts` is the single source for the URL +
// per-call hit counter.

import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';
import {
  createWhoopOauthHelper,
  type WhoopOauthHelper,
} from '../../../tests/helpers/msw-whoop-oauth.js';
import { type ResolvedPaths, resolvePaths } from '../config/paths.js';

// -----------------------------------------------------------------------------
// Shared harness state. The MSW server is reused across the whole test file
// (per the helper's caller-owned-lifecycle contract); the hit counter is reset
// in `beforeEach`. Each test creates its own tmpdir + ResolvedPaths so writes
// land under an isolated tree.
// -----------------------------------------------------------------------------

let helper: WhoopOauthHelper;
let tmpDir: string;
let paths: ResolvedPaths;

beforeAll(() => {
  helper = createWhoopOauthHelper();
  helper.server.listen({ onUnhandledRequest: 'error' });
});

afterAll(() => {
  helper.server.close();
});

beforeEach(async () => {
  helper.resetRefreshHitCount();
  tmpDir = await mkdtemp(join(tmpdir(), 'rl-token-store-'));
  paths = resolvePaths({ RECOVERY_LEDGER_HOME: tmpDir });
});

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true });
  vi.resetModules();
  vi.doUnmock('@napi-rs/keyring');
  vi.doUnmock('proper-lockfile');
  delete process.env.RECOVERY_LEDGER_FORCE_FILE_STORE;
});

// -----------------------------------------------------------------------------
// Mock helpers. Each test installs `vi.doMock` for `@napi-rs/keyring` and
// `proper-lockfile` BEFORE the dynamic import of `./token-store.js`. The mocks
// return spy-able state via closures so individual tests can assert call
// counts and arguments.
// -----------------------------------------------------------------------------

interface KeyringMock {
  setPasswordSpy: ReturnType<typeof vi.fn>;
  getPasswordSpy: ReturnType<typeof vi.fn>;
  deletePasswordSpy: ReturnType<typeof vi.fn>;
  store: Map<string, string>;
}

interface KeyringMockOptions {
  setThrows?: boolean;
  /** Force getPassword to return a value different from what was written.
   *  Triggers Pitfall F (defense-in-depth: setPassword succeeds but the
   *  read-back blob mismatches) so the test can verify the fallback arm. */
  getMismatch?: boolean;
}

function installKeyringMock(opts: KeyringMockOptions = {}): KeyringMock {
  const store = new Map<string, string>();
  const setPasswordSpy = vi.fn((service: string, account: string, password: string) => {
    if (opts.setThrows) {
      throw new Error('synthetic keyring failure');
    }
    store.set(`${service}:${account}`, password);
  });
  const getPasswordSpy = vi.fn((service: string, account: string): string | null => {
    if (opts.getMismatch) {
      return 'mismatched-blob';
    }
    return store.get(`${service}:${account}`) ?? null;
  });
  const deletePasswordSpy = vi.fn((service: string, account: string): boolean => {
    return store.delete(`${service}:${account}`);
  });

  vi.doMock('@napi-rs/keyring', () => ({
    Entry: class {
      private service: string;
      private account: string;
      constructor(service: string, account: string) {
        this.service = service;
        this.account = account;
      }
      setPassword(password: string): void {
        setPasswordSpy(this.service, this.account, password);
      }
      getPassword(): string | null {
        return getPasswordSpy(this.service, this.account);
      }
      deletePassword(): boolean {
        return deletePasswordSpy(this.service, this.account);
      }
    },
  }));

  return { setPasswordSpy, getPasswordSpy, deletePasswordSpy, store };
}

interface LockfileMock {
  lockSpy: ReturnType<typeof vi.fn>;
  releaseSpy: ReturnType<typeof vi.fn>;
}

interface LockfileMockOptions {
  /** Side-effect hook invoked AFTER lock acquired but BEFORE returning the
   *  release function. Used by L-02 to simulate "a sibling refreshed during
   *  the lock acquisition" — the side effect writes a fresh token to the
   *  file backend so the implementation's re-read inside the lock sees it. */
  onLockAcquired?: () => Promise<void> | void;
}

function installLockfileMock(opts: LockfileMockOptions = {}): LockfileMock {
  const releaseSpy = vi.fn(async () => {
    // no-op — the test never persists a real lockfile
  });
  const lockSpy = vi.fn(async (_file: string, _options: unknown) => {
    if (opts.onLockAcquired) {
      await opts.onLockAcquired();
    }
    return releaseSpy;
  });

  vi.doMock('proper-lockfile', () => ({
    lock: lockSpy,
    default: { lock: lockSpy },
  }));

  return { lockSpy, releaseSpy };
}

/**
 * Dynamically import the token-store module after the per-test mocks are
 * installed. Returns the freshly-evaluated module so each test exercises an
 * isolated module-load and an isolated `inFlightRefresh` closure.
 */
async function loadTokenStore(): Promise<typeof import('./token-store.js')> {
  return import('./token-store.js');
}

// Seed an expired token in the keyring-mock store (the default backend) so
// `getValidAccessToken()` triggers a refresh. The helper writes through the
// store map directly so the test does not depend on the file-write path being
// implemented yet during the RED phase.
function seedExpiredKeyringToken(kr: KeyringMock, now: number): void {
  const expired = {
    accessToken: 'old-access-token',
    refreshToken: 'old-refresh-token',
    tokenType: 'bearer' as const,
    scope: 'offline read:recovery',
    obtainedAt: now - 3600_000,
    expiresAt: now - 1000,
  };
  kr.store.set('recovery-ledger:whoop', JSON.stringify(expired));
}

// =============================================================================
// describe('single-flight concurrency') — AUTH-05 unit-half
// =============================================================================

describe('single-flight concurrency', () => {
  test('C-01: 10 parallel getValidAccessToken() calls trigger exactly one POST', async () => {
    const kr = installKeyringMock();
    installLockfileMock();
    const now = Date.UTC(2026, 4, 12, 0, 0, 0);
    seedExpiredKeyringToken(kr, now);

    const mod = await loadTokenStore();
    const store = mod.createTokenStore({
      paths,
      now: () => now,
    });
    // Seed storage-mode cache directly so the read path skips the keyring
    // probe and goes straight to keychain.
    await writeFile(paths.storageModeFile, 'keychain\n', { mode: 0o600 });

    const results = await Promise.all(
      Array.from({ length: 10 }, () => store.getValidAccessToken()),
    );

    expect(helper.getRefreshHitCount()).toBe(1);
    expect(results).toHaveLength(10);
  });

  test('C-02: all 10 callers receive the same fresh access_token string', async () => {
    const kr = installKeyringMock();
    installLockfileMock();
    const now = Date.UTC(2026, 4, 12, 0, 0, 0);
    seedExpiredKeyringToken(kr, now);

    const mod = await loadTokenStore();
    const store = mod.createTokenStore({
      paths,
      now: () => now,
    });
    await writeFile(paths.storageModeFile, 'keychain\n', { mode: 0o600 });

    const results = await Promise.all(
      Array.from({ length: 10 }, () => store.getValidAccessToken()),
    );

    expect(new Set(results).size).toBe(1);
    // The fixture's at-1 is the default response from the MSW helper.
    expect(results[0]).toBe('at-1');
  });

  test('C-03: second call after refresh completes does NOT trigger a second POST', async () => {
    const kr = installKeyringMock();
    installLockfileMock();
    const now = Date.UTC(2026, 4, 12, 0, 0, 0);
    seedExpiredKeyringToken(kr, now);

    const mod = await loadTokenStore();
    const store = mod.createTokenStore({
      paths,
      now: () => now,
    });
    await writeFile(paths.storageModeFile, 'keychain\n', { mode: 0o600 });

    // First wave triggers refresh.
    await store.getValidAccessToken();
    expect(helper.getRefreshHitCount()).toBe(1);

    // Stored token now expires at now + 3600s; well outside the 5-min buffer.
    const second = await store.getValidAccessToken();

    expect(helper.getRefreshHitCount()).toBe(1);
    expect(second).toBe('at-1');
  });
});

// =============================================================================
// describe('refresh trigger') — D-14 5-min preemptive
// =============================================================================

describe('refresh trigger', () => {
  test('T-01: expiresAt = now + 4min triggers refresh (within 5-min buffer)', async () => {
    const kr = installKeyringMock();
    installLockfileMock();
    const now = Date.UTC(2026, 4, 12, 0, 0, 0);
    kr.store.set(
      'recovery-ledger:whoop',
      JSON.stringify({
        accessToken: 'soon-to-expire',
        refreshToken: 'rt',
        tokenType: 'bearer',
        scope: 'offline',
        obtainedAt: now - 56 * 60 * 1000,
        expiresAt: now + 4 * 60 * 1000,
      }),
    );

    const mod = await loadTokenStore();
    const store = mod.createTokenStore({ paths, now: () => now });
    await writeFile(paths.storageModeFile, 'keychain\n', { mode: 0o600 });

    await store.getValidAccessToken();
    expect(helper.getRefreshHitCount()).toBe(1);
  });

  test('T-02: expiresAt = now + 10min returns cached, no refresh', async () => {
    const kr = installKeyringMock();
    installLockfileMock();
    const now = Date.UTC(2026, 4, 12, 0, 0, 0);
    kr.store.set(
      'recovery-ledger:whoop',
      JSON.stringify({
        accessToken: 'still-fresh',
        refreshToken: 'rt',
        tokenType: 'bearer',
        scope: 'offline',
        obtainedAt: now - 50 * 60 * 1000,
        expiresAt: now + 10 * 60 * 1000,
      }),
    );

    const mod = await loadTokenStore();
    const store = mod.createTokenStore({ paths, now: () => now });
    await writeFile(paths.storageModeFile, 'keychain\n', { mode: 0o600 });

    const at = await store.getValidAccessToken();

    expect(helper.getRefreshHitCount()).toBe(0);
    expect(at).toBe('still-fresh');
  });

  test('T-03: expiresAt = now - 1s (expired) triggers refresh', async () => {
    const kr = installKeyringMock();
    installLockfileMock();
    const now = Date.UTC(2026, 4, 12, 0, 0, 0);
    seedExpiredKeyringToken(kr, now);

    const mod = await loadTokenStore();
    const store = mod.createTokenStore({ paths, now: () => now });
    await writeFile(paths.storageModeFile, 'keychain\n', { mode: 0o600 });

    await store.getValidAccessToken();
    expect(helper.getRefreshHitCount()).toBe(1);
  });
});

// =============================================================================
// describe('atomic write') — D-23.c temp-and-rename
// =============================================================================

describe('atomic write', () => {
  test('A-01: after write(), tokens.json mode is 0600 and tokens.json.tmp does not exist', async () => {
    installKeyringMock();
    installLockfileMock();
    process.env.RECOVERY_LEDGER_FORCE_FILE_STORE = '1';

    const mod = await loadTokenStore();
    const now = Date.UTC(2026, 4, 12, 0, 0, 0);
    const store = mod.createTokenStore({ paths, now: () => now });
    const tokens: import('./token-store.js').Tokens = {
      accessToken: 'at-x',
      refreshToken: 'rt-x',
      tokenType: 'bearer',
      scope: 'offline',
      obtainedAt: now,
      expiresAt: now + 3600_000,
    };

    await store.write(tokens);

    // Final file exists with mode 0600.
    const main = await stat(paths.tokensFile);
    expect(main.mode & 0o777).toBe(0o600);
    // Tmp file no longer exists (it was renamed).
    await expect(stat(`${paths.tokensFile}.tmp`)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  test('A-02: written blob round-trips through read() to the same object', async () => {
    installKeyringMock();
    installLockfileMock();
    process.env.RECOVERY_LEDGER_FORCE_FILE_STORE = '1';

    const mod = await loadTokenStore();
    const now = Date.UTC(2026, 4, 12, 0, 0, 0);
    const store = mod.createTokenStore({ paths, now: () => now });
    const tokens: import('./token-store.js').Tokens = {
      accessToken: 'at-y',
      refreshToken: 'rt-y',
      tokenType: 'bearer',
      scope: 'offline read:recovery',
      obtainedAt: now,
      expiresAt: now + 3600_000,
    };

    await store.write(tokens);
    const back = await store.read();

    expect(back).toEqual(tokens);
    // The on-disk JSON is parseable as the same shape.
    const raw = await readFile(paths.tokensFile, 'utf8');
    expect(JSON.parse(raw)).toEqual(tokens);
  });
});

// =============================================================================
// describe('backend fallback') — D-04/D-05 storage-mode cache
// =============================================================================

describe('backend fallback', () => {
  test('B-01: keyring write success → storage-mode cache = "keychain"', async () => {
    const kr = installKeyringMock();
    installLockfileMock();

    const mod = await loadTokenStore();
    const now = Date.UTC(2026, 4, 12, 0, 0, 0);
    const store = mod.createTokenStore({ paths, now: () => now });
    const tokens: import('./token-store.js').Tokens = {
      accessToken: 'at-k',
      refreshToken: 'rt-k',
      tokenType: 'bearer',
      scope: 'offline',
      obtainedAt: now,
      expiresAt: now + 3600_000,
    };

    await store.write(tokens);

    expect(kr.setPasswordSpy).toHaveBeenCalled();
    const mode = (await readFile(paths.storageModeFile, 'utf8')).trim();
    expect(mode).toBe('keychain');
  });

  test('B-02: keyring setPassword throws → falls back to file backend', async () => {
    installKeyringMock({ setThrows: true });
    installLockfileMock();

    const mod = await loadTokenStore();
    const now = Date.UTC(2026, 4, 12, 0, 0, 0);
    const store = mod.createTokenStore({ paths, now: () => now });
    const tokens: import('./token-store.js').Tokens = {
      accessToken: 'at-f',
      refreshToken: 'rt-f',
      tokenType: 'bearer',
      scope: 'offline',
      obtainedAt: now,
      expiresAt: now + 3600_000,
    };

    await store.write(tokens);

    const mode = (await readFile(paths.storageModeFile, 'utf8')).trim();
    expect(mode).toBe('file');
    const raw = await readFile(paths.tokensFile, 'utf8');
    expect(JSON.parse(raw)).toEqual(tokens);
  });

  test('B-03: RECOVERY_LEDGER_FORCE_FILE_STORE=1 (D-25) skips keyring entirely', async () => {
    const kr = installKeyringMock();
    installLockfileMock();
    process.env.RECOVERY_LEDGER_FORCE_FILE_STORE = '1';

    const mod = await loadTokenStore();
    const now = Date.UTC(2026, 4, 12, 0, 0, 0);
    const store = mod.createTokenStore({ paths, now: () => now });
    const tokens: import('./token-store.js').Tokens = {
      accessToken: 'at-force',
      refreshToken: 'rt-force',
      tokenType: 'bearer',
      scope: 'offline',
      obtainedAt: now,
      expiresAt: now + 3600_000,
    };

    await store.write(tokens);

    expect(kr.setPasswordSpy).not.toHaveBeenCalled();
    const mode = (await readFile(paths.storageModeFile, 'utf8')).trim();
    expect(mode).toBe('file');
  });

  test('B-04: Pitfall F — setPassword succeeds but getPassword mismatch → file fallback', async () => {
    installKeyringMock({ getMismatch: true });
    installLockfileMock();

    const mod = await loadTokenStore();
    const now = Date.UTC(2026, 4, 12, 0, 0, 0);
    const store = mod.createTokenStore({ paths, now: () => now });
    const tokens: import('./token-store.js').Tokens = {
      accessToken: 'at-pf',
      refreshToken: 'rt-pf',
      tokenType: 'bearer',
      scope: 'offline',
      obtainedAt: now,
      expiresAt: now + 3600_000,
    };

    await store.write(tokens);

    const mode = (await readFile(paths.storageModeFile, 'utf8')).trim();
    expect(mode).toBe('file');
    const raw = await readFile(paths.tokensFile, 'utf8');
    expect(JSON.parse(raw)).toEqual(tokens);
  });

  test('B-05 (WR-D regression): setThrows fallback best-effort-deletes the keychain entry', async () => {
    // WR-D: when the keyring write throws and we fall back to file, any
    // prior keychain blob would otherwise survive. The fallback arm must
    // best-effort-delete the keychain entry so a later session that
    // somehow reverts the storage-mode marker does NOT silently re-emerge
    // with stale tokens. Symmetry with clear().
    const kr = installKeyringMock({ setThrows: true });
    installLockfileMock();

    const mod = await loadTokenStore();
    const now = Date.UTC(2026, 4, 12, 0, 0, 0);
    const store = mod.createTokenStore({ paths, now: () => now });
    const tokens: import('./token-store.js').Tokens = {
      accessToken: 'at-wd',
      refreshToken: 'rt-wd',
      tokenType: 'bearer',
      scope: 'offline',
      obtainedAt: now,
      expiresAt: now + 3600_000,
    };

    await store.write(tokens);

    // Storage mode flipped to file.
    expect((await readFile(paths.storageModeFile, 'utf8')).trim()).toBe('file');
    // The keychain entry was best-effort-deleted on the fallback path.
    expect(kr.deletePasswordSpy).toHaveBeenCalledWith('recovery-ledger', 'whoop');
  });

  test('B-06 (WR-D regression): Pitfall F fallback best-effort-deletes the keychain entry', async () => {
    // Pitfall F: setPassword succeeds but the round-trip read mismatches.
    // The mismatched blob is still IN the keychain — we must delete it
    // before the file fallback writes so the stale keychain blob cannot
    // re-emerge if the storage-mode marker is later reverted.
    const kr = installKeyringMock({ getMismatch: true });
    installLockfileMock();

    const mod = await loadTokenStore();
    const now = Date.UTC(2026, 4, 12, 0, 0, 0);
    const store = mod.createTokenStore({ paths, now: () => now });
    const tokens: import('./token-store.js').Tokens = {
      accessToken: 'at-wd2',
      refreshToken: 'rt-wd2',
      tokenType: 'bearer',
      scope: 'offline',
      obtainedAt: now,
      expiresAt: now + 3600_000,
    };

    await store.write(tokens);

    expect((await readFile(paths.storageModeFile, 'utf8')).trim()).toBe('file');
    expect(kr.deletePasswordSpy).toHaveBeenCalledWith('recovery-ledger', 'whoop');
  });

  test('B-07 (WR-D regression): forceFile=true does NOT touch the keychain (no delete probe)', async () => {
    // D-25 forceFile path: the user explicitly disabled the keyring. We
    // must not even probe deletePassword in that case — the keychain is
    // off-limits for this session.
    const kr = installKeyringMock();
    installLockfileMock();
    process.env.RECOVERY_LEDGER_FORCE_FILE_STORE = '1';

    const mod = await loadTokenStore();
    const now = Date.UTC(2026, 4, 12, 0, 0, 0);
    const store = mod.createTokenStore({ paths, now: () => now });
    const tokens: import('./token-store.js').Tokens = {
      accessToken: 'at-wd3',
      refreshToken: 'rt-wd3',
      tokenType: 'bearer',
      scope: 'offline',
      obtainedAt: now,
      expiresAt: now + 3600_000,
    };

    await store.write(tokens);

    expect(kr.setPasswordSpy).not.toHaveBeenCalled();
    expect(kr.deletePasswordSpy).not.toHaveBeenCalled();
  });
});

// =============================================================================
// describe('refresh errors') — D-15 + Pitfall A
// =============================================================================

describe('refresh errors', () => {
  test('E-01: MSW 400 invalid_grant rejects with AuthError{kind: refresh_failed}', async () => {
    const kr = installKeyringMock();
    installLockfileMock();
    const now = Date.UTC(2026, 4, 12, 0, 0, 0);
    seedExpiredKeyringToken(kr, now);

    helper.setNextResponse(
      { error: 'invalid_grant', error_description: 'refresh token reused' },
      400,
    );

    const mod = await loadTokenStore();
    const { AuthError } = await import('./errors.js');
    const store = mod.createTokenStore({ paths, now: () => now });
    await writeFile(paths.storageModeFile, 'keychain\n', { mode: 0o600 });

    // Single call → single rejection. Combine both assertions on one promise
    // so the MSW helper's one-shot `setNextResponse` (which auto-resets after
    // the first hit) is not consumed twice.
    let caught: unknown;
    try {
      await store.getValidAccessToken();
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(AuthError);
    expect((caught as { kind: string }).kind).toBe('refresh_failed');
  });

  test('E-02: failed refresh does NOT retry (retry budget = 0 per D-15)', async () => {
    const kr = installKeyringMock();
    installLockfileMock();
    const now = Date.UTC(2026, 4, 12, 0, 0, 0);
    seedExpiredKeyringToken(kr, now);

    helper.setNextResponse({ error: 'invalid_grant' }, 400);

    const mod = await loadTokenStore();
    const store = mod.createTokenStore({ paths, now: () => now });
    await writeFile(paths.storageModeFile, 'keychain\n', { mode: 0o600 });

    await expect(store.getValidAccessToken()).rejects.toThrow();
    expect(helper.getRefreshHitCount()).toBe(1);
  });

  test('E-03: AuthError.message does NOT contain refresh-token or access-token strings', async () => {
    const kr = installKeyringMock();
    installLockfileMock();
    const now = Date.UTC(2026, 4, 12, 0, 0, 0);
    kr.store.set(
      'recovery-ledger:whoop',
      JSON.stringify({
        accessToken: 'secret-access-fingerprint',
        refreshToken: 'secret-refresh-fingerprint',
        tokenType: 'bearer',
        scope: 'offline',
        obtainedAt: now - 3600_000,
        expiresAt: now - 1000,
      }),
    );
    helper.setNextResponse({ error: 'invalid_grant' }, 400);

    const mod = await loadTokenStore();
    const store = mod.createTokenStore({ paths, now: () => now });
    await writeFile(paths.storageModeFile, 'keychain\n', { mode: 0o600 });

    try {
      await store.getValidAccessToken();
      throw new Error('expected getValidAccessToken to reject');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      expect(msg).not.toContain('secret-access-fingerprint');
      expect(msg).not.toContain('secret-refresh-fingerprint');
    }
  });
});

// =============================================================================
// describe('cross-process lock') — proper-lockfile options + re-read arm
// =============================================================================

describe('cross-process lock', () => {
  test('L-01: lockfile.lock is called with the documented options', async () => {
    const kr = installKeyringMock();
    const lf = installLockfileMock();
    const now = Date.UTC(2026, 4, 12, 0, 0, 0);
    seedExpiredKeyringToken(kr, now);

    const mod = await loadTokenStore();
    const store = mod.createTokenStore({ paths, now: () => now });
    await writeFile(paths.storageModeFile, 'keychain\n', { mode: 0o600 });

    await store.getValidAccessToken();

    expect(lf.lockSpy).toHaveBeenCalled();
    const firstCall = lf.lockSpy.mock.calls[0];
    if (firstCall === undefined) {
      throw new Error('lockfile.lock was not called');
    }
    const [lockedPath, options] = firstCall;
    expect(lockedPath).toBe(paths.tokensLockFile);
    expect(options).toMatchObject({
      retries: { retries: 10, factor: 1.2, minTimeout: 50 },
      stale: 5000,
    });
  });

  test('L-02: sibling refresh during lock acquisition is observed; no POST fired', async () => {
    const kr = installKeyringMock();
    const now = Date.UTC(2026, 4, 12, 0, 0, 0);
    seedExpiredKeyringToken(kr, now);

    // Hook: while the lock is being acquired (after the in-process gate but
    // before our re-read), write a fresh token to the keyring backing store.
    // The implementation's post-lock re-read should see the fresh token and
    // skip the POST.
    installLockfileMock({
      onLockAcquired: () => {
        kr.store.set(
          'recovery-ledger:whoop',
          JSON.stringify({
            accessToken: 'sibling-refreshed',
            refreshToken: 'rt-sibling',
            tokenType: 'bearer',
            scope: 'offline',
            obtainedAt: now,
            expiresAt: now + 3600_000,
          }),
        );
      },
    });

    const mod = await loadTokenStore();
    const store = mod.createTokenStore({ paths, now: () => now });
    await writeFile(paths.storageModeFile, 'keychain\n', { mode: 0o600 });

    const at = await store.getValidAccessToken();

    expect(at).toBe('sibling-refreshed');
    expect(helper.getRefreshHitCount()).toBe(0);
  });

  test('L-03 (CR-01 regression): sibling-rotated-but-still-stale refresh_token is what we POST, not the pre-lock snapshot', async () => {
    // CR-01 / ADR-0002 §Context: WHOOP revokes the entire token family on
    // reuse of a stale refresh_token. If a sibling refreshes between our
    // pre-lock snapshot and our post-lock re-read, AND the sibling's new
    // token is itself near-expiry (e.g., short-lived test fixture), the
    // implementation must send the SIBLING'S refresh_token, not the
    // pre-lock one we already know is invalidated.
    const kr = installKeyringMock();
    const now = Date.UTC(2026, 4, 12, 0, 0, 0);
    // Pre-lock: we hold a stale snapshot (rt-original-stale). The sibling
    // consumes this token and replaces it with rt-sibling-also-stale; THAT
    // new token is the only one WHOOP will still honor.
    kr.store.set(
      'recovery-ledger:whoop',
      JSON.stringify({
        accessToken: 'at-original-stale',
        refreshToken: 'rt-original-stale',
        tokenType: 'bearer',
        scope: 'offline read:recovery',
        obtainedAt: now - 3600_000,
        expiresAt: now - 1000,
      }),
    );

    // Hook: sibling rotates the on-disk token while we wait for the lock.
    // Sibling's replacement is ALSO within the 5-min refresh buffer so the
    // post-lock re-read does NOT short-circuit on the freshness check;
    // execution falls through to callRefreshEndpoint(fresh ?? stale).
    installLockfileMock({
      onLockAcquired: () => {
        kr.store.set(
          'recovery-ledger:whoop',
          JSON.stringify({
            accessToken: 'at-sibling-near-expiry',
            refreshToken: 'rt-sibling-also-stale',
            tokenType: 'bearer',
            scope: 'offline read:recovery',
            obtainedAt: now - 3500_000,
            // Within REFRESH_BUFFER_MS (5min) — fresh.expiresAt < now + 5min,
            // so the post-lock freshness gate is NOT short-circuited.
            expiresAt: now + 30_000,
          }),
        );
      },
    });

    const mod = await loadTokenStore();
    const store = mod.createTokenStore({ paths, now: () => now });
    await writeFile(paths.storageModeFile, 'keychain\n', { mode: 0o600 });

    await store.getValidAccessToken();

    // Exactly one POST fired — and it carried the SIBLING'S refresh_token,
    // not the pre-lock stale snapshot. Pre-fix bug: `stale ?? fresh` would
    // have sent 'rt-original-stale' and WHOOP would have revoked the family.
    expect(helper.getRefreshHitCount()).toBe(1);
    const body = helper.getLastRequestBody();
    expect(body).not.toBeNull();
    expect(body?.get('refresh_token')).toBe('rt-sibling-also-stale');
    expect(body?.get('refresh_token')).not.toBe('rt-original-stale');
  });

  test('L-03a (WR-03 regression): direct `write()` acquires the cross-process lock with documented options', async () => {
    // WR-03: the CLI `auth` completion path calls `tokenStore.write(tokens)`
    // outside of `doRefresh`. Without the lock, a concurrent MCP-server
    // refresh and a `recovery-ledger auth` run could interleave and leave the
    // storage-mode marker pointing at the wrong backend. The public `write`
    // must acquire the same lock that `doRefresh` does.
    installKeyringMock();
    const lf = installLockfileMock();
    process.env.RECOVERY_LEDGER_FORCE_FILE_STORE = '1';

    const mod = await loadTokenStore();
    const now = Date.UTC(2026, 4, 12, 0, 0, 0);
    const store = mod.createTokenStore({ paths, now: () => now });
    const tokens: import('./token-store.js').Tokens = {
      accessToken: 'at-wr03',
      refreshToken: 'rt-wr03',
      tokenType: 'bearer',
      scope: 'offline',
      obtainedAt: now,
      expiresAt: now + 3600_000,
    };

    await store.write(tokens);

    expect(lf.lockSpy).toHaveBeenCalled();
    const firstCall = lf.lockSpy.mock.calls[0];
    if (firstCall === undefined) {
      throw new Error('lockfile.lock was not called from public write()');
    }
    const [lockedPath, options] = firstCall;
    expect(lockedPath).toBe(paths.tokensLockFile);
    expect(options).toMatchObject({
      retries: { retries: 10, factor: 1.2, minTimeout: 50 },
      stale: 5000,
    });
    // Release must have been called once (write completed cleanly).
    expect(lf.releaseSpy).toHaveBeenCalledTimes(1);
  });

  test('L-03b (WR-02 regression): malformed on-disk tokens inside lock do NOT raise refresh_failed; fall through to pre-lock stale snapshot', async () => {
    // WR-02: a malformed token blob written by an external tool (an editor
    // save, a backup-restore) makes `read()` throw a ZodError → AuthError
    // wrapper. Pre-fix: that error escapes from inside the lock and the user
    // sees `refresh_failed` ("token refresh failed — re-auth"), which is
    // misleading. Post-fix: the read inside the lock catches the error,
    // treats it as null, falls through to callRefreshEndpoint(stale) — the
    // pre-lock snapshot is still valid and the refresh succeeds.
    const kr = installKeyringMock();
    const now = Date.UTC(2026, 4, 12, 0, 0, 0);
    // Pre-lock: valid stale token in memory (read() succeeded once before
    // the lock was acquired). We seed via the keyring mock.
    seedExpiredKeyringToken(kr, now);

    // Inside the lock: a sibling (or external corruption) replaces the
    // keyring blob with garbage. read() throws.
    installLockfileMock({
      onLockAcquired: () => {
        kr.store.set('recovery-ledger:whoop', '{not valid json');
      },
    });

    const mod = await loadTokenStore();
    const store = mod.createTokenStore({ paths, now: () => now });
    await writeFile(paths.storageModeFile, 'keychain\n', { mode: 0o600 });

    // Should succeed using the pre-lock stale snapshot, NOT throw refresh_failed
    // on the parse error.
    const at = await store.getValidAccessToken();
    // Default fixture access_token is 'at-1'.
    expect(at).toBe('at-1');
    expect(helper.getRefreshHitCount()).toBe(1);
  });

  test('L-04 (CR-02 regression): refresh body omits `scope` so the AS retains originally-granted scope', async () => {
    // CR-02 / RFC 6749 §6: sending `scope: 'offline'` on refresh asks the AS
    // to narrow the token to just the offline scope, dropping the seven read
    // scopes the user granted at init and breaking every Phase 3 `read:*`
    // API call with a 403. The fix omits the `scope` parameter entirely so
    // the AS retains the original grant.
    const kr = installKeyringMock();
    installLockfileMock();
    const now = Date.UTC(2026, 4, 12, 0, 0, 0);
    seedExpiredKeyringToken(kr, now);

    const mod = await loadTokenStore();
    const store = mod.createTokenStore({ paths, now: () => now });
    await writeFile(paths.storageModeFile, 'keychain\n', { mode: 0o600 });

    await store.getValidAccessToken();

    const body = helper.getLastRequestBody();
    expect(body).not.toBeNull();
    expect(body?.get('grant_type')).toBe('refresh_token');
    // The `scope` parameter must NOT be present on the wire — its absence is
    // what tells WHOOP to retain the originally-granted scope set per RFC
    // 6749 §6.
    expect(body?.has('scope')).toBe(false);
  });

  test('L-05 (CR-02 regression): post-refresh tokens.scope preserves all seven init-time read scopes', async () => {
    const kr = installKeyringMock();
    installLockfileMock();
    const now = Date.UTC(2026, 4, 12, 0, 0, 0);
    seedExpiredKeyringToken(kr, now);

    const mod = await loadTokenStore();
    const store = mod.createTokenStore({ paths, now: () => now });
    await writeFile(paths.storageModeFile, 'keychain\n', { mode: 0o600 });

    await store.getValidAccessToken();

    // token-200 fixture carries the seven init-time scopes. With the fix in
    // place, the absent `scope` param means WHOOP echoes the original grant;
    // a regression that reintroduces `scope: 'offline'` would cause the
    // fixture/response shape to need to change to surface — keeping the
    // fixture rich pins the round-trip contract here.
    const stored = await store.read();
    expect(stored).not.toBeNull();
    expect(stored?.scope).toContain('read:recovery');
    expect(stored?.scope).toContain('read:sleep');
    expect(stored?.scope).toContain('read:workout');
    expect(stored?.scope).toContain('read:cycles');
    expect(stored?.scope).toContain('read:profile');
    expect(stored?.scope).toContain('read:body_measurement');
  });
});

// =============================================================================
// describe('real lockfile smoke-test') — WR-A correction of WR-05's
// over-promise. ALL OTHER tests in this file mock proper-lockfile. This block
// uses the REAL `proper-lockfile` against a tmpdir to verify the module is
// actually wired into the code path (not just satisfied by the per-test mock)
// and that acquire/release works in-process.
//
// What this block does NOT do (WR-A): it does NOT exercise cross-process lock
// CONTENTION. Both LR-01 calls share a single `createTokenStore()` instance,
// and the in-process `inFlightRefresh` Promise-gate intercepts the second
// call BEFORE `doRefresh` runs -- only ONE call ever reaches
// `proper-lockfile.lock`, uncontended. A regression in the retry policy
// (e.g., dropping `retries: 10` to `retries: 0`) would NOT cause LR-01 or
// LR-02 to fail; that detection target is owned by the cross-process
// integration test in `tests/integration/auth-concurrency.test.ts`, which
// spawns two child processes against a local mock server.
//
// Value this block DOES provide:
// - LR-01 proves the real `proper-lockfile` module is reachable from
//   `createTokenStore` (a wiring regression that replaced the import with a
//   no-op would fail here).
// - LR-02 proves the lock release cleans up `<target>.lock` (a regression
//   where `release()` is never called would leave the directory and fail).
// =============================================================================

describe('real lockfile smoke-test (WR-A correction of WR-05)', () => {
  test('LR-01: real proper-lockfile wires through createTokenStore + acquire/release succeeds in-process', async () => {
    // No vi.doMock('proper-lockfile') here — the dynamic import resolves the
    // real module from node_modules. We DO still mock the keyring so the test
    // is deterministic across macOS/Linux keychain availability.
    //
    // Note: two simultaneous getValidAccessToken() calls on the SAME store
    // funnel through the in-process Promise-gate; only one ever reaches the
    // real lock. This still exercises the real lock for that single
    // acquisition; it does NOT exercise contention. See block header above.
    const kr = installKeyringMock();
    // installLockfileMock() intentionally NOT called — use the real module.
    const now = Date.UTC(2026, 4, 12, 0, 0, 0);
    seedExpiredKeyringToken(kr, now);

    const mod = await loadTokenStore();
    const store = mod.createTokenStore({ paths, now: () => now });
    await writeFile(paths.storageModeFile, 'keychain\n', { mode: 0o600 });

    const [r1, r2] = await Promise.all([store.getValidAccessToken(), store.getValidAccessToken()]);

    expect(r1).toBe('at-1');
    expect(r2).toBe('at-1');
    expect(r1).toBe(r2);
    expect(helper.getRefreshHitCount()).toBe(1);
  });

  test('LR-02: real lockfile release cleans up the .lock directory', async () => {
    // Wiring proof: proper-lockfile creates a `<target>.lock` directory
    // while held. After release we assert the directory is gone -- a
    // regression where `release()` is never called would leave the
    // directory and fail this test.
    const kr = installKeyringMock();
    const now = Date.UTC(2026, 4, 12, 0, 0, 0);
    seedExpiredKeyringToken(kr, now);

    const mod = await loadTokenStore();
    const store = mod.createTokenStore({ paths, now: () => now });
    await writeFile(paths.storageModeFile, 'keychain\n', { mode: 0o600 });

    await store.getValidAccessToken();

    expect(helper.getRefreshHitCount()).toBe(1);
    await expect(stat(`${paths.tokensLockFile}.lock`)).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });
});
