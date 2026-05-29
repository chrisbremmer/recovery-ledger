// Unit coverage for the `most_recent_scored_day` doctor probe (Plan 05-04 /
// D-02 #7).
//
// Distinct signal from last_sync_recency (#6): a sync can succeed with
// all-PENDING data, so "recent sync" and "recent SCORED data" diverge. The
// probe reads latestScoredDate() across cycles+recovery+sleep, picks the
// MAX yyyy-mm-dd (lexicographic == chronological for that format), and
// applies the same 36h/7d threshold ladder. The `clock` seam pins the math
// deterministic. ADR-0006: no real WHOOP / DB calls.

import { describe, expect, test } from 'vitest';
import { CHECK_NAMES } from './check-names.js';
import { type MostRecentScoredDayDeps, probeMostRecentScoredDay } from './most-recent-scored-day.js';

const NOW = new Date('2026-05-26T12:00:00Z');
const clock = () => NOW;

function reposFor(
  c: string | null,
  r: string | null,
  s: string | null,
): MostRecentScoredDayDeps {
  return {
    repos: {
      cycles: { latestScoredDate: () => c },
      recovery: { latestScoredDate: () => r },
      sleep: { latestScoredDate: () => s },
    },
  };
}

describe('probeMostRecentScoredDay', () => {
  test('returns fail when no repos injected', async () => {
    const check = await probeMostRecentScoredDay(undefined, { clock });
    expect(check.name).toBe(CHECK_NAMES.MOST_RECENT_SCORED_DAY);
    expect(check.status).toBe('fail');
    expect(check.detail).toContain('no repos injected');
  });

  test('returns fail when all three repos return null', async () => {
    const check = await probeMostRecentScoredDay(reposFor(null, null, null), { clock });
    expect(check.status).toBe('fail');
    expect(check.detail).toContain('no SCORED data yet');
  });

  test('returns pass when max date is within 36h of clock', async () => {
    // Max date 2026-05-26; age from 2026-05-26T00 to NOW (12:00) is ~12h.
    const check = await probeMostRecentScoredDay(
      reposFor('2026-05-26', '2026-05-26', '2026-05-25'),
      { clock },
    );
    expect(check.status).toBe('pass');
    expect(check.detail).toContain('2026-05-26');
    expect(check.detail).toContain('cycles');
    expect(check.detail).toContain('recovery');
  });

  test('returns warn when max date is 3d old', async () => {
    // Max date 2026-05-23; age ~3.5d -> within 7d -> warn.
    const check = await probeMostRecentScoredDay(
      reposFor('2026-05-23', '2026-05-23', '2026-05-22'),
      { clock },
    );
    expect(check.status).toBe('warn');
    expect(check.detail).toContain('2026-05-23');
    expect(check.detail).toContain('recovery-ledger sync');
  });

  test('returns fail when max date is 10d old', async () => {
    // Max date 2026-05-16; age ~10.5d -> exceeds 7d -> fail.
    const check = await probeMostRecentScoredDay(reposFor('2026-05-16', null, null), { clock });
    expect(check.status).toBe('fail');
    expect(check.detail).toContain('2026-05-16');
    expect(check.detail).toContain('exceeds 7d threshold');
    expect(check.detail).toContain('cycles');
  });
});
