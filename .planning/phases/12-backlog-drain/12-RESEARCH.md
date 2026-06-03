# Phase 12 Research — Backlog Drain

**Researched:** 2026-06-03
**Domain:** Closed-flag audit + opportunistic quality-sweep (no new product surface)
**Confidence:** HIGH — every claim is verified against the live tree on `feat/10-plan-phase` as of HEAD `8376c71`.

## Goal restatement

Phase 12 is the final v1.1 quality-hardening PR: an **omnibus, low-risk, opportunistic** backlog drain covering the residual items from tracker #95 (BACK-01) plus the testing backlog (TSTC-03). Unlike Phases 6–11, which each ship a single coherent contract change, Phase 12 ships whatever is still pending after the rest of the milestone lands. Per ROADMAP it ships as **one PR** (all-or-nothing); per AGENTS.md branch policy that PR follows the worktree + branch + explicit-approval flow.

The audit below is the load-bearing output for the planner. ROADMAP enumerates 15 items (7 BACK-01 + 8 TSTC-03) but **many BACK-01 items already shipped opportunistically during the PR #97–#120 sweep**. The planner must not re-plan closed items.

Authority for everything below: `.planning/REQUIREMENTS.md` (TSTC-03 + BACK-01 text), `.planning/ROADMAP.md` §"Phase 12: Backlog Drain", `.planning/research-v1.1/SUMMARY.md` §6/§7, and the live tree at HEAD `8376c71`. [CITED: `.planning/REQUIREMENTS.md`] [CITED: `.planning/ROADMAP.md`]

## Project Constraints (from AGENTS.md / CLAUDE.md)

- **ADR-0001 (MCP stdout purity):** all signal handlers that flush Pino must remain stderr-only. The proposed B7 fix calls `flushLoggerSync()` which uses `logger.flush()` → stderr; no stdout touch. [CITED: `agent_docs/decisions/0001-mcp-stdout-purity.md`]
- **ADR-0006 (fixture-only tests):** every new test added under TSTC-03 must route through MSW; the existing setup files already enforce `no-live-whoop.ts`. [CITED: `agent_docs/decisions/0006-fixture-only-tests.md`]
- **Test suite budget:** under 60 seconds locally (`agent_docs/conventions.md` §Testing). Adding ~8 tests to a 115-file suite has measurable cost — see Risks. [CITED: `agent_docs/conventions.md`]
- **Branch policy:** Phase 1+ never pushes directly to `main`; Phase 12 ships as a single PR off the feature branch. [CITED: `AGENTS.md` §"Branch policy"]
- **Conventional commits:** Phase 12 omnibus commit uses `fix(12): …` or `chore(12): …` depending on the constituent change; CHANGELOG entry per ROADMAP SC1. [CITED: `agent_docs/workflows/contributing.md`]
- **TypeScript strict + no default exports + ESM:** all new files conform. [CITED: `agent_docs/conventions.md` §"Code style"]

## Phase 10 + Phase 11 dependency note

**Phase 12 plans can be drafted now, but execution is blocked until Phase 10 ships and Phase 11 is at least partially in place.**

