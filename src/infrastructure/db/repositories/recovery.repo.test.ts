// Recovery repository unit tests — compound-PK variant of the cycles.repo
// test pattern. Locks the compound-key upsert target, the
// byCycleAndSleep point-lookup, and the byRange JOIN-based exclusion on
// the parent cycle's baseline_excluded flag.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createInMemoryDb, type InMemoryDbResult } from '../../../../tests/helpers/in-memory-db.js';
import type { Cycle, Recovery } from '../../../domain/types/entities.js';
import { createCyclesRepo } from './cycles.repo.js';
import { createRecoveryRepo } from './recovery.repo.js';

// Helpers ---------------------------------------------------------------------

const SLEEP_1 = 'a712fd26-deab-4bec-9503-2cc6a8fbab3f';
const SLEEP_2 = 'bb8c0f52-773e-4875-820b-df64d972ff13';
const SLEEP_3 = 'eba87580-89d8-41b4-bd5c-386d2e1a3df1';

const BASE_USER_ID = 100001;

function makeScoredCycle(id: number, baselineExcluded = false): Cycle {
  return {
    id,
    userId: BASE_USER_ID,
    createdAt: '2026-05-13T08:00:00.000Z',
    updatedAt: '2026-05-13T20:00:00.000Z',
    start: '2026-05-13T07:00:00.000Z',
    end: '2026-05-14T07:00:00.000Z',
    timezoneOffset: '-08:00',
    scoreState: 'SCORED',
    strain: 12.0,
    kilojoule: 8300.0,
    averageHeartRate: 67,
    maxHeartRate: 176,
    baselineExcluded,
    exclusionReason: baselineExcluded ? 'dst_straddle' : null,
  };
}

function makeScoredRecovery(
  cycleId: number,
  sleepId: string,
  overrides: Partial<Recovery> = {},
): Recovery {
  return {
    cycleId,
    sleepId,
    userId: BASE_USER_ID,
    createdAt: '2026-05-13T08:30:00.000Z',
    updatedAt: '2026-05-13T20:30:00.000Z',
    scoreState: 'SCORED',
    recoveryScore: 68,
    restingHeartRate: 58,
    hrvRmssdMilli: 40.1,
    spo2Percentage: 96.5,
    skinTempCelsius: 33.0,
    userCalibrating: false,
    ...overrides,
  } as Recovery;
}

function makePendingRecovery(cycleId: number, sleepId: string): Recovery {
  return {
    cycleId,
    sleepId,
    userId: BASE_USER_ID,
    createdAt: '2026-05-14T08:30:00.000Z',
    updatedAt: '2026-05-14T08:30:00.000Z',
    scoreState: 'PENDING_SCORE',
  };
}

function makeUnscorableRecovery(cycleId: number, sleepId: string): Recovery {
  return {
    cycleId,
    sleepId,
    userId: BASE_USER_ID,
    createdAt: '2026-05-15T08:30:00.000Z',
    updatedAt: '2026-05-15T20:30:00.000Z',
    scoreState: 'UNSCORABLE',
  };
}

/** Seed parent cycle(s) so the FK from recoveries.cycle_id → cycles.id holds.
 *  WHOOP wire shape lets recoveries arrive before/after their parent cycle,
 *  but the schema's REFERENCES constraint requires the cycle row first. */
function seedCycles(mem: InMemoryDbResult, cycleIds: number[]): void {
  const cyclesRepo = createCyclesRepo(mem.db);
  cyclesRepo.upsertBatch(cycleIds.map((id) => makeScoredCycle(id)));
}

// Test suite ------------------------------------------------------------------

