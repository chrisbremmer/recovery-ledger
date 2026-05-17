// Sleeps repository — UUID-string id variant of the cycles.repo.ts canonical
// shape. Shares the D-04+D-16 default-SCORED filter, the D-31 BEGIN IMMEDIATE
// write discipline, and the D-29 raw-json seam. Differences from cycles:
//   - `id` is a UUID `text` column, not int64.
//   - Sleeps inherit baseline exclusion from their parent cycle (resolved
//     here via `cycle_id` reverse-lookup: WHOOP v2 sleeps DO NOT carry
//     `cycle_id` on the wire, only `start` + `end`. Phase 3 keeps
//     baseline-excluded gating ON CYCLES ONLY at this layer; Phase 4's
//     baseline service queries sleeps without the exclusion JOIN because
//     the wire shape does not let us resolve sleep → cycle cheaply, and
//     `start`-based filtering on the parent cycle range happens upstream
//     in the review query). We accept `includeExcluded` as a no-op
//     parameter for API symmetry across the four scored repos. If a
//     future Phase 4 plan adds a `sleep.cycle_id` denormalization, this
//     repo will gain the same JOIN-based filter recovery uses.
//   - No baseline_excluded column on the sleeps table itself (Plan 03-02
//     schema only puts it on cycles per D-14).
//
// SCORED sleep fields per WHOOP v2 ScoredSleep: totalInBedTimeMilli,
// totalAwakeTimeMilli, sleepPerformancePercentage, sleepConsistencyPercentage,
// sleepEfficiencyPercentage, respiratoryRate.

import { and, asc, eq, gte, lte, sql } from 'drizzle-orm';
import type { drizzle } from 'drizzle-orm/better-sqlite3';
import type { Sleep } from '../../../domain/types/entities.js';
import type { ByRangeOpts } from '../../../domain/types/repos.js';
import { EPOCH_ZERO_ISO } from '../../../domain/types/sync.js';
import { sleeps as sleepsTable } from '../schema.js';

export type { ByRangeOpts };

/** Upsert input — Sleep entity carries no `rawJson` (D-29: hidden from
 *  domain); the orchestrator pairs each entity with its WHOOP wire payload
 *  before calling `upsertBatch` (Issue #12 — real declared field, no cast). */
export type SleepUpsertRow = Sleep & { rawJson: string };

export interface SleepsRepo {
  cursor(): string;
  upsertBatch(rows: SleepUpsertRow[]): { changed: number };
  byRange(start: string, end: string, opts?: ByRangeOpts): Sleep[];
  getRawJson(id: string): string | null;
}

type SleepRow = typeof sleepsTable.$inferSelect;

export function createSleepsRepo(db: ReturnType<typeof drizzle>): SleepsRepo {
  return {
    cursor(): string {
      const row = db
        .select({
          cursor: sql<string>`COALESCE(MAX(${sleepsTable.updated_at}), ${EPOCH_ZERO_ISO})`,
        })
        .from(sleepsTable)
        .get();
      return row?.cursor ?? EPOCH_ZERO_ISO;
    },

    upsertBatch(rows: SleepUpsertRow[]): { changed: number } {
      if (rows.length === 0) return { changed: 0 };
      return db.transaction(
        (tx) => {
          let changed = 0;
          for (const row of rows) {
            const values = sleepEntityToRow(row);
            const result = tx
              .insert(sleepsTable)
              .values(values)
              .onConflictDoUpdate({
                target: sleepsTable.id,
                set: {
                  user_id: sql`excluded.user_id`,
                  created_at: sql`excluded.created_at`,
                  updated_at: sql`excluded.updated_at`,
                  start: sql`excluded.start`,
                  end: sql`excluded.end`,
                  timezone_offset: sql`excluded.timezone_offset`,
                  score_state: sql`excluded.score_state`,
                  total_in_bed_time_milli: sql`excluded.total_in_bed_time_milli`,
                  total_awake_time_milli: sql`excluded.total_awake_time_milli`,
                  sleep_performance_percentage: sql`excluded.sleep_performance_percentage`,
                  sleep_consistency_percentage: sql`excluded.sleep_consistency_percentage`,
                  sleep_efficiency_percentage: sql`excluded.sleep_efficiency_percentage`,
                  respiratory_rate: sql`excluded.respiratory_rate`,
                  raw_json: sql`excluded.raw_json`,
                },
              })
              .run();
            changed += result.changes;
          }
          return { changed };
        },
        { behavior: 'immediate' },
      );
    },

    byRange(start: string, end: string, opts?: ByRangeOpts): Sleep[] {
      const conditions = [gte(sleepsTable.start, start), lte(sleepsTable.start, end)];
      if (!opts?.includeUnscored) {
        conditions.push(eq(sleepsTable.score_state, 'SCORED'));
      }
      // includeExcluded is accepted for symmetry but is a no-op until Phase 4
      // adds a cycle_id denormalization.
      const rows = db
        .select()
        .from(sleepsTable)
        .where(and(...conditions))
        .orderBy(asc(sleepsTable.start))
        .all();
      return rows.map(rowToSleep);
    },

    getRawJson(id: string): string | null {
      const row = db
        .select({ raw_json: sleepsTable.raw_json })
        .from(sleepsTable)
        .where(eq(sleepsTable.id, id))
        .get();
      return row?.raw_json ?? null;
    },
  };
}

