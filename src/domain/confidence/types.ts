// Confidence-gate type contract — D-13 tier thresholds + ConfidenceGate
// shape. Pure type file; no imports, no I/O. Plan 04-02 Wave 0 ships
// the contract; Plan 04-04 / Plan 04-06 (confidence/index.ts) compute
// the gate against it.
//
// Per ADR-0003 + ADR-0004: the gate inputs are SCORED-day counts (not
// raw row counts) and the gate is a typed positive output (the
// `insufficient` tier is a first-class result, not an error path). The
// `DailyReviewResult` + `WeeklyReviewResult` schemas both carry a
// `confidence: ConfidenceGate` slot per D-03 + D-16.
//
// Tier thresholds (D-13, locked):
//   - insufficient : SCORED-day count < 10  → minRequired = 10
//   - weak         : 10 ≤ count < 20        → minRequired = 10 (cleared)
//   - strong       : count ≥ 20             → minRequired = 20 (cleared)
//
// Z-scores are refused at < 14 SCORED days (D-05 `ZAnalysis.refused`);
// pattern detection is refused at < 14 SCORED days in the trailing-28
// window (D-13 `insufficient_window_days`). Those are separate gates
// from this confidence tier — both can fire while the daily review
// still computes against a 10-day baseline.

/**
 * Three-tier confidence literal (D-13). `'insufficient'` is the
 * ADR-0004 typed positive output — the review STILL renders, but with
 * `actions = []` and `anomalies = []` and a populated
 * `insufficient_reason` per D-10.
 */
export type ConfidenceTier = 'insufficient' | 'weak' | 'strong';

/**
 * Confidence-tier gate, attached to every `DailyReviewResult` +
 * `WeeklyReviewResult` per D-03 + D-16. The `minRequired: 10 | 20`
 * literal-tuple-as-doc encodes the D-13 thresholds at the type level —
 * `10` for `insufficient` or `weak` tiers, `20` for `strong`. Adding a
 * fourth threshold (e.g., a 30-day "very strong" tier) requires
 * extending both this literal AND the `ConfidenceTier` union.
 *
 * - `coveragePct` is `sampleSize / window × 100` — the trailing-30
 *   window for daily review, the trailing-28 window for weekly pattern
 *   detection (the two windows are intentionally different per D-12 +
 *   D-17 to give the weekly Mann-Whitney test enough power).
 * - `sampleSize` is the SCORED-only count — see ADR-0003 §Confidence-
 *   tier rules ("apply to the SCORED count, not the row count").
 */
export interface ConfidenceGate {
  tier: ConfidenceTier;
  coveragePct: number;
  minRequired: 10 | 20;
  sampleSize: number;
}
