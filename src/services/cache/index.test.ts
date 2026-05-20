// services/cache — `queryCache` orchestrator tests (Plan 04-08 Task 1).
//
// D-24 8-arm typed-discriminated-union dispatch verified through the
// in-memory-db helper + the real Phase 3 + Plan 04-06 repositories. Each arm
// gets a per-resource exercise; the limit-clamp + truncation semantics get
// dedicated tests (Pitfall 7 §SCORED-only opt-out + D-24 §limit hard-cap).
//
// T-04-S4 (Plan 04-02 threat register): the typed union refuses free-form
// SQL at the type system; runtime test asserts that the in-memory filter
// path for sportId / category / min/maxRecoveryScore is honored.
//
// Pitfall 17: the logger payload must NOT carry decision text — covered
// in Test 14 (`decisions arm + log payload shape`).

import type { Logger } from 'pino';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createInMemoryDb, type InMemoryDbResult } from '../../../tests/helpers/in-memory-db.js';
import type { Cycle, Recovery, Sleep, Workout } from '../../domain/types/entities.js';
import { createBodyMeasurementsRepo } from '../../infrastructure/db/repositories/body-measurements.repo.js';
import { createCyclesRepo } from '../../infrastructure/db/repositories/cycles.repo.js';
import { createDecisionsRepo } from '../../infrastructure/db/repositories/decisions.repo.js';
import { createProfileRepo } from '../../infrastructure/db/repositories/profile.repo.js';
import { createRecoveryRepo } from '../../infrastructure/db/repositories/recovery.repo.js';
import { createSleepsRepo } from '../../infrastructure/db/repositories/sleep.repo.js';
import { createSyncRunsRepo } from '../../infrastructure/db/repositories/sync-runs.repo.js';
import { createWorkoutsRepo } from '../../infrastructure/db/repositories/workouts.repo.js';
import { queryCache } from './index.js';
import type { QueryCacheDeps } from './index.js';

function makeStubLogger(): Logger {
  const noop = vi.fn();
  return {
    info: noop,
    warn: noop,
    error: noop,
    debug: noop,
    trace: noop,
    fatal: noop,
    child: () => makeStubLogger(),
  } as unknown as Logger;
}

interface Harness {
  mem: InMemoryDbResult;
  deps: QueryCacheDeps;
}

function makeHarness(): Harness {
  const mem = createInMemoryDb();
  const repos = {
    cycles: createCyclesRepo(mem.db),
    recoveries: createRecoveryRepo(mem.db),
    sleeps: createSleepsRepo(mem.db),
    workouts: createWorkoutsRepo(mem.db),
    profile: createProfileRepo(mem.db),
    bodyMeasurements: createBodyMeasurementsRepo(mem.db),
    syncRuns: createSyncRunsRepo(mem.db),
    decisions: createDecisionsRepo(mem.db),
  };
  return { mem, deps: { repos, logger: makeStubLogger() } };
}

// ---------------------------------------------------------------------------
// Fixture builders — minimal SCORED/PENDING entities for the in-memory DB.
// ---------------------------------------------------------------------------

let cycleSeq = 1;
function makeCycle(opts: {
  start: string;
  end?: string;
  scoreState?: 'SCORED' | 'PENDING_SCORE' | 'UNSCORABLE';
  baselineExcluded?: boolean;
  strain?: number;
}): Cycle {
  const id = cycleSeq++;
  const base = {
    id,
    userId: 1001,
    createdAt: opts.start,
    updatedAt: opts.start,
    start: opts.start,
    end: opts.end ?? opts.start,
    timezoneOffset: '+00:00',
    baselineExcluded: opts.baselineExcluded ?? false,
    exclusionReason: null,
  };
  const state = opts.scoreState ?? 'SCORED';
  if (state === 'SCORED') {
    return {
      ...base,
      scoreState: 'SCORED',
      strain: opts.strain ?? 12.5,
      kilojoule: 8000,
      averageHeartRate: 65,
      maxHeartRate: 150,
    };
  }
  return { ...base, scoreState: state, exclusionReason: null };
}

function makeRecovery(opts: {
  cycleId: number;
  sleepId: string;
  createdAt: string;
  recoveryScore?: number;
  scoreState?: 'SCORED' | 'PENDING_SCORE' | 'UNSCORABLE';
}): Recovery {
  const base = {
    cycleId: opts.cycleId,
    sleepId: opts.sleepId,
    userId: 1001,
    createdAt: opts.createdAt,
    updatedAt: opts.createdAt,
  };
  const state = opts.scoreState ?? 'SCORED';
  if (state === 'SCORED') {
    return {
      ...base,
      scoreState: 'SCORED',
      recoveryScore: opts.recoveryScore ?? 70,
      restingHeartRate: 55,
      hrvRmssdMilli: 60,
      spo2Percentage: 97,
      skinTempCelsius: 33,
      userCalibrating: false,
    };
  }
  return { ...base, scoreState: state };
}

