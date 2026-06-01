// Plan 04-11 Task 2 decision-update.ts unit tests — Pitfall 11
// prefix-lookup arms (no_match / ambiguous_prefix / single-match).

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type { Decision } from '../../domain/types/entities.js';
import type { ReviewDecisionsResult } from '../../services/decision/types.js';

const originalExit = process.exit;
const originalWrite = process.stdout.write.bind(process.stdout);

let exitCode: number | undefined;
let writtenBody: string;

function makeDecision(overrides: Partial<Decision> = {}): Decision {
  return {
    id: '01HFULLULID00000000000000001',
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
  findByPrefixImpl: (prefix: string) => Decision[] = () => [makeDecision()],
  reviewImpl: (input: unknown) => Promise<ReviewDecisionsResult> | ReviewDecisionsResult = (
    input,
  ) => ({
    mode: 'update',
    decision: makeDecision({ status: (input as { status: Decision['status'] }).status }),
  }),
  bootstrapImpl?: () => void,
): {
  reviewSpy: ReturnType<typeof vi.fn>;
  findSpy: ReturnType<typeof vi.fn>;
  closeSpy: ReturnType<typeof vi.fn>;
} {
  const reviewSpy = vi.fn(async (input: unknown) => reviewImpl(input));
  const findSpy = vi.fn((prefix: string) => findByPrefixImpl(prefix));
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
          repos: { decisions: { findByPrefix: findSpy } },
          services: { reviewDecisions: reviewSpy },
          close: closeSpy,
        };
      }),
    };
  });
  return { reviewSpy, findSpy, closeSpy };
}

describe('DECISION_UPDATE_EXIT_CODES', () => {
  test('exit-code map is frozen', async () => {
    const { DECISION_UPDATE_EXIT_CODES } = await import('./decision-update.js');
    expect(Object.isFrozen(DECISION_UPDATE_EXIT_CODES)).toBe(true);
  });

  test('all five arms map correctly', async () => {
    const { DECISION_UPDATE_EXIT_CODES } = await import('./decision-update.js');
    expect(DECISION_UPDATE_EXIT_CODES.ok).toBe(0);
    expect(DECISION_UPDATE_EXIT_CODES.ambiguous_prefix).toBe(1);
    expect(DECISION_UPDATE_EXIT_CODES.no_match).toBe(1);
    expect(DECISION_UPDATE_EXIT_CODES.invalid_input).toBe(1);
    expect(DECISION_UPDATE_EXIT_CODES.bootstrap_failed).toBe(1);
  });
});

describe('parseStatus', () => {
  test('open / followed_up / abandoned → ok with the same value', async () => {
    const { parseStatus } = await import('./decision-update.js');
    expect(parseStatus('open')).toEqual({ ok: true, value: 'open' });
    expect(parseStatus('followed_up')).toEqual({ ok: true, value: 'followed_up' });
    expect(parseStatus('abandoned')).toEqual({ ok: true, value: 'abandoned' });
  });

  test('invalid → not ok', async () => {
    const { parseStatus } = await import('./decision-update.js');
    expect(parseStatus('unknown').ok).toBe(false);
    expect(parseStatus(undefined).ok).toBe(false);
  });
});

