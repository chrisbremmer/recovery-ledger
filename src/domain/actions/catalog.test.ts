// RED: failing tests for ACTION_CATALOG (D-08 + D-09 + D-26 + ADR-0005).
//
// Five contracts asserted at module-load:
//   1. >= 10 entries (D-08 catalog-sized-to-cover-anomaly-space).
//   2. Per-entry shape: unique id, METRIC_NAMES-typed anomaly_metric,
//      'low'|'high' direction, non-empty text, integer priority >= 1.
//   3. Per-entry banned-word lint via containsBannedToneToken (D-09 + D-26
//      source-layer defence; mirror of the Wave 3 D-26 contract test on
//      rendered output).
//   4. Per-entry verb-first single-sentence rule (REV-08): first word is
//      capitalized + letters, followed by a space; text length < 120 chars.
//   5. Coverage: at least one entry for each of the 6 actionable D-06
//      trigger keys (HRV-low, recovery-low, sleep_duration-low,
//      sleep_efficiency-low, RHR-high, respiratory-high).
//   6. Determinism: Object.isFrozen(ACTION_CATALOG) === true.

import { describe, expect, it } from 'vitest';
import { containsBannedToneToken } from '../banned-words.js';
import { METRIC_NAMES_SET, type MetricName } from '../baselines/types.js';

import { ACTION_CATALOG } from './catalog.js';

const REQUIRED_COVERAGE: ReadonlyArray<{ metric: MetricName; direction: 'low' | 'high' }> = [
  { metric: 'hrv_rmssd_milli', direction: 'low' },
  { metric: 'recovery_score', direction: 'low' },
  { metric: 'sleep_duration_minutes', direction: 'low' },
  { metric: 'sleep_efficiency_percent', direction: 'low' },
  { metric: 'resting_heart_rate', direction: 'high' },
  { metric: 'respiratory_rate', direction: 'high' },
];

describe('ACTION_CATALOG (D-08 + D-09 source-layer contract)', () => {
  it('has at least 10 entries', () => {
    expect(ACTION_CATALOG.length).toBeGreaterThanOrEqual(10);
  });

  it('every entry has a unique id', () => {
    const ids = new Set<string>();
    for (const entry of ACTION_CATALOG) {
      expect(ids.has(entry.id)).toBe(false);
      ids.add(entry.id);
    }
  });

  it('every entry has METRIC_NAMES-typed trigger metric + low|high direction', () => {
    for (const entry of ACTION_CATALOG) {
      expect(METRIC_NAMES_SET.has(entry.trigger.anomaly_metric)).toBe(true);
      expect(['low', 'high']).toContain(entry.trigger.direction);
    }
  });

  it('every entry has integer priority >= 1', () => {
    for (const entry of ACTION_CATALOG) {
      expect(Number.isInteger(entry.priority)).toBe(true);
      expect(entry.priority).toBeGreaterThanOrEqual(1);
    }
  });

  it('every entry text passes banned-word lint (D-09 + D-26 + ADR-0005 source-layer)', () => {
    for (const entry of ACTION_CATALOG) {
      const result = containsBannedToneToken(entry.text);
      // Surface the offending word + entry id on failure so a future PR
      // adding a catalog entry fails with an actionable error message.
      expect(result, `entry '${entry.id}' tripped tone lint: ${JSON.stringify(result)}`).toEqual({
        hit: false,
      });
    }
  });

  it('every entry text is verb-first single sentence (REV-08 + D-09)', () => {
    const VERB_FIRST_RE = /^[A-Z][a-z]+\s/;
    for (const entry of ACTION_CATALOG) {
      expect(entry.text).toMatch(VERB_FIRST_RE);
      expect(entry.text.length).toBeLessThan(120);
      expect(entry.text.length).toBeGreaterThan(0);
    }
  });

  it('covers all 6 actionable D-06 trigger keys', () => {
    for (const { metric, direction } of REQUIRED_COVERAGE) {
      const match = ACTION_CATALOG.find(
        (e) => e.trigger.anomaly_metric === metric && e.trigger.direction === direction,
      );
      expect(match, `no catalog entry covers ${metric} ${direction}`).toBeDefined();
    }
  });

  it('is frozen at module load (determinism)', () => {
    expect(Object.isFrozen(ACTION_CATALOG)).toBe(true);
  });
});
