---
phase: 05-doctor-polish-install-guide-20-minute-setup-validation
plan: 01
subsystem: infra
tags: [doctor, cli, mcp, sqlite, drizzle, commander, zod, scaffolding]

# Dependency graph
requires:
  - phase: 01-foundation-stdout-pure-mcp-bootstrap
    provides: "runDoctor() orchestrator + CHECK_NAMES registry + DoctorCheck/DoctorResult shape + DOCTOR_EXIT_CODES"
  - phase: 02-oauth-token-store-single-flight-refresh
    provides: "auth + token_freshness offline-safe probes; RunDoctorOptions.skipSubprocessChecks; --offline/--stress precedent (D-22 deferral)"
  - phase: 03-data-model-db-layer-sync-loop
    provides: "cycles/recoveries/sleeps repos + Drizzle schema + in-memory-db helper + SCORED-only default filter (D-04/D-16)"
  - phase: 04-domain-math-reviews-decision-ledger-mcp-surface
    provides: "8-tool MCP surface + register() sanitize chokepoint + tools.length===8 attestation"
provides:
  - "CHECK_NAMES extended 5 -> 14 (9 new D-02 probe-name constants reserved for Waves 1-4)"
  - "RunDoctorOptions extended 1 -> 4 fields (offline?, stress?, sqlite? added to skipSubprocessChecks?)"
  - "recovery-ledger doctor --offline + --stress CLI flags wired through services.runDoctor()"
  - "whoop_doctor MCP inputSchema accepts optional {offline, stress} booleans (body stays <=5 statements)"
  - "latestScoredDate() on recoveries + sleeps repos (mirrors cycles)"
  - "countByScoreState() on cycles + recoveries + sleeps repos"
  - "docs/install/ + templates/ reserved directories (.gitkeep anchors)"
affects: [05-02, 05-03, 05-04, 05-05, 05-06, 05-07, 05-08, 05-09, doctor-probes, install-guide]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Wave-0 scaffolding: registries/options/flags/repo-methods land before the probes that consume them"
    - "exactOptionalPropertyTypes-safe flag coercion (=== true) at both CLI and MCP entry points"
    - "Single-round-trip CASE-WHEN score-state census per repo (countByScoreState)"

key-files:
  created:
    - "docs/install/.gitkeep"
    - "templates/.gitkeep"
  modified:
    - "src/services/doctor/checks/check-names.ts"
    - "src/services/doctor/index.ts"
    - "src/services/doctor/index.test.ts"
    - "src/cli/commands/doctor.ts"
    - "src/cli/commands/doctor.test.ts"
    - "src/cli/index.ts"
    - "src/mcp/tools/whoop-doctor.ts"
    - "src/infrastructure/db/repositories/recovery.repo.ts"
    - "src/infrastructure/db/repositories/recovery.repo.test.ts"
    - "src/infrastructure/db/repositories/sleep.repo.ts"
    - "src/infrastructure/db/repositories/cycles.repo.ts"
    - "src/infrastructure/db/repositories/cycles.repo.test.ts"

key-decisions:
  - "Adapted latestScoredDate() / countByScoreState() per-repo to the real schema: cycles has baseline_excluded (direct filter); recoveries inherit exclusion via the cycles JOIN (matching byRange); sleeps have no exclusion path so excluded is a documented no-op (0)."
  - "Coerced --offline / --stress flags with === true at both the CLI and MCP entry points so exactOptionalPropertyTypes does not reject an explicit undefined and an absent flag deterministically means false."
  - "DOCTOR_EXIT_CODES value unchanged ({pass:0, warn:2, fail:1}); only the WR-06 comment amended per D-04 (sub-code rescission)."

patterns-established:
  - "Wave-0 scaffolding plan ships zero behavior change: runDoctor body, PROBE_NAMES tuple, and the 5-check surface are byte-stable; new options/constants exist for later waves."
  - "Per-repo score-state census via one COALESCE(SUM(CASE WHEN ...)) round trip with COALESCE-to-0 empty-set guard."

requirements-completed: [DOC-01, DOC-02]

