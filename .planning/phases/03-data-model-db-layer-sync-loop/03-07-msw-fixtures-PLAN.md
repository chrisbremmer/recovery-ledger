---
phase: 03-data-model-db-layer-sync-loop
plan: 07
type: execute
wave: 2
depends_on: ["03-01", "03-02", "03-03", "03-05"]
files_modified:
  - tests/helpers/msw-whoop-cycles.ts
  - tests/helpers/msw-whoop-recovery.ts
  - tests/helpers/msw-whoop-sleep.ts
  - tests/helpers/msw-whoop-workouts.ts
  - tests/helpers/msw-whoop-profile.ts
  - tests/helpers/msw-whoop-body-measurements.ts
  - tests/helpers/in-memory-db.ts
  - tests/fixtures/whoop/cycles/200-ok.json
  - tests/fixtures/whoop/cycles/200-paginated-page1.json
  - tests/fixtures/whoop/cycles/200-paginated-page2.json
  - tests/fixtures/whoop/cycles/200-dst-spring-forward.json
  - tests/fixtures/whoop/cycles/200-dst-fall-back.json
  - tests/fixtures/whoop/cycles/200-tz-trip-sfo-jfk.json
  - tests/fixtures/whoop/cycles/200-mixed-score-states.json
  - tests/fixtures/whoop/cycles/429-rate-limited.json
  - tests/fixtures/whoop/cycles/500-server-error.json
  - tests/fixtures/whoop/recovery/200-ok.json
  - tests/fixtures/whoop/recovery/200-mixed-score-states.json
  - tests/fixtures/whoop/sleep/200-ok.json
  - tests/fixtures/whoop/workouts/200-ok.json
  - tests/fixtures/whoop/profile/200-ok.json
  - tests/fixtures/whoop/body-measurements/200-ok.json
autonomous: true
requirements: [SYNC-07, DATA-06]
tags: [msw, fixtures, testing, dst, in-memory-db]
user_setup: []

must_haves:
  truths:
    - "6 MSW helpers under tests/helpers/msw-whoop-<resource>.ts mirror the Plan 02-01 msw-whoop-oauth.ts pattern exactly — each exports createWhoopXyzHelper() returning {server, getHitCount, resetHitCount, setNextResponse}"
    - "Per-helper default response includes WHOOP-realistic headers: X-RateLimit-Remaining=95, X-RateLimit-Reset=60, X-RateLimit-Limit='requests=100, window=60' (per A5 verified)"
    - "Fixtures committed under tests/fixtures/whoop/<resource>/<scenario>.json — snake_case payload matching WHOOP v2 wire format"
    - "DST/tz fixtures committed: cycles/200-dst-spring-forward.json (Mar 2026 2nd Sunday 02:00→03:00 America/Los_Angeles), cycles/200-dst-fall-back.json (Nov 2026 1st Sunday 02:00→01:00 America/Los_Angeles), cycles/200-tz-trip-sfo-jfk.json (offsets -08 → -05 → -05) per D-15"
    - "tests/helpers/in-memory-db.ts exports createInMemoryDb() that returns {db, sqlite} after running the real migrator on the committed migrations"
    - "tests/helpers/in-memory-db.ts imports `drizzle` from '../../src/infrastructure/db/connection.js' (Plan 03-05 canonical re-export) — NEVER from 'drizzle-orm/better-sqlite3' directly (Gate G strict)"
    - "MSW helpers use http.get (D-21 GET-only) NOT http.post"
    - "ADR-0006 preserved: fixture-only, zero live WHOOP calls"
    - "No console.* / process.stdout.write in any helper or fixture (Gate B exempts .json files; helpers are .ts under tests/ which Gate B already exempts)"
  artifacts:
    - path: "tests/helpers/msw-whoop-cycles.ts"
      provides: "createWhoopCyclesHelper() — handler at https://api.prod.whoop.com/v2/cycle"
      contains: "createWhoopCyclesHelper"
    - path: "tests/helpers/in-memory-db.ts"
      provides: "createInMemoryDb() — better-sqlite3 :memory: + Plan 03-05 migrator applied; imports drizzle via connection.ts re-export"
      contains: "createInMemoryDb"
    - path: "tests/fixtures/whoop/cycles/200-dst-spring-forward.json"
      provides: "Cycle straddling Mar 2026 DST boundary (D-15)"
      contains: "2026-03-08"
    - path: "tests/fixtures/whoop/cycles/200-tz-trip-sfo-jfk.json"
      provides: "Three consecutive cycles with offset shift (D-15 tz_drift)"
      contains: "timezone_offset"
  key_links:
    - from: "tests/helpers/msw-whoop-<resource>.ts"
      to: "tests/fixtures/whoop/<resource>/<scenario>.json"
      via: "readFileSync (lazy per-request)"
      pattern: "readFixture"
    - from: "tests/helpers/in-memory-db.ts"
      to: "src/infrastructure/db/migrate.ts"
      via: "migrate(sqlite, opts) — Plan 03-05 contract"
      pattern: "migrate\\("
    - from: "tests/helpers/in-memory-db.ts"
      to: "src/infrastructure/db/connection.ts (Plan 03-05 drizzle re-export)"
      via: "import { drizzle } from '../../src/infrastructure/db/connection.js'"
      pattern: "from '../../src/infrastructure/db/connection"
