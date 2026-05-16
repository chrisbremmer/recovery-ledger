---
phase: 03-data-model-db-layer-sync-loop
plan: 10
subsystem: testing
tags: [contract-tests, msw, fixtures, score-state, idempotency, pitfall-g, pitfall-h, sync-07]

# Dependency graph
requires:
  - phase: 03-data-model-db-layer-sync-loop (Wave 3)
    provides: 6 MSW helpers + 15 fixture JSONs (Plan 03-07) + in-memory-db helper
  - phase: 03-data-model-db-layer-sync-loop (Wave 4a)
    provides: 9 scored-and-non-scored repositories (Plan 03-08)
  - phase: 03-data-model-db-layer-sync-loop (Wave 4b)
    provides: DST detector + 6 normalizers + 6 per-resource HTTP modules (Plan 03-09)
provides:
  - 6 fixture-based contract tests under tests/contract/<resource>.test.ts
  - SYNC-07 verification anchor: end-to-end pipeline coverage for every WHOOP resource
  - Pitfall G verification anchor (recovery 200-mixed-score-states + compound-PK dedup)
  - Pitfall H verification anchor (cycles DST/tz exclusion + PENDING_SCORE survival)
  - D-04 SCORED-only default-filter assertion per scored resource
  - D-11 / SYNC-04 idempotency assertion per resource
  - D-35 append-on-change assertion (body-measurements)
  - DU narrowing forcing-function locks via @ts-expect-error (recovery + workouts)
affects: [Phase 04 review-loop — contract tests verify the data path the review service consumes]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Contract test shape: MSW listen{onUnhandledRequest:'error'} → resource module → normalize → repo upsert → repo read"
    - "vi.mock of refresh-orchestrator with fixed test token bypasses the keychain (mirrors client.test.ts Plan 03-06 pattern)"
    - "FK-aware seeding: recovery contract tests insert parent cycles via createCyclesRepo before recovery upsert"
    - "Compound-key dup detection: synthetic 2-page MSW response repeats the same (cycle_id, sleep_id) tuple"
    - "DU narrowing lock: @ts-expect-error on PENDING_SCORE.<scoreField> compile-time defense"

key-files:
  created:
    - tests/contract/cycles.test.ts
    - tests/contract/recovery.test.ts
    - tests/contract/sleep.test.ts
    - tests/contract/workouts.test.ts
    - tests/contract/profile.test.ts
    - tests/contract/body-measurements.test.ts
  modified: []

key-decisions:
  - "Mirror client.test.ts vi.mock pattern: mock refresh-orchestrator.js with a passthrough fake so the contract test exercises the HTTP boundary without OS keychain side effects."
  - "Use _resetForTest from rate-limit.ts in beforeEach so the semaphore state does not bleed across tests in the same file."
  - "Pitfall G recovery test is the only file that needs FK seeding (recoveries.cycle_id REFERENCES cycles(id) ON DELETE no action); helper seedParentCycles(mem, ids) keeps the test prose focused on the recovery surface."
  - "Pitfall H is exercised by THREE cycles fixtures (200-dst-spring-forward, 200-dst-fall-back, 200-tz-trip-sfo-jfk) plus 200-mixed-score-states for the PENDING_SCORE/UNSCORABLE survival path; the cycles updated_at field is non-null in every fixture (the schema rejects null updated_at), so the Pitfall H anchor is about score-state diversity surviving the pipeline, not literal null timestamps."
  - "Test 6 + Test 7 (cycles pagination) bypass the helper's single setNextResponse seam in favor of an inline MSW handler with a hits counter so two-page sequences are deterministic. The helper's hit-count seam is still used for the simpler happy-path/idempotency cases."

patterns-established:
  - "Pattern (Plan 03-10 §1): each contract test file vi.mocks ../../src/services/refresh-orchestrator.js BEFORE the dynamic imports of the resource module so the production callWithAuth never reaches into tokenStore."
  - "Pattern (Plan 03-10 §2): beforeAll(listen)/afterAll(close) for the MSW server; beforeEach(resetRateLimit + helper.resetHitCount + helper.server.resetHandlers + createInMemoryDb); afterEach(mem.close)."
  - "Pattern (Plan 03-10 §3): MSW listen options always include onUnhandledRequest:'error' so an accidental live WHOOP call fails the test loudly (ADR-0006 enforcement)."

requirements-completed: [SYNC-07, DATA-05, DATA-06]

# Metrics
duration: 7min
completed: 2026-05-16
---

# Phase 3 Plan 10: Contract Tests Summary

**6 fixture-based contract tests anchor SYNC-07 + Pitfall G + Pitfall H end-to-end — every WHOOP resource has one canonical test driving MSW → resource module → normalize → repo upsert → repo read, 34 assertions in under one second.**

## Performance

- **Duration:** approximately 7 minutes
- **Tasks:** 2 of 2 completed
- **Files created:** 6
- **Tests added:** 34 (project total: 475 → 509)
- **Contract suite runtime:** 741ms (well under the 30s SYNC-07 budget)

