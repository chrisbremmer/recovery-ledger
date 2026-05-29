---
phase: 05-doctor-polish-install-guide-20-minute-setup-validation
plan: 03
subsystem: database
tags: [doctor, sqlite, better-sqlite3, wal, integrity-check, drizzle-migrations, dependency-injection]

# Dependency graph
requires:
  - phase: 05-doctor-polish-install-guide-20-minute-setup-validation (Plan 05-01)
    provides: CHECK_NAMES DB_OPEN/DB_INTEGRITY/DB_SCHEMA_VERSION/DB_WAL_SIZE constants + RunDoctorOptions.sqlite injected handle field
  - phase: 03-data-model-db-layer-sync-loop
    provides: openDb() + D-30 pragma block (journal_size_limit=67108864), hand-rolled migrator + __drizzle_migrations table
provides:
  - probeDbOpen({sqlite?}) → DoctorCheck (DB-layer-alive signal via journal_mode pragma)
  - probeDbIntegrity({sqlite?}) → DoctorCheck (PRAGMA integrity_check corruption signal)
  - probeDbSchemaVersion({sqlite?, migrationsDir?}) → DoctorCheck (__drizzle_migrations row count vs .sql file count)
  - probeDbWalSize({dbFile?}) → DoctorCheck (WAL companion-file size vs 32MB/64MB thresholds)
affects: [05-06 (runDoctor wiring), 05-09 (troubleshooting docs keyed off db_schema_version anchor)]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Doctor probe canonical shape (async () => Promise<DoctorCheck>, structured try/catch, no-handle structured fail)"
    - "DB probes consume injected RunDoctorOptions.sqlite handle (no self-opened connections) per RESEARCH §Open Questions §1"
    - "Raw better-sqlite3 pragma()/prepare() in the services layer — no drizzle-orm import (Gate G discipline at the probe boundary)"

key-files:
  created:
    - src/services/doctor/checks/db-open.ts
    - src/services/doctor/checks/db-open.test.ts
    - src/services/doctor/checks/db-integrity.ts
    - src/services/doctor/checks/db-integrity.test.ts
    - src/services/doctor/checks/db-schema-version.ts
    - src/services/doctor/checks/db-schema-version.test.ts
    - src/services/doctor/checks/db-wal-size.ts
    - src/services/doctor/checks/db-wal-size.test.ts
  modified: []

key-decisions:
  - "db_wal_size threshold tests use real Buffer.alloc fixture WAL files in a tmp dir (mkdtempSync), not vi.spyOn(fs.statSync) — honest end-to-end coverage of statSync + path resolution; the plan offered both and documented the spy alternative as acceptable."
  - "db_open passes (not fails) on non-WAL journal_mode (e.g. :memory: reports 'memory') — db_open is the 'handle is alive' signal; db_integrity is the corruption check."

patterns-established:
  - "Pattern: DB doctor probe — injected handle, structured no-handle fail, three-arm status return, never throws (all error paths caught)."

requirements-completed: [DOC-01]

# Metrics
duration: ~10min
completed: 2026-05-28
---

# Phase 5 Plan 03: DB Doctor Probes Summary

**Four atomic DB-health doctor probes (db_open, db_integrity, db_schema_version, db_wal_size) — each a standalone dependency-injected module returning a structured DoctorCheck, with 16 unit tests covering pass/warn/fail and no-handle arms.**

## Performance

- **Duration:** ~10 min
- **Tasks:** 4 (all TDD)
- **Files created:** 8 (4 probes + 4 tests)
- **Files modified:** 0

## Accomplishments

- **db_open** — reads `journal_mode` as a no-op pragma proxy for "DB layer is alive"; pass on WAL ("WAL journal mode confirmed") or any live handle (`DB open, journal_mode=<mode>`); fail when no handle injected or the pragma throws.
- **db_integrity** — runs SQLite's canonical `PRAGMA integrity_check`; pass iff exactly one `{integrity_check: 'ok'}` row; fail on multi-row/non-ok content or a throw (reproduces RESEARCH §Pattern 1 verbatim).
- **db_schema_version** — compares `SELECT COUNT(*) FROM __drizzle_migrations` against the count of `.sql` files in `src/infrastructure/db/migrations/`; pass on equal counts; fail-with-backup-hint when dbCount < fileCount; fail-with-troubleshooting-anchor (`docs/install/troubleshooting.md#db_schema_version`) when dbCount > fileCount (orphaned row); fail-on-throw (missing table).
- **db_wal_size** — `statSync(<dbFile>-wal, {throwIfNoEntry:false})`; pass at <=32MB (and on missing -wal file), warn at <=64MB ("checkpoint is lagging"), fail above the journal_size_limit=64MB cap. Thresholds are file-level consts (`WAL_WARN_BYTES`/`WAL_FAIL_BYTES`) matching Phase 3 D-30's `journal_size_limit=67108864`.

