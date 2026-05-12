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
import { CHECK_NAMES } from './check-names.js';
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
const DEFAULT_MCP_ENTRY = path.resolve(HERE, 'mcp.mjs');

// How long to wait after each frame is written before considering the response
// drained. 200ms covers the SDK's async response cycle for the fixtures used
// here (initialize, tools/list, tools/call with a no-arg doctor stub) without
// dragging out the doctor command. Plan 06's integration test can extend this
// if real workloads ever need more headroom.
//
// MR-31: exported so the integration test can re-use the same constant
// instead of declaring its own. The probe and the integration test share a
// wire-level coupling (they drive the same JSON-RPC handshake against the
// same fixtures); a single source of truth prevents drift if the SDK's
// async cadence ever changes.
export const FRAME_SETTLE_MS = 200;
const FINAL_DRAIN_MS = 300;

// Required response id from the tools/call frame (whoop-doctor-call fixture).
// `notifications/initialized` has no response, so the four-fixture handshake
// produces three responses: id=1 (initialize), id=2 (tools/list), id=3
// (tools/call:whoop_doctor). The pass arm requires id=3 explicitly — a child
// that died before emitting it, or one whose tools/call returned an error,
// must NOT report pass (CR-05).
const REQUIRED_RESPONSE_ID = 3;

interface JsonRpcMessage {
  jsonrpc: string;
}

// MR-19: typed view over the parsed-and-narrowed frame. `isJsonRpcMessage`
// narrows to `{ jsonrpc: string }`; the additional fields below are optional
// JSON-RPC envelope slots that the frame-validation arms inspect. Treating
// the parsed value as `JsonRpcFrame` is a single justified cast (the prior
// implementation chained `as unknown as Record<string, unknown>`, a
// double-cast that the type system flagged but did not stop).
interface JsonRpcFrame {
  jsonrpc: string;
  id?: unknown;
  result?: unknown;
  error?: unknown;
}

function isJsonRpcMessage(value: unknown): value is JsonRpcMessage {
  return (
    typeof value === 'object' &&
    value !== null &&
    'jsonrpc' in value &&
    (value as { jsonrpc: unknown }).jsonrpc === '2.0'
  );
}

export interface ProbeOptions {
  /**
   * When the doctor service runs from inside the MCP server (the
   * `whoop_doctor` tool handler delegates to `runDoctor()`), spawning another
   * `dist/mcp.mjs` to drive the same fixtures would recurse forever — the
   * grandchild's `whoop_doctor` would itself spawn a great-grandchild. The
   * MCP entry point sets `RL_INSIDE_MCP=1`; the probe substitutes a static
   * informational result instead of spawning. The CLI doctor command leaves
   * the flag unset so the subprocess check still runs end-to-end. See CR-01.
   */
  skipSubprocess?: boolean;
  /**
   * Test-only override of the MCP entry path. Production code never sets
   * this; the CR-05 regression suite passes a path to a deliberately-broken
   * stub MCP server to confirm each failure mode surfaces a `fail` result.
   * MR-06: this used to live as a module-level mutable `mcpEntryOverride`
   * exposed through `setMcpEntryForTesting`. That coupling made parallel
   * tests unsafe and left a production-import path with a hidden mutable
   * dependency. The field-on-options shape keeps the override scoped to a
   * single probe call.
   * @internal — for unit tests in `mcp-stdout-purity.test.ts` only.
   */
  mcpEntry?: string;
}

