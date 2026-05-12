---
phase: 02-oauth-token-store-single-flight-refresh
plan: 08
type: execute
wave: 6
depends_on: ['02-02', '02-03', '02-04', '02-05', '02-06']
files_modified:
  - tests/integration/auth-concurrency.test.ts
  - tests/integration/helpers/child-get-token.mjs
  - .github/workflows/ci.yml
  - tsup.config.ts
autonomous: true
requirements:
  - AUTH-05
  - AUTH-06
user_setup: []

note: "D-17 satisfied: this phase ships ZERO new MCP tools. Verified by `grep -rEn 'server\\.registerTool' src/mcp/` returning the SAME set of registrations as the Phase 1 baseline (only `whoop_doctor`). The test G-03 in this plan drives that existing Phase 1 tool against a Phase-2 expired-token state — it does not exercise a new tool surface."

must_haves:
  truths:
    - "D-24: The cross-process integration test is the load-bearing assertion for AUTH-05 and ROADMAP §Phase 2 success criterion #2; unit tests give fast feedback, integration runs per phase in CI."
    - "10 child processes (mix of CLI and MCP-style) each call tokenStore.getValidAccessToken() in parallel against a shared real-HTTP mock server in the parent, and the parent observes EXACTLY ONE POST to /oauth/oauth2/token."
    - "All 10 children read the same fresh access_token from disk after the refresh — proper-lockfile gated the cross-process refresh window."
    - "After the integration test runs, a `grep -rE 'Bearer\\s+[A-Za-z0-9._/+=-]{10,}|eyJ[A-Za-z0-9._-]{20,}|Authorization:'` of (captured stderr) + (.recovery-ledger log directory if it exists) + (any MCP error returns produced during the test) returns ZERO matches — Phase 2 success criterion #4."
    - "tokens.json.lock exists during the refresh window (proper-lockfile artifact); after the test completes the lock release ran and tokens.json.tmp does NOT exist."
    - "GitHub Actions CI matrix now runs both `macos-latest` AND `ubuntu-latest`; the ubuntu-latest row sets RECOVERY_LEDGER_FORCE_FILE_STORE=1 (D-25) so the file-fallback path is CI-enforced."
    - "Phase 2 build configuration emits `dist/infrastructure/whoop/token-store.mjs` as an explicit tsup entry (added per checker WARNING PLAN-08-BUILD-DEP). The integration-test Wave-0 task verifies the path before forking children."
    - "D-17 satisfied (see plan-level note): Phase 2 ships ZERO new MCP tools; the only MCP-surfaced tool is the unchanged Phase 1 `whoop_doctor`. Test G-03 drives that tool against a Phase-2 auth-error state — does not require a new register.ts wiring."
  artifacts:
    - path: "tests/integration/auth-concurrency.test.ts"
      provides: "Cross-process AUTH-05 integration test — 10 children, real HTTP mock, exactly-one-POST assertion + grep -v Bearer assertion. Includes a Wave-0 build-verification task that checks dist/infrastructure/whoop/token-store.mjs exists."
      contains: "10 parallel"
    - path: "tests/integration/helpers/child-get-token.mjs"
      provides: "Tiny Node script spawned as child — imports tokenStore, calls getValidAccessToken, prints the access token + storage-mode to stdout, exits."
      contains: "getValidAccessToken"
    - path: ".github/workflows/ci.yml"
      provides: "CI matrix expanded to macos-latest + ubuntu-latest; ubuntu row sets RECOVERY_LEDGER_FORCE_FILE_STORE=1."
      contains: "ubuntu-latest"
    - path: "tsup.config.ts"
      provides: "Build configuration extended with `src/infrastructure/whoop/token-store.ts` as an explicit entry so the integration test can import the compiled .mjs (checker WARNING PLAN-08-BUILD-DEP fix)."
      contains: "infrastructure/whoop/token-store"
  key_links:
    - from: "tests/integration/auth-concurrency.test.ts"
      to: "tests/integration/helpers/child-get-token.mjs"
      via: "child_process.fork or spawn — parent launches 10 instances with a shared RECOVERY_LEDGER_HOME tmpdir and WHOOP_TOKEN_URL pointing at the parent's mock server"
      pattern: "fork|spawn"
    - from: "tests/integration/auth-concurrency.test.ts"
      to: "src/infrastructure/whoop/token-store.ts (via child)"
      via: "child imports the production tokenStore singleton (compiled to dist/infrastructure/whoop/token-store.mjs); the parent counts hits on /oauth/oauth2/token"
      pattern: "tokenStore"
    - from: "tests/integration/auth-concurrency.test.ts (Wave-0 build verification task)"
      to: "tsup.config.ts + dist/infrastructure/whoop/token-store.mjs"
      via: "before running the concurrency test, verify `test -f dist/infrastructure/whoop/token-store.mjs` exits 0; if not, tsup.config.ts is mis-configured. Added per checker WARNING PLAN-08-BUILD-DEP."
      pattern: "tsup.config.ts"
    - from: ".github/workflows/ci.yml"
      to: "ubuntu-latest matrix row"
      via: "matrix.os = [macos-latest, ubuntu-latest]; matrix.os == 'ubuntu-latest' sets env RECOVERY_LEDGER_FORCE_FILE_STORE=1"
      pattern: "matrix"
