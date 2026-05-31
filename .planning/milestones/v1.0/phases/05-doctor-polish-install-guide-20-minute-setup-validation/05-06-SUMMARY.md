---
phase: 05-doctor-polish-install-guide-20-minute-setup-validation
plan: 06
subsystem: infra
tags: [doctor, bootstrap, dependency-injection, sqlite, whoop-roundtrip, cli, mcp]

# Dependency graph
requires:
  - phase: 05-doctor-polish-install-guide-20-minute-setup-validation (Waves 0+1)
    provides: "CHECK_NAMES (14 entries), RunDoctorOptions offline/stress/sqlite fields, the 9 new probe modules with per-probe dep-injection signatures"
  - phase: 03-whoop-sync-sqlite-persistence
    provides: "bootstrap() composition root (openDb + migrator + repos), httpGet WHOOP chokepoint, refreshOrchestrator singleton"
provides:
  - "runDoctor() invoking all 14 probes via Promise.allSettled in the dependency-aware order (load -> db -> auth -> online -> recency -> quality -> stress)"
  - "RunDoctorOptions extended with repos / refreshOrchestrator / whoopFetcher (7 optional fields total)"
  - "bootstrap().services.runDoctor pre-bound to production deps (sqlite + repos + refreshOrchestrator + productionWhoopFetcher)"
  - "CLI doctor command switched from createServices() to bootstrap() so `recovery-ledger doctor` runs the full 14-check surface end-to-end (DOC-01)"
affects: [05-07, 05-08, 05-09, 05-10, phase-close]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Dep-injection seam: orchestrator (runDoctor) maps each probe to the dep it consumes; composition root (bootstrap) supplies production defaults; user opts override (test seam)"
    - "Degenerate-skip via offline gate: whoop_roundtrip degrades to 'skipped (--offline)' when refreshOrchestrator/whoopFetcher deps are absent (createServices lightweight path)"
    - "Gate-F-clean online probe: production whoopFetcher wraps httpGet (the allowlisted chokepoint), never a bare fetch"
    - "exactOptionalPropertyTypes-safe conditional spreads: omit the key (not pass {key: undefined}) so absent options hit each probe's 'no <X> injected' guard"

key-files:
  created: []
  modified:
    - "src/services/doctor/index.ts"
    - "src/services/doctor/index.test.ts"
    - "src/services/bootstrap.ts"
    - "src/services/index.ts"
    - "src/cli/commands/doctor.ts"

key-decisions:
  - "PROBE_NAMES order matches RESEARCH Finding 2 (first-fail-wins visual ordering): load -> db -> auth -> online -> recency -> quality -> stress"
  - "CLI doctor command flows through bootstrap() (choice (a) per RESEARCH Open Questions 1) so the db_* + recency probes run end-to-end, not only via MCP"
  - "whoopFetcher catch arm maps WhoopApiError.kind to a representative HTTP status (the actual error class has no numeric .status field the plan pseudocode assumed)"
  - "CLI doctor passes a silent logger to bootstrap() so routine migration info lines do not pollute stdout/stderr for machine-readable JSON consumers (doctor 2>&1 | jq)"

patterns-established:
  - "Pre-bound services wrapper: bootstrap().services.runDoctor supplies sqlite/repos/refreshOrchestrator/whoopFetcher defaults; consumers pass only the user flags"
  - "Bootstrap-plural to probe-singular repo key mapping: recoveries->recovery, sleeps->sleep at the runDoctor dep boundary"

requirements-completed: [DOC-01, DOC-02]

# Metrics
duration: 24min
completed: 2026-05-29
---

# Phase 5 Plan 05-06: Wire 14-Check Doctor Surface + Bootstrap Deps Summary

**runDoctor() extended from 5 to 14 probes with dependency-aware wiring; bootstrap() pre-binds the production sqlite handle + repos + refreshOrchestrator + a Gate-F-clean whoopFetcher; the CLI doctor command now flows through bootstrap() so `recovery-ledger doctor` renders the full 14-check surface in both --text and JSON.**

## Performance

- **Duration:** 24 min
- **Started:** 2026-05-29T00:40:55Z
- **Completed:** 2026-05-29T01:05:06Z
- **Tasks:** 3
- **Files modified:** 5

