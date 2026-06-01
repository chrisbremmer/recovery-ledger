// DBIN-02 (#76): sleeps and workouts byRange now inherit baseline_excluded
// via a time-overlap JOIN onto the parent cycle (pre-DBIN-02, includeExcluded
// was a documented no-op on sleeps and the option did not exist on workouts).
// These regression tests pin the contract: a sleep/workout whose start falls
// inside a DST-straddle cycle is excluded from the default filter and only
// surfaces with includeExcluded: true.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createInMemoryDb, type InMemoryDbResult } from '../../../../tests/helpers/in-memory-db.js';
import type { Cycle, Sleep, Workout } from '../../../domain/types/entities.js';
import { createCyclesRepo } from './cycles.repo.js';
import { createSleepsRepo } from './sleep.repo.js';
import { createWorkoutsRepo } from './workouts.repo.js';

const BASE_USER_ID = 100001;
const SLEEP_CLEAN = 'a712fd26-deab-4bec-9503-2cc6a8fbab3f';
const SLEEP_DST = 'bb8c0f52-773e-4875-820b-df64d972ff13';
const WORKOUT_CLEAN = 'c712fd26-deab-4bec-9503-2cc6a8fbab3f';
const WORKOUT_DST = 'dd8c0f52-773e-4875-820b-df64d972ff13';

function makeCycle(id: number, dayIso: string, baselineExcluded: boolean): Cycle {
  // dayIso example: '2026-05-13' -> cycle spans 07:00 that day to 07:00 next day.
  const start = `${dayIso}T07:00:00.000Z`;
  const next = new Date(`${dayIso}T00:00:00.000Z`);
  next.setUTCDate(next.getUTCDate() + 1);
  const end = `${next.toISOString().slice(0, 10)}T07:00:00.000Z`;
  return {
    id,
    userId: BASE_USER_ID,
    createdAt: start,
    updatedAt: end,
    start,
    end,
    timezoneOffset: '-08:00',
    scoreState: 'SCORED',
    strain: 12,
    kilojoule: 8300,
    averageHeartRate: 67,
    maxHeartRate: 176,
    baselineExcluded,
    exclusionReason: baselineExcluded ? 'dst_straddle' : null,
  };
}

function makeSleep(id: string, startIso: string): Sleep {
  return {
    id,
    userId: BASE_USER_ID,
    createdAt: startIso,
    updatedAt: startIso,
    start: startIso,
    end: startIso,
    timezoneOffset: '-08:00',
    scoreState: 'SCORED',
    totalInBedTimeMilli: 28800000,
    totalAwakeTimeMilli: 1800000,
    sleepPerformancePercentage: 88.0,
    sleepConsistencyPercentage: 75.0,
    sleepEfficiencyPercentage: 91.5,
    respiratoryRate: 14.2,
  };
}

function makeWorkout(id: string, startIso: string): Workout {
  return {
    id,
    userId: BASE_USER_ID,
    createdAt: startIso,
    updatedAt: startIso,
    start: startIso,
    end: startIso,
    timezoneOffset: '-08:00',
    sportId: 1,
    scoreState: 'SCORED',
    strain: 8.0,
    averageHeartRate: 140,
    maxHeartRate: 175,
    kilojoule: 2000,
    distanceMeter: null,
    altitudeGainMeter: null,
    altitudeChangeMeter: null,
  };
}

