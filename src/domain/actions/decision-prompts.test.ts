// RED: failing tests for DECISION_PROMPT_CATALOG (D-23 + D-26 + ADR-0005).
//
// Contracts asserted at module-load:
//   - DECISION_PROMPT_CATALOG.length === 6 (1 generic + 5 per-factor per D-23).
//   - Each entry has a unique id + non-empty text.
//   - Generic entry has trigger === 'no_pattern' and no factor field.
//   - Per-factor entries have trigger === 'pattern_detected' and a factor
//     that is a member of CANDIDATE_FACTORS_SET; each of the 5 D-11
//     candidates is covered exactly once.
//   - Every text passes the banned-word lint (D-23 + D-26 source-layer).
//   - Object.isFrozen(DECISION_PROMPT_CATALOG) === true.

import { describe, expect, it } from 'vitest';

import { containsBannedToneToken } from '../banned-words.js';
import { CANDIDATE_FACTORS, CANDIDATE_FACTORS_SET } from '../patterns/candidates.js';

import { DECISION_PROMPT_CATALOG } from './decision-prompts.js';

describe('DECISION_PROMPT_CATALOG (D-23 + D-26 source-layer contract)', () => {
  it('has exactly 6 entries (1 generic + 5 per-factor)', () => {
    expect(DECISION_PROMPT_CATALOG.length).toBe(6);
  });

  it('every entry has a unique id', () => {
    const ids = new Set<string>();
    for (const entry of DECISION_PROMPT_CATALOG) {
      expect(ids.has(entry.id)).toBe(false);
      ids.add(entry.id);
    }
  });

  it('every entry has non-empty text', () => {
    for (const entry of DECISION_PROMPT_CATALOG) {
      expect(entry.text.length).toBeGreaterThan(0);
    }
  });

  it('contains exactly one no_pattern generic entry without factor', () => {
    const generics = DECISION_PROMPT_CATALOG.filter((e) => e.trigger === 'no_pattern');
    expect(generics.length).toBe(1);
    const first = generics[0];
    expect(first).toBeDefined();
    if (first) {
      expect(first.factor).toBeUndefined();
    }
  });

  it('contains exactly 5 pattern_detected entries, one per D-11 candidate', () => {
    const detected = DECISION_PROMPT_CATALOG.filter((e) => e.trigger === 'pattern_detected');
    expect(detected.length).toBe(5);
    const factorsCovered = new Set<string>();
    for (const entry of detected) {
      expect(entry.factor).toBeDefined();
      expect(entry.factor !== undefined && CANDIDATE_FACTORS_SET.has(entry.factor)).toBe(true);
      // No duplicate factors.
      if (entry.factor !== undefined) {
        expect(factorsCovered.has(entry.factor)).toBe(false);
        factorsCovered.add(entry.factor);
      }
    }
    // Every D-11 candidate has its own entry.
    for (const candidate of CANDIDATE_FACTORS) {
      expect(factorsCovered.has(candidate)).toBe(true);
    }
  });

  it('every entry text passes banned-word lint (D-23 + D-26 + ADR-0005)', () => {
    for (const entry of DECISION_PROMPT_CATALOG) {
      const result = containsBannedToneToken(entry.text);
      expect(result, `entry '${entry.id}' tripped tone lint: ${JSON.stringify(result)}`).toEqual({
        hit: false,
      });
    }
  });

  it('is frozen at module load (determinism)', () => {
    expect(Object.isFrozen(DECISION_PROMPT_CATALOG)).toBe(true);
  });
});
