// Recovery repository — compound-PK variant of the cycles.repo.ts canonical
// shape. Shares D-28 mapping discipline, D-04+D-16 default SCORED + non-
// excluded filters, D-31 BEGIN IMMEDIATE writes, and D-29 getRawJson seam.
// Key difference: the primary key is (cycle_id, sleep_id) per A12 — so
// upsert targets a composite, and `byCycleAndSleep` lookup takes both
// halves. Recoveries also have no `start` column on the wire (A4); range
// queries run against `created_at`, backed by the (score_state, created_at)
// covering index from Plan 03-02.
//
// Baseline exclusion (D-14 + D-16): recoveries do NOT carry the
// `baseline_excluded` flag — they inherit it from `cycles.cycle_id` at
// query time via a JOIN. The default filter joins recoveries → cycles and
// excludes any row whose parent cycle has `baseline_excluded = 1`.
//
// Gate G allowed inside src/infrastructure/db/ (drizzle-orm/* import OK).
// ADR-0001: no direct stdout writes / no console calls.

import { and, asc, eq, gte, lte, sql } from 'drizzle-orm';
import type { drizzle } from 'drizzle-orm/better-sqlite3';
import type { Recovery } from '../../../domain/types/entities.js';
import type { ByRangeOpts } from '../../../domain/types/repos.js';
import { EPOCH_ZERO_ISO } from '../../../domain/types/sync.js';
import { cycles as cyclesTable, recoveries as recoveriesTable } from '../schema.js';

export type { ByRangeOpts };

export interface RecoveryRepo {
  /** `COALESCE(MAX(updated_at), EPOCH_ZERO_ISO)` over the recoveries table. */
  cursor(): string;
  /** Idempotent upsert with compound-PK target (cycle_id, sleep_id). */
  upsertBatch(rows: Recovery[]): { changed: number };
  /** Compound-key point lookup; null when the row is absent. */
  byCycleAndSleep(cycleId: number, sleepId: string): Recovery | null;
  /** Range query over `recoveries.created_at` ∈ [start, end]. Default filter:
   *  SCORED + cycle's `baseline_excluded = 0` (D-04 + D-16). */
  byRange(start: string, end: string, opts?: ByRangeOpts): Recovery[];
  /** D-29 diagnostic seam — compound-key lookup. */
  getRawJson(cycleId: number, sleepId: string): string | null;
}

type RecoveryRow = typeof recoveriesTable.$inferSelect;

