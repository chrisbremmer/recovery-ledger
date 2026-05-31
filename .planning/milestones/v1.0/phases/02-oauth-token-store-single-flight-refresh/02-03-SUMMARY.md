---
phase: 02-oauth-token-store-single-flight-refresh
plan: 03
subsystem: infra
tags: [oauth, authorize-code, loopback, csrf-state, sanitize, error-policy, adr-0001, adr-0007]

# Dependency graph
requires:
  - phase: 02-oauth-token-store-single-flight-refresh
    provides: src/infrastructure/whoop/errors.ts (AuthError FROZEN at 6 kinds — incl. auth_port_in_use); src/infrastructure/whoop/token-store.ts (WHOOP_TOKEN_URL constant + type Tokens); src/infrastructure/config/schema.ts (D13_SCOPES — single source); tests/helpers/msw-whoop-oauth.ts; test/fixtures/oauth/token-200.json + token-400-invalid-grant.json + authorize-callback-state-mismatch.html
  - phase: 01-foundation-stdout-pure-mcp-bootstrap
    provides: src/mcp/sanitize.ts (sanitize() pure function — cross-layer import per ADR-0001 §Consequences); src/infrastructure/config/logger.ts (Pino stderr-only)
provides:
  - src/infrastructure/whoop/oauth.ts — buildAuthorizeUrl + listenForCallback + exchangeCode + runOAuth + WHOOP_AUTHORIZE_URL (9 named exports)
  - src/infrastructure/whoop/oauth.test.ts — 30 unit tests covering URL build (U-01..U-05), loopback (L-01..L-06), OAuth error-code policy (OE-01..OE-09 incl. BLOCKER 4 verbatim), code exchange (X-01..X-06), runOAuth (R-01..R-03), and a cleanup-on-repeat-rounds check
  - OAuth error-code response policy (BLOCKER 4 / OPEN-Q-01): RENDER for invalid_scope/invalid_request/unsupported_response_type; STRIP for server_error/access_denied/unauthorized_client/temporarily_unavailable/default
affects: [02-04-refresh-orchestrator (does NOT consume oauth.ts directly — refresh delegates to token-store), 02-05-cli-shims (auth.ts imports runOAuth + tokenStore.write), 02-06-doctor-extensions, 02-08-cross-process-integration]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "127.0.0.1-only loopback binding (NOT 0.0.0.0) — ASVS V9 + RESEARCH Threat Patterns; verified by Test L-06 reading the onListening callback's `address` field"
    - "Promise-based finalise() one-shot guard mirroring src/services/doctor/checks/mcp-stdout-purity.ts lines 126-168 — server.close() + clearTimeout() exactly once on resolve OR reject"
    - "OAuth error-code response policy split by code semantics: diagnosable codes (invalid_scope/invalid_request/unsupported_response_type) render error_description verbatim after sanitize+escapeHtml; opaque codes (server_error/access_denied/unauthorized_client/temporarily_unavailable) strip the description as defense-in-depth"
    - "Defense-in-depth on the render path: sanitize() always runs even for diagnosable error_descriptions (verified by Test OE-08 — a JWT-shaped substring inside error_description gets redacted)"
    - "Atomic capture of obtainedAt BEFORE the fetch (mirrors token-store.ts pattern from Anti-Patterns line 524) — a slow network does not push expiresAt past the actual token lifetime"

key-files:
  created:
    - src/infrastructure/whoop/oauth.ts
    - src/infrastructure/whoop/oauth.test.ts
  modified: []

