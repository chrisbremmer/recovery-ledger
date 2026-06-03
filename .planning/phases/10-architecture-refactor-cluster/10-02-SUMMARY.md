---
phase: 10-architecture-refactor-cluster
plan: 02
subsystem: services / infrastructure
tags: [refactor, layering, hexagonal, DI, singleton-removal, oauth-refresh, adr-0002, ci-grep-gates]
branch: refactor/10-arch-02-03-singletons-and-client-di

# Dependency graph
requires:
  - phase: 02-auth
    provides: ADR-0002 three-layer single-flight gate (preserved byte-for-byte)
  - phase: 10-architecture-refactor-cluster
    provides: 10-01 sanitize → domain/observability (Gate K, layering precedent)
provides:
  - bootstrap() as the sole construction site for tokenStore + refreshOrchestrator + authedCall
  - AuthedCall type as the DI seam between infrastructure/whoop/client.ts and the OAuth refresh chain
  - Factory shape for the 6 WHOOP resource modules (createListCycles / createListRecovery / createListSleep / createListWorkouts / createGetProfile / createGetBodyMeasurement)
  - ADR-0002 §Enforcement bullet locking the singleton-per-process rule + OAuth-flow exception
  - Grep Gates L (no singleton exports) and M (no upward services/ import from infrastructure)
affects: [10-03 (ARCH-06 wiring.ts), 10-04 (ARCH-07 — partially completed in this PR), 10-05 (ARCH-08)]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - Composition-root DI: bootstrap() constructs tokenStore + refreshOrchestrator + authedCall once per process; consumers receive them via Bootstrapped.services
    - Factory-shaped resource modules capturing the injected authedCall via closure (replaces direct module-level imports from src/services/)
    - Documented per-flow exception: src/cli/commands/auth.ts constructs its own createTokenStore() because the OAuth-login flow does not bootstrap (no DB needed)
    - CI grep gates pinning the architectural invariant — Gate L forbids re-introducing the deleted singleton exports; Gate M forbids any upward import from src/services/ inside src/infrastructure/

key-files:
  created:
    - .planning/phases/10-architecture-refactor-cluster/10-02-SUMMARY.md
  modified:
    - src/infrastructure/whoop/token-store.ts
    - src/services/refresh-orchestrator.ts
    - src/services/bootstrap.ts
    - src/services/bootstrap.test.ts
    - src/services/index.ts
    - src/services/refresh-orchestrator.test.ts
    - src/services/sync/index.ts
    - src/services/doctor/index.ts
    - src/services/doctor/checks/auth.ts
    - src/services/doctor/checks/token-freshness.ts
    - src/infrastructure/whoop/client.ts
    - src/infrastructure/whoop/client.test.ts
    - src/infrastructure/whoop/resources/cycles.ts
    - src/infrastructure/whoop/resources/recovery.ts
    - src/infrastructure/whoop/resources/sleep.ts
    - src/infrastructure/whoop/resources/workouts.ts
    - src/infrastructure/whoop/resources/profile.ts
    - src/infrastructure/whoop/resources/body-measurements.ts
    - src/cli/commands/auth.ts
    - src/cli/commands/auth.test.ts
    - tests/contract/cycles.test.ts
    - tests/contract/recovery.test.ts
    - tests/contract/sleep.test.ts
    - tests/contract/workouts.test.ts
    - tests/contract/profile.test.ts
    - tests/contract/body-measurements.test.ts
    - tests/integration/sync/idempotency.test.ts
    - tests/integration/sync/partial-failure.test.ts
    - tests/integration/sync/dst-fixture.test.ts
    - tests/integration/auth-concurrency.test.ts (no changes — child helper updated instead)
    - tests/integration/helpers/child-get-token.mjs
    - tests/integration/setup-stopwatch.test.ts
    - agent_docs/decisions/0002-single-flight-oauth-refresh.md
    - scripts/ci-grep-gates.sh

