---
phase: 05-doctor-polish-install-guide-20-minute-setup-validation
plan: 07
subsystem: docs
tags: [markdown-generator, parity-contract, vitest, tsx, api-gap, doc-gen, drift-prevention]

# Dependency graph
requires:
  - phase: 04-mcp-tool-surface
    provides: "API_GAP_ENTRIES frozen const (D-28) at src/services/api-gap/data.ts — the single source of truth the generator renders"
  - phase: 05-01
    provides: "docs/install/ directory scaffold (.gitkeep from Wave 0)"
provides:
  - "Pure renderApiGapMarkdown(entries) function — deterministic, idempotent, one-trailing-newline markdown renderer"
  - "scripts/generate-api-gap-md.ts CLI wrapper that writes docs/install/api-gap.md"
  - "docs/install/api-gap.md — committed generated output, 6 H2 sections (one per API_GAP_ENTRIES entry)"
  - "tests/contract/api-gap-md-parity.test.ts — byte-parity forcing function in the default npm test suite"
  - "docs:generate-api-gap npm script"
affects: [install-guide, doc-03, future-api-gap-catalog-edits]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Build-time doc generator: pure render fn factored out of CLI wrapper so the parity test imports it directly (no tsx subprocess) per RESEARCH §Open Questions §5(b)"
    - "Parity contract test as drift forcing function: committed artifact must equal render(source) byte-for-byte; failure message points at the regen command"

key-files:
  created:
    - "scripts/generate-api-gap-md.ts"
    - "scripts/generate-api-gap-md.test.ts"
    - "docs/install/api-gap.md"
    - "tests/contract/api-gap-md-parity.test.ts"
  modified:
    - "package.json"
    - "vitest.config.ts"

key-decisions:
  - "Factored renderApiGapMarkdown as a pure exported fn; CLI write guarded behind import.meta.url === pathToFileURL(process.argv[1]) so importing the module has no side effect (D-17)"
  - "Generator imports API_GAP_ENTRIES directly (NOT services.getApiGap) — build-time tool, no async/composition needed"
  - "No prebuild hook (D-19) — the parity contract test in the default suite is the forcing function"
  - "Added scripts/**/*.test.ts to vitest.config.ts include glob (deviation, Rule 3) so the plan's verify command discovers the test AND it runs in npm test"

patterns-established:
  - "Pattern: source-of-truth TS const -> pure render fn -> committed markdown artifact + parity contract test (reusable for any future generated doc)"
  - "Pattern: scripts/ build tools are outside grep Gate B/C scope (both scan src/ only) so process.stdout.write is permitted there without a gate edit"

requirements-completed: [DOC-03]

# Metrics
duration: ~12min
completed: 2026-05-29
---

# Phase 5 Plan 05-07: API-Gap Markdown Generator + Parity Contract Test Summary

**Build-time `renderApiGapMarkdown` pure function + tsx CLI wrapper that emits `docs/install/api-gap.md` from the D-28 `API_GAP_ENTRIES` source-of-truth, plus a byte-parity contract test that fails CI if the markdown drifts from the TS source.**

## Performance

- **Duration:** ~12 min
- **Started:** 2026-05-29T11:38:00Z (approx)
- **Completed:** 2026-05-29T11:41:00Z (approx)
- **Tasks:** 3
- **Files modified:** 6 (4 created, 2 modified)

## Accomplishments
- Pure, deterministic, idempotent `renderApiGapMarkdown(entries)` renderer factored so the parity test imports it directly (no `tsx` subprocess) — RESEARCH §Open Questions §5(b).
- CLI wrapper writes `docs/install/api-gap.md` (DO-NOT-HAND-EDIT header, 6 H2 sections, `None.` fallback for null alternatives, exactly one trailing newline).
- Generated and verified `docs/install/api-gap.md` (untracked — orchestrator commits for the wave); regeneration is byte-identical (idempotent, hash-confirmed).
- Parity contract test (`tests/contract/api-gap-md-parity.test.ts`) runs in the default `npm test` suite as the drift forcing function with an actionable failure message.
- `docs:generate-api-gap` npm script wired to tsx; no `prebuild` hook (D-19).

## Task Commits

Commits are DEFERRED to the orchestrator: this plan ran as one of two parallel Wave 2 docs agents, and the orchestrator commits all Wave 2 docs work after both agents return. All files below are left UNSTAGED / UNCOMMITTED per the execution brief.

1. **Task 1: Generator pure fn + CLI wrapper + unit tests** - (uncommitted) — `scripts/generate-api-gap-md.ts`, `scripts/generate-api-gap-md.test.ts`
2. **Task 2: Generate + (orchestrator) commit api-gap.md + parity test** - (uncommitted) — `docs/install/api-gap.md`, `tests/contract/api-gap-md-parity.test.ts`
3. **Task 3: docs:generate-api-gap npm script** - (uncommitted) — `package.json`

_TDD note: Tasks 1 and 2 were marked tdd="true"; the source (render fn) and its tests/contract are the GREEN+test artifacts. Because commits are deferred to the orchestrator, the test/feat commit split is not reflected in git here — the work is staged as files only._

