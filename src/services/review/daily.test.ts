// getDailyReview tests — composes Wave 1 domain + Phase 3 repos +
// buildDataStatus + resolveReviewedDate into DailyReviewResult per D-03.
//
// Anchors locked here:
//   - REV-04 (data_status is the FIRST slot of the result)
//   - REV-05 + D-10 (insufficient → empty anomalies/actions/patterns +
//                    populated insufficient_reason — all four atomic)
//   - D-02 (trailing-30 from reviewed_date — reproducible across re-runs)
//   - D-07 (patterns: [] always in v1)
//   - D-08 (selectActions capped at 3)
//   - Pitfall 5 (per-metric daysAvailable)

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Logger } from 'pino';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  type DailyFixtureSpec,
  expandDailyFixture,
} from '../../../tests/fixtures/review/_generators/daily.js';
import { createInMemoryDb, type InMemoryDbResult } from '../../../tests/helpers/in-memory-db.js';
import {
  type BodyMeasurementsRepo,
  createBodyMeasurementsRepo,
} from '../../infrastructure/db/repositories/body-measurements.repo.js';
import {
  type CyclesRepo,
  createCyclesRepo,
} from '../../infrastructure/db/repositories/cycles.repo.js';
import {
  createDailySummariesRepo,
  type DailySummariesRepo,
} from '../../infrastructure/db/repositories/daily-summaries.repo.js';
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
import { type DailyReviewDeps, getDailyReview } from './daily.js';

const FIXTURES_DIR = resolve(__dirname, '../../../tests/fixtures/review');

function loadDailyFixture(name: string): DailyFixtureSpec {
  const path = resolve(FIXTURES_DIR, `${name}.json`);
  const raw = readFileSync(path, 'utf-8');
  return JSON.parse(raw) as DailyFixtureSpec;
}

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
  deps: DailyReviewDeps;
  repos: {
    cycles: CyclesRepo;
    recoveries: RecoveryRepo;
    sleeps: SleepsRepo;
    workouts: WorkoutsRepo;
    profile: ProfileRepo;
    bodyMeasurements: BodyMeasurementsRepo;
    syncRuns: SyncRunsRepo;
    dailySummaries: DailySummariesRepo;
  };
}

function makeHarness(clock?: () => Date): Harness {
  const mem = createInMemoryDb();
  const repos = {
    cycles: createCyclesRepo(mem.db),
    recoveries: createRecoveryRepo(mem.db),
    sleeps: createSleepsRepo(mem.db),
    workouts: createWorkoutsRepo(mem.db),
    profile: createProfileRepo(mem.db),
    bodyMeasurements: createBodyMeasurementsRepo(mem.db),
    syncRuns: createSyncRunsRepo(mem.db),
    dailySummaries: createDailySummariesRepo(mem.db),
  };
  const deps: DailyReviewDeps = {
    repos,
    clock: clock ?? (() => new Date('2026-03-15T15:00:00.000Z')),
    logger: makeStubLogger(),
  };
  return { mem, deps, repos };
}

function loadIntoDb(harness: Harness, spec: DailyFixtureSpec): void {
  const { cycles, recoveries, sleeps } = expandDailyFixture(spec);
  harness.repos.cycles.upsertBatch(cycles);
  harness.repos.recoveries.upsertBatch(recoveries);
  harness.repos.sleeps.upsertBatch(sleeps);
}

