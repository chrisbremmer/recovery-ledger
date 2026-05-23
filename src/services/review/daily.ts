// getDailyReview — REV-01..05 + REV-08 daily review orchestrator. Composes
// every Wave 1 pure-domain module (baselines, anomalies, confidence,
// actions) over the Phase 3 repos + buildDataStatus + resolveReviewedDate
// into the typed DailyReviewResult shape per D-03.
//
// Window discipline (D-02 anchor — anchored at reviewed_date, NOT
// wall-clock today):
//   - baseline window = subDays(reviewed_date, 29) .. reviewed_date
//   - re-running with `--date 2026-03-15` next month gives identical
//     numbers because every read is anchored at reviewed_date.
//
// SCORED-only discipline (ADR-0003): cycles.byRange / recoveries.byRange /
// sleeps.byRange all apply the default SCORED + non-DST-excluded filter
// per Phase 3 D-04/D-16. The service NEVER passes `includeUnscored` /
// `includeExcluded` on the baseline reads. The data-status freshness scan
// (Plan 04-07's buildDataStatus) is the ONLY allowed opt-out site per
// Plan 04-07 D-03 (it counts sync recency, not statistics).
//
// REV-05 + D-10 atomic insufficient path (ADR-0004 typed positive output):
// when `confidence.tier === 'insufficient'` (scoredDays < 10 per D-13),
// the service returns early with anomalies=[], actions=[], patterns=[],
// AND a populated insufficient_reason — ALL FOUR atomic per D-10. No
// other code path sets insufficient_reason.
//
// D-07 patterns slot: ALWAYS [] in v1 — both the happy path AND the
// insufficient path. The renderer (Plan 04-09) omits the section when
// the array is empty; the slot is reserved for V2 multi-day pattern
// detection.
//
// Pitfall 5 (per-metric daysAvailable): HRV may have 12 SCORED days while
// sleep_duration has 22. The service builds perMetricDaysAvailable per
// metric (count of non-null + finite values over the 30-day window) so
// the anomaly detector (Plan 04-04 selectAnomalies) refuses Z-scores on
// the right per-metric subset.
//
// ADR-0001 (MCP stdout purity): no console.*; no process.stdout.write.
// Structured logs via Pino → stderr. Pitfall 17: NEVER log decision text,
// raw metric values, or PII — only `{event, reviewed_date, confidence_tier,
// anomaly_count}`.

import type { Logger } from 'pino';
import { selectActions } from '../../domain/actions/select.js';
import { selectAnomalies } from '../../domain/anomalies/anomaly.js';
import { computeBaseline } from '../../domain/baselines/index.js';
import { type BaselineStats, METRIC_NAMES, type MetricName } from '../../domain/baselines/types.js';
import { confidenceFromCounts } from '../../domain/confidence/index.js';
import type { DailyReviewResult, Pattern, TodayMetrics } from '../../domain/review/types.js';
import type { Cycle, Recovery, Sleep } from '../../domain/types/entities.js';
import type { BodyMeasurementsRepo } from '../../infrastructure/db/repositories/body-measurements.repo.js';
import type { CyclesRepo } from '../../infrastructure/db/repositories/cycles.repo.js';
import type { DailySummariesRepo } from '../../infrastructure/db/repositories/daily-summaries.repo.js';
import type { ProfileRepo } from '../../infrastructure/db/repositories/profile.repo.js';
import type { RecoveryRepo } from '../../infrastructure/db/repositories/recovery.repo.js';
import type { SleepsRepo } from '../../infrastructure/db/repositories/sleep.repo.js';
import type { SyncRunsRepo } from '../../infrastructure/db/repositories/sync-runs.repo.js';
import type { WorkoutsRepo } from '../../infrastructure/db/repositories/workouts.repo.js';
import { buildDataStatus, subDaysIso } from './data-status.js';
import { resolveReviewedDate } from './resolve-date.js';

const BASELINE_WINDOW_DAYS = 30;

export interface DailyReviewDeps {
  repos: {
    cycles: CyclesRepo;
    recoveries: RecoveryRepo;
    sleeps: SleepsRepo;
    workouts: WorkoutsRepo;
    profile: ProfileRepo;
    bodyMeasurements: BodyMeasurementsRepo;
    syncRuns: SyncRunsRepo;
    dailySummaries: DailySummariesRepo;
  };
  clock: () => Date;
  logger: Logger;
}

