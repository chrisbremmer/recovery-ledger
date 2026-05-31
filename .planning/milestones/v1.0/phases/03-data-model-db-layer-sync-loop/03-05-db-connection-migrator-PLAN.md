---
phase: 03-data-model-db-layer-sync-loop
plan: 05
type: execute
wave: 2
depends_on: ["03-01", "03-02"]
files_modified:
  - src/infrastructure/db/connection.ts
  - src/infrastructure/db/connection.test.ts
  - src/infrastructure/db/migrate.ts
  - src/infrastructure/db/migrate.test.ts
  - tests/integration/sync/migration-crash.test.ts
  - tests/integration/sync/pragma-roundtrip.test.ts
  - tests/integration/sync/helpers/spawn-migrator-child.mjs
autonomous: true
requirements: [DATA-01, DATA-04, SYNC-06]
tags: [sqlite, drizzle, migrator, wal, pragmas, integration-test]
user_setup: []

must_haves:
  truths:
    - "src/infrastructure/db/connection.ts exports openDb(path): {db: ReturnType<typeof drizzle>, sqlite: Database.Database} that sets 6 pragmas in fixed order (D-30): journal_mode=WAL → busy_timeout=5000 → journal_size_limit=67108864 → wal_autocheckpoint=1000 → synchronous=NORMAL → foreign_keys=ON"
    - "src/infrastructure/db/connection.ts re-exports `drizzle` from 'drizzle-orm/better-sqlite3' as the canonical import surface — keeps Gate G strict (test helpers and bootstrap can import drizzle via this file without bypassing the gate)"
    - "src/infrastructure/db/migrate.ts exports migrate(sqlite, opts) — hand-rolled wrapper using BEGIN IMMEDIATE per pending file, db.exec(sql) multi-statement, COMMIT (D-06 / Pitfall 13)"
    - "Pre-migration backup: sqlite + -wal + -shm copied to backupsDir as db.<ISO>-pre-<tag>.sqlite + matching -wal / -shm at chmod 600 (D-07)"
    - "Backup retention: 3 most-recent backups by mtime; older deleted with their -wal/-shm companions (D-07)"
    - "Fails-closed-no-auto-restore: throws MigrationError({kind: 'inconsistent_state' | 'apply_failed', backupPath, latestSafeMigration}) on partial migration (D-08)"
    - "MigrationError shape mirrors AuthError (readonly kind + optional detail + cause chain + name='MigrationError')"
    - "Migrator reads meta/_journal.json for canonical pending list (NOT directory scan); hashes each .sql payload (sha256) and skips if hash exists in __drizzle_migrations.hash"
    - "Integration test tests/integration/sync/migration-crash.test.ts proves pre-migration backup restores cleanly after a SIGKILL-during-db.exec() mid-migration child process (DATA-04 verification anchor)"
    - "Integration test tests/integration/sync/pragma-roundtrip.test.ts asserts all 6 pragmas land after openDb() + wal_checkpoint(TRUNCATE) drops db.sqlite-wal size to 0 after sync (SYNC-06 verification anchor)"
    - "ADR-0001: no console.* / process.stdout.write in connection.ts or migrate.ts"
    - "Gate G stays green: drizzle-orm/better-sqlite3 imports confined to connection.ts (and Plan 03-08 repositories); test helpers + bootstrap import drizzle THROUGH connection.ts re-export"
    - "Pitfall 13 enforced: every write transaction uses BEGIN IMMEDIATE; reads use default DEFERRED"
  artifacts:
    - path: "src/infrastructure/db/connection.ts"
      provides: "openDb() factory with all 6 pragmas in D-30 fixed order + canonical `drizzle` re-export for downstream callers (test helpers, bootstrap)"
      contains: "journal_mode = WAL"
    - path: "src/infrastructure/db/migrate.ts"
      provides: "Hand-rolled BEGIN IMMEDIATE migrator + pre-migration backup + fails-closed MigrationError"
      contains: "BEGIN IMMEDIATE"
    - path: "tests/integration/sync/migration-crash.test.ts"
      provides: "DATA-04 verification anchor — kill mid-statement, restore from backup"
      contains: "SIGKILL"
    - path: "tests/integration/sync/pragma-roundtrip.test.ts"
      provides: "SYNC-06 verification anchor — wal_checkpoint(TRUNCATE) drops WAL size"
      contains: "wal_checkpoint"
  key_links:
    - from: "src/infrastructure/db/migrate.ts"
      to: "src/infrastructure/db/migrations/meta/_journal.json"
      via: "readFileSync (committed migration ledger)"
      pattern: "_journal.json"
    - from: "src/infrastructure/db/connection.ts"
      to: "drizzle-orm/better-sqlite3"
      via: "named import drizzle + re-export"
      pattern: "from 'drizzle-orm/better-sqlite3'"
    - from: "tests/integration/sync/migration-crash.test.ts"
      to: "child_process.fork (subprocess that SIGKILLs during db.exec)"
      via: "node:child_process"
      pattern: "fork\\("
