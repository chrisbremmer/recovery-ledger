---
phase: 03-data-model-db-layer-sync-loop
plan: 02
type: execute
wave: 1
depends_on: ["03-01"]
files_modified:
  - src/infrastructure/db/schema.ts
  - src/infrastructure/db/schema.test.ts
  - src/infrastructure/db/migrations/0000_initial.sql
  - src/infrastructure/db/migrations/meta/_journal.json
  - src/infrastructure/db/migrations/meta/0000_snapshot.json
autonomous: true
requirements: [DATA-02, DATA-03, DATA-05, DATA-06]
tags: [drizzle, sqlite, schema, score-state, whoop]
user_setup: []

must_haves:
  truths:
    - "src/infrastructure/db/schema.ts declares 9 sqliteTables: sync_runs, cycles, recoveries, sleeps, workouts, daily_summaries, decisions, profile, body_measurements (D-01)"
    - "D-02 attestation: oauth_tokens is NOT a SQLite table — tokens stay in @napi-rs/keyring + ~/.recovery-ledger/tokens.json per Phase 2 ADR-0002 + ARCHITECTURE.md line 802; the schema must NOT declare an oauth_tokens table"
    - "cycles.id is integer (int64 per WHOOP v2 A6); sleeps.id, workouts.id are text (UUID per A6)"
    - "recoveries primary key is compound (cycle_id, sleep_id) per A12"
    - "Each scored entity (cycles, recoveries, sleeps, workouts) has an index named '<table>_score_state_start_idx' on (score_state, start) per D-05"
    - "Each WHOOP-sourced row has raw_json TEXT NOT NULL per D-01 / Pitfall 16"
    - "cycles table carries baseline_excluded INTEGER NOT NULL DEFAULT 0 + exclusion_reason TEXT (nullable; 'dst_straddle' | 'tz_drift' | NULL) per D-14"
    - "score_state is constrained to enum ['SCORED', 'PENDING_SCORE', 'UNSCORABLE'] per D-03"
    - "drizzle-kit generate produces src/infrastructure/db/migrations/0000_*.sql + meta/_journal.json + meta/0000_snapshot.json — all three committed"
    - "ADR-0001: schema.ts contains no console.* / process.stdout.write"
    - "Gate G (Wave 0): drizzle-orm/* imports are confined to src/infrastructure/db/ — schema.ts is the first consumer"
  artifacts:
    - path: "src/infrastructure/db/schema.ts"
      provides: "Drizzle table definitions for 9 v1 tables + 4 covering indexes"
      contains: "score_state"
    - path: "src/infrastructure/db/migrations/0000_initial.sql"
      provides: "Committed initial migration emitted by drizzle-kit generate"
      contains: "CREATE TABLE"
    - path: "src/infrastructure/db/migrations/meta/_journal.json"
      provides: "Canonical migration list consumed by Plan 03-05 hand-rolled migrator"
      contains: "entries"
  key_links:
    - from: "src/infrastructure/db/schema.ts"
      to: "drizzle-orm/sqlite-core"
      via: "named imports (sqliteTable, text, integer, real, index, primaryKey)"
      pattern: "from 'drizzle-orm/sqlite-core'"
    - from: "src/infrastructure/db/schema.ts"
      to: "src/infrastructure/db/migrations/"
      via: "drizzle-kit generate (drizzle.config.ts at repo root)"
      pattern: "0000_.*\\.sql"
---

<objective>
Land the Drizzle schema for 9 v1 tables in a single source-of-truth file and commit the first `drizzle-kit generate` output. The schema is the input to the hand-rolled migrator in Wave 2 Plan 03-05; the (score_state, start) covering indexes are load-bearing for Phase 4 baseline queries.

Purpose: Lock the table shape (D-01..D-05) and verify Drizzle Kit's output structure (meta/_journal.json + 0000_*.sql + 0000_snapshot.json) against assumptions A1/A2/A11 in 03-RESEARCH.md before Wave 2 writes the migrator that parses it.

