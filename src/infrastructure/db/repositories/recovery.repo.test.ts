// Recovery repository unit tests — compound-PK variant of the cycles.repo
// test pattern. Locks the compound-key upsert target, the
// byCycleAndSleep point-lookup, and the byRange JOIN-based exclusion on
// the parent cycle's baseline_excluded flag.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createInMemoryDb, type InMemoryDbResult } from '../../../../tests/helpers/in-memory-db.js';
import { createCyclesRepo, type CycleUpsertRow } from './cycles.repo.js';
import { createRecoveryRepo, type RecoveryUpsertRow } from './recovery.repo.js';

// Helpers ---------------------------------------------------------------------

const SLEEP_1 = 'a712fd26-deab-4bec-9503-2cc6a8fbab3f';
const SLEEP_2 = 'bb8c0f52-773e-4875-820b-df64d972ff13';
const SLEEP_3 = 'eba87580-89d8-41b4-bd5c-386d2e1a3df1';

const BASE_USER_ID = 100001;

// Factories return upsert-shaped rows (entity + rawJson default '{}') so
// test sites can pass them straight to upsertBatch without per-call wrappers.

function makeScoredCycle(id: number, baselineExcluded = false): CycleUpsertRow {
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
    rawJson: '{}',
  };
}

function makeScoredRecovery(
  cycleId: number,
  sleepId: string,
  overrides: Partial<RecoveryUpsertRow> = {},
): RecoveryUpsertRow {
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
    rawJson: '{}',
    ...overrides,
  } as RecoveryUpsertRow;
}

function makePendingRecovery(cycleId: number, sleepId: string): RecoveryUpsertRow {
  return {
    cycleId,
    sleepId,
    userId: BASE_USER_ID,
    createdAt: '2026-05-14T08:30:00.000Z',
    updatedAt: '2026-05-14T08:30:00.000Z',
    scoreState: 'PENDING_SCORE',
    rawJson: '{}',
  };
}

function makeUnscorableRecovery(cycleId: number, sleepId: string): RecoveryUpsertRow {
  return {
    cycleId,
    sleepId,
    userId: BASE_USER_ID,
    createdAt: '2026-05-15T08:30:00.000Z',
    updatedAt: '2026-05-15T20:30:00.000Z',
    scoreState: 'UNSCORABLE',
    rawJson: '{}',
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

describe('recovery repo — getRawJson() compound-key seam (D-29)', () => {
  let mem: InMemoryDbResult;

  beforeEach(() => {
    mem = createInMemoryDb();
  });

  afterEach(() => mem.close());

  it('Test 12: returns stored raw_json on compound key; null on miss', () => {
    seedCycles(mem, [40001]);
    const repo = createRecoveryRepo(mem.db);
    repo.upsertBatch([
      makeScoredRecovery(40001, SLEEP_1, { rawJson: '{"cycle_id":40001}' }),
    ]);
    expect(repo.getRawJson(40001, SLEEP_1)).toBe('{"cycle_id":40001}');
    expect(repo.getRawJson(99999, SLEEP_1)).toBeNull();
    expect(repo.getRawJson(40001, 'no-such-sleep-uuid')).toBeNull();
  });
});
