// Pure cursor function — D-10 (7-day re-window) + D-26 (flag overrides).
// Reference: 03-RESEARCH.md Pattern 9 (lines 660–685) + 03-PATTERNS.md D2.
//
// Pure function — no wall-clock reads, no environment reads, no logger calls,
// no I/O. The clock is passed in as `opts.clock: Date` so the unit tests can
// pin time without `vi.useFakeTimers()` or `vi.setSystemTime()`. This is the
// load-bearing testability lever: every branch of the override precedence
// (--since wins > --days wins > default 7-day re-window > epoch fallback) is
// exhaustively unit-tested against literal ISO strings.
//
// 7-day re-window rationale (D-10): WHOOP retroactively updates cycle.start /
// cycle.end "for a few days as WHOOP learns more" (Pitfall 15). A pure
// MAX(updated_at) cursor would miss these retroactive updates the moment the
// cursor advanced past their original `start`. The fix: always fetch the
// trailing 7 days IN ADDITION to the cursor-based delta. Effective:
//   since = min(cursor, now() - 7d)
// The OLDER of the two values wins — the window is at least 7 days, and a
// freshly-advanced cursor does NOT shrink the re-window below 7d. The
// strict-less-than at the 7d boundary (`opts.cursor < sevenDaysAgo`) is
// intentional: when cursor exactly equals sevenDaysAgo, the tie goes to
// sevenDaysAgo (well-defined; no off-by-one ambiguity).
//
// ISO-string lexical ordering matches chronological ordering only when both
// strings are full ISO 8601 with `Z` and identical timezone normalization
// (e.g., `YYYY-MM-DDTHH:mm:ss.SSSZ`). The cursor is emitted by SQLite
// `MAX(updated_at)` over the WHOOP wire format, which guarantees this shape.
// The `--since` flag is user input — validate the shape elsewhere (Plan
// 03-12 CLI shim runs it through Zod before calling computeWindow);
// computeWindow itself trusts the string lexically per D-10.
//
// ADR-0001: no direct stdout writes, no console calls from this module —
// pure function, returns its result, never emits anything.

/**
 * Milliseconds in one day. Used by the `--days N` override and the default
 * 7-day re-window. Exposed for the unit suite so the test fixture can compute
 * expected window edges with the same constant the implementation uses.
 */
export const MS_PER_DAY = 86_400_000;

/**
 * The fallback value the SQL caller wraps `MAX(updated_at)` in via
 * `COALESCE(MAX(updated_at), '1970-01-01T00:00:00.000Z')` per D-09. When the
 * resource table is empty or every row has a NULL `updated_at`, the cursor
 * lands here and the default branch returns `since = EPOCH_ZERO_ISO` (the
 * older of the two — the 7-day re-window never wins against epoch zero).
 * Effective semantics: fetch everything.
 *
 * Re-exported from `src/domain/types/sync.ts` where the constant is owned —
 * cursor.ts keeps the named re-export so the existing test imports
 * (`import { EPOCH_ZERO_ISO } from './cursor.js'`) continue to resolve.
 */
export { EPOCH_ZERO_ISO } from '../../domain/types/sync.js';

export interface ComputeWindowOptions {
  /**
   * ISO 8601 timestamp emitted by `SELECT COALESCE(MAX(updated_at), '...')`
   * over the resource table (D-09). Trusted by computeWindow — no validation
   * here; the caller is the DB. `EPOCH_ZERO_ISO` is the documented fallback
   * for empty tables.
   */
  cursor: string;
  /**
   * Injected clock. Production sites pass `new Date()` at the call boundary;
   * tests pass a fixed Date so the trailing-7d window is deterministic. No
   * wall-clock reads inside computeWindow — that is the load-bearing
   * purity invariant.
   */
  clock: Date;
  /**
   * `--since <ISO>` override (D-26). When set (truthy), it wins over both
   * `flagDaysN` and the default 7-day re-window. The CLI shim (Plan 03-12)
   * runs the raw flag value through Zod before calling computeWindow; this
   * module trusts the string verbatim.
   */
  flagSinceISO?: string | null;
  /**
   * `--days N` override (D-26). When set and `> 0`, derives `since = clock -
   * N * MS_PER_DAY`. A value of `0` (or `null`/`undefined`) falls through to
   * the default 7-day re-window — the CLI shim (Plan 03-12) owns the default
   * value of `30`; computeWindow does NOT inject one.
   */
  flagDaysN?: number | null;
}

export function computeWindow(opts: ComputeWindowOptions): { since: string; until: string } {
  const clockMs = opts.clock.getTime();
  const until = opts.clock.toISOString();

  // Override 1 — `--since <ISO>` wins absolutely. Backfill mode.
  if (opts.flagSinceISO) {
    return { since: opts.flagSinceISO, until };
  }

  // Override 2 — `--days N`. Skips the cursor entirely; the user has
  // declared an explicit window. The `> 0` guard intentionally treats `0`
  // as fall-through to the default branch (matches the plan's "0 is falsy
  // per the spec; D-26 says default 30 — the CLI shim owns the default,
  // not computeWindow").
  if (opts.flagDaysN && opts.flagDaysN > 0) {
    const since = new Date(clockMs - opts.flagDaysN * MS_PER_DAY).toISOString();
    return { since, until };
  }

  // Default — `min(cursor, clock - 7d)` per D-10. The OLDER value wins:
  //   - cursor older than sevenDaysAgo → cursor wins (window extends back
  //     to the cursor; we have not synced in > 7 days).
  //   - cursor newer than sevenDaysAgo → sevenDaysAgo wins (re-window the
  //     trailing 7 days to catch WHOOP retroactive updates per Pitfall 15).
  //   - cursor equals sevenDaysAgo → strict-less-than is false → tie goes
  //     to sevenDaysAgo (well-defined boundary, no ambiguity).
  //   - cursor is EPOCH_ZERO_ISO (empty table fallback) → epoch wins, fetch
  //     everything.
  const sevenDaysAgo = new Date(clockMs - 7 * MS_PER_DAY).toISOString();
  const since = opts.cursor < sevenDaysAgo ? opts.cursor : sevenDaysAgo;
  return { since, until };
}
