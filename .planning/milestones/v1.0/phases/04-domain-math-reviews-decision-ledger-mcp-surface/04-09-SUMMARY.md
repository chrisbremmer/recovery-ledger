---
phase: 04-domain-math-reviews-decision-ledger-mcp-surface
plan: 09
subsystem: src/formatters/
tags:
  - REV-03
  - REV-04
  - REV-08
  - DEC-03
  - MCP-04
  - D-07
  - D-12
  - D-17
  - D-22
  - D-26
  - D-34
  - ADR-0001
  - ADR-0004
  - ADR-0005
dependency_graph:
  requires:
    - 04-01 (Wave 0 banned-words util + contract scaffolds)
    - 04-05 (ACTION_CATALOG + DECISION_PROMPT_CATALOG)
    - 04-06 (API_GAP_ENTRIES + decision service types)
    - 04-07 (getDailyReview + getWeeklyReview services)
    - 04-08 (bootstrap composition root + queryCache result types)
  provides:
    - renderDailyReview(result: DailyReviewResult): string
    - renderWeeklyReview(result: WeeklyReviewResult): string
    - renderDecisionList(arg) / renderDecisionDetail / renderDecisionUpdate
    - renderQueryCache(result: QueryCacheResult): string
    - renderApiGap(result: ApiGapResult): string
    - D-26 contract test (rendered-output banned-word lint Layer 2)
    - 3 decision fixtures (decision-add-happy-path, decision-review-list, decision-review-interactive-update)
  affects:
    - 04-10 (MCP tools consume formatters via content[0].text)
    - 04-11 (CLI commands consume formatters via process.stdout.write)
tech-stack:
  added: []
  patterns:
    - Pure (typedResult) => string formatter discipline (ARCHITECTURE.md lite-hexagonal + ADR-0001)
    - Exhaustive switch on discriminated-union kind per ADR-0004 (forcing function — adding a variant fails to compile)
    - Empty-array → section-omission, not "(none)" filler (ADR-0004 typed positive output rendered as section absence)
    - Module-scope column-width constants (sync.txt.ts precedent)
    - Defence-in-depth tone enforcement (Gate A source + D-26 rendered output)
key-files:
  created:
    - src/formatters/daily-review.txt.ts
    - src/formatters/daily-review.txt.test.ts
    - src/formatters/weekly-review.txt.ts
    - src/formatters/weekly-review.txt.test.ts
    - src/formatters/decision.txt.ts
    - src/formatters/decision.txt.test.ts
    - src/formatters/query-cache.txt.ts
    - src/formatters/query-cache.txt.test.ts
    - src/formatters/api-gap.txt.ts
    - src/formatters/api-gap.txt.test.ts
    - tests/fixtures/decisions/decision-add-happy-path.json
    - tests/fixtures/decisions/decision-review-list.json
    - tests/fixtures/decisions/decision-review-interactive-update.json
  modified:
    - tests/contract/formatter-tone.test.ts (Wave 0 scaffold → full D-26 coverage)
    - tests/contract/daily-review-shape.test.ts (Wave 0 scaffold → REV-03/04/05 + D-07 + D-08 assertions)
decisions:
  - D-07 anchored at the rendering layer — renderDailyReview NEVER emits a 'Patterns:' label across any of the 5 daily fixtures
  - D-17 + D-12 anchored at the rendering layer — weekly output carries two distinct labeled sections with correct trailing-7 and trailing-28 date ranges
  - D-22 decision_prompt rendered as the FINAL section when none_this_week (catalog-sourced suggested_text on a single line)
  - D-34 pattern_confidence='weak' triggers the 'Small sample — effect estimates are imprecise.' annotation
  - D-26 defence-in-depth complete: Gate A source-level + contract test rendered-output level
metrics:
  duration: ~35 minutes
  completed: 2026-05-20
  commits: 4 (3 feat + 1 style)
  tests_added: 173 (38 daily + 23 weekly + 15 decision + 14 query-cache + 8 api-gap + 42 contract + 33 shape)
  tasks_completed: 3 of 3
