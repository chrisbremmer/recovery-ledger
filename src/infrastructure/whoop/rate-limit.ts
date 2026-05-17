// Module-level rate-limit semaphore for the WHOOP HTTP boundary (D-20 +
// 03-PATTERNS.md §B3 + 03-RESEARCH.md Pattern 8 + PITFALLS.md Pitfall 11).
//
// Every `httpGet` call in `client.ts` acquires before the request and
// releases after the response. The semaphore caps in-process concurrency
// at four; once the cap is hit, further acquires wait FIFO on a pending
// queue. On release, the caller passes the response's
// `X-RateLimit-Remaining` header — when fewer than ten requests remain in
// the current minute window, the next acquire is delayed by 250-500ms of
// jitter so the window has time to reset (verified header semantics in
// 03-RESEARCH.md Technical Research item 5: WHOOP documents a 100 req/min
// + 10,000 req/day budget with delta-second reset semantics).
//
// State here is intentionally module-level — multiple `httpGet` call sites
// (cycles, recovery, sleep, workouts) share the same in-process budget so
// fan-out via `Promise.all` still respects the cap. The `_resetForTest`
// seam mirrors token-store's per-instance reset patterns; production code
// never calls it.
//
// ADR-0001: no console calls, no direct stdout writes — structured Pino
// only via the existing logger singleton.

import { logger } from '../config/logger.js';

// D-20: semaphore of 4 concurrent requests in-process. Picked so a
// `Promise.all` fan-out across all four list endpoints does not saturate
// the 100 req/min window after a few pages (verified WHOOP budget +
// Pitfall 11 mitigation).
export const SEMAPHORE_SIZE = 4;

// D-20: throttle the next acquire whenever `X-RateLimit-Remaining` drops
// below ten. Conservative — gives the window time to reset before we burn
// the last few requests.
export const REMAINING_THROTTLE_THRESHOLD = 10;

// Jitter range for the throttle delay. Smaller than the 1s reset window
// (Pitfall 11) so the next acquire still fires inside the same minute, and
// large enough to spread bursty fan-out so two acquires do not coincide.
export const THROTTLE_DELAY_MIN_MS = 250;
export const THROTTLE_DELAY_MAX_MS = 500;

// Pending queue of resolvers waiting for an in-flight slot. FIFO via
// `pending.shift()` on release.
let pending: Array<() => void> = [];
let inFlight = 0;
/**
 * Single shared "next acquire is not allowed before this wall-clock time"
 * timestamp. When the response carries a low `X-RateLimit-Remaining`, every
 * release computes its jittered delay and updates this via Math.max — so
 * three concurrent low-remaining releases do not each schedule independent
 * timers that all fire roughly at the same moment (collapsing the throttle
 * window to ~0). Reset to 0 in `_resetForTest`.
 */
let nextAllowedAcquireAt = 0;

/**
 * Acquire a slot in the semaphore. Resolves immediately when a slot is
 * free; otherwise the returned Promise resolves once a prior caller
 * releases. Callers MUST pair every successful acquire with a release.
 *
 * When a prior release bumped `nextAllowedAcquireAt` (low remaining budget),
 * the acquire defers by the residual amount even when a slot is technically
 * free — so the shared throttle window is honored regardless of which
 * caller triggered it.
 *
 * Optional `signal` — when provided and the signal aborts before the slot
 * is granted, the pending resolver is removed from the FIFO queue and the
 * returned promise rejects with `DOMException('aborted','AbortError')`. The
 * race against `release()` is idempotent: if release picks the resolver
 * before abort, abort becomes a no-op.
 */
export function acquire(signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) {
    return Promise.reject(new DOMException('aborted', 'AbortError'));
  }
  const waitMs = nextAllowedAcquireAt - Date.now();
  if (inFlight < SEMAPHORE_SIZE) {
    inFlight += 1;
    if (waitMs > 0) {
      return new Promise<void>((resolve, reject) => {
        const timer = setTimeout(resolve, waitMs);
        if (signal !== undefined) {
          signal.addEventListener(
            'abort',
            () => {
              clearTimeout(timer);
              // The slot was already accounted for; release it back since
              // the caller never got it.
              inFlight = Math.max(0, inFlight - 1);
              reject(new DOMException('aborted', 'AbortError'));
            },
            { once: true },
          );
        }
      });
    }
    return Promise.resolve();
  }
  return new Promise<void>((resolve, reject) => {
    pending.push(resolve);
    if (signal !== undefined) {
      signal.addEventListener(
        'abort',
        () => {
          const idx = pending.indexOf(resolve);
          if (idx >= 0) {
            pending.splice(idx, 1);
            reject(new DOMException('aborted', 'AbortError'));
          }
          // If idx < 0, the slot has already been handed off via
          // actuallyRelease() and the caller owns it; the abort is a no-op
          // to keep release/acquire pairing intact.
        },
        { once: true },
      );
    }
  });
}

/**
 * Internal helper: decrement the in-flight counter and hand a slot to the
 * next pending acquirer if any. Honors the shared `nextAllowedAcquireAt`
 * throttle by deferring the handoff when the budget is below the threshold
 * — `release()` sets the timestamp; this routine waits out the residual
 * delay before resolving the next waiter.
 */
function actuallyRelease(): void {
  const next = pending.shift();
  if (next !== undefined) {
    // Pass the slot to the waiter — do NOT decrement inFlight, because the
    // waiter now owns the slot. This keeps `inFlight === SEMAPHORE_SIZE`
    // whenever pending callers exist.
    const waitMs = nextAllowedAcquireAt - Date.now();
    if (waitMs > 0) {
      setTimeout(next, waitMs);
    } else {
      next();
    }
    return;
  }
  inFlight -= 1;
}

/**
 * Release the slot held by the caller. Pass the value of the response's
 * `X-RateLimit-Remaining` header (or `null` if no response was produced —
 * e.g., a network error). When the remaining budget is below the
 * threshold, the SHARED `nextAllowedAcquireAt` timestamp is bumped — so
 * concurrent low-remaining releases collaborate on one effective throttle
 * window rather than each scheduling an independent timer that fires roughly
 * simultaneously.
 */
export function release(remainingHeader: string | null): void {
  const parsed = remainingHeader === null ? Number.NaN : Number(remainingHeader);
  const remaining = Number.isNaN(parsed) ? null : parsed;
  if (remaining !== null && remaining < REMAINING_THROTTLE_THRESHOLD) {
    const delayMs =
      THROTTLE_DELAY_MIN_MS + Math.random() * (THROTTLE_DELAY_MAX_MS - THROTTLE_DELAY_MIN_MS);
    nextAllowedAcquireAt = Math.max(nextAllowedAcquireAt, Date.now() + delayMs);
    logger.warn({ event: 'rate_limit_throttle', remaining, delayMs });
  }
  actuallyRelease();
}

/**
 * Test-only seam: reset module-level state so tests do not bleed across
 * each other. Mirrors the in-process gate reset patterns in
 * token-store.ts. Production code never calls this.
 */
export function _resetForTest(): void {
  pending = [];
  inFlight = 0;
  nextAllowedAcquireAt = 0;
}
