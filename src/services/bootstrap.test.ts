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

describe('createServices() — DB-dependent methods are absent from the type (D-31)', () => {
  it('Test 4: createServices() returns ServicesBase; DB-backed methods are absent at runtime', () => {
    const services = createServices();
    // Phase 1-2 surface is present.
    expect(typeof services.runDoctor).toBe('function');
    expect(typeof services.refreshOrchestrator.callWithAuth).toBe('function');
    // Runtime confirms the absence — the previous stub satisfied the full
    // Services interface with throwing functions, so these property reads
    // returned a callable that threw on invocation. After the fix the type
    // is narrowed to ServicesBase and these reads return undefined.
    const asAny = services as unknown as Record<string, unknown>;
    expect(asAny.runSync).toBeUndefined();
    expect(asAny.getDailyReview).toBeUndefined();
    expect(asAny.getWeeklyReview).toBeUndefined();
    expect(asAny.addDecision).toBeUndefined();
    expect(asAny.reviewDecisions).toBeUndefined();
    expect(asAny.queryCache).toBeUndefined();
    expect(asAny.getApiGap).toBeUndefined();
  });
});

// Compile-time regression guard for #13. Each line below would FAIL to
// compile if `createServices()`'s return type ever widens back to include
// the method, because @ts-expect-error requires the suppressed line to
// actually emit a type error. Wrapped in a function never invoked so the
// expressions are never executed at runtime.
function _typeGuard_createServicesIsServicesBase(): void {
  const services = createServices();
  // @ts-expect-error — runSync is not on ServicesBase
  type _RunSync = typeof services.runSync;
  // @ts-expect-error — getDailyReview is not on ServicesBase
  type _Daily = typeof services.getDailyReview;
  // @ts-expect-error — getWeeklyReview is not on ServicesBase
  type _Weekly = typeof services.getWeeklyReview;
  // @ts-expect-error — addDecision is not on ServicesBase
  type _AddDec = typeof services.addDecision;
  // @ts-expect-error — reviewDecisions is not on ServicesBase
  type _RevDec = typeof services.reviewDecisions;
  // @ts-expect-error — queryCache is not on ServicesBase
  type _Query = typeof services.queryCache;
  // @ts-expect-error — getApiGap is not on ServicesBase
  type _Gap = typeof services.getApiGap;
}
