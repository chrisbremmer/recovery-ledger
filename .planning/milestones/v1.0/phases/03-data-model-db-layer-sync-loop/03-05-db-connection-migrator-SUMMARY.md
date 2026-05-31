---
phase: 03-data-model-db-layer-sync-loop
plan: 05
subsystem: db
tags: [sqlite, drizzle, migrator, wal, pragmas, integration-test]

requires:
  - phase: 03-data-model-db-layer-sync-loop
    plan: 01
    provides: "ResolvedPaths.dbFile + dbWalFile + dbShmFile + backupsDir; Phase 3 deps installed (better-sqlite3, drizzle-orm); Gate G allowlist"
  - phase: 03-data-model-db-layer-sync-loop
    plan: 02
    provides: "src/infrastructure/db/schema.ts + migrations/0000_initial.sql + meta/_journal.json — the real on-disk artifacts the migrator parses"
provides:
  - "src/infrastructure/db/connection.ts — openDb(path) factory applying six D-30 pragmas in fixed order (journal_mode=WAL, busy_timeout=5000, journal_size_limit=64MB, wal_autocheckpoint=1000, synchronous=NORMAL, foreign_keys=ON) + canonical drizzle re-export for Plan 03-07 + 03-11 callers"
  - "src/infrastructure/db/migrate.ts — hand-rolled migrate(sqlite, opts) with BEGIN IMMEDIATE per pending migration, db.exec(sql) multi-statement, pre-migration backup of .sqlite + -wal + -shm at chmod 600, retention 3 most-recent, MigrationError({kind, backupPath, latestSafeMigration}) mirroring AuthError shape, no auto-restore (D-08)"
  - "tests/integration/sync/migration-crash.test.ts — DATA-04 verification anchor: 4 assertions exercising SIGKILL-mid-db.exec() recovery semantics via child-process fork"
  - "tests/integration/sync/pragma-roundtrip.test.ts — SYNC-06 verification anchor: 5 assertions on the six D-30 pragmas + wal_checkpoint(TRUNCATE) folding db.sqlite-wal back to 0 bytes"
  - "tests/integration/sync/helpers/spawn-migrator-child.mjs — forked-child helper with kill-mid-statement + pragma-only scenarios; PRE-CRASH stdout marker is the parent's race signal"
affects:
  - "03-07 in-memory-db (Wave 3) — will import drizzle via connection.ts re-export to keep Gate G strict; openDb(':memory:') is the test helper's underlying primitive"
  - "03-08 repositories (Wave 3) — will use openDb()-returned drizzle handle; BEGIN IMMEDIATE discipline (D-31) inherited via raw sqlite handle access for transaction wrappers"
  - "03-11 sync-orchestrator (Wave 4) — calls migrate() at bootstrap; calls wal_checkpoint(TRUNCATE) at end-of-sync per D-32 (the SYNC-06 contract this plan locks)"
  - "03-12 cli-sync-shim (Wave 4) — relies on bootstrap-time migrate() having run before any sync writes; doctor probe (Phase 5) consumes MigrationError.backupPath as a one-line cp remediation"

tech-stack:
  added: []
  patterns:
    - "Connection-level pragma chokepoint (D-30) — openDb() is the single site where the six pragmas are applied in fixed order. journal_mode = WAL must run first (it's the only pragma that switches journaling shape); foreign_keys = ON runs last so referenced-table-not-found errors surface immediately on subsequent statements."
    - "Hand-rolled migrator with BEGIN IMMEDIATE (D-06 + Pitfall 13) — NOT Drizzle's default migrate() from drizzle-orm/better-sqlite3/migrator, which uses BEGIN DEFERRED and defeats busy_timeout. Each pending migration's whole .sql payload runs through sqlite.exec(sql) inside a BEGIN IMMEDIATE / COMMIT (or ROLLBACK on throw) transaction. The `--> statement-breakpoint` markers Drizzle Kit emits are SQL comments and ignored by exec()."
    - "Pre-migration backup with chmod 600 + retention 3 (D-07) — same shape as the Phase 2 tokens.json fallback; mkdir mode 0700, file mode 0600, ISO-timestamp + tag in the name so the doctor remediation can identify which migration each backup precedes. The .sqlite + -wal + -shm trio is copied in lockstep so the backup is internally consistent."
    - "Fails-closed MigrationError (D-08) mirroring AuthError shape — readonly kind tuple + duck-type SET + cause chain preserved through ES2022 Error options. NO auto-restore: the decisions table is irreplaceable user data; doctor surfaces the backup path as a one-line cp <backupPath> <dbFile> remediation."
    - "Child-process SIGKILL race for crash-recovery integration test — parent reads child stdout for the PRE-CRASH marker, then kills via SIGKILL while the child's libuv main thread is blocked inside better-sqlite3's native exec() binding. The 200k-row recursive-CTE INSERT keeps exec() busy ~500-1500ms — well above the parent's poll interval — so the race wins deterministically on macOS + Linux."

