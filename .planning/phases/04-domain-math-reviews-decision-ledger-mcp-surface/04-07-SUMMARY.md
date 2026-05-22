---
phase: 04-domain-math-reviews-decision-ledger-mcp-surface
plan: 07
subsystem: services-review

tags:
  - daily-review
  - weekly-review
  - data-status
  - resolve-date
  - sync-runs
  - fixtures
  - rev-04
  - rev-05
  - rev-07
  - d-02
  - d-07
  - d-10
  - d-12
  - d-17
  - dec-04

requires:
  - phase: 04-domain-math-reviews-decision-ledger-mcp-surface
    provides: pure-domain Wave 1 (baselines, anomalies, confidence, patterns, actions, decision-prompt catalog) + Wave 2 services (decision, api-gap) + extended decisions.repo (countSince/updateOutcome/findByPrefix/listAll)
provides:
  - getDailyReview(input, deps) orchestrator returning DailyReviewResult per D-03
  - getWeeklyReview(input, deps) orchestrator returning WeeklyReviewResult per D-16
  - resolveReviewedDate(input, deps) D-01 anchor with cli_flag/latest_scored/fallback_today discriminator
  - buildDataStatus(input, deps) D-03 freshness assembly
  - syncRuns.latestFinished() repo extension narrowing status enum to D-03 user-facing 3
  - 10 fixture JSONs + 2 deterministic generators under tests/fixtures/review/
affects: 04-08 queryCache + bootstrap, 04-09 formatters, 04-10 MCP surface, 04-11 CLI commands, Phase 5 doctor

tech-stack:
  added: []
  patterns:
    - Pattern A — orchestrator + typed Deps + typed Result triple (mirrors src/services/sync/index.ts)
    - Pattern B — service composes default-filtered repo reads, never opts out of SCORED + non-DST-excluded filter (ADR-0003)
    - Pattern C — fixture corpus as JSON spec + deterministic generator (tests/fixtures/review/_generators/) for reviewable diffs and deterministic regeneration
    - Pattern D — D-02 reproducibility anchor — windowing computes from resolveReviewedDate(), never wall-clock today

key-files:
  created:
    - src/services/review/resolve-date.ts
    - src/services/review/resolve-date.test.ts
    - src/services/review/data-status.ts
    - src/services/review/data-status.test.ts
    - src/services/review/daily.ts
    - src/services/review/daily.test.ts
    - src/services/review/weekly.ts
    - src/services/review/weekly.test.ts
    - tests/fixtures/review/daily-strong-confidence.json
    - tests/fixtures/review/daily-weak-confidence.json
    - tests/fixtures/review/daily-insufficient-days.json
    - tests/fixtures/review/daily-no-anomalies.json
    - tests/fixtures/review/daily-three-anomalies-capped.json
    - tests/fixtures/review/weekly-pattern-clears-fdr.json
    - tests/fixtures/review/weekly-pattern-fdr-suppression.json
    - tests/fixtures/review/weekly-pattern-partial-rejection.json
    - tests/fixtures/review/weekly-no-pattern-insufficient-window.json
    - tests/fixtures/review/weekly-decision-prompt-none-this-week.json
    - tests/fixtures/review/_generators/daily.ts
    - tests/fixtures/review/_generators/weekly.ts
  modified:
    - src/infrastructure/db/repositories/sync-runs.repo.ts
    - src/infrastructure/db/repositories/sync-runs.repo.test.ts

key-decisions:
  - "Inline UTC date helpers (diffDaysUtc, subDaysIso) instead of pulling in date-fns — avoids a new runtime dependency for straightforward yyyy-mm-dd math; @date-fns/tz is retained for tz-aware operations only"
  - "Missing-resources heuristic uses trailing-7 window for entity resources (cycles/recoveries/sleeps/workouts) and presence-only check for profile/body_measurements (WHOOP omits updated_at on the single-row endpoints, Phase 3 A4)"
  - "D-10 atomic insufficient path returns ALL FOUR fields (anomalies=[], actions=[], patterns=[], insufficient_reason!=null) at a single early-return site so no other code path can break the contract"
  - "Fixture generators ship under tests/fixtures/review/_generators/ alongside the JSON spec files — future tunability (e.g., regenerating with q=0.05 instead of q=0.10) reuses the generator without losing the deterministic spec"

patterns-established:
  - "Service-orchestrator triple shape (Input/Deps/Result) — mirrors src/services/sync/index.ts; every future review-surface (CLI + MCP) is now a ≤5-line shim"
  - "D-02 reproducibility anchor — every window in this plan (trailing-30 daily baseline, trailing-28 pattern test, trailing-7 week summary) computes from resolveReviewedDate(input.date), never wall-clock today"
  - "D-12 + D-17 window distinction — data_status carries week_start (D-17) AND pattern_test_window (D-12) separately; formatter renders both"
  - "ADR-0004 typed positive output — getDailyReview returns the typed insufficient shape when scoredDays<10; getWeeklyReview passes detectWeeklyPattern's no_pattern arm through verbatim"