---

<objective>
Land all per-resource MSW helpers + the load-bearing DST/tz fixtures (D-15) + the in-memory-db helper that powers contract + integration tests. Mirror the Plan 02-01 `msw-whoop-oauth.ts` shape so every test file shares a single mental model for WHOOP HTTP fakes.

Purpose: Plans 03-09 (resource modules) + 03-10 (contract tests) + 03-11 (sync integration tests) all consume these helpers. DST/tz fixtures must be committed before Plan 03-09 ships the per-resource modules because the cycle module's DST detector needs them. The in-memory-db helper means contract tests can load fixtures + intercept HTTP + write to a real DB without touching disk.

This plan depends on Plan 03-05 because the in-memory-db helper imports `drizzle` from `src/infrastructure/db/connection.ts` (the canonical re-export added in 03-05 Task 1). Gate G stays strict — the helper does NOT import from `'drizzle-orm/better-sqlite3'` directly.

Output: 7 .ts test helpers + at least 15 fixture .json files + 0 source changes.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/PROJECT.md
@.planning/phases/03-data-model-db-layer-sync-loop/03-CONTEXT.md
@.planning/phases/03-data-model-db-layer-sync-loop/03-RESEARCH.md
@.planning/phases/03-data-model-db-layer-sync-loop/03-PATTERNS.md
@agent_docs/decisions/0006-fixture-only-tests.md
@agent_docs/conventions.md
@tests/helpers/msw-whoop-oauth.ts
@tests/fixtures/oauth/token-200.json
@src/infrastructure/db/migrate.ts
@src/infrastructure/db/connection.ts
@src/domain/schemas/whoop-api.ts

<interfaces>
<!-- One helper per WHOOP resource (D-23 + Pattern 10) — mirror msw-whoop-oauth.ts shape -->

  export interface WhoopCyclesHelper {
    server: SetupServer;
    getHitCount(): number;
    resetHitCount(): void;
    setNextResponse(body: unknown, status?: number, headers?: Record<string, string>): void;
  }
  export function createWhoopCyclesHelper(): WhoopCyclesHelper;

  // Same shape for recovery, sleep, workouts, profile, body-measurements

<!-- In-memory DB helper -->

  export interface InMemoryDbResult {
    db: ReturnType<typeof drizzle>;
    sqlite: Database.Database;
    close(): void;
  }
  export function createInMemoryDb(): InMemoryDbResult;

  // Import surface — load-bearing for Gate G:
  //   import Database from 'better-sqlite3';
  //   import { drizzle } from '../../src/infrastructure/db/connection.js';  // Plan 03-05 re-export
  //   import { migrate } from '../../src/infrastructure/db/migrate.js';
</interfaces>
</context>

<tasks>

