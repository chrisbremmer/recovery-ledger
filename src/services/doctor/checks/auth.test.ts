// Unit coverage for the `auth` doctor probe (Plan 02-06).
//
// AUTH-03 surface — probeAuth identifies which backend stores tokens
// (keychain / file / missing) WITHOUT triggering a refresh. Per D-22 the
// probe is offline-safe: it must never call `tokenStore.getValidAccessToken`.
//
// Test harness: `AuthProbeDeps` is injected per test so the production
// `tokenStore.readStorageMode` / `tokenStore.read` bindings are not
// exercised. Each test pins the storage-mode + token-presence return
// values directly. The probe must NEVER import or invoke
// `getValidAccessToken` — verified structurally by grep and by spy.

import { afterEach, describe, expect, test, vi } from 'vitest';
import type { Tokens } from '../../../infrastructure/whoop/token-store.js';
import type { AuthProbeDeps } from './auth.js';
import { probeAuth } from './auth.js';
import { CHECK_NAMES } from './check-names.js';

const sampleTokens = (): Tokens => ({
  accessToken: 'at_synthetic',
  refreshToken: 'rt_synthetic',
  tokenType: 'bearer',
  scope: 'read:recovery offline',
  obtainedAt: 1_000_000,
  expiresAt: 1_000_000 + 60 * 60 * 1000,
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('check-names — AUTH and TOKEN_FRESHNESS canonical names (N-01/N-02)', () => {
  test('N-01: CHECK_NAMES.AUTH === "auth" and CHECK_NAMES.TOKEN_FRESHNESS === "token_freshness"', () => {
    expect(CHECK_NAMES.AUTH).toBe('auth');
    expect(CHECK_NAMES.TOKEN_FRESHNESS).toBe('token_freshness');
  });

  test('N-02: the derived CheckName type accepts the new literal values', () => {
    // Compile-time test: the assignment below must type-check. A drift in
    // the derived `CheckName` union (e.g., a typo in the frozen const)
    // breaks the build before this assertion runs.
    const auth: (typeof CHECK_NAMES)[keyof typeof CHECK_NAMES] = 'auth';
    const freshness: (typeof CHECK_NAMES)[keyof typeof CHECK_NAMES] = 'token_freshness';
    expect(auth).toBe('auth');
    expect(freshness).toBe('token_freshness');
  });
});

describe('probeAuth', () => {
  test('AU-01: no storage-mode file -> fail with "no tokens" remediation', async () => {
    const deps: AuthProbeDeps = {
      readStorageMode: async () => null,
      readTokens: async () => null,
    };
    const check = await probeAuth(deps);
    expect(check.name).toBe(CHECK_NAMES.AUTH);
    expect(check.status).toBe('fail');
    expect(check.detail).toContain('no tokens');
    expect(check.detail).toContain('recovery-ledger auth');
  });

  test('AU-02: keychain mode + tokens present -> pass with "auth: keychain"', async () => {
    const deps: AuthProbeDeps = {
      readStorageMode: async () => 'keychain',
      readTokens: async () => sampleTokens(),
    };
    const check = await probeAuth(deps);
    expect(check.name).toBe(CHECK_NAMES.AUTH);
    expect(check.status).toBe('pass');
    expect(check.detail).toBe('auth: keychain');
  });

  test('AU-03: file mode + tokens present -> pass with "auth: file (mode 0600)"', async () => {
    const deps: AuthProbeDeps = {
      readStorageMode: async () => 'file',
      readTokens: async () => sampleTokens(),
    };
    const check = await probeAuth(deps);
    expect(check.name).toBe(CHECK_NAMES.AUTH);
    expect(check.status).toBe('pass');
    expect(check.detail).toBe('auth: file (mode 0600)');
  });

  test('AU-04: keychain mode but tokens null -> fail referencing mode and missing tokens', async () => {
    const deps: AuthProbeDeps = {
      readStorageMode: async () => 'keychain',
      readTokens: async () => null,
    };
    const check = await probeAuth(deps);
    expect(check.name).toBe(CHECK_NAMES.AUTH);
    expect(check.status).toBe('fail');
    expect(check.detail).toContain('mode=keychain');
    expect(check.detail).toContain('tokens missing');
    expect(check.detail).toContain('recovery-ledger auth');
  });

  test('AU-04b: file mode but tokens null -> fail referencing mode and missing tokens', async () => {
    const deps: AuthProbeDeps = {
      readStorageMode: async () => 'file',
      readTokens: async () => null,
    };
    const check = await probeAuth(deps);
    expect(check.status).toBe('fail');
    expect(check.detail).toContain('mode=file');
    expect(check.detail).toContain('tokens missing');
    expect(check.detail).toContain('recovery-ledger auth');
  });

  test('AU-05: probeAuth is offline-safe — never invokes injected getValidAccessToken-equivalents', async () => {
    // The injected deps cover the entire I/O surface (readStorageMode +
    // readTokens). If probeAuth tried to refresh it would need an
    // additional dep that we deliberately do NOT expose on AuthProbeDeps
    // — the type system is the load-bearing forcing function here. This
    // test pins the contract from the consumer side: the two deps wired
    // here are the only functions the probe is permitted to call.
    const readStorageMode = vi.fn(async () => 'keychain' as const);
    const readTokens = vi.fn(async () => sampleTokens());
    await probeAuth({ readStorageMode, readTokens });
    // No other I/O surface exists on the probe — its dep type prevents
    // ever wiring a refresh path. Belt-and-suspenders: the two spies
    // should each have been called exactly once.
    expect(readStorageMode).toHaveBeenCalledTimes(1);
    expect(readTokens).toHaveBeenCalledTimes(1);
  });

  test('AU-06: every fail detail ends with a remediation phrase ("run `recovery-ledger ...`")', async () => {
    const cases: AuthProbeDeps[] = [
      { readStorageMode: async () => null, readTokens: async () => null },
      { readStorageMode: async () => 'keychain', readTokens: async () => null },
      { readStorageMode: async () => 'file', readTokens: async () => null },
    ];
    for (const deps of cases) {
      const check = await probeAuth(deps);
      expect(check.status).toBe('fail');
      expect(check.detail).toMatch(/run `recovery-ledger (auth|init)`/);
    }
  });

  test('AU-07: readStorageMode throw is caught and surfaces as fail with "probe threw"', async () => {
    const deps: AuthProbeDeps = {
      readStorageMode: async () => {
        throw new Error('synthetic storage-mode read failure');
      },
      readTokens: async () => null,
    };
    const check = await probeAuth(deps);
    expect(check.name).toBe(CHECK_NAMES.AUTH);
    expect(check.status).toBe('fail');
    expect(check.detail).toContain('probe threw');
    expect(check.detail).toContain('synthetic storage-mode read failure');
  });
});
