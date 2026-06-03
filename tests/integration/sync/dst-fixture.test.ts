// DST-fixture integration test — DATA-06 + Pitfall H + Pitfall I anchor.
//
// Drives runSync against the three D-15 DST/tz fixtures committed in
// `tests/fixtures/whoop/cycles/`:
//   - 200-dst-spring-forward.json (Mar 8 2026 boundary)
//   - 200-dst-fall-back.json      (Nov 1 2026 boundary)
//   - 200-tz-trip-sfo-jfk.json    (offset -08:00 → -05:00 → -05:00)
//
// After sync, the cycles table is queried directly to confirm:
//   - DST-straddle cycles persist with baseline_excluded=1 +
//     exclusion_reason='dst_straddle'
//   - tz_drift cycles persist with baseline_excluded=1 +
//     exclusion_reason='tz_drift'
//   - Records on either side of the transition (no straddle, no drift)
//     persist with baseline_excluded=0
//
// Pitfall I anchor (Test 5): a retroactive WHOOP update that shifts a
// cycle's `start` past a DST boundary RE-RUNS the exclusion detector at
// upsert time (D-11's ON CONFLICT DO UPDATE re-applies every column,
// including baseline_excluded + exclusion_reason). This is the most
// subtle invariant in the phase — if the normalizer ran only on insert
// and not on update, a retroactive shift would silently keep the old
// flag. The test exercises this end-to-end.
//
// ADR-0006: onUnhandledRequest:'error' on MSW. Phase 10 ARCH-03 composes
// each resource factory with a fake `authedCall` instead of mocking the
// (now-deleted) `services/refresh-orchestrator` singleton.

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';
import { logger } from '../../../src/infrastructure/config/logger.js';
import { createBodyMeasurementsRepo } from '../../../src/infrastructure/db/repositories/body-measurements.repo.js';
import { createCyclesRepo } from '../../../src/infrastructure/db/repositories/cycles.repo.js';
import { createProfileRepo } from '../../../src/infrastructure/db/repositories/profile.repo.js';
import { createRecoveryRepo } from '../../../src/infrastructure/db/repositories/recovery.repo.js';
import { createSleepsRepo } from '../../../src/infrastructure/db/repositories/sleep.repo.js';
import { createSyncRunsRepo } from '../../../src/infrastructure/db/repositories/sync-runs.repo.js';
import { createWorkoutsRepo } from '../../../src/infrastructure/db/repositories/workouts.repo.js';
import type { AuthedCall } from '../../../src/infrastructure/whoop/client.js';
import { _resetForTest as resetRateLimit } from '../../../src/infrastructure/whoop/rate-limit.js';
import { createGetBodyMeasurement } from '../../../src/infrastructure/whoop/resources/body-measurements.js';
import { createListCycles } from '../../../src/infrastructure/whoop/resources/cycles.js';
import { createGetProfile } from '../../../src/infrastructure/whoop/resources/profile.js';
import { createListRecovery } from '../../../src/infrastructure/whoop/resources/recovery.js';
import { createListSleep } from '../../../src/infrastructure/whoop/resources/sleep.js';
import { createListWorkouts } from '../../../src/infrastructure/whoop/resources/workouts.js';
import { runSync } from '../../../src/services/sync/index.js';
import { createInMemoryDb, type InMemoryDbResult } from '../../helpers/in-memory-db.js';
import { type AllResourcesMswHelper, createAllResourcesMsw } from './helpers/all-resources-msw.js';

const authedCall: AuthedCall = (op) => op('test-token-123');
const listCycles = createListCycles({ authedCall });
const listRecovery = createListRecovery({ authedCall });
const listSleep = createListSleep({ authedCall });
const listWorkouts = createListWorkouts({ authedCall });
const getProfile = createGetProfile({ authedCall });
const getBodyMeasurement = createGetBodyMeasurement({ authedCall });

vi.setConfig({ testTimeout: 10_000 });

