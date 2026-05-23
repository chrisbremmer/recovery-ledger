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
import { fileURLToPath } from 'node:url';
import type Database from 'better-sqlite3';
import type { Logger } from 'pino';
import type { DailyReviewResult, WeeklyReviewResult } from '../domain/review/types.js';
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
import { getBodyMeasurement } from '../infrastructure/whoop/resources/body-measurements.js';
import { listCycles } from '../infrastructure/whoop/resources/cycles.js';
import { getProfile } from '../infrastructure/whoop/resources/profile.js';
import { listRecovery } from '../infrastructure/whoop/resources/recovery.js';
import { listSleep } from '../infrastructure/whoop/resources/sleep.js';
import { listWorkouts } from '../infrastructure/whoop/resources/workouts.js';
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
import { runDoctor } from './doctor/index.js';
import { refreshOrchestrator } from './refresh-orchestrator.js';
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
    refreshOrchestrator: typeof refreshOrchestrator;
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
  migrate(sqlite, {
    migrationsDir,
    backupsDir: paths.backupsDir,
    dbFile,
  });
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

  const whoop: RunSyncDeps['whoop'] = {
    resources: {
      cycles: listCycles,
      recoveries: listRecovery,
      sleeps: listSleep,
      workouts: listWorkouts,
      profile: getProfile,
      body_measurements: getBodyMeasurement,
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
      // Phase 1+2 surfaces — direct re-export; both are pure-functional
      // (runDoctor calls Phase 1 doctor checks; refreshOrchestrator is a
      // policy wrapper). No DB needed; wiring through bootstrap so the
      // MCP entry's `app.services` satisfies the full `Services`
      // interface for the 8 Phase 4 tool registrars.
      runDoctor,
      refreshOrchestrator,
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
