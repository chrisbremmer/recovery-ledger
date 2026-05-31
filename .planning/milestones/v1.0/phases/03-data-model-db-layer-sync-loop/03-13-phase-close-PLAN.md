---
phase: 03-data-model-db-layer-sync-loop
plan: 13
type: execute
wave: 6
depends_on: ["03-01", "03-02", "03-03", "03-04", "03-05", "03-06", "03-07", "03-08", "03-09", "03-10", "03-11", "03-12"]
files_modified:
  - .planning/STATE.md
  - .planning/REQUIREMENTS.md
  - .planning/ROADMAP.md
  - .planning/phases/03-data-model-db-layer-sync-loop/03-VALIDATION.md
  - .github/workflows/ci.yml
autonomous: false
requirements: [DATA-01, DATA-02, DATA-03, DATA-04, DATA-05, DATA-06, SYNC-01, SYNC-02, SYNC-03, SYNC-04, SYNC-05, SYNC-06, SYNC-07]
tags: [phase-close, attestation, requirements-traceability, ci]
user_setup: []

must_haves:
  truths:
    - "Full test suite green: `npm run test` exits 0 with total count = STATE.md baseline + Phase 3 net delta (computed at execution time, NOT hardcoded)"
    - "Lint clean: `npm run lint` exits 0"
    - "All 7 CI grep gates green: `bash scripts/ci-grep-gates.sh` exits 0 with final line `All grep gates passed.`"
    - "Build emits 3 ESM entries (same as Phase 2 close): `npm run build` produces dist/cli.mjs + dist/mcp.mjs + dist/infrastructure/whoop/token-store.mjs"
    - "D-33 attestation: `tools/list` returns EXACTLY one tool — whoop_doctor (Phase 2 G-03 test remains green)"
    - "D-34 attestation: `git diff origin/main -- src/mcp/sanitize.ts src/mcp/register.ts` returns empty across all Phase 3 plans"
    - "AuthError FROZEN at 6 kinds attestation: anchored grep on the AUTH_ERROR_KINDS tuple region returns 6"
    - "WhoopApiError shipped at 6 kinds attestation: anchored grep on the WHOOP_API_ERROR_KINDS tuple region returns 6 (anchored to the tuple — not the formatWhoopApiError switch arms in the same file)"
    - "Pitfall E runtime attestation: Plan 03-11 partial-failure.test.ts Test 2 grep on stderr captures returns 0 Bearer / access_token matches"
    - "REQUIREMENTS.md traceability table updated: DATA-01..06 + SYNC-01..07 (13 IDs) all flipped to 'Complete (Plan 03-XX, 2026-MM-DD)'"
    - "ROADMAP.md Phase 3 entry updated: status flipped to Complete with plan-count + completion date"
    - "ROADMAP.md Phase 2 checkbox flipped to `- [x]` (stale `- [ ]` doc-only cleanup; Phase 2 IS authoritatively complete per STATE.md frontmatter `completed_phases: 2`; this is NOT a Phase 2 reopen)"
    - "STATE.md updated with Phase 3 close summary using execution-time-computed counts (NOT hardcoded 27 / 60); plan_count_delta = 13 (number of plans in Phase 3), phase_count_delta = 1"
    - "03-VALIDATION.md updated: nyquist_compliant flipped to true; per-task validation rows for all 13 REQ-IDs ✅ green (rows pre-populated during planner revision per checker Warning #11; Task 2 only flips ⬜ → ✅)"
    - ".github/workflows/ci.yml runs the new contract + integration test paths (vitest include glob already covers tests/**/*.test.ts from Plan 02-08; verify by reading the workflow + listing newly green Phase 3 directories)"
    - "Branch policy: Phase 3 PR shipped through worktree-free feature branch → PR → main; carve-out expired since `src/` is tracked"
  artifacts:
    - path: ".planning/STATE.md"
      provides: "Updated state with Phase 3 plans complete + Phase 4 next-session pointer; counts computed via formula relative to baseline"
      contains: "Phase 3 closed"
    - path: ".planning/REQUIREMENTS.md"
      provides: "Traceability table — DATA-01..06 + SYNC-01..07 flipped to Complete"
      contains: "Phase 3"
    - path: ".planning/ROADMAP.md"
      provides: "Phase 3 entry flipped to Complete with date; Phase 2 stale checkbox flipped to [x]"
      contains: "Phase 3.*Complete"
    - path: ".planning/phases/03-data-model-db-layer-sync-loop/03-VALIDATION.md"
      provides: "nyquist_compliant: true + all task rows green (rows pre-populated during planner revision)"
      contains: "nyquist_compliant: true"
  key_links:
    - from: ".planning/REQUIREMENTS.md"
      to: ".planning/phases/03-data-model-db-layer-sync-loop/03-XX-SUMMARY.md"
      via: "plan-number citation"
      pattern: "Complete \\(Plan 03-\\d{2}"
    - from: ".planning/ROADMAP.md"
      to: ".planning/STATE.md"
      via: "phase progress + next-session pointer"
      pattern: "Phase 3.*Complete"
