// getWeeklyReview — REV-06 + REV-07 + DEC-04 weekly review orchestrator.
// Composes detectWeeklyPattern (Plan 04-05) + decisionsRepo.countSince
// (Plan 04-06) + buildDataStatus (this plan) into the typed
// WeeklyReviewResult shape per D-16.
//
// Two distinct windows (D-12 + D-17 — KEPT DISTINCT in the result):
//   - trailing-28 pattern-test window (D-12) — wider window is the
//     statistical-power-bearing one; Mann-Whitney's minimum achievable p
//     on n=7 is ~0.286 so FDR @ q=0.10 is mathematically unreachable on
//     weekly data. Drives the `pattern` + `candidate_results` slots.
//   - trailing-7 week_summary window (D-17) — narrative summary only;
//     drives best_day + avg_strain + total_sleep_hours. NOT used for
//     pattern detection.
//
// Both windows are anchored at the SAME reviewed_date returned by
// resolveReviewedDate — re-running --date 2026-03-15 next month gives
// identical pattern + week_summary because nothing reads wall-clock today.
//
// REV-07 FDR-as-typed-positive-output (ADR-0004): detectWeeklyPattern
// returns `kind: 'no_pattern', reason: 'no_factor_cleared_fdr'` when BH
// downgrades every cleared candidate — this service passes that shape
// through verbatim into the result's `pattern` slot.
//
// DEC-04 decision_prompt slot (D-22):
//   - decisionsRepo.countSince(reviewed_date - 7d) → recentCount.
//   - recentCount > 0 → { kind: 'silent' }.
//   - recentCount === 0 → { kind: 'none_this_week',
//                            suggested_text: <from DECISION_PROMPT_CATALOG
//                            matched on pattern.kind/factor> }.
//
// ADR-0001 (MCP stdout purity): no console.*; structured logs through
// Pino → stderr.

import type { Logger } from 'pino';
import { DECISION_PROMPT_CATALOG } from '../../domain/actions/decision-prompts.js';
import { computeBaseline } from '../../domain/baselines/index.js';
import type { BaselineStats } from '../../domain/baselines/types.js';
import { confidenceFromCounts } from '../../domain/confidence/index.js';
import { detectWeeklyPattern } from '../../domain/patterns/pattern.js';
import type { CandidateName, WeeklyPattern } from '../../domain/patterns/types.js';
import type { DecisionPrompt, WeeklyReviewResult, WeekSummary } from '../../domain/review/types.js';
import type { Cycle, Recovery, Sleep } from '../../domain/types/entities.js';
import type { BodyMeasurementsRepo } from '../../infrastructure/db/repositories/body-measurements.repo.js';
import type { CyclesRepo } from '../../infrastructure/db/repositories/cycles.repo.js';
import type { DailySummariesRepo } from '../../infrastructure/db/repositories/daily-summaries.repo.js';
import type { DecisionsRepo } from '../../infrastructure/db/repositories/decisions.repo.js';
import type { ProfileRepo } from '../../infrastructure/db/repositories/profile.repo.js';
import type { RecoveryRepo } from '../../infrastructure/db/repositories/recovery.repo.js';
import type { SleepsRepo } from '../../infrastructure/db/repositories/sleep.repo.js';
import type { SyncRunsRepo } from '../../infrastructure/db/repositories/sync-runs.repo.js';
import type { WorkoutsRepo } from '../../infrastructure/db/repositories/workouts.repo.js';
import { buildDataStatus, subDaysIso } from './data-status.js';
import { resolveReviewedDate } from './resolve-date.js';

const PATTERN_TEST_WINDOW_DAYS = 28;
const WEEK_SUMMARY_WINDOW_DAYS = 7;
const BASELINE_WINDOW_DAYS = 30;
const HRV_BASELINE_MIN_DAYS = 14;

export interface WeeklyReviewDeps {
  repos: {
    cycles: CyclesRepo;
    recoveries: RecoveryRepo;
    sleeps: SleepsRepo;
    workouts: WorkoutsRepo;
    profile: ProfileRepo;
    bodyMeasurements: BodyMeasurementsRepo;
    syncRuns: SyncRunsRepo;
    decisions: DecisionsRepo;
    dailySummaries: DailySummariesRepo;
  };
  clock: () => Date;
  ianaZone: () => string;
  logger: Logger;
}

