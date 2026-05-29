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

## `db_schema_version` ENOENT in the built CLI — `db-schema-version.ts` path resolution (Plan 05-03)

Discovered during Plan 05-06 Task 3 (CLI smoke test) once the CLI was switched
from `createServices()` to `bootstrap()` (so `db_schema_version` now receives a
real sqlite handle and runs its migrations-dir scan instead of returning the
"no DB handle injected" fail). Running the BUILT CLI:

```
$ node dist/cli.mjs doctor --text
[fail] db_schema_version — probe threw: ENOENT: no such file or directory, scandir '/Users/infrastructure/db/migrations'
```

Root cause: `src/services/doctor/checks/db-schema-version.ts:resolveDefaultMigrationsDir()`
resolves the migrations dir as `../../../infrastructure/db/migrations` relative
to `import.meta.url`. That holds for the dev/src tree and for vitest (where the
unit test passes an explicit `migrationsDir` override), but NOT for the bundled
`dist/cli.mjs`: tsup flattens the module graph, so `import.meta.url` is the
bundle root and the three `..` pops climb to `/Users/infrastructure/db/migrations`.

By contrast, `src/services/bootstrap.ts:resolveMigrationsDir()` already probes
the correct built location (`dist/infrastructure/db/migrations`, copied by the
tsup `onSuccess` hook) before falling back to the dev path. The probe does not
share that logic.

Scope: `db-schema-version.ts` is owned by Plan 05-03, NOT one of Plan 05-06's 5
files. Per the executor SCOPE BOUNDARY rule, Plan 05-06 did not modify a sibling
plan's file. The runDoctor() orchestrator wiring (Plan 05-06) passes the
injected sqlite handle correctly; the dist-only path bug is internal to the
05-03 probe. Suggested fix (for the phase-close pass or a `/gsd-quick`): give the
probe a dist-aware `resolveDefaultMigrationsDir()` mirroring bootstrap's
`resolveMigrationsDir()` probe (try `infrastructure/db/migrations` with no `..`
first, then the one-`..` dev path), OR thread the bootstrap-resolved
`migrationsDir` into `RunDoctorOptions` + the probe invocation. The vitest unit
suite stays green either way because it injects an explicit `migrationsDir`.

Note: this is a DIST-ONLY failure — `db_schema_version` passes when invoked from
the source tree (tsx / vitest) where the relative path resolves correctly.

## `concurrent_writers_stress` worker .mjs missing from dist — needs a tsup top-level entry (Plan 05-05)

Discovered during Plan 05-06 Task 3 (CLI smoke test). Running the BUILT CLI with
`--stress`:

```
$ node dist/cli.mjs doctor --stress --offline --text
[fail] concurrent_writers_stress — probe threw: worker entry not found (build dist or run from source tree)
```

Root cause: `src/services/doctor/checks/concurrent-writers-stress.ts:resolveWorker()`
looks for a `concurrent-writers-stress.worker.{ts,mjs}` sibling of the probe
module. In the dev/source tree the `.ts` sibling exists (the unit test's real
fork runs); in `dist/` no `.mjs` sibling exists because the worker is NOT a
tsup top-level entry — `tsup.config.ts` emits only `cli`, `mcp`, and
`infrastructure/whoop/token-store`, and the worker is not reachable as a bundled
import (it is `fork()`-ed by path at runtime, so tsup's tree-shake never pulls
it in). Plan 05-05's own SUMMARY flagged exactly this: the stress worker may need
to be a tsup top-level entry so a production `.mjs` sibling exists for the forked
child.

Scope: the fix requires editing `tsup.config.ts` (add the worker as a top-level
entry + ensure the `.mjs` lands as a sibling of the bundled probe — or adjust
`resolveWorker()` to locate the entry under `dist/`), which is outside Plan
05-06's 5 declared files. Per the Plan 05-06 prompt's explicit instruction, this
is logged here rather than editing `tsup.config.ts`. Belongs to Plan 05-10 / a
follow-up / the phase-close pass.

Impact on Plan 05-06 verification: NONE. The plan's smoke test uses `--offline`
(stress skipped via the `enabled` gate, returns the 'skipped — run with --stress
to enable' pass), and the 14-check JSON / text surface renders correctly. The
`--stress` arm is exercised correctly from the SOURCE tree (vitest real-fork test
in `concurrent-writers-stress.test.ts` is green); only the BUILT-CLI `--stress`
path is affected, and only when a user deliberately opts into the stress probe.

---

## Resolution status (orchestrator convergence pass, 2026-05-29)

- **RESOLVED — Gate F `db-wal-size.ts:22` comment trip.** Reworded by the Plan
  05-03 executor before its commit; `bash scripts/ci-grep-gates.sh` exits 0 on
  the committed Wave 1 state.
- **RESOLVED — `db_schema_version` ENOENT in the bundled CLI.** Fixed in commit
  `fix(05): make db_schema_version + stress worker work from bundled dist`.
  bootstrap() now injects its already-resolved `migrationsDir` through
  `RunDoctorOptions` (the same path the migrator uses), and the probe's own
  fallback now probes both dev + bundled-dist layouts like
  `bootstrap.resolveMigrationsDir()`. Verified from `dist/cli.mjs`:
  `[pass] db_schema_version — schema at migration 1/1`.
- **RESOLVED — `concurrent_writers_stress` worker `.mjs` missing from dist.**
  Same fix commit added the worker as a tsup top-level entry
  (`concurrent-writers-stress.worker`). Verified from `dist/cli.mjs`:
  `[pass] concurrent_writers_stress — 4 workers × 50 upserts in ~80ms`.
- **RESOLVED (transient) — `data-quality-counts.test.ts` TS2307.** Was a
  mid-flight parallel-agent snapshot; the module landed and the full suite is
  green (1203 passed / 1 skipped).
- **DEFERRED to a follow-up (v1.0 known-issue) — the 6 pre-existing
  `tsc --noEmit` errors** in `auth.ts` (×1), `sync-runs.repo.ts` (×3),
  `msw-whoop-oauth.ts` (×2). These pre-date Phase 5 (present on `main`; Phase 4
  closed with them). The project's CI contract is `biome check` + `vitest run` +
  `scripts/ci-grep-gates.sh` — there is no `tsc` gate, and all three pass. The
  `sync-runs.repo.ts` trio is the substantive one: it needs a Phase-3 domain
  decision on whether the `'aborted'` run status (schema-enum widening #15/#35)
  should be surfaced by `latestFinished()` / `rowToSyncRun()` or mapped/excluded
  at those boundaries — out of scope for a doctor/docs/setup phase. Recommend a
  dedicated `/gsd-debug` or a small follow-up phase to reconcile the `'aborted'`
  type before tightening CI with a `tsc --noEmit` gate.
