---
phase: 04-domain-math-reviews-decision-ledger-mcp-surface
plan: 02
subsystem: domain/types
tags: [types, discriminated-unions, baselines, anomalies, patterns, confidence, review, decision, cache, api-gap, wave-0, tdd]

requires:
  - phase: 03-data-model-db-layer-sync-loop
    provides: src/domain/types/score.ts (ScoreState closed-tuple + ReadonlySet — Shared Pattern 2 precedent), src/domain/types/sync.ts (ResourceName tuple — reused for QueryCacheInput arms), src/domain/types/entities.ts (Cycle/Recovery/Sleep/Workout/Profile/BodyMeasurement/Decision entity types — Wave 0 imports the Decision type for ReviewDecisionsResult)
  - phase: 04-domain-math-reviews-decision-ledger-mcp-surface (Plan 04-01)
    provides: ulid + simple-statistics installed (transitive — types compile without them but Wave 1 implementations will need them), banned-words.ts (no direct import here; downstream formatter contract test wires through it)

provides:
  - src/domain/baselines/types.ts — METRIC_NAMES (D-04 9-tuple) + MetricName + METRIC_NAMES_SET + BaselineStats (Wave 1 Plan 04-04 computes against this; daily review consumes BaselineStats[])
  - src/domain/confidence/types.ts — ConfidenceTier (3-literal union) + ConfidenceGate (with `minRequired: 10 | 20` literal-tuple-as-doc encoding of D-13 thresholds)
  - src/domain/anomalies/types.ts — ZAnalysis 3-variant discriminated union (computed | refused/insufficient_days | refused/baseline_mad_zero per D-05 + RESEARCH §1 MAD=0 extension) + Anomaly interface (per D-06)
  - src/domain/patterns/types.ts — CANDIDATE_FACTORS_TYPE_ONLY 5-tuple (D-11 type-anchor; Plan 04-05 candidates.ts re-exports + asserts deep-equal) + CandidateName + WeeklyPattern 2-arm union (detected with D-34 ADDITIVE pattern_confidence + no_pattern with 3 D-16 reasons) + CandidateResult + WorstDay
  - src/domain/review/types.ts — TodayMetrics (D-04 9 fields, each number|null) + DataStatus + SuggestedAction (D-08) + Pattern (D-07 placeholder) + DailyReviewResult (D-03 7 slots) + WeekSummary + DecisionPrompt 2-arm union (D-22) + WeeklyReviewResult (D-16 6 slots)
  - src/services/decision/types.ts — AddDecisionInput (D-19) + ReviewDecisionsInput 2-arm dual-mode union (D-21) + ReviewDecisionsResult + UpdateDecisionInput
  - src/services/cache/types.ts — QueryCacheInput 8-arm discriminated union (D-24 — T-04-S4 threat mitigation closes at the type level) + QueryCacheResource + QueryCacheResult
  - src/services/api-gap/types.ts — ApiGapEntry (D-28; `available_via_v2_api: false` literal-false) + ApiGapResult

affects: [04-03..04-12 — every subsequent Phase 4 plan implements against these types. Plan 04-03 (stats) writes pure functions that consume BaselineStats. Plan 04-04 (baselines + confidence) writes the modules that return BaselineStats[] + ConfidenceGate. Plan 04-05 (patterns) writes the detector that returns WeeklyPattern. Plan 04-06 (services/review/) composes DailyReviewResult + WeeklyReviewResult. Plan 04-07 (decision service) implements against AddDecisionInput + ReviewDecisionsInput. Plan 04-08 (action catalog) populates SuggestedAction. Plan 04-09 (formatters) renders the typed result. Plan 04-10 (api-gap + cache services) implements against QueryCacheInput + ApiGapResult. Plan 04-11 (MCP tools) wires the tools to the services. Plan 04-12 (MCP resources + prompts + phase close)]

