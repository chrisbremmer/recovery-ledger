// Unit coverage for `paginateAll` (D-19 + 03-PATTERNS.md §B2 +
// 03-RESEARCH.md Pattern 7 + PITFALLS.md Pitfall 10 + 03-CONTEXT.md A12
// compound-key support). Tests use synthetic record shapes (no Zod parse
// — that boundary belongs to `httpGet`) so each case is self-contained.

import { describe, expect, test } from 'vitest';
import { WhoopApiError } from './errors.js';
import { paginateAll, type WhoopPage } from './pagination.js';

/** Construct a fake `fetchPage` that returns the given sequence of pages
 *  in order. The first call sees `nextToken === null`; subsequent calls
 *  see the previous page's `next_token`. */
function fetcherFor<T>(
  pages: Array<WhoopPage<T>>,
): (nextToken: string | null) => Promise<WhoopPage<T>> {
  let index = 0;
  return async (_nextToken: string | null) => {
    const page = pages[index];
    if (page === undefined) {
      throw new Error(`fetcherFor: ran out of pages at index ${index}`);
    }
    index += 1;
    return page;
  };
}

describe('paginateAll (default keyFn — String(row.id))', () => {
  test('P-01: single page (next_token=null on first call) returns records as-is', async () => {
    const fetcher = fetcherFor<{ id: number; value: string }>([
      { records: [{ id: 1, value: 'a' }], next_token: null },
    ]);
    const result = await paginateAll(fetcher);
    expect(result).toEqual([{ id: 1, value: 'a' }]);
  });

  test('P-02: two pages (next_token=abc → null) merge records in order', async () => {
    const fetcher = fetcherFor<{ id: number }>([
      { records: [{ id: 1 }, { id: 2 }], next_token: 'abc' },
      { records: [{ id: 3 }], next_token: null },
    ]);
    const result = await paginateAll(fetcher);
    expect(result).toEqual([{ id: 1 }, { id: 2 }, { id: 3 }]);
  });

  test('P-03: three pages with all-unique IDs return sum of records', async () => {
    const fetcher = fetcherFor<{ id: number }>([
      { records: [{ id: 1 }, { id: 2 }], next_token: 't1' },
      { records: [{ id: 3 }, { id: 4 }], next_token: 't2' },
      { records: [{ id: 5 }], next_token: null },
    ]);
    const result = await paginateAll(fetcher);
    expect(result.map((r) => r.id)).toEqual([1, 2, 3, 4, 5]);
  });

  test('P-04: duplicate ID across two pages throws WhoopApiError({kind: validation}) with "duplicate key" detail', async () => {
    const fetcher = fetcherFor<{ id: number }>([
      { records: [{ id: 1 }, { id: 2 }], next_token: 't1' },
      { records: [{ id: 2 }], next_token: null },
    ]);
    await expect(paginateAll(fetcher)).rejects.toThrowError(
      expect.objectContaining({
        name: 'WhoopApiError',
        kind: 'validation',
      }),
    );
    // Re-run to inspect the detail string — Vitest's `rejects.toThrow`
    // does not surface the instance directly with `objectContaining`,
    // so we catch ourselves to assert the substring.
    const fetcher2 = fetcherFor<{ id: number }>([
      { records: [{ id: 1 }, { id: 2 }], next_token: 't1' },
      { records: [{ id: 2 }], next_token: null },
    ]);
    let captured: unknown;
    try {
      await paginateAll(fetcher2);
    } catch (err) {
      captured = err;
    }
    expect(captured).toBeInstanceOf(WhoopApiError);
    expect((captured as WhoopApiError).detail).toContain('duplicate record key');
    expect((captured as WhoopApiError).detail).toContain('2');
  });

  test('P-05: integer IDs (WHOOP cycle int64) stringify into the Set key (default keyFn)', async () => {
    const fetcher = fetcherFor<{ id: number }>([
      { records: [{ id: 9999999999 }, { id: 10000000000 }], next_token: null },
    ]);
    const result = await paginateAll(fetcher);
    expect(result).toHaveLength(2);
  });

  test('P-06: UUID string IDs (sleeps, workouts) work with default keyFn', async () => {
    const fetcher = fetcherFor<{ id: string }>([
      { records: [{ id: 'uuid-a' }, { id: 'uuid-b' }], next_token: null },
    ]);
    const result = await paginateAll(fetcher);
    expect(result.map((r) => r.id)).toEqual(['uuid-a', 'uuid-b']);
  });

  test('P-07: empty first page returns an empty array (zero-result query)', async () => {
    const fetcher = fetcherFor<{ id: number }>([{ records: [], next_token: null }]);
    const result = await paginateAll(fetcher);
    expect(result).toEqual([]);
  });

  test('P-07b: next_token cycle detected (token repeats) throws a validation error instead of infinite-looping', async () => {
    // Page 1 returns token "t1"; page 2 returns the same "t1". Without the
    // cycle detection guard, paginateAll would request page 2 again forever.
    const fetcher = fetcherFor<{ id: number }>([
      { records: [{ id: 1 }], next_token: 't1' },
      { records: [{ id: 2 }], next_token: 't1' },
    ]);
    let captured: unknown;
    try {
      await paginateAll(fetcher);
    } catch (err) {
      captured = err;
    }
    expect(captured).toBeInstanceOf(WhoopApiError);
    expect((captured as WhoopApiError).detail).toContain('next_token cycle');
  });
});

