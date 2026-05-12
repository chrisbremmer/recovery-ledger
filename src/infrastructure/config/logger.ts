// Default import: pino is a CJS module published with `export = pino`, so the
// `.destination` and `.symbols` accessors only attach to the default callable —
// the named `{ pino }` re-export only exposes `stdTimeFunctions`. The RESEARCH.md
// Pattern 1 example used the named form, which fails to compile against the
// installed Pino 10.3.1 `.d.ts` under strict + verbatimModuleSyntax.
import pino from 'pino';

// MCP stdio servers speak JSON-RPC on stdout. Anything else on stdout corrupts
// the protocol. This module binds Pino to fd 2 (stderr) under every NODE_ENV;
// there is no path in this codebase that logs to stdout. See CLAUDE.md §Critical
// Rules and PITFALLS.md Pitfall 1. The subprocess round-trip in Plan 06 is the
// load-bearing verification; logger.test.ts is the programmatic pre-check.

// process.env access uses dot-notation: @types/node declares NODE_ENV and
// LOG_LEVEL as optional named properties, so both `process.env.NODE_ENV` and
// `process.env['NODE_ENV']` resolve to `string | undefined` under
// noUncheckedIndexedAccess. Biome's useLiteralKeys rule prefers dot-notation.
const isDev = process.env.NODE_ENV === 'development';

// sync: false picks Pino's buffered SonicBoom destination — significantly faster
// than synchronous writes under load. The tradeoff is that buffered logs need
// flushing on shutdown; Pino installs an exit hook for fatal exits, and the MCP
// transport itself drains stdio on close. Tests construct sync destinations
// explicitly (see logger.test.ts) so fd inspection is deterministic without
// touching this prod path.
export const logger = isDev
  ? pino({
      level: process.env.LOG_LEVEL ?? 'debug',
      transport: {
        target: 'pino-pretty',
        options: { destination: 2 },
      },
    })
  : pino({ level: process.env.LOG_LEVEL ?? 'info' }, pino.destination({ dest: 2, sync: false }));
