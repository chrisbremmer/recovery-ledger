---
phase: 01-foundation-stdout-pure-mcp-bootstrap
plan: 06
type: execute
wave: 4
depends_on:
  - 01
  - 02
  - 03
  - 04
  - 05
files_modified:
  - test/integration/mcp-stdout-purity.test.ts
  - .github/workflows/ci.yml
autonomous: true
requirements:
  - FND-01
  - FND-02
  - FND-03
  - FND-04
  - FND-05
  - FND-06
  - FND-07
requirements_addressed:
  - FND-01
  - FND-02
  - FND-03
  - FND-04
  - FND-05
  - FND-06
  - FND-07
tags:
  - integration
  - ci
  - dist-smoke
  - stdout-purity
must_haves:
  truths:
    - "A single integration test spawns `node dist/mcp.mjs`, drives the four-fixture JSON-RPC sequence, and asserts every stdout line is valid JSON-RPC (D-02b)"
    - "The same test asserts the response to `tools/call whoop_doctor` contains no `Bearer`, no `Authorization`, and no JWT-shaped substring (D-10 integration assertion)"
    - "The test doubles as the dist smoke required by ROADMAP Phase 1 success criterion 5 (D-03)"
    - "GitHub Actions CI runs `npm ci → lint → build → test → grep gates` on macOS-latest (D-12) and exits 0 on the clean tree"
    - "All seven FND-* requirements are exercised by at least one automated step in CI"
  artifacts:
    - path: "test/integration/mcp-stdout-purity.test.ts"
      provides: "The load-bearing subprocess round-trip test — D-02b + D-03 + D-10 integration"
      contains: "spawn(process.execPath, ['dist/mcp.mjs']"
    - path: ".github/workflows/ci.yml"
      provides: "macOS-latest GitHub Actions workflow — D-12"
      contains: "macos-latest"
  key_links:
    - from: ".github/workflows/ci.yml"
      to: "scripts/ci-grep-gates.sh"
      via: "single workflow step `bash scripts/ci-grep-gates.sh`"
      pattern: "bash scripts/ci-grep-gates\\.sh"
    - from: "test/integration/mcp-stdout-purity.test.ts"
      to: "dist/mcp.mjs"
      via: "spawn(process.execPath, ['dist/mcp.mjs'])"
      pattern: "spawn\\(process\\.execPath,\\s*\\[['\"]dist/mcp\\.mjs"
    - from: "test/integration/mcp-stdout-purity.test.ts"
      to: "test/fixtures/mcp/*.json"
      via: "readFile per fixture written to child stdin"
      pattern: "readFile\\(.+fixtures/mcp"
    - from: "test/integration/mcp-stdout-purity.test.ts"
      to: "src/services/doctor/checks/mcp-stdout-purity.ts"
      via: "test can import the same probe to avoid duplicate driver logic"
      pattern: "from.+services/doctor/checks/mcp-stdout-purity"
---

<objective>
Close the phase. Land the integration test that spawns the built `dist/mcp.mjs` as a subprocess, drives the four-fixture JSON-RPC handshake, and proves that (a) every byte on stdout is valid JSON-RPC and (b) no sanitized error leaks `Bearer`/`Authorization`/JWT-shaped strings. Wire `npm ci → lint → build → test → grep gates` into a macOS-latest GitHub Actions workflow.

Purpose: This is the load-bearing test for FND-04 (stdout purity under fixture load) and FND-06 (sanitizer integration with the real tool call) AND the dist smoke required by ROADMAP Phase 1 success criterion 5 (D-03 — one test, two assertions). It also closes FND-01 (the CI proves the bootstrap is real, not just paper) and FND-02/FND-03/FND-07 (the workflow runs `npm run build` against the bin entries and the doctor service).

