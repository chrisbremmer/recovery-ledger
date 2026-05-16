---
phase: 03-data-model-db-layer-sync-loop
plan: 10
type: execute
wave: 3
depends_on: ["03-07", "03-08", "03-09"]
files_modified:
  - tests/contract/cycles.test.ts
  - tests/contract/recovery.test.ts
  - tests/contract/sleep.test.ts
  - tests/contract/workouts.test.ts
  - tests/contract/profile.test.ts
  - tests/contract/body-measurements.test.ts
autonomous: true
requirements: [SYNC-07, DATA-05, DATA-06]
tags: [contract-tests, msw, fixtures, score-state]
user_setup: []

must_haves:
  truths:
    - "6 contract tests under tests/contract/<resource>.test.ts — one per WHOOP resource (D-23 / Pattern 10 / ADR-0006)"
    - "Each contract test drives: MSW helper (Plan 03-07) intercepts then resource module (Plan 03-09) fetches then repository (Plan 03-08) upserts then repository read returns expected entities"
    - "tests/contract/recovery.test.ts loads the recovery 200-mixed-score-states fixture and asserts: (a) all 3 rows upserted, (b) byRange() with default opts returns only the SCORED row, (c) byRange({includeUnscored: true}) returns all 3 — Pitfall G verification anchor"
    - "tests/contract/cycles.test.ts exercises the 3 DST/tz fixtures and asserts baseline_excluded + exclusion_reason are persisted correctly — Pitfall H verification anchor"
    - "Full contract test suite runs in under 30 seconds (well under SYNC-07 60s cap)"
    - "ADR-0006: zero live WHOOP calls — all HTTP intercepted by MSW (onUnhandledRequest set to error)"
    - "Each resource test verifies idempotency: re-run with same fixture produces 0 net new rows on second pass (D-11 / SYNC-04 lock)"
  artifacts:
    - path: "tests/contract/cycles.test.ts"
      provides: "End-to-end contract test for cycles + DST/tz verification anchor (Pitfall H)"
      contains: "200-dst-spring-forward"
    - path: "tests/contract/recovery.test.ts"
      provides: "End-to-end contract test for recovery + Pitfall G score-state-discipline verification"
      contains: "200-mixed-score-states"
  key_links:
    - from: "tests/contract/<resource>.test.ts"
      to: "tests/helpers/msw-whoop-<resource>.ts"
      via: "createWhoopXyzHelper()"
      pattern: "createWhoop"
    - from: "tests/contract/<resource>.test.ts"
      to: "tests/helpers/in-memory-db.ts"
      via: "createInMemoryDb()"
      pattern: "createInMemoryDb"
    - from: "tests/contract/<resource>.test.ts"
      to: "src/infrastructure/whoop/resources/<resource>.ts"
      via: "named import of list*/get* function"
      pattern: "listCycles|listRecovery|listSleep|listWorkouts|getProfile|getBodyMeasurement"
---

<objective>
Land the fixture-based contract test suite (SYNC-07 verification anchor) — one test file per WHOOP resource, each driving the full Wave-3 stack: MSW intercepts then resource module fetches then repository upserts then repository read returns expected entities. The recovery test is the Pitfall G anchor; the cycles test is the Pitfall H anchor. Total runtime under 30s.

Purpose: ADR-0006 forbids live WHOOP calls; SYNC-07 promises fixture coverage for every resource. This plan satisfies both with one canonical test per resource, exercising the entire data path (HTTP, Zod parse, normalize, DST detect, upsert, byRange) end-to-end.

Output: 6 contract test files (~600 LOC total).
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
@agent_docs/decisions/0006-fixture-only-tests.md
@agent_docs/conventions.md
@src/infrastructure/whoop/resources/cycles.ts
@src/infrastructure/whoop/resources/recovery.ts
@src/infrastructure/db/repositories/cycles.repo.ts
@src/infrastructure/db/repositories/recovery.repo.ts
@tests/helpers/msw-whoop-cycles.ts
@tests/helpers/msw-whoop-recovery.ts
@tests/helpers/in-memory-db.ts
@tests/fixtures/whoop/cycles/200-dst-spring-forward.json
@tests/fixtures/whoop/recovery/200-mixed-score-states.json

