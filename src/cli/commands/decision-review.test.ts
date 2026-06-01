// Plan 04-11 Task 3 decision-review.test.ts — Pitfall 10 stderr-prompt
// discipline + non-interactive list paths.
//
// Test strategy:
//   - Non-interactive list (default + --all) → call services.reviewDecisions
//     in 'list' mode + render to stdout.
//   - Interactive flow: stub the readline createInterface so questions
//     resolve from a deterministic queue, assert stream separation
//     (writtenErr is the prompts; writtenBody is the structured rendering).
//   - Bootstrap MigrationError → exit bootstrap_failed.

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type { Decision } from '../../domain/types/entities.js';
import type { ReviewDecisionsResult } from '../../services/decision/types.js';

const originalExit = process.exit;
const originalWrite = process.stdout.write.bind(process.stdout);
const originalErrWrite = process.stderr.write.bind(process.stderr);

let exitCode: number | undefined;
let writtenBody: string;
let writtenErr: string;

function makeDecision(overrides: Partial<Decision> = {}): Decision {
  return {
    id: '01HOPEN0000000000000000001',
    createdAt: '2026-02-01T12:00:00.000Z',
    category: 'general',
    decision: 'sleep more',
    rationale: null,
    confidence: null,
    expectedEffect: null,
    followUpDate: '2026-02-08',
    status: 'open',
    outcomeNotes: null,
    ...overrides,
  };
}

beforeEach(() => {
  exitCode = undefined;
  writtenBody = '';
  writtenErr = '';

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
  process.stderr.write = ((
    chunk: string | Uint8Array,
    cbOrEncoding?: ((err?: Error | null) => void) | string,
    cb?: (err?: Error | null) => void,
  ) => {
    writtenErr += typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8');
    const finished = typeof cbOrEncoding === 'function' ? cbOrEncoding : cb;
    if (finished) finished();
    return true;
  }) as typeof process.stderr.write;
});

afterEach(() => {
  process.exit = originalExit;
  process.stdout.write = originalWrite;
  process.stderr.write = originalErrWrite;
  vi.resetModules();
  vi.doUnmock('../../services/index.js');
  vi.doUnmock('node:readline/promises');
});

function mockBootstrap(
  reviewImpl: (input: unknown) => Promise<ReviewDecisionsResult> | ReviewDecisionsResult = () => ({
    mode: 'list',
    decisions: [makeDecision()],
  }),
  bootstrapImpl?: () => void,
): { reviewSpy: ReturnType<typeof vi.fn>; closeSpy: ReturnType<typeof vi.fn> } {
  const reviewSpy = vi.fn(async (input: unknown) => reviewImpl(input));
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
          services: { reviewDecisions: reviewSpy },
          close: closeSpy,
        };
      }),
    };
  });
  return { reviewSpy, closeSpy };
}

/** Stub `node:readline/promises` so question() resolves from a queue and
 *  createInterface receives the canonical output: process.stderr config
 *  (Pitfall 10 — we assert the output target in a separate test). */
function mockReadlinePromises(answers: string[]): {
  questionSpy: ReturnType<typeof vi.fn>;
  outputSeenAs: { stream: NodeJS.WritableStream | null };
} {
  const queue = [...answers];
  const outputSeenAs: { stream: NodeJS.WritableStream | null } = { stream: null };
  const questionSpy = vi.fn(async (prompt: string) => {
    // Mirror real readline: prompts flow to the configured output stream.
    outputSeenAs.stream?.write(prompt);
    return queue.shift() ?? '';
  });
  vi.doMock('node:readline/promises', () => ({
    createInterface: (opts: { input: NodeJS.ReadableStream; output: NodeJS.WritableStream }) => {
      outputSeenAs.stream = opts.output;
      return {
        question: questionSpy,
        close: vi.fn(() => undefined),
      };
    },
  }));
  return { questionSpy, outputSeenAs };
}

describe('DECISION_REVIEW_EXIT_CODES', () => {
  test('exit-code map is frozen', async () => {
    const { DECISION_REVIEW_EXIT_CODES } = await import('./decision-review.js');
    expect(Object.isFrozen(DECISION_REVIEW_EXIT_CODES)).toBe(true);
  });

  test('ok=0, bootstrap_failed=1', async () => {
    const { DECISION_REVIEW_EXIT_CODES } = await import('./decision-review.js');
    expect(DECISION_REVIEW_EXIT_CODES.ok).toBe(0);
    expect(DECISION_REVIEW_EXIT_CODES.bootstrap_failed).toBe(1);
  });
});

