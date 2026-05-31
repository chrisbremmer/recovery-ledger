---
phase: 04-domain-math-reviews-decision-ledger-mcp-surface
plan: 04
subsystem: domain/baselines+anomalies+confidence
tags: [baselines, anomalies, confidence, zscore, mad, direction-map, tdd, wave-1, pure-domain]

requires:
  - phase: 04-domain-math-reviews-decision-ledger-mcp-surface (Plan 04-02)
    provides: BaselineStats + MetricName + METRIC_NAMES (baselines/types.ts); ZAnalysis 3-variant discriminated union + Anomaly (anomalies/types.ts); ConfidenceGate + ConfidenceTier (confidence/types.ts); TodayMetrics 9-field shape (review/types.ts)
  - phase: 04-domain-math-reviews-decision-ledger-mcp-surface (Plan 04-03)
    provides: median(values) wrapper with empty-input guard (stats/median.ts); MAD_CONSISTENCY = 1.4826 named constant (stats/mad.ts — single source of truth for the Rousseeuw & Croux factor); medianAbsoluteDeviation re-exported via simple-statistics

provides:
  - src/domain/baselines/index.ts — `computeBaseline(metric, values, windowDays): BaselineStats`; pure function over already-filtered + already-windowed values; emits raw MAD (consumer composes with MAD_CONSISTENCY); D-02 trailing-30 anchor parameterized via windowDays so the service layer owns the reviewed_date math
  - src/domain/anomalies/direction.ts — `ANOMALY_DIRECTION: Readonly<Record<MetricName, 'low'|'high'|'bidirectional'>>`; Object.freeze module-load constant; 9 entries verbatim per D-06 (4 low + 2 high + 3 bidirectional including the 2 informational-only research-§2-unassigned metrics spo2 + skin_temp)
  - src/domain/anomalies/anomaly.ts — `computeZAnalysis(...)`: 3-variant ZAnalysis output (computed | refused.insufficient_days | refused.baseline_mad_zero); `selectAnomalies(...)`: per-metric D-06 firing rule over METRIC_NAMES; bidirectional metrics never fire; empty Anomaly[] is the ADR-0004 typed positive output
  - src/domain/confidence/index.ts — `confidenceFromCounts({scoredDays, windowDays}): ConfidenceGate`; D-13 thresholds (insufficient < 10, strong >= 20 AND coverage >= 70%, weak otherwise); D-10 'insufficient' tier emission anchored

affects: [04-05 patterns (consumes mannWhitney + benjaminiHochberg from Plan 04-03 — independent of this plan; both flow into Plan 04-07's weekly review composition), 04-07 services/review/daily.ts (composes computeBaseline + selectAnomalies + confidenceFromCounts into DailyReviewResult — this plan's primitives are the chassis), 04-09 formatters (renders ConfidenceGate.tier + Anomaly[] + insufficient_reason verbatim)]

