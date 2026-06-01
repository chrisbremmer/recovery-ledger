// `concurrent_writers_stress` doctor probe (Plan 05-05, D-02 #9).
//
// Opt-in, subprocess-gated diagnostic for concurrent-writer contention
// (Pitfall 12). When a user suspects sync + ad-hoc decision adds are racing,
// `recovery-ledger doctor --stress` forks 4 workers that each hammer a tmp DB
// with N BEGIN IMMEDIATE upserts and asserts none of them escapes with a
// SQLITE_BUSY. A clean run is evidence the Phase 3 D-30 busy_timeout=5000
// primitive is serializing writers behind the immediate lock as designed.
//
// Two gates, mirroring `mcp-stdout-purity.ts`:
//   1. `skipSubprocess` — set by the MCP tool handler (skipSubprocessChecks)
//      so this never forks subprocesses from inside the MCP transport.
//   2. `enabled` — only `--stress` flips this true; a default CLI doctor run
//      leaves it off so the 800ms+ fork cost (D-02 #9) is paid only on
//      deliberate invocations.
//
// ADR-0001 (CLAUDE.md §Critical Rules): this module writes nothing to its own
// stdout/stderr. The forked workers write to THEIR stderr, captured per-child
// via the `{ silent: true }` fork option and folded into the fail-detail.
//
// Plan 05-06 wires this probe into runDoctor()'s `--stress` arm (PROBE_NAMES
// last slot). This file ships the standalone probe + worker; it is not yet
// invoked by the orchestrator.

import { fork } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import type { DoctorCheck } from '../index.js';
import { CHECK_NAMES } from './check-names.js';

export interface ConcurrentWritersStressOpts {
  /**
   * Skip the probe entirely (return pass) when running inside an MCP
   * transport. Set by the `whoop_doctor` tool handler via
   * `skipSubprocessChecks` so a fork-spawning probe never runs from MCP.
   * Mirrors `mcp-stdout-purity.ts`'s `skipSubprocess` gate.
   */
  skipSubprocess?: boolean;
  /**
   * Run the real 4-worker fork. Off by default (D-02 #9) — only the CLI
   * `--stress` flag flips this true. A default doctor invocation returns a
   * `pass` "skipped" result without paying the fork cost.
   */
  enabled?: boolean;
  /**
   * LIFE-03 (#83): per-worker watchdog deadline in ms. Defaults to 30s; the
   * test suite can lower this to verify the watchdog actually fires on a
   * hanging worker without the test itself waiting 30s.
   */
  watchdogMs?: number;
  /**
   * LIFE-03 (#83): grace period between SIGTERM and SIGKILL on a hung worker.
   * Defaults to 5s in CI (`process.env.CI`), 2s locally — free-tier GitHub
   * Actions can pause a child for >2s during snapshot-mount, which would
   * race the SIGKILL fallback. Test suite can lower this for fast iteration.
   */
  sigkillDelayMs?: number;
}

const HERE = dirname(fileURLToPath(import.meta.url));

// Resolve the worker entry as a sibling of this module. Under Vitest/tsx the
// sibling is the `.ts` source (forked under the tsx loader below); a built
// dist tree would carry a `.mjs` sibling instead. Checking `.ts` first keeps
// the unit suite green on a non-built tree (the real-fork test runs rather
// than skips); the `.mjs` arm is what production uses once Plan 05-06's build
// emits the worker as a top-level tsup entry.
function resolveWorker(): { path: string; isTs: boolean } | null {
  const tsPath = resolve(HERE, 'concurrent-writers-stress.worker.ts');
  if (existsSync(tsPath)) return { path: tsPath, isTs: true };
  const mjsPath = resolve(HERE, 'concurrent-writers-stress.worker.mjs');
  if (existsSync(mjsPath)) return { path: mjsPath, isTs: false };
  return null;
}

const WORKERS = 4;
const UPSERTS = 50;
// LIFE-03 (#83): per-worker watchdog. A worker that hangs (DB lock acquired
// but never released, native binding deadlock, fork failing under tsx-loader
// hiccup) pends the promise forever and the doctor command — and any vitest
// run exercising this path — hangs indefinitely. CI-aware SIGKILL fallback:
// 5s in `process.env.CI` (snapshot mounts on free-tier runners can pause a
// child for >2s), 2s locally. Threshold defaults are overridable in tests
// via the second argument to probeConcurrentWritersStress for fast iteration.
const WORKER_WATCHDOG_MS_DEFAULT = 30_000;
const SIGKILL_DELAY_MS_DEFAULT = process.env.CI ? 5_000 : 2_000;

interface WorkerResult {
  exitCode: number;
  stderr: string;
}

