// Sync-runs repository unit tests — locks the D-24 lifecycle contract.
// Each test starts from a fresh in-memory DB.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createInMemoryDb, type InMemoryDbResult } from '../../../../tests/helpers/in-memory-db.js';
import type { ResourceSyncOutcome } from '../../../domain/types/sync.js';
import { createSyncRunsRepo } from './sync-runs.repo.js';

const STARTED_AT_BASE = '2026-05-16T12:00:00.000Z';
const FINISHED_AT_BASE = '2026-05-16T12:05:00.000Z';

describe('sync-runs repo — insertRunning() lifecycle entry', () => {
  let mem: InMemoryDbResult;

  beforeEach(() => {
    mem = createInMemoryDb();
  });
  afterEach(() => mem.close());

  it('Test 1: returns a numeric id; subsequent inserts return strictly increasing ids', () => {
    const repo = createSyncRunsRepo(mem.db);
    const id1 = repo.insertRunning({ startedAt: STARTED_AT_BASE, flags: null });
    const id2 = repo.insertRunning({
      startedAt: '2026-05-16T12:01:00.000Z',
      flags: '{"days":30}',
    });
    expect(typeof id1).toBe('number');
    expect(typeof id2).toBe('number');
    expect(id2).toBeGreaterThan(id1);
  });

  it("Test 2: inserts with status='running', per_resource='{}', gaps_detected=0", () => {
    const repo = createSyncRunsRepo(mem.db);
    const id = repo.insertRunning({ startedAt: STARTED_AT_BASE, flags: null });
    const row = mem.sqlite
      .prepare('SELECT status, per_resource, gaps_detected, started_at FROM sync_runs WHERE id = ?')
      .get(id) as {
      status: string;
      per_resource: string;
      gaps_detected: number;
      started_at: string;
    };
    expect(row.status).toBe('running');
    expect(row.per_resource).toBe('{}');
    expect(row.gaps_detected).toBe(0);
    expect(row.started_at).toBe(STARTED_AT_BASE);
  });
});

describe('sync-runs repo — updatePerResource() JSON merge', () => {
  let mem: InMemoryDbResult;

  beforeEach(() => {
    mem = createInMemoryDb();
  });
  afterEach(() => mem.close());

  it('Test 3: merges a per-resource outcome into the JSON blob', () => {
    const repo = createSyncRunsRepo(mem.db);
    const id = repo.insertRunning({ startedAt: STARTED_AT_BASE, flags: null });
    const outcome: ResourceSyncOutcome = {
      status: 'success',
      fetched: 42,
      upserted: 42,
      errors: 0,
      durationMs: 1200,
    };
    repo.updatePerResource(id, 'cycles', outcome);
    const row = mem.sqlite.prepare('SELECT per_resource FROM sync_runs WHERE id = ?').get(id) as {
      per_resource: string;
    };
    const parsed = JSON.parse(row.per_resource);
    expect(parsed.cycles).toEqual(outcome);
  });

  it('Test 4: second updatePerResource preserves the first entry (merge, not overwrite)', () => {
    const repo = createSyncRunsRepo(mem.db);
    const id = repo.insertRunning({ startedAt: STARTED_AT_BASE, flags: null });
    repo.updatePerResource(id, 'cycles', { status: 'success', fetched: 10, upserted: 10 });
    repo.updatePerResource(id, 'workouts', { status: 'partial_429', fetched: 5, upserted: 3 });
    const row = mem.sqlite.prepare('SELECT per_resource FROM sync_runs WHERE id = ?').get(id) as {
      per_resource: string;
    };
    const parsed = JSON.parse(row.per_resource);
    expect(parsed.cycles).toEqual({ status: 'success', fetched: 10, upserted: 10 });
    expect(parsed.workouts).toEqual({ status: 'partial_429', fetched: 5, upserted: 3 });
  });
});

