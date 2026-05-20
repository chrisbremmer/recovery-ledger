// Daily review renderer — DailyReviewResult → compact text per D-03
// (REV-03/04/05 slot map + ADR-0004 typed-positive-output rendering +
// D-07 patterns-section-omitted v1 anchor).
//
// Pure function — no I/O, no logger, no DB, no Date.now(). The caller
// decides where the string goes (CLI: process.stdout.write; MCP tool:
// content[0].text). Mirrors src/formatters/sync.txt.ts (Phase 3
// precedent — formatter is the seam that lets the same render serve
// both transports per ARCHITECTURE.md lite-hexagonal + ADR-0001).
//
// REV-04 (data-freshness lead): the `Data status:` section is the FIRST
// paragraph of every rendered output. Service composition (Plan 04-07
// getDailyReview) ALSO returns the slot first in result-object key
// order; the formatter cements the rendering contract.
//
// D-07 (patterns section ALWAYS omitted in v1): the renderer never emits
// a `Patterns:` label. Plan 04-07's getDailyReview ALWAYS returns
// patterns: []; if a future V2 fills the slot, this renderer will gain
// a conditional that emits the section — until then the omission is
// unconditional. The contract test in tests/contract/daily-review-shape.test.ts
// pins "no Patterns: substring" across every fixture.
//
// REV-05 (insufficient → typed positive output): when confidence.tier
// === 'insufficient', anomalies/actions/patterns are all [] AND
// insufficient_reason is populated (atomic per D-10). The renderer
// surfaces the reason inline with Confidence and omits the empty
// Anomalies/Actions sections.
//
// ADR-0004 (positive output for absence): empty arrays render as
// SECTION OMISSION, not "(none)" filler. The user does not see
// "Anomalies: none" — they see the section absent. Same discipline as
// the weekly renderer's `no_pattern` arm and the decision_prompt
// silent arm.
//
// ADR-0005 / D-26 (banned-tone-words): all literal strings constructed
// here are free of the 10 banned tokens. Source-level Gate A scans this
// file; the D-26 contract test in tests/contract/formatter-tone.test.ts
// re-checks the RENDERED output across every fixture (defence-in-depth).
//
// ADR-0001 (MCP stdout purity): no console.*, no process.stdout.write,
// no Pino logger. Pure (typedResult) => string.

import type { Anomaly } from '../domain/anomalies/types.js';
import type { DailyReviewResult, DataStatus, TodayMetrics } from '../domain/review/types.js';

// ---------------------------------------------------------------------------
// Column widths for the today_state + anomalies tables. Aligned so the
// longest label ("Sleep efficiency") fits without truncation.
// ---------------------------------------------------------------------------
const METRIC_LABEL_WIDTH = 18;
const ANOMALY_LABEL_WIDTH = 18;

// One numbered indent for actions; two spaces for everything else.
const SECTION_INDENT = '  ';

// ---------------------------------------------------------------------------
// Public entry point.
// ---------------------------------------------------------------------------

export function renderDailyReview(result: DailyReviewResult): string {
  const sections: string[] = [];

  // REV-04 — data freshness leads.
  sections.push(renderDataStatusSection(result.data_status));

  // Today's measurements — always rendered. The user wants to see today's
  // numbers even when the baseline is insufficient (REV-05 still surfaces
  // today_state with the available metrics).
  sections.push(renderTodayMetricsSection(result.today_state));

  // Insufficient path: skip anomalies/actions; surface the reason inline.
  if (result.confidence.tier === 'insufficient') {
    const reason = result.insufficient_reason ?? 'insufficient SCORED days in baseline window';
    sections.push(`Confidence: insufficient — ${reason}`);
    return sections.join('\n\n');
  }

  // ADR-0004: anomalies render only when non-empty (no "Anomalies: (none)").
  if (result.anomalies.length > 0) {
    sections.push(renderAnomaliesSection(result.anomalies));
  }

  // ADR-0004: actions render only when non-empty.
  if (result.actions.length > 0) {
    sections.push(renderActionsSection(result.actions));
  }

  // D-07: patterns section ALWAYS omitted in v1 (renderer never emits a
  // `Patterns:` label). See file header for the rationale.

  // Confidence trails the body. The tier alone is enough — the action /
  // anomaly sections above already encode the consequences.
  sections.push(`Confidence: ${result.confidence.tier}`);

  return sections.join('\n\n');
}

// ---------------------------------------------------------------------------
// Section renderers.
// ---------------------------------------------------------------------------

function renderDataStatusSection(ds: DataStatus): string {
  const lines: string[] = ['Data status:'];

  const stalenessSuffix = formatStaleness(ds.staleness_days);
  lines.push(
    `${SECTION_INDENT}Reviewed date: ${ds.reviewed_date}  (staleness: ${stalenessSuffix})`,
  );

  if (ds.latest_sync_at === null) {
    lines.push(`${SECTION_INDENT}Last sync: (no sync recorded)`);
  } else {
    const statusSuffix = ds.latest_sync_status === null ? '' : `  (${ds.latest_sync_status})`;
    lines.push(`${SECTION_INDENT}Last sync: ${ds.latest_sync_at}${statusSuffix}`);
  }

  const baseline = ds.baseline_window;
  const coverage = formatPercentInteger(baseline.coverage_pct);
  lines.push(
    `${SECTION_INDENT}Baseline window: ${baseline.start} to ${baseline.end}  (${baseline.scored_day_count} SCORED days, ${coverage}% coverage)`,
  );

  if (ds.missing_resources.length === 0) {
    lines.push(`${SECTION_INDENT}Missing resources: (none)`);
  } else {
    lines.push(`${SECTION_INDENT}Missing resources: ${ds.missing_resources.join(', ')}`);
  }

  return lines.join('\n');
}

