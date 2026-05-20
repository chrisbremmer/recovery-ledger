// Per-metric anomaly direction map — D-06 firing-rule lookup. Module-load
// constant (Shared Pattern 2 — Object.freeze) so the map cannot be mutated
// at runtime; the type-level union `'low' | 'high' | 'bidirectional'` is
// the surface contract.
//
// D-06 (RESEARCH §2) — direction the metric is "bad" in:
//   - hrv_rmssd_milli, recovery_score, sleep_duration_minutes,
//     sleep_efficiency_percent → 'low'  (z <= -2 is unfavorable)
//   - resting_heart_rate, respiratory_rate                 → 'high' (z >= +2 is unfavorable)
//   - day_strain                                            → 'bidirectional' (informational only,
//     NOT actionable per D-06 — surfaced in TodayMetrics but NEVER as an Anomaly)
//
// spo2_percentage + skin_temp_celsius are listed in METRIC_NAMES (D-04)
// but research §2 did not assign them a direction. They ship as
// 'bidirectional' by default so the selectAnomalies firing rule
// (anomaly.ts) cannot fire on them — Phase 5 / V2 may revisit if a
// clinical-direction case lands.
//
// Pure-data file: no I/O, no logger, no console. ADR-0001 / Gate B
// applies even though there's nothing to log here.

import type { MetricName } from '../baselines/types.js';

/**
 * Frozen per-metric direction map. Every entry in METRIC_NAMES has
 * exactly one direction; direction.test.ts asserts the 9-entry coverage
 * and the per-entry mapping verbatim. Adding a 10th metric requires
 * extending METRIC_NAMES (in baselines/types.ts) AND adding a direction
 * here — both are compile-checked via the `satisfies` clause below.
 */
export const ANOMALY_DIRECTION: Readonly<
  Record<MetricName, 'low' | 'high' | 'bidirectional'>
> = Object.freeze({
  hrv_rmssd_milli: 'low',
  recovery_score: 'low',
  sleep_duration_minutes: 'low',
  sleep_efficiency_percent: 'low',
  resting_heart_rate: 'high',
  respiratory_rate: 'high',
  day_strain: 'bidirectional',
  spo2_percentage: 'bidirectional',
  skin_temp_celsius: 'bidirectional',
} as const) satisfies Readonly<Record<MetricName, 'low' | 'high' | 'bidirectional'>>;
