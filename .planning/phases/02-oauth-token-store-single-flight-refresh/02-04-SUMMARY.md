---
phase: 02-oauth-token-store-single-flight-refresh
plan: 04
subsystem: services
tags: [refresh-orchestrator, retry-policy, 401-reactive, adr-0002, auth-expired, services-barrel, sibling-refresh, fetch-like-response]

# Dependency graph
requires:
  - phase: 02-oauth-token-store-single-flight-refresh
    provides: src/infrastructure/whoop/errors.ts (AuthError FROZEN at 6 kinds — auth_expired + refresh_failed consumed unchanged); src/infrastructure/whoop/token-store.ts (TokenStore interface + tokenStore singleton + Tokens type + getValidAccessToken/read APIs); src/infrastructure/config/logger.ts (Pino stderr-only structured logger)
  - phase: 01-foundation-stdout-pure-mcp-bootstrap
    provides: src/services/index.ts (Plan 01-05 createServices stub with runDoctor — extended here, not replaced); src/services/doctor/index.test.ts (vi.resetModules + dynamic-import test harness pattern)
provides:
  - src/services/refresh-orchestrator.ts — callWithAuth + createRefreshOrchestrator + refreshOrchestrator singleton + 4 type/interface exports (7 named exports total)
  - src/services/refresh-orchestrator.test.ts — 9 unit tests covering D-14/D-15/D-16 retry policy: H-01/H-02 happy path, R-01/R-02/R-03 sibling/force/exhausted retry budget, F-01/F-02 refresh failure → auth_expired, S-01/S-02 services-barrel wiring
  - src/services/index.ts (modified) — Services interface extended with refreshOrchestrator; createServices() returns both runDoctor and refreshOrchestrator; type-level re-exports of orchestrator surface
  - The SINGLE consumer of tokenStore.getValidAccessToken() outside of token-store.ts internals (grep-verified; Plan 02-06 Gate E will lock this at CI time)
affects: [02-06-doctor-extensions (offline-safe — does NOT consume the orchestrator), 02-08-cross-process-integration (cross-process layer test seam unchanged); Phase 3 WHOOP sync service will be the FIRST runtime consumer]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Factory + singleton with closure-bound TokenStore (mirrors token-store.ts createTokenStore): production singleton binds to the production tokenStore; tests inject a mock TokenStore via createRefreshOrchestrator(mockStore)"
    - "401-reactive retry with sibling-refresh-aware re-read: attempt 1 → 401? → tokenStore.read() (cross-process sibling may have refreshed) → if fresh, retry with current.accessToken without burning another refresh; else force getValidAccessToken() through the three-layer gate and retry once with the fresh token"
    - "AuthError cause chain at the wrap boundary: refresh failures from token-store throw AuthError({kind: 'refresh_failed'}); orchestrator catches and rethrows as AuthError({kind: 'auth_expired', cause: refreshErr}) — Phase 1 sanitizer's cause-walker traverses the chain (D-18 attestation preserved)"
    - "Minimum-surface FetchLikeResponse: orchestrator inspects only `.status` from the response — operation callback owns the full Response shape; keeps the orchestrator decoupled from globalThis.Response and lets Phase 3's WHOOP client pass whatever wrapper it returns"
    - "Bound singleton convenience export: `export const callWithAuth = refreshOrchestrator.callWithAuth.bind(refreshOrchestrator)` so Phase 3 sync sites can `import { callWithAuth }` without dereferencing the singleton object first"

key-files:
  created:
    - src/services/refresh-orchestrator.ts
    - src/services/refresh-orchestrator.test.ts
  modified:
    - src/services/index.ts

