// Drizzle schema — the single source of truth for Recovery Ledger's local
// SQLite cache (D-01). Read by `drizzle-kit generate` (drizzle.config.ts) to
// emit `src/infrastructure/db/migrations/0000_initial.sql` + `meta/_journal.json`
// + `meta/0000_snapshot.json`. The hand-rolled migrator (Wave 2 Plan 03-05)
// then parses `meta/_journal.json` and applies each pending `.sql` payload
// inside a `BEGIN IMMEDIATE` transaction per ADR D-06 + Pitfall 13.
//
// Hot-path discipline (Pitfall 16): every WHOOP-sourced table follows a hybrid
// shape — normalized columns for `score_state`, `start`, `end`,
// `timezone_offset`, `updated_at`, and the SCORED-only numeric scores; plus a
// `raw_json TEXT NOT NULL` column for forward-compat reparse. Domain code reads
// the normalized columns; the diagnostic `getRawJson(id)` boundary path returns
// the JSON payload for `whoop_query_cache` / `whoop_api_gap` (Phase 4).
//
// score_state discipline (D-03 + ADR-0003): every scored entity carries the
// three-state enum `'SCORED' | 'PENDING_SCORE' | 'UNSCORABLE'` as a typed
// `text(... { enum: [...] })` column. The discriminated union in
// `src/domain/types/score.ts` (Wave 1B) narrows on this column; repositories
// default to `WHERE score_state = 'SCORED'` per D-04.
//
// Covering indexes (D-05): the four scored tables — cycles, recoveries, sleeps,
// workouts — each get an `<table>_score_state_start_idx` on
// `(score_state, start)` (or `(score_state, created_at)` for recoveries, which
// has no `start` field on the wire — created_at is the recovery timestamp).
// This is the workhorse query shape for Phase 4 baseline aggregation.
//
// DST/tz-shift exclusion (D-14 + Pitfall 6): `cycles` carries
// `baseline_excluded INTEGER NOT NULL DEFAULT 0` + `exclusion_reason TEXT`
// (nullable; 'dst_straddle' | 'tz_drift' | NULL). Recovery, sleep, and workout
// rows inherit the flag at query time via `cycle_id`. Computed at upsert
// (D-14); re-evaluated on every retroactive WHOOP update via D-11's
// ON CONFLICT(id) DO UPDATE.
//
// `decisions` is irreplaceable user data per Pitfall 7 — separate backup
// posture (D-01). `profile` is single-row low-volume (mostly raw_json);
// `body_measurements` is an append-on-change history (D-35 / Open Q 3).
//
// `oauth_tokens` is NOT a SQLite table (D-02): Phase 2 stores tokens in
// `@napi-rs/keyring` + `~/.recovery-ledger/tokens.json` file fallback per
// ADR-0002. ARCHITECTURE.md line 802 explicitly rejects coupling token-read
// to DB readiness — tokens are read on every WHOOP call.
//
// Gate G (Wave 0 chokepoint): `drizzle-orm/*` imports are confined to
// `src/infrastructure/db/` per ARCHITECTURE.md Anti-Pattern 3. This file is the
// first allowlisted consumer; the gate stays green as long as named imports
// stay under this directory. No direct stdout writes / no Pino calls here —
// schema declaration only.

import { index, integer, primaryKey, real, sqliteTable, text } from 'drizzle-orm/sqlite-core';

// ----------------------------------------------------------------------------
// 1. cycles — physiological cycle (WHOOP v2; integer int64 id per A6).
//    Hot-path table. (score_state, start) index per D-05. baseline_excluded +
//    exclusion_reason per D-14.
// ----------------------------------------------------------------------------

