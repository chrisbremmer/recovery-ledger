// DBIN-01 (#75): single source of truth for `sync_runs.status` values.
//
// The five-state enum is shared by:
//   - Drizzle column enum (`src/infrastructure/db/schema.ts`)
//   - Zod entity schema (`src/domain/schemas/entities.ts`)
//   - QueryCache input type (`src/services/cache/types.ts`)
//   - sync-runs repo `byStatus` parameter (`src/infrastructure/db/repositories/sync-runs.repo.ts`)
//   - SyncRun entity type (`src/domain/types/entities.ts`)
//
// 'aborted' was added (#15/#35) for crash recovery: a sync_runs row whose
// process died (SIGINT/SIGTERM/hard kill) is reclassified by the signal
// handler or by bootstrap's stale-row sweep.
//
// CI runs `madge --circular src/` to prevent ESM cycles on this constant —
// the dependents pull from this file at module top level, so a cycle here
// would resolve to `undefined` at runtime, not at compile time.

export const SYNC_RUN_STATUSES = ['running', 'ok', 'partial', 'failed', 'aborted'] as const;

export type SyncRunStatus = (typeof SYNC_RUN_STATUSES)[number];
