// Sync-runs repository — D-24 lifecycle row. The sync orchestrator (Plan
// 03-11) calls these three methods in sequence per run:
//
//   1. insertRunning({ startedAt, flags }) → returns the new row id.
//   2. updatePerResource(id, resource, outcome) — once per completed
//      resource. Merges into the per_resource JSON blob; preserves
//      already-recorded entries so a partial-failure resource summary
//      survives subsequent resource completions.
//   3. finalize(id, status, gapsDetected, finishedAt) — once at the end
//      with the rolled-up status ('ok' | 'partial' | 'failed').
//
// listRecent(limit) is exposed for the future Phase 5 doctor probe and
// the future Phase 4 whoop_sync MCP tool. It maps rows back to the
// SyncRun entity, parsing per_resource from JSON-as-text.
//
// Every write goes through BEGIN IMMEDIATE per D-31 + Pitfall 13. The
// per_resource read-modify-write inside updatePerResource is one
// transaction so two concurrent resource-finish events cannot drop one
// of their outcome entries.

import { and, desc, eq, gte, ne } from 'drizzle-orm';
import type { drizzle } from 'drizzle-orm/better-sqlite3';
import { z } from 'zod';
import { ResourceSyncOutcomeSchema } from '../../../domain/schemas/entities.js';
import type { SyncRun } from '../../../domain/types/entities.js';
import {
  RESOURCES,
  type ResourceName,
  type ResourceSyncOutcome,
  type RunSyncStatus,
} from '../../../domain/types/sync.js';
import { logger } from '../../config/logger.js';
import { sync_runs as syncRunsTable } from '../schema.js';

/** Runtime validator for the `per_resource` JSON-as-text column. Guards
 *  against hand-corrupted rows (restored backups, manual SQL edits) returning
 *  unexpected shapes through `listRecent`. Mid-run rows can have partial
 *  maps (a subset of RESOURCES), so `z.record(z.string(), …)` is used with a
 *  refine that every key is a known resource — `z.record(z.enum(RESOURCES))`
 *  would reject partial maps in Zod 4. */
const PerResourceSchema = z
  .record(z.string(), ResourceSyncOutcomeSchema)
  .refine((map) => Object.keys(map).every((k) => (RESOURCES as readonly string[]).includes(k)), {
    message: 'per_resource contains an unknown resource key',
  });

export interface SyncRunsRepo {
  /** Insert a row with status='running', per_resource='{}',
   *  gaps_detected=0; returns the autoincrement id. */
  insertRunning(input: { startedAt: string; flags: string | null }): number;
  /** Merge a per-resource outcome into the row's per_resource JSON.
   *  Existing entries for other resources are preserved. */
  updatePerResource(id: number, resource: ResourceName, outcome: ResourceSyncOutcome): void;
  /** Final state transition: status + finished_at + gaps_detected. */
  finalize(id: number, status: RunSyncStatus, gapsDetected: number, finishedAt: string): void;
  /** Most recent runs first; per_resource parsed back into the typed map. */
  listRecent(limit?: number): SyncRun[];
  /** Plan 04-07 D-03 data-status anchor. Returns the most recent FINISHED
   *  run (status != 'running') as a `{finished_at, status}` projection —
   *  the daily/weekly review surfaces this as `latest_sync_at` +
   *  `latest_sync_status`. A `running` row means a sync is in-flight; the
   *  review still wants the previous result, so this filter excludes
   *  running rows. Returns `null` when the table has no finished rows
   *  (empty DB OR every existing row is mid-flight). */
  latestFinished(): { finished_at: string; status: 'ok' | 'partial' | 'failed' } | null;
  /** Plan 04-08 D-24 `whoop_query_cache` sync_runs arm. Returns rows
   *  whose `status` matches the filter (when supplied) and whose
   *  `started_at >= since` (when supplied). Newest-first. The optional
   *  filters are combined with AND; both undefined returns every row up
   *  to `limit`. SQLite lexicographic compare on ISO-8601 timestamps
   *  gives correct chronology. */
  byStatus(
    status: 'ok' | 'partial' | 'failed' | 'running' | undefined,
    since: string | undefined,
    limit: number,
  ): SyncRun[];
  /** #35 — bootstrap-time crash recovery. Marks any `running` row whose
   *  `started_at` is older than `thresholdMs` as `aborted`. Returns the
   *  number of rows reclassified. Called by `bootstrap()` after the
   *  migrator so the data-status anchor (`latestFinished()`) sees the
   *  abort instead of treating the crashed run as in-flight forever. */
  reclassifyStaleRunning(thresholdMs: number, nowIso: string): number;
}

type SyncRunRow = typeof syncRunsTable.$inferSelect;

