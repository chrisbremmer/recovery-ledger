---
phase: 02-oauth-token-store-single-flight-refresh
reviewed: 2026-05-12T16:50:00Z
depth: standard
files_reviewed: 35
files_reviewed_list:
  - .github/workflows/ci.yml
  - scripts/ci-grep-gates.sh
  - src/cli/commands/auth.test.ts
  - src/cli/commands/auth.ts
  - src/cli/commands/init.test.ts
  - src/cli/commands/init.ts
  - src/cli/index.ts
  - src/infrastructure/config/paths.test.ts
  - src/infrastructure/config/paths.ts
  - src/infrastructure/config/schema.test.ts
  - src/infrastructure/config/schema.ts
  - src/infrastructure/whoop/errors.test.ts
  - src/infrastructure/whoop/errors.ts
  - src/infrastructure/whoop/oauth.test.ts
  - src/infrastructure/whoop/oauth.ts
  - src/infrastructure/whoop/token-store.test.ts
  - src/infrastructure/whoop/token-store.ts
  - src/mcp/sanitize.test.ts
  - src/services/doctor/checks/auth.test.ts
  - src/services/doctor/checks/auth.ts
  - src/services/doctor/checks/check-names.ts
  - src/services/doctor/checks/token-freshness.test.ts
  - src/services/doctor/checks/token-freshness.ts
  - src/services/doctor/index.test.ts
  - src/services/doctor/index.ts
  - src/services/index.ts
  - src/services/refresh-orchestrator.test.ts
  - src/services/refresh-orchestrator.ts
  - test/fixtures/oauth/authorize-callback-state-mismatch.html
  - test/fixtures/oauth/token-200.json
  - test/fixtures/oauth/token-400-invalid-grant.json
  - tests/helpers/msw-whoop-oauth.ts
  - tests/integration/auth-concurrency.test.ts
  - tests/integration/helpers/child-get-token.mjs
findings:
  critical: 4
  warning: 11
  info: 6
  total: 21
status: issues_found
---

# Phase 2: Code Review Report

**Reviewed:** 2026-05-12T16:50:00Z
**Depth:** standard
**Files Reviewed:** 35
**Status:** issues_found

## Summary

Phase 2 implements OAuth Authorization-Code flow, the load-bearing token store
with the three-layer single-flight refresh gate from ADR-0002, a 401-reactive
refresh orchestrator, the `init` / `auth` CLI shims, two new offline-safe doctor
probes, and a cross-process integration test. The architecture broadly matches
the ADRs — three layers are present in `token-store.ts`, the OAuth callback
server binds to `127.0.0.1` only, the refresh endpoint is the sole `POST` to
WHOOP, and the sanitizer covers OAuth-specific leak shapes.

However, four BLOCKERs in the refresh path threaten the load-bearing
single-flight contract:

1. The token-store passes the **stale** token (read outside the lock) to the
   refresh endpoint when a fresher token already exists on disk, which is
   exactly the WHOOP token-family-revocation scenario ADR-0002 was written to
   prevent.
2. The token-store hardcodes `scope: 'offline'` on refresh, silently narrowing
   any user who originally granted broader scopes.
3. The orchestrator's post-401 re-read uses a plain `> Date.now()` check
   without the `REFRESH_BUFFER_MS` buffer, so it can hand back a token that
   expires in seconds and burn the retry budget on an immediate second 401.
4. `runAuthCommand`'s outer non-AuthError catch invokes `String(err)` on a
   `ZodError` thrown by `ConfigSchema.parse` — Zod error messages embed
   parsed values (including `clientSecret`) and the CLI prints them to
   stdout without sanitization.

Eleven WARNINGs cover defense-in-depth gaps: HTTP method/path checks on the
loopback callback, the `read()` throw paths inside the lock, the test
harness's lock-mock that does not exercise real `proper-lockfile` semantics,
and a build-race risk in the integration test. See sections below for
specifics.

## Critical Issues

### CR-01: `doRefresh` sends the OLD stale refresh_token when a sibling has already refreshed

