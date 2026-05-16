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
// Phase 3 Plan 03-11 (THIS plan) extends the barrel with `runSync` and
// re-exports `bootstrap` per PATTERNS §D3. Design choice (b) in the plan:
// keep `createServices()` lightweight (no DB) so existing consumers
// (`src/cli/commands/doctor.ts`) do NOT pay the DB-open cost. CLI shims
// that need `runSync` import `bootstrap` directly — the bootstrap layer
// opens the DB + runs the migrator + wires the resource modules + repos.
//
// Two entry points coexist:
//   - `createServices()` — Phase 1+2 doctor/auth surfaces; no DB.
//   - `bootstrap()`       — Phase 3 sync surface; opens DB + migrates.

import { runDoctor } from './doctor/index.js';
import { refreshOrchestrator } from './refresh-orchestrator.js';

export type {
  ResourceName,
  ResourceSyncOutcome,
  ResourceSyncStatus,
  RunSyncInput,
  RunSyncResult,
  RunSyncStatus,
} from '../domain/types/sync.js';
export type { BootstrapOptions, Bootstrapped } from './bootstrap.js';

// Phase 3 Plan 03-11: extend the barrel surface with the sync orchestrator
// + bootstrap composition root. Plan 03-12 (CLI sync shim) and Phase 4's
// `whoop_sync` MCP tool both import these from here.
export { bootstrap } from './bootstrap.js';
export type { DoctorCheck, DoctorResult, RunDoctorOptions } from './doctor/index.js';
export type {
  AuthedOperation,
  CallWithAuthOptions,
  FetchLikeResponse,
  RefreshOrchestrator,
} from './refresh-orchestrator.js';
export type { RunSyncDeps } from './sync/index.js';
export { runSync } from './sync/index.js';

import type { RunSyncInput, RunSyncResult } from '../domain/types/sync.js';

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
}

/**
 * Lightweight services factory — does NOT open the DB. Consumers that
 * need `runSync` use `bootstrap()` instead, which opens the DB + runs
 * the migrator + wires the resource modules + repos. The doctor + auth
 * surfaces continue to use this factory so they pay no DB-open cost.
 *
 * `runSync` on the returned object throws — it is unreachable from this
 * code path (any caller that reaches for it has misconfigured the
 * composition; use `bootstrap()` instead).
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
  };
}
