// Body-measurements repository — append-on-change history per D-35 and
// Open Question 3. WHOOP returns body measurements without a stable id;
// we synthesize an auto-incrementing integer id at the schema layer
// (Plan 03-02). Sync flow calls upsertOnChange() once per run; the repo
// compares the incoming tuple (heightMeter, weightKilogram, maxHeartRate)
// against the latest row and only inserts when something changed.
//
// History semantics: the table grows monotonically — never deleted, never
// updated. `captured_at` is the sync-time ISO string from the injected
// clock so the orchestrator can pin a stable history timeline regardless
// of WHOOP's response shape (which omits a measurement timestamp).
//
// BEGIN IMMEDIATE per D-31 around the read-compare-insert tuple — without
// it, two concurrent syncs could both observe an unchanged latest row,
// both decide "insert", and end up with duplicate history entries.

import { desc, eq } from 'drizzle-orm';
import type { drizzle } from 'drizzle-orm/better-sqlite3';
import type { BodyMeasurement } from '../../../domain/types/entities.js';
import { body_measurements as bodyMeasurementsTable } from '../schema.js';

export interface BodyMeasurementsRepo {
  /** Append-on-change: compare tuple (height_meter, weight_kilogram,
   *  max_heart_rate) against the latest row for `userId`; insert only on
   *  change. Returns `{inserted: true}` on insert; `{inserted: false}`
   *  when nothing changed. */
  upsertOnChange(
    measurement: {
      userId: number;
      heightMeter: number;
      weightKilogram: number;
      maxHeartRate: number;
      rawJson: string;
    },
    opts: { clock: Date },
  ): { inserted: boolean };
  /** History sorted by captured_at DESC (newest first). */
  listAll(): BodyMeasurement[];
  /** Most recent measurement or null if the table is empty. */
  latest(): BodyMeasurement | null;
  /** D-29 diagnostic seam — synthetic-id lookup. */
  getRawJson(id: number): string | null;
}

type BodyMeasurementRow = typeof bodyMeasurementsTable.$inferSelect;

export function createBodyMeasurementsRepo(db: ReturnType<typeof drizzle>): BodyMeasurementsRepo {
  return {
    upsertOnChange(measurement, opts): { inserted: boolean } {
      return db.transaction(
        (tx) => {
          const latestRow = tx
            .select()
            .from(bodyMeasurementsTable)
            .where(eq(bodyMeasurementsTable.user_id, measurement.userId))
            .orderBy(desc(bodyMeasurementsTable.captured_at))
            .limit(1)
            .get();

          if (
            latestRow &&
            latestRow.height_meter === measurement.heightMeter &&
            latestRow.weight_kilogram === measurement.weightKilogram &&
            latestRow.max_heart_rate === measurement.maxHeartRate
          ) {
            return { inserted: false };
          }

          tx.insert(bodyMeasurementsTable)
            .values({
              user_id: measurement.userId,
              height_meter: measurement.heightMeter,
              weight_kilogram: measurement.weightKilogram,
              max_heart_rate: measurement.maxHeartRate,
              captured_at: opts.clock.toISOString(),
              raw_json: measurement.rawJson,
            })
            .run();
          return { inserted: true };
        },
        { behavior: 'immediate' },
      );
    },

    listAll(): BodyMeasurement[] {
      const rows = db
        .select()
        .from(bodyMeasurementsTable)
        .orderBy(desc(bodyMeasurementsTable.captured_at))
        .all();
      return rows.map(rowToBodyMeasurement);
    },

    latest(): BodyMeasurement | null {
      const row = db
        .select()
        .from(bodyMeasurementsTable)
        .orderBy(desc(bodyMeasurementsTable.captured_at))
        .limit(1)
        .get();
      return row ? rowToBodyMeasurement(row) : null;
    },

    getRawJson(id: number): string | null {
      const row = db
        .select({ raw_json: bodyMeasurementsTable.raw_json })
        .from(bodyMeasurementsTable)
        .where(eq(bodyMeasurementsTable.id, id))
        .get();
      return row?.raw_json ?? null;
    },
  };
}

function rowToBodyMeasurement(row: BodyMeasurementRow): BodyMeasurement {
  return {
    id: row.id,
    userId: row.user_id,
    heightMeter: row.height_meter,
    weightKilogram: row.weight_kilogram,
    maxHeartRate: row.max_heart_rate,
    capturedAt: row.captured_at,
  };
}
