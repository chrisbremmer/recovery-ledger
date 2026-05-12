// MCP stdout-purity subprocess check (D-05).
//
// Spawns the built `dist/mcp.mjs` server, drives the four JSON-RPC fixtures
// over stdin (initialize → notifications/initialized → tools/list →
// tools/call:whoop_doctor), captures stdout, and asserts every non-empty line
// parses as JSON-RPC 2.0. The same probe is invoked from Plan 06's CI
// integration test — there is one implementation, not two.
//
// Per CLAUDE.md §Critical Rules, this module must not write to stdout from the
// parent process. The subprocess speaks JSON-RPC on its stdout; we read it
// silently and never echo. Failures are surfaced through the returned
// DoctorCheck `detail` field, never via stdout/stderr writes from this file.
//
// CR-02: fixtures are vendored as TS constants in `./fixtures.js` (not read
// from disk) and `dist/mcp.mjs` is resolved relative to this module's URL,
// not `process.cwd()`. The check therefore works from any cwd — including
// `npx recovery-ledger` from outside the source tree.

import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { DoctorCheck } from '../index.js';
import { JSONRPC_FIXTURES } from './fixtures.js';

// Resolve `mcp.mjs` as a sibling of this compiled module. `tsup` bundles
// every entry into a single flat file under `dist/`, so this module's source
// is inlined into both `dist/cli.mjs` and `dist/mcp.mjs`. When invoked from
// the CLI, `import.meta.url` points at `dist/cli.mjs` and `./mcp.mjs` resolves
// to its sibling. Under `tsx`/Vitest the resolved path points into the
// non-built `src/` tree; that file does not exist and the probe surfaces a
// clear absolute-path failure (IN-02) rather than the misleading cwd-relative
// message it had before.
const HERE = path.dirname(fileURLToPath(import.meta.url));
const MCP_ENTRY = path.resolve(HERE, 'mcp.mjs');

// How long to wait after each frame is written before considering the response
// drained. 200ms covers the SDK's async response cycle for the fixtures used
// here (initialize, tools/list, tools/call with a no-arg doctor stub) without
// dragging out the doctor command. Plan 06's integration test can extend this
// if real workloads ever need more headroom.
const FRAME_SETTLE_MS = 200;
const FINAL_DRAIN_MS = 300;

interface JsonRpcMessage {
  jsonrpc: string;
}

function isJsonRpcMessage(value: unknown): value is JsonRpcMessage {
  return (
    typeof value === 'object' &&
    value !== null &&
    'jsonrpc' in value &&
    (value as { jsonrpc: unknown }).jsonrpc === '2.0'
  );
}

export async function probeMcpStdoutPurity(): Promise<DoctorCheck> {
  // Canonicalize each fixture frame to single-line JSON-RPC framing. The MCP
  // stdio transport is strictly line-delimited; multi-line frames are silently
  // dropped by the parser. Mirrors the on-disk fixtures' wire shape.
  const frames = JSONRPC_FIXTURES.map((f) => `${JSON.stringify(f.frame)}\n`);

  return new Promise<DoctorCheck>((resolve) => {
    const child = spawn(process.execPath, [MCP_ENTRY], {
      env: { ...process.env, NODE_ENV: 'production' },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stdoutBuf = '';
    let settled = false;
    const finalise = (result: DoctorCheck): void => {
      if (settled) return;
      settled = true;
      try {
        child.stdin.end();
      } catch {
        // stdin may already be closed if the child exited first.
      }
      if (!child.killed) child.kill('SIGTERM');
      resolve(result);
    };

    child.stdout.on('data', (chunk: Buffer) => {
      stdoutBuf += chunk.toString('utf8');
    });

    child.on('error', (err) => {
      finalise({
        name: 'mcp_stdout_purity',
        status: 'fail',
        detail: `failed to spawn ${MCP_ENTRY}: ${err.message}`,
      });
    });

    child.on('exit', (code) => {
      if (settled) return;
      if (code !== null && code !== 0) {
        finalise({
          name: 'mcp_stdout_purity',
          status: 'fail',
          detail: `${MCP_ENTRY} exited with code ${code} before stream validation`,
        });
      }
    });

    void (async (): Promise<void> => {
      try {
        for (const frame of frames) {
          if (settled) return;
          if (!child.stdin.writable) break;
          child.stdin.write(frame);
          await new Promise((r) => setTimeout(r, FRAME_SETTLE_MS));
        }
        await new Promise((r) => setTimeout(r, FINAL_DRAIN_MS));

        const lines = stdoutBuf.split('\n').filter((l) => l.length > 0);
        for (const line of lines) {
          let parsed: unknown;
          try {
            parsed = JSON.parse(line);
          } catch {
            finalise({
              name: 'mcp_stdout_purity',
              status: 'fail',
              detail: `non-JSON-RPC byte on stdout: ${line.slice(0, 120)}`,
            });
            return;
          }
          if (!isJsonRpcMessage(parsed)) {
            finalise({
              name: 'mcp_stdout_purity',
              status: 'fail',
              detail: `non-JSON-RPC frame on stdout: ${line.slice(0, 120)}`,
            });
            return;
          }
        }

        finalise({
          name: 'mcp_stdout_purity',
          status: 'pass',
          detail: `JSON-RPC stream valid (${lines.length} frames)`,
        });
      } catch (err) {
        finalise({
          name: 'mcp_stdout_purity',
          status: 'fail',
          detail: `subprocess driver error: ${err instanceof Error ? err.message : String(err)}`,
        });
      }
    })();
  });
}