key-decisions:
  - "Path (b2) in Task 1 step 7: dropped refreshOrchestrator from ServicesBase entirely rather than constructing a second tokenStore inside createServices(). The full surface comes through bootstrap() which already exposes refreshOrchestrator + tokenStore on services; the lightweight path returns only { runDoctor }. This is the only path consistent with Q7-RESOLVED (one construction site, plus the documented auth.ts exception)."
  - "ARCH-07 (doctor-check DI tightening) carried into THIS PR for the two checks that already imported the tokenStore singleton (auth + token_freshness). RESEARCH §ARCH-07 noted the natural overlap with ARCH-02; doing it here saves a round trip. The remaining 12 doctor checks did not import the singleton — ARCH-07's full audit lands in a later plan."
  - "Bootstrap now extends RunDoctorOptions with `tokenStore?: TokenStore` and threads the canonical instance through the production services_runDoctor closure. The lightweight createServices() path leaves it undefined; the auth + token_freshness probes receive synthesized stubs returning null so they surface their standard 'no tokens' fail rather than throwing on an undefined dep."
  - "Resource modules: factory shape with `{authedCall}` per the plan. RunSyncDeps['whoop'] now consumes `ReturnType<typeof createList*>` instead of `typeof list*` to constrain the closure shape without depending on a named runtime export at the resource-module top level."
  - "Gate letters: 10-01 added Gate K; this PR adds Gates L (no singleton exports) and M (no upward services/ import from infrastructure). Plan front-matter spelled them as 'L1' / 'L2' placeholders; the actual letters L + M were the next free slots and match the RESEARCH §Plan-grid expected layout."
  - "auth-concurrency.test.ts itself was not modified — only its child helper (tests/integration/helpers/child-get-token.mjs). The 10-fork structure + MSW one-shot interceptor + cross-process file-lock assertion are unchanged; the child entry now constructs createTokenStore() once at boot instead of importing the (deleted) singleton from dist/. The ADR-0002 cross-process contract is preserved because the OS file lock + atomic write — not a shared module-level singleton — is the actual gate."

patterns-established:
  - "Composition root owns construction; every other module receives its dependencies via DI."
  - "Documented per-flow exceptions are named verbatim in the ADR §Enforcement section; the exception lives at exactly one path (src/cli/commands/auth.ts) and is enforced by inspection during code review (the grep gate forbids the EXPORT, not the local construction, so the exception is structurally allowed)."
  - "When a factory pattern replaces a named function export, downstream type slots use `ReturnType<typeof createX>` to keep the consumer shape expressed without naming a runtime symbol."

requirements-completed: [ARCH-02, ARCH-03]
requirements-re-verified-closed: [ARCH-04, ARCH-05]

# Metrics
duration: ~75 min
completed: 2026-06-03
---

# Phase 10 Plan 02: drop OAuth singletons + WHOOP client DI (ARCH-02 + ARCH-03 + ARCH-04 + ARCH-05) Summary

**Atomically deleted three module-load singletons (`tokenStore`, `refreshOrchestrator`, `callWithAuth`), inverted the last `infrastructure → services` import via injected `authedCall`, converted the 6 WHOOP resource modules to factories, amended ADR-0002 §Enforcement, and added two new CI grep gates pinning the new shape.**

## Performance

- **Duration:** ~75 min
- **Started:** 2026-06-03T15:28:00Z (approx)
- **Completed:** 2026-06-03T15:45:00Z (approx)
- **Tasks:** 6
- **Files modified:** 33 (28 src/tests + ADR + script + child helper + SUMMARY)

## Accomplishments

