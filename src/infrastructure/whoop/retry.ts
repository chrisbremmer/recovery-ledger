// Header-honoring retry wrapper for the WHOOP HTTP boundary (D-20 +
// 03-PATTERNS.md §B4 + 03-RESEARCH.md Pattern 8 + Technical Research
// item 5 + PITFALLS.md Pitfall 11 + Answer A5 defense-in-depth cap).
//
// Two retryable arms:
//   429 — sleep `X-RateLimit-Reset` (delta seconds per A5, NOT epoch) +
//         a touch of jitter, capped at 60s as a defense-in-depth ceiling
//         in case WHOOP ever returns a wildly large value (test R-06).
//   5xx — sleep exponential-base + jittered random fraction, capped at
//         5s. The 5xx arm uses fixed exponential because no upstream
//         header tells us when the WHOOP server will recover.
//
// Retry budget is one. If the second attempt also fails the same way,
// the wrapper returns the result and lets the caller (`httpGet` in
// client.ts) classify the final status into a `WhoopApiError` kind. Non-
// retryable 4xx responses (400, 403, 404, 422) return immediately on the
// first attempt — the caller decides how to surface them.
//
// ADR-0001: no console calls, no direct stdout writes — structured Pino
// only via the existing logger singleton.

import { logger } from '../config/logger.js';

/**
 * Defense-in-depth ceiling on the 429 sleep duration (Answer A5). WHOOP
 * documents `X-RateLimit-Reset` as delta seconds, capped well below
 * 60 by their 100-req/min budget; a value above this threshold means
 * either a server bug or a spec change, and we refuse to burn a whole
 * minute on a stale header.
 */
export const RATE_LIMIT_RESET_SLEEP_CAP_MS = 60_000;

/** Retry budget per `withRetry` call. D-20: a single retry, not a loop. */
export const RETRY_BUDGET = 1;

/** Base sleep for the 5xx arm. */
export const EXP_BACKOFF_BASE_MS = 500;

/** Cap on the 5xx sleep. Generous because 5xx is rare and we want to
 *  give the WHOOP backend a moment without overloading the user with a
 *  multi-second pause. */
export const EXP_BACKOFF_MAX_MS = 5_000;

/**
 * Minimum number-of-seconds the 429 arm sleeps when the header is
 * missing or malformed. Picked as 1s — generous enough to clear a
 * single-spike per-second window without artificially padding the
 * happy path.
 */
const RATE_LIMIT_RESET_FALLBACK_SEC = 1;

export interface RetryDeps {
  /** DI seam — defaults to `setTimeout`-backed sleep. Tests inject a spy. */
  sleep?: (ms: number) => Promise<void>;
  /** DI seam — defaults to `Math.random()`. Tests inject `() => 0.5` for
   *  deterministic jitter. */
  jitter?: () => number;
}

export interface RetryResult<T> {
  status: number;
  headers: Headers;
  body: T;
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function defaultJitter(): number {
  return Math.random();
}

/**
 * Run `fn` once, optionally retry on 429 or 5xx, and return the final
 * result. The caller (`httpGet`) is responsible for mapping the final
 * status into a `WhoopApiError` kind via `classifyHttpError` — this
 * wrapper does not throw on retryable statuses.
 */
export async function withRetry<T>(
  fn: () => Promise<RetryResult<T>>,
  deps?: RetryDeps,
): Promise<RetryResult<T>> {
  const sleep = deps?.sleep ?? defaultSleep;
  const jitter = deps?.jitter ?? defaultJitter;

  const first = await fn();
  if (first.status < 400) {
    return first;
  }

  if (first.status === 429) {
    const sleepMs = computeRateLimitResetSleepMs(first.headers, jitter);
    logger.warn({
      event: 'rate_limit_429',
      sleepMs,
    });
    await sleep(sleepMs);
    return fn();
  }

  if (first.status >= 500 && first.status < 600) {
    const sleepMs = Math.min(
      EXP_BACKOFF_BASE_MS + EXP_BACKOFF_BASE_MS * jitter(),
      EXP_BACKOFF_MAX_MS,
    );
    logger.warn({ event: 'server_5xx_retry', status: first.status, sleepMs });
    await sleep(sleepMs);
    return fn();
  }

  // Non-retryable 4xx (400, 403, 404, 422, etc.) — return immediately and
  // let `classifyHttpError` route the kind. Budget never spent.
  return first;
}

function computeRateLimitResetSleepMs(headers: Headers, jitter: () => number): number {
  const raw = headers.get('X-RateLimit-Reset');
  const parsed = raw === null ? Number.NaN : Number(raw);
  const resetSec = Number.isNaN(parsed) || parsed <= 0 ? RATE_LIMIT_RESET_FALLBACK_SEC : parsed;
  const sleepMs = resetSec * 1000 + jitter() * 250;
  return Math.min(sleepMs, RATE_LIMIT_RESET_SLEEP_CAP_MS);
}
