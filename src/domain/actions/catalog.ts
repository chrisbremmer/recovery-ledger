// ACTION_CATALOG — fixed action catalog per D-08 + D-09. Module-load
// constant; the daily-review action selector (Plan 04-05 select.ts) looks up
// entries by (anomaly_metric, direction) and ranks by `priority` ascending.
//
// Design constraints anchored at this site:
//   - D-08 selection algorithm: filter by (metric, direction) per fired
//     Anomaly; rank by priority ASC; take top 3. Returns [] when no anomaly
//     fired (ADR-0004 typed positive output — empty is the success case).
//   - D-09 + REV-08: each `text` is a verb-first single sentence, < 120
//     chars, banned-word-free. The sibling test asserts every entry against
//     `containsBannedToneToken()` at module load — D-26 source-layer
//     defence; Wave 3 Plan 04-09 adds the rendered-output layer.
//   - REQUIREMENTS Out of Scope (medical advice): no clinical claims, no
//     diagnosis suggestions, no "you may have X" — behavioral framing only.
//
// Coverage per D-06 actionable directions (6 trigger keys):
//   - hrv_rmssd_milli low, recovery_score low, sleep_duration_minutes low,
//     sleep_efficiency_percent low, resting_heart_rate high,
//     respiratory_rate high.
// Bidirectional metrics (day_strain, spo2_percentage, skin_temp_celsius)
// per `ANOMALY_DIRECTION` never fire as Anomaly — they intentionally have
// NO catalog entry.
//
// Priority semantics: lower number = higher priority. Ranges are spaced so
// future entries can slot between existing ones without re-numbering
// every row. Frozen at module load (Object.freeze) so a future PR
// accidentally mutating the array surfaces as a TypeError.
//
// Pure data file: no I/O, no logger, no runtime side effects.

import type { MetricName } from '../baselines/types.js';

export interface ActionCatalogEntry {
  readonly id: string;
  readonly trigger: {
    readonly anomaly_metric: MetricName;
    readonly direction: 'low' | 'high';
  };
  readonly text: string;
  readonly priority: number;
}

/**
 * Fixed action catalog. 12 entries covering all 6 actionable D-06 trigger
 * keys with 2 variants each. Order in source = priority order within a
 * trigger key (the higher-priority entry first). Frozen at module load via
 * `Object.freeze`.
 */
export const ACTION_CATALOG: readonly ActionCatalogEntry[] = Object.freeze([
  // HRV low (z <= -2) — recovery-day framing, no clinical claims.
  {
    id: 'hrv-low-easy-intensity',
    trigger: { anomaly_metric: 'hrv_rmssd_milli', direction: 'low' },
    text: 'Take a recovery day or keep intensity easy.',
    priority: 10,
  },
  {
    id: 'hrv-low-skip-hard-strain',
    trigger: { anomaly_metric: 'hrv_rmssd_milli', direction: 'low' },
    text: 'Hold off on high-strain sessions today.',
    priority: 20,
  },
  // Recovery score low (z <= -2) — same recovery-day arc.
  {
    id: 'recovery-low-easy-day',
    trigger: { anomaly_metric: 'recovery_score', direction: 'low' },
    text: 'Treat today as a recovery day and keep strain under 10.',
    priority: 10,
  },
  {
    id: 'recovery-low-shorten-session',
    trigger: { anomaly_metric: 'recovery_score', direction: 'low' },
    text: 'Shorten the planned session or replace it with a walk.',
    priority: 20,
  },
  // Sleep duration low (z <= -2) — behavioral nudges only.
  {
    id: 'sleep-duration-low-early-bed',
    trigger: { anomaly_metric: 'sleep_duration_minutes', direction: 'low' },
    text: 'Aim for an early lights-out tonight and seven hours of sleep.',
    priority: 10,
  },
  {
    id: 'sleep-duration-low-skip-caffeine',
    trigger: { anomaly_metric: 'sleep_duration_minutes', direction: 'low' },
    text: 'Skip caffeine after noon today.',
    priority: 20,
  },
  // Sleep efficiency low (z <= -2) — environmental + behavioral.
  {
    id: 'sleep-efficiency-low-cool-bedroom',
    trigger: { anomaly_metric: 'sleep_efficiency_percent', direction: 'low' },
    text: 'Lower the bedroom by one or two degrees tonight.',
    priority: 10,
  },
  {
    id: 'sleep-efficiency-low-skip-alcohol',
    trigger: { anomaly_metric: 'sleep_efficiency_percent', direction: 'low' },
    text: 'Skip late-evening alcohol and heavy meals.',
    priority: 20,
  },
  // RHR high (z >= +2) — illness or overtraining framing (no diagnosis).
  {
    id: 'rhr-high-watch-illness',
    trigger: { anomaly_metric: 'resting_heart_rate', direction: 'high' },
    text: 'Watch for early signs of illness or overtraining.',
    priority: 10,
  },
  {
    id: 'rhr-high-hydrate-reassess',
    trigger: { anomaly_metric: 'resting_heart_rate', direction: 'high' },
    text: 'Hydrate well and reassess in twenty-four hours.',
    priority: 20,
  },
  // Respiratory rate high (z >= +2) — illness or overtraining framing.
  {
    id: 'respiratory-high-pause-training',
    trigger: { anomaly_metric: 'respiratory_rate', direction: 'high' },
    text: 'Pause hard training and check for illness.',
    priority: 10,
  },
  {
    id: 'respiratory-high-step-back',
    trigger: { anomaly_metric: 'respiratory_rate', direction: 'high' },
    text: 'Step back from intense sessions today.',
    priority: 20,
  },
] as const) satisfies readonly ActionCatalogEntry[];
