// buildDataStatus tests — D-03 DataStatus assembly. Composes the latest
// finished sync run + staleness + missing-resource scan into the
// `data_status` slot of DailyReviewResult / WeeklyReviewResult.
//
// REV-04 anchor: data_status is the FIRST slot of the daily review;
// these tests lock the assembly so the formatter (Plan 04-09) can render
// it as the lead section without guessing at null shape.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createInMemoryDb, type InMemoryDbResult } from '../../../tests/helpers/in-memory-db.js';
import type { Cycle, Recovery, Sleep, Workout } from '../../domain/types/entities.js';
import {
  type BodyMeasurementsRepo,
  createBodyMeasurementsRepo,
} from '../../infrastructure/db/repositories/body-measurements.repo.js';
import {
  type CyclesRepo,
  createCyclesRepo,
} from '../../infrastructure/db/repositories/cycles.repo.js';
import {
  createProfileRepo,
  type ProfileRepo,
} from '../../infrastructure/db/repositories/profile.repo.js';
import {
  createRecoveryRepo,
  type RecoveryRepo,
} from '../../infrastructure/db/repositories/recovery.repo.js';
import {
  createSleepsRepo,
  type SleepsRepo,
} from '../../infrastructure/db/repositories/sleep.repo.js';
import {
  createSyncRunsRepo,
  type SyncRunsRepo,
} from '../../infrastructure/db/repositories/sync-runs.repo.js';
import {
  createWorkoutsRepo,
  type WorkoutsRepo,
} from '../../infrastructure/db/repositories/workouts.repo.js';
import { buildDataStatus } from './data-status.js';

const FIXED_NOW = new Date('2026-05-20T15:00:00.000Z');
const FIXED_CLOCK = (): Date => FIXED_NOW;

function makeScoredCycle(id: number, dateISO: string): Cycle {
  return {
    id,
    userId: 99,
    createdAt: `${dateISO}T07:00:00.000Z`,
    updatedAt: `${dateISO}T07:00:00.000Z`,
    start: `${dateISO}T07:00:00.000Z`,
    end: null,
    timezoneOffset: '-07:00',
    baselineExcluded: false,
    exclusionReason: null,
    scoreState: 'SCORED',
    strain: 10,
    kilojoule: 10000,
    averageHeartRate: 65,
    maxHeartRate: 170,
  };
}

function makeScoredRecovery(cycleId: number, sleepId: string, dateISO: string): Recovery {
  return {
    cycleId,
    sleepId,
    userId: 99,
    createdAt: `${dateISO}T08:00:00.000Z`,
    updatedAt: `${dateISO}T08:00:00.000Z`,
    scoreState: 'SCORED',
    recoveryScore: 70,
    restingHeartRate: 55,
    hrvRmssdMilli: 45,
    spo2Percentage: 97,
    skinTempCelsius: 33.5,
    userCalibrating: false,
  };
}

function makeScoredSleep(id: string, dateISO: string): Sleep {
  return {
    id,
    userId: 99,
    createdAt: `${dateISO}T08:00:00.000Z`,
    updatedAt: `${dateISO}T08:00:00.000Z`,
    start: `${dateISO}T05:00:00.000Z`,
    end: `${dateISO}T08:00:00.000Z`,
    timezoneOffset: '-07:00',
    scoreState: 'SCORED',
    totalInBedTimeMilli: 28_800_000,
    totalAwakeTimeMilli: 1_800_000,
    sleepPerformancePercentage: 88,
    sleepConsistencyPercentage: 75,
    sleepEfficiencyPercentage: 90,
    respiratoryRate: 14.5,
  };
}

function makeScoredWorkout(id: string, dateISO: string): Workout {
  return {
    id,
    userId: 99,
    createdAt: `${dateISO}T18:00:00.000Z`,
    updatedAt: `${dateISO}T18:00:00.000Z`,
    start: `${dateISO}T18:00:00.000Z`,
    end: `${dateISO}T19:00:00.000Z`,
    timezoneOffset: '-07:00',
    sportId: 0,
    scoreState: 'SCORED',
    strain: 8.5,
    averageHeartRate: 130,
    maxHeartRate: 160,
    kilojoule: 1500,
    distanceMeter: null,
    altitudeGainMeter: null,
    altitudeChangeMeter: null,
  };
}