**File:** `src/infrastructure/whoop/token-store.ts:273`
**Issue:** Inside the cross-process lock, `doRefresh` re-reads the current
on-disk tokens into `fresh`. If `fresh` is non-null but still within the
5-minute refresh buffer (sibling refreshed but the new token also needs to
roll over soon, OR the sibling's response had a short `expires_in`), the code
falls through to `callRefreshEndpoint(stale ?? fresh)`. The nullish
coalescing prefers `stale` (the pre-lock snapshot) over `fresh` (the post-lock
on-disk value). `stale.refreshToken` is exactly the token a sibling has just
consumed; presenting it to WHOOP triggers the token-family revocation that
ADR-0002 was authored to prevent. The whole three-layer gate exists to avoid
this exact code path.

The CR-02-mitigated invariant ADR-0002 §Context describes — "WHOOP treats
reuse of a stale refresh token as a security event: it revokes the entire
token family" — is broken by this single line.

**Fix:**
```ts
// Prefer the freshest on-disk refresh_token. `fresh` carries any sibling's
// rotated refresh token; `stale` is the pre-lock snapshot and may already be
// invalidated by the sibling's successful refresh.
const next = await callRefreshEndpoint(fresh ?? stale);
```

Add a regression test: seed an "expired-but-rotated" pair via
`installLockfileMock({ onLockAcquired: ... })` so the sibling-replacement
token is also near-expired, then assert `callRefreshEndpoint` receives the
NEW refresh_token, not the original stale one.

---

### CR-02: Refresh request hardcodes `scope: 'offline'`, silently narrowing the token's scope

**File:** `src/infrastructure/whoop/token-store.ts:292`
**Issue:** The refresh POST body sets `scope: 'offline'` verbatim, discarding
the seven scopes the user granted at `init` time (`offline read:recovery
read:sleep read:workout read:cycles read:profile read:body_measurement`). Per
RFC 6749 §6, sending a narrower `scope` parameter on refresh asks the AS to
issue a token with that narrower scope. After the first refresh, the access
token would carry only `offline` — every `read:*` API call in Phase 3 onward
would 403. Per RFC, omitting `scope` retains the originally-granted scope.

This is also inconsistent with `exchangeCode` (oauth.ts:325-371) which does
NOT include `scope` in the auth-code-grant token-endpoint POST body
(correctly — the scope is in the authorize URL).

**Fix:** Either omit the `scope` parameter from the refresh body entirely
(RFC-compliant: retains original scope), or pass the stale token's scope
through:
```ts
const body = new URLSearchParams({
  grant_type: 'refresh_token',
  refresh_token: stale.refreshToken,
  client_id: creds.clientId,
  client_secret: creds.clientSecret,
  // Omit `scope` — RFC 6749 §6: AS retains originally-granted scope.
});
// OR if WHOOP requires explicit echo:
//   scope: stale.scope,
```

Add a contract test that asserts the post-refresh `Tokens.scope` matches the
originally-issued scope (currently the token-store test fixture's
`scope: 'offline read:recovery'` would surface this regression if pinned).

---

### CR-03: refresh-orchestrator's post-401 re-read uses no expiry buffer

**File:** `src/services/refresh-orchestrator.ts:95`
**Issue:** `if (current !== null && current.expiresAt > Date.now())` checks
only that the token has not yet expired. The token-store consistently uses
`> now() + REFRESH_BUFFER_MS` (5 min). The orchestrator's looser check means:
on a 401, if the sibling's "fresh" token expires in 30 seconds, the
orchestrator retries the operation with it; the operation takes 31 seconds
(WHOOP latency + retry queue + …); a second 401 fires; per D-15 the retry
budget is exhausted; the caller gets a 401 response. Meanwhile the
orchestrator could have force-refreshed and produced a stable token.

Worse: the check is asymmetric with the token-store's `getValidAccessToken`
contract. `getValidAccessToken` is documented as returning a token fresh "by
our clock" (≥5min remaining). The orchestrator's fallback breaks that
invariant for the 401-recovery path.

**Fix:**
```ts
import { REFRESH_BUFFER_MS } from '../infrastructure/whoop/token-store.js';
// ...
if (current !== null && current.expiresAt > Date.now() + REFRESH_BUFFER_MS) {
  // Sibling refreshed our way out — retry with current.accessToken.
  return operation(current.accessToken);
}
```

Add a test: seed `read()` to return a near-expiry (delta = 30s) token after
the 401; assert the orchestrator does NOT use it and instead force-refreshes
via `getValidAccessToken`.

---

### CR-04: `runAuthCommand` leaks `clientSecret` through `String(ZodError)` on config-parse failure

**File:** `src/cli/commands/auth.ts:60` and `:104`
**Issue:** `ConfigSchema.parse(JSON.parse(configText))` throws a `ZodError`
when `config.json` is corrupt (anything other than ENOENT). The ZodError is
not an AuthError, so `isAuthErrorShape(err)` returns false and the outer arm
runs `process.stdout.write(\`auth failed: ${String(err)}\\n\`)`. Zod's default
error formatter embeds the offending values verbatim — including
`clientSecret`, `clientId`, and any other field that fails validation. For
example, if `clientSecret` is `""` (empty) the ZodError reads roughly:
`"clientSecret": String must contain at least 1 character(s), got ''"`. With a
non-empty-but-wrong type the value is rendered.

The CLI is not routed through the MCP sanitizer (ADR-0001 voice in `init.ts`
comments confirms this), so the `clientSecret` value lands on the user's
terminal verbatim. A user pasting their terminal output into a bug report or
agent context leaks the secret. The `init.ts` analog has the same shape
(line 115) but is mitigated by the explicit field-name-only branch at
line 95 — `auth.ts` has no such pre-filter for parse errors.

**Fix:** Wrap the `ConfigSchema.parse` call in a try/catch and map ZodError to
an explicit `auth_missing` (or new `invalid_config`) AuthError with a
field-name-only detail, mirroring `init.ts:94`:
```ts
let config: InitConfig;
try {
  config = ConfigSchema.parse(JSON.parse(configText));
} catch (parseErr) {
  // Field names only — never echo values.
  const fields = parseErr instanceof z.ZodError
    ? parseErr.issues.map((i) => i.path.join('.')).join(', ')
    : 'unknown';
  process.stdout.write(
    `Invalid config (fields: ${fields}). Run \`recovery-ledger init\` to repair.\n`,
    () => process.exit(AUTH_EXIT_CODES.auth_missing),
  );
  return;
}
```

Additionally, the outer `String(err)` arm should run through the sanitizer
even for the CLI path — the cost is one import and Phase 2 already loads
`src/mcp/sanitize.js` from the OAuth module (oauth.ts:58), so the layering
constraint is already broken in this direction.

## Warnings

### WR-01: `listenForCallback` accepts any HTTP method on any path

**File:** `src/infrastructure/whoop/oauth.ts:191-302`
**Issue:** `handleCallback` parses `req.url` regardless of `req.method` or
path. A `POST /literally-anything?code=xxx&state=st` on `127.0.0.1:port`
during the 5-minute window resolves the OAuth flow. A local process scanner
that hits the loopback port (e.g., `curl http://127.0.0.1:4321/`) gets the
success page and the OAuth attempt resolves with whatever code/state pair the
attacker chose. The state-mismatch check is the only filter.

