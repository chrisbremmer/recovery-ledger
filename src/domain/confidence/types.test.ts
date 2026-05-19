import { describe, expect, it } from 'vitest';

import type { ConfidenceGate, ConfidenceTier } from './types.js';

// Task 1 (Plan 04-02) — D-13 confidence tier thresholds + ConfidenceGate shape.
// The `minRequired: 10 | 20` literal-tuple-as-doc pattern documents the
// thresholds without a comment (10 for insufficient/weak, 20 for strong).

describe('ConfidenceTier (D-13)', () => {
  it('has exactly three tier literals', () => {
    // Exhaustive switch over the union — a fourth tier added to the literal
    // type without a case here would fail to compile.
    const tiers: ConfidenceTier[] = ['insufficient', 'weak', 'strong'];
    for (const tier of tiers) {
      let label: string;
      switch (tier) {
        case 'insufficient':
          label = 'insufficient';
          break;
        case 'weak':
          label = 'weak';
          break;
        case 'strong':
          label = 'strong';
          break;
      }
      expect(label).toBe(tier);
    }
  });
});

describe('ConfidenceGate shape', () => {
  it('accepts the insufficient tier with minRequired = 10', () => {
    const gate: ConfidenceGate = {
      tier: 'insufficient',
      coveragePct: 20,
      minRequired: 10,
      sampleSize: 6,
    };
    expect(gate.tier).toBe('insufficient');
    expect(gate.minRequired).toBe(10);
  });

  it('accepts the weak tier with minRequired = 10', () => {
    const gate: ConfidenceGate = {
      tier: 'weak',
      coveragePct: 50,
      minRequired: 10,
      sampleSize: 15,
    };
    expect(gate.minRequired).toBe(10);
  });

  it('accepts the strong tier with minRequired = 20', () => {
    const gate: ConfidenceGate = {
      tier: 'strong',
      coveragePct: 80,
      minRequired: 20,
      sampleSize: 24,
    };
    expect(gate.minRequired).toBe(20);
    expect(gate.sampleSize).toBeGreaterThanOrEqual(20);
  });
});
