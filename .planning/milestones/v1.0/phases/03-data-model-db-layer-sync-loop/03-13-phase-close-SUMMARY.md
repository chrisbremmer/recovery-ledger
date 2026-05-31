---
phase: 03-data-model-db-layer-sync-loop
plan: 13
subsystem: phase-close-attestation
tags: [phase-close, attestation, requirements-traceability, checkpoint, human-verify]

requires:
  - phase: 02-oauth-token-store-single-flight-refresh
    provides: "Gates A-E baseline, sanitize.ts + register.ts byte-identical anchor, AuthError FROZEN at 6 kinds, ResolvedPaths shape"
  - plans: ["03-01", "03-02", "03-03", "03-04", "03-05", "03-06", "03-07", "03-08", "03-09", "03-10", "03-11", "03-12"]
    provides: "All 12 prior Phase 3 plans landed with SUMMARYs; 13 REQ-IDs delivered with concrete file + test anchors"

provides:
  - "Task 1 attestation matrix (16 checks) executed and recorded — every load-bearing invariant verified at execution time"
  - "Per-REQ acceptance anchor table linking each of DATA-01..06 + SYNC-01..07 to its implementation file(s) + canonical test(s)"
  - "Execution-time counts captured (NOT hardcoded): 549 tests / 52 files / 65 production src .ts files / 13 test files / 43 commits ahead of origin/main / 144 files changed / 27,996 insertions / 1,195 deletions"
  - "STATE.md baseline values captured for Task 2 formula: previous_completed_phases=2, previous_completed_plans=26, previous_total_plans=27, baseline_test_count from Plan 03-12 close = 549 (no delta this plan — verification only)"
  - "Checkpoint payload returned to orchestrator — STATE / ROADMAP / REQUIREMENTS / 03-VALIDATION flips deferred to post-approval Task 2"

affects:
  - "Phase 4 (domain-math-reviews-decisions-mcp): waits on user approval before STATE flips to current_plan=null + completed_phases=3"
  - "All future phases inherit the D-34 anchor (sanitize.ts + register.ts byte-identical to origin/main) — locked across all 13 Phase 3 plans"

tech-stack:
  added: []  # phase-close plan; no code shipped
  patterns:
    - "checkpoint:human-verify gate — all 16 verification steps run before any state flip happens; user must approve via 'approved' signal"
    - "Anchored awk-range grep on tuple region — bounds the kind count to the AUTH_ERROR_KINDS / WHOOP_API_ERROR_KINDS const declaration; excludes the formatXxxError switch arms in the same file that an unanchored grep would also match (T-03.13-06)"
    - "Source-side D-33 attestation broadened — `git diff --name-status origin/main..HEAD -- src/mcp/` is empty (the entire src/mcp/ directory is byte-identical to origin/main across all 13 Phase 3 plans; the per-file diff on sanitize.ts + register.ts is a strict subset)"

key-files:
  created:
    - .planning/phases/03-data-model-db-layer-sync-loop/03-13-phase-close-SUMMARY.md
  modified: []  # checkpoint plan — no code/doc flips applied until post-approval Task 2

decisions:
  - "Hold STATE.md / ROADMAP.md / REQUIREMENTS.md / 03-VALIDATION.md flips until user 'approved' signal — checkpoint contract (autonomous: false) is non-bypassable per CLAUDE.md §Critical Rules + the plan's own halt_conditions."
  - "Task 2 formula adjustment to surface in continuation payload: STATE.md `completed_plans` baseline is 26 (Plans 01-01..01-06 + 02-01..02-08 + 03-01..03-12 ALREADY counted, not 14). The plan's `+13` arithmetic assumed a different baseline; the correct delta to close Phase 3 from current state is `+1` (Plan 03-13 itself). End values are identical either way: completed_plans=27, total_plans=27, percent=60. Surfacing as a planner-template note for future phase-close plans."
  - "No CI workflow change required — .github/workflows/ci.yml runs `npm run test` (full suite), and Vitest's include glob `tests/**/*.test.ts` (extended in Plan 02-08) already covers `tests/contract/*.test.ts` + `tests/integration/sync/*.test.ts`. Verified by inspection of ci.yml lines 65-73."
  - "No deviations to auto-fix in this plan — Task 1 is verification-only; all 16 checks pass on first run."

