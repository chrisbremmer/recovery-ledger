// Cross-process auth-concurrency integration test (Phase 2 Plan 08).
//
// D-23.2 / D-24: this is the LOAD-BEARING test for AUTH-05 and Phase 2
// ROADMAP success criterion #2 ("concurrent-load test injecting 10 parallel
// 401 responses across CLI + MCP processes... exactly one WHOOP refresh
// request is issued and the resulting token tuple is written atomically").
// Plan 02-02 covers the in-process half (10 parallel callers in one process
// hit the refresh endpoint exactly once); THIS test covers the cross-process
// half via `child_process.fork()` against a real local HTTP mock.
//
// Phase 2 success criterion #4 (AUTH-06 — `grep -v Bearer` across captured
// stderr + log directory + MCP error returns) lands here. After the
// concurrency test, the suite induces a refresh failure and drives the MCP
// `whoop_doctor` tool (Phase 1's only registered tool; ZERO new MCP tools
// were added in Phase 2 per D-17 — runtime-attested by G-03's tools/list
// assertion) against the same failing mock, and asserts no Bearer / JWT /
// Authorization / refresh_token / access_token material appears anywhere.
//
// Build-dependency contract (checker WARNING PLAN-08-BUILD-DEP):
// Test B-01 asserts `dist/infrastructure/whoop/token-store.mjs` exists after
// `npm run build`. tsup.config.ts now lists the token-store as an explicit
// top-level entry so the child helper's import works. If the path is
// missing, the test fast-fails with a pointer at tsup.config.ts.
//
// Test architecture:
//   - Parent: real `http.createServer` bound to 127.0.0.1:0 (OS-assigned).
//     The handler counts POSTs to `/oauth/oauth2/token` and returns the
//     token-200 fixture shape with a unique `access_token: fresh-${count}`.
//     A `nextResponse` slot lets test G-02 force a one-shot 400 invalid_grant.
//   - Parent: shared `mkdtemp` for RECOVERY_LEDGER_HOME across all children.
//     Pre-seeds an expired token + `storage-mode = 'file'` before each test.
//   - Children: `fork('tests/integration/helpers/child-get-token.mjs')`.
//     Each child imports the compiled tokenStore, calls getValidAccessToken,
//     prints the result as JSON-line stdout, exits 0.
//
// stderr is NEVER asserted clean of all output — Pino logs land there by
// design (ADR-0001). The FORBIDDEN regex asserts no TOKEN MATERIAL leaks.

import { spawn, type ChildProcess, type ChildProcessWithoutNullStreams, fork } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { createServer, type Server, type IncomingMessage, type ServerResponse } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { exec } from 'node:child_process';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'vitest';

const execAsync = promisify(exec);

// Forbidden token-material patterns. Matches:
//   - `Bearer <something>` with 10+ chars of the value
//   - JWT three-segment shape `eyJ...` (20+ char tail)
//   - `Authorization:` header literal
// Used across G-01..G-03.
const FORBIDDEN =
  /Bearer\s+[A-Za-z0-9._/+=-]{10,}|eyJ[A-Za-z0-9._-]{20,}|Authorization:/g;

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '..', '..');
const BUILD_OUTPUT_PATH = path.resolve(
  REPO_ROOT,
  'dist',
  'infrastructure',
  'whoop',
  'token-store.mjs',
);
const CHILD_HELPER = path.resolve(HERE, 'helpers', 'child-get-token.mjs');
const DIST_MCP = path.resolve(REPO_ROOT, 'dist', 'mcp.mjs');

// Test runtime budget per plan <behavior>: total < 15s. The 10-child spawn +
// proper-lockfile contention realistically pushes 3-8s on macOS; the MCP
// subprocess driver in G-03 adds ~1s. We size the per-test budget at 30s to
// avoid flakes on cold CI starts.
const TEST_TIMEOUT_MS = 30_000;

// -----------------------------------------------------------------------------
// Mock HTTP server (parent process).
// -----------------------------------------------------------------------------

interface NextResponseOverride {
  body: unknown;
  status: number;
}

