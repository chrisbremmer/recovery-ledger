---
phase: 03-data-model-db-layer-sync-loop
plan: 09
subsystem: whoop-resources

tags: [whoop, resources, normalize, dst, pure-function, date-fns, paginate-all, score-state]

# Dependency graph
requires:
  - phase: 03-data-model-db-layer-sync-loop
    provides: "Plan 03-03 raw Zod schemas (WhoopRawCycle / WhoopRawRecovery / WhoopRawSleep / WhoopRawWorkout / WhoopRawProfile / WhoopRawBodyMeasurement) + camelCase entity DUs + closed Score discriminator; Plan 03-06 httpGet chokepoint + paginateAll<T>(fetcher, keyFn?) signature; Plan 03-07 in-memory-db helper + 15 fixture JSONs (including D-15 DST/tz fixtures) + 6 MSW helpers; Plan 03-08 repositories that consume normalized entities at upsert time"
provides:
  - "6 resource modules under src/infrastructure/whoop/resources/ — cycles, recovery, sleep, workouts (paginated), profile, body-measurements (single-shot) — each ≤ 35 LOC over httpGet + paginateAll + the normalizer"
  - "6 pure normalizers under src/domain/normalize/ — snake_case raw → camelCase domain entity with score-state narrowing per D-03 + ADR-0003; no I/O, no logger, no DB"
  - "Pure DST/tz detector src/domain/dst-tz/detect.ts — 2 OR'd rules (dst_straddle via tzOffset, tz_drift via priorCycle.timezone_offset) per D-13 + Pattern 5; consumed by normalizeCycle at upsert time per D-14; re-evaluated on every retroactive WHOOP update (Pitfall I defense)"
  - "Compound-key keyFn lands at the recovery resource (NOT in pagination.ts) — Plan 03-06's optional keyFn parameter is consumed here with `(row) => row.cycle_id + ':' + row.sleep_id` per A12 + Pitfall 10"
  - "Rolling-prior-offset walk in cycles.ts — sorts the aggregated raw records start-ascending then walks with a rolling priorOffset so normalizeCycle's tz_drift detection sees the chronologically-prior cycle within a single sync"
  - "Per-score-state branch coverage on all 4 scored normalizers — cycles + recovery via dedicated tests; sleep + workouts gain dedicated test files per checker Warning #9 so Pitfall 3 (silent PENDING_SCORE leakage) has a runtime forcing function alongside the TypeScript DU compile-time check"
affects: [03-10-contract-tests, 03-11-sync-orchestrator, 04-baseline-service]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Per-resource HTTP module shape (D-17) — `listX({since, until, ...resource-specific opts}): Promise<Entity[]>` ≤ 35 LOC over httpGet + paginateAll + normalize; 4 paginated resources (cycles, recovery, sleep, workouts) + 2 single-shot (profile, body-measurements)"
    - "Pure normalizer at the snake↔camel boundary (D-28 + Pattern C3) — z.infer<typeof WhoopRawX> → Entity (Plan 03-03 type); exhaustive switch on score_state with no default fallback (the closed Zod discriminator makes the variant set exhaustive at the type level)"
    - "DST detector signature — pure function with IANA zone passed IN (not read from `Intl` inside the function) per D-13; tzOffset() returns minutes; numeric `!==` distinguishes spring-forward (-480 → -420) from fall-back (-420 → -480)"
    - "Compound-key paginateAll usage — recovery resource passes an explicit keyFn; cycles / sleeps / workouts use the default keyFn (`String(row.id)`); pagination.ts UNMODIFIED in this plan (Plan 03-06 owns the signature)"
    - "Rolling-prior-offset in cycles resource — sort by start ASC + iterate with a rolling `priorOffset` so tz_drift detection sees the correct prior cycle within a single sync's page set; orchestrator (Plan 03-11) will seed from MAX(start) of the existing DB cycles"

