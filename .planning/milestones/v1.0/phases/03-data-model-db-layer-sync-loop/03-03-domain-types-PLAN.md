---
phase: 03-data-model-db-layer-sync-loop
plan: 03
type: execute
wave: 1
depends_on: ["03-01", "03-04"]
files_modified:
  - src/domain/types/score.ts
  - src/domain/types/entities.ts
  - src/domain/types/score.test.ts
  - src/domain/schemas/whoop-api.ts
  - src/domain/schemas/score.ts
  - src/domain/schemas/entities.ts
  - src/domain/schemas/whoop-api.test.ts
autonomous: true
requirements: [DATA-05, DATA-06]
tags: [zod, score-state, domain, whoop]
user_setup: []

must_haves:
  truths:
    - "src/domain/types/score.ts exports a closed `ScoreState` literal union: 'SCORED' | 'PENDING_SCORE' | 'UNSCORABLE' (D-03 + ADR-0003)"
    - "src/domain/schemas/score.ts exports per-resource z.discriminatedUnion('score_state', […]) — RecoveryScore, CycleScore, SleepScore, WorkoutScore — with SCORED-only variants carrying score fields (D-03)"
    - "src/domain/types/entities.ts exports camelCase entity types — Cycle, Recovery, Sleep, Workout, Profile, BodyMeasurement, SyncRun, Decision, DailySummary — with `scoreState` as the discriminator (camelCase per conventions.md)"
    - "src/domain/types/entities.ts imports `ResourceSyncOutcome` from `./sync.js` (owned by Plan 03-04 — Wave 1a ship before this plan)"
    - "src/domain/schemas/whoop-api.ts exports Zod schemas for raw snake_case WHOOP responses (WhoopRawCycle, WhoopRawRecovery, WhoopRawSleep, WhoopRawWorkout, WhoopRawProfile, WhoopRawBodyMeasurement) and their page wrappers (WhoopCyclesPageSchema etc.)"
    - "Gate G stays green: no `from 'drizzle-orm'` import in src/domain/ (ARCHITECTURE.md Anti-Pattern 3)"
    - "ADR-0003 forcing function: a code path that reads `.recoveryScore` on a non-SCORED variant is a compile error (no Score.recoveryScore on the union; only ScoredRecovery)"
  artifacts:
    - path: "src/domain/types/score.ts"
      provides: "ScoreState literal union (closed tuple)"
      contains: "SCORE_STATES"
    - path: "src/domain/schemas/score.ts"
      provides: "Per-resource discriminated unions on score_state"
      contains: "z.discriminatedUnion"
    - path: "src/domain/types/entities.ts"
      provides: "camelCase entity types for all 9 v1 tables"
      contains: "scoreState"
    - path: "src/domain/schemas/whoop-api.ts"
      provides: "Raw snake_case Zod schemas + page wrappers"
      contains: "next_token"
  key_links:
    - from: "src/domain/types/entities.ts"
      to: "src/domain/types/score.ts"
      via: "import type { ScoreState } from './score.js'"
      pattern: "ScoreState"
    - from: "src/domain/types/entities.ts"
      to: "src/domain/types/sync.ts (Plan 03-04 — Wave 1a)"
      via: "import type { ResourceSyncOutcome } from './sync.js'"
      pattern: "ResourceSyncOutcome"
    - from: "src/domain/schemas/score.ts"
      to: "z.discriminatedUnion"
      via: "zod"
      pattern: "discriminatedUnion\\('score_state'"
---

<objective>
Stand up the three-layer type system: raw Zod (snake_case wire), domain entities (camelCase TS), and the Score discriminated union that ADR-0003 makes load-bearing. Pure types and schemas — no I/O, no Drizzle imports (Gate G), no DB connections.

Purpose: Phase 4's baseline math, Phase 3's repositories, and Phase 3's resource modules all consume these types. Locking them in Wave 1 means Waves 2-5 can write to a fixed contract without re-litigating field names or discriminator shape.

Wave ordering: This plan sits in Wave 1b — it runs AFTER Plan 03-04 (Wave 1a) so that `src/domain/types/sync.ts` (which owns `ResourceSyncOutcome`) is already on disk when `entities.ts` imports from it. This eliminates the placeholder-coupling race that would arise from running 03-03 and 03-04 strictly in parallel.

