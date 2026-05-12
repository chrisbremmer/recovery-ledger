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

export function deriveOverall(checks: ReadonlyArray<DoctorCheck>): DoctorResult['overall'] {
  if (checks.some((c) => c.status === 'fail')) return 'fail';
  if (checks.some((c) => c.status === 'warn')) return 'warn';
  return 'pass';
}

export async function runDoctor(): Promise<DoctorResult> {
  const checks = await Promise.all([probeBetterSqlite3(), probeKeyring(), probeMcpStdoutPurity()]);
  return { checks, overall: deriveOverall(checks) };
}