key-files:
  created:
    - "src/domain/dst-tz/detect.ts — pure 2-rule OR'd exclusion detector; tzOffset from @date-fns/tz; ~20 LOC of logic + ~50 LOC of documentation"
    - "src/domain/dst-tz/detect.test.ts — 8 assertions covering all 3 D-15 fixtures (spring-forward + fall-back + SFO→JFK trip) + 5 synthetic edge cases (ordinary cycle, end=null with prior, end=null no prior, OR'd precedence, purity)"
    - "src/domain/normalize/cycles.ts — calls detectExclusion; switches exhaustively on score_state with no default branch"
    - "src/domain/normalize/recovery.ts — compound (cycleId, sleepId) PK; does NOT call detectExclusion (inherits via cycle_id FK per D-14)"
    - "src/domain/normalize/sleep.ts — preserves WHOOP v2 score.stage_summary nesting for total_in_bed/awake_time_milli; does NOT call detectExclusion (inherits via cycle FK)"
    - "src/domain/normalize/workouts.ts — sport_id coerced from `undefined | null` to `null` for the entity's non-optional `sportId: number | null` shape; nullable distance/altitude fields preserved"
    - "src/domain/normalize/profile.ts — non-scored; fetchedAt from injected clock"
    - "src/domain/normalize/body-measurements.ts — throws when raw.user_id is undefined (required by the Plan 03-08 repo); returns NormalizedBodyMeasurement (no synthetic id — repo assigns at insert)"
    - "src/domain/normalize/cycles.test.ts — 7 assertions: 3 score-state branches + DST spring-forward (D-15) + tz_drift trip (D-15 record 1) + snake-camel mapping lock + purity"
    - "src/domain/normalize/recovery.test.ts — 4 assertions: SCORED + PENDING/UNSCORABLE + compound-PK preservation + snake-camel mapping lock"
    - "src/domain/normalize/sleep.test.ts — 5 assertions: SCORED + PENDING_SCORE + UNSCORABLE branches + snake-camel mapping + UUID id preservation (per-score-state branch coverage per checker Warning #9)"
    - "src/domain/normalize/workouts.test.ts — 5 assertions: SCORED + PENDING_SCORE + UNSCORABLE branches + snake-camel mapping + UUID id + sport_id null coercion (per-score-state branch coverage per checker Warning #9)"
    - "src/infrastructure/whoop/resources/cycles.ts — listCycles({since, until, ianaZone, priorTimezoneOffset}); PAGE_SIZE = 25; sorts start-ascending; walks with rolling priorOffset for tz_drift detection"
    - "src/infrastructure/whoop/resources/recovery.ts — listRecovery({since, until}); PAGE_SIZE = 25; passes compound-key keyFn `(row) => row.cycle_id + ':' + row.sleep_id` to paginateAll explicitly"
    - "src/infrastructure/whoop/resources/sleep.ts — listSleep({since, until}); PAGE_SIZE = 25; default keyFn (UUID id)"
    - "src/infrastructure/whoop/resources/workouts.ts — listWorkouts({since, until}); PAGE_SIZE = 25; default keyFn (UUID id)"
    - "src/infrastructure/whoop/resources/profile.ts — getProfile(): single-shot httpGet against /v2/user/profile/basic; no pagination, no since/until"
    - "src/infrastructure/whoop/resources/body-measurements.ts — getBodyMeasurement(): single-shot; returns {raw, entity} so the orchestrator can JSON.stringify(raw) into the repo's rawJson parameter"
  modified: []

key-decisions:
  - "Cycles resource owns the rolling-prior-offset walk (NOT the orchestrator) — tz_drift detection needs chronologically-ordered cycles; sorting + walking happens at the boundary the moment the page records leave the HTTP layer, before the normalizer fires. Plan 03-11 only needs to seed the FIRST priorTimezoneOffset (from MAX(start) of pre-existing DB cycles); cycles.ts handles the in-page rolling chain."
  - "DST detector takes IANA zone as an input, never reads it from Intl — keeps the function pure for unit testing; the resource module (or orchestrator) is responsible for resolving Intl.DateTimeFormat().resolvedOptions().timeZone once at sync-start and threading it through."
  - "Body-measurements normalizer throws on missing user_id rather than producing a null-userId entity — raw.user_id is `.optional()` in the Zod schema for forward-compat, but the Plan 03-08 repo's upsertOnChange contract requires it. Throwing loudly at the boundary beats silently dropping the row at insert time."
  - "Body-measurements normalizer exports a private NormalizedBodyMeasurement shape (NOT the BodyMeasurement entity) — the entity has a synthetic autoincrement `id` per D-35 that the repo assigns at insert time, so the normalizer's natural output is `{ userId, heightMeter, weightKilogram, maxHeartRate, capturedAt }` — exactly the shape `upsertOnChange` accepts."
  - "Cycle normalizer switch has no default arm — TypeScript's exhaustiveness check on the closed `'SCORED' | 'PENDING_SCORE' | 'UNSCORABLE'` discriminator surfaces a missing branch as a compile error; the runtime never reaches a fallback. Matches the pattern Plan 03-03 locked in score.test.ts via @ts-expect-error directives."
  - "Per-score-state branch coverage on sleep + workouts uses synthetic PENDING/UNSCORABLE inline JSON (not new fixtures) — the Plan 03-07 200-ok.json fixtures cover SCORED only; rather than adding fixtures we never load from disk anywhere else, the test files declare the synthetic payloads as inline const objects that exercise the discriminator branches. Saves 4 fixture files and keeps the test setup self-contained."