---

<objective>
Land the two infrastructure chokepoints for SQLite: `openDb(path)` for connection-level pragma discipline (D-30) and `migrate(sqlite, opts)` for the BEGIN IMMEDIATE migration wrapper with pre-migration backup + fails-closed-no-auto-restore (D-06 / D-07 / D-08). Land the two load-bearing integration tests that prove DATA-04 (crash-mid-migration recovery) and SYNC-06 (wal_checkpoint(TRUNCATE) folds WAL back).

This plan also owns the canonical `drizzle` re-export from `connection.ts`. Plan 03-07's `in-memory-db.ts` test helper, Plan 03-11's `bootstrap.ts`, and any other caller that needs `drizzle` outside `src/infrastructure/db/` import it through `connection.ts` — keeping Gate G strict (no `from 'drizzle-orm'` outside `src/infrastructure/db/`).

Purpose: This is the load-bearing infrastructure-chokepoint plan for Phase 3's DB layer. Pitfall 7 + Pitfall 13 + ADR-0002 (single-flight discipline applied to DB) all hinge on this code being correct. The integration tests must execute child processes that crash mid-write (fork → SIGKILL) and verify recovery.

Output: 4 source files + 2 integration tests + 1 child-process helper.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/PROJECT.md
@.planning/phases/03-data-model-db-layer-sync-loop/03-CONTEXT.md
@.planning/phases/03-data-model-db-layer-sync-loop/03-RESEARCH.md
@.planning/phases/03-data-model-db-layer-sync-loop/03-PATTERNS.md
@.planning/research/PITFALLS.md
@.planning/research/ARCHITECTURE.md
@agent_docs/decisions/0001-mcp-stdout-purity.md
@src/infrastructure/whoop/errors.ts
@src/infrastructure/db/schema.ts
@src/infrastructure/db/migrations/0000_initial.sql
@src/infrastructure/db/migrations/meta/_journal.json
@src/infrastructure/config/paths.ts
@tests/integration/auth-concurrency.test.ts

<interfaces>
<!-- Connection factory (D-30 + Pattern 1) -->

  import Database from 'better-sqlite3';
  import { drizzle } from 'drizzle-orm/better-sqlite3';

  export interface OpenDbResult {
    db: ReturnType<typeof drizzle>;
    sqlite: Database.Database;
  }

  export function openDb(path: string): OpenDbResult;

  // Canonical `drizzle` re-export — downstream callers (Plan 03-07 in-memory-db.ts, Plan 03-11 bootstrap.ts)
  // import drizzle via this file to keep Gate G strict.
  export { drizzle } from 'drizzle-orm/better-sqlite3';

<!-- Migrator (D-06 + D-07 + D-08 + Pattern 3) -->

  export interface MigrateOptions {
    migrationsDir: string;  // src/infrastructure/db/migrations (or compiled equivalent)
    backupsDir: string;     // ~/.recovery-ledger/backups
    dbFile: string;         // ~/.recovery-ledger/db.sqlite
  }

  export const MIGRATION_ERROR_KINDS = [
    'inconsistent_state',  // __drizzle_migrations rows orphaned vs schema (D-08)
    'apply_failed',        // BEGIN IMMEDIATE → exec(sql) threw → ROLLBACK → backup intact
  ] as const;

  export type MigrationErrorKind = (typeof MIGRATION_ERROR_KINDS)[number];

  export interface MigrationErrorInit {
    kind: MigrationErrorKind;
    backupPath: string | null;
    latestSafeMigration: string | null;
    detail?: string;
    cause?: unknown;
  }

  export class MigrationError extends Error {
    readonly kind: MigrationErrorKind;
    readonly backupPath: string | null;
    readonly latestSafeMigration: string | null;
    readonly detail?: string;
    // name = 'MigrationError'; mirrors AuthError shape from errors.ts
  }

  export function migrate(sqlite: Database.Database, opts: MigrateOptions): void;
  export function isMigrationError(err: unknown): err is MigrationError;
</interfaces>
</context>

<tasks>

