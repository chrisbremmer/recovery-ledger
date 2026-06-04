// Doctor production-wiring factory — Phase 10 ARCH-06 (#86).
//
// Owns the production composition of `runDoctor` that bootstrap previously
// inlined: the `productionWhoopFetcher`, the kind-to-HTTP-status mapper, and
// the pre-binding of every injected dep into `runDoctorImpl`.
//
// ADR-0001 (MCP stdout purity): no console calls, no direct stdout writes
// from this module. The fetcher only returns `{status, durationMs}` and
// throws to the caller; the doctor probe routes the result through its
// structured `DoctorCheck` shape.

import { performance } from 'node:perf_hooks';
import type Database from 'better-sqlite3';
import { isAuthError } from '../../domain/errors/auth.js';
import { WhoopRawProfile } from '../../domain/schemas/whoop-api.js';
import type { CyclesRepo } from '../../infrastructure/db/repositories/cycles.repo.js';
import type { RecoveryRepo } from '../../infrastructure/db/repositories/recovery.repo.js';
import type { SleepsRepo } from '../../infrastructure/db/repositories/sleep.repo.js';
import type { SyncRunsRepo } from '../../infrastructure/db/repositories/sync-runs.repo.js';
import { type AuthedCall, httpGet } from '../../infrastructure/whoop/client.js';
import { WhoopApiError } from '../../infrastructure/whoop/errors.js';
import type { TokenStore } from '../../infrastructure/whoop/token-store.js';
import type { RefreshOrchestrator } from '../refresh-orchestrator.js';
import { type DoctorResult, type RunDoctorOptions, runDoctor as runDoctorImpl } from './index.js';

// Production composition input — kept module-private; bootstrap passes an
// inline object literal so a public surface is unnecessary. `authedCall`
// is the bootstrap-side closure that wraps `refreshOrchestrator.callWithAuth`
// (ADR-0002 single-flight); the factory uses it to drive the
// productionWhoopFetcher's single GET through the three-layer gate.
interface ProductionDoctorDepsInput {
  sqlite: Database.Database;
  repos: {
    syncRuns: SyncRunsRepo;
    cycles: CyclesRepo;
    recoveries: RecoveryRepo;
    sleeps: SleepsRepo;
  };
  refreshOrchestrator: RefreshOrchestrator;
  authedCall: AuthedCall;
  tokenStore: TokenStore;
  migrationsDir: string;
}

/**
 * Construct the production `runDoctor` closure. The returned function has
 * the same consumer shape as the previous inline `services_runDoctor` in
 * bootstrap.ts: `(opts?: RunDoctorOptions) => Promise<DoctorResult>`.
 * `opts.X ?? input.X` keeps the test-seam contract — a caller passing a
 * concrete value for a slot overrides the production default; passing
 * `undefined` falls back to the bootstrap-bound default.
 */
export function createProductionDoctorDeps(
  input: ProductionDoctorDepsInput,
): (opts?: RunDoctorOptions) => Promise<DoctorResult> {
  // Plan 05-06 deviation (Rule 3): WhoopApiError carries a discriminated
  // `kind` (not a numeric status). Map `kind` back to a representative
  // status so the probe's 401 / 200 / other branch logic still
  // distinguishes the auth-revoked case. A refresh that fails entirely
  // surfaces as an AuthError (handled separately below).
  const whoopErrorKindToStatus = (kind: WhoopApiError['kind']): number => {
    switch (kind) {
      case 'unauthorized':
        return 401;
      case 'rate_limited':
        return 429;
      case 'server':
        return 500;
      default:
        // network / validation / unknown — no meaningful HTTP status; 0
        // routes the probe to its generic 'roundtrip failed' warn arm.
        return 0;
    }
  };

  // Plan 05-06: the production whoop_roundtrip fetcher. Routes a single
  // GET /v2/user/profile/basic through `httpGet` (ADR-0007 read-only,
  // Gate-F-allowlisted chokepoint — NO bare fetch here). `httpGet` itself
  // wraps the call in `callWithAuth` (ADR-0002 single-flight refresh) via
  // the injected `authedCall`. T-05-I6: only `{status, durationMs}` flows
  // back — no Bearer/JWT material. The `accessToken` parameter is present
  // to satisfy the probe's fetcher contract; the actual token is supplied
  // internally by `callWithAuth` inside `httpGet`.
  const productionWhoopFetcher = async (
    _accessToken: string,
  ): Promise<{ status: number; durationMs: number }> => {
    const start = performance.now();
    try {
      await httpGet('/v2/user/profile/basic', {}, WhoopRawProfile, input.authedCall);
      return { status: 200, durationMs: performance.now() - start };
    } catch (err) {
      // ERRC-01 (#89): a refresh-side AuthError ('auth_expired',
      // 'refresh_failed', 'auth_missing') is the same condition the user
      // experiences as "your token is dead — re-auth". Map all of them to
      // status 401 so the doctor's whoop_roundtrip probe emits the SAME
      // "run `recovery-ledger auth`" remediation as the
      // WhoopApiError({kind:'unauthorized'}) path.
      if (isAuthError(err)) {
        return { status: 401, durationMs: performance.now() - start };
      }
      const status = err instanceof WhoopApiError ? whoopErrorKindToStatus(err.kind) : 0;
      return { status, durationMs: performance.now() - start };
    }
  };

  // Spread-then-override: opts.X ?? input.X means caller values win, production
  // deps fill blanks. Do NOT collapse into `{ ...opts }` alone — the production
  // defaults would be dropped on every call. The `repos` shape maps the
  // bootstrap plurals (`recoveries`/`sleeps`) to the singular keys the doctor
  // probes consume (`recovery`/`sleep`).
  return (opts: RunDoctorOptions = {}): Promise<DoctorResult> =>
    runDoctorImpl({
      ...opts,
      sqlite: opts.sqlite ?? input.sqlite,
      repos: opts.repos ?? {
        syncRuns: input.repos.syncRuns,
        cycles: input.repos.cycles,
        recovery: input.repos.recoveries,
        sleep: input.repos.sleeps,
      },
      refreshOrchestrator: opts.refreshOrchestrator ?? input.refreshOrchestrator,
      whoopFetcher: opts.whoopFetcher ?? productionWhoopFetcher,
      tokenStore: opts.tokenStore ?? input.tokenStore,
      // Reuse the path bootstrap already resolved for the migrator so the
      // db_schema_version probe reads the same dir from the bundled dist
      // tree (the probe's own import.meta.url math is wrong once flattened).
      migrationsDir: opts.migrationsDir ?? input.migrationsDir,
    });
}