Output: Two files: one integration test, one CI workflow. After this plan, every later phase inherits a green CI gate as a precondition.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/PROJECT.md
@.planning/ROADMAP.md
@.planning/STATE.md
@.planning/REQUIREMENTS.md
@.planning/research/STACK.md
@.planning/research/PITFALLS.md
@.planning/phases/01-foundation-stdout-pure-mcp-bootstrap/01-CONTEXT.md
@.planning/phases/01-foundation-stdout-pure-mcp-bootstrap/01-RESEARCH.md
@.planning/phases/01-foundation-stdout-pure-mcp-bootstrap/01-VALIDATION.md
@CLAUDE.md
@package.json
@tsup.config.ts
@vitest.config.ts
@src/mcp/index.ts
@src/services/doctor/checks/mcp-stdout-purity.ts
@scripts/ci-grep-gates.sh
@test/fixtures/mcp/initialize.json

<interfaces>
<!-- Subprocess driver pattern from RESEARCH §Pattern 5(b) lines 531-579. -->
import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
// child = spawn(process.execPath, ['dist/mcp.mjs'], { stdio: ['pipe', 'pipe', 'pipe'], env: { NODE_ENV: 'production', ... } });
// for each fixture: child.stdin.write(json.trim() + '\n'); await sleep(100);
// after: child.stdin.end(); await close event; collect stdout/stderr; assert.

<!-- Per Pitfall 7 — also assert the tools/call response has `.result` (not `.error`)
     so a protocol mismatch fails loudly instead of silently passing on JSON-RPC validity alone. -->

<!-- The probeMcpStdoutPurity() function from Plan 05's
     src/services/doctor/checks/mcp-stdout-purity.ts SHOULD share logic with this test.
     Two acceptable paths:
       (a) Probe returns the parsed stdout lines + diagnostic, test asserts on them.
       (b) Test imports a small shared helper (e.g., `driveFixtures(execPath, distPath, fixturesDir)`)
           used by both. Pick whichever ends up cleaner; the contract is "no duplicate driver." -->
