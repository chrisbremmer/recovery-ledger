// Unit coverage for the Layer 1 raw Zod schemas — happy-path parses for each
// score_state branch + closed-discriminator failures + required-score-field
// failures + page-wrapper shape tests.
//
// No fixture files — Plan 03-07 contract tests will introduce
// `tests/fixtures/whoop/<resource>/<scenario>.json`. This file ships inline
// JSON literals so the schemas can be locked in Wave 1b before any fixture
// files exist on disk.
//
// The shape of every SCORED variant nests numeric score fields inside a
// `score` sub-object, matching the WHOOP v2 wire format
// (developer.whoop.com/docs/developing/user-data/<resource>/). PENDING_SCORE
// and UNSCORABLE variants carry no `score` field at all.

import { describe, expect, test } from 'vitest';
import {
  WhoopCyclesPageSchema,
  WhoopRawBodyMeasurement,
  WhoopRawCycle,
  WhoopRawProfile,
  WhoopRawRecovery,
  WhoopRawSleep,
  WhoopRawWorkout,
  WhoopRecoveryPageSchema,
  WhoopSleepPageSchema,
  WhoopWorkoutsPageSchema,
} from './whoop-api.js';

// ============================================================================
// FIXTURES — inline JSON literals matching the WHOOP v2 wire shape
// ============================================================================

const SCORED_CYCLE = {
  id: 123456789,
  user_id: 42,
  created_at: '2026-05-16T08:00:00.000Z',
  updated_at: '2026-05-16T16:00:00.000Z',
  start: '2026-05-15T08:00:00.000Z',
  end: '2026-05-16T08:00:00.000Z',
  timezone_offset: '-08:00',
  score_state: 'SCORED',
  score: {
    strain: 12.5,
    kilojoule: 8000,
    average_heart_rate: 60,
    max_heart_rate: 180,
  },
};

const PENDING_CYCLE = {
  id: 123456790,
  user_id: 42,
  created_at: '2026-05-16T08:00:00.000Z',
  updated_at: '2026-05-16T16:00:00.000Z',
  start: '2026-05-15T08:00:00.000Z',
  end: null,
  timezone_offset: '-08:00',
  score_state: 'PENDING_SCORE',
};

const UNSCORABLE_CYCLE = {
  id: 123456791,
  user_id: 42,
  created_at: '2026-05-16T08:00:00.000Z',
  updated_at: '2026-05-16T16:00:00.000Z',
  start: '2026-05-15T08:00:00.000Z',
  end: '2026-05-16T08:00:00.000Z',
  timezone_offset: '-08:00',
  score_state: 'UNSCORABLE',
};

const SCORED_RECOVERY = {
  cycle_id: 123456789,
  sleep_id: 'f0f22caa-cc11-493a-9f29-96fe0a6b8b2a',
  user_id: 42,
  created_at: '2026-05-16T08:00:00.000Z',
  updated_at: '2026-05-16T08:00:00.000Z',
  score_state: 'SCORED',
  score: {
    user_calibrating: false,
    recovery_score: 75,
    resting_heart_rate: 55,
    hrv_rmssd_milli: 45.5,
    spo2_percentage: 97.5,
    skin_temp_celsius: 33.2,
  },
};

const PENDING_RECOVERY = {
  cycle_id: 123456790,
  sleep_id: '6488ce1b-9e59-46e0-8f6b-e90fa874619f',
  user_id: 42,
  created_at: '2026-05-16T08:00:00.000Z',
  updated_at: '2026-05-16T08:00:00.000Z',
  score_state: 'PENDING_SCORE',
};

const UNSCORABLE_RECOVERY = {
  cycle_id: 123456791,
  sleep_id: '9bd330e2-bec9-47db-97c6-0640c6f0045a',
  user_id: 42,
  created_at: '2026-05-16T08:00:00.000Z',
  updated_at: '2026-05-16T08:00:00.000Z',
  score_state: 'UNSCORABLE',
};