tech-stack:
  added: []
  patterns:
    - "Pure-domain Wave 1 layer — 4 source files across 3 subsystems (baselines, anomalies, confidence). Zero I/O imports; zero logger; zero clock. Only allowed imports: simple-statistics (medianAbsoluteDeviation) + sibling domain modules (stats/median.ts, stats/mad.ts, baselines/types.ts, anomalies/direction.ts). ADR-0001 / Gate B applies even with nothing to log."
    - "Single source of truth for the 1.4826 Rousseeuw & Croux factor: src/domain/stats/mad.ts exports MAD_CONSISTENCY; anomaly.ts imports the named constant rather than re-declaring the literal. Verified by grep — `1.4826` literal appears in mad.ts only across the codebase. Plan frontmatter must_haves contract satisfied."
    - "Object.freeze + satisfies clause for ANOMALY_DIRECTION (Shared Pattern 2). Frozen at module load so runtime mutation is rejected; satisfies clause locks the Readonly<Record<MetricName, ...>> shape at compile time. direction.test.ts asserts Object.isFrozen(ANOMALY_DIRECTION) === true to lock the freeze invariant against a future refactor that swaps Object.freeze for a plain literal."
    - "D-05 three-variant ZAnalysis discriminated union as a forcing function — computeZAnalysis cannot leak NaN: (a) null/non-finite value → refused.insufficient_days (defensive belt-and-braces; caller should pre-filter), (b) daysAvailable < 14 → refused.insufficient_days, (c) baseline.mad === 0 → refused.baseline_mad_zero (Pitfall 12 NaN-cascade fix). Only the (d) computed arm carries a number; downstream consumers MUST narrow on kind === 'computed' before reading .value (TypeScript enforces it)."
    - "Pitfall 5 (mixed-recency Z-refusal) mitigated at the input contract: selectAnomalies accepts `perMetricDaysAvailable: Record<MetricName, number>` so the service layer (Plan 04-07) can pass per-metric counts (HRV at 12 days, sleep at 22 days). The mixed-run test case locks the contract — 2 metrics fire, 1 refuses due to insufficient days, 1 skips because it's bidirectional."
    - "ADR-0004 typed positive output anchored at the firing rule: selectAnomalies returns [] (not undefined, not null, not a thrown error) when no metric clears the D-06 firing rule. The 'returns [] when all metrics are favorable' test locks the contract; downstream consumers can do `for (const a of anomalies)` safely."

key-files:
  created:
    - src/domain/anomalies/direction.ts (42 LOC — Object.freeze module-load constant; satisfies clause; min_lines 20)
    - src/domain/anomalies/direction.test.ts (61 LOC — 11 tests covering 9-entry coverage + per-metric mapping + freeze invariant)
    - src/domain/confidence/index.ts (54 LOC — confidenceFromCounts pure function over D-13 thresholds; min_lines 20)
    - src/domain/confidence/index.test.ts (84 LOC — 9 tests covering boundaries at 0/9/10/19/20/21/30 days + trailing-28 pattern window)
    - src/domain/baselines/index.ts (46 LOC — computeBaseline pure function; D-02 trailing-30 anchor parameterized via windowDays; min_lines 40)
    - src/domain/baselines/index.test.ts (56 LOC — 6 tests covering empty-throws + worked 5-value example + 30-identical edge + metric-slot preservation + coverage scaling)
    - src/domain/anomalies/anomaly.ts (139 LOC — computeZAnalysis + selectAnomalies; D-06 firing rule + ANOMALY_DIRECTION lookup; min_lines 50)
    - src/domain/anomalies/anomaly.test.ts (306 LOC — 17 tests covering Z-refused/computed/tier transitions + per-direction fire rules + bidirectional skip + mixed run + ADR-0004 empty case)
    - .planning/phases/04-domain-math-reviews-decision-ledger-mcp-surface/deferred-items.md (pre-existing TSC errors in Phase 2 + test-helper files; out of scope for Plan 04-04)
  modified: []

