// Domain entity types — camelCase, Layer 2 of the three-layer type system
// (D-03, D-04, D-28). Plain TypeScript types. No imports from Drizzle, Zod,
// or any infrastructure module — Gate G CI-enforces the Drizzle boundary
// (ARCHITECTURE.md Anti-Pattern 3); the repository file is responsible for
// mapping `drizzle-orm` row types to these entity types at the boundary.
//
// Three layers:
//   - Layer 1 (raw, wire format)  — `src/domain/schemas/whoop-api.ts` Zod
//                                    schemas; snake_case keys; passthrough()
//                                    for forward compat.
//   - Layer 2 (domain entity)     — THIS FILE; camelCase keys; the
//                                    discriminated union for the four
//                                    scored entities; the type the
//                                    application core operates on.
//   - Layer 3 (view)              — Phase 4 owns; review-output shapes.
//
// Score discipline (D-03 + ADR-0003 LOAD-BEARING):
//   Cycle, Recovery, Sleep, Workout are discriminated unions on
//   `scoreState`. SCORED-only fields (strain, recoveryScore, sleep metrics,
//   etc.) exist ONLY on the SCORED variant. Reading `.strain` off a
//   `Cycle` union without first narrowing on `scoreState === 'SCORED'` is
//   a compile error — the field does not exist on `CyclePending` or
//   `CycleUnscorable`. This forcing function defends Pitfall 3 (silent
//   PENDING_SCORE / UNSCORABLE consumption as zero, which destroys
//   baselines and generates false-positive review output).
//
// DST/tz exclusion (D-14): `baselineExcluded` + `exclusionReason` live on
// every Cycle variant — DST detection runs at upsert time regardless of
// score_state (a PENDING_SCORE cycle can still straddle a DST boundary).
// Recovery / Sleep / Workout inherit exclusion at query time via the
// `cycle_id` FK; they do not carry the flag on the row.
//
// Identifier shapes per WHOOP v2 (verified in 03-RESEARCH.md item 4):
//   - cycles: id is int64 (number)
//   - recoveries: compound PK (cycleId int64, sleepId UUID-string)
//   - sleeps: id is UUID-string
//   - workouts: id is UUID-string
//   - profile: keyed by userId (int64)
//   - body_measurements: synthetic autoincrement id (int64) per D-35

import type { ScoreState } from './score.js';
import type { ResourceName, ResourceSyncOutcome } from './sync.js';

// ----------------------------------------------------------------------------
// Cycle — physiological cycle. Discriminated union on `scoreState`.
// SCORED-only fields per WHOOP v2 CycleScore doc.
// ----------------------------------------------------------------------------

/** Fields shared by every Cycle variant — identifiers, time window, and the
 *  D-14 DST/tz exclusion flag (computed at upsert regardless of scoreState). */
interface CycleBase {
  id: number;
  userId: number;
  createdAt: string;
  updatedAt: string;
  start: string;
  end: string | null;
  timezoneOffset: string;
  baselineExcluded: boolean;
  exclusionReason: 'dst_straddle' | 'tz_drift' | null;
}

export interface CycleScored extends CycleBase {
  scoreState: 'SCORED';
  strain: number;
  kilojoule: number;
  averageHeartRate: number;
  maxHeartRate: number;
}

export interface CyclePending extends CycleBase {
  scoreState: 'PENDING_SCORE';
}

export interface CycleUnscorable extends CycleBase {
  scoreState: 'UNSCORABLE';
}

export type Cycle = CycleScored | CyclePending | CycleUnscorable;

// ----------------------------------------------------------------------------
// Recovery — compound PK (cycleId, sleepId). No `start` on the wire; the
// recovery is timestamped via createdAt. SCORED-only fields per WHOOP v2
// ScoredRecovery doc.
// ----------------------------------------------------------------------------

interface RecoveryBase {
  cycleId: number;
  sleepId: string;
  userId: number;
  createdAt: string;
  updatedAt: string;
}

export interface RecoveryScored extends RecoveryBase {
  scoreState: 'SCORED';
  recoveryScore: number;
  restingHeartRate: number;
  hrvRmssdMilli: number;
  spo2Percentage: number;
  skinTempCelsius: number;
  userCalibrating: boolean;
}

export interface RecoveryPending extends RecoveryBase {
  scoreState: 'PENDING_SCORE';
}

export interface RecoveryUnscorable extends RecoveryBase {
  scoreState: 'UNSCORABLE';
}

export type Recovery = RecoveryScored | RecoveryPending | RecoveryUnscorable;

// ----------------------------------------------------------------------------
// Sleep — UUID-string id per WHOOP v2 (A6). SCORED-only fields per WHOOP v2
// ScoredSleep doc.
// ----------------------------------------------------------------------------

interface SleepBase {
  id: string;
  userId: number;
  createdAt: string;
  updatedAt: string;
  start: string;
  end: string;
  timezoneOffset: string;
}

