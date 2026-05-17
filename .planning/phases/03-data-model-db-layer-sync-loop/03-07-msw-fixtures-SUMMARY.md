---
phase: 03-data-model-db-layer-sync-loop
plan: 07
subsystem: testing
tags: [msw, fixtures, testing, dst, in-memory-db, sqlite, drizzle, zod]

# Dependency graph
requires:
  - phase: 02-oauth-token-store-single-flight-refresh
    provides: tests/helpers/msw-whoop-oauth.ts (Plan 02-01) — the canonical MSW helper shape mirrored here verbatim
  - phase: 03-data-model-db-layer-sync-loop (Plan 03-03)
    provides: raw Zod schemas (WhoopCyclesPageSchema, WhoopRecoveryPageSchema, WhoopSleepPageSchema, WhoopWorkoutsPageSchema, WhoopRawProfile, WhoopRawBodyMeasurement) that the fixtures parse cleanly through
  - phase: 03-data-model-db-layer-sync-loop (Plan 03-05)
    provides: src/infrastructure/db/connection.ts canonical drizzle re-export (Gate G chokepoint) + migrate() function (hand-rolled migrator) consumed by createInMemoryDb()
  - phase: 03-data-model-db-layer-sync-loop (Plan 03-02)
    provides: src/infrastructure/db/migrations/0000_initial.sql + meta/_journal.json the in-memory migrator applies
provides:
  - 6 MSW WHOOP resource helpers (cycles, recovery, sleep, workouts, profile, body-measurements) mirroring msw-whoop-oauth.ts shape
  - 15 WHOOP v2 fixture JSONs (snake_case wire format; all 13 schema-applicable fixtures parse cleanly through Plan 03-03 raw Zod schemas)
  - 3 D-15 DST/tz fixtures (Mar 8 2026 spring forward, Nov 1 2026 fall back, SFO→JFK trip with offset shift -08:00 → -05:00 → -05:00)
  - 1 in-memory-db helper (createInMemoryDb returns wired Drizzle + better-sqlite3 :memory: + migrator applied; all 9 v1 tables present)
affects:
  - 03-09-resource-modules (consumes per-resource MSW helpers in unit tests; DST detector contract tests load the dst-spring-forward / dst-fall-back / tz-trip-sfo-jfk fixtures)
  - 03-10-contract-tests (fixture → MSW intercept → resource module → in-memory DB upsert → repository read pattern)
  - 03-11-sync-integration-tests (DST integration test seeded by these fixtures; sync orchestration test uses in-memory-db helper)

# Tech tracking
tech-stack:
  added: []  # zero production deps; msw was already on disk (Plan 02-01)
  patterns:
    - "One MSW handler file per WHOOP resource — verbatim mirror of Plan 02-01 msw-whoop-oauth.ts shape (createWhoopXyzHelper returning {server, getHitCount, resetHitCount, setNextResponse, getLastRequestUrl})"
    - "Fixtures committed as JSON under tests/fixtures/whoop/<resource>/<scenario>.json — snake_case payload matching WHOOP v2 wire format; lazy per-request fixture loading lets tests edit fixtures mid-run"
    - "DST/tz fixtures use realistic UTC offsets across the boundary: spring forward -08:00→-07:00, fall back -07:00→-08:00, SFO→JFK -08:00→-05:00"
    - "One-shot override seam via setNextResponse(body, status?, headers?) — after the override fires the handler reverts to fixture-backed default; precedent: oauth helper"
    - "In-memory DB helper imports drizzle through Plan 03-05 canonical connection.ts re-export, never directly from drizzle-orm/better-sqlite3 — Gate G discipline locked at test-helper layer"

key-files:
  created:
    - tests/helpers/msw-whoop-cycles.ts
    - tests/helpers/msw-whoop-recovery.ts
    - tests/helpers/msw-whoop-sleep.ts
    - tests/helpers/msw-whoop-workouts.ts
    - tests/helpers/msw-whoop-profile.ts
    - tests/helpers/msw-whoop-body-measurements.ts
    - tests/helpers/in-memory-db.ts
    - tests/fixtures/whoop/cycles/200-ok.json
    - tests/fixtures/whoop/cycles/200-paginated-page1.json
    - tests/fixtures/whoop/cycles/200-paginated-page2.json
    - tests/fixtures/whoop/cycles/200-dst-spring-forward.json
    - tests/fixtures/whoop/cycles/200-dst-fall-back.json
    - tests/fixtures/whoop/cycles/200-tz-trip-sfo-jfk.json
    - tests/fixtures/whoop/cycles/200-mixed-score-states.json
    - tests/fixtures/whoop/cycles/429-rate-limited.json
    - tests/fixtures/whoop/cycles/500-server-error.json
    - tests/fixtures/whoop/recovery/200-ok.json
    - tests/fixtures/whoop/recovery/200-mixed-score-states.json
    - tests/fixtures/whoop/sleep/200-ok.json
    - tests/fixtures/whoop/workouts/200-ok.json
    - tests/fixtures/whoop/profile/200-ok.json
    - tests/fixtures/whoop/body-measurements/200-ok.json
  modified: []

