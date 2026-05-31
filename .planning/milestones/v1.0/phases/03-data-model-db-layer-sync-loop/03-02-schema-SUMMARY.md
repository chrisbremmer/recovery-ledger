---
phase: 03-data-model-db-layer-sync-loop
plan: 02
subsystem: db
tags: [drizzle, sqlite, schema, score-state, whoop, migrations]

requires:
  - phase: 03-data-model-db-layer-sync-loop
    plan: 01
    provides: "drizzle.config.ts (schema + out + dialect=sqlite), drizzle-orm@0.45.2 + drizzle-kit@0.31.10 installed, Gate G allowlist-ready, ResolvedPaths DB-layer fields"
provides:
  - "src/infrastructure/db/schema.ts — 9 sqliteTable named exports (cycles, recoveries, sleeps, workouts, profile, body_measurements, sync_runs, daily_summaries, decisions) with 4 covering indexes on (score_state, start)-shape columns (D-01 / D-03 / D-05 / D-14)"
  - "src/infrastructure/db/migrations/0000_initial.sql — drizzle-kit emitted DDL payload: 9 CREATE TABLE + 4 CREATE INDEX statements with --> statement-breakpoint markers"
  - "src/infrastructure/db/migrations/meta/_journal.json — canonical migration list (entries[0].tag === '0000_initial') that Plan 03-05's hand-rolled migrator parses verbatim"
  - "src/infrastructure/db/migrations/meta/0000_snapshot.json — drizzle-kit diff base for future schema changes"
  - "src/infrastructure/db/schema.test.ts — 14 introspection-only assertions locking table count, index names, cycles DST/tz columns, decisions status enum, and generate output shape"
affects:
  - "03-05 migrate (consumes meta/_journal.json entry shape + 0000_initial.sql DDL-only payload + the __drizzle_migrations table shape this plan documents but does NOT create)"
  - "03-09 repositories (consume the 9 table definitions + 4 covering indexes for Phase 4 baseline queries)"
  - "03-03 score-types (consumes the score_state enum literals ['SCORED', 'PENDING_SCORE', 'UNSCORABLE'] declared in schema.ts)"

tech-stack:
  added: []
  patterns:
    - "Drizzle 0.45.x array-return form for index/PK callbacks: `(t) => [index('name').on(t.col1, t.col2)]` — the object-return form is deprecated and emits a TS warning; this is the first plan that lands the new shape"
    - "Hybrid normalized + raw_json discipline (Pitfall 16) — every WHOOP-sourced table carries the hot-path normalized columns plus `raw_json TEXT NOT NULL` for forward-compat reparse and the future `whoop_query_cache` boundary"
    - "Introspection-only schema testing — pure `getTableConfig()` assertions + filesystem reads of the emitted SQL/JSON; no `better-sqlite3` connection; no migrator; 14 tests run in 5ms"

key-files:
  created:
    - "src/infrastructure/db/schema.ts"
    - "src/infrastructure/db/schema.test.ts"
    - "src/infrastructure/db/migrations/0000_initial.sql"
    - "src/infrastructure/db/migrations/meta/_journal.json"
    - "src/infrastructure/db/migrations/meta/0000_snapshot.json"
    - ".planning/phases/03-data-model-db-layer-sync-loop/03-02-schema-SUMMARY.md"
  modified: []

key-decisions:
  - "Adopted Drizzle 0.45.x array-return callback shape `(t) => [index(...).on(...)]` instead of the plan's verbatim object-return shape `(t) => ({byScoreStateStart: ...})` — the object form is officially DEPRECATED in drizzle-orm@0.45.2 (TS emits a deprecation warning pointing at the array form as the New API). Functional outcome identical: drizzle-kit generate emits the same CREATE INDEX statements. Rule 1 plan-text correction; same precedent as Plan 02-01 paths.ts / Plan 02-02 token-store.ts comment-phrasing fixes."
  - "Recoveries index column changed from (score_state, start) to (score_state, created_at) per the plan's own explicit guidance — recoveries has no `start` field on the wire; created_at is the recovery timestamp. The D-05 covering-index name `recoveries_score_state_start_idx` is retained (the name is the contract; the second column choice was already documented in the plan's Task 1 action block)."
  - "drizzle-kit honored `--name initial` deterministically — the emitted file was named `0000_initial.sql` directly, so the plan's contingency rename + journal-tag fix-up step was unnecessary. Confirmed `meta/_journal.json` entries[0].tag === '0000_initial' on first run; no edit applied."
  - "Schema-test introspection chose `getTableConfig()` over a source-grep fallback. Drizzle 0.45.2 exposes the full table config (name, columns with notNull/dataType/enumValues, indexes with config.name + config.columns) so all six required assertions land via the live runtime types — strictly stronger than a string match on the source file."

