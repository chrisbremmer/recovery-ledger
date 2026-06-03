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

// Phase 10 ARCH-02 (#85): auth.ts now constructs its own TokenStore via
// `createTokenStore()` (Q7-RESOLVED documented exception — the OAuth login
// flow does not bootstrap). The test mocks the FACTORY so the runtime
// `tokenStore` inside auth.ts is the fake we control, while keeping every
// other token-store export (createTokenStore returns this same fake; the
// real `TokenStore` type stays unchanged).
function mockTokenStoreWrite(impl: (t: unknown) => Promise<void> = async () => undefined): {
  writeSpy: ReturnType<typeof vi.fn>;
} {
  const writeSpy = vi.fn(impl);
  vi.doMock('../../infrastructure/whoop/token-store.js', async () => {
    const actual = await vi.importActual<
      typeof import('../../infrastructure/whoop/token-store.js')
    >('../../infrastructure/whoop/token-store.js');
    // The fake TokenStore satisfies the TokenStore interface; only
    // `write` carries observable behavior — the other methods are unused
    // by the OAuth-login command path.
    const fakeStore = {
      getValidAccessToken: async () => 'unused',
      read: async () => null,
      write: writeSpy,
      clear: async () => undefined,
      readStorageMode: async () => null,
    };
    return {
      ...actual,
      createTokenStore: () => fakeStore,
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
    const { AuthError } = await import('../../domain/errors/auth.js');
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
    const { AuthError } = await import('../../domain/errors/auth.js');
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
    const { AuthError } = await import('../../domain/errors/auth.js');
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
    const { AuthError } = await import('../../domain/errors/auth.js');
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

  test('A-11 (CR-04 regression): ZodError-bearing config does NOT leak field VALUES to stdout (field NAMES only)', async () => {
    // CR-04: ZodError.message embeds offending values verbatim. Seed a
    // config.json with a clearly-fingerprinted clientSecret that fails
    // validation (empty string fails `.min(1)` in the canonical schema).
    // Pre-fix: the outer `String(err)` arm printed the full ZodError including
    // every field's invalid value. Post-fix: the parse arm runs first,
    // prints field names only, and exits 1 before the outer arm sees it.
    await mkdir(tmp, { recursive: true });
    const fingerprint = 'SECRET-FINGERPRINT-DO-NOT-LEAK';
    const corrupt = {
      clientId: '',
      // Embed the fingerprint where a default ZodError would echo it. The
      // CANONICAL ConfigSchema requires `clientSecret` to be a string of
      // length >= 1; an empty string is what triggers the leak, but a
      // value-bearing field that fails a different check (e.g., redirectPort
      // not a number) is what surfaces the value in the ZodError text. We
      // use redirectPort here because that path embeds the actual bad value.
      clientSecret: fingerprint,
      redirectPort: 'not-a-number',
      scopes: [],
    };
    await writeFile(join(tmp, 'config.json'), JSON.stringify(corrupt), { mode: 0o600 });
    mockRunOAuth(async () => syntheticTokens);
    mockTokenStoreWrite();
    vi.resetModules();
    const { runAuthCommand } = await import('./auth.js');
    await runAuthCommand({ noBrowser: true });

    expect(exitCode).toBe(1);
    // The fingerprint must not appear anywhere in stdout.
    expect(writtenBody).not.toContain(fingerprint);
    // Field names ARE surfaced (auditable: user knows WHICH field broke).
    expect(writtenBody).toContain('Invalid config');
    expect(writtenBody).toContain('recovery-ledger init');
  });

  test('A-12 (CR-04 regression): malformed JSON triggers field-names-only path, no raw parse-error echo', async () => {
    // JSON.parse SyntaxError messages do not typically embed the full input,
    // but the message often quotes the offending substring. The parse arm
    // catches both ZodError AND SyntaxError; assert neither shape leaks to
    // stdout.
    await mkdir(tmp, { recursive: true });
    const fingerprint = 'SYNTAX-FINGERPRINT-DO-NOT-LEAK';
    // Inject the fingerprint inside an unterminated string so it lands in
    // SyntaxError's "Unexpected end of JSON input near '…'" message on some
    // Node versions.
    const malformed = `{ "clientId": "${fingerprint}`;
    await writeFile(join(tmp, 'config.json'), malformed, { mode: 0o600 });
    mockRunOAuth(async () => syntheticTokens);
    mockTokenStoreWrite();
    vi.resetModules();
    const { runAuthCommand } = await import('./auth.js');
    await runAuthCommand({ noBrowser: true });

    expect(exitCode).toBe(1);
    expect(writtenBody).not.toContain(fingerprint);
    expect(writtenBody).toContain('Invalid config');
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
