// ARCH-04 (#92): AuthError + helpers used to re-export from here for
// historical-import compatibility; ARCH-04 codemodded every consumer to
// `from '.../domain/errors/auth.js'` directly. The re-exports are deleted
// so future contributors cannot accidentally reintroduce the dual-import
// drift hazard. This file now owns only WhoopApiError.

// ---------------------------------------------------------------------------
// WhoopApiError — discriminated union for the Phase 3 WHOOP HTTP client
// (D-22, 03-PATTERNS.md §B6 + §S1). Stays in infrastructure: the kinds
// are HTTP-status-driven and the classifyHttpError mapper directly
// consumes Response shapes, both of which are infrastructure concerns.
//
// AuthError stays FROZEN at 6 kinds. WhoopApiError joins it side-by-side so
// the HTTP client can distinguish six failure classes the per-resource
// modules and the sync orchestrator route differently:
//   - unauthorized  → 401 from WHOOP; orchestrator translates to AuthError
//                     (refresh failed) at the boundary; never user-visible
//                     as WhoopApiError under normal flow
//   - rate_limited  → 429; sync will retry after X-RateLimit-Reset (D-20)
//   - network       → fetch threw before a response (DNS / connection /
//                     abort); retry budget governed by retry.ts
//   - validation    → Zod parse failed against the WHOOP response shape;
//                     loud failure (do not silently coerce)
//   - server        → 5xx from WHOOP; sync retries with jittered backoff
//                     before surfacing
//   - unknown       → defense-in-depth arm for anything that does not
//                     pattern-match the five above (kept so the formatter
//                     never returns an empty string)
//
// MR-21 forcing function (mirrors AuthError): the formatWhoopApiError
// exhaustive switch trips at compile time if a seventh kind lands in the
// tuple without an arm. The duck-type SET is derived from the same tuple,
// so any kind that fails the guard also fails the formatter — drift in
// either direction surfaces.
//
// Phase 3 D-34 attestation: instances of this class flow through the
// existing src/domain/observability/sanitize.ts pipeline UNMODIFIED. The Phase 1 D-07
// patterns + Phase 2 D-19 patterns (code= / client_secret / Bearer / JWT /
// Authorization) cover every WHOOP-derived error shape Phase 3 produces.
// The shape mirrors AuthError (named field + cause chain), which has
// been sanitizer-covered since Phase 2.
// ---------------------------------------------------------------------------

export const WHOOP_API_ERROR_KINDS = [
  'unauthorized',
  'rate_limited',
  'network',
  'validation',
  'server',
  'unknown',
] as const;

export type WhoopApiErrorKind = (typeof WHOOP_API_ERROR_KINDS)[number];

const WHOOP_API_ERROR_KINDS_SET: ReadonlySet<string> = new Set(WHOOP_API_ERROR_KINDS);

export interface WhoopApiErrorInit {
  kind: WhoopApiErrorKind;
  /** Short human-readable detail; surfaces into the Error message. */
  detail?: string;
  /** Original cause; preserved through the ES2022 Error `cause` option so
   *  the sanitize.ts walker can traverse it. Mirrors AuthError. */
  cause?: unknown;
}

export class WhoopApiError extends Error {
  readonly kind: WhoopApiErrorKind;
  readonly detail?: string;

  constructor(init: WhoopApiErrorInit) {
    // Same conditional-spread shape as AuthError: only pass the second
    // arg when cause is defined so we do not synthesize a `{ cause:
    // undefined }` literal that diverges from the AuthError carrier shape
    // (errors.test.ts Test 12 / WR-11).
    super(init.detail ?? init.kind, init.cause === undefined ? undefined : { cause: init.cause });
    this.kind = init.kind;
    if (init.detail !== undefined) {
      this.detail = init.detail;
    }
    this.name = 'WhoopApiError';
  }
}

/**
 * Type guard for WhoopApiError. Duck-types on `name === 'WhoopApiError'`
 * and `kind` membership in the WHOOP_API_ERROR_KINDS tuple. Same rationale
 * as isAuthError: `instanceof` is unreliable under vi.resetModules(); two
 * module-graph instances of errors.ts produce different class identities
 * for the same logical type.
 *
 * AuthError instances are intentionally rejected — the `name` mismatch
 * (`'AuthError'` vs `'WhoopApiError'`) disambiguates the two unions even
 * though they share the same field shape.
 */
export function isWhoopApiError(err: unknown): err is WhoopApiError {
  if (typeof err !== 'object' || err === null) return false;
  const e = err as { name?: unknown; kind?: unknown };
  return (
    e.name === 'WhoopApiError' &&
    typeof e.kind === 'string' &&
    WHOOP_API_ERROR_KINDS_SET.has(e.kind)
  );
}

/**
 * Map a WhoopApiError to a short remediation phrase. MR-21 forcing
 * function: a seventh kind in the tuple breaks the exhaustive switch
 * here at compile time. The default arm is defense-in-depth for a
 * runtime-synthesized instance whose kind escapes the type union.
 */
export function formatWhoopApiError(err: WhoopApiError): string {
  switch (err.kind) {
    case 'unauthorized':
      return 'WHOOP returned 401 unauthorized — run `recovery-ledger auth` to re-authorize.';
    case 'rate_limited':
      return 'WHOOP rate-limited (429) — sync will retry after X-RateLimit-Reset.';
    case 'network':
      return 'Network error reaching WHOOP — check your connection and try `recovery-ledger sync` again.';
    case 'validation':
      return 'WHOOP returned an unexpected response shape — see logs for details.';
    case 'server':
      return 'WHOOP server error (5xx) — sync will retry with backoff.';
    case 'unknown':
      return 'WHOOP request failed for an unknown reason — see logs for details.';
    default:
      return 'unknown WHOOP API error';
  }
}

/**
 * Map an HTTP response status to a `WhoopApiError` kind. This is the SOLE
 * place response-status → WhoopApiError mapping happens — `httpGet` in
 * `client.ts` calls it on every non-OK response after the `retry.ts`
 * wrapper has exhausted its budget. Keeping the mapping in one switch
 * preserves the MR-21 forcing function: a new status arm requires
 * adding an explicit case here AND the corresponding `WhoopApiError`
 * kind already exists in the (frozen at six) union.
 *
 * 401 normally never reaches here: `callWithAuth` (Plan 02-04) refreshes
 * + retries on 401, and a 401 that escapes its budget surfaces as an
 * `AuthError({kind: 'auth_expired'})`. The defense-in-depth arm exists
 * so a 401 that somehow escapes still maps to a non-empty kind.
 */
export function classifyHttpError(res: { status: number; statusText?: string }): WhoopApiError {
  if (res.status === 401) {
    return new WhoopApiError({
      kind: 'unauthorized',
      detail: 'WHOOP returned 401 — token may have been revoked',
    });
  }
  if (res.status === 429) {
    return new WhoopApiError({
      kind: 'rate_limited',
      detail: 'WHOOP rate-limited (429); sync retried once',
    });
  }
  if (res.status >= 500 && res.status < 600) {
    return new WhoopApiError({
      kind: 'server',
      detail: `WHOOP returned ${res.status}`,
    });
  }
  // 400, 403, 404, 422, and anything else — surface as unknown so the
  // CLI/MCP layer prints the status without claiming a specific cause.
  return new WhoopApiError({
    kind: 'unknown',
    detail: `WHOOP returned ${res.status}`,
  });
}