export interface SleepScored extends SleepBase {
  scoreState: 'SCORED';
  totalInBedTimeMilli: number;
  totalAwakeTimeMilli: number;
  sleepPerformancePercentage: number;
  sleepConsistencyPercentage: number;
  sleepEfficiencyPercentage: number;
  respiratoryRate: number;
}

export interface SleepPending extends SleepBase {
  scoreState: 'PENDING_SCORE';
}

export interface SleepUnscorable extends SleepBase {
  scoreState: 'UNSCORABLE';
}

export type Sleep = SleepScored | SleepPending | SleepUnscorable;

// ----------------------------------------------------------------------------
// Workout — UUID-string id per WHOOP v2 (A6). SCORED-only fields per WHOOP v2
// ScoredWorkout doc. `sportId` is non-score metadata that ships on every
// variant per the wire shape.
// ----------------------------------------------------------------------------

interface WorkoutBase {
  id: string;
  userId: number;
  createdAt: string;
  updatedAt: string;
  start: string;
  end: string;
  timezoneOffset: string;
  sportId: number | null;
}

export interface WorkoutScored extends WorkoutBase {
  scoreState: 'SCORED';
  strain: number;
  averageHeartRate: number;
  maxHeartRate: number;
  kilojoule: number;
  distanceMeter: number | null;
  altitudeGainMeter: number | null;
  altitudeChangeMeter: number | null;
}

export interface WorkoutPending extends WorkoutBase {
  scoreState: 'PENDING_SCORE';
}

export interface WorkoutUnscorable extends WorkoutBase {
  scoreState: 'UNSCORABLE';
}

export type Workout = WorkoutScored | WorkoutPending | WorkoutUnscorable;

// ----------------------------------------------------------------------------
// Profile — non-scored. Single-row low-volume table per D-01. WHOOP profile
// response has no `updated_at` (A4); `fetchedAt` is the sync-time ISO string.
// ----------------------------------------------------------------------------

export type Profile = {
  userId: number;
  email: string;
  firstName: string;
  lastName: string;
  fetchedAt: string;
};

// ----------------------------------------------------------------------------
// BodyMeasurement — non-scored. Append-on-change history per D-35; synthetic
// autoincrement id (WHOOP response has no stable id).
// ----------------------------------------------------------------------------

export type BodyMeasurement = {
  id: number;
  userId: number;
  heightMeter: number;
  weightKilogram: number;
  maxHeartRate: number;
  capturedAt: string;
};

// ----------------------------------------------------------------------------
// SyncRun — D-24 row shape. The orchestrator inserts at sync-start with
// status='running', updates per-resource on completion, finalizes with
// status='ok' | 'partial' | 'failed'. `perResource` is the typed map of
// outcomes keyed by ResourceName (imported from Plan 03-04 sync.ts).
// `flags` is the CLI/MCP input echo (--days / --since / --resources) as a
// JSON string for diagnostic readback.
// ----------------------------------------------------------------------------

export type SyncRun = {
  id: number;
  startedAt: string;
  finishedAt: string | null;
  status: 'running' | 'ok' | 'partial' | 'failed';
  perResource: Record<ResourceName, ResourceSyncOutcome>;
  gapsDetected: number;
  flags: string | null;
};

// ----------------------------------------------------------------------------
// Decision — DEC-01 / D-01 irreplaceable user data per Pitfall 7. ULID id
// generated by the future Phase 4 decision-add service. Phase 3 ships the
// shape only — no service logic for decisions in this phase.
// ----------------------------------------------------------------------------

export type Decision = {
  id: string;
  createdAt: string;
  category: string;
  decision: string;
  rationale: string | null;
  confidence: 'low' | 'medium' | 'high' | null;
  expectedEffect: string | null;
  followUpDate: string | null;
  status: 'open' | 'followed_up' | 'abandoned';
  outcomeNotes: string | null;
};

// ----------------------------------------------------------------------------
// DailySummary — D-01 created empty in Phase 3; Phase 4 baseline service
// writes during review computation. PK is YYYY-MM-DD (date column). Every
// scored field is nullable because not every day has a corresponding
// SCORED row across all resources (and the absence is informative for
// ADR-0004 "no reliable pattern detected" output).
// ----------------------------------------------------------------------------

export type DailySummary = {
  date: string;
  userId: number;
  recoveryScore: number | null;
  sleepEfficiencyPercentage: number | null;
  dayStrain: number | null;
  respiratoryRate: number | null;
  hrvRmssdMilli: number | null;
  restingHeartRate: number | null;
  computedAt: string;
};

// ----------------------------------------------------------------------------
// Re-exports — convenience for downstream consumers that want both the
// discriminator literal AND the entity types from a single import.
// ----------------------------------------------------------------------------

export type { ScoreState };
