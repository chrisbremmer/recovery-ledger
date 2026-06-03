// Bootstrap composition root — the ONE place every runtime collaborator is
// wired together (Plan 03-11 Task 1 + ARCHITECTURE.md Composition Root).
//
// Responsibilities:
//   1. Open the SQLite database with the six D-30 pragmas (via Plan 03-05's
//      `openDb` factory).
//   2. Run the hand-rolled migrator (Plan 03-05's `migrate`) — applies any
//      pending `0000_*.sql` payloads in `BEGIN IMMEDIATE` with chmod-600
//      pre-migration backups per D-06/D-07/D-08.
//   3. Construct every repository factory over the Drizzle handle (Plan
//      03-08 repos).
//   4. Construct the sync deps shape that `runSync` consumes.
//   5. Phase 4 extension: construct the review / decision / cache deps
//      shapes and wire 6 new services (getDailyReview, getWeeklyReview,
//      addDecision, reviewDecisions, queryCache, getApiGap) into the
//      `Bootstrapped.services` interface alongside Phase 3's `runSync`.
//      Wave 4 (Plans 04-10 + 04-11) — every MCP tool and CLI command
//      composes against `Bootstrapped.services` per the Phase 3 ≤5-line
//      CLI shim precedent.
//   6. Return a `Bootstrapped` value with a `close()` lifecycle hook so
//      callers (CLI shim, tests) can release the sqlite handle.
//
// Lite hexagonal discipline: this is the ONLY non-test module outside
// `src/infrastructure/db/` that touches `openDb` + `migrate` + the
// repository factories. CLI shims (Plan 03-12) call `bootstrap()`; they
// do NOT reach into the infrastructure layer directly. The MCP layer
// (Phase 4) will do the same.
//
// Gate G (strict): drizzle is imported through Plan 03-05's canonical
// re-export from `../infrastructure/db/connection.js`, NOT directly from
// `'drizzle-orm/better-sqlite3'`. A direct import here would silently
// route around the gate.
//
// ADR-0001: no direct stdout writes; no terminal-banner emit. The
// bootstrap layer uses Pino through stderr via the production singleton
// from `../infrastructure/config/logger.js`. Phase 4 services that wire
// here all observe the same discipline.
//
// Migrations dir resolution: computed from `import.meta.url` so it works
// for both the dev path (src/ via tsx + vitest) and the built path (dist/
// after `tsup`). Tests that need a custom path use the in-memory DB
// helper from Plan 03-07 directly — they bypass `bootstrap()` and
// construct deps inline.