describe('getDailyReview — fixture corpus', () => {
  let h: Harness;
  beforeEach(() => {
    h = makeHarness();
  });
  afterEach(() => h.mem.close());

  it('Test 1: daily-strong-confidence fixture → tier=strong, anomalies=[], actions=[], patterns=[]', async () => {
    const spec = loadDailyFixture('daily-strong-confidence');
    loadIntoDb(h, spec);
    const result = await getDailyReview({ date: spec.reviewed_date }, h.deps);
    expect(result.confidence.tier).toBe('strong');
    expect(result.confidence.sampleSize).toBe(22);
    expect(result.anomalies).toEqual([]);
    expect(result.actions).toEqual([]);
    expect(result.patterns).toEqual([]); // D-07
    expect(result.insufficient_reason).toBeNull();
    expect(result.data_status.reviewed_date).toBe(spec.reviewed_date);
    expect(result.data_status.baseline_window.scored_day_count).toBe(22);
  });

  it('Test 2: daily-weak-confidence fixture → tier=weak, scored_day_count=15, anomalies=[]', async () => {
    const spec = loadDailyFixture('daily-weak-confidence');
    loadIntoDb(h, spec);
    const result = await getDailyReview({ date: spec.reviewed_date }, h.deps);
    expect(result.confidence.tier).toBe('weak');
    expect(result.confidence.sampleSize).toBe(15);
    expect(result.anomalies).toEqual([]);
    expect(result.actions).toEqual([]);
    expect(result.patterns).toEqual([]);
    expect(result.insufficient_reason).toBeNull();
  });

  it('Test 3: daily-insufficient-days → REV-05 + D-10 atomic typed positive output', async () => {
    const spec = loadDailyFixture('daily-insufficient-days');
    loadIntoDb(h, spec);
    const result = await getDailyReview({ date: spec.reviewed_date }, h.deps);
    // All FOUR conditions hold atomically per D-10:
    expect(result.confidence.tier).toBe('insufficient');
    expect(result.anomalies).toEqual([]); // (a)
    expect(result.actions).toEqual([]); // (b)
    expect(result.patterns).toEqual([]); // (c) D-07
    expect(result.insufficient_reason).not.toBeNull(); // (d)
    expect(result.insufficient_reason).toMatch(/8 SCORED days/);
    expect(result.insufficient_reason).toMatch(/need 10 minimum/);
    // Today_state is still populated (today is one of the 8 SCORED days):
    expect(result.today_state.hrv_rmssd_milli).not.toBeNull();
  });

  it('Test 4: daily-no-anomalies → 25 scored days, all-near-median → 0 anomalies', async () => {
    const spec = loadDailyFixture('daily-no-anomalies');
    loadIntoDb(h, spec);
    const result = await getDailyReview({ date: spec.reviewed_date }, h.deps);
    expect(result.confidence.tier).toBe('strong');
    expect(result.confidence.sampleSize).toBe(25);
    expect(result.anomalies).toEqual([]);
    expect(result.actions).toEqual([]);
    expect(result.patterns).toEqual([]);
    expect(result.insufficient_reason).toBeNull();
  });

  it('Test 5: daily-three-anomalies-capped → 4 anomalies fire, actions cap at 3 (D-08)', async () => {
    const spec = loadDailyFixture('daily-three-anomalies-capped');
    loadIntoDb(h, spec);
    const result = await getDailyReview({ date: spec.reviewed_date }, h.deps);
    expect(result.confidence.tier).toBe('strong');
    expect(result.anomalies.length).toBeGreaterThanOrEqual(3);
    expect(result.actions).toHaveLength(3); // D-08 cap
    expect(result.patterns).toEqual([]);
    // Verify the anomaly directions make sense for the engineered today_override
    const hrvAnomaly = result.anomalies.find((a) => a.metric === 'hrv_rmssd_milli');
    expect(hrvAnomaly?.direction).toBe('low');
    const rhrAnomaly = result.anomalies.find((a) => a.metric === 'resting_heart_rate');
    expect(rhrAnomaly?.direction).toBe('high');
  });
});

describe('getDailyReview — REV-04 lead-with-data-freshness anchor', () => {
  let h: Harness;
  beforeEach(() => {
    h = makeHarness();
  });
  afterEach(() => h.mem.close());

  it('Test 6: data_status is populated before any other slot — always present in output', async () => {
    const spec = loadDailyFixture('daily-strong-confidence');
    loadIntoDb(h, spec);
    const result = await getDailyReview({ date: spec.reviewed_date }, h.deps);
    expect(result.data_status).toBeDefined();
    expect(result.data_status.reviewed_date).toBeDefined();
    expect(result.data_status.baseline_window).toBeDefined();
    expect(result.data_status.missing_resources).toBeInstanceOf(Array);
  });

  it('Test 7: REV-04 — data_status is the FIRST property of the returned object', async () => {
    const spec = loadDailyFixture('daily-strong-confidence');
    loadIntoDb(h, spec);
    const result = await getDailyReview({ date: spec.reviewed_date }, h.deps);
    const keys = Object.keys(result);
    expect(keys[0]).toBe('data_status');
    expect(keys[1]).toBe('today_state');
  });
});

