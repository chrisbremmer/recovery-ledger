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
 * WHOOP v2 documented max page size (A3 + D-19). Pinned here so every
 * per-resource module (cycles, recoveries, sleeps, workouts) imports the
 * same constant instead of duplicating the literal.
 */
export const PAGE_SIZE = 25;

/**
 * Safety caps for `paginateAll`. A malformed `next_token` chain
 * or `--since 1900-01-01` will otherwise accumulate the entire history into
 * a single in-memory array + Set. At PAGE_SIZE=25, 1000 pages == 25_000 rows
 * (~10y of cycles), which is well past the personal-tool envelope. The row
 * cap is a parallel ceiling that also catches a degenerate "every page is
 * full" run that races the page cap.
 */
export const DEFAULT_MAX_PAGES = 1000;
export const DEFAULT_MAX_ROWS = 50_000;

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
  options?: { maxPages?: number; maxRows?: number },
): Promise<T[]> {
  const maxPages = options?.maxPages ?? DEFAULT_MAX_PAGES;
  const maxRows = options?.maxRows ?? DEFAULT_MAX_ROWS;
  const resolveKey = keyFn ?? ((row: T) => String((row as { id?: unknown }).id));
  const all: T[] = [];
  const seenKeys = new Set<string>();
  const seenTokens = new Set<string>();
  let nextToken: string | null = null;
  let pages = 0;
  do {
    const page = await fetchPage(nextToken);
    pages += 1;
    for (const row of page.records) {
      const key = resolveKey(row);
      if (seenKeys.has(key)) {
        throw new WhoopApiError({
          kind: 'validation',
          detail: `duplicate record key ${key} (signals mid-pagination reordering or within-page dup)`,
        });
      }
      seenKeys.add(key);
      all.push(row);
      if (all.length > maxRows) {
        throw new WhoopApiError({
          kind: 'validation',
          detail: `pagination exceeded ${maxRows} rows (safety cap; check --since range)`,
        });
      }
    }
    // Normalize empty-string next_token to null (treat as end-of-stream).
    // WHOOP's documented sentinel is `null`, but an empty string is a
    // plausible defensive alternative — treating it as end-of-stream avoids
    // one extra fetch round-trip before cycle detection would catch it.
    nextToken = page.next_token === '' ? null : page.next_token;
    // Defense-in-depth: detect a next_token cycle (WHOOP returning the same
    // token twice would otherwise loop forever). Throw loudly so the failure
    // is visible rather than an infinite-pagination hang.
    if (nextToken !== null) {
      if (seenTokens.has(nextToken)) {
        throw new WhoopApiError({
          kind: 'validation',
          detail: `next_token cycle detected (token "${nextToken}" repeated)`,
        });
      }
      seenTokens.add(nextToken);
    }
    if (pages >= maxPages && nextToken !== null) {
      throw new WhoopApiError({
        kind: 'validation',
        detail: `pagination exceeded ${maxPages} pages (safety cap; check --since range or for malformed next_token chain)`,
      });
    }
  } while (nextToken !== null);
  return all;
}
