// Sync orchestrator — D-23 (sequential 6-resource order) + D-24 (sync_runs
// lifecycle: insertRunning → updatePerResource* → finalize) + D-25
// (per-resource outcome enum) + D-32 (wal_checkpoint(TRUNCATE) on ok|partial
// only) + Pattern 6 (orchestrator + per-resource pipeline).
//
// This is the SINGLE composition point where Phase 3's pieces meet at
// runtime: cursor + window (Plan 03-04 cursor.ts) → resource module (Plan
// 03-09 fetch+normalize) → repository (Plan 03-08 upsert) → sync_runs
// lifecycle (Plan 03-08 sync-runs.repo.ts) → WAL hygiene (D-32). Plan 03-12
// (CLI shim) and Phase 4's `whoop_sync` MCP tool both call this via the
// `bootstrap()` composition root in `../bootstrap.ts`.
//
// ADR-0001 (MCP stdout purity): no console.*, no process.stdout.write — the
// orchestrator logs structured events through Pino to stderr only. Phase 4's
// MCP tool wraps this in `src/mcp/register.ts`'s sanitizer.
//
// ADR-0002: this module is the FIRST runtime consumer of `callWithAuth`
// (the 401-reactive chokepoint) — via `httpGet` inside each resource
// module. The orchestrator NEVER imports `callWithAuth` directly; the
// resource modules wrap it (D-18 chokepoint discipline).
//
// Pitfall E (token leakage via WhoopApiError.cause): the catch block logs
// the resource + status fields only; the raw error never lands in the log
// payload. The error itself flows through `src/mcp/sanitize.ts` at the
// MCP boundary when surfaced through Phase 4's tool.
// `tests/integration/sync/partial-failure.test.ts` Test 2 asserts on
// captured stderr that `grep -E '(Bearer|access_token=)'` returns 0
// matches after a 401-flow run — runtime confirmation.
//
// Gate G: this file does NOT import the drizzle-orm package directly. The
// orchestrator touches Drizzle only via the repository interfaces (which
// return domain entities, not Drizzle row types — ARCHITECTURE.md
// Anti-Pattern 3). The grep gate forbids the drizzle-orm import path
// outside src/infrastructure/db/.
//
// Resource ordering (D-23): profile → body_measurements → cycles →
// recoveries → sleeps → workouts. Lightest first (profile + body_measurements
// are single-shot, no cursor) so an auth/config error surfaces before any
// time-windowed pagination. Cycles before recoveries/sleeps/workouts because
// `recoveries.cycle_id REFERENCES cycles(id)` (FK constraint at the schema
// layer); the FK is the load-bearing reason the order is fixed.

import type Database from 'better-sqlite3';
import type { Logger } from 'pino';
import {
  RESOURCES,
  type ResourceName,
  type ResourceSyncOutcome,
  type RunSyncInput,
  type RunSyncResult,
} from '../../domain/types/sync.js';
import type { BodyMeasurementsRepo } from '../../infrastructure/db/repositories/body-measurements.repo.js';
import type { CyclesRepo } from '../../infrastructure/db/repositories/cycles.repo.js';
import type { ProfileRepo } from '../../infrastructure/db/repositories/profile.repo.js';
import type { RecoveryRepo } from '../../infrastructure/db/repositories/recovery.repo.js';
import type { SleepsRepo } from '../../infrastructure/db/repositories/sleep.repo.js';
import type { SyncRunsRepo } from '../../infrastructure/db/repositories/sync-runs.repo.js';
import type { WorkoutsRepo } from '../../infrastructure/db/repositories/workouts.repo.js';
import type { getBodyMeasurement } from '../../infrastructure/whoop/resources/body-measurements.js';
import type { listCycles } from '../../infrastructure/whoop/resources/cycles.js';
import type { getProfile } from '../../infrastructure/whoop/resources/profile.js';
import type { listRecovery } from '../../infrastructure/whoop/resources/recovery.js';
import type { listSleep } from '../../infrastructure/whoop/resources/sleep.js';
import type { listWorkouts } from '../../infrastructure/whoop/resources/workouts.js';
import { computeWindow } from './cursor.js';
import { classifyOutcome, computeStatus } from './per-resource.js';