describe('getDailyReview — D-02 reproducibility anchor', () => {
  let h: Harness;
  beforeEach(() => {
    h = makeHarness();
  });
  afterEach(() => h.mem.close());

  it('Test 8: same fixture + same --date returns identical confidence + anomalies under any clock within the #33 bounds window', async () => {
    const spec = loadDailyFixture('daily-no-anomalies');
    loadIntoDb(h, spec);
    const r1 = await getDailyReview({ date: spec.reviewed_date }, h.deps);
    // #33 bound: clocks > 365d after spec.reviewed_date now reject the
    // --date as "too far in the past". Use a clock ~4 months later — still
    // proves "anchored at reviewed_date, not today" without leaving the
    // window. D-02 anchor.
    const h2 = makeHarness(() => new Date('2026-09-01T00:00:00.000Z'));
    loadIntoDb(h2, spec);
    const r2 = await getDailyReview({ date: spec.reviewed_date }, h2.deps);
    h2.mem.close();
    expect(r1.confidence).toEqual(r2.confidence);
    expect(r1.anomalies).toEqual(r2.anomalies);
    expect(r1.actions).toEqual(r2.actions);
    expect(r1.data_status.baseline_window).toEqual(r2.data_status.baseline_window);
  });
});

describe('getDailyReview — D-07 patterns always-empty slot', () => {
  let h: Harness;
  beforeEach(() => {
    h = makeHarness();
  });
  afterEach(() => h.mem.close());

  it('Test 9: every fixture (strong, weak, insufficient, no-anomalies, capped) returns patterns: []', async () => {
    const fixtures = [
      'daily-strong-confidence',
      'daily-weak-confidence',
      'daily-insufficient-days',
      'daily-no-anomalies',
      'daily-three-anomalies-capped',
    ];
    for (const name of fixtures) {
      const harness = makeHarness();
      const spec = loadDailyFixture(name);
      loadIntoDb(harness, spec);
      const result = await getDailyReview({ date: spec.reviewed_date }, harness.deps);
      expect(result.patterns).toEqual([]);
      harness.mem.close();
    }
  });
});

describe('getDailyReview — Pitfall 5 per-metric daysAvailable', () => {
  let h: Harness;
  beforeEach(() => {
    h = makeHarness();
  });
  afterEach(() => h.mem.close());

  it('Test 10: bidirectional day_strain never fires as an anomaly even when z>=2', async () => {
    // Use the capped fixture which has engineered today metrics; verify
    // day_strain (bidirectional) is not in the anomalies list regardless
    // of how today's value compares to the baseline.
    const spec = loadDailyFixture('daily-three-anomalies-capped');
    loadIntoDb(h, spec);
    const result = await getDailyReview({ date: spec.reviewed_date }, h.deps);
    const strainAnomaly = result.anomalies.find((a) => a.metric === 'day_strain');
    expect(strainAnomaly).toBeUndefined();
    const spo2Anomaly = result.anomalies.find((a) => a.metric === 'spo2_percentage');
    expect(spo2Anomaly).toBeUndefined();
  });
});

describe('getDailyReview — memoization side effect', () => {
  let h: Harness;
  beforeEach(() => {
    h = makeHarness();
  });
  afterEach(() => h.mem.close());

  it('Test 11: after getDailyReview returns, daily_summaries has rows for cycles in the window', async () => {
    const spec = loadDailyFixture('daily-strong-confidence');
    loadIntoDb(h, spec);
    await getDailyReview({ date: spec.reviewed_date }, h.deps);
    const summaries = h.repos.dailySummaries.byDateRange('2026-02-14', '2026-03-15');
    expect(summaries.length).toBe(spec.scored_cycle_dates.length);
    // Each summary carries the metric values for the corresponding date.
    const summary = summaries.find((s) => s.date === spec.reviewed_date);
    expect(summary).toBeDefined();
    expect(summary?.recoveryScore).toBe(spec.metric_overrides.default_recovery_score);
  });
});
