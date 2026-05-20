// Deterministic fixture expander for daily-review JSON fixtures.
//
// Plan 04-07 fixture corpus: each daily JSON file declares the dates of
// SCORED cycles + a metric-overrides spec; this helper expands the spec
// into the full entity arrays the test harness inserts into the in-memory
// DB. Keeping the expansion in a single file means the JSON fixtures stay
// concise + reviewable + diff-friendly; the test runner is the single site
// where shape decisions land.
//
// Deterministic seeding: per-cycle metric variations use a small mod-based
// sequence (no PRNG) so re-running the test suite next year produces
// byte-identical fixture expansions.

import type { Cycle, Recovery, Sleep, Workout } from '../../../../src/domain/types/entities.js';

export interface DailyFixtureSpec {
  kind: 'daily';
  name: string;
  reviewed_date: string;
  userId: number;
  scored_cycle_dates: string[];
  metric_overrides: {
    default_recovery_score: number;
    default_hrv: number;
    default_rhr: number;
    default_strain: number;
    default_sleep_in_bed_min: number;
    default_sleep_awake_min: number;
    default_sleep_efficiency: number;
    default_respiratory_rate: number;
    metric_variance?: number;
    today_override?: {
      hrv?: number;
      rhr?: number;
      recovery_score?: number;
      strain?: number;
      sleep_in_bed_min?: number;
      sleep_awake_min?: number;
      sleep_efficiency?: number;
    };
  };
  expected: Record<string, number | string | boolean>;
}

export interface ExpandedDailyFixture {
  cycles: Cycle[];
  recoveries: Recovery[];
  sleeps: Sleep[];
  workouts: Workout[];
}

/** Expand a spec into the canonical entity arrays. The cycles array is
 *  pre-sorted ASC by start so repo upserts land in chronological order. */
export function expandDailyFixture(spec: DailyFixtureSpec): ExpandedDailyFixture {
  const cycles: Cycle[] = [];
  const recoveries: Recovery[] = [];
  const sleeps: Sleep[] = [];
  const today = spec.reviewed_date;

  const mo = spec.metric_overrides;
  const variance = mo.metric_variance ?? 0;

  const sortedDates = [...spec.scored_cycle_dates].sort();
  sortedDates.forEach((dateIso, index) => {
    const cycleId = 1000 + index;
    const sleepId = `sleep-${cycleId.toString().padStart(6, '0')}`;
    const startIso = `${dateIso}T07:00:00.000Z`;

    // Deterministic small variance to avoid MAD=0 baseline refusal — the
    // sequence alternates between +/- variance with no RNG dependency.
    const variation = variance === 0 ? 0 : ((index % 3) - 1) * variance;

    const isToday = dateIso === today;
    const todayOverride = isToday ? mo.today_override : undefined;

    const recoveryScore = todayOverride?.recovery_score ?? mo.default_recovery_score + variation;
    const hrv = todayOverride?.hrv ?? mo.default_hrv + variation;
    const rhr = todayOverride?.rhr ?? mo.default_rhr + variation;
    const strain = todayOverride?.strain ?? mo.default_strain + variation * 0.1;
    const inBedMin = todayOverride?.sleep_in_bed_min ?? mo.default_sleep_in_bed_min + variation * 2;
    const awakeMin = todayOverride?.sleep_awake_min ?? mo.default_sleep_awake_min;
    const efficiency = todayOverride?.sleep_efficiency ?? mo.default_sleep_efficiency + variation;
    const respiratoryRate = mo.default_respiratory_rate + variation * 0.05;

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
      restingHeartRate: rhr,
      hrvRmssdMilli: hrv,
      spo2Percentage: 97 + variation * 0.01,
      skinTempCelsius: 33.5 + variation * 0.01,
      userCalibrating: false,
    });

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
      totalAwakeTimeMilli: awakeMin * 60_000,
      sleepPerformancePercentage: 88,
      sleepConsistencyPercentage: 75,
      sleepEfficiencyPercentage: efficiency,
      respiratoryRate,
    });
  });

  return { cycles, recoveries, sleeps, workouts: [] };
}