tech-stack:
  added: []
  patterns:
    - "Shared Pattern 2 extension — closed-tuple + derived literal + ReadonlySet for METRIC_NAMES (9 entries, D-04) and CANDIDATE_FACTORS_TYPE_ONLY (5 entries, D-11). Same shape as Phase 3 SCORE_STATES; the deep-equal sync between CANDIDATE_FACTORS_TYPE_ONLY (here) and the load-bearing CANDIDATE_FACTORS (Plan 04-05 candidates.ts) lands when Plan 04-05 ships."
    - "ADR-0004 discriminated-union-as-forcing-function — five new tagged unions ship in this plan (ZAnalysis, WeeklyPattern, Pattern, DecisionPrompt, ReviewDecisionsInput + ReviewDecisionsResult + QueryCacheInput). Each adds an exhaustive-switch site in test code (Tasks 1+2) or downstream consumers (Tasks 3+4) so adding an arm without a matching case is a `tsc --noEmit` error. Same precedent as Phase 3 D-03 Score union."
    - "Literal-tuple-as-doc — `minRequired: 10 | 20` on ConfidenceGate documents the D-13 thresholds at the type level without a runtime comment. `days_required: 14` on ZAnalysis.refused/insufficient_days is the same pattern."
    - "Literal-false documentation — `available_via_v2_api: false` on ApiGapEntry locks the v1 contract: every catalog entry is unavailable; adding an entry with `true` is a compile error. Phase 5 can extend with a `true` arm if the catalog grows."

key-files:
  created:
    - src/domain/baselines/types.ts (83 LOC — METRIC_NAMES 9-tuple + MetricName + ReadonlySet + BaselineStats)
    - src/domain/baselines/types.test.ts (74 LOC — 4 assertions across 2 describe blocks: tuple-shape + BaselineStats narrowing)
    - src/domain/confidence/types.ts (51 LOC — ConfidenceTier 3-literal + ConfidenceGate)
    - src/domain/confidence/types.test.ts (64 LOC — 4 assertions across 2 describe blocks: tier exhaustive switch + gate threshold variants)
    - src/domain/anomalies/types.ts (87 LOC — ZAnalysis 3-variant union + Anomaly interface)
    - src/domain/anomalies/types.test.ts (123 LOC — 6 assertions across 2 describe blocks: 3 ZAnalysis arms via exhaustive switch + Anomaly direction narrowing)
    - src/domain/patterns/types.ts (112 LOC — CANDIDATE_FACTORS_TYPE_ONLY 5-tuple + CandidateName + WeeklyPattern 2-arm + CandidateResult + WorstDay)
    - src/domain/patterns/types.test.ts (146 LOC — 9 assertions across 5 describe blocks: 5-tuple shape + 2 detected/no_pattern variants + 3 refusal-reason arms + CandidateResult + WorstDay + CandidateName narrowing)
    - src/domain/review/types.ts (205 LOC — TodayMetrics 9 fields + DataStatus + SuggestedAction + Pattern placeholder + DailyReviewResult + WeekSummary + DecisionPrompt 2-arm + WeeklyReviewResult)
    - src/services/decision/types.ts (101 LOC — AddDecisionInput + ReviewDecisionsInput 2-arm + ReviewDecisionsResult + UpdateDecisionInput)
    - src/services/cache/types.ts (148 LOC — QueryCacheInput 8-arm + QueryCacheResource + QueryCacheResult + entity re-exports)
    - src/services/api-gap/types.ts (49 LOC — ApiGapEntry + ApiGapResult)
  modified: []