patterns-established:
  - "Per-resource HTTP module pattern — `listX(opts)` / `getX()` ≤ 35 LOC composed of: httpGet from ../client.js, paginateAll from ../pagination.js (paginated resources), normalizeX from ../../../domain/normalize/X.js, and resource-specific Zod page-or-record schema. The module is the SOLE place each WHOOP endpoint URL is spelled in `src/` (alongside its MSW helper's URL constant)."
  - "Compound-key resource opt-in to paginateAll's keyFn parameter — when the wire-format row has no scalar `id`, the resource module passes `(row) => <compound-key-expression>` to paginateAll. Default for scalar-id resources (cycles int64, sleeps/workouts UUID-string) — no keyFn argument needed."
  - "Pure normalizer with NO `opts` for non-DST resources — recovery, sleep, workouts inherit DST/tz exclusion via cycle FK at query time (D-14), so their normalizers take only `raw` (no `priorTimezoneOffset`, no `ianaZone`). Only cycles.ts passes the DST opts."
  - "Switch on raw.score_state with no default branch — TypeScript's closed discriminator + exhaustive switch combine to make a missing branch a compile error. The 4 scored normalizers all follow this pattern."

requirements-completed: [SYNC-01, SYNC-02, SYNC-04, DATA-05, DATA-06]

# Metrics
duration: 8m 28s
completed: 2026-05-16
---

# Phase 3 Plan 9: Resources, Normalizers, DST Summary

**6 per-resource HTTP modules over httpGet + paginateAll + 6 pure normalizers + a pure DST/tz exclusion detector — Phase 3's snake_case wire format now has a clean boundary into the camelCase domain entities, with score-state narrowing enforced at the type level and DST/tz drift flagged at upsert time per D-13/D-14.**

## Performance

- **Duration:** 8m 28s
- **Started:** 2026-05-16T22:09:05Z
- **Completed:** 2026-05-16T22:17:33Z
- **Tasks:** 2
- **Files modified:** 18 (13 source + 5 test)

## Accomplishments

