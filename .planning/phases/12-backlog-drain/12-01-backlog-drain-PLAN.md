---
phase: 12-backlog-drain
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - src/infrastructure/db/migrations/0002_back01_covering_indexes.sql
  - src/infrastructure/db/schema.ts
  - src/infrastructure/db/schema.test.ts
  - src/mcp/index.ts
  - src/cli/commands/sync.ts
  - tests/integration/review/fdr-weekly.test.ts
  - tests/integration/sync/dst-fixture.test.ts
  - tests/integration/setup-stopwatch.test.ts
  - tests/integration/auth-concurrency.test.ts
  - src/services/doctor/checks/concurrent-writers-stress.test.ts
  - src/services/doctor/index.test.ts
  - src/infrastructure/db/repositories/body-measurements.repo.test.ts
  - CHANGELOG.md
  - .planning/REQUIREMENTS.md
  - .planning/ROADMAP.md
  - .planning/STATE.md
autonomous: true
requirements: [TSTC-03, BACK-01]
branch: chore/12-backlog-drain

must_haves:
  truths:
    - "All #95 BACK-01 residual items (B1 indexes, B7 Pino flush) ship in this PR; CHANGELOG enumerates each closed item plus the 5 BACK-01 items already closed in PRs #98/#99/#114/#117/#120 (B2-B6)."
    - "All #95 TSTC-03 testing backlog items (T1 FDR↔weekly integration, T2 DST fixture dynamic ids, T3 stopwatch polarity guard, T4 auth-concurrency I-01 typed, T5 stress-detail regex, T6 doctor/index detail regex, T7 body_measurements concurrent readers, T8 refresh-orchestrator behavioral verified) land in this same PR; full-suite green; suite still finishes under 60 seconds locally."
    - "Phase-close milestone gate: every one of the 26 v1.1 REQ-IDs is flipped from 'Planned' to 'Complete' in .planning/REQUIREMENTS.md v1.1 Traceability table (lines 247-274); milestone v1.1 close note appended to .planning/STATE.md; ROADMAP v1.1 Progress table flipped to Complete with completion dates."
  artifacts:
    - path: "src/infrastructure/db/migrations/0002_back01_covering_indexes.sql"
      provides: "Forward-only migration creating 3 covering indexes (decisions_created_at_status_idx, sync_runs_started_at_idx, sync_runs_status_finished_at_idx) via CREATE INDEX IF NOT EXISTS"
      contains: "CREATE INDEX IF NOT EXISTS"
    - path: "src/infrastructure/db/schema.ts"
      provides: "Drizzle index declarations on decisions + sync_runs tables matching the migration"
      contains: "decisions_created_at_status_idx"
    - path: "tests/integration/review/fdr-weekly.test.ts"
      provides: "Integration test exercising runSync → DB → getWeeklyReview end-to-end with FDR suppression fixture"
      contains: "no_factor_cleared_fdr"
    - path: "CHANGELOG.md"
      provides: "v1.1 entry enumerating every BACK-01 + TSTC-03 closed item plus milestone-complete marker"
      contains: "v1.1"
    - path: ".planning/REQUIREMENTS.md"
      provides: "v1.1 Traceability table with all 26 REQ-IDs marked Complete"
      contains: "Complete: 26 / 26"
    - path: ".planning/STATE.md"
      provides: "Milestone v1.1 close entry dated 2026-06-03"
      contains: "milestone v1.1"
  key_links:
    - from: "src/infrastructure/db/migrations/0002_back01_covering_indexes.sql"
      to: "src/infrastructure/db/schema.ts"
      via: "Drizzle index() declarations must match the SQL migration index names exactly"
      pattern: "decisions_created_at_status_idx|sync_runs_started_at_idx|sync_runs_status_finished_at_idx"
    - from: "src/mcp/index.ts"
      to: "src/infrastructure/config/logger.ts"
      via: "flushLoggerSync() import already present (line 20); add 2 new call sites in SIGINT/SIGTERM handlers"
      pattern: "flushLoggerSync\\(\\)"
    - from: "src/cli/commands/sync.ts"
      to: "src/infrastructure/config/logger.ts"
      via: "flushLoggerSync() called before process.exit in abort listener + at start of sync body"
      pattern: "flushLoggerSync\\(\\)"
    - from: "tests/integration/review/fdr-weekly.test.ts"
      to: "tests/fixtures/review/weekly-pattern-fdr-suppression.json"
      via: "Fixture reuse — service test already uses this fixture; integration test reuses it through MSW → runSync → getWeeklyReview"
      pattern: "weekly-pattern-fdr-suppression"
---

