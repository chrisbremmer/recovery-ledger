---
phase: 01-foundation-stdout-pure-mcp-bootstrap
verified: 2026-05-12T19:00:00Z
status: human_needed
score: 12/12 must-haves verified
overrides_applied: 0
re_verification: false
requirements_status:
  FND-01:
    status: covered
    evidence:
      - "package.json with bin entries, engines.node ≥22.11, npm-managed; package-lock.json committed"
      - "tsconfig.json: strict + noUncheckedIndexedAccess + exactOptionalPropertyTypes + NodeNext"
      - "tsup.config.ts: 2 entries (cli, mcp), shebang banner, externals correct"
      - "vitest.config.ts: pool 'forks'"
      - "biome.json: noConsole error + correct overrides"
      - "npm ci / lint / build / test all green; 63 tests passing"
  FND-02:
    status: covered
    evidence:
      - "package.json bin: recovery-ledger → dist/cli.mjs, recovery-ledger-mcp → dist/mcp.mjs"
      - "dist/cli.mjs and dist/mcp.mjs have #!/usr/bin/env node shebang and executable bit"
      - "cd /tmp && node <repo>/dist/cli.mjs --version → 0.1.0 (exit 0)"
      - "cd /tmp && node <repo>/dist/cli.mjs doctor → overall: pass (exit 0) — CR-02 fix confirmed live"
      - "src/cli/index.ts wires Commander with `recovery-ledger` name + version + doctor subcommand"
  FND-03:
    status: covered
    evidence:
      - "src/mcp/index.ts wires McpServer({ name: 'recovery-ledger', version: '0.1.0' }) over StdioServerTransport"
      - "Independent subprocess drive (verifier's own /tmp/mcp-drive.mjs) → 3 valid JSON-RPC frames (id=1,2,3) with no stderr noise"
      - "test/integration/mcp-stdout-purity.test.ts spawns dist/mcp.mjs and asserts initialize → tools/list → tools/call(whoop_doctor) all return result frames"
  FND-04:
    status: covered
    evidence:
      - "src/infrastructure/config/logger.ts: createLogger(env) routes to pino.destination({ dest: 2, sync: false }) (prod) or pino-pretty transport { destination: 2 } (dev)"
      - "src/infrastructure/config/logger.test.ts: 8 cases verify BOTH dev and prod arms bind to fd 2 (WR-01 fix — previously only prod was tested)"
      - "Integration test asserts dist/mcp.mjs stdout contains only valid JSON-RPC 2.0 frames under full handshake"
      - "Verifier independently observed zero stderr bytes during normal MCP handshake"
  FND-05:
    status: covered
    evidence:
      - "biome.json: noConsole=error globally, overrides for src/cli/** and **/*.test.ts"
      - "scripts/ci-grep-gates.sh: 3 gates (tone+emoji, console.* outside cli, process.stdout.write outside doctor.ts)"
      - "Verifier-planted violations: tone word in src/_TONEPLANT.ts → Gate A exit 1; console.log in src/_CONSOLEPLANT.ts → Gate B exit 1; process.stdout.write in src/_STDOUTPLANT.ts → Gate C exit 1"
      - "Post-cleanup gates clean (exit 0). WR-02 fix confirmed: --exclude-dir=test is correct singular"
      - "Codebase scan: process.stdout.write appears ONLY in src/cli/commands/doctor.ts (line 25); console.* appears ONLY in test/integration/mcp-stdout-purity.test.ts (stderr diagnostic, exempt)"
  FND-06:
    status: covered
    evidence:
      - "src/mcp/sanitize.ts: 6-pattern catalog (D-07 base 4 + CR-03 patterns 2a URL query + 2b form body)"
      - "Pattern 4 (bare Bearer) has /gi flag — CR-04 fix confirmed"
      - "Cause-chain walker: WeakSet cycle guard + depth-8 cap + non-Error tail handling (D-08)"
      - "src/mcp/register.ts: the ONLY caller of server.registerTool — wraps every handler in try/catch/sanitize"
      - "Verifier grep: zero other call sites of server.registerTool in src/"
      - "35 tests in sanitize.test.ts pin every pattern with positive + negative cases plus 6 D-10 fixture errors-that-historically-leak (F1-F6, including F5/F6 for CR-03)"
      - "Integration test asserts dist/mcp.mjs response has no Bearer, no Authorization, no JWT shape"
  FND-07:
    status: covered
    evidence:
      - "src/services/doctor/checks/native-modules.ts: better-sqlite3 + @napi-rs/keyring dynamic loads with pass/fail surfacing"
      - "Live doctor run from /tmp: better_sqlite3_load pass, napi_keyring_load pass, mcp_stdout_purity pass (3 frames) — overall pass exit 0"
      - "DoctorResult shape { checks: [...], overall: 'pass'|'warn'|'fail' } emitted as JSON to stdout; --text renders compact plaintext via renderDoctor"
      - "DOCTOR_EXIT_CODES frozen map: pass=0, warn=2, fail=1 (WR-06 fix — 5 tests pin distinctness + freeze invariant)"
      - "CR-01 fix: whoop_doctor MCP tool passes skipSubprocessChecks=true; RL_INSIDE_MCP=1 env fallback verified by unit test"
      - "CR-05 fix: probe requires id=3 frame; 4 stub-MCP regression tests cover empty / missing-id-3 / errored-id-3 / healthy paths"
