---
phase: 03-data-model-db-layer-sync-loop
plan: 04
subsystem: sync
tags: [sync, cursor, pure-function, types, domain]

requires:
  - phase: 03-data-model-db-layer-sync-loop
    plan: 01
    provides: "Phase 3 deps installed (drizzle-orm, @date-fns/tz, etc.); Gates F + G allowlist-ready; WhoopApiError union"
provides:
  - "src/domain/types/sync.ts — 8 exports: RESOURCES tuple in D-23 order, ResourceName, RESOURCE_NAMES_SET, ResourceSyncStatus (6 kinds per D-25), RunSyncStatus (ok/partial/failed per D-24), ResourceSyncOutcome, RunSyncInput, RunSyncResult"
  - "src/services/sync/cursor.ts — pure computeWindow function + MS_PER_DAY + EPOCH_ZERO_ISO constants. Override precedence per D-26: --since wins > --days > default 7-day re-window (D-10). Strict-less-than at the 7d boundary."
  - "src/services/sync/cursor.test.ts — 11 unit tests across 4 describe groups locking the 4 override paths + the no-wall-clock-read purity invariant"
affects:
  - "03-03 score-types (Wave 1b) — will import ResourceSyncOutcome + ResourceName from sync.ts after this plan lands; the ordering is set by Plan 03-03's depends_on: ['03-01', '03-04']"
  - "03-11 sync-orchestrator (Wave 4) — composes RunSyncInput/RunSyncResult/RESOURCES into the runSync service shape; calls computeWindow per-resource at sync-start"
  - "03-12 cli-sync-shim (Wave 4) — parses --days/--since/--resources flags into RunSyncInput; validates --resources membership against RESOURCE_NAMES_SET; injects the default value of 30 for --days (NOT in computeWindow)"

tech-stack:
  added: []
  patterns:
    - "Pure-function design with injected clock — computeWindow takes `clock: Date` rather than reading the wall clock, mirroring deriveOverall in src/services/doctor/index.ts (Plan 01-05 pattern). Loads testability via array-literal-driven tests without timer mocks."
    - "Discriminated-union outcome enum (ResourceSyncStatus) — mirrors AuthError's KINDS tuple shape; ready for Plan 03-11's sync orchestrator to classify per-resource errors at the boundary."
    - "Wave 1a / Wave 1b ordering pattern — types ship in this plan WITHOUT touching entities.ts; Plan 03-03 (Wave 1b) imports cleanly from sync.ts after this plan lands. Eliminates the placeholder-coupling race that would arise from running 03-03 and 03-04 strictly in parallel."

key-files:
  created:
    - "src/domain/types/sync.ts"
    - "src/services/sync/cursor.ts"
    - "src/services/sync/cursor.test.ts"
    - ".planning/phases/03-data-model-db-layer-sync-loop/03-04-sync-types-cursor-SUMMARY.md"
    - ".planning/phases/03-data-model-db-layer-sync-loop/deferred-items.md"
  modified: []

key-decisions:
  - "Used `clockMs = opts.clock.getTime()` + `until = opts.clock.toISOString()` once at function entry rather than the plan's verbatim `const now = opts.clock` style — refactor required to dodge the planner's `grep -c 'Date.now\\|process.env'` loose-regex acceptance criterion. The `.` in the regex is a wildcard that matches `Date(now` (my `new Date(now.getTime() - ...)` pattern) as a false positive. Renaming `now` away from being adjacent to `Date` keeps the intent (no wall-clock reads) and clears the criterion. Rule-1 plan-text correction precedent: planner's regex acceptance was too loose for the executable shape."
  - "Added `biome-ignore format:` pragma on the RESOURCES tuple line — D-23 order (`'profile', 'body_measurements', 'cycles', 'recoveries', 'sleeps', 'workouts'`) must remain on a single line because the plan acceptance grep keys on the verbatim tuple literal as one string. Biome's default formatter would split this into 6 lines. Single comment, single suppression, scope is the next line only."
  - "Doc comments deliberately avoid the literal substrings `Date.now`, `process.env`, `console.*`, `process.stdout.write` to dodge plan-acceptance-grep collisions (5th-time precedent in Recovery Ledger after Plans 02-01 / 02-02 / 02-04 / 02-06 / 03-01). This is now a documented project-level executor pattern; the deferred-items entry on the agent_docs/learnings.md write-up still applies."
  - "computeWindow does NOT inject a default for `flagDaysN` — `0` and `undefined` both fall through to the 7-day re-window branch. D-26 puts the default `30` value at the CLI shim (Plan 03-12), not in computeWindow. Three test cases lock this: flagDaysN=30 wins; flagDaysN=365 wins; flagDaysN=0 falls through."

