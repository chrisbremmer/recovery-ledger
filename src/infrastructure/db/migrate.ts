// Hand-rolled SQLite migrator — the load-bearing crash-recovery chokepoint
// for the on-disk schema (Plan 03-05 Task 2; D-06 + D-07 + D-08 + Pattern 3
// + Pitfall 7 + Pitfall 13).
//
// Why hand-rolled: Drizzle's default migrator (`drizzle-orm/better-sqlite3/
// migrator`) wraps every migration in plain `BEGIN`, which is the SQLite
// default DEFERRED transaction. Pitfall 13 bans DEFERRED for writes because
// a deferred transaction can upgrade mid-flight and defeat `busy_timeout`,
// turning what looks like serialized writes into a race between readers
// promoting to writers. Every write transaction in this project — sync
// upserts, migration applies, decision inserts — uses `BEGIN IMMEDIATE`
// (D-31). The migrator is the highest-stakes write site: a botched schema
// change without crash-safety leaves the decision ledger unrecoverable
// (Pitfall 7). So the migrator wraps each pending migration in `BEGIN
// IMMEDIATE` / `db.exec(sql)` / `COMMIT` (or `ROLLBACK` + structured
// MigrationError on throw) with a chmod-600 pre-migration backup taken
// before the BEGIN. Fails closed, never auto-restores (D-08): the decisions
// table is irreplaceable user data; silent restore could destroy ledger
// entries that landed between the backup and the crash. The doctor command
// (Phase 5) surfaces the backup path as a one-line `cp` remediation.
//
// ADR-0001 compliance: no direct stdout writes / no console calls in this
// file. Errors surface as throws (`MigrationError`); structured logging
// (if any future addition) would route through Pino on stderr per
// src/infrastructure/config/logger.ts.
//
// Gate G compliance: this file imports zero drizzle-orm symbols. It reads
// SQL payloads from disk and runs them through better-sqlite3's
// multi-statement `exec()` directly — the `--> statement-breakpoint`
// markers Drizzle Kit emits are SQL comments and are ignored by `exec()`.
// The migrator does not need Drizzle's type machinery; it operates one
// level below.

import { createHash } from 'node:crypto';
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  unlinkSync,
} from 'node:fs';
import { join } from 'node:path';
import type Database from 'better-sqlite3';

// -----------------------------------------------------------------------------
// MigrationError — mirrors AuthError / WhoopApiError shape from
// src/infrastructure/whoop/errors.ts. Same MR-21 forcing function: the
// tuple is the source of truth, the type + duck-type SET + (future)
// exhaustive formatter switch all derive from it.
// -----------------------------------------------------------------------------

export const MIGRATION_ERROR_KINDS = [
  // Schema state disagrees with __drizzle_migrations (orphaned rows, missing
  // journal entry, missing .sql payload). D-08 surfaces this with the
  // most-recent backup path so the user can restore manually if needed.
  'inconsistent_state',
  // BEGIN IMMEDIATE → exec(sql) threw → ROLLBACK. WAL recovery on next open
  // is consistent with __drizzle_migrations (the failed migration was
  // never recorded). Backup intact on disk.
  'apply_failed',
] as const;

export type MigrationErrorKind = (typeof MIGRATION_ERROR_KINDS)[number];

const MIGRATION_ERROR_KINDS_SET: ReadonlySet<string> = new Set(MIGRATION_ERROR_KINDS);

export interface MigrationErrorInit {
  kind: MigrationErrorKind;
  /** Absolute path to the pre-migration backup (or null when no backup was
   *  taken — first-ever migration on an empty $HOME, or `:memory:` DB). */
  backupPath: string | null;
  /** Tag of the most-recent migration that completed cleanly before this
   *  one threw; null when the failure is at startup before any apply. */
  latestSafeMigration: string | null;
  /** Short human-readable detail; surfaces into the Error message. */
  detail?: string;
  /** Original cause; preserved through the ES2022 Error `cause` option so
   *  the Phase 1 sanitize.ts walker can traverse it. Mirrors AuthError. */
  cause?: unknown;
}

