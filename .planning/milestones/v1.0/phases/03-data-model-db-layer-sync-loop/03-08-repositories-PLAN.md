---
phase: 03-data-model-db-layer-sync-loop
plan: 08
type: execute
wave: 3
depends_on: ["03-02", "03-03", "03-05", "03-07"]
files_modified:
  - src/infrastructure/db/repositories/cycles.repo.ts
  - src/infrastructure/db/repositories/recovery.repo.ts
  - src/infrastructure/db/repositories/sleep.repo.ts
  - src/infrastructure/db/repositories/workouts.repo.ts
  - src/infrastructure/db/repositories/profile.repo.ts
  - src/infrastructure/db/repositories/body-measurements.repo.ts
  - src/infrastructure/db/repositories/sync-runs.repo.ts
  - src/infrastructure/db/repositories/decisions.repo.ts
  - src/infrastructure/db/repositories/daily-summaries.repo.ts
  - src/infrastructure/db/repositories/cycles.repo.test.ts
  - src/infrastructure/db/repositories/recovery.repo.test.ts
  - src/infrastructure/db/repositories/sync-runs.repo.test.ts
  - src/infrastructure/db/repositories/body-measurements.repo.test.ts
autonomous: true
requirements: [DATA-02, DATA-03, DATA-05, DATA-06, SYNC-04, SYNC-05]
tags: [drizzle, repositories, score-state, raw-json, begin-immediate]
user_setup: []

must_haves:
  truths:
    - "9 repositories under src/infrastructure/db/repositories/ — one per Plan 03-02 table (D-01)"
    - "Repositories return domain entity types from src/domain/types/entities.ts — NEVER Drizzle row types (D-28 + ARCHITECTURE.md Anti-Pattern 3)"
    - "Default WHERE on scored-entity reads: score_state = 'SCORED' AND baseline_excluded = 0 (D-04 + D-16); opt-in via {includeUnscored, includeExcluded} parameters"
    - "All upsertBatch implementations use db.transaction(...).immediate() (BEGIN IMMEDIATE per D-31 + Pitfall 13)"
    - "Idempotency: ON CONFLICT(id) DO UPDATE SET <col> = excluded.<col> for every WHOOP-sourced row (D-11 + Pitfall 10)"
    - "cursor() method on each paginated resource repo returns COALESCE(MAX(updated_at), '1970-01-01T00:00:00.000Z') (D-09)"
    - "Recoveries repo's compound PK is (cycle_id, sleep_id) — upsert uses ON CONFLICT(cycle_id, sleep_id) DO UPDATE per A12"
    - "Body-measurements repo implements append-on-change semantics (D-35 / Open Question 3): compare against latest row by (height_meter, weight_kilogram, max_heart_rate); if changed, insert new row with captured_at = clock.toISOString()"
    - "getRawJson(id) hidden diagnostic method per D-29 — domain code never calls it; surfaced to Phase 4 whoop_query_cache + whoop_api_gap tools"
    - "Sync_runs repo lifecycle methods: insertRunning(input), updatePerResource(id, resource, outcome), finalize(id, status, gapsDetected) per D-24"
    - "Decisions repo: minimal Phase 3 stub per Open Question 2 — insert(decision), byId(id), listOpen() — Phase 4 owns CLI/MCP surface"
    - "Daily-summaries repo: empty in Phase 3; ship the file with no-op insertOrUpdate + byDateRange stubs per Open Question 1 — Phase 4 baseline service writes"
    - "Gate G allowed inside src/infrastructure/db/ — drizzle-orm/* imports OK here only"
    - "ADR-0001: no console.* / process.stdout.write in any repository file"
  scope_note: |
    This plan kept as a single Plan 03-08 (not split into 03-08a / 03-08b) per checker
    Warning #6 (scope_sanity). Trade-off documented here so it does not slip past review:

    - Unit-test coverage in this plan is INTENTIONALLY focused on the 4 shape-archetype
      repos: cycles.repo.test.ts (canonical scored-paginated), recovery.repo.test.ts
      (compound-PK), sync-runs.repo.test.ts (lifecycle/JSON-merge), body-measurements.repo.test.ts
      (append-on-change). These cover the 4 distinct repo shapes; any regression in those
      shapes is caught here.
    - Unit-test coverage for the 5 auxiliary repos (sleep, workouts, profile, decisions,
      daily-summaries) is DEFERRED to Plan 03-10 contract tests, which exercise them
      end-to-end through MSW fixtures + the in-memory DB + sync orchestration.
    - Total surface area: 9 source files + 4 test files = 13 files modified. Upper bound
      of the scope budget but executable in one plan because: (a) each repo follows the
      same 4-method shape (cursor / upsertBatch / byRange / getRawJson) with mechanical
      adaptation, and (b) the row mapper pattern is established once in cycles.repo.ts
      and copy-pasted with type renames.
    - If executor finds Task 2 is brushing >50% context, surface in Plan 03-08 SUMMARY
      and the planner will split into 03-08a (Task 1 — scored-paginated) + 03-08b (Task 2 —
      auxiliary repos) in a follow-up revision.
  artifacts:
    - path: "src/infrastructure/db/repositories/cycles.repo.ts"
      provides: "Canonical repository shape — cursor / upsertBatch / byRange / getRawJson; (score_state, start) index used implicitly"
      contains: "ON CONFLICT(id) DO UPDATE"
    - path: "src/infrastructure/db/repositories/recovery.repo.ts"
      provides: "Compound-PK repo; ON CONFLICT(cycle_id, sleep_id) DO UPDATE"
      contains: "ON CONFLICT(cycle_id, sleep_id)"
    - path: "src/infrastructure/db/repositories/body-measurements.repo.ts"
      provides: "Append-on-change history per D-35"
      contains: "append-on-change"
    - path: "src/infrastructure/db/repositories/sync-runs.repo.ts"
      provides: "Lifecycle row insertRunning + updatePerResource + finalize per D-24"
      contains: "status: 'running'"
  key_links:
    - from: "src/infrastructure/db/repositories/*.repo.ts"
      to: "src/domain/types/entities.ts"
      via: "import type { Cycle, Recovery, ... }"
      pattern: "from '../../../domain/types/entities"
    - from: "src/infrastructure/db/repositories/*.repo.ts"
      to: "src/infrastructure/db/schema.ts"
      via: "named drizzle table imports"
      pattern: "from '../schema"
    - from: "src/infrastructure/db/repositories/*.repo.ts"
      to: "db.transaction(...).immediate()"
      via: "BEGIN IMMEDIATE write transactions (D-31)"
      pattern: "\\.immediate\\("
