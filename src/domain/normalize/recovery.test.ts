// Recovery normalizer tests — per-score-state branch coverage, compound-PK
// preservation, snake → camel mapping lock.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { WhoopRawRecovery } from '../schemas/whoop-api.js';
import { normalizeRecovery } from './recovery.js';

const FIXTURES_DIR = join(process.cwd(), 'tests', 'fixtures', 'whoop', 'recovery');

describe('normalizeRecovery', () => {
  it('Test 1: SCORED recovery → all score fields present (snake → camel)', () => {
    const fixture = JSON.parse(
      readFileSync(join(FIXTURES_DIR, '200-mixed-score-states.json'), 'utf8'),
    ) as { records: unknown[] };
    const raw = WhoopRawRecovery.parse(fixture.records[0]);
    const entity = normalizeRecovery(raw);

    expect(entity.scoreState).toBe('SCORED');
    if (entity.scoreState !== 'SCORED') throw new Error('expected SCORED');
    expect(entity.recoveryScore).toBe(68);
    expect(entity.restingHeartRate).toBe(58);
    expect(entity.hrvRmssdMilli).toBe(40.1);
    expect(entity.spo2Percentage).toBe(96.5);
    expect(entity.skinTempCelsius).toBe(33.0);
    expect(entity.userCalibrating).toBe(false);
  });

  it('Test 2: PENDING_SCORE + UNSCORABLE recoveries have no score fields', () => {
    const fixture = JSON.parse(
      readFileSync(join(FIXTURES_DIR, '200-mixed-score-states.json'), 'utf8'),
    ) as { records: unknown[] };

    const pendingRaw = WhoopRawRecovery.parse(fixture.records[1]);
    const pendingEntity = normalizeRecovery(pendingRaw);
    expect(pendingEntity.scoreState).toBe('PENDING_SCORE');
    expect((pendingEntity as { recoveryScore?: number }).recoveryScore).toBeUndefined();
    expect((pendingEntity as { restingHeartRate?: number }).restingHeartRate).toBeUndefined();

    const unscorableRaw = WhoopRawRecovery.parse(fixture.records[2]);
    const unscorableEntity = normalizeRecovery(unscorableRaw);
    expect(unscorableEntity.scoreState).toBe('UNSCORABLE');
    expect((unscorableEntity as { recoveryScore?: number }).recoveryScore).toBeUndefined();
  });

  it('Test 3: compound key (cycleId, sleepId) preserved on entity', () => {
    const fixture = JSON.parse(
      readFileSync(join(FIXTURES_DIR, '200-mixed-score-states.json'), 'utf8'),
    ) as { records: unknown[] };
    const raw = WhoopRawRecovery.parse(fixture.records[0]);
    const entity = normalizeRecovery(raw);

    expect(entity.cycleId).toBe(40001);
    expect(entity.sleepId).toBe('a712fd26-deab-4bec-9503-2cc6a8fbab3f');
    // Snake-case fields should NOT exist
    const opaque = entity as unknown as Record<string, unknown>;
    expect(opaque.cycle_id).toBeUndefined();
    expect(opaque.sleep_id).toBeUndefined();
  });

  it('Test 4: snake → camel mapping locked across all SCORED fields', () => {
    const fixture = JSON.parse(
      readFileSync(join(FIXTURES_DIR, '200-mixed-score-states.json'), 'utf8'),
    ) as { records: unknown[] };
    const raw = WhoopRawRecovery.parse(fixture.records[0]);
    const entity = normalizeRecovery(raw);

    if (entity.scoreState !== 'SCORED') throw new Error('expected SCORED');
    // hrv_rmssd_milli → hrvRmssdMilli (preserves the milli suffix)
    expect(entity.hrvRmssdMilli).toBe(40.1);
    // spo2_percentage → spo2Percentage
    expect(entity.spo2Percentage).toBe(96.5);
    // skin_temp_celsius → skinTempCelsius
    expect(entity.skinTempCelsius).toBe(33.0);
    // userId mapping
    expect(entity.userId).toBe(100001);
    // createdAt / updatedAt
    expect(entity.createdAt).toBe('2026-05-13T08:30:00.000Z');
    expect(entity.updatedAt).toBe('2026-05-13T20:30:00.000Z');
    // Raw snake_case fields should be absent
    const opaque = entity as unknown as Record<string, unknown>;
    expect(opaque.hrv_rmssd_milli).toBeUndefined();
    expect(opaque.spo2_percentage).toBeUndefined();
  });
});
