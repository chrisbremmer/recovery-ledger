// Body-measurements repository unit tests — locks the D-35 append-on-change
// semantics: a fresh insert only happens when the (height, weight,
// max_heart_rate) tuple differs from the latest row.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createInMemoryDb, type InMemoryDbResult } from '../../../../tests/helpers/in-memory-db.js';
import { createBodyMeasurementsRepo } from './body-measurements.repo.js';

const USER_ID = 100001;

function makeMeasurement(
  overrides: Partial<{
    userId: number;
    heightMeter: number;
    weightKilogram: number;
    maxHeartRate: number;
    rawJson: string;
  }> = {},
) {
  return {
    userId: USER_ID,
    heightMeter: 1.83,
    weightKilogram: 82.5,
    maxHeartRate: 191,
    rawJson: '{"height_meter":1.83,"weight_kilogram":82.5,"max_heart_rate":191}',
    ...overrides,
  };
}

describe('body-measurements repo — upsertOnChange()', () => {
  let mem: InMemoryDbResult;

  beforeEach(() => {
    mem = createInMemoryDb();
  });
  afterEach(() => mem.close());

  it('Test 1: first upsertOnChange inserts; listAll has one row', () => {
    const repo = createBodyMeasurementsRepo(mem.db);
    const result = repo.upsertOnChange(makeMeasurement(), {
      clock: new Date('2026-05-16T12:00:00.000Z'),
    });
    expect(result).toEqual({ inserted: true });
    expect(repo.listAll()).toHaveLength(1);
  });

  it('Test 2: second upsertOnChange with identical values does NOT insert', () => {
    const repo = createBodyMeasurementsRepo(mem.db);
    repo.upsertOnChange(makeMeasurement(), {
      clock: new Date('2026-05-16T12:00:00.000Z'),
    });
    const result = repo.upsertOnChange(makeMeasurement(), {
      clock: new Date('2026-05-17T12:00:00.000Z'),
    });
    expect(result).toEqual({ inserted: false });
    expect(repo.listAll()).toHaveLength(1);
  });

  it('Test 3: weight change triggers an insert; latest() returns the new weight', () => {
    const repo = createBodyMeasurementsRepo(mem.db);
    repo.upsertOnChange(makeMeasurement({ weightKilogram: 82.5 }), {
      clock: new Date('2026-05-16T12:00:00.000Z'),
    });
    const result = repo.upsertOnChange(makeMeasurement({ weightKilogram: 83.1 }), {
      clock: new Date('2026-05-23T12:00:00.000Z'),
    });
    expect(result).toEqual({ inserted: true });
    expect(repo.listAll()).toHaveLength(2);
    const latest = repo.latest();
    expect(latest?.weightKilogram).toBe(83.1);
  });

  it('Test 4: height change triggers an insert', () => {
    const repo = createBodyMeasurementsRepo(mem.db);
    repo.upsertOnChange(makeMeasurement({ heightMeter: 1.83 }), {
      clock: new Date('2026-05-16T12:00:00.000Z'),
    });
    const result = repo.upsertOnChange(makeMeasurement({ heightMeter: 1.84 }), {
      clock: new Date('2026-05-23T12:00:00.000Z'),
    });
    expect(result).toEqual({ inserted: true });
    expect(repo.listAll()).toHaveLength(2);
  });

  it('Test 5: max_heart_rate change triggers an insert', () => {
    const repo = createBodyMeasurementsRepo(mem.db);
    repo.upsertOnChange(makeMeasurement({ maxHeartRate: 191 }), {
      clock: new Date('2026-05-16T12:00:00.000Z'),
    });
    const result = repo.upsertOnChange(makeMeasurement({ maxHeartRate: 189 }), {
      clock: new Date('2026-05-23T12:00:00.000Z'),
    });
    expect(result).toEqual({ inserted: true });
    expect(repo.listAll()).toHaveLength(2);
  });

  it('Test 6: captured_at comes from opts.clock.toISOString() (injected, not Date.now())', () => {
    const repo = createBodyMeasurementsRepo(mem.db);
    const pinned = new Date('2026-05-16T12:00:00.000Z');
    repo.upsertOnChange(makeMeasurement(), { clock: pinned });
    const latest = repo.latest();
    expect(latest?.capturedAt).toBe('2026-05-16T12:00:00.000Z');
  });

  it('Test 7: getRawJson(id) returns the stored raw_json', () => {
    const repo = createBodyMeasurementsRepo(mem.db);
    const rawJson = '{"height_meter":1.83,"weight_kilogram":82.5,"max_heart_rate":191}';
    repo.upsertOnChange(makeMeasurement({ rawJson }), {
      clock: new Date('2026-05-16T12:00:00.000Z'),
    });
    const all = repo.listAll();
    expect(all).toHaveLength(1);
    const first = all[0];
    if (!first) throw new Error('expected one row');
    expect(repo.getRawJson(first.id)).toBe(rawJson);
  });
});
