// WHOOP HTTP client — the SINGLE chokepoint where every WHOOP GET is
// issued (D-17 + D-18 + D-21 + ADR-0007 + 03-PATTERNS.md §B1 +
// 03-RESEARCH.md Code Examples line 821-858).
//
// Composition (each side responsibility lives in one named file):
//   - rate-limit.ts owns the semaphore-of-4 + remaining<10 throttle (D-20)
//   - retry.ts owns 429-with-X-RateLimit-Reset + 5xx backoff (D-20 + A5)
//   - `authedCall: AuthedCall` (Phase 10 ARCH-03) is INJECTED as the 4th
//     parameter to `httpGet` — wraps the underlying fetch in the
//     bootstrap-constructed `refreshOrchestrator.callWithAuth` (ADR-0002
//     three-layer single-flight gate). The previous module-level
//     `callWithAuth` import was the last infrastructure → services upward
//     arrow in the codebase; Phase 10 ARCH-03 inverted it so this module
//     no longer imports from `src/services/`.
//   - errors.ts owns the WhoopApiError union + classifyHttpError mapping
//   - zod schemas (`src/domain/schemas/whoop-api.ts`) own response shape
//     validation; we call `.parse` at the boundary
//
// GET-only — no POST/PUT/PATCH/DELETE helpers exported (ADR-0007 + D-21
// read-only WHOOP). The OAuth token POST stays in `token-store.ts` and
// `oauth.ts`; those plus this file are the three call sites the CI
// grep gate (Gate F) permits for the global fetch primitive. No console
// calls, no direct stdout writes — structured Pino only via the existing
// logger singleton (ADR-0001). `WHOOP_API_BASE` is the only place the
// production host is spelled in the codebase, mirroring how
// `WHOOP_TOKEN_URL` is constrained by Gate E.

import type { z } from 'zod';
import { logger } from '../config/logger.js';
import { classifyHttpError, WhoopApiError } from './errors.js';
import { acquire, release } from './rate-limit.js';
import { withRetry } from './retry.js';

/**
 * Phase 10 ARCH-03: the injected single-flight refresh closure passed to
 * `httpGet` (and to every resource-module factory). The shape is the bare
 * minimum the client + resource modules need from the orchestrator —
 * `<T extends {status: number}>` so the 401-reactive retry path inside
 * `RefreshOrchestrator.callWithAuth` still narrows on the response shape.
 * Bootstrap wraps this as an arrow closure
 * (`(op) => refreshOrchestrator.callWithAuth(op)` in `src/services/bootstrap.ts`),
 * which routes through whichever orchestrator instance is live without
 * pinning a particular `this` binding. Tests inject
 * `(op) => op('test-token-...')` directly.
 */
export type AuthedCall = <T extends { status: number }>(
  op: (accessToken: string) => Promise<T>,
) => Promise<T>;

/**
 * Production WHOOP API host. Pinned per ADR-0007 (read-only WHOOP) and
 * D-21. The only file under `src/` (alongside `token-store.ts` and
 * `oauth.ts`, which spell the token-endpoint URL) where this host is
 * referenced.
 */
export const WHOOP_API_BASE = 'https://api.prod.whoop.com';

/**
 * Per-request timeout. A stalled TCP connection (TLS handshake hang, dead
 * proxy, paused server) without a timeout holds the rate-limit semaphore
 * slot forever and ultimately stalls the entire sync run. 30 seconds is
 * generous for the largest WHOOP page (25 records) and short enough that
 * the user notices the stall during a sync.
 */
export const HTTP_REQUEST_TIMEOUT_MS = 30_000;

/**
 * Query-param values accepted by `httpGet`. `undefined` and `null` are
 * filtered out (not serialized) so callers can pass an object whose
 * shape mirrors a Zod-derived options type without manually pruning
 * missing fields.
 */
export type HttpGetQuery = Record<string, string | number | boolean | undefined | null>;