Output: 5 new files (`score.ts` + `entities.ts` + 3 schemas) + 2 test files. Tests exercise the discriminator's forcing function (`.recoveryScore` is a compile error on a non-SCORED variant) and the raw-schema parse of each WHOOP response shape against committed fixtures (read from `tests/fixtures/whoop/` — those land in Wave 2 Plan 03-07, so this plan's tests will reference future fixtures only via lazy `readFileSync` inside test cases. Where a fixture is not yet on disk, test cases use inline JSON literals instead.)
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
@.planning/research/STACK.md
@agent_docs/decisions/0003-score-state-discipline.md
@agent_docs/conventions.md
@src/domain/types/sync.ts

<interfaces>
<!-- Three-layer separation per conventions.md "WHOOP types live in three layers". -->

Layer 1 (raw, snake_case, Zod-validated at the WHOOP boundary):
  WhoopRawCycle, WhoopRawRecovery, WhoopRawSleep, WhoopRawWorkout, WhoopRawProfile, WhoopRawBodyMeasurement
  Page wrappers: WhoopCyclesPageSchema, WhoopRecoveryPageSchema, WhoopSleepPageSchema, WhoopWorkoutsPageSchema
  Shape: z.object({ records: z.array(WhoopRawX), next_token: z.string().nullable() })

Layer 2 (domain entity, camelCase TS, store/use): Cycle, Recovery, Sleep, Workout, Profile, BodyMeasurement, SyncRun, Decision, DailySummary
  - scoreState: ScoreState (the discriminator from score.ts)
  - SCORED-only score fields are present only on the SCORED variant of each entity (forced via DU)

Layer 3 (view): Phase 4 owns; not in scope.

ScoreState closed tuple (D-03):
  export const SCORE_STATES = ['SCORED', 'PENDING_SCORE', 'UNSCORABLE'] as const;
  export type ScoreState = (typeof SCORE_STATES)[number];

Per-resource discriminated unions:
  RecoveryScore = z.discriminatedUnion('score_state', [ScoredRecovery, PendingRecovery, UnscorableRecovery])
  CycleScore = z.discriminatedUnion('score_state', [ScoredCycle, PendingCycle, UnscorableCycle])
  SleepScore, WorkoutScore — same shape

External dependency from Plan 03-04 (Wave 1a, already on disk before this plan runs):
  import type { ResourceSyncOutcome } from './sync.js'
  // Used by SyncRun.perResource shape: Record<ResourceName, ResourceSyncOutcome>
</interfaces>
</context>

<tasks>

