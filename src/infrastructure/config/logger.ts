// Default import: pino is a CJS module published with `export = pino`, so the
// `.destination` and `.symbols` accessors only attach to the default callable —
// the named `{ pino }` re-export only exposes `stdTimeFunctions`. The RESEARCH.md
// Pattern 1 example used the named form, which fails to compile against the
// installed Pino 10.3.1 `.d.ts` under strict + verbatimModuleSyntax.
import pino, { type Logger } from 'pino';

// MCP stdio servers speak JSON-RPC on stdout. Anything else on stdout corrupts
// the protocol. This module binds Pino to fd 2 (stderr) under every NODE_ENV;
// there is no path in this codebase that logs to stdout. See CLAUDE.md §Critical
// Rules and PITFALLS.md Pitfall 1. The subprocess round-trip in Plan 06 is the
// load-bearing verification; logger.test.ts is the programmatic pre-check.

// process.env access uses dot-notation: @types/node declares NODE_ENV and
// LOG_LEVEL as optional named properties, so both `process.env.NODE_ENV` and
// `process.env['NODE_ENV']` resolve to `string | undefined` under
// noUncheckedIndexedAccess. Biome's useLiteralKeys rule prefers dot-notation.

/**
 * Subset of `process.env` the logger factory reads. Accepting a typed env
 * argument (instead of reading `process.env` at module scope) is what lets
 * the unit suite exercise both the dev and prod logger arms without process
 * spawning — see WR-01 in 01-REVIEW.md.
 */
export interface LoggerEnv {
  NODE_ENV?: string;
  LOG_LEVEL?: string;
}

/**
 * Resolved Pino options shape — exposed for unit testing the dev-path
 * transport config without spawning a `pino-pretty` worker thread. The
 * production logger does not return this object; it is purely a test seam.
 *
 * `kind` discriminator: 'dev' arms use a transport (`pino-pretty` worker thread)
 * with `destination: 2`; 'prod' arms use a direct `pino.destination({ dest: 2 })`
 * stream binding. Both ultimately write to fd 2.
 */
export type ResolvedLoggerOptions =
  | {
      kind: 'dev';
      level: string;
      transport: { target: 'pino-pretty'; options: { destination: 2 } };
    }
  | {
      kind: 'prod';
      level: string;
      destination: { dest: 2; sync: false };
    };

/**
 * Resolve logger options from an env-like object. Pure function — no
 * Pino construction, no fd allocation. Exported so the unit suite can assert
 * the dev arm binds destination to fd 2 (the regression WR-01 calls out).
 */
export function resolveLoggerOptions(env: LoggerEnv): ResolvedLoggerOptions {
  const isDev = env.NODE_ENV === 'development';
  if (isDev) {
    return {
      kind: 'dev',
      level: env.LOG_LEVEL ?? 'debug',
      transport: { target: 'pino-pretty', options: { destination: 2 } },
    };
  }
  return {
    kind: 'prod',
    level: env.LOG_LEVEL ?? 'info',
    // sync: false picks Pino's buffered SonicBoom destination — significantly
    // faster than synchronous writes under load. The tradeoff is that
    // buffered logs need flushing on shutdown; Pino installs an exit hook for
    // fatal exits, and the MCP transport itself drains stdio on close.
    destination: { dest: 2, sync: false },
  };
}

/**
 * Construct a Pino logger from a typed env. Exposed for unit testing both
 * arms; production code uses the module-level `logger` singleton.
 */
export function createLogger(env: LoggerEnv): Logger {
  const opts = resolveLoggerOptions(env);
  if (opts.kind === 'dev') {
    return pino({ level: opts.level, transport: opts.transport });
  }
  return pino({ level: opts.level }, pino.destination(opts.destination));
}

// Production singleton — bound at module load to the current process.env. The
// MCP entry point imports this directly. Tests construct their own instances
// via `createLogger({ NODE_ENV: 'development' })` to exercise the dev arm
// without setting NODE_ENV on the test process itself.
export const logger = createLogger(process.env);

// BACK-01 (#95): explicit synchronous flush helper for shutdown paths.
// Pino's `sync: false` SonicBoom destination buffers writes; the buffer
// drains on graceful exit and `process.on('beforeExit')`, but a hard
// kill or pre-exit fatal skips that path. Production callers that own
// the shutdown sequence (sync.ts's installAbortHandlers, MCP's
// logger.fatal hot-paths) can invoke this before process.exit so
// structured fatals always reach stderr. We deliberately do NOT install
// signal handlers in this module — that would conflict with sync.ts's
// installAbortHandlers which has its own sync_runs cleanup semantics.
// Each shutdown owner is responsible for calling logger.flush() at
// the right moment.
export function flushLoggerSync(): void {
  try {
    logger.flush();
  } catch {
    // best-effort — never let a flush error mask the shutdown path.
  }
}
