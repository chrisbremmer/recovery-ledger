// Cycles repository — the canonical repository shape for Phase 3. Every other
// scored-paginated repo (recoveries, sleeps, workouts) mirrors this file's
// structure, swapping in resource-specific tables / column lists / id types.
//
// Contract (D-28 + D-29 + ARCHITECTURE.md Anti-Pattern 3):
//   - Returns `Cycle` domain entities (camelCase, discriminated on `scoreState`)
//     — NEVER Drizzle row types. The row→entity mapper lives inside this file
//     and is the sole place snake_case columns become camelCase fields.
//   - Default `byRange()` filter is `score_state = 'SCORED' AND baseline_excluded = 0`
//     per D-04 + D-16 + ADR-0003. Opt-in escape hatches: `includeUnscored` /
//     `includeExcluded`. A caller that forgets the opt-in gets SCORED-only.
//   - `cursor()` is bare `MAX(updated_at) FROM cycles` with COALESCE fallback
//     to `EPOCH_ZERO_ISO` (D-09 + 03-RESEARCH.md Specifics line 240). No WHERE
//     clause — SQLite's `MAX` ignores NULL and the covering
//     `cycles_score_state_start_idx` is not needed for this query (the
//     bare-MAX picks up the implicit B-tree on the primary key + table scan).
//   - `upsertBatch()` wraps every write in `db.transaction(fn, { behavior:
//     'immediate' })` per D-31 + Pitfall 13. ON CONFLICT(id) DO UPDATE per
//     D-11 + Pitfall 10 — every WHOOP-sourced column except the primary key
//     gets re-applied from `excluded.<col>`.
//   - `getRawJson(id)` is the D-29 diagnostic seam consumed by the future
//     Phase 4 `whoop_query_cache` + `whoop_api_gap` tools. Domain code never
//     calls it; the method exists at the repository boundary so the raw
//     WHOOP payload survives schema drift (forward-compat reparse path).
//
// Gate G (Wave 0 chokepoint): `drizzle-orm/*` imports are allowlisted inside
// `src/infrastructure/db/`. This file imports `and`, `asc`, `eq`, `gte`,
// `lte`, `sql` from `drizzle-orm` for the query builder DSL — confined to
// this directory by Gate G.
//
// ADR-0001 (MCP stdout purity): no direct stdout writes / no console calls
// in this file. Errors surface as throws (the row mapper throws on an
// unknown `score_state` value — a defensive impossibility check; the column
// is enum-typed at the schema level).

import { and, asc, desc, eq, gte, lt, lte, sql } from 'drizzle-orm';
import type { drizzle } from 'drizzle-orm/better-sqlite3';
import type { Cycle } from '../../../domain/types/entities.js';
import type { ByRangeOpts } from '../../../domain/types/repos.js';
import { EPOCH_ZERO_ISO } from '../../../domain/types/sync.js';
import { cycles as cyclesTable } from '../schema.js';

export type { ByRangeOpts };

/** Upsert input — Cycle entity carries no `rawJson` (D-29: hidden from
 *  domain); the orchestrator pairs each entity with its WHOOP wire payload
 *  before calling `upsertBatch` so the D-29 diagnostic seam survives
 *  (Issue #12). `rawJson` is a real declared field, not an intersection cast. */
export type CycleUpsertRow = Cycle & { rawJson: string };

export interface CyclesRepo {
  /** `COALESCE(MAX(updated_at), EPOCH_ZERO_ISO)` over the cycles table (D-09). */
  cursor(): string;
  /** Idempotent upsert per Pitfall 10. Returns `{ changed: 0 }` when `rows` is
   *  empty. Wrapped in `BEGIN IMMEDIATE` per D-31. */
  upsertBatch(rows: CycleUpsertRow[]): { changed: number };
  /** Range query over `cycles.start` ∈ [start, end]. Default filter:
   *  `score_state = 'SCORED' AND baseline_excluded = 0` (D-04 + D-16). */
  byRange(start: string, end: string, opts?: ByRangeOpts): Cycle[];
  /** Returns the most recent cycle with `start < startISO` (strict-less-than
   *  upper bound). Used by the sync orchestrator to seed the tz_drift
   *  rolling-prior-offset chain WITHOUT including any cycle inside the
   *  current re-window. Includes PENDING_SCORE / UNSCORABLE / excluded
   *  cycles so the seed reads the true chronologically-prior offset. */
  priorBefore(startISO: string): Cycle | null;
  /** D-29 diagnostic seam. Returns the raw WHOOP JSON payload (the
   *  Phase 3 schema column `raw_json`) or `null` for a missing id. */
  getRawJson(id: number): string | null;
}

type CycleRow = typeof cyclesTable.$inferSelect;