export async function getDailyReview(
  input: { date?: string },
  deps: DailyReviewDeps,
): Promise<DailyReviewResult> {
  // Step 1: resolve the single anchor for the trailing-30 window.
  const resolved = await resolveReviewedDate(input, deps);
  const reviewedDate = resolved.date;

  // Step 2: compute the D-02 trailing-30 baseline window from reviewed_date.
  const windowStartDate = subDaysIso(reviewedDate, BASELINE_WINDOW_DAYS - 1);
  const windowStartIso = `${windowStartDate}T00:00:00.000Z`;
  const windowEndIso = `${reviewedDate}T23:59:59.999Z`;

  // Step 3-4: read default-filtered cycles/recoveries/sleeps (SCORED-only,
  // non-DST-excluded per Phase 3 D-04/D-16; ADR-0003).
  const cyclesWindow = deps.repos.cycles.byRange(windowStartIso, windowEndIso);
  const recoveriesWindow = deps.repos.recoveries.byRange(windowStartIso, windowEndIso);
  const sleepsWindow = deps.repos.sleeps.byRange(windowStartIso, windowEndIso);

  // Step 5-6: SCORED day count + coverage.
  const scoredDayCount = cyclesWindow.length;
  const coveragePct = (scoredDayCount / BASELINE_WINDOW_DAYS) * 100;

  // Step 7: confidence-tier gate per D-13.
  const confidence = confidenceFromCounts({
    scoredDays: scoredDayCount,
    windowDays: BASELINE_WINDOW_DAYS,
  });

  // Step 8: data_status — REV-04 lead-with-freshness slot.
  const data_status = buildDataStatus(
    {
      reviewed_date: reviewedDate,
      baselineWindow: {
        start: windowStartDate,
        end: reviewedDate,
        scored_day_count: scoredDayCount,
        coverage_pct: coveragePct,
      },
    },
    deps,
  );

  // Step 9: today_state — find the cycle matching reviewed_date.
  const todayCycle = findTodayCycle(cyclesWindow, reviewedDate);
  const todayRecovery = todayCycle ? findRecoveryForCycle(recoveriesWindow, todayCycle.id) : null;
  const todaySleep = findSleepEndingOn(sleepsWindow, reviewedDate);
  const today_state = buildTodayMetrics(todayCycle, todayRecovery, todaySleep);

  // Step 10: D-10 atomic insufficient path — REV-05 typed positive output.
  if (confidence.tier === 'insufficient') {
    deps.logger.info({
      event: 'daily_review_computed',
      reviewed_date: reviewedDate,
      confidence_tier: confidence.tier,
      anomaly_count: 0,
      insufficient: true,
    });
    return {
      data_status,
      today_state,
      anomalies: [],
      patterns: [], // D-07: always [] in v1.
      actions: [],
      confidence,
      insufficient_reason: `${scoredDayCount} SCORED days in baseline window — need 10 minimum`,
    };
  }

  // Step 11: per-metric values + per-metric daysAvailable (Pitfall 5).
  // build via Partial accumulator then assert the exhaustive
  // fill at the boundary. The METRIC_NAMES loop fills every key — the
  // cast is correct, but the Partial accumulator makes the type honest
  // until the fill completes.
  const baselines: BaselineStats[] = [];
  const perMetricDaysAvailablePartial: Partial<Record<MetricName, number>> = {};
  for (const metric of METRIC_NAMES) {
    const values = collectMetricValues(metric, cyclesWindow, recoveriesWindow, sleepsWindow);
    perMetricDaysAvailablePartial[metric] = values.length;
    if (values.length >= 14) {
      baselines.push(computeBaseline(metric, values, BASELINE_WINDOW_DAYS));
    }
  }
  const perMetricDaysAvailable = perMetricDaysAvailablePartial as Record<MetricName, number>;

  // Step 12-13: anomalies → actions.
  const anomalies = selectAnomalies({
    today: today_state,
    baselines,
    perMetricDaysAvailable,
  });
  const actions = selectActions(anomalies);

  // Step 14: daily_summaries memoization. One row per cycle in window — gives
  // Phase 5 doctor a precomputed surface for data-quality counts.
  // Use a single BEGIN IMMEDIATE transaction instead of 30
  // sequential lock+fsync round-trips on cold review.
  const computedAt = deps.clock().toISOString();
  const summariesToUpsert = cyclesWindow.map((cycle) => {
    const cycleDate = cycle.start.slice(0, 10);
    const recovery = findRecoveryForCycle(recoveriesWindow, cycle.id);
    const sleep = findSleepEndingOn(sleepsWindow, cycleDate);
    return {
      date: cycleDate,
      userId: cycle.userId,
      recoveryScore: recovery?.scoreState === 'SCORED' ? recovery.recoveryScore : null,
      sleepEfficiencyPercentage:
        sleep?.scoreState === 'SCORED' ? sleep.sleepEfficiencyPercentage : null,
      dayStrain: cycle.scoreState === 'SCORED' ? cycle.strain : null,
      respiratoryRate: sleep?.scoreState === 'SCORED' ? sleep.respiratoryRate : null,
      hrvRmssdMilli: recovery?.scoreState === 'SCORED' ? recovery.hrvRmssdMilli : null,
      restingHeartRate: recovery?.scoreState === 'SCORED' ? recovery.restingHeartRate : null,
      computedAt,
    };
  });
  deps.repos.dailySummaries.upsertManyDays(summariesToUpsert);

  // Step 15: typed result. D-07 patterns:[] (always-empty v1 slot).
  const patterns: Pattern[] = [];

  deps.logger.info({
    event: 'daily_review_computed',
    reviewed_date: reviewedDate,
    confidence_tier: confidence.tier,
    anomaly_count: anomalies.length,
    action_count: actions.length,
  });

  return {
    data_status,
    today_state,
    anomalies,
    patterns,
    actions,
    confidence,
    insufficient_reason: null,
  };
}