## Files Created/Modified
- `scripts/generate-api-gap-md.ts` - Pure `renderApiGapMarkdown(entries)` renderer + `import.meta.url`-guarded CLI wrapper that writes `docs/install/api-gap.md`.
- `scripts/generate-api-gap-md.test.ts` - 5 unit cases: determinism, exactly-one-trailing-newline, H2 count == entry count, every feature name present, `None.` fallback for null `alternative_via_v2`.
- `docs/install/api-gap.md` - Generated output: header + 6 feature sections; byte-identical to `renderApiGapMarkdown(API_GAP_ENTRIES)`.
- `tests/contract/api-gap-md-parity.test.ts` - Imports the render fn + `API_GAP_ENTRIES`, diffs against the committed file; actionable failure message names `npm run docs:generate-api-gap`.
- `package.json` - Added `"docs:generate-api-gap": "tsx scripts/generate-api-gap-md.ts"` (alphabetical slot: after `dev:*`, before `test`).
- `vitest.config.ts` - Added `scripts/**/*.test.ts` to the `include` glob (deviation — see below).

## Decisions Made
- Render fn emits `**Available via v2 API:** No.` as a static label (every entry is by definition unavailable; the literal `available_via_v2_api: false` type lock makes this safe).
- Trailing newline normalized via `.replace(/\n+$/, '') + '\n'` so the per-entry trailing blank line cannot produce a double newline at EOF — the load-bearing idempotency invariant.
- Generator imports `API_GAP_ENTRIES` directly from `data.ts` (build-time tool; skips the `services.getApiGap()` async wrapper) per D-17.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Added `scripts/**/*.test.ts` to vitest.config.ts include glob**
- **Found during:** Task 1 (unit-test verification)
- **Issue:** The plan's verify command `npx vitest run scripts/generate-api-gap-md.test.ts` returned "No test files found". Vitest 4 intersects a positional file filter with the config `include` glob rather than overriding it, and the config `include` was `['src/**/*.test.ts', 'tests/**/*.test.ts']` — `scripts/` was not covered. Vitest 4 also removed the `--include` CLI flag, so there was no command-line-only workaround.
- **Fix:** Added `'scripts/**/*.test.ts'` to the `include` array in `vitest.config.ts` with an explanatory comment. This makes the planned verify command work as written AND brings the pure-fn unit test into the default `npm test` suite (the test is pure + offline, so it belongs there). The alternative — moving the test into `tests/` — would have violated the plan's named artifact path (`files_modified` lists `scripts/generate-api-gap-md.test.ts` verbatim), so the include-glob change is the minimal, lower-risk fix.
- **Files modified:** `vitest.config.ts`
- **Verification:** `npx vitest run scripts/generate-api-gap-md.test.ts` -> 5 passed. Full `npm test` -> 113 files / 1200 tests passed (zero regressions).
- **Committed in:** (deferred to orchestrator)

---

**Total deviations:** 1 auto-fixed (1 blocking config fix)
**Impact on plan:** The fix is additive and necessary to make the planned verification gate runnable. It strictly widens test coverage (the build-tool unit tests now run in the default suite). No scope creep; `vitest.config.ts` was not in `files_modified` but Rule 3 (build config error blocking task completion) authorizes the change.

## Gate / Verification Results (final)
- `npx tsc --noEmit`: exactly the 6 known baseline errors (auth.ts x1, sync-runs.repo.ts x3, msw-whoop-oauth.ts x2). ZERO new errors.
- `npx vitest run scripts/generate-api-gap-md.test.ts tests/contract/api-gap-md-parity.test.ts`: 6 passed (2 files).
- `npm test` (full default suite): 113 files / 1200 tests passed.
- `bash scripts/ci-grep-gates.sh`: all 10 gates pass (Gate A tone-words clean on the new markdown; Gate B/C confirmed to scan `src/` only, so `scripts/` `process.stdout.write` needed no gate edit).
- Idempotency: `docs/install/api-gap.md` regenerated twice -> identical SHA (`7252b3a7...`).
- Surface: `grep -c '^## ' docs/install/api-gap.md` == 6 == `API_GAP_ENTRIES.length`; file ends with exactly one `\n`.

## Issues Encountered
- Working tree at finish shows files from the sibling Wave 2 docs agent (`README.md`, `INSTALL.md`, `docs/install/{claude-code,claude-desktop,cursor,launchd,whoop-app}.md`, `templates/com.recovery-ledger.daily-sync.plist`). These are NOT part of this plan and were left untouched. Only the 6 files listed above belong to Plan 05-07.

## Known Stubs
None. The generated markdown lists every `API_GAP_ENTRIES` entry with its WHOOP app path, availability, closest v2 alternative, and notes — no placeholder content.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- DOC-03 satisfied: `docs/install/api-gap.md` exists and is drift-protected. The install guide can link it.
- Drift forcing function is live in the default suite — any future edit to `src/services/api-gap/data.ts` without regenerating will fail CI.
- ACTION FOR ORCHESTRATOR: commit the 6 Plan-05-07 files (`scripts/generate-api-gap-md.ts`, `scripts/generate-api-gap-md.test.ts`, `docs/install/api-gap.md`, `tests/contract/api-gap-md-parity.test.ts`, `package.json`, `vitest.config.ts`) and run the STATE.md / ROADMAP.md / REQUIREMENTS.md updates for this wave.

## Self-Check: PASSED

All claimed artifacts verified on disk:
- `scripts/generate-api-gap-md.ts` — FOUND
- `scripts/generate-api-gap-md.test.ts` — FOUND
- `docs/install/api-gap.md` — FOUND
- `tests/contract/api-gap-md-parity.test.ts` — FOUND
- `package.json` `docs:generate-api-gap` script — FOUND
- `vitest.config.ts` `scripts/**/*.test.ts` include — FOUND
- `05-07-SUMMARY.md` — FOUND

Commit verification N/A — commits deferred to the orchestrator (parallel Wave 2 docs agents commit collectively after both return).

---
*Phase: 05-doctor-polish-install-guide-20-minute-setup-validation*
*Completed: 2026-05-29*