re_verification: null
human_verification:
  - test: "Run the .github/workflows/ci.yml workflow on macos-latest at least once"
    expected: "All steps green: checkout → setup-node → npm ci → lint → build → test → grep gates. No flakiness on cold-start runners."
    why_human: "The workflow file is committed but has not yet been executed on a real GitHub Actions macos-latest runner (this verifier ran the pipeline locally on a developer machine). Phase 1 Success Criterion 5 calls for build-against-dist in CI; that contract holds in local equivalence but the real CI run is the canonical proof. ROADMAP-level Phase 1 close-out should record the workflow conclusion=success."
  - test: "Manually drive MCP Inspector against dist/mcp.mjs"
    expected: "Inspector connects, lists the one tool (whoop_doctor), and a tool-call shows clean stdout/stderr separation"
    why_human: "MCP Inspector is an interactive TTY tool — listed as a Manual-Only verification in 01-VALIDATION.md. The automated subprocess fixture is the equivalent contract; this is human spot-check confidence."
---

# Phase 1: Foundation & Stdout-Pure MCP Bootstrap — Verification Report

**Phase Goal:** Cross-cutting safety nets (stdout purity, error sanitization, native-module load verification, lint discipline) are locked as tested behaviors before any application code is written.

**Verified:** 2026-05-12
**Status:** human_needed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths (ROADMAP Phase 1 Success Criteria)

