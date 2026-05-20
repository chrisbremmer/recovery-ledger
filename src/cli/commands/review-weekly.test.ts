// Plan 04-11 Task 1 review-weekly.ts unit tests — mirror review-daily.test.ts.
// Patch process.exit + process.stdout.write per-test; vi.doMock the
// `bootstrap` re-export from `../../services/index.js` so we never open a
// real DB.

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type { WeeklyReviewResult } from '../../domain/review/types.js';

const originalExit = process.exit;
const originalWrite = process.stdout.write.bind(process.stdout);

let exitCode: number | undefined;
let writtenBody: string;

function makeWeekly(overrides: Partial<WeeklyReviewResult> = {}): WeeklyReviewResult {
  return {
    data_status: {
      reviewed_date: '2026-03-15',
      latest_sync_at: '2026-03-15T14:00:00.000Z',
      latest_sync_status: 'ok',
      staleness_days: 0,
      baseline_window: {
        start: '2026-02-16',
        end: '2026-03-15',
        scored_day_count: 28,
        coverage_pct: 0.93,
      },
      missing_resources: [],
      week_start: '2026-03-09',
      week_end: '2026-03-15',
      pattern_test_window: {
        start: '2026-02-16',
        end: '2026-03-15',
        scored_day_count: 28,
      },
    },
    week_summary: {
      scored_day_count: 7,
      worst_days: [],
      best_day: null,
      avg_strain: null,
      total_sleep_hours: null,
    },
    pattern: {
      kind: 'no_pattern',
      reason: 'no_factor_cleared_fdr',
    },
    candidate_results: [],
    decision_prompt: { kind: 'silent' },
    confidence: { tier: 'normal', sample_size: 28 } as unknown as WeeklyReviewResult['confidence'],
    ...overrides,
  } as WeeklyReviewResult;
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
  getWeeklyImpl: (input: unknown) => Promise<WeeklyReviewResult> | WeeklyReviewResult = () =>
    makeWeekly(),
  bootstrapImpl?: () => void,
): { weeklySpy: ReturnType<typeof vi.fn>; closeSpy: ReturnType<typeof vi.fn> } {
  const weeklySpy = vi.fn(async (input: unknown) => getWeeklyImpl(input));
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
          services: { getWeeklyReview: weeklySpy },
          close: closeSpy,
        };
      }),
    };
  });
  return { weeklySpy, closeSpy };
}

describe('REVIEW_WEEKLY_EXIT_CODES', () => {
  test('exit-code map is frozen', async () => {
    const { REVIEW_WEEKLY_EXIT_CODES } = await import('./review-weekly.js');
    expect(Object.isFrozen(REVIEW_WEEKLY_EXIT_CODES)).toBe(true);
  });

  test('ok=0, failed=1, bootstrap_failed=1', async () => {
    const { REVIEW_WEEKLY_EXIT_CODES } = await import('./review-weekly.js');
    expect(REVIEW_WEEKLY_EXIT_CODES.ok).toBe(0);
    expect(REVIEW_WEEKLY_EXIT_CODES.failed).toBe(1);
    expect(REVIEW_WEEKLY_EXIT_CODES.bootstrap_failed).toBe(1);
  });
});

describe('runReviewWeeklyCommand happy paths', () => {
  test('default opts (no --date) → bootstraps + calls service + writes rendered output + exits 0', async () => {
    const { weeklySpy, closeSpy } = mockBootstrap();
    vi.resetModules();
    const { runReviewWeeklyCommand } = await import('./review-weekly.js');
    await runReviewWeeklyCommand({});
    expect(weeklySpy).toHaveBeenCalledTimes(1);
    expect(writtenBody.length).toBeGreaterThan(0);
    expect(closeSpy).toHaveBeenCalled();
    expect(exitCode).toBe(0);
  });

  test('--date 2026-03-15 passes through to getWeeklyReview', async () => {
    const { weeklySpy } = mockBootstrap();
    vi.resetModules();
    const { runReviewWeeklyCommand } = await import('./review-weekly.js');
    await runReviewWeeklyCommand({ date: '2026-03-15' });
    expect(weeklySpy).toHaveBeenCalledWith(expect.objectContaining({ date: '2026-03-15' }));
    expect(exitCode).toBe(0);
  });

  test('decision_prompt slot renders when none_this_week kind is set', async () => {
    mockBootstrap(() =>
      makeWeekly({
        decision_prompt: {
          kind: 'none_this_week',
          suggested_text: 'No decisions recorded this week.',
        },
      }),
    );
    vi.resetModules();
    const { runReviewWeeklyCommand } = await import('./review-weekly.js');
    await runReviewWeeklyCommand({});
    expect(writtenBody).toContain('No decisions recorded this week.');
    expect(exitCode).toBe(0);
  });
});

describe('runReviewWeeklyCommand failure paths', () => {
  test('bootstrap throws MigrationError → exit bootstrap_failed + `cp <backup>` remediation', async () => {
    const { MigrationError } = await import('../../infrastructure/db/migrate.js');
    const err = new MigrationError({
      kind: 'inconsistent_state',
      backupPath: '/tmp/recovery-ledger-test/backups/db.2026-05-20-pre-0001.sqlite',
      latestSafeMigration: '0000_initial',
    });
    mockBootstrap(undefined, () => {
      throw err;
    });
    vi.resetModules();
    const { runReviewWeeklyCommand, REVIEW_WEEKLY_EXIT_CODES } = await import(
      './review-weekly.js'
    );
    await runReviewWeeklyCommand({});
    expect(writtenBody).toContain('cp ');
    expect(exitCode).toBe(REVIEW_WEEKLY_EXIT_CODES.bootstrap_failed);
  });

  test('service throws → exit failed with sanitized message', async () => {
    mockBootstrap(() => {
      throw new Error('something broke');
    });
    vi.resetModules();
    const { runReviewWeeklyCommand, REVIEW_WEEKLY_EXIT_CODES } = await import(
      './review-weekly.js'
    );
    await runReviewWeeklyCommand({});
    expect(writtenBody).toContain('Review failed');
    expect(exitCode).toBe(REVIEW_WEEKLY_EXIT_CODES.failed);
  });
});
