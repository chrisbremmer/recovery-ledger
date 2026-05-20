// RED: failing tests for CANDIDATE_FACTORS module-load constant (D-11 lock).
//
// Three assertions anchor the D-11 contract:
//   - CANDIDATE_FACTORS.length === 5 (the 5-tuple lock).
//   - CANDIDATE_FACTORS deep-equals CANDIDATE_FACTORS_TYPE_ONLY from the
//     Wave 0 Plan 04-02 anchor (verbatim textual sync — a future edit to
//     either tuple breaks this test).
//   - CANDIDATE_FACTORS_SET has 5 entries (runtime membership Set built
//     from the tuple per Shared Pattern 2).
//
// The two dropped candidates from REV-06's 7-factor list (rhr_delta_prior_day
// per multicollinearity-with-HRV; respiratory_rate_anomaly_prior_day per
// rare-event low statistical power) are documented as a doc-comment block in
// candidates.ts; that prose is not asserted here — the deep-equal against
// CANDIDATE_FACTORS_TYPE_ONLY is the type-level forcing function.

import { describe, expect, it } from 'vitest';
import { CANDIDATE_FACTORS, CANDIDATE_FACTORS_SET } from './candidates.js';
import { CANDIDATE_FACTORS_TYPE_ONLY } from './types.js';

describe('CANDIDATE_FACTORS (D-11 lock)', () => {
  it('has exactly 5 entries (D-11 5-tuple lock)', () => {
    expect(CANDIDATE_FACTORS.length).toBe(5);
  });

  it('deep-equals CANDIDATE_FACTORS_TYPE_ONLY from Wave 0 Plan 04-02 (textual sync)', () => {
    expect(CANDIDATE_FACTORS).toEqual(CANDIDATE_FACTORS_TYPE_ONLY);
  });

  it('exposes a frozen runtime Set with 5 entries (Shared Pattern 2)', () => {
    expect(CANDIDATE_FACTORS_SET.size).toBe(5);
    for (const factor of CANDIDATE_FACTORS) {
      expect(CANDIDATE_FACTORS_SET.has(factor)).toBe(true);
    }
  });
});
