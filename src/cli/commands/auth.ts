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
import { z } from 'zod';
// ARCH-04 (#92): single canonical import path for AuthError + helpers.
import { AuthError, formatAuthError, isAuthError } from '../../domain/errors/auth.js';
// Phase 10 ARCH-01: `sanitize` lives in `src/domain/observability/` —
// pure string transforms, no I/O. The PLAN-03-CROSS-LAYER deferral noted
// in CR-04 was closed by relocating the module out of infrastructure into
// domain. `sanitize` is the single source of truth for secret-bearing
// pattern redaction (D-07 / Pitfall 17): a Zod or JSON.parse error raised
// inside the outer try wraps the offending value verbatim in its message;
// running `String(err)` through `sanitize()` is the last line of defense
// before that string lands on the user's terminal.
import { sanitize } from '../../domain/observability/sanitize.js';
import { paths } from '../../infrastructure/config/paths.js';
import { ConfigSchema } from '../../infrastructure/config/schema.js';
import { runOAuth } from '../../infrastructure/whoop/oauth.js';
import { createTokenStore } from '../../infrastructure/whoop/token-store.js';

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
  // Phase 10 ARCH-02 (#85) — Q7-RESOLVED: ADR-0002 §Enforcement requires
  // exactly one tokenStore per process for DB-coupled flows. The OAuth-
  // login command is the SOLE documented exception: it constructs its
  // own `createTokenStore()` directly because the login flow does not
  // bootstrap (no DB needed; routing it through `bootstrap()` would slow
  // login and surface migration errors during a DB-independent action).
  // See `agent_docs/decisions/0002-single-flight-oauth-refresh.md`
  // §Enforcement and 10-RESEARCH.md Q7-RESOLVED. Every other DB-coupled
  // flow pulls `tokenStore` off `bootstrap().services`.
  const tokenStore = createTokenStore();
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
    // Parse + Zod-validate config.json. ZodError's default formatter embeds
    // offending values (clientSecret, clientId) verbatim in error messages
    // (CR-04 / Pitfall 17). Map both shapes — ZodError and JSON.parse
    // SyntaxError — to a field-names-only remediation message mirroring
    // init.ts:94. NEVER let the raw err.message reach process.stdout.write:
    // the user pastes terminal output into bug reports and agent contexts.
    let config: z.infer<typeof ConfigSchema>;
    try {
      config = ConfigSchema.parse(JSON.parse(configText));
    } catch (parseErr) {
      const fields =
        parseErr instanceof z.ZodError
          ? parseErr.issues.map((i) => i.path.join('.')).join(', ')
          : 'config.json (not valid JSON)';
      process.stdout.write(
        `Invalid config (fields: ${fields}). Run \`recovery-ledger init\` to repair.\n`,
        () => {
          process.exit(AUTH_EXIT_CODES.auth_missing);
        },
      );
      return;
    }

    // D-06 env-var precedence.
    const clientId = process.env.WHOOP_CLIENT_ID ?? config.clientId;
    const clientSecret = process.env.WHOOP_CLIENT_SECRET ?? config.clientSecret;

    // exactOptionalPropertyTypes: RunOAuthOptions' optional fields are
    // `?: T` (not `?: T | undefined`), so omit them rather than passing
    // explicit `undefined`.
    const tokens = await runOAuth({
      clientId,
      clientSecret,
      redirectPort: config.redirectPort,
      scopes: config.scopes,
      noBrowser: opts.noBrowser === true,
      ...(opts.timeout !== undefined ? { timeoutMs: opts.timeout * 1000 } : {}),
      ...(opts.noBrowser === true
        ? {}
        : {
            openBrowser: async (url: string) => {
              await open(url);
            },
          }),
    });

    await tokenStore.write(tokens);
    process.stdout.write('Authorization complete.\n', () => {
      process.exit(AUTH_EXIT_CODES.success);
    });
  } catch (err) {
    // Use the shared `isAuthError` type guard from errors.ts. `instanceof
    // AuthError` is unreliable under Vitest's `vi.resetModules()`: two
    // module-graph instances of errors.ts produce different class
    // identities for the same logical type. The guard duck-types on
    // `name === 'AuthError'` + `kind` membership in AUTH_ERROR_KINDS.
    // AUTH_ERROR_KINDS is the same tuple AuthErrorKind is derived from,
    // so adding a kind there automatically extends both the type union
    // AND the guard -- the MR-21 forcing function (a new kind breaks
    // formatAuthError's exhaustive switch) is preserved end-to-end.
    if (isAuthError(err)) {
      const remediation = formatAuthError(err);
      const code = AUTH_EXIT_CODES[err.kind] ?? 1;
      process.stdout.write(`${remediation}\n`, () => {
        process.exit(code);
      });
      return;
    }
    // Non-AuthError — never expose stack; route String(err) through the
    // shared sanitizer (CR-04) so any token / client_secret / Bearer pattern
    // that leaked into err.message (e.g., from a future undici error body
    // surfacing) is redacted before the message lands on stdout. The
    // ZodError leak path (CR-04 primary) is already prefiltered above; the
    // sanitizer here is defense-in-depth against future non-AuthError shapes
    // that carry secret-bearing strings.
    process.stdout.write(`auth failed: ${sanitize(String(err))}\n`, () => {
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
