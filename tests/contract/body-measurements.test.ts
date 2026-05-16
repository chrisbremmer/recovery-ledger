// Contract test for the body-measurements resource path (SYNC-07 anchor;
// D-35 append-on-change verification).
//
// Single-shot resource (A4 — no pagination, no since/until). Drives:
// MSW intercepts → getBodyMeasurement() → normalizeBodyMeasurement →
// bodyMeasurementsRepo.upsertOnChange. D-35: insert ONLY when the
// (height, weight, max_heart_rate) tuple differs from the latest row;
// otherwise return {inserted: false} and leave the history untouched.
//
// ADR-0006: onUnhandledRequest:'error' on MSW. The injected clock is
// explicit per call so captured_at is deterministic and `latest()`
// orderBy(desc(captured_at)) is unambiguous in Test 3.

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';
import { createInMemoryDb, type InMemoryDbResult } from '../helpers/in-memory-db.js';
import {
  createWhoopBodyMeasurementsHelper,
  type WhoopBodyMeasurementsHelper,
} from '../helpers/msw-whoop-body-measurements.js';

vi.mock('../../src/services/refresh-orchestrator.js', () => ({
  callWithAuth: (op: (token: string) => Promise<unknown>) => op('test-token-123'),
}));

const { getBodyMeasurement } = await import(
  '../../src/infrastructure/whoop/resources/body-measurements.js'
);
const { createBodyMeasurementsRepo } = await import(
  '../../src/infrastructure/db/repositories/body-measurements.repo.js'
);
const { _resetForTest: resetRateLimit } = await import(
  '../../src/infrastructure/whoop/rate-limit.js'
);

vi.setConfig({ testTimeout: 5_000 });

const FIXTURE_USER_ID = 100001;
const RAW_JSON = '{"user_id":100001,"height_meter":1.78,"weight_kilogram":78.5}';

let helper: WhoopBodyMeasurementsHelper;
let mem: InMemoryDbResult;

beforeAll(() => {
  helper = createWhoopBodyMeasurementsHelper();
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

describe('body-measurements contract — first measurement (insert)', () => {
  test('Test 1: first getBodyMeasurement + upsertOnChange inserts; listAll returns 1 row', async () => {
    const { entity } = await getBodyMeasurement();
    const repo = createBodyMeasurementsRepo(mem.db);
    const result = repo.upsertOnChange(
      {
        userId: entity.userId,
        heightMeter: entity.heightMeter,
        weightKilogram: entity.weightKilogram,
        maxHeartRate: entity.maxHeartRate,
        rawJson: RAW_JSON,
      },
      { clock: new Date('2026-05-15T12:00:00.000Z') },
    );
    expect(result.inserted).toBe(true);

    const rows = repo.listAll();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.weightKilogram).toBe(78.5);
  });
});

describe('body-measurements contract — D-35 append-on-change', () => {
  test('Test 2: identical second measurement does NOT insert; listAll stays at 1', async () => {
    const repo = createBodyMeasurementsRepo(mem.db);
    const first = await getBodyMeasurement();
    repo.upsertOnChange(
      {
        userId: first.entity.userId,
        heightMeter: first.entity.heightMeter,
        weightKilogram: first.entity.weightKilogram,
        maxHeartRate: first.entity.maxHeartRate,
        rawJson: RAW_JSON,
      },
      { clock: new Date('2026-05-15T12:00:00.000Z') },
    );
    const second = await getBodyMeasurement();
    const result = repo.upsertOnChange(
      {
        userId: second.entity.userId,
        heightMeter: second.entity.heightMeter,
        weightKilogram: second.entity.weightKilogram,
        maxHeartRate: second.entity.maxHeartRate,
        rawJson: RAW_JSON,
      },
      { clock: new Date('2026-05-16T12:00:00.000Z') },
    );
    expect(result.inserted).toBe(false);
    expect(repo.listAll()).toHaveLength(1);
    expect(helper.getHitCount()).toBe(2);
  });

  test('Test 3: weight change triggers insert; listAll returns 2 rows (history accumulates)', async () => {
    const repo = createBodyMeasurementsRepo(mem.db);
    const first = await getBodyMeasurement();
    repo.upsertOnChange(
      {
        userId: first.entity.userId,
        heightMeter: first.entity.heightMeter,
        weightKilogram: first.entity.weightKilogram,
        maxHeartRate: first.entity.maxHeartRate,
        rawJson: RAW_JSON,
      },
      { clock: new Date('2026-05-15T12:00:00.000Z') },
    );
    // Override the next MSW response with a +1.0kg weight delta.
    helper.setNextResponse({
      user_id: FIXTURE_USER_ID,
      height_meter: 1.78,
      weight_kilogram: 79.5,
      max_heart_rate: 188,
    });
    const second = await getBodyMeasurement();
    const result = repo.upsertOnChange(
      {
        userId: second.entity.userId,
        heightMeter: second.entity.heightMeter,
        weightKilogram: second.entity.weightKilogram,
        maxHeartRate: second.entity.maxHeartRate,
        rawJson: '{"user_id":100001,"weight_kilogram":79.5}',
      },
      { clock: new Date('2026-05-22T12:00:00.000Z') },
    );
    expect(result.inserted).toBe(true);
    expect(repo.listAll()).toHaveLength(2);
  });

  test('Test 4: latest() after a weight bump returns the new weight value', async () => {
    const repo = createBodyMeasurementsRepo(mem.db);
    const first = await getBodyMeasurement();
    repo.upsertOnChange(
      {
        userId: first.entity.userId,
        heightMeter: first.entity.heightMeter,
        weightKilogram: first.entity.weightKilogram,
        maxHeartRate: first.entity.maxHeartRate,
        rawJson: RAW_JSON,
      },
      { clock: new Date('2026-05-15T12:00:00.000Z') },
    );
    helper.setNextResponse({
      user_id: FIXTURE_USER_ID,
      height_meter: 1.78,
      weight_kilogram: 79.5,
      max_heart_rate: 188,
    });
    const second = await getBodyMeasurement();
    repo.upsertOnChange(
      {
        userId: second.entity.userId,
        heightMeter: second.entity.heightMeter,
        weightKilogram: second.entity.weightKilogram,
        maxHeartRate: second.entity.maxHeartRate,
        rawJson: '{"user_id":100001,"weight_kilogram":79.5}',
      },
      { clock: new Date('2026-05-22T12:00:00.000Z') },
    );
    const latest = repo.latest();
    expect(latest).not.toBeNull();
    expect(latest?.weightKilogram).toBe(79.5);
  });
});

describe('body-measurements contract — captured_at from injected clock', () => {
  test('Test 5: captured_at on the inserted row matches the injected clock ISO string', async () => {
    const repo = createBodyMeasurementsRepo(mem.db);
    const fixedClock = new Date('2026-05-15T12:34:56.789Z');
    const { entity } = await getBodyMeasurement();
    repo.upsertOnChange(
      {
        userId: entity.userId,
        heightMeter: entity.heightMeter,
        weightKilogram: entity.weightKilogram,
        maxHeartRate: entity.maxHeartRate,
        rawJson: RAW_JSON,
      },
      { clock: fixedClock },
    );
    const latest = repo.latest();
    expect(latest?.capturedAt).toBe(fixedClock.toISOString());
  });
});
