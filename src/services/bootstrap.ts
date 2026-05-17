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
//   5. Return a `Bootstrapped` value with a `close()` lifecycle hook so
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
// ADR-0001: no console.*, no process.stdout.write. The bootstrap layer
// uses Pino → stderr via the production singleton from
// `../infrastructure/config/logger.js`.
//
// Migrations dir resolution: computed from `import.meta.url` so it works
// for both the dev path (src/ via tsx + vitest) and the built path (dist/
// after `tsup`). Tests that need a custom path use the in-memory DB
// helper from Plan 03-07 directly — they bypass `bootstrap()` and
// construct deps inline.

import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type Database from 'better-sqlite3';
import type { Logger } from 'pino';
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
export function bootstrap(opts: BootstrapOptions = {}): Bootstrapped {
  const dbFile = opts.dbFile ?? paths.dbFile;
  // Resolve migrations dir from import.meta.url so dev (tsx, src/) and
  // built (tsup, dist/) both find the directory next to the source file.
  // `src/services/bootstrap.ts` → `src/infrastructure/db/migrations`
  // (two ../ pops + infrastructure/db/migrations).
  const HERE = dirname(fileURLToPath(import.meta.url));
  const migrationsDir =
    opts.migrationsDir ?? resolve(HERE, '..', 'infrastructure', 'db', 'migrations');
  const log = opts.logger ?? logger;

  const { db, sqlite } = openDb(dbFile);
  migrate(sqlite, {
    migrationsDir,
    backupsDir: paths.backupsDir,
    dbFile,
  });

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

  return {
    db,
    sqlite,
    repos,
    services: {
      runSync: (input) => runSync(input, syncDeps),
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