key-decisions:
  - "Test deviation — dynamic-import AuthError inside F-01/F-02 instead of top-level static import. vi.resetModules() in beforeEach creates fresh module-graph instances each test, so the test's top-level static AuthError binding would NOT match the AuthError instance the orchestrator catches/rethrows. toBeInstanceOf would fail with `expected AuthError to be an instance of AuthError` (same class name, different identity). Fix matches the orchestrator's own dynamic import via loadOrchestrator() helper."
  - "FetchLikeResponse intentionally minimal — just `{status: number}`. The orchestrator only needs `.status` to decide retry; the full Response shape is the operation's concern. Test mocks pass plain objects; Phase 3's WHOOP HTTP client can wrap or pass-through globalThis.Response without constraint."
  - "REFACTOR skipped — GREEN implementation matched the planned shape without cleanup needed. Same precedent as Plan 02-01 Task 2 and Plan 02-07 Task 1. No busy-wait / no speculative helper / no plan-acceptance grep collision required a follow-up commit. Module-leading comment cites ADR-0002 §Consequences and the corrected consumer-scope note (Phase 3 is first consumer; Plan 02-05's auth.ts does NOT consume — corrected per checker WARNING PLAN-04-CIRCULAR-NOTE) verbatim from the plan."
  - "callWithAuth bound on the singleton (line 132) — not redefined as a free function. The plan's `<interfaces>` block specified `export const callWithAuth = refreshOrchestrator.callWithAuth`, but a naked property reference loses `this` binding when the call site is `import { callWithAuth }`. Using `.bind(refreshOrchestrator)` is the strict-mode-safe form that preserves the singleton wiring; Phase 3 can still `import { callWithAuth }` and call it like a free function."
  - "Type-only top-level imports in the test file — once AuthError moved to dynamic-import inside F-01/F-02, the only remaining top-level type-needs are TokenStore and Tokens. Both are `import type` for verbatimModuleSyntax compliance under TypeScript strict + the project's `import type` convention."

patterns-established:
  - "Pattern: cross-module-identity test idiom — when a test exercises a module via vi.resetModules() + dynamic import and asserts toBeInstanceOf against a class exported by a sibling module, dynamic-import the sibling's class inside the test body too. Top-level static imports resolve to a pre-reset module-graph instance and fail the instanceof check."
  - "Pattern: orchestrator/store split — token-store.ts owns refresh mechanics (single-flight gate, lockfile, atomic write); refresh-orchestrator.ts owns retry policy (401 handling, sibling re-read, retry budget). Future Phase 3+ patterns that need a similar mechanics/policy split should follow this two-module shape rather than collapsing both into one mega-module."
  - "Pattern: bound singleton method export — `export const fn = singleton.method.bind(singleton)` preserves `this` for free-function import sites. Use whenever a singleton wants to expose a primary method directly (callWithAuth, runDoctor, etc.) without forcing callers to dereference."

requirements-completed: [AUTH-04, AUTH-05]

# Metrics
duration: 3m 3s
completed: 2026-05-12
---

# Phase 2 Plan 04: Refresh Orchestrator Summary