## Accomplishments
- `runDoctor()` invokes all 14 probes via `Promise.allSettled` in the documented dependency-aware order; the MR-07 fail-from-throw fallback maps `PROBE_NAMES[i]` correctly across all 14 slots.
- `RunDoctorOptions` now exposes all 7 optional fields: `skipSubprocessChecks`, `offline`, `stress`, `sqlite`, `repos`, `refreshOrchestrator`, `whoopFetcher`.
- `bootstrap().services.runDoctor` pre-binds the production deps; the `productionWhoopFetcher` routes a single GET `/v2/user/profile/basic` through `httpGet` (Gate-F-allowlisted chokepoint) with `performance.now()` timing.
- CLI `doctor` switched from `createServices()` to `bootstrap()` with a `close()` lifecycle invoked before `process.exit` on both the success and catch paths; `createServices()` remains the lightweight no-DB path.
- MCP `whoop_doctor` inherits the new 14-check behavior through its existing bootstrap() path with zero MCP edits (D-21 honored); D-29 attestation (tools=8/resources=6/prompts=4) still passes.

## Task Commits

Per the execution prompt, all work landed in ONE atomic commit (not per-task) staging the 5 plan files + this SUMMARY.

1. **Task 1: Extend runDoctor() to invoke all 14 probes with dep wiring** (TDD: RED test assertions added, then GREEN implementation)
2. **Task 2: Extend bootstrap() to pre-bind production deps + switch CLI to bootstrap()**
3. **Task 3: Smoke test the 14-check surface end-to-end via the built CLI** (verification-only)

**Single commit:** see Task Commits note — `feat(05): wire 14-check doctor surface + bootstrap deps (05-06)`

## Files Created/Modified
- `src/services/doctor/index.ts` — PROBE_NAMES 5->14; Promise.allSettled over 14 probe invocations with dep wiring; RunDoctorOptions extended with repos/refreshOrchestrator/whoopFetcher; whoop_roundtrip degenerate-offline gate.
- `src/services/doctor/index.test.ts` — 5-check assertion -> 14; new tests: 14-checks-in-order, whoop_roundtrip degrades to skipped, concurrent_writers_stress skipped by default.
- `src/services/bootstrap.ts` — productionWhoopFetcher (wraps httpGet, maps WhoopApiError.kind->status); services_runDoctor wrapper pre-binding sqlite + repos (recoveries->recovery, sleeps->sleep) + refreshOrchestrator + whoopFetcher; runDoctor field rewired to the wrapper.
- `src/services/index.ts` — documented createServices() as the lightweight no-DB/no-repos/no-fetcher path; the CLI now uses bootstrap().
- `src/cli/commands/doctor.ts` — createServices() -> bootstrap() with close() lifecycle on both write callbacks; bootstrap() moved inside try so DB/migration failures render via the MR-08 catch arm; silent logger passed so migration info lines do not corrupt machine-readable output.

## Decisions Made
- **PROBE_NAMES order** follows RESEARCH Finding 2 (load -> db -> auth -> online -> recency -> quality -> stress) for first-fail-wins UX.
- **CLI through bootstrap()** (RESEARCH Open Questions 1, choice (a)) so the db_* + recency + data-quality probes actually run from the CLI, satisfying DOC-01. `createServices()` stays the no-DB surface.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] WhoopApiError has no numeric `.status` field**
- **Found during:** Task 2 (bootstrap whoopFetcher construction)
- **Issue:** The plan pseudocode read `err.status` off a caught `WhoopApiError`, but the actual error class (`src/infrastructure/whoop/errors.ts`) carries a discriminated `kind` (`'unauthorized' | 'rate_limited' | 'server' | ...`), not a numeric `status`. tsc reported 2 new TS2339 errors.
- **Fix:** Added a `whoopErrorKindToStatus(kind)` mapper in bootstrap (`unauthorized`->401, `rate_limited`->429, `server`->500, else 0) so the probe's 200/401/other branch logic still distinguishes the auth-revoked case. A refresh that fails entirely surfaces as an `AuthError` (not a `WhoopApiError`) and falls through to status 0 -> the probe's generic 'roundtrip failed' warn arm.
- **Files modified:** src/services/bootstrap.ts
- **Verification:** `npx tsc --noEmit` back to the 6-error baseline (zero new); mcp-runtime + doctor tests green.
- **Committed in:** the single atomic plan commit.

**2. [Rule 1 - Bug] exactOptionalPropertyTypes rejected `{sqlite: opts.sqlite}` / `{repos: opts.repos}`**
- **Found during:** Task 1 (runDoctor probe wiring)
- **Issue:** Passing `{ sqlite: opts.sqlite }` where `opts.sqlite` is `Database | undefined` produced 6 new TS2379 errors under `exactOptionalPropertyTypes: true` — an explicit `undefined` value is not assignable to an optional `sqlite?` field.
- **Fix:** Build the dep objects with conditional spreads (`opts.sqlite != null ? { sqlite: opts.sqlite } : {}`, same for repos) so the key is OMITTED when the option is absent — which is exactly the "no handle injected" / "no repos injected" path each probe's guard expects.
- **Files modified:** src/services/doctor/index.ts
- **Verification:** `npx tsc --noEmit` back to baseline; the degenerate-fail behavior is exercised by the doctor index test suite (17 tests green).
- **Committed in:** the single atomic plan commit.

