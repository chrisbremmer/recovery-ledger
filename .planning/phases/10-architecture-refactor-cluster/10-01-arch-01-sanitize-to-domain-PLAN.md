---
phase: 10-architecture-refactor-cluster
plan: 01
type: execute
wave: 1
branch: refactor/10-arch-01-sanitize-to-domain
depends_on: []
files_modified:
  - src/domain/observability/sanitize.ts
  - src/domain/observability/sanitize.test.ts
  - src/infrastructure/observability/sanitize.ts
  - src/infrastructure/observability/sanitize.test.ts
  - src/mcp/index.ts
  - src/mcp/register.ts
  - src/mcp/register-prompt.ts
  - src/mcp/register-resource.ts
  - src/cli/commands/auth.ts
  - src/cli/commands/decision-add.ts
  - src/cli/commands/decision-review.ts
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
  - src/infrastructure/whoop/oauth.ts
  - src/infrastructure/whoop/errors.test.ts
  - scripts/ci-grep-gates.sh
autonomous: true
requirements: [ARCH-01]
must_haves:
  truths:
    - "src/domain/observability/sanitize.ts exists with identical content to the old infrastructure path"
    - "src/infrastructure/observability/sanitize.ts and its test no longer exist on disk"
    - "All 23 importers point at the domain path; zero references to infrastructure/observability remain in src/ or tests/"
    - "Layering rule holds: transports and services import sanitize from domain, never from infrastructure/observability"
    - "Existing sanitize behavior unchanged: same FND-06 + SECH-01/02 redaction patterns; all existing tests pass"
  artifacts:
    - path: src/domain/observability/sanitize.ts
      provides: sanitize + serializeError-related pure string transforms
    - path: src/domain/observability/sanitize.test.ts
      provides: full existing sanitize coverage moved verbatim
    - path: scripts/ci-grep-gates.sh
      provides: new Gate H asserting no infrastructure/observability imports across src and tests
  key_links:
    - from: src/mcp/register.ts
      to: src/domain/observability/sanitize.ts
      via: import statement
      pattern: "from.*domain/observability/sanitize"
    - from: src/services/doctor/checks/auth.ts
      to: src/domain/observability/sanitize.ts
      via: import statement
      pattern: "from.*domain/observability/sanitize"
---

<objective>
Mechanical move of `sanitize.ts` (and its test) from `src/infrastructure/observability/` to `src/domain/observability/`. Rewrite all 23 importer paths. Add a CI grep gate that forbids future regressions.

Purpose: enforce the lite-hexagonal layering rule (`cli/+mcp/ → services/ → domain/ ∪ infrastructure/`). The sanitize/serializeError pair is pure string transforms with no I/O — it belongs in domain, not infrastructure. Today transports (mcp) and services (doctor checks) reach into `infrastructure/observability/` for a utility that has no infrastructure concerns; this PR ends that.

Output: `sanitize.ts` and `sanitize.test.ts` under `src/domain/observability/`; the old infrastructure copies deleted; 23 import paths rewritten; new ci-grep Gate H added; existing test suite green; new layering grep returns zero matches.

Scope: behavior-preserving refactor. Zero logic changes. PR is `refactor/10-arch-01-sanitize-to-domain`, lands on its own branch off the latest `main`, merged via GitHub PR with explicit user approval per the branch policy.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/STATE.md
@.planning/ROADMAP.md
@.planning/phases/10-architecture-refactor-cluster/10-RESEARCH.md
@agent_docs/conventions.md
@agent_docs/workflows/contributing.md
@CLAUDE.md
</context>

<tasks>