// ----------------------------------------------------------------------------
// Dependency-injection surface. The orchestrator receives every collaborator
// (repos, resource modules, sqlite handle for WAL checkpoint, clock, IANA
// zone, logger) through this shape — the production wiring lives in
// `../bootstrap.ts`. Tests construct ad-hoc deps inline (the in-memory DB
// helper from Plan 03-07 + MSW helpers for HTTP).
// ----------------------------------------------------------------------------

export interface RunSyncDeps {
  repos: {
    syncRuns: SyncRunsRepo;
    cycles: CyclesRepo;
    recoveries: RecoveryRepo;
    sleeps: SleepsRepo;
    workouts: WorkoutsRepo;
    profile: ProfileRepo;
    bodyMeasurements: BodyMeasurementsRepo;
  };
  whoop: {
    resources: {
      cycles: typeof listCycles;
      recoveries: typeof listRecovery;
      sleeps: typeof listSleep;
      workouts: typeof listWorkouts;
      profile: typeof getProfile;
      body_measurements: typeof getBodyMeasurement;
    };
  };
  /** Raw better-sqlite3 handle — needed for `wal_checkpoint(TRUNCATE)` per D-32.
   *  The orchestrator does not run SQL through it; repositories own all
   *  per-resource DB writes. */
  sqlite: Database.Database;
  /** Injected clock. Production wiring passes `() => new Date()`; tests pin
   *  a fixed Date so window computation is deterministic. */
  clock: () => Date;
  /** IANA zone resolver per D-13 — Intl.DateTimeFormat().resolvedOptions().timeZone
   *  in production; tests pass a fixed value like `'America/Los_Angeles'`. */
  ianaZone: () => string;
  /** Pino logger — stderr-bound per ADR-0001. Defaults to the production
   *  singleton at the bootstrap layer. */
  logger: Logger;
}

/**
 * Drive a single sync run end-to-end. Returns the run-level status,
 * per-resource outcomes, and the `sync_runs.id` row id consumers
 * (CLI exit-code path; future MCP tool) can look up.
 *
 * Lifecycle (D-24):
 *   1. `syncRuns.insertRunning({startedAt, flags})` — FIRST DB write.
 *      A subsequent crash leaves status='running' which Phase 5's
 *      doctor surfaces.
 *   2. For each requested resource (D-23 order):
 *      a. Try the per-resource pipeline (fetch → normalize → upsert).
 *      b. `syncRuns.updatePerResource(id, resource, outcome)` after each
 *         resource (success OR failure) so the row is always up to date.
 *   3. `syncRuns.finalize(id, status, gapsDetected, finishedAt)` — final
 *      state transition.
 *   4. `wal_checkpoint(TRUNCATE)` only on ok|partial (D-32 — failed leaves
 *      WAL intact for diagnostics).
 *
 * Errors from a single resource are CAUGHT here and recorded as a
 * `ResourceSyncOutcome` per D-25 — they do NOT propagate up. A failed
 * resource X does not block resource Y. The only path that throws out
 * of this function is an unrecoverable bug in the sync_runs.repo or the
 * sqlite handle itself.
 */
