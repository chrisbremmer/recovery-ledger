// Plan 04-11 Task 3 query.test.ts — per-resource dispatch + --limit clamp +
// unknown-resource rejection.

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type { QueryCacheInput, QueryCacheResult } from '../../services/cache/types.js';

const originalExit = process.exit;
const originalWrite = process.stdout.write.bind(process.stdout);

let exitCode: number | undefined;
let writtenBody: string;

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
  queryImpl: (input: QueryCacheInput) => Promise<QueryCacheResult> | QueryCacheResult = (input) =>
    ({ resource: input.resource, rows: [], count: 0, truncated: false }) as QueryCacheResult,
  bootstrapImpl?: () => void,
): { querySpy: ReturnType<typeof vi.fn>; closeSpy: ReturnType<typeof vi.fn> } {
  const querySpy = vi.fn(async (input: QueryCacheInput) => queryImpl(input));
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
          services: { queryCache: querySpy },
          close: closeSpy,
        };
      }),
    };
  });
  return { querySpy, closeSpy };
}

describe('QUERY_EXIT_CODES', () => {
  test('exit-code map is frozen', async () => {
    const { QUERY_EXIT_CODES } = await import('./query.js');
    expect(Object.isFrozen(QUERY_EXIT_CODES)).toBe(true);
  });

  test('ok=0, invalid_input=1, bootstrap_failed=1', async () => {
    const { QUERY_EXIT_CODES } = await import('./query.js');
    expect(QUERY_EXIT_CODES.ok).toBe(0);
    expect(QUERY_EXIT_CODES.invalid_input).toBe(1);
    expect(QUERY_EXIT_CODES.bootstrap_failed).toBe(1);
  });
});

describe('runQueryCommand resource dispatch', () => {
  test('cycles with --since/--until/--limit passes the cycles arm through', async () => {
    const { querySpy } = mockBootstrap();
    vi.resetModules();
    const { runQueryCommand } = await import('./query.js');
    await runQueryCommand('cycles', {
      since: '2026-03-01',
      until: '2026-03-15',
      limit: 50,
    });
    expect(querySpy).toHaveBeenCalledWith({
      resource: 'cycles',
      since: '2026-03-01',
      until: '2026-03-15',
      limit: 50,
    });
    expect(exitCode).toBe(0);
  });

  test('cycles --include-unscored + --include-excluded pass through', async () => {
    const { querySpy } = mockBootstrap();
    vi.resetModules();
    const { runQueryCommand } = await import('./query.js');
    await runQueryCommand('cycles', {
      includeUnscored: true,
      includeExcluded: true,
    });
    const arg = querySpy.mock.calls[0]?.[0] as QueryCacheInput & {
      includeUnscored?: boolean;
      includeExcluded?: boolean;
    };
    expect(arg.resource).toBe('cycles');
    expect(arg.includeUnscored).toBe(true);
    expect(arg.includeExcluded).toBe(true);
    expect(exitCode).toBe(0);
  });

  test('recoveries with --min-recovery-score / --max-recovery-score pass through', async () => {
    const { querySpy } = mockBootstrap();
    vi.resetModules();
    const { runQueryCommand } = await import('./query.js');
    await runQueryCommand('recoveries', {
      minRecoveryScore: 50,
      maxRecoveryScore: 80,
    });
    const arg = querySpy.mock.calls[0]?.[0] as {
      resource: string;
      minRecoveryScore?: number;
      maxRecoveryScore?: number;
    };
    expect(arg.resource).toBe('recoveries');
    expect(arg.minRecoveryScore).toBe(50);
    expect(arg.maxRecoveryScore).toBe(80);
  });

  test('sleeps --include-unscored passes through', async () => {
    const { querySpy } = mockBootstrap();
    vi.resetModules();
    const { runQueryCommand } = await import('./query.js');
    await runQueryCommand('sleeps', { includeUnscored: true });
    const arg = querySpy.mock.calls[0]?.[0] as { resource: string; includeUnscored?: boolean };
    expect(arg.resource).toBe('sleeps');
    expect(arg.includeUnscored).toBe(true);
  });

  test('workouts --sport-id passes through', async () => {
    const { querySpy } = mockBootstrap();
    vi.resetModules();
    const { runQueryCommand } = await import('./query.js');
    await runQueryCommand('workouts', { sportId: 1 });
    const arg = querySpy.mock.calls[0]?.[0] as { resource: string; sportId?: number };
    expect(arg.resource).toBe('workouts');
    expect(arg.sportId).toBe(1);
  });

  test('profile dispatches without filters', async () => {
    const { querySpy } = mockBootstrap();
    vi.resetModules();
    const { runQueryCommand } = await import('./query.js');
    await runQueryCommand('profile', {});
    expect(querySpy).toHaveBeenCalledWith({ resource: 'profile' });
  });

  test('body_measurements with --since/--until/--limit passes through', async () => {
    const { querySpy } = mockBootstrap();
    vi.resetModules();
    const { runQueryCommand } = await import('./query.js');
    await runQueryCommand('body_measurements', {
      since: '2026-01-01',
      until: '2026-03-15',
      limit: 20,
    });
    const arg = querySpy.mock.calls[0]?.[0] as { resource: string; since?: string; limit?: number };
    expect(arg.resource).toBe('body_measurements');
    expect(arg.since).toBe('2026-01-01');
    expect(arg.limit).toBe(20);
  });

  test('sync_runs with --status passes through', async () => {
    const { querySpy } = mockBootstrap();
    vi.resetModules();
    const { runQueryCommand } = await import('./query.js');
    await runQueryCommand('sync_runs', { status: 'failed' });
    const arg = querySpy.mock.calls[0]?.[0] as { resource: string; status?: string };
    expect(arg.resource).toBe('sync_runs');
    expect(arg.status).toBe('failed');
  });

  test('decisions with --status + --category passes through', async () => {
    const { querySpy } = mockBootstrap();
    vi.resetModules();
    const { runQueryCommand } = await import('./query.js');
    await runQueryCommand('decisions', { status: 'open', category: 'training' });
    const arg = querySpy.mock.calls[0]?.[0] as {
      resource: string;
      status?: string;
      category?: string;
    };
    expect(arg.resource).toBe('decisions');
    expect(arg.status).toBe('open');
    expect(arg.category).toBe('training');
  });
});

