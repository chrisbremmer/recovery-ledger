// Weekly-pattern type contract — D-11 (5 candidate factors, locked) +
// D-16 (`WeeklyPattern` 2-arm discriminated union) + D-18 (multi-detection
// policy: pattern reports smallest p_adjusted; candidate_results carries
// full ranked list) + D-34 (ADDITIVE `pattern_confidence: 'weak' | 'strong'`
// on the detected arm).
//
// #39 — the 5-tuple of candidate factor names + the `CandidateName` type
// now live in the import-free `./names.ts` module. Both this file and
// `./candidates.ts` import from `names.ts` — single source of truth, no
// circular import, no dual-source-of-truth hazard.

// Re-export under the historical name so downstream consumers
// (`review/types.ts`, anomaly callers, etc.) keep their existing
// `import { CANDIDATE_FACTORS_TYPE_ONLY, ... } from './types.js'`.
export { CANDIDATE_NAMES as CANDIDATE_FACTORS_TYPE_ONLY } from './names.js';

import type { CandidateName } from './names.js';

export type { CandidateName };

/**
 * Weekly pattern result per D-16, with D-34's `pattern_confidence`
 * field added to the `detected` arm (ADDITIVE — the discriminator
 * remains `kind`; `pattern_confidence` is a non-discriminator
 * annotation that the formatter reads to render a "small sample —
 * effect estimates imprecise" caveat).
 *
 * Two arms:
 * - `detected` — exactly one candidate cleared BH FDR at q=0.10 (D-15).
 *   Per D-18 multi-detection policy, when multiple candidates clear,
 *   this arm reports the one with the smallest `p_adjusted`; the full
 *   ranked list lives in `WeeklyReviewResult.candidate_results` (the
 *   ADR-0004 §If FDR set empty rule — "list unranked candidates as
 *   context, not as a recommendation"). The runtime selection logic
 *   lives in Plan 04-05's pattern detector, NOT in this type.
 * - `no_pattern` — the ADR-0004 typed positive output. Three reasons:
 *     - `insufficient_window_days` — N_scored < 14 in trailing-28 (D-13)
 *     - `no_factor_cleared_fdr` — N cleared, but BH downgraded all
 *     - `all_candidates_refused` — every candidate's Mann-Whitney was
 *       refused for sample-size reasons (RESEARCH §Statistical Engine §3)
 *
 * `pattern_confidence`:
 *   - `weak` when 14 ≤ N_scored < 20 (Mann-Whitney normal approx
 *     degrades; D-34)
 *   - `strong` when N_scored ≥ 20
 */
export type WeeklyPattern =
  | {
      kind: 'detected';
      factor: CandidateName;
      statistic: { U: number; p_raw: number; p_adjusted: number };
      direction: 'worst_days_had_lower' | 'worst_days_had_higher';
      pattern_confidence: 'weak' | 'strong';
    }
  | {
      kind: 'no_pattern';
      reason: 'insufficient_window_days' | 'no_factor_cleared_fdr' | 'all_candidates_refused';
    };

/**
 * Per-candidate result carried in `WeeklyReviewResult.candidate_results`
 * per D-18 + ADR-0004 §If FDR set empty. Every candidate that survived
 * the sample-size gate gets a row (so the formatter can render "5
 * candidates tested; 1 cleared FDR" as the weekly headline). Candidates
 * refused before Mann-Whitney ran (sample size too small) carry
 * `refused: true` with `p_raw`/`p_adjusted` as NaN sentinels and a
 * documented `refusal_reason`.
 */
export interface CandidateResult {
  factor: CandidateName;
  p_raw: number;
  p_adjusted: number;
  cleared: boolean;
  refused: boolean;
  refusal_reason?: 'sample_too_small';
}

/**
 * One bottom-quartile worst-recovery day per D-13. The formatter renders
 * these as the "Worst days" section in the weekly narrative; the date
 * is YYYY-MM-DD (ISO) and `recovery_score` is the WHOOP recovery score
 * (0-100). Tie-break per D-13: chronologically-earlier day kept on
 * equality.
 */
export interface WorstDay {
  date: string;
  recovery_score: number;
}
