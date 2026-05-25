// DST / tz exclusion detector tests — exhaustive coverage of D-13's two
// OR'd rules plus the load-bearing D-15 fixtures (spring-forward, fall-back,
// SFO → JFK trip). Pure function so every test is an array-literal-style
// assertion against the function's output (conventions.md §Testing).

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { detectExclusion, isParsableIsoDate } from './detect.js';

const FIXTURES_DIR = join(process.cwd(), 'tests', 'fixtures', 'whoop', 'cycles');

interface RawCycleFixture {
  records: Array<{
    start: string;
    end: string | null;
    timezone_offset: string;
  }>;
}

function loadFixture(name: string): RawCycleFixture {
  return JSON.parse(readFileSync(join(FIXTURES_DIR, name), 'utf8')) as RawCycleFixture;
}

describe('detectExclusion', () => {
  it('Test 1: flags DST spring-forward as dst_straddle', () => {
    // 200-dst-spring-forward.json — cycle straddles Mar 8 2026 02:00 → 03:00
    // in America/Los_Angeles. tzOffset goes -480 → -420 across the boundary.
    const fixture = loadFixture('200-dst-spring-forward.json');
    const cycle = fixture.records[0];
    if (!cycle) throw new Error('fixture missing record 0');

    const result = detectExclusion({
      ianaZone: 'America/Los_Angeles',
      cycle: {
        start: cycle.start,
        end: cycle.end,
        timezone_offset: cycle.timezone_offset,
      },
      priorCycle: null,
    });

    expect(result).toEqual({ baseline_excluded: true, exclusion_reason: 'dst_straddle' });
  });

  it('Test 2: flags DST fall-back as dst_straddle', () => {
    // 200-dst-fall-back.json — cycle straddles Nov 1 2026 02:00 → 01:00 in
    // America/Los_Angeles. tzOffset goes -420 → -480 across the boundary.
    const fixture = loadFixture('200-dst-fall-back.json');
    const cycle = fixture.records[0];
    if (!cycle) throw new Error('fixture missing record 0');

    const result = detectExclusion({
      ianaZone: 'America/Los_Angeles',
      cycle: {
        start: cycle.start,
        end: cycle.end,
        timezone_offset: cycle.timezone_offset,
      },
      priorCycle: null,
    });

    expect(result).toEqual({ baseline_excluded: true, exclusion_reason: 'dst_straddle' });
  });

  it('Test 3: SFO → JFK trip — record 0 no prior, record 1 tz_drift, record 2 matches prior', () => {
    // 200-tz-trip-sfo-jfk.json — three cycles with offsets -08:00 → -05:00 → -05:00.
    const fixture = loadFixture('200-tz-trip-sfo-jfk.json');
    const [r0, r1, r2] = fixture.records;
    if (!r0 || !r1 || !r2) throw new Error('fixture missing 3 records');

    // Record 0 — no prior; offsets equal within the cycle so no DST straddle.
    expect(
      detectExclusion({
        ianaZone: 'America/Los_Angeles',
        cycle: { start: r0.start, end: r0.end, timezone_offset: r0.timezone_offset },
        priorCycle: null,
      }),
    ).toEqual({ baseline_excluded: false, exclusion_reason: null });

    // Record 1 — prior offset was -08:00; this cycle is -05:00 → tz_drift.
    // The cycle is fully inside Eastern time so the within-cycle DST check
    // is a no-op (start and end both fall after the user landed in JFK).
    expect(
      detectExclusion({
        ianaZone: 'America/New_York',
        cycle: { start: r1.start, end: r1.end, timezone_offset: r1.timezone_offset },
        priorCycle: { timezone_offset: '-08:00' },
      }),
    ).toEqual({ baseline_excluded: true, exclusion_reason: 'tz_drift' });

    // Record 2 — prior offset matches (-05:00 = -05:00) → no exclusion.
    expect(
      detectExclusion({
        ianaZone: 'America/New_York',
        cycle: { start: r2.start, end: r2.end, timezone_offset: r2.timezone_offset },
        priorCycle: { timezone_offset: '-05:00' },
      }),
    ).toEqual({ baseline_excluded: false, exclusion_reason: null });
  });

  it('Test 4: ordinary cycle with matching prior offset is not excluded', () => {
    const result = detectExclusion({
      ianaZone: 'America/Los_Angeles',
      cycle: {
        start: '2026-04-01T07:00:00.000Z',
        end: '2026-04-02T07:00:00.000Z',
        timezone_offset: '-07:00',
      },
      priorCycle: { timezone_offset: '-07:00' },
    });

    expect(result).toEqual({ baseline_excluded: false, exclusion_reason: null });
  });

  it('Test 5: in-progress cycle (end=null) — Rule 1 skipped, Rule 2 evaluated', () => {
    // end=null skips the DST check; tz drift from prior cycle still fires.
    const result = detectExclusion({
      ianaZone: 'America/Los_Angeles',
      cycle: {
        start: '2026-04-02T13:00:00.000Z',
        end: null,
        timezone_offset: '-05:00',
      },
      priorCycle: { timezone_offset: '-08:00' },
    });

    expect(result).toEqual({ baseline_excluded: true, exclusion_reason: 'tz_drift' });
  });

  it('Test 6: in-progress cycle with no prior — neither rule fires', () => {
    const result = detectExclusion({
      ianaZone: 'America/Los_Angeles',
      cycle: {
        start: '2026-04-02T13:00:00.000Z',
        end: null,
        timezone_offset: '-08:00',
      },
      priorCycle: null,
    });

    expect(result).toEqual({ baseline_excluded: false, exclusion_reason: null });
  });

  it('Test 7: dst_straddle wins when both rules would fire (Rule 1 has precedence)', () => {
    // Synthetic: a cycle straddling spring-forward AND following a tz shift.
    // The Pattern 5 ordering returns `dst_straddle` because Rule 1 is checked
    // first. This locks the OR'd precedence per D-13.
    const result = detectExclusion({
      ianaZone: 'America/Los_Angeles',
      cycle: {
        start: '2026-03-07T15:00:00.000Z',
        end: '2026-03-08T15:00:00.000Z',
        timezone_offset: '-08:00',
      },
      priorCycle: { timezone_offset: '-05:00' },
    });

    expect(result).toEqual({ baseline_excluded: true, exclusion_reason: 'dst_straddle' });
  });

  it('Test 8: purity — identical inputs yield identical outputs', () => {
    const input = {
      ianaZone: 'America/Los_Angeles',
      cycle: {
        start: '2026-03-07T15:00:00.000Z',
        end: '2026-03-08T15:00:00.000Z',
        timezone_offset: '-08:00',
      },
      priorCycle: null,
    };
    const first = detectExclusion(input);
    const second = detectExclusion(input);
    const third = detectExclusion(input);
    expect(first).toEqual(second);
    expect(second).toEqual(third);
  });
});

