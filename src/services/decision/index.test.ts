// Decision-service orchestration tests — D-19 (smart defaults on addDecision),
// D-20 (review/update flows), D-21 (dual-mode reviewDecisions).
//
// The service composes ulid() + decisionsRepo and lives between the CLI/MCP
// shims and the persistence layer. Tests use the in-memory-db helper + the
// real repository so the behavior under test is end-to-end through the
// service-repo boundary (the Phase 3 + 04-06 repo lives below it).
//
// T-04-S2 (Plan 04-06 threat register): SQL-injection-style + shell-metacharacter
// payloads round-trip unchanged through the service+repo+ORM prepared-statement
// chain. See `Test 8` + `Test 9`.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Logger } from 'pino';
import { createInMemoryDb, type InMemoryDbResult } from '../../../tests/helpers/in-memory-db.js';
import {
  createDecisionsRepo,
  type DecisionsRepo,
} from '../../infrastructure/db/repositories/decisions.repo.js';
import { addDecision, reviewDecisions, updateDecision } from './index.js';

// Pino offers a `.child()` / `.info()` surface. The service only calls
// `logger.info({ ... })` so a typed stub is sufficient.
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

const FIXED_NOW = new Date('2026-05-20T12:00:00.000Z');
const FIXED_CLOCK = (): Date => FIXED_NOW;

interface Harness {
  mem: InMemoryDbResult;
  repo: DecisionsRepo;
  logger: Logger;
  deps: {
    repos: { decisions: DecisionsRepo };
    clock: () => Date;
    logger: Logger;
  };
}

function makeHarness(): Harness {
  const mem = createInMemoryDb();
  const repo = createDecisionsRepo(mem.db);
  const logger = makeStubLogger();
  return {
    mem,
    repo,
    logger,
    deps: { repos: { decisions: repo }, clock: FIXED_CLOCK, logger },
  };
}

describe('services/decision — addDecision (D-19 smart defaults)', () => {
  let h: Harness;

  beforeEach(() => {
    h = makeHarness();
  });
  afterEach(() => h.mem.close());

  it('Test 1: minimal input gets a ULID id, category=general, null optional fields', async () => {
    const created = await addDecision({ decision: 'sleep earlier tonight' }, h.deps);
    expect(created.id).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/); // Crockford Base32 ULID
    expect(created.category).toBe('general');
    expect(created.decision).toBe('sleep earlier tonight');
    expect(created.rationale).toBeNull();
    expect(created.confidence).toBeNull();
    expect(created.expectedEffect).toBeNull();
    expect(created.followUpDate).toBeNull();
    expect(created.status).toBe('open');
    expect(created.outcomeNotes).toBeNull();
  });

  it('Test 2: every explicit field round-trips through the repo', async () => {
    const created = await addDecision(
      {
        decision: 'cut alcohol on weekdays',
        category: 'lifestyle',
        rationale: 'sleep efficiency dropped',
        confidence: 'high',
        expectedEffect: 'sleep efficiency back above 88% in 14 days',
        followUpDate: '2026-06-03',
      },
      h.deps,
    );
    expect(created.category).toBe('lifestyle');
    expect(created.rationale).toBe('sleep efficiency dropped');
    expect(created.confidence).toBe('high');
    expect(created.expectedEffect).toBe('sleep efficiency back above 88% in 14 days');
    expect(created.followUpDate).toBe('2026-06-03');
  });

  it('Test 3: createdAt is the injected clock value', async () => {
    const created = await addDecision({ decision: 'breathe before bed' }, h.deps);
    expect(created.createdAt).toBe(FIXED_NOW.toISOString());
  });

  it('Test 4: structured log carries id + category only (no decision text)', async () => {
    const infoSpy = vi.fn();
    const logger = { ...makeStubLogger(), info: infoSpy } as unknown as Logger;
    const deps = { ...h.deps, logger };
    const created = await addDecision({ decision: 'avoid late workouts' }, deps);
    expect(infoSpy).toHaveBeenCalledTimes(1);
    const [payload] = infoSpy.mock.calls[0] as [Record<string, unknown>];
    expect(payload.event).toBe('decision_added');
    expect(payload.id).toBe(created.id);
    expect(payload.category).toBe('general');
    // Pitfall 17: decision text must NEVER appear in log payload.
    expect(JSON.stringify(payload)).not.toContain('avoid late workouts');
  });
});

