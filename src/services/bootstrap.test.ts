// bootstrap.ts smoke tests (Plan 04-08 Task 2). Asserts that bootstrap()
// returns a Bootstrapped value carrying all 7 service methods (Phase 3's
// runSync + the 6 new Phase 4 methods). Per-method functional tests live
// in the per-service test files (`review/daily.test.ts`,
// `cache/index.test.ts`, etc.) which compose the in-memory-db helper
// directly; the smoke test here only confirms wiring discipline.
//
// The test opens a fresh `:memory:` SQLite per run via the same path the
// production bootstrap takes — `openDb(':memory:')` then `migrate()` —
// so the wired services have a functioning DB underneath them. The
// migrator short-circuits its backup step for ':memory:' (Plan 03-05
// connection.ts contract).

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { type Bootstrapped, bootstrap } from './bootstrap.js';
import { createServices } from './index.js';

describe('bootstrap() — Phase 4 service wiring', () => {
  let tmpDir: string;
  let app: Bootstrapped | null = null;

  beforeEach(() => {
    tmpDir = mkdtempSync(resolve(tmpdir(), 'rl-bootstrap-test-'));
  });
  afterEach(() => {
    if (app !== null) {
      app.close();
      app = null;
    }
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('Test 1: bootstrap() returns a services object with all 7 method slots', () => {
    app = bootstrap({ dbFile: resolve(tmpDir, 'db.sqlite') });
    expect(typeof app.services.runSync).toBe('function');
    expect(typeof app.services.getDailyReview).toBe('function');
    expect(typeof app.services.getWeeklyReview).toBe('function');
    expect(typeof app.services.addDecision).toBe('function');
    expect(typeof app.services.reviewDecisions).toBe('function');
    expect(typeof app.services.queryCache).toBe('function');
    expect(typeof app.services.getApiGap).toBe('function');
  });

  it('Test 2: getApiGap() returns a non-empty entries array (smoke test through the wired service)', async () => {
    app = bootstrap({ dbFile: resolve(tmpDir, 'db.sqlite') });
    const result = await app.services.getApiGap();
    expect(Array.isArray(result.entries)).toBe(true);
    expect(result.entries.length).toBeGreaterThan(0);
  });

  it('Test 3: queryCache() over an empty DB returns count=0, truncated=false', async () => {
    app = bootstrap({ dbFile: resolve(tmpDir, 'db.sqlite') });
    const result = await app.services.queryCache({ resource: 'cycles' });
    expect(result.resource).toBe('cycles');
    expect(result.count).toBe(0);
    expect(result.truncated).toBe(false);
    expect(result.rows).toHaveLength(0);
  });
});

describe('createServices() — DB-dependent methods throw (D-31)', () => {
  it('Test 4: every DB-backed method throws with a bootstrap-pointer message', () => {
    const services = createServices();
    expect(() => services.runSync({} as never)).toThrow(/bootstrap\(\)/);
    expect(() => services.getDailyReview({})).toThrow(/bootstrap\(\)/);
    expect(() => services.getWeeklyReview({})).toThrow(/bootstrap\(\)/);
    expect(() => services.addDecision({ decision: 'x' })).toThrow(/bootstrap\(\)/);
    expect(() => services.reviewDecisions({ mode: 'list' })).toThrow(/bootstrap\(\)/);
    expect(() => services.queryCache({ resource: 'cycles' })).toThrow(/bootstrap\(\)/);
    expect(() => services.getApiGap()).toThrow(/bootstrap\(\)/);
  });
});
