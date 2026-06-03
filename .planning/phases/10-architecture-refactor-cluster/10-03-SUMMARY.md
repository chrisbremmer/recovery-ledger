---
phase: 10-architecture-refactor-cluster
plan: 03
subsystem: services / doctor
tags: [refactor, layering, hexagonal, DI, doctor, ARCH-06, ci-grep-gates]
branch: refactor/10-arch-06-doctor-wiring-extract

# Dependency graph
requires:
  - phase: 10-architecture-refactor-cluster
    provides: 10-02 bootstrap() as the sole construction site for tokenStore + refreshOrchestrator + authedCall; ADR-0002 single-flight gate preserved
  - phase: 05
    provides: runDoctorImpl + RunDoctorOptions + DoctorResult contract (14-probe surface, byte-identical consumer shape)
provides:
  - src/services/doctor/wiring.ts exporting createProductionDoctorDeps(input) — the per-service production-wiring factory pattern future Phase 12 extracts will mirror
  - ProductionDoctorDepsInput interface (sqlite + repos + refreshOrchestrator + authedCall + tokenStore + migrationsDir)
  - 92-line shrink of src/services/bootstrap.ts (538 → 446)
  - Gate O (productionWhoopFetcher forbidden in bootstrap.ts) — fifth grep gate landed in Phase 10
affects: [12-backlog-drain (residual bootstrap.ts extraction — resolveMigrationsDir, stale-running reclassification, dep-shape helpers)]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - Per-service production-wiring factory: bootstrap calls createProductionDoctorDeps(input) exactly once during composition; the returned closure is byte-identical to the previous inline services_runDoctor
    - Mocked-runDoctorImpl + mocked-httpGet unit-test pattern for wiring factories — captures the args the factory routes through without standing up the full pipeline
    - CI grep gate pinning the factory's new home (Gate O) so a future plan cannot silently re-inline the production fetcher in the composition root

key-files:
  created:
    - src/services/doctor/wiring.ts
    - src/services/doctor/wiring.test.ts
    - .planning/phases/10-architecture-refactor-cluster/10-03-SUMMARY.md
  modified:
    - src/services/bootstrap.ts
    - scripts/ci-grep-gates.sh

key-decisions:
  - "The factory's ProductionDoctorDepsInput.repos field uses the bootstrap-side plural keys (recoveries / sleeps) rather than the doctor-probe singular keys (recovery / sleep). The plural→singular remap happens inside the factory body, identical to the previous inline closure. Rationale: bootstrap's repos object is the source of truth in the composition root; forcing bootstrap to rename keys at the call site would have leaked the doctor probe's internal naming into the composition root."
  - "Mocked httpGet rather than mocked authedCall for the WhoopApiError + AuthError unit tests. The real httpGet's withRetry wrapper catches every thrown error and wraps it as WhoopApiError({kind:'network'}), which would mask the unauthorized + AuthError branch mapping the production fetcher must surface. Mocking httpGet directly lets each test drive its rejection shape deterministically and assert the exact branch that fires."
  - "Gate O scope is bootstrap.ts only (not src/services/ broadly) — the canonical definition of productionWhoopFetcher lives in wiring.ts and a wider scope would force the gate to allow-list the home file. Anchoring the gate on the single file that must NOT carry the symbol keeps the contract explicit."
  - "Two grep matches for createProductionDoctorDeps in bootstrap.ts (the import + the call) — the plan's literal acceptance criterion `grep -c = 1` undercounted by missing the import line. Two is the correct count and is consistent with TypeScript's require-an-import discipline; no plan deviation, just a doc accuracy note."
  - "The 250-line bootstrap.ts target stays deferred to Phase 12 per Q2-RESOLVED. 92-line shrink lands bootstrap at 446 LOC — over the amended SC5 (≥ 80 line shrink) with margin. No silent scope creep to hit a more aggressive target."

patterns-established:
  - "Per-service production-wiring factory pattern: bootstrap calls createProductionXyzDeps(input) once per service; the returned closure is byte-identical to the previous inline closure; CI grep gate pins the symbol's new home."
  - "Wiring-factory unit-test seam: mock both the impl that the factory wraps AND any infrastructure call site whose retry/wrap behavior would mask the factory's branch logic. Capture the args the factory routes through and assert against them directly."

# Metrics
metrics:
  duration_minutes: 30
  completed_at: 2026-06-03T16:25:00Z
  bootstrap_loc_before: 538
  bootstrap_loc_after: 446
  bootstrap_loc_delta: -92
  amended_sc5_target: -80
  tests_total_after: 1365
  tests_added: 4
  grep_gates_after: 15
---

# Phase 10 Plan 03: ARCH-06 doctor wiring extract Summary

One-liner: extract the doctor production-wiring block (WHOOP roundtrip fetcher + error-kind-to-HTTP-status mapper + pre-bound runDoctor closure) from bootstrap.ts into a new `src/services/doctor/wiring.ts` factory; bootstrap calls `createProductionDoctorDeps(...)` exactly once; bootstrap.ts shrinks 538 → 446 (-92); new Gate O pins the fetcher's home.

