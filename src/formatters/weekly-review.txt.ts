// Weekly review renderer — WeeklyReviewResult → compact text per D-16
// (REV-06/07 slot map + ADR-0004 typed-positive-output + D-17 trailing-7
// vs D-12 trailing-28 two-distinct-sections rendering + D-22 decision-
// prompt-as-final-line + D-34 pattern_confidence annotation).
//
// Pure function — no I/O, no logger, no DB, no Date.now(). Same shape
// discipline as src/formatters/sync.txt.ts + src/formatters/daily-review.txt.ts:
// (typedResult) => string; caller decides where the string lands (CLI
// stdout or MCP content[0].text).
//
// Critical rendering anchor (D-17 + D-12 — kept distinct in the output):
//   - "Week summary (This week: YYYY-MM-DD to YYYY-MM-DD)" header carries
//     the trailing-7 date range read from `data_status.week_start` and
//     `data_status.week_end` (D-17 trailing-7 narrative window).
//   - "Pattern over trailing 28 days (YYYY-MM-DD to YYYY-MM-DD)" header
//     carries the trailing-28 date range read from
//     `data_status.pattern_test_window.{start,end}` (D-12 pattern-test window).
//   - The two date ranges DIFFER by construction (length 7 vs 28). The
//     formatter test asserts both are rendered with the correct ranges
//     so the D-17 contract is anchored at the rendering layer (matches
//     the result-object discipline anchored at Plan 04-07's
//     getWeeklyReview where the two slots are kept distinct).
//
// ADR-0004 forcing function (exhaustive switch on pattern.kind):
//   - 'detected'  → render the factor + statistics + direction + confidence.
//                   D-34: append 'Small sample — effect estimates are
//                   imprecise.' when pattern_confidence === 'weak'.
//   - 'no_pattern' → render "No reliable pattern detected. Reason: ..."
//                    with the typed reason. NO emoji, NO editorial framing.
//
// D-22 decision_prompt:
//   - 'silent'         → omit the section entirely.
//   - 'none_this_week' → render as the FINAL section with the suggested_text
//                        on a single line.
//
// ADR-0004 §If FDR set empty: candidate_results ALWAYS rendered as an
// unranked context table (the user can see what was tested even when
// nothing cleared FDR). Sorted ASC by p_adjusted; refused candidates
// rendered with `refused` status.
//
// ADR-0005 / D-26 banned-tone-words: source-level Gate A scans this file;
// D-26 contract test re-checks rendered output.
//
// ADR-0001 (MCP stdout purity): no console.*, no process.stdout.write.

import type { CandidateResult, WeeklyPattern } from '../domain/patterns/types.js';
import type {
  DataStatus,
  DecisionPrompt,
  WeeklyReviewResult,
  WeekSummary,
} from '../domain/review/types.js';

// ---------------------------------------------------------------------------
// Column widths. The candidate-results table aligns factor names against
// the longest one ('workout_timing_late_evening' = 27 chars) plus padding.
// ---------------------------------------------------------------------------
const FACTOR_COL_WIDTH = 30;
const P_RAW_COL_WIDTH = 14;
const P_ADJ_COL_WIDTH = 14;

const SECTION_INDENT = '  ';
const PATTERN_DETAIL_INDENT = '            ';

// ---------------------------------------------------------------------------
// Public entry point.
// ---------------------------------------------------------------------------