---

# Phase 04 Plan 09: Formatters + D-26 Tone Contract Test Summary

5 pure-function formatters (daily-review, weekly-review, decision, query-cache, api-gap) plus the D-26 defence-in-depth contract test re-checking rendered output across every fixture × every formatter.

## One-liner

Wave 3 closes the source-level → rendered-output ADR-0005 enforcement loop: 5 new pure `(typedResult) => string` formatters render the Phase 4 service surface to compact text, the daily renderer leads with `Data status:` (REV-04) and omits the `Patterns:` label across all 5 daily fixtures (D-07 anchor), the weekly renderer carries two distinct labeled sections with the correct trailing-7 / trailing-28 date ranges (D-17 + D-12 anchor), pattern_confidence='weak' triggers the D-34 small-sample caveat, decision_prompt 'none_this_week' lands as the FINAL paragraph (D-22), and the D-26 contract test re-checks the rendered output of every formatter × every fixture for banned tokens + emoji — Layer 2 of the ADR-0005 §Enforcement strategy is now in place.

## What Shipped

### Task 1 — renderDailyReview + renderWeeklyReview formatters

**src/formatters/daily-review.txt.ts** (240 LOC) — REV-04 lead-with-data-freshness anchor:
- `Data status:` is the FIRST paragraph of every rendered output (services already return the slot first in key order; the formatter cements the rendering contract).
- Sections rendered: Data status → Today's measurements → Anomalies (when non-empty) → Actions (when non-empty) → Confidence.
- D-07 anchor: the `Patterns:` label is NEVER emitted. The renderer ignores `result.patterns` entirely in v1 because Plan 04-07's `getDailyReview` always returns `patterns: []`. When V2 fills the slot, the renderer gains a conditional that emits the section — until then the omission is unconditional. Contract test pins "no `Patterns:` substring" across all 5 daily fixtures.
- REV-05 insufficient path: when `confidence.tier === 'insufficient'`, renders `Confidence: insufficient — ${reason}` and omits Anomalies + Actions sections entirely (ADR-0004 typed positive output as section omission, not `(none)` filler).
- `Today's measurements:` block renders all 9 D-04 metrics with null-safe formatters returning `(unavailable)` for null/non-finite values.
- `Anomalies:` block renders one line per Anomaly: `<metric label><signed z>σ (median <m>, robust σ <s>, tier: <t>) — <direction>`.

**src/formatters/weekly-review.txt.ts** (260 LOC) — D-17 + D-12 two-distinct-sections anchor:
- `Data status:` section surfaces both the trailing-7 `Week: X to Y` line and the trailing-28 `Pattern test window: X to Y (N SCORED days)` line distinctly.
- `Week summary (This week: ${week_start} to ${week_end}):` header reads the trailing-7 range from `data_status.week_start` / `week_end` (D-17).
- `Pattern over trailing 28 days (${start} to ${end}):` header reads the trailing-28 range from `data_status.pattern_test_window.{start,end}` (D-12).
- The two date ranges DIFFER by construction (length 7 vs 28). The formatter test asserts both are rendered with the correct ranges across every weekly fixture — D-17 contract anchored at the rendering layer.
- ADR-0004 exhaustive switch on `pattern.kind`:
  - `'detected'` → `Detected: <factor> was lower|higher on worst-recovery days` + `(U=X, p_raw=Y, p_adjusted=Z)` + `Confidence: weak|strong` + (when weak) `Small sample — effect estimates are imprecise.` (D-34 verbatim per RESEARCH §Pitfall 2).
  - `'no_pattern'` → `No reliable pattern detected. Reason: ${reason}` where reason is one of the three typed D-16 values.
