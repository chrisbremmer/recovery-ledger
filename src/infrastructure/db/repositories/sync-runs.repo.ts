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

import { desc, eq } from 'drizzle-orm';
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
