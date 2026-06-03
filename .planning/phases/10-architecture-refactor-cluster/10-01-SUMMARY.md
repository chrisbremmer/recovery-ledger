---
phase: 10-architecture-refactor-cluster
plan: 01
subsystem: infra
tags: [refactor, layering, hexagonal, observability, sanitize, ci-grep-gates]

# Dependency graph
requires:
  - phase: 01-foundation
    provides: sanitize / serializeError pair (FND-06)
  - phase: 02-auth
    provides: SECH-01 / SECH-02 camelCase + error-path coverage on sanitize
  - phase: 03-sync
    provides: D-34 attestation that sanitize.ts is UNMODIFIED across phases
  - phase: 04-mcp-surface
    provides: registerResource / registerPrompt chokepoints (gates I + J) which Gate K mirrors stylistically
provides:
  - src/domain/observability/sanitize.ts in the canonical domain location
  - Gate K (ci-grep) forbidding any future import via the legacy infrastructure path
  - Layering rule grep-enforceable: transports + services + infrastructure all reach domain for sanitize, never the other way around
affects: [10-02-arch-02, 10-03-arch-03, 10-04-arch-04, 10-05-arch-05]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - Lite hexagonal layering enforced for pure string transforms (sanitize lives in domain, not infrastructure)
    - CI grep gate as anti-regression for a completed mechanical refactor

key-files:
  created:
    - src/domain/observability/sanitize.ts
    - src/domain/observability/sanitize.test.ts
  modified:
    - scripts/ci-grep-gates.sh
    - src/mcp/index.ts
    - src/mcp/register.ts
    - src/mcp/register-prompt.ts
    - src/mcp/register-resource.ts
    - src/cli/commands/auth.ts
    - src/cli/commands/decision-add.ts
    - src/cli/commands/decision-update.ts
    - src/cli/commands/doctor.ts
    - src/cli/commands/init.ts
    - src/cli/commands/query.ts
    - src/cli/commands/review-daily.ts
    - src/cli/commands/review-weekly.ts
    - src/cli/commands/sync.ts
    - src/cli/lib/with-bootstrap.ts
    - src/services/doctor/checks/auth.ts
    - src/services/doctor/checks/data-quality-counts.ts
    - src/services/doctor/checks/last-sync-recency.ts
    - src/services/doctor/checks/most-recent-scored-day.ts
    - src/services/doctor/checks/token-freshness.ts
    - src/services/doctor/checks/whoop-roundtrip.ts
    - src/services/sync/index.ts
    - src/infrastructure/whoop/errors.ts
    - src/infrastructure/whoop/errors.test.ts
    - src/infrastructure/whoop/oauth.ts
    - tests/integration/mcp-stdout-purity.test.ts
    - tests/integration/sync/partial-failure.test.ts

key-decisions:
  - "Named the new ci-grep gate Gate K, not Gate H — gates A through J already existed in scripts/ci-grep-gates.sh (the plan was authored against an older numbering)."
  - "Updated the stale-dist watch list in tests/integration/mcp-stdout-purity.test.ts to point at the new sanitize path (was hard-coded to the old infrastructure location and ENOENT'd at test time)."
  - "Used semantic phrasing in the Gate K comment header per L0005 (the gate's own grep pattern naturally has to reference the legacy literal path; scripts/ is intentionally not in the gate's scan scope so this is safe)."

patterns-established:
  - "Pure string transforms with no I/O belong in src/domain/, not src/infrastructure/, regardless of historical placement."
  - "When a completed refactor has a non-trivial regression surface, add a ci-grep gate as the anti-regression net (Gate K mirrors Gates D/I/J in style)."

requirements-completed: [ARCH-01]

# Metrics
duration: ~25 min
completed: 2026-06-03
---

# Phase 10 Plan 01: sanitize → domain/observability (ARCH-01) Summary

**Mechanical move of the sanitize + serializeError pair from `src/infrastructure/observability/` to `src/domain/observability/`, with 21 importer rewrites + a new ci-grep Gate K to forbid future regressions.**

## Performance

