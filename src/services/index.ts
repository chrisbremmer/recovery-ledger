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
//   - `createServices()` — Phase 1+2 doctor/auth surfaces; no DB. Returns
//     `ServicesBase` so DB-dependent methods are unreachable at compile
//     time (Phase 3 D-31 discipline: `bootstrap()` is the only path that
//     wires DB-backed services).
//   - `bootstrap()`       — Phase 3+4 full surface; opens DB + migrates.
//     Returns the full `Services` interface (`ServicesBase` + DB methods).

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

/**
 * Phase 1-2 surface: doctor + auth only. No DB dependency. `createServices()`
 * returns this — DB-backed methods are simply absent from the type, so a
 * caller that wires `whoop_sync` (or any review/decision/cache tool) against
 * `createServices()` instead of `bootstrap()` fails to compile.
 */
export interface ServicesBase {
  runDoctor: typeof runDoctor;
  refreshOrchestrator: typeof refreshOrchestrator;
}

/**
 * Full Phase 3+4 surface. Returned by `bootstrap()` — every method below
 * is DB-backed and the bootstrap layer wires the repos + resource modules.
 * `Services` extends `ServicesBase` so doctor/auth code that takes a
 * `ServicesBase` keeps working when handed the full `Services`.
 */
export interface Services extends ServicesBase {
  /** Sync orchestrator (Phase 3 Plan 03-11). DB-backed: only `bootstrap()` wires this. */
  runSync: (input: RunSyncInput) => Promise<RunSyncResult>;
  /** Daily-review orchestrator (Phase 4 Plan 04-07). DB-backed. */
  getDailyReview: (input: { date?: string }) => Promise<DailyReviewResult>;
  /** Weekly-review orchestrator (Phase 4 Plan 04-07). DB-backed. */
  getWeeklyReview: (input: { date?: string }) => Promise<WeeklyReviewResult>;
  /** Decision-ledger insert (Phase 4 Plan 04-06 D-19). DB-backed. */
  addDecision: (input: AddDecisionInput) => Promise<Decision>;
  /** Decision-ledger dual-mode read/update (Phase 4 Plan 04-06 D-21). DB-backed. */
  reviewDecisions: (input: ReviewDecisionsInput) => Promise<ReviewDecisionsResult>;
  /** `whoop_query_cache` 8-arm dispatch (Phase 4 Plan 04-08 D-24). DB-backed. */
  queryCache: (input: QueryCacheInput) => Promise<QueryCacheResult>;
  /** `whoop_api_gap` catalog accessor (Phase 4 Plan 04-06 D-28). DB-backed. */
  getApiGap: () => Promise<ApiGapResult>;
}

/**
 * Lightweight services factory — does NOT open the DB. Returns only the
 * Phase 1-2 surface (`ServicesBase`: doctor + auth). Consumers that need
 * `runSync`, the Phase 4 review/decision/cache services, or `getApiGap`
 * use `bootstrap()` instead — bootstrap opens the DB, runs the migrator,
 * and wires the repos.
 *
 * D-31 discipline is now enforced at compile time: `createServices()`
 * returns `ServicesBase` so an attempt to call `services.runSync(...)`
 * etc. on this factory's result is a type error, not a runtime throw.
 * That's the whole point of finding #13 — the previous stub satisfied
 * the full `Services` interface with throwing implementations, which
 * meant a Phase 4 MCP wiring mistake would compile cleanly and only
 * fail at first call.
 */
export function createServices(): ServicesBase {
  return {
    runDoctor,
    refreshOrchestrator,
  };
}