## Files Created/Modified

- `src/services/doctor/checks/db-open.ts` — probeDbOpen + DbOpenProbeDeps
- `src/services/doctor/checks/db-open.test.ts` — 3 cases (no-handle fail, live-handle pass, throw fail)
- `src/services/doctor/checks/db-integrity.ts` — probeDbIntegrity + DbIntegrityProbeDeps
- `src/services/doctor/checks/db-integrity.test.ts` — 4 cases (no-handle, healthy pass, multi-row fail, throw fail)
- `src/services/doctor/checks/db-schema-version.ts` — probeDbSchemaVersion + DbSchemaVersionProbeDeps + resolveDefaultMigrationsDir/findLatestBackup helpers
- `src/services/doctor/checks/db-schema-version.test.ts` — 5 cases (no-handle, counts-match pass, missing-migration fail, orphaned-row fail, missing-table throw)
- `src/services/doctor/checks/db-wal-size.ts` — probeDbWalSize + DbWalSizeProbeDeps + WAL_WARN_BYTES/WAL_FAIL_BYTES consts
- `src/services/doctor/checks/db-wal-size.test.ts` — 4 cases (no -wal pass, small pass, 40MB warn, 70MB fail)

16 test cases total (3+4+5+4), all green.

## Decisions Made

- **db_wal_size test fixtures:** chose real `Buffer.alloc` fixture WAL files written into a `mkdtempSync` tmp dir over `vi.spyOn(fs, 'statSync')`. The plan permitted either; real files exercise the probe's actual statSync + `${dbFile}-wal` path resolution end-to-end, including the `throwIfNoEntry:false` missing-file arm. The 70MB allocation is a one-time write (statSync reads inode metadata only, O(1)); Vitest's 5s default timeout is ample. Documented per plan Task 4 note.
- **db_open non-WAL handling:** non-WAL `journal_mode` (e.g. `:memory:` reports `memory`) returns a `pass` with the observed mode, not a fail — db_open is only the "handle is alive" signal; corruption is db_integrity's job. The in-memory test accepts either the WAL detail or the observed-mode detail accordingly.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Reworded a doc-comment that tripped CI Gate F**
- **Found during:** Task 4 (db-wal-size.ts), at the post-implementation `scripts/ci-grep-gates.sh` verification
- **Issue:** The file-header comment literally contained the token `` `fetch(` `` (in the prose "no `drizzle-orm`, no `fetch(`."). Gate F's regex `\bfetch\s*\(` is a literal-string scan that does not skip comments, so it flagged the comment line as a forbidden fetch call site.
- **Fix:** Reworded the comment to "No `drizzle-orm` import, and no network calls — this is a pure local-filesystem read." (drops the bare `fetch(` token; the intent is unchanged).
- **Files modified:** src/services/doctor/checks/db-wal-size.ts (comment only — no behavior change)
- **Verification:** `bash scripts/ci-grep-gates.sh` exits 0; the 4 probe tests stayed green; tsc unchanged.

---

**Total deviations:** 1 auto-fixed (1 blocking)
**Impact on plan:** Comment-only reword to satisfy a literal-string CI gate. No behavior change, no scope creep.

## Issues Encountered

None beyond the Gate F comment collision above.

## Verification Gate Results

- `npx vitest run` (4 probe test files): **16 passed (4 files)**.
- `npx tsc --noEmit`: **6 errors — identical to the documented pre-existing baseline** (src/cli/commands/auth.ts, src/infrastructure/db/repositories/sync-runs.repo.ts ×3, tests/helpers/msw-whoop-oauth.ts ×2). Zero new errors introduced. Diff against the captured baseline is empty.
- `bash scripts/ci-grep-gates.sh`: **All grep gates passed (exit 0)** — including Gate B (no console.*) and Gate G (no drizzle-orm import) in the new probe files.
- `npm run build`: **NOT RUN** — per execution instructions (parallel agents share the working directory; build would clobber dist/).

## Next Phase Readiness

- All 4 DB probes are independently testable and import nothing from each other. Plan 05-06 wires them into `runDoctor()` alongside the other Wave 1 probes, passing the bootstrap-constructed handle via `RunDoctorOptions.sqlite`.
- `db_schema_version` detail strings include the literal `db_schema_version` anchor for the Plan 05-09 troubleshooting H2.
- Files are left UNSTAGED and UNCOMMITTED per instructions — the orchestrator commits after all parallel Wave 1 agents return.

## Self-Check: PASSED

Created-file existence and probe-test results verified (see Verification Gate Results). No STATE.md/ROADMAP.md updates performed here by design — the parallel-execution orchestrator owns the commit + state sync.

---
*Phase: 05-doctor-polish-install-guide-20-minute-setup-validation*
*Completed: 2026-05-28*
