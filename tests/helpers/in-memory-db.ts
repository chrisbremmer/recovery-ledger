// In-memory SQLite helper for contract + integration tests. Opens a
// `:memory:` better-sqlite3 database, applies production pragmas (minus
// `journal_mode=WAL` — memory DBs do not support WAL; better-sqlite3
// silently stays in 'memory' mode), and runs the real Plan 03-05
// hand-rolled migrator against the committed migrations directory so
// every test sees the same schema the production code sees.
//
// **Gate G discipline (locked):** `drizzle` is imported through Plan
// 03-05's canonical re-export from `src/infrastructure/db/connection.ts`,
// NOT directly from `'drizzle-orm/better-sqlite3'`. The re-export is the
// single canonical drizzle import surface outside `src/infrastructure/db/`
// — keeping the rule grep-able (Gate G forbids importing the drizzle-orm
// package outside `src/infrastructure/db/`). A direct
// `'drizzle-orm/better-sqlite3'` import here would silently route around
// the gate (the gate scans `src/` only — Gate G discipline at the test-
// helper layer is a hand-held invariant the acceptance criteria pin).
//
// `migrate()` short-circuits its backup step for `dbFile === ':memory:'`
// (Plan 03-05 contract line 326: "if (dbFile === ':memory:') return ''"),
// so no real backup is written even though `backupsDir` is passed.
//
// Caller owns the lifecycle: call `close()` when done. No global setup;
// each test file decides whether to share or recreate the in-memory DB.

import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
// Plan 03-05 canonical re-export — keeps Gate G strict (no direct
// 'drizzle-orm/better-sqlite3' import outside src/infrastructure/db/).
import { drizzle } from '../../src/infrastructure/db/connection.js';
import { migrate } from '../../src/infrastructure/db/migrate.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = resolve(HERE, '..', '..', 'src', 'infrastructure', 'db', 'migrations');

export interface InMemoryDbResult {
  db: ReturnType<typeof drizzle>;
  sqlite: Database.Database;
  close(): void;
}

export function createInMemoryDb(): InMemoryDbResult {
  const sqlite = new Database(':memory:');
  // Production pragmas (D-30) minus `journal_mode=WAL` (memory DBs are
  // not WAL — Plan 03-05 connection.ts documents the same fallback).
  sqlite.pragma('busy_timeout = 5000');
  sqlite.pragma('foreign_keys = ON');
  // Run the same hand-rolled migrator against the in-memory DB.
  // `backupsDir` is never written for `:memory:` (migrate.ts:326).
  migrate(sqlite, {
    migrationsDir: MIGRATIONS_DIR,
    backupsDir: '/tmp/in-memory-db-no-backup',
    dbFile: ':memory:',
  });
  return {
    db: drizzle(sqlite),
    sqlite,
    close: () => {
      try {
        sqlite.close();
      } catch {
        // Closing an already-closed handle is harmless; swallow so
        // teardown is idempotent across test lifecycle errors.
      }
    },
  };
}