export async function probeMcpStdoutPurity(opts: ProbeOptions = {}): Promise<DoctorCheck> {
  if (opts.skipSubprocess) {
    return {
      name: CHECK_NAMES.MCP_STDOUT_PURITY,
      status: 'pass',
      detail: 'skipped (running inside MCP transport)',
    };
  }

  // Canonicalize each fixture frame to single-line JSON-RPC framing. The MCP
  // stdio transport is strictly line-delimited; multi-line frames are silently
  // dropped by the parser. Mirrors the on-disk fixtures' wire shape.
  const frames = JSONRPC_FIXTURES.map((f) => `${JSON.stringify(f.frame)}\n`);

  const mcpEntry = opts.mcpEntry ?? DEFAULT_MCP_ENTRY;

  return new Promise<DoctorCheck>((resolve) => {
    const child = spawn(process.execPath, [mcpEntry], {
      // Inject RL_INSIDE_MCP=1 into the child so its `whoop_doctor` handler
      // skips its own subprocess check — terminates the recursion at depth 1.
      env: { ...process.env, NODE_ENV: 'production', RL_INSIDE_MCP: '1' },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stdoutBuf = '';
    let settled = false;
    // MR-16: SIGKILL fallback. A misbehaving child that ignores SIGTERM
    // (e.g., a tight CPU loop, an unkillable native call, or a stub that
    // intercepts the signal) would leave the parent waiting indefinitely
    // on `await new Promise<number>((r) => child.on('close', …))` in the
    // probe consumer. Schedule a SIGKILL 2s after SIGTERM and clear it on
    // clean exit. Two seconds is more than enough for any graceful shutdown
    // path the SDK or the stubs run.
    let killTimer: NodeJS.Timeout | null = null;
    child.on('exit', () => {
      if (killTimer) {
        clearTimeout(killTimer);
        killTimer = null;
      }
    });
    const finalise = (result: DoctorCheck): void => {
      if (settled) return;
      settled = true;
      try {
        child.stdin.end();
      } catch {
        // stdin may already be closed if the child exited first.
      }
      if (!child.killed) {
        child.kill('SIGTERM');
        // Escalate to SIGKILL if the child has not exited within 2s.
        killTimer = setTimeout(() => {
          if (!child.killed) child.kill('SIGKILL');
        }, 2000);
        // Allow the parent process to exit even if the timer is pending.
        killTimer.unref();
      }
      resolve(result);
    };

    child.stdout.on('data', (chunk: Buffer) => {
      stdoutBuf += chunk.toString('utf8');
    });

    // WR-04: EPIPE on `child.stdin.write` after the child exits surfaces as
    // an unhandled stream 'error' event. Without this listener the event
    // becomes an unhandled rejection in the IIFE below. The try/catch around
    // each write() additionally converts a synchronous throw into a clean
    // `fail` result.
    //
    // MR-18: distinguish EPIPE (recoverable, expected when the child has
    // exited mid-handshake) from every other stdin error code. The blanket
    // swallow hid genuine OS-level write failures — ENOMEM, EFBIG, EIO,
    // EACCES — that signal a real problem with the spawned child but would
    // surface only as a downstream timeout. EPIPE is silently dropped; any
    // other error finalises with a fail and the error code in the detail.
    child.stdin.on('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'EPIPE') return;
      finalise({
        name: CHECK_NAMES.MCP_STDOUT_PURITY,
        status: 'fail',
        detail: `stdin error: ${err.code ?? err.message}`,
      });
    });

    child.on('error', (err) => {
      finalise({
        name: CHECK_NAMES.MCP_STDOUT_PURITY,
        status: 'fail',
        detail: `failed to spawn ${mcpEntry}: ${err.message}`,
      });
    });

    child.on('exit', (code) => {
      if (settled) return;
      if (code !== null && code !== 0) {
        finalise({
          name: CHECK_NAMES.MCP_STDOUT_PURITY,
          status: 'fail',
          detail: `${mcpEntry} exited with code ${code} before stream validation`,
        });
      }
    });

    void (async (): Promise<void> => {
      try {
        for (const frame of frames) {
          if (settled || !child.stdin.writable) break;
          try {
            child.stdin.write(frame);
          } catch (err) {
            // WR-04: writable can flip false between the check and the write
            // (child exits mid-loop). The error event listener above swallows
            // the async 'error' event; the try/catch here catches the
            // synchronous throw and surfaces a clean fail result.
            finalise({
              name: CHECK_NAMES.MCP_STDOUT_PURITY,
              status: 'fail',
              detail: `stdin write failed: ${err instanceof Error ? err.message : String(err)}`,
            });
            return;
          }
          await new Promise((r) => setTimeout(r, FRAME_SETTLE_MS));
        }
        await new Promise((r) => setTimeout(r, FINAL_DRAIN_MS));

        const lines = stdoutBuf.split('\n').filter((l) => l.length > 0);

        // CR-05: an empty stream must NOT pass — the check exists to prove
        // valid frames arrived, not to confirm the child stayed silent. The
        // previous implementation reported `pass — (0 frames)` whenever the
        // child died before emitting anything.
        if (lines.length === 0) {
          finalise({
            name: CHECK_NAMES.MCP_STDOUT_PURITY,
            status: 'fail',
            detail: 'subprocess emitted no stdout frames before drain elapsed',
          });
          return;
        }

        const parsedFrames: JsonRpcFrame[] = [];
        for (const line of lines) {
          let parsed: unknown;
          try {
            parsed = JSON.parse(line);
          } catch {
            finalise({
              name: CHECK_NAMES.MCP_STDOUT_PURITY,
              status: 'fail',
              detail: `non-JSON-RPC byte on stdout: ${line.slice(0, 120)}`,
            });
            return;
          }
          if (!isJsonRpcMessage(parsed)) {
            finalise({
              name: CHECK_NAMES.MCP_STDOUT_PURITY,
              status: 'fail',
              detail: `non-JSON-RPC frame on stdout: ${line.slice(0, 120)}`,
            });
            return;
          }
          // MR-19: `parsed` is narrowed to `JsonRpcMessage` ({ jsonrpc: '2.0' });
          // the additional envelope slots (id/result/error) are optional fields
          // declared on `JsonRpcFrame`. A single justified cast — the old
          // `as unknown as Record<string, unknown>` double-cast is gone.
          parsedFrames.push(parsed as JsonRpcFrame);
        }

        // CR-05: explicit assertion that the tools/call response (id=3)
        // arrived AND carries a `result`, not an `error`. Without this the
        // check passed whenever any frames arrived — even when the actual
        // tool-call response was missing.
        const toolCallResp = parsedFrames.find((f) => f.id === REQUIRED_RESPONSE_ID);
        if (!toolCallResp) {
          finalise({
            name: CHECK_NAMES.MCP_STDOUT_PURITY,
            status: 'fail',
            detail: `tools/call response (id=${REQUIRED_RESPONSE_ID}) missing — ${lines.length} frames observed`,
          });
          return;
        }
        if ('error' in toolCallResp || !('result' in toolCallResp)) {
          finalise({
            name: CHECK_NAMES.MCP_STDOUT_PURITY,
            status: 'fail',
            detail: `tools/call response (id=${REQUIRED_RESPONSE_ID}) errored or missing result`,
          });
          return;
        }

        finalise({
          name: CHECK_NAMES.MCP_STDOUT_PURITY,
          status: 'pass',
          detail: `JSON-RPC stream valid (${lines.length} frames)`,
        });
      } catch (err) {
        finalise({
          name: CHECK_NAMES.MCP_STDOUT_PURITY,
          status: 'fail',
          detail: `subprocess driver error: ${err instanceof Error ? err.message : String(err)}`,
        });
      }
    })();
  });
}
