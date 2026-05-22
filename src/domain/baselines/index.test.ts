// RED: failing tests for computeBaseline per REV-01 + D-02 trailing-30 anchor.
// computeBaseline consumes ALREADY-FILTERED + ALREADY-WINDOWED values
// (non-null, finite, SCORED-only, non-DST-excluded; trailing-30 from
// reviewed_date applied by the service layer in Plan 04-07) and emits
// BaselineStats with raw MAD (consumer applies robustSigma's 1.4826).
//
// Plan 04-04 Wave 1 — pure-domain layer. Tests run BEFORE the
// implementation exists; first run is the RED gate.

import { describe, expect, it } from 'vitest';

import { computeBaseline } from './index.js';

describe('computeBaseline', () => {
  it('throws when values is empty (same discipline as median + robustSigma)', () => {
    expect(() => computeBaseline('recovery_score', [], 30)).toThrow();
  });

  it('returns BaselineStats over a 5-value window — median 70, raw MAD 10', () => {
    // Values 50, 60, 70, 80, 90 → median = 70.
    // Deviations from median = [20, 10, 0, 10, 20] → median(devs) = 10 → MAD = 10.
    const stats = computeBaseline('recovery_score', [50, 60, 70, 80, 90], 30);
    expect(stats.metric).toBe('recovery_score');
    expect(stats.median).toBe(70);
    expect(stats.mad).toBe(10);
    expect(stats.n).toBe(5);
    expect(stats.coverage_pct).toBeCloseTo(16.667, 2);
  });

  it('returns mad = 0 when all 30 values are identical (Pitfall 12 edge — caller refuses via baseline_mad_zero)', () => {
    const stats = computeBaseline('respiratory_rate', new Array(30).fill(15.5), 30);
    expect(stats.median).toBe(15.5);
    expect(stats.mad).toBe(0);
    expect(stats.n).toBe(30);
    expect(stats.coverage_pct).toBe(100);
  });

  it('preserves metric slot verbatim across different MetricName inputs', () => {
    const hrv = computeBaseline('hrv_rmssd_milli', [40, 45, 50], 30);
    const rhr = computeBaseline('resting_heart_rate', [55, 60, 65], 30);
    expect(hrv.metric).toBe('hrv_rmssd_milli');
    expect(rhr.metric).toBe('resting_heart_rate');
  });

  it('coverage_pct is raw float (9 scored in 30 → 30%); formatter applies rounding', () => {
    const stats = computeBaseline('hrv_rmssd_milli', new Array(9).fill(50), 30);
    expect(stats.n).toBe(9);
    expect(stats.coverage_pct).toBeCloseTo(30, 5);
  });

  it('coverage_pct scales with windowDays — 20 scored in trailing-28 pattern window', () => {
    const stats = computeBaseline('day_strain', new Array(20).fill(12.0), 28);
    expect(stats.n).toBe(20);
    expect(stats.coverage_pct).toBeCloseTo(71.428, 2);
  });
});
