// confidenceFromCounts — D-13 tier-gating function + D-10 'insufficient'
// tier emission. Pure function: no I/O, no clock, no logger. Consumes the
// SCORED-only day count (ADR-0003 §Confidence-tier rules — "apply to the
// SCORED count, not the row count") and emits the typed positive output
// `ConfidenceGate` shape from Wave 0 (confidence/types.ts).
//
// Tier thresholds (D-13 + RESEARCH §3, locked):
//   - insufficient : scoredDays < 10                       → minRequired = 10
//   - strong       : scoredDays >= 20 AND coveragePct >= 70 → minRequired = 20
//   - weak         : otherwise                              → minRequired = 10
//
// D-10 anchor: the 'insufficient' tier is the trigger for ADR-0004's
// typed positive output — the daily review STILL renders, but with
// actions = [] and anomalies = [] and a populated insufficient_reason
// at the SERVICE layer (Plan 04-07). This domain function emits the
// tier; the service wraps it with the user-facing reason text.
//
// REV-02 + REV-05: this is the single chokepoint for the confidence
// tier; downstream consumers (Plan 04-07 services/review/daily.ts +
// Plan 04-09 formatters/) read the tier verbatim.

import type { ConfidenceGate } from './types.js';

export function confidenceFromCounts(opts: {
  scoredDays: number;
  windowDays: number;
}): ConfidenceGate {
  const coveragePct = (opts.scoredDays / opts.windowDays) * 100;

  if (opts.scoredDays < 10) {
    return {
      tier: 'insufficient',
      coveragePct,
      minRequired: 10,
      sampleSize: opts.scoredDays,
    };
  }

  if (opts.scoredDays >= 20 && coveragePct >= 70) {
    return {
      tier: 'strong',
      coveragePct,
      minRequired: 20,
      sampleSize: opts.scoredDays,
    };
  }

  return {
    tier: 'weak',
    coveragePct,
    minRequired: 10,
    sampleSize: opts.scoredDays,
  };
}