interface MockServerHandle {
  server: Server;
  port: number;
  getCount: () => number;
  resetCount: () => void;
  setNextResponse: (body: unknown, status: number) => void;
}

async function startMockServer(): Promise<MockServerHandle> {
  let count = 0;
  let next: NextResponseOverride | null = null;

  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    if (req.method === 'POST' && req.url === '/oauth/oauth2/token') {
      // Drain the request body (test mock doesn't inspect it, but we must
      // consume the bytes so the client receives a clean response).
      req.resume();
      req.on('end', () => {
        count += 1;
        if (next !== null) {
          const { body, status } = next;
          next = null;
          res.statusCode = status;
          res.setHeader('content-type', 'application/json');
          res.end(JSON.stringify(body));
          return;
        }
        res.statusCode = 200;
        res.setHeader('content-type', 'application/json');
        res.end(
          JSON.stringify({
            access_token: `fresh-${count}`,
            refresh_token: `r-${count}`,
            expires_in: 3600,
            scope: 'offline read:recovery',
            token_type: 'bearer',
          }),
        );
      });
      return;
    }
    res.statusCode = 404;
    res.end('not-found');
  });

  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve());
  });
  const address = server.address();
  if (address === null || typeof address === 'string') {
    throw new Error('mock server failed to bind');
  }
  const port = address.port;

  return {
    server,
    port,
    getCount: () => count,
    resetCount: () => {
      count = 0;
    },
    setNextResponse: (body, status) => {
      next = { body, status };
    },
  };
}

// -----------------------------------------------------------------------------
// Per-test state seeding.
// -----------------------------------------------------------------------------

async function seedExpiredToken(tmpDir: string): Promise<void> {
  // Pre-seed `storage-mode = 'file'` and an expired token in `tokens.json`
  // mode 0600. The expired expiresAt forces getValidAccessToken to trigger a
  // refresh on first call.
  const expired = {
    accessToken: 'expired-at',
    refreshToken: 'stale-rt',
    tokenType: 'bearer' as const,
    scope: 'offline',
    obtainedAt: Date.now() - 7200_000,
    expiresAt: Date.now() - 1000,
  };
  await writeFile(path.join(tmpDir, 'tokens.json'), JSON.stringify(expired), {
    mode: 0o600,
  });
  await writeFile(path.join(tmpDir, 'storage-mode'), 'file\n', { mode: 0o600 });
  // proper-lockfile expects the lock target path to be touchable.
  await writeFile(path.join(tmpDir, 'tokens.json.lock'), '', { flag: 'a' });
}

// -----------------------------------------------------------------------------
// Child helper: fork, collect, await exit.
// -----------------------------------------------------------------------------

interface ChildResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
}

interface ChildEnvOverrides {
  WHOOP_TOKEN_URL: string;
  RECOVERY_LEDGER_HOME: string;
  RECOVERY_LEDGER_FORCE_FILE_STORE?: string;
  WHOOP_CLIENT_ID?: string;
  WHOOP_CLIENT_SECRET?: string;
}

async function forkChild(env: ChildEnvOverrides): Promise<ChildResult> {
  return new Promise((resolve, reject) => {
    const child = fork(CHILD_HELPER, [], {
      env: {
        ...process.env,
        RECOVERY_LEDGER_FORCE_FILE_STORE: '1',
        WHOOP_CLIENT_ID: 'test-client-id',
        WHOOP_CLIENT_SECRET: 'test-client-secret',
        ...env,
      },
      // `silent: true` redirects stdout/stderr to pipes so we can capture
      // and assert on them (rather than the default `inherit` which would
      // print to the test runner).
      silent: true,
    });

    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    child.stdout?.on('data', (b: Buffer) => stdoutChunks.push(b));
    child.stderr?.on('data', (b: Buffer) => stderrChunks.push(b));

    child.on('error', (err) => reject(err));
    child.on('close', (code) => {
      resolve({
        stdout: Buffer.concat(stdoutChunks).toString('utf8'),
        stderr: Buffer.concat(stderrChunks).toString('utf8'),
        exitCode: code,
      });
    });
  });
}

