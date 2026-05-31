---
phase: 03-data-model-db-layer-sync-loop
plan: 11
subsystem: sync-orchestration
tags: [sync, orchestration, bootstrap, services-barrel, integration-test, wal-checkpoint, pitfall-e, pitfall-i, sync-04, sync-05, sync-06, data-06]

# Dependency graph
requires:
  - phase: 03-data-model-db-layer-sync-loop (Wave 1a)
    provides: D-23/D-24/D-25/D-26 sync types + RESOURCES tuple + computeWindow cursor (Plan 03-04)
  - phase: 03-data-model-db-layer-sync-loop (Wave 1b)
    provides: 3-layer type system; Cycle/Recovery/Sleep/Workout DUs (Plan 03-03)
  - phase: 03-data-model-db-layer-sync-loop (Wave 2b)
    provides: openDb factory + hand-rolled migrator + canonical drizzle re-export (Plan 03-05)
  - phase: 03-data-model-db-layer-sync-loop (Wave 3)
    provides: 6 MSW helpers + 15 fixtures + in-memory-db helper (Plan 03-07)
  - phase: 03-data-model-db-layer-sync-loop (Wave 4a)
    provides: 9 repositories with BEGIN IMMEDIATE + ON CONFLICT (Plan 03-08)
  - phase: 03-data-model-db-layer-sync-loop (Wave 4b)
    provides: DST detector + 6 normalizers + 6 per-resource HTTP modules (Plan 03-09)
  - phase: 03-data-model-db-layer-sync-loop (Wave 5a)
    provides: 6 contract tests confirming Wave 3+4 stack composes correctly (Plan 03-10)
provides:
  - src/services/sync/index.ts — runSync(input, deps) per D-23/D-24/D-25/D-32 + Pattern 6
  - src/services/sync/per-resource.ts — pure classifyOutcome + computeStatus
  - src/services/bootstrap.ts — composition root: openDb + migrate + 9 repos + 6 resource modules + sync deps wired into Bootstrapped {db, sqlite, services, close}
  - extended src/services/index.ts barrel exporting bootstrap + runSync + RunSyncInput/RunSyncResult types
  - tests/integration/sync/idempotency.test.ts — SYNC-04 anchor (4 tests)
  - tests/integration/sync/partial-failure.test.ts — SYNC-05 + SYNC-06 + Pitfall E anchor (6 tests)
  - tests/integration/sync/dst-fixture.test.ts — DATA-06 + Pitfall H + Pitfall I anchor (5 tests)
  - tests/integration/sync/helpers/all-resources-msw.ts — combined MSW helper bundling all 6 endpoints into one setupServer
affects: [Phase 03 Plan 03-12 (CLI sync shim) — 5-line shim over services.runSync; Phase 04 whoop_sync MCP tool — same 5-line shim over the same runSync]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Composition root pattern: bootstrap() is the SINGLE place outside src/infrastructure/db/ that opens the DB + runs the migrator + wires repos + resource modules + sync deps. CLI shims call bootstrap(); MCP layer (Phase 4) will too."
    - "DI shape: RunSyncDeps carries every collaborator (repos, resource modules, sqlite, clock, ianaZone, logger). Tests construct deps inline; production uses bootstrap()."
    - "Per-resource try/catch: a failed resource X does NOT block resource Y. classifyOutcome maps the throwable to D-25 status; computeStatus rolls up to D-24 run-level."
    - "Combined MSW server for integration tests: ONE setupServer with all 6 handlers (multiple setupServer instances in one process clobber each other — shared underlying Node interceptor)."
    - "Injected logger for stderr-leak assertions: tests pass a Pino logger pointed at an in-memory buffer to capture orchestrator output deterministically (sonic-boom writes directly to fd 2, bypassing process.stderr.write spies)."

key-files:
  created:
    - src/services/sync/index.ts
    - src/services/sync/per-resource.ts
    - src/services/bootstrap.ts
    - tests/integration/sync/idempotency.test.ts
    - tests/integration/sync/partial-failure.test.ts
    - tests/integration/sync/dst-fixture.test.ts
    - tests/integration/sync/helpers/all-resources-msw.ts
  modified:
    - src/services/index.ts (extended Services interface + re-exports bootstrap + runSync types)

