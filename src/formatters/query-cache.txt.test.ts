// renderQueryCache tests — pure (QueryCacheResult) => string with per-
// resource sub-renderer dispatch. Anchors:
//   - Each of the 8 D-24 arms renders with column headers + 0+ data rows.
//   - Trailing 'count: N (truncated: true|false)' line on every render.
//   - Empty rows render '(no rows)' under the header (NOT an exception).
//   - ADR-0005 / D-26 per-formatter sanity sweep: NO banned tokens.

import { describe, expect, it } from 'vitest';
import { containsBannedToneToken, EMOJI_RE } from '../domain/banned-words.js';
import type {
  BodyMeasurement,
  Cycle,
  Decision,
  Profile,
  Recovery,
  Sleep,
  SyncRun,
  Workout,
} from '../domain/types/entities.js';
import type { QueryCacheResult } from '../services/cache/types.js';
import { renderQueryCache } from './query-cache.txt.js';

function asResult(resource: QueryCacheResult['resource'], rows: unknown[], opts?: { count?: number; truncated?: boolean }): QueryCacheResult {
  return {
    resource,
    rows,
    count: opts?.count ?? rows.length,
    truncated: opts?.truncated ?? false,
  };
}

describe('renderQueryCache — cycles arm', () => {
  it('renders header + one row + trailing count', () => {
    const cycle: Cycle = {
      id: 1000,
      userId: 99,
      createdAt: '2026-03-15T07:00:00.000Z',
      updatedAt: '2026-03-15T07:00:00.000Z',
      start: '2026-03-15T07:00:00.000Z',
      end: null,
      timezoneOffset: '-07:00',
      baselineExcluded: false,
      exclusionReason: null,
      scoreState: 'SCORED',
      strain: 12.4,
      kilojoule: 10000,
      averageHeartRate: 65,
      maxHeartRate: 170,
    };
    const rendered = renderQueryCache(asResult('cycles', [cycle]));
    expect(rendered).toContain('start');
    expect(rendered).toContain('day_strain');
    expect(rendered).toContain('score_state');
    expect(rendered).toContain('12.4');
    expect(rendered).toContain('SCORED');
    expect(rendered).toContain('count: 1 (truncated: false)');
  });

  it('empty rows → (no rows) under header', () => {
    const rendered = renderQueryCache(asResult('cycles', []));
    expect(rendered).toContain('(no rows)');
    expect(rendered).toContain('count: 0 (truncated: false)');
  });
});

describe('renderQueryCache — recoveries arm', () => {
  it('renders SCORED recovery row with hrv_rmssd', () => {
    const recovery: Recovery = {
      cycleId: 1000,
      sleepId: 'sleep-001000',
      userId: 99,
      createdAt: '2026-03-15T08:00:00.000Z',
      updatedAt: '2026-03-15T08:00:00.000Z',
      scoreState: 'SCORED',
      recoveryScore: 72,
      restingHeartRate: 55,
      hrvRmssdMilli: 45.2,
      spo2Percentage: 97,
      skinTempCelsius: 33.5,
      userCalibrating: false,
    };
    const rendered = renderQueryCache(asResult('recoveries', [recovery]));
    expect(rendered).toContain('recovery_score');
    expect(rendered).toContain('hrv_rmssd_ms');
    expect(rendered).toContain('72');
    expect(rendered).toContain('45.2');
    expect(rendered).toContain('SCORED');
  });
});

describe('renderQueryCache — sleeps arm', () => {
  it('renders SCORED sleep with computed duration', () => {
    const sleep: Sleep = {
      id: 'sleep-001000',
      userId: 99,
      createdAt: '2026-03-15T08:00:00.000Z',
      updatedAt: '2026-03-15T08:00:00.000Z',
      start: '2026-03-15T05:00:00.000Z',
      end: '2026-03-15T08:00:00.000Z',
      timezoneOffset: '-07:00',
      scoreState: 'SCORED',
      totalInBedTimeMilli: 480 * 60_000,
      totalAwakeTimeMilli: 30 * 60_000,
      sleepPerformancePercentage: 88,
      sleepConsistencyPercentage: 75,
      sleepEfficiencyPercentage: 90,
      respiratoryRate: 14.5,
    };
    const rendered = renderQueryCache(asResult('sleeps', [sleep]));
    expect(rendered).toContain('duration_min');
    expect(rendered).toContain('efficiency_pct');
    expect(rendered).toContain('450'); // 480 - 30 = 450 min
    expect(rendered).toContain('90');
  });
});

describe('renderQueryCache — workouts arm', () => {
  it('renders SCORED workout row with sport_id', () => {
    const workout: Workout = {
      id: 'workout-001000',
      userId: 99,
      createdAt: '2026-03-14T19:00:00.000Z',
      updatedAt: '2026-03-14T19:00:00.000Z',
      start: '2026-03-14T19:00:00.000Z',
      end: '2026-03-14T20:00:00.000Z',
      timezoneOffset: '-07:00',
      sportId: 0,
      scoreState: 'SCORED',
      strain: 14.2,
      averageHeartRate: 150,
      maxHeartRate: 180,
      kilojoule: 1500,
      distanceMeter: null,
      altitudeGainMeter: null,
      altitudeChangeMeter: null,
    };
    const rendered = renderQueryCache(asResult('workouts', [workout]));
    expect(rendered).toContain('sport_id');
    expect(rendered).toContain('14.2');
  });
});

