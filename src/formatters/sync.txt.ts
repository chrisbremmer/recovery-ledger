// Sync result formatter — structured RunSyncResult → compact text
// (Plan 03-12 Task 2; E2 + REV-08 + ADR-0005 + D-08).
//
// Pure function — no I/O, no logger, no DB, no Date.now(). The caller
// decides where the string goes (CLI: process.stdout.write; future Phase 4
// MCP tool: structuredContent.content[0].text). This is the reusability
// seam that lets the same formatter serve both transports per
// ARCHITECTURE.md "lite hexagonal" + ADR-0001 (MCP stdout purity — the
// formatter NEVER writes; the caller decides).
//
// Tone: ADR-0005 banned-tone-word list applies (see agent_docs/decisions/
// 0005-banned-tone-words.md for the canonical list). The formatter output
// MUST stay free of every word in that list plus emoji. Test 7 in
// sync.txt.test.ts iterates the full list against the formatter output;
// Gate A on the source file is the CI second layer.
//
// Output shape (one line per resource + footer):
//   Status: ok | partial | failed
//   cycles               success         fetched=42 upserted=42 dur=120ms
//   recoveries           success         fetched=42 upserted=42 dur=180ms
//   workouts             partial_429     fetched=10 upserted=10 dur=2400ms (rate-limited; retried)
//   ...
//   --
//   syncRunId: 17  gapsDetected: 0
//
// Padding (resource name to 20, status to 15) keeps columns aligned for
// `body_measurements` (16 chars) + `partial_429` (11 chars). Wider future
// resources would re-pad — but D-23 freezes the 6-resource tuple, so the
// constants are stable.
//
// Gate G compliance: this file imports zero drizzle-orm symbols. It
// consumes domain types (RunSyncResult, ResourceSyncOutcome) only.

import {
  RESOURCES,
  type ResourceName,
  type ResourceSyncOutcome,
  type ResourceSyncStatus,
  type RunSyncResult,
} from '../domain/types/sync.js';
import type { MigrationError } from '../infrastructure/db/migrate.js';
import { formatAuthError, isAuthError } from '../infrastructure/whoop/errors.js';

const RESOURCE_COL_WIDTH = 20;
const STATUS_COL_WIDTH = 15;

/**
 * Per-status remediation suffix — verb-first, no banned tone words.
 * `success` and `skipped` add nothing; `partial_*` + `failed_*` surface a
 * short clue so the user knows whether to wait (rate-limited; retried),
 * re-auth (run `recovery-ledger auth`), or check the network.
 *
 * Exhaustive switch — adding a seventh ResourceSyncStatus kind to
 * src/domain/types/sync.ts will break this at compile time, the MR-21
 * forcing-function pattern from src/infrastructure/whoop/errors.ts.
 */
function statusSuffix(status: ResourceSyncStatus): string {
  switch (status) {
    case 'success':
      return '';
    case 'skipped':
      return '';
    case 'partial_429':
      return ' (rate-limited; retried)';
    case 'partial_5xx':
      return ' (server error; retried)';
    case 'failed_auth':
      return ' (run `recovery-ledger auth`)';
    case 'failed_network':
      return ' (check network and re-run)';
    case 'failed_db':
      return ' (database write rejected; see logs)';
    case 'failed_parse':
      return ' (WHOOP response did not match the expected shape)';
    case 'failed_unknown':
      return ' (unknown error; see logs)';
  }
}

function formatOutcomeLine(resource: ResourceName, outcome: ResourceSyncOutcome): string {
  const name = resource.padEnd(RESOURCE_COL_WIDTH);
  const status = outcome.status.padEnd(STATUS_COL_WIDTH);
  const fetched = outcome.fetched ?? 0;
  const upserted = outcome.upserted ?? 0;
  const parts: string[] = [`fetched=${fetched}`, `upserted=${upserted}`];
  if (outcome.errors !== undefined && outcome.errors > 0) {
    parts.push(`errors=${outcome.errors}`);
  }
  if (outcome.durationMs !== undefined) {
    parts.push(`dur=${outcome.durationMs}ms`);
  }
  return `${name}${status}${parts.join(' ')}${statusSuffix(outcome.status)}`;
}