---

<objective>
Stand up 9 repositories that map Drizzle rows to domain entities (D-28), enforce default SCORED + non-excluded filters (D-04 / D-16), use BEGIN IMMEDIATE for every write (D-31), and provide the lifecycle/diagnostic seams the sync orchestrator (Plan 03-11) and Phase 4 will consume.

Purpose: Phase 4 baseline math reads from repositories; Phase 3 sync writes through them. Repositories are the boundary between the SQL world (snake_case columns, Drizzle types) and the domain world (camelCase entities, discriminated unions). Anti-Pattern 3 means a Drizzle row type must NEVER cross this boundary — repositories convert at the edge.

Output: 9 source files + 4 representative unit-test files (cycles, recovery, sync-runs, body-measurements — covering the shape variations: scored-paginated / compound-PK / lifecycle / append-on-change). Profile + sleep + workouts + decisions + daily_summaries get smoke coverage in Plan 03-10 contract tests per the `scope_note` in frontmatter must_haves.
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
@agent_docs/decisions/0003-score-state-discipline.md
@src/infrastructure/db/schema.ts
@src/infrastructure/db/connection.ts
@src/infrastructure/db/migrate.ts
@src/domain/types/entities.ts
@src/domain/types/score.ts
@src/domain/types/sync.ts
@tests/helpers/in-memory-db.ts

