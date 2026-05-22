// Mann-Whitney U primitive — pure-function pattern-test primitive used by
// the weekly review (next plan composes this into the 5-candidate FDR
// pipeline). Implementation follows 04-RESEARCH §Statistical Engine §4
// verbatim:
//
//     U_1     = R_1 - n_1 (n_1 + 1) / 2          where R_1 = wilcoxonRankSum(sampleX, sampleY)
//     mu_U    = n_1 n_2 / 2
//     sigma_U = sqrt(n_1 n_2 (n_1 + n_2 + 1) / 12)
//     z       = (|U_1 - mu_U| - 0.5) / sigma_U   # continuity correction
//     p_two   = 2 (1 - Phi(z))                   # two-sided
//
// `simple-statistics.wilcoxonRankSum` returns the rank-sum STATISTIC for
// sampleX only (NOT a U statistic, NOT a p-value) — verified against the
// upstream source on 2026-05-19. `cumulativeStdNormalProbability(z)` is
// Phi(z), the standard-normal CDF.
//
// Numerical clamp: when |U_1 - mu_U| < 0.5 (the identical-samples regime),
// the continuity-corrected numerator goes negative, Phi(z) drops below
// 0.5, and 2 (1 - Phi(z)) > 1. We clamp the return into [0, 1] so callers
// never see a p-value outside the valid probability range. The FDR step-
// up procedure in the next file is the load-bearing consumer of this
// invariant.
//
// PITFALL 2 (small-sample edge): we throw when either sample has fewer
// than 2 values. The D-13 floor (N_scored >= 14 -> min n_1 = 3 vs n_2 = 11)
// keeps live calls well above this floor; the throw is the boundary
// check that surfaces a misuse, not a policy gate.
//
// Pure function: no I/O, no clock, no logger. Only allowed import is
// `simple-statistics`.

import { cumulativeStdNormalProbability, wilcoxonRankSum } from 'simple-statistics';

export interface MannWhitneyResult {
  /** U statistic for sampleX: U_1 = R_1 - n_1 (n_1 + 1) / 2. */
  readonly U: number;
  /** Two-sided p-value via normal approximation with continuity correction; clamped into [0, 1]. */
  readonly p: number;
}

export function mannWhitney(sampleX: number[], sampleY: number[]): MannWhitneyResult {
  const n1 = sampleX.length;
  const n2 = sampleY.length;
  if (n1 < 2 || n2 < 2) {
    throw new Error(`mannWhitney: each sample needs at least 2 values (got n_1=${n1}, n_2=${n2})`);
  }

  const rankSum = wilcoxonRankSum(sampleX, sampleY);
  const U = rankSum - (n1 * (n1 + 1)) / 2;

  const muU = (n1 * n2) / 2;
  const sigmaU = Math.sqrt((n1 * n2 * (n1 + n2 + 1)) / 12);

  // Continuity-corrected absolute deviation; subtracts 0.5 from |U - muU|.
  const z = (Math.abs(U - muU) - 0.5) / sigmaU;
  const pRaw = 2 * (1 - cumulativeStdNormalProbability(z));

  // Clamp into [0, 1] — the identical-samples regime drives pRaw above 1
  // because z goes slightly negative under the continuity correction.
  const p = Math.min(1, Math.max(0, pRaw));

  return { U, p };
}
