// `token_freshness` doctor probe — AUTH-03 surface (Plan 02-06).
//
// Reports how close tokens are to expiry, mapped through the D-14 buffer
// policy: `pass` when delta > 5min, `warn` when 0 < delta <= 5min,
// `fail` when expired or no tokens on disk. Per D-22 the probe is
// OFFLINE-SAFE — it reads via `tokenStore.read()` (which does NOT trigger
// a refresh) and never invokes the refresh-aware accessor. The injected
// `TokenFreshnessProbeDeps` deliberately exposes only `read` + `now` —
// there is no refresh seam on the type.
//
// ADR-0001 (CLAUDE.md §Critical Rules): no console calls, no direct
// stdout writes from this module.
//
// `formatDuration` is exported as a named function so the unit suite can
// pin its contract directly without going through the probe.

import {
  REFRESH_BUFFER_MS,
  type Tokens,
  tokenStore,
} from '../../../infrastructure/whoop/token-store.js';
import type { DoctorCheck } from '../index.js';
import { CHECK_NAMES } from './check-names.js';

/**
 * Render a positive duration in milliseconds as a compact human-readable
 * string. `< 1 hour` uses `${minutes}m` (e.g., `45m`); `>= 1 hour` uses
 * `${hours}h ${minutes}m` (e.g., `2h 5m`). Negative inputs are not exercised
 * by the probe (which always passes positive `ms`); callers that need to
 * format an elapsed expiry duration must pass `Math.abs(delta)` themselves.
 */
export function formatDuration(ms: number): string {
  const totalMinutes = Math.floor(ms / 60_000);
  if (totalMinutes < 60) {
    return `${totalMinutes}m`;
  }
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${hours}h ${minutes}m`;
}

export interface TokenFreshnessProbeDeps {
  /** Override for `tokenStore.read`. Test-only seam — production callers
   *  leave this undefined. NEVER the refresh-aware accessor: that would
   *  trigger a refresh and break the D-22 offline-safe contract. */
  read?: () => Promise<Tokens | null>;
  /** Override for `Date.now`. Test-only seam — production callers leave
   *  this undefined and `Date.now` is used. */
  now?: () => number;
}

export async function probeTokenFreshness(deps?: TokenFreshnessProbeDeps): Promise<DoctorCheck> {
  const read = deps?.read ?? (() => tokenStore.read());
  const now = deps?.now ?? Date.now;

  try {
    const tokens = await read();
    if (tokens === null) {
      return {
        name: CHECK_NAMES.TOKEN_FRESHNESS,
        status: 'fail',
        detail: 'no tokens',
      };
    }

    const delta = tokens.expiresAt - now();

    if (delta <= 0) {
      return {
        name: CHECK_NAMES.TOKEN_FRESHNESS,
        status: 'fail',
        detail: `expired ${formatDuration(-delta)} ago — run \`recovery-ledger auth\``,
      };
    }

    // D-14 boundary: at exactly `delta === REFRESH_BUFFER_MS` the token is
    // within the warn window (mirrors token-store.ts's strict-greater-than
    // comparison `> now() + REFRESH_BUFFER_MS` for the pass arm).
    if (delta <= REFRESH_BUFFER_MS) {
      return {
        name: CHECK_NAMES.TOKEN_FRESHNESS,
        status: 'warn',
        detail: `expires in ${formatDuration(delta)}`,
      };
    }

    return {
      name: CHECK_NAMES.TOKEN_FRESHNESS,
      status: 'pass',
      detail: `expires in ${formatDuration(delta)}`,
    };
  } catch (err) {
    return {
      name: CHECK_NAMES.TOKEN_FRESHNESS,
      status: 'fail',
      detail: `probe threw: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}