import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import type Database from 'better-sqlite3';
import type { Logger } from 'pino';
// ARCH-04 (#92): isAuthError from domain (canonical); WhoopApiError stays
// in infrastructure (HTTP-status-driven, not a domain concept).
// ERRC-01 (#89): isAuthError maps refresh-side AuthError to the same
// status 401 the WhoopApiError(unauthorized) path emits.
import { isAuthError } from '../domain/errors/auth.js';
import type { DailyReviewResult, WeeklyReviewResult } from '../domain/review/types.js';
import { WhoopRawProfile } from '../domain/schemas/whoop-api.js';
import type { Decision } from '../domain/types/entities.js';
import type { RunSyncInput, RunSyncResult } from '../domain/types/sync.js';
import { logger } from '../infrastructure/config/logger.js';
import { paths } from '../infrastructure/config/paths.js';
import { type drizzle, openDb } from '../infrastructure/db/connection.js';
import { migrate } from '../infrastructure/db/migrate.js';
import {
  type BodyMeasurementsRepo,
  createBodyMeasurementsRepo,
} from '../infrastructure/db/repositories/body-measurements.repo.js';
import {
  type CyclesRepo,
  createCyclesRepo,
} from '../infrastructure/db/repositories/cycles.repo.js';
import {
  createDailySummariesRepo,
  type DailySummariesRepo,
} from '../infrastructure/db/repositories/daily-summaries.repo.js';
import {
  createDecisionsRepo,
  type DecisionsRepo,
} from '../infrastructure/db/repositories/decisions.repo.js';
import {
  createProfileRepo,
  type ProfileRepo,
} from '../infrastructure/db/repositories/profile.repo.js';
import {
  createRecoveryRepo,
  type RecoveryRepo,
} from '../infrastructure/db/repositories/recovery.repo.js';
import { createSleepsRepo, type SleepsRepo } from '../infrastructure/db/repositories/sleep.repo.js';
import {
  createSyncRunsRepo,
  type SyncRunsRepo,
} from '../infrastructure/db/repositories/sync-runs.repo.js';
import {
  createWorkoutsRepo,
  type WorkoutsRepo,
} from '../infrastructure/db/repositories/workouts.repo.js';
import { type AuthedCall, httpGet } from '../infrastructure/whoop/client.js';
import { WhoopApiError } from '../infrastructure/whoop/errors.js';
import { createGetBodyMeasurement } from '../infrastructure/whoop/resources/body-measurements.js';
import { createListCycles } from '../infrastructure/whoop/resources/cycles.js';
import { createGetProfile } from '../infrastructure/whoop/resources/profile.js';
import { createListRecovery } from '../infrastructure/whoop/resources/recovery.js';
import { createListSleep } from '../infrastructure/whoop/resources/sleep.js';
import { createListWorkouts } from '../infrastructure/whoop/resources/workouts.js';
import { createTokenStore, type TokenStore } from '../infrastructure/whoop/token-store.js';
import { getApiGap } from './api-gap/index.js';
import type { ApiGapResult } from './api-gap/types.js';
import { queryCache } from './cache/index.js';
import type { QueryCacheInput, QueryCacheResult } from './cache/types.js';
import { addDecision, reviewDecisions } from './decision/index.js';
import type {
  AddDecisionInput,
  ReviewDecisionsInput,
  ReviewDecisionsResult,
} from './decision/types.js';
import {
  type DoctorResult,
  type RunDoctorOptions,
  type runDoctor,
  runDoctor as runDoctorImpl,
} from './doctor/index.js';
import { createRefreshOrchestrator, type RefreshOrchestrator } from './refresh-orchestrator.js';
import { getDailyReview } from './review/daily.js';
import { getWeeklyReview } from './review/weekly.js';
import { type RunSyncDeps, runSync } from './sync/index.js';

export interface Bootstrapped {
  db: ReturnType<typeof drizzle>;
  sqlite: Database.Database;
  /** All wired repositories. Exposed on the bootstrap surface so Phase 4
   *  review/decision commands (which consume decisions + dailySummaries)
   *  do not need to re-construct factories or open a second handle. The
   *  sync orchestrator consumes the relevant subset through `services`. */
  repos: {
    cycles: CyclesRepo;
    recoveries: RecoveryRepo;
    sleeps: SleepsRepo;
    workouts: WorkoutsRepo;
    profile: ProfileRepo;
    bodyMeasurements: BodyMeasurementsRepo;
    syncRuns: SyncRunsRepo;
    decisions: DecisionsRepo;
    dailySummaries: DailySummariesRepo;
  };
  services: {
    runSync(input: RunSyncInput): Promise<RunSyncResult>;
    // Phase 4 additions — wired in the return block below using
    // `reviewDeps`, `decisionDeps`, and `cacheDeps` shapes constructed
    // once before the return. The Phase 3 `runSync` wiring stays
    // untouched. Each method matches the exact signature of its
    // underlying service function (declared on the function imports
    // above) so callers narrow on the Bootstrapped type alone.
    getDailyReview(input: { date?: string }): Promise<DailyReviewResult>;
    getWeeklyReview(input: { date?: string }): Promise<WeeklyReviewResult>;
    addDecision(input: AddDecisionInput): Promise<Decision>;
    reviewDecisions(input: ReviewDecisionsInput): Promise<ReviewDecisionsResult>;
    queryCache(input: QueryCacheInput): Promise<QueryCacheResult>;
    getApiGap(): Promise<ApiGapResult>;
    // Phase 1+2 surfaces re-exposed on the bootstrap services map. The
    // MCP entry (Plan 04-10) switched from createServices() to
    // bootstrap(); for the runtime to satisfy the full `Services`
    // interface (which `register*` tool factories consume), the doctor
    // + refreshOrchestrator surfaces must be present on this map too.
    // Both are zero-DB-dependency, so wiring them here costs nothing.
    runDoctor: typeof runDoctor;
    refreshOrchestrator: RefreshOrchestrator;
    // Phase 10 ARCH-02 (#85): expose the bootstrap-constructed tokenStore
    // on the services surface so any future DB-coupled flow can pull it
    // from `Bootstrapped` rather than instantiating its own. The OAuth-
    // login flow in `src/cli/commands/auth.ts` is the sole documented
    // exception and continues to construct its own `createTokenStore()`.
    tokenStore: TokenStore;
  };
  close(): void;
}

