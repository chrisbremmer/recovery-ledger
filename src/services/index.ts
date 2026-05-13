// Services barrel — composition root for orchestration code.
//
// Plan 05 replaces the Plan 03 stub: `createServices()` now delegates to the
// real `runDoctor()` over the three Phase 1 doctor checks. The interface
// shape was locked early so `src/mcp/tools/whoop-doctor.ts` and the upcoming
// CLI `doctor` command both consume `DoctorResult` without rework.
//
// Phase 2 Plan 04 extends the same composition root with `refreshOrchestrator`
// — the SINGLE chokepoint for 401-reactive retry policy across every WHOOP
// API call. Phase 3's WHOOP sync service consumes it via `createServices()`
// without further wiring. Plan 02-05's `auth.ts` does NOT pull through this
// barrel — it imports infrastructure directly (oauth.ts + token-store.ts)
// because the auth-code grant flow has no 401-reactive boundary (the user
// has not yet authenticated against any tokenized endpoint).

import { runDoctor } from './doctor/index.js';
import { refreshOrchestrator } from './refresh-orchestrator.js';

export type { DoctorCheck, DoctorResult, RunDoctorOptions } from './doctor/index.js';
export type {
  AuthedOperation,
  CallWithAuthOptions,
  FetchLikeResponse,
  RefreshOrchestrator,
} from './refresh-orchestrator.js';

export interface Services {
  runDoctor: typeof runDoctor;
  refreshOrchestrator: typeof refreshOrchestrator;
}

export function createServices(): Services {
  return { runDoctor, refreshOrchestrator };
}
