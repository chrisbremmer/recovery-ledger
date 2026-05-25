// Single source of truth for the D-11 5-tuple of pre-registered weekly-
// pattern candidate factor names + its derived 5-literal union type. Both
// `domain/patterns/types.ts` (type contract) and `domain/patterns/candidates.ts`
// (load-bearing runtime constant with rationale comments) import from here.
//
// Before #39, both files declared their own copy of the tuple and a
// runtime test asserted deep-equal at CI time. The split avoided a
// circular import (`types.ts` ↔ `candidates.ts`). This file has no
// imports, breaking the cycle without the dual-source-of-truth hazard.
//
// V2-10 owns tunability (post-Phase-4 path to swap candidates). Until
// then, the 5 names are locked. The 2 dropped from REV-06's 7-factor
// list (`rhr_delta_prior_day`, `respiratory_rate_anomaly_prior_day`) are
// documented in `candidates.ts` so the rationale lives where the
// load-bearing constant lives.

/**
 * D-11 5-tuple of pre-registered weekly-pattern candidate factor names.
 * Imported by `types.ts` (as the type anchor) AND `candidates.ts` (as
 * the load-bearing module-load constant) — single source of truth.
 *
 * Order is significant: `candidates.test.ts` asserts deep-equal against
 * this exact tuple shape.
 */
export const CANDIDATE_NAMES = [
  'sleep_duration_prior_night',
  'sleep_debt_3d_rolling',
  'day_strain_prior_day',
  'workout_timing_late_evening',
  'hrv_delta_prior_day',
] as const;

/**
 * Derived 5-literal union of candidate factor names. Used as the
 * `factor` field type on `WeeklyPattern.detected` + `CandidateResult`.
 */
export type CandidateName = (typeof CANDIDATE_NAMES)[number];
