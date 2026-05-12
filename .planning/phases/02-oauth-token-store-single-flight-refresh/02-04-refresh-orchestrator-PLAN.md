---
phase: 02-oauth-token-store-single-flight-refresh
plan: 04
type: execute
wave: 3
depends_on: ['02-01', '02-02']
files_modified:
  - src/services/refresh-orchestrator.ts
  - src/services/refresh-orchestrator.test.ts
  - src/services/index.ts
autonomous: true
requirements:
  - AUTH-04
  - AUTH-05
user_setup: []

must_haves:
  truths:
    - "D-16: When the in-process refresh Promise is already in-flight, a second caller awaits the same promise — no separate WHOOP refresh call (ADR-0002 layer A)."
    - "refreshOrchestrator wraps a single API operation so a 401 triggers exactly one preemptive refresh + retry; a second 401 surfaces auth_expired."
    - "On 401, the orchestrator re-reads tokens from storage BEFORE forcing a refresh — a sibling process may have already refreshed (RESEARCH Pattern 1 + D-15)."
    - "Retry budget = 1 (D-15) — one refresh, one retry, then auth_expired. Never retry a failed refresh (STACK.md §Token refresh point 4)."
    - "The orchestrator delegates to tokenStore.getValidAccessToken() for the refresh — there is no second refresh path."
    - "The orchestrator is the ONLY consumer of tokenStore.getValidAccessToken() outside of internal token-store wiring — every WHOOP-bound caller goes through it."
    - "Services barrel exports refreshOrchestrator alongside runDoctor so Phase 3's WHOOP sync service consumes it via createServices(). Plan 05's auth.ts does NOT consume the orchestrator — auth.ts imports infrastructure (oauth + token-store) directly because the auth-code grant path never crosses a 401-reactive boundary (no callWithAuth call site)."
  artifacts:
    - path: "src/services/refresh-orchestrator.ts"
      provides: "callWithAuth(operation, options) — wraps a function returning a fetch-like response; on 401, re-reads tokens, optionally forces a refresh, retries exactly once."
      contains: "callWithAuth"
    - path: "src/services/refresh-orchestrator.test.ts"
      provides: "Unit tests covering 200 happy path, 401-then-200 retry, 401-then-401 surface as auth_expired, refresh failure → auth_expired without retry, sibling-refreshed pre-empt path."
      contains: "auth_expired"
    - path: "src/services/index.ts"
      provides: "Services barrel — adds refreshOrchestrator and (re-)exports createServices()."
      contains: "refreshOrchestrator"
  key_links:
    - from: "src/services/refresh-orchestrator.ts"
      to: "src/infrastructure/whoop/token-store.ts"
      via: "imports { tokenStore } and calls tokenStore.getValidAccessToken() at the start of each attempt"
      pattern: "tokenStore"
    - from: "src/services/refresh-orchestrator.ts"
      to: "src/infrastructure/whoop/errors.ts"
      via: "throws AuthError({kind: 'auth_expired'}) when retry budget exhausted"
      pattern: "auth_expired"
    - from: "src/services/index.ts"
      to: "src/services/refresh-orchestrator.ts"
      via: "barrel export so Phase 3's sync service consumes refreshOrchestrator through createServices(). Plan 05's auth.ts imports infrastructure directly because auth-time never calls callWithAuth (corrected per checker WARNING PLAN-04-CIRCULAR-NOTE — the previous wording incorrectly implied Plan 05 consumed the orchestrator)."
      pattern: "refreshOrchestrator"
---

<objective>
Build the refresh orchestrator that wraps every WHOOP API call: handles 401-reactive refresh, retries the originating request exactly once, and surfaces `auth_expired` when the retry budget is exhausted. This is the single chokepoint where 401 handling lives — token-store.ts handles refresh mechanics, the orchestrator handles the retry policy.

Purpose: AUTH-04 (token-refresh wrapper transparently refreshes expired tokens and retries on 401). Phase 3's WHOOP sync code will be the primary consumer. Plan 05's auth CLI does NOT consume callWithAuth — auth.ts uses runOAuth + tokenStore.write directly because the auth-code grant flow never crosses a 401-reactive boundary. Plan 06's doctor check is offline-safe and does not consume it.

