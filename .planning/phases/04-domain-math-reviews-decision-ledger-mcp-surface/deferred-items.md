# Phase 4 — Deferred Items

Pre-existing issues discovered during execution that are out of scope for the
plan that found them. Each entry must record (a) the plan that discovered it,
(b) where the issue lives, and (c) why it was deferred (scope boundary).

## TSC errors in Phase 2 / test-helper code (discovered during Plan 04-04 execution)

`npx tsc --noEmit` reports 3 errors that are NOT introduced by Plan 04-04 and
do NOT touch `src/domain/` (the Phase 4 layer). Recorded here so Phase 2 or a
dedicated cleanup plan can address them.

1. `src/cli/commands/auth.ts:97` — `runOAuth` call passes `timeoutMs: number | undefined`
   against a target type of `number` (TS2379 — `exactOptionalPropertyTypes`).
2. `tests/helpers/msw-whoop-oauth.ts:74` — `unknown` not assignable to `JsonBodyType`
   (TS2345).
3. `tests/helpers/msw-whoop-oauth.ts:82` — `unknown` not assignable to `JsonBodyType`
   (TS2345).

Scope boundary: Plan 04-04 ships pure-domain math files only (`src/domain/anomalies/`,
`src/domain/baselines/`, `src/domain/confidence/`). The 3 errors above predate this
plan and belong to Phase 2 CLI + test infrastructure. Fixing them inside this plan
would inflate the diff and break the "directly caused by current changes" boundary.
