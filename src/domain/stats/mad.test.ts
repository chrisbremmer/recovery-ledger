// MAD + robustSigma primitive — pure-function test surface (REV-01 anchor).
//
// `robustSigma(values) = 1.4826 × medianAbsoluteDeviation(values)` per
// Rousseeuw & Croux (1993). The 1.4826 factor is `1 / Φ⁻¹(0.75)`, making
// MAD a consistent estimator of σ for normally-distributed data. The
// MAD_CONSISTENCY constant is exported so downstream baseline code can
// document the link back to REV-01 without re-declaring the number.
//
// MAD = 0 (constant-value baseline window) is a real edge case — e.g.,
// respiratory_rate quantized to 0.1 bpm increments can be flat for an
// entire 30-day window. We return 0 here; the anomaly code in the next
// plan owns the discriminated-union `ZAnalysis.refused.baseline_mad_zero`
// branch that surfaces "metric is flat — no anomaly signal" downstream.

import { describe, expect, it } from 'vitest';
import { MAD_CONSISTENCY, robustSigma } from './mad.js';

describe('MAD_CONSISTENCY', () => {
  it('exports the Rousseeuw & Croux (1993) consistency factor verbatim', () => {
    expect(MAD_CONSISTENCY).toBe(1.4826);
  });
});

describe('robustSigma', () => {
  it('throws on empty array', () => {
    expect(() => robustSigma([])).toThrow();
  });

  it('returns 0 for a constant-value array (MAD = 0 edge case)', () => {
    expect(robustSigma([5, 5, 5, 5, 5])).toBe(0);
  });

  it('matches the worked example for odd-length [1, 2, 3, 4, 5]', () => {
    // median = 3; |deviations| = [2, 1, 0, 1, 2]; MAD = median = 1;
    // robustSigma = 1.4826 * 1 = 1.4826
    expect(robustSigma([1, 2, 3, 4, 5])).toBeCloseTo(1.4826, 6);
  });

  it('matches the worked example for even-length [1, 2, 3, 4]', () => {
    // median = 2.5; |deviations| = [1.5, 0.5, 0.5, 1.5]; MAD = 1;
    // robustSigma = 1.4826 * 1 = 1.4826
    expect(robustSigma([1, 2, 3, 4])).toBeCloseTo(1.4826, 6);
  });
});