- `Candidate factors (ranked):` table ALWAYS rendered (ADR-0004 §If FDR set empty — unranked context for self-vetting). Sorted ASC by `p_adjusted`; refused candidates render at the bottom with `(refused)` suffix.
- D-22 decision_prompt: `'silent'` → section omitted entirely; `'none_this_week'` → renders as the FINAL paragraph with the catalog-sourced suggested_text on a single line.

**tests/contract/daily-review-shape.test.ts** — REV-03/04/05 + D-07 + D-08 anchored across all 5 daily fixtures:
- REV-04: rendered output's first line is exactly `Data status:`.
- REV-03: rendered output contains `Today's measurements:` and `Confidence:` labels.
- D-07: rendered output does NOT contain the literal `Patterns:` substring (5/5 fixtures verified).
- REV-05: insufficient fixture contains `Confidence: insufficient — ` AND does NOT contain `Anomalies:`.
- D-08: multi-anomaly fixture contains `Anomalies:` AND exactly 3 numbered actions (1., 2., 3.), NEVER a 4th.

**Sibling tests** (38 in daily, 23 in weekly): per-fixture REV-04 anchor, D-07 anchor, REV-05 insufficient surface, today's measurements 8-row rendering, weak/strong confidence dispatch, no_pattern dispatch with typed reason, candidate-results table presence, D-22 final-section placement, ADR-0005 sanity sweep.

### Task 2 — renderDecisionList + renderQueryCache + renderApiGap formatters

**src/formatters/decision.txt.ts** (170 LOC) — D-19/D-20/D-21 anchor:
- `renderDecisionList(arg)` dispatches on input shape via TypeScript narrowing:
  - `Decision[]` or `ReviewDecisionsResult.mode='list'` → column-padded table (`ID | Category | Decision | Elapsed/Window | Status`); decision text truncated to 40 chars with ellipsis; elapsed/window column carries `<elapsed>d/<expected>d*` with the asterisk when elapsed > expected.
  - `ReviewDecisionsResult.mode='update'` → D-21 single-line `decision <ulid-prefix> updated to <status>`.
  - Bare `Decision` → multi-line detail block (all populated fields; null fields omitted).
- `computeExpectedWindow` correctly diffs calendar dates (not full ISO timestamps) so a `createdAt: '...T15:00:00Z'` + `followUpDate: '...+7d'` resolves to 7 (not 6 from the wall-clock-time underflow).

**src/formatters/query-cache.txt.ts** (220 LOC) — D-24 8-arm dispatch:
- Exhaustive switch on `result.resource` per ADR-0004 forcing function (adding a 9th arm to QueryCacheInput fails to compile here).
- 8 per-resource sub-renderers: cycles, recoveries, sleeps, workouts, profile (single-row block), body_measurements, sync_runs, decisions (delegates to `renderDecisionList`).
- Every arm renders a column-padded table with `score_state` column surfacing the SCORED/PENDING_SCORE/UNSCORABLE discriminator (Phase 3 D-03 + ADR-0003 — so the user sees which rows can be read for statistics vs which are pending/unscorable).
- Trailing `\n--\ncount: N (truncated: true|false)` line on every render so the user can confirm whether they hit the D-24 limit cap.
- SCORED-narrowed fields render only on SCORED variants; non-SCORED rows render `-` placeholders without runtime errors.

**src/formatters/api-gap.txt.ts** (40 LOC) — D-28 anchor:
- One paragraph per `ApiGapEntry`: `<feature>: <whoop_consumer_path>` header, `Not available via WHOOP v2 API. <alternative or 'No closest proxy.'>` second line, `<notes>` third line.
- Catalog already passes the source-layer lint (Plan 04-06 sibling test); D-26 contract test re-checks the rendered output.

**3 decision fixtures** under `tests/fixtures/decisions/`:
- `decision-add-happy-path.json` — single Decision representing the output of `decision add` (sleep category, mirrors DECISION_PROMPT_CATALOG[sleep-duration-shorter] text, follow-up 7 days out, confidence='medium').
- `decision-review-list.json` — 3-Decision array: (1) open within window, (2) open over window (asterisk-rendered), (3) followed_up. Covers the 3 buckets the catalog uses (sleep, training, recovery).
- `decision-review-interactive-update.json` — `ReviewDecisionsResult.mode='update'` representing the output of `decision update <id> --status followed_up --notes ...`.

