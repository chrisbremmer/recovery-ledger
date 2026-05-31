---
phase: 03-data-model-db-layer-sync-loop
plan: 08
subsystem: database

tags: [drizzle, repositories, score-state, raw-json, begin-immediate, sqlite, better-sqlite3]

# Dependency graph
requires:
  - phase: 03-data-model-db-layer-sync-loop
    provides: "Plan 03-02 Drizzle schema (9 tables + 4 covering indexes); Plan 03-03 camelCase entity DUs + closed Score discriminator; Plan 03-04 ResourceName + ResourceSyncOutcome + RunSyncStatus; Plan 03-05 openDb factory with D-30 pragmas + hand-rolled BEGIN IMMEDIATE migrator; Plan 03-07 createInMemoryDb test helper + canonical drizzle re-export"
provides:
  - "9 repository factories under src/infrastructure/db/repositories/ — one per Plan 03-02 table (D-01)"
  - "Canonical D-28 row → entity mapping shape — exhaustive score_state narrowing with defensive default + SCORED-null-field guards"
  - "D-04 + D-16 default WHERE clause: score_state = 'SCORED' AND baseline_excluded = 0 on scored entities; symmetric opt-in escape hatches (includeUnscored / includeExcluded)"
  - "D-09 cursor() method — COALESCE(MAX(updated_at), '1970-01-01T00:00:00.000Z') on each paginated resource repo"
  - "D-11 + Pitfall 10 idempotent upsert — ON CONFLICT(id) DO UPDATE (cycles/sleeps/workouts) and ON CONFLICT(cycle_id, sleep_id) DO UPDATE (recoveries)"
  - "D-31 + Pitfall 13 BEGIN IMMEDIATE writes via drizzle-orm 0.45.2's db.transaction(fn, { behavior: 'immediate' }) on every write site across all 9 repos"
  - "D-29 getRawJson(...) diagnostic seam — exposes the raw_json column for Phase 4 whoop_query_cache / whoop_api_gap tools; domain code never touches it"
  - "D-24 sync_runs lifecycle — insertRunning + updatePerResource (JSON merge, preserves prior entries) + finalize + listRecent"
  - "D-35 body-measurements append-on-change — read-compare-insert tuple inside one BEGIN IMMEDIATE transaction; (height_meter, weight_kilogram, max_heart_rate) tuple-equality discriminator"
  - "Recovery byRange JOIN-based exclusion on parent cycle's baseline_excluded (D-14 + D-16 inheritance via cycle_id FK)"
affects: [03-09-dst-detector, 03-10-contract-tests, 03-11-sync-orchestrator, 03-12-sync-cli, 04-baseline-service, 04-review-cli, 04-whoop-query-cache]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Repository factory shape (createXyzRepo(db: Drizzle) → XyzRepo) — established here; 9 instances; future Phase 4 baseline service consumes; Phase 4's whoop_data_quality MCP tool reads via the includeUnscored/includeExcluded escape hatches"
    - "Row → entity mapper at the boundary — exhaustive switch on score_state with defensive default branch (throws on unknown value via `never` type-narrowing) plus SCORED-with-null-fields guard; the sole place snake_case ↔ camelCase translation happens per D-28"
    - "BEGIN IMMEDIATE on every write via Drizzle's db.transaction(fn, { behavior: 'immediate' }) — applied uniformly to all 9 repos, including read-modify-write tuples (body-measurements upsertOnChange, sync-runs updatePerResource)"
    - "JSON-as-text merge for sync_runs.per_resource — read-modify-write inside one transaction; preserves prior entries so partial-failure summaries survive subsequent resource completions"
    - "Append-on-change history pattern — body-measurements compares incoming tuple against latest row inside transaction and only inserts on change; captured_at comes from injected clock so callers control timeline determinism"
    - "Symmetric opt-in escape hatches — { includeUnscored?, includeExcluded? } across the 4 scored repos so a caller that forgets the opt-in gets SCORED + non-excluded by default (D-04 + D-16 + ADR-0003 forcing function)"

