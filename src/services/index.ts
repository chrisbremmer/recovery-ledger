// Services barrel — composition root for orchestration code.
//
// Plan 05 replaces the Plan 03 stub: `createServices()` now delegates to the
// real `runDoctor()` over the three Phase 1 doctor checks. The interface
// shape was locked early so `src/mcp/tools/whoop-doctor.ts` and the upcoming
// CLI `doctor` command both consume `DoctorResult` without rework.

import { runDoctor } from './doctor/index.js';

export type { DoctorCheck, DoctorResult, RunDoctorOptions } from './doctor/index.js';

export interface Services {
  runDoctor: typeof runDoctor;
}

export function createServices(): Services {
  return { runDoctor };
}