key-decisions:
  - "Discriminated unions over optional fields, everywhere. ZAnalysis is `computed | refused`, NOT `{value?: number, refused_reason?: ...}`. WeeklyPattern is `detected | no_pattern`, NOT `{detected?: ..., no_pattern_reason?: ...}`. DecisionPrompt is `silent | none_this_week`, NOT `{suggested_text?: string}`. ReviewDecisionsInput is `list | update`, NOT `{updateId?: string}`. The pattern is consistent with Phase 3 D-03 Score and is the ADR-0004 forcing function at the type system."
  - "ZAnalysis has 3 variants, not 2 — `baseline_mad_zero` is distinct from `insufficient_days`. RESEARCH §Statistical Engine §1 calls this out: a flat-data baseline (MAD=0 from constant respiratory_rate quantization) is structurally different from a small-sample baseline. The renderer can surface 'metric is flat — no anomaly signal' separately from 'not enough data.'"
  - "`CANDIDATE_FACTORS_TYPE_ONLY` is the type-anchor only; the load-bearing module-load constant ships in Plan 04-05 candidates.ts. Inlining the 5 literals here (instead of importing from candidates.ts) avoids a circular `types.ts → candidates.ts → types.ts` cycle. Plan 04-05 will assert deep-equal between the two tuples; both must stay textually in sync."
  - "`pattern_confidence: 'weak' | 'strong'` is on the `detected` arm only (D-34 ADDITIVE). It's NOT a top-level slot; the type system rejects reading `result.pattern_confidence` when `result.pattern.kind === 'no_pattern'`. Mann-Whitney normal approximation degrades at 14 ≤ N < 20, so the formatter renders a 'small sample' caveat when pattern_confidence === 'weak.'"
  - "`available_via_v2_api: false` is a literal-`false` type on ApiGapEntry. Every v1 catalog entry is by definition unavailable via the v2 API; locking the literal at the type level documents the contract and refuses (at compile time) an accidentally-added `true` entry. Phase 5 may add a `true` arm if the catalog grows to include 'available but not surfaced' entries."
  - "`QueryCacheResult.rows: unknown[]` is intentional at the service boundary. Per-resource narrowing happens at the Wave 3 formatter dispatch site via a switch on `result.resource`. A generic-discriminator type (e.g., `QueryCacheResult<R extends QueryCacheResource>`) was rejected because it forces every consumer to thread the generic; `unknown[]` + boundary switch is simpler and matches D-24's 'service surface is uniform' principle."
  - "`Pattern` interface ships with one arm (`kind: 'placeholder_v1_empty'`) per D-07. The discriminator-with-one-arm pattern documents the V2 expansion path without polluting the v1 type surface. V2 will add `kind: '3d_sleep_debt_accumulation'`, etc.; existing v1 consumers continue to compile because the arm union widens, not the field shape."
  - "Exhaustive-switch test bodies (Tasks 1 + 2) cast through the union type to widen TS's literal narrowing. `const name = METRIC_NAMES[0] as MetricName` — without the cast, TS narrows `name` to the literal `'recovery_score'` and refuses the other case branches as 'not comparable.' Same pattern applied to CandidateName narrowing in patterns/types.test.ts."

patterns-established:
  - "Plan 04-02 Wave 0 type-contract scaffold pattern: when a wave spans 4 type files with mixed test-friendliness (some carry runtime constants worth runtime-testing, some are pure interface declarations), split RED + GREEN per-task across the runtime-bearing files (Tasks 1+2 are TDD) and ship the pure-interface tasks (Tasks 3+4) under a single feat commit each with `tsc --noEmit` as the contract."

requirements-completed: []
# This plan defines the contracts that requirements REV-01..REV-08, DEC-01..DEC-04, MCP-01..MCP-06 will implement against in Waves 1-4. The requirements themselves close in the implementing plans, not here.

duration: 8min 59s
completed: 2026-05-18
---

# Phase 4 Plan 02: Cross-Cutting Type Contracts Summary

**Phase 4 Wave 0 — shipped 8 type files + 4 type-narrowing test files defining every cross-cutting type contract Plans 04-03..04-12 will implement against. Zero business logic; pure types + compile-checked discriminated-union narrowing.**

## Performance

- **Duration:** 8 min 59 s
- **Started:** 2026-05-19T00:23:32Z (host clock; today is 2026-05-18)
- **Completed:** 2026-05-19T00:32:31Z
- **Tasks:** 4 (all autonomous; no checkpoints; no auth gates)
- **Files created:** 12 (8 type-source files + 4 type-narrowing test files)
- **Files modified:** 0
- **LOC:** 1,243 total (708 type-source LOC + 407 test LOC + 128 type-source LOC for review/decision/cache/api-gap that have no test files)
- **Test delta:** 620 passed → 620 passed (the 4 new test files contribute 23 new passing assertions; the previous "597 passed" baseline already included assertions added since Plan 04-01 close; net +23 from this plan)

## Accomplishments

- **Five new discriminated unions ship as compile-checked contracts**: `ZAnalysis` (3 variants — `computed | refused/insufficient_days | refused/baseline_mad_zero`), `WeeklyPattern` (2 arms — `detected | no_pattern` with 3 refusal reasons), `Pattern` (1-arm placeholder per D-07 V2 expansion path), `DecisionPrompt` (2 arms — `silent | none_this_week`), `ReviewDecisionsInput` + `ReviewDecisionsResult` (2 arms each — `list | update`), and `QueryCacheInput` (8 arms — one per cache resource). Every union has an exhaustive-switch consumer site so adding an arm without a matching case is a `tsc --noEmit` error — the ADR-0004 forcing function applied at the type system.

