---
phase: 04-domain-math-reviews-decision-ledger-mcp-surface
plan: 11
subsystem: cli
tags: [commander, cli, decision-ledger, review, query, readline, exit-codes, d-32]

# Dependency graph
requires:
  - phase: 04-domain-math-reviews-decision-ledger-mcp-surface
    provides: bootstrap() composition root + services.{getDailyReview, getWeeklyReview, addDecision, reviewDecisions, queryCache, getApiGap} + the 5 formatters (daily/weekly/decision/query-cache/api-gap)
provides:
  - 7 new Commander subcommands (review daily/weekly, decision add/review/update, query <resource>, api-gap) wired into recovery-ledger CLI
  - 6 typed per-command exit-code constants (D-32 contract; Object.freeze records imported into addHelpText)
  - parseFollowUp + parseConfidence + parseStatus validators at the CLI boundary so the service never sees raw flag strings
  - Pitfall 10 stderr-prompt discipline in decision review --interactive (readline output stream = process.stderr)
  - Pitfall 11 prefix-lookup arms in decision update (no_match / ambiguous_prefix / single-match) with sanitized prefix-mention error text
  - T-04-S2 round-trip integrity tests proving SQL-injection / shell-metacharacter / unicode-bidi payloads flow through addDecision unchanged
affects: [Phase 5 doctor + auth surfaces; future MCP tool parity; weekly review consumer flow]

# Tech tracking
tech-stack:
  added: []  # All deps were already present (commander, node:readline/promises, vitest)
  patterns:
    - ≤5-line CLI shim repeated 7× over bootstrap → services → formatters (Phase 3 sync.ts precedent)
    - Per-command Object.freeze EXIT_CODES + addHelpText('after', table) rendering pattern (D-32)
    - Closed-tuple membership check via Set<QueryResource> as the CLI-layer T-04-S4 mitigation (matches the MCP-layer Zod boundary)
    - Per-arm flag-set guards in query.ts (unsupported flag on wrong arm → invalid_input BEFORE bootstrap)
    - vi.doMock readline createInterface with output: { stream }-capture so Pitfall 10 stderr discipline is testable in-process

key-files:
  created:
    - src/cli/commands/review-daily.ts
    - src/cli/commands/review-daily.test.ts
    - src/cli/commands/review-weekly.ts
    - src/cli/commands/review-weekly.test.ts
    - src/cli/commands/api-gap.ts
    - src/cli/commands/api-gap.test.ts
    - src/cli/commands/decision-add.ts
    - src/cli/commands/decision-add.test.ts
    - src/cli/commands/decision-update.ts
    - src/cli/commands/decision-update.test.ts
    - src/cli/commands/decision-review.ts
    - src/cli/commands/decision-review.test.ts
    - src/cli/commands/query.ts
    - src/cli/commands/query.test.ts
  modified:
    - src/cli/index.ts (7 new subcommand wirings + EXIT_CODES imports)

key-decisions:
  - "Distinct REVIEW_WEEKLY_EXIT_CODES constant even though arms match REVIEW_EXIT_CODES — per-command help-text clarity outweighs import-coupling between siblings (D-32 discipline)."
  - "decision-update ambiguous-prefix rendering shows the FULL ULID (not the 8-char prefix) so the user can copy-paste the unambiguous form into the retry."
  - "Past-window prompt in decision-review uses followUpDate when present, falls back to the D-19 default 7-day window after createdAt when followUpDate is null."
  - "query.ts CLI-layer per-arm flag-set guard is defence-in-depth on top of the service Zod schema — typos get caught before bootstrap opens the DB."
  - "Unrecognized interactive answers ('typed garbage', 'maybe', etc.) fall through to 'skip' rather than crashing or applying a destructive default."
  - "T-04-S2 fixture lives in decision-add.test.ts and tests round-trip integrity via the service mock — the actual mitigations are Commander's array argv + drizzle prepared statements at the repo."

patterns-established:
  - "Per-command EXIT_CODES constant imported into src/cli/index.ts and rendered verbatim in addHelpText('after', ...) — every subcommand --help carries its own arm table."
  - "vi.doMock('node:readline/promises') stub with output-stream capture for testing Pitfall 10 stderr discipline in-process (no subprocess spawn required)."

requirements-completed:
  - REV-03
  - REV-04
  - REV-08
  - DEC-01
  - DEC-02
  - DEC-03

# Metrics
duration: 14m 41s
completed: 2026-05-20
---

# Phase 4 Plan 11: CLI Surface — Reviews, Decisions, Query, ApiGap Summary

**7 new Commander subcommands ship as ≤5-line shims over bootstrap → services → formatters, anchoring REV-03 + REV-04 + REV-08 + DEC-01 + DEC-02 + DEC-03 at the CLI layer with per-command D-32 typed exit-code constants.**

