// CLI `auth` command shim (D-01 / D-08 / D-10 / D-11 — AUTH-02).
//
// Reads config.json (validated via the canonical ConfigSchema from
// src/infrastructure/config/schema.ts — DRY-fix per checker WARNING
// PLAN-05-DRY-VIOLATION), runs Plan 02-03's runOAuth, persists the
// resulting Tokens via Plan 02-02's tokenStore.write, then prints
// `Authorization complete.` to stdout.
//
// Flags:
//   --no-browser     skip browser open; runOAuth prints the URL to stderr
//                    (per D-08 — the user copies it into a browser)
//   --timeout <s>    override D-10's 5-minute default (seconds → ms)
//
// Env-var precedence (D-06): WHOOP_CLIENT_ID / WHOOP_CLIENT_SECRET, if
// set, override the values on disk. The auth code grant has no
// 401-reactive boundary so this module does NOT consume the refresh
// orchestrator — it imports infrastructure directly (corrected per
// checker WARNING PLAN-04-CIRCULAR-NOTE).
//
// Exit-code map covers all six FROZEN AuthError kinds — adding a seventh
// requires updating both this map and the formatAuthError switch.

import { readFile } from 'node:fs/promises';
import open from 'open';
import { paths } from '../../infrastructure/config/paths.js';
import { ConfigSchema } from '../../infrastructure/config/schema.js';
import { AuthError, formatAuthError } from '../../infrastructure/whoop/errors.js';
import { runOAuth } from '../../infrastructure/whoop/oauth.js';
import { tokenStore } from '../../infrastructure/whoop/token-store.js';

export const AUTH_EXIT_CODES: Readonly<Record<string, number>> = Object.freeze({
  success: 0,
  auth_missing: 1,
  auth_expired: 1,
  auth_state_mismatch: 1,
  auth_timeout: 1,
  auth_port_in_use: 1,
  refresh_failed: 1,
});

export async function runAuthCommand(opts: {
  noBrowser?: boolean;
  timeout?: number;
}): Promise<void> {
  try {
    // Read config (D-01) — Zod-validate via the canonical schema.
    let configText: string;
    try {
      configText = await readFile(paths.configFile, 'utf8');
    } catch (err) {
      if (isNotFound(err)) {
        const remediation = formatAuthError(new AuthError({ kind: 'auth_missing' }));
        process.stdout.write(`${remediation}\nRun \`recovery-ledger init\` first.\n`, () => {
          process.exit(AUTH_EXIT_CODES.auth_missing);
        });
        return;
      }
      throw err;
    }
    const config = ConfigSchema.parse(JSON.parse(configText));

    // D-06 env-var precedence.
    const clientId = process.env.WHOOP_CLIENT_ID ?? config.clientId;
    const clientSecret = process.env.WHOOP_CLIENT_SECRET ?? config.clientSecret;

    const tokens = await runOAuth({
      clientId,
      clientSecret,
      redirectPort: config.redirectPort,
      scopes: config.scopes,
      noBrowser: opts.noBrowser === true,
      timeoutMs: opts.timeout !== undefined ? opts.timeout * 1000 : undefined,
      openBrowser:
        opts.noBrowser === true
          ? undefined
          : async (url: string) => {
              await open(url);
            },
    });

    await tokenStore.write(tokens);
    process.stdout.write('Authorization complete.\n', () => {
      process.exit(AUTH_EXIT_CODES.success);
    });
  } catch (err) {
    // Duck-type AuthError detection: `instanceof AuthError` is unreliable
    // under Vitest's `vi.resetModules()` because two module-graph instances
    // of errors.ts produce different class identities for the same logical
    // type (see Plan 02-04 deviation 1 — planner-template note). Check the
    // structural shape instead: `name === 'AuthError'` AND `kind` is one
    // of the FROZEN six kinds. Production code only ever throws AuthError
    // from within this module graph, so the duck-type is safe; tests get
    // robust dispatch regardless of resetModules timing.
    if (isAuthErrorShape(err)) {
      const remediation = formatAuthError(err as AuthError);
      const code = AUTH_EXIT_CODES[(err as AuthError).kind] ?? 1;
      process.stdout.write(`${remediation}\n`, () => {
        process.exit(code);
      });
      return;
    }
    // Non-AuthError — never expose stack; use String(err) for a one-line
    // intelligible message.
    process.stdout.write(`auth failed: ${String(err)}\n`, () => {
      process.exit(1);
    });
  }
}

function isNotFound(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    (err as { code?: string }).code === 'ENOENT'
  );
}

const AUTH_ERROR_KINDS = new Set([
  'auth_missing',
  'auth_expired',
  'auth_state_mismatch',
  'auth_timeout',
  'auth_port_in_use',
  'refresh_failed',
]);

function isAuthErrorShape(err: unknown): boolean {
  if (typeof err !== 'object' || err === null) return false;
  const e = err as { name?: unknown; kind?: unknown };
  return e.name === 'AuthError' && typeof e.kind === 'string' && AUTH_ERROR_KINDS.has(e.kind);
}