const IANA_ZONE = 'America/Los_Angeles';
const FIXED_CLOCK = new Date('2026-05-13T12:00:00.000Z');

// Helper: query baseline_excluded + exclusion_reason directly via raw
// SQL. The repo's byRange filters excluded rows by default; we need to
// see ALL rows including the excluded ones.
interface CycleFlags {
  id: number;
  baseline_excluded: number;
  exclusion_reason: string | null;
  timezone_offset: string;
}

function loadCycleFlags(mem: InMemoryDbResult, id: number): CycleFlags | null {
  const stmt = mem.sqlite.prepare(
    'SELECT id, baseline_excluded, exclusion_reason, timezone_offset FROM cycles WHERE id = ?',
  );
  return stmt.get(id) as CycleFlags | null;
}

let mswHelper: AllResourcesMswHelper;
let mem: InMemoryDbResult;

function buildDeps(memInstance: InMemoryDbResult): Parameters<typeof runSync>[1] {
  return {
    repos: {
      syncRuns: createSyncRunsRepo(memInstance.db),
      cycles: createCyclesRepo(memInstance.db),
      recoveries: createRecoveryRepo(memInstance.db),
      sleeps: createSleepsRepo(memInstance.db),
      workouts: createWorkoutsRepo(memInstance.db),
      profile: createProfileRepo(memInstance.db),
      bodyMeasurements: createBodyMeasurementsRepo(memInstance.db),
    },
    whoop: {
      resources: {
        cycles: listCycles,
        recoveries: listRecovery,
        sleeps: listSleep,
        workouts: listWorkouts,
        profile: getProfile,
        body_measurements: getBodyMeasurement,
      },
    },
    sqlite: memInstance.sqlite,
    clock: () => FIXED_CLOCK,
    ianaZone: () => IANA_ZONE,
    logger,
  };
}

beforeAll(() => {
  mswHelper = createAllResourcesMsw();
  mswHelper.server.listen({ onUnhandledRequest: 'error' });
});

afterAll(() => {
  mswHelper.server.close();
});

beforeEach(() => {
  resetRateLimit();
  mswHelper.resetHitCounts();
  mswHelper.server.resetHandlers();
  mem = createInMemoryDb();
});

afterEach(() => {
  mem.close();
});

