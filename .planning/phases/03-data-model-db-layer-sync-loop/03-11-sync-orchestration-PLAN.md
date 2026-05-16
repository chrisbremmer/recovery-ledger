---
phase: 03-data-model-db-layer-sync-loop
plan: 11
type: execute
wave: 4
depends_on: ["03-04", "03-05", "03-06", "03-07", "03-08", "03-09"]
files_modified:
  - src/services/sync/index.ts
  - src/services/sync/per-resource.ts
  - src/services/bootstrap.ts
  - src/services/index.ts
  - tests/integration/sync/idempotency.test.ts
  - tests/integration/sync/partial-failure.test.ts
  - tests/integration/sync/dst-fixture.test.ts
autonomous: true
requirements: [SYNC-01, SYNC-02, SYNC-03, SYNC-04, SYNC-05, SYNC-06, DATA-01, DATA-04, DATA-06]
tags: [sync, orchestration, bootstrap, services-barrel, integration-test, wal-checkpoint]
user_setup: []

must_haves:
  truths:
    - "src/services/sync/index.ts exports runSync(opts, deps): Promise<RunSyncResult> per RunSyncInput/RunSyncResult from src/domain/types/sync.ts"
    - "Sequential across the 6 resources in D-23 order: profile then body_measurements then cycles then recoveries then sleeps then workouts"
    - "Each resource is its own try/catch (a 429 on workouts does NOT block cycles per D-23)"
    - "Per-resource: read cursor from repo.cursor() then compute window via computeWindow() (Plan 03-04 cursor.ts) then call resource module list/get then upsertBatch via repo"
    - "sync_runs row lifecycle per D-24: insertRunning at start → updatePerResource after each resource → finalize with status ok|partial|failed + finishedAt + gapsDetected"
    - "wal_checkpoint(TRUNCATE) called on ok|partial only (D-32 — failed leaves WAL intact for diagnostics)"
    - "classifyOutcome(err): ResourceSyncOutcome maps WhoopApiError kind to D-25 per-resource status enum (rate_limited → 'partial_429', server → 'partial_5xx', unauthorized → 'failed_auth', network → 'failed_network', validation → 'partial_5xx' arguably, others → 'failed_network')"
    - "computeStatus(perResource): RunSyncStatus aggregates per-resource outcomes to 'ok' (all success/skipped) / 'partial' (some success + some failure) / 'failed' (all failure)"
    - "src/services/bootstrap.ts exports bootstrap(): {db, sqlite, services} — opens DB + runs migrator + builds repos + constructs sync deps; imports drizzle via Plan 03-05 connection.ts canonical re-export (Gate G strict)"
    - "src/services/index.ts (extended) — Services interface now includes runSync alongside runDoctor + refreshOrchestrator"
    - "Pino logs (S2): sync_started, sync_resource_done, sync_finished, rate_limit_throttle, rate_limit_429, migration_apply, migration_failed"
    - "Integration test tests/integration/sync/idempotency.test.ts: re-running sync yields 0 net new rows (SYNC-04 anchor)"
    - "Integration test tests/integration/sync/partial-failure.test.ts: workouts 429s but cycles succeed → sync_runs.status='partial', wal_checkpoint(TRUNCATE) fires, per_resource counts correct (SYNC-05 + SYNC-06 anchor); grep -E '(Bearer|access_token=)' on stderr capture returns 0 (Pitfall E anchor)"
    - "Integration test tests/integration/sync/dst-fixture.test.ts: full end-to-end on all 3 D-15 DST/tz fixtures → flagged cycles persist with baseline_excluded=1 + correct exclusion_reason"
    - "ADR-0001: no console.* / process.stdout.write in any src/services/sync/* or bootstrap.ts file; logger.warn structured fields only"
    - "Gate F + Gate G + Gate E all green — orchestrator does NOT add fetch( anywhere; drizzle-orm/* imports stay confined to src/infrastructure/db/"
  scope_note: |
    This plan kept as a single Plan 03-11 (not split into 03-11a / 03-11b) per checker
    Warning #7 (scope_sanity). Trade-off documented here so it does not slip past review:

    - The orchestrator (Task 1) and the 3 integration tests (Task 2) are tightly coupled —
      the integration tests are the verification anchors for SYNC-04, SYNC-05, SYNC-06,
      DATA-06, Pitfall E, and Pitfall I. Splitting the source from its tests would create
      a Wave-4a / Wave-4b ordering with no executor benefit (same person writes both halves
      back-to-back).
    - 3 integration tests in one plan is at the upper bound of the scope budget; total
      assertion count is 15+ (idempotency 4 + partial-failure 6 + dst-fixture 5). Each
      test file is ≤ 200 LOC because the heavy lifting lives in MSW helpers (Plan 03-07)
      and the in-memory DB helper (Plan 03-07).
    - The 3 tests are bundled because they share setup boilerplate (MSW helpers + in-memory
      DB + bootstrap-equivalent dep construction). Splitting would duplicate ~50 lines
      of beforeEach setup per file.
    - If executor finds Task 2 is brushing >50% context, surface in Plan 03-11 SUMMARY and
      the planner will split into 03-11a (orchestrator + bootstrap + idempotency.test.ts)
      + 03-11b (partial-failure.test.ts + dst-fixture.test.ts) in a follow-up revision.
    - Pitfall E anchor (partial-failure.test.ts Test 2 — `grep -E '(Bearer|access_token=)'`
      on stderr capture) is LOAD-BEARING for D-34 attestation; do not defer it under any
      capacity pressure.
  artifacts:
    - path: "src/services/sync/index.ts"
      provides: "runSync orchestrator per D-23/24/25 + Pattern 6"
      contains: "wal_checkpoint(TRUNCATE)"
    - path: "src/services/bootstrap.ts"
      provides: "bootstrap() — composition root: openDb + migrate + repos + services"
      contains: "openDb"
    - path: "src/services/index.ts"
      provides: "Extended Services interface (runDoctor + refreshOrchestrator + runSync)"
      contains: "runSync"
    - path: "tests/integration/sync/idempotency.test.ts"
      provides: "SYNC-04 anchor — second sync yields 0 net new rows"
      contains: "idempotency"
    - path: "tests/integration/sync/partial-failure.test.ts"
      provides: "SYNC-05 anchor + Pitfall E anchor — workouts 429, sync_runs status='partial', wal_checkpoint fires, Bearer grep returns 0"
      contains: "partial"
    - path: "tests/integration/sync/dst-fixture.test.ts"
      provides: "DATA-06 anchor + Pitfall I anchor — DST/tz fixtures persisted with baseline_excluded; retroactive re-flag locked"
      contains: "dst_straddle"
  key_links:
    - from: "src/services/sync/index.ts"
      to: "src/services/sync/cursor.ts computeWindow"
      via: "named import"
      pattern: "computeWindow"
    - from: "src/services/sync/index.ts"
      to: "all 6 resource modules + all 9 repositories"
      via: "deps injection"
      pattern: "deps.whoop.resources|deps.repos"
    - from: "src/services/bootstrap.ts"
      to: "openDb + migrate + drizzle (via Plan 03-05 connection.ts re-export)"
      via: "named imports"
      pattern: "openDb|migrate|from '../infrastructure/db/connection"