- **DST/tz detector** (`src/domain/dst-tz/detect.ts`) — pure function implementing D-13's two OR'd rules verbatim per Pattern 5. Rule 1 (`dst_straddle`) computes `tzOffset(ianaZone, start) !== tzOffset(ianaZone, end)` using `@date-fns/tz`; verified empirically that spring-forward goes -480 → -420 in `America/Los_Angeles` and fall-back goes -420 → -480 (numeric `!==` distinguishes them correctly). Rule 2 (`tz_drift`) compares the cycle's `timezone_offset` against the prior cycle's. Rule 1 takes precedence over Rule 2 when both fire (Pattern 5 ordering — locked in detect.test.ts Test 7). Skipped Rule 1 when `cycle.end === null` (in-progress cycle). Pure: IANA zone is passed in, not read from `Intl` inside the function — keeps the function deterministic for unit testing.
- **6 pure normalizers** (`src/domain/normalize/`) — `normalizeCycle` (calls `detectExclusion` to compute baseline_excluded), `normalizeRecovery` (no DST — inherits via cycle FK), `normalizeSleep` (preserves the WHOOP v2 `score.stage_summary` nesting for `total_in_bed_time_milli` and `total_awake_time_milli`), `normalizeWorkout` (coerces `sport_id` from `undefined | null` to `null` for the entity's non-optional `sportId: number | null` shape), `normalizeProfile` (fetchedAt from injected clock), `normalizeBodyMeasurement` (throws on missing user_id since the Plan 03-08 repo requires it; returns `NormalizedBodyMeasurement` without the synthetic id which the repo assigns at insert). All 6 normalizers are pure functions — no I/O, no logger, no DB.
- **6 per-resource HTTP modules** (`src/infrastructure/whoop/resources/`) — each ≤ 35 LOC over `httpGet` from client.js + `paginateAll` from pagination.js + the corresponding normalizer. Endpoint paths verified against the Plan 03-07 MSW helper URL constants: `/v2/cycle`, `/v2/recovery`, `/v2/activity/sleep`, `/v2/activity/workout`, `/v2/user/profile/basic`, `/v2/user/measurement/body`. All 4 paginated resources pin `PAGE_SIZE = 25` per A3 + D-19.
- **Compound-key keyFn at the recovery resource** — `paginateAll` is invoked with `(row) => row.cycle_id + ':' + row.sleep_id` as the second arg per A12 + Pitfall 10 dup-detection. The keyFn parameter was shipped in Plan 03-06; this plan consumes it. `pagination.ts` is UNMODIFIED — `git diff src/infrastructure/whoop/pagination.ts` returns empty.
- **Rolling-prior-offset walk in cycles resource** — after paginating, the resource sorts the aggregated raw records start-ascending and walks them with a rolling `priorOffset` so `normalizeCycle`'s tz_drift detection sees the chronologically-prior cycle within a single sync's page set. The orchestrator (Plan 03-11) will seed `priorTimezoneOffset` from `MAX(start)` of the pre-existing DB cycles so the rolling chain continues across syncs.
- **29 new test assertions** across 5 test files:
  - `detect.test.ts` — 8 assertions covering all 3 D-15 fixtures (`200-dst-spring-forward.json`, `200-dst-fall-back.json`, `200-tz-trip-sfo-jfk.json`) plus 5 synthetic edge cases (ordinary cycle, in-progress cycle with/without prior, OR'd precedence, purity).
  - `cycles.test.ts` — 7 assertions: 3 score-state branches + DST round-trip through the spring-forward fixture + tz_drift round-trip through the SFO→JFK record 1 + snake → camel mapping lock + purity.
  - `recovery.test.ts` — 4 assertions: SCORED + PENDING/UNSCORABLE + compound-PK preservation + snake → camel mapping (`hrv_rmssd_milli` → `hrvRmssdMilli`, `spo2_percentage` → `spo2Percentage`, etc.).
  - `sleep.test.ts` — 5 assertions: 3 score-state branches (synthetic inline PENDING + UNSCORABLE payloads, fixture-loaded SCORED) + snake → camel mapping + UUID id preservation.
  - `workouts.test.ts` — 5 assertions: 3 score-state branches + snake → camel mapping (`altitude_gain_meter`, `altitude_change_meter`, `distance_meter`) + UUID id + `sport_id: undefined` → `sportId: null` coercion.
- **Per-score-state branch coverage** (checker Warning #9 + Pitfall 3 defense) — sleep + workouts both have at least 10 occurrences of the score-state literals `'SCORED' | 'PENDING_SCORE' | 'UNSCORABLE'` across their test files. The TypeScript DU makes silent leakage a compile error; the runtime tests assert PENDING/UNSCORABLE entities have no score fields (`expect((entity as Record<string, unknown>).strain).toBeUndefined()`).
- **Gates green across all 7 CI rules + lint + tsc + tests:** `bash scripts/ci-grep-gates.sh` exits 0; `npm run lint` clean across 114 files; `npx tsc --noEmit` clean for this plan's files (2 pre-existing baseline TS errors in `auth.ts:97` + `msw-whoop-oauth.ts:74,82` remain out of scope per the SCOPE BOUNDARY rule — same 2 errors noted in 03-07 and 03-08 SUMMARYs); `npm test` → 475 / 475 passing (446 baseline + 29 new).

## Task Commits

Each task was committed atomically:

1. **Task 1: DST/tz detector + 6 normalizers + per-score-state branch tests** — `f0d296a` (feat)
   - 12 files: detect.ts + detect.test.ts + 6 normalizer source files + 4 normalizer test files.
2. **Task 2: 6 per-resource HTTP modules** — `adafc15` (feat)
   - 6 files: cycles.ts, recovery.ts, sleep.ts, workouts.ts, profile.ts, body-measurements.ts under `src/infrastructure/whoop/resources/`.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Test code shape] `as Record<string, unknown>` cast pattern rejected by strict TS**

- **Found during:** Task 1 final verification (`npx tsc --noEmit`)
- **Issue:** The test files used `(entity as Record<string, unknown>).user_id` to assert that raw snake_case field names do NOT exist on the camelCase domain entity. Under `strict: true` + `exactOptionalPropertyTypes: true`, this is a TS2352 conversion error because the entity types do not overlap with `Record<string, unknown>` (no index signature).
- **Fix:** Changed each test that uses the pattern to extract once into a local variable: `const opaque = entity as unknown as Record<string, unknown>;` then `expect(opaque.user_id).toBeUndefined()`. The `as unknown as X` double-cast explicitly signals the intent is to bypass overlap checking.
- **Files modified:** `src/domain/normalize/cycles.test.ts`, `recovery.test.ts`, `sleep.test.ts`, `workouts.test.ts` (lint + double-cast normalization).
- **Commit:** Folded into Task 1 (`f0d296a`).

**2. [Rule 3 - Blocking lint format] Biome import sort + JSON.parse layout**

- **Found during:** Task 1 + Task 2 first `npm run format` pass.
- **Issue:** Biome flagged the import order on several new files (mixed `type` and value imports needed reordering per `useImportType` + alphabetical) and the JSON.parse(readFileSync(...)) `as { records: unknown[] }` cast was on three lines when Biome wanted it collapsed to one.
- **Fix:** Ran `npm run format` to auto-apply Biome's safe fixes across 6 files (3 in Task 1, 3 in Task 2). No semantic changes — pure import-sort + line-collapse.
- **Files modified (auto):** `src/domain/normalize/cycles.ts`, `sleep.test.ts`, `workouts.test.ts`, `src/infrastructure/whoop/resources/cycles.ts`, `sleep.ts`, `body-measurements.ts`.
- **Commit:** Folded into Task 1 (`f0d296a`) and Task 2 (`adafc15`).

### Authentication gates

None — all work was offline (fixture-only tests, no live WHOOP calls per ADR-0006).

### Out-of-scope discoveries (deferred)

2 pre-existing baseline TS errors in `src/cli/commands/auth.ts:97` (`exactOptionalPropertyTypes` + `timeoutMs: number | undefined`) and `tests/helpers/msw-whoop-oauth.ts:74,82` (MSW `JsonBodyType` excludes `unknown`). Same 2 errors noted in Plan 03-07 + 03-08 SUMMARYs. Out of scope per the SCOPE BOUNDARY rule (only auto-fix issues DIRECTLY caused by this task's changes); deferred to whichever future plan touches those files.

## D-17 + D-18 + D-21 + ADR-0007 Attestation

- **D-17 (per-resource modules over shared httpGet):** 6 modules under `src/infrastructure/whoop/resources/` each composing httpGet + paginateAll + normalizer. `ls src/infrastructure/whoop/resources/*.ts | wc -l` returns 6.
- **D-18 (callWithAuth wraps inside httpGet exactly once):** `grep -rEc "import.*callWithAuth" src/infrastructure/whoop/resources/` returns 0 across all 6 files. Resource modules never reference callWithAuth directly — only httpGet, which wraps it once internally (Plan 03-06 client.ts line 71).
- **D-19 (PAGE_SIZE = 25 verified WHOOP max per A3):** 4 paginated resources pin the constant at the top of the module. Single-shot resources (profile, body-measurements) don't paginate per A4.
- **D-21 + ADR-0007 (GET-only):** No `fetch(` references in any resource module (`grep -rEc "\bfetch\s*\(" src/infrastructure/whoop/resources/` returns 0 across all 6 files). Gate F holds.
- **Gate G:** Zero `drizzle-orm/*` imports in `src/domain/` (`grep -rEn "from ['\"]drizzle-orm" src/domain/` returns empty).
- **pagination.ts UNMODIFIED:** `git diff src/infrastructure/whoop/pagination.ts` returns empty — Plan 03-06 owns the `keyFn` signature, this plan only consumes it.
- **D-33 + D-34 (no new MCP tools; sanitize.ts + register.ts unchanged):** Both files byte-identical to origin/main; `tools/list` still returns exactly one tool (`whoop_doctor`).

## Self-Check

Per-file existence:

- `src/domain/dst-tz/detect.ts` — FOUND
- `src/domain/dst-tz/detect.test.ts` — FOUND
- `src/domain/normalize/cycles.ts` — FOUND
- `src/domain/normalize/recovery.ts` — FOUND
- `src/domain/normalize/sleep.ts` — FOUND
- `src/domain/normalize/workouts.ts` — FOUND
- `src/domain/normalize/profile.ts` — FOUND
- `src/domain/normalize/body-measurements.ts` — FOUND
- `src/domain/normalize/cycles.test.ts` — FOUND
- `src/domain/normalize/recovery.test.ts` — FOUND
- `src/domain/normalize/sleep.test.ts` — FOUND
- `src/domain/normalize/workouts.test.ts` — FOUND
- `src/infrastructure/whoop/resources/cycles.ts` — FOUND
- `src/infrastructure/whoop/resources/recovery.ts` — FOUND
- `src/infrastructure/whoop/resources/sleep.ts` — FOUND
- `src/infrastructure/whoop/resources/workouts.ts` — FOUND
- `src/infrastructure/whoop/resources/profile.ts` — FOUND
- `src/infrastructure/whoop/resources/body-measurements.ts` — FOUND

Per-commit existence:

- `f0d296a` (Task 1: DST + normalizers + tests) — FOUND
- `adafc15` (Task 2: resource modules) — FOUND

## Self-Check: PASSED