</interfaces>
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: Create test/integration/mcp-stdout-purity.test.ts — D-02b + D-03 + D-10 integration</name>
  <files>test/integration/mcp-stdout-purity.test.ts</files>
  <read_first>
    - .planning/phases/01-foundation-stdout-pure-mcp-bootstrap/01-RESEARCH.md (Pattern 5(b) lines 531-579 — subprocess driver verbatim; Pitfall 7 — protocol mismatch; JSON-RPC fixture content lines 587-605)
    - .planning/phases/01-foundation-stdout-pure-mcp-bootstrap/01-CONTEXT.md (D-02 — two complementary checks; D-03 — dist smoke; D-10 — integration sanitizer assertion)
    - .planning/phases/01-foundation-stdout-pure-mcp-bootstrap/01-VALIDATION.md (stdout-purity-subprocess + sanitizer-integration rows)
    - src/services/doctor/checks/mcp-stdout-purity.ts (Plan 05 — share logic where possible per D-05)
    - src/mcp/index.ts (Plan 03 — the server this test spawns)
    - src/mcp/sanitize.ts (Plan 03 — patterns this test asserts are honored)
    - test/fixtures/mcp/{initialize,initialized,tools-list,whoop-doctor-call}.json (Plan 05 fixtures)
    - vitest.config.ts (pool: 'forks', testTimeout: 10_000 — subprocess spawn budget)
    - CLAUDE.md §Testing (60s suite budget; no live WHOOP — this test has none)
  </read_first>
  <behavior>
    - Test 1 (D-02b — JSON-RPC purity): every non-empty line on the child's stdout parses as JSON AND has `jsonrpc === '2.0'`.
    - Test 2 (D-03 — dist smoke): the test depends on `dist/mcp.mjs` existing; if missing, fail with a clear message pointing the developer at `npm run build`.
    - Test 3 (D-10 — sanitizer integration): the `whoop_doctor` response on stdout does not match `/Bearer\s/`, `/Authorization:/i`, or `/eyJ[A-Za-z0-9_-]{4,}\./`.
    - Test 4 (Pitfall 7 — protocol mismatch loud failure): the `tools/call` response (id: 3) has a `result` property (not `error`); a protocol mismatch surfaces as a clear assertion failure, not a silent pass.
    - Test 5 (stderr diagnostic, not asserted): stderr is captured and logged via the test reporter only — assertions never run on stderr per D-02.
    - Test 6 (graceful close): `child.stdin.end()` followed by `close` event yields exit code ≤ 0 (graceful or signal-terminated; never a crash code).
  </behavior>
  <action>
    Create `test/integration/mcp-stdout-purity.test.ts` as a Vitest spec at the path `test/integration/` (per RESEARCH §Recommended Project Structure lines 322-323). Use `import { spawn } from 'node:child_process'; import { readFile } from 'node:fs/promises'; import { describe, expect, test } from 'vitest';`. **Lift the body verbatim from RESEARCH §Pattern 5(b) lines 533-578** with the following augmentations: (1) **Pre-flight check** — before `spawn`, verify `dist/mcp.mjs` exists via `await access('dist/mcp.mjs')` and fail with `expect.fail('dist/mcp.mjs missing — run `npm run build` first')` if absent. (2) **Per Pitfall 7** — after parsing stdout lines into JSON-RPC frames, find the response with `id === 3` (the `tools/call` for `whoop_doctor`) and `expect(toolCallResponse).toHaveProperty('result')` AND `expect(toolCallResponse).not.toHaveProperty('error')` (or assert the response result's `content[0].text` is a string). (3) The three sanitizer-absence assertions per D-10 integration: `expect(stdout).not.toMatch(/Bearer\s/); expect(stdout).not.toMatch(/Authorization:/i); expect(stdout).not.toMatch(/eyJ[A-Za-z0-9_-]{4,}\./);`. (4) The test wraps EVERYTHING in a single `test('dist/mcp.mjs stdout contains only valid JSON-RPC, with sanitized tool responses', async () => { ... })` so a single failure surfaces the most diagnostic context. Per CLAUDE.md §Testing, the suite budget is 60s; this test should complete in ~1-2s (four 100ms sleeps + spawn overhead). Per RESEARCH Open Question 3, this plan does NOT add a `globalSetup` to auto-build — CI runs `build` before `test` explicitly. The pre-flight check in (1) handles local developers who forgot.
  </action>
  <verify>
    <automated>npm run build && npm run test -- test/integration/mcp-stdout-purity.test.ts --reporter=basic && echo OK</automated>
  </verify>
  <done>
    `test/integration/mcp-stdout-purity.test.ts` exists. After `npm run build`, `npm run test -- test/integration/mcp-stdout-purity.test.ts` exits 0 with the assertions covering: every stdout line is valid JSON-RPC; tools/call response has a result (not error); no Bearer/Authorization/JWT in stdout; child process closes gracefully.
  </done>
  <acceptance_criteria>
    - Source: `test/integration/mcp-stdout-purity.test.ts` contains `spawn(process.execPath, ['dist/mcp.mjs']`.
    - Source: contains all four fixture names: `'initialize'`, `'initialized'`, `'tools-list'`, `'whoop-doctor-call'`.
    - Source: contains `JSON.parse(line)` AND `'jsonrpc'` AND `'2.0'`.
    - Source: contains `not.toMatch(/Bearer` AND `not.toMatch(/Authorization` AND `not.toMatch(/eyJ`.
    - Source: contains a check for the `tools/call` response having `'result'` (or NOT having `'error'`) — Pitfall 7 mitigation.
    - Source: contains a pre-flight check that `dist/mcp.mjs` exists OR a clear `expect.fail` message referencing `npm run build`.
    - Source: contains `env: { ...process.env, NODE_ENV: 'production' }` (per RESEARCH Pattern 5(b)).
    - Behavior: `npm run build && npm run test -- test/integration/mcp-stdout-purity.test.ts` exits 0.
    - Behavior: the test takes < 5 seconds (within CLAUDE.md 60s suite budget).
    - Behavior: `npm run test` (full suite) still exits 0 — this integration test does not break unit-test isolation.
  </acceptance_criteria>
</task>

<task type="auto">
  <name>Task 2: Create .github/workflows/ci.yml — macOS-latest, Node 22, single job per D-12</name>
  <files>.github/workflows/ci.yml</files>
  <read_first>
    - .planning/phases/01-foundation-stdout-pure-mcp-bootstrap/01-RESEARCH.md (CI workflow §`.github/workflows/ci.yml` lines 963-1004 — base template; Pitfall 10 — grep gate exit semantics already handled by scripts/ci-grep-gates.sh)
    - .planning/phases/01-foundation-stdout-pure-mcp-bootstrap/01-CONTEXT.md (D-12 — macOS-latest GitHub Actions; CI runs `npm ci → lint → build → test → grep gates`)
    - .planning/phases/01-foundation-stdout-pure-mcp-bootstrap/01-VALIDATION.md (ci-green-required row)
    - scripts/ci-grep-gates.sh (Plan 04 — the single bash entry point for all three gates)
    - package.json (scripts: `build`, `lint`, `test`)
    - .nvmrc (Node 22)
  </read_first>
  <action>
    Create `.github/workflows/ci.yml`. Single workflow named `CI`, triggers on `push` and `pull_request`. Single job `ci` with `runs-on: macos-latest` (per D-12). Steps in this exact order: (1) `actions/checkout@v4`; (2) `actions/setup-node@v4` with `node-version: '22'` and `cache: 'npm'`; (3) `npm ci`; (4) `npm run lint`; (5) `npm run build`; (6) `npm run test`; (7) `bash scripts/ci-grep-gates.sh` (the single line that runs all three D-04+D-09 gates). **Important:** the order MATTERS — `build` MUST precede `test` because the integration test in Task 1 reads `dist/mcp.mjs` (per RESEARCH Pattern 5(b) caveat lines 583-584 + Pitfall 7). Do NOT use a matrix. Do NOT add Linux or Windows runners — deferred per CONTEXT.md (Linux fallback lands in Phase 2; Windows is permanently out of scope per REQUIREMENTS.md). Do NOT add an MCP Inspector smoke step — deferred per CONTEXT.md. Per RESEARCH lines 962-1004, the base template already exists; this task can either lift it verbatim and simplify the three inline grep blocks into one `bash scripts/ci-grep-gates.sh` step, OR keep the three inline blocks for direct readability in PR diffs. **Recommendation: use the single `bash scripts/ci-grep-gates.sh` step** — it keeps the workflow short, lets developers run gates locally, and makes future gate additions a one-file change instead of a workflow edit. Add concurrency control `concurrency: { group: 'ci-${{ github.ref }}', cancel-in-progress: true }` so push spam doesn't queue redundant runs.
  </action>
  <verify>
    <automated>test -f .github/workflows/ci.yml && grep -q "runs-on: macos-latest" .github/workflows/ci.yml && grep -q "node-version: '22'" .github/workflows/ci.yml && grep -q "npm ci" .github/workflows/ci.yml && grep -q "npm run lint" .github/workflows/ci.yml && grep -q "npm run build" .github/workflows/ci.yml && grep -q "npm run test" .github/workflows/ci.yml && grep -q "bash scripts/ci-grep-gates.sh" .github/workflows/ci.yml && python3 -c "import yaml,sys; yaml.safe_load(open('.github/workflows/ci.yml'))" 2>/dev/null && echo OK</automated>
  </verify>
  <done>
    `.github/workflows/ci.yml` is committed; it parses as valid YAML; lists exactly one job on `macos-latest` Node 22; steps run in the order `npm ci → lint → build → test → bash scripts/ci-grep-gates.sh`; no matrix; no Linux/Windows runners; no MCP Inspector step.
  </done>
  <acceptance_criteria>
    - Source: `.github/workflows/ci.yml` contains `runs-on: macos-latest`.
    - Source: contains `node-version: '22'` (NOT a different major version).
    - Source: contains `cache: 'npm'` for setup-node@v4.
    - Source: contains the six commands in order: `npm ci`, `npm run lint`, `npm run build`, `npm run test`, `bash scripts/ci-grep-gates.sh` (build BEFORE test — Pitfall 7 / Pattern 5(b) caveat).
    - Source: does NOT contain `ubuntu-latest`, `windows-latest`, or a `matrix:` block (per CONTEXT.md deferred).
    - Source: does NOT contain `inspector` (per CONTEXT.md deferred).
    - Source: contains `concurrency:` block with `cancel-in-progress: true`.
    - Behavior: `python3 -c "import yaml; yaml.safe_load(open('.github/workflows/ci.yml'))"` exits 0 (valid YAML).
    - Behavior (post-merge): the first GitHub Actions run on `main` after this plan lands shows `conclusion: success` — verifiable via `gh run list --limit 1 --json conclusion --jq '.[0].conclusion'` (per VALIDATION.md ci-green-required row).
  </acceptance_criteria>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| MCP client → stdio | JSON-RPC frames cross from an untrusted client (Claude Desktop, Claude Code, Cursor) into the server over stdin; non-JSON-RPC bytes on stdout corrupt the protocol in the reverse direction. |
| Tool handler → tool result | Untrusted error messages, cause chains, and external library failures cross from the handler boundary back to the MCP wire; D-07/D-08 sanitization is the load-bearing control. |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-MCP-STDOUT-01 | Information Disclosure / Denial of Service | `src/mcp/`, `src/services/`, `src/infrastructure/`, `src/formatters/` | mitigate | Three layers per CLAUDE.md §Critical Rules: Biome `noConsole` rule globally enabled (D-04); `scripts/ci-grep-gates.sh` Gates 1+2 in this plan's CI workflow (Plan 04 created the script, Plan 06 wires it); `test/integration/mcp-stdout-purity.test.ts` subprocess round-trip in this plan asserts every byte on `dist/mcp.mjs` stdout parses as JSON-RPC under fixture load. |
| T-MCP-SANITIZE-01 | Information Disclosure | `src/mcp/sanitize.ts`, `src/mcp/register.ts` | mitigate | Four-pattern regex catalog (D-07) + Error.cause walker with WeakSet cycle protection and depth-8 limit (D-08) created in Plan 03; unit-tested against D-10 fixture set in Plan 04; integration-tested in this plan via three `not.toMatch` assertions on the `whoop_doctor` tool call response stdout. Plan 04's Gate 3 (`server.registerTool` outside `src/mcp/register.ts` is banned) keeps every future tool inside the sanitizer wrapper (D-09). |
| T-MCP-INLINE-IGNORE-01 | Defense Bypass | any `src/` file | mitigate | Plan 04's `scripts/ci-grep-gates.sh` Gate 1 fails on any `biome-ignore.*noConsole` match (D-04). |
| T-NATIVE-ABI-01 | Tampering (integrity, by ABI drift not malice) | `better-sqlite3`, `@napi-rs/keyring` | mitigate | Plan 05's `probeBetterSqlite3` and `probeKeyring` checks open `:memory:` / construct `Entry` to verify the `.node` binary loads under the current ABI; CI runs the doctor implicitly via the `whoop_doctor` tool call inside this plan's integration test (Pitfall 2). |
| T-CI-DRIFT-01 | Tampering (integrity, by silent dependency drift) | `package-lock.json` | accept (Phase 1) | Lockfile is committed; CI uses `npm ci` (strict lockfile mode); version bumps require a new ADR per CONTEXT.md. Deeper supply-chain controls (provenance, OIDC publish) are Phase 5+ concerns. |
| T-WHOOP-WRITE-01 | Tampering against WHOOP | n/a | accept | Per CLAUDE.md §Critical Rules and PROJECT.md Key Decision #4, the codebase is read-only with respect to WHOOP; Phase 1 ships no WHOOP code at all. No surface to mitigate. |
</threat_model>

<verification>
1. `npm run build` produces `dist/cli.mjs` and `dist/mcp.mjs` with shebangs.
2. `npm run lint` exits 0.
3. `npm run test` exits 0 (all four prior plans' tests plus this plan's integration test all green).
4. `bash scripts/ci-grep-gates.sh` exits 0.
5. The integration test takes < 5 seconds (well within the 60-second suite budget per CLAUDE.md §Testing).
6. `.github/workflows/ci.yml` parses as valid YAML and the order of steps is `npm ci → lint → build → test → grep gates`.
7. After the plan lands on `main`, the first GitHub Actions run reports `conclusion: success`.
8. Every FND-* requirement has at least one CI-enforced assertion:
   - FND-01: `npm ci && npm run build` (the build artefacts exist).
   - FND-02: `dist/cli.mjs` builds with shebang (verified in Plan 05's acceptance; CI re-runs).
   - FND-03: subprocess test successfully completes the MCP `initialize` handshake (this plan's Task 1).
   - FND-04: subprocess test asserts JSON-RPC purity on stdout (this plan's Task 1) PLUS Plan 02's logger unit test.
   - FND-05: `npm run lint` + `bash scripts/ci-grep-gates.sh` Gates 1+2 (Plans 01+04+06).
   - FND-06: Plan 04's `sanitize.test.ts` unit AND this plan's integration sanitizer assertion AND Gate 3.
   - FND-07: Plan 05's `native-modules.test.ts` AND this plan's integration test exercising `whoop_doctor` (which calls all three doctor checks transitively).
</verification>

<success_criteria>
- `test/integration/mcp-stdout-purity.test.ts` exists, runs in < 5s, and passes all six assertions (JSON-RPC purity, dist exists, sanitizer integration, tools/call has result, stderr captured-not-asserted, graceful close).
- `.github/workflows/ci.yml` exists with the exact step ordering from D-12, single macOS-latest job, no matrix, no deferred extras.
- The first GitHub Actions run on `main` after this plan lands is green (verifiable via `gh run list --limit 1 --json conclusion --jq '.[0].conclusion'`).
- All seven FND-* requirements are exercised by at least one CI step (per the verification table above).
- The Phase 1 success criteria from ROADMAP.md are ALL satisfied:
  1. `npx recovery-ledger` + `npx recovery-ledger-mcp` launch from bin entries with shebangs intact, report version banner (CLI to stdout via `node dist/cli.mjs --version`; MCP via `initialize` response).
  2. CI fixture round-trip against the MCP stdio server confirms stdout is only JSON-RPC.
  3. Lint + CI grep gates fail the build on `console.*` outside `src/cli/` and on non-JSON-RPC stdout writes.
  4. Sanitizer strips `Authorization` headers and JWT-shaped strings, verified by the D-10 fixture set in unit tests AND the integration assertion.
  5. Stub `doctor` reports `better-sqlite3` and `@napi-rs/keyring` load status; build runs against compiled `dist/` (not `tsx`) at least once in CI (the integration test spawns `dist/mcp.mjs`).
</success_criteria>

<output>
After completion, create `.planning/phases/01-foundation-stdout-pure-mcp-bootstrap/01-06-SUMMARY.md` documenting: the first GitHub Actions run URL + status, the negotiated `protocolVersion` (A2 resolution if not yet documented), the actual integration test runtime, and any reordering required if `npm run build` failed before `npm run test` on the first CI attempt.
</output>
