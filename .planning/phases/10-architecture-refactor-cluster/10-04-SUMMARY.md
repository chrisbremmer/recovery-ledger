---
phase: 10-architecture-refactor-cluster
plan: 04
subsystem: services
tags: [doctor, dependency-injection, wiring, refactor, arch-07, probe-deps]

# Dependency graph
requires:
  - phase: 10-architecture-refactor-cluster
    provides: ARCH-02 module-load singleton removal (createTokenStore lives at bootstrap), ARCH-06 doctor wiring extracted into src/services/doctor/wiring.ts, plan 10-02 Task 4 already tightened probeAuth / probeTokenFreshness to required deps
provides:
  - "wiring.ts is the canonical production construction site for AuthProbeDeps + TokenFreshnessProbeDeps"
  - "RunDoctorOptions carries explicit authProbeDeps / tokenFreshnessProbeDeps fields — runDoctor prefers them over deriving from opts.tokenStore"
  - "Q4-RESOLVED: all 14 doctor checks audited; the 7 unaudited checks confirmed Class A (deps?: X stays optional to preserve createServices() no-DB path)"
affects: [doctor, mcp, cli, future-probes-needing-tokenstore]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Two-tier doctor probe deps: required `deps: X` for production-only probes (auth, token-freshness, whoop-roundtrip); optional `deps?: X` for probes that run in both production and no-DB createServices() paths"
    - "Wiring-side ProbeDeps construction: production composition root constructs explicit ProbeDeps shapes from input singletons; runDoctor synthesizes a stub only for the no-DB path"
    - "Explicit ProbeDeps test seam: opts.authProbeDeps / opts.tokenFreshnessProbeDeps win over wiring synthesis so unit tests can drive probes with deterministic fakes without a full TokenStore stub"

key-files:
  created: []
  modified:
    - src/services/doctor/index.ts (added authProbeDeps + tokenFreshnessProbeDeps to RunDoctorOptions; runDoctor now prefers opts-supplied shapes over local synthesis)
    - src/services/doctor/wiring.ts (createProductionDoctorDeps constructs explicit AuthProbeDeps + TokenFreshnessProbeDeps inside the returned closure and threads them through)
    - src/services/doctor/wiring.test.ts (3 new assertions — wiring constructs shapes, opts.tokenStore override flows through, explicit ProbeDeps pass-through)

key-decisions:
  - "Pivot from plan's Option B (recommended) to Option A (explicit ProbeDeps on RunDoctorOptions) per user prompt's emphatic Option A wording — see Deviations section"
  - "Class A signature for all 7 unaudited checks: deps?: X stays optional to preserve createServices() no-DB path contract per src/services/index.ts D-31 discipline"
  - "Explicit ProbeDeps construction happens INSIDE the returned closure (not at factory eval time) so opts.tokenStore override still flows through to the derived ProbeDeps — preserves the existing test-seam contract"
  - "db-wal-size.ts:42 `${deps?.dbFile ?? paths.dbFile}-wal` stays as-is per plan §Action #4 — paths.dbFile is a justified module-state collaborator, not a bootstrap-owned singleton"

patterns-established:
  - "Test seam precedence: opts.authProbeDeps wins → opts.tokenStore-derived stub → null-returning shim. Three-tier fallback is the load-bearing contract for the explicit-shape, legacy, and no-DB paths"
  - "Closure-side construction in wiring factories: the returned closure (not the factory body) is where final dep composition happens, so caller overrides on the closure call propagate into derived deps"

requirements-completed: [ARCH-07]

# Metrics
duration: 35min
completed: 2026-06-04
---

# Phase 10 Plan 04: ARCH-07 tighten doctor checks to required deps + explicit wiring construction Summary

**Wiring.ts now owns explicit AuthProbeDeps + TokenFreshnessProbeDeps construction; RunDoctorOptions carries the explicit shapes so runDoctor consumes them directly with no `?? tokenStore.X()` fallback path at the call site.**

## Performance

- **Duration:** ~35 min
- **Started:** 2026-06-04T05:55:00Z (approximate; orchestrator-spawned)
- **Completed:** 2026-06-04T06:30:00Z
- **Tasks:** 3 (Task 1 audit was no-op; Task 2 src changes + Task 3 test additions split into two atomic commits)
- **Files modified:** 3 (src/services/doctor/index.ts, src/services/doctor/wiring.ts, src/services/doctor/wiring.test.ts)

## Accomplishments