<interfaces>
Canonical contract test shape mirrored across all 6 files. Each test file:
  - imports createWhoopXyzHelper from tests/helpers/msw-whoop-<resource>.ts
  - imports createInMemoryDb from tests/helpers/in-memory-db.ts
  - imports list* / get* from src/infrastructure/whoop/resources/<resource>.ts
  - imports createXyzRepo from src/infrastructure/db/repositories/<resource>.repo.ts
  - uses vitest beforeAll / afterAll for MSW server lifecycle (listen with onUnhandledRequest:'error' to catch accidental live network calls)
  - uses beforeEach / afterEach for fresh in-memory DB + repo
  - happy-path test + idempotency test + resource-specific tests
</interfaces>
</context>

<tasks>

<task type="auto">
  <name>Task 1: Cycles + Recovery contract tests (load-bearing for Pitfall G + Pitfall H)</name>
  <files>tests/contract/cycles.test.ts, tests/contract/recovery.test.ts</files>
  <read_first>
    - .planning/phases/03-data-model-db-layer-sync-loop/03-RESEARCH.md §Common Pitfalls G (lines 805-807, recovery mixed-score-states verification) + Pitfall H (lines 810-811, DST fixture verification) + §Validation Architecture lines 1163-1183
    - .planning/phases/03-data-model-db-layer-sync-loop/03-PATTERNS.md §G3 lines 1376-1400 (contract test pattern)
    - .planning/phases/03-data-model-db-layer-sync-loop/03-CONTEXT.md decisions D-04 (default SCORED filter), D-13/14 (DST detection), D-11 (idempotent upsert), D-19 (paginateAll dup-ID assertion)
    - tests/fixtures/whoop/cycles/200-dst-spring-forward.json + 200-dst-fall-back.json + 200-tz-trip-sfo-jfk.json (Plan 03-07 fixtures)
    - tests/fixtures/whoop/recovery/200-mixed-score-states.json (Plan 03-07 fixture)
    - tests/helpers/msw-whoop-cycles.ts + tests/helpers/msw-whoop-recovery.ts (Plan 03-07)
    - tests/helpers/in-memory-db.ts (Plan 03-07)
    - src/infrastructure/whoop/resources/cycles.ts + recovery.ts (Plan 03-09)
    - src/infrastructure/db/repositories/cycles.repo.ts + recovery.repo.ts (Plan 03-08)
    - tests/integration/auth-concurrency.test.ts (Plan 02-08 integration test shape precedent)
  </read_first>
  <action>
    Create tests/contract/cycles.test.ts. Setup uses the cycles MSW helper, in-memory DB, and cycles repo. MSW server listens with onUnhandledRequest set to 'error' so any accidental real-network fetch fails the test. Tests:

    Test 1: happy path — load the cycles/200-ok.json fixture as the default MSW response. Call listCycles({since: '2026-05-01T00:00:00.000Z', until: '2026-05-20T00:00:00.000Z', ianaZone: 'America/Los_Angeles', priorTimezoneOffset: null}). Assert returned Cycle[] length === 1 with scoreState === 'SCORED'. Then call repo.upsertBatch(result) and assert {changed: 1}. Then call repo.byRange(since, until) and assert 1 row matching the fixture.

    Test 2: idempotency — call listCycles + upsertBatch again with the same fixture. Assert repo.byRange() still returns 1 row (no duplicate). Hit count on MSW is 2 (one fetch per listCycles call). D-11 lock.

    Test 3: DST spring-forward — replace MSW default with 200-dst-spring-forward.json. Call listCycles. Assert the returned entity has baselineExcluded: true AND exclusionReason: 'dst_straddle'. Pitfall H anchor.

    Test 4: DST fall-back — same with 200-dst-fall-back.json. Same assertion.

    Test 5: tz_drift — load 200-tz-trip-sfo-jfk.json (3 records). Call listCycles with priorTimezoneOffset: null (no prior in DB). Expected:
      - Record 0 (offset -08): baselineExcluded=false (no priorCycle on first record because the function input is null).
      - Record 1 (offset -05): baselineExcluded=true, exclusionReason='tz_drift' (prior offset within this batch is -08).
      - Record 2 (offset -05): baselineExcluded=false (prior offset matches).

    Test 6: pagination — set MSW response to a multi-page sequence using setNextResponse(page1, 200, {...}) for the first call, then the default for the second page. Verify all records across pages are fetched. Use the helper's hitCount to assert exactly 2 hits.

    Test 7: pagination dup-ID assertion — craft a synthetic 2-page response with the same ID in both pages (via setNextResponse twice). Expect listCycles to throw WhoopApiError with kind 'validation' and detail matching /duplicate id/. Pitfall 10 anchor.

    Test 8: SCORED-only default filter — Insert one SCORED cycle + one PENDING_SCORE cycle directly via upsertBatch (skip the HTTP layer to keep this test focused on the repo filter). Call repo.byRange(start, end) and assert 1 row (SCORED only). Then call repo.byRange(start, end, {includeUnscored: true}) and assert 2 rows. D-04 anchor.

    Test 9: baseline_excluded filter — upsert a DST-flagged + a normal cycle. Default byRange returns 1 (normal only). With {includeExcluded: true} returns 2. D-16 anchor.

    All tests use vi.setConfig({testTimeout: 5_000}) per file. Total file under 6 seconds.

    Create tests/contract/recovery.test.ts. Setup uses the recovery MSW helper, in-memory DB, recovery repo. Tests:

    Test 1: happy path — recovery/200-ok.json then listRecovery + upsertBatch then byRange returns 1 entity with scoreState='SCORED'.

    Test 2: idempotency — repeat call; row count unchanged. Compound-key ON CONFLICT(cycle_id, sleep_id) is verified.

    Test 3 — Pitfall G anchor: load recovery/200-mixed-score-states.json (3 records: SCORED + PENDING + UNSCORABLE). Call listRecovery + upsertBatch and assert upsert {changed: 3}. Then:
      - repo.byRange() with default opts returns 1 row (SCORED only). Locks D-04 / Pitfall 3.
      - repo.byRange({includeUnscored: true}) returns 3 rows.
      - repo.byCycleAndSleep(cycleId, sleepId) for the PENDING_SCORE record returns the entity with scoreState='PENDING_SCORE' (no score fields on the entity).
      - Compile-time discriminator: in a TS narrowing branch, accessing pendingEntity.recoveryScore would be a compile error. Lock via a `@ts-expect-error` directive on a deliberate-bad access line.

    Test 4: dup-ID assertion — synthetic 2-page response with the same (cycle_id, sleep_id) compound key in both pages. Expect WhoopApiError({kind: 'validation'}). Pitfall 10 anchor for compound keys — exercises the paginateAll keyFn extension from Plan 03-09 Task 2.

    Test 5: getRawJson(cycleId, sleepId) returns the originally stored raw_json string for the SCORED record.

    Both files: vitest pool='forks' is already configured. No live WHOOP — ADR-0006 satisfied. No console.* in test files (Gate B exempts test files but discipline matters).
  </action>
  <verify>
    <automated>npm run test -- tests/contract/cycles.test.ts tests/contract/recovery.test.ts</automated>
  </verify>
  <acceptance_criteria>
    - npm run test -- tests/contract/cycles.test.ts shows at least 9 assertions passing
    - npm run test -- tests/contract/recovery.test.ts shows at least 5 assertions passing
    - Combined runtime for both files under 12 seconds (loose budget; total contract suite must be under 30s per SYNC-07 anchor)
    - cycles.test.ts Test 3 (DST spring-forward) passes: returned entity has baselineExcluded=true + exclusionReason='dst_straddle'
    - recovery.test.ts Test 3 passes: default byRange returns SCORED only (1 row), {includeUnscored} returns 3
    - grep -c "200-mixed-score-states" tests/contract/recovery.test.ts returns at least 1 (Pitfall G anchor cited)
    - grep -c "200-dst-spring-forward" tests/contract/cycles.test.ts returns at least 1 (Pitfall H anchor cited)
    - grep -c "ts-expect-error" tests/contract/recovery.test.ts returns at least 1 (DU forcing function lock)
    - bash scripts/ci-grep-gates.sh exits 0
  </acceptance_criteria>
  <done>Cycles + recovery contract tests anchor Pitfall G + Pitfall H + DST fixture coverage + idempotency lock; total 14+ assertions.</done>
