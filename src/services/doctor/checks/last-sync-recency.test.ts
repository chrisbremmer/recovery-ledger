// Unit coverage for the `last_sync_recency` doctor probe (Plan 05-04 / D-02 #6).
//
// Surfaces "did sync run recently?" via repos.syncRuns.latestFinished().
// Threshold ladder: pass <=36h, warn <=7d, fail >7d (or no syncs yet). A
// recent FAILED sync downgrades pass -> warn (a failure is not a clean
// signal). The `clock` injection seam pins the threshold math deterministic
// across timezones / CI runs. ADR-0006: no real WHOOP / DB calls — the
// dep-injection seam keeps the probe pure.

import { describe, expect, test } from 'vitest';
import { CHECK_NAMES } from './check-names.js';
import { type LastSyncRecencyDeps, probeLastSyncRecency } from './last-sync-recency.js';

const NOW = new Date('2026-05-26T12:00:00Z');
const clock = () => NOW;

function reposFor(
  latest: { finished_at: string; status: 'ok' | 'partial' | 'failed' } | null,
): LastSyncRecencyDeps {
  return { repos: { syncRuns: { latestFinished: () => latest } } };
}

describe('probeLastSyncRecency', () => {
  test('returns fail when no repos injected', async () => {
    const check = await probeLastSyncRecency(undefined, { clock });
    expect(check.name).toBe(CHECK_NAMES.LAST_SYNC_RECENCY);
    expect(check.status).toBe('fail');
    expect(check.detail).toContain('no repos injected');
  });

  test('returns fail when latestFinished returns null', async () => {
    const check = await probeLastSyncRecency(reposFor(null), { clock });
    expect(check.name).toBe(CHECK_NAMES.LAST_SYNC_RECENCY);
    expect(check.status).toBe('fail');
    expect(check.detail).toContain('no syncs yet');
  });

  test('returns pass when sync is 12h old', async () => {
    const check = await probeLastSyncRecency(
      reposFor({ finished_at: '2026-05-26T00:00:00Z', status: 'ok' }),
      { clock },
    );
    expect(check.status).toBe('pass');
    expect(check.detail).toContain('12h');
    expect(check.detail).toContain('status: ok');
  });

  test('returns warn when sync is 3d old', async () => {
    const check = await probeLastSyncRecency(
      reposFor({ finished_at: '2026-05-23T12:00:00Z', status: 'ok' }),
      { clock },
    );
    expect(check.status).toBe('warn');
    expect(check.detail).toContain('3d');
    expect(check.detail).toContain('recovery-ledger sync');
  });

  test('returns fail when sync is 10d old', async () => {
    const check = await probeLastSyncRecency(
      reposFor({ finished_at: '2026-05-16T12:00:00Z', status: 'ok' }),
      { clock },
    );
    expect(check.status).toBe('fail');
    expect(check.detail).toContain('10d');
    expect(check.detail).toContain('exceeds 7d threshold');
  });

  test('returns warn when recent sync failed', async () => {
    const check = await probeLastSyncRecency(
      reposFor({ finished_at: '2026-05-26T06:00:00Z', status: 'failed' }),
      { clock },
    );
    // Failure overrides the pass arm even though 6h is well inside 36h.
    expect(check.status).toBe('warn');
    expect(check.detail).toContain('last sync failed');
    expect(check.detail).toContain('6h');
  });
});