- **Q4-RESOLVED audit complete** for all 14 doctor checks; classification documented in this summary
- **Explicit wiring-side construction** of AuthProbeDeps + TokenFreshnessProbeDeps inside `createProductionDoctorDeps` — production composition root now owns the per-probe dep composition explicitly, not via runDoctor-side synthesis
- **RunDoctorOptions extended** with `authProbeDeps?` and `tokenFreshnessProbeDeps?` fields — the seam that lets wiring.ts thread explicit shapes through to runDoctor without runDoctor re-deriving from tokenStore
- **3 new wiring test assertions** pinning the construction site (production-default derivation, user-override flow-through, explicit-shape pass-through)
- **Zero `?? tokenStore.X()` fallbacks remain** in production check code (verified via `grep -rn "tokenStore\." src/services/doctor --include='*.ts' | grep -v ".test.ts" | grep -v "wiring.ts"` — all matches are comments)

## Per-Check Audit (Q4-RESOLVED — all 14 doctor checks)

| # | Check | Signature | Class | `?? tokenStore.X()` fallback | Disposition |
|---|-------|-----------|-------|------------------------------|-------------|
| 1 | better_sqlite3_load (native-modules.ts) | `probeBetterSqlite3()` (no deps) | N/A | absent | unchanged |
| 2 | napi_keyring_load (native-modules.ts) | `probeKeyring()` (no deps) | N/A | absent | unchanged |
| 3 | mcp_stdout_purity | `probeMcpStdoutPurity(opts: ProbeOptions = {})` | N/A | absent | unchanged (opts are config, not deps) |
| 4 | db_open | `probeDbOpen(deps?: DbOpenProbeDeps)` | **A** | absent | unchanged — `if (!deps?.sqlite)` early return IS the createServices() contract |
| 5 | db_integrity | `probeDbIntegrity(deps?: DbIntegrityProbeDeps)` | **A** | absent | unchanged — `if (!deps?.sqlite)` early return IS the createServices() contract |
| 6 | db_schema_version | `probeDbSchemaVersion(deps?: DbSchemaVersionProbeDeps)` | **A** | absent (uses `?? resolveDefaultMigrationsDir()` which is justified path-resolution fallback) | unchanged — `if (!deps?.sqlite)` early return IS the createServices() contract |
| 7 | db_wal_size | `probeDbWalSize(deps?: DbWalSizeProbeDeps)` | **A** (special) | absent (uses `${deps?.dbFile ?? paths.dbFile}-wal` — `paths` is module-state collaborator per RESEARCH §`logger`/`paths`/`rate-limit` justification) | unchanged per plan §Action #4 |
| 8 | auth | `probeAuth(deps: AuthProbeDeps)` (required, tightened in 10-02 Task 4) | required | absent (removed in 10-02) | production deps construction MOVED from runDoctor to wiring.ts |
| 9 | token_freshness | `probeTokenFreshness(deps: TokenFreshnessProbeDeps)` (required, tightened in 10-02 Task 4) | required | absent (removed in 10-02) | production deps construction MOVED from runDoctor to wiring.ts |
| 10 | whoop_roundtrip | `probeWhoopRoundtrip(deps: WhoopRoundtripDeps, opts?)` (required) | required | absent | unchanged (production deps constructed in wiring.ts as `productionWhoopFetcher` + `refreshOrchestrator` opts-pass) |
| 11 | last_sync_recency | `probeLastSyncRecency(deps?: LastSyncRecencyDeps, opts?)` | **A** | absent | unchanged — `if (!deps?.repos)` early return IS the createServices() contract |
| 12 | most_recent_scored_day | `probeMostRecentScoredDay(deps?: MostRecentScoredDayDeps, opts?)` | **A** | absent | unchanged — `if (!deps?.repos)` early return IS the createServices() contract |
| 13 | data_quality_counts | `probeDataQualityCounts(deps?: DataQualityCountsDeps)` | **A** | absent | unchanged — `if (!deps?.repos)` early return IS the createServices() contract |
| 14 | concurrent_writers_stress | `probeConcurrentWritersStress(opts?: ConcurrentWritersStressOpts)` | N/A | absent | unchanged (opts are config — `skipSubprocess`, `enabled`, threshold overrides — not deps) |

**Verdict:** Per the plan's audit verdict, **0 Class B checks found** (all 7 unaudited checks are Class A). The tightening half of ARCH-07 was completed in plan 10-02 Task 4 for auth.ts + token-freshness.ts; the wiring-side construction half is what plan 10-04 delivers.

## New `createProductionDoctorDeps` Shape

