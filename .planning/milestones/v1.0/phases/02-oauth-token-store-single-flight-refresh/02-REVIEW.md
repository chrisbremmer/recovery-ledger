---
phase: 02-oauth-token-store-single-flight-refresh
reviewed: 2026-05-12T19:00:00Z
depth: standard
pass: 2
prior_pass_commit: 6e31851
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
  critical: 0
  warning: 4
  info: 5
  total: 9
status: issues_found
---

# Phase 2: Code Review Report (Pass 2)

**Reviewed:** 2026-05-12T19:00:00Z
**Depth:** standard
**Pass:** 2 (re-review after fix commits `a8566b5..153768c`)
**Prior Pass Commit:** `6e31851` (4 critical, 11 warning, 6 info → 21 total)
**Files Reviewed:** 35
**Status:** issues_found (no NEW critical findings)

## Summary

**No NEW critical issues post-fix. All four pass-1 BLOCKERs are correctly
remediated. Phase 2 is in materially better shape than pass 1.**

I re-read all 34 source/test files (plus the CI workflow + grep gates) from a
clean starting point — not as a patch verifier, but as if encountering the code
for the first time. The single-flight refresh gate now correctly sends
`fresh ?? stale` (CR-01 fix at `token-store.ts:326`), the refresh body omits
`scope` (CR-02), the orchestrator's post-401 re-read applies
`REFRESH_BUFFER_MS` symmetrically (CR-03 at `refresh-orchestrator.ts:102`), and
the `runAuthCommand` ZodError path is intercepted before `String(err)` reaches
stdout (CR-04). The eleven WR fixes are also intact — the loopback callback
refuses non-GET/non-`/callback` traffic, the public `write()` now acquires the
cross-process lock, the `read()`-throws-inside-lock path falls through to the
pre-lock snapshot, `paths.ts` is a lazy Proxy that survives empty-env module
load, and the integration test fails fast on a missing build artifact instead
of racing the build.

Pass-2 findings that remain are all WARNINGS or INFO — defense-in-depth gaps,
test-coupling smells, and minor semantic concerns. None block phase exit.

**Fix verification:**

| Pass-1 ID | Status | Evidence |
|-----------|--------|----------|
| CR-01 (stale refresh_token sent post-lock) | FIXED | `token-store.ts:326` — `callRefreshEndpoint(fresh ?? stale)`. Test `L-03` pins the sibling-rotated case. |
| CR-02 (`scope: 'offline'` narrows grant) | FIXED | `token-store.ts:349-354` — `scope` param omitted from refresh body. Tests `L-04` / `L-05` pin both wire absence and round-trip scope preservation. |
| CR-03 (orchestrator skips `REFRESH_BUFFER_MS`) | FIXED | `refresh-orchestrator.ts:102` — `current.expiresAt > Date.now() + REFRESH_BUFFER_MS`. Test `R-04` pins the 30s-near-expiry case. |
| CR-04 (ZodError leaks `clientSecret` via `String(err)`) | FIXED | `auth.ts:77-91` — inner try/catch maps both `ZodError` and `SyntaxError` to a field-names-only remediation BEFORE the outer `String(err)` arm sees it. The outer arm now also routes through `sanitize()`. Tests `A-11` / `A-12` pin both shapes. |
| WR-01 (loopback accepts any method/path) | FIXED | `oauth.ts:202-219`. Tests `L-07` / `L-08`. |
| WR-02 (`read()` throw inside lock surfaces refresh_failed) | FIXED | `token-store.ts:307-314`. Test `L-03b`. |
| WR-03 (storage-mode write race outside lock) | FIXED | `token-store.ts:203-215` — public `write()` acquires the same lock as `doRefresh`. Test `L-03a`. |
| WR-04 (`paths` singleton throws at module load) | FIXED | `paths.ts:79-92` — lazy Proxy. Test in `paths.test.ts:45`. |
| WR-05 (real lockfile contention untested at unit scope) | PARTIAL | `token-store.test.ts:836-892` adds two real-lockfile tests, but see WR-A below — the in-process gate prevents real lock contention from being exercised. |
| WR-06 (probe error details leak to CLI unsanitized) | FIXED | `auth.ts:73`, `token-freshness.ts:100` — both route through `sanitize`. |
| WR-07 (`redirect_uri` built from `opts.redirectPort` not `info.port`) | FIXED | `oauth.ts:445-446`. Test `R-04`. |
| WR-08 (integration test races the build) | FIXED | `auth-concurrency.test.ts:367-377` — fast-fails on missing `BUILD_OUTPUT_PATH` / `DIST_MCP`. |
| WR-09 (child-helper stdout drain race) | FIXED | `child-get-token.mjs:34-37`. |
| WR-10 (Error.toJSON default is fragile) | FIXED | `errors.test.ts:38-57` — added test pinning the sanitizer pipeline as the load-bearing defense. |
| WR-11 (`{ cause: undefined }` synthesis) | FIXED | `errors.ts:49` — conditional spread. Tests in `errors.test.ts:64-85`. |

