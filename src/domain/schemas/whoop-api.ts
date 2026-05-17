// Raw WHOOP API Zod schemas — Layer 1 of the three-layer type system
// (conventions.md §Code style: "WHOOP types live in three layers"). All keys
// are snake_case to match the wire format verbatim (Pitfall 10: pagination
// uses snake_case `next_token` in responses + camelCase `nextToken` in
// requests). `passthrough()` on every leaf so unknown WHOOP fields land in
// `raw_json` without failing parse — forward-compat for future WHOOP schema
// additions per D-29.
//
// Score discipline (D-03 + ADR-0003 LOAD-BEARING): each scored resource's
// schema is a Zod discriminated union keyed on the score-state literal,
// branching into three per-state variants below. The SCORED variant carries every numeric score field;
// the PENDING_SCORE + UNSCORABLE variants carry NONE. Zod's closed
// discriminator throws on unknown `score_state` values (mitigates
// T-03.03-03 — a new WHOOP score_state literal would fail loudly through
// `sanitize.ts` and surface as `WhoopApiError({kind: 'validation'})`).
//
// Identifier shapes per WHOOP v2 (verified in 03-RESEARCH.md item 4):
//   - cycles.id: integer (int64)
//   - recovery: compound (cycle_id int64, sleep_id UUID-string)
//   - sleeps.id: UUID-string
//   - workouts.id: UUID-string
//   - profile: keyed by user_id (int64)
//   - body_measurement: no stable id on the wire — synthesized at upsert
//
// Page wrappers (D-19 + Pattern 7 + Pitfall 10): every paginated resource
// has a `Whoop<Resource>PageSchema` with a records array and a nullable
// continuation-token field (snake-case wire field per Pitfall 10). End of
// pagination is signalled by the continuation field being JSON null.
//
// No I/O, no logger, no infrastructure imports — Layer 1 is pure shape
// declarations. The HTTP client (Plan 03-06) calls `Schema.parse(json)`
// inside `httpGet`; per-resource modules (Plan 03-07..03-10) re-use these
// schemas via `z.infer<typeof ...>`.

import { z } from 'zod';

// ============================================================================
// CYCLES
// ============================================================================

const CycleCommonFields = {
  id: z.number().int(),
  user_id: z.number().int(),
  created_at: z.string(),
  updated_at: z.string(),
  start: z.string(),
  end: z.string().nullable(),
  timezone_offset: z.string(),
};

const ScoredRawCycle = z
  .object({
    ...CycleCommonFields,
    score_state: z.literal('SCORED'),
    score: z
      .object({
        strain: z.number(),
        kilojoule: z.number(),
        average_heart_rate: z.number().int(),
        max_heart_rate: z.number().int(),
      })
      .passthrough(),
  })
  .passthrough();

const PendingRawCycle = z
  .object({
    ...CycleCommonFields,
    score_state: z.literal('PENDING_SCORE'),
  })
  .passthrough();

const UnscorableRawCycle = z
  .object({
    ...CycleCommonFields,
    score_state: z.literal('UNSCORABLE'),
  })
  .passthrough();

export const WhoopRawCycle = z.discriminatedUnion('score_state', [
  ScoredRawCycle,
  PendingRawCycle,
  UnscorableRawCycle,
]);

export const WhoopCyclesPageSchema = z.object({
  records: z.array(WhoopRawCycle),
  next_token: z.string().nullable(),
});

// ============================================================================
// RECOVERY — compound PK (cycle_id, sleep_id); no `start` on the wire.
// ============================================================================

const RecoveryCommonFields = {
  cycle_id: z.number().int(),
  sleep_id: z.string().uuid(),
  user_id: z.number().int(),
  created_at: z.string(),
  updated_at: z.string(),
};

const ScoredRawRecovery = z
  .object({
    ...RecoveryCommonFields,
    score_state: z.literal('SCORED'),
    score: z
      .object({
        user_calibrating: z.boolean(),
        recovery_score: z.number().int(),
        resting_heart_rate: z.number().int(),
        hrv_rmssd_milli: z.number(),
        spo2_percentage: z.number(),
        skin_temp_celsius: z.number(),
      })
      .passthrough(),
  })
  .passthrough();

const PendingRawRecovery = z
  .object({
    ...RecoveryCommonFields,
    score_state: z.literal('PENDING_SCORE'),
  })
  .passthrough();

const UnscorableRawRecovery = z
  .object({
    ...RecoveryCommonFields,
    score_state: z.literal('UNSCORABLE'),
  })
  .passthrough();

export const WhoopRawRecovery = z.discriminatedUnion('score_state', [
  ScoredRawRecovery,
  PendingRawRecovery,
  UnscorableRawRecovery,
]);

export const WhoopRecoveryPageSchema = z.object({
  records: z.array(WhoopRawRecovery),
  next_token: z.string().nullable(),
});

// ============================================================================
// SLEEP — UUID id.
// ============================================================================

