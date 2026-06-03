// `most_recent_scored_day` doctor probe — D-02 #7 surface (Plan 05-04).
//
// Distinct signal from last_sync_recency (#6): a sync can succeed with
// all-PENDING data, so a fresh sync does NOT guarantee fresh SCORED data.
// This probe reads latestScoredDate() across cycles+recovery+sleep (the
// SCORED-only filter lives in the repo layer per ADR-0003 / Phase 3 D-04),
// picks the MAX yyyy-mm-dd (lexicographic order == chronological order for
// that format), and applies the same 36h/7d threshold ladder as Task 1.
//
// Threshold consts + formatDuration are duplicated from last-sync-recency.ts
// deliberately: the two-file scope makes DRY-vs-locality favor duplication
// so the tunable thresholds are discoverable in BOTH probe files (Plan
// note line 228). Dep-injection + clock seams mirror the sibling probe.
//
// ADR-0001: no console calls. Gate G: src/services/ file — consumes the
// injected repo methods only, never imports drizzle-orm.

import { sanitize } from '../../../domain/observability/sanitize.js';
import type { DoctorCheck } from '../index.js';
import { CHECK_NAMES } from './check-names.js';

// Threshold consts (D-02 #7, same ladder as #6) — file-level so they are
// discoverable + tunable here as well as in last-sync-recency.ts.
const RECENCY_PASS_MS = 36 * 60 * 60 * 1000; // 36h
const RECENCY_WARN_MS = 7 * 24 * 60 * 60 * 1000; // 7d

/** Compact duration formatter — see last-sync-recency.ts for the rationale
 *  behind carrying a day-granular copy rather than importing the narrower
 *  token-freshness.ts helper. */
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

export interface MostRecentScoredDayDeps {
  /** Subset of the bootstrap Repos this probe consumes. */
  repos?: {
    cycles: { latestScoredDate(): string | null };
    recovery: { latestScoredDate(): string | null };
    sleep: { latestScoredDate(): string | null };
  };
}

export async function probeMostRecentScoredDay(
  deps?: MostRecentScoredDayDeps,
  opts?: { clock?: () => Date },
): Promise<DoctorCheck> {
  if (!deps?.repos) {
    return {
      name: CHECK_NAMES.MOST_RECENT_SCORED_DAY,
      status: 'fail',
      detail: 'no repos injected — run from CLI to exercise scored-day check',
    };
  }

  try {
    const dates = {
      cycles: deps.repos.cycles.latestScoredDate(),
      recovery: deps.repos.recovery.latestScoredDate(),
      sleep: deps.repos.sleep.latestScoredDate(),
    };
    const nonNull = Object.entries(dates).filter(([, d]) => d !== null) as Array<[string, string]>;
    if (nonNull.length === 0) {
      return {
        name: CHECK_NAMES.MOST_RECENT_SCORED_DAY,
        status: 'fail',
        detail: 'no SCORED data yet — run `recovery-ledger sync`',
      };
    }

    // yyyy-mm-dd: lexicographic compare coincides with chronological order.
    const maxDate = nonNull.reduce((acc, [, d]) => (d > acc ? d : acc), '0000-00-00');
    const leaders = nonNull.filter(([, d]) => d === maxDate).map(([k]) => k);
    const trailers = nonNull.filter(([, d]) => d !== maxDate).map(([k, d]) => `${k} at ${d}`);
    const trailersStr = trailers.length > 0 ? `; ${trailers.join(', ')}` : '';
    const resources = `${leaders.join(', ')}${trailersStr}`;

    const now = opts?.clock?.() ?? new Date();
    const ageMs = now.getTime() - new Date(`${maxDate}T00:00:00Z`).getTime();
    const ago = formatDuration(ageMs);

    if (ageMs <= RECENCY_PASS_MS) {
      return {
        name: CHECK_NAMES.MOST_RECENT_SCORED_DAY,
        status: 'pass',
        detail: `most recent SCORED day ${maxDate} (${resources})`,
      };
    }

    if (ageMs <= RECENCY_WARN_MS) {
      return {
        name: CHECK_NAMES.MOST_RECENT_SCORED_DAY,
        status: 'warn',
        detail: `most recent SCORED day ${maxDate}, ${ago} ago — run \`recovery-ledger sync\` (${resources})`,
      };
    }

    return {
      name: CHECK_NAMES.MOST_RECENT_SCORED_DAY,
      status: 'fail',
      detail: `most recent SCORED day ${maxDate}, ${ago} ago — exceeds 7d threshold (${resources})`,
    };
  } catch (err) {
    return {
      name: CHECK_NAMES.MOST_RECENT_SCORED_DAY,
      status: 'fail',
      detail: `probe threw: ${sanitize(err instanceof Error ? err.message : String(err))}`,
    };
  }
}
