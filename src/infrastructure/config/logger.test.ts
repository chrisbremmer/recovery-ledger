import pino from 'pino';
import { describe, expect, test } from 'vitest';
import { logger } from './logger.js';

// D-02a: programmatic Vitest check that Pino's destination resolves to fd 2.
// The load-bearing assertion is the subprocess round-trip in Plan 06; this
// file is the cheap pre-check that runs on every test invocation. See
// PITFALLS.md Pitfall 1 and CONTEXT.md D-02.

describe('logger destination', () => {
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
    // symbol, fall back to Test 1 + the subprocess round-trip in Plan 06.
    const streamSym = pino.symbols.streamSym;
    try {
      const stream = (logger as unknown as Record<symbol, unknown>)[streamSym] as
        | { fd?: number }
        | undefined;
      expect(stream?.fd).toBe(2);
    } catch (err) {
      expect.fail(
        `pino.symbols.streamSym no longer exposes destination — fall back to Test 1 + subprocess test in Plan 06. Cause: ${String(err)}`,
      );
    }
  });
});