- **Duration:** ~25 min
- **Started:** 2026-06-03T14:45:00Z (approx)
- **Completed:** 2026-06-03T14:55:00Z (approx)
- **Tasks:** 2
- **Files modified:** 28 (Task 1: 27 files + the move itself; Task 2: 1 script + this summary)

## Accomplishments

- `sanitize.ts` and `sanitize.test.ts` now live at `src/domain/observability/` (byte-identical content; git tracked both as 100% renames).
- Every importer in `src/` and `tests/` points at the new domain path. `rg "infrastructure/observability" src tests` returns zero matches.
- Layering inversion closed: transports (`src/mcp/`) and services (`src/services/doctor/checks/`) no longer reach into infrastructure for a utility with no infrastructure concerns.
- `scripts/ci-grep-gates.sh` Gate K added, scanning `src/` + `tests/` for the legacy import path; verified to trip on a temporarily-injected regression and to pass cleanly on the current tree.
- Full test suite green: 1360 / 1361 pass, 1 skipped, 0 failures, 9.41s (well under the 60s budget).

## Task Commits

1. **Task 1: move sanitize + rewrite 21 importer paths** — `46d0af0` (`refactor`)
2. **Task 2: add Gate K + this SUMMARY** — committed alongside this file (`chore`)

## Files Created/Modified

### Created
- `src/domain/observability/sanitize.ts` — moved verbatim from infrastructure (100% rename per git)
- `src/domain/observability/sanitize.test.ts` — moved verbatim (test already imported via `./sanitize.js`, no edit needed)
- `.planning/phases/10-architecture-refactor-cluster/10-01-SUMMARY.md` — this file

### Modified — import path rewrites (21)
- `src/mcp/index.ts`, `src/mcp/register.ts`, `src/mcp/register-prompt.ts`, `src/mcp/register-resource.ts`
- `src/cli/commands/{auth,decision-add,decision-update,doctor,init,query,review-daily,review-weekly,sync}.ts`
- `src/cli/lib/with-bootstrap.ts`
- `src/services/doctor/checks/{auth,data-quality-counts,last-sync-recency,most-recent-scored-day,token-freshness,whoop-roundtrip}.ts`
- `src/infrastructure/whoop/oauth.ts` (was a sibling-relative `../observability/sanitize.js` — rewrote to `../../domain/observability/sanitize.js`)
- `src/infrastructure/whoop/errors.test.ts`

### Modified — comment-only refs (5)
- `src/services/doctor/checks/auth.ts` — closed the deferred-work comment with a "Phase 10 ARCH-01 closed it" note
- `src/services/sync/index.ts`
- `src/infrastructure/whoop/errors.ts`
- `src/infrastructure/whoop/errors.test.ts` (two locations)
- `tests/integration/sync/partial-failure.test.ts`
- `src/infrastructure/whoop/oauth.ts` (rewrote the stale "deferred refactor" comment)

### Modified — test-infrastructure fix (1)
- `tests/integration/mcp-stdout-purity.test.ts` — line 99 hardcoded the old `src/infrastructure/observability/sanitize.ts` path in its stale-dist watch list; updated to the new domain location.

### Modified — ci enforcement (1)
- `scripts/ci-grep-gates.sh` — Gate K added (anti-regression for the move).

### Deleted
- `src/infrastructure/observability/` — now empty, directory removed.

## Decisions Made

- **Gate K, not Gate H** — the plan called for a "Gate H," but `scripts/ci-grep-gates.sh` already had gates A–J (the plan was authored against an earlier numbering). Used the next free letter to avoid colliding with the existing Phase 4 `tools.length === 1` gate.
- **Used semantic phrasing in Gate K's prose comments per L0005**, even though L0005's substitution table does not yet list an entry for `infrastructure/observability`. The header comment talks about "the redaction module" and "the legacy infrastructure observability path" rather than inlining the grep literal; the gate's actual grep pattern necessarily contains the literal, which is safe because scripts/ is not in the gate's scan scope.
- **Closed the PLAN-03-CROSS-LAYER comment refs** by name. Two files (`src/services/doctor/checks/auth.ts` and `src/infrastructure/whoop/oauth.ts`) had comments noting the cross-layer dependency as deferred work; updated those to note that Phase 10 ARCH-01 has closed the deferral.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 — Blocking] Hardcoded old sanitize path in `tests/integration/mcp-stdout-purity.test.ts` watch list**
- **Found during:** Task 1 verify (full test suite run)
- **Issue:** Line 99 listed `src/infrastructure/observability/sanitize.ts` in the stale-dist mtime check. After the move, `stat()` threw ENOENT on every test invocation, failing the test for a reason unrelated to logic.
- **Fix:** Rewrote the path to `src/domain/observability/sanitize.ts`.
- **Files modified:** `tests/integration/mcp-stdout-purity.test.ts`
- **Verification:** Full test suite then passed 1360 / 1361 (1 skipped).
- **Committed in:** `46d0af0` (Task 1 commit).

