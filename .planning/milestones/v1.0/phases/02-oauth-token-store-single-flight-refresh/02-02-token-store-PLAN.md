---
phase: 02-oauth-token-store-single-flight-refresh
plan: 02
type: execute
wave: 2
depends_on: ['02-01']
files_modified:
  - src/infrastructure/whoop/token-store.ts
  - src/infrastructure/whoop/token-store.test.ts
autonomous: true
requirements:
  - AUTH-03
  - AUTH-04
  - AUTH-05
user_setup: []

note: "Checker WARNING SCOPE-PLAN-02 — Task 1 carries 15 tests in a single task, which is high in-task complexity. Intentionally kept as a single task to preserve the atomic-write + concurrency invariant in one head-shaped test file: the C/T/A/B/E/L groups all share the same vi.resetModules + vi.doMock(@napi-rs/keyring) harness and splitting would force the harness boilerplate to be duplicated. Complexity is acknowledged; the in-task structure uses describe-blocks for navigation."

must_haves:
  truths:
    - "D-04: Keyring is primary storage via @napi-rs/keyring; tokens are stored as a single JSON-serialized blob under service `recovery-ledger` account `whoop-tokens`."
    - "The token-store module is the only consumer of WHOOP_TOKEN_URL — no other src/ file references the WHOOP token endpoint."
    - "10 parallel callers to getValidAccessToken() with an expired token produce exactly one POST to the WHOOP token endpoint."
    - "All 10 callers receive the same fresh access_token string."
    - "Backend selection (keychain vs file) is decided once and cached in storage-mode; no mid-session backend flipping."
    - "Token file writes are atomic: tokens.json.tmp written with mode 0600, fsynced, then renamed."
    - "After a refresh, tokens.json.tmp does not exist on disk (it was renamed)."
    - "RECOVERY_LEDGER_FORCE_FILE_STORE=1 bypasses the keyring attempt and writes directly to the file backend."
    - "AuthError({kind: 'refresh_failed'}) is thrown on a 400/500 from the token endpoint; raw Error is never thrown."
    - "token-store.ts consumes errors.ts from Plan 02-01 unchanged — Wave 0 ships the full 6-kind AuthErrorKind union (including auth_port_in_use moved here per checker BLOCKER 1) so this Wave 2 plan can compile and link without coordinating mid-wave."
  artifacts:
    - path: "src/infrastructure/whoop/token-store.ts"
      provides: "Token store with keyring + file backends, in-process Promise gate, proper-lockfile cross-process gate, atomic temp-and-rename write."
      contains: "getValidAccessToken"
    - path: "src/infrastructure/whoop/token-store.test.ts"
      provides: "Unit tests covering 10-parallel concurrency (AUTH-05 unit half), 5-min preemptive trigger (D-14), atomic-write assertion (D-23.c), keyring/file fallback arms (D-05), RECOVERY_LEDGER_FORCE_FILE_STORE=1 override (D-25)."
      contains: "10 parallel"
  key_links:
    - from: "src/infrastructure/whoop/token-store.ts"
      to: "process.env.WHOOP_TOKEN_URL"
      via: "test-only override read at module load — `const TOKEN_URL = process.env.WHOOP_TOKEN_URL ?? 'https://api.prod.whoop.com/oauth/oauth2/token'`"
      pattern: "WHOOP_TOKEN_URL"
    - from: "src/infrastructure/whoop/token-store.ts"
      to: "src/infrastructure/whoop/errors.ts"
      via: "throws AuthError({kind: 'refresh_failed', cause: ...}) on non-2xx from token endpoint; errors.ts is FROZEN from Wave 0 (6-kind union)"
      pattern: "AuthError"
    - from: "src/infrastructure/whoop/token-store.ts"
      to: "proper-lockfile"
      via: "lockfile.lock(paths.tokensLockFile, {retries: {retries: 10, factor: 1.2, minTimeout: 50}, stale: 5000})"
      pattern: "proper-lockfile"
    - from: "src/infrastructure/whoop/token-store.ts"
      to: "@napi-rs/keyring"
      via: "Entry('recovery-ledger', 'whoop').setPassword / getPassword"
      pattern: "from '@napi-rs/keyring'"
    - from: "src/infrastructure/whoop/token-store.ts"
      to: "src/infrastructure/config/paths.ts"
      via: "paths.tokensFile, paths.tokensLockFile, paths.storageModeFile from the singleton"
      pattern: "from '../config/paths.js'"
    - from: "src/infrastructure/whoop/token-store.ts"
      to: "src/infrastructure/config/logger.ts"
      via: "logger.debug / logger.warn via the shared Pino instance (stderr only — ADR-0001)"
      pattern: "from '../config/logger.js'"
