// DATA-04 verification anchor (Plan 03-05 Task 3): crash a child process
// mid-`db.exec()` during a migration's BEGIN IMMEDIATE transaction, then
// verify recovery semantics — pre-migration backup intact on disk at
// chmod 600, WAL recovery on re-open rolls the in-flight write back, and
// `__drizzle_migrations` reflects exactly the migrations that committed
// cleanly. This is the integration-level companion to migrate.test.ts's
// unit assertions (Task 2).
//
// Test architecture: parent spawns tests/integration/sync/helpers/
// spawn-migrator-child.mjs as a forked child with piped stdout. The child
// runs a 2-migration journal where the first commits quickly and the
// second contains a deliberately slow `INSERT ... WITH RECURSIVE` that
// keeps `db.exec()` (synchronous, native binding) busy for ~500ms. Right
// before the BEGIN IMMEDIATE of the second migration, the child prints
// 'PRE-CRASH\n' to stdout. The parent waits for that marker on the
// child's stdout pipe and then SIGKILLs the child — landing the signal
// during the in-flight write transaction. After the kill, the parent
// re-opens the DB and inspects __drizzle_migrations + the backup file.
//
// vitest.config.ts already runs pool: 'forks' so child_process spawns
// are stable across test files. Suite budget for this file is < 5s on a
// typical macOS laptop.

import { type ChildProcess, type ChildProcessByStdio, spawn } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { openDb } from '../../../src/infrastructure/db/connection.js';
import { type MigrationError, migrate } from '../../../src/infrastructure/db/migrate.js';

vi.setConfig({ testTimeout: 15_000 });

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CHILD_HELPER = path.resolve(HERE, 'helpers', 'spawn-migrator-child.mjs');

// The second migration is intentionally heavy so the SIGKILL race wins
// against the in-flight db.exec(). A recursive CTE materializing 200k
// rows with a 64-byte random blob each runs ~500-1500ms on modern macOS
// hardware — well above the parent's poll interval.
const HEAVY_CRASH_SQL = `
CREATE TABLE crash_target (id INTEGER PRIMARY KEY, payload TEXT);
INSERT INTO crash_target (id, payload)
WITH RECURSIVE cnt(n) AS (
  SELECT 1
  UNION ALL
  SELECT n + 1 FROM cnt WHERE n < 200000
)
SELECT n, hex(randomblob(64)) FROM cnt;
`;

const FIRST_MIGRATION_SQL = 'CREATE TABLE first_marker (id INTEGER PRIMARY KEY);';

interface JournalEntry {
  idx: number;
  when: number;
  tag: string;
  breakpoints: boolean;
}

function writeJournal(migrationsDir: string, tags: string[]): void {
  mkdirSync(path.join(migrationsDir, 'meta'), { recursive: true });
  const entries: JournalEntry[] = tags.map((tag, idx) => ({
    idx,
    when: Date.now(),
    tag,
    breakpoints: true,
  }));
  writeFileSync(
    path.join(migrationsDir, 'meta', '_journal.json'),
    JSON.stringify({ version: '7', dialect: 'sqlite', entries }),
  );
}

function writeSql(migrationsDir: string, tag: string, sql: string): void {
  mkdirSync(migrationsDir, { recursive: true });
  writeFileSync(path.join(migrationsDir, `${tag}.sql`), sql);
}

interface ChildResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  signal: NodeJS.Signals | null;
}

// stdin is 'ignore' (null) per the spawn options; stdout/stderr are piped.
type StdioChild = ChildProcessByStdio<null, Readable, Readable>;

/**
 * Spawn the child helper in the 'kill-mid-statement' scenario and SIGKILL it
 * once 'PRE-CRASH' shows up on stdout. Returns the captured output and the
 * exit signal so the test can assert the race actually fired.
 */
async function runChildAndKillOnPreCrash(env: {
  TEST_DB_FILE: string;
  TEST_MIGRATIONS_DIR: string;
  TEST_BACKUPS_DIR: string;
}): Promise<ChildResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [CHILD_HELPER, 'kill-mid-statement'], {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        ...process.env,
        ...env,
      },
    }) as StdioChild;

    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    let killSent = false;

    child.stdout.on('data', (b: Buffer) => {
      stdoutChunks.push(b);
      if (!killSent && Buffer.concat(stdoutChunks).toString('utf8').includes('PRE-CRASH')) {
        killSent = true;
        // SIGKILL lands while the child's libuv main thread is blocked
        // inside the better-sqlite3 native binding mid-exec(). The OS
        // takes the process down before the next event-loop turn, so
        // BEGIN IMMEDIATE never reaches COMMIT and __drizzle_migrations
        // never sees the second-migration row.
        try {
          child.kill('SIGKILL');
        } catch (err) {
          reject(err);
        }
      }
    });
    child.stderr.on('data', (b: Buffer) => stderrChunks.push(b));

    child.on('error', (err: NodeJS.ErrnoException) => reject(err));
    child.on('close', (code: number | null, signal: NodeJS.Signals | null) => {
      resolve({
        stdout: Buffer.concat(stdoutChunks).toString('utf8'),
        stderr: Buffer.concat(stderrChunks).toString('utf8'),
        exitCode: code,
        signal,
      });
    });
  });
}