<objective>
Phase 12 omnibus backlog-drain PR — the final v1.1 quality-hardening change. Closes BACK-01 (remaining #95 residual: B1 covering indexes + B7 Pino flush at 3 sites) and TSTC-03 (8 testing-backlog items T1-T8: 1 new integration test, 1 new repo test, 5 test-quality refactors, 1 behavioral verification), then flips all 26 v1.1 REQ-IDs to Complete and appends the v1.1 milestone close to STATE.md + ROADMAP.

Purpose: Ship the v1.1 milestone. After this PR merges, v1.1 (26/26 requirements) is complete and the next development cycle can begin. The work is opportunistic, low-risk, all-or-nothing per ROADMAP §"Phase 12: Backlog Drain".

Output:
- 1 new forward-only migration + 3 new covering indexes wired into schema.ts
- flushLoggerSync() added at 3 signal-handler / sync-start sites
- 1 new integration test (tests/integration/review/fdr-weekly.test.ts) + 1 new repo test (body_measurements concurrent readers)
- 5 test-quality refactors (dynamic fixture ids, polarity guard, typed Zod assertion, anchored regexes)
- 1 behavioral verification of refresh-orchestrator coverage (no code change — re-run + assert ≥14 behavioral matchers documented in research)
- CHANGELOG v1.1 entry + REQUIREMENTS.md 26 REQ-ID flips + STATE.md milestone-close + ROADMAP progress flips
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/PROJECT.md
@.planning/ROADMAP.md
@.planning/STATE.md
@.planning/REQUIREMENTS.md
@.planning/phases/12-backlog-drain/12-RESEARCH.md
@.planning/research-v1.1/PITFALLS.md
@agent_docs/conventions.md
@agent_docs/workflows/contributing.md
@CLAUDE.md

<execution_blocker>
**This plan must not begin execution until Phase 10 (architecture refactor cluster) has merged at least PRs 1-3 to main — sanitize→domain (10-01), singletons + client DI (10-02), doctor-wiring-extract (10-03). T6 (doctor/index detail regex) specifically depends on 10-03's doctor wiring extract per RESEARCH.md Q2-RESOLVED.**

**Phase 11 dependency is opportunistic — execute only after Phase 11 lands so the test additions slot into the regression net cleanly. ROADMAP lists Phase 11 → Phase 12 in the cross-phase dep graph; the actual T1-T7 work does not textually touch any new Phase 11 surface, but suite-budget interaction means Phase 11 should land first.**

If Phase 11 has NOT yet flipped TSTC-01 / TSTC-02 to Complete in REQUIREMENTS.md by the time this PR opens, the milestone-close task (Task 10) MUST flip them on Phase 11's behalf as well, per RESEARCH.md §"v1.1 milestone close gate" edge case.
</execution_blocker>

<interfaces>
<!-- Key contracts the executor needs. Extracted from live tree at HEAD 8376c71. -->

From src/infrastructure/db/schema.ts:262-317 (decisions + sync_runs tables — NO index slot currently):
```typescript
export const sync_runs = sqliteTable('sync_runs', { /* ... */ });
export const decisions = sqliteTable('decisions', { /* ... */ });
```
The Drizzle pattern used elsewhere in the same file (e.g., cycles line 70-99) is:
```typescript
export const cycles = sqliteTable('cycles', { /* cols */ }, (t) => [
  index('cycles_score_state_start_idx').on(t.score_state, t.start),
]);
```
The 2-arg form `sqliteTable(name, cols, (t) => [...])` is what adds Drizzle-tracked indexes.

From src/infrastructure/config/logger.ts (existing — closed by #118):
```typescript
export function flushLoggerSync(): void;
```
Already imported in src/mcp/index.ts:20 and called at src/mcp/index.ts:79. NOT yet imported in src/cli/commands/sync.ts.

From src/mcp/index.ts:110-114 (signal handlers — flush gap):
```typescript
process.once('SIGINT', () => {
  app.close();
  process.exit(0);
});
process.once('SIGTERM', () => {
  app.close();
  process.exit(0);
});
```

From src/cli/commands/sync.ts:259 (abort listener — flush gap; process.exit without flush):
```typescript
// inside abort listener factory body
process.exit(exitCode);
```

From src/services/review/weekly.test.ts:142-159 (T1 reference — service-level fixture test that already exists; T1 adds the integration-level mirror):
- Uses fixture `tests/fixtures/review/weekly-pattern-fdr-suppression.json`
- Asserts `pattern.reason === 'no_factor_cleared_fdr'` (the typed positive-output per ADR-0004)

From tests/integration/sync/dst-fixture.test.ts (T2 surface):
- Test 1 line 162: `loadCycleFlags(mem, 30001)` — hard-coded id
- Test 2 lines 169-179: reads id dynamically from fixture JSON — this is the pattern to copy
- Test 3 lines 208/216/223: hard-codes `2001`, `2002`, `2003`

From tests/integration/setup-stopwatch.test.ts:80,94 (T3 surface):
- `const RUN_STOPWATCH = process.env.VITEST_INCLUDE_STOPWATCH === '1';`
- `describe.skipIf(!RUN_STOPWATCH)`
- T3 adds a 5-line polarity assertion OUTSIDE the skipIf block.

From tests/integration/auth-concurrency.test.ts:402-456 (T4 surface — "I-01" test):
- Uses raw `expect(...).toBe(0/1/true)` against `parseChildStdout()` return.
- T4 adds a Zod `ChildTokenOutput` schema + `.parse(JSON.parse(stdout))` + typed `toMatchObject`.

From src/services/doctor/checks/concurrent-writers-stress.test.ts:57-58 (T5 surface):
- `expect(result.detail).toContain('4 workers × 50 upserts')`
- `expect(result.detail).toContain('(no SQLITE_BUSY)')`
- T5 replaces with a single anchored regex like `/^\d+ workers? × \d+ upserts.*\(no SQLITE_BUSY\)$/`.

From src/services/doctor/index.test.ts (T6 surface — depends on Phase 10 PR #2 / 10-03 doctor-wiring-extract):
- Line 104: `'skipped (running inside MCP transport)'` literal
- Line 127: `'native binding loaded'` literal
- Line 141 (MR-07): already uses `toContain('probe threw')` — the pattern to apply elsewhere.
- T6 extracts regex constants and replaces literal `toBe()` with `toMatch()` for detail fields. Keep `toBe()` for status fields (pass/fail/warn).

From src/services/refresh-orchestrator.test.ts (T8 surface — RESEARCH.md says EFFECTIVELY CLOSED):
- 14+ behavioral assertions already present (`toHaveBeenCalledTimes`, `toHaveBeenNthCalledWith`, `getValidAccessTokenSpy`).
- T8 VERIFIES this is the case: re-run the suite, confirm matchers, document in CHANGELOG. No new code unless re-verification reveals a gap.

From src/infrastructure/db/repositories/body-measurements.repo.test.ts (T7 surface):
- 7 tests cover single-threaded paths (lines 38-105).
- T7 appends Test 8 exercising `await Promise.all([repo.latest(), repo.latest(), repo.listAll(), repo.getRawJson(2)])` with no SQLITE_BUSY assertion.
</interfaces>
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: Add BACK-01 B1 covering indexes (migration + schema)</name>
  <files>src/infrastructure/db/migrations/0002_back01_covering_indexes.sql, src/infrastructure/db/schema.ts, src/infrastructure/db/schema.test.ts</files>
  <read_first>
    - src/infrastructure/db/schema.ts (lines 262-317 for sync_runs + decisions current shape; lines 70-99 for the cycles index() pattern to copy)
    - src/infrastructure/db/migrations/0001_score_state_check_constraints.sql (precedent for CREATE INDEX statements + statement-breakpoint convention)
    - src/infrastructure/db/schema.test.ts (existing test shape — EXPLAIN QUERY PLAN precedent if present)
    - .planning/phases/12-backlog-drain/12-RESEARCH.md §BACK-01 B1 row (line 39) + §Risks R2 + §Risks R5
  </read_first>
  <behavior>
    - Migration creates 3 indexes idempotently (CREATE INDEX IF NOT EXISTS): decisions_created_at_status_idx on decisions(created_at, status); sync_runs_started_at_idx on sync_runs(started_at); sync_runs_status_finished_at_idx on sync_runs(status, finished_at).
    - Drizzle schema.ts declares the same 3 indexes via index().on() in the (t) => [...] slot on each table.
    - Running the migrator from a clean DB produces __drizzle_migrations row count = 3 (was 2).
    - Test in schema.test.ts asserts the 3 index names appear in sqlite_master after migration runs (coarser-but-reliable per RESEARCH.md Risk R5 mitigation). Optional secondary: EXPLAIN QUERY PLAN on the three filter shapes (decisions WHERE status=? ORDER BY created_at; sync_runs ORDER BY started_at DESC LIMIT 1; sync_runs WHERE status=? ORDER BY finished_at DESC) shows SEARCH … USING INDEX with the expected index name — seed ≥100 rows first so the planner picks the index.
  </behavior>
  <action>
    Create migration file src/infrastructure/db/migrations/0002_back01_covering_indexes.sql with three `CREATE INDEX IF NOT EXISTS` statements separated by `--> statement-breakpoint` (matching the 0000/0001 convention). Index names per orchestrator D-Q3 decision: `decisions_created_at_status_idx`, `sync_runs_started_at_idx`, `sync_runs_status_finished_at_idx`. Justification per RESEARCH.md §B1: decisions covering index supports `decisionsRepo.findByPrefix` + `listOpen` + weekly DEC-04 `countSince`; sync_runs covering indexes support `latestFinished()`, `reclassifyStaleRunning()`, and the doctor stale-running probe.

    In src/infrastructure/db/schema.ts, convert the `sync_runs` and `decisions` table definitions from the 2-arg form `sqliteTable(name, cols)` to the 3-arg form `sqliteTable(name, cols, (t) => [index('...').on(t.col1, t.col2), ...])` — copy the syntax pattern from the cycles table (line 70-99). Add the matching 3 index declarations. Do NOT change column types or any other table shape; the only schema diff is the index slot.

    Add a test case to src/infrastructure/db/schema.test.ts (or create the file if absent — RESEARCH.md says "existing schema.test.ts patterns" so confirm it exists first) that opens a fresh in-memory DB, runs the migrator, and asserts `SELECT name FROM sqlite_master WHERE type='index' AND name IN ('decisions_created_at_status_idx', 'sync_runs_started_at_idx', 'sync_runs_status_finished_at_idx')` returns all 3 rows. If schema.test.ts does not exist, create it with this single test.

    Verify no other test pins `__drizzle_migrations` count or `journal.entries.length === 2` — RESEARCH.md Risk R2 flagged this. Run `rg "journal\\.entries\\.length|__drizzle_migrations.*count|migrations\\.length" src tests` first; update any pinned counts from 2 → 3.
  </action>
  <verify>
    <automated>npx vitest run src/infrastructure/db/schema.test.ts</automated>
  </verify>
  <done>
    - Migration file 0002_back01_covering_indexes.sql exists with 3 CREATE INDEX IF NOT EXISTS statements + statement-breakpoint separators.
    - schema.ts has all 3 indexes declared via Drizzle `index('...').on(...)` on the sync_runs and decisions tables.
    - schema.test.ts asserts the 3 index names appear in sqlite_master after migration runs.
    - `rg "CREATE INDEX IF NOT EXISTS.*(decisions_created_at_status_idx|sync_runs_started_at_idx|sync_runs_status_finished_at_idx)" src/infrastructure/db/migrations/0002_back01_covering_indexes.sql` returns 3 matches.
    - No pre-existing test fails because of an outdated migration count.
  </done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: Add BACK-01 B7 flushLoggerSync() at 3 sites</name>
  <files>src/mcp/index.ts, src/cli/commands/sync.ts</files>
  <read_first>
    - src/mcp/index.ts (lines 1-130; specifically the existing import at line 20 + the SIGINT/SIGTERM handlers at lines 110-114)
    - src/cli/commands/sync.ts (lines 1-280; the abort listener factory around line 225-275 and the sync-start command body — currently no flushLoggerSync import)
    - src/infrastructure/config/logger.ts (the flushLoggerSync export — confirm it's synchronous and stderr-only per ADR-0001)
    - .planning/phases/12-backlog-drain/12-RESEARCH.md §BACK-01 B7 row (line 45) + §Risks R3 + §Assumptions A3 + A5
  </read_first>
  <behavior>
    - On SIGINT/SIGTERM in the MCP server, flushLoggerSync() is called BEFORE app.close() and process.exit(0).
    - On SIGINT/SIGTERM during a sync, flushLoggerSync() is called immediately BEFORE process.exit(exitCode) in the abort listener.
    - At the start of the sync command body, flushLoggerSync() is called once so an early crash mid-sync flushes already-buffered records.
    - Order at every new site: flush → close → exit. Per RESEARCH.md A3: flushLoggerSync wraps logger.flush() in try/catch and does not need await (Pino flush is sync against a non-async destination).
    - No stdout output is produced by any flush call (ADR-0001 stdout-purity). flushLoggerSync writes to stderr only.
    - Existing unit tests for mcp/index.ts (mcp-stdout-purity / mcp-runtime if present) still pass — stdout-purity is not regressed.
  </behavior>
  <action>
    In src/mcp/index.ts: the existing `flushLoggerSync` import at line 20 is already in place. Modify the SIGINT handler at line 110 and the SIGTERM handler at line 114 so each becomes `() => { flushLoggerSync(); app.close(); process.exit(0); }`. The flush precedes close and exit per RESEARCH.md Risk R3 mitigation.

    In src/cli/commands/sync.ts: add an import `import { flushLoggerSync } from '../../infrastructure/config/logger.js';` (verify the relative path against the existing imports — the file already imports logger, so this is one additional named import or a single new line). Two edits:
    (a) At the top of the sync command's execute body (just inside the action callback, before the boot bootstrap call at line ~177), add a single `flushLoggerSync();` call. Comment: `// BACK-01/B7 (#95): flush buffered records at sync start so an early crash mid-sync loses fewer log lines.`
    (b) In the abort listener factory body (around line 259, immediately before `process.exit(exitCode);`), add `flushLoggerSync();`. Comment: `// BACK-01/B7 (#95): flush → close-already-ran → exit per RESEARCH.md Risk R3.`

    Do NOT add a new behavioral test file (per orchestrator decision — verification is via the existing suite running green). Existing mcp-stdout-purity and mcp-runtime integration tests should still pass; if they break, investigate immediately (ADR-0001 boundary).

    Cross-check: `rg "flushLoggerSync\\(\\)" src/mcp src/cli` should return ≥5 call sites after this change (1 existing in mcp/index.ts:79, 2 new in mcp/index.ts:~110-114, 2 new in cli/commands/sync.ts: one at start, one in abort listener).
  </action>
  <verify>
    <automated>npx vitest run tests/integration/mcp-stdout-purity.test.ts tests/integration/mcp-runtime.test.ts src/cli/commands/sync.test.ts</automated>
  </verify>
  <done>
    - src/mcp/index.ts SIGINT + SIGTERM handlers call flushLoggerSync() before app.close() + process.exit(0).
    - src/cli/commands/sync.ts imports flushLoggerSync and calls it at sync start + in abort listener before process.exit.
    - `rg "flushLoggerSync\\(\\)" src/mcp src/cli` returns at least 5 matches.
    - mcp-stdout-purity test still passes — no stdout pollution introduced.
    - No new test file created (verification is via existing suite per orchestrator instruction).
  </done>
</task>

<task type="auto" tdd="true">
  <name>Task 3: Add TSTC-03 T1 FDR↔weekly integration test</name>
  <files>tests/integration/review/fdr-weekly.test.ts</files>
  <read_first>
    - src/services/review/weekly.test.ts lines 142-159 (the service-level test that already exercises the fixture — use as the assertion template)
    - tests/integration/sync/dst-fixture.test.ts (the closest existing integration-test SHAPE: MSW + runSync + DB seeding + assertion — copy structure)
    - tests/fixtures/review/weekly-pattern-fdr-suppression.json (the fixture this test reuses)
    - tests/integration/sync/helpers/ (any shared test setup — in-memory DB, MSW bootstrap)
    - .planning/phases/12-backlog-drain/12-RESEARCH.md §TSTC-03 T1 row (line 55) + §Open Question 1
    - ADR-0006 (fixture-only tests — all data routes through MSW)
  </read_first>
  <behavior>
    - The new test creates a fresh in-memory DB, seeds it (via runSync against MSW with the FDR-suppression fixture, or directly seeding rows matching the fixture state — match dst-fixture.test.ts pattern), then calls `getWeeklyReview()` and asserts `result.pattern.reason === 'no_factor_cleared_fdr'`.
    - The test compiles only because the fixture is already on disk (verified in research).
    - The test runs in under ~500ms and is parallelizable with the rest of the integration suite.
    - Routes through MSW (no live WHOOP calls) per ADR-0006 — the test imports the standard MSW WHOOP helper, not raw fetch.
  </behavior>
  <action>
    Create the directory tests/integration/review/ (does not exist per pre-check) and the file tests/integration/review/fdr-weekly.test.ts.

    Pattern: copy the test structure from tests/integration/sync/dst-fixture.test.ts (which RESEARCH.md identifies as the closest integration-test shape). Adapt:
    1. Open in-memory DB via the helper at tests/integration/sync/helpers/ (precedent — same pattern).
    2. Either (a) run `runSync()` against MSW handlers seeded with WHOOP fixtures that translate to the FDR-suppression scenario, or (b) directly seed cycles/recoveries/sleeps/workouts rows that match the `weekly-pattern-fdr-suppression.json` fixture state — whichever approach minimizes runtime per RESEARCH.md Risk R1. Approach (b) is acceptable per ADR-0006 because it does not call the network and exercises the same DB → review path.
    3. Call `getWeeklyReview(deps)` — wire deps from the in-memory DB + a stubbed clock per the service-test precedent.
    4. Assert `result.pattern.reason === 'no_factor_cleared_fdr'` (the typed positive output per ADR-0004) — same matcher the service-level test uses.

    The test name should follow precedent: `describe('TSTC-03/T1 (#95): FDR↔weekly-review integration', () => { it('returns no_factor_cleared_fdr when no candidate clears BH q=0.10', async () => { ... }); });`

    Per RESEARCH.md Open Question 1 resolution (NO — existing weekly.test.ts FDR coverage is service-layer, not integration-level): this test is the integration-level mirror.

    Add a comment at the top of the file: `// TSTC-03/T1 (#95): integration mirror of the service-level FDR test in src/services/review/weekly.test.ts:142. The service test exercises getWeeklyReview() against in-memory DB seeded inline; this integration test exercises the same fixture through the full sync→DB→review path so FDR suppression is verified to survive the sync layer (closing the gap RESEARCH.md flagged in Open Question 1).`
  </action>
  <verify>
    <automated>npx vitest run tests/integration/review/fdr-weekly.test.ts</automated>
  </verify>
  <done>
    - tests/integration/review/fdr-weekly.test.ts exists with at least 1 test asserting `pattern.reason === 'no_factor_cleared_fdr'`.
    - Test routes through MSW or in-memory seeding; no live fetch call (ADR-0006).
    - Test runs in under 1 second.
    - `npm test` (full suite) still green and under 60 seconds locally.
  </done>
</task>

<task type="auto" tdd="true">
  <name>Task 4: Refactor TSTC-03 T2 DST fixture dynamic ids</name>
  <files>tests/integration/sync/dst-fixture.test.ts</files>
  <read_first>
    - tests/integration/sync/dst-fixture.test.ts (full file — specifically Test 1 at line 162, Test 2 at lines 169-179, Test 3 at lines 208/216/223)
    - tests/integration/sync/helpers/ (any existing fixture-loader pattern)
    - .planning/phases/12-backlog-drain/12-RESEARCH.md §TSTC-03 T2 row (line 56)
  </read_first>
  <behavior>
    - All cycle id references in Tests 1 + 3 are read dynamically from the fixture JSON (matching the pattern Test 2 already uses at lines 169-179).
    - No literal `30001`, `2001`, `2002`, `2003` numeric constants appear in the test bodies.
    - All three tests still assert the same behavior (DST-flagged cycles excluded from baseline) — only the id source changes.
    - Test runtime is not regressed (pure refactor).
  </behavior>
  <action>
    Refactor Test 1 (line 162) and Test 3 (lines 208/216/223) in tests/integration/sync/dst-fixture.test.ts to follow the Test 2 pattern (lines 169-179) of dynamically reading cycle ids from the loaded fixture JSON rather than hard-coding them.

    Recommended approach: extract a small inline helper `function fixtureCycleIds(scenario): number[]` at the top of the file (if not already extracted) that returns the `cycles[].id` array from the fixture JSON for a named scenario. Tests 1 + 3 then call `const [firstId] = fixtureCycleIds('dst-spring-forward');` or similar — replacing the literal `30001` with `firstId` and the `2001`, `2002`, `2003` triple with `fixtureCycleIds('multi-tz-trip').slice(0, 3)` (or however the fixture is named — read the fixture filenames at the top of the test to confirm).

    If a helpers/ subdir already exposes such a function, reuse it instead of inlining. Per RESEARCH.md: "Extract a `loadFixtureIds(scenarioName: string): number[]` helper (probably in `tests/integration/sync/helpers/`)" — verify helpers/ contents and choose accordingly.

    Pure test refactor — no production code change.
  </action>
  <verify>
    <automated>npx vitest run tests/integration/sync/dst-fixture.test.ts</automated>
  </verify>
  <done>
    - `grep -E '\\b30001\\b|\\b2001\\b|\\b2002\\b|\\b2003\\b' tests/integration/sync/dst-fixture.test.ts | grep -v '^[[:space:]]*//'` returns zero matches in test bodies (comments allowed).
    - All 3 DST-fixture tests pass.
    - Behavior assertions unchanged from before the refactor.
  </done>
</task>

<task type="auto" tdd="true">
  <name>Task 5: Add TSTC-03 T3 stopwatch env-gate polarity guard</name>
  <files>tests/integration/setup-stopwatch.test.ts</files>
  <read_first>
    - tests/integration/setup-stopwatch.test.ts (the full file; lines 80 + 94 specifically for the RUN_STOPWATCH constant + skipIf wiring)
    - .planning/phases/12-backlog-drain/12-RESEARCH.md §TSTC-03 T3 row (line 57)
    - .github/workflows/setup-stopwatch.yml (line 74 sets VITEST_INCLUDE_STOPWATCH='1' — confirm)
  </read_first>
  <behavior>
    - A polarity-guard test block exists OUTSIDE the `describe.skipIf(!RUN_STOPWATCH)` block.
    - The guard asserts RUN_STOPWATCH equals `process.env.VITEST_INCLUDE_STOPWATCH === '1'` — i.e., the same expression used at line 80. This pins the polarity contract.
    - The guard runs in 0ms under default `npm test`. If someone flips `=== '1'` to `!== '1'` in a future refactor, this assertion fails.
  </behavior>
  <action>
    Add a top-level describe block to tests/integration/setup-stopwatch.test.ts OUTSIDE the `describe.skipIf(!RUN_STOPWATCH)` block (e.g., immediately above or below it). The block should contain a single test:

    ```
    describe('TSTC-03/T3 (#95): env-gate polarity', () => {
      it('RUN_STOPWATCH strictly matches VITEST_INCLUDE_STOPWATCH === "1"', () => {
        expect(RUN_STOPWATCH).toBe(process.env.VITEST_INCLUDE_STOPWATCH === '1');
      });
    });
    ```

    The action element does NOT contain code fences (this is illustrative; the executor will write the equivalent in TypeScript). The exact identifier RUN_STOPWATCH is the one already declared at line 80; reuse it via module-scope hoisting (it's a `const` at file top, already visible to the new describe block).

    Per RESEARCH.md: this test acts as the polarity sentinel — any future polarity flip fails the assertion on the next run.
  </action>
  <verify>
    <automated>npx vitest run tests/integration/setup-stopwatch.test.ts</automated>
  </verify>
  <done>
    - tests/integration/setup-stopwatch.test.ts contains a polarity-guard describe block outside the skipIf gate.
    - The polarity assertion uses `process.env.VITEST_INCLUDE_STOPWATCH === '1'` as the reference and `expect(RUN_STOPWATCH).toBe(...)` for the comparison.
    - The guard test runs under default `npm test` (NOT skipped) and passes in 0ms.
  </done>
</task>

<task type="auto" tdd="true">
  <name>Task 6: Refactor TSTC-03 T4 auth-concurrency I-01 typed assertion</name>
  <files>tests/integration/auth-concurrency.test.ts</files>
  <read_first>
    - tests/integration/auth-concurrency.test.ts (lines 402-456 for the I-01 test; also the parseChildStdout helper definition wherever it lives)
    - .planning/phases/12-backlog-drain/12-RESEARCH.md §TSTC-03 T4 row (line 58)
    - agent_docs/conventions.md §Code style for Zod validation patterns
  </read_first>
  <behavior>
    - A Zod schema `ChildTokenOutput` (or similarly named) is defined either inline in the test file or in a tests/integration/helpers/ shared module.
    - The schema describes the parsed-stdout shape: `{ ok: boolean, accessToken?: string, refreshToken?: string, storageMode?: 'file' | 'keychain', err?: string }` — match the actual `parseChildStdout()` return shape.
    - The I-01 test (line 402) replaces inline `JSON.parse(stdout)` + raw `.toBe(...)` assertions with `ChildTokenOutput.parse(JSON.parse(stdout))` + typed `toMatchObject({...})` calls.
    - Test still passes — the schema must accommodate ALL existing successful runs, not narrow the contract.
  </behavior>
  <action>
    Define a Zod schema `ChildTokenOutput` for the child-process stdout shape. Locate it either:
    (a) Inline at the top of tests/integration/auth-concurrency.test.ts (acceptable for a single-test-file usage).
    (b) In a new helper file tests/integration/helpers/child-token-output.ts (cleaner if the schema is reused elsewhere — check first by grepping for parseChildStdout usages: `rg "parseChildStdout" tests`).

    Schema shape — derive from the actual parseChildStdout return type by reading its implementation. Roughly: `z.object({ ok: z.boolean(), accessToken: z.string().optional(), refreshToken: z.string().optional(), storageMode: z.enum(['file', 'keychain']).optional(), err: z.string().optional() })`. Confirm by reading the parseChildStdout body.

    In the I-01 test body (lines 402-456): replace the inline JSON.parse-and-loose-assertion sequence with a call to `ChildTokenOutput.parse(JSON.parse(stdout))` (this fails loudly on shape drift). Then assert the I-01-specific values with `expect(token).toMatchObject({ ok: true, storageMode: 'file' })` plus the existing `expect(token.accessToken).not.toBeNull()` etc. The exact field set follows the existing assertions (lines 444+); just narrow them through the schema.

    Pure test-quality refactor — no production code change.
  </action>
  <verify>
    <automated>npx vitest run tests/integration/auth-concurrency.test.ts</automated>
  </verify>
  <done>
    - ChildTokenOutput Zod schema is defined and used at the I-01 assertion point.
    - The I-01 test invokes `.parse()` on the parsed stdout, narrowing the type before any property-level assertion.
    - All existing I-01 assertions still pass.
  </done>
</task>

<task type="auto" tdd="true">
  <name>Task 7: Refactor TSTC-03 T5 concurrent_writers_stress detail regex</name>
  <files>src/services/doctor/checks/concurrent-writers-stress.test.ts</files>
  <read_first>
    - src/services/doctor/checks/concurrent-writers-stress.test.ts (lines 57-58 specifically + surrounding test body for context)
    - .planning/phases/12-backlog-drain/12-RESEARCH.md §TSTC-03 T5 row (line 59)
  </read_first>
  <behavior>
    - The two `expect(result.detail).toContain(...)` calls at lines 57-58 are replaced with a single `expect(result.detail).toMatch(STRESS_DETAIL_RE)` where STRESS_DETAIL_RE is an anchored regex.
    - The regex tolerates worker-count tuning and verbiage shifts while pinning the load-bearing parts (digit-then-workers, digit-then-upserts, "(no SQLITE_BUSY)").
    - Test still passes against the current probe output.
  </behavior>
  <action>
    In src/services/doctor/checks/concurrent-writers-stress.test.ts, replace lines 57-58 (the two `toContain` literal matchers) with a single anchored regex match.

    Define the constant at the top of the test file (or inline at usage if used only once): `const STRESS_DETAIL_RE = /^\d+ workers?\s*[×x*]\s*\d+ upserts.*\(no SQLITE_BUSY\)\.?$/;`. The character class `[×x*]` tolerates Unicode multiplication sign drift; `workers?` tolerates singular/plural; `\.?$` tolerates a trailing period.

    Replace: `expect(result.detail).toMatch(STRESS_DETAIL_RE);` — single assertion.

    Verify the regex matches the actual current probe output by running the test first and confirming the existing detail string conforms. If the actual output uses `x` rather than `×`, document that — the regex covers both. If the output has a different structure entirely, adjust to match RESEARCH.md's suggested shape `'4 workers × 50 upserts (no SQLITE_BUSY)'`.

    Pure test-quality refactor.
  </action>
  <verify>
    <automated>npx vitest run src/services/doctor/checks/concurrent-writers-stress.test.ts</automated>
  </verify>
  <done>
    - Lines 57-58 collapsed to a single `expect(result.detail).toMatch(STRESS_DETAIL_RE)`.
    - STRESS_DETAIL_RE defined as a const at file top or alongside the assertion.
    - Test still passes.
  </done>
</task>

<task type="auto" tdd="true">
  <name>Task 8: Refactor TSTC-03 T7 body_measurements concurrent-readers test</name>
  <files>src/infrastructure/db/repositories/body-measurements.repo.test.ts</files>
  <read_first>
    - src/infrastructure/db/repositories/body-measurements.repo.test.ts (full file — Tests 1-7 at lines 38-105; the in-memory DB setup at the top of the file)
    - src/infrastructure/db/repositories/body-measurements.repo.ts (the repo public surface — latest(), listAll(), getRawJson(), upsert() methods)
    - .planning/phases/12-backlog-drain/12-RESEARCH.md §TSTC-03 T7 row (line 61) + §Risks R1 (suite budget)
  </read_first>
  <behavior>
    - A new Test 8 is appended to body-measurements.repo.test.ts that exercises concurrent readers against a single in-memory DB.
    - The test seeds ≥3 measurements with distinct captured_at timestamps via upsert, then runs `await Promise.all([repo.latest(), repo.latest(), repo.listAll(), repo.getRawJson(/* some id */)])` and asserts all 4 promises resolve to consistent values with no SQLITE_BUSY error.
    - Test runtime is ≤50ms (per RESEARCH.md estimate).
    - The test pins the SQLite WAL-mode "concurrent reads with one writer" contract for body_measurements specifically.
  </behavior>
  <action>
    Append a new Test 8 to src/infrastructure/db/repositories/body-measurements.repo.test.ts following the existing test pattern (Tests 1-7).

    Test shape:
    1. Use the same in-memory DB setup as Tests 1-7 (BeforeEach or fresh DB inside the test).
    2. Seed 3 body_measurements rows via `await repo.upsert({...})` × 3 with distinct captured_at timestamps and varying height/weight pairs.
    3. Run `const [latest1, latest2, all, raw] = await Promise.all([repo.latest(), repo.latest(), repo.listAll(), repo.getRawJson(/* id-of-one-row */)]);` — kick off four reads concurrently.
    4. Assert: latest1 deep-equals latest2 (consistent snapshot); all.length === 3; raw is a non-null object.
    5. Assert no thrown error / no SQLITE_BUSY — Promise.all should resolve, not reject. Wrap in `expect(promise).resolves.toBeDefined()` if helpful.

    Describe block naming: `describe('TSTC-03/T7 (#95): concurrent readers safety', () => { it('handles 4 simultaneous reads without SQLITE_BUSY', ...) });`

    Per RESEARCH.md Risk R1: suite-budget cost is ~50ms; safe.

    Verify the exact method signatures (latest/listAll/getRawJson) on the repo by reading body-measurements.repo.ts first; if any method does not exist by that exact name, use the actual exported methods.
  </action>
  <verify>
    <automated>npx vitest run src/infrastructure/db/repositories/body-measurements.repo.test.ts</automated>
  </verify>
  <done>
    - body-measurements.repo.test.ts has a Test 8 exercising concurrent reads via Promise.all.
    - All 4 (or however-many) reads resolve to consistent values with no SQLITE_BUSY.
    - Test runtime under ~100ms.
    - Total file test count = 8 (was 7).
  </done>
</task>

<task type="auto">
  <name>Task 9: T6 doctor/index regex + T8 refresh-orchestrator behavioral verification</name>
  <files>src/services/doctor/index.test.ts, src/services/refresh-orchestrator.test.ts</files>
  <read_first>
    - src/services/doctor/index.test.ts (full file; specifically lines 104, 127, 141 per RESEARCH.md; identify ALL detail-string assertions across the file)
    - src/services/refresh-orchestrator.test.ts (full file — confirm the 14+ behavioral matchers RESEARCH.md says are already present)
    - .planning/phases/12-backlog-drain/12-RESEARCH.md §TSTC-03 T6 row (line 60) + §T8 row (line 62) + §Risks R4
    - **VERIFY: Phase 10 PR #2 (10-03 doctor-wiring-extract) has merged to main.** If NOT merged, this task is BLOCKED and must be deferred to a follow-up sub-PR per RESEARCH.md Q2-RESOLVED + Risks R4.
  </read_first>
  <behavior>
    - **T6 (doctor/index detail regex):** Every detail-string assertion in doctor/index.test.ts that crosses a "this might be reworded" boundary uses `toMatch(regex)` instead of `toBe(literal)`. Status-field assertions (pass/fail/warn) remain `toBe()` — those ARE a fixed contract.
    - **T6 regex constants:** extracted to a shared module (src/services/doctor/checks/_detail-matchers.ts) so they can be reused across check tests if desired.
    - **T8 verification:** re-run src/services/refresh-orchestrator.test.ts; confirm the test file contains ≥14 behavioral matchers (toHaveBeenCalledTimes / toHaveBeenNthCalledWith / spy assertions). No code change — this is a verification task. If a gap is found (unlikely per RESEARCH.md), add a single behavioral test asserting the AuthError kind sequence on the 401-reactive-retry path per RESEARCH.md §T8 row recommendation.
    - Full suite still green and under 60 seconds.
  </behavior>
  <action>
    **T6 — doctor/index detail regexes:**
    1. Read src/services/doctor/index.test.ts in full. Identify every detail-string assertion: line 104 `'skipped (running inside MCP transport)'`, line 127 `'native binding loaded'`, plus any other `toBe(literal-string-detail)` patterns visible.
    2. Create src/services/doctor/checks/_detail-matchers.ts (the path RESEARCH.md flagged as a Wave-0 gap — but the orchestrator's frontmatter does NOT list this file. INSTEAD: define the regex constants inline at the top of doctor/index.test.ts to keep file count tight per orchestrator scope. If reuse across other check tests becomes desirable later, extract in a follow-up.)
    3. For each detail-string assertion, define a regex constant: e.g., `const SKIP_MCP_RE = /^skipped\s*\(.*MCP transport.*\)$/i;` `const NATIVE_BIND_RE = /^native binding loaded$/i;`. Tighten or loosen the regex to match the EXACT current production output — read the probe implementations if needed.
    4. Replace each `expect(result.detail).toBe(literal)` with `expect(result.detail).toMatch(regex)`. Keep `expect(result.status).toBe('pass'|'fail'|'warn')` untouched — status is contract.
    5. Run the test file to confirm all assertions still pass against current probe output.

    **T8 — refresh-orchestrator behavioral verification:**
    1. Re-read src/services/refresh-orchestrator.test.ts. Confirm by grep: `rg "toHaveBeenCalledTimes|toHaveBeenNthCalledWith|getValidAccessTokenSpy" src/services/refresh-orchestrator.test.ts | wc -l` should return ≥14.
    2. If ≥14, document in the closing CHANGELOG entry that T8 is verified-closed via existing coverage. No new test added.
    3. If <14 (unlikely), add a single behavioral test asserting the (AuthError kind, retry count, op call count) tuple on the 401-reactive-retry → refresh-failure → auth-expired wrapper path per RESEARCH.md §T8 recommendation.

    **GATE per RESEARCH.md Q2:** This task is sequenced LAST in the plan because T6 depends on Phase 10 PR #2 (10-03 doctor-wiring-extract). Before starting this task, verify on the live tree that `src/services/doctor/wiring.ts` exists OR that bootstrap.ts:320-392 still hosts the doctor wiring (the latter means Phase 10 has NOT yet shipped 10-03; in that case, DEFER T6 to a Phase 12 follow-up sub-PR and complete only T8 verification in this task — adjust the CHANGELOG entry accordingly).
  </action>
  <verify>
    <automated>npx vitest run src/services/doctor/index.test.ts src/services/refresh-orchestrator.test.ts</automated>
  </verify>
  <done>
    - doctor/index.test.ts uses `toMatch(regex)` for every detail-string assertion that is not a fixed status contract.
    - At least 4 detail-string assertions converted from `toBe(literal)` to `toMatch(regex)`.
    - refresh-orchestrator.test.ts behavioral coverage verified: `rg "toHaveBeenCalledTimes|toHaveBeenNthCalledWith" src/services/refresh-orchestrator.test.ts | wc -l` ≥ 14.
    - Both test files pass.
    - If Phase 10 PR #2 has NOT merged, T6 portion is deferred and documented in CHANGELOG; T8 verification still complete.
  </done>
</task>

<task type="auto">
  <name>Task 10: v1.1 milestone close — CHANGELOG + REQUIREMENTS + STATE + ROADMAP</name>
  <files>CHANGELOG.md, .planning/REQUIREMENTS.md, .planning/STATE.md, .planning/ROADMAP.md</files>
  <read_first>
    - CHANGELOG.md (full file — confirm format for v1.0 close + understand how prior phases formatted their entries)
    - .planning/REQUIREMENTS.md lines 247-284 (v1.1 Traceability table + Coverage summary)
    - .planning/ROADMAP.md lines 289-306 (v1.1 Progress table + Coverage summary)
    - .planning/STATE.md (the v1.0 milestone close entry near top — copy its shape for v1.1)
    - .planning/phases/12-backlog-drain/12-RESEARCH.md §"v1.1 milestone close gate" (lines 140-154) — this is the authoritative checklist
    - **VERIFY: Tasks 1-9 above all completed and `npm test` green.** This task lands LAST in the PR; if any prior task is broken, do not begin this one.
  </read_first>
  <behavior>
    - CHANGELOG.md has a new v1.1 section enumerating each BACK-01 item closed (B2-B6 closed earlier in PRs #98/#99/#114/#117/#120 — credit each; B1 + B7 closed in this PR) + each TSTC-03 item closed (T1-T8) + the milestone-complete marker.
    - .planning/REQUIREMENTS.md v1.1 Traceability table (lines 247-274) has every one of the 26 REQ-IDs flipped from "Planned" to "Complete (Plan {plan-id}, 2026-06-03 — Verified by {test file})". The format mirrors the v1.0 traceability entries at lines 182-231.
    - .planning/REQUIREMENTS.md v1.1 Coverage (lines 277-281) flipped from "Complete: 0 / 26" to "Complete: 26 / 26"; "v1.1 complete: 2026-06-03" line appended.
    - .planning/STATE.md has a v1.1 milestone-close entry following the v1.0 close pattern, dated 2026-06-03.
    - .planning/ROADMAP.md v1.1 Progress table (lines 290-300) flipped from "Not started" to "Complete" with 2026-06-03 (or each phase's actual completion date) in the Completed column.
    - .planning/ROADMAP.md v1.1 Coverage (lines 301-306) flipped from "Complete: 0 / 26" to "Complete: 26 / 26".
  </behavior>
  <action>
    **Order of operations matters. Do these LAST in the PR so an earlier-task failure does not prematurely land the milestone-close.**

    1. **CHANGELOG.md** — Add a v1.1 section at the top (above v1.0). Format follows the v1.0 entry pattern. Enumerate by REQ-ID with one line each, e.g.:
       - `### v1.1 — Quality hardening — 2026-06-03`
       - `- BACK-01 (#95): decisions + sync_runs covering indexes (migration 0002).`
       - `- BACK-01 (#95): Pino flushLoggerSync on SIGINT/SIGTERM (MCP + CLI) + sync-start (this PR).`
       - `- BACK-01 (#95) — closed earlier: findByPrefix min-length guard (#98); body_measurements REAL tolerance (#117); cycles.cursor() comment (#120); token-store mkdir 0o700 (#99); OAuth callback .unref() (#114).`
       - One line each for TSTC-03 T1-T8.
       - One line each for the 24 other v1.1 REQ-IDs closed across Phases 6-11.
       - Closing line: `**Milestone v1.1 complete: 26 / 26 requirements.**`

    2. **.planning/REQUIREMENTS.md v1.1 Traceability (lines 247-274)** — for each row, change `Planned (Plan {id})` (or just `Planned`) to `Complete (Plan {id}, 2026-06-03 — Verified by {test file})`. The 26 REQ-IDs: SECH-01, SECH-02, INPV-01, DBIN-01, DBIN-02, DBIN-03, DBIN-04, DBIN-05, ERRC-02, LIFE-01, LIFE-02, LIFE-03, LIFE-04, ERRC-01, ARCH-01, ARCH-02, ARCH-03, ARCH-04, ARCH-05, ARCH-06, ARCH-07, ARCH-08, TSTC-01, TSTC-02, TSTC-03, BACK-01. For each, the test file should be derivable from the phase's plans (cross-reference each phase's SUMMARY.md if necessary). If TSTC-01 / TSTC-02 are still "Planned" in REQUIREMENTS.md (Phase 11 has not flipped them yet), this PR flips them too per RESEARCH.md §"v1.1 milestone close gate" edge case.

    3. **.planning/REQUIREMENTS.md v1.1 Coverage (lines 277-281)** — change `Complete: 0 / 26` to `Complete: 26 / 26`. Append `> *v1.1 complete: 2026-06-03 — 26 / 26 v1.1 requirements done across Phases 6+7+8+9+10+11+12.*` after the existing "v1.1 defined" line.

    4. **.planning/STATE.md** — append a v1.1 milestone-close entry following the v1.0 close pattern. The v1.0 close lives near the top of STATE.md (the file is long; use `grep -n "v1.0 complete\\|milestone v1.0" .planning/STATE.md` to find the precedent). The new entry should include: date 2026-06-03, "milestone v1.1 complete", 26/26 requirements, list of Phases 6-12 with their completion dates, and a one-line summary of the v1.1 theme ("quality hardening from post-v1.0 /ce-code-review pass — zero new user-facing features").

    5. **.planning/ROADMAP.md v1.1 Progress (lines 290-300)** — flip every "Not started" cell to "Complete" with the actual completion date of each phase (read from each phase's SUMMARY.md or the most recent STATE.md entry per phase). Plans Complete column shows "{N}/{N}" for each phase.

    6. **.planning/ROADMAP.md v1.1 Coverage (lines 301-306)** — change `Complete: 0 / 26 (Phase 6-12 not yet started)` to `Complete: 26 / 26 (Phases 6+7+8+9+10+11+12 closed — milestone v1.1 complete)`. Append a `> *Last updated: 2026-06-03 — Phase 12 closed; milestone v1.1 complete (26/26 v1.1 requirements done).*` line at the end of the v1.1 roadmap block.

    **Final sanity check before commit:**
    - `rg "Planned" .planning/REQUIREMENTS.md` should return zero matches in the v1.1 Traceability table (lines 247-274). If any remain, complete the flip.
    - `rg "Not started" .planning/ROADMAP.md` should return zero matches in the v1.1 Progress block.
    - `git diff --stat` should show roughly: CHANGELOG.md (+30 lines), REQUIREMENTS.md (+30/-26), STATE.md (+15-20), ROADMAP.md (+10/-10).
  </action>
  <verify>
    <automated>bash -c 'set -e; grep -c "Complete" .planning/REQUIREMENTS.md | grep -E "^[3-9]?[0-9]+$" >/dev/null && echo "REQ flips look right"; ! grep -q "^| .* | Phase [6-9]\\|Phase 1[0-2] | .* | Planned" .planning/REQUIREMENTS.md && echo "no v1.1 Planned rows remain"; grep -q "milestone v1.1" .planning/STATE.md && echo "STATE.md has v1.1 close"; grep -q "v1.1.*Quality hardening\\|v1.1 — Quality" CHANGELOG.md && echo "CHANGELOG has v1.1 section"'</automated>
  </verify>
  <done>
    - CHANGELOG.md v1.1 section exists with all closed items enumerated + milestone-complete marker.
    - REQUIREMENTS.md v1.1 Traceability: all 26 REQ-IDs show "Complete" (no "Planned" remaining in the v1.1 section).
    - REQUIREMENTS.md v1.1 Coverage: "26 / 26" present.
    - STATE.md: v1.1 milestone-close entry appended.
    - ROADMAP.md v1.1 Progress: all phases show "Complete"; v1.1 Coverage shows "26 / 26".
    - `npm test` still green; full suite under 60 seconds.
  </done>
</task>

</tasks>

<verification>
**Phase-level verification:**

1. **Full suite green:** `npm test` passes; suite finishes under 60 seconds locally (per ROADMAP SC2 + RESEARCH.md Risk R1).
2. **Migration count consistency:** `__drizzle_migrations` row count after migrator runs = 3 (was 2). Any test that pinned count = 2 has been updated.
3. **Stdout-purity preserved:** MCP stdout-purity test (`tests/integration/mcp-stdout-purity.test.ts`) still passes — flushLoggerSync additions did NOT introduce stdout writes (ADR-0001).
4. **Index existence:** `grep -c "CREATE INDEX IF NOT EXISTS" src/infrastructure/db/migrations/0002_back01_covering_indexes.sql` returns 3.
5. **Coverage gates:**
   - `grep -v '^#' CHANGELOG.md | grep -c "v1.1"` returns ≥ 1.
   - `grep -c "Complete" .planning/REQUIREMENTS.md` reflects the 26 new "Complete" flips.
   - `grep -q "milestone v1.1" .planning/STATE.md` true.
6. **Lint + format clean:** `npm run lint` clean; `npm run format` clean.
7. **TypeScript strict clean:** `tsc --noEmit` (or whatever CI gate exists per the most recent commit `cebc2f5 ci(05): gate tsc --noEmit`) green.
8. **No live network calls:** `grep -r "fetch.*api.prod.whoop.com" tests/integration/review/` returns zero matches; all tests route through MSW (ADR-0006).

**Phase 10 + 11 precondition re-verification (must hold at PR-open time):**
- `git log origin/main --oneline | grep -E "10-(01|02|03)" | wc -l` ≥ 3 (Phase 10 PRs 1-3 merged).
- If Phase 11 PRs have merged, TSTC-01 + TSTC-02 already flipped to Complete in REQUIREMENTS.md before Task 10 runs.
</verification>

<success_criteria>
**Phase 12 ships when:**

- [ ] Migration `0002_back01_covering_indexes.sql` creates 3 covering indexes; schema.ts mirrors them; schema.test.ts asserts their presence (B1 closed).
- [ ] flushLoggerSync called at 5+ sites in src/mcp/index.ts + src/cli/commands/sync.ts: mcp SIGINT, mcp SIGTERM, cli sync-start, cli abort-listener, plus the existing fatal-exit call (B7 closed).
- [ ] `tests/integration/review/fdr-weekly.test.ts` exists; asserts FDR suppression survives the full sync → DB → getWeeklyReview path (T1 closed).
- [ ] `tests/integration/sync/dst-fixture.test.ts` Tests 1 + 3 use dynamic fixture ids (T2 closed).
- [ ] `tests/integration/setup-stopwatch.test.ts` has a polarity-guard test OUTSIDE the skipIf block (T3 closed).
- [ ] `tests/integration/auth-concurrency.test.ts` I-01 uses ChildTokenOutput Zod schema + typed toMatchObject (T4 closed).
- [ ] `src/services/doctor/checks/concurrent-writers-stress.test.ts` uses anchored regex matcher (T5 closed).
- [ ] `src/services/doctor/index.test.ts` detail assertions use regex matchers; status assertions remain `toBe()` (T6 closed — or deferred to follow-up if Phase 10 PR #2 not merged).
- [ ] `src/infrastructure/db/repositories/body-measurements.repo.test.ts` has Test 8 exercising concurrent readers (T7 closed).
- [ ] `src/services/refresh-orchestrator.test.ts` has ≥14 behavioral matchers (T8 verified closed — no code change unless gap found).
- [ ] CHANGELOG.md has v1.1 section enumerating each closed item with milestone-complete marker (ROADMAP SC1).
- [ ] All 26 v1.1 REQ-IDs flipped to Complete in REQUIREMENTS.md v1.1 Traceability (ROADMAP SC3).
- [ ] STATE.md has milestone v1.1 close entry dated 2026-06-03 (ROADMAP SC3).
- [ ] ROADMAP.md v1.1 Progress + Coverage flipped to Complete / 26 of 26.
- [ ] `npm test` full suite green; under 60 seconds locally (ROADMAP SC2).
- [ ] `npm run lint` + `npm run format` clean.
- [ ] No new dependency added; no ADR amendment needed; no scope creep (zero new user-facing features per v1.1 charter).
- [ ] PR opens on branch `chore/12-backlog-drain` per branch policy (worktree + branch + PR + explicit user approval — never push direct to main).
</success_criteria>

<output>
Create `.planning/phases/12-backlog-drain/12-01-backlog-drain-SUMMARY.md` when done, summarizing: 10 tasks executed across 1 wave; files modified count; full-suite timing; v1.1 milestone close confirmation; any T6 deferral note if Phase 10 PR #2 had not merged at execute time.
</output>
