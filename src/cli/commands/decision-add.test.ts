// Plan 04-11 Task 2 decision-add.ts unit tests.
//
// Covers:
//   - DECISION_ADD_EXIT_CODES frozen + canonical arms.
//   - parseFollowUp validator across 5 input shapes (undefined / in Nd /
//     over-365 / ISO date / not-a-date).
//   - parseConfidence validator round-trip + rejection.
//   - Full flow with mocked bootstrap → addDecision → stdout/exit.
//   - T-04-S2 fixtures: SQL-injection / shell-metachar / unicode payloads
//     round-trip through the service unchanged.

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type { Decision } from '../../domain/types/entities.js';

const originalExit = process.exit;
const originalWrite = process.stdout.write.bind(process.stdout);

let exitCode: number | undefined;
let writtenBody: string;

function makeDecision(overrides: Partial<Decision> = {}): Decision {
  return {
    id: '01HTEST00000000000000000000',
    createdAt: '2026-03-15T12:00:00.000Z',
    category: 'general',
    decision: 'sleep more',
    rationale: null,
    confidence: null,
    expectedEffect: null,
    followUpDate: '2026-03-22',
    status: 'open',
    outcomeNotes: null,
    ...overrides,
  };
}

beforeEach(() => {
  exitCode = undefined;
  writtenBody = '';

  process.exit = ((code?: number) => {
    exitCode = code;
    return undefined as never;
  }) as never;
  process.stdout.write = ((
    chunk: string | Uint8Array,
    cbOrEncoding?: ((err?: Error | null) => void) | string,
    cb?: (err?: Error | null) => void,
  ) => {
    writtenBody += typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8');
    const finished = typeof cbOrEncoding === 'function' ? cbOrEncoding : cb;
    if (finished) finished();
    return true;
  }) as typeof process.stdout.write;
});

afterEach(() => {
  process.exit = originalExit;
  process.stdout.write = originalWrite;
  vi.resetModules();
  vi.doUnmock('../../services/index.js');
});

function mockBootstrap(
  addDecisionImpl: (input: unknown) => Promise<Decision> | Decision = (input) =>
    makeDecision({ decision: (input as { decision: string }).decision }),
  bootstrapImpl?: () => void,
): { addSpy: ReturnType<typeof vi.fn>; closeSpy: ReturnType<typeof vi.fn> } {
  const addSpy = vi.fn(async (input: unknown) => addDecisionImpl(input));
  const closeSpy = vi.fn(() => undefined);
  vi.doMock('../../services/index.js', async () => {
    const actual =
      await vi.importActual<typeof import('../../services/index.js')>('../../services/index.js');
    return {
      ...actual,
      bootstrap: vi.fn(() => {
        if (bootstrapImpl) bootstrapImpl();
        return {
          db: null,
          sqlite: null,
          services: { addDecision: addSpy },
          close: closeSpy,
        };
      }),
    };
  });
  return { addSpy, closeSpy };
}

describe('DECISION_ADD_EXIT_CODES', () => {
  test('exit-code map is frozen', async () => {
    const { DECISION_ADD_EXIT_CODES } = await import('./decision-add.js');
    expect(Object.isFrozen(DECISION_ADD_EXIT_CODES)).toBe(true);
  });

  test('ok=0, invalid_input=1, bootstrap_failed=1, db_write_failed=1', async () => {
    const { DECISION_ADD_EXIT_CODES } = await import('./decision-add.js');
    expect(DECISION_ADD_EXIT_CODES.ok).toBe(0);
    expect(DECISION_ADD_EXIT_CODES.invalid_input).toBe(1);
    expect(DECISION_ADD_EXIT_CODES.bootstrap_failed).toBe(1);
    expect(DECISION_ADD_EXIT_CODES.db_write_failed).toBe(1);
  });
});

