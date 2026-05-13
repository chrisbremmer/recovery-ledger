// MCP stdout-purity integration test (D-02b + D-03 + D-10 — the load-bearing
// Phase 1 assertion).
//
// Spawns the built `dist/mcp.mjs` as a subprocess, drives the four-fixture
// JSON-RPC handshake (initialize → notifications/initialized → tools/list →
// tools/call:whoop_doctor), captures stdout, and asserts:
//
//   1. (D-02b) every non-empty stdout line parses as JSON AND has
//      `jsonrpc === '2.0'` — proof that no log byte, no console.* write, and no
//      stray output corrupts the MCP protocol stream under fixture load.
//   2. (D-03) `dist/mcp.mjs` exists — this test doubles as the dist smoke
//      required by ROADMAP Phase 1 success criterion 5. If the developer
//      forgot to run `npm run build`, fail loudly with a fix-it pointer.
//   3. (D-10) stdout contains no `Bearer`, no `Authorization:`, and no
//      JWT-shaped substring — proof the sanitizer (D-07/D-08) holds end-to-end
//      under a real tool call.
//   4. (Pitfall 7) the `tools/call` response (id: 3) has a `result` property
//      and no `error` — a protocol mismatch surfaces as a clear assertion
//      failure rather than a silent JSON-RPC-valid pass.
//   5. (D-02 caveat) stderr is captured for diagnostic visibility but NEVER
//      asserted — Pino logs and SDK warnings are expected there.
//   6. Graceful close — `child.stdin.end()` yields a non-crash exit code
//      (≤ 0 covers both clean exit and SIGTERM-on-stdin-close).

import { spawn } from 'node:child_process';
import { access, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';
// MR-31: import the canonical frame-settle constant from the probe so the
// integration test and the production probe stay in lockstep. The two share
// a wire-level coupling (same JSON-RPC fixtures, same SDK async cadence);
// a divergence here would silently change one without the other.
import { FRAME_SETTLE_MS } from '../../src/services/doctor/checks/mcp-stdout-purity.js';

const FIXTURES = ['initialize', 'initialized', 'tools-list', 'whoop-doctor-call'] as const;
// MR-33: resolve dist/mcp.mjs and the fixtures relative to this test file's
// URL instead of process.cwd(). The doctor probe (CR-02) already uses
// import.meta.url + fileURLToPath for the same reason: a test or probe that
// reads from cwd silently misbehaves when run from outside the repo root
// (e.g., `cd tests && vitest run integration/...` or a future packaged smoke
// test). Anchored at this file's location, two levels up resolves to the
// repo root.
const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '..', '..');
const DIST_MCP = path.resolve(REPO_ROOT, 'dist', 'mcp.mjs');
const FIXTURES_DIR = path.resolve(REPO_ROOT, 'tests', 'fixtures', 'mcp');
// After CR-01 the inner tools/call no longer recursively respawns another
// dist/mcp.mjs (it short-circuits via skipSubprocessChecks), so the budget
// can be tight. We use a response-driven wait keyed on the id=3 frame's
// arrival rather than a fixed timer — this is faster on hot CI and robust to
// slow macOS-latest cold starts (WR-03). The hard ceiling below is a
// circuit-breaker; the typical path completes in well under 500ms.
const TOOLS_CALL_TIMEOUT_MS = 5000;

