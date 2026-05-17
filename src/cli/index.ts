// Commander entry for `recovery-ledger` (FND-02 / FND-03 + AUTH-01 / AUTH-02
// + SYNC-01 / SYNC-05).
//
// Wires the binary name, hardcoded 0.1.0 banner (Phase 1 — Open Question 2;
// Phase 2 will read from package.json once auth bumps the version), and the
// `doctor`, `init`, `auth`, `sync` subcommands. Each subcommand action is
// imported as a named export from `./commands/<name>.js`; this file holds
// no business logic itself per the lite-hexagonal split (CLAUDE.md
// §Architecture).
//
// Plan 03-12 (Phase 3 Wave 6): adds the `sync` subcommand wired against
// services.runSync via the bootstrap() composition root. Per D-33, this
// is the ONLY sync surface in Phase 3 — there is NO whoop_sync MCP tool
// landing this phase; Phase 4 adds a 5-line MCP shim over the same service.
//
// `buildProgram()` is exported so unit tests can construct a fresh
// Commander instance + drive `.parseAsync(...)` with synthetic argv (no
// process-level side effects). The binary entry calls it once at module
// scope; `await program.parseAsync(...)` is a top-level await — the binary
// is ESM (package.json `type: module`) targeting Node 22, so this is legal.

import { pathToFileURL } from 'node:url';
import { Command, InvalidArgumentError } from 'commander';
import { runAuthCommand } from './commands/auth.js';
import { runDoctorCommand } from './commands/doctor.js';
import { runInitCommand } from './commands/init.js';
import { runSyncCommand } from './commands/sync.js';

/**
 * Strict integer parser for Commander `.option(..., parser, default)`.
 * Commander hands the raw string + the previous value; we reject NaN
 * via InvalidArgumentError so Commander surfaces a clean error instead
 * of silently passing `NaN` through to the action handler.
 */
export function parseIntStrict(value: string, _prev: unknown): number {
  const n = Number.parseInt(value, 10);
  if (Number.isNaN(n)) {
    throw new InvalidArgumentError('expected an integer');
  }
  return n;
}

/**
 * Strict positive-day parser for `recovery-ledger sync --days <n>`. Rejects
 * non-integers, non-positive values, and absurd futures (>365 days). Surfaces
 * a clear error via Commander's standard invalid-argument path (exit 2)
 * instead of silently falling back to the default 7-day re-window deep
 * inside `computeWindow()` — the prior implementation parsed `-1` as
 * `Number.parseInt('-1') = -1`, then `computeWindow` treated `flagDaysN <= 0`
 * as fall-through, silently dropping the user's flag.
 */
export function parseDaysFlag(value: string, _prev: unknown): number {
  const n = Number.parseInt(value, 10);
  if (Number.isNaN(n) || !Number.isFinite(n)) {
    throw new InvalidArgumentError('expected an integer');
  }
  if (n <= 0) {
    throw new InvalidArgumentError('expected a positive integer (e.g., --days 7)');
  }
  if (n > 365) {
    throw new InvalidArgumentError('value too large (max 365)');
  }
  return n;
}

export function buildProgram(): Command {
  const program = new Command();
  program
    .name('recovery-ledger')
    .version('0.1.0')
    .description('Local-first WHOOP review + decision ledger');

  program
    .command('doctor')
    .description('Run diagnostic checks')
    .option('--text', 'render plaintext instead of JSON')
    // MR-22: surface the exit-code contract under `--help` so scripted
    // wrappers (cron, launchd, CI) know how to react to each status without
    // reading source. Mirrors DOCTOR_EXIT_CODES in src/cli/commands/doctor.ts.
    .addHelpText(
      'after',
      [
        '',
        'Exit codes:',
        '  0  pass  — all checks healthy',
        '  1  fail  — one or more checks failed',
        '  2  warn  — one or more checks emitted a warning (POSIX convention)',
      ].join('\n'),
    )
    .action(runDoctorCommand);

  program
    .command('init')
    .description('Bootstrap ~/.recovery-ledger/config.json (WHOOP OAuth credentials)')
    .addHelpText(
      'after',
      [
        '',
        'Env-var precedence (D-06):',
        '  WHOOP_CLIENT_ID, WHOOP_CLIENT_SECRET — when both are set, skip prompts.',
        '',
        'Exit codes:',
        '  0  success — config written, mode 0600',
        '  1  failure — invalid input or write failed',
      ].join('\n'),
    )
    .action(runInitCommand);

  program
    .command('auth')
    .description('Run WHOOP OAuth flow and persist tokens')
    .option('--no-browser', 'print the authorize URL to stderr instead of opening a browser')
    .option('--timeout <seconds>', 'override the 5-minute callback timeout', (v) => parseInt(v, 10))
    .addHelpText(
      'after',
      [
        '',
        'Exit codes:',
        '  0  success                  — tokens written to keychain or ~/.recovery-ledger/tokens.json',
        '  1  auth_missing             — config.json missing; run `recovery-ledger init` first',
        '  1  auth_expired             — token refresh failed; re-run to re-authorize',
        '  1  auth_state_mismatch      — possible CSRF; retry from a fresh shell',
        '  1  auth_timeout             — callback did not arrive within timeout window',
        '  1  auth_port_in_use         — loopback port in use; pick another via `recovery-ledger init`',
        '  1  refresh_failed           — WHOOP token endpoint rejected the exchange',
      ].join('\n'),
    )
    .action(runAuthCommand);

  // `sync` subcommand (D-26). Three flags only per the SYNC-01
  // configuration-knobs surface: --days (default 30), --since (ISO 8601),
  // --resources (comma-separated subset). Action is the ≤5-line shim in
  // src/cli/commands/sync.ts.
  program
    .command('sync')
    .description('Sync WHOOP data into the local cache')
    .option('--days <n>', 'window in days (default 30, max 365)', parseDaysFlag, 30)
    .option('--since <iso>', 'backfill from this ISO 8601 date (overrides --days)')
    .option(
      '--resources <list>',
      'comma-separated subset of: cycles,recoveries,sleeps,workouts,profile,body_measurements',
    )
    .addHelpText(
      'after',
      [
        '',
        'Exit codes:',
        '  0  ok      — sync succeeded across all requested resources',
        '  0  partial — soft success; per-resource lines flag the issue (e.g., rate-limit, 5xx retry)',
        '  1  failed  — sync failed / invalid input / bootstrap error',
        '',
        'Examples:',
        '  recovery-ledger sync',
        '  recovery-ledger sync --days 7',
        '  recovery-ledger sync --resources cycles,recoveries',
      ].join('\n'),
    )
    .action(runSyncCommand);

  return program;
}

// Module-load top-level await runs the binary ONLY when this module is
// invoked as the process entry point (i.e., `node src/cli/index.ts` or
// `node dist/cli.mjs`). Tests that import { buildProgram } from this
// module re-enter via the ESM loader with a different argv[1], so the
// guard skips parseAsync — fresh Commander instances under test do not
// pollute process state at import time.
//
// Comparison uses pathToFileURL so the `file://` scheme on both sides is
// byte-identical regardless of OS path style (#3299: forward vs backward
// slashes on Windows would otherwise miscompare even when the underlying
// path is the same).
if (
  typeof process.argv[1] === 'string' &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  await buildProgram().parseAsync(process.argv);
}