describe('sync-runs repo — finalize() terminal state', () => {
  let mem: InMemoryDbResult;

  beforeEach(() => {
    mem = createInMemoryDb();
  });
  afterEach(() => mem.close());

  it('Test 5: finalize sets status, gaps_detected, finished_at', () => {
    const repo = createSyncRunsRepo(mem.db);
    const id = repo.insertRunning({ startedAt: STARTED_AT_BASE, flags: null });
    repo.finalize(id, 'ok', 0, FINISHED_AT_BASE);
    const row = mem.sqlite
      .prepare('SELECT status, finished_at, gaps_detected FROM sync_runs WHERE id = ?')
      .get(id) as { status: string; finished_at: string; gaps_detected: number };
    expect(row.status).toBe('ok');
    expect(row.finished_at).toBe(FINISHED_AT_BASE);
    expect(row.gaps_detected).toBe(0);
  });
});

describe('sync-runs repo — listRecent() ordering + entity mapping', () => {
  let mem: InMemoryDbResult;

  beforeEach(() => {
    mem = createInMemoryDb();
  });
  afterEach(() => mem.close());

  it('Test 6: returns rows ordered by started_at DESC', () => {
    const repo = createSyncRunsRepo(mem.db);
    repo.insertRunning({ startedAt: '2026-05-14T12:00:00.000Z', flags: null });
    repo.insertRunning({ startedAt: '2026-05-16T12:00:00.000Z', flags: null });
    repo.insertRunning({ startedAt: '2026-05-15T12:00:00.000Z', flags: null });
    const rows = repo.listRecent(5);
    expect(rows.map((r) => r.startedAt)).toEqual([
      '2026-05-16T12:00:00.000Z',
      '2026-05-15T12:00:00.000Z',
      '2026-05-14T12:00:00.000Z',
    ]);
  });

  it('Test 7: parses per_resource back into the typed map shape', () => {
    const repo = createSyncRunsRepo(mem.db);
    const id = repo.insertRunning({ startedAt: STARTED_AT_BASE, flags: '{"days":30}' });
    repo.updatePerResource(id, 'cycles', { status: 'success', fetched: 7, upserted: 7 });
    repo.updatePerResource(id, 'sleeps', { status: 'skipped' });
    repo.finalize(id, 'ok', 0, FINISHED_AT_BASE);
    const [run] = repo.listRecent(1);
    expect(run).toBeDefined();
    if (!run) throw new Error('expected at least one run');
    expect(run.id).toBe(id);
    expect(run.status).toBe('ok');
    expect(run.gapsDetected).toBe(0);
    expect(run.startedAt).toBe(STARTED_AT_BASE);
    expect(run.finishedAt).toBe(FINISHED_AT_BASE);
    expect(run.flags).toBe('{"days":30}');
    expect(run.perResource.cycles).toEqual({
      status: 'success',
      fetched: 7,
      upserted: 7,
    });
    expect(run.perResource.sleeps).toEqual({ status: 'skipped' });
  });

  it('Test 8a: corrupted per_resource JSON falls back to {} without crashing', () => {
    const repo = createSyncRunsRepo(mem.db);
    const id = repo.insertRunning({ startedAt: STARTED_AT_BASE, flags: null });
    // Hand-corrupt the per_resource column to simulate a restored backup or
    // a future-version downgrade. The validator in rowToSyncRun should
    // recover gracefully (empty perResource map, run shell still returned).
    mem.sqlite
      .prepare('UPDATE sync_runs SET per_resource = ? WHERE id = ?')
      .run('{"unknown_resource":{"status":"success"}}', id);
    repo.finalize(id, 'ok', 0, FINISHED_AT_BASE);
    const [run] = repo.listRecent(1);
    expect(run).toBeDefined();
    if (!run) throw new Error('expected at least one run');
    expect(run.id).toBe(id);
    expect(run.status).toBe('ok');
    expect(run.perResource).toEqual({});
  });
});

