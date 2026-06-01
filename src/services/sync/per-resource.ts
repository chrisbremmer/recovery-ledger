// Per-resource pipeline helpers — D-25 outcome classifier + D-24 status
// aggregator. Extracted from sync/index.ts so the orchestrator stays a thin
// loop and the two pure functions are independently unit-testable (Pattern 6
// + the MR-21 forcing-function shape).
//
// `classifyOutcome(err)` maps an unknown throwable to a `ResourceSyncOutcome`
// per D-25:
//   - AuthError                → 'failed_auth'
//   - WhoopApiError.rate_limited → 'partial_429'
//   - WhoopApiError.server       → 'partial_5xx'
//   - WhoopApiError.validation   → 'partial_5xx' (unexpected wire-format is
//                                   treated as a server bug — the WHOOP
//                                   response cannot be trusted, but the
//                                   sync run can still record what it got)
//   - WhoopApiError.network      → 'failed_network'
//   - WhoopApiError.unauthorized → 'failed_auth' (defensive — should be
//                                   wrapped as AuthError before reaching
//                                   here per Plan 02-04 refresh-orchestrator)
//   - WhoopApiError.unknown      → 'failed_network'
//   - any other throwable        → 'failed_network'
//
// `computeStatus(perResource, requested)` rolls up the per-resource outcomes
// into the run-level `RunSyncStatus` per D-24:
//   - All success/skipped → 'ok'
//   - Some success + some failure → 'partial'
//   - No success at all → 'failed'
//
// ADR-0001: no console.*, no process.stdout.write. Pure functions; the
// orchestrator (sync/index.ts) owns logging via Pino → stderr.

import { ZodError } from 'zod';
// ARCH-04 (#92): AuthError helpers from domain; WhoopApiError helper stays
// in infrastructure.
import { isAuthError } from '../../domain/errors/auth.js';
import type { ResourceName, ResourceSyncOutcome, RunSyncStatus } from '../../domain/types/sync.js';
import { isWhoopApiError } from '../../infrastructure/whoop/errors.js';

/**
 * Classify a thrown error from a per-resource pipeline into a D-25
 * `ResourceSyncOutcome`. The `fetched`/`upserted` counts are not set here
 * (the catch site adds `durationMs` after the fact); we set `errors: 1`.
 */
export function classifyOutcome(err: unknown): ResourceSyncOutcome {
  if (isAuthError(err)) {
    return { status: 'failed_auth', errors: 1 };
  }
  if (isWhoopApiError(err)) {
    switch (err.kind) {
      case 'rate_limited':
        return { status: 'partial_429', errors: 1 };
      case 'server':
        return { status: 'partial_5xx', errors: 1 };
      case 'validation':
        // Unexpected wire-format. Treat like a server bug: the sync run
        // records the failure but can proceed with other resources. The
        // raw Zod error is preserved in the WhoopApiError.cause chain
        // for downstream sanitization at the MCP boundary (D-34).
        return { status: 'partial_5xx', errors: 1 };
      case 'network':
        return { status: 'failed_network', errors: 1 };
      case 'unauthorized':
        // Defensive — Plan 02-04's refresh-orchestrator wraps 401s as
        // AuthError. A WhoopApiError({kind: 'unauthorized'}) reaching
        // here means the wrap was bypassed; surface as failed_auth so
        // the run-level rollup is consistent.
        return { status: 'failed_auth', errors: 1 };
      case 'unknown':
        return { status: 'failed_network', errors: 1 };
    }
  }
  // Catch-all for any throwable that is neither AuthError nor
  // WhoopApiError. Inspect the error shape before defaulting:
  //   - better-sqlite3 SqliteError (.code starts with 'SQLITE_') → failed_db
  //   - ZodError or TypeError from a normalizer            → failed_parse
  //   - anything else                                      → failed_unknown
  if (isSqliteError(err)) {
    return { status: 'failed_db', errors: 1 };
  }
  if (err instanceof ZodError || err instanceof TypeError) {
    return { status: 'failed_parse', errors: 1 };
  }
  return { status: 'failed_unknown', errors: 1 };
}

/** Duck-type check for better-sqlite3's SqliteError — a vanilla `Error`
 *  subclass with `.code` set to a `SQLITE_*` constant. Avoids importing
 *  better-sqlite3 into the domain layer just for `instanceof` semantics. */
function isSqliteError(err: unknown): boolean {
  if (typeof err !== 'object' || err === null) return false;
  const code = (err as { code?: unknown }).code;
  return typeof code === 'string' && code.startsWith('SQLITE_');
}

/**
 * Roll up per-resource outcomes into the D-24 run-level status. Only counts
 * outcomes for `requested` resources — resources excluded by `--resources`
 * land as `'skipped'` and count as a non-failure but also non-success.
 *
 * Rules:
 *   - Every outcome is `'success'` or `'skipped'`  → 'ok'
 *   - At least one `'success'` + at least one non-success non-skipped → 'partial'
 *   - No `'success'` at all (only failures + skips) → 'failed'
 *
 * The boundary between 'partial' and 'failed' is whether ANY resource
 * succeeded. A run where every requested resource failed is 'failed'
 * regardless of how many resources were requested. A run with at least
 * one success and at least one failure is 'partial'.
 */
export function computeStatus(
  perResource: Record<ResourceName, ResourceSyncOutcome>,
  requested: ReadonlyArray<ResourceName>,
): RunSyncStatus {
  let anySuccess = false;
  let anyFailure = false;
  for (const resource of requested) {
    const outcome = perResource[resource];
    if (outcome === undefined) {
      // Defensive — every requested resource should have an outcome
      // recorded by the orchestrator. Missing outcome means the loop
      // bailed out before recording (e.g., orchestrator bug). Treat as
      // failure so the run does not green-check a half-finished state.
      anyFailure = true;
      continue;
    }
    if (outcome.status === 'success') {
      anySuccess = true;
    } else if (outcome.status !== 'skipped') {
      // Skipped resources contribute neither success nor failure — the
      // user explicitly asked to skip them. Everything else (failed_auth,
      // failed_network, partial_429, partial_5xx) counts as a failure.
      anyFailure = true;
    }
  }
  if (!anyFailure) return 'ok';
  if (anySuccess) return 'partial';
  return 'failed';
}
