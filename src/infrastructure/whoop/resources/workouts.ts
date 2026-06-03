// Workouts resource module — D-17 + D-18 + D-19. Workouts have UUID-string
// `id` per A6, so paginateAll's default keyFn is correct — no explicit
// keyFn passed. Workouts inherit DST/tz exclusion via cycle_id at query
// time (D-14), so this module does NOT compute exclusion here.
//
// Phase 10 ARCH-03: factory shape — `createListWorkouts({authedCall})`
// captures the orchestrator's callWithAuth via closure.
//
// Endpoint path `/v2/activity/workout` verified against the WHOOP v2 docs
// + the Plan 03-07 MSW helper's WORKOUTS_URL constant.

import type { z } from 'zod';
import { normalizeWorkout } from '../../../domain/normalize/workouts.js';
import {
  type WhoopRawWorkout,
  WhoopWorkoutsPageSchema,
} from '../../../domain/schemas/whoop-api.js';
import type { Workout } from '../../../domain/types/entities.js';
import { type AuthedCall, httpGet } from '../client.js';
import { PAGE_SIZE, paginateAll } from '../pagination.js';

export interface ListWorkoutsDeps {
  authedCall: AuthedCall;
}

export interface ListWorkoutsOpts {
  since: string;
  until: string;
}

export interface ListWorkoutsResult {
  /** Normalized workout entities. */
  entities: Workout[];
  /**
   * Raw WHOOP wire-format records, aligned by index to `entities` — the
   * sync orchestrator passes `JSON.stringify(rawRecords[i])` through to
   * the repo as `rawJson`, so D-29's reparse path stays alive.
   */
  rawRecords: z.infer<typeof WhoopRawWorkout>[];
}

export function createListWorkouts(deps: ListWorkoutsDeps) {
  return async function listWorkouts(opts: ListWorkoutsOpts): Promise<ListWorkoutsResult> {
    const rawRecords = await paginateAll<z.infer<typeof WhoopRawWorkout>>(async (nextToken) =>
      httpGet(
        '/v2/activity/workout',
        {
          start: opts.since,
          end: opts.until,
          limit: PAGE_SIZE,
          nextToken: nextToken ?? undefined,
        },
        WhoopWorkoutsPageSchema,
        deps.authedCall,
      ),
    );

    return { entities: rawRecords.map(normalizeWorkout), rawRecords };
  };
}
