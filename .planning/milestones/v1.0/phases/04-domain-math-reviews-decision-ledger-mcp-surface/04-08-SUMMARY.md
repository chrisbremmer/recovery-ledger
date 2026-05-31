---
phase: 04-domain-math-reviews-decision-ledger-mcp-surface
plan: 08
subsystem: services
tags: [composition-root, bootstrap, dispatch, query-cache, ulid]

# Dependency graph
requires:
  - phase: 03-data-model-db-layer-sync-loop
    provides: bootstrap() composition root + all 9 Phase 3 repositories + sync_runs.latestFinished + the Bootstrapped.services interface
  - phase: 04-domain-math-reviews-decision-ledger-mcp-surface
    provides: review/daily.ts + review/weekly.ts + decision/index.ts + api-gap/index.ts (Wave 2 chassis); domain/review/types.ts (DailyReviewResult / WeeklyReviewResult); services/cache/types.ts (D-24 8-arm typed-discriminated-union); decisions.repo extensions (listAll, countSince, findByPrefix)

provides:
  - "services/cache/index.ts — queryCache(input, deps) with D-24 8-arm exhaustive dispatch + 500-row limit clamp + truncated detection via limit+1 read"
  - "Bootstrapped.services extended from 1 to 7 methods (Phase 3 runSync + 6 new Phase 4 wirings)"
  - "Services barrel re-exports every Phase 4 type contract (DailyReviewResult, WeeklyReviewResult, AddDecisionInput, ReviewDecisionsInput, ReviewDecisionsResult, QueryCacheInput, QueryCacheResult, ApiGapResult, etc.) so Wave 4 CLI/MCP shims import from a single location"
  - "createServices() factory throws for every DB-backed method (D-31 — bootstrap is the only wiring path)"
  - "bodyMeasurements.byRange(since, until) + syncRuns.byStatus(status, since, limit) — surgical repo extensions required by the cache arms"

affects: [04-09-formatters, 04-10-mcp-tools-resources-prompts, 04-11-cli-shims-flag-parsers, 04-12-phase-close]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Exhaustive-switch forcing function — dispatch on `input.resource` with a `default: const _: never` arm so adding a 9th D-24 arm fails at compile time."
    - "limit+1 read-ahead truncation detection — repo reads `limit+1` rows; orchestrator slices to `limit` and sets `truncated: true` when the repo returned more. Avoids a second COUNT(*) round-trip."
    - "Shared deps construction in bootstrap — reviewDeps / decisionDeps / cacheDeps constructed once before the return block; multiple service wirings share the same clock / ianaZone / logger instances, locking the contract at the composition root."

key-files:
  created:
    - "src/services/cache/index.ts (the queryCache orchestrator — D-24 8-arm dispatch + limit clamp + truncated semantics + PII-free Pino logging)"
    - "src/services/cache/index.test.ts (17 tests over all 8 arms + limit-clamp + Pitfall-17 logger payload)"
    - "src/services/bootstrap.test.ts (4-case smoke test asserting all 7 service slots wire through, and that createServices() throws for every DB-backed method)"
  modified:
    - "src/services/bootstrap.ts (extended Bootstrapped.services interface + return-block wiring with 6 new services + 3 dep-shape constructors)"
    - "src/services/index.ts (extended Services interface with 6 new method signatures + 9 new type re-exports; createServices factory throws for every new method)"
    - "src/infrastructure/db/repositories/body-measurements.repo.ts (new byRange method)"
    - "src/infrastructure/db/repositories/sync-runs.repo.ts (new byStatus method)"

key-decisions:
  - "limit ≤ 0 maps to default 100 (defensive treat-as-default, documented in clampLimit comment). The MCP boundary's Zod schema will reject negative numbers at the parse layer; this internal guard is belt-and-suspenders."
  - "In-memory filter for sportId / category / min-maxRecoveryScore — rather than building per-resource SQL builders. Personal-tool scale (≤ hundreds of recoveries per query window) makes the round-trip cost negligible; surface-area gain not worth it."
  - "getApiGap() routed through bootstrap() even though it has no DB dependency — keeps createServices() a single Phase 1-2 surface (doctor + auth). The factory's lightweight-no-DB invariant is load-bearing for the CLI doctor command, which must not pay DB-open cost."
  - "decisions arm dispatches on status: 'open' → existing listOpen() shortcut; any other status (or undefined) → listAll() + in-memory filter. Avoids a new repo method for the followed_up / abandoned filters which are rare paths."
  - "sync_runs.byStatus + body_measurements.byRange added as new repo methods rather than in-memory filtering — these surfaces ARE expected to grow (sync_runs becomes a Phase 5 doctor data source) so investing in proper repo methods pays off."