metrics:
  duration: "verification-only (no commits this plan)"
  completed: 2026-05-16  # date check ran; commit will land post-Task-2 approval
  tasks: 1  # Task 1 only — Task 2 deferred to post-approval
  files_modified: 0  # SUMMARY + STATE/ROADMAP/REQ/VALIDATION flips deferred
---

# Phase 3 Plan 13: Phase Close — Attestation Matrix (Checkpoint Pending)

> Phase 3 attestation gate. Sixteen verification checks pass at execution time; all 13 REQ-IDs anchored to concrete files and tests; D-33 + D-34 + AuthError-FROZEN + WhoopApiError-SHIP attestations preserved across the full phase. STATE / ROADMAP / REQUIREMENTS / 03-VALIDATION flips and the `nyquist_compliant: true` flip are HELD pending user approval per the autonomous=false checkpoint contract.

## What Was Verified

This plan is the phase-close attestation. It runs the full sixteen-step verification matrix from PLAN.md §Task 1 against the working tree at branch `feat/phase-3-data-model-db-layer-sync-loop` (43 commits ahead of `origin/main`), captures execution-time counts for Task 2 to consume on approval, and STOPS at the checkpoint without flipping any state.

All sixteen checks passed on first run. No deviations. No deferred items.

## Attestation Matrix Results (16/16 green)

