// CLI `doctor` command shim (D-06 / D-11 — the one Gate-C-exempt CLI output
// point in the codebase). Per CLAUDE.md §Critical Rules, `process.stdout.write`
// is allowed only here; every other module routes output through Pino (stderr)
// or MCP JSON-RPC framing. ci-grep-gates.sh Gate C enforces this exclusively
// for `src/cli/commands/doctor.ts`.

import { renderDoctor } from '../../formatters/doctor.txt.js';
import { type DoctorResult, runDoctor } from '../../services/doctor/index.js';

// WR-06: exit-code map honors all three D-06 statuses. Reserved now per
// DOC-02 ("doctor emits structured exit codes that map to documented
// troubleshooting steps") so scripted wrappers (cron, launchd, CI) can
// distinguish warn from pass at the shell level. Exit 2 is the conventional
// POSIX "warning" code. Phase 5 may extend the map with sub-codes for
// specific check failures; the three-status mapping is the floor contract.
export const DOCTOR_EXIT_CODES: Readonly<Record<DoctorResult['overall'], number>> = Object.freeze({
  pass: 0,
  warn: 2,
  fail: 1,
});

export async function runDoctorCommand(opts: { text?: boolean }): Promise<void> {
  const result = await runDoctor();
  const body = opts.text ? renderDoctor(result) : JSON.stringify(result, null, 2);
  process.stdout.write(`${body}\n`);
  process.exit(DOCTOR_EXIT_CODES[result.overall]);
}