patterns-established:
  - "Pattern A: typed-discriminated-union dispatch table — D-24's 8 arms map 1:1 to switch cases; the discriminator narrows the input shape per arm so accessing input.sportId on a 'cycles' arm is a compile error."
  - "Pattern B: limit+1 truncation detection — the cache orchestrator reads `effectiveLimit + 1` rows from the repo, slices to `effectiveLimit`, and sets truncated=true when the repo returned more. Cheap (no second COUNT round-trip) and observable to the caller."
  - "Pattern C: PII-free structured log payload — every queryCache call logs {event, resource, count, truncated} only; decision text / row contents never appear in the Pino payload per Pitfall 17."

requirements-completed:
  - DEC-01
  - DEC-02
  - DEC-03
  - DEC-04
  - REV-01
  - REV-02
  - REV-03
  - REV-04
  - REV-05
  - REV-06
  - REV-07
  - MCP-01

# Metrics
duration: 12min
completed: 2026-05-20
---

# Phase 04 Plan 08: Composition-Root Wiring — queryCache + Bootstrapped.services Extension Summary

**Shipped `services/cache/index.ts` (whoop_query_cache D-24 8-arm dispatch with 500-row limit clamp + truncated detection) and wired all 6 Phase 4 services into Bootstrapped.services, closing Wave 2.**

## Performance

- **Duration:** ~12 min (2 tasks; TDD on Task 1, refactor on Task 2)
- **Started:** 2026-05-20T18:55:00Z (approx)
- **Completed:** 2026-05-20T19:07:00Z (approx)
- **Tasks:** 2
- **Files modified:** 6 (3 created, 3 modified)

## Accomplishments

- `services/cache/index.ts` — 215 LOC orchestrator over all 8 D-24 arms (cycles, recoveries, sleeps, workouts, profile, body_measurements, sync_runs, decisions). TypeScript exhaustive switch with `default: const _: never` guard so adding a 9th arm to `QueryCacheInput` fails at compile time. Limit clamps at 500 (D-24 hard-cap), reads `effectiveLimit + 1` rows per arm, slices to `effectiveLimit`, sets `truncated: true` when the repo returned more.
- `services/cache/index.test.ts` — 17 tests covering: cycles arm with SCORED-only default + `includeUnscored` + `includeExcluded` escape hatches; recoveries arm with min/max-recovery-score in-memory filter; sleeps with default-SCORED filter; workouts with sportId filter; profile single-row arm; body_measurements range; sync_runs status filter; decisions status + category filters; limit clamp at 500; truncation semantics at exactly N === limit; Pitfall 17 verifying decision text never appears in the logger payload.
- Bootstrap composition root extended: `Bootstrapped.services` grew from 1 method (`runSync`) to 7 methods. Three new dep shapes (`reviewDeps`, `decisionDeps`, `cacheDeps`) constructed once before the return block; each service receives its tailored slice of the repos surface.
- Services barrel (`src/services/index.ts`) extended: `Services` interface gained 6 new methods; 9 new type re-exports (`DailyReviewResult`, `WeeklyReviewResult`, `DataStatus`, `Pattern`, `SuggestedAction`, `TodayMetrics`, `WeekSummary`, `DecisionPrompt`, `AddDecisionInput`, `ReviewDecisionsInput`, `ReviewDecisionsResult`, `UpdateDecisionInput`, `QueryCacheInput`, `QueryCacheResult`, `QueryCacheResource`, `ApiGapEntry`, `ApiGapResult`). `createServices()` factory throws for every DB-backed method with a pointer to `bootstrap()` (Phase 3 D-31 discipline preserved).
- 4-case smoke test `bootstrap.test.ts`: asserts all 7 service slots are function-typed, that `getApiGap()` returns a non-empty catalog through the wired service, that `queryCache()` over an empty DB returns count=0, and that every DB-backed method on `createServices()` throws with a "requires bootstrap()" message.

## Task Commits

Each task was committed atomically:

1. **Task 1 RED — failing tests for whoop_query_cache 8-arm dispatch:** `60aed70` (test)
2. **Task 1 GREEN — implement queryCache with 8-arm dispatch + repo extensions:** `4257aa1` (feat)
3. **Task 2 — wire 6 Phase 4 services into bootstrap + Services barrel:** `631563a` (feat — includes the bootstrap.test.ts smoke test)

