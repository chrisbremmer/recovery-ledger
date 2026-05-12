// CLI `doctor` command shim (D-06 / D-11 — the one Gate-C-exempt CLI output
// point in the codebase). Per CLAUDE.md §Critical Rules, `process.stdout.write`
// is allowed only here; every other module routes output through Pino (stderr)
// or MCP JSON-RPC framing. ci-grep-gates.sh Gate C enforces this exclusively
// for `src/cli/commands/doctor.ts`.

import { renderDoctor } from '../../formatters/doctor.txt.js';
// MR-32: route CLI invocations through the Services composition root so
// the lite-hexagonal "CLI and MCP both consume the same Services surface"
// pattern (CLAUDE.md §Architecture) is real instead of aspirational. The
// MCP tool handler in src/mcp/tools/whoop-doctor.ts already calls
// `services.runDoctor(...)`; bringing the CLI in line means a future
// Phase 2 DB/HTTP injection lands in one place (createServices) instead
// of both transport shims.
import { createServices, type DoctorResult } from '../../services/index.js';

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
  try {
    const services = createServices();
    const result = await services.runDoctor();
    const body = opts.text ? renderDoctor(result) : JSON.stringify(result, null, 2);
    // MR-05: pass exit as the write callback so slow pipe consumers (e.g.,
    // `recovery-ledger doctor | (sleep 0.5; cat)`) get the full buffered
    // output before the process exits. `process.exit()` is synchronous and
    // does not flush stdio; writing to a pipe whose buffer is not fully
    // drained truncates the tail. The callback fires once the kernel has
    // accepted the bytes (or the write fails).
    process.stdout.write(`${body}\n`, () => {
      process.exit(DOCTOR_EXIT_CODES[result.overall]);
    });
  } catch (err) {
    // MR-08: runDoctor() should not reject after MR-07 (Promise.allSettled
    // synthesizes fail checks from probe rejections), but an outer guard is
    // cheap and prevents an unhandled rejection from escaping with no output
    // at all. JSON.stringify can also throw for cyclic or BigInt fields a
    // future probe might emit — we'd rather surface a one-line error than a
    // silent crash. CLI errors are NOT routed through the MCP sanitizer
    // (those rules apply to JSON-RPC framing); we use String(err) to avoid
    // leaking object internals while keeping the message intelligible.
    const message = String(err);
    const fallback = { checks: [], overall: 'fail' as const, error: message };
    const body = opts.text
      ? `[fail] cli — ${message}\noverall: fail`
      : JSON.stringify(fallback, null, 2);
    process.stdout.write(`${body}\n`, () => {
      process.exit(DOCTOR_EXIT_CODES.fail);
    });
  }
}
