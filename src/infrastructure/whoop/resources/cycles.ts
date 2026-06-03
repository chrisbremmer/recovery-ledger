// Cycles resource module — consumes Plan 03-06's httpGet + paginateAll +
// Plan 03-09's normalizeCycle. D-17 (per-resource module shape), D-18
// (authedCall wraps inside httpGet exactly once — this module never
// references the orchestrator directly), D-19 (PAGE_SIZE = 25 pinned per A3
// verified WHOOP doc), ADR-0007 (GET-only, no httpPost helper exists).
//
// Phase 10 ARCH-03: this module exports a factory `createListCycles` that
// captures `authedCall` via closure. Bootstrap wires the production
// `authedCall`; tests construct an inline `(op) => op('test-token-...')`.
// The httpGet 4th parameter is the same `authedCall` for every call.
//
// Pagination ordering note: WHOOP does not guarantee cycle ordering across
// pages, so this module sorts the aggregated records by `start` ascending
// BEFORE calling normalizeCycle. Cycle normalization's tz_drift detection
// (D-13 Rule 2) needs the prior cycle's `timezone_offset` to compare
// against — walking in start-ascending order with a rolling priorOffset
// gives correct detection within a single sync's page set. The sync
// orchestrator (Plan 03-11) seeds `priorTimezoneOffset` from the latest
// pre-existing cycle in the DB so the rolling chain continues across syncs.
//
// Endpoint path `/v2/cycle` verified against the WHOOP v2 API docs and
// against the Plan 03-07 MSW helper's CYCLES_URL constant.

import type { z } from 'zod';
import { normalizeCycle } from '../../../domain/normalize/cycles.js';
import { WhoopCyclesPageSchema, type WhoopRawCycle } from '../../../domain/schemas/whoop-api.js';
import type { Cycle } from '../../../domain/types/entities.js';
import { type AuthedCall, httpGet } from '../client.js';
import { PAGE_SIZE, paginateAll } from '../pagination.js';

export interface ListCyclesDeps {
  authedCall: AuthedCall;
}

export interface ListCyclesOpts {
  /** ISO-8601 inclusive lower bound (cycle.start ≥ since). */
  since: string;
  /** ISO-8601 inclusive upper bound (cycle.start ≤ until). */
  until: string;
  /** IANA zone resolved once at sync-start (D-13). */
  ianaZone: string;
  /**
   * Timezone offset of the chronologically-prior cycle persisted in the DB
   * (seeded by the orchestrator from MAX(start) of the existing cycles
   * table). `null` when this is the first sync.
   */
  priorTimezoneOffset: string | null;
}

export interface ListCyclesResult {
  /** Normalized cycle entities in start-ascending order. */
  entities: Cycle[];
  /**
   * Raw WHOOP wire-format records, aligned by index to `entities` — the
   * sync orchestrator passes `JSON.stringify(rawRecords[i])` through to
   * the repo as `rawJson`, so D-29's reparse path stays alive.
   */
  rawRecords: z.infer<typeof WhoopRawCycle>[];
}

export function createListCycles(deps: ListCyclesDeps) {
  return async function listCycles(opts: ListCyclesOpts): Promise<ListCyclesResult> {
    const rawRecords = await paginateAll<z.infer<typeof WhoopRawCycle>>(async (nextToken) =>
      httpGet(
        '/v2/cycle',
        {
          start: opts.since,
          end: opts.until,
          limit: PAGE_SIZE,
          nextToken: nextToken ?? undefined,
        },
        WhoopCyclesPageSchema,
        deps.authedCall,
      ),
    );

    // Sort start-ascending so the rolling priorOffset walk below sees the
    // chronologically-prior cycle on each iteration.
    const sorted = [...rawRecords].sort((a, b) => a.start.localeCompare(b.start));

    const entities: Cycle[] = [];
    let priorOffset = opts.priorTimezoneOffset;
    for (const raw of sorted) {
      entities.push(
        normalizeCycle(raw, { ianaZone: opts.ianaZone, priorTimezoneOffset: priorOffset }),
      );
      priorOffset = raw.timezone_offset;
    }
    return { entities, rawRecords: sorted };
  };
}