<task type="auto">
  <name>Task 1: Commit DST + tz + score-state + paginated + 429 + 500 fixtures (cycles + 5 sibling resources)</name>
  <files>tests/fixtures/whoop/cycles/200-ok.json, tests/fixtures/whoop/cycles/200-paginated-page1.json, tests/fixtures/whoop/cycles/200-paginated-page2.json, tests/fixtures/whoop/cycles/200-dst-spring-forward.json, tests/fixtures/whoop/cycles/200-dst-fall-back.json, tests/fixtures/whoop/cycles/200-tz-trip-sfo-jfk.json, tests/fixtures/whoop/cycles/200-mixed-score-states.json, tests/fixtures/whoop/cycles/429-rate-limited.json, tests/fixtures/whoop/cycles/500-server-error.json, tests/fixtures/whoop/recovery/200-ok.json, tests/fixtures/whoop/recovery/200-mixed-score-states.json, tests/fixtures/whoop/sleep/200-ok.json, tests/fixtures/whoop/workouts/200-ok.json, tests/fixtures/whoop/profile/200-ok.json, tests/fixtures/whoop/body-measurements/200-ok.json</files>
  <read_first>
    - .planning/phases/03-data-model-db-layer-sync-loop/03-CONTEXT.md decisions D-15 (DST fixture names + dates), D-19 (next_token paging shape), D-22 (WhoopApiError kinds for 429 + 5xx)
    - .planning/phases/03-data-model-db-layer-sync-loop/03-RESEARCH.md §Pattern 10 + §Technical Research item 4 (snake_case wire format; next_token snake; nextToken request camel)
    - .planning/phases/03-data-model-db-layer-sync-loop/03-RESEARCH.md §Sources lines 1218-1225 (per-resource doc citations for verified field shapes)
    - .planning/phases/03-data-model-db-layer-sync-loop/03-PATTERNS.md §G — fixtures committed as JSON; oauth fixture precedent at tests/fixtures/oauth/token-200.json
    - src/domain/schemas/whoop-api.ts (Plan 03-03 — fixtures MUST parse cleanly through these Zod schemas)
    - tests/fixtures/oauth/token-200.json (Phase 2 fixture shape precedent)
  </read_first>
  <action>
    Create all fixture .json files under `tests/fixtures/whoop/<resource>/<scenario>.json`. Each is a JSON document matching the WHOOP v2 wire format (snake_case, exact field types per A6 + verified docs).

    **cycles/200-ok.json** — single page, single SCORED cycle:
    ```json
    {
      "records": [
        {
          "id": 12345678,
          "user_id": 100001,
          "created_at": "2026-05-10T08:00:00.000Z",
          "updated_at": "2026-05-10T20:00:00.000Z",
          "start": "2026-05-10T07:00:00.000Z",
          "end": "2026-05-11T07:00:00.000Z",
          "timezone_offset": "-08:00",
          "score_state": "SCORED",
          "score": {"strain": 12.5, "kilojoule": 8420.3, "average_heart_rate": 68, "max_heart_rate": 178}
        }
      ],
      "next_token": null
    }
    ```
    Fixture must match WhoopRawCycle / WhoopCyclesPageSchema in Plan 03-03. Note the nested `score` object — the Zod schema flattens or accesses via `.score.strain` etc. Verify against the schema before committing (Plan 03-09 normalizer maps `score.strain` → `strain` field on the Cycle entity).

    **cycles/200-paginated-page1.json** — page 1 of 2; `next_token: 'abc123'`, 3 records with unique IDs.
    **cycles/200-paginated-page2.json** — page 2; `next_token: null`, 2 records, IDs disjoint from page 1.

    **cycles/200-dst-spring-forward.json** — Per D-15: cycle straddling Mar 2026 2nd Sunday (March 8, 2026) 02:00 → 03:00 in America/Los_Angeles:
      - start: `2026-03-07T15:00:00.000Z` (= 07:00 PST -08:00)
      - end: `2026-03-08T15:00:00.000Z` (= 08:00 PDT -07:00; same wall-clock different offset due to DST)
      - timezone_offset: `-08:00` (the START offset)
      - score_state: 'SCORED'; user_id consistent.
      - Single record; next_token null.
      - The `dst_straddle` detection rule (Plan 03-09 DST detector) will flag this because `tzOffset('America/Los_Angeles', start)` returns -480 (-08:00) and `tzOffset(zone, end)` returns -420 (-07:00) — they differ.

    **cycles/200-dst-fall-back.json** — Per D-15: cycle straddling Nov 2026 1st Sunday (November 1, 2026) 02:00 → 01:00 in America/Los_Angeles:
      - start: `2026-10-31T15:00:00.000Z` (= 08:00 PDT -07:00)
      - end: `2026-11-01T15:00:00.000Z` (= 07:00 PST -08:00; same wall-clock different offset)
      - timezone_offset: `-07:00` (start offset)
      - score_state: 'SCORED'.

    **cycles/200-tz-trip-sfo-jfk.json** — Per D-15: three consecutive cycles with offsets `-08:00 → -05:00 → -05:00`:
      - Cycle A: id=2001, timezone_offset='-08:00', start '2026-04-01T07:00:00.000Z', end '2026-04-02T07:00:00.000Z', score_state SCORED, score{strain:8.0,...}
      - Cycle B: id=2002, timezone_offset='-05:00' (after flying SFO→JFK), start '2026-04-02T13:00:00.000Z', end '2026-04-03T13:00:00.000Z', score_state SCORED. The DST detector's `tz_drift` rule flags this — offset differs from prior cycle A.
      - Cycle C: id=2003, timezone_offset='-05:00' (settled in JFK), start '2026-04-03T13:00:00.000Z', end '2026-04-04T13:00:00.000Z', score_state SCORED. Offset matches B → NOT flagged.
      - records ordered by start ascending; next_token null.

    **cycles/200-mixed-score-states.json** — single page, 3 records: one SCORED, one PENDING_SCORE (no `score` object), one UNSCORABLE (no `score` object). Locks Pitfall 3 + ADR-0003 default-filter test.

    **cycles/429-rate-limited.json** — error body shape from WHOOP (minimal; status code is what matters; headers go on the response):
    ```json
    {"error": "rate_limit_exceeded", "message": "Too Many Requests"}
    ```
    The MSW helper's `setNextResponse(body, 429, {'X-RateLimit-Reset': '3'})` injects the headers separately.

    **cycles/500-server-error.json** — `{"error": "internal_server_error"}`.

    **recovery/200-ok.json** — single SCORED recovery keyed by (cycle_id 12345678, sleep_id 'sl-uuid-1'):
    ```json
    {
      "records": [
        {
          "cycle_id": 12345678,
          "sleep_id": "11111111-1111-1111-1111-111111111111",
          "user_id": 100001,
          "created_at": "2026-05-10T08:30:00.000Z",
          "updated_at": "2026-05-10T20:30:00.000Z",
          "score_state": "SCORED",
          "score": {
            "recovery_score": 73,
            "resting_heart_rate": 56,
            "hrv_rmssd_milli": 42.5,
            "spo2_percentage": 96.8,
            "skin_temp_celsius": 33.2,
            "user_calibrating": false
          }
        }
      ],
      "next_token": null
    }
    ```
    **recovery/200-mixed-score-states.json** — 3 records (SCORED + PENDING_SCORE + UNSCORABLE) — Pitfall G verification anchor per 03-RESEARCH.md.

    **sleep/200-ok.json** — single SCORED sleep with UUID id (A6):
    ```json
    {
      "records": [
        {
          "id": "22222222-2222-2222-2222-222222222222",
          "user_id": 100001,
          "created_at": "2026-05-10T05:00:00.000Z",
          "updated_at": "2026-05-10T15:00:00.000Z",
          "start": "2026-05-10T05:00:00.000Z",
          "end": "2026-05-10T13:00:00.000Z",
          "timezone_offset": "-08:00",
          "nap": false,
          "score_state": "SCORED",
          "score": {
            "total_in_bed_time_milli": 28800000,
            "total_awake_time_milli": 1800000,
            "sleep_performance_percentage": 88.5,
            "sleep_consistency_percentage": 76.0,
            "sleep_efficiency_percentage": 93.7,
            "respiratory_rate": 14.8
          }
        }
      ],
      "next_token": null
    }
    ```

    **workouts/200-ok.json** — single SCORED workout with UUID id:
    ```json
    {
      "records": [
        {
          "id": "33333333-3333-3333-3333-333333333333",
          "user_id": 100001,
          "created_at": "2026-05-10T18:00:00.000Z",
          "updated_at": "2026-05-10T19:30:00.000Z",
          "start": "2026-05-10T17:30:00.000Z",
          "end": "2026-05-10T18:30:00.000Z",
          "timezone_offset": "-08:00",
          "sport_id": 0,
          "score_state": "SCORED",
          "score": {
            "strain": 12.8,
            "average_heart_rate": 142,
            "max_heart_rate": 178,
            "kilojoule": 1450.2,
            "distance_meter": 8400.0,
            "altitude_gain_meter": 42.0,
            "altitude_change_meter": 12.0
          }
        }
      ],
      "next_token": null
    }
    ```

    **profile/200-ok.json** — single record (NOT wrapped in {records, next_token}; profile endpoint returns the record directly per A4):
    ```json
    {
      "user_id": 100001,
      "email": "chris@example.com",
      "first_name": "Chris",
      "last_name": "Bremmer"
    }
    ```

    **body-measurements/200-ok.json** — single record (single-shot per A4):
    ```json
    {
      "user_id": 100001,
      "height_meter": 1.78,
      "weight_kilogram": 78.5,
      "max_heart_rate": 188
    }
    ```

    All fixtures use the WHOOP v2 snake_case wire format verbatim. Field types per A6: cycle id integer; sleep/workout ids UUID strings; recoveries compound (cycle_id integer + sleep_id UUID).

    **Schema-parse smoke-check**: After writing each fixture, manually verify it parses against the Plan 03-03 raw schemas. The actual test that exercises this is in Plan 03-10 contract tests, but a node REPL one-liner here saves the executor a Plan 03-10 cycle:
    ```bash
    node -e "const {WhoopCyclesPageSchema} = await import('./src/domain/schemas/whoop-api.js'); const fixture = JSON.parse(require('fs').readFileSync('tests/fixtures/whoop/cycles/200-ok.json', 'utf8')); console.log(WhoopCyclesPageSchema.safeParse(fixture).success ? 'OK' : WhoopCyclesPageSchema.safeParse(fixture).error.format());"
    ```
    Each fixture: success=true.
  </action>
  <verify>
    <automated>find tests/fixtures/whoop/ -name '*.json' | wc -l</automated>
  </verify>
  <acceptance_criteria>
    - `find tests/fixtures/whoop/ -name '*.json' | wc -l` returns at least 15 (9 cycles + 2 recovery + 1 sleep + 1 workouts + 1 profile + 1 body-measurements = 15)
    - `tests/fixtures/whoop/cycles/200-dst-spring-forward.json` exists and parses as valid JSON — `node -e "JSON.parse(require('fs').readFileSync('tests/fixtures/whoop/cycles/200-dst-spring-forward.json', 'utf8'))"` exits 0
    - `tests/fixtures/whoop/cycles/200-dst-fall-back.json` exists and parses
    - `tests/fixtures/whoop/cycles/200-tz-trip-sfo-jfk.json` exists, parses, and contains exactly 3 records with timezone_offset values `-08:00`, `-05:00`, `-05:00` in order — `node -e "const j = JSON.parse(require('fs').readFileSync('tests/fixtures/whoop/cycles/200-tz-trip-sfo-jfk.json', 'utf8')); console.log(j.records.map(r => r.timezone_offset).join(','))"` prints `-08:00,-05:00,-05:00`
    - `tests/fixtures/whoop/cycles/200-mixed-score-states.json` contains exactly one record with `score_state === 'SCORED'`, one with `'PENDING_SCORE'`, one with `'UNSCORABLE'`
    - `tests/fixtures/whoop/recovery/200-ok.json` contains a record with `cycle_id` as integer AND `sleep_id` as UUID string (A6 + A12)
    - `tests/fixtures/whoop/sleep/200-ok.json` contains `id` as a UUID string
    - Every paginated-resource fixture has `records` array + `next_token` field at top level (Plan 03-03 page-wrapper schema)
    - Each fixture parses against its Plan 03-03 Zod schema (manually verified with one-liner)
    - `bash scripts/ci-grep-gates.sh` exits 0 (fixture JSON files are exempted by --include='*.ts' filter in the gates)
  </acceptance_criteria>
  <done>15+ committed fixtures covering happy path + DST/tz + mixed-score-state + paginated + 429/500; all parse against the Plan 03-03 raw schemas.</done>