---

<objective>
The load-bearing AUTH-05 cross-process integration test plus the AUTH-06 end-to-end `grep -v Bearer` assertion across captured stderr + log directory + MCP error returns. Plus the CI matrix expansion to ubuntu-latest with the file-fallback path enforced. Plus a build-dependency verification task (per checker WARNING PLAN-08-BUILD-DEP) that ensures `dist/infrastructure/whoop/token-store.mjs` exists before the child-process fork runs — if tsup's default entry config doesn't emit that path, extend tsup.config.ts to include it as an explicit entry.

Purpose: This is the test the Phase 2 ROADMAP success criterion #2 references ("concurrent-load test injecting 10 parallel 401 responses across CLI + MCP processes... exactly one WHOOP refresh request is issued"). D-24 names it as load-bearing for AUTH-05. Phase 2 success criterion #4 (`grep -v Bearer` across all surfaces) lands here.

Per checker WARNING D-COV-17-18 fix: this plan attests to D-17 (no new MCP tools) via the plan-level note. Phase 2 leaves the registerTool surface unchanged at the single `whoop_doctor` tool from Phase 1.

Output: One integration test file + one child helper script + ci.yml matrix expansion + tsup.config.ts entry addition. No production-code changes to src/.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/PROJECT.md
@.planning/REQUIREMENTS.md
@.planning/ROADMAP.md
@.planning/phases/02-oauth-token-store-single-flight-refresh/02-CONTEXT.md
@.planning/phases/02-oauth-token-store-single-flight-refresh/02-RESEARCH.md
@.planning/phases/02-oauth-token-store-single-flight-refresh/02-PATTERNS.md
@CLAUDE.md
@agent_docs/conventions.md
@agent_docs/decisions/0002-single-flight-oauth-refresh.md
@agent_docs/decisions/0006-fixture-only-tests.md
@.github/workflows/ci.yml
@src/services/doctor/checks/mcp-stdout-purity.ts
@src/services/doctor/checks/mcp-stdout-purity.test.ts
@src/infrastructure/whoop/token-store.ts
@tsup.config.ts

<interfaces>
<!-- The integration test stands ONE real HTTP mock in the parent and forks N children. -->

From upstream plans:
- Plan 02: `src/infrastructure/whoop/token-store.ts` — `tokenStore`, `WHOOP_TOKEN_URL` reads `process.env.WHOOP_TOKEN_URL` at module load.
- Plan 02: `RECOVERY_LEDGER_FORCE_FILE_STORE=1` env override forces file backend.
- Plan 01: `src/infrastructure/config/paths.ts` — `RECOVERY_LEDGER_HOME` env redirects the entire config dir.

Phase 1 D-17 baseline (D-17 attestation):
- The Phase 1 MCP server registers a single tool: `whoop_doctor`. Source: `src/mcp/index.ts` + `src/mcp/register.ts`.
- Phase 2 adds ZERO new `server.registerTool` calls (per CONTEXT D-17). This plan does not modify any file under `src/mcp/`.
- Verified via grep at acceptance time.

Test architecture (per RESEARCH lines 996-1026 + A10):
- Parent: `http.createServer((req, res) => { if (POST /oauth/oauth2/token) count++; ... })` bound to `127.0.0.1:0` (OS-assigned port). Returns valid token-200.json shaped response with `access_token: \`fresh-${count}\``.
- Parent: `mkdtemp` for shared RECOVERY_LEDGER_HOME. Pre-seeds an expired token in `tokens.json` (mode 0600) via `tokenStore.write({...expiresAt: Date.now() - 1000})`.
- Parent: `fork('tests/integration/helpers/child-get-token.mjs', [], {env: {WHOOP_TOKEN_URL: parentUrl, RECOVERY_LEDGER_HOME: tmpDir, RECOVERY_LEDGER_FORCE_FILE_STORE: '1', ...}})` — 10 instances.
- Child (`child-get-token.mjs`): imports `tokenStore` from `dist/infrastructure/whoop/token-store.mjs` — the compiled output (Phase 1 precedent). Per checker WARNING PLAN-08-BUILD-DEP, this path is no longer assumed — it is explicitly verified at Wave-0 and tsup.config.ts is extended if necessary.
- Child: writes `{accessToken, storageMode}` as a single JSON line to stdout, exits 0. (Stdout is fine — the child is NOT an MCP server.)
- Parent: collects stdout from each child, asserts `count === 1` AND `new Set(children.map(c => c.accessToken)).size === 1`.

