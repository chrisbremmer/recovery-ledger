import { describe, expect, it } from 'vitest';

import {
  CANDIDATE_FACTORS_TYPE_ONLY,
  type CandidateName,
  type CandidateResult,
  type WeeklyPattern,
  type WorstDay,
} from './types.js';

// Task 2 (Plan 04-02) — WeeklyPattern 2-arm discriminated union (D-16) +
// the D-34 ADDITIVE `pattern_confidence` field on the `detected` arm +
// the 5-candidate `CANDIDATE_FACTORS_TYPE_ONLY` tuple (D-11). The
// runtime `CANDIDATE_FACTORS` module-load constant ships in Plan 04-05
// `candidates.ts` and asserts deep-equal against this type-anchor.

function describeWeeklyPattern(p: WeeklyPattern): string {
  switch (p.kind) {
    case 'detected':
      return `detected:${p.factor}:${p.direction}:${p.pattern_confidence}`;
    case 'no_pattern':
      switch (p.reason) {
        case 'insufficient_window_days':
          return 'no_pattern:insufficient_window_days';
        case 'no_factor_cleared_fdr':
          return 'no_pattern:no_factor_cleared_fdr';
        case 'all_candidates_refused':
          return 'no_pattern:all_candidates_refused';
      }
  }
}

describe('CANDIDATE_FACTORS_TYPE_ONLY (D-11)', () => {
  it('is a 5-tuple of the locked candidate factor names', () => {
    // D-11 names verbatim. The 2 dropped candidates (rhr_delta_prior_day,
    // respiratory_rate_anomaly_prior_day) live as code comments in Plan
    // 04-05 candidates.ts; this type-anchor only enumerates the 5 in scope.
    expect(CANDIDATE_FACTORS_TYPE_ONLY).toEqual([
      'sleep_duration_prior_night',
      'sleep_debt_3d_rolling',
      'day_strain_prior_day',
      'workout_timing_late_evening',
      'hrv_delta_prior_day',
    ]);
    expect(CANDIDATE_FACTORS_TYPE_ONLY).toHaveLength(5);
  });
});

describe('WeeklyPattern (D-16 + D-34)', () => {
  it('narrows the detected arm with factor + statistic + direction + pattern_confidence', () => {
    const p: WeeklyPattern = {
      kind: 'detected',
      factor: 'sleep_duration_prior_night',
      statistic: { U: 28.5, p_raw: 0.003, p_adjusted: 0.015 },
      direction: 'worst_days_had_lower',
      pattern_confidence: 'strong',
    };
    expect(describeWeeklyPattern(p)).toBe(
      'detected:sleep_duration_prior_night:worst_days_had_lower:strong',
    );
  });

  it('detected arm carries pattern_confidence weak when 14 <= N < 20', () => {
    const p: WeeklyPattern = {
      kind: 'detected',
      factor: 'hrv_delta_prior_day',
      statistic: { U: 12, p_raw: 0.04, p_adjusted: 0.08 },
      direction: 'worst_days_had_higher',
      pattern_confidence: 'weak',
    };
    expect(p.kind === 'detected' && p.pattern_confidence).toBe('weak');
  });

  it('narrows the no_pattern/insufficient_window_days arm', () => {
    const p: WeeklyPattern = { kind: 'no_pattern', reason: 'insufficient_window_days' };
    expect(describeWeeklyPattern(p)).toBe('no_pattern:insufficient_window_days');
  });

  it('narrows the no_pattern/no_factor_cleared_fdr arm', () => {
    const p: WeeklyPattern = { kind: 'no_pattern', reason: 'no_factor_cleared_fdr' };
    expect(describeWeeklyPattern(p)).toBe('no_pattern:no_factor_cleared_fdr');
  });

  it('narrows the no_pattern/all_candidates_refused arm', () => {
    const p: WeeklyPattern = { kind: 'no_pattern', reason: 'all_candidates_refused' };
    expect(describeWeeklyPattern(p)).toBe('no_pattern:all_candidates_refused');
  });
});

describe('CandidateResult (ADR-0004 §If FDR set empty)', () => {
  it('carries factor + p_raw + p_adjusted + cleared + refused with optional refusal_reason', () => {
    const cleared: CandidateResult = {
      factor: 'sleep_duration_prior_night',
      p_raw: 0.003,
      p_adjusted: 0.015,
      cleared: true,
      refused: false,
    };
    const notCleared: CandidateResult = {
      factor: 'day_strain_prior_day',
      p_raw: 0.45,
      p_adjusted: 0.6,
      cleared: false,
      refused: false,
    };
    const refused: CandidateResult = {
      factor: 'workout_timing_late_evening',
      p_raw: Number.NaN,
      p_adjusted: Number.NaN,
      cleared: false,
      refused: true,
      refusal_reason: 'sample_too_small',
    };
    expect(cleared.cleared).toBe(true);
    expect(notCleared.cleared).toBe(false);
    expect(refused.refused).toBe(true);
    expect(refused.refusal_reason).toBe('sample_too_small');
  });
});

describe('WorstDay shape', () => {
  it('carries date + recovery_score', () => {
    const w: WorstDay = { date: '2026-05-03', recovery_score: 32 };
    expect(w.date).toBe('2026-05-03');
    expect(w.recovery_score).toBe(32);
  });
});

describe('CandidateName narrowing', () => {
  it('narrows to the 5 D-11 candidate literals', () => {
    // Same forcing-function pattern as MetricName in Task 1 — cast through
    // CandidateName so TS doesn't narrow the tuple literal.
    const name = CANDIDATE_FACTORS_TYPE_ONLY[0] as CandidateName;
    let touched = false;
    switch (name) {
      case 'sleep_duration_prior_night':
      case 'sleep_debt_3d_rolling':
      case 'day_strain_prior_day':
      case 'workout_timing_late_evening':
      case 'hrv_delta_prior_day':
        touched = true;
        break;
    }
    expect(touched).toBe(true);
  });
});
