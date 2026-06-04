// Plan 04-11 Task 1 api-gap.ts unit tests — simplest of the three shims.

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type { ApiGapResult } from '../../services/api-gap.js';

const originalExit = process.exit;
const originalWrite = process.stdout.write.bind(process.stdout);

let exitCode: number | undefined;
let writtenBody: string;

function makeGap(): ApiGapResult {
  return {
    entries: [
      {
        feature: 'Journal',
        whoop_consumer_path: 'App > More > Journal',
        available_via_v2_api: false,
        alternative_via_v2: null,
        notes: 'Journal entries are not exposed via v2 API.',
      },
    ],
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
  apiGapImpl: () => Promise<ApiGapResult> | ApiGapResult = () => makeGap(),
  bootstrapImpl?: () => void,
): { apiGapSpy: ReturnType<typeof vi.fn>; closeSpy: ReturnType<typeof vi.fn> } {
  const apiGapSpy = vi.fn(async () => apiGapImpl());
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
          services: { getApiGap: apiGapSpy },
          close: closeSpy,
        };
      }),
    };
  });
  return { apiGapSpy, closeSpy };
}

describe('API_GAP_EXIT_CODES', () => {
  test('exit-code map is frozen', async () => {
    const { API_GAP_EXIT_CODES } = await import('./api-gap.js');
    expect(Object.isFrozen(API_GAP_EXIT_CODES)).toBe(true);
  });

  test('ok=0, bootstrap_failed=1', async () => {
    const { API_GAP_EXIT_CODES } = await import('./api-gap.js');
    expect(API_GAP_EXIT_CODES.ok).toBe(0);
    expect(API_GAP_EXIT_CODES.bootstrap_failed).toBe(1);
  });
});

describe('runApiGapCommand', () => {
  test('bootstraps + renders + exits 0', async () => {
    const { apiGapSpy, closeSpy } = mockBootstrap();
    vi.resetModules();
    const { runApiGapCommand } = await import('./api-gap.js');
    await runApiGapCommand();
    expect(apiGapSpy).toHaveBeenCalledTimes(1);
    expect(writtenBody).toContain('Journal');
    expect(closeSpy).toHaveBeenCalled();
    expect(exitCode).toBe(0);
  });

  test('bootstrap throws MigrationError → exit bootstrap_failed', async () => {
    const { MigrationError } = await import('../../domain/errors/migration.js');
    const err = new MigrationError({
      kind: 'inconsistent_state',
      backupPath: '/tmp/recovery-ledger-test/backups/db.2026-05-20-pre-0001.sqlite',
      latestSafeMigration: '0000_initial',
    });
    mockBootstrap(undefined, () => {
      throw err;
    });
    vi.resetModules();
    const { runApiGapCommand, API_GAP_EXIT_CODES } = await import('./api-gap.js');
    await runApiGapCommand();
    expect(writtenBody).toContain('cp ');
    expect(exitCode).toBe(API_GAP_EXIT_CODES.bootstrap_failed);
  });

  test('bootstrap throws generic Error → sanitized stdout + exit bootstrap_failed', async () => {
    mockBootstrap(undefined, () => {
      throw new Error('open(/tmp/db.sqlite) refused');
    });
    vi.resetModules();
    const { runApiGapCommand, API_GAP_EXIT_CODES } = await import('./api-gap.js');
    await runApiGapCommand();
    expect(writtenBody).toContain('Bootstrap failed');
    expect(exitCode).toBe(API_GAP_EXIT_CODES.bootstrap_failed);
  });
});
