// detectWeeklyPattern — Weekly review pattern detector (RESEARCH §6 + D-12 +
// D-18 + D-34). Pure function: no I/O, no clock, no logger.
//
// The 12-step algorithm transcribed verbatim from 04-RESEARCH §6:
//
//   1. Filter `cycles` to SCORED + !baselineExcluded + has a SCORED Recovery
//      with non-null recoveryScore. Call this `scoredCycles`. (The
//      trailing-28-day windowing is applied UPSTREAM by the service caller
//      per D-12 — pattern.ts never re-windows.)
//   2. If scoredCycles.length < 14 → no_pattern.insufficient_window_days.
//   3. nWorst = max(2, floor(scoredCycles.length / 4)).
//   4. Sort scoredCycles ASC by recoveryScore (tie-break: start ASC per
//      Pitfall 1 chronological order).
//   5. worst_days = sortedAscending.slice(0, nWorst).
//   6. Build worst-cycle-id Set + other-cycle-id Set.
//   7. For each candidate in CANDIDATE_FACTORS:
//      - assemble sampleWorst[] + sampleOther[] (helpers below).
//      - if worst < 2 OR other < 4: refused, refusal_reason 'sample_too_small'.
//      - else: mannWhitney(sampleWorst, sampleOther) → push p_raw.
//   8. nonRefusedPs = candidate_results.filter(!refused).map(r => r.p_raw).
//   9. If nonRefusedPs is empty → no_pattern.all_candidates_refused.
//   10. benjaminiHochberg(nonRefusedPs, q=0.10) → fill cleared + p_adjusted.
//   11. If no candidate.cleared → no_pattern.no_factor_cleared_fdr.
//   12. Else: pick the cleared candidate with smallest p_adjusted (D-18
//       multi-detection policy); compute direction via median(sampleWorst)
//       vs median(sampleOther); pattern_confidence = 'strong' if N >= 20
//       else 'weak' (D-34); return detected arm.
//
// Pitfall 6 (ADR-0004 forcing function): every return path returns a
// discriminated arm of WeeklyPattern; a `null` return would fail to type-
// check at the call site.
//
// SCORED-discipline (ADR-0003): score_state narrowing happens at the
// filter step; downstream helpers receive only `SCORED` variants.

import type { BaselineStats } from '../baselines/types.js';
import { benjaminiHochberg } from '../stats/fdr.js';
import { MAD_CONSISTENCY } from '../stats/mad.js';
import { mannWhitney } from '../stats/mann-whitney.js';
import { median } from '../stats/median.js';
import type {
  Cycle,
  CycleScored,
  Recovery,
  RecoveryScored,
  Sleep,
  SleepScored,
  Workout,
  WorkoutScored,
} from '../types/entities.js';

import { CANDIDATE_FACTORS, type CandidateName } from './candidates.js';
import type { CandidateResult, WeeklyPattern, WorstDay } from './types.js';

const DEFAULT_Q = 0.1;
const N_WEAK_FLOOR = 14;
const N_STRONG_FLOOR = 20;
const SLEEP_NEED_MINUTES = 480; // 8 hours — D-11 sleep_debt_3d_rolling anchor.

export interface DetectWeeklyPatternInput {
  cycles: Cycle[];
  recoveries: Recovery[];
  sleeps: Sleep[];
  workouts: Workout[];
  baselines: Record<'hrv_rmssd_milli', BaselineStats>;
  ianaZone: string;
}

export interface DetectWeeklyPatternResult {
  pattern: WeeklyPattern;
  candidate_results: CandidateResult[];
  worst_days: WorstDay[];
}

// Internal per-cycle sample carrier — stores the worst/other split + the
// raw worst/other values per candidate for later median comparison.
interface CandidateSamples {
  worst: number[];
  other: number[];
}