<task type="auto">
  <name>Task 1: Implement src/infrastructure/db/connection.ts + introspection tests</name>
  <files>src/infrastructure/db/connection.ts, src/infrastructure/db/connection.test.ts</files>
  <read_first>
    - .planning/phases/03-data-model-db-layer-sync-loop/03-CONTEXT.md decisions D-30 (six pragmas in fixed order), D-31 (BEGIN IMMEDIATE for writes), D-32 (wal_checkpoint(TRUNCATE))
    - .planning/phases/03-data-model-db-layer-sync-loop/03-RESEARCH.md §Pattern 1 lines 361-389 (openDb code verbatim), §Technical Research item 6 lines 1112-1119 (better-sqlite3 pragma semantics, multi-statement exec)
    - .planning/phases/03-data-model-db-layer-sync-loop/03-PATTERNS.md §A1 lines 123-164 (connection bootstrap analog from paths.ts)
    - .planning/research/PITFALLS.md Pitfall 12 (unbounded WAL — pragmas mitigate), Pitfall 13 (BEGIN IMMEDIATE)
    - src/infrastructure/config/paths.ts (Wave 0 extended — dbFile + dbWalFile + dbShmFile + backupsDir available)
    - src/infrastructure/whoop/errors.ts (style precedent for module-leading doc comment + error class shape)
  </read_first>
  <action>
    Create `src/infrastructure/db/connection.ts`. Leading doc comment cites D-30 + Pattern 1 + Pitfall 12 + ADR-0001 (no console / direct stdout writes); use the "console calls" / "direct stdout writes" phrasing for grep-safety.

    Imports: `import Database from 'better-sqlite3'` (default import — this package ships CJS interop; named imports break under ESM-strict TS), `import { drizzle } from 'drizzle-orm/better-sqlite3'`.

    Add a canonical re-export so downstream callers that live outside `src/infrastructure/db/` (Plan 03-07 `tests/helpers/in-memory-db.ts`, Plan 03-11 `src/services/bootstrap.ts`) can import `drizzle` without bypassing Gate G:

      `export { drizzle } from 'drizzle-orm/better-sqlite3';`

    Place this re-export near the top of the file, immediately after the imports and the leading doc comment. Document it in the file-level comment: "Canonical `drizzle` import surface — callers outside this directory MUST import drizzle through this re-export so Gate G can stay strict (forbids `from 'drizzle-orm'` outside `src/infrastructure/db/`)."

    Export `OpenDbResult` interface and `openDb(path: string): OpenDbResult`:
      - `const sqlite = new Database(path)` — for in-memory tests, `path = ':memory:'`.
      - Six pragmas in FIXED ORDER (D-30):
        1. `sqlite.pragma('journal_mode = WAL')` — MUST be first (only pragma that switches journaling shape; persists in file header). For `:memory:` databases, WAL is not supported — fall back silently: wrap in try/catch and read `sqlite.pragma('journal_mode', {simple: true})` afterward to detect the actual mode. For in-memory DBs the result is `'memory'`; for real files it's `'wal'`. Test the production path with a real file.
        2. `sqlite.pragma('busy_timeout = 5000')`
        3. `sqlite.pragma('journal_size_limit = 67108864')` (64 MB)
        4. `sqlite.pragma('wal_autocheckpoint = 1000')`
        5. `sqlite.pragma('synchronous = NORMAL')`
        6. `sqlite.pragma('foreign_keys = ON')`
      - Return `{db: drizzle(sqlite), sqlite}`. Caller owns lifecycle (sqlite.close()).

    Create `src/infrastructure/db/connection.test.ts` with vitest. Pool `'forks'` already in vitest.config.ts.
      - Use `import { tmpdir } from 'node:os'; import path from 'node:path'; import { mkdtempSync, rmSync } from 'node:fs'`.
      - Test 1: `openDb(realFilePath)` returns an object with `db` and `sqlite` fields; `typeof openDb` is function.
      - Test 2: After openDb, `sqlite.pragma('journal_mode', {simple: true}) === 'wal'`.
      - Test 3: After openDb, `sqlite.pragma('busy_timeout', {simple: true}) === 5000`.
      - Test 4: After openDb, `sqlite.pragma('journal_size_limit', {simple: true}) === 67108864`.
      - Test 5: After openDb, `sqlite.pragma('wal_autocheckpoint', {simple: true}) === 1000`.
      - Test 6: After openDb, `sqlite.pragma('synchronous', {simple: true}) === 1` (SQLite encodes NORMAL as integer 1).
      - Test 7: After openDb, `sqlite.pragma('foreign_keys', {simple: true}) === 1`.
      - Test 8: `openDb(':memory:')` returns a usable handle without throwing — pragma order intact (journal_mode for memory returns `'memory'` not `'wal'`, but the call doesn't throw).
      - Test 9: `drizzle` re-export — `import { drizzle as drizzleFromConnection } from './connection.js'` returns the same function as the underlying drizzle-orm/better-sqlite3 import. Assert via `typeof drizzleFromConnection === 'function'` and that calling it on a fresh `new Database(':memory:')` returns a usable handle (smoke check; downstream Plan 03-07 + Plan 03-11 tests exercise it end-to-end).
      - `afterEach` cleans up: `sqlite.close()` and `rmSync(tmpDir, {recursive: true, force: true})`.

    NO default exports. NO `console.*`. NO inline tokens.
  </action>
  <verify>
    <automated>npm run test -- src/infrastructure/db/connection.test.ts</automated>
  </verify>
  <acceptance_criteria>
    - `grep -c "from 'drizzle-orm/better-sqlite3'" src/infrastructure/db/connection.ts` returns at least 1 (import + re-export may coalesce to a single line; either shape is fine; Gate G remains green because the line is under src/infrastructure/db/)
    - `grep -cE "^export \{ drizzle \} from 'drizzle-orm/better-sqlite3'" src/infrastructure/db/connection.ts` returns 1 (the canonical re-export — load-bearing for Plan 03-07 in-memory-db.ts and Plan 03-11 bootstrap.ts to import drizzle through this file)
    - `grep -cE "sqlite\.pragma\('(journal_mode|busy_timeout|journal_size_limit|wal_autocheckpoint|synchronous|foreign_keys)" src/infrastructure/db/connection.ts` returns 6
    - The pragma calls appear in this exact order in the file: `grep -nE "sqlite\.pragma\('journal_mode|busy_timeout|journal_size_limit|wal_autocheckpoint|synchronous|foreign_keys" src/infrastructure/db/connection.ts | head -6` shows journal_mode first, foreign_keys last
    - `npm run test -- src/infrastructure/db/connection.test.ts` shows at least 9 passing assertions (8 pragma + 1 drizzle re-export smoke)
    - `grep -v '^\s*//' src/infrastructure/db/connection.ts | grep -v '^\s*\*' | grep -c "console\." ` returns 0
    - `bash scripts/ci-grep-gates.sh` exits 0
  </acceptance_criteria>
  <done>openDb shipped; all 6 pragmas applied per D-30 in the fixed order; introspection tests lock the pragma contract per connection; canonical `drizzle` re-export shipped for Plan 03-07 + Plan 03-11 downstream callers to keep Gate G strict.</done>
</task>

<task type="auto">
  <name>Task 2: Implement src/infrastructure/db/migrate.ts (hand-rolled BEGIN IMMEDIATE + backup + retention + MigrationError) + unit tests</name>
  <files>src/infrastructure/db/migrate.ts, src/infrastructure/db/migrate.test.ts</files>
  <read_first>
    - .planning/phases/03-data-model-db-layer-sync-loop/03-CONTEXT.md decisions D-06 (hand-rolled migrator + BEGIN IMMEDIATE + db.exec multi-statement), D-07 (backup naming, retention=3, chmod 600), D-08 (fails-closed-no-auto-restore + MigrationError shape), D-31 (BEGIN IMMEDIATE for all writes)
    - .planning/phases/03-data-model-db-layer-sync-loop/03-RESEARCH.md §Pattern 3 lines 420-507 (migrator skeleton verbatim), §Technical Research item 7 lines 1122-1145 (__drizzle_migrations shape + meta/_journal.json), §Assumptions Log A1-A2-A8-A10-A11
    - .planning/phases/03-data-model-db-layer-sync-loop/03-PATTERNS.md §A3 lines 200-330 (full migrator skeleton + MigrationError shape mirroring AuthError + pruneBackups retention helper)
    - .planning/research/PITFALLS.md Pitfall 7 (mid-flight migration failure; backup posture), Pitfall 13 (BEGIN IMMEDIATE not DEFERRED)
    - src/infrastructure/whoop/errors.ts (AuthError shape — verbatim mirror for MigrationError)
    - src/infrastructure/db/migrations/meta/_journal.json (Plan 03-02 output — the actual on-disk shape this code parses)
    - src/infrastructure/db/migrations/0000_initial.sql (Plan 03-02 output — the SQL the migrator will exec)
  </read_first>
  <action>
    Create `src/infrastructure/db/migrate.ts`. Leading doc comment cites D-06 + Pattern 3 + Pitfall 7 + Pitfall 13; phrase any plan-grep-collision strings per the learnings entry from Phase 2.

    Imports: `import { createHash } from 'node:crypto'`, `import { chmodSync, copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, unlinkSync } from 'node:fs'`, `import { dirname, join } from 'node:path'`, `import type Database from 'better-sqlite3'`. NO drizzle-orm imports here — this file reads SQL from disk and runs it via `sqlite.exec()` directly. (Gate G allows drizzle-orm in src/infrastructure/db/ anyway.)

    Export the MIGRATION_ERROR_KINDS tuple + MigrationErrorKind type + MIGRATION_ERROR_KINDS_SET (mirror errors.ts pattern).

    Export `MigrationErrorInit` interface + `MigrationError` class mirroring `AuthError`:
      - readonly `kind`, `backupPath`, `latestSafeMigration`, optional `detail`
      - constructor: `super(init.detail ?? init.kind, init.cause === undefined ? undefined : { cause: init.cause })`
      - Set `this.name = 'MigrationError'`
    Export `isMigrationError(err)` duck-type guard.

    Export `migrate(sqlite: Database.Database, opts: MigrateOptions): void`. Algorithm per Pattern 3:
      1. Ensure `__drizzle_migrations` table exists. SQL: `CREATE TABLE IF NOT EXISTS __drizzle_migrations (id INTEGER PRIMARY KEY AUTOINCREMENT, hash TEXT NOT NULL, created_at NUMERIC)`. Per A2.
      2. Read canonical migration list from `${opts.migrationsDir}/meta/_journal.json`. Parse into `{entries: [{idx, when, tag, breakpoints}]}` shape. If parse fails or shape doesn't match, throw `new MigrationError({kind: 'inconsistent_state', backupPath: null, latestSafeMigration: null, detail: 'journal parse failed', cause: err})`.
      3. Read applied hashes: `sqlite.prepare('SELECT hash FROM __drizzle_migrations').all().map(r => r.hash)` → into a Set.
      4. For each `entry` in `journal.entries`:
         a. Resolve `sqlPath = join(opts.migrationsDir, entry.tag + '.sql')`. If file missing, throw `MigrationError({kind: 'inconsistent_state', ..., detail: 'journal entry tag ' + entry.tag + ' has no .sql payload on disk'})`.
         b. Read `sql = readFileSync(sqlPath, 'utf8')`.
         c. Compute `hash = createHash('sha256').update(sql).digest('hex')`.
         d. If `appliedHashes.has(hash)`, continue (already applied).
         e. Take pre-migration backup via `takeBackup(opts.dbFile, opts.backupsDir, entry.tag)` (helper below). Backup path returned for inclusion in any subsequent MigrationError. Skip backup if `opts.dbFile === ':memory:'` (no file to back up).
         f. `sqlite.exec('BEGIN IMMEDIATE')`. Within try/catch:
            - `sqlite.exec(sql)` (multi-statement-aware per A8; the `--> statement-breakpoint` markers are comments per A10).
            - `sqlite.prepare('INSERT INTO __drizzle_migrations (hash, created_at) VALUES (?, ?)').run(hash, Date.now())`.
            - `sqlite.exec('COMMIT')`.
         g. On any throw inside the try: `sqlite.exec('ROLLBACK')`, then `throw new MigrationError({kind: 'apply_failed', backupPath, latestSafeMigration: entry.tag, cause: err})`.
         h. `sqlite.pragma('wal_checkpoint(PASSIVE)')` — per D-07 / Specifics line 242 so a follow-up backup sees WAL folded.
      5. Final consistency check: count `__drizzle_migrations` rows; assert it matches the number of entries that were either already applied or just applied. On mismatch, throw `MigrationError({kind: 'inconsistent_state', backupPath: <most-recent>, latestSafeMigration: <last-applied-tag>})`.

    Helper `takeBackup(dbFile: string, backupsDir: string, tag: string): string`:
      - `mkdirSync(backupsDir, {recursive: true, mode: 0o700})`.
      - If `!existsSync(dbFile)` (first-ever migration with no prior db.sqlite), return empty string `''`. No backup needed.
      - Compute `ts = new Date().toISOString().replace(/[:.]/g, '-')` (filesystem-safe).
      - Compute `base = join(backupsDir, 'db.' + ts + '-pre-' + tag)`.
      - For each suffix in `['.sqlite', '.sqlite-wal', '.sqlite-shm']`: if the source file exists, `copyFileSync(dbFile + suffix, base + suffix)` then `chmodSync(base + suffix, 0o600)`.
      - Call `pruneBackups(backupsDir, 3)`.
      - Return `base + '.sqlite'`.

    Helper `pruneBackups(backupsDir: string, keep: number)` per RESEARCH.md lines 891-904:
      - `readdirSync(backupsDir)` → filter for files ending in `.sqlite` → sort by mtime desc → for each beyond `keep`, unlink the `.sqlite` + `.sqlite-wal` + `.sqlite-shm` companions (try/catch each — missing companion is fine).

    Create `src/infrastructure/db/migrate.test.ts` (unit-level; integration tests are Task 3):
      - Use `:memory:` SQLite + a temp directory for fixtures with a fake `meta/_journal.json` + matching `.sql`.
      - Test 1: First-run on empty DB applies 1 migration; `__drizzle_migrations` table exists; row count === 1.
      - Test 2: Second run on same DB is a no-op (hashes match; appliedHashes.has → continue); row count still 1.
      - Test 3: Bad SQL in fixture (e.g., `CREATE TABLE foo (id INVALID_TYPE)`) → migrate throws MigrationError({kind: 'apply_failed'}); `__drizzle_migrations` empty after the throw (ROLLBACK fired).
      - Test 4: MigrationError shape — `isMigrationError(err) === true`; `err.name === 'MigrationError'`; `err.kind` is one of the 2 enum values.
      - Test 5: Journal file missing → MigrationError({kind: 'inconsistent_state'}).
      - Test 6: Journal entry references a .sql tag that doesn't exist on disk → MigrationError({kind: 'inconsistent_state'}) with detail mentioning the missing tag.
      - Test 7: pruneBackups keeps 3 → create 5 dummy backup files with staggered mtimes → call pruneBackups(dir, 3) → 2 oldest deleted along with their -wal/-shm companions.
      - Test 8: backup chmod is 600 — create real db.sqlite + db.sqlite-wal + db.sqlite-shm files; call takeBackup; assert `(statSync(backup).mode & 0o777) === 0o600`. Linux-only assertion (macOS may not preserve exact mode bits depending on umask — use a `.skipIf(process.platform === 'darwin')` guard if needed).

    All tests use vitest pool='forks' (already configured). `afterEach` cleans temp dirs.
  </action>
  <verify>
    <automated>npm run test -- src/infrastructure/db/migrate.test.ts</automated>
  </verify>
  <acceptance_criteria>
    - `grep -c "BEGIN IMMEDIATE" src/infrastructure/db/migrate.ts` returns at least 1
    - `grep -c "ROLLBACK" src/infrastructure/db/migrate.ts` returns at least 1
    - `grep -c "__drizzle_migrations" src/infrastructure/db/migrate.ts` returns at least 3 (CREATE + SELECT + INSERT)
    - `grep -c "MIGRATION_ERROR_KINDS" src/infrastructure/db/migrate.ts` returns at least 3 (tuple + type + SET)
    - `grep -c "wal_checkpoint" src/infrastructure/db/migrate.ts` returns at least 1 (PASSIVE after commit)
    - `grep -c "0o600\|chmodSync" src/infrastructure/db/migrate.ts` returns at least 1 (chmod 600 on backup files)
    - `npm run test -- src/infrastructure/db/migrate.test.ts` shows at least 7 assertions passing (8 including the chmod test on Linux)
    - `bash scripts/ci-grep-gates.sh` exits 0
    - `grep -v '^\s*//' src/infrastructure/db/migrate.ts | grep -v '^\s*\*' | grep -c "console\." ` returns 0
  </acceptance_criteria>
  <done>Hand-rolled migrator shipped with BEGIN IMMEDIATE + multi-statement exec + pre-migration backup at chmod 600 + retention-of-3 + fails-closed MigrationError matching the FROZEN AuthError shape; unit tests cover happy + sad paths.</done>
</task>

<task type="auto">
  <name>Task 3: Integration tests — migration crash (DATA-04) + pragma roundtrip (SYNC-06)</name>
  <files>tests/integration/sync/migration-crash.test.ts, tests/integration/sync/pragma-roundtrip.test.ts, tests/integration/sync/helpers/spawn-migrator-child.mjs</files>
  <read_first>
    - src/infrastructure/db/migrate.ts (Task 2 output — the code under test)
    - src/infrastructure/db/connection.ts (Task 1 output)
    - src/infrastructure/db/migrations/0000_initial.sql + meta/_journal.json (Plan 03-02 — the real input to migrator)
    - .planning/phases/03-data-model-db-layer-sync-loop/03-PATTERNS.md §G4 lines 1404-1428 (migration-crash integration test pattern)
    - tests/integration/auth-concurrency.test.ts (Plan 02-08 — the precedent for child-process fork + integrity assertions)
    - .planning/phases/03-data-model-db-layer-sync-loop/03-RESEARCH.md §Validation Architecture lines 1163-1180 (DATA-04 + SYNC-06 verification anchors)
    - .planning/research/PITFALLS.md Pitfall 7 (verification anchor — kill mid-statement) + Pitfall 12 (WAL growth)
    - agent_docs/conventions.md §Testing (pool: 'forks' required for cross-process child spawning)
  </read_first>
  <action>
    Create `tests/integration/sync/helpers/spawn-migrator-child.mjs` (`.mjs` extension matches `tests/integration/helpers/child-get-token.mjs` precedent from Plan 02-08). Child-process script:
      - Reads `process.argv[2]` for the test scenario tag.
      - If scenario === 'kill-mid-statement': open SQLite at `process.env.TEST_DB_FILE`, run the migrator on a fixture journal containing 2 sequential migrations where the SECOND migration's .sql contains an artificial `console.log('about to crash')` followed by intentional infinite loop or a marker pattern. After printing `'PRE-CRASH'` to stdout, send self SIGKILL via `process.kill(process.pid, 'SIGKILL')`. The parent test process should catch the exit code and the partial DB state. NOTE: this is the ONLY place in the codebase allowed to call `console.log` — it's a test fixture, not production code, exempted by Gate B.
      - If scenario === 'pragma-only': open SQLite, run migrator successfully, exit 0. Used to seed real DB files for the pragma roundtrip test.

    Create `tests/integration/sync/migration-crash.test.ts` per DATA-04 verification anchor (RESEARCH.md §Validation Architecture line 1169):
      - `beforeEach`: create temp dirs for `dbFile`, `backupsDir`, `migrationsDir` (copy real Plan 03-02 `0000_initial.sql` + `meta/_journal.json` into migrationsDir; add a synthetic `0001_crash.sql` + corresponding journal entry that the child process will crash on).
      - Test 1: Run the migrator child-process in the 'kill-mid-statement' scenario. Verify:
         - Child exited with non-zero status (SIGKILL → 137 on POSIX).
         - Stdout from child contains 'PRE-CRASH' marker (proves we reached the second migration's body before kill).
         - `${dbFile}-wal` may exist with uncommitted data, but `__drizzle_migrations` table after re-opening the DB contains EXACTLY one row (the first migration committed, the second rolled back by SQLite's WAL recovery semantics).
         - The pre-migration backup file exists at `${backupsDir}/db.<ISO>-pre-0001_crash.sqlite` with `chmod 600`.
         - Restoration smoke test: `cp <backupPath> <dbFile>` + open with openDb → `PRAGMA integrity_check` returns `'ok'` → `__drizzle_migrations` row count === 1 (state at last safe migration).
      - Test 2: Re-run migrator on the partially-applied DB without restoring the backup → migrator detects inconsistent state OR cleanly re-applies the second migration (depending on whether SQLite's WAL recovery left __drizzle_migrations consistent with the file state). Whichever path the implementation takes, lock it: if migrate throws `MigrationError({kind: 'inconsistent_state'})`, test asserts the throw and the backupPath; if migrate cleanly idempotently re-applies, test asserts row count and integrity. Pick whichever the implementation does and document the choice in `.test` comment + Plan summary.
      - Test 3: backup file integrity — open the backup `.sqlite` with openDb, run `PRAGMA integrity_check`, assert result === 'ok'. Confirms the pre-migration copy was atomic (Pitfall 7 mitigation).
      - Test 4: Retention enforcement — after 4 sequential successful migrations, only 3 backup files remain under `backupsDir`. Verify D-07 retention=3.

    Create `tests/integration/sync/pragma-roundtrip.test.ts` per SYNC-06 verification anchor (RESEARCH.md §Validation Architecture line 1177):
      - `beforeEach`: create a temp DB file, run migrator once (real Plan 03-02 schema).
      - Test 1: After openDb, all 6 pragmas hold (mirror Plan 03-05 Task 1 connection.test.ts assertions but on a real disk-backed file with WAL — `journal_mode === 'wal'`).
      - Test 2: Open a real DB file, run migrator, write some test data to `cycles` via raw SQL (`INSERT INTO cycles (id, user_id, created_at, updated_at, start, timezone_offset, score_state, raw_json) VALUES (...)`). Verify `db.sqlite-wal` file size > 0 after the writes (WAL is populated).
      - Test 3: Call `sqlite.pragma('wal_checkpoint(TRUNCATE)')`. Verify return value matches `(0, X, X)` shape (0 = busy=false; X = wal frames before; X = wal frames moved). Verify `statSync('db.sqlite-wal').size === 0` immediately after.
      - Test 4: After running the migrator, verify `__drizzle_migrations` row count === 1 (Plan 03-02's single 0000_initial migration applied).
      - Test 5: Re-running the migrator on the same DB is a no-op — second call returns silently; row count still 1.

    Notes:
      - Use `vi.setConfig({testTimeout: 10_000})` per test file — child-process tests can take 3-5s on slow CI.
      - Both files use `import { describe, test, expect, beforeEach, afterEach } from 'vitest'`.
      - Avoid `console.log` outside the child-process helper (`spawn-migrator-child.mjs` is exempted by Gate B because *.mjs in tests/ is outside `src/`).
  </action>
  <verify>
    <automated>npm run test -- tests/integration/sync/migration-crash.test.ts tests/integration/sync/pragma-roundtrip.test.ts</automated>
  </verify>
  <acceptance_criteria>
    - `npm run test -- tests/integration/sync/migration-crash.test.ts` shows at least 4 assertions passing
    - `npm run test -- tests/integration/sync/pragma-roundtrip.test.ts` shows at least 5 assertions passing
    - migration-crash test exercises a real subprocess (`grep -c "fork\\|spawn" tests/integration/sync/migration-crash.test.ts` returns at least 1)
    - pragma-roundtrip test verifies WAL truncation (`grep -c "wal_checkpoint(TRUNCATE)" tests/integration/sync/pragma-roundtrip.test.ts` returns at least 1)
    - Total Phase 3 test count now reflects 9+ new integration assertions
    - `bash scripts/ci-grep-gates.sh` exits 0 (Gate B exempts `*.mjs` files in tests/)
    - Combined test run for both files completes in < 10s (well under the 60s phase-suite cap)
    - `grep -v 'console\.log' tests/integration/sync/migration-crash.test.ts | grep -v 'console\.log' tests/integration/sync/pragma-roundtrip.test.ts | grep -c "console\." ` returns 0 (no console.* in production-pattern test code; child-process helper is .mjs)
  </acceptance_criteria>
  <done>DATA-04 + SYNC-06 verification anchors landed as fixture-driven cross-process integration tests; Pitfall 7 + 12 mitigations CI-enforced; suite < 10s.</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| Migrator → __drizzle_migrations table | Single-writer-process invariant relies on BEGIN IMMEDIATE (Pitfall 13) |
| Pre-migration backup files at ~/.recovery-ledger/backups/ | chmod 600; same dir as tokens.json |
| db.sqlite-wal mid-flight | WAL recovery on next open restores consistency |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-03.05-01 | Tampering | Crash mid-`db.exec(sql)` leaves inconsistent __drizzle_migrations | mitigate | BEGIN IMMEDIATE + db.exec single multi-statement payload + ROLLBACK on throw + WAL recovery on re-open — verified by migration-crash.test.ts Test 1. D-06 + Pitfall 7 + D-08 fails-closed posture. |
| T-03.05-02 | Information disclosure | Backup files containing user decisions readable by other users | mitigate | chmod 600 enforced on every copied file (D-07 + Security Mistakes table in PITFALLS.md); test asserts mode bits on Linux. |
| T-03.05-03 | Denial of service | Unbounded backup growth fills disk | mitigate | pruneBackups retention=3 (D-07); D-08 also surfaces "you have backups" in MigrationError so user can rotate manually if needed. |
| T-03.05-04 | Denial of service | WAL file growth past journal_size_limit (64 MB) | mitigate | wal_autocheckpoint=1000 + explicit wal_checkpoint(TRUNCATE) after every sync (Plan 03-11) — D-30 + D-32; pragma-roundtrip.test.ts Test 3 locks the truncation contract. |
| T-03.05-05 | Repudiation | Migration applied without trace | mitigate | `__drizzle_migrations` row inserted in the same BEGIN IMMEDIATE transaction as the schema change — atomic. Plan 03-11 sync_runs row provides per-sync provenance. |
| T-03.05-06 | Elevation of privilege | sqlite-3.x file with attacker-controlled path opened as user | accept | dbFile resolves through paths.ts (Plan 02-01 + Plan 03-01) which clamps to RECOVERY_LEDGER_HOME or $HOME — no user-supplied path here. CLI shims (Plan 03-12) don't accept --db-file overrides. |
</threat_model>

<verification>
- `npm run test -- src/infrastructure/db/ tests/integration/sync/` → all ≥ 22 assertions green
- `npm run lint` → 0 errors
- `bash scripts/ci-grep-gates.sh` → all 7 gates green
- `npx tsc --noEmit` → 0 errors
- `grep -cE "^export \{ drizzle \} from 'drizzle-orm/better-sqlite3'" src/infrastructure/db/connection.ts` → 1 (canonical re-export landed; Plan 03-07 + Plan 03-11 depend on this)
</verification>

<success_criteria>
- `openDb(path)` applies all 6 pragmas in D-30 fixed order; `:memory:` falls back gracefully on WAL
- `connection.ts` re-exports `drizzle` from `'drizzle-orm/better-sqlite3'` — single canonical import surface for callers outside `src/infrastructure/db/`
- `migrate(sqlite, opts)` reads meta/_journal.json + hashes payloads + applies pending in BEGIN IMMEDIATE + writes __drizzle_migrations + pre-migration backup with chmod 600 + retention 3
- `MigrationError` mirrors AuthError shape (readonly kind + optional detail + cause + name); fails-closed on inconsistent_state and apply_failed
- DATA-04 verification anchor: mid-`db.exec()` SIGKILL → backup restorable → integrity_check returns 'ok'
- SYNC-06 verification anchor: wal_checkpoint(TRUNCATE) drops `db.sqlite-wal` size to 0
- Gate G stays green; Pitfall 13 (BEGIN IMMEDIATE) and Pitfall 7 (pre-migration backup) CI-enforced
</success_criteria>

<output>
Create `.planning/phases/03-data-model-db-layer-sync-loop/03-05-SUMMARY.md` when done.
</output>
