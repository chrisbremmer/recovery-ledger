// RED: failing tests for computeZAnalysis + selectAnomalies per D-06.
//
// D-05 ZAnalysis discriminated union (3 variants):
//   - { kind: 'computed', value, baseline_median, baseline_mad, tier }
//   - { kind: 'refused', reason: 'insufficient_days', days_available, days_required: 14 }
//   - { kind: 'refused', reason: 'baseline_mad_zero', days_available }
//
// D-06 Anomaly firing rule (selectAnomalies):
//   (a) ZAnalysis.kind === 'computed'
//   (b) |z| >= 2.0
//   (c) direction matches the metric per ANOMALY_DIRECTION (low or high
//       — bidirectional metrics NEVER fire)
//
// ADR-0004: empty Anomaly[] is a typed positive output (not an error).
//
// Plan 04-04 Wave 1 — pure-domain layer. Tests run BEFORE implementation
// exists; first run is the RED gate.

import { describe, expect, it } from 'vitest';
import type { BaselineStats, MetricName } from '../baselines/types.js';
import type { TodayMetrics } from '../review/types.js';

import { computeZAnalysis, selectAnomalies } from './anomaly.js';

const baselineOf = (metric: MetricName, median: number, mad: number, n = 30): BaselineStats => ({
  metric,
  median,
  mad,
  n,
  coverage_pct: (n / 30) * 100,
});

const emptyToday = (): TodayMetrics => ({
  recovery_score: null,
  hrv_rmssd_milli: null,
  resting_heart_rate: null,
  spo2_percentage: null,
  skin_temp_celsius: null,
  day_strain: null,
  sleep_duration_minutes: null,
  sleep_efficiency_percent: null,
  respiratory_rate: null,
});

describe('computeZAnalysis', () => {
  it('refuses with insufficient_days when daysAvailable = 13', () => {
    const result = computeZAnalysis({
      value: 50,
      baseline: baselineOf('hrv_rmssd_milli', 50, 10),
      daysAvailable: 13,
      daysRequired: 14,
    });
    expect(result.kind).toBe('refused');
    if (result.kind === 'refused') {
      expect(result.reason).toBe('insufficient_days');
      if (result.reason === 'insufficient_days') {
        expect(result.days_available).toBe(13);
        expect(result.days_required).toBe(14);
      }
    }
  });

  it('refuses with insufficient_days when value is null (defensive — caller should pre-filter)', () => {
    const result = computeZAnalysis({
      value: null,
      baseline: baselineOf('hrv_rmssd_milli', 50, 10),
      daysAvailable: 30,
      daysRequired: 14,
    });
    expect(result.kind).toBe('refused');
    if (result.kind === 'refused') {
      expect(result.reason).toBe('insufficient_days');
    }
  });

  it('refuses with insufficient_days when value is NaN (defensive non-finite guard)', () => {
    const result = computeZAnalysis({
      value: Number.NaN,
      baseline: baselineOf('hrv_rmssd_milli', 50, 10),
      daysAvailable: 30,
      daysRequired: 14,
    });
    expect(result.kind).toBe('refused');
  });

  it('refuses with baseline_mad_zero when baseline.mad === 0 (Pitfall 12)', () => {
    const result = computeZAnalysis({
      value: 50,
      baseline: baselineOf('respiratory_rate', 15.5, 0),
      daysAvailable: 30,
      daysRequired: 14,
    });
    expect(result.kind).toBe('refused');
    if (result.kind === 'refused') {
      expect(result.reason).toBe('baseline_mad_zero');
      if (result.reason === 'baseline_mad_zero') {
        expect(result.days_available).toBe(30);
      }
    }
  });

  it('computes z when value=70, baseline (median=50, mad=10), daysAvailable=30 -> z ≈ 1.349, tier=strong', () => {
    const result = computeZAnalysis({
      value: 70,
      baseline: baselineOf('recovery_score', 50, 10),
      daysAvailable: 30,
      daysRequired: 14,
    });
    expect(result.kind).toBe('computed');
    if (result.kind === 'computed') {
      // robust_sigma = 1.4826 * 10 = 14.826 -> z = (70 - 50) / 14.826 ≈ 1.349
      expect(result.value).toBeCloseTo(1.349, 3);
      expect(result.baseline_median).toBe(50);
      expect(result.baseline_mad).toBe(10);
      expect(result.tier).toBe('strong');
    }
  });

  it('sets tier=weak at boundary daysAvailable=14', () => {
    const result = computeZAnalysis({
      value: 50,
      baseline: baselineOf('hrv_rmssd_milli', 50, 8),
      daysAvailable: 14,
      daysRequired: 14,
    });
    expect(result.kind).toBe('computed');
    if (result.kind === 'computed') {
      expect(result.tier).toBe('weak');
    }
  });

  it('sets tier=strong at boundary daysAvailable=20', () => {
    const result = computeZAnalysis({
      value: 50,
      baseline: baselineOf('hrv_rmssd_milli', 50, 8),
      daysAvailable: 20,
      daysRequired: 14,
    });
    expect(result.kind).toBe('computed');
    if (result.kind === 'computed') {
      expect(result.tier).toBe('strong');
    }
  });
});