## What landed

### New module: `src/services/doctor/wiring.ts`

Exports:
- `ProductionDoctorDepsInput` — the composition input shape (sqlite + repos + refreshOrchestrator + authedCall + tokenStore + migrationsDir).
- `createProductionDoctorDeps(input): (opts?: RunDoctorOptions) => Promise<DoctorResult>` — the production factory.

The factory captures the input via closure and builds:
1. `whoopErrorKindToStatus(kind)` — the WhoopApiError-kind → HTTP-status mapper (verbatim from the bootstrap.ts inline copy).
2. `productionWhoopFetcher(_accessToken)` — the single GET against `/v2/user/profile/basic` routed through `httpGet(..., input.authedCall)` (ADR-0007 Gate-F allowlisted chokepoint + ADR-0002 single-flight via `authedCall`).
3. The pre-bound runDoctor closure — `runDoctorImpl({ ...opts, sqlite: opts.sqlite ?? input.sqlite, repos: opts.repos ?? {...}, refreshOrchestrator: opts.refreshOrchestrator ?? input.refreshOrchestrator, whoopFetcher: opts.whoopFetcher ?? productionWhoopFetcher, tokenStore: opts.tokenStore ?? input.tokenStore, migrationsDir: opts.migrationsDir ?? input.migrationsDir })`.

The repos plural→singular remap (`recoveries` → `recovery`, `sleeps` → `sleep`) happens inside the factory, identical to the previous inline closure.

### New unit test: `src/services/doctor/wiring.test.ts`

Four cases, all green:
1. **Factory binds production deps into runDoctorImpl** — identity assertions on each slot (sqlite, refreshOrchestrator, tokenStore, migrationsDir, repos.{syncRuns,cycles,recovery,sleep}); the whoopFetcher slot is a function.
2. **User-supplied opts win over production defaults** — supplying `{ sqlite: userSqlite, refreshOrchestrator: userOrchestrator, tokenStore: userTokenStore, migrationsDir: userMigrationsDir }` to the returned closure routes user values through `runDoctorImpl`; production defaults do NOT leak.
3. **productionWhoopFetcher maps WhoopApiError({kind:'unauthorized'}) → status 401** — mocked httpGet rejects with the discriminated error; the factory's catch arm runs `whoopErrorKindToStatus` and returns `{status: 401, durationMs}`.
4. **productionWhoopFetcher maps AuthError → status 401 (ERRC-01)** — mocked httpGet rejects with `AuthError({kind:'auth_expired'})`; the factory's `if (isAuthError(err))` branch fires and returns `{status: 401, durationMs}`, surfacing the same "run `recovery-ledger auth`" remediation as the WhoopApiError path.

The runDoctor pipeline itself is not invoked — `runDoctorImpl` is mocked via `vi.mock('./index.js')` so each test asserts directly on the args the factory routed through. `httpGet` is mocked via `vi.mock('../../infrastructure/whoop/client.js')` so the error-branch tests can drive deterministic rejection shapes; otherwise `withRetry` wraps every thrown error as `WhoopApiError({kind:'network'})` and the unauthorized + AuthError branches never fire.

No real HTTP, no MSW (ADR-0006 fixture-only).

### bootstrap.ts diff

**Before (post-10-02):** 538 lines. Lines 398-502 carried the inline doctor wiring block — comments + `whoopErrorKindToStatus` + `productionWhoopFetcher` + `services_runDoctor`.

**After (post-10-03):** 446 lines. The 105-line inline block is replaced by a ~15-line `createProductionDoctorDeps({...})` factory call. Net delta: **−92 lines** (well above the amended ROADMAP SC5 ≥ 80 line target).

Imports removed (now-unused after the block left):
- `performance` from `node:perf_hooks`
- `isAuthError` from `../domain/errors/auth.js`
- `WhoopRawProfile` from `../domain/schemas/whoop-api.js`
- `WhoopApiError` from `../infrastructure/whoop/errors.js`
- `httpGet` from `../infrastructure/whoop/client.js` (the value-side import; the `AuthedCall` type-side stays — bootstrap still constructs `authedCall: AuthedCall` for the resource module factories)
- `DoctorResult`, `RunDoctorOptions`, `runDoctor as runDoctorImpl` from `./doctor/index.js`; `type runDoctor` stays for the `services.runDoctor: typeof runDoctor` declaration in the Bootstrapped interface

Imports added:
- `createProductionDoctorDeps` from `./doctor/wiring.js`

The `services.runDoctor` field on the Bootstrapped return now references the local `runDoctor` const constructed via the factory; the consumer shape — `(opts?: RunDoctorOptions) => Promise<DoctorResult>` — is byte-identical from the consumer's POV (CLI doctor command + MCP whoop_doctor tool both compose against `app.services.runDoctor(opts)` unchanged).

### Importers touched

