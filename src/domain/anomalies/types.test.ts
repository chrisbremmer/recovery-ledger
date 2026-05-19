import { describe, expect, it } from 'vitest';

import type { Anomaly, ZAnalysis } from './types.js';

// Task 2 (Plan 04-02) — ZAnalysis 3-variant discriminated union + Anomaly
// shape per D-05 + D-06 + RESEARCH §Statistical Engine §1 (MAD=0 edge case).
//
// The exhaustive switches below are the ADR-0004 forcing function at the
// type level: adding a fourth `kind` to the union without a matching case
// here would fail `tsc --noEmit`. Same precedent as Phase 3 D-03
// `Score = SCORED | PENDING_SCORE | UNSCORABLE` narrowing in
// `src/domain/types/score.ts`.

function describeZAnalysis(z: ZAnalysis): string {
  switch (z.kind) {
    case 'computed':
      return `computed:${z.tier}:${z.value}`;
    case 'refused':
      switch (z.reason) {
        case 'insufficient_days':
          return `refused:insufficient:${z.days_available}/${z.days_required}`;
        case 'baseline_mad_zero':
          return `refused:mad_zero:${z.days_available}`;
      }
  }
}

describe('ZAnalysis (D-05 + RESEARCH §1 MAD=0 extension)', () => {
  it('narrows the computed arm with value + baseline fields + tier', () => {
    const z: ZAnalysis = {
      kind: 'computed',
      value: -1.9,
      baseline_median: 50,
      baseline_mad: 8,
      tier: 'strong',
    };
    expect(describeZAnalysis(z)).toBe('computed:strong:-1.9');
  });

  it('narrows the refused/insufficient_days arm with days fields', () => {
    const z: ZAnalysis = {
      kind: 'refused',
      reason: 'insufficient_days',
      days_available: 8,
      days_required: 14,
    };
    expect(describeZAnalysis(z)).toBe('refused:insufficient:8/14');
  });

  it('narrows the refused/baseline_mad_zero arm with no days_required', () => {
    // RESEARCH §1 — the third refused variant carries no `days_required`
    // because the issue is constant-value variance (e.g., respiratory_rate
    // quantized to 0.1 bpm increments), NOT sample size.
    const z: ZAnalysis = {
      kind: 'refused',
      reason: 'baseline_mad_zero',
      days_available: 24,
    };
    expect(describeZAnalysis(z)).toBe('refused:mad_zero:24');
  });

  it('weak/strong tier is required on the computed arm', () => {
    // The Z-score machinery in Plan 04-04 returns `tier: 'weak'` when
    // 14 ≤ scoredDays < 20 and `tier: 'strong'` when scoredDays ≥ 20.
    // The tier is a property of the computation, NOT of the firing rule
    // (which lives in D-06 + direction.ts).
    const weak: ZAnalysis = {
      kind: 'computed',
      value: 0.5,
      baseline_median: 50,
      baseline_mad: 8,
      tier: 'weak',
    };
    const strong: ZAnalysis = {
      kind: 'computed',
      value: -2.5,
      baseline_median: 50,
      baseline_mad: 8,
      tier: 'strong',
    };
    expect(weak.kind === 'computed' && weak.tier).toBe('weak');
    expect(strong.kind === 'computed' && strong.tier).toBe('strong');
  });
});

describe('Anomaly (D-06)', () => {
  it('carries metric + z + direction + baseline context + tier', () => {
    const a: Anomaly = {
      metric: 'hrv_rmssd_milli',
      z: -1.9,
      direction: 'low',
      baseline_median: 50,
      baseline_mad_scaled: 11.86,
      tier: 'strong',
    };
    expect(a.metric).toBe('hrv_rmssd_milli');
    expect(a.z).toBeLessThan(0);
    expect(a.direction).toBe('low');
  });

  it('direction is exactly low | high (bidirectional is informational, never an Anomaly)', () => {
    // D-06: day_strain is bidirectional → surfaced as informational only,
    // never as an `Anomaly`. The type-level guard is `direction: 'low' | 'high'`.
    const low: Anomaly = {
      metric: 'sleep_duration_minutes',
      z: -2.3,
      direction: 'low',
      baseline_median: 420,
      baseline_mad_scaled: 30,
      tier: 'strong',
    };
    const high: Anomaly = {
      metric: 'resting_heart_rate',
      z: 2.4,
      direction: 'high',
      baseline_median: 58,
      baseline_mad_scaled: 3.5,
      tier: 'strong',
    };
    expect(low.direction).toBe('low');
    expect(high.direction).toBe('high');
  });
});
