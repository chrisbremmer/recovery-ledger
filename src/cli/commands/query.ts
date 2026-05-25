// CLI `query <resource>` command shim (Plan 04-11 Task 3; D-24 anchor).
//
// Per-resource dispatch over the 8 QueryCacheInput arms. Each arm carries
// its own filter set; flags valid on one arm are rejected on others
// (e.g., --include-excluded is valid only on `cycles`). The dispatch
// happens HERE at the CLI boundary so a typo doesn't reach the service.
//
// Composition over services.queryCache + renderQueryCache (Plan 04-09).
// D-32 exit codes:
//   ok               = 0
//   invalid_input    = 1   unknown resource OR flag/resource mismatch
//   bootstrap_failed = 1

import { renderQueryCache } from '../../formatters/query-cache.txt.js';
import { formatBootstrapError } from '../../formatters/sync.txt.js';
import { logger } from '../../infrastructure/config/logger.js';
import { paths } from '../../infrastructure/config/paths.js';
import { isMigrationError } from '../../infrastructure/db/migrate.js';
import { sanitize, serializeError } from '../../infrastructure/observability/sanitize.js';
import type { QueryCacheInput } from '../../services/cache/types.js';
import { type Bootstrapped, bootstrap } from '../../services/index.js';

export const QUERY_EXIT_CODES: Readonly<Record<string, number>> = Object.freeze({
  ok: 0,
  invalid_input: 1,
  bootstrap_failed: 1,
  service_error: 1,
});

/** Closed tuple of valid resource names — adding a 9th arm to
 *  QueryCacheInput requires extending this set + adding the arm in the
 *  dispatch switch below. Membership check is the CLI-level T-04-S4
 *  mitigation; the service Zod schema is the MCP-level enforcement. */
const QUERY_RESOURCE_NAMES = new Set<QueryCacheInput['resource']>([
  'cycles',
  'recoveries',
  'sleeps',
  'workouts',
  'profile',
  'body_measurements',
  'sync_runs',
  'decisions',
]);

function isQueryResource(s: string): s is QueryCacheInput['resource'] {
  return QUERY_RESOURCE_NAMES.has(s as QueryCacheInput['resource']);
}

export interface RunQueryCommandOpts {
  since?: string;
  until?: string;
  limit?: number;
  includeUnscored?: boolean;
  includeExcluded?: boolean;
  status?: string;
  category?: string;
  sportId?: number;
  minRecoveryScore?: number;
  maxRecoveryScore?: number;
}

/**
 * Build the per-resource QueryCacheInput arm from the flat opts object
 * Commander hands us. Returns `{ok: false, message}` on flag/resource
 * mismatch — that is the CLI's invalid_input arm.
 */
