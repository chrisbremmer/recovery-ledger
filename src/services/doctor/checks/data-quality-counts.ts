// `data_quality_counts` doctor probe — D-02 #8 surface (Plan 05-04).
//
// The Pitfall 19 visibility surface: silent missing / unscored days become
// proactively visible instead of waiting for the user to notice a stale
// review. Per D-02 #8 the probe is informational ONLY — when repos are
// injected it ALWAYS returns status 'pass' so it never gates the overall
// doctor result. The detail string concatenates per-resource counts (SCORED
// / PENDING_SCORE / UNSCORABLE / excluded) from countByScoreState() across
// cycles+recovery+sleep, in the verbatim format from 05-CONTEXT.md
// §Specifics line 273.
//
// A missing-repos invocation is a degenerate error — surfaced as fail so the
// user knows the check did not run.
//
// Catch-arm choice (plan-allowed deviation): on throw during count
// gathering this probe returns FAIL ('probe threw: ...') rather than the
// always-pass-with-partial-detail alternative. Rationale: it matches the
// uniform catch convention of every sibling doctor probe (auth.ts,
// token-freshness.ts, last-sync-recency.ts) and Promise.allSettled in
// runDoctor() — a thrown probe is a genuine fault worth surfacing, distinct
// from the always-pass informational posture of the happy path. T-05-I4
// (info disclosure) stays accepted: the counts are non-sensitive aggregates.
//
// ADR-0001: no console calls. Gate G: src/services/ file — consumes the
// injected repo methods only, never imports drizzle-orm.

import { sanitize } from '../../../infrastructure/observability/sanitize.js';
import type { DoctorCheck } from '../index.js';
import { CHECK_NAMES } from './check-names.js';

interface ScoreStateCounts {
  scored: number;
  pending: number;
  unscorable: number;
  excluded: number;
}

function formatResource(label: string, c: ScoreStateCounts): string {
  return `${label}: ${c.scored} scored, ${c.pending} pending, ${c.unscorable} unscorable, ${c.excluded} excluded`;
}

export interface DataQualityCountsDeps {
  /** Subset of the bootstrap Repos this probe consumes. */
  repos?: {
    cycles: { countByScoreState(): ScoreStateCounts };
    recovery: { countByScoreState(): ScoreStateCounts };
    sleep: { countByScoreState(): ScoreStateCounts };
  };
}

export async function probeDataQualityCounts(deps?: DataQualityCountsDeps): Promise<DoctorCheck> {
  if (!deps?.repos) {
    return {
      name: CHECK_NAMES.DATA_QUALITY_COUNTS,
      status: 'fail',
      detail: 'no repos injected — run from CLI to exercise data-quality check',
    };
  }

  try {
    const c = deps.repos.cycles.countByScoreState();
    const r = deps.repos.recovery.countByScoreState();
    const s = deps.repos.sleep.countByScoreState();
    const detail = [
      formatResource('cycles', c),
      formatResource('recovery', r),
      formatResource('sleep', s),
    ].join('; ');
    return {
      name: CHECK_NAMES.DATA_QUALITY_COUNTS,
      status: 'pass',
      detail,
    };
  } catch (err) {
    return {
      name: CHECK_NAMES.DATA_QUALITY_COUNTS,
      status: 'fail',
      detail: `probe threw: ${sanitize(err instanceof Error ? err.message : String(err))}`,
    };
  }
}