describe('runDecisionUpdateCommand prefix-lookup arms (Pitfall 11)', () => {
  test('exact match (1 result) → reviewDecisions update + exits 0', async () => {
    const target = makeDecision();
    const { reviewSpy, findSpy } = mockBootstrap(() => [target]);
    vi.resetModules();
    const { runDecisionUpdateCommand } = await import('./decision-update.js');
    await runDecisionUpdateCommand(target.id, { status: 'followed_up' });
    expect(findSpy).toHaveBeenCalledWith(target.id);
    expect(reviewSpy).toHaveBeenCalledTimes(1);
    const arg = reviewSpy.mock.calls[0]?.[0] as {
      mode: string;
      id: string;
      status: string;
    };
    expect(arg.mode).toBe('update');
    expect(arg.id).toBe(target.id);
    expect(arg.status).toBe('followed_up');
    expect(writtenBody).toContain('updated');
    expect(exitCode).toBe(0);
  });

  test('ambiguous prefix (2 results) → exit ambiguous_prefix with list of matches', async () => {
    const matches = [
      makeDecision({ id: '01HSHARED0001', decision: 'first match' }),
      makeDecision({ id: '01HSHARED0002', decision: 'second match' }),
    ];
    const { reviewSpy } = mockBootstrap(() => matches);
    vi.resetModules();
    const { runDecisionUpdateCommand, DECISION_UPDATE_EXIT_CODES } = await import(
      './decision-update.js'
    );
    await runDecisionUpdateCommand('01HSHARED', { status: 'followed_up' });
    expect(reviewSpy).not.toHaveBeenCalled();
    expect(writtenBody.toLowerCase()).toContain('ambiguous');
    expect(writtenBody).toContain('01HSHARED0001');
    expect(writtenBody).toContain('01HSHARED0002');
    expect(exitCode).toBe(DECISION_UPDATE_EXIT_CODES.ambiguous_prefix);
  });

  test('no match (0 results) → exit no_match with sanitized message', async () => {
    const { reviewSpy } = mockBootstrap(() => []);
    vi.resetModules();
    const { runDecisionUpdateCommand, DECISION_UPDATE_EXIT_CODES } = await import(
      './decision-update.js'
    );
    await runDecisionUpdateCommand('NEVERMATCH', { status: 'followed_up' });
    expect(reviewSpy).not.toHaveBeenCalled();
    expect(writtenBody.toLowerCase()).toContain('no decision');
    expect(exitCode).toBe(DECISION_UPDATE_EXIT_CODES.no_match);
  });

  test('invalid status → exit invalid_input before the prefix lookup', async () => {
    const { reviewSpy, findSpy } = mockBootstrap();
    vi.resetModules();
    const { runDecisionUpdateCommand, DECISION_UPDATE_EXIT_CODES } = await import(
      './decision-update.js'
    );
    await runDecisionUpdateCommand('01HTEST', { status: 'unknown' });
    expect(reviewSpy).not.toHaveBeenCalled();
    // Status is checked BEFORE bootstrap so findByPrefix shouldn't run either.
    expect(findSpy).not.toHaveBeenCalled();
    expect(writtenBody.toLowerCase()).toContain('status');
    expect(exitCode).toBe(DECISION_UPDATE_EXIT_CODES.invalid_input);
  });

  test('--notes passes through to reviewDecisions update', async () => {
    const target = makeDecision();
    const { reviewSpy } = mockBootstrap(() => [target]);
    vi.resetModules();
    const { runDecisionUpdateCommand } = await import('./decision-update.js');
    await runDecisionUpdateCommand(target.id, {
      status: 'followed_up',
      notes: 'worked well — recovery up 12pt',
    });
    const arg = reviewSpy.mock.calls[0]?.[0] as { notes?: string | null };
    expect(arg.notes).toBe('worked well — recovery up 12pt');
    expect(exitCode).toBe(0);
  });
});

describe('runDecisionUpdateCommand failure paths', () => {
  test('bootstrap MigrationError → exit bootstrap_failed', async () => {
    const { MigrationError } = await import('../../domain/errors/migration.js');
    mockBootstrap(undefined, undefined, () => {
      throw new MigrationError({
        kind: 'inconsistent_state',
        backupPath: '/tmp/recovery-ledger-test/backups/db.2026-05-20-pre-0001.sqlite',
        latestSafeMigration: '0000_initial',
      });
    });
    vi.resetModules();
    const { runDecisionUpdateCommand, DECISION_UPDATE_EXIT_CODES } = await import(
      './decision-update.js'
    );
    await runDecisionUpdateCommand('01HTEST', { status: 'followed_up' });
    expect(writtenBody).toContain('cp ');
    expect(exitCode).toBe(DECISION_UPDATE_EXIT_CODES.bootstrap_failed);
  });
});
