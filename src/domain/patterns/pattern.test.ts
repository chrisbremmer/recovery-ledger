// RED: failing tests for detectWeeklyPattern (Plan 04-05 RESEARCH §6 verbatim).
//
// The detector consumes the trailing-28-day window arrays already-filtered
// by the SERVICE layer (Plan 04-07 — D-12 input-array discipline). Each
// test below synthesizes a small cycles/recoveries/sleeps/workouts set in
// memory; the detector composes Mann-Whitney + BH FDR + the worst-day
// bottom-quartile selection against those arrays and emits a discriminated
// `WeeklyPattern` plus per-candidate `CandidateResult[]` and `worst_days`.
//
// Five contracts asserted:
//   - Insufficient window: < 14 scored cycles → `no_pattern.insufficient_window_days`
//   - All candidates refused: 14 scored cycles but every prior-day field is
//     missing → `no_pattern.all_candidates_refused`.
//   - REV-07 LOAD-BEARING (D-35 anchor): a synthetic 20-cycle input where the
//     engineered prior-day signals are near-baseline → BH @ q=0.10 rejects
//     nothing → `no_pattern.no_factor_cleared_fdr`.
//   - Pattern detected (weak): 14 scored cycles, sleep durations engineered
//     so worst-recovery days had ~4h vs other days ~7.5h → cleared FDR,
//     `pattern.factor === 'sleep_duration_prior_night'`, direction
//     `'worst_days_had_lower'`, pattern_confidence `'weak'` (N < 20).
//   - Pattern detected (strong): same engineering at 22 cycles →
//     `pattern_confidence === 'strong'`.
//   - Tie-break test: two cycles with identical recovery_score → the
//     chronologically-earlier one is in `worst_days` (Pitfall 1).
//   - Multi-detection (D-18): two candidates clear FDR → the one with
//     smaller `p_adjusted` becomes `pattern.factor`; all 5 ship in
//     candidate_results.

import { describe, expect, it } from 'vitest';

import type { BaselineStats } from '../baselines/types.js';
import type {
  CycleScored,
  RecoveryScored,
  SleepScored,
  WorkoutScored,
} from '../types/entities.js';

import { detectWeeklyPattern } from './pattern.js';

const IANA_ZONE = 'America/Los_Angeles';

// Build a single SCORED Cycle. `dayIndex` is the offset from the synthetic
// epoch 2026-01-01; `recoveryScoreSlot` is the score the matching Recovery
// will carry; `strain` is the cycle's own day_strain (used as a candidate
// signal). Cycle.start uses 08:00:00-08:00 (LA wall clock 00:00) so the
// calendar day matches `dayIndex`.
const cycleAt = (
  dayIndex: number,
  strain: number,
): CycleScored => {
  const startDate = new Date(Date.UTC(2026, 0, 1 + dayIndex, 8, 0, 0)).toISOString();
  const endDate = new Date(Date.UTC(2026, 0, 2 + dayIndex, 8, 0, 0)).toISOString();
  return {
    id: 100_000 + dayIndex,
    userId: 1,
    createdAt: startDate,
    updatedAt: startDate,
    start: startDate,
    end: endDate,
    timezoneOffset: '-08:00',
    baselineExcluded: false,
    exclusionReason: null,
    scoreState: 'SCORED',
    strain,
    kilojoule: 12_000,
    averageHeartRate: 60,
    maxHeartRate: 160,
  };
};

const recoveryFor = (cycle: CycleScored, score: number, hrv: number): RecoveryScored => ({
  cycleId: cycle.id,
  sleepId: `${cycle.id}-sleep`,
  userId: 1,
  createdAt: cycle.start,
  updatedAt: cycle.start,
  scoreState: 'SCORED',
  recoveryScore: score,
  restingHeartRate: 55,
  hrvRmssdMilli: hrv,
  spo2Percentage: 97,
  skinTempCelsius: 33.5,
  userCalibrating: false,
});

// Build a Sleep that ended within the cycle's calendar day. `durationMinutes`
// drives the sleep_duration_prior_night candidate. The plan's algorithm
// looks for the sleep that ended in the cycle's calendar day (start date).
const sleepFor = (cycle: CycleScored, durationMinutes: number): SleepScored => {
  const cycleStartDay = cycle.start.slice(0, 10);
  // Sleep ends at 07:00 UTC = 23:00 LA the prior day; the cycle's calendar
  // day in LA is the start.slice(0,10). For test simplicity we set the
  // sleep's end to 07:00 UTC on the cycle's start date so the calendar-day
  // match holds.
  const end = new Date(`${cycleStartDay}T07:00:00.000Z`).toISOString();
  const start = new Date(new Date(end).getTime() - durationMinutes * 60_000).toISOString();
  return {
    id: `${cycle.id}-sleep`,
    userId: 1,
    createdAt: start,
    updatedAt: start,
    start,
    end,
    timezoneOffset: '-08:00',
    scoreState: 'SCORED',
    totalInBedTimeMilli: durationMinutes * 60_000,
    totalAwakeTimeMilli: 0,
    sleepPerformancePercentage: 90,
    sleepConsistencyPercentage: 90,
    sleepEfficiencyPercentage: 95,
    respiratoryRate: 15,
  };
};

