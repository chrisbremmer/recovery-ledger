// RED: failing tests for selectActions per D-08 (catalog-driven selection,
// ≤ 3 cap, ADR-0004 typed positive output for empty anomalies).
//
// Contracts:
//   - Empty anomalies → [] (ADR-0004 typed positive output).
//   - One Anomaly (HRV-low) → returns the matching entries (≤ 3 cap; the
//     HRV-low catalog set has 2 entries so the result has 2).
//   - Three anomalies that match 5+ catalog entries → cap at 3 (D-08).
//   - Determinism: same anomaly input → same SuggestedAction[] across runs
//     (priority tie-break is stable, source order locked).
//   - No matching catalog entries (defensive — should be rare given
//     coverage) → [].
//   - Each returned SuggestedAction has id + text matching the catalog
//     entry, plus metric/direction echoed from the firing Anomaly.

import { describe, expect, it } from 'vitest';

import type { Anomaly } from '../anomalies/types.js';
import type { MetricName } from '../baselines/types.js';

import { ACTION_CATALOG } from './catalog.js';

import { selectActions } from './select.js';

const anomalyOf = (metric: MetricName, direction: 'low' | 'high', z = -3): Anomaly => ({
  metric,
  z,
  direction,
  baseline_median: 50,
  baseline_mad_scaled: 5,
  tier: 'strong',
});

describe('selectActions (D-08 catalog-driven selection)', () => {
  it('returns [] for empty anomalies (ADR-0004 typed positive output)', () => {
    expect(selectActions([])).toEqual([]);
  });

  it('returns catalog entries matching a single HRV-low Anomaly', () => {
    const out = selectActions([anomalyOf('hrv_rmssd_milli', 'low')]);
    // The catalog ships two HRV-low entries; both should surface.
    expect(out.length).toBe(2);
    for (const action of out) {
      expect(action.metric).toBe('hrv_rmssd_milli');
      expect(action.direction).toBe('low');
    }
    // ids should be the catalog ids in priority order (10 before 20).
    expect(out[0]?.id).toBe('hrv-low-easy-intensity');
    expect(out[1]?.id).toBe('hrv-low-skip-hard-strain');
  });

  it('caps at 3 entries across multiple firing anomalies (D-08)', () => {
    const out = selectActions([
      anomalyOf('hrv_rmssd_milli', 'low'),
      anomalyOf('recovery_score', 'low'),
      anomalyOf('sleep_duration_minutes', 'low'),
    ]);
    // HRV-low (2) + recovery-low (2) + sleep_duration-low (2) = 6 matches;
    // D-08 caps at 3.
    expect(out.length).toBe(3);
  });

  it('returns deterministic output across runs (priority + source order)', () => {
    const anomalies = [
      anomalyOf('hrv_rmssd_milli', 'low'),
      anomalyOf('resting_heart_rate', 'high', 3),
    ];
    const first = selectActions(anomalies);
    const second = selectActions(anomalies);
    expect(first).toEqual(second);
  });

  it('returns [] when no catalog entry matches (defensive)', () => {
    // day_strain is bidirectional per ANOMALY_DIRECTION so the firing rule
    // never builds this Anomaly shape in production, BUT the function must
    // refuse gracefully if a future code path constructs one.
    const synthetic: Anomaly = {
      metric: 'day_strain',
      z: -3,
      direction: 'low',
      baseline_median: 10,
      baseline_mad_scaled: 2,
      tier: 'strong',
    };
    expect(selectActions([synthetic])).toEqual([]);
  });

  it('echoes anomaly metric + direction onto the SuggestedAction', () => {
    const [first] = selectActions([anomalyOf('respiratory_rate', 'high', 3)]);
    expect(first).toBeDefined();
    if (first) {
      expect(first.metric).toBe('respiratory_rate');
      expect(first.direction).toBe('high');
      // text comes from the catalog entry verbatim.
      const catalogEntry = ACTION_CATALOG.find((e) => e.id === first.id);
      expect(catalogEntry?.text).toBe(first.text);
    }
  });
});
