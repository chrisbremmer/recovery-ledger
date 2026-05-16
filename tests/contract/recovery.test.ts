// Contract test for the recovery resource path (SYNC-07 + Pitfall G anchor).
//
// Drives the full Wave-3+4 stack end-to-end: MSW intercepts → listRecovery()
// (resource module + httpGet + paginateAll with the compound-key keyFn
// extension) → normalizeRecovery → recoveryRepo.upsertBatch (compound
// ON CONFLICT(cycle_id, sleep_id)) → recoveryRepo.byRange / byCycleAndSleep.
//
// Pitfall G verification anchor: the recovery 200-mixed-score-states
// fixture carries three rows (SCORED + PENDING_SCORE + UNSCORABLE) keyed
// by `(cycle_id, sleep_id)`. The pipeline must:
//   - Dedup on the compound key (no row dropped via the paginateAll
//     default keyFn collapsing to `"undefined"` — Plan 03-09 passes the
//     explicit `(row) => row.cycle_id + ':' + row.sleep_id` keyFn).
//   - Upsert all 3 rows (D-11 + ON CONFLICT(cycle_id, sleep_id) target).
//   - Return SCORED-only by default in byRange (D-04 / Pitfall 3).
//   - Return all 3 with `{includeUnscored: true}`.
//   - byCycleAndSleep returns the PENDING_SCORE entity narrowed to its
//     three-field shape (no score fields present on the type).
//
// FK ordering: `recoveries.cycle_id REFERENCES cycles(id)`. The fixture
// uses cycle_ids 40001/40002/40003 — those must exist in the cycles table
// before the recovery upsert fires. Each test seeds parent cycles first.
//
// vi.mock of `services/refresh-orchestrator.js` mirrors client.test.ts so
// the contract test does not touch the OS keychain.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';
import type { Cycle, Recovery } from '../../src/domain/types/entities.js';
import { createInMemoryDb, type InMemoryDbResult } from '../helpers/in-memory-db.js';
import {
  createWhoopRecoveryHelper,
  type WhoopRecoveryHelper,
} from '../helpers/msw-whoop-recovery.js';

vi.mock('../../src/services/refresh-orchestrator.js', () => ({
  callWithAuth: (op: (token: string) => Promise<unknown>) => op('test-token-123'),
}));

const { listRecovery } = await import('../../src/infrastructure/whoop/resources/recovery.js');
const { createRecoveryRepo } = await import(
  '../../src/infrastructure/db/repositories/recovery.repo.js'
);
const { createCyclesRepo } = await import(
  '../../src/infrastructure/db/repositories/cycles.repo.js'
);
const { _resetForTest: resetRateLimit } = await import(
  '../../src/infrastructure/whoop/rate-limit.js'
);
const { WhoopApiError } = await import('../../src/infrastructure/whoop/errors.js');

vi.setConfig({ testTimeout: 5_000 });

const FIXTURES_DIR = join(process.cwd(), 'tests', 'fixtures', 'whoop', 'recovery');

function loadFixture(name: string): unknown {
  return JSON.parse(readFileSync(join(FIXTURES_DIR, `${name}.json`), 'utf8'));
}

const SINCE = '2026-01-01T00:00:00.000Z';
const UNTIL = '2026-12-31T23:59:59.999Z';
const BASE_USER_ID = 100001;

function makeParentCycle(id: number): Cycle {
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
    baselineExcluded: false,
    exclusionReason: null,
  };
}

function seedParentCycles(mem: InMemoryDbResult, ids: number[]): void {
  const cyclesRepo = createCyclesRepo(mem.db);
  cyclesRepo.upsertBatch(ids.map((id) => makeParentCycle(id)));
}

let helper: WhoopRecoveryHelper;
let mem: InMemoryDbResult;

