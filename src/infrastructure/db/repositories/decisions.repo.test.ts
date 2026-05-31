// Decisions repository unit tests — locks the Phase 3 stub (insert / byId /
// listOpen) plus the four Phase 4 extensions (updateOutcome / countSince /
// findByPrefix / listAll) per Plan 04-06 D-19 + D-20 + D-22.
//
// Every write path runs through `db.transaction({behavior: 'immediate'})`
// (Phase 3 Pitfall 13). The tests below assert behavior, not transaction
// internals — the discipline lives in the implementation; this file pins
// the contract those writes must honor.
//
// T-04-S2 (SQL-injection / shell-metacharacter inputs) is exercised at the
// service layer (`src/services/decision/index.test.ts`); this file keeps
// scope to repository-level CRUD behavior.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createInMemoryDb, type InMemoryDbResult } from '../../../../tests/helpers/in-memory-db.js';
import { createDecisionsRepo, type DecisionsRepo } from './decisions.repo.js';

const FIXED_ULID_A = '01HK7AAAAAAAAAAAAAAAAAAAAA';
const FIXED_ULID_B = '01HK7BBBBBBBBBBBBBBBBBBBBB';
const FIXED_ULID_C = '01JZZZZZZZZZZZZZZZZZZZZZZZ';

interface InsertOverrides {
  id?: string;
  createdAt?: string;
  category?: string;
  decision?: string;
  rationale?: string | null;
  confidence?: 'low' | 'medium' | 'high' | null;
  expectedEffect?: string | null;
  followUpDate?: string | null;
}

function insertDecision(repo: DecisionsRepo, overrides: InsertOverrides = {}): string {
  const id = overrides.id ?? FIXED_ULID_A;
  repo.insert({
    id,
    createdAt: overrides.createdAt ?? '2026-05-20T12:00:00.000Z',
    category: overrides.category ?? 'general',
    decision: overrides.decision ?? 'sleep earlier tonight',
    rationale: overrides.rationale ?? null,
    confidence: overrides.confidence ?? null,
    expectedEffect: overrides.expectedEffect ?? null,
    followUpDate: overrides.followUpDate ?? null,
  });
  return id;
}

describe('decisions repo — Phase 3 carry-forward (insert / byId / listOpen)', () => {
  let mem: InMemoryDbResult;

  beforeEach(() => {
    mem = createInMemoryDb();
  });
  afterEach(() => mem.close());

  it('Test 1: insert + byId round-trip preserves every column', () => {
    const repo = createDecisionsRepo(mem.db);
    const id = insertDecision(repo, {
      category: 'sleep',
      decision: 'aim for 23:00 lights-out',
      rationale: 'recovery has been low this week',
      confidence: 'medium',
      expectedEffect: 'hrv improves 5+ ms within 7 days',
      followUpDate: '2026-05-27',
    });
    const row = repo.byId(id);
    expect(row).not.toBeNull();
    expect(row?.id).toBe(id);
    expect(row?.category).toBe('sleep');
    expect(row?.decision).toBe('aim for 23:00 lights-out');
    expect(row?.rationale).toBe('recovery has been low this week');
    expect(row?.confidence).toBe('medium');
    expect(row?.expectedEffect).toBe('hrv improves 5+ ms within 7 days');
    expect(row?.followUpDate).toBe('2026-05-27');
    expect(row?.status).toBe('open');
    expect(row?.outcomeNotes).toBeNull();
  });

  it('Test 2: byId returns null for an absent id', () => {
    const repo = createDecisionsRepo(mem.db);
    expect(repo.byId('01HK7XXXXXXXXXXXXXXXXXXXXX')).toBeNull();
  });

  it('Test 3: listOpen returns the newly inserted decision (status defaults to open)', () => {
    const repo = createDecisionsRepo(mem.db);
    const id = insertDecision(repo);
    const open = repo.listOpen();
    expect(open).toHaveLength(1);
    expect(open[0]?.id).toBe(id);
    expect(open[0]?.status).toBe('open');
  });
});

