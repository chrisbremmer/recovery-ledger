// Unit coverage for the retry wrapper (D-20 + 03-PATTERNS.md §B4 +
// 03-RESEARCH.md Pattern 8 + A5 sleep cap + Pitfall 11). Tests inject
// the `sleep` and `jitter` DI seams so no real timers run — assertions
// can compare exact sleep values without flakiness.

import { describe, expect, test, vi } from 'vitest';
import { WhoopApiError } from './errors.js';
import {
  EXP_BACKOFF_BASE_MS,
  EXP_BACKOFF_MAX_MS,
  parseRetryAfter,
  RATE_LIMIT_RESET_SLEEP_CAP_MS,
  type RetryResult,
  withRetry,
} from './retry.js';

interface Spies {
  sleep: ReturnType<typeof vi.fn<(ms: number) => Promise<void>>>;
  jitter: ReturnType<typeof vi.fn<() => number>>;
}

function makeSpies(jitterValue = 0.5): Spies {
  return {
    sleep: vi.fn<(ms: number) => Promise<void>>(async (_ms: number) => undefined),
    jitter: vi.fn<() => number>(() => jitterValue),
  };
}

function makeResult<T>(
  status: number,
  body: T,
  headers: Record<string, string> = {},
): RetryResult<T> {
  return { status, body, headers: new Headers(headers) };
}

