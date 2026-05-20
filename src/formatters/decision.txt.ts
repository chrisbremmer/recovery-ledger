// Decision-list / detail / update renderer — D-19 / D-20 / D-21 rendering
// per the decision-ledger surface (CLI `decision review` + MCP
// `whoop_review_decisions` dual-mode + CLI `decision update` flow).
//
// Pure function — no I/O, no clock, no logger. The renderer dispatches on
// input shape via TypeScript narrowing:
//   - `Decision[]`      → list table (column-padded id-prefix | category |
//                         decision | elapsed/window | status).
//   - `Decision`        → detail block (multi-line, all fields).
//   - `ReviewDecisionsResult` → list arm renders the table; update arm
//                         renders the D-21 single-line confirmation.
//
// `elapsed_days/expected_window_days`:
//   - elapsed = (today - createdAt) in whole days, UTC-anchored.
//   - expected = (followUpDate - createdAt) in whole days; falls back to
//     7 when followUpDate is null (CLI default per D-19).
//   - `over_window` flag: an asterisk suffix on the elapsed column when
//     elapsed > expected (so the user sees the prompt to follow-up
//     without needing to do mental arithmetic).
//
// D-20 column widths frozen at module-scope. The decision text is
// truncated to 40 chars with an ellipsis if longer (the full text is
// available via the detail block).
//
// Tone: ADR-0005 / D-26 source + rendered lint. The D-26 contract test
// re-checks rendered output across fixtures.
//
// ADR-0001 (MCP stdout purity): no console.*, no process.stdout.write.

import type { Decision } from '../domain/types/entities.js';
import type { ReviewDecisionsResult } from '../services/decision/types.js';

// ---------------------------------------------------------------------------
// Column widths frozen at module scope. ULID prefix length is 8 chars
// (Crockford Base32) per D-20. Category column accommodates 'recovery'
// (8 chars) + 'training' (8 chars) + padding. Decision column truncates
// at 40 chars.
// ---------------------------------------------------------------------------
const ID_COL_WIDTH = 10;
const CATEGORY_COL_WIDTH = 11;
const DECISION_COL_WIDTH = 44;
const ELAPSED_COL_WIDTH = 16;

const DECISION_TEXT_MAX_LEN = 40;
const ID_PREFIX_LEN = 8;

const DEFAULT_FOLLOW_UP_DAYS = 7;
const MS_PER_DAY = 86_400_000;

const SECTION_INDENT = '  ';

// ---------------------------------------------------------------------------
// Public entry points — three named functions per Plan 04-09 artifact
// spec. The omnibus `renderDecisionList` dispatches by input shape; the
// two single-purpose functions are exported for callers that already
// know they want a detail block or an update confirmation.
// ---------------------------------------------------------------------------

export function renderDecisionList(
  arg: readonly Decision[] | Decision | ReviewDecisionsResult,
  now?: Date,
): string {
  // Array input → list mode.
  if (Array.isArray(arg)) {
    return renderListTable(arg as readonly Decision[], now ?? new Date());
  }
  // ReviewDecisionsResult shape → narrow by mode.
  if (isReviewDecisionsResult(arg)) {
    if (arg.mode === 'list') {
      return renderListTable(arg.decisions, now ?? new Date());
    }
    return renderDecisionUpdate(arg.decision);
  }
  // Bare Decision → detail mode.
  return renderDecisionDetail(arg as Decision);
}

export function renderDecisionDetail(d: Decision): string {
  const lines: string[] = [`Decision ${d.id}`];
  lines.push(`${SECTION_INDENT}Created: ${d.createdAt}`);
  lines.push(`${SECTION_INDENT}Category: ${d.category}`);
  lines.push(`${SECTION_INDENT}Status: ${d.status}`);
  lines.push(`${SECTION_INDENT}Decision: ${d.decision}`);
  if (d.rationale !== null) lines.push(`${SECTION_INDENT}Rationale: ${d.rationale}`);
  if (d.confidence !== null) lines.push(`${SECTION_INDENT}Confidence: ${d.confidence}`);
  if (d.expectedEffect !== null) {
    lines.push(`${SECTION_INDENT}Expected effect: ${d.expectedEffect}`);
  }
  if (d.followUpDate !== null) lines.push(`${SECTION_INDENT}Follow-up date: ${d.followUpDate}`);
  if (d.outcomeNotes !== null) lines.push(`${SECTION_INDENT}Outcome notes: ${d.outcomeNotes}`);
  return lines.join('\n');
}

