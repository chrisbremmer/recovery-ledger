// Unit coverage for the `token_freshness` doctor probe (Plan 02-06).
//
// AUTH-03 surface — probeTokenFreshness reports how close tokens are to
// expiry WITHOUT triggering a refresh. Per D-22 the probe is offline-safe:
// it must never call `tokenStore.getValidAccessToken`. Per D-14 the
// 5-minute buffer determines warn vs pass.
//
// Test harness: `TokenFreshnessProbeDeps` injects `now()` and `read()` so
// the probe is exercised without clock dependence and without disk I/O.

import { describe, expect, test, vi } from 'vitest';
import type { Tokens } from '../../../infrastructure/whoop/token-store.js';
import { CHECK_NAMES } from './check-names.js';
import type { TokenFreshnessProbeDeps } from './token-freshness.js';
import { formatDuration, probeTokenFreshness } from './token-freshness.js';

const NOW = 1_700_000_000_000; // fixed wall-clock anchor

const tokensAtExpiry = (expiresAt: number): Tokens => ({
  accessToken: 'at_synthetic',
  refreshToken: 'rt_synthetic',
  tokenType: 'bearer',
  scope: 'read:recovery offline',
  obtainedAt: NOW - 60 * 60 * 1000,
  expiresAt,
});

describe('formatDuration helper (TF-06)', () => {
  test('returns "0m" for 0ms', () => {
    expect(formatDuration(0)).toBe('0m');
  });

  test('returns "45m" for 45 minutes', () => {
    expect(formatDuration(45 * 60 * 1000)).toBe('45m');
  });

  test('returns "2h 5m" for 125 minutes', () => {
    expect(formatDuration(125 * 60 * 1000)).toBe('2h 5m');
  });

  test('returns "1h 0m" for exactly 60 minutes', () => {
    expect(formatDuration(60 * 60 * 1000)).toBe('1h 0m');
  });

  test('returns "59m" for just under an hour', () => {
    expect(formatDuration(59 * 60 * 1000)).toBe('59m');
  });
});

describe('probeTokenFreshness', () => {
  test('TF-01: tokens fresh (expires in 60m) -> pass with "expires in <Xm>"', async () => {
    const deps: TokenFreshnessProbeDeps = {
      now: () => NOW,
      read: async () => tokensAtExpiry(NOW + 60 * 60 * 1000),
    };
    const check = await probeTokenFreshness(deps);
    expect(check.name).toBe(CHECK_NAMES.TOKEN_FRESHNESS);
    expect(check.status).toBe('pass');
    expect(check.detail).toMatch(/expires in (\d+h )?\d+m/);
  });

  test('TF-02: tokens within 5-minute buffer (4m left) -> warn with "expires in <Xm>"', async () => {
    const deps: TokenFreshnessProbeDeps = {
      now: () => NOW,
      read: async () => tokensAtExpiry(NOW + 4 * 60 * 1000),
    };
    const check = await probeTokenFreshness(deps);
    expect(check.name).toBe(CHECK_NAMES.TOKEN_FRESHNESS);
    expect(check.status).toBe('warn');
    expect(check.detail).toMatch(/expires in \dm/);
  });

  test('TF-02b: tokens at exactly the buffer boundary (5m left) -> warn (boundary inclusive)', async () => {
    // D-14: buffer is 5 minutes. expiresAt === now + 5min is the upper edge
    // of the warn window. Pin the contract: the boundary belongs to warn,
    // not pass — a refresh should be considered imminent at the boundary
    // to mirror token-store.ts's `> now() + REFRESH_BUFFER_MS` test.
    const deps: TokenFreshnessProbeDeps = {
      now: () => NOW,
      read: async () => tokensAtExpiry(NOW + 5 * 60 * 1000),
    };
    const check = await probeTokenFreshness(deps);
    expect(check.status).toBe('warn');
  });

  test('TF-03: tokens expired 2h ago -> fail with "expired <duration> ago" + remediation', async () => {
    const deps: TokenFreshnessProbeDeps = {
      now: () => NOW,
      read: async () => tokensAtExpiry(NOW - 2 * 60 * 60 * 1000),
    };
    const check = await probeTokenFreshness(deps);
    expect(check.name).toBe(CHECK_NAMES.TOKEN_FRESHNESS);
    expect(check.status).toBe('fail');
    expect(check.detail).toMatch(/expired \d+h \d+m ago/);
    expect(check.detail).toContain('recovery-ledger auth');
  });

  test('TF-04: read() returns null -> fail with "no tokens"', async () => {
    const deps: TokenFreshnessProbeDeps = {
      now: () => NOW,
      read: async () => null,
    };
    const check = await probeTokenFreshness(deps);
    expect(check.name).toBe(CHECK_NAMES.TOKEN_FRESHNESS);
    expect(check.status).toBe('fail');
    expect(check.detail).toBe('no tokens');
  });

  test('TF-05: probeTokenFreshness is offline-safe — only reads via injected `read`', async () => {
    // The injected deps cover the entire I/O surface (read + now). The
    // probe's TokenFreshnessProbeDeps type deliberately does NOT expose
    // a refresh seam; the type system is the load-bearing forcing
    // function. This test pins the call shape: `read` is invoked once;
    // `now` may be invoked multiple times (e.g., for both threshold
    // comparison and detail formatting).
    const now = vi.fn(() => NOW);
    const read = vi.fn(async () => tokensAtExpiry(NOW + 60 * 60 * 1000));
    await probeTokenFreshness({ now, read });
    expect(read).toHaveBeenCalledTimes(1);
    expect(now.mock.calls.length).toBeGreaterThanOrEqual(1);
  });

  test('TF-07: read throw is caught and surfaces as fail with "probe threw"', async () => {
    const deps: TokenFreshnessProbeDeps = {
      now: () => NOW,
      read: async () => {
        throw new Error('synthetic token read failure');
      },
    };
    const check = await probeTokenFreshness(deps);
    expect(check.name).toBe(CHECK_NAMES.TOKEN_FRESHNESS);
    expect(check.status).toBe('fail');
    expect(check.detail).toContain('probe threw');
    expect(check.detail).toContain('synthetic token read failure');
  });
});
