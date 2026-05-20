// Plan 04-11 Task 1 review-daily.ts unit tests — mirror sync.test.ts pattern.
// Patch process.exit + process.stdout.write per-test; vi.doMock the
// `bootstrap` re-export from `../../services/index.js` so we never open a
// real DB.

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type { DailyReviewResult } from '../../domain/review/types.js';

const originalExit = process.exit;
const originalWrite = process.stdout.write.bind(process.stdout);

let exitCode: number | undefined;
let writtenBody: string;

function makeDaily(overrides: Partial<DailyReviewResult> = {}): DailyReviewResult {
  return {
    data_status: {
      reviewed_date: '2026-03-15',
      sources_freshness: {
        cycles: 'fresh',
        recoveries: 'fresh',
        sleeps: 'fresh',
        workouts: 'fresh',
      },
      sources_completeness: {
        cycles: 'complete',
        recoveries: 'complete',
        sleeps: 'complete',
        workouts: 'complete',
      },
      pattern_test_window: { start: '2026-02-16', end: '2026-03-15' },
      week_start: '2026-03-09',
      week_end: '2026-03-15',
    } as unknown as DailyReviewResult['data_status'],
    today_state: {
      recovery_score: 67,
      hrv_rmssd_milli: 55,
      resting_heart_rate: 52,
      sleep_efficiency: 0.91,
      sleep_total_hours: 7.5,
    } as unknown as DailyReviewResult['today_state'],
    confidence: { tier: 'normal', sample_size: 28 } as unknown as DailyReviewResult['confidence'],
    anomalies: [],
    patterns: [],
    actions: [],
    insufficient_reason: null,
    ...overrides,
  } as DailyReviewResult;
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
  getDailyImpl: (input: unknown) => Promise<DailyReviewResult> | DailyReviewResult = () =>
    makeDaily(),
  bootstrapImpl?: () => void,
): { dailySpy: ReturnType<typeof vi.fn>; closeSpy: ReturnType<typeof vi.fn> } {
  const dailySpy = vi.fn(async (input: unknown) => getDailyImpl(input));
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
          services: { getDailyReview: dailySpy },
          close: closeSpy,
        };
      }),
    };
  });
  return { dailySpy, closeSpy };
}

describe('REVIEW_EXIT_CODES', () => {
  test('exit-code map is frozen', async () => {
    const { REVIEW_EXIT_CODES } = await import('./review-daily.js');
    expect(Object.isFrozen(REVIEW_EXIT_CODES)).toBe(true);
  });

  test('ok=0, failed=1, bootstrap_failed=1', async () => {
    const { REVIEW_EXIT_CODES } = await import('./review-daily.js');
    expect(REVIEW_EXIT_CODES.ok).toBe(0);
    expect(REVIEW_EXIT_CODES.failed).toBe(1);
    expect(REVIEW_EXIT_CODES.bootstrap_failed).toBe(1);
  });
});

describe('runReviewDailyCommand happy paths', () => {
  test('default opts (no --date) → bootstraps + calls service + writes rendered output + exits 0', async () => {
    const { dailySpy, closeSpy } = mockBootstrap();
    vi.resetModules();
    const { runReviewDailyCommand } = await import('./review-daily.js');
    await runReviewDailyCommand({});
    expect(dailySpy).toHaveBeenCalledTimes(1);
    expect(dailySpy).toHaveBeenCalledWith(expect.objectContaining({}));
    expect(writtenBody.length).toBeGreaterThan(0);
    expect(closeSpy).toHaveBeenCalled();
    expect(exitCode).toBe(0);
  });

  test('--date 2026-03-15 passes through to getDailyReview', async () => {
    const { dailySpy } = mockBootstrap();
    vi.resetModules();
    const { runReviewDailyCommand } = await import('./review-daily.js');
    await runReviewDailyCommand({ date: '2026-03-15' });
    expect(dailySpy).toHaveBeenCalledWith(expect.objectContaining({ date: '2026-03-15' }));
    expect(exitCode).toBe(0);
  });
});

describe('runReviewDailyCommand failure paths', () => {
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
    const { runReviewDailyCommand, REVIEW_EXIT_CODES } = await import('./review-daily.js');
    await runReviewDailyCommand({});
    expect(writtenBody).toContain('cp ');
    expect(writtenBody).toContain('/tmp/recovery-ledger-test/backups/');
    expect(exitCode).toBe(REVIEW_EXIT_CODES.bootstrap_failed);
  });

  test('bootstrap throws generic Error → sanitized stdout + exit bootstrap_failed', async () => {
    mockBootstrap(undefined, () => {
      throw new Error('open(/tmp/db.sqlite) refused');
    });
    vi.resetModules();
    const { runReviewDailyCommand, REVIEW_EXIT_CODES } = await import('./review-daily.js');
    await runReviewDailyCommand({});
    expect(writtenBody).toContain('Bootstrap failed');
    expect(exitCode).toBe(REVIEW_EXIT_CODES.bootstrap_failed);
  });

  test('service throws → exit failed with sanitized message', async () => {
    mockBootstrap(() => {
      throw new Error('something broke');
    });
    vi.resetModules();
    const { runReviewDailyCommand, REVIEW_EXIT_CODES } = await import('./review-daily.js');
    await runReviewDailyCommand({});
    expect(writtenBody).toContain('Review failed');
    expect(exitCode).toBe(REVIEW_EXIT_CODES.failed);
  });
});
