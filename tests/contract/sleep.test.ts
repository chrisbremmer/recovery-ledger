// Contract test for the sleep resource path (SYNC-07 anchor).
//
// Mirrors the canonical cycles.test.ts shape: MSW intercepts → listSleep()
// → normalizeSleep → sleepsRepo.upsertBatch → sleepsRepo.byRange. UUID id
// per A6; no DST flag on the sleep row (D-14 + Plan 03-08 sleep.repo.ts
// docs the includeExcluded no-op for symmetry with the four scored repos).
//
// ADR-0006: onUnhandledRequest:'error' on MSW. vi.mock of the
// refresh-orchestrator bypasses the keychain.

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';
import type { SleepUpsertRow } from '../../src/infrastructure/db/repositories/sleep.repo.js';
import { createInMemoryDb, type InMemoryDbResult } from '../helpers/in-memory-db.js';
import { createWhoopSleepHelper, type WhoopSleepHelper } from '../helpers/msw-whoop-sleep.js';

vi.mock('../../src/services/refresh-orchestrator.js', () => ({
  callWithAuth: (op: (token: string) => Promise<unknown>) => op('test-token-123'),
}));

const { listSleep } = await import('../../src/infrastructure/whoop/resources/sleep.js');
const { createSleepsRepo } = await import('../../src/infrastructure/db/repositories/sleep.repo.js');
const { _resetForTest: resetRateLimit } = await import(
  '../../src/infrastructure/whoop/rate-limit.js'
);

vi.setConfig({ testTimeout: 5_000 });

const SINCE = '2026-01-01T00:00:00.000Z';
const UNTIL = '2026-12-31T23:59:59.999Z';
const BASE_USER_ID = 100001;
const FIXTURE_SLEEP_ID = '7dee4993-8fa2-43a7-8e54-94a5c0d3227a';

function makeScoredSleep(id: string): SleepUpsertRow {
  return {
    id,
    userId: BASE_USER_ID,
    createdAt: '2026-05-10T05:00:00.000Z',
    updatedAt: '2026-05-10T15:00:00.000Z',
    start: '2026-05-10T05:00:00.000Z',
    end: '2026-05-10T13:00:00.000Z',
    timezoneOffset: '-08:00',
    scoreState: 'SCORED',
    totalInBedTimeMilli: 28800000,
    totalAwakeTimeMilli: 1800000,
    sleepPerformancePercentage: 88.5,
    sleepConsistencyPercentage: 76.0,
    sleepEfficiencyPercentage: 93.7,
    respiratoryRate: 14.8,
    rawJson: '{}',
  };
}

function makePendingSleep(id: string): SleepUpsertRow {
  return {
    id,
    userId: BASE_USER_ID,
    createdAt: '2026-05-11T05:00:00.000Z',
    updatedAt: '2026-05-11T05:30:00.000Z',
    start: '2026-05-11T05:00:00.000Z',
    end: '2026-05-11T13:00:00.000Z',
    timezoneOffset: '-08:00',
    scoreState: 'PENDING_SCORE',
    rawJson: '{}',
  };
}

let helper: WhoopSleepHelper;
let mem: InMemoryDbResult;

beforeAll(() => {
  helper = createWhoopSleepHelper();
  // ADR-0006: any unhandled request fails the test loudly.
  helper.server.listen({ onUnhandledRequest: 'error' });
});

afterAll(() => {
  helper.server.close();
});

beforeEach(() => {
  resetRateLimit();
  helper.resetHitCount();
  helper.server.resetHandlers();
  mem = createInMemoryDb();
});

afterEach(() => {
  mem.close();
});

describe('sleep contract — happy path + idempotency', () => {
  test('Test 1: happy path — listSleep + upsertBatch + byRange returns the fixture sleep (UUID id)', async () => {
    const { entities: sleeps } = await listSleep({ since: SINCE, until: UNTIL });
    expect(sleeps).toHaveLength(1);
    expect(sleeps[0]?.scoreState).toBe('SCORED');
    expect(sleeps[0]?.id).toBe(FIXTURE_SLEEP_ID);

    const repo = createSleepsRepo(mem.db);
    const upsertResult = repo.upsertBatch(sleeps.map((s) => ({ ...s, rawJson: '{}' })));
    expect(upsertResult.changed).toBe(1);

    const stored = repo.byRange(SINCE, UNTIL);
    expect(stored).toHaveLength(1);
    expect(stored[0]?.id).toBe(FIXTURE_SLEEP_ID);
  });

  test('Test 2: idempotency — second listSleep + upsertBatch leaves row count at 1', async () => {
    const repo = createSleepsRepo(mem.db);
    const { entities: first } = await listSleep({ since: SINCE, until: UNTIL });
    repo.upsertBatch(first.map((s) => ({ ...s, rawJson: '{}' })));
    const { entities: second } = await listSleep({ since: SINCE, until: UNTIL });
    repo.upsertBatch(second.map((s) => ({ ...s, rawJson: '{}' })));

    const count = (mem.sqlite.prepare('SELECT COUNT(*) AS c FROM sleeps').get() as { c: number }).c;
    expect(count).toBe(1);
    expect(helper.getHitCount()).toBe(2);
  });
});

describe('sleep contract — D-04 SCORED-only default filter', () => {
  test('Test 3: default byRange returns SCORED only; includeUnscored returns both rows', () => {
    const repo = createSleepsRepo(mem.db);
    repo.upsertBatch([
      makeScoredSleep(FIXTURE_SLEEP_ID),
      makePendingSleep('11111111-1111-1111-1111-111111111111'),
    ]);
    const defaultRows = repo.byRange(SINCE, UNTIL);
    expect(defaultRows).toHaveLength(1);
    expect(defaultRows[0]?.scoreState).toBe('SCORED');

    const allRows = repo.byRange(SINCE, UNTIL, { includeUnscored: true });
    expect(allRows).toHaveLength(2);
  });
});

describe('sleep contract — A6 UUID-string id shape', () => {
  test('Test 4: stored sleep id is a 36-char UUID string', async () => {
    const { entities: sleeps } = await listSleep({ since: SINCE, until: UNTIL });
    const repo = createSleepsRepo(mem.db);
    repo.upsertBatch(sleeps.map((s) => ({ ...s, rawJson: '{}' })));
    const stored = repo.byRange(SINCE, UNTIL);
    expect(typeof stored[0]?.id).toBe('string');
    expect(stored[0]?.id.length).toBe(36);
  });
});

describe('sleep contract — getRawJson diagnostic seam (D-29)', () => {
  test('Test 5: getRawJson(id) returns the stored raw_json payload', async () => {
    const { entities: sleeps } = await listSleep({ since: SINCE, until: UNTIL });
    const repo = createSleepsRepo(mem.db);
    const fixturePayload = '{"id":"7dee4993-8fa2-43a7-8e54-94a5c0d3227a","mock":true}';
    repo.upsertBatch(sleeps.map((s) => ({ ...s, rawJson: fixturePayload })));
    expect(repo.getRawJson(FIXTURE_SLEEP_ID)).toBe(fixturePayload);
  });
});
