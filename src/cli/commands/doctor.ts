// CLI `doctor` command shim (D-06 / D-11 — the one Gate-C-exempt CLI output
// point in the codebase). Per CLAUDE.md §Critical Rules, `process.stdout.write`
// is allowed only here; every other module routes output through Pino (stderr)
// or MCP JSON-RPC framing. ci-grep-gates.sh Gate C enforces this exclusively
// for `src/cli/commands/doctor.ts`.

import { renderDoctor } from '../../formatters/doctor.txt.js';
import { runDoctor } from '../../services/doctor/index.js';

export async function runDoctorCommand(opts: { text?: boolean }): Promise<void> {
  const result = await runDoctor();
  const body = opts.text ? renderDoctor(result) : JSON.stringify(result, null, 2);
  process.stdout.write(`${body}\n`);
  process.exit(result.overall === 'fail' ? 1 : 0);
}