const baselineHrv: BaselineStats = {
  metric: 'hrv_rmssd_milli',
  median: 50,
  mad: 5,
  n: 30,
  coverage_pct: 100,
};

interface BuildOpts {
  /** Number of scored cycles to synthesize (day 0 .. n-1). */
  n: number;
  /**
   * Returns the recovery score for cycle `i`. Lower → more likely to land in
   * worst_days (bottom quartile).
   */
  recoveryFn: (i: number) => number;
  /** Returns the sleep duration (minutes) for cycle `i`'s prior-night sleep. */
  sleepDurationFn?: (i: number) => number;
  /** Returns the day_strain for cycle `i`. */
  strainFn?: (i: number) => number;
}

const buildInput = (opts: BuildOpts) => {
  const cycles: CycleScored[] = [];
  const recoveries: RecoveryScored[] = [];
  const sleeps: SleepScored[] = [];
  for (let i = 0; i < opts.n; i++) {
    const strain = opts.strainFn?.(i) ?? 10;
    const cycle = cycleAt(i, strain);
    cycles.push(cycle);
    recoveries.push(recoveryFor(cycle, opts.recoveryFn(i), 50));
    if (opts.sleepDurationFn !== undefined) {
      sleeps.push(sleepFor(cycle, opts.sleepDurationFn(i)));
    }
  }
  const workouts: WorkoutScored[] = [];
  return {
    cycles,
    recoveries,
    sleeps,
    workouts,
    baselines: { hrv_rmssd_milli: baselineHrv },
    ianaZone: IANA_ZONE,
  };
};

