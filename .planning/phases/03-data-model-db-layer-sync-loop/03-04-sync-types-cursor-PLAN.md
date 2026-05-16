---
phase: 03-data-model-db-layer-sync-loop
plan: 04
type: execute
wave: 1
depends_on: ["03-01"]
files_modified:
  - src/domain/types/sync.ts
  - src/services/sync/cursor.ts
  - src/services/sync/cursor.test.ts
autonomous: true
requirements: [SYNC-01, SYNC-04]
tags: [sync, cursor, pure-function]
user_setup: []

must_haves:
  truths:
    - "src/domain/types/sync.ts exports RunSyncInput, RunSyncResult, ResourceSyncOutcome, ResourceName, ResourceSyncStatus, RunSyncStatus per D-23/D-24/D-25/D-26"
    - "RESOURCES tuple = ['profile', 'body_measurements', 'cycles', 'recoveries', 'sleeps', 'workouts'] in D-23 order"
    - "src/services/sync/cursor.ts exports computeWindow(opts): {since, until} as a pure function (no Date.now(), no env reads) per D-10 + RESEARCH Pattern 9"
    - "Default window: since = min(cursor, now() - 7d) — 7-day re-window catches WHOOP retroactive updates (D-10)"
    - "--days N override: since = now() - N*86400000 (D-26)"
    - "--since <ISO> override: since = flag value verbatim (backfill mode; D-26)"
    - "Override precedence: flagSinceISO > flagDaysN > default 7-day re-window"
    - "ADR-0001: no console.* / process.stdout.write in cursor.ts"
    - "Gate G stays green: no drizzle-orm import in src/services/ (D-28 + Anti-Pattern 3)"
    - "Wave 1a position: sync.ts ships in this plan WITHOUT touching entities.ts; Plan 03-03 (Wave 1b) imports ResourceSyncOutcome cleanly from sync.ts after this plan lands"
  artifacts:
    - path: "src/domain/types/sync.ts"
      provides: "Sync input/result/outcome types + RESOURCES tuple — consumed by Plan 03-03 entities.ts (Wave 1b) and Plan 03-11 sync orchestrator (Wave 4)"
      contains: "ResourceSyncOutcome"
    - path: "src/services/sync/cursor.ts"
      provides: "computeWindow pure function — derives {since, until} from cursor + flags + clock"
      contains: "computeWindow"
  key_links:
    - from: "src/services/sync/cursor.ts"
      to: "deterministic clock injection"
      via: "opts.clock: Date parameter"
      pattern: "clock: Date"
    - from: "src/domain/types/sync.ts"
      to: "src/domain/types/entities.ts (Plan 03-03 — Wave 1b)"
      via: "ResourceSyncOutcome import from this file"
      pattern: "ResourceSyncOutcome"
---

<objective>
Lock the sync orchestration types (D-23 / D-24 / D-25 / D-26) and ship the pure cursor function that drives the 7-day re-window. Both are tested at the unit level — no DB, no HTTP. Plan 03-11's sync service composes these. Plan 03-03 (Wave 1b) imports `ResourceSyncOutcome` from `src/domain/types/sync.ts` (this plan's output).

Purpose: Splitting the pure window logic out of the orchestrator means it gets exhaustive unit coverage (boundary conditions: empty cursor / future cursor / cursor older than 7d / both flags set) without integration-test overhead. The orchestrator (Plan 03-11) gets a fixed contract to consume. Shipping `sync.ts` in Wave 1a (this plan) and `entities.ts` in Wave 1b (Plan 03-03) eliminates the placeholder-coupling race that would arise from running 03-03 and 03-04 strictly in parallel.

Output: 2 source files + 1 test file (~12 assertion test). All under 200 LOC total. This plan does NOT modify `entities.ts` — Plan 03-03 (Wave 1b) consumes the exported `ResourceSyncOutcome` cleanly.
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
@agent_docs/conventions.md
@src/services/index.ts
@src/services/refresh-orchestrator.ts

<interfaces>
<!-- Sync types target shape (D-23, D-24, D-25, D-26) -->

  export const RESOURCES = [
    'profile', 'body_measurements', 'cycles', 'recoveries', 'sleeps', 'workouts'
  ] as const;
  export type ResourceName = (typeof RESOURCES)[number];

  export type ResourceSyncStatus =
    | 'success'
    | 'partial_429'
    | 'partial_5xx'
    | 'failed_auth'
    | 'failed_network'
    | 'skipped';

  export type RunSyncStatus = 'ok' | 'partial' | 'failed';

  export interface ResourceSyncOutcome {
    status: ResourceSyncStatus;
    fetched?: number;
    upserted?: number;
    errors?: number;
    durationMs?: number;
  }

  export interface RunSyncInput {
    days?: number;
    since?: string;            // ISO 8601
    resources?: ReadonlyArray<ResourceName>;
  }

  export interface RunSyncResult {
    status: RunSyncStatus;
    perResource: Record<ResourceName, ResourceSyncOutcome>;
    syncRunId: number;
    gapsDetected: number;
  }

