// Doctor service composition (D-05 / D-06).
//
// `runDoctor()` runs the three Phase 1 checks in parallel and derives a single
// `overall` status: any `fail` wins; otherwise any `warn` wins; otherwise `pass`.
// Pure orchestration — no I/O of its own, no logger. The MCP tool shim and the
// CLI `doctor` command both consume `DoctorResult` verbatim.
//
// `deriveOverall` is exported so the unit suite can exercise the precedence
// rule with array literals (no native-module spawns, no subprocess driver).
// `runDoctor()` calls it internally.
//
// CR-01: `RunDoctorOptions.skipSubprocessChecks` is set by the `whoop_doctor`
// MCP tool handler (which also reads `RL_INSIDE_MCP` from env as a fallback)
// so the subprocess stdout-purity probe does NOT recurse: outer MCP →
// whoop_doctor tool → runDoctor → probeMcpStdoutPurity → spawn dist/mcp.mjs →
// inner MCP → whoop_doctor tool → runDoctor → ... The flag terminates the
// chain at the first inner runDoctor invocation.

import { probeMcpStdoutPurity } from './checks/mcp-stdout-purity.js';
import { probeBetterSqlite3, probeKeyring } from './checks/native-modules.js';

export interface DoctorCheck {
  name: string;
  status: 'pass' | 'warn' | 'fail';
  detail: string;
}

export interface DoctorResult {
  checks: DoctorCheck[];
  overall: 'pass' | 'warn' | 'fail';
}

export interface RunDoctorOptions {
  /**
   * Skip checks that spawn subprocesses (currently: mcp_stdout_purity).
   * Set by the MCP tool handler so a `whoop_doctor` invocation from inside
   * an MCP transport does not recursively respawn `dist/mcp.mjs`. The CLI
   * doctor command leaves this unset so the subprocess check still runs
   * end-to-end. See CR-01 in 01-REVIEW.md.
   */
  skipSubprocessChecks?: boolean;
}

export function deriveOverall(checks: ReadonlyArray<DoctorCheck>): DoctorResult['overall'] {
  if (checks.some((c) => c.status === 'fail')) return 'fail';
  if (checks.some((c) => c.status === 'warn')) return 'warn';
  return 'pass';
}

export async function runDoctor(opts: RunDoctorOptions = {}): Promise<DoctorResult> {
  // `RL_INSIDE_MCP=1` is set on the spawned MCP subprocess in
  // probeMcpStdoutPurity; either signal (explicit opts or env) suppresses the
  // recursive subprocess check. Belt-and-suspenders: callers that forget to
  // pass the option still get safe behavior when the env var is present.
  const skipSubprocess =
    opts.skipSubprocessChecks === true || process.env.RL_INSIDE_MCP === '1';
  const checks = await Promise.all([
    probeBetterSqlite3(),
    probeKeyring(),
    probeMcpStdoutPurity({ skipSubprocess }),
  ]);
  return { checks, overall: deriveOverall(checks) };
}
