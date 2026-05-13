---
phase: 02-oauth-token-store-single-flight-refresh
fixed_at: 2026-05-13T00:03:09Z
review_path: .planning/phases/02-oauth-token-store-single-flight-refresh/02-REVIEW.md
iteration: 1
findings_in_scope: 15
fixed: 15
skipped: 0
status: all_fixed
---

# Phase 02: Code Review Fix Report

**Fixed at:** 2026-05-13T00:03:09Z
**Source review:** `.planning/phases/02-oauth-token-store-single-flight-refresh/02-REVIEW.md`
**Iteration:** 1

**Summary:**
- Findings in scope (critical + warning): 15
- Fixed: 15
- Skipped: 0

All four critical findings — the load-bearing failures ADRs 0001/0002/0007 were
written to prevent — are addressed with source fixes plus pinning regression
tests. All eleven warnings are addressed with either source fixes or pinning
tests. 255/255 tests pass; lint and all five CI grep gates remain green.

Verification per fix: re-read modified files (Tier 1), `npm run test` on the
affected test files (Tier 2 — both syntax AND behavioral semantic check), and
`npm run lint` + `bash scripts/ci-grep-gates.sh` after every commit. The full
test suite was re-run after each fix to surface cross-file regressions; no
finding produced one.

## Fixed Issues

### CR-01: `doRefresh` sends the OLD stale refresh_token when a sibling has already refreshed

**Files modified:** `src/infrastructure/whoop/token-store.ts`, `src/infrastructure/whoop/token-store.test.ts`, `tests/helpers/msw-whoop-oauth.ts`
**Commit:** `a8566b5`
**Applied fix:** Changed `callRefreshEndpoint(stale ?? fresh)` to
`callRefreshEndpoint(fresh ?? stale)` so the freshest on-disk refresh_token
wins (the sibling-replaced token, not the pre-lock snapshot that WHOOP would
treat as token-family-revocation per ADR-0002 §Context). Extended the MSW
helper with `getLastRequestBody()` so a regression test can pin the
refresh_token value on the wire. Added test `L-03` exercising the
sibling-rotated-but-still-stale window (sibling refreshes during lock
acquisition AND the new token is also within REFRESH_BUFFER_MS).

### CR-02: Refresh request hardcodes `scope: 'offline'`, silently narrowing the token's scope

**Files modified:** `src/infrastructure/whoop/token-store.ts`, `src/infrastructure/whoop/token-store.test.ts`
**Commit:** `7a1cd82`
**Applied fix:** Removed `scope: 'offline'` from the refresh URLSearchParams
body. Per RFC 6749 §6, omitting `scope` tells the authorization server to
retain the originally-granted scope. Mirrors the behavior of `exchangeCode`
in oauth.ts (scope belongs in the authorize URL, not the refresh body).
Added tests `L-04` and `L-05` pinning that (a) no `scope` field appears on
the wire post-refresh, and (b) the round-trip Tokens.scope contains all
seven init-time read scopes.

### CR-03: refresh-orchestrator's post-401 re-read uses no expiry buffer

**Files modified:** `src/services/refresh-orchestrator.ts`, `src/services/refresh-orchestrator.test.ts`
**Commit:** `cea871a`
**Applied fix:** Imported `REFRESH_BUFFER_MS` from the token-store and
changed `current.expiresAt > Date.now()` to `current.expiresAt > Date.now() +
REFRESH_BUFFER_MS` in `callWithAuthImpl`. This makes the orchestrator's
post-401 re-read symmetric with `getValidAccessToken`'s preemptive-refresh
check; a sibling's near-expiry token (delta < 5 min) is no longer handed
back as the retry token (which would have produced a second 401 and
exhausted the D-15 retry budget). Added test `R-04` seeding a 30-second
delta and asserting the orchestrator force-refreshes instead of retrying
with the near-expiry token.

### CR-04: `runAuthCommand` leaks `clientSecret` through `String(ZodError)` on config-parse failure

**Files modified:** `src/cli/commands/auth.ts`, `src/cli/commands/auth.test.ts`
**Commit:** `bf4b6f3`
**Applied fix:** Wrapped `ConfigSchema.parse(JSON.parse(configText))` in a
try/catch. On `ZodError`, emit a field-names-only remediation message
(mirroring the existing pattern at `init.ts:94`) and exit with
`AUTH_EXIT_CODES.auth_missing` — without introducing a new AuthError kind
(the FROZEN 6-kind union is preserved). On non-Zod parse failures
(SyntaxError from `JSON.parse`), emit a generic "not valid JSON" message
without the raw error text. Additionally, routed the outer-catch
`String(err)` arm through the shared MCP `sanitize()` function as
defense-in-depth against any future non-AuthError shape carrying
secret-bearing strings. Cross-layer import precedent (`oauth.ts` already
imports from `src/mcp/sanitize.js`) is preserved; `PLAN-03-CROSS-LAYER`
relocation remains deferred work. Added tests `A-11` and `A-12` with
clearly-fingerprinted clientSecret and JSON-syntax-error inputs, asserting
the fingerprint never appears on stdout.