key-decisions:
  - "Mirror msw-whoop-oauth.ts shape verbatim — every test file shares one mental model for WHOOP HTTP fakes (D-23.1 + Pattern 10)"
  - "Use http.get exclusively for all 6 helpers per D-21 + ADR-0007 (read-only WHOOP, GET-only HTTP client) — no http.post anywhere"
  - "Inject default WHOOP-realistic rate-limit headers (X-RateLimit-Remaining=95, X-RateLimit-Reset=60, X-RateLimit-Limit='requests=100, window=60') on every fixture response — required for rate-limit.ts test coverage from Plan 03-06"
  - "In-memory-db helper imports drizzle via Plan 03-05 canonical re-export from src/infrastructure/db/connection.ts — keeps Gate G strict (grep -c \"from 'drizzle-orm\" returns 0 inside tests/helpers/in-memory-db.ts)"
  - "Run real migrate() against :memory: DB — migrate() short-circuits backup step for dbFile === ':memory:' per Plan 03-05 contract line 326; pragmas applied are production-minus-WAL (memory DBs don't support WAL)"
  - "DST fixtures use 2026 calendar boundaries: Mar 8 2026 02:00 PST → 03:00 PDT spring forward; Nov 1 2026 02:00 PDT → 01:00 PST fall back; tz-trip SFO→JFK uses -08:00 → -05:00 → -05:00 (third cycle matches second so it's NOT flagged)"

patterns-established:
  - "Per-resource MSW helper file: tests/helpers/msw-whoop-<resource>.ts under one factory function createWhoopXyzHelper() returning identical surface (server, getHitCount, resetHitCount, setNextResponse, getLastRequestUrl)"
  - "Optional scenario-by-query-param seam: ?__test_scenario=<scenario-name> loads tests/fixtures/whoop/<resource>/<scenario>.json instead of default — ergonomic for pagination + DST scenarios without per-test setNextResponse calls"
  - "JsonBodyType casts at fixture-load boundary: cast JSON.parse output as JsonBodyType (from 'msw') so exactOptionalPropertyTypes=true tsconfig stays satisfied — pre-existing msw-whoop-oauth.ts pattern (out of scope to fix here) does not yet use this; new helpers do"

requirements-completed: [SYNC-07, DATA-06]

# Metrics
duration: 16min
completed: 2026-05-16
---

# Phase 3 Plan 07: MSW Fixtures Summary

**6 per-resource MSW helpers (cycles, recovery, sleep, workouts, profile, body-measurements) + 15 WHOOP v2 fixture JSONs (3 D-15 DST/tz fixtures, 2 mixed-score-state, 2 paginated, 429 + 500 error bodies, 6 happy-path) + in-memory-db helper that runs Plan 03-05's real migrator against `:memory:` — all helpers mirror Plan 02-01's msw-whoop-oauth.ts shape verbatim, ADR-0006 (fixture-only tests) preserved, Gate G chokepoint locked at the test-helper layer.**

## Performance

- **Duration:** 16 min
- **Started:** 2026-05-16T21:23:00Z (approx)
- **Completed:** 2026-05-16T21:39:20Z
- **Tasks:** 2
- **Files modified:** 22 (15 fixture JSONs + 7 TypeScript helpers)

## Accomplishments

