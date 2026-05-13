// Plan 02-05 init.ts unit tests (I-01..I-10).
//
// Test harness mirrors src/cli/commands/doctor.test.ts: mock process.exit +
// process.stdout.write per-test; mock readline/promises for prompt-arms;
// RECOVERY_LEDGER_HOME points at a tmpdir for filesystem isolation. The
// init module is imported AFTER vi.resetModules() in each test so the
// `paths` singleton (read at module load from process.env) picks up the
// tmpdir override.

import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Shared per-test harness: tmpdir + RECOVERY_LEDGER_HOME + mocked process.exit
// and process.stdout.write.
// ---------------------------------------------------------------------------

const originalExit = process.exit;
const originalWrite = process.stdout.write.bind(process.stdout);
const originalEnv = { ...process.env };

let tmp: string;
let exitCode: number | undefined;
let writtenBody: string;

beforeEach(async () => {
  tmp = await mkdtemp(join(tmpdir(), 'rl-init-test-'));
  exitCode = undefined;
  writtenBody = '';
  process.env = { ...originalEnv };
  process.env.RECOVERY_LEDGER_HOME = tmp;
  delete process.env.WHOOP_CLIENT_ID;
  delete process.env.WHOOP_CLIENT_SECRET;

  // Capture exit + stdout — exit resolves a promise so the test can wait for
  // MR-05 callback completion without throwing from inside the callback.
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
  vi.doUnmock('node:readline/promises');
  await rm(tmp, { recursive: true, force: true });
});

// readline mock factory: returns a sequence of prompt answers.
function mockReadline(answers: string[]): { promptSpy: ReturnType<typeof vi.fn> } {
  const queue = [...answers];
  const promptSpy = vi.fn(async () => {
    const next = queue.shift();
    return next ?? '';
  });
  vi.doMock('node:readline/promises', () => ({
    createInterface: () => ({
      question: promptSpy,
      close: () => undefined,
    }),
  }));
  return { promptSpy };
}

// ---------------------------------------------------------------------------
// I-01..I-10 (and a couple of canonical-schema-import + sanity tests).
// ---------------------------------------------------------------------------

