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
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TokenStore, Tokens } from '../infrastructure/whoop/token-store.js';
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
    expect(typeof app.services.runDoctor).toBe('function');
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

  // Phase 10 ARCH-02 (#85): bootstrap accepts an injected `tokenStore` and
  // threads it through both the constructed `refreshOrchestrator` (so
  // future getValidAccessToken calls route through the fake) AND the
  // `services.tokenStore` surface. The injected instance MUST be the same
  // object both consumers reach.
  it('Test 4a: bootstrap honors an injected tokenStore (ARCH-02 wiring)', () => {
    const fakeTokens: Tokens = {
      accessToken: 'inject-at',
      refreshToken: 'inject-rt',
      tokenType: 'bearer',
      scope: 'offline',
      obtainedAt: 0,
      expiresAt: Date.now() + 60 * 60 * 1000,
    };
    const getValidAccessToken = vi.fn(async () => fakeTokens.accessToken);
    const customStore: TokenStore = {
      getValidAccessToken,
      read: async () => fakeTokens,
      write: async () => undefined,
      clear: async () => undefined,
      readStorageMode: async () => 'file',
    };
    app = bootstrap({
      dbFile: resolve(tmpDir, 'db.sqlite'),
      tokenStore: customStore,
    });
    // Identity assertion — the injected store IS the one on the surface.
    expect(app.services.tokenStore).toBe(customStore);
    // The bootstrap-constructed orchestrator must route through the same
    // injected store. Drive a callWithAuth and assert the fake's
    // `getValidAccessToken` fired exactly once.
    return app.services.refreshOrchestrator
      .callWithAuth(async (accessToken) => ({
        status: 200,
        token: accessToken,
      }))
      .then((res) => {
        expect(res.status).toBe(200);
        expect((res as { token: string }).token).toBe('inject-at');
        expect(getValidAccessToken).toHaveBeenCalledTimes(1);
      });
  });

  // LIFE-01 (#81): bootstrap pairs openDb with try/catch closing the
  // sqlite handle when migrate() throws. A second open on the same dbFile
  // immediately after the throw must succeed without SQLITE_BUSY.
  it('Test 4: bootstrap closes the SQLite handle when migrate() throws (#81)', () => {
    const dbFile = resolve(tmpDir, 'life01.sqlite');
    // Point at a migrationsDir that does not exist — migrate() will
    // throw a MigrationError before any apply.
    const missingMigrationsDir = resolve(tmpDir, 'does-not-exist');

    let firstErr: unknown = null;
    try {
      app = bootstrap({ dbFile, migrationsDir: missingMigrationsDir });
    } catch (err) {
      firstErr = err;
    }
    expect(firstErr).not.toBeNull();
    expect(app).toBeNull();

    // Second open on the SAME dbFile must succeed. Pre-LIFE-01 the
    // first open's handle was never closed and this would SQLITE_BUSY
    // (or hang) until GC.
    expect(() => {
      app = bootstrap({ dbFile });
    }).not.toThrow();
  });
});

describe('createServices() — DB-dependent methods are absent from the type (D-31)', () => {
  it('Test 4: createServices() returns ServicesBase; DB-backed methods are absent at runtime', () => {
    const services = createServices();
    // Phase 1-2 surface is present.
    expect(typeof services.runDoctor).toBe('function');
    // Phase 10 ARCH-02 (#85): refreshOrchestrator and tokenStore are no
    // longer on ServicesBase — bootstrap() owns construction. The
    // lightweight createServices() returns only `{ runDoctor }`.
    const asAny = services as unknown as Record<string, unknown>;
    expect(asAny.refreshOrchestrator).toBeUndefined();
    expect(asAny.tokenStore).toBeUndefined();
    expect(asAny.runSync).toBeUndefined();
    expect(asAny.getDailyReview).toBeUndefined();
    expect(asAny.getWeeklyReview).toBeUndefined();
    expect(asAny.addDecision).toBeUndefined();
    expect(asAny.reviewDecisions).toBeUndefined();
    expect(asAny.queryCache).toBeUndefined();
    expect(asAny.getApiGap).toBeUndefined();
  });
});

// Compile-time regression guard for #13 + Phase 10 ARCH-02. Each line below
// would FAIL to compile if `createServices()`'s return type ever widens back
// to include the method, because @ts-expect-error requires the suppressed
// line to actually emit a type error. Wrapped in a function never invoked
// so the expressions are never executed at runtime.
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
  // Phase 10 ARCH-02: refreshOrchestrator + tokenStore moved off ServicesBase
  // @ts-expect-error — refreshOrchestrator is not on ServicesBase (ARCH-02)
  type _Refresh = typeof services.refreshOrchestrator;
  // @ts-expect-error — tokenStore is not on ServicesBase (ARCH-02)
  type _TokStore = typeof services.tokenStore;
}