export async function probeConcurrentWritersStress(
  opts?: ConcurrentWritersStressOpts,
): Promise<DoctorCheck> {
  if (opts?.skipSubprocess === true) {
    return {
      name: CHECK_NAMES.CONCURRENT_WRITERS_STRESS,
      status: 'pass',
      detail: 'skipped (running inside MCP transport)',
    };
  }
  if (opts?.enabled !== true) {
    return {
      name: CHECK_NAMES.CONCURRENT_WRITERS_STRESS,
      status: 'pass',
      detail: 'skipped — run with --stress to enable',
    };
  }

  let tmp: string | undefined;
  try {
    const worker = resolveWorker();
    if (worker === null) {
      return {
        name: CHECK_NAMES.CONCURRENT_WRITERS_STRESS,
        status: 'fail',
        detail: 'probe threw: worker entry not found (build dist or run from source tree)',
      };
    }

    tmp = mkdtempSync(join(tmpdir(), 'rl-stress-'));
    const dbFile = join(tmp, 'stress.sqlite');

    // Pre-create the DB in WAL mode + the stress_test table BEFORE forking.
    // The very first WAL connection on a fresh file must create the -wal/-shm
    // shared-memory files; 4 workers all doing that cold-start switch at once
    // race on file creation and one loses with SQLITE_BUSY regardless of
    // busy_timeout. Initializing once here means every worker attaches to an
    // already-WAL database and only contends on the BEGIN IMMEDIATE write lock
    // — which is the contention the probe exists to measure (Pitfall 12/13).
    const init = new Database(dbFile);
    try {
      init.pragma('journal_mode = WAL');
      init.exec(
        'CREATE TABLE IF NOT EXISTS stress_test (id INTEGER PRIMARY KEY, counter INTEGER NOT NULL)',
      );
    } finally {
      init.close();
    }
    // Forking a `.ts` worker requires the tsx loader; a built `.mjs` worker
    // runs under plain node. `execArgv: []` overrides the parent's argv so a
    // vitest/tsx parent does not leak its own loader flags into the child for
    // the `.mjs` case.
    const execArgv = worker.isTs ? ['--import', 'tsx'] : [];

    // LIFE-03 (#83): per-worker watchdog wired here. SIGTERM at the
    // deadline; SIGKILL `sigkillDelayMs` later if the child still has
    // not exited. Mirrors mcp-stdout-purity.ts:143-167 in spirit.
    const watchdogMs = opts.watchdogMs ?? WORKER_WATCHDOG_MS_DEFAULT;
    const sigkillDelayMs = opts.sigkillDelayMs ?? SIGKILL_DELAY_MS_DEFAULT;
    const start = performance.now();
    const runs = Array.from(
      { length: WORKERS },
      () =>
        new Promise<WorkerResult>((resolveRun) => {
          const child = fork(worker.path, [dbFile, String(UPSERTS)], {
            silent: true,
            execArgv,
          });
          let stderrBuf = '';
          let settled = false;
          const finish = (result: WorkerResult): void => {
            if (settled) return;
            settled = true;
            clearTimeout(watchdog);
            clearTimeout(sigkillTimer);
            resolveRun(result);
          };
          // LIFE-03 (#83): if the child has not exited by `watchdogMs`,
          // send SIGTERM. If it still has not exited `sigkillDelayMs`
          // later, escalate to SIGKILL and synthesize a fail result.
          let sigkillTimer: NodeJS.Timeout = setTimeout(() => undefined, 0);
          clearTimeout(sigkillTimer);
          const watchdog = setTimeout(() => {
            try {
              child.kill('SIGTERM');
            } catch {
              // best-effort
            }
            sigkillTimer = setTimeout(() => {
              try {
                child.kill('SIGKILL');
              } catch {
                // best-effort
              }
              finish({
                exitCode: -1,
                stderr:
                  `${stderrBuf}\nwatchdog: worker did not exit within ${watchdogMs}ms (SIGTERM + SIGKILL fallback)`.trim(),
              });
            }, sigkillDelayMs);
          }, watchdogMs);
          child.stderr?.on('data', (chunk: Buffer) => {
            stderrBuf += chunk.toString('utf8');
          });
          child.on('error', (err) => {
            finish({ exitCode: -1, stderr: `${stderrBuf}${err.message}`.trim() });
          });
          child.on('exit', (code) => {
            finish({ exitCode: code ?? -1, stderr: stderrBuf.trim() });
          });
        }),
    );
    const results = await Promise.all(runs);
    const elapsed = performance.now() - start;

    const failures = results.filter((r) => r.exitCode !== 0);
    if (failures.length === 0) {
      return {
        name: CHECK_NAMES.CONCURRENT_WRITERS_STRESS,
        status: 'pass',
        detail: `concurrent_writers_stress completed: ${WORKERS} workers × ${UPSERTS} upserts in ${Math.round(elapsed)}ms (no SQLITE_BUSY)`,
      };
    }
    const reasons = failures
      .map((f) => `exit ${f.exitCode}${f.stderr ? ` (${f.stderr})` : ''}`)
      .join('; ');
    return {
      name: CHECK_NAMES.CONCURRENT_WRITERS_STRESS,
      status: 'fail',
      detail: `${failures.length} of ${WORKERS} workers failed: ${reasons}`,
    };
  } catch (err) {
    return {
      name: CHECK_NAMES.CONCURRENT_WRITERS_STRESS,
      status: 'fail',
      detail: `probe threw: ${err instanceof Error ? err.message : String(err)}`,
    };
  } finally {
    if (tmp !== undefined) {
      try {
        rmSync(tmp, { recursive: true, force: true });
      } catch {
        // tmp dir cleanup is best-effort; the OS reclaims tmpdir on reboot.
      }
    }
  }
}