export function createCyclesRepo(db: ReturnType<typeof drizzle>): CyclesRepo {
  return {
    cursor(): string {
      const row = db
        .select({
          cursor: sql<string>`COALESCE(MAX(${cyclesTable.updated_at}), ${EPOCH_ZERO_ISO})`,
        })
        .from(cyclesTable)
        .get();
      return row?.cursor ?? EPOCH_ZERO_ISO;
    },

    upsertBatch(rows: CycleUpsertRow[]): { changed: number } {
      if (rows.length === 0) return { changed: 0 };
      // D-31: BEGIN IMMEDIATE on every write. Pitfall 13: deferred BEGIN
      // can upgrade mid-flight and defeat busy_timeout — immediate locks
      // up front so concurrent readers wait deterministically.
      return db.transaction(
        (tx) => {
          let changed = 0;
          for (const row of rows) {
            const values = cycleEntityToRow(row);
            const result = tx
              .insert(cyclesTable)
              .values(values)
              .onConflictDoUpdate({
                target: cyclesTable.id,
                // Every column except the primary key gets re-applied from
                // `excluded.<col>` per D-11 + Pitfall 10. raw_json is
                // included so retroactive updates re-write the wire payload.
                set: {
                  user_id: sql`excluded.user_id`,
                  created_at: sql`excluded.created_at`,
                  updated_at: sql`excluded.updated_at`,
                  start: sql`excluded.start`,
                  end: sql`excluded.end`,
                  timezone_offset: sql`excluded.timezone_offset`,
                  score_state: sql`excluded.score_state`,
                  strain: sql`excluded.strain`,
                  kilojoule: sql`excluded.kilojoule`,
                  average_heart_rate: sql`excluded.average_heart_rate`,
                  max_heart_rate: sql`excluded.max_heart_rate`,
                  baseline_excluded: sql`excluded.baseline_excluded`,
                  exclusion_reason: sql`excluded.exclusion_reason`,
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

    byRange(start: string, end: string, opts?: ByRangeOpts): Cycle[] {
      const conditions = [gte(cyclesTable.start, start), lte(cyclesTable.start, end)];
      if (!opts?.includeUnscored) {
        conditions.push(eq(cyclesTable.score_state, 'SCORED'));
      }
      if (!opts?.includeExcluded) {
        conditions.push(eq(cyclesTable.baseline_excluded, false));
      }
      const rows = db
        .select()
        .from(cyclesTable)
        .where(and(...conditions))
        .orderBy(asc(cyclesTable.start))
        .all();
      return rows.map(rowToCycle);
    },

    priorBefore(startISO: string): Cycle | null {
      const row = db
        .select()
        .from(cyclesTable)
        .where(lt(cyclesTable.start, startISO))
        .orderBy(desc(cyclesTable.start))
        .limit(1)
        .get();
      return row ? rowToCycle(row) : null;
    },

    getRawJson(id: number): string | null {
      const row = db
        .select({ raw_json: cyclesTable.raw_json })
        .from(cyclesTable)
        .where(eq(cyclesTable.id, id))
        .get();
      return row?.raw_json ?? null;
    },
  };
}

// ----------------------------------------------------------------------------
// Row ↔ entity mappers — the boundary where snake_case columns become
// camelCase domain entities (D-28). Exported privately for the unit suite
// (the canonical shape this plan locks); production callers use the repo
// interface, which is the only surface that crosses out of this file.
// ----------------------------------------------------------------------------

/** snake_case CycleRow → camelCase Cycle (DU narrowed on score_state). */
export function rowToCycle(row: CycleRow): Cycle {
  const base = {
    id: row.id,
    userId: row.user_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    start: row.start,
    end: row.end,
    timezoneOffset: row.timezone_offset,
    baselineExcluded: row.baseline_excluded,
    exclusionReason: row.exclusion_reason,
  };
  switch (row.score_state) {
    case 'SCORED':
      // Throw on NULL score fields under SCORED — wire contract violation
      // that the Zod boundary should have caught. Defensive impossibility
      // check; the entity DU declares these fields as non-nullable.
      if (
        row.strain === null ||
        row.kilojoule === null ||
        row.average_heart_rate === null ||
        row.max_heart_rate === null
      ) {
        throw new Error(
          `cycle ${row.id}: score_state=SCORED but a score field is NULL — row is malformed`,
        );
      }
      return {
        ...base,
        scoreState: 'SCORED',
        strain: row.strain,
        kilojoule: row.kilojoule,
        averageHeartRate: row.average_heart_rate,
        maxHeartRate: row.max_heart_rate,
      };
    case 'PENDING_SCORE':
      return { ...base, scoreState: 'PENDING_SCORE' };
    case 'UNSCORABLE':
      return { ...base, scoreState: 'UNSCORABLE' };
    default: {
      // Defensive impossibility — the schema enum prevents this at write
      // time, but a hand-crafted row insert (e.g., a test fixture) could
      // bypass the column-level enum. Throw loudly rather than silently
      // narrow to `never`.
      const unknown: never = row.score_state;
      throw new Error(`cycle ${row.id}: unknown score_state ${String(unknown)}`);
    }
  }
}

/** camelCase Cycle (+ orchestrator-supplied rawJson) → snake_case insert
 *  values for `cycles` table. `rawJson` is a real declared field on the
 *  upsert input (Issue #12 — no more intersection cast). */
function cycleEntityToRow(c: CycleUpsertRow): typeof cyclesTable.$inferInsert {
  const base = {
    id: c.id,
    user_id: c.userId,
    created_at: c.createdAt,
    updated_at: c.updatedAt,
    start: c.start,
    end: c.end,
    timezone_offset: c.timezoneOffset,
    score_state: c.scoreState,
    baseline_excluded: c.baselineExcluded,
    exclusion_reason: c.exclusionReason,
    raw_json: c.rawJson,
  };
  if (c.scoreState === 'SCORED') {
    return {
      ...base,
      strain: c.strain,
      kilojoule: c.kilojoule,
      average_heart_rate: c.averageHeartRate,
      max_heart_rate: c.maxHeartRate,
    };
  }
  return {
    ...base,
    strain: null,
    kilojoule: null,
    average_heart_rate: null,
    max_heart_rate: null,
  };
}