- 15 WHOOP v2 fixture JSONs committed under `tests/fixtures/whoop/<resource>/<scenario>.json` — all 13 schema-applicable fixtures (the 429 + 500 are error bodies with no schema) parse cleanly through Plan 03-03 raw Zod schemas (WhoopCyclesPageSchema, WhoopRecoveryPageSchema, WhoopSleepPageSchema, WhoopWorkoutsPageSchema, WhoopRawProfile, WhoopRawBodyMeasurement)
- D-15 DST/tz fixtures landed: `200-dst-spring-forward.json` (cycle straddling Mar 8 2026 02:00 PST → 03:00 PDT), `200-dst-fall-back.json` (cycle straddling Nov 1 2026 02:00 PDT → 01:00 PST), `200-tz-trip-sfo-jfk.json` (3 cycles with timezone_offset shift `-08:00 → -05:00 → -05:00`) — Plan 03-09 DST detector contract tests seed here
- 6 per-resource MSW helpers + 1 in-memory-db helper, all mirroring Plan 02-01's `msw-whoop-oauth.ts` verbatim shape; all 6 helpers use `http.get` (D-21 GET-only + ADR-0007); URLs verified against WHOOP v2 docs (cycle, recovery, activity/sleep, activity/workout, user/profile/basic, user/measurement/body)
- `createInMemoryDb()` opens `:memory:` better-sqlite3, applies production pragmas (minus WAL), runs Plan 03-05's hand-rolled migrator → all 9 v1 tables present (`__drizzle_migrations`, `body_measurements`, `cycles`, `daily_summaries`, `decisions`, `profile`, `recoveries`, `sleeps`, `sync_runs`, `workouts`) with `__drizzle_migrations` ledger at exactly 1 row
- Gate G discipline preserved at the test-helper layer: `grep -c "from 'drizzle-orm" tests/helpers/in-memory-db.ts` returns 0 (the helper consumes Plan 03-05's `drizzle` canonical re-export from `src/infrastructure/db/connection.ts`)
- All 7 CI grep gates green; lint clean across 83 files; full test suite stays 406 passing (zero regressions)

## Task Commits

Each task was committed atomically:

1. **Task 1: Commit 15 WHOOP v2 fixture JSONs** — `79a5ac7` (test)
2. **Task 2: Add 6 MSW WHOOP resource helpers + in-memory-db helper** — `ba4ef44` (test)

## Files Created/Modified

### MSW resource helpers (7 .ts files)

- `tests/helpers/msw-whoop-cycles.ts` — `createWhoopCyclesHelper()`; handler at `https://api.prod.whoop.com/v2/cycle`; default fixture `cycles/200-ok.json`
- `tests/helpers/msw-whoop-recovery.ts` — `createWhoopRecoveryHelper()`; handler at `https://api.prod.whoop.com/v2/recovery`
- `tests/helpers/msw-whoop-sleep.ts` — `createWhoopSleepHelper()`; handler at `https://api.prod.whoop.com/v2/activity/sleep`
- `tests/helpers/msw-whoop-workouts.ts` — `createWhoopWorkoutsHelper()`; handler at `https://api.prod.whoop.com/v2/activity/workout`
- `tests/helpers/msw-whoop-profile.ts` — `createWhoopProfileHelper()`; handler at `https://api.prod.whoop.com/v2/user/profile/basic`
- `tests/helpers/msw-whoop-body-measurements.ts` — `createWhoopBodyMeasurementsHelper()`; handler at `https://api.prod.whoop.com/v2/user/measurement/body`
- `tests/helpers/in-memory-db.ts` — `createInMemoryDb()` returns `{db, sqlite, close}`; consumes Plan 03-05 canonical drizzle re-export; applies Plan 03-05 migrator against `:memory:`

### Fixtures (15 .json files)

#### Cycles (9 fixtures)

- `tests/fixtures/whoop/cycles/200-ok.json` — single SCORED cycle, single-page (next_token: null)
- `tests/fixtures/whoop/cycles/200-paginated-page1.json` — 3 SCORED cycles, `next_token: "abc123"`
- `tests/fixtures/whoop/cycles/200-paginated-page2.json` — 2 SCORED cycles (disjoint IDs from page 1), `next_token: null`
- `tests/fixtures/whoop/cycles/200-dst-spring-forward.json` — Mar 8 2026 02:00 PST → 03:00 PDT straddle; `timezone_offset: "-08:00"` (start offset)
- `tests/fixtures/whoop/cycles/200-dst-fall-back.json` — Nov 1 2026 02:00 PDT → 01:00 PST straddle; `timezone_offset: "-07:00"` (start offset)
- `tests/fixtures/whoop/cycles/200-tz-trip-sfo-jfk.json` — 3 consecutive cycles, offsets `-08:00 → -05:00 → -05:00`; middle cycle is `tz_drift`-flagged, third is NOT (matches prior)
- `tests/fixtures/whoop/cycles/200-mixed-score-states.json` — 1 SCORED + 1 PENDING_SCORE + 1 UNSCORABLE (Pitfall G + ADR-0003 default-filter anchor)
- `tests/fixtures/whoop/cycles/429-rate-limited.json` — error body `{"error": "rate_limit_exceeded", "message": "Too Many Requests"}`
- `tests/fixtures/whoop/cycles/500-server-error.json` — error body `{"error": "internal_server_error", "message": "Internal Server Error"}`

#### Other resources (6 fixtures)

- `tests/fixtures/whoop/recovery/200-ok.json` — single SCORED recovery keyed by `(cycle_id 12345678, sleep_id UUID)`
- `tests/fixtures/whoop/recovery/200-mixed-score-states.json` — 3 records (SCORED + PENDING_SCORE + UNSCORABLE) — Pitfall G verification anchor
- `tests/fixtures/whoop/sleep/200-ok.json` — single SCORED sleep with UUID id; `score.stage_summary.{total_in_bed_time_milli, total_awake_time_milli}` nested per Plan 03-03 schema
- `tests/fixtures/whoop/workouts/200-ok.json` — single SCORED workout with UUID id and `sport_id: 0`
- `tests/fixtures/whoop/profile/200-ok.json` — single record (NOT wrapped in `{records, next_token}` — profile is single-shot per A4)
- `tests/fixtures/whoop/body-measurements/200-ok.json` — single record (single-shot history per A4)

## Decisions Made

All decisions were locked at the plan level (D-15, D-19, D-21, D-22, D-23.1, D-30) and the 03-RESEARCH.md Pattern 10. Execution adhered to the spec; the only material call was the JsonBodyType cast pattern (see Deviation 2 below) and the doc-comment rephrase to avoid plan-grep-criterion collisions (see Deviation 1 below).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed sleep fixture nesting per Plan 03-03 raw Zod schema**

- **Found during:** Task 1 (Commit 15 fixtures) — schema-parse smoke check via `safeParse`
- **Issue:** Plan 03-07 spec for `sleep/200-ok.json` listed `total_in_bed_time_milli` + `total_awake_time_milli` at the `score` root level. But Plan 03-03's `WhoopRawSleep` schema requires those fields nested inside `score.stage_summary` (verified at `src/domain/schemas/whoop-api.ts:165-172` and `whoop-api.test.ts:117-120`). Direct fixture as planned would have failed Zod parse, breaking Plan 03-10 contract tests at the boundary.
- **Fix:** Nested `total_in_bed_time_milli` + `total_awake_time_milli` inside `score.stage_summary` to match the schema. Kept the other 4 score fields (`respiratory_rate`, `sleep_performance_percentage`, `sleep_consistency_percentage`, `sleep_efficiency_percentage`) at the score root per schema.
- **Files modified:** `tests/fixtures/whoop/sleep/200-ok.json`
- **Verification:** `safeParse(WhoopSleepPageSchema)` returns `success: true` for the corrected fixture
- **Committed in:** `79a5ac7` (Task 1 commit)

**2. [Rule 1 - Bug] Replaced invalid UUIDs with `crypto.randomUUID()` outputs**

- **Found during:** Task 1 (Commit 15 fixtures) — schema-parse smoke check via `safeParse`
- **Issue:** Plan 03-07 spec used placeholder UUIDs like `"11111111-1111-1111-1111-111111111111"` for `sleep_id` and resource `id` fields. But Zod v4.4.3's `.uuid()` validator (used in Plan 03-03 raw schemas for `WhoopRawSleep.id`, `WhoopRawWorkout.id`, `WhoopRawRecovery.sleep_id`) enforces RFC-4122 versions 1-8 with proper variant bits `[89abAB]` — the `1111-1111-1111-1111-111111111111` pattern has version `1` but invalid variant `1`. This is the **same** Rule 1 deviation Plan 03-03 documented in STATE.md ("Zod v4.4.3 .uuid() rejects arbitrary near-zero patterns — substituted real crypto.randomUUID() outputs as inline literals").
- **Fix:** Substituted 6 placeholder UUIDs with real `crypto.randomUUID()` outputs across `recovery/200-ok.json` (sleep_id), `recovery/200-mixed-score-states.json` (3 sleep_ids), `sleep/200-ok.json` (id), `workouts/200-ok.json` (id).
- **Files modified:** `tests/fixtures/whoop/recovery/200-ok.json`, `tests/fixtures/whoop/recovery/200-mixed-score-states.json`, `tests/fixtures/whoop/sleep/200-ok.json`, `tests/fixtures/whoop/workouts/200-ok.json`
- **Verification:** All 13 schema-applicable fixtures parse cleanly through Plan 03-03 raw Zod schemas (`safeParse(...).success === true`)
- **Committed in:** `79a5ac7` (Task 1 commit)

**3. [Rule 3 - Blocking] Used `JsonBodyType` cast + `headers?: ... | undefined` for `exactOptionalPropertyTypes` strictness**

- **Found during:** Task 2 (Write helpers) — `npx tsc --noEmit` after first draft
- **Issue:** With `exactOptionalPropertyTypes: true` in `tsconfig.json` + the project's `strict: true` posture, `HttpResponse.json(parsed)` rejected `unknown`-typed payloads (MSW's `JsonBodyType` excludes `unknown`), and the `NextResponse.headers?: Record<string, string>` field couldn't accept `undefined` (the optional-but-present-with-undefined-value issue). Pre-existing `msw-whoop-oauth.ts` has the same TS errors (line 74, 82) but is unchanged and out of scope here (Rule 1-3 scope boundary).
- **Fix:** Imported `JsonBodyType` from `'msw'`, typed `NextResponse.body` as `JsonBodyType`, cast `JSON.parse(raw)` to `JsonBodyType` at the fixture-load boundary, made `headers?: Record<string, string> | undefined` to honor `exactOptionalPropertyTypes`. Applied identically across all 6 helpers.
- **Files modified:** all 6 `tests/helpers/msw-whoop-<resource>.ts`
- **Verification:** `npx tsc --noEmit` shows zero errors in the 6 new helpers; the 3 remaining baseline TS errors (`auth.ts:97`, `msw-whoop-oauth.ts:74, 82`) are pre-existing and out of scope per the SCOPE BOUNDARY rule. Logged below in "Deferred Issues."
- **Committed in:** `ba4ef44` (Task 2 commit)