## Accomplishments

- Land the SYNC-07 verification anchor: every WHOOP resource (cycles, recovery, sleep, workouts, profile, body-measurements) has a fixture-based end-to-end contract test.
- Pitfall G anchor (recovery): the 200-mixed-score-states fixture upserts 3 rows through the compound-key path; default byRange returns SCORED only (1 row); includeUnscored returns all 3; byCycleAndSleep returns the PENDING_SCORE entity narrowed to its three-field shape; @ts-expect-error on PENDING_SCORE.recoveryScore locks the DU forcing function at compile time.
- Pitfall H anchor (cycles): 200-dst-spring-forward + 200-dst-fall-back both flag baselineExcluded=true with exclusionReason='dst_straddle'; 200-tz-trip-sfo-jfk fires tz_drift on the offset transition record only; the SCORED/PENDING_SCORE/UNSCORABLE diversity in 200-mixed-score-states survives the full pipeline without crashing.
- D-04 SCORED-only default-filter assertion on every scored resource (cycles, recovery, sleep, workouts).
- D-11 + SYNC-04 idempotency assertion on every resource — second fetch + upsert leaves the row count unchanged.
- D-35 append-on-change assertion: body-measurements inserts on first sync, no-ops on identical second sync, inserts again when weight changes; latest() reflects the new value; captured_at comes from the injected clock.
- Pitfall 10 dup-key detection for both scalar-id (cycles) and compound-key (recovery) paths.

## Task Commits

1. **Task 1: Cycles + Recovery contract tests (Pitfall G + Pitfall H anchors)** — `7095482` (test)
2. **Task 2: Sleep + Workouts + Profile + Body-Measurements contract tests** — `9de039a` (test)

## Files Created

- `tests/contract/cycles.test.ts` (316 lines, 9 tests) — happy path + idempotency + 3 DST fixtures + tz_drift fixture + 2-page pagination concat + Pitfall-10 dup-key throw + mixed-score-states D-04 filter + getRawJson.
- `tests/contract/recovery.test.ts` (281 lines, 5 tests) — happy path with compound-key seed + idempotency + Pitfall G 200-mixed-score-states + compound-key dup detection + getRawJson(cycleId, sleepId).
- `tests/contract/sleep.test.ts` (159 lines, 5 tests) — happy path + idempotency + D-04 SCORED-only filter + UUID-string id shape + getRawJson.
- `tests/contract/workouts.test.ts` (191 lines, 6 tests) — happy path + idempotency + D-04 filter + UUID shape + getRawJson + DU narrowing @ts-expect-error on PENDING_SCORE.strain.
- `tests/contract/profile.test.ts` (136 lines, 4 tests) — single-shot getProfile + upsert + getCurrent round-trip + ON CONFLICT(user_id) idempotency + getRawJson(userId).
- `tests/contract/body-measurements.test.ts` (204 lines, 5 tests) — first-insert + D-35 append-on-change idempotency + weight-change inserts + latest() reflects newest weight + captured_at from injected clock.

## Decisions Made

- **Mock refresh-orchestrator, not the entire HTTP stack.** Mirrors `src/infrastructure/whoop/client.test.ts` so the contract test still exercises `httpGet` + `paginateAll` + `withRetry` + the rate-limit semaphore against MSW. Replacing the whole stack would have shadowed real bugs in the wave-3 chokepoint.
- **Seed parent cycles before recovery upserts.** Schema enforces FK `recoveries.cycle_id REFERENCES cycles(id)`. The 200-mixed-score-states recovery fixture uses cycle_ids 40001/40002/40003 — the test helper `seedParentCycles` inserts SCORED placeholder cycles for each id before the recovery upsert fires.
- **DST/tz fixtures use `setNextResponse(loadFixture(...))` rather than the `__test_scenario` query param.** Either path works; `setNextResponse` keeps the test prose simpler and closer to the cycles.test.ts canonical shape.
- **Pagination tests bypass the helper's setNextResponse seam.** The helper queues one one-shot override; multi-page sequences need two distinct fixture responses in order, so Tests 6 and 7 install a fresh MSW handler with a hits counter inline.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 — TS-blocking] HttpResponse.json(unknown) typecheck failure on synthetic page1 response**
- **Found during:** Task 1 (cycles contract Test 7 — dup-key detection)
- **Issue:** `loadFixture('200-paginated-page1')` returns `unknown`, but `HttpResponse.json` requires `JsonBodyType`. Test 6 had already addressed this by casting through `Record<string, unknown>`; Test 7 was missing the same cast.
- **Fix:** Added `as Record<string, unknown>` cast to the single offending line.
- **Files modified:** `tests/contract/cycles.test.ts`
- **Verification:** `npx tsc --noEmit 2>&1 | grep "tests/contract"` returns 0 lines.
- **Committed in:** `7095482` (Task 1 commit)

