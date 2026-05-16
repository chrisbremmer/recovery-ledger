// Workout normalizer — pure function (D-28 + Pattern C3).
//
// Raw snake_case Zod-parsed `WhoopRawWorkout` → camelCase `Workout` domain
// entity. Workouts have their own `start` + `end` + `timezone_offset` and
// `sport_id` (nullable + optional on the wire per WhoopRawWorkout schema)
// is normalized to `sportId: number | null` on the entity (`undefined` is
// coerced to `null` to match the non-optional entity field).
//
// Per D-14 the DST/tz exclusion flag lives only on cycles; workouts
// inherit at query time via the cycle FK, so this normalizer does NOT
// call `detectExclusion`.
//
// Score discipline (D-03 + ADR-0003) — SCORED variant carries strain,
// average/max heart rate, kilojoule, and three nullable distance/altitude
// fields per WHOOP v2 ScoredWorkout. PENDING_SCORE + UNSCORABLE carry
// none. Per-score-state branch coverage in workouts.test.ts defends
// Pitfall 3 against silent PENDING leakage.

import type { z } from 'zod';
import type { WhoopRawWorkout } from '../schemas/whoop-api.js';
import type { Workout } from '../types/entities.js';

export function normalizeWorkout(raw: z.infer<typeof WhoopRawWorkout>): Workout {
  const base = {
    id: raw.id,
    userId: raw.user_id,
    createdAt: raw.created_at,
    updatedAt: raw.updated_at,
    start: raw.start,
    end: raw.end,
    timezoneOffset: raw.timezone_offset,
    sportId: raw.sport_id ?? null,
  };

  switch (raw.score_state) {
    case 'SCORED':
      return {
        ...base,
        scoreState: 'SCORED',
        strain: raw.score.strain,
        averageHeartRate: raw.score.average_heart_rate,
        maxHeartRate: raw.score.max_heart_rate,
        kilojoule: raw.score.kilojoule,
        distanceMeter: raw.score.distance_meter ?? null,
        altitudeGainMeter: raw.score.altitude_gain_meter ?? null,
        altitudeChangeMeter: raw.score.altitude_change_meter ?? null,
      };
    case 'PENDING_SCORE':
      return { ...base, scoreState: 'PENDING_SCORE' };
    case 'UNSCORABLE':
      return { ...base, scoreState: 'UNSCORABLE' };
  }
}