# Metrics
duration: ~30min
completed: 2026-05-28
---

# Phase 5 Plan 01: Wave 0 Scaffolding Summary

**Extended the doctor's CHECK_NAMES registry (5->14), RunDoctorOptions (1->4 fields), CLI `--offline`/`--stress` flags, the whoop_doctor MCP inputSchema, and added `latestScoredDate()`+`countByScoreState()` across cycles/recoveries/sleeps repos — all scaffolding for Phase 5's 9 new probes, with zero behavior change to the existing 5-check doctor surface.**

## Performance

- **Duration:** ~30 min
- **Started:** 2026-05-28 (single execution session)
- **Completed:** 2026-05-28
- **Tasks:** 7 of 7
- **Files modified:** 12 (10 source/test modified + 2 .gitkeep created)

## Accomplishments
- `CHECK_NAMES` now has exactly 14 entries — 5 existing (byte-identical) + 9 new D-02 snake_case names (`whoop_roundtrip`, `db_open`, `db_integrity`, `db_schema_version`, `db_wal_size`, `last_sync_recency`, `most_recent_scored_day`, `data_quality_counts`, `concurrent_writers_stress`).
- `RunDoctorOptions` exposes `offline?`, `stress?`, and `sqlite?: Database.Database` alongside the existing `skipSubprocessChecks?`. `runDoctor()` body and the 5-check `Promise.allSettled` sequence are unchanged.
- `recovery-ledger doctor --offline` and `--stress` parse and thread into `services.runDoctor()`; `doctor --help` lists both. `DOCTOR_EXIT_CODES` value unchanged; WR-06 comment rescinded per D-04.
- `whoop_doctor` MCP tool `inputSchema` accepts optional `{offline, stress}` booleans; handler body stays at 2 statements (mcp-shim-loc contract green); `tools.length===8` attestation unchanged; the 4 MCP register/sanitize files are byte-unmodified (D-21).
- `latestScoredDate()` and `countByScoreState()` added to cycles + recoveries + sleeps repos, each adapted to that table's actual exclusion semantics.
- `docs/install/` and `templates/` reserved via 0-byte `.gitkeep` anchors for Wave 2 plans.

## Task Commits

Per the orchestrator's instruction this Wave-0 plan landed as ONE atomic commit on `feat/phase-5` (not per-task commits):

1. **Task 1: Extend CHECK_NAMES 5 -> 14** — (feat)
2. **Task 2: Extend RunDoctorOptions + smoke test** — (feat/test)
3. **Task 3: Wire --offline + --stress CLI flags + D-04 comment rescission** — (feat)
4. **Task 4: Extend whoop_doctor MCP inputSchema** — (feat)
5. **Task 5: latestScoredDate() on recoveries + sleeps (+ 4 recovery tests)** — (feat/test)
6. **Task 6: countByScoreState() on cycles + recoveries + sleeps (+ cycles/recovery tests)** — (feat/test)
7. **Task 7: docs/install/ + templates/ .gitkeep anchors** — (chore)

**Single commit SHA:** see "Commit" line in the execution report (commit message: `feat(05): wave 0 scaffolding — CHECK_NAMES 5→14, RunDoctorOptions, doctor flags, repo helpers (05-01)`).