- **D-04's 9-metric tuple, D-11's 5-candidate type-anchor, D-13's tier thresholds all encoded at the type level**: `METRIC_NAMES` is a 9-tuple `as const` (the names match D-04 verbatim, in D-04 order); `CANDIDATE_FACTORS_TYPE_ONLY` is a 5-tuple (the load-bearing module-load constant + dropped-candidates rationale comment ships in Plan 04-05 `candidates.ts`); `ConfidenceGate.minRequired: 10 | 20` documents the D-13 thresholds via the literal-tuple-as-doc pattern.

- **D-34's `pattern_confidence: 'weak' | 'strong'` lives on the `detected` arm only** (NOT a top-level WeeklyReviewResult slot). The 14 ≤ N < 20 → `weak` / N ≥ 20 → `strong` semantics live in Plan 04-05's pattern detector; this plan locks the type-system half of the contract.

- **D-07's `patterns: Pattern[]` slot exists on `DailyReviewResult`** with a single `placeholder_v1_empty` discriminator arm. The renderer omits the section when the array is empty; V2 will add arms without breaking v1 consumers because the union widens (not the field shape).

- **D-18's multi-detection schema is in place**: `WeeklyReviewResult.pattern` carries the smallest-p_adjusted winner; `WeeklyReviewResult.candidate_results: CandidateResult[]` carries the full ranked list per ADR-0004 §If FDR set empty ("lists the unranked candidates as context, not as a recommendation"). Plan 04-05 enforces the "smallest p_adjusted" selection at the detector site.

- **T-04-S4 threat mitigation closes at the type level**: `QueryCacheInput` is an 8-arm discriminated union where each arm enumerates exactly the filters valid for that resource. Free-form SQL is unreachable — even the most permissive arm only accepts the listed filters. The Zod schema in Plan 04-10 will mirror this shape verbatim so untrusted MCP input cannot widen the contract at runtime.

## Task Commits

| # | Task | Commit | Type |
|---|------|--------|------|
| 1 | Add failing tests for baselines + confidence types (RED) | `51ce26d` | test |
| 1 | Add baselines + confidence type contracts (GREEN) | `f27afaa` | feat |
| 2 | Add failing tests for anomalies + patterns types (RED) | `0d66968` | test |
| 2 | Add anomalies + patterns type contracts (GREEN) | `09a9461` | feat |
| 3 | Add review type contracts (DailyReviewResult, WeeklyReviewResult) | `03279d8` | feat |
| 4 | Add service-layer type contracts (decision, cache, api-gap) | `d70bb9c` | feat |

Tasks 1 + 2 are TDD — each ships a RED commit (failing tests; type-only imports compile via `verbatimModuleSyntax` so the vitest RED for those files comes from the value imports in Task 1's baselines test and Task 2's patterns test). Tasks 3 + 4 are pure interface declarations with no runtime exports beyond the existing tuples already shipped in Tasks 1 + 2; `tsc --noEmit` is the contract per the plan's `<verify>` block. No refactor commits required.

## Files Created / Modified

**Created (12)**