**ADR audits:**

- **ADR-0002 (three-layer single-flight refresh):** All three layers present. In-process Promise-gate (`token-store.ts:140`, cleared in `.finally`). Cross-process `proper-lockfile.lock` with documented options (`token-store.ts:288-291` for refresh, `:206-209` for write). Atomic temp-and-rename via `writeFileAtomic` with `fd.sync()` before `rename` (`:400-413`). The CR-01 fix correctly prefers the post-lock fresh refresh_token.
- **ADR-0001 (MCP stdout purity):** Verified no `console.*` outside `src/cli/**` and test files. `process.stdout.write` confined to `src/cli/commands/*.ts` (Gate C). All probe/service error details route through `sanitize`. The `auth.ts` ZodError path correctly intercepts before the outer sanitize-everything arm.
- **ADR-0007 (WHOOP read-only):** Two POSTs to the token endpoint (`token-store.ts:359-363`, `oauth.ts:367-371`); no PUT/PATCH/DELETE; no other POST destinations. Gate E enforces token-endpoint URL appears only in `token-store.ts`.
- **ADR-0006 (fixture-only tests):** MSW intercepts at every test file that uses the token endpoint. Integration test spawns children pointed at a local mock server bound to `127.0.0.1:0`. No live WHOOP traffic.

## Warnings

### WR-A: Real-lockfile tests `LR-01` / `LR-02` do not exercise cross-process contention they claim to test

**File:** `src/infrastructure/whoop/token-store.test.ts:836-892`
**Issue:** The describe block header says "ALL OTHER tests in this file mock
proper-lockfile. This describe block uses the REAL `proper-lockfile`... so a
regression in the lock retry policy (e.g., dropping `retries: 10` to
`retries: 0`) surfaces here at unit scope." The intent is sound, but the
implementation does not actually contend on the lock:

1. `LR-01` calls `store.getValidAccessToken()` twice in the SAME process /
   SAME `createTokenStore()` instance. The in-process `inFlightRefresh`
   Promise-gate (`token-store.ts:271`) intercepts the second call BEFORE
   `doRefresh` runs. Only ONE call ever reaches `proper-lockfile.lock`. The
   lock is acquired once, uncontended, released. Dropping `retries: 10` to
   `retries: 0` would NOT cause this test to fail.

2. `LR-02` calls `getValidAccessToken` once and then asserts the
   `<lockfile>.lock` directory doesn't exist post-call. That's a cleanup
   assertion, not a contention assertion.

A WR-05 regression in the retry policy (which is the stated detection
target) is observable only via the cross-process integration test
(`auth-concurrency.test.ts`), which is gated behind `npm run build`. The
unit-scope safety net the WR-05 fix promised is illusory.

**Fix:** Either (a) have one test spawn a worker_thread or child_process that
holds the real lock, then assert the parent's `proper-lockfile.lock` call
times out / retries the expected number of times, or (b) downgrade the
describe-block doc to "smoke-test that real proper-lockfile is wired and
acquire/release works in-process" and stop claiming it catches retry-policy
regressions.

### WR-B: `buildAuthorizeUrl` throws `AuthError({ kind: 'refresh_failed' })` for invalid clientId shape

