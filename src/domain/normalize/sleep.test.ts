// Sleep normalizer tests — per-score-state branch coverage (checker
// Warning #9 + Pitfall 3 defense). Each of the three score states gets
// its own assertion that the normalizer produces the right discriminant
// and that PENDING_SCORE / UNSCORABLE variants carry NO score fields.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { WhoopRawSleep } from '../schemas/whoop-api.js';
import { normalizeSleep } from './sleep.js';

const FIXTURES_DIR = join(process.cwd(), 'tests', 'fixtures', 'whoop', 'sleep');

// Synthetic PENDING and UNSCORABLE sleep payloads — base shape mirrors the
// SCORED fixture identifiers but with no `score` sub-object per the WHOOP
// v2 wire format (and the discriminated-union schema in whoop-api.ts).
const PENDING_SLEEP = {
  id: '8eea5994-9fb2-43a7-8e54-94a5c0d3227b',
  user_id: 100001,
  created_at: '2026-05-11T05:00:00.000Z',
  updated_at: '2026-05-11T15:00:00.000Z',
  start: '2026-05-11T05:00:00.000Z',
  end: '2026-05-11T13:00:00.000Z',
  timezone_offset: '-08:00',
  score_state: 'PENDING_SCORE' as const,
};

const UNSCORABLE_SLEEP = {
  id: '9ffa6a95-afc2-43a7-8e54-94a5c0d3227c',
  user_id: 100001,
  created_at: '2026-05-12T05:00:00.000Z',
  updated_at: '2026-05-12T15:00:00.000Z',
  start: '2026-05-12T05:00:00.000Z',
  end: '2026-05-12T13:00:00.000Z',
  timezone_offset: '-08:00',
  score_state: 'UNSCORABLE' as const,
};

describe('normalizeSleep', () => {
  it("Test 1 [SCORED branch]: returns Sleep entity with scoreState='SCORED' and all score fields", () => {
    const fixture = JSON.parse(readFileSync(join(FIXTURES_DIR, '200-ok.json'), 'utf8')) as {
      records: unknown[];
    };
    const raw = WhoopRawSleep.parse(fixture.records[0]);
    const entity = normalizeSleep(raw);

    expect(entity.scoreState).toBe('SCORED');
    if (entity.scoreState !== 'SCORED') throw new Error('expected SCORED');
    expect(entity.totalInBedTimeMilli).toBe(28800000);
    expect(entity.totalAwakeTimeMilli).toBe(1800000);
    expect(entity.sleepEfficiencyPercentage).toBe(93.7);
    expect(entity.sleepPerformancePercentage).toBe(88.5);
    expect(entity.sleepConsistencyPercentage).toBe(76.0);
    expect(entity.respiratoryRate).toBe(14.8);
  });

  it("Test 2 [PENDING_SCORE branch]: returns Sleep entity with scoreState='PENDING_SCORE' and NO score fields", () => {
    const raw = WhoopRawSleep.parse(PENDING_SLEEP);
    const entity = normalizeSleep(raw);

    expect(entity.scoreState).toBe('PENDING_SCORE');
    // Score-only fields must be absent (Pitfall 3 defense — silent
    // PENDING_SCORE leakage would put `undefined` in baseline math).
    expect((entity as { totalInBedTimeMilli?: number }).totalInBedTimeMilli).toBeUndefined();
    expect(
      (entity as { sleepEfficiencyPercentage?: number }).sleepEfficiencyPercentage,
    ).toBeUndefined();
    expect((entity as { respiratoryRate?: number }).respiratoryRate).toBeUndefined();
  });

  it("Test 3 [UNSCORABLE branch]: returns Sleep entity with scoreState='UNSCORABLE' and NO score fields", () => {
    const raw = WhoopRawSleep.parse(UNSCORABLE_SLEEP);
    const entity = normalizeSleep(raw);

    expect(entity.scoreState).toBe('UNSCORABLE');
    expect((entity as { totalInBedTimeMilli?: number }).totalInBedTimeMilli).toBeUndefined();
    expect(
      (entity as { sleepEfficiencyPercentage?: number }).sleepEfficiencyPercentage,
    ).toBeUndefined();
    expect((entity as { respiratoryRate?: number }).respiratoryRate).toBeUndefined();
  });

  it('Test 4: snake → camel mapping locked (total_in_bed_time_milli, sleep_efficiency_percentage, respiratory_rate)', () => {
    const fixture = JSON.parse(readFileSync(join(FIXTURES_DIR, '200-ok.json'), 'utf8')) as {
      records: unknown[];
    };
    const raw = WhoopRawSleep.parse(fixture.records[0]);
    const entity = normalizeSleep(raw);

    if (entity.scoreState !== 'SCORED') throw new Error('expected SCORED');
    // Score camel-case names exist
    expect(entity.totalInBedTimeMilli).toBe(28800000);
    expect(entity.sleepEfficiencyPercentage).toBe(93.7);
    expect(entity.respiratoryRate).toBe(14.8);
    // Top-level camel-case names exist
    expect(entity.timezoneOffset).toBe('-08:00');
    expect(entity.userId).toBe(100001);
    // Raw snake-case names absent
    const opaque = entity as unknown as Record<string, unknown>;
    expect(opaque.total_in_bed_time_milli).toBeUndefined();
    expect(opaque.sleep_efficiency_percentage).toBeUndefined();
    expect(opaque.respiratory_rate).toBeUndefined();
    expect(opaque.timezone_offset).toBeUndefined();
    expect(opaque.user_id).toBeUndefined();
  });

  it('Test 5: UUID id preserved on the Sleep entity', () => {
    const fixture = JSON.parse(readFileSync(join(FIXTURES_DIR, '200-ok.json'), 'utf8')) as {
      records: unknown[];
    };
    const raw = WhoopRawSleep.parse(fixture.records[0]);
    const entity = normalizeSleep(raw);

    expect(entity.id).toBe('7dee4993-8fa2-43a7-8e54-94a5c0d3227a');
    expect(typeof entity.id).toBe('string');
  });
});
