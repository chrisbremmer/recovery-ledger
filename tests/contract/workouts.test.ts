// Contract test for the workouts resource path (SYNC-07 anchor).
//
// Mirrors the canonical cycles.test.ts shape: MSW intercepts → listWorkouts()
// → normalizeWorkout → workoutsRepo.upsertBatch → workoutsRepo.byRange. UUID
// id per A6; SCORED workout carries strain on the entity, PENDING_SCORE /
// UNSCORABLE do not — locked via `ts-expect-error` discriminator narrowing.
//
// ADR-0006: onUnhandledRequest:'error' on MSW.

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';
import type { WorkoutUpsertRow } from '../../src/infrastructure/db/repositories/workouts.repo.js';
import { createInMemoryDb, type InMemoryDbResult } from '../helpers/in-memory-db.js';
import {
  createWhoopWorkoutsHelper,
  type WhoopWorkoutsHelper,
} from '../helpers/msw-whoop-workouts.js';

vi.mock('../../src/services/refresh-orchestrator.js', () => ({
  callWithAuth: (op: (token: string) => Promise<unknown>) => op('test-token-123'),
}));

const { listWorkouts } = await import('../../src/infrastructure/whoop/resources/workouts.js');
const { createWorkoutsRepo } = await import(
  '../../src/infrastructure/db/repositories/workouts.repo.js'
);
const { _resetForTest: resetRateLimit } = await import(
  '../../src/infrastructure/whoop/rate-limit.js'
);

vi.setConfig({ testTimeout: 5_000 });

const SINCE = '2026-01-01T00:00:00.000Z';
const UNTIL = '2026-12-31T23:59:59.999Z';
const BASE_USER_ID = 100001;
const FIXTURE_WORKOUT_ID = 'fb8ce391-62b3-4fb3-8113-3eb522ede16c';

function makeScoredWorkout(id: string): WorkoutUpsertRow {
  return {
    id,
    userId: BASE_USER_ID,
    createdAt: '2026-05-10T18:00:00.000Z',
    updatedAt: '2026-05-10T19:30:00.000Z',
    start: '2026-05-10T17:30:00.000Z',
    end: '2026-05-10T18:30:00.000Z',
    timezoneOffset: '-08:00',
    sportId: 0,
    scoreState: 'SCORED',
    strain: 12.8,
    averageHeartRate: 142,
    maxHeartRate: 178,
    kilojoule: 1450.2,
    distanceMeter: 8400.0,
    altitudeGainMeter: 42.0,
    altitudeChangeMeter: 12.0,
    rawJson: '{}',
  };
}

function makePendingWorkout(id: string): WorkoutUpsertRow {
  return {
    id,
    userId: BASE_USER_ID,
    createdAt: '2026-05-11T18:00:00.000Z',
    updatedAt: '2026-05-11T18:30:00.000Z',
    start: '2026-05-11T17:30:00.000Z',
    end: '2026-05-11T18:30:00.000Z',
    timezoneOffset: '-08:00',
    sportId: 0,
    scoreState: 'PENDING_SCORE',
    rawJson: '{}',
  };
}

let helper: WhoopWorkoutsHelper;
let mem: InMemoryDbResult;

beforeAll(() => {
  helper = createWhoopWorkoutsHelper();
  helper.server.listen({ onUnhandledRequest: 'error' });
});

afterAll(() => {
  helper.server.close();
});

beforeEach(() => {
  resetRateLimit();
  helper.resetHitCount();
  helper.server.resetHandlers();
  mem = createInMemoryDb();
});

afterEach(() => {
  mem.close();
});