**Sibling tests** (15 decision + 14 query-cache + 8 api-gap): shape dispatch, column widths, ellipsis truncation, over-window asterisk, 8-arm dispatch per resource, score_state narrowing safety, trailing count/truncated line, ADR-0005 sanity sweep.

### Task 3 — D-26 defence-in-depth contract test

**tests/contract/formatter-tone.test.ts** (320 LOC) — REV-08 / D-26 anchor:
- Wave 0 `it.todo` scaffold replaced with full coverage:
  - **Catalog source-level lint**: every `ACTION_CATALOG` entry (12 rows) + `DECISION_PROMPT_CATALOG` entry (6 rows) + `API_GAP_ENTRIES` entry's string fields (6 rows × 4 fields) asserted free of banned tokens at module load.
  - **Rendered-output lint**:
    - 5 daily fixtures × `renderDailyReview` (full pipeline: fixture → in-memory DB → getDailyReview → render).
    - 5 weekly fixtures × `renderWeeklyReview` (same full pipeline).
    - 3 decision fixtures × `renderDecisionList`/`renderDecisionDetail`/`renderDecisionUpdate` (direct typed-input → render).
    - Full api-gap catalog × `renderApiGap` (service → render).
  - **Retroactive Phase 1-3 coverage**: `renderDoctor` exercised with a representative pass/warn/fail DoctorResult.
- Per-assertion failure messages include the offending banned word, the 60-char context window surrounding it, and the fixture/catalog label so a regression points at the exact line.
- Wave 4 placeholder: empty describe block for the `PROMPT_INSTRUCTIONS` iteration that Plan 04-10 will populate when the MCP prompt surface lands.

D-26 defence-in-depth complete: Gate A scans source (Layer 1) AND this contract test re-checks RENDERED output across every fixture × every formatter (Layer 2). Generated content (catalog strings concatenated into templates) is caught at Layer 2 even though Gate A cannot see it.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 — Bug] computeExpectedWindow off-by-one on full-ISO createdAt**
- **Found during:** Task 2, decision.txt.test.ts run
- **Issue:** Diffing the full ISO timestamp `'2026-03-15T15:00:00Z'` against the bare-date `'2026-03-22'` yields 6.625 days → `floor` to 6 instead of the canonical 7-day default. Test expected `3d/7d` but got `3d/6d`.
- **Fix:** Slice `createdAt` to its first 10 chars (`yyyy-mm-dd`), parse both anchors at UTC midnight, then diff. Now `7d` for the canonical case.
- **Files modified:** src/formatters/decision.txt.ts (line ~145).
- **Commit:** 20f6c18 (fix folded into the Task 2 commit since the test caught it before the commit landed).

**2. [Rule 1 — Plan-text minor] D-34 weak-confidence variant fixture not added; inline synthetic result used instead**
- **Plan text:** "if no existing fixture from Plan 04-07 has N_scored ∈ [14, 20], add `tests/fixtures/review/weekly-pattern-clears-fdr-weak.json` ... OR adapt the fixture set"
- **Decision:** Used the OR branch. None of Plan 04-07's existing fixtures yield `pattern.kind='detected'` with N in [14, 20). Engineering a fixture that does requires the worst-day separation to be large enough to clear FDR at N=16-19 SCORED days — non-trivial without running the detector iteratively. The formatter is pure `(typedResult) => string` so the D-34 weak case is asserted via a hand-authored `WeeklyReviewResult` literal in `weekly-review.txt.test.ts` (the "Synthetic weak-confidence result (N=18) → renders D-34 caveat" test). This anchors the rendering contract directly without adding fixture-corpus surface that no other test consumes. Plan text explicitly endorses this as the recommended option for the D-34 case.
- **Files modified:** src/formatters/weekly-review.txt.test.ts (synthetic test added; no new fixture file).
- **Commit:** 59257c2.

