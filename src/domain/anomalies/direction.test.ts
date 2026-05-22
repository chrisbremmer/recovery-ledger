// RED: failing tests for ANOMALY_DIRECTION per D-06 — per-metric direction
// map for the Anomaly firing rule. Verifies (1) every entry in METRIC_NAMES
// has a direction, (2) each per-metric mapping matches D-06 verbatim, and
// (3) the freeze invariant (Shared Pattern 2).
//
// Plan 04-04 Wave 1 — pure-domain layer. Wave 0 ships METRIC_NAMES (9 raw
// measurement names); this test file exercises the direction map BEFORE
// the implementation exists — so the first run is the RED gate.

import { describe, expect, it } from 'vitest';

import { METRIC_NAMES } from '../baselines/types.js';

import { ANOMALY_DIRECTION } from './direction.js';

describe('ANOMALY_DIRECTION', () => {
  it('covers every METRIC_NAMES entry exactly once', () => {
    expect(Object.keys(ANOMALY_DIRECTION).sort()).toEqual([...METRIC_NAMES].sort());
    expect(Object.keys(ANOMALY_DIRECTION)).toHaveLength(9);
  });

  it('maps HRV to low (z <= -2 is bad — D-06)', () => {
    expect(ANOMALY_DIRECTION.hrv_rmssd_milli).toBe('low');
  });

  it('maps recovery_score to low (z <= -2 is bad — D-06)', () => {
    expect(ANOMALY_DIRECTION.recovery_score).toBe('low');
  });

  it('maps sleep_duration_minutes to low (z <= -2 is bad — D-06)', () => {
    expect(ANOMALY_DIRECTION.sleep_duration_minutes).toBe('low');
  });

  it('maps sleep_efficiency_percent to low (z <= -2 is bad — D-06)', () => {
    expect(ANOMALY_DIRECTION.sleep_efficiency_percent).toBe('low');
  });

  it('maps resting_heart_rate to high (z >= +2 is bad — D-06)', () => {
    expect(ANOMALY_DIRECTION.resting_heart_rate).toBe('high');
  });

  it('maps respiratory_rate to high (z >= +2 is bad — D-06)', () => {
    expect(ANOMALY_DIRECTION.respiratory_rate).toBe('high');
  });

  it('maps day_strain to bidirectional (informational only — D-06)', () => {
    expect(ANOMALY_DIRECTION.day_strain).toBe('bidirectional');
  });

  it('maps spo2_percentage to bidirectional (research §2 did not assign a direction)', () => {
    expect(ANOMALY_DIRECTION.spo2_percentage).toBe('bidirectional');
  });

  it('maps skin_temp_celsius to bidirectional (research §2 did not assign a direction)', () => {
    expect(ANOMALY_DIRECTION.skin_temp_celsius).toBe('bidirectional');
  });

  it('is frozen (Shared Pattern 2 — runtime-immutable module-load constant)', () => {
    expect(Object.isFrozen(ANOMALY_DIRECTION)).toBe(true);
  });
});
