// Unit coverage for the rate-limit semaphore (D-20 + 03-PATTERNS.md §B3 +
// 03-RESEARCH.md Pattern 8 + Pitfall 11). Tests use real timers for the
// FIFO + concurrency tests and fake timers for the throttle-delay tests
// so the assertions stay deterministic. `_resetForTest()` runs in
// `beforeEach` so module-level state never bleeds across cases.

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import {
  _resetForTest,
  acquire,
  REMAINING_THROTTLE_THRESHOLD,
  release,
  SEMAPHORE_SIZE,
  THROTTLE_DELAY_MIN_MS,
} from './rate-limit.js';

beforeEach(() => {
  _resetForTest();
});

afterEach(() => {
  // If a test left fake timers installed, restore the real ones before
  // the next test so its `_resetForTest()` runs without scheduler weirdness.
  vi.useRealTimers();
});

describe('rate-limit semaphore', () => {
  test('R-01: SEMAPHORE_SIZE concurrent acquires resolve without waiting', async () => {
    // Four acquires arrive together; all four should resolve immediately
    // because the semaphore allows SEMAPHORE_SIZE in-flight. Using
    // Promise.race against a never-resolving sentinel would be a heavier
    // way to assert "synchronous resolution"; instead we just await all
    // four with a single tick — Vitest fails the test if any promise
    // never resolves.
    expect(SEMAPHORE_SIZE).toBe(4);
    const acquires = [acquire(), acquire(), acquire(), acquire()];
    await expect(Promise.all(acquires)).resolves.toEqual([
      undefined,
      undefined,
      undefined,
      undefined,
    ]);
  });

  test('R-02: a fifth acquire blocks until one of the first four releases', async () => {
    // Saturate the semaphore.
    await Promise.all([acquire(), acquire(), acquire(), acquire()]);

    // The fifth acquire is pending until a release lands.
    let fifthResolved = false;
    const fifth = acquire().then(() => {
      fifthResolved = true;
    });

    // Microtask flush — the fifth promise has had a chance to resolve if
    // it were ever going to do so synchronously. It must not have.
    await Promise.resolve();
    expect(fifthResolved).toBe(false);

    // Release one slot with a healthy remaining header → the fifth fires
    // immediately on the next microtask.
    release('95');
    await fifth;
    expect(fifthResolved).toBe(true);
  });

  test('R-03: release with remaining below threshold delays the next acquire by at least THROTTLE_DELAY_MIN_MS', async () => {
    vi.useFakeTimers();

    // Saturate, then queue a waiter that we will release into.
    await Promise.all([acquire(), acquire(), acquire(), acquire()]);
    let nextResolved = false;
    const next = acquire().then(() => {
      nextResolved = true;
    });
    await Promise.resolve();
    expect(nextResolved).toBe(false);

    // Below-threshold release. The slot must NOT hand off immediately.
    release(String(REMAINING_THROTTLE_THRESHOLD - 1));
    // Flush microtasks; the setTimeout callback should not have fired.
    await Promise.resolve();
    expect(nextResolved).toBe(false);

    // Advance just below the minimum jitter — still must not have fired.
    await vi.advanceTimersByTimeAsync(THROTTLE_DELAY_MIN_MS - 1);
    expect(nextResolved).toBe(false);

    // Advance past the maximum jitter; the delayed release fires.
    await vi.advanceTimersByTimeAsync(THROTTLE_DELAY_MIN_MS + 1);
    await next;
    expect(nextResolved).toBe(true);
  });

  test('R-04: release with remaining above threshold does not delay the next acquire', async () => {
    await Promise.all([acquire(), acquire(), acquire(), acquire()]);
    let nextResolved = false;
    const next = acquire().then(() => {
      nextResolved = true;
    });
    release('95');
    await next;
    expect(nextResolved).toBe(true);
  });

  test('R-05: release with null header (missing X-RateLimit-Remaining) does not delay the next acquire', async () => {
    await Promise.all([acquire(), acquire(), acquire(), acquire()]);
    const next = acquire();
    release(null);
    await expect(next).resolves.toBeUndefined();
  });

  test('R-06: release with malformed header (non-numeric) does not delay the next acquire', async () => {
    await Promise.all([acquire(), acquire(), acquire(), acquire()]);
    const next = acquire();
    release('not-a-number');
    await expect(next).resolves.toBeUndefined();
  });

  test('R-06b: simultaneous below-threshold releases share one throttle window via nextAllowedAcquireAt', async () => {
    vi.useFakeTimers();
    // Saturate the semaphore, then queue two pending acquirers.
    await Promise.all([acquire(), acquire(), acquire(), acquire()]);
    let aResolved = false;
    let bResolved = false;
    const a = acquire().then(() => {
      aResolved = true;
    });
    const b = acquire().then(() => {
      bResolved = true;
    });
    await Promise.resolve();

    // Two below-threshold releases at t=0. Both bump nextAllowedAcquireAt
    // (the second is a no-op since the first already set it to ≥ now+250)
    // and both defer their handoffs via setTimeout. Prior to the fix the
    // jitter values diverged and one timer fired well before the other,
    // collapsing the second waiter's effective throttle.
    release(String(REMAINING_THROTTLE_THRESHOLD - 1));
    release(String(REMAINING_THROTTLE_THRESHOLD - 1));
    await Promise.resolve();
    expect(aResolved).toBe(false);
    expect(bResolved).toBe(false);

    // Below the minimum jitter — neither acquirer can have resolved yet.
    await vi.advanceTimersByTimeAsync(THROTTLE_DELAY_MIN_MS - 1);
    expect(aResolved).toBe(false);
    expect(bResolved).toBe(false);

    // Past the max jitter — both can resolve.
    await vi.advanceTimersByTimeAsync(THROTTLE_DELAY_MIN_MS + 500);
    await a;
    await b;
    expect(aResolved).toBe(true);
    expect(bResolved).toBe(true);
  });

  test('R-08: acquire(signal) abort path — pending waiter is removed from FIFO and rejects with AbortError', async () => {
    // Saturate, then queue a waiter that we will cancel via AbortSignal.
    await Promise.all([acquire(), acquire(), acquire(), acquire()]);
    const ctrl = new AbortController();
    const cancelled = acquire(ctrl.signal);
    // The signal aborts BEFORE any release; the pending resolver is spliced
    // from the FIFO queue and the promise rejects.
    ctrl.abort();
    await expect(cancelled).rejects.toMatchObject({ name: 'AbortError' });

    // After cancellation a subsequent release does NOT crash + does NOT
    // resolve a phantom waiter — the queue is empty.
    release('95');
    // Confirm the slot freed cleanly: a fresh acquire resolves immediately.
    const fresh = await acquire();
    expect(fresh).toBeUndefined();
  });

  test('R-09: acquire(signal) — abort after release-handoff is a no-op (idempotent race)', async () => {
    await Promise.all([acquire(), acquire(), acquire(), acquire()]);
    const ctrl = new AbortController();
    const next = acquire(ctrl.signal);
    // Release first — handoff occurs and the pending resolver is consumed.
    release('95');
    await next; // confirms the slot was granted
    // Late abort: must NOT throw at the caller and must NOT unbalance state.
    ctrl.abort();
    // Sanity: state is still consistent.
    release('95');
    const fresh = await acquire();
    expect(fresh).toBeUndefined();
  });

  test('R-07: _resetForTest returns a clean state even when pending waiters and in-flight slots exist', async () => {
    // Build up a stuck-looking state: 4 in-flight + 1 pending.
    await Promise.all([acquire(), acquire(), acquire(), acquire()]);
    const _doomed = acquire(); // never released
    void _doomed; // we intentionally drop it; _resetForTest wipes pending

    _resetForTest();

    // Subsequent four acquires resolve immediately — proves inFlight=0 + pending=[]
    const fresh = [acquire(), acquire(), acquire(), acquire()];
    await expect(Promise.all(fresh)).resolves.toEqual([undefined, undefined, undefined, undefined]);
  });
});
