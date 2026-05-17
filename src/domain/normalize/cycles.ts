// Cycle normalizer — pure function (D-28 + Pattern C3).
//
// Raw snake_case Zod-parsed `WhoopRawCycle` → camelCase `Cycle` domain
// entity. The boundary where the wire format becomes domain shape, and
// where the DST/tz exclusion flag (D-14) gets computed via the pure
// `detectExclusion` function (Plan 03-09 dst-tz/detect.ts).
//
// Score discipline (D-03 + ADR-0003 LOAD-BEARING): switches exhaustively
// on `raw.score_state` so reading `.strain` off a `Cycle` union without
// first narrowing on `scoreState === 'SCORED'` is a compile error.
//
// Purity: no I/O, no logger, no DB. The `raw` input is already
// Zod-validated by `httpGet` (Plan 03-06); the function trusts the types.
// The `priorTimezoneOffset` is fed in by the resource module (Plan 03-09
// resources/cycles.ts) which walks the page in start-ascending order so
// tz_drift detection sees the correct prior cycle.

import type { z } from 'zod';
import { detectExclusion } from '../dst-tz/detect.js';
import type { WhoopRawCycle } from '../schemas/whoop-api.js';
import type { Cycle } from '../types/entities.js';

export interface NormalizeCycleOpts {
  /** IANA zone resolved once at sync-start (D-13). */
  ianaZone: string;
  /**
   * Timezone offset of the chronologically-prior cycle, used by
   * `detectExclusion`'s Rule 2 (tz_drift). `null` when this is the first
   * cycle being processed (no prior to compare against).
   */
  priorTimezoneOffset: string | null;
}

export function normalizeCycle(
  raw: z.infer<typeof WhoopRawCycle>,
  opts: NormalizeCycleOpts,
): Cycle {
  const exclusion = detectExclusion({
    ianaZone: opts.ianaZone,
    cycle: { start: raw.start, end: raw.end, timezone_offset: raw.timezone_offset },
    priorCycle:
      opts.priorTimezoneOffset !== null ? { timezone_offset: opts.priorTimezoneOffset } : null,
  });

  const base = {
    id: raw.id,
    userId: raw.user_id,
    createdAt: raw.created_at,
    updatedAt: raw.updated_at,
    start: raw.start,
    end: raw.end,
    timezoneOffset: raw.timezone_offset,
    baselineExcluded: exclusion.baseline_excluded,
    exclusionReason: exclusion.exclusion_reason,
  };

  switch (raw.score_state) {
    case 'SCORED':
      return {
        ...base,
        scoreState: 'SCORED',
        strain: raw.score.strain,
        kilojoule: raw.score.kilojoule,
        averageHeartRate: raw.score.average_heart_rate,
        maxHeartRate: raw.score.max_heart_rate,
      };
    case 'PENDING_SCORE':
      return { ...base, scoreState: 'PENDING_SCORE' };
    case 'UNSCORABLE':
      return { ...base, scoreState: 'UNSCORABLE' };
  }
}
