// Contract test for the cycles resource path (SYNC-07 + Pitfall H anchor).
//
// Drives the full Wave-3+4 stack end-to-end: MSW intercepts → listCycles()
// (resource module + httpGet + paginateAll) → normalizeCycle (DST/tz
// exclusion detection) → cyclesRepo.upsertBatch (BEGIN IMMEDIATE +
// ON CONFLICT) → cyclesRepo.byRange (SCORED-only + non-excluded default).
//
// Pitfall H verification anchor (200-dst-spring-forward, 200-dst-fall-back,
// 200-tz-trip-sfo-jfk): a cycle that straddles a DST boundary or follows a
// tz shift must carry `baselineExcluded=true` + a non-null
// `exclusionReason`, and that flag must persist through the upsert/byRange
// round trip. The mixed-score-states fixture also exercises the
// PENDING_SCORE + UNSCORABLE branches surviving the full pipeline without
// crashing (D-04 SCORED-only filter + Pitfall 3 score-state discipline).
//
// ADR-0006: MSW listens with `onUnhandledRequest: 'error'` so any
// accidental live network call fails the test.
//
// vi.mock of `services/refresh-orchestrator.js` mirrors client.test.ts —
// the production `callWithAuth` reaches into `tokenStore.getValidAccessToken`
// which reads the OS keychain. The mock invokes the operation directly with
// a fixed test token so the contract test exercises the HTTP boundary
// without touching the auth stack.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';
import { createInMemoryDb, type InMemoryDbResult } from '../helpers/in-memory-db.js';
import { createWhoopCyclesHelper, type WhoopCyclesHelper } from '../helpers/msw-whoop-cycles.js';

vi.mock('../../src/services/refresh-orchestrator.js', () => ({
  callWithAuth: (op: (token: string) => Promise<unknown>) => op('test-token-123'),
}));

const { listCycles } = await import('../../src/infrastructure/whoop/resources/cycles.js');
const { createCyclesRepo } = await import(
  '../../src/infrastructure/db/repositories/cycles.repo.js'
);
const { _resetForTest: resetRateLimit } = await import(
  '../../src/infrastructure/whoop/rate-limit.js'
);
const { WhoopApiError } = await import('../../src/infrastructure/whoop/errors.js');

vi.setConfig({ testTimeout: 5_000 });

const FIXTURES_DIR = join(process.cwd(), 'tests', 'fixtures', 'whoop', 'cycles');

function loadFixture(name: string): unknown {
  return JSON.parse(readFileSync(join(FIXTURES_DIR, `${name}.json`), 'utf8'));
}

const SINCE = '2026-01-01T00:00:00.000Z';
const UNTIL = '2026-12-31T23:59:59.999Z';
const IANA_ZONE = 'America/Los_Angeles';

let helper: WhoopCyclesHelper;
let mem: InMemoryDbResult;

