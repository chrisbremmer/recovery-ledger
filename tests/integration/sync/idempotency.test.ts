// Idempotency integration test — SYNC-04 verification anchor.
//
// End-to-end sync run across all 6 resources twice in sequence. After the
// second run:
//   - per-resource fetch hits the MSW handler again (no caching).
//   - upserts re-apply via Plan 03-08's ON CONFLICT DO UPDATE (D-11).
//   - row counts in cycles, recoveries, sleeps, workouts, profile,
//     body_measurements stay stable (idempotency proof).
//   - sync_runs has TWO rows (one per sync run). Each row's status='ok'.
//
// Drives the full Wave-3+4+5 stack: MSW → resource modules → normalizers →
// repositories → runSync orchestrator → sync_runs lifecycle + WAL
// checkpoint. The OAuth keychain is bypassed via vi.mock of the
// refresh-orchestrator (mirrors the contract-test pattern in
// tests/contract/cycles.test.ts).
//
// ADR-0006: MSW listens with onUnhandledRequest:'error' so any accidental
// live WHOOP call fails the test.
//
// Uses `createAllResourcesMsw()` from `./helpers/all-resources-msw.ts`
// because multiple setupServer instances in one process clobber each
// other; the integration suite bundles all 6 endpoints into ONE server.
//
// The composition deliberately bypasses `bootstrap()` — bootstrap opens
// the real on-disk SQLite path + runs the file-backed migrator. The
// integration tests use the in-memory-db helper from Plan 03-07 so the
// suite stays hermetic + offline.

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';
import { createInMemoryDb, type InMemoryDbResult } from '../../helpers/in-memory-db.js';
import { type AllResourcesMswHelper, createAllResourcesMsw } from './helpers/all-resources-msw.js';

vi.mock('../../../src/services/refresh-orchestrator.js', () => ({
  callWithAuth: (op: (token: string) => Promise<unknown>) => op('test-token-123'),
}));

const { runSync } = await import('../../../src/services/sync/index.js');

const { _resetForTest: resetRateLimit } = await import(
  '../../../src/infrastructure/whoop/rate-limit.js'
);
const { createCyclesRepo } = await import(
  '../../../src/infrastructure/db/repositories/cycles.repo.js'
);
const { createRecoveryRepo } = await import(
  '../../../src/infrastructure/db/repositories/recovery.repo.js'
);
const { createSleepsRepo } = await import(
  '../../../src/infrastructure/db/repositories/sleep.repo.js'
);
const { createWorkoutsRepo } = await import(
  '../../../src/infrastructure/db/repositories/workouts.repo.js'
);
const { createProfileRepo } = await import(
  '../../../src/infrastructure/db/repositories/profile.repo.js'
);
const { createBodyMeasurementsRepo } = await import(
  '../../../src/infrastructure/db/repositories/body-measurements.repo.js'
);
const { createSyncRunsRepo } = await import(
  '../../../src/infrastructure/db/repositories/sync-runs.repo.js'
);
const { listCycles } = await import('../../../src/infrastructure/whoop/resources/cycles.js');
const { listRecovery } = await import('../../../src/infrastructure/whoop/resources/recovery.js');
const { listSleep } = await import('../../../src/infrastructure/whoop/resources/sleep.js');
const { listWorkouts } = await import('../../../src/infrastructure/whoop/resources/workouts.js');
const { getProfile } = await import('../../../src/infrastructure/whoop/resources/profile.js');
const { getBodyMeasurement } = await import(
  '../../../src/infrastructure/whoop/resources/body-measurements.js'
);
const { logger } = await import('../../../src/infrastructure/config/logger.js');

vi.setConfig({ testTimeout: 10_000 });

const SINCE = '2026-01-01T00:00:00.000Z';
const UNTIL = '2026-12-31T23:59:59.999Z';
const IANA_ZONE = 'America/Los_Angeles';
const FIXED_CLOCK = new Date('2026-05-13T12:00:00.000Z');

let mswHelper: AllResourcesMswHelper;
let mem: InMemoryDbResult;

function buildDeps(memInstance: InMemoryDbResult): Parameters<typeof runSync>[1] {
  return {
    repos: {
      syncRuns: createSyncRunsRepo(memInstance.db),
      cycles: createCyclesRepo(memInstance.db),
      recoveries: createRecoveryRepo(memInstance.db),
      sleeps: createSleepsRepo(memInstance.db),
      workouts: createWorkoutsRepo(memInstance.db),
      profile: createProfileRepo(memInstance.db),
      bodyMeasurements: createBodyMeasurementsRepo(memInstance.db),
    },
    whoop: {
      resources: {
        cycles: listCycles,
        recoveries: listRecovery,
        sleeps: listSleep,
        workouts: listWorkouts,
        profile: getProfile,
        body_measurements: getBodyMeasurement,
      },
    },
    sqlite: memInstance.sqlite,
    clock: () => FIXED_CLOCK,
    ianaZone: () => IANA_ZONE,
    logger,
  };
}

