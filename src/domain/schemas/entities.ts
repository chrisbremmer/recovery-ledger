// Domain entity Zod schemas — Layer 2 of the three-layer type system. Used
// by repository row → entity validators (Plan 03-08) and by integration
// tests that need to assert on the parsed entity shape. The discriminator
// here is `scoreState` (camelCase) — NOT `score_state` (which is the
// raw/Layer 1 discriminator in `whoop-api.ts`). The normalizer at the
// boundary translates one to the other; this file documents the camelCase
// post-normalization contract.
//
// These Zod schemas mirror the TypeScript interfaces declared in
// `src/domain/types/entities.ts` exactly — same field names, same
// optionality, same nullability. The runtime schemas exist so that
// repositories can validate that the row-to-entity mapping landed on a
// well-formed entity (catches refactor drift between schema.ts column
// definitions and entities.ts type definitions). They are not required
// for the discriminator's compile-time forcing function — that lives in
// `entities.ts` already.
//
// Pure schema declarations. No I/O, no logger, no infrastructure imports.

import { z } from 'zod';
import { RESOURCES } from '../types/sync.js';
// DBIN-01 (#75): shared 5-state enum (running|ok|partial|failed|aborted).
import { SYNC_RUN_STATUSES } from '../types/sync-run-status.js';

// ============================================================================
// CYCLE — discriminated union on `scoreState` (camelCase).
// ============================================================================

const CycleSharedFields = {
  id: z.number().int(),
  userId: z.number().int(),
  createdAt: z.string(),
  updatedAt: z.string(),
  start: z.string(),
  end: z.string().nullable(),
  timezoneOffset: z.string(),
  baselineExcluded: z.boolean(),
  exclusionReason: z.enum(['dst_straddle', 'tz_drift']).nullable(),
};

const CycleScoredEntitySchema = z.object({
  ...CycleSharedFields,
  scoreState: z.literal('SCORED'),
  strain: z.number(),
  kilojoule: z.number(),
  averageHeartRate: z.number().int(),
  maxHeartRate: z.number().int(),
});

const CyclePendingEntitySchema = z.object({
  ...CycleSharedFields,
  scoreState: z.literal('PENDING_SCORE'),
});

const CycleUnscorableEntitySchema = z.object({
  ...CycleSharedFields,
  scoreState: z.literal('UNSCORABLE'),
});

export const CycleEntitySchema = z.discriminatedUnion('scoreState', [
  CycleScoredEntitySchema,
  CyclePendingEntitySchema,
  CycleUnscorableEntitySchema,
]);

// ============================================================================
// RECOVERY — compound key (cycleId, sleepId). No `start` on the wire.
// ============================================================================

const RecoverySharedFields = {
  cycleId: z.number().int(),
  sleepId: z.string().uuid(),
  userId: z.number().int(),
  createdAt: z.string(),
  updatedAt: z.string(),
};

const RecoveryScoredEntitySchema = z.object({
  ...RecoverySharedFields,
  scoreState: z.literal('SCORED'),
  recoveryScore: z.number().int(),
  restingHeartRate: z.number().int(),
  hrvRmssdMilli: z.number(),
  spo2Percentage: z.number(),
  skinTempCelsius: z.number(),
  userCalibrating: z.boolean(),
});

const RecoveryPendingEntitySchema = z.object({
  ...RecoverySharedFields,
  scoreState: z.literal('PENDING_SCORE'),
});

const RecoveryUnscorableEntitySchema = z.object({
  ...RecoverySharedFields,
  scoreState: z.literal('UNSCORABLE'),
});

export const RecoveryEntitySchema = z.discriminatedUnion('scoreState', [
  RecoveryScoredEntitySchema,
  RecoveryPendingEntitySchema,
  RecoveryUnscorableEntitySchema,
]);

// ============================================================================
// SLEEP — UUID id.
// ============================================================================

const SleepSharedFields = {
  id: z.string().uuid(),
  userId: z.number().int(),
  createdAt: z.string(),
  updatedAt: z.string(),
  start: z.string(),
  end: z.string(),
  timezoneOffset: z.string(),
};

const SleepScoredEntitySchema = z.object({
  ...SleepSharedFields,
  scoreState: z.literal('SCORED'),
  totalInBedTimeMilli: z.number().int(),
  totalAwakeTimeMilli: z.number().int(),
  sleepPerformancePercentage: z.number(),
  sleepConsistencyPercentage: z.number(),
  sleepEfficiencyPercentage: z.number(),
  respiratoryRate: z.number(),
});

const SleepPendingEntitySchema = z.object({
  ...SleepSharedFields,
  scoreState: z.literal('PENDING_SCORE'),
});

const SleepUnscorableEntitySchema = z.object({
  ...SleepSharedFields,
  scoreState: z.literal('UNSCORABLE'),
});

