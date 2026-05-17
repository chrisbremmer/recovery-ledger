// Recovery normalizer — pure function (D-28 + Pattern C3).
//
// Raw snake_case Zod-parsed `WhoopRawRecovery` → camelCase `Recovery`
// domain entity. Recoveries are keyed by the compound (cycle_id, sleep_id)
// per A12; no scalar `id` on the wire.
//
// D-14 + D-16: recoveries inherit `baseline_excluded` via the cycle_id FK
// at query time (JOIN-based exclusion in Plan 03-08 recovery.repo.ts). The
// recovery row itself does NOT carry the flag, so this normalizer does
// NOT call `detectExclusion`. Signature is `normalizeRecovery(raw)` with
// no `opts` argument.
//
// Score discipline (D-03 + ADR-0003) — SCORED variant carries every score
// field nested under `raw.score`; PENDING_SCORE + UNSCORABLE carry none.
// Purity: no I/O, no logger.

import type { z } from 'zod';
import type { WhoopRawRecovery } from '../schemas/whoop-api.js';
import type { Recovery } from '../types/entities.js';

export function normalizeRecovery(raw: z.infer<typeof WhoopRawRecovery>): Recovery {
  const base = {
    cycleId: raw.cycle_id,
    sleepId: raw.sleep_id,
    userId: raw.user_id,
    createdAt: raw.created_at,
    updatedAt: raw.updated_at,
  };

  switch (raw.score_state) {
    case 'SCORED':
      return {
        ...base,
        scoreState: 'SCORED',
        recoveryScore: raw.score.recovery_score,
        restingHeartRate: raw.score.resting_heart_rate,
        hrvRmssdMilli: raw.score.hrv_rmssd_milli,
        spo2Percentage: raw.score.spo2_percentage,
        skinTempCelsius: raw.score.skin_temp_celsius,
        userCalibrating: raw.score.user_calibrating,
      };
    case 'PENDING_SCORE':
      return { ...base, scoreState: 'PENDING_SCORE' };
    case 'UNSCORABLE':
      return { ...base, scoreState: 'UNSCORABLE' };
  }
}
