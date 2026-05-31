---
phase: 04-domain-math-reviews-decision-ledger-mcp-surface
plan: 05
subsystem: domain/patterns+actions
tags: [patterns, fdr, mann-whitney, action-catalog, decision-prompts, tdd, wave-1, pure-domain]

requires:
  - phase: 04-domain-math-reviews-decision-ledger-mcp-surface (Plan 04-02)
    provides: WeeklyPattern 2-arm discriminated union + CandidateResult + WorstDay + CandidateName + CANDIDATE_FACTORS_TYPE_ONLY (patterns/types.ts); SuggestedAction + DecisionPrompt (review/types.ts); Anomaly (anomalies/types.ts); MetricName + METRIC_NAMES (baselines/types.ts)
  - phase: 04-domain-math-reviews-decision-ledger-mcp-surface (Plan 04-03)
    provides: mannWhitney(sampleX, sampleY): {U, p} (stats/mann-whitney.ts); benjaminiHochberg(pvalues, q): {rejected, adjusted} (stats/fdr.ts); median(values) (stats/median.ts); MAD_CONSISTENCY = 1.4826 (stats/mad.ts)
  - phase: 04-domain-math-reviews-decision-ledger-mcp-surface (Plan 04-01)
    provides: containsBannedToneToken(text) + BANNED_TONE_WORDS (banned-words.ts) — D-26 + ADR-0005 module-load tone lint
  - phase: 04-domain-math-reviews-decision-ledger-mcp-surface (Plan 04-04)
    provides: composable BaselineStats shape (consumed via input.baselines.hrv_rmssd_milli inside detectWeeklyPattern's hrv_delta_prior_day helper)

provides:
  - src/domain/patterns/candidates.ts — `CANDIDATE_FACTORS` 5-tuple module-load constant matching CANDIDATE_FACTORS_TYPE_ONLY verbatim (D-11 lock) + `CANDIDATE_FACTORS_SET` runtime membership Set; doc-comment block cites the 2 dropped REV-06 candidates (rhr_delta_prior_day multicollinearity-with-HRV + respiratory_rate_anomaly_prior_day rare-event-low-power)
  - src/domain/patterns/pattern.ts — `detectWeeklyPattern(input, q=0.10)`: pure 12-step RESEARCH §6 algorithm over the trailing-28-day window arrays the SERVICE caller supplies (D-12 input-array discipline); composes mannWhitney over 5 candidate samples → benjaminiHochberg over non-refused p-values → D-18 multi-detection smallest-p_adjusted winner selection → D-34 pattern_confidence on the detected arm; returns 4 discriminated arms: insufficient_window_days / all_candidates_refused / no_factor_cleared_fdr / detected
  - src/domain/actions/catalog.ts — `ACTION_CATALOG` (12 entries) frozen module-load constant covering all 6 actionable D-06 trigger keys (HRV-low, recovery-low, sleep_duration-low, sleep_efficiency-low, RHR-high, respiratory-high) with 2 variants per key; verb-first single sentences, banned-word-free, < 120 chars, integer-priority-ranked
  - src/domain/actions/decision-prompts.ts — `DECISION_PROMPT_CATALOG` (6 entries) frozen module-load constant per D-23: 1 generic no_pattern entry + 5 pattern_detected entries (one per D-11 candidate); behavioral framing only per REQUIREMENTS medical-advice boundary
  - src/domain/actions/select.ts — `selectActions(anomalies): SuggestedAction[]`: D-08 catalog-driven selector; filters ACTION_CATALOG by (metric, direction) per firing Anomaly; ranks by priority ASC with explicit source-index tie-break; caps at 3 entries; returns [] when anomalies is empty (ADR-0004 typed positive output)

affects: [04-07 services/review/weekly.ts (composes detectWeeklyPattern over the trailing-28 cycles/recoveries/sleeps/workouts arrays the service supplies + reads DECISION_PROMPT_CATALOG for the decision_prompt slot), 04-07 services/review/daily.ts (composes selectActions over selectAnomalies output), 04-09 formatters (renders WeeklyPattern.factor + candidate_results + worst_days; renders SuggestedAction[].text verbatim), 04-09 formatter-tone contract test (Wave 3 D-26 rendered-output layer — this plan ships the source-layer; the contract test re-checks rendered text)]

tech-stack:
  added: []
  patterns:
    - "Pure-domain Wave 1 layer — 5 source files across 2 subsystems (patterns, actions). Zero I/O imports; zero logger; zero clock. Only allowed imports: sibling domain modules (stats/mann-whitney, stats/fdr, stats/median, stats/mad, banned-words, baselines/types, anomalies/types, patterns/types, patterns/candidates, types/entities, review/types). ADR-0001 / Gate B applies even with nothing to log."
    - "Object.freeze + as-const on both catalogs (ACTION_CATALOG, DECISION_PROMPT_CATALOG) per Shared Pattern 2. Each sibling test asserts Object.isFrozen === true so a future refactor that drops the freeze surfaces at CI time. The frozen invariant + sibling banned-word lint together form the source-layer half of ADR-0005's defence-in-depth (Wave 3 Plan 04-09 adds the rendered-output half)."
    - "D-11 5-tuple lock anchored by deep-equal: candidates.ts ships CANDIDATE_FACTORS (the load-bearing constant) verbatim from CANDIDATE_FACTORS_TYPE_ONLY (the type-anchor in patterns/types.ts). The sibling test runs `expect(CANDIDATE_FACTORS).toEqual(CANDIDATE_FACTORS_TYPE_ONLY)` so a textual divergence between the two surfaces immediately. The doc-comment block citing the 2 dropped REV-06 candidates (multicollinearity + rare-event-low-power rationale) lives ONLY in candidates.ts so a future reader doesn't ask the question."
    - "ADR-0004 typed positive output forcing function locked at FOUR sites in this plan: (a) detectWeeklyPattern emits one of 4 WeeklyPattern arms — insufficient_window_days / all_candidates_refused / no_factor_cleared_fdr / detected — `null` is unreachable because the discriminated union does not have an absent slot; (b) selectActions returns [] (typed SuggestedAction[]) when anomalies is empty; (c) candidate_results ships the full 5-entry ranked list even when the kind arm is no_pattern — per ADR-0004 §Consequences 'list unranked candidates as context, not as a recommendation'; (d) DECISION_PROMPT_CATALOG has a `no_pattern` generic entry so the weekly review's decision_prompt slot always has a suggested_text available even when pattern.kind === 'no_pattern'."
    - "D-12 trailing-28 input-array discipline preserved at the function signature: detectWeeklyPattern receives `{cycles, recoveries, sleeps, workouts}` arrays as input and never re-windows. The service caller (Plan 04-07) is responsible for slicing the trailing-28-day window from reviewed_date. D-17 separation (trailing-7 week_summary slot lives in Plan 04-07's WeeklyReviewResult assembly) is preserved because the detector's signature does not expose any trailing-7 input — the two windows stay structurally distinct end-to-end."
    - "D-18 multi-detection: when 2+ candidates clear BH FDR, detector picks the cleared candidate with the smallest p_adjusted as `pattern.factor`. The full 5-entry candidate_results array preserves the unranked context per ADR-0004 §Consequences. Tie-break is by source order (CANDIDATE_FACTORS declaration order) so the result is deterministic across runs."

key-files:
  created:
    - src/domain/patterns/candidates.ts (45 LOC — 5-tuple module-load constant + ReadonlySet + dropped-candidates rationale doc-comment per D-11)
    - src/domain/patterns/candidates.test.ts (36 LOC — 3 tests: length=5, deep-equal vs CANDIDATE_FACTORS_TYPE_ONLY, Set membership)
    - src/domain/patterns/pattern.ts (398 LOC — detectWeeklyPattern + 5 per-candidate helpers + 2 Intl-zone helpers; 12-step RESEARCH §6 algorithm; min_lines 100 satisfied with 4x headroom)
    - src/domain/patterns/pattern.test.ts (326 LOC — 7 tests covering all 4 WeeklyPattern arms + tie-break + multi-detection; in-memory synthesis of cycles/recoveries/sleeps via shared buildInput helper)
    - src/domain/actions/catalog.ts (128 LOC — 12 frozen ActionCatalogEntry entries; verb-first single sentences; 6 D-06 trigger keys covered)
    - src/domain/actions/catalog.test.ts (91 LOC — 8 tests: size, unique ids, METRIC_NAMES-typed metrics, priority, banned-word lint, verb-first rule, D-06 coverage, frozen)
    - src/domain/actions/decision-prompts.ts (76 LOC — 6 frozen DecisionPromptCatalogEntry entries; 1 generic + 5 per-D-11-candidate)
    - src/domain/actions/decision-prompts.test.ts (80 LOC — 7 tests: size=6, unique ids, non-empty text, generic-no-pattern entry, 5 per-factor entries one per candidate, banned-word lint, frozen)
    - src/domain/actions/select.ts (81 LOC — selectActions D-08 selector; rank by priority ASC + source-index tie-break; cap at 3; min_lines 25 satisfied with 3x headroom)
    - src/domain/actions/select.test.ts (99 LOC — 6 tests: empty anomalies → [], single HRV-low surfaces 2 entries, 3+ anomalies cap at 3, determinism, no-match → [], echo metric+direction)
  modified: []

key-decisions:
  - "Workout-timing late-evening helper refuses cleanly when workoutsScored.length === 0. Original spec said the helper returns 0 (a valid sample) for any cycle with a prior cycle. That choice meant the 'all_candidates_refused' test path was unreachable with a 14-cycle no-workout fixture because 13 of 14 cycles would contribute a 0 to the worst/other sample. The test fixture would then trip 'no_factor_cleared_fdr' instead. The principled fix: when the user logged ZERO workouts across the entire window, workout-timing has no statistical signal at all — refuse the candidate cleanly via the sample-size gate by returning null per cycle. This preserves the 'all_candidates_refused' branch as a reachable code path and matches the spirit of ADR-0004 (absent data → typed positive refusal, not a meaningless 0-vs-0 comparison). Documented in pattern.ts header comment."
  - "Sleep need for sleep_debt_3d_rolling pinned at 480 minutes (8 hours). The plan's algorithm references `(sleep_need - actual_duration)` but does not lock the numeric default. 480 = 8h is the population norm (CDC + AASM); a per-user need from WHOOP's sleep_need_milli would require reading the SCORED sleep's nested score field, which adds a 2nd join surface to the helper. V2 path: read sleep_need from each sleep's score block when available, fall back to 480. Phase 4 ships the constant; the choice is documented in the SLEEP_NEED_MINUTES constant docstring."
  - "Catalog entry text was constrained by ADR-0005 banned-word avoidance plus REV-08 verb-first single-sentence plus < 120 chars plus the REQUIREMENTS medical-advice boundary. Several first-draft entries tripped the tone lint (`Dial in your sleep timing` — `dial in` substring; `Honor the recovery signal` — `honor`; `Unlock easier days` — `unlock`); each was replaced with a verb-first behavioral framing. The final 12 entries pass the module-load lint cleanly. Future PRs adding catalog entries should run `npx vitest run src/domain/actions/catalog.test.ts` before commit to surface tone violations at the source layer (the contract test in Plan 04-09 is the second line of defence)."
  - "Pattern detector returns three top-level slots (`pattern`, `candidate_results`, `worst_days`) rather than nesting candidate_results + worst_days under pattern. The reason: candidate_results + worst_days are populated EVEN WHEN pattern.kind === 'no_pattern' (per ADR-0004 §Consequences). Nesting them under pattern.detected would force callers to handle the absence in the no_pattern arm; promoting them to top-level slots means the formatter (Plan 04-09) can render the worst_days table + the candidate_results table independently of pattern arm. WeeklyReviewResult (Plan 04-02) already has this shape at the service layer; the detector mirrors it."
  - "REV-07 LOAD-BEARING test uses an in-memory engineered fixture rather than the planned `tests/fixtures/review/weekly-pattern-fdr-suppression.json`. The plan's pragmatic-approach paragraph anticipated this: 'the actual numeric p_raws don't need to be exactly [0.05, ...] — what matters is that the BH @ q=0.10 step-up rejects nothing on that synthetic input.' The test synthesizes 20 cycles with near-baseline prior-day signals (sleep durations cycling 420/425/430 minutes, strain cycling 10/10.5/11/11.5, no engineered worst-vs-other gap) and asserts the composition path (pattern code → 5x mannWhitney → BH → typed output) lands on no_factor_cleared_fdr. The pure BH math is already asserted in fdr.test.ts (Plan 04-03) against the canonical D-35 fixtures; this test asserts the COMPOSITION."
  - "Catalog text quoted CLI command literally (`recovery-ledger decision add \"<text>\"`). Decision-prompt suggested_text strings include the exact CLI command the user should run, with the suggested action inside quotes. This is intentional: D-23 anchors the slot in the typed positive output (DecisionPrompt.none_this_week.suggested_text), so the formatter (Plan 04-09) prints the string verbatim. Users can copy-paste directly; no template substitution at render time. The plan's plan text proposed slightly different framing ('recovery-ledger decision add \"sleep at least 7h on training days\" --category sleep') — the catalog landed it verbatim minus the literal numeric '7' which spelled out reads more naturally ('seven hours')."

patterns-established:
  - "TDD cycle on a 5-file plan with intermixed dependencies: tests are written for each file in dependency order (candidates → catalogs → select → pattern), but the two catalog tests can share a single RED commit because they don't depend on each other. The order: 1× RED candidates + 1× GREEN candidates, then 1× RED for both catalogs together + 1× GREEN for both catalogs together, then 1× RED select + 1× GREEN select, then 1× RED pattern + 1× GREEN pattern, then 1× REFACTOR for biome formatting. 9 commits total."
  - "Catalog-driven action selection as a deterministic pure function. ACTION_CATALOG is frozen at module load; selectActions filters by (metric, direction), ranks by priority ASC, and ties-breaks by source order. The tie-break is explicit (sourceIndex stored alongside the matched entry) rather than relying on V8's TimSort stability — the contract is independent of engine sort stability. This pattern is reusable for the V2 expansion: adding more catalog entries with the same priority is safe because source order locks the tie-break."
  - "Banned-word lint as a per-entry expect with surfacing diagnostic: `expect(result, \\`entry '${entry.id}' tripped tone lint: ${JSON.stringify(result)}\\`).toEqual({ hit: false })`. When a future PR adds a catalog entry tripping the lint, the failure surface includes the entry id and the offending word — actionable error message without a second-pass debugging step. Same pattern reused in decision-prompts.test.ts."

requirements-completed: []
# REV-06, REV-07, REV-08, DEC-04 are LISTED in this plan's frontmatter `requirements:`
# field because Plan 04-05 anchors the domain-layer pieces they depend on, but the
# user-facing requirements close in:
#   - REV-06 (weekly review surfaces worst-days + 5 candidates) → Plan 04-07
#     services/review/weekly.ts
#   - REV-07 (BH FDR @ q=0.10 + ADR-0004 typed positive output) → Plan 04-07
#     (the detector composition lands here; the service layer wires it into the
#     WeeklyReviewResult)
#   - REV-08 (formatter tone lint) → Plan 04-09 D-26 contract test
#   - DEC-04 (weekly decision prompt) → Plan 04-07 weekly review composition

duration: 9min 12s
completed: 2026-05-20
---

# Phase 4 Plan 05: Patterns + Action / Decision-Prompt Catalogs + Select Summary

**Phase 4 Wave 1 — shipped 5 pure-domain modules across 9 RED/GREEN/REFACTOR commits (the largest TDD plan in Phase 4 so far). `detectWeeklyPattern` is the chassis the weekly review composes against in Plan 04-07; `ACTION_CATALOG` + `DECISION_PROMPT_CATALOG` lock the catalog-driven copy at the source layer with D-09 + D-23 + D-26 + ADR-0005 banned-word lint at module load. ADR-0004 typed positive output forced at 4 sites; D-12 + D-17 + D-18 detector-site discipline preserved. Tests jumped 689 → 720 (+31 tests across 5 new files); 198 tests now green across the whole `src/domain/` tree (up from 167 at Plan 04-04 close).**

## Performance

- **Duration:** 9 min 12 s
- **Started:** 2026-05-20T18:09:21Z
- **Completed:** 2026-05-20T18:18:33Z
- **Tasks:** 9 (RED + GREEN per file across 5 files + 1 final REFACTOR commit)
- **Files created:** 10 (5 source + 5 sibling tests)
- **Files modified:** 0 (plan-scoped — no edits to existing source)
- **Commits:** 9 (8 RED/GREEN + 1 REFACTOR; this docs commit will land at the close)

## What Shipped

### `src/domain/patterns/candidates.ts` (45 LOC, 3 tests)

D-11 5-tuple module-load constant with `Object.satisfies readonly CandidateName[]` clause. Mirrors `CANDIDATE_FACTORS_TYPE_ONLY` from Plan 04-02's `patterns/types.ts` verbatim; the sibling test asserts deep-equal so a future edit to either tuple surfaces at CI time. The doc-comment block citing the 2 dropped REV-06 candidates (rhr_delta_prior_day multicollinearity + respiratory_rate_anomaly_prior_day rare-event-low-power) lives only here so a future reader doesn't ask the question.

### `src/domain/patterns/pattern.ts` (398 LOC, 7 tests)

`detectWeeklyPattern(input, q=0.10)` — pure 12-step RESEARCH §6 algorithm transcribed verbatim. Composes:

- **Filter step:** SCORED cycles + non-DST-excluded + has matching SCORED Recovery with non-null recoveryScore.
- **Worst-day selection (D-13):** `nWorst = max(2, floor(N/4))`, sorted by `recoveryScore ASC` with chronological tie-break (`start.localeCompare`) per Pitfall 1.
- **5-candidate fan-out (D-11):** per-cycle sample assembly via 5 helper closures (sleep_duration_prior_night, sleep_debt_3d_rolling, day_strain_prior_day, workout_timing_late_evening, hrv_delta_prior_day). Each helper returns `number | null`; nulls drop from the sample. Workout-timing refuses cleanly when the window has zero workouts (deviation from spec — see decisions).
- **Sample-size gate:** worst < 2 OR other < 4 → refused with `'sample_too_small'`.
- **Mann-Whitney → BH FDR (D-15):** mannWhitney for each non-refused candidate; benjaminiHochberg over the resulting p-values at q=0.10.
- **D-18 multi-detection winner:** smallest p_adjusted among cleared candidates becomes `pattern.factor`; tie-break by source order (deterministic).
- **D-34 pattern_confidence:** `'strong'` if `scoredCycles.length >= 20` else `'weak'`.
- **Direction (`worst_days_had_lower | _higher`):** computed via `median(sampleWorst) < median(sampleOther)` for the winning factor.

Returns 4 discriminated arms per ADR-0004 + Pitfall 6:

| Arm | Trigger |
|---|---|
| `no_pattern.insufficient_window_days` | N_scored < 14 |
| `no_pattern.all_candidates_refused` | every candidate's worst < 2 OR other < 4 |
| `no_pattern.no_factor_cleared_fdr` | candidates ran, BH @ q=0.10 rejected nothing |
| `detected` | ≥ 1 candidate cleared; smallest p_adjusted wins |

Includes 2 Intl-based zone helpers (`hourInZone`, `dateInZone`) for the workout-timing late-evening 18:00-23:59 window. No extra deps; `Intl.DateTimeFormat` is Node 22 built-in.

### `src/domain/actions/catalog.ts` (128 LOC, 8 tests)

12 frozen ActionCatalogEntry entries covering all 6 actionable D-06 trigger keys (HRV-low, recovery-low, sleep_duration-low, sleep_efficiency-low, RHR-high, respiratory-high) with 2 variants per key. Each `text` is:

- Verb-first single sentence (regex `^[A-Z][a-z]+\s/` matches).
- < 120 characters.
- Banned-word-free (containsBannedToneToken returns `{ hit: false }`).
- Behavioral framing only (no clinical claims per REQUIREMENTS medical-advice boundary).

Priority is integer-ranked with explicit gaps (10, 20) so future entries can slot between existing ones without re-numbering. Frozen via `Object.freeze` at module load.

### `src/domain/actions/decision-prompts.ts` (76 LOC, 7 tests)

6 frozen DecisionPromptCatalogEntry entries per D-23:

| ID | Trigger | Factor |
|---|---|---|
| `no-pattern-generic` | `no_pattern` | — |
| `sleep-duration-shorter` | `pattern_detected` | `sleep_duration_prior_night` |
| `sleep-debt-rolling` | `pattern_detected` | `sleep_debt_3d_rolling` |
| `day-strain-prior-day` | `pattern_detected` | `day_strain_prior_day` |
| `workout-timing-late-evening` | `pattern_detected` | `workout_timing_late_evening` |
| `hrv-delta-prior-day` | `pattern_detected` | `hrv_delta_prior_day` |

Each `text` includes the literal CLI command users copy-paste: `recovery-ledger decision add "<suggested action>" --category <category>`. Same banned-word lint at module load + frozen invariant.

### `src/domain/actions/select.ts` (81 LOC, 6 tests)

`selectActions(anomalies: Anomaly[]): SuggestedAction[]` — D-08 catalog-driven selector. For each firing Anomaly, find every ACTION_CATALOG entry where `(trigger.anomaly_metric, trigger.direction)` matches. Collect across all anomalies. Rank by priority ASC with explicit source-index tie-break. Cap at 3 entries. Map to `SuggestedAction` shape with metric + direction echoed from the firing Anomaly.

Returns `[]` when:
- `anomalies.length === 0` (ADR-0004 typed positive output — no anomaly, no action).
- No catalog entry matches any firing anomaly (defensive — the catalog covers every actionable D-06 direction but the function stays correct if a future code path constructs an out-of-catalog Anomaly).

## Verification

| Command | Result |
|---|---|
| `npx vitest run src/domain/patterns/candidates.test.ts` | 3 / 3 green |
| `npx vitest run src/domain/patterns/pattern.test.ts` | 7 / 7 green |
| `npx vitest run src/domain/actions/catalog.test.ts` | 8 / 8 green |
| `npx vitest run src/domain/actions/decision-prompts.test.ts` | 7 / 7 green |
| `npx vitest run src/domain/actions/select.test.ts` | 6 / 6 green |
| `npx vitest run src/domain/` | 198 / 198 green across 25 files (678ms) |
| `npm run test` (full repo) | 720 / 720 green + 15 todo + 5 skipped (9.68s) |
| `bash scripts/ci-grep-gates.sh` | all 10 gates green |
| `npx tsc --noEmit` | clean on new files (3 pre-existing deferred TSC errors in auth.ts + msw-whoop-oauth.ts unchanged — out of scope per deferred-items.md) |
| `npx biome check` | clean on new files (1 pre-existing info-level hint on infrastructure/whoop/resources/recovery.ts unchanged — out of scope) |

## Test Coverage Delta

| Metric | Plan 04-04 Close | Plan 04-05 Close | Delta |
|---|---|---|---|
| `src/domain/` tests | 167 across 20 files | 198 across 25 files | +31 tests, +5 files |
| Full repo tests | 689 across 70 files | 720 across 74 files | +31 tests, +4 files |
| 10 CI grep gates | green | green | unchanged |

## Anchors Locked

- **D-11 5-candidate lock** anchored by deep-equal in `candidates.test.ts` against `CANDIDATE_FACTORS_TYPE_ONLY`. Dropped-candidate rationale (multicollinearity + rare-event-low-power) lives in the candidates.ts header doc-comment.
- **D-12 trailing-28 input-array discipline** preserved at the function signature: `detectWeeklyPattern` accepts already-windowed arrays and never re-windows.
- **D-17 trailing-7 week_summary slot** kept distinct: this plan's `pattern.ts` accepts only the trailing-28 arrays. Plan 04-07's `getWeeklyReview` assembles the trailing-7 week_summary slot separately.
- **D-18 multi-detection policy:** cleared candidate with smallest `p_adjusted` wins; tie-break by source order. Full 5-entry `candidate_results` ships regardless of arm.
- **D-34 pattern_confidence:** `'strong'` if N_scored >= 20 else `'weak'` on the detected arm.
- **D-13 bottom-quartile selection:** `nWorst = max(2, floor(N/4))`; tie-break chronological.
- **ADR-0004 typed positive output:** 4 forcing-function sites (4 WeeklyPattern arms, empty SuggestedAction[] from selectActions, full candidate_results across no_pattern arms, no_pattern-generic DecisionPromptCatalogEntry).
- **ADR-0005 + D-26 source-layer banned-word lint:** sibling test on every ACTION_CATALOG + DECISION_PROMPT_CATALOG entry asserts `containsBannedToneToken(text).hit === false` at module load. Wave 3 Plan 04-09 adds the rendered-output layer.
- **D-09 verb-first single-sentence rule:** regex `^[A-Z][a-z]+\s/` matches every ACTION_CATALOG entry; text < 120 chars enforced.
- **D-23 decision-prompt catalog shape:** exactly 6 entries (1 generic no_pattern + 5 per-D-11-candidate); each entry passes tone lint at module load.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] workout_timing_late_evening helper now refuses when window has zero workouts**