| # | Truth (from ROADMAP SC) | Status | Evidence |
|---|------------------------|--------|----------|
| 1 | `npx recovery-ledger` and `npx recovery-ledger-mcp` launch from published `bin` entries with shebangs intact; report version banner (CLI to stdout, MCP via JSON-RPC initialize) | VERIFIED | package.json bin entries point at dist/cli.mjs and dist/mcp.mjs; both files have `#!/usr/bin/env node` shebang (first 30 bytes inspected) and 0755 mode; `node dist/cli.mjs --version` prints `0.1.0` to stdout, exit 0; verifier-driven JSON-RPC handshake against dist/mcp.mjs returns serverInfo via initialize response (id=1) — frame validated. |
| 2 | CI-enforced fixture round-trip against empty MCP stdio server confirms stdout contains only valid JSON-RPC frames — no Pino logs, no console.*, no library warnings (stdout-purity contract) | VERIFIED | test/integration/mcp-stdout-purity.test.ts spawns dist/mcp.mjs, drives the 4-fixture handshake, asserts every stdout line parses as JSON-RPC 2.0 AND id=3 response has `result`. Independent verifier drive: 3 stdout frames, all JSON-RPC valid, 0 stderr bytes, no Bearer/Authorization/JWT substrings. |
| 3 | A lint rule fails the build on any bare `console.*` outside `src/cli/`; a CI gate fails on any non-JSON-RPC byte written to stdout from MCP server path | VERIFIED | biome.json `noConsole: error` globally with src/cli/** and test override; scripts/ci-grep-gates.sh runs 3 gates (tone+emoji, console.* outside cli/tests, process.stdout.write outside doctor.ts). Verifier planted violations in each gate's scope → each exited 1 with a clear ::error:: annotation. Post-cleanup: clean exit 0. |
| 4 | MCP error-sanitizer contract strips `Authorization` headers and JWT-shaped strings from any error surfaced to a tool result, verified by a fixture of "errors that historically leak" | VERIFIED | src/mcp/sanitize.ts has 6 patterns (D-07 base 4 + CR-03 URL query + form body); src/mcp/sanitize.test.ts has 35 cases including D-10 F1–F6 fixtures (fetch TypeError with Auth cause, undici JWT excerpt, JSON access_token body, bare Bearer, form-encoded refresh body, ?access_token URL); integration test also asserts dist/mcp.mjs output is leak-free. |
| 5 | Stub `recovery-ledger doctor` reports `better-sqlite3` and `@napi-rs/keyring` native-module load status; build is run against compiled `dist/` (not tsx) at least once in CI | VERIFIED | src/services/doctor/checks/native-modules.ts has both probes (better-sqlite3 :memory: load + keyring Entry constructor); live `node dist/cli.mjs doctor` from /tmp returns both as `pass` with native binding loaded detail; .github/workflows/ci.yml runs `npm run build` before `npm run test` so the integration test spawns the freshly-built dist/mcp.mjs. |

**Score: 5/5 ROADMAP Success Criteria verified**

### Observable Truths (Phase-Local Must-Haves)

Plan-level truths beyond the ROADMAP SC, verified individually:

| # | Truth | Status | Evidence |
|---|------|--------|----------|
| 6 | Pino logger destination is fd 2 in BOTH dev and prod arms (WR-01 contract) | VERIFIED | logger.test.ts exercises both arms: 6 resolveLoggerOptions cases cover dev (pino-pretty + destination: 2), prod (pino.destination dest: 2), LOG_LEVEL overrides, defaults. createLogger smoke test binds the real prod instance's streamSym to fd 2. |
| 7 | `server.registerTool` called exactly once in the codebase: inside `src/mcp/register.ts` (D-09 chokepoint) | VERIFIED | `grep -rn "server\.registerTool" src/` returns 3 hits, all in src/mcp/register.ts (line 30 comment + line 46 actual call + line 3 docstring). Zero other call sites. |
| 8 | `process.stdout.write` appears only in `src/cli/commands/doctor.ts` (D-04 / D-11 contract) | VERIFIED | `grep -rn "process\.stdout\.write" src/` returns 2 hits: line 2 (docstring) + line 25 (the one allowed call). Gate C enforces this in CI. |
| 9 | Doctor command works from outside repo root via `npx recovery-ledger doctor` install vector (CR-02) | VERIFIED | `cd /tmp && node <repo>/dist/cli.mjs doctor` returns full JSON result with all three checks `pass` and overall `pass`, exit 0. Fixtures vendored as TS literals in src/services/doctor/checks/fixtures.ts; dist/mcp.mjs resolved via import.meta.url, not cwd. |
| 10 | Doctor exit-code map distinguishes all three statuses: pass=0, warn=2, fail=1 (WR-06) | VERIFIED | DOCTOR_EXIT_CODES is a frozen Readonly<Record> in src/cli/commands/doctor.ts; doctor.test.ts has 5 cases including freeze invariant and distinctness assertions. |
| 11 | mcp_stdout_purity probe requires id=3 response (no false-positive on incomplete frames — CR-05) | VERIFIED | mcp-stdout-purity.test.ts has 5 cases: empty stream → fail; missing id=3 → fail; errored id=3 → fail; healthy → pass; CR-01 skip arm → pass. Each runs against a stub MCP server written to tmpdir. |
| 12 | `whoop_doctor` MCP tool handler does NOT recursively respawn dist/mcp.mjs (CR-01) | VERIFIED | tools/whoop-doctor.ts calls `services.runDoctor({ skipSubprocessChecks: true })`; runDoctor honors both the option and RL_INSIDE_MCP=1 env (probe injects this into spawned children). Two regression tests pin the skip arm. Verifier observed live: doctor invocation from /tmp resolved in ~1.1s with 3 frames (single subprocess level, no recursion, no orphans). |

**Score: 12/12 must-haves verified**

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|---------|--------|---------|
| `package.json` | npm-managed ESM, bin, engines, scripts, deps | VERIFIED | All required fields present, deps match STACK.md pins |
| `tsconfig.json` | strict + NodeNext + ESM + load-bearing flags | VERIFIED | strict, noUncheckedIndexedAccess, exactOptionalPropertyTypes all true |
| `tsup.config.ts` | 2 entries, shebang banner, externals | VERIFIED | cli + mcp entries, banner.js=`#!/usr/bin/env node`, externals=[better-sqlite3, @napi-rs/keyring] |
| `vitest.config.ts` | pool 'forks' | VERIFIED | pool: 'forks', passWithNoTests, 10s timeouts |
| `biome.json` | noConsole error + cli/test overrides | VERIFIED | global error + correct overrides |
| `src/infrastructure/config/logger.ts` | Pino → fd 2 in both arms | VERIFIED | createLogger factory + resolveLoggerOptions; prod uses pino.destination({dest:2}), dev uses pino-pretty transport with {destination:2} |
| `src/mcp/index.ts` | StdioServerTransport wireup with serverInfo | VERIFIED | Minimal, single responsibility, no console |
| `src/mcp/register.ts` | The one server.registerTool caller, try/catch/sanitize | VERIFIED | Generic wrapper with type-safe ZodRawShape param |
| `src/mcp/sanitize.ts` | 6-pattern catalog + serializeError | VERIFIED | All 6 patterns present in PATTERNS array with correct flags (`i` on bare Bearer); cause walker has WeakSet + depth-8 cap |
| `src/mcp/tools/whoop-doctor.ts` | ≤5-line shim with skipSubprocessChecks | VERIFIED | Calls register() + services.runDoctor({skipSubprocessChecks:true}); WR-05 JSON round-trip for structuredContent |
| `src/cli/index.ts` | Commander entry with --version + doctor | VERIFIED | Commander wiring, name + version + doctor subcommand with --text |
| `src/cli/commands/doctor.ts` | The one process.stdout.write call site | VERIFIED | DOCTOR_EXIT_CODES frozen map; renders JSON or text; exits with mapped code |
| `src/services/index.ts` | Services barrel + createServices() | VERIFIED | Re-exports DoctorCheck/Result/Options; thin wrapper over runDoctor |
| `src/services/doctor/index.ts` | runDoctor with skipSubprocessChecks + RL_INSIDE_MCP fallback | VERIFIED | deriveOverall precedence (fail > warn > pass); options + env both honored |
| `src/services/doctor/checks/native-modules.ts` | better-sqlite3 + keyring load probes | VERIFIED | Dynamic imports + minimal load assertion + clean error surfacing |
| `src/services/doctor/checks/mcp-stdout-purity.ts` | Subprocess probe with import.meta.url path + EPIPE handling | VERIFIED | All fixes applied: CR-01 (skipSubprocess), CR-02 (import.meta.url), CR-05 (id=3 required), WR-04 (EPIPE catch), test-only setMcpEntryForTesting |
| `src/services/doctor/checks/fixtures.ts` | Vendored TS constants of the 4 JSON-RPC fixtures | VERIFIED | JSONRPC_FIXTURES match on-disk JSON byte-for-byte after canonicalization |
| `src/formatters/doctor.txt.ts` | renderDoctor producing `[status] name — detail` + overall trailer | VERIFIED | Pure function, no banned tone words |
| `test/integration/mcp-stdout-purity.test.ts` | Spawns dist/mcp.mjs, response-driven id=3 wait, asserts JSON-RPC + no leaks | VERIFIED | All four assertion blocks (JSON-RPC validity, sanitizer integration, Pitfall 7 id=3 result, graceful close); WR-03 response-driven (not 1500ms timer) |
| `test/fixtures/mcp/*.json` | Four fixtures: initialize, initialized, tools-list, whoop-doctor-call | VERIFIED | All 4 present, match TS-vendored constants |
| `scripts/ci-grep-gates.sh` | Three gates with inverted-grep exit semantics | VERIFIED | Tone+emoji (Gate A) / console.* (Gate B) / stdout.write (Gate C); planted-violation test confirmed each gate fires |
| `.github/workflows/ci.yml` | macos-latest, pinned action versions, correct step order | VERIFIED | checkout@v4 + setup-node@v4 (pinned major); macos-latest; steps in order checkout → setup-node from node-version 22 → npm ci → lint → build → test → grep-gates; concurrency cancels redundant runs |
| `.nvmrc` | Node 22 | VERIFIED | Contains `22` |

### Key Link Verification

| From | To | Via | Status | Details |
|------|-----|-----|--------|---------|
| dist/mcp.mjs | Node fd 1 (stdout) | JSON-RPC framing only | VERIFIED | Verifier subprocess drive observed only valid JSON-RPC frames; integration test pins this in CI |
| dist/mcp.mjs | Node fd 2 (stderr) | Pino destination + pino-pretty transport destination | VERIFIED | logger.test.ts pins both arms; subprocess drive observed 0 stderr bytes during normal handshake |
| src/mcp/tools/whoop-doctor.ts | services.runDoctor | register() wrapper + skipSubprocessChecks: true | VERIFIED | Recursion broken at depth 1 (CR-01); regression tests pin skip-arm via two assertions |
| src/services/doctor/checks/mcp-stdout-purity.ts | dist/mcp.mjs | path.resolve(dirname(fileURLToPath(import.meta.url)), 'mcp.mjs') | VERIFIED | Live `cd /tmp && doctor` returns mcp_stdout_purity=pass with 3 frames; CR-02 fix is real |
| src/mcp/register.ts | sanitize() + serializeError() | catch arm → return isError: true | VERIFIED | Single chokepoint; D-09 grep gate enforces no other call sites |
| scripts/ci-grep-gates.sh | CI workflow | bash entrypoint as a single step | VERIFIED | .github/workflows/ci.yml line 51: `run: bash scripts/ci-grep-gates.sh` |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| CLI version banner to stdout | `cd /tmp && node <repo>/dist/cli.mjs --version` | stdout: `0.1.0`; exit 0 | PASS |
| Doctor JSON output from outside repo | `cd /tmp && node <repo>/dist/cli.mjs doctor` | All 3 checks `pass`, overall `pass`, exit 0 | PASS |
| Doctor --text plaintext from outside repo | `cd /tmp && node <repo>/dist/cli.mjs doctor --text` | 3 `[pass] name — detail` lines + `overall: pass`, exit 0 | PASS |
| dist/mcp.mjs JSON-RPC handshake | Custom drive via /tmp/mcp-drive.mjs (initialize/initialized/tools-list/tools-call) | 3 stdout frames, all valid JSON-RPC 2.0, 0 stderr bytes, no token leaks | PASS |
| Lint clean | `npm run lint` | Checked 24 files, no fixes applied, exit 0 | PASS |
| Type-check clean | `npx tsc --noEmit` | No output, exit 0 | PASS |
| Build produces both entries with shebang | `npm run build && head -c 30 dist/{cli,mcp}.mjs` | Both start with `#!/usr/bin/env node`, both 0755 | PASS |
| Test suite green | `npm run test` | 8 files / 63 tests passed, 4.69s | PASS |
| Grep gates clean | `bash scripts/ci-grep-gates.sh` | "All grep gates passed", exit 0 | PASS |
| Gate A catches tone word | `echo "optimize" > src/_p.ts && gates` | exit 1, `::error::Gate A` | PASS |
| Gate B catches console.log outside cli/test | `echo "console.log" > src/_p.ts && gates` | exit 1, `::error::Gate B` | PASS |
| Gate C catches stdout.write outside doctor.ts | `echo "process.stdout.write" > src/_p.ts && gates` | exit 1, `::error::Gate C` | PASS |
| Sanitizer leaves no Bearer in MCP response | Integration test assertion 2 | stdout passes negative regex (no `Bearer\s`, no `Authorization:`, no `eyJ…\.`) | PASS |
| CR-04 bare bearer case-insensitivity | Sanitize test P4 lower + upper + mixed | All three redact to `Bearer <redacted>` | PASS |

### Requirements Coverage (FND-01..07)

| Requirement | Source Plans | Description | Status | Evidence |
|-------------|--------------|-------------|--------|----------|
| FND-01 | 01-01, 01-06 | Bootstrapped TS repo on Node 22 LTS, npm-managed, with tsup + Vitest + Biome configured | SATISFIED | package.json + tsconfig.json + tsup.config.ts + vitest.config.ts + biome.json + .nvmrc all present and correct; `npm ci` succeeds; lint/build/test all green |
| FND-02 | 01-05, 01-06 | Empty CLI entry registered via `bin` and runnable via `npx recovery-ledger` | SATISFIED | bin entry → dist/cli.mjs (0755 + shebang); --version banner works; doctor command works from /tmp (outside repo root — CR-02 fix lived) |
| FND-03 | 01-03, 01-05, 01-06 | Empty MCP stdio server using @modelcontextprotocol/sdk + stdio | SATISFIED | dist/mcp.mjs runs as stdio server with serverInfo correctly set; one tool registered (whoop_doctor); integration test verifies the initialize/tools-list/tools-call handshake |
| FND-04 | 01-02, 01-06 | Pino logger writes exclusively to stderr; CI-enforced assertion that MCP stdout contains only valid JSON-RPC under fixture load | SATISFIED | logger.test.ts pins both dev and prod arms to fd 2; integration test pins dist/mcp.mjs stdout to JSON-RPC only; verifier drive confirmed live |
| FND-05 | 01-01, 01-04, 01-06 | Lint rule banning console.* outside src/cli/ + CI gate failing on stdout pollution | SATISFIED | biome.json noConsole + override; scripts/ci-grep-gates.sh 3 gates; planted violations trip each gate (verifier confirmed) |
| FND-06 | 01-03, 01-04, 01-06 | MCP error-sanitizer contract stripping Authorization headers and JWT-shaped strings | SATISFIED | sanitize.ts 6-pattern catalog covers all FND-06 + CR-03 wire shapes; 35 unit tests + integration assertion pin the contract; register.ts is the chokepoint |
| FND-07 | 01-05, 01-06 | Native-module load verification by stub `doctor` | SATISFIED | better-sqlite3 + @napi-rs/keyring probes ship in src/services/doctor/checks/native-modules.ts; live `doctor` shows both pass on the verification host; doctor JSON+text dual output spec'd by D-06 honored |

**Requirements coverage: 7/7 satisfied. No orphaned IDs from REQUIREMENTS.md.**

### Anti-Patterns Found

None.

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| (none) | — | — | — | — |

Specifically verified absent:

- `TBD`, `FIXME`, `XXX` debt markers in any phase-modified file: **0 matches** (grep clean)
- `TODO`, `HACK`, `PLACEHOLDER` warning-level cleanup markers: **0 matches** (grep clean)
- `console.*` outside src/cli/ and test files: **0 matches** in src/ (only legitimate stderr diagnostic in test/integration/, which is exempt)
- `process.stdout.write` outside src/cli/commands/doctor.ts: **0 matches** (Gate C clean)
- `server.registerTool` outside src/mcp/register.ts: **0 matches**
- Empty `return null` / `return {}` / `return []` rendering hardcoded empty data: not observable here (no UI/rendering surface yet)
- `console.error` in any code reachable from MCP transport: **0 matches** in src/ (CLAUDE.md stricter-than-FND-05 rule honored)

### REVIEW Resolution Verification

All 5 Critical + 7 Warning fixes traced to real commits with real code changes:

| Finding | Resolution Commit | Verified Real | Evidence |
|---------|------------------|---------------|----------|
| CR-01 (MCP recursion) | 423f6af, d80a357 | YES | tools/whoop-doctor.ts line 37 passes skipSubprocessChecks:true; runDoctor honors opts.skipSubprocessChecks + RL_INSIDE_MCP env; live doctor returns 3 frames (not 2) so id=3 actually arrives |
| CR-02 (doctor outside repo) | 801400a | YES | fixtures.ts vendors all 4 JSON-RPC frames as TS constants; mcp-stdout-purity.ts:33-34 resolves via fileURLToPath(import.meta.url); cd /tmp && doctor returns overall pass |
| CR-03 (sanitizer wire shapes) | e1af258 | YES | PATTERNS array has 6 entries (2a URL query + 2b form body added between original 2 and 3); D-10 F5/F6 fixtures cover both |
| CR-04 (bare Bearer case) | 423f6af | YES | sanitize.ts line 65: `/Bearer\s+[A-Za-z0-9._-]{10,}/gi` (i flag present); 3 case tests pass (lower/upper/mixed) |
| CR-05 (incomplete frames pass) | d80a357 | YES | mcp-stdout-purity.ts lines 193-246 require lines.length > 0 AND id=3 frame AND id=3 has result; 4 stub-MCP regression tests pin each failure mode |
| WR-01 (dev logger not tested) | 8784c0d | YES | logger.ts exports resolveLoggerOptions + createLogger factories; logger.test.ts has 8 cases covering both dev and prod arms including destination:2 assertion |
| WR-02 (tests typo) | 5c69fc9 | YES | ci-grep-gates.sh line 43-44: both `--exclude-dir=test` AND `--exclude-dir=tests` present, with policy comment |
| WR-03 (1500ms drain) | d7c495f | YES | integration test uses response-driven Promise.race on id=3 arrival; 5000ms hard ceiling for circuit-break |
| WR-04 (stdin EPIPE) | 83d3435 | YES | mcp-stdout-purity.ts line 140 attaches no-op stdin error listener; write() wrapped in try/catch with finalise-on-throw |
| WR-05 (double cast) | 9c77125 | YES | tools/whoop-doctor.ts line 23-25 uses JSON.parse(JSON.stringify(result)) round-trip; doctor.index.test.ts pins JSON serializability |
| WR-06 (exit codes) | 180f3b6 | YES | DOCTOR_EXIT_CODES frozen map exported from doctor.ts; 5 tests pin distinctness + freeze |
| WR-07 (unreachable catch) | 8784c0d | YES | logger.test.ts symbol-introspection test uses native expect().toBeDefined() + expect().toBe(2) without try/catch wrapper |

**Note:** The four deferred Info findings (IN-01 JSON re-escape, IN-03 isError sanitization, IN-04 durationMs, IN-05 dts emit) are legitimately Info-level — none affect Phase 1's safety-net contract. They are correctly tagged for Phase 2 / Phase 4 / Phase 5 follow-up.

### Human Verification Required

#### 1. Real CI workflow run on macos-latest

**Test:** Push or trigger the .github/workflows/ci.yml workflow on GitHub Actions macos-latest.

**Expected:** All steps green — checkout → setup-node → npm ci → lint → build → test → grep-gates. No timing-related flakes on cold-start runners.

**Why human:** The workflow file is committed and structurally correct, but has not been executed on a real GitHub Actions macos-latest runner. This verifier ran the full pipeline locally; ROADMAP Phase 1 Success Criterion 5 ("build is run against compiled `dist/` … at least once in CI") is structurally satisfied (the integration test does spawn dist/mcp.mjs) but the canonical CI green run on the documented platform is the load-bearing artifact. The verification cycle here is: `gh run list --limit 1 --json conclusion --jq '.[0].conclusion'` returns `"success"` after the first push.

This is the same "manual-only verification" called out in 01-VALIDATION.md as the `ci-green-required` row. It does not block Phase 2 from starting (the local pipeline is sufficient evidence that the gates compose correctly), but it should be the precondition for closing the Phase 1 row in ROADMAP.md as audited end-to-end.

#### 2. MCP Inspector spot-check

**Test:** `npx @modelcontextprotocol/inspector node /Users/chris.bremmer/recovery-ledger/dist/mcp.mjs` and trigger a `whoop_doctor` tool call from the Inspector UI.

**Expected:** Inspector connects, lists `whoop_doctor` as the only tool, and a tool-call returns the doctor result with clean text content + structuredContent. No stdout noise observable.

**Why human:** Inspector is an interactive TTY tool. The automated subprocess fixture provides the equivalent contract assertion; this is a human spot-check for the Claude Code / Claude Desktop / Cursor install paths Phase 5 will document. Listed in 01-VALIDATION.md §Manual-Only Verifications.

### Gaps Summary

No gaps. All 12 Phase 1 must-haves verified through code reading, live execution, planted-failure tests, and independent subprocess drive. All 7 FND-* requirements satisfied. All 12 REVIEW findings (5 Critical + 7 Warning) traced to real resolution commits with real code changes; planted-failure verification confirmed the fixes are mechanically effective. No debt markers anywhere in phase-touched files.

The phase goal — "Cross-cutting safety nets … are locked as tested behaviors before any application code is written" — is achieved. Stdout purity, error sanitization, native-module load verification, and lint discipline all hold under deliberate-failure tests in addition to the happy path.

**Status `human_needed` reflects two non-blocking items:** (1) the GitHub Actions workflow has not yet been executed on macos-latest (local pipeline is the surrogate); (2) the MCP Inspector spot-check is a recommended manual confidence step before Phase 2 starts wiring real WHOOP errors through the sanitizer. Neither is a gap in the code-level safety nets.

---

_Verified: 2026-05-12_
_Verifier: Claude (gsd-verifier)_
