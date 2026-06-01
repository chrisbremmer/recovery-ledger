// Migrator unit tests (Plan 03-05 Task 2). Covers the happy path
// (idempotent apply, no-op on re-run), the sad paths (bad SQL → rollback;
// missing journal / payload → inconsistent_state), the MigrationError
// shape contract, and the backup helpers (chmod 600, retention 3).
//
// Integration-level crash-mid-statement testing lives in
// tests/integration/sync/migration-crash.test.ts (Task 3); this file uses
// `:memory:` SQLite + temp-dir fixtures and stays under 1s.

import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
// ARCH-04 (#92): MigrationError contract from domain; migrator implementation
// stays in infrastructure.
import { isMigrationError, type MigrationError } from '../../domain/errors/migration.js';
import { migrate, pruneBackups } from './migrate.js';

interface JournalEntry {
  idx: number;
  when: number;
  tag: string;
  breakpoints: boolean;
}

function writeJournal(migrationsDir: string, entries: Array<{ tag: string; idx?: number }>): void {
  mkdirSync(path.join(migrationsDir, 'meta'), { recursive: true });
  const journal = {
    version: '7',
    dialect: 'sqlite',
    entries: entries.map(
      (e, i): JournalEntry => ({
        idx: e.idx ?? i,
        when: Date.now(),
        tag: e.tag,
        breakpoints: true,
      }),
    ),
  };
  writeFileSync(path.join(migrationsDir, 'meta', '_journal.json'), JSON.stringify(journal));
}

function writeMigrationSql(migrationsDir: string, tag: string, sql: string): void {
  mkdirSync(migrationsDir, { recursive: true });
  writeFileSync(path.join(migrationsDir, `${tag}.sql`), sql);
}