describe('sync-runs repo — latestFinished() D-03 data-status anchor', () => {
  let mem: InMemoryDbResult;

  beforeEach(() => {
    mem = createInMemoryDb();
  });
  afterEach(() => mem.close());

  it('Test 9: empty DB returns null', () => {
    const repo = createSyncRunsRepo(mem.db);
    expect(repo.latestFinished()).toBeNull();
  });

  it("Test 10: only a 'running' row in flight returns null (review wants the previous finished run)", () => {
    const repo = createSyncRunsRepo(mem.db);
    repo.insertRunning({ startedAt: STARTED_AT_BASE, flags: null });
    expect(repo.latestFinished()).toBeNull();
  });

  it("Test 11: after a single finalized 'ok' run, returns its finished_at + 'ok' status", () => {
    const repo = createSyncRunsRepo(mem.db);
    const id = repo.insertRunning({ startedAt: STARTED_AT_BASE, flags: null });
    repo.finalize(id, 'ok', 0, FINISHED_AT_BASE);
    const result = repo.latestFinished();
    expect(result).not.toBeNull();
    expect(result?.finished_at).toBe(FINISHED_AT_BASE);
    expect(result?.status).toBe('ok');
  });

  it('Test 12: returns the most recent FINISHED run when a newer running row is in flight', () => {
    const repo = createSyncRunsRepo(mem.db);
    const finishedId = repo.insertRunning({ startedAt: '2026-05-15T10:00:00.000Z', flags: null });
    repo.finalize(finishedId, 'partial', 0, '2026-05-15T10:05:00.000Z');
    // A newer running row started later but has not finalized — should be
    // ignored by latestFinished(), which wants the latest COMPLETED state.
    repo.insertRunning({ startedAt: '2026-05-16T10:00:00.000Z', flags: null });
    const result = repo.latestFinished();
    expect(result).not.toBeNull();
    expect(result?.finished_at).toBe('2026-05-15T10:05:00.000Z');
    expect(result?.status).toBe('partial');
  });

  it("Test 13: passes through 'partial' and 'failed' verbatim", () => {
    const repo = createSyncRunsRepo(mem.db);
    const a = repo.insertRunning({ startedAt: '2026-05-15T10:00:00.000Z', flags: null });
    repo.finalize(a, 'failed', 0, '2026-05-15T10:05:00.000Z');
    expect(repo.latestFinished()?.status).toBe('failed');
    const b = repo.insertRunning({ startedAt: '2026-05-16T10:00:00.000Z', flags: null });
    repo.finalize(b, 'partial', 0, '2026-05-16T10:05:00.000Z');
    expect(repo.latestFinished()?.status).toBe('partial');
  });

  // TSTC-01 (#86): regression coverage for the `'aborted'` filter on
  // latestFinished(). Pre-TSTC-01 the WHERE clause excluded both 'running'
  // and 'aborted' but no test inserted an aborted row — a refactor that
  // dropped the `'aborted'` filter would still pass every prior test.
  it('Test 14: aborted row is skipped — latestFinished returns the previous ok row (#86)', () => {
    const repo = createSyncRunsRepo(mem.db);
    const a = repo.insertRunning({ startedAt: '2026-05-15T10:00:00.000Z', flags: null });
    repo.finalize(a, 'ok', 0, '2026-05-15T10:05:00.000Z');
    // Newer aborted row — must NOT shadow the prior ok.
    const b = repo.insertRunning({ startedAt: '2026-05-16T10:00:00.000Z', flags: null });
    repo.finalize(b, 'ok', 0, '2026-05-16T10:05:00.000Z');
    repo.reclassifyStaleRunning(0, '2026-05-16T11:00:00.000Z');
    // The reclassify above only sweeps 'running' rows; finalize'd rows stay.
    // Insert + reclassify a separate running row to get an aborted entry.
    repo.insertRunning({ startedAt: '2026-05-17T10:00:00.000Z', flags: null });
    repo.reclassifyStaleRunning(0, '2026-05-17T11:00:00.000Z');

    const result = repo.latestFinished();
    expect(result).not.toBeNull();
    expect(result?.finished_at).toBe('2026-05-16T10:05:00.000Z');
    expect(result?.status).toBe('ok');
  });

  it('Test 15: only-aborted DB returns null (#86)', () => {
    const repo = createSyncRunsRepo(mem.db);
    repo.insertRunning({ startedAt: '2026-05-15T10:00:00.000Z', flags: null });
    repo.reclassifyStaleRunning(0, '2026-05-15T11:00:00.000Z');
    expect(repo.latestFinished()).toBeNull();
  });
});

