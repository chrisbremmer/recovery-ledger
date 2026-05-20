// computeBaseline — per-metric trailing-30 baseline stats per REV-01 +
// D-02 trailing-30 anchor. Pure function: no I/O, no clock, no logger.
//
// D-02 anchor: the trailing-30 window is anchored at `reviewed_date` (NOT
// wall-clock today) so re-runs are reproducible. The SERVICE layer
// (Plan 04-07 services/review/daily.ts) computes `reviewed_date` via
// `resolveReviewedDate()` and pulls the already-windowed + already-
// filtered + SCORED-only values from `cycles.byRange(reviewed_date - 29d,
// reviewed_date)`. This domain function stays pure: it accepts the
// already-prepared values + windowDays and emits BaselineStats.
//
// ADR-0003 discipline: caller MUST pre-filter to SCORED + non-DST-excluded
// + non-null + finite values. This function does not branch on score_state.
//
// MAD = raw (NOT robust-sigma-scaled). RESEARCH §1 + Plan 04-03 anchor:
// `BaselineStats.mad` carries the raw MAD; the 1.4826 consistency factor
// lives ONLY in `src/domain/stats/mad.ts` (Plan 04-03 single source of
// truth), and the anomaly layer (Plan 04-04 anomalies/anomaly.ts) re-
// applies it when computing Z-scores. Storing raw MAD also lets the
// Phase 5 `whoop://baseline/30d` resource surface both raw + scaled.
//
// coverage_pct: raw float (n / windowDays × 100); the formatter at
// Plan 04-09 rounds to one decimal for CLI display.

import { medianAbsoluteDeviation } from 'simple-statistics';

import { median } from '../stats/median.js';

import type { BaselineStats, MetricName } from './types.js';

export function computeBaseline(
  metric: MetricName,
  values: number[],
  windowDays: number,
): BaselineStats {
  if (values.length === 0) {
    throw new Error(`computeBaseline: empty values for metric '${metric}'`);
  }
  return {
    metric,
    median: median(values),
    mad: medianAbsoluteDeviation(values),
    n: values.length,
    coverage_pct: (values.length / windowDays) * 100,
  };
}
