// Plaintext renderer for DoctorResult (D-06).
//
// Compact form: one `[status] name — detail` line per check, followed by a
// trailing `overall: <status>` line. The CLI `doctor --text` flag and the
// MCP whoop_doctor tool's text-fallback content both consume this output.
// Tone-word banned list (CLAUDE.md) applies; the renderer ships verbatim
// status keywords (`pass` / `warn` / `fail`) and the static `overall:`
// prefix — no editorial copy is generated here.

import type { DoctorResult } from '../services/doctor/index.js';

export function renderDoctor(r: DoctorResult): string {
  const lines = r.checks.map((c) => `[${c.status}] ${c.name} — ${c.detail}`);
  lines.push(`overall: ${r.overall}`);
  return lines.join('\n');
}
