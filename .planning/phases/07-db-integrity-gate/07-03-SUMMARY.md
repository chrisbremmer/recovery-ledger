---
phase: 07-db-integrity-gate
plan: 03
req_ids: [DBIN-02]
github_issue: "#76"
status: complete
completed: 2026-06-01
---

# Plan 07-03 Summary — DBIN-02 sleeps/workouts byRange exclusion (#76)

## Result

Closed issue #76. `sleeps.byRange` and `workouts.byRange` now exclude DST-straddle / tz-drift rows by default via a `NOT EXISTS` time-overlap subquery onto the parent cycle. Pre-DBIN-02, sleeps treated `includeExcluded` as a documented no-op and workouts did not accept the option at all — both leaked excluded rows into baseline aggregations.

## Changes

### Production (2 files)
- `src/infrastructure/db/repositories/sleep.repo.ts`
  - Default-path `byRange` now appends a `NOT EXISTS (SELECT 1 FROM cycles WHERE cycles.start <= sleeps.start AND COALESCE(cycles.end, sleeps.start) >= sleeps.start AND cycles.baseline_excluded = 1)` predicate.
  - Module comment block updated: dropped the "Phase 3 keeps baseline-excluded gating ON CYCLES ONLY" claim that DBIN-02 invalidates (preserved the schema rationale for not denormalizing `cycle_id`).
  - `cyclesTable` import added.
- `src/infrastructure/db/repositories/workouts.repo.ts`
  - Same `NOT EXISTS` pattern; mirrors sleep.
  - `cyclesTable` import added.

### Tests (1 new file)
- **NEW** `src/infrastructure/db/repositories/sleep-workouts-byrange-join.test.ts`
  - 5 tests across two describe blocks (sleep + workouts):
    - Default filter excludes a sleep/workout whose start falls inside a DST-straddle cycle.
    - `includeExcluded: true` returns both rows.
    - Orphan sleep (no parent cycle synced yet) is KEPT — absence-of-evidence is not evidence-of-exclusion.

## Acceptance

- `npm run lint`: clean (1 pre-existing `useTemplate` info on `recovery.ts:59` unrelated).
- `npm run typecheck`: clean.
- `npm run build`: clean.
- `npm run test`: 1343 passed / 1 skipped / 0 failed (+5 from DBIN-02 regression tests).
- `bash scripts/ci-grep-gates.sh`: all gates passed.
- `npm run check:circular`: ✔ No circular dependency found.

## Deviations from CONTEXT.md

- **INNER JOIN → NOT EXISTS.** First attempt used `innerJoin` which excluded ALL orphan rows (sleeps/workouts whose parent cycle wasn't yet in the DB). This regressed multiple contract tests (`sleep.test.ts` Test 1/3/4, `workouts.test.ts`, `cache/index.test.ts`, `idempotency.test.ts`). Switched to `NOT EXISTS` subquery: a row is excluded ONLY IF a covering cycle exists AND that cycle is `baseline_excluded`. Orphans pass through — the conservative default ("don't drop rows we cannot prove belong to a DST-straddle cycle"). Production order syncs cycles before sleeps/workouts so the orphan window is small in practice, but tests + partial syncs don't have that guarantee.
- **No data migration** — exclusion is computed at query time, not denormalized at upsert. Option (a) from the issue (denormalize `cycle_id`) would be index-friendlier but requires a schema change and is out of scope for v1.1.

## Phase 7 success criteria advanced

- ✅ Criterion #3: `sleeps.byRange` and `workouts.byRange` exclude DST/tz-flagged rows by default via parent-cycle JOIN; `includeExcluded: true` round-trips both excluded and non-excluded rows.
- ⏭️  Criteria #4-#5: deferred to DBIN-04 (#88), DBIN-05 (#94).