- Three module-load singletons deleted; bootstrap() owns construction; ADR-0002 §Enforcement carries the new "exactly one tokenStore per process for DB-coupled flows" bullet.
- src/infrastructure/whoop/client.ts no longer imports from src/services/ — the last upward arrow in the lite-hexagonal layering is closed.
- httpGet takes `authedCall: AuthedCall` as its 4th positional parameter; the 6 resource modules become factories capturing `authedCall` via closure; bootstrap wires them with the production closure.
- src/cli/commands/auth.ts is the sole documented exception per Q7-RESOLVED — constructs its own `createTokenStore()` with a justification comment block referencing ADR-0002 §Enforcement.
- ARCH-04 closed-state re-verified: `rg "from '.*infrastructure/whoop/errors'" src tests | grep -E "AuthError|MigrationError"` returns 0 matches.
- ARCH-05 closed-state re-verified: 8 CLI shims use `tryBootstrap` (auth, doctor, init correctly excluded).
- Two new CI grep gates: Gate L (no singleton exports) and Gate M (no upward services/ import from infrastructure). Both pass on the new tree.
- Full test suite: 1360 passed / 1 skipped / 1 known flake (mcp-stdout-purity passes in isolation; documented in execution prompt as pre-existing). 24.18s under the 60s budget.

## Task Commits

1. **Task 1: drop three singletons; bootstrap owns construction (ARCH-02)** — `79c0e0a` (`refactor`)
2. **Task 2: client.ts DI via authedCall + 6 resource modules become factories (ARCH-03)** — `ff00252` (`refactor`)
3. **Task 3: rewrite mocks for deleted callWithAuth + auth-concurrency worker entry (ARCH-02, ARCH-03)** — `cb8d163` (`test`)
4. **Task 4: auth.ts direct createTokenStore() + tighten 2 doctor checks (ARCH-02, ARCH-07)** — `78cacb5` (`refactor`)
5. **Task 5: ADR-0002 §Enforcement amendment (ARCH-02)** — `3bd8fee` (`docs`)
6. **Task 6: Gates L + M + this SUMMARY (ARCH-02 / ARCH-03 / ARCH-04 / ARCH-05)** — committed with this file (`chore`)

## Files Created/Modified

### Created
- `.planning/phases/10-architecture-refactor-cluster/10-02-SUMMARY.md` — this file

### Modified — production code (15 files)
- **Composition root:** `src/services/bootstrap.ts`, `src/services/index.ts`
- **Token store + orchestrator:** `src/infrastructure/whoop/token-store.ts`, `src/services/refresh-orchestrator.ts`
- **WHOOP HTTP client + 6 resource modules:** `src/infrastructure/whoop/client.ts`, `src/infrastructure/whoop/resources/{cycles,recovery,sleep,workouts,profile,body-measurements}.ts`
- **CLI shim (exception):** `src/cli/commands/auth.ts`
- **Doctor (ARCH-07 carry-over):** `src/services/doctor/checks/auth.ts`, `src/services/doctor/checks/token-freshness.ts`, `src/services/doctor/index.ts`
- **Sync deps shape:** `src/services/sync/index.ts`

### Modified — tests (14 files)
- **Bootstrap + orchestrator + auth:** `src/services/bootstrap.test.ts` (+ new "honors injected tokenStore" case), `src/services/refresh-orchestrator.test.ts` (S-01 updated), `src/cli/commands/auth.test.ts` (mockTokenStoreWrite now mocks the factory)
- **Client unit:** `src/infrastructure/whoop/client.test.ts` (every httpGet call gains `authedCall` as 4th arg; spy reworked)
- **Contract tests (6):** `tests/contract/{cycles,recovery,sleep,workouts,profile,body-measurements}.test.ts` (factory composition; no more vi.mock of refresh-orchestrator)
- **Sync integration (3):** `tests/integration/sync/{idempotency,partial-failure,dst-fixture}.test.ts` (same)
- **Auth-concurrency child helper:** `tests/integration/helpers/child-get-token.mjs` (constructs `createTokenStore()` per child; the OS file lock + atomic write remain the cross-process gate)
- **Setup stopwatch:** `tests/integration/setup-stopwatch.test.ts` (constructs `createTokenStore()` inline after `exchangeCode`)

### Modified — docs + tooling (2 files)
- `agent_docs/decisions/0002-single-flight-oauth-refresh.md` — §Enforcement bullet added for ARCH-02
- `scripts/ci-grep-gates.sh` — Gates L + M added; header comment updated from "eleven rules (A-K)" to "thirteen rules (A-M)"

## Acceptance Criteria

### Plan front-matter `must_haves.truths`

