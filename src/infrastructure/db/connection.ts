// SQLite connection factory — the one place every DB handle is born (Plan
// 03-05 Task 1; D-30 + Pattern 1 + Pitfall 12).
//
// `openDb(path)` is called explicitly at bootstrap (Plan 03-11) and inside
// the hand-rolled migrator's child-process integration test (Task 3). Every
// caller gets a fresh `{ db, sqlite }` pair with the six load-bearing
// pragmas already applied in the fixed order D-30 mandates. The pragma
// block is the single chokepoint where WAL hygiene (Pitfall 12 — unbounded
// WAL growth without `journal_size_limit` / `wal_autocheckpoint`) and
// concurrent-reader / single-writer discipline (Pitfall 13 — `BEGIN
// IMMEDIATE` requires `busy_timeout` to ride out contention) are
// established. Downstream code (repositories, migrator, sync orchestrator)
// trusts the connection-level invariants this file lands.
//
// ADR-0001 (MCP stdout purity): no direct stdout writes / no console calls
// in this file — schema-level surface only; any future logging would route
// through Pino on stderr per src/infrastructure/config/logger.ts.
//
// Gate G (Wave 0 chokepoint, src/infrastructure/db/ scope): the
// `drizzle-orm/better-sqlite3` import is allowlisted here. This file
// additionally re-exports `drizzle` so callers OUTSIDE this directory
// (Plan 03-07 `tests/helpers/in-memory-db.ts`, Plan 03-11
// `src/services/bootstrap.ts`) import the canonical Drizzle factory
// through this file. That keeps Gate G strict — `from 'drizzle-orm'`
// remains forbidden outside `src/infrastructure/db/` — without forcing
// every downstream caller to live under this directory just to call
// `drizzle(sqlite)`. The re-export is the canonical import surface;
// adding a sibling import path would silently break the gate.

import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';

// Canonical `drizzle` re-export. Callers outside src/infrastructure/db/
// MUST import drizzle through this re-export so Gate G can stay strict
// (forbids `from 'drizzle-orm'` outside src/infrastructure/db/).
export { drizzle } from 'drizzle-orm/better-sqlite3';

export interface OpenDbResult {
  db: ReturnType<typeof drizzle>;
  sqlite: Database.Database;
}

/**
 * Open a SQLite database at `path` and apply the six D-30 pragmas in fixed
 * order. Returns both the Drizzle wrapper (`db`) and the raw better-sqlite3
 * handle (`sqlite`) — the migrator needs raw access for `exec()` of
 * multi-statement SQL payloads and for `BEGIN IMMEDIATE` discipline, while
 * the repositories prefer the Drizzle DSL.
 *
 * Pragma order is load-bearing (D-30):
 *   1. journal_mode = WAL — switches journaling shape; must run first.
 *      For in-memory databases (`:memory:`) WAL is not supported; SQLite
 *      silently stays in 'memory' mode. We do not throw — the call itself
 *      does not raise, and tests / experimentation use `:memory:`.
 *   2. busy_timeout = 5000 — Pitfall 13: BEGIN IMMEDIATE rides this out
 *      under contention.
 *   3. journal_size_limit = 64 MB — Pitfall 12: caps the WAL on auto-
 *      checkpoint.
 *   4. wal_autocheckpoint = 1000 frames — Pitfall 12: routine fold-back
 *      so the WAL doesn't grow unbounded between explicit checkpoints.
 *   5. synchronous = NORMAL — durability cost vs. WAL throughput per
 *      better-sqlite3 perf guidance; one sync per checkpoint, not per
 *      transaction.
 *   6. foreign_keys = ON — recoveries.cycle_id REFERENCES cycles.id;
 *      SQLite defaults to OFF per-connection.
 *
 * Caller owns the lifecycle: call `result.sqlite.close()` when done.
 * `openDb` does not register a cleanup hook; the bootstrap layer (Plan
 * 03-11) wires shutdown.
 */
export function openDb(path: string): OpenDbResult {
  const sqlite = new Database(path);
  // Fixed order per D-30. journal_mode must run first; it is the only
  // pragma that switches the DB into a different journaling shape.
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('busy_timeout = 5000');
  sqlite.pragma('journal_size_limit = 67108864');
  sqlite.pragma('wal_autocheckpoint = 1000');
  sqlite.pragma('synchronous = NORMAL');
  sqlite.pragma('foreign_keys = ON');
  return { db: drizzle(sqlite), sqlite };
}