- **Phase 10** is just-planned (PR #121 open, NOT merged). The architecture refactor cluster moves `sanitize` to `domain/`, drops `tokenStore` / `refreshOrchestrator` singletons, inverts `client.ts` DI, extracts doctor wiring, and inlines `api-gap`. Any Phase 12 item that references a file Phase 10 moves will break the moment it tries to land out of order. Concretely: B7's flush-on-signal touches `src/mcp/index.ts` + `src/cli/commands/sync.ts` (both stable through Phase 10), but the **testing items** (T1, T6) touch `services/doctor/index.test.ts` and the test surface around it, which Phase 10 ARCH-06 + ARCH-07 will rewire.
- **Phase 11** (TSTC-01 + TSTC-02) has not been planned yet. TSTC-01 ships the `latestFinished()` aborted-skip regression test that lives in `services/doctor/checks/last-sync-recency.test.ts` — independent surface from Phase 12's T6 (`doctor/index` integration detail regex). No collision, but the planner should not start Phase 12 execution until both Phase 10 + Phase 11 have at least merged their preconditions to `main`.

The cross-phase dependency graph in ROADMAP confirms Phase 12 sits at the tail: `Phase 11 → Phase 12`. The discuss-phase should explicitly confirm to the user that **planning ≠ execution** and the PR will not open until Phases 10 + 11 are in.

## BACK-01 residual audit

ROADMAP enumerates 7 items (B1–B7). The audit below is line-number-accurate against HEAD `8376c71` on 2026-06-03.

| # | Item | Status | Evidence | Next-action |
|---|------|--------|----------|-------------|
| **B1** | `decisions` / `sync_runs` covering indexes | **OPEN** | `schema.ts:262-278` (sync_runs) + `schema.ts:302-317` (decisions) define both tables with **no indexes** beyond primary keys. `migrations/0000_initial.sql:29,82,101,132` and `migrations/0001_score_state_check_constraints.sql:60,96,131,170` create indexes for `cycles`/`recoveries`/`sleeps`/`workouts` only. `grep -E "CREATE INDEX" migrations/` shows zero matches for `decisions` or `sync_runs`. | **Add 2 covering indexes via new migration `0002_decisions_sync_runs_indexes.sql`:** (a) `CREATE INDEX decisions_status_created_at_idx ON decisions (status, created_at)` — covers the open-decisions query in `decisionsRepo.listOpen()` and the weekly DEC-04 prompt's `countSince` lookup; (b) `CREATE INDEX sync_runs_status_started_at_idx ON sync_runs (status, started_at)` — covers `latestFinished()` / `reclassifyStaleRunning()` / `whoop_query_cache` filters. Update `schema.ts` to declare both indexes in the `(t) => […]` array so Drizzle's introspect catches drift. Add a schema.test.ts assertion that EXPLAIN QUERY PLAN on those filter shapes uses the index (precedent: existing schema.test.ts patterns). |
| **B2** | `decisions.findByPrefix` min-length guard | **CLOSED in #98** | `decisions.repo.ts:140`: `if (prefix.length < 4) return [];` — minimum 4-character prefix enforced. Comment at line 9 documents the D-20 short-prefix lookup. | None — drop from Phase 12 scope. |
| **B3** | `body_measurements` REAL == quantize tolerance | **CLOSED in #117** | `body-measurements.repo.ts:73-79`: `FLOAT_TOL = 1e-6` constant with `closeEnough(a,b)` helper applied to `height_meter` (line 78) and `weight_kilogram` (line 79). Comment at line 70 documents the rationale. | None — drop from Phase 12 scope. |
| **B4** | `cycles.cursor()` score-state-aware comment | **CLOSED in #120** | `cycles.repo.ts:89-104`: `cursor()` method with explicit comment block at lines 90-98 stating "BACK-01 (#95): cursor() is intentionally NOT score-state-aware" — documents why filtering on `score_state` here would lose visibility into PENDING_SCORE rows. | None — drop from Phase 12 scope. |
| **B5** | token-store `mkdir` 0o700 | **CLOSED in #99** | `token-store.ts:222,241,315`: three `mkdir(resolvedPaths.configDir, { recursive: true, mode: 0o700 })` call sites. Line 222 comment cites "SECH-02 / #95: mode 0o700 parity with init.ts:102". File-creation atomic write at line 491 also uses `open(tmp, 'w', 0o600)`. | None — drop from Phase 12 scope. |
| **B6** | OAuth callback `.unref()` | **CLOSED in #114** | `oauth.ts:282`: `server.unref();` immediately after `server.listen(opts.port, '127.0.0.1', ...)` at line 269. Comment at lines 278-281 documents the SIGINT-between-listen-and-callback rationale. `timer.unref()` at line 287 also present. | None — drop from Phase 12 scope. |
| **B7** | Pino `flush()` on signals + start-of-sync | **PARTIAL** | `logger.ts:103-107`: `flushLoggerSync()` helper exists (closed by #118). **But:** project-wide grep `flushLoggerSync\|process\.on\('SIG` shows it's called in exactly **one** place — `mcp/index.ts:79` on fatal exit. **Three call sites are missing:** (a) `mcp/index.ts:110-114` — `process.once('SIGINT'/'SIGTERM', ...)` handler bodies just call `app.close(); process.exit(0)` with no flush; (b) `cli/commands/sync.ts:235-260` — the abort-handler factory writes to the DB then calls `app.close()` + `process.exit(exitCode)` with no flush; (c) **start of sync** — no flush call anywhere in `sync.ts` before the long-running sync loop begins. | **3 small edits in one PR:** (1) Add `flushLoggerSync()` immediately before `process.exit(0)` in both `mcp/index.ts:110-114` handlers. (2) Add `flushLoggerSync()` immediately before `process.exit(exitCode)` in the `cli/commands/sync.ts` abort listener (line 259). (3) Add `flushLoggerSync()` at the top of the sync command's execute body so an in-flight crash mid-sync has fewer buffered records to lose. **Caveat:** verify `flushLoggerSync()` does not race with `app.close()` — current contract has the comment "Each shutdown owner is responsible for calling logger.flush()" (logger.ts:103), so the call order should be `flush → close → exit`. |

**BACK-01 net:** 6 of 7 items already closed. Only **B1 (indexes)** and **B7 (signal-handler flush)** remain.

## TSTC-03 testing audit

ROADMAP enumerates 8 items (T1–T8). All 8 are unconfirmed against the live tree; many are subtle test-quality issues rather than missing files.

| # | Item | Status | Evidence | Next-action |
|---|------|--------|----------|-------------|
| **T1** | FDR ↔ weekly-review fixture integration test | **PARTIAL** | `src/services/review/weekly.test.ts:142-159`: service-level test "BH-FDR-suppression load-bearing fixture (D-35)" exists and exercises `getWeeklyReview` end-to-end via the `weekly-pattern-fdr-suppression.json` fixture + in-memory DB. **Missing:** no test under `tests/integration/` drives the full path — `runSync → DB → getWeeklyReview` — to confirm FDR suppression survives the WHOOP HTTP layer. Closest existing integration test (`tests/integration/sync/dst-fixture.test.ts`) is a sync-only test, no review composition. | **Add `tests/integration/review/fdr-weekly.test.ts`** — mirrors `dst-fixture.test.ts` shape: MSW serves a fixture-driven sync, then `getWeeklyReview()` runs against the seeded DB and asserts `pattern.reason === 'no_factor_cleared_fdr'`. Reuse the `weekly-pattern-fdr-suppression.json` fixture from `tests/fixtures/review/`. **Note: `tests/integration/review/` does not exist yet** — create the directory. |
| **T2** | DST fixture hard-coded ids | **OPEN** | `tests/integration/sync/dst-fixture.test.ts`: Test 1 (line 162) hard-codes `loadCycleFlags(mem, 30001)`; Test 3 (lines 208, 216, 223) hard-codes `2001`, `2002`, `2003`. Test 2 (lines 169-179) already does the right thing — reads the id dynamically from the fixture JSON. The pattern is mixed: Test 2 was opportunistically fixed but Tests 1 + 3 were not. | **Refactor Tests 1 + 3 to follow Test 2's pattern.** Extract a `loadFixtureIds(scenarioName: string): number[]` helper (probably in `tests/integration/sync/helpers/`), use it in Tests 1 + 3. Risk: low — pure test refactor, no production code touched. |
| **T3** | Stopwatch env-gate polarity guard | **OPEN** | `tests/integration/setup-stopwatch.test.ts:80,94`: `RUN_STOPWATCH = process.env.VITEST_INCLUDE_STOPWATCH === '1'`; `describe.skipIf(!RUN_STOPWATCH)`. `.github/workflows/setup-stopwatch.yml:74` sets `VITEST_INCLUDE_STOPWATCH: '1'`. **No assertion exists** that proves the gate has the correct polarity — if someone flips `=== '1'` to `!== '1'` or removes the env var from the workflow, the test silently runs (or silently skips) and CI is happy either way. | **Add a 5-line polarity test in `setup-stopwatch.test.ts`** (outside the `describe.skipIf` block): `describe('env-gate polarity', () => { it('reads VITEST_INCLUDE_STOPWATCH and matches the strict-equal-to-1 contract', () => { expect(RUN_STOPWATCH).toBe(process.env.VITEST_INCLUDE_STOPWATCH === '1'); }); });`. This compiles and runs in 0ms under default `npm test` and acts as the polarity sentinel — any future polarity flip fails the assertion on the next run. **Alternate:** add a CI workflow assertion `[ "${VITEST_INCLUDE_STOPWATCH:-}" = "1" ]` in `setup-stopwatch.yml` as belt-and-suspenders. |
| **T4** | auth-concurrency I-01 typed assertion | **PARTIAL** | `tests/integration/auth-concurrency.test.ts:402-456` (Test "I-01"): assertions use raw `toBe(0)`, `toBe(1)`, `toBe(true)`, `.not.toBeNull()` against parsed-stdout-shaped values. There is no narrowing to a `TokenChildResult` (or similar) typed shape — `parseChildStdout()` returns `null | object` and downstream code accesses `tokens[i]?.accessToken` via optional chaining without a `expect(tokens[i]).toMatchObject<TokenChildResult>(…)` typed assertion. | **Define a `ChildTokenOutput` Zod schema + type** in `tests/integration/helpers/` (or alongside the child helper). Replace the inline parse with `ChildTokenOutput.parse(JSON.parse(stdout))` and add a typed assertion at line 444: `expect(tokens[i]).toMatchObject({ ok: true, accessToken: expect.any(String), storageMode: 'file' })` — or, more strictly, `expect(() => ChildTokenOutput.parse(...)).not.toThrow()`. Risk: low — pure test-quality fix, no production code touched. |
| **T5** | `concurrent_writers_stress` detail regex | **OPEN** | `src/services/doctor/checks/concurrent-writers-stress.test.ts:57-58`: asserts `result.detail.toContain('4 workers × 50 upserts')` and `.toContain('(no SQLITE_BUSY)')` — these are brittle literal-substring matches. If the probe message ever changes "4 workers" → "4 concurrent writers" or "50 upserts" → "50 inserts", the test fails for prose reasons, not behavior reasons. | **Replace the two `toContain` matchers with a single anchored regex** in a new constant: `const STRESS_DETAIL_RE = /^(?:\d+) workers? × (?:\d+) upserts.*\(no SQLITE_BUSY\)$/;` → `expect(result.detail).toMatch(STRESS_DETAIL_RE)`. This tolerates worker-count tuning + verbiage shifts while pinning the load-bearing parts (counts present, no-busy claim present). Risk: low — pure test-quality fix. |
| **T6** | doctor/index integration detail regex | **OPEN** | `src/services/doctor/index.test.ts`: tests assert literal detail strings like `'skipped (running inside MCP transport)'` (line 104), `'native binding loaded'` (line 127), `'skipped — run with --stress to enable'`. These are brittle. The `MR-07` test at line 141 uses `toContain('probe threw')` + `toContain('synthetic probe explosion')` which is closer to the right shape. | **Three small edits:** (1) Extract literal detail strings to `DETAIL_RE_*` regex constants in a shared `src/services/doctor/checks/_detail-matchers.ts` (or test helper) — e.g., `SKIP_MCP_RE = /^skipped\s*\(.*running inside MCP transport.*\)$/`. (2) Replace `toBe(literal)` with `toMatch(regex)` for every detail assertion that crosses a "this might be reworded" boundary. (3) Keep `toBe()` for status fields (`pass` / `fail` / `warn`) — those ARE a fixed contract. Risk: medium — touches many test cases. Best done after Phase 10 ARCH-06 (`services/doctor/wiring.ts`) lands so the matcher constants live alongside the new wiring module. |
| **T7** | `body_measurements` concurrent-readers test | **OPEN** | `src/infrastructure/db/repositories/body-measurements.repo.test.ts`: 7 tests cover single-threaded upsert/read paths (Tests 1–7 at lines 38-105). **No test exercises concurrent readers** — no `Promise.all([repo.latest(), repo.latest()])`, no fork-based stress, no `await Promise.all` across multiple reads. | **Add Test 8: concurrent-readers safety.** Open an in-memory DB, upsert 3 measurements via separate `captured_at`s, then `await Promise.all([repo.latest(), repo.latest(), repo.listAll(), repo.getRawJson(2)])` — assert all 4 resolve to consistent values with no `SQLITE_BUSY`. **Note:** SQLite WAL mode tolerates concurrent reads with one writer; this test pins that contract for body_measurements specifically. Risk: low — additive test, no production-code change. Suite-budget cost: ~50ms (single in-memory DB, four-way Promise.all). |
| **T8** | refresh-orchestrator behavioral assertions | **MOSTLY CLOSED** | `src/services/refresh-orchestrator.test.ts`: 339 lines, 14+ tests already use behavioral matchers — `expect(op).toHaveBeenCalledTimes(N)` (lines 109, 153, 183), `expect(op).toHaveBeenNthCalledWith(N, 'at-marker')` (lines 154, 184, 252), `expect(m.getValidAccessTokenSpy).toHaveBeenCalledTimes(N)` (lines 108, 188). Test groups: happy-path, 401-reactive-retry, refresh-failure, services-barrel. **Gap (per ROADMAP):** the test file uses `toHaveBeenCalledTimes` but doesn't surface a `formatAuthError` behavioral test that asserts the exact remediation copy. Test F-02 at line 305 mentions `formatAuthError({kind: auth_expired})` covers the `recovery-ledger auth` remediation. | **One small addition: add a behavioral test that asserts the `AuthError` kind sequence across the retry path** — i.e., on 401 → re-read still stale → `getValidAccessToken` throws `refresh_failed` → `callWithAuth` throws `auth_expired` wrapping the cause. The current F-01 (line 266) tests this once; add a parametric test for the (kind, retry-count, op-call-count) tuple across 3-4 scenarios. **Risk: low.** Or alternatively: declare T8 already closed (15+ behavioral assertions present) and only add the F-02 remediation-copy assertion if the planner deems it load-bearing. Recommendation: **declare T8 closed; document in CHANGELOG.** |

**TSTC-03 net:** 7 of 8 items still need work (T8 effectively closed but worth a final behavioral-tuple test). T1 + T7 + T8 are additive (low regression risk). T2 + T4 + T6 are test-refactors (medium risk, large-surface). T3 + T5 are small regex / polarity fixes (low risk).

## Actually-pending work summary

Distilled from the audit above, the planner can consume this checklist directly. **Ordered by risk + by dependency.**

### Tier 1 — Production-code edits (3 tasks)
1. **B1a — sync_runs covering index.** Add `0002_decisions_sync_runs_indexes.sql` migration + `schema.ts` index declaration for `(status, started_at)` on `sync_runs`. Justify with EXPLAIN QUERY PLAN in test.
2. **B1b — decisions covering index.** Same migration; index `(status, created_at)` on `decisions`. Justify in test.
3. **B7 — flushLoggerSync() at 3 sites.** (a) `mcp/index.ts:110-114` SIGINT/SIGTERM handlers; (b) `cli/commands/sync.ts:259` abort listener; (c) sync command top of execute body. Verify the `flush → close → exit` order; add a behavioral test in `mcp/index.test.ts` (if it exists) or as a new integration test.

### Tier 2 — Net-new tests (2 tasks)
4. **T1 — FDR ↔ weekly integration test** at `tests/integration/review/fdr-weekly.test.ts` (new dir + file). MSW + sync + getWeeklyReview + assert `no_factor_cleared_fdr`.
5. **T7 — body_measurements concurrent-readers Test 8** appended to `body-measurements.repo.test.ts`.

### Tier 3 — Test-quality refactors (5 tasks)
6. **T2 — DST fixture id helpers.** Extract `loadFixtureIds()` helper; refactor Tests 1 + 3 in `dst-fixture.test.ts` to use it.
7. **T3 — Stopwatch polarity guard.** 5-line polarity assertion in `setup-stopwatch.test.ts` outside the skipIf block.
8. **T4 — auth-concurrency I-01 typed assertion.** Add `ChildTokenOutput` Zod schema; replace inline parse with `.parse()` + typed `toMatchObject`.
9. **T5 — concurrent_writers_stress regex.** Replace `toContain` literal matchers with one anchored regex constant.
10. **T6 — doctor/index detail regexes.** Extract `_detail-matchers.ts` of regex constants; replace literal `toBe()` with `toMatch()` for detail strings. **Best done after Phase 10 ARCH-06.**

### Tier 4 — Closing tasks (2 tasks)
11. **CHANGELOG entry.** Enumerate each landed item per ROADMAP SC1.
12. **v1.1 milestone close.** Flip all 26 v1.1 REQ-IDs to "Complete" in `REQUIREMENTS.md` v1.1 Traceability; append milestone v1.1 close to `STATE.md` (see §"v1.1 milestone close gate" below).

**Total: 12 tasks** across roughly 12–15 source/test files. Closed items dropped from scope: B2, B3, B4, B5, B6 (5 BACK-01 items already shipped).

## Risk + landmines

### R1 — Test-suite budget regression (SC2)
ROADMAP SC2 says "full-suite green; suite still finishes under 60 seconds locally." Current suite has 115 test files. Adding T1 (new integration test with MSW + sync + review) is the biggest budget hit — likely 200–500ms based on `dst-fixture.test.ts` precedent. T7 adds ~50ms. T6's refactor *removes* runtime because regex match is no slower than `toContain`. **Net estimate: +400ms.** Suite headroom is unknown but `dst-fixture.test.ts` already runs to completion in CI, so 400ms additional is safe. **Mitigation:** if T1 pushes the suite over 60s, mark it `describe.concurrent` to parallelize fixture loads.

### R2 — B1 index migration backward compatibility
Adding indexes via a new `0002_decisions_sync_runs_indexes.sql` is purely additive — `CREATE INDEX` against an existing table has no rollback risk (Drizzle migrator runs inside `BEGIN IMMEDIATE` per ADR-D-06; if the CREATE INDEX fails, the migration rolls back cleanly). **But** the index name must NOT collide with the existing `_score_state_start_idx` names. Use the suggested `decisions_status_created_at_idx` + `sync_runs_status_started_at_idx` shape. **Doctor probe consideration:** the `db_schema_version` check reads `__drizzle_migrations` count; after this migration, count goes from 2 → 3. Existing test fixtures may pin the count — grep for `journal.entries.length`, `migrations.length`, or `__drizzle_migrations` references and update.

### R3 — B7 flush-before-exit ordering
`logger.ts:105-107` `flushLoggerSync()` wraps `logger.flush()` in a try/catch but does not await anything (Pino's flush is synchronous when the destination is a non-async stream — confirmed in pino v9 docs). **However:** if any flushLoggerSync caller races with `app.close()` and the logger's underlying stream is destroyed before flush completes, records can be lost. **Mitigation:** explicit `flush → close → exit` order at every new call site; add a smoke test that spawns a child process, sends it SIGINT, and asserts the last stderr record is present.

### R4 — T6 brittleness during Phase 10 ARCH-06
Phase 10 ARCH-06 extracts doctor production wiring from `bootstrap.ts:320-392` into `src/services/doctor/wiring.ts`. T6's detail-regex refactor touches `src/services/doctor/index.test.ts` — these don't textually collide, but the test surface around doctor is being reshaped. **Mitigation:** sequence T6 LAST in the Phase 12 PR (after the simpler T2 + T3 + T4 + T5 refactors). If Phase 10 reshapes any detail strings, T6's regexes must accommodate both shapes. **Best practice:** defer T6 to a sub-task that explicitly waits for Phase 10 to merge.

### R5 — Index introspection test fragility
The proposed B1 test (`EXPLAIN QUERY PLAN` asserts the index is used) depends on SQLite query planner's heuristics, which can choose a sequential scan over a small table even when an index exists. **Mitigation:** seed the test DB with ≥100 rows before EXPLAIN; precedent in `schema.test.ts`. Failing that, assert `sqlite_master` contains the index by name — coarser but reliable.

### R6 — Phase 11 has not been planned
Phase 12 lists Phase 11 as a hard dependency (ROADMAP "Depends on: Phase 11"). The planner should call out in CONTEXT.md that the Phase 12 PR cannot open until Phase 11 ships TSTC-01 + TSTC-02. **No code-level collision** between Phase 11 and Phase 12 — TSTC-01's `last-sync-recency.test.ts` is independent of T6's `doctor/index.test.ts` — but the test-suite ordering matters for the suite-budget guarantee.

## Recommended PR shape

**ROADMAP says 1 omnibus PR. Audit suggests the same is feasible.** Total surface area:

- ~3 production files touched: `migrations/0002_*.sql` (new), `schema.ts` (2 line additions), `mcp/index.ts` (2 single-line additions), `cli/commands/sync.ts` (2 single-line additions), `logger.ts` (no change).
- ~6 test files touched + 2 new test files.
- 0 dependency changes; 0 ADR amendments; 1 CHANGELOG entry.

**One PR is appropriate** unless the test-quality refactors (T2 + T4 + T6) exceed the reviewer's diff budget. If the diff for T2/T4/T6 alone exceeds ~600 lines, **split into two PRs**: (a) "Phase 12 BACK-01 production + new tests" (B1 + B7 + T1 + T7) and (b) "Phase 12 TSTC-03 test refactors" (T2 + T3 + T4 + T5 + T6 + T8).

**Branch:** `feat/phase-12-backlog-drain` (matches naming pattern from earlier phases). **Worktree:** per AGENTS.md, use `git worktree add ../recovery-ledger-phase-12 feat/phase-12-backlog-drain` before any edits land. **Commit cadence:** one commit per task per the existing pattern (`fix(12): add sync_runs+decisions covering indexes (#95)`, `fix(12): flushLoggerSync on SIGINT/SIGTERM (#95)`, etc.). **Final commit:** the milestone-close that flips the 26 REQ-IDs.

## REQ-text alignment check

REQUIREMENTS.md §TSTC-03 (line 132) lists the 8 testing items verbatim:

> FDR↔weekly-review fixture integration; DST fixture hard-coded ids; stopwatch env-gate polarity guard; auth-concurrency I-01 typed assertion; concurrent_writers_stress detail regex; doctor/index integration detail regex; body_measurements concurrent-readers test; refresh-orchestrator behavioral assertions

**The 8 ROADMAP-enumerated items map 1:1 with the REQUIREMENTS.md TSTC-03 list.** No drift. The audit's T1–T8 ordering matches.

REQUIREMENTS.md §BACK-01 (line 136) lists 7 BACK-01 items verbatim:

> decisions/sync_runs indexes; decisions.findByPrefix min-length guard; body_measurements float tolerance; cycles.cursor() score-state-aware comment; token-store mkdir 0o700; OAuth callback `.unref()`; Pino flush on signals + start-of-sync

**The 7 ROADMAP-enumerated items map 1:1 with REQUIREMENTS.md BACK-01.** No drift. The audit's B1–B7 ordering matches.

**One subtle alignment note:** BACK-01 in REQUIREMENTS.md is a single bullet listing 7 sub-items; the planner should treat this as a single REQ-ID with 7 acceptance criteria, not as 7 REQ-IDs. The Phase 12 PR must close all 7 sub-items (or document each closed-elsewhere) to flip BACK-01 to Complete.

## v1.1 milestone close gate

ROADMAP SC3: "Every one of the 26 v1.1 REQ-IDs is flipped to Complete in REQUIREMENTS.md v1.1 Traceability table; milestone v1.1 close is appended to STATE.md."

The Phase 12 PR must include an explicit closing task (Task 12 in the §"Actually-pending work summary"). Concretely:

1. **REQUIREMENTS.md v1.1 Traceability (lines 247-274):** change every "Planned" → "Complete (Plan {plan-id}, {YYYY-MM-DD} — Verified by {test file})". The 26 REQ-IDs are: SECH-01, SECH-02, INPV-01, DBIN-01, DBIN-02, DBIN-03, DBIN-04, DBIN-05, ERRC-02, LIFE-01, LIFE-02, LIFE-03, LIFE-04, ERRC-01, ARCH-01, ARCH-02, ARCH-03, ARCH-04, ARCH-05, ARCH-06, ARCH-07, ARCH-08, TSTC-01, TSTC-02, TSTC-03, BACK-01.
2. **REQUIREMENTS.md v1.1 Coverage (lines 277-281):** flip "Complete: 0 / 26" → "Complete: 26 / 26". Append "v1.1 complete: {YYYY-MM-DD}" line.
3. **STATE.md:** append a v1.1 milestone-close entry following the v1.0 close pattern (which lives near line 1 of STATE.md per the headline grep — Project Reference / Current Position / Performance Metrics shape).
4. **ROADMAP.md v1.1 Progress table (lines 290-300):** flip every "Not started" → "Complete" with completion dates.
5. **ROADMAP.md v1.1 Coverage (lines 301-306):** flip "Complete: 0 / 26" → "Complete: 26 / 26".

**This is the highest-stakes part of Phase 12** — it's the milestone-close. The planner should treat task 12 as load-bearing and budget time for a careful diff review. **Note:** the milestone-close commits should be ordered LAST in the PR so that if any other Phase 12 task fails late in the cycle, the milestone-close is not prematurely landed.

**Edge case:** if Phase 11 has NOT yet flipped TSTC-01 / TSTC-02 to Complete in REQUIREMENTS.md by the time Phase 12 lands, the Phase 12 PR must do the flip on Phase 11's behalf. The planner should call this out in CONTEXT.md so the discuss-phase locks the right ownership.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest 2.x (pinned in `package.json`; `pool: 'forks'` per conventions.md §Testing) |
| Config file | `vitest.config.ts` (canonical, exists) |
| Quick run command | `npm test` (= `vitest run`) |
| Full suite command | `npm test` (no separate slow project as of HEAD) |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| BACK-01-B1a | sync_runs covering index used by `latestFinished()` | unit (EXPLAIN-based) | `npx vitest run src/infrastructure/db/schema.test.ts` | ✅ (add new test case to existing file) |
| BACK-01-B1b | decisions covering index used by `listOpen()` | unit (EXPLAIN-based) | `npx vitest run src/infrastructure/db/schema.test.ts` | ✅ (add new test case) |
| BACK-01-B7 | flushLoggerSync called before exit on SIGINT/SIGTERM in MCP and CLI | integration (smoke) | `npx vitest run tests/integration/lifecycle/flush-on-signal.test.ts` | ❌ Wave 0 — new file |
| TSTC-03-T1 | FDR suppression survives full sync→DB→getWeeklyReview path | integration | `npx vitest run tests/integration/review/fdr-weekly.test.ts` | ❌ Wave 0 — new file + new dir |
| TSTC-03-T2 | DST fixture tests use dynamic ids (no hard-codes) | unit (existing) | `npx vitest run tests/integration/sync/dst-fixture.test.ts` | ✅ existing — refactor |
| TSTC-03-T3 | Stopwatch env-gate polarity asserted | unit | `npx vitest run tests/integration/setup-stopwatch.test.ts` | ✅ existing — add test |
| TSTC-03-T4 | auth-concurrency I-01 uses typed schema | unit | `npx vitest run tests/integration/auth-concurrency.test.ts` | ✅ existing — refactor |
| TSTC-03-T5 | concurrent_writers_stress detail matches anchored regex | unit | `npx vitest run src/services/doctor/checks/concurrent-writers-stress.test.ts` | ✅ existing — refactor |
| TSTC-03-T6 | doctor/index detail assertions use regex matchers | unit | `npx vitest run src/services/doctor/index.test.ts` | ✅ existing — refactor |
| TSTC-03-T7 | body_measurements tolerates concurrent readers | unit | `npx vitest run src/infrastructure/db/repositories/body-measurements.repo.test.ts` | ✅ existing — add Test 8 |
| TSTC-03-T8 | refresh-orchestrator behavioral assertion tuple | unit | `npx vitest run src/services/refresh-orchestrator.test.ts` | ✅ existing — already covered |
| MILESTONE-CLOSE | All 26 v1.1 REQ-IDs flipped to Complete | manual diff review | n/a — doc edit | n/a |

### Sampling Rate
- **Per task commit:** `npx vitest run <touched-file-pattern>` — sub-5-second targeted runs.
- **Per wave merge:** `npm test` — full suite, must stay green and under 60s.
- **Phase gate:** `npm test` green + `npm run lint` clean + `npm run format` clean + manual diff review of REQUIREMENTS.md / STATE.md / ROADMAP.md milestone-close edits before `/gsd-execute-phase 12` runs `verify-work`.

### Wave 0 Gaps
- [ ] `tests/integration/review/fdr-weekly.test.ts` — covers TSTC-03-T1 (NEW directory + NEW file)
- [ ] `tests/integration/lifecycle/flush-on-signal.test.ts` — covers BACK-01-B7 (NEW directory + NEW file)
- [ ] `src/services/doctor/checks/_detail-matchers.ts` — extracted regex constants for T5 + T6 (NEW file)
- [ ] Optionally: a Phase 12 milestone-close smoke (lints REQUIREMENTS.md v1.1 traceability for "Planned" → fail if any remain)

**No new framework install needed.** Vitest + MSW + better-sqlite3 + in-memory-db helper all in place.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | The proposed `decisions_status_created_at_idx` shape (status, created_at) is the right covering order for `decisionsRepo.listOpen()` and `countSince()`. | BACK-01 §B1 | Wrong index column order could leave the query planner choosing a sequential scan. **Mitigation:** validate with EXPLAIN QUERY PLAN in the test before merging. |
| A2 | The proposed `sync_runs_status_started_at_idx` shape (status, started_at) is the right covering order for `latestFinished()`, `reclassifyStaleRunning()`, and `whoop_query_cache`. | BACK-01 §B1 | Same as A1. **Mitigation:** EXPLAIN QUERY PLAN in test. |
| A3 | `flushLoggerSync()` does not require an `await` even though the comment in logger.ts says "Each shutdown owner is responsible for calling logger.flush()". | BACK-01 §B7, Risk R3 | If Pino's flush IS async when wrapped in `pino.destination()`, records can be lost. **Mitigation:** confirm by reading `logger.ts` flush impl + running the new flush-on-signal smoke test. |
| A4 | Suite budget under 60s tolerates +400ms from the new integration tests. | Risks §R1 | If the suite is currently near the 60s ceiling, this slips us over. **Mitigation:** time the current suite locally before merging and check headroom. |
| A5 | The order `flush → close → exit` does not race with `app.close()` destroying the logger destination. | Risks §R3 | A race could lose the very records the flush was added to preserve. **Mitigation:** behavioral test spawns child, sends SIGINT, asserts last stderr record is present. |
| A6 | TSTC-01 + TSTC-02 (Phase 11) will land in REQUIREMENTS.md as "Complete" before Phase 12's milestone-close runs. | §"v1.1 milestone close gate" | If they're still "Planned," Phase 12's REQ-ID flip is incorrect. **Mitigation:** explicit precondition check in CONTEXT.md. |
| A7 | T6 should be deferred to after Phase 10 ARCH-06 merges. | TSTC-03 §T6, Risks §R4 | If executed in parallel, ARCH-06's rewiring could textually collide with the detail-regex extraction. **Mitigation:** sequence T6 last in the Phase 12 PR or skip it pending Phase 10 closure. |

**If this table is wrong:** A3 + A5 are the load-bearing ones — both depend on Pino flush semantics under MCP transport. Verify by reading the Pino destination config in `logger.ts` + writing the smoke test for B7. The rest are validate-on-write.

## Open Questions (RESOLVED 2026-06-03)

All four questions resolved by orchestrator during plan-phase (decisions D-Q1..D-Q4 passed into planner spawn prompt).

1. **Is the existing `weekly.test.ts` fixture-based service test "enough" to count as T1 closed?**
   - **RESOLVED: NO.** Add the `tests/integration/review/fdr-weekly.test.ts` per Tier 2 plan. The existing service-layer test doesn't exercise the full sync path.

2. **Should T6's detail-regex extraction wait for Phase 10 ARCH-06?**
   - **RESOLVED: YES.** Sequence T6 LAST in Phase 12 PR (Task 9). If Phase 10 PR #2 (10-03 doctor-wiring-extract) has not merged by Phase 12 execute-time, defer T6 to a follow-up sub-PR; CHANGELOG can still credit T6 closure post-hoc.

3. **B1 index naming: collision risk?**
   - **RESOLVED:** adopt `<table>_<col1>_<col2>_idx` (e.g. `decisions_status_created_at_idx`, `sync_runs_started_at_idx`, `sync_runs_status_finished_at_idx`). Consistent with the *intent* of existing `<table>_score_state_<dim>_idx` naming without overloading the score-state prefix.

4. **Is the SC2 "60s suite" budget enforced anywhere?**
   - **RESOLVED: out of scope for Phase 12.** It is a target (per conventions.md §Testing), not a CI gate. Estimated Phase 12 cost is ~+400ms — well within budget assuming current headroom. Adding a CI duration assertion deferred to a follow-up if needed (post-v1.1).

## Environment Availability

> Skipped — Phase 12 has no new external dependencies. All tools (Vitest, MSW, better-sqlite3, drizzle-kit) verified in place by virtue of v1.0 being closed (50/50 REQ-IDs complete).

## Security Domain

> Phase 12 introduces no new attack surface. The only new code is (a) a SQLite migration adding indexes (no data-shape change), (b) flush-on-signal calls into the already-audited logger module, and (c) test code. SECH-01 + SECH-02 already cover the sanitizer + doctor catch surfaces project-wide; Phase 12 does not introduce new error-emitting paths. **No ASVS category newly applies.**

## Sources

### Primary (HIGH confidence)
- HEAD `8376c71` of `feat/10-plan-phase` (git log + working tree as of 2026-06-03)
- `.planning/REQUIREMENTS.md` lines 84–137 (v1.1 requirements) + lines 247–284 (v1.1 traceability)
- `.planning/ROADMAP.md` lines 169–345 (v1.1 roadmap + Phase 12 details)
- `.planning/research-v1.1/SUMMARY.md` §6, §7
- `.planning/research-v1.1/PITFALLS.md` (full file — cross-cutting concerns reviewed)
- Live source files verified inline: `schema.ts`, `decisions.repo.ts`, `body-measurements.repo.ts`, `cycles.repo.ts`, `token-store.ts`, `oauth.ts`, `logger.ts`, `bootstrap.ts`, `sync.ts`, `mcp/index.ts`, `auth-concurrency.test.ts`, `dst-fixture.test.ts`, `setup-stopwatch.test.ts`, `weekly.test.ts`, `fdr.test.ts`, `body-measurements.repo.test.ts`, `concurrent-writers-stress.test.ts`, `doctor/index.test.ts`, `refresh-orchestrator.test.ts`
- `git log --oneline -30` PR landings #97–#121 verified

### Secondary (MEDIUM confidence)
- `agent_docs/conventions.md` (suite budget interpretation)
- `agent_docs/decisions/0001-mcp-stdout-purity.md`, `0002-single-flight-oauth-refresh.md`, `0006-fixture-only-tests.md`

### Tertiary (LOW confidence)
- None — every claim in this RESEARCH.md is verified against the live tree.

## Metadata

**Confidence breakdown:**
- BACK-01 audit: HIGH — every line number verified by direct grep on HEAD.
- TSTC-03 audit: HIGH — every test file inspected; behavioral coverage assessed against ROADMAP text.
- Risks: MEDIUM — Risk R1 (suite budget) is estimate, not measurement.
- Recommended PR shape: HIGH — single-omnibus per ROADMAP; fallback split-into-two documented.
- v1.1 milestone close gate: HIGH — line ranges verified against REQUIREMENTS.md.

**Research date:** 2026-06-03
**Valid until:** 2026-07-03 (30 days; stable surface). Re-verify if Phases 6–11 PRs land between now and execution, since some test surfaces may shift.

## RESEARCH COMPLETE

**Phase 12 audit:** 8 of 15 enumerated items remain OPEN (B1, B7, T1–T7) + 1 effectively closed (T8) + 1 milestone-close task. 6 BACK-01 items (B2–B6) already shipped in PRs #98, #99, #114, #117, #120 — drop from scope. Single omnibus PR is feasible; sequence T6 last (Phase 10 dependency). Execution blocked until Phases 10 + 11 land.
