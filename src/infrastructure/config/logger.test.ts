import pino from 'pino';
import { describe, expect, test } from 'vitest';
import { createLogger, logger, resolveLoggerOptions } from './logger.js';

// D-02a: programmatic Vitest check that Pino's destination resolves to fd 2.
// The load-bearing assertion is the subprocess round-trip in Plan 06; this
// file is the cheap pre-check that runs on every test invocation. See
// PITFALLS.md Pitfall 1 and CONTEXT.md D-02.
//
// WR-01: tests now cover BOTH the dev arm (NODE_ENV=development → pino-pretty
// transport with destination: 2) and the prod arm. The previous suite only
// exercised the prod arm because Vitest doesn't set NODE_ENV=development by
// default — a regression that dropped `destination: 2` from pino-pretty
// options would have silently corrupted `npm run dev:mcp`.
//
// WR-07: the try/catch wrapping around the symbol-introspection test is
// dropped — vitest's native diff is more informative than the catch-block
// re-throw it replaced.

describe('logger destination — load-bearing fd 2 assertions', () => {
  test('pino.destination({ dest: 2 }) returns a stream with fd === 2', () => {
    // Fallback assertion from RESEARCH §Pattern 5(a) — robust against Pino
    // internals shifting; constructs a fresh destination and inspects .fd
    // directly without going through pino.symbols. SonicBoom's .d.ts (v4.x)
    // does not publish .fd as a class field even though every instance carries
    // one at runtime — cast through unknown to surface the runtime shape.
    const dest = pino.destination({ dest: 2, sync: true }) as unknown as { fd: number };
    expect(dest.fd).toBe(2);
  });

  test('exported logger is bound to fd 2 via pino.symbols.streamSym', () => {
    // Symbol-based introspection: pino.symbols.streamSym is the documented
    // accessor for the underlying SonicBoom destination on a Pino instance.
    // Verified against Pino 10.3.1's lib/symbols.js — resolves to
    // Symbol('pino.stream'). If a future Pino version renames or hides this
    // symbol, this assertion fails with vitest's native diff pointing at the
    // resolved value — more informative than the try/catch wrap it replaces
    // (WR-07).
    const streamSym = pino.symbols.streamSym;
    const stream = (logger as unknown as Record<symbol, unknown>)[streamSym] as
      | { fd?: number }
      | undefined;
    expect(
      stream,
      'pino.symbols.streamSym no longer resolves on the logger instance',
    ).toBeDefined();
    expect(stream?.fd).toBe(2);
  });
});

describe('resolveLoggerOptions — both arms route to fd 2 (WR-01)', () => {
  test('dev arm (NODE_ENV=development) uses pino-pretty transport with destination: 2', () => {
    const opts = resolveLoggerOptions({ NODE_ENV: 'development' });
    expect(opts.kind).toBe('dev');
    if (opts.kind !== 'dev') return; // type narrow
    expect(opts.transport.target).toBe('pino-pretty');
    // The load-bearing assertion: destination must resolve to fd 2 in the
    // dev arm too. A regression that dropped this option would silently
    // corrupt the MCP JSON-RPC stream under `npm run dev:mcp`.
    expect(opts.transport.options.destination).toBe(2);
  });

  test('dev arm honors LOG_LEVEL override', () => {
    const opts = resolveLoggerOptions({ NODE_ENV: 'development', LOG_LEVEL: 'trace' });
    expect(opts.level).toBe('trace');
  });

  test('dev arm defaults level to debug when LOG_LEVEL unset', () => {
    const opts = resolveLoggerOptions({ NODE_ENV: 'development' });
    expect(opts.level).toBe('debug');
  });

  test('prod arm (NODE_ENV unset) uses pino.destination with dest: 2', () => {
    const opts = resolveLoggerOptions({});
    expect(opts.kind).toBe('prod');
    if (opts.kind !== 'prod') return; // type narrow
    expect(opts.destination.dest).toBe(2);
    expect(opts.destination.sync).toBe(false);
  });

  test('prod arm (NODE_ENV=production) defaults level to info', () => {
    const opts = resolveLoggerOptions({ NODE_ENV: 'production' });
    expect(opts.kind).toBe('prod');
    expect(opts.level).toBe('info');
  });

  test('prod arm honors LOG_LEVEL override', () => {
    const opts = resolveLoggerOptions({ NODE_ENV: 'production', LOG_LEVEL: 'warn' });
    expect(opts.level).toBe('warn');
  });
});

describe('createLogger — constructs a real Pino instance bound to fd 2 (WR-01)', () => {
  // Construct loggers for both arms and verify the resulting Pino instance
  // routes to fd 2. We do not spawn a pino-pretty worker thread — that would
  // be slow and flaky in CI. The pre-Pino options resolved above are the
  // load-bearing check; this assertion is the integration smoke that
  // `createLogger` wires them correctly into a real instance.
  test('createLogger({ NODE_ENV: "production" }) binds streamSym to fd 2', () => {
    const prodLogger = createLogger({ NODE_ENV: 'production' });
    const streamSym = pino.symbols.streamSym;
    const stream = (prodLogger as unknown as Record<symbol, unknown>)[streamSym] as
      | { fd?: number }
      | undefined;
    expect(stream?.fd).toBe(2);
  });
});
