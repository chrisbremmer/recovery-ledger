// Cycles repository unit tests — the canonical test pattern for Phase 3's
// scored-paginated repos. Locks the four invariants every other repo
// inherits structurally:
//   - cursor() returns EPOCH_ZERO_ISO on empty table; MAX(updated_at) on
//     populated table (D-09).
//   - upsertBatch is idempotent (Pitfall 10) and updates existing rows via
//     ON CONFLICT(id) DO UPDATE (D-11).
//   - byRange default filter excludes PENDING_SCORE/UNSCORABLE rows (D-04)
//     and rows with baseline_excluded = 1 (D-16). includeUnscored /
//     includeExcluded escape hatches respect the override.
//   - getRawJson returns the stored payload; missing id returns null
//     (D-29).
//   - upsertBatch wraps writes in BEGIN IMMEDIATE (D-31 + Pitfall 13);
//     asserted via a grep against the source file's transaction-config
//     literal (cannot exercise the deadlock-avoidance behavior of
//     immediate vs deferred in a single-connection in-memory DB
//     deterministically).
//
// Each test starts from a fresh `:memory:` SQLite DB via Plan 03-07's
// createInMemoryDb helper, which runs the real Plan 03-05 migrator.

import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createInMemoryDb, type InMemoryDbResult } from '../../../../tests/helpers/in-memory-db.js';
import type { Cycle } from '../../../domain/types/entities.js';
import { createCyclesRepo, rowToCycle } from './cycles.repo.js';

const REPO_FILE = new URL('./cycles.repo.ts', import.meta.url).pathname;

// Helpers ---------------------------------------------------------------------

const BASE_DATE = '2026-05-13T07:00:00.000Z';
const BASE_USER_ID = 100001;

function makeScoredCycle(overrides: Partial<Cycle> = {}): Cycle {
  return {
    id: 40001,
    userId: BASE_USER_ID,
    createdAt: '2026-05-13T08:00:00.000Z',
    updatedAt: '2026-05-13T20:00:00.000Z',
    start: BASE_DATE,
    end: '2026-05-14T07:00:00.000Z',
    timezoneOffset: '-08:00',
    scoreState: 'SCORED',
    strain: 12.0,
    kilojoule: 8300.0,
    averageHeartRate: 67,
    maxHeartRate: 176,
    baselineExcluded: false,
    exclusionReason: null,
    ...overrides,
  } as Cycle;
}

function makePendingCycle(overrides: Partial<Cycle> = {}): Cycle {
  return {
    id: 40002,
    userId: BASE_USER_ID,
    createdAt: '2026-05-14T08:00:00.000Z',
    updatedAt: '2026-05-14T08:30:00.000Z',
    start: '2026-05-14T07:00:00.000Z',
    end: '2026-05-15T07:00:00.000Z',
    timezoneOffset: '-08:00',
    scoreState: 'PENDING_SCORE',
    baselineExcluded: false,
    exclusionReason: null,
    ...overrides,
  } as Cycle;
}

function makeUnscorableCycle(overrides: Partial<Cycle> = {}): Cycle {
  return {
    id: 40003,
    userId: BASE_USER_ID,
    createdAt: '2026-05-15T08:00:00.000Z',
    updatedAt: '2026-05-15T20:00:00.000Z',
    start: '2026-05-15T07:00:00.000Z',
    end: '2026-05-16T07:00:00.000Z',
    timezoneOffset: '-08:00',
    scoreState: 'UNSCORABLE',
    baselineExcluded: false,
    exclusionReason: null,
    ...overrides,
  } as Cycle;
}

// Test suite ------------------------------------------------------------------

describe('cycles repo — cursor()', () => {
  let mem: InMemoryDbResult;

  beforeEach(() => {
    mem = createInMemoryDb();
  });

  afterEach(() => mem.close());

  it('Test 1: returns EPOCH_ZERO_ISO on empty table (D-09 fallback)', () => {
    const repo = createCyclesRepo(mem.db);
    expect(repo.cursor()).toBe('1970-01-01T00:00:00.000Z');
  });

  it('Test 2: returns the maximum updated_at after upsert', () => {
    const repo = createCyclesRepo(mem.db);
    repo.upsertBatch([
      makeScoredCycle({ id: 40001, updatedAt: '2026-05-13T10:00:00.000Z' }),
      makeScoredCycle({ id: 40002, updatedAt: '2026-05-14T10:00:00.000Z' }),
      makeScoredCycle({ id: 40003, updatedAt: '2026-05-15T10:00:00.000Z' }),
    ]);
    expect(repo.cursor()).toBe('2026-05-15T10:00:00.000Z');
  });
});