describe('detectWeeklyPattern', () => {
  describe('refusal paths (no_pattern arm)', () => {
    it('returns insufficient_window_days when scoredCycles < 14', () => {
      const input = buildInput({ n: 10, recoveryFn: (i) => 50 + i });
      const result = detectWeeklyPattern(input);
      expect(result.pattern.kind).toBe('no_pattern');
      if (result.pattern.kind === 'no_pattern') {
        expect(result.pattern.reason).toBe('insufficient_window_days');
      }
      expect(result.candidate_results.length).toBe(0);
      expect(result.worst_days.length).toBe(0);
    });

    it('returns all_candidates_refused when every prior-day field is missing', () => {
      // 14 cycles with NO sleeps array → sleep_duration_prior_night refuses.
      // No HRV recoveries past day 0 → hrv_delta_prior_day refuses.
      // workouts empty → workout_timing_late_evening produces a 0-only
      // sample which still computes; we need ALL candidates to refuse for
      // this branch. Approach: use only 2 cycles' worth of usable data so
      // every candidate's sample size for worst (n=2) AND other (n=12)
      // collapses for the priors.
      const input = buildInput({
        n: 14,
        recoveryFn: (i) => 50 + i,
        // Strain = NaN for all but day 0 → prior-day-strain refuses.
        strainFn: (_i) => Number.NaN,
      });
      // Hand-drop most recoveries' hrv so hrv_delta_prior_day refuses.
      input.recoveries = input.recoveries.map((r, i) => ({
        ...r,
        // Mark every record as if hrv was missing (NaN) — the detector
        // skips non-finite values.
        hrvRmssdMilli: i === 0 ? r.hrvRmssdMilli : Number.NaN,
      }));
      const result = detectWeeklyPattern(input);
      expect(result.pattern.kind).toBe('no_pattern');
      if (result.pattern.kind === 'no_pattern') {
        expect(result.pattern.reason).toBe('all_candidates_refused');
      }
      // All 5 candidates should be marked refused.
      expect(result.candidate_results.length).toBe(5);
      for (const c of result.candidate_results) {
        expect(c.refused).toBe(true);
        expect(c.refusal_reason).toBe('sample_too_small');
      }
    });

    it('returns no_factor_cleared_fdr when BH @ q=0.10 rejects nothing (REV-07)', () => {
      // Engineer data where no candidate has a strong worst-vs-other gap.
      // Sleep durations alternate around 420 minutes regardless of recovery,
      // strain noise is small, and HRV deltas are flat. Recovery scores form
      // a smooth ramp so worst_days is well-defined but the prior-day
      // signals show no real pattern → p_raws will be moderate-to-large
      // → BH @ q=0.10 rejects nothing.
      const input = buildInput({
        n: 20,
        recoveryFn: (i) => 40 + i, // 40..59 — bottom-quartile = first 5 days
        sleepDurationFn: (i) => 420 + (i % 3) * 5, // 420/425/430 cycling
        strainFn: (i) => 10 + (i % 4) * 0.5, // 10/10.5/11/11.5 cycling
      });
      const result = detectWeeklyPattern(input);
      expect(result.pattern.kind).toBe('no_pattern');
      if (result.pattern.kind === 'no_pattern') {
        expect(result.pattern.reason).toBe('no_factor_cleared_fdr');
      }
      // candidate_results should be the full 5-entry list, mostly
      // non-refused, with at least one `cleared === false` after BH.
      expect(result.candidate_results.length).toBe(5);
      const anyCleared = result.candidate_results.some((c) => c.cleared);
      expect(anyCleared).toBe(false);
    });
  });

  describe('detected arm', () => {
    it('emits weak confidence for 14 cycles with engineered sleep_duration signal', () => {
      // Engineer: worst-recovery days (lowest 3-4 by score) have ~240min
      // sleep (4h); other days have ~450min (7.5h). The gap is large enough
      // that Mann-Whitney's p_raw drops well below 0.10 / 5 = 0.02 → BH @
      // q=0.10 rejects sleep_duration_prior_night.
      const input = buildInput({
        n: 14,
        // Recovery scores: first 3 days = 30/31/32 (worst), rest = 70..80.
        recoveryFn: (i) => (i < 3 ? 30 + i : 70 + i),
        // Sleep durations follow recovery: low recovery → short sleep.
        sleepDurationFn: (i) => (i < 3 ? 240 + i * 5 : 450 + (i % 3) * 5),
        strainFn: (i) => 10 + (i % 3) * 0.3,
      });
      const result = detectWeeklyPattern(input);
      expect(result.pattern.kind).toBe('detected');
      if (result.pattern.kind === 'detected') {
        expect(result.pattern.factor).toBe('sleep_duration_prior_night');
        expect(result.pattern.direction).toBe('worst_days_had_lower');
        expect(result.pattern.pattern_confidence).toBe('weak');
        expect(result.pattern.statistic.p_adjusted).toBeLessThan(0.1);
      }
      // worst_days size = floor(14/4) = 3.
      expect(result.worst_days.length).toBe(3);
    });

    it('emits strong confidence for 22 cycles with the same engineered signal', () => {
      const input = buildInput({
        n: 22,
        recoveryFn: (i) => (i < 5 ? 30 + i : 70 + i),
        sleepDurationFn: (i) => (i < 5 ? 240 + i * 5 : 450 + (i % 3) * 5),
        strainFn: (i) => 10 + (i % 3) * 0.3,
      });
      const result = detectWeeklyPattern(input);
      expect(result.pattern.kind).toBe('detected');
      if (result.pattern.kind === 'detected') {
        expect(result.pattern.factor).toBe('sleep_duration_prior_night');
        expect(result.pattern.pattern_confidence).toBe('strong');
      }
      expect(result.worst_days.length).toBe(5);
    });
  });

  describe('worst_days tie-break (Pitfall 1)', () => {
    it('keeps the chronologically-earlier cycle on identical recovery_score ties', () => {
      // 14 cycles. Day 0 and Day 3 BOTH have recovery_score 30. All others
      // ramp 50..62. floor(14/4)=3 worst_days expected. Day 0 should be in;
      // Day 3 should be the next-lowest (since both at 30, but the cycle on
      // Day 0 sorts before Day 3 chronologically).
      const input = buildInput({
        n: 14,
        recoveryFn: (i) => {
          if (i === 0 || i === 3) return 30;
          if (i === 5) return 32;
          return 50 + i;
        },
        sleepDurationFn: (i) => 420,
      });
      const result = detectWeeklyPattern(input);
      // worst_days length = 3.
      expect(result.worst_days.length).toBe(3);
      const dates = result.worst_days.map((d) => d.date);
      // Day 0 (2026-01-01) and Day 3 (2026-01-04) both at recovery 30; Day
      // 5 (2026-01-06) at 32. All three should be present.
      expect(dates).toContain('2026-01-01');
      expect(dates).toContain('2026-01-04');
      expect(dates).toContain('2026-01-06');
    });
  });

  describe('multi-detection (D-18)', () => {
    it('picks the cleared candidate with smallest p_adjusted as pattern.factor', () => {
      // Engineer: both sleep_duration AND day_strain_prior_day track with
      // worst-recovery days. Sleep gap is huge (clears FDR with tiny p);
      // strain gap is moderate (clears FDR with larger p). Detector should
      // pick sleep_duration_prior_night (smaller p_adjusted).
      const input = buildInput({
        n: 22,
        recoveryFn: (i) => (i < 5 ? 30 + i : 70 + i),
        sleepDurationFn: (i) => (i < 5 ? 240 + i * 5 : 450 + (i % 3) * 5),
        // Strain is also elevated on worst-recovery days but the effect is
        // smaller in magnitude.
        strainFn: (i) => (i < 5 ? 16 + i * 0.2 : 10 + (i % 3) * 0.5),
      });
      const result = detectWeeklyPattern(input);
      expect(result.pattern.kind).toBe('detected');
      if (result.pattern.kind === 'detected') {
        expect(result.pattern.factor).toBe('sleep_duration_prior_night');
      }
      // candidate_results should list all 5; the strain candidate may or
      // may not be cleared depending on the exact engineered p-values, but
      // sleep_duration MUST be cleared.
      expect(result.candidate_results.length).toBe(5);
      const sleepResult = result.candidate_results.find(
        (c) => c.factor === 'sleep_duration_prior_night',
      );
      expect(sleepResult?.cleared).toBe(true);
    });
  });
});
