---
phase: 05-doctor-polish-install-guide-20-minute-setup-validation
plan: 05
subsystem: doctor
tags: [doctor, sqlite, better-sqlite3, fork, concurrency, wal, begin-immediate, adr-0001, stress]
requires:
  - 05-01 (CHECK_NAMES.CONCURRENT_WRITERS_STRESS + RunDoctorOptions.stress + skipSubprocessChecks)
  - src/services/doctor/index.ts (DoctorCheck interface)
  - src/services/doctor/checks/mcp-stdout-purity.ts (subprocess-gate + fork precedent)
  - tests/integration/auth-concurrency.test.ts (Phase 2 D-23 fork-with-exit-code precedent)
provides:
  - probeConcurrentWritersStress async function returning Promise<DoctorCheck>
  - ConcurrentWritersStressOpts interface ({skipSubprocess?, enabled?})
  - concurrent-writers-stress.worker.ts child-process entry (BEGIN IMMEDIATE upsert loop)
affects:
  - 05-06 (will wire probeConcurrentWritersStress into runDoctor's --stress arm as PROBE_NAMES[13]; tsup must emit the worker as a top-level entry so the prod .mjs sibling exists)
tech-stack:
  added: []
  patterns:
    - subprocess-gated + flag-gated probe (two-gate cascade mirroring mcp-stdout-purity skipSubprocess + a new enabled gate)
    - parent-side WAL pre-init before forking concurrent writers (eliminates cold-start -wal/-shm file-creation race)
    - tsx-loader fork for a .ts worker on a non-built tree (execArgv ['--import','tsx']); .mjs sibling on a built dist tree
    - hermetic worker schema (own stress_test table, NOT the project migrator) — keeps the worker decoupled from src/infrastructure/db
key-files:
  created:
    - src/services/doctor/checks/concurrent-writers-stress.ts
    - src/services/doctor/checks/concurrent-writers-stress.worker.ts
    - src/services/doctor/checks/concurrent-writers-stress.test.ts
  modified:
    - .planning/phases/05-doctor-polish-install-guide-20-minute-setup-validation/deferred-items.md (logged a transient cross-agent tsc observation)
key-decisions:
  - "Worker imports better-sqlite3 directly (plan option a) rather than openDb() — the stress probe needs only a primary-key conflict path, not the project schema/migrator. Keeps the worker hermetic + decoupled."
  - "Pragma order INVERTED vs. D-30 connection.ts: busy_timeout is set BEFORE journal_mode = WAL in the worker. In a concurrent-fork scenario the WAL-mode switch itself takes a brief exclusive lock; with busy_timeout still at its 0 default a losing worker fails SQLITE_BUSY before the timeout can ride it out. (D-30 runs journal_mode first because it bootstraps a single writer.)"
  - "Parent pre-creates the DB in WAL mode + the stress_test table BEFORE forking. The first WAL connection on a fresh file must create the -wal/-shm shared-memory files; 4 workers cold-starting at once race on that file creation independent of busy_timeout. Pre-init means workers only contend on the BEGIN IMMEDIATE write lock — which is the contention the probe exists to measure."
  - "SQLITE_BUSY classification checks err.code === 'SQLITE_BUSY' AND message text ('database is locked' / 'SQLITE_BUSY') — better-sqlite3 surfaces the busy condition with the human message 'database is locked', not the literal SQLITE_BUSY token, so a message-only check mis-bucketed it into the generic worker-error (exit 2) arm."
  - "Worker resolution checks .ts first then .mjs via existsSync. On the non-built Vitest/tsx tree the .ts sibling exists, so the real-fork case RUNS (not skips); a built dist carries .mjs for prod. The test.skipIf is a robustness net, not the expected path here."
patterns-established:
  - "Two-gate probe cascade: skipSubprocess (MCP transport) short-circuits first, then enabled (--stress) — both return pass with documented 'skipped' detail strings before any fork."
  - "Concurrent-writer fork test hygiene: mkdtempSync tmp DB, parent WAL pre-init, Promise.all over per-child {exitCode, stderr} futures, rmSync cleanup in a finally block regardless of outcome."
requirements-completed: [DOC-01]
duration: ~18m
completed: 2026-05-28
---

# Phase 5 Plan 05: concurrent_writers_stress Doctor Check Summary

`probeConcurrentWritersStress` ships as the opt-in concurrent-writer-contention diagnostic (D-02 #9): `recovery-ledger doctor --stress` will fork 4 child workers that each run 50 `BEGIN IMMEDIATE` upserts against a tmp SQLite DB and asserts none escapes with `SQLITE_BUSY`. The probe is double-gated — it skips inside the MCP transport (`skipSubprocess`) and skips by default unless `--stress` (`enabled`) — so neither MCP nor a default CLI doctor run pays the fork cost. Plan 05-06 wires it into `runDoctor()`'s `--stress` arm (PROBE_NAMES last slot) and emits the worker as a tsup top-level entry.

## What Was Built

### src/services/doctor/checks/concurrent-writers-stress.worker.ts

The forked child entry point (no exports — a top-level executable module).
- Reads `dbFile = process.argv[2]` and `N = process.argv[3]`; exits 2 with a stderr message if `dbFile` is missing.
- Opens the DB via `better-sqlite3` directly, arms `busy_timeout = 5000` BEFORE `journal_mode = WAL` (order is load-bearing under fork contention — see decisions), creates a hermetic `stress_test (id INTEGER PRIMARY KEY, counter INTEGER NOT NULL)` table, then runs N `db.transaction(...).immediate()` upserts (Phase 3 D-31 BEGIN IMMEDIATE discipline) into a 10-key conflict space.
- Exit codes: `0` on success; `1` on SQLITE_BUSY (classified via `err.code` OR message text); `2` on any other error. Every failure path writes the reason to `process.stderr.write` (ADR-0001 stderr-only escape hatch — never stdout, never `console.*`).
- NEVER imports or touches `paths.dbFile` (threat T-05-T5) — works only with the argv-supplied tmp path.

### src/services/doctor/checks/concurrent-writers-stress.ts

- `interface ConcurrentWritersStressOpts { skipSubprocess?: boolean; enabled?: boolean }`.
- `async function probeConcurrentWritersStress(opts?): Promise<DoctorCheck>`. Cascade:
  - `opts.skipSubprocess === true` → `{status:'pass', detail:'skipped (running inside MCP transport)'}`.
  - `opts.enabled !== true` → `{status:'pass', detail:'skipped — run with --stress to enable'}`.
  - else → resolve the worker sibling (.ts under tsx / .mjs under dist), `mkdtempSync` a tmp DB, **pre-init the DB in WAL mode + create the table**, fork 4 workers (`{ silent: true }`, `execArgv ['--import','tsx']` for the .ts case), `Promise.all` the per-child `{exitCode, stderr}` futures, `rmSync` cleanup in a `finally`.
  - all 4 green → `pass` with `'concurrent_writers_stress completed: 4 workers × 50 upserts in <T>ms (no SQLITE_BUSY)'`.
  - any non-zero exit → `fail` with `'<W> of 4 workers failed: exit <code> (<stderr>); ...'`.
  - uncaught throw → `fail` with `'probe threw: <message>'` (tmp dir still cleaned in `finally`).
- No `console.*` (Gate B), no `process.stdout.write` (Gate C), no `drizzle-orm` (Gate G), no `fetch(` (Gate F), no default export.

### src/services/doctor/checks/concurrent-writers-stress.test.ts

3 cases under `describe('probeConcurrentWritersStress', ...)`:
1. `skipSubprocess: true` → pass + exact 'skipped (running inside MCP transport)' detail.
2. `{}` (and `{enabled:false}`) → pass + 'skipped — run with --stress to enable' detail.
3. `{enabled: true}` (real 4-worker fork, 15s timeout, `test.skipIf(!WORKER_EXISTS)`) → pass + detail contains '4 workers × 50 upserts' and '(no SQLITE_BUSY)'. On this tree the `.ts` worker exists so the case RUNS. Verified stable across 5 consecutive runs (not flaky).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 — Bug] Pragma order inverted in the worker (busy_timeout before journal_mode = WAL)**
- **Found during:** Task 2 verification (first real-fork test run — 3 of 4 workers failed "database is locked").
- **Issue:** The plan's literal worker body (lines 132-134) set `journal_mode = WAL` first, then `busy_timeout = 5000`. Under a 4-worker fork the WAL-mode switch takes a brief exclusive lock; a worker that loses that race fails SQLITE_BUSY because busy_timeout is still 0 at that moment.
- **Fix:** Set `busy_timeout = 5000` BEFORE `journal_mode = WAL` in the worker so the WAL switch itself rides out contention. (D-30's connection.ts journal-first ordering is correct for single-writer bootstrap; the multi-writer fork is the one place it has to invert.)
- **Files modified:** concurrent-writers-stress.worker.ts
- **Commit:** orchestrator commits after parallel agents return.

**2. [Rule 1 — Bug] Parent did not pre-init the DB, leaving a cold-start WAL file-creation race**
- **Found during:** Task 2 verification (after fix #1 reduced failures from 3 to 1 of 4).
- **Issue:** The first WAL connection on a fresh DB file must create the `-wal`/`-shm` shared-memory files. With 4 workers all cold-starting against a non-existent file at once, one loses that file-creation race regardless of busy_timeout — surfacing a residual SQLITE_BUSY that has nothing to do with the write contention the probe is meant to measure.
- **Fix:** The parent now opens the DB, switches it to WAL, and creates the `stress_test` table BEFORE forking. Workers then attach to an already-WAL database and only contend on the BEGIN IMMEDIATE write lock. (Added `import Database from 'better-sqlite3'` to the parent — no gate forbids it; Gate G is drizzle-only.)
- **Files modified:** concurrent-writers-stress.ts
- **Commit:** orchestrator commits after parallel agents return.

**3. [Rule 1 — Bug] SQLITE_BUSY mis-classified (message-only check)**
- **Found during:** Task 2 verification (failures reported as exit 2 "worker error" rather than exit 1 SQLITE_BUSY).
- **Issue:** better-sqlite3 surfaces the busy condition with message `"database is locked"` (and `code: 'SQLITE_BUSY'` on the error object), not the literal `SQLITE_BUSY` token. The plan's `message.includes('SQLITE_BUSY')` check therefore bucketed real busy errors into the generic exit-2 arm.
- **Fix:** Classify via `err.code === 'SQLITE_BUSY'` OR message contains `'SQLITE_BUSY'`/`'database is locked'`. Robust regardless of which surface carries the signal.
- **Files modified:** concurrent-writers-stress.worker.ts
- **Commit:** orchestrator commits after parallel agents return.

_Note: deviations 1-3 were each discovered and fixed within the Task 2 verification loop (3 total fix attempts, all on Task 2, all resolved). After the fixes the suite is green and stable._

## Out-of-Scope Discoveries (logged, NOT fixed)

- A transient `npx tsc --noEmit` snapshot during parallel Wave 1 execution reported `data-quality-counts.test.ts(13,68) TS2307: Cannot find module './data-quality-counts.js'` — a Plan 05-04 file whose module had not yet landed at that instant. A later snapshot was clean. Not introduced by Plan 05-05; logged to deferred-items.md. Resolution is owned by Plan 05-04 / phase-close convergence.

## Verification Gates (final state)

1. `npx tsc --noEmit` — ZERO new errors in the 3 plan files; the only errors are the documented 6-error baseline (src/cli/commands/auth.ts ×1, src/infrastructure/db/repositories/sync-runs.repo.ts ×3, tests/helpers/msw-whoop-oauth.ts ×2). Confirmed via `npx tsc --noEmit | grep concurrent-writers-stress` → no matches.
2. `npx vitest run src/services/doctor/checks/concurrent-writers-stress.test.ts` — 3 passed (3). Stable across 5 consecutive runs.
3. `bash scripts/ci-grep-gates.sh` — exit 0 ("All grep gates passed").

## ADR / Threat Compliance

- **ADR-0001 (MCP stdout purity):** no `console.*`, no `process.stdout.write` in either source file. The worker uses `process.stderr.write` only (Gate C permits stderr; bans stdout outside src/cli/commands/).
- **ADR-0006 (fixture-only tests):** no WHOOP I/O — pure local-SQLite contention probe.
- **T-05-T5 (tampering):** worker never imports `paths`; operates solely on the argv tmp path.
- **T-05-D3 (DoS):** the 4-fork cost is gated behind `--stress` (enabled) AND never runs from MCP (skipSubprocess).

## Notes for Plan 05-06 (wiring)

- Wire `probeConcurrentWritersStress({ skipSubprocess: opts.skipSubprocessChecks === true, enabled: opts.stress === true })` into `runDoctor()` and append `CHECK_NAMES.CONCURRENT_WRITERS_STRESS` to `PROBE_NAMES`.
- For the PRODUCTION (built) path, `tsup` must emit `concurrent-writers-stress.worker.ts` as a TOP-LEVEL entry so a `concurrent-writers-stress.worker.mjs` sibling exists under `dist/services/doctor/checks/`. Today tsup inlines doctor checks into `dist/cli.mjs`/`dist/mcp.mjs`; the worker needs its own emitted file for the production fork to resolve (the `.ts`/`.mjs` resolver already handles both, but the `.mjs` must be produced). Until then the probe falls back gracefully: it returns `fail` with 'worker entry not found' rather than crashing.

## Self-Check: PASSED

- FOUND: src/services/doctor/checks/concurrent-writers-stress.ts
- FOUND: src/services/doctor/checks/concurrent-writers-stress.worker.ts
- FOUND: src/services/doctor/checks/concurrent-writers-stress.test.ts
- Commits: N/A — per orchestrator instructions the files are left UNSTAGED/UNCOMMITTED; the orchestrator commits after all parallel Wave 1 agents return.