key-files:
  created:
    - "src/infrastructure/db/repositories/cycles.repo.ts — canonical scored-paginated shape (cursor / upsertBatch / byRange / getRawJson + rowToCycle / cycleEntityToRow mappers)"
    - "src/infrastructure/db/repositories/recovery.repo.ts — compound-PK variant (cycle_id, sleep_id) target on ON CONFLICT; byRange JOIN-based exclusion on parent cycle's baseline_excluded; byCycleAndSleep point lookup"
    - "src/infrastructure/db/repositories/sleep.repo.ts — UUID-string id variant of cycles; includeExcluded accepted for API symmetry (Phase 4 adds cycle_id JOIN)"
    - "src/infrastructure/db/repositories/workouts.repo.ts — UUID-string id variant with sportId + 3 nullable altitude/distance fields per WHOOP v2 ScoredWorkout shape"
    - "src/infrastructure/db/repositories/profile.repo.ts — single-row replace-on-write; ON CONFLICT(user_id) DO UPDATE; fetchedAt from injected clock"
    - "src/infrastructure/db/repositories/body-measurements.repo.ts — append-on-change per D-35; tuple-equality discriminator; latest() + listAll() history readers"
    - "src/infrastructure/db/repositories/sync-runs.repo.ts — D-24 lifecycle (insertRunning + updatePerResource JSON merge + finalize + listRecent)"
    - "src/infrastructure/db/repositories/decisions.repo.ts — minimal Phase 3 stub (insert + byId + listOpen) per Open Q 2; Phase 4 owns CLI/MCP surface"
    - "src/infrastructure/db/repositories/daily-summaries.repo.ts — empty in Phase 3 per Open Q 1; ships upsertOneDay / byDateRange / latestComputedAt for Phase 4 baseline service"
    - "src/infrastructure/db/repositories/cycles.repo.test.ts — 14 assertions across cursor / idempotency / ON CONFLICT update / default + opt-in filters / getRawJson / BEGIN IMMEDIATE config-literal forcing function / rowToCycle malformed-row throws"
    - "src/infrastructure/db/repositories/recovery.repo.test.ts — 12 assertions including compound-PK idempotency, byCycleAndSleep hit/miss, JOIN-based exclusion on parent cycle's baseline_excluded"
    - "src/infrastructure/db/repositories/sync-runs.repo.test.ts — 7 assertions locking D-24 lifecycle invariants including the partial-failure JSON-merge preservation (T-03.08-03 mitigation)"
    - "src/infrastructure/db/repositories/body-measurements.repo.test.ts — 7 assertions across upsertOnChange D-35 semantics including each of weight / height / max_heart_rate change axes"
  modified: []

key-decisions:
  - "Used Drizzle's db.transaction(fn, { behavior: 'immediate' }) API for BEGIN IMMEDIATE — confirmed drizzle-orm 0.45.2's SQLiteTransactionConfig accepts 'deferred' | 'immediate' | 'exclusive' (sqlite-core/session.d.ts); cleaner than reaching into the raw better-sqlite3 handle for transaction.immediate() wrapping"
  - "Recovery byRange JOIN onto cycles for D-14 + D-16 inheritance — recoveries do NOT carry baseline_excluded on their own row per Plan 03-02 schema; sleeps + workouts accept includeExcluded as a no-op for API symmetry (Phase 4 may add cycle_id denormalization to enable the same JOIN there)"
  - "BEGIN IMMEDIATE forcing-function asserted via source-grep in cycles.repo.test.ts Test 10 — drizzle-orm's transaction config is API-level (no runtime introspection of the emitted SQL prefix in a single-connection in-memory DB); locking the literal `{ behavior: 'immediate' }` substring catches any future refactor that swaps to plain db.transaction(fn) and silently regresses to BEGIN DEFERRED"
  - "Row mapper throws on SCORED-with-null-fields as a defensive impossibility check — the column-level enum + Zod boundary at sync time should make this unreachable, but a corrupted-backup restore could escape both; throwing loudly beats silently narrowing to a malformed entity"
  - "raw_json carried through optional intersection-type field on entity → row mapper — entity types deliberately hide raw_json per D-29; the entity-to-row mapper accepts `Cycle & { rawJson?: string }` so the sync orchestrator (Plan 03-11) can attach the wire payload without changing the entity type's public shape"

