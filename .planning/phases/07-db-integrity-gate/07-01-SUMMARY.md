---
phase: 07-db-integrity-gate
plan: 01
req_ids: [DBIN-01]
github_issue: "#75"
status: complete
completed: 2026-05-31
---

# Plan 07-01 Summary — DBIN-01 `aborted` enum dedup + madge CI gate (#75)

## Result

Closed issue #75. `sync_runs.status` enum is now defined ONCE in `src/domain/types/sync-run-status.ts` and imported by Drizzle column, Zod entity schema, QueryCacheInput, repo `byStatus`, and the `SyncRun` entity type. A new `madge --circular src/` CI gate (with type-only imports skipped via `.madgerc`) prevents future ESM cycles that would resolve to `undefined` at runtime.

## Changes

### Production (6 files)
- **NEW** `src/domain/types/sync-run-status.ts` — single source of truth (`SYNC_RUN_STATUSES = ['running', 'ok', 'partial', 'failed', 'aborted'] as const`; `SyncRunStatus` derived type).
- `src/infrastructure/db/schema.ts` — Drizzle column enum now `[...SYNC_RUN_STATUSES]` (spread preserves literal types Drizzle needs for inference).
- `src/domain/schemas/entities.ts` — Zod enum `z.enum(SYNC_RUN_STATUSES)` (was missing `'aborted'` — root of the latent bug).
- `src/domain/types/entities.ts` — `SyncRun.status` uses `SyncRunStatus` type alias.
- `src/services/cache/types.ts` — `QueryCacheInput['sync_runs'].status` uses `SyncRunStatus` (was missing `'aborted'`).
- `src/infrastructure/db/repositories/sync-runs.repo.ts` — `byStatus` parameter uses `SyncRunStatus` (was missing `'aborted'`).

### CI / Tooling
- **NEW** `.madgerc` — `detectiveOptions.ts.skipTypeImports: true` (skips TypeScript type-only imports so pre-existing intra-doctor type cycles don't gate CI).
- `package.json` — added `madge` dev dependency + `npm run check:circular` script.
- `.github/workflows/ci.yml` — new "Circular-dependency check" step before Build.

### Tests
- `src/infrastructure/db/repositories/sync-runs.repo.test.ts`
  - New describe block "DBIN-01 'aborted' enum round-trip (#75)" with 2 tests:
    - Inserts `running` row, calls `reclassifyStaleRunning(0, ...)` to flip it to `aborted`, queries via `byStatus('aborted', ...)`, asserts the row round-trips through `SyncRunEntitySchema.parse()` without throwing (pre-DBIN-01 would have thrown because Zod enum lacked `'aborted'`).
    - Pins `SYNC_RUN_STATUSES = ['running', 'ok', 'partial', 'failed', 'aborted']`.

## Acceptance

- `npm run lint`: clean (1 pre-existing `useTemplate` info on `recovery.ts:59` unrelated).
- `npm run typecheck`: clean.
- `npm run build`: clean ESM build.
- `npm run test`: 1334 passed / 1 skipped / 0 failed (+10 from DBIN-01 — 2 new + 8 existing tests now exercise the round-trip path consistently).
- `bash scripts/ci-grep-gates.sh`: all gates passed.
- `npm run check:circular`: ✔ No circular dependency found!

## Deviations from CONTEXT.md

- **`.madgerc` with `skipTypeImports`** added to handle pre-existing 13 type-only cycles in `services/doctor/checks/*.ts` ↔ `services/doctor/index.ts` (each check imports `DoctorCheck` type from the index). Type-only imports are erased at runtime, so they're not real ESM cycles — marked as Phase 10 architecture work, not a DBIN-01 concern.

## Phase 7 success criteria advanced

- ✅ Criterion #1: `aborted` enum defined ONCE; Drizzle / Zod / QueryCache / repo `byStatus` all reference the shared constant; `madge --circular src/` green in CI.
- ⏭️  Criteria #2-#5: deferred to DBIN-02..05 (Plans 07-02..07-05).