const SleepCommonFields = {
  id: z.string().uuid(),
  user_id: z.number().int(),
  created_at: z.string(),
  updated_at: z.string(),
  start: z.string(),
  end: z.string(),
  timezone_offset: z.string(),
};

const ScoredRawSleep = z
  .object({
    ...SleepCommonFields,
    score_state: z.literal('SCORED'),
    score: z
      .object({
        stage_summary: z
          .object({
            total_in_bed_time_milli: z.number().int(),
            total_awake_time_milli: z.number().int(),
          })
          .passthrough(),
        // TODO: replace z.unknown() with the documented WHOOP shape once
        // the API contract is verified. WHOOP v2 lists this as an optional
        // nested object with baseline + need_from_sleep_debt + need_from
        // _recent_strain + need_from_recent_nap (all numbers) but the
        // exact field set has not been pinned against fixture wire data.
        // See https://developer.whoop.com/api for the live shape.
        sleep_needed: z.unknown().optional(),
        respiratory_rate: z.number(),
        sleep_performance_percentage: z.number(),
        sleep_consistency_percentage: z.number(),
        sleep_efficiency_percentage: z.number(),
      })
      .passthrough(),
  })
  .passthrough();

const PendingRawSleep = z
  .object({
    ...SleepCommonFields,
    score_state: z.literal('PENDING_SCORE'),
  })
  .passthrough();

const UnscorableRawSleep = z
  .object({
    ...SleepCommonFields,
    score_state: z.literal('UNSCORABLE'),
  })
  .passthrough();

export const WhoopRawSleep = z.discriminatedUnion('score_state', [
  ScoredRawSleep,
  PendingRawSleep,
  UnscorableRawSleep,
]);

export const WhoopSleepPageSchema = z.object({
  records: z.array(WhoopRawSleep),
  next_token: z.string().nullable(),
});

// ============================================================================
// WORKOUTS — UUID id; `sport_id` ships on every variant.
// ============================================================================

const WorkoutCommonFields = {
  id: z.string().uuid(),
  user_id: z.number().int(),
  created_at: z.string(),
  updated_at: z.string(),
  start: z.string(),
  end: z.string(),
  timezone_offset: z.string(),
  sport_id: z.number().int().nullable().optional(),
};

const ScoredRawWorkout = z
  .object({
    ...WorkoutCommonFields,
    score_state: z.literal('SCORED'),
    score: z
      .object({
        strain: z.number(),
        average_heart_rate: z.number().int(),
        max_heart_rate: z.number().int(),
        kilojoule: z.number(),
        distance_meter: z.number().nullable().optional(),
        altitude_gain_meter: z.number().nullable().optional(),
        altitude_change_meter: z.number().nullable().optional(),
      })
      .passthrough(),
  })
  .passthrough();

const PendingRawWorkout = z
  .object({
    ...WorkoutCommonFields,
    score_state: z.literal('PENDING_SCORE'),
  })
  .passthrough();

const UnscorableRawWorkout = z
  .object({
    ...WorkoutCommonFields,
    score_state: z.literal('UNSCORABLE'),
  })
  .passthrough();

export const WhoopRawWorkout = z.discriminatedUnion('score_state', [
  ScoredRawWorkout,
  PendingRawWorkout,
  UnscorableRawWorkout,
]);

export const WhoopWorkoutsPageSchema = z.object({
  records: z.array(WhoopRawWorkout),
  next_token: z.string().nullable(),
});

// ============================================================================
// PROFILE — single-shot, no score_state, no `updated_at` on the wire.
// ============================================================================

export const WhoopRawProfile = z
  .object({
    user_id: z.number().int(),
    email: z.string().email(),
    first_name: z.string(),
    last_name: z.string(),
  })
  .passthrough();

// ============================================================================
// BODY MEASUREMENT — single-shot history; no score_state.
// ============================================================================

export const WhoopRawBodyMeasurement = z
  .object({
    // Required: the normalizer + repo both treat user_id as load-bearing.
    // The prior `.optional()` was speculative forward-compat; the WHOOP
    // v2 measurement-body shape includes user_id on every response.
    user_id: z.number().int(),
    height_meter: z.number(),
    weight_kilogram: z.number(),
    max_heart_rate: z.number().int(),
  })
  .passthrough();

// ============================================================================
// INFERRED TYPES — z.infer re-exports for downstream consumers (normalizers,
// repositories, test fixtures). The page-schema inferred types are NOT
// re-exported here because the pagination utility (Plan 03-06) owns the
// snake_case → camelCase translation at the boundary.
// ============================================================================

export type WhoopRawCycleType = z.infer<typeof WhoopRawCycle>;
export type WhoopRawRecoveryType = z.infer<typeof WhoopRawRecovery>;
export type WhoopRawSleepType = z.infer<typeof WhoopRawSleep>;
export type WhoopRawWorkoutType = z.infer<typeof WhoopRawWorkout>;
export type WhoopRawProfileType = z.infer<typeof WhoopRawProfile>;
export type WhoopRawBodyMeasurementType = z.infer<typeof WhoopRawBodyMeasurement>;