export function renderWeeklyReview(result: WeeklyReviewResult): string {
  const sections: string[] = [];

  // REV-04 lead — data freshness first (consistent with daily review).
  sections.push(renderDataStatusSection(result.data_status));

  // D-17 trailing-7 week_summary slot — separate header carrying the
  // trailing-7 date range.
  sections.push(
    renderWeekSummarySection(
      result.week_summary,
      result.data_status.week_start,
      result.data_status.week_end,
    ),
  );

  // D-12 trailing-28 pattern slot — separate header carrying the
  // trailing-28 date range. ADR-0004 forcing function: exhaustive switch
  // on pattern.kind below.
  sections.push(
    renderPatternSection(result.pattern, {
      start: result.data_status.pattern_test_window.start,
      end: result.data_status.pattern_test_window.end,
    }),
  );

  // Candidate-results table: ALWAYS rendered (ADR-0004 §If FDR set empty —
  // unranked context for self-vetting). Sorted ASC by p_adjusted.
  sections.push(renderCandidateResultsSection(result.candidate_results));

  // Confidence trails the body.
  sections.push(`Confidence: ${result.confidence.tier}`);

  // D-22 decision_prompt — FINAL section when present.
  const prompt = renderDecisionPromptSection(result.decision_prompt);
  if (prompt !== null) {
    sections.push(prompt);
  }

  return sections.join('\n\n');
}

// ---------------------------------------------------------------------------
// Data status section. Mirrors daily-review's but adds the two weekly
// windows (D-17 trailing-7 + D-12 trailing-28) so the user can confirm
// at a glance which dates the two downstream sections cover.
// ---------------------------------------------------------------------------

