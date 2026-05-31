---
phase: 05-doctor-polish-install-guide-20-minute-setup-validation
plan: 02
subsystem: doctor
tags: [doctor, whoop, online-check, callWithAuth, adr-0002, adr-0007]
requires:
  - 05-01 (CHECK_NAMES.WHOOP_ROUNDTRIP + RunDoctorOptions.offline)
  - src/services/refresh-orchestrator.ts (callWithAuth single-flight chokepoint)
  - src/services/doctor/index.ts (DoctorCheck interface)
provides:
  - probeWhoopRoundtrip async function returning Promise<DoctorCheck>
  - WhoopRoundtripDeps dependency-injection interface
affects:
  - 05-06 (will wire probeWhoopRoundtrip into runDoctor's PROBE_NAMES + construct the production httpGet fetcher)
tech-stack:
  added: []
  patterns:
    - dependency-injection fetcher seam (keeps unit test pure — no httpGet, no MSW)
    - sanitization deferred to MCP register() wrapper (no in-probe sanitize call)
key-files:
  created:
    - src/services/doctor/checks/whoop-roundtrip.ts
    - src/services/doctor/checks/whoop-roundtrip.test.ts
  modified: []
decisions:
  - "WhoopApiError fixture adapted: the class constructor takes a single {kind, detail?, cause?} object, not the illustrative {status, message} shown in the plan. Verified against src/infrastructure/whoop/errors.ts."
  - "Probe does NOT call sanitize() directly — per plan, sanitization is the MCP register() wrapper's job (avoids duplicate sanitization). This differs from auth.ts/token-freshness.ts which DO sanitize because they each predate the chokepoint pattern."
  - "Mock orchestrator's callWithAuth operation parameter is explicitly typed (accessToken: string) => Promise<unknown> to satisfy strict noImplicitAny under the `as unknown as RefreshOrchestrator` cast."
metrics:
  duration: ~6m
  completed: 2026-05-28
---

# Phase 5 Plan 02: whoop_roundtrip Doctor Check Summary

`probeWhoopRoundtrip` ships as the ONE online doctor check — a single
`GET /v2/user/profile/basic` routed through the Phase 2 `callWithAuth`
single-flight orchestrator (ADR-0002) — with 5 unit tests covering all five
documented status arms. Plan 05-06 will wire the production `httpGet` fetcher
into `runDoctor`.

## What Was Built

### src/services/doctor/checks/whoop-roundtrip.ts

- `interface WhoopRoundtripDeps { refreshOrchestrator: RefreshOrchestrator; fetcher: (accessToken: string) => Promise<{status: number; durationMs: number}> }` — the dependency-injection seam. Production wiring (05-06) constructs `fetcher` to call `httpGet('/v2/user/profile/basic', {}, WhoopRawProfile)` wrapped in `performance.now()` timing; the unit test injects a deterministic mock. The probe imports NOTHING from `src/infrastructure/whoop/*`, keeping the test pure (ADR-0006).
- `async function probeWhoopRoundtrip(deps, opts?): Promise<DoctorCheck>`. Status cascade:
  - `opts.offline === true` → `{status: 'pass', detail: 'skipped (--offline)'}` WITHOUT invoking the fetcher (D-03).
  - `result.status === 200` → `{status: 'pass', detail: 'profile fetched in <Math.round(durationMs)>ms'}`.
  - `result.status === 401` → `{status: 'fail', detail: 'WHOOP returned 401 after refresh — run \`recovery-ledger auth\`'}`.
  - any other status → `{status: 'warn', detail: 'WHOOP returned <code> — scopes may have drifted; check developer.whoop.com/dashboard/applications'}`.
  - thrown error → `{status: 'fail', detail: 'roundtrip failed: <message>'}`.
- Type-only imports of `RefreshOrchestrator` + `DoctorCheck`; value import of `CHECK_NAMES`. No `console.*` (ADR-0001 / Gate B), no `fetch(` (Gate F), no `drizzle-orm` (Gate G), no default export.

### src/services/doctor/checks/whoop-roundtrip.test.ts

5 `it()` cases under `describe('probeWhoopRoundtrip', ...)`:
1. offline short-circuit (mock seams reject to prove they are never invoked)
2. 200 pass — asserts `detail === 'profile fetched in 46ms'` (Math.round of 45.7)
3. 401 fail — asserts detail contains `recovery-ledger auth`
4. 403 warn — asserts detail contains `WHOOP returned 403` and `developer.whoop.com/dashboard/applications`
5. network-error fail — `callWithAuth` rejects with a `WhoopApiError`; asserts detail matches `/^roundtrip failed:/` and contains the inner message

Zero real HTTP, zero MSW handlers (ADR-0006 satisfied trivially via the deps-injection seam).

## Deviations from Plan

### 1. [Plan-authorized] WhoopApiError fixture signature adapted

- **Found during:** Task 2
- **Issue:** The plan's illustrative fixture `new WhoopApiError('network error', {status: 0, message: 'fetch failed'})` does not match the actual class — `WhoopApiError`'s constructor takes a single `WhoopApiErrorInit` object `{ kind, detail?, cause? }`.
- **Fix:** Used `new WhoopApiError({ kind: 'network', detail: 'fetch failed' })`. The plan explicitly authorized this ("verify the WhoopApiError constructor signature against src/infrastructure/whoop/errors.ts — adapt if the constructor takes different args"). The probe reads only `err.message` (which `detail` populates), so the assertion `contains('fetch failed')` holds.
- **Files modified:** src/services/doctor/checks/whoop-roundtrip.test.ts

### 2. [Rule 3 - Blocking] Explicit type annotation on mock operation parameter

- **Found during:** Task 2 (first tsc run)
- **Issue:** `forwardingOrchestrator`'s `callWithAuth: async (operation) => ...` tripped TS7006 (implicit `any`) because the surrounding `as unknown as RefreshOrchestrator` cast prevented parameter inference.
- **Fix:** Annotated `operation: (accessToken: string) => Promise<unknown>`. Zero new tsc errors after the fix.
- **Files modified:** src/services/doctor/checks/whoop-roundtrip.test.ts

## Verification Gates

1. **`npx tsc --noEmit`** — shows ONLY the 6 documented pre-existing baseline errors (auth.ts ×1, sync-runs.repo.ts ×3, msw-whoop-oauth.ts ×2). ZERO errors mention `whoop-roundtrip`. (A transient `last-sync-recency.test.ts` TS2307 appeared mid-run — that is a parallel Wave 1 agent's in-flight artifact whose source file is not yet present in the shared working directory; not introduced by this plan.)
2. **`npx vitest run src/services/doctor/checks/whoop-roundtrip.test.ts`** — 5/5 tests passed.
3. **`bash scripts/ci-grep-gates.sh`** — exit 0, "All grep gates passed" (all 10 gates A–J green).

Note: the plan's Task-1 single-file `tsc --noEmit <file>` snippet is unreliable for this ESM/strict project (single-file invocation ignores `tsconfig.json`, producing spurious lib/module-flag errors in OTHER files — none in whoop-roundtrip.ts). The authoritative gate is the full-project `npx tsc --noEmit`, which is clean for the new files.

## Known Stubs

None. The probe is fully implemented against its deps-injection contract; the only deferred piece is the production fetcher construction, which is explicitly Plan 05-06's responsibility (documented in the objective and `affects` frontmatter).

## Threat Flags

None. The probe introduces no new security surface beyond what the threat_model already covered: it is a pure consumer of `callWithAuth` (ADR-0002 chokepoint → `httpGet` Gate-F single-call-site), never bare-fetches, performs no writes, and holds no mutable state. Error detail sanitization is handled at the MCP `register()` boundary (T-05-I2 mitigation).

## Self-Check: PASSED

- FOUND: src/services/doctor/checks/whoop-roundtrip.ts
- FOUND: src/services/doctor/checks/whoop-roundtrip.test.ts
- Both files left UNSTAGED and UNCOMMITTED per orchestrator instruction (Wave 1 parallel execution — orchestrator commits after all agents return). No commit hashes to verify by design.