Output: Two files — `refresh-orchestrator.ts` (~80 LOC) + co-located unit tests (~200 LOC), plus a one-line extension to `src/services/index.ts` to barrel-export.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/PROJECT.md
@.planning/REQUIREMENTS.md
@.planning/phases/02-oauth-token-store-single-flight-refresh/02-CONTEXT.md
@.planning/phases/02-oauth-token-store-single-flight-refresh/02-RESEARCH.md
@.planning/phases/02-oauth-token-store-single-flight-refresh/02-PATTERNS.md
@CLAUDE.md
@agent_docs/conventions.md
@agent_docs/decisions/0002-single-flight-oauth-refresh.md
@agent_docs/decisions/0007-whoop-read-only.md
@src/services/index.ts
@src/services/doctor/index.ts

<interfaces>
<!-- The orchestrator is the WHOOP-call wrapper. Phase 3's sync service will be the primary consumer. -->

From Plan 01:
- `src/infrastructure/whoop/errors.ts` → `AuthError` with kinds `auth_expired`, `refresh_failed`. (The 6-kind union is FROZEN at Wave 0.)

From Plan 02:
- `src/infrastructure/whoop/token-store.ts` → `tokenStore`, `createTokenStore`, `type TokenStore`.

From Phase 1:
- `src/services/index.ts` → existing `createServices()` returns `{ runDoctor }`.