patterns-established:
  - "Phase 3 schema-test pattern: pure introspection via getTableConfig + filesystem reads of generated SQL/JSON; no DB I/O. Wave 2 Plan 03-05's migrator test will be the FIRST plan to spin up better-sqlite3 — preserving the boundary between 'schema correctness' (pure) and 'migrator behavior' (integration)."
  - "Drizzle deprecation-aware migration: when STACK.md pins a major version that has deprecated an API style in a minor (0.36 → 0.45 deprecated object-callback), use the New API form even if the plan body or RESEARCH.md quotes the deprecated form verbatim. The plan body is descriptive of intent; the New API form is the executable shape."

requirements-completed: [DATA-02, DATA-03, DATA-05, DATA-06]

duration: 4m
completed: 2026-05-16
---

# Phase 3 Plan 02: Schema Summary

**9 Drizzle table definitions in a single source-of-truth file, 4 covering indexes on (score_state, start)-shape columns, and the first `drizzle-kit generate` output committed — 14 introspection assertions lock the contract for Plan 03-05's hand-rolled migrator.**

## Performance

- **Duration:** 4m (12:12:31 → 12:16:31 PDT, two atomic task commits)
- **Started:** 2026-05-16T19:12:31Z
- **Completed:** 2026-05-16T19:16:31Z
- **Tasks:** 2 / 2
- **Files created:** 5 (schema.ts, schema.test.ts, 0000_initial.sql, _journal.json, 0000_snapshot.json)

## Accomplishments

- `src/infrastructure/db/schema.ts` declares exactly 9 sqliteTable named exports (no defaults): cycles, recoveries, sleeps, workouts, profile, body_measurements, sync_runs, daily_summaries, decisions. Every scored entity (cycles, recoveries, sleeps, workouts) carries the typed `score_state` enum and a `<table>_score_state_start_idx` covering index. cycles carries `baseline_excluded INTEGER NOT NULL DEFAULT 0` + `exclusion_reason TEXT` (nullable 'dst_straddle' | 'tz_drift') per D-14. All 6 WHOOP-sourced tables carry `raw_json TEXT NOT NULL` per Pitfall 16.
- `drizzle-kit generate --name initial` emitted 3 files first try: `0000_initial.sql` (9 CREATE TABLE + 4 CREATE INDEX + `--> statement-breakpoint` separators; DDL-only — confirms A10), `meta/_journal.json` (entries[0].tag === '0000_initial', dialect === 'sqlite'; confirms A1 + A11), `meta/0000_snapshot.json` (drizzle-kit diff base; valid JSON). No rename needed.
- `src/infrastructure/db/schema.test.ts` runs 14 introspection assertions in 5ms: table-count (1 × 9-named-exports + 1 × getTableConfig-accessible), covering-indexes (4 × it.each + 1 × column-shape lock + 1 × recoveries-special-case), cycles DST/tz columns (1 × baseline_excluded + exclusion_reason notNull + dataType), decisions status enum (1 × exact-array-match), generate output (5 × journal tag + table count + index count + DDL-only + snapshot parses).
- Gate G stays green-on-allowlisted: `src/infrastructure/db/schema.ts` is now the first allowlisted consumer of `drizzle-orm/sqlite-core` in the project. Any future `from 'drizzle-orm/...'` import outside `src/infrastructure/db/` would trip the gate immediately.
- D-17 + D-18 attestation preserved: no MCP tools added (`src/mcp/tools/` untouched); `src/mcp/sanitize.ts` and `src/mcp/register.ts` byte-identical to origin/main.

## Task Commits

Each task was committed atomically:

1. **Task 1: Write Drizzle schema for 9 v1 tables with covering indexes** — `9db8e04` (feat)
2. **Task 2: Run drizzle-kit generate + commit migration artifacts + introspection tests** — `a888dc3` (feat)

**Plan metadata commit:** pending (lands with this SUMMARY.md + STATE.md + ROADMAP.md update)

## Files Created/Modified

- `src/infrastructure/db/schema.ts` (created) — 9 sqliteTable named exports; 4 covering indexes; 6 raw_json columns; cycles baseline_excluded + exclusion_reason. ~210 LOC including module-leading doc comment summarizing D-01 / D-03 / D-05 / D-14 / Pitfall 7 / Pitfall 16 anchors.
- `src/infrastructure/db/schema.test.ts` (created) — 14 introspection assertions across 5 describe blocks; pure `getTableConfig` + filesystem reads; no DB I/O.
- `src/infrastructure/db/migrations/0000_initial.sql` (created) — drizzle-kit emitted DDL payload, 132 lines including statement-breakpoint markers.
- `src/infrastructure/db/migrations/meta/_journal.json` (created) — canonical migration list, version "7", dialect "sqlite", single entry tagged 0000_initial.
- `src/infrastructure/db/migrations/meta/0000_snapshot.json` (created) — drizzle-kit diff base, ~22KB serialized snapshot.