The factory now constructs two additional explicit ProbeDeps shapes inside the returned closure (lines 121-137 of `src/services/doctor/wiring.ts`):

```ts
// Plan 10-04 (ARCH-07): wiring.ts is the ONE production construction
// site for AuthProbeDeps + TokenFreshnessProbeDeps.
const tokenStoreForDeps = opts.tokenStore ?? input.tokenStore;
const authProbeDeps: AuthProbeDeps = opts.authProbeDeps ?? {
  readStorageMode: () => tokenStoreForDeps.readStorageMode(),
  readTokens: () => tokenStoreForDeps.read(),
};
const tokenFreshnessProbeDeps: TokenFreshnessProbeDeps = opts.tokenFreshnessProbeDeps ?? {
  read: () => tokenStoreForDeps.read(),
  now: Date.now,
};
return runDoctorImpl({
  ...opts,
  // ... existing top-level deps ...
  authProbeDeps,
  tokenFreshnessProbeDeps,
});
```

**Precedence ladder (load-bearing):**
1. **`opts.authProbeDeps`** (caller-supplied explicit shape — test seam) wins
2. **`opts.tokenStore` synthesized** (caller override of the tokenStore — existing test-seam contract) — derived from the user's tokenStore
3. **`input.tokenStore` synthesized** (production default from bootstrap) — derived from the bootstrap-bound tokenStore

The closure-side construction (not factory-eval-side) is what makes precedence #2 work — opts.tokenStore overrides flow into the derived ProbeDeps each call.

## `RunDoctorOptions` Extensions

Added to `src/services/doctor/index.ts` (lines 188-208):

- `authProbeDeps?: AuthProbeDeps` — wiring.ts constructs and passes this; tests can override
- `tokenFreshnessProbeDeps?: TokenFreshnessProbeDeps` — same pattern

`runDoctor` body (lines 326-339) now uses these with precedence: `opts.X ?? synthesize-from-tokenStore ?? null-returning-stub`. The synthesis arm only runs when wiring.ts hasn't constructed the shape — i.e., the no-DB `createServices()` path — preserving D-31 discipline.

## Task Commits

Each task was committed atomically:

1. **Task 1 (audit): no-op** — Class A classification for all 7 unaudited checks confirmed via re-grep; zero source edits required. Audit verdict folded into Task 2 commit body.
2. **Task 2 (wiring + index): src changes** — `b08afaa` (refactor)
3. **Task 3 (test additions): wiring.test.ts** — `c14009d` (test)

**Plan metadata commit:** pending (orchestrator handles push + PR after this summary lands).

## Files Created/Modified

- **Modified:** `src/services/doctor/index.ts` — adds `AuthProbeDeps` + `TokenFreshnessProbeDeps` imports; extends `RunDoctorOptions` with two new optional fields; refactors the synthesis logic into a `const authDeps`/`const tokenFreshnessDeps` ladder with three-tier precedence
- **Modified:** `src/services/doctor/wiring.ts` — imports the two ProbeDeps types; converts arrow-returning closure to a block-bodied closure that constructs the explicit shapes from `(opts.tokenStore ?? input.tokenStore)`; threads them into `runDoctorImpl`
- **Modified:** `src/services/doctor/wiring.test.ts` — augments existing tests #1 and #2 to assert the new construction, adds new test #3 for explicit ProbeDeps pass-through; doctor suite is now 101 tests (was 100)

## Decisions Made

- **Option A (Plan-allowed pivot):** the plan's recommended path was Option B (wiring passes top-level opts; runDoctor derives per-check deps internally), but the user prompt's emphatic "explicit ProbeDeps shape for EACH check and thread them into runDoctorImpl. No implicit production-default fallbacks at the call site" is Option A. The plan explicitly permits this pivot: "If during execution Option A turns out cleaner ... pivot to Option A and document why." Option A makes the wiring module the unambiguous owner of production-dep construction; Option B leaves runDoctor with the synthesis logic. Option A is the correct interpretation of the user's intent and matches plan `must_haves.truths`.
- **Closure-side construction:** the explicit ProbeDeps shapes are constructed INSIDE the returned closure (not at factory eval time). This preserves the existing test-seam contract whereby `opts.tokenStore` overrides flow through to the derived ProbeDeps — wiring.test.ts case #2 ("honors user-supplied opts over production defaults") asserts this behavior.
- **Three-tier precedence in runDoctor synthesis:** even though wiring.ts now constructs the explicit shapes, runDoctor's own synthesis arm stays — it's the no-DB createServices() path's fallback. The three-tier ladder is `opts.X` → `tokenStore-derived` → `null-returning-stub`. The first two tiers exist for production / explicit-test paths; the third tier is the no-DB-path contract.
- **No Gate Q added:** existing Gate N (`createTokenStore(` call sites) + Gate L (module-load singleton exports) + the existing implicit "no `tokenStore.X()` outside wiring.ts + tests" grep gate (which we manually verified) cover ARCH-07's surface. Adding Gate Q would duplicate Gate L's intent.