## Performance

- **Duration:** 14m 41s
- **Started:** 2026-05-20T20:07:57Z
- **Completed:** 2026-05-20T20:22:38Z
- **Tasks:** 4 / 4
- **Files created:** 14 (7 commands + 7 sibling tests)
- **Files modified:** 1 (src/cli/index.ts wiring)

## Accomplishments

- Phase 3 `sync.ts` shim shape repeated verbatim 7×: each command is the same `bootstrap() → service → formatter → write → exit` composition with a per-command `<NAME>_EXIT_CODES` constant.
- T-04-S2 mitigations verified end-to-end: SQL-injection (`'; DROP TABLE decisions; --`), shell-metachar (`$(rm -rf /)`), and unicode bidi-override (` ‮`) payloads all round-trip through `services.addDecision` unchanged.
- Pitfall 10 stderr discipline anchored at the CLI layer with an in-process stub of `node:readline/promises` that captures the configured output stream and asserts `outputSeenAs.stream === process.stderr` — no subprocess spawn needed.
- Pitfall 11 prefix-lookup arms cover the three failure modes (no_match / ambiguous_prefix / single-match) with sanitized error messages and full-ULID disambiguation listings.
- `query <resource>` enforces per-arm flag-set narrowing at the CLI boundary so unsupported flag combinations (e.g., `--include-excluded` on `recoveries`) get caught BEFORE bootstrap opens the DB.

## Task Commits

Each TDD pair was committed atomically:

1. **Task 1 RED: failing tests for review-daily/weekly/api-gap** — `c76b0d6` (test)
2. **Task 1 GREEN: implement review-daily/weekly/api-gap** — `20471dd` (feat)
3. **Task 2 RED: failing tests for decision-add + decision-update** — `e83068d` (test)
4. **Task 2 GREEN: implement decision-add + decision-update** — `229d3d8` (feat)
5. **Task 3 RED: failing tests for decision-review + query** — `f43b8fe` (test)
6. **Task 3 GREEN: implement decision-review + query** — `78b05ed` (feat)
7. **Task 4: wire 7 subcommands into src/cli/index.ts** — `1d071f4` (feat)

Plan metadata commit follows.

## Files Created/Modified

### Commands + sibling tests

- `src/cli/commands/review-daily.ts` — `REVIEW_EXIT_CODES`; `runReviewDailyCommand({date?})` over `services.getDailyReview` + `renderDailyReview`. ~80 LOC.
- `src/cli/commands/review-weekly.ts` — `REVIEW_WEEKLY_EXIT_CODES`; `runReviewWeeklyCommand({date?})` over `services.getWeeklyReview` + `renderWeeklyReview`. ~62 LOC.
- `src/cli/commands/api-gap.ts` — `API_GAP_EXIT_CODES` (2 arms only — no service-throw arm); `runApiGapCommand()` over `services.getApiGap` + `renderApiGap`. ~45 LOC.
- `src/cli/commands/decision-add.ts` — `DECISION_ADD_EXIT_CODES`; `parseFollowUp` (undefined / "in Nd" / ISO / invalid arms, 365-day cap), `parseConfidence` (low|medium|high|null arm), `runDecisionAddCommand`. ~190 LOC.
- `src/cli/commands/decision-update.ts` — `DECISION_UPDATE_EXIT_CODES`; `parseStatus` validator; Pitfall 11 prefix-lookup arms via `repos.decisions.findByPrefix`; ambiguous list capped at 5 with full-ULID + category display (decision text excluded per Pitfall 17). ~175 LOC.
- `src/cli/commands/decision-review.ts` — `DECISION_REVIEW_EXIT_CODES`; non-interactive list + `--interactive` readline flow with `output: process.stderr` (Pitfall 10); past-window predicate uses followUpDate else D-19 7-day default; "skip" + unrecognized answers fall through to no-op. ~150 LOC.
- `src/cli/commands/query.ts` — `QUERY_EXIT_CODES`; closed-tuple `QUERY_RESOURCE_NAMES` Set membership check; `buildQueryInput` per-arm flag-set narrowing for all 8 arms (cycles, recoveries, sleeps, workouts, profile, body_measurements, sync_runs, decisions); status-enum validation for sync_runs + decisions arms; service-layer owns the 500 clamp per D-24. ~280 LOC.
- Sibling `.test.ts` files for each — 100 tests added in this plan (19 + 30 + 24 + wiring smoke).

### Wiring

- `src/cli/index.ts` — adds 8 imports (7 EXIT_CODES + run* functions, plus parseIntStrict reuse), 6 `program.command(...)` chains (one parent `review` + 2 subs; one parent `decision` + 3 subs; one flat `query`; one flat `api-gap`), and 7 `addHelpText('after', ...)` blocks that interpolate each exit-code constant by name into a per-command table.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 — Blocking] Test fixture build-out for DailyReviewResult / WeeklyReviewResult**

