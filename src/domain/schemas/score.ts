// Per-resource Zod score discriminated unions — convenience re-exports of
// the raw discriminator schemas from `whoop-api.ts`. D-03 + ADR-0003: the
// SCORED variant is the only branch the domain operates on by default
// (D-04); PENDING_SCORE + UNSCORABLE carry no score fields.
//
// Many call sites use the raw schemas + normalizer + entity narrowing rather
// than this file directly — but this file gives downstream consumers a
// single import for "the score discriminator schema for resource X" when
// they want a typed parse against the SCORED-vs-not partition without
// pulling in the full page-wrapper.
//
// Pure schema re-exports. No I/O, no runtime side effects.

export type {
  WhoopRawCycleType as CycleScoreType,
  WhoopRawRecoveryType as RecoveryScoreType,
  WhoopRawSleepType as SleepScoreType,
  WhoopRawWorkoutType as WorkoutScoreType,
} from './whoop-api.js';
export {
  WhoopRawCycle as CycleScore,
  WhoopRawRecovery as RecoveryScore,
  WhoopRawSleep as SleepScore,
  WhoopRawWorkout as WorkoutScore,
} from './whoop-api.js';