export function buildQueryInput(
  resource: QueryCacheInput['resource'],
  opts: RunQueryCommandOpts,
): { ok: true; value: QueryCacheInput } | { ok: false; message: string } {
  // Per-resource flag-set guard: reject flags that are not valid on the
  // selected arm. Each resource lists the flags IT consumes; everything
  // else must be undefined.
  const unsupported = (flag: string): { ok: false; message: string } => ({
    ok: false,
    message: `Invalid flag for resource ${resource}: --${flag} is not supported on this arm.`,
  });

  switch (resource) {
    case 'cycles': {
      if (opts.status !== undefined) return unsupported('status');
      if (opts.category !== undefined) return unsupported('category');
      if (opts.sportId !== undefined) return unsupported('sport-id');
      if (opts.minRecoveryScore !== undefined) return unsupported('min-recovery-score');
      if (opts.maxRecoveryScore !== undefined) return unsupported('max-recovery-score');
      return {
        ok: true,
        value: {
          resource: 'cycles',
          ...(opts.since !== undefined && { since: opts.since }),
          ...(opts.until !== undefined && { until: opts.until }),
          ...(opts.includeUnscored !== undefined && { includeUnscored: opts.includeUnscored }),
          ...(opts.includeExcluded !== undefined && { includeExcluded: opts.includeExcluded }),
          ...(opts.limit !== undefined && { limit: opts.limit }),
        },
      };
    }
    case 'recoveries': {
      if (opts.includeExcluded !== undefined) return unsupported('include-excluded');
      if (opts.status !== undefined) return unsupported('status');
      if (opts.category !== undefined) return unsupported('category');
      if (opts.sportId !== undefined) return unsupported('sport-id');
      return {
        ok: true,
        value: {
          resource: 'recoveries',
          ...(opts.since !== undefined && { since: opts.since }),
          ...(opts.until !== undefined && { until: opts.until }),
          ...(opts.includeUnscored !== undefined && { includeUnscored: opts.includeUnscored }),
          ...(opts.minRecoveryScore !== undefined && {
            minRecoveryScore: opts.minRecoveryScore,
          }),
          ...(opts.maxRecoveryScore !== undefined && {
            maxRecoveryScore: opts.maxRecoveryScore,
          }),
          ...(opts.limit !== undefined && { limit: opts.limit }),
        },
      };
    }
    case 'sleeps': {
      if (opts.includeExcluded !== undefined) return unsupported('include-excluded');
      if (opts.status !== undefined) return unsupported('status');
      if (opts.category !== undefined) return unsupported('category');
      if (opts.sportId !== undefined) return unsupported('sport-id');
      if (opts.minRecoveryScore !== undefined) return unsupported('min-recovery-score');
      if (opts.maxRecoveryScore !== undefined) return unsupported('max-recovery-score');
      return {
        ok: true,
        value: {
          resource: 'sleeps',
          ...(opts.since !== undefined && { since: opts.since }),
          ...(opts.until !== undefined && { until: opts.until }),
          ...(opts.includeUnscored !== undefined && { includeUnscored: opts.includeUnscored }),
          ...(opts.limit !== undefined && { limit: opts.limit }),
        },
      };
    }
    case 'workouts': {
      if (opts.includeExcluded !== undefined) return unsupported('include-excluded');
      if (opts.status !== undefined) return unsupported('status');
      if (opts.category !== undefined) return unsupported('category');
      if (opts.minRecoveryScore !== undefined) return unsupported('min-recovery-score');
      if (opts.maxRecoveryScore !== undefined) return unsupported('max-recovery-score');
      return {
        ok: true,
        value: {
          resource: 'workouts',
          ...(opts.since !== undefined && { since: opts.since }),
          ...(opts.until !== undefined && { until: opts.until }),
          ...(opts.includeUnscored !== undefined && { includeUnscored: opts.includeUnscored }),
          ...(opts.sportId !== undefined && { sportId: opts.sportId }),
          ...(opts.limit !== undefined && { limit: opts.limit }),
        },
      };
    }
    case 'profile': {
      // Profile is single-row — no filters meaningful. Reject any flag.
      if (opts.since !== undefined) return unsupported('since');
      if (opts.until !== undefined) return unsupported('until');
      if (opts.limit !== undefined) return unsupported('limit');
      if (opts.includeUnscored !== undefined) return unsupported('include-unscored');
      if (opts.includeExcluded !== undefined) return unsupported('include-excluded');
      if (opts.status !== undefined) return unsupported('status');
      if (opts.category !== undefined) return unsupported('category');
      if (opts.sportId !== undefined) return unsupported('sport-id');
      if (opts.minRecoveryScore !== undefined) return unsupported('min-recovery-score');
      if (opts.maxRecoveryScore !== undefined) return unsupported('max-recovery-score');
      return { ok: true, value: { resource: 'profile' } };
    }
    case 'body_measurements': {
      if (opts.includeUnscored !== undefined) return unsupported('include-unscored');
      if (opts.includeExcluded !== undefined) return unsupported('include-excluded');
      if (opts.status !== undefined) return unsupported('status');
      if (opts.category !== undefined) return unsupported('category');
      if (opts.sportId !== undefined) return unsupported('sport-id');
      if (opts.minRecoveryScore !== undefined) return unsupported('min-recovery-score');
      if (opts.maxRecoveryScore !== undefined) return unsupported('max-recovery-score');
      return {
        ok: true,
        value: {
          resource: 'body_measurements',
          ...(opts.since !== undefined && { since: opts.since }),
          ...(opts.until !== undefined && { until: opts.until }),
          ...(opts.limit !== undefined && { limit: opts.limit }),
        },
      };
    }
    case 'sync_runs': {
      if (opts.until !== undefined) return unsupported('until');
      if (opts.includeUnscored !== undefined) return unsupported('include-unscored');
      if (opts.includeExcluded !== undefined) return unsupported('include-excluded');
      if (opts.category !== undefined) return unsupported('category');
      if (opts.sportId !== undefined) return unsupported('sport-id');
      if (opts.minRecoveryScore !== undefined) return unsupported('min-recovery-score');
      if (opts.maxRecoveryScore !== undefined) return unsupported('max-recovery-score');
      // Validate --status against the sync_runs arm's status enum.
      if (
        opts.status !== undefined &&
        opts.status !== 'ok' &&
        opts.status !== 'partial' &&
        opts.status !== 'failed' &&
        opts.status !== 'running'
      ) {
        return {
          ok: false,
          message: `Invalid --status for sync_runs: ${sanitize(opts.status)} (allowed: ok | partial | failed | running)`,
        };
      }
      return {
        ok: true,
        value: {
          resource: 'sync_runs',
          ...(opts.status !== undefined && {
            status: opts.status as 'ok' | 'partial' | 'failed' | 'running',
          }),
          ...(opts.since !== undefined && { since: opts.since }),
          ...(opts.limit !== undefined && { limit: opts.limit }),
        },
      };
    }
    case 'decisions': {
      if (opts.since !== undefined) return unsupported('since');
      if (opts.until !== undefined) return unsupported('until');
      if (opts.includeUnscored !== undefined) return unsupported('include-unscored');
      if (opts.includeExcluded !== undefined) return unsupported('include-excluded');
      if (opts.sportId !== undefined) return unsupported('sport-id');
      if (opts.minRecoveryScore !== undefined) return unsupported('min-recovery-score');
      if (opts.maxRecoveryScore !== undefined) return unsupported('max-recovery-score');
      if (
        opts.status !== undefined &&
        opts.status !== 'open' &&
        opts.status !== 'followed_up' &&
        opts.status !== 'abandoned'
      ) {
        return {
          ok: false,
          message: `Invalid --status for decisions: ${sanitize(opts.status)} (allowed: open | followed_up | abandoned)`,
        };
      }
      return {
        ok: true,
        value: {
          resource: 'decisions',
          ...(opts.status !== undefined && {
            status: opts.status as 'open' | 'followed_up' | 'abandoned',
          }),
          ...(opts.category !== undefined && { category: opts.category }),
          ...(opts.limit !== undefined && { limit: opts.limit }),
        },
      };
    }
    default: {
      // Exhaustive switch — unreachable at runtime when the membership
      // check above ran first. Compile error if a 9th arm lands without
      // extending QUERY_RESOURCE_NAMES + this switch.
      const _exhaustive: never = resource;
      void _exhaustive;
      return { ok: false, message: `Unknown resource: ${sanitize(String(resource))}` };
    }
  }
}

