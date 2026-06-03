// Doctor production-wiring factory — Phase 10 ARCH-06 (#86).
//
// Owns the production composition of `runDoctor` that bootstrap previously
// inlined: the `productionWhoopFetcher` (a single GET routed through
// `httpGet` + `callWithAuth`), the `whoopErrorKindToStatus` mapper, and the
// pre-binding of every injected dep (sqlite + repos + refreshOrchestrator
// + tokenStore + migrationsDir) into `runDoctorImpl`. Moving this block out
// of bootstrap.ts shrinks the composition root and gives doctor its own
// composition seam that future per-service wiring extracts (Phase 12) will
// mirror.
//
// The exported surface is intentionally one function:
// `createProductionDoctorDeps(input)`. Bootstrap calls it once during
// composition and stores the returned closure on `services.runDoctor`. The
// consumer shape — `(opts?: RunDoctorOptions) => Promise<DoctorResult>` —
// is byte-identical to the previous inline closure so CLI + MCP callers
// observe no change. The four ARCH-06 unit tests in `wiring.test.ts`
// exercise the opts-win-over-defaults contract + the error-mapping branches
// for `WhoopApiError` and `AuthError` paths.
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

/**
 * Production composition input for `createProductionDoctorDeps`.
 *
 * Bootstrap captures the per-process collaborators it constructs once
 * (sqlite + repos + refreshOrchestrator + authedCall + tokenStore +
 * migrationsDir) and passes them here. The factory wraps them into a
 * pre-bound `runDoctor` closure that callers consume via
 * `services.runDoctor(opts?)`.
 *
 * `authedCall` is the bootstrap-side closure that wraps
 * `refreshOrchestrator.callWithAuth` (Phase 10 ARCH-03). The factory uses
 * it to drive the production `productionWhoopFetcher`'s single GET through
 * the ADR-0002 three-layer single-flight gate.
 */
export interface ProductionDoctorDepsInput {
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
 * the SAME shape as the previous inline `services_runDoctor` in
 * bootstrap.ts: `(opts?: RunDoctorOptions) => Promise<DoctorResult>`. Each
 * `opts.X ?? input.X` keeps the test-seam contract — a caller passing a
 * concrete value for a slot overrides the production default; passing
 * `undefined` falls back to the bootstrap-bound default.
 *
 * Internals (verbatim from the previous bootstrap.ts inline block):
 *   - `whoopErrorKindToStatus` maps the discriminated `WhoopApiError.kind`
 *     to a representative HTTP status for the probe's branch logic.
 *   - `productionWhoopFetcher` issues the single GET against
 *     `/v2/user/profile/basic` through `httpGet` (Gate F allowlisted) +
 *     `authedCall` (ADR-0002 single-flight). The `accessToken` parameter
 *     is unused — `callWithAuth` supplies the token internally — but kept
 *     to satisfy the doctor probe's fetcher contract.
 */
export function createProductionDoctorDeps(
  input: ProductionDoctorDepsInput,
): (opts?: RunDoctorOptions) => Promise<DoctorResult> {
  // Plan 05-06 deviation (Rule 3) carried forward verbatim from
  // bootstrap.ts: the WhoopApiError class carries a discriminated `kind`
  // (not a numeric status). Map `kind` back to a representative status
  // so the probe's 401 / 200 / other branch logic still distinguishes the
  // auth-revoked case. A refresh that fails entirely surfaces as an
  // AuthError (not a WhoopApiError); that falls through to status 0,
  // which the probe renders as a generic roundtrip-failed warn — the
  // documented acceptable degraded surface.
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
  // the injected `authedCall`, so a stale token triggers exactly one
  // refresh through the three-layer gate. T-05-I6: only `{status,
  // durationMs}` flows back — no Bearer/JWT material. The `accessToken`
  // parameter is present to satisfy the probe's fetcher contract; the
  // actual token is supplied internally by `callWithAuth` inside `httpGet`.
  const productionWhoopFetcher = async (
    _accessToken: string,
  ): Promise<{ status: number; durationMs: number }> => {
    const start = performance.now();
    try {
      await httpGet('/v2/user/profile/basic', {}, WhoopRawProfile, input.authedCall);
      return { status: 200, durationMs: performance.now() - start };
    } catch (err) {
      // ERRC-01 (#89): a refresh-side AuthError ('auth_expired',
      // 'refresh_failed', 'auth_missing') is the same condition the
      // user experiences as "your token is dead — re-auth". Map all of
      // them to status 401 so the doctor's whoop_roundtrip probe emits
      // the SAME "run `recovery-ledger auth`" remediation as the
      // WhoopApiError({kind:'unauthorized'}) path.
      if (isAuthError(err)) {
        return { status: 401, durationMs: performance.now() - start };
      }
      const status = err instanceof WhoopApiError ? whoopErrorKindToStatus(err.kind) : 0;
      return { status, durationMs: performance.now() - start };
    }
  };

  // Pre-bind production deps into runDoctorImpl. User-supplied opts win
  // over the defaults (test seam). The `repos` shape maps the bootstrap
  // plurals (`recoveries`/`sleeps`) to the singular keys the recency /
  // scored-day / data-quality probes consume (`recovery`/`sleep`) — the
  // narrow union structurally matches `RunDoctorOptions.repos`.
  //
  // Spread-then-override semantics: each individual `opts.X ?? default`
  // gives the caller's CONCRETE value priority and falls back to the
  // bootstrap-bound default when the caller's value is null/undefined.
  // A caller passing `{ sqlite: undefined }` explicitly will land on the
  // bootstrap default (not stay undefined) — this is the test-seam
  // contract the surrounding tests rely on. Do NOT collapse this into a
  // single `{ ...opts }` without the named-key overrides — the defaults
  // will be dropped on every call.
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
