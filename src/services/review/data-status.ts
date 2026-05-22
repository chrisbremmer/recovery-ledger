// buildDataStatus — assembles the DataStatus slot of DailyReviewResult /
// WeeklyReviewResult per D-03 + REV-04 (data-freshness lead). Composes:
//   - latest_sync_at + latest_sync_status from syncRunsRepo.latestFinished()
//   - staleness_days = today - reviewed_date (date-only diff, UTC-anchored)
//   - missing_resources = per-resource trailing-7 freshness scan
//
// REV-04 anchor: this function's output is the FIRST slot of the daily
// review (data_status before today_state) so the formatter (Plan 04-09)
// renders freshness as the lead section. The service layer (daily.ts /
// weekly.ts) MUST call buildDataStatus before composing the rest of the
// result so the wire shape matches D-03 verbatim.
//
// Missing-resources heuristic: a resource is "missing" if it has zero rows
// in [reviewed_date - 6d, reviewed_date] (a trailing-7 window centered at
// reviewed_date). For profile + body_measurements (single-row tables), the
// check is "does the table have any row?" — they are not time-windowed
// because the WHOOP response carries no `updated_at` on those endpoints
// (Phase 3 A4 + Phase 3 D-35). A long-stale profile row will not show as
// missing — that is intentional; Phase 5 doctor surfaces sync age.
//
// ADR-0001 (MCP stdout purity): no console.*, no process.stdout.write.

import type { DataStatus } from '../../domain/review/types.js';
import type { ResourceName } from '../../domain/types/sync.js';
import type { BodyMeasurementsRepo } from '../../infrastructure/db/repositories/body-measurements.repo.js';
import type { CyclesRepo } from '../../infrastructure/db/repositories/cycles.repo.js';
import type { ProfileRepo } from '../../infrastructure/db/repositories/profile.repo.js';
import type { RecoveryRepo } from '../../infrastructure/db/repositories/recovery.repo.js';
import type { SleepsRepo } from '../../infrastructure/db/repositories/sleep.repo.js';
import type { SyncRunsRepo } from '../../infrastructure/db/repositories/sync-runs.repo.js';
import type { WorkoutsRepo } from '../../infrastructure/db/repositories/workouts.repo.js';

const MS_PER_DAY = 86_400_000;

export interface BuildDataStatusDeps {
  repos: {
    cycles: CyclesRepo;
    recoveries: RecoveryRepo;
    sleeps: SleepsRepo;
    workouts: WorkoutsRepo;
    profile: ProfileRepo;
    bodyMeasurements: BodyMeasurementsRepo;
    syncRuns: SyncRunsRepo;
  };
  clock: () => Date;
}

export interface BuildDataStatusInput {
  reviewed_date: string;
  baselineWindow: {
    start: string;
    end: string;
    scored_day_count: number;
    coverage_pct: number;
  };
}

export function buildDataStatus(
  input: BuildDataStatusInput,
  deps: BuildDataStatusDeps,
): DataStatus {
  const latest = deps.repos.syncRuns.latestFinished();

  const staleness_days = diffDaysUtc(input.reviewed_date, deps.clock());

  // Trailing-7 freshness window for entity resources. Anchored at
  // reviewed_date so re-running --date <past> doesn't lie about freshness.
  const trailing7Start = subDaysIso(input.reviewed_date, 6);
  // Use end-of-day on reviewed_date so a cycle that started at reviewed_date
  // counts as present.
  const trailing7End = `${input.reviewed_date}T23:59:59.999Z`;
  const trailing7StartIso = `${trailing7Start}T00:00:00.000Z`;

  const missing_resources: ResourceName[] = [];

  // For entity resources we count both SCORED and unscored rows when checking
  // freshness — a PENDING_SCORE cycle still means "sync happened recently."
  const cycles = deps.repos.cycles.byRange(trailing7StartIso, trailing7End, {
    includeUnscored: true,
    includeExcluded: true,
  });
  if (cycles.length === 0) missing_resources.push('cycles');

  const recoveries = deps.repos.recoveries.byRange(trailing7StartIso, trailing7End, {
    includeUnscored: true,
    includeExcluded: true,
  });
  if (recoveries.length === 0) missing_resources.push('recoveries');

  const sleeps = deps.repos.sleeps.byRange(trailing7StartIso, trailing7End, {
    includeUnscored: true,
    includeExcluded: true,
  });
  if (sleeps.length === 0) missing_resources.push('sleeps');

  const workouts = deps.repos.workouts.byRange(trailing7StartIso, trailing7End, {
    includeUnscored: true,
    includeExcluded: true,
  });
  if (workouts.length === 0) missing_resources.push('workouts');

  // Profile + body_measurements are single-row (or append-on-change) tables
  // with no per-day pacing — presence-only check.
  if (deps.repos.profile.getCurrent() === null) {
    missing_resources.push('profile');
  }
  if (deps.repos.bodyMeasurements.latest() === null) {
    missing_resources.push('body_measurements');
  }

  return {
    reviewed_date: input.reviewed_date,
    latest_sync_at: latest?.finished_at ?? null,
    latest_sync_status: latest?.status ?? null,
    staleness_days,
    baseline_window: { ...input.baselineWindow },
    missing_resources,
  };
}

// ---------------------------------------------------------------------------
// Date helpers. Kept inline rather than pulling in date-fns — the rest of the
// codebase uses `@date-fns/tz` for tz-aware operations only; plain
// UTC-anchored date math is straightforward enough not to warrant a new
// runtime dependency. Both helpers operate on yyyy-mm-dd strings + UTC
// midnight to avoid local-tz drift.
// ---------------------------------------------------------------------------

function diffDaysUtc(reviewedDate: string, now: Date): number {
  const reviewedMs = Date.parse(`${reviewedDate}T00:00:00.000Z`);
  const nowMidnightMs = Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate(),
    0,
    0,
    0,
    0,
  );
  const diff = (nowMidnightMs - reviewedMs) / MS_PER_DAY;
  // floor with a guard for negative inputs (future-dated reviewed_date) —
  // a negative staleness is meaningless to the formatter, clamp to 0.
  return Math.max(0, Math.floor(diff));
}

/** Subtract `days` from a yyyy-mm-dd string in UTC; returns yyyy-mm-dd. */
export function subDaysIso(dateIso: string, days: number): string {
  const ms = Date.parse(`${dateIso}T00:00:00.000Z`);
  if (Number.isNaN(ms)) {
    throw new Error(`subDaysIso: invalid date '${dateIso}'`);
  }
  return new Date(ms - days * MS_PER_DAY).toISOString().slice(0, 10);
}