describe('runInitCommand', () => {
  test('I-01 happy path with prompts writes a valid config.json', async () => {
    mockReadline(['cid', 'sec', '4321']);
    vi.resetModules();
    const { runInitCommand } = await import('./init.js');
    await runInitCommand({});

    const configPath = join(tmp, 'config.json');
    const raw = await readFile(configPath, 'utf8');
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    expect(parsed.clientId).toBe('cid');
    expect(parsed.clientSecret).toBe('sec');
    expect(parsed.redirectPort).toBe(4321);
    expect(Array.isArray(parsed.scopes)).toBe(true);
    expect((parsed.scopes as string[]).length).toBe(7);
    expect(exitCode).toBe(0);
  });

  test('I-02 env-var precedence: WHOOP_CLIENT_ID/SECRET skip prompts', async () => {
    process.env.WHOOP_CLIENT_ID = 'envid';
    process.env.WHOOP_CLIENT_SECRET = 'envsec';
    const { promptSpy } = mockReadline([]);
    vi.resetModules();
    const { runInitCommand } = await import('./init.js');
    await runInitCommand({});

    expect(promptSpy).not.toHaveBeenCalled();
    const raw = await readFile(join(tmp, 'config.json'), 'utf8');
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    expect(parsed.clientId).toBe('envid');
    expect(parsed.clientSecret).toBe('envsec');
    expect(parsed.redirectPort).toBe(4321);
    expect(exitCode).toBe(0);
  });

  test('I-03 idempotency: two runs with same env vars produce same byte content', async () => {
    process.env.WHOOP_CLIENT_ID = 'envid';
    process.env.WHOOP_CLIENT_SECRET = 'envsec';
    mockReadline([]);
    vi.resetModules();
    const { runInitCommand } = await import('./init.js');
    await runInitCommand({});
    const first = await readFile(join(tmp, 'config.json'), 'utf8');

    // Second run — re-import to get a fresh singleton (paths captured at
    // module load) but tmpdir + env unchanged.
    vi.resetModules();
    const { runInitCommand: runAgain } = await import('./init.js');
    await runAgain({});
    const second = await readFile(join(tmp, 'config.json'), 'utf8');

    expect(first).toBe(second);
  });

  test('I-04 D-02 verbatim instructions printed when prompting', async () => {
    mockReadline(['cid', 'sec', '4321']);
    vi.resetModules();
    const { runInitCommand } = await import('./init.js');
    await runInitCommand({});

    expect(writtenBody).toContain('https://developer.whoop.com/dashboard/applications');
    expect(writtenBody).toContain('http://127.0.0.1:4321/callback');
    expect(writtenBody).toContain(
      'offline read:recovery read:sleep read:workout read:cycles read:profile read:body_measurement',
    );
  });

  test('I-05 mkdir creates configDir with mode 0o700 if missing', async () => {
    // RECOVERY_LEDGER_HOME=tmp already exists (mkdtemp), so use a nested
    // path that does NOT exist to exercise the mkdir arm.
    const nested = join(tmp, 'nested', 'home');
    process.env.RECOVERY_LEDGER_HOME = nested;
    process.env.WHOOP_CLIENT_ID = 'envid';
    process.env.WHOOP_CLIENT_SECRET = 'envsec';
    mockReadline([]);
    vi.resetModules();
    const { runInitCommand } = await import('./init.js');
    await runInitCommand({});

    const dirStat = await stat(nested);
    expect(dirStat.isDirectory()).toBe(true);
    // mode 0o700 is the mkdir intent; the test asserts the directory exists
    // and is at most 0o700 (umask may further restrict but cannot widen).
    expect(dirStat.mode & 0o777).toBeLessThanOrEqual(0o700);
  });

  test('I-06 config.json is mode 0o600', async () => {
    process.env.WHOOP_CLIENT_ID = 'envid';
    process.env.WHOOP_CLIENT_SECRET = 'envsec';
    mockReadline([]);
    vi.resetModules();
    const { runInitCommand } = await import('./init.js');
    await runInitCommand({});

    const fileStat = await stat(join(tmp, 'config.json'));
    expect(fileStat.mode & 0o777).toBe(0o600);
  });

  test('I-07 atomic write — no .tmp file left behind', async () => {
    process.env.WHOOP_CLIENT_ID = 'envid';
    process.env.WHOOP_CLIENT_SECRET = 'envsec';
    mockReadline([]);
    vi.resetModules();
    const { runInitCommand } = await import('./init.js');
    await runInitCommand({});

    await expect(stat(join(tmp, 'config.json.tmp'))).rejects.toThrow();
  });

  test('I-08 exit code 0 on success', async () => {
    process.env.WHOOP_CLIENT_ID = 'envid';
    process.env.WHOOP_CLIENT_SECRET = 'envsec';
    mockReadline([]);
    vi.resetModules();
    const { runInitCommand } = await import('./init.js');
    await runInitCommand({});

    expect(exitCode).toBe(0);
  });

  test('I-09 Zod rejection on hostile clientId env value', async () => {
    process.env.WHOOP_CLIENT_ID = 'bad/value with spaces';
    process.env.WHOOP_CLIENT_SECRET = 'sec';
    mockReadline([]);
    vi.resetModules();
    const { runInitCommand } = await import('./init.js');
    await runInitCommand({});

    expect(exitCode).not.toBe(0);
    // Defense-in-depth: bad input is NOT echoed back into stdout.
    expect(writtenBody).not.toContain('bad/value with spaces');
    // But a useful remediation message IS shown.
    expect(writtenBody.toLowerCase()).toMatch(/invalid|clientid|config/);
  });

  test('I-10 canonical schema import: no inline z.object in init.ts', async () => {
    const { readFile: readSrc } = await import('node:fs/promises');
    const src = await readSrc('src/cli/commands/init.ts', 'utf8');
    expect(src).toMatch(/from '\.\.\/\.\.\/infrastructure\/config\/schema\.js'/);
    // No local Zod schema declaration — single source of truth lives in
    // schema.ts (DRY-fix per checker WARNING PLAN-05-DRY-VIOLATION).
    expect(src).not.toMatch(/z\.object\(/);
  });

  test('INIT_EXIT_CODES is frozen', async () => {
    vi.resetModules();
    const { INIT_EXIT_CODES } = await import('./init.js');
    expect(Object.isFrozen(INIT_EXIT_CODES)).toBe(true);
    expect(INIT_EXIT_CODES.success).toBe(0);
  });
});
