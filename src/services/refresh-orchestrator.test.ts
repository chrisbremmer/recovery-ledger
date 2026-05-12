// Unit coverage for the refresh orchestrator (ADR-0002 §Consequences "single
// refresh consumer"; D-14/D-15/D-16 retry policy from 02-CONTEXT.md and
// 02-RESEARCH.md).
//
// The orchestrator is the SINGLE chokepoint where the 401-reactive retry
// policy lives. token-store.ts owns refresh mechanics (the three-layer gate);
// this file owns retry policy: attempt 1 → 401? → re-read tokens (sibling may
// have refreshed) → if still stale, force refresh via getValidAccessToken() →
// retry once → return that result regardless of status. Retry budget = 1
// (D-15). A failed refresh wraps as AuthError({kind: 'auth_expired'}) and
// does NOT retry (STACK.md §Token refresh point 4).
//
// Test harness shape (mirrors src/services/doctor/index.test.ts lines 116-146):
// per-test `vi.resetModules()` + dynamic `import('./refresh-orchestrator.js')`
// so each test exercises an isolated module-load. The orchestrator's
// production singleton binds to the production tokenStore singleton; tests
// inject mock TokenStore instances via the `createRefreshOrchestrator(store)`
// factory.

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { AuthError } from '../infrastructure/whoop/errors.js';
import type { TokenStore, Tokens } from '../infrastructure/whoop/token-store.js';

// -----------------------------------------------------------------------------
// Mock TokenStore — every test constructs one of these with vi.fn-spied
// methods. Default behavior is "happy path" (read returns fresh tokens,
// getValidAccessToken returns the fresh access_token); tests override per
// scenario by `.mockResolvedValueOnce()` chains.
// -----------------------------------------------------------------------------

interface MockTokenStoreShape {
  store: TokenStore;
  getValidAccessTokenSpy: ReturnType<typeof vi.fn>;
  readSpy: ReturnType<typeof vi.fn>;
  writeSpy: ReturnType<typeof vi.fn>;
  clearSpy: ReturnType<typeof vi.fn>;
  readStorageModeSpy: ReturnType<typeof vi.fn>;
}

function freshTokens(overrides: Partial<Tokens> = {}): Tokens {
  return {
    accessToken: 'at-fresh',
    refreshToken: 'rt-fresh',
    tokenType: 'bearer',
    scope: 'offline read:recovery',
    obtainedAt: 1000,
    expiresAt: 10_000_000_000_000, // far future
    ...overrides,
  };
}

function makeMockTokenStore(): MockTokenStoreShape {
  const getValidAccessTokenSpy = vi.fn(async () => 'at-fresh');
  const readSpy = vi.fn(async () => freshTokens());
  const writeSpy = vi.fn(async () => {});
  const clearSpy = vi.fn(async () => {});
  const readStorageModeSpy = vi.fn(async () => 'keychain' as const);

  return {
    store: {
      getValidAccessToken: getValidAccessTokenSpy,
      read: readSpy,
      write: writeSpy,
      clear: clearSpy,
      readStorageMode: readStorageModeSpy,
    },
    getValidAccessTokenSpy,
    readSpy,
    writeSpy,
    clearSpy,
    readStorageModeSpy,
  };
}

/**
 * Dynamically import the orchestrator module after `vi.resetModules()` so
 * each test gets a fresh module evaluation. Tests that exercise the singleton
 * (S-01, S-02) import the barrel; tests that inject a mock TokenStore use
 * `createRefreshOrchestrator(mockStore)` directly.
 */
async function loadOrchestrator(): Promise<typeof import('./refresh-orchestrator.js')> {
  return import('./refresh-orchestrator.js');
}

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  vi.resetModules();
});

// =============================================================================
// describe('happy path') — D-14: operation returns 200 on first call
// =============================================================================