describe('decisions repo — updateOutcome (DEC-02)', () => {
  let mem: InMemoryDbResult;

  beforeEach(() => {
    mem = createInMemoryDb();
  });
  afterEach(() => mem.close());

  it('Test 4: updateOutcome flips status + notes and byId reflects the change', () => {
    const repo = createDecisionsRepo(mem.db);
    const id = insertDecision(repo);
    repo.updateOutcome(id, 'followed_up', 'slept better, hrv up 8 ms');
    const row = repo.byId(id);
    expect(row?.status).toBe('followed_up');
    expect(row?.outcomeNotes).toBe('slept better, hrv up 8 ms');
  });

  it('Test 5: updateOutcome on a non-existent id is silent (no throw, no row written)', () => {
    const repo = createDecisionsRepo(mem.db);
    insertDecision(repo);
    expect(() => repo.updateOutcome('01HK7XXXXXXXXXXXXXXXXXXXXX', 'abandoned', null)).not.toThrow();
    const count = mem.sqlite.prepare('SELECT COUNT(*) AS c FROM decisions').get() as { c: number };
    expect(count.c).toBe(1);
  });

  it('Test 6: repeated updateOutcome with identical args is idempotent', () => {
    const repo = createDecisionsRepo(mem.db);
    const id = insertDecision(repo);
    repo.updateOutcome(id, 'followed_up', 'good');
    repo.updateOutcome(id, 'followed_up', 'good');
    const row = repo.byId(id);
    expect(row?.status).toBe('followed_up');
    expect(row?.outcomeNotes).toBe('good');
  });

  it('Test 7: updateOutcome can clear notes by passing null', () => {
    const repo = createDecisionsRepo(mem.db);
    const id = insertDecision(repo);
    repo.updateOutcome(id, 'followed_up', 'first pass');
    repo.updateOutcome(id, 'followed_up', null);
    const row = repo.byId(id);
    expect(row?.outcomeNotes).toBeNull();
  });

  it('Test 8: updateOutcome to abandoned removes the row from listOpen', () => {
    const repo = createDecisionsRepo(mem.db);
    const id = insertDecision(repo);
    repo.updateOutcome(id, 'abandoned', null);
    expect(repo.listOpen()).toHaveLength(0);
  });
});

describe('decisions repo — countSince (D-22 weekly-prompt gating)', () => {
  let mem: InMemoryDbResult;

  beforeEach(() => {
    mem = createInMemoryDb();
  });
  afterEach(() => mem.close());

  it('Test 9: countSince(middleDate) returns rows ON or AFTER the boundary', () => {
    const repo = createDecisionsRepo(mem.db);
    insertDecision(repo, { id: FIXED_ULID_A, createdAt: '2026-05-10T12:00:00.000Z' });
    insertDecision(repo, { id: FIXED_ULID_B, createdAt: '2026-05-15T12:00:00.000Z' });
    insertDecision(repo, { id: FIXED_ULID_C, createdAt: '2026-05-20T12:00:00.000Z' });
    // gte boundary at 2026-05-15 catches the middle + the newest.
    expect(repo.countSince('2026-05-15T00:00:00.000Z')).toBe(2);
  });

  it('Test 10: countSince(futureDate) returns 0', () => {
    const repo = createDecisionsRepo(mem.db);
    insertDecision(repo, { createdAt: '2026-05-10T12:00:00.000Z' });
    expect(repo.countSince('2030-01-01T00:00:00.000Z')).toBe(0);
  });

  it('Test 11: countSince(epoch zero) returns total row count', () => {
    const repo = createDecisionsRepo(mem.db);
    insertDecision(repo, { id: FIXED_ULID_A, createdAt: '2026-05-10T12:00:00.000Z' });
    insertDecision(repo, { id: FIXED_ULID_B, createdAt: '2026-05-15T12:00:00.000Z' });
    expect(repo.countSince('1970-01-01T00:00:00.000Z')).toBe(2);
  });

  it('Test 12: countSince on an empty table returns 0', () => {
    const repo = createDecisionsRepo(mem.db);
    expect(repo.countSince('2026-05-15T00:00:00.000Z')).toBe(0);
  });
});