---

<objective>
Build the load-bearing token-store module: keyring-primary + file-fallback persistence, three-layer single-flight gate (in-process Promise + proper-lockfile + atomic write), and the `getValidAccessToken()` interface that every WHOOP API call will go through.

Purpose: This is the ADR-0002 implementation. AUTH-05 (single-flight refresh) is the load-bearing requirement; Phase 2 success criterion #2 fails without this module. Plans 03/04/05/06 all depend on its public surface.

Output: Two files — `token-store.ts` (~120 LOC) plus `token-store.test.ts` (~250 LOC of unit coverage including the AUTH-05 unit-half concurrency test).
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/PROJECT.md
@.planning/REQUIREMENTS.md
@.planning/STATE.md
@.planning/phases/02-oauth-token-store-single-flight-refresh/02-CONTEXT.md
@.planning/phases/02-oauth-token-store-single-flight-refresh/02-RESEARCH.md
@.planning/phases/02-oauth-token-store-single-flight-refresh/02-PATTERNS.md
@CLAUDE.md
@agent_docs/conventions.md
@agent_docs/decisions/0001-mcp-stdout-purity.md
@agent_docs/decisions/0002-single-flight-oauth-refresh.md
@agent_docs/decisions/0006-fixture-only-tests.md
@agent_docs/decisions/0007-whoop-read-only.md
@src/infrastructure/config/logger.ts

<interfaces>
<!-- Module-level exports. Plans 03/04/05/06 import from this surface. -->

From Wave-0 (Plan 01):
- `src/infrastructure/config/paths.ts` exports `paths: ResolvedPaths` with `tokensFile`, `tokensLockFile`, `storageModeFile`.
- `src/infrastructure/whoop/errors.ts` exports `AuthError` class with `kind` discriminant — the union is FROZEN at 6 kinds (auth_missing, auth_expired, auth_state_mismatch, auth_timeout, auth_port_in_use, refresh_failed). Per checker BLOCKER 1, `auth_port_in_use` was moved into Wave 0 so this plan and Plan 02-03 (both Wave 2) consume an unchanging errors.ts.
- `tests/helpers/msw-whoop-oauth.ts` exports `createWhoopOauthHelper()` for the unit tests.

token-store.ts public surface (per 02-PATTERNS.md lines 440-447 + RESEARCH Patterns 1+2):
- `export interface Tokens { accessToken: string; refreshToken: string; tokenType: 'bearer'; scope: string; obtainedAt: number; expiresAt: number; }`
- `export type StorageMode = 'keychain' | 'file';`
- `export const REFRESH_BUFFER_MS = 5 * 60 * 1000;` (D-14)
- `export const WHOOP_TOKEN_URL: string` (re-exported singleton; reads `process.env.WHOOP_TOKEN_URL` once at module load, falls back to `https://api.prod.whoop.com/oauth/oauth2/token`)
- `export interface TokenStoreOptions { paths?: ResolvedPaths; now?: () => number; fetch?: typeof globalThis.fetch; forceFileStore?: boolean; clientCreds?: () => { clientId: string; clientSecret: string }; }` — test seam per PATTERNS Pattern E (factory + singleton).
- `export interface TokenStore { getValidAccessToken(): Promise<string>; read(): Promise<Tokens | null>; write(t: Tokens): Promise<void>; clear(): Promise<void>; readStorageMode(): Promise<StorageMode | null>; }`
- `export function createTokenStore(opts?: TokenStoreOptions): TokenStore`
- `export const tokenStore: TokenStore` — singleton bound to default options.

