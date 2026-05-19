---
phase: 04-domain-math-reviews-decision-ledger-mcp-surface
plan: 03
subsystem: domain/stats
tags: [stats, median, mad, mann-whitney, fdr, benjamini-hochberg, tdd, wave-1, pure-math, fixtures]

requires:
  - phase: 04-domain-math-reviews-decision-ledger-mcp-surface (Plan 04-01)
    provides: simple-statistics@^7.8.9 installed (`median`, `medianAbsoluteDeviation`, `wilcoxonRankSum`, `cumulativeStdNormalProbability` all available as named exports — verified at run time during this plan)
  - phase: 04-domain-math-reviews-decision-ledger-mcp-surface (Plan 04-02)
    provides: ZAnalysis discriminated union (anomalies/types.ts — `baseline_mad_zero` refused-arm anchors the MAD=0 contract that this plan's `robustSigma` returns 0 for); WeeklyPattern + CandidateResult (patterns/types.ts — the result types the FDR + Mann-Whitney machinery will populate in Plan 04-05)

provides:
  - src/domain/stats/median.ts — `median(values: number[]): number`; wrapper over `simple-statistics.median` with empty-input guard; T-04-S1 STRIDE mitigation
  - src/domain/stats/mad.ts — `MAD_CONSISTENCY = 1.4826` constant (Rousseeuw & Croux 1993; REV-01 anchor) + `robustSigma(values: number[]): number = 1.4826 * medianAbsoluteDeviation(values)`; returns 0 on constant-value baseline (MAD=0); caller surfaces `ZAnalysis.refused.baseline_mad_zero`
  - src/domain/stats/mann-whitney.ts — `mannWhitney(sampleX, sampleY): {U, p}`; U = R_1 − n_1(n_1+1)/2 via `wilcoxonRankSum`; two-sided p via normal approximation with continuity correction (`cumulativeStdNormalProbability`); clamped into [0, 1]; throws when either sample < 2
  - src/domain/stats/fdr.ts — `benjaminiHochberg(pvalues, q): {rejected, adjusted}`; hand-rolled step-up procedure per Benjamini & Hochberg (1995); typed positive output even at 0 rejections (ADR-0004 forcing function); zero imports — pure JavaScript over number arrays
  - tests/fixtures/weekly-fdr/bh_downgrades_marginal.fixture.json — REV-07 load-bearing per D-35; p-values [0.05, 0.20, 0.30, 0.45, 0.60] at q=0.10 → 0 rejections
  - tests/fixtures/weekly-fdr/bh_partial_rejection.fixture.json — D-35 secondary (D-15 originals preserved); p-values [0.01, 0.04, 0.05, 0.20, 0.50] at q=0.10 → 3 rejections at kStar=3

affects: [04-04 baselines+confidence (consumes `median` + `robustSigma` to compute trailing-30-day BaselineStats per metric; `ZAnalysis.refused.baseline_mad_zero` fires when `robustSigma === 0`), 04-05 patterns (consumes `mannWhitney` per candidate + `benjaminiHochberg` across the 5 p-values; bh_downgrades_marginal anchors the "no pattern" path; bh_partial_rejection anchors the D-34 pattern_confidence path), 04-06 review services (composes the above into DailyReviewResult + WeeklyReviewResult)]

tech-stack:
  added: []
  patterns:
    - "Pure-math domain layer — 4 source files under src/domain/stats/ with zero project-internal imports (only simple-statistics for 3 of the 4; fdr.ts has zero imports at all). The strictest layer in the codebase: no console.*, no fs/fetch, no Date.now, no logger. agent_docs/conventions.md §Module layout."
    - "Throw-on-degenerate-input as T-04-S1 STRIDE mitigation. median([]) throws, robustSigma([]) throws, mannWhitney() throws on n<2. The throw is the boundary check that surfaces upstream misuse rather than the policy gate (D-13 floor lives in Plan 04-05)."
    - "Numerical clamp into [0, 1] on Mann-Whitney's returned p-value. The continuity correction subtracts 0.5 from |U − muU|, which goes negative in the identical-samples regime and drives 2(1 − Phi(z)) above 1. Clamping defends the FDR step-up procedure (next file) and the downstream BH-adjusted p calculations from ever seeing p > 1."
    - "ADR-0004 typed positive output for absence — benjaminiHochberg returns a structurally-complete {rejected: boolean[], adjusted: number[]} even when 0 hypotheses are rejected. The bh_downgrades_marginal fixture's 'rejected.every(r => r === false) AND adjusted.length === pvalues.length' assertion locks the contract."
    - "Key-link pattern attestation in source — src/domain/stats/mad.ts contains the literal '1.4826' (verified via grep against the source file); src/domain/stats/mann-whitney.ts imports both wilcoxonRankSum and cumulativeStdNormalProbability from simple-statistics (verified via the plan's key_links regex). Plan frontmatter must_haves satisfied verbatim."

key-files:
  created:
    - src/domain/stats/median.ts (19 LOC — wrapper over simple-statistics.median with empty-input guard; min_lines 8)
    - src/domain/stats/median.test.ts (36 LOC — 6 tests covering odd + even + ties + single + two-element + empty-throws)
    - src/domain/stats/mad.ts (37 LOC — MAD_CONSISTENCY constant + robustSigma; min_lines 15)
    - src/domain/stats/mad.test.ts (44 LOC — 5 tests covering the 1.4826 constant + odd + even worked examples + constant-array + empty-throws)
    - src/domain/stats/mann-whitney.ts (63 LOC — mannWhitney with continuity-corrected p-value and [0,1] clamp; min_lines 30)
    - src/domain/stats/mann-whitney.test.ts (88 LOC — 6 tests covering input validation + 3 worked examples + numerical-clamp safety suite)
    - src/domain/stats/fdr.ts (87 LOC — benjaminiHochberg step-up with monotonization; min_lines 25)
    - src/domain/stats/fdr.test.ts (123 LOC — 9 tests covering degenerate inputs + both D-35 fixtures + determinism + shuffled-input position preservation)
    - tests/fixtures/weekly-fdr/bh_downgrades_marginal.fixture.json (8 LOC — D-35 load-bearing; pvalues [0.05, 0.20, 0.30, 0.45, 0.60], q=0.10, expected kStar=-1, 0 rejections)
    - tests/fixtures/weekly-fdr/bh_partial_rejection.fixture.json (9 LOC — D-35 secondary; pvalues [0.01, 0.04, 0.05, 0.20, 0.50], q=0.10, expected kStar=3, 3 rejections at positions [0,1,2])
  modified: []

key-decisions:
  - "MAD_CONSISTENCY is exported as a named module-level constant, not inlined. The 1.4826 factor is REV-01's explicit requirement (Rousseeuw & Croux 1993, `1 / Φ⁻¹(0.75)`); exporting it lets downstream baseline code reference the constant rather than re-declare the magic number. Same precedent as Phase 3's SCORE_STATES_SET — runtime values that lock a spec contract get named exports."
  - "Mann-Whitney p-value clamped into [0, 1] at the function boundary, not at the caller. The continuity correction makes the identical-samples regime numerically yield p > 1; clamping inside mannWhitney defends every downstream consumer (the FDR step-up, the formatter, the test fixtures) from ever seeing an out-of-range p. Locked by the 'numerical safety' test block that runs 3 identical-samples inputs and asserts p ∈ [0, 1] across the lot."
  - "benjaminiHochberg has ZERO imports. The algorithm is pure JavaScript over number arrays — no simple-statistics dependency, no Math.random (which would defeat the determinism that REV-07 fixtures rely on). The 'determinism' test block runs the same input twice and asserts identical output to lock the no-randomness contract."
  - "ADR-0004 typed positive output anchored at the FDR layer, not just the renderer. benjaminiHochberg([], q) returns {rejected: [], adjusted: []} (degenerate) and bh_downgrades_marginal returns {rejected: [false × 5], adjusted: [...]} (0 rejections but structurally complete). The next plan's renderer reads adjusted[] for diagnostic context even when nothing cleared — the 'no reliable pattern detected' branch is a first-class output, not a fallback string."
  - "The 'shuffled input position preservation' test in fdr.test.ts ([0.05, 0.01, 0.04, 0.50, 0.20] permuted from the bh_partial_rejection fixture) is the load-bearing contract that BH's pair-sort-walk-remap algorithm correctly maps sorted-rank rejections back to ORIGINAL input positions. Without it, a future refactor that drops the .map((p, i) => ({p, i})) step would silently scramble rejected[] by sorted rank — caught at test time, not at runtime."

patterns-established:
  - "Strictest-layer file shape for src/domain/stats/*.ts: a leading docstring block citing the source paper / textbook, the algorithm in code-comment form (verbatim from RESEARCH §Statistical Engine), the single allowed import (simple-statistics; or none for fdr.ts), the function body, and zero non-paper / non-algorithm prose. The four files together are 207 LOC of pure code (target was ~90; the extra LOC are all explanatory comments and JSDoc — the executable surface is roughly 60 LOC)."
  - "TDD cycle when the source file does not yet exist: write the test importing from './X.js'; vitest fails with 'Cannot find module' — this IS a valid RED. Commit the test, write the implementation, watch the test pass on first run (or iterate the implementation until it does). All 4 functions in this plan landed RED → GREEN cleanly on the first GREEN attempt with the single exception of the [1,3,5] vs [2,4,6,...] p-value expectation (see Deviations below)."

requirements-completed: []
# REV-01 and REV-07 are the dependency requirements of this plan but they remain Active in REQUIREMENTS.md — the requirements themselves close in the implementing plans (REV-01 in Plan 04-04 baselines; REV-07 in Plan 04-05 patterns + Plan 04-06 weekly review). This plan ships the primitives those plans compose.

duration: 5min 50s
completed: 2026-05-19
---

# Phase 4 Plan 03: Pure Statistical Primitives Summary

**Phase 4 Wave 1 — shipped 4 pure-math primitives (`median`, `robustSigma`, `mannWhitney`, `benjaminiHochberg`) + 2 D-35 FDR fixtures across 8 RED/GREEN/REFACTOR commits. The strictest layer in the codebase: no I/O, no clock, no logger, no project-internal imports. Anchors REV-01 (1.4826 consistency factor) and REV-07 (BH-corrected weekly patterns) at the math layer so downstream plans compose without re-vetting the numbers.**

## Performance

- **Duration:** 5 min 50 s
- **Started:** 2026-05-19T23:30:49Z
- **Completed:** 2026-05-19T23:36:39Z
- **Tasks:** 8 (RED + GREEN per function, plus a final REFACTOR commit)
- **Files created:** 10 (4 source + 4 test + 2 fixture JSONs)
- **Files modified:** 0
- **Commits:** 9 (8 RED/GREEN/REFACTOR + this docs commit at the close)

## What Shipped

### `src/domain/stats/median.ts` (19 LOC, 6 tests)

Wrapper over `simple-statistics.median` with an empty-input guard. The throw on `[]` is the T-04-S1 STRIDE mitigation — silent NaN propagation through the baseline / anomaly stack would corrupt downstream Z-scores. Six tests lock the worked-example behavior: odd-length `[3, 1, 2] → 2`, even-length `[1, 2, 3, 4] → 2.5`, all-tied `[2, 2, 2, 2] → 2`, single `[42] → 42`, two-element `[1, 3] → 2`, empty array throws.

### `src/domain/stats/mad.ts` (37 LOC, 5 tests)

`MAD_CONSISTENCY = 1.4826` exported as a named module-level constant (Rousseeuw & Croux 1993: `1 / Φ⁻¹(0.75)` — the consistency factor that makes MAD a consistent estimator of σ for normally-distributed data). REV-01's explicit requirement is anchored at this line. The function `robustSigma(values) = MAD_CONSISTENCY * medianAbsoluteDeviation(values)` throws on empty input and returns 0 on constant-value baselines. Five tests lock: the constant export, the empty-throws contract, the MAD=0 edge (`[5,5,5,5,5] → 0`), and two worked examples — odd-length `[1,2,3,4,5]` (median=3, deviations=[2,1,0,1,2], MAD=1, robustSigma=1.4826) and even-length `[1,2,3,4]` (median=2.5, deviations=[1.5,0.5,0.5,1.5], MAD=1, robustSigma=1.4826). The plan's key-link grep pattern `1\.4826` matches the source file at line 30.

### `src/domain/stats/mann-whitney.ts` (63 LOC, 6 tests)

`mannWhitney(sampleX, sampleY): {U, p}` implementing 04-RESEARCH §Statistical Engine §4 verbatim. Imports `wilcoxonRankSum` and `cumulativeStdNormalProbability` from `simple-statistics` (satisfies the plan's key-link grep). U is converted from the rank-sum statistic via `U_1 = R_1 − n_1(n_1+1)/2`. The two-sided p-value uses the normal approximation with continuity correction; the result is clamped into [0, 1] to defend against the identical-samples regime where `2(1 − Φ(z))` numerically exceeds 1. Throws when either sample has fewer than 2 values (Pitfall 2 boundary check; the D-13 floor of N_scored ≥ 14 keeps live calls well above this).

Six tests lock: input validation (n_1 < 2 throws, n_2 < 2 throws); worst-case `[1..5] vs [6..10]` → U=0, p < 0.05; identical `[3,3,3] vs [3,3,3]` → U=4.5, p ∈ [0.9, 1.0] (post-clamp); asymmetric `[1,3,5] vs [2,4,6,8,10,12,14,16]` → U=3, p ≈ 0.0818; and a dedicated numerical-clamp suite that runs three small-sample identical-input cases and asserts p ∈ [0, 1] across all of them.

### `src/domain/stats/fdr.ts` (87 LOC, 9 tests)

`benjaminiHochberg(pvalues, q): {rejected, adjusted}` — hand-rolled step-up procedure per Benjamini & Hochberg (1995) and 04-RESEARCH §Statistical Engine §5 verbatim. Zero imports — pure JavaScript over number arrays so the determinism contract is local. ADR-0004 forcing function: the function returns a structurally-complete result even when 0 hypotheses are rejected, with `adjusted[]` available as diagnostic context for the renderer.

Nine tests cover: empty input `[] → {rejected: [], adjusted: []}` (degenerate); single sufficient p `[0.01] at q=0.10 → rejected[0]=true, adjusted[0]=0.01`; D-35 load-bearing fixture (`bh_downgrades_marginal.fixture.json` → 0 rejections, structurally complete adjusted array, monotone non-decreasing in input order); D-35 secondary fixture (`bh_partial_rejection.fixture.json` → 3 rejections at positions [0,1,2], adjusted values match canonical monotonization [0.05, 0.0833, 0.0833, 0.25, 0.50]); and the determinism block (same input twice → identical output; shuffled `[0.05, 0.01, 0.04, 0.50, 0.20]` → rejected at the same INPUT positions, locking the pair-sort-walk-remap contract).

### Fixtures (REV-07 load-bearing per D-35)

`tests/fixtures/weekly-fdr/bh_downgrades_marginal.fixture.json` is the REV-07 anchor: p-values `[0.05, 0.20, 0.30, 0.45, 0.60]` at q=0.10 yield 0 rejections under BH step-up. The smallest p (0.05) would have been significant at unadjusted α=0.05 but FDR correctly suppresses it. The fixture's `_comment` field documents the walk-down trace.

`tests/fixtures/weekly-fdr/bh_partial_rejection.fixture.json` preserves the D-15 original numbers (`[0.01, 0.04, 0.05, 0.20, 0.50]` at q=0.10) → 3 rejections at kStar=3, exercising the D-34 `pattern_confidence` annotation path when Plan 04-05's pattern detector composes through.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 — Plan text bug] Asymmetric Mann-Whitney p-value expectation was 0.126; actual is 0.0818**

- **Found during:** Task 6 (GREEN for mannWhitney)
- **Issue:** The plan's verbatim test description for the asymmetric-samples worked example ("`sampleX = [1, 3, 5]`, `sampleY = [2, 4, 6, 8, 10, 12, 14, 16]`") said "sampleX has ranks 1, 3, 6" implying R_1 = 10 and p ≈ 0.126. Live verification via `node -e "require('simple-statistics').wilcoxonRankSum([1,3,5], [2,4,6,8,10,12,14,16])"` returned R_1 = 9 (ranks 1, 3, 5 — the value 6 is at rank 6 in sampleY, NOT in sampleX). Recomputed U=3, z≈1.735, p≈0.0818.
- **Fix:** Set the assertion to `expect(p).toBeCloseTo(0.0818, 3)` and updated the test docstring to show the corrected merged-sort and rank derivation. The math derivation in the source-file comment block stays canonical (it always referred to RESEARCH §4's formula, not to the plan's incorrect rank attribution).
- **Files modified:** `src/domain/stats/mann-whitney.test.ts`
- **Commit:** 3afeeb6 (GREEN)

**2. [Rule 3 — Blocking format] Biome line-wrap on numerical-clamp tuple literal**

- **Found during:** Verification step (npm run lint)
- **Issue:** The `Array<[number[], number[]]>` case literal for the numerical-clamp suite fits on three short lines under 100 chars per pair, but Biome's nested-array formatter prefers each inner array on its own line.
- **Fix:** `npm run format` auto-applied the expanded layout. No semantic change.
- **Files modified:** `src/domain/stats/mann-whitney.test.ts`
- **Commit:** 97a0b05 (REFACTOR)

### Deferred Items

3 pre-existing baseline TS errors in `src/cli/commands/auth.ts:97:35` (TS2379) and `tests/helpers/msw-whoop-oauth.ts:74,82` (TS2345) remain out of scope per the SCOPE BOUNDARY rule — unchanged since Plan 03-04 first logged them. Same pattern as Plans 03-05 through 03-12 + 04-01 + 04-02.

1 pre-existing Biome info-level hint in `src/infrastructure/whoop/resources/recovery.ts:48` (useTemplate suggestion on a string concatenation) — unchanged since Plan 03-12. Out of scope per the SCOPE BOUNDARY rule.

### Authentication Gates

None. This plan is pure-math; no network, no auth, no I/O.

## ADR Compliance Check

- **ADR-0001 (MCP stdout purity):** All 4 source files have zero `console.*` (verified by Biome's `noConsole: error` rule and by Gate B grep). The stats functions log nothing — they return values.
- **ADR-0004 ("no reliable pattern detected" is a positive output):** `benjaminiHochberg` returns a structurally-complete `{rejected, adjusted}` when 0 hypotheses are rejected. The bh_downgrades_marginal fixture's test asserts both `rejected.every(r => r === false)` AND `adjusted.length === pvalues.length` — proving the renderer downstream can read adjusted-p values for diagnostic context.
- **ADR-0005 (banned tone words):** No banned tokens in any source or test file (verified by Gate A). No emoji codepoints. Test descriptions use direct language ("rejects positions 0, 1, 2", "throws on empty array").
- **ADR-0006 (fixture-only tests):** No live network. The 2 FDR fixture JSON files live under `tests/fixtures/weekly-fdr/` per conventions.md §Testing. fdr.test.ts loads them via `readFileSync` + `JSON.parse` (synchronous, deterministic, offline-runnable).

## Verification

```
$ npx vitest run src/domain/stats/
 Test Files  4 passed (4)
      Tests  26 passed (26)
   Duration  174ms

$ npm run test                            # full suite
 Test Files  65 passed | 5 skipped (70)
      Tests  646 passed | 15 todo (661)
   Duration  9.23s

$ npm run lint                            # biome check
 Checked 165 files. Found 1 info (pre-existing recovery.ts useTemplate).

$ bash scripts/ci-grep-gates.sh
 All grep gates passed.

$ grep -n "1\.4826" src/domain/stats/mad.ts
 9: // multiply by 1 / Φ⁻¹(0.75) ≈ 1.4826. The constant is exported so the
 30:export const MAD_CONSISTENCY = 1.4826;

$ grep -n "wilcoxonRankSum\|cumulativeStdNormalProbability" src/domain/stats/mann-whitney.ts
 32:import { cumulativeStdNormalProbability, wilcoxonRankSum } from 'simple-statistics';
 48:  const rankSum = wilcoxonRankSum(sampleX, sampleY);
 56:  const pRaw = 2 * (1 - cumulativeStdNormalProbability(z));
```

## Commits (this plan)

| Hash    | Type     | Message                                                                  |
| ------- | -------- | ------------------------------------------------------------------------ |
| 84c102e | test     | add failing tests for median primitive                                   |
| 13bc8d0 | feat     | implement median primitive against worked examples                       |
| 96fa631 | test     | add failing tests for robustSigma + MAD_CONSISTENCY                      |
| f0d0bde | feat     | implement robustSigma with MAD_CONSISTENCY = 1.4826                      |
| a79438b | test     | add failing tests for mannWhitney                                        |
| 3afeeb6 | feat     | implement mannWhitney against worked examples                            |
| 92c6c54 | test     | add failing tests + D-35 fixtures for benjaminiHochberg                  |
| 7c80a7e | feat     | implement benjaminiHochberg against D-35 fixtures                        |
| 97a0b05 | refactor | ensure stats primitives are pure and fixture-tested                      |

## TDD Gate Compliance

All four functions ship as RED → GREEN pairs in git log order:

- median: 84c102e (test) → 13bc8d0 (feat)
- robustSigma: 96fa631 (test) → f0d0bde (feat)
- mannWhitney: a79438b (test) → 3afeeb6 (feat)
- benjaminiHochberg: 92c6c54 (test) → 7c80a7e (feat)

REFACTOR commit (97a0b05) at the end covers the Biome format auto-fix on `mann-whitney.test.ts` — the executable surface is unchanged from GREEN.

## Self-Check: PASSED

- **Files exist:**
  - `src/domain/stats/median.ts` — FOUND
  - `src/domain/stats/mad.ts` — FOUND
  - `src/domain/stats/mann-whitney.ts` — FOUND
  - `src/domain/stats/fdr.ts` — FOUND
  - `src/domain/stats/median.test.ts` — FOUND
  - `src/domain/stats/mad.test.ts` — FOUND
  - `src/domain/stats/mann-whitney.test.ts` — FOUND
  - `src/domain/stats/fdr.test.ts` — FOUND
  - `tests/fixtures/weekly-fdr/bh_downgrades_marginal.fixture.json` — FOUND
  - `tests/fixtures/weekly-fdr/bh_partial_rejection.fixture.json` — FOUND
- **Commits exist (verified via `git log --oneline -10`):** 84c102e, 13bc8d0, 96fa631, f0d0bde, a79438b, 3afeeb6, 92c6c54, 7c80a7e, 97a0b05 — all FOUND.
- **Key-link patterns:** `1\.4826` in mad.ts → FOUND. `wilcoxonRankSum|cumulativeStdNormalProbability` in mann-whitney.ts → FOUND.
- **Min LOC:** median 19 ≥ 8 ✓; mad 37 ≥ 15 ✓; mann-whitney 63 ≥ 30 ✓; fdr 87 ≥ 25 ✓.
- **REV-07 fixture contains 0.05:** bh_downgrades_marginal.fixture.json → FOUND.
- **REV-07 secondary contains 0.01:** bh_partial_rejection.fixture.json → FOUND.