**2. [Rule 3 — Biome formatter] Long type-assertion expression line wrapping + import-sort reordering**
- **Found during:** Tasks 1 + 2
- **Issue:** Biome's formatter re-wraps long `.map((r) => ({ ...r, rawJson: payload }) as Recovery & { rawJson: string })` expressions across multiple lines. Initial layout was a single line that exceeded Biome's printWidth.
- **Fix:** Ran `npm run format -- tests/contract/` between writes. Biome auto-fixed 3 files in Task 2 + 0 in Task 1 (after the first round of fixes).
- **Files modified:** all 6 contract test files (formatting only)
- **Verification:** `npm run lint -- tests/contract/` returns clean.
- **Committed in:** included in both task commits.

**3. [Rule 1 — out-of-scope baseline] 3 pre-existing TS errors flagged but not fixed**
- **Found during:** typecheck verification
- **Issue:** `tsc --noEmit` reports 3 pre-existing errors: `src/cli/commands/auth.ts:97` (exactOptionalPropertyTypes), `tests/helpers/msw-whoop-oauth.ts:74` + `82` (`unknown` not assignable to `JsonBodyType`).
- **Fix:** Per SCOPE BOUNDARY rule, leave them in place — they predate Plan 03-10 and were documented in Plan 03-07 and 03-09 summaries as out of scope.
- **Files modified:** none.
- **Verification:** the error count is unchanged from Plan 03-09 close (3 → 3).
- **Deferred items log:** continues from prior plans.

## Acceptance Criteria Status

- [x] 6 contract test files under tests/contract/ — `ls tests/contract/*.test.ts | wc -l` returns 6.
- [x] At least 9 assertions in cycles.test.ts — 9 tests pass.
- [x] At least 5 assertions in recovery.test.ts — 5 tests pass.
- [x] Combined cycles + recovery runtime under 12s — 617ms locally.
- [x] cycles.test.ts Test 3 passes: 200-dst-spring-forward → `baselineExcluded=true` + `exclusionReason='dst_straddle'`.
- [x] recovery.test.ts Test 3 passes: default byRange returns SCORED only (1 row); includeUnscored returns 3.
- [x] `grep -c "200-mixed-score-states" tests/contract/recovery.test.ts` returns 3 (anchor cited).
- [x] `grep -c "200-dst-spring-forward" tests/contract/cycles.test.ts` returns 3 (anchor cited).
- [x] `grep -c "ts-expect-error" tests/contract/recovery.test.ts` returns 2 (DU forcing function lock present).
- [x] `grep -c "ts-expect-error" tests/contract/workouts.test.ts` returns 3 (DU forcing function lock present).
- [x] Total assertion count ≥ 30 — 34 across the 6 files.
- [x] Full contract suite runtime < 30 seconds — 741ms.
- [x] Each contract test file sets `onUnhandledRequest:'error'` — verified by grep on all 6 files.
- [x] body-measurements.test.ts Test 2 passes — D-35 append-on-change idempotency.
- [x] workouts.test.ts Test 6 passes — DU discriminator narrowing locked via `@ts-expect-error`.
- [x] `bash scripts/ci-grep-gates.sh` exits 0 — all 7 gates green.
- [x] `grep -rE "from ['\"]drizzle-orm" tests/contract/` returns 0 lines (Gate G discipline at the test layer).
- [x] `npm run test` 509 tests passing (baseline 475 + 34 new contract assertions).
- [x] `npm run lint` clean.
- [x] No live WHOOP calls — ADR-0006 satisfied (MSW `onUnhandledRequest:'error'` plus the `tests/setup/no-live-whoop.ts` setupFile guard).

## D-17 / D-18 / D-34 Attestation Continued

- D-17 (zero new MCP tools): no MCP files modified in this plan; `tools/list` continues to return exactly `whoop_doctor`.
- D-18 (`sanitize.ts` + `register.ts` unchanged): byte-identical to origin/main.
- D-34 (no new sanitizer redaction patterns): no error carriers introduced; the contract tests deliberately throw `WhoopApiError({kind: 'validation'})` only, which the existing Phase 2 sanitizer already covers.

## Known Stubs

None — the contract test suite is the SYNC-07 verification anchor and adds no new production stubs.

## Self-Check: PASSED

- [x] `tests/contract/cycles.test.ts` exists.
- [x] `tests/contract/recovery.test.ts` exists.
- [x] `tests/contract/sleep.test.ts` exists.
- [x] `tests/contract/workouts.test.ts` exists.
- [x] `tests/contract/profile.test.ts` exists.
- [x] `tests/contract/body-measurements.test.ts` exists.
- [x] Commit `7095482` exists in `git log --oneline`.
- [x] Commit `9de039a` exists in `git log --oneline`.
- [x] All 34 contract assertions pass.
- [x] All 7 CI grep gates pass.
- [x] No regressions in the 475 pre-existing tests.
