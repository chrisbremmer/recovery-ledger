---
phase: 03-data-model-db-layer-sync-loop
plan: 09
type: execute
wave: 3
depends_on: ["03-03", "03-06", "03-07"]
files_modified:
  - src/infrastructure/whoop/resources/cycles.ts
  - src/infrastructure/whoop/resources/recovery.ts
  - src/infrastructure/whoop/resources/sleep.ts
  - src/infrastructure/whoop/resources/workouts.ts
  - src/infrastructure/whoop/resources/profile.ts
  - src/infrastructure/whoop/resources/body-measurements.ts
  - src/domain/normalize/cycles.ts
  - src/domain/normalize/recovery.ts
  - src/domain/normalize/sleep.ts
  - src/domain/normalize/workouts.ts
  - src/domain/normalize/profile.ts
  - src/domain/normalize/body-measurements.ts
  - src/domain/normalize/cycles.test.ts
  - src/domain/normalize/recovery.test.ts
  - src/domain/normalize/sleep.test.ts
  - src/domain/normalize/workouts.test.ts
  - src/domain/dst-tz/detect.ts
  - src/domain/dst-tz/detect.test.ts
autonomous: true
requirements: [SYNC-01, SYNC-02, SYNC-04, DATA-05, DATA-06]
tags: [whoop, resources, normalize, dst, pure-function, date-fns]
user_setup: []

must_haves:
  truths:
    - "6 resource modules under src/infrastructure/whoop/resources/ — cycles, recovery, sleep, workouts (paginated), profile, body-measurements (single-shot)"
    - "Each list-endpoint resource pins PAGE_SIZE = 25 at the top of the module per A3 / D-19"
    - "Each resource module imports ONLY httpGet from ../client.js (NOT callWithAuth directly per D-18)"
    - "List endpoints paginate via paginateAll<RawT> + map(normalizeX) per Pattern 7"
    - "List endpoints query params: start, end, limit, nextToken (camelCase request param per A4 + verified docs; D-19); NO updated_since per A1 / Technical Research item 1"
    - "Profile + body-measurements use single httpGet call; no pagination; no since/until params per A4"
    - "Normalizers in src/domain/normalize/ are PURE functions: raw (snake_case Zod-validated) → entity (camelCase, score-state narrowed)"
    - "src/domain/dst-tz/detect.ts exports detectExclusion({ianaZone, cycle, priorCycle}) — pure function per D-13 / Pattern 5"
    - "detectExclusion uses tzOffset() from @date-fns/tz; resolved IANA zone passed in (not read from Intl inside the function — keeps it pure)"
    - "Two detection rules OR'd (D-13): dst_straddle (tzOffset(zone, start) !== tzOffset(zone, end)) + tz_drift (cycle.timezone_offset !== priorCycle.timezone_offset)"
    - "Recovery resource module calls Plan 03-06 paginateAll with explicit compound-key keyFn: `paginateAll(fetcher, (row) => row.cycle_id + ':' + row.sleep_id)` — does NOT mutate pagination.ts (Plan 03-06 already exposes the optional keyFn parameter)"
    - "Per-score-state branch coverage: sleep.test.ts + workouts.test.ts each cover 3 score-state branches (SCORED + PENDING_SCORE + UNSCORABLE) per checker Warning #9; cycles.test.ts + recovery.test.ts already cover their 3 branches"
    - "Gate G stays green: no drizzle-orm in src/infrastructure/whoop/resources/ or src/domain/"
    - "Gate F stays green: resource modules don't call fetch( directly — only httpGet (which is in client.ts, the third allowlisted file)"
  artifacts:
    - path: "src/infrastructure/whoop/resources/cycles.ts"
      provides: "listCycles({since, until}) — paginated through httpGet + paginateAll + normalizeCycle"
      contains: "PAGE_SIZE = 25"
    - path: "src/infrastructure/whoop/resources/recovery.ts"
      provides: "listRecovery({since, until}) — paginated through httpGet + paginateAll (compound-key keyFn) + normalizeRecovery"
      contains: "row.cycle_id"
    - path: "src/domain/dst-tz/detect.ts"
      provides: "detectExclusion — pure function with 2 OR'd rules per D-13"
      contains: "dst_straddle"
    - path: "src/domain/normalize/cycles.ts"
      provides: "normalizeCycle(raw): Cycle — raw snake_case → camelCase domain entity with DU narrowing"
      contains: "normalizeCycle"
    - path: "src/domain/normalize/sleep.test.ts"
      provides: "Per-score-state branch coverage for normalizeSleep (SCORED / PENDING_SCORE / UNSCORABLE)"
      contains: "PENDING_SCORE"
    - path: "src/domain/normalize/workouts.test.ts"
      provides: "Per-score-state branch coverage for normalizeWorkout (SCORED / PENDING_SCORE / UNSCORABLE)"
      contains: "PENDING_SCORE"
  key_links:
    - from: "src/infrastructure/whoop/resources/cycles.ts"
      to: "src/infrastructure/whoop/client.ts httpGet"
      via: "named import"
      pattern: "from '../client"
    - from: "src/infrastructure/whoop/resources/cycles.ts"
      to: "src/domain/schemas/whoop-api.ts WhoopCyclesPageSchema"
      via: "named import"
      pattern: "from '.*schemas/whoop-api"
    - from: "src/infrastructure/whoop/resources/recovery.ts"
      to: "src/infrastructure/whoop/pagination.ts paginateAll (compound-key keyFn signature shipped by Plan 03-06)"
      via: "named import + explicit keyFn"
      pattern: "paginateAll.*keyFn|cycle_id.*sleep_id"
    - from: "src/domain/dst-tz/detect.ts"
      to: "@date-fns/tz tzOffset"
      via: "named import"
      pattern: "from '@date-fns/tz"