describe('runQueryCommand input validation', () => {
  test('unknown resource → exit invalid_input + sanitized stdout', async () => {
    const { querySpy } = mockBootstrap();
    vi.resetModules();
    const { runQueryCommand, QUERY_EXIT_CODES } = await import('./query.js');
    await runQueryCommand('bogus_resource', {});
    expect(querySpy).not.toHaveBeenCalled();
    expect(writtenBody.toLowerCase()).toContain('unknown');
    expect(exitCode).toBe(QUERY_EXIT_CODES.invalid_input);
  });

  test('--limit > 500 passes through to the service (the service clamps; the CLI does not pre-validate)', async () => {
    const { querySpy } = mockBootstrap();
    vi.resetModules();
    const { runQueryCommand } = await import('./query.js');
    // We let the service own the clamp semantics (D-24 §last paragraph);
    // the CLI just hands the value through. The service-layer test pins
    // the clamp + truncated flag.
    await runQueryCommand('cycles', { limit: 1000 });
    const arg = querySpy.mock.calls[0]?.[0] as { limit?: number };
    expect(arg.limit).toBe(1000);
    expect(exitCode).toBe(0);
  });

  test('--include-unscored on profile (unsupported arm) → exit invalid_input', async () => {
    const { querySpy } = mockBootstrap();
    vi.resetModules();
    const { runQueryCommand, QUERY_EXIT_CODES } = await import('./query.js');
    await runQueryCommand('profile', { includeUnscored: true });
    expect(querySpy).not.toHaveBeenCalled();
    expect(writtenBody.toLowerCase()).toContain('include-unscored');
    expect(exitCode).toBe(QUERY_EXIT_CODES.invalid_input);
  });

  test('--include-excluded on recoveries (unsupported arm) → exit invalid_input', async () => {
    const { querySpy } = mockBootstrap();
    vi.resetModules();
    const { runQueryCommand, QUERY_EXIT_CODES } = await import('./query.js');
    await runQueryCommand('recoveries', { includeExcluded: true });
    expect(querySpy).not.toHaveBeenCalled();
    expect(writtenBody.toLowerCase()).toContain('include-excluded');
    expect(exitCode).toBe(QUERY_EXIT_CODES.invalid_input);
  });
});

describe('runQueryCommand failure paths', () => {
  test('bootstrap MigrationError → exit bootstrap_failed', async () => {
    const { MigrationError } = await import('../../infrastructure/db/migrate.js');
    mockBootstrap(undefined, () => {
      throw new MigrationError({
        kind: 'inconsistent_state',
        backupPath: '/tmp/recovery-ledger-test/backups/db.2026-05-20-pre-0001.sqlite',
        latestSafeMigration: '0000_initial',
      });
    });
    vi.resetModules();
    const { runQueryCommand, QUERY_EXIT_CODES } = await import('./query.js');
    await runQueryCommand('cycles', {});
    expect(writtenBody).toContain('cp ');
    expect(exitCode).toBe(QUERY_EXIT_CODES.bootstrap_failed);
  });
});