**401-reactive retry policy chokepoint landed in src/services/refresh-orchestrator.ts: attempt 1 → 401? → re-read tokens (sibling-refresh-aware) → if stale, force refresh via tokenStore.getValidAccessToken() → retry exactly once; refresh failure wraps as AuthError({kind: 'auth_expired', cause: refreshErr}) and does NOT retry the operation. Retry budget = 1 per D-15. Services barrel extended with refreshOrchestrator alongside runDoctor; createServices() returns both. 9 unit tests green; the orchestrator is the SOLE consumer of tokenStore.getValidAccessToken() outside token-store internals (grep-verified — Plan 02-06's Gate E will lock at CI time).**

## Performance

- **Duration:** 3 min 3 sec
- **Started:** 2026-05-12T22:58:31Z
- **Completed:** 2026-05-12T23:01:34Z
- **Tasks:** 1 (TDD: RED → GREEN; REFACTOR skipped — implementation matched planned shape)
- **Files modified:** 3 (2 created + 1 modified)
- **Tests added:** 9 (H-01..02 + R-01..03 + F-01..02 + S-01..02)
- **Total suite:** 174 → 183 tests across 14 → 15 files; all green

## Accomplishments

- Landed the 401-reactive retry chokepoint that Phase 3's WHOOP sync service will wrap every GET against api.prod.whoop.com through. Single policy site, single chokepoint — ADR-0002 §Consequences "single refresh consumer" rule honored.
- Three-arm retry semantics per D-14/D-15/D-16 verified end-to-end:
  - **R-01 (sibling refreshed):** orchestrator's tokenStore.read() inside the 401 arm sees the sibling's fresh token; retries with `current.accessToken` directly; getValidAccessToken called exactly ONCE (no redundant force-refresh). AUTH-05 cross-process pre-empt confirmed at the unit level.
  - **R-02 (force refresh):** re-read still stale; orchestrator calls getValidAccessToken() to force a refresh through the three-layer gate; retries with the post-refresh access token. getValidAccessToken called exactly TWICE (initial + force).
  - **R-03 (budget exhausted):** retry returns a second 401; orchestrator returns that 401 to the caller without throwing or retrying again. Op called exactly TWICE. Retry budget is 1.
- F-01: refresh failure (token-store throws AuthError({kind: 'refresh_failed'})) wraps as AuthError({kind: 'auth_expired', cause: refreshErr}) — cause chain preserved for Phase 1's sanitize.ts walker (D-18 attestation: register.ts wrapper unchanged this plan).
- F-02: formatAuthError({kind: 'auth_expired'}) returns the verbatim Plan 01-01 remediation phrase ("run `recovery-ledger auth` to re-authorize") — locked at the errors.ts contract (FROZEN at 6 kinds from Wave 0); the orchestrator does NOT spell remediation copy of its own.
- Services barrel composition root extended: createServices() now returns `{ runDoctor, refreshOrchestrator }`. Phase 3's sync service can consume via createServices() without further wiring; Plan 02-05's auth.ts is explicitly OUT of scope (corrected per checker WARNING PLAN-04-CIRCULAR-NOTE — the previous plan wording incorrectly implied Plan 05 consumed the orchestrator).
- Grep-verified single-consumer contract: `grep -rEn "tokenStore\.getValidAccessToken" src/` outside refresh-orchestrator.ts + token-store.ts + their tests returns ZERO matches. Plan 02-06's Gate E will lock this at CI time.
- Full suite: 174 → 183 across 14 → 15 files; lint clean; CI grep gates clean.

## Task Commits

Single TDD task — two commits (RED → GREEN; REFACTOR skipped):

1. **Task 1 RED:** `ea6735a` — `test(02-04): add failing RED tests for refresh orchestrator (9 tests)` — 8 of 9 tests fail with `Cannot find module './refresh-orchestrator.js'`; F-02 passes (it tests the existing Plan 02-01 errors.ts contract verbatim, no module-creation needed).
2. **Task 1 GREEN:** `63c5f10` — `feat(02-04): implement refresh orchestrator (GREEN — 9 tests pass)` — module ships with the planned 7 exports; services barrel extended; 9/9 tests pass.

_REFACTOR skipped — GREEN matched the planned shape; same precedent as Plan 02-01 Task 2 and Plan 02-07 Task 1. Module-leading comment cites ADR-0002 §Consequences and the corrected consumer-scope note verbatim from the plan; no speculative helpers, no busy-wait, no plan-acceptance grep collision require cleanup._

## Files Created/Modified

### Created (2)

- `src/services/refresh-orchestrator.ts` (133 LOC, 7 named exports). Factory + singleton pattern matching token-store.ts. Module-leading comment cites ADR-0002 §Consequences (single refresh consumer), D-14/D-15/D-16 (retry policy), the corrected consumer-scope (Phase 3 is the first consumer; Plan 05's auth.ts does NOT consume), and ADR-0001 (no console / no direct stdout writes). Exports: `FetchLikeResponse`, `AuthedOperation<T>`, `CallWithAuthOptions`, `RefreshOrchestrator`, `createRefreshOrchestrator`, `refreshOrchestrator`, `callWithAuth`.
- `src/services/refresh-orchestrator.test.ts` (296 LOC, 9 tests across 4 describe blocks). Test harness mirrors src/services/doctor/index.test.ts: `vi.resetModules()` in beforeEach + dynamic `import('./refresh-orchestrator.js')`. Mock TokenStore via `makeMockTokenStore()` with vi.fn-spied methods on all 5 TokenStore members. AuthError dynamic-imported inside F-01/F-02 to preserve class identity across resetModules.

### Modified (1)

- `src/services/index.ts` (19 → 34 LOC). Plan-04 sibling-paragraph extension to the existing Plan-05 doc comment. Adds `import { refreshOrchestrator }`; re-exports `RefreshOrchestrator`, `CallWithAuthOptions`, `AuthedOperation`, `FetchLikeResponse` as type-level surface; extends `Services` interface with `refreshOrchestrator: typeof refreshOrchestrator`; `createServices()` now returns `{ runDoctor, refreshOrchestrator }`. Explicit one-line note that Plan 05's auth.ts does NOT pull through this barrel — it imports infrastructure directly because the auth-code grant has no 401-reactive boundary.

### Not Modified (asserted by `git diff --name-only HEAD~2..HEAD`)

- `src/infrastructure/whoop/errors.ts` — AuthError union FROZEN at 6 kinds from Wave 0; this plan consumes `auth_expired` and `refresh_failed` unchanged.
- `src/infrastructure/whoop/token-store.ts` — TokenStore interface, tokenStore singleton, and getValidAccessToken/read APIs consumed unchanged.
- `src/mcp/sanitize.ts` / `src/mcp/register.ts` — D-18 attestation preserved across Plan 02-07 + Plan 02-02 + Plan 02-03 + this plan.

## Decisions Made

- **Dynamic-import AuthError inside F-01/F-02 (cross-module class identity)**. The test harness uses `vi.resetModules()` in `beforeEach()` + dynamic `import('./refresh-orchestrator.js')` so each test exercises a fresh module-graph. A top-level static `import { AuthError } from '../infrastructure/whoop/errors.js'` would resolve a pre-reset module-graph instance, but the orchestrator's own import (after reset) resolves a NEW instance. `expect(caught).toBeInstanceOf(AuthError)` would fail with the (confusing) error `expected AuthError to be an instance of AuthError` — same class name, different runtime class identity. Fix: dynamic-import AuthError inside the test body too, matching the orchestrator's lifecycle. This is a Vitest-with-resetModules idiom worth a planner-template note.
- **FetchLikeResponse is intentionally minimal — just `{status: number}`**. The orchestrator never reads `.body`, `.headers`, or any other Response field; it only needs `.status` to decide retry. The full Response shape is the operation callback's concern. This decouples the orchestrator from globalThis.Response (Phase 3's WHOOP HTTP client may wrap or pass through), keeps the test mocks tiny (plain `{status: number}` objects), and makes the public surface easy to audit. Tradeoff: a future requirement that needs `Retry-After` from a 429 header would require either (a) the operation callback to handle 429s itself (current plan path — the orchestrator is 401-only) or (b) widening FetchLikeResponse to include the header bag. Plan 02-04 chose the narrow shape; widening is a future-plan concern.
- **REFACTOR skipped — GREEN matched planned shape**. Module-leading comment, retry policy, AuthError wrap, services-barrel wiring all match `<interfaces>` and `<action>` verbatim. No busy-wait (R-01 uses a direct mock chain, not polling), no speculative helpers (Plan 02-02 REFACTOR removed `tokenFileExists`; this plan has no equivalent), no plan-acceptance grep collision (the doc-comment phrasing in refresh-orchestrator.ts uses `console calls` rather than `console.*` and `direct stdout writes` rather than `process.stdout.write`, mirroring the Plan 02-01/02-02 paths.ts/token-store.ts precedent — see also "Deviation 2" below). Same precedent as Plan 02-01 Task 2 (REFACTOR not needed) and Plan 02-07 Task 1 (no REFACTOR).
- **`callWithAuth` bound on the singleton via `.bind(refreshOrchestrator)`** (line 132) — not redefined as a free function reading the singleton's `tokenStore`. The plan's `<interfaces>` block specified the export as `export const callWithAuth = refreshOrchestrator.callWithAuth`, but a naked property reference loses `this` binding when the call site is `import { callWithAuth }`. Using `.bind()` is the strict-mode-safe form that preserves the singleton wiring; Phase 3 can `import { callWithAuth }` and invoke it like a free function. Functionally equivalent to the plan's wording; semantically more robust against future arrow-vs-method conversions inside `createRefreshOrchestrator`.
- **Type-only top-level imports in the test file** — once AuthError moved into the dynamic-import inside F-01/F-02, the only top-level needs are `TokenStore` and `Tokens` types. Both annotated `import type` for verbatimModuleSyntax compliance under TypeScript strict + the project's `import type` convention.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 — Test correctness: cross-module class identity under vi.resetModules()]**

- **Found during:** Task 1 GREEN, first `npm run test --run src/services/refresh-orchestrator.test.ts` run.
- **Issue:** F-01 originally imported `AuthError` at the top of the test file (static, module-load-time) and used it both to construct the `refreshErr` instance fed into the getValidAccessToken mock AND to assert `expect(caught).toBeInstanceOf(AuthError)`. The test failed with `AssertionError: expected AuthError: refresh failed; run \`recovery-… { kind: '…' } to be an instance of AuthError`. The caught error IS an AuthError — but a DIFFERENT module-graph instance. The orchestrator under test was loaded via `loadOrchestrator()` (dynamic `import('./refresh-orchestrator.js')` after `vi.resetModules()` in `beforeEach`), which transitively re-evaluates `errors.ts` and produces a new `AuthError` class. The test's top-level static import predates the reset and binds the OLD class.
- **Fix:** Dynamic-import `AuthError` inside both F-01 and F-02 (binding as `AuthErrorLocal` in F-01 for clarity), matching the orchestrator's own dynamic-import lifecycle. Updated type annotations to `InstanceType<typeof AuthErrorLocal>` so TypeScript narrows the `caught` value to the local class identity. Removed the top-level `import { AuthError } from '../infrastructure/whoop/errors.js'` since it's no longer used at the value level.
- **Files modified:** `src/services/refresh-orchestrator.test.ts` (F-01, F-02, top-level imports).
- **Verification:** `npm run test --run src/services/refresh-orchestrator.test.ts` re-runs clean — 9/9 pass.
- **Committed in:** `63c5f10` (Task 1 GREEN — fix made before staging).
- **Planner-template note:** When a test file plans `vi.resetModules()` + dynamic-import + `toBeInstanceOf(SomeClassFromAnotherModule)`, also dynamic-import `SomeClassFromAnotherModule` inside the test body. Top-level static imports do NOT survive `vi.resetModules()` semantics. This is the same shape as Plan 02-03's settled-promise wrapper deviation (Vitest test-harness idiom not captured in the plan's `<behavior>` block) — worth recording for future TDD plans.