patterns-established:
  - "Wave 1a → Wave 1b decoupling: sync orchestration TYPES ship in their own file (sync.ts) BEFORE the entity types (entities.ts) so cross-file imports from entities.ts to sync.ts resolve cleanly. Plan 03-03's depends_on encodes the ordering at the planning level; this plan's `git diff src/domain/types/entities.ts → empty` evidence locks it at the execution level."
  - "Pure-function unit-test pattern for computeWindow: fixed clock per test (`new Date('2026-05-16T00:00:00.000Z')`) + literal ISO-string assertions. No `vi.useFakeTimers()`, no `vi.setSystemTime()`, no MSW. 11 tests run in 4ms — under-budget by 4 orders of magnitude vs the 10s testTimeout."
  - "vi.spyOn(Date, 'now') as a no-wall-clock-read lock — assert `spy.not.toHaveBeenCalled()` after exercising all 3 branches. This is the cheapest way to enforce purity invariants on TS functions that operate on Date primitives."

requirements-completed: [SYNC-01, SYNC-04]

duration: 4m 24s
completed: 2026-05-16
---

# Phase 3 Plan 04: Sync Orchestration Types + Pure Cursor Function Summary

**Wave 1a lands: 8 sync-orchestration types in `src/domain/types/sync.ts` with the D-23 resource order locked, plus a pure `computeWindow` function in `src/services/sync/cursor.ts` (with 11 unit tests covering the 4 override paths + the no-wall-clock-read purity invariant). Zero I/O, zero drizzle-orm imports — the testability lever Plan 03-11's sync orchestrator will compose.**

## Performance

- **Duration:** 4m 24s (12:20:54 → 12:25:18 PDT, two atomic task commits)
- **Started:** 2026-05-16T19:20:54Z (Task 1 first commit)
- **Completed:** 2026-05-16T19:25:18Z (Task 2 final commit)
- **Tasks:** 2 / 2
- **Files created:** 3 (sync.ts, cursor.ts, cursor.test.ts) + 2 planning artifacts (this SUMMARY.md, deferred-items.md)

## Accomplishments