ADR-0002 three-layer gate (per 02-RESEARCH.md lines 345-395 + ADR-0002 §Decision lines 22-43):
- GATE 1: module-level `let inFlightRefresh: Promise<Tokens> | null = null;` — second caller awaits same promise.
- GATE 2: `proper-lockfile.lock(paths.tokensLockFile, {retries: {retries: 10, factor: 1.2, minTimeout: 50}, stale: 5000})`. Re-read tokens AFTER acquiring lock (sibling may have refreshed). Release in `finally`.
- GATE 3: file backend only — `open(tokensFile.tmp, 'w', 0o600)` → `fd.writeFile(blob)` → `fd.sync()` → `fd.close()` → `rename(tmp, final)` (same-directory rename — Pitfall D).

Backend selection (per CONTEXT D-04/D-05 + 02-RESEARCH.md §Pitfall E):
- If `forceFileStore === true` OR `process.env.RECOVERY_LEDGER_FORCE_FILE_STORE === '1'` → skip keyring entirely. Cache `storage-mode` = `'file'`.
- Else attempt `Entry('recovery-ledger', 'whoop').setPassword(blob)`. If it throws, fall back to file. Cache `storage-mode` accordingly.
- After `setPassword`, immediately `getPassword()` and verify byte-equal (Pitfall F defense-in-depth). On mismatch, fall back to file.
- Subsequent reads consult `storage-mode` cache first (no live keychain probe on every read).