export function createSyncRunsRepo(db: ReturnType<typeof drizzle>): SyncRunsRepo {
  return {
    insertRunning(input): number {
      return db.transaction(
        (tx) => {
          const result = tx
            .insert(syncRunsTable)
            .values({
              started_at: input.startedAt,
              status: 'running',
              per_resource: '{}',
              gaps_detected: 0,
              flags: input.flags,
            })
            .returning({ id: syncRunsTable.id })
            .get();
          if (!result) {
            throw new Error('sync_runs insert returned no row — schema mismatch?');
          }
          return result.id;
        },
        { behavior: 'immediate' },
      );
    },

    updatePerResource(id, resource, outcome): void {
      db.transaction(
        (tx) => {
          const row = tx
            .select({ per_resource: syncRunsTable.per_resource })
            .from(syncRunsTable)
            .where(eq(syncRunsTable.id, id))
            .get();
          if (!row) {
            throw new Error(`sync_runs id ${id} not found for updatePerResource`);
          }
          // JSON-as-text merge. The column has a NOT NULL constraint with
          // default '{}' so the parse is total — but guard against a
          // hand-corrupted row (e.g., restored backup) returning null.
          const current = (row.per_resource ? JSON.parse(row.per_resource) : {}) as Partial<
            Record<ResourceName, ResourceSyncOutcome>
          >;
          const merged = { ...current, [resource]: outcome };
          tx.update(syncRunsTable)
            .set({ per_resource: JSON.stringify(merged) })
            .where(eq(syncRunsTable.id, id))
            .run();
        },
        { behavior: 'immediate' },
      );
    },

    finalize(id, status, gapsDetected, finishedAt): void {
      db.transaction(
        (tx) => {
          tx.update(syncRunsTable)
            .set({
              status,
              gaps_detected: gapsDetected,
              finished_at: finishedAt,
            })
            .where(eq(syncRunsTable.id, id))
            .run();
        },
        { behavior: 'immediate' },
      );
    },

    listRecent(limit = 10): SyncRun[] {
      const rows = db
        .select()
        .from(syncRunsTable)
        .orderBy(desc(syncRunsTable.started_at), desc(syncRunsTable.id))
        .limit(limit)
        .all();
      return rows.map(rowToSyncRun);
    },

    byStatus(status, since, limit): SyncRun[] {
      const conditions = [];
      if (status !== undefined) conditions.push(eq(syncRunsTable.status, status));
      if (since !== undefined) conditions.push(gte(syncRunsTable.started_at, since));
      const base = db.select().from(syncRunsTable);
      const rows =
        conditions.length === 0
          ? base.orderBy(desc(syncRunsTable.started_at), desc(syncRunsTable.id)).limit(limit).all()
          : base
              .where(and(...conditions))
              .orderBy(desc(syncRunsTable.started_at), desc(syncRunsTable.id))
              .limit(limit)
              .all();
      return rows.map(rowToSyncRun);
    },

    latestFinished(): { finished_at: string; status: 'ok' | 'partial' | 'failed' } | null {
      // Order by finished_at DESC; running rows have finished_at = null and
      // are excluded by the status != 'running' filter. The schema enum
      // is ['running','ok','partial','failed'], so after the filter the
      // narrowed status type is exactly the D-03 user-facing 3.
      const row = db
        .select({ finished_at: syncRunsTable.finished_at, status: syncRunsTable.status })
        .from(syncRunsTable)
        .where(ne(syncRunsTable.status, 'running'))
        .orderBy(desc(syncRunsTable.finished_at), desc(syncRunsTable.id))
        .limit(1)
        .get();
      if (row === undefined || row.finished_at === null) {
        return null;
      }
      // Defensive narrow: the WHERE filter already excludes 'running', so
      // this assertion is a type-level no-op that strict-TS requires.
      if (row.status === 'running') {
        return null;
      }
      return { finished_at: row.finished_at, status: row.status };
    },
    reclassifyStaleRunning(thresholdMs, nowIso): number {
      // #35 — sweep 'running' rows whose started_at is older than the
      // threshold. The SQLite text column accepts 'aborted' (the schema
      // enum was widened in #15 to include it).
      const cutoffIso = new Date(Date.now() - thresholdMs).toISOString();
      // @ts-expect-error Drizzle's BetterSQLite3Database has a $client
      // accessor on the better-sqlite3 handle. Going direct here keeps
      // the UPDATE outside any outer transaction (bootstrap calls this
      // before any other write).
      const stmt = (db.$client as import('better-sqlite3').Database).prepare(
        `UPDATE sync_runs
            SET status = 'aborted',
                finished_at = ?
          WHERE status = 'running'
            AND started_at < ?`,
      );
      const result = stmt.run(nowIso, cutoffIso);
      return result.changes;
    },
  };
}

function rowToSyncRun(row: SyncRunRow): SyncRun {
  // The schema's status column enum is ['running', 'ok', 'partial', 'failed'].
  // SyncRun's `status` field accepts the same four literals (entities.ts).
  //
  // The per_resource column is JSON-as-text. Validate the parse against the
  // domain schema before returning — a hand-corrupted row (restored backup,
  // schema drift, future-version downgrade) should not crash the listRecent
  // surface; emit a warn-level event and fall back to an empty map so the
  // doctor + MCP probe can still report the run shell.
  let perResource: Record<ResourceName, ResourceSyncOutcome>;
  try {
    const raw = row.per_resource ? JSON.parse(row.per_resource) : {};
    perResource = PerResourceSchema.parse(raw) as Record<ResourceName, ResourceSyncOutcome>;
  } catch (err) {
    logger.warn({
      event: 'sync_runs_per_resource_parse_failed',
      syncRunId: row.id,
      detail: err instanceof Error ? err.message : String(err),
    });
    perResource = {} as Record<ResourceName, ResourceSyncOutcome>;
  }
  return {
    id: row.id,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    status: row.status,
    perResource,
    gapsDetected: row.gaps_detected,
    flags: row.flags,
  };
}
