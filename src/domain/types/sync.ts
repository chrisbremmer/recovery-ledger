// Sync orchestration types — D-23, D-24, D-25, D-26.
//
// Pure type declarations. No runtime behavior, no imports, no I/O. The Wave 1a
// position is deliberate: this file lands BEFORE entities.ts (Wave 1b, Plan
// 03-03) so the cross-file import of `ResourceSyncOutcome` and `ResourceName`
// resolves cleanly without a placeholder-coupling race.
//
// Consumed by:
//   - Plan 03-03 (Wave 1b) entities.ts — imports `ResourceSyncOutcome` +
//     `ResourceName` from `./sync.js` after this plan lands.
//   - Plan 03-11 (Wave 4) sync orchestrator — composes `RunSyncInput`,
//     `RunSyncResult`, the `RESOURCES` tuple, and the per-resource outcome
//     enum into the shape `runSync(): Promise<RunSyncResult>`.
//   - Plan 03-12 (CLI shim) — parses `--days` / `--since` / `--resources`
//     flags into `RunSyncInput`; validates `--resources` membership against
//     `RESOURCE_NAMES_SET`.
//
// Source decisions (verbatim from 03-CONTEXT.md):
//   D-23 Sequential across the 6 resources. Order: profile → body_measurements
//        → cycles → recoveries → sleeps → workouts. Order is LOAD-BEARING —
//        lightest first to surface auth/config errors before paginating
//        through heavy time-windowed resources.
//   D-24 `sync_runs` row shape — status enum + per-resource map + run id +
//        gaps count.
//   D-25 Per-resource outcome enum: success | partial_429 | partial_5xx |
//        failed_auth | failed_network | skipped.
//   D-26 v1 ships three sync flags only: --days (default 30 at CLI layer),
//        --since (ISO 8601, overrides --days), --resources (comma-separated
//        subset of RESOURCES; defaults to all).

// biome-ignore format: D-23 resource order must remain on a single line —
// Plan 03-04 acceptance grep keys on the verbatim tuple literal.
export const RESOURCES = ['profile', 'body_measurements', 'cycles', 'recoveries', 'sleeps', 'workouts'] as const;

/**
 * Canonical empty-cursor sentinel (D-09). Used as the COALESCE fallback in
 * every per-resource `cursor()` query and as the documented input to
 * `computeWindow()` when a resource table is empty. Single source of truth
 * — `cursor.ts` re-exports this for back-compat; the 4 scored repos import
 * it directly.
 */
export const EPOCH_ZERO_ISO = '1970-01-01T00:00:00.000Z';

export type ResourceName = (typeof RESOURCES)[number];

/**
 * Runtime membership check for `--resources` CLI parsing (Plan 03-12). The CLI
 * shim splits the comma-separated value, then rejects any token that is not in
 * this set. The set construction is computed once at module load — RESOURCES
 * is `readonly`, so the set is structurally immutable.
 */
export const RESOURCE_NAMES_SET: ReadonlySet<string> = new Set(RESOURCES);

/**
 * Per-resource outcome (D-25). The CLI prints one summary line per resource at
 * exit; the future Phase 4 `whoop_sync` MCP tool surfaces this verbatim
 * through `structuredContent.perResource`.
 *
 * - `success`        — all expected pages fetched + upserted with no errors.
 * - `partial_429`    — rate-limited mid-pagination; some pages landed.
 * - `partial_5xx`    — server error mid-pagination; some pages landed.
 * - `failed_auth`    — refresh chain bottomed out; nothing landed.
 * - `failed_network` — network unreachable / DNS failure; nothing landed.
 * - `failed_db`      — SQLite write rejected (FK, CHECK, schema drift); nothing landed.
 * - `failed_parse`   — normalizer / Zod boundary rejected the wire payload.
 * - `failed_unknown` — bug or unanticipated throwable; nothing landed.
 * - `skipped`        — user passed `--resources` excluding this resource.
 */
export type ResourceSyncStatus =
  | 'success'
  | 'partial_429'
  | 'partial_5xx'
  | 'failed_auth'
  | 'failed_network'
  | 'failed_db'
  | 'failed_parse'
  | 'failed_unknown'
  | 'skipped';

/**
 * Top-level run status (D-24). Roll-up rule (owned by the orchestrator in
 * Plan 03-11): `failed` if every resource failed; `ok` if every resource
 * succeeded or was skipped; `partial` otherwise. The orchestrator computes
 * this from `perResource` at finalize time.
 */
export type RunSyncStatus = 'ok' | 'partial' | 'failed';

/**
 * One row in the per-resource map of `RunSyncResult`. Counts are optional —
 * they only appear for outcomes that produced data (`success`, `partial_*`).
 * `failed_auth`, `failed_network`, and `skipped` outcomes ship status only.
 */
export interface ResourceSyncOutcome {
  status: ResourceSyncStatus;
  fetched?: number;
  upserted?: number;
  errors?: number;
  durationMs?: number;
}

/**
 * CLI / MCP input to `runSync` (D-26).
 *
 * - `days`      — sets `since = now() - days*86400000`. The CLI shim provides
 *                 the default value (30); `computeWindow` treats `undefined`
 *                 and `0` identically (falls through to the 7-day re-window).
 * - `since`     — ISO 8601 string; overrides everything. Backfill mode.
 * - `resources` — defaults to all six when omitted (the orchestrator iterates
 *                 the RESOURCES tuple in D-23 order). When provided, the
 *                 orchestrator filters in-order and marks excluded resources
 *                 as `{status: 'skipped'}`.
 */
export interface RunSyncInput {
  days?: number;
  since?: string;
  resources?: ReadonlyArray<ResourceName>;
}

/**
 * The result returned by `runSync` (D-24). `syncRunId` is the row id from the
 * `sync_runs` table the orchestrator inserts at sync-start; consumers
 * (CLI exit code path, future MCP tool) reference it to look up the full
 * `per_resource` JSON blob and `gaps_detected` count from the DB.
 */
export interface RunSyncResult {
  status: RunSyncStatus;
  perResource: Record<ResourceName, ResourceSyncOutcome>;
  syncRunId: number;
  gapsDetected: number;
}
