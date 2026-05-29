// Unit coverage for the `data_quality_counts` doctor probe (Plan 05-04 /
// D-02 #8).
//
// The Pitfall 19 visibility surface: ALWAYS status 'pass' when repos are
// injected (informational only — it never gates the overall doctor result).
// The detail string concatenates per-resource SCORED / PENDING / UNSCORABLE
// / excluded counts from countByScoreState() across cycles+recovery+sleep.
// A missing-repos invocation is a degenerate error surfaced as fail so the
// user knows the check did not run. ADR-0006: no real WHOOP / DB calls.

import { describe, expect, test } from 'vitest';
import { CHECK_NAMES } from './check-names.js';
import { type DataQualityCountsDeps, probeDataQualityCounts } from './data-quality-counts.js';

type Counts = { scored: number; pending: number; unscorable: number; excluded: number };

function reposFor(c: Counts, r: Counts, s: Counts): DataQualityCountsDeps {
  return {
    repos: {
      cycles: { countByScoreState: () => c },
      recovery: { countByScoreState: () => r },
      sleep: { countByScoreState: () => s },
    },
  };
}

describe('probeDataQualityCounts', () => {
  test('returns fail when no repos injected', async () => {
    const check = await probeDataQualityCounts(undefined);
    expect(check.name).toBe(CHECK_NAMES.DATA_QUALITY_COUNTS);
    expect(check.status).toBe('fail');
    expect(check.detail).toContain('no repos injected');
  });

  test('returns pass with concatenated per-resource counts', async () => {
    const check = await probeDataQualityCounts(
      reposFor(
        { scored: 142, pending: 3, unscorable: 0, excluded: 2 },
        { scored: 140, pending: 2, unscorable: 1, excluded: 0 },
        { scored: 138, pending: 5, unscorable: 0, excluded: 1 },
      ),
    );
    expect(check.name).toBe(CHECK_NAMES.DATA_QUALITY_COUNTS);
    expect(check.status).toBe('pass');
    expect(check.detail).toBe(
      'cycles: 142 scored, 3 pending, 0 unscorable, 2 excluded; recovery: 140 scored, 2 pending, 1 unscorable, 0 excluded; sleep: 138 scored, 5 pending, 0 unscorable, 1 excluded',
    );
  });

  test('returns pass with empty zeros when all repos are empty', async () => {
    const zeros = { scored: 0, pending: 0, unscorable: 0, excluded: 0 };
    const check = await probeDataQualityCounts(reposFor(zeros, zeros, zeros));
    expect(check.status).toBe('pass');
    expect(check.detail).toContain('cycles: 0 scored');
    expect(check.detail).toContain('recovery: 0 scored');
    expect(check.detail).toContain('sleep: 0 scored');
  });
});