---

<objective>
Land the sync orchestration service (D-23 + D-24 + D-25 + Pattern 6), the bootstrap composition root that opens the DB + runs the migrator + wires the deps, and the three load-bearing integration tests for SYNC-04 + SYNC-05 + DATA-06. This is the plan where Phase 3's pieces compose into a working `services.runSync()` callable.

Purpose: Plan 03-12's CLI shim is 5 lines over `services.runSync`. Phase 4's `whoop_sync` MCP tool will be 5 lines over the same. This plan is the single composition root. Pitfall E (token-leak via MCP) is locked via the partial-failure integration test's `grep -E '(Bearer|access_token=)'` assertion on captured stderr.

Output: 3 source files (sync/index.ts, sync/per-resource.ts, bootstrap.ts) + 1 modified services barrel + 3 integration tests. See `must_haves.scope_note` in frontmatter for the rationale on keeping the 3 integration tests bundled.
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
@agent_docs/decisions/0001-mcp-stdout-purity.md
@agent_docs/decisions/0002-single-flight-oauth-refresh.md
@agent_docs/decisions/0007-whoop-read-only.md
@src/domain/types/sync.ts
@src/services/sync/cursor.ts
@src/services/index.ts
@src/services/refresh-orchestrator.ts
@src/services/doctor/index.ts
@src/infrastructure/db/connection.ts
@src/infrastructure/db/migrate.ts
@src/infrastructure/config/paths.ts
@src/infrastructure/config/logger.ts
@src/infrastructure/whoop/resources/cycles.ts
@src/infrastructure/whoop/resources/recovery.ts
@src/infrastructure/whoop/resources/sleep.ts
@src/infrastructure/whoop/resources/workouts.ts
@src/infrastructure/whoop/resources/profile.ts
@src/infrastructure/whoop/resources/body-measurements.ts
@src/infrastructure/whoop/errors.ts
@src/infrastructure/db/repositories/cycles.repo.ts
@src/infrastructure/db/repositories/recovery.repo.ts
@src/infrastructure/db/repositories/sleep.repo.ts
@src/infrastructure/db/repositories/workouts.repo.ts
@src/infrastructure/db/repositories/profile.repo.ts
@src/infrastructure/db/repositories/body-measurements.repo.ts
@src/infrastructure/db/repositories/sync-runs.repo.ts