patterns-established:
  - "Repository factory shape — `createXyzRepo(db: ReturnType<typeof drizzle>): XyzRepo` with named interface. Future Phase 4 services compose multiple repos through the factory pattern; bootstrap layer (Plan 03-11) wires them once."
  - "Row → entity mapper at the file boundary — sole snake_case ↔ camelCase translation site per D-28; exported privately for the unit suite, never crossed by production code outside the repo file"
  - "Symmetric opt-in escape hatches for SCORED-default repos — { includeUnscored?, includeExcluded? } with default = false; the type system + default = false combine to make a caller's forgetting the opt-in return SCORED + non-excluded, never silently include them"
  - "Defensive default branch on score_state narrowing — `default: { const unknown: never = row.score_state; throw new Error(...) }` pattern catches corrupted-row escape from the schema enum (e.g., post-restore from a hand-edited backup); applies to all 4 scored repos"

requirements-completed: [DATA-02, DATA-03, DATA-05, DATA-06, SYNC-04, SYNC-05]

# Metrics
duration: 25min
completed: 2026-05-16
---

# Phase 3 Plan 8: Repositories Summary

**9 Drizzle-backed repositories mapping snake_case rows to camelCase domain entities with default SCORED + non-excluded filters, ON CONFLICT idempotency, BEGIN IMMEDIATE writes via drizzle-orm 0.45.2, and the D-29 raw-json diagnostic seam — sync orchestrator + Phase 4 baseline service now have their boundary layer.**

## Performance

- **Duration:** ~25 min
- **Started:** 2026-05-16T21:43:08Z (resumed from Plan 03-07 completion)
- **Completed:** 2026-05-16T22:08:30Z
- **Tasks:** 2
- **Files modified:** 13 (9 source + 4 test)

## Accomplishments

- 9 repository factories under `src/infrastructure/db/repositories/` — one per Plan 03-02 table (D-01). All return camelCase domain entities; zero drizzle row-type leakage across the boundary (Gate G stays strict at 0 occurrences in `src/domain/` or `src/services/`).
- Default SCORED + non-excluded filter (D-04 + D-16 + ADR-0003) on all 4 scored repos. Symmetric opt-in escape hatches: `{includeUnscored?, includeExcluded?}`. Recovery byRange JOINs onto cycles to inherit the parent's `baseline_excluded` flag (D-14 + D-16 inheritance via cycle_id FK).
- ON CONFLICT idempotency per D-11 + Pitfall 10. Cycles / sleeps / workouts target `id`; recoveries target the compound `(cycle_id, sleep_id)` per A12. raw_json is included in the excluded-set so retroactive WHOOP updates rewrite the wire payload alongside the normalized columns.
- BEGIN IMMEDIATE writes per D-31 + Pitfall 13 via drizzle-orm 0.45.2's `db.transaction(fn, { behavior: 'immediate' })` API on all 9 repos. The body-measurements upsertOnChange read-compare-insert tuple and sync-runs updatePerResource read-modify-write merge both live inside one `BEGIN IMMEDIATE` transaction so concurrent writers cannot drop entries.
- D-24 sync_runs lifecycle landed — `insertRunning(input) → id` returns autoincrement id; `updatePerResource(id, resource, outcome)` merges into the per_resource JSON-as-text preserving prior entries (T-03.08-03 mitigation); `finalize(id, status, gapsDetected, finishedAt)` terminal transition; `listRecent(limit)` parses per_resource back into the typed `Record<ResourceName, ResourceSyncOutcome>` shape.
- D-35 body-measurements append-on-change landed — read latest row, compare `(height_meter, weight_kilogram, max_heart_rate)` tuple, insert only on change with `captured_at = opts.clock.toISOString()`.
- 40 new unit assertions across 4 representative test files (cycles, recovery, sync-runs, body-measurements) covering the 4 shape archetypes. Profile + sleep + workouts + decisions + daily-summaries source ships here; their unit-test coverage is deferred to Plan 03-10 contract tests per the plan's must_haves.scope_note.
- Full test suite: 446 / 446 (406 baseline + 40 new). Lint clean across 96 files; 7 / 7 CI grep gates green; `npx tsc --noEmit` clean for this plan's files (2 pre-existing baseline errors in `auth.ts` + `msw-whoop-oauth.ts` remain out of scope per the SCOPE BOUNDARY rule).

