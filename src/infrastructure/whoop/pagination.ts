// WHOOP pagination utility (D-19 + 03-PATTERNS.md §B2 + 03-RESEARCH.md
// Pattern 7 + PITFALLS.md Pitfall 10 + 03-CONTEXT.md A12 compound-key
// support).
//
// WHOOP v2 pagination has two asymmetric peculiarities the wrapper
// owns in one place:
//   1. The response field is `next_token` (snake), but the request
//      parameter is `nextToken` (camel). Each per-resource module
//      passes the `nextToken` query param through `httpGet`; the page
//      schemas (`src/domain/schemas/whoop-api.ts`) keep the wire-shape
//      `next_token`. The snake↔camel translation is therefore implicit
//      here — callers see `nextToken: string | null` on the inbound
//      callback and `page.next_token` on the outbound page.
//   2. Ordering across pages is NOT guaranteed by WHOOP. A mid-paginate
//      reordering (rare but observed in beta) can return the same
//      record on two consecutive pages, which would silently re-upsert
//      and clobber state. The dup-key Set asserts no duplicate keys
//      across pages and throws a loud `WhoopApiError({kind:
//      'validation'})` on collision — surfaces re-ordering rather than
//      silently absorbing it.
//
// Compound-key resources (recoveries — keyed by cycle_id + sleep_id;
// 03-CONTEXT.md A12) carry no scalar `id` field on the wire, so the
// default `String((row as any).id)` would resolve to the literal
// `"undefined"` on every row and the second row would always throw.
// The optional `keyFn` parameter exists for this case: the recovery
// resource module (Plan 03-09) will pass
// `(row) => row.cycle_id + ':' + row.sleep_id`. Default keyFn covers
// cycles (int64 id → stringified), sleeps (UUID id), and workouts
// (UUID id).
//
// Layer 1 of the three-layer type system (conventions.md): no I/O, no
// logger, no infrastructure imports beyond the sibling error union.

import { WhoopApiError } from './errors.js';

/**
 * Wire-shape page returned by every paginated WHOOP v2 list endpoint.
 * `next_token` is snake_case verbatim — the request-side
 * `nextToken` camel translation lives in the resource module that
 * calls `httpGet`. End of pagination is signalled by `next_token` being
 * JSON null.
 */
export interface WhoopPage<T> {
  records: T[];
  next_token: string | null;
}

/**
 * Aggregate every page from a paginated WHOOP endpoint, asserting no
 * duplicate keys across consecutive pages. The optional `keyFn` lets
 * compound-key resources (recoveries, keyed by `cycle_id + sleep_id`)
 * provide a deterministic dedup key.
 *
 * Default: `keyFn = (row) => String((row as { id?: unknown }).id)` — works
 * for cycles (int64 id → stringified), sleeps (UUID id), workouts (UUID
 * id), and any future single-scalar-id resource. Callers MUST pass an
 * explicit `keyFn` when the row has no scalar `id` field (compound-PK
 * resources). Otherwise every row collides on `String(undefined)`.
 *
 * Recovery resource module (Plan 03-09) passes:
 *   paginateAll(fetcher, (row) => row.cycle_id + ':' + row.sleep_id)
 *
 * On duplicate key detection, throws
 * `WhoopApiError({kind: 'validation'})` with a detail that includes the
 * colliding key — signals mid-paginate reordering loudly rather than
 * absorbing it as a silent overwrite.
 */
export async function paginateAll<T>(
  fetchPage: (nextToken: string | null) => Promise<WhoopPage<T>>,
  keyFn?: (row: T) => string,
): Promise<T[]> {
  const resolveKey = keyFn ?? ((row: T) => String((row as { id?: unknown }).id));
  const all: T[] = [];
  const seenKeys = new Set<string>();
  let nextToken: string | null = null;
  do {
    const page = await fetchPage(nextToken);
    for (const row of page.records) {
      const key = resolveKey(row);
      if (seenKeys.has(key)) {
        throw new WhoopApiError({
          kind: 'validation',
          detail: `duplicate key ${key} across consecutive pages (signals mid-pagination reordering)`,
        });
      }
      seenKeys.add(key);
      all.push(row);
    }
    nextToken = page.next_token;
  } while (nextToken !== null);
  return all;
}
