// Anomaly + Z-analysis type contract — D-05 (3-variant ZAnalysis) +
// D-06 (Anomaly firing rule + direction map) + RESEARCH §Statistical
// Engine §1 (MAD=0 edge case → third refused variant). Pure type file;
// no imports beyond the MetricName re-anchor; no runtime behavior.
//
// ZAnalysis is the ADR-0004 forcing function at the type level:
// downstream code that wants to read `.value` MUST first narrow on
// `kind === 'computed'`. Same precedent as Phase 3 D-03 `Score` union
// in `src/domain/types/score.ts` (read `.value` on a `SCORED` arm only).
//
// Three variants, not two, per RESEARCH §Statistical Engine §1: MAD =
// 0 (constant-value baseline window, e.g., `respiratory_rate` quantized
// to 0.1 bpm increments) cannot produce a Z-score (division by zero
// gives NaN); the third `baseline_mad_zero` variant lets the renderer
// surface "metric is flat — no anomaly signal" distinctly from the
// "not enough data" path.

import type { MetricName } from '../baselines/types.js';

/**
 * Per-metric Z-score result, computed against the trailing-30-day
 * SCORED baseline per D-02. Three variants:
 *
 * - `computed` — the baseline cleared every gate, the Z-score was
 *   computed against MAD-scaled robust sigma. `tier` is the
 *   confidence tier of the underlying baseline (`weak` for 14 ≤ n <
 *   20; `strong` for n ≥ 20 per D-13).
 * - `refused` with `reason: 'insufficient_days'` — fewer than 14
 *   SCORED days in the trailing-30 window per D-05 (REV-02 spec floor).
 * - `refused` with `reason: 'baseline_mad_zero'` — sample size cleared,
 *   but every value in the window was identical (MAD = 0), so the
 *   Z-score division is undefined. RESEARCH §Statistical Engine §1
 *   extension; reported separately from `insufficient_days` so the
 *   formatter can distinguish "no data" from "data is flat."
 *
 * The `days_required: 14` literal on the `insufficient_days` arm is a
 * documentation-at-the-type-level pattern — the value is locked at 14
 * (D-13); changing it would require editing this type AND the gating
 * constant in Plan 04-04.
 */
export type ZAnalysis =
  | {
      kind: 'computed';
      value: number;
      baseline_median: number;
      baseline_mad: number;
      tier: 'weak' | 'strong';
    }
  | {
      kind: 'refused';
      reason: 'insufficient_days';
      days_available: number;
      days_required: 14;
    }
  | {
      kind: 'refused';
      reason: 'baseline_mad_zero';
      days_available: number;
    };

/**
 * A surfaced anomaly per D-06. An `Anomaly` is emitted when:
 *   (a) `ZAnalysis.kind === 'computed'`,
 *   (b) `|z| ≥ 2.0`, AND
 *   (c) `direction` is unfavorable per the per-metric direction map
 *       (`HRV/recovery_score/sleep_duration/sleep_efficiency` → bad when
 *       `z ≤ -2`; `RHR/respiratory_rate` → bad when `z ≥ +2`).
 *
 * `day_strain` is bidirectional per D-06 — surfaced as informational
 * only, NEVER as an `Anomaly`. The type-level guard is the
 * `direction: 'low' | 'high'` literal union — no `bidirectional` value
 * is constructible.
 *
 * `baseline_mad_scaled` is the MAD AFTER the 1.4826 scaling that
 * `domain/stats/mad.ts` `robustSigma()` applies (so the formatter can
 * surface "robust σ = 11.86" verbatim without re-scaling). The raw
 * MAD is in `BaselineStats.mad`; the scaled value is what divided into
 * `(value - median)` to produce `z`.
 */
export interface Anomaly {
  metric: MetricName;
  z: number;
  direction: 'low' | 'high';
  baseline_median: number;
  baseline_mad_scaled: number;
  tier: 'weak' | 'strong';
}
