// DST / tz-drift exclusion detector — pure function (D-13 + D-14 + Pattern 5).
//
// A cycle that straddles a DST boundary or follows a timezone shift is
// `baseline_excluded` because its day-strain / sleep-duration / recovery
// metrics are skewed by the clock change rather than by physiology. Phase 4
// baseline queries default-filter on `baseline_excluded = 0` per D-16; this
// detector is the source of truth for setting that flag.
//
// Two rules OR'd (D-13). Rule 1 takes precedence over Rule 2 when both fire
// (a DST-straddling cycle that also follows a timezone change reports
// `dst_straddle` — the DST rule is checked first per the verbatim Pattern 5
// skeleton in 03-RESEARCH.md lines 540-558).
//
//   Rule 1 — dst_straddle:
//     The cycle's tz-offset at `start` differs from its tz-offset at `end`,
//     resolved against the user's IANA zone via `@date-fns/tz`. If `end` is
//     `null` (cycle still in progress), the rule is skipped — there is no
//     second timestamp to compare against. Detects March spring-forward and
//     November fall-back boundaries.
//
//   Rule 2 — tz_drift:
//     The cycle's wire-format `timezone_offset` differs from the prior
//     cycle's. Detects travel between zones (e.g., SFO → JFK puts the next
//     cycle's offset at `-05:00` after the prior cycle's `-08:00`).
//
// PITFALL I — re-flag on retroactive WHOOP updates: WHOOP retroactively
// shifts cycle.start / cycle.end "for a few days as it learns more." The
// caller (Plan 03-11 sync orchestrator) re-runs `detectExclusion` at every
// upsert so a previously-not-flagged cycle that shifts past a DST boundary
// gets flagged on the spot. This function does NOT cache.
//
// Purity: no I/O, no logger, no module-level state. The IANA zone is
// passed in (resolved once at sync-start via
// `Intl.DateTimeFormat().resolvedOptions().timeZone`) rather than read here,
// keeping the function deterministic for unit testing.
//
// @date-fns/tz `tzOffset` returns minutes. Spring-forward in Los Angeles
// goes -480 → -420; fall-back goes -420 → -480. Numeric `!==` comparison
// correctly distinguishes them.

import { tzOffset } from '@date-fns/tz';

/**
 * Input shape for `detectExclusion`. `cycle` is the wire-format cycle being
 * upserted (snake_case `timezone_offset` to match the WHOOP payload + the
 * SQL column). `priorCycle` is the prior chronological cycle's offset (only
 * the offset is needed for Rule 2); `null` when no prior cycle exists.
 */
export interface DstDetectInput {
  ianaZone: string;
  cycle: { start: string; end: string | null; timezone_offset: string };
  priorCycle: { timezone_offset: string } | null;
}

/**
 * Output shape mirroring the two SQL columns added in Plan 03-02 schema:
 * `baseline_excluded INTEGER NOT NULL DEFAULT 0` and `exclusion_reason TEXT`.
 * Snake_case keys for direct alignment with the column names; the cycles
 * normalizer maps these into the camelCase `baselineExcluded` /
 * `exclusionReason` entity fields.
 */
export interface DstDetectOutput {
  baseline_excluded: boolean;
  exclusion_reason: 'dst_straddle' | 'tz_drift' | null;
}

export function detectExclusion(input: DstDetectInput): DstDetectOutput {
  // Rule 1 — dst_straddle. Skipped when `end` is null (in-progress cycle).
  // Review #26: a malformed cycle.start / cycle.end string would yield
  // NaN tz-offsets and `NaN !== NaN === true`, silently flagging the cycle
  // as dst_straddle. Guard with an ISO format check and bail to non-excluded
  // rather than mis-flagging; the caller can choose to surface the bad row
  // (the sync orchestrator already logs schema-validation failures upstream).
  if (input.cycle.end !== null) {
    if (!isParsableIsoDate(input.cycle.start) || !isParsableIsoDate(input.cycle.end)) {
      return { baseline_excluded: false, exclusion_reason: null };
    }
    const startOffset = tzOffset(input.ianaZone, new Date(input.cycle.start));
    const endOffset = tzOffset(input.ianaZone, new Date(input.cycle.end));
    if (startOffset !== endOffset) {
      return { baseline_excluded: true, exclusion_reason: 'dst_straddle' };
    }
  }

  // Rule 2 — tz_drift. Skipped when there is no prior cycle to compare against.
  if (
    input.priorCycle !== null &&
    input.cycle.timezone_offset !== input.priorCycle.timezone_offset
  ) {
    return { baseline_excluded: true, exclusion_reason: 'tz_drift' };
  }

  return { baseline_excluded: false, exclusion_reason: null };
}

// Defensive ISO format check (Review #26). Accepts the WHOOP wire format
// (`YYYY-MM-DDTHH:MM:SS.sssZ` and the `+HH:MM` offset variant) and rejects
// anything else. Malformed strings produce NaN at `new Date(...)`, which
// silently passes the `!==` comparison above.
function isParsableIsoDate(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(s)) return false;
  const t = Date.parse(s);
  return !Number.isNaN(t);
}