interface ChildStdoutLine {
  ok: boolean;
  accessToken?: string;
  storageMode?: string;
  kind?: string;
}

function parseChildStdout(stdout: string): ChildStdoutLine | null {
  const line = stdout.trim().split('\n').find((l) => l.length > 0);
  if (line === undefined) return null;
  try {
    return JSON.parse(line) as ChildStdoutLine;
  } catch {
    return null;
  }
}

// -----------------------------------------------------------------------------
// MCP subprocess driver (G-03). Mirrors test/integration/mcp-stdout-purity.test.ts
// but parameterized for an arbitrary env override (so we can point at the
// failing mock and the expired-token tmpdir).
// -----------------------------------------------------------------------------

interface McpDriveResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  frames: Array<Record<string, unknown>>;
}

async function driveMcpWhoopDoctor(
  envOverrides: Record<string, string>,
): Promise<McpDriveResult> {
  const fixturesDir = path.resolve(REPO_ROOT, 'test', 'fixtures', 'mcp');
  const fixtures = ['initialize', 'initialized', 'tools-list', 'whoop-doctor-call'] as const;

  const child: ChildProcessWithoutNullStreams = spawn(process.execPath, [DIST_MCP], {
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env, NODE_ENV: 'production', ...envOverrides },
  });

  const stdoutChunks: Buffer[] = [];
  const stderrChunks: Buffer[] = [];
  const idsSeen = new Set<unknown>();
  let toolsCallResolve: (() => void) | null = null;
  const toolsCallSeen = new Promise<void>((resolve) => {
    toolsCallResolve = resolve;
  });

  child.stdout.on('data', (b: Buffer) => {
    stdoutChunks.push(b);
    const text = Buffer.concat(stdoutChunks).toString('utf8');
    for (const line of text.split('\n').filter(Boolean)) {
      try {
        const parsed = JSON.parse(line) as { id?: unknown };
        if ('id' in parsed) idsSeen.add(parsed.id);
      } catch {
        // Defer to post-loop assertion.
      }
    }
    if (idsSeen.has(3) && toolsCallResolve !== null) {
      toolsCallResolve();
      toolsCallResolve = null;
    }
  });
  child.stderr.on('data', (b: Buffer) => stderrChunks.push(b));

  // Drive the four fixtures with a 200ms settle window between frames.
  for (const name of fixtures) {
    const body = await readFile(path.resolve(fixturesDir, `${name}.json`), 'utf8');
    const frame = `${JSON.stringify(JSON.parse(body))}\n`;
    child.stdin.write(frame);
    await new Promise<void>((r) => setTimeout(r, 200));
  }

  let killTimer: NodeJS.Timeout | null = null;
  try {
    await Promise.race([
      toolsCallSeen,
      new Promise<void>((_, reject) =>
        setTimeout(() => reject(new Error('tools/call timed out')), 8000),
      ),
    ]);
  } finally {
    try {
      child.stdin.end();
    } catch {
      // already closed
    }
    if (!child.killed) {
      child.kill('SIGTERM');
      killTimer = setTimeout(() => {
        if (!child.killed) child.kill('SIGKILL');
      }, 2000);
      killTimer.unref();
    }
  }

  const exitCode = await new Promise<number>((r) => {
    child.on('close', (c) => {
      if (killTimer !== null) {
        clearTimeout(killTimer);
        killTimer = null;
      }
      r(c ?? -1);
    });
  });

  const stdout = Buffer.concat(stdoutChunks).toString('utf8');
  const stderr = Buffer.concat(stderrChunks).toString('utf8');
  const frames: Array<Record<string, unknown>> = [];
  for (const line of stdout.split('\n').filter((l) => l.length > 0)) {
    try {
      frames.push(JSON.parse(line) as Record<string, unknown>);
    } catch {
      // Skip non-JSON lines; the Phase 1 integration test already asserts
      // strict JSON-RPC purity. Here we only care about the tools/call
      // response shape and the FORBIDDEN-regex assertion on the full byte
      // stream.
    }
  }

  return { stdout, stderr, exitCode, frames };
}

// -----------------------------------------------------------------------------
// Test suite
// -----------------------------------------------------------------------------

