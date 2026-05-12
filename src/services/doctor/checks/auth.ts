// `auth` doctor probe — AUTH-03 surface (Plan 02-06).
//
// Reports which backend stores tokens (keychain / file / missing) WITHOUT
// triggering a refresh. Per D-22 the probe is OFFLINE-SAFE: it must never
// invoke the token-store's valid-access-token accessor. The injected
// `AuthProbeDeps` deliberately exposes only `readStorageMode` +
// `readTokens` — there is no refresh seam on the type, which is the
// load-bearing forcing function.
//
// ADR-0001 (CLAUDE.md §Critical Rules): no console calls, no direct stdout
// writes from this module. The probe surfaces structured DoctorCheck
// results through the runDoctor pipeline and nothing else.
//
// Remediation phrasing matches the native-modules.ts MR-22 convention:
// every fail detail ends with a "`run \`recovery-ledger ...\`" remediation.

import { type Tokens, tokenStore } from '../../../infrastructure/whoop/token-store.js';
import type { DoctorCheck } from '../index.js';
import { CHECK_NAMES } from './check-names.js';

export interface AuthProbeDeps {
  /** Override for `tokenStore.readStorageMode`. Test-only seam — production
   *  callers leave this undefined and the singleton's binding is used. */
  readStorageMode?: () => Promise<'keychain' | 'file' | null>;
  /** Override for `tokenStore.read`. Test-only seam — production callers
   *  leave this undefined. NEVER the refresh-aware accessor: that would
   *  trigger a refresh and break the D-22 offline-safe contract. */
  readTokens?: () => Promise<Tokens | null>;
}

export async function probeAuth(deps?: AuthProbeDeps): Promise<DoctorCheck> {
  const readStorageMode = deps?.readStorageMode ?? (() => tokenStore.readStorageMode());
  const readTokens = deps?.readTokens ?? (() => tokenStore.read());

  try {
    const mode = await readStorageMode();
    if (mode === null) {
      return {
        name: CHECK_NAMES.AUTH,
        status: 'fail',
        detail: 'no tokens — run `recovery-ledger auth`',
      };
    }
    const tokens = await readTokens();
    if (tokens === null) {
      return {
        name: CHECK_NAMES.AUTH,
        status: 'fail',
        detail: `mode=${mode} but tokens missing — run \`recovery-ledger auth\``,
      };
    }
    return {
      name: CHECK_NAMES.AUTH,
      status: 'pass',
      detail: mode === 'keychain' ? 'auth: keychain' : 'auth: file (mode 0600)',
    };
  } catch (err) {
    return {
      name: CHECK_NAMES.AUTH,
      status: 'fail',
      detail: `probe threw: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}