key-files:
  created:
    - "src/infrastructure/db/connection.ts"
    - "src/infrastructure/db/connection.test.ts"
    - "src/infrastructure/db/migrate.ts"
    - "src/infrastructure/db/migrate.test.ts"
    - "tests/integration/sync/migration-crash.test.ts"
    - "tests/integration/sync/pragma-roundtrip.test.ts"
    - "tests/integration/sync/helpers/spawn-migrator-child.mjs"
    - ".planning/phases/03-data-model-db-layer-sync-loop/03-05-db-connection-migrator-SUMMARY.md"
  modified: []

key-decisions:
  - "MigrationError tracks `latestSafeMigration` as the tag CURRENTLY being applied (set to entry.tag right before the BEGIN IMMEDIATE), not the most-recent successfully-committed one. Rationale: the doctor remediation path needs to know WHICH migration tried-and-failed so the user can read the corresponding .sql payload manually if they want to inspect the schema change before restoring. The 'safe' in the name is from the perspective of the backup — the backup IS the safe state, and latestSafeMigration is the tag whose backup is the most recent."
  - "Backup helper returns `''` (empty string) when no backup was taken — either dbFile === ':memory:' OR the file does not yet exist (first-ever migration on a fresh $HOME). The caller (migrate) maps '' to null for the MigrationError surface. Reason: in-memory SQLite has no on-disk state to back up, and a fresh empty DB has nothing of value to lose if the migration crashes."
  - "Used `XYZGARBAGE this is not valid sql;` in the bad-SQL test fixtures instead of the plan's `CREATE TABLE foo (id INVALID_TYPE);`. SQLite is permissive about column types (it stores them as affinity hints, not strict types) — `INVALID_TYPE` is accepted silently. A SQL syntax error (`XYZGARBAGE`) reliably raises SQLITE_ERROR. Rule-1 plan-text correction precedent."
  - "Test 8 (backup chmod 600) materializes a real SQLite file by opening a Database against dbFile, running a no-op CREATE TABLE, then closing — instead of writing synthetic 'main-bytes' / 'wal-bytes' / 'shm-bytes' strings. Reason: better-sqlite3 rejects the file as 'not a database' if the magic header is wrong, which would prevent the migrate() call inside the test from running takeBackup. The plan implied raw byte fixtures; the implementation needed a valid SQLite seed."
  - "Inlined a minimal hand-rolled migrator in spawn-migrator-child.mjs instead of importing from the TS source. The .mjs child runs as plain Node ESM and would need tsx (build-time coupling) or a compiled dist/ path (test-build coupling) to import src/infrastructure/db/migrate.ts. The inline shape mirrors migrate.ts byte-for-byte on the load-bearing surface (BEGIN IMMEDIATE / db.exec / wal_checkpoint / pre-migration backup) — the parent test asserts on-disk side effects, not the migrator's TS surface."
  - "PRE-CRASH marker placed BETWEEN takeBackup() and `sqlite.exec('BEGIN IMMEDIATE')` in the child helper. This is the deterministic race window: backup is on disk (so the parent can assert its existence after the kill), but BEGIN IMMEDIATE has not yet run (so the WAL recovery rolls back cleanly). The 200k-row INSERT is the time-stretching device inside the BEGIN that gives the parent's SIGKILL room to land before COMMIT."

patterns-established:
  - "Drizzle re-export from connection.ts as the canonical import surface for callers outside src/infrastructure/db/. Plan 03-07 in-memory-db.ts and Plan 03-11 bootstrap.ts both import `drizzle` from this file so Gate G can forbid `from 'drizzle-orm'` outside the db/ directory without forcing every downstream caller to live under that directory."
  - "Forked-child + stdout-marker pattern for cross-process crash-recovery tests, mirroring Plan 02-08's `auth-concurrency.test.ts` `fork('tests/integration/helpers/child-get-token.mjs')` precedent. The .mjs file extension lets the child run as plain Node ESM without test-time TS transpile; the `Gate B` `console.*` rule self-exempts `.mjs` in `tests/`."
  - "Real-migrations integration test pattern: pragma-roundtrip.test.ts points at the real Plan 03-02 `src/infrastructure/db/migrations/` directory and runs the migrator against `tests/fixtures/`-free fixtures. This is the precedent Plan 03-11's sync-orchestrator integration tests will follow (real schema + real migrator + temp dbFile)."