Domain types (5 source + 4 test):
- `src/domain/baselines/types.ts` (83 LOC) — `METRIC_NAMES` 9-tuple, `MetricName` derived type, `METRIC_NAMES_SET` runtime check, `BaselineStats` interface with `mad` raw + `coverage_pct` fields.
- `src/domain/baselines/types.test.ts` (74 LOC) — 4 assertions across 2 describe blocks; tuple-shape + ReadonlySet + BaselineStats narrowing via exhaustive switch.
- `src/domain/confidence/types.ts` (51 LOC) — `ConfidenceTier` 3-literal, `ConfidenceGate` with `minRequired: 10 | 20`.
- `src/domain/confidence/types.test.ts` (64 LOC) — 4 assertions across 2 describe blocks; tier exhaustive switch + 3 gate-threshold variants.
- `src/domain/anomalies/types.ts` (87 LOC) — `ZAnalysis` 3-variant discriminated union, `Anomaly` interface.
- `src/domain/anomalies/types.test.ts` (123 LOC) — 6 assertions across 2 describe blocks; 3 ZAnalysis arms via exhaustive switch + Anomaly direction narrowing.
- `src/domain/patterns/types.ts` (112 LOC) — `CANDIDATE_FACTORS_TYPE_ONLY` 5-tuple, `CandidateName` derived type, `WeeklyPattern` 2-arm discriminated union (with D-34 ADDITIVE `pattern_confidence` on `detected` arm), `CandidateResult`, `WorstDay`.
- `src/domain/patterns/types.test.ts` (146 LOC) — 9 assertions across 5 describe blocks; 5-tuple shape + 2 detected variants + 3 no_pattern refusal-reason arms + CandidateResult + WorstDay + CandidateName narrowing.
- `src/domain/review/types.ts` (205 LOC) — `TodayMetrics` (9 fields, each `number | null`), `DataStatus`, `SuggestedAction`, `Pattern` placeholder (D-07), `DailyReviewResult` (D-03 7-slot), `WeekSummary`, `DecisionPrompt` 2-arm union (D-22), `WeeklyReviewResult` (D-16 6-slot).

Service types (3 source, no test files per plan):
- `src/services/decision/types.ts` (101 LOC) — `AddDecisionInput` (D-19), `ReviewDecisionsInput` 2-arm dual-mode union (D-21), `ReviewDecisionsResult`, `UpdateDecisionInput`.
- `src/services/cache/types.ts` (148 LOC) — `QueryCacheInput` 8-arm discriminated union (D-24), `QueryCacheResource` derived discriminator, `QueryCacheResult`, entity-type re-exports.
- `src/services/api-gap/types.ts` (49 LOC) — `ApiGapEntry` (D-28; `available_via_v2_api: false` literal), `ApiGapResult`.

**Modified (0)** — none. Plan 04-02 is purely additive.

## Decisions Made

- **`ZAnalysis` has 3 variants, not 2** — `baseline_mad_zero` is distinct from `insufficient_days`. RESEARCH §Statistical Engine §1 calls this out: a flat-data baseline (MAD = 0 from constant `respiratory_rate` quantization to 0.1 bpm) is structurally different from a small-sample baseline. The third variant has no `days_required` field because the issue is not sample size.

- **`CANDIDATE_FACTORS_TYPE_ONLY` lives in `patterns/types.ts`, not `candidates.ts`** — to avoid a circular `types.ts → candidates.ts → types.ts` cycle when downstream code (e.g., `WeeklyReviewResult` in `review/types.ts`) only wants the type. Plan 04-05's `candidates.ts` re-exports the same string values as the load-bearing module-load constant + dropped-candidates rationale comment + a deep-equal assertion that keeps the two in sync.

- **`pattern_confidence` is on the `detected` arm only, NOT a top-level slot** (D-34 ADDITIVE). The type system rejects reading `result.pattern_confidence` when `result.pattern.kind === 'no_pattern'`. The non-discriminator annotation pattern (a field added to one arm of an existing union) preserves the ADR-0004 narrowing discipline while letting the formatter render a "small sample — effect estimates imprecise" caveat distinct from the kind-discriminator.

- **`available_via_v2_api: false` is a literal-`false` type, not `boolean`** — every v1 catalog entry is unavailable; locking the literal at the type level documents the contract and refuses (at compile time) an accidentally-added `true` entry. Phase 5 may add a `true` arm if the catalog grows to include "available but not surfaced" entries; v1 keeps the surface narrow.

- **`QueryCacheResult.rows: unknown[]` over a generic-discriminator type** — a parametrized `QueryCacheResult<R extends QueryCacheResource>` was rejected because it forces every consumer to thread the generic through every call site. `unknown[]` at the service boundary + a switch on `result.resource` at the Wave 3 formatter dispatch site is simpler and matches D-24's "service surface is uniform" principle.

