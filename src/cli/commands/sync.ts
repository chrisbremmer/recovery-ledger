// CLI `sync` command shim (D-26).
//
// Per ARCHITECTURE.md "lite hexagonal" + the auth.ts precedent: this file
// is a ≤5-line orchestration shim over
//   bootstrap() → services.runSync() → formatSyncResult() → stdout → exit(code).
// Validation + sanitization arms add file weight but the core composition
// stays ≤5 lines per CLI policy.
//
// ADR-0001: this file lives under src/cli/commands/, so Gate B exempts
// it from the console.* prohibition and Gate C exempts it from the
// process.stdout.write prohibition. Output goes to stdout via
// process.stdout.write; structured operational logging continues to flow
// through Pino → stderr inside services.runSync(). No direct console
// calls here either — Gate B's exemption is a license, not an instruction.
//
// Exit codes (mirrors Plan 02-05 AUTH_EXIT_CODES Object.freeze pattern):
//   ok                = 0   run succeeded across all requested resources
//   partial           = 0   SOFT success — per-resource lines flag the issue
//                            (rate-limit or 5xx mid-pagination, etc.). T-03.12-04:
//                            a successful-but-partial run MUST exit 0 so cron
//                            wrappers do not page on routine WHOOP backoff.
//   failed            = 1   HARD failure — no resources landed
//   invalid_input     = 1   --resources contained an unknown token or --since
//                            was not parseable as ISO 8601
//   bootstrap_failed  = 1   openDb or migrate threw before sync started

import { RESOURCE_NAMES_SET, type ResourceName } from '../../domain/types/sync.js';
import { formatBootstrapError, formatSyncResult } from '../../formatters/sync.txt.js';
import { paths } from '../../infrastructure/config/paths.js';
import { isMigrationError } from '../../infrastructure/db/migrate.js';
import {
  formatAuthError,
  formatWhoopApiError,
  isAuthError,
  isWhoopApiError,
} from '../../infrastructure/whoop/errors.js';
// Cross-layer import: src/mcp/sanitize.ts is the single source of truth for
// secret-bearing pattern redaction. Mirrors the auth.ts cross-layer import.
import { sanitize } from '../../mcp/sanitize.js';
import { type Bootstrapped, bootstrap } from '../../services/index.js';

export const SYNC_EXIT_CODES: Readonly<Record<string, number>> = Object.freeze({
  ok: 0,
  // T-03.12-04: partial is a SOFT success — per-resource lines flag the
  // issue. Conflating partial with failed would page cron on routine WHOOP
  // 429 backoff. Tests in sync.test.ts pin this contract.
  partial: 0,
  failed: 1,
  invalid_input: 1,
  bootstrap_failed: 1,
});

export interface RunSyncCommandOpts {
  /** Commander parses --days <n> via parseIntStrict; the action receives a
   *  number when the flag was provided, otherwise undefined (default is
   *  applied at the Commander layer via `.option(..., 30)`). */
  days?: number;
  /** Raw ISO-8601-ish string. Validation happens inside runSyncCommand;
   *  Commander hands the string through unchanged. */
  since?: string;
  /** Raw comma-separated string. The action splits + validates against
   *  RESOURCE_NAMES_SET; rejected here, not at the Commander parser, so the
   *  user sees a sanitized stdout message rather than a Commander stack
   *  trace. */
  resources?: string;
}

/**
 * Validate --resources tokens against the canonical RESOURCE_NAMES_SET
 * (D-26 + Plan 03-04). Returns `{ok: true, value}` on success, or
 * `{ok: false, message}` with a sanitized error string on failure. The
 * caller wires the failure arm to stdout + exit(invalid_input).
 *
 * T-03.12-02: rejecting unknown tokens at the CLI boundary surfaces typos
 * before bootstrap opens the DB. Faster feedback + fewer wasted DB opens.
 */
function parseResourcesFlag(
  raw: string | undefined,
): { ok: true; value: readonly ResourceName[] | undefined } | { ok: false; message: string } {
  if (raw === undefined || raw.trim() === '') return { ok: true, value: undefined };
  const tokens = raw.split(',').map((s) => s.trim());
  // Reject empty tokens (e.g., `--resources cycles,,recoveries` or a trailing
  // comma `cycles,`) — silently dropping them masks a typo, and surfacing the
  // empty-token form keeps the error message specific instead of complaining
  // about an unknown blank.
  if (tokens.some((t) => t.length === 0)) {
    return {
      ok: false,
      message: `Invalid --resources value: empty token between commas (check for ',,' or a trailing comma).`,
    };
  }
  const unknown = tokens.filter((t) => !isResourceName(t));
  if (unknown.length > 0) {
    return {
      ok: false,
      message: `Invalid --resources tokens: ${unknown.join(', ')}. Allowed: cycles,recoveries,sleeps,workouts,profile,body_measurements.`,
    };
  }
  // Type-predicate filter narrows tokens to ResourceName[] — no cast.
  const valid: ResourceName[] = tokens.filter(isResourceName);
  return { ok: true, value: valid };
}

