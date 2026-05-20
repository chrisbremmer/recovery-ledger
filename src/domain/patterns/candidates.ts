// 5 pre-registered candidate factors (D-11). Pre-registration = declared in
// advance to prevent p-hacking. Dropped from REV-06's 7-factor list:
//   - rhr_delta_prior_day — multicollinearity with HRV (both reflect autonomic
//     state); BH FDR assumes test independence so correlated tests inflate
//     false-positive rates. HRV is the more sensitive of the two.
//   - respiratory_rate_anomaly_prior_day — rare events; under MAD scaling the
//     anomaly fires < 5% of cycles → statistical power is poor regardless of
//     window size. Better surfaced as a current-day red-flag anomaly in the
//     DAILY review (D-06) than as a weekly preceding factor.
// V2-10 owns tunability (post-Phase-4 path to swap candidates).
//
// Plan 04-05 Wave 1 — load-bearing module-load constant. Mirrors the
// `CANDIDATE_FACTORS_TYPE_ONLY` tuple in `src/domain/patterns/types.ts`
// verbatim; the sibling test asserts deep-equal against that anchor so a
// future edit to either tuple is caught at CI time.
//
// Pure data file: no I/O, no logger, no runtime side effects. Shared Pattern
// 2 (closed-tuple + derived type + runtime Set) — same shape as
// `BANNED_TONE_WORDS` / `BANNED_TONE_WORDS_SET` (Plan 04-01) and
// `METRIC_NAMES` / `METRIC_NAMES_SET` (Plan 04-02).

import type { CandidateName } from './types.js';

/**
 * D-11 5-tuple of pre-registered weekly-pattern candidate factors. Order
 * matches `CANDIDATE_FACTORS_TYPE_ONLY` in `types.ts` verbatim — the
 * candidates.test.ts deep-equal anchors that contract.
 */
export const CANDIDATE_FACTORS = [
  'sleep_duration_prior_night',
  'sleep_debt_3d_rolling',
  'day_strain_prior_day',
  'workout_timing_late_evening',
  'hrv_delta_prior_day',
] as const satisfies readonly CandidateName[];

/**
 * Runtime Set for O(1) membership checks. Constructed from the tuple so any
 * future tuple edit re-derives the set on module load.
 */
export const CANDIDATE_FACTORS_SET: ReadonlySet<CandidateName> = new Set(CANDIDATE_FACTORS);

// Re-export the literal-union type for downstream consumers that want both
// the tuple and the type from a single import path.
export type { CandidateName };