export class MigrationError extends Error {
  readonly kind: MigrationErrorKind;
  readonly backupPath: string | null;
  readonly latestSafeMigration: string | null;
  readonly detail?: string;

  constructor(init: MigrationErrorInit) {
    // Same conditional-spread shape as AuthError: only pass the second arg
    // when cause is defined so we do not synthesize a `{ cause: undefined }`
    // literal that diverges from the AuthError carrier shape.
    super(init.detail ?? init.kind, init.cause === undefined ? undefined : { cause: init.cause });
    this.kind = init.kind;
    this.backupPath = init.backupPath;
    this.latestSafeMigration = init.latestSafeMigration;
    if (init.detail !== undefined) {
      this.detail = init.detail;
    }
    this.name = 'MigrationError';
  }
}

/**
 * Duck-type guard for MigrationError. Mirrors isAuthError: `instanceof
 * MigrationError` is unreliable under vi.resetModules() (two module-graph
 * instances of migrate.ts produce different class identities for the same
 * logical type). The guard checks `name === 'MigrationError'` plus `kind`
 * membership in the tuple, so a structurally-equivalent error from a
 * different module-graph copy of this file still narrows correctly.
 */
export function isMigrationError(err: unknown): err is MigrationError {
  if (typeof err !== 'object' || err === null) return false;
  const e = err as { name?: unknown; kind?: unknown };
  return (
    e.name === 'MigrationError' &&
    typeof e.kind === 'string' &&
    MIGRATION_ERROR_KINDS_SET.has(e.kind)
  );
}

// -----------------------------------------------------------------------------
// migrate() — the public entry point. Reads the canonical migration list
// from meta/_journal.json (NOT a directory scan — Drizzle Kit owns the
// order via the journal); hashes each .sql payload (sha256, fed into the
// __drizzle_migrations ledger so re-runs are no-ops); applies the pending
// ones in BEGIN IMMEDIATE transactions with pre-migration backups.
// -----------------------------------------------------------------------------

export interface MigrateOptions {
  /** Directory holding `0000_*.sql`, `meta/_journal.json`, and
   *  `meta/0000_snapshot.json`. In production this resolves to
   *  `src/infrastructure/db/migrations` (or `dist/.../migrations` after
   *  build); the migrator owns path resolution per A1 in 03-RESEARCH.md
   *  (computed from import.meta.url at the bootstrap layer). */
  migrationsDir: string;
  /** Backup directory; `~/.recovery-ledger/backups/` in production. The
   *  pre-migration `.sqlite` + `-wal` + `-shm` copies land here at chmod
   *  600 with 3-most-recent retention (D-07). */
  backupsDir: string;
  /** Absolute path to the live SQLite file. Used for the backup copy; the
   *  caller passes the same `sqlite` handle opened against this path. For
   *  `:memory:` databases this is the literal string `':memory:'` and the
   *  backup step is skipped (nothing to copy). */
  dbFile: string;
}

interface JournalEntry {
  idx: number;
  when: number;
  tag: string;
  breakpoints: boolean;
}

interface Journal {
  entries: JournalEntry[];
}

interface AppliedMigrationRow {
  hash: string;
}

/**
 * Apply pending migrations from `opts.migrationsDir` against `sqlite`.
 *
 * Algorithm (Pattern 3 / D-06):
 *   1. Ensure __drizzle_migrations exists. Shape per A2 in 03-RESEARCH.md.
 *   2. Read meta/_journal.json (canonical list, not a glob).
 *   3. Compute pending set = journal entries whose .sql sha256 hash is NOT
 *      in __drizzle_migrations.hash.
 *   4. For each pending entry, in order:
 *      a. Take a pre-migration backup of the .sqlite + -wal + -shm trio.
 *      b. BEGIN IMMEDIATE.
 *      c. db.exec(sql) (multi-statement-aware).
 *      d. INSERT INTO __drizzle_migrations (hash, created_at) VALUES (?, ?).
 *      e. COMMIT. On any throw: ROLLBACK + throw MigrationError({apply_failed}).
 *      f. PRAGMA wal_checkpoint(PASSIVE) so a follow-up backup sees the WAL
 *         folded.
 *   5. Final consistency check: row count in __drizzle_migrations matches
 *      the number of journal entries seen (already-applied + just-applied).
 *      Mismatch surfaces as MigrationError({inconsistent_state}) with the
 *      most-recent backup path.
 *
 * Throws MigrationError on any failure. Caller decides how to surface
 * (doctor → fail probe; CLI → non-zero exit + remediation; MCP → sanitized
 * error response).
 */