/**
 * Orchestration shim:
 *   1. validate resource name (closed tuple membership)
 *   2. buildQueryInput → per-resource arm narrowing
 *   3. bootstrap()
 *   4. services.queryCache(input)
 *   5. renderQueryCache → stdout → exit 0
 */
export async function runQueryCommand(resource: string, opts: RunQueryCommandOpts): Promise<void> {
  // 1. Resource membership.
  if (!isQueryResource(resource)) {
    process.stdout.write(
      `Unknown resource: ${sanitize(resource)} (allowed: cycles | recoveries | sleeps | workouts | profile | body_measurements | sync_runs | decisions)\n`,
      () => process.exit(QUERY_EXIT_CODES.invalid_input),
    );
    return;
  }

  // 2. Per-resource flag-set narrowing.
  const built = buildQueryInput(resource, opts);
  if (!built.ok) {
    process.stdout.write(`${built.message}\n`, () => {
      process.exit(QUERY_EXIT_CODES.invalid_input);
    });
    return;
  }

  // 3. Bootstrap.
  let app: Bootstrapped;
  try {
    app = bootstrap();
  } catch (err) {
    const body = isMigrationError(err)
      ? formatBootstrapError(err, paths.dbFile)
      : `Bootstrap failed: ${sanitize(String(err))}`;
    process.stdout.write(`${body}\n`, () => {
      process.exit(QUERY_EXIT_CODES.bootstrap_failed);
    });
    return;
  }

  // 4 & 5. Service + render. Wrap in try/catch so a repo or
  // formatter failure surfaces a structured log on stderr and a non-zero
  // exit, instead of throwing an unhandled rejection.
  try {
    const result = await app.services.queryCache(built.value);
    const body = renderQueryCache(result);
    process.stdout.write(`${body}\n`, () => {
      app.close();
      process.exit(QUERY_EXIT_CODES.ok);
    });
  } catch (err) {
    logger.error({ event: 'query_command_failed', err: serializeError(err) });
    app.close();
    process.stdout.write(`Query failed: ${sanitize(String(err))}\n`, () => {
      process.exit(QUERY_EXIT_CODES.service_error ?? 1);
    });
  }
}