export interface BootstrapOptions {
  /** Override the SQLite path. Defaults to `paths.dbFile` (`~/.recovery-ledger/db.sqlite`). */
  dbFile?: string;
  /** Override the migrations directory. Defaults to the resolved path from
   *  `import.meta.url`. Tests use the in-memory-db helper directly instead
   *  of overriding here; this exists for niche shell-test scenarios. */
  migrationsDir?: string;
  /** Inject a custom logger — defaults to the production Pino singleton. */
  logger?: Logger;
  /**
   * Phase 10 ARCH-02 (#85): inject a custom `TokenStore` instance. Defaults
   * to `createTokenStore()` (bound to the production keychain + file backend
   * via the canonical paths). Tests pass a fake store; production callers
   * leave this undefined so bootstrap constructs the single canonical
   * instance per process. See ADR-0002 §Enforcement.
   */
  tokenStore?: TokenStore;
  /**
   * Phase 10 ARCH-02 (#85): inject a custom `RefreshOrchestrator`. Defaults
   * to `createRefreshOrchestrator(tokenStore)`. Tests use this to bypass
   * the OAuth refresh chain; production callers leave it undefined.
   */
  refreshOrchestrator?: RefreshOrchestrator;
}

/**
 * Open the DB, run the migrator, build the services. Returns the wired
 * `{db, sqlite, services, close}` quad.
 *
 * Throws on:
 *   - missing/invalid `dbFile` (better-sqlite3 throws on `new Database()`)
 *   - migration failure (re-throws `MigrationError` from Plan 03-05)
 *   - missing migrations directory (`migrate` throws inconsistent_state)
 *
 * Caller MUST call `close()` when done; the orchestrator does not
 * register a process-level cleanup hook (the CLI shim wires that at the
 * SIGINT boundary, Plan 03-12).
 */
// Phase 4 Plan 04-10: probe both candidate locations for the migrations
// payload. The built `dist/mcp.mjs` carries migrations at
// `dist/infrastructure/db/migrations` (tsup onSuccess copy); the dev
// `src/services/bootstrap.ts` resolves to `src/infrastructure/db/migrations`
// via the one-`..` pop. Probing avoids a brittle branch on `import.meta.url`
// containing `dist`.
function resolveMigrationsDir(here: string): string {
  const built = resolve(here, 'infrastructure', 'db', 'migrations');
  if (existsSync(resolve(built, 'meta', '_journal.json'))) return built;
  return resolve(here, '..', 'infrastructure', 'db', 'migrations');
}