describe('paginateAll (compound keyFn — recovery shape, Plan 03-09 contract)', () => {
  // A12: recoveries have no scalar `id`; the compound key is
  // (cycle_id, sleep_id). The keyFn parameter is the seam Plan 03-09
  // depends on so the recovery resource module does NOT have to mutate
  // this file.
  const recoveryKeyFn = (row: { cycle_id: number; sleep_id: string }): string =>
    `${row.cycle_id}:${row.sleep_id}`;

  test('P-08: compound-key happy path — three unique (cycle_id, sleep_id) rows across two pages', async () => {
    const fetcher = fetcherFor<{ cycle_id: number; sleep_id: string }>([
      {
        records: [
          { cycle_id: 1, sleep_id: 'a' },
          { cycle_id: 2, sleep_id: 'b' },
        ],
        next_token: 't1',
      },
      { records: [{ cycle_id: 3, sleep_id: 'c' }], next_token: null },
    ]);
    const result = await paginateAll(fetcher, recoveryKeyFn);
    expect(result).toHaveLength(3);

    // Sanity: confirm the default keyFn WOULD have failed on this shape.
    // Every row would resolve to String(undefined) = "undefined" → the
    // second row throws. This proves the keyFn parameter is actually
    // load-bearing for the recovery resource.
    const fetcher2 = fetcherFor<{ cycle_id: number; sleep_id: string }>([
      {
        records: [
          { cycle_id: 1, sleep_id: 'a' },
          { cycle_id: 2, sleep_id: 'b' },
        ],
        next_token: null,
      },
    ]);
    await expect(paginateAll(fetcher2)).rejects.toThrowError(
      expect.objectContaining({ name: 'WhoopApiError', kind: 'validation' }),
    );
  });

  test('P-09: compound-key dup detection — duplicate (cycle_id, sleep_id) across pages throws with the composite key in the detail', async () => {
    const fetcher = fetcherFor<{ cycle_id: number; sleep_id: string }>([
      {
        records: [
          { cycle_id: 1, sleep_id: 'a' },
          { cycle_id: 2, sleep_id: 'b' },
        ],
        next_token: 't1',
      },
      { records: [{ cycle_id: 1, sleep_id: 'a' }], next_token: null },
    ]);
    let captured: unknown;
    try {
      await paginateAll(fetcher, recoveryKeyFn);
    } catch (err) {
      captured = err;
    }
    expect(captured).toBeInstanceOf(WhoopApiError);
    expect((captured as WhoopApiError).kind).toBe('validation');
    expect((captured as WhoopApiError).detail).toContain('1:a');
  });
});