key-decisions:
  - "errors.ts NOT mutated by this plan — checker BLOCKER 1 / Plan 02-01 contract preserved: AuthError union remains FROZEN at 6 kinds (auth_port_in_use was moved into Wave 0 in revision iteration 1 so Plan 02-02 and Plan 02-03 same-wave consumers share a stable errors.ts surface). Verified by `git diff --name-only HEAD~3..HEAD -- src/infrastructure/whoop/errors.ts` returning empty."
  - "REFACTOR phase replaced GREEN-phase busy-wait (`while (listenerInfo === null) { await setTimeout(5) }`) with a Promise that listenForCallback's `onListening` callback resolves once — listenForCallback's contract guarantees the callback fires exactly once before the server accepts requests, so the Promise shape is strictly cleaner. The GREEN-phase busy-wait was sound but the Promise shape eliminates a tiny scheduling-jitter window."
  - "MSW lifecycle: helper.server.listen({onUnhandledRequest: 'bypass'}) — NOT 'error' — because the runOAuth tests drive real fetch() against the loopback 127.0.0.1 server; MSW must pass those through. The token-endpoint URL is still the only intercepted destination because the helper only registers a handler for WHOOP_TOKEN_URL."
  - "Unhandled-rejection guard pattern: the OE-01..09 and L-02 tests wrap listenForCallback into a `.then(ok, err)` settled wrapper BEFORE awaiting any fetch — Vitest treats a rejection observed after a single tick gap as unhandled even when the caller will eventually `await` the original promise. The wrap-into-settled-promise pattern keeps the rejection 'handled' across the fetch round-trip without changing test semantics."
  - "PKCE OFF by default per A1/D-12/Pitfall I — WHOOP's PKCE support is unconfirmed. The `usePkce` flag threads challenge+verifier (S256) when set; the test suite covers both arms via U-02 (challenge absent) and U-03 (challenge present)."
  - "process.stderr.write is allowed for the --no-browser URL print arm — ADR-0001 §Decision forbids stdout writes, not stderr. The doc comment at the top of oauth.ts cites this verbatim."
  - "Cross-layer import of sanitize() from src/mcp/sanitize.js documented in the module-leading doc comment; ADR-0001 §Consequences endorses the one-sanitizer-cross-layer pattern. The plan-level note PLAN-03-CROSS-LAYER defers the cleaner refactor (move sanitize to src/infrastructure/observability/) to a later hardening pass."

patterns-established:
  - "Pattern: one-shot finalise() guard for HTTP-server-driven Promise resolution — `let settled = false` flag + `clearTimeout()` + `server.close()` + (resolve | reject) called exactly once. Mirrors mcp-stdout-purity.ts. Future modules that wrap node:http server lifecycles into a Promise should use the same shape."
  - "Pattern: settled-promise wrapper for unhandled-rejection guard in async tests — `const settled = promise.then((v) => ({ok: true, value: v}), (err) => ({ok: false, err}))` then `await settled` later. Eliminates Vitest unhandled-rejection warnings when a test does work between the rejection-source firing and the await."
  - "Pattern: error-code policy as a `Set<string>` constant (RENDERABLE_OAUTH_ERROR_CODES) + a boolean branch in the handler — a single edit to the Set narrows or widens the policy without touching the handler logic. Same shape as token-store.ts's SCOPES tuple."

requirements-completed: [AUTH-01, AUTH-02]

# Metrics
duration: 4m 28s
completed: 2026-05-12
---

# Phase 2 Plan 03: OAuth Round-Trip Summary

**Loopback Authorization-Code surface for `recovery-ledger auth`: buildAuthorizeUrl (D-13 scope + 256-bit state + URL-safe clientId validation) + listenForCallback (127.0.0.1-only loopback with D-09 verbatim HTML pages + D-10 timeout + EADDRINUSE → auth_port_in_use) + exchangeCode (POST to WHOOP_TOKEN_URL with form body + Zod passthrough) + runOAuth (full orchestration with --no-browser stderr fallback). OAuth error-code response policy (BLOCKER 4 / OPEN-Q-01): RENDER invalid_scope/invalid_request/unsupported_response_type error_description verbatim after sanitize+escapeHtml; STRIP server_error/access_denied/unauthorized_client/temporarily_unavailable/default. 30 unit tests green; errors.ts unchanged (FROZEN at 6 kinds).**