</task>

<task type="auto">
  <name>Task 2: Sleep + Workouts + Profile + Body-Measurements contract tests</name>
  <files>tests/contract/sleep.test.ts, tests/contract/workouts.test.ts, tests/contract/profile.test.ts, tests/contract/body-measurements.test.ts</files>
  <read_first>
    - tests/contract/cycles.test.ts (Task 1 — canonical shape to mirror)
    - tests/helpers/msw-whoop-sleep.ts + msw-whoop-workouts.ts + msw-whoop-profile.ts + msw-whoop-body-measurements.ts (Plan 03-07)
    - tests/fixtures/whoop/sleep/200-ok.json + workouts/200-ok.json + profile/200-ok.json + body-measurements/200-ok.json (Plan 03-07)
    - src/infrastructure/whoop/resources/sleep.ts + workouts.ts + profile.ts + body-measurements.ts (Plan 03-09)
    - src/infrastructure/db/repositories/sleep.repo.ts + workouts.repo.ts + profile.repo.ts + body-measurements.repo.ts (Plan 03-08)
    - .planning/phases/03-data-model-db-layer-sync-loop/03-CONTEXT.md decisions D-23 (resource order) + D-35 (body-measurements append-on-change)
  </read_first>
  <action>
    Create 4 contract tests, mirroring the canonical cycles.test.ts shape but adapted per resource.

    tests/contract/sleep.test.ts: Setup uses MSW sleep helper + in-memory DB + sleep repo.
      Test 1: happy path — listSleep then upsertBatch then byRange returns 1 entity with UUID id matching fixture.
      Test 2: idempotency — repeat; row count unchanged.
      Test 3: SCORED-only default filter — direct upsert SCORED + PENDING; byRange default 1 row; {includeUnscored} 2 rows.
      Test 4: id is a UUID string (A6) — assert `typeof row.id === 'string'` and length === 36.
      Test 5: getRawJson(id) returns the raw_json string.

    tests/contract/workouts.test.ts: same shape as sleep, plus:
      Test 6: SCORED workout has strain field on the entity but PENDING/UNSCORABLE do not — discriminator narrowing test with `ts-expect-error` on the bad access line.

    tests/contract/profile.test.ts: Setup uses MSW profile helper + in-memory DB + profile repo.
      Test 1: getProfile() returns Profile entity (camelCase). Assert userId, email, firstName, lastName match fixture.
      Test 2: repo.upsert(profile) then repo.getCurrent() returns the persisted entity.
      Test 3: getProfile + upsert is idempotent — second pass leaves the row count at 1; the ON CONFLICT(user_id) DO UPDATE updates in place.
      Test 4: getRawJson(userId) returns the raw_json string.

    tests/contract/body-measurements.test.ts: Setup uses MSW body-measurements helper + in-memory DB + body-measurements repo.
      Test 1: First getBodyMeasurement + upsertOnChange returns {inserted: true} and repo.listAll().length === 1.
      Test 2: Second getBodyMeasurement with identical fixture data + upsertOnChange returns {inserted: false} and repo.listAll().length === 1 (D-35 append-on-change).
      Test 3: setNextResponse override on MSW to return a fixture with weight_kilogram changed by +1.0. Then getBodyMeasurement + upsertOnChange returns {inserted: true}. listAll() returns 2 rows (history accumulates per Open Question 3).
      Test 4: repo.latest() after Test 3 returns the row with the new weight value.
      Test 5: captured_at on the inserted row matches the injected clock (use vi.useFakeTimers().setSystemTime(...) or pass an explicit clock to upsertOnChange).

    All 4 files: no live HTTP; MSW intercepts; ADR-0006 + SYNC-07 satisfied. Vitest pool='forks' (already configured). No console.* in test code.
  </action>
  <verify>
    <automated>npm run test -- tests/contract/</automated>
  </verify>
  <acceptance_criteria>
    - npm run test -- tests/contract/ runs all 6 contract test files
    - Total assertion count across the 6 files is at least 30 (Task 1 contributes 14, Task 2 contributes at least 16 across 4 files: 5+6+4+5)
    - Total runtime for the full contract suite is under 30 seconds (SYNC-07 anchor — well under the 60s cap)
    - Each contract test file has at least one assertion verifying onUnhandledRequest:'error' is set (or no live network calls slip past MSW)
    - body-measurements.test.ts Test 2 passes — D-35 append-on-change idempotency lock
    - workouts.test.ts Test 6 — DU discriminator narrowing locked via `ts-expect-error`
    - bash scripts/ci-grep-gates.sh exits 0
    - grep -rE "from ['\"]drizzle-orm" tests/contract/ returns 0 lines (Gate G — only drizzle imports through the in-memory-db helper, which re-exports from connection.ts)
  </acceptance_criteria>
  <done>4 remaining contract tests shipped; total 6-file contract suite runs in under 30s with 30+ assertions covering happy path + idempotency + score-state discipline + DST + append-on-change per resource.</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| Test code that drives MSW | Fully internal; no production code path |