describe('withRetry', () => {
  test('Y-01: 200 response returns immediately and sleep is never called', async () => {
    const spies = makeSpies();
    const fn = vi.fn(async () => makeResult(200, { ok: true }));

    const result = await withRetry(fn, spies);

    expect(result.status).toBe(200);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(spies.sleep).not.toHaveBeenCalled();
  });

  test('Y-02: 429 with X-RateLimit-Reset=3 sleeps ~3 seconds then retries once', async () => {
    const spies = makeSpies(0.5);
    const fn = vi
      .fn<() => Promise<RetryResult<unknown>>>()
      .mockResolvedValueOnce(makeResult(429, null, { 'X-RateLimit-Reset': '3' }))
      .mockResolvedValueOnce(makeResult(200, { ok: true }));

    const result = await withRetry(fn, spies);

    expect(result.status).toBe(200);
    expect(fn).toHaveBeenCalledTimes(2);
    // 3 seconds (3000ms) + jitter (0.5 * 250 = 125ms) = 3125ms, under the cap.
    expect(spies.sleep).toHaveBeenCalledTimes(1);
    expect(spies.sleep).toHaveBeenCalledWith(3125);
  });

  test('Y-03: 429 retried; second attempt also 429 → result returned without a third attempt (RETRY_BUDGET=1)', async () => {
    const spies = makeSpies(0);
    const fn = vi
      .fn<() => Promise<RetryResult<unknown>>>()
      .mockResolvedValueOnce(makeResult(429, null, { 'X-RateLimit-Reset': '1' }))
      .mockResolvedValueOnce(makeResult(429, null, { 'X-RateLimit-Reset': '1' }));

    const result = await withRetry(fn, spies);

    expect(result.status).toBe(429);
    expect(fn).toHaveBeenCalledTimes(2);
    expect(spies.sleep).toHaveBeenCalledTimes(1);
  });

  test('Y-04: 429 with missing X-RateLimit-Reset header falls back to ~1 second', async () => {
    const spies = makeSpies(0);
    const fn = vi
      .fn<() => Promise<RetryResult<unknown>>>()
      .mockResolvedValueOnce(makeResult(429, null))
      .mockResolvedValueOnce(makeResult(200, { ok: true }));

    await withRetry(fn, spies);

    // 1s fallback (1000ms) + jitter (0 * 250 = 0) = 1000ms.
    expect(spies.sleep).toHaveBeenCalledWith(1000);
  });

  test('Y-05: 429 with malformed X-RateLimit-Reset header falls back to ~1 second', async () => {
    const spies = makeSpies(0);
    const fn = vi
      .fn<() => Promise<RetryResult<unknown>>>()
      .mockResolvedValueOnce(makeResult(429, null, { 'X-RateLimit-Reset': 'abc' }))
      .mockResolvedValueOnce(makeResult(200, { ok: true }));

    await withRetry(fn, spies);

    expect(spies.sleep).toHaveBeenCalledWith(1000);
  });

  test('Y-06: 429 with absurdly large X-RateLimit-Reset is clamped to RATE_LIMIT_RESET_SLEEP_CAP_MS (A5)', async () => {
    const spies = makeSpies(1);
    const fn = vi
      .fn<() => Promise<RetryResult<unknown>>>()
      .mockResolvedValueOnce(makeResult(429, null, { 'X-RateLimit-Reset': '999999' }))
      .mockResolvedValueOnce(makeResult(200, { ok: true }));

    await withRetry(fn, spies);

    expect(spies.sleep).toHaveBeenCalledTimes(1);
    expect(spies.sleep).toHaveBeenCalledWith(RATE_LIMIT_RESET_SLEEP_CAP_MS);
    expect(RATE_LIMIT_RESET_SLEEP_CAP_MS).toBe(60_000);
  });

  test('Y-07: 500 retried with jittered exp backoff; second attempt 500 → result returned without a third attempt', async () => {
    const spies = makeSpies(0.5);
    const fn = vi
      .fn<() => Promise<RetryResult<unknown>>>()
      .mockResolvedValueOnce(makeResult(500, null))
      .mockResolvedValueOnce(makeResult(500, null));

    const result = await withRetry(fn, spies);

    expect(result.status).toBe(500);
    expect(fn).toHaveBeenCalledTimes(2);
    // 500 + 500 * 0.5 = 750ms, under the cap.
    expect(spies.sleep).toHaveBeenCalledTimes(1);
    expect(spies.sleep).toHaveBeenCalledWith(750);
  });

  test('Y-08: 404 returns immediately with no retry and no sleep', async () => {
    const spies = makeSpies();
    const fn = vi.fn(async () => makeResult(404, null));

    const result = await withRetry(fn, spies);

    expect(result.status).toBe(404);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(spies.sleep).not.toHaveBeenCalled();
  });

  test('Y-10: thrown network error is retried once on the same backoff schedule, then re-thrown as WhoopApiError({kind:network})', async () => {
    const spies = makeSpies(0.5);
    const fn = vi
      .fn<() => Promise<RetryResult<unknown>>>()
      .mockRejectedValueOnce(new TypeError('socket dropped'))
      .mockRejectedValueOnce(new TypeError('socket dropped again'));

    await expect(withRetry(fn, spies)).rejects.toBeInstanceOf(WhoopApiError);
    expect(fn).toHaveBeenCalledTimes(2);
    // 5xx-style backoff used for the network retry arm.
    expect(spies.sleep).toHaveBeenCalledWith(750);
  });

  test('Y-11: thrown network error followed by 200 response succeeds after one retry', async () => {
    const spies = makeSpies(0.5);
    const fn = vi
      .fn<() => Promise<RetryResult<unknown>>>()
      .mockRejectedValueOnce(new TypeError('socket dropped'))
      .mockResolvedValueOnce(makeResult(200, { ok: true }));

    const result = await withRetry(fn, spies);
    expect(result.status).toBe(200);
    expect(fn).toHaveBeenCalledTimes(2);
  });

  test('5xx retry whose 2nd attempt throws a network error surfaces as WhoopApiError({kind:network})', async () => {
    const spies = makeSpies(0.5);
    const fn = vi
      .fn<() => Promise<RetryResult<unknown>>>()
      .mockResolvedValueOnce(makeResult(503, { transient: true }))
      .mockRejectedValueOnce(new TypeError('socket dropped on 2nd attempt'));

    let thrown: unknown;
    try {
      await withRetry(fn, spies);
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(WhoopApiError);
    expect((thrown as WhoopApiError).kind).toBe('network');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  test('429 retry whose 2nd attempt throws AbortError surfaces as WhoopApiError({kind:network, detail:request aborted})', async () => {
    const spies = makeSpies(0.5);
    const abortErr = new Error('aborted');
    abortErr.name = 'AbortError';
    const fn = vi
      .fn<() => Promise<RetryResult<unknown>>>()
      .mockResolvedValueOnce(makeResult(429, { rate_limited: true }, { 'X-RateLimit-Reset': '1' }))
      .mockRejectedValueOnce(abortErr);

    let thrown: unknown;
    try {
      await withRetry(fn, spies);
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(WhoopApiError);
    expect((thrown as WhoopApiError).kind).toBe('network');
    expect((thrown as WhoopApiError).detail).toContain('aborted');
  });

  test('Y-12: AbortError is NOT retried — surfaced as WhoopApiError({kind:network, detail:request aborted})', async () => {
    const spies = makeSpies(0.5);
    const abortErr = new Error('aborted');
    abortErr.name = 'AbortError';
    const fn = vi.fn<() => Promise<RetryResult<unknown>>>().mockRejectedValueOnce(abortErr);

    let thrown: unknown;
    try {
      await withRetry(fn, spies);
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(WhoopApiError);
    expect((thrown as WhoopApiError).kind).toBe('network');
    // Single attempt — no retry on timeouts.
    expect(fn).toHaveBeenCalledTimes(1);
    expect(spies.sleep).not.toHaveBeenCalled();
  });

  test('Y-13: parseRetryAfter handles HTTP-date strings (RFC 7231 alt format) without falling to 1s', () => {
    // 30s in the future — should resolve to ≈30000ms, well above the 1s
    // fallback that the prior implementation produced for HTTP-dates.
    const future = new Date(Date.now() + 30_000).toUTCString();
    const ms = parseRetryAfter(future);
    expect(ms).toBeGreaterThan(20_000);
    expect(ms).toBeLessThanOrEqual(31_000);
  });

  test('Y-14: parseRetryAfter handles delta-seconds (the documented WHOOP format)', () => {
    expect(parseRetryAfter('45')).toBe(45_000);
  });

  test('Y-15: parseRetryAfter falls back to 1s on null/empty/garbage', () => {
    expect(parseRetryAfter(null)).toBe(1_000);
    expect(parseRetryAfter('')).toBe(1_000);
    expect(parseRetryAfter('not-a-date-or-number')).toBe(1_000);
  });

  test('Y-16: parseRetryAfter clamps non-positive delta-seconds to 1s', () => {
    expect(parseRetryAfter('-5')).toBe(1_000);
    expect(parseRetryAfter('0')).toBe(1_000);
  });

  test('Y-09: jitter=() => 0.5 produces deterministic sleep values for both retry arms', async () => {
    // 429 arm: 1s fallback + 0.5 * 250 = 1125.
    const spies429 = makeSpies(0.5);
    const fn429 = vi
      .fn<() => Promise<RetryResult<unknown>>>()
      .mockResolvedValueOnce(makeResult(429, null))
      .mockResolvedValueOnce(makeResult(200, { ok: true }));
    await withRetry(fn429, spies429);
    expect(spies429.sleep).toHaveBeenCalledWith(1125);

    // 5xx arm: 500 + 500 * 0.5 = 750.
    const spies500 = makeSpies(0.5);
    const fn500 = vi
      .fn<() => Promise<RetryResult<unknown>>>()
      .mockResolvedValueOnce(makeResult(503, null))
      .mockResolvedValueOnce(makeResult(200, { ok: true }));
    await withRetry(fn500, spies500);
    expect(spies500.sleep).toHaveBeenCalledWith(750);

    // Belt-and-suspenders: confirm the 5xx cap is 5000 and base 500.
    expect(EXP_BACKOFF_BASE_MS).toBe(500);
    expect(EXP_BACKOFF_MAX_MS).toBe(5_000);
  });
});
