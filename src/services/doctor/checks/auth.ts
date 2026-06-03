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

// Cross-layer import (WR-06): the MCP register wrapper sanitizes results before
// they leave the JSON-RPC boundary, but `runDoctorCommand` on the CLI path
// emits probe `detail` strings verbatim through `process.stdout.write`. A
// ZodError or AuthError whose cause-chain carries token material (the
// StoredTokensSchema parse error includes the parsed blob's `received` field)
// would land on the user's terminal unredacted. Routing `err.message` through
// the shared sanitizer is defense-in-depth — the primary contract still
// requires that errors NOT carry token bytes, but this is the second net.
// Phase 10 ARCH-01: sanitize now lives at `src/domain/observability/`
// — the cross-layer concern noted in PLAN-03-CROSS-LAYER / CR-04 was
// closed by relocating the pure-string-transform module out of
// infrastructure into the domain layer.
import { sanitize } from '../../../domain/observability/sanitize.js';
import type { Tokens } from '../../../infrastructure/whoop/token-store.js';
import type { DoctorCheck } from '../index.js';
import { CHECK_NAMES } from './check-names.js';

// Phase 10 ARCH-07: deps are REQUIRED, not optional. The historical
// `deps?.readStorageMode ?? (() => tokenStore.readStorageMode())` fallback
// is gone; callers MUST supply both `readStorageMode` and `readTokens`. The
// production composition root (`src/services/bootstrap.ts` → runDoctor)
// constructs these from the bootstrap-bound `tokenStore`. The lightweight
// `createServices()` path does not call this probe (it lives behind the
// runDoctor surface which only bootstrap supplies with deps).
export interface AuthProbeDeps {
  /** Reader for `tokenStore.readStorageMode`. Bootstrap binds the
   *  production tokenStore; tests inject stubs. */
  readStorageMode: () => Promise<'keychain' | 'file' | null>;
  /** Reader for `tokenStore.read`. NEVER the refresh-aware accessor:
   *  that would trigger a refresh and break the D-22 offline-safe
   *  contract. */
  readTokens: () => Promise<Tokens | null>;
}

export async function probeAuth(deps: AuthProbeDeps): Promise<DoctorCheck> {
  const { readStorageMode, readTokens } = deps;

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
      detail: `probe threw: ${sanitize(err instanceof Error ? err.message : String(err))}`,
    };
  }
}
