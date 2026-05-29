// Unit suite for the concurrent_writers_stress probe (Plan 05-05, D-02 #9).
//
// Three cases mirror the gate cascade + the real-fork path:
//   1. skipSubprocess=true → pass "skipped (running inside MCP transport)".
//   2. enabled !== true (default) → pass "skipped — run with --stress".
//   3. enabled=true → real 4-worker fork against a tmp DB; asserts pass with
//      the documented completion detail (no SQLITE_BUSY).
//
// Case 3 forks the worker. Under Vitest (pool: 'forks') the probe resolves the
// `.ts` worker sibling and forks it under the tsx loader, so the test runs on
// a non-built tree without `npm run build`. The skipIf guard is a robustness
// net: if neither the `.ts` nor `.mjs` worker exists at the resolved path the
// case skips rather than fails — but on this tree the `.ts` exists, so it runs.
//
// ADR-0006: no real WHOOP calls — this is a pure local-SQLite contention probe.

import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';
import { CHECK_NAMES } from './check-names.js';
import { probeConcurrentWritersStress } from './concurrent-writers-stress.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const WORKER_EXISTS =
  existsSync(resolve(HERE, 'concurrent-writers-stress.worker.ts')) ||
  existsSync(resolve(HERE, 'concurrent-writers-stress.worker.mjs'));

describe('probeConcurrentWritersStress', () => {
  test('returns pass with skipped detail when skipSubprocess is true', async () => {
    const result = await probeConcurrentWritersStress({ skipSubprocess: true });
    expect(result.name).toBe(CHECK_NAMES.CONCURRENT_WRITERS_STRESS);
    expect(result.status).toBe('pass');
    expect(result.detail).toBe('skipped (running inside MCP transport)');
    expect(result.detail).toContain('running inside MCP');
  });

  test('returns pass with skipped detail when enabled is false (default)', async () => {
    const result = await probeConcurrentWritersStress({});
    expect(result.name).toBe(CHECK_NAMES.CONCURRENT_WRITERS_STRESS);
    expect(result.status).toBe('pass');
    expect(result.detail).toBe('skipped — run with --stress to enable');
    expect(result.detail).toContain('run with --stress');

    // `{ enabled: false }` is equivalent to the empty-opts default.
    const explicit = await probeConcurrentWritersStress({ enabled: false });
    expect(explicit.status).toBe('pass');
    expect(explicit.detail).toContain('run with --stress');
  });

  test.skipIf(!WORKER_EXISTS)(
    'returns pass when 4 workers complete without SQLITE_BUSY',
    async () => {
      const result = await probeConcurrentWritersStress({ enabled: true });
      expect(result.name).toBe(CHECK_NAMES.CONCURRENT_WRITERS_STRESS);
      expect(result.status, `detail: ${result.detail}`).toBe('pass');
      expect(result.detail).toContain('4 workers × 50 upserts');
      expect(result.detail).toContain('(no SQLITE_BUSY)');
    },
    15_000,
  );
});
