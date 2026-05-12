// Commander entry for `recovery-ledger` (FND-02 / FND-03).
//
// Wires the binary name, hardcoded 0.1.0 banner (Phase 1 — Open Question 2;
// Phase 2 will read from package.json once auth bumps the version), and the
// `doctor` subcommand with its `--text` flag. The subcommand action is
// imported as a named export from `./commands/doctor.js`; this file holds no
// business logic itself per the lite-hexagonal split (CLAUDE.md §Architecture).
//
// `await program.parseAsync(...)` is a top-level await — the binary is ESM
// (package.json `type: module`) targeting Node 22, so this is legal at module
// scope.

import { Command } from 'commander';
import { runDoctorCommand } from './commands/doctor.js';

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

await program.parseAsync(process.argv);