- **Found during:** Task 5 (pattern.ts implementation)
- **Issue:** Plan's spec said the helper returns 0 (a valid sample) for any cycle with a prior cycle, even when no workouts exist in the input window. That choice made the `all_candidates_refused` branch unreachable with a 14-cycle no-workout fixture: 13 cycles would each contribute 0 to the worst/other sample, sample-size gate would pass, Mann-Whitney would compute p ≈ 1, BH would not reject, and the test would land on `no_factor_cleared_fdr` instead of `all_candidates_refused`.
- **Fix:** When `workoutsScored.length === 0`, the helper returns `null` for every cycle → all per-cycle values drop → sample sizes collapse below the < 2 / < 4 gate → candidate refuses cleanly. This matches the spirit of ADR-0004 (absent data → typed positive refusal) and preserves the `all_candidates_refused` branch as a reachable code path.
- **Files modified:** `src/domain/patterns/pattern.ts` (lateEveningWorkoutsFor helper)
- **Commit:** `da13778`

**2. [Rule 1 - Plan-text minor] Sleep need pinned at 480 minutes (8 hours)**

- **Found during:** Task 5
- **Issue:** Plan's algorithm references `(sleep_need − actual_duration)` for `sleep_debt_3d_rolling` but does not lock the numeric default.
- **Fix:** Pinned `SLEEP_NEED_MINUTES = 480` (population norm per CDC + AASM) as a module constant with a docstring explaining the V2 path (read per-user sleep_need from WHOOP's sleep score block).
- **Files modified:** `src/domain/patterns/pattern.ts` (SLEEP_NEED_MINUTES constant)
- **Commit:** `da13778`

**3. [Rule 1 - Plan-text minor] REV-07 fixture in-memory instead of JSON**

- **Found during:** Task 5
- **Issue:** Plan proposed `tests/fixtures/review/weekly-pattern-fdr-suppression.json` for the no_factor_cleared_fdr test, but the plan's "Pragmatic approach" paragraph explicitly anticipated synthesis: "the actual numeric p_raws don't need to be exactly [0.05, ...] — what matters is that the BH @ q=0.10 step-up rejects nothing on that synthetic input."
- **Fix:** pattern.test.ts synthesizes 20 cycles with near-baseline prior-day signals via the shared `buildInput` helper. The pure BH math is already asserted in `fdr.test.ts` (Plan 04-03) against the canonical D-35 fixtures; this test asserts the COMPOSITION (pattern code → 5× Mann-Whitney → BH → typed output).
- **Files modified:** `src/domain/patterns/pattern.test.ts`
- **Commit:** `e98a5b3`

**4. [Rule 3 - Blocking] Biome auto-format + replace forEach with indexed loop**

- **Found during:** REFACTOR pass
- **Issue:** Biome flagged `useIterableCallbackReturn` on `cyclesByStartAsc.forEach((p, i) => cycleStartIndex.set(p.cycle.id, i))` (forEach callbacks shouldn't return values, but `Map.set` returns the Map). Biome also auto-applied organizeImports + format across 4 files.
- **Fix:** Replaced the forEach with an indexed for-loop using `if (pair !== undefined)` for strict-TS safety; accepted the auto-format changes.
- **Files modified:** `src/domain/patterns/pattern.ts`, `src/domain/patterns/pattern.test.ts`, `src/domain/patterns/candidates.test.ts`, `src/domain/actions/catalog.test.ts`
- **Commit:** `bdf00e0`

No architectural deviations. No Rule 4 escalations.

## Known Stubs

None — every catalog entry is wired with a real text string; pattern detector emits live discriminated unions; selectActions composes ACTION_CATALOG entries verbatim.

## Threat Flags

None — this plan ships pure-domain code only. No new network endpoints, no auth paths, no file access, no schema changes. The threat register's `T-04-S1` entries (Tampering + Information Disclosure) are mitigated as planned:

- **Tampering on pattern.ts:** Algorithm refuses pre-Mann-Whitney when sample sizes are below threshold; refuses entire weekly path when N_scored < 14. ADR-0004 typed positive output prevents null returns that could pass adversarial inputs through silently.
- **Information Disclosure on catalogs:** Module-load tone lint at catalog source (D-09 + D-23). Banned-word lint covers the 10 ADR-0005 tokens + emoji. Future PRs adding catalog entries re-run the lint; failure blocks merge.

## Carry-Forward Attestation

- **D-30 attestation extends:** No MCP tools added in this plan; `git diff origin/main --stat src/mcp/` returns empty for `sanitize.ts` + `register.ts`.
- **AuthError + WhoopApiError + MigrationError unions:** all FROZEN at 6/6/2 kinds respectively (unchanged from Plan 04-04 close).
- **Requirements REV-06 + REV-07 + REV-08 + DEC-04:** remain Active in REQUIREMENTS.md — the domain-layer chassis ships here; the user-facing requirements close in Plan 04-07 (weekly review composition) + Plan 04-09 (formatter + D-26 contract test).

## Self-Check: PASSED

- File `src/domain/patterns/candidates.ts` — FOUND
- File `src/domain/patterns/candidates.test.ts` — FOUND
- File `src/domain/patterns/pattern.ts` — FOUND
- File `src/domain/patterns/pattern.test.ts` — FOUND
- File `src/domain/actions/catalog.ts` — FOUND
- File `src/domain/actions/catalog.test.ts` — FOUND
- File `src/domain/actions/decision-prompts.ts` — FOUND
- File `src/domain/actions/decision-prompts.test.ts` — FOUND
- File `src/domain/actions/select.ts` — FOUND
- File `src/domain/actions/select.test.ts` — FOUND
- Commit `2a3c483` (test candidates RED) — FOUND in git log
- Commit `e6c4992` (feat candidates GREEN) — FOUND in git log
- Commit `caaaffb` (test catalogs RED) — FOUND in git log
- Commit `90e8d5d` (feat catalogs GREEN) — FOUND in git log
- Commit `0db8f63` (test select RED) — FOUND in git log
- Commit `65d1961` (feat select GREEN) — FOUND in git log
- Commit `e98a5b3` (test pattern RED) — FOUND in git log
- Commit `da13778` (feat pattern GREEN) — FOUND in git log
- Commit `bdf00e0` (refactor biome) — FOUND in git log

## TDD Gate Compliance

Per-feature RED → GREEN cycles all present in git log:

| Feature | RED commit | GREEN commit |
|---|---|---|
| candidates.ts | `2a3c483` test(04-05) | `e6c4992` feat(04-05) |
| catalogs (both) | `caaaffb` test(04-05) | `90e8d5d` feat(04-05) |
| select.ts | `0db8f63` test(04-05) | `65d1961` feat(04-05) |
| pattern.ts | `e98a5b3` test(04-05) | `da13778` feat(04-05) |

Final REFACTOR commit (`bdf00e0`) follows the GREEN gates; all 198 src/domain/ tests still green after the refactor pass.
