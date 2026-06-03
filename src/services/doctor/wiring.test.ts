// ARCH-06 unit tests for `createProductionDoctorDeps`. Exercises:
//   1. The returned `runDoctor` closure passes the bootstrap-bound production
//      deps through to `runDoctorImpl` when the caller supplies no opts.
//   2. User-supplied opts win over the bootstrap defaults (test-seam
//      contract — the surrounding integration tests rely on this).
//   3. The captured `productionWhoopFetcher` maps a `WhoopApiError({kind:
//      'unauthorized'})` thrown from `httpGet` to status 401.
//   4. The captured `productionWhoopFetcher` maps an `AuthError` thrown from
//      `httpGet` to status 401 (ERRC-01 parity with the WhoopApiError path
//      so both surface the same "re-auth" remediation).
//
// The factory and the `runDoctor` closure it returns are the only surface
// under test. `runDoctorImpl` (./index.js) is mocked so each test can
// capture what the factory routed into it; this keeps the assertions tight
// on the wiring contract without standing up the 14-probe pipeline. The
// production fetcher itself is exercised by invoking it through the
// captured argument; `httpGet` is mocked so each test can drive its throw
// behavior deterministically. No real HTTP, no MSW (ADR-0006 fixture-only).

import type Database from 'better-sqlite3';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthError } from '../../domain/errors/auth.js';
import type { CyclesRepo } from '../../infrastructure/db/repositories/cycles.repo.js';
import type { RecoveryRepo } from '../../infrastructure/db/repositories/recovery.repo.js';
import type { SleepsRepo } from '../../infrastructure/db/repositories/sleep.repo.js';
import type { SyncRunsRepo } from '../../infrastructure/db/repositories/sync-runs.repo.js';
import type { AuthedCall } from '../../infrastructure/whoop/client.js';
import { WhoopApiError } from '../../infrastructure/whoop/errors.js';
import type { TokenStore } from '../../infrastructure/whoop/token-store.js';
import type { RefreshOrchestrator } from '../refresh-orchestrator.js';
import type { DoctorResult, RunDoctorOptions } from './index.js';

// Mock `./index.js` so we can capture the args the factory routes into
// `runDoctorImpl` without invoking the actual 14-probe pipeline. The mock
// is hoisted by Vitest; the captured RunDoctorOptions are inspected in
// each test via `runDoctorImplMock.mock.calls[0]`.
const runDoctorImplMock = vi.fn(
  async (_opts: RunDoctorOptions): Promise<DoctorResult> => ({
    checks: [],
    overall: 'pass',
  }),
);
vi.mock('./index.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./index.js')>();
  return {
    ...actual,
    runDoctor: (opts: RunDoctorOptions) => runDoctorImplMock(opts),
  };
});

// Mock `../../infrastructure/whoop/client.js` so the production fetcher's
// behavior under WhoopApiError / AuthError can be exercised without going
// through `withRetry`'s network-error-wrap arm. The real httpGet's
// withRetry wraps any thrown error as `WhoopApiError({kind:'network'})`,
// which would mask the unauthorized + AuthError branch mapping the
// production fetcher must surface to the doctor probe.
const httpGetMock = vi.fn();
vi.mock('../../infrastructure/whoop/client.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../infrastructure/whoop/client.js')>();
  return {
    ...actual,
    httpGet: (...args: unknown[]) => httpGetMock(...args),
  };
});

// Import AFTER the vi.mock declarations so the factory binds to the mocked
// `runDoctorImpl` and `httpGet`.
const { createProductionDoctorDeps } = await import('./wiring.js');

// ----------------------------------------------------------------------------
// Fakes — minimum shape each ProductionDoctorDepsInput field needs. Each
// fake is a typed stub; no real I/O. The narrow shapes match the
// structural requirements of `runDoctor`'s repos union (cycles + recovery
// + sleep + syncRuns), the orchestrator surface (callWithAuth), and the
// token store surface (read + readStorageMode).
// ----------------------------------------------------------------------------