interface Harness {
  mem: InMemoryDbResult;
  cycles: CyclesRepo;
  recoveries: RecoveryRepo;
  sleeps: SleepsRepo;
  workouts: WorkoutsRepo;
  profile: ProfileRepo;
  bodyMeasurements: BodyMeasurementsRepo;
  syncRuns: SyncRunsRepo;
}

function makeHarness(): Harness {
  const mem = createInMemoryDb();
  return {
    mem,
    cycles: createCyclesRepo(mem.db),
    recoveries: createRecoveryRepo(mem.db),
    sleeps: createSleepsRepo(mem.db),
    workouts: createWorkoutsRepo(mem.db),
    profile: createProfileRepo(mem.db),
    bodyMeasurements: createBodyMeasurementsRepo(mem.db),
    syncRuns: createSyncRunsRepo(mem.db),
  };
}

function buildDeps(h: Harness, clock: () => Date = FIXED_CLOCK) {
  return {
    repos: {
      cycles: h.cycles,
      recoveries: h.recoveries,
      sleeps: h.sleeps,
      workouts: h.workouts,
      profile: h.profile,
      bodyMeasurements: h.bodyMeasurements,
      syncRuns: h.syncRuns,
    },
    clock,
  };
}

describe('buildDataStatus — D-03 DataStatus assembly', () => {
  let h: Harness;
  beforeEach(() => {
    h = makeHarness();
  });
  afterEach(() => h.mem.close());

  it('Test 1: empty DB → null sync fields + staleness_days=0 + all 6 resources missing', () => {
    const status = buildDataStatus(
      {
        reviewed_date: '2026-05-20',
        baselineWindow: {
          start: '2026-04-21',
          end: '2026-05-20',
          scored_day_count: 0,
          coverage_pct: 0,
        },
      },
      buildDeps(h),
    );
    expect(status.reviewed_date).toBe('2026-05-20');
    expect(status.latest_sync_at).toBeNull();
    expect(status.latest_sync_status).toBeNull();
    expect(status.staleness_days).toBe(0);
    expect(status.baseline_window).toEqual({
      start: '2026-04-21',
      end: '2026-05-20',
      scored_day_count: 0,
      coverage_pct: 0,
    });
    // Empty DB → every resource is missing.
    expect(status.missing_resources.sort()).toEqual(
      ['body_measurements', 'cycles', 'profile', 'recoveries', 'sleeps', 'workouts'].sort(),
    );
  });

  it('Test 2: latest sync passes through "ok" + finished_at via latestFinished()', () => {
    const id = h.syncRuns.insertRunning({ startedAt: '2026-05-20T10:00:00.000Z', flags: null });
    h.syncRuns.finalize(id, 'ok', 0, '2026-05-20T10:05:00.000Z');
    const status = buildDataStatus(
      {
        reviewed_date: '2026-05-20',
        baselineWindow: {
          start: '2026-04-21',
          end: '2026-05-20',
          scored_day_count: 0,
          coverage_pct: 0,
        },
      },
      buildDeps(h),
    );
    expect(status.latest_sync_at).toBe('2026-05-20T10:05:00.000Z');
    expect(status.latest_sync_status).toBe('ok');
  });

  it('Test 3: latest sync "partial" passes through verbatim', () => {
    const id = h.syncRuns.insertRunning({ startedAt: '2026-05-20T10:00:00.000Z', flags: null });
    h.syncRuns.finalize(id, 'partial', 0, '2026-05-20T10:05:00.000Z');
    const status = buildDataStatus(
      {
        reviewed_date: '2026-05-20',
        baselineWindow: {
          start: '2026-04-21',
          end: '2026-05-20',
          scored_day_count: 0,
          coverage_pct: 0,
        },
      },
      buildDeps(h),
    );
    expect(status.latest_sync_status).toBe('partial');
  });

  it('Test 4: staleness_days = days(today - reviewed_date) — reviewed_date=2026-03-10, clock=2026-03-15 → 5', () => {
    const status = buildDataStatus(
      {
        reviewed_date: '2026-03-10',
        baselineWindow: {
          start: '2026-02-09',
          end: '2026-03-10',
          scored_day_count: 0,
          coverage_pct: 0,
        },
      },
      buildDeps(h, () => new Date('2026-03-15T12:00:00.000Z')),
    );
    expect(status.staleness_days).toBe(5);
  });

  it('Test 5: full DB (all 6 resources within trailing-7) → missing_resources=[]', () => {
    h.cycles.upsertBatch([makeScoredCycle(1, '2026-05-18')]);
    h.recoveries.upsertBatch([makeScoredRecovery(1, 'aa', '2026-05-18')]);
    h.sleeps.upsertBatch([makeScoredSleep('aa', '2026-05-18')]);
    h.workouts.upsertBatch([makeScoredWorkout('w1', '2026-05-18')]);
    h.profile.upsert(
      { userId: 99, email: 'a@b.com', firstName: 'A', lastName: 'B', rawJson: '{}' },
      { clock: FIXED_NOW },
    );
    h.bodyMeasurements.upsertOnChange(
      {
        userId: 99,
        heightMeter: 1.8,
        weightKilogram: 75,
        maxHeartRate: 190,
        rawJson: '{}',
      },
      { clock: FIXED_NOW },
    );
    const status = buildDataStatus(
      {
        reviewed_date: '2026-05-20',
        baselineWindow: {
          start: '2026-04-21',
          end: '2026-05-20',
          scored_day_count: 1,
          coverage_pct: 3.33,
        },
      },
      buildDeps(h),
    );
    expect(status.missing_resources).toEqual([]);
  });

  it("Test 6: DB has 4 entity resources but no profile / body_measurements → missing = ['body_measurements','profile']", () => {
    h.cycles.upsertBatch([makeScoredCycle(1, '2026-05-18')]);
    h.recoveries.upsertBatch([makeScoredRecovery(1, 'aa', '2026-05-18')]);
    h.sleeps.upsertBatch([makeScoredSleep('aa', '2026-05-18')]);
    h.workouts.upsertBatch([makeScoredWorkout('w1', '2026-05-18')]);
    const status = buildDataStatus(
      {
        reviewed_date: '2026-05-20',
        baselineWindow: {
          start: '2026-04-21',
          end: '2026-05-20',
          scored_day_count: 1,
          coverage_pct: 3.33,
        },
      },
      buildDeps(h),
    );
    expect(status.missing_resources.sort()).toEqual(['body_measurements', 'profile']);
  });

  it('Test 7: scored rows OLDER than trailing-7 still count that resource as missing', () => {
    // Cycle 2 weeks before reviewed_date — outside the trailing-7 window so
    // the freshness heuristic considers cycles 'missing' relative to today.
    h.cycles.upsertBatch([makeScoredCycle(1, '2026-05-01')]);
    h.profile.upsert(
      { userId: 99, email: 'a@b.com', firstName: 'A', lastName: 'B', rawJson: '{}' },
      { clock: FIXED_NOW },
    );
    h.bodyMeasurements.upsertOnChange(
      {
        userId: 99,
        heightMeter: 1.8,
        weightKilogram: 75,
        maxHeartRate: 190,
        rawJson: '{}',
      },
      { clock: FIXED_NOW },
    );
    const status = buildDataStatus(
      {
        reviewed_date: '2026-05-20',
        baselineWindow: {
          start: '2026-04-21',
          end: '2026-05-20',
          scored_day_count: 1,
          coverage_pct: 3.33,
        },
      },
      buildDeps(h),
    );
    expect(status.missing_resources.sort()).toEqual(['cycles', 'recoveries', 'sleeps', 'workouts']);
  });
});