**File:** `src/infrastructure/whoop/oauth.ts:163-165`
**Issue:** When the clientId fails the `CLIENT_ID_SHAPE` regex,
`buildAuthorizeUrl` throws `AuthError({kind: 'refresh_failed', detail:
'invalid clientId shape'})`. The `formatAuthError` switch maps that kind to
the user-facing message "Token refresh failed — run `recovery-ledger auth`
to re-authorize." That remediation is wrong — a malformed clientId in
config is fixed by `recovery-ledger init`, not by re-authorizing, and the
user has nothing to "refresh" yet (no tokens exist). The AuthErrorKind
union is FROZEN at six kinds, so the right kind for this path is probably
`auth_missing` ("re-run init") rather than `refresh_failed`. Even
better: this check is a defense-in-depth duplicate of the canonical
`ConfigSchema.parse` validation in `init.ts`; both schema and oauth.ts
enforce the same regex. The oauth.ts re-check is the second layer, so
when it fires the canonical schema has already let a bad value through —
which means the config on disk was edited by hand or the schema was
weakened. Either way, "Token refresh failed" is misdirection.

**Fix:** Switch the kind to `auth_missing` with a more specific detail
(`'invalid clientId in config; re-run recovery-ledger init'`). Or split a
new `config_invalid` kind off the union — but that breaks the FROZEN
constraint, which would require updating `formatAuthError`, the
`AUTH_EXIT_CODES` map, and the `recovery-ledger auth --help` block per the
documented MR-21 forcing-function discipline.

### WR-C: `auth.ts` outer `instanceof AuthError` was replaced by duck-typing; production graph never resets modules

**File:** `src/cli/commands/auth.ts:117-167`
**Issue:** The comment on lines 117-124 explains that `instanceof AuthError`
is "unreliable under Vitest's `vi.resetModules()` because two module-graph
instances of errors.ts produce different class identities." The fix is to
duck-type on `name === 'AuthError'` and `kind` in a set of six strings.
This works, but the trade-off was made to ease testing rather than to
strengthen production behavior — and the duck-type is strictly weaker than
`instanceof`:

- A test or future deserialization path that synthesizes
  `{ name: 'AuthError', kind: 'auth_missing' }` from JSON (NOT an actual
  `AuthError` instance) gets `formatAuthError(err as AuthError)` called on
  it. `formatAuthError` only reads `err.kind`, so this happens to work, but
  the type assertion is now load-bearing on duck-typing.