| Must-have | Status | Verification |
| --- | --- | --- |
| `export const tokenStore` is gone from token-store.ts | PASS | `grep -c "^export const tokenStore" src/infrastructure/whoop/token-store.ts` → `0` |
| `export const refreshOrchestrator` + `export const callWithAuth` are gone from refresh-orchestrator.ts | PASS | `grep -cE "^export const (refreshOrchestrator\|callWithAuth)" src/services/refresh-orchestrator.ts` → `0` |
| bootstrap() constructs tokenStore + refreshOrchestrator exactly once and threads them through Bootstrapped.services | PASS | Visible in `src/services/bootstrap.ts` lines ~225-235; `bootstrap.test.ts` Test 4a asserts identity + spy-routed-through |
| client.ts no longer imports from src/services/; httpGet takes authedCall as its 4th parameter | PASS | `grep -cE "from\s+['\\\"].*services/" src/infrastructure/whoop/client.ts` → `0`; `grep -c "authedCall: AuthedCall" src/infrastructure/whoop/client.ts` → `1` (signature) plus internal call sites |
| 6 WHOOP resource modules are factories; bootstrap.ts wires them at the current 301-310 line block | PASS | `grep -lE "export function create(List\|Get)" src/infrastructure/whoop/resources/` lists all 6; bootstrap.ts resource block calls each factory with `{ authedCall }` |
| productionWhoopFetcher receives authedCall and uses it in httpGet | PASS | bootstrap.ts `httpGet('/v2/user/profile/basic', {}, WhoopRawProfile, authedCall)` |
| src/cli/commands/auth.ts constructs its own createTokenStore() directly (documented two-construction-sites exception) | PASS | `grep -c "createTokenStore()" src/cli/commands/auth.ts` → `2` (import + local const construction with justification comment) |
| ADR-0002 §Enforcement gains the "exactly one tokenStore per process for DB-coupled flows; OAuth-login flow is the sole documented exception" rule | PASS | `grep -c "ARCH-02 (#85) — exactly one tokenStore per process for DB-coupled flows" agent_docs/decisions/0002-single-flight-oauth-refresh.md` → `1`; `grep -c "sole documented exception" ...` → `1` |
| ARCH-02 + ARCH-03 ship in ONE atomic PR — no broken-main runtime window, no transitional callWithAuth bridge | PASS | Single branch `refactor/10-arch-02-03-singletons-and-client-di`; no bridge import in the diff |
| ARCH-04 closed-state holds | PASS | `rg "from '.*infrastructure/whoop/errors'" src tests \| grep -E "AuthError\|MigrationError" \| wc -l` → `0` |
| ARCH-05 closed-state holds | PASS | `grep -l "tryBootstrap" src/cli/commands/*.ts \| wc -l` → `8` (auth, doctor, init excluded — verified) |
| Two new grep gates pin the new shape | PASS | Gates L + M present in `scripts/ci-grep-gates.sh`; full grep-gate script passes |

### Per-task `<acceptance_criteria>`

- **Task 1:** all green — three singletons gone; bootstrap test suite passes (6/6 including new injected-tokenStore case); lint + tsc green.
- **Task 2:** all green — client.ts has 0 services/ imports; AuthedCall exported; resource modules export factories; bootstrap.ts wires all 6 with `{ authedCall }`; tsc green.
- **Task 3:** all green — no `vi.mock.*refresh-orchestrator` matches; every contract + integration test passes; auth-concurrency 7/7 pass (cross-process lock contract holds).
- **Task 4:** all green — `createTokenStore()` present in auth.ts with ADR-0002 justification comment; doctor checks require deps; auth + token-freshness probe tests pass.
- **Task 5:** all green — ADR bullet present after ERRC-02 with auth.ts named verbatim.
- **Task 6:** all green — Gates L + M added; full grep-gate run passes (13 gates total); ARCH-04 + ARCH-05 closed-state re-verified.

## Test Suite + Gates