describe('runDecisionReviewCommand non-interactive', () => {
  test('default (no --all, no --interactive) → list-mode call + render to stdout', async () => {
    const { reviewSpy } = mockBootstrap();
    vi.resetModules();
    const { runDecisionReviewCommand } = await import('./decision-review.js');
    await runDecisionReviewCommand({});
    expect(reviewSpy).toHaveBeenCalledWith({ mode: 'list', includeAll: false });
    expect(writtenBody).toContain('01HOPEN0');
    expect(exitCode).toBe(0);
  });

  test('--all → list-mode call with includeAll: true', async () => {
    const { reviewSpy } = mockBootstrap();
    vi.resetModules();
    const { runDecisionReviewCommand } = await import('./decision-review.js');
    await runDecisionReviewCommand({ all: true });
    expect(reviewSpy).toHaveBeenCalledWith({ mode: 'list', includeAll: true });
    expect(exitCode).toBe(0);
  });
});

describe('runDecisionReviewCommand --interactive (Pitfall 10 stderr discipline)', () => {
  test('past-window decisions trigger prompts on stderr; rendering goes to stdout', async () => {
    // Past-window: createdAt 2026-02-01, followUpDate 2026-02-08, "now"
    // is far past 2026-02-08 (default Date.now() is 2026-05-20+ per
    // the test environment date — see CLAUDE.md currentDate). The
    // decision is open + past window → triggers the prompt.
    const target = makeDecision({
      id: '01HPASTWIN0000000000000001',
      followUpDate: '2026-02-08',
    });
    const { reviewSpy } = mockBootstrap((input) => {
      const i = input as { mode: string; includeAll?: boolean };
      if (i.mode === 'list') return { mode: 'list', decisions: [target] };
      // 'update' arm — return the updated row.
      return {
        mode: 'update',
        decision: { ...target, status: 'followed_up', outcomeNotes: 'worked' },
      };
    });
    const { questionSpy, outputSeenAs } = mockReadlinePromises(['followed_up', 'worked']);
    vi.resetModules();
    const { runDecisionReviewCommand } = await import('./decision-review.js');
    await runDecisionReviewCommand({ interactive: true });

    // Pitfall 10: readline output stream must be process.stderr.
    expect(outputSeenAs.stream).toBe(process.stderr);
    // Prompts asked on stderr (status prompt + notes prompt).
    expect(questionSpy).toHaveBeenCalledTimes(2);
    expect(writtenErr.toLowerCase()).toContain('status');
    // Structured rendering on stdout AFTER the prompt loop.
    expect(writtenBody.toLowerCase()).toContain('followed_up');
    // reviewDecisions called twice — once for the list, once for the update.
    expect(reviewSpy).toHaveBeenCalledTimes(2);
    expect(reviewSpy.mock.calls[1]?.[0]).toMatchObject({
      mode: 'update',
      id: target.id,
      status: 'followed_up',
    });
    expect(exitCode).toBe(0);
  });

  test('"skip" response → no update call, decision left as-is', async () => {
    const target = makeDecision({ id: '01HPASTWIN0000000000000002' });
    const { reviewSpy } = mockBootstrap((input) => {
      const i = input as { mode: string };
      if (i.mode === 'list') return { mode: 'list', decisions: [target] };
      return { mode: 'update', decision: target };
    });
    mockReadlinePromises(['skip']);
    vi.resetModules();
    const { runDecisionReviewCommand } = await import('./decision-review.js');
    await runDecisionReviewCommand({ interactive: true });
    // Only the initial 'list' call should fire.
    expect(reviewSpy).toHaveBeenCalledTimes(1);
    expect(exitCode).toBe(0);
  });

  test('non-past-window decisions are NOT prompted', async () => {
    // followUpDate in the far future → not past window.
    const target = makeDecision({
      followUpDate: '2099-12-31',
    });
    const { reviewSpy } = mockBootstrap(() => ({ mode: 'list', decisions: [target] }));
    const { questionSpy } = mockReadlinePromises([]);
    vi.resetModules();
    const { runDecisionReviewCommand } = await import('./decision-review.js');
    await runDecisionReviewCommand({ interactive: true });
    expect(questionSpy).not.toHaveBeenCalled();
    expect(reviewSpy).toHaveBeenCalledTimes(1);
    expect(exitCode).toBe(0);
  });
});

describe('runDecisionReviewCommand failure paths', () => {
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
    const { runDecisionReviewCommand, DECISION_REVIEW_EXIT_CODES } = await import(
      './decision-review.js'
    );
    await runDecisionReviewCommand({});
    expect(writtenBody).toContain('cp ');
    expect(exitCode).toBe(DECISION_REVIEW_EXIT_CODES.bootstrap_failed);
  });
});