## Performance

- **Duration:** 4 min 28 sec
- **Started:** 2026-05-12T22:47:00Z (approx)
- **Completed:** 2026-05-12T22:51:28Z (approx)
- **Tasks:** 1 (TDD: RED → GREEN → REFACTOR)
- **Files modified:** 2 (both created — oauth.ts + oauth.test.ts)
- **Tests added:** 30 (U-01..U-05 + L-01..L-06 + OE-01..OE-09 + X-01..X-06 + R-01..R-03 + cleanup)
- **Total suite:** 144 → 174 tests across 13 → 14 files; all green

## Accomplishments

- Shipped the OAuth Authorization-Code surface — five named functions (buildAuthorizeUrl, listenForCallback, exchangeCode, runOAuth) plus WHOOP_AUTHORIZE_URL constant — that Plan 02-05's `auth` CLI command will compose with tokenStore.write().
- Honored the OAuth error-code response policy mandated by checker BLOCKER 4 / OPEN-Q-01: callbacks carrying `?error=invalid_scope&error_description=foo` produce a failureHtml body containing the literal `foo` (Test OE-09 — the verbatim checker acceptance fixture); opaque codes (server_error/access_denied/unauthorized_client/temporarily_unavailable/default) strip the description.
- Verified the 127.0.0.1-only binding (Test L-06 reads the `address` field from the onListening callback and asserts `'127.0.0.1'`, NOT `'0.0.0.0'`) — ASVS V9 + Threat Pattern CSRF-on-loopback.
- Honored the FROZEN AuthError union from Wave 0: `git diff --name-only HEAD~3..HEAD -- src/infrastructure/whoop/errors.ts` returns empty. The `auth_port_in_use` kind is consumed unchanged; no new kinds are added by this plan.
- PKCE OFF by default per A1/D-12: U-02 verifies absence of `code_challenge` when no challenge is passed; U-03 verifies S256 wiring when `challenge: 'abc'` is passed.
- Sanitize() defense-in-depth on the render path: Test OE-08 verifies that even when `error_description` is rendered (invalid_scope arm), a JWT-shaped substring inside it gets redacted by sanitize() before escapeHtml() inserts it into the failureHtml body.
- D-09 HTML pages render verbatim (no CSS, no JS, no external assets) — Test L-01 asserts both `Authorization complete` and `You can close this window` substrings on the success path; L-02 + OE-01..09 cover the failure path body shapes.
- Full suite: 144 → 174 across 14 files; lint clean; CI grep gates clean.

## Task Commits

Single TDD task — three commits across RED → GREEN → REFACTOR:

1. **Task 1 RED:** `dc544df` — `test(02-03): add failing RED tests for oauth round-trip (27 tests)` — all tests fail with "Cannot find module './oauth.js'" before any production code lands
2. **Task 1 GREEN:** `da420a6` — `feat(02-03): implement oauth round-trip (GREEN — 30 tests pass)` — module ships with the full OAuth Authorization-Code surface; 30/30 tests pass after the MSW `onUnhandledRequest: 'bypass'` adjustment and the settled-promise unhandled-rejection guard
3. **Task 1 REFACTOR:** `3d6ea15` — `refactor(02-03): clean up runOAuth (Promise-based listening wait + helper)` — busy-wait replaced with Promise-based wait; `printAuthorizeUrlToStderr` helper extracted; 30/30 still green

_Test count grew from 27 (planned) to 30: U-04 (WHOOP_AUTHORIZE_URL constant export) + U-05 (hostile clientId rejection) + a sequential-rounds cleanup smoke test were added during the RED phase as the plan's behavior block listed `clientId` validation and the L-04 server-close pattern. The OE error-policy block landed at 9 tests as planned._

## Files Created/Modified

### Created (2)