**4. [Rule 1 - Bug] Rephrased doc-comment in `in-memory-db.ts` to avoid plan-grep-criterion collision**

- **Found during:** Task 2 — acceptance criterion check `grep -c "from 'drizzle-orm" tests/helpers/in-memory-db.ts` expected `0`
- **Issue:** A doc-comment in `in-memory-db.ts` originally read: `// Gate G forbids \`from 'drizzle-orm'\` outside src/infrastructure/db/`. This is correct prose but it triggered the plan's load-bearing grep check that asserts no drizzle-orm import path appears in the file. **This is the 8th occurrence of the same plan-grep-criterion collision precedent** noted in STATE.md and Plans 02-01 / 02-02 / 02-04 / 02-06 / 03-01 / 03-04 / 03-03 / 03-05.
- **Fix:** Rephrased the comment to `// Gate G forbids importing the drizzle-orm package outside \`src/infrastructure/db/\`` — same semantic meaning, no literal `from 'drizzle-orm` string in the file.
- **Files modified:** `tests/helpers/in-memory-db.ts`
- **Verification:** `grep -c "from 'drizzle-orm" tests/helpers/in-memory-db.ts` returns 0; the `import { drizzle } from '../../src/infrastructure/db/connection.js';` line is the only drizzle-relevant import and matches the Plan 03-05 canonical re-export pattern
- **Committed in:** `ba4ef44` (Task 2 commit, same task as deviation 3)

