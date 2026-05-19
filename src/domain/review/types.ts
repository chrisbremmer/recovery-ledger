// Daily + weekly review result type contract — D-03 (DailyReviewResult)
// + D-04 (TodayMetrics 9 fields) + D-07 (Pattern[] empty-slot anchor) +
// D-08 (SuggestedAction shape) + D-10 (insufficient_reason flow) +
// D-16 (WeeklyReviewResult schema) + D-17 (trailing-7 vs trailing-28
// distinction in data_status) + D-18 (multi-detection: pattern winner +
// candidate_results full list) + D-22 (DecisionPrompt typed slot).
//
// Pure type file; no runtime behavior; no I/O. Plan 04-02 Wave 0 ships
// the contract; Wave 1 (Plans 04-04 + 04-05) computes against it; Wave
// 2 (Plan 04-06 services/review/) composes the values; Wave 3 (Plan
// 04-09 formatters) renders the typed result; Wave 4 (Plans 04-11 +
// 04-12 MCP) wraps it in `structuredContent`.
//
// Discriminator-union discipline (D-22 + ADR-0004): `DecisionPrompt`
// is a `silent | none_this_week` union, NOT an optional field. The
// formatter CANNOT silently drop the slot — it must handle both arms.

import type { Anomaly } from '../anomalies/types.js';
import type { MetricName } from '../baselines/types.js';
import type { ConfidenceGate } from '../confidence/types.js';
import type { CandidateResult, WeeklyPattern, WorstDay } from '../patterns/types.js';
import type { ResourceName } from '../types/sync.js';

/**
 * The 9 D-04 raw measurements that ship on `DailyReviewResult.today_state`.
 * Each field is `number | null` because WHOOP may not surface every metric
 * on every cycle — `spo2_percentage` requires a wrist-on sleep cycle,
 * `skin_temp_celsius` requires the WHOOP 4.0+, etc. The normalizer at
 * the infrastructure boundary maps absent values to `null` (NEVER `0`
 * — Pitfall 3 + ADR-0003).
 *
 * The keys are snake_case per D-04 (matching the MCP `structuredContent`
 * wire format). The renderer uses these verbatim in the daily review
 * narrative; the `whoop://summary/today` resource serializes them
 * verbatim.
 */
export interface TodayMetrics {
  recovery_score: number | null;
  hrv_rmssd_milli: number | null;
  resting_heart_rate: number | null;
  spo2_percentage: number | null;
  skin_temp_celsius: number | null;
  day_strain: number | null;
  sleep_duration_minutes: number | null;
  sleep_efficiency_percent: number | null;
  respiratory_rate: number | null;
}

/**
 * Data-staleness + baseline + coverage block per D-03. Surfaces in both
 * the CLI rendering ("Latest sync: 4h ago — ok") and the MCP
 * `whoop://data-quality` resource.
 *
 * `latest_sync_status` mirrors Phase 3's `RunSyncStatus` shape but
 * narrows to the three user-facing states. Phase 3's `'running'` state
 * is filtered out by `latestFinished()` at the repo boundary (the
 * `daily_review` service requests the latest FINISHED run, not the
 * latest started run — a `'running'` row means the user kicked off a
 * sync but the review still wants the previous result).
 *
 * `staleness_days` is `(today - reviewed_date)` per D-03; the formatter
 * prints "yesterday" / "2 days ago" / "stale (5 days)" from this value.
 *
 * `missing_resources` lists ResourceName entries not present in the
 * trailing-7-day window — a heuristic for "did sync miss something."
 */
export interface DataStatus {
  reviewed_date: string;
  latest_sync_at: string | null;
  latest_sync_status: 'ok' | 'partial' | 'failed' | null;
  staleness_days: number;
  baseline_window: {
    start: string;
    end: string;
    scored_day_count: number;
    coverage_pct: number;
  };
  missing_resources: ResourceName[];
}

/**
 * One catalog-sourced action emitted in `DailyReviewResult.actions` per
 * D-08. `id` is the catalog stable id (e.g., `hrv_low_zone2`) so the
 * Plan 04-08 contract test can assert "anomaly set X → catalog entries
 * [A1, A2, A3]" deterministically; `text` is the verb-first
 * single-sentence string the formatter prints verbatim. `metric` +
 * `direction` carry the firing-rule context so the rendered narrative
 * can group actions by metric.
 *
 * Selection algorithm per D-08: filter the catalog by `(metric,
 * direction)` for each fired anomaly; rank by priority ascending; take
 * top 3 across all firings. Returns `[]` when no anomalies fired (D-08
 * ADR-0004 forcing function — no anomaly → no action, never invent).
 */