<!-- computeWindow signature (D-10 + RESEARCH Pattern 9) -->

  export function computeWindow(opts: {
    cursor: string;                // ISO 8601 — COALESCE(MAX(updated_at), '1970-01-01T00:00:00Z')
    clock: Date;                   // injected for testability — no Date.now()
    flagSinceISO?: string | null;  // --since
    flagDaysN?: number | null;     // --days
  }): { since: string; until: string }
</interfaces>
</context>

<tasks>

<task type="auto">
  <name>Task 1: Write sync.ts types + cursor.ts pure function</name>
  <files>src/domain/types/sync.ts, src/services/sync/cursor.ts</files>
  <read_first>
    - .planning/phases/03-data-model-db-layer-sync-loop/03-CONTEXT.md decisions D-09 (per-resource cursor = MAX(updated_at)), D-10 (7-day re-window), D-23 (resource order load-bearing), D-24 (sync_runs row shape), D-25 (per-resource outcome enum), D-26 (--days/--since/--resources flags)
    - .planning/phases/03-data-model-db-layer-sync-loop/03-RESEARCH.md §Pattern 9 lines 660-685 (computeWindow code verbatim), §Technical Research item 1 (no updated_since on WHOOP v2 — implications for window plumbing)
    - .planning/phases/03-data-model-db-layer-sync-loop/03-PATTERNS.md §D2 lines 972-1000 (cursor.ts skeleton + ISO ordering note)
    - agent_docs/conventions.md (domain types in src/domain/; service helpers in src/services/; pure functions array-literal-testable)
    - src/services/index.ts (existing services barrel — Plan 03-11 will extend this to add runSync; cursor.ts is consumed inside services/sync/)
  </read_first>
  <action>
    Create `src/domain/types/sync.ts`. Leading doc comment names the source decisions (D-23 / D-24 / D-25 / D-26). No imports needed (pure type file). Export, in order:
      - `RESOURCES` as a `readonly` tuple in D-23 order: `'profile', 'body_measurements', 'cycles', 'recoveries', 'sleeps', 'workouts'`. Order is load-bearing — lightest first to surface auth/config errors before paginated resources.
      - `ResourceName` type derived from the tuple.
      - `ResourceSyncStatus` literal union: `'success' | 'partial_429' | 'partial_5xx' | 'failed_auth' | 'failed_network' | 'skipped'` per D-25.
      - `RunSyncStatus` literal union: `'ok' | 'partial' | 'failed'` per D-24.
      - `ResourceSyncOutcome` interface: `{ status: ResourceSyncStatus; fetched?: number; upserted?: number; errors?: number; durationMs?: number }`.
      - `RunSyncInput` interface: `{ days?: number; since?: string; resources?: ReadonlyArray<ResourceName> }` per D-26.
      - `RunSyncResult` interface: `{ status: RunSyncStatus; perResource: Record<ResourceName, ResourceSyncOutcome>; syncRunId: number; gapsDetected: number }`.
      - `RESOURCE_NAMES_SET: ReadonlySet<string>` for runtime validation of `--resources` CLI parsing.

    This plan SHIPS `sync.ts` only. Do NOT touch `src/domain/types/entities.ts` — Plan 03-03 (Wave 1b) imports `ResourceSyncOutcome` + `ResourceName` from `./sync.js` after this plan lands. The Wave 1a → Wave 1b ordering (set by `depends_on: ["03-01", "03-04"]` on Plan 03-03) guarantees `sync.ts` is on disk before `entities.ts` is written.

    Create `src/services/sync/cursor.ts`. Leading doc comment names D-10 + RESEARCH.md Pattern 9 + the no-Date.now() rule. Imports: nothing (pure function on Date primitives only). Export:
      - `MS_PER_DAY = 86_400_000` constant.
      - `EPOCH_ZERO_ISO = '1970-01-01T00:00:00.000Z'` constant — the value the SQL `COALESCE` will fall back to on an empty table (caller's responsibility per D-09).
      - `computeWindow(opts: {cursor: string; clock: Date; flagSinceISO?: string | null; flagDaysN?: number | null}): {since: string; until: string}`:
        - `const now = opts.clock`
        - Override 1: if `opts.flagSinceISO` is set (truthy), return `{since: opts.flagSinceISO, until: now.toISOString()}`. Backfill mode wins over everything.
        - Override 2: if `opts.flagDaysN` is set and > 0, return `{since: new Date(now.getTime() - opts.flagDaysN * MS_PER_DAY).toISOString(), until: now.toISOString()}`.
        - Default: `const sevenDaysAgo = new Date(now.getTime() - 7 * MS_PER_DAY).toISOString(); const since = opts.cursor < sevenDaysAgo ? opts.cursor : sevenDaysAgo; return {since, until: now.toISOString()};`
        - Comment: ISO-string lexical ordering matches chronological ordering only when both are full ISO 8601 with Z and same timezone normalization. The cursor is emitted by SQLite `MAX(updated_at)` from the WHOOP wire format which is `YYYY-MM-DDTHH:mm:ss.SSSZ`. The flag-since-ISO is user input — validate elsewhere; computeWindow trusts the string lexically per D-10.

    No console.*, no process.stdout.write in either file. No drizzle-orm imports in either file (Gate G). No default exports.
  </action>
  <verify>
    <automated>npm run lint -- src/domain/types/sync.ts src/services/sync/cursor.ts && npx tsc --noEmit</automated>
  </verify>
  <acceptance_criteria>
    - `grep -cE "^export " src/domain/types/sync.ts` returns at least 6 (RESOURCES, ResourceName, ResourceSyncStatus, RunSyncStatus, ResourceSyncOutcome, RunSyncInput, RunSyncResult, RESOURCE_NAMES_SET — at least 6, likely 8)
    - `grep -cE "'profile', 'body_measurements', 'cycles', 'recoveries', 'sleeps', 'workouts'" src/domain/types/sync.ts` returns 1 (D-23 order exactly)
    - `grep -c "computeWindow" src/services/sync/cursor.ts` returns at least 2 (declaration + export)
    - `grep -c "Date.now\|process.env" src/services/sync/cursor.ts` returns 0 (pure function — clock injected)
    - `grep -c "MS_PER_DAY" src/services/sync/cursor.ts` returns at least 2 (constant + usage)
    - `grep -rE "from ['\"]drizzle-orm" src/domain/ src/services/sync/` returns 0 lines
    - `grep -cE "^export default" src/domain/types/sync.ts src/services/sync/cursor.ts` returns 0
    - `git diff src/domain/types/entities.ts` returns empty (this plan does NOT touch entities.ts — Plan 03-03 Wave 1b imports from sync.ts)
    - `npx tsc --noEmit` exits 0
    - `npm run lint` exits 0
  </acceptance_criteria>
  <done>sync.ts ships the 8 sync-related types in D-23 order; cursor.ts ships computeWindow as a pure function with injected clock; entities.ts UNTOUCHED — Wave 1b Plan 03-03 picks it up from this file.</done>
</task>

<task type="auto">
  <name>Task 2: Unit tests for computeWindow covering all 4 override paths + boundary cases</name>
  <files>src/services/sync/cursor.test.ts</files>
  <read_first>
    - src/services/sync/cursor.ts (Task 1 output)
    - .planning/phases/03-data-model-db-layer-sync-loop/03-RESEARCH.md §Pattern 9 + §Technical Research item 1 (window semantics)
    - .planning/phases/03-data-model-db-layer-sync-loop/03-CONTEXT.md decisions D-10 (re-window shape) + D-26 (flag precedence)
    - src/services/doctor/index.ts (existing service for vitest describe/test patterns — array-literal-driven tests per conventions.md)
    - agent_docs/conventions.md §Testing (vitest pool='forks'; tests live alongside source as *.test.ts)
  </read_first>
  <action>
    Create `src/services/sync/cursor.test.ts` with vitest. Use a fixed clock per test (`new Date('2026-05-16T00:00:00.000Z')`). Cover:

    Group A — Default (no flags). Reference implementation: `since = opts.cursor < sevenDaysAgo ? opts.cursor : sevenDaysAgo`. The OLDER of the two values wins — this is the load-bearing D-10 semantic: the window is always at least 7 days, and a freshly-advanced cursor does NOT shrink the re-window below 7d.
      - cursor older than 7d → returned since === cursor (cursor is the OLDER, so cursor wins; the window extends BACK as far as the cursor):
        - `{cursor: '2026-01-01T00:00:00.000Z'}` → since === '2026-01-01T00:00:00.000Z' (cursor is older than sevenDaysAgo === '2026-05-09T00:00:00.000Z' so cursor wins).
      - cursor newer than 7d → returned since === sevenDaysAgo. When `cursor > sevenDaysAgo` (cursor is more recent than 7 days back): `since = sevenDaysAgo` (the older of the two wins; the trailing 7d re-window catches retroactive updates per D-10):
        - `{cursor: '2026-05-15T00:00:00.000Z'}` → since === '2026-05-09T00:00:00.000Z' (sevenDaysAgo wins because it is the OLDER bound; this re-windows the trailing 7 days).
      - cursor exactly 7d old → tie boundary — `opts.cursor < sevenDaysAgo` is false → since === sevenDaysAgo (the strict-less-than is intentional per D-10's "at least 7 days" intent).
      - empty cursor (EPOCH_ZERO_ISO) → since === EPOCH_ZERO_ISO (epoch wins — fetch everything; D-09 fallback).
      - until === clock.toISOString() in all default cases.

    Group B — --days flag override:
      - `{flagDaysN: 30, cursor: '2026-05-15T...'}` → since === clock - 30d === '2026-04-16T00:00:00.000Z'. cursor is IGNORED per D-26.
      - `{flagDaysN: 365, cursor: '...'}` → since === clock - 365d.
      - `{flagDaysN: 0}` → falls through to default (0 is falsy per the spec; D-26 says default 30 — the CLI shim Plan 03-12 owns the default, not computeWindow).

    Group C — --since flag override (highest precedence):
      - `{flagSinceISO: '2025-01-01T00:00:00.000Z', flagDaysN: 30, cursor: '2026-05-15T...'}` → since === '2025-01-01T00:00:00.000Z'. Both other inputs are IGNORED.
      - until === clock.toISOString() always.

    Group D — purity:
      - Call computeWindow with the same opts twice → identical output (no hidden state).
      - Spy on `Date.now()` (vitest `vi.spyOn` on `globalThis.Date`) → assert not called (`expect(spy).not.toHaveBeenCalled()`). Confirms the function is clock-injected.

    Aim for at least 10 assertions across the 4 groups. Each test gives a one-line `expect(result.since).toBe(...)` / `expect(result.until).toBe(...)`. No fixtures needed.

    Verify with `npm run test -- src/services/sync/cursor.test.ts`.
  </action>
  <verify>
    <automated>npm run test -- src/services/sync/cursor.test.ts</automated>
  </verify>
  <acceptance_criteria>
    - `npm run test -- src/services/sync/cursor.test.ts` shows at least 10 assertions passing across 4 describe groups (A, B, C, D)
    - Group A "cursor newer than 7d" assertion passes — since === sevenDaysAgo (the older bound wins; catches the load-bearing D-10 re-window semantic)
    - Group A "cursor older than 7d" assertion passes — since === cursor (still the older bound wins)
    - Group C "--since wins over --days and cursor" passes — three-way precedence test
    - Group D "no Date.now() calls" passes — pure-function lock
    - Total Phase 3 test count delta from this plan is at least 10
    - `bash scripts/ci-grep-gates.sh` exits 0
    - `npm run lint` exits 0
  </acceptance_criteria>
  <done>computeWindow exhaustively covered at the unit level — boundary, override precedence, purity. Plan 03-11's sync orchestrator can consume it with confidence.</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| CLI flag input (--since / --days) → computeWindow | Computed window drives WHOOP HTTP request params; trusted-after-Zod-parse at the CLI layer (Plan 03-12) |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-03.04-01 | Tampering | --since flag passed as malformed ISO string | accept | computeWindow does not validate ISO format; the CLI shim (Plan 03-12) validates via Zod before calling computeWindow. The WHOOP server rejects malformed `start`/`end` query params with a 400 → maps to WhoopApiError({kind: 'validation'}). |
| T-03.04-02 | Repudiation | Sync window decisions logged inside services/sync/index.ts | accept | logger.warn({event: 'sync_started', flags}) emitted in Plan 03-11; computeWindow is a pure function and emits nothing itself. |
</threat_model>

<verification>
- `npm run test -- src/services/sync/cursor.test.ts` → ≥ 10 assertions green
- `npm run lint` → 0 errors
- `bash scripts/ci-grep-gates.sh` → all 7 gates green
- `npx tsc --noEmit` → 0 errors
- `git diff src/domain/types/entities.ts` → empty (no cross-plan placeholder coupling)
</verification>

<success_criteria>
- All sync orchestration types declared in `src/domain/types/sync.ts` with D-23 resource order locked
- `computeWindow` pure function in `src/services/sync/cursor.ts` covers D-10 re-window + D-26 --days/--since override precedence
- Tests lock the 4 override paths + purity invariant
- Zero drizzle-orm in src/domain/ or src/services/sync/ (Gate G)
- This plan does NOT modify `src/domain/types/entities.ts` — Plan 03-03 (Wave 1b) consumes `ResourceSyncOutcome` cleanly via cross-file import
</success_criteria>

<output>
Create `.planning/phases/03-data-model-db-layer-sync-loop/03-04-SUMMARY.md` when done.
</output>
