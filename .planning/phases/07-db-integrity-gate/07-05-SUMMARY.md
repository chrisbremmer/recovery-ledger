---
phase: 07-db-integrity-gate
plan: 05
req_ids: [DBIN-05]
github_issue: "#94"
status: complete
completed: 2026-06-01
---

# Plan 07-05 Summary — DBIN-05 wal_checkpoint incomplete escalation (#94)

## Result

Closed issue #94. Back-to-back `wal_checkpoint(TRUNCATE)` failures now escalate: the per-run failure marker is persisted on `sync_runs.flags` (merge-preserving JSON update), and the second consecutive incomplete checkpoint logs an `error`-level `wal_checkpoint_incomplete_consecutive` event with a remediation hint. Pre-DBIN-05, repeated incomplete checkpoints silently grew the WAL up to the 64 MiB `journal_size_limit`; the existing `db_wal_size` doctor probe surfaced the consequence but had no upstream signal to correlate.

## Changes

- `src/infrastructure/db/repositories/sync-runs.repo.ts` — two new methods:
  - `markCheckpointIncomplete(id)` merges `{walCheckpointIncomplete: true}` into the row's flags JSON (preserving CLI input echo).
  - `previousCheckpointWasIncomplete()` returns true iff the IMMEDIATELY-PRECEDING finished sync_run (excludes `running`/`aborted`) carries the marker. Strict "twice in a row" — an older marked run with a clean run after it does NOT trigger.
- `src/services/sync/index.ts` — incomplete-checkpoint block now (a) reads `previousCheckpointWasIncomplete()` BEFORE marking, (b) marks the current run, (c) emits `error`-level `wal_checkpoint_incomplete_consecutive` with a remediation pointer when the predecessor was also incomplete.
- `src/infrastructure/db/repositories/sync-runs.repo.test.ts` — 6 new tests:
  - markCheckpointIncomplete merges into existing flags + handles null flags.
  - previousCheckpointWasIncomplete: false when empty / true when predecessor marked / false when a clean run intervened / skips `running` rows when finding the predecessor.

## Acceptance

- `npm run test`: 1351 passed / 1 skipped / 0 failed (+6 from DBIN-05).
- `npm run typecheck`: clean.
- `npm run lint`: clean.
- `npm run build`: clean.
- `bash scripts/ci-grep-gates.sh`: all gates passed.
- `npm run check:circular`: ✔ No circular dependency.

## Phase 7 close

DBIN-05 closes Phase 7's last sub-PR. All 5 REQ-IDs (DBIN-01..05) shipped against #75, #76, #77, #88, #94.
