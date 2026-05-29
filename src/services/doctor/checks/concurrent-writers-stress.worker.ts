// Worker entry point for the concurrent_writers_stress probe (Plan 05-05,
// D-02 #9). Forked by `probeConcurrentWritersStress`; receives the tmp dbFile
// path + iteration count via process.argv; runs N BEGIN IMMEDIATE upserts
// against a tiny self-contained `stress_test` table; reports SQLITE_BUSY (or
// any other error) via a non-zero exit. NEVER touches `paths.dbFile` (the
// Phase 3 production DB) — it works ONLY with the dbFile argument passed by
// the parent (T-05-T5).
//
// ADR-0001 (CLAUDE.md §Critical Rules — MCP stdout purity): no console calls,
// no writes to this process' stdout. The worker surfaces failure reasons via
// `process.stderr.write` (the load-bearing stderr escape hatch) + exit code;
// the parent captures the per-child stderr through `{ silent: true }`.
//
// The worker uses its OWN tiny schema rather than the project schema/migrator
// so it stays hermetic: a stress probe only needs a primary-key conflict path
// to exercise the BEGIN IMMEDIATE writer lock, not the full cycles/recoveries
// graph. Pragmas mirror the Phase 3 D-30 connection.ts block that matters for
// contention: WAL + busy_timeout=5000 (Pitfall 13 — BEGIN IMMEDIATE rides out
// contention behind the timeout; a SQLITE_BUSY escape means the timeout was
// beaten).

import Database from 'better-sqlite3';

const dbFile = process.argv[2];
const N = Number.parseInt(process.argv[3] ?? '100', 10);

if (dbFile === undefined || dbFile === '') {
  process.stderr.write('worker error: missing dbFile arg\n');
  process.exit(2);
}

let db: Database.Database | undefined;
try {
  db = new Database(dbFile);
  // Contention-relevant subset of the D-30 pragma block. ORDER MATTERS for
  // the concurrent-fork case: busy_timeout MUST be armed BEFORE the WAL-mode
  // switch. `journal_mode = WAL` takes a brief exclusive lock to rewrite the
  // journal header; with 4 workers switching at once, a worker that loses
  // that race fails with SQLITE_BUSY ("database is locked") UNLESS busy_timeout
  // is already set so it waits the lock out. (D-30's connection.ts runs
  // journal_mode first because it bootstraps a single writer; a multi-writer
  // fork is the one place that ordering has to invert.)
  db.pragma('busy_timeout = 5000');
  db.pragma('journal_mode = WAL');
  db.exec(
    'CREATE TABLE IF NOT EXISTS stress_test (id INTEGER PRIMARY KEY, counter INTEGER NOT NULL)',
  );
  const upsert = db.prepare(
    'INSERT INTO stress_test (id, counter) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET counter = counter + 1',
  );
  for (let i = 0; i < N; i++) {
    // Phase 3 D-31 BEGIN IMMEDIATE discipline: take the write lock eagerly so
    // concurrent writers serialize behind it instead of deadlocking on a
    // deferred-to-immediate upgrade.
    const txn = db.transaction(() => {
      upsert.run(i % 10, 1);
    });
    txn.immediate();
  }
  db.close();
  process.exit(0);
} catch (err) {
  try {
    db?.close();
  } catch {
    // Best-effort: the handle may already be unusable after a failed write.
  }
  const message = err instanceof Error ? err.message : String(err);
  // better-sqlite3 surfaces the busy condition as message "database is locked"
  // with `code: 'SQLITE_BUSY'` on the error object — check BOTH so the
  // classification is robust regardless of which surface carries the signal.
  const code = (err as { code?: unknown } | null)?.code;
  const isBusy =
    code === 'SQLITE_BUSY' ||
    message.includes('SQLITE_BUSY') ||
    message.includes('database is locked');
  if (isBusy) {
    process.stderr.write(`SQLITE_BUSY: ${message}\n`);
    process.exit(1);
  }
  process.stderr.write(`worker error: ${message}\n`);
  process.exit(2);
}