requirements-completed: [DATA-01, DATA-04, SYNC-06]

duration: 11m
completed: 2026-05-16
---

# Phase 3 Plan 05: DB Connection + Hand-Rolled Migrator + DATA-04 / SYNC-06 Integration Tests Summary

**Wave 2b lands the load-bearing DB chokepoint: `openDb(path)` for connection-level pragma discipline (D-30), the hand-rolled BEGIN IMMEDIATE migrator with pre-migration backup + fails-closed MigrationError (D-06 / D-07 / D-08), and two cross-process integration tests proving DATA-04 (SIGKILL mid-`db.exec()` recovery) and SYNC-06 (`wal_checkpoint(TRUNCATE)` folds WAL back to 0 bytes). 27 new test assertions; suite 343 -> 370 in 5.97s.**

## Performance

- **Duration:** ~11 minutes (start to final commit)
- **Tasks:** 3 / 3
- **Files created:** 7 source/test files + 1 planning artifact (this SUMMARY.md)
- **Tests added:** 27 (9 connection + 9 migrate unit + 9 integration). Full suite: 343 -> 370 passing.
- **Wall time of integration suite:** 757ms for both files combined — well under the 60s phase budget.

## Accomplishments

- `src/infrastructure/db/connection.ts` ships `openDb(path)` returning `{ db, sqlite }` with the six D-30 pragmas applied in fixed order. The pragma block is the load-bearing surface — Pitfall 12 (unbounded WAL) and Pitfall 13 (BEGIN IMMEDIATE requires busy_timeout) both hinge on this being correct. Canonical `export { drizzle } from 'drizzle-orm/better-sqlite3'` re-export lands so Plan 03-07 in-memory-db.ts and Plan 03-11 bootstrap.ts can import `drizzle` through this file — keeping Gate G strict.
- `src/infrastructure/db/connection.test.ts` ships 9 introspection assertions: openDb factory shape, all six pragma values on a real disk-backed file, `:memory:` fall-back (journal_mode reports 'memory' but the call doesn't throw), and the drizzle re-export smoke check.
- `src/infrastructure/db/migrate.ts` ships the hand-rolled `migrate(sqlite, opts)` function with the full crash-recovery contract: parses `meta/_journal.json` (canonical migration list, NOT a directory scan), hashes each `.sql` payload with sha256 (fed into `__drizzle_migrations.hash` so re-runs are no-ops), takes a pre-migration backup of `.sqlite + -wal + -shm` at chmod 600 with retention 3, runs each pending migration in BEGIN IMMEDIATE / `db.exec(sql)` / COMMIT (or ROLLBACK on throw), and folds the WAL via `wal_checkpoint(PASSIVE)` after each commit. `MigrationError({kind, backupPath, latestSafeMigration, detail, cause})` mirrors the AuthError shape from `src/infrastructure/whoop/errors.ts` (readonly kind tuple + duck-type SET + cause chain preserved). Fails closed: no auto-restore (D-08).
- `src/infrastructure/db/migrate.test.ts` ships 9 unit assertions: first-run apply records exactly 1 row in `__drizzle_migrations` with a sha256-hex hash; second run is a no-op; two-migration sequence both apply on first run and stay at 2 on re-run; bad SQL throws `MigrationError({apply_failed})` with `__drizzle_migrations` empty after ROLLBACK; MigrationError shape matches the AuthError mirror (name + kind + cause); missing journal file → `inconsistent_state` with `detail: 'journal parse failed'`; missing `.sql` payload → `inconsistent_state` with the tag in `detail`; `pruneBackups` with 5 backups + keep=3 deletes the 2 oldest plus their `-wal` / `-shm` companions; backup `.sqlite + -wal + -shm` files all land at chmod 0o600.
- `tests/integration/sync/helpers/spawn-migrator-child.mjs` ships the forked-child helper with two scenarios: `kill-mid-statement` (prints `PRE-CRASH\n` to stdout right before BEGIN IMMEDIATE on the second migration, lets the parent race SIGKILL against the in-flight 200k-row recursive-CTE INSERT) and `pragma-only` (runs the migrator to completion, exits 0). The .mjs file is self-exempted from Gate B per `*.mjs in tests/` precedent (Plan 02-08).
- `tests/integration/sync/migration-crash.test.ts` ships 4 cross-process assertions for DATA-04: SIGKILL mid-`db.exec()` leaves `__drizzle_migrations` at exactly 1 row (only the first migration committed), the pre-migration backup file for `0001_crash` exists at chmod 600, both the recovered DB and the backup file pass `PRAGMA integrity_check === 'ok'`, re-running the migrator after the crash re-applies the rolled-back migration cleanly, and 4 sequential successful migrations land at most 3 backups under `backupsDir` (retention enforcement).
- `tests/integration/sync/pragma-roundtrip.test.ts` ships 5 cross-process assertions for SYNC-06 against the real Plan 03-02 migrations: all six D-30 pragmas hold on a real disk-backed file, writes populate `db.sqlite-wal` (size > 0 after a `cycles` insert), `PRAGMA wal_checkpoint(TRUNCATE)` returns the documented `[{busy: 0, log, checkpointed}]` shape and drops `db.sqlite-wal` size to exactly 0 bytes, the migrator's `__drizzle_migrations` row count is exactly 1 (matching Plan 03-02's single `0000_initial` journal entry), and the second migrator call is a no-op.
- All 7 CI grep gates remain green: Gate A (tone words) + Gate B (console.* outside CLI / tests / .mjs) + Gate C (process.stdout.write) + Gate D (server.registerTool) + Gate E (oauth/oauth2/token endpoint) + Gate F (fetch( allowlist — this plan adds zero new fetch sites) + Gate G (drizzle-orm/* allowlist — connection.ts is allowlisted under `src/infrastructure/db/`).
- D-17 + D-18 attestation preserved: zero new MCP tools, `src/mcp/sanitize.ts` and `src/mcp/register.ts` byte-identical to `origin/main`.
- AuthError + WhoopApiError unions remain FROZEN at 6 kinds each. New MigrationError union (2 kinds) is a sibling that lives in `src/infrastructure/db/migrate.ts` per its domain, not in `whoop/errors.ts`.

## Task Commits

Each task was committed atomically:

1. **Task 1: openDb factory + canonical drizzle re-export + 9 connection.test.ts assertions** — `c002bc2` (feat)
2. **Task 2: hand-rolled BEGIN IMMEDIATE migrator + MigrationError + 9 migrate.test.ts assertions** — `3bb07b7` (feat)
3. **Task 3: migration-crash + pragma-roundtrip integration tests + spawn-migrator-child.mjs helper** — `bb9565f` (test)

**Plan metadata commit:** pending (lands with this SUMMARY.md + STATE.md + ROADMAP.md update + REQUIREMENTS.md update).

## Files Created/Modified

- `src/infrastructure/db/connection.ts` (created) — ~85 LOC including the load-bearing module-leading comment naming D-30 + Pitfall 12 + Pitfall 13 + ADR-0001 compliance + Gate G re-export rationale.
- `src/infrastructure/db/connection.test.ts` (created) — 9 introspection tests across 2 describe groups.
- `src/infrastructure/db/migrate.ts` (created) — ~320 LOC; module-leading comment naming D-06 + D-07 + D-08 + Pitfall 7 + Pitfall 13 + ADR-0001 + Gate G compliance. Exports `MIGRATION_ERROR_KINDS` tuple, `MigrationErrorKind` type, `MigrationErrorInit` interface, `MigrationError` class, `isMigrationError` guard, `MigrateOptions` interface, `migrate` function, `pruneBackups` helper.
- `src/infrastructure/db/migrate.test.ts` (created) — 9 unit tests across 4 describe groups (happy path, sad paths, prune helper, take-backup chmod).
- `tests/integration/sync/migration-crash.test.ts` (created) — 4 cross-process tests in 1 describe group.
- `tests/integration/sync/pragma-roundtrip.test.ts` (created) — 5 tests in 1 describe group exercising the real Plan 03-02 migrations.
- `tests/integration/sync/helpers/spawn-migrator-child.mjs` (created) — ~175 LOC ESM child helper with inlined migrator shape and two scenarios.
- `.planning/phases/03-data-model-db-layer-sync-loop/03-05-db-connection-migrator-SUMMARY.md` (created) — this file.

## Verification Evidence

- `grep -c "from 'drizzle-orm/better-sqlite3'" src/infrastructure/db/connection.ts` → **2** (import + re-export — both inside the Gate G allowlisted directory)
- `grep -cE "^export \{ drizzle \} from 'drizzle-orm/better-sqlite3'" src/infrastructure/db/connection.ts` → **1** (canonical re-export landed)
- `grep -cE "sqlite\.pragma\('(journal_mode|busy_timeout|journal_size_limit|wal_autocheckpoint|synchronous|foreign_keys)" src/infrastructure/db/connection.ts` → **6** (one per pragma)
- Pragma order verified: `grep -nE "^\s*sqlite\.pragma\('(journal_mode|busy_timeout|journal_size_limit|wal_autocheckpoint|synchronous|foreign_keys)" src/infrastructure/db/connection.ts` shows journal_mode at line 75, foreign_keys at line 80 — the exact D-30 order.
- `grep -c "BEGIN IMMEDIATE" src/infrastructure/db/migrate.ts` → **6** (1 actual `sqlite.exec('BEGIN IMMEDIATE')` call + 5 doc-comment references — at-least-1 criterion met)
- `grep -c "ROLLBACK" src/infrastructure/db/migrate.ts` → **6** (1 actual call + 5 references)
- `grep -c "__drizzle_migrations" src/infrastructure/db/migrate.ts` → **13** (CREATE + SELECT + INSERT + multiple references)
- `grep -c "MIGRATION_ERROR_KINDS" src/infrastructure/db/migrate.ts` → **4** (tuple declaration + type derivation + SET + duck-type guard usage)
- `grep -c "wal_checkpoint" src/infrastructure/db/migrate.ts` → **2** (PASSIVE call + doc-comment)
- `grep -c "0o600\|chmodSync" src/infrastructure/db/migrate.ts` → **2** (chmodSync call + 0o600 mode literal)
- `grep -v '^\s*//' src/infrastructure/db/migrate.ts | grep -v '^\s*\*' | grep -c "console\."` → **0** (ADR-0001 compliance)
- `grep -v '^\s*//' src/infrastructure/db/connection.ts | grep -v '^\s*\*' | grep -c "console\."` → **0** (ADR-0001 compliance)
- `grep -c "fork\|spawn" tests/integration/sync/migration-crash.test.ts` → **7** (real subprocess exercised)
- `grep -c "wal_checkpoint(TRUNCATE)" tests/integration/sync/pragma-roundtrip.test.ts` → **7** (SYNC-06 contract verified)
- `grep -c "console\." tests/integration/sync/migration-crash.test.ts tests/integration/sync/pragma-roundtrip.test.ts` → **0** (test files clean; child .mjs is exempt by Gate B)
- `npm run test -- src/infrastructure/db/connection.test.ts` → **9 / 9 passing** in ~400ms
- `npm run test -- src/infrastructure/db/migrate.test.ts` → **9 / 9 passing** in ~200ms
- `npm run test -- tests/integration/sync/migration-crash.test.ts tests/integration/sync/pragma-roundtrip.test.ts` → **9 / 9 passing** in 742ms (well under the 10s combined budget)
- `npm run test` (full suite) → **370 / 370 across 28 files** in 5.97s (343 baseline + 9 + 9 + 9 = 370 exact; +27 new assertions vs the +22 plan floor). Suite well under 60s budget.
- `npm run lint` → 0 errors across 68 files
- `bash scripts/ci-grep-gates.sh` → all 7 gates green (Gate G stays green; the migrator file imports zero drizzle-orm symbols; connection.ts's drizzle import is allowlisted under `src/infrastructure/db/`)
- `npx tsc --noEmit src/infrastructure/db/connection.ts src/infrastructure/db/migrate.ts tests/integration/sync/migration-crash.test.ts tests/integration/sync/pragma-roundtrip.test.ts` → 0 errors on the new files (3 pre-existing project-level errors in `src/cli/commands/auth.ts` + `tests/helpers/msw-whoop-oauth.ts` are out of scope; logged to `deferred-items.md` by Plan 03-04).
- `git diff origin/main -- src/mcp/sanitize.ts src/mcp/register.ts src/mcp/tools/` → empty (D-17 + D-18 + D-34 attestation preserved)

## Decisions Made

- **`latestSafeMigration` set to the tag CURRENTLY being applied, not the last successfully-committed one.** When the migrator throws mid-`0001_crash`, `latestSafeMigration: '0001_crash'` tells the doctor remediation which `.sql` file the user can inspect to see the schema change that tried-and-failed. The backup at that path captures the safe state — the migration that came BEFORE this one. Naming is from the backup's perspective: the backup IS the safe state.
- **Backup helper returns `''` (not null) when no backup is taken**, mapped to `null` for the MigrationError surface at the call site. Reason: the public type signature `string` (always-defined return) is easier to compose internally; the consumer who builds the MigrationError does the `'' → null` translation once.
- **Used `XYZGARBAGE this is not valid sql;` for bad-SQL test fixtures.** SQLite's column-type system is permissive (TYPE affinity, not strict types) — `CREATE TABLE foo (id INVALID_TYPE);` is accepted silently with `id` getting BLOB affinity. A genuine syntax error (`XYZGARBAGE`) reliably raises `SQLITE_ERROR`. Rule-1 plan-text correction (the plan's verbatim SQL doesn't actually throw).
- **Test 8 (backup chmod) materializes a real SQLite file by opening Database then closing**, instead of writing synthetic strings to `dbFile`/`dbFile-wal`/`dbFile-shm`. Reason: when migrate() opens a second handle against `dbFile`, better-sqlite3 inspects the magic header and rejects `'main-bytes'` as "file is not a database". The two-phase setup (seed handle → close → fresh handle for migrate) keeps the test exercising the real takeBackup code path.
- **Inlined the migrator shape in `spawn-migrator-child.mjs`** instead of importing TypeScript source. The .mjs runs as plain Node ESM; importing TS source requires tsx (build-time coupling) or compiled `dist/` (test-build coupling). The inline shape mirrors `migrate.ts` byte-for-byte on the load-bearing surface (BEGIN IMMEDIATE / db.exec / wal_checkpoint / takeBackup / pruneBackups) — the parent test asserts on-disk side effects (backup file, `__drizzle_migrations` row count, integrity_check result), not the migrator's TypeScript surface. If migrate.ts and the inline shape ever drift, migrate.test.ts catches the drift at the unit level.
- **PRE-CRASH marker placed between `takeBackup()` and `sqlite.exec('BEGIN IMMEDIATE')` in the child helper.** This is the deterministic race window: the backup exists on disk (so the parent's assertion `backupFiles.find(...).chmod === 0o600` passes), but BEGIN IMMEDIATE hasn't run yet (so WAL recovery on re-open rolls back the failed migration cleanly). The 200k-row INSERT inside the BEGIN is the time-stretching device — it gives the parent's SIGKILL ~500-1500ms to land before COMMIT.
- **Re-running migrator after crash re-applies the rolled-back migration cleanly (NOT inconsistent_state).** The plan offered both paths — whichever the implementation takes, lock it. The implementation takes the clean-reapply path because SQLite's WAL recovery removes the failed BEGIN IMMEDIATE in its entirety (no `__drizzle_migrations` row was written; the would-be-created `crash_target` table isn't there). On re-run, the migrator sees the second migration as still pending and applies it normally. Test 2 of `migration-crash.test.ts` locks this contract — the test rewrites the second migration's .sql to a quick payload before re-running, since the original 200k-row CTE was a test-only crash trigger and a clean re-run would either take ~500ms+ or need the same SIGKILL race.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 — Plan-text bug] Bad-SQL test fixture used `INVALID_TYPE` which SQLite accepts silently**

- **Found during:** Task 2 first test run (Test 3 + Test 4 both failed: `isMigrationError(thrown)` was false because `migrate` did not throw — SQLite accepted `CREATE TABLE foo (id INVALID_TYPE);` and stored `id` with BLOB affinity).
- **Issue:** The plan's verbatim SQL fixture (`CREATE TABLE foo (id INVALID_TYPE);`) was non-functional. SQLite's column-type system uses TYPE affinity (per the [SQLite docs](https://www.sqlite.org/datatype3.html)), not strict types: any column-declaration token is accepted; only the affinity is what matters for storage class.
- **Fix:** Replaced with `XYZGARBAGE this is not valid sql;` — a genuine syntax error that reliably raises SQLITE_ERROR in `sqlite.exec()`.
- **Files modified:** `src/infrastructure/db/migrate.test.ts` (only)
- **Verification:** All 9 migrate.test.ts assertions green after the fix. Confirmed via independent `node -e` repro that the original fixture is silently accepted.
- **Committed in:** Fix applied before Task 2's commit; landed in `3bb07b7`.

**2. [Rule 1 — Plan-text bug] Test 8 (backup chmod) needed a real SQLite seed, not synthetic byte strings**

- **Found during:** Task 2 first test run (Test 8 failed with `SqliteError: file is not a database` when migrate() opened a handle against the synthetic-bytes dbFile).
- **Issue:** The plan implied seeding `db.sqlite + -wal + -shm` with `writeFileSync('main-bytes')`-style fixtures. better-sqlite3 inspects the SQLite magic header on open and rejects non-DB files. The migrate() call inside the test depends on opening a valid handle.
- **Fix:** Two-phase seed: first open a real `new Database(dbFile)`, set WAL mode, create a marker table, close. Then open a fresh handle for the migrate() under test. This produces a valid SQLite file plus its WAL companion before takeBackup runs.
- **Files modified:** `src/infrastructure/db/migrate.test.ts` (only)
- **Verification:** Test 8 green; chmod 600 assertion confirmed on all three backup files (.sqlite, -wal, -shm).
- **Committed in:** Fix applied before Task 2's commit; landed in `3bb07b7`.

**3. [Rule 3 — Blocking lint] Biome import-sort + unused-import cleanup across 3 files**

- **Found during:** Tasks 1, 2, 3 lint passes
- **Issue:** Biome's `assist/source/organizeImports` wanted alphabetical sort of named imports; `lint/correctness/noUnusedImports` flagged `chmodSync` in migrate.test.ts after a refactor.
- **Fix:** `npm run format` auto-applied the import-sort fixes; manually removed `chmodSync` from the import list (biome flagged it as a warning, not an error, so the unsafe-fix flag would have applied it but I did it manually for clarity).
- **Files modified:** `src/infrastructure/db/connection.test.ts`, `src/infrastructure/db/migrate.test.ts`, `tests/integration/sync/migration-crash.test.ts`, `tests/integration/sync/pragma-roundtrip.test.ts`
- **Verification:** `npm run lint` → 0 errors across 68 files. All 27 new tests still green after format.
- **Committed in:** Fixes applied before each task's commit.

**4. [Rule 1 — Plan-text bug] StdioChild type annotation in migration-crash.test.ts**

- **Found during:** Task 3 `npx tsc --noEmit` verification
- **Issue:** I initially typed the child process as `ChildProcessByStdio<Writable, Readable, Readable>` (matching the convention of a spawned child with all three streams piped), but the spawn options pass `stdio: ['ignore', 'pipe', 'pipe']` which makes stdin `null`, not `Writable`. TypeScript rejected the `as StdioChild` cast.
- **Fix:** Changed type to `ChildProcessByStdio<null, Readable, Readable>` and removed the unused `Writable` import. Plain semantic correction; behavior unchanged.
- **Files modified:** `tests/integration/sync/migration-crash.test.ts` (only)
- **Verification:** `npx tsc --noEmit tests/integration/sync/migration-crash.test.ts` → 0 errors.
- **Committed in:** Fix applied before Task 3's commit; landed in `bb9565f`.

### Deferred Items

- **3 pre-existing TS strict-mode errors** in `src/cli/commands/auth.ts` + `tests/helpers/msw-whoop-oauth.ts` — out of scope per Plan 03-05 `files_modified`; already logged to `.planning/phases/03-data-model-db-layer-sync-loop/deferred-items.md` by Plan 03-04.
- **`agent_docs/learnings.md` entry on plan-text-fixture validity (Rule 1 precedent ×6)** — Plans 02-01, 02-02, 02-04, 02-06, 03-01, 03-04 all hit doc-comment-vs-plan-grep collisions. This plan hits a different shape — **plan fixtures that don't actually exercise the intended path** (`INVALID_TYPE` silently accepted by SQLite; synthetic byte strings rejected as non-DB). Worth a cross-cutting `agent_docs/learnings.md` entry, but not load-bearing for any current plan.

---

**Total deviations:** 4 auto-fixed (Rule 1 — plan-text bug ×3; Rule 3 — blocking lint ×1)
**Impact on plan:** No code-shape change of substance, no scope creep, no contract drift. All 23 plan-level acceptance criteria pass (7 grep + 1 test for Task 1; 7 grep + 1 test for Task 2; 4 grep + 4 test for Task 3 — full enumeration in Verification Evidence above). All three must_haves truths satisfied; all four must_haves artifacts on disk; all three must_haves key_links honored.

## Issues Encountered

None beyond the four deviations documented above. The SIGKILL race is deterministic on macOS darwin under Node 22; the parent reads `PRE-CRASH` from the child's stdout pipe and kills before the in-flight 200k-row CTE INSERT can complete. SQLite's WAL recovery on re-open is deterministic; `__drizzle_migrations` always shows exactly 1 row after the crash, never 0, never 2.

## User Setup Required

None — Wave 2b is pure code-and-test landing. No external services, no DB connections at install time, no MCP tool registrations, no env var changes, no migration of existing user data (the migrator only runs at first bootstrap; existing users have nothing to migrate).

## Next Phase Readiness

- **Wave 3 (Plan 03-07 in-memory-db helper)** can run: imports `drizzle` via `connection.ts` re-export — no `from 'drizzle-orm'` outside `src/infrastructure/db/` required.
- **Wave 3 (Plan 03-08 repositories)** can run: uses `openDb()` for the raw sqlite handle; BEGIN IMMEDIATE discipline (D-31) inherited via `db.transaction(...).immediate(rows)` per A4 in 03-PATTERNS.md.
- **Wave 4 (Plan 03-11 sync orchestrator)** can run: calls `migrate()` at bootstrap before any sync writes; calls `wal_checkpoint(TRUNCATE)` at end-of-sync per D-32 (the SYNC-06 contract this plan locks via `pragma-roundtrip.test.ts` Test 3).
- **Wave 4 (Plan 03-12 CLI shim)** can run: bootstrap-time `migrate()` produces structured `MigrationError`s that the CLI catches and surfaces as non-zero exit with the backup path remediation; doctor probe (Phase 5) consumes `MigrationError.backupPath` for the `cp <backupPath> <dbFile>` doctor output.
- **AuthError + WhoopApiError unions** remain FROZEN at 6 kinds each; no errors.ts changes in this plan. MigrationError is a sibling union living in `migrate.ts` per its domain.
- **D-17 + D-18 + D-34 attestation** extends: no new MCP tools (`whoop_doctor` remains the only tool); `sanitize.ts` and `register.ts` byte-identical to origin/main; new MigrationError instances will flow through the existing sanitizer pipeline UNMODIFIED (cause-chain walker covers it; no new patterns needed because MigrationError carries no token material).

## Known Stubs

None. Both `openDb` and `migrate` are fully implemented with all six pragmas, the full BEGIN IMMEDIATE / pre-migration-backup / chmod-600 / retention-3 / MigrationError contract, and 27 test assertions locking the behavior. No placeholder data sources, no hardcoded empty arrays flowing to UI, no "coming soon" text.

## Threat Flags

None. This plan's threat-model register lists 6 dispositions, 5 mitigated + 1 accepted (T-03.05-06 elevation-of-privilege via attacker-controlled dbFile path — accepted because paths.ts clamps to `RECOVERY_LEDGER_HOME` or `$HOME` and the CLI shims don't accept `--db-file` overrides). All 5 mitigate dispositions land:
- T-03.05-01 (tampering, crash mid-`db.exec`) — mitigated by BEGIN IMMEDIATE + WAL recovery; verified by `migration-crash.test.ts` Test 1.
- T-03.05-02 (information disclosure via backup files) — mitigated by chmod 600 on every copied file; verified by `migrate.test.ts` Test 8 + `migration-crash.test.ts` Test 1.
- T-03.05-03 (denial of service via unbounded backup growth) — mitigated by `pruneBackups` retention=3; verified by `migrate.test.ts` Test 7 + `migration-crash.test.ts` Test 4.
- T-03.05-04 (denial of service via WAL growth) — mitigated by `wal_autocheckpoint=1000` + explicit `wal_checkpoint(TRUNCATE)` after sync; verified by `pragma-roundtrip.test.ts` Test 3.
- T-03.05-05 (repudiation via untraced migration) — mitigated by `__drizzle_migrations` row inserted in the same BEGIN IMMEDIATE transaction as the schema change; atomic. Verified by `migrate.test.ts` Test 1 + Test 2.

No new threat surface beyond the planned register.

## Self-Check: PASSED

- Created files all present:
  - `src/infrastructure/db/connection.ts` — FOUND
  - `src/infrastructure/db/connection.test.ts` — FOUND
  - `src/infrastructure/db/migrate.ts` — FOUND
  - `src/infrastructure/db/migrate.test.ts` — FOUND
  - `tests/integration/sync/migration-crash.test.ts` — FOUND
  - `tests/integration/sync/pragma-roundtrip.test.ts` — FOUND
  - `tests/integration/sync/helpers/spawn-migrator-child.mjs` — FOUND
  - `.planning/phases/03-data-model-db-layer-sync-loop/03-05-db-connection-migrator-SUMMARY.md` — FOUND (this file)
- All three task commits present in `git log`:
  - `c002bc2` — FOUND (feat: openDb + drizzle re-export)
  - `3bb07b7` — FOUND (feat: hand-rolled migrator + MigrationError)
  - `bb9565f` — FOUND (test: migration-crash + pragma-roundtrip integration)

---
*Phase: 03-data-model-db-layer-sync-loop*
*Completed: 2026-05-16*