describe('renderQueryCache — profile arm', () => {
  it('renders single-row profile block', () => {
    const profile: Profile = {
      userId: 99,
      email: 'user@example.com',
      firstName: 'Chris',
      lastName: 'Bremmer',
      fetchedAt: '2026-03-15T15:00:00.000Z',
    };
    const rendered = renderQueryCache(asResult('profile', [profile]));
    expect(rendered).toContain('profile:');
    expect(rendered).toContain('user_id: 99');
    expect(rendered).toContain('first_name: Chris');
    expect(rendered).toContain('last_name: Bremmer');
    expect(rendered).toContain('email: user@example.com');
  });
});

describe('renderQueryCache — body_measurements arm', () => {
  it('renders body_measurements row with weight + height', () => {
    const bm: BodyMeasurement = {
      id: 1,
      userId: 99,
      heightMeter: 1.80,
      weightKilogram: 75.5,
      maxHeartRate: 185,
      capturedAt: '2026-03-15T08:00:00.000Z',
    };
    const rendered = renderQueryCache(asResult('body_measurements', [bm]));
    expect(rendered).toContain('measured_at');
    expect(rendered).toContain('height_m');
    expect(rendered).toContain('weight_kg');
    expect(rendered).toContain('1.8');
    expect(rendered).toContain('75.5');
    expect(rendered).toContain('185');
  });
});

describe('renderQueryCache — sync_runs arm', () => {
  it('renders sync_runs row with status + gaps', () => {
    const run: SyncRun = {
      id: 17,
      startedAt: '2026-03-15T11:00:00.000Z',
      finishedAt: '2026-03-15T11:02:14.000Z',
      status: 'ok',
      perResource: {} as SyncRun['perResource'],
      gapsDetected: 0,
      flags: null,
    };
    const rendered = renderQueryCache(asResult('sync_runs', [run]));
    expect(rendered).toContain('started_at');
    expect(rendered).toContain('finished_at');
    expect(rendered).toContain('17');
    expect(rendered).toContain('ok');
  });

  it("running sync renders '(running)' for finished_at", () => {
    const run: SyncRun = {
      id: 18,
      startedAt: '2026-03-15T11:00:00.000Z',
      finishedAt: null,
      status: 'running',
      perResource: {} as SyncRun['perResource'],
      gapsDetected: 0,
      flags: null,
    };
    const rendered = renderQueryCache(asResult('sync_runs', [run]));
    expect(rendered).toContain('(running)');
  });
});

describe('renderQueryCache — decisions arm (delegates to renderDecisionList)', () => {
  it('renders decisions table when rows is Decision[]', () => {
    const decision: Decision = {
      id: '01HK7XYZABCD0001234567890A',
      createdAt: '2026-03-12T15:00:00.000Z',
      category: 'sleep',
      decision: 'sleep at least seven hours on training days',
      rationale: null,
      confidence: 'medium',
      expectedEffect: null,
      followUpDate: '2026-03-19',
      status: 'open',
      outcomeNotes: null,
    };
    const rendered = renderQueryCache(asResult('decisions', [decision]));
    expect(rendered).toContain('Category');
    expect(rendered).toContain('01HK7XYZ');
  });
});

describe('renderQueryCache — trailing count/truncated line', () => {
  it("renders 'count: N (truncated: false)' when truncated=false", () => {
    const rendered = renderQueryCache(asResult('cycles', [], { count: 0, truncated: false }));
    expect(rendered).toContain('count: 0 (truncated: false)');
  });

  it("renders 'count: N (truncated: true)' when truncated=true", () => {
    const rendered = renderQueryCache(asResult('cycles', [], { count: 101, truncated: true }));
    expect(rendered).toContain('count: 101 (truncated: true)');
  });
});

describe('renderQueryCache — ADR-0005 / D-26 per-formatter sanity sweep', () => {
  it('cycles arm output free of banned tokens + emoji', () => {
    const cycle: Cycle = {
      id: 1000,
      userId: 99,
      createdAt: '2026-03-15T07:00:00.000Z',
      updatedAt: '2026-03-15T07:00:00.000Z',
      start: '2026-03-15T07:00:00.000Z',
      end: null,
      timezoneOffset: '-07:00',
      baselineExcluded: false,
      exclusionReason: null,
      scoreState: 'SCORED',
      strain: 12.4,
      kilojoule: 10000,
      averageHeartRate: 65,
      maxHeartRate: 170,
    };
    const rendered = renderQueryCache(asResult('cycles', [cycle]));
    expect(containsBannedToneToken(rendered).hit).toBe(false);
    expect(EMOJI_RE.test(rendered)).toBe(false);
  });
});