describe('recovery repo — cursor()', () => {
  let mem: InMemoryDbResult;

  beforeEach(() => {
    mem = createInMemoryDb();
  });

  afterEach(() => mem.close());

  it('Test 1: returns EPOCH_ZERO_ISO on empty table', () => {
    const repo = createRecoveryRepo(mem.db);
    expect(repo.cursor()).toBe('1970-01-01T00:00:00.000Z');
  });

  it('Test 2: returns MAX(updated_at) after upsert', () => {
    seedCycles(mem, [40001, 40002]);
    const repo = createRecoveryRepo(mem.db);
    repo.upsertBatch([
      makeScoredRecovery(40001, SLEEP_1, { updatedAt: '2026-05-13T20:00:00.000Z' }),
      makeScoredRecovery(40002, SLEEP_2, { updatedAt: '2026-05-15T08:00:00.000Z' }),
    ]);
    expect(repo.cursor()).toBe('2026-05-15T08:00:00.000Z');
  });
});

describe('recovery repo — compound-PK upsert (A12)', () => {
  let mem: InMemoryDbResult;

  beforeEach(() => {
    mem = createInMemoryDb();
  });

  afterEach(() => mem.close());

  it('Test 3: idempotent on (cycle_id, sleep_id) — re-upsert leaves row count unchanged', () => {
    seedCycles(mem, [40001]);
    const repo = createRecoveryRepo(mem.db);
    const recovery = makeScoredRecovery(40001, SLEEP_1);
    repo.upsertBatch([recovery]);
    repo.upsertBatch([recovery]);
    const count = (
      mem.sqlite.prepare('SELECT COUNT(*) AS c FROM recoveries').get() as { c: number }
    ).c;
    expect(count).toBe(1);
  });

  it('Test 4: ON CONFLICT(cycle_id, sleep_id) — second upsert updates the score in place', () => {
    seedCycles(mem, [40001]);
    const repo = createRecoveryRepo(mem.db);
    repo.upsertBatch([makeScoredRecovery(40001, SLEEP_1, { recoveryScore: 68 })]);
    repo.upsertBatch([makeScoredRecovery(40001, SLEEP_1, { recoveryScore: 81 })]);
    const stored = repo.byCycleAndSleep(40001, SLEEP_1);
    expect(stored).not.toBeNull();
    if (stored?.scoreState !== 'SCORED') throw new Error('expected SCORED');
    expect(stored.recoveryScore).toBe(81);
  });

  it('Test 5: distinct sleep_id with same cycle_id is a separate row (compound discriminator)', () => {
    seedCycles(mem, [40001]);
    const repo = createRecoveryRepo(mem.db);
    repo.upsertBatch([makeScoredRecovery(40001, SLEEP_1), makeScoredRecovery(40001, SLEEP_2)]);
    const count = (
      mem.sqlite.prepare('SELECT COUNT(*) AS c FROM recoveries').get() as { c: number }
    ).c;
    expect(count).toBe(2);
  });
});

describe('recovery repo — byCycleAndSleep() point lookup', () => {
  let mem: InMemoryDbResult;

  beforeEach(() => {
    mem = createInMemoryDb();
  });

  afterEach(() => mem.close());

  it('Test 6: happy path — both halves match', () => {
    seedCycles(mem, [40001]);
    const repo = createRecoveryRepo(mem.db);
    repo.upsertBatch([makeScoredRecovery(40001, SLEEP_1, { recoveryScore: 68 })]);
    const r = repo.byCycleAndSleep(40001, SLEEP_1);
    expect(r).not.toBeNull();
    if (r?.scoreState !== 'SCORED') throw new Error('expected SCORED');
    expect(r.recoveryScore).toBe(68);
  });

  it('Test 7: missing row returns null', () => {
    const repo = createRecoveryRepo(mem.db);
    expect(repo.byCycleAndSleep(40001, SLEEP_1)).toBeNull();
  });
});