---

<objective>
Stand up the per-resource HTTP modules (Plan 03-06 client + Plan 03-07 fixtures consumed here), the pure normalizers that map raw WHOOP payloads to camelCase domain entities, and the pure DST/tz detection function that the sync orchestrator (Plan 03-11) calls at upsert time.

Purpose: This is where Phase 3 stitches the WHOOP wire-format (snake_case) to the application's domain types (camelCase + discriminated unions). Each resource module is ≤ 30 LOC because the heavy lifting is in client.ts (auth, retry, rate-limit, Zod-parse) and the normalizer (camelCase + DU narrowing) and paginateAll (pagination + dup-key check). The DST detector lands here because cycles.resource → normalizeCycle → calls detectExclusion at upsert time.

Recovery's compound-key pagination: Plan 03-06 already ships `paginateAll(fetchPage, keyFn?)` with an optional `keyFn` parameter so recoveries (compound (cycle_id, sleep_id) PK) pass `(row) => row.cycle_id + ':' + row.sleep_id` for dup detection. This plan consumes that signature — it does NOT mutate `pagination.ts`.

Output: 6 resource modules + 6 normalizers + 1 DST detector + 5 test files. cycles.test.ts + recovery.test.ts cover compound + paginated shape; sleep.test.ts + workouts.test.ts cover per-score-state branch coverage (checker Warning #9); detect.test.ts covers DST/tz across all 3 D-15 fixtures.
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
@.planning/research/PITFALLS.md
@agent_docs/decisions/0003-score-state-discipline.md
@agent_docs/decisions/0007-whoop-read-only.md
@src/infrastructure/whoop/client.ts
@src/infrastructure/whoop/pagination.ts
@src/domain/schemas/whoop-api.ts
@src/domain/types/entities.ts
@src/domain/types/score.ts
@tests/helpers/msw-whoop-cycles.ts
@tests/fixtures/whoop/cycles/200-dst-spring-forward.json
@tests/fixtures/whoop/cycles/200-tz-trip-sfo-jfk.json

<interfaces>
<!-- Resource module shape (D-17, D-18, D-19, Pattern 7) -->

  // src/infrastructure/whoop/resources/cycles.ts
  const PAGE_SIZE = 25;                                // A3 verified max
  export async function listCycles(opts: { since: string; until: string }): Promise<Cycle[]>;

  // recovery.ts — compound-key keyFn passed explicitly (Plan 03-06 paginateAll signature)
  //   paginateAll(fetcher, (row) => row.cycle_id + ':' + row.sleep_id)
  // sleep.ts, workouts.ts — default keyFn (uses row.id)
  // profile.ts:
  export async function getProfile(): Promise<Profile>;
  // body-measurements.ts:
  export async function getBodyMeasurement(): Promise<{ raw: WhoopRawBodyMeasurement }>;
  //   ↑ append-on-change repo writes; resource fetches the raw + returns it for the orchestrator to pipe through

<!-- Normalizer shape (D-28, Pattern C3) -->

  // src/domain/normalize/cycles.ts
  export function normalizeCycle(raw: z.infer<typeof WhoopRawCycle>, opts: {
    ianaZone: string;                       // resolved once at sync start
    priorTimezoneOffset: string | null;     // from MAX(start)-cycle for tz_drift detection
  }): Cycle;
  // The function calls detectExclusion internally; the cycle entity emerges with baselineExcluded + exclusionReason set

<!-- DST detector (D-13, Pattern 5) -->

  // src/domain/dst-tz/detect.ts
  export interface DstDetectInput {
    ianaZone: string;
    cycle: { start: string; end: string | null; timezone_offset: string };
    priorCycle: { timezone_offset: string } | null;
  }
  export interface DstDetectOutput {
    baseline_excluded: boolean;
    exclusion_reason: 'dst_straddle' | 'tz_drift' | null;
  }
  export function detectExclusion(input: DstDetectInput): DstDetectOutput;
</interfaces>
</context>

<tasks>

<task type="auto">
  <name>Task 1: DST/tz detector + 6 normalizers + per-score-state branch tests for all 4 scored normalizers</name>
  <files>src/domain/dst-tz/detect.ts, src/domain/dst-tz/detect.test.ts, src/domain/normalize/cycles.ts, src/domain/normalize/recovery.ts, src/domain/normalize/sleep.ts, src/domain/normalize/workouts.ts, src/domain/normalize/profile.ts, src/domain/normalize/body-measurements.ts, src/domain/normalize/cycles.test.ts, src/domain/normalize/recovery.test.ts, src/domain/normalize/sleep.test.ts, src/domain/normalize/workouts.test.ts</files>
  <read_first>
    - .planning/phases/03-data-model-db-layer-sync-loop/03-CONTEXT.md decisions D-13 (2 OR'd detection rules), D-14 (computed at upsert time; re-evaluated on retroactive update), D-15 (DST/tz fixtures), D-16 (default baseline filter)
    - .planning/phases/03-data-model-db-layer-sync-loop/03-RESEARCH.md §Pattern 5 lines 535-560 (DST detector code), §Pattern 4 lines 510-533 (score narrowing in normalizer)
    - .planning/phases/03-data-model-db-layer-sync-loop/03-PATTERNS.md §C2 lines 798-851 (DST skeleton + deriveOverall analog), §C3 lines 854-885 (normalizer contract)
    - .planning/research/PITFALLS.md Pitfall 6 (DST/tz corruption), Pitfall I (re-flag on retroactive WHOOP updates), Pitfall 3 (PENDING_SCORE silently masquerading as SCORED — the per-score-state branch tests defend against this)
    - .planning/research/STACK.md §Date Handling (@date-fns/tz pinned to ^1; date-fns to ^4.1.0)
    - tests/fixtures/whoop/cycles/200-dst-spring-forward.json (Plan 03-07 — spring-forward fixture)
    - tests/fixtures/whoop/cycles/200-dst-fall-back.json (Plan 03-07 — fall-back fixture)
    - tests/fixtures/whoop/cycles/200-tz-trip-sfo-jfk.json (Plan 03-07 — three-cycle trip)
    - src/domain/schemas/whoop-api.ts (Plan 03-03 — raw schemas for input types)
    - src/domain/types/entities.ts (Plan 03-03 — Cycle / Recovery / Sleep / Workout DUs as output)
    - src/services/doctor/index.ts deriveOverall (Plan 01-05 — pure-function analog)
  </read_first>
  <action>
    **src/domain/dst-tz/detect.ts** (Pattern 5 verbatim):
      - Leading comment cites D-13 + D-14 + Pitfall 6 + Pitfall I.
      - `import { tzOffset } from '@date-fns/tz'` — the only external import.
      - Export `DstDetectInput`, `DstDetectOutput` interfaces (snake_case for compatibility with the SQL columns the result is written to).
      - Export `detectExclusion(input: DstDetectInput): DstDetectOutput`:
        - Rule 1 — dst_straddle: if `input.cycle.end !== null`, compute `startOffset = tzOffset(input.ianaZone, new Date(input.cycle.start))` and `endOffset = tzOffset(input.ianaZone, new Date(input.cycle.end))`. If they differ, return `{baseline_excluded: true, exclusion_reason: 'dst_straddle'}`.
        - Rule 2 — tz_drift: if `input.priorCycle !== null && input.cycle.timezone_offset !== input.priorCycle.timezone_offset`, return `{baseline_excluded: true, exclusion_reason: 'tz_drift'}`.
        - Otherwise: `{baseline_excluded: false, exclusion_reason: null}`.
        - NOTE: tzOffset return is in MINUTES per @date-fns/tz semantics; comparison is `!==` numeric, so spring-forward -480 vs -420 differ.

    **detect.test.ts** — exhaustive coverage:
      - Test 1: DST spring-forward — load `tests/fixtures/whoop/cycles/200-dst-spring-forward.json`, take the single record, call detectExclusion with `ianaZone: 'America/Los_Angeles', priorCycle: null` → result `{baseline_excluded: true, exclusion_reason: 'dst_straddle'}`.
      - Test 2: DST fall-back — load `200-dst-fall-back.json` → `{baseline_excluded: true, exclusion_reason: 'dst_straddle'}`.
      - Test 3: tz_drift trip — load `200-tz-trip-sfo-jfk.json`. For record 0 (offset -08, no prior), call with priorCycle=null → `{baseline_excluded: false, exclusion_reason: null}` (no prior to compare). For record 1 (offset -05), call with `priorCycle={timezone_offset: '-08:00'}` → `{baseline_excluded: true, exclusion_reason: 'tz_drift'}`. For record 2 (offset -05), call with `priorCycle={timezone_offset: '-05:00'}` → `{baseline_excluded: false, exclusion_reason: null}` (matches prior).
      - Test 4: ordinary cycle no DST no trip — synthetic `{start: '2026-04-01T07:00:00.000Z', end: '2026-04-02T07:00:00.000Z', timezone_offset: '-08:00'}` with priorCycle matching → `{baseline_excluded: false, exclusion_reason: null}`.
      - Test 5: cycle with `end: null` (still in progress) — Rule 1 skipped because end is null; Rule 2 evaluated normally. Synthetic input with priorCycle differing → `tz_drift`.
      - Test 6: cycle with `end: null` AND priorCycle null → `{baseline_excluded: false, exclusion_reason: null}` (nothing to detect).
      - Test 7: OR-ed precedence — synthetic DST-straddling cycle with tz_drift from prior → returns `dst_straddle` (Rule 1 wins; tested first per D-13 ordering).
      - Test 8: purity — call detectExclusion twice with identical input → identical output. No internal state.

    **6 normalizers** — one per resource (cycles, recovery, sleep, workouts, profile, body-measurements):

    `src/domain/normalize/cycles.ts`:
      - Imports: `import type { z } from 'zod'`, `import { WhoopRawCycle } from '../schemas/whoop-api.js'`, `import { detectExclusion } from '../dst-tz/detect.js'`, `import type { Cycle } from '../types/entities.js'`.
      - `export interface NormalizeCycleOpts { ianaZone: string; priorTimezoneOffset: string | null; }`
      - `export function normalizeCycle(raw: z.infer<typeof WhoopRawCycle>, opts: NormalizeCycleOpts): Cycle`:
        - Compute DST: `const exclusion = detectExclusion({ianaZone: opts.ianaZone, cycle: {start: raw.start, end: raw.end, timezone_offset: raw.timezone_offset}, priorCycle: opts.priorTimezoneOffset !== null ? {timezone_offset: opts.priorTimezoneOffset} : null});`
        - Switch on `raw.score_state`:
          - `'SCORED'`: return `{scoreState: 'SCORED', id: raw.id, userId: raw.user_id, createdAt: raw.created_at, updatedAt: raw.updated_at, start: raw.start, end: raw.end, timezoneOffset: raw.timezone_offset, strain: raw.score.strain, kilojoule: raw.score.kilojoule, averageHeartRate: raw.score.average_heart_rate, maxHeartRate: raw.score.max_heart_rate, baselineExcluded: exclusion.baseline_excluded, exclusionReason: exclusion.exclusion_reason}`
          - `'PENDING_SCORE'`: same identifier fields, NO score fields, baseline-excluded fields populated.
          - `'UNSCORABLE'`: same as PENDING_SCORE.
      - Pure function. No I/O, no logger, no DB. The `raw` is already Zod-parsed.

    `src/domain/normalize/recovery.ts`:
      - Same shape; `raw.cycle_id` → `cycleId`, `raw.sleep_id` → `sleepId` (compound key); SCORED variant maps `raw.score.recovery_score` → `recoveryScore` etc. Recovery doesn't carry DST itself; baselineExcluded inherits via cycle_id FK at query time (D-14 — recovery/sleep/workouts inherit). NormalizeRecovery does NOT call detectExclusion. Signature: `normalizeRecovery(raw): Recovery` (no opts).

    `src/domain/normalize/sleep.ts`:
      - Same shape; sleeps DO have their own `start` + `end` + `timezone_offset` per the verified WHOOP sleep doc. But per D-14, the DST flag lives ONLY on cycles, and sleep inherits at query time via the cycle FK. So sleep normalizer does NOT call detectExclusion either.
      - Map SCORED-specific fields per the sleep schema (totalInBedTimeMilli, sleepEfficiencyPercentage, respiratoryRate, etc.).

    `src/domain/normalize/workouts.ts`:
      - Same shape. SCORED fields per workout schema (strain, distanceMeter, altitudeGainMeter, etc.).

    `src/domain/normalize/profile.ts`:
      - `export function normalizeProfile(raw: z.infer<typeof WhoopRawProfile>, opts: { clock: Date }): Profile`:
        - Return `{userId: raw.user_id, email: raw.email, firstName: raw.first_name, lastName: raw.last_name, fetchedAt: opts.clock.toISOString()}`. No score_state.

    `src/domain/normalize/body-measurements.ts`:
      - `export function normalizeBodyMeasurement(raw, opts: { clock: Date }): { userId, heightMeter, weightKilogram, maxHeartRate, capturedAt, rawJson }`. The repository's append-on-change semantic uses `capturedAt = opts.clock.toISOString()` per Open Question 3 / D-35.

    **cycles.test.ts** (normalizer tests):
      - Test 1: SCORED cycle → entity has scoreState='SCORED', strain set, baselineExcluded=false (priorTimezoneOffset matches).
      - Test 2: PENDING_SCORE cycle → entity has scoreState='PENDING_SCORE', no `strain` field, baselineExcluded set per detector.
      - Test 3: UNSCORABLE cycle → entity has scoreState='UNSCORABLE'.
      - Test 4: DST-straddling cycle (load 200-dst-spring-forward.json) → baselineExcluded=true, exclusionReason='dst_straddle'.
      - Test 5: tz_drift cycle (load 200-tz-trip-sfo-jfk.json record 1) with priorTimezoneOffset='-08:00' → baselineExcluded=true, exclusionReason='tz_drift'.
      - Test 6: snake → camel mapping locked — `raw.user_id` becomes `userId`; `raw.timezone_offset` becomes `timezoneOffset`; `raw.score.average_heart_rate` becomes `averageHeartRate`.
      - Test 7: purity — called twice with same inputs → identical output (no internal state, no module-level cache).

    **recovery.test.ts** (normalizer tests):
      - Test 1: SCORED → all score fields present.
      - Test 2: PENDING / UNSCORABLE → no score fields.
      - Test 3: Compound key — `cycleId` + `sleepId` set on output entity.
      - Test 4: snake → camel — `hrv_rmssd_milli` → `hrvRmssdMilli`; `spo2_percentage` → `spo2Percentage`.

    **sleep.test.ts** (per-score-state branch coverage — checker Warning #9):
      - Test 1: SCORED sleep payload (synthetic inline JSON matching WhoopRawSleep SCORED variant) → normalizeSleep returns Sleep entity with scoreState='SCORED', totalInBedTimeMilli set, sleepEfficiencyPercentage set, respiratoryRate set.
      - Test 2: PENDING_SCORE sleep payload (synthetic with no `score` sub-object) → entity has scoreState='PENDING_SCORE', NO `totalInBedTimeMilli` / `sleepEfficiencyPercentage` / `respiratoryRate` fields (TypeScript narrowing makes them inaccessible without scoreState check).
      - Test 3: UNSCORABLE sleep payload → entity has scoreState='UNSCORABLE', same shape as Test 2 (no score fields).
      - Test 4: snake → camel mapping — `total_in_bed_time_milli` → `totalInBedTimeMilli`; `sleep_efficiency_percentage` → `sleepEfficiencyPercentage`; `respiratory_rate` → `respiratoryRate`.
      - Test 5: UUID id preserved on the Sleep entity as `id: string`.

    **workouts.test.ts** (per-score-state branch coverage — checker Warning #9):
      - Test 1: SCORED workout payload → entity has scoreState='SCORED', strain set, kilojoule set, distanceMeter set.
      - Test 2: PENDING_SCORE workout payload (no `score` sub-object) → entity has scoreState='PENDING_SCORE', NO score-only fields.
      - Test 3: UNSCORABLE workout payload → entity has scoreState='UNSCORABLE'.
      - Test 4: snake → camel mapping — `average_heart_rate` → `averageHeartRate`; `altitude_gain_meter` → `altitudeGainMeter`.
      - Test 5: UUID id + sport_id preserved.

    Profile + body-measurements normalizers: smoke coverage in Plan 03-10 contract tests; ship source here.

    All files: NO default exports; NO drizzle imports (Gate G — but these are in src/domain/ so Gate G already forbids); NO console.*.
  </action>
  <verify>
    <automated>npm run test -- src/domain/dst-tz/detect.test.ts src/domain/normalize/cycles.test.ts src/domain/normalize/recovery.test.ts src/domain/normalize/sleep.test.ts src/domain/normalize/workouts.test.ts</automated>
  </verify>
  <acceptance_criteria>
    - `grep -c "tzOffset" src/domain/dst-tz/detect.ts` returns at least 2 (import + 2 usages)
    - `grep -c "dst_straddle" src/domain/dst-tz/detect.ts` returns at least 1
    - `grep -c "tz_drift" src/domain/dst-tz/detect.ts` returns at least 1
    - `npm run test -- src/domain/dst-tz/detect.test.ts` shows at least 8 assertions passing
    - `npm run test -- src/domain/normalize/cycles.test.ts` shows at least 7 assertions passing
    - `npm run test -- src/domain/normalize/recovery.test.ts` shows at least 4 assertions passing
    - `npm run test -- src/domain/normalize/sleep.test.ts` shows at least 5 assertions passing (3 score-state branches + snake-camel + UUID)
    - `npm run test -- src/domain/normalize/workouts.test.ts` shows at least 5 assertions passing (3 score-state branches + snake-camel + UUID/sport_id)
    - Per-score-state branch coverage attestation: `grep -cE "'(SCORED|PENDING_SCORE|UNSCORABLE)'" src/domain/normalize/sleep.test.ts` returns at least 3 (one literal per branch) AND same for workouts.test.ts
    - `grep -c "from '@date-fns/tz'" src/domain/dst-tz/detect.ts` returns 1
    - `grep -rEn "from ['\"]drizzle-orm" src/domain/` returns 0 lines (Gate G strict)
    - `grep -rcE "^export default" src/domain/normalize/ src/domain/dst-tz/` returns 0
    - `npx tsc --noEmit` exits 0
    - `bash scripts/ci-grep-gates.sh` exits 0
  </acceptance_criteria>
  <done>DST/tz detector shipped with 2 OR'd rules + 8 assertions covering all 3 D-15 fixtures + 7 + 4 + 5 + 5 normalizer assertions covering the 3 score-state branches for cycles + recovery + sleep + workouts; all 6 normalizers + the DST detector are pure functions.</done>
</task>

<task type="auto">
  <name>Task 2: 6 per-resource HTTP modules under src/infrastructure/whoop/resources/</name>
  <files>src/infrastructure/whoop/resources/cycles.ts, src/infrastructure/whoop/resources/recovery.ts, src/infrastructure/whoop/resources/sleep.ts, src/infrastructure/whoop/resources/workouts.ts, src/infrastructure/whoop/resources/profile.ts, src/infrastructure/whoop/resources/body-measurements.ts</files>
  <read_first>
    - .planning/phases/03-data-model-db-layer-sync-loop/03-CONTEXT.md decisions D-17 (per-resource modules over shared httpGet), D-18 (callWithAuth wraps inside httpGet exactly once — resource modules NEVER reference callWithAuth), D-19 (PAGE_SIZE = 25 per A3), D-21 (GET-only)
    - .planning/phases/03-data-model-db-layer-sync-loop/03-RESEARCH.md §Code Examples lines 862-882 (listCycles pattern verbatim), §Technical Research item 1 (no updated_since — params are start/end/limit/nextToken), item 3 (profile + body-measurements single-shot)
    - .planning/phases/03-data-model-db-layer-sync-loop/03-PATTERNS.md §B5 lines 621-668 (resource adapter shape)
    - src/infrastructure/whoop/client.ts (Plan 03-06 — httpGet contract + WHOOP_API_BASE)
    - src/infrastructure/whoop/pagination.ts (Plan 03-06 — paginateAll<T>(fetchPage, keyFn?: (row: T) => string) — signature already supports compound-key recovery)
    - src/domain/schemas/whoop-api.ts (Plan 03-03 — page wrappers + raw schemas)
    - src/domain/normalize/cycles.ts + recovery.ts + sleep.ts + workouts.ts + profile.ts + body-measurements.ts (Task 1 — output mappers)
    - agent_docs/decisions/0007-whoop-read-only.md (GET-only)
  </read_first>
  <action>
    Create 6 resource modules. Each is small (<40 LOC); the heavy lifting lives in client.ts + pagination.ts + the normalizer.

    **src/infrastructure/whoop/resources/cycles.ts**:
      ```typescript
      // Leading comment cites D-17 + D-18 + D-19 + A3.
      import { httpGet } from '../client.js';
      import { paginateAll } from '../pagination.js';
      import { WhoopCyclesPageSchema, type WhoopRawCycle } from '../../../domain/schemas/whoop-api.js';
      import { normalizeCycle } from '../../../domain/normalize/cycles.js';
      import type { Cycle } from '../../../domain/types/entities.js';
      import type { z } from 'zod';

      const PAGE_SIZE = 25; // A3 verified max

      export interface ListCyclesOpts {
        since: string;
        until: string;
        ianaZone: string;
        priorTimezoneOffset: string | null;  // for tz_drift detection on the first record
      }

      export async function listCycles(opts: ListCyclesOpts): Promise<Cycle[]> {
        const rawRecords = await paginateAll<z.infer<typeof WhoopRawCycle>>(async (nextToken) => {
          const page = await httpGet(
            '/v2/cycle',
            {
              start: opts.since,
              end: opts.until,
              limit: PAGE_SIZE,
              nextToken: nextToken ?? undefined,
            },
            WhoopCyclesPageSchema,
          );
          return page;
        });
        // Cycles have a scalar `id` field; paginateAll's default keyFn (String(row.id)) is correct.
        // Sort by start ascending so prior-cycle lookups are correct for tz_drift detection.
        const sorted = [...rawRecords].sort((a, b) => a.start.localeCompare(b.start));
        // Map with rolling priorTimezoneOffset (D-13 Rule 2 walks consecutive cycles)
        const entities: Cycle[] = [];
        let priorOffset = opts.priorTimezoneOffset;
        for (const raw of sorted) {
          const entity = normalizeCycle(raw, { ianaZone: opts.ianaZone, priorTimezoneOffset: priorOffset });
          entities.push(entity);
          priorOffset = raw.timezone_offset;
        }
        return entities;
      }
      ```
      Notes: resource module owns the rolling-prior-offset walk so tz_drift detection runs correctly within a single sync's page set. The orchestrator (Plan 03-11) seeds `priorTimezoneOffset` from the latest pre-existing cycle in the DB.

    **src/infrastructure/whoop/resources/recovery.ts** — compound-key paginateAll call (Plan 03-06 already exposes the optional keyFn parameter; this resource consumes it):
      ```typescript
      // Leading comment cites D-17 + D-18 + D-19 + A12 (compound key) + Plan 03-06 paginateAll keyFn parameter.
      import { httpGet } from '../client.js';
      import { paginateAll } from '../pagination.js';
      import { WhoopRecoveryPageSchema, type WhoopRawRecovery } from '../../../domain/schemas/whoop-api.js';
      import { normalizeRecovery } from '../../../domain/normalize/recovery.js';
      import type { Recovery } from '../../../domain/types/entities.js';
      import type { z } from 'zod';

      const PAGE_SIZE = 25;
      export interface ListRecoveryOpts { since: string; until: string; }

      export async function listRecovery(opts: ListRecoveryOpts): Promise<Recovery[]> {
        // Recoveries have NO scalar `id` field — they are keyed by compound (cycle_id, sleep_id) per A12.
        // Plan 03-06 paginateAll signature: paginateAll<T>(fetchPage, keyFn?: (row: T) => string).
        // We pass an explicit keyFn so dup-detection is correct across pages.
        const rawRecords = await paginateAll<z.infer<typeof WhoopRawRecovery>>(
          async (nextToken) => {
            const page = await httpGet(
              '/v2/recovery',
              {
                start: opts.since,
                end: opts.until,
                limit: PAGE_SIZE,
                nextToken: nextToken ?? undefined,
              },
              WhoopRecoveryPageSchema,
            );
            return page;
          },
          (row) => row.cycle_id + ':' + row.sleep_id,  // compound-key dedup
        );
        // recoveries paginate without DST/tz concern (inherits via cycle FK)
        return rawRecords.map(normalizeRecovery);
      }
      ```

      The `paginateAll` signature was finalized in Plan 03-06 (`<T>(fetchPage, keyFn?: (row: T) => string)`); this resource module is a straight consumer — no mutation of `pagination.ts` happens in this plan.

    **src/infrastructure/whoop/resources/sleep.ts** + **workouts.ts**:
      - `listSleep({since, until})` / `listWorkouts({since, until})` — same shape as cycles MINUS the DST detection (sleeps/workouts inherit via cycle_id). Use `/v2/activity/sleep` and `/v2/activity/workout`. Sort + map(normalizeSleep / normalizeWorkout). No rolling-prior-offset needed.
      - Sleeps + workouts have scalar `id` fields (UUIDs per A6); paginateAll's default keyFn is correct — no explicit keyFn needed.

    **src/infrastructure/whoop/resources/profile.ts**:
      ```typescript
      export async function getProfile(): Promise<Profile> {
        const raw = await httpGet('/v2/user/profile/basic', {}, WhoopRawProfile);
        return normalizeProfile(raw, { clock: new Date() });
      }
      ```
      Single-shot per A4. NOTE: `WhoopRawProfile` is a single-record Zod schema (not a page wrapper) per Plan 03-03 / verified docs.

    **src/infrastructure/whoop/resources/body-measurements.ts**:
      ```typescript
      export async function getBodyMeasurement(): Promise<{ raw: z.infer<typeof WhoopRawBodyMeasurement>; entity: BodyMeasurement }> {
        const raw = await httpGet('/v2/user/measurement/body', {}, WhoopRawBodyMeasurement);
        const entity = normalizeBodyMeasurement(raw, { clock: new Date() });
        return { raw, entity };
      }
      ```
      Returns BOTH raw + normalized so the sync orchestrator can pass `JSON.stringify(raw)` to the repository's `upsertOnChange` rawJson parameter.

    Common requirements for all 6 modules:
      - NO `import { callWithAuth }` (D-18 — only client.ts has it).
      - NO `fetch(` (Gate F — only client.ts + token-store.ts + oauth.ts).
      - NO `console.*` / `process.stdout.write` (ADR-0001 + Gate B).
      - NO default exports.
      - NO modifications to `src/infrastructure/whoop/pagination.ts` — its signature (with optional keyFn) was finalized in Plan 03-06.

    NO test files in this task — Plan 03-10 contract tests exercise resource modules end-to-end through MSW + the in-memory DB + repositories.
  </action>
  <verify>
    <automated>bash scripts/ci-grep-gates.sh && npx tsc --noEmit</automated>
  </verify>
  <acceptance_criteria>
    - `ls src/infrastructure/whoop/resources/*.ts | wc -l` returns 6
    - `grep -c "PAGE_SIZE = 25" src/infrastructure/whoop/resources/cycles.ts src/infrastructure/whoop/resources/recovery.ts src/infrastructure/whoop/resources/sleep.ts src/infrastructure/whoop/resources/workouts.ts` returns 4 (one per paginated resource)
    - `grep -rEc "import.*callWithAuth" src/infrastructure/whoop/resources/` returns 0 lines (D-18 attestation: no resource module imports callWithAuth directly)
    - `grep -rEc "\\bfetch\\s*\\(" src/infrastructure/whoop/resources/` returns 0 (Gate F: only client.ts has fetch in src/infrastructure/whoop/)
    - `grep -c "/v2/cycle\|/v2/recovery\|/v2/activity/sleep\|/v2/activity/workout\|/v2/user/profile/basic\|/v2/user/measurement/body" src/infrastructure/whoop/resources/*.ts` returns at least 6 (one per resource module, matching the verified WHOOP v2 endpoint paths)
    - `grep -c "updated_since" src/infrastructure/whoop/resources/*.ts` returns 0 (Technical Research item 1 — WHOOP v2 does NOT accept updated_since)
    - `grep -cE "row\.cycle_id \\+ ':' \\+ row\.sleep_id" src/infrastructure/whoop/resources/recovery.ts` returns 1 (recovery resource passes the compound-key keyFn explicitly — load-bearing for Pitfall 10 dup-detection)
    - `git diff src/infrastructure/whoop/pagination.ts` returns empty (this plan does NOT modify pagination.ts — Plan 03-06 already owns the keyFn signature)
    - `bash scripts/ci-grep-gates.sh` exits 0 (Gates F + G + E + B all green: resource modules don't bypass client.ts)
    - `npx tsc --noEmit` exits 0
    - `npm run lint` exits 0
    - Total Phase 3 source files now matches RESEARCH.md §Recommended Project Structure (lines 232-307) — 6 resource modules under `src/infrastructure/whoop/resources/`
  </acceptance_criteria>
  <done>6 resource modules shipped; D-17 + D-18 + D-19 + Gate F enforced via grep + no-callWithAuth-in-resources runtime invariant; resources sit on top of client.ts + paginateAll (with explicit keyFn for recovery, default keyFn for cycles/sleeps/workouts) + normalizers + DST detector; pagination.ts UNMODIFIED in this plan.</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| WHOOP raw payload (Zod-validated) → normalizer (pure) | The normalizer is the snake↔camel + score-state-narrowing boundary; passthrough() in Zod schemas lets unknown WHOOP fields stay in raw_json |
| Resource module → httpGet (the WHOOP chokepoint) | Gate F + Gate E + D-17 + D-18 enforce that only client.ts calls fetch + callWithAuth + the OAuth refresh endpoint |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-03.09-01 | Tampering | A resource module bypasses httpGet and calls fetch directly | mitigate | Gate F enforces at CI time — only 3 allowlisted files may have fetch( |
| T-03.09-02 | Tampering | A resource module bypasses paginateAll and writes its own loop | accept | Future regression risk; no CI gate. Mitigated by code review + planner-template note. paginateAll's dup-key assertion is the load-bearing guard. |
| T-03.09-03 | Information disclosure | A normalizer logs the raw payload to Pino | mitigate | Normalizers are pure functions — no logger import. Verified by grep at acceptance time. |
| T-03.09-04 | Tampering | DST detector misclassifies a cycle | mitigate | detect.test.ts Test 1-3 exercise all 3 D-15 fixtures + Test 4-7 cover the negative/edge cases. Pure function with array-literal-testable inputs (conventions.md). |
| T-03.09-05 | Information disclosure | tz_drift detection from a sibling device with different IANA zone | accept | IANA zone resolved at sync-start from the operator's machine (`Intl.DateTimeFormat().resolvedOptions().timeZone`). Plan 03-11 owns the resolution; if user travels mid-sync the next sync re-resolves. Single-user personal tool, so cross-machine variance is OOS. |
| T-03.09-06 | Denial of service | paginateAll loops forever on a malformed WHOOP response | mitigate | Loop terminates when next_token === null; the dup-key assertion (Pitfall 10) catches re-ordering, and rate-limit semaphore caps in-flight count. A truly malformed stream surfaces as WhoopApiError({kind: 'validation'}) eventually. |
| T-03.09-07 | Tampering | A PENDING_SCORE sleep/workout silently appears with score fields populated (Pitfall 3) | mitigate | sleep.test.ts + workouts.test.ts each cover all 3 score-state branches per checker Warning #9; the TypeScript DU makes the violation a compile error and the tests assert the runtime parse. |
</threat_model>

<verification>
- `npm run test -- src/domain/` → all ≥ 29 new assertions green (8 + 7 + 4 + 5 + 5)
- `bash scripts/ci-grep-gates.sh` → all 7 gates green
- `npm run lint` → 0 errors
- `npx tsc --noEmit` → 0 errors
- `ls src/infrastructure/whoop/resources/*.ts` → 6 files
- `ls src/domain/normalize/*.ts` → 6 files
- `ls src/domain/normalize/*.test.ts` → 4 files (cycles + recovery + sleep + workouts)
- DST detector exercises all 3 D-15 fixtures
- `git diff src/infrastructure/whoop/pagination.ts` → empty (Plan 03-06 owns the signature)
</verification>

<success_criteria>
- 6 resource modules call httpGet (NOT callWithAuth, NOT fetch directly); pin PAGE_SIZE = 25 per A3 / D-19
- Recovery resource passes explicit compound-key keyFn to paginateAll (`(row) => row.cycle_id + ':' + row.sleep_id`); cycles/sleeps/workouts use the default keyFn — no mutation of pagination.ts
- WHOOP v2 endpoint paths verified per A3 / A4 (verified Sources)
- 6 normalizers are pure functions; raw snake_case → camelCase entity with score-state narrowing
- DST detector implements 2 OR'd rules (dst_straddle + tz_drift) per D-13 + Pattern 5
- D-15 fixtures all exercised by detect.test.ts + cycles.test.ts
- Per-score-state branch coverage on all 4 scored normalizers (cycles + recovery already covered; sleep + workouts gain dedicated test files per checker Warning #9)
- Gate F + Gate G remain green (resource modules don't import fetch or drizzle-orm)
- Pitfall 3 + Pitfall 6 + Pitfall I mitigated: per-score-state branch tests catch silent PENDING leakage; DST computed at every upsert (via normalizer call); retroactive WHOOP updates re-flag on the spot
</success_criteria>

<output>
Create `.planning/phases/03-data-model-db-layer-sync-loop/03-09-SUMMARY.md` when done.
</output>