function renderDataStatusSection(
  ds: WeeklyReviewResult['data_status'],
): string {
  const lines: string[] = ['Data status:'];

  lines.push(
    `${SECTION_INDENT}Reviewed date: ${ds.reviewed_date}  (staleness: ${ds.staleness_days}d)`,
  );
  lines.push(`${SECTION_INDENT}Week: ${ds.week_start} to ${ds.week_end}`);
  lines.push(
    `${SECTION_INDENT}Pattern test window: ${ds.pattern_test_window.start} to ${ds.pattern_test_window.end}  (${ds.pattern_test_window.scored_day_count} SCORED days)`,
  );

  if (ds.latest_sync_at === null) {
    lines.push(`${SECTION_INDENT}Last sync: (no sync recorded)`);
  } else {
    const statusSuffix =
      (ds as DataStatus).latest_sync_status === null
        ? ''
        : `  (${(ds as DataStatus).latest_sync_status})`;
    lines.push(`${SECTION_INDENT}Last sync: ${ds.latest_sync_at}${statusSuffix}`);
  }

  if (ds.missing_resources.length > 0) {
    lines.push(`${SECTION_INDENT}Missing resources: ${ds.missing_resources.join(', ')}`);
  }

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// D-17 trailing-7 'This week' section. Reads week_start / week_end from
// data_status so the header carries the correct trailing-7 range —
// DISTINCT from the pattern-test header below (which reads trailing-28).
// ---------------------------------------------------------------------------

function renderWeekSummarySection(
  ws: WeekSummary,
  weekStart: string,
  weekEnd: string,
): string {
  const lines: string[] = [`Week summary (This week: ${weekStart} to ${weekEnd}):`];
  lines.push(`${SECTION_INDENT}Days scored: ${ws.scored_day_count}`);

  if (ws.worst_days.length > 0) {
    const worst = ws.worst_days
      .map((d) => `${d.date} (${d.recovery_score})`)
      .join(', ');
    lines.push(`${SECTION_INDENT}Worst days: ${worst}`);
  }

  if (ws.best_day !== null) {
    lines.push(
      `${SECTION_INDENT}Best day: ${ws.best_day.date} (${ws.best_day.recovery_score})`,
    );
  }

  if (ws.avg_strain !== null) {
    lines.push(`${SECTION_INDENT}Avg strain: ${roundDecimal(ws.avg_strain, 1)}`);
  }

  if (ws.total_sleep_hours !== null) {
    lines.push(`${SECTION_INDENT}Total sleep: ${roundDecimal(ws.total_sleep_hours, 1)}h`);
  }

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// D-12 trailing-28 pattern section. Exhaustive switch on pattern.kind
// per ADR-0004 (every variant has its own arm — adding a new kind to
// the WeeklyPattern union fails to compile here).
// ---------------------------------------------------------------------------

interface PatternWindow {
  start: string;
  end: string;
}

function renderPatternSection(pattern: WeeklyPattern, window: PatternWindow): string {
  const header = `Pattern over trailing 28 days (${window.start} to ${window.end}):`;
  switch (pattern.kind) {
    case 'detected': {
      const lines: string[] = [header];
      const directionPhrase =
        pattern.direction === 'worst_days_had_lower'
          ? 'was lower on worst-recovery days'
          : 'was higher on worst-recovery days';
      lines.push(`${SECTION_INDENT}Detected: ${pattern.factor} ${directionPhrase}`);
      lines.push(
        `${PATTERN_DETAIL_INDENT}(U=${pattern.statistic.U}, p_raw=${formatPValue(pattern.statistic.p_raw)}, p_adjusted=${formatPValue(pattern.statistic.p_adjusted)})`,
      );
      lines.push(`${PATTERN_DETAIL_INDENT}Confidence: ${pattern.pattern_confidence}`);
      if (pattern.pattern_confidence === 'weak') {
        // D-34 — surface the small-sample caveat verbatim.
        lines.push(`${PATTERN_DETAIL_INDENT}Small sample — effect estimates are imprecise.`);
      }
      return lines.join('\n');
    }
    case 'no_pattern': {
      const lines: string[] = [header];
      lines.push(`${SECTION_INDENT}No reliable pattern detected. Reason: ${pattern.reason}`);
      return lines.join('\n');
    }
  }
}

// ---------------------------------------------------------------------------
// Candidate-results table — ALWAYS rendered (ADR-0004 §If FDR set empty).
// Sorted ASC by p_adjusted; refused rows render after non-refused.
// ---------------------------------------------------------------------------

function renderCandidateResultsSection(results: readonly CandidateResult[]): string {
  if (results.length === 0) {
    return 'Candidate factors (ranked):\n(no candidates tested)';
  }

  const lines: string[] = ['Candidate factors (ranked):'];

  // Refused rows go to the bottom; non-refused sorted ASC by p_adjusted.
  const nonRefused = results.filter((r) => !r.refused);
  const refused = results.filter((r) => r.refused);
  const sorted = [
    ...nonRefused.slice().sort((a, b) => a.p_adjusted - b.p_adjusted),
    ...refused,
  ];

  sorted.forEach((r, i) => {
    const factor = r.factor.padEnd(FACTOR_COL_WIDTH);
    const status = r.refused
      ? `refused (${r.refusal_reason ?? 'unknown'})`
      : r.cleared
        ? 'cleared'
        : 'not cleared';
    if (r.refused) {
      lines.push(`${SECTION_INDENT}${i + 1}. ${factor}${'(refused)'.padEnd(P_RAW_COL_WIDTH)}${''.padEnd(P_ADJ_COL_WIDTH)}${status}`);
    } else {
      const pRaw = `p_raw=${formatPValue(r.p_raw)}`.padEnd(P_RAW_COL_WIDTH);
      const pAdj = `p_adj=${formatPValue(r.p_adjusted)}`.padEnd(P_ADJ_COL_WIDTH);
      lines.push(`${SECTION_INDENT}${i + 1}. ${factor}${pRaw}${pAdj}${status}`);
    }
  });

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// D-22 decision_prompt — returns null when silent (caller omits the
// section), else returns the FINAL paragraph carrying the suggested_text
// on a single line.
// ---------------------------------------------------------------------------

function renderDecisionPromptSection(prompt: DecisionPrompt): string | null {
  switch (prompt.kind) {
    case 'silent':
      return null;
    case 'none_this_week':
      return `Decision prompt:\n${SECTION_INDENT}${prompt.suggested_text}`;
  }
}

// ---------------------------------------------------------------------------
// Helpers.
// ---------------------------------------------------------------------------

function formatPValue(p: number): string {
  if (!Number.isFinite(p)) return 'NaN';
  if (p < 0.001) return p.toExponential(2);
  return roundDecimal(p, 3).toString();
}

function roundDecimal(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}