**2. [Rule 1 — Doc-comment phrasing for grep-acceptance criterion precedent]**

- **Found during:** Task 1 GREEN verification, when writing the orchestrator's module-leading comment.
- **Issue:** Plan 02-01 (paths.ts) and Plan 02-02 (token-store.ts) both had doc-comment grep collisions where the literal phrase `process.env` or `process.stdout.write` in prose caused the plan's acceptance grep to return >0 matches even though the runtime body had zero calls. The plans' fixes were to rephrase doc comments to "env-global" and "direct stdout writes" respectively.
- **Fix:** Pre-emptively used the same phrasing in refresh-orchestrator.ts module-leading comment: `no console calls, no direct stdout writes from this module — structured logger.warn only, never the response body or tokens`. Same precedent as Plan 02-01 paths.ts and Plan 02-02 token-store.ts.
- **Files modified:** `src/services/refresh-orchestrator.ts` (module-leading comment only; no code change).
- **Verification:** `grep -cE 'console\.(log|info|warn|error|debug|trace)' src/services/refresh-orchestrator.ts` returns 0 (the doc comment says "console calls", not "console.*"). `grep -c 'process\.stdout\.write' src/services/refresh-orchestrator.ts` returns 0 (doc says "direct stdout writes", not "process.stdout.write").
- **Committed in:** `63c5f10` (Task 1 GREEN — applied before staging).
- **Planner-template note:** Same shape as Plans 02-01 and 02-02. Worth a permanent planner-template fix: acceptance-criterion greps that scan a module should be pre-validated against the planned doc-comment phrasing.

