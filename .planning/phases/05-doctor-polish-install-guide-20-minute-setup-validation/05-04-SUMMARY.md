---
phase: 05-doctor-polish-install-guide-20-minute-setup-validation
plan: 04
subsystem: doctor
tags: [doctor, sync-recency, scored-day, data-quality, pitfall-19, dependency-injection]
requires:
  - 05-01 (CHECK_NAMES.{LAST_SYNC_RECENCY,MOST_RECENT_SCORED_DAY,DATA_QUALITY_COUNTS}; recovery.repo + sleep.repo latestScoredDate(); cycles/recovery/sleep countByScoreState(); sync-runs.repo latestFinished())
  - src/services/doctor/index.ts (DoctorCheck interface)
  - src/services/doctor/checks/check-names.ts (CHECK_NAMES registry)
provides:
  - probeLastSyncRecency(deps?, opts?) async function returning Promise<DoctorCheck>
  - probeMostRecentScoredDay(deps?, opts?) async function returning Promise<DoctorCheck>
  - probeDataQualityCounts(deps?) async function returning Promise<DoctorCheck> (always pass when repos injected)
  - LastSyncRecencyDeps / MostRecentScoredDayDeps / DataQualityCountsDeps dependency-injection interfaces
affects:
  - 05-06 (will wire all 3 probes into runDoctor's PROBE_NAMES + pass the bootstrap-injected Repos and production clock)
tech-stack:
  added: []
  patterns:
    - dependency-injection repos seam (probe consumes a subset of bootstrap Repos; unit tests pass per-method mocks — pure, no DB)
    - clock injection seam for deterministic threshold math (recency probes only; production omits it and uses new Date())
    - day-granular formatDuration carried locally (token-freshness.ts helper only goes to minutes; recency probes need days + a seconds floor)
    - threshold consts duplicated across the two recency probes for findability (DRY-vs-locality favors duplication at two-file scope)
key-files:
  created:
    - src/services/doctor/checks/last-sync-recency.ts
    - src/services/doctor/checks/last-sync-recency.test.ts
    - src/services/doctor/checks/most-recent-scored-day.ts
    - src/services/doctor/checks/most-recent-scored-day.test.ts
    - src/services/doctor/checks/data-quality-counts.ts
    - src/services/doctor/checks/data-quality-counts.test.ts
  modified:
    - .planning/phases/05-doctor-polish-install-guide-20-minute-setup-validation/deferred-items.md (logged a sibling-plan Gate F trip — see Issues Encountered)
key-decisions:
  - "data_quality_counts catch arm returns FAIL (not always-pass-with-partial-detail). Plan offered both; chose fail-on-throw to match the uniform catch convention of every sibling probe (auth.ts / token-freshness.ts / last-sync-recency.ts) and runDoctor's Promise.allSettled. The always-pass posture applies to the HAPPY path only; a thrown probe is a genuine fault worth surfacing."
  - "formatDuration is inlined per probe rather than imported from token-freshness.ts. The exported sibling helper only formats minutes/hours (no days, no seconds floor); the recency probes need day granularity for the 7d threshold and a seconds floor for sub-minute ages. Two local copies, documented in each file's header."
  - "Threshold consts (RECENCY_PASS_MS 36h / RECENCY_WARN_MS 7d) duplicated in both recency probe files. Plan explicitly authorized duplication for tunability findability at this two-file scope."
  - "Catch arms route err.message through sanitize() (defense-in-depth, matching auth.ts/token-freshness.ts) — the CLI doctor path emits detail strings verbatim via process.stdout.write without the MCP sanitizer wrapper."
patterns-established:
  - "Probe shape: (deps?: {repos?: <subset>}, opts?: {clock?: () => Date}) => Promise<DoctorCheck>. Missing repos -> fail (degenerate-invocation signal)."
  - "yyyy-mm-dd MAX via lexicographic string compare (chronological order coincides) across multiple repos, distinguishing leaders vs trailers in the detail string."
requirements-completed: [DOC-01]
duration: ~8m
completed: 2026-05-28
---

# Phase 5 Plan 04: Sync-Recency & Data-Quality Doctor Checks Summary

Three offline probes ship that together form the "your data is healthy" cross-section: `last_sync_recency` (did a sync run?), `most_recent_scored_day` (is there recent SCORED data, since a sync can succeed with all-PENDING rows?), and the always-pass `data_quality_counts` informational surface (the Pitfall 19 visibility net). All three read through the Plan 05-01 repository layer via a dependency-injection seam; 14 unit tests cover the 36h/7d threshold ladder, the failed-sync downgrade, the cross-resource MAX, and the always-pass discipline. Plan 05-06 wires all three into `runDoctor()` with the bootstrap-injected Repos.

## Performance

- **Duration:** ~8 min
- **Started:** 2026-05-28T17:31Z
- **Completed:** 2026-05-28T17:40Z
- **Tasks:** 3 (all TDD: RED -> GREEN per probe)
- **Files created:** 6 (3 probes + 3 test files)

## Accomplishments

- `probeLastSyncRecency` — reads `repos.syncRuns.latestFinished()`; pass <=36h, warn <=7d, fail >7d; "no syncs yet" -> fail; a recent `failed` sync downgrades the pass arm to warn (a fresh failure is not a clean signal).
- `probeMostRecentScoredDay` — computes the MAX yyyy-mm-dd across `cycles + recovery + sleep` `latestScoredDate()`, distinguishes leaders (tied for the max) from trailers in the detail string, applies the same 36h/7d ladder; all-null -> fail with "no SCORED data yet".
- `probeDataQualityCounts` — ALWAYS `pass` when repos are injected (informational per D-02 #8 / Pitfall 19); detail string concatenates per-resource SCORED/PENDING/UNSCORABLE/excluded counts from `countByScoreState()` in the byte-exact 05-CONTEXT.md §Specifics line 273 format.
- 14 unit tests (6 + 5 + 3), all green, all pure (per-method repo mocks + injected clock; no DB, no WHOOP — ADR-0006).

## Task Commits

Left UNSTAGED and UNCOMMITTED per orchestrator instruction (Wave 1 parallel execution — the orchestrator commits after all parallel agents return). No commit hashes to record by design. Each task followed the TDD RED -> GREEN cycle (RED: test written + run to fail on missing module; GREEN: probe implemented + test re-run to pass).

1. **Task 1: probeLastSyncRecency + tests** — RED confirmed (module-not-found), GREEN 6/6.
2. **Task 2: probeMostRecentScoredDay + tests** — RED confirmed, GREEN 5/5.
3. **Task 3: probeDataQualityCounts + tests** — RED confirmed, GREEN 3/3.

## Files Created/Modified

- `src/services/doctor/checks/last-sync-recency.ts` — sync-recency probe + `LastSyncRecencyDeps` + file-level threshold consts + local `formatDuration`.
- `src/services/doctor/checks/last-sync-recency.test.ts` — 6 cases (no-repos, null, 12h pass, 3d warn, 10d fail, recent-failed warn).
- `src/services/doctor/checks/most-recent-scored-day.ts` — cross-resource MAX probe + `MostRecentScoredDayDeps` + duplicated threshold consts.
- `src/services/doctor/checks/most-recent-scored-day.test.ts` — 5 cases (no-repos, all-null, within-36h pass, 3d warn, 10d fail).
- `src/services/doctor/checks/data-quality-counts.ts` — always-pass informational probe + `DataQualityCountsDeps` + `formatResource` helper.
- `src/services/doctor/checks/data-quality-counts.test.ts` — 3 cases (no-repos fail, byte-exact concatenation, all-zeros).
- `.planning/phases/.../deferred-items.md` — appended the sibling-plan Gate F trip (see Issues Encountered).

## Decisions Made

See `key-decisions` frontmatter. The load-bearing one: `data_quality_counts` returns **fail** on a thrown count-gathering error (plan-allowed deviation), chosen for catch-arm uniformity with every sibling probe and `runDoctor`'s `Promise.allSettled`. The always-pass posture is intact for the happy path — it is the informational discipline for normal operation, not a swallow-all-errors stance.

## Deviations from Plan

### 1. [Plan-authorized] data_quality_counts catch arm returns fail, not always-pass

- **Found during:** Task 3
- **Issue:** The plan offered two defensible catch-arm behaviors — always-pass-with-partial-detail (`'count gathering partially failed: ...'`) OR fail-on-throw — and asked the executor to choose and document.
- **Fix:** Chose fail-on-throw (`'probe threw: <sanitized message>'`), matching auth.ts / token-freshness.ts / the two sibling probes in this plan and `runDoctor`'s synthesized-fail-on-rejection convention. The happy-path always-pass discipline is unchanged.
- **Files modified:** src/services/doctor/checks/data-quality-counts.ts
- **Verification:** Test 1 (no-repos) asserts fail; tests 2-3 assert the always-pass happy path. All green.

### 2. [Plan-authorized] formatDuration inlined per probe rather than imported

- **Found during:** Task 1
- **Issue:** The plan suggested importing `formatDuration` from token-freshness.ts if it is exported (it is). On inspection the exported helper only formats minutes/hours (`45m`, `2h 5m`) — it never emits days and has no seconds floor.
- **Fix:** Inlined a day-granular `formatDuration` (top non-zero unit + next-finer unit: `10d 12h`, `12h`, `18m`, `30s`) in both recency probes. The 7d threshold needs day granularity; the plan's behavior spec explicitly listed `2d 3h` / `30s` outputs the sibling helper cannot produce.
- **Files modified:** src/services/doctor/checks/last-sync-recency.ts, src/services/doctor/checks/most-recent-scored-day.ts
- **Verification:** 3d/10d test cases assert `'3d'`/`'10d'` substrings; 12h/6h cases assert `'12h'`/`'6h'`. All green.

---

**Total deviations:** 2, both explicitly plan-authorized (catch-arm choice; formatDuration locality). No Rule 1/2/3 auto-fixes were needed in my own files. No scope creep.
**Impact on plan:** None — both deviations are documented escape hatches the plan invited.

## Issues Encountered

### Gate F (`fetch(`) trips on a sibling plan's untracked file — NOT in scope

`bash scripts/ci-grep-gates.sh` exits 1 with a single Gate F violation in `src/services/doctor/checks/db-wal-size.ts:22` — a file owned by **Plan 05-03** (the `db_*` probe plan), not Plan 05-04. The offending text is a COMMENT: ``// ... No `drizzle-orm`, no `fetch(`.`` — the literal `fetch(` inside the prose phrase trips Gate F's `\bfetch\s*\(` regex (which does not distinguish comments from code). The same line's `drizzle-orm` mention does NOT trip Gate G because Gate G requires a `from '...drizzle-orm` import.

Per the executor SCOPE BOUNDARY rule I did NOT modify a sibling plan's file. I verified Plan 05-04's own three probe files are Gate-F-clean (ran Gate F's pattern against only those three files — no match), and that `db-wal-size.ts:22` is the *sole* full-scan violation. Logged to `deferred-items.md`. The fix (reword the comment so it omits the literal `fetch(`) belongs to Plan 05-03 or the phase-close pass before the final CI run. When the orchestrator commits all Wave 1 agents together, the sibling agent's corrected comment will let the gate pass.

## Verification Gates

1. **`npx vitest run src/services/doctor/checks/last-sync-recency.test.ts src/services/doctor/checks/most-recent-scored-day.test.ts src/services/doctor/checks/data-quality-counts.test.ts`** — 14/14 tests passed (6 + 5 + 3).
2. **`npx tsc --noEmit`** — shows ONLY the 6 documented pre-existing baseline errors (`src/cli/commands/auth.ts` ×1, `src/infrastructure/db/repositories/sync-runs.repo.ts` ×3, `tests/helpers/msw-whoop-oauth.ts` ×2). ZERO errors mention any of my three probe files. Zero new errors introduced.
3. **`bash scripts/ci-grep-gates.sh`** — exits 1 on a SINGLE Gate F violation, located entirely in the sibling Plan 05-03 file `db-wal-size.ts:22` (a comment). My three files trip NO gate (B/F/G all verified clean against them individually). See Issues Encountered.

## Known Stubs

None. All three probes are fully implemented against their dependency-injection contracts. The only deferred piece is the production wiring (construct the bootstrap Repos + the production clock and add the three probes to `PROBE_NAMES`), which is explicitly Plan 05-06's responsibility (documented in the objective and the `affects` frontmatter).

## Threat Flags

None. The probes introduce no new security surface beyond the plan's `threat_model`. They are pure consumers of read-only repo methods (`latestFinished`, `latestScoredDate`, `countByScoreState` — all SELECT, T-05-T4 mitigated), perform no writes, hold no mutable state, and never bare-fetch. The `data_quality_counts` detail string emits non-sensitive aggregate row counts (T-05-I4 accepted); catch-arm `err.message` is routed through `sanitize()` as defense-in-depth for the CLI verbatim-stdout path.

## Next Phase Readiness

- All three probes export their dependency-injection interfaces and return `Promise<DoctorCheck>` — ready for Plan 05-06 to add to `PROBE_NAMES` and invoke with the bootstrap-injected Repos + production clock.
- Blocker for the FINAL CI run (not for this plan): the sibling Plan 05-03 `db-wal-size.ts:22` comment must be reworded before `scripts/ci-grep-gates.sh` passes. Out of scope for Plan 05-04; logged in `deferred-items.md`.

## Self-Check: PASSED

- FOUND: src/services/doctor/checks/last-sync-recency.ts
- FOUND: src/services/doctor/checks/last-sync-recency.test.ts
- FOUND: src/services/doctor/checks/most-recent-scored-day.ts
- FOUND: src/services/doctor/checks/most-recent-scored-day.test.ts
- FOUND: src/services/doctor/checks/data-quality-counts.ts
- FOUND: src/services/doctor/checks/data-quality-counts.test.ts
- All 6 files left UNSTAGED and UNCOMMITTED per orchestrator instruction (Wave 1 parallel execution — orchestrator commits after all agents return). No commit hashes to verify by design.

---
*Phase: 05-doctor-polish-install-guide-20-minute-setup-validation*
*Completed: 2026-05-28*
