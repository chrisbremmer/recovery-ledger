// resolveReviewedDate tests — D-01 (latest_scored | cli_flag | fallback_today)
// + D-02/D-12/D-17 reproducibility anchor (the resolved date is the single
// anchor for the trailing-30 baseline window, the trailing-28 pattern test,
// and the trailing-7 week summary — all three windows derive from THIS
// function's output, not from wall-clock today, so re-running with the
// same input.date yields identical results).
//
// Each test starts from a fresh in-memory DB so the SCORED-cycle precondition
// can be controlled per case.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createInMemoryDb, type InMemoryDbResult } from '../../../tests/helpers/in-memory-db.js';
import type { Cycle } from '../../domain/types/entities.js';
import {
  type CyclesRepo,
  createCyclesRepo,
} from '../../infrastructure/db/repositories/cycles.repo.js';
import { resolveReviewedDate } from './resolve-date.js';

const FIXED_NOW = new Date('2026-05-20T15:00:00.000Z');
const FIXED_CLOCK = (): Date => FIXED_NOW;

function makeScoredCycle(id: number, startISO: string): Cycle {
  return {
    id,
    userId: 99,
    createdAt: startISO,
    updatedAt: startISO,
    start: startISO,
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

function makeExcludedScoredCycle(id: number, startISO: string): Cycle {
  return {
    ...(makeScoredCycle(id, startISO) as Cycle & { scoreState: 'SCORED' }),
    baselineExcluded: true,
    exclusionReason: 'dst_straddle',
  };
}

function makePendingCycle(id: number, startISO: string): Cycle {
  return {
    id,
    userId: 99,
    createdAt: startISO,
    updatedAt: startISO,
    start: startISO,
    end: null,
    timezoneOffset: '-07:00',
    baselineExcluded: false,
    exclusionReason: null,
    scoreState: 'PENDING_SCORE',
  };
}

interface Harness {
  mem: InMemoryDbResult;
  cycles: CyclesRepo;
  deps: { repos: { cycles: CyclesRepo }; clock: () => Date };
}

function makeHarness(): Harness {
  const mem = createInMemoryDb();
  const cycles = createCyclesRepo(mem.db);
  return { mem, cycles, deps: { repos: { cycles }, clock: FIXED_CLOCK } };
}

describe('resolveReviewedDate — D-01 anchor for D-02 / D-12 / D-17', () => {
  let h: Harness;

  beforeEach(() => {
    h = makeHarness();
  });
  afterEach(() => h.mem.close());

  it("Test 1: input.date='2026-03-15' (valid ISO) returns {date, source: 'cli_flag'} verbatim", async () => {
    const result = await resolveReviewedDate({ date: '2026-03-15' }, h.deps);
    expect(result).toEqual({ date: '2026-03-15', source: 'cli_flag' });
  });

  it('Test 2: invalid input.date string throws (CLI parse-layer must catch it before the service)', async () => {
    await expect(resolveReviewedDate({ date: 'not-a-date' }, h.deps)).rejects.toThrow();
    await expect(resolveReviewedDate({ date: '2026-13-40' }, h.deps)).rejects.toThrow();
    await expect(resolveReviewedDate({ date: '2026/03/15' }, h.deps)).rejects.toThrow();
  });

  it("Test 3: empty DB + no input.date falls back to clock() → source='fallback_today'", async () => {
    const result = await resolveReviewedDate({}, h.deps);
    expect(result).toEqual({ date: '2026-05-20', source: 'fallback_today' });
  });

  it("Test 4: DB with 5 SCORED cycles ending 2026-03-10 returns {date:'2026-03-10', source:'latest_scored'}", async () => {
    h.cycles.upsertBatch([
      makeScoredCycle(1, '2026-03-06T07:00:00.000Z'),
      makeScoredCycle(2, '2026-03-07T07:00:00.000Z'),
      makeScoredCycle(3, '2026-03-08T07:00:00.000Z'),
      makeScoredCycle(4, '2026-03-09T07:00:00.000Z'),
      makeScoredCycle(5, '2026-03-10T07:00:00.000Z'),
    ]);
    const result = await resolveReviewedDate({}, h.deps);
    expect(result).toEqual({ date: '2026-03-10', source: 'latest_scored' });
  });

  it('Test 5: a SCORED cycle with baseline_excluded=1 is NOT returned (default-filter discipline)', async () => {
    h.cycles.upsertBatch([
      makeScoredCycle(1, '2026-03-05T07:00:00.000Z'),
      makeExcludedScoredCycle(2, '2026-03-15T07:00:00.000Z'), // newer but excluded
    ]);
    const result = await resolveReviewedDate({}, h.deps);
    expect(result.source).toBe('latest_scored');
    expect(result.date).toBe('2026-03-05');
  });

  it('Test 6: only PENDING_SCORE cycles in DB → falls back to clock()', async () => {
    h.cycles.upsertBatch([
      makePendingCycle(1, '2026-03-10T07:00:00.000Z'),
      makePendingCycle(2, '2026-03-11T07:00:00.000Z'),
    ]);
    const result = await resolveReviewedDate({}, h.deps);
    expect(result).toEqual({ date: '2026-05-20', source: 'fallback_today' });
  });

  it('Test 7: D-02 reproducibility — same input.date returns the same output under any clock within the ±bound window', async () => {
    // Original test used a 4-year-future clock to assert clock independence.
    // With the #33 bounds in place, a clock that pushes input.date outside
    // ±(MAX_FUTURE_DAYS today, MAX_PAST_DAYS today) IS expected to throw —
    // that's the bounds feature, not a reproducibility violation. Restate
    // the invariant: within the window, the resolved value is identical
    // regardless of clock position. Both clocks below keep '2026-03-15'
    // inside the 365-day past window.
    const r1 = await resolveReviewedDate({ date: '2026-03-15' }, h.deps);
    const r2 = await resolveReviewedDate(
      { date: '2026-03-15' },
      { ...h.deps, clock: () => new Date('2026-08-01T00:00:00.000Z') },
    );
    expect(r1).toEqual(r2);
  });

  it('Test 8: returns yyyy-mm-dd, not ISO-with-time (D-01 truncation discipline)', async () => {
    h.cycles.upsertBatch([makeScoredCycle(1, '2026-03-10T07:30:45.000Z')]);
    const result = await resolveReviewedDate({}, h.deps);
    expect(result.date).toBe('2026-03-10');
    expect(result.date).toHaveLength(10);
  });
});

// #33 — bound `--date` input. Future / ancient dates throw at the
// resolver boundary instead of silently rendering an empty review.
describe('resolveReviewedDate — #33 date bounds', () => {
  it('rejects --date more than 1 day in the future', async () => {
    const h = makeHarness();
    await expect(resolveReviewedDate({ date: '2026-05-23' }, h.deps)).rejects.toThrow(/future/i);
  });

  it('accepts --date exactly today (no future violation)', async () => {
    const h = makeHarness();
    const result = await resolveReviewedDate({ date: '2026-05-20' }, h.deps);
    expect(result).toEqual({ date: '2026-05-20', source: 'cli_flag' });
  });

  it('accepts --date exactly today + 1 (within bound)', async () => {
    const h = makeHarness();
    const result = await resolveReviewedDate({ date: '2026-05-21' }, h.deps);
    expect(result).toEqual({ date: '2026-05-21', source: 'cli_flag' });
  });

  it('rejects --date more than 365 days in the past', async () => {
    const h = makeHarness();
    await expect(resolveReviewedDate({ date: '2024-01-01' }, h.deps)).rejects.toThrow(/past/i);
  });

  it('accepts --date within the 365-day past bound', async () => {
    const h = makeHarness();
    const result = await resolveReviewedDate({ date: '2025-06-15' }, h.deps);
    expect(result).toEqual({ date: '2025-06-15', source: 'cli_flag' });
  });
});
