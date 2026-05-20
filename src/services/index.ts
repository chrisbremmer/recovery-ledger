// Services barrel — composition root for orchestration code.
//
// Plan 05 replaced the Plan 03 stub: `createServices()` delegates to the
// real `runDoctor()` over the three Phase 1 doctor checks. The interface
// shape was locked early so `src/mcp/tools/whoop-doctor.ts` and the CLI
// `doctor` command both consume `DoctorResult` without rework.
//
// Phase 2 Plan 04 extended the same composition root with
// `refreshOrchestrator` — the SINGLE chokepoint for 401-reactive retry
// policy across every WHOOP API call. Phase 3's WHOOP sync service
// consumes it via the resource modules without further wiring.
//
// Phase 3 Plan 03-11 extends the barrel with `runSync` and re-exports
// `bootstrap` per PATTERNS §D3. Design choice (b) in the plan:
// keep `createServices()` lightweight (no DB) so existing consumers
// (`src/cli/commands/doctor.ts`) do NOT pay the DB-open cost. CLI shims
// that need `runSync` import `bootstrap` directly — the bootstrap layer
// opens the DB + runs the migrator + wires the resource modules + repos.
//
// Phase 4 Plan 04-08 extends the barrel with 6 new methods:
// `getDailyReview` + `getWeeklyReview` (review orchestrators),
// `addDecision` + `reviewDecisions` (decision-ledger CRUD),
// `queryCache` (whoop_query_cache D-24 8-arm dispatch), `getApiGap`
// (whoop_api_gap catalog accessor). Every Wave 4 MCP tool and CLI
// command consumes these through `bootstrap().services` per the Phase 3
// ≤5-line CLI shim precedent.
//
// Two entry points coexist:
//   - `createServices()` — Phase 1+2 doctor/auth surfaces; no DB. Throws
//     for every DB-dependent method (Phase 3 D-31 discipline:
//     `bootstrap()` is the only path that wires DB-backed services).
//   - `bootstrap()`       — Phase 3+4 full surface; opens DB + migrates.

import { runDoctor } from './doctor/index.js';
import { refreshOrchestrator } from './refresh-orchestrator.js';

export type {
  DailyReviewResult,
  DataStatus,
  DecisionPrompt,
  Pattern,
  SuggestedAction,
  TodayMetrics,
  WeeklyReviewResult,
  WeekSummary,
} from '../domain/review/types.js';
export type {
  ResourceName,
  ResourceSyncOutcome,
  ResourceSyncStatus,
  RunSyncInput,
  RunSyncResult,
  RunSyncStatus,
} from '../domain/types/sync.js';
// Phase 4 Plan 04-08 re-exports — every Wave 4 MCP tool + CLI command
// imports the relevant type contract from this barrel rather than reaching
// into the per-service `types.ts` files directly. Mirrors the Phase 3
// pattern of re-exporting `RunSyncInput` / `RunSyncResult` above.
export type { ApiGapEntry, ApiGapResult } from './api-gap/types.js';
export type { BootstrapOptions, Bootstrapped } from './bootstrap.js';
// Phase 3 Plan 03-11: extend the barrel surface with the sync orchestrator
// + bootstrap composition root. Plan 03-12 (CLI sync shim) and Phase 4's
// `whoop_sync` MCP tool both import these from here.
export { bootstrap } from './bootstrap.js';
export type { QueryCacheInput, QueryCacheResource, QueryCacheResult } from './cache/types.js';
export type {
  AddDecisionInput,
  ReviewDecisionsInput,
  ReviewDecisionsResult,
  UpdateDecisionInput,
} from './decision/types.js';
export type { DoctorCheck, DoctorResult, RunDoctorOptions } from './doctor/index.js';
export type {
  AuthedOperation,
  CallWithAuthOptions,
  FetchLikeResponse,
  RefreshOrchestrator,
} from './refresh-orchestrator.js';
export type { RunSyncDeps } from './sync/index.js';
export { runSync } from './sync/index.js';

import type { DailyReviewResult, WeeklyReviewResult } from '../domain/review/types.js';
import type { Decision } from '../domain/types/entities.js';
import type { RunSyncInput, RunSyncResult } from '../domain/types/sync.js';
import type { ApiGapResult } from './api-gap/types.js';
import type { QueryCacheInput, QueryCacheResult } from './cache/types.js';
import type {
  AddDecisionInput,
  ReviewDecisionsInput,
  ReviewDecisionsResult,
} from './decision/types.js';

