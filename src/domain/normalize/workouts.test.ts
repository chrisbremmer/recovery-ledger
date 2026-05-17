// Workout normalizer tests — per-score-state branch coverage (checker
// Warning #9 + Pitfall 3 defense). Mirrors sleep.test.ts: three
// score-state branches plus snake → camel mapping plus UUID id +
// sport_id preservation.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { WhoopRawWorkout } from '../schemas/whoop-api.js';
import { normalizeWorkout } from './workouts.js';

const FIXTURES_DIR = join(process.cwd(), 'tests', 'fixtures', 'whoop', 'workouts');

const PENDING_WORKOUT = {
  id: '0c9df492-72b3-4fb3-8113-3eb522ede16d',
  user_id: 100001,
  created_at: '2026-05-11T18:00:00.000Z',
  updated_at: '2026-05-11T19:30:00.000Z',
  start: '2026-05-11T17:30:00.000Z',
  end: '2026-05-11T18:30:00.000Z',
  timezone_offset: '-08:00',
  sport_id: 1,
  score_state: 'PENDING_SCORE' as const,
};

const UNSCORABLE_WORKOUT = {
  id: '1d0ef593-82c4-4fb3-8113-3eb522ede16e',
  user_id: 100001,
  created_at: '2026-05-12T18:00:00.000Z',
  updated_at: '2026-05-12T19:30:00.000Z',
  start: '2026-05-12T17:30:00.000Z',
  end: '2026-05-12T18:30:00.000Z',
  timezone_offset: '-08:00',
  sport_id: null,
  score_state: 'UNSCORABLE' as const,
};

describe('normalizeWorkout', () => {
  it("Test 1 [SCORED branch]: returns Workout with scoreState='SCORED' and all score fields", () => {
    const fixture = JSON.parse(readFileSync(join(FIXTURES_DIR, '200-ok.json'), 'utf8')) as {
      records: unknown[];
    };
    const raw = WhoopRawWorkout.parse(fixture.records[0]);
    const entity = normalizeWorkout(raw);

    expect(entity.scoreState).toBe('SCORED');
    if (entity.scoreState !== 'SCORED') throw new Error('expected SCORED');
    expect(entity.strain).toBe(12.8);
    expect(entity.averageHeartRate).toBe(142);
    expect(entity.maxHeartRate).toBe(178);
    expect(entity.kilojoule).toBe(1450.2);
    expect(entity.distanceMeter).toBe(8400.0);
    expect(entity.altitudeGainMeter).toBe(42.0);
    expect(entity.altitudeChangeMeter).toBe(12.0);
  });

  it("Test 2 [PENDING_SCORE branch]: returns Workout with scoreState='PENDING_SCORE' and NO score fields", () => {
    const raw = WhoopRawWorkout.parse(PENDING_WORKOUT);
    const entity = normalizeWorkout(raw);

    expect(entity.scoreState).toBe('PENDING_SCORE');
    expect((entity as { strain?: number }).strain).toBeUndefined();
    expect((entity as { averageHeartRate?: number }).averageHeartRate).toBeUndefined();
    expect((entity as { distanceMeter?: number | null }).distanceMeter).toBeUndefined();
  });

  it("Test 3 [UNSCORABLE branch]: returns Workout with scoreState='UNSCORABLE' and NO score fields", () => {
    const raw = WhoopRawWorkout.parse(UNSCORABLE_WORKOUT);
    const entity = normalizeWorkout(raw);

    expect(entity.scoreState).toBe('UNSCORABLE');
    expect((entity as { strain?: number }).strain).toBeUndefined();
    expect((entity as { kilojoule?: number }).kilojoule).toBeUndefined();
  });

  it('Test 4: snake → camel mapping locked (average_heart_rate, altitude_gain_meter, distance_meter)', () => {
    const fixture = JSON.parse(readFileSync(join(FIXTURES_DIR, '200-ok.json'), 'utf8')) as {
      records: unknown[];
    };
    const raw = WhoopRawWorkout.parse(fixture.records[0]);
    const entity = normalizeWorkout(raw);

    if (entity.scoreState !== 'SCORED') throw new Error('expected SCORED');
    expect(entity.averageHeartRate).toBe(142);
    expect(entity.altitudeGainMeter).toBe(42.0);
    expect(entity.altitudeChangeMeter).toBe(12.0);
    expect(entity.distanceMeter).toBe(8400.0);
    expect(entity.timezoneOffset).toBe('-08:00');
    // Raw snake-case names absent
    const opaque = entity as unknown as Record<string, unknown>;
    expect(opaque.average_heart_rate).toBeUndefined();
    expect(opaque.altitude_gain_meter).toBeUndefined();
    expect(opaque.altitude_change_meter).toBeUndefined();
    expect(opaque.distance_meter).toBeUndefined();
    expect(opaque.timezone_offset).toBeUndefined();
    expect(opaque.sport_id).toBeUndefined();
  });

  it('Test 5: UUID id + sport_id preserved on the Workout entity', () => {
    const fixture = JSON.parse(readFileSync(join(FIXTURES_DIR, '200-ok.json'), 'utf8')) as {
      records: unknown[];
    };
    const raw = WhoopRawWorkout.parse(fixture.records[0]);
    const entity = normalizeWorkout(raw);

    expect(entity.id).toBe('fb8ce391-62b3-4fb3-8113-3eb522ede16c');
    expect(typeof entity.id).toBe('string');
    expect(entity.sportId).toBe(0);

    // sport_id absent on wire → sportId coerced to null on entity
    const absentSportRaw = WhoopRawWorkout.parse({
      ...PENDING_WORKOUT,
      sport_id: undefined,
    });
    const absentSportEntity = normalizeWorkout(absentSportRaw);
    expect(absentSportEntity.sportId).toBe(null);
  });
});