### WR-01: `listenForCallback` accepts any HTTP method on any path

**Files modified:** `src/infrastructure/whoop/oauth.ts`, `src/infrastructure/whoop/oauth.test.ts`
**Commit:** `de4d917`
**Applied fix:** Added a pre-handler dispatch in `listenForCallback`'s
`createServer` callback that returns 405 for non-GET methods and 404 for
paths other than `/callback`. Critically, the dispatch returns WITHOUT
calling `handleCallback`, so a non-conforming request cannot resolve the
OAuth promise — the state-mismatch check is no longer the sole filter. The
5-minute window stays open for a legitimate browser redirect. Added tests
`L-07` (POST /callback with valid code+state → 405, promise rejects with
auth_timeout) and `L-08` (GET /literally-anything?code=… → 404, promise
rejects with auth_timeout).

### WR-02: `read()` inside the cross-process lock can throw and abort the refresh

**Files modified:** `src/infrastructure/whoop/token-store.ts`, `src/infrastructure/whoop/token-store.test.ts`
**Commit:** `048011d`
**Applied fix:** Wrapped the post-lock `read()` call in a try/catch that
logs `tokens_reread_failed_inside_lock` and treats the result as null. The
subsequent `callRefreshEndpoint(fresh ?? stale)` falls through to the
pre-lock stale snapshot — a malformed on-disk blob (an editor save, a
backup-restore) no longer surfaces as `refresh_failed` ("WHOOP rejected the
refresh") when the actual failure mode is unrecoverable on-disk state. If
`stale` is also null, `callRefreshEndpoint` still throws `auth_missing`
("re-run init") which is the correct remediation. Added test `L-03b`
seeding a malformed blob via the `onLockAcquired` hook and asserting the
refresh succeeds via the stale snapshot.

### WR-03: storage-mode write races outside the refresh lock

**Files modified:** `src/infrastructure/whoop/token-store.ts`, `src/infrastructure/whoop/token-store.test.ts`
**Commit:** `c4cb1f4`
**Applied fix:** Split `write` into two functions: the public `write`
acquires the same cross-process lock the refresh path uses, then delegates
to `writeUnderLock` (internal). `doRefresh` calls `writeUnderLock` directly
(the lock is already held by its enclosing scope; re-entering would
deadlock). The CLI `auth` completion path now goes through `write`, so an
MCP-server mid-refresh and a `recovery-ledger auth` run cannot interleave
their storage-mode writes. Added test `L-03a` asserting
`tokenStore.write(tokens)` calls `lockfile.lock` with the same documented
options (retries 10, factor 1.2, minTimeout 50, stale 5000) the refresh
path uses.

### WR-04: `paths.ts` module-load throws if neither HOME nor RECOVERY_LEDGER_HOME is set

**Files modified:** `src/infrastructure/config/paths.ts`, `src/infrastructure/config/paths.test.ts`
**Commit:** `5e293aa`
**Applied fix:** Replaced the eager `export const paths =
resolvePaths(process.env)` with a Proxy that defers resolution to first
property access. Module load now always succeeds; the original
"HOME or RECOVERY_LEDGER_HOME must be set" throw still surfaces, just on
first `paths.X` access instead of at import time. This makes sandboxed
test environments self-healing — a test runner can repair the env in
`beforeEach` even after importing the consuming module. Added a regression
test under an empty-env arm that imports `./paths.js`, asserts the import
succeeds, then asserts the first property access produces the same throw.

### WR-05: lockfile mock skips the real `proper-lockfile` contention path

**Files modified:** `src/infrastructure/whoop/token-store.test.ts`
**Commits:** `355661e` (tests), `b774eb1` (biome format fix follow-up)
**Applied fix:** Added a `describe('real lockfile contention')` block at
the end of the test file with two tests that deliberately do NOT install
the lockfile mock. They use the real `proper-lockfile` against the tmpdir
the suite already creates, exercising the cross-process gate's
acquire+release cycle and asserting the `.lock` directory is cleaned up
after release. A regression that drops `retries: 10` or breaks the
release path would surface here at unit scope instead of relying on the
30s-budgeted Plan 02-08 integration suite.

### WR-06: Doctor probe `detail` strings emit untrusted `err.message` without sanitization (CLI path)

**Files modified:** `src/services/doctor/checks/auth.ts`, `src/services/doctor/checks/token-freshness.ts`
**Commit:** `78963d4`
**Applied fix:** Imported the shared MCP `sanitize` function in both probe
modules and wrapped the `err.message`/`String(err)` interpolation in the
catch arms with `sanitize(...)`. The MCP transport path already sanitized
via `register.ts`'s `sanitizeResult`; this closes the CLI gap where
`runDoctorCommand` emits probe detail strings via `process.stdout.write`
verbatim. Cross-layer import precedent (already established in
`oauth.ts` and now `auth.ts`) preserved; deferred relocation to
`src/infrastructure/observability/` is tracked as `PLAN-03-CROSS-LAYER`.

### WR-07: `runOAuth` race: `info.port` could differ from `opts.redirectPort` when port is 0

**Files modified:** `src/infrastructure/whoop/oauth.test.ts`
**Commit:** `56bdd6b`
**Applied fix:** Production code is already correct — `runOAuth` builds
`redirectUri` from `info.port` (the OS-assigned port), not from
`opts.redirectPort`. The gap was test-side: the existing R-01..R-03 tests
all use `redirectPort: 0` and didn't pin which port appeared in the
authorize URL. Added test `R-04` that explicitly asserts the
`redirect_uri` query parameter contains `:${ready.port}/callback` where
`ready.port` is the OS-assigned port (> 0), AND that the URL does NOT
contain `:0/callback`. A regression that builds redirect_uri from
`opts.redirectPort` would fail this test before reaching live WHOOP.

### WR-08: `auth-concurrency.test.ts` runs `npm run build` inside `beforeAll`

**Files modified:** `tests/integration/auth-concurrency.test.ts`
**Commit:** `45ea71f`
**Applied fix:** Replaced the `await execAsync('npm run build', ...)` call
in `beforeAll` with an `existsSync(BUILD_OUTPUT_PATH) &&
existsSync(DIST_MCP)` precondition that throws a clear message pointing at
`npm run build` if missing. CI's `.github/workflows/ci.yml` already runs
`npm run build` BEFORE `npm run test`, so the precondition is satisfied
in CI. Local developers running this test alone in watch mode no longer
trigger a 5–10s rebuild on every save (the test now runs in ~2s instead
of 5+ s). Removed now-unused imports: `exec`, `promisify`,
`execAsync`, and the previously-dead `type ChildProcess` (IN-01 dead
import — removed as a side-effect of cleaning up the `child_process`
imports). IN-01 was out of scope but its dead import would have produced
a lint error after the WR-08 cleanup, so it's resolved here.

### WR-09: `child-get-token.mjs` exits with stale stdout buffer on `process.exit(0)`

**Files modified:** `tests/integration/helpers/child-get-token.mjs`
**Commit:** `8e874cf`
**Applied fix:** Changed both `process.stdout.write(...) ;
process.exit(0)` and `process.stderr.write(...) ; process.exit(1)` to use
the callback form: `process.stdout.write(..., () => process.exit(0))`. The
write callback fires after the OS buffer drains, eliminating the
macOS/Node-22-with-silent-IPC race where `process.exit` could fire before
the pipe drained and the parent received an empty buffer. Mirrors the
pattern already used in `auth.ts` and `init.ts`.

### WR-10: Sanitize test `Test 9` asserts `JSON.stringify(AuthError)` doesn't leak `cause.message`

**Files modified:** `src/infrastructure/whoop/errors.test.ts`
**Commit:** `7b8dd3c`
**Applied fix:** Added `Test 9b` that pins the load-bearing layered defense
directly: `serializeError(err)` produces a string containing the cause's
`Authorization: Bearer ...` substring (the walker reads it — that's the
contract), AND running that string through `sanitize()` produces a string
containing `<redacted>` instead of the token bytes. The original `Test 9`
(JSON.stringify-returns-{}) is preserved as a secondary defense pin; the
new test is what would catch a future Error.toJSON polyfill or pino
transport that invalidates the JSON.stringify property.

### WR-11: AuthError `cause: undefined` round-trip is uncovered

**Files modified:** `src/infrastructure/whoop/errors.test.ts`
**Commit:** `153768c`
**Applied fix:** Added `Test 12` asserting `'cause' in err === false`
AND `err.cause === undefined` when no cause is supplied, pinning that
the constructor's conditional `init.cause === undefined ? undefined : {
cause: init.cause }` never synthesizes `{ cause: undefined }` as an own
property. Added `Test 13` as the mirror: when cause IS supplied,
`'cause' in err === true` and `err.cause === inner`. This pins both
arms of the AuthError serialization shape contract.

## Skipped Issues

_None — all 15 in-scope findings were applied successfully._

---

**Out-of-scope notes (info findings, IN-01..IN-06):** Not applied per the
`fix_scope: critical_warning` configuration. IN-01 (dead `type ChildProcess`
import) was incidentally resolved as part of the WR-08 cleanup since the
broader `child_process` import overhaul would have left a lint error
otherwise. IN-02..IN-06 remain as documented in the original REVIEW.md
findings for a future iteration.

_Fixed: 2026-05-13T00:03:09Z_
_Fixer: Claude (gsd-code-fixer)_
_Iteration: 1_
