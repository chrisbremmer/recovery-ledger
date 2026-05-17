// Plan 03-12 Task 1 sync.ts unit tests — 12 assertions per the plan
// acceptance criteria. Test harness mirrors src/cli/commands/auth.test.ts:
// patch process.exit + process.stdout.write per-test; vi.doMock the
// `bootstrap` re-export from `../../services/index.js` so we never open a
// real DB or run a real migrator under test.

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type { RunSyncResult } from '../../domain/types/sync.js';

const originalExit = process.exit;
const originalWrite = process.stdout.write.bind(process.stdout);

let exitCode: number | undefined;
let writtenBody: string;

// Shared synthetic result builder — every test starts from this and
// overlays the fields under assertion.
function makeResult(overrides: Partial<RunSyncResult> = {}): RunSyncResult {
  return {
    status: 'ok',
    perResource: {
      profile: { status: 'success', fetched: 1, upserted: 1, durationMs: 10 },
      body_measurements: { status: 'success', fetched: 1, upserted: 1, durationMs: 8 },
      cycles: { status: 'success', fetched: 42, upserted: 42, durationMs: 120 },
      recoveries: { status: 'success', fetched: 42, upserted: 42, durationMs: 180 },
      sleeps: { status: 'success', fetched: 14, upserted: 14, durationMs: 90 },
      workouts: { status: 'success', fetched: 10, upserted: 10, durationMs: 200 },
    },
    syncRunId: 17,
    gapsDetected: 0,
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
  vi.doUnmock('../../infrastructure/config/paths.js');
});

/**
 * Install a vi.doMock for `../../services/index.js`'s `bootstrap` factory.
 * Returns the runSync spy + close spy so each test can pin its assertions
 * against the same call sites without re-wiring boilerplate.
 */
function mockBootstrap(
  runSyncImpl: (input: unknown) => Promise<RunSyncResult> | RunSyncResult = () => makeResult(),
  bootstrapImpl?: () => void,
): { runSyncSpy: ReturnType<typeof vi.fn>; closeSpy: ReturnType<typeof vi.fn> } {
  const runSyncSpy = vi.fn(async (input: unknown) => runSyncImpl(input));
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
          services: { runSync: runSyncSpy },
          close: closeSpy,
        };
      }),
    };
  });
  return { runSyncSpy, closeSpy };
}

// ---------------------------------------------------------------------------
// SYNC_EXIT_CODES — frozen + correct mapping per D-26 / Plan 02-05 precedent.
// ---------------------------------------------------------------------------

