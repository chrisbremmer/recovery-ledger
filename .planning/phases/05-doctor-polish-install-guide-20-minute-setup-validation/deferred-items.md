# Deferred Items — Phase 5

Out-of-scope discoveries logged during plan execution. NOT fixed (per executor
SCOPE BOUNDARY rule — only auto-fix issues directly caused by the current task).

## Pre-existing `npx tsc --noEmit` errors (present on `main`, not introduced by Plan 05-01)

Discovered during Plan 05-01 (Wave 0 scaffolding). These 7 type errors exist on
`main` and the `feat/phase-5` base commit, in files NOT touched by Plan 05-01.
Confirmed by stashing all 05-01 changes and re-running `npx tsc --noEmit` —
identical 7-error output. Also confirmed `git diff main...HEAD` is empty for all
three files, so they are unchanged from `main`.

1. `src/cli/commands/auth.ts(97,35)` — TS2379 `timeoutMs: number | undefined`
   not assignable under `exactOptionalPropertyTypes: true`.
2. `src/infrastructure/db/repositories/sync-runs.repo.ts(201,46)` — TS2322
   `'aborted'` status not assignable to the narrower return enum.
3. `src/infrastructure/db/repositories/sync-runs.repo.ts(208,7)` — TS2578 unused
   `@ts-expect-error` directive.
4. `src/infrastructure/db/repositories/sync-runs.repo.ts(250,5)` — TS2322
   `'aborted'` status not assignable (UPDATE arm).
5. `tests/helpers/msw-whoop-oauth.ts(74,32)` — TS2345 `unknown` not assignable to
   `JsonBodyType`.
6. `tests/helpers/msw-whoop-oauth.ts(82,30)` — TS2345 same as above.

Root cause for the sync-runs trio: the `'aborted'` schema-enum widening (#15/#35)
left the repository return-type narrower than the column enum.

These predate Phase 5 and are out of scope for the Wave 0 scaffolding plan. They
should be addressed in a dedicated `/gsd-quick` or `/gsd-debug` pass (or folded
into the Phase 5 phase-close plan if the close criteria require a clean
`tsc --noEmit`). The project's actual CI gate is `vitest run` + `biome check` +
`scripts/ci-grep-gates.sh` (there is no `typecheck` npm script), and those pass.