<interfaces>
<!-- Canonical repository contract (D-28 + D-29) -->

  // cycles.repo.ts
  export interface CyclesRepo {
    cursor(): Promise<string>;
    upsertBatch(rows: Cycle[]): Promise<{ changed: number }>;
    byRange(start: string, end: string, opts?: {
      includeUnscored?: boolean;
      includeExcluded?: boolean;
    }): Promise<Cycle[]>;
    getRawJson(id: number): Promise<string | null>;
  }
  export function createCyclesRepo(db: ReturnType<typeof drizzle>): CyclesRepo;

  // recovery.repo.ts — compound PK
  export interface RecoveryRepo {
    cursor(): Promise<string>;                                                   // MAX(updated_at)
    upsertBatch(rows: Recovery[]): Promise<{ changed: number }>;
    byCycleAndSleep(cycleId: number, sleepId: string): Promise<Recovery | null>;
    byRange(start: string, end: string, opts?: {...}): Promise<Recovery[]>;
    getRawJson(cycleId: number, sleepId: string): Promise<string | null>;
  }

  // sync_runs.repo.ts — D-24 lifecycle
  export interface SyncRunsRepo {
    insertRunning(input: { startedAt: string; flags: string | null }): Promise<number>;  // returns id
    updatePerResource(id: number, resource: ResourceName, outcome: ResourceSyncOutcome): Promise<void>;
    finalize(id: number, status: RunSyncStatus, gapsDetected: number, finishedAt: string): Promise<void>;
    listRecent(limit: number): Promise<SyncRun[]>;
  }

  // body-measurements.repo.ts — D-35 append-on-change
  export interface BodyMeasurementsRepo {
    upsertOnChange(measurement: { userId: number; heightMeter: number; weightKilogram: number; maxHeartRate: number; rawJson: string }, opts: { clock: Date }): Promise<{ inserted: boolean }>;
    listAll(): Promise<BodyMeasurement[]>;
    latest(): Promise<BodyMeasurement | null>;
    getRawJson(id: number): Promise<string | null>;
  }
</interfaces>
</context>

<tasks>