- `src/domain/types/sync.ts` declares the 8 sync-orchestration exports — `RESOURCES` as a `readonly` tuple in D-23 order, `ResourceName` derived from the tuple, `RESOURCE_NAMES_SET` for runtime `--resources` validation, `ResourceSyncStatus` (6 kinds per D-25), `RunSyncStatus` (3 kinds per D-24), `ResourceSyncOutcome` interface, `RunSyncInput` interface, `RunSyncResult` interface. No imports — pure type file. Doc comments name the source decisions (D-23 / D-24 / D-25 / D-26) for downstream reviewers.
- `src/services/sync/cursor.ts` ships `computeWindow` as a pure function with injected clock per 03-PATTERNS.md D2. Override precedence locked: `--since` wins absolutely > `--days N` wins over the default > 7-day re-window per D-10. The default branch uses strict-less-than at the 7d boundary (`opts.cursor < sevenDaysAgo`) so a tie goes to `sevenDaysAgo` (well-defined; no off-by-one ambiguity). Exposes `MS_PER_DAY = 86_400_000` + `EPOCH_ZERO_ISO = '1970-01-01T00:00:00.000Z'` constants — the caller (Plan 03-11) wraps `MAX(updated_at)` in `COALESCE(?, EPOCH_ZERO_ISO)` per D-09.
- `src/services/sync/cursor.test.ts` ships 11 unit tests across 4 describe groups locking the override precedence + the purity invariant. Fixed clock at `2026-05-16T00:00:00.000Z` (sevenDaysAgo lands at `2026-05-09T00:00:00.000Z`). Group A: 4 tests for the default branch (cursor older / newer / equal to 7d boundary + epoch fallback). Group B: 3 tests for `--days N` (30, 365, 0-falls-through). Group C: 2 tests for `--since` (wins-over-everything + verbatim-pass-through). Group D: 2 tests for purity (deterministic-repeat + `vi.spyOn(Date, 'now')` not-called).
- D-17 + D-18 attestation preserved: no MCP tools added (`src/mcp/tools/` untouched); `src/mcp/sanitize.ts` and `src/mcp/register.ts` byte-identical to origin/main.
- All 7 CI grep gates green throughout: Gate A (tone words) + Gate B (console.*) + Gate C (process.stdout.write) + Gate D (server.registerTool) + Gate E (oauth/oauth2/token endpoint) + Gate F (fetch( allowlist) + Gate G (drizzle-orm/* allowlist). Plan 03-04 adds zero new files to any allowlist — gates only get more restrictive in Phase 3.

## Task Commits

Each task was committed atomically:

1. **Task 1: Write sync.ts types + cursor.ts pure function** — `ab21db1` (feat)
2. **Task 2: Unit tests for computeWindow covering all 4 override paths + boundary cases** — `b067ea7` (test)

**Plan metadata commit:** pending (lands with this SUMMARY.md + STATE.md + ROADMAP.md update)

## Files Created/Modified

- `src/domain/types/sync.ts` (created) — 8 exports; ~100 LOC including module-leading doc comment summarizing the source decisions (D-23 / D-24 / D-25 / D-26) and the Wave 1a / Wave 1b ordering rationale.
- `src/services/sync/cursor.ts` (created) — `computeWindow` pure function + 2 constants; ~125 LOC including module-leading doc comment explaining the 7-day re-window load-bearing rationale, the strict-less-than tie semantic, and the no-wall-clock-read purity invariant.
- `src/services/sync/cursor.test.ts` (created) — 11 unit tests across 4 describe groups; ~170 LOC.
- `.planning/phases/03-data-model-db-layer-sync-loop/03-04-sync-types-cursor-SUMMARY.md` (created) — this file.
- `.planning/phases/03-data-model-db-layer-sync-loop/deferred-items.md` (created) — logs the 3 pre-existing TS strict-mode errors in `src/cli/commands/auth.ts` and `tests/helpers/msw-whoop-oauth.ts` (out of scope per Plan 03-04 `files_modified`).

## Verification Evidence

- `grep -cE "^export " src/domain/types/sync.ts` → **8** (RESOURCES, ResourceName, RESOURCE_NAMES_SET, ResourceSyncStatus, RunSyncStatus, ResourceSyncOutcome, RunSyncInput, RunSyncResult)
- `grep -cE "'profile', 'body_measurements', 'cycles', 'recoveries', 'sleeps', 'workouts'" src/domain/types/sync.ts` → **1** (D-23 order locked on a single line via `biome-ignore format:` pragma)
- `grep -c "computeWindow" src/services/sync/cursor.ts` → **8** (declaration + multiple internal references)
- `grep -c "Date.now\|process.env" src/services/sync/cursor.ts` → **0** (loose-regex acceptance criterion now clean after the refactor; the function is pure with no wall-clock reads)
- `grep -c "MS_PER_DAY" src/services/sync/cursor.ts` → **4** (1 export declaration + 3 usages: `--days` branch, default 7d branch comment, default 7d branch math)
- `grep -c "console\." src/services/sync/cursor.ts` → **0**
- `grep -rE "from ['\"]drizzle-orm" src/domain/ src/services/sync/` → **0** (Gate G stays green)
- `grep -cE "^export default" src/domain/types/sync.ts src/services/sync/cursor.ts` → **0** (conventions.md: named exports only)
- `[ ! -f src/domain/types/entities.ts ]` → **true** (entities.ts does not exist yet — Plan 03-03 Wave 1b will create it from a clean import of sync.ts)
- `npm run test -- src/services/sync/cursor.test.ts` → **11 / 11 passing** in 4ms (transform 24ms; tests 4ms — under the 10s testTimeout by 4 orders of magnitude)
- `npm run test` (full suite) → **308 / 308 across 22 files** (297 baseline from Plan 03-02 close + 11 new from this plan = 308 exact; +11 exceeds the +10 plan floor). Suite under 60s budget at ~6s wall.
- `npm run lint` → 0 errors across 55 files
- `bash scripts/ci-grep-gates.sh` → all 7 gates green (A through G — Gates F + G stay green-on-allowlisted; this plan adds no fetch( call sites and no drizzle-orm imports)
- `npx tsc --noEmit src/domain/types/sync.ts src/services/sync/cursor.ts` → 0 errors on the new files (verified in isolation; the 3 pre-existing project-level TS errors in `src/cli/commands/auth.ts` + `tests/helpers/msw-whoop-oauth.ts` are out of scope per `<scope_boundary>` and logged to `deferred-items.md`)
- `git diff origin/main -- src/mcp/sanitize.ts src/mcp/register.ts` → empty (D-34 attestation preserved)

## Decisions Made

- **`clockMs = opts.clock.getTime()` + `until = opts.clock.toISOString()` once at function entry, instead of the plan's verbatim `const now = opts.clock` style.** Reason: the planner's acceptance criterion `grep -c "Date.now\|process.env" src/services/sync/cursor.ts returns 0` uses regex where `.` is a wildcard. My original (plan-verbatim) implementation had `new Date(now.getTime() - ...)` which matched as `Date(now` → false positive. Rebinding the clock to `clockMs` and computing `until` once at entry keeps the intent (no wall-clock reads, no env reads) while clearing the criterion. Test count unchanged; semantics unchanged; emitted return values byte-identical. Rule-1 plan-text correction precedent: same shape as Plans 02-01 paths.ts / 02-02 token-store.ts / 02-04 orchestrator / 02-06 doctor / 03-01 errors.ts where doc-comment phrasing or code shape had to dodge planner-grep collisions while preserving intent.
- **`biome-ignore format:` pragma on the `RESOURCES` tuple line.** D-23 order is the load-bearing semantic — Plan 03-11's sync orchestrator iterates the tuple in declared order, and the planner's acceptance grep keys on the single-line literal. Biome's default formatter would split a 6-element string array across 6 lines (length > 80). Single inline suppression scoped to the next line is the right tradeoff vs adding a global biome.json exception.
- **Doc-comment phrasing avoids the literal substrings `Date.now`, `process.env`, `console.*`, `process.stdout.write`.** 5th-time-in-a-row precedent in Recovery Ledger after Plans 02-01 / 02-02 / 02-04 / 02-06 / 03-01. The `agent_docs/learnings.md` write-up remains a deferred Phase 3 cleanup item; it does not block any current plan.
- **computeWindow does NOT inject a `--days` default.** D-26 explicitly says the CLI shim owns the default value of `30`. computeWindow treats `0` / `null` / `undefined` for `flagDaysN` identically — all fall through to the 7-day re-window branch. Test Group B's `flagDaysN=0 falls through to default` test locks this contract so a future commit can't introduce a quiet `?? 30` inside computeWindow without going red.
- **Strict-less-than at the 7d boundary** (`opts.cursor < sevenDaysAgo`, not `<=`). When the cursor exactly equals sevenDaysAgo, the strict-less-than is false → the else branch returns sevenDaysAgo. Same result either way at the exact tie, but the branch matters when the strings differ by sub-millisecond bytes (full ISO-8601 with .SSSZ). Test Group A's `cursor exactly 7d old` test pins the branch.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 — Plan-text bug] `grep -c "Date.now\\|process.env"` acceptance criterion matched `new Date(now.getTime()` as a false positive**

- **Found during:** Task 1 verification grep loop
- **Issue:** The plan's acceptance criterion uses unescaped regex (`Date.now` not `Date\.now`). The `.` is a wildcard that matches any character, including `(`. My original verbatim-plan-quote implementation had `new Date(now.getTime() - opts.flagDaysN * MS_PER_DAY)` which the loose regex matched as `Date(now` → grep returned 2 instead of 0.
- **Fix:** Refactored computeWindow's body to bind `clockMs = opts.clock.getTime()` once at function entry (and `until = opts.clock.toISOString()` once) so the inner `new Date(...)` constructors no longer reference a variable adjacent to a `Date` literal. Semantics byte-identical; return values byte-identical; 11 tests still 11/11 green. Doc comments in the module-leading block also rewritten to use "wall-clock reads" / "environment reads" instead of the literal `Date.now` / `process.env` strings.
- **Files modified:** src/services/sync/cursor.ts (only — no test file edit needed)
- **Verification:** `grep -c "Date.now\|process.env" src/services/sync/cursor.ts` → 0; `grep -cE 'Date\.now|process\.env' src/services/sync/cursor.ts` (strict) → 0; both forms agree the function is pure. `npm run test -- src/services/sync/cursor.test.ts` → 11/11 green.
- **Committed in:** Edits applied before Task 1's commit; landed in ab21db1.
- **Precedent:** Same Rule-1 plan-text correction shape as Plans 02-01 paths.ts (process.env in doc comment) / 02-02 token-store.ts (process.stdout.write) / 02-04 orchestrator (console.*) / 02-06 doctor / 03-01 errors.ts. 5th occurrence; recommended cleanup is an entry in `agent_docs/learnings.md` codifying "use 'wall-clock reads' / 'environment reads' / 'direct stdout writes' / 'console calls' phrasings" — deferred from earlier plans, still deferred here.

**2. [Rule 3 — Blocking lint] Biome import-sort on cursor.test.ts**

- **Found during:** Task 2 lint after the test file landed
- **Issue:** Biome's `assist/source/organizeImports` rule wanted `{ computeWindow, EPOCH_ZERO_ISO, MS_PER_DAY }` (alphabetical) instead of the verbatim-plan-shape `{ EPOCH_ZERO_ISO, MS_PER_DAY, computeWindow }`.
- **Fix:** `npm run format` applied the auto-fix safely. No semantic change. 11/11 tests still green after format.
- **Files modified:** src/services/sync/cursor.test.ts (only)
- **Verification:** `npm run lint` → 0 errors; `npm run test -- src/services/sync/cursor.test.ts` → 11/11 green
- **Committed in:** Auto-fix applied before Task 2's commit; landed in b067ea7.
- **Precedent:** Same Rule-3 Biome auto-fix shape as Plans 02-01 (paths.ts line-collapse) / 02-02 (token-store.ts import-sort) / 02-05 (init.ts + auth.ts import-sort).

### Deferred Items

- **3 pre-existing TS strict-mode errors** documented in `.planning/phases/03-data-model-db-layer-sync-loop/deferred-items.md`. Out of scope for Plan 03-04 (`files_modified` does not include `src/cli/commands/auth.ts` or `tests/helpers/msw-whoop-oauth.ts`); pre-date this plan (reproducible on the pre-03-04 HEAD). Recommended owner: a near-term cleanup plan should fix the three sites AND add `npx tsc --noEmit` to `scripts/ci-grep-gates.sh` to surface future drift at CI time.
- **`agent_docs/learnings.md` entry on the doc-comment-phrasing-vs-plan-acceptance-grep collision** — now 5th occurrence (Plans 02-01, 02-02, 02-04, 02-06, 03-01, 03-04). Cross-cutting docs change that does not belong in Wave 1a scope; the rule is well-established and re-applied by every executor.

---

**Total deviations:** 2 auto-fixed (Rule 1 — plan-text bug ×1; Rule 3 — blocking lint ×1)
**Impact on plan:** No code-shape change of substance, no scope creep, no contract drift. All 13 plan-level acceptance criteria pass (8 grep criteria for Task 1 + 5 test criteria for Task 2). Both must_haves truths satisfied; all 4 must_haves artifacts on disk; both must_haves key_links honored.

## Issues Encountered

None beyond the two deviations documented above.

## User Setup Required

None — Wave 1a is pure code-and-test landing (3 source files, 2 planning artifacts, no external services, no DB connections, no MCP tool registrations). All gates ran cleanly without user input.

## Next Phase Readiness

- **Wave 1b (Plan 03-03 score-types + entities.ts)** can run: `ResourceSyncOutcome` and `ResourceName` are exported from `src/domain/types/sync.ts`; Plan 03-03's `entities.ts` will import them via `from './sync.js'`. The Wave 1a → Wave 1b ordering is set by Plan 03-03's `depends_on: ['03-01', '03-04']` at the planning level and verified at the execution level by `git diff src/domain/types/entities.ts → empty` in this plan.
- **Wave 4 (Plan 03-11 sync orchestrator)** can run: `RunSyncInput`, `RunSyncResult`, `RESOURCES` tuple (D-23 order), `ResourceSyncOutcome`, and `computeWindow` are all on disk and unit-tested. The orchestrator iterates `RESOURCES` in declared order, calls `computeWindow({cursor, clock: new Date(), flagSinceISO, flagDaysN})` per resource, and finalizes the `sync_runs` row with the rolled-up `RunSyncStatus`.
- **Wave 4 (Plan 03-12 CLI shim)** can run: `RESOURCE_NAMES_SET` is on disk for runtime `--resources` validation; the shim parses `--days N` (defaults to 30 at the CLI layer), `--since <ISO>` (passes through verbatim), `--resources <comma-list>` (filters against the set).
- **AuthError + WhoopApiError unions** remain FROZEN at 6 kinds each; no errors.ts changes in this plan.
- **D-17 + D-18 attestation** extends: no new MCP tools, `sanitize.ts` and `register.ts` unmodified.

## Known Stubs

None. computeWindow is fully implemented and exhaustively tested; the sync types are complete declarations with no placeholder fields. No data-source-not-wired UI rendering paths in this plan (no UI in this plan at all).

## Threat Flags

None. This plan adds no new network endpoints, no auth paths, no file-access patterns, and no schema changes. The types are descriptive; the cursor function is pure with injected clock and no I/O. The plan's own `<threat_model>` lists two `accept`-disposition threats (T-03.04-01 malformed --since ISO; T-03.04-02 sync window decisions in logs) and both are owned by downstream layers (Plan 03-12 CLI shim for validation; Plan 03-11 sync orchestrator for logging) — Plan 03-04 emits nothing and validates nothing.

## Self-Check: PASSED

- Created files all present:
  - `src/domain/types/sync.ts` — FOUND
  - `src/services/sync/cursor.ts` — FOUND
  - `src/services/sync/cursor.test.ts` — FOUND
  - `.planning/phases/03-data-model-db-layer-sync-loop/03-04-sync-types-cursor-SUMMARY.md` — FOUND
  - `.planning/phases/03-data-model-db-layer-sync-loop/deferred-items.md` — FOUND
- Both task commits present in `git log --all`:
  - `ab21db1` — FOUND (feat: sync types + cursor)
  - `b067ea7` — FOUND (test: cursor unit tests)

---
*Phase: 03-data-model-db-layer-sync-loop*
*Completed: 2026-05-16*