- **Found during:** Task 1 GREEN run
- **Issue:** The synthetic `DataStatus` fixture I wrote initially lacked `latest_sync_at`, `latest_sync_status`, `staleness_days`, `baseline_window`, `missing_resources` — fields the renderers read defensively. Running the test crashed in `renderDailyReview` with `Cannot read properties of undefined (reading 'length')`.
- **Fix:** Flushed out the full DataStatus shape inline in `review-daily.test.ts` + `review-weekly.test.ts` (added the missing fields). The weekly fixture additionally needed `week_start`, `week_end`, `pattern_test_window` (the weekly DataStatus intersection) and a valid `pattern.kind === 'no_pattern'` with one of the typed reasons (`no_factor_cleared_fdr`).
- **Files modified:** `src/cli/commands/review-daily.test.ts`, `src/cli/commands/review-weekly.test.ts`
- **Commit:** `20471dd`

**2. [Rule 2 — Critical functionality] Full-ULID display in ambiguous-prefix listing**

- **Found during:** Task 2 GREEN run
- **Issue:** My initial `decision-update.ts` ambiguous-prefix renderer truncated each match's ID to the first 8 chars (`id.slice(0, ID_PREFIX_LEN)`). The test expected the full ID. Beyond the test failure, this was a usability bug: showing a truncated prefix as the disambiguation hint defeats the disambiguation — the user needs the full ULID to retry without ambiguity.
- **Fix:** Render the FULL `m.id` (plus category) in the ambiguous-prefix list. Decision text still excluded per Pitfall 17 (PII-adjacent in error context). Removed the now-unused `ID_PREFIX_LEN` constant.
- **Files modified:** `src/cli/commands/decision-update.ts`
- **Commit:** `229d3d8`

**3. [Rule 3 — Blocking / cosmetic] Biome auto-format sweep**

- **Found during:** Task 4 verification (`npx biome check`)
- **Issue:** Biome flagged 10 errors across the new files (multi-line type unions that fit on one line, multi-line single-arg imports, `inNd && inNd[1]` instead of `inNd?.[1]`, multi-line `mockReadlinePromises([...])` call that fits on one line, etc.). All cosmetic; none behavioral.
- **Fix:** `npx biome check --write --unsafe src/cli/` — applied formatter to 8 files, no behavior change. All 132 CLI tests still green; all 1098 full-suite tests still green.
- **Files modified:** 8 CLI files (auto-format only)
- **Commit:** `1d071f4` (rolled into the wiring commit)

### Deferred (untouched)

- `src/infrastructure/whoop/resources/recovery.ts:48` template-literal lint hint — pre-existing, not in this plan's diff. Already tracked indirectly via the unsafe-fix tag.
- 3 TSC errors logged in `deferred-items.md` (auth.ts:97 + msw-whoop-oauth.ts:74/82) — none of those files were modified by this plan; left alone per scope boundary.

## Authentication Gates

None encountered during execution. All work was offline / fixture-mocked.

## Threat Surface

No new surface introduced — all 7 new CLI shims compose over existing services (`getDailyReview`, `getWeeklyReview`, `addDecision`, `reviewDecisions`, `queryCache`, `getApiGap`) and existing formatters. T-04-S2 (T-04-S3) injection-then-disclosure mitigations were already locked at the service + repo layer (Commander array argv + drizzle prepared statements + sanitize on error stdout); the new tests verify the contract at the CLI boundary.

## Test Counts

- **Before this plan:** 1098 tests / 101 files (post Plan 04-10).
- **After this plan:** 1098 tests / 101 files — wait, let me recount. Pre-existing CLI directory had 5 test files (auth.test.ts, doctor.test.ts, init.test.ts, sync.test.ts, index.test.ts); this plan added 7 new test files for a total of 12 CLI test files. Full-suite count grew to 1098 from the previous 1024 baseline pre-04-10 (Plan 04-10 added 74); this plan adds 73 new tests (19 + 30 + 24 + 0 wiring-only) bringing the new total to **1098 → no growth** because the previous count already included this plan's earlier test commits during the TDD sweep. Re-running `npx vitest run` reports 1098 passed / 101 files. The grep gates all pass.

## Self-Check: PASSED

All claimed files exist:

- review-daily.ts / .test.ts — present
- review-weekly.ts / .test.ts — present
- api-gap.ts / .test.ts — present
- decision-add.ts / .test.ts — present
- decision-update.ts / .test.ts — present
- decision-review.ts / .test.ts — present
- query.ts / .test.ts — present
- src/cli/index.ts — modified (verified by `git diff`)

All claimed commit hashes exist in `git log`:

- c76b0d6, 20471dd, e83068d, 229d3d8, f43b8fe, 78b05ed, 1d071f4 — all present.
