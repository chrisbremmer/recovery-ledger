// SYNC-06 verification anchor (Plan 03-05 Task 3): after a successful
// sync (or migrator run), `PRAGMA wal_checkpoint(TRUNCATE)` folds the
// SQLite WAL back into the main `.sqlite` file and drops `db.sqlite-wal`
// to zero bytes. This is the contract D-32 promises — Plan 03-11 will
// call wal_checkpoint(TRUNCATE) at the end of every successful or partial
// sync, and the doctor probe (Phase 5) will warn if the WAL exceeds
// 32 MB.
//
// Coverage:
//   - All six D-30 pragmas land on a real disk-backed file (mirror of
//     connection.test.ts but on the integration boundary).
//   - Writing data populates the WAL companion file (size > 0).
//   - wal_checkpoint(TRUNCATE) drops the WAL companion to 0 bytes and
//     returns the documented `(busy, log_frames, checkpointed_frames)`
//     shape (busy === 0 on a quiet DB).
//   - Migrator on the real Plan 03-02 schema applies exactly 1 row to
//     __drizzle_migrations; second run is a no-op.

import { mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { type OpenDbResult, openDb } from '../../../src/infrastructure/db/connection.js';
import { migrate } from '../../../src/infrastructure/db/migrate.js';

vi.setConfig({ testTimeout: 10_000 });

// Resolve the real Plan 03-02 migrations directory. The migrator parses
// meta/_journal.json verbatim from this path.
const REPO_ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..', '..');
const REAL_MIGRATIONS_DIR = path.resolve(REPO_ROOT, 'src', 'infrastructure', 'db', 'migrations');

describe('SYNC-06 — wal_checkpoint(TRUNCATE) folds WAL back; six D-30 pragmas land', () => {
  let tmpDir: string;
  let dbFile: string;
  let backupsDir: string;
  let handle: OpenDbResult | null = null;

  beforeEach(() => {
    tmpDir = mkdtempSync(path.join(tmpdir(), 'rl-pragma-roundtrip-'));
    dbFile = path.join(tmpDir, 'db.sqlite');
    backupsDir = path.join(tmpDir, 'backups');
    handle = null;
  });

  afterEach(() => {
    if (handle !== null) {
      try {
        handle.sqlite.close();
      } catch {
        // already closed
      }
      handle = null;
    }
    rmSync(tmpDir, { recursive: true, force: true });
  });

  test('Test 1: all six D-30 pragmas hold on a real disk-backed file (journal_mode=wal)', () => {
    handle = openDb(dbFile);
    expect(handle.sqlite.pragma('journal_mode', { simple: true })).toBe('wal');
    expect(handle.sqlite.pragma('busy_timeout', { simple: true })).toBe(5000);
    expect(handle.sqlite.pragma('journal_size_limit', { simple: true })).toBe(67108864);
    expect(handle.sqlite.pragma('wal_autocheckpoint', { simple: true })).toBe(1000);
    expect(handle.sqlite.pragma('synchronous', { simple: true })).toBe(1);
    expect(handle.sqlite.pragma('foreign_keys', { simple: true })).toBe(1);
  });

  test('Test 2: writes populate db.sqlite-wal (size > 0 after upsert into cycles)', () => {
    handle = openDb(dbFile);
    migrate(handle.sqlite, {
      migrationsDir: REAL_MIGRATIONS_DIR,
      backupsDir,
      dbFile,
    });

    // Insert one cycles row directly via raw SQL. The schema requires a
    // SCORED state plus the raw_json column; we provide minimal valid
    // values matching the Plan 03-02 schema shape.
    const insert = handle.sqlite.prepare(
      'INSERT INTO cycles (id, user_id, created_at, updated_at, start, timezone_offset, score_state, raw_json) ' +
        'VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    );
    insert.run(
      1,
      42,
      '2026-05-01T00:00:00.000Z',
      '2026-05-01T01:00:00.000Z',
      '2026-04-30T07:00:00.000Z',
      '-08:00',
      // DBIN-03 (#77): use PENDING_SCORE so we don't need to fabricate
      // score columns. This test exercises WAL behavior, not score_state.
      'PENDING_SCORE',
      '{"id":1}',
    );

    // The WAL companion file should now exist with size > 0. Better-
    // sqlite3 writes to the WAL on COMMIT under WAL mode; the auto-
    // checkpoint threshold is 1000 frames, so a single insert sits in
    // the WAL until we explicitly checkpoint.
    const walPath = `${dbFile}-wal`;
    const walStat = statSync(walPath);
    expect(walStat.size).toBeGreaterThan(0);
  });

  test('Test 3: wal_checkpoint(TRUNCATE) drops db.sqlite-wal size to 0', () => {
    handle = openDb(dbFile);
    migrate(handle.sqlite, {
      migrationsDir: REAL_MIGRATIONS_DIR,
      backupsDir,
      dbFile,
    });

    // Generate some WAL frames via inserts.
    const insert = handle.sqlite.prepare(
      'INSERT INTO cycles (id, user_id, created_at, updated_at, start, timezone_offset, score_state, raw_json) ' +
        'VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    );
    for (let id = 100; id < 110; id += 1) {
      insert.run(
        id,
        42,
        '2026-05-01T00:00:00.000Z',
        '2026-05-01T01:00:00.000Z',
        '2026-04-30T07:00:00.000Z',
        '-08:00',
        // DBIN-03 (#77): PENDING_SCORE — WAL behavior is independent of score state.
        'PENDING_SCORE',
        `{"id":${id}}`,
      );
    }

    const walPath = `${dbFile}-wal`;
    // Sanity: WAL is non-empty before checkpoint.
    expect(statSync(walPath).size).toBeGreaterThan(0);

    // wal_checkpoint(TRUNCATE) returns `[{busy, log, checkpointed}]` per
    // better-sqlite3 (https://www.sqlite.org/pragma.html#pragma_wal_checkpoint).
    // busy === 0 on a quiet DB; log + checkpointed reflect frames moved.
    const result = handle.sqlite.pragma('wal_checkpoint(TRUNCATE)') as Array<{
      busy: number;
      log: number;
      checkpointed: number;
    }>;
    expect(Array.isArray(result)).toBe(true);
    expect(result[0]?.busy).toBe(0);

    // After TRUNCATE, the WAL file is reset to 0 bytes — this is the
    // load-bearing SYNC-06 assertion (D-32). The next write will
    // re-grow it; what matters is that the fold-back is byte-exact.
    expect(statSync(walPath).size).toBe(0);
  });

  test('Test 4: migrator applies the current migration set to __drizzle_migrations (Plan 03-02 + DBIN-03)', () => {
    handle = openDb(dbFile);
    migrate(handle.sqlite, {
      migrationsDir: REAL_MIGRATIONS_DIR,
      backupsDir,
      dbFile,
    });

    const rows = handle.sqlite.prepare('SELECT hash FROM __drizzle_migrations').all() as Array<{
      hash: string;
    }>;
    // DBIN-03 (#77): added 0001_score_state_check_constraints; assertion
    // now counts journal entries (= 2 as of v1.1). Originally Plan 03-02
    // expected exactly 1 — kept the spirit of the test (every entry has a
    // sha256 hash) while allowing the journal to grow.
    expect(rows.length).toBeGreaterThanOrEqual(2);
    for (const row of rows) {
      expect(row.hash).toMatch(/^[a-f0-9]{64}$/);
    }
  });

  test('Test 5: re-running migrate against the same DB is a no-op (hash match)', () => {
    handle = openDb(dbFile);
    migrate(handle.sqlite, {
      migrationsDir: REAL_MIGRATIONS_DIR,
      backupsDir,
      dbFile,
    });

    const firstCount = (
      handle.sqlite.prepare('SELECT COUNT(*) AS n FROM __drizzle_migrations').get() as { n: number }
    ).n;

    // Second call: no-op. The journal hash matches the recorded one(s),
    // so the loop skips the apply and exits cleanly. __drizzle_migrations
    // row count stays the same regardless of how many migrations are in
    // the journal.
    migrate(handle.sqlite, {
      migrationsDir: REAL_MIGRATIONS_DIR,
      backupsDir,
      dbFile,
    });

    const rows = handle.sqlite.prepare('SELECT hash FROM __drizzle_migrations').all();
    expect(rows).toHaveLength(firstCount);
  });
});