describe('cycles repo — upsertBatch() idempotency + ON CONFLICT', () => {
  let mem: InMemoryDbResult;

  beforeEach(() => {
    mem = createInMemoryDb();
  });

  afterEach(() => mem.close());

  it('Test 3: idempotent — calling twice with same rows leaves table row count unchanged', () => {
    const repo = createCyclesRepo(mem.db);
    const rows = [makeScoredCycle({ id: 40001 }), makeScoredCycle({ id: 40002 })];
    repo.upsertBatch(rows);
    repo.upsertBatch(rows);
    const count = (mem.sqlite.prepare('SELECT COUNT(*) AS c FROM cycles').get() as { c: number }).c;
    expect(count).toBe(2);
  });

  it('Test 4: ON CONFLICT(id) DO UPDATE — second call with mutated strain updates without inserting', () => {
    const repo = createCyclesRepo(mem.db);
    repo.upsertBatch([makeScoredCycle({ id: 40001, strain: 12.0 })]);
    repo.upsertBatch([makeScoredCycle({ id: 40001, strain: 14.5 })]);
    const count = (mem.sqlite.prepare('SELECT COUNT(*) AS c FROM cycles').get() as { c: number }).c;
    expect(count).toBe(1);
    const stored = repo.byRange('2026-05-01', '2026-05-31');
    expect(stored).toHaveLength(1);
    expect(stored[0]).toBeDefined();
    if (stored[0]?.scoreState !== 'SCORED') {
      throw new Error('expected SCORED variant');
    }
    expect(stored[0].strain).toBe(14.5);
  });
});

describe('cycles repo — byRange() default filters (D-04 + D-16)', () => {
  let mem: InMemoryDbResult;

  beforeEach(() => {
    mem = createInMemoryDb();
  });

  afterEach(() => mem.close());

  it('Test 5: default filter excludes PENDING_SCORE and UNSCORABLE rows (D-04)', () => {
    const repo = createCyclesRepo(mem.db);
    repo.upsertBatch([makeScoredCycle(), makePendingCycle(), makeUnscorableCycle()]);
    const rows = repo.byRange('2026-05-01', '2026-05-31');
    expect(rows).toHaveLength(1);
    expect(rows[0]?.scoreState).toBe('SCORED');
  });

  it('Test 6: includeUnscored: true returns all 3 score states', () => {
    const repo = createCyclesRepo(mem.db);
    repo.upsertBatch([makeScoredCycle(), makePendingCycle(), makeUnscorableCycle()]);
    const rows = repo.byRange('2026-05-01', '2026-05-31', { includeUnscored: true });
    expect(rows).toHaveLength(3);
    const states = rows.map((r) => r.scoreState).sort();
    expect(states).toEqual(['PENDING_SCORE', 'SCORED', 'UNSCORABLE']);
  });

  it('Test 7: default filter excludes baseline_excluded = 1 rows (D-16)', () => {
    const repo = createCyclesRepo(mem.db);
    repo.upsertBatch([
      makeScoredCycle({ id: 40001, baselineExcluded: false }),
      makeScoredCycle({
        id: 40002,
        baselineExcluded: true,
        exclusionReason: 'dst_straddle',
      }),
    ]);
    const rows = repo.byRange('2026-05-01', '2026-05-31');
    expect(rows).toHaveLength(1);
    expect(rows[0]?.id).toBe(40001);
  });

  it('Test 8: includeExcluded: true returns the DST-flagged cycle', () => {
    const repo = createCyclesRepo(mem.db);
    repo.upsertBatch([
      makeScoredCycle({ id: 40001, baselineExcluded: false }),
      makeScoredCycle({
        id: 40002,
        baselineExcluded: true,
        exclusionReason: 'dst_straddle',
      }),
    ]);
    const rows = repo.byRange('2026-05-01', '2026-05-31', { includeExcluded: true });
    expect(rows).toHaveLength(2);
  });
});