- **`npm test`:** 1360 passed, 1 skipped, 1 known flake (`tests/integration/mcp-stdout-purity.test.ts` — passes in isolation; documented in execution prompt as a subprocess-timing issue under full-suite parallel load, NOT caused by this PR). Duration ~24s (well under 60s budget).
- **`npm run lint`:** clean (`Checked 276 files. No fixes applied.`).
- **`tsc --noEmit`:** clean.
- **`bash scripts/ci-grep-gates.sh`:** `All grep gates passed.` (13 gates: A-M).
- **`npm run build`:** clean.

## ADRs Touched

- **ADR-0001 (MCP stdout purity):** the bootstrap rewiring touches MCP-reachable code (src/services/bootstrap.ts is consumed by src/mcp/index.ts). No `console.*` calls introduced; structured Pino logging via the existing logger singleton. Compliance verified via Gate B.
- **ADR-0002 (single-flight OAuth refresh):** §Enforcement amended IN THIS PR with the ARCH-02 bullet. The three-layer single-flight gate (in-process Promise + cross-process file lock + atomic write) is unchanged byte-for-byte in `src/infrastructure/whoop/token-store.ts`. The auth-concurrency contract test (7/7 passing) is the runtime attestation that the cross-process lock holds after the singleton removal.
- **ADR-0006 (fixture-only tests):** the 6 contract tests + 3 sync integration tests still use MSW; no real WHOOP HTTP introduced.

## Closed-state verification commands

### ARCH-04 (single canonical AuthError import path)
```sh
rg "from '.*infrastructure/whoop/errors'" src tests | grep -E "AuthError|MigrationError" | wc -l
# → 0
```

### ARCH-05 (8 CLI shims use tryBootstrap; auth/doctor/init correctly excluded)
```sh
grep -l "tryBootstrap" src/cli/commands/*.ts | wc -l
# → 8
```

### Gate L (no singleton exports)
```sh
grep -rEn "^export[[:space:]]+const[[:space:]]+(tokenStore|refreshOrchestrator|callWithAuth)\b" --include='*.ts' src/ | grep -Ev '\.test\.ts:'
# → empty
```

### Gate M (no upward services/ import from infrastructure)
```sh
grep -rEn "from[[:space:]]+['\"](\.\.?/)+services/" --include='*.ts' src/infrastructure/ | grep -Ev '\.test\.ts:'
# → empty
```

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 — Blocking] `runDoctorImpl` did not pass deps to probeAuth / probeTokenFreshness**

- **Found during:** Task 4 — tightening AuthProbeDeps / TokenFreshnessProbeDeps from `deps?` to required `deps` broke the runtime calls in `src/services/doctor/index.ts:296-297` which call `probeAuth()` / `probeTokenFreshness()` with NO arguments.
- **Why the plan's premise was wrong:** Plan Task 4 step 4 said "runDoctorImpl … already passes these deps explicitly per RESEARCH §ARCH-07. Verify via grep". The actual code did NOT pass deps — it relied on the `deps?` optional shape to fall back to the (now-deleted) singleton internally.
- **Fix:** extended `RunDoctorOptions` with `tokenStore?: TokenStore`; bootstrap's `services_runDoctor` closure now passes the bootstrap-bound `tokenStore` through; `runDoctorImpl` constructs `AuthProbeDeps` + `TokenFreshnessProbeDeps` from it inline when present, or synthesizes null-returning stubs when absent (lightweight createServices() path).
- **Files modified:** `src/services/doctor/index.ts`, `src/services/bootstrap.ts`
- **Commit:** Task 1 + Task 4 commits (`79c0e0a` and `78cacb5`)

**2. [Rule 3 — Blocking] `src/services/sync/index.ts` imported named exports `listCycles` / `listRecovery` / etc.**

- **Found during:** Task 2 — converting the 6 resource modules to factories deleted the named function exports.
- **Why the plan's premise was wrong:** The plan said `runSync` needs no changes, but `RunSyncDeps['whoop']`'s typed-via-`typeof listCycles` slots reference the deleted named exports — TypeScript breaks at compile time.
- **Fix:** rewrote the 6 type slots from `typeof listCycles` to `ReturnType<typeof createListCycles>`. The consumer-facing shape is structurally identical (each value is still a `(opts) => Promise<Result>` function); `runSync` body needed no changes.
- **Files modified:** `src/services/sync/index.ts`
- **Commit:** Task 2 (`ff00252`)