// DBIN-01 (#75): round-trip an 'aborted' row through the typed repo and
// re-parse it via SyncRunEntitySchema. Before DBIN-01 the Zod enum lacked
// 'aborted' and this parse would have thrown, silently hiding crash-recovery
// rows from MCP / data-quality probes / contract validation.
describe("sync-runs repo — DBIN-01 'aborted' enum round-trip (#75)", () => {
  let mem: InMemoryDbResult;
  beforeEach(() => {
    mem = createInMemoryDb();
  });
  afterEach(() => mem.close());

  it("byStatus('aborted') returns a reclassified row, parseable via SyncRunEntitySchema", async () => {
    const repo = createSyncRunsRepo(mem.db);
    const id = repo.insertRunning({ startedAt: '2026-05-16T10:00:00.000Z', flags: null });
    // Reclassify with a 0ms threshold so the in-flight row immediately
    // becomes 'aborted'.
    const reclassified = repo.reclassifyStaleRunning(0, '2026-05-16T11:00:00.000Z');
    expect(reclassified).toBe(1);

    const rows = repo.byStatus('aborted', undefined, 10);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.id).toBe(id);
    expect(rows[0]?.status).toBe('aborted');

    // Re-parse via the Zod entity schema. Pre-DBIN-01 this would have
    // thrown because the enum lacked 'aborted'.
    const { SyncRunEntitySchema } = await import('../../../domain/schemas/entities.js');
    expect(() => SyncRunEntitySchema.parse(rows[0])).not.toThrow();
  });

  it('SYNC_RUN_STATUSES is the single source of truth for Drizzle / Zod / QueryCache (#75)', async () => {
    const { SYNC_RUN_STATUSES } = await import('../../../domain/types/sync-run-status.js');
    expect(SYNC_RUN_STATUSES).toEqual(['running', 'ok', 'partial', 'failed', 'aborted']);
    expect(SYNC_RUN_STATUSES).toContain('aborted');
  });
});

describe('sync-runs repo — LIFE-02 reclassifyStaleRunning honors injected nowIso (#82)', () => {
  let mem: InMemoryDbResult;
  beforeEach(() => {
    mem = createInMemoryDb();
  });
  afterEach(() => mem.close());

  it('cutoff is computed from the injected nowIso (not Date.now)', () => {
    const repo = createSyncRunsRepo(mem.db);
    // Seed a running row at 2026-05-15T00:00:00Z.
    repo.insertRunning({ startedAt: '2026-05-15T00:00:00.000Z', flags: null });

    // Inject a "now" of 2026-05-15T00:30:00Z with 1h threshold.
    // cutoff = 2026-05-14T23:30:00Z. The row's started_at (00:00:00) is
    // AFTER the cutoff, so it must NOT be reclassified — the injected
    // clock proves the time window even though wall-clock Date.now is
    // months ahead and would otherwise sweep this row.
    const ONE_HOUR_MS = 60 * 60 * 1000;
    const reclassified = repo.reclassifyStaleRunning(ONE_HOUR_MS, '2026-05-15T00:30:00.000Z');
    expect(reclassified).toBe(0);
  });

  it('reclassifies when the injected nowIso minus threshold passes the started_at', () => {
    const repo = createSyncRunsRepo(mem.db);
    repo.insertRunning({ startedAt: '2026-05-15T00:00:00.000Z', flags: null });

    // Inject "now" 2h later with 1h threshold; cutoff is 2026-05-15T01:00:00Z,
    // strictly after the row's 00:00:00 start.
    const ONE_HOUR_MS = 60 * 60 * 1000;
    const reclassified = repo.reclassifyStaleRunning(ONE_HOUR_MS, '2026-05-15T02:00:00.000Z');
    expect(reclassified).toBe(1);
  });
});

