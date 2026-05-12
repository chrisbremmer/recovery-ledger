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

import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { DoctorCheck } from '../index.js';

const FIXTURE_DIR = 'test/fixtures/mcp';
const FIXTURE_FILES = [
  'initialize.json',
  'initialized.json',
  'tools-list.json',
  'whoop-doctor-call.json',
] as const;

const MCP_ENTRY = 'dist/mcp.mjs';

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
  let frames: string[];
  try {
    frames = await Promise.all(
      FIXTURE_FILES.map(async (name) => {
        const body = await readFile(path.join(FIXTURE_DIR, name), 'utf8');
        // Each fixture is pretty-printed JSON on disk; collapse to single-line
        // framing so newline-delimited transport stays unambiguous.
        return `${JSON.stringify(JSON.parse(body))}\n`;
      }),
    );
  } catch (err) {
    return {
      name: 'mcp_stdout_purity',
      status: 'fail',
      detail: `failed to load JSON-RPC fixtures from ${FIXTURE_DIR}: ${
        err instanceof Error ? err.message : String(err)
      }`,
    };
  }

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