</task>

<task type="auto">
  <name>Task 2: Write 6 MSW helpers + in-memory-db helper + helper-shape unit tests</name>
  <files>tests/helpers/msw-whoop-cycles.ts, tests/helpers/msw-whoop-recovery.ts, tests/helpers/msw-whoop-sleep.ts, tests/helpers/msw-whoop-workouts.ts, tests/helpers/msw-whoop-profile.ts, tests/helpers/msw-whoop-body-measurements.ts, tests/helpers/in-memory-db.ts</files>
  <read_first>
    - tests/helpers/msw-whoop-oauth.ts (full — verbatim shape to mirror; especially {server, getHitCount, resetHitCount, setNextResponse, getLastRequestBody})
    - .planning/phases/03-data-model-db-layer-sync-loop/03-PATTERNS.md §G1 lines 1232-1335 (per-resource helper code), §G2 lines 1346-1372 (in-memory DB helper)
    - .planning/phases/03-data-model-db-layer-sync-loop/03-RESEARCH.md §Pattern 10 + §Technical Research item 8 (MSW v2 + per-resource shape + default headers)
    - .planning/phases/03-data-model-db-layer-sync-loop/03-CONTEXT.md decisions D-19 (per-resource pagination paths), D-21 (WHOOP_API_BASE; GET-only)
    - src/infrastructure/whoop/client.ts (Plan 03-06 — WHOOP_API_BASE constant)
    - src/infrastructure/db/connection.ts (Plan 03-05 — openDb returns {db, sqlite}; :memory: handles WAL fallback; canonical `drizzle` re-export — load-bearing for in-memory-db.ts imports below)
    - src/infrastructure/db/migrate.ts (Plan 03-05 — migrate(sqlite, opts) signature; opts include migrationsDir)
    - tests/fixtures/whoop/cycles/200-ok.json (Task 1 — the default response body for the cycles helper)
    - agent_docs/conventions.md §Testing (one MSW handler file per resource)
  </read_first>
  <action>
    Create the 6 MSW helpers. Each mirrors `tests/helpers/msw-whoop-oauth.ts` exactly. Use TypeScript with named exports (no defaults).

    **tests/helpers/msw-whoop-cycles.ts** — full template; other 5 resources adapt by changing the endpoint + default fixture path:

    Imports:
    ```typescript
    import { readFileSync } from 'node:fs';
    import { join } from 'node:path';
    import { type HttpHandler, HttpResponse, http } from 'msw';
    import { type SetupServer, setupServer } from 'msw/node';
    ```

    Constants at top:
    ```typescript
    const CYCLES_URL = 'https://api.prod.whoop.com/v2/cycle';
    const DEFAULT_FIXTURE = join(process.cwd(), 'tests', 'fixtures', 'whoop', 'cycles', '200-ok.json');
    const DEFAULT_HEADERS = {
      'X-RateLimit-Remaining': '95',
      'X-RateLimit-Reset': '60',
      'X-RateLimit-Limit': 'requests=100, window=60',
    };
    ```

    Interface:
    ```typescript
    export interface WhoopCyclesHelper {
      server: SetupServer;
      getHitCount(): number;
      resetHitCount(): void;
      setNextResponse(body: unknown, status?: number, headers?: Record<string, string>): void;
      getLastRequestUrl(): URL | null;
    }
    ```

    Factory function:
    ```typescript
    export function createWhoopCyclesHelper(): WhoopCyclesHelper {
      let hitCount = 0;
      let nextResponse: { body: unknown; status: number; headers?: Record<string, string> } | null = null;
      let lastRequestUrl: URL | null = null;

      const handler: HttpHandler = http.get(CYCLES_URL, ({ request }) => {
        hitCount += 1;
        lastRequestUrl = new URL(request.url);
        if (nextResponse !== null) {
          const r = nextResponse;
          nextResponse = null;
          return HttpResponse.json(r.body, { status: r.status, headers: { ...DEFAULT_HEADERS, ...(r.headers ?? {}) } });
        }
        // Default response: load the per-test scenario fixture if __test_scenario query is set, else default.
        const scenarioParam = lastRequestUrl.searchParams.get('__test_scenario');
        const fixturePath = scenarioParam
          ? join(process.cwd(), 'tests', 'fixtures', 'whoop', 'cycles', scenarioParam + '.json')
          : DEFAULT_FIXTURE;
        const raw = readFileSync(fixturePath, 'utf8');
        const parsed = JSON.parse(raw) as unknown;
        return HttpResponse.json(parsed, { headers: DEFAULT_HEADERS });
      });

      const server = setupServer(handler);

      return {
        server,
        getHitCount: () => hitCount,
        resetHitCount: () => { hitCount = 0; lastRequestUrl = null; },
        setNextResponse: (body, status = 200, headers) => { nextResponse = { body, status, headers }; },
        getLastRequestUrl: () => lastRequestUrl,
      };
    }
    ```

    Adapt for the other 5 resources:
      - **msw-whoop-recovery.ts** — URL: `'https://api.prod.whoop.com/v2/recovery'`; default fixture path: `tests/fixtures/whoop/recovery/200-ok.json`.
      - **msw-whoop-sleep.ts** — URL: `'https://api.prod.whoop.com/v2/activity/sleep'` (per verified WHOOP v2 path).
      - **msw-whoop-workouts.ts** — URL: `'https://api.prod.whoop.com/v2/activity/workout'`.
      - **msw-whoop-profile.ts** — URL: `'https://api.prod.whoop.com/v2/user/profile/basic'`.
      - **msw-whoop-body-measurements.ts** — URL: `'https://api.prod.whoop.com/v2/user/measurement/body'`.

    All 6 helpers: NO default exports. All use http.get (GET-only per D-21 + ADR-0007). All read fixtures lazily per-request (file change detection — tests can edit fixtures without restarting MSW).

    **tests/helpers/in-memory-db.ts** — Per Pattern G2. **IMPORTANT — Gate G discipline (locked):**

    `drizzle` is imported via Plan 03-05's canonical re-export from `src/infrastructure/db/connection.ts`. This file MUST NOT contain `from 'drizzle-orm/better-sqlite3'` — that would violate Gate G (which forbids `from 'drizzle-orm'` outside `src/infrastructure/db/`).

    ```typescript
    import { fileURLToPath } from 'node:url';
    import { dirname, join, resolve } from 'node:path';
    import Database from 'better-sqlite3';
    // Plan 03-05 canonical re-export — Gate G stays strict.
    import { drizzle } from '../../src/infrastructure/db/connection.js';
    import { migrate } from '../../src/infrastructure/db/migrate.js';

    const HERE = dirname(fileURLToPath(import.meta.url));
    const MIGRATIONS_DIR = resolve(HERE, '..', '..', 'src', 'infrastructure', 'db', 'migrations');

    export interface InMemoryDbResult {
      db: ReturnType<typeof drizzle>;
      sqlite: Database.Database;
      close(): void;
    }

    export function createInMemoryDb(): InMemoryDbResult {
      const sqlite = new Database(':memory:');
      // Production pragmas (D-30) minus WAL (memory DBs don't support WAL).
      sqlite.pragma('busy_timeout = 5000');
      sqlite.pragma('foreign_keys = ON');
      migrate(sqlite, {
        migrationsDir: MIGRATIONS_DIR,
        backupsDir: '/tmp/in-memory-db-no-backup',  // never written for :memory:
        dbFile: ':memory:',  // migrate() short-circuits backup for :memory: per Plan 03-05 contract
      });
      return {
        db: drizzle(sqlite),
        sqlite,
        close: () => { try { sqlite.close(); } catch { /* */ } },
      };
    }
    ```

    The Plan 03-05 connection.ts re-export (`export { drizzle } from 'drizzle-orm/better-sqlite3'`) lands BEFORE this plan runs (depends_on lists 03-05), so the import resolves cleanly. The re-export is the single canonical drizzle import surface outside `src/infrastructure/db/`.
  </action>
  <verify>
    <automated>npm run test -- --reporter=basic 2>&1 | grep -E "(PASS|FAIL)" | head -20 ; bash scripts/ci-grep-gates.sh</automated>
  </verify>
  <acceptance_criteria>
    - `ls tests/helpers/msw-whoop-*.ts | wc -l` returns at least 7 (6 new + 1 existing oauth)
    - Each new helper exports `createWhoopXyzHelper` — verify with `grep -lc 'export function createWhoop' tests/helpers/msw-whoop-{cycles,recovery,sleep,workouts,profile,body-measurements}.ts`
    - All 6 helpers use `http.get` (not `http.post`) — `grep -c 'http\.get' tests/helpers/msw-whoop-cycles.ts tests/helpers/msw-whoop-recovery.ts tests/helpers/msw-whoop-sleep.ts tests/helpers/msw-whoop-workouts.ts tests/helpers/msw-whoop-profile.ts tests/helpers/msw-whoop-body-measurements.ts` returns at least 6 total (one per file)
    - `tests/helpers/in-memory-db.ts` exists; exports `createInMemoryDb`; imports `drizzle` from `'../../src/infrastructure/db/connection.js'` (Plan 03-05 canonical re-export) — NOT directly from `'drizzle-orm/better-sqlite3'`
    - `grep -c "from 'drizzle-orm" tests/helpers/in-memory-db.ts` returns 0 (Gate G discipline locked — helper imports through connection.ts re-export)
    - `grep -c "from '../../src/infrastructure/db/connection" tests/helpers/in-memory-db.ts` returns at least 1 (canonical re-export consumed)
    - Gate G stays green (no `from 'drizzle-orm'` outside src/infrastructure/db/): `grep -rEn "from ['\"]drizzle-orm" tests/ src/ | grep -Ev "^src/infrastructure/db/" | grep -Ev "\.test\.ts:"` returns 0 lines
    - `bash scripts/ci-grep-gates.sh` exits 0
    - `npm run test` runs the full suite green (no new tests written here, but the helpers are syntactically valid and importable) — count stays ≥ baseline
    - Each helper's URL matches the verified WHOOP v2 path per A4 / A3: `grep "api.prod.whoop.com/v2/cycle" tests/helpers/msw-whoop-cycles.ts`, `.../v2/recovery` for recovery, `.../v2/activity/sleep` for sleep, `.../v2/activity/workout` for workouts, `.../v2/user/profile/basic` for profile, `.../v2/user/measurement/body` for body-measurements
  </acceptance_criteria>
  <done>6 MSW helpers + in-memory-db helper landed; verbatim mirror of msw-whoop-oauth.ts shape; default WHOOP-realistic headers; Gate G preserved — in-memory-db.ts imports drizzle through Plan 03-05's connection.ts canonical re-export.</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| Test code → MSW handler interception | Pure test infrastructure; no production code path |
