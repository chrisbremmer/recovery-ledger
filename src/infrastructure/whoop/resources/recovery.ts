// Recovery resource module — D-17 (per-resource module shape), D-18 (only
// httpGet from client.ts; never callWithAuth), D-19 (PAGE_SIZE = 25 per
// A3), A12 (compound (cycle_id, sleep_id) PK so paginateAll needs the
// explicit keyFn — Plan 03-06 already shipped the optional keyFn
// parameter for exactly this case), ADR-0007 (GET-only).
//
// Why compound keyFn: recoveries carry NO scalar `id` field on the wire.
// `paginateAll`'s default keyFn does `String((row as { id?: unknown }).id)`
// which collapses to the literal `"undefined"` for every row — the second
// row would always throw `WhoopApiError({kind: 'validation'})` on the
// dup-key Set. Passing `(row) => row.cycle_id + ':' + row.sleep_id`
// resolves the compound primary key and keeps Pitfall 10's load-bearing
// dup-detection working across pages.
//
// No DST concern on the recovery row itself — recoveries inherit
// baseline_excluded via cycle_id at query time (D-14 + Plan 03-08
// recovery.repo.ts JOIN-based exclusion).

import type { z } from 'zod';
import { normalizeRecovery } from '../../../domain/normalize/recovery.js';
import {
  type WhoopRawRecovery,
  WhoopRecoveryPageSchema,
} from '../../../domain/schemas/whoop-api.js';
import type { Recovery } from '../../../domain/types/entities.js';
import { httpGet } from '../client.js';
import { PAGE_SIZE, paginateAll } from '../pagination.js';

export interface ListRecoveryOpts {
  since: string;
  until: string;
}

/**
 * Parallel-array result so the orchestrator can attach the corresponding
 * raw WHOOP JSON to each upsert (D-29 diagnostic seam — Issue #12). `raw`
 * and `entities` are index-aligned.
 */
export interface ListRecoveryResult {
  raw: z.infer<typeof WhoopRawRecovery>[];
  entities: Recovery[];
}

export async function listRecovery(opts: ListRecoveryOpts): Promise<ListRecoveryResult> {
  const rawRecords = await paginateAll<z.infer<typeof WhoopRawRecovery>>(
    async (nextToken) =>
      httpGet(
        '/v2/recovery',
        {
          start: opts.since,
          end: opts.until,
          limit: PAGE_SIZE,
          nextToken: nextToken ?? undefined,
        },
        WhoopRecoveryPageSchema,
      ),
    // Compound-key dedup per A12 + Plan 03-06 paginateAll keyFn parameter.
    (row) => row.cycle_id + ':' + row.sleep_id,
  );

  return { raw: rawRecords, entities: rawRecords.map(normalizeRecovery) };
}