- `src/infrastructure/whoop/oauth.ts` (~452 LOC) — 9 named exports (5 functions + 4 type/interface). Module-leading doc comment cites D-08..D-13, ADR-0001 (stdout purity / stderr allowed), ADR-0007 (POST to token endpoint is the documented exception), and the cross-layer sanitize import deferral (PLAN-03-CROSS-LAYER).
- `src/infrastructure/whoop/oauth.test.ts` (~654 LOC) — 30 tests across 6 describe blocks. Uses port: 0 for OS-assigned ports; MSW from tests/helpers/msw-whoop-oauth.ts for the exchangeCode arm with `onUnhandledRequest: 'bypass'` so the loopback fetches pass through.

### Not modified (asserted by `git diff --name-only HEAD~3..HEAD`)

- `src/infrastructure/whoop/errors.ts` — AuthError union remains FROZEN at 6 kinds (Plan 02-01 / Wave 0 contract preserved).
- `src/infrastructure/whoop/token-store.ts` — WHOOP_TOKEN_URL re-imported, not modified.
- `src/mcp/sanitize.ts` / `src/mcp/register.ts` — Phase 1 sanitize.ts pulled in via cross-layer import; register.ts unchanged (D-18 attestation preserved across Plan 02-07 + this plan).

## Decisions Made

- **errors.ts NOT mutated by this plan.** Plan 02-01 moved `auth_port_in_use` into Wave 0 (checker BLOCKER 1 fix); this plan consumes the kind from the FROZEN 6-kind union. `git diff --name-only HEAD~3..HEAD -- src/infrastructure/whoop/errors.ts` returns empty, confirming the contract.
- **REFACTOR replaced busy-wait with Promise-based wait.** The GREEN-phase `while (listenerInfo === null) { await setTimeout(5) }` was sound but jittery; refactored to a `new Promise<{port, address}>(r => resolveListening = r)` that listenForCallback's `onListening` callback resolves once. listenForCallback's contract guarantees the callback fires exactly once before the server accepts requests.
- **MSW `onUnhandledRequest: 'bypass'`** (not `'error'`). The runOAuth tests drive `fetch()` against the loopback 127.0.0.1 server; MSW must pass those through. The helper only registers a handler for WHOOP_TOKEN_URL, so the token endpoint is still intercepted while loopback fetches reach the real local server.
- **Settled-promise wrapper for the L-02 + OE tests.** Vitest treats a rejection observed after a single tick gap as unhandled even when the caller will eventually `await` the original promise. Wrapping `listenForCallback(...)` into `.then(ok, err)` settled wrapper BEFORE awaiting any fetch keeps the rejection "handled" across the fetch round-trip without changing test semantics. Pattern documented for future async-server-Promise tests.
- **D-09 verbatim HTML pages.** Inline in oauth.ts as module-level constants (no template-literal expansion at runtime apart from `${escapedDetail}` in failureHtml). Matches the bytes in `test/fixtures/oauth/authorize-callback-state-mismatch.html` (Plan 02-01 fixture); Test L-02 cross-checks the failure body shape against the fixture's text.
- **process.stderr.write for the --no-browser arm.** ADR-0001 §Decision forbids stdout writes from MCP-reachable code; stderr is the correct fd. The doc comment at the top of oauth.ts cites the rule. CI Gate C (`process.stdout.write` outside `src/cli/commands/doctor.ts`) returns no matches for oauth.ts.
- **process.stderr.write fallback in the openBrowser-throw arm.** If a user passes openBrowser and it throws (e.g., headless CI, no display), the URL is printed to stderr — same fallback as `noBrowser: true`. The listenForCallback timer is still running so the user retains the D-10 budget to copy the URL into a browser. Test R-03 verifies.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking lint] Biome formatter required two reflows on oauth.ts**
- **Found during:** Task 1 GREEN verification (`npm run lint`).
- **Issue:** Biome flagged two format-only violations — the `finaliseReject(new AuthError(...))` call needed collapsing onto a single line, and the import `import { WHOOP_TOKEN_URL, type Tokens } from './token-store.js'` wanted the `type` modifier reordered to `import { type Tokens, WHOOP_TOKEN_URL } from './token-store.js'` per Biome's import sort.
- **Fix:** Ran `npm run format` to apply the auto-fix. No semantic change.
- **Files modified:** `src/infrastructure/whoop/oauth.ts`.
- **Verification:** `npm run lint` exits 0; 30 tests still pass.
- **Committed in:** `da420a6` (Task 1 GREEN — fix made before staging).