- **Exhaustive-switch test bodies cast through the union type** to widen TS's literal narrowing. `const name = METRIC_NAMES[0] as MetricName` is the load-bearing pattern — without the `as` cast, TS narrows `name` to the literal `'recovery_score'` from the const tuple and refuses the other case branches as 'not comparable to type "recovery_score"'. Same fix applied to the CandidateName narrowing test in `patterns/types.test.ts`.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - TS literal narrowing] Exhaustive switch case branches refused by `tsc --noEmit`**
- **Found during:** Task 1 GREEN (post-implementation `tsc --noEmit`)
- **Issue:** The first draft of `baselines/types.test.ts`'s exhaustive-switch body declared `const name: MetricName = 'recovery_score'`. With `noUncheckedIndexedAccess` + the const-narrowing `tsc` performs from the `MetricName = (typeof METRIC_NAMES)[number]` literal-union derivation, `name` was narrowed to the literal `'recovery_score'` and the other 8 case branches errored with `TS2678: Type '"hrv_rmssd_milli"' is not comparable to type '"recovery_score"'` (× 8).
- **Fix:** Replaced the literal initializer with `const name = METRIC_NAMES[0] as MetricName` — the `as MetricName` cast widens past the literal narrowing so the exhaustive switch's other branches stay reachable AND the exhaustiveness check is still meaningful (adding a 10th metric to METRIC_NAMES without adding a `case` in the switch is still a `tsc --noEmit` error because the cast is to the wider union).
- **Files modified:** `src/domain/baselines/types.test.ts`. Same pattern applied preemptively to `src/domain/patterns/types.test.ts` (CandidateName narrowing test); the patterns test's RED commit already had the correct shape.
- **Verification:** `npx tsc --noEmit` returns the same 3 pre-existing Phase 2/3 baseline errors (no new errors introduced); all 4 type-narrowing test files green.
- **Committed in:** `f27afaa` (Task 1 GREEN commit).

**2. [Rule 3 - Biome] Import sorting + multi-line `expect()` auto-format**
- **Found during:** Tasks 1, 2, 3 (post-`tsc --noEmit`, pre-commit lint run)
- **Issue:** (a) `baselines/types.test.ts` first draft had `import { METRIC_NAMES, METRIC_NAMES_SET, type BaselineStats, type MetricName }` — Biome's `assist/source/organizeImports` rule wants `type` imports sorted after value imports. (b) `patterns/types.test.ts`'s 80-char-overflow `expect(...).toBe(...)` lines wanted to wrap across 3 lines. (c) `review/types.ts` import order followed module-tree depth, not alphabetical.
- **Fix:** (a) Reordered the import to `{ type BaselineStats, METRIC_NAMES, METRIC_NAMES_SET, type MetricName }` manually. (b) + (c) Auto-applied `biome check --write`.
- **Files modified:** `src/domain/baselines/types.test.ts`, `src/domain/patterns/types.test.ts`, `src/domain/review/types.ts`.
- **Verification:** `npm run lint` clean (1 pre-existing info-level hint in `infrastructure/whoop/resources/recovery.ts` is out of scope per SCOPE BOUNDARY rule, same as Plan 04-01 close).
- **Committed in:** `f27afaa` (Task 1 GREEN), `09a9461` (Task 2 GREEN), `03279d8` (Task 3).

---

**Total deviations:** 2 auto-fixed (1 TS literal-narrowing fix, 1 Biome formatter run). Both blocking; both inside scope of the affected tasks; no new files touched outside the plan's `files_modified` list. No scope creep.

## Issues Encountered

- **Pre-existing baseline TS errors** (3 total, unchanged from Phase 3 close): `src/cli/commands/auth.ts:97` + `tests/helpers/msw-whoop-oauth.ts:74,82`. Out of scope per SCOPE BOUNDARY rule (already documented in Plan 04-01 SUMMARY).
- **Pre-existing Biome info hint** (1 total, unchanged): `src/infrastructure/whoop/resources/recovery.ts:48` `useTemplate` suggestion. Out of scope per SCOPE BOUNDARY rule.

Nothing else. Tightly-scoped pure-type work executed end-to-end without escalation.

## User Setup Required