describe('sleep repo — DBIN-02 byRange JOIN-based exclusion (#76)', () => {
  let mem: InMemoryDbResult;
  beforeEach(() => {
    mem = createInMemoryDb();
  });
  afterEach(() => mem.close());

  it('default filter excludes a sleep whose start falls inside a DST-straddle cycle', () => {
    const cyclesRepo = createCyclesRepo(mem.db);
    cyclesRepo.upsertBatch([
      makeCycle(40001, '2026-05-13', false),
      makeCycle(40002, '2026-05-14', true),
    ]);
    const sleepRepo = createSleepsRepo(mem.db);
    sleepRepo.upsertBatch([
      makeSleep(SLEEP_CLEAN, '2026-05-13T22:00:00.000Z'),
      makeSleep(SLEEP_DST, '2026-05-14T22:00:00.000Z'),
    ]);

    const rows = sleepRepo.byRange('2026-05-01', '2026-05-31');
    expect(rows).toHaveLength(1);
    expect(rows[0]?.id).toBe(SLEEP_CLEAN);
  });

  it('includeExcluded: true returns both sleeps', () => {
    const cyclesRepo = createCyclesRepo(mem.db);
    cyclesRepo.upsertBatch([
      makeCycle(40001, '2026-05-13', false),
      makeCycle(40002, '2026-05-14', true),
    ]);
    const sleepRepo = createSleepsRepo(mem.db);
    sleepRepo.upsertBatch([
      makeSleep(SLEEP_CLEAN, '2026-05-13T22:00:00.000Z'),
      makeSleep(SLEEP_DST, '2026-05-14T22:00:00.000Z'),
    ]);

    const rows = sleepRepo.byRange('2026-05-01', '2026-05-31', { includeExcluded: true });
    expect(rows).toHaveLength(2);
  });

  it('orphan sleep (no parent cycle synced yet) is KEPT — absence-of-evidence is not exclusion', () => {
    // Only one cycle seeded; the SLEEP_DST sleep falls outside any cycle
    // window. Per the NOT EXISTS predicate, an orphan with no covering cycle
    // is kept (the conservative default: don't drop rows we cannot prove
    // belong to a DST-straddle cycle). Production syncs cycles before sleeps,
    // but tests may seed in any order — this case must not silently lose data.
    const cyclesRepo = createCyclesRepo(mem.db);
    cyclesRepo.upsertBatch([makeCycle(40001, '2026-05-13', false)]);
    const sleepRepo = createSleepsRepo(mem.db);
    sleepRepo.upsertBatch([
      makeSleep(SLEEP_CLEAN, '2026-05-13T22:00:00.000Z'),
      makeSleep(SLEEP_DST, '2026-05-20T22:00:00.000Z'),
    ]);

    const rows = sleepRepo.byRange('2026-05-01', '2026-05-31');
    expect(rows).toHaveLength(2);
  });
});

describe('workouts repo — DBIN-02 byRange JOIN-based exclusion (#76)', () => {
  let mem: InMemoryDbResult;
  beforeEach(() => {
    mem = createInMemoryDb();
  });
  afterEach(() => mem.close());

  it('default filter excludes a workout whose start falls inside a DST-straddle cycle', () => {
    const cyclesRepo = createCyclesRepo(mem.db);
    cyclesRepo.upsertBatch([
      makeCycle(40001, '2026-05-13', false),
      makeCycle(40002, '2026-05-14', true),
    ]);
    const workoutsRepo = createWorkoutsRepo(mem.db);
    workoutsRepo.upsertBatch([
      makeWorkout(WORKOUT_CLEAN, '2026-05-13T18:00:00.000Z'),
      makeWorkout(WORKOUT_DST, '2026-05-14T18:00:00.000Z'),
    ]);

    const rows = workoutsRepo.byRange('2026-05-01', '2026-05-31');
    expect(rows).toHaveLength(1);
    expect(rows[0]?.id).toBe(WORKOUT_CLEAN);
  });

  it('includeExcluded: true returns both workouts', () => {
    const cyclesRepo = createCyclesRepo(mem.db);
    cyclesRepo.upsertBatch([
      makeCycle(40001, '2026-05-13', false),
      makeCycle(40002, '2026-05-14', true),
    ]);
    const workoutsRepo = createWorkoutsRepo(mem.db);
    workoutsRepo.upsertBatch([
      makeWorkout(WORKOUT_CLEAN, '2026-05-13T18:00:00.000Z'),
      makeWorkout(WORKOUT_DST, '2026-05-14T18:00:00.000Z'),
    ]);

    const rows = workoutsRepo.byRange('2026-05-01', '2026-05-31', { includeExcluded: true });
    expect(rows).toHaveLength(2);
  });
});