Output: schema.ts (~240 LOC), schema.test.ts (introspection-based assertions), and 3 generated artifacts under `src/infrastructure/db/migrations/`.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/PROJECT.md
@.planning/ROADMAP.md
@.planning/STATE.md
@.planning/phases/03-data-model-db-layer-sync-loop/03-CONTEXT.md
@.planning/phases/03-data-model-db-layer-sync-loop/03-RESEARCH.md
@.planning/phases/03-data-model-db-layer-sync-loop/03-PATTERNS.md
@.planning/research/STACK.md
@.planning/research/ARCHITECTURE.md
@.planning/research/PITFALLS.md
@agent_docs/decisions/0003-score-state-discipline.md
@drizzle.config.ts

<interfaces>
<!-- Schema scope (D-01 — nine tables). The shape below is the authoritative target. -->

Tables (D-01):
  sync_runs        — lifecycle row; PK integer autoincrement; per_resource JSON text; status enum
  cycles           — id integer (int64); score_state enum; (score_state, start) idx; baseline_excluded + exclusion_reason
  recoveries       — compound PK (cycle_id, sleep_id); score_state enum; (score_state, start) idx
  sleeps           — id text (UUID); score_state enum; (score_state, start) idx
  workouts         — id text (UUID); score_state enum; (score_state, start) idx
  daily_summaries  — created empty in Phase 3; Phase 4 baseline service writes (resolves Open Q 1)
  decisions        — created Phase 3; Phase 4 surface (resolves Open Q 2)
  profile          — single-row low-volume; mostly raw_json
  body_measurements — append-on-change history (resolves Open Q 3 / D-35); mostly raw_json

Score-state literals (D-03):
  score_state: text('score_state', { enum: ['SCORED', 'PENDING_SCORE', 'UNSCORABLE'] }).notNull()

Index naming convention (D-05):
  index('<table>_score_state_start_idx').on(t.score_state, t.start)
</interfaces>
</context>

<tasks>