| Fixture JSON validated by Zod schemas | Plan 03-03 schemas are the spec; contract tests are the conformance check |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-03.10-01 | Tampering | A test forgets to set onUnhandledRequest:'error' and a live WHOOP call slips through | mitigate | acceptance criterion checks for the setting; ADR-0006 + helper default; PR review catches drift |
| T-03.10-02 | Information disclosure | Test logs contain Pino warns with token-shaped data | accept | Tests don't use real tokens; MSW returns deterministic responses; sanitize.ts D-34 attestation covers any real-token leak path |
| T-03.10-03 | Repudiation | A flaky test gets re-run masking the regression | mitigate | All tests are deterministic (no timing assertions on real WHOOP; MSW is synchronous); vitest pool='forks' isolates worker state |
</threat_model>

<verification>
- npm run test -- tests/contract/ all 30+ assertions green; total runtime under 30 seconds
- bash scripts/ci-grep-gates.sh all 7 gates green
- npm run lint 0 errors
- npx tsc --noEmit 0 errors
- ls tests/contract/*.test.ts returns 6 files
</verification>

<success_criteria>
- 6 contract tests cover all WHOOP v1 resources (SYNC-07 anchor)
- Recovery test anchors Pitfall G with the 200-mixed-score-states fixture (D-04 + ADR-0003)
- Cycles test anchors Pitfall H with all 3 D-15 DST/tz fixtures (D-13 + D-14 + D-16)
- Body-measurements test locks D-35 append-on-change
- Idempotency assertion per resource (D-11 / SYNC-04)
- Full suite under 30 seconds (under SYNC-07 60s cap)
- ADR-0006 satisfied: zero live WHOOP calls
</success_criteria>

<output>
Create .planning/phases/03-data-model-db-layer-sync-loop/03-10-SUMMARY.md when done.
</output>
