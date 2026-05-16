// Sleep resource module — D-17 + D-18 + D-19. Sleeps have UUID-string `id`
// per A6, so paginateAll's default keyFn (`String(row.id)`) is correct —
// no explicit keyFn passed. Sleeps inherit DST/tz exclusion via cycle_id
// at query time (D-14), so this module does NOT compute exclusion here.
//
// Endpoint path `/v2/activity/sleep` verified against the WHOOP v2 docs +
// the Plan 03-07 MSW helper's SLEEP_URL constant.

import type { z } from 'zod';
import { normalizeSleep } from '../../../domain/normalize/sleep.js';
import { type WhoopRawSleep, WhoopSleepPageSchema } from '../../../domain/schemas/whoop-api.js';
import type { Sleep } from '../../../domain/types/entities.js';
import { httpGet } from '../client.js';
import { paginateAll } from '../pagination.js';

const PAGE_SIZE = 25;

export interface ListSleepOpts {
  since: string;
  until: string;
}

export async function listSleep(opts: ListSleepOpts): Promise<Sleep[]> {
  const rawRecords = await paginateAll<z.infer<typeof WhoopRawSleep>>(async (nextToken) =>
    httpGet(
      '/v2/activity/sleep',
      {
        start: opts.since,
        end: opts.until,
        limit: PAGE_SIZE,
        nextToken: nextToken ?? undefined,
      },
      WhoopSleepPageSchema,
    ),
  );

  return rawRecords.map(normalizeSleep);
}