<task type="auto">
  <name>Task 1: Repositories for the 4 scored paginated resources (cycles, recovery, sleep, workouts)</name>
  <files>src/infrastructure/db/repositories/cycles.repo.ts, src/infrastructure/db/repositories/recovery.repo.ts, src/infrastructure/db/repositories/sleep.repo.ts, src/infrastructure/db/repositories/workouts.repo.ts, src/infrastructure/db/repositories/cycles.repo.test.ts, src/infrastructure/db/repositories/recovery.repo.test.ts</files>
  <read_first>
    - .planning/phases/03-data-model-db-layer-sync-loop/03-CONTEXT.md decisions D-04 (default WHERE score_state = SCORED), D-09 (MAX(updated_at) cursor), D-11 (ON CONFLICT DO UPDATE), D-16 (default WHERE baseline_excluded = 0), D-28 (return domain entities), D-29 (getRawJson hidden), D-31 (BEGIN IMMEDIATE)
    - .planning/phases/03-data-model-db-layer-sync-loop/03-RESEARCH.md §Specifics lines 240-243 (cursor query is bare MAX with COALESCE in caller; "no WHERE clause at all"); §Assumptions Log A6 (cycle id integer / sleep+workout UUID) + A12 (recoveries compound PK)
    - .planning/phases/03-data-model-db-layer-sync-loop/03-PATTERNS.md §A4 lines 337-403 (canonical repository contract + skeleton; tx.immediate() pattern)
    - .planning/research/PITFALLS.md Pitfall 3 (silent unscored leakage), Pitfall 10 (ON CONFLICT specifics), Pitfall 16 (hybrid storage)
    - src/infrastructure/db/schema.ts (Plan 03-02 — table names + column names + index names)
    - src/domain/types/entities.ts (Plan 03-03 — Cycle / Recovery / Sleep / Workout DUs)
    - tests/helpers/in-memory-db.ts (Plan 03-07 — createInMemoryDb for unit tests)
    - tests/fixtures/whoop/recovery/200-mixed-score-states.json (Plan 03-07 — Pitfall G verification anchor fixture)
  </read_first>
  <action>
    Create each repository as a factory function `createXyzRepo(db): XyzRepo`. All files share the shape from PATTERNS §A4. Per-file specifics:

    **cycles.repo.ts**:
      - Imports: `import { type drizzle } from 'drizzle-orm/better-sqlite3'`, `import { and, asc, eq, gte, lte, sql } from 'drizzle-orm'`, `import { cycles as cyclesTable } from '../schema.js'`, `import type { Cycle } from '../../../domain/types/entities.js'`.
      - `cursor()`: `db.select({ cursor: sql<string>\`COALESCE(MAX(${cyclesTable.updated_at}), '1970-01-01T00:00:00.000Z')\` }).from(cyclesTable).get()` → return `row.cursor`. NO WHERE clause per Specifics line 240. The bare MAX query lets SQLite's index satisfy it directly.
      - `upsertBatch(rows: Cycle[]): Promise<{changed: number}>`: use `db.transaction((tx) => { ... }, { behavior: 'immediate' })` if Drizzle supports the option (verify against drizzle-orm@0.45.2 docs; if not, fall back to raw `sqlite.exec('BEGIN IMMEDIATE')` + manual transaction). For each row, build the insert with `tx.insert(cyclesTable).values({...mapped from Cycle entity to row}).onConflictDoUpdate({target: cyclesTable.id, set: {/* all cols except id mapped from excluded */}})`. The row mapping is camelCase entity → snake_case columns. Sum `info.changes` from `Statement.run()` outputs; return `{changed}`.
      - `byRange(start, end, opts)`: `const where = and(gte(cyclesTable.start, start), lte(cyclesTable.start, end))`; if `!opts?.includeUnscored`, AND-in `eq(cyclesTable.score_state, 'SCORED')`; if `!opts?.includeExcluded`, AND-in `eq(cyclesTable.baseline_excluded, false)`; `db.select(...).from(cyclesTable).where(where).orderBy(asc(cyclesTable.start)).all()` → map each row to a Cycle entity (camelCase + score-state narrowing). The mapping function `rowToCycle(row): Cycle` is exported privately for testing.
      - `getRawJson(id)`: `db.select({raw_json: cyclesTable.raw_json}).from(cyclesTable).where(eq(cyclesTable.id, id)).get()` → `row?.raw_json ?? null`.

    **recovery.repo.ts** — compound PK shape:
      - `cursor()`: same shape but `MAX(updated_at) FROM recoveries`.
      - `upsertBatch`: `onConflictDoUpdate({target: [recoveriesTable.cycle_id, recoveriesTable.sleep_id], set: {...}})` — compound target.
      - `byCycleAndSleep(cycleId, sleepId)`: `db.select(...).where(and(eq(recoveriesTable.cycle_id, cycleId), eq(recoveriesTable.sleep_id, sleepId))).get()` → map or null.
      - `byRange(start, end, opts)`: range on `created_at` (recoveries have no `start` column; the (score_state, created_at) index from Plan 03-02 backs this). Same default-filter logic as cycles.
      - `getRawJson(cycleId, sleepId)`: compound key lookup.

    **sleep.repo.ts**:
      - `cursor()` / `upsertBatch` / `byRange` / `getRawJson` — same shape as cycles but `id` is `text` (UUID). Range on `start`. SCORED-only fields are sleep-specific.
      - upsert ON CONFLICT(id).

    **workouts.repo.ts**:
      - Same shape as sleeps (UUID id). Range on `start`. Workout-specific SCORED fields.

    All 4 files: NO drizzle row types in the export surface; return domain entities only. The internal mapping function uses `row.score_state` → narrowing → builds the correct DU variant. Score-state narrowing pattern:
    ```typescript
    function rowToCycle(row: { score_state: string; strain: number | null; ... }): Cycle {
      switch (row.score_state) {
        case 'SCORED':
          return { scoreState: 'SCORED', id: row.id, ..., strain: row.strain ?? 0, ... };
        case 'PENDING_SCORE':
          return { scoreState: 'PENDING_SCORE', id: row.id, ... /* no score fields */ };
        case 'UNSCORABLE':
          return { scoreState: 'UNSCORABLE', id: row.id, ... };
        default:
          throw new Error(`Unknown score_state on row id ${row.id}: ${row.score_state}`);
      }
    }
    ```

    Create `cycles.repo.test.ts` (canonical test pattern; recovery.repo.test.ts mirrors with compound-PK variations):
      - `beforeEach`: create in-memory DB via `createInMemoryDb()` from Plan 03-07.
      - Test 1: empty table → `cursor()` returns `'1970-01-01T00:00:00.000Z'` (COALESCE fallback per D-09).
      - Test 2: after upsertBatch of 3 cycles with varying updated_at → `cursor()` returns the max.
      - Test 3: upsertBatch is idempotent — call twice with same rows; `changed` count covers both invocations; row count in table stays 3.
      - Test 4: upsertBatch updates existing rows — first call inserts, second call with mutated `strain` updates without inserting; `byRange` returns the new strain value.
      - Test 5: `byRange(start, end)` with default opts excludes PENDING_SCORE rows — load mixed-score-states equivalent (inline JSON or one-off insert), assert 1 SCORED row returned.
      - Test 6: `byRange(start, end, {includeUnscored: true})` returns all 3.
      - Test 7: `byRange` with default opts excludes `baseline_excluded = 1` rows — insert a DST-flagged cycle, assert filtered out.
      - Test 8: `byRange(start, end, {includeExcluded: true})` returns it.
      - Test 9: `getRawJson(id)` returns the stored raw_json string; nonexistent id returns null.
      - Test 10: upsertBatch wraps in BEGIN IMMEDIATE — assert via spying on `sqlite.exec` or by reading the transaction behavior (drizzle's `db.transaction(...).immediate()` is the canonical API in 0.45.x; if the API differs, document the equivalent in the test). At minimum, assert that a concurrent reader during upsert sees consistent rows (use `db.prepare('BEGIN; ...').run()` racing the upsert in a different connection — too fragile; instead assert API usage via a code-grep test reading the source).

    `recovery.repo.test.ts` covers analogous tests + tests 11-12: compound PK (cycle_id, sleep_id) upsert idempotency; byCycleAndSleep happy path + missing row.

    Sleep + Workouts get smoke coverage in Plan 03-10 contract tests; this plan ships their source files but skips their unit tests (capacity budget — see frontmatter `scope_note`).
  </action>
  <verify>
    <automated>npm run test -- src/infrastructure/db/repositories/cycles.repo.test.ts src/infrastructure/db/repositories/recovery.repo.test.ts</automated>
  </verify>
  <acceptance_criteria>
    - 4 repository source files exist; each exports `createXyzRepo` factory and matching `XyzRepo` interface
    - `grep -c "onConflictDoUpdate" src/infrastructure/db/repositories/cycles.repo.ts src/infrastructure/db/repositories/recovery.repo.ts src/infrastructure/db/repositories/sleep.repo.ts src/infrastructure/db/repositories/workouts.repo.ts` returns at least 4 (one per file)
    - `grep -c "target: \[" src/infrastructure/db/repositories/recovery.repo.ts` returns at least 1 (compound PK target)
    - `grep -c "score_state.*SCORED\|score_state = 'SCORED'" src/infrastructure/db/repositories/cycles.repo.ts` returns at least 1 (default filter)
    - `grep -c "baseline_excluded.*false\|baseline_excluded = 0" src/infrastructure/db/repositories/cycles.repo.ts` returns at least 1
    - `grep -c "COALESCE" src/infrastructure/db/repositories/cycles.repo.ts src/infrastructure/db/repositories/recovery.repo.ts src/infrastructure/db/repositories/sleep.repo.ts src/infrastructure/db/repositories/workouts.repo.ts` returns at least 4
    - `grep -rE "from ['\"]drizzle-orm" src/infrastructure/db/repositories/` returns ≥ 4 lines (Gate G allows this inside src/infrastructure/db/)
    - `grep -rEn "from ['\"]drizzle-orm" src/domain/ src/services/ 2>/dev/null` returns 0 lines (Gate G CI gate stays green)
    - `npm run test -- src/infrastructure/db/repositories/cycles.repo.test.ts src/infrastructure/db/repositories/recovery.repo.test.ts` shows at least 22 assertions passing (10 + 12)
    - `npm run lint` exits 0; `npx tsc --noEmit` exits 0
  </acceptance_criteria>
  <done>4 scored-paginated repositories shipped with default SCORED + non-excluded filters, idempotent upserts via ON CONFLICT, BEGIN IMMEDIATE writes; 22+ assertions exercising Pitfall 3 + Pitfall 10 + D-04 + D-16.</done>
</task>

<task type="auto">
  <name>Task 2: Repositories for profile / body-measurements / sync-runs / decisions / daily-summaries + tests</name>
  <files>src/infrastructure/db/repositories/profile.repo.ts, src/infrastructure/db/repositories/body-measurements.repo.ts, src/infrastructure/db/repositories/sync-runs.repo.ts, src/infrastructure/db/repositories/decisions.repo.ts, src/infrastructure/db/repositories/daily-summaries.repo.ts, src/infrastructure/db/repositories/sync-runs.repo.test.ts, src/infrastructure/db/repositories/body-measurements.repo.test.ts</files>
  <read_first>
    - .planning/phases/03-data-model-db-layer-sync-loop/03-CONTEXT.md decisions D-24 (sync_runs row shape), D-25 (per-resource outcome enum), D-32 (wal_checkpoint after success — sync orchestrator handles, not the repo)
    - .planning/phases/03-data-model-db-layer-sync-loop/03-RESEARCH.md §Open Questions 1 + 2 + 3 (daily_summaries empty + decisions minimal stub + body_measurements append-on-change), §Technical Research item 3 (profile + body_measurements semantics)
    - .planning/phases/03-data-model-db-layer-sync-loop/03-PATTERNS.md §A4 "Notes on deltas" lines 396-404 (single-row + append-on-change + lifecycle variants)
    - src/infrastructure/db/schema.ts (Plan 03-02 — profile / body_measurements / sync_runs / decisions / daily_summaries column shapes)
    - src/domain/types/entities.ts (Plan 03-03 — Profile / BodyMeasurement / SyncRun / Decision / DailySummary types)
    - src/domain/types/sync.ts (Plan 03-04 — ResourceSyncOutcome + RunSyncStatus + ResourceName)
  </read_first>
  <action>
    Create the 5 remaining repositories.

    **profile.repo.ts** — single-row table; no cursor (per A4: WHOOP doesn't emit updated_at on profile). Methods:
      - `getCurrent(): Promise<Profile | null>` — `db.select(...).from(profileTable).get()` (single row; null if empty). Map to Profile entity (camelCase).
      - `upsert(profile: { userId: number; email: string; firstName: string; lastName: string; rawJson: string }, opts: { clock: Date }): Promise<void>` — replace-on-write semantics; the profile row is current-state. Use ON CONFLICT(user_id) DO UPDATE.
      - `getRawJson(userId): Promise<string | null>`.

    **body-measurements.repo.ts** — append-on-change per Open Question 3 / D-35:
      - `upsertOnChange(measurement: { userId, heightMeter, weightKilogram, maxHeartRate, rawJson }, opts: { clock: Date }): Promise<{ inserted: boolean }>`:
        - Read latest row: `const latest = db.select(...).from(bodyMeasurementsTable).where(eq(bodyMeasurementsTable.user_id, measurement.userId)).orderBy(desc(bodyMeasurementsTable.captured_at)).limit(1).get()`.
        - If latest exists AND `latest.height_meter === measurement.heightMeter && latest.weight_kilogram === measurement.weightKilogram && latest.max_heart_rate === measurement.maxHeartRate`, return `{inserted: false}` (no-op).
        - Else, insert new row with `captured_at = opts.clock.toISOString()`. Return `{inserted: true}`. Wrap in `db.transaction(...).immediate()` per D-31.
      - `listAll()`: returns history sorted by `captured_at desc`.
      - `latest()`: returns most recent row or null.
      - `getRawJson(id): Promise<string | null>`.

    **sync-runs.repo.ts** — lifecycle per D-24:
      - `insertRunning(input: { startedAt: string; flags: string | null }): Promise<number>` — INSERT with `status='running'`, `per_resource='{}'`, `gaps_detected=0`. Return the new `id` (autoincrement). BEGIN IMMEDIATE inside.
      - `updatePerResource(id: number, resource: ResourceName, outcome: ResourceSyncOutcome): Promise<void>`:
        - Read the current `per_resource` JSON.
        - `const merged = {...JSON.parse(row.per_resource), [resource]: outcome}`.
        - Update with `JSON.stringify(merged)`. BEGIN IMMEDIATE.
      - `finalize(id: number, status: RunSyncStatus, gapsDetected: number, finishedAt: string): Promise<void>` — UPDATE sets status + finished_at + gaps_detected. BEGIN IMMEDIATE.
      - `listRecent(limit: number = 10): Promise<SyncRun[]>` — ORDER BY started_at DESC LIMIT N. Maps row → SyncRun entity (parses per_resource JSON, narrows status enum).

    **decisions.repo.ts** — minimal stub per Open Question 2 (Phase 4 owns CLI/MCP surface):
      - `insert(d: { id: string; createdAt: string; category: string; decision: string; rationale: string | null; confidence: 'low' | 'medium' | 'high' | null; expectedEffect: string | null; followUpDate: string | null }): Promise<void>` — INSERT only; ULID id. BEGIN IMMEDIATE.
      - `byId(id: string): Promise<Decision | null>`.
      - `listOpen(): Promise<Decision[]>` — WHERE status = 'open' ORDER BY created_at DESC.
      - No `updateOutcome` yet — Phase 4 adds it.
      - Pitfall 7 reminds us decisions are irreplaceable; backup posture from Plan 03-05 covers them.

    **daily-summaries.repo.ts** — empty in Phase 3 per Open Question 1 (Phase 4 writes; this plan creates the table-touching file so Phase 4 doesn't have to):
      - `upsertOneDay(summary: DailySummary): Promise<void>` — placeholder; ON CONFLICT(date) DO UPDATE. Phase 4 baseline service is the only caller.
      - `byDateRange(start: string, end: string): Promise<DailySummary[]>` — WHERE date BETWEEN start AND end.
      - `latestComputedAt(): Promise<string | null>` — MAX(computed_at).
      - No tests in this plan (table empty in Phase 3); just compile + lint cleanly.

    Create `sync-runs.repo.test.ts`:
      - Test 1: insertRunning returns a numeric id; subsequent inserts return strictly increasing ids.
      - Test 2: status='running', per_resource='{}', gaps_detected=0 after insertRunning.
      - Test 3: updatePerResource('cycles', {status: 'success', fetched: 42, upserted: 42}) merges into the JSON; per_resource for 'cycles' has these fields after.
      - Test 4: a second updatePerResource('workouts', {...}) leaves the cycles entry intact (merge, not overwrite).
      - Test 5: finalize(id, 'ok', 0, finishedAt) updates status + finished_at + gaps_detected.
      - Test 6: listRecent(5) returns rows sorted by started_at DESC.
      - Test 7: listRecent maps per_resource back to the typed Record<ResourceName, ResourceSyncOutcome> shape (Zod-validated through the schema from Plan 03-03).

    Create `body-measurements.repo.test.ts`:
      - Test 1: First upsertOnChange inserts → `{inserted: true}` + listAll().length === 1.
      - Test 2: Second upsertOnChange with IDENTICAL values → `{inserted: false}` + listAll().length === 1.
      - Test 3: upsertOnChange with weight changed → `{inserted: true}` + listAll().length === 2; latest().weightKilogram === new value.
      - Test 4: upsertOnChange with height changed → inserted.
      - Test 5: upsertOnChange with max_heart_rate changed → inserted.
      - Test 6: captured_at is set from `opts.clock.toISOString()` (injected, not Date.now()).
      - Test 7: getRawJson(id) returns the stored raw_json.

    Profile + decisions + daily-summaries get smoke coverage in Plan 03-10 contract tests (per frontmatter `scope_note`).
  </action>
  <verify>
    <automated>npm run test -- src/infrastructure/db/repositories/sync-runs.repo.test.ts src/infrastructure/db/repositories/body-measurements.repo.test.ts</automated>
  </verify>
  <acceptance_criteria>
    - 5 new repository source files exist
    - `grep -c "insertRunning\|updatePerResource\|finalize" src/infrastructure/db/repositories/sync-runs.repo.ts` returns at least 3 (one per method)
    - `grep -c "upsertOnChange" src/infrastructure/db/repositories/body-measurements.repo.ts` returns at least 1
    - body-measurements.repo.ts contains a tuple-equality check on (height, weight, max_heart_rate) — verify via `grep -c "height_meter\|weight_kilogram\|max_heart_rate" src/infrastructure/db/repositories/body-measurements.repo.ts` returns at least 3
    - `npm run test -- src/infrastructure/db/repositories/sync-runs.repo.test.ts src/infrastructure/db/repositories/body-measurements.repo.test.ts` shows at least 14 assertions passing (7 + 7)
    - `bash scripts/ci-grep-gates.sh` exits 0
    - `npx tsc --noEmit` exits 0; `npm run lint` exits 0
    - Total repository source files === 9 (matches D-01 / Plan 03-02 table count): `ls src/infrastructure/db/repositories/*.repo.ts | wc -l` returns 9
  </acceptance_criteria>
  <done>5 remaining repositories shipped; sync_runs lifecycle per D-24 + body_measurements append-on-change per D-35 covered by ≥14 assertions. All 9 repository files exist.</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| Drizzle row types → domain entity mapping in repository files | Enforces Anti-Pattern 3 — row types stay inside the file |
| ON CONFLICT DO UPDATE clauses | Atomic per-row upsert; Pitfall 10 mitigation |
| BEGIN IMMEDIATE writes (D-31) | Pitfall 13 mitigation; busy_timeout=5000 covers contention bursts |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-03.08-01 | Information disclosure | A repository accidentally returns a Drizzle row instead of the domain entity | mitigate | TS strict mode + the interface definitions force compile-time discipline; Gate G ensures no drizzle-orm import leaks out of src/infrastructure/db/ |
| T-03.08-02 | Tampering | A test data-class instantiates `Cycle` with scoreState='PENDING_SCORE' AND strain present (DU violation) | mitigate | The DU in entities.ts (Plan 03-03) makes this a compile error; if a test bypasses with `as Cycle`, the cycle.repo.test.ts Test 5 (default-filter SCORED-only) catches the data mismatch via runtime parse. |
| T-03.08-03 | Repudiation | Sync_runs row never updated on partial failure | mitigate | sync-runs.repo.test.ts Test 3 + 4 lock the merge-into-JSON semantic; Plan 03-11 partial-failure integration test exercises the path end-to-end. |
| T-03.08-04 | Denial of service | A long-running upsertBatch holds BEGIN IMMEDIATE lock | accept | Per-resource batches are bounded (max 25 records per page × max ~14 pages for 365-day backfill = ~350 rows); single transaction completes in <100ms. busy_timeout=5000 buffers concurrent readers. |
| T-03.08-05 | Information disclosure | getRawJson(id) returns user data via a future MCP tool | accept | Phase 4 owns whoop_query_cache + whoop_api_gap; both are user-initiated. getRawJson is the documented forward-compat path per D-29. |
| T-03.08-06 | Tampering | A repository allows score_state value outside the enum | mitigate | Schema (Plan 03-02) enforces enum at the column level; row mapper's switch's default case throws on unknown value. |
</threat_model>

<verification>
- `npm run test -- src/infrastructure/db/repositories/` → all ≥ 36 assertions green (22 + 14)
- `npm run lint` → 0 errors
- `bash scripts/ci-grep-gates.sh` → all 7 gates green (Gate G shows drizzle-orm imports confined to src/infrastructure/db/)
- `npx tsc --noEmit` → 0 errors
- `ls src/infrastructure/db/repositories/*.repo.ts | wc -l` → 9
</verification>

<success_criteria>
- 9 repositories cover the 9 tables from Plan 03-02 D-01
- Default repo filter is `score_state = 'SCORED' AND baseline_excluded = 0` on scored entities (D-04 + D-16)
- Idempotency: ON CONFLICT(id) DO UPDATE (cycles, sleeps, workouts) + ON CONFLICT(cycle_id, sleep_id) DO UPDATE (recoveries) per D-11 + Pitfall 10
- All writes use BEGIN IMMEDIATE via `db.transaction(...).immediate()` per D-31 + Pitfall 13
- Cursors are bare MAX(updated_at) with COALESCE fallback to epoch-zero per D-09 + Specifics line 240
- Body-measurements append-on-change per Open Question 3 + D-35 (compare-then-insert on height/weight/max_heart_rate tuple)
- Sync_runs lifecycle methods (insertRunning, updatePerResource, finalize) match D-24 shape
- Anti-Pattern 3 enforced: no Drizzle row types leak into the return-type surface; Gate G stays green
- Scope deferral documented in must_haves.scope_note: 4 auxiliary repos (sleep / workouts / profile / decisions / daily-summaries) have unit-test coverage deferred to Plan 03-10 contract tests; if executor exceeds context budget, surface in SUMMARY for a 03-08a/03-08b split in follow-up revision
</success_criteria>

<output>
Create `.planning/phases/03-data-model-db-layer-sync-loop/03-08-SUMMARY.md` when done.
</output>