export async function runSync(input: RunSyncInput, deps: RunSyncDeps): Promise<RunSyncResult> {
  const startedAt = deps.clock();
  const ianaZone = deps.ianaZone();
  const requestedResources: ReadonlyArray<ResourceName> = input.resources ?? RESOURCES;
  const requestedSet = new Set<ResourceName>(requestedResources);

  // Flags blob — echoed into sync_runs.flags so the doctor probe + future
  // diagnostic surfaces can replay what the user (or CLI default) asked for.
  // No raw secrets here; the input shape is plain CLI flags.
  const flagsBlob = JSON.stringify({
    days: input.days ?? null,
    since: input.since ?? null,
    resources: input.resources ?? null,
  });

  const syncRunId = deps.repos.syncRuns.insertRunning({
    startedAt: startedAt.toISOString(),
    flags: flagsBlob,
  });

  deps.logger.warn({
    event: 'sync_started',
    syncRunId,
    resources: requestedResources,
    days: input.days ?? null,
    since: input.since ?? null,
  });

  // Per-resource outcome map. Pre-populate every resource with a sentinel
  // 'skipped' so the type is Record<ResourceName, ResourceSyncOutcome> (no
  // Partial). The loop below overwrites entries for requested resources with
  // their real outcomes; non-requested ones keep the seeded 'skipped' value.
  const perResource: Record<ResourceName, ResourceSyncOutcome> = Object.fromEntries(
    RESOURCES.map((resource) => [resource, { status: 'skipped' } as ResourceSyncOutcome]),
  ) as Record<ResourceName, ResourceSyncOutcome>;

  // Iterate in canonical D-23 order, not in the user's --resources order.
  // The user can omit resources but not reorder them — the FK from
  // recoveries.cycle_id → cycles.id requires cycles before recoveries.
  for (const resource of RESOURCES) {
    if (!requestedSet.has(resource)) {
      // Already marked 'skipped' above; record on sync_runs so the
      // per_resource JSON blob reflects the skip.
      deps.repos.syncRuns.updatePerResource(syncRunId, resource, perResource[resource]);
      continue;
    }
    const resourceStarted = Date.now();
    try {
      const outcome = await syncOneResource(resource, deps, ianaZone, startedAt, input);
      const durationMs = Date.now() - resourceStarted;
      const completed: ResourceSyncOutcome = { ...outcome, durationMs };
      perResource[resource] = completed;
      deps.logger.warn({
        event: 'sync_resource_done',
        syncRunId,
        resource,
        status: completed.status,
        fetched: completed.fetched ?? null,
        upserted: completed.upserted ?? null,
        durationMs,
      });
      deps.repos.syncRuns.updatePerResource(syncRunId, resource, completed);
    } catch (err) {
      // Pitfall E: the catch payload carries structured fields only — the
      // err itself is NOT logged inline (Bearer/access_token/JWT could
      // appear in a WhoopApiError.cause chain; sanitize.ts handles that
      // at the MCP boundary, not here).
      const classified = classifyOutcome(err);
      const durationMs = Date.now() - resourceStarted;
      const failed: ResourceSyncOutcome = { ...classified, durationMs };
      perResource[resource] = failed;
      deps.logger.warn({
        event: 'sync_resource_done',
        syncRunId,
        resource,
        status: failed.status,
        durationMs,
      });
      deps.repos.syncRuns.updatePerResource(syncRunId, resource, failed);
    }
  }

  // Every resource in RESOURCES now has an outcome (seeded as 'skipped' at
  // the top, overwritten by the loop for requested resources). The type
  // narrows naturally — no cast needed.
  const status = computeStatus(perResource, requestedResources);

  // gapsDetected starts at 0 in Phase 3; Phase 4's baseline service runs
  // the gap-detection pass when computing daily summaries and updates the
  // sync_runs row separately. The orchestrator records 0 here so the row
  // shape is complete (D-24 footnote).
  const gapsDetected = 0;
  const finishedAt = deps.clock();
  deps.repos.syncRuns.finalize(syncRunId, status, gapsDetected, finishedAt.toISOString());

  // D-32: wal_checkpoint(TRUNCATE) on ok|partial only. A 'failed' run
  // leaves the WAL intact for diagnostics — the user (or the doctor) can
  // inspect it before the next sync rolls it forward.
  //
  // The pragma returns `[{ busy, log, checkpointed }]` — busy=1 means a
  // concurrent reader/writer is holding the WAL and the checkpoint could
  // not truncate fully; log > checkpointed means the truncation only
  // partially folded. Capture both as a structured warn-level event so
  // Phase 5's doctor can surface the condition without re-running the
  // pragma.
  if (status === 'ok' || status === 'partial') {
    const ckptResult = deps.sqlite.pragma('wal_checkpoint(TRUNCATE)') as Array<{
      busy: number;
      log: number;
      checkpointed: number;
    }>;
    const ckpt = ckptResult[0];
    if (ckpt !== undefined && (ckpt.busy === 1 || ckpt.checkpointed < ckpt.log)) {
      deps.logger.warn({
        event: 'wal_checkpoint_incomplete',
        syncRunId,
        busy: ckpt.busy,
        log: ckpt.log,
        checkpointed: ckpt.checkpointed,
      });
    }
  }

  deps.logger.warn({
    event: 'sync_finished',
    syncRunId,
    status,
    gapsDetected,
  });

  return {
    status,
    perResource,
    syncRunId,
    gapsDetected,
  };
}

// ----------------------------------------------------------------------------
// Per-resource pipeline. Each branch is its own function-internal block so
// the orchestrator loop stays a flat switch and the branch-local types stay
// inside the case. Returns the success outcome (fetched/upserted counts) on
// the happy path; the orchestrator wraps the throw arm into a failure
// outcome via classifyOutcome.
// ----------------------------------------------------------------------------