export const SleepEntitySchema = z.discriminatedUnion('scoreState', [
  SleepScoredEntitySchema,
  SleepPendingEntitySchema,
  SleepUnscorableEntitySchema,
]);

// ============================================================================
// WORKOUT — UUID id; `sportId` ships on every variant.
// ============================================================================

const WorkoutSharedFields = {
  id: z.string().uuid(),
  userId: z.number().int(),
  createdAt: z.string(),
  updatedAt: z.string(),
  start: z.string(),
  end: z.string(),
  timezoneOffset: z.string(),
  sportId: z.number().int().nullable(),
};

const WorkoutScoredEntitySchema = z.object({
  ...WorkoutSharedFields,
  scoreState: z.literal('SCORED'),
  strain: z.number(),
  averageHeartRate: z.number().int(),
  maxHeartRate: z.number().int(),
  kilojoule: z.number(),
  distanceMeter: z.number().nullable(),
  altitudeGainMeter: z.number().nullable(),
  altitudeChangeMeter: z.number().nullable(),
});

const WorkoutPendingEntitySchema = z.object({
  ...WorkoutSharedFields,
  scoreState: z.literal('PENDING_SCORE'),
});

const WorkoutUnscorableEntitySchema = z.object({
  ...WorkoutSharedFields,
  scoreState: z.literal('UNSCORABLE'),
});

export const WorkoutEntitySchema = z.discriminatedUnion('scoreState', [
  WorkoutScoredEntitySchema,
  WorkoutPendingEntitySchema,
  WorkoutUnscorableEntitySchema,
]);

// ============================================================================
// PROFILE — non-scored. Single row.
// ============================================================================

export const ProfileEntitySchema = z.object({
  userId: z.number().int(),
  email: z.string().email(),
  firstName: z.string(),
  lastName: z.string(),
  fetchedAt: z.string(),
});

// ============================================================================
// BODY MEASUREMENT — non-scored history row.
// ============================================================================

export const BodyMeasurementEntitySchema = z.object({
  id: z.number().int(),
  userId: z.number().int(),
  heightMeter: z.number(),
  weightKilogram: z.number(),
  maxHeartRate: z.number().int(),
  capturedAt: z.string(),
});

// ============================================================================
// SYNC RUN — D-24 row shape.
// ============================================================================

export const ResourceSyncOutcomeSchema = z.object({
  status: z.enum([
    'success',
    'partial_429',
    'partial_5xx',
    'failed_auth',
    'failed_network',
    'failed_db',
    'failed_parse',
    'failed_unknown',
    'skipped',
  ]),
  fetched: z.number().int().optional(),
  upserted: z.number().int().optional(),
  errors: z.number().int().optional(),
  durationMs: z.number().int().optional(),
});

export const SyncRunEntitySchema = z.object({
  id: z.number().int(),
  startedAt: z.string(),
  finishedAt: z.string().nullable(),
  // DBIN-01 (#75): derived from the shared SYNC_RUN_STATUSES constant so
  // Drizzle / Zod / QueryCache / repo stay in lockstep on the 5-state enum.
  status: z.enum(SYNC_RUN_STATUSES),
  // Zod 4's `z.record(KeySchema, ValueSchema)` validates that every enum key
  // is present — but the sync_runs row stores partial maps mid-run. Use a
  // string-keyed record with a runtime guard (refine) that every key is one
  // of RESOURCES, without forcing every key to be present.
  perResource: z
    .record(z.string(), ResourceSyncOutcomeSchema)
    .refine((map) => Object.keys(map).every((k) => (RESOURCES as readonly string[]).includes(k)), {
      message: 'perResource contains an unknown resource key',
    }),
  gapsDetected: z.number().int(),
  flags: z.string().nullable(),
});

// ============================================================================
// DECISION — DEC-01 / D-01 user-recorded decision.
// ============================================================================

export const DecisionEntitySchema = z.object({
  id: z.string(),
  createdAt: z.string(),
  category: z.string(),
  decision: z.string(),
  rationale: z.string().nullable(),
  confidence: z.enum(['low', 'medium', 'high']).nullable(),
  expectedEffect: z.string().nullable(),
  followUpDate: z.string().nullable(),
  status: z.enum(['open', 'followed_up', 'abandoned']),
  outcomeNotes: z.string().nullable(),
});

// ============================================================================
// DAILY SUMMARY — Phase 4 baseline service populates this; Phase 3 only
// declares the shape so the table can be migrated.
// ============================================================================

export const DailySummaryEntitySchema = z.object({
  date: z.string(),
  userId: z.number().int(),
  recoveryScore: z.number().int().nullable(),
  sleepEfficiencyPercentage: z.number().nullable(),
  dayStrain: z.number().nullable(),
  respiratoryRate: z.number().nullable(),
  hrvRmssdMilli: z.number().nullable(),
  restingHeartRate: z.number().int().nullable(),
  computedAt: z.string(),
});
