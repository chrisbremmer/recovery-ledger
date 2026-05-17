// Profile normalizer — pure function (D-28 + Pattern C3).
//
// Raw snake_case Zod-parsed `WhoopRawProfile` → camelCase `Profile` domain
// entity. Profile is non-scored (no `score_state` on the wire per the
// verified WHOOP v2 user-profile-basic shape) and has no `updated_at` per
// A4 — the entity's `fetchedAt` field captures the sync-time stamp via an
// injected clock so tests can pin the value deterministically.

import type { z } from 'zod';
import type { WhoopRawProfile } from '../schemas/whoop-api.js';
import type { Profile } from '../types/entities.js';

export interface NormalizeProfileOpts {
  /** Sync-time clock — captured as `fetchedAt` on the entity. */
  clock: Date;
}

export function normalizeProfile(
  raw: z.infer<typeof WhoopRawProfile>,
  opts: NormalizeProfileOpts,
): Profile {
  return {
    userId: raw.user_id,
    email: raw.email,
    firstName: raw.first_name,
    lastName: raw.last_name,
    fetchedAt: opts.clock.toISOString(),
  };
}