**2. [Rule 3 - Blocking lint] Unused `beforeEach` import in oauth.test.ts (Biome warning)**
- **Found during:** Task 1 GREEN verification (`npm run lint` after the auto-format pass).
- **Issue:** The test file imported `beforeEach` from `vitest` but the final test shape (using `beforeAll` + `afterAll` for the MSW lifecycle and `afterEach` for handler resets) did not need `beforeEach`. Biome flagged it as unused but the auto-fix was unsafe-only.
- **Fix:** Manually removed `beforeEach` from the `vitest` import. No test changes.
- **Files modified:** `src/infrastructure/whoop/oauth.test.ts`.
- **Verification:** `npm run lint` exits 0; 30 tests still pass.
- **Committed in:** `da420a6` (Task 1 GREEN — fix made before staging).

**3. [Rule 1 - Test correctness] MSW `onUnhandledRequest: 'error'` blocked the runOAuth fetch round-trip**
- **Found during:** Task 1 GREEN first test run — R-01/R-02/R-03 all failed with `InternalError: [MSW] Cannot bypass a request when using the "error" strategy for the "onUnhandledRequest" option.`
- **Issue:** The runOAuth tests drive `fetch('http://127.0.0.1:<port>/callback?...')` against the loopback server started by `listenForCallback`. With `onUnhandledRequest: 'error'`, MSW errored on the loopback fetch instead of passing it through.
- **Fix:** Changed both `helper.server.listen({onUnhandledRequest: ...})` calls (in `describe('exchangeCode')` and `describe('runOAuth')`) from `'error'` to `'bypass'`. The helper only registers a handler for WHOOP_TOKEN_URL, so the token endpoint is still intercepted while loopback fetches pass through to the real local server.
- **Files modified:** `src/infrastructure/whoop/oauth.test.ts`.
- **Verification:** 30/30 tests pass; the MSW interception of WHOOP_TOKEN_URL still works (X-01..X-06 all pass).
- **Committed in:** `da420a6` (Task 1 GREEN — fix made before staging).

**4. [Rule 1 - Test correctness] Vitest unhandled-rejection warnings on L-02 + OE-01..OE-09**
- **Found during:** Task 1 GREEN second test run — after the MSW fix, 30/30 tests passed but Vitest reported 10 unhandled-rejection warnings originating from the request handler.
- **Issue:** The pattern `const promise = listenForCallback(...); ...; await fetch(...); try { await promise } catch { caught = err }` produces unhandled-rejection warnings because the rejection fires inside the fetch's request-handler tick, but the consumer's `await promise` doesn't run until after the fetch round-trip completes. Vitest treats this single-tick gap as unhandled even though the rejection IS eventually awaited.
- **Fix:** Wrap `listenForCallback(...)` into a settled-promise wrapper BEFORE awaiting any fetch — `const settled = listenForCallback(...).then(v => ({ok: true, value: v}), err => ({ok: false, err}))` then `await settled` later. The `.then` handlers count as "handlers" for unhandled-rejection accounting purposes, so the rejection is never observed as unhandled regardless of timing. Applied to L-02 inline and to the shared `driveCallbackError` helper used by OE-01..OE-09.
- **Files modified:** `src/infrastructure/whoop/oauth.test.ts` (L-02 + driveCallbackError helper).
- **Verification:** 30/30 tests pass; 0 unhandled-rejection warnings; test semantics unchanged (same assertion content).
- **Committed in:** `da420a6` (Task 1 GREEN — fix made before staging).