key-decisions:
  - "Composition strategy (b) chosen per PATTERNS §D3: createServices() stays lightweight (no DB) so existing doctor/auth consumers pay no DB-open cost; runSync requires bootstrap(). The Services interface still declares runSync so Phase 4's MCP tool can depend on the same type surface; createServices() returns a throwing stub for runSync that documents the bootstrap() requirement."
  - "Sentinel-based 'skipped' outcome seeding: every resource in RESOURCES is initialized to {status: 'skipped'} BEFORE the loop runs. The non-requested arm reads via `perResource[resource] ?? SKIPPED` (no non-null assertion) so a future refactor that drops the seed cannot silently produce a `null` outcome in sync_runs."
  - "Cycles tz_drift seeding: orchestrator reads the latest pre-existing cycle's timezoneOffset via cycles.byRange(7d-ago, until, {includeUnscored: true, includeExcluded: true}) — wide-enough lookback to find the chronologically-prior cycle regardless of cursor advance, AND includes excluded rows so a DST-flagged prior still seeds the chain (matches the Plan 03-09 rolling-prior-offset walk inside the resource module)."
  - "Validation error → partial_5xx (not failed_network) — per D-25 mapping. An unexpected wire-format is treated as a server bug: the sync run records the failure but can proceed with other resources. The raw Zod error is preserved in the WhoopApiError.cause chain for sanitization at the MCP boundary (D-34)."
  - "Test 2 of partial-failure.test.ts uses an INJECTED Pino logger (writing to an in-memory buffer) instead of spying on process.stderr.write. Pino's sonic-boom destination writes directly to fd 2 via low-level syscalls — process.stderr.write spies do not intercept it. The injected-logger approach is also a useful design seam for Phase 4 review tests."
  - "Test 5 of dst-fixture.test.ts (Pitfall I retroactive shift) builds the cycle payload inline rather than reusing a committed fixture. The test needs DETERMINISTIC control over the start/end times to assert the boundary-crossing behavior — a stable id (99001) lets the second sync exercise the ON CONFLICT DO UPDATE path on the same row."

patterns-established:
  - "Pattern (Plan 03-11 §1): composition root in src/services/bootstrap.ts — drizzle imported through Plan 03-05's connection.ts canonical re-export (Gate G strict)."
  - "Pattern (Plan 03-11 §2): RunSyncDeps DI shape — repos + whoop.resources + sqlite + clock + ianaZone + logger. The orchestrator never reads process.env or new Date() directly; tests pin every collaborator inline."
  - "Pattern (Plan 03-11 §3): per-resource pipeline factored into syncOneResource(resource, deps, ianaZone, clockNow, input) so the orchestrator loop stays a flat switch and the branch-local types stay inside the case."
  - "Pattern (Plan 03-11 §4): integration test composition — vi.mock refresh-orchestrator → dynamic-import every collaborator → createInMemoryDb + createAllResourcesMsw → build deps inline → assert."
  - "Pattern (Plan 03-11 §5): in-memory Pino logger for stderr-leak assertions — pinoMod.default({level:'info'}, customDest) where customDest is {write: (chunk) => { captured.push(chunk); return true; }}."

requirements-completed: [SYNC-01, SYNC-02, SYNC-03, SYNC-04, SYNC-05, SYNC-06, DATA-01, DATA-04, DATA-06]

# Metrics
duration: 13min
completed: 2026-05-16
---

# Phase 3 Plan 11: Sync Orchestration Summary

**The integration moment — runSync orchestrator + bootstrap composition root + 3 load-bearing integration tests compose Phase 3's pieces into a working services.runSync() callable. SYNC-04 + SYNC-05 + SYNC-06 + DATA-06 verified end-to-end; Pitfall E (token leak via Pino) + Pitfall I (retroactive DST shift re-flag) locked at runtime.**