**Plan metadata commit:** _pending — created with this SUMMARY_

## Files Created/Modified

### Created
- `src/services/cache/index.ts` — queryCache(input, deps) orchestrator: D-24 8-arm exhaustive switch, limit clamp at 500, truncation detection via limit+1 read, in-memory filters for sportId / category / min-maxRecoveryScore, Pino-only logging per ADR-0001 with PII-free {event, resource, count, truncated} payload.
- `src/services/cache/index.test.ts` — 17 tests over all 8 arms + limit-clamp + Pitfall-17 logger payload assertion.
- `src/services/bootstrap.test.ts` — 4-case smoke test: 7 service slots present, getApiGap() functional, queryCache() empty-DB sentinel, createServices() throws for every DB-backed method.

### Modified
- `src/services/bootstrap.ts` — extended `Bootstrapped.services` interface from 1 to 7 methods; added 6 new wirings in the return block (`getDailyReview`, `getWeeklyReview`, `addDecision`, `reviewDecisions`, `queryCache`, `getApiGap`); constructed `reviewDeps` / `decisionDeps` / `cacheDeps` shapes once before the return so multiple services share the same clock / ianaZone / logger instances.
- `src/services/index.ts` — extended `Services` interface with 6 new method signatures; added 9 new type re-exports; `createServices()` throws for every DB-backed method per D-31.
- `src/infrastructure/db/repositories/body-measurements.repo.ts` — new `byRange(since, until)` method for the body_measurements cache arm (since/until optional; lexicographic ISO compare per WHOOP timestamps).
- `src/infrastructure/db/repositories/sync-runs.repo.ts` — new `byStatus(status, since, limit)` method for the sync_runs cache arm; status and since both optional; combined with AND.

## Decisions Made

See `key-decisions` in frontmatter. Notable:

- `limit ≤ 0` defensively maps to default 100 inside `clampLimit` rather than throwing. The MCP boundary's Zod schema will reject negative numbers at parse-time; this internal guard is belt-and-suspenders.
- `getApiGap()` is wired through `bootstrap()` even though it has no DB dependency — keeps `createServices()` a single Phase 1-2 surface (doctor + auth). The CLI `doctor` command must not pay DB-open cost; routing api-gap through createServices would inflate that surface.
- `sync_runs.byStatus` and `body_measurements.byRange` added as proper repo methods (not in-memory filters over `listRecent()` / `listAll()`) — these surfaces are expected to grow (sync_runs is the Phase 5 doctor data source) so investing in proper methods pays off.
- The `decisions` cache arm dispatches on `status: 'open'` → existing `listOpen()` shortcut; any other status (or undefined) → `listAll()` + in-memory filter. Avoids a new repo method for the rare followed_up / abandoned filters.

## Deviations from Plan

None substantive — plan executed as written. Two minor implementation notes:

### Auto-fixed Issues

**1. [Rule 1 - Plan-text minor] Plan said `profile.get()` but the existing method is `profile.getCurrent()`**
- **Found during:** Task 1 GREEN implementation
- **Issue:** Plan's `<action>` block referred to `repos.profile.get()` for the profile arm. The Plan 03-08 repo surface uses `getCurrent()` (Phase 3 single-row variant precedent).
- **Fix:** Used `getCurrent()` verbatim — no rename, no shim. The plan's prose was correctly pointing at "the single-row accessor" — name mismatch only.
- **Files modified:** src/services/cache/index.ts only.
- **Committed in:** 4257aa1

**2. [Rule 2 - Missing critical] Test 17 logger payload assertion required typed `QueryCacheDeps` for the spread**
- **Found during:** Post-GREEN tsc check
- **Issue:** A `const stubbed = { ...h.deps, logger: ... }` construction in Test 17 inferred too narrowly (lost the `QueryCacheDeps` type) so the subsequent `queryCache(..., stubbed)` call failed exactness. A stray `stubbed.deps;` no-op line was also left in.
- **Fix:** Added explicit `QueryCacheDeps` annotation to `stubbed`; removed the orphaned no-op.
- **Files modified:** src/services/cache/index.test.ts only.
- **Committed in:** 4257aa1 (folded into the GREEN commit since both fixes were needed for the tests to compile cleanly)