describe('happy path', () => {
  test('H-01: operation returns 200 on first call → callWithAuth returns response; getValidAccessToken called exactly once', async () => {
    const m = makeMockTokenStore();
    const mod = await loadOrchestrator();
    const orch = mod.createRefreshOrchestrator(m.store);

    const response = { status: 200, body: 'ok' };
    const op = vi.fn(async (_at: string) => response);

    const res = await orch.callWithAuth(op);

    expect(res).toBe(response);
    expect(m.getValidAccessTokenSpy).toHaveBeenCalledTimes(1);
    expect(op).toHaveBeenCalledTimes(1);
  });

  test('H-02: operation is invoked with the access token returned by getValidAccessToken', async () => {
    const m = makeMockTokenStore();
    m.getValidAccessTokenSpy.mockResolvedValueOnce('at-specific-marker');

    const mod = await loadOrchestrator();
    const orch = mod.createRefreshOrchestrator(m.store);

    const op = vi.fn(async (_at: string) => ({ status: 200 }));

    await orch.callWithAuth(op);

    expect(op).toHaveBeenCalledWith('at-specific-marker');
  });
});

// =============================================================================
// describe('401 reactive retry') — D-15 retry budget = 1, D-16 single-flight
// =============================================================================

describe('401 reactive retry', () => {
  test('R-01: sibling refreshed during attempt 1 → re-read sees fresh token → retry with current token; no force-refresh', async () => {
    const m = makeMockTokenStore();
    // First getValidAccessToken returns the initial access token.
    m.getValidAccessTokenSpy.mockResolvedValueOnce('at-stale');
    // After the 401, re-read sees a FRESH token (sibling refreshed our way out).
    const farFutureExpiry = Date.now() + 60 * 60 * 1000;
    m.readSpy.mockResolvedValueOnce(
      freshTokens({ accessToken: 'at-sibling-refreshed', expiresAt: farFutureExpiry }),
    );

    const mod = await loadOrchestrator();
    const orch = mod.createRefreshOrchestrator(m.store);

    const op = vi
      .fn<(at: string) => Promise<{ status: number; marker?: string }>>()
      .mockResolvedValueOnce({ status: 401 })
      .mockResolvedValueOnce({ status: 200, marker: 'after-sibling' });

    const res = await orch.callWithAuth(op);

    expect(res.status).toBe(200);
    expect(op).toHaveBeenCalledTimes(2);
    expect(op).toHaveBeenNthCalledWith(1, 'at-stale');
    expect(op).toHaveBeenNthCalledWith(2, 'at-sibling-refreshed');
    // getValidAccessToken called exactly once — sibling's fresh token from the
    // re-read short-circuits the force-refresh path.
    expect(m.getValidAccessTokenSpy).toHaveBeenCalledTimes(1);
  });

  test('R-02: re-read still stale → force refresh via getValidAccessToken → retry once', async () => {
    const m = makeMockTokenStore();
    m.getValidAccessTokenSpy
      .mockResolvedValueOnce('at-initial-stale')
      .mockResolvedValueOnce('at-after-force-refresh');
    // Re-read shows the same expired token (sibling did NOT refresh).
    const pastExpiry = Date.now() - 1000;
    m.readSpy.mockResolvedValueOnce(
      freshTokens({ accessToken: 'at-initial-stale', expiresAt: pastExpiry }),
    );

    const mod = await loadOrchestrator();
    const orch = mod.createRefreshOrchestrator(m.store);

    const op = vi
      .fn<(at: string) => Promise<{ status: number }>>()
      .mockResolvedValueOnce({ status: 401 })
      .mockResolvedValueOnce({ status: 200 });

    const res = await orch.callWithAuth(op);

    expect(res.status).toBe(200);
    expect(op).toHaveBeenCalledTimes(2);
    expect(op).toHaveBeenNthCalledWith(1, 'at-initial-stale');
    expect(op).toHaveBeenNthCalledWith(2, 'at-after-force-refresh');
    // getValidAccessToken called twice: once on attempt 1, once to force a
    // fresh refresh after the re-read confirmed the token was still stale.
    expect(m.getValidAccessTokenSpy).toHaveBeenCalledTimes(2);
  });

  test('R-03: retry budget exhausted — 401 then 401 → resolves with the second 401 response (no third attempt)', async () => {
    const m = makeMockTokenStore();
    m.getValidAccessTokenSpy
      .mockResolvedValueOnce('at-stale')
      .mockResolvedValueOnce('at-still-bad-after-refresh');
    const pastExpiry = Date.now() - 1000;
    m.readSpy.mockResolvedValueOnce(
      freshTokens({ accessToken: 'at-stale', expiresAt: pastExpiry }),
    );

    const mod = await loadOrchestrator();
    const orch = mod.createRefreshOrchestrator(m.store);

    const second401 = { status: 401, marker: 'second' };
    const op = vi
      .fn<(at: string) => Promise<{ status: number; marker?: string }>>()
      .mockResolvedValueOnce({ status: 401, marker: 'first' })
      .mockResolvedValueOnce(second401);

    const res = await orch.callWithAuth(op);

    expect(res).toBe(second401);
    expect(op).toHaveBeenCalledTimes(2);
  });
});