export interface Services {
  runDoctor: typeof runDoctor;
  refreshOrchestrator: typeof refreshOrchestrator;
  /**
   * Sync orchestrator. NOTE: the lightweight `createServices()` factory
   * below does NOT wire this — runSync requires an open DB handle which
   * comes from `bootstrap()`. CLI shims that need runSync call `bootstrap()`
   * directly; this field exists on the Services interface so the future
   * Phase 4 `whoop_sync` MCP tool can declare its dependency via the
   * same type surface.
   */
  runSync: (input: RunSyncInput) => Promise<RunSyncResult>;
  /**
   * Phase 4 daily-review orchestrator (Plan 04-07). DB-backed: composed in
   * `bootstrap()`. The lightweight `createServices()` factory throws if
   * this method is called (D-31 discipline — `bootstrap()` is the only
   * wiring path).
   */
  getDailyReview: (input: { date?: string }) => Promise<DailyReviewResult>;
  /** Phase 4 weekly-review orchestrator (Plan 04-07). DB-backed. */
  getWeeklyReview: (input: { date?: string }) => Promise<WeeklyReviewResult>;
  /** Phase 4 decision-ledger insert (Plan 04-06 D-19). DB-backed. */
  addDecision: (input: AddDecisionInput) => Promise<Decision>;
  /** Phase 4 decision-ledger dual-mode read/update (Plan 04-06 D-21). DB-backed. */
  reviewDecisions: (input: ReviewDecisionsInput) => Promise<ReviewDecisionsResult>;
  /** Phase 4 whoop_query_cache 8-arm dispatch (Plan 04-08 D-24). DB-backed. */
  queryCache: (input: QueryCacheInput) => Promise<QueryCacheResult>;
  /** Phase 4 whoop_api_gap catalog accessor (Plan 04-06 D-28). No DB; safe
   *  to call through `createServices()` once the factory below wires it
   *  through. */
  getApiGap: () => Promise<ApiGapResult>;
}

/**
 * Lightweight services factory — does NOT open the DB. Consumers that
 * need `runSync`, the Phase 4 review/decision/cache services use
 * `bootstrap()` instead, which opens the DB + runs the migrator +
 * wires the repos. The doctor + auth surfaces continue to use this
 * factory so they pay no DB-open cost.
 *
 * Every DB-dependent method below throws when called through this
 * factory — Phase 3 D-31 discipline: `bootstrap()` is the ONLY path
 * that wires DB-backed services. The throw messages identify the
 * service so a misconfigured caller gets pointed at the fix without
 * grepping the source.
 *
 * `getApiGap` is special: it has no DB dependency, so it could be
 * wired here. We keep it on the bootstrap-only path anyway so the
 * lightweight factory stays a single Phase 1-2 surface (doctor + auth)
 * — that boundary is load-bearing for the CLI doctor command which
 * must NOT open the DB.
 */
export function createServices(): Services {
  return {
    runDoctor,
    refreshOrchestrator,
    runSync: () => {
      throw new Error(
        'runSync requires bootstrap() — call bootstrap() instead of createServices() when you need the sync service',
      );
    },
    getDailyReview: () => {
      throw new Error(
        'getDailyReview requires bootstrap() — call bootstrap() instead of createServices() when you need the daily review service',
      );
    },
    getWeeklyReview: () => {
      throw new Error(
        'getWeeklyReview requires bootstrap() — call bootstrap() instead of createServices() when you need the weekly review service',
      );
    },
    addDecision: () => {
      throw new Error(
        'addDecision requires bootstrap() — call bootstrap() instead of createServices() when you need the decision service',
      );
    },
    reviewDecisions: () => {
      throw new Error(
        'reviewDecisions requires bootstrap() — call bootstrap() instead of createServices() when you need the decision service',
      );
    },
    queryCache: () => {
      throw new Error(
        'queryCache requires bootstrap() — call bootstrap() instead of createServices() when you need the query cache service',
      );
    },
    getApiGap: () => {
      throw new Error(
        'getApiGap requires bootstrap() — call bootstrap() instead of createServices(). The factory is reserved for the Phase 1-2 doctor/auth surfaces; api-gap composes against the bootstrap surface alongside the review/decision services.',
      );
    },
  };
}