**2. [Rule 3 — Blocking] `src/infrastructure/whoop/oauth.ts` used sibling-relative `../observability/sanitize.js`**
- **Found during:** Task 1 verify (first test run after the bulk sed pass)
- **Issue:** The initial `rg -l "infrastructure/observability/sanitize"` enumeration missed this importer because it used a sibling-relative path, not the literal `infrastructure/observability` substring. Five test files immediately failed with `ERR_MODULE_NOT_FOUND` chained through `oauth.ts`.
- **Fix:** Rewrote to `from '../../domain/observability/sanitize.js'`. Also updated the file's preamble comment that documented the cross-layer concern as deferred work — it is now closed.
- **Files modified:** `src/infrastructure/whoop/oauth.ts`
- **Verification:** Failing test count dropped from 15 to 1 (the test-infra issue above), then to 0 after fix #1.
- **Committed in:** `46d0af0` (Task 1 commit).

**3. [Rule 3 — Blocking] Biome `organizeImports` rule re-sorted 11 files after the rewrites**
- **Found during:** `npm run lint` after the bulk sed pass.
- **Issue:** Moving `infrastructure/observability/sanitize` (alphabetically late) to `domain/observability/sanitize` (alphabetically early) shifted those import lines relative to their neighbors. Biome flagged 11 files with safe `assist/source/organizeImports` fixes.
- **Fix:** Ran `npm run format` (which is `biome check --write`). All 11 fixes applied; lint now clean.
- **Files modified:** import-order normalization across the 11 flagged files.
- **Verification:** `npm run lint` exits 0.
- **Committed in:** `46d0af0` (Task 1 commit).

**4. [Naming deviation — gate letter clash] Plan said "Gate H," script already had H–J**
- **Found during:** Task 2 read-first review of `scripts/ci-grep-gates.sh`.
- **Issue:** Gate H is already in use (`tools.length === 1` anti-regression, Phase 4 D-33). Gates I and J are also in use (resource/prompt registration chokepoints, Phase 4 D-36). The plan's planner was working from an older mental model of the script.
- **Fix:** Named the new gate **Gate K** (next free letter). Updated the script's top-of-file rule count from "ten rules (A-J)" to "eleven rules (A-K)." All other style + structure conventions of the existing gates (echo idioms, exit-code semantics, tmp-file pattern, test-file exclusions where relevant) preserved.
- **Files modified:** `scripts/ci-grep-gates.sh`.
- **Verification:** Negative-test confirmed Gate K trips on a fake regression (exit 1, prints the offending file + line) and passes cleanly on the actual tree.
- **Committed in:** Task 2 commit (this commit).