// #45 — direct coverage for `isParsableIsoDate`. The detect.test.ts suite
// exercises the guard indirectly through `detectExclusion`, but a future
// regression that breaks ISO parsing would only surface via downstream
// expectation noise (a malformed cycle silently flagged as dst_straddle).
// Pinning the guard's behavior here makes the regression localizable.
describe('isParsableIsoDate (guard, direct coverage)', () => {
  it('valid full ISO timestamp (Z) → true', () => {
    expect(isParsableIsoDate('2026-03-07T15:00:00.000Z')).toBe(true);
  });
  it('valid full ISO timestamp with +HH:MM offset → true', () => {
    expect(isParsableIsoDate('2026-03-07T15:00:00.000+08:00')).toBe(true);
  });
  it('valid ISO timestamp with second precision (no .sss) → true', () => {
    expect(isParsableIsoDate('2026-03-07T15:00:00Z')).toBe(true);
  });
  it('bare yyyy-mm-dd (no time component) → false (regex demands time)', () => {
    expect(isParsableIsoDate('2026-03-07')).toBe(false);
  });
  it('malformed string → false', () => {
    expect(isParsableIsoDate('not-a-date')).toBe(false);
  });
  it('empty string → false', () => {
    expect(isParsableIsoDate('')).toBe(false);
  });
  it('calendar rollover (2026-02-30T00:00:00.000Z) → true (Date.parse coerces)', () => {
    // The regex passes; Date.parse silently coerces "2026-02-30" to
    // "2026-03-02". The guard does NOT round-trip the date — it only
    // rejects unparseable strings, not invalid calendar dates. Pinning
    // this behavior so a future caller that requires strict calendar
    // validation can layer their own check on top.
    expect(isParsableIsoDate('2026-02-30T00:00:00.000Z')).toBe(true);
  });
});