/**
 * Render a RunSyncResult into the compact one-line-per-resource form.
 * Order: iterate the keys of `result.perResource` (orchestrator inserts in
 * canonical D-23 order: profile → body_measurements → cycles → recoveries
 * → sleeps → workouts).
 */
export function formatSyncResult(result: RunSyncResult): string {
  const lines: string[] = [`Status: ${result.status}`];
  // Iterate the canonical RESOURCES tuple so the output order is fixed at
  // compile time (no reliance on the runtime key order of perResource).
  for (const resource of RESOURCES) {
    const outcome = result.perResource[resource];
    lines.push(formatOutcomeLine(resource, outcome));
  }
  lines.push('--');
  lines.push(`syncRunId: ${result.syncRunId}  gapsDetected: ${result.gapsDetected}`);
  return lines.join('\n');
}

/**
 * Render a bootstrap failure (D-08 surface): the user-facing string that
 * accompanies a non-zero exit code from `runSyncCommand` when bootstrap
 * threw. Three arms:
 *
 *   - MigrationError({inconsistent_state, backupPath, latestSafeMigration})
 *     → multi-line message with the `cp <backupPath> <dbFile>` remediation
 *     per D-08. NO auto-restore — the decisions table is irreplaceable.
 *   - MigrationError({apply_failed, backupPath, latestSafeMigration})
 *     → similar shape; the WAL already rolled back at the BEGIN IMMEDIATE
 *     boundary so the DB is consistent but the schema is stale. Surfacing
 *     the backup path lets the user inspect what landed before the apply
 *     threw.
 *   - AuthError → defer to existing formatAuthError; bootstrap can throw
 *     AuthError indirectly if a Phase-2-vintage path calls into the token
 *     store at composition time (not currently the case in Plan 03-11's
 *     bootstrap() but kept as defense-in-depth for Phase 4 extensions).
 *
 * Sanitization is NOT inlined here — the formatter stays pure. The CLI
 * caller (sync.ts) routes unknown errors through `sanitize()` before
 * calling this; sanitize is imported there, not here.
 */
export function formatBootstrapError(err: unknown, dbFile: string): string {
  if (isMigrationErrorShape(err)) {
    const lines = [
      `Bootstrap failed: migration ${err.kind === 'inconsistent_state' ? 'state inconsistency' : 'apply failed'}.`,
    ];
    if (err.latestSafeMigration !== null) {
      lines.push(`Latest safe migration: ${err.latestSafeMigration}.`);
    }
    if (err.backupPath !== null) {
      lines.push('');
      lines.push('Restore the most-recent pre-migration backup manually:');
      lines.push(`  cp ${err.backupPath} ${dbFile}`);
      lines.push('');
      lines.push('Recovery Ledger does not auto-restore — the decisions ledger is irreplaceable.');
    } else {
      lines.push('No pre-migration backup was taken (first migration on a fresh database).');
    }
    return lines.join('\n');
  }
  if (isAuthError(err)) {
    return `Bootstrap failed: ${formatAuthError(err)}`;
  }
  // Unknown error shape — pass back the bare message; the CLI shim runs
  // sanitize() at the boundary.
  const message = err instanceof Error ? err.message : String(err);
  return `Bootstrap failed: ${message}`;
}

/**
 * Local duck-type guard for MigrationError. Mirrors isMigrationError() in
 * src/infrastructure/db/migrate.ts but is inlined here so the formatter
 * does NOT pull in the migrator's module graph (Gate G + Anti-Pattern 3:
 * the formatter is pure-functional and stays free of infrastructure
 * imports). The guard checks `name === 'MigrationError'` plus the load-
 * bearing fields the formatter reads (kind, backupPath, latestSafeMigration).
 */
function isMigrationErrorShape(err: unknown): err is MigrationError {
  if (typeof err !== 'object' || err === null) return false;
  const e = err as {
    name?: unknown;
    kind?: unknown;
    backupPath?: unknown;
    latestSafeMigration?: unknown;
  };
  return (
    e.name === 'MigrationError' &&
    typeof e.kind === 'string' &&
    (e.kind === 'inconsistent_state' || e.kind === 'apply_failed') &&
    (e.backupPath === null || typeof e.backupPath === 'string') &&
    (e.latestSafeMigration === null || typeof e.latestSafeMigration === 'string')
  );
}