## Files Created/Modified
- `src/services/doctor/checks/check-names.ts` — 9 new D-02 check-name constants (5 existing byte-identical).
- `src/services/doctor/index.ts` — `RunDoctorOptions` + `offline?`/`stress?`/`sqlite?`; `import type Database from 'better-sqlite3'`.
- `src/services/doctor/index.test.ts` — one smoke test: Phase 5 options accepted without altering the 5-check surface.
- `src/cli/commands/doctor.ts` — widened `runDoctorCommand` signature; threads `offline`/`stress` (=== true) into `runDoctor`; WR-06 comment amended per D-04 (exit-code value unchanged).
- `src/cli/commands/doctor.test.ts` — one test: `runDoctorCommand({ offline: true })` exits with a documented code.
- `src/cli/index.ts` — `.option('--offline', ...)` + `.option('--stress', ...)` on the `doctor` command.
- `src/mcp/tools/whoop-doctor.ts` — `import { z }`; `inputSchema: { offline, stress }`; handler reads `input`; TOOL_DESCRIPTION + MR-35 comment updated.
- `src/infrastructure/db/repositories/recovery.repo.ts` — `latestScoredDate()` (cycles-JOIN exclusion) + `countByScoreState()` (cycles-JOIN exclusion).
- `src/infrastructure/db/repositories/recovery.repo.test.ts` — 4 `latestScoredDate` cases + 2 `countByScoreState` cases.
- `src/infrastructure/db/repositories/sleep.repo.ts` — `latestScoredDate()` (MAX(start), SCORED) + `countByScoreState()` (excluded always 0); covered by Plan 05-04 per the in-repo comment.
- `src/infrastructure/db/repositories/cycles.repo.ts` — `countByScoreState()` (direct baseline_excluded filter).
- `src/infrastructure/db/repositories/cycles.repo.test.ts` — 2 `countByScoreState` cases.
- `docs/install/.gitkeep`, `templates/.gitkeep` — 0-byte reserved-directory anchors.

## Decisions Made
- **Schema-aware repo-method adaptation (see Deviations Rule 1/3 below).** The plan's verbatim SQL assumed a `baseline_excluded` column on every table. Only `cycles` has one. Recoveries inherit exclusion via a cycles JOIN (mirroring the existing `byRange`); sleeps have no exclusion path so `excluded` is a documented no-op (0). This is required for the code to compile and return correct counts.
- **`=== true` flag coercion at both entry points.** Under the project's `exactOptionalPropertyTypes: true`, passing `offline: input?.offline` (`boolean | undefined`) to `offline?: boolean` is a type error. Coercing with `=== true` (matching the CLI path) keeps `RunDoctorOptions` strict and makes "flag absent" deterministically `false`.
- **DOCTOR_EXIT_CODES untouched.** Only the WR-06 comment changed (D-04 sub-code rescission); the frozen `{pass:0, warn:2, fail:1}` map is byte-identical.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] whoop_doctor option threading violated `exactOptionalPropertyTypes`**
- **Found during:** Task 4 (MCP inputSchema extension)
- **Issue:** The plan specified `offline: input?.offline` / `stress: input?.stress`. With `exactOptionalPropertyTypes: true`, `boolean | undefined` is not assignable to `offline?: boolean`, producing a NEW tsc error at `whoop-doctor.ts:67`.
- **Fix:** Coerced to `input?.offline === true` / `input?.stress === true` (mirroring the CLI path's documented coercion). Semantically identical (absent -> false, the documented default) and type-clean.
- **Files modified:** src/mcp/tools/whoop-doctor.ts
- **Verification:** `npx tsc --noEmit` diff against the pre-existing baseline is IDENTICAL (zero new errors); MCP test suite + shim-LOC contract green.

**2. [Rule 1 - Bug] Repo SQL adapted to real per-table exclusion schema**
- **Found during:** Tasks 5 + 6 (latestScoredDate / countByScoreState)
- **Issue:** The plan's verbatim SQL (`... AND baseline_excluded=0` on each table) does not match the actual schema — recoveries and sleeps have NO `baseline_excluded` column. Copying it verbatim would not compile / would silently misfilter.
- **Fix:** cycles uses the direct `baseline_excluded` filter; recoveries resolve exclusion via the `cyclesTable` JOIN (identical to the existing `byRange`); sleeps treat exclusion as a no-op (excluded=0), matching `byRange`'s documented `includeExcluded` no-op posture. recoveries also use `MAX(created_at)` (they have no `start` column, per A4) while sleeps use `MAX(start)`.
- **Files modified:** recovery.repo.ts, sleep.repo.ts, cycles.repo.ts (+ their test files)
- **Verification:** New tests assert the 4-case latestScoredDate matrix on recoveries (incl. exclusion-via-parent-cycle) and the {scored:3,pending:1,unscorable:1,excluded:1} census on cycles + recoveries; all green.

**3. [Rule 3 - Blocking] Biome reformatted a long `and(...)` predicate**
- **Found during:** Post-Task-6 lint check
- **Issue:** `biome check` flagged the multi-line `and(...)` in recovery.repo.ts `latestScoredDate`.
- **Fix:** `biome check --write` collapsed it to one line. No logic change.
- **Files modified:** src/infrastructure/db/repositories/recovery.repo.ts
- **Verification:** `biome check` on all 12 changed files: no fixes applied; repo tests still 37/37 green.

---

**Total deviations:** 3 auto-fixed (2 blocking, 1 bug). Plus 1 documentation note (below).
**Impact on plan:** All three were necessary for the code to compile, type-check cleanly, lint, and return correct results. No scope creep — zero new probes shipped; the 5-check doctor surface is byte-stable.

### Documentation discrepancy (no code impact)
- The plan's verification Gate 6 and `<threat_model>` reference `src/mcp/sanitize.ts`. That file does not exist — the real sanitizer is `src/infrastructure/observability/sanitize.ts` (per `register.ts`'s import). The D-21 intent (sanitizer + 3 register files unmodified) is satisfied: `git diff` over the real sanitizer + `register.ts` + `register-resource.ts` + `register-prompt.ts` is empty.