describe('SYNC_EXIT_CODES', () => {
  test('exit-code map is frozen', async () => {
    const { SYNC_EXIT_CODES } = await import('./sync.js');
    expect(Object.isFrozen(SYNC_EXIT_CODES)).toBe(true);
  });

  test('partial exits 0 (T-03.12-04: soft success)', async () => {
    const { SYNC_EXIT_CODES } = await import('./sync.js');
    expect(SYNC_EXIT_CODES.partial).toBe(0);
    expect(SYNC_EXIT_CODES.ok).toBe(0);
  });

  test('failed / invalid_input / bootstrap_failed all exit 1', async () => {
    const { SYNC_EXIT_CODES } = await import('./sync.js');
    expect(SYNC_EXIT_CODES.failed).toBe(1);
    expect(SYNC_EXIT_CODES.invalid_input).toBe(1);
    expect(SYNC_EXIT_CODES.bootstrap_failed).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Happy-path + flag pass-through — Tests 1..4 in the plan.
// ---------------------------------------------------------------------------

describe('runSyncCommand happy paths', () => {
  test('Test 1: {days: 30} → runSync called once with {days: 30}; exit 0', async () => {
    const { runSyncSpy } = mockBootstrap();
    vi.resetModules();
    const { runSyncCommand } = await import('./sync.js');
    await runSyncCommand({ days: 30 });
    expect(runSyncSpy).toHaveBeenCalledTimes(1);
    expect(runSyncSpy).toHaveBeenCalledWith(expect.objectContaining({ days: 30 }));
    expect(writtenBody).toContain('Status: ok');
    expect(exitCode).toBe(0);
  });

  test('Test 2: {days: 7} passes through to runSync', async () => {
    const { runSyncSpy } = mockBootstrap();
    vi.resetModules();
    const { runSyncCommand } = await import('./sync.js');
    await runSyncCommand({ days: 7 });
    expect(runSyncSpy).toHaveBeenCalledWith(expect.objectContaining({ days: 7 }));
    expect(exitCode).toBe(0);
  });

  test('Test 3: {since: ISO} passes through; days still defaults to 30', async () => {
    const { runSyncSpy } = mockBootstrap();
    vi.resetModules();
    const { runSyncCommand } = await import('./sync.js');
    await runSyncCommand({ since: '2026-01-01T00:00:00.000Z' });
    expect(runSyncSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        days: 30,
        since: '2026-01-01T00:00:00.000Z',
      }),
    );
    expect(exitCode).toBe(0);
  });

  test('Test 4: {resources: "cycles,recoveries"} → parsed array passed through', async () => {
    const { runSyncSpy } = mockBootstrap();
    vi.resetModules();
    const { runSyncCommand } = await import('./sync.js');
    await runSyncCommand({ resources: 'cycles,recoveries' });
    const arg = runSyncSpy.mock.calls[0]?.[0] as { resources?: readonly string[] };
    expect(arg.resources).toEqual(['cycles', 'recoveries']);
    expect(exitCode).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Input validation — Tests 5, 6 in the plan (T-03.12-02 / T-03.12-03).
// ---------------------------------------------------------------------------

describe('runSyncCommand input validation', () => {
  test('Test 5: {resources: "invalid,cycles"} → exit invalid_input + sanitized stdout', async () => {
    const { runSyncSpy } = mockBootstrap();
    vi.resetModules();
    const { runSyncCommand, SYNC_EXIT_CODES } = await import('./sync.js');
    await runSyncCommand({ resources: 'invalid,cycles' });
    expect(runSyncSpy).not.toHaveBeenCalled();
    expect(writtenBody.toLowerCase()).toContain('invalid');
    expect(writtenBody).toContain('invalid');
    expect(exitCode).toBe(SYNC_EXIT_CODES.invalid_input);
  });

  test('Test 6: {since: "not-a-date"} → exit invalid_input', async () => {
    const { runSyncSpy } = mockBootstrap();
    vi.resetModules();
    const { runSyncCommand, SYNC_EXIT_CODES } = await import('./sync.js');
    await runSyncCommand({ since: 'not-a-date' });
    expect(runSyncSpy).not.toHaveBeenCalled();
    expect(writtenBody.toLowerCase()).toContain('iso');
    expect(exitCode).toBe(SYNC_EXIT_CODES.invalid_input);
  });

  test('Test 6b: {resources: "cycles,,recoveries"} → exit invalid_input (empty token rejected)', async () => {
    const { runSyncSpy } = mockBootstrap();
    vi.resetModules();
    const { runSyncCommand, SYNC_EXIT_CODES } = await import('./sync.js');
    await runSyncCommand({ resources: 'cycles,,recoveries' });
    expect(runSyncSpy).not.toHaveBeenCalled();
    expect(writtenBody.toLowerCase()).toContain('empty token');
    expect(exitCode).toBe(SYNC_EXIT_CODES.invalid_input);
  });

  test('Test 6c: {resources: "cycles,"} → exit invalid_input (trailing comma rejected)', async () => {
    const { runSyncSpy } = mockBootstrap();
    vi.resetModules();
    const { runSyncCommand, SYNC_EXIT_CODES } = await import('./sync.js');
    await runSyncCommand({ resources: 'cycles,' });
    expect(runSyncSpy).not.toHaveBeenCalled();
    expect(writtenBody.toLowerCase()).toContain('empty token');
    expect(exitCode).toBe(SYNC_EXIT_CODES.invalid_input);
  });

  test('Test 6d: {since: future ISO} → exit invalid_input (future --since rejected)', async () => {
    const { runSyncSpy } = mockBootstrap();
    vi.resetModules();
    const { runSyncCommand, SYNC_EXIT_CODES } = await import('./sync.js');
    // 24h in the future relative to wall clock.
    const future = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    await runSyncCommand({ since: future });
    expect(runSyncSpy).not.toHaveBeenCalled();
    expect(writtenBody.toLowerCase()).toContain('future');
    expect(exitCode).toBe(SYNC_EXIT_CODES.invalid_input);
  });
});

// ---------------------------------------------------------------------------
// Result status → exit code mapping — Tests 7, 8 in the plan.
// ---------------------------------------------------------------------------

describe('runSyncCommand result-status mapping', () => {
  test('Test 7: result.status === partial → exit 0 (soft success)', async () => {
    mockBootstrap(() =>
      makeResult({
        status: 'partial',
        perResource: {
          profile: { status: 'success', fetched: 1, upserted: 1 },
          body_measurements: { status: 'success', fetched: 1, upserted: 1 },
          cycles: { status: 'success', fetched: 1, upserted: 1 },
          recoveries: { status: 'success', fetched: 1, upserted: 1 },
          sleeps: { status: 'success', fetched: 1, upserted: 1 },
          workouts: { status: 'partial_429', fetched: 10, upserted: 10 },
        },
      }),
    );
    vi.resetModules();
    const { runSyncCommand } = await import('./sync.js');
    await runSyncCommand({ days: 30 });
    expect(writtenBody).toContain('Status: partial');
    expect(exitCode).toBe(0);
  });

  test('Test 8: result.status === failed → exit 1', async () => {
    mockBootstrap(() =>
      makeResult({
        status: 'failed',
        perResource: {
          profile: { status: 'failed_auth' },
          body_measurements: { status: 'failed_auth' },
          cycles: { status: 'failed_auth' },
          recoveries: { status: 'failed_auth' },
          sleeps: { status: 'failed_auth' },
          workouts: { status: 'failed_auth' },
        },
      }),
    );
    vi.resetModules();
    const { runSyncCommand } = await import('./sync.js');
    await runSyncCommand({ days: 30 });
    expect(writtenBody).toContain('Status: failed');
    expect(exitCode).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Bootstrap-failure + service-throw paths — Tests 9, 10 in the plan.
// ---------------------------------------------------------------------------

describe('runSyncCommand failure paths', () => {
  test('Test 9: bootstrap throws MigrationError → exit 1 + remediation includes `cp <backupPath>`', async () => {
    const { MigrationError } = await import('../../infrastructure/db/migrate.js');
    const err = new MigrationError({
      kind: 'inconsistent_state',
      backupPath: '/tmp/recovery-ledger-test/backups/db.2026-05-16-pre-0001.sqlite',
      latestSafeMigration: '0000_initial',
    });
    mockBootstrap(undefined, () => {
      throw err;
    });
    vi.resetModules();
    const { runSyncCommand, SYNC_EXIT_CODES } = await import('./sync.js');
    await runSyncCommand({ days: 30 });
    expect(writtenBody).toContain('cp ');
    expect(writtenBody).toContain(
      '/tmp/recovery-ledger-test/backups/db.2026-05-16-pre-0001.sqlite',
    );
    expect(exitCode).toBe(SYNC_EXIT_CODES.bootstrap_failed);
  });

  test('Test 10: runSync throws AuthError → formatAuthError remediation; exit 1', async () => {
    const { AuthError } = await import('../../infrastructure/whoop/errors.js');
    mockBootstrap(() => {
      throw new AuthError({ kind: 'auth_expired' });
    });
    vi.resetModules();
    const { runSyncCommand, SYNC_EXIT_CODES } = await import('./sync.js');
    await runSyncCommand({ days: 30 });
    // formatAuthError for auth_expired says "WHOOP tokens have expired —
    // run `recovery-ledger auth` to re-authorize."
    expect(writtenBody.toLowerCase()).toMatch(/recovery-ledger auth|expired/);
    expect(exitCode).toBe(SYNC_EXIT_CODES.failed);
  });
});

// ---------------------------------------------------------------------------
// Commander wiring — Test 11 (programmatic --days 7 → action receives 7) +
// Test 12 (--help mentions --days, --since, --resources, exit codes).
// ---------------------------------------------------------------------------

describe('Commander wiring (src/cli/index.ts)', () => {
  test('Test 11: program.parseAsync(["sync", "--days", "7"]) → action receives {days: 7}', async () => {
    const actionSpy = vi.fn();
    vi.doMock('./sync.js', () => ({
      runSyncCommand: actionSpy,
      // SYNC_EXIT_CODES is read at the module-load of the action handler;
      // not needed for the wiring test, but mirror the export so dynamic
      // re-imports do not break.
      SYNC_EXIT_CODES: { ok: 0, partial: 0, failed: 1, invalid_input: 1, bootstrap_failed: 1 },
    }));
    vi.resetModules();
    const { buildProgram } = await import('../index.js');
    const program = buildProgram();
    // Commander's `.exitOverride()` would normally surface as a throw; we
    // pass clean argv so no error path executes.
    await program.parseAsync(['node', 'recovery-ledger', 'sync', '--days', '7'], { from: 'node' });
    expect(actionSpy).toHaveBeenCalledTimes(1);
    const opts = actionSpy.mock.calls[0]?.[0] as { days?: number };
    expect(opts.days).toBe(7);
    vi.doUnmock('./sync.js');
  });

  test('Test 12: sync --help mentions --days, --since, --resources, exit codes', async () => {
    vi.resetModules();
    const { buildProgram } = await import('../index.js');
    const program = buildProgram();
    const syncCmd = program.commands.find((c) => c.name() === 'sync');
    expect(syncCmd).toBeDefined();
    // helpInformation() returns the Commander-built usage + options block but
    // does NOT include addHelpText('after', ...) — that text is emitted via
    // the `afterAll`/`after` event handlers and only surfaces through
    // outputHelp(). Capture via configureOutput so the test does not write
    // to real stdout.
    let captured = '';
    syncCmd?.configureOutput({
      writeOut: (s) => {
        captured += s;
      },
      writeErr: (s) => {
        captured += s;
      },
    });
    syncCmd?.outputHelp();
    expect(captured).toContain('--days');
    expect(captured).toContain('--since');
    expect(captured).toContain('--resources');
    expect(captured).toContain('Exit codes');
    expect(captured).toContain('0  ok');
    expect(captured).toContain('1  failed');
  });
});