export async function getWeeklyReview(
  input: { date?: string },
  deps: WeeklyReviewDeps,
): Promise<WeeklyReviewResult> {
  // Step 1: resolve the SINGLE anchor for BOTH windows.
  const resolved = await resolveReviewedDate(input, deps);
  const reviewedDate = resolved.date;

  // Step 2: trailing-7 week_summary window (D-17 — drives week_summary ONLY).
  // weekStartDate is sliced off the trailing-28 array below; no separate
  // read because the trailing-7 narrative slot is a sub-window of the
  // trailing-28 pattern read.
  const weekStartDate = subDaysIso(reviewedDate, WEEK_SUMMARY_WINDOW_DAYS - 1);

  // Step 3: trailing-28 pattern-test window (D-12 — drives pattern detection).
  const patternStartDate = subDaysIso(reviewedDate, PATTERN_TEST_WINDOW_DAYS - 1);
  const patternStartIso = `${patternStartDate}T00:00:00.000Z`;
  const reviewedEndIso = `${reviewedDate}T23:59:59.999Z`;

  // Step 4: trailing-30 baseline window for the hrv_delta_prior_day candidate.
  const baselineStartDate = subDaysIso(reviewedDate, BASELINE_WINDOW_DAYS - 1);
  const baselineStartIso = `${baselineStartDate}T00:00:00.000Z`;

  // Step 5-6: read pattern-test arrays. Default-filtered (SCORED + non-DST-
  // excluded per Phase 3 D-04/D-16; ADR-0003).
  const cyclesPattern = deps.repos.cycles.byRange(patternStartIso, reviewedEndIso);
  const recoveriesPattern = deps.repos.recoveries.byRange(patternStartIso, reviewedEndIso);
  const sleepsPattern = deps.repos.sleeps.byRange(patternStartIso, reviewedEndIso);
  const workoutsPattern = deps.repos.workouts.byRange(patternStartIso, reviewedEndIso);

  // Step 7: HRV baseline for the hrv_delta_prior_day candidate. Pragmatic:
  // a separate trailing-30 read so the baseline is computed against the
  // full 30-day window rather than the pattern test's 28-day arrays.
  // pattern.ts refuses MAD=0 / mad-undefined so the candidate self-refuses
  // gracefully when the baseline can't be computed.
  let hrvBaseline: BaselineStats;
  if (baselineStartDate < patternStartDate) {
    const baselineRecoveries = deps.repos.recoveries.byRange(baselineStartIso, reviewedEndIso);
    hrvBaseline = computeHrvBaseline(baselineRecoveries);
  } else {
    hrvBaseline = computeHrvBaseline(recoveriesPattern);
  }

  // Step 8: build week_summary slot from the trailing-7 sub-window (D-17).
  // Filter the trailing-28 cycles/sleeps arrays down to the trailing-7
  // narrative window — reuses the reads.
  const cyclesWeek = cyclesPattern.filter((c) => c.start.slice(0, 10) >= weekStartDate);
  const sleepsWeek = sleepsPattern.filter((s) => s.end.slice(0, 10) >= weekStartDate);
  const recoveriesWeek = recoveriesPattern.filter((r) => {
    // Recoveries are keyed to cycles; find the parent cycle in the week.
    return cyclesWeek.some((c) => c.id === r.cycleId);
  });

  // Step 9: run pattern detector on the trailing-28 arrays.
  const patternResult = detectWeeklyPattern({
    cycles: cyclesPattern,
    recoveries: recoveriesPattern,
    sleeps: sleepsPattern,
    workouts: workoutsPattern,
    baselines: { hrv_rmssd_milli: hrvBaseline },
    ianaZone: deps.ianaZone(),
  });

  const week_summary: WeekSummary = buildWeekSummary(
    cyclesWeek,
    recoveriesWeek,
    sleepsWeek,
    patternResult.worst_days,
  );

  // Step 10: data_status carries BOTH windows distinctly per D-12 + D-17.
  const baseStatus = buildDataStatus(
    {
      reviewed_date: reviewedDate,
      baselineWindow: {
        start: patternStartDate,
        end: reviewedDate,
        scored_day_count: cyclesPattern.length,
        coverage_pct: (cyclesPattern.length / PATTERN_TEST_WINDOW_DAYS) * 100,
      },
    },
    deps,
  );
  const data_status: WeeklyReviewResult['data_status'] = {
    ...baseStatus,
    week_start: weekStartDate,
    week_end: reviewedDate,
    pattern_test_window: {
      start: patternStartDate,
      end: reviewedDate,
      scored_day_count: cyclesPattern.length,
    },
  };

  // Step 11: confidence is over the D-12 trailing-28 pattern window — the
  // wider window is the statistical-power-bearing one for the weekly view.
  const confidence = confidenceFromCounts({
    scoredDays: cyclesPattern.length,
    windowDays: PATTERN_TEST_WINDOW_DAYS,
  });

  // Step 12: D-22 / DEC-04 decision_prompt slot.
  const sinceIso = `${subDaysIso(reviewedDate, 7)}T00:00:00.000Z`;
  const recentCount = deps.repos.decisions.countSince(sinceIso);
  const decision_prompt: DecisionPrompt =
    recentCount > 0
      ? { kind: 'silent' }
      : {
          kind: 'none_this_week',
          suggested_text: selectDecisionPromptText(patternResult.pattern),
        };

  deps.logger.info({
    event: 'weekly_review_computed',
    reviewed_date: reviewedDate,
    pattern_kind: patternResult.pattern.kind,
    decision_prompt_kind: decision_prompt.kind,
    candidate_count: patternResult.candidate_results.length,
  });

  return {
    data_status,
    week_summary,
    pattern: patternResult.pattern,
    candidate_results: patternResult.candidate_results,
    decision_prompt,
    confidence,
  };
}

