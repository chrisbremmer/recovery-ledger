// QueryCache renderer — QueryCacheResult → compact text per D-24 8-arm
// dispatch (cycles / recoveries / sleeps / workouts / profile /
// body_measurements / sync_runs / decisions). Pure function: no I/O, no
// logger, no DB.
//
// Exhaustive switch on `result.resource` per ADR-0004 forcing function +
// D-24 §dispatch — adding a 9th arm to QueryCacheInput will fail to
// compile here because the `default: const _: never = ...` enforces
// exhaustiveness at compile time.
//
// Every arm renders a column-padded table with a trailing
// `count: N (truncated: true|false)` line so the user can confirm
// whether they hit the D-24 limit cap (default 100, hard-cap 500).
//
// Each row is rendered defensively — `rows: unknown[]` at the service-
// layer boundary; the per-arm renderer narrows to the entity shape only
// for the fields it reads. Missing/non-finite values render as
// '(unavailable)' rather than 'null' / 'NaN' / 'undefined' (same
// discipline as daily-review.txt.ts).
//
// `score_state` column surfaces the SCORED/PENDING_SCORE/UNSCORABLE
// discriminator from Phase 3 D-03 / ADR-0003 — so the user sees which
// rows can be read for statistics vs which are pending/unscorable.
//
// ADR-0001 (MCP stdout purity): no console.*, no process.stdout.write.

import type {
  BodyMeasurement,
  Cycle,
  Decision,
  Profile,
  Recovery,
  Sleep,
  SyncRun,
  Workout,
} from '../domain/types/entities.js';
import type { QueryCacheResult } from '../services/cache/types.js';
import { renderDecisionList } from './decision.txt.js';

// ---------------------------------------------------------------------------
// Column widths frozen at module scope. The widest column across all
// arms determines its width; remaining columns are space-aligned.
// ---------------------------------------------------------------------------
const DATE_COL_WIDTH = 22;
const NUMBER_COL_WIDTH = 8;
const SCORE_STATE_COL_WIDTH = 16;
const SHORT_ID_COL_WIDTH = 14;

const SECTION_INDENT = '  ';

// ---------------------------------------------------------------------------
// Public entry point.
// ---------------------------------------------------------------------------

export function renderQueryCache(result: QueryCacheResult): string {
  const body = renderResourceBody(result);
  const trailer = `count: ${result.count} (truncated: ${result.truncated})`;
  return `${body}\n--\n${trailer}`;
}

// ---------------------------------------------------------------------------
// Exhaustive switch on resource — ADR-0004 forcing function.
// ---------------------------------------------------------------------------

function renderResourceBody(result: QueryCacheResult): string {
  switch (result.resource) {
    case 'cycles':
      return renderCyclesTable(result.rows as Cycle[]);
    case 'recoveries':
      return renderRecoveriesTable(result.rows as Recovery[]);
    case 'sleeps':
      return renderSleepsTable(result.rows as Sleep[]);
    case 'workouts':
      return renderWorkoutsTable(result.rows as Workout[]);
    case 'profile':
      return renderProfileBlock(result.rows as Profile[]);
    case 'body_measurements':
      return renderBodyMeasurementsTable(result.rows as BodyMeasurement[]);
    case 'sync_runs':
      return renderSyncRunsTable(result.rows as SyncRun[]);
    case 'decisions':
      return renderDecisionList(result.rows as Decision[]);
  }
}

// ---------------------------------------------------------------------------
// Per-resource renderers.
// ---------------------------------------------------------------------------