describe('workouts contract — happy path + idempotency', () => {
  test('Test 1: happy path — listWorkouts + upsertBatch + byRange returns the fixture workout', async () => {
    const { entities: workouts } = await listWorkouts({ since: SINCE, until: UNTIL });
    expect(workouts).toHaveLength(1);
    expect(workouts[0]?.scoreState).toBe('SCORED');
    expect(workouts[0]?.id).toBe(FIXTURE_WORKOUT_ID);

    const repo = createWorkoutsRepo(mem.db);
    const upsertResult = repo.upsertBatch(workouts.map((w) => ({ ...w, rawJson: '{}' })));
    expect(upsertResult.changed).toBe(1);

    const stored = repo.byRange(SINCE, UNTIL);
    expect(stored).toHaveLength(1);
    expect(stored[0]?.id).toBe(FIXTURE_WORKOUT_ID);
  });

  test('Test 2: idempotency — second pass leaves row count at 1', async () => {
    const repo = createWorkoutsRepo(mem.db);
    const { entities: first } = await listWorkouts({ since: SINCE, until: UNTIL });
    repo.upsertBatch(first.map((w) => ({ ...w, rawJson: '{}' })));
    const { entities: second } = await listWorkouts({ since: SINCE, until: UNTIL });
    repo.upsertBatch(second.map((w) => ({ ...w, rawJson: '{}' })));

    const count = (mem.sqlite.prepare('SELECT COUNT(*) AS c FROM workouts').get() as { c: number })
      .c;
    expect(count).toBe(1);
    expect(helper.getHitCount()).toBe(2);
  });
});

describe('workouts contract — D-04 SCORED-only default filter', () => {
  test('Test 3: default byRange returns SCORED only; includeUnscored returns both', () => {
    const repo = createWorkoutsRepo(mem.db);
    repo.upsertBatch([
      makeScoredWorkout(FIXTURE_WORKOUT_ID),
      makePendingWorkout('22222222-2222-2222-2222-222222222222'),
    ]);
    const defaultRows = repo.byRange(SINCE, UNTIL);
    expect(defaultRows).toHaveLength(1);
    expect(defaultRows[0]?.scoreState).toBe('SCORED');

    const allRows = repo.byRange(SINCE, UNTIL, { includeUnscored: true });
    expect(allRows).toHaveLength(2);
  });
});

describe('workouts contract — A6 UUID id shape', () => {
  test('Test 4: stored workout id is a 36-char UUID string', async () => {
    const { entities: workouts } = await listWorkouts({ since: SINCE, until: UNTIL });
    const repo = createWorkoutsRepo(mem.db);
    repo.upsertBatch(workouts.map((w) => ({ ...w, rawJson: '{}' })));
    const stored = repo.byRange(SINCE, UNTIL);
    expect(typeof stored[0]?.id).toBe('string');
    expect(stored[0]?.id.length).toBe(36);
  });
});

describe('workouts contract — getRawJson diagnostic seam (D-29)', () => {
  test('Test 5: getRawJson(id) returns the stored raw_json payload', async () => {
    const { entities: workouts } = await listWorkouts({ since: SINCE, until: UNTIL });
    const repo = createWorkoutsRepo(mem.db);
    const fixturePayload = '{"id":"fb8ce391-62b3-4fb3-8113-3eb522ede16c","mock":true}';
    repo.upsertBatch(workouts.map((w) => ({ ...w, rawJson: fixturePayload })));
    expect(repo.getRawJson(FIXTURE_WORKOUT_ID)).toBe(fixturePayload);
  });
});

describe('workouts contract — DU discriminator narrowing (D-03 + ADR-0003)', () => {
  test('Test 6: SCORED workout has strain; PENDING_SCORE workout does not — ts-expect-error locks the type', async () => {
    const { entities: workouts } = await listWorkouts({ since: SINCE, until: UNTIL });
    const repo = createWorkoutsRepo(mem.db);
    repo.upsertBatch(workouts.map((w) => ({ ...w, rawJson: '{}' })));
    // Seed a PENDING_SCORE row alongside the SCORED one.
    repo.upsertBatch([makePendingWorkout('33333333-3333-3333-3333-333333333333')]);

    const allRows = repo.byRange(SINCE, UNTIL, { includeUnscored: true });
    const scored = allRows.find((w) => w.scoreState === 'SCORED');
    const pending = allRows.find((w) => w.scoreState === 'PENDING_SCORE');
    expect(scored).toBeDefined();
    expect(pending).toBeDefined();

    if (scored?.scoreState === 'SCORED') {
      expect(scored.strain).toBeGreaterThan(0);
    }
    if (pending?.scoreState === 'PENDING_SCORE') {
      // @ts-expect-error PENDING_SCORE Workout entity carries no strain field (DU narrowing lock)
      const _shouldNotCompile: number = pending.strain;
      void _shouldNotCompile;
    }
  });
});
