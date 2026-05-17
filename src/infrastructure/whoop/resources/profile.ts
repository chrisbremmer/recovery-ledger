// Profile resource module — single-shot per A4 (no pagination, no
// since/until). D-17 + D-18 + ADR-0007. Endpoint path
// `/v2/user/profile/basic` verified against the WHOOP v2 docs + the
// Plan 03-07 MSW helper's PROFILE_URL constant.
//
// `WhoopRawProfile` is a single-record Zod schema (NOT a page wrapper)
// per Plan 03-03 + the verified WHOOP v2 user-profile-basic shape.
//
// Returns BOTH the raw wire payload AND the normalized entity so the sync
// orchestrator can persist `JSON.stringify(raw)` (snake_case) as the
// `raw_json` column rather than stringifying the camelCase entity. This
// preserves the D-29 diagnostic seam — replaying `raw_json` through
// `WhoopRawProfile.parse()` must succeed.

import type { z } from 'zod';
import { normalizeProfile } from '../../../domain/normalize/profile.js';
import { WhoopRawProfile } from '../../../domain/schemas/whoop-api.js';
import type { Profile } from '../../../domain/types/entities.js';
import { httpGet } from '../client.js';

export interface GetProfileResult {
  raw: z.infer<typeof WhoopRawProfile>;
  entity: Profile;
}

export async function getProfile(): Promise<GetProfileResult> {
  const raw = await httpGet('/v2/user/profile/basic', {}, WhoopRawProfile);
  const entity = normalizeProfile(raw, { clock: new Date() });
  return { raw, entity };
}