function makeSleep(opts: {
  id: string;
  start: string;
  end?: string;
  scoreState?: 'SCORED' | 'PENDING_SCORE' | 'UNSCORABLE';
}): Sleep {
  const base = {
    id: opts.id,
    userId: 1001,
    createdAt: opts.start,
    updatedAt: opts.start,
    start: opts.start,
    end: opts.end ?? opts.start,
    timezoneOffset: '+00:00',
  };
  const state = opts.scoreState ?? 'SCORED';
  if (state === 'SCORED') {
    return {
      ...base,
      scoreState: 'SCORED',
      totalInBedTimeMilli: 28_800_000,
      totalAwakeTimeMilli: 1_800_000,
      sleepPerformancePercentage: 90,
      sleepConsistencyPercentage: 85,
      sleepEfficiencyPercentage: 92,
      respiratoryRate: 14,
    };
  }
  return { ...base, scoreState: state };
}

function makeWorkout(opts: {
  id: string;
  start: string;
  end?: string;
  sportId: number;
  scoreState?: 'SCORED' | 'PENDING_SCORE' | 'UNSCORABLE';
}): Workout {
  const base = {
    id: opts.id,
    userId: 1001,
    createdAt: opts.start,
    updatedAt: opts.start,
    start: opts.start,
    end: opts.end ?? opts.start,
    timezoneOffset: '+00:00',
    sportId: opts.sportId,
  };
  const state = opts.scoreState ?? 'SCORED';
  if (state === 'SCORED') {
    return {
      ...base,
      scoreState: 'SCORED',
      strain: 10,
      averageHeartRate: 130,
      maxHeartRate: 175,
      kilojoule: 2000,
      distanceMeter: null,
      altitudeGainMeter: null,
      altitudeChangeMeter: null,
    };
  }
  return { ...base, scoreState: state };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('services/cache — cycles arm (D-24)', () => {
  let h: Harness;
  beforeEach(() => {
    cycleSeq = 1;
    h = makeHarness();
  });
  afterEach(() => h.mem.close());

  it('Test 1: empty range returns count=0, truncated=false, rows=[]', async () => {
    const result = await queryCache({ resource: 'cycles' }, h.deps);
    expect(result.resource).toBe('cycles');
    expect(result.rows).toHaveLength(0);
    expect(result.count).toBe(0);
    expect(result.truncated).toBe(false);
  });

  it('Test 2: 5 SCORED cycles returns 5 rows (default SCORED-only filter)', async () => {
    const cycles: Cycle[] = [];
    for (let i = 0; i < 5; i++) {
      cycles.push(makeCycle({ start: `2026-04-${String(10 + i).padStart(2, '0')}T08:00:00.000Z` }));
    }
    h.deps.repos.cycles.upsertBatch(cycles);
    const result = await queryCache({ resource: 'cycles' }, h.deps);
    expect(result.rows).toHaveLength(5);
    expect(result.truncated).toBe(false);
  });

  it('Test 3: PENDING_SCORE excluded by default, included with includeUnscored=true', async () => {
    h.deps.repos.cycles.upsertBatch([
      makeCycle({ start: '2026-04-10T08:00:00.000Z' }),
      makeCycle({ start: '2026-04-11T08:00:00.000Z', scoreState: 'PENDING_SCORE' }),
      makeCycle({ start: '2026-04-12T08:00:00.000Z', scoreState: 'PENDING_SCORE' }),
    ]);
    const defaulted = await queryCache({ resource: 'cycles' }, h.deps);
    expect(defaulted.rows).toHaveLength(1);

    const expanded = await queryCache({ resource: 'cycles', includeUnscored: true }, h.deps);
    expect(expanded.rows).toHaveLength(3);
  });

  it('Test 4: 105 rows + limit=100 returns 100 + truncated=true + count=101', async () => {
    const cycles: Cycle[] = [];
    for (let i = 0; i < 105; i++) {
      // Spread the start times across days so byRange does not collapse them.
      const day = String((i % 28) + 1).padStart(2, '0');
      const hour = String(i % 24).padStart(2, '0');
      cycles.push({
        ...makeCycle({ start: `2026-04-${day}T${hour}:00:00.000Z` }),
        id: i + 1000,
      } as Cycle);
    }
    h.deps.repos.cycles.upsertBatch(cycles);
    const result = await queryCache({ resource: 'cycles', limit: 100 }, h.deps);
    expect(result.rows).toHaveLength(100);
    expect(result.truncated).toBe(true);
    expect(result.count).toBe(101);
  });

  it('Test 5: baseline_excluded cycles included with includeExcluded=true', async () => {
    h.deps.repos.cycles.upsertBatch([
      makeCycle({ start: '2026-04-10T08:00:00.000Z' }),
      makeCycle({ start: '2026-04-11T08:00:00.000Z', baselineExcluded: true }),
    ]);
    const defaulted = await queryCache({ resource: 'cycles' }, h.deps);
    expect(defaulted.rows).toHaveLength(1);
    const expanded = await queryCache({ resource: 'cycles', includeExcluded: true }, h.deps);
    expect(expanded.rows).toHaveLength(2);
  });
});

describe('services/cache — recoveries arm', () => {
  let h: Harness;
  beforeEach(() => {
    cycleSeq = 1;
    h = makeHarness();
  });
  afterEach(() => h.mem.close());

  it('Test 6: min/maxRecoveryScore filter is applied after the repo read', async () => {
    // Recoveries FK onto cycles — insert cycles first.
    const cycle0 = makeCycle({ start: '2026-04-10T08:00:00.000Z' });
    const cycle1 = makeCycle({ start: '2026-04-11T08:00:00.000Z' });
    const cycle2 = makeCycle({ start: '2026-04-12T08:00:00.000Z' });
    h.deps.repos.cycles.upsertBatch([cycle0, cycle1, cycle2]);

    // Sleeps share the foreign-key surface via sleep_id.
    const sleeps: Sleep[] = [
      makeSleep({ id: 's-1', start: '2026-04-10T22:00:00.000Z' }),
      makeSleep({ id: 's-2', start: '2026-04-11T22:00:00.000Z' }),
      makeSleep({ id: 's-3', start: '2026-04-12T22:00:00.000Z' }),
    ];
    h.deps.repos.sleeps.upsertBatch(sleeps);

    h.deps.repos.recoveries.upsertBatch([
      makeRecovery({
        cycleId: cycle0.id,
        sleepId: 's-1',
        createdAt: '2026-04-10T08:30:00.000Z',
        recoveryScore: 45,
      }),
      makeRecovery({
        cycleId: cycle1.id,
        sleepId: 's-2',
        createdAt: '2026-04-11T08:30:00.000Z',
        recoveryScore: 65,
      }),
      makeRecovery({
        cycleId: cycle2.id,
        sleepId: 's-3',
        createdAt: '2026-04-12T08:30:00.000Z',
        recoveryScore: 80,
      }),
    ]);

    const filtered = await queryCache(
      { resource: 'recoveries', minRecoveryScore: 60 },
      h.deps,
    );
    expect(filtered.rows).toHaveLength(2);
    const filteredHigh = await queryCache(
      { resource: 'recoveries', minRecoveryScore: 60, maxRecoveryScore: 70 },
      h.deps,
    );
    expect(filteredHigh.rows).toHaveLength(1);
  });
});

describe('services/cache — sleeps arm', () => {
  let h: Harness;
  beforeEach(() => {
    cycleSeq = 1;
    h = makeHarness();
  });
  afterEach(() => h.mem.close());

  it('Test 7: default returns SCORED only; includeUnscored=true returns all', async () => {
    h.deps.repos.sleeps.upsertBatch([
      makeSleep({ id: 's-a', start: '2026-04-10T22:00:00.000Z' }),
      makeSleep({
        id: 's-b',
        start: '2026-04-11T22:00:00.000Z',
        scoreState: 'PENDING_SCORE',
      }),
    ]);
    const defaulted = await queryCache({ resource: 'sleeps' }, h.deps);
    expect(defaulted.rows).toHaveLength(1);
    const expanded = await queryCache({ resource: 'sleeps', includeUnscored: true }, h.deps);
    expect(expanded.rows).toHaveLength(2);
  });
});

describe('services/cache — workouts arm', () => {
  let h: Harness;
  beforeEach(() => {
    cycleSeq = 1;
    h = makeHarness();
  });
  afterEach(() => h.mem.close());

  it('Test 8: sportId filter returns only matching workouts', async () => {
    h.deps.repos.workouts.upsertBatch([
      makeWorkout({ id: 'w-1', start: '2026-04-10T18:00:00.000Z', sportId: 0 }),
      makeWorkout({ id: 'w-2', start: '2026-04-11T18:00:00.000Z', sportId: 1 }),
      makeWorkout({ id: 'w-3', start: '2026-04-12T18:00:00.000Z', sportId: 0 }),
    ]);
    const filtered = await queryCache({ resource: 'workouts', sportId: 0 }, h.deps);
    expect(filtered.rows).toHaveLength(2);
    expect(filtered.count).toBe(2);
  });
});

describe('services/cache — profile arm', () => {
  let h: Harness;
  beforeEach(() => {
    cycleSeq = 1;
    h = makeHarness();
  });
  afterEach(() => h.mem.close());

  it('Test 9: empty profile table returns 0 rows', async () => {
    const result = await queryCache({ resource: 'profile' }, h.deps);
    expect(result.rows).toHaveLength(0);
    expect(result.count).toBe(0);
  });

  it('Test 10: populated profile returns exactly 1 row', async () => {
    h.deps.repos.profile.upsert(
      {
        userId: 1001,
        email: 'chris@example.com',
        firstName: 'Chris',
        lastName: 'B',
        rawJson: '{}',
      },
      { clock: new Date('2026-05-20T12:00:00.000Z') },
    );
    const result = await queryCache({ resource: 'profile' }, h.deps);
    expect(result.rows).toHaveLength(1);
    expect(result.count).toBe(1);
  });
});

describe('services/cache — body_measurements arm', () => {
  let h: Harness;
  beforeEach(() => {
    cycleSeq = 1;
    h = makeHarness();
  });
  afterEach(() => h.mem.close());

  it('Test 11: range query returns rows whose captured_at is within window', async () => {
    h.deps.repos.bodyMeasurements.upsertOnChange(
      { userId: 1001, heightMeter: 1.8, weightKilogram: 75, maxHeartRate: 190, rawJson: '{}' },
      { clock: new Date('2026-04-10T08:00:00.000Z') },
    );
    h.deps.repos.bodyMeasurements.upsertOnChange(
      { userId: 1001, heightMeter: 1.8, weightKilogram: 76, maxHeartRate: 190, rawJson: '{}' },
      { clock: new Date('2026-04-15T08:00:00.000Z') },
    );

    const inRange = await queryCache(
      { resource: 'body_measurements', since: '2026-04-09', until: '2026-04-20' },
      h.deps,
    );
    expect(inRange.rows).toHaveLength(2);

    const tight = await queryCache(
      { resource: 'body_measurements', since: '2026-04-12', until: '2026-04-20' },
      h.deps,
    );
    expect(tight.rows).toHaveLength(1);
  });
});

describe('services/cache — sync_runs arm', () => {
  let h: Harness;
  beforeEach(() => {
    cycleSeq = 1;
    h = makeHarness();
  });
  afterEach(() => h.mem.close());

  it('Test 12: filtering by status returns only matching rows', async () => {
    const id1 = h.deps.repos.syncRuns.insertRunning({
      startedAt: '2026-04-10T08:00:00.000Z',
      flags: null,
    });
    h.deps.repos.syncRuns.finalize(id1, 'ok', 0, '2026-04-10T08:05:00.000Z');
    const id2 = h.deps.repos.syncRuns.insertRunning({
      startedAt: '2026-04-11T08:00:00.000Z',
      flags: null,
    });
    h.deps.repos.syncRuns.finalize(id2, 'partial', 1, '2026-04-11T08:05:00.000Z');
    const id3 = h.deps.repos.syncRuns.insertRunning({
      startedAt: '2026-04-12T08:00:00.000Z',
      flags: null,
    });
    h.deps.repos.syncRuns.finalize(id3, 'partial', 2, '2026-04-12T08:05:00.000Z');

    const partials = await queryCache({ resource: 'sync_runs', status: 'partial' }, h.deps);
    expect(partials.rows).toHaveLength(2);

    const all = await queryCache({ resource: 'sync_runs' }, h.deps);
    expect(all.rows).toHaveLength(3);
  });
});

describe('services/cache — decisions arm', () => {
  let h: Harness;
  beforeEach(() => {
    cycleSeq = 1;
    h = makeHarness();
  });
  afterEach(() => h.mem.close());

  it('Test 13: status="open" dispatches to listOpen; status="followed_up" filters listAll', async () => {
    h.deps.repos.decisions.insert({
      id: '01HK0000000000000000000001',
      createdAt: '2026-04-10T08:00:00.000Z',
      category: 'sleep',
      decision: 'lights out earlier',
      rationale: null,
      confidence: null,
      expectedEffect: null,
      followUpDate: null,
    });
    h.deps.repos.decisions.insert({
      id: '01HK0000000000000000000002',
      createdAt: '2026-04-11T08:00:00.000Z',
      category: 'lifestyle',
      decision: 'less caffeine',
      rationale: null,
      confidence: null,
      expectedEffect: null,
      followUpDate: null,
    });
    h.deps.repos.decisions.updateOutcome(
      '01HK0000000000000000000002',
      'followed_up',
      'hrv up',
    );

    const openOnly = await queryCache({ resource: 'decisions', status: 'open' }, h.deps);
    expect(openOnly.rows).toHaveLength(1);

    const followedUp = await queryCache(
      { resource: 'decisions', status: 'followed_up' },
      h.deps,
    );
    expect(followedUp.rows).toHaveLength(1);
  });

  it('Test 14: decisions arm category filter applies in-memory', async () => {
    h.deps.repos.decisions.insert({
      id: '01HK0000000000000000000010',
      createdAt: '2026-04-10T08:00:00.000Z',
      category: 'sleep',
      decision: 'lights out earlier',
      rationale: null,
      confidence: null,
      expectedEffect: null,
      followUpDate: null,
    });
    h.deps.repos.decisions.insert({
      id: '01HK0000000000000000000011',
      createdAt: '2026-04-11T08:00:00.000Z',
      category: 'lifestyle',
      decision: 'less caffeine',
      rationale: null,
      confidence: null,
      expectedEffect: null,
      followUpDate: null,
    });

    const sleep = await queryCache({ resource: 'decisions', category: 'sleep' }, h.deps);
    expect(sleep.rows).toHaveLength(1);

    const lifestyle = await queryCache(
      { resource: 'decisions', category: 'lifestyle' },
      h.deps,
    );
    expect(lifestyle.rows).toHaveLength(1);
  });
});

describe('services/cache — limit clamp + truncation semantics (D-24)', () => {
  let h: Harness;
  beforeEach(() => {
    cycleSeq = 1;
    h = makeHarness();
  });
  afterEach(() => h.mem.close());

  it('Test 15: limit > 500 clamps to 500', async () => {
    // Seed exactly 501 cycles so the clamp behavior is observable.
    const cycles: Cycle[] = [];
    for (let i = 0; i < 501; i++) {
      const day = String((i % 28) + 1).padStart(2, '0');
      const hour = String(Math.floor(i / 28) % 24).padStart(2, '0');
      const minute = String(i % 60).padStart(2, '0');
      cycles.push({
        ...makeCycle({ start: `2026-04-${day}T${hour}:${minute}:00.000Z` }),
        id: i + 10_000,
      } as Cycle);
    }
    h.deps.repos.cycles.upsertBatch(cycles);
    const result = await queryCache({ resource: 'cycles', limit: 1000 }, h.deps);
    expect(result.rows).toHaveLength(500);
    expect(result.truncated).toBe(true);
  });

  it('Test 16: N rows === limit produces truncated=false', async () => {
    const cycles: Cycle[] = [];
    for (let i = 0; i < 10; i++) {
      cycles.push({
        ...makeCycle({ start: `2026-04-${String(10 + i).padStart(2, '0')}T08:00:00.000Z` }),
        id: i + 5_000,
      } as Cycle);
    }
    h.deps.repos.cycles.upsertBatch(cycles);
    const result = await queryCache({ resource: 'cycles', limit: 10 }, h.deps);
    expect(result.rows).toHaveLength(10);
    expect(result.truncated).toBe(false);
    expect(result.count).toBe(10);
  });

  it('Test 17: logger receives query_cache event with resource + count + truncated only (no PII)', async () => {
    const infoSpy = vi.fn();
    const stubbed: QueryCacheDeps = {
      ...h.deps,
      logger: { ...makeStubLogger(), info: infoSpy } as unknown as Logger,
    };
    h.deps.repos.decisions.insert({
      id: '01HK0000000000000000000099',
      createdAt: '2026-04-10T08:00:00.000Z',
      category: 'sleep',
      decision: 'private detail not to leak',
      rationale: null,
      confidence: null,
      expectedEffect: null,
      followUpDate: null,
    });
    await queryCache({ resource: 'decisions', status: 'open' }, stubbed);
    expect(infoSpy).toHaveBeenCalled();
    const [payload] = infoSpy.mock.calls[0] as [Record<string, unknown>];
    expect(payload.event).toBe('query_cache');
    expect(payload.resource).toBe('decisions');
    expect(typeof payload.count).toBe('number');
    expect(typeof payload.truncated).toBe('boolean');
    // Pitfall 17: decision text must NEVER appear in the structured payload.
    expect(JSON.stringify(payload)).not.toContain('private detail not to leak');
  });
});