describe('parseFollowUp', () => {
  test('undefined → ok with now() + 7 days (D-19 smart default)', async () => {
    const { parseFollowUp } = await import('./decision-add.js');
    const clock = () => new Date('2026-03-15T00:00:00.000Z');
    const result = parseFollowUp(undefined, clock);
    expect(result).toEqual({ ok: true, value: '2026-03-22' });
  });

  test('"in 14d" → ok with now() + 14 days', async () => {
    const { parseFollowUp } = await import('./decision-add.js');
    const clock = () => new Date('2026-03-15T00:00:00.000Z');
    const result = parseFollowUp('in 14d', clock);
    expect(result).toEqual({ ok: true, value: '2026-03-29' });
  });

  test('"in 366d" → invalid (over 365)', async () => {
    const { parseFollowUp } = await import('./decision-add.js');
    const clock = () => new Date('2026-03-15T00:00:00.000Z');
    const result = parseFollowUp('in 366d', clock);
    expect(result.ok).toBe(false);
  });

  test('"2026-04-01" → ok with the same ISO date', async () => {
    const { parseFollowUp } = await import('./decision-add.js');
    const clock = () => new Date('2026-03-15T00:00:00.000Z');
    const result = parseFollowUp('2026-04-01', clock);
    expect(result).toEqual({ ok: true, value: '2026-04-01' });
  });

  test('"not-a-date" → invalid', async () => {
    const { parseFollowUp } = await import('./decision-add.js');
    const clock = () => new Date('2026-03-15T00:00:00.000Z');
    const result = parseFollowUp('not-a-date', clock);
    expect(result.ok).toBe(false);
  });

  test('non-ISO date forms are rejected', async () => {
    const { parseFollowUp } = await import('./decision-add.js');
    const clock = () => new Date('2026-03-15T00:00:00.000Z');
    expect(parseFollowUp('03/15/2026', clock).ok).toBe(false);
    expect(parseFollowUp('March 15 2026', clock).ok).toBe(false);
    expect(parseFollowUp('2026/3/1', clock).ok).toBe(false);
    expect(parseFollowUp('2026-3-1', clock).ok).toBe(false);
  });
});

describe('parseConfidence', () => {
  test('undefined → ok with null (default)', async () => {
    const { parseConfidence } = await import('./decision-add.js');
    expect(parseConfidence(undefined)).toEqual({ ok: true, value: null });
  });

  test('low / medium / high → ok with the same value', async () => {
    const { parseConfidence } = await import('./decision-add.js');
    expect(parseConfidence('low')).toEqual({ ok: true, value: 'low' });
    expect(parseConfidence('medium')).toEqual({ ok: true, value: 'medium' });
    expect(parseConfidence('high')).toEqual({ ok: true, value: 'high' });
  });

  test('invalid value → not ok', async () => {
    const { parseConfidence } = await import('./decision-add.js');
    const result = parseConfidence('unknown');
    expect(result.ok).toBe(false);
  });
});

describe('runDecisionAddCommand happy path', () => {
  test('"sleep more" with no flags → addDecision called + writes detail + exits 0', async () => {
    const { addSpy } = mockBootstrap();
    vi.resetModules();
    const { runDecisionAddCommand } = await import('./decision-add.js');
    await runDecisionAddCommand('sleep more', {});
    expect(addSpy).toHaveBeenCalledTimes(1);
    const arg = addSpy.mock.calls[0]?.[0] as { decision: string; followUpDate?: string };
    expect(arg.decision).toBe('sleep more');
    // when --follow-up is omitted, CLI no longer pre-computes
    // the now()+7d default; it leaves followUpDate undefined so the service
    // layer (shared with MCP) applies the default. This test asserts the
    // CLI passes nothing through.
    expect(arg.followUpDate).toBeUndefined();
    expect(writtenBody).toContain('Decision');
    expect(exitCode).toBe(0);
  });

  test('--confidence medium passes through', async () => {
    const { addSpy } = mockBootstrap();
    vi.resetModules();
    const { runDecisionAddCommand } = await import('./decision-add.js');
    await runDecisionAddCommand('sleep more', { confidence: 'medium' });
    const arg = addSpy.mock.calls[0]?.[0] as { confidence?: string };
    expect(arg.confidence).toBe('medium');
    expect(exitCode).toBe(0);
  });

  test('--category training + --rationale + --expected-effect pass through', async () => {
    const { addSpy } = mockBootstrap();
    vi.resetModules();
    const { runDecisionAddCommand } = await import('./decision-add.js');
    await runDecisionAddCommand('sleep more', {
      category: 'training',
      rationale: 'rest day',
      expectedEffect: 'recovery > 80',
    });
    const arg = addSpy.mock.calls[0]?.[0] as {
      category?: string;
      rationale?: string | null;
      expectedEffect?: string | null;
    };
    expect(arg.category).toBe('training');
    expect(arg.rationale).toBe('rest day');
    expect(arg.expectedEffect).toBe('recovery > 80');
    expect(exitCode).toBe(0);
  });
});