const SCORED_SLEEP = {
  id: 'd2899173-f1e5-404f-8d80-bdc450f60e7a',
  user_id: 42,
  created_at: '2026-05-16T08:00:00.000Z',
  updated_at: '2026-05-16T08:00:00.000Z',
  start: '2026-05-16T00:00:00.000Z',
  end: '2026-05-16T08:00:00.000Z',
  timezone_offset: '-08:00',
  score_state: 'SCORED',
  score: {
    stage_summary: {
      total_in_bed_time_milli: 28800000,
      total_awake_time_milli: 600000,
    },
    respiratory_rate: 14.5,
    sleep_performance_percentage: 92.5,
    sleep_consistency_percentage: 80.0,
    sleep_efficiency_percentage: 94.0,
  },
};

const PENDING_SLEEP = {
  id: '05b094be-7777-445e-af3e-1b8e447ebe9f',
  user_id: 42,
  created_at: '2026-05-16T08:00:00.000Z',
  updated_at: '2026-05-16T08:00:00.000Z',
  start: '2026-05-16T00:00:00.000Z',
  end: '2026-05-16T08:00:00.000Z',
  timezone_offset: '-08:00',
  score_state: 'PENDING_SCORE',
};

const UNSCORABLE_SLEEP = {
  id: '6cf0e86f-42ee-4ab0-84c8-befe08ca63e0',
  user_id: 42,
  created_at: '2026-05-16T08:00:00.000Z',
  updated_at: '2026-05-16T08:00:00.000Z',
  start: '2026-05-16T00:00:00.000Z',
  end: '2026-05-16T08:00:00.000Z',
  timezone_offset: '-08:00',
  score_state: 'UNSCORABLE',
};

const SCORED_WORKOUT = {
  id: 'c4ba07da-bb49-45b4-8e31-24653630ca99',
  user_id: 42,
  created_at: '2026-05-16T08:00:00.000Z',
  updated_at: '2026-05-16T08:00:00.000Z',
  start: '2026-05-16T10:00:00.000Z',
  end: '2026-05-16T11:00:00.000Z',
  timezone_offset: '-08:00',
  sport_id: 1,
  score_state: 'SCORED',
  score: {
    strain: 15.5,
    average_heart_rate: 140,
    max_heart_rate: 175,
    kilojoule: 2500,
    distance_meter: 10000,
    altitude_gain_meter: 50,
    altitude_change_meter: 25,
  },
};

const PENDING_WORKOUT = {
  id: 'a5218d57-94df-41c0-ab0a-8470cafa76a3',
  user_id: 42,
  created_at: '2026-05-16T08:00:00.000Z',
  updated_at: '2026-05-16T08:00:00.000Z',
  start: '2026-05-16T10:00:00.000Z',
  end: '2026-05-16T11:00:00.000Z',
  timezone_offset: '-08:00',
  sport_id: 1,
  score_state: 'PENDING_SCORE',
};

const UNSCORABLE_WORKOUT = {
  id: '8f229220-0a04-4a14-8204-43f4a3d5329a',
  user_id: 42,
  created_at: '2026-05-16T08:00:00.000Z',
  updated_at: '2026-05-16T08:00:00.000Z',
  start: '2026-05-16T10:00:00.000Z',
  end: '2026-05-16T11:00:00.000Z',
  timezone_offset: '-08:00',
  sport_id: 1,
  score_state: 'UNSCORABLE',
};

// ============================================================================
// CYCLES — happy-path + sad-path
// ============================================================================

