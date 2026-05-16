// Profile resource module — single-shot per A4 (no pagination, no
// since/until). D-17 + D-18 + ADR-0007. Endpoint path
// `/v2/user/profile/basic` verified against the WHOOP v2 docs + the
// Plan 03-07 MSW helper's PROFILE_URL constant.
//
// `WhoopRawProfile` is a single-record Zod schema (NOT a page wrapper)
// per Plan 03-03 + the verified WHOOP v2 user-profile-basic shape.

import { normalizeProfile } from '../../../domain/normalize/profile.js';
import { WhoopRawProfile } from '../../../domain/schemas/whoop-api.js';
import type { Profile } from '../../../domain/types/entities.js';
import { httpGet } from '../client.js';

export async function getProfile(): Promise<Profile> {
  const raw = await httpGet('/v2/user/profile/basic', {}, WhoopRawProfile);
  return normalizeProfile(raw, { clock: new Date() });
}
