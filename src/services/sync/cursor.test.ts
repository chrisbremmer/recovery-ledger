// Unit tests for computeWindow — exhaustive coverage of the 4 override paths
// (D-26 precedence: --since > --days > default 7-day re-window) plus the
// purity invariant (no wall-clock reads). Fixed clock per test eliminates
// timer-mocking infrastructure — the load-bearing testability lever from
// 03-PATTERNS.md D2.
//
// Fixed clock: 2026-05-16T00:00:00.000Z. Trailing-7-day boundary therefore
// lands at 2026-05-09T00:00:00.000Z. ISO-string lexical ordering matches
// chronological ordering for these full-Z-format timestamps per D-10.

import { describe, expect, test, vi } from 'vitest';
import { computeWindow, EPOCH_ZERO_ISO, MS_PER_DAY } from './cursor.js';

const CLOCK = new Date('2026-05-16T00:00:00.000Z');
const CLOCK_ISO = '2026-05-16T00:00:00.000Z';
const SEVEN_DAYS_AGO_ISO = '2026-05-09T00:00:00.000Z';

describe('computeWindow — Group A: default (no flags)', () => {
  test('cursor older than 7d → since === cursor (the older bound wins)', () => {
    // Cursor lands 4+ months back — older than sevenDaysAgo, so cursor wins
    // and the window extends back as far as the cursor (we have not synced
    // in > 7 days).
    const result = computeWindow({
      cursor: '2026-01-01T00:00:00.000Z',
      clock: CLOCK,
    });
    expect(result.since).toBe('2026-01-01T00:00:00.000Z');
    expect(result.until).toBe(CLOCK_ISO);
  });

  test('cursor newer than 7d → since === sevenDaysAgo (load-bearing D-10 re-window)', () => {
    // Cursor is 1 day before clock — newer than sevenDaysAgo. The OLDER
    // bound (sevenDaysAgo) wins; the trailing 7-day re-window catches
    // WHOOP retroactive updates per Pitfall 15. This is the load-bearing
    // D-10 semantic — a freshly-advanced cursor does NOT shrink the window
    // below 7 days.
    const result = computeWindow({
      cursor: '2026-05-15T00:00:00.000Z',
      clock: CLOCK,
    });
    expect(result.since).toBe(SEVEN_DAYS_AGO_ISO);
    expect(result.until).toBe(CLOCK_ISO);
  });

  test('cursor exactly 7d old → since === sevenDaysAgo (strict-less-than at tie)', () => {
    // Tie boundary: cursor === sevenDaysAgo. The strict-less-than
    // comparison `opts.cursor < sevenDaysAgo` is false → the else branch
    // returns sevenDaysAgo. Same result either way at the tie, but the
    // branch matters when the strings differ by sub-millisecond bytes.
    const result = computeWindow({
      cursor: SEVEN_DAYS_AGO_ISO,
      clock: CLOCK,
    });
    expect(result.since).toBe(SEVEN_DAYS_AGO_ISO);
    expect(result.until).toBe(CLOCK_ISO);
  });

  test('empty cursor (EPOCH_ZERO_ISO fallback) → since === EPOCH_ZERO_ISO', () => {
    // D-09 caller-side COALESCE fallback. Epoch is older than sevenDaysAgo;
    // epoch wins; we fetch everything. Effective on first sync over an
    // empty resource table.
    const result = computeWindow({
      cursor: EPOCH_ZERO_ISO,
      clock: CLOCK,
    });
    expect(result.since).toBe(EPOCH_ZERO_ISO);
    expect(result.until).toBe(CLOCK_ISO);
  });
});

describe('computeWindow — Group B: --days flag override', () => {
  test('flagDaysN=30 with newer cursor → since === clock - 30d (cursor IGNORED)', () => {
    // D-26: --days wins over the 7-day default. The cursor is younger than
    // 30 days back but computeWindow does not look at it — explicit window.
    const result = computeWindow({
      cursor: '2026-05-15T00:00:00.000Z',
      clock: CLOCK,
      flagDaysN: 30,
    });
    expect(result.since).toBe('2026-04-16T00:00:00.000Z');
    expect(result.until).toBe(CLOCK_ISO);
  });

  test('flagDaysN=365 backfill ignores cursor', () => {
    const result = computeWindow({
      cursor: '2026-05-15T00:00:00.000Z',
      clock: CLOCK,
      flagDaysN: 365,
    });
    const expectedSince = new Date(CLOCK.getTime() - 365 * MS_PER_DAY).toISOString();
    expect(result.since).toBe(expectedSince);
    expect(result.until).toBe(CLOCK_ISO);
  });

  test('flagDaysN=0 falls through to default 7-day re-window (CLI shim owns the default)', () => {
    // D-26: computeWindow does NOT inject a default; `0` is falsy per the
    // spec. The CLI shim (Plan 03-12) owns the default value of 30.
    // Cursor is newer than 7d so sevenDaysAgo wins.
    const result = computeWindow({
      cursor: '2026-05-15T00:00:00.000Z',
      clock: CLOCK,
      flagDaysN: 0,
    });
    expect(result.since).toBe(SEVEN_DAYS_AGO_ISO);
    expect(result.until).toBe(CLOCK_ISO);
  });
});

describe('computeWindow — Group C: --since flag override (highest precedence)', () => {
  test('flagSinceISO wins over flagDaysN AND cursor', () => {
    // Three-way precedence test: --since > --days > cursor. The user has
    // declared an explicit backfill point — both other inputs are IGNORED.
    const result = computeWindow({
      cursor: '2026-05-15T00:00:00.000Z',
      clock: CLOCK,
      flagSinceISO: '2025-01-01T00:00:00.000Z',
      flagDaysN: 30,
    });
    expect(result.since).toBe('2025-01-01T00:00:00.000Z');
    expect(result.until).toBe(CLOCK_ISO);
  });

  test('flagSinceISO alone returns verbatim with until = clock', () => {
    const result = computeWindow({
      cursor: EPOCH_ZERO_ISO,
      clock: CLOCK,
      flagSinceISO: '2024-06-15T12:34:56.789Z',
    });
    expect(result.since).toBe('2024-06-15T12:34:56.789Z');
    expect(result.until).toBe(CLOCK_ISO);
  });
});

describe('computeWindow — Group D: purity', () => {
  test('two calls with identical opts return identical results (no hidden state)', () => {
    const opts = {
      cursor: '2026-05-15T00:00:00.000Z',
      clock: CLOCK,
    };
    const first = computeWindow(opts);
    const second = computeWindow(opts);
    expect(first).toEqual(second);
    expect(first.since).toBe(SEVEN_DAYS_AGO_ISO);
    expect(second.since).toBe(SEVEN_DAYS_AGO_ISO);
  });

  test('does NOT read the global wall clock — pure function lock', () => {
    // Spy on the global `Date.now` static method. computeWindow MUST NOT
    // call it — the clock is injected via opts.clock. This is the
    // load-bearing purity invariant from 03-PATTERNS.md D2 and D-10.
    const spy = vi.spyOn(Date, 'now');
    try {
      computeWindow({
        cursor: '2026-05-15T00:00:00.000Z',
        clock: CLOCK,
      });
      computeWindow({
        cursor: EPOCH_ZERO_ISO,
        clock: CLOCK,
        flagDaysN: 30,
      });
      computeWindow({
        cursor: EPOCH_ZERO_ISO,
        clock: CLOCK,
        flagSinceISO: '2025-01-01T00:00:00.000Z',
      });
      expect(spy).not.toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
  });
});