export function bootstrap(opts: BootstrapOptions = {}): Bootstrapped {
  const dbFile = opts.dbFile ?? paths.dbFile;
  // Phase 10 ARCH-02 (#85) + ARCH-03: construct the per-process collaborators
  // exactly once here. tokenStore is the load-bearing chokepoint for the
  // ADR-0002 three-layer single-flight gate; the orchestrator binds the
  // 401-reactive retry policy on top of it; authedCall is the closure handed
  // to the WHOOP HTTP client (ARCH-03 inverts the previous client →
  // services/refresh-orchestrator import). Override seams on
  // `BootstrapOptions` exist so tests can inject fakes without touching
  // any real keychain / file backend.
  const tokenStore = opts.tokenStore ?? createTokenStore();
  const refreshOrchestrator = opts.refreshOrchestrator ?? createRefreshOrchestrator(tokenStore);
  const authedCall: AuthedCall = (op) => refreshOrchestrator.callWithAuth(op);
  // Resolve migrations dir from import.meta.url. The directory lives at
  // two locations depending on path shape:
  //   - DEV (tsx, src/): `src/services/bootstrap.ts` →
  //     `../infrastructure/db/migrations` (one `..` pop + the dir).
  //   - BUILT (tsup, dist/): `dist/mcp.mjs` (bundled bootstrap) →
  //     `./infrastructure/db/migrations` (no `..` — the migrations
  //     payload is copied next to the bundle via tsup's onSuccess
  //     hook in `tsup.config.ts`).
  // We probe the built location first (no `..`), then fall back to the
  // dev location (one `..`). The migrationsDir option remains the
  // explicit override.
  const HERE = dirname(fileURLToPath(import.meta.url));
  const migrationsDir = opts.migrationsDir ?? resolveMigrationsDir(HERE);
  const log = opts.logger ?? logger;

  const { db, sqlite } = openDb(dbFile);
  // surface migration start/finish so a slow first-run migration
  // (large WAL replay, large pre-migration backup) is not silently waiting.
  // Observability only; no behavior change.
  log.info({ event: 'migration_started', migrationsDir });
  // LIFE-01 (#81): pair openDb with try/catch so a MigrationError throw
  // does not leak the better-sqlite3 file handle. The OS reclaims on
  // process.exit, but any caller that catches to continue degraded
  // (tests, doctor → fix → retry loops, future embedded callers) would
  // otherwise see SQLITE_BUSY on retry until GC.
  try {
    migrate(sqlite, {
      migrationsDir,
      backupsDir: paths.backupsDir,
      dbFile,
    });
  } catch (err) {
    try {
      sqlite.close();
    } catch {
      // best-effort — close on a partially-opened handle can throw if
      // the migrator left WAL state ambiguous; swallow and let the
      // original MigrationError surface unchanged.
    }
    throw err;
  }
  log.info({ event: 'migration_finished' });

  const repos = {
    cycles: createCyclesRepo(db),
    recoveries: createRecoveryRepo(db),
    sleeps: createSleepsRepo(db),
    workouts: createWorkoutsRepo(db),
    profile: createProfileRepo(db),
    bodyMeasurements: createBodyMeasurementsRepo(db),
    syncRuns: createSyncRunsRepo(db),
    // Plan 03-12 (CLI sync shim) does not call these, but Phase 4's
    // decision-add + baseline service will. Declared here so the
    // composition root pins the dependency graph at Phase 3 close.
    decisions: createDecisionsRepo(db),
    dailySummaries: createDailySummariesRepo(db),
  };

  // #35 — sweep any `sync_runs.status='running'` rows that are older
  // than the threshold. These are orphans from a crashed prior process:
  // SIGINT / SIGTERM is now handled (#15) but a hard kill (`kill -9`,
  // OOM, power loss) cannot install a cleanup, so the running row stays
  // forever and masks subsequent failures.
  //
  // LIFE-02 (#82): widened threshold from 1h to 6h. A long-running CLI
  // `sync --since 2020-01-01` (full backfill) plausibly exceeds 1h at p99
  // WHOOP latency; if an MCP server started during the backfill, the 1h
  // threshold would race the CLI's eventual finalize() and flip a still-
  // in-flight run to 'aborted'. 6h covers the largest plausible sync
  // (multi-year backfill including 429 backoff) with margin.
  const RECLASSIFY_THRESHOLD_MS = 6 * 60 * 60 * 1000;
  // BACK-01 (#95): wrap reclassifyStaleRunning in try/catch — a missed
  // sweep is non-fatal (the orphan rows just stay 'running' for another
  // boot cycle) and must not block bootstrap. Pre-fix any throw here
  // (locked-DB write, schema drift, prepared-statement failure)
  // bubbled up and prevented bootstrap from completing.
  try {
    const reclassified = repos.syncRuns.reclassifyStaleRunning(
      RECLASSIFY_THRESHOLD_MS,
      new Date().toISOString(),
    );
    if (reclassified > 0) {
      // LIFE-02 (#82): log includes count so a future doctor probe can
      // correlate the bootstrap sweep with subsequent recency anomalies.
      log.warn({ event: 'sync_runs_stale_reclassified', count: reclassified });
    }
  } catch (err) {
    log.warn({
      event: 'sync_runs_stale_reclassify_failed',
      err: err instanceof Error ? err.message : String(err),
    });
  }

  // Phase 10 ARCH-03: each resource module is a factory that captures the
  // bootstrap-constructed `authedCall` via closure. The consumer shape on
  // RunSyncDeps['whoop'] is unchanged — each value is still a `(opts) =>
  // Promise<Result>` function — so `runSync` needs no changes.
  const whoop: RunSyncDeps['whoop'] = {
    resources: {
      cycles: createListCycles({ authedCall }),
      recoveries: createListRecovery({ authedCall }),
      sleeps: createListSleep({ authedCall }),
      workouts: createListWorkouts({ authedCall }),
      profile: createGetProfile({ authedCall }),
      body_measurements: createGetBodyMeasurement({ authedCall }),
    },
  };

  const syncDeps: RunSyncDeps = {
    repos: {
      syncRuns: repos.syncRuns,
      cycles: repos.cycles,
      recoveries: repos.recoveries,
      sleeps: repos.sleeps,
      workouts: repos.workouts,
      profile: repos.profile,
      bodyMeasurements: repos.bodyMeasurements,
    },
    whoop,
    sqlite,
    clock: () => new Date(),
    // IANA zone resolved lazily PER sync start per D-13 — the user might
    // change their machine's tz between syncs (e.g., laptop traveling).
    // `Intl.DateTimeFormat().resolvedOptions().timeZone` returns the
    // current process's view of the OS tz.
    ianaZone: () => Intl.DateTimeFormat().resolvedOptions().timeZone,
    logger: log,
  };

  // Phase 4 dep shapes. Each shape is the narrowest set the corresponding
  // service consumes:
  //
  //  - `reviewDeps`: full `repos` set + clock + ianaZone + logger. Daily
  //    and weekly reviews both compose multiple repos (cycles +
  //    recoveries + sleeps + workouts + profile + body_measurements +
  //    sync_runs + daily_summaries) and the weekly view additionally
  //    reads `decisions.countSince(...)` for the D-22 prompt slot.
  //  - `decisionDeps`: decisions repo only + clock + logger (D-19/D-20).
  //  - `cacheDeps`: full `repos` set + logger (D-24 8-arm dispatch); no
  //    clock or ianaZone — the cache surface is pure read pass-through.
  //
  // The `clock` and `ianaZone` lambdas are the same shape used by the
  // sync orchestrator above — re-evaluated lazily per call so a laptop
  // crossing time zones between two service calls picks up the right tz
  // on the second call (D-13 carry-forward).
  const reviewDeps = {
    repos,
    clock: () => new Date(),
    ianaZone: () => Intl.DateTimeFormat().resolvedOptions().timeZone,
    logger: log,
  };
  const decisionDeps = {
    repos: { decisions: repos.decisions },
    clock: () => new Date(),
    logger: log,
  };
  const cacheDeps = { repos, logger: log };

  // Plan 05-06: the production whoop_roundtrip fetcher. Routes a single
  // GET /v2/user/profile/basic through `httpGet` (ADR-0007 read-only,
  // Gate-F-allowlisted chokepoint — NO bare fetch here). `httpGet` itself
  // wraps the call in `callWithAuth` (ADR-0002 single-flight refresh), so a
  // stale token triggers exactly one refresh through the three-layer gate.
  // The probe only needs `{status, durationMs}`; `httpGet` THROWS on non-200,
  // so the catch arm derives a representative HTTP status from the thrown
  // error. T-05-I6: only `{status, durationMs}` flows back — no Bearer/JWT
  // material. The `accessToken` param is unused here because the token is
  // supplied internally by `callWithAuth` inside `httpGet`; it is present to
  // satisfy the probe's fetcher contract.
  //
  // Plan 05-06 deviation (Rule 3): the plan pseudocode read
  // `WhoopApiError.status`, but the actual error class carries a discriminated
  // `kind` (not a numeric status — see src/infrastructure/whoop/errors.ts).
  // We map `kind` back to a representative status so the probe's 401 / 200 /
  // other branch logic still distinguishes the auth-revoked case. A refresh
  // that fails entirely surfaces as an AuthError (not a WhoopApiError); that
  // falls through to status 0, which the probe renders as a generic
  // roundtrip-failed warn — acceptable for the doctor surface.
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
  const productionWhoopFetcher = async (
    _accessToken: string,
  ): Promise<{ status: number; durationMs: number }> => {
    const start = performance.now();
    try {
      // Phase 10 ARCH-03: `httpGet` now takes `authedCall` as its 4th
      // positional parameter. The local `authedCall` const constructed
      // above wraps the same bootstrap-bound `refreshOrchestrator`, so
      // the ADR-0002 three-layer single-flight gate still routes every
      // GET through callWithAuth exactly once per `httpGet` invocation.
      await httpGet('/v2/user/profile/basic', {}, WhoopRawProfile, authedCall);
      return { status: 200, durationMs: performance.now() - start };
    } catch (err) {
      // ERRC-01 (#89): a refresh-side AuthError ('auth_expired',
      // 'refresh_failed', 'auth_missing') is the same condition the
      // user experiences as "your token is dead — re-auth". Map all of
      // them to status 401 so the doctor's whoop_roundtrip probe emits
      // the SAME "run `recovery-ledger auth`" remediation as the
      // WhoopApiError({kind:'unauthorized'}) path. Pre-ERRC-01 these
      // routed to status 0 → the probe's generic 'roundtrip failed'
      // warn, which gave the user two different messages for one
      // condition.
      if (isAuthError(err)) {
        return { status: 401, durationMs: performance.now() - start };
      }
      const status = err instanceof WhoopApiError ? whoopErrorKindToStatus(err.kind) : 0;
      return { status, durationMs: performance.now() - start };
    }
  };

  // Plan 05-06: pre-bind the production deps into runDoctor so CLI/MCP
  // callers get the full 14-check surface without threading sqlite + repos +
  // refreshOrchestrator + whoopFetcher by hand. User-supplied opts win over
  // the defaults (test seam). The `repos` shape maps the bootstrap plurals
  // (`recoveries`/`sleeps`) to the singular keys the recency / scored-day /
  // data-quality probes consume (`recovery`/`sleep`) — the narrow union
  // structurally matches `RunDoctorOptions.repos`.
  // Spread-then-override semantics: each individual `opts.X ?? default`
  // gives the caller's CONCRETE value priority and falls back to the
  // bootstrap-bound default when the caller's value is null/undefined.
  // A caller passing `{ tokenStore: undefined }` explicitly will land
  // on the bootstrap default (not stay undefined) — this is the
  // test-seam contract the surrounding tests rely on. The `...opts`
  // spread first copies every key (including unrelated ones) onto the
  // payload; the subsequent named keys then re-evaluate the defaulted
  // fields, with later keys winning. Do NOT collapse this into a single
  // `{ ...opts }` without the named-key overrides — the defaults will
  // be dropped on every call.
  const services_runDoctor = (opts: RunDoctorOptions = {}): Promise<DoctorResult> =>
    runDoctorImpl({
      ...opts,
      sqlite: opts.sqlite ?? sqlite,
      repos: opts.repos ?? {
        syncRuns: repos.syncRuns,
        cycles: repos.cycles,
        recovery: repos.recoveries,
        sleep: repos.sleeps,
      },
      refreshOrchestrator: opts.refreshOrchestrator ?? refreshOrchestrator,
      whoopFetcher: opts.whoopFetcher ?? productionWhoopFetcher,
      // Phase 10 ARCH-02 + ARCH-07: thread the bootstrap-constructed
      // tokenStore through so the auth + token_freshness probes get
      // required deps (RESEARCH §ARCH-07). The lightweight createServices()
      // path leaves this undefined; those probes degrade to "no token store
      // injected" structured fails in that mode.
      tokenStore: opts.tokenStore ?? tokenStore,
      // Reuse the path bootstrap already resolved for the migrator so the
      // db_schema_version probe reads the same dir from the bundled dist tree
      // (the probe's own import.meta.url math is wrong once flattened).
      migrationsDir: opts.migrationsDir ?? migrationsDir,
    });

  return {
    db,
    sqlite,
    repos,
    services: {
      runSync: (input) => runSync(input, syncDeps),
      // Phase 4 wiring — every service receives its tailored deps shape.
      // Each composition keeps the underlying service function ignorant
      // of the bootstrap; deps flow in via the second parameter.
      getDailyReview: (input) => getDailyReview(input, reviewDeps),
      getWeeklyReview: (input) => getWeeklyReview(input, reviewDeps),
      addDecision: (input) => addDecision(input, decisionDeps),
      reviewDecisions: (input) => reviewDecisions(input, decisionDeps),
      queryCache: (input) => queryCache(input, cacheDeps),
      getApiGap: () => getApiGap(),
      // Plan 05-06: runDoctor is now pre-bound to the production deps
      // (sqlite + repos + refreshOrchestrator + whoopFetcher) so the full
      // 14-check surface runs end-to-end from both the CLI doctor command
      // and the MCP whoop_doctor tool (both compose against this map).
      // refreshOrchestrator stays a direct re-export — it is a pure policy
      // wrapper with no DB dependency.
      runDoctor: services_runDoctor,
      refreshOrchestrator,
      tokenStore,
    },
    close: () => {
      try {
        sqlite.close();
      } catch {
        // Closing an already-closed handle is harmless; swallow so
        // teardown is idempotent across lifecycle errors.
      }
    },
  };
}