describe('sync-runs repo — DBIN-05 wal_checkpoint incomplete escalation (#94)', () => {
  let mem: InMemoryDbResult;
  beforeEach(() => {
    mem = createInMemoryDb();
  });
  afterEach(() => mem.close());

  it('markCheckpointIncomplete merges {walCheckpointIncomplete:true} into existing flags JSON', () => {
    const repo = createSyncRunsRepo(mem.db);
    const id = repo.insertRunning({
      startedAt: '2026-06-01T10:00:00.000Z',
      flags: JSON.stringify({ days: 30, resources: null, since: null }),
    });
    repo.finalize(id, 'ok', 0, '2026-06-01T10:05:00.000Z');
    repo.markCheckpointIncomplete(id);

    const recent = repo.listRecent(1);
    expect(recent[0]?.flags).toContain('"walCheckpointIncomplete":true');
    expect(recent[0]?.flags).toContain('"days":30');
    expect(recent[0]?.flags).toContain('"resources":null');
  });

  it('markCheckpointIncomplete handles null flags (no prior JSON to merge into)', () => {
    const repo = createSyncRunsRepo(mem.db);
    const id = repo.insertRunning({ startedAt: '2026-06-01T10:00:00.000Z', flags: null });
    repo.finalize(id, 'ok', 0, '2026-06-01T10:05:00.000Z');
    repo.markCheckpointIncomplete(id);

    const recent = repo.listRecent(1);
    expect(recent[0]?.flags).toContain('"walCheckpointIncomplete":true');
  });

  it('previousCheckpointWasIncomplete returns false when no prior run', () => {
    const repo = createSyncRunsRepo(mem.db);
    expect(repo.previousCheckpointWasIncomplete()).toBe(false);
  });

  it('previousCheckpointWasIncomplete returns true when the immediate predecessor was marked', () => {
    const repo = createSyncRunsRepo(mem.db);
    const a = repo.insertRunning({ startedAt: '2026-06-01T10:00:00.000Z', flags: null });
    repo.finalize(a, 'ok', 0, '2026-06-01T10:05:00.000Z');
    repo.markCheckpointIncomplete(a);
    expect(repo.previousCheckpointWasIncomplete()).toBe(true);
  });

  it('previousCheckpointWasIncomplete returns false when a CLEAN run happened after the marked one (twice-in-a-row, strict)', () => {
    const repo = createSyncRunsRepo(mem.db);
    const a = repo.insertRunning({ startedAt: '2026-06-01T10:00:00.000Z', flags: null });
    repo.finalize(a, 'ok', 0, '2026-06-01T10:05:00.000Z');
    repo.markCheckpointIncomplete(a);
    const b = repo.insertRunning({ startedAt: '2026-06-01T11:00:00.000Z', flags: null });
    repo.finalize(b, 'ok', 0, '2026-06-01T11:05:00.000Z');
    // Immediate predecessor (b) is clean — the strict "twice in a row" rule
    // returns false even though `a` carries the marker.
    expect(repo.previousCheckpointWasIncomplete()).toBe(false);
  });

  it("previousCheckpointWasIncomplete skips 'running' rows when finding the predecessor", () => {
    const repo = createSyncRunsRepo(mem.db);
    const a = repo.insertRunning({ startedAt: '2026-06-01T10:00:00.000Z', flags: null });
    repo.finalize(a, 'ok', 0, '2026-06-01T10:05:00.000Z');
    repo.markCheckpointIncomplete(a);
    // A new in-flight run that has NOT yet finalized: the lookup should
    // still see `a` (finished) as the predecessor and report true.
    repo.insertRunning({ startedAt: '2026-06-01T11:00:00.000Z', flags: null });
    expect(repo.previousCheckpointWasIncomplete()).toBe(true);
  });
});
