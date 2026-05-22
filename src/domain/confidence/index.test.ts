// RED: failing tests for confidenceFromCounts per D-13 tier thresholds
// + D-10 'insufficient' tier emission. Boundary cases:
//   - scoredDays < 10  → insufficient   (D-10 typed positive output trigger)
//   - 10 ≤ count < 20  → weak
//   - count ≥ 20 AND coveragePct ≥ 70  → strong
//   - count ≥ 20 AND coveragePct < 70  → weak
//
// Plan 04-04 Wave 1 — pure-domain layer. Tests run BEFORE implementation
// exists; first run is the RED gate.

import { describe, expect, it } from 'vitest';

import { confidenceFromCounts } from './index.js';

describe('confidenceFromCounts', () => {
  it('returns insufficient when scoredDays = 0 (D-10 typed positive output)', () => {
    const gate = confidenceFromCounts({ scoredDays: 0, windowDays: 30 });
    expect(gate.tier).toBe('insufficient');
    expect(gate.minRequired).toBe(10);
    expect(gate.sampleSize).toBe(0);
    expect(gate.coveragePct).toBe(0);
  });

  it('returns insufficient when scoredDays = 9, windowDays = 30 (under threshold)', () => {
    const gate = confidenceFromCounts({ scoredDays: 9, windowDays: 30 });
    expect(gate.tier).toBe('insufficient');
    expect(gate.minRequired).toBe(10);
    expect(gate.sampleSize).toBe(9);
    expect(gate.coveragePct).toBeCloseTo(30, 5);
  });

  it('returns weak at the 10-day boundary (scoredDays = 10, windowDays = 30)', () => {
    const gate = confidenceFromCounts({ scoredDays: 10, windowDays: 30 });
    expect(gate.tier).toBe('weak');
    expect(gate.minRequired).toBe(10);
    expect(gate.sampleSize).toBe(10);
    expect(gate.coveragePct).toBeCloseTo(33.333, 2);
  });

  it('returns weak when scoredDays = 19, windowDays = 30', () => {
    const gate = confidenceFromCounts({ scoredDays: 19, windowDays: 30 });
    expect(gate.tier).toBe('weak');
    expect(gate.minRequired).toBe(10);
    expect(gate.sampleSize).toBe(19);
  });

  it('returns weak when scoredDays = 20 but coverage < 70% (coverage 66.7%)', () => {
    const gate = confidenceFromCounts({ scoredDays: 20, windowDays: 30 });
    expect(gate.tier).toBe('weak');
    expect(gate.minRequired).toBe(10);
    expect(gate.sampleSize).toBe(20);
    expect(gate.coveragePct).toBeCloseTo(66.667, 2);
  });

  it('returns strong when scoredDays = 21, windowDays = 30 (coverage 70%)', () => {
    const gate = confidenceFromCounts({ scoredDays: 21, windowDays: 30 });
    expect(gate.tier).toBe('strong');
    expect(gate.minRequired).toBe(20);
    expect(gate.sampleSize).toBe(21);
    expect(gate.coveragePct).toBeCloseTo(70, 5);
  });

  it('returns strong when scoredDays = 30, windowDays = 30 (coverage 100%)', () => {
    const gate = confidenceFromCounts({ scoredDays: 30, windowDays: 30 });
    expect(gate.tier).toBe('strong');
    expect(gate.minRequired).toBe(20);
    expect(gate.sampleSize).toBe(30);
    expect(gate.coveragePct).toBe(100);
  });

  it('returns strong for trailing-28 pattern window (scoredDays = 20, coverage ≈ 71.4%)', () => {
    const gate = confidenceFromCounts({ scoredDays: 20, windowDays: 28 });
    expect(gate.tier).toBe('strong');
    expect(gate.minRequired).toBe(20);
    expect(gate.sampleSize).toBe(20);
    expect(gate.coveragePct).toBeCloseTo(71.428, 2);
  });

  it('D-10 path: scoredDays = 5 → insufficient (downstream Plan 04-07 wraps with insufficient_reason)', () => {
    const gate = confidenceFromCounts({ scoredDays: 5, windowDays: 30 });
    expect(gate.tier).toBe('insufficient');
    expect(gate.minRequired).toBe(10);
  });
});
