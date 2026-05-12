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

// MR-27: exhaustive status switch with defense-in-depth fail arm. The
// TypeScript type union (`'pass' | 'warn' | 'fail'`) already prevents any
// other status at compile time; the runtime arm exists so a future schema
// drift, a JSON.parse cast, or a probe that synthesizes a check from
// unchecked input still surfaces as `fail` instead of silently bucketing
// into pass. A unit test exercises this via a `@ts-expect-error` literal.
export function deriveOverall(checks: ReadonlyArray<DoctorCheck>): DoctorResult['overall'] {
  let sawWarn = false;
  for (const c of checks) {
    switch (c.status) {
      case 'fail':
        return 'fail';
      case 'warn':
        sawWarn = true;
        break;
      case 'pass':
        break;
      default:
        // Unknown status at runtime (impossible per the static type union).
        // Defense-in-depth: never treat unknown as pass. A drift here is a
        // load-bearing protocol failure; we surface it as fail so the doctor
        // surfaces the bug instead of silently green-checking the user.
        return 'fail';
    }
  }
  return sawWarn ? 'warn' : 'pass';
}

// MR-07: switch from Promise.all to Promise.allSettled so a single probe
// throwing does not collapse the whole doctor result into a rejected promise
// (which would surface as a sanitized MCP error or an unhandled CLI exception
// rather than a structured `fail` check). Each rejection is synthesized into
// a DoctorCheck with status: 'fail' so the failing probe still appears in
// the user-facing output with a useful detail string.
const PROBE_NAMES = ['better_sqlite3_load', 'napi_keyring_load', 'mcp_stdout_purity'] as const;

export async function runDoctor(opts: RunDoctorOptions = {}): Promise<DoctorResult> {
  // `RL_INSIDE_MCP=1` is set on the spawned MCP subprocess in
  // probeMcpStdoutPurity; either signal (explicit opts or env) suppresses the
  // recursive subprocess check. Belt-and-suspenders: callers that forget to
  // pass the option still get safe behavior when the env var is present.
  const skipSubprocess = opts.skipSubprocessChecks === true || process.env.RL_INSIDE_MCP === '1';
  const settled = await Promise.allSettled([
    probeBetterSqlite3(),
    probeKeyring(),
    probeMcpStdoutPurity({ skipSubprocess }),
  ]);
  const checks: DoctorCheck[] = settled.map((r, i) => {
    if (r.status === 'fulfilled') return r.value;
    // Synthesize a fail check for a probe that threw rather than returning
    // a structured DoctorCheck. `probeName` falls back to a positional name
    // if PROBE_NAMES drifts out of sync — defense in depth, not contract.
    const probeName = PROBE_NAMES[i] ?? `probe_${i}`;
    const reason = r.reason instanceof Error ? r.reason.message : String(r.reason);
    return {
      name: probeName,
      status: 'fail',
      detail: `probe threw: ${reason}`,
    };
  });
  return { checks, overall: deriveOverall(checks) };
}