key-decisions:
  - "ANOMALY_DIRECTION ships spo2_percentage + skin_temp_celsius as 'bidirectional' (not 'low' or 'high'). Research §2 only assigned directions to 7 metrics; the remaining 2 are in METRIC_NAMES (D-04) but research did not provide a clinical direction. Defaulting to 'bidirectional' means selectAnomalies will never fire on them, which matches D-06's 'informational only, NOT actionable' policy for the day_strain case. Phase 5 / V2 may revisit if a clinical direction lands."
  - "computeBaseline signature is `(metric, values, windowDays)` — three positional args, not an opts object. The function emits a single-metric BaselineStats; the caller iterates METRIC_NAMES and passes pre-filtered + pre-windowed values per metric. Keeping it positional matches the existing `median(values)` + `robustSigma(values)` shape from Plan 04-03 (the stats primitives are positional; the gating helper that consumes them, confidenceFromCounts, uses an opts object because it has 2 same-typed numeric args)."
  - "BaselineStats.mad is RAW MAD, not the 1.4826-scaled robust sigma. RESEARCH §1 anchors this: storing raw lets Phase 5 surface both raw + scaled via the whoop://baseline/30d MCP resource if needed, and re-scaling at the Z-score computation site keeps the single source of truth (MAD_CONSISTENCY) intact. The trade-off: anomaly.ts performs `1.4826 * baseline.mad` twice (once in computeZAnalysis for the division, once in selectAnomalies to populate baseline_mad_scaled on the emitted Anomaly). Pure-function recomputation is cheap; the alternative — caching the scaled value in BaselineStats — would mean a downstream consumer could read it without referencing MAD_CONSISTENCY, breaking the 'one constant, one site' contract."
  - "selectAnomalies skips bidirectional metrics BEFORE computing the Z-analysis (not after). The early continue short-circuits the math entirely — there's no point computing a Z-score for day_strain if the firing rule can never accept it. The 'NEVER fires for day_strain even at |z|=3' test locks the contract: even when the value is genuinely far from baseline, no Anomaly is emitted. spo2 + skin_temp share the same skip path."
  - "computeZAnalysis runs the null/NaN guard BEFORE the daysAvailable guard. Either order produces the same refused.insufficient_days output, but checking the value first means a null/NaN never silently flows past the days check (defensive layering). The defensive null/NaN guard is documented as belt-and-braces — the service layer (Plan 04-07) is the primary filter; this is the secondary."
  - "tier in ZAnalysis.computed is 'weak' for daysAvailable in [14, 19] and 'strong' for daysAvailable >= 20. This DIFFERS from confidenceFromCounts (which gates 'strong' on BOTH count >= 20 AND coverage >= 70%). The tier on a single ZAnalysis carries the Z-score's own confidence — the per-metric mixed-recency story; the ConfidenceGate carries the overall daily-review tier including coverage. Both signals can be populated simultaneously: ZAnalysis.tier='strong' (HRV has 25 of 30 days) AND ConfidenceGate.tier='weak' (only 18 SCORED days total across the review window)."

patterns-established:
  - "TDD cycle on a 4-file Wave 1 plan: write the .test.ts file importing from a sibling .js that doesn't exist yet (vitest fails with 'Cannot find module' — the canonical RED for this codebase), commit RED, write the smallest implementation that passes, watch vitest go green, commit GREEN. Repeat for each of the 4 files in dependency order (direction → confidence → baselines → anomalies). The 4 RED/GREEN pairs landed cleanly with no rewrites; the final REFACTOR commit applied biome's auto-fix for import ordering + line-collapse formatting."
  - "Strictest-layer file shape for src/domain/{baselines,anomalies,confidence}/*.ts: a leading docstring block citing the source ADR/decision/research section, the algorithm in narrative form, the ALLOWED imports listed explicitly in the docstring (simple-statistics + sibling domain modules — no I/O, no logger, no clock), the type-narrowed function body, and JSDoc on every exported function. The 4 source files together are 281 LOC; the 4 test files together are 507 LOC — tests outweigh implementation 1.8:1, consistent with TDD discipline."
  - "Cross-checking the worked-example arithmetic at test-write time: I hand-computed each Z-score against the plan's spec (HRV-low z=-2.108 from value=25, median=50, mad=8; RHR-high z=+2.024 from value=70, median=55, mad=5; recovery z≈1.349 from value=70, median=50, mad=10). All three matched the live implementation on the first GREEN run — Plan 04-03's Mann-Whitney p-value discrepancy was an outlier (continuity correction); the deterministic z = (value - median) / (1.4826 * mad) arithmetic produces stable values across hand-calculation, simple-statistics, and the live impl."

requirements-completed: []
# REV-01, REV-02, REV-05 are LISTED in this plan's frontmatter `requirements:` field
# because Plan 04-04 anchors the math layer they depend on, but the requirements
# themselves close in Plan 04-07 (services/review/daily.ts) — which composes
# computeBaseline + selectAnomalies + confidenceFromCounts into the user-facing
# DailyReviewResult. REQUIREMENTS.md keeps REV-01/REV-02/REV-05 in `Pending` until
# the daily review ships. This matches the precedent in Plan 04-03 (REV-01 +
# REV-07 listed but not closed).