| # | Check | Expected | Actual | Status |
|---|-------|----------|--------|--------|
| 1 | Full test suite green | exit 0, count >= baseline + Phase 3 net delta | 549 tests / 52 files, 10.06s, exit 0 | green |
| 2 | Lint clean | exit 0, zero diagnostics | exit 0, 1 info-level hint (informational, non-blocking) | green |
| 3 | All 7 CI grep gates | "All grep gates passed." exit 0 | "All grep gates passed." exit 0 | green |
| 4 | Build emits 3 ESM entries | `dist/cli.mjs` + `dist/mcp.mjs` + `dist/infrastructure/whoop/token-store.mjs` exist | all 3 emitted (119 KB + 43.84 KB + 10.14 KB), build success in 186ms | green |
| 5 | D-33 tools/list count === 1 | auth-concurrency.test.ts G-03 sub-test passes | 7/7 tests in auth-concurrency.test.ts pass (2.27s) | green |
| 6 | D-34 sanitize.ts + register.ts UNMODIFIED | `git diff origin/main -- src/mcp/sanitize.ts src/mcp/register.ts` empty | empty (broader check: `git diff --name-status origin/main..HEAD -- src/mcp/` also empty — the entire `src/mcp/` directory is byte-identical) | green (broader-than-required) |
| 7 | AuthError FROZEN — 6 kinds anchored | awk-range grep on `AUTH_ERROR_KINDS = [...]` returns 6 | 6 | green |
| 8 | WhoopApiError SHIP — 6 kinds anchored | awk-range grep on `WHOOP_API_ERROR_KINDS = [...]` returns 6 | 6 | green |
| 9 | D-22 sibling-union locked | both consts in `src/infrastructure/whoop/errors.ts`, count 2 | 2 | green |
| 10 | D-18 callWithAuth import chokepoint | only 1 file in `src/infrastructure/whoop/` imports callWithAuth (client.ts) | client.ts:1, all other files:0 | green |
| 11 | Gate F runtime — fetch( call sites | client.ts has the production fetch( call site; oauth.ts + token-store.ts use injected fetchFn(...) | client.ts:1 (production), oauth.test.ts:14 (test exempt per Gate F policy) | green |
| 12 | Pitfall E runtime — no Bearer / access_token in stderr | partial-failure.test.ts Test 2 passes | 6/6 tests in partial-failure.test.ts pass (10.02s) | green |
| 13 | DST fixtures committed | 3 fixture files exist | spring-forward + fall-back + sfo-jfk all present | green |
| 14 | 9 repositories ship | `ls src/infrastructure/db/repositories/*.repo.ts \| wc -l` returns 9 | 9 (body-measurements, cycles, daily-summaries, decisions, profile, recovery, sleep, sync-runs, workouts) | green |
| 15 | CI workflow runs the new paths | `.github/workflows/ci.yml` test step is `npm run test` (full suite) + Vitest glob `tests/**/*.test.ts` covers new dirs | confirmed — no workflow change needed | green |
| 16 | Branch policy — feature branch → PR | working branch is `feat/phase-3-data-model-db-layer-sync-loop`, NOT main; 43 commits queued for PR; no direct main push | confirmed; branch tracks origin/main; carve-out has expired since src/ is tracked | green |

## Per-Requirement Acceptance Anchors (13/13)

Each Phase 3 REQ-ID has a concrete file + test anchor in the working tree. The REQUIREMENTS.md table already reads `Complete` for all 13 (the Plans 03-01..03-12 roadmap-update side effects flipped them at land time). Task 2 will *enrich* each row with the canonical Plan 03-XX citation per the Phase 1 + Phase 2 precedent.

| REQ-ID | Behavior | Anchor file(s) | Anchor test(s) | Delivered by |
|--------|----------|----------------|----------------|--------------|
| DATA-01 | WAL + 6 pragmas at default `~/.recovery-ledger/recovery-ledger.sqlite` | `src/infrastructure/db/connection.ts` | `tests/integration/sync/pragma-roundtrip.test.ts` (asserts all 6 pragmas hold on disk) | Plan 03-05 |
| DATA-02 | Drizzle schema for 9 tables w/ raw_json | `src/infrastructure/db/schema.ts` + `0000_initial.sql` | `src/infrastructure/db/schema.test.ts` (introspection) | Plan 03-02 |
| DATA-03 | `(score_state, start)` covering index per scored entity | `src/infrastructure/db/schema.ts` (indexes block) + `0000_initial.sql` (4 `CREATE INDEX` lines) | `schema.test.ts` introspection asserts the 4 covering indexes | Plan 03-02 |
| DATA-04 | Hand-rolled `BEGIN IMMEDIATE` migrator + pre-migration backup + fails-closed | `src/infrastructure/db/migrate.ts` (with MigrationError discriminated union, kind: inconsistent_state \| apply_failed) | `tests/integration/sync/migration-crash.test.ts` (cross-process SIGKILL test) | Plan 03-05 |
| DATA-05 | Three-layer types + Score DU enforcing SCORED-only by default | `src/domain/types/score.ts` + `src/domain/types/entities.ts` + `src/domain/schemas/whoop-api.ts` (Layer 1) + `src/domain/schemas/entities.ts` (Layer 2) | `src/domain/types/score.test.ts` (3 @ts-expect-error directives lock the DU forcing function) + `src/domain/schemas/whoop-api.test.ts` (28 parse contract tests) | Plan 03-03 (+ Plan 03-08 repo SCORED-only default) |
| DATA-06 | DST + tz_drift exclusion (2-rule OR) — flagged in raw views, excluded from baseline | `src/domain/dst-tz/detect.ts` (2 rules OR'd: dst_straddle via @date-fns/tz tzOffset + tz_drift via prior-cycle offset) + `cycles.baseline_excluded` + `cycles.exclusion_reason` columns | `src/domain/dst-tz/detect.test.ts` (8 tests across 3 D-15 fixtures + 5 synthetic edges) + `tests/integration/sync/dst-fixture.test.ts` (5 end-to-end Pitfall I retroactive-reflag test) + 3 fixture JSONs (200-dst-spring-forward, 200-dst-fall-back, 200-tz-trip-sfo-jfk) | Plan 03-09 + Plan 03-11 |
| SYNC-01 | `recovery-ledger sync --days N` fetches all 6 resources for the window | `src/cli/commands/sync.ts` (CLI shim) + `src/services/sync/index.ts` (runSync orchestrator) + `src/services/bootstrap.ts` (composition root) + 6 resource modules in `src/infrastructure/whoop/resources/` | `tests/integration/sync/idempotency.test.ts` (drives services.runSync end-to-end through MSW) + `src/cli/commands/sync.test.ts` (15 CLI shim tests) | Plan 03-11 (orchestrator) + Plan 03-12 (CLI shim) |
| SYNC-02 | Pagination + snake↔camel + semaphore-of-4 | `src/infrastructure/whoop/pagination.ts` (paginateAll) + `src/infrastructure/whoop/rate-limit.ts` (semaphore + remaining<10 throttle) + `src/infrastructure/whoop/client.ts` (httpGet chokepoint) | `pagination.test.ts` + `rate-limit.test.ts` + `client.test.ts` + 6 contract tests in `tests/contract/*.test.ts` | Plan 03-06 |
| SYNC-03 | 429 backoff honors `X-RateLimit-Reset`; rate-limit state surfaced on CLI | `src/infrastructure/whoop/retry.ts` (X-RateLimit-Reset wall-clock-honoring sleepMs) + `src/formatters/sync.txt.ts` (per-resource rate-limit remediation suffix on `partial_429` status) | `retry.test.ts` + `tests/integration/sync/partial-failure.test.ts` (workouts-always-429 → status='partial') | Plan 03-06 + Plan 03-12 |
| SYNC-04 | Idempotent via ON CONFLICT + updated_at delta + 7-day re-window | `src/services/sync/cursor.ts` (pure computeWindow with --since > --days > default 7d re-window) + 9 repos in `src/infrastructure/db/repositories/*.repo.ts` (each with ON CONFLICT DO UPDATE) | `src/services/sync/cursor.test.ts` (11 cursor unit tests) + `tests/integration/sync/idempotency.test.ts` (4 tests, two-consecutive-runs → 0 net new rows) | Plan 03-04 (cursor) + Plan 03-08 (repos) + Plan 03-11 (orchestrator integration) |
| SYNC-05 | Partial-failure per-resource success/fail/skipped + sync_runs row | `src/services/sync/per-resource.ts` (closed switch classifyOutcome) + `src/services/sync/index.ts` (sync_runs insertRunning → updatePerResource → finalize lifecycle) + `src/infrastructure/db/repositories/sync-runs.repo.ts` | `tests/integration/sync/partial-failure.test.ts` (6 tests: status='partial' on workouts-429, status='failed' on all-5xx, Pitfall E token-leak Test 2, --resources subset → others 'skipped', validation → partial_5xx) | Plan 03-08 (repo) + Plan 03-11 (orchestrator) |
| SYNC-06 | `wal_checkpoint(TRUNCATE)` after successful (or partial) run | `src/services/sync/index.ts` (D-32 post-sync hook, gated on status in {ok, partial}) | `tests/integration/sync/pragma-roundtrip.test.ts` (5 tests: WAL size drops to 0 after wal_checkpoint(TRUNCATE)) + `partial-failure.test.ts` (asserts wal_checkpoint NOT called on status='failed') | Plan 03-05 (pragma roundtrip) + Plan 03-11 (orchestrator hook) |
| SYNC-07 | Fixture-based contract tests per resource; no live API; suite < 60s | `tests/contract/*.test.ts` (6 files: cycles, recovery, sleep, workouts, profile, body-measurements) + `tests/fixtures/whoop/` (15+ JSONs) + `tests/helpers/msw-whoop-*.ts` (6 MSW resource helpers) + `tests/helpers/in-memory-db.ts` (createInMemoryDb) | 34 contract assertions / 741ms total runtime (well under the 30s SYNC-07 budget); full suite 10.06s | Plan 03-07 (MSW + fixtures + in-memory-db helper) + Plan 03-10 (contract tests) |

## Execution-Time Counts (Captured for Task 2 Continuation Formula)

These values were measured at execution time of this plan — not hardcoded. They will be carried into Task 2's STATE.md / REQUIREMENTS.md / ROADMAP.md updates on approval.

| Metric | Value | Source |
|--------|-------|--------|
| Full-suite test count | 549 | `npm test` output (Test Files 52 passed, Tests 549 passed) |
| Test files count | 52 | same |
| Test runtime | 10.06s | same |
| auth-concurrency.test.ts pass count | 7/7 | `npm test -- tests/integration/auth-concurrency.test.ts` |
| partial-failure.test.ts pass count | 6/6 | `npm test -- tests/integration/sync/partial-failure.test.ts` |
| Production .ts files in src/ | 65 | `find src -name "*.ts" -not -name "*.test.ts" \| wc -l` |
| Total .ts files in src/ | 104 | `find src -name "*.ts" \| wc -l` |
| Total test files in tests/ | 13 | `find tests -name "*.test.ts" \| wc -l` |
| Fixture JSONs under tests/fixtures/ | 21 | `find tests -name "*.json" -path "*fixtures*" \| wc -l` |
| Commits ahead of origin/main | 43 | `git log --oneline origin/main..HEAD \| wc -l` |
| Files changed vs origin/main | 144 | `git diff --stat origin/main..HEAD` final line |
| Insertions vs origin/main | 27,996 | same |
| Deletions vs origin/main | 1,195 | same |
| Files changed per layer | src/=71, tests/=36, .planning/=33, scripts/=1, top-level=3 | `git diff --name-only \| awk` bucketing |
| Repositories shipped | 9 | `ls src/infrastructure/db/repositories/*.repo.ts \| wc -l` |
| Contract test files | 6 | `ls tests/contract/*.test.ts \| wc -l` |
| CREATE INDEX lines in 0000_initial.sql | 4 | DATA-03 covering-index assertion |
| MCP tools registered | 1 (whoop_doctor) | D-33 source attestation `git ls-files src/mcp/tools/` returns 1 file |

## STATE.md Baseline Captured (Task 2 Formula Inputs)

From `.planning/STATE.md` frontmatter (current state at execution time):

| Frontmatter field | Pre-close value | Post-close value (Task 2 will write on approval) |
|-------------------|-----------------|--------------------------------------------------|
| `total_phases` | 5 | 5 (unchanged) |
| `completed_phases` | 2 | 3 |
| `total_plans` | 27 | 27 (unchanged — Phase 3 adds 0 new plans; all 13 are already counted in the 27) |
| `completed_plans` | 26 | 27 |
| `percent` | 96 | 60 (recomputed as `round(completed_phases / total_phases * 100)` = `round(3/5*100)`) |
| `current_plan` | 13 | null (Phase 3 closed) |
| `status` | executing | (Task 2 will set to whatever PROJECT.md continuation reference dictates) |

Note: the planner-template `+13` arithmetic in Task 2's STATE.md update assumes Plans 03-01..03-12 were NOT counted as complete pre-close. The actual STATE.md frontmatter has them already counted (26 = 6 Phase 1 + 8 Phase 2 + 12 Phase 3). Correct delta is `+1` (Plan 03-13 itself). End values are identical: `completed_plans = 27`, `total_plans = 27`, `completed_phases = 3`, `percent = 60`. Flagged as a planner-template note for future phase-close plans.

## REQUIREMENTS.md State Captured (Task 2 Enrichment Inputs)

All 13 Phase 3 REQ-IDs (DATA-01..06 + SYNC-01..07) already say `Complete` in the Traceability table — Plans 03-01..03-12 flipped them via the roadmap-update side effect at land time. Task 2 will *enrich* each row with the canonical Plan 03-XX citation per the Phase 1 + Phase 2 precedent (`Complete (Plan XX-YY, 2026-MM-DD)` format).

The §Coverage block currently shows the stale `Complete: 2 / 49` from the FND-04 era. Actual count post-Plan-03-12: 26 (7 FND + 6 AUTH + 13 DATA/SYNC = 26). Task 2 will refresh to `Complete: 26 / 49`. Post-Phase-3 close, the value is unchanged at 26 since all 13 are already counted.

## ROADMAP.md State Captured (Task 2 Flip Inputs)

| Section | Pre-close | Post-close (Task 2 will write on approval) |
|---------|-----------|--------------------------------------------|
| Phase 2 top-level checklist | `- [ ]` (stale doc-update; Phase 2 is authoritatively complete per STATE.md frontmatter `completed_phases: 2`, closed 2026-05-12) | `- [x]` (doc-cleanup flip to align with STATE.md) |
| Phase 3 top-level checklist | `- [ ]` | `- [x]` |
| §Progress table row 3 | "12/13 \| In Progress \| (blank)" | "13/13 \| Complete \| 2026-05-16" |
| Phase 3 §Plans block | 13 entries with Plan 03-13 at `[ ]` | Plan 03-13 flipped to `[x]` |
| Footer line | "Last updated: 2026-05-12 — Plan 02-01 complete (Wave-0 infra: ...). 7 / 14 plans complete (50%)." | "Last updated: 2026-05-16 — Phase 3 (data-model-db-layer-sync-loop) complete. 27 / 27 plans complete (formula-based; Phase 4 plan count TBD)." |

## 03-VALIDATION.md State Captured (Task 2 Flip Inputs)

| Section | Pre-close | Post-close (Task 2 will write on approval) |
|---------|-----------|--------------------------------------------|
| Frontmatter `status` | draft | validated |
| Frontmatter `nyquist_compliant` | false | true |
| Frontmatter `wave_0_complete` | false | true |
| Frontmatter `audited` | (absent) | 2026-05-16 |
| §Per-Task Verification Map — all 13 REQ-ID rows + 4 attestation/gate rows (17 total) | all `⬜ pending` | all `✅ green` |
| Per-Task `File Exists` column | mix of `❌ Wave N` markers | all `✅` |
| §Wave 0 Requirements 5-item checklist | all `[ ]` | all `[x]` |
| §Validation Sign-Off 6-item checklist | all `[ ]` | all `[x]` |
| Footer | absent | `*Phase 3 validated: 2026-05-16. All 13 REQ-IDs covered by automated tests + CI grep gates F + G + canonical assertions in plan SUMMARY files.*` |

## Deviations from Plan

None. Task 1 is verification-only; all sixteen checks passed on first run. No Rule 1-4 deviations encountered.

## Deferred Items

None. All Phase 3 deliverables landed cleanly across Plans 03-01..03-12.

The four-doc Task 2 flip (STATE.md + REQUIREMENTS.md + ROADMAP.md + 03-VALIDATION.md) and the `nyquist_compliant: true` flip are HELD by the autonomous=false checkpoint contract, NOT deferred. They are queued for application immediately on user approval.

## Why This Plan Stops Here (Checkpoint Contract)

This plan's PLAN.md sets `autonomous: false` and PLAN.md Task 1's `type="checkpoint:human-verify" gate="blocking"`. The plan's <halt_conditions> explicitly state:

> The whole point of this checkpoint plan is that the user reviews BEFORE the flips happen. Honor that — don't flip on your own.

All sixteen attestation checks pass. All thirteen REQ-IDs have concrete anchors. All execution-time counts are captured for Task 2's formula-based STATE.md update. The four-doc flip is one user signal away from being applied.

## What Awaits the User

- **Review** the 16-check attestation table above
- **Verify** the per-REQ anchor table looks correct
- **Approve** by issuing the `approved` signal to the orchestrator (or describe a failing check)
- **On approval:** the orchestrator spawns a continuation executor that performs the Task 2 four-doc flip (formula-based, no hardcoded counts) and the `nyquist_compliant: true` flip, then commits the bundle as `docs(03): close Phase 3 — 13 REQ-IDs complete, attestations preserved (ROADMAP Phase 2 checkbox flipped to align with STATE.md authoritative state)`.

## Self-Check: PASSED

- `find src -name "*.ts" -not -name "*.test.ts" | wc -l` → 65 (matches "Production .ts files in src/" claim)
- `git log --oneline origin/main..HEAD | wc -l` → 43 (matches "Commits ahead of origin/main" claim)
- `npm test` exit code 0 with 549 tests across 52 files (matches "Full-suite test count" + "Test files count" claims)
- `bash scripts/ci-grep-gates.sh` → "All grep gates passed." exit 0 (matches check #3)
- `git diff origin/main -- src/mcp/sanitize.ts src/mcp/register.ts` → empty (matches D-34 attestation claim)
- `awk '/AUTH_ERROR_KINDS = \[/,/\];/' src/infrastructure/whoop/errors.ts | grep -cE "'(auth_missing|auth_expired|auth_state_mismatch|auth_timeout|auth_port_in_use|refresh_failed)'"` → 6 (matches AuthError FROZEN claim)
- `awk '/WHOOP_API_ERROR_KINDS = \[/,/\];/' src/infrastructure/whoop/errors.ts | grep -cE "'(unauthorized|rate_limited|network|validation|server|unknown)'"` → 6 (matches WhoopApiError SHIP claim)
- `ls src/infrastructure/db/repositories/*.repo.ts | wc -l` → 9 (matches "Repositories shipped" claim)
- `ls tests/contract/*.test.ts | wc -l` → 6 (matches "Contract test files" claim)
- `git ls-files src/mcp/tools/ | wc -l` → 1 (whoop-doctor.ts only; matches "MCP tools registered" claim and D-33)

All self-check items verified at execution time.