**5. [Rule 1 - Plan-text drift: doc-grep precedent — oauth/oauth2/auth in test file]**
- **Found during:** Task 1 acceptance-grep check at the end of GREEN.
- **Issue:** The plan's acceptance criterion `grep -rEn "oauth/oauth2/auth" src/ | grep -v 'oauth.ts'` returns 4 matches — all of them in `oauth.test.ts`. The grep filter `grep -v 'oauth.ts'` does NOT match `oauth.test.ts` because `oauth.test.ts` contains the contiguous substring `oauth.test.ts`, not `oauth.ts`. Same shape as Plan 02-02's Gate-E acceptance criterion drift (`oauth/oauth2/token` in `src/mcp/sanitize.test.ts`).
- **Fix:** Re-ran the grep with `--exclude='*.test.ts'`-equivalent filter (`grep -v '\.test\.ts:'`) — returns 0 matches, confirming the criterion's underlying intent (no production module references the URL outside `oauth.ts`) is satisfied. No code change needed. Plan 02-06 will own a phase-wide Gate E rule (per the Plan 02-02 input note) that must also `--exclude='*.test.ts'`.
- **Files modified:** None — plan-text drift, not code drift.
- **Verification:** `grep -rEn "oauth/oauth2/auth" src/ --include='*.ts' --exclude='*.test.ts' | grep -v 'oauth.ts'` returns 0 lines.
- **Committed in:** N/A — no code change. Surfaced as a Plan 02-06 input note (same as Plan 02-02's note).

---

**Total deviations:** 5 auto-fixed (2 Rule-3 blocking-lint format/unused-import, 2 Rule-1 test-shape correctness for MSW lifecycle + unhandled-rejection, 1 Rule-1 plan-text doc-grep drift — no code change). All five were caught at GREEN-verification time.

**Impact on plan:** None functional. The deviations are lint format/unused-import (auto-fixed by `npm run format` + one manual import line edit), test-harness adjustments (MSW lifecycle + Promise-shape unhandled-rejection guard), and one plan-text grep precedent issue (same Plan 02-06 input note as Plan 02-02). The plan's `<acceptance_criteria>` are satisfied on the committed code; the OAuth state-machine + loopback round-trip + error-policy contracts match the plan's `<behavior>` and `<interfaces>` verbatim.

## Issues Encountered

- The MSW helper's `onUnhandledRequest: 'error'` default does not compose with tests that intentionally drive real loopback fetches alongside the WHOOP token endpoint interception. Future test files combining MSW + a local-server fixture should set `'bypass'` from the start. Worth a planner-template note for similar mixed-fixture suites.
- Vitest's unhandled-rejection accounting is strict — even a single tick between rejection-source-firing and the consumer `await` is flagged. The settled-promise wrapper pattern (`.then(ok, err)`) is the cleanest workaround and should be the default shape for async-server-Promise tests. Worth a planner-template note for the test-mechanism playbook.
- The acceptance-criterion grep `grep -v 'oauth.ts'` does NOT filter `oauth.test.ts` (same precedent as Plan 02-02's `grep -v 'token-store.ts'`). Plan 02-06's Gate E must add `--exclude='*.test.ts'` to its grep when it lands the rule in `scripts/ci-grep-gates.sh`.

## User Setup Required

None — no external service configuration, no env vars, no credentials, no dashboard touchpoints. Plan 02-05 will surface the BYO WHOOP developer-app dashboard URL when it wires `recovery-ledger init`.

## Next Phase Readiness

Wave 3+ of Phase 2 is now unblocked. Plans 02-04 / 02-05 / 02-06 / 02-08 can import:

- `buildAuthorizeUrl`, `listenForCallback`, `exchangeCode`, `runOAuth`, `WHOOP_AUTHORIZE_URL` from `src/infrastructure/whoop/oauth.ts`
- Type exports: `BuildAuthorizeUrlInput`, `ListenForCallbackOptions`, `ExchangeCodeInput`, `RunOAuthOptions` from the same file

**Plan 02-04 input note:** The refresh orchestrator does NOT consume `oauth.ts` — the refresh path delegates to `tokenStore.getValidAccessToken()` which already runs the ADR-0002 three-layer gate. oauth.ts is only for the initial auth-code grant.

**Plan 02-05 input note:** `recovery-ledger auth` will compose `await runOAuth({...opts, openBrowser: open})` (passing the `open` package as `openBrowser`) then `await tokenStore.write(tokens)`. The runOAuth contract handles state generation, PKCE-off-by-default wiring, loopback lifecycle, browser open + fallback, and the code-exchange POST — auth.ts only needs to provide the credentials, scopes from `D13_SCOPES` (single source from schema.ts), and the desired port.

**Plan 02-06 input note (twice now — Plan 02-02 + this plan):** When wiring Gate E in `scripts/ci-grep-gates.sh`, the gate must `--exclude='*.test.ts'` (or pipe through `grep -v '\.test\.ts:'`) to avoid false positives on Plan 02-07's `src/mcp/sanitize.test.ts` fixture AND this plan's `src/infrastructure/whoop/oauth.test.ts` test cases. The production-module enforcement intent is intact in both cases; only test-fixture URLs need the exclusion.

**Plan 02-08 input note:** Cross-process integration test (D-23.2) can compose `runOAuth({fetch: mockFetch, openBrowser: spy})` with the test-only `WHOOP_TOKEN_URL` env-var seam (Plan 02-02 wired it; this plan re-imports the constant unchanged).

No blockers. No open todos surfaced by this plan.

## Self-Check: PASSED

Files verified to exist:
- `src/infrastructure/whoop/oauth.ts`: FOUND (452 LOC; 9 named exports; no console.*; no process.stdout.write; no export default; binds 127.0.0.1; no 0.0.0.0)
- `src/infrastructure/whoop/oauth.test.ts`: FOUND (654 LOC; 30 tests across 6 describe blocks)
- `.planning/phases/02-oauth-token-store-single-flight-refresh/02-03-SUMMARY.md`: FOUND (this file, after write)

Files verified NOT modified by this plan:
- `src/infrastructure/whoop/errors.ts`: UNMODIFIED — `git diff --name-only HEAD~3..HEAD -- src/infrastructure/whoop/errors.ts` returns empty
- `src/mcp/sanitize.ts` / `src/mcp/register.ts`: UNMODIFIED (D-18 attestation preserved)

Commits verified in git log:
- `dc544df` (Task 1 RED — test): FOUND
- `da420a6` (Task 1 GREEN — feat): FOUND
- `3d6ea15` (Task 1 REFACTOR — refactor): FOUND

Acceptance grep checks (from plan, with the Plan 02-06 Gate-E test-file exclusion applied where it matters):
- `^export ` count in oauth.ts >= 5: 9 — PASS
- `console.(log|info|warn|error|debug|trace)` count == 0: 0 — PASS
- `process.stdout.write` count == 0: 0 — PASS
- `'127.0.0.1'` count >= 1: 2 — PASS
- `'0.0.0.0'` count == 0: 0 — PASS
- `RENDERABLE_OAUTH_ERROR_CODES|invalid_scope` count >= 2: 4 — PASS
- `^export default` count == 0: 0 — PASS
- `oauth/oauth2/auth` outside oauth.ts AND excluding *.test.ts == 0: 0 — PASS (with the test-file exclusion noted for Plan 02-06's Gate E)
- OE-09 fixture present (`error_description=foo`): 1 — PASS
- OE-09 assertion present (`toContain('foo')`): 1 — PASS
- `npm run test -- --run src/infrastructure/whoop/oauth.test.ts` exits 0 with 30 tests (>= 27 required): 30 — PASS
- Full suite: 174/174 across 14 files — PASS
- `npm run lint` exits 0: PASS
- `bash scripts/ci-grep-gates.sh` exits 0: PASS

## Threat Flags

None. All threats listed in the plan's `<threat_model>` register (T-02.03-01 through T-02.03-13) are addressed by the implementation as planned. The new files do not introduce surface that wasn't already in the threat register:

- T-02.03-01 (CSRF on loopback) → mitigated by 32-byte base64url state + 127.0.0.1-only binding; verified by L-06 + L-02
- T-02.03-02 (authorization-code injection) → mitigated by loopback + state; PKCE off by default per A1, flag-gated for future hardening
- T-02.03-03 (OAuth code in stderr/logs) → mitigated by structured-only logging `{event, hasCode: boolean}`; defense-in-depth via sanitize() in failureHtml + on the cause chain via Phase 1 register.ts wrapper
- T-02.03-04 (client_secret in URL/logs) → mitigated by URLSearchParams build only (no string concat); client_secret only in POST body of exchangeCode; never logged
- T-02.03-05 (URL injection via hostile clientId) → mitigated by CLIENT_ID_SHAPE Zod regex check in buildAuthorizeUrl; verified by U-05
- T-02.03-06 (token endpoint response body in error) → mitigated by `detail: \`token endpoint ${status}\`` only — status only, never body text; verified by X-02
- T-02.03-07 (hostile token-endpoint response shape) → mitigated by `TokenResponseSchema.passthrough()`; verified by X-05 (extra field accepted) + X-06 (missing field rejected)
- T-02.03-08 (DoS via infinite wait) → mitigated by 5-min default timeoutMs; AbortController-style timer cleanup; verified by L-03
- T-02.03-09 (port collision Pitfall G) → mitigated by EADDRINUSE → AuthError({kind: 'auth_port_in_use'}); verified by L-05
- T-02.03-10 (browser-open URL tampering) → mitigated by clientId regex + URLSearchParams escaping; cross-platform `open` package handles shell escaping (Plan 02-05 wires open as the openBrowser callback)
- T-02.03-11 (hostile localhost server) → ACCEPTED — out of scope for personal tool (RESEARCH §V4); EADDRINUSE detection fails fast rather than silently shipping codes
- T-02.03-12 (sanitize() bypass in failureHtml) → mitigated by sanitize() ALWAYS running, even on the render path; verified by OE-08
- T-02.03-13 (error_description leaks session-shaped identifiers) → mitigated by RENDERABLE_OAUTH_ERROR_CODES narrowing; verified by OE-04..07 (strip path) and OE-01..03 + OE-09 (render path)

## TDD Gate Compliance

Task 1 (`tdd="true"`) followed the full RED → GREEN → REFACTOR cycle:

- **RED:** `dc544df` (`test(02-03): add failing RED tests for oauth round-trip (27 tests)`) — all tests fail with `Cannot find module './oauth.js'` before any production code lands.
- **GREEN:** `da420a6` (`feat(02-03): implement oauth round-trip (GREEN — 30 tests pass)`) — module ships with the full OAuth Authorization-Code surface; 30/30 tests pass after the MSW + unhandled-rejection adjustments (deviations 3 + 4, all auto-fixed before the commit).
- **REFACTOR:** `3d6ea15` (`refactor(02-03): clean up runOAuth (Promise-based listening wait + helper)`) — busy-wait replaced with Promise-based wait; printAuthorizeUrlToStderr helper extracted; 30/30 still green; no semantic change.

---
*Phase: 02-oauth-token-store-single-flight-refresh*
*Plan: 02-03-oauth-round-trip*
*Completed: 2026-05-12*