function makeFakeRepos(): {
  syncRuns: SyncRunsRepo;
  cycles: CyclesRepo;
  recoveries: RecoveryRepo;
  sleeps: SleepsRepo;
} {
  // Each fake is cast to the repo type; `runDoctor`'s opts.repos union
  // only reads `latestScoredDate` / `countByScoreState` / `latestFinished`,
  // so the rest of the repo surface can be undefined for the mocked
  // pipeline. The factory does not invoke these — it only passes them
  // through to runDoctorImpl, which is the unit under mock.
  return {
    syncRuns: {} as SyncRunsRepo,
    cycles: {} as CyclesRepo,
    recoveries: {} as RecoveryRepo,
    sleeps: {} as SleepsRepo,
  };
}

function makeFakeRefreshOrchestrator(): RefreshOrchestrator {
  return {
    callWithAuth: vi.fn(async (op) => op('fake-access-token')),
  } as unknown as RefreshOrchestrator;
}

function makeFakeTokenStore(): TokenStore {
  return {
    getValidAccessToken: vi.fn(async () => 'fake-access-token'),
    read: vi.fn(async () => null),
    write: vi.fn(async () => undefined),
    clear: vi.fn(async () => undefined),
    readStorageMode: vi.fn(async () => 'file'),
  } as unknown as TokenStore;
}

function makeFakeAuthedCall(): AuthedCall {
  return vi.fn(async (op) => op('fake-access-token'));
}