**3. [Rule 3 - Blocking] Biome organize-imports reorganized re-export order in services/index.ts + bootstrap.test.ts**
- **Found during:** `npx biome check` after Task 2
- **Issue:** Biome's `organizeImports` requires alphabetical re-export sorting (top-down) and inline `type` markers on combined imports/exports.
- **Fix:** `npx biome check --write` applied across 5 files. Pure ordering/style; zero behavior change.
- **Files modified:** src/services/index.ts, src/services/bootstrap.test.ts, src/services/cache/index.ts, src/services/cache/index.test.ts, src/infrastructure/db/repositories/sync-runs.repo.ts.
- **Committed in:** 631563a (folded into Task 2 commit)

---

**Total deviations:** 3 auto-fixed (1 Rule-1 plan-text minor, 1 Rule-2 missing critical, 1 Rule-3 Biome formatter)
**Impact on plan:** All auto-fixes within scope (each one strictly required for tsc / biome / runtime correctness). No scope creep.

## Issues Encountered

None. The plan's verbatim PATTERNS §`src/services/bootstrap.ts (EXTEND)` block + §`src/services/index.ts (EXTEND)` block were sufficient to produce both extensions on the first pass with only the deviations noted above.

## Verification Snapshot

```
$ npx tsc --noEmit
src/cli/commands/auth.ts(97,35): error TS2379 [deferred — pre-existing]
tests/helpers/msw-whoop-oauth.ts(74,32): error TS2345 [deferred — pre-existing]
tests/helpers/msw-whoop-oauth.ts(82,30): error TS2345 [deferred — pre-existing]

$ npx vitest run src/services/
Test Files  15 passed (15)
     Tests  160 passed (160)
   Duration  5.82s

$ npx vitest run    # full suite
Test Files  83 passed | 5 skipped (88)
     Tests  839 passed | 15 todo (854)
   Duration  9.34s

$ bash scripts/ci-grep-gates.sh
All grep gates passed.

$ npx biome check src/services/ src/infrastructure/db/repositories/{body-measurements,sync-runs}.repo.ts
Checked 41 files in 18ms. No fixes applied.
```

## Threat Surface Review

Plan 04-08's `<threat_model>` registers two threats — both `mitigate` disposition:

- **T-04-S4 (Information Disclosure on queryCache):** All mitigations in place:
  - (a) Typed union refuses free-form SQL at the type system — verified by the `default: const _: never` exhaustive-switch guard.
  - (b) Limit clamp at 500 — verified by Test 15.
  - (c) `includeUnscored` / `includeExcluded` explicit opt-ins; default behavior SCORED-only — verified by Tests 3, 5, 7.
  - (d) Decisions arm returns through the same repo `rowToDecision` mapper — no raw drizzle rows leak (Gate G holds).
  - (e) Profile + body_measurements have no sensitive per-row fields.

- **T-04-S1 (Tampering on the composition root):** Shared `clock` / `ianaZone` / `logger` instances locked at the bootstrap level — `reviewDeps`, `decisionDeps`, `cacheDeps` pin the contract. A future service that drifts from the shared deps stands out at code review.

No new threat-flagged surfaces introduced.

## User Setup Required

None — composition-root wiring only. No external services, no new environment variables, no dashboard configuration.

## Next Phase Readiness

Wave 2 is closed. Wave 3 (Plan 04-09 — formatters) and Wave 4 (Plans 04-10 / 04-11 — MCP + CLI surfaces) can now compose against `services/index.ts`:

```ts
import { bootstrap, type Services, type QueryCacheInput, type DailyReviewResult } from '../services/index.js';

const app = bootstrap();
const review = await app.services.getDailyReview({ date: '2026-05-20' });
const cache = await app.services.queryCache({ resource: 'decisions', status: 'open' });
```

The Phase 3 ≤5-line CLI shim precedent holds verbatim: every Wave 4 CLI command and MCP tool will call `bootstrap().services.<method>(...)` and pass the result to a formatter. No further composition work is needed before Wave 3.

## Self-Check: PASSED

- `src/services/cache/index.ts` — FOUND
- `src/services/cache/index.test.ts` — FOUND
- `src/services/bootstrap.test.ts` — FOUND
- `src/services/bootstrap.ts` — FOUND (modified)
- `src/services/index.ts` — FOUND (modified)
- Commits `60aed70` (test), `4257aa1` (feat), `631563a` (feat) — all FOUND in `git log --oneline -10`.

---
*Phase: 04-domain-math-reviews-decision-ledger-mcp-surface*
*Completed: 2026-05-20*