Build-dependency contract (checker WARNING PLAN-08-BUILD-DEP fix):
- The child helper at `tests/integration/helpers/child-get-token.mjs` imports `'../../../dist/infrastructure/whoop/token-store.mjs'`.
- tsup's default config emits one bundle per entry (e.g., `dist/mcp.mjs` and `dist/cli.mjs`). Internal modules like `src/infrastructure/whoop/token-store.ts` are emitted under `dist/<original-path>.mjs` ONLY if they are listed as an entry OR if tsup's `splitting: true` mode emits them as code-split chunks. Default `splitting: false` does NOT emit internal modules.
- Fix: extend `tsup.config.ts` `entry` array to include `'src/infrastructure/whoop/token-store.ts'`. After `npm run build`, `dist/infrastructure/whoop/token-store.mjs` MUST exist.
- The integration test's Wave-0 task verifies this BEFORE forking children, fast-failing with a useful error message if the path is missing.

`grep -v Bearer` assertion (Phase 2 success criterion #4 + Validation Strategy line 67-68):
- After the concurrency test passes, induce an auth-error condition: change the mock server to return 400 invalid_grant for the next POST. Force a refresh via `child-get-token.mjs`. Capture the child's stderr.
- Also drive the `whoop_doctor` MCP tool (the Phase 1 tool, unchanged in Phase 2 per D-17) with the same expired state (reuse the Phase 1 mcp-stdout-purity subprocess-driver pattern from src/services/doctor/checks/mcp-stdout-purity.ts). Capture the MCP error return.
- Assert: `expect(stderrCapture).not.toMatch(/Bearer\s+[A-Za-z0-9._/+=-]{10,}|eyJ[A-Za-z0-9._-]{20,}|Authorization:/g)`.
- Read every file under tmpDir (if Phase 2 had a log dir — currently it doesn't; Pino logs go to stderr, not a file). For Phase 2 this part of the assertion is "no log files exist by default" — the parent asserts `readdir(tmpDir)` returns only the expected files: `config.json` (if init was run), `tokens.json`, `tokens.json.lock`, `storage-mode`. No `*.log` files.
- Assert the MCP error return (JSON.stringify) does not match the regex.

D-25 GitHub Actions matrix:
- Current ci.yml runs single `runs-on: macos-latest`.
- Phase 2 changes: `runs-on: ${{ matrix.os }}` + `strategy.matrix.os: [macos-latest, ubuntu-latest]`.
- For `ubuntu-latest`: set `env: RECOVERY_LEDGER_FORCE_FILE_STORE: '1'` on the `Test` step (or job-level) so the keyring is skipped and the file backend is exercised.
- Both matrix rows run: install → lint → build → test → bash scripts/ci-grep-gates.sh — the same steps Phase 1 set up.
</interfaces>
</context>

<tasks>

<task type="auto">
  <name>Task 0 (Wave-0 prereq, checker WARNING PLAN-08-BUILD-DEP fix): extend tsup.config.ts so dist/infrastructure/whoop/token-store.mjs is emitted by `npm run build`</name>
  <files>
    tsup.config.ts
  </files>
  <read_first>
    - tsup.config.ts (current entry list — likely `[src/cli/index.ts, src/mcp/index.ts]` or similar; extend, don't replace)
    - .planning/phases/02-oauth-token-store-single-flight-refresh/02-PATTERNS.md (lines 537-568 — auth-concurrency.test.ts pattern recommends the dist-import approach)
    - .planning/phases/02-oauth-token-store-single-flight-refresh/02-RESEARCH.md (lines 996-1026 — cross-process test recipe)
  </read_first>
  <action>
    Open `tsup.config.ts`. Locate the `entry` array (e.g., `entry: ['src/cli/index.ts', 'src/mcp/index.ts']`).

    Append `'src/infrastructure/whoop/token-store.ts'` to the entry array so tsup emits `dist/infrastructure/whoop/token-store.mjs` alongside the existing CLI and MCP bundles. Preserve existing entries verbatim.

    Verification path resolution: tsup with default config (no `outDir` override beyond `dist/`) emits one .mjs per entry, mirroring the source-tree path under `dist/`. So `src/infrastructure/whoop/token-store.ts` → `dist/infrastructure/whoop/token-store.mjs`.

    If the existing tsup.config.ts has `splitting: true`, that does NOT change the entry requirement — entries are always emitted as top-level outputs.

    Run `npm run build` locally and verify `test -f dist/infrastructure/whoop/token-store.mjs` exits 0. If the emitted path differs (e.g., tsup flattens to `dist/token-store.mjs`), update the child helper's import path in Task 2 of this plan AND record the actual emit path in the plan SUMMARY.
  </action>
  <verify>
    <automated>npm run build &amp;&amp; test -f dist/infrastructure/whoop/token-store.mjs</automated>
  </verify>
  <acceptance_criteria>
    - `tsup.config.ts` `entry` array includes `'src/infrastructure/whoop/token-store.ts'`: `grep -nE "src/infrastructure/whoop/token-store" tsup.config.ts` returns >= 1 match.
    - `npm run build` exits 0.
    - `test -f dist/infrastructure/whoop/token-store.mjs` exits 0 after a fresh `npm run build`.
    - Pre-existing tsup entries (CLI, MCP) are still emitted: `test -f dist/cli.mjs && test -f dist/mcp.mjs` exits 0 (or whatever the existing entry filenames are — verify against the pre-existing tsup.config.ts contents).
  </acceptance_criteria>
  <done>
    tsup.config.ts entry array extended; `npm run build` emits the compiled token-store at the expected path; the integration test (Task 1) can fork children that import from `dist/infrastructure/whoop/token-store.mjs` without an "ERR_MODULE_NOT_FOUND" error.
  </done>
</task>

<task type="auto" tdd="true">
  <name>Task 1: Cross-process auth-concurrency integration test + CI matrix expansion</name>
  <files>
    tests/integration/auth-concurrency.test.ts,
    tests/integration/helpers/child-get-token.mjs,
    .github/workflows/ci.yml
  </files>
  <read_first>
    - test/integration/mcp-stdout-purity.test.ts (Phase 1 — analog for subprocess-driven integration test; the pattern of building dist/ first and spawning compiled .mjs)
    - src/services/doctor/checks/mcp-stdout-purity.ts (Phase 1 — analog for spawn-with-stdio + finalise harness; lines 126-168 the lifecycle pattern; lines 186-193 error listener)
    - src/services/doctor/checks/mcp-stdout-purity.test.ts (Phase 1 — mkdtemp pattern; lines 16-18 imports)
    - src/infrastructure/whoop/token-store.ts (Plan 02 — WHOOP_TOKEN_URL env override; RECOVERY_LEDGER_FORCE_FILE_STORE recognition; getValidAccessToken signature)
    - src/infrastructure/config/paths.ts (Plan 01 — RECOVERY_LEDGER_HOME redirect)
    - .github/workflows/ci.yml (current single-OS workflow; Plan 08 expands to matrix)
    - tsup.config.ts (Task 0 of this plan — entry array now includes the token-store module)
    - .planning/phases/02-oauth-token-store-single-flight-refresh/02-CONTEXT.md (D-23, D-24, D-25 — the integration test is load-bearing for AUTH-05)
    - .planning/phases/02-oauth-token-store-single-flight-refresh/02-RESEARCH.md (lines 996-1026 — cross-process test recipe; lines 1059-1077 — grep -v Bearer assertion pattern; lines 1133-1134 — WHOOP token endpoint URL)
    - .planning/phases/02-oauth-token-store-single-flight-refresh/02-PATTERNS.md (lines 537-568 — auth-concurrency.test.ts pattern; uses real http.createServer in parent, not MSW, per A10)
    - .planning/phases/02-oauth-token-store-single-flight-refresh/02-VALIDATION.md (line 54 — integration test placement; manual verifications)
    - agent_docs/decisions/0002-single-flight-oauth-refresh.md (lines 68-75 §Enforcement — contract test "spawns two concurrent calls" — Plan 08 ships 10, well above the contract floor)
  </read_first>
  <behavior>
    Build-dependency precondition (checker WARNING PLAN-08-BUILD-DEP fix):
    - Test B-01: `beforeAll` (or a leading inline test) asserts `existsSync('dist/infrastructure/whoop/token-store.mjs')` after running `npm run build` via execAsync. If the path does not exist, the test fast-fails with a message that names the missing file AND points at tsup.config.ts. This is the exact acceptance criterion stated in the checker WARNING.

    Concurrency assertion (D-23.2 + D-24 — AUTH-05 load-bearing):
    - Test I-01: parent starts mock server, pre-seeds expired tokens in tmpDir, forks 10 children in parallel via `Promise.all(Array.from({length: 10}, () => forkChild()))`. Each child runs `child-get-token.mjs` which calls `tokenStore.getValidAccessToken()` once and prints the token + storage-mode JSON-line to stdout.
    - Assertion 1: `count === 1` (exactly one POST to /oauth/oauth2/token across all 10 children).
    - Assertion 2: `new Set(tokens).size === 1` (all 10 children see the same fresh access_token).
    - Assertion 3: every child exits with code 0.
    - Assertion 4: every child reports `storageMode: 'file'` (RECOVERY_LEDGER_FORCE_FILE_STORE was set).

    Atomic-write assertion (D-23.c at integration scale):
    - Test I-02: after the concurrency test passes, `stat(${tmpDir}/tokens.json.tmp)` throws ENOENT (atomic write completed). `(await stat(${tmpDir}/tokens.json)).mode & 0o777 === 0o600`.

    Lockfile cleanup:
    - Test I-03: `${tmpDir}/tokens.json.lock` exists as an empty file (proper-lockfile leaves the lockfile path on disk even after release; the lock STATE has been released — verified by attempting `lockfile.check()` returning false). NOTE: proper-lockfile semantics — `lockfile.check()` returns true if currently held, false if released. Use that as the assertion.

    grep -v Bearer (Phase 2 success criterion #4 — AUTH-06 end-to-end):
    - Test G-01: after the test runs, captured stderr from ALL 10 children, the parent's stderr, and any MCP error returns produced during the test do NOT match the FORBIDDEN regex `/Bearer\s+[A-Za-z0-9._/+=-]{10,}|eyJ[A-Za-z0-9._-]{20,}|Authorization:/g`. Use `expect(stderrCapture).not.toMatch(FORBIDDEN)`.
    - Test G-02: also induce a refresh failure (mock server next response = 400 invalid_grant). Force a fresh child to attempt getValidAccessToken. Capture its stderr. Assert it does NOT match FORBIDDEN.
    - Test G-03: drive the `whoop_doctor` MCP tool (the Phase 1 tool — Phase 2 ships ZERO new MCP tools per D-17, plan-level note) via the same subprocess pattern as src/services/doctor/checks/mcp-stdout-purity.ts: spawn `dist/mcp.mjs`, drive the four-fixture JSON-RPC sequence (initialize → notifications/initialized → tools/list → tools/call:whoop_doctor) with `RECOVERY_LEDGER_HOME=tmpDir` + `RECOVERY_LEDGER_FORCE_FILE_STORE=1` + `WHOOP_TOKEN_URL` pointing at the failing mock. Capture the tools/call response. Assert `JSON.stringify(response).match(FORBIDDEN) === null`.

    GitHub Actions matrix (D-25):
    - Test C-01 (manual / CI-only verification): the `.github/workflows/ci.yml` file now has `strategy.matrix.os: [macos-latest, ubuntu-latest]` AND a conditional env or run-step that sets `RECOVERY_LEDGER_FORCE_FILE_STORE=1` for the ubuntu-latest row.
    - This is verified at code-grep level in acceptance criteria; full verification waits for the first post-merge GitHub Actions run (per Phase 1 STATE.md precedent — "first post-merge GitHub Actions run on `main` is the final acceptance gate").

    Test runtime budget:
    - The integration test should complete in < 15 seconds total. 10 child forks + 1 mock server + a settle window. Pattern from Phase 1's CI integration test (~2.3s for the simpler single-subprocess case; 10x children + lockfile contention realistically pushes 5-10s).
    - Use `pool: 'forks'` (already set repo-wide per Phase 1 + conventions.md). The integration test file lives under `tests/integration/` so it co-exists with the rest of vitest's run scope.
  </behavior>
  <action>
    Step 1 — Create `tests/integration/helpers/child-get-token.mjs`. This is a tiny Node ESM script that gets spawned. ~25 LOC. Structure:
    ```javascript
    // Child helper for tests/integration/auth-concurrency.test.ts.
    // Spawned via child_process.fork(). Imports the compiled tokenStore from
    // dist/ (Phase 1 precedent; tsup.config.ts now lists the token-store as an
    // explicit entry per checker WARNING PLAN-08-BUILD-DEP), calls
    // getValidAccessToken(), prints {accessToken, storageMode} as a single
    // JSON line to stdout, exits 0.
    // Env: WHOOP_TOKEN_URL (parent mock), RECOVERY_LEDGER_HOME (shared tmpdir),
    // RECOVERY_LEDGER_FORCE_FILE_STORE=1 (file backend).
    import { tokenStore } from '../../../dist/infrastructure/whoop/token-store.mjs';

    async function main() {
      try {
        const accessToken = await tokenStore.getValidAccessToken();
        const storageMode = await tokenStore.readStorageMode();
        process.stdout.write(JSON.stringify({ ok: true, accessToken, storageMode }) + '\n');
        process.exit(0);
      } catch (err) {
        // NEVER print err.message verbatim — defense-in-depth.
        // The integration test asserts no token-material in stderr regardless.
        process.stderr.write(JSON.stringify({ ok: false, kind: err?.kind ?? 'unknown' }) + '\n');
        process.exit(1);
      }
    }

    main();
    ```
    NOTE: this child file imports `dist/infrastructure/whoop/token-store.mjs` — the test must depend on `npm run build` having run first. Task 0 of this plan extended tsup.config.ts to emit that path.

    Step 2 — Create `tests/integration/auth-concurrency.test.ts`. Pattern from test/integration/mcp-stdout-purity.test.ts + RESEARCH lines 996-1026. ~260 LOC. Structure:

    1. Imports: `vitest` (`describe`, `test`, `expect`, `beforeAll`, `afterAll`, `beforeEach`), `node:child_process` (`fork`), `node:http` (`createServer`), `node:fs` (`existsSync`), `node:fs/promises` (`mkdtemp`, `rm`, `stat`, `writeFile`, `readFile`, `readdir`), `node:os` (`tmpdir`), `node:path`, `node:url` (`fileURLToPath`), `node:util` (`promisify`).

    2. Top-level constants: `FORBIDDEN = /Bearer\s+[A-Za-z0-9._/+=-]{10,}|eyJ[A-Za-z0-9._-]{20,}|Authorization:/g`. `BUILD_OUTPUT_PATH = 'dist/infrastructure/whoop/token-store.mjs'` (from checker WARNING PLAN-08-BUILD-DEP).

    3. `beforeAll`: run `npm run build` via `execAsync` so `dist/` is fresh. Assert `existsSync(BUILD_OUTPUT_PATH)` — fast-fail with `throw new Error('tsup.config.ts must emit ' + BUILD_OUTPUT_PATH + ' as a top-level entry; checker WARNING PLAN-08-BUILD-DEP. Run npm run build and verify.')` if the path is missing. (This is the explicit Wave-0 build-dep verification.) Start the mock HTTP server. Capture `port` from `server.address()`. Create the shared tmpDir via `mkdtemp`.

    4. `beforeEach`: reset the mock-server hit counter to 0. Re-seed an expired token in `tmpDir/tokens.json` mode 0600 + `tmpDir/storage-mode = 'file'\n`. Make sure `tmpDir/tokens.json.lock` exists (touch it; proper-lockfile expects the lock path to be touchable).

    5. `afterAll`: server.close(); rm tmpDir recursively.

    6. The mock server handler: counts POST hits on `/oauth/oauth2/token`. Returns valid token-200.json shape with `access_token: \`fresh-${count}\`, refresh_token: \`r-${count}\`, expires_in: 3600, scope: 'offline', token_type: 'bearer'`. Has a "next response override" mode so test G-02 can flip to 400 invalid_grant.

    7. Test B-01 (build precondition): explicitly assert `existsSync(BUILD_OUTPUT_PATH)`. This is redundant with beforeAll's fail-fast, but pinning it as a NAMED test makes the failure mode obvious in test output (checker WARNING PLAN-08-BUILD-DEP acceptance).

    8. Test I-01 (10-parallel concurrency, AUTH-05 load-bearing). Spawn 10 children via `Array.from({length: 10}, () => forkChild())` where forkChild returns a Promise that resolves with `{stdout, stderr, exitCode}`. Use `fork(childPath, [], {env: {...process.env, WHOOP_TOKEN_URL: \`http://127.0.0.1:${port}/oauth/oauth2/token\`, RECOVERY_LEDGER_HOME: tmpDir, RECOVERY_LEDGER_FORCE_FILE_STORE: '1'}, silent: true})` so stdout/stderr can be captured. Await all 10 promises. Assert per <behavior>.

    9. Test I-02 (atomic write).

    10. Test I-03 (lockfile state). Import `* as lockfile from 'proper-lockfile'` and call `lockfile.check(paths.tokensLockFile)` — returns false (released).

    11. Test G-01 (grep -v Bearer on the I-01 stderr capture).

    12. Test G-02 (induced refresh failure). Set next-response override to 400. Spawn a fresh child. Assert child exits 1 (`AuthError({kind: 'refresh_failed'})`) and stderr does NOT match FORBIDDEN.

    13. Test G-03 (MCP tool error path — D-17 attestation: the Phase 1 `whoop_doctor` tool is the only MCP-surfaced tool). Use the Phase 1 subprocess driver pattern from src/services/doctor/checks/mcp-stdout-purity.ts: spawn `dist/mcp.mjs`, drive the four-fixture JSON-RPC sequence (initialize → notifications/initialized → tools/list → tools/call:whoop_doctor) with `RECOVERY_LEDGER_HOME=tmpDir` + `RECOVERY_LEDGER_FORCE_FILE_STORE=1` + `WHOOP_TOKEN_URL` pointing at the failing mock. Capture the tools/call response. Assert `JSON.stringify(response).match(FORBIDDEN) === null`. Also assert `tools/list` response contains EXACTLY one tool (whoop_doctor), confirming D-17 at runtime.

    Test runtime budget < 15s. Use `pool: 'forks'`. Use the lifecycle harness pattern from mcp-stdout-purity.ts lines 126-168 (finalise + SIGTERM→SIGKILL escalation) for child cleanup on test timeout.

    No `console.*`. No production-code changes.

    Step 3 — Modify `.github/workflows/ci.yml`:
    - Add `strategy:` block to the `ci` job: `matrix: { os: [macos-latest, ubuntu-latest] }`. Set `runs-on: ${{ matrix.os }}`.
    - Add an `if: matrix.os == 'ubuntu-latest'` step BEFORE the `Test` step that exports `RECOVERY_LEDGER_FORCE_FILE_STORE=1` for subsequent steps. Alternatively: add `env: RECOVERY_LEDGER_FORCE_FILE_STORE: ${{ matrix.os == 'ubuntu-latest' && '1' || '' }}` to the `Test` step.
    - Keep the rest of the workflow unchanged (concurrency block, permissions, action SHA pins, build-before-test rule).

    Step 4 — Verify locally:
    - `npm run build` succeeds AND `dist/infrastructure/whoop/token-store.mjs` exists.
    - `npm run test -- --run tests/integration/auth-concurrency.test.ts` exits 0 with all B-01 + I-01..03 + G-01..03 tests green.
    - `npm run test` full suite exits 0 (no regression in Phase 1 or other Phase 2 tests).
    - `bash scripts/ci-grep-gates.sh` exits 0.
    - D-17 grep-verification: `grep -rEn 'server\\.registerTool' src/mcp/` returns the SAME set of registrations as the Phase 1 baseline — only `whoop_doctor`. Phase 2 has not added any new tool registrations.
  </action>
  <verify>
    <automated>npm run build &amp;&amp; test -f dist/infrastructure/whoop/token-store.mjs &amp;&amp; npm run test -- --run tests/integration/auth-concurrency.test.ts</automated>
  </verify>
  <acceptance_criteria>
    - `tests/integration/auth-concurrency.test.ts` exists with describe block titled `'auth concurrency'` or similar.
    - `tests/integration/helpers/child-get-token.mjs` exists with `import { tokenStore } from '../../../dist/infrastructure/whoop/token-store.mjs'`.
    - `tsup.config.ts` entry array includes `src/infrastructure/whoop/token-store.ts` (added in Task 0): `grep -nE "src/infrastructure/whoop/token-store" tsup.config.ts` returns >= 1 match.
    - After `npm run build`, `test -f dist/infrastructure/whoop/token-store.mjs` exits 0 (checker WARNING PLAN-08-BUILD-DEP acceptance criterion).
    - `.github/workflows/ci.yml` contains `matrix:` + `os: [macos-latest, ubuntu-latest]`. Grep: `grep -nE 'ubuntu-latest' .github/workflows/ci.yml` returns >= 1 match.
    - `.github/workflows/ci.yml` sets `RECOVERY_LEDGER_FORCE_FILE_STORE=1` for the ubuntu-latest row. Grep: `grep -nE 'RECOVERY_LEDGER_FORCE_FILE_STORE' .github/workflows/ci.yml` returns >= 1 match.
    - `npm run build` exits 0 (dist exists, includes token-store.mjs).
    - `npm run test -- --run tests/integration/auth-concurrency.test.ts` exits 0 with at least 7 passing tests (B-01 + I-01..03 + G-01..03).
    - Inside the test file, the assertion `expect(count).toBe(1)` appears AT LEAST once after the 10-fork Promise.all resolves (the load-bearing AUTH-05 assertion). Grep: `grep -nE 'toBe\(1\)' tests/integration/auth-concurrency.test.ts` returns >= 1 match.
    - Inside the test file, the FORBIDDEN regex literal appears: `grep -nE 'Bearer.*Authorization' tests/integration/auth-concurrency.test.ts` returns >= 1 match.
    - `grep -nE 'console\.(log|info|warn|error|debug|trace)' tests/integration/auth-concurrency.test.ts` returns no matches.
    - D-17 runtime attestation: the G-03 test asserts `tools/list` returns exactly one tool. Grep: `grep -nE 'tools/list|whoop_doctor' tests/integration/auth-concurrency.test.ts` returns >= 2 matches.
    - `npm run test` (full suite) exits 0.
    - `bash scripts/ci-grep-gates.sh` exits 0.
    - `npm run lint` exits 0.
  </acceptance_criteria>
  <done>
    Integration test ships with 10-parallel cross-process concurrency assertion (count === 1), atomic-write assertion, lockfile-released assertion, plus the three `grep -v Bearer` assertions covering stderr / induced refresh failure / MCP error return. CI matrix expanded to ubuntu-latest with file-fallback path enforced. tsup.config.ts emits the compiled token-store explicitly (checker WARNING PLAN-08-BUILD-DEP fix). AUTH-05 cross-process load-bearing test is now CI-enforced; AUTH-06 end-to-end grep gate is now CI-enforced. D-17 runtime-attested in test G-03 (tools/list returns one tool). Phase 2 success criteria #2 and #4 both satisfied.
  </done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| 10 forked children → parent mock HTTP server | trusted test harness; children use the production tokenStore code unchanged |
| WHOOP_TOKEN_URL env override → token-store.ts | test-only override; production never sets this env var |
| RECOVERY_LEDGER_HOME tmpdir → all children share state | filesystem boundary; proper-lockfile coordinates the refresh window |
| stderr capture → FORBIDDEN regex | integration assertion verifying the sanitizer + logging discipline is end-to-end clean |
| dist/infrastructure/whoop/token-store.mjs (Wave-0 build precondition) | tsup-emitted artifact; not committed; verified at test start |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-02.08-01 | Repudiation / DoS | refresh-token-family revocation under real concurrency | mitigate | Test I-01 asserts exactly one POST across 10 forked children — the load-bearing AUTH-05 contract test (ADR-0002 §Enforcement line 73-75). If the in-process gate OR the file-lock gate has a bug, this test fails. ASVS V11. |
| T-02.08-02 | Information Disclosure | token material in subprocess stderr | mitigate | Test G-01 asserts captured stderr from all 10 children does NOT match the FORBIDDEN regex. Child helper deliberately does NOT print err.message verbatim (only `err.kind`). ASVS V7. |
| T-02.08-03 | Information Disclosure | token material in MCP error returns | mitigate | Test G-03 drives the whoop_doctor MCP tool with an expired-token state and asserts the tools/call response (JSON.stringify) does not match FORBIDDEN. Phase 1's register.ts sanitizer + Phase 2's Plan 07 fixtures cover the leak shapes; G-03 is the end-to-end proof. D-17 attestation: tools/list returns exactly one tool. ASVS V7. |
| T-02.08-04 | Tampering | partial write under cross-process contention | mitigate | Test I-02 asserts tokens.json.tmp does NOT exist after the test. Plan 02's atomic-write recipe is exercised under real fork load. ASVS V8. |
| T-02.08-05 | DoS | stale lockfile from killed child | mitigate | proper-lockfile `stale: 5000` (Plan 02) + the test's `afterAll` cleanup. Test I-03 verifies the lock was released. ASVS V11. |
| T-02.08-06 | Spoofing | hostile token endpoint via env-var override | accept | WHOOP_TOKEN_URL override is test-only — Plan 02 reads it via `process.env.WHOOP_TOKEN_URL ?? '<canonical>'` at module load. Production CI never sets it. If an attacker can set env vars on the user's shell, they already own the process. ASVS V14. |
| T-02.08-07 | Tampering | CI matrix bypass — ubuntu-latest skipped silently | mitigate | The matrix.os list must include both `macos-latest` AND `ubuntu-latest`. Acceptance criteria greps the workflow file for both. The first post-merge GitHub Actions run is the external acceptance gate (Phase 1 STATE.md precedent line 124). ASVS V14. |
| T-02.08-08 | Information Disclosure | npm build artifact leaks token-store internals | accept | dist/ files are not committed; they are CI-build outputs. Build-then-test pattern matches Phase 1's integration test. ASVS V14. |
| T-02.08-09 | Tampering | child helper imports a stale dist/ file (build skipped) | mitigate | Task 1 `beforeAll` runs `npm run build` AND asserts `existsSync(BUILD_OUTPUT_PATH)` (Test B-01) — the test fast-fails with a useful error if tsup.config.ts is mis-configured or the build was skipped. Checker WARNING PLAN-08-BUILD-DEP fix. ASVS V14. |
</threat_model>

<verification>
- `tests/integration/auth-concurrency.test.ts` exists with the 7+ tests (B-01 + I-01..03 + G-01..03).
- `tests/integration/helpers/child-get-token.mjs` exists and imports the compiled tokenStore.
- `tsup.config.ts` entry array includes `src/infrastructure/whoop/token-store.ts`.
- `npm run build` exits 0 AND emits `dist/infrastructure/whoop/token-store.mjs`.
- `.github/workflows/ci.yml` matrix expanded to macos-latest + ubuntu-latest; ubuntu row sets RECOVERY_LEDGER_FORCE_FILE_STORE=1.
- `npm run test -- --run tests/integration/auth-concurrency.test.ts` exits 0 with all tests green.
- `npm run test` full suite exits 0 (no regression).
- `bash scripts/ci-grep-gates.sh` exits 0.
- `npm run lint` exits 0.
- D-17 attestation: `grep -rEn 'server\\.registerTool' src/mcp/` returns the same set as Phase 1 baseline (only `whoop_doctor`).
- First post-merge GitHub Actions run on `main` is green (external acceptance gate; not runnable until commits land).
</verification>

<success_criteria>
- AUTH-05 cross-process load-bearing test (D-24) ships in CI with the exactly-one-POST + same-token-for-all-children assertions across 10 forked children.
- AUTH-06 end-to-end `grep -v Bearer` assertion (Phase 2 success criterion #4) ships in CI across stderr + refresh-failure + MCP error return surfaces.
- ROADMAP Phase 2 success criterion #2 satisfied: "concurrent-load test injecting 10 parallel 401 responses across CLI + MCP processes... exactly one WHOOP refresh request is issued and the resulting token tuple is written atomically".
- D-25 Linux fallback path is CI-enforced: ubuntu-latest matrix row runs RECOVERY_LEDGER_FORCE_FILE_STORE=1.
- All four Phase 2 success criteria are now CI-enforced (criterion #1 by Plans 05+03, #2 by Plan 08, #3 by Plan 06, #4 by Plan 08).
- D-17 satisfied (plan-level note + test G-03 attestation): Phase 2 ships ZERO new MCP tools.
- Build-dependency contract satisfied (checker WARNING PLAN-08-BUILD-DEP fix): tsup.config.ts emits dist/infrastructure/whoop/token-store.mjs as an explicit entry; Wave-0 task B-01 verifies before child fork.
</success_criteria>

<output>
After completion, create `.planning/phases/02-oauth-token-store-single-flight-refresh/02-08-SUMMARY.md`.
</output>