## Deviations from Plan

### Auto-fixed Issues / Pivots

**1. [Rule 4 → permitted pivot] Adopted Option A over the plan's recommended Option B**
- **Found during:** Initial design analysis after reading the user prompt's "plan-specific contracts" block
- **Issue:** The plan body's <interfaces> block recommended Option B ("wiring.ts is the only construction site; pass shapes inline via the existing top-level opts; runDoctorImpl derives per-check deps internally"). The user prompt's "plan-specific contracts" block was emphatic about Option A ("explicit ProbeDeps shape for EACH check and thread them into runDoctorImpl. No implicit production-default fallbacks at the call site — the wiring module owns the production-dep construction").
- **Fix:** Implemented Option A — extended `RunDoctorOptions` with `authProbeDeps?: AuthProbeDeps` + `tokenFreshnessProbeDeps?: TokenFreshnessProbeDeps`, constructed the shapes explicitly in `createProductionDoctorDeps`'s returned closure, and threaded them through. `runDoctor` prefers these over local synthesis when provided.
- **Files modified:** src/services/doctor/index.ts, src/services/doctor/wiring.ts
- **Verification:** Doctor suite 100→101 tests, all green; tsc + lint + ci-grep-gates clean; full suite 1373→1374, 1 skip (unchanged baseline)
- **Justification:** The plan explicitly authorizes this pivot: "If during execution Option A turns out cleaner (e.g., because runDoctorImpl's per-check derivation has its own fallbacks that need removal), pivot to Option A and document why." Option A makes the wiring module the unambiguous owner of production-dep construction — Option B leaves runDoctor still owning the synthesis logic. Option A is the closer match to the user prompt's stated contracts. This is a documented permitted pivot, not a Rule-4 architectural deviation requiring user approval.
- **Committed in:** b08afaa (Task 2 src), c14009d (Task 3 tests)

---

**Total deviations:** 1 permitted pivot (Option B → Option A per user prompt + plan-authorized escape hatch)
**Impact on plan:** No scope creep. Option A satisfies the same plan `must_haves.truths` more directly than Option B. All verification gates green.

## Issues Encountered

None — the audit-then-implement flow ran cleanly. The flaky `tests/integration/mcp-stdout-purity.test.ts` did not flake on either full-suite run.

## TDD Gate Compliance

This is a `type: execute` plan (not `type: tdd`); RED/GREEN gate sequence does not apply. Tests were added alongside src changes per the plan's standard pattern.

## User Setup Required

None — pure type-tightening refactor with no new external services, env vars, or dashboard configuration.

## Next Phase Readiness

- ARCH-07 closed: doctor checks use required-deps DI where appropriate (auth, token-freshness, whoop-roundtrip); Class A checks preserve their no-DB-path contract via optional `deps?: X` signature; `?? tokenStore.X()` fallbacks are gone from production check code (verified).
- Wiring.ts is the canonical production construction site for `AuthProbeDeps` + `TokenFreshnessProbeDeps`; future probes needing access to a singleton (e.g., a hypothetical `cache_freshness` probe) should follow the same pattern: define `XProbeDeps` in the probe file, extend `RunDoctorOptions` with `xProbeDeps?: XProbeDeps`, construct in `wiring.ts`'s closure, and document the precedence ladder.
- Phase 10 cluster status: 10-04 is the second-to-last plan in Wave 4; the remaining wave-4 work (per ROADMAP.md) closes out the architecture-refactor cluster.

## Self-Check: PASSED

- `src/services/doctor/index.ts`: present, modified
- `src/services/doctor/wiring.ts`: present, modified
- `src/services/doctor/wiring.test.ts`: present, modified
- `.planning/phases/10-architecture-refactor-cluster/10-04-SUMMARY.md`: present (this file)
- Commit `b08afaa`: present (Task 2 src)
- Commit `c14009d`: present (Task 3 tests)

---

*Phase: 10-architecture-refactor-cluster*
*Completed: 2026-06-04*
