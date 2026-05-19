// Median Absolute Deviation primitive with the Rousseeuw & Croux (1993)
// consistency factor — the anchor for REV-01's "robust σ" requirement.
//
// `simple-statistics.medianAbsoluteDeviation` returns the raw MAD:
//
//     MAD = median(|x_i - median(x)|)
//
// To make MAD a consistent estimator of σ for normally-distributed data,
// multiply by 1 / Φ⁻¹(0.75) ≈ 1.4826. The constant is exported so the
// baseline calculator in the next plan can document the link back to
// Rousseeuw & Croux (1993) without re-declaring the number.
//
// MAD = 0 case: when the baseline window is constant (e.g., respiratory
// rate quantized to 0.1 bpm increments and unchanging over 30 days), MAD
// = 0 and robustSigma = 0. We return 0 here; the anomaly code owns the
// discriminated-union `ZAnalysis.refused.baseline_mad_zero` branch that
// surfaces "metric is flat — no anomaly signal" downstream so the Z-score
// machinery never divides by zero.
//
// Pure function: no I/O, no clock, no logger. Only allowed import is
// `simple-statistics`.

import { medianAbsoluteDeviation } from 'simple-statistics';

/**
 * Rousseeuw & Croux (1993) consistency factor: `1 / Φ⁻¹(0.75)`. Multiplying
 * the raw MAD by this constant makes it a consistent estimator of σ for
 * normally-distributed data — REV-01's explicit requirement.
 */
export const MAD_CONSISTENCY = 1.4826;

export function robustSigma(values: number[]): number {
  if (values.length === 0) {
    throw new Error('robustSigma: input array is empty');
  }
  return MAD_CONSISTENCY * medianAbsoluteDeviation(values);
}