## Issues Encountered
- **Pre-existing `npx tsc --noEmit` failures (out of scope).** The `feat/phase-5` branch (and `main`) already has 6 tsc errors in files this plan does not touch (`auth.ts`, `sync-runs.repo.ts`, `tests/helpers/msw-whoop-oauth.ts`). Confirmed by stashing all 05-01 changes (identical error set) and by `git diff main...HEAD` being empty for those files. Logged to `deferred-items.md`. This plan introduces **zero** new tsc errors (verified by an identical error-set diff). The project's actual CI gates (`vitest run`, `biome check`, `scripts/ci-grep-gates.sh`) all pass.

## Verification Gate Results
- **`npx tsc --noEmit`:** 6 pre-existing errors only (identical to baseline; zero introduced by this plan). Documented in `deferred-items.md`.
- **`vitest run src/services/doctor/ src/infrastructure/db/repositories/`:** 10 files, 121 tests — all green.
- **`npm run build`:** success; `dist/cli.mjs` produced.
- **`node dist/cli.mjs doctor --help`:** lists `--offline`, `--stress`, `--text` (count 3).
- **`bash scripts/ci-grep-gates.sh`:** all 10 gates green (exit 0).
- **MCP attestation (`mcp-runtime` + `mcp-shim-loc`):** 22 tests green; `tools.length===8` unchanged.
- **D-21 attestation:** real sanitizer + 3 register files — diff empty.

## Next Phase Readiness
- Wave 1 plans (05-02..05-05) can now reference any `CHECK_NAMES.*` constant and the `RunDoctorOptions.{offline, stress, sqlite}` fields.
- Plan 05-04's `most_recent_scored_day` + `data_quality_counts` probes can call `latestScoredDate()` / `countByScoreState()` across all three SCORED repos.
- Plan 05-06 will extend `PROBE_NAMES` (still 5 entries) and add the 9 probe files + their `runDoctor()` wiring.
- Wave 2 plans (05-07..05-09) have `docs/install/` and `templates/` to drop files into.
- **Carry-forward note:** the pre-existing tsc errors in `deferred-items.md` should be resolved before the Phase 5 close plan if its acceptance criteria require a clean `tsc --noEmit`.

## Self-Check: PASSED

All 12 plan files + the 2 reserved `.gitkeep` anchors + the SUMMARY exist on disk. Artifact sentinels verified: `check-names.ts` contains `WHOOP_ROUNDTRIP`; `doctor/index.ts` + `cli/commands/doctor.ts` contain `offline`; `whoop-doctor.ts` contains `z.boolean`; `recovery.repo.ts` + `sleep.repo.ts` contain `latestScoredDate`. Commit landed on `feat/phase-5` (SHA in the execution report).

---
*Phase: 05-doctor-polish-install-guide-20-minute-setup-validation*
*Completed: 2026-05-28*