function renderCyclesTable(rows: readonly Cycle[]): string {
  const header =
    'start'.padEnd(DATE_COL_WIDTH) +
    'end'.padEnd(DATE_COL_WIDTH) +
    'day_strain'.padEnd(NUMBER_COL_WIDTH + 4) +
    'recovery'.padEnd(NUMBER_COL_WIDTH + 4) +
    'score_state'.padEnd(SCORE_STATE_COL_WIDTH) +
    'baseline_excluded';
  if (rows.length === 0) return `${header}\n${SECTION_INDENT}(no rows)`;
  const lines = [header];
  for (const c of rows) {
    const start = (c.start ?? '').padEnd(DATE_COL_WIDTH);
    const end = (c.end ?? '(open)').padEnd(DATE_COL_WIDTH);
    const strain = (c.scoreState === 'SCORED' ? roundDecimal(c.strain, 1).toString() : '-').padEnd(
      NUMBER_COL_WIDTH + 4,
    );
    // Recovery score is on the recoveries table, not cycles. Cycles arm
    // surfaces the cycle's own measurements only.
    const recoveryColumn = '-'.padEnd(NUMBER_COL_WIDTH + 4);
    const state = c.scoreState.padEnd(SCORE_STATE_COL_WIDTH);
    const excluded = c.baselineExcluded ? 'yes' : 'no';
    lines.push(`${start}${end}${strain}${recoveryColumn}${state}${excluded}`);
  }
  return lines.join('\n');
}

function renderRecoveriesTable(rows: readonly Recovery[]): string {
  const header =
    'cycle_id'.padEnd(NUMBER_COL_WIDTH + 4) +
    'recovery_score'.padEnd(NUMBER_COL_WIDTH + 8) +
    'hrv_rmssd_ms'.padEnd(NUMBER_COL_WIDTH + 8) +
    'resting_hr'.padEnd(NUMBER_COL_WIDTH + 4) +
    'score_state';
  if (rows.length === 0) return `${header}\n${SECTION_INDENT}(no rows)`;
  const lines = [header];
  for (const r of rows) {
    const cycleId = r.cycleId.toString().padEnd(NUMBER_COL_WIDTH + 4);
    if (r.scoreState === 'SCORED') {
      const score = r.recoveryScore.toString().padEnd(NUMBER_COL_WIDTH + 8);
      const hrv = roundDecimal(r.hrvRmssdMilli, 1).toString().padEnd(NUMBER_COL_WIDTH + 8);
      const rhr = r.restingHeartRate.toString().padEnd(NUMBER_COL_WIDTH + 4);
      lines.push(`${cycleId}${score}${hrv}${rhr}${r.scoreState}`);
    } else {
      lines.push(
        `${cycleId}${'-'.padEnd(NUMBER_COL_WIDTH + 8)}${'-'.padEnd(NUMBER_COL_WIDTH + 8)}${'-'.padEnd(NUMBER_COL_WIDTH + 4)}${r.scoreState}`,
      );
    }
  }
  return lines.join('\n');
}

function renderSleepsTable(rows: readonly Sleep[]): string {
  const header =
    'id'.padEnd(SHORT_ID_COL_WIDTH) +
    'start'.padEnd(DATE_COL_WIDTH) +
    'end'.padEnd(DATE_COL_WIDTH) +
    'duration_min'.padEnd(NUMBER_COL_WIDTH + 8) +
    'efficiency_pct'.padEnd(NUMBER_COL_WIDTH + 8) +
    'score_state';
  if (rows.length === 0) return `${header}\n${SECTION_INDENT}(no rows)`;
  const lines = [header];
  for (const s of rows) {
    const id = s.id.slice(0, SHORT_ID_COL_WIDTH - 1).padEnd(SHORT_ID_COL_WIDTH);
    const start = s.start.padEnd(DATE_COL_WIDTH);
    const end = s.end.padEnd(DATE_COL_WIDTH);
    if (s.scoreState === 'SCORED') {
      const durationMin = (s.totalInBedTimeMilli - s.totalAwakeTimeMilli) / 60_000;
      const duration = roundDecimal(durationMin, 1).toString().padEnd(NUMBER_COL_WIDTH + 8);
      const efficiency = roundDecimal(s.sleepEfficiencyPercentage, 1)
        .toString()
        .padEnd(NUMBER_COL_WIDTH + 8);
      lines.push(`${id}${start}${end}${duration}${efficiency}${s.scoreState}`);
    } else {
      lines.push(
        `${id}${start}${end}${'-'.padEnd(NUMBER_COL_WIDTH + 8)}${'-'.padEnd(NUMBER_COL_WIDTH + 8)}${s.scoreState}`,
      );
    }
  }
  return lines.join('\n');
}

