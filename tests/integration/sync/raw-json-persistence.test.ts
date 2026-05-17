// Raw-JSON persistence integration test — Issue #12 regression anchor.
//
// Before the fix, the sync orchestrator stored `raw_json='{}'` for cycles,
// recoveries, sleeps, and workouts because the entity-to-row mapper relied on
// an intersection cast that the orchestrator never populated. Only profile and
// body_measurements actually persisted the WHOOP wire payload. This test runs
// a full sync across all 6 resources and asserts that `getRawJson(id)` returns
// the real fixture JSON for every resource — i.e. the D-29 diagnostic seam
// works for all 6, not 2.
//
// Test composition mirrors `idempotency.test.ts`: combined MSW server,
// in-memory DB, mocked refresh-orchestrator so the OAuth keychain stays out.
//
// ADR-0006: MSW with onUnhandledRequest:'error'.

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

const IANA_ZONE = 'America/Los_Angeles';
const FIXED_CLOCK = new Date('2026-05-13T12:00:00.000Z');

// Fixture-known primary keys (from tests/fixtures/whoop/<resource>/200-ok.json).
const CYCLE_ID = 12345678;
const RECOVERY_KEY = { cycleId: 12345678, sleepId: 'a98fe018-e629-4be3-97a6-529077ea7f24' };
const SLEEP_ID = '7dee4993-8fa2-43a7-8e54-94a5c0d3227a';
const WORKOUT_ID = 'fb8ce391-62b3-4fb3-8113-3eb522ede16c';
const PROFILE_USER_ID = 100001;

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

describe('sync raw_json persistence — Issue #12 regression', () => {
  test('runSync writes the real WHOOP wire JSON to raw_json for all 6 resources', async () => {
    const deps = buildDeps(mem);
    const result = await runSync({ days: 30 }, deps);
    expect(result.status).toBe('ok');

    const cyclesRepo = createCyclesRepo(mem.db);
    const recoveriesRepo = createRecoveryRepo(mem.db);
    const sleepsRepo = createSleepsRepo(mem.db);
    const workoutsRepo = createWorkoutsRepo(mem.db);
    const profileRepo = createProfileRepo(mem.db);
    const bodyRepo = createBodyMeasurementsRepo(mem.db);

    // The original bug: these four returned '{}' indistinguishably from
    // an empty WHOOP response. Each must now be a parseable, non-empty
    // JSON object whose top-level keys match the wire shape for the
    // resource — proving the orchestrator threaded the raw payload all
    // the way through `upsertBatch`.
    const cycleRaw = cyclesRepo.getRawJson(CYCLE_ID);
    expect(cycleRaw).not.toBeNull();
    expect(cycleRaw).not.toBe('{}');
    const cycleParsed = JSON.parse(cycleRaw as string) as Record<string, unknown>;
    expect(cycleParsed.id).toBe(CYCLE_ID);
    expect(cycleParsed.score_state).toBe('SCORED');

    const recoveryRaw = recoveriesRepo.getRawJson(RECOVERY_KEY.cycleId, RECOVERY_KEY.sleepId);
    expect(recoveryRaw).not.toBeNull();
    expect(recoveryRaw).not.toBe('{}');
    const recoveryParsed = JSON.parse(recoveryRaw as string) as Record<string, unknown>;
    expect(recoveryParsed.cycle_id).toBe(RECOVERY_KEY.cycleId);
    expect(recoveryParsed.sleep_id).toBe(RECOVERY_KEY.sleepId);

    const sleepRaw = sleepsRepo.getRawJson(SLEEP_ID);
    expect(sleepRaw).not.toBeNull();
    expect(sleepRaw).not.toBe('{}');
    const sleepParsed = JSON.parse(sleepRaw as string) as Record<string, unknown>;
    expect(sleepParsed.id).toBe(SLEEP_ID);

    const workoutRaw = workoutsRepo.getRawJson(WORKOUT_ID);
    expect(workoutRaw).not.toBeNull();
    expect(workoutRaw).not.toBe('{}');
    const workoutParsed = JSON.parse(workoutRaw as string) as Record<string, unknown>;
    expect(workoutParsed.id).toBe(WORKOUT_ID);

    // Profile + body_measurements were always correct — verify they did
    // not regress.
    const profileRaw = profileRepo.getRawJson(PROFILE_USER_ID);
    expect(profileRaw).not.toBeNull();
    expect(profileRaw).not.toBe('{}');

    const latestBody = bodyRepo.latest();
    expect(latestBody).not.toBeNull();
    const bodyRaw = bodyRepo.getRawJson(latestBody?.id ?? -1);
    expect(bodyRaw).not.toBeNull();
    expect(bodyRaw).not.toBe('{}');
  });
});