Just one: `src/services/bootstrap.ts`. The doctor module's index.ts is unchanged; no other src/ file references `productionWhoopFetcher`, `whoopErrorKindToStatus`, or `services_runDoctor`. The CLI command shim (`src/cli/commands/doctor.ts`) and the MCP tool shim (`src/mcp/tools/whoop-doctor.ts`) both consume `app.services.runDoctor(opts)` — the surface they touch is unchanged.

### New CI grep gate (Gate O)

`scripts/ci-grep-gates.sh` grew from "fourteen (A-N)" to "fifteen (A-O)". Gate O:

- **Pattern:** `\bproductionWhoopFetcher\b`
- **Scope:** `src/services/bootstrap.ts` only
- **Forbids:** any reference to `productionWhoopFetcher` in the composition root — by name, in code, or in prose. The canonical definition lives in `src/services/doctor/wiring.ts` and is not scanned.
- **Test files:** exempt (a future contract test may reference the symbol name in prose).

The gate would trip if a future plan reintroduces the fetcher inline in bootstrap.ts, re-growing the composition root and rebuilding the coupling this extract closed.

Comment discipline: the post-extract comment in bootstrap.ts at line ~386 deliberately avoids the literal substring "productionWhoopFetcher" — per `agent_docs/conventions.md` §Code style + `learnings.md` §L0005, comments that reference grep-gate targets must use semantic phrasing because the gates are word-boundary literal checks with no comment-awareness.

## Verifications run

| Verification | Result |
| --- | --- |
| `wc -l src/services/bootstrap.ts` pre-edit | 538 |
| `wc -l src/services/bootstrap.ts` post-edit | 446 |
| Delta | -92 (target: ≥ -80) |
| `grep -c "productionWhoopFetcher\|whoopErrorKindToStatus\|services_runDoctor" src/services/bootstrap.ts` | 0 |
| `grep -c "createProductionDoctorDeps" src/services/bootstrap.ts` | 2 (import + call — see deviation note below) |
| `grep -c "from './doctor/wiring.js'" src/services/bootstrap.ts` | 1 |
| `npm run lint` | clean (278 files, no fixes applied) |
| `npx tsc --noEmit` | clean (no errors) |
| `bash scripts/ci-grep-gates.sh` | all 15 gates pass |
| `npm run build` | success (dist/cli.mjs 273.75 KB, dist/mcp.mjs 242.52 KB) |
| `npm test` (full suite) | **1365 passed, 1 skipped** (0 failed); duration 8.72s |
| `npm test -- src/services/doctor/wiring.test.ts` | 4 of 4 pass; duration ~300ms |

## Deviations from Plan

None significant. One acceptance-criterion-vs-reality note:

**`grep -c "createProductionDoctorDeps" src/services/bootstrap.ts` returns 2, not 1.** The plan's literal `grep -q "^1$"` check undercounted by missing the import line. 2 is the correct count (one `import { createProductionDoctorDeps } from './doctor/wiring.js'` + one factory invocation). Treating this as the strictly-intended check ("exactly one factory call"), the requirement is met. Filed in the key-decisions list above for traceability.

## Stop conditions met

- All `must_haves.truths` from the plan are satisfied:
  - `src/services/doctor/wiring.ts` exists and exports `createProductionDoctorDeps(input)` returning a pre-bound `runDoctor` of the same shape `bootstrap()` previously surfaced
  - `productionWhoopFetcher`, `whoopErrorKindToStatus`, and `services_runDoctor` no longer live in `bootstrap.ts` — they live in `wiring.ts` (the names changed slightly: the closure inside the factory is anonymous since the factory returns it directly)
  - `bootstrap.ts` shrinks by 92 lines (538 → 446); amended ROADMAP SC5 ≥ 80 satisfied with margin
  - `src/services/doctor/wiring.test.ts` exists; 4 unit cases pass; asserts opts-win-over-defaults and production-deps-as-fallback (cases 1+2) and the error-mapping branches (cases 3+4)
  - Gate O forbids `productionWhoopFetcher` from reappearing in `bootstrap.ts`
  - Existing `bootstrap.test.ts` + `doctor/index.test.ts` tests pass unchanged — the `services.runDoctor` surface is byte-identical from the consumer's POV
- ALL verifications above are green
- This SUMMARY file is written
- All work is committed atomically on `refactor/10-arch-06-doctor-wiring-extract`:
  - `62cf9a2` — refactor(10): extract doctor production wiring to services/doctor/wiring.ts (ARCH-06)
  - `66f0932` — refactor(10): delete doctor wiring block from bootstrap.ts; wire factory; add Gate O (ARCH-06)
- NOT pushed; NO PR opened (orchestrator handoff)

## Self-Check: PASSED

- `src/services/doctor/wiring.ts` exists: FOUND
- `src/services/doctor/wiring.test.ts` exists: FOUND
- Commit `62cf9a2` exists: FOUND
- Commit `66f0932` exists: FOUND
- All 15 grep gates pass: VERIFIED
- Full test suite green (1365 pass / 1 skip / 0 fail): VERIFIED
- `npm run build` succeeds: VERIFIED
- `npm run lint` clean: VERIFIED
- `npx tsc --noEmit` clean: VERIFIED