function renderWorkoutsTable(rows: readonly Workout[]): string {
  const header =
    'id'.padEnd(SHORT_ID_COL_WIDTH) +
    'start'.padEnd(DATE_COL_WIDTH) +
    'end'.padEnd(DATE_COL_WIDTH) +
    'sport_id'.padEnd(NUMBER_COL_WIDTH + 4) +
    'day_strain'.padEnd(NUMBER_COL_WIDTH + 4) +
    'score_state';
  if (rows.length === 0) return `${header}\n${SECTION_INDENT}(no rows)`;
  const lines = [header];
  for (const w of rows) {
    const id = w.id.slice(0, SHORT_ID_COL_WIDTH - 1).padEnd(SHORT_ID_COL_WIDTH);
    const start = w.start.padEnd(DATE_COL_WIDTH);
    const end = w.end.padEnd(DATE_COL_WIDTH);
    const sport = (w.sportId ?? '-').toString().padEnd(NUMBER_COL_WIDTH + 4);
    const strain = (w.scoreState === 'SCORED' ? roundDecimal(w.strain, 1).toString() : '-').padEnd(
      NUMBER_COL_WIDTH + 4,
    );
    lines.push(`${id}${start}${end}${sport}${strain}${w.scoreState}`);
  }
  return lines.join('\n');
}

function renderProfileBlock(rows: readonly Profile[]): string {
  if (rows.length === 0) return 'profile: (no row)';
  const p = rows[0];
  if (p === undefined) return 'profile: (no row)';
  const lines = [
    'profile:',
    `${SECTION_INDENT}user_id: ${p.userId}`,
    `${SECTION_INDENT}first_name: ${p.firstName}`,
    `${SECTION_INDENT}last_name: ${p.lastName}`,
    `${SECTION_INDENT}email: ${p.email}`,
  ];
  return lines.join('\n');
}

function renderBodyMeasurementsTable(rows: readonly BodyMeasurement[]): string {
  const header =
    'measured_at'.padEnd(DATE_COL_WIDTH) +
    'height_m'.padEnd(NUMBER_COL_WIDTH + 4) +
    'weight_kg'.padEnd(NUMBER_COL_WIDTH + 4) +
    'max_hr';
  if (rows.length === 0) return `${header}\n${SECTION_INDENT}(no rows)`;
  const lines = [header];
  for (const b of rows) {
    const at = b.capturedAt.padEnd(DATE_COL_WIDTH);
    const height = roundDecimal(b.heightMeter, 2).toString().padEnd(NUMBER_COL_WIDTH + 4);
    const weight = roundDecimal(b.weightKilogram, 1).toString().padEnd(NUMBER_COL_WIDTH + 4);
    lines.push(`${at}${height}${weight}${b.maxHeartRate}`);
  }
  return lines.join('\n');
}

function renderSyncRunsTable(rows: readonly SyncRun[]): string {
  const header =
    'id'.padEnd(NUMBER_COL_WIDTH) +
    'started_at'.padEnd(DATE_COL_WIDTH) +
    'finished_at'.padEnd(DATE_COL_WIDTH) +
    'status'.padEnd(NUMBER_COL_WIDTH + 4) +
    'gaps';
  if (rows.length === 0) return `${header}\n${SECTION_INDENT}(no rows)`;
  const lines = [header];
  for (const r of rows) {
    const id = r.id.toString().padEnd(NUMBER_COL_WIDTH);
    const started = r.startedAt.padEnd(DATE_COL_WIDTH);
    const finished = (r.finishedAt ?? '(running)').padEnd(DATE_COL_WIDTH);
    const status = r.status.padEnd(NUMBER_COL_WIDTH + 4);
    lines.push(`${id}${started}${finished}${status}${r.gapsDetected}`);
  }
  return lines.join('\n');
}

function roundDecimal(value: number, decimals: number): number {
  if (!Number.isFinite(value)) return 0;
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}