refresh-orchestrator.ts public surface:
- `export interface CallWithAuthOptions { tokenStore?: TokenStore; }` — test seam, defaults to the production singleton.
- `export interface FetchLikeResponse { status: number; }` — minimum surface the orchestrator needs to inspect (NOT the full `Response` interface — we only read `.status`; the rest is the caller's concern).
- `export type AuthedOperation<T extends FetchLikeResponse> = (accessToken: string) => Promise<T>;`
- `export function callWithAuth<T extends FetchLikeResponse>(operation: AuthedOperation<T>, options?: CallWithAuthOptions): Promise<T>`
- `export interface RefreshOrchestrator { callWithAuth: typeof callWithAuth; }`
- `export function createRefreshOrchestrator(tokenStore: TokenStore): RefreshOrchestrator`
- `export const refreshOrchestrator: RefreshOrchestrator` — singleton bound to the production tokenStore.

Retry policy (D-14 + D-15 + RESEARCH lines 549-606):
1. Attempt 1: `await tokenStore.getValidAccessToken()` (preemptive refresh if <5min to expiry — already handled inside tokenStore); call `operation(accessToken)`.
2. If `res.status !== 401`: return `res`.
3. If `res.status === 401`: re-read tokens from storage (sibling may have refreshed). If `tokens.expiresAt > now` (a sibling refreshed our way out), call `operation(currentAccessToken)` once more and return that result regardless of status (no further retry — retry budget is 1).
4. If after re-read the token is still stale: call `tokenStore.getValidAccessToken()` to force a refresh through the three-layer gate. Then call `operation(accessToken)` once more. Return that result regardless of status (retry budget = 1).
5. If the refresh itself throws (e.g., `AuthError({kind: 'refresh_failed'})` from token-store.ts), wrap and rethrow as `AuthError({kind: 'auth_expired', cause: refreshErr})` per D-15.

Services barrel (`src/services/index.ts`):
- Extend `Services` interface: `interface Services { runDoctor: typeof runDoctor; refreshOrchestrator: RefreshOrchestrator; }`.
- Extend `createServices()`: `return { runDoctor, refreshOrchestrator };`.
- Add re-exports for `RefreshOrchestrator`, `CallWithAuthOptions`, `AuthedOperation`, `FetchLikeResponse`.

Consumer scope clarification (per checker WARNING PLAN-04-CIRCULAR-NOTE):
- Phase 3's WHOOP sync service will be the FIRST runtime consumer of `refreshOrchestrator.callWithAuth` (it wraps every GET against api.prod.whoop.com).
- Plan 02-05's `src/cli/commands/auth.ts` does NOT consume callWithAuth or refreshOrchestrator. The auth-code grant flow is a one-shot: oauth.ts runs the loopback round-trip → exchangeCode → tokenStore.write. There is no 401-reactive surface at auth-time because the user has not yet authenticated against any tokenized endpoint.
- Plan 02-05 imports oauth.ts and token-store.ts from `src/infrastructure/whoop/` directly. This is the correct layering for the auth-code grant path; it is not a layering violation. The previous wording in this plan's key_links claimed Plan 05's auth.ts consumed refreshOrchestrator through createServices(); that was wrong and has been corrected.
</interfaces>
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: refresh-orchestrator.ts — 401-reactive retry policy + services barrel wiring</name>
  <files>
    src/services/refresh-orchestrator.ts,
    src/services/refresh-orchestrator.test.ts,
    src/services/index.ts
  </files>
  <read_first>
    - src/services/index.ts (Phase 1 — current Services interface + createServices factory; extend, don't replace)
    - src/services/doctor/index.ts (Phase 1 — service-layer style; comment voice; named exports only)
    - src/infrastructure/whoop/token-store.ts (Plan 02 — TokenStore interface, getValidAccessToken signature, AuthError throw shape on refresh failure)
    - src/infrastructure/whoop/errors.ts (Plan 01 — current AuthErrorKind union including auth_port_in_use; FROZEN at Wave 0)
    - agent_docs/decisions/0002-single-flight-oauth-refresh.md (line 70 — single consumer rule; line 50-52 — adapters receive a fresh access token and do not handle 401s by refreshing themselves; the ORCHESTRATOR handles 401 by delegating back through tokenStore.getValidAccessToken())
    - .planning/phases/02-oauth-token-store-single-flight-refresh/02-RESEARCH.md (D-14/D-15 retry semantics — RESEARCH lines 43-46; Pitfall §Anti-patterns lines 519-526 — never double-refresh)
    - .planning/phases/02-oauth-token-store-single-flight-refresh/02-CONTEXT.md (D-14, D-15, D-16 — the canonical retry policy)
    - tests/helpers/msw-whoop-oauth.ts (Plan 01 — for tests that need WHOOP token endpoint mocking when the orchestrator forces a refresh)
  </read_first>
  <behavior>
    Happy path (D-14):
    - Test H-01: operation returns 200 on first call → callWithAuth returns the response; tokenStore.getValidAccessToken called exactly once; no refresh hit.
    - Test H-02: operation calls `op(accessToken)` with the string returned by tokenStore.getValidAccessToken().

    401 reactive retry (D-15):
    - Test R-01 (sibling refreshed): seed expired token, but mock tokenStore.read() to return a fresh token on second call (simulating a sibling process refresh). Operation returns 401 on first call, 200 on second. callWithAuth returns the 200; no force-refresh call (verified by spy on tokenStore.getValidAccessToken being called exactly once — the second call goes through `read()` which now sees the sibling's fresh token, so the orchestrator bypasses getValidAccessToken on the second attempt). NOTE: the orchestrator's actual flow is: attempt → 401 → re-read tokens → if fresh, retry with new accessToken; if stale, force refresh via getValidAccessToken. So getValidAccessToken is called only on the FIRST attempt unless the re-read is also stale.
    - Test R-02 (force refresh path): operation returns 401 on first call. Re-read shows still-expired token. Orchestrator calls tokenStore.getValidAccessToken() which forces a refresh and returns a fresh token. Operation returns 200 on second call. callWithAuth returns the 200. Spy assertion: tokenStore.getValidAccessToken called exactly twice (initial + force-refresh).
    - Test R-03 (retry budget exhausted): operation returns 401 on first call AND 401 on retry. callWithAuth resolves with the second 401 response — does NOT throw, does NOT retry a third time. Spy: operation called exactly twice. (Rationale: the second 401 is the caller's responsibility to surface; the orchestrator's contract is "retry once on 401"; the caller decides whether to map the response to an AuthError or surface it raw.)

    Refresh failure (D-15 + STACK.md §Token refresh point 4):
    - Test F-01: operation returns 401. Re-read shows still expired. tokenStore.getValidAccessToken() rejects with `AuthError({kind: 'refresh_failed'})`. callWithAuth rejects with `AuthError({kind: 'auth_expired'})` whose `.cause` is the original refresh_failed error. Spy: operation called exactly once (no retry after refresh failure).
    - Test F-02: `formatAuthError({kind: 'auth_expired'} as AuthError)` returns a string mentioning `recovery-ledger auth` (the remediation is "user runs auth again").

    Services barrel:
    - Test S-01: `createServices()` returns an object with both `runDoctor` and `refreshOrchestrator`. `refreshOrchestrator.callWithAuth` is a function.
    - Test S-02: calling `createServices().refreshOrchestrator.callWithAuth(op)` with a 200-returning op works end-to-end against the singleton tokenStore (test injects a tokenStore mock via the un-singleton-ed `createRefreshOrchestrator(mockStore)` path).
  </behavior>
  <action>
    Step 1 — Create `src/services/refresh-orchestrator.ts`. Named exports only. Module-leading comment cites ADR-0002 §Consequences (single refresh consumer) and D-15 (retry budget = 1). Also note that Phase 3's sync service is the FIRST consumer; Plan 02-05's auth.ts does NOT consume this module (auth-code grant has no 401-reactive boundary). ~80 LOC. Structure:

    1. Imports: `../infrastructure/whoop/token-store.js` (`tokenStore as defaultTokenStore`, `type TokenStore`), `../infrastructure/whoop/errors.js` (`AuthError`), `../infrastructure/config/logger.js` (`logger`).

    2. Types per `<interfaces>` block: `FetchLikeResponse`, `AuthedOperation<T>`, `CallWithAuthOptions`, `RefreshOrchestrator`.

    3. `createRefreshOrchestrator(store: TokenStore): RefreshOrchestrator`:
       - Returns `{ callWithAuth: (op, opts) => callWithAuthImpl(op, store) }` where callWithAuthImpl closes over the provided store.

    4. `callWithAuthImpl(op, store)`:
       - Attempt 1: `const accessToken = await store.getValidAccessToken();` then `const res = await op(accessToken);`. If `res.status !== 401`, return res.
       - On 401: `const current = await store.read();`. If `current && current.expiresAt > Date.now()` (sibling refreshed), retry with `current.accessToken` and return that result. Else force refresh: try `const freshToken = await store.getValidAccessToken();` — on `AuthError` from refresh path, rethrow as `new AuthError({kind: 'auth_expired', cause: err, detail: 'refresh failed; run recovery-ledger auth'})`. With freshToken, call op once more and return the result.
       - Log structured `logger.warn({event: '401_received', retry: true})` before retry — never log the token or the response body.

    5. `export const refreshOrchestrator = createRefreshOrchestrator(defaultTokenStore);` — singleton.
    6. `export const callWithAuth = refreshOrchestrator.callWithAuth;` — convenience re-export so Phase 3's sync service can `import { callWithAuth }` directly.

    No `console.*`. No `process.stdout.write`. logger.warn structured fields only.

    Step 2 — Modify `src/services/index.ts`:
    - Add `import { refreshOrchestrator } from './refresh-orchestrator.js';`
    - Add `export type { RefreshOrchestrator, CallWithAuthOptions, AuthedOperation, FetchLikeResponse } from './refresh-orchestrator.js';`
    - Extend `interface Services` to add `refreshOrchestrator: RefreshOrchestrator`.
    - Update `createServices()` body to `return { runDoctor, refreshOrchestrator };`.
    - Keep the Plan 03 doc comment (the "Plan 05 replaces the Plan 03 stub" voice) intact; add a sibling paragraph noting refreshOrchestrator was added in Phase 2 Plan 04 with the same composition-root rationale. Add a one-line comment that Plan 05's auth.ts does NOT pull through this barrel — it imports infrastructure directly because the auth-code grant has no 401-reactive boundary.

    Step 3 — Create `src/services/refresh-orchestrator.test.ts`. Pattern from `src/services/doctor/index.test.ts`:
    - `vi.resetModules()` per test + dynamic import.
    - Construct a mock `TokenStore` with vi.fn-spied methods: `getValidAccessToken`, `read`, `write`, `clear`, `readStorageMode`. Configure return values per scenario.
    - Tests H-01, H-02, R-01, R-02, R-03, F-01, F-02, S-01, S-02 per <behavior>.
    - S-02 imports from `'./index.js'` (the services barrel) to exercise the createServices wiring.
  </action>
  <verify>
    <automated>npm run test -- --run src/services/refresh-orchestrator.test.ts src/services/index.test.ts 2>/dev/null || npm run test -- --run src/services/refresh-orchestrator.test.ts</automated>
  </verify>
  <acceptance_criteria>
    - `src/services/refresh-orchestrator.ts` exists with exports `callWithAuth`, `createRefreshOrchestrator`, `refreshOrchestrator`, types `RefreshOrchestrator`, `CallWithAuthOptions`, `AuthedOperation`, `FetchLikeResponse`. Grep: `grep -cE '^export ' src/services/refresh-orchestrator.ts` returns >= 6.
    - `src/services/index.ts` now exports `refreshOrchestrator` from `createServices()`. Run: `grep -nE 'refreshOrchestrator' src/services/index.ts` returns at least 3 matches (import line + Services interface + createServices return).
    - `src/services/refresh-orchestrator.ts` has NO `console.*` calls.
    - `grep -c '^export default' src/services/refresh-orchestrator.ts` returns `0`.
    - `npm run test -- --run src/services/refresh-orchestrator.test.ts` exits 0 with at least 9 passing tests (H-01..02, R-01..03, F-01..02, S-01..02).
    - `grep -rEn "tokenStore\.getValidAccessToken" src/ | grep -v -E '(refresh-orchestrator\.ts|token-store\.ts|refresh-orchestrator\.test\.ts|token-store\.test\.ts)'` returns no matches (the orchestrator is the only consumer outside of token-store internals + tests).
    - `npm run lint` exits 0.
    - `bash scripts/ci-grep-gates.sh` exits 0.
  </acceptance_criteria>
  <done>
    refresh-orchestrator.ts implements the 401-reactive retry policy with budget = 1, sibling-refresh-aware re-read, AuthError({kind: 'auth_expired'}) on refresh failure. Services barrel exports it via createServices(). 9+ tests green. Gate E precondition: no other src file consumes tokenStore.getValidAccessToken directly. Consumer scope documented: Phase 3's sync service is the first runtime consumer; Plan 05's auth.ts does NOT consume the orchestrator.
  </done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| operation callback → orchestrator | the operation owns the HTTP request; orchestrator only inspects `.status` from the response |
| orchestrator → tokenStore | trusted internal API; tokenStore.getValidAccessToken() is the ONLY refresh path (ADR-0002 §Enforcement) |
| 401 response shape | untrusted — the orchestrator does NOT parse the body, only `.status` (defense against body-parsing attacks) |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-02.04-01 | Repudiation | retry budget overflow burning the refresh-token family | mitigate | Hard-coded budget = 1 retry. Test R-03 verifies exactly two operation calls. Test F-01 verifies no retry after a refresh failure. ADR-0002 §Consequences + STACK.md §Token refresh point 4. ASVS V11. |
| T-02.04-02 | Information Disclosure | response body leaked in retry logs | mitigate | logger.warn logs only structured fields `{event: '401_received', retry: true}` — never the response body. ASVS V7. |
| T-02.04-03 | Tampering | bypass of single-flight gate via direct fetch | mitigate | All operations receive accessToken from tokenStore.getValidAccessToken(); the orchestrator is the only caller of that method outside token-store internals. Gate E (Plan 06) enforces "only token-store.ts may POST to oauth/oauth2/token" — there is no legal path to bypass. ASVS V11. |
| T-02.04-04 | DoS | hostile operation hangs forever | accept | Operation timeout is the caller's responsibility (Phase 3's sync code will set fetch timeouts). The orchestrator does not impose its own timeout — it would conflict with the legitimate 60s+ pagination calls Phase 3 will issue. ASVS V11. |
| T-02.04-05 | Spoofing | hostile operation returns 401 from a non-WHOOP host | accept | Operation is the caller's code; the orchestrator trusts callers. Phase 3's HTTP client is the layer that pins requests to api.prod.whoop.com (ADR-0007). ASVS V9 — pinning lives in the HTTP client. |
| T-02.04-06 | Information Disclosure | AuthError({kind: 'auth_expired'}).cause contains token material | mitigate | The cause chain originates from token-store.ts's AuthError({kind: 'refresh_failed'}) which already has its detail constrained to status code only (Plan 02 T-02.02-02). Defense-in-depth: register.ts wrapper sanitizes the full error before MCP surfacing. ASVS V7. |
</threat_model>

<verification>
- `src/services/refresh-orchestrator.ts` exists.
- `src/services/index.ts` exports `refreshOrchestrator` via the Services barrel.
- `npm run test -- --run src/services/refresh-orchestrator.test.ts` exits 0 with >= 9 tests.
- `grep -rEn "tokenStore\.getValidAccessToken" src/ | grep -v -E '(refresh-orchestrator\.ts|token-store\.ts|\.test\.ts)'` returns no matches.
- `bash scripts/ci-grep-gates.sh` exits 0.
- `npm run lint` exits 0.
</verification>

<success_criteria>
- AUTH-04 satisfied: the wrapper transparently refreshes expired access tokens (via tokenStore's 5-min preemptive trigger) AND retries the originating request on 401 (via the orchestrator's reactive retry).
- AUTH-05 cross-process pre-empt confirmed at the unit level: when a sibling process has refreshed by the time we re-read, we use the sibling's fresh token instead of forcing a redundant refresh.
- The orchestrator is the SINGLE consumer of tokenStore.getValidAccessToken() outside of internal token-store wiring — verified by grep.
- Services barrel exports both runDoctor and refreshOrchestrator; Phase 3's sync service consumes via `createServices()` without further wiring.
- Consumer scope is correctly documented: Phase 3 consumes; Plan 02-05's auth.ts does NOT (corrected per checker WARNING PLAN-04-CIRCULAR-NOTE).
</success_criteria>

<output>
After completion, create `.planning/phases/02-oauth-token-store-single-flight-refresh/02-04-SUMMARY.md`.
</output>