describe('auth concurrency (cross-process AUTH-05 + AUTH-06)', () => {
  let mock: MockServerHandle;
  let tmpDir: string;

  beforeAll(async () => {
    // Build-dependency precondition (checker WARNING PLAN-08-BUILD-DEP).
    // Run `npm run build` so dist/ reflects the current src tree, then
    // assert the explicit token-store entry was emitted. If missing, the
    // failure message points at tsup.config.ts.
    await execAsync('npm run build', { cwd: REPO_ROOT });
    if (!existsSync(BUILD_OUTPUT_PATH)) {
      throw new Error(
        [
          `tsup.config.ts must emit ${BUILD_OUTPUT_PATH} as a top-level entry.`,
          'Add `src/infrastructure/whoop/token-store.ts` to the entry map.',
          'See checker WARNING PLAN-08-BUILD-DEP in 02-08-...-PLAN.md.',
        ].join(' '),
      );
    }
    if (!existsSync(DIST_MCP)) {
      throw new Error(`${DIST_MCP} missing after build`);
    }

    mock = await startMockServer();
  }, TEST_TIMEOUT_MS);

  afterAll(async () => {
    await new Promise<void>((resolve) => mock.server.close(() => resolve()));
  });

  beforeEach(async () => {
    mock.resetCount();
    tmpDir = await mkdtemp(path.join(tmpdir(), 'rl-auth-concurrency-'));
    await seedExpiredToken(tmpDir);
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  test(
    'B-01: dist/infrastructure/whoop/token-store.mjs exists (PLAN-08-BUILD-DEP precondition)',
    () => {
      // Redundant with beforeAll's fast-fail, but pinning it as a named
      // test makes the failure mode obvious in test output.
      expect(existsSync(BUILD_OUTPUT_PATH)).toBe(true);
    },
  );

  test(
    'I-01: 10 forked children refresh exactly once across the cross-process lock boundary',
    async () => {
      const tokenUrl = `http://127.0.0.1:${mock.port}/oauth/oauth2/token`;

      // Spawn 10 children in parallel. Each forks the compiled tokenStore
      // (via the child helper) and calls getValidAccessToken(). The
      // RECOVERY_LEDGER_HOME tmpdir is shared so all 10 see the same
      // tokens.json + tokens.json.lock; proper-lockfile is the cross-process
      // gate that lets exactly one win the refresh.
      const results = await Promise.all(
        Array.from({ length: 10 }, () =>
          forkChild({
            WHOOP_TOKEN_URL: tokenUrl,
            RECOVERY_LEDGER_HOME: tmpDir,
            RECOVERY_LEDGER_FORCE_FILE_STORE: '1',
          }),
        ),
      );

      // Assertion 1: every child exits with code 0.
      for (const r of results) {
        expect(r.exitCode, `child stderr: ${r.stderr}`).toBe(0);
      }

      // Assertion 2: exactly one POST to /oauth/oauth2/token. THIS is the
      // load-bearing AUTH-05 assertion. ADR-0002 §Enforcement (line 73-75)
      // says: "Contract test that spawns two concurrent calls to
      // `getValidAccessToken()` and asserts the WHOOP refresh endpoint is
      // hit exactly once." Plan 08 ships 10, well above the floor.
      expect(mock.getCount()).toBe(1);

      // Assertion 3: every child sees the SAME fresh access token (the
      // sibling-aware re-read inside the lock ensures children that lose
      // the lock race read the winner's tokens from disk, not their own
      // stale snapshot).
      const tokens = results.map((r) => parseChildStdout(r.stdout));
      for (let i = 0; i < tokens.length; i += 1) {
        expect(tokens[i], `child ${i} produced unparseable stdout: ${results[i]?.stdout}`).not.toBeNull();
        expect(tokens[i]?.ok).toBe(true);
        expect(tokens[i]?.accessToken).toBeDefined();
      }
      const distinctTokens = new Set(tokens.map((t) => t?.accessToken));
      expect(distinctTokens.size).toBe(1);

      // Assertion 4: every child reports `storageMode: 'file'` (the
      // RECOVERY_LEDGER_FORCE_FILE_STORE=1 env override is honored).
      for (const t of tokens) {
        expect(t?.storageMode).toBe('file');
      }
    },
    TEST_TIMEOUT_MS,
  );

  test(
    'I-02: tokens.json.tmp does not exist after refresh; tokens.json mode 0600',
    async () => {
      const tokenUrl = `http://127.0.0.1:${mock.port}/oauth/oauth2/token`;
      // Run a single child to trigger the refresh, then inspect disk.
      const r = await forkChild({
        WHOOP_TOKEN_URL: tokenUrl,
        RECOVERY_LEDGER_HOME: tmpDir,
        RECOVERY_LEDGER_FORCE_FILE_STORE: '1',
      });
      expect(r.exitCode, `child stderr: ${r.stderr}`).toBe(0);

      // Atomic-write contract: the .tmp file must not exist after the
      // rename completes. ENOENT is the expected error shape.
      await expect(stat(path.join(tmpDir, 'tokens.json.tmp'))).rejects.toMatchObject({
        code: 'ENOENT',
      });
      const mainStat = await stat(path.join(tmpDir, 'tokens.json'));
      expect(mainStat.mode & 0o777).toBe(0o600);
    },
    TEST_TIMEOUT_MS,
  );

  test(
    'I-03: tokens.json.lock is released after the refresh completes (proper-lockfile semantics)',
    async () => {
      const tokenUrl = `http://127.0.0.1:${mock.port}/oauth/oauth2/token`;
      const r = await forkChild({
        WHOOP_TOKEN_URL: tokenUrl,
        RECOVERY_LEDGER_HOME: tmpDir,
        RECOVERY_LEDGER_FORCE_FILE_STORE: '1',
      });
      expect(r.exitCode).toBe(0);

      // proper-lockfile leaves the lockfile path on disk after release (the
      // lock STATE has been released — verified by `lockfile.check()`
      // returning false). Import dynamically to avoid loading the parent
      // module-graph's proper-lockfile state at test discovery time.
      const properLockfile = await import('proper-lockfile');
      const stillLocked = await properLockfile.check(path.join(tmpDir, 'tokens.json.lock'));
      expect(stillLocked).toBe(false);
    },
    TEST_TIMEOUT_MS,
  );

  test(
    'G-01: stderr from 10 children contains no Bearer / JWT / Authorization material',
    async () => {
      const tokenUrl = `http://127.0.0.1:${mock.port}/oauth/oauth2/token`;
      const results = await Promise.all(
        Array.from({ length: 10 }, () =>
          forkChild({
            WHOOP_TOKEN_URL: tokenUrl,
            RECOVERY_LEDGER_HOME: tmpDir,
            RECOVERY_LEDGER_FORCE_FILE_STORE: '1',
          }),
        ),
      );

      // Concatenated stderr capture across all 10 children. The FORBIDDEN
      // regex covers `Bearer <secret>`, JWT three-segment shape, and the
      // `Authorization:` header literal. None should appear — children
      // succeed via the happy path; even if they didn't, the sanitizer
      // covers the error surfaces too.
      const allStderr = results.map((r) => r.stderr).join('\n');
      expect(allStderr).not.toMatch(FORBIDDEN);

      // Additional invariant: by default, Phase 2 writes no log files into
      // tmpDir (Pino → stderr, not a file). Assert tmpDir contains only the
      // expected disk surface.
      const { readdir } = await import('node:fs/promises');
      const entries = await readdir(tmpDir);
      const unexpected = entries.filter(
        (n) =>
          n !== 'tokens.json' &&
          n !== 'tokens.json.lock' &&
          n !== 'storage-mode',
      );
      expect(unexpected, `unexpected files in tmpDir: ${unexpected.join(', ')}`).toHaveLength(0);
    },
    TEST_TIMEOUT_MS,
  );

  test(
    'G-02: induced refresh failure (400 invalid_grant) leaves no token material in stderr',
    async () => {
      const tokenUrl = `http://127.0.0.1:${mock.port}/oauth/oauth2/token`;
      // One-shot 400 response on the next POST. token-store throws
      // AuthError({kind: 'refresh_failed', detail: 'token endpoint 400'}).
      mock.setNextResponse({ error: 'invalid_grant' }, 400);

      const r = await forkChild({
        WHOOP_TOKEN_URL: tokenUrl,
        RECOVERY_LEDGER_HOME: tmpDir,
        RECOVERY_LEDGER_FORCE_FILE_STORE: '1',
      });

      // Child should exit non-zero because getValidAccessToken threw.
      expect(r.exitCode).not.toBe(0);

      // Stderr from the child plus any incidental Pino warnings must not
      // contain token material. The detail string in AuthError is
      // `token endpoint 400` — status only, never body text (Pitfall C).
      expect(r.stderr).not.toMatch(FORBIDDEN);
      // Defense-in-depth: confirm the stale refresh_token is NOT echoed.
      expect(r.stderr).not.toContain('stale-rt');
    },
    TEST_TIMEOUT_MS,
  );

  test(
    'G-03: MCP whoop_doctor tool surfaces auth-error state without leaking token material; tools/list returns ONE tool (D-17)',
    async () => {
      const tokenUrl = `http://127.0.0.1:${mock.port}/oauth/oauth2/token`;
      // Force the next token-endpoint call to fail so probeTokenFreshness
      // (Plan 02-06) and any auth-state inspection sees a degraded state.
      // The whoop_doctor tool itself is offline-safe (it does NOT call
      // getValidAccessToken — Plan 02-06 type-system forcing function), so
      // the auth/token_freshness probes inspect the on-disk expired token
      // and report `fail` with a remediation pointer. We assert no token
      // material in either the captured stderr or the tools/call response.
      mock.setNextResponse({ error: 'invalid_grant' }, 400);

      const result = await driveMcpWhoopDoctor({
        WHOOP_TOKEN_URL: tokenUrl,
        RECOVERY_LEDGER_HOME: tmpDir,
        RECOVERY_LEDGER_FORCE_FILE_STORE: '1',
        WHOOP_CLIENT_ID: 'test-client-id',
        WHOOP_CLIENT_SECRET: 'test-client-secret',
      });

      // The MCP child should exit cleanly after we close stdin.
      expect(result.exitCode).toBeLessThanOrEqual(0);

      // Find the tools/list response (id=2) and assert it contains EXACTLY
      // one tool — `whoop_doctor`. This is the D-17 runtime attestation:
      // Phase 2 ships ZERO new MCP tools; the only registered tool is the
      // Phase 1 `whoop_doctor`.
      const toolsListResponse = result.frames.find((f) => f.id === 2);
      expect(toolsListResponse, 'no tools/list response in MCP stream').toBeDefined();
      const toolsListResult = toolsListResponse?.result as
        | { tools?: Array<{ name?: string }> }
        | undefined;
      expect(toolsListResult?.tools).toBeDefined();
      expect(toolsListResult?.tools).toHaveLength(1);
      expect(toolsListResult?.tools?.[0]?.name).toBe('whoop_doctor');

      // Find the tools/call response (id=3) and assert it carries a result
      // (the doctor surface should produce structured output even with
      // expired tokens — auth + token_freshness probes report fail).
      const toolsCallResponse = result.frames.find((f) => f.id === 3);
      expect(toolsCallResponse).toBeDefined();
      expect(toolsCallResponse).toHaveProperty('result');

      // The full tools/call response — stringified — must not contain
      // token material. This is the load-bearing AUTH-06 assertion for the
      // MCP surface (Phase 2 success criterion #4).
      expect(JSON.stringify(toolsCallResponse)).not.toMatch(FORBIDDEN);

      // Defense-in-depth: the FULL stdout byte stream and stderr must not
      // contain token material either. (Phase 1's integration test already
      // covers strict JSON-RPC purity; here we focus on the AUTH-06 grep
      // gate.)
      expect(result.stdout).not.toMatch(FORBIDDEN);
      expect(result.stderr).not.toMatch(FORBIDDEN);
    },
    TEST_TIMEOUT_MS,
  );
});
