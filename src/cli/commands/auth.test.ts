// Plan 02-05 auth.ts unit tests (A-01..A-10).
//
// Test harness mirrors src/cli/commands/doctor.test.ts: mock process.exit +
// process.stdout.write per-test; vi.doMock runOAuth + tokenStore + readFile
// for the relevant arms; RECOVERY_LEDGER_HOME points at a tmpdir.

import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

const originalExit = process.exit;
const originalWrite = process.stdout.write.bind(process.stdout);
const originalEnv = { ...process.env };

let tmp: string;
let exitCode: number | undefined;
let writtenBody: string;

const syntheticTokens = {
  accessToken: 'at',
  refreshToken: 'rt',
  tokenType: 'bearer' as const,
  scope: 'offline read:recovery',
  obtainedAt: 1700000000000,
  expiresAt: 1700000003600000,
};

beforeEach(async () => {
  tmp = await mkdtemp(join(tmpdir(), 'rl-auth-test-'));
  exitCode = undefined;
  writtenBody = '';
  process.env = { ...originalEnv };
  process.env.RECOVERY_LEDGER_HOME = tmp;
  delete process.env.WHOOP_CLIENT_ID;
  delete process.env.WHOOP_CLIENT_SECRET;

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

afterEach(async () => {
  process.exit = originalExit;
  process.stdout.write = originalWrite;
  process.env = { ...originalEnv };
  vi.resetModules();
  vi.doUnmock('../../infrastructure/whoop/oauth.js');
  vi.doUnmock('../../infrastructure/whoop/token-store.js');
  await rm(tmp, { recursive: true, force: true });
});

// Helper: seed a valid config.json under tmp/config.json so auth.ts can read it.
async function seedConfig(
  overrides: Partial<{
    clientId: string;
    clientSecret: string;
    redirectPort: number;
  }> = {},
): Promise<void> {
  await mkdir(tmp, { recursive: true });
  const config = {
    clientId: overrides.clientId ?? 'cid',
    clientSecret: overrides.clientSecret ?? 'sec',
    redirectPort: overrides.redirectPort ?? 4321,
    scopes: [
      'offline',
      'read:recovery',
      'read:sleep',
      'read:workout',
      'read:cycles',
      'read:profile',
      'read:body_measurement',
    ],
  };
  await writeFile(join(tmp, 'config.json'), JSON.stringify(config, null, 2), { mode: 0o600 });
}

// Mock runOAuth to either resolve with synthetic tokens or reject with a kind.
function mockRunOAuth(impl: () => Promise<unknown>): {
  runOAuthSpy: ReturnType<typeof vi.fn>;
} {
  const runOAuthSpy = vi.fn(impl);
  vi.doMock('../../infrastructure/whoop/oauth.js', async () => {
    const actual = await vi.importActual<typeof import('../../infrastructure/whoop/oauth.js')>(
      '../../infrastructure/whoop/oauth.js',
    );
    return {
      ...actual,
      runOAuth: runOAuthSpy,
    };
  });
  return { runOAuthSpy };
}

// Mock tokenStore.write to a spy.
function mockTokenStoreWrite(impl: (t: unknown) => Promise<void> = async () => undefined): {
  writeSpy: ReturnType<typeof vi.fn>;
} {
  const writeSpy = vi.fn(impl);
  vi.doMock('../../infrastructure/whoop/token-store.js', async () => {
    const actual = await vi.importActual<
      typeof import('../../infrastructure/whoop/token-store.js')
    >('../../infrastructure/whoop/token-store.js');
    return {
      ...actual,
      tokenStore: {
        ...actual.tokenStore,
        write: writeSpy,
      },
    };
  });
  return { writeSpy };
}

// ---------------------------------------------------------------------------
// A-01..A-10
// ---------------------------------------------------------------------------

describe('runAuthCommand', () => {
  test('A-01 happy path — runOAuth resolves, tokens written, success message', async () => {
    await seedConfig();
    mockRunOAuth(async () => syntheticTokens);
    const { writeSpy } = mockTokenStoreWrite();
    vi.resetModules();
    const { runAuthCommand } = await import('./auth.js');
    await runAuthCommand({ noBrowser: true });

    expect(writeSpy).toHaveBeenCalledWith(syntheticTokens);
    expect(writtenBody).toContain('Authorization complete.');
    expect(exitCode).toBe(0);
  });

  test('A-02 state mismatch — formatAuthError remediation, exit 1', async () => {
    await seedConfig();
    const { AuthError } = await import('../../infrastructure/whoop/errors.js');
    mockRunOAuth(async () => {
      throw new AuthError({ kind: 'auth_state_mismatch' });
    });
    mockTokenStoreWrite();
    vi.resetModules();
    const { runAuthCommand } = await import('./auth.js');
    await runAuthCommand({ noBrowser: true });

    expect(exitCode).toBe(1);
    // formatAuthError text for auth_state_mismatch mentions "state mismatch"
    // and a remediation phrase. The raw kind string is acceptable too — what
    // matters is some user-facing copy is emitted via formatAuthError, not
    // the raw error.message.
    expect(writtenBody.toLowerCase()).toMatch(/state mismatch|csrf|recovery-ledger auth/);
  });

  test('A-03 timeout — exit 1, remediation mentions auth or timeout', async () => {
    await seedConfig();
    const { AuthError } = await import('../../infrastructure/whoop/errors.js');
    mockRunOAuth(async () => {
      throw new AuthError({ kind: 'auth_timeout' });
    });
    mockTokenStoreWrite();
    vi.resetModules();
    const { runAuthCommand } = await import('./auth.js');
    await runAuthCommand({ noBrowser: true });

    expect(exitCode).toBe(1);
    expect(writtenBody.toLowerCase()).toMatch(/recovery-ledger auth|time/);
  });

  test('A-04 port in use — exit 1, remediation mentions init AND port number', async () => {
    await seedConfig();
    const { AuthError } = await import('../../infrastructure/whoop/errors.js');
    mockRunOAuth(async () => {
      throw new AuthError({ kind: 'auth_port_in_use', detail: 'port 4321' });
    });
    mockTokenStoreWrite();
    vi.resetModules();
    const { runAuthCommand } = await import('./auth.js');
    await runAuthCommand({ noBrowser: true });

    expect(exitCode).toBe(1);
    expect(writtenBody).toContain('recovery-ledger init');
    expect(writtenBody).toContain('4321');
  });

  test('A-05 refresh_failed during code exchange — exit 1', async () => {
    await seedConfig();
    const { AuthError } = await import('../../infrastructure/whoop/errors.js');
    mockRunOAuth(async () => {
      throw new AuthError({ kind: 'refresh_failed', detail: 'token endpoint 400' });
    });
    mockTokenStoreWrite();
    vi.resetModules();
    const { runAuthCommand } = await import('./auth.js');
    await runAuthCommand({ noBrowser: true });

    expect(exitCode).toBe(1);
  });

  test('A-06 --no-browser passes noBrowser: true to runOAuth', async () => {
    await seedConfig();
    const { runOAuthSpy } = mockRunOAuth(async () => syntheticTokens);
    mockTokenStoreWrite();
    vi.resetModules();
    const { runAuthCommand } = await import('./auth.js');
    await runAuthCommand({ noBrowser: true });

    expect(runOAuthSpy).toHaveBeenCalledTimes(1);
    const args = runOAuthSpy.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(args.noBrowser).toBe(true);
  });

  test('A-07 --timeout 60 passes timeoutMs: 60000', async () => {
    await seedConfig();
    const { runOAuthSpy } = mockRunOAuth(async () => syntheticTokens);
    mockTokenStoreWrite();
    vi.resetModules();
    const { runAuthCommand } = await import('./auth.js');
    await runAuthCommand({ noBrowser: true, timeout: 60 });

    const args = runOAuthSpy.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(args.timeoutMs).toBe(60_000);
  });

  test('A-08 config missing — exit 1, suggests `recovery-ledger init`', async () => {
    // No seedConfig — tmp/config.json does not exist.
    mockRunOAuth(async () => syntheticTokens);
    mockTokenStoreWrite();
    vi.resetModules();
    const { runAuthCommand } = await import('./auth.js');
    await runAuthCommand({ noBrowser: true });

    expect(exitCode).toBe(1);
    expect(writtenBody).toContain('recovery-ledger init');
  });

  test('A-09 env-var override at auth time — D-06 precedence', async () => {
    await seedConfig({ clientId: 'fileid', clientSecret: 'filesec' });
    process.env.WHOOP_CLIENT_ID = 'envid';
    process.env.WHOOP_CLIENT_SECRET = 'envsec';
    const { runOAuthSpy } = mockRunOAuth(async () => syntheticTokens);
    mockTokenStoreWrite();
    vi.resetModules();
    const { runAuthCommand } = await import('./auth.js');
    await runAuthCommand({ noBrowser: true });

    const args = runOAuthSpy.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(args.clientId).toBe('envid');
    expect(args.clientSecret).toBe('envsec');
  });

  test('A-10 canonical schema import: no inline z.object in auth.ts', async () => {
    const { readFile: readSrc } = await import('node:fs/promises');
    const src = await readSrc('src/cli/commands/auth.ts', 'utf8');
    expect(src).toMatch(/from '\.\.\/\.\.\/infrastructure\/config\/schema\.js'/);
    expect(src).not.toMatch(/z\.object\(/);
  });

  test('AUTH_EXIT_CODES is frozen and covers all six AuthError kinds', async () => {
    vi.resetModules();
    const { AUTH_EXIT_CODES } = await import('./auth.js');
    expect(Object.isFrozen(AUTH_EXIT_CODES)).toBe(true);
    expect(AUTH_EXIT_CODES.success).toBe(0);
    expect(AUTH_EXIT_CODES.auth_missing).toBe(1);
    expect(AUTH_EXIT_CODES.auth_expired).toBe(1);
    expect(AUTH_EXIT_CODES.auth_state_mismatch).toBe(1);
    expect(AUTH_EXIT_CODES.auth_timeout).toBe(1);
    expect(AUTH_EXIT_CODES.auth_port_in_use).toBe(1);
    expect(AUTH_EXIT_CODES.refresh_failed).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Commander wiring tests (C-01, C-02)
// ---------------------------------------------------------------------------

describe('Commander wiring (src/cli/index.ts)', () => {
  test('C-01 / C-02 init and auth commands are present in the index source', async () => {
    const { readFile: readSrc } = await import('node:fs/promises');
    const src = await readSrc('src/cli/index.ts', 'utf8');
    expect(src).toMatch(/\.command\('init'\)/);
    expect(src).toMatch(/\.command\('auth'\)/);
    expect(src).toContain('--no-browser');
    expect(src).toContain('--timeout');
  });
});
