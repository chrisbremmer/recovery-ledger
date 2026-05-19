// `whoop_query_cache` type contracts — D-24 (typed-discriminated-union
// per resource, NEVER free-form SQL — REQUIREMENTS Out of Scope locks
// this). Pure type file; no runtime behavior; no I/O.
//
// The 8-arm `QueryCacheInput` is the type-level enforcement of T-04-S4
// (Plan 04-02 threat model): untrusted MCP input cannot widen the
// contract at runtime because the Zod schema in Plan 04-10's
// `services/cache/index.ts` mirrors this shape verbatim and refuses
// any payload that doesn't narrow into one of the 8 arms. Free-form
// SQL is unreachable; even the most permissive arm only allows the
// per-resource filter set listed.
//
// `limit` semantics (D-24 §last paragraph):
//   - default = 100 (the service supplies this when the caller omits)
//   - hard-cap = 500 (the service clamps anything larger and sets
//     `truncated = true` on the result)

import type { Cycle, Decision, Recovery, Sleep, Workout } from '../../domain/types/entities.js';
import type { ResourceName } from '../../domain/types/sync.js';

/**
 * Per-resource typed input for `services.queryCache(input)`. D-24
 * verbatim — 8 arms, each carrying only the filters valid for that
 * resource. The `resource` field is the discriminator; consumers
 * narrow on it via an exhaustive switch (adding a 9th resource
 * requires editing this union AND every consumer's switch).
 *
 * Arm-by-arm rationale (D-24):
 * - `cycles` — full Phase 3 D-04/D-16 escape hatches:
 *   `includeUnscored` opts in PENDING_SCORE/UNSCORABLE rows;
 *   `includeExcluded` opts in DST-straddle rows. Defaults: both
 *   `false` (SCORED + non-excluded only).
 * - `recoveries` — same escape hatches + per-score filters
 *   (`minRecoveryScore` / `maxRecoveryScore` ranges).
 * - `sleeps` — same escape hatch (no per-score filter; sleep query
 *   ergonomics are time-windowed, not score-banded).
 * - `workouts` — same escape hatch + `sportId` filter (the WHOOP
 *   sport_id column from `whoop_sport.csv` reference).
 * - `profile` — single-row table; no filters meaningful.
 * - `body_measurements` — time-windowed only (D-35 append-on-change).
 * - `sync_runs` — internal table; status + since filters for
 *   observability ("show the last 5 failed syncs").
 * - `decisions` — DEC-01 ledger; status + category filters.
 *
 * `includeUnscored` / `includeExcluded` carry forward verbatim from
 * Phase 3 D-04 (`{includeUnscored: true}`) and D-16
 * (`{includeExcluded: true}`) opt-in escape hatches on the repo
 * `byRange` calls.
 *
 * `limit` (default 100, hard-cap 500 — D-24 §last paragraph):
 * documented at the type level via the `?` optional + the service
 * docstring; the service applies the default when omitted and clamps
 * to 500 + sets `truncated: true` when exceeded.
 */
export type QueryCacheInput =
  | {
      resource: 'cycles';
      since?: string;
      until?: string;
      includeUnscored?: boolean;
      includeExcluded?: boolean;
      limit?: number;
    }
  | {
      resource: 'recoveries';
      since?: string;
      until?: string;
      includeUnscored?: boolean;
      minRecoveryScore?: number;
      maxRecoveryScore?: number;
      limit?: number;
    }
  | {
      resource: 'sleeps';
      since?: string;
      until?: string;
      includeUnscored?: boolean;
      limit?: number;
    }
  | {
      resource: 'workouts';
      since?: string;
      until?: string;
      includeUnscored?: boolean;
      sportId?: number;
      limit?: number;
    }
  | { resource: 'profile' }
  | {
      resource: 'body_measurements';
      since?: string;
      until?: string;
      limit?: number;
    }
  | {
      resource: 'sync_runs';
      status?: 'ok' | 'partial' | 'failed' | 'running';
      since?: string;
      limit?: number;
    }
  | {
      resource: 'decisions';
      status?: 'open' | 'followed_up' | 'abandoned';
      category?: string;
      limit?: number;
    };

/**
 * Derived discriminator type for switch-exhaustiveness checks at the
 * formatter dispatch site (Wave 3 Plan 04-09). The 8 values are the 6
 * Phase 3 `ResourceName` entries (`profile`, `body_measurements`,
 * `cycles`, `recoveries`, `sleeps`, `workouts`) plus `sync_runs` +
 * `decisions` — both Phase 3 tables that aren't WHOOP resources but
 * which `whoop_query_cache` exposes uniformly.
 */
export type QueryCacheResource = QueryCacheInput['resource'];

/**
 * `services.queryCache(input)` result per D-24. `rows` is typed as
 * `unknown[]` at the service-layer boundary — per-resource narrowing
 * happens at the formatter dispatch site (Wave 3 Plan 04-09) via a
 * switch on `result.resource`. This keeps the service surface free of
 * generic-discriminator gymnastics; the formatter is the natural
 * site for the per-resource render branching anyway.
 *
 * - `count` is the row count BEFORE truncation; lets the formatter
 *   render "showing 100 of 247 — pass --limit 500 for more."
 * - `truncated: true` means count > limit; rows is exactly `limit`
 *   long.
 *
 * Reference to entity types is via the imports at the top of this
 * file — kept for downstream consumers that want to narrow `rows`
 * after the dispatch site (e.g., `result.rows as Cycle[]` when
 * `result.resource === 'cycles'`).
 */
export interface QueryCacheResult {
  resource: QueryCacheResource;
  rows: unknown[];
  count: number;
  truncated: boolean;
}

/**
 * Re-export anchors so consumers that import `QueryCacheInput` get the
 * entity types in scope for the per-resource narrowing pattern. Pure
 * type re-exports — no runtime cost.
 */
export type { Cycle, Decision, Recovery, ResourceName, Sleep, Workout };
