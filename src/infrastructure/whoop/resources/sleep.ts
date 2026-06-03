// Sleep resource module — D-17 + D-18 + D-19. Sleeps have UUID-string `id`
// per A6, so paginateAll's default keyFn (`String(row.id)`) is correct —
// no explicit keyFn passed. Sleeps inherit DST/tz exclusion via cycle_id
// at query time (D-14), so this module does NOT compute exclusion here.
//
// Phase 10 ARCH-03: factory shape — `createListSleep({authedCall})`
// captures the orchestrator's callWithAuth via closure.
//
// Endpoint path `/v2/activity/sleep` verified against the WHOOP v2 docs +
// the Plan 03-07 MSW helper's SLEEP_URL constant.

import type { z } from 'zod';
import { normalizeSleep } from '../../../domain/normalize/sleep.js';
import { type WhoopRawSleep, WhoopSleepPageSchema } from '../../../domain/schemas/whoop-api.js';
import type { Sleep } from '../../../domain/types/entities.js';
import { type AuthedCall, httpGet } from '../client.js';
import { PAGE_SIZE, paginateAll } from '../pagination.js';

export interface ListSleepDeps {
  authedCall: AuthedCall;
}

export interface ListSleepOpts {
  since: string;
  until: string;
}

export interface ListSleepResult {
  /** Normalized sleep entities. */
  entities: Sleep[];
  /**
   * Raw WHOOP wire-format records, aligned by index to `entities` — the
   * sync orchestrator passes `JSON.stringify(rawRecords[i])` through to
   * the repo as `rawJson`, so D-29's reparse path stays alive.
   */
  rawRecords: z.infer<typeof WhoopRawSleep>[];
}

export function createListSleep(deps: ListSleepDeps) {
  return async function listSleep(opts: ListSleepOpts): Promise<ListSleepResult> {
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
        deps.authedCall,
      ),
    );

    return { entities: rawRecords.map(normalizeSleep), rawRecords };
  };
}
