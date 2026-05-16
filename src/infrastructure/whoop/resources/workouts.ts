// Workouts resource module — D-17 + D-18 + D-19. Workouts have UUID-string
// `id` per A6, so paginateAll's default keyFn is correct — no explicit
// keyFn passed. Workouts inherit DST/tz exclusion via cycle_id at query
// time (D-14), so this module does NOT compute exclusion here.
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
import { httpGet } from '../client.js';
import { paginateAll } from '../pagination.js';

const PAGE_SIZE = 25;

export interface ListWorkoutsOpts {
  since: string;
  until: string;
}

export async function listWorkouts(opts: ListWorkoutsOpts): Promise<Workout[]> {
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
    ),
  );

  return rawRecords.map(normalizeWorkout);
}