/**
 * Issue an authenticated GET against the WHOOP API. The single chokepoint
 * for every WHOOP read in the codebase. Composes (in order): rate-limit
 * semaphore → retry-on-429/5xx → `authedCall` (401 refresh + retry) →
 * `fetch` → status check → JSON parse → Zod validate.
 *
 * Phase 10 ARCH-03: `authedCall` is the injected 4th parameter (replacing
 * the prior module-level `callWithAuth` import from
 * `src/services/refresh-orchestrator`). Bootstrap binds the production
 * orchestrator's `callWithAuth` to this slot; resource modules
 * (cycles/recovery/sleep/workouts/profile/body-measurements) receive a
 * shared `authedCall` via factory closure and pass it through here.
 *
 * Errors are either:
 *   - `AuthError` (from `authedCall` when refresh itself fails) — passed
 *     through so the CLI/MCP layer can surface the standard
 *     re-authorization message.
 *   - `WhoopApiError` — every other non-OK path: status mapped via
 *     `classifyHttpError`; Zod parse failure mapped to `{kind:
 *     'validation'}` carrying the original `ZodError` in `cause`.
 */
export async function httpGet<T>(
  path: string,
  query: HttpGetQuery,
  schema: z.ZodSchema<T>,
  authedCall: AuthedCall,
): Promise<T> {
  const url = buildUrl(path, query);
  // LIFE-04 (#91): construct the AbortController + timeout BEFORE acquire()
  // so the same signal also bounds the wait-for-slot. Pre-LIFE-04 the
  // controller lived inside withRetry, after acquire() already blocked
  // indefinitely. With 4 concurrent requests stuck in a 30s pre-abort
  // fetch and the semaphore full, the 5th caller's acquire() had no
  // deadline. Now both phases share the 30s bound.
  const slotController = new AbortController();
  const slotTimeoutId = setTimeout(() => slotController.abort(), HTTP_REQUEST_TIMEOUT_MS);
  try {
    await acquire(slotController.signal);
  } catch (err) {
    clearTimeout(slotTimeoutId);
    throw err;
  }
  let lastRemainingHeader: string | null = null;
  try {
    const result = await withRetry<Response>(async () => {
      // Fresh AbortController per attempt — a 30s timeout that fires
      // a synthesized AbortError so retry.ts can distinguish timeout from
      // a network error and refuse to retry timeouts.
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), HTTP_REQUEST_TIMEOUT_MS);
      let response: Response;
      try {
        response = await authedCall(async (accessToken) =>
          fetch(url, {
            method: 'GET',
            headers: {
              Authorization: `Bearer ${accessToken}`,
              Accept: 'application/json',
            },
            signal: controller.signal,
          }),
        );
      } finally {
        clearTimeout(timeoutId);
      }
      return {
        status: response.status,
        headers: response.headers,
        body: response,
      };
    });

    lastRemainingHeader = result.headers.get('X-RateLimit-Remaining');

    if (!result.body.ok) {
      logger.warn({ event: 'whoop_http_failure', status: result.status });
      throw classifyHttpError({ status: result.status });
    }

    const json = (await result.body.json()) as unknown;
    try {
      return schema.parse(json);
    } catch (zerr) {
      logger.warn({ event: 'whoop_http_parse_failed', status: result.status });
      throw new WhoopApiError({
        kind: 'validation',
        detail: 'Zod parse failed on WHOOP response',
        cause: zerr,
      });
    }
  } finally {
    // LIFE-04 (#91): clear the slot-wait timeout once the request lifecycle
    // is over — the abort would otherwise fire after release() and merely
    // be a no-op, but clearing keeps the event loop tidy.
    clearTimeout(slotTimeoutId);
    release(lastRemainingHeader);
  }
}

/**
 * Compose `WHOOP_API_BASE + path` and append the truthy entries of
 * `query` as URL-encoded search params. `undefined` and `null` values
 * are filtered out so callers can pass partial option objects without
 * polluting the URL with `=undefined` / `=null` literals. Booleans
 * stringify to `'true'` / `'false'`; numbers via `String(n)`.
 */
function buildUrl(path: string, query: HttpGetQuery): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null) continue;
    params.set(key, typeof value === 'string' ? value : String(value));
  }
  const qs = params.toString();
  return qs.length > 0 ? `${WHOOP_API_BASE}${path}?${qs}` : `${WHOOP_API_BASE}${path}`;
}