describe('services/decision — reviewDecisions list mode (D-21)', () => {
  let h: Harness;

  beforeEach(() => {
    h = makeHarness();
  });
  afterEach(() => h.mem.close());

  it('Test 5: list mode without includeAll returns only open decisions', async () => {
    const a = await addDecision({ decision: 'a' }, h.deps);
    const b = await addDecision({ decision: 'b' }, h.deps);
    await addDecision({ decision: 'c' }, h.deps);
    // mark `b` as followed_up via the update flow
    await reviewDecisions(
      { mode: 'update', id: b.id, status: 'followed_up', notes: 'worked' },
      h.deps,
    );
    const result = await reviewDecisions({ mode: 'list' }, h.deps);
    expect(result.mode).toBe('list');
    if (result.mode !== 'list') throw new Error('narrow failed');
    expect(result.decisions).toHaveLength(2);
    const ids = result.decisions.map((d) => d.id).sort();
    expect(ids).toContain(a.id);
    expect(ids).not.toContain(b.id);
  });

  it('Test 6: list mode with includeAll=true returns every decision', async () => {
    const a = await addDecision({ decision: 'a' }, h.deps);
    const b = await addDecision({ decision: 'b' }, h.deps);
    await reviewDecisions({ mode: 'update', id: b.id, status: 'abandoned' }, h.deps);
    const result = await reviewDecisions({ mode: 'list', includeAll: true }, h.deps);
    if (result.mode !== 'list') throw new Error('narrow failed');
    expect(result.decisions).toHaveLength(2);
    const ids = result.decisions.map((d) => d.id).sort();
    expect(ids).toEqual([a.id, b.id].sort());
  });
});

describe('services/decision — reviewDecisions update mode (D-21)', () => {
  let h: Harness;

  beforeEach(() => {
    h = makeHarness();
  });
  afterEach(() => h.mem.close());

  it('Test 7: update mode returns the updated decision with new status + notes', async () => {
    const created = await addDecision({ decision: 'lights out by 23:00' }, h.deps);
    const result = await reviewDecisions(
      { mode: 'update', id: created.id, status: 'followed_up', notes: 'worked well' },
      h.deps,
    );
    if (result.mode !== 'update') throw new Error('narrow failed');
    expect(result.decision.id).toBe(created.id);
    expect(result.decision.status).toBe('followed_up');
    expect(result.decision.outcomeNotes).toBe('worked well');
  });

  it('Test 8: update mode on a missing id throws', async () => {
    await expect(
      reviewDecisions({ mode: 'update', id: '01HK7XXXXXXXXXXXXXXXXXXXXX', status: 'open' }, h.deps),
    ).rejects.toThrow(/not found/);
  });
});

describe('services/decision — T-04-S2 injection-style payloads round-trip', () => {
  let h: Harness;

  beforeEach(() => {
    h = makeHarness();
  });
  afterEach(() => h.mem.close());

  it("Test 9: SQL-injection-style decision text round-trips unchanged; DB intact", async () => {
    const payload = "'; DROP TABLE decisions; --";
    const created = await addDecision({ decision: payload }, h.deps);
    expect(created.decision).toBe(payload);
    // Sanity: the table is intact + still queryable.
    const all = h.repo.listAll();
    expect(all).toHaveLength(1);
    expect(all[0]?.decision).toBe(payload);
  });

  it('Test 10: shell-metacharacter decision text round-trips unchanged', async () => {
    const payload = '$(rm -rf /)';
    const created = await addDecision({ decision: payload }, h.deps);
    expect(created.decision).toBe(payload);
    const fetched = h.repo.byId(created.id);
    expect(fetched?.decision).toBe(payload);
  });
});

describe('services/decision — updateDecision convenience wrapper', () => {
  let h: Harness;

  beforeEach(() => {
    h = makeHarness();
  });
  afterEach(() => h.mem.close());

  it('Test 11: updateDecision delegates to reviewDecisions and unwraps the decision', async () => {
    const created = await addDecision({ decision: 'reduce caffeine after noon' }, h.deps);
    const updated = await updateDecision(
      { id: created.id, status: 'followed_up', notes: 'hrv up' },
      h.deps,
    );
    expect(updated.id).toBe(created.id);
    expect(updated.status).toBe('followed_up');
    expect(updated.outcomeNotes).toBe('hrv up');
  });
});