None — this plan is pure TypeScript type declarations. No external services, no auth gates, no config flags, no npm installs (Plan 04-01 already installed `ulid` + `simple-statistics`; this plan doesn't import them).

## Next Phase Readiness

Wave 0 contracts are complete. Every Phase 4 plan from 04-03 through 04-12 has compile-checked types to implement against:

- **Plan 04-03 (domain/stats — median + MAD + Mann-Whitney + BH FDR)**: pure functions over `number[]`; no Phase 4 type imports needed beyond `BaselineStats` (the median + MAD computation returns the fields directly).
- **Plan 04-04 (baselines/index.ts + confidence/index.ts)**: returns `BaselineStats[]` + `ConfidenceGate` per the locked shapes.
- **Plan 04-05 (patterns/candidates.ts + patterns/pattern.ts)**: writes the 5-candidate load-bearing module-load constant (deep-equal to `CANDIDATE_FACTORS_TYPE_ONLY` here) and returns `WeeklyPattern` + `CandidateResult[]`.
- **Plan 04-06 (services/review/)**: composes `DailyReviewResult` + `WeeklyReviewResult` from upstream domain modules.
- **Plan 04-07 (decision service)**: implements `services.addDecision(input: AddDecisionInput)` + `services.reviewDecisions(input: ReviewDecisionsInput)`.
- **Plan 04-08 (action catalog + decision-prompt catalog)**: populates `SuggestedAction[]` + `DecisionPromptCatalogEntry[]`.
- **Plan 04-09 (formatters)**: renders the 5 typed results via Shared Pattern 5 (`(typedResult) => string`); `formatter-tone.test.ts` (scaffolded in Plan 04-01) fills in against these types.
- **Plan 04-10 (cache + api-gap services)**: implements `services.queryCache(input: QueryCacheInput): QueryCacheResult` (with the Zod schema mirroring the 8-arm shape verbatim per T-04-S4 mitigation) + `services.getApiGaps(): ApiGapResult`.
- **Plan 04-11 (MCP tools)**: wires 7 new tools to the service surface; `mcp-tool-shape.test.ts` (scaffolded) asserts the dual-shape contract.
- **Plan 04-12 (MCP resources + prompts + phase close)**: wires 6 resources + 4 prompts through `register-resource.ts` + `register-prompt.ts` (shipped Plan 04-01).

Plan 04-03 (domain stats — `domain/stats/median.ts` + `domain/stats/mad.ts` + `domain/stats/mann-whitney.ts` + `domain/stats/fdr.ts`) is unblocked.

## TDD Gate Compliance

Plan 04-02 frontmatter is `type: execute` (not `type: tdd`), so the plan-level RED/GREEN/REFACTOR gate sequence does not apply. The 2 TDD tasks (Tasks 1 + 2) each landed a RED commit followed by a GREEN commit per the per-task `tdd="true"` attribute; Tasks 3 + 4 are pure interface declarations without sibling test files per the plan's `<verify>` block (`tsc --noEmit` is the contract).

## Self-Check: PASSED

| Item | Status |
|------|--------|
| `src/domain/baselines/types.ts` exists | FOUND |
| `src/domain/baselines/types.test.ts` exists | FOUND |
| `src/domain/confidence/types.ts` exists | FOUND |
| `src/domain/confidence/types.test.ts` exists | FOUND |
| `src/domain/anomalies/types.ts` exists | FOUND |
| `src/domain/anomalies/types.test.ts` exists | FOUND |
| `src/domain/patterns/types.ts` exists | FOUND |
| `src/domain/patterns/types.test.ts` exists | FOUND |
| `src/domain/review/types.ts` exists | FOUND |
| `src/services/decision/types.ts` exists | FOUND |
| `src/services/cache/types.ts` exists | FOUND |
| `src/services/api-gap/types.ts` exists | FOUND |
| Commit `51ce26d` (Task 1 RED) | FOUND |
| Commit `f27afaa` (Task 1 GREEN) | FOUND |
| Commit `0d66968` (Task 2 RED) | FOUND |
| Commit `09a9461` (Task 2 GREEN) | FOUND |
| Commit `03279d8` (Task 3) | FOUND |
| Commit `d70bb9c` (Task 4) | FOUND |
| `tsc --noEmit` returns the 3 pre-existing Phase 2/3 baseline errors only (no new errors) | VERIFIED |
| All 10 grep gates exit 0 | VERIFIED |
| Full vitest suite (620 passed / 15 todo / 5 skipped) | VERIFIED |

---
*Phase: 04-domain-math-reviews-decision-ledger-mcp-surface*
*Completed: 2026-05-18*