// =============================================================================
// describe('refresh failure') — D-15 + STACK.md §Token refresh point 4:
// failed refresh → auth_expired (no retry)
// =============================================================================

describe('refresh failure', () => {
  test('F-01: 401 → re-read still stale → getValidAccessToken throws refresh_failed → callWithAuth throws auth_expired wrapping cause; op called exactly once', async () => {
    const m = makeMockTokenStore();
    m.getValidAccessTokenSpy.mockResolvedValueOnce('at-stale');
    const pastExpiry = Date.now() - 1000;
    m.readSpy.mockResolvedValueOnce(
      freshTokens({ accessToken: 'at-stale', expiresAt: pastExpiry }),
    );
    // Force refresh attempt throws refresh_failed from token-store.
    const refreshErr = new AuthError({
      kind: 'refresh_failed',
      detail: 'token endpoint 400',
    });
    m.getValidAccessTokenSpy.mockRejectedValueOnce(refreshErr);

    const mod = await loadOrchestrator();
    const orch = mod.createRefreshOrchestrator(m.store);

    const op = vi.fn(async (_at: string) => ({ status: 401 }));

    let caught: unknown;
    try {
      await orch.callWithAuth(op);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(AuthError);
    expect((caught as AuthError).kind).toBe('auth_expired');
    expect((caught as AuthError).cause).toBe(refreshErr);
    // Op called exactly once — never retry after a refresh failure.
    expect(op).toHaveBeenCalledTimes(1);
  });

  test('F-02: formatAuthError({kind: auth_expired}) mentions the `recovery-ledger auth` remediation', async () => {
    const { formatAuthError } = await import('../infrastructure/whoop/errors.js');
    const expired = new AuthError({ kind: 'auth_expired' });
    const msg = formatAuthError(expired);
    expect(msg).toContain('recovery-ledger auth');
  });
});

// =============================================================================
// describe('services barrel') — createServices() composition root
// =============================================================================

describe('services barrel', () => {
  test('S-01: createServices() returns both runDoctor and refreshOrchestrator; callWithAuth is a function', async () => {
    const mod = await import('./index.js');
    const services = mod.createServices();
    expect(typeof services.runDoctor).toBe('function');
    expect(services.refreshOrchestrator).toBeDefined();
    expect(typeof services.refreshOrchestrator.callWithAuth).toBe('function');
  });

  test('S-02: createRefreshOrchestrator(mockStore).callWithAuth(op) end-to-end happy path returns op result', async () => {
    const m = makeMockTokenStore();
    const mod = await loadOrchestrator();
    const orch = mod.createRefreshOrchestrator(m.store);
    const response = { status: 200, body: 's2-marker' };
    const op = vi.fn(async (_at: string) => response);

    const res = await orch.callWithAuth(op);

    expect(res).toBe(response);
    expect(m.getValidAccessTokenSpy).toHaveBeenCalledTimes(1);
    expect(op).toHaveBeenCalledTimes(1);
  });
});
