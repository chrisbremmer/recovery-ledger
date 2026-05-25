// resolveReviewedDate — D-01 single-anchor date resolver. Pure(-ish) service:
// reads through the injected `cycles` repo + the injected clock; no I/O
// outside repo + clock. The resolved date is the single anchor for the
// trailing-30 baseline window (D-02), the trailing-28 pattern-test window
// (D-12), and the trailing-7 week-summary window (D-17) — every Phase 4
// review surface (daily, weekly, MCP resource) derives those windows from
// the value this function returns.
//
// Resolution order (D-01):
//   1. `input.date` valid yyyy-mm-dd      → { date, source: 'cli_flag' }
//   2. MAX(start.slice(0,10)) over the default-filtered cycles repo
//      (SCORED + non-DST-excluded per Phase 3 D-04/D-16)
//                                          → { date, source: 'latest_scored' }
//   3. Else (zero SCORED days in DB)      → { date: clock().slice(0,10),
//                                              source: 'fallback_today' }
//      The caller (Plan 04-07 daily/weekly service) is responsible for
//      surfacing `insufficient_reason` when this path triggers — the
//      review still renders (ADR-0004), but with empty anomalies/actions.
//
// Reproducibility (D-02 anchor): when the caller passes `input.date`, the
// clock is NEVER read — re-running `review daily --date 2026-03-15` next
// month gives the same numbers because every downstream window is
// `subDays(reviewed_date, N)`, not `subDays(today, N)`.
//
// ADR-0001 (MCP stdout purity): no console.*, no process.stdout.write.
// Errors throw (invalid `input.date`); the caller's transport layer
// (CLI shim / MCP register) decides whether to render or sanitize.

import type { CyclesRepo } from '../../infrastructure/db/repositories/cycles.repo.js';

/** Strict yyyy-mm-dd date matcher. Rejects yyyy/mm/dd, dd-mm-yyyy, ISO with
 *  time, free text. Does NOT validate calendar correctness (Feb 30 etc.);
 *  the additional `Date.parse(`${s}T00:00:00.000Z`)` check catches that. */
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Future bound for `--date` (#33). Allow exactly 1 day ahead so a user
 *  syncing late at night sees "today" in their local zone resolve to a
 *  date that may be UTC-tomorrow. Anything beyond is rejected — a daily
 *  review against tomorrow has nothing to say. */
const MAX_FUTURE_DAYS = 1;
/** Past bound for `--date` (#33). 365 days back captures the entire useful
 *  history for a single-user tool whose baselines look at trailing-30. A
 *  request beyond a year is almost certainly a typo or a user trying to
 *  re-render something against data we no longer have. */
const MAX_PAST_DAYS = 365;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

export interface ResolveReviewedDateDeps {
  repos: { cycles: CyclesRepo };
  clock: () => Date;
}

export interface ResolveReviewedDateResult {
  date: string;
  source: 'cli_flag' | 'latest_scored' | 'fallback_today';
}

export async function resolveReviewedDate(
  input: { date?: string },
  deps: ResolveReviewedDateDeps,
): Promise<ResolveReviewedDateResult> {
  if (input.date !== undefined) {
    if (!ISO_DATE_RE.test(input.date)) {
      throw new Error(
        `resolveReviewedDate: input.date must be yyyy-mm-dd, received '${input.date}'`,
      );
    }
    // Calendar-validity check — strict round-trip through Date.parse.
    const parsed = new Date(`${input.date}T00:00:00.000Z`);
    const roundTrip = parsed.toISOString().slice(0, 10);
    if (Number.isNaN(parsed.getTime()) || roundTrip !== input.date) {
      throw new Error(
        `resolveReviewedDate: input.date is not a valid calendar date: '${input.date}'`,
      );
    }
    // #33 — bound the date against the clock so future-dated reviews
    // (silent no-data renders) and ancient-dated reviews (confusing
    // baseline errors) get caught at the boundary with a clear message.
    const today = deps.clock();
    const todayMs = today.getTime();
    const dateMs = parsed.getTime();
    if (dateMs > todayMs + MAX_FUTURE_DAYS * MS_PER_DAY) {
      throw new Error(
        `resolveReviewedDate: input.date '${input.date}' is more than ${MAX_FUTURE_DAYS} day(s) in the future`,
      );
    }
    if (dateMs < todayMs - MAX_PAST_DAYS * MS_PER_DAY) {
      throw new Error(
        `resolveReviewedDate: input.date '${input.date}' is more than ${MAX_PAST_DAYS} days in the past`,
      );
    }
    return { date: input.date, source: 'cli_flag' };
  }

  // use `latestScoredDate()` — a single SELECT MAX aggregate —
  // instead of `byRange(MIN_ISO, MAX_ISO)` which pulled the entire SCORED
  // history into memory just to walk for the max. The default repo filter
  // (`SCORED + baseline_excluded = 0`, Phase 3 D-04/D-16) is preserved
  // inside the new repo method.
  const latestDate = deps.repos.cycles.latestScoredDate();
  if (latestDate === null) {
    return {
      date: deps.clock().toISOString().slice(0, 10),
      source: 'fallback_today',
    };
  }
  return { date: latestDate, source: 'latest_scored' };
}