describe('MCP stdout purity (dist smoke)', () => {
  test('dist/mcp.mjs stdout contains only valid JSON-RPC, with sanitized tool responses', async () => {
    // Pre-flight: dist/mcp.mjs must exist. CI runs `npm run build` before
    // `npm run test`; local developers who skip the build get a clear pointer.
    try {
      await access(DIST_MCP);
    } catch {
      expect.fail(`${DIST_MCP} missing — run \`npm run build\` first`);
    }

    // MR-30: dist/mcp.mjs must be at least as new as the relevant src files.
    // A stale dist (developer edited src/ but forgot to rebuild) would
    // silently exercise the prior build, masking the change under test
    // and producing a false-pass. We compare mtimes against the canonical
    // MCP entry sources and the sanitizer/register chokepoint. If the
    // dist is older than any of these, fail loudly.
    const distMtime = (await stat(DIST_MCP)).mtimeMs;
    const watchedSources = [
      path.resolve(REPO_ROOT, 'src', 'mcp', 'index.ts'),
      path.resolve(REPO_ROOT, 'src', 'mcp', 'register.ts'),
      path.resolve(REPO_ROOT, 'src', 'mcp', 'sanitize.ts'),
      path.resolve(REPO_ROOT, 'src', 'mcp', 'tools', 'whoop-doctor.ts'),
      path.resolve(REPO_ROOT, 'src', 'services', 'doctor', 'index.ts'),
    ];
    for (const src of watchedSources) {
      const srcMtime = (await stat(src)).mtimeMs;
      if (srcMtime > distMtime) {
        expect.fail(
          `dist/mcp.mjs is stale (older than ${path.relative(REPO_ROOT, src)}) — run \`npm run build\` before this test`,
        );
      }
    }

    const child = spawn(process.execPath, [DIST_MCP], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, NODE_ENV: 'production' },
    });

    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    // Response-driven wait: track ids as they arrive so the test can resolve
    // as soon as the id=3 (tools/call) response is observed rather than
    // sleeping for a fixed budget (WR-03).
    //
    // MR-29: this resolves on FIRST observed id=3 frame and then teardown
    // closes stdin and waits for child close. Full-stdout purity is
    // asserted after child close, not when the id=3 frame arrives — so
    // the contract is "the id=3 response happened AND the child shut down
    // cleanly," not "every frame the child intends to emit was observed
    // before the resolve." A theoretical late stray byte after id=3 but
    // before SIGTERM would still be caught by the post-close assertions.
    const idsSeen = new Set<unknown>();
    let toolsCallResolve: (() => void) | null = null;
    const toolsCallSeen = new Promise<void>((resolve) => {
      toolsCallResolve = resolve;
    });
    child.stdout.on('data', (b: Buffer) => {
      stdoutChunks.push(b);
      // Parse only the newly-accumulated buffer; stray non-JSON bytes still
      // reach the assertions below where they are reported with their full
      // content. A parse error here is swallowed deliberately — the canonical
      // assertion happens after the read loop completes.
      const text = Buffer.concat(stdoutChunks).toString('utf8');
      for (const line of text.split('\n').filter(Boolean)) {
        try {
          const parsed = JSON.parse(line) as { id?: unknown };
          if ('id' in parsed) idsSeen.add(parsed.id);
        } catch {
          // Defer reporting to the post-loop assertion path.
        }
      }
      if (idsSeen.has(3) && toolsCallResolve) {
        toolsCallResolve();
        toolsCallResolve = null;
      }
    });
    child.stderr.on('data', (b: Buffer) => stderrChunks.push(b));

    // Drive the four fixtures over stdin as newline-delimited JSON. The
    // fixtures are pretty-printed on disk for readability, so we collapse each
    // one to a single line via JSON.parse → JSON.stringify before framing.
    // The MCP stdio transport is strictly line-delimited; a multi-line frame
    // is silently dropped by the parser (observed: only single-line fixtures
    // round-tripped when the raw `json.trim()` was written). Same collapse
    // pattern as src/services/doctor/checks/mcp-stdout-purity.ts.
    for (const name of FIXTURES) {
      const body = await readFile(path.resolve(FIXTURES_DIR, `${name}.json`), 'utf8');
      const frame = `${JSON.stringify(JSON.parse(body))}\n`;
      child.stdin.write(frame);
      await new Promise<void>((r) => setTimeout(r, FRAME_SETTLE_MS));
    }

    // Wait for the id=3 response or hit the circuit-breaker ceiling. A real
    // failure (response never arrives) surfaces as a clear timeout message
    // rather than a silent missing-id-3 assertion below.
    //
    // MR-17: the subprocess must be torn down in BOTH the success and the
    // timeout-rejection paths. Without the finally block, a tools/call that
    // never arrives leaves a spawned `dist/mcp.mjs` running until Vitest's
    // worker exits — leaking processes between test reruns and masking
    // unrelated CI flakes. SIGKILL is scheduled 2s after SIGTERM as a
    // fallback for a child that ignores graceful shutdown.
    let killTimer: NodeJS.Timeout | null = null;
    try {
      await Promise.race([
        toolsCallSeen,
        new Promise<void>((_, reject) =>
          setTimeout(
            () =>
              reject(
                new Error(
                  `tools/call (id=3) response timed out after ${TOOLS_CALL_TIMEOUT_MS}ms — observed ids: [${[...idsSeen].join(', ')}]`,
                ),
              ),
            TOOLS_CALL_TIMEOUT_MS,
          ),
        ),
      ]);
    } finally {
      // Tear down regardless of success or timeout. Order: close stdin to
      // let a well-behaved child exit on EOF; if it does not, SIGTERM; if
      // it still does not, SIGKILL after 2s.
      try {
        child.stdin.end();
      } catch {
        // stdin may already be closed.
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
        if (killTimer) {
          clearTimeout(killTimer);
          killTimer = null;
        }
        r(c ?? -1);
      });
    });

    const stdout = Buffer.concat(stdoutChunks).toString('utf8');
    const stderr = Buffer.concat(stderrChunks).toString('utf8');

    // Diagnostic: stderr is logged but never asserted (D-02 — Pino + SDK
    // diagnostics are expected there).
    if (stderr) {
      console.error('[mcp stderr]:', stderr);
    }

    // ASSERTION 1 (D-02b) — every non-empty stdout line parses as JSON-RPC 2.0.
    const lines = stdout.split('\n').filter((l) => l.length > 0);
    expect(lines.length).toBeGreaterThan(0);
    const frames: Array<Record<string, unknown>> = [];
    for (const line of lines) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(line);
      } catch (err) {
        expect.fail(
          `non-JSON byte on stdout — corrupts MCP transport: ${line.slice(0, 200)} (${
            err instanceof Error ? err.message : String(err)
          })`,
        );
      }
      expect(parsed).toHaveProperty('jsonrpc', '2.0');
      frames.push(parsed as Record<string, unknown>);
    }

    // ASSERTION 2 (D-10) — sanitizer integration: no token-shaped strings.
    // MR-10: regexes use negative lookaheads so the sanitizer's `<redacted>`
    // marker (which itself contains "Bearer " when emitted from pattern 1/4)
    // is permitted. Without the lookahead, a future Phase 2 tool that
    // legitimately includes `Bearer <redacted>` or `Authorization: Bearer
    // <redacted>` in its rendered output would false-fail this assertion.
    // The JWT regex is also tightened to require a full three-segment shape
    // so a partial `eyJ` prefix in unrelated text (e.g., a comment or a
    // base64-encoded label) is not flagged.
    expect(stdout).not.toMatch(/Bearer\s+(?!<redacted>)[A-Za-z0-9._-]/);
    expect(stdout).not.toMatch(/Authorization:\s*Bearer\s+(?!<redacted>)/i);
    expect(stdout).not.toMatch(/eyJ[A-Za-z0-9_-]{4,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/);

    // ASSERTION 3 (Pitfall 7) — the tools/call response (id: 3) has a NON-NULL
    // result with the expected content payload, and no error. MR-39: the
    // pre-fix `toHaveProperty('result')` passes for `{ result: null }`, which
    // is a protocol violation the test would silently miss. Assert result is
    // defined, non-null, and carries a `content` array — the actual whoop_doctor
    // response shape.
    const toolCallResponse = frames.find((f) => f.id === 3);
    expect(toolCallResponse, 'no JSON-RPC frame with id=3 (tools/call) found').toBeDefined();
    expect(toolCallResponse?.result).toBeDefined();
    expect(toolCallResponse?.result).not.toBeNull();
    expect(toolCallResponse?.result).toHaveProperty('content');
    expect(toolCallResponse).not.toHaveProperty('error');

    // ASSERTION 4 — graceful close (clean exit or SIGTERM-on-stdin-close).
    expect(exitCode).toBeLessThanOrEqual(0);
  });
});