describe('recovery repo — byRange() default filters (D-04 + D-16)', () => {
  let mem: InMemoryDbResult;

  beforeEach(() => {
    mem = createInMemoryDb();
  });

  afterEach(() => mem.close());

  it('Test 8: default filter excludes PENDING_SCORE and UNSCORABLE rows (D-04)', () => {
    seedCycles(mem, [40001, 40002, 40003]);
    const repo = createRecoveryRepo(mem.db);
    repo.upsertBatch([
      makeScoredRecovery(40001, SLEEP_1),
      makePendingRecovery(40002, SLEEP_2),
      makeUnscorableRecovery(40003, SLEEP_3),
    ]);
    const rows = repo.byRange('2026-05-01', '2026-05-31');
    expect(rows).toHaveLength(1);
    expect(rows[0]?.scoreState).toBe('SCORED');
  });

  it('Test 9: includeUnscored: true returns all 3', () => {
    seedCycles(mem, [40001, 40002, 40003]);
    const repo = createRecoveryRepo(mem.db);
    repo.upsertBatch([
      makeScoredRecovery(40001, SLEEP_1),
      makePendingRecovery(40002, SLEEP_2),
      makeUnscorableRecovery(40003, SLEEP_3),
    ]);
    const rows = repo.byRange('2026-05-01', '2026-05-31', { includeUnscored: true });
    expect(rows).toHaveLength(3);
  });

  it('Test 10: default filter excludes recoveries whose parent cycle has baseline_excluded = 1 (D-16, JOIN-based)', () => {
    // Cycle 40001 is clean; cycle 40002 is DST-flagged. The recovery on
    // cycle 40002 must be excluded from the default filter even though the
    // recovery row itself carries no baseline_excluded flag.
    const cyclesRepo = createCyclesRepo(mem.db);
    cyclesRepo.upsertBatch([makeScoredCycle(40001, false), makeScoredCycle(40002, true)]);
    const repo = createRecoveryRepo(mem.db);
    repo.upsertBatch([
      makeScoredRecovery(40001, SLEEP_1, { createdAt: '2026-05-13T08:30:00.000Z' }),
      makeScoredRecovery(40002, SLEEP_2, { createdAt: '2026-05-14T08:30:00.000Z' }),
    ]);
    const rows = repo.byRange('2026-05-01', '2026-05-31');
    expect(rows).toHaveLength(1);
    expect(rows[0]?.cycleId).toBe(40001);
  });

  it('Test 11: includeExcluded: true returns the DST-cycle recovery', () => {
    const cyclesRepo = createCyclesRepo(mem.db);
    cyclesRepo.upsertBatch([makeScoredCycle(40001, false), makeScoredCycle(40002, true)]);
    const repo = createRecoveryRepo(mem.db);
    repo.upsertBatch([
      makeScoredRecovery(40001, SLEEP_1, { createdAt: '2026-05-13T08:30:00.000Z' }),
      makeScoredRecovery(40002, SLEEP_2, { createdAt: '2026-05-14T08:30:00.000Z' }),
    ]);
    const rows = repo.byRange('2026-05-01', '2026-05-31', { includeExcluded: true });
    expect(rows).toHaveLength(2);
  });
});

describe('recovery repo — latestScoredDate() (Phase 5 Plan 05-01; Assumption A2)', () => {
  let mem: InMemoryDbResult;

  beforeEach(() => {
    mem = createInMemoryDb();
  });

  afterEach(() => mem.close());

  it('empty table returns null', () => {
    const repo = createRecoveryRepo(mem.db);
    expect(repo.latestScoredDate()).toBeNull();
  });

  it('single SCORED row returns the created_at date sliced to yyyy-mm-dd', () => {
    // Recoveries have no `start` on the wire (A4); created_at is the
    // recovery timestamp. The parent cycle must exist (FK) and be
    // non-excluded so the row survives the JOIN-based exclusion filter.
    seedCycles(mem, [40001]);
    const repo = createRecoveryRepo(mem.db);
    repo.upsertBatch([
      makeScoredRecovery(40001, SLEEP_1, { createdAt: '2026-04-15T07:00:00.000Z' }),
    ]);
    expect(repo.latestScoredDate()).toBe('2026-04-15');
  });

  it('a lone PENDING_SCORE row returns null (SCORED filter applies)', () => {
    seedCycles(mem, [40001]);
    const repo = createRecoveryRepo(mem.db);
    repo.upsertBatch([makePendingRecovery(40001, SLEEP_1)]);
    expect(repo.latestScoredDate()).toBeNull();
  });

  it('a SCORED row whose parent cycle is baseline_excluded returns null (exclusion filter applies)', () => {
    // Recoveries carry no baseline_excluded flag — exclusion is inherited
    // from the parent cycle via JOIN (D-14 + D-16). A SCORED recovery on a
    // DST-flagged cycle must NOT count toward latestScoredDate.
    const cyclesRepo = createCyclesRepo(mem.db);
    cyclesRepo.upsertBatch([makeScoredCycle(40001, true)]);
    const repo = createRecoveryRepo(mem.db);
    repo.upsertBatch([
      makeScoredRecovery(40001, SLEEP_1, { createdAt: '2026-04-15T07:00:00.000Z' }),
    ]);
    expect(repo.latestScoredDate()).toBeNull();
  });
});