requirements-completed:
  - REV-01
  - REV-02
  - REV-03
  - REV-04
  - REV-05
  - REV-06
  - REV-07
  - DEC-04

# Metrics
duration: ~13 min
completed: 2026-05-20
---

# Phase 04 Plan 07: Review Services (Daily + Weekly Orchestrators + Fixtures) Summary

**Two review-service orchestrators + two helpers + 10 fixtures shipped, anchoring REV-01..07 + DEC-04 at the service layer with D-02/D-07/D-10/D-12/D-17 composition discipline.**

## Performance

- **Duration:** ~13 min
- **Started:** 2026-05-20T11:36:00Z (approx)
- **Completed:** 2026-05-20T11:51:00Z
- **Tasks:** 3 (all green)
- **Files created:** 19
- **Files modified:** 2
- **Tests added:** 34 (8 resolve-date, 7 data-status, 11 daily, 8 weekly)
- **Full suite:** 818/818 green, 0 regressions

## Accomplishments

- `getDailyReview` returns the full D-03 DailyReviewResult schema across 5 fixture corpus entries (strong, weak, insufficient, no-anomalies, capped). Composes baselines/anomalies/confidence/actions over default-filtered repo reads (ADR-0003 SCORED-only).
- `getWeeklyReview` returns the full D-16 WeeklyReviewResult schema across 5 fixture corpus entries (clears-fdr, fdr-suppression, partial-rejection, insufficient-window, decision-prompt-none). Composes detectWeeklyPattern + decisionsRepo.countSince + buildDataStatus.
- REV-04 lead-with-data-freshness anchored: `data_status` is the FIRST property in the returned object (Object.keys order locked).
- REV-05 + D-10 atomic typed positive output: insufficient path returns `anomalies=[], actions=[], patterns=[], insufficient_reason!=null` — all four atomic at a single early-return site.
- D-02 reproducibility anchor proved: same `--date` + same fixture across a 4-year clock advance yields identical confidence + anomalies + window because every read derives from `resolveReviewedDate`, not wall-clock today.
- D-07 patterns slot is `[]` across every code path (happy + weak + strong + insufficient + capped) — locked across 5 fixtures.
- D-12 + D-17 windows kept distinct in `data_status` — `week_start`/`week_end` (D-17 trailing-7) AND `pattern_test_window.start`/`end` (D-12 trailing-28) carried separately so Plan 04-09's formatter renders two sections.
- REV-07 load-bearing fixture drives the service through a real composition yielding `no_pattern.no_factor_cleared_fdr` — the ADR-0004 typed positive output is wired end-to-end.
- D-34 `pattern_confidence` flows through unchanged from the pattern detector (`strong` when N≥20 — verified on the clears-fdr fixture).
- DEC-04 decision_prompt dual-mode wired: 0 decisions in last 7d → `none_this_week` with suggested_text from `DECISION_PROMPT_CATALOG`; ≥1 decision → `silent`.
- `syncRuns.latestFinished()` extension narrows the Phase 3 4-state status enum to D-03's 3 user-facing states by excluding 'running' rows at the SQL layer.
- Phase 3 tests still green (all 13 sync-runs tests pass: 8 pre-existing + 5 new).

## Task Commits

1. **Task 1a: syncRuns.latestFinished + resolveReviewedDate** — `99d1b01` (feat)
2. **Task 1b: buildDataStatus** — `d462369` (feat)
3. **Task 2: getDailyReview + 5 daily fixtures + generator** — `52b059d` (feat)
4. **Task 3: getWeeklyReview + 5 weekly fixtures + generator** — `c9e7a0d` (feat)

## Files Created/Modified

### Created
- `src/services/review/resolve-date.ts` — D-01 reviewed_date resolver (cli_flag | latest_scored | fallback_today)
- `src/services/review/resolve-date.test.ts` — 8 tests covering reproducibility + 3-source discriminator + calendar validity
- `src/services/review/data-status.ts` — D-03 DataStatus assembly + inline UTC date helpers (diffDaysUtc, subDaysIso)
- `src/services/review/data-status.test.ts` — 7 tests covering null sync state, sync passthrough, staleness math, missing-resource scan
- `src/services/review/daily.ts` — getDailyReview orchestrator (15-step algorithm per plan body)
- `src/services/review/daily.test.ts` — 11 tests: 5 fixture-corpus + REV-04 lead anchor + D-02 reproducibility + D-07 across all fixtures + Pitfall 5 bidirectional + memoization
- `src/services/review/weekly.ts` — getWeeklyReview orchestrator (13-step algorithm per plan body)
- `src/services/review/weekly.test.ts` — 8 tests: 4 pattern-shape variants + 2 decision_prompt modes + D-12/D-17 window distinction + cross-clock reproducibility
- 5 daily fixture JSONs + 5 weekly fixture JSONs + 2 generators under `tests/fixtures/review/`

### Modified
- `src/infrastructure/db/repositories/sync-runs.repo.ts` — added `latestFinished()` method + `ne` import
- `src/infrastructure/db/repositories/sync-runs.repo.test.ts` — 5 new tests (empty, running-only, ok pass-through, partial/failed pass-through, ignore-newer-running)