// ---------------------------------------------------------------------------
// Helpers — kept private to the service.
// ---------------------------------------------------------------------------

function computeHrvBaseline(recoveries: ReadonlyArray<Recovery>): BaselineStats {
  // ADR-0003: narrow on the discriminator and let TS produce RecoveryScored
  // (where `hrvRmssdMilli: number` is guaranteed) — no cast.
  const values: number[] = [];
  for (const r of recoveries) {
    if (r.scoreState !== 'SCORED') continue;
    const hrv = r.hrvRmssdMilli;
    if (Number.isFinite(hrv)) values.push(hrv);
  }
  if (values.length < HRV_BASELINE_MIN_DAYS) {
    // Return a MAD=0 baseline so the candidate self-refuses inside the
    // pattern detector (it checks `baseline.mad === 0`).
    return {
      metric: 'hrv_rmssd_milli',
      median: 0,
      mad: 0,
      n: values.length,
      coverage_pct: (values.length / BASELINE_WINDOW_DAYS) * 100,
    };
  }
  return computeBaseline('hrv_rmssd_milli', values, BASELINE_WINDOW_DAYS);
}

function buildWeekSummary(
  cycles: ReadonlyArray<Cycle>,
  recoveries: ReadonlyArray<Recovery>,
  sleeps: ReadonlyArray<Sleep>,
  worstDays: WeekSummary['worst_days'],
): WeekSummary {
  // ADR-0003: narrowed on scoreState === 'SCORED' so the TS narrower yields
  // CycleScored / RecoveryScored / SleepScored where the optional metric
  // fields are required `number`. No casts.
  const scoredCycles = cycles.filter(
    (c): c is Cycle & { scoreState: 'SCORED' } => c.scoreState === 'SCORED',
  );
  const scoredRecoveries = recoveries.filter(
    (r): r is Recovery & { scoreState: 'SCORED' } => r.scoreState === 'SCORED',
  );
  const scoredSleeps = sleeps.filter(
    (s): s is Sleep & { scoreState: 'SCORED' } => s.scoreState === 'SCORED',
  );

  let bestDay: WeekSummary['best_day'] = null;
  for (const cycle of scoredCycles) {
    const recovery = scoredRecoveries.find((r) => r.cycleId === cycle.id);
    if (recovery === undefined) continue;
    const score = recovery.recoveryScore;
    if (bestDay === null || score > bestDay.recovery_score) {
      bestDay = { date: cycle.start.slice(0, 10), recovery_score: score };
    }
  }

  const strains: number[] = [];
  for (const c of scoredCycles) {
    if (Number.isFinite(c.strain)) strains.push(c.strain);
  }
  const avgStrain =
    strains.length === 0 ? null : strains.reduce((a, b) => a + b, 0) / strains.length;

  let totalSleepMinutes = 0;
  let sleepCount = 0;
  for (const s of scoredSleeps) {
    const duration = (s.totalInBedTimeMilli - s.totalAwakeTimeMilli) / 60_000;
    if (Number.isFinite(duration)) {
      totalSleepMinutes += duration;
      sleepCount += 1;
    }
  }
  const totalSleepHours = sleepCount === 0 ? null : totalSleepMinutes / 60;

  return {
    scored_day_count: scoredCycles.length,
    worst_days: worstDays,
    best_day: bestDay,
    avg_strain: avgStrain,
    total_sleep_hours: totalSleepHours,
  };
}

function selectDecisionPromptText(pattern: WeeklyPattern): string {
  if (pattern.kind === 'detected') {
    const match = DECISION_PROMPT_CATALOG.find(
      (e) =>
        e.trigger === 'pattern_detected' && e.factor === (pattern.factor satisfies CandidateName),
    );
    if (match !== undefined) return match.text;
  }
  // Generic no_pattern fallback — also serves the detected arm when the
  // catalog doesn't carry an entry for the matched factor (defensive;
  // catalog covers all 5 candidates per D-23).
  const generic = DECISION_PROMPT_CATALOG.find((e) => e.trigger === 'no_pattern');
  if (generic === undefined) {
    throw new Error('selectDecisionPromptText: no_pattern catalog entry missing');
  }
  return generic.text;
}