export function createRecoveryRepo(db: ReturnType<typeof drizzle>): RecoveryRepo {
  return {
    cursor(): string {
      const row = db
        .select({
          cursor: sql<string>`COALESCE(MAX(${recoveriesTable.updated_at}), ${EPOCH_ZERO_ISO})`,
        })
        .from(recoveriesTable)
        .get();
      return row?.cursor ?? EPOCH_ZERO_ISO;
    },

    upsertBatch(rows: Recovery[]): { changed: number } {
      if (rows.length === 0) return { changed: 0 };
      return db.transaction(
        (tx) => {
          let changed = 0;
          for (const row of rows) {
            const values = recoveryEntityToRow(row);
            const result = tx
              .insert(recoveriesTable)
              .values(values)
              .onConflictDoUpdate({
                // Compound-PK target per A12 — ON CONFLICT(cycle_id, sleep_id).
                target: [recoveriesTable.cycle_id, recoveriesTable.sleep_id],
                set: {
                  user_id: sql`excluded.user_id`,
                  created_at: sql`excluded.created_at`,
                  updated_at: sql`excluded.updated_at`,
                  score_state: sql`excluded.score_state`,
                  recovery_score: sql`excluded.recovery_score`,
                  resting_heart_rate: sql`excluded.resting_heart_rate`,
                  hrv_rmssd_milli: sql`excluded.hrv_rmssd_milli`,
                  spo2_percentage: sql`excluded.spo2_percentage`,
                  skin_temp_celsius: sql`excluded.skin_temp_celsius`,
                  user_calibrating: sql`excluded.user_calibrating`,
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

    byCycleAndSleep(cycleId: number, sleepId: string): Recovery | null {
      const row = db
        .select()
        .from(recoveriesTable)
        .where(and(eq(recoveriesTable.cycle_id, cycleId), eq(recoveriesTable.sleep_id, sleepId)))
        .get();
      return row ? rowToRecovery(row) : null;
    },

    byRange(start: string, end: string, opts?: ByRangeOpts): Recovery[] {
      // Range on created_at; recoveries have no `start` on the wire (A4).
      // The covering index `recoveries_score_state_start_idx` is on
      // (score_state, created_at) per Plan 03-02.
      const conditions = [
        gte(recoveriesTable.created_at, start),
        lte(recoveriesTable.created_at, end),
      ];
      if (!opts?.includeUnscored) {
        conditions.push(eq(recoveriesTable.score_state, 'SCORED'));
      }
      if (!opts?.includeExcluded) {
        // D-14 + D-16: recoveries inherit exclusion via cycles.cycle_id.
        // JOIN onto cycles and filter on the parent's baseline_excluded.
        const rows = db
          .select({ recovery: recoveriesTable })
          .from(recoveriesTable)
          .innerJoin(cyclesTable, eq(recoveriesTable.cycle_id, cyclesTable.id))
          .where(and(...conditions, eq(cyclesTable.baseline_excluded, false)))
          .orderBy(asc(recoveriesTable.created_at))
          .all();
        return rows.map((r) => rowToRecovery(r.recovery));
      }
      const rows = db
        .select()
        .from(recoveriesTable)
        .where(and(...conditions))
        .orderBy(asc(recoveriesTable.created_at))
        .all();
      return rows.map(rowToRecovery);
    },

    getRawJson(cycleId: number, sleepId: string): string | null {
      const row = db
        .select({ raw_json: recoveriesTable.raw_json })
        .from(recoveriesTable)
        .where(and(eq(recoveriesTable.cycle_id, cycleId), eq(recoveriesTable.sleep_id, sleepId)))
        .get();
      return row?.raw_json ?? null;
    },
  };
}

// ----------------------------------------------------------------------------
// Row ↔ entity mappers
// ----------------------------------------------------------------------------

export function rowToRecovery(row: RecoveryRow): Recovery {
  const base = {
    cycleId: row.cycle_id,
    sleepId: row.sleep_id,
    userId: row.user_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
  switch (row.score_state) {
    case 'SCORED':
      if (
        row.recovery_score === null ||
        row.resting_heart_rate === null ||
        row.hrv_rmssd_milli === null ||
        row.spo2_percentage === null ||
        row.skin_temp_celsius === null ||
        row.user_calibrating === null
      ) {
        throw new Error(
          `recovery ${row.cycle_id}/${row.sleep_id}: score_state=SCORED but a score field is NULL`,
        );
      }
      return {
        ...base,
        scoreState: 'SCORED',
        recoveryScore: row.recovery_score,
        restingHeartRate: row.resting_heart_rate,
        hrvRmssdMilli: row.hrv_rmssd_milli,
        spo2Percentage: row.spo2_percentage,
        skinTempCelsius: row.skin_temp_celsius,
        userCalibrating: row.user_calibrating,
      };
    case 'PENDING_SCORE':
      return { ...base, scoreState: 'PENDING_SCORE' };
    case 'UNSCORABLE':
      return { ...base, scoreState: 'UNSCORABLE' };
    default: {
      const unknown: never = row.score_state;
      throw new Error(
        `recovery ${row.cycle_id}/${row.sleep_id}: unknown score_state ${String(unknown)}`,
      );
    }
  }
}

function recoveryEntityToRow(r: Recovery): typeof recoveriesTable.$inferInsert {
  const base = {
    cycle_id: r.cycleId,
    sleep_id: r.sleepId,
    user_id: r.userId,
    created_at: r.createdAt,
    updated_at: r.updatedAt,
    score_state: r.scoreState,
    raw_json: (r as Recovery & { rawJson?: string }).rawJson ?? '{}',
  };
  if (r.scoreState === 'SCORED') {
    return {
      ...base,
      recovery_score: r.recoveryScore,
      resting_heart_rate: r.restingHeartRate,
      hrv_rmssd_milli: r.hrvRmssdMilli,
      spo2_percentage: r.spo2Percentage,
      skin_temp_celsius: r.skinTempCelsius,
      user_calibrating: r.userCalibrating,
    };
  }
  return {
    ...base,
    recovery_score: null,
    resting_heart_rate: null,
    hrv_rmssd_milli: null,
    spo2_percentage: null,
    skin_temp_celsius: null,
    user_calibrating: null,
  };
}