export const cycles = sqliteTable(
  'cycles',
  {
    id: integer('id').primaryKey(),
    user_id: integer('user_id').notNull(),
    created_at: text('created_at').notNull(),
    updated_at: text('updated_at').notNull(),
    start: text('start').notNull(),
    end: text('end'),
    timezone_offset: text('timezone_offset').notNull(),
    score_state: text('score_state', {
      enum: ['SCORED', 'PENDING_SCORE', 'UNSCORABLE'],
    }).notNull(),
    // SCORED-only numeric fields — nullable at the column level; the
    // discriminated union in src/domain/types/score.ts (Wave 1B) refuses any
    // read without first narrowing on score_state === 'SCORED'.
    strain: real('strain'),
    kilojoule: real('kilojoule'),
    average_heart_rate: integer('average_heart_rate'),
    max_heart_rate: integer('max_heart_rate'),
    // D-14: DST/tz exclusion flag computed at upsert time. Recovery / sleep /
    // workouts inherit via cycle_id at query time.
    baseline_excluded: integer('baseline_excluded', { mode: 'boolean' }).notNull().default(false),
    exclusion_reason: text('exclusion_reason', {
      enum: ['dst_straddle', 'tz_drift'],
    }),
    raw_json: text('raw_json').notNull(),
  },
  (t) => [index('cycles_score_state_start_idx').on(t.score_state, t.start)],
);

// ----------------------------------------------------------------------------
// 2. recoveries — compound PK (cycle_id, sleep_id) per A12. cycle_id is int64
//    (FK → cycles.id); sleep_id is UUID. No `start` on the wire — recoveries
//    are timestamped via created_at, so the D-05 covering index is on
//    (score_state, created_at).
// ----------------------------------------------------------------------------

export const recoveries = sqliteTable(
  'recoveries',
  {
    cycle_id: integer('cycle_id')
      .notNull()
      .references(() => cycles.id),
    sleep_id: text('sleep_id').notNull(),
    user_id: integer('user_id').notNull(),
    created_at: text('created_at').notNull(),
    updated_at: text('updated_at').notNull(),
    score_state: text('score_state', {
      enum: ['SCORED', 'PENDING_SCORE', 'UNSCORABLE'],
    }).notNull(),
    // SCORED-only fields per WHOOP v2 ScoredRecovery doc.
    recovery_score: integer('recovery_score'),
    resting_heart_rate: integer('resting_heart_rate'),
    hrv_rmssd_milli: real('hrv_rmssd_milli'),
    spo2_percentage: real('spo2_percentage'),
    skin_temp_celsius: real('skin_temp_celsius'),
    user_calibrating: integer('user_calibrating', { mode: 'boolean' }),
    raw_json: text('raw_json').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.cycle_id, t.sleep_id] }),
    index('recoveries_score_state_start_idx').on(t.score_state, t.created_at),
  ],
);

// ----------------------------------------------------------------------------
// 3. sleeps — id is UUID (text) per WHOOP v2 A6. Hot-path table.
// ----------------------------------------------------------------------------

export const sleeps = sqliteTable(
  'sleeps',
  {
    id: text('id').primaryKey(),
    user_id: integer('user_id').notNull(),
    created_at: text('created_at').notNull(),
    updated_at: text('updated_at').notNull(),
    start: text('start').notNull(),
    end: text('end').notNull(),
    timezone_offset: text('timezone_offset').notNull(),
    score_state: text('score_state', {
      enum: ['SCORED', 'PENDING_SCORE', 'UNSCORABLE'],
    }).notNull(),
    // SCORED-only fields per WHOOP v2 ScoredSleep doc.
    total_in_bed_time_milli: integer('total_in_bed_time_milli'),
    total_awake_time_milli: integer('total_awake_time_milli'),
    sleep_performance_percentage: real('sleep_performance_percentage'),
    sleep_consistency_percentage: real('sleep_consistency_percentage'),
    sleep_efficiency_percentage: real('sleep_efficiency_percentage'),
    respiratory_rate: real('respiratory_rate'),
    raw_json: text('raw_json').notNull(),
  },
  (t) => [index('sleeps_score_state_start_idx').on(t.score_state, t.start)],
);

// ----------------------------------------------------------------------------
// 4. workouts — id is UUID (text) per WHOOP v2 A6. Hot-path table.
// ----------------------------------------------------------------------------

export const workouts = sqliteTable(
  'workouts',
  {
    id: text('id').primaryKey(),
    user_id: integer('user_id').notNull(),
    created_at: text('created_at').notNull(),
    updated_at: text('updated_at').notNull(),
    start: text('start').notNull(),
    end: text('end').notNull(),
    timezone_offset: text('timezone_offset').notNull(),
    sport_id: integer('sport_id'),
    score_state: text('score_state', {
      enum: ['SCORED', 'PENDING_SCORE', 'UNSCORABLE'],
    }).notNull(),
    // SCORED-only fields per WHOOP v2 ScoredWorkout doc.
    strain: real('strain'),
    average_heart_rate: integer('average_heart_rate'),
    max_heart_rate: integer('max_heart_rate'),
    kilojoule: real('kilojoule'),
    distance_meter: real('distance_meter'),
    altitude_gain_meter: real('altitude_gain_meter'),
    altitude_change_meter: real('altitude_change_meter'),
    raw_json: text('raw_json').notNull(),
  },
  (t) => [index('workouts_score_state_start_idx').on(t.score_state, t.start)],
);