export interface SuggestedAction {
  id: string;
  text: string;
  metric: MetricName;
  direction: 'low' | 'high';
}

/**
 * `patterns` slot placeholder per D-07. The daily review `patterns`
 * slot is `Pattern[]` typed empty in v1 — the renderer omits the
 * section when the array is empty. The discriminator-with-one-arm
 * shape documents "V2 expansion path" without polluting the v1 type
 * surface (V2 will add `kind: '3d_sleep_debt_accumulation'`,
 * `kind: 'recovery_trend_declining'`, etc.; v1 ships only the empty
 * variant so existing consumers don't break when arms are added).
 */
export interface Pattern {
  kind: 'placeholder_v1_empty';
}

/**
 * `DailyReviewResult` (D-03 verbatim — REV-03 slot map). All 7 slots
 * required; `insufficient_reason` is `string | null` because it's only
 * populated when `confidence.tier === 'insufficient'` per D-10.
 *
 * - `patterns: Pattern[]` is the D-07 empty-slot anchor (always `[]` in
 *   v1; the renderer omits the section when empty).
 * - `actions: SuggestedAction[]` is capped at 3 per D-08; empty `[]`
 *   when no anomalies fired OR when `confidence.tier === 'insufficient'`.
 * - `anomalies: Anomaly[]` carries every per-metric anomaly that
 *   cleared the D-06 firing rule; empty `[]` when no metrics fired.
 */
export interface DailyReviewResult {
  data_status: DataStatus;
  today_state: TodayMetrics;
  anomalies: Anomaly[];
  patterns: Pattern[];
  actions: SuggestedAction[];
  confidence: ConfidenceGate;
  insufficient_reason: string | null;
}

/**
 * Weekly narrative summary per D-16 — the 7-day calendar story. The
 * pattern-test window (28d) lives in `WeeklyReviewResult.data_status`
 * separately; D-17 + D-12 lock the two windows distinct.
 *
 * - `worst_days` is the bottom-quartile set chronologically sorted
 *   (D-13 tie-break). Length matches `floor(N_scored / 4)` with a
 *   floor of 2.
 * - `best_day` is the single highest-recovery day; `null` when no
 *   SCORED day exists in the window.
 * - `avg_strain` + `total_sleep_hours` are over SCORED days only
 *   (ADR-0003); `null` when no SCORED days.
 */
export interface WeekSummary {
  scored_day_count: number;
  worst_days: WorstDay[];
  best_day: { date: string; recovery_score: number } | null;
  avg_strain: number | null;
  total_sleep_hours: number | null;
}

/**
 * Weekly decision-prompt slot per D-22 — discriminated union, NOT
 * optional. `silent` arm fires when at least one decision was recorded
 * in the trailing 7 days; `none_this_week` arm fires when the count is
 * zero, carrying the catalog-sourced `suggested_text` (D-23). The CLI
 * renderer emits the prompt as the FINAL line of weekly output when
 * `kind === 'none_this_week'`; MCP returns it verbatim in
 * `structuredContent`. Same ADR-0004 forcing-function discipline as
 * `WeeklyPattern.no_pattern` — silence is a typed positive output, not
 * an absent field.
 */
export type DecisionPrompt =
  | { kind: 'silent' }
  | { kind: 'none_this_week'; suggested_text: string };

/**
 * `WeeklyReviewResult` (D-16 verbatim — REV-06/07 slot map). The
 * `data_status` intersects the daily `DataStatus` shape with three
 * weekly-only fields (`week_start`, `week_end`, `pattern_test_window`)
 * — the two windows are intentionally distinct per D-12 + D-17 (week
 * narrative = trailing 7; pattern test = trailing 28).
 *
 * - `pattern: WeeklyPattern` carries the D-18 multi-detection winner
 *   (smallest p_adjusted among cleared candidates) OR the typed
 *   `no_pattern` ADR-0004 positive output.
 * - `candidate_results: CandidateResult[]` carries the full ranked
 *   list per ADR-0004 §If FDR set empty + D-18 ("lists the unranked
 *   candidates as context, not as a recommendation").
 * - `decision_prompt: DecisionPrompt` is the D-22 typed weekly nudge.
 * - `confidence: ConfidenceGate` is the D-13 tier over the
 *   pattern-test window (NOT the trailing-7 narrative window).
 */
export interface WeeklyReviewResult {
  data_status: DataStatus & {
    week_start: string;
    week_end: string;
    pattern_test_window: {
      start: string;
      end: string;
      scored_day_count: number;
    };
  };
  week_summary: WeekSummary;
  pattern: WeeklyPattern;
  candidate_results: CandidateResult[];
  decision_prompt: DecisionPrompt;
  confidence: ConfidenceGate;
}