## Performance

- **Duration:** approximately 13 minutes
- **Tasks:** 2 of 2 completed
- **Files created:** 7
- **Files modified:** 1
- **Tests added:** 15 (project total: 509 → 524)
- **Integration suite runtime:** 9.98s for all 5 sync integration files (24 assertions, well under the 60s SYNC-07 budget)

## Accomplishments

- **runSync orchestrator (src/services/sync/index.ts)**: implements D-23 sequential 6-resource loop (profile → body_measurements → cycles → recoveries → sleeps → workouts), D-24 sync_runs lifecycle (insertRunning → per-resource updates → finalize), D-25 per-resource outcome enum (success / partial_429 / partial_5xx / failed_auth / failed_network / skipped), D-32 wal_checkpoint(TRUNCATE) gated on ok|partial only. Each resource runs in its own try/catch so a 429 on workouts does NOT block cycles per D-23.
- **Pure helpers (src/services/sync/per-resource.ts)**: classifyOutcome(err) maps WhoopApiError + AuthError into the D-25 outcome enum (rate_limited→partial_429; server+validation→partial_5xx; network+unknown→failed_network; unauthorized+AuthError→failed_auth; any other throwable→failed_network). computeStatus(perResource, requested) rolls per-resource outcomes into D-24 RunSyncStatus.
- **Bootstrap composition root (src/services/bootstrap.ts)**: opens the SQLite database via Plan 03-05's openDb, runs the hand-rolled migrator with chmod-600 pre-migration backups, constructs all 9 repository factories, wires the 6 resource modules, builds the RunSyncDeps shape, and returns Bootstrapped {db, sqlite, services, close}. The ONLY non-test module outside src/infrastructure/db/ that touches openDb + migrate + the repository factories. Drizzle imported through Plan 03-05's connection.ts canonical re-export (Gate G strict).
- **Extended services barrel (src/services/index.ts)**: adds runSync to the Services interface, re-exports bootstrap + Bootstrapped + RunSyncInput/RunSyncResult/RunSyncDeps types so CLI shims (Plan 03-12) and Phase 4's MCP tool import from one surface. createServices() throws on runSync to document the bootstrap() requirement.
- **SYNC-04 anchor (idempotency.test.ts)**: two consecutive runSync({days:30}) runs produce 0 net new rows across all 6 tables; sync_runs has 2 rows both status='ok'; MSW hit counts confirm sync 2 actually re-fetched (no caching at the orchestrator layer). The sync_runs.per_resource JSON round-trips with fetched/upserted/durationMs per D-24 shape.
- **SYNC-05 + SYNC-06 anchors (partial-failure.test.ts)**: workouts 429 always → status='partial' + sync_runs.partial_429 + wal_checkpoint(TRUNCATE) fires; all-resources 500 → status='failed' + wal_checkpoint(TRUNCATE) does NOT fire (D-32); mixed 429+500+ok → status='partial' with both error classes; --resources subset → others marked 'skipped'; validation error → partial_5xx.
- **Pitfall E + D-34 attestation (partial-failure.test.ts Test 2 — LOAD-BEARING)**: orchestrator's Pino output captured through an injected in-memory logger. After a server-error flow whose response body contains `Bearer abc.def.ghi access_token=secret123 jwt: eyJhbGci...`, the captured output contains NO Bearer / access_token / JWT-shape strings — proves the orchestrator's structured logging payload never leaks token material even when the WhoopApiError.cause chain carries it.
- **DATA-06 + Pitfall H anchors (dst-fixture.test.ts)**: spring-forward (Mar 8) + fall-back (Nov 1) fixtures persist with baseline_excluded=1 + exclusion_reason='dst_straddle' verified via raw SQL; tz-trip-sfo-jfk → record 1 (-08:00) clean, record 2 (-05:00) tz_drift, record 3 (-05:00) clean.
- **Pitfall I anchor (dst-fixture.test.ts Test 5)**: a retroactive WHOOP update that shifts a cycle's `start` past a DST boundary FLIPS baseline_excluded from 0 to 1 on the second sync. The detector re-runs at every upsert thanks to ON CONFLICT DO UPDATE re-applying the baseline_excluded + exclusion_reason columns. The most subtle invariant of the phase, verified end-to-end.