**5. [Planner undercount] Plan said 23 importers; live count is 21**
- **Found during:** Task 1 verify (`rg -l "from.*domain/observability/sanitize" src tests | wc -l`).
- **Issue:** The plan listed `src/cli/commands/decision-review.ts` in `files_modified`, but that file does not import sanitize (only `decision-add.ts` and `decision-update.ts` do). The plan's count was off by 2.
- **Fix:** None required — the load-bearing acceptance criterion is `rg "infrastructure/observability" src tests` returning zero matches, which it does. The "at least 23" criterion was a planner estimate; documented here for traceability.
- **Files modified:** none.
- **Verification:** Zero matches for the old path; 21 actual importers (plus the test file's self-import) all pointing at the new path.

---

**Total deviations:** 5 (3 Rule 3 blocking fixes, 1 naming deviation, 1 planner-count clarification)
**Impact on plan:** All deviations were either mechanical fallout from the move (which the plan anticipated under Task 1 step 5: "if any remain, fix them in the same edit pass") or documentation/naming clarifications. No scope creep, no logic changes, behavior preserved verbatim.

## Issues Encountered

None beyond the deviations above. The move itself was clean (git rendered both file moves as 100% renames).

## Acceptance Criteria Checklist

### Task 1
- [x] `test -f src/domain/observability/sanitize.ts && test -f src/domain/observability/sanitize.test.ts` → 0
- [x] `test ! -e src/infrastructure/observability/sanitize.ts && test ! -e src/infrastructure/observability/sanitize.test.ts` → 0
- [x] `rg "infrastructure/observability" src tests` → no matches (exit 1)
- [x] `rg -c "from.*domain/observability/sanitize" src tests` → 21 importer files (plan estimated 23; see deviation #5)
- [x] `npm test -- src/domain/observability/sanitize.test.ts` → 188 tests pass
- [x] `npm run lint` → green

### Task 2
- [x] `bash scripts/ci-grep-gates.sh` → exits 0; all gates A–K pass
- [x] `grep -A 3 "Gate K" scripts/ci-grep-gates.sh` → header + body visible
- [x] `npm test` (full suite) → 1360 / 1361 pass, 1 skipped, 0 failures, 9.41s
- [x] `npm run lint` → exits 0
- [x] `git log -n 1 --pretty=%s` → shows a `refactor(10):` or `chore(10):` commit referencing ARCH-01

### Plan-level success criteria
- [x] ARCH-01 closed: sanitize lives at `src/domain/observability/sanitize.ts`; no file in `src/` or `tests/` imports from `infrastructure/observability/sanitize`.
- [x] Layering rule grep-enforceable via Gate K (named K because H–J were taken).
- [x] Behavior unchanged: 188 sanitize tests pass verbatim from the new location; full suite green.
- [ ] PR `refactor/10-arch-01-sanitize-to-domain` merged to main via GitHub PR with explicit user approval — the user gates this step; PR URL filled in below after `gh pr create`.

## ADRs Touched

- **ADR-0001 (MCP stdout purity)** — touched only via import-path rewrites in `src/mcp/*.ts`. No `console.*`, no direct stdout writes, no new framing concerns introduced. The redaction module the wrapper in `src/mcp/register.ts` consumes is the same module, byte-identical, at a new path.
- **ADR-0005 (banned tone words)** — SUMMARY.md and the upcoming PR body checked against the banned-word list; clean.
- **ADR-0006 (fixture-only tests)** — no live HTTP introduced; suite remains MSW + fixtures. Test count went from 1320 (pre-move snapshot in this session) to 1360 — the delta is integration tests that were already there but only ran in the full-suite invocation; no new live calls.

## Next Phase Readiness

- ARCH-01 closed. Plans 10-02 through 10-05 (the remaining four architecture-refactor plans in this cluster) can proceed.
- Gate K is in place and load-bearing — future plans that touch sanitize must continue to import from the domain path.
- The PLAN-03-CROSS-LAYER comment refs in `src/services/doctor/checks/auth.ts` and `src/infrastructure/whoop/oauth.ts` are now closed (re-worded to point at the relocated module).

## Pull Request

Branch: `refactor/10-arch-01-sanitize-to-domain`
PR URL: https://github.com/chrisbremmer/recovery-ledger/pull/124

---

## Self-Check: PASSED

- SUMMARY.md exists at the declared path.
- `src/domain/observability/sanitize.ts` and `sanitize.test.ts` both exist at the new path.
- `src/infrastructure/observability/` directory is gone.
- Task 1 commit `46d0af0` exists in `git log --all`.
- Gate K body visible in `scripts/ci-grep-gates.sh`.
- SUMMARY.md scanned for banned tone words and emoji per ADR-0005 — clean.

---
*Phase: 10-architecture-refactor-cluster*
*Plan: 01*
*Completed: 2026-06-03*
