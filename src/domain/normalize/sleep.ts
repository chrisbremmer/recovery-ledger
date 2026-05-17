// Sleep normalizer — pure function (D-28 + Pattern C3).
//
// Raw snake_case Zod-parsed `WhoopRawSleep` → camelCase `Sleep` domain
// entity. Sleeps have their own `start` + `end` + `timezone_offset` per
// the verified WHOOP v2 sleep doc, BUT per D-14 the DST/tz exclusion flag
// lives ONLY on cycles. Sleeps inherit exclusion via the cycle FK at
// query time, so this normalizer does NOT call `detectExclusion`.
//
// Score discipline (D-03 + ADR-0003) — the SCORED variant nests
// `total_in_bed_time_milli` and `total_awake_time_milli` under
// `score.stage_summary` per the WHOOP v2 wire shape (verified in
// 03-RESEARCH.md item 4); `respiratory_rate`, `sleep_*_percentage` live
// directly under `score`. Pitfall 3 defense: per-score-state branch
// coverage in sleep.test.ts asserts PENDING_SCORE / UNSCORABLE never
// silently appear with score fields populated.

import type { z } from 'zod';
import type { WhoopRawSleep } from '../schemas/whoop-api.js';
import type { Sleep } from '../types/entities.js';

export function normalizeSleep(raw: z.infer<typeof WhoopRawSleep>): Sleep {
  const base = {
    id: raw.id,
    userId: raw.user_id,
    createdAt: raw.created_at,
    updatedAt: raw.updated_at,
    start: raw.start,
    end: raw.end,
    timezoneOffset: raw.timezone_offset,
  };

  switch (raw.score_state) {
    case 'SCORED':
      return {
        ...base,
        scoreState: 'SCORED',
        totalInBedTimeMilli: raw.score.stage_summary.total_in_bed_time_milli,
        totalAwakeTimeMilli: raw.score.stage_summary.total_awake_time_milli,
        sleepPerformancePercentage: raw.score.sleep_performance_percentage,
        sleepConsistencyPercentage: raw.score.sleep_consistency_percentage,
        sleepEfficiencyPercentage: raw.score.sleep_efficiency_percentage,
        respiratoryRate: raw.score.respiratory_rate,
      };
    case 'PENDING_SCORE':
      return { ...base, scoreState: 'PENDING_SCORE' };
    case 'UNSCORABLE':
      return { ...base, scoreState: 'UNSCORABLE' };
  }
}