**3. [Rule 2 - Missing Critical] Migration info logs polluted machine-readable doctor output**
- **Found during:** Task 3 (CLI smoke test, plan verification gate `doctor --offline 2>&1 | python3 ... json.load`)
- **Issue:** Routing the CLI through `bootstrap()` (Task 2) means bootstrap's `migration_started` / `migration_finished` Pino info lines now hit stderr on every `doctor` run. The plan's verification command (and the prompt's gate 4) merge streams with `2>&1`, which interleaves the log frames into the JSON and breaks `json.load` ("Extra data: line 2").
- **Fix:** The CLI doctor command passes a silent logger (`createLogger({ LOG_LEVEL: 'silent' })`) to `bootstrap()`. Routine migration progress chatter is suppressed for a read-only diagnostic command; migration FAILURES still throw and render via the existing MR-08 catch arm, so no error is hidden. ADR-0001 stdout purity is preserved (the MCP path still uses the production logger; only the CLI doctor invocation is silenced).
- **Files modified:** src/cli/commands/doctor.ts
- **Verification:** `node dist/cli.mjs doctor --offline 2>&1 | python3 -c "...json.load..."` prints `14-check OK` (exit 0); stderr is clean during a doctor run.
- **Committed in:** the single atomic plan commit.

**4. [Rule 3 - Blocking] bootstrap() throw could escape as an unhandled rejection**
- **Found during:** Task 2 (CLI doctor lifecycle)
- **Issue:** The plan's wiring put `const { services, close } = await bootstrap();` outside the try block. `bootstrap()` can throw (DB-open / migration failure) and would then escape with no output, unlike the previous `createServices()` (which never throws).
- **Fix:** `bootstrap()` now runs INSIDE the try; `close` is declared as a no-op before the try and reassigned to the real handle-releaser after bootstrap succeeds, then called in both write callbacks. A bootstrap failure surfaces through the MR-08 fallback render.
- **Files modified:** src/cli/commands/doctor.ts
- **Verification:** build clean; tsc baseline; CLI smoke tests run end-to-end.
- **Committed in:** the single atomic plan commit.

---

**Total deviations:** 4 auto-fixed (2 blocking, 1 bug, 1 missing-critical). All within the plan's 5 declared files.
**Impact on plan:** All four were necessary for correctness (type-safety, machine-readable output integrity, error-surface integrity). No scope creep — no sibling files edited.

## Issues Encountered

### Out-of-scope findings logged to deferred-items.md (NOT fixed — sibling-plan files)

Both surfaced only once the CLI was switched to bootstrap() (so the db_* + stress probes now actually run from the built CLI). Neither blocks Plan 05-06's verification (the smoke test uses `--offline`, where stress is skipped and the 14-check surface renders correctly).

1. **`db_schema_version` ENOENT in the built CLI.** `src/services/doctor/checks/db-schema-version.ts:resolveDefaultMigrationsDir()` (Plan 05-03 file) resolves `../../../infrastructure/db/migrations` from `import.meta.url`, which is wrong for the flattened `dist/cli.mjs` bundle (climbs to `/Users/infrastructure/db/migrations`). bootstrap()'s own `resolveMigrationsDir()` already probes the correct `dist/infrastructure/db/migrations` location; the probe does not share that logic. DIST-ONLY — passes from the source tree (tsx/vitest). Fix belongs to 05-03 / phase-close. Logged to deferred-items.md.

2. **`concurrent_writers_stress` worker .mjs missing from dist.** `concurrent-writers-stress.ts:resolveWorker()` (Plan 05-05 file) looks for a `.worker.{ts,mjs}` sibling; no `.mjs` exists in dist because the worker is not a tsup top-level entry (`tsup.config.ts` emits only cli/mcp/token-store). Exactly the finding Plan 05-05's SUMMARY flagged. The `--stress` arm works from the source tree (vitest real-fork test green); only the built-CLI `--stress` path is affected. Fix requires editing `tsup.config.ts` (outside the 5 files) — per the prompt's explicit instruction, logged to deferred-items.md rather than edited.

### Flaky test (environmental, NOT introduced by this plan)

`tests/integration/mcp-stdout-purity.test.ts` (dist-smoke; spawns `dist/mcp.mjs` and validates JSON-RPC stdout purity) flaked across full-suite runs: failure count varied 0/1/3/5 between identical runs, and the test passed in 1.4s in isolation yet timed out at 123s on a contended run ("subprocess emitted no stdout frames before drain elapsed"). STATE.md (line 156) already documents this test's empirically-tuned 200ms/300ms subprocess settle timings as box-specific. The flake is a subprocess-settle timeout under CPU contention, independent of Plan 05-06: no MCP code was touched (D-21), and the test asserts on stdout only while bootstrap's logs go to stderr. The deterministic in-scope tests (`src/services/doctor` + `tests/integration/mcp-runtime.test.ts`, 88 tests) are green on every run.

## Verification Gate Results

1. **`npx tsc --noEmit`** — 6 errors, all the documented baseline; **ZERO NEW** (verified by filtering the 3 baseline files). PASS.
2. **`npm run build`** — `ESM Build success`. PASS.
3. **`npx vitest run src/services/doctor tests/integration/mcp-runtime.test.ts`** — 15 files, 88 tests, all green (D-29 tools=8/resources=6/prompts=4 intact). PASS.
4. **`node dist/cli.mjs doctor --offline 2>&1 | python3 (assert len==14 + name/status/detail)`** — `14-check OK`. PASS.
5. **`node dist/cli.mjs doctor --offline --text 2>&1 | grep -E 'whoop_roundtrip|concurrent_writers_stress'`** — both shown as pass/skipped:
   - `[pass] whoop_roundtrip — skipped (--offline)`
   - `[pass] concurrent_writers_stress — skipped — run with --stress to enable`
   PASS.
6. **`bash scripts/ci-grep-gates.sh`** — `All grep gates passed.` (exit 0). PASS.
7. **`npm test` (full suite)** — best representative tally **1186 passed / 1 failed** (the flaky subprocess dist-smoke above; see Issues). Deterministic in-scope tests 100% green.

### Smoke-test record (built CLI, this dev machine — no auth/sync done)

```
$ node dist/cli.mjs doctor --text        (real 1.49s, exit 1 / overall: fail)
[pass] better_sqlite3_load — native binding loaded
[pass] napi_keyring_load — native binding loaded
[pass] mcp_stdout_purity — JSON-RPC stream valid (3 frames)
[pass] db_open — WAL journal mode confirmed
[pass] db_integrity — PRAGMA integrity_check ok
[fail] db_schema_version — probe threw: ENOENT ... '/Users/infrastructure/db/migrations'   (deferred: 05-03 dist path bug)
[pass] db_wal_size — WAL 0KB (<32MB threshold)
[fail] auth — no tokens — run `recovery-ledger auth`
[fail] token_freshness — no tokens
[fail] whoop_roundtrip — roundtrip failed: no refresh token on disk
[fail] last_sync_recency — no syncs yet — run `recovery-ledger sync`
[fail] most_recent_scored_day — no SCORED data yet — run `recovery-ledger sync`
[pass] data_quality_counts — cycles: 0 scored, 0 pending, 0 unscorable, 0 excluded; recovery: 0 ...; sleep: 0 ...
[pass] concurrent_writers_stress — skipped — run with --stress to enable
overall: fail

$ node dist/cli.mjs doctor --offline          -> 14 checks, overall: fail, exit 1
$ node dist/cli.mjs doctor                     -> checks: 14, overall: fail, exit 1
$ node dist/cli.mjs doctor --stress --offline  (real 1.49s)
[fail] concurrent_writers_stress — probe threw: worker entry not found (build dist or run from source tree)   (deferred: 05-05 tsup worker entry)
```

The many `fail` rows are expected on a developer machine that has not run `init` / `auth` / `sync` — the smoke test verifies the surface runs end-to-end and renders 14 rows, not that every check is green. Exit code 1 maps to DOCTOR_EXIT_CODES.fail (unchanged {pass:0, warn:2, fail:1}).

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- The 14-check doctor surface is wired and rendering end-to-end via both --text and JSON; DOC-01 + DOC-02 requirements satisfied.
- Two dist-only findings (db_schema_version migrations-dir resolution in 05-03; concurrent_writers_stress worker entry in 05-05/tsup.config) are logged in deferred-items.md for the phase-close / follow-up pass. Both are dist-only and do not affect the source-tree test surface.
- The mcp-stdout-purity dist-smoke flake (pre-existing, environmental) may warrant a timing-robustness pass at phase close, independent of this plan.

---
*Phase: 05-doctor-polish-install-guide-20-minute-setup-validation*
*Completed: 2026-05-29*
