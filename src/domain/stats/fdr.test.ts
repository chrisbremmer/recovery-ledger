// Benjamini-Hochberg FDR step-up procedure — pure-function test surface
// (REV-07 anchor; the weekly review's multi-comparison correction).
//
// Algorithm: 04-RESEARCH §Statistical Engine §5 verbatim — pair each p-
// value with its original position, sort ascending, walk from k=m down to
// k=1, find the largest k where p_(k) <= (k/m) * q, reject all hypotheses
// at rank <= kStar, and monotonize the BH-adjusted p-values via a
// running-minimum sweep over sorted positions.
//
// ADR-0004 forcing function: the function MUST return a typed, structurally
// complete result even when 0 hypotheses are rejected. The load-bearing
// fixture `bh_downgrades_marginal` (0 rejections, REV-07 anchor) is the
// proof — the test asserts both `rejected.every(r => r === false)` AND
// `adjusted.length === pvalues.length`.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { benjaminiHochberg } from './fdr.js';

const FIXTURE_DIR = fileURLToPath(new URL('../../../tests/fixtures/weekly-fdr/', import.meta.url));

interface BhFixture {
  pvalues: number[];
  q: number;
  expected: {
    kStar: number;
    rejected_count: number;
    rejected_positions?: number[];
  };
}

function loadFixture(name: string): BhFixture {
  const raw = readFileSync(`${FIXTURE_DIR}${name}`, 'utf8');
  return JSON.parse(raw) as BhFixture;
}

describe('benjaminiHochberg', () => {
  describe('degenerate inputs', () => {
    it('returns empty rejected/adjusted arrays for an empty p-values input', () => {
      const { rejected, adjusted } = benjaminiHochberg([], 0.1);
      expect(rejected).toEqual([]);
      expect(adjusted).toEqual([]);
    });

    it('rejects a single sufficiently-small p-value at q = 0.10', () => {
      // m = 1, k = 1, threshold = (1/1) * 0.10 = 0.10; 0.01 <= 0.10 -> reject.
      const { rejected, adjusted } = benjaminiHochberg([0.01], 0.1);
      expect(rejected).toEqual([true]);
      expect(adjusted[0]).toBeCloseTo(0.01, 6);
    });
  });

  describe('D-35 LOAD-BEARING fixture bh_downgrades_marginal (REV-07 anchor)', () => {
    const fixture = loadFixture('bh_downgrades_marginal.fixture.json');

    it('returns zero rejections (typed positive output for absence)', () => {
      const { rejected } = benjaminiHochberg(fixture.pvalues, fixture.q);
      expect(rejected.length).toBe(fixture.pvalues.length);
      expect(rejected.every((r) => r === false)).toBe(true);
    });

    it('returns a structurally complete adjusted-p array even with 0 rejections', () => {
      // ADR-0004 typed-positive-output forcing function: the renderer must
      // be able to read adjusted-p values for diagnostic context even when
      // nothing cleared.
      const { adjusted } = benjaminiHochberg(fixture.pvalues, fixture.q);
      expect(adjusted.length).toBe(fixture.pvalues.length);
      for (const a of adjusted) {
        expect(a).toBeGreaterThanOrEqual(0);
        expect(a).toBeLessThanOrEqual(1);
      }
    });

    it('returns a monotone-non-decreasing adjusted array in sorted-p order', () => {
      // Input p-values are already sorted ascending, so input-order
      // adjusted values must also be monotone non-decreasing.
      const { adjusted } = benjaminiHochberg(fixture.pvalues, fixture.q);
      for (let i = 1; i < adjusted.length; i++) {
        const prev = adjusted[i - 1] as number;
        const curr = adjusted[i] as number;
        expect(curr).toBeGreaterThanOrEqual(prev);
      }
    });
  });

  describe('D-35 secondary fixture bh_partial_rejection (kStar = 3 path)', () => {
    const fixture = loadFixture('bh_partial_rejection.fixture.json');

    it('rejects exactly the fixture-declared positions', () => {
      // derive expectations from fixture.expected rather than
      // hardcoding so a future fixture revision flows through without test
      // edits, and the count + rejected positions stay in lockstep with
      // the fixture's documented intent.
      const { rejected } = benjaminiHochberg(fixture.pvalues, fixture.q);
      const expectedRejected = fixture.pvalues.map((_, i) =>
        (fixture.expected.rejected_positions ?? []).includes(i),
      );
      expect(rejected).toEqual(expectedRejected);
      expect(rejected.filter(Boolean).length).toBe(fixture.expected.rejected_count);
    });

    it('returns adjusted p-values matching the canonical BH monotonization', () => {
      // Walking k=5 down (RESEARCH section 5 verbatim):
      //   k=5 adj = min(1, 5/5 * 0.50) = 0.50; runningMin = 0.50
      //   k=4 adj = min(1, 5/4 * 0.20) = 0.25; runningMin = 0.25
      //   k=3 adj = min(1, 5/3 * 0.05) ≈ 0.0833; runningMin ≈ 0.0833
      //   k=2 adj = min(1, 5/2 * 0.04) = 0.10; runningMin stays 0.0833
      //   k=1 adj = min(1, 5/1 * 0.01) = 0.05; runningMin = 0.05
      // Sorted-position adjusted = [0.05, 0.0833, 0.0833, 0.25, 0.50];
      // input-order matches because input was already sorted ascending.
      const { adjusted } = benjaminiHochberg(fixture.pvalues, fixture.q);
      expect(adjusted[0]).toBeCloseTo(0.05, 4);
      expect(adjusted[1]).toBeCloseTo(0.0833, 3);
      expect(adjusted[2]).toBeCloseTo(0.0833, 3);
      expect(adjusted[3]).toBeCloseTo(0.25, 4);
      expect(adjusted[4]).toBeCloseTo(0.5, 4);
    });
  });

  describe('determinism', () => {
    it('returns identical output across repeated runs (pure function)', () => {
      const input = [0.03, 0.18, 0.42, 0.01, 0.07];
      const a = benjaminiHochberg(input, 0.1);
      const b = benjaminiHochberg(input, 0.1);
      expect(a.rejected).toEqual(b.rejected);
      expect(a.adjusted).toEqual(b.adjusted);
    });

    it('respects original input ordering on shuffled input', () => {
      // [0.5, 0.01, 0.2, 0.04, 0.05] is the bh_partial_rejection fixture
      // permuted with the 3 smallest p-values spread to positions 1, 3, 4
      // (not 0..2). Sorted ascending it matches the canonical fixture, so
      // rejections at sorted ranks 1..3 map back to ORIGINAL positions
      // 1 (0.01), 3 (0.04), 4 (0.05) — hardens this against a
      // mapping bug that the previous input would have silently masked.
      const { rejected } = benjaminiHochberg([0.5, 0.01, 0.2, 0.04, 0.05], 0.1);
      expect(rejected).toEqual([false, true, false, true, true]);
    });
  });
});