async function runChildPragmaOnly(env: {
  TEST_DB_FILE: string;
  TEST_MIGRATIONS_DIR: string;
  TEST_BACKUPS_DIR: string;
}): Promise<ChildResult> {
  return new Promise((resolve, reject) => {
    const child: ChildProcess = spawn(process.execPath, [CHILD_HELPER, 'pragma-only'], {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, ...env },
    });
    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    child.stdout?.on('data', (b: Buffer) => stdoutChunks.push(b));
    child.stderr?.on('data', (b: Buffer) => stderrChunks.push(b));
    child.on('error', (err) => reject(err));
    child.on('close', (code, signal) => {
      resolve({
        stdout: Buffer.concat(stdoutChunks).toString('utf8'),
        stderr: Buffer.concat(stderrChunks).toString('utf8'),
        exitCode: code,
        signal,
      });
    });
  });
}

describe('migration crash recovery (DATA-04 — Pitfall 7)', () => {
  let tmpDir: string;
  let dbFile: string;
  let migrationsDir: string;
  let backupsDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(path.join(tmpdir(), 'rl-migration-crash-'));
    dbFile = path.join(tmpDir, 'db.sqlite');
    migrationsDir = path.join(tmpDir, 'migrations');
    backupsDir = path.join(tmpDir, 'backups');

    // Two-migration journal: first commits cleanly (creates first_marker),
    // second is heavy (200k-row INSERT inside its BEGIN IMMEDIATE so the
    // SIGKILL race wins).
    writeJournal(migrationsDir, ['0000_initial', '0001_crash']);
    writeSql(migrationsDir, '0000_initial', FIRST_MIGRATION_SQL);
    writeSql(migrationsDir, '0001_crash', HEAVY_CRASH_SQL);
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  test('Test 1: SIGKILL mid-`db.exec()` leaves backup intact + __drizzle_migrations rolls back to 1 row', async () => {
    const result = await runChildAndKillOnPreCrash({
      TEST_DB_FILE: dbFile,
      TEST_MIGRATIONS_DIR: migrationsDir,
      TEST_BACKUPS_DIR: backupsDir,
    });

    // Sanity: child reached the PRE-CRASH marker (proves we got to the
    // second migration's BEGIN site before the kill landed).
    expect(result.stdout).toContain('PRE-CRASH');
    // The child did NOT complete cleanly — the SIGKILL is the gating
    // signal. exitCode is null when the process exited via signal on
    // POSIX; signal === 'SIGKILL'.
    expect(result.signal).toBe('SIGKILL');
    expect(result.exitCode).toBeNull();

    // Re-open the DB and inspect state.
    const handle = openDb(dbFile);
    try {
      // first_marker exists because migration 0000_initial committed
      // BEFORE the crash.
      const firstRows = handle.sqlite
        .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='first_marker'")
        .all();
      expect(firstRows).toHaveLength(1);

      // crash_target either does NOT exist (the BEGIN was rolled back via
      // WAL recovery) OR exists but with no rows depending on exactly
      // where SIGKILL landed. Either way, __drizzle_migrations has
      // exactly ONE row (0000_initial). The second migration's hash is
      // NOT in the ledger because the INSERT statement never reached
      // COMMIT.
      const ledger = handle.sqlite.prepare('SELECT hash FROM __drizzle_migrations').all() as Array<{
        hash: string;
      }>;
      expect(ledger).toHaveLength(1);

      // Integrity check on the recovered DB must pass — WAL recovery
      // landed it in a self-consistent state.
      const integrity = handle.sqlite.pragma('integrity_check', { simple: true });
      expect(integrity).toBe('ok');
    } finally {
      handle.sqlite.close();
    }

    // Pre-migration backup for 0001_crash exists with chmod 600.
    const backupFiles = readdirSync(backupsDir);
    const sqliteBackup = backupFiles.find(
      (n) => n.endsWith('.sqlite') && n.includes('-pre-0001_crash'),
    );
    expect(sqliteBackup, 'pre-0001_crash backup missing').toBeDefined();
    if (sqliteBackup !== undefined) {
      const mode = statSync(path.join(backupsDir, sqliteBackup)).mode & 0o777;
      expect(mode).toBe(0o600);
    }
  });

  test('Test 2: re-running the migrator after the crash re-applies the rolled-back migration cleanly', async () => {
    // First: crash the child mid-migration.
    await runChildAndKillOnPreCrash({
      TEST_DB_FILE: dbFile,
      TEST_MIGRATIONS_DIR: migrationsDir,
      TEST_BACKUPS_DIR: backupsDir,
    });

    // Now: rewrite the second migration to be quick (the original 200k-row
    // CTE was a test-only crash trigger; in production the second
    // migration would be a normal small DDL/DML). The hash of 0001_crash
    // is what's tracked in __drizzle_migrations — since the crash
    // prevented the row from landing, the new (different-hash) payload
    // is treated as a fresh pending migration and applies cleanly.
    writeSql(migrationsDir, '0001_crash', 'CREATE TABLE crash_target (id INTEGER PRIMARY KEY);');

    const handle = openDb(dbFile);
    try {
      migrate(handle.sqlite, { migrationsDir, backupsDir, dbFile });

      const ledger = handle.sqlite.prepare('SELECT hash FROM __drizzle_migrations').all();
      expect(ledger).toHaveLength(2);

      const tables = handle.sqlite
        .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
        .all() as Array<{ name: string }>;
      const tableNames = tables.map((t) => t.name);
      expect(tableNames).toContain('first_marker');
      expect(tableNames).toContain('crash_target');

      const integrity = handle.sqlite.pragma('integrity_check', { simple: true });
      expect(integrity).toBe('ok');
    } finally {
      handle.sqlite.close();
    }
  });

  test('Test 3: pre-migration backup file passes PRAGMA integrity_check — Pitfall 7 mitigation verified', async () => {
    await runChildAndKillOnPreCrash({
      TEST_DB_FILE: dbFile,
      TEST_MIGRATIONS_DIR: migrationsDir,
      TEST_BACKUPS_DIR: backupsDir,
    });

    const backupFiles = readdirSync(backupsDir);
    const sqliteBackup = backupFiles.find(
      (n) => n.endsWith('.sqlite') && n.includes('-pre-0001_crash'),
    );
    expect(sqliteBackup, 'backup file not found').toBeDefined();
    if (sqliteBackup === undefined) return;

    const backupPath = path.join(backupsDir, sqliteBackup);
    // Open the backup directly (not via openDb — we don't want to write
    // WAL pragmas to a read-only snapshot). The backup captures the DB
    // state right BEFORE the failed migration began, so it should
    // contain first_marker but not crash_target.
    const backupDb = new Database(backupPath, { readonly: true });
    try {
      const integrity = backupDb.pragma('integrity_check', { simple: true });
      expect(integrity).toBe('ok');

      const tables = backupDb
        .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
        .all() as Array<{ name: string }>;
      const names = tables.map((t) => t.name);
      expect(names).toContain('first_marker');
      expect(names).toContain('__drizzle_migrations');
      // crash_target was created INSIDE the failed transaction — the
      // backup snapshot predates it.
      expect(names).not.toContain('crash_target');

      // The backup's __drizzle_migrations has exactly 1 row (the first
      // migration), matching the state at the moment the backup was
      // taken.
      const ledger = backupDb.prepare('SELECT hash FROM __drizzle_migrations').all();
      expect(ledger).toHaveLength(1);
    } finally {
      backupDb.close();
    }
    // Silence unused-import lint: MigrationError type is imported so the
    // test file can declare typed catches if a future assertion needs it.
    const _typeRef: typeof MigrationError | undefined = undefined;
    expect(_typeRef).toBeUndefined();
  });

  test('Test 4: retention=3 — after 4 successful migrations only 3 backups remain', async () => {
    // Rewrite the journal + .sql payloads as 4 small sequential migrations
    // that all commit cleanly. Each one triggers a takeBackup before
    // BEGIN IMMEDIATE, so after the run we expect 3 (most-recent) backups
    // under backupsDir, not 4.
    writeJournal(migrationsDir, ['0000_a', '0001_b', '0002_c', '0003_d']);
    writeSql(migrationsDir, '0000_a', 'CREATE TABLE a (id INTEGER PRIMARY KEY);');
    writeSql(migrationsDir, '0001_b', 'CREATE TABLE b (id INTEGER PRIMARY KEY);');
    writeSql(migrationsDir, '0002_c', 'CREATE TABLE c (id INTEGER PRIMARY KEY);');
    writeSql(migrationsDir, '0003_d', 'CREATE TABLE d (id INTEGER PRIMARY KEY);');

    // Seed an existing dbFile so 0000_a also triggers a backup (otherwise
    // the first-ever migration on a non-existent dbFile skips backup
    // entirely). With the seed in place, all 4 migrations take a backup,
    // and pruneBackups retains exactly 3.
    const seed = new (await import('better-sqlite3')).default(dbFile);
    seed.exec('CREATE TABLE seed_marker (id INTEGER PRIMARY KEY)');
    seed.close();

    // Use the pragma-only child scenario which simply runs migrate to
    // completion against the fixture; no SIGKILL race here.
    const result = await runChildPragmaOnly({
      TEST_DB_FILE: dbFile,
      TEST_MIGRATIONS_DIR: migrationsDir,
      TEST_BACKUPS_DIR: backupsDir,
    });
    expect(result.exitCode, `child stderr: ${result.stderr}`).toBe(0);

    expect(existsSync(backupsDir)).toBe(true);
    const remaining = readdirSync(backupsDir).filter((n) => n.endsWith('.sqlite'));
    // Exact equality: 4 migrations × 1 backup each − 1 pruned by
    // retention=3 = 3 remaining.
    expect(remaining.length).toBe(3);
  });
});
