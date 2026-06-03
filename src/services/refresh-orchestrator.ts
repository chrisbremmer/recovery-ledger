// Refresh orchestrator — the SINGLE chokepoint where the 401-reactive retry
// policy lives. token-store.ts owns refresh mechanics (the ADR-0002 three-layer
// gate); this module owns retry policy: attempt 1 → 401? → re-read tokens
// (sibling may have refreshed) → if still stale, force a refresh via
// tokenStore.getValidAccessToken() → retry exactly once → return that result
// regardless of status. Retry budget = 1 (D-15). A failed refresh wraps as
// AuthError({kind: 'auth_expired'}) and does NOT retry the operation
// afterwards (STACK.md §Token refresh point 4).
//
// ADR-0002 §Consequences (single refresh consumer): "The token store is the
// only module that knows about refresh mechanics. Adapters and services
// receive a fresh access token and a cancellation handle; they do not handle
// 401s by refreshing themselves." This module is the ONLY consumer of
// tokenStore.getValidAccessToken() outside of token-store.ts's own internals.
// Plan 02-06's CI Gate E will enforce that contract at grep-time.
//
// Consumer scope:
//   - Phase 3's WHOOP sync service will be the FIRST runtime consumer of
//     `callWithAuth` — it wraps every GET against api.prod.whoop.com.
//   - Plan 02-05's `src/cli/commands/auth.ts` does NOT consume this module.
//     The auth-code grant flow is a one-shot (oauth.ts → exchangeCode →
//     tokenStore.write); there is no 401-reactive boundary at auth-time.
//   - Plan 02-06's doctor checks (auth backend, token freshness) are
//     offline-safe and do not consume this module.
//
// ADR-0001 §Decision: no console calls, no direct stdout writes from this
// module — structured logger.warn only, never the response body or tokens.

// ARCH-04 (#92): single canonical import path for AuthError.
import { AuthError } from '../domain/errors/auth.js';
import { logger } from '../infrastructure/config/logger.js';
import { REFRESH_BUFFER_MS, type TokenStore } from '../infrastructure/whoop/token-store.js';

// -----------------------------------------------------------------------------
// Public types — the surface Phase 3 (and future WHOOP-call sites) consume.
// `FetchLikeResponse` is intentionally the minimum surface — the orchestrator
// only inspects `.status`. The rest of the Response shape is the caller's
// concern. This keeps the orchestrator decoupled from the global Fetch API
// (the test suite passes plain `{status: number}` objects) and gives Phase 3
// the freedom to use whatever Response wrapper the WHOOP HTTP client returns.
// -----------------------------------------------------------------------------

export interface FetchLikeResponse {
  status: number;
}

export type AuthedOperation<T extends FetchLikeResponse> = (accessToken: string) => Promise<T>;

export interface CallWithAuthOptions {
  /** Test seam — overrides the orchestrator's bound `TokenStore` for a
   *  single call. Production call sites should never pass this; the
   *  bootstrap-constructed orchestrator binds the canonical store
   *  (ADR-0002 §Enforcement). */
  tokenStore?: TokenStore;
}

export interface RefreshOrchestrator {
  callWithAuth<T extends FetchLikeResponse>(
    operation: AuthedOperation<T>,
    options?: CallWithAuthOptions,
  ): Promise<T>;
}

// -----------------------------------------------------------------------------
// Factory — the sole construction surface. Phase 10 ARCH-02 (#85) removed
// the module-load singleton; `src/services/bootstrap.ts` constructs the
// orchestrator exactly once per process and threads it through
// `Bootstrapped.services`. Tests construct fresh orchestrators via
// `createRefreshOrchestrator(mockStore)`.
// -----------------------------------------------------------------------------

export function createRefreshOrchestrator(store: TokenStore): RefreshOrchestrator {
  return {
    callWithAuth: (operation, options) => callWithAuthImpl(operation, options?.tokenStore ?? store),
  };
}

async function callWithAuthImpl<T extends FetchLikeResponse>(
  operation: AuthedOperation<T>,
  store: TokenStore,
): Promise<T> {
  // Attempt 1 — preemptive refresh (≤5min to expiry) already happens inside
  // tokenStore.getValidAccessToken(); we get a fresh-by-our-clock access token.
  const accessToken = await store.getValidAccessToken();
  const res = await operation(accessToken);
  if (res.status !== 401) {
    return res;
  }

  // 401 → re-read tokens. A sibling process may have refreshed between
  // attempt 1 and now (RESEARCH Pattern 1 + D-15). If the on-disk token is
  // fresh, use it without burning another refresh.
  logger.warn({ event: '401_received', retry: true });

  // Apply the same REFRESH_BUFFER_MS that token-store.getValidAccessToken uses
  // (5 minutes). Without the buffer, a sibling's "fresh"-but-near-expiry token
  // (delta < 5min) is handed back here; the operation takes longer than the
  // remaining lifetime; a second 401 fires; per D-15 the retry budget is
  // already burned. The buffer keeps the orchestrator's 401-recovery path
  // symmetric with the preemptive-refresh path.
  const current = await store.read();
  if (current !== null && current.expiresAt > Date.now() + REFRESH_BUFFER_MS) {
    // Sibling refreshed our way out — retry with current.accessToken.
    return operation(current.accessToken);
  }

  // Re-read still stale. Force a refresh through the three-layer gate.
  // If the refresh itself throws (refresh_failed from token-store.ts), wrap
  // as auth_expired per D-15. Do NOT retry the operation after a refresh
  // failure (STACK.md §Token refresh point 4 — retry budget 0 on refresh).
  let freshAccessToken: string;
  try {
    freshAccessToken = await store.getValidAccessToken();
  } catch (refreshErr) {
    throw new AuthError({
      kind: 'auth_expired',
      detail: 'refresh failed; run `recovery-ledger auth` to re-authorize',
      cause: refreshErr,
    });
  }

  // Retry exactly once with the post-refresh access token. Return the result
  // regardless of status — retry budget is 1; a second 401 is the caller's
  // responsibility to surface.
  return operation(freshAccessToken);
}

// Phase 10 ARCH-02 (#85) + ARCH-03: the module-load singletons
// `export const refreshOrchestrator` and `export const callWithAuth` are
// GONE. The composition root in `src/services/bootstrap.ts` constructs the
// orchestrator exactly once and binds `authedCall` (the call-with-auth
// closure) for the WHOOP client. Consumers receive both through the
// `Bootstrapped.services` surface. `src/cli/commands/auth.ts` does NOT
// consume this module — the OAuth login flow has no 401-reactive boundary.
// Enforced by Gates L (no singleton exports) and M (no services/ imports
// from infrastructure) in `scripts/ci-grep-gates.sh`.