## Task Commits

1. **Task 1: Implement sync orchestrator + bootstrap + extended services barrel** — `e742e44` (feat)
2. **Task 2: Integration tests for idempotency + partial-failure + DST round-trip** — `367b6c2` (test)

## Files Created

- `src/services/sync/index.ts` (~290 lines) — runSync(input, deps) orchestrator + syncOneResource per-resource switch + RunSyncDeps interface. Pino logs for sync_started / sync_resource_done / sync_finished structured events.
- `src/services/sync/per-resource.ts` (~95 lines) — classifyOutcome + computeStatus pure helpers; closed switch on WhoopApiError kinds + AuthError + catch-all arm.
- `src/services/bootstrap.ts` (~135 lines) — bootstrap(opts?: BootstrapOptions): Bootstrapped composition root.
- `tests/integration/sync/idempotency.test.ts` (~270 lines, 4 tests) — first run baseline + second run zero-delta + hit-count confirmation + sync_runs.per_resource shape contract.
- `tests/integration/sync/partial-failure.test.ts` (~320 lines, 6 tests) — workouts-429 partial + Pitfall E logger leak grep + all-500 failed (wal-checkpoint NOT fires) + mixed-error classes + --resources subset skipping + validation-error mapping.
- `tests/integration/sync/dst-fixture.test.ts` (~265 lines, 5 tests) — spring-forward + fall-back + tz-trip-sfo-jfk fixtures persisting flags via raw SQL + idempotent re-apply + Pitfall I retroactive shift flip.
- `tests/integration/sync/helpers/all-resources-msw.ts` (~115 lines) — combined SetupServer bundling all 6 WHOOP v2 endpoint handlers; per-resource hit counters; setNextResponse + setNextFixture seam.

## Files Modified

- `src/services/index.ts` — added `runSync` to the Services interface; re-exported `bootstrap` + `Bootstrapped` + `BootstrapOptions` + `runSync` + `RunSyncDeps` + `RunSyncInput`/`RunSyncResult`/`ResourceName`/`ResourceSyncOutcome`/`ResourceSyncStatus`/`RunSyncStatus` types. `createServices()` returns a throwing stub for runSync so the existing doctor/auth consumers do not pay the DB-open cost while the type surface declares the dependency for Phase 4.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Test infra blocking] Multiple setupServer instances clobber each other**
- **Found during:** Task 2 (first run of idempotency.test.ts)
- **Issue:** The integration test initially called `.server.listen()` on six separate per-resource MSW SetupServer instances (one from each `tests/helpers/msw-whoop-*.ts` helper). Only the LAST `.listen()` call's interceptor was active — MSW's `setupServer` shares an underlying Node-level fetch interceptor. Symptom: 5 of 6 endpoints returned `[MSW] intercepted a request without a matching request handler`, every resource fetch failed with `failed_network`.
- **Fix:** Created `tests/integration/sync/helpers/all-resources-msw.ts` — a combined SetupServer with all 6 WHOOP v2 endpoint handlers in a single instance, plus per-resource hit counters and a `setNextResponse` / `setNextFixture` seam matching the existing per-resource helper API. Rewrote all 3 integration tests to use it.
- **Files modified:** added `tests/integration/sync/helpers/all-resources-msw.ts`; rewrote `idempotency.test.ts` to use it; subsequent two test files used it from the start.
- **Commit:** `367b6c2`