describe('WhoopRawCycle', () => {
  test('Test 1: SCORED cycle parses cleanly', () => {
    expect(WhoopRawCycle.safeParse(SCORED_CYCLE).success).toBe(true);
  });

  test('Test 2: PENDING_SCORE cycle parses cleanly (no score field required)', () => {
    expect(WhoopRawCycle.safeParse(PENDING_CYCLE).success).toBe(true);
  });

  test('Test 3: UNSCORABLE cycle parses cleanly', () => {
    expect(WhoopRawCycle.safeParse(UNSCORABLE_CYCLE).success).toBe(true);
  });

  test('Test 4: SCORED cycle without score.strain FAILS parse', () => {
    const bad = {
      ...SCORED_CYCLE,
      score: { kilojoule: 8000, average_heart_rate: 60, max_heart_rate: 180 },
    };
    const result = WhoopRawCycle.safeParse(bad);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(JSON.stringify(result.error.issues)).toContain('strain');
    }
  });

  test('Test 5: cycle with INVALID score_state FAILS parse (closed discriminator)', () => {
    const bad = { ...PENDING_CYCLE, score_state: 'INVALID' };
    const result = WhoopRawCycle.safeParse(bad);
    expect(result.success).toBe(false);
  });
});

// ============================================================================
// RECOVERY
// ============================================================================

describe('WhoopRawRecovery', () => {
  test('Test 6: SCORED recovery parses cleanly', () => {
    expect(WhoopRawRecovery.safeParse(SCORED_RECOVERY).success).toBe(true);
  });

  test('Test 7: PENDING_SCORE recovery parses cleanly', () => {
    expect(WhoopRawRecovery.safeParse(PENDING_RECOVERY).success).toBe(true);
  });

  test('Test 8: UNSCORABLE recovery parses cleanly', () => {
    expect(WhoopRawRecovery.safeParse(UNSCORABLE_RECOVERY).success).toBe(true);
  });

  test('Test 9: SCORED recovery without score.recovery_score FAILS parse', () => {
    const bad = {
      ...SCORED_RECOVERY,
      score: {
        user_calibrating: false,
        resting_heart_rate: 55,
        hrv_rmssd_milli: 45.5,
        spo2_percentage: 97.5,
        skin_temp_celsius: 33.2,
      },
    };
    const result = WhoopRawRecovery.safeParse(bad);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(JSON.stringify(result.error.issues)).toContain('recovery_score');
    }
  });

  test('Test 10: recovery with INVALID score_state FAILS parse', () => {
    const bad = { ...PENDING_RECOVERY, score_state: 'INVALID' };
    expect(WhoopRawRecovery.safeParse(bad).success).toBe(false);
  });
});

// ============================================================================
// SLEEP
// ============================================================================

describe('WhoopRawSleep', () => {
  test('Test 11: SCORED sleep parses cleanly', () => {
    expect(WhoopRawSleep.safeParse(SCORED_SLEEP).success).toBe(true);
  });

  test('Test 12: PENDING_SCORE sleep parses cleanly', () => {
    expect(WhoopRawSleep.safeParse(PENDING_SLEEP).success).toBe(true);
  });

  test('Test 13: UNSCORABLE sleep parses cleanly', () => {
    expect(WhoopRawSleep.safeParse(UNSCORABLE_SLEEP).success).toBe(true);
  });

  test('Test 14: SCORED sleep without score.respiratory_rate FAILS parse', () => {
    const bad = {
      ...SCORED_SLEEP,
      score: {
        stage_summary: {
          total_in_bed_time_milli: 28800000,
          total_awake_time_milli: 600000,
        },
        sleep_performance_percentage: 92.5,
        sleep_consistency_percentage: 80.0,
        sleep_efficiency_percentage: 94.0,
      },
    };
    expect(WhoopRawSleep.safeParse(bad).success).toBe(false);
  });

  test('Test 15: sleep with INVALID score_state FAILS parse', () => {
    const bad = { ...PENDING_SLEEP, score_state: 'INVALID' };
    expect(WhoopRawSleep.safeParse(bad).success).toBe(false);
  });
});

// ============================================================================
// WORKOUTS
// ============================================================================