---

**Total deviations:** 2 auto-fixed (both Rule 1 — test-correctness for vi.resetModules() class identity + doc-comment grep precedent).

**Impact on plan:** None functional. The retry policy, AuthError wrap shape, services-barrel wiring, and grep-verified single-consumer contract all match the plan's `<interfaces>` + `<behavior>` + `<acceptance_criteria>` verbatim. Both deviations are test-harness idioms (cross-module class identity under vi.resetModules; doc-comment phrasing for grep acceptance) that are now established patterns across the phase.

## Issues Encountered

- Cross-module class identity under `vi.resetModules()` is a recurring Vitest idiom this phase has now hit three times in slightly different shapes (Plan 02-02 used per-instance closures to avoid resetModules altogether for state isolation; Plan 02-03 used settled-promise wrappers for unhandled-rejection accounting; this plan needed dynamic-import of class symbols for instanceof checks). Worth a planner-template Test-Mechanism playbook entry: "if your test uses vi.resetModules + dynamic import + toBeInstanceOf(ImportedClass), dynamic-import the class too."
- The plan's `<interfaces>` block specified `export const callWithAuth = refreshOrchestrator.callWithAuth` (naked property reference). This loses `this` binding for free-function call sites. Replaced with `.bind(refreshOrchestrator)`. Worth a planner-template note: when planning a singleton-method-as-free-function export, prefer `.bind(singleton)` in the plan's interface text.

