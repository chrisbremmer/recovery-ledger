// Commander entry for `recovery-ledger` (FND-02 / FND-03 + AUTH-01 / AUTH-02).
//
// Wires the binary name, hardcoded 0.1.0 banner (Phase 1 — Open Question 2;
// Phase 2 will read from package.json once auth bumps the version), and the
// `doctor`, `init`, `auth` subcommands. Each subcommand action is imported
// as a named export from `./commands/<name>.js`; this file holds no business
// logic itself per the lite-hexagonal split (CLAUDE.md §Architecture).
//
// `await program.parseAsync(...)` is a top-level await — the binary is ESM
// (package.json `type: module`) targeting Node 22, so this is legal at module
// scope.

import { Command } from 'commander';
import { runAuthCommand } from './commands/auth.js';
import { runDoctorCommand } from './commands/doctor.js';
import { runInitCommand } from './commands/init.js';

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

await program.parseAsync(process.argv);
