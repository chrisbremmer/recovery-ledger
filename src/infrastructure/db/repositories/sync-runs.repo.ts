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
// DBIN-01 (#75): 5-state status union — running|ok|partial|failed|aborted.
import type { SyncRunStatus } from '../../../domain/types/sync-run-status.js';
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
  // DBIN-01 (#75): accept all 5 statuses (including 'aborted') so
  // `whoop_query_cache resource=sync_runs status=aborted` returns crash-
  // recovery rows. The shared SyncRunStatus type is the single source.
  byStatus(status: SyncRunStatus | undefined, since: string | undefined, limit: number): SyncRun[];
  /** DBIN-05 (#94): record a `walCheckpointIncomplete:true` marker in this
   *  run's `flags` JSON so the doctor can surface back-to-back checkpoint
   *  failures alongside the existing db_wal_size probe. Repo stays data-only;
   *  the orchestrator decides when to mark. Merge-preserving — existing
   *  CLI-input echo keys (days/since/resources) survive the update. */
  markCheckpointIncomplete(id: number): void;
  /** DBIN-05 (#94): true iff the most recent finished sync_run (status ∈
   *  {ok, partial}, excluding any in-flight `running` rows) carries the
   *  `walCheckpointIncomplete:true` marker in its flags JSON. Used to detect
   *  the "twice-in-a-row" escalation signal. */
  previousCheckpointWasIncomplete(): boolean;
  /** #35 — bootstrap-time crash recovery. Marks any `running` row whose
   *  `started_at` is older than `thresholdMs` as `aborted`. Returns the
   *  number of rows reclassified. Called by `bootstrap()` after the
   *  migrator so a crashed run stops counting as in-flight forever — a
   *  `byStatus('running')` query no longer sees the zombie. The data-status
   *  anchor (`latestFinished()`) deliberately skips `aborted` rows too, so
   *  the review surfaces the previous genuine outcome rather than the
   *  crash. */
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

    markCheckpointIncomplete(id): void {
      // DBIN-05 (#94): merge `{walCheckpointIncomplete: true}` into the
      // flags JSON in-place. Existing CLI-input echo keys
      // (days/since/resources) survive — drop-in for the orchestrator's
      // existing flags shape.
      db.transaction(
        (tx) => {
          const row = tx
            .select({ flags: syncRunsTable.flags })
            .from(syncRunsTable)
            .where(eq(syncRunsTable.id, id))
            .get();
          let parsed: Record<string, unknown> = {};
          if (row?.flags) {
            try {
              const candidate = JSON.parse(row.flags) as unknown;
              if (
                candidate !== null &&
                typeof candidate === 'object' &&
                !Array.isArray(candidate)
              ) {
                parsed = candidate as Record<string, unknown>;
              }
            } catch {
              // Non-JSON flags string — treat as empty and overwrite. The
              // CLI orchestrator always writes a JSON object; this only
              // matters if a future contributor changes the shape.
            }
          }
          parsed.walCheckpointIncomplete = true;
          tx.update(syncRunsTable)
            .set({ flags: JSON.stringify(parsed) })
            .where(eq(syncRunsTable.id, id))
            .run();
        },
        { behavior: 'immediate' },
      );
    },

    previousCheckpointWasIncomplete(): boolean {
      // DBIN-05 (#94): "twice in a row" detection — return true iff the
      // IMMEDIATELY-PRECEDING finished run (status ∈ {ok, partial, failed},
      // excluding `running` and `aborted`) carries the marker. Sort by
      // started_at DESC + id DESC and take the first match against
      // `flags LIKE '%"walCheckpointIncomplete":true%'` only when it IS the
      // immediate predecessor — older incomplete runs don't escalate today's.
      const row = db
        .select({ flags: syncRunsTable.flags })
        .from(syncRunsTable)
        .where(and(ne(syncRunsTable.status, 'running'), ne(syncRunsTable.status, 'aborted')))
        .orderBy(desc(syncRunsTable.started_at), desc(syncRunsTable.id))
        .limit(1)
        .get();
      if (row?.flags === null || row?.flags === undefined) return false;
      return /"walCheckpointIncomplete"\s*:\s*true/.test(row.flags);
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
      // D-03 anchor surfaces the latest genuine sync OUTCOME (the three
      // user-facing states per DataStatus). 'running' rows have no result
      // yet; 'aborted' rows (crash-recovery sentinel, #15/#35) synced
      // nothing meaningful — both are excluded so the review falls through
      // to the previous real result rather than showing a non-outcome.
      // Order by finished_at DESC; the limit picks the most recent.
      const row = db
        .select({ finished_at: syncRunsTable.finished_at, status: syncRunsTable.status })
        .from(syncRunsTable)
        .where(and(ne(syncRunsTable.status, 'running'), ne(syncRunsTable.status, 'aborted')))
        .orderBy(desc(syncRunsTable.finished_at), desc(syncRunsTable.id))
        .limit(1)
        .get();
      if (row === undefined || row.finished_at === null) {
        return null;
      }
      // Defensive narrow: the WHERE filter already excludes the two
      // non-outcome states, but the column type still spans all five, so
      // strict-TS needs this to reach the user-facing 3-literal return.
      if (row.status === 'running' || row.status === 'aborted') {
        return null;
      }
      return { finished_at: row.finished_at, status: row.status };
    },
    reclassifyStaleRunning(thresholdMs, nowIso): number {
      // #35 — sweep 'running' rows whose started_at is older than the
      // threshold. The SQLite text column accepts 'aborted' (the schema
      // enum was widened in #15 to include it).
      const cutoffIso = new Date(Date.now() - thresholdMs).toISOString();
      // Go direct via the better-sqlite3 handle on `db.$client` to keep the
      // UPDATE outside any outer transaction (bootstrap calls this before
      // any other write).
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