**2. [Rule 3 - Test infra blocking] process.stderr.write spy does not intercept Pino output**
- **Found during:** Task 2 (Test 2 of partial-failure.test.ts — Pitfall E grep)
- **Issue:** The initial Pitfall E test spied on `process.stderr.write` and asserted captured chunks were free of Bearer / access_token strings. The spy captured zero output. Root cause: Pino's prod arm uses `pino.destination({dest: 2, sync: false})`, which constructs a `sonic-boom` instance that writes to fd 2 via low-level `fs.writeSync` (or libuv equivalents), bypassing the Node `process.stderr` Writable's `.write()` method entirely. The spy was inert.
- **Fix:** Switched to injecting a Pino logger pointed at an in-memory destination object: `const captured: string[] = []; const customDest = {write: (chunk) => { captured.push(chunk); return true; }}; const testLogger = pinoMod.default({level: 'info'}, customDest)`. Verified Pino accepts the destination shape via a one-liner before committing. The orchestrator's RunSyncDeps already accepts an injected logger, so the change was a single-line override in the test's deps construction. As a bonus, the same pattern is reusable for Phase 4 review tests that need to assert orchestrator log payload shape.
- **Files modified:** `tests/integration/sync/partial-failure.test.ts` Test 2.
- **Commit:** `367b6c2`

**3. [Rule 1 - Plan-text bug] Plan called for non-null assertion on `perResource[resource]`**
- **Found during:** Task 1 (Biome warning during `npm run lint`)
- **Issue:** Biome flagged `noNonNullAssertion` on `perResource[resource]!` in the skipped-resource branch of the orchestrator loop. The plan's pseudo-code in PLAN.md Task 1 line 263 implied `perResource[resource]!` would be safe because the loop seeded every resource as `{status: 'skipped'}` first. Biome (rightly) does not trust this implicit invariant.
- **Fix:** Introduced a `SKIPPED` sentinel constant and used the nullish-coalescing fallback `perResource[resource] ?? SKIPPED` so the type-narrowing is locally derivable from the code, not from a separate seeding loop. Documented the sentinel with a comment explaining the defense against a future refactor that drops the seeding.
- **Files modified:** `src/services/sync/index.ts`.
- **Commit:** `e742e44`

**4. [Rule 1 - Plan-text bug] Doc-comment-vs-Gate-G grep collision**
- **Found during:** Task 1 (`bash scripts/ci-grep-gates.sh` — Gate G failed)
- **Issue:** A leading-comment line in `src/services/sync/index.ts` referenced the Gate G rule by quoting the forbidden import shape verbatim: `// Gate G: no \`from 'drizzle-orm/...'\` imports in this file.` The Gate G regex (`from\s+['\"]drizzle-orm`) matched the doc comment. Same pattern as the 8 prior precedents across Phases 2 + 3 (PLAN 02-01 / 02-02 / 02-04 / 02-06 / 03-01 / 03-03 / 03-04 / 03-07).
- **Fix:** Rephrased the comment to describe the rule without spelling the literal import path: `// Gate G: this file does NOT import the drizzle-orm package directly.`
- **Files modified:** `src/services/sync/index.ts`.
- **Commit:** `e742e44` (subsequent amend not needed — caught before commit).