## Task Commits

Each task was committed atomically:

1. **Task 1: Scored-paginated repos (cycles, recovery, sleep, workouts) + 2 representative test files** — `e326078` (feat)
2. **Task 2: Auxiliary repos (profile, body-measurements, sync-runs, decisions, daily-summaries) + 2 representative test files** — `f8df494` (feat)

## Files Created/Modified

**Source files (9):**
- `src/infrastructure/db/repositories/cycles.repo.ts` — canonical scored-paginated shape; cursor / upsertBatch / byRange / getRawJson; rowToCycle + cycleEntityToRow mappers
- `src/infrastructure/db/repositories/recovery.repo.ts` — compound-PK ON CONFLICT target; byCycleAndSleep compound-key point lookup; byRange JOIN onto cycles for baseline_excluded inheritance
- `src/infrastructure/db/repositories/sleep.repo.ts` — UUID-string id variant; SCORED-only fields per WHOOP v2 ScoredSleep
- `src/infrastructure/db/repositories/workouts.repo.ts` — UUID-string id variant with sportId + nullable altitude/distance fields per WHOOP v2 ScoredWorkout
- `src/infrastructure/db/repositories/profile.repo.ts` — single-row replace-on-write; no cursor (WHOOP profile has no updated_at per A4)
- `src/infrastructure/db/repositories/body-measurements.repo.ts` — append-on-change per D-35; tuple-equality discriminator on (height_meter, weight_kilogram, max_heart_rate)
- `src/infrastructure/db/repositories/sync-runs.repo.ts` — D-24 lifecycle methods (insertRunning + updatePerResource JSON merge + finalize + listRecent)
- `src/infrastructure/db/repositories/decisions.repo.ts` — minimal Phase 3 stub (insert + byId + listOpen) per Open Q 2
- `src/infrastructure/db/repositories/daily-summaries.repo.ts` — Phase 4 baseline service write surface (upsertOneDay + byDateRange + latestComputedAt)

**Test files (4):**
- `src/infrastructure/db/repositories/cycles.repo.test.ts` — 14 assertions: cursor empty/populated, idempotency, ON CONFLICT update, default + opt-in filter axes (SCORED + baseline_excluded), getRawJson hit/miss, BEGIN IMMEDIATE config-literal grep forcing function, rowToCycle malformed-row throws (unknown score_state + SCORED-with-null-field)
- `src/infrastructure/db/repositories/recovery.repo.test.ts` — 12 assertions: cursor, compound-PK idempotency + update, distinct-sleep-id-same-cycle-id is a separate row (compound discriminator), byCycleAndSleep hit/miss, default + opt-in filters, JOIN-based exclusion on parent cycle's baseline_excluded (D-14 + D-16), getRawJson compound-key hit + two distinct miss paths
- `src/infrastructure/db/repositories/sync-runs.repo.test.ts` — 7 assertions: insertRunning returns strictly increasing numeric ids, locks initial row shape, updatePerResource merges (Test 3) and preserves prior entries (Test 4 — the partial-failure invariant T-03.08-03 in the threat model), finalize sets the terminal trio, listRecent returns DESC-ordered rows + parses per_resource back into the typed map
- `src/infrastructure/db/repositories/body-measurements.repo.test.ts` — 7 assertions: first insert returns `{inserted: true}`, identical second call returns `{inserted: false}` (load-bearing D-35), each of weight / height / max_heart_rate changes triggers insert, captured_at comes from opts.clock (not Date.now), getRawJson roundtrips stored payload