<task type="auto">
  <name>Task 1: Write ScoreState + entity types + Zod raw + page schemas</name>
  <files>src/domain/types/score.ts, src/domain/types/entities.ts, src/domain/schemas/whoop-api.ts, src/domain/schemas/score.ts, src/domain/schemas/entities.ts</files>
  <read_first>
    - .planning/phases/03-data-model-db-layer-sync-loop/03-CONTEXT.md decisions D-03 (Score = discriminatedUnion), D-04 (SCORED-only default), D-28 (repositories return domain entities; no drizzle types in domain)
    - .planning/phases/03-data-model-db-layer-sync-loop/03-RESEARCH.md §Pattern 4 lines 510-533 (Score discriminator code), §Technical Research item 4 lines 1090-1099 (WHOOP snake_case wire format; next_token), §Sources lines 1219-1225 (per-resource doc citations for field lists)
    - .planning/phases/03-data-model-db-layer-sync-loop/03-PATTERNS.md §C1 lines 766-794 (Score DU), §C3 lines 854-884 (normalizer contract)
    - .planning/research/PITFALLS.md Pitfall 3 (silent PENDING_SCORE → SCORED leakage)
    - agent_docs/decisions/0003-score-state-discipline.md (full — ADR-0003 is load-bearing)
    - agent_docs/conventions.md "WHOOP types live in three layers"
    - src/domain/types/sync.ts (Plan 03-04 Wave 1a output — exports `ResourceSyncOutcome`; entities.ts imports it directly)
    - src/infrastructure/db/schema.ts (Plan 03-02 output — the entity types mirror its column shapes but in camelCase; do NOT import from this file in src/domain/)
  </read_first>
  <action>
    Create the five files. All TypeScript files have a leading doc comment naming the source decision (D-03 / D-04 / D-28) and the three-layer convention.

    1. `src/domain/types/score.ts`:
       - `export const SCORE_STATES = ['SCORED', 'PENDING_SCORE', 'UNSCORABLE'] as const`
       - `export type ScoreState = (typeof SCORE_STATES)[number]`
       - `export const SCORE_STATES_SET: ReadonlySet<ScoreState> = new Set(SCORE_STATES)` for duck-type guards
       - No imports; pure type file.

    2. `src/domain/types/entities.ts`:
       - Imports: `import type { ScoreState } from './score.js'` AND `import type { ResourceSyncOutcome, ResourceName } from './sync.js'` (Plan 03-04 Wave 1a — already on disk). No drizzle, no zod, no placeholder.
       - Export the discriminator-bearing entity types as discriminated unions:
         - `type CycleScored = { scoreState: 'SCORED'; id, userId, createdAt, updatedAt, start, end, timezoneOffset, strain, kilojoule, averageHeartRate, maxHeartRate, baselineExcluded: boolean, exclusionReason: 'dst_straddle' | 'tz_drift' | null }`
         - `type CyclePending = { scoreState: 'PENDING_SCORE'; id, userId, createdAt, updatedAt, start, end, timezoneOffset, baselineExcluded: boolean, exclusionReason: ... }` — note: PENDING_SCORE + UNSCORABLE still carry baselineExcluded + exclusionReason because DST detection runs at upsert time regardless of score_state (D-14)
         - `type CycleUnscorable = { scoreState: 'UNSCORABLE'; ... same as Pending }`
         - `export type Cycle = CycleScored | CyclePending | CycleUnscorable`
       - Same shape for Recovery (compound PK fields `cycleId` + `sleepId` instead of `id`), Sleep, Workout. Score-only fields per the verified WHOOP doc citations in 03-RESEARCH.md Sources.
       - Non-scored entities (camelCase, plain types):
         - `Profile`: `userId, email, firstName, lastName, fetchedAt`
         - `BodyMeasurement`: `id, userId, heightMeter, weightKilogram, maxHeartRate, capturedAt`
         - `SyncRun`: `id, startedAt, finishedAt: string | null, status: 'running' | 'ok' | 'partial' | 'failed', perResource: Record<ResourceName, ResourceSyncOutcome>, gapsDetected, flags`
         - `Decision`: `id (ULID string), createdAt, category, decision, rationale: string | null, confidence: 'low' | 'medium' | 'high' | null, expectedEffect: string | null, followUpDate: string | null, status: 'open' | 'followed_up' | 'abandoned', outcomeNotes: string | null`
         - `DailySummary`: `date, userId, recoveryScore: number | null, sleepEfficiencyPercentage: number | null, dayStrain: number | null, respiratoryRate: number | null, hrvRmssdMilli: number | null, restingHeartRate: number | null, computedAt`
       - `ResourceSyncOutcome` and `ResourceName` are imported from `./sync.js` (Plan 03-04 Wave 1a). No placeholder declaration in this file.

    3. `src/domain/schemas/whoop-api.ts` — raw Zod schemas (snake_case passthrough, matches WHOOP wire format):
       - `import { z } from 'zod'`
       - For each WHOOP resource shape, declare per-score-state variants then unite with `z.discriminatedUnion('score_state', [...])`. Example for `WhoopRawRecovery`:
         - `ScoredRawRecovery = z.object({ score_state: z.literal('SCORED'), recovery_score: z.number().int(), resting_heart_rate: z.number().int(), hrv_rmssd_milli: z.number(), spo2_percentage: z.number(), skin_temp_celsius: z.number(), user_calibrating: z.boolean(), ...identifiers... }).passthrough()`
         - `PendingRawRecovery = z.object({ score_state: z.literal('PENDING_SCORE'), ...identifiers... }).passthrough()`
         - `UnscorableRawRecovery = z.object({ score_state: z.literal('UNSCORABLE'), ...identifiers... }).passthrough()`
         - `export const WhoopRawRecovery = z.discriminatedUnion('score_state', [ScoredRawRecovery, PendingRawRecovery, UnscorableRawRecovery])`
       - `passthrough()` on every leaf so unknown WHOOP fields don't fail the parse (forward-compat; raw_json captures the full payload anyway).
       - Same shape for `WhoopRawCycle`, `WhoopRawSleep`, `WhoopRawWorkout`.
       - `WhoopRawProfile = z.object({ user_id, email, first_name, last_name }).passthrough()` — no score_state on profile.
       - `WhoopRawBodyMeasurement = z.object({ user_id, height_meter, weight_kilogram, max_heart_rate }).passthrough()` — no score_state.
       - Page wrappers (D-19 / Pattern 7):
         - `export const WhoopCyclesPageSchema = z.object({ records: z.array(WhoopRawCycle), next_token: z.string().nullable() })`
         - Same for `WhoopRecoveryPageSchema`, `WhoopSleepPageSchema`, `WhoopWorkoutsPageSchema`.
       - Identifier shapes per A6: `WhoopRawCycle.id` is `z.number().int()` (int64); `WhoopRawSleep.id`, `WhoopRawWorkout.id` are `z.string().uuid()`; `WhoopRawRecovery` has `cycle_id: z.number().int()` + `sleep_id: z.string().uuid()` (compound).

    4. `src/domain/schemas/score.ts` — per-resource score DUs that reference Layer 2 entity types. Lightweight wrapper; many call sites will use raw schemas + normalizer + entity narrowing rather than this file. Re-export the DUs:
       - `export const RecoveryScore = z.discriminatedUnion('score_state', [...])` from whoop-api.ts (re-export the raw discriminator for ergonomics)
       - Pure z.infer<...> re-exports for downstream consumers.

    5. `src/domain/schemas/entities.ts` — Zod schemas matching Layer 2 entity shapes (camelCase). Used by repository row → entity validators (Plan 03-08) and by integration tests that need to assert on parsed entities. Per-entity:
       - `CycleEntitySchema = z.discriminatedUnion('scoreState', [...])` (camelCase discriminator — different field name than the raw schema's snake_case `score_state` discriminator)
       - Same for Recovery, Sleep, Workout, plus plain Zod objects for Profile, BodyMeasurement, SyncRun, Decision, DailySummary.

    All five files: NO default exports. NO drizzle-orm imports (Gate G enforces). NO `console.*` / `process.stdout.write` in doc comments (use phrasing per learnings).

    Cross-cutting check: every Layer 2 SCORED variant carries the same SCORED-only fields as its Layer 1 raw counterpart, with camelCase keys. The DU enforces ADR-0003: a domain function `function f(c: Cycle) { return c.strain }` is a compile error because `strain` exists only on `CycleScored`, not on the union.
  </action>
  <verify>
    <automated>npm run lint -- src/domain/ && npx tsc --noEmit</automated>
  </verify>
  <acceptance_criteria>
    - `grep -cE "^export (const|type) " src/domain/types/score.ts` returns at least 3 (SCORE_STATES, ScoreState, SCORE_STATES_SET)
    - `grep -cE "^export type (Cycle|Recovery|Sleep|Workout|Profile|BodyMeasurement|SyncRun|Decision|DailySummary)" src/domain/types/entities.ts` returns 9
    - `grep -c "from './sync.js'\|from './sync\\.ts'" src/domain/types/entities.ts` returns at least 1 (entities.ts imports ResourceSyncOutcome + ResourceName from Plan 03-04 sync.ts — no placeholder)
    - `grep -cE "^(type|export type) ResourceSyncOutcome" src/domain/types/entities.ts` returns 0 (no local placeholder; the type comes from sync.ts)
    - `grep -c "z.discriminatedUnion('score_state'" src/domain/schemas/whoop-api.ts` returns 4 (cycles, recovery, sleep, workouts)
    - `grep -c "next_token: z\.string()\.nullable()" src/domain/schemas/whoop-api.ts` returns 4 (one page wrapper per paginated resource)
    - `grep -c "passthrough()" src/domain/schemas/whoop-api.ts` returns at least 6 (one per leaf raw type)
    - `grep -rE "from ['\"]drizzle-orm" src/domain/` returns 0 lines (Gate G stays green; verified by `bash scripts/ci-grep-gates.sh`)
    - `grep -rcE "^export default" src/domain/` returns 0 across all new files
    - `npx tsc --noEmit` exits 0 (the entity DU compiles end-to-end and resolves the cross-file import to Plan 03-04 sync.ts)
    - `npm run lint` exits 0
  </acceptance_criteria>
  <done>All 5 files committed; ScoreState closed tuple + 4 per-resource raw+page DUs + 9 domain entity types declared; entities.ts cleanly imports ResourceSyncOutcome from Plan 03-04 sync.ts (no placeholder); Gate G + Gate B all green.</done>
</task>

<task type="auto">
  <name>Task 2: Lock the discriminator forcing function via type + parse tests</name>
  <files>src/domain/types/score.test.ts, src/domain/schemas/whoop-api.test.ts</files>
  <read_first>
    - src/domain/types/score.ts (Task 1 output)
    - src/domain/types/entities.ts (Task 1 output)
    - src/domain/schemas/whoop-api.ts (Task 1 output)
    - .planning/phases/03-data-model-db-layer-sync-loop/03-RESEARCH.md §Pattern 4 lines 510-533 (DU example for parse tests)
    - .planning/research/PITFALLS.md Pitfall 3 (PENDING_SCORE silently masquerading as SCORED — what the tests defend against)
    - agent_docs/decisions/0003-score-state-discipline.md §Test Strategy
    - src/infrastructure/whoop/errors.test.ts (test shape precedent — vitest describe/test pattern, no `// @ts-expect-error` comments outside their own line)
  </read_first>
  <action>
    Create `src/domain/types/score.test.ts`:
      - Test 1: `SCORE_STATES.length === 3` and `SCORE_STATES` contains exactly the 3 literals (lock the closed tuple per ADR-0003).
      - Test 2: TypeScript-level discriminator test — declare a value `const c: Cycle = { scoreState: 'PENDING_SCORE', id: 1, userId: 1, createdAt: 't', updatedAt: 't', start: 't', end: null, timezoneOffset: '-08:00', baselineExcluded: false, exclusionReason: null }` and assert (via `@ts-expect-error` on the violating line) that `c.strain` is NOT accessible without narrowing. Pattern:
        ```typescript
        // @ts-expect-error — strain only exists on CycleScored after narrowing on scoreState === 'SCORED'
        const _bad: number | undefined = c.strain;
        ```
        Vitest runs the type-check as part of test compilation; the @ts-expect-error directive forces a compile failure if the DU is loosened.
      - Test 3: Narrowing succeeds — `if (c.scoreState === 'SCORED') { const _ok: number | null = c.strain; }` compiles cleanly. Assert via runtime `expect(true).toBe(true)` so the test counts; the load-bearing assertion is at compile time.
      - Test 4: SCORE_STATES_SET correctness — `expect(SCORE_STATES_SET.has('SCORED')).toBe(true)` + `expect(SCORE_STATES_SET.has('foo')).toBe(false)`.

    Create `src/domain/schemas/whoop-api.test.ts`:
      - Test parsing of each raw schema against an inline JSON literal (no fixture files; those land in Plan 03-07):
        - SCORED recovery payload parses cleanly; PENDING recovery payload parses cleanly (no score fields required); UNSCORABLE recovery payload parses cleanly.
        - A SCORED payload missing `recovery_score` FAILS parse with a Zod error mentioning `recovery_score`.
        - A payload with `score_state: 'INVALID'` FAILS parse (closed discriminator).
        - Same shape for cycles, sleep, workouts (one per resource, ≥ 4 happy-path + ≥ 4 sad-path = ≥ 8 tests for the four list resources). Profile + BodyMeasurement: one happy-path test each.
      - Page-wrapper parse test:
        - `WhoopCyclesPageSchema.parse({ records: [...], next_token: 'abc' })` succeeds.
        - `WhoopCyclesPageSchema.parse({ records: [...], next_token: null })` succeeds (end-of-pages).
        - `WhoopCyclesPageSchema.parse({ records: 'not an array', next_token: null })` FAILS.
      - The four page-wrappers preserve the snake_case `next_token` field (Pitfall 10 + Pattern 7) — verify via `grep -c 'next_token' src/domain/schemas/whoop-api.ts` returns at least 4 (one per page schema).

    Use inline JSON literals only (not fixtures from `tests/fixtures/whoop/` — those don't exist yet). Fixture-driven tests land in Plan 03-10 contract tests.
  </action>
  <verify>
    <automated>npm run test -- src/domain/types/score.test.ts src/domain/schemas/whoop-api.test.ts</automated>
  </verify>
  <acceptance_criteria>
    - `npm run test -- src/domain/types/score.test.ts` shows at least 4 assertions passing
    - `npm run test -- src/domain/schemas/whoop-api.test.ts` shows at least 14 assertions passing (4 list resources × ≥ 2 happy + ≥ 2 sad = ≥ 16, plus 2 profile/body; some can be parameterized via `it.each`)
    - `grep -c "@ts-expect-error" src/domain/types/score.test.ts` returns at least 1 (DU forcing function lock)
    - `grep -c "INVALID" src/domain/schemas/whoop-api.test.ts` returns at least 1 (closed-discriminator parse failure asserted)
    - `npx tsc --noEmit` exits 0 (the @ts-expect-error directives compile to actual errors at the right lines)
    - `bash scripts/ci-grep-gates.sh` exits 0
  </acceptance_criteria>
  <done>Test files lock the discriminator's compile-time forcing function (Pitfall 3 caught at type-check) and the runtime parse contract for every WHOOP resource shape.</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| WHOOP HTTP response (untrusted) → Zod raw schemas | Validation at the boundary; passthrough() lets unknown fields land in raw_json but enforces required ones |
| Domain code consumers → Score discriminator | Type-system forcing function; PENDING_SCORE cannot read score fields |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-03.03-01 | Information disclosure | WhoopRaw* leaves PII in passthrough() output | accept | passthrough() preserves all WHOOP fields; the only consumers are repositories that store raw_json under the same chmod-600 dir as tokens.json. No new exposure. |
| T-03.03-02 | Tampering | Score discriminator union loosened to accept any string | mitigate | score.test.ts Test 1 locks SCORE_STATES.length === 3 with exact literal check; PR review + CI catches regression. |
| T-03.03-03 | Tampering | A new WHOOP score_state literal appears in the wire | accept | Zod closed discriminator throws; the error flows through sanitize.ts (D-34) and surfaces via WhoopApiError({kind: 'validation'}) (Plan 03-06). Operator can extend SCORE_STATES + re-test. |
</threat_model>

<verification>
- `npm run test -- src/domain/` → all ~20 assertions green
- `npm run lint` → 0 errors
- `bash scripts/ci-grep-gates.sh` → all 7 gates green
- `npx tsc --noEmit` → 0 errors (lock the @ts-expect-error pinning AND the cross-file ResourceSyncOutcome import resolution)
- `grep -rE "from ['\"]drizzle-orm" src/domain/` → 0 lines (Gate G confirms no drizzle in domain)
</verification>

<success_criteria>
- ScoreState closed tuple ('SCORED' | 'PENDING_SCORE' | 'UNSCORABLE') exported from `src/domain/types/score.ts` (D-03)
- All 9 v1 entity types declared in `src/domain/types/entities.ts` with camelCase fields, the 4 scored entities as discriminated unions on `scoreState`
- `ResourceSyncOutcome` + `ResourceName` imported cleanly from Plan 03-04's `src/domain/types/sync.js` (no placeholder; eliminates the Wave 1 placeholder-coupling race)
- All 4 raw paginated resources have `WhoopRaw*` discriminated unions on `score_state` (Layer 1 snake_case)
- 4 page-wrapper schemas (`WhoopCyclesPageSchema` etc.) preserve `next_token` (snake_case per Pattern 7 + Pitfall 10)
- Tests lock the discriminator's compile-time forcing function (Pitfall 3 / ADR-0003)
- Gate G: zero drizzle-orm imports in `src/domain/`
</success_criteria>

<output>
Create `.planning/phases/03-data-model-db-layer-sync-loop/03-03-SUMMARY.md` when done.
</output>