## Verification Evidence

- `grep -c "sqliteTable(" src/infrastructure/db/schema.ts` → **9** (one per table; the import line is `sqliteTable` without `(` so it does not match)
- `grep -cE "^export const (cycles|recoveries|sleeps|workouts|daily_summaries|decisions|profile|body_measurements|sync_runs) " src/infrastructure/db/schema.ts` → **9**
- `grep -c "score_state_start_idx" src/infrastructure/db/schema.ts` → **5** (4 index sites + 1 in module doc comment) — meets `>= 4`
- `grep -c "raw_json" src/infrastructure/db/schema.ts` → **9** (6 column declarations + 3 doc-comment mentions) — meets `>= 6`
- `grep -c "baseline_excluded" src/infrastructure/db/schema.ts` → **3** (1 column declaration on cycles + 2 doc-comment mentions) — meets `>= 2`
- `grep -c "from 'drizzle-orm/sqlite-core'" src/infrastructure/db/schema.ts` → **1**
- `grep -cE "^export default" src/infrastructure/db/schema.ts` → **0** (no default exports per conventions.md)
- `grep -v '^\s*//' src/infrastructure/db/schema.ts | grep -v '^\s*\*' | grep -c "console\."` → **0**
- `grep -c "^CREATE TABLE" src/infrastructure/db/migrations/0000_initial.sql` → **9**
- `grep -c "^CREATE INDEX" src/infrastructure/db/migrations/0000_initial.sql` → **4** (cycles, sleeps, workouts on `(score_state, start)`; recoveries on `(score_state, created_at)` — wire shape has no `start`)
- `grep -cE '^(VACUUM|DELETE|UPDATE|INSERT)' src/infrastructure/db/migrations/0000_initial.sql` → **0** (DDL-only; confirms A10)
- `node -e "JSON.parse(...).entries[0].tag"` on `_journal.json` → **`0000_initial`**
- `node -e "JSON.parse(...)" 0000_snapshot.json` → parses without throw
- `npm run test -- src/infrastructure/db/schema.test.ts` → **14 / 14 passing** in 365ms
- `npm run test` (full suite) → **297 / 297 across 21 files** (283 baseline + 14 new) — suite under 60s budget at ~6s
- `npm run lint` → 0 errors across 52 files
- `bash scripts/ci-grep-gates.sh` → all 7 gates green (A, B, C, D, E, F, G — Gate G exercises the real drizzle-orm import in schema.ts for the first time)
- `git diff origin/main -- src/mcp/sanitize.ts src/mcp/register.ts` → empty (D-18 attestation preserved)

## Decisions Made

- **Drizzle 0.45.x array-return callback form, not the plan's verbatim object-return form.** The plan's Task 1 action block + 03-PATTERNS.md A2 + 03-RESEARCH.md Pattern 2 all quote the legacy syntax `(t) => ({byScoreStateStart: index('...').on(t.col1, t.col2)})`. Drizzle 0.36 deprecated this in favor of `(t) => [index('...').on(...)]`; the deprecation is enforced in drizzle-orm@0.45.2 via TS `@deprecated` JSDoc on the relevant SQLiteTableFn overload (verified in `node_modules/drizzle-orm/sqlite-core/table.d.ts`). Both forms compile and generate identical SQL — but the array form is the New API and avoids a deprecation warning at type-check time. Honoring the latest API while preserving the plan's contract (index names, covering columns) is the right tradeoff. Rule-1 plan-text correction; same precedent as the comment-phrasing corrections in Plans 02-01 / 02-02 / 02-04 / 02-06 / 03-01.
- **Recoveries indexes on `(score_state, created_at)`, not `(score_state, start)`.** The plan's Task 1 action block explicitly documents this exception ("recoveries has no `start` field on the wire; index on (score_state, created_at) to satisfy D-05's intent — created_at is the recovery timestamp"). The covering-index name `recoveries_score_state_start_idx` is retained — the name encodes the intent, the column choice encodes the wire reality.
- **`drizzle-kit generate --name initial` named the file `0000_initial.sql` directly.** The plan anticipated a `<idx>_<random>` default naming with a rename + journal-tag fix-up step. The actual behavior on drizzle-kit@0.31.10 is that `--name initial` is honored verbatim — no rename, no journal edit, no Rule-1 correction needed. Recorded for the Wave 2 Plan 03-05 migrator: the journal-file linkage is set deterministically by `--name` and does not need manual repair.
- **Schema-test introspection uses `getTableConfig` (live runtime types), not source-grep fallback.** Plan's Task 2 action block listed source-grep as a fallback "if introspection API is awkward." Drizzle 0.45.2's `getTableConfig` exposes everything needed (column.notNull, column.dataType, column.enumValues, indexes[].config.name, indexes[].config.columns) so the primary route works. Tests assert against the live types — strictly stronger than a string match.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 — Drizzle API deprecation] Plan body quoted the deprecated object-return callback form**

