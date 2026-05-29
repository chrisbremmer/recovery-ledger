// `last_sync_recency` doctor probe — D-02 #6 surface (Plan 05-04).
//
// Surfaces "did sync run recently?" by reading the most recent FINISHED
// sync_runs row via the injected `repos.syncRuns.latestFinished()`. The
// threshold ladder (D-02 #6) is: pass <=36h, warn <=7d, fail >7d. A row
// whose status is 'failed' downgrades the pass arm to warn — a recent
// failed sync is not a clean signal even though the timestamp is fresh.
//
// Dep-injection seam (RESEARCH §Open Questions §1): the bootstrap
// composition root passes the production Repos in Plan 05-06. Absent the
// repos the probe returns fail so the user knows the check did not run.
// The `clock` injection seam keeps the threshold math deterministic in
// tests; production omits it and falls back to `new Date()`.
//
// ADR-0001 (CLAUDE.md §Critical Rules): no console calls, no direct stdout
// writes from this module. Gate G: this file is in src/services/ — it
// consumes the injected repo methods only and never imports drizzle-orm.

import { sanitize } from '../../../infrastructure/observability/sanitize.js';
import type { DoctorCheck } from '../index.js';
import { CHECK_NAMES } from './check-names.js';

// Threshold consts (D-02 #6) — file-level so they are discoverable + tunable.
const RECENCY_PASS_MS = 36 * 60 * 60 * 1000; // 36h
const RECENCY_WARN_MS = 7 * 24 * 60 * 60 * 1000; // 7d

/**
 * Render a positive duration in milliseconds as a compact human-readable
 * string showing the top non-zero unit plus the next-finer unit when
 * present: `2d 3h`, `12h`, `5h 12m`, `18m`, `30s`. The token-freshness.ts
 * `formatDuration` only goes down to minutes and never emits days; this
 * probe needs day-granularity (the 7d threshold) and a seconds floor for
 * sub-minute ages, so it carries its own copy rather than importing the
 * narrower sibling helper.
 */
function formatDuration(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const days = Math.floor(totalSeconds / 86_400);
  const hours = Math.floor((totalSeconds % 86_400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (days > 0) {
    return hours > 0 ? `${days}d ${hours}h` : `${days}d`;
  }
  if (hours > 0) {
    return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
  }
  if (minutes > 0) {
    return `${minutes}m`;
  }
  return `${seconds}s`;
}

export interface LastSyncRecencyDeps {
  /** Subset of the bootstrap Repos this probe consumes. Bootstrap passes
   *  the full Repos in Plan 05-06; unit tests pass a per-method mock. */
  repos?: {
    syncRuns: {
      latestFinished(): { finished_at: string; status: 'ok' | 'partial' | 'failed' } | null;
    };
  };
}

export async function probeLastSyncRecency(
  deps?: LastSyncRecencyDeps,
  opts?: { clock?: () => Date },
): Promise<DoctorCheck> {
  if (!deps?.repos) {
    return {
      name: CHECK_NAMES.LAST_SYNC_RECENCY,
      status: 'fail',
      detail: 'no repos injected — run from CLI to exercise sync-recency check',
    };
  }

  try {
    const row = deps.repos.syncRuns.latestFinished();
    if (row === null) {
      return {
        name: CHECK_NAMES.LAST_SYNC_RECENCY,
        status: 'fail',
        detail: 'no syncs yet — run `recovery-ledger sync`',
      };
    }

    const now = opts?.clock?.() ?? new Date();
    const ageMs = now.getTime() - new Date(row.finished_at).getTime();
    const ago = formatDuration(ageMs);

    // A recent failure is not a clean signal — downgrade pass to warn.
    if (row.status === 'failed' && ageMs <= RECENCY_PASS_MS) {
      return {
        name: CHECK_NAMES.LAST_SYNC_RECENCY,
        status: 'warn',
        detail: `last sync failed ${ago} ago — run \`recovery-ledger sync\` to retry`,
      };
    }

    if (ageMs <= RECENCY_PASS_MS) {
      return {
        name: CHECK_NAMES.LAST_SYNC_RECENCY,
        status: 'pass',
        detail: `last sync ${ago} ago (status: ${row.status})`,
      };
    }

    if (ageMs <= RECENCY_WARN_MS) {
      return {
        name: CHECK_NAMES.LAST_SYNC_RECENCY,
        status: 'warn',
        detail: `last sync ${ago} ago — run \`recovery-ledger sync\` (status: ${row.status})`,
      };
    }

    return {
      name: CHECK_NAMES.LAST_SYNC_RECENCY,
      status: 'fail',
      detail: `last sync ${ago} ago — exceeds 7d threshold; run \`recovery-ledger sync\``,
    };
  } catch (err) {
    return {
      name: CHECK_NAMES.LAST_SYNC_RECENCY,
      status: 'fail',
      detail: `probe threw: ${sanitize(err instanceof Error ? err.message : String(err))}`,
    };
  }
}