## Decisions Made

- **Used Drizzle's `db.transaction(fn, { behavior: 'immediate' })` for BEGIN IMMEDIATE** — drizzle-orm 0.45.2's `SQLiteTransactionConfig` accepts `'deferred' | 'immediate' | 'exclusive'` (confirmed in `sqlite-core/session.d.ts`). Cleaner than reaching into the raw better-sqlite3 handle's `transaction(fn).immediate()` wrapping, and matches the typed query DSL the rest of the file uses.
- **Recovery byRange JOIN onto cycles for D-14 + D-16 inheritance** — recoveries do NOT carry `baseline_excluded` on their own row per Plan 03-02 schema. Sleep + workouts repos accept `includeExcluded` as a no-op for API symmetry; Phase 4 may add a `cycle_id` denormalization on those tables to enable the same JOIN.
- **BEGIN IMMEDIATE forcing-function asserted via source-grep** — drizzle-orm's transaction config is API-level; there is no runtime introspection of the emitted SQL prefix in a single-connection in-memory DB. Locking the literal `{ behavior: 'immediate' }` substring in `cycles.repo.test.ts` Test 10 catches any future refactor that swaps to plain `db.transaction(fn)` and silently regresses to `BEGIN DEFERRED` (which Pitfall 13 explicitly bans).
- **Row mapper throws on SCORED-with-null-fields** — defensive impossibility check. The column-level enum + Zod boundary at sync time should make this unreachable, but a corrupted-backup restore could escape both. Throwing loudly beats silently narrowing to a malformed entity.
- **raw_json carried through optional intersection-type field on entity → row mapper** — entity types deliberately hide `raw_json` per D-29. The entity-to-row mapper accepts `Cycle & { rawJson?: string }` so the sync orchestrator (Plan 03-11) can attach the wire payload without changing the entity type's public shape. Defaults to `'{}'` when the caller doesn't provide one (e.g., the unit test seeding helpers).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Tone-word gate trip in `sleep.repo.ts` comments**
- **Found during:** Task 1 (after committing the 4 scored-paginated repos)
- **Issue:** `bash scripts/ci-grep-gates.sh` Gate A fired on three uses of the word "honor" / "honored" in `sleep.repo.ts` comments (CLAUDE.md §Critical Rules + ADR-0005 banned-tone-words list). The plan's must_haves and the canonical conventions call for non-hype tone; production source files are in Gate A's scope by default (only `*.test.ts` is excluded via `--exclude='*.test.ts'`).
- **Fix:** Rephrased the three occurrences to "accept" / "accepted" — same semantic, non-hype tone. Same precedent as the Plan 03-07 doc-comment-vs-plan-grep collision pattern (now 9th-time-in-a-row across Phases 2 + 3).
- **Files modified:** `src/infrastructure/db/repositories/sleep.repo.ts`
- **Verification:** `bash scripts/ci-grep-gates.sh` → "All grep gates passed." (7 / 7)
- **Committed in:** `e326078` (folded into Task 1 commit before push)