describe('migrate — happy path + idempotency', () => {
  let tmpDir: string;
  let migrationsDir: string;
  let backupsDir: string;
  let sqlite: Database.Database;

  beforeEach(() => {
    tmpDir = mkdtempSync(path.join(tmpdir(), 'rl-migrate-happy-'));
    migrationsDir = path.join(tmpDir, 'migrations');
    backupsDir = path.join(tmpDir, 'backups');
    sqlite = new Database(':memory:');
  });

  afterEach(() => {
    try {
      sqlite.close();
    } catch {
      // already closed
    }
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('Test 1: first-run on empty DB applies one migration and records it in __drizzle_migrations', () => {
    writeJournal(migrationsDir, [{ tag: '0000_initial' }]);
    writeMigrationSql(migrationsDir, '0000_initial', 'CREATE TABLE foo (id INTEGER PRIMARY KEY);');

    migrate(sqlite, { migrationsDir, backupsDir, dbFile: ':memory:' });

    const rows = sqlite.prepare('SELECT hash FROM __drizzle_migrations').all() as Array<{
      hash: string;
    }>;
    expect(rows).toHaveLength(1);
    expect(rows[0]?.hash).toMatch(/^[a-f0-9]{64}$/); // sha256 hex

    // The table the migration created is queryable.
    const fooCount = sqlite.prepare('SELECT COUNT(*) AS c FROM foo').get() as { c: number };
    expect(fooCount.c).toBe(0);
  });

  it('Test 2: second run on the same DB is a no-op — hash match skips the apply', () => {
    writeJournal(migrationsDir, [{ tag: '0000_initial' }]);
    writeMigrationSql(migrationsDir, '0000_initial', 'CREATE TABLE foo (id INTEGER PRIMARY KEY);');

    migrate(sqlite, { migrationsDir, backupsDir, dbFile: ':memory:' });
    migrate(sqlite, { migrationsDir, backupsDir, dbFile: ':memory:' });

    const rows = sqlite.prepare('SELECT hash FROM __drizzle_migrations').all();
    expect(rows).toHaveLength(1);
  });

  it('Test 2b: two sequential migrations both apply on first run; second run is no-op', () => {
    writeJournal(migrationsDir, [{ tag: '0000_first' }, { tag: '0001_second' }]);
    writeMigrationSql(migrationsDir, '0000_first', 'CREATE TABLE a (id INTEGER PRIMARY KEY);');
    writeMigrationSql(migrationsDir, '0001_second', 'CREATE TABLE b (id INTEGER PRIMARY KEY);');

    migrate(sqlite, { migrationsDir, backupsDir, dbFile: ':memory:' });
    let rows = sqlite.prepare('SELECT hash FROM __drizzle_migrations').all();
    expect(rows).toHaveLength(2);

    migrate(sqlite, { migrationsDir, backupsDir, dbFile: ':memory:' });
    rows = sqlite.prepare('SELECT hash FROM __drizzle_migrations').all();
    expect(rows).toHaveLength(2);
  });
});

describe('migrate — sad paths + MigrationError shape', () => {
  let tmpDir: string;
  let migrationsDir: string;
  let backupsDir: string;
  let sqlite: Database.Database;

  beforeEach(() => {
    tmpDir = mkdtempSync(path.join(tmpdir(), 'rl-migrate-sad-'));
    migrationsDir = path.join(tmpDir, 'migrations');
    backupsDir = path.join(tmpDir, 'backups');
    sqlite = new Database(':memory:');
  });

  afterEach(() => {
    try {
      sqlite.close();
    } catch {
      // already closed
    }
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('Test 3: bad SQL throws MigrationError({apply_failed}) and __drizzle_migrations stays empty after ROLLBACK', () => {
    writeJournal(migrationsDir, [{ tag: '0000_bad' }]);
    // SQLite is permissive about column types (it stores them as
    // affinity hints, not strict types). Use a genuine SQL syntax error
    // so sqlite.exec() raises SQLITE_ERROR reliably.
    writeMigrationSql(migrationsDir, '0000_bad', 'XYZGARBAGE this is not valid sql;');

    let thrown: unknown;
    try {
      migrate(sqlite, { migrationsDir, backupsDir, dbFile: ':memory:' });
    } catch (err) {
      thrown = err;
    }

    expect(isMigrationError(thrown)).toBe(true);
    const err = thrown as MigrationError;
    expect(err.kind).toBe('apply_failed');
    // The failing migration is NOT a "safe" tag — nothing has committed,
    // so latestSafeMigration is null (no prior migration applied cleanly).
    expect(err.latestSafeMigration).toBeNull();
    // ROLLBACK fired — __drizzle_migrations table exists (created in step 1)
    // but holds zero rows.
    const rows = sqlite.prepare('SELECT hash FROM __drizzle_migrations').all();
    expect(rows).toHaveLength(0);
  });

  it('Test 3b: when a later migration fails, latestSafeMigration is the last COMMITTED tag (not the failing one)', () => {
    // First migration is well-formed and will COMMIT; second migration has
    // bad SQL and will ROLLBACK. latestSafeMigration must point at the
    // first (committed) tag, not the failing second tag.
    writeJournal(migrationsDir, [{ tag: '0000_good' }, { tag: '0001_bad' }]);
    writeMigrationSql(migrationsDir, '0000_good', 'CREATE TABLE foo (id INTEGER PRIMARY KEY);');
    writeMigrationSql(migrationsDir, '0001_bad', 'XYZGARBAGE this is not valid sql;');

    let thrown: unknown;
    try {
      migrate(sqlite, { migrationsDir, backupsDir, dbFile: ':memory:' });
    } catch (err) {
      thrown = err;
    }

    expect(isMigrationError(thrown)).toBe(true);
    const err = thrown as MigrationError;
    expect(err.kind).toBe('apply_failed');
    expect(err.latestSafeMigration).toBe('0000_good');
  });

  it('Test 4: MigrationError shape matches the AuthError mirror contract', () => {
    writeJournal(migrationsDir, [{ tag: '0000_bad' }]);
    writeMigrationSql(migrationsDir, '0000_bad', 'XYZGARBAGE this is not valid sql;');

    let thrown: unknown;
    try {
      migrate(sqlite, { migrationsDir, backupsDir, dbFile: ':memory:' });
    } catch (err) {
      thrown = err;
    }

    expect(isMigrationError(thrown)).toBe(true);
    const err = thrown as MigrationError;
    expect(err.name).toBe('MigrationError');
    expect(['inconsistent_state', 'apply_failed']).toContain(err.kind);
    expect(typeof err.message).toBe('string');
    // The original SQLite error is preserved in the cause chain so the
    // sanitizer pipeline can traverse it.
    expect(err.cause).toBeDefined();
  });

  it('Test 5: missing journal file → MigrationError({inconsistent_state})', () => {
    // migrationsDir exists but meta/_journal.json does not.
    mkdirSync(migrationsDir, { recursive: true });

    let thrown: unknown;
    try {
      migrate(sqlite, { migrationsDir, backupsDir, dbFile: ':memory:' });
    } catch (err) {
      thrown = err;
    }

    expect(isMigrationError(thrown)).toBe(true);
    expect((thrown as MigrationError).kind).toBe('inconsistent_state');
    expect((thrown as MigrationError).detail).toBe('journal parse failed');
  });

  it('Test 6: journal entry references a .sql tag with no on-disk payload → journal_missing_payload w/ tag in detail', () => {
    // #25 — split from inconsistent_state so the remediation message can
    // distinguish "DB is fine, restore the missing file" from "DB state
    // is ambiguous, restore from backup."
    writeJournal(migrationsDir, [{ tag: '0042_ghost' }]);
    // No `0042_ghost.sql` written.

    let thrown: unknown;
    try {
      migrate(sqlite, { migrationsDir, backupsDir, dbFile: ':memory:' });
    } catch (err) {
      thrown = err;
    }

    expect(isMigrationError(thrown)).toBe(true);
    const err = thrown as MigrationError;
    expect(err.kind).toBe('journal_missing_payload');
    expect(err.detail).toContain('0042_ghost');
  });
});

describe('pruneBackups — retention of 3 most-recent .sqlite files', () => {
  let backupsDir: string;

  beforeEach(() => {
    backupsDir = mkdtempSync(path.join(tmpdir(), 'rl-prune-'));
  });

  afterEach(() => {
    rmSync(backupsDir, { recursive: true, force: true });
  });

  it('Test 7: 5 backups → pruneBackups(dir, 3) deletes the 2 oldest plus their -wal / -shm companions', () => {
    // Create 5 backup triples with staggered mtimes (older → newer). Use
    // ISO-timestamp filenames that match what `takeBackup` actually produces;
    // the sort key in `pruneBackups` is mtime, but the test names should
    // mirror real-world shape rather than alpha-sortable shorthand so a
    // future change to a name-based sort (or a name-collision fix) is
    // exercised against the actual filename pattern.
    const names = [
      '2026-05-20T10-00-00Z',
      '2026-05-20T11-00-00Z',
      '2026-05-20T12-00-00Z',
      '2026-05-20T13-00-00Z',
      '2026-05-20T14-00-00Z',
    ];
    for (let i = 0; i < names.length; i += 1) {
      const name = names[i];
      if (name === undefined) continue;
      const base = path.join(backupsDir, name);
      writeFileSync(`${base}.sqlite`, 'main');
      writeFileSync(`${base}.sqlite-wal`, 'wal');
      writeFileSync(`${base}.sqlite-shm`, 'shm');
      // Stagger atime/mtime so each subsequent file is "newer" by a clear
      // margin. Use Date with second-level granularity to dodge filesystem
      // mtime rounding on some platforms.
      const mtime = new Date(Date.now() - (names.length - i) * 1000);
      // Apply mtime via utimesSync so pruneBackups' mtime-desc sort can
      // distinguish the staggered ages reliably across filesystems.
      utimesSync(`${base}.sqlite`, mtime, mtime);
    }

    pruneBackups(backupsDir, 3);

    const remaining = readdirSync(backupsDir).filter((n) => n.endsWith('.sqlite'));
    expect(remaining).toHaveLength(3);
    // The three newest survive; the two oldest (plus companions) are gone.
    const survivors = [`${names[2]}.sqlite`, `${names[3]}.sqlite`, `${names[4]}.sqlite`];
    expect(remaining.sort()).toEqual(survivors.sort());
    const evictedBase = names[0];
    if (evictedBase !== undefined) {
      expect(existsSync(path.join(backupsDir, `${evictedBase}.sqlite`))).toBe(false);
      expect(existsSync(path.join(backupsDir, `${evictedBase}.sqlite-wal`))).toBe(false);
      expect(existsSync(path.join(backupsDir, `${evictedBase}.sqlite-shm`))).toBe(false);
    }
    const secondEvictedBase = names[1];
    if (secondEvictedBase !== undefined) {
      expect(existsSync(path.join(backupsDir, `${secondEvictedBase}.sqlite-wal`))).toBe(false);
    }
  });
});

describe('takeBackup — chmod 600 + WAL / SHM companions', () => {
  let tmpDir: string;
  let migrationsDir: string;
  let backupsDir: string;
  let dbFile: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(path.join(tmpdir(), 'rl-takebackup-'));
    migrationsDir = path.join(tmpDir, 'migrations');
    backupsDir = path.join(tmpDir, 'backups');
    dbFile = path.join(tmpDir, 'db.sqlite');
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('Test 8: backup .sqlite + -wal + -shm copies land at chmod 600', () => {
    // Two-phase setup: first open a real Database against dbFile and
    // commit some content (this materializes a valid SQLite file plus
    // its -wal companion on disk). Then close the handle, open a
    // fresh one, and run migrate — at that point takeBackup sees real
    // SQLite bytes to copy, not synthetic test fixtures that would
    // make better-sqlite3 reject the file as "not a database."
    {
      const seed = new Database(dbFile);
      seed.pragma('journal_mode = WAL');
      seed.exec('CREATE TABLE seed_marker (id INTEGER PRIMARY KEY);');
      seed.prepare('INSERT INTO seed_marker (id) VALUES (?)').run(1);
      seed.close();
    }

    writeJournal(migrationsDir, [{ tag: '0000_initial' }]);
    writeMigrationSql(migrationsDir, '0000_initial', 'CREATE TABLE x (id INTEGER PRIMARY KEY);');

    const sqlite = new Database(dbFile);
    sqlite.pragma('journal_mode = WAL');
    try {
      migrate(sqlite, { migrationsDir, backupsDir, dbFile });
    } finally {
      sqlite.close();
    }

    const entries = readdirSync(backupsDir);
    const sqliteBackup = entries.find((n) => n.endsWith('.sqlite'));
    expect(sqliteBackup, 'no .sqlite backup created').toBeDefined();
    if (sqliteBackup === undefined) return;

    const mode = statSync(path.join(backupsDir, sqliteBackup)).mode & 0o777;
    expect(mode).toBe(0o600);

    // Companion -wal + -shm copies also exist at chmod 600.
    const walBackup = entries.find((n) => n.endsWith('.sqlite-wal'));
    const shmBackup = entries.find((n) => n.endsWith('.sqlite-shm'));
    expect(walBackup).toBeDefined();
    expect(shmBackup).toBeDefined();
    if (walBackup !== undefined) {
      expect(statSync(path.join(backupsDir, walBackup)).mode & 0o777).toBe(0o600);
    }
    if (shmBackup !== undefined) {
      expect(statSync(path.join(backupsDir, shmBackup)).mode & 0o777).toBe(0o600);
    }
  });
});