describe('recovery repo — countByScoreState() (Phase 5 Plan 05-01; Assumption A3)', () => {
  let mem: InMemoryDbResult;

  beforeEach(() => {
    mem = createInMemoryDb();
  });

  afterEach(() => mem.close());

  // Distinct sleep UUIDs for the 6-row census (SLEEP_1..3 are reused above).
  const SLEEP_4 = 'c0ffee00-0000-4000-8000-000000000004';
  const SLEEP_5 = 'c0ffee00-0000-4000-8000-000000000005';
  const SLEEP_6 = 'c0ffee00-0000-4000-8000-000000000006';

  it('empty table returns all-zero counts', () => {
    const repo = createRecoveryRepo(mem.db);
    expect(repo.countByScoreState()).toEqual({
      scored: 0,
      pending: 0,
      unscorable: 0,
      excluded: 0,
    });
  });

  it('censuses 3 SCORED + 1 PENDING + 1 UNSCORABLE + 1 SCORED-excluded (exclusion via parent cycle)', () => {
    // Recoveries carry no own baseline_excluded — the "excluded" recovery is
    // a SCORED recovery whose PARENT cycle is baseline_excluded. Seed cycles
    // 40001..40005 clean + 40006 DST-flagged; one recovery per cycle.
    const cyclesRepo = createCyclesRepo(mem.db);
    cyclesRepo.upsertBatch([
      makeScoredCycle(40001, false),
      makeScoredCycle(40002, false),
      makeScoredCycle(40003, false),
      makeScoredCycle(40004, false),
      makeScoredCycle(40005, false),
      makeScoredCycle(40006, true),
    ]);
    const repo = createRecoveryRepo(mem.db);
    repo.upsertBatch([
      makeScoredRecovery(40001, SLEEP_1),
      makeScoredRecovery(40002, SLEEP_2),
      makeScoredRecovery(40003, SLEEP_3),
      makePendingRecovery(40004, SLEEP_4),
      makeUnscorableRecovery(40005, SLEEP_5),
      makeScoredRecovery(40006, SLEEP_6),
    ]);
    expect(repo.countByScoreState()).toEqual({
      scored: 3,
      pending: 1,
      unscorable: 1,
      excluded: 1,
    });
  });
});

describe('recovery repo — getRawJson() compound-key seam (D-29)', () => {
  let mem: InMemoryDbResult;

  beforeEach(() => {
    mem = createInMemoryDb();
  });

  afterEach(() => mem.close());

  it('Test 12: returns stored raw_json on compound key; null on miss', () => {
    seedCycles(mem, [40001]);
    const repo = createRecoveryRepo(mem.db);
    const entityWithRaw = makeScoredRecovery(40001, SLEEP_1) as Recovery & { rawJson: string };
    entityWithRaw.rawJson = '{"cycle_id":40001}';
    repo.upsertBatch([entityWithRaw]);
    expect(repo.getRawJson(40001, SLEEP_1)).toBe('{"cycle_id":40001}');
    expect(repo.getRawJson(99999, SLEEP_1)).toBeNull();
    expect(repo.getRawJson(40001, 'no-such-sleep-uuid')).toBeNull();
  });
});