## User Setup Required

None — no external service configuration, no env vars, no credentials, no dashboard touchpoints. Pure orchestration code; all wiring is internal.

## Next Phase Readiness

Wave-3+ of Phase 2 is unblocked. Plans 02-05 / 02-06 / 02-08 can rely on:

- `callWithAuth`, `createRefreshOrchestrator`, `refreshOrchestrator` from `src/services/refresh-orchestrator.ts`
- Type exports: `FetchLikeResponse`, `AuthedOperation`, `CallWithAuthOptions`, `RefreshOrchestrator` from the same file
- `services.refreshOrchestrator` from `createServices()` (alongside `runDoctor`)
- Re-exports of the four types from `src/services/index.ts`

**Plan 02-05 (cli-shims) input note:** auth.ts does NOT consume the refresh orchestrator. The auth-code grant flow has no 401-reactive boundary (the user has not yet authenticated against any tokenized endpoint). auth.ts imports `runOAuth` from `src/infrastructure/whoop/oauth.js` and `tokenStore.write` from `src/infrastructure/whoop/token-store.js` directly — this is the correct layering for the one-shot auth grant. The plan's `<interfaces>` consumer-scope clarification (per checker WARNING PLAN-04-CIRCULAR-NOTE) is verbatim correct.

**Plan 02-06 (doctor-extensions) input note:** Gate E in `scripts/ci-grep-gates.sh` should now check that the SOLE consumer of `tokenStore.getValidAccessToken()` outside of internal token-store code is `src/services/refresh-orchestrator.ts`. Allow-list pattern:
```
grep -rEn "tokenStore\.getValidAccessToken" src/ \
  --include='*.ts' --exclude='*.test.ts' \
  | grep -v -E '^(src/infrastructure/whoop/token-store\.ts|src/services/refresh-orchestrator\.ts):'
```
must return zero. Also Gate E (the `oauth/oauth2/token` URL check) should `--exclude='*.test.ts'` to avoid Plan 02-07's sanitize.test.ts fixture and Plan 02-03's oauth.test.ts false positives (input notes recorded twice already; this is the third).

