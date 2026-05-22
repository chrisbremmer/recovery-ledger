// computeZAnalysis + selectAnomalies — D-05 (Z-score gating) + D-06
// (firing rule + direction lookup). Pure functions: no I/O, no clock,
// no logger.
//
// D-05 Z-score gating (computeZAnalysis):
//   - daysAvailable < 14    → refused.insufficient_days
//   - value is null/NaN     → refused.insufficient_days (defensive belt-and-braces;
//                              caller in Plan 04-07 should pre-filter)
//   - baseline.mad === 0    → refused.baseline_mad_zero (Pitfall 12 NaN-cascade fix)
//   - otherwise             → computed { value, tier: 'weak' | 'strong' }
//
// Robust σ scaling: z = (value - median) / (MAD_CONSISTENCY × mad). The
// 1.4826 constant is sourced from src/domain/stats/mad.ts as
// `MAD_CONSISTENCY` — Plan 04-03 anchors the single definition site so
// this file does not re-declare the literal.
//
// D-06 firing rule (selectAnomalies) — emits one Anomaly per metric when
// ALL of these hold:
//   (a) ZAnalysis.kind === 'computed'
//   (b) direction is 'low' or 'high' (NOT 'bidirectional' — informational
//       metrics like day_strain/spo2/skin_temp never fire)
//   (c) z meets the directional threshold:
//       - 'low'  → z <= -2.0
//       - 'high' → z >= +2.0
//
// ADR-0004: an empty Anomaly[] is a typed positive output (NOT an error).
// The mixed-run / all-favorable test cases lock the contract.
//
// Pitfall 5 (mixed-recency Z-refusal): daysAvailable is PER METRIC — the
// service layer (Plan 04-07 services/review/daily.ts) computes the count
// per metric (HRV may have 12 days while sleep has 22) and passes it as
// `perMetricDaysAvailable: Record<MetricName, number>`. This domain
// function consumes the pre-computed map.

import { type BaselineStats, METRIC_NAMES, type MetricName } from '../baselines/types.js';
import type { TodayMetrics } from '../review/types.js';
import { MAD_CONSISTENCY } from '../stats/mad.js';

import { ANOMALY_DIRECTION } from './direction.js';

import type { Anomaly, ZAnalysis } from './types.js';

/** Z-analysis sample-size threshold (Review #52). 14 SCORED days is the
 *  minimum the baseline window admits — see RESEARCH §Pitfall 5 + ADR
 *  on per-metric Z refusal. Exported so callers can `daysRequired:
 *  DAYS_REQUIRED` instead of repeating the magic literal. */
export const DAYS_REQUIRED = 14 as const;

export function computeZAnalysis(input: {
  value: number | null;
  baseline: BaselineStats;
  daysAvailable: number;
  daysRequired: typeof DAYS_REQUIRED;
}): ZAnalysis {
  if (input.value === null || !Number.isFinite(input.value)) {
    return {
      kind: 'refused',
      reason: 'insufficient_days',
      days_available: input.daysAvailable,
      days_required: input.daysRequired,
    };
  }

  if (input.daysAvailable < input.daysRequired) {
    return {
      kind: 'refused',
      reason: 'insufficient_days',
      days_available: input.daysAvailable,
      days_required: input.daysRequired,
    };
  }

  if (input.baseline.mad === 0) {
    return {
      kind: 'refused',
      reason: 'baseline_mad_zero',
      days_available: input.daysAvailable,
    };
  }

  const robustSigma = MAD_CONSISTENCY * input.baseline.mad;
  const z = (input.value - input.baseline.median) / robustSigma;

  return {
    kind: 'computed',
    value: z,
    baseline_median: input.baseline.median,
    baseline_mad: input.baseline.mad,
    tier: input.daysAvailable >= 20 ? 'strong' : 'weak',
  };
}

export function selectAnomalies(input: {
  today: TodayMetrics;
  baselines: BaselineStats[];
  perMetricDaysAvailable: Record<MetricName, number>;
}): Anomaly[] {
  const baselineByMetric = new Map<MetricName, BaselineStats>(
    input.baselines.map((b) => [b.metric, b]),
  );

  const out: Anomaly[] = [];

  for (const metric of METRIC_NAMES) {
    const baseline = baselineByMetric.get(metric);
    if (baseline === undefined) {
      continue;
    }

    const direction = ANOMALY_DIRECTION[metric];
    if (direction === 'bidirectional') {
      // D-06: informational metrics never fire as Anomaly.
      continue;
    }

    const value = input.today[metric];
    const analysis = computeZAnalysis({
      value,
      baseline,
      daysAvailable: input.perMetricDaysAvailable[metric],
      daysRequired: DAYS_REQUIRED,
    });

    if (analysis.kind === 'refused') {
      continue;
    }

    const z = analysis.value;
    const fires = (direction === 'low' && z <= -2) || (direction === 'high' && z >= 2);
    if (!fires) {
      continue;
    }

    out.push({
      metric,
      z,
      direction,
      baseline_median: analysis.baseline_median,
      baseline_mad_scaled: MAD_CONSISTENCY * analysis.baseline_mad,
      tier: analysis.tier,
    });
  }

  return out;
}
