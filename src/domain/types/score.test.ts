// Unit coverage for the ScoreState discriminator and the entity DU's
// compile-time forcing function (ADR-0003 + Pitfall 3 mitigation).
//
// The load-bearing tests in this file are the @ts-expect-error directives
// on the Cycle DU. Vitest runs the type-check during test compilation, so
// a regression that loosens the discriminator (e.g., adding `strain` to
// CycleBase or removing the literal union narrowing) would either:
//   - flip an @ts-expect-error to "unused suppression" (compile error), or
//   - allow the .strain access to type-check (compile error on the
//     adjacent assignment because @ts-expect-error reports unused).
// Either way the regression is caught at type-check time, not at runtime.

import { describe, expect, test } from 'vitest';
import type { Cycle } from './entities.js';
import { SCORE_STATES, SCORE_STATES_SET, type ScoreState } from './score.js';

describe('ScoreState — closed tuple (D-03 / ADR-0003)', () => {
  test('Test 1: SCORE_STATES has exactly three literals', () => {
    expect(SCORE_STATES.length).toBe(3);
    expect(SCORE_STATES).toEqual(['SCORED', 'PENDING_SCORE', 'UNSCORABLE']);
  });

  test('Test 2: SCORE_STATES_SET membership is exact (closed set, no extras)', () => {
    expect(SCORE_STATES_SET.has('SCORED')).toBe(true);
    expect(SCORE_STATES_SET.has('PENDING_SCORE')).toBe(true);
    expect(SCORE_STATES_SET.has('UNSCORABLE')).toBe(true);
    expect(SCORE_STATES_SET.size).toBe(3);
    // The set is typed as ReadonlySet<ScoreState>; the runtime .has() takes
    // ScoreState. Cast the literal to ScoreState for the negative check —
    // the cast itself is part of the test: a bogus literal does not satisfy
    // the type, and the runtime membership check rejects it too.
    expect(SCORE_STATES_SET.has('foo' as ScoreState)).toBe(false);
  });
});

describe('Cycle DU — discriminator forcing function (ADR-0003)', () => {
  // Reusable PENDING_SCORE cycle for all forcing-function tests below.
  const pendingCycle: Cycle = {
    scoreState: 'PENDING_SCORE',
    id: 1,
    userId: 42,
    createdAt: '2026-05-16T00:00:00.000Z',
    updatedAt: '2026-05-16T00:00:00.000Z',
    start: '2026-05-15T08:00:00.000Z',
    end: '2026-05-16T08:00:00.000Z',
    timezoneOffset: '-08:00',
    baselineExcluded: false,
    exclusionReason: null,
  };

  test('Test 3: reading .strain on the union without narrowing is a compile error', () => {
    // The @ts-expect-error directive forces a compile failure if the DU is
    // loosened. If the regression is reverted, this test passes; if a
    // future commit broadens CycleBase to include `strain`, the suppression
    // becomes unused and breaks compilation here.
    // @ts-expect-error — strain only exists on CycleScored after narrowing
    const _badStrain: number | undefined = pendingCycle.strain;
    void _badStrain; // suppress unused-variable lint at runtime; the
    //                  compile-time check is what matters.
    expect(true).toBe(true);
  });

  test('Test 4: reading .kilojoule on the union without narrowing is a compile error', () => {
    // @ts-expect-error — kilojoule only exists on CycleScored
    const _badK: number | undefined = pendingCycle.kilojoule;
    void _badK;
    expect(true).toBe(true);
  });

  test('Test 5: reading .averageHeartRate on the union without narrowing is a compile error', () => {
    // @ts-expect-error — averageHeartRate only exists on CycleScored
    const _badAvg: number | undefined = pendingCycle.averageHeartRate;
    void _badAvg;
    expect(true).toBe(true);
  });

  test('Test 6: narrowing on scoreState === "SCORED" allows .strain access', () => {
    const c: Cycle = {
      scoreState: 'SCORED',
      id: 2,
      userId: 42,
      createdAt: '2026-05-16T00:00:00.000Z',
      updatedAt: '2026-05-16T00:00:00.000Z',
      start: '2026-05-15T08:00:00.000Z',
      end: '2026-05-16T08:00:00.000Z',
      timezoneOffset: '-08:00',
      baselineExcluded: false,
      exclusionReason: null,
      strain: 12.5,
      kilojoule: 8000,
      averageHeartRate: 60,
      maxHeartRate: 180,
    };
    if (c.scoreState === 'SCORED') {
      // This compiles cleanly because the narrowing happened on the line
      // above. The runtime assertion is decorative; the load-bearing
      // check is at compile time.
      const ok: number = c.strain;
      expect(ok).toBe(12.5);
    } else {
      throw new Error('test fixture mis-specified — c is SCORED');
    }
  });

  test('Test 7: PENDING_SCORE + UNSCORABLE variants both carry baselineExcluded (D-14)', () => {
    // D-14: baselineExcluded + exclusionReason live on every Cycle variant
    // because DST detection runs at upsert regardless of scoreState. A
    // PENDING_SCORE cycle CAN still straddle a DST boundary, so the flag
    // must be readable without narrowing.
    expect(pendingCycle.baselineExcluded).toBe(false);
    expect(pendingCycle.exclusionReason).toBeNull();

    const unscorableCycle: Cycle = {
      scoreState: 'UNSCORABLE',
      id: 3,
      userId: 42,
      createdAt: '2026-05-16T00:00:00.000Z',
      updatedAt: '2026-05-16T00:00:00.000Z',
      start: '2026-05-15T08:00:00.000Z',
      end: null,
      timezoneOffset: '-08:00',
      baselineExcluded: true,
      exclusionReason: 'dst_straddle',
    };
    expect(unscorableCycle.baselineExcluded).toBe(true);
    expect(unscorableCycle.exclusionReason).toBe('dst_straddle');
  });
});