| Fixture JSON files → Zod schema parse in Plan 03-09 | Fixtures must match the verified WHOOP v2 wire format or contract tests fail at parse time |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-03.07-01 | Tampering | A test file forgets to call `server.close()` and leaks across tests | mitigate | Per-test helper instance creates its own SetupServer; vitest pool='forks' isolates state between worker processes; conventions.md §Testing (each test file owns lifecycle). |
| T-03.07-02 | Tampering | Fixture JSON contains a token-shaped string that leaks via sanitize.ts → mock-data-misinterpreted-as-real-secret | accept | Fixtures use intentionally fake values (cycle id 12345678, user_id 100001, UUIDs '11111111-...'); sanitize.ts is for real-token redaction at runtime, fixtures are at-rest test inputs. |
| T-03.07-03 | Information disclosure | In-memory-db helper reads real migrations directory | accept | Plan 03-02 migrations are public artifacts; no secrets. |
| T-03.07-04 | Tampering | Gate G regression: someone imports drizzle-orm directly from tests/helpers/in-memory-db.ts | mitigate | The canonical re-export (Plan 03-05 owns it; this plan's depends_on locks the ordering) is the single drizzle import surface outside src/infrastructure/db/. Acceptance criterion `grep -c "from 'drizzle-orm" tests/helpers/in-memory-db.ts === 0` catches drift at PR time. |
</threat_model>

<verification>
- `find tests/fixtures/whoop/ -name '*.json' | wc -l` → ≥ 15
- `ls tests/helpers/msw-whoop-*.ts` → 7 files including the existing oauth helper
- `bash scripts/ci-grep-gates.sh` → all 7 gates green
- `npm run test` → no regressions
- `npm run lint` → 0 errors
- Each helper passes a smoke import test (`node --input-type=module -e "await import('./tests/helpers/msw-whoop-cycles.ts')"` is a tsx/vitest concern; just ensure tsc passes)
- `npx tsc --noEmit` → 0 errors
- `grep -c "from 'drizzle-orm" tests/helpers/in-memory-db.ts` → 0 (Gate G discipline; drizzle comes via Plan 03-05 connection.ts re-export)
</verification>

<success_criteria>
- 15+ fixtures committed under tests/fixtures/whoop/ — happy path + DST spring/fall + tz trip + mixed-score-state + paginated + 429 + 500
- DST/tz fixtures (D-15) committed for Plan 03-09 DST detector contract tests
- 6 per-resource MSW helpers + 1 in-memory-db helper; all mirror Plan 02-01 msw-whoop-oauth.ts shape
- All helpers use http.get (D-21 / ADR-0007)
- All fixtures parse against Plan 03-03 raw Zod schemas
- Gate G preserved — in-memory-db.ts imports `drizzle` via Plan 03-05's canonical connection.ts re-export; no direct `from 'drizzle-orm/better-sqlite3'` in tests/helpers/
- ADR-0006 satisfied: zero live WHOOP calls
</success_criteria>

<output>
Create `.planning/phases/03-data-model-db-layer-sync-loop/03-07-SUMMARY.md` when done.
</output>
