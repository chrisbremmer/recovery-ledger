// Deterministic fixture expander for weekly-review JSON fixtures.
//
// Plan 04-07 weekly fixtures must yield specific pattern detector outcomes
// (clears FDR / no_factor_cleared_fdr / partial_rejection / insufficient
// window / silent vs none_this_week decision prompt). Each JSON spec
// describes N scored cycles + per-day sleep/strain overrides; this
// helper expands the spec into the canonical entity arrays.
//
// The pattern detector (Plan 04-05) consumes (cycles, recoveries, sleeps,
// workouts) and emits a typed WeeklyPattern + candidate_results.
// Constructing samples that hit specific Mann-Whitney p-values is
// non-trivial — fixtures rely on large separations between worst-day
// vs other-day sleep distributions to drive p_raw < q and FDR rejection.

import type { Cycle, Recovery, Sleep, Workout } from '../../../../src/domain/types/entities.js';

export interface WeeklyDayOverride {
  /** ISO date (yyyy-mm-dd) — must match one of the spec's `scored_cycle_dates`. */
  date: string;
  recovery_score?: number;
  hrv?: number;
  strain?: number;
  /** Sleep duration in minutes (in-bed - awake). */
  sleep_duration_min?: number;
  /** Whether this day's prior-day workout fell in 18:00-23:59 local zone. */
  late_evening_workout_on_prior_day?: boolean;
}

export interface WeeklyFixtureSpec {
  kind: 'weekly';
  name: string;
  reviewed_date: string;
  userId: number;
  iana_zone: string;
  /** SCORED-cycle dates in the trailing-28 window. Defaults provided for
   *  every metric; per-day overrides via `day_overrides`. */
  scored_cycle_dates: string[];
  defaults: {
    recovery_score: number;
    hrv: number;
    rhr: number;
    strain: number;
    sleep_in_bed_min: number;
    sleep_awake_min: number;
    respiratory_rate: number;
  };
  day_overrides?: WeeklyDayOverride[];
  /** Pre-existing decisions (used for decision_prompt 'silent' fixture). */
  prior_decisions?: Array<{ createdAt: string; decision: string }>;
  expected: {
    pattern_kind: 'detected' | 'no_pattern';
    pattern_factor?: string;
    pattern_reason?: string;
    pattern_confidence?: 'weak' | 'strong';
    decision_prompt_kind: 'silent' | 'none_this_week';
    confidence_tier: 'insufficient' | 'weak' | 'strong';
    candidate_results_length: number;
  };
}

export interface ExpandedWeeklyFixture {
  cycles: Cycle[];
  recoveries: Recovery[];
  sleeps: Sleep[];
  workouts: Workout[];
}

export function expandWeeklyFixture(spec: WeeklyFixtureSpec): ExpandedWeeklyFixture {
  const cycles: Cycle[] = [];
  const recoveries: Recovery[] = [];
  const sleeps: Sleep[] = [];
  const workouts: Workout[] = [];

  const overrideByDate = new Map<string, WeeklyDayOverride>();
  for (const o of spec.day_overrides ?? []) overrideByDate.set(o.date, o);

  const sortedDates = [...spec.scored_cycle_dates].sort();
  sortedDates.forEach((dateIso, index) => {
    const cycleId = 1000 + index;
    const sleepId = `sleep-${cycleId.toString().padStart(6, '0')}`;
    const startIso = `${dateIso}T07:00:00.000Z`;
    const override = overrideByDate.get(dateIso);

    // Light deterministic variance so MAD != 0 on default-value paths.
    const variation = (index % 3) - 1;

    const recoveryScore = override?.recovery_score ?? spec.defaults.recovery_score + variation;
    const hrv = override?.hrv ?? spec.defaults.hrv + variation;
    const strain = override?.strain ?? spec.defaults.strain + variation * 0.1;
    const inBedMin = override?.sleep_duration_min
      ? override.sleep_duration_min + spec.defaults.sleep_awake_min
      : spec.defaults.sleep_in_bed_min + variation;

    cycles.push({
      id: cycleId,
      userId: spec.userId,
      createdAt: startIso,
      updatedAt: startIso,
      start: startIso,
      end: null,
      timezoneOffset: '-07:00',
      baselineExcluded: false,
      exclusionReason: null,
      scoreState: 'SCORED',
      strain,
      kilojoule: 10000 + index * 100,
      averageHeartRate: 65 + variation,
      maxHeartRate: 170 + variation,
    });

    recoveries.push({
      cycleId,
      sleepId,
      userId: spec.userId,
      createdAt: `${dateIso}T08:00:00.000Z`,
      updatedAt: `${dateIso}T08:00:00.000Z`,
      scoreState: 'SCORED',
      recoveryScore,
      restingHeartRate: spec.defaults.rhr + variation,
      hrvRmssdMilli: hrv,
      spo2Percentage: 97,
      skinTempCelsius: 33.5,
      userCalibrating: false,
    });

    // Sleep that ends on the cycle's calendar day — pattern.ts matches
    // sleeps to cycles via `sleep.end.slice(0,10) === cycle.start.slice(0,10)`.
    sleeps.push({
      id: sleepId,
      userId: spec.userId,
      createdAt: `${dateIso}T08:00:00.000Z`,
      updatedAt: `${dateIso}T08:00:00.000Z`,
      start: `${dateIso}T05:00:00.000Z`,
      end: `${dateIso}T08:00:00.000Z`,
      timezoneOffset: '-07:00',
      scoreState: 'SCORED',
      totalInBedTimeMilli: inBedMin * 60_000,
      totalAwakeTimeMilli: spec.defaults.sleep_awake_min * 60_000,
      sleepPerformancePercentage: 88,
      sleepConsistencyPercentage: 75,
      sleepEfficiencyPercentage: 90 + variation,
      respiratoryRate: spec.defaults.respiratory_rate + variation * 0.05,
    });

    // Late-evening workout on prior day (if specified). The workout's
    // local hour must be >= 18 in the spec's iana_zone for the
    // workout_timing_late_evening candidate to count it.
    if (override?.late_evening_workout_on_prior_day && index > 0) {
      const priorDate = sortedDates[index - 1];
      if (priorDate !== undefined) {
        workouts.push({
          id: `workout-${cycleId.toString().padStart(6, '0')}`,
          userId: spec.userId,
          createdAt: `${priorDate}T19:00:00.000Z`,
          updatedAt: `${priorDate}T19:00:00.000Z`,
          // Set start in UTC to a local-evening hour given iana_zone.
          // For America/Los_Angeles (-07:00), UTC 02:00 = local 19:00 next day.
          // Simpler: pick a UTC time that maps to >=18 in the zone.
          // For Los Angeles, UTC 02:00 = 19:00 PT previous day. We'll
          // use UTC 03:00 of the day AFTER priorDate = 20:00 PT priorDate.
          start: addUtcHoursToDate(priorDate, 3),
          end: addUtcHoursToDate(priorDate, 4),
          timezoneOffset: '-07:00',
          sportId: 0,
          scoreState: 'SCORED',
          strain: 12,
          averageHeartRate: 150,
          maxHeartRate: 180,
          kilojoule: 1500,
          distanceMeter: null,
          altitudeGainMeter: null,
          altitudeChangeMeter: null,
        });
      }
    }
  });

  return { cycles, recoveries, sleeps, workouts };
}

function addUtcHoursToDate(dateIso: string, hours: number): string {
  const ms = Date.parse(`${dateIso}T00:00:00.000Z`) + hours * 3_600_000;
  return new Date(ms).toISOString();
}
