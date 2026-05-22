// Baseline-stats type contract — D-04 metric tuple + raw-MAD-anchored
// BaselineStats shape. Pure type file; no imports, no I/O. Plan 04-02
// Wave 0 ships the contract; Plan 04-04 (baselines/index.ts) computes
// the stats against it.
//
// Shared Pattern 2 (closed-tuple + derived type + runtime Set) — same
// shape as `src/domain/types/score.ts` SCORE_STATES + SCORE_STATES_SET.
// Adding a 10th metric requires editing ONLY this tuple; the derived
// `MetricName` type, the `METRIC_NAMES_SET` runtime check, and the
// `BaselineStats.metric` field type all update from the single edit.
//
// Consumed by:
//   - src/domain/anomalies/types.ts (Plan 04-02 Task 2 — Anomaly.metric)
//   - src/domain/review/types.ts (Plan 04-02 Task 3 — TodayMetrics keys)
//   - future src/domain/baselines/index.ts (Plan 04-04 Wave 1 — computes
//     median + raw MAD into BaselineStats)
//   - future src/domain/stats/mad.ts (Plan 04-03 Wave 1 — `robustSigma()`
//     applies the 1.4826 scaling on top of raw MAD)

/**
 * The 9 raw measurement names that ship in `TodayMetrics` per D-04. Each
 * entry is the canonical snake_case key used in MCP `structuredContent`
 * payloads + CLI rendering. The order matches D-04's listing for
 * cross-reference convenience; downstream code does NOT rely on
 * ordering (every consumer is a `for…of` or a `Record` keyed by name).
 *
 * The 9 names cover both Recovery-scored metrics (`recovery_score`,
 * `hrv_rmssd_milli`, `resting_heart_rate`, `spo2_percentage`,
 * `skin_temp_celsius`), Cycle-scored (`day_strain`), and Sleep-scored
 * (`sleep_duration_minutes`, `sleep_efficiency_percent`,
 * `respiratory_rate`). The normalizer in `src/domain/normalize/` maps
 * the WHOOP wire fields to these keys at the infrastructure boundary
 * (Phase 3 already handles the mapping; Phase 4 reads through it).
 */
export const METRIC_NAMES = [
  'recovery_score',
  'hrv_rmssd_milli',
  'resting_heart_rate',
  'spo2_percentage',
  'skin_temp_celsius',
  'day_strain',
  'sleep_duration_minutes',
  'sleep_efficiency_percent',
  'respiratory_rate',
] as const;

/**
 * Derived metric-name literal union. Used as the `BaselineStats.metric`
 * field type, `Anomaly.metric`, and `ActionCatalogEntry.trigger.anomaly_metric`.
 * A typo at any of those sites is a compile error.
 */
export type MetricName = (typeof METRIC_NAMES)[number];

/**
 * Runtime membership check parallel to `SCORE_STATES_SET` (Phase 3 Plan
 * 03-02). Used at boundaries where a CLI flag or MCP input contains an
 * untrusted string that needs to be validated against the metric list
 * before narrowing through Zod.
 */
export const METRIC_NAMES_SET: ReadonlySet<MetricName> = new Set(METRIC_NAMES);

/**
 * Per-metric baseline summary, computed over the trailing-30-day SCORED
 * window per D-02. The `mad` field is the RAW MAD — `domain/stats/mad.ts`
 * `robustSigma()` applies the 1.4826 scaling at the call site (the Z-score
 * machinery in `domain/stats/zscore.ts` divides by the scaled value).
 * Keeping the raw value in the stat lets Phase 5 surface both via the
 * `whoop://baseline/30d` MCP resource if needed.
 *
 * - `n` is the count of SCORED days that contributed (NOT the raw row
 *   count — `PENDING_SCORE` / `UNSCORABLE` rows are filtered upstream
 *   per ADR-0003).
 * - `coverage_pct` is `n / 30 × 100` rounded to one decimal at the
 *   service layer (this type carries the un-rounded value; the
 *   formatter rounds for display).
 */
export interface BaselineStats {
  metric: MetricName;
  median: number;
  mad: number;
  n: number;
  coverage_pct: number;
}