describe('WhoopRawWorkout', () => {
  test('Test 16: SCORED workout parses cleanly', () => {
    expect(WhoopRawWorkout.safeParse(SCORED_WORKOUT).success).toBe(true);
  });

  test('Test 17: PENDING_SCORE workout parses cleanly', () => {
    expect(WhoopRawWorkout.safeParse(PENDING_WORKOUT).success).toBe(true);
  });

  test('Test 18: UNSCORABLE workout parses cleanly', () => {
    expect(WhoopRawWorkout.safeParse(UNSCORABLE_WORKOUT).success).toBe(true);
  });

  test('Test 19: SCORED workout without score.strain FAILS parse', () => {
    const bad = {
      ...SCORED_WORKOUT,
      score: {
        average_heart_rate: 140,
        max_heart_rate: 175,
        kilojoule: 2500,
        distance_meter: 10000,
        altitude_gain_meter: 50,
        altitude_change_meter: 25,
      },
    };
    expect(WhoopRawWorkout.safeParse(bad).success).toBe(false);
  });

  test('Test 20: workout with INVALID score_state FAILS parse', () => {
    const bad = { ...PENDING_WORKOUT, score_state: 'INVALID' };
    expect(WhoopRawWorkout.safeParse(bad).success).toBe(false);
  });
});

// ============================================================================
// PROFILE + BODY MEASUREMENT — no score_state
// ============================================================================

describe('WhoopRawProfile', () => {
  test('Test 21: profile parses cleanly', () => {
    const profile = {
      user_id: 42,
      email: 'chris@example.com',
      first_name: 'Chris',
      last_name: 'Bremmer',
    };
    expect(WhoopRawProfile.safeParse(profile).success).toBe(true);
  });
});

describe('WhoopRawBodyMeasurement', () => {
  test('Test 22: body measurement parses cleanly', () => {
    const body = {
      user_id: 42,
      height_meter: 1.83,
      weight_kilogram: 85.5,
      max_heart_rate: 185,
    };
    expect(WhoopRawBodyMeasurement.safeParse(body).success).toBe(true);
  });
});

// ============================================================================
// PAGE WRAPPERS — D-19 + Pattern 7 + Pitfall 10
// ============================================================================

describe('WhoopCyclesPageSchema', () => {
  test('Test 23: cycles page with continuation token parses', () => {
    const page = { records: [SCORED_CYCLE], next_token: 'abc123' };
    expect(WhoopCyclesPageSchema.safeParse(page).success).toBe(true);
  });

  test('Test 24: cycles page with null continuation (end of pagination) parses', () => {
    const page = { records: [SCORED_CYCLE, PENDING_CYCLE], next_token: null };
    expect(WhoopCyclesPageSchema.safeParse(page).success).toBe(true);
  });

  test('Test 25: cycles page with non-array records FAILS parse', () => {
    const page = { records: 'not an array', next_token: null };
    expect(WhoopCyclesPageSchema.safeParse(page).success).toBe(false);
  });
});

describe('WhoopRecoveryPageSchema', () => {
  test('Test 26: recovery page with mixed-state records parses', () => {
    const page = {
      records: [SCORED_RECOVERY, PENDING_RECOVERY, UNSCORABLE_RECOVERY],
      next_token: null,
    };
    expect(WhoopRecoveryPageSchema.safeParse(page).success).toBe(true);
  });
});

describe('WhoopSleepPageSchema', () => {
  test('Test 27: sleep page parses', () => {
    const page = { records: [SCORED_SLEEP], next_token: 'continue-here' };
    expect(WhoopSleepPageSchema.safeParse(page).success).toBe(true);
  });
});

describe('WhoopWorkoutsPageSchema', () => {
  test('Test 28: workouts page parses', () => {
    const page = { records: [SCORED_WORKOUT], next_token: null };
    expect(WhoopWorkoutsPageSchema.safeParse(page).success).toBe(true);
  });
});