<task type="auto">
  <name>Task 1: Write Drizzle schema for 9 v1 tables with covering indexes</name>
  <files>src/infrastructure/db/schema.ts</files>
  <read_first>
    - .planning/phases/03-data-model-db-layer-sync-loop/03-CONTEXT.md decisions D-01 (table list), D-03 (score_state literals), D-05 ((score_state, start) index), D-14 (baseline_excluded + exclusion_reason on cycles), D-24 (sync_runs row shape)
    - .planning/phases/03-data-model-db-layer-sync-loop/03-RESEARCH.md §Pattern 2 lines 395-418 (cycles table verbatim shape) + §Assumptions Log A6 + A12 (cycle integer / sleep+workout UUID / recoveries compound PK)
    - .planning/phases/03-data-model-db-layer-sync-loop/03-PATTERNS.md §A2 lines 167-198 (schema skeleton)
    - .planning/research/PITFALLS.md Pitfall 16 (hybrid normalized + raw_json), Pitfall 7 (decisions are irreplaceable), Pitfall 3 (score_state discipline)
    - .planning/research/ARCHITECTURE.md §Migrations lines 590-624 (schema-as-source-of-truth)
    - agent_docs/decisions/0003-score-state-discipline.md (Score is the discriminator)
    - agent_docs/conventions.md (TS strict, no default exports)
  </read_first>
  <action>
    Create `src/infrastructure/db/schema.ts`. Import `sqliteTable, text, integer, real, index, primaryKey` from `drizzle-orm/sqlite-core` (the first Gate-G-allowlisted drizzle-orm import in the codebase).

    Declare exactly these named exports (no default exports per conventions.md):

    1. `cycles` — D-01 + verified WHOOP v2 cycle shape (developer.whoop.com/docs/developing/user-data/cycle/):
       - `id: integer('id').primaryKey()` (int64 per A6)
       - `user_id: integer('user_id').notNull()`
       - `created_at: text('created_at').notNull()`
       - `updated_at: text('updated_at').notNull()`
       - `start: text('start').notNull()`
       - `end: text('end')` (nullable per WHOOP cycle schema)
       - `timezone_offset: text('timezone_offset').notNull()`
       - `score_state: text('score_state', { enum: ['SCORED', 'PENDING_SCORE', 'UNSCORABLE'] }).notNull()`
       - SCORED-only nullable columns: `strain: real('strain')`, `kilojoule: real('kilojoule')`, `average_heart_rate: integer('average_heart_rate')`, `max_heart_rate: integer('max_heart_rate')`
       - `baseline_excluded: integer('baseline_excluded', { mode: 'boolean' }).notNull().default(false)` per D-14
       - `exclusion_reason: text('exclusion_reason', { enum: ['dst_straddle', 'tz_drift'] })` (nullable)
       - `raw_json: text('raw_json').notNull()` per Pitfall 16
       - Index callback (second arg): `byScoreStateStart: index('cycles_score_state_start_idx').on(t.score_state, t.start)`

    2. `recoveries` — compound PK `(cycle_id, sleep_id)` per A12 + verified recovery doc:
       - `cycle_id: integer('cycle_id').notNull().references(() => cycles.id)`
       - `sleep_id: text('sleep_id').notNull()` (UUID per A6)
       - `user_id: integer('user_id').notNull()`
       - `created_at: text('created_at').notNull()`
       - `updated_at: text('updated_at').notNull()`
       - `score_state: text('score_state', { enum: ['SCORED', 'PENDING_SCORE', 'UNSCORABLE'] }).notNull()`
       - SCORED-only nullable: `recovery_score: integer`, `resting_heart_rate: integer`, `hrv_rmssd_milli: real`, `spo2_percentage: real`, `skin_temp_celsius: real`, `user_calibrating: integer({mode: 'boolean'})`
       - `raw_json: text('raw_json').notNull()`
       - Index callback: `pk: primaryKey({ columns: [t.cycle_id, t.sleep_id] })` AND `byScoreStateStart: index('recoveries_score_state_start_idx').on(t.score_state, t.created_at)` — NOTE: recoveries has no `start` field on the wire; index on (score_state, created_at) to satisfy D-05's intent (created_at is the recovery timestamp).

    3. `sleeps` — `id: text('id').primaryKey()` (UUID); `user_id`, `created_at`, `updated_at`, `start: text('start').notNull()`, `end: text('end').notNull()`, `timezone_offset`, `score_state`, SCORED-only sleep fields (`total_in_bed_time_milli: integer`, `total_awake_time_milli: integer`, `sleep_performance_percentage: real`, `sleep_consistency_percentage: real`, `sleep_efficiency_percentage: real`, `respiratory_rate: real`), `raw_json`. Index: `sleeps_score_state_start_idx` on (score_state, start).

    4. `workouts` — same shape as sleeps (`id: text('id').primaryKey()` UUID); plus `sport_id: integer`, SCORED-only (`strain: real`, `average_heart_rate: integer`, `max_heart_rate: integer`, `kilojoule: real`, `distance_meter: real`, `altitude_gain_meter: real`, `altitude_change_meter: real`), `raw_json`. Index: `workouts_score_state_start_idx` on (score_state, start).

    5. `profile` — single-row table (D-01 mostly-raw_json):
       - `user_id: integer('user_id').primaryKey()`
       - `email: text('email').notNull()`
       - `first_name: text('first_name').notNull()`
       - `last_name: text('last_name').notNull()`
       - `raw_json: text('raw_json').notNull()`
       - `fetched_at: text('fetched_at').notNull()` (sync-time ISO; the WHOOP response carries no updated_at per A4)

    6. `body_measurements` — append-on-change history (D-35 sub-decision; Open Question 3 resolved as append-on-change):
       - `id: integer('id').primaryKey({ autoIncrement: true })` (synthetic row PK; the WHOOP response has no stable id)
       - `user_id: integer('user_id').notNull()`
       - `height_meter: real('height_meter').notNull()`
       - `weight_kilogram: real('weight_kilogram').notNull()`
       - `max_heart_rate: integer('max_heart_rate').notNull()`
       - `captured_at: text('captured_at').notNull()` (sync-time epoch ISO; the WHOOP response has no created_at)
       - `raw_json: text('raw_json').notNull()`

    7. `sync_runs` — lifecycle row per D-24:
       - `id: integer('id').primaryKey({ autoIncrement: true })`
       - `started_at: text('started_at').notNull()`
       - `finished_at: text('finished_at')` (nullable until finalize)
       - `status: text('status', { enum: ['running', 'ok', 'partial', 'failed'] }).notNull()`
       - `per_resource: text('per_resource').notNull().default('{}')` (JSON-as-text per resource outcomes)
       - `gaps_detected: integer('gaps_detected').notNull().default(0)`
       - `flags: text('flags')` (nullable JSON for --days / --since / --resources echo)

    8. `daily_summaries` — D-01 (created empty; Phase 4 baseline service writes):
       - `date: text('date').primaryKey()` (YYYY-MM-DD)
       - `user_id: integer('user_id').notNull()`
       - `recovery_score: integer('recovery_score')` (nullable)
       - `sleep_efficiency_percentage: real('sleep_efficiency_percentage')` (nullable)
       - `day_strain: real('day_strain')` (nullable)
       - `respiratory_rate: real('respiratory_rate')` (nullable)
       - `hrv_rmssd_milli: real('hrv_rmssd_milli')` (nullable)
       - `resting_heart_rate: integer('resting_heart_rate')` (nullable)
       - `computed_at: text('computed_at').notNull()`

    9. `decisions` — D-01 (irreplaceable user data per Pitfall 7; Phase 4 surface; minimal stub per Open Question 2):
       - `id: text('id').primaryKey()` (ULID per REQUIREMENTS.md DEC-01)
       - `created_at: text('created_at').notNull()`
       - `category: text('category').notNull()`
       - `decision: text('decision').notNull()`
       - `rationale: text('rationale')`
       - `confidence: text('confidence', { enum: ['low', 'medium', 'high'] })`
       - `expected_effect: text('expected_effect')`
       - `follow_up_date: text('follow_up_date')`
       - `status: text('status', { enum: ['open', 'followed_up', 'abandoned'] }).notNull().default('open')`
       - `outcome_notes: text('outcome_notes')`

    Add a leading module doc comment summarizing D-01 + D-03 + D-05 + D-14 + Pitfall 7 / 16 anchors. Do NOT use the literal substrings `console.*` or `process.stdout.write` or `oauth/oauth2/token` in any comment (avoids Gate B / C / E false positives in grep). Phrase as "no console calls / no direct stdout writes" if such guidance is needed.

    NO default export. NO `import type { Database }` from drizzle — this file declares schema, not connections. Plan 03-05 connection.ts owns Database imports.
  </action>
  <verify>
    <automated>npm run lint -- src/infrastructure/db/schema.ts && grep -c "sqliteTable" src/infrastructure/db/schema.ts</automated>
  </verify>
  <acceptance_criteria>
    - `grep -cE "^export const (cycles|recoveries|sleeps|workouts|daily_summaries|decisions|profile|body_measurements|sync_runs)" src/infrastructure/db/schema.ts` returns 9
    - `grep -c "score_state_start_idx" src/infrastructure/db/schema.ts` returns at least 4 (cycles, recoveries, sleeps, workouts)
    - `grep -c "raw_json" src/infrastructure/db/schema.ts` returns at least 6 (cycles, recoveries, sleeps, workouts, profile, body_measurements)
    - `grep -c "baseline_excluded" src/infrastructure/db/schema.ts` returns at least 2 (column declaration on cycles + exclusion_reason)
    - `grep -c "from 'drizzle-orm/sqlite-core'" src/infrastructure/db/schema.ts` returns 1 (first allowlisted drizzle-orm import per Gate G)
    - `grep -cE "^export default" src/infrastructure/db/schema.ts` returns 0 (named exports only per conventions.md)
    - `grep -v '^\s*//' src/infrastructure/db/schema.ts | grep -v '^\s*\*' | grep -c "console\." ` returns 0
    - `bash scripts/ci-grep-gates.sh` exits 0 (Gates A-G all green including Gate G's first real exercise)
    - `npm run lint` exits 0
  </acceptance_criteria>
  <done>9 tables declared; 4 covering indexes on (score_state, start)-shaped columns; raw_json on all 6 WHOOP-sourced tables; cycles carries baseline_excluded + exclusion_reason; module is the first drizzle-orm consumer and Gate G stays green.</done>
</task>

<task type="auto">
  <name>Task 2: Run drizzle-kit generate + commit the migration artifacts + introspection tests</name>
  <files>src/infrastructure/db/migrations/0000_initial.sql, src/infrastructure/db/migrations/meta/_journal.json, src/infrastructure/db/migrations/meta/0000_snapshot.json, src/infrastructure/db/schema.test.ts</files>
  <read_first>
    - drizzle.config.ts (Wave 0 Plan 03-01 output — confirms schema path + out path + dialect)
    - src/infrastructure/db/schema.ts (Task 1 output — input to drizzle-kit generate)
    - .planning/phases/03-data-model-db-layer-sync-loop/03-RESEARCH.md §Technical Research item 7 lines 1122-1145 (drizzle-kit generate output structure + __drizzle_migrations table shape)
    - .planning/phases/03-data-model-db-layer-sync-loop/03-RESEARCH.md §Assumptions Log A1, A2, A10, A11 (Wave-0 smoke verification of drizzle-kit output)
    - .planning/phases/03-data-model-db-layer-sync-loop/03-PATTERNS.md §A3 lines 218-289 (migrator parses _journal.json — schema.test.ts asserts the file structure the migrator expects)
  </read_first>
  <action>
    Run `npx drizzle-kit generate --name initial`. This MUST emit three files under `src/infrastructure/db/migrations/`:
      - `0000_<random_name>.sql` — rename to `0000_initial.sql` (deterministic for the migrator + git diffs). drizzle-kit names files with a `<idx>_<random>` pattern by default; the `--name initial` flag overrides the random portion. If renaming is needed, also update `meta/_journal.json` entries[0].tag from `<idx>_<random>` to `0000_initial` so the journal-file linkage holds.
      - `meta/_journal.json` — entries array; verify shape `{version, dialect, entries: [{idx, when, tag, breakpoints}]}` per A1
      - `meta/0000_snapshot.json` — schema snapshot used by drizzle-kit for future diffs

    Inspect the emitted SQL to confirm A10 (whole-file-as-one-transaction is safe — no `VACUUM` or other non-transactional statements). If the SQL contains anything other than `CREATE TABLE` / `CREATE INDEX` / `--> statement-breakpoint` markers, FLAG it in the plan summary so Plan 03-05's migrator can be adjusted. Expected output: 9 CREATE TABLE statements + 4 CREATE INDEX statements + `--> statement-breakpoint` separators, all DDL.

    Commit all three files. The `__drizzle_migrations` table is NOT created here — Plan 03-05's hand-rolled migrator creates it at runtime per RESEARCH.md §Technical Research item 7.

    Create `src/infrastructure/db/schema.test.ts` with introspection-only assertions (no DB connection — pure JS imports of the schema module):
      - Test 1: `import * as schema from './schema.js'` exposes exactly 9 named tables (assert via `Object.keys(schema).filter(k => schema[k]?.[Symbol.for('drizzle:Name')] !== undefined).length === 9` or equivalent Drizzle introspection helper).
      - Test 2: Each of the 4 scored tables (cycles, recoveries, sleeps, workouts) has at least one index whose name matches `/^<table>_score_state_start_idx$/`. Use Drizzle's `getTableConfig()` or read the table's internal `indexes` field. If introspection API is awkward, fall back to a string-level test that reads `schema.ts` source and greps `index\('<table>_score_state_start_idx'\)` once per scored table.
      - Test 3: `cycles` table's columns include `baseline_excluded` and `exclusion_reason` with the expected SQL types (boolean / text-nullable). Same fallback option.
      - Test 4: `decisions` table's `status` column enum includes exactly `['open', 'followed_up', 'abandoned']`.
      - Test 5: `meta/_journal.json` parses as JSON with `entries[0].tag === '0000_initial'` (lock the rename + journal sync from above).
      - Test 6: `0000_initial.sql` contains exactly 9 `CREATE TABLE` statements (via `grep -c 'CREATE TABLE' src/infrastructure/db/migrations/0000_initial.sql` or `readFileSync(...).match(/CREATE TABLE/g).length === 9`).

    Do NOT spin up a real `better-sqlite3` connection here — that's Plan 03-05's job. The schema tests are purely declarative.
  </action>
  <verify>
    <automated>npm run test -- src/infrastructure/db/schema.test.ts</automated>
  </verify>
  <acceptance_criteria>
    - `src/infrastructure/db/migrations/0000_initial.sql` exists and contains 9 `CREATE TABLE` statements — `grep -c '^CREATE TABLE' src/infrastructure/db/migrations/0000_initial.sql` returns 9
    - `src/infrastructure/db/migrations/0000_initial.sql` contains at least 4 `CREATE INDEX` statements — `grep -c '^CREATE INDEX' src/infrastructure/db/migrations/0000_initial.sql` returns at least 4
    - `src/infrastructure/db/migrations/meta/_journal.json` parses with `node -e "const j = JSON.parse(require('fs').readFileSync('src/infrastructure/db/migrations/meta/_journal.json', 'utf8')); console.log(j.entries[0].tag)"` printing `0000_initial`
    - `src/infrastructure/db/migrations/meta/0000_snapshot.json` exists and parses as valid JSON
    - `npm run test -- src/infrastructure/db/schema.test.ts` shows ≥ 6 assertions passing
    - The SQL payload contains only DDL — `grep -cE '^(VACUUM|DELETE|UPDATE|INSERT)' src/infrastructure/db/migrations/0000_initial.sql` returns 0 (confirms A10)
    - `bash scripts/ci-grep-gates.sh` exits 0
  </acceptance_criteria>
  <done>Committed 3 generated files + introspection-only schema tests; assumptions A1/A2/A10/A11 verified on disk; Plan 03-05's migrator has a known fixed input to parse.</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| developer schema edits → committed migrations | One-way: schema.ts changes are reflected via drizzle-kit generate; the committed .sql is the source of truth for the runtime migrator |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-03.02-01 | Tampering | src/infrastructure/db/migrations/0000_initial.sql | mitigate | Drizzle-kit generated; committed verbatim; schema.test.ts asserts CREATE TABLE count (9) so a future hand-edit that drops a table fails CI |
| T-03.02-02 | Information disclosure | baseline_excluded / exclusion_reason on cycles | accept | Internal field; no PII; documented in D-14 |
| T-03.02-03 | Repudiation | sync_runs table created without per-run signing | accept | Personal tool; sync_runs is diagnostic only, no audit-trail security claim |
| T-03.02-04 | Denial of service | (score_state, start) index missing on a scored table | mitigate | schema.test.ts Test 2 asserts the 4 covering indexes exist (Pitfall 16 workhorse); regression caught at CI |
</threat_model>

<verification>
- `npm run test -- src/infrastructure/db/schema.test.ts` → all 6 assertions green
- `npm run lint` → 0 errors
- `bash scripts/ci-grep-gates.sh` → all 7 gates green (Gate G now exercises real drizzle-orm import in schema.ts)
- `cat src/infrastructure/db/migrations/meta/_journal.json | jq '.entries[0].tag'` → `"0000_initial"`
- `grep -c 'CREATE TABLE' src/infrastructure/db/migrations/0000_initial.sql` → 9
</verification>

<success_criteria>
- 9 tables declared with hybrid normalized + raw_json shape (D-01)
- 4 (score_state, start)-shaped covering indexes on scored tables (D-05)
- baseline_excluded + exclusion_reason columns on cycles (D-14)
- score_state enum constraint on all 4 scored tables (D-03)
- drizzle-kit output committed: 0000_initial.sql + meta/_journal.json + meta/0000_snapshot.json
- schema.test.ts locks the table count + index names + decisions status enum
- Assumptions A1/A2/A10/A11 confirmed: journal entry shape, __drizzle_migrations not auto-created, only DDL in the .sql
</success_criteria>

<output>
Create `.planning/phases/03-data-model-db-layer-sync-loop/03-02-SUMMARY.md` when done.
</output>