export function migrate(sqlite: Database.Database, opts: MigrateOptions): void {
  // Step 1: ledger table. Idempotent.
  sqlite.exec(
    'CREATE TABLE IF NOT EXISTS __drizzle_migrations ' +
      '(id INTEGER PRIMARY KEY AUTOINCREMENT, hash TEXT NOT NULL, created_at NUMERIC)',
  );

  // Step 2: read journal.
  const journalPath = join(opts.migrationsDir, 'meta', '_journal.json');
  let journal: Journal;
  try {
    const raw = readFileSync(journalPath, 'utf8');
    const parsed = JSON.parse(raw) as unknown;
    if (
      typeof parsed !== 'object' ||
      parsed === null ||
      !Array.isArray((parsed as { entries?: unknown }).entries)
    ) {
      throw new Error('journal shape invalid — entries[] missing');
    }
    journal = parsed as Journal;
  } catch (err) {
    throw new MigrationError({
      kind: 'inconsistent_state',
      backupPath: null,
      latestSafeMigration: null,
      detail: 'journal parse failed',
      cause: err,
    });
  }

  // Step 3: applied set.
  const appliedRows = sqlite
    .prepare('SELECT hash FROM __drizzle_migrations')
    .all() as AppliedMigrationRow[];
  const appliedHashes = new Set(appliedRows.map((r) => r.hash));

  // Step 4: apply pending.
  let latestSafeMigration: string | null = null;
  let mostRecentBackup: string | null = null;
  for (const entry of journal.entries) {
    const sqlPath = join(opts.migrationsDir, `${entry.tag}.sql`);
    if (!existsSync(sqlPath)) {
      throw new MigrationError({
        kind: 'inconsistent_state',
        backupPath: mostRecentBackup,
        latestSafeMigration,
        detail: `journal entry tag ${entry.tag} has no .sql payload on disk`,
      });
    }

    const sql = readFileSync(sqlPath, 'utf8');
    const hash = createHash('sha256').update(sql).digest('hex');

    if (appliedHashes.has(hash)) {
      latestSafeMigration = entry.tag;
      continue;
    }

    // Step 4a: pre-migration backup. Empty string when no backup taken
    // (first-ever migration on a fresh $HOME, or `:memory:` DB). Threaded
    // through any subsequent MigrationError for the doctor remediation.
    const backupResult = takeBackup(opts.dbFile, opts.backupsDir, entry.tag);
    const backupPathForError = backupResult === '' ? null : backupResult;
    if (backupPathForError !== null) {
      mostRecentBackup = backupPathForError;
    }

    // Step 4b–e: BEGIN IMMEDIATE / exec / record / COMMIT or ROLLBACK.
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
        // ROLLBACK on a transaction that already aborted is harmless;
        // swallow so we surface the original cause, not a secondary
        // SQLITE_BUSY / no-transaction-in-progress noise.
      }
      throw new MigrationError({
        kind: 'apply_failed',
        backupPath: backupPathForError,
        latestSafeMigration: entry.tag,
        cause: err,
      });
    }

    // Step 4f: fold WAL back so a follow-up backup sees the migration on
    // disk in the main DB file, not just in the WAL companion (D-07
    // / Specifics line 242).
    sqlite.pragma('wal_checkpoint(PASSIVE)');
    latestSafeMigration = entry.tag;
  }

  // Step 5: consistency check.
  const finalCountRow = sqlite.prepare('SELECT COUNT(*) AS c FROM __drizzle_migrations').get() as {
    c: number;
  };
  if (finalCountRow.c !== journal.entries.length) {
    throw new MigrationError({
      kind: 'inconsistent_state',
      backupPath: mostRecentBackup,
      latestSafeMigration,
      detail: `__drizzle_migrations has ${finalCountRow.c} rows; journal has ${journal.entries.length}`,
    });
  }
}