<task type="auto">
  <name>Task 1: Move sanitize source + test to domain/observability and rewrite all 23 importer paths</name>
  <files>src/domain/observability/sanitize.ts, src/domain/observability/sanitize.test.ts, src/infrastructure/observability/sanitize.ts, src/infrastructure/observability/sanitize.test.ts, src/mcp/index.ts, src/mcp/register.ts, src/mcp/register-prompt.ts, src/mcp/register-resource.ts, src/cli/commands/auth.ts, src/cli/commands/decision-add.ts, src/cli/commands/decision-review.ts, src/cli/commands/decision-update.ts, src/cli/commands/doctor.ts, src/cli/commands/init.ts, src/cli/commands/query.ts, src/cli/commands/review-daily.ts, src/cli/commands/review-weekly.ts, src/cli/commands/sync.ts, src/cli/lib/with-bootstrap.ts, src/services/doctor/checks/auth.ts, src/services/doctor/checks/data-quality-counts.ts, src/services/doctor/checks/last-sync-recency.ts, src/services/doctor/checks/most-recent-scored-day.ts, src/services/doctor/checks/token-freshness.ts, src/services/doctor/checks/whoop-roundtrip.ts, src/infrastructure/whoop/oauth.ts, src/infrastructure/whoop/errors.test.ts</files>
  <read_first>
    src/infrastructure/observability/sanitize.ts,
    src/infrastructure/observability/sanitize.test.ts,
    src/mcp/register.ts,
    src/services/doctor/checks/auth.ts,
    src/cli/lib/with-bootstrap.ts,
    .planning/phases/10-architecture-refactor-cluster/10-RESEARCH.md
  </read_first>
  <action>
Implements ARCH-01 (sanitize → domain mechanical move).

1. Create the destination directory `src/domain/observability/` and copy `src/infrastructure/observability/sanitize.ts` to `src/domain/observability/sanitize.ts` byte-for-byte. Copy `src/infrastructure/observability/sanitize.test.ts` to `src/domain/observability/sanitize.test.ts` the same way. Do not edit the content of either file — this is a pure move.

2. Inside the new `src/domain/observability/sanitize.test.ts`, update the import-under-test path so it imports from `./sanitize.js` (relative import to its co-located source). If the original test imported via a relative path (e.g. `./sanitize.js`), no change is required; if it used a package-relative path, normalize to `./sanitize.js`.

3. Delete the original files: `src/infrastructure/observability/sanitize.ts` and `src/infrastructure/observability/sanitize.test.ts`. If `src/infrastructure/observability/` is then empty, remove the directory.

4. Rewrite all 23 importer paths listed in RESEARCH.md §ARCH-01 "Current state" from `../**/infrastructure/observability/sanitize.js` to the corresponding relative path under `../**/domain/observability/sanitize.js`. Use `rg -l "infrastructure/observability/sanitize" src tests` to discover every actual hit (the research enumerates 23; verify with rg first to confirm no drift since 2026-06-03). For each file, replace only the path segment `infrastructure/observability` → `domain/observability` — do not touch the named import list or anything else on the line.

5. Run a confirming grep: `rg "infrastructure/observability" src tests` MUST return zero matches. If any remain, fix them in the same edit pass (likely a `.test.ts` file the planner did not enumerate).

6. Conventions per `agent_docs/conventions.md`: ESM-only, no default exports, TypeScript strict — none of which are at risk here because this is a path-only edit. Do not change `serializeError`-related logic (RESEARCH.md notes `serializeError` does not currently exist as a separate export in this codebase; the REQ-text mentions it forward-looking — ignore for this PR).
  </action>
  <verify>
    <automated>npm test -- src/domain/observability/sanitize.test.ts &amp;&amp; npm test -- src/services/doctor/checks/auth.test.ts &amp;&amp; npm test -- src/cli/lib/with-bootstrap.test.ts</automated>
  </verify>
  <acceptance_criteria>
    - `test -f src/domain/observability/sanitize.ts &amp;&amp; test -f src/domain/observability/sanitize.test.ts` exits 0
    - `test ! -e src/infrastructure/observability/sanitize.ts &amp;&amp; test ! -e src/infrastructure/observability/sanitize.test.ts` exits 0
    - `rg "infrastructure/observability" src tests` returns no matches (exit 1)
    - `rg -c "from.*domain/observability/sanitize" src tests | wc -l` returns at least 23 (matches the importer count)
    - `npm test -- src/domain/observability/sanitize.test.ts` passes (test moved with source)
    - `npm run lint` passes (no new Biome violations)
  </acceptance_criteria>
  <done>sanitize lives at src/domain/observability/sanitize.ts; old infrastructure copy is gone; every importer in src/ and tests/ points at the domain path; sanitize test suite passes from the new location; lint green.</done>
</task>

<task type="auto">
  <name>Task 2: Add Gate H to scripts/ci-grep-gates.sh forbidding infrastructure/observability imports + run full suite</name>
  <files>scripts/ci-grep-gates.sh</files>
  <read_first>
    scripts/ci-grep-gates.sh,
    .planning/phases/10-architecture-refactor-cluster/10-RESEARCH.md
  </read_first>
  <action>