beforeAll(() => {
  helper = createWhoopRecoveryHelper();
  // ADR-0006: any accidental live network call fails the test loudly.
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

describe('recovery contract — happy path + idempotency (D-11 / SYNC-04)', () => {
  test('Test 1: happy path — listRecovery + upsertBatch + byCycleAndSleep round-trip returns the SCORED entity', async () => {
    // Default fixture: cycle_id 12345678 + sleep_id a98fe018-...
    seedParentCycles(mem, [12345678]);
    const recoveries = await listRecovery({ since: SINCE, until: UNTIL });
    expect(recoveries).toHaveLength(1);
    expect(recoveries[0]?.scoreState).toBe('SCORED');

    const repo = createRecoveryRepo(mem.db);
    const upsertResult = repo.upsertBatch(recoveries);
    expect(upsertResult.changed).toBe(1);

    const stored = repo.byCycleAndSleep(12345678, 'a98fe018-e629-4be3-97a6-529077ea7f24');
    expect(stored).not.toBeNull();
    expect(stored?.scoreState).toBe('SCORED');
    if (stored?.scoreState === 'SCORED') {
      expect(stored.recoveryScore).toBe(73);
    }
  });

  test('Test 2: idempotency — compound ON CONFLICT(cycle_id, sleep_id) keeps the row count at 1', async () => {
    seedParentCycles(mem, [12345678]);
    const repo = createRecoveryRepo(mem.db);
    const first = await listRecovery({ since: SINCE, until: UNTIL });
    repo.upsertBatch(first);
    const second = await listRecovery({ since: SINCE, until: UNTIL });
    repo.upsertBatch(second);

    const count = (
      mem.sqlite.prepare('SELECT COUNT(*) AS c FROM recoveries').get() as { c: number }
    ).c;
    expect(count).toBe(1);
    expect(helper.getHitCount()).toBe(2);
  });
});

describe('recovery contract — Pitfall G score-state discipline (200-mixed-score-states anchor)', () => {
  test('Test 3: mixed-score-states fixture upserts 3 rows; default byRange returns SCORED only, includeUnscored returns all 3', async () => {
    // Parent cycles for the three recovery rows.
    seedParentCycles(mem, [40001, 40002, 40003]);
    helper.setNextResponse(loadFixture('200-mixed-score-states'));

    const recoveries = await listRecovery({ since: SINCE, until: UNTIL });
    expect(recoveries).toHaveLength(3);
    const states = recoveries.map((r) => r.scoreState).sort();
    expect(states).toEqual(['PENDING_SCORE', 'SCORED', 'UNSCORABLE']);

    const repo = createRecoveryRepo(mem.db);
    const upsertResult = repo.upsertBatch(recoveries);
    expect(upsertResult.changed).toBe(3);

    // D-04 default filter: SCORED only.
    const defaultRows = repo.byRange(SINCE, UNTIL);
    expect(defaultRows).toHaveLength(1);
    expect(defaultRows[0]?.scoreState).toBe('SCORED');

    // Escape hatch: includeUnscored returns all 3.
    const allRows = repo.byRange(SINCE, UNTIL, { includeUnscored: true });
    expect(allRows).toHaveLength(3);

    // Compound-key point lookup for the PENDING_SCORE row — entity has
    // none of the score fields (D-03 + ADR-0003 DU narrowing).
    const pending = repo.byCycleAndSleep(40002, 'bb8c0f52-773e-4875-820b-df64d972ff13');
    expect(pending).not.toBeNull();
    expect(pending?.scoreState).toBe('PENDING_SCORE');

    // Compile-time forcing function: accessing `.recoveryScore` off a
    // narrowed PENDING_SCORE entity must be a type error. The
    // `@ts-expect-error` would fail to compile if the field were
    // accidentally added to RecoveryPending or if narrowing broke.
    if (pending?.scoreState === 'PENDING_SCORE') {
      // @ts-expect-error PENDING_SCORE entity carries no recoveryScore field (Pitfall G DU lock)
      const _shouldNotCompile: number = pending.recoveryScore;
      // Reference the binding so Biome does not strip the unused-local check.
      void _shouldNotCompile;
    }
  });
});

describe('recovery contract — pagination dup-key detection for compound keys (Pitfall 10)', () => {
  test('Test 4: same (cycle_id, sleep_id) across two pages throws WhoopApiError(validation) via the compound-key keyFn', async () => {
    // Seed enough parent cycles for the synthetic fixtures.
    seedParentCycles(mem, [40001, 40002]);
    helper.server.resetHandlers();
    let hits = 0;
    const { http, HttpResponse } = await import('msw');
    const sharedRow = {
      cycle_id: 40001,
      sleep_id: 'a712fd26-deab-4bec-9503-2cc6a8fbab3f',
      user_id: BASE_USER_ID,
      created_at: '2026-05-13T08:30:00.000Z',
      updated_at: '2026-05-13T20:30:00.000Z',
      score_state: 'SCORED',
      score: {
        user_calibrating: false,
        recovery_score: 68,
        resting_heart_rate: 58,
        hrv_rmssd_milli: 40.1,
        spo2_percentage: 96.5,
        skin_temp_celsius: 33.0,
      },
    };
    const otherRow = {
      cycle_id: 40002,
      sleep_id: 'bb8c0f52-773e-4875-820b-df64d972ff13',
      user_id: BASE_USER_ID,
      created_at: '2026-05-14T08:30:00.000Z',
      updated_at: '2026-05-14T20:30:00.000Z',
      score_state: 'SCORED',
      score: {
        user_calibrating: false,
        recovery_score: 70,
        resting_heart_rate: 56,
        hrv_rmssd_milli: 42.0,
        spo2_percentage: 96.6,
        skin_temp_celsius: 33.1,
      },
    };
    helper.server.use(
      http.get('https://api.prod.whoop.com/v2/recovery', () => {
        hits += 1;
        if (hits === 1) {
          return HttpResponse.json({
            records: [sharedRow, otherRow],
            next_token: 'page2',
          });
        }
        // Page 2 repeats sharedRow → compound-key collision.
        return HttpResponse.json({
          records: [sharedRow],
          next_token: null,
        });
      }),
    );

    let captured: unknown;
    try {
      await listRecovery({ since: SINCE, until: UNTIL });
    } catch (err) {
      captured = err;
    }
    expect(captured).toBeInstanceOf(WhoopApiError);
    expect((captured as InstanceType<typeof WhoopApiError>).kind).toBe('validation');
    // The dup-key detail spells the compound key.
    expect((captured as InstanceType<typeof WhoopApiError>).message).toMatch(
      /duplicate key 40001:/,
    );
  });
});

describe('recovery contract — getRawJson diagnostic seam (D-29)', () => {
  test('Test 5: getRawJson(cycleId, sleepId) returns the stored wire payload for the SCORED row', async () => {
    seedParentCycles(mem, [12345678]);
    const recoveries = await listRecovery({ since: SINCE, until: UNTIL });
    const repo = createRecoveryRepo(mem.db);
    const fixturePayload = JSON.stringify(
      (loadFixture('200-ok') as { records: unknown[] }).records[0],
    );
    const withRaw: Recovery[] = recoveries.map(
      (r) =>
        ({ ...r, rawJson: fixturePayload }) as Recovery & {
          rawJson: string;
        },
    );
    repo.upsertBatch(withRaw);
    const raw = repo.getRawJson(12345678, 'a98fe018-e629-4be3-97a6-529077ea7f24');
    expect(raw).toBe(fixturePayload);
  });
});