async function syncOneResource(
  resource: ResourceName,
  deps: RunSyncDeps,
  ianaZone: string,
  clockNow: Date,
  input: RunSyncInput,
): Promise<ResourceSyncOutcome> {
  switch (resource) {
    case 'profile': {
      const { raw, entity } = await deps.whoop.resources.profile();
      // Persist the raw snake_case wire payload as the raw_json column so
      // the D-29 diagnostic seam can replay `WhoopRawProfile.parse(...)`
      // against `JSON.parse(profileRepo.getRawJson(userId))` and succeed.
      deps.repos.profile.upsert(
        {
          userId: entity.userId,
          email: entity.email,
          firstName: entity.firstName,
          lastName: entity.lastName,
          rawJson: JSON.stringify(raw),
        },
        { clock: clockNow },
      );
      return { status: 'success', fetched: 1, upserted: 1 };
    }
    case 'body_measurements': {
      const { raw, entity } = await deps.whoop.resources.body_measurements();
      const result = deps.repos.bodyMeasurements.upsertOnChange(
        {
          userId: entity.userId,
          heightMeter: entity.heightMeter,
          weightKilogram: entity.weightKilogram,
          maxHeartRate: entity.maxHeartRate,
          rawJson: JSON.stringify(raw),
        },
        { clock: clockNow },
      );
      // Fetched=1 always (single-shot endpoint); upserted=1 only when the
      // append-on-change check landed a new row. D-35 history semantics.
      return {
        status: 'success',
        fetched: 1,
        upserted: result.inserted ? 1 : 0,
      };
    }
    case 'cycles': {
      const cursor = deps.repos.cycles.cursor();
      const window = computeWindow({
        cursor,
        clock: clockNow,
        flagSinceISO: input.since ?? null,
        flagDaysN: input.days ?? null,
      });
      // Seed the rolling-prior-offset chain for tz_drift detection (D-13
      // Rule 2). `priorBefore(window.since)` returns the most recent cycle
      // STRICTLY BEFORE the current re-window — using a byRange that
      // overlaps the window would pick a cycle from inside the re-window
      // itself, defeating the rolling-chain semantics. Includes
      // PENDING_SCORE / UNSCORABLE / excluded cycles so the seed reads the
      // true chronologically-prior offset.
      const priorCycle = deps.repos.cycles.priorBefore(window.since);
      const priorTimezoneOffset = priorCycle?.timezoneOffset ?? null;

      const entities = await deps.whoop.resources.cycles({
        since: window.since,
        until: window.until,
        ianaZone,
        priorTimezoneOffset,
      });
      const upsert = deps.repos.cycles.upsertBatch(entities);
      return {
        status: 'success',
        fetched: entities.length,
        upserted: upsert.changed,
      };
    }
    case 'recoveries': {
      const cursor = deps.repos.recoveries.cursor();
      const window = computeWindow({
        cursor,
        clock: clockNow,
        flagSinceISO: input.since ?? null,
        flagDaysN: input.days ?? null,
      });
      const entities = await deps.whoop.resources.recoveries({
        since: window.since,
        until: window.until,
      });
      const upsert = deps.repos.recoveries.upsertBatch(entities);
      return {
        status: 'success',
        fetched: entities.length,
        upserted: upsert.changed,
      };
    }
    case 'sleeps': {
      const cursor = deps.repos.sleeps.cursor();
      const window = computeWindow({
        cursor,
        clock: clockNow,
        flagSinceISO: input.since ?? null,
        flagDaysN: input.days ?? null,
      });
      const entities = await deps.whoop.resources.sleeps({
        since: window.since,
        until: window.until,
      });
      const upsert = deps.repos.sleeps.upsertBatch(entities);
      return {
        status: 'success',
        fetched: entities.length,
        upserted: upsert.changed,
      };
    }
    case 'workouts': {
      const cursor = deps.repos.workouts.cursor();
      const window = computeWindow({
        cursor,
        clock: clockNow,
        flagSinceISO: input.since ?? null,
        flagDaysN: input.days ?? null,
      });
      const entities = await deps.whoop.resources.workouts({
        since: window.since,
        until: window.until,
      });
      const upsert = deps.repos.workouts.upsertBatch(entities);
      return {
        status: 'success',
        fetched: entities.length,
        upserted: upsert.changed,
      };
    }
  }
}
