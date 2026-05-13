// CLI `init` command shim (D-01 / D-02 / D-06 — AUTH-01).
//
// Writes ~/.recovery-ledger/config.json mode 0600 from interactive prompts
// (or from WHOOP_CLIENT_ID/WHOOP_CLIENT_SECRET env vars when both are
// present — D-06 env-var precedence; Specifics line 163). Idempotent: two
// runs with the same inputs produce the same file bytes.
//
// D-02: before prompting, prints the WHOOP developer-portal URL, the
// constructed loopback redirect URI, and the D-13 scope set so the user
// can configure their WHOOP app in parallel.
//
// Canonical ConfigSchema + D13_SCOPES live in
// src/infrastructure/config/schema.ts (Plan 02-01 — DRY-fix per checker
// WARNING PLAN-05-DRY-VIOLATION). This module imports both; it does NOT
// redefine its own Zod schema.
//
// Per ADR-0001 the CLI surface is the one place stdout writes are
// allowed. Gate C in scripts/ci-grep-gates.sh permits process.stdout.write
// from any file under src/cli/commands/.

import { mkdir, open, rename } from 'node:fs/promises';
import { createInterface } from 'node:readline/promises';
import { paths } from '../../infrastructure/config/paths.js';
import { ConfigSchema, D13_SCOPES, type InitConfig } from '../../infrastructure/config/schema.js';

export type { InitConfig } from '../../infrastructure/config/schema.js';

export const INIT_EXIT_CODES: Readonly<Record<string, number>> = Object.freeze({
  success: 0,
  invalid_input: 1,
  write_failed: 1,
});

const D02_INSTRUCTIONS = (port: number): string =>
  [
    'Recovery Ledger uses a WHOOP developer app for BYO OAuth.',
    '',
    '1. Create a WHOOP app:    https://developer.whoop.com/dashboard/applications',
    `2. Redirect URI:          http://127.0.0.1:${port}/callback`,
    '3. Scopes Recovery Ledger will request:',
    `   ${D13_SCOPES.join(' ')}`,
    '',
  ].join('\n');

export async function runInitCommand(_opts: Record<string, unknown>): Promise<void> {
  try {
    const envClientId = process.env.WHOOP_CLIENT_ID;
    const envClientSecret = process.env.WHOOP_CLIENT_SECRET;

    let clientId: string;
    let clientSecret: string;
    let redirectPort = 4321;

    if (envClientId !== undefined && envClientSecret !== undefined) {
      // D-06 env-var precedence: non-interactive arm.
      clientId = envClientId;
      clientSecret = envClientSecret;
    } else {
      // Prompt arm — print D-02 instructions BEFORE asking.
      process.stdout.write(D02_INSTRUCTIONS(redirectPort));
      const rl = createInterface({ input: process.stdin, output: process.stdout });
      try {
        clientId = envClientId ?? (await rl.question('WHOOP client_id: '));
        clientSecret = envClientSecret ?? (await rl.question('WHOOP client_secret: '));
        const portInput = (await rl.question(`Redirect port [${redirectPort}]: `)).trim();
        if (portInput.length > 0) {
          // Validate via the canonical schema's redirectPort rule so the
          // rule lives in exactly one place (DRY-fix).
          const parsed = ConfigSchema.shape.redirectPort.safeParse(Number(portInput));
          if (!parsed.success) {
            process.stdout.write('Invalid port — must be a positive integer.\n', () => {
              process.exit(INIT_EXIT_CODES.invalid_input);
            });
            return;
          }
          redirectPort = parsed.data;
        }
      } finally {
        rl.close();
      }
    }

    const candidate = {
      clientId,
      clientSecret,
      redirectPort,
      scopes: Array.from(D13_SCOPES),
    };

    const parsed = ConfigSchema.safeParse(candidate);
    if (!parsed.success) {
      // Defense-in-depth: do NOT echo the bad input back. Emit a
      // field-name-only remediation message.
      const fieldNames = parsed.error.issues.map((i) => i.path.join('.')).join(', ');
      process.stdout.write(`Invalid config (fields: ${fieldNames}). See schema.\n`, () => {
        process.exit(INIT_EXIT_CODES.invalid_input);
      });
      return;
    }
    const config: InitConfig = parsed.data;

    await mkdir(paths.configDir, { recursive: true, mode: 0o700 });
    await writeConfigAtomic(paths.configFile, config);

    process.stdout.write(
      `Config written to ${paths.configFile}.\nNext: recovery-ledger auth\n`,
      () => {
        process.exit(INIT_EXIT_CODES.success);
      },
    );
  } catch (err) {
    // Outer guard — never expose stack. CLI errors are NOT routed through
    // the MCP sanitizer (those rules apply to JSON-RPC framing); String(err)
    // keeps the message intelligible without leaking object internals.
    process.stdout.write(`init failed: ${String(err)}\n`, () => {
      process.exit(INIT_EXIT_CODES.write_failed);
    });
  }
}

async function writeConfigAtomic(target: string, config: InitConfig): Promise<void> {
  const tmp = `${target}.tmp`;
  const fd = await open(tmp, 'w', 0o600);
  try {
    await fd.writeFile(`${JSON.stringify(config, null, 2)}\n`);
    await fd.sync();
  } finally {
    await fd.close();
  }
  await rename(tmp, target);
}