// -----------------------------------------------------------------------------
// Helpers (private). Exposed via the migrate() public surface only.
// -----------------------------------------------------------------------------

const BACKUP_SUFFIXES = ['.sqlite', '.sqlite-wal', '.sqlite-shm'] as const;
const BACKUP_RETENTION = 3;

/**
 * Take a pre-migration backup of `dbFile` + its `-wal` + `-shm` companions
 * into `backupsDir`. Returns the backup `.sqlite` path (load-bearing for
 * the MigrationError surface) or `''` when no backup was taken (first-ever
 * migration with no prior file, or `:memory:` DB).
 *
 * D-07 contract:
 *   - mkdir backupsDir with mode 0700 (parent is the same dir as
 *     tokens.json; matches the Phase 2 file-fallback chmod posture).
 *   - Filesystem-safe ISO timestamp + tag in the name so the doctor
 *     remediation can identify which migration each backup precedes.
 *   - Mode 0600 on every copied file (Security Mistakes table in PITFALLS.md).
 *   - Retention 3 most-recent backups, unlinking the `.sqlite` + `-wal` +
 *     `-shm` companions of each older entry.
 */
function takeBackup(dbFile: string, backupsDir: string, tag: string): string {
  if (dbFile === ':memory:') {
    return '';
  }
  if (!existsSync(dbFile)) {
    // First-ever migration on a fresh $HOME — no .sqlite to copy. No
    // backup is fine: the migration starts from an empty DB, and a crash
    // mid-apply leaves an empty DB that the next run will re-apply
    // cleanly via the __drizzle_migrations ledger.
    return '';
  }

  mkdirSync(backupsDir, { recursive: true, mode: 0o700 });

  // Filesystem-safe timestamp: replace `:` and `.` with `-` so the name
  // is valid on all three target platforms (macOS, Linux, Windows-ish via
  // WSL). The tag is the journal entry's `tag` (e.g., '0000_initial').
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const base = join(backupsDir, `db.${ts}-pre-${tag}`);

  // For each suffix, derive the on-disk companion path from dbFile. The
  // `.sqlite` suffix corresponds to dbFile itself; `-wal` / `-shm`
  // companions append the suffix tail to dbFile (which already ends in
  // `.sqlite`).
  for (const suffix of BACKUP_SUFFIXES) {
    const companionSuffix = suffix.slice('.sqlite'.length); // '' | '-wal' | '-shm'
    const source = dbFile + companionSuffix;
    if (existsSync(source)) {
      const target = base + suffix;
      copyFileSync(source, target);
      chmodSync(target, 0o600);
    }
  }

  pruneBackups(backupsDir, BACKUP_RETENTION);
  return `${base}.sqlite`;
}

/**
 * Keep the `keep` most-recent `.sqlite` backup files (by mtime). Unlinks
 * older entries along with their `.sqlite-wal` + `.sqlite-shm` companions.
 * Missing companion files are fine — the WAL / shm may not exist on a
 * checkpointed-clean DB.
 */
export function pruneBackups(backupsDir: string, keep: number): void {
  if (!existsSync(backupsDir)) return;

  const files = readdirSync(backupsDir)
    .filter((name) => name.endsWith('.sqlite'))
    .map((name) => ({ name, mtime: statSync(join(backupsDir, name)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime);

  for (const { name } of files.slice(keep)) {
    const baseName = name.slice(0, -'.sqlite'.length);
    for (const suffix of BACKUP_SUFFIXES) {
      const targetPath = join(backupsDir, baseName + suffix);
      try {
        unlinkSync(targetPath);
      } catch {
        // Missing companion is expected — WAL / shm may not exist on a
        // checkpointed-clean DB. Swallow ENOENT silently.
      }
    }
  }
}
