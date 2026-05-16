// Unit coverage for the retry wrapper (D-20 + 03-PATTERNS.md §B4 +
// 03-RESEARCH.md Pattern 8 + A5 sleep cap + Pitfall 11). Tests inject
// the `sleep` and `jitter` DI seams so no real timers run — assertions
// can compare exact sleep values without flakiness.

import { describe, expect, test, vi } from 'vitest';
import {
  EXP_BACKOFF_BASE_MS,
  EXP_BACKOFF_MAX_MS,
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