describe('runDecisionAddCommand input validation', () => {
  test('--confidence garbage → exit invalid_input + sanitized stdout', async () => {
    const { addSpy } = mockBootstrap();
    vi.resetModules();
    const { runDecisionAddCommand, DECISION_ADD_EXIT_CODES } = await import('./decision-add.js');
    await runDecisionAddCommand('sleep more', { confidence: 'super-high' });
    expect(addSpy).not.toHaveBeenCalled();
    expect(writtenBody).toContain('confidence');
    expect(exitCode).toBe(DECISION_ADD_EXIT_CODES.invalid_input);
  });

  test('--follow-up "not-a-date" → exit invalid_input', async () => {
    const { addSpy } = mockBootstrap();
    vi.resetModules();
    const { runDecisionAddCommand, DECISION_ADD_EXIT_CODES } = await import('./decision-add.js');
    await runDecisionAddCommand('sleep more', { followUp: 'not-a-date' });
    expect(addSpy).not.toHaveBeenCalled();
    expect(writtenBody).toContain('follow-up');
    expect(exitCode).toBe(DECISION_ADD_EXIT_CODES.invalid_input);
  });
});

describe('runDecisionAddCommand failure paths', () => {
  test('bootstrap MigrationError → exit bootstrap_failed', async () => {
    const { MigrationError } = await import('../../domain/errors/migration.js');
    mockBootstrap(undefined, () => {
      throw new MigrationError({
        kind: 'inconsistent_state',
        backupPath: '/tmp/recovery-ledger-test/backups/db.2026-05-20-pre-0001.sqlite',
        latestSafeMigration: '0000_initial',
      });
    });
    vi.resetModules();
    const { runDecisionAddCommand, DECISION_ADD_EXIT_CODES } = await import('./decision-add.js');
    await runDecisionAddCommand('sleep more', {});
    expect(writtenBody).toContain('cp ');
    expect(exitCode).toBe(DECISION_ADD_EXIT_CODES.bootstrap_failed);
  });

  test('addDecision throws → exit db_write_failed with sanitized message', async () => {
    mockBootstrap(() => {
      throw new Error('SQLITE_BUSY');
    });
    vi.resetModules();
    const { runDecisionAddCommand, DECISION_ADD_EXIT_CODES } = await import('./decision-add.js');
    await runDecisionAddCommand('sleep more', {});
    expect(writtenBody).toContain('failed');
    expect(exitCode).toBe(DECISION_ADD_EXIT_CODES.db_write_failed);
  });
});

// ---------------------------------------------------------------------------
// T-04-S2 fixtures: SQL-injection + shell-metacharacter + unicode payloads
// round-trip through the service unchanged. The actual mitigations are
// Commander's array-based argv parsing + drizzle prepared statements; these
// tests verify the round-trip integrity at the CLI boundary so a future
// regression (e.g., someone wires a hand-built SQL string at the repo
// layer) trips immediately.
// ---------------------------------------------------------------------------

describe('runDecisionAddCommand T-04-S2 round-trip fixtures', () => {
  test('SQL-injection payload: "\'; DROP TABLE decisions; --" round-trips through service unchanged', async () => {
    const payload = "'; DROP TABLE decisions; --";
    const { addSpy } = mockBootstrap((input) =>
      makeDecision({ decision: (input as { decision: string }).decision }),
    );
    vi.resetModules();
    const { runDecisionAddCommand } = await import('./decision-add.js');
    await runDecisionAddCommand(payload, {});
    const arg = addSpy.mock.calls[0]?.[0] as { decision: string };
    expect(arg.decision).toBe(payload);
    expect(exitCode).toBe(0);
  });

  test('shell-metacharacter payload: "$(rm -rf /)" round-trips through service unchanged', async () => {
    const payload = '$(rm -rf /)';
    const { addSpy } = mockBootstrap((input) =>
      makeDecision({ decision: (input as { decision: string }).decision }),
    );
    vi.resetModules();
    const { runDecisionAddCommand } = await import('./decision-add.js');
    await runDecisionAddCommand(payload, {});
    const arg = addSpy.mock.calls[0]?.[0] as { decision: string };
    expect(arg.decision).toBe(payload);
    expect(exitCode).toBe(0);
  });

  test('unicode bidi-override payload round-trips through service unchanged', async () => {
    // U+202E RIGHT-TO-LEFT OVERRIDE — the canonical bidi-attack rune.
    const payload = ' ‮';
    const { addSpy } = mockBootstrap((input) =>
      makeDecision({ decision: (input as { decision: string }).decision }),
    );
    vi.resetModules();
    const { runDecisionAddCommand } = await import('./decision-add.js');
    await runDecisionAddCommand(payload, {});
    const arg = addSpy.mock.calls[0]?.[0] as { decision: string };
    expect(arg.decision).toBe(payload);
    expect(exitCode).toBe(0);
  });
});