duration: 5min 47s
completed: 2026-05-20
---

# Phase 4 Plan 04: Baseline + Anomaly + Confidence Pure-Domain Layer Summary

**Phase 4 Wave 1 — shipped 4 pure-domain functions (`ANOMALY_DIRECTION`, `confidenceFromCounts`, `computeBaseline`, `computeZAnalysis` + `selectAnomalies`) across 9 RED/GREEN/REFACTOR commits. The chassis the daily review composes: REV-01 (trailing-30 median + MAD) and REV-02 (D-13 confidence tiers) anchored at the math layer; ADR-0004 typed positive output enforced at the firing rule; Pitfall 5 (per-metric mixed-recency Z-refusal) + Pitfall 12 (MAD=0 NaN-cascade) mitigated. 167 tests pass across the whole `src/domain/` tree.**

## Performance

- **Duration:** 5 min 47 s
- **Started:** 2026-05-20T17:56:39Z
- **Completed:** 2026-05-20T18:02:26Z
- **Tasks:** 9 (RED + GREEN per function across 4 files, plus a final REFACTOR commit for biome import ordering)
- **Files created:** 8 source/test + 1 phase-level deferred-items.md
- **Files modified:** 0 (plan-scoped — no edits to existing source)
- **Commits:** 10 (9 RED/GREEN/REFACTOR + this docs commit at the close)

## What Shipped

### `src/domain/anomalies/direction.ts` (42 LOC, 11 tests)

D-06 per-metric direction map as a module-load Object.freeze constant with a `satisfies` clause locking the `Readonly<Record<MetricName, 'low' | 'high' | 'bidirectional'>>` shape at compile time. Every entry in METRIC_NAMES (the 9-tuple from baselines/types.ts) has exactly one direction:

| Metric | Direction | Source |
|---|---|---|
| `hrv_rmssd_milli` | `'low'` | D-06 |
| `recovery_score` | `'low'` | D-06 |
| `sleep_duration_minutes` | `'low'` | D-06 |
| `sleep_efficiency_percent` | `'low'` | D-06 |
| `resting_heart_rate` | `'high'` | D-06 |
| `respiratory_rate` | `'high'` | D-06 |
| `day_strain` | `'bidirectional'` | D-06 (informational only) |
| `spo2_percentage` | `'bidirectional'` | research §2 unassigned |
| `skin_temp_celsius` | `'bidirectional'` | research §2 unassigned |

The freeze invariant is asserted at test time (`Object.isFrozen(ANOMALY_DIRECTION) === true`) so a future refactor that swaps `Object.freeze({...})` for a plain literal gets caught. The map is the lookup table `selectAnomalies` consults for the D-06 firing rule.

### `src/domain/confidence/index.ts` (54 LOC, 9 tests)

`confidenceFromCounts({scoredDays, windowDays}): ConfidenceGate` — pure function emitting the D-13 tier:

- `scoredDays < 10` → `'insufficient'` (D-10 anchor — triggers ADR-0004 typed positive output downstream)
- `scoredDays >= 20 AND coveragePct >= 70` → `'strong'`
- otherwise → `'weak'`

`coveragePct = (scoredDays / windowDays) * 100` (raw float; formatter rounds). The 9 test cases cover boundaries at 0/9/10/19/20/21/30 days on the trailing-30 daily window AND the 20-on-28 case for the trailing-28 pattern window (D-12 + D-17 — two intentionally distinct windows).

The D-10 path is the load-bearing slot: Plan 04-07's `services/review/daily.ts` will inspect `confidence.tier === 'insufficient'` and populate `insufficient_reason` + emit empty `anomalies: []` + `actions: []` per ADR-0004. This plan ships the tier; the service composes the wrapper.

