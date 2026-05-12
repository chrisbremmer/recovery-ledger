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
import { access, readFile } from 'node:fs/promises';
import { describe, expect, test } from 'vitest';

const FIXTURES = ['initialize', 'initialized', 'tools-list', 'whoop-doctor-call'] as const;
const DIST_MCP = 'dist/mcp.mjs';
const FRAME_SETTLE_MS = 200;
// tools/call(whoop_doctor) triggers the mcp_stdout_purity check, which itself
// spawns another `dist/mcp.mjs` subprocess and drives the same four fixtures
// against it. That inner round-trip costs ~1.1s (200ms × 4 + 300ms drain per
// src/services/doctor/checks/mcp-stdout-purity.ts). 1500ms gives the inner
// subprocess plus the outer response framing enough headroom on CI cold
// starts without dragging the test above the 60s suite budget.
const FINAL_DRAIN_MS = 1500;

describe('MCP stdout purity (dist smoke)', () => {
  test('dist/mcp.mjs stdout contains only valid JSON-RPC, with sanitized tool responses', async () => {
    // Pre-flight: dist/mcp.mjs must exist. CI runs `npm run build` before
    // `npm run test`; local developers who skip the build get a clear pointer.
    try {
      await access(DIST_MCP);
    } catch {
      expect.fail(`${DIST_MCP} missing — run \`npm run build\` first`);
    }

    const child = spawn(process.execPath, ['dist/mcp.mjs'], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, NODE_ENV: 'production' },
    });

    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    child.stdout.on('data', (b: Buffer) => stdoutChunks.push(b));
    child.stderr.on('data', (b: Buffer) => stderrChunks.push(b));

    // Drive the four fixtures over stdin as newline-delimited JSON. The
    // fixtures are pretty-printed on disk for readability, so we collapse each
    // one to a single line via JSON.parse → JSON.stringify before framing.
    // The MCP stdio transport is strictly line-delimited; a multi-line frame
    // is silently dropped by the parser (observed: only single-line fixtures
    // round-tripped when the raw `json.trim()` was written). Same collapse
    // pattern as src/services/doctor/checks/mcp-stdout-purity.ts.
    for (const name of FIXTURES) {
      const body = await readFile(`test/fixtures/mcp/${name}.json`, 'utf8');
      const frame = `${JSON.stringify(JSON.parse(body))}\n`;
      child.stdin.write(frame);
      await new Promise<void>((r) => setTimeout(r, FRAME_SETTLE_MS));
    }
    await new Promise<void>((r) => setTimeout(r, FINAL_DRAIN_MS));

    child.stdin.end();
    const exitCode = await new Promise<number>((r) => {
      child.on('close', (c) => r(c ?? -1));
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
    expect(stdout).not.toMatch(/Bearer\s/);
    expect(stdout).not.toMatch(/Authorization:/i);
    expect(stdout).not.toMatch(/eyJ[A-Za-z0-9_-]{4,}\./);

    // ASSERTION 3 (Pitfall 7) — the tools/call response (id: 3) has a result,
    // not an error. A protocol mismatch surfaces here as a clear failure
    // rather than passing silently on JSON-RPC validity alone.
    const toolCallResponse = frames.find((f) => f.id === 3);
    expect(toolCallResponse, 'no JSON-RPC frame with id=3 (tools/call) found').toBeDefined();
    expect(toolCallResponse).toHaveProperty('result');
    expect(toolCallResponse).not.toHaveProperty('error');

    // ASSERTION 4 — graceful close (clean exit or SIGTERM-on-stdin-close).
    expect(exitCode).toBeLessThanOrEqual(0);
  });
});