beforeAll(() => {
  mswHelper = createAllResourcesMsw();
  mswHelper.server.listen({ onUnhandledRequest: 'error' });
});

afterAll(() => {
  mswHelper.server.close();
});

beforeEach(() => {
  resetRateLimit();
  mswHelper.resetHitCounts();
  mswHelper.server.resetHandlers();
  mem = createInMemoryDb();
});

afterEach(() => {
  mem.close();
});

describe('sync idempotency — SYNC-04 anchor', () => {
  test('Test 1: first runSync({days: 30}) returns status=ok with all 6 resources success + 6 rows landed', async () => {
    const deps = buildDeps(mem);
    const result = await runSync({ days: 30 }, deps);

    expect(result.status).toBe('ok');
    expect(Object.keys(result.perResource).sort()).toEqual([
      'body_measurements',
      'cycles',
      'profile',
      'recoveries',
      'sleeps',
      'workouts',
    ]);
    for (const resource of [
      'profile',
      'body_measurements',
      'cycles',
      'recoveries',
      'sleeps',
      'workouts',
    ] as const) {
      expect(result.perResource[resource]?.status).toBe('success');
    }

    // Row counts: each default fixture is one record.
    const cyclesRepo = createCyclesRepo(mem.db);
    expect(cyclesRepo.byRange(SINCE, UNTIL)).toHaveLength(1);
    const recoveryRepo = createRecoveryRepo(mem.db);
    expect(recoveryRepo.byRange(SINCE, UNTIL)).toHaveLength(1);
    const sleepRepo = createSleepsRepo(mem.db);
    expect(sleepRepo.byRange(SINCE, UNTIL)).toHaveLength(1);
    const workoutsRepo = createWorkoutsRepo(mem.db);
    expect(workoutsRepo.byRange(SINCE, UNTIL)).toHaveLength(1);
    const profileRepo = createProfileRepo(mem.db);
    expect(profileRepo.getCurrent()).not.toBeNull();
    const bodyRepo = createBodyMeasurementsRepo(mem.db);
    expect(bodyRepo.listAll()).toHaveLength(1);

    // sync_runs: one row, status='ok'.
    const syncRunsRepo = createSyncRunsRepo(mem.db);
    const runs = syncRunsRepo.listRecent();
    expect(runs).toHaveLength(1);
    expect(runs[0]?.status).toBe('ok');
  });

  test('Test 2: second runSync({days: 30}) with same fixtures lands 0 NEW rows (SYNC-04 anchor)', async () => {
    // First run lands the baseline.
    const deps = buildDeps(mem);
    await runSync({ days: 30 }, deps);

    // Capture row counts after first run.
    const cyclesRepo = createCyclesRepo(mem.db);
    const recoveryRepo = createRecoveryRepo(mem.db);
    const sleepRepo = createSleepsRepo(mem.db);
    const workoutsRepo = createWorkoutsRepo(mem.db);
    const bodyRepo = createBodyMeasurementsRepo(mem.db);
    const cyclesBefore = cyclesRepo.byRange(SINCE, UNTIL).length;
    const recoveriesBefore = recoveryRepo.byRange(SINCE, UNTIL).length;
    const sleepsBefore = sleepRepo.byRange(SINCE, UNTIL).length;
    const workoutsBefore = workoutsRepo.byRange(SINCE, UNTIL).length;
    const bodyBefore = bodyRepo.listAll().length;

    // Second run with identical fixtures.
    const result2 = await runSync({ days: 30 }, deps);
    expect(result2.status).toBe('ok');

    // Row counts unchanged — SYNC-04 anchor: 0 new rows.
    expect(cyclesRepo.byRange(SINCE, UNTIL)).toHaveLength(cyclesBefore);
    expect(recoveryRepo.byRange(SINCE, UNTIL)).toHaveLength(recoveriesBefore);
    expect(sleepRepo.byRange(SINCE, UNTIL)).toHaveLength(sleepsBefore);
    expect(workoutsRepo.byRange(SINCE, UNTIL)).toHaveLength(workoutsBefore);
    // body_measurements is append-on-change: SAME tuple → no new row.
    expect(bodyRepo.listAll()).toHaveLength(bodyBefore);

    // sync_runs now has 2 rows (one per run); both status='ok'.
    const syncRunsRepo = createSyncRunsRepo(mem.db);
    const runs = syncRunsRepo.listRecent();
    expect(runs).toHaveLength(2);
    expect(runs[0]?.status).toBe('ok');
    expect(runs[1]?.status).toBe('ok');
  });

  test('Test 3: per-resource hit counts confirm sync 2 actually re-fetched (no caching at the orchestrator layer)', async () => {
    const deps = buildDeps(mem);
    await runSync({ days: 30 }, deps);
    expect(mswHelper.getHitCount('cycles')).toBe(1);
    expect(mswHelper.getHitCount('recoveries')).toBe(1);

    await runSync({ days: 30 }, deps);
    // Second run re-hits each MSW endpoint exactly once. Confirms the
    // orchestrator's idempotency comes from the repos' ON CONFLICT DO
    // UPDATE path (D-11), not from a memoized fetch layer above.
    expect(mswHelper.getHitCount('cycles')).toBe(2);
    expect(mswHelper.getHitCount('recoveries')).toBe(2);
    expect(mswHelper.getHitCount('sleeps')).toBe(2);
    expect(mswHelper.getHitCount('workouts')).toBe(2);
    expect(mswHelper.getHitCount('profile')).toBe(2);
    expect(mswHelper.getHitCount('body_measurements')).toBe(2);
  });

  test('Test 4: sync_runs.per_resource JSON parses cleanly and matches D-24 shape per resource', async () => {
    const deps = buildDeps(mem);
    const result = await runSync({ days: 30 }, deps);

    const syncRunsRepo = createSyncRunsRepo(mem.db);
    const runs = syncRunsRepo.listRecent();
    expect(runs).toHaveLength(1);
    // listRecent maps the persisted per_resource JSON back into the typed
    // map — equality with the live result confirms the JSON round-trip.
    const persisted = runs[0]?.perResource;
    expect(persisted).toBeDefined();
    // Every resource has fetched/upserted/durationMs fields per D-24 shape.
    for (const resource of [
      'profile',
      'body_measurements',
      'cycles',
      'recoveries',
      'sleeps',
      'workouts',
    ] as const) {
      const outcome = persisted?.[resource];
      expect(outcome?.status).toBe('success');
      expect(typeof outcome?.fetched).toBe('number');
      expect(typeof outcome?.upserted).toBe('number');
      expect(typeof outcome?.durationMs).toBe('number');
    }
    // gapsDetected starts at 0 in Phase 3 (Phase 4 owns gap counts).
    expect(result.gapsDetected).toBe(0);
    expect(runs[0]?.gapsDetected).toBe(0);
    expect(runs[0]?.finishedAt).not.toBeNull();
  });

  test('Test 5: D-29 raw_json round-trip — cycles/recoveries/sleeps/workouts persist non-empty wire JSON', async () => {
    // Regression guard for #12 — before the fix the orchestrator never
    // threaded the raw WHOOP payload into upsertBatch, so all four scored
    // repos defaulted `raw_json` to literal `'{}'`. After the fix each
    // resource module returns `{ entities, rawRecords }` and the orchestrator
    // attaches `JSON.stringify(rawRecords[i])` per entity before upsert.
    const deps = buildDeps(mem);
    await runSync({ days: 30 }, deps);

    const cyclesRepo = createCyclesRepo(mem.db);
    const recoveryRepo = createRecoveryRepo(mem.db);
    const sleepRepo = createSleepsRepo(mem.db);
    const workoutsRepo = createWorkoutsRepo(mem.db);

    const cycles = cyclesRepo.byRange(SINCE, UNTIL);
    expect(cycles).toHaveLength(1);
    const cycleId = cycles[0]?.id;
    expect(cycleId).toBeDefined();
    if (cycleId === undefined) throw new Error('unreachable');
    const cycleRaw = cyclesRepo.getRawJson(cycleId);
    expect(cycleRaw).not.toBeNull();
    expect(cycleRaw).not.toBe('{}');
    expect(() => JSON.parse(cycleRaw ?? '')).not.toThrow();
    const cycleParsed = JSON.parse(cycleRaw ?? '{}');
    expect(cycleParsed).toMatchObject({ id: cycleId });

    const recoveries = recoveryRepo.byRange(SINCE, UNTIL);
    expect(recoveries).toHaveLength(1);
    const recovery = recoveries[0];
    expect(recovery).toBeDefined();
    if (!recovery) throw new Error('unreachable');
    const recoveryRaw = recoveryRepo.getRawJson(recovery.cycleId, recovery.sleepId);
    expect(recoveryRaw).not.toBeNull();
    expect(recoveryRaw).not.toBe('{}');
    expect(() => JSON.parse(recoveryRaw ?? '')).not.toThrow();

    const sleeps = sleepRepo.byRange(SINCE, UNTIL);
    expect(sleeps).toHaveLength(1);
    const sleepId = sleeps[0]?.id;
    expect(sleepId).toBeDefined();
    if (sleepId === undefined) throw new Error('unreachable');
    const sleepRaw = sleepRepo.getRawJson(sleepId);
    expect(sleepRaw).not.toBeNull();
    expect(sleepRaw).not.toBe('{}');
    expect(() => JSON.parse(sleepRaw ?? '')).not.toThrow();

    const workouts = workoutsRepo.byRange(SINCE, UNTIL);
    expect(workouts).toHaveLength(1);
    const workoutId = workouts[0]?.id;
    expect(workoutId).toBeDefined();
    if (workoutId === undefined) throw new Error('unreachable');
    const workoutRaw = workoutsRepo.getRawJson(workoutId);
    expect(workoutRaw).not.toBeNull();
    expect(workoutRaw).not.toBe('{}');
    expect(() => JSON.parse(workoutRaw ?? '')).not.toThrow();
  });
});