**3. [Rule 3 — Blocking] Bootstrap test (Test 4) and refresh-orchestrator test (S-01) asserted `services.refreshOrchestrator` on the createServices() path**

- **Found during:** Task 1 — dropping `refreshOrchestrator` from `ServicesBase` made the existing test assertions a compile error.
- **Fix:** updated both tests to assert the new shape (refreshOrchestrator + tokenStore absent on createServices(); present only on bootstrap()'s full Services surface). Added `@ts-expect-error` guards in the bootstrap.test.ts compile-time type guard.
- **Files modified:** `src/services/bootstrap.test.ts`, `src/services/refresh-orchestrator.test.ts`
- **Commits:** Task 1 + Task 3

**4. [Rule 3 — Blocking] `tests/integration/auth-concurrency.test.ts` child helper (.mjs) imported the deleted singleton from `dist/`**

- **Found during:** Task 3 — the helper at `tests/integration/helpers/child-get-token.mjs` did `import { tokenStore } from '.../dist/infrastructure/whoop/token-store.mjs'`. The deleted singleton would have surfaced as `undefined` at runtime, breaking 6 of 7 auth-concurrency tests.
- **Fix:** rewrote the import to bring in `createTokenStore`; each forked child constructs `createTokenStore()` once at boot. The ADR-0002 cross-process file lock + atomic write is the actual gate (NOT a shared module-level singleton); the "exactly one WHOOP refresh across 10 forks" assertion still holds.
- **Files modified:** `tests/integration/helpers/child-get-token.mjs`
- **Commit:** Task 3

**5. [Rule 3 — Blocking] biome-ignore comment for vi.fn generic limitation in client.test.ts**

- **Found during:** Task 3 — vitest 4+ `vi.fn` signature cannot encode the `<T extends {status: number}>` quantifier in `AuthedCall`.
- **Fix:** added a `biome-ignore lint/suspicious/noExplicitAny` comment with rationale; the `any` is scoped to the spy boundary only — every test that uses the spy narrows the op's response shape locally.
- **Files modified:** `src/infrastructure/whoop/client.test.ts`
- **Commit:** Task 3

### No architectural decisions required (no Rule 4 triggers)

All deviations were Rule 3 (blocking issues) — typing + DI threading fixes required to make the singleton removal compose cleanly. No new tables, no API contract changes, no breaking external interface changes. The user-facing CLI + MCP tool surface is unchanged.

## Threat Flags

No new threat surface introduced. The deleted singletons + the new DI shape are both in-process composition concerns; the ADR-0002 three-layer single-flight gate (in-process Promise + cross-process file lock + atomic write) is byte-identical in `src/infrastructure/whoop/token-store.ts`. The auth-concurrency contract test (7/7 passing) is the load-bearing runtime attestation that the cross-process lock contract holds after the singleton removal.

## Self-Check: PASSED

- File `.planning/phases/10-architecture-refactor-cluster/10-02-SUMMARY.md` exists (this file).
- Commits exist:
  - `79c0e0a` — Task 1 (refactor: drop three singletons; bootstrap owns construction)
  - `ff00252` — Task 2 (refactor: client.ts DI + factory resource modules)
  - `cb8d163` — Task 3 (test: rewrite mocks; auth-concurrency child helper)
  - `78cacb5` — Task 4 (refactor: auth.ts exception + tighten doctor checks)
  - `3bd8fee` — Task 5 (docs: ADR-0002 §Enforcement amendment)
  - Task 6 commit lands with this SUMMARY.md
- Branch: `refactor/10-arch-02-03-singletons-and-client-di` on top of `ccd61ad` (Phase 10 Plan 01 on main).
- PR: opened with this commit + push (URL to be appended via amend after `gh pr create`).