describe('createProductionDoctorDeps', () => {
  beforeEach(() => {
    runDoctorImplMock.mockClear();
    httpGetMock.mockReset();
  });

  it('returns a runDoctor function that calls runDoctorImpl with bound production deps', async () => {
    const sqlite = {} as Database.Database;
    const repos = makeFakeRepos();
    const refreshOrchestrator = makeFakeRefreshOrchestrator();
    const tokenStore = makeFakeTokenStore();
    const authedCall = makeFakeAuthedCall();
    const migrationsDir = '/fake/migrations/dir';

    const runDoctor = createProductionDoctorDeps({
      sqlite,
      repos,
      refreshOrchestrator,
      authedCall,
      tokenStore,
      migrationsDir,
    });

    expect(typeof runDoctor).toBe('function');

    await runDoctor();

    expect(runDoctorImplMock).toHaveBeenCalledTimes(1);
    const passedOpts = runDoctorImplMock.mock.calls[0]?.[0];
    expect(passedOpts).toBeDefined();
    if (passedOpts === undefined) throw new Error('passedOpts');

    // Identity assertions — each bound dep is the exact instance the
    // caller handed to the factory.
    expect(passedOpts.sqlite).toBe(sqlite);
    expect(passedOpts.refreshOrchestrator).toBe(refreshOrchestrator);
    expect(passedOpts.tokenStore).toBe(tokenStore);
    expect(passedOpts.migrationsDir).toBe(migrationsDir);

    // The repos shape gets the plural→singular remap (the doctor probes
    // consume `recovery`/`sleep`, bootstrap stores `recoveries`/`sleeps`).
    expect(passedOpts.repos).toBeDefined();
    expect(passedOpts.repos?.syncRuns).toBe(repos.syncRuns);
    expect(passedOpts.repos?.cycles).toBe(repos.cycles);
    expect(passedOpts.repos?.recovery).toBe(repos.recoveries);
    expect(passedOpts.repos?.sleep).toBe(repos.sleeps);

    // whoopFetcher must be the production closure the factory constructed;
    // the only assertion possible without exposing it is that it is a
    // function. (Its behavior is covered by the two error-mapping tests.)
    expect(typeof passedOpts.whoopFetcher).toBe('function');
  });

  it('honors user-supplied opts over production defaults', async () => {
    const productionSqlite = {} as Database.Database;
    const userSqlite = {} as Database.Database;
    const productionOrchestrator = makeFakeRefreshOrchestrator();
    const userOrchestrator = makeFakeRefreshOrchestrator();
    const productionTokenStore = makeFakeTokenStore();
    const userTokenStore = makeFakeTokenStore();
    const productionAuthedCall = makeFakeAuthedCall();
    const productionRepos = makeFakeRepos();
    const userMigrationsDir = '/user/override/migrations';

    const runDoctor = createProductionDoctorDeps({
      sqlite: productionSqlite,
      repos: productionRepos,
      refreshOrchestrator: productionOrchestrator,
      authedCall: productionAuthedCall,
      tokenStore: productionTokenStore,
      migrationsDir: '/production/migrations',
    });

    await runDoctor({
      sqlite: userSqlite,
      refreshOrchestrator: userOrchestrator,
      tokenStore: userTokenStore,
      migrationsDir: userMigrationsDir,
    });

    expect(runDoctorImplMock).toHaveBeenCalledTimes(1);
    const passedOpts = runDoctorImplMock.mock.calls[0]?.[0];
    expect(passedOpts).toBeDefined();
    if (passedOpts === undefined) throw new Error('passedOpts');

    // User-supplied values win; production defaults do NOT leak through.
    expect(passedOpts.sqlite).toBe(userSqlite);
    expect(passedOpts.sqlite).not.toBe(productionSqlite);
    expect(passedOpts.refreshOrchestrator).toBe(userOrchestrator);
    expect(passedOpts.refreshOrchestrator).not.toBe(productionOrchestrator);
    expect(passedOpts.tokenStore).toBe(userTokenStore);
    expect(passedOpts.tokenStore).not.toBe(productionTokenStore);
    expect(passedOpts.migrationsDir).toBe(userMigrationsDir);
    expect(passedOpts.migrationsDir).not.toBe('/production/migrations');
  });

  it('productionWhoopFetcher maps WhoopApiError kinds to HTTP statuses', async () => {
    // Drive the fetcher by having the mocked httpGet throw the
    // discriminated WhoopApiError directly (which is exactly what the
    // real httpGet does after `classifyHttpError` runs on a non-200
    // response). The factory's productionWhoopFetcher catches it and
    // maps `kind: 'unauthorized'` back to status 401 via the embedded
    // whoopErrorKindToStatus.
    httpGetMock.mockRejectedValueOnce(
      new WhoopApiError({ kind: 'unauthorized', detail: 'token revoked' }),
    );

    const runDoctor = createProductionDoctorDeps({
      sqlite: {} as Database.Database,
      repos: makeFakeRepos(),
      refreshOrchestrator: makeFakeRefreshOrchestrator(),
      authedCall: makeFakeAuthedCall(),
      tokenStore: makeFakeTokenStore(),
      migrationsDir: '/fake',
    });

    await runDoctor();
    const passedOpts = runDoctorImplMock.mock.calls[0]?.[0];
    expect(passedOpts?.whoopFetcher).toBeDefined();
    if (passedOpts === undefined || passedOpts.whoopFetcher === undefined) {
      throw new Error('whoopFetcher missing');
    }

    const result = await passedOpts.whoopFetcher('unused-access-token');
    expect(result.status).toBe(401);
    expect(typeof result.durationMs).toBe('number');
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('productionWhoopFetcher maps AuthError to status 401', async () => {
    // ERRC-01: a refresh-side AuthError must map to status 401 so the
    // doctor probe surfaces the same "run `recovery-ledger auth`"
    // remediation as the WhoopApiError({kind: 'unauthorized'}) path.
    // The mocked httpGet throws AuthError directly so the fetcher's
    // `if (isAuthError(err))` branch fires.
    httpGetMock.mockRejectedValueOnce(
      new AuthError({ kind: 'auth_expired', detail: 'refresh budget exhausted' }),
    );

    const runDoctor = createProductionDoctorDeps({
      sqlite: {} as Database.Database,
      repos: makeFakeRepos(),
      refreshOrchestrator: makeFakeRefreshOrchestrator(),
      authedCall: makeFakeAuthedCall(),
      tokenStore: makeFakeTokenStore(),
      migrationsDir: '/fake',
    });

    await runDoctor();
    const passedOpts = runDoctorImplMock.mock.calls[0]?.[0];
    expect(passedOpts?.whoopFetcher).toBeDefined();
    if (passedOpts === undefined || passedOpts.whoopFetcher === undefined) {
      throw new Error('whoopFetcher missing');
    }

    const result = await passedOpts.whoopFetcher('unused-access-token');
    expect(result.status).toBe(401);
    expect(typeof result.durationMs).toBe('number');
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });
});