**Plan 02-08 (cross-process integration) input note:** The orchestrator's `callWithAuth` is the wrapping layer Phase 3 will compose. For the cross-process integration test, Plan 02-08 can either: (a) test the orchestrator end-to-end with two child processes, each running `callWithAuth(op)` against an MSW server in the parent — verifying refresh hit count = 1, both children see same fresh access token; or (b) defer to the existing token-store concurrency unit test (C-01..03) for the single-flight half + a smaller orchestrator integration that pins the 401-arm cross-process pre-empt. Either shape works; (a) is the stronger end-to-end coverage.

**Phase 3 (WHOOP sync) note:** The first runtime consumer of this module is Phase 3's WHOOP sync service. Composition shape (preview):
```typescript
import { callWithAuth } from '../services/refresh-orchestrator.js';
import { whoopGet } from './client.js'; // Phase 3 deliverable

async function syncRecovery(): Promise<Recovery[]> {
  const res = await callWithAuth((accessToken) => whoopGet('/recovery', accessToken));
  if (res.status !== 200) throw new Error(`whoop ${res.status}`);
  return RecoveryListSchema.parse(await res.json());
}
```

No blockers. No open todos surfaced by this plan.

## Self-Check: PASSED

Files verified to exist:
- `src/services/refresh-orchestrator.ts`: FOUND (133 LOC; 7 named exports; no `console.*`; no `process.stdout.write`; no `export default`)
- `src/services/refresh-orchestrator.test.ts`: FOUND (296 LOC; 9 tests across 4 describe blocks)
- `src/services/index.ts`: MODIFIED (34 LOC; 4 refreshOrchestrator references including import + Services field + createServices return + type re-export block)
- `.planning/phases/02-oauth-token-store-single-flight-refresh/02-04-SUMMARY.md`: FOUND (this file, after Write)

Files verified NOT modified by this plan:
- `src/infrastructure/whoop/errors.ts`: UNMODIFIED — AuthError union FROZEN at 6 kinds
- `src/infrastructure/whoop/token-store.ts`: UNMODIFIED — TokenStore + tokenStore singleton consumed unchanged
- `src/mcp/sanitize.ts` / `src/mcp/register.ts`: UNMODIFIED — D-18 attestation preserved

Commits verified in git log:
- `ea6735a` (Task 1 RED — test): FOUND
- `63c5f10` (Task 1 GREEN — feat): FOUND

Acceptance grep checks (from plan `<acceptance_criteria>`):
- `^export ` count in refresh-orchestrator.ts >= 6: **7** — PASS
- `refreshOrchestrator` matches in src/services/index.ts >= 3: **4** (import + interface field + createServices return + doc-comment mention) — PASS
- `console.(log|info|warn|error|debug|trace)` in refresh-orchestrator.ts == 0: **0** — PASS
- `^export default` in refresh-orchestrator.ts == 0: **0** — PASS
- `npm run test --run src/services/refresh-orchestrator.test.ts` >= 9 passing tests: **9** — PASS
- `grep -rEn "tokenStore\.getValidAccessToken" src/` outside refresh-orchestrator.ts + token-store.ts + their tests == 0: **0** — PASS
- `npm run lint` exits 0: PASS
- `bash scripts/ci-grep-gates.sh` exits 0: PASS
- Full suite: 174 → 183 tests across 14 → 15 files — PASS

