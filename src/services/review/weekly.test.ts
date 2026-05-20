// getWeeklyReview tests — composes detectWeeklyPattern + buildDataStatus
// + decisionsRepo.countSince into WeeklyReviewResult per D-16.
//
// Anchors locked here:
//   - D-12 trailing-28 pattern window distinct from D-17 trailing-7
//   - REV-07 BH-FDR-suppression-as-typed-positive-output (no_factor_cleared_fdr)
//   - D-22 / DEC-04 decision_prompt dual-mode (silent vs none_this_week)
//   - D-34 pattern_confidence flows through the pattern slot
//   - D-35 fixture split (suppression vs partial rejection)

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Logger } from 'pino';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  expandWeeklyFixture,
  type WeeklyFixtureSpec,
} from '../../../tests/fixtures/review/_generators/weekly.js';
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
  createDecisionsRepo,
  type DecisionsRepo,
} from '../../infrastructure/db/repositories/decisions.repo.js';
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
import { getWeeklyReview, type WeeklyReviewDeps } from './weekly.js';

const FIXTURES_DIR = resolve(__dirname, '../../../tests/fixtures/review');

function loadWeeklyFixture(name: string): WeeklyFixtureSpec {
  const path = resolve(FIXTURES_DIR, `${name}.json`);
  return JSON.parse(readFileSync(path, 'utf-8')) as WeeklyFixtureSpec;
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
  deps: WeeklyReviewDeps;
  repos: {
    cycles: CyclesRepo;
    recoveries: RecoveryRepo;
    sleeps: SleepsRepo;
    workouts: WorkoutsRepo;
    profile: ProfileRepo;
    bodyMeasurements: BodyMeasurementsRepo;
    syncRuns: SyncRunsRepo;
    decisions: DecisionsRepo;
    dailySummaries: DailySummariesRepo;
  };
}

function makeHarness(opts?: { clock?: () => Date; ianaZone?: string }): Harness {
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
    dailySummaries: createDailySummariesRepo(mem.db),
  };
  const deps: WeeklyReviewDeps = {
    repos,
    clock: opts?.clock ?? (() => new Date('2026-03-15T15:00:00.000Z')),
    ianaZone: () => opts?.ianaZone ?? 'America/Los_Angeles',
    logger: makeStubLogger(),
  };
  return { mem, deps, repos };
}

function loadIntoDb(h: Harness, spec: WeeklyFixtureSpec): void {
  const { cycles, recoveries, sleeps, workouts } = expandWeeklyFixture(spec);
  h.repos.cycles.upsertBatch(cycles);
  h.repos.recoveries.upsertBatch(recoveries);
  h.repos.sleeps.upsertBatch(sleeps);
  h.repos.workouts.upsertBatch(workouts);
}

describe('getWeeklyReview — insufficient_window_days path (pattern.ts < 14 cycles guard)', () => {
  let h: Harness;
  beforeEach(() => {
    h = makeHarness();
  });
  afterEach(() => h.mem.close());

  it('Test 1: 10 SCORED cycles → pattern.kind=no_pattern, reason=insufficient_window_days', async () => {
    const spec = loadWeeklyFixture('weekly-no-pattern-insufficient-window');
    loadIntoDb(h, spec);
    const result = await getWeeklyReview({ date: spec.reviewed_date }, h.deps);
    expect(result.pattern.kind).toBe('no_pattern');
    if (result.pattern.kind !== 'no_pattern') throw new Error('narrow');
    expect(result.pattern.reason).toBe('insufficient_window_days');
    expect(result.candidate_results).toEqual([]);
  });
});

describe('getWeeklyReview — REV-07 BH-FDR-suppression load-bearing fixture (D-35)', () => {
  let h: Harness;
  beforeEach(() => {
    h = makeHarness();
  });
  afterEach(() => h.mem.close());

  it('Test 2: subtle separation → BH suppresses → pattern.kind=no_pattern, reason=no_factor_cleared_fdr', async () => {
    const spec = loadWeeklyFixture('weekly-pattern-fdr-suppression');
    loadIntoDb(h, spec);
    const result = await getWeeklyReview({ date: spec.reviewed_date }, h.deps);
    expect(result.pattern.kind).toBe('no_pattern');
    if (result.pattern.kind !== 'no_pattern') throw new Error('narrow');
    expect(result.pattern.reason).toBe('no_factor_cleared_fdr');
    expect(result.candidate_results.length).toBe(5);
    // None cleared FDR.
    expect(result.candidate_results.filter((c) => c.cleared).length).toBe(0);
  });
});

describe('getWeeklyReview — pattern-clears-FDR happy path (REV-06)', () => {
  let h: Harness;
  beforeEach(() => {
    h = makeHarness();
  });
  afterEach(() => h.mem.close());

  it('Test 3: large sleep-duration separation → pattern.kind=detected, factor=sleep_duration_prior_night', async () => {
    const spec = loadWeeklyFixture('weekly-pattern-clears-fdr');
    loadIntoDb(h, spec);
    const result = await getWeeklyReview({ date: spec.reviewed_date }, h.deps);
    expect(result.pattern.kind).toBe('detected');
    if (result.pattern.kind !== 'detected') throw new Error('narrow');
    expect(result.pattern.factor).toBe('sleep_duration_prior_night');
    expect(result.pattern.pattern_confidence).toBe('strong'); // N=22 ≥ 20
    expect(result.pattern.direction).toBe('worst_days_had_lower');
  });
});