beforeAll(() => {
  helper = createWhoopCyclesHelper();
  // ADR-0006: every unhandled request fails the test loudly.
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

describe('cycles contract — happy path + idempotency (D-11 / SYNC-04)', () => {
  test('Test 1: happy path — listCycles + upsertBatch + byRange round-trip returns the fixture cycle', async () => {
    // Default fixture (200-ok.json) returns one SCORED cycle.
    const cycles = await listCycles({
      since: SINCE,
      until: UNTIL,
      ianaZone: IANA_ZONE,
      priorTimezoneOffset: null,
    });
    expect(cycles).toHaveLength(1);
    expect(cycles[0]?.scoreState).toBe('SCORED');

    const repo = createCyclesRepo(mem.db);
    const upsertResult = repo.upsertBatch(cycles);
    expect(upsertResult.changed).toBe(1);

    const stored = repo.byRange(SINCE, UNTIL);
    expect(stored).toHaveLength(1);
    expect(stored[0]?.id).toBe(12345678);
    expect(stored[0]?.scoreState).toBe('SCORED');
  });

  test('Test 2: idempotency — a second listCycles + upsertBatch with the same fixture does not duplicate rows', async () => {
    const repo = createCyclesRepo(mem.db);
    const first = await listCycles({
      since: SINCE,
      until: UNTIL,
      ianaZone: IANA_ZONE,
      priorTimezoneOffset: null,
    });
    repo.upsertBatch(first);
    const second = await listCycles({
      since: SINCE,
      until: UNTIL,
      ianaZone: IANA_ZONE,
      priorTimezoneOffset: null,
    });
    repo.upsertBatch(second);

    const stored = repo.byRange(SINCE, UNTIL);
    expect(stored).toHaveLength(1);
    // Two fetches → two MSW hits. Confirms no caching.
    expect(helper.getHitCount()).toBe(2);
  });
});

describe('cycles contract — Pitfall H (DST/tz exclusion fixtures)', () => {
  test('Test 3: 200-dst-spring-forward fixture → baselineExcluded=true + exclusionReason="dst_straddle"', async () => {
    helper.setNextResponse(loadFixture('200-dst-spring-forward'));
    const cycles = await listCycles({
      since: SINCE,
      until: UNTIL,
      ianaZone: IANA_ZONE,
      priorTimezoneOffset: null,
    });
    expect(cycles).toHaveLength(1);
    expect(cycles[0]?.baselineExcluded).toBe(true);
    expect(cycles[0]?.exclusionReason).toBe('dst_straddle');

    // Persisted flag must round-trip through upsert + byRange (D-16).
    const repo = createCyclesRepo(mem.db);
    repo.upsertBatch(cycles);
    const withExcluded = repo.byRange(SINCE, UNTIL, { includeExcluded: true });
    expect(withExcluded).toHaveLength(1);
    expect(withExcluded[0]?.baselineExcluded).toBe(true);
    expect(withExcluded[0]?.exclusionReason).toBe('dst_straddle');
    // D-16 default filter excludes the DST-flagged row.
    const defaultRange = repo.byRange(SINCE, UNTIL);
    expect(defaultRange).toHaveLength(0);
  });

  test('Test 4: 200-dst-fall-back fixture → same exclusion behavior on the November boundary', async () => {
    helper.setNextResponse(loadFixture('200-dst-fall-back'));
    const cycles = await listCycles({
      since: SINCE,
      until: UNTIL,
      ianaZone: IANA_ZONE,
      priorTimezoneOffset: null,
    });
    expect(cycles).toHaveLength(1);
    expect(cycles[0]?.baselineExcluded).toBe(true);
    expect(cycles[0]?.exclusionReason).toBe('dst_straddle');
  });

  test('Test 5: 200-tz-trip-sfo-jfk fixture → tz_drift fires on the offset transition', async () => {
    helper.setNextResponse(loadFixture('200-tz-trip-sfo-jfk'));
    const cycles = await listCycles({
      since: SINCE,
      until: UNTIL,
      ianaZone: IANA_ZONE,
      priorTimezoneOffset: null,
    });
    expect(cycles).toHaveLength(3);
    // Sorted ascending by start; the SFO record is first (no priorOffset → no flag).
    expect(cycles[0]?.timezoneOffset).toBe('-08:00');
    expect(cycles[0]?.baselineExcluded).toBe(false);
    // Transition record: prior offset within the page is -08:00, this one is -05:00.
    expect(cycles[1]?.timezoneOffset).toBe('-05:00');
    expect(cycles[1]?.baselineExcluded).toBe(true);
    expect(cycles[1]?.exclusionReason).toBe('tz_drift');
    // Third record: prior offset within the page is -05:00, same offset → no flag.
    expect(cycles[2]?.timezoneOffset).toBe('-05:00');
    expect(cycles[2]?.baselineExcluded).toBe(false);
  });
});

describe('cycles contract — pagination + dup-key detection (D-19 / Pitfall 10)', () => {
  test('Test 6: multi-page response is concatenated; MSW hit count equals 2', async () => {
    // First call returns page1 (next_token: "abc123"); the helper default
    // (200-ok.json) is NOT what page 2 needs, so override the next two
    // responses explicitly.
    helper.setNextResponse(loadFixture('200-paginated-page1'));
    // After the first override fires, the next request would hit the
    // default fixture — which has next_token: null and one row. We need
    // page2 (next_token: null, 2 rows) for the second hit instead.
    // Strategy: queue page2 as a second override by re-arming after the
    // first request returns. Simpler: use a multi-fixture sequence by
    // arming page2 only after the first hit lands. paginateAll calls
    // sequentially, so by the time the second fetch fires, the helper has
    // reverted to the default. Re-arm via a beforeFetch wrapper.
    //
    // Cleanest deterministic pattern: replace MSW handler with a counter
    // that walks both pages.
    helper.server.resetHandlers();
    helper.resetHitCount();
    let hits = 0;
    const { http, HttpResponse } = await import('msw');
    helper.server.use(
      http.get('https://api.prod.whoop.com/v2/cycle', () => {
        hits += 1;
        const fixture =
          hits === 1 ? loadFixture('200-paginated-page1') : loadFixture('200-paginated-page2');
        return HttpResponse.json(fixture as Record<string, unknown>);
      }),
    );

    const cycles = await listCycles({
      since: SINCE,
      until: UNTIL,
      ianaZone: IANA_ZONE,
      priorTimezoneOffset: null,
    });
    // Page1 has 3 records, page2 has 2 → 5 total.
    expect(cycles).toHaveLength(5);
    expect(hits).toBe(2);
  });

  test('Test 7: pagination dup-ID assertion — same id across two pages throws WhoopApiError(validation)', async () => {
    // Synthesize a 2-page response where the same id appears on both
    // pages — Pitfall 10 + paginateAll dup-key Set must throw.
    helper.server.resetHandlers();
    let hits = 0;
    const { http, HttpResponse } = await import('msw');
    helper.server.use(
      http.get('https://api.prod.whoop.com/v2/cycle', () => {
        hits += 1;
        if (hits === 1) {
          return HttpResponse.json(loadFixture('200-paginated-page1') as Record<string, unknown>);
        }
        // Page2: contains the same first id (1001) as page1 → collision.
        const page1 = loadFixture('200-paginated-page1') as {
          records: unknown[];
          next_token: string | null;
        };
        return HttpResponse.json({
          records: [page1.records[0]],
          next_token: null,
        });
      }),
    );

    let captured: unknown;
    try {
      await listCycles({
        since: SINCE,
        until: UNTIL,
        ianaZone: IANA_ZONE,
        priorTimezoneOffset: null,
      });
    } catch (err) {
      captured = err;
    }
    expect(captured).toBeInstanceOf(WhoopApiError);
    expect((captured as InstanceType<typeof WhoopApiError>).kind).toBe('validation');
    expect((captured as InstanceType<typeof WhoopApiError>).message).toMatch(/duplicate key/);
  });
});

describe('cycles contract — Pitfall H mixed-score-states + D-04 SCORED-only filter', () => {
  test('Test 8: 200-mixed-score-states fixture — 3 score states survive the pipeline; default byRange returns SCORED only', async () => {
    helper.setNextResponse(loadFixture('200-mixed-score-states'));
    const cycles = await listCycles({
      since: SINCE,
      until: UNTIL,
      ianaZone: IANA_ZONE,
      priorTimezoneOffset: null,
    });
    expect(cycles).toHaveLength(3);
    const states = cycles.map((c) => c.scoreState).sort();
    expect(states).toEqual(['PENDING_SCORE', 'SCORED', 'UNSCORABLE']);

    const repo = createCyclesRepo(mem.db);
    const upsertResult = repo.upsertBatch(cycles);
    expect(upsertResult.changed).toBe(3);

    // D-04 default filter: SCORED only.
    const defaultRows = repo.byRange(SINCE, UNTIL);
    expect(defaultRows).toHaveLength(1);
    expect(defaultRows[0]?.scoreState).toBe('SCORED');

    // Escape hatch: includeUnscored returns all 3.
    const allRows = repo.byRange(SINCE, UNTIL, { includeUnscored: true });
    expect(allRows).toHaveLength(3);
  });

  test('Test 9: getRawJson(id) returns a JSON string for the SCORED row', async () => {
    // Wire the raw_json column by feeding the real WHOOP wire payload
    // through upsertBatch. The cycle entity does not carry rawJson; the
    // repo's entityToRow defaults raw_json to '{}' when absent, so we
    // attach the wire payload via the optional rawJson side-channel
    // (matches the cycles.repo.test.ts pattern).
    const cycles = await listCycles({
      since: SINCE,
      until: UNTIL,
      ianaZone: IANA_ZONE,
      priorTimezoneOffset: null,
    });
    const repo = createCyclesRepo(mem.db);
    const fixturePayload = JSON.stringify(
      (loadFixture('200-ok') as { records: unknown[] }).records[0],
    );
    const withRaw = cycles.map((c) => ({ ...c, rawJson: fixturePayload }));
    repo.upsertBatch(withRaw);
    const raw = repo.getRawJson(12345678);
    expect(raw).toBe(fixturePayload);
  });
});