// ---------------------------------------------------------------------------
// Helpers — entity narrowing + metric extraction. Kept private (not exported)
// so the public service surface stays narrow.
// ---------------------------------------------------------------------------

function findTodayCycle(cycles: Cycle[], reviewedDate: string): Cycle | null {
  // byRange returns ASC by start; iterate to find the SCORED cycle whose
  // start day == reviewed_date. SCORED-only by default filter already.
  for (const cycle of cycles) {
    if (cycle.start.slice(0, 10) === reviewedDate) return cycle;
  }
  return null;
}

function findRecoveryForCycle(recoveries: Recovery[], cycleId: number): Recovery | null {
  for (const recovery of recoveries) {
    if (recovery.cycleId === cycleId) return recovery;
  }
  return null;
}

function findSleepEndingOn(sleeps: Sleep[], dateIso: string): Sleep | null {
  for (const sleep of sleeps) {
    if (sleep.end.slice(0, 10) === dateIso) return sleep;
  }
  return null;
}

function buildTodayMetrics(
  cycle: Cycle | null,
  recovery: Recovery | null,
  sleep: Sleep | null,
): TodayMetrics {
  const recoveryScored = recovery?.scoreState === 'SCORED' ? recovery : null;
  const cycleScored = cycle?.scoreState === 'SCORED' ? cycle : null;
  const sleepScored = sleep?.scoreState === 'SCORED' ? sleep : null;
  return {
    recovery_score: recoveryScored?.recoveryScore ?? null,
    hrv_rmssd_milli: recoveryScored?.hrvRmssdMilli ?? null,
    resting_heart_rate: recoveryScored?.restingHeartRate ?? null,
    spo2_percentage: recoveryScored?.spo2Percentage ?? null,
    skin_temp_celsius: recoveryScored?.skinTempCelsius ?? null,
    day_strain: cycleScored?.strain ?? null,
    sleep_duration_minutes: sleepScored
      ? (sleepScored.totalInBedTimeMilli - sleepScored.totalAwakeTimeMilli) / 60_000
      : null,
    sleep_efficiency_percent: sleepScored?.sleepEfficiencyPercentage ?? null,
    respiratory_rate: sleepScored?.respiratoryRate ?? null,
  };
}

/** Collect the non-null + finite values for a metric across the window.
 *  Pitfall 5: per-metric daysAvailable derives from this collection's
 *  length — HRV missing on a given cycle drops that day's HRV without
 *  dropping the day from sleep/duration counts. */
function collectMetricValues(
  metric: MetricName,
  cycles: Cycle[],
  recoveries: Recovery[],
  sleeps: Sleep[],
): number[] {
  const values: number[] = [];
  switch (metric) {
    case 'recovery_score':
    case 'hrv_rmssd_milli':
    case 'resting_heart_rate':
    case 'spo2_percentage':
    case 'skin_temp_celsius': {
      for (const recovery of recoveries) {
        if (recovery.scoreState !== 'SCORED') continue;
        const value =
          metric === 'recovery_score'
            ? recovery.recoveryScore
            : metric === 'hrv_rmssd_milli'
              ? recovery.hrvRmssdMilli
              : metric === 'resting_heart_rate'
                ? recovery.restingHeartRate
                : metric === 'spo2_percentage'
                  ? recovery.spo2Percentage
                  : recovery.skinTempCelsius;
        if (Number.isFinite(value)) values.push(value);
      }
      return values;
    }
    case 'day_strain': {
      for (const cycle of cycles) {
        if (cycle.scoreState !== 'SCORED') continue;
        if (Number.isFinite(cycle.strain)) values.push(cycle.strain);
      }
      return values;
    }
    case 'sleep_duration_minutes': {
      for (const sleep of sleeps) {
        if (sleep.scoreState !== 'SCORED') continue;
        const duration = (sleep.totalInBedTimeMilli - sleep.totalAwakeTimeMilli) / 60_000;
        if (Number.isFinite(duration)) values.push(duration);
      }
      return values;
    }
    case 'sleep_efficiency_percent': {
      for (const sleep of sleeps) {
        if (sleep.scoreState !== 'SCORED') continue;
        if (Number.isFinite(sleep.sleepEfficiencyPercentage)) {
          values.push(sleep.sleepEfficiencyPercentage);
        }
      }
      return values;
    }
    case 'respiratory_rate': {
      for (const sleep of sleeps) {
        if (sleep.scoreState !== 'SCORED') continue;
        if (Number.isFinite(sleep.respiratoryRate)) values.push(sleep.respiratoryRate);
      }
      return values;
    }
  }
}