---

**Total deviations:** 4 auto-fixed (2 Rule-1 plan-text bugs, 1 Rule-3 blocking TS, 1 Rule-1 doc-comment plan-grep collision)
**Impact on plan:** All 4 auto-fixes were necessary for correctness:
- Deviations 1 + 2 were plan-text fixture bugs that would have broken Plan 03-10 contract tests at the Zod parse boundary
- Deviation 3 was a blocking TS error in new code I authored
- Deviation 4 was a self-defeating doc-comment that violated the plan's own acceptance criterion

No scope creep — all 4 fixes operated within the files this plan creates.

## Deferred Issues

Pre-existing baseline TS errors NOT addressed in this plan (SCOPE BOUNDARY — only fix issues DIRECTLY caused by this plan's changes):

- `src/cli/commands/auth.ts:97` — `RunOAuthOptions` `exactOptionalPropertyTypes` mismatch (Plan 02-03/02-05 territory)
- `tests/helpers/msw-whoop-oauth.ts:74, 82` — `unknown → JsonBodyType` on Phase 2's oauth helper (Plan 02-01 territory; same fix pattern as deviation 3 above but applying it would mutate a frozen Phase 2 file)

These were present at the baseline `npx tsc --noEmit` run BEFORE this plan started (verified by temporarily removing my new helpers and re-running). They flow through `vitest`'s permissive tsx transformer at test time so the full suite stays 406 passing.

Recommend a Phase 3 cleanup pass at plan close or a `chore(03-cleanup):` follow-up to apply the same `JsonBodyType` cast pattern to `msw-whoop-oauth.ts` and add `| undefined` to `RunOAuthOptions.timeoutMs` and `RunOAuthOptions.openBrowser` — but neither is load-bearing for Phase 3 outcomes.

## Issues Encountered

None beyond the 4 auto-fixed deviations above. Both tasks landed in one pass after the deviation fixes.

## User Setup Required

None — no external service configuration required.

## Threat Flags

None — no new security-relevant surface introduced. Per the plan's `<threat_model>`:
- T-03.07-01 (test-server leakage) — mitigated; each helper instance creates its own SetupServer; conventions.md §Testing already enforces vitest `pool: 'forks'` worker isolation
- T-03.07-02 (fake-token in fixture) — accepted; fixtures use intentionally fake values (`user_id: 100001`, `cycle id: 12345678`, real-shaped but disposable UUIDs)
- T-03.07-03 (migrator reads migrations dir) — accepted; migrations are public artifacts
- T-03.07-04 (Gate G regression) — mitigated; `grep -c "from 'drizzle-orm" tests/helpers/in-memory-db.ts === 0` acceptance criterion holds; helper consumes Plan 03-05 canonical re-export

## Next Phase Readiness

- **Plan 03-08 (DST/tz detector — Wave 3c):** Can consume `tests/fixtures/whoop/cycles/200-dst-spring-forward.json`, `200-dst-fall-back.json`, `200-tz-trip-sfo-jfk.json` to unit-test the `dst_straddle` + `tz_drift` detection sub-rules from D-13. The fixtures are calibrated against `@date-fns/tz`'s `tzOffset('America/Los_Angeles', date)` returning `-480` (PST) pre-Mar-8 / `-420` (PDT) post-Mar-8.
- **Plan 03-09 (resource modules — Wave 4a):** Per-resource module unit tests can pin their `httpGet` calls against the per-resource MSW helper. Each helper's `setNextResponse(body, 429, {'X-RateLimit-Reset': '3'})` exercise path is the canonical 429 retry test seed.
- **Plan 03-10 (contract tests — Wave 5):** Each contract test composes the per-resource MSW helper + `createInMemoryDb()` + the resource module — the fixture flows through MSW → resource module → upsert → repository read in one pass.
- **Plan 03-11 (sync integration — Wave 6):** `tests/integration/sync/dst-fixture.test.ts` will consume the DST fixtures directly; `tests/integration/sync/idempotency.test.ts` will consume the paginated fixtures to exercise `paginateAll` against multi-page WHOOP responses.

D-17 + D-18 + D-34 attestation extends — no MCP tools added, `sanitize.ts` + `register.ts` byte-identical to origin/main. `AuthError` + `WhoopApiError` unions FROZEN at 6 kinds each. `MigrationError` (sibling union from Plan 03-05) unchanged. All 7 CI grep gates green; Gate G chokepoint preserved (zero `drizzle-orm` imports outside `src/infrastructure/db/`).

## Self-Check: PASSED

### Created files exist
- FOUND: tests/helpers/msw-whoop-cycles.ts
- FOUND: tests/helpers/msw-whoop-recovery.ts
- FOUND: tests/helpers/msw-whoop-sleep.ts
- FOUND: tests/helpers/msw-whoop-workouts.ts
- FOUND: tests/helpers/msw-whoop-profile.ts
- FOUND: tests/helpers/msw-whoop-body-measurements.ts
- FOUND: tests/helpers/in-memory-db.ts
- FOUND: tests/fixtures/whoop/cycles/200-ok.json + 8 sibling cycles fixtures
- FOUND: tests/fixtures/whoop/recovery/200-ok.json + 200-mixed-score-states.json
- FOUND: tests/fixtures/whoop/sleep/200-ok.json
- FOUND: tests/fixtures/whoop/workouts/200-ok.json
- FOUND: tests/fixtures/whoop/profile/200-ok.json
- FOUND: tests/fixtures/whoop/body-measurements/200-ok.json

### Commits exist
- FOUND: 79a5ac7 (test(03-07): commit 15 WHOOP v2 fixture JSONs)
- FOUND: ba4ef44 (test(03-07): add 6 MSW WHOOP resource helpers + in-memory-db helper)

---
*Phase: 03-data-model-db-layer-sync-loop*
*Completed: 2026-05-16*