---

<objective>
Close Phase 3: run the full-suite green check, verify all 7 CI grep gates pass, confirm the D-33 + D-34 attestations hold, lock in the AuthError FROZEN + WhoopApiError ship attestations using anchored greps, update REQUIREMENTS.md traceability (13 REQ-IDs flipped to Complete), update ROADMAP.md Phase 3 entry + flip the stale Phase 2 checkbox `- [ ]` → `- [x]` (Phase 2 is authoritatively complete per STATE.md; this is doc-only cleanup), update STATE.md with the Phase 3 close summary using execution-time-computed counts (NOT hardcoded), flip 03-VALIDATION.md `nyquist_compliant: true`, and (if needed) verify .github/workflows/ci.yml exercises the new paths.

Purpose: This is the phase-close attestation gate. Every load-bearing invariant (Gate F + Gate G runtime green, sanitize.ts + register.ts UNMODIFIED, zero new MCP tools, 6-kind AuthError + 6-kind WhoopApiError unions verified by anchored greps, Pitfall E runtime grep, idempotent re-sync, DST/tz fixture coverage) gets confirmed before the phase is marked done.

This plan has 1 checkpoint task (Task 1: full-suite verification + manual D-34 git-diff check) and 1 autonomous task (Task 2: doc updates using execution-time formulas + Phase 2 doc-cleanup flip).
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/PROJECT.md
@.planning/REQUIREMENTS.md
@.planning/ROADMAP.md
@.planning/STATE.md
@.planning/phases/03-data-model-db-layer-sync-loop/03-CONTEXT.md
@.planning/phases/03-data-model-db-layer-sync-loop/03-RESEARCH.md
@.planning/phases/03-data-model-db-layer-sync-loop/03-VALIDATION.md
@CLAUDE.md
@agent_docs/workflows/contributing.md
@.github/workflows/ci.yml
@scripts/ci-grep-gates.sh
@tsup.config.ts
@src/mcp/sanitize.ts
@src/mcp/register.ts
@src/infrastructure/whoop/errors.ts

<interfaces>
Phase-close attestation matrix:

| Attestation | Source | Verification command |
|-------------|--------|---------------------|
| Tests green | Plans 03-01..03-12 | npm run test → exits 0; final count = STATE.md baseline + Phase 3 net delta (computed at execution time) |
| Lint clean | All plans | npm run lint → exits 0 |
| Gates A-G green | Plan 03-01 + downstream | bash scripts/ci-grep-gates.sh → exits 0 |
| Build emits 3 ESM entries | Phase 2 baseline + Phase 3 no-new-entries | npm run build → ls dist/cli.mjs dist/mcp.mjs dist/infrastructure/whoop/token-store.mjs |
| D-33: tools/list count = 1 | Plan 02-08 G-03 still green | npm run test -- tests/integration/auth-concurrency.test.ts |
| D-34: sanitize.ts + register.ts UNMODIFIED | All Phase 3 plans | git diff origin/main -- src/mcp/sanitize.ts src/mcp/register.ts (empty) |
| AuthError FROZEN at 6 kinds | Plan 03-01 lock + Plan 02-01 contract | `awk '/AUTH_ERROR_KINDS = \[/,/\];/' src/infrastructure/whoop/errors.ts \| grep -cE "'(auth_missing\|auth_expired\|auth_state_mismatch\|auth_timeout\|auth_port_in_use\|refresh_failed)'"` returns 6 (anchored to the tuple region — NOT the formatAuthError switch arms in the same file) |
| WhoopApiError at 6 kinds | Plan 03-01 | `awk '/WHOOP_API_ERROR_KINDS = \[/,/\];/' src/infrastructure/whoop/errors.ts \| grep -cE "'(unauthorized\|rate_limited\|network\|validation\|server\|unknown)'"` returns 6 (anchored to the tuple region — NOT the formatWhoopApiError switch arms in the same file) |
| Pitfall E runtime | Plan 03-11 partial-failure.test.ts Test 2 | npm run test -- tests/integration/sync/partial-failure.test.ts |
| Resource modules don't bypass httpGet | Plan 03-09 | grep -rE "import.*callWithAuth" src/infrastructure/whoop/resources/ (returns 0); grep -rE "\\bfetch\\s*\\(" src/infrastructure/whoop/resources/ (returns 0) |
| 9 repositories ship | Plan 03-08 | ls src/infrastructure/db/repositories/*.repo.ts |
</interfaces>
</context>

<tasks>

<task type="checkpoint:human-verify" gate="blocking">
  <name>Task 1: Phase-close gate — full-suite + lint + gates + build + attestation grep matrix</name>
  <files>(no files modified — verification only)</files>
  <read_first>
    - All 12 prior Phase 3 plans' SUMMARY.md files (03-01-SUMMARY.md through 03-12-SUMMARY.md) — confirm each plan reports green
    - .planning/STATE.md — capture the pre-close baseline values: previous `completed_phases`, previous `completed_plans`, previous `total_plans`, previous `percent`, and the latest test count from §Performance Metrics. These are inputs to Task 2's formula-based STATE.md update.
    - CLAUDE.md §Critical Rules table + §Branch policy
    - agent_docs/workflows/contributing.md (worktree-free feature branch → PR → main; carve-out expired since src/ is tracked)
    - scripts/ci-grep-gates.sh (Gates A-G)
    - tsup.config.ts (entries from Plan 02-08)
    - tests/integration/auth-concurrency.test.ts G-03 sub-test (Plan 02-08 D-17 runtime attestation)
  </read_first>
  <what-built>
    All 12 Phase 3 plans have shipped: 7 new file roots (drizzle.config.ts, src/infrastructure/db/, src/infrastructure/whoop/{client,pagination,rate-limit,retry,resources/}, src/domain/{types,schemas,normalize,dst-tz/}, src/services/{sync/,bootstrap.ts}, src/cli/commands/sync.ts, src/formatters/sync.txt.ts, tests/{contract,integration/sync,helpers/msw-whoop-*,helpers/in-memory-db,fixtures/whoop/}) + 2 grep gates (F + G) + 2 sibling error unions (AuthError FROZEN + WhoopApiError shipped) + 13 REQ-IDs covered.
  </what-built>
  <how-to-verify>
    Run each command below from the repo root. ALL must exit 0 or produce the expected output before approving.

    **Pre-flight: Capture STATE.md baseline values for the formula-based Task 2 update.**

    Before running the verification steps, record from `.planning/STATE.md` frontmatter:
      - `previous_completed_phases` (typically 2 prior to Phase 3 close)
      - `previous_completed_plans` (typically 14 prior to Phase 3 close)
      - `previous_total_plans` (typically 14 prior to Phase 3 close; Phase 3 adds 13)
    And from `.planning/STATE.md` §Performance Metrics, record `baseline_test_count` (the latest `npm run test` count before Phase 3 started).

    Carry these into Task 2's STATE.md update as formula inputs.

    1. Full test suite green:
       `npm run test`
       - Expected: exits 0; test count `≥ baseline_test_count + Phase 3 net delta` (sum the per-plan deltas reported in 03-01-SUMMARY.md..03-12-SUMMARY.md).
       - Record the post-run total as `post_close_test_count` — gets written into STATE.md §Performance Metrics by Task 2.

    2. Lint clean:
       `npm run lint`
       - Expected: exits 0 with zero diagnostics.

    3. All 7 CI grep gates green:
       `bash scripts/ci-grep-gates.sh`
       - Expected: exits 0; final line is `All grep gates passed.`; output mentions Gates A through G or shows nothing (silent success).

    4. Build emits 3 ESM entries (no new top-level tsup entries this phase per RESEARCH.md Runtime State Inventory):
       `npm run build`
       - Then verify: `ls dist/cli.mjs dist/mcp.mjs dist/infrastructure/whoop/token-store.mjs` all 3 exist.
       - The sync orchestration and bootstrap are reachable from dist/cli.mjs via services/index.ts re-exports.

    5. D-17 / D-33 runtime attestation: tools/list count === 1:
       `npm run test -- tests/integration/auth-concurrency.test.ts`
       - Expected: G-03 sub-test passes — `tools.length === 1` (whoop_doctor only).

    6. D-18 / D-34 source attestation: sanitize.ts + register.ts UNMODIFIED across all Phase 3:
       `git diff origin/main -- src/mcp/sanitize.ts src/mcp/register.ts`
       - Expected: empty output (zero diff).

    7. AuthError FROZEN at 6 kinds — anchored grep on the AUTH_ERROR_KINDS tuple region (not the formatAuthError switch arms in the same file):
       `awk '/AUTH_ERROR_KINDS = \[/,/\];/' src/infrastructure/whoop/errors.ts | grep -cE "'(auth_missing|auth_expired|auth_state_mismatch|auth_timeout|auth_port_in_use|refresh_failed)'"`
       - Expected: returns 6 (one per literal, in the AUTH_ERROR_KINDS tuple).

    8. WhoopApiError shipped at 6 kinds — anchored grep on the WHOOP_API_ERROR_KINDS tuple region (NOT the formatWhoopApiError switch arms in the same file; the unanchored grep would also match the switch and return ≥12, hiding regressions):
       `awk '/WHOOP_API_ERROR_KINDS = \[/,/\];/' src/infrastructure/whoop/errors.ts | grep -cE "'(unauthorized|rate_limited|network|validation|server|unknown)'"`
       - Expected: returns 6 (one per literal, in the WHOOP_API_ERROR_KINDS tuple).

    9. D-22 sibling-union locked: the two unions live in the same file:
       `grep -cE "(AUTH_ERROR_KINDS|WHOOP_API_ERROR_KINDS) =" src/infrastructure/whoop/errors.ts`
       - Expected: returns 2 (one per `const ... =` declaration).

    10. D-18 runtime attestation: callWithAuth imported only in client.ts inside src/infrastructure/whoop/:
        `grep -rEc "import.*callWithAuth" src/infrastructure/whoop/`
        - Expected: returns 1 file with at least 1 match — should be src/infrastructure/whoop/client.ts only.

    11. Gate F runtime: 3 fetch( call sites in src/infrastructure/whoop/:
        `grep -rEc '\\bfetch\\s*\\(' src/infrastructure/whoop/`
        - Expected: 3 files with at least 1 match — client.ts + token-store.ts + oauth.ts. No resources/* should appear.

    12. Pitfall E runtime: Plan 03-11 partial-failure.test.ts Test 2 passes — Bearer/access_token grep returns 0 on captured stderr:
        `npm run test -- tests/integration/sync/partial-failure.test.ts`
        - Expected: all assertions including Test 2 pass.

    13. DST fixtures committed:
        `ls tests/fixtures/whoop/cycles/200-dst-spring-forward.json tests/fixtures/whoop/cycles/200-dst-fall-back.json tests/fixtures/whoop/cycles/200-tz-trip-sfo-jfk.json`
        - Expected: 3 files exist.

    14. 9 repositories ship:
        `ls src/infrastructure/db/repositories/*.repo.ts | wc -l`
        - Expected: returns 9 (matches D-01).

    15. CI integration: GitHub Actions workflow exercises the same test paths:
        Read `.github/workflows/ci.yml`. Verify the test step runs `npm run test` (not a narrow glob). Vitest's include glob is `tests/**/*.test.ts` (extended in Plan 02-08), which already covers `tests/contract/*.test.ts` + `tests/integration/sync/*.test.ts`. Confirm by inspection. If a narrow glob slipped in, FLAG and surface to the human for a CI workflow fix.

    16. Branch policy attestation: Phase 3 changes ship through a PR to main, not a direct push:
        `git log origin/main..HEAD --oneline | head -20` — show the local commits queued for the PR.
        `git config branch.$(git branch --show-current).remote` — should NOT be `origin` for `main`; the working branch is a feature branch (e.g., `feat/03-data-model-db-layer-sync-loop` or sub-branches per plan).

    Compile any deviations from these 16 checks. Present to the user. Include the captured `previous_*` baseline values and `post_close_test_count` so Task 2 can compute the formula-based STATE.md update. The user reviews the captured outputs and approves Phase 3 close OR requests re-execution of failing plans.
  </how-to-verify>
  <resume-signal>Type "approved" if all 16 checks pass AND the STATE.md baseline values + post_close_test_count are captured; otherwise describe the failing check and which plan needs revisit.</resume-signal>
</task>

<task type="auto">
  <name>Task 2: Update STATE.md + REQUIREMENTS.md + ROADMAP.md + 03-VALIDATION.md to reflect Phase 3 close (formula-based counts; flip stale Phase 2 ROADMAP checkbox)</name>
  <files>.planning/STATE.md, .planning/REQUIREMENTS.md, .planning/ROADMAP.md, .planning/phases/03-data-model-db-layer-sync-loop/03-VALIDATION.md</files>
  <read_first>
    - .planning/STATE.md (current state — read the structure: frontmatter progress + Performance Metrics table + Plan Execution History table + Accumulated Context + Open Todos + Resolved Todos + Notes + Session Continuity; capture the current `completed_phases`, `completed_plans`, `total_plans`, `percent` values as the BASELINE for the formula)
    - .planning/REQUIREMENTS.md §Traceability (line 124+ — find the 13 Phase 3 rows DATA-01..06 + SYNC-01..07 currently marked Pending; the Plan 02-08 close updates are the precedent)
    - .planning/ROADMAP.md §Phase 3 entry + §Progress table + the top-level phase checklist (note: Phase 2 may still have `- [ ]` from a stale doc-update; STATE.md is the authoritative source — Phase 2 IS complete per `completed_phases: 2`)
    - .planning/phases/03-data-model-db-layer-sync-loop/03-VALIDATION.md (already pre-populated with 13 rows during planner revision per checker Warning #11; rows are ⬜ pending and will flip to ✅ green here)
    - All 12 Phase 3 SUMMARY.md files for plan duration + file count metrics
    - Plan 02-08 SUMMARY.md (precedent for phase-close STATE.md update shape)
    - Task 1 verification outputs (captured `previous_*` baseline values, `post_close_test_count`, plan complete dates, etc.)
  </read_first>
  <action>
    Update `.planning/STATE.md` using EXECUTION-TIME FORMULAS — do not hardcode counts. Carry the `previous_*` baseline values captured in Task 1:

      - Frontmatter `progress`:
        - `total_phases: 5` (unchanged — Phase 5 cap)
        - `completed_phases: previous_completed_phases + 1` (Phase 3 closes)
        - `total_plans: previous_total_plans + 13` (Phase 3 adds 13 plans; the `13` is the count of `03-XX-PLAN.md` files in this phase's directory)
        - `completed_plans: previous_completed_plans + 13` (all 13 Phase 3 plans are complete at this point)
        - `percent: round((completed_phases / total_phases) * 100)` — computed from the formula above (typical result: 60% for 3/5)
      - `last_updated: <execution-time ISO timestamp>` set to the actual close timestamp (not hardcoded).
      - Update the leading summary paragraph: prepend a new dated entry (`**Last updated: <execution-date> — Phase 3 (data-model-db-layer-sync-loop) closed.** ...` describing the 13 plans, the new file roots, the new gates F + G, the new sibling error union, the D-33 + D-34 attestation preserved, the test count delta computed as `post_close_test_count - baseline_test_count`, and the branch policy adherence).
      - Append rows to the Performance Metrics table for each of the 12 + 1 Phase 3 plans (duration / task-count / files from each SUMMARY.md). Record `post_close_test_count` (from Task 1) as the new test-count baseline for Phase 4.
      - Append 13 rows to Plan Execution History: `| 03-01-wave0-infra | <duration> | 3 | <files> | Complete (<execution-date>) |` etc.
      - Add to Accumulated Context §Decisions: one bullet per noteworthy Phase 3 decision deviation discovered during execution. Mirror the `[Phase 02] Plan 02-XX decision:` pattern.
      - Update Current Position: `**Current Plan:** Not started`, `**Total Plans in Phase:** TBD (set by /gsd-plan-phase 4)`, `Phase: 04 (TBD — researcher/discusser to determine slug) — NOT STARTED`, status `Ready to begin Phase 4 planning`, progress `[░░░░░░░░░░] 0%`, ASCII progress bar reflects the new `completed_phases / total_phases` ratio (e.g., `[████████████░░░░░░░░] 3 / 5 phases complete` if completed_phases is 3).
      - Move the resolved Phase 3 todos to §Resolved Todos with the dated strikethrough form (per 02-08 close precedent): mark D-12 (resolved by RESEARCH §Technical Research item 1 + Plan 03-09 implementation) and any other Phase 3 follow-ups as RESOLVED.
      - Set Notes: append "Phase 3 closed (<execution-date>). AuthError FROZEN at 6 kinds; WhoopApiError shipped at 6 kinds. Gates A through G all green. Build emits 3 ESM entries (unchanged from Phase 2). D-33 + D-34 attestations preserved across all 13 Phase 3 plans. The recovery-ledger sync CLI command works end-to-end against the MSW fixture suite."
      - Set §Session Continuity → Last Session Summary: write a 1-paragraph summary mirroring the Phase 2 close shape (Plan 02-08 SUMMARY.md precedent). Cover: plan count (13), key deviations, file count, test count delta (post_close_test_count - baseline_test_count), attestations preserved, branch policy adherence.
      - Set §Next Session: point at `/gsd-context-phase 4` OR `/gsd-mvp-phase 4` (depending on whether the user prefers context-gathering vs MVP user-story re-framing for Phase 4). Note the Phase 4 dependency on Phase 3 (reviews are pure functions over the cached entities; baseline math hinges on the score_state-disciplined, DST-flagged data Phase 3 produces).
      - Append a footer line at the bottom: `*Phase 3 closed: <execution-date> (13 plans, X files, Y new tests where Y = post_close_test_count - baseline_test_count).*`

    Update `.planning/REQUIREMENTS.md`:
      - For each of DATA-01, DATA-02, DATA-03, DATA-04, DATA-05, DATA-06, SYNC-01, SYNC-02, SYNC-03, SYNC-04, SYNC-05, SYNC-06, SYNC-07 (13 rows), flip the Traceability table column from `Pending` to `Complete (Plan 03-XX, <execution-date>)`. The plan number per REQ-ID:
        - DATA-01 (WAL + pragmas at default path): Plan 03-05 (connection.ts + pragma roundtrip integration test)
        - DATA-02 (Drizzle schema for 9 tables): Plan 03-02 (schema.ts + drizzle-kit generate)
        - DATA-03 ((score_state, start) index): Plan 03-02 (schema.ts indexes)
        - DATA-04 (BEGIN IMMEDIATE migrator + pre-migration backup + fails-closed): Plan 03-05 (migrate.ts + migration-crash.test.ts)
        - DATA-05 (three-layer types + Score DU): Plan 03-03 (domain/types + schemas)
        - DATA-06 (DST/tz exclusion): Plan 03-09 (dst-tz/detect.ts) + Plan 03-11 (dst-fixture.test.ts)
        - SYNC-01 (sync --days N fetches all 6 resources): Plan 03-11 (runSync + bootstrap) + Plan 03-12 (CLI shim)
        - SYNC-02 (pagination + snake↔camel + semaphore-of-4): Plan 03-06 (pagination + rate-limit + client)
        - SYNC-03 (429 backoff honors Reset; rate-limit state reported): Plan 03-06 (retry.ts) + Plan 03-12 (formatter remediation hint)
        - SYNC-04 (idempotent via ON CONFLICT + updated_at delta + 7d re-window): Plan 03-04 (cursor.ts) + Plan 03-08 (repos) + Plan 03-11 (idempotency.test.ts)
        - SYNC-05 (partial-failure reporting + sync_runs row): Plan 03-08 (sync-runs.repo.ts) + Plan 03-11 (partial-failure.test.ts)
        - SYNC-06 (wal_checkpoint(TRUNCATE) after success): Plan 03-05 (pragma-roundtrip) + Plan 03-11 (sync index.ts)
        - SYNC-07 (fixture-based contract tests per resource; suite < 60s): Plan 03-07 (fixtures + MSW helpers) + Plan 03-10 (contract tests)
      - Update the §Coverage block: increment the `Complete:` numerator by 13 (e.g., if previously `12 / 49`, now `25 / 49` — actual numerator computed from the current REQUIREMENTS.md state, not hardcoded).
      - Update the footer: `*Last updated: <execution-date> — Phase 3 closed (13 REQ-IDs flipped to Complete).*`

    Update `.planning/ROADMAP.md`:
      - Mark Phase 3 entry `[x]` (checked) at the top-level checklist.
      - **Doc cleanup (NOT a Phase 2 reopen):** Phase 2 checkbox at the top-level checklist is currently `- [ ]` from a stale doc-update; flip it to `- [x]`. Phase 2 IS authoritatively complete per `.planning/STATE.md` frontmatter `completed_phases: 2` (closed 2026-05-12, audited 2026-05-15). This flip aligns the ROADMAP checklist with STATE.md authoritative state. Document the rationale in the commit message: "ROADMAP Phase 2 checkbox flip is doc-cleanup; Phase 2 closed 2026-05-12 per STATE.md."
      - Update §Progress table row 3: `| 3. Data Model, DB Layer & Sync Loop | 13/13 | Complete | <execution-date> |`.
      - Under §Phase 3 details, update §Plans from `TBD` to a 13-item bullet list naming each plan and its short purpose (mirror Phase 1 + 2 entries).
      - Append a `*Last updated: <execution-date> — Phase 3 (data-model-db-layer-sync-loop) complete. ${completed_plans} / ${total_plans} plans complete (formula-based; Phase 4 plan count TBD).*` line at the bottom — substitute the formula-computed numerator/denominator from the STATE.md update above.

    Update `.planning/phases/03-data-model-db-layer-sync-loop/03-VALIDATION.md`:
      - Frontmatter: `status: validated`, `nyquist_compliant: true`, `wave_0_complete: true`, `audited: <execution-date>`.
      - §Per-Task Verification Map: the 13 REQ-ID rows + 4 attestation/gate rows were pre-populated during planner revision (per checker Warning #11) with status ⬜ pending. Flip each row's Status column to `✅ green`. Update the `File Exists` column from `❌ Wave N` to `✅` for each row (the source files now exist).
      - §Wave 0 Requirements checklist: tick all 5 items.
      - §Validation Sign-Off checklist: tick all 6 items.
      - Append a footer: `*Phase 3 validated: <execution-date>. All 13 REQ-IDs covered by automated tests + CI grep gates F + G + canonical assertions in plan SUMMARY files.*`

    Commit the 4 file updates as a single commit `docs(03): close Phase 3 — 13 REQ-IDs complete, attestations preserved (ROADMAP Phase 2 checkbox flipped to align with STATE.md authoritative state)`. Optional: cite the actual Plan 03-XX SUMMARY paths for traceability.
  </action>
  <verify>
    <automated>node -e "const fs = require('fs'); const r = fs.readFileSync('.planning/REQUIREMENTS.md', 'utf8'); const matches = r.match(/(DATA-0[1-6]|SYNC-0[1-7]) \\| Phase 3 \\| Complete/g) || []; if (matches.length === 13) console.log('OK: 13 REQ-IDs flipped'); else { console.error('FAIL: only ' + matches.length + ' REQ-IDs flipped'); process.exit(1); }"</automated>
  </verify>
  <acceptance_criteria>
    - .planning/STATE.md frontmatter progress: completed_phases = previous_completed_phases + 1 (typically 3), completed_plans = previous_completed_plans + 13, total_plans = previous_total_plans + 13, percent = round((completed_phases / total_phases) * 100). All values computed via formula relative to baseline captured in Task 1 — NOT hardcoded.
    - .planning/STATE.md Plan Execution History has 13 new rows for Phase 3 plans (one per Plan 03-XX)
    - .planning/STATE.md §Performance Metrics records `post_close_test_count` as the new Phase 4 baseline
    - .planning/REQUIREMENTS.md Traceability table: 13 rows for DATA-01..06 + SYNC-01..07 marked `Complete (Plan 03-XX, <execution-date>)`
    - .planning/REQUIREMENTS.md §Coverage: `Complete:` numerator incremented by 13 from the pre-update value
    - .planning/ROADMAP.md Phase 3 entry has `[x]` checkbox
    - .planning/ROADMAP.md Phase 2 checkbox is `[x]` (doc-cleanup flip; STATE.md authoritative state was already `completed_phases: 2`)
    - .planning/ROADMAP.md §Progress table Phase 3 row: `Complete | <execution-date>`
    - .planning/phases/03-data-model-db-layer-sync-loop/03-VALIDATION.md frontmatter: nyquist_compliant: true + status: validated
    - 03-VALIDATION.md Per-Task table has 13 REQ-ID rows + 4 attestation/gate rows (pre-populated during planner revision per Warning #11), all marked ✅ green; no row left ⬜ pending
    - Single commit on the feature branch covers all 4 doc files; commit message includes the Phase 2 doc-cleanup rationale
    - bash scripts/ci-grep-gates.sh exits 0 (no source changes; should remain green)
    - Anchored grep on AUTH_ERROR_KINDS tuple region: `awk '/AUTH_ERROR_KINDS = \[/,/\];/' src/infrastructure/whoop/errors.ts | grep -cE "'(auth_missing|auth_expired|auth_state_mismatch|auth_timeout|auth_port_in_use|refresh_failed)'"` returns 6
    - Anchored grep on WHOOP_API_ERROR_KINDS tuple region: `awk '/WHOOP_API_ERROR_KINDS = \[/,/\];/' src/infrastructure/whoop/errors.ts | grep -cE "'(unauthorized|rate_limited|network|validation|server|unknown)'"` returns 6 — anchored to the tuple, NOT the formatWhoopApiError switch arms in the same file
  </acceptance_criteria>
  <done>STATE.md + REQUIREMENTS.md + ROADMAP.md + 03-VALIDATION.md updated to reflect Phase 3 close using execution-time formulas (no hardcoded counts); 13 REQ-IDs traced; D-33 + D-34 + AuthError FROZEN + WhoopApiError ship attestations recorded via anchored greps; next-session pointer set; stale ROADMAP Phase 2 checkbox aligned with STATE.md authoritative state.</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| Documentation updates → committed artifacts in .planning/ | The doc updates are the canonical record of attestation; PR review + Plan 03-13 Task 1 checkpoint verify them |
| Branch protection on main → feature-branch-only PR path | GitHub-side enforcement; the Plan 03-13 Task 1 attestation includes branch policy adherence |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-03.13-01 | Repudiation | A failing plan goes unrecorded; phase closed prematurely | mitigate | Task 1 checkpoint blocks until all 16 verification checks pass. The human-verify gate is non-bypassable per CLAUDE.md §Critical Rules + GSD framework. |
| T-03.13-02 | Tampering | STATE.md updated with wrong test count or plan count | mitigate | Task 1's automated test count check provides a source of truth; Task 2 reads it from STATE.md baseline + Task 1 captured outputs. Formula-based update means values stay correct even if STATE.md drifts between revision and execution. PR review catches any discrepancy. |
| T-03.13-03 | Tampering | REQUIREMENTS.md traceability row flipped without the corresponding Plan SUMMARY in place | mitigate | Task 2's automated `node -e ...` verify counts exactly 13 flipped rows; PR review checks plan citations. |
| T-03.13-04 | Tampering | D-34 attestation skipped — sanitize.ts or register.ts modified silently | mitigate | Task 1 step 6 runs `git diff origin/main -- src/mcp/sanitize.ts src/mcp/register.ts` and expects empty output. The blocking checkpoint catches drift. |
| T-03.13-05 | Tampering | Branch protection bypass (direct push to main) | mitigate | CLAUDE.md §Branch policy: GitHub branch protection is the load-bearing fence; PreToolUse hooks are first-line. Task 1 step 16 includes a smoke check on the current branch and queued commits. |
| T-03.13-06 | Tampering | 6-kind attestation grep returns false positive by matching the formatWhoopApiError switch arms | mitigate | Anchored awk-range grep on the tuple region only (`awk '/WHOOP_API_ERROR_KINDS = \[/,/\];/' ...`) — bounded to the tuple declaration, excludes the switch arms in the same file. Same pattern used for AUTH_ERROR_KINDS. |
</threat_model>

<verification>
- Task 1 manual checkpoint: all 16 verification checks pass; user types "approved"
- Task 2 automated grep + commit verify the 4 doc updates
- Full suite green: npm run test exits 0
- Lint clean: npm run lint exits 0
- Gates green: bash scripts/ci-grep-gates.sh exits 0
- Build emits 3 ESM entries (same as Phase 2 close)
- D-33 + D-34 + AuthError FROZEN + WhoopApiError ship attestations all preserved (anchored greps)
- Branch policy: feature branch → PR → main (no direct main push)
- STATE.md counts computed via formula (no hardcoded 27 / 60 / etc.) — correct even if STATE.md drifted between planner revision and execution
- ROADMAP Phase 2 checkbox aligned with STATE.md authoritative state (doc-cleanup, not a Phase 2 reopen)
</verification>

<success_criteria>
- Phase 3 closed cleanly: 13 plans complete, 13 REQ-IDs flipped, all 7 CI gates green
- D-33 + D-34 + AuthError FROZEN + WhoopApiError ship attestations recorded as preserved (anchored greps; not regex-fooled by the formatWhoopApiError switch arms)
- STATE.md / REQUIREMENTS.md / ROADMAP.md / 03-VALIDATION.md reflect the closed state with execution-time formulas (no hardcoded counts)
- ROADMAP Phase 2 stale checkbox flipped to `- [x]` (doc-cleanup; STATE.md authoritative state was already `completed_phases: 2`)
- Plan 03-13 Task 1 checkpoint runs the 16-step attestation matrix and captures the STATE.md baseline values + post_close_test_count as Task 2 formula inputs
- Plan 03-13 Task 2 commits the 4 doc updates as a single phase-close commit
- Next-session pointer in STATE.md directs the operator to begin Phase 4 planning (context or mvp-phase, user's call)
- Branch policy: Phase 3 ships through worktree-free feature branch → PR → main; carve-out expired
- Build emits 3 ESM entries (no new tsup entries this phase per RESEARCH.md Runtime State Inventory)
- 03-VALIDATION.md Per-Task Verification Map was pre-populated during planner revision (Warning #11); Task 2 only flips ⬜ → ✅
</success_criteria>

<output>
Create .planning/phases/03-data-model-db-layer-sync-loop/03-13-SUMMARY.md when done.
</output>
