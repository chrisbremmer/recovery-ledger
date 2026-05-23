// Daily-summaries repository — empty in Phase 3 per Open Question 1.
// The table itself is created by Plan 03-02's schema; the Phase 4
// baseline service is the only caller that writes to it (during review
// computation). Phase 3 ships this file so:
//   - the migrated table has a typed write surface ready for Phase 4
//   - Plan 03-10 contract tests can exercise the table end-to-end
//     without the contract test having to reach into Drizzle directly
//   - Plan 03-11 sync orchestrator can declare the repo dependency in
//     its bootstrap (the orchestrator does NOT call any method here,
//     but the dependency declaration locks the wiring for Phase 4)
//
// PK is `date` (YYYY-MM-DD) per the schema. The Phase 4 baseline service
// will call upsertOneDay() once per day at review-computation time.

import { and, asc, gte, lte, sql } from 'drizzle-orm';
import type { drizzle } from 'drizzle-orm/better-sqlite3';
import type { DailySummary } from '../../../domain/types/entities.js';
import { daily_summaries as dailySummariesTable } from '../schema.js';

export interface DailySummariesRepo {
  /** Idempotent per-day upsert. PK is `date`. Phase 4 baseline service
   *  is the sole caller. */
  upsertOneDay(summary: DailySummary): void;
  /** Batched per-day upsert wrapping one BEGIN IMMEDIATE transaction
   *  around N rows. Matches the `upsertBatch` pattern used by
   *  cycles/recovery/sleep/workouts repos and avoids 30 sequential
   *  lock+fsync round-trips on cold review. */
  upsertManyDays(summaries: ReadonlyArray<DailySummary>): void;
  /** Range query inclusive on both ends. */
  byDateRange(start: string, end: string): DailySummary[];
  /** Max computed_at across the table; null when empty. Phase 5 doctor
   *  may surface this as a "last-baseline-computed" data-quality signal. */
  latestComputedAt(): string | null;
}

type DailySummaryRow = typeof dailySummariesTable.$inferSelect;

export function createDailySummariesRepo(db: ReturnType<typeof drizzle>): DailySummariesRepo {
  return {
    upsertOneDay(summary): void {
      db.transaction(
        (tx) => {
          tx.insert(dailySummariesTable)
            .values({
              date: summary.date,
              user_id: summary.userId,
              recovery_score: summary.recoveryScore,
              sleep_efficiency_percentage: summary.sleepEfficiencyPercentage,
              day_strain: summary.dayStrain,
              respiratory_rate: summary.respiratoryRate,
              hrv_rmssd_milli: summary.hrvRmssdMilli,
              resting_heart_rate: summary.restingHeartRate,
              computed_at: summary.computedAt,
            })
            .onConflictDoUpdate({
              target: dailySummariesTable.date,
              set: {
                user_id: sql`excluded.user_id`,
                recovery_score: sql`excluded.recovery_score`,
                sleep_efficiency_percentage: sql`excluded.sleep_efficiency_percentage`,
                day_strain: sql`excluded.day_strain`,
                respiratory_rate: sql`excluded.respiratory_rate`,
                hrv_rmssd_milli: sql`excluded.hrv_rmssd_milli`,
                resting_heart_rate: sql`excluded.resting_heart_rate`,
                computed_at: sql`excluded.computed_at`,
              },
            })
            .run();
        },
        { behavior: 'immediate' },
      );
    },

    upsertManyDays(summaries): void {
      if (summaries.length === 0) return;
      db.transaction(
        (tx) => {
          for (const summary of summaries) {
            tx.insert(dailySummariesTable)
              .values({
                date: summary.date,
                user_id: summary.userId,
                recovery_score: summary.recoveryScore,
                sleep_efficiency_percentage: summary.sleepEfficiencyPercentage,
                day_strain: summary.dayStrain,
                respiratory_rate: summary.respiratoryRate,
                hrv_rmssd_milli: summary.hrvRmssdMilli,
                resting_heart_rate: summary.restingHeartRate,
                computed_at: summary.computedAt,
              })
              .onConflictDoUpdate({
                target: dailySummariesTable.date,
                set: {
                  user_id: sql`excluded.user_id`,
                  recovery_score: sql`excluded.recovery_score`,
                  sleep_efficiency_percentage: sql`excluded.sleep_efficiency_percentage`,
                  day_strain: sql`excluded.day_strain`,
                  respiratory_rate: sql`excluded.respiratory_rate`,
                  hrv_rmssd_milli: sql`excluded.hrv_rmssd_milli`,
                  resting_heart_rate: sql`excluded.resting_heart_rate`,
                  computed_at: sql`excluded.computed_at`,
                },
              })
              .run();
          }
        },
        { behavior: 'immediate' },
      );
    },

    byDateRange(start: string, end: string): DailySummary[] {
      const rows = db
        .select()
        .from(dailySummariesTable)
        .where(and(gte(dailySummariesTable.date, start), lte(dailySummariesTable.date, end)))
        .orderBy(asc(dailySummariesTable.date))
        .all();
      return rows.map(rowToDailySummary);
    },

    latestComputedAt(): string | null {
      const row = db
        .select({ max: sql<string | null>`MAX(${dailySummariesTable.computed_at})` })
        .from(dailySummariesTable)
        .get();
      return row?.max ?? null;
    },
  };
}

function rowToDailySummary(row: DailySummaryRow): DailySummary {
  return {
    date: row.date,
    userId: row.user_id,
    recoveryScore: row.recovery_score,
    sleepEfficiencyPercentage: row.sleep_efficiency_percentage,
    dayStrain: row.day_strain,
    respiratoryRate: row.respiratory_rate,
    hrvRmssdMilli: row.hrv_rmssd_milli,
    restingHeartRate: row.resting_heart_rate,
    computedAt: row.computed_at,
  };
}