### `src/domain/baselines/index.ts` (46 LOC, 6 tests)

`computeBaseline(metric: MetricName, values: number[], windowDays: number): BaselineStats` — pure function over already-filtered + already-windowed values. Emits:

```ts
{
  metric,                                    // verbatim from input
  median: median(values),                    // wrapper from stats/median.ts
  mad: medianAbsoluteDeviation(values),      // RAW MAD (consumer applies 1.4826)
  n: values.length,                          // SCORED-day count
  coverage_pct: (values.length / windowDays) * 100,
}
```

Throws on empty `values` (same discipline as `median` + `robustSigma` per Plan 04-03 — T-04-S1 STRIDE mitigation). The D-02 trailing-30 anchor is parameterized via `windowDays` so the service layer (Plan 04-07's `resolveReviewedDate`) owns the `reviewed_date - 29d` math and the domain function stays pure. The worked example test (`[50, 60, 70, 80, 90]` → `{median: 70, mad: 10}`) locks the arithmetic verbatim.

### `src/domain/anomalies/anomaly.ts` (139 LOC, 17 tests)

Two exports:

1. `computeZAnalysis(input): ZAnalysis` — 3-variant discriminated-union output (D-05):
   - `refused.insufficient_days` when `value` is null/NaN OR `daysAvailable < 14` (defensive belt-and-braces — caller should pre-filter)
   - `refused.baseline_mad_zero` when `baseline.mad === 0` (Pitfall 12 NaN-cascade fix)
   - `computed { value, baseline_median, baseline_mad, tier }` otherwise, with `tier = daysAvailable >= 20 ? 'strong' : 'weak'`

2. `selectAnomalies(input): Anomaly[]` — D-06 firing rule over METRIC_NAMES:
   - Skip metrics with no baseline entry
   - Skip bidirectional metrics (early return BEFORE the Z computation — `day_strain`, `spo2_percentage`, `skin_temp_celsius` never fire)
   - Skip refused Z-analyses
   - Fire when `(direction === 'low' && z <= -2)` OR `(direction === 'high' && z >= 2)`
   - Emit `{ metric, z, direction, baseline_median, baseline_mad_scaled: 1.4826 * baseline.mad, tier }`

The mixed-run test locks the contract: today HRV=25 + RHR=70 + sleep=200 + strain=25 with `perMetricDaysAvailable={hrv:30, rhr:30, sleep:12, strain:30}` → 2 anomalies fire (HRV-low + RHR-high), sleep refuses (12 < 14), strain skips (bidirectional). The empty case (`returns [] when all metrics are favorable`) anchors ADR-0004.

The `1.4826` constant is imported as `MAD_CONSISTENCY` from `stats/mad.ts` — verified by grep that the literal appears in `mad.ts` only across the codebase.

## Deviations from Plan

**None — plan executed exactly as written, with one minor implementation choice flagged below for clarity.**

### Minor: `computeBaseline` signature uses positional args, not opts object

The plan text in `<behavior>` switched between two candidate shapes: `computeBaseline(values, windowDays)` (no metric) and `computeBaseline(metric, values, windowDays)` (with metric). The plan's `<implementation>` and the test cases in `<behavior>` settled on the 3-arg positional form: `computeBaseline('recovery_score', [50, 60, 70, 80, 90], 30)`. I implemented the 3-arg positional form to match the test cases verbatim. Recorded here so a future reader does not have to re-derive the choice from the plan text.

### Out-of-scope: pre-existing TSC errors in `src/cli/commands/auth.ts` + `tests/helpers/msw-whoop-oauth.ts`

`npx tsc --noEmit` reports 3 errors in Phase-2 CLI + test-helper code (auth.ts:97 `exactOptionalPropertyTypes` mismatch; msw-whoop-oauth.ts:74 + :82 `unknown` not assignable to `JsonBodyType`). These predate Plan 04-04 and do not touch `src/domain/`. Logged in `deferred-items.md` for a future cleanup plan. The `src/domain/` subtree compiles clean under `--noEmit`.

## Authentication Gates

None — this plan ships pure-domain math; no I/O, no external services.

## Threat Flags

None — this plan adds no new network endpoints, auth paths, file access, or schema changes. The threat register entry `T-04-S1 Tampering` is fully mitigated by the defensive guards documented above (empty-array throws in `computeBaseline`; null/NaN refusal in `computeZAnalysis`; `baseline_mad_zero` refusal preventing NaN cascade).

## Known Stubs

None — all 4 functions are fully wired and tested. The downstream consumers (Plan 04-07 services/review/daily.ts) are deliberately not yet built; this plan ships only the chassis they will compose.

## Verification

```sh
# All Wave 1 domain green together
$ npx vitest run src/domain/
 Test Files  20 passed (20)
      Tests  167 passed (167)

# Pure-layer discipline (10 grep gates A-J)
$ bash scripts/ci-grep-gates.sh
All grep gates passed.

# Strict-TS check (only on src/domain/ — pre-existing Phase 2 errors logged to deferred-items.md)
$ npx tsc --noEmit 2>&1 | grep "src/domain/(anomalies|baselines|confidence)"
(no output — clean)

# Biome lint + format clean on all 8 new files
$ npx biome check src/domain/{anomalies,baselines,confidence}/*
Checked 8 files in 6ms. No fixes applied.
```

## TDD Gate Compliance

Each of the 4 files landed in strict RED → GREEN order:

| File | RED commit | GREEN commit |
|---|---|---|
| `direction.ts` | `d37820f` test(04-04): add failing direction map tests | `d95ba72` feat(04-04): implement ANOMALY_DIRECTION per D-06 |
| `confidence/index.ts` | `494aa65` test(04-04): add failing confidence-tier tests | `bb1a9ab` feat(04-04): implement confidenceFromCounts per D-13 + D-10 |
| `baselines/index.ts` | `aa7a65d` test(04-04): add failing baseline tests | `55d5c5f` feat(04-04): implement computeBaseline per REV-01 + D-02 trailing-30 anchor |
| `anomalies/anomaly.ts` | `78c1787` test(04-04): add failing anomaly tests | `d39b80a` feat(04-04): implement selectAnomalies per D-06 |

Final REFACTOR: `8988dcf` refactor(04-04): apply biome formatter to domain layer 1 files (import-order + line-collapse formatting; tests still pass).

## What's Next

Plan 04-05 ships the pattern-detection layer (Mann-Whitney candidate suite + BH-corrected WeeklyPattern) — independent of Plan 04-04. Plan 04-07 composes Plan 04-04's 4 primitives + Plan 04-05's pattern output into the user-facing `DailyReviewResult` + `WeeklyReviewResult` (where REV-01 / REV-02 / REV-05 close).

## Self-Check: PASSED

- `src/domain/anomalies/direction.ts` — FOUND
- `src/domain/anomalies/direction.test.ts` — FOUND
- `src/domain/confidence/index.ts` — FOUND
- `src/domain/confidence/index.test.ts` — FOUND
- `src/domain/baselines/index.ts` — FOUND
- `src/domain/baselines/index.test.ts` — FOUND
- `src/domain/anomalies/anomaly.ts` — FOUND
- `src/domain/anomalies/anomaly.test.ts` — FOUND
- Commit `d37820f` (RED direction) — FOUND
- Commit `d95ba72` (GREEN direction) — FOUND
- Commit `494aa65` (RED confidence) — FOUND
- Commit `bb1a9ab` (GREEN confidence) — FOUND
- Commit `aa7a65d` (RED baselines) — FOUND
- Commit `55d5c5f` (GREEN baselines) — FOUND
- Commit `78c1787` (RED anomaly) — FOUND
- Commit `d39b80a` (GREEN anomaly) — FOUND
- Commit `8988dcf` (REFACTOR biome) — FOUND