export function detectWeeklyPattern(
  input: DetectWeeklyPatternInput,
  q: number = DEFAULT_Q,
): DetectWeeklyPatternResult {
  // Step 1: filter to SCORED + !excluded + has a SCORED Recovery with
  // non-null recoveryScore. The matching Recovery is keyed by cycleId.
  const recoveryByCycleId = new Map<number, RecoveryScored>();
  for (const r of input.recoveries) {
    if (r.scoreState === 'SCORED' && Number.isFinite(r.recoveryScore)) {
      recoveryByCycleId.set(r.cycleId, r);
    }
  }

  type ScoredPair = { cycle: CycleScored; recovery: RecoveryScored };
  const scoredCycles: ScoredPair[] = [];
  for (const c of input.cycles) {
    if (c.scoreState !== 'SCORED') continue;
    if (c.baselineExcluded) continue;
    const recovery = recoveryByCycleId.get(c.id);
    if (recovery === undefined) continue;
    scoredCycles.push({ cycle: c, recovery });
  }

  // Step 2: insufficient window guard.
  if (scoredCycles.length < N_WEAK_FLOOR) {
    return {
      pattern: { kind: 'no_pattern', reason: 'insufficient_window_days' },
      candidate_results: [],
      worst_days: [],
    };
  }

  // Step 3: bottom-quartile size with floor of 2.
  const nWorst = Math.max(2, Math.floor(scoredCycles.length / 4));

  // Step 4: sort by recovery ASC; tie-break by start ASC (Pitfall 1
  // chronologically-earlier-wins).
  const sortedAsc = [...scoredCycles].sort((a, b) => {
    const recoveryDelta = a.recovery.recoveryScore - b.recovery.recoveryScore;
    if (recoveryDelta !== 0) return recoveryDelta;
    return a.cycle.start.localeCompare(b.cycle.start);
  });

  // Step 5: worst_days slot (chronological tie-break already applied).
  const worstPairs = sortedAsc.slice(0, nWorst);
  const worst_days: WorstDay[] = worstPairs.map(({ cycle, recovery }) => ({
    date: cycle.start.slice(0, 10),
    recovery_score: recovery.recoveryScore,
  }));

  // Step 6: worst-id Set vs other-id Set.
  const worstIds = new Set<number>(worstPairs.map((p) => p.cycle.id));

  // Build per-cycle prior lookups for the candidate helpers. The cycles need
  // to be sorted by start ASC so "prior cycle" / "prior 3 cycles" are
  // unambiguous.
  const cyclesByStartAsc = [...scoredCycles].sort((a, b) =>
    a.cycle.start.localeCompare(b.cycle.start),
  );
  const cycleStartIndex = new Map<number, number>();
  for (let i = 0; i < cyclesByStartAsc.length; i++) {
    const pair = cyclesByStartAsc[i];
    if (pair !== undefined) cycleStartIndex.set(pair.cycle.id, i);
  }

  const sleepsScored: SleepScored[] = input.sleeps.filter(
    (s): s is SleepScored => s.scoreState === 'SCORED',
  );
  const workoutsScored: WorkoutScored[] = input.workouts.filter(
    (w): w is WorkoutScored => w.scoreState === 'SCORED',
  );

  // Helpers: each returns a number OR null when the per-cycle signal is
  // missing/refused. Null values are dropped from the resulting sample
  // arrays before the < 2 / < 4 sample-size gate.

  // sleep_duration_prior_night — find the sleep that ended in the cycle's
  // calendar day; take duration in minutes from (in-bed - awake).
  const sleepDurationFor = (pair: ScoredPair): number | null => {
    const cycleDate = pair.cycle.start.slice(0, 10);
    const match = sleepsScored.find((s) => s.end.slice(0, 10) === cycleDate);
    if (match === undefined) return null;
    const duration = (match.totalInBedTimeMilli - match.totalAwakeTimeMilli) / 60_000;
    return Number.isFinite(duration) ? duration : null;
  };

  // sleep_debt_3d_rolling — sum of (480 - actual) over the prior 3 cycles'
  // sleeps. Returns null if ANY of the 3 priors is missing a sleep.
  const sleepDebtFor = (pair: ScoredPair): number | null => {
    const idx = cycleStartIndex.get(pair.cycle.id) ?? -1;
    if (idx < 3) return null;
    let debt = 0;
    for (let k = 1; k <= 3; k++) {
      const prior = cyclesByStartAsc[idx - k];
      if (prior === undefined) return null;
      const priorDuration = sleepDurationFor(prior);
      if (priorDuration === null) return null;
      debt += SLEEP_NEED_MINUTES - priorDuration;
    }
    return debt;
  };

  // day_strain_prior_day — prior cycle's day_strain (Cycle.strain).
  const dayStrainPriorFor = (pair: ScoredPair): number | null => {
    const idx = cycleStartIndex.get(pair.cycle.id) ?? -1;
    if (idx < 1) return null;
    const prior = cyclesByStartAsc[idx - 1];
    if (prior === undefined) return null;
    return Number.isFinite(prior.cycle.strain) ? prior.cycle.strain : null;
  };

  // workout_timing_late_evening — count of workouts whose start lies in the
  // prior cycle's 18:00-23:59 user-local window (ianaZone). When the user
  // logged zero workouts across the entire window, workout timing has no
  // statistical signal → every per-cycle value collapses to null and the
  // candidate refuses via the sample-size gate. Otherwise: returns the
  // integer count (0 is a valid sample) so days with zero late-evening
  // workouts contribute to the sample.
  const lateEveningWorkoutsFor = (pair: ScoredPair): number | null => {
    if (workoutsScored.length === 0) return null;
    const idx = cycleStartIndex.get(pair.cycle.id) ?? -1;
    if (idx < 1) return null;
    const prior = cyclesByStartAsc[idx - 1];
    if (prior === undefined) return null;
    let count = 0;
    for (const w of workoutsScored) {
      const startMs = Date.parse(w.start);
      if (Number.isNaN(startMs)) continue;
      const localHour = hourInZone(startMs, input.ianaZone);
      const localDate = dateInZone(startMs, input.ianaZone);
      // Workout's local date must equal the prior cycle's calendar day in
      // the same zone.
      const priorDate = dateInZone(Date.parse(prior.cycle.start), input.ianaZone);
      if (localDate === priorDate && localHour >= 18) count += 1;
    }
    return count;
  };

  // hrv_delta_prior_day — prior cycle's HRV Z-score vs trailing-30 baseline.
  // Refused (null) when baseline.mad === 0 or the prior cycle's hrv is null.
  const hrvDeltaPriorFor = (pair: ScoredPair): number | null => {
    const baseline = input.baselines.hrv_rmssd_milli;
    if (baseline === undefined || baseline.mad === 0) return null;
    const idx = cycleStartIndex.get(pair.cycle.id) ?? -1;
    if (idx < 1) return null;
    const prior = cyclesByStartAsc[idx - 1];
    if (prior === undefined) return null;
    const hrv = prior.recovery.hrvRmssdMilli;
    if (!Number.isFinite(hrv)) return null;
    const robustSigma = MAD_CONSISTENCY * baseline.mad;
    if (robustSigma === 0) return null;
    return (hrv - baseline.median) / robustSigma;
  };

  const factorHelpers: Record<CandidateName, (pair: ScoredPair) => number | null> = {
    sleep_duration_prior_night: sleepDurationFor,
    sleep_debt_3d_rolling: sleepDebtFor,
    day_strain_prior_day: dayStrainPriorFor,
    workout_timing_late_evening: lateEveningWorkoutsFor,
    hrv_delta_prior_day: hrvDeltaPriorFor,
  };

  // Step 7: per-candidate sample assembly + Mann-Whitney.
  const candidate_results: CandidateResult[] = [];
  const samplesByFactor = new Map<CandidateName, CandidateSamples>();
  const uForFactor = new Map<CandidateName, number>();

  for (const factor of CANDIDATE_FACTORS) {
    const fn = factorHelpers[factor];
    const worst: number[] = [];
    const other: number[] = [];
    for (const pair of scoredCycles) {
      const value = fn(pair);
      if (value === null) continue;
      if (worstIds.has(pair.cycle.id)) {
        worst.push(value);
      } else {
        other.push(value);
      }
    }
    samplesByFactor.set(factor, { worst, other });

    if (worst.length < 2 || other.length < 4) {
      candidate_results.push({
        factor,
        p_raw: Number.NaN,
        p_adjusted: Number.NaN,
        cleared: false,
        refused: true,
        refusal_reason: 'sample_too_small',
      });
      continue;
    }

    const { U, p } = mannWhitney(worst, other);
    uForFactor.set(factor, U);
    candidate_results.push({
      factor,
      p_raw: p,
      p_adjusted: 0,
      cleared: false,
      refused: false,
    });
  }

  // Step 8 + 9: collect non-refused p-values; if empty → all_candidates_refused.
  const nonRefusedIndices: number[] = [];
  const nonRefusedPs: number[] = [];
  candidate_results.forEach((c, i) => {
    if (!c.refused) {
      nonRefusedIndices.push(i);
      nonRefusedPs.push(c.p_raw);
    }
  });
  if (nonRefusedPs.length === 0) {
    return {
      pattern: { kind: 'no_pattern', reason: 'all_candidates_refused' },
      candidate_results,
      worst_days,
    };
  }

  // Step 10: run BH and map back the cleared + p_adjusted fields.
  const bh = benjaminiHochberg(nonRefusedPs, q);
  for (let j = 0; j < nonRefusedIndices.length; j++) {
    const idx = nonRefusedIndices[j];
    if (idx === undefined) continue;
    const target = candidate_results[idx];
    if (target === undefined) continue;
    const adj = bh.adjusted[j];
    const rej = bh.rejected[j];
    candidate_results[idx] = {
      ...target,
      p_adjusted: adj ?? Number.NaN,
      cleared: rej ?? false,
    };
  }

  // Step 11: no cleared candidates → no_factor_cleared_fdr.
  const cleared = candidate_results.filter((c) => c.cleared);
  if (cleared.length === 0) {
    return {
      pattern: { kind: 'no_pattern', reason: 'no_factor_cleared_fdr' },
      candidate_results,
      worst_days,
    };
  }

  // Step 12: D-18 multi-detection — pick the cleared candidate with the
  // smallest p_adjusted. Tie-break by source order (CANDIDATE_FACTORS
  // declaration order) so the result is deterministic.
  let winner = cleared[0];
  if (winner === undefined) {
    // Defensive — cleared.length >= 1 was just verified above, but the
    // type-narrow keeps strict-TS happy without a non-null assertion.
    return {
      pattern: { kind: 'no_pattern', reason: 'no_factor_cleared_fdr' },
      candidate_results,
      worst_days,
    };
  }
  for (const c of cleared) {
    if (c.p_adjusted < winner.p_adjusted) winner = c;
  }

  const samples = samplesByFactor.get(winner.factor);
  const direction: 'worst_days_had_lower' | 'worst_days_had_higher' =
    samples !== undefined && median(samples.worst) < median(samples.other)
      ? 'worst_days_had_lower'
      : 'worst_days_had_higher';

  const pattern_confidence: 'weak' | 'strong' =
    scoredCycles.length >= N_STRONG_FLOOR ? 'strong' : 'weak';

  const U = uForFactor.get(winner.factor) ?? 0;

  return {
    pattern: {
      kind: 'detected',
      factor: winner.factor,
      statistic: { U, p_raw: winner.p_raw, p_adjusted: winner.p_adjusted },
      direction,
      pattern_confidence,
    },
    candidate_results,
    worst_days,
  };
}

// ---------------------------------------------------------------------------
// Zone-aware helpers (Intl-based; no extra dependency). Both helpers return
// the wall-clock representation of `msEpoch` in `ianaZone` — hour as an
// integer 0..23 and date as YYYY-MM-DD. Used by the
// workout_timing_late_evening candidate to decide whether a workout falls
// in the prior-cycle's 18:00-23:59 user-local window.
// ---------------------------------------------------------------------------

function hourInZone(msEpoch: number, ianaZone: string): number {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: ianaZone,
    hour: 'numeric',
    hourCycle: 'h23',
  });
  const parts = fmt.formatToParts(new Date(msEpoch));
  const hourPart = parts.find((p) => p.type === 'hour');
  return hourPart === undefined ? 0 : Number.parseInt(hourPart.value, 10);
}

function dateInZone(msEpoch: number, ianaZone: string): string {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: ianaZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  return fmt.format(new Date(msEpoch)); // en-CA returns YYYY-MM-DD
}