## Threat Flags

None. All threats listed in the plan's `<threat_model>` register (T-02.04-01 through T-02.04-06) are addressed by the implementation as planned:

- **T-02.04-01 (Repudiation — retry budget overflow burning the refresh-token family)** → mitigated by hard-coded budget = 1. Test R-03 verifies exactly two operation calls; test F-01 verifies no retry after a refresh failure. ADR-0002 §Consequences + STACK.md §Token refresh point 4. ASVS V11.
- **T-02.04-02 (Information Disclosure — response body leaked in retry logs)** → mitigated by `logger.warn({event: '401_received', retry: true})` — structured fields only, never the response body or tokens. ASVS V7.
- **T-02.04-03 (Tampering — bypass of single-flight gate via direct fetch)** → mitigated by the orchestrator being the ONLY src/ consumer of `tokenStore.getValidAccessToken()` outside of token-store internals (grep-verified). Plan 02-06's Gate E will lock at CI time. ASVS V11.
- **T-02.04-04 (DoS — hostile operation hangs forever)** → ACCEPTED. Operation timeout is the caller's responsibility (Phase 3's WHOOP HTTP client will set per-request timeouts). The orchestrator does not impose its own timeout — it would conflict with legitimate 60s+ pagination calls Phase 3 will issue. ASVS V11.
- **T-02.04-05 (Spoofing — hostile operation returns 401 from a non-WHOOP host)** → ACCEPTED. Operation is caller's code; orchestrator trusts callers. Phase 3's HTTP client is the layer that pins requests to api.prod.whoop.com (ADR-0007). ASVS V9 — pinning lives in the HTTP client.
- **T-02.04-06 (Information Disclosure — AuthError({kind: 'auth_expired'}).cause contains token material)** → mitigated by the cause chain originating from token-store.ts's AuthError({kind: 'refresh_failed'}) which already constrains `.detail` to `'token endpoint <status>'` (Plan 02-02 T-02.02-02 mitigation). Defense-in-depth: Phase 1's `register.ts` wrapper sanitizes the full error before MCP surfacing — D-18 attestation preserved. ASVS V7.

The new files do not introduce surface that wasn't already in the threat register. No threat flags to surface for downstream plans.

## TDD Gate Compliance

Task 1 (`tdd="true"`) followed the RED → GREEN cycle (REFACTOR skipped):

- **RED:** `ea6735a` (`test(02-04): add failing RED tests for refresh orchestrator (9 tests)`) — 8 of 9 orchestrator-specific tests fail with `Cannot find module './refresh-orchestrator.js'` before any production code lands. F-02 passes against the existing Plan 02-01 errors.ts contract (it tests `formatAuthError({kind: 'auth_expired'})` which the FROZEN errors.ts already implements verbatim). Per plan `<behavior>` block, F-02 is testing the contract — not the orchestrator — so a green-on-first-run for F-02 is expected.
- **GREEN:** `63c5f10` (`feat(02-04): implement refresh orchestrator (GREEN — 9 tests pass)`) — module ships with the planned 7 exports + services barrel extension; 9/9 tests pass after the cross-module class-identity fix (Deviation 1, applied before staging).
- **REFACTOR:** skipped — GREEN implementation matched the planned shape. Same precedent as Plan 02-01 Task 2 and Plan 02-07 Task 1. No busy-wait, no speculative helpers, no plan-acceptance grep collision required a follow-up commit.

The RED → GREEN gate is intact: a `test(...)` commit precedes a `feat(...)` commit in `git log --oneline | head`. The plan-level TDD gate is satisfied.

---
*Phase: 02-oauth-token-store-single-flight-refresh*
*Plan: 02-04-refresh-orchestrator*
*Completed: 2026-05-12*