describe('selectAnomalies', () => {
  it('fires HRV-low when today HRV=25, baseline median=50/mad=8 (z ≈ -2.108, direction=low)', () => {
    const today = emptyToday();
    today.hrv_rmssd_milli = 25;
    const anomalies = selectAnomalies({
      today,
      baselines: [baselineOf('hrv_rmssd_milli', 50, 8)],
      perMetricDaysAvailable: { ...zeroDaysAvailable, hrv_rmssd_milli: 30 },
    });
    expect(anomalies).toHaveLength(1);
    expect(anomalies[0]?.metric).toBe('hrv_rmssd_milli');
    expect(anomalies[0]?.direction).toBe('low');
    expect(anomalies[0]?.z).toBeLessThanOrEqual(-2);
    // baseline_mad_scaled = 1.4826 * 8 = 11.8608
    expect(anomalies[0]?.baseline_mad_scaled).toBeCloseTo(11.8608, 3);
    expect(anomalies[0]?.baseline_median).toBe(50);
    expect(anomalies[0]?.tier).toBe('strong');
  });

  it('does NOT fire when HRV is favorably high (z ≈ +2.108 but direction=low)', () => {
    const today = emptyToday();
    today.hrv_rmssd_milli = 75;
    const anomalies = selectAnomalies({
      today,
      baselines: [baselineOf('hrv_rmssd_milli', 50, 8)],
      perMetricDaysAvailable: { ...zeroDaysAvailable, hrv_rmssd_milli: 30 },
    });
    expect(anomalies).toHaveLength(0);
  });

  it('fires RHR-high when today RHR=70, baseline median=55/mad=5 (z ≈ +2.024, direction=high)', () => {
    const today = emptyToday();
    today.resting_heart_rate = 70;
    const anomalies = selectAnomalies({
      today,
      baselines: [baselineOf('resting_heart_rate', 55, 5)],
      perMetricDaysAvailable: { ...zeroDaysAvailable, resting_heart_rate: 30 },
    });
    expect(anomalies).toHaveLength(1);
    expect(anomalies[0]?.direction).toBe('high');
    expect(anomalies[0]?.z).toBeGreaterThanOrEqual(2);
  });

  it('NEVER fires for day_strain even at |z|=3 (bidirectional — D-06 informational only)', () => {
    const today = emptyToday();
    today.day_strain = 30; // far above baseline median 10
    const anomalies = selectAnomalies({
      today,
      baselines: [baselineOf('day_strain', 10, 2)],
      perMetricDaysAvailable: { ...zeroDaysAvailable, day_strain: 30 },
    });
    expect(anomalies).toHaveLength(0);
  });

  it('NEVER fires for spo2_percentage (bidirectional informational-only per research §2)', () => {
    const today = emptyToday();
    today.spo2_percentage = 80; // far below baseline median 97
    const anomalies = selectAnomalies({
      today,
      baselines: [baselineOf('spo2_percentage', 97, 1)],
      perMetricDaysAvailable: { ...zeroDaysAvailable, spo2_percentage: 30 },
    });
    expect(anomalies).toHaveLength(0);
  });

  it('NEVER fires for skin_temp_celsius (bidirectional informational-only per research §2)', () => {
    const today = emptyToday();
    today.skin_temp_celsius = 34;
    const anomalies = selectAnomalies({
      today,
      baselines: [baselineOf('skin_temp_celsius', 33, 0.2)],
      perMetricDaysAvailable: { ...zeroDaysAvailable, skin_temp_celsius: 30 },
    });
    expect(anomalies).toHaveLength(0);
  });

  it('mixed run — HRV-low fires + RHR-high fires + sleep refused (12 days) + strain skipped', () => {
    const today = emptyToday();
    today.hrv_rmssd_milli = 25;
    today.resting_heart_rate = 70;
    today.sleep_duration_minutes = 200; // would fire low if not refused
    today.day_strain = 25; // would be |z| > 2 but skipped (bidirectional)

    const anomalies = selectAnomalies({
      today,
      baselines: [
        baselineOf('hrv_rmssd_milli', 50, 8),
        baselineOf('resting_heart_rate', 55, 5),
        baselineOf('sleep_duration_minutes', 450, 30),
        baselineOf('day_strain', 10, 2),
      ],
      perMetricDaysAvailable: {
        ...zeroDaysAvailable,
        hrv_rmssd_milli: 30,
        resting_heart_rate: 30,
        sleep_duration_minutes: 12, // refused — under 14
        day_strain: 30,
      },
    });

    expect(anomalies).toHaveLength(2);
    const metrics = anomalies.map((a) => a.metric).sort();
    expect(metrics).toEqual(['hrv_rmssd_milli', 'resting_heart_rate']);
  });

  it('Review #44: fires HRV-low at exactly z = -2.0 (boundary)', () => {
    const today = emptyToday();
    // baseline median=50, mad=8 → robustSigma = 1.4826 * 8 = 11.8608.
    // value = 50 - 2*11.8608 = 26.2784 → z = -2.000 exactly.
    today.hrv_rmssd_milli = 26.2784;
    const anomalies = selectAnomalies({
      today,
      baselines: [baselineOf('hrv_rmssd_milli', 50, 8)],
      perMetricDaysAvailable: { ...zeroDaysAvailable, hrv_rmssd_milli: 30 },
    });
    expect(anomalies).toHaveLength(1);
    expect(anomalies[0]?.z).toBeCloseTo(-2.0, 3);
  });

  it('Review #44: does NOT fire HRV-low at z = -1.999 (near-miss boundary)', () => {
    const today = emptyToday();
    // Same baseline; value=26.29 → z slightly higher than -2 (e.g., -1.998).
    today.hrv_rmssd_milli = 26.29;
    const anomalies = selectAnomalies({
      today,
      baselines: [baselineOf('hrv_rmssd_milli', 50, 8)],
      perMetricDaysAvailable: { ...zeroDaysAvailable, hrv_rmssd_milli: 30 },
    });
    expect(anomalies).toHaveLength(0);
  });

  it('returns [] (ADR-0004 typed positive output) when all metrics are favorable', () => {
    const today = emptyToday();
    today.hrv_rmssd_milli = 50; // exactly at median -> z = 0
    today.recovery_score = 75; // favorable high -> direction low won't fire
    today.resting_heart_rate = 55; // exactly at median
    const anomalies = selectAnomalies({
      today,
      baselines: [
        baselineOf('hrv_rmssd_milli', 50, 8),
        baselineOf('recovery_score', 50, 10),
        baselineOf('resting_heart_rate', 55, 5),
      ],
      perMetricDaysAvailable: {
        ...zeroDaysAvailable,
        hrv_rmssd_milli: 30,
        recovery_score: 30,
        resting_heart_rate: 30,
      },
    });
    expect(anomalies).toEqual([]);
  });

  it('skips metrics with no baseline entry', () => {
    const today = emptyToday();
    today.hrv_rmssd_milli = 10; // would fire if baseline existed
    const anomalies = selectAnomalies({
      today,
      baselines: [], // no baselines at all
      perMetricDaysAvailable: { ...zeroDaysAvailable, hrv_rmssd_milli: 30 },
    });
    expect(anomalies).toHaveLength(0);
  });

  it('skips metrics where today value is null', () => {
    const today = emptyToday();
    // hrv_rmssd_milli stays null
    const anomalies = selectAnomalies({
      today,
      baselines: [baselineOf('hrv_rmssd_milli', 50, 8)],
      perMetricDaysAvailable: { ...zeroDaysAvailable, hrv_rmssd_milli: 30 },
    });
    expect(anomalies).toHaveLength(0);
  });
});

const zeroDaysAvailable: Record<MetricName, number> = {
  recovery_score: 0,
  hrv_rmssd_milli: 0,
  resting_heart_rate: 0,
  spo2_percentage: 0,
  skin_temp_celsius: 0,
  day_strain: 0,
  sleep_duration_minutes: 0,
  sleep_efficiency_percent: 0,
  respiratory_rate: 0,
};