describe('getWeeklyReview — D-35 partial-rejection path (D-18 multi-detection winner)', () => {
  let h: Harness;
  beforeEach(() => {
    h = makeHarness();
  });
  afterEach(() => h.mem.close());

  it('Test 4: 2+ candidates clear FDR → pattern reports smallest p_adjusted winner', async () => {
    const spec = loadWeeklyFixture('weekly-pattern-partial-rejection');
    loadIntoDb(h, spec);
    const result = await getWeeklyReview({ date: spec.reviewed_date }, h.deps);
    expect(result.pattern.kind).toBe('detected');
    if (result.pattern.kind !== 'detected') throw new Error('narrow');
    expect(result.pattern.pattern_confidence).toBe('strong');
    // Review #16: tighten the cleared-count assertion. The fixture
    // engineers two candidates (sleep_duration_short, strain_high_prior_day)
    // with strong signal, so the partial-rejection BH path must yield at
    // least 2 cleared candidates — not the previous bare `>= 1`.
    const cleared = result.candidate_results.filter((c) => c.cleared);
    expect(cleared.length).toBeGreaterThanOrEqual(2);
    // D-18 multi-detection: the reported pattern factor must equal the
    // cleared candidate with the smallest p_adjusted.
    const winner = cleared.reduce((min, c) =>
      (c.p_adjusted ?? Number.POSITIVE_INFINITY) <
      (min.p_adjusted ?? Number.POSITIVE_INFINITY)
        ? c
        : min,
    );
    expect(result.pattern.factor).toBe(winner.factor);
  });
});

describe('getWeeklyReview — DEC-04 decision_prompt slot (D-22)', () => {
  let h: Harness;
  beforeEach(() => {
    h = makeHarness();
  });
  afterEach(() => h.mem.close());

  it("Test 5: zero decisions in last 7d → decision_prompt.kind='none_this_week' + suggested_text", async () => {
    const spec = loadWeeklyFixture('weekly-decision-prompt-none-this-week');
    loadIntoDb(h, spec);
    const result = await getWeeklyReview({ date: spec.reviewed_date }, h.deps);
    expect(result.decision_prompt.kind).toBe('none_this_week');
    if (result.decision_prompt.kind !== 'none_this_week') throw new Error('narrow');
    expect(result.decision_prompt.suggested_text).toBeTruthy();
    expect(typeof result.decision_prompt.suggested_text).toBe('string');
  });

  it("Test 6: 1+ decision in last 7d → decision_prompt.kind='silent'", async () => {
    const spec = loadWeeklyFixture('weekly-decision-prompt-none-this-week');
    loadIntoDb(h, spec);
    // Insert a decision dated 2026-03-13 (within last 7 days of reviewed_date 03-15).
    h.repos.decisions.insert({
      id: '01HK7XYZABCD0001234567890A',
      createdAt: '2026-03-13T10:00:00.000Z',
      category: 'sleep',
      decision: 'sleep at least seven hours on training days',
      rationale: null,
      confidence: null,
      expectedEffect: null,
      followUpDate: null,
    });
    const result = await getWeeklyReview({ date: spec.reviewed_date }, h.deps);
    expect(result.decision_prompt.kind).toBe('silent');
  });
});

describe('getWeeklyReview — D-12 + D-17 windows kept distinct in data_status', () => {
  let h: Harness;
  beforeEach(() => {
    h = makeHarness();
  });
  afterEach(() => h.mem.close());

  it('Test 7: data_status carries week_start (D-17 trailing-7) AND pattern_test_window (D-12 trailing-28) distinctly', async () => {
    const spec = loadWeeklyFixture('weekly-decision-prompt-none-this-week');
    loadIntoDb(h, spec);
    const result = await getWeeklyReview({ date: spec.reviewed_date }, h.deps);
    // reviewed_date = 2026-03-15
    // trailing-7 → week_start = 2026-03-09
    // trailing-28 → pattern_test_window.start = 2026-02-16
    expect(result.data_status.week_start).toBe('2026-03-09');
    expect(result.data_status.week_end).toBe('2026-03-15');
    expect(result.data_status.pattern_test_window.start).toBe('2026-02-16');
    expect(result.data_status.pattern_test_window.end).toBe('2026-03-15');
    // Critical: the two windows are NOT the same.
    expect(result.data_status.week_start).not.toBe(result.data_status.pattern_test_window.start);
  });
});

describe('getWeeklyReview — reproducibility across clocks', () => {
  let h: Harness;
  beforeEach(() => {
    h = makeHarness();
  });
  afterEach(() => h.mem.close());

  it('Test 8: same fixture + same --date → identical pattern + candidate_results across clock advances', async () => {
    const spec = loadWeeklyFixture('weekly-pattern-clears-fdr');
    loadIntoDb(h, spec);
    const r1 = await getWeeklyReview({ date: spec.reviewed_date }, h.deps);

    const h2 = makeHarness({ clock: () => new Date('2030-01-01T00:00:00.000Z') });
    loadIntoDb(h2, spec);
    const r2 = await getWeeklyReview({ date: spec.reviewed_date }, h2.deps);
    h2.mem.close();

    expect(r1.pattern).toEqual(r2.pattern);
    expect(r1.candidate_results).toEqual(r2.candidate_results);
    expect(r1.week_summary).toEqual(r2.week_summary);
  });
});
