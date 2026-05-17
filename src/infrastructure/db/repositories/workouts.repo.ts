// Workouts repository — UUID-string id variant matching sleeps.repo.ts in
// shape, with workout-specific SCORED fields per WHOOP v2 ScoredWorkout:
// strain, averageHeartRate, maxHeartRate, kilojoule, distanceMeter (nullable),
// altitudeGainMeter (nullable), altitudeChangeMeter (nullable). `sportId`
// is non-score metadata that ships on every variant per A6.
//
// Like sleeps, workouts inherit baseline exclusion at the review-query
// layer (Phase 4) — Phase 3 schema does not put `baseline_excluded` on
// the workouts table. `includeExcluded` is accepted for API symmetry.

import { and, asc, eq, gte, lte, sql } from 'drizzle-orm';
import type { drizzle } from 'drizzle-orm/better-sqlite3';
import type { Workout } from '../../../domain/types/entities.js';
import type { ByRangeOpts } from '../../../domain/types/repos.js';
import { EPOCH_ZERO_ISO } from '../../../domain/types/sync.js';
import { workouts as workoutsTable } from '../schema.js';

export type { ByRangeOpts };

export interface WorkoutsRepo {
  cursor(): string;
  upsertBatch(rows: Workout[]): { changed: number };
  byRange(start: string, end: string, opts?: ByRangeOpts): Workout[];
  getRawJson(id: string): string | null;
}

type WorkoutRow = typeof workoutsTable.$inferSelect;

export function createWorkoutsRepo(db: ReturnType<typeof drizzle>): WorkoutsRepo {
  return {
    cursor(): string {
      const row = db
        .select({
          cursor: sql<string>`COALESCE(MAX(${workoutsTable.updated_at}), ${EPOCH_ZERO_ISO})`,
        })
        .from(workoutsTable)
        .get();
      return row?.cursor ?? EPOCH_ZERO_ISO;
    },

    upsertBatch(rows: Workout[]): { changed: number } {
      if (rows.length === 0) return { changed: 0 };
      return db.transaction(
        (tx) => {
          let changed = 0;
          for (const row of rows) {
            const values = workoutEntityToRow(row);
            const result = tx
              .insert(workoutsTable)
              .values(values)
              .onConflictDoUpdate({
                target: workoutsTable.id,
                set: {
                  user_id: sql`excluded.user_id`,
                  created_at: sql`excluded.created_at`,
                  updated_at: sql`excluded.updated_at`,
                  start: sql`excluded.start`,
                  end: sql`excluded.end`,
                  timezone_offset: sql`excluded.timezone_offset`,
                  sport_id: sql`excluded.sport_id`,
                  score_state: sql`excluded.score_state`,
                  strain: sql`excluded.strain`,
                  average_heart_rate: sql`excluded.average_heart_rate`,
                  max_heart_rate: sql`excluded.max_heart_rate`,
                  kilojoule: sql`excluded.kilojoule`,
                  distance_meter: sql`excluded.distance_meter`,
                  altitude_gain_meter: sql`excluded.altitude_gain_meter`,
                  altitude_change_meter: sql`excluded.altitude_change_meter`,
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

    byRange(start: string, end: string, opts?: ByRangeOpts): Workout[] {
      const conditions = [gte(workoutsTable.start, start), lte(workoutsTable.start, end)];
      if (!opts?.includeUnscored) {
        conditions.push(eq(workoutsTable.score_state, 'SCORED'));
      }
      const rows = db
        .select()
        .from(workoutsTable)
        .where(and(...conditions))
        .orderBy(asc(workoutsTable.start))
        .all();
      return rows.map(rowToWorkout);
    },

    getRawJson(id: string): string | null {
      const row = db
        .select({ raw_json: workoutsTable.raw_json })
        .from(workoutsTable)
        .where(eq(workoutsTable.id, id))
        .get();
      return row?.raw_json ?? null;
    },
  };
}

// ----------------------------------------------------------------------------
// Row ↔ entity mappers
// ----------------------------------------------------------------------------

export function rowToWorkout(row: WorkoutRow): Workout {
  const base = {
    id: row.id,
    userId: row.user_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    start: row.start,
    end: row.end,
    timezoneOffset: row.timezone_offset,
    sportId: row.sport_id,
  };
  switch (row.score_state) {
    case 'SCORED':
      if (
        row.strain === null ||
        row.average_heart_rate === null ||
        row.max_heart_rate === null ||
        row.kilojoule === null
      ) {
        throw new Error(`workout ${row.id}: score_state=SCORED but a required score field is NULL`);
      }
      return {
        ...base,
        scoreState: 'SCORED',
        strain: row.strain,
        averageHeartRate: row.average_heart_rate,
        maxHeartRate: row.max_heart_rate,
        kilojoule: row.kilojoule,
        // distance_meter / altitude_*_meter are wire-nullable; the entity
        // mirrors that shape (sport-specific metrics).
        distanceMeter: row.distance_meter,
        altitudeGainMeter: row.altitude_gain_meter,
        altitudeChangeMeter: row.altitude_change_meter,
      };
    case 'PENDING_SCORE':
      return { ...base, scoreState: 'PENDING_SCORE' };
    case 'UNSCORABLE':
      return { ...base, scoreState: 'UNSCORABLE' };
    default: {
      const unknown: never = row.score_state;
      throw new Error(`workout ${row.id}: unknown score_state ${String(unknown)}`);
    }
  }
}

function workoutEntityToRow(w: Workout): typeof workoutsTable.$inferInsert {
  const base = {
    id: w.id,
    user_id: w.userId,
    created_at: w.createdAt,
    updated_at: w.updatedAt,
    start: w.start,
    end: w.end,
    timezone_offset: w.timezoneOffset,
    sport_id: w.sportId,
    score_state: w.scoreState,
    raw_json: (w as Workout & { rawJson?: string }).rawJson ?? '{}',
  };
  if (w.scoreState === 'SCORED') {
    return {
      ...base,
      strain: w.strain,
      average_heart_rate: w.averageHeartRate,
      max_heart_rate: w.maxHeartRate,
      kilojoule: w.kilojoule,
      distance_meter: w.distanceMeter,
      altitude_gain_meter: w.altitudeGainMeter,
      altitude_change_meter: w.altitudeChangeMeter,
    };
  }
  return {
    ...base,
    strain: null,
    average_heart_rate: null,
    max_heart_rate: null,
    kilojoule: null,
    distance_meter: null,
    altitude_gain_meter: null,
    altitude_change_meter: null,
  };
}