/** Type-predicate membership check against RESOURCE_NAMES_SET. Replaces the
 *  prior `tokens as readonly ResourceName[]` cast with a narrowing helper. */
function isResourceName(token: string): token is ResourceName {
  return RESOURCE_NAMES_SET.has(token);
}

/**
 * Validate --since as ISO 8601 (T-03.12-03). Date.parse + isNaN check is
 * the cheapest gate that catches the obvious failure modes (`not-a-date`,
 * `2026-13-99`, empty string). The WHOOP HTTP client would otherwise
 * surface this as a 400 several layers in.
 */
function parseSinceFlag(raw: string | undefined): { ok: true } | { ok: false; message: string } {
  if (raw === undefined) return { ok: true };
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) {
    return { ok: false, message: `Invalid --since value: not parseable as ISO 8601.` };
  }
  // A --since in the future produces a window where since > until — the
  // resource pages return zero rows and the run silently looks like a no-op.
  // Reject at the CLI boundary so the user sees what is actually wrong.
  if (parsed.getTime() > Date.now()) {
    return {
      ok: false,
      message: `Invalid --since value: ${raw} is in the future (since must be ≤ now).`,
    };
  }
  return { ok: true };
}

/**
 * The ≤5-line orchestration shim per D-26 + ARCHITECTURE.md CLI policy:
 *   1. validate input → exit invalid_input on failure
 *   2. bootstrap()     → exit bootstrap_failed on MigrationError
 *   3. services.runSync()
 *   4. formatSyncResult() + process.stdout.write
 *   5. process.exit(SYNC_EXIT_CODES[result.status])
 *
 * The function body weighs more than 5 lines because of the catch arms +
 * sanitization wiring (mirrors Plan 02-05 auth.ts at ~150 LOC). The CORE
 * composition — bootstrap, runSync, format, write, exit — is 5 lines.
 */
export async function runSyncCommand(opts: RunSyncCommandOpts): Promise<void> {
  // 1. Validate --resources (T-03.12-02).
  const parsedResources = parseResourcesFlag(opts.resources);
  if (!parsedResources.ok) {
    process.stdout.write(`${sanitize(parsedResources.message)}\n`, () => {
      process.exit(SYNC_EXIT_CODES.invalid_input);
    });
    return;
  }

  // 2. Validate --since (T-03.12-03).
  const parsedSince = parseSinceFlag(opts.since);
  if (!parsedSince.ok) {
    process.stdout.write(`${sanitize(parsedSince.message)}\n`, () => {
      process.exit(SYNC_EXIT_CODES.invalid_input);
    });
    return;
  }

  // 3. Bootstrap (open DB + run migrator). MigrationError is the typed
  // failure shape; surface via formatBootstrapError which includes the
  // `cp <backupPath>` remediation per D-08.
  let app: Bootstrapped;
  try {
    app = bootstrap();
  } catch (err) {
    const body = isMigrationError(err)
      ? formatBootstrapError(err, paths.dbFile)
      : `Bootstrap failed: ${sanitize(String(err))}`;
    process.stdout.write(`${body}\n`, () => {
      process.exit(SYNC_EXIT_CODES.bootstrap_failed);
    });
    return;
  }

  // 4. Run sync. AuthError + WhoopApiError have typed formatters; unknown
  // errors flow through sanitize() (T-03.12-01: any token / Bearer / JWT
  // pattern that leaked into err.message is redacted before stdout).
  try {
    const result = await app.services.runSync({
      days: opts.days ?? 30,
      ...(opts.since !== undefined && { since: opts.since }),
      ...(parsedResources.value !== undefined && { resources: parsedResources.value }),
    });
    // 5. Format + write + exit. The write callback ensures the stdio
    // buffer flushes before process.exit (Plan 01-06 / Plan 02-05
    // precedent — slow pipe consumers truncate on synchronous exit).
    const body = formatSyncResult(result);
    process.stdout.write(`${body}\n`, () => {
      app.close();
      process.exit(SYNC_EXIT_CODES[result.status] ?? SYNC_EXIT_CODES.failed);
    });
  } catch (err) {
    app.close();
    const body = isAuthError(err)
      ? formatAuthError(err)
      : isWhoopApiError(err)
        ? formatWhoopApiError(err)
        : `Sync failed: ${sanitize(String(err))}`;
    process.stdout.write(`${body}\n`, () => {
      process.exit(SYNC_EXIT_CODES.failed);
    });
  }
}
