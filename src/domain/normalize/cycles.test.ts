// Cycle normalizer tests — per-score-state branch coverage (Pitfall 3
// defense per ADR-0003), DST fixture round-trip (D-15), snake → camel
// mapping lock, and purity.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { WhoopRawCycle } from '../schemas/whoop-api.js';
import { normalizeCycle } from './cycles.js';

const FIXTURES_DIR = join(process.cwd(), 'tests', 'fixtures', 'whoop', 'cycles');

const SCORED_CYCLE = {
  id: 9001,
  user_id: 100001,
  created_at: '2026-04-01T08:00:00.000Z',
  updated_at: '2026-04-01T20:00:00.000Z',
  start: '2026-04-01T07:00:00.000Z',
  end: '2026-04-02T07:00:00.000Z',
  timezone_offset: '-07:00',
  score_state: 'SCORED' as const,
  score: {
    strain: 10.5,
    kilojoule: 7500.0,
    average_heart_rate: 62,
    max_heart_rate: 168,
  },
};

const PENDING_CYCLE = {
  id: 9002,
  user_id: 100001,
  created_at: '2026-04-02T08:00:00.000Z',
  updated_at: '2026-04-02T08:00:00.000Z',
  start: '2026-04-02T07:00:00.000Z',
  end: '2026-04-03T07:00:00.000Z',
  timezone_offset: '-07:00',
  score_state: 'PENDING_SCORE' as const,
};

const UNSCORABLE_CYCLE = {
  id: 9003,
  user_id: 100001,
  created_at: '2026-04-03T08:00:00.000Z',
  updated_at: '2026-04-03T08:00:00.000Z',
  start: '2026-04-03T07:00:00.000Z',
  end: '2026-04-04T07:00:00.000Z',
  timezone_offset: '-07:00',
  score_state: 'UNSCORABLE' as const,
};

describe('normalizeCycle', () => {
  it('Test 1: SCORED cycle → entity with scoreState=SCORED, strain set, baselineExcluded=false', () => {
    const raw = WhoopRawCycle.parse(SCORED_CYCLE);
    const entity = normalizeCycle(raw, {
      ianaZone: 'America/Los_Angeles',
      priorTimezoneOffset: '-07:00',
    });

    expect(entity.scoreState).toBe('SCORED');
    expect(entity.baselineExcluded).toBe(false);
    expect(entity.exclusionReason).toBe(null);
    if (entity.scoreState !== 'SCORED') throw new Error('narrow failed');
    expect(entity.strain).toBe(10.5);
    expect(entity.kilojoule).toBe(7500.0);
    expect(entity.averageHeartRate).toBe(62);
    expect(entity.maxHeartRate).toBe(168);
  });

  it('Test 2: PENDING_SCORE cycle → entity with scoreState=PENDING_SCORE, no strain field', () => {
    const raw = WhoopRawCycle.parse(PENDING_CYCLE);
    const entity = normalizeCycle(raw, {
      ianaZone: 'America/Los_Angeles',
      priorTimezoneOffset: '-07:00',
    });

    expect(entity.scoreState).toBe('PENDING_SCORE');
    // Score fields are absent on the PENDING_SCORE variant — TS narrowing
    // would refuse `entity.strain` here as a compile error. The runtime
    // assertion below confirms the shape.
    expect((entity as { strain?: number }).strain).toBeUndefined();
    expect(entity.baselineExcluded).toBe(false);
  });

  it('Test 3: UNSCORABLE cycle → entity with scoreState=UNSCORABLE', () => {
    const raw = WhoopRawCycle.parse(UNSCORABLE_CYCLE);
    const entity = normalizeCycle(raw, {
      ianaZone: 'America/Los_Angeles',
      priorTimezoneOffset: '-07:00',
    });

    expect(entity.scoreState).toBe('UNSCORABLE');
    expect((entity as { strain?: number }).strain).toBeUndefined();
  });

  it('Test 4: DST-straddling cycle (200-dst-spring-forward.json) → baselineExcluded=true, exclusionReason=dst_straddle', () => {
    const fixture = JSON.parse(
      readFileSync(join(FIXTURES_DIR, '200-dst-spring-forward.json'), 'utf8'),
    ) as { records: unknown[] };
    const raw = WhoopRawCycle.parse(fixture.records[0]);
    const entity = normalizeCycle(raw, {
      ianaZone: 'America/Los_Angeles',
      priorTimezoneOffset: '-08:00',
    });

    expect(entity.baselineExcluded).toBe(true);
    expect(entity.exclusionReason).toBe('dst_straddle');
  });

  it('Test 5: tz_drift cycle (200-tz-trip-sfo-jfk.json record 1) with prior -08:00 → tz_drift', () => {
    const fixture = JSON.parse(
      readFileSync(join(FIXTURES_DIR, '200-tz-trip-sfo-jfk.json'), 'utf8'),
    ) as { records: unknown[] };
    const raw = WhoopRawCycle.parse(fixture.records[1]);
    const entity = normalizeCycle(raw, {
      ianaZone: 'America/New_York',
      priorTimezoneOffset: '-08:00',
    });

    expect(entity.baselineExcluded).toBe(true);
    expect(entity.exclusionReason).toBe('tz_drift');
  });

  it('Test 6: snake → camel mapping is locked', () => {
    const raw = WhoopRawCycle.parse(SCORED_CYCLE);
    const entity = normalizeCycle(raw, {
      ianaZone: 'America/Los_Angeles',
      priorTimezoneOffset: '-07:00',
    });

    // Identifier mapping
    expect(entity.userId).toBe(100001);
    expect(entity.createdAt).toBe('2026-04-01T08:00:00.000Z');
    expect(entity.updatedAt).toBe('2026-04-01T20:00:00.000Z');
    expect(entity.timezoneOffset).toBe('-07:00');
    // Score-field mapping (only readable after narrowing)
    if (entity.scoreState !== 'SCORED') throw new Error('expected SCORED variant');
    expect(entity.averageHeartRate).toBe(62);
    expect(entity.maxHeartRate).toBe(168);
    // Camel-case raw fields should NOT exist on the entity
    const opaque = entity as unknown as Record<string, unknown>;
    expect(opaque.user_id).toBeUndefined();
    expect(opaque.timezone_offset).toBeUndefined();
    expect(opaque.average_heart_rate).toBeUndefined();
  });

  it('Test 7: purity — same inputs → identical outputs', () => {
    const raw = WhoopRawCycle.parse(SCORED_CYCLE);
    const opts = { ianaZone: 'America/Los_Angeles', priorTimezoneOffset: '-07:00' };
    const first = normalizeCycle(raw, opts);
    const second = normalizeCycle(raw, opts);
    expect(first).toEqual(second);
  });
});