Implements ARCH-01 CI enforcement (Wave 0 gate from RESEARCH.md §Validation Architecture).

1. Read `scripts/ci-grep-gates.sh` end to end. Identify the gate-numbering convention (gates currently labeled A through G per RESEARCH.md §"Wave 0 Gaps"). Add a new gate labeled "Gate H — sanitize lives in domain, not infrastructure" immediately after the last existing gate, following the script's existing style (same shebang assumptions, same exit-code conventions, same echo/grep idioms used by the prior gates).

2. The gate's assertion: `rg --type ts "from ['\"].*infrastructure/observability" src tests` MUST return zero matches. If any match is found, print the offending file and line, then exit with the script's standard failure code. If zero matches, print a one-line success and continue.

3. Per `agent_docs/conventions.md` §Code style on grep-gate semantic phrasing (L0005 substitution table): do NOT inline the literal substring `infrastructure/observability` in any comment that the gate would scan over. The gate scans only `src` + `tests` directories — `scripts/` is not in scope — so the literal in the gate's own grep pattern is safe. Use semantic phrasing in any documentation comment ABOVE the gate so future grep-gate audits don't trip on the script itself.

4. After edits, run the full grep-gate script locally: `bash scripts/ci-grep-gates.sh`. All existing gates (A through G) and the new Gate H must pass.

5. Run the full test suite: `npm test`. Vitest pool: 'forks' per conventions; the suite finishes under 60s. Any failure here likely reflects a missed import in Task 1 — fix in this PR, do not defer.

6. Commit the work atomically per `agent_docs/workflows/contributing.md`: `refactor(10): move sanitize to domain/observability (ARCH-01)` for Task 1's changes; `chore(10): add Gate H forbidding infra/observability imports (ARCH-01)` for this task; or combine into a single commit if the PR's commit policy prefers one squash. Open the PR with title `refactor(10): sanitize → domain/observability (ARCH-01)`.
  </action>
  <verify>
    <automated>bash scripts/ci-grep-gates.sh &amp;&amp; npm test &amp;&amp; npm run lint</automated>
  </verify>
  <acceptance_criteria>
    - `bash scripts/ci-grep-gates.sh` exits 0 with all gates (A..H) passing
    - The new Gate H section in `scripts/ci-grep-gates.sh` is visible via `grep -A 3 "Gate H" scripts/ci-grep-gates.sh`
    - `npm test` (full suite) passes; suite finishes under 60s locally
    - `npm run lint` exits 0
    - `git log -n 1 --pretty=%s` shows a `refactor(10):` or `chore(10):` commit referencing ARCH-01
  </acceptance_criteria>
  <done>Gate H added and green; full test suite green; lint green; PR opened on branch refactor/10-arch-01-sanitize-to-domain.</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| MCP tool error → stdout | Sanitizer redacts token material before any error reaches a tool result |
| CLI command error → stderr/stdout | Same redaction applies; CLI shims wrap errors through `sanitize()` |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-10-01-01 | Information Disclosure | sanitize.ts move | mitigate | Mechanical move only; content identical; existing FND-06 + SECH-01/02 patterns preserved verbatim; test suite re-runs from the new location to confirm zero regression |
| T-10-01-02 | Tampering | scripts/ci-grep-gates.sh new gate | mitigate | Gate H asserts no future regression by scanning src + tests for the forbidden import path; CI-enforced |
</threat_model>

<verification>
- All 23 importers updated; old paths removed.
- `rg "infrastructure/observability" src tests` returns no matches.
- `npm test` passes (full suite green, under 60s).
- `bash scripts/ci-grep-gates.sh` exits 0 with new Gate H.
- `npm run lint` green.
</verification>

<success_criteria>
- ARCH-01 closed: sanitize lives at `src/domain/observability/sanitize.ts`; no file in src/ or tests/ imports from `infrastructure/observability/sanitize`.
- Layering rule grep-enforceable via Gate H in CI.
- Behavior unchanged: existing sanitize.test.ts coverage passes from the new location.
- PR `refactor/10-arch-01-sanitize-to-domain` merged to main via GitHub PR with explicit user approval (branch policy).
</success_criteria>

<output>
Create `.planning/phases/10-architecture-refactor-cluster/10-01-SUMMARY.md` when done.
</output>
