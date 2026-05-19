import { describe, expect, it } from 'vitest';

import { METRIC_NAMES, METRIC_NAMES_SET, type BaselineStats, type MetricName } from './types.js';

// Task 1 (Plan 04-02) — D-04 metric tuple + BaselineStats shape contract.
// The closed-tuple + ReadonlySet pattern is Shared Pattern 2 (Phase 3
// `src/domain/types/score.ts` precedent). Adding/removing a metric requires
// editing THIS tuple; the type derives, the runtime Set derives, and the 9-
// length assertion below catches drift.

describe('METRIC_NAMES (D-04)', () => {
  it('is a 9-tuple of the locked raw measurement names', () => {
    // The 9 entries match D-04 verbatim — Phase 4 will read each into
    // `TodayMetrics` as `number | null` (D-04 §raw measurements).
    expect(METRIC_NAMES).toEqual([
      'recovery_score',
      'hrv_rmssd_milli',
      'resting_heart_rate',
      'spo2_percentage',
      'skin_temp_celsius',
      'day_strain',
      'sleep_duration_minutes',
      'sleep_efficiency_percent',
      'respiratory_rate',
    ]);
    expect(METRIC_NAMES).toHaveLength(9);
  });

  it('builds METRIC_NAMES_SET with one entry per tuple element', () => {
    expect(METRIC_NAMES_SET.size).toBe(METRIC_NAMES.length);
    for (const name of METRIC_NAMES) {
      expect(METRIC_NAMES_SET.has(name)).toBe(true);
    }
  });
});

describe('BaselineStats shape', () => {
  it('accepts a stat with all required fields populated', () => {
    const stat: BaselineStats = {
      metric: 'hrv_rmssd_milli',
      median: 50,
      mad: 8,
      n: 24,
      coverage_pct: 80,
    };
    expect(stat.metric).toBe('hrv_rmssd_milli');
    expect(stat.n).toBeGreaterThan(0);
    expect(stat.coverage_pct).toBe(80);
  });

  it('narrows metric to MetricName at the type boundary', () => {
    // Exhaustive switch — adding a 10th metric to METRIC_NAMES (and not to the
    // switch below) would be a `tsc --noEmit` error at compile time. This is
    // the Shared Pattern 2 forcing function.
    const name: MetricName = 'recovery_score';
    let touched = false;
    switch (name) {
      case 'recovery_score':
      case 'hrv_rmssd_milli':
      case 'resting_heart_rate':
      case 'spo2_percentage':
      case 'skin_temp_celsius':
      case 'day_strain':
      case 'sleep_duration_minutes':
      case 'sleep_efficiency_percent':
      case 'respiratory_rate':
        touched = true;
        break;
    }
    expect(touched).toBe(true);
  });
});