**3. [Rule 3 — Blocking] Biome formatting on 9 of the new files**
- **Found during:** `npx biome check src/formatters/ tests/contract/` after Tasks 1-2 commits.
- **Issue:** Biome's import sort + line-length rules flagged 10 cosmetic issues across the 9 new files (trailing comma vs. inline; ternary line-wrap; import ordering).
- **Fix:** `npx biome check --write` — auto-applied. All 198 formatter + contract tests still green after the reformat.
- **Files modified:** 8 files (formatters + tests).
- **Commit:** 4eb3640.

No Rule-2 (missing critical functionality) or Rule-4 (architectural) deviations.

## Test Counts

- **Test files:** 15 passed (formatters + contract) + 4 skipped (Wave 0 it.todo placeholders that remain at the directory level).
- **Tests:** 198 total in scope; 187 passed; 11 todo (Wave 4 placeholders untouched per plan).
- **Full suite:** 976 passed | 11 todo across the project; +175 tests landed in this plan (above the previous 801 baseline from Plan 04-08 close).

## CI / Lint Posture

- All 10 CI grep gates green (`bash scripts/ci-grep-gates.sh`).
- `npx tsc --noEmit`: 3 pre-existing baseline errors in `src/cli/commands/auth.ts:97` + `tests/helpers/msw-whoop-oauth.ts:74,82` — out of scope per `.planning/phases/04-domain-math-reviews-decision-ledger-mcp-surface/deferred-items.md`. Zero new TS errors from this plan.
- `npx biome check`: clean across all changed files after the style commit.

## D-26 Defence-in-Depth Attestation

- **Layer 1 (source-grep, Gate A):** scripts/ci-grep-gates.sh scans every `.ts` / `.md` file for the 10 banned tokens — green.
- **Layer 2 (rendered output, this plan):** tests/contract/formatter-tone.test.ts exercises every fixture × every formatter and lint-checks the rendered string — green.
- Both layers together satisfy ADR-0005 §Enforcement bullet 3 ("Contract test that runs the renderer on every fixture and re-checks the rendered output for banned tokens").

## MCP Surface Attestation (D-30 carry-forward)

- No new MCP tools registered. `src/mcp/sanitize.ts` + `src/mcp/register.ts` byte-identical to origin/main.
- `tools/list` still returns exactly `whoop_doctor` (the Phase 1 Plan 01-04 surface). Phase 4 Plan 04-10 will flip this to 8 tools.

## Requirements Closed

- REV-03 (D-03 schema rendered correctly) — anchored by `tests/contract/daily-review-shape.test.ts`.
- REV-04 (data freshness leads) — anchored by `renderDailyReview` first-line assertion across all 5 daily fixtures.
- REV-08 (banned-word lint on output) — anchored by `tests/contract/formatter-tone.test.ts` rendered-output coverage.
- DEC-03 (decision review rendering) — anchored by `renderDecisionList` column-padded table + ellipsis + over-window asterisk.
- MCP-04 (formatter discipline at the MCP boundary) — formatters are pure (typedResult) => string per ADR-0001; MCP tools will compose `content: [{ type: 'text', text: format(result) }]` in Plan 04-10.

## Self-Check: PASSED

- [x] All 13 created files exist on disk.
- [x] All 4 commits exist in `git log` (59257c2, 20f6c18, b838733, 4eb3640).
- [x] `npx vitest run src/formatters/ tests/contract/` returns 187 passed.
- [x] `npx vitest run` (full suite) returns 976 passed.
- [x] `bash scripts/ci-grep-gates.sh` returns "All grep gates passed."
- [x] `npx tsc --noEmit` reports only the 3 pre-existing deferred errors (no new ones).
- [x] `npx biome check` clean across changed files.
