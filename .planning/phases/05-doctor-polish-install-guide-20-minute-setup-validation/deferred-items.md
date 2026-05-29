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

## Gate F (`fetch(`) trip in a sibling-plan file — `db-wal-size.ts:22` (Plan 05-03)

Discovered during Plan 05-04 execution while running `bash scripts/ci-grep-gates.sh`.
`scripts/ci-grep-gates.sh` exits 1 with:

```
::error::Gate F — fetch( outside src/infrastructure/whoop/{client,token-store,oauth}.ts:
src/services/doctor/checks/db-wal-size.ts:22:// Rules): no console calls, no stdout writes. No `drizzle-orm`, no `fetch(`.
```

The offending text is a COMMENT — the literal `fetch(` appears inside the prose
phrase ``No `drizzle-orm`, no `fetch(`.`` Gate F's regex (`\bfetch\s*\(`) does not
distinguish comments from code, so the comment trips it. (The same line's
`drizzle-orm` mention does NOT trip Gate G because Gate G requires an
`from '...drizzle-orm` import, not a bareword.)

`db-wal-size.ts` is owned by Plan 05-03 (the `db_*` probe plan), not Plan 05-04.
Per the executor SCOPE BOUNDARY rule, Plan 05-04 did NOT modify a sibling plan's
file. Plan 05-04's own three probe files (`last-sync-recency.ts`,
`most-recent-scored-day.ts`, `data-quality-counts.ts`) are Gate-F-clean — verified
by running Gate F's pattern against only those three files (no match). The fix
(reword the comment so it does not contain the literal `fetch(`, e.g. ``no fetch``
without the open-paren) belongs to Plan 05-03 or the phase-close pass before the
final CI run.

## Transient `data-quality-counts.test.ts` tsc error during Plan 05-05 (Wave 1, parallel)

While Plan 05-05 (`concurrent_writers_stress`) ran in parallel with its Wave 1
siblings, one `npx tsc --noEmit` snapshot reported
`src/services/doctor/checks/data-quality-counts.test.ts(13,68) — TS2307: Cannot
find module './data-quality-counts.js'`. This is a Plan 05-04 file (its
`data-quality-counts.ts` module had not yet landed at that instant). A later
snapshot in the same session was clean (the sibling agent had created the
module). Not introduced by Plan 05-05 — its three files are tsc-clean against
the 6-error baseline. No action for Plan 05-05; the resolution is owned by the
Plan 05-04 / phase-close convergence once all Wave 1 agents have returned.