describe('decisions repo — findByPrefix (D-20 short-prefix lookup)', () => {
  let mem: InMemoryDbResult;

  beforeEach(() => {
    mem = createInMemoryDb();
  });
  afterEach(() => mem.close());

  it('Test 13: prefix matches every row whose id starts with the prefix', () => {
    const repo = createDecisionsRepo(mem.db);
    insertDecision(repo, { id: '01HK7AAAAAAAAAAAAAAAAAAAAA' });
    insertDecision(repo, { id: '01HK7BBBBBBBBBBBBBBBBBBBBB' });
    insertDecision(repo, { id: '01JZZZZZZZZZZZZZZZZZZZZZZZ' });
    const matches = repo.findByPrefix('01HK7');
    expect(matches).toHaveLength(2);
    const ids = matches.map((d) => d.id).sort();
    expect(ids).toEqual(['01HK7AAAAAAAAAAAAAAAAAAAAA', '01HK7BBBBBBBBBBBBBBBBBBBBB']);
  });

  it('Test 14: prefix lookup is case-insensitive (lower-case input matches upper-case ULID)', () => {
    const repo = createDecisionsRepo(mem.db);
    insertDecision(repo, { id: '01HK7AAAAAAAAAAAAAAAAAAAAA' });
    insertDecision(repo, { id: '01HK7BBBBBBBBBBBBBBBBBBBBB' });
    const matches = repo.findByPrefix('01hk7');
    expect(matches).toHaveLength(2);
  });

  it('Test 15: a non-matching prefix returns the empty array', () => {
    const repo = createDecisionsRepo(mem.db);
    insertDecision(repo, { id: FIXED_ULID_A });
    expect(repo.findByPrefix('NOMATCH')).toEqual([]);
  });

  it('Test 16: a uniquely-matching prefix returns a single-element array (caller checks ambiguity)', () => {
    const repo = createDecisionsRepo(mem.db);
    insertDecision(repo, { id: '01HK7AAAAAAAAAAAAAAAAAAAAA' });
    insertDecision(repo, { id: '01JZZZZZZZZZZZZZZZZZZZZZZZ' });
    const matches = repo.findByPrefix('01HK7');
    expect(matches).toHaveLength(1);
    expect(matches[0]?.id).toBe('01HK7AAAAAAAAAAAAAAAAAAAAA');
  });

  it('Test 16a: LIKE meta-characters in prefix are escaped (underscore is literal, not single-char wildcard)', () => {
    const repo = createDecisionsRepo(mem.db);
    insertDecision(repo, { id: '01HK7AAAAAAAAAAAAAAAAAAAAA' });
    insertDecision(repo, { id: '01HK7BBBBBBBBBBBBBBBBBBBBB' });
    // `_` would match any single char if unescaped → would match every 26-char ULID.
    // Escaped, it is a literal underscore that no ULID contains, so the result is empty.
    expect(repo.findByPrefix('_')).toEqual([]);
  });

  it('Test 16b: LIKE meta-characters in prefix are escaped (percent is literal, not wildcard)', () => {
    const repo = createDecisionsRepo(mem.db);
    insertDecision(repo, { id: '01HK7AAAAAAAAAAAAAAAAAAAAA' });
    insertDecision(repo, { id: '01HK7BBBBBBBBBBBBBBBBBBBBB' });
    // `%` would match all rows if unescaped. Escaped, it is a literal % that no ULID contains.
    expect(repo.findByPrefix('%')).toEqual([]);
  });

  // #95: min-length guard. Short prefixes match too many rows; the caller
  // (decision-update.ts) already arms on [] for "no match" UX.
  it('Test 16c: prefix.length < 4 returns empty array (#95 — no SQL issued)', () => {
    const repo = createDecisionsRepo(mem.db);
    insertDecision(repo, { id: '01HK7AAAAAAAAAAAAAAAAAAAAA' });
    insertDecision(repo, { id: '01HK7BBBBBBBBBBBBBBBBBBBBB' });
    expect(repo.findByPrefix('abc')).toEqual([]);
  });

  it('Test 16d: empty prefix returns empty array (#95)', () => {
    const repo = createDecisionsRepo(mem.db);
    insertDecision(repo, { id: '01HK7AAAAAAAAAAAAAAAAAAAAA' });
    expect(repo.findByPrefix('')).toEqual([]);
  });

  it('Test 16e: prefix.length === 4 executes SQL (boundary case, #95)', () => {
    const repo = createDecisionsRepo(mem.db);
    insertDecision(repo, { id: '01HK7AAAAAAAAAAAAAAAAAAAAA' });
    insertDecision(repo, { id: '01JZZZZZZZZZZZZZZZZZZZZZZZ' });
    const matches = repo.findByPrefix('01HK');
    expect(matches).toHaveLength(1);
    expect(matches[0]?.id).toBe('01HK7AAAAAAAAAAAAAAAAAAAAA');
  });
});

describe('decisions repo — listAll (D-20 --all flag)', () => {
  let mem: InMemoryDbResult;

  beforeEach(() => {
    mem = createInMemoryDb();
  });
  afterEach(() => mem.close());

  it('Test 17: listAll returns every row regardless of status; listOpen excludes non-open', () => {
    const repo = createDecisionsRepo(mem.db);
    const idA = insertDecision(repo, { id: FIXED_ULID_A, createdAt: '2026-05-10T12:00:00.000Z' });
    const idB = insertDecision(repo, { id: FIXED_ULID_B, createdAt: '2026-05-15T12:00:00.000Z' });
    const idC = insertDecision(repo, { id: FIXED_ULID_C, createdAt: '2026-05-20T12:00:00.000Z' });
    repo.updateOutcome(idB, 'followed_up', 'worked');

    const all = repo.listAll();
    expect(all).toHaveLength(3);
    // newest first per created_at DESC
    expect(all.map((d) => d.id)).toEqual([idC, idB, idA]);

    const open = repo.listOpen();
    expect(open.map((d) => d.id).sort()).toEqual([idA, idC].sort());
  });

  it('Test 18: listAll on an empty table returns the empty array', () => {
    const repo = createDecisionsRepo(mem.db);
    expect(repo.listAll()).toEqual([]);
  });
});