While the 256-bit `state` makes a guess-and-hit attack impractical, the
defense-in-depth posture should be: only `GET /callback` is honored; every
other method/path returns 404 without resolving the promise.

**Fix:**
```ts
const server = createServer((req, res) => {
  if (req.method !== 'GET') {
    res.writeHead(405, { 'content-type': 'text/plain' });
    res.end('method not allowed');
    return;
  }
  const url = new URL(req.url ?? '/', 'http://127.0.0.1');
  if (url.pathname !== '/callback') {
    res.writeHead(404, { 'content-type': 'text/plain' });
    res.end('not found');
    return;
  }
  handleCallback(req, res, opts.expectedState, finaliseResolve, finaliseReject);
});
```

---

### WR-02: `read()` inside the cross-process lock can throw and abort the refresh with the lock held

**File:** `src/infrastructure/whoop/token-store.ts:268`
**Issue:** `const fresh = await read()` is inside the `try` block guarded by
`finally { await release() }`, so the lock IS released — that part is sound.
But `read()` can throw `AuthError({ kind: 'refresh_failed', cause })` on
JSON-parse failure or Zod-validation failure (line 171). When that happens
inside the lock, the refresh attempt aborts and the caller sees
`refresh_failed`. If a sibling process wrote a partially-flushed file
(impossible with the atomic rename, BUT possible if an external tool — `cat
> tokens.json`, an editor save, a backup-restore — drops a malformed blob in
place), this surfaces as `refresh_failed` with no actionable detail. The
correct kind here is closer to `auth_missing` ("re-run init/auth to rebuild
the file from scratch") because the on-disk artifact is unrecoverable.

**Fix:** Either narrow `read()` to return `null` on parse failure (with a
`logger.warn` for diagnostic visibility), or wrap the inner `read()` call in
the lock with a try/catch that maps parse failures to a fresh-`null` and
forces a full refresh-from-stale-snapshot. The current behavior conflates
"can't read disk" with "WHOOP rejected the refresh."

---

### WR-03: storage-mode write races outside the refresh lock

**File:** `src/infrastructure/whoop/token-store.ts:220`
**Issue:** `await writeFileAtomic(resolvedPaths.storageModeFile, ...)` runs
inside `write()` which is called both from `doRefresh` (inside the lock) AND
directly from `runAuthCommand` (outside the lock). On the CLI auth-completion
path, `runAuthCommand` calls `tokenStore.write(tokens)` without acquiring the
refresh lock — so if the MCP server is mid-refresh during a fresh `auth`
run, both will write the storage-mode marker concurrently.

The atomic rename means readers never see a partial file, but the LAST
writer wins. If `auth` (file backend) and a parallel `doRefresh` (keychain
backend) overlap, the storage-mode marker could end up reflecting the
keychain mode while the actual tokens were written to file (or vice-versa).
Subsequent `read()` calls would use the wrong backend.

In practice this is hard to trigger (the user is unlikely to run `auth`
while the MCP server is mid-refresh), but the design intent of "single
source of truth for backend selection" is not enforced by the lock model.

**Fix:** Either acquire the lockfile in `write()` too, or document the
constraint that `write()` may only be called from `doRefresh` and route the
`auth` completion path through a separate `writeInitial()` that does acquire
the lock.

---

### WR-04: `paths.ts` module-load throws if neither HOME nor RECOVERY_LEDGER_HOME is set

**File:** `src/infrastructure/config/paths.ts:64`
**Issue:** `export const paths = resolvePaths(process.env)` runs at module
load. In a sandboxed CI container that has no HOME and the test setup forgets
to set RECOVERY_LEDGER_HOME, importing `paths.js` crashes the entire module
graph with `RECOVERY_LEDGER_HOME or HOME must be set`. The crash happens
before any test runner can catch and report it. The test harnesses in
`token-store.test.ts` and `auth.test.ts` set RECOVERY_LEDGER_HOME via env
before importing the consuming module, but the order is fragile — a refactor
that imports `paths.js` at the top of the test file would crash before
`beforeEach` runs.

This is also at odds with `paths.test.ts:42` ("throws when both HOME and
RECOVERY_LEDGER_HOME are undefined") — that test passes a literal env, so
the module-load throw is not exercised. The production singleton's behavior
under a missing-HOME environment is not verified.

**Fix:** Defer the singleton bind to a lazy getter so module load succeeds in
all environments, and the throw surfaces at the first `paths.X` access. Or
document the constraint and add a smoke test that imports the singleton
under an empty env to assert the failure mode is fast and clear.

---

### WR-05: lockfile mock skips the real `proper-lockfile` contention path

**File:** `src/infrastructure/whoop/token-store.test.ts:143-160`
**Issue:** Every token-store unit test installs a stubbed `proper-lockfile`
that succeeds immediately. The single-flight assertions (C-01..C-03) prove
the IN-PROCESS Promise gate works, but they do NOT prove the cross-process
gate works — the second layer of the three-layer contract is unverified at
unit scope. The L-01 / L-02 tests only assert the lock OPTIONS shape and
the post-lock re-read, not the actual lock blocking behavior.

The cross-process integration test (`tests/integration/auth-concurrency.test.ts`)
covers the real gate via forked children, but it depends on
`npm run build` succeeding and is gated behind `TEST_TIMEOUT_MS = 30s`.
A regression in the lock retry policy (e.g., a future change that drops
`retries: 10` to `retries: 0`) would slip past the unit suite.

**Fix:** Add at least one token-store unit test that uses the REAL
`proper-lockfile` against a tmpdir lock target, spawns two simultaneous
`doRefresh` calls (one with `setTimeout`-deferred release), and asserts the
second blocks until the first releases. Keep the mocked-lockfile tests for
contract-shape coverage.

---

### WR-06: Doctor probe `detail` strings emit untrusted `err.message` without sanitization (CLI path)

**File:** `src/services/doctor/checks/auth.ts:61`, `token-freshness.ts:96`
**Issue:** Both probes catch any thrown error and produce
`detail: \`probe threw: ${err.message ?? String(err)}\``. The MCP transport
sanitizes these via `register.ts`'s `sanitizeResult`, but the CLI
`runDoctorCommand` path does NOT — `process.stdout.write` emits the detail
verbatim. If `tokenStore.read()` throws a ZodError or an AuthError whose
detail/cause chain carries token material (the cause chain walker in
sanitize.ts handles this but is not invoked here), the CLI surface leaks.

This is a fairly thin attack surface (the only token-bearing errors in the
read path are ZodErrors from `StoredTokensSchema.parse`, which include the
token blob in the parse error's `received` field), but it's a real gap.

**Fix:** Route probe details through the shared sanitizer:
```ts
import { sanitize } from '../../../mcp/sanitize.js';
// ...
detail: `probe threw: ${sanitize(err instanceof Error ? err.message : String(err))}`,
```
Or — preferable per ADR-0001's "no cross-layer imports" voice — relocate
`sanitize` to `src/infrastructure/observability/` and import from there.
The relocation is already flagged as PLAN-03-CROSS-LAYER deferred work.

---

### WR-07: `runOAuth` race: `info.port` could differ from `opts.redirectPort` when port is 0

**File:** `src/infrastructure/whoop/oauth.ts:419-420`
**Issue:** `runOAuth` passes `opts.redirectPort` to `listenForCallback`, then
awaits the `listening` promise that resolves with the actual `info.port` (the
OS-assigned port when redirectPort is 0). The `redirectUri` is built from
`info.port`, which is correct. BUT the WHOOP developer-app's redirect URI is
registered for a SPECIFIC port (the one from `init` time, default 4321) —
if a test or power-user passes `redirectPort: 0`, the OS picks an arbitrary
port, the authorize URL embeds that port, WHOOP rejects with
`redirect_uri_mismatch`, and the test gets `refresh_failed: invalid_request`.

The runOAuth tests (R-01..R-03) use `redirectPort: 0` and bypass the WHOOP
URL constraint via the local mock. Production `auth.ts` passes
`config.redirectPort` (the user-chosen number), so this is not a runtime
correctness bug — but it means the tests do not exercise the production code
path. A regression that, say, builds the redirect_uri from
`opts.redirectPort` instead of `info.port` would only fail under live WHOOP.

**Fix:** Either pin the test to use a fixed port (e.g., spin up a sacrificial
server on a known port and pass that), or split the integration into two
tests: one that uses port 0 to exercise the local server, one that asserts
`buildAuthorizeUrl`'s `redirect_uri` matches `info.port` (not `redirectPort`).

---

### WR-08: `auth-concurrency.test.ts` runs `npm run build` inside `beforeAll`

**File:** `tests/integration/auth-concurrency.test.ts:366`
**Issue:** The test's `beforeAll` runs `await execAsync('npm run build', { cwd: REPO_ROOT })`. Vitest's `pool: 'forks'` parallelizes test files; if any
other test file runs simultaneously and also depends on `dist/` (e.g., the
Phase 1 `mcp-stdout-purity.test.ts`), the two builds race and one may see a
half-written `dist/` tree.

Worse: the build mutates the workspace. A developer running this test file
alone with Vitest watch mode triggers a full rebuild on every save, which
can take 5-10 seconds. The test budget is 30s/test; the actual budget for
the assertions is half that.

The PLAN comments call this out as "checker WARNING PLAN-08-BUILD-DEP" but
the resolution was to ship the build dep in the test rather than precompile
it as a CI step.

**Fix:** Move the build to a CI step that precedes the test run (the CI
workflow already does `npm run build` before `npm run test`), and replace
the `beforeAll` build with a simple `existsSync` precondition that fails
loudly if the user forgot to build:
```ts
beforeAll(() => {
  if (!existsSync(BUILD_OUTPUT_PATH) || !existsSync(DIST_MCP)) {
    throw new Error('run `npm run build` before this test');
  }
  // ... start mock server
});
```

---

### WR-09: `child-get-token.mjs` exits with stale stdout buffer on `process.exit(0)`

**File:** `tests/integration/helpers/child-get-token.mjs:29-30`
**Issue:** `process.stdout.write(...)` followed immediately by
`process.exit(0)` does not guarantee the stdout buffer is flushed before
exit. On macOS Node 22 with `silent: true` IPC pipes, the parent's
`child.stdout.on('data')` listener may receive an empty buffer if the child
exits before the kernel drains the pipe. The integration test asserts
`parseChildStdout(r.stdout)` is non-null (line 444) and would flake on this
race. The current default behavior of Node when stdout is piped (not a TTY)
is usually fully buffered, but the timing is implementation-dependent.

**Fix:** Either await stdout drain explicitly:
```js
process.stdout.write(`${JSON.stringify(...)}\n`, () => process.exit(0));
```
or use the same callback pattern the CLI commands use. The `auth.ts` and
`init.ts` shims already do this; the integration helper should mirror.

---

### WR-10: Sanitize test `Test 9` asserts `JSON.stringify(AuthError)` doesn't leak `cause.message` — relying on Error's default toJSON

**File:** `src/infrastructure/whoop/errors.test.ts:27-35`
**Issue:** The test pins that `JSON.stringify(err)` returns `"{}"` because
`Error.prototype.toJSON` is undefined by default. But this is a "fragile by
design" contract — any future ES Error change, any polyfill that adds
`toJSON`, or any framework (e.g., a pino transport) that intercepts the
serialization would invalidate the test silently. The real defense is the
sanitizer pipeline, not the absence of `toJSON`.

**Fix:** Strengthen the test to assert behavior under the actual production
path: serialize via `serializeError(err)` (the sanitizer's cause walker) and
assert the cause message IS emitted (because the walker reads it) AND that
running through `sanitize()` then redacts it. This pins the layered defense
rather than relying on a JS default that may change.

---

### WR-11: AuthError `cause: undefined` round-trip is uncovered

**File:** `src/infrastructure/whoop/errors.ts:49`
**Issue:** The Error constructor conditional
`init.cause === undefined ? undefined : { cause: init.cause }` correctly
avoids synthesizing `{ cause: undefined }`. But no test asserts that
`new AuthError({ kind: 'auth_missing' }).cause === undefined` (vs.
the alternate Error constructor behavior where it would be defined-but-null).
A future Node version that materializes the option differently would silently
break the sanitizer's cause-walker behavior (the walker checks `err.cause`
truthiness; a `{ cause: undefined }` literal vs. no cause produce identical
behavior, but a `{ cause: null }` would not). Add a pin.

**Fix:**
```ts
test('AuthError without cause has no own `cause` property', () => {
  const err = new AuthError({ kind: 'auth_missing' });
  expect('cause' in err).toBe(false);
});
```

## Info

### IN-01: Dead import in auth-concurrency.test.ts

**File:** `tests/integration/auth-concurrency.test.ts:39`
**Issue:** `import { ..., type ChildProcess, ... } from 'node:child_process'`
imports `ChildProcess` which is never referenced. Biome's unused-import rule
should catch this, but the type-only import bypasses the production-code
lint.

**Fix:** Remove `type ChildProcess` from the import.

---

### IN-02: `INIT_EXIT_CODES` / `AUTH_EXIT_CODES` typed as `Record<string, number>`

**File:** `src/cli/commands/auth.ts:31`, `src/cli/commands/init.ts:28`
**Issue:** Both maps are `Readonly<Record<string, number>>` — accepts any
string key. A typo `auth_state_mismatch` → `auth_state_mismacth` in
`AUTH_EXIT_CODES` would compile and fall through to the `?? 1` default at
line 96. The discriminated union `AuthErrorKind` exists; use it.

**Fix:**
```ts
export const AUTH_EXIT_CODES: Readonly<Record<AuthErrorKind | 'success', number>> =
  Object.freeze({ /* ... */ });
```
Will surface missing kinds and typos at compile time.

---

### IN-03: Test grep-asserts on `z.object(` are brittle

**File:** `src/cli/commands/auth.test.ts:265`, `init.test.ts:225`
**Issue:** Tests A-10 / I-10 grep the source for the literal string
`z.object(` to enforce the DRY-fix. A future refactor that uses
`z.strictObject(`, extends the schema via `.merge()`, or imports a
pre-built helper would silently pass without satisfying the DRY intent.

**Fix:** Assert positively on the IMPORT (already done) and drop the
negative grep, OR pin the schema identity:
```ts
const { ConfigSchema: shimSchema } = await import('./auth.js');
const { ConfigSchema: canonical } = await import('../../infrastructure/config/schema.js');
expect(shimSchema).toBe(canonical);
```

---

### IN-04: `oauth.ts` `printAuthorizeUrlToStderr` is reached when caller passes `noBrowser: false` without `openBrowser`

**File:** `src/infrastructure/whoop/oauth.ts:430`
**Issue:** `if (opts.noBrowser === true || opts.openBrowser === undefined)`
also fires when a caller passes `{ noBrowser: false }` and forgets to pass
`openBrowser`. The current `auth.ts` shim handles this correctly (passes
`openBrowser` only when `noBrowser !== true`), so production is safe. But
the condition allows a subtle caller bug (`{ noBrowser: false }` not opening
the browser) without surfacing.

**Fix:** Make the precondition explicit:
```ts
if (opts.noBrowser === true) {
  printAuthorizeUrlToStderr(authorizeUrl);
} else if (opts.openBrowser === undefined) {
  // Defensive: caller asked for browser-open but supplied no opener.
  // Fall back to stderr-print AND log a warning so the bug surfaces.
  logger.warn({ event: 'no_browser_opener_supplied' });
  printAuthorizeUrlToStderr(authorizeUrl);
} else {
  // ... try openBrowser
}
```

---

### IN-05: `D02_INSTRUCTIONS` joins scopes with space — no defense if `D13_SCOPES` is mutated

**File:** `src/cli/commands/init.ts:41`
**Issue:** The instructions string interpolates `D13_SCOPES.join(' ')`.
`D13_SCOPES` is frozen so direct mutation is impossible, but a future
refactor that swaps the export for a non-frozen array would silently break
the deterministic-output contract. Test I-04 catches this by asserting the
exact join. Fine; just noting the dependency chain.

**Fix:** None required; surface the dependency in a code comment near the
`Object.freeze(...)` call.

---

### IN-06: Storage-mode file is rewritten on every refresh even when the mode hasn't changed

**File:** `src/infrastructure/whoop/token-store.ts:220`
**Issue:** Every `write()` call unconditionally writes the storage-mode
marker, even when the cached mode is already what we'd write. Wastes an
fsync + rename per refresh (~hourly). Not load-bearing, but the comment at
line 144 ("never probe the backend twice in one session") suggests the
author wanted to avoid this kind of churn.

**Fix:** Skip the rewrite when `cachedMode === mode`. Trivial:
```ts
if (cachedMode !== mode) {
  await writeFileAtomic(resolvedPaths.storageModeFile, `${mode}\n`);
  cachedMode = mode;
}
```

---

_Reviewed: 2026-05-12T16:50:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