**2. [Rule 3 - Blocking] Biome `noExplicitAny` + `suppressions/unused` on `cycles.repo.test.ts` Test 11**
- **Found during:** Task 1 verification (after `npm run format` re-flowed the file)
- **Issue:** Test 11 (rowToCycle throws on unknown score_state) deliberately bypasses the schema enum to exercise the defensive default branch. Initial draft used `score_state: 'GARBAGE' as any` with a `biome-ignore` suppression. After format reflow, the suppression comment landed on the wrong source line (Biome's whitespace-sensitive suppression scope) and triggered both `lint/suspicious/noExplicitAny` and `suppressions/unused`.
- **Fix:** Replaced the `as any` cast with `as unknown as Parameters<typeof rowToCycle>[0]` — same effective type-bypass, no `any` keyword, no suppression needed. Cleaner pattern for "I know what I'm passing is malformed; let the function's input type stand."
- **Files modified:** `src/infrastructure/db/repositories/cycles.repo.test.ts`
- **Verification:** `npm run lint` exits 0; Test 11 passes (rowToCycle throws on unknown score_state).
- **Committed in:** `e326078` (folded into Task 1 commit)

**3. [Rule 3 - Blocking] Initial sync-runs.repo.ts imported `sql` and daily-summaries.repo.ts imported `eq` without using them**
- **Found during:** Task 2 verification (`npm run lint` flagged unused imports)
- **Issue:** First draft of sync-runs.repo.ts imported `sql` from drizzle-orm for a future partial-status COALESCE feature; daily-summaries.repo.ts imported `eq` for a future point-lookup. Both imports were live but unused, tripping Biome's `noUnusedImports` rule.
- **Fix:** Removed the unused imports from both files. Future plans that need them can re-add at use site.
- **Files modified:** `src/infrastructure/db/repositories/sync-runs.repo.ts`, `src/infrastructure/db/repositories/daily-summaries.repo.ts`
- **Verification:** `npm run lint` exits 0.
- **Committed in:** `f8df494` (folded into Task 2 commit)

**4. [Rule 3 - Blocking] Biome formatter applied line-width wrapping across 8 files**
- **Found during:** Both tasks (after each `npm run lint`)
- **Issue:** Initial drafts used multi-line `.where(and(eq(...), eq(...)))` constructs and short `repo.upsertBatch([row1, row2])` arrays that Biome's 100-character line-width formatter wanted on a single line. Pure formatting churn, no semantic change.
- **Fix:** Ran `npm run format` after each task; let Biome reflow. Same precedent as Plan 03-05 Rule 3 cleanup.
- **Files modified:** 8 files across both tasks (the 4 task-1 sources + 4 task-2 sources/tests)
- **Verification:** `npm run lint` exits 0 after the reflow.
- **Committed in:** `e326078` + `f8df494` (folded into the respective task commits)

---

**Total deviations:** 4 auto-fixed (1 Rule-1 bug, 3 Rule-3 blocking)
**Impact on plan:** All four are cosmetic / lint-mechanical. No semantic change to the plan's design decisions; no scope creep. The tone-word collision (#1) extends the doc-comment-vs-plan-grep precedent now at 9th-time-in-a-row across Phases 2 + 3 — recommend an `agent_docs/learnings.md` entry in a future maintenance pass, but it remains a per-plan auto-fix rather than load-bearing.

## Issues Encountered

None — all four deviations above were caught by the validation pipeline (lint / tsc / gates / test suite) before commit. Verification cycle ran cleanly within the same task once each auto-fix landed.

## D-17 + D-18 + D-34 attestation extension

No MCP tools added (D-17 attestation extends: `tools/list` still returns exactly one tool — `whoop_doctor` from Plan 01-03). `src/mcp/sanitize.ts` + `src/mcp/register.ts` byte-identical to origin/main (D-18 + D-34 attestation extends). AuthError + WhoopApiError unions FROZEN at 6 kinds each; MigrationError frozen at 2 kinds — no new error types added in this plan.

## ADR-0003 (score_state discipline) reinforcement

This plan is the first runtime enforcement site for ADR-0003. The default `byRange()` filter (`score_state = 'SCORED' AND baseline_excluded = 0`) makes the SCORED-only domain the path-of-least-resistance for callers; the opt-in escape hatches (`includeUnscored / includeExcluded`) make any consumption of PENDING_SCORE / UNSCORABLE / DST-flagged rows a deliberate, grep-able decision. Combined with the entity DU's compile-time forcing function (entities.ts lines 60-78), Pitfall 3 (silent PENDING_SCORE consumption as zero) now has both compile-time and runtime defenses. Phase 4's baseline service will read through these repos with the defaults; any "low-recovery" review output is guaranteed to be SCORED-only by construction.

## Next Phase Readiness

- All 9 repos are ready for Plan 03-09 (DST detector — consumes cycles.repo to flag DST-straddling rows) and Plan 03-10 (contract tests — exercises sleep / workouts / profile / decisions / daily-summaries through MSW fixtures + in-memory DB end-to-end).
- Plan 03-11 (sync orchestrator) can wire `createXyzRepo(db)` for all 9 repos at bootstrap; the per-resource upsertBatch + sync_runs lifecycle methods give the orchestrator everything it needs to land D-24 partial-failure semantics.
- Phase 4 baseline service will read through `byRange()` with the SCORED + non-excluded defaults; the includeUnscored / includeExcluded escape hatches are reserved for the future `whoop_data_quality` MCP resource and Phase 5 doctor probes.
- No new blockers. Existing 2 pre-existing baseline TS errors (auth.ts:97 + msw-whoop-oauth.ts:74,82) remain out of scope per the SCOPE BOUNDARY rule — same precedent as Plans 03-05 and 03-07.

## Self-Check: PASSED

**Files created (verified on disk):**
- `src/infrastructure/db/repositories/cycles.repo.ts` — FOUND
- `src/infrastructure/db/repositories/recovery.repo.ts` — FOUND
- `src/infrastructure/db/repositories/sleep.repo.ts` — FOUND
- `src/infrastructure/db/repositories/workouts.repo.ts` — FOUND
- `src/infrastructure/db/repositories/profile.repo.ts` — FOUND
- `src/infrastructure/db/repositories/body-measurements.repo.ts` — FOUND
- `src/infrastructure/db/repositories/sync-runs.repo.ts` — FOUND
- `src/infrastructure/db/repositories/decisions.repo.ts` — FOUND
- `src/infrastructure/db/repositories/daily-summaries.repo.ts` — FOUND
- `src/infrastructure/db/repositories/cycles.repo.test.ts` — FOUND
- `src/infrastructure/db/repositories/recovery.repo.test.ts` — FOUND
- `src/infrastructure/db/repositories/sync-runs.repo.test.ts` — FOUND
- `src/infrastructure/db/repositories/body-measurements.repo.test.ts` — FOUND

**Commits verified in git log:**
- `e326078` — FOUND (feat(03-08): scored-paginated repositories — cycles, recovery, sleep, workouts)
- `f8df494` — FOUND (feat(03-08): profile / body-measurements / sync-runs / decisions / daily-summaries repos)

**Acceptance criteria:**
- 9 repository source files (`ls src/infrastructure/db/repositories/*.repo.ts | wc -l`) → 9 ✓
- onConflictDoUpdate present in cycles / recovery / sleep / workouts (≥ 4) → 4 ✓
- `target: [` compound-PK marker in recovery.repo.ts → 1 ✓
- SCORED filter in cycles.repo.ts → 7 occurrences ✓
- baseline_excluded filter in cycles.repo.ts → 7 occurrences ✓
- COALESCE across the 4 scored repos (≥ 4) → 7 (3 + 2 + 1 + 1) ✓
- drizzle-orm imports inside src/infrastructure/db/repositories/ (≥ 4) → 18 ✓
- drizzle-orm leaks in src/domain/ or src/services/ → 0 ✓
- insertRunning / updatePerResource / finalize in sync-runs.repo.ts (≥ 3) → 11 ✓
- upsertOnChange in body-measurements.repo.ts → 3 ✓
- height_meter / weight_kilogram / max_heart_rate (≥ 3) → 11 ✓
- All 9 repos use `{ behavior: 'immediate' }` (D-31) → 9 / 9 ✓
- Full test suite passes → 446 / 446 (406 baseline + 40 new) ✓
- `npm run lint` exits 0 → ✓
- `bash scripts/ci-grep-gates.sh` → "All grep gates passed." (7 / 7) ✓
- `npx tsc --noEmit` clean for this plan's files (2 pre-existing baseline errors remain out of scope per SCOPE BOUNDARY rule) ✓

---

*Phase: 03-data-model-db-layer-sync-loop*
*Plan: 08-repositories*
*Completed: 2026-05-16*
