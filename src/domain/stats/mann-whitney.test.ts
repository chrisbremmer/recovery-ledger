// Mann-Whitney U primitive — pure-function test surface (REV-07 anchor,
// pattern-test machinery in the next plan composes this).
//
// Worked examples drawn from Wikipedia's Mann-Whitney U article and the
// `simple-statistics.wilcoxonRankSum` source (verified rank-sum return on
// 2026-05-19 against [1,2,3,4,5] vs [6,7,8,9,10] -> 15 and on the
// asymmetric [1,3,5] vs [2,4,6,8,10,12,14,16] -> 9 fixtures used below).
//
// PITFALL 2 (mann-whitney small-sample edge, per 04-RESEARCH §Pitfalls 2):
// the function throws when either sample is < 2; callers refuse upstream
// per the D-13 floor before invoking. The throw is the boundary check, not
// the policy gate.

import { describe, expect, it } from 'vitest';
import { mannWhitney } from './mann-whitney.js';

describe('mannWhitney', () => {
  describe('input validation', () => {
    it('throws when sampleX has fewer than 2 values', () => {
      expect(() => mannWhitney([1], [2, 3, 4])).toThrow();
    });

    it('throws when sampleY has fewer than 2 values', () => {
      expect(() => mannWhitney([1, 2, 3], [4])).toThrow();
    });
  });

  describe('worked examples', () => {
    it('handles worst-case separation [1..5] vs [6..10]', () => {
      // No overlap: sampleX gets ranks 1..5, R_1 = 15.
      // U_1 = 15 - 5*6/2 = 0.
      // muU = 25/2 = 12.5; sigU = sqrt(5*5*11/12) = sqrt(22.917) ≈ 4.787
      // z = (|0 - 12.5| - 0.5) / 4.787 ≈ 2.506
      // p_two = 2 * (1 - Phi(2.506)) ≈ 0.0122
      const { U, p } = mannWhitney([1, 2, 3, 4, 5], [6, 7, 8, 9, 10]);
      expect(U).toBe(0);
      expect(p).toBeLessThan(0.05);
    });

    it('returns p ≈ 1 (after clamp) when samples are identical', () => {
      // All ties at value 3: mid-rank = 3.5 per value; R_1 = 10.5; U_1 = 4.5;
      // muU = 4.5; |U - muU| = 0; with continuity correction, the numerator
      // is -0.5 so z is slightly negative and 2*(1 - Phi(z)) > 1. The
      // implementation MUST clamp the return into [0, 1].
      const { U, p } = mannWhitney([3, 3, 3], [3, 3, 3]);
      expect(U).toBe(4.5);
      expect(p).toBeLessThanOrEqual(1);
      expect(p).toBeGreaterThanOrEqual(0.9);
    });

    it('handles asymmetric samples [1,3,5] vs [2,4,6,8,10,12,14,16]', () => {
      // Merged sort: [1, 2, 3, 4, 5, 6, 8, 10, 12, 14, 16]
      // sampleX values 1, 3, 5 land at ranks 1, 3, 5; R_1 = 9.
      // U_1 = 9 - 3*4/2 = 3.
      // muU = 3*8/2 = 12; sigU = sqrt(3*8*12/12) = sqrt(24) ≈ 4.899
      // z = (|3 - 12| - 0.5) / 4.899 ≈ 1.735
      // p_two = 2 * (1 - Phi(1.735)) ≈ 0.0818 against simple-statistics's
      // 3-decimal Phi table (verified 2026-05-19 against the live library).
      const { U, p } = mannWhitney([1, 3, 5], [2, 4, 6, 8, 10, 12, 14, 16]);
      expect(U).toBe(3);
      expect(p).toBeCloseTo(0.0818, 3);
    });
  });

  describe('numerical safety', () => {
    it('clamps the returned p-value into [0, 1] across small-sample inputs', () => {
      // Run a handful of small-sample inputs that exercise the continuity-
      // correction regime where 2*(1 - Phi(z)) can numerically exceed 1.
      const cases: Array<[number[], number[]]> = [
        [
          [3, 3, 3],
          [3, 3, 3],
        ],
        [
          [1, 1],
          [1, 1],
        ],
        [
          [2, 2, 2, 2],
          [2, 2, 2, 2],
        ],
      ];
      for (const [x, y] of cases) {
        const { p } = mannWhitney(x, y);
        expect(p).toBeGreaterThanOrEqual(0);
        expect(p).toBeLessThanOrEqual(1);
      }
    });
  });
});
