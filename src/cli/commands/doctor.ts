// CLI `doctor` command shim (D-06 / D-11 — the one Gate-C-exempt CLI output
// point in the codebase). Per CLAUDE.md §Critical Rules, `process.stdout.write`
// is allowed only here; every other module routes output through Pino (stderr)
// or MCP JSON-RPC framing. ci-grep-gates.sh Gate C enforces this exclusively
// for `src/cli/commands/doctor.ts`.

import { renderDoctor } from '../../formatters/doctor.txt.js';
import { createLogger } from '../../infrastructure/config/logger.js';
// SECH-02 (#79): outer-catch sanitization parity with sync.ts/auth.ts/init.ts.
import { sanitize } from '../../infrastructure/observability/sanitize.js';
// MR-32: route CLI invocations through the Services composition root so
// the lite-hexagonal "CLI and MCP both consume the same Services surface"
// pattern (CLAUDE.md §Architecture) is real instead of aspirational. The
// MCP tool handler in src/mcp/tools/whoop-doctor.ts already calls
// `services.runDoctor(...)`.
//
// Plan 05-06: switched from createServices() (lightweight, no DB) to
// bootstrap() so the CLI exercises the full 14-check surface end-to-end
// (DOC-01). bootstrap() opens the DB + runs the migrator + constructs the
// repos + the production whoopFetcher, all of which runDoctor's db_* +
// recency + whoop_roundtrip probes consume. The createServices() path
// stays the no-DB surface for callers that only need the Phase 1+2 checks.
import { bootstrap, type DoctorResult } from '../../services/index.js';

// WR-06: exit-code map honors all three D-06 statuses. Reserved now per
// DOC-02 ("doctor emits structured exit codes that map to documented
// troubleshooting steps") so scripted wrappers (cron, launchd, CI) can
// distinguish warn from pass at the shell level. Exit 2 is the conventional
// POSIX "warning" code. Phase 5 D-04 locks the 0/1/2 floor as the v1
// contract; finer structure ships in the JSON `checks[].name` field (the
// troubleshooting map at docs/install/troubleshooting.md keys off that field).
export const DOCTOR_EXIT_CODES: Readonly<Record<DoctorResult['overall'], number>> = Object.freeze({
  pass: 0,
  warn: 2,
  fail: 1,
});

export async function runDoctorCommand(opts: {
  text?: boolean;
  offline?: boolean;
  stress?: boolean;
}): Promise<void> {
  // Plan 05-06: bootstrap() opens the DB + migrator + repos so runDoctor
  // runs the full 14-check surface. The handle MUST be released before
  // process.exit — process.exit() is synchronous and skips the normal
  // teardown, so we call close() inside the write callback (before exit)
  // on BOTH the success and the catch path. `close()` is idempotent.
  //
  // bootstrap() can THROW (DB-open failure, migration failure). It runs
  // INSIDE the try so such a failure surfaces through the MR-08 fallback
  // render rather than escaping as an unhandled rejection. `close` is a
  // no-op until bootstrap succeeds and assigns the real handle-releaser.
  let close: () => void = () => {};
  try {
    // Plan 05-06: pass a silent logger so bootstrap's routine
    // `migration_started` / `migration_finished` info lines do NOT land on
    // stderr during a `doctor` run. The doctor command's contract is a single
    // machine-readable payload (JSON on stdout / text via the renderer); a
    // consumer that merges streams (`doctor 2>&1 | jq`) must not have its JSON
    // corrupted by interleaved Pino log frames. Migration FAILURES still
    // throw — they surface through the MR-08 catch arm below, not as a log —
    // so silencing the info lines hides progress chatter only, never errors.
    const boot = bootstrap({ logger: createLogger({ LOG_LEVEL: 'silent' }) });
    close = boot.close;
    const { services } = boot;
    // Phase 5 D-03 + D-02 #9: thread the CLI flags into the doctor service.
    // `=== true` coercion turns an unset Commander flag (undefined) into a
    // consistent `false`. skipSubprocessChecks is NOT passed from the CLI
    // path — it is reserved for the MCP entry point per MR-14, so the
    // subprocess stdout-purity check still runs end-to-end from the CLI.
    // bootstrap() supplies the sqlite + repos + refreshOrchestrator +
    // whoopFetcher dep defaults; the CLI only threads the two user flags.
    const result = await services.runDoctor({
      offline: opts.offline === true,
      stress: opts.stress === true,
    });
    const body = opts.text ? renderDoctor(result) : JSON.stringify(result, null, 2);
    // MR-05: pass exit as the write callback so slow pipe consumers (e.g.,
    // `recovery-ledger doctor | (sleep 0.5; cat)`) get the full buffered
    // output before the process exits. `process.exit()` is synchronous and
    // does not flush stdio; writing to a pipe whose buffer is not fully
    // drained truncates the tail. The callback fires once the kernel has
    // accepted the bytes (or the write fails).
    process.stdout.write(`${body}\n`, () => {
      close();
      process.exit(DOCTOR_EXIT_CODES[result.overall]);
    });
  } catch (err) {
    // MR-08: runDoctor() should not reject after MR-07 (Promise.allSettled
    // synthesizes fail checks from probe rejections), but an outer guard is
    // cheap and prevents an unhandled rejection from escaping with no output
    // at all. JSON.stringify can also throw for cyclic or BigInt fields a
    // future probe might emit — we'd rather surface a one-line error than a
    // silent crash. SECH-02 (#79): wrap String(err) in sanitize() so a
    // bootstrap-time token leak in `err.message` (e.g. an underlying undici
    // body excerpt that surfaces a refresh_token) cannot reach stdout —
    // parity with sync.ts/auth.ts/init.ts outer catches.
    const message = sanitize(String(err));
    const fallback = { checks: [], overall: 'fail' as const, error: message };
    const body = opts.text
      ? `[fail] cli — ${message}\noverall: fail`
      : JSON.stringify(fallback, null, 2);
    process.stdout.write(`${body}\n`, () => {
      close();
      process.exit(DOCTOR_EXIT_CODES.fail);
    });
  }
}
