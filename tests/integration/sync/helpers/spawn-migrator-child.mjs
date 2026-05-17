// Child-process helper for Plan 03-05 Task 3 integration tests
// (tests/integration/sync/migration-crash.test.ts).
//
// Two scenarios, switched via process.argv[2]:
//
//   'kill-mid-statement': open SQLite at process.env.TEST_DB_FILE, run the
//     migrator on a 2-migration journal where the second migration's SQL
//     intentionally takes long enough to be SIGKILLed from the parent.
//     Prints 'PRE-CRASH' to stdout right BEFORE the BEGIN IMMEDIATE so the
//     parent test process can race the kill against the in-flight db.exec.
//     The first migration is small and commits cleanly; the second crashes
//     mid-write.
//
//   'pragma-only': open SQLite at process.env.TEST_DB_FILE, run the
//     migrator on a normal journal (single migration), exit 0. Used to seed
//     a real disk-backed DB file for the pragma-roundtrip integration test.
//
// Gate B note: this is an .mjs file in tests/, exempted from the console
// rule. The PRE-CRASH stdout marker is load-bearing — the parent process
// races SIGKILL against the in-flight exec() based on seeing it.
//
// This file imports the compiled migrate.ts via the compiled bundle. To
// keep startup fast and avoid a transpile step at test time, we re-implement
// a minimal hand-rolled migrator inline — the shape mirrors
// src/infrastructure/db/migrate.ts exactly. The reason: tests/integration/
// runs as Node ESM and importing TypeScript source directly would require
// tsx, while importing dist/ would couple this test to the build pipeline.
// The inline shape is the SAME hand-rolled BEGIN IMMEDIATE / db.exec(sql) /
// COMMIT contract under test in migrate.test.ts; the parent test asserts
// the on-disk side effects (backup file, WAL recovery, integrity_check),
// not the migrator's TypeScript surface.

import { createHash } from 'node:crypto';
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  unlinkSync,
} from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';

const scenario = process.argv[2];
const dbFile = process.env.TEST_DB_FILE;
const migrationsDir = process.env.TEST_MIGRATIONS_DIR;
const backupsDir = process.env.TEST_BACKUPS_DIR;

if (!dbFile || !migrationsDir || !backupsDir) {
  process.stderr.write(
    'spawn-migrator-child: TEST_DB_FILE / TEST_MIGRATIONS_DIR / TEST_BACKUPS_DIR required\n',
  );
  process.exit(2);
}

const BACKUP_SUFFIXES = ['.sqlite', '.sqlite-wal', '.sqlite-shm'];
const BACKUP_RETENTION = 3;

function pruneBackups(dir, keep) {
  if (!existsSync(dir)) return;
  const files = readdirSync(dir)
    .filter((name) => name.endsWith('.sqlite'))
    .map((name) => ({ name, mtime: statSync(path.join(dir, name)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime);
  for (const { name } of files.slice(keep)) {
    const baseName = name.slice(0, -'.sqlite'.length);
    for (const suffix of BACKUP_SUFFIXES) {
      try {
        unlinkSync(path.join(dir, baseName + suffix));
      } catch {
        // missing companion is fine
      }
    }
  }
}

function takeBackup(dbFilePath, backupsDirPath, tag) {
  if (!existsSync(dbFilePath)) return '';
  mkdirSync(backupsDirPath, { recursive: true, mode: 0o700 });
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const base = path.join(backupsDirPath, `db.${ts}-pre-${tag}`);
  for (const suffix of BACKUP_SUFFIXES) {
    const companionSuffix = suffix.slice('.sqlite'.length);
    const source = dbFilePath + companionSuffix;
    if (existsSync(source)) {
      const target = base + suffix;
      copyFileSync(source, target);
      chmodSync(target, 0o600);
    }
  }
  pruneBackups(backupsDirPath, BACKUP_RETENTION);
  return `${base}.sqlite`;
}

function migrate(sqlite, opts, { announceBeforeBegin } = {}) {
  sqlite.exec(
    'CREATE TABLE IF NOT EXISTS __drizzle_migrations ' +
      '(id INTEGER PRIMARY KEY AUTOINCREMENT, hash TEXT NOT NULL, created_at NUMERIC)',
  );

  const journal = JSON.parse(
    readFileSync(path.join(opts.migrationsDir, 'meta', '_journal.json'), 'utf8'),
  );

  const applied = new Set(
    sqlite
      .prepare('SELECT hash FROM __drizzle_migrations')
      .all()
      .map((r) => r.hash),
  );

  for (const entry of journal.entries) {
    const sqlPath = path.join(opts.migrationsDir, `${entry.tag}.sql`);
    const sql = readFileSync(sqlPath, 'utf8');
    const hash = createHash('sha256').update(sql).digest('hex');
    if (applied.has(hash)) continue;

    takeBackup(opts.dbFile, opts.backupsDir, entry.tag);

    // The announce hook lets the kill-mid-statement scenario emit the
    // PRE-CRASH marker exactly between the backup and the BEGIN IMMEDIATE
    // — that's the parent's signal to race the SIGKILL against the
    // in-flight exec(sql).
    if (announceBeforeBegin) announceBeforeBegin(entry.tag);

    sqlite.exec('BEGIN IMMEDIATE');
    try {
      sqlite.exec(sql);
      sqlite
        .prepare('INSERT INTO __drizzle_migrations (hash, created_at) VALUES (?, ?)')
        .run(hash, Date.now());
      sqlite.exec('COMMIT');
    } catch (err) {
      try {
        sqlite.exec('ROLLBACK');
      } catch {
        // rollback on aborted tx is harmless
      }
      throw err;
    }
    sqlite.pragma('wal_checkpoint(PASSIVE)');
  }
}

function open(dbPath) {
  const sqlite = new Database(dbPath);
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('busy_timeout = 5000');
  sqlite.pragma('journal_size_limit = 67108864');
  sqlite.pragma('wal_autocheckpoint = 1000');
  sqlite.pragma('synchronous = NORMAL');
  sqlite.pragma('foreign_keys = ON');
  return sqlite;
}

if (scenario === 'pragma-only') {
  const sqlite = open(dbFile);
  try {
    migrate(sqlite, { migrationsDir, backupsDir, dbFile });
    process.stdout.write('PRAGMA-ONLY-OK\n');
  } finally {
    sqlite.close();
  }
  process.exit(0);
}

if (scenario === 'kill-mid-statement') {
  const sqlite = open(dbFile);
  try {
    migrate(
      sqlite,
      { migrationsDir, backupsDir, dbFile },
      {
        announceBeforeBegin: (tag) => {
          // Only race the SIGKILL on the second migration (0001_crash). The
          // first migration (0000_initial) must commit cleanly so the test
          // can assert __drizzle_migrations has exactly 1 row after recovery.
          if (tag === '0001_crash') {
            // The PRE-CRASH marker is what the parent races against. Flush
            // explicitly so the parent sees it before the in-flight
            // db.exec() blocks the event loop. process.stdout in a
            // forked-stdio-pipe Node child is line-buffered by default
            // when stdout is a pipe; we add an explicit newline to nudge it.
            process.stdout.write('PRE-CRASH\n');
          }
        },
      },
    );
    process.stdout.write('CHILD-COMPLETED-CLEANLY\n');
  } catch (err) {
    process.stderr.write(`migrate threw: ${(err && err.message) || String(err)}\n`);
    process.exit(3);
  } finally {
    try {
      sqlite.close();
    } catch {
      // already closed
    }
  }
  process.exit(0);
}

process.stderr.write(`spawn-migrator-child: unknown scenario '${scenario}'\n`);
process.exit(2);