// ----------------------------------------------------------------------------
// Row ↔ entity mappers
// ----------------------------------------------------------------------------

export function rowToSleep(row: SleepRow): Sleep {
  const base = {
    id: row.id,
    userId: row.user_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    start: row.start,
    end: row.end,
    timezoneOffset: row.timezone_offset,
  };
  switch (row.score_state) {
    case 'SCORED':
      if (
        row.total_in_bed_time_milli === null ||
        row.total_awake_time_milli === null ||
        row.sleep_performance_percentage === null ||
        row.sleep_consistency_percentage === null ||
        row.sleep_efficiency_percentage === null ||
        row.respiratory_rate === null
      ) {
        throw new Error(`sleep ${row.id}: score_state=SCORED but a score field is NULL`);
      }
      return {
        ...base,
        scoreState: 'SCORED',
        totalInBedTimeMilli: row.total_in_bed_time_milli,
        totalAwakeTimeMilli: row.total_awake_time_milli,
        sleepPerformancePercentage: row.sleep_performance_percentage,
        sleepConsistencyPercentage: row.sleep_consistency_percentage,
        sleepEfficiencyPercentage: row.sleep_efficiency_percentage,
        respiratoryRate: row.respiratory_rate,
      };
    case 'PENDING_SCORE':
      return { ...base, scoreState: 'PENDING_SCORE' };
    case 'UNSCORABLE':
      return { ...base, scoreState: 'UNSCORABLE' };
    default: {
      const unknown: never = row.score_state;
      throw new Error(`sleep ${row.id}: unknown score_state ${String(unknown)}`);
    }
  }
}

function sleepEntityToRow(s: SleepUpsertRow): typeof sleepsTable.$inferInsert {
  const base = {
    id: s.id,
    user_id: s.userId,
    created_at: s.createdAt,
    updated_at: s.updatedAt,
    start: s.start,
    end: s.end,
    timezone_offset: s.timezoneOffset,
    score_state: s.scoreState,
    raw_json: s.rawJson,
  };
  if (s.scoreState === 'SCORED') {
    return {
      ...base,
      total_in_bed_time_milli: s.totalInBedTimeMilli,
      total_awake_time_milli: s.totalAwakeTimeMilli,
      sleep_performance_percentage: s.sleepPerformancePercentage,
      sleep_consistency_percentage: s.sleepConsistencyPercentage,
      sleep_efficiency_percentage: s.sleepEfficiencyPercentage,
      respiratory_rate: s.respiratoryRate,
    };
  }
  return {
    ...base,
    total_in_bed_time_milli: null,
    total_awake_time_milli: null,
    sleep_performance_percentage: null,
    sleep_consistency_percentage: null,
    sleep_efficiency_percentage: null,
    respiratory_rate: null,
  };
}