describe('cycles repo — getRawJson() diagnostic seam (D-29)', () => {
  let mem: InMemoryDbResult;

  beforeEach(() => {
    mem = createInMemoryDb();
  });

  afterEach(() => mem.close());

  it('Test 9a: returns the stored raw_json string', () => {
    const repo = createCyclesRepo(mem.db);
    // The cycle entity has no rawJson on its type; carry through the
    // optional-field path the entity-to-row mapper supports.
    const entityWithRaw = makeScoredCycle({ id: 40001 }) as Cycle & { rawJson: string };
    entityWithRaw.rawJson = '{"id":40001,"score_state":"SCORED"}';
    repo.upsertBatch([entityWithRaw]);
    expect(repo.getRawJson(40001)).toBe('{"id":40001,"score_state":"SCORED"}');
  });

  it('Test 9b: nonexistent id returns null', () => {
    const repo = createCyclesRepo(mem.db);
    expect(repo.getRawJson(99999)).toBeNull();
  });
});

describe('cycles repo — BEGIN IMMEDIATE write discipline (D-31 + Pitfall 13)', () => {
  it("Test 10: upsertBatch source explicitly passes { behavior: 'immediate' }", () => {
    // Pitfall 13 forcing-function assertion. We cannot deterministically
    // exercise the deadlock-avoidance behavior in a single-connection
    // in-memory DB inside a Vitest worker; instead, lock the API call by
    // grepping the source for the literal config object that drizzle-orm
    // 0.45.2 requires to emit `BEGIN IMMEDIATE` instead of plain `BEGIN`.
    // If a future refactor swaps to plain `db.transaction(fn)` without
    // the config, this test fails loudly.
    const source = readFileSync(REPO_FILE, 'utf8');
    expect(source).toMatch(/\{\s*behavior:\s*'immediate'\s*\}/);
  });

  it('Test 10b: cursor() result survives one upsert + read cycle (smoke check)', () => {
    const mem = createInMemoryDb();
    try {
      const repo = createCyclesRepo(mem.db);
      repo.upsertBatch([makeScoredCycle({ id: 40001, updatedAt: '2026-05-13T20:00:00.000Z' })]);
      expect(repo.cursor()).toBe('2026-05-13T20:00:00.000Z');
    } finally {
      mem.close();
    }
  });
});

describe('cycles repo — rowToCycle() row → entity mapper (D-28)', () => {
  it('Test 11: rowToCycle throws on unknown score_state', () => {
    // Deliberately bypass the schema enum to exercise the defensive default
    // branch. A hand-crafted row that escaped the column-level enum (e.g.,
    // a corrupted backup restore) must throw loudly, not silently narrow
    // to `never`.
    const malformedRow = {
      id: 99,
      user_id: 100001,
      created_at: '2026-05-13T08:00:00.000Z',
      updated_at: '2026-05-13T20:00:00.000Z',
      start: '2026-05-13T07:00:00.000Z',
      end: '2026-05-14T07:00:00.000Z',
      timezone_offset: '-08:00',
      score_state: 'GARBAGE',
      strain: null,
      kilojoule: null,
      average_heart_rate: null,
      max_heart_rate: null,
      baseline_excluded: false,
      exclusion_reason: null,
      raw_json: '{}',
    } as unknown as Parameters<typeof rowToCycle>[0];
    expect(() => rowToCycle(malformedRow)).toThrow(/unknown score_state/);
  });

  it('Test 12: rowToCycle throws on SCORED row with null score field', () => {
    const malformedRow = {
      id: 99,
      user_id: 100001,
      created_at: '2026-05-13T08:00:00.000Z',
      updated_at: '2026-05-13T20:00:00.000Z',
      start: '2026-05-13T07:00:00.000Z',
      end: '2026-05-14T07:00:00.000Z',
      timezone_offset: '-08:00',
      score_state: 'SCORED' as const,
      strain: null, // SCORED variant must have non-null score fields
      kilojoule: 8300.0,
      average_heart_rate: 67,
      max_heart_rate: 176,
      baseline_excluded: false,
      exclusion_reason: null,
      raw_json: '{}',
    };
    expect(() => rowToCycle(malformedRow)).toThrow(/SCORED but a score field is NULL/);
  });
});