export function renderDecisionUpdate(d: Decision): string {
  // D-21 single-line confirmation per Plan 04-09 behavior section.
  const prefix = d.id.slice(0, ID_PREFIX_LEN);
  return `decision ${prefix} updated to ${d.status}`;
}

// ---------------------------------------------------------------------------
// List table.
// ---------------------------------------------------------------------------

function renderListTable(decisions: readonly Decision[], now: Date): string {
  if (decisions.length === 0) {
    return 'No decisions recorded.';
  }

  const header =
    'ID'.padEnd(ID_COL_WIDTH) +
    'Category'.padEnd(CATEGORY_COL_WIDTH) +
    'Decision'.padEnd(DECISION_COL_WIDTH) +
    'Elapsed/Window'.padEnd(ELAPSED_COL_WIDTH) +
    'Status';

  const lines: string[] = [header];
  for (const d of decisions) {
    lines.push(formatDecisionRow(d, now));
  }
  return lines.join('\n');
}

function formatDecisionRow(d: Decision, now: Date): string {
  const idPrefix = d.id.slice(0, ID_PREFIX_LEN).padEnd(ID_COL_WIDTH);
  const category = truncatePad(d.category, CATEGORY_COL_WIDTH);
  const decisionText = truncatePad(d.decision, DECISION_COL_WIDTH);
  const elapsed = computeElapsed(d, now);
  const expectedWindow = computeExpectedWindow(d);
  const overWindow = elapsed > expectedWindow ? '*' : '';
  const elapsedColumn = `${elapsed}d/${expectedWindow}d${overWindow}`.padEnd(ELAPSED_COL_WIDTH);
  return `${idPrefix}${category}${decisionText}${elapsedColumn}${d.status}`;
}

// ---------------------------------------------------------------------------
// Helpers.
// ---------------------------------------------------------------------------

function computeElapsed(d: Decision, now: Date): number {
  const created = Date.parse(d.createdAt);
  if (!Number.isFinite(created)) return 0;
  const elapsedMs = now.getTime() - created;
  return Math.max(0, Math.floor(elapsedMs / MS_PER_DAY));
}

function computeExpectedWindow(d: Decision): number {
  if (d.followUpDate === null) return DEFAULT_FOLLOW_UP_DAYS;
  // Diff between calendar dates only — the followUpDate is yyyy-mm-dd (no
  // time component) and the createdAt timestamp's wall-clock time would
  // otherwise underflow the day count (e.g., 2026-03-15T15:00 → 2026-03-22
  // midnight = 6.625 days → floor to 6 instead of the canonical 7).
  const createdDate = d.createdAt.slice(0, 10);
  const created = Date.parse(`${createdDate}T00:00:00.000Z`);
  const followUp = Date.parse(`${d.followUpDate}T00:00:00.000Z`);
  if (!Number.isFinite(created) || !Number.isFinite(followUp)) {
    return DEFAULT_FOLLOW_UP_DAYS;
  }
  const diffDays = Math.floor((followUp - created) / MS_PER_DAY);
  return diffDays > 0 ? diffDays : DEFAULT_FOLLOW_UP_DAYS;
}

/** Truncate to `width - 4` characters with an ellipsis suffix if needed,
 *  then pad to `width`. The minus-4 leaves room for `...` plus a trailing
 *  space so adjacent columns stay readable. */
function truncatePad(text: string, width: number): string {
  if (text.length > DECISION_TEXT_MAX_LEN && width === DECISION_COL_WIDTH) {
    return `${text.slice(0, DECISION_TEXT_MAX_LEN - 3)}...`.padEnd(width);
  }
  if (text.length > width - 1) {
    return `${text.slice(0, width - 4)}...`.padEnd(width);
  }
  return text.padEnd(width);
}

function isReviewDecisionsResult(arg: unknown): arg is ReviewDecisionsResult {
  if (typeof arg !== 'object' || arg === null) return false;
  const a = arg as { mode?: unknown };
  return a.mode === 'list' || a.mode === 'update';
}