function renderTodayMetricsSection(t: TodayMetrics): string {
  const lines: string[] = ["Today's measurements:"];
  lines.push(formatMetricLine('Recovery', formatInteger(t.recovery_score)));
  lines.push(formatMetricLine('HRV (rMSSD)', formatMillis(t.hrv_rmssd_milli)));
  lines.push(formatMetricLine('Resting HR', formatBpm(t.resting_heart_rate)));
  lines.push(formatMetricLine('Strain', formatDecimal1(t.day_strain)));
  lines.push(formatMetricLine('Sleep', formatSleep(t.sleep_duration_minutes, t.sleep_efficiency_percent)));
  lines.push(formatMetricLine('Resp. rate', formatBpmDecimal1(t.respiratory_rate)));
  lines.push(formatMetricLine('SpO2', formatPercent(t.spo2_percentage)));
  lines.push(formatMetricLine('Skin temp', formatTemp(t.skin_temp_celsius)));
  return lines.join('\n');
}

function renderAnomaliesSection(anomalies: readonly Anomaly[]): string {
  const lines: string[] = ['Anomalies:'];
  for (const a of anomalies) {
    lines.push(formatAnomalyLine(a));
  }
  return lines.join('\n');
}

function renderActionsSection(actions: readonly { text: string }[]): string {
  const lines: string[] = ['Actions:'];
  actions.forEach((a, i) => {
    lines.push(`${SECTION_INDENT}${i + 1}. ${a.text}`);
  });
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Per-row helpers.
// ---------------------------------------------------------------------------

function formatMetricLine(label: string, value: string): string {
  return `${SECTION_INDENT}${label.padEnd(METRIC_LABEL_WIDTH)}${value}`;
}

function formatAnomalyLine(a: Anomaly): string {
  const label = humanMetricLabel(a.metric).padEnd(ANOMALY_LABEL_WIDTH);
  const z = formatSignedDecimal1(a.z);
  const median = formatMetricValue(a.metric, a.baseline_median);
  const sigma = formatMetricValue(a.metric, a.baseline_mad_scaled);
  return `${SECTION_INDENT}${label}${z}σ (median ${median}, robust σ ${sigma}, tier: ${a.tier}) — ${a.direction}`;
}

function humanMetricLabel(metric: Anomaly['metric']): string {
  switch (metric) {
    case 'recovery_score':
      return 'Recovery';
    case 'hrv_rmssd_milli':
      return 'HRV (rMSSD)';
    case 'resting_heart_rate':
      return 'Resting HR';
    case 'spo2_percentage':
      return 'SpO2';
    case 'skin_temp_celsius':
      return 'Skin temp';
    case 'day_strain':
      return 'Strain';
    case 'sleep_duration_minutes':
      return 'Sleep duration';
    case 'sleep_efficiency_percent':
      return 'Sleep efficiency';
    case 'respiratory_rate':
      return 'Resp. rate';
  }
}

function formatMetricValue(metric: Anomaly['metric'], value: number): string {
  switch (metric) {
    case 'recovery_score':
    case 'resting_heart_rate':
    case 'spo2_percentage':
      return formatInteger(value);
    case 'hrv_rmssd_milli':
      return `${roundDecimal(value, 1)}ms`;
    case 'skin_temp_celsius':
      return `${roundDecimal(value, 1)}°C`;
    case 'day_strain':
    case 'respiratory_rate':
    case 'sleep_efficiency_percent':
      return roundDecimal(value, 1).toString();
    case 'sleep_duration_minutes':
      return `${roundDecimal(value / 60, 1)}h`;
  }
}

// ---------------------------------------------------------------------------
// Value formatters. Each handles null → "(unavailable)" so the renderer
// never emits "null" or NaN in the output.
// ---------------------------------------------------------------------------

function formatStaleness(days: number): string {
  return `${days}d`;
}

function formatInteger(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return '(unavailable)';
  return Math.round(value).toString();
}

function formatDecimal1(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return '(unavailable)';
  return roundDecimal(value, 1).toString();
}

function formatSignedDecimal1(value: number): string {
  const rounded = roundDecimal(value, 1);
  return rounded >= 0 ? `+${rounded}` : rounded.toString();
}

function formatPercent(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return '(unavailable)';
  return `${Math.round(value)}%`;
}

function formatPercentInteger(value: number): string {
  return Math.round(value).toString();
}

function formatMillis(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return '(unavailable)';
  return `${roundDecimal(value, 1)}ms`;
}

function formatBpm(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return '(unavailable)';
  return `${Math.round(value)}bpm`;
}

function formatBpmDecimal1(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return '(unavailable)';
  return `${roundDecimal(value, 1)}bpm`;
}

function formatTemp(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return '(unavailable)';
  const rounded = roundDecimal(value, 1);
  const sign = rounded > 0 ? '+' : '';
  return `${sign}${rounded}°C`;
}

function formatSleep(durationMinutes: number | null, efficiencyPercent: number | null): string {
  if (durationMinutes === null || !Number.isFinite(durationMinutes)) return '(unavailable)';
  const hours = roundDecimal(durationMinutes / 60, 1);
  if (efficiencyPercent === null || !Number.isFinite(efficiencyPercent)) {
    return `${hours}h`;
  }
  return `${hours}h  (${Math.round(efficiencyPercent)}% efficiency)`;
}

function roundDecimal(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}