// ----------------------------------------------------------------------------
// 5. profile — single-row table (D-01 mostly-raw_json). WHOOP profile response
//    has no updated_at per A4 — captured_at is sync-time ISO.
// ----------------------------------------------------------------------------

export const profile = sqliteTable('profile', {
  user_id: integer('user_id').primaryKey(),
  email: text('email').notNull(),
  first_name: text('first_name').notNull(),
  last_name: text('last_name').notNull(),
  raw_json: text('raw_json').notNull(),
  fetched_at: text('fetched_at').notNull(),
});

// ----------------------------------------------------------------------------
// 6. body_measurements — append-on-change history (D-35 sub-decision per Open
//    Question 3). WHOOP response has no stable id; synthetic autoincrement.
// ----------------------------------------------------------------------------

export const body_measurements = sqliteTable('body_measurements', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  user_id: integer('user_id').notNull(),
  height_meter: real('height_meter').notNull(),
  weight_kilogram: real('weight_kilogram').notNull(),
  max_heart_rate: integer('max_heart_rate').notNull(),
  captured_at: text('captured_at').notNull(),
  raw_json: text('raw_json').notNull(),
});

// ----------------------------------------------------------------------------
// 7. sync_runs — lifecycle row per D-24. per_resource is JSON-as-text holding
//    {cycles: {fetched, upserted, errors, durationMs}, ...}. flags holds the
//    CLI/MCP input echo (--days / --since / --resources).
// ----------------------------------------------------------------------------

export const sync_runs = sqliteTable('sync_runs', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  started_at: text('started_at').notNull(),
  finished_at: text('finished_at'),
  status: text('status', {
    // 'aborted' added (#15 + #35) for crash recovery — sync_runs rows
    // whose process died (SIGINT/SIGTERM/hard kill) are reclassified by
    // the signal handler or by bootstrap's stale-row sweep.
    enum: ['running', 'ok', 'partial', 'failed', 'aborted'],
  }).notNull(),
  per_resource: text('per_resource').notNull().default('{}'),
  gaps_detected: integer('gaps_detected').notNull().default(0),
  flags: text('flags'),
});

// ----------------------------------------------------------------------------
// 8. daily_summaries — D-01 (created empty here; Phase 4 baseline service
//    writes during review computation). PK is YYYY-MM-DD.
// ----------------------------------------------------------------------------

export const daily_summaries = sqliteTable('daily_summaries', {
  date: text('date').primaryKey(),
  user_id: integer('user_id').notNull(),
  recovery_score: integer('recovery_score'),
  sleep_efficiency_percentage: real('sleep_efficiency_percentage'),
  day_strain: real('day_strain'),
  respiratory_rate: real('respiratory_rate'),
  hrv_rmssd_milli: real('hrv_rmssd_milli'),
  resting_heart_rate: integer('resting_heart_rate'),
  computed_at: text('computed_at').notNull(),
});

// ----------------------------------------------------------------------------
// 9. decisions — D-01; irreplaceable user data per Pitfall 7. Phase 4 surface;
//    minimal stub shape per Open Question 2 / REQUIREMENTS.md DEC-01 (ULID id).
// ----------------------------------------------------------------------------

export const decisions = sqliteTable('decisions', {
  id: text('id').primaryKey(),
  created_at: text('created_at').notNull(),
  category: text('category').notNull(),
  decision: text('decision').notNull(),
  rationale: text('rationale'),
  confidence: text('confidence', { enum: ['low', 'medium', 'high'] }),
  expected_effect: text('expected_effect'),
  follow_up_date: text('follow_up_date'),
  status: text('status', {
    enum: ['open', 'followed_up', 'abandoned'],
  })
    .notNull()
    .default('open'),
  outcome_notes: text('outcome_notes'),
});