## Decisions Made

- **Inline date helpers vs date-fns:** chose inline `diffDaysUtc` + `subDaysIso` for yyyy-mm-dd math. `@date-fns/tz` (already installed) is used for tz-aware operations only; UTC date math is straightforward enough not to warrant adding the `date-fns` runtime dependency. Documented in plan-deviation section.
- **Missing-resources heuristic:** entity resources (cycles/recoveries/sleeps/workouts) use trailing-7 freshness window from `reviewed_date`; profile + body_measurements use presence-only check (WHOOP omits `updated_at` per Phase 3 A4). A long-stale profile row does not surface as "missing" — Phase 5 doctor surfaces sync age.
- **HRV baseline window:** weekly orchestrator computes the HRV baseline over trailing-30 (D-02 reused) for the `hrv_delta_prior_day` candidate; when the baseline window equals the pattern-test window (28 days) the orchestrator reuses the pattern read instead of issuing a second range query.
- **Fixture spec + generator split:** each fixture is a concise JSON spec (review-friendly diffs); the canonical entity-array expansion lives in `tests/fixtures/review/_generators/{daily,weekly}.ts`. Future tunability (q=0.05 instead of q=0.10, different N targets) regenerates via the generator without losing reproducibility.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 — Date library substitution] Used inline UTC helpers instead of date-fns**
- **Found during:** Task 1 (resolve-date + data-status)
- **Issue:** Plan body recommended `date-fns/subDays` + `date-fns/differenceInDays`. Repo has `@date-fns/tz` installed but NOT the base `date-fns` package. Adding a new runtime dependency mid-plan would invoke the Rule 3 package-install exclusion (a checkpoint task).
- **Fix:** Implemented two small pure helpers (`diffDaysUtc`, `subDaysIso`) inline in `data-status.ts` and reused them in `daily.ts` / `weekly.ts`. UTC-anchored yyyy-mm-dd math; behavior parity for the subset of operations the plan needs.
- **Files modified:** `src/services/review/data-status.ts`
- **Verification:** 7 data-status tests + 11 daily + 8 weekly tests all pass with the inline helpers; D-02 reproducibility across 4-year clock advance verified.
- **Committed in:** `d462369` (Task 1b)

**2. [Rule 3 — Test file naming] Test 8 in sync-runs.repo.test.ts renamed to Test 8a + new tests 9-13 appended**
- **Found during:** Task 1a (syncRuns extension)
- **Issue:** Pre-existing Test 8 (corrupted per_resource JSON) sat in the test file; appending Tests 9+ for `latestFinished` needed a stable label.
- **Fix:** Renamed pre-existing "Test 8" to "Test 8a" so the new 5 tests (9-13) for `latestFinished` follow the existing label sequence cleanly.
- **Files modified:** `src/infrastructure/db/repositories/sync-runs.repo.test.ts`
- **Verification:** 13/13 sync-runs tests pass.
- **Committed in:** `99d1b01` (Task 1a)

---

**Total deviations:** 2 auto-fixed (1 dependency-substitution, 1 test-label rename)
**Impact on plan:** Both deviations are housekeeping. The inline date-helper substitution is functionally equivalent to the proposed date-fns calls for the scope this plan uses; the test-label change is purely cosmetic. No scope creep.

## Issues Encountered

None. All 3 tasks executed cleanly; full suite (818 tests) green throughout; all 10 grep gates pass.

## Self-Check

Verified all artifacts:
- `src/services/review/resolve-date.ts` — FOUND
- `src/services/review/data-status.ts` — FOUND
- `src/services/review/daily.ts` — FOUND
- `src/services/review/weekly.ts` — FOUND
- 4 sibling `.test.ts` files — FOUND
- 10 fixture JSONs under `tests/fixtures/review/` — FOUND
- 2 generator files under `tests/fixtures/review/_generators/` — FOUND
- Commit hashes 99d1b01, d462369, 52b059d, c9e7a0d — all present in `git log`

**Self-Check: PASSED**

## Next Phase Readiness

Wave 2 chassis is now complete:
- `services/review/{daily,weekly}.ts` ready for CLI shim consumption (Plan 04-11) — each command becomes a ≤5-line wrapper over the orchestrator.
- Ready for MCP tool wiring (Plan 04-10) — `whoop_daily_review` + `whoop_weekly_review` become register.ts shims over the same service functions.
- Formatter contract (Plan 04-09) has the typed shape it needs to render: `data_status` lead → `today_state` → `anomalies` → `actions` → `confidence` (daily); `week_summary` → `pattern` → `candidate_results` → `decision_prompt` (weekly).
- Fixture corpus under `tests/fixtures/review/` reusable by Wave 3 + Wave 4 contract tests.

No blockers. Phase 4 progress: 6/12 → 7/12 plans complete.

---
*Phase: 04-domain-math-reviews-decision-ledger-mcp-surface*
*Completed: 2026-05-20*