- **Found during:** Task 1 (writing schema.ts)
- **Issue:** The plan's Task 1 action block + 03-PATTERNS.md A2 + 03-RESEARCH.md Pattern 2 all quote `(t) => ({byScoreStateStart: index('...').on(t.col1, t.col2)})`. drizzle-orm@0.45.2 has marked this overload `@deprecated` in `node_modules/drizzle-orm/sqlite-core/table.d.ts` with explicit guidance to migrate to the array form. Compiling against the object form succeeds but emits a TS deprecation warning.
- **Fix:** Used the New API form `(t) => [index('...').on(...)]` for all 4 scored tables and `(t) => [primaryKey({columns: [...]}), index('...').on(...)]` for the recoveries compound-PK case. drizzle-kit generates identical SQL from either form (verified via the emitted `0000_initial.sql`).
- **Files modified:** src/infrastructure/db/schema.ts (only)
- **Verification:** `npm run test -- src/infrastructure/db/schema.test.ts` → 14/14 green; `grep -c "score_state_start_idx" src/infrastructure/db/schema.ts` → 5 (≥ 4); `npm run lint` → 0 errors (no deprecation warnings)
- **Committed in:** 9db8e04 (Task 1 commit)
- **Precedent:** Same Rule-1 pattern as Plan 02-04 (refresh orchestrator's TypeScript class identity / vi.resetModules issue) and Plan 02-01 paths.ts (doc-comment vs plan-grep collision). The plan body is descriptive of intent; the executable form may legitimately diverge when the pinned library version requires it.

### Deferred Items

None new. The 4th-occurrence doc-comment-phrasing-vs-plan-acceptance-grep collision (Plans 02-01, 02-02, 02-04, 02-06, 03-01) and the `npm audit` finding on `drizzle-kit@0.31.10`'s bundled `esbuild` chain are both deferred from Plan 03-01 and remain in scope for a future cleanup; this plan adds no new deferrals.

---

**Total deviations:** 1 auto-fixed (Rule 1 — plan-text drift vs library deprecation)
**Impact on plan:** No code-shape change, no scope creep, no contract drift. All 9 plan-level success-criteria pass.

## Issues Encountered

None beyond the one deviation documented above.

## User Setup Required

None — Wave 1A is pure code-and-generated-artifact landing (5 files, no external services, no DB writes, no MCP tool registrations). All gates ran cleanly without user input.

## Next Phase Readiness

- **Wave 1B (Plan 03-03 score-types)** can run: the schema.ts `score_state` enum literals `['SCORED', 'PENDING_SCORE', 'UNSCORABLE']` are declared verbatim; the discriminated union in `src/domain/types/score.ts` will narrow on this column.
- **Wave 2A (Plan 03-04 connection)** can run: schema.ts compiles cleanly so the future `infrastructure/db/connection.ts` can import the 9 table exports for typed query builders.
- **Wave 2B (Plan 03-05 migrate)** can run: `meta/_journal.json` is on disk with `entries[0].tag === '0000_initial'`; `0000_initial.sql` is DDL-only (A10 confirmed) so the hand-rolled migrator's `db.exec(sql)` invariant holds; `meta/0000_snapshot.json` is the drizzle-kit diff base for any future schema additions (Wave 3+).
- **Wave 3A+ (Plan 03-09 repositories)** can run: the 4 covering indexes on `(score_state, start)`-shape columns are available for Phase 4 baseline queries; the 6 raw_json columns are positioned for the Phase 4 `getRawJson(id)` boundary; cycles' `baseline_excluded` flag is in place for the Phase 4 baseline default WHERE filter.
- **AuthError + WhoopApiError unions** remain FROZEN at 6 kinds each; no errors.ts changes in this plan.
- **D-17 + D-18 attestation** extends: no new MCP tools, `sanitize.ts` and `register.ts` unmodified.

## Self-Check: PASSED

- Created files all present:
  - `src/infrastructure/db/schema.ts` — FOUND
  - `src/infrastructure/db/schema.test.ts` — FOUND
  - `src/infrastructure/db/migrations/0000_initial.sql` — FOUND
  - `src/infrastructure/db/migrations/meta/_journal.json` — FOUND
  - `src/infrastructure/db/migrations/meta/0000_snapshot.json` — FOUND
- Both task commits present in `git log --all`:
  - `9db8e04` — FOUND (feat: schema)
  - `a888dc3` — FOUND (feat: generate + tests)

---
*Phase: 03-data-model-db-layer-sync-loop*
*Completed: 2026-05-16*