describe('sync DST/tz fixtures — DATA-06 + Pitfall H + Pitfall I anchor', () => {
  // Recovery default fixture's cycle_id=12345678 is from the cycles default.
  // The DST/tz cycle fixtures use different ids (30001, 30002-style, 2001/2002/2003)
  // — recovery's FK lookup would fail. Override recovery (+ sleeps, workouts)
  // to empty page responses so the FK constraint stays satisfied.
  const EMPTY_PAGE = { records: [], next_token: null };

  test('Test 1: spring-forward fixture → cycle 30001 lands with baseline_excluded=1, exclusion_reason="dst_straddle"', async () => {
    mswHelper.setNextFixture('cycles', '200-dst-spring-forward');
    mswHelper.setNextResponse('recoveries', EMPTY_PAGE);
    mswHelper.setNextResponse('sleeps', EMPTY_PAGE);
    mswHelper.setNextResponse('workouts', EMPTY_PAGE);

    const deps = buildDeps(mem);
    const result = await runSync({ days: 30 }, deps);
    expect(result.status).toBe('ok');

    const row = loadCycleFlags(mem, 30001);
    expect(row).not.toBeNull();
    expect(row?.baseline_excluded).toBe(1);
    expect(row?.exclusion_reason).toBe('dst_straddle');
  });

  test('Test 2: fall-back fixture → same dst_straddle classification on the November boundary', async () => {
    // The fall-back fixture uses a different id; capture it dynamically
    // by reading the fixture file (avoid coupling test to fixture id).
    const { readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const fixtureRaw = readFileSync(
      join(process.cwd(), 'tests', 'fixtures', 'whoop', 'cycles', '200-dst-fall-back.json'),
      'utf8',
    );
    const fixture = JSON.parse(fixtureRaw) as { records: Array<{ id: number }> };
    const fallBackId = fixture.records[0]?.id;
    expect(fallBackId).toBeDefined();

    mswHelper.setNextFixture('cycles', '200-dst-fall-back');
    mswHelper.setNextResponse('recoveries', EMPTY_PAGE);
    mswHelper.setNextResponse('sleeps', EMPTY_PAGE);
    mswHelper.setNextResponse('workouts', EMPTY_PAGE);

    const deps = buildDeps(mem);
    await runSync({ days: 30 }, deps);

    if (fallBackId === undefined) {
      throw new Error('fall-back fixture has no id');
    }
    const row = loadCycleFlags(mem, fallBackId);
    expect(row).not.toBeNull();
    expect(row?.baseline_excluded).toBe(1);
    expect(row?.exclusion_reason).toBe('dst_straddle');
  });

  test('Test 3: tz-trip-sfo-jfk fixture → record 1 (id 2001, -08:00) clean, record 2 (id 2002, -05:00) tz_drift, record 3 (id 2003, -05:00) clean', async () => {
    mswHelper.setNextFixture('cycles', '200-tz-trip-sfo-jfk');
    mswHelper.setNextResponse('recoveries', EMPTY_PAGE);
    mswHelper.setNextResponse('sleeps', EMPTY_PAGE);
    mswHelper.setNextResponse('workouts', EMPTY_PAGE);

    const deps = buildDeps(mem);
    await runSync({ days: 30 }, deps);

    // Record 0 (id 2001, offset -08:00): no prior offset → no tz_drift.
    const row1 = loadCycleFlags(mem, 2001);
    expect(row1).not.toBeNull();
    expect(row1?.timezone_offset).toBe('-08:00');
    expect(row1?.baseline_excluded).toBe(0);
    expect(row1?.exclusion_reason).toBeNull();

    // Record 1 (id 2002, offset -05:00): prior offset -08:00 (record 0
    // within the same page) → tz_drift fires.
    const row2 = loadCycleFlags(mem, 2002);
    expect(row2).not.toBeNull();
    expect(row2?.timezone_offset).toBe('-05:00');
    expect(row2?.baseline_excluded).toBe(1);
    expect(row2?.exclusion_reason).toBe('tz_drift');

    // Record 2 (id 2003, offset -05:00): prior offset -05:00 (same) → no drift.
    const row3 = loadCycleFlags(mem, 2003);
    expect(row3).not.toBeNull();
    expect(row3?.timezone_offset).toBe('-05:00');
    expect(row3?.baseline_excluded).toBe(0);
    expect(row3?.exclusion_reason).toBeNull();
  });

  test('Test 4: re-running sync with NO data change preserves the exclusion flags (D-11 idempotent re-apply)', async () => {
    mswHelper.setNextFixture('cycles', '200-tz-trip-sfo-jfk');
    mswHelper.setNextResponse('recoveries', EMPTY_PAGE);
    mswHelper.setNextResponse('sleeps', EMPTY_PAGE);
    mswHelper.setNextResponse('workouts', EMPTY_PAGE);

    const deps = buildDeps(mem);
    await runSync({ days: 30 }, deps);
    const row2First = loadCycleFlags(mem, 2002);
    expect(row2First?.baseline_excluded).toBe(1);
    expect(row2First?.exclusion_reason).toBe('tz_drift');

    // Second sync — same fixture. ON CONFLICT DO UPDATE re-applies the
    // exclusion flags (D-11). The flag stays set; row count stays at 3.
    mswHelper.setNextFixture('cycles', '200-tz-trip-sfo-jfk');
    mswHelper.setNextResponse('recoveries', EMPTY_PAGE);
    mswHelper.setNextResponse('sleeps', EMPTY_PAGE);
    mswHelper.setNextResponse('workouts', EMPTY_PAGE);
    await runSync({ days: 30 }, deps);

    const row2After = loadCycleFlags(mem, 2002);
    expect(row2After?.baseline_excluded).toBe(1);
    expect(row2After?.exclusion_reason).toBe('tz_drift');

    // Total cycles count is still 3.
    const countRow = mem.sqlite.prepare('SELECT COUNT(*) AS c FROM cycles').get() as {
      c: number;
    };
    expect(countRow.c).toBe(3);
  });

  test('Test 5: Pitfall I — retroactive shift past a DST boundary RE-FLIPS baseline_excluded on the second sync', async () => {
    // First sync: a normal SCORED cycle, no DST straddle. Build the
    // payload inline so we control the start/end times deterministically.
    // Use a March cycle that's CLEARLY before the spring-forward boundary
    // (Mar 8 2026 02:00→03:00 PT). Start at Mar 1 (well before), so the
    // detector sees no straddle.
    const cycleId = 99001;
    const normalCycle = {
      records: [
        {
          id: cycleId,
          user_id: 100001,
          created_at: '2026-03-01T08:00:00.000Z',
          updated_at: '2026-03-01T20:00:00.000Z',
          start: '2026-03-01T07:00:00.000Z',
          end: '2026-03-02T07:00:00.000Z',
          timezone_offset: '-08:00',
          score_state: 'SCORED',
          score: {
            strain: 10.0,
            kilojoule: 7500.0,
            average_heart_rate: 65,
            max_heart_rate: 170,
          },
        },
      ],
      next_token: null,
    };
    mswHelper.setNextResponse('cycles', normalCycle);
    mswHelper.setNextResponse('recoveries', EMPTY_PAGE);
    mswHelper.setNextResponse('sleeps', EMPTY_PAGE);
    mswHelper.setNextResponse('workouts', EMPTY_PAGE);

    const deps = buildDeps(mem);
    await runSync({ days: 30 }, deps);

    const initial = loadCycleFlags(mem, cycleId);
    expect(initial).not.toBeNull();
    expect(initial?.baseline_excluded).toBe(0);
    expect(initial?.exclusion_reason).toBeNull();

    // Second sync: WHOOP retroactively updates the SAME cycle id — the
    // start has shifted past a DST boundary. The detector must re-run
    // at upsert time and flip baseline_excluded to 1. This is the
    // Pitfall I + D-11 + D-14 forcing function.
    const shiftedCycle = {
      records: [
        {
          ...normalCycle.records[0],
          // Shift the start so it straddles the spring-forward boundary
          // (Mar 8 02:00 local → 03:00 local). The cycle starts Mar 7
          // 22:00 PT and ends Mar 8 22:00 PT, encompassing the 02:00
          // → 03:00 jump that the dst-tz/detect.ts detector flags.
          start: '2026-03-08T06:00:00.000Z', // Mar 7 22:00 PT
          end: '2026-03-09T06:00:00.000Z', // Mar 8 22:00 PT
          updated_at: '2026-03-09T08:00:00.000Z',
        },
      ],
      next_token: null,
    };
    mswHelper.setNextResponse('cycles', shiftedCycle);
    mswHelper.setNextResponse('recoveries', EMPTY_PAGE);
    mswHelper.setNextResponse('sleeps', EMPTY_PAGE);
    mswHelper.setNextResponse('workouts', EMPTY_PAGE);
    await runSync({ days: 30 }, deps);

    const afterShift = loadCycleFlags(mem, cycleId);
    expect(afterShift).not.toBeNull();
    // Pitfall I anchor — the detector re-ran on update. The flag flipped.
    expect(afterShift?.baseline_excluded).toBe(1);
    expect(afterShift?.exclusion_reason).toBe('dst_straddle');

    // Only one row (same id, ON CONFLICT DO UPDATE).
    const countRow = mem.sqlite.prepare('SELECT COUNT(*) AS c FROM cycles').get() as {
      c: number;
    };
    expect(countRow.c).toBe(1);
  });
});