<interfaces>
runSync orchestrator (D-23 + Pattern 6):

  export interface RunSyncDeps {
    repos: {
      syncRuns: SyncRunsRepo;
      cycles: CyclesRepo;
      recoveries: RecoveryRepo;
      sleeps: SleepRepo;
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
    sqlite: Database.Database;          // for wal_checkpoint(TRUNCATE)
    clock: () => Date;                  // injected for testability
    ianaZone: () => string;             // resolved at sync start
    logger: typeof logger;              // Pino → stderr
  }

  export async function runSync(input: RunSyncInput, deps: RunSyncDeps): Promise<RunSyncResult>;

bootstrap (composition root):

  export interface Bootstrapped {
    db: ReturnType<typeof drizzle>;
    sqlite: Database.Database;
    services: Services;
    close(): void;
  }
  export function bootstrap(opts?: { dbFile?: string }): Bootstrapped;

  // Import surface — load-bearing for Gate G:
  //   import { drizzle, openDb } from '../infrastructure/db/connection.js';  // Plan 03-05 canonical
  //   import { migrate } from '../infrastructure/db/migrate.js';

Per-resource helper (extracted for testability):

  export async function syncOneResource(
    resource: ResourceName,
    cursor: string,
    window: { since: string; until: string },
    deps: RunSyncDeps,
    ianaZone: string,
  ): Promise<ResourceSyncOutcome>;
</interfaces>
</context>

<tasks>

<task type="auto">
  <name>Task 1: Implement src/services/sync/index.ts + src/services/sync/per-resource.ts + src/services/bootstrap.ts + extend src/services/index.ts</name>
  <files>src/services/sync/index.ts, src/services/sync/per-resource.ts, src/services/bootstrap.ts, src/services/index.ts</files>
  <read_first>
    - .planning/phases/03-data-model-db-layer-sync-loop/03-CONTEXT.md decisions D-23 (sequential + parallel-within-resource), D-24 (sync_runs lifecycle), D-25 (per-resource outcome enum), D-32 (wal_checkpoint TRUNCATE after ok|partial), D-33 (zero new MCP tools), D-34 (sanitize.ts + register.ts UNMODIFIED)
    - .planning/phases/03-data-model-db-layer-sync-loop/03-RESEARCH.md §Pattern 6 lines 561-589 (sync orchestrator skeleton), §System Architecture Diagram lines 154-225 (the full data flow)
    - .planning/phases/03-data-model-db-layer-sync-loop/03-PATTERNS.md §D1 lines 891-969 (sync orchestrator analog from doctor/index.ts), §D3 lines 1004-1057 (services barrel extension pattern)
    - .planning/research/PITFALLS.md Pitfall 13 (BEGIN IMMEDIATE — repo upserts handle this internally), Pitfall E (token leakage — orchestrator never logs raw tokens)
    - .planning/research/ARCHITECTURE.md §Concurrency lines 804-815 (single writer per process; WAL handles inter-process)
    - src/services/refresh-orchestrator.ts (existing pattern: callWithAuth chokepoint — orchestrator never imports tokenStore directly)
    - src/services/doctor/index.ts (existing services pattern: orchestrator returns structured result)
    - src/services/index.ts (Plan 02-04 — extending the Services barrel; mirror that addition pattern)
    - src/services/sync/cursor.ts (Plan 03-04 — computeWindow)
    - All 6 resource modules (Plan 03-09)
    - All 7 repository factories (Plan 03-08 cycles/recovery/sleep/workouts/profile/body-measurements/sync-runs)
    - src/infrastructure/whoop/errors.ts (isWhoopApiError + isAuthError for classifyOutcome)
    - src/infrastructure/config/logger.ts + paths.ts
    - src/infrastructure/db/connection.ts (openDb + canonical drizzle re-export — bootstrap.ts imports drizzle from here, NOT from 'drizzle-orm/better-sqlite3')
    - src/infrastructure/db/migrate.ts (migrate)
  </read_first>
  <action>
    Create `src/services/sync/per-resource.ts`:
      - `import { isAuthError, isWhoopApiError } from '../../infrastructure/whoop/errors.js'`
      - `import type { ResourceName, ResourceSyncOutcome } from '../../domain/types/sync.js'`
      - Export `function classifyOutcome(err: unknown): ResourceSyncOutcome`:
        - If isAuthError(err) → `{status: 'failed_auth', errors: 1}`
        - If isWhoopApiError(err): switch on err.kind: 'rate_limited' → 'partial_429'; 'server' → 'partial_5xx'; 'validation' → 'partial_5xx' (treat unexpected wire-format like a server bug); 'network' → 'failed_network'; 'unauthorized' → 'failed_auth' (defensive — should be caught earlier as AuthError); 'unknown' → 'failed_network'.
        - Else → `{status: 'failed_network', errors: 1}` (catch-all).
      - Export `function computeStatus(perResource: Record<ResourceName, ResourceSyncOutcome>, requestedResources: readonly ResourceName[]): RunSyncStatus`:
        - Count outcomes from `requestedResources` only (ignore resources excluded by --resources flag).
        - If all === 'success' OR 'skipped' → 'ok'.
        - If any !== 'success' AND at least one === 'success' → 'partial'.
        - If all !== 'success' AND none === 'success' → 'failed'.

    Create `src/services/sync/index.ts`:
      - Leading comment cites D-23 + D-24 + D-25 + D-32 + Pattern 6 + ADR-0001 + ADR-0002 (sync is the FIRST runtime consumer of callWithAuth — via httpGet inside the resource modules).
      - Imports: types from `../../domain/types/sync.js`, `computeWindow` from `./cursor.js`, `classifyOutcome` + `computeStatus` from `./per-resource.js`, all per-resource repo + module types, `logger`, `Database` type from better-sqlite3.
      - Export `RunSyncDeps` interface (the dependency-injection shape from <interfaces> above) and `runSync(input: RunSyncInput, deps: RunSyncDeps): Promise<RunSyncResult>`:
        1. `const now = deps.clock(); const ianaZone = deps.ianaZone();`
        2. `const requestedResources = input.resources ?? RESOURCES;` (Plan 03-04 RESOURCES tuple)
        3. `const flagsBlob = JSON.stringify({days: input.days ?? null, since: input.since ?? null, resources: input.resources ?? null});`
        4. `const syncRunId = await deps.repos.syncRuns.insertRunning({startedAt: now.toISOString(), flags: flagsBlob});`
        5. `deps.logger.warn({event: 'sync_started', syncRunId, resources: requestedResources, days: input.days ?? null, since: input.since ?? null});`
        6. `const perResource: Partial<Record<ResourceName, ResourceSyncOutcome>> = {};`
        7. For each `resource` in `requestedResources` (sequential per D-23):
           - `const startedTs = Date.now();`
           - Try: 
             - Per-resource branch:
               - `'profile'`: `const profile = await deps.whoop.resources.profile(); await deps.repos.profile.upsert({userId: profile.userId, email: profile.email, firstName: profile.firstName, lastName: profile.lastName, rawJson: JSON.stringify(profile /* or original raw */)}, {clock: now}); perResource.profile = {status: 'success', fetched: 1, upserted: 1, durationMs: Date.now() - startedTs};`
               - `'body_measurements'`: `const {raw, entity} = await deps.whoop.resources.body_measurements(); const result = await deps.repos.bodyMeasurements.upsertOnChange({userId: entity.userId, heightMeter: entity.heightMeter, weightKilogram: entity.weightKilogram, maxHeartRate: entity.maxHeartRate, rawJson: JSON.stringify(raw)}, {clock: now}); perResource.body_measurements = {status: 'success', fetched: 1, upserted: result.inserted ? 1 : 0, durationMs: ...};`
               - `'cycles'`: 
                 - `const cursor = await deps.repos.cycles.cursor();`
                 - `const window = computeWindow({cursor, clock: now, flagSinceISO: input.since ?? null, flagDaysN: input.days ?? null});`
                 - Read the latest existing cycle's timezone_offset to seed the priorTimezoneOffset (for tz_drift detection on the first new cycle): use `deps.repos.cycles.byRange(<7d back>, <now>, {includeUnscored: true, includeExcluded: true})` and pick the last entry's `timezoneOffset`. If none exists, pass null.
                 - `const entities = await deps.whoop.resources.cycles({since: window.since, until: window.until, ianaZone, priorTimezoneOffset});`
                 - `const upsert = await deps.repos.cycles.upsertBatch(entities);`
                 - `perResource.cycles = {status: 'success', fetched: entities.length, upserted: upsert.changed, durationMs: ...};`
               - `'recoveries'`, `'sleeps'`, `'workouts'`: similar shape; cursor from repo, computeWindow, list, upsertBatch. No DST/tz seeding (only cycles).
             - On the resource's iteration end:
               - `deps.logger.warn({event: 'sync_resource_done', syncRunId, resource, status: 'success', fetched: ..., upserted: ..., durationMs: ...});`
               - `await deps.repos.syncRuns.updatePerResource(syncRunId, resource, perResource[resource]!);`
           - Catch `err`:
             - `perResource[resource] = {...classifyOutcome(err), durationMs: Date.now() - startedTs};`
             - `deps.logger.warn({event: 'sync_resource_done', syncRunId, resource, status: perResource[resource].status, durationMs: ...});` (NO err.message inline — Pitfall E. The logger payload is structured fields only; the err itself flows through register.ts sanitizer at the MCP boundary in Phase 4.)
             - `await deps.repos.syncRuns.updatePerResource(syncRunId, resource, perResource[resource]!);`
        8. `const status = computeStatus(perResource as Record<ResourceName, ResourceSyncOutcome>, requestedResources);`
        9. `await deps.repos.syncRuns.finalize(syncRunId, status, 0, deps.clock().toISOString());` (gapsDetected starts at 0; Phase 4 derives gap counts during baseline build; D-24 footnote)
        10. `if (status === 'ok' || status === 'partial') deps.sqlite.pragma('wal_checkpoint(TRUNCATE)');` (D-32; SYNC-06)
        11. `deps.logger.warn({event: 'sync_finished', syncRunId, status, gapsDetected: 0});`
        12. Return `{status, perResource: perResource as Record<ResourceName, ResourceSyncOutcome>, syncRunId, gapsDetected: 0};`

      Notes for resource ordering: profile + body_measurements use `success` status only; they don't have cursors. cycles → recoveries → sleeps → workouts each follow the cursor + computeWindow + list + upsertBatch pattern.

    Create `src/services/bootstrap.ts`:
      - Imports the canonical `drizzle` from Plan 03-05's connection.ts re-export (Gate G strict — bootstrap.ts is outside src/infrastructure/db/, so direct `from 'drizzle-orm/better-sqlite3'` would violate Gate G):
        - `import { drizzle, openDb } from '../infrastructure/db/connection.js'` (Plan 03-05 ships both)
      - `import { migrate } from '../infrastructure/db/migrate.js'`, `import { paths } from '../infrastructure/config/paths.js'`, `import { logger } from '../infrastructure/config/logger.js'`, `import { createCyclesRepo } from '../infrastructure/db/repositories/cycles.repo.js'` etc.
      - Imports for 6 resource modules + 7 repo factories + sync service.
      - Export `Bootstrapped` interface: `{db, sqlite, services, close}`.
      - Export `bootstrap(opts?: {dbFile?: string}): Bootstrapped`:
        - `const dbFile = opts?.dbFile ?? paths.dbFile;` (Plan 03-01 paths extension)
        - `const {db, sqlite} = openDb(dbFile);`
        - Resolve migrations dir from import.meta.url: `const HERE = path.dirname(fileURLToPath(import.meta.url)); const migrationsDir = path.resolve(HERE, '..', 'infrastructure', 'db', 'migrations');` — works for both dist/ and src/ (tsx + vitest both honor relative file URLs).
        - `migrate(sqlite, {migrationsDir, backupsDir: paths.backupsDir, dbFile});`
        - Build repos: `const repos = {cycles: createCyclesRepo(db), recoveries: createRecoveryRepo(db), sleeps: createSleepRepo(db), workouts: createWorkoutsRepo(db), profile: createProfileRepo(db), bodyMeasurements: createBodyMeasurementsRepo(db), syncRuns: createSyncRunsRepo(db), decisions: createDecisionsRepo(db), dailySummaries: createDailySummariesRepo(db)};`
        - Build whoop deps: `const whoop = {resources: {cycles: listCycles, recoveries: listRecovery, sleeps: listSleep, workouts: listWorkouts, profile: getProfile, body_measurements: getBodyMeasurement}};`
        - Build sync deps: `const syncDeps: RunSyncDeps = {repos, whoop, sqlite, clock: () => new Date(), ianaZone: () => Intl.DateTimeFormat().resolvedOptions().timeZone, logger};` — IANA zone resolved lazily per sync start per D-13.
        - Build services: services include existing `runDoctor` + `refreshOrchestrator` plus `runSync: (input: RunSyncInput) => runSync(input, syncDeps)`.
        - Return `{db, sqlite, services, close: () => sqlite.close()}`.

    Extend `src/services/index.ts` per PATTERNS §D3 lines 1004-1057:
      - Existing pattern: `runDoctor` + `refreshOrchestrator` already on the Services interface.
      - Add `runSync: (input: RunSyncInput) => Promise<RunSyncResult>` to the Services interface.
      - Export `type { RunSyncInput, RunSyncResult, ResourceSyncOutcome, ResourceName, ResourceSyncStatus } from '../domain/types/sync.js'` for downstream consumers.
      - Update `createServices()`: it currently returns `{runDoctor, refreshOrchestrator}`. Add `runSync` to the returned object. Two options:
        - (a) `createServices()` internally calls `bootstrap()` and returns the wired runSync. But bootstrap() opens the DB — the existing `createServices()` consumer (`src/cli/commands/doctor.ts`) doesn't need a DB. So this option couples doctor to DB.
        - (b) Keep `createServices()` lightweight (no DB); add a separate `createSyncServices()` or `bootstrap()` for the DB-aware path. CLI shims that need runSync call `bootstrap()`; doctor stays on `createServices()`.
      - Pick option (b). Document in services/index.ts leading comment. The CLI sync shim (Plan 03-12) imports `bootstrap` directly; the doctor shim continues to import `createServices`.
      - Alternatively, expose `bootstrap()` from src/services/index.ts barrel so both shims have a single import surface: `export { bootstrap } from './bootstrap.js'; export type { Bootstrapped } from './bootstrap.js';`.

    All files: NO default exports. NO console.* (logger.warn structured fields only). Pino → stderr. NO direct `from 'drizzle-orm/better-sqlite3'` in src/services/ — drizzle comes through Plan 03-05 connection.ts re-export.
  </action>
  <verify>
    <automated>npm run lint -- src/services/ && npx tsc --noEmit</automated>
  </verify>
  <acceptance_criteria>
    - grep -c "wal_checkpoint(TRUNCATE)" src/services/sync/index.ts returns at least 1 (D-32 / SYNC-06)
    - grep -c "RESOURCES" src/services/sync/index.ts returns at least 1 (D-23 order tuple imported)
    - grep -c "syncRuns.insertRunning\|syncRuns.updatePerResource\|syncRuns.finalize" src/services/sync/index.ts returns at least 3 (D-24 lifecycle)
    - grep -c "computeWindow" src/services/sync/index.ts returns at least 1 (Plan 03-04 cursor used)
    - grep -c "classifyOutcome\|computeStatus" src/services/sync/per-resource.ts returns at least 2 (exports)
    - grep -c "openDb\|migrate(" src/services/bootstrap.ts returns at least 2
    - grep -c "Intl.DateTimeFormat" src/services/bootstrap.ts returns at least 1 (IANA zone resolution per D-13)
    - grep -c "runSync" src/services/index.ts returns at least 2 (interface declaration + export)
    - grep -c "bootstrap" src/services/index.ts returns at least 1 (re-export)
    - grep -c "from '../infrastructure/db/connection" src/services/bootstrap.ts returns at least 1 (drizzle imported via Plan 03-05 re-export — Gate G strict)
    - grep -rEn "from ['\"]drizzle-orm" src/services/ returns 0 lines (Gate G — services never import drizzle-orm directly; bootstrap goes through connection.ts re-export)
    - bash scripts/ci-grep-gates.sh exits 0
    - npx tsc --noEmit exits 0; npm run lint exits 0
  </acceptance_criteria>
  <done>Sync orchestrator + bootstrap + extended services barrel shipped; D-23 resource order locked; D-24 lifecycle + D-25 outcome map + D-32 wal_checkpoint all implemented; bootstrap imports drizzle through Plan 03-05 connection.ts re-export (Gate G strict).</done>
</task>

<task type="auto">
  <name>Task 2: Integration tests — idempotency (SYNC-04) + partial-failure (SYNC-05 + Pitfall E) + DST (DATA-06) — bundled per scope_note</name>
  <files>tests/integration/sync/idempotency.test.ts, tests/integration/sync/partial-failure.test.ts, tests/integration/sync/dst-fixture.test.ts</files>
  <read_first>
    - src/services/sync/index.ts + bootstrap.ts (Task 1 output)
    - .planning/phases/03-data-model-db-layer-sync-loop/03-RESEARCH.md §Validation Architecture lines 1163-1183 (SYNC-04 + SYNC-05 + DATA-06 anchors)
    - .planning/phases/03-data-model-db-layer-sync-loop/03-CONTEXT.md decisions D-11 (idempotent upsert), D-24 + D-25 (sync_runs row shape), D-32 (wal_checkpoint after ok|partial)
    - .planning/phases/03-data-model-db-layer-sync-loop/03-PATTERNS.md §G — integration tests under tests/integration/sync/
    - tests/integration/auth-concurrency.test.ts (Plan 02-08 — integration test shape precedent including Bearer grep)
    - tests/helpers/msw-whoop-*.ts (Plan 03-07 — all 6 helpers)
    - tests/helpers/in-memory-db.ts (Plan 03-07)
    - tests/fixtures/whoop/cycles/200-dst-spring-forward.json + 200-dst-fall-back.json + 200-tz-trip-sfo-jfk.json
    - tests/fixtures/whoop/cycles/429-rate-limited.json + 500-server-error.json
    - .planning/research/PITFALLS.md Pitfall E (token leakage via WhoopApiError.cause), Pitfall 12 (WAL growth)
  </read_first>
  <action>
    Per the frontmatter `must_haves.scope_note`: 3 integration tests bundled here because they share MSW + in-memory-DB + bootstrap-equivalent setup; splitting would duplicate ~50 lines of beforeEach setup per file with no executor benefit. Pitfall E anchor (Test 2 in partial-failure.test.ts) is LOAD-BEARING — do not defer under capacity pressure.

    Create `tests/integration/sync/idempotency.test.ts` per SYNC-04 anchor:
      - Setup: All 6 MSW helpers + in-memory DB + bootstrap-equivalent (build sync deps manually using the in-memory DB and the MSW helpers). Mock the OAuth token store so callWithAuth resolves with 'test-token' without hitting the refresh endpoint (mirror Plan 03-06 client.test.ts pattern).
      - Test 1: First runSync({days: 30}) — assert result.status === 'ok', perResource has 6 entries all status='success'. Row counts in cycles + recoveries + sleeps + workouts + profile + body_measurements tables match the fixtures (1 + 1 + 1 + 1 + 1 + 1 = 6 records inserted; plus sync_runs has 1 row).
      - Test 2: Second runSync({days: 30}) with SAME fixtures — `result.status === 'ok'`, but the upsert counts via repo.byRange show NO new rows; sync_runs has 2 rows now.
      - Test 3: Cursor advance — assert the second run's `since` (read from sync_runs.flags or by spying on computeWindow) is later than the first run's. The 7-day re-window means cycles get refetched, but ON CONFLICT keeps row count stable.
      - Test 4: sync_runs.per_resource JSON parses cleanly and matches D-24 shape — fetched + upserted + durationMs fields all present.

    Create `tests/integration/sync/partial-failure.test.ts` per SYNC-05 + Pitfall E + SYNC-06 anchor:
      - Setup: same as above + a stderr capture mechanism (vi.spyOn(process.stderr, 'write')).
      - Test 1: Configure MSW so workouts returns 429 on the first attempt AND on the retry (so withRetry's budget=1 is exhausted). All other resources succeed. Run runSync(). Assert:
         - result.status === 'partial' (computeStatus aggregates correctly)
         - perResource.workouts.status === 'partial_429'
         - perResource.cycles.status === 'success', recoveries === 'success', etc.
         - sync_runs row: status='partial', per_resource JSON has workouts with status='partial_429'
         - wal_checkpoint(TRUNCATE) WAS called (verify db.sqlite-wal size goes to 0 OR spy on sqlite.pragma)
      - Test 2: Pitfall E anchor — after the partial-failure run, capture all stderr writes (vi.spyOn + flush Pino). Assert `grep -E '(Bearer|access_token=|eyJ[A-Za-z0-9._-]{20,})' <stderr_text> === 0`. This proves Phase 1+2 sanitizer + ADR-0001 hold under WhoopApiError flows. **Load-bearing for D-34 attestation.**
      - Test 3: All resources fail (cycles 500, recoveries 500, sleeps 500, workouts 500, profile 500, body_measurements 500). result.status === 'failed'. wal_checkpoint(TRUNCATE) NOT called (D-32 — failed leaves WAL).
      - Test 4: Mixed cycles 429 + recoveries 500 + others OK. result.status === 'partial'. Both cycles and recoveries appear in per_resource with their respective statuses; rest as 'success'.
      - Test 5: --resources subset — runSync({resources: ['cycles', 'recoveries']}) — only those two get fetched; perResource only has 2 keys; sleeps/workouts/profile/body_measurements not in the result.
      - Test 6: AuthError flowing through — mock the token store to throw AuthError({kind: 'auth_expired'}) on the first cycles call. Assert perResource.cycles.status === 'failed_auth'. result.status === 'partial' (other resources still succeed) OR 'failed' depending on the other resources' outcomes — verify computeStatus's logic.

    Create `tests/integration/sync/dst-fixture.test.ts` per DATA-06 anchor:
      - Setup: same as idempotency.
      - Test 1: Run sync with the cycles MSW helper returning 200-dst-spring-forward.json (and other resources returning their 200-ok defaults). After sync, query the cycles table directly via raw SQL: `SELECT baseline_excluded, exclusion_reason FROM cycles WHERE id = <fixture_id>;`. Assert baseline_excluded=1, exclusion_reason='dst_straddle'. Pitfall H end-to-end.
      - Test 2: Same with fall-back fixture. baseline_excluded=1, exclusion_reason='dst_straddle'.
      - Test 3: Run sync with 200-tz-trip-sfo-jfk.json. After sync, assert:
         - Record 0 (id 2001, offset -08): baseline_excluded=0.
         - Record 1 (id 2002, offset -05): baseline_excluded=1, exclusion_reason='tz_drift'.
         - Record 2 (id 2003, offset -05): baseline_excluded=0.
      - Test 4: Re-run sync on the same fixtures with NO data change (Pitfall I anchor: re-flag on retroactive update). Assert the flags persist (Plan 03-09 normalizer runs on every upsert; the ON CONFLICT DO UPDATE re-computes baseline_excluded each time).
      - Test 5: Pitfall I retroactive shift — first sync inserts a normal cycle (offset -08, not straddling DST). Second sync receives the SAME cycle with the start shifted past a DST boundary (use setNextResponse to override with a mutated fixture). After second sync, that cycle's baseline_excluded should flip from 0 to 1. This is the D-11 + D-14 + Pitfall I lock — the most subtle requirement of the phase.

    All 3 files use `vi.setConfig({testTimeout: 10_000})`. Pool='forks' (already configured). Stderr capture is delicate — wait for Pino to flush via a microtask + a small setTimeout before asserting.
  </action>
  <verify>
    <automated>npm run test -- tests/integration/sync/idempotency.test.ts tests/integration/sync/partial-failure.test.ts tests/integration/sync/dst-fixture.test.ts</automated>
  </verify>
  <acceptance_criteria>
    - npm run test -- tests/integration/sync/idempotency.test.ts shows at least 4 assertions passing
    - npm run test -- tests/integration/sync/partial-failure.test.ts shows at least 6 assertions passing
    - npm run test -- tests/integration/sync/dst-fixture.test.ts shows at least 5 assertions passing
    - partial-failure.test.ts Test 2 — Bearer/access_token grep returns 0 matches on captured stderr (Pitfall E + D-34 attestation) — LOAD-BEARING; do NOT skip
    - partial-failure.test.ts Test 1 — wal_checkpoint(TRUNCATE) IS called on partial; sync_runs.status='partial' (SYNC-05 + SYNC-06)
    - partial-failure.test.ts Test 3 — wal_checkpoint(TRUNCATE) NOT called on failed (D-32)
    - dst-fixture.test.ts Test 5 — retroactive baseline_excluded flip (Pitfall I + D-11 + D-14)
    - Total Phase 3 test count rises by at least 15 (4+6+5 in this plan)
    - Combined runtime of the 3 integration files under 15 seconds (well within the 60s total cap)
    - bash scripts/ci-grep-gates.sh exits 0
    - npm run lint exits 0; npx tsc --noEmit exits 0
  </acceptance_criteria>
  <done>SYNC-04 + SYNC-05 + DATA-06 anchored; Pitfall E + Pitfall H + Pitfall I locked; D-32 conditional wal_checkpoint behavior verified on ok/partial vs failed; 3 integration tests bundled per scope_note.</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| WHOOP HTTP response → resource module → normalizer → repository → SQLite | The sync orchestrator is the funnel; every write goes through BEGIN IMMEDIATE per D-31 (repo internals) |
| sync_runs row provenance | Atomically inserted at start, updated per-resource, finalized at end; lock-free single-writer per process |
| Error cause chains flowing through register.ts sanitizer | D-34 attestation: sanitize.ts UNMODIFIED; Phase 1 patterns + Plan 02-07 fixtures cover Bearer/JWT/Authorization/code=/client_secret in any WhoopApiError shape Phase 3 produces |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-03.11-01 | Information disclosure | Bearer token leaks through logger.warn payloads | mitigate | logger.warn uses {event, syncRunId, resource, status, ...metadata} only — no token fields. partial-failure.test.ts Test 2 asserts `grep -E '(Bearer\|access_token=)' <stderr> === 0` after a 401-flow run. |
| T-03.11-02 | Repudiation | A sync run completes without a sync_runs row | mitigate | insertRunning is the FIRST DB write; any subsequent crash leaves status='running' which the doctor (Phase 5) can surface. Plan 03-08 sync-runs.repo.test.ts locks the lifecycle methods. |
| T-03.11-03 | Tampering | A partial run skips updatePerResource for a failed resource | mitigate | The catch block always calls updatePerResource(syncRunId, resource, classifyOutcome(err)) before continuing — verified by partial-failure.test.ts Test 1. |
| T-03.11-04 | Denial of service | wal_checkpoint(TRUNCATE) is never called → WAL grows unbounded | mitigate | wal_autocheckpoint=1000 (D-30) is the fallback; explicit TRUNCATE after every ok\|partial is the proactive path. partial-failure.test.ts Test 1 + dst-fixture.test.ts assert checkpoint fires. |
| T-03.11-05 | Tampering | Retroactive WHOOP cycle shift past a DST boundary is silently consumed | mitigate | dst-fixture.test.ts Test 5 (Pitfall I + D-11) — the normalizer re-runs detectExclusion on every upsert; ON CONFLICT DO UPDATE picks up the new baseline_excluded value. |
| T-03.11-06 | Information disclosure | Phase 3 sync surfaces user PII (email, body measurements) through Pino logs | accept | logger payload is structured event fields, no PII inlined. Body measurements + profile are user's own data on user's own disk — chmod 600 on the DB + backups. No telemetry. |
</threat_model>

<verification>
- npm run test -- tests/integration/sync/ all ≥ 15 new assertions green
- npm run test (full suite) — total tests now ≥ baseline + Phase 3 net
- bash scripts/ci-grep-gates.sh all 7 gates green
- npm run lint 0 errors
- npx tsc --noEmit 0 errors
- partial-failure.test.ts Test 2 — Bearer-grep returns 0 (D-34 attestation at runtime)
- dst-fixture.test.ts Test 5 — Pitfall I retroactive re-flag locked
</verification>

<success_criteria>
- runSync orchestrator implements D-23 (sequential 6-resource order), D-24 (sync_runs lifecycle), D-25 (per-resource outcome enum), D-32 (wal_checkpoint TRUNCATE on ok|partial only)
- bootstrap.ts composes openDb + migrate + repos + resource modules + sync into a single Bootstrapped object
- bootstrap.ts imports `drizzle` via Plan 03-05 connection.ts re-export (Gate G strict — no `from 'drizzle-orm'` in src/services/)
- src/services/index.ts extends Services with runSync per PATTERNS §D3
- SYNC-04 anchor (idempotency: 0 new rows on re-sync) verified
- SYNC-05 anchor (partial-failure → sync_runs.status='partial', per_resource counts correct) verified
- SYNC-06 anchor (wal_checkpoint(TRUNCATE) on ok|partial only) verified
- DATA-06 anchor (DST/tz fixtures persisted with baseline_excluded + exclusion_reason) verified
- Pitfall E anchor (Bearer/access_token absent from stderr capture under 401/429/500 flows) verified — D-34 attestation
- Pitfall I anchor (retroactive baseline_excluded re-flag) verified
- ADR-0001 + ADR-0002 + ADR-0007 + Gates A-G all green
- 3 integration tests bundled per scope_note; if executor exceeds context budget surface in SUMMARY for 03-11a/03-11b split in follow-up revision (Pitfall E test always stays in scope)
</success_criteria>

<output>
Create .planning/phases/03-data-model-db-layer-sync-loop/03-11-SUMMARY.md when done.
</output>