Refresh-endpoint POST shape (per RESEARCH lines 664-715 + WHOOP refresh tutorial):
- `Content-Type: application/x-www-form-urlencoded`
- Body: `grant_type=refresh_token&refresh_token=<rt>&client_id=<id>&client_secret=<secret>&scope=offline`
- Response parsed via Zod schema `z.object({access_token, refresh_token, expires_in, scope, token_type: z.literal('bearer')}).passthrough()` from RESEARCH line 671-677.
- On non-2xx: throw `AuthError({kind: 'refresh_failed', detail: 'token endpoint <status>'})` — body text is NOT inlined into detail (Pitfall C — sanitizer covers cause chain, but defense-in-depth says don't help leakers).
- Retry budget on refresh: 0 (D-15 + STACK.md §Token refresh point 4). A failed refresh is terminal until next `recovery-ledger auth`.

Logging discipline (per ADR-0001):
- `import { logger } from '../config/logger.js';` — only logger.
- Log lines must be free of token material. Use `logger.debug({state: ..., hasCode: boolean})` not the raw URL (Pitfall C).
- Any error string passed to logger must run through Phase 1's `sanitize()` first (Pitfall C defense-in-depth — but `sanitize` lives in `src/mcp/`. Cross-layer import is intentional and documented in ADR-0001 §Consequences). NOTE: importing from `src/mcp/` into infra is a layering inversion; the cleaner option is to NOT log error-detail strings at all from token-store. Choose option B: log only the kind discriminant and structured fields (logger.warn({event: 'refresh_failed'}))) — never the cause chain.
</interfaces>
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: token-store.ts — single-flight gate + dual backends + atomic write</name>
  <files>
    src/infrastructure/whoop/token-store.ts,
    src/infrastructure/whoop/token-store.test.ts
  </files>
  <read_first>
    - src/infrastructure/config/logger.ts (Phase 1 — factory+singleton+env-arg pattern; copy module structure verbatim)
    - src/infrastructure/config/paths.ts (Plan 01 — read the ResolvedPaths shape and tokensLockFile basename)
    - src/infrastructure/whoop/errors.ts (Plan 01 — AuthError carrier shape; the 6-kind union INCLUDING auth_port_in_use is final at Wave 0)
    - tests/helpers/msw-whoop-oauth.ts (Plan 01 — WHOOP_TOKEN_URL constant + factory)
    - agent_docs/decisions/0002-single-flight-oauth-refresh.md (lines 22-75 — the three-layer gate is non-negotiable)
    - agent_docs/decisions/0001-mcp-stdout-purity.md (no console.* in this file)
    - agent_docs/decisions/0006-fixture-only-tests.md (no live WHOOP)
    - .planning/phases/02-oauth-token-store-single-flight-refresh/02-RESEARCH.md (lines 340-424 for the three-layer gate sketch; lines 519-526 for anti-patterns; lines 549-606 for Pitfalls A-G; lines 962-994 for MSW test recipe; lines 1028-1057 for atomic-write assertion + keyring mock recipe)
    - .planning/phases/02-oauth-token-store-single-flight-refresh/02-CONTEXT.md (D-04 to D-07, D-14 to D-16, D-23 to D-25)
    - .planning/phases/02-oauth-token-store-single-flight-refresh/02-PATTERNS.md (lines 410-447 — "No close analog exists" note + Reference sources list; lines 700-718 for factory+singleton seam)
    - src/cli/commands/doctor.test.ts (Phase 1 — analog for vi.doMock + vi.resetModules + dynamic re-import; lines 64-87 are load-bearing for module-level singleton isolation)
    - src/services/doctor/checks/native-modules.ts (Phase 1 — analog for the keyring `Entry` import and DoctorCheck producer shape)
  </read_first>
  <behavior>
    Concurrency (AUTH-05 unit half — D-23.1, load-bearing per D-24):
    - Test C-01: with expired token seeded and MSW returning fresh tokens, `await Promise.all(Array.from({length: 10}, () => store.getValidAccessToken()))` triggers exactly one POST to WHOOP_TOKEN_URL (`expect(helper.getRefreshHitCount()).toBe(1)`).
    - Test C-02: all 10 resolved access-token strings are identical (`new Set(results).size === 1`).
    - Test C-03: a second `getValidAccessToken()` call after the first refresh completes does NOT trigger a second POST (inFlightRefresh cleared in `.finally`; freshly-stored token is < 5min from now + 1h, so reads from cache).

    Refresh trigger (D-14):
    - Test T-01: token with `expiresAt = now + 4 * 60 * 1000` (4 min) → triggers refresh (within 5-min buffer).
    - Test T-02: token with `expiresAt = now + 10 * 60 * 1000` (10 min) → returns cached, no refresh.
    - Test T-03: token with `expiresAt = now - 1000` (1s expired) → triggers refresh.

    Atomic write (D-23.c):
    - Test A-01: after `write({...})`, `tokens.json` exists with mode `0o600` and `tokens.json.tmp` does NOT exist (stat throws ENOENT).
    - Test A-02: blob written to `tokens.json` parses as JSON and round-trips through `read()` to the same object.

    Backend fallback (D-04/D-05):
    - Test B-01: with mocked `@napi-rs/keyring` Entry.setPassword(blob) succeeding and getPassword(blob) returning the same blob → storage-mode cache file contains `'keychain'`.
    - Test B-02: with mocked `Entry.setPassword` throwing → falls back to file backend; storage-mode cache contains `'file'`; tokens persist to disk.
    - Test B-03: with `RECOVERY_LEDGER_FORCE_FILE_STORE=1` (D-25) → keyring is NEVER probed (mock Entry.setPassword spy assertion); storage-mode cache contains `'file'`.
    - Test B-04: Pitfall F — `setPassword` succeeds but `getPassword` returns mismatched blob → treat as fallback trigger, write to file, storage-mode = `'file'`.

    Errors (D-15, Pitfall A):
    - Test E-01: MSW returns 400 invalid_grant → `getValidAccessToken()` rejects with an instance of `AuthError` whose `.kind === 'refresh_failed'`.
    - Test E-02: a failed refresh does NOT retry (single retry budget = 0 per D-15). One POST hit, then reject.
    - Test E-03: the rejected `AuthError.message` does NOT contain the refresh-token or access-token string (defense-in-depth — verify sanitizer-friendly carrier).

    Cross-process safety (unit-level proxy for AUTH-05 cross-process half — full cross-process integration test ships in Plan 08):
    - Test L-01: `proper-lockfile.lock(...)` is called with `{retries: {retries: 10, factor: 1.2, minTimeout: 50}, stale: 5000}` (assert via spy on the imported `lockfile` module).
    - Test L-02: after acquiring the lock, tokens are re-read from storage BEFORE issuing the refresh POST (verifies the "sibling process may have refreshed" arm). Simulate by writing a fresh token to storage between lock-acquire and refresh-call.
  </behavior>
  <action>
    Create `src/infrastructure/whoop/token-store.ts`. Named exports only. Module-leading doc comment cites ADR-0002 §Decision (the three-layer gate) and ADR-0001 (no stdout). ~120 LOC target. Structure:

    1. Imports: `node:fs/promises` (`open`, `rename`, `stat`, `writeFile`, `readFile`, `mkdir`), `node:path`, `node:crypto` (NOT needed unless we hash blobs — skip), `proper-lockfile` (default import `import * as lockfile from 'proper-lockfile'`), `@napi-rs/keyring` (`import { Entry } from '@napi-rs/keyring'`), `zod` (`import { z } from 'zod'`), `../config/logger.js` (`import { logger } from '../config/logger.js'`), `../config/paths.js` (`import { paths as defaultPaths, type ResolvedPaths } from '../config/paths.js'`), `./errors.js` (`import { AuthError } from './errors.js'`).

    2. Constants:
       - `export const REFRESH_BUFFER_MS = 5 * 60 * 1000;` (D-14)
       - `export const WHOOP_TOKEN_URL = process.env.WHOOP_TOKEN_URL ?? 'https://api.prod.whoop.com/oauth/oauth2/token';`
       - `const KEYRING_SERVICE = 'recovery-ledger';`
       - `const KEYRING_ACCOUNT = 'whoop';`

    3. Types: `Tokens`, `StorageMode`, `TokenStoreOptions`, `TokenStore` per `<interfaces>` block above.

    4. Zod schema `TokenResponseSchema` per RESEARCH line 671-677 — `.passthrough()` per Pitfall J.

    5. Module-level state: `let inFlightRefresh: Promise<Tokens> | null = null;` — INSIDE the factory function `createTokenStore` so each factory call produces an isolated instance for tests. The exported singleton calls the factory once. ADR-0002 §Decision: every refresh path goes through ONE in-process gate; the singleton enforces it in production.

    6. `createTokenStore(opts: TokenStoreOptions = {}): TokenStore` — pure factory:
       - Resolves `paths`, `now`, `fetch`, `forceFileStore` from opts with defaults.
       - Closes over its own `inFlightRefresh` variable.
       - Returns `{ getValidAccessToken, read, write, clear, readStorageMode }`.

    7. `getValidAccessToken()`:
       - Read current tokens via `read()`.
       - If present and `tokens.expiresAt > now() + REFRESH_BUFFER_MS` → return `tokens.accessToken`.
       - Else: GATE 1 — if `inFlightRefresh === null`, set it to `doRefresh(currentTokens).finally(() => { inFlightRefresh = null })`. Either way, `await inFlightRefresh` and return `.accessToken`.

    8. `doRefresh(stale: Tokens | null)`:
       - GATE 2: `const release = await lockfile.lock(paths.tokensLockFile, {retries: {retries: 10, factor: 1.2, minTimeout: 50}, stale: 5000})`. If `tokensLockFile` doesn't exist, `mkdir` configDir (idempotent) and touch the lockfile via `writeFile(paths.tokensLockFile, '', {flag: 'a'})` first.
       - try-finally: in `try`, re-read tokens. If now fresh (sibling refreshed) → return them. Else POST to `WHOOP_TOKEN_URL` with form-urlencoded body. Parse response with Zod. Compute `expiresAt = obtainedAt + parsed.expires_in * 1000` where `obtainedAt` was captured BEFORE the fetch (Pitfall §Anti-patterns line 524). On non-2xx: `throw new AuthError({kind: 'refresh_failed', detail: \`token endpoint ${res.status}\`})` — NEVER inline body text.
       - GATE 3 (atomic write): call `write(next)` which dispatches keyring or file per `storage-mode` cache.
       - In `finally`: `await release()`.

    9. `write(tokens)`: backend selection logic. If `forceFileStore` (from opts or env), skip keyring. Else try `new Entry(KEYRING_SERVICE, KEYRING_ACCOUNT).setPassword(JSON.stringify(tokens))`; on throw OR if getPassword roundtrip mismatches (Pitfall F), fall through. File path: `open(paths.tokensFile + '.tmp', 'w', 0o600)` → `fd.writeFile(blob)` → `fd.sync()` → `fd.close()` → `rename(tmp, paths.tokensFile)`. Then write `paths.storageModeFile` with the chosen mode string + newline (also via temp-rename for atomicity, mode 0o600).

    10. `read()`: consult storage-mode cache. If `'keychain'`, `Entry.getPassword()` → JSON.parse. If `'file'`, `readFile(paths.tokensFile, 'utf8')` → JSON.parse. If cache missing or read returns null/empty → return `null`. Validate via Zod (defense-in-depth — Pitfall J).

    11. `readStorageMode()`: `readFile(paths.storageModeFile, 'utf8')` → trim → cast. Returns `'keychain' | 'file' | null` (null on ENOENT). Consumed by Plan 06's `probeAuth`.

    12. `clear()`: best-effort delete tokens from whichever backend storage-mode indicates, plus delete the storage-mode cache file. Used by Plan 03's auth flow on state-mismatch / timeout.

    13. `export const tokenStore = createTokenStore();` — singleton bound at module load.

    14. Module-level `console.*` and `process.stdout.write` are forbidden (ADR-0001). Logger lines log structured fields only: `logger.warn({event: 'refresh_failed', status: res.status})` — never the body text or any token field.

    Create `src/infrastructure/whoop/token-store.test.ts`. Pattern from `src/cli/commands/doctor.test.ts` lines 46-87:
    - Per-test `vi.resetModules()` + `vi.doMock('@napi-rs/keyring', () => ({Entry: class { ... }}))` per RESEARCH line 1044-1057 — in-memory `Map<string,string>` backing the mock.
    - `beforeAll` / `afterAll` for the MSW server from `tests/helpers/msw-whoop-oauth.ts`.
    - `beforeEach` resets the MSW counter, creates a temp `RECOVERY_LEDGER_HOME` via `mkdtemp(tmpdir() + '/rl-')`, and dynamically imports `createTokenStore` with `paths: resolvePaths({RECOVERY_LEDGER_HOME: tmpDir, HOME: '/'})`.
    - `afterEach` `rm(tmpDir, {recursive: true, force: true})` and `vi.doUnmock('@napi-rs/keyring')`.
    - Test groups: `describe('single-flight concurrency')`, `describe('refresh trigger')`, `describe('atomic write')`, `describe('backend fallback')`, `describe('refresh errors')`, `describe('cross-process lock')` — covering the C/T/A/B/E/L tests in <behavior>.

    No `console.*` anywhere. No `process.stdout.write` anywhere.
  </action>
  <verify>
    <automated>npm run test -- --run src/infrastructure/whoop/token-store.test.ts</automated>
  </verify>
  <acceptance_criteria>
    - `src/infrastructure/whoop/token-store.ts` exists with exports `createTokenStore`, `tokenStore`, `REFRESH_BUFFER_MS`, `WHOOP_TOKEN_URL`, `Tokens` (type), `StorageMode`, `TokenStoreOptions`, `TokenStore` (interface). Grep `grep -cE '^export ' src/infrastructure/whoop/token-store.ts` returns >= 6.
    - The file imports `from 'proper-lockfile'` exactly once: `grep -nE "from 'proper-lockfile'" src/infrastructure/whoop/token-store.ts | wc -l` returns `1`.
    - The file imports `from '@napi-rs/keyring'` exactly once.
    - The string `oauth/oauth2/token` appears in this file (and ONLY in this file across `src/`): `grep -rEn "oauth/oauth2/token" src/ | grep -v 'token-store.ts' | wc -l` returns `0` (no other src file references the token endpoint — enforced by Plan 06's Gate E in the CI gates).
    - `grep -c '^export default' src/infrastructure/whoop/token-store.ts` returns `0`.
    - `grep -nE 'console\.(log|info|warn|error|debug|trace)' src/infrastructure/whoop/token-store.ts` returns no matches.
    - `grep -nE 'process\.stdout\.write' src/infrastructure/whoop/token-store.ts` returns no matches.
    - `grep -nE '\.retry|retries\s*:\s*\{' src/infrastructure/whoop/token-store.ts` shows the proper-lockfile options object with `retries: { retries: 10, factor: 1.2, minTimeout: 50 }` and `stale: 5000` literals.
    - `grep -nE 'REFRESH_BUFFER_MS\s*=\s*5\s*\*\s*60\s*\*\s*1000' src/infrastructure/whoop/token-store.ts` returns one match (D-14 constant).
    - `npm run test -- --run src/infrastructure/whoop/token-store.test.ts` exits 0 with at least 15 passing tests (C-01..03, T-01..03, A-01..02, B-01..04, E-01..03, L-01..02).
    - The 10-parallel concurrency test asserts `helper.getRefreshHitCount() === 1` AND `new Set(results).size === 1`.
    - `npm run lint` exits 0.
    - `bash scripts/ci-grep-gates.sh` exits 0.
  </acceptance_criteria>
  <done>
    token-store.ts ships with the three-layer ADR-0002 gate, dual backends with sticky storage-mode cache, atomic temp-and-rename write, AuthError throw on refresh failure. 15+ unit tests green. No stdout pollution. No console.* in the module.
  </done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| network → WHOOP token endpoint | refresh POST body contains refresh_token + client_secret; response contains new tokens — both directions are secret material |
| filesystem → tokens.json | tokens at rest; readable only by the user (mode 0600); a local attacker with shell access already owns the secret |
| filesystem → tokens.json.tmp | transient atomic-write temp file; same dir as tokens.json; mode 0600 from O_CREAT (Pattern 2) |
| OS keychain (libsecret / macOS Keychain) | primary backend; opaque to us; we trust the OS surface (D-04 + ADR-0002) |
| process.env.RECOVERY_LEDGER_FORCE_FILE_STORE | test-only override; production never sets it; if set in production, file backend is chosen (D-25) — acceptable |
| process.env.WHOOP_TOKEN_URL | test-only override (D-23.2 cross-process integration test); production never sets it |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-02.02-01 | Repudiation / DoS | concurrent refresh race | mitigate | ADR-0002 three-layer gate — in-process Promise (line 364-367 of token-store.ts) + proper-lockfile (paths.tokensLockFile, retries 10×factor 1.2×minTimeout 50, stale 5000) + atomic write. Test C-01..03 verify exactly-one POST under 10-parallel load. ASVS V11. |
| T-02.02-02 | Information Disclosure | refresh-token / access-token in stack traces | mitigate | Never inline body text into AuthError.detail (we use `\`token endpoint ${status}\`` — status only). Pino logs structured fields only — never `logger.warn({body: res.text()})`. Errors flow through Phase 1's sanitize.ts via register.ts on the MCP side. ASVS V7. |
| T-02.02-03 | Information Disclosure | tokens.json readable by other local users | mitigate | `open(tokensFile.tmp, 'w', 0o600)` forces mode 0o600 at create-time per Pitfall D — `writeFile({mode: 0o600})` only sets mode on create which is insufficient. Test A-01 asserts stat returns mode 0o600. ASVS V8. |
| T-02.02-04 | Tampering | partial write from crash | mitigate | Atomic temp-and-rename with fsync. `fd.sync()` before rename forces the write to disk so a crash mid-rename leaves either the old file or the new file — never a partial write. Same-dir rename (Pitfall D) ensures atomicity (rename is atomic only within one filesystem). ASVS V8. |
| T-02.02-05 | DoS | stale lock from crashed process | mitigate | `stale: 5000` in proper-lockfile options — after 5s without mtime refresh, the lock is considered abandoned. proper-lockfile's mtime-refresh discipline + 5000ms stale window keeps Phase 2 within the doctor's deferred-WHOOP-roundtrip budget. ASVS V11. |
| T-02.02-06 | Information Disclosure | tokens written to SQLite | mitigate | Tokens NEVER reach SQLite — token-store.ts writes to keyring or `tokens.json` only. PITFALLS Pitfall 4 / ADR-0002. The doctor's `auth` check (Plan 06) reads from `storage-mode` cache and never from a DB. ASVS V8. |
| T-02.02-07 | Spoofing / DoS | backend flipping mid-session (Pitfall E) | mitigate | Backend selection cached in `storage-mode` file at first write; subsequent reads consult the cache. Test B-04 verifies Pitfall F defense-in-depth: setPassword success but getPassword mismatch → fall back to file + update cache. ASVS V8. |
| T-02.02-08 | Tampering / Spoofing | hostile WHOOP response shape | mitigate | Zod parse via `TokenResponseSchema.passthrough()` (RESEARCH Pitfall J). On parse failure, throw `AuthError({kind: 'refresh_failed', cause: zodError.issues})` — issues are field names + types, never raw token material. ASVS V5. |
| T-02.02-09 | Repudiation | failed refresh retried, burning the family | mitigate | Retry budget on refresh = 0 (D-15 + STACK.md §Token refresh point 4). On non-2xx, throw immediately. Test E-02 asserts exactly one POST hit then reject. ASVS V11. |
| T-02.02-10 | Information Disclosure | OAuth callback URL in logs (Pitfall C) | mitigate | logger.debug logs structured fields only `{event, state, hasCode}`, never the raw URL. token-store.ts has no callback-URL handling (oauth.ts owns that — Plan 03) but still must not log refresh body text. ASVS V7. |
</threat_model>

<verification>
- `src/infrastructure/whoop/token-store.ts` exists and is the ONLY file under `src/` containing the literal `oauth/oauth2/token`.
- `npm run test -- --run src/infrastructure/whoop/token-store.test.ts` exits 0 with >= 15 tests.
- The 10-parallel concurrency test asserts exactly one MSW hit and identical access-token strings for all 10 callers.
- `npm run lint` exits 0; `bash scripts/ci-grep-gates.sh` exits 0.
- `grep -rEn 'oauth/oauth2/token' src/ | grep -v 'token-store.ts'` returns no matches (precondition for Plan 06's Gate E to pass).
</verification>

<success_criteria>
- AUTH-05 unit-half (D-23.1, D-24) is satisfied: 10 parallel callers → exactly one refresh POST → same access token returned to all 10.
- AUTH-03 backend split works: keychain primary, file fallback on Entry.setPassword throw or Pitfall F mismatch; storage-mode cached.
- AUTH-04 refresh trigger fires at 5-min preemptive and on a 401 — note: 401-reactive retry is wired in Plan 04's refresh-orchestrator + WHOOP HTTP client (Phase 3 owns the 401-reactive path; Plan 04 wires it where the orchestrator decides when to call `getValidAccessToken()` again).
- token-store.ts is the SINGLE consumer of WHOOP_TOKEN_URL across `src/` (Gate E will enforce in Plan 06).
- Plans 03/04/05/06 can `import { tokenStore, createTokenStore, REFRESH_BUFFER_MS, type Tokens }` without further changes.
</success_criteria>

<output>
After completion, create `.planning/phases/02-oauth-token-store-single-flight-refresh/02-02-SUMMARY.md`.
</output>
