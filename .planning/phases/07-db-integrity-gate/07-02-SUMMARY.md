---
phase: 07-db-integrity-gate
plan: 02
req_ids: [DBIN-03]
github_issue: "#77"
status: complete
completed: 2026-06-01
---

# Plan 07-02 Summary — DBIN-03 score_state CHECK constraints (#77)

## Result

Closed issue #77. SQLite CHECK constraints now enforce the `score_state` discriminated-union invariant at the SQL layer for cycles / recoveries / sleeps / workouts. Pre-DBIN-03 a hand-crafted INSERT (manual SQL, future migration mistake, partial restore) could silently land a violator row, and the defensive `rowToCycle` throw turned one bad row into a total query failure (ADR-0003 was a comment, not enforcement).

## Changes

### Production (2 files)
- **NEW** `src/infrastructure/db/migrations/0001_score_state_check_constraints.sql` — 12-step SQLite rename for each of cycles / recoveries / sleeps / workouts. `PRAGMA defer_foreign_keys = ON` defers the recoveries→cycles FK check until COMMIT so dropping `cycles` mid-transaction does not cascade-abort.
- **MODIFIED** `src/infrastructure/db/migrations/meta/_journal.json` — entry for 0001 added.
- **MODIFIED** `src/infrastructure/db/schema.ts` — `check()` calls on each of the 4 scored tables so future drizzle-kit generates carry the constraint and the schema documents the invariant.

### Tests (3 files)
- `src/infrastructure/db/repositories/cycles.repo.test.ts`
  - New "DBIN-03 CHECK constraint enforces score_state invariant (#77)" describe with 4 tests: rejects SCORED-with-null-strain, rejects PENDING_SCORE-with-non-null-strain, accepts valid SCORED, accepts valid PENDING_SCORE.
- `tests/integration/sync/pragma-roundtrip.test.ts`
  - Test 2/Test 3: changed two INSERT statements from `SCORED` (without metric columns — now caught by the CHECK) to `PENDING_SCORE` (valid under the new constraint; WAL behavior is independent of score state).
  - Test 4: assertion now `>= 2` and validates every hash matches sha256 shape (was hard-coded to 1; would always fail with the new migration in journal).
  - Test 5: row-count snapshot before/after second migrate() call replaces the hard-coded `toHaveLength(1)`.

## Acceptance

- `npm run lint`: clean (1 pre-existing `useTemplate` info on `recovery.ts:59` unrelated).
- `npm run typecheck`: clean.
- `npm run build`: clean ESM build.
- `npm run test`: 1338 passed / 1 skipped / 0 failed (+4 from DBIN-03 CHECK regression tests).
- `bash scripts/ci-grep-gates.sh`: all gates passed.
- `npm run check:circular`: ✔ No circular dependency found!

## Deviations from PLAN.md (originally specified for DBIN-03)

- **Pre-flight `RAISE(ABORT)` was dropped.** SQLite restricts `RAISE()` to triggers — `SELECT RAISE(ABORT, ...)` returns `SqliteError: RAISE() may only be used within a trigger-program`. Replaced with the natural fallback: if any pre-existing row violates the new CHECK, the `INSERT INTO <table>_new SELECT * FROM <table>` step fails with `SqliteError: CHECK constraint failed: <table>_score_state_invariant` — the constraint name names the issue, the migrator surfaces it via MigrationError, and the pre-migration backup is the rollback path (D-08).
- **No separate data-cleanup migration** (the two-step migration from PITFALLS.md) — v1.0 mappers always wrote NULL for SCORED-only columns when scoreState ∈ {PENDING_SCORE, UNSCORABLE}, so no legacy violators are expected in real DBs. If one slipped in via hand-crafted SQL, the constraint name + remediation path is clear.

## Phase 7 success criteria advanced

- ✅ Criterion #2: SCORED requires all 4 metric columns non-null; PENDING_SCORE/UNSCORABLE requires all 4 null; CHECK enforced at SQL write-time; migration is single-step with the constraint name carrying the diagnostic; rollback documented via pre-migration backup.
- ⏭️  Criteria #3-#5: deferred to DBIN-02 (#76), DBIN-04 (#88), DBIN-05 (#94).