**5. [Rule 3 - Biome formatter] Auto-fix on services/ + integration/sync/**
- **Found during:** Task 1 + Task 2 (`npm run lint`)
- **Issue:** Biome formatter wanted import-sort + collapse multi-line type imports + remove redundant else-arms.
- **Fix:** Ran `npm run format -- src/services/ tests/integration/sync/` — 7 files auto-fixed across both tasks.
- **Commit:** rolled into `e742e44` + `367b6c2`.

### Architectural Decisions Made During Execution

None requested. Plan's composition shape (b) chosen and implemented as specified.

## Verification Anchors

- **SYNC-04 (idempotency)**: `idempotency.test.ts` Test 2 — 0 net new rows after second sync; row counts captured via repos and compared.
- **SYNC-05 (partial failure)**: `partial-failure.test.ts` Test 1 — workouts 429 → run-level status='partial'; sync_runs.per_resource.workouts.status='partial_429'.
- **SYNC-06 (wal_checkpoint(TRUNCATE) on ok|partial)**: `partial-failure.test.ts` Test 1 + Test 3 — pragma spy confirms `wal_checkpoint(TRUNCATE)` is called after a partial run AND is NOT called after a failed run.
- **DATA-06 (DST/tz fixtures persist with baseline_excluded)**: `dst-fixture.test.ts` Tests 1+2+3 — raw SQL `SELECT baseline_excluded, exclusion_reason FROM cycles WHERE id = ?` confirms the flags persist correctly for spring-forward, fall-back, and tz-trip fixtures.
- **DATA-01 + DATA-04 (DB lifecycle + migrator crash recovery)**: covered by Plan 03-05 + Plan 03-07's in-memory-db helper; integration tests confirm the migrator runs successfully against committed migrations as part of every test's beforeEach.
- **Pitfall E (token leak via WhoopApiError.cause)**: `partial-failure.test.ts` Test 2 — in-memory logger captures all orchestrator output; regex assertions on Bearer / access_token / JWT-shape strings return zero matches.
- **Pitfall H (DST/tz exclusion end-to-end)**: `dst-fixture.test.ts` Tests 1-3 — all three D-15 fixtures persist with correct flags through the full sync pipeline.
- **Pitfall I (retroactive baseline_excluded re-flag)**: `dst-fixture.test.ts` Test 5 — first sync inserts a clean cycle (baseline_excluded=0); second sync's mutated payload shifts the start past a DST boundary; the row's baseline_excluded flips to 1 via ON CONFLICT DO UPDATE.
- **D-32 (wal_checkpoint gated by status)**: `partial-failure.test.ts` Test 1 (pragma fires on partial) + Test 3 (pragma does NOT fire on failed).
- **D-34 (sanitize.ts + register.ts UNMODIFIED)**: `git diff origin/main --stat src/mcp/` returns empty.
- **D-17 (no new MCP tools)**: `src/mcp/tools/` directory unchanged.

## CI Gates

- **Gate A** (banned tone words + emoji): clean
- **Gate B** (console.log/error/warn outside src/cli/**): clean
- **Gate C** (process.stdout.write outside src/cli/commands/): clean
- **Gate D** (server.registerTool outside src/mcp/register.ts): clean
- **Gate E** (oauth/oauth2/token outside token-store.ts): clean
- **Gate F** (fetch( outside src/infrastructure/whoop/{client,token-store,oauth}.ts): clean — orchestrator does NOT introduce any new fetch() call sites
- **Gate G** (drizzle-orm/* outside src/infrastructure/db/): clean — bootstrap.ts imports drizzle through Plan 03-05's canonical connection.ts re-export

## Out-of-Scope Findings

Three pre-existing baseline TypeScript errors remain in the project (unchanged from prior plans):
- `src/cli/commands/auth.ts:97` — `RunOAuthOptions` exactOptionalPropertyTypes incompatibility on `timeoutMs?: number`
- `tests/helpers/msw-whoop-oauth.ts:74` + `:82` — `JsonBodyType` cast incompatibility on `JSON.parse(raw) as unknown`

The SCOPE BOUNDARY rule prevents touching these in this plan. Same precedent as Plans 03-07, 03-08, 03-09, 03-10.

## Self-Check: PASSED

- Created files exist:
  - `src/services/sync/index.ts` ✓
  - `src/services/sync/per-resource.ts` ✓
  - `src/services/bootstrap.ts` ✓
  - `tests/integration/sync/idempotency.test.ts` ✓
  - `tests/integration/sync/partial-failure.test.ts` ✓
  - `tests/integration/sync/dst-fixture.test.ts` ✓
  - `tests/integration/sync/helpers/all-resources-msw.ts` ✓
- Modified file present:
  - `src/services/index.ts` ✓
- Commits exist:
  - `e742e44` (feat 03-11 Task 1) ✓
  - `367b6c2` (test 03-11 Task 2) ✓
- All 7 CI grep gates pass ✓
- Tests: 524 passing (509 baseline + 15 new — per Task 2 budget of 15+) ✓
- Lint: 0 errors ✓
- tsc: only 3 pre-existing baseline errors ✓
- D-17 / D-33 / D-34 attestation preserved: `git diff origin/main --stat src/mcp/` empty ✓
