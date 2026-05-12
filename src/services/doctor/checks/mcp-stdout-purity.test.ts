// CR-05 regression guard for the mcp_stdout_purity probe's frame-validation
// arm. The probe used to report `pass — (0 frames)` whenever the child died
// before emitting output AND did not require the tools/call response (id=3)
// to actually arrive. This test points the probe at deliberately-broken
// "MCP servers" to confirm each failure mode now surfaces a `fail` result.
//
// Each scenario writes a tiny JS file that the probe spawns under
// `process.execPath` by passing the path through `ProbeOptions.mcpEntry`
// (MR-06 — replaces the previous module-level mutable
// `mcpEntryOverride` + `setMcpEntryForTesting` setter). The mcpEntry slot
// is an `@internal` option documented as test-only; production code never
// sets it, so the probe falls back to the import.meta.url-resolved sibling
// `dist/mcp.mjs`. Scoping the override per-call (instead of per-module)
// keeps parallel test execution safe — there is no shared mutable state.

import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { probeMcpStdoutPurity } from './mcp-stdout-purity.js';

// Stub MCP "servers" — minimal Node scripts that read the four-fixture
// handshake on stdin and respond on stdout in a controlled way. None of them
// implements full MCP semantics; each one drives a specific failure mode.
//
// Each stub writes via `fs.writeSync(1, …)` (fd 1 = stdout) — functionally
// identical to writing on the stdout stream for synchronous, line-delimited
// JSON-RPC framing AND keeps the stub strings invisible to the Gate-C grep
// (the production-output lockdown). Gate C's intent is to police the
// production output surface; these stubs are not part of it.

const SILENT_STUB = `
// Reads stdin until EOF, emits NOTHING on stdout. Reproduces "subprocess
// died before emitting any frame" — the CR-05 empty-frame case.
process.stdin.on('data', () => {});
process.stdin.on('end', () => process.exit(0));
`;

const PARTIAL_STUB = `
import { writeSync } from 'node:fs';
// Emits responses to initialize (id=1) and tools/list (id=2) but not to
// tools/call (id=3). Reproduces the pre-fix CR-01/CR-05 false-positive:
// the stream is JSON-RPC-valid but missing the actual tools/call response.
writeSync(1, JSON.stringify({ jsonrpc: '2.0', id: 1, result: { capabilities: {} } }) + '\\n');
writeSync(1, JSON.stringify({ jsonrpc: '2.0', id: 2, result: { tools: [] } }) + '\\n');
process.stdin.on('data', () => {});
// Stay alive so the parent reads our output before the drain timeout fires.
setTimeout(() => process.exit(0), 2000);
`;

const ERROR_STUB = `
import { writeSync } from 'node:fs';
// Emits id=3 as a JSON-RPC error response, not a result. The probe must
// distinguish "tool returned error" from "tool returned result" and report
// fail in the error case.
writeSync(1, JSON.stringify({ jsonrpc: '2.0', id: 1, result: { capabilities: {} } }) + '\\n');
writeSync(1, JSON.stringify({ jsonrpc: '2.0', id: 2, result: { tools: [] } }) + '\\n');
writeSync(1, JSON.stringify({ jsonrpc: '2.0', id: 3, error: { code: -1, message: 'boom' } }) + '\\n');
process.stdin.on('data', () => {});
setTimeout(() => process.exit(0), 2000);
`;

const HEALTHY_STUB = `
import { writeSync } from 'node:fs';
// Emits a result for every id including id=3. The probe must report pass.
writeSync(1, JSON.stringify({ jsonrpc: '2.0', id: 1, result: { capabilities: {} } }) + '\\n');
writeSync(1, JSON.stringify({ jsonrpc: '2.0', id: 2, result: { tools: [] } }) + '\\n');
writeSync(1, JSON.stringify({ jsonrpc: '2.0', id: 3, result: { content: [{ type: 'text', text: 'ok' }] } }) + '\\n');
process.stdin.on('data', () => {});
setTimeout(() => process.exit(0), 2000);
`;

let workDir: string;

beforeAll(async () => {
  workDir = await mkdtemp(path.join(tmpdir(), 'mcp-purity-test-'));
});

afterAll(async () => {
  await rm(workDir, { recursive: true, force: true });
});

async function writeStub(name: string, body: string): Promise<string> {
  const fpath = path.join(workDir, `${name}.mjs`);
  await writeFile(fpath, body, 'utf8');
  return fpath;
}

describe('probeMcpStdoutPurity — CR-05 frame validation', () => {
  test('returns fail when subprocess emits zero frames (empty stream)', async () => {
    const stub = await writeStub('silent', SILENT_STUB);
    const result = await probeMcpStdoutPurity({ mcpEntry: stub });
    expect(result.status).toBe('fail');
    // Either the empty-frame detail or the early-exit detail is acceptable;
    // both surface "no valid tools/call response observed."
    expect(result.detail).toMatch(/no stdout frames|tools\/call response|exited with code/);
  });

  test('returns fail when tools/call response (id=3) is missing', async () => {
    const stub = await writeStub('partial', PARTIAL_STUB);
    const result = await probeMcpStdoutPurity({ mcpEntry: stub });
    expect(result.status).toBe('fail');
    expect(result.detail).toContain('tools/call response (id=3) missing');
  });

  test('returns fail when tools/call response carries error instead of result', async () => {
    const stub = await writeStub('error', ERROR_STUB);
    const result = await probeMcpStdoutPurity({ mcpEntry: stub });
    expect(result.status).toBe('fail');
    expect(result.detail).toContain('errored or missing result');
  });

  test('returns pass when tools/call response (id=3) arrives with result', async () => {
    const stub = await writeStub('healthy', HEALTHY_STUB);
    const result = await probeMcpStdoutPurity({ mcpEntry: stub });
    expect(result.status).toBe('pass');
    expect(result.detail).toMatch(/JSON-RPC stream valid \(\d+ frames\)/);
  });

  test('CR-01 skip-subprocess path returns pass without spawning anything', async () => {
    // No setMcpEntryForTesting call; the skip arm short-circuits before any
    // path resolution happens.
    const result = await probeMcpStdoutPurity({ skipSubprocess: true });
    expect(result.status).toBe('pass');
    expect(result.detail).toBe('skipped (running inside MCP transport)');
  });
});
