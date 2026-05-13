// AuthError discriminated union for Phase 2 auth/OAuth/token-store paths
// (per ADR-0002 single-flight refresh, 02-PATTERNS.md lines 471-486).
//
// `AuthErrorKind` is INTENTIONALLY CLOSED (MR-21 voice — see
// src/services/doctor/index.ts for the analog): adding a seventh kind
// requires updating BOTH `AUTH_EXIT_CODES` in src/cli/commands/auth.ts
// (Plan 02-05) AND the exhaustive switch in `formatAuthError` below. The
// `formatAuthError` switch will fail to compile if a new variant is added
// without an arm — that compile error is the forcing function. The CLI
// exit-code map and the MR-22 --help block on `recovery-ledger auth`
// both rely on this six-kind contract.
//
// `auth_port_in_use` was moved into Wave 0 (revision iteration 1) per
// checker BLOCKER 1: Plan 02-02 (token-store) and Plan 02-03 (oauth) are
// both Wave-2 plans that import `AuthError` from this file. Same-wave
// file overlap on errors.ts would have been a load-bearing safety
// violation, so the auth_port_in_use kind lives here from Wave 0 onward
// and the union is FROZEN at six kinds. No Wave 2 plan mutates this
// file.

// AUTH_ERROR_KINDS is the single source of truth for the AuthErrorKind
// union. The union is derived from the tuple via `typeof
// AUTH_ERROR_KINDS[number]`, and `isAuthError` (below) uses the same
// tuple as its duck-type set. Adding a seventh kind requires only one
// edit here -- the type, the duck-type set, AND (via the formatAuthError
// exhaustive switch) the compile error all grow together. This restores
// the MR-21 forcing function that the earlier WR-C duplicate-list in
// auth.ts had degraded.
export const AUTH_ERROR_KINDS = [
  'auth_missing',
  'auth_expired',
  'auth_state_mismatch',
  'auth_timeout',
  'auth_port_in_use',
  'refresh_failed',
] as const;

export type AuthErrorKind = (typeof AUTH_ERROR_KINDS)[number];

const AUTH_ERROR_KINDS_SET: ReadonlySet<string> = new Set(AUTH_ERROR_KINDS);

export interface AuthErrorInit {
  kind: AuthErrorKind;
  /** Short human-readable detail; surfaces into the Error message. */
  detail?: string;
  /** Original cause; preserved through the ES2022 Error `cause` option so
   *  the Phase 1 sanitize.ts walker can traverse it. The test in
   *  errors.test.ts pins that JSON.stringify of the carrier does NOT
   *  emit cause.message (Error toJSON returns `{}` by default) — the
   *  sanitizer is the single point of truth for serialization. */
  cause?: unknown;
}

export class AuthError extends Error {
  readonly kind: AuthErrorKind;
  readonly detail?: string;

  constructor(init: AuthErrorInit) {
    // ES2022 Error cause option: only pass the second arg when cause is
    // defined so we do not synthesize a `{ cause: undefined }` literal
    // that some serializers might inspect differently from "no cause."
    super(init.detail ?? init.kind, init.cause === undefined ? undefined : { cause: init.cause });
    this.kind = init.kind;
    // Store `detail` on the instance so `formatAuthError` (and other
    // consumers — Plan 02-05's auth.ts uses this to surface the colliding
    // port number on `auth_port_in_use`) can read it back. Without this,
    // `err.detail` was always `undefined` and the formatter fell back to
    // 'unknown port' — Plan 02-01 latent bug, fixed in Plan 02-05 under
    // deviation Rule 1.
    if (init.detail !== undefined) {
      this.detail = init.detail;
    }
    this.name = 'AuthError';
  }
}

/**
 * Type guard for AuthError. Duck-types on `name === 'AuthError'` and
 * `kind` membership in the AUTH_ERROR_KINDS tuple. Required because
 * `instanceof AuthError` is unreliable under Vitest's `vi.resetModules()`:
 * two module-graph instances of errors.ts produce different class
 * identities for the same logical type. The CLI catch arm in
 * `src/cli/commands/auth.ts` uses this so test ergonomics match
 * production behavior.
 *
 * The duck-type set is derived from AUTH_ERROR_KINDS (the same tuple the
 * AuthErrorKind union is derived from). Adding a kind to the tuple
 * automatically extends both the union AND this guard -- the MR-21
 * forcing function (a new kind breaks a switch somewhere) is preserved.
 */
export function isAuthError(err: unknown): err is AuthError {
  if (typeof err !== 'object' || err === null) return false;
  const e = err as { name?: unknown; kind?: unknown };
  return e.name === 'AuthError' && typeof e.kind === 'string' && AUTH_ERROR_KINDS_SET.has(e.kind);
}

/**
 * Map an AuthError to a short remediation phrase suitable for the CLI
 * --help block and the `recovery-ledger auth` non-zero exit body. MR-22
 * voice: each arm uses `try ...` / `run ...` — actionable, no jargon.
 *
 * The defense-in-depth `default` arm is unreachable under the static
 * type union; it exists so a runtime AuthError synthesized from a
 * JSON.parse cast (e.g., a future deserialization path that does not
 * re-check the kind) still surfaces as a non-empty string rather than
 * silently green-checking the user (ADR-0001 voice).
 */
export function formatAuthError(err: AuthError): string {
  switch (err.kind) {
    case 'auth_missing':
      return 'No WHOOP tokens on disk — run `recovery-ledger auth` to authorize.';
    case 'auth_expired':
      return 'WHOOP tokens have expired — run `recovery-ledger auth` to re-authorize.';
    case 'auth_state_mismatch':
      return 'OAuth state mismatch (possible CSRF) — try running `recovery-ledger auth` again from a fresh shell.';
    case 'auth_timeout':
      return 'OAuth callback did not arrive in time — try running `recovery-ledger auth` again and complete the browser flow promptly.';
    case 'auth_port_in_use':
      return `Loopback port already in use (${err.detail ?? 'unknown port'}) — re-run \`recovery-ledger init\` to choose a different port, then update your WHOOP developer app's redirect URI.`;
    case 'refresh_failed':
      return 'Token refresh failed — run `recovery-ledger auth` to re-authorize.';
    default:
      return 'unknown auth error';
  }
}