- The `AUTH_ERROR_KINDS` Set on line 155-162 duplicates the union from
  `errors.ts`. The MR-21 forcing function ("add a kind → break a switch
  somewhere") is degraded here: adding a kind only fails to compile in
  `formatAuthError`, not in `auth.ts`'s duck-type set.

The `refresh-orchestrator.test.ts:F-01` test handles the same problem by
dynamically importing AuthError AFTER `vi.resetModules()` to align class
identities (see lines 272-273). That's the production-honest pattern; the
auth.ts duck-type is a workaround.

**Fix:** Either (a) export an `isAuthError(err): err is AuthError` helper
from `errors.ts` that derives `AUTH_ERROR_KINDS` from the union's
type-keyof, so a new kind also lands in the duck-type set automatically; or
(b) align auth.test.ts with the refresh-orchestrator pattern (dynamic
import after resetModules) and switch auth.ts back to `instanceof`. Option
(a) preserves the test ergonomics; option (b) restores the
language-level invariant.

### WR-D: `writeUnderLock` leaves stale keychain blob when fallback path fires

**File:** `src/infrastructure/whoop/token-store.ts:243-249`
**Issue:** When `entry.setPassword(blob)` succeeds but the round-trip read
returns a mismatched blob (Pitfall F), or when `setPassword` throws, the
code falls back to `mode = 'file'` and writes the new blob to
`tokensFile`. The storage-mode marker correctly flips to `'file'`, so
subsequent `read()` calls go to the file backend. However, the previously-
written keychain entry (if any — i.e., not the Pitfall F case where the
write happened) is not deleted. If a later session reverts the
storage-mode marker (e.g., user manually edits, or a future bug toggles
it), the old keychain blob silently re-emerges with an arbitrary version
of the tokens.

Severity: low under current code (nothing toggles the marker), but the
defense-in-depth posture across the rest of this module argues for
symmetry — `clear()` deletes the keychain entry whenever the mode was
`'keychain'`, and `writeUnderLock` should similarly best-effort-delete the
keychain entry when falling back to file.

**Fix:** In the fallback arm (`mode === 'file'` after the keyring attempt),
best-effort-delete the keychain entry before writing the file:

```ts
if (mode === 'file' && !forceFile) {
  try { new Entry(KEYRING_SERVICE, KEYRING_ACCOUNT).deletePassword(); }
  catch { /* best-effort */ }
}
```

Skip the delete when `forceFile` is true (the user explicitly disabled
keyring) to avoid touching the keychain at all on D-25 paths.

## Info

### IN-01: Pass-1 `IN-01` (`runOAuth` busy-wait) is fixed incidentally; pass-1 `IN-02..IN-06` are stable

**Issue:** Pass-1 IN-01 (busy-wait in `runOAuth`) is gone — `runOAuth` uses
a `listening` Promise (`oauth.ts:428-431`) resolved by `onListening`. The
remaining pass-1 INFOs (IN-02 unused `seedExpiredKeyringToken` parameter,
IN-03 IPv6 binding consideration, etc.) are unchanged in this pass; none
are critical-adjacent given the four CR fixes.

### IN-02: `storageMode` is read by the child helper but discarded before parent assertion

**File:** `tests/integration/helpers/child-get-token.mjs:28`, `tests/integration/auth-concurrency.test.ts:452-454`
**Issue:** The child reads `tokenStore.readStorageMode()` and includes it
in the JSON line. The parent asserts `t?.storageMode === 'file'`. Good.
But the helper calls `readStorageMode()` AFTER `getValidAccessToken()`,
which means a refresh might have written the storage mode just before the
read. Currently fine (forceFileStore → mode is always `'file'`), but if
a future test inverts the force-flag, the assertion ordering matters.
Recommend reading both at the same logical instant or documenting the
ordering invariant.

### IN-03: `formatDuration(0)` returns `'0m'` — pin negative-input behavior is documented but not tested

**File:** `src/services/doctor/checks/token-freshness.ts:36-44`
**Issue:** The JSDoc says "Negative inputs are not exercised by the probe
(which always passes positive `ms`); callers that need to format an
elapsed expiry duration must pass `Math.abs(delta)` themselves." The probe
already does this on line 76 (`formatDuration(-delta)`). Worth adding a
test for `formatDuration(-1)` to pin the precondition: today it would
return `'-1m'` or `'0m'` depending on `Math.floor(-1 / 60_000) === -1` —
Node `Math.floor(-1/60_000)` is `-1`, so `formatDuration(-1) === '-1m'`,
which would render "expires in -1m" in the warn arm if a future caller
ever forgot the `Math.abs`. Cheap test, real defense.

### IN-04: The `services/index.ts` Services interface uses `typeof` of the singleton, not the function/object type

**File:** `src/services/index.ts:28-30`
**Issue:** `Services` is declared as `{ runDoctor: typeof runDoctor;
refreshOrchestrator: typeof refreshOrchestrator; }`. This works, but ties
the Services interface to the imported singleton's exact identity. A test
that wants to construct a Services instance with a mock `runDoctor` has to
match the imported function's signature exactly. It would be cleaner to
extract the function signature into a named type and use that —
particularly since Phase 3 will inject other singletons (DB, HTTP) and the
type drift will compound.

### IN-05: `auth.ts` `process.exit` callbacks are async-callback wrappers that swallow write errors

**File:** `src/cli/commands/auth.ts:62-67, 84-91, 113-116, 128-131, 140-143`
**Issue:** The pattern `process.stdout.write(msg, () => process.exit(N))`
is correct for the drain-before-exit invariant (per `child-get-token.mjs`
WR-09 fix), but the callback ignores the optional `Error` argument
Node passes for failed writes (e.g., broken pipe when piping through
`head`). On a broken pipe, the process would exit with code N anyway —
benign in practice — but the more defensive pattern is
`(err) => process.exit(err ? 1 : N)`. Not worth fixing alone; flag for a
future cleanup pass when CLI ergonomics get a second look.

---

_Reviewed: 2026-05-12T19:00:00Z_
_Reviewer: Claude (gsd-code-reviewer), pass 2_
_Depth: standard_
