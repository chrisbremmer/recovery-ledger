---
phase: 02-oauth-token-store-single-flight-refresh
plan: 08
subsystem: testing
tags: [auth-concurrency, cross-process, fork, msw-alternative-real-http, adr-0002, auth-05, auth-06, ci-matrix, d-17-attestation, tsup-entry, regression-lock]

# Dependency graph
requires:
  - phase: 02-oauth-token-store-single-flight-refresh
    provides: src/infrastructure/whoop/token-store.ts (ADR-0002 three-layer gate; WHOOP_TOKEN_URL env override; RECOVERY_LEDGER_FORCE_FILE_STORE recognition); src/infrastructure/whoop/oauth.ts (URL constants); src/infrastructure/whoop/errors.ts (AuthError FROZEN at 6 kinds); src/services/refresh-orchestrator.ts (callWithAuth chokepoint); src/services/doctor/checks/auth.ts + token-freshness.ts (offline-safe probes used by whoop_doctor in G-03); src/mcp/sanitize.ts + register.ts (D-18 wrapper that scrubs tool-call returns)
  - phase: 01-foundation-stdout-pure-mcp-bootstrap
    provides: test/integration/mcp-stdout-purity.test.ts (subprocess-driver shape mirrored verbatim in G-03); src/services/doctor/checks/mcp-stdout-purity.ts (FRAME_SETTLE_MS + four-fixture JSON-RPC handshake pattern); test/fixtures/mcp/*.json (the four-fixture JSON-RPC sequence reused for G-03); dist/mcp.mjs (Phase 1's load-bearing build artifact)
provides:
  - tests/integration/auth-concurrency.test.ts — load-bearing AUTH-05 cross-process test + AUTH-06 grep gate across three surfaces + D-17 runtime attestation (7 tests)
  - tests/integration/helpers/child-get-token.mjs — child fork helper that imports the compiled tokenStore and prints {accessToken, storageMode} to stdout
  - .github/workflows/ci.yml (modified) — matrix expanded to macos-latest + ubuntu-latest; Linux row sets RECOVERY_LEDGER_FORCE_FILE_STORE=1
  - tsup.config.ts (modified) — entry map extended with src/infrastructure/whoop/token-store.ts so dist/infrastructure/whoop/token-store.mjs is emitted as a top-level bundle
  - vitest.config.ts (modified) — include glob extended with tests/**/*.test.ts so the new integration test is discovered
affects: [Phase 3 (sync service inherits the AUTH-05 + AUTH-06 CI gates; cross-process refresh-token-family revocation prevention is now CI-enforced); Phase 5 (doctor extensions can rely on the dist/infrastructure/whoop/token-store.mjs path being emitted by every build)]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Real-HTTP mock in parent + fork() children (NOT MSW): MSW intercepts fetch within a process — useless across child_process.fork() boundaries. The integration test stands a real node:http server in the parent on 127.0.0.1:0 and points children at it via env-var WHOOP_TOKEN_URL. Same pattern as 02-RESEARCH.md lines 996-1026."
    - "Regression-lock TDD variant (per Plan 02-07 precedent): production code is from Plans 02-01..02-06; this plan ships tests + CI wiring that lock in cross-phase coverage. RED gate would only trip if the cross-process gate didn't already work — a phase-2 research-vs-actual delta requiring escalation, not a normal red-green cycle."
    - "Explicit tsup top-level entry for internal modules: tsup with `splitting: false` only emits bundles for entries listed in `entry`. Internal modules consumed by test harnesses (the child helper imports the compiled tokenStore) must be added as explicit entries — adding them via splitting/code-split would change unrelated runtime behavior."
    - "Build-then-test integration test scaffold: beforeAll runs `npm run build` via execAsync and fast-fails with a pointer at tsup.config.ts if the expected dist/ path is missing. Same shape as Phase 1 mcp-stdout-purity.test.ts's `await access(DIST_MCP)` precondition (extended here to assert the new infrastructure/whoop/token-store.mjs path)."
    - "Matrix-conditional env on a GitHub Actions step: `env: VAR: ${{ matrix.os == 'ubuntu-latest' && '1' || '' }}` is the GH Actions idiom for setting a step env only on one row. Avoids splitting into duplicate jobs and keeps the test-step body identical across rows."

key-files:
  created:
    - tests/integration/auth-concurrency.test.ts
    - tests/integration/helpers/child-get-token.mjs
  modified:
    - tsup.config.ts
    - .github/workflows/ci.yml
    - vitest.config.ts

key-decisions:
  - "Regression-lock TDD applied to AUTH-05 cross-process integration test — same precedent as Plan 02-07. The cross-process gate already works because Plan 02-02's tokenStore wires proper-lockfile + atomic write verbatim per ADR-0002; this plan ships the CI proof that it works across child_process.fork() boundaries (not just within one Node process). A failing test would be a Phase 2 actual-vs-research delta requiring escalation, not a normal red-green cycle."
  - "tsup entry map shape — `'infrastructure/whoop/token-store': 'src/infrastructure/whoop/token-store.ts'` uses the slashed-key form so tsup emits at `dist/infrastructure/whoop/token-store.mjs` (mirrors the src tree). The object-form keys are tsup's outDir-relative output names; the string-form `entry: [...]` would lose the directory structure."
  - "vitest.config.ts include glob extended with `tests/**/*.test.ts` (Rule 3 deviation auto-fix). Phase 1's integration test lives at `test/integration/` (singular); the plan-spec'd path `tests/integration/` (plural) is consistent with the existing `tests/helpers/` and `tests/setup/` trees but was not yet in vitest's include glob. Discovered at first `vitest run --run tests/integration/auth-concurrency.test.ts` — the test would have been silently skipped without the glob extension."
  - "G-03 MCP subprocess driver inlined rather than imported from src/services/doctor/checks/mcp-stdout-purity.ts. The probe's `probeMcpStdoutPurity()` is opinionated about its lifecycle (returns a DoctorCheck, has a short FINAL_DRAIN_MS budget, asserts JSON-RPC purity). The integration test needs to capture the full frame stream + drive a specific env override + assert tools/list returns one tool. Inlining the spawn-and-drive pattern (~80 LOC) is cleaner than wrapping the probe."
  - "FORBIDDEN regex shipped as a top-level constant in the test file rather than imported from a shared helper. The regex is the AUTH-06 contract; pinning it to the test file makes the contract grep-visible at the test boundary and avoids a wrong-import hazard if a future helper rewrites the pattern."
  - "Test runtime budget: TEST_TIMEOUT_MS = 30s per test (above the plan's <15s soft target). The 10-child fork + proper-lockfile contention realistically completes in 2-3s on macOS hot caches; the MCP subprocess driver in G-03 adds ~1s. 30s gives headroom for cold CI starts on macos-latest and ubuntu-latest without flakes. Full integration test file completes in ~2.5s locally (well under budget)."

patterns-established:
  - "Pattern: cross-process integration test via real-HTTP mock + fork() children. Parent stands a node:http server, mints a unique counter-based response per POST, then forks N children with WHOOP_TOKEN_URL pointing at the parent's port. Children import the compiled token-store, hit the parent's mock, print results to stdout. Parent collects + asserts. The same shape works for any cross-process coordination test where MSW (which is in-process) cannot bridge."
  - "Pattern: matrix-conditional env on a GH Actions step — `env: VAR: ${{ matrix.os == 'foo' && 'value' || '' }}` for a single-row override without duplicating the step body. Read-only fallback to empty string keeps the env-var declared but unset on other rows."
  - "Pattern: explicit tsup entry for test-imported internal modules. When a test harness imports a compiled internal module from `dist/<path>.mjs`, add the source path to tsup.config.ts's entry map. Internal modules are NOT emitted as siblings without an explicit entry under `splitting: false`."
  - "Pattern: build-then-test integration scaffold. `beforeAll(async () => { await execAsync('npm run build'); if (!existsSync(EXPECTED_PATH)) throw new Error('tsup.config.ts must emit ...'); ... })` — the beforeAll is the load-bearing precondition gate. Same shape applies to any integration test that depends on a compiled artifact."

requirements-completed: [AUTH-05, AUTH-06]

# Metrics
duration: 4m 54s
completed: 2026-05-12
---

# Phase 2 Plan 08: Cross-Process Integration Summary

**Load-bearing AUTH-05 cross-process integration test landed in `tests/integration/auth-concurrency.test.ts`: 10 forked children call `tokenStore.getValidAccessToken()` in parallel against a shared real-HTTP mock in the parent; assertion is `count === 1` (exactly one POST to `/oauth/oauth2/token`) AND `new Set(tokens).size === 1` (all 10 children see the same fresh access_token). AUTH-06 end-to-end `grep -v Bearer` assertion lands across three surfaces: (G-01) captured stderr from all 10 children; (G-02) induced refresh failure stderr; (G-03) MCP `whoop_doctor` tools/call response (JSON.stringify) + full stdout/stderr byte streams. D-17 runtime attestation in G-03: `tools/list` returns EXACTLY one tool (the Phase 1 `whoop_doctor` — Phase 2 added ZERO new MCP tools). D-25 CI matrix expanded to `[macos-latest, ubuntu-latest]` with the ubuntu-latest row setting `RECOVERY_LEDGER_FORCE_FILE_STORE=1` on the Test step. Per checker WARNING PLAN-08-BUILD-DEP, `tsup.config.ts` extended to emit `dist/infrastructure/whoop/token-store.mjs` as an explicit entry; integration test's Wave-0 build-verification fast-fails with a tsup.config.ts pointer if the path is missing. 7 tests green; full suite 231 -> 238 across 19 -> 20 files; lint clean; CI grep gates clean. One Rule-3 deviation auto-fixed: vitest.config.ts `include` glob extended with `tests/**/*.test.ts` so the new test file under `tests/integration/` is discoverable.**

## Performance

- **Duration:** 4 min 54 sec
- **Started:** 2026-05-12T23:28:50Z
- **Completed:** 2026-05-12T23:33:44Z
- **Tasks:** 2 (Task 0 tsup entry; Task 1 integration test + CI matrix)
- **Files modified:** 5 (2 created + 3 modified)
- **Tests added:** 7 (B-01 + I-01..I-03 + G-01..G-03)
- **Full suite:** 231 -> 238 tests across 19 -> 20 files; all green

## Accomplishments

- Shipped the load-bearing AUTH-05 cross-process integration test (D-23.2 / D-24): 10 children forked via `child_process.fork()` import the compiled `tokenStore` from `dist/infrastructure/whoop/token-store.mjs`, call `getValidAccessToken()` in parallel against a shared real-HTTP mock in the parent (`http.createServer` on `127.0.0.1:0`), and the parent asserts `count === 1` AND `new Set(tokens).size === 1`. This is ADR-0002 §Enforcement (line 73-75) verbatim, scaled from the contract's floor of "two concurrent calls" to 10.
- Shipped the AUTH-06 end-to-end grep gate across three surfaces (Phase 2 success criterion #4):
  - **G-01:** captured stderr from all 10 children (happy path) — no Bearer / JWT / Authorization material.
  - **G-02:** induced 400 invalid_grant via the mock's one-shot override; child exits non-zero; stderr contains no token material AND no stale refresh_token echoed.
  - **G-03:** MCP `whoop_doctor` tool driven against the failing mock; tools/call response (JSON.stringify) does not match FORBIDDEN; full stdout + stderr byte streams do not match either.
- D-17 runtime attestation in G-03: `tools/list` response carries EXACTLY one tool (`whoop_doctor`). Phase 2 ships ZERO new MCP tools — verified at both the source-grep level (`grep -rEn 'server.registerTool' src/mcp/` shows the single Phase 1 call site in register.ts line 81) AND at the wire level (G-03 asserts `tools[0].name === 'whoop_doctor'` and `tools.length === 1`).
- D-25 GitHub Actions matrix expanded from a single `runs-on: macos-latest` to `[macos-latest, ubuntu-latest]` with `fail-fast: false`. The Linux row sets `RECOVERY_LEDGER_FORCE_FILE_STORE=1` on the Test step via matrix-conditional env (`${{ matrix.os == 'ubuntu-latest' && '1' || '' }}`) so the file-fallback path is CI-enforced; macOS continues to exercise the keyring backend by default. First post-merge run is the external acceptance gate (per Phase 1 STATE.md precedent).
- Per checker WARNING PLAN-08-BUILD-DEP, `tsup.config.ts` extended with `src/infrastructure/whoop/token-store.ts` as an explicit top-level entry so `dist/infrastructure/whoop/token-store.mjs` is emitted by `npm run build`. Without this, the child helper's `import` would fail with `ERR_MODULE_NOT_FOUND` and the entire test suite would fast-fail. The integration test's `beforeAll` re-runs the build and asserts the path before forking children — defense in depth.
- Full suite: 231 -> 238 across 19 -> 20 files in 5.84s wall-clock locally; lint clean; CI grep gates clean (Gate E enforces ADR-0002 §Enforcement — the production-module restriction on `oauth/oauth2/token` literal references — and stays green throughout).

## Task Commits

Two tasks across two commits:

1. **Task 0 (Wave-0 prereq): tsup entry extension** — `19104de` (build) — `build(02-08): emit dist/infrastructure/whoop/token-store.mjs as explicit tsup entry`. Adds the new entry to the map; preserves existing CLI and MCP entries verbatim. `npm run build` verified to emit the path.
2. **Task 1: cross-process integration test + CI matrix** — `a7c77da` (test) — `test(02-08): cross-process auth-concurrency + grep -v Bearer end-to-end + CI matrix`. Lands the 7-test integration suite, the child helper, the matrix expansion, and the vitest include-glob extension.

_Task 1 is marked `tdd="true"` but follows the regression-lock pattern (same precedent as Plan 02-07): the production code is already deliverable from Plans 02-01..02-06; this plan ships tests + CI wiring that lock in cross-phase coverage. Passing on first run is the EXPECTED outcome — a failure would be a Phase 2 research-vs-actual delta requiring escalation. Single `test(...)` commit rather than RED -> GREEN -> REFACTOR is the correct shape for the regression-lock variant._

## Files Created/Modified

### Created (2)

- `tests/integration/auth-concurrency.test.ts` (628 LOC; 7 tests across one describe block). Imports: `node:child_process` (`spawn`, `fork`), `node:http` (`createServer`), `node:fs/promises` (`mkdtemp`, `readFile`, `rm`, `stat`, `writeFile`), `node:os` (`tmpdir`), `node:path`, `node:url` (`fileURLToPath`), `node:util` (`promisify`), `vitest` (full lifecycle). Top-level constants: `FORBIDDEN` regex, `BUILD_OUTPUT_PATH`, `CHILD_HELPER`, `DIST_MCP`, `TEST_TIMEOUT_MS = 30_000`. Helpers: `startMockServer()` (real `node:http` server with hit counter + one-shot override slot), `seedExpiredToken(tmpDir)` (pre-seeds tokens.json mode 0600 + storage-mode='file' + touches tokens.json.lock), `forkChild(env)` (child_process.fork with silent stdio and stdout/stderr capture), `parseChildStdout(stdout)` (extracts the JSON line from child output), `driveMcpWhoopDoctor(env)` (mirrors test/integration/mcp-stdout-purity.test.ts subprocess driver, parameterized for an env override). beforeAll runs `npm run build` then asserts `existsSync(BUILD_OUTPUT_PATH)` with a tsup.config.ts pointer; beforeEach resets the mock counter, mkdtemps a fresh RECOVERY_LEDGER_HOME, seeds the expired token.
- `tests/integration/helpers/child-get-token.mjs` (41 LOC, 1 default export — `void main()`). Imports the compiled `tokenStore` from `../../../dist/infrastructure/whoop/token-store.mjs`. Calls `getValidAccessToken()` + `readStorageMode()`. Success path prints `JSON.stringify({ok: true, accessToken, storageMode})\n` to stdout, exits 0. Error path duck-types AuthError-shaped errors, prints `JSON.stringify({ok: false, kind})\n` to stderr, exits 1 — deliberately does NOT echo `err.message` verbatim (defense-in-depth against AUTH-06; the integration test asserts no token material in stderr regardless, but the child should never produce it in the first place).

### Modified (3)

- `tsup.config.ts` — `entry` changed from `{ cli: '...', mcp: '...' }` to `{ cli, mcp, 'infrastructure/whoop/token-store': 'src/infrastructure/whoop/token-store.ts' }`. The slashed-key form preserves the directory structure in `dist/`. Module-leading comment cites checker WARNING PLAN-08-BUILD-DEP and explains why an explicit entry is required (default `splitting: false` does not emit internal modules).
- `.github/workflows/ci.yml` — `runs-on: macos-latest` -> `runs-on: ${{ matrix.os }}` + `strategy.matrix.os: [macos-latest, ubuntu-latest]` + `fail-fast: false`. Job-level comment block extended with the D-25 rationale. The `Test` step gains an `env` block that sets `RECOVERY_LEDGER_FORCE_FILE_STORE` to `'1'` on ubuntu-latest and `''` (unset) on macos-latest via the matrix-conditional ternary idiom. Step comment cites D-25 verbatim.
- `vitest.config.ts` — `include` glob extended from `['src/**/*.test.ts', 'test/**/*.test.ts']` to `['src/**/*.test.ts', 'test/**/*.test.ts', 'tests/**/*.test.ts']`. This is a Rule 3 blocking deviation (auto-fixed) — the new test file under `tests/integration/` was not discoverable by vitest without the glob extension. Phase 1's integration test at `test/integration/mcp-stdout-purity.test.ts` (singular `test/`) remains discoverable by the existing glob; both trees co-exist.

### Not Modified (asserted by `git diff --name-only HEAD~2..HEAD`)

- `src/infrastructure/whoop/token-store.ts` — Plan 02-02 contracts consumed unchanged. The integration test imports the compiled bundle, not the source.
- `src/infrastructure/whoop/oauth.ts` — Plan 02-03 contracts unchanged.
- `src/infrastructure/whoop/errors.ts` — AuthError FROZEN at 6 kinds (Plan 02-01 Wave 0 contract preserved across the entire phase).
- `src/services/refresh-orchestrator.ts` — Plan 02-04 contracts unchanged.
- `src/services/doctor/checks/auth.ts` + `src/services/doctor/checks/token-freshness.ts` — Plan 02-06 offline-safe probes consumed unchanged via the G-03 MCP subprocess driver.
- `src/mcp/sanitize.ts` / `src/mcp/register.ts` — D-18 attestation preserved across Plans 02-07 + 02-02 + 02-03 + 02-04 + 02-05 + 02-06 + this plan. ZERO new MCP tool registrations (D-17 runtime-attested by G-03).
- `scripts/ci-grep-gates.sh` — Plan 02-06's Gate E unchanged; this plan does not need to touch any gate.

## Decisions Made

- **Regression-lock TDD variant applied (Plan 02-07 precedent).** The cross-process gate already works because Plan 02-02 wires the three-layer ADR-0002 contract verbatim. This plan's tests verify cross-phase coverage; passing on first run is the EXPECTED outcome. A failing test would be a Phase 2 research-vs-actual delta — not a normal red-green cycle. Single `test(...)` commit per Plan 02-07 precedent.
- **tsup entry map shape uses slashed keys** to preserve the dist/ directory structure. `'infrastructure/whoop/token-store': 'src/infrastructure/whoop/token-store.ts'` emits at `dist/infrastructure/whoop/token-store.mjs` — mirrors the src tree, matches the child helper's import path. The array-form `entry: ['src/...', ...]` would flatten to `dist/token-store.mjs` and require updating the child helper.
- **Real `node:http` server in parent + fork() children (NOT MSW).** MSW intercepts `fetch` within a Node process; it cannot bridge a `child_process.fork()` boundary because each child is a fresh Node process with its own fetch implementation. The integration test stands a real loopback HTTP server in the parent and points children at it via `WHOOP_TOKEN_URL`. Same shape as 02-RESEARCH.md lines 996-1026.
- **G-03 inlines the MCP subprocess driver rather than importing `probeMcpStdoutPurity`.** The probe is opinionated (returns a DoctorCheck, has a short drain budget, asserts JSON-RPC purity). The integration test needs full frame capture + parameterized env + tools/list shape assertion. Inlining ~80 LOC of spawn-and-drive code is cleaner than wrapping a probe whose return type doesn't match the needs.
- **FORBIDDEN regex defined at file top as a top-level constant** rather than imported from a shared helper. This is the AUTH-06 contract; pinning it locally makes the contract grep-visible at the test boundary. A future helper rewrite would be a silent regression; the local constant is the safe shape.
- **TEST_TIMEOUT_MS = 30_000** — well above the plan's <15s soft target. Cold CI starts on macos-latest and ubuntu-latest occasionally take 5-8s for the build + spawn round-trip; 30s gives 2-3x headroom without slowing the typical hot-cache run (~2.5s wall-clock locally).
- **vitest.config.ts include glob extended** to discover `tests/**/*.test.ts`. Phase 1's integration test lives at `test/integration/` (singular); the plan-spec'd path is `tests/integration/` (plural, consistent with the existing `tests/helpers/` and `tests/setup/` trees). Both trees now coexist in the include glob.
- **Matrix-conditional env via the GH Actions ternary idiom** (`${{ matrix.os == 'ubuntu-latest' && '1' || '' }}`) rather than splitting into two jobs. Single job definition; per-row env override; symmetric step bodies. The empty-string fallback keeps the env-var declared but unset on macOS — equivalent to "do not set" from the token-store's perspective (`process.env.RECOVERY_LEDGER_FORCE_FILE_STORE === '1'` is false for both `undefined` and `''`).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 — Blocking] vitest.config.ts `include` glob did not cover `tests/integration/`**

- **Found during:** Task 1, immediately before the first test run.
- **Issue:** Phase 1's integration test lives at `test/integration/mcp-stdout-purity.test.ts` (singular `test/`); the existing `include` was `['src/**/*.test.ts', 'test/**/*.test.ts']`. Plan 02-08 specifies the test path as `tests/integration/auth-concurrency.test.ts` (plural, consistent with the existing `tests/helpers/` and `tests/setup/` trees). Running `vitest run tests/integration/auth-concurrency.test.ts` against the unmodified config would have silently passed with zero collected tests (`passWithNoTests: true`), masking the entire integration suite.
- **Fix:** Extended the `include` glob to `['src/**/*.test.ts', 'test/**/*.test.ts', 'tests/**/*.test.ts']`. Both Phase 1's `test/integration/` and this plan's `tests/integration/` are now discoverable.
- **Files modified:** `vitest.config.ts` (one-line glob extension).
- **Verification:** `npm run test -- --run tests/integration/auth-concurrency.test.ts` discovers and runs the 7 tests; full suite 231 -> 238 across 19 -> 20 files.
- **Committed in:** `a7c77da` (Task 1 — fix made before staging).
- **Planner-template note:** Plans that introduce a test under a new top-level directory should include an acceptance grep / preflight that runs `vitest run --listFiles <glob>` to confirm the test will be collected before declaring the plan ready.

---

**Total deviations:** 1 auto-fixed (Rule 3 — blocking vitest config scope).

**Impact on plan:** None functional. The `vitest.config.ts` extension is mechanical scope-broadening; both `test/` (singular) and `tests/` (plural) trees co-exist without overlap. The plan's `<acceptance_criteria>` pass verbatim on the committed code; AUTH-05, AUTH-06, D-17, D-25, and the PLAN-08-BUILD-DEP checker warning are all satisfied.

## Issues Encountered

- The two parallel test-root directories (`test/` for Phase 1 and `tests/` for Phase 2 helpers + integration) is a low-grade DRY hazard. The vitest include glob now covers both, but a future audit might consolidate them into one tree. Phase 1 chose `test/` and Phase 2 introduced `tests/helpers/` / `tests/setup/` (the helper + setup convention) without explicit decision documentation; this plan continued the Phase 2 convention.
- Test runtime: 7 tests in ~2.5s wall-clock locally is well under the plan's <15s soft target. The MSW alternative (real `node:http` server) is faster than MSW would have been because MSW would not have worked across fork() boundaries — there is no slower-but-more-correct path being deferred here.

## User Setup Required

None — no external service configuration, no env vars, no credentials, no dashboard touchpoints. The integration test uses a real loopback HTTP mock and a synthetic OAuth fixture in the parent. The first post-merge GitHub Actions run on `main` is the external acceptance gate for the CI matrix expansion (per Phase 1 STATE.md precedent line 124).

## Next Phase Readiness

**Phase 2 is now CLOSED.** All eight plans complete:

- 02-01 (Wave 0 infra) ✓
- 02-02 (token-store + ADR-0002 three-layer gate) ✓
- 02-03 (oauth round-trip) ✓
- 02-04 (refresh orchestrator) ✓
- 02-05 (CLI shims init + auth) ✓
- 02-06 (doctor extensions) ✓
- 02-07 (sanitizer fixtures) ✓
- 02-08 (cross-process integration) ✓

All four Phase 2 success criteria are now CI-enforced:

- **#1 (token store with single-flight refresh):** Plans 02-02 + 02-03 + 02-04. ADR-0002 three-layer gate landed; AuthError union FROZEN at 6 kinds; refresh orchestrator is the SOLE consumer of `getValidAccessToken` outside token-store internals.
- **#2 (concurrent-load test, 10 parallel 401s across CLI + MCP):** Plan 02-08 (this plan). 10 forked children, exactly one POST to the token endpoint, all 10 see the same fresh access_token.
- **#3 (Linux file-fallback path):** Plan 02-06 + Plan 02-08 (this plan). Doctor surface reports `auth: file (mode 0600)` when keyring is unavailable; CI matrix's ubuntu-latest row sets `RECOVERY_LEDGER_FORCE_FILE_STORE=1` so the fallback is exercised end-to-end.
- **#4 (grep -v Bearer across all surfaces):** Plan 02-07 (sanitizer fixtures) + Plan 02-08 (this plan). Sanitizer covers every leak shape via the F6/F7 positional matrix; G-01/G-02/G-03 assert no Bearer/JWT/Authorization material in stderr + refresh-failure stderr + MCP error returns.

**Phase 3 (WHOOP sync) input notes:**

- Phase 3's sync service will be the FIRST runtime consumer of `callWithAuth` from `src/services/refresh-orchestrator.ts` (Plan 02-04). The orchestrator wraps every GET against `api.prod.whoop.com`; refresh failure throws `AuthError({kind: 'auth_expired'})` with cause chain preserved for Phase 1's sanitizer (D-18 attestation preserved).
- Phase 3 will introduce real per-resource MSW fixtures under `tests/fixtures/whoop/<resource>/` (the Phase 1 convention — note the `tests/` plural, now formalized in vitest's include glob by this plan).
- Phase 3's WHOOP HTTP client (Plan 03-?? — to be planned) MUST pin requests to `api.prod.whoop.com` (ADR-0007); the orchestrator trusts callers, so the HTTP client is the pinning layer.

**Phase 5 (doctor + setup) input note:** the `dist/infrastructure/whoop/token-store.mjs` path is now reliably emitted by every `npm run build`. Future doctor probes that need to introspect the compiled token-store (none planned) can rely on this path.

**Verifier agent re-run:** Phase 1's open todo "Run the verifier on Phase 1" remains open. Phase 2's verifier run should follow the same convention (`/gsd-verify-phase 2` after the SUMMARY commits land).

No blockers. No open todos surfaced by this plan that Phase 2 itself does not close.

## Self-Check: PASSED

Files verified to exist:
- `tests/integration/auth-concurrency.test.ts`: FOUND (628 LOC; 7 tests across one describe block; 0 console.* calls; FORBIDDEN regex defined; AUTH-05 `toBe(1)` assertion present)
- `tests/integration/helpers/child-get-token.mjs`: FOUND (41 LOC; imports `dist/infrastructure/whoop/token-store.mjs`)
- `tsup.config.ts`: MODIFIED (entry map includes `src/infrastructure/whoop/token-store`)
- `.github/workflows/ci.yml`: MODIFIED (matrix with macos-latest + ubuntu-latest; RECOVERY_LEDGER_FORCE_FILE_STORE matrix-conditional env)
- `vitest.config.ts`: MODIFIED (include glob extended with `tests/**/*.test.ts`)
- `dist/infrastructure/whoop/token-store.mjs`: EMITTED by `npm run build` (8.70 KB)
- `.planning/phases/02-oauth-token-store-single-flight-refresh/02-08-SUMMARY.md`: FOUND (this file, after Write)

Files verified NOT modified by this plan (cross-plan attestations):
- `src/infrastructure/whoop/token-store.ts`: UNMODIFIED (Plan 02-02 contract preserved)
- `src/infrastructure/whoop/errors.ts`: UNMODIFIED (AuthError FROZEN at 6 kinds since Plan 02-01)
- `src/infrastructure/whoop/oauth.ts`: UNMODIFIED (Plan 02-03 contract preserved)
- `src/services/refresh-orchestrator.ts`: UNMODIFIED (Plan 02-04 contract preserved)
- `src/services/doctor/checks/auth.ts` / `src/services/doctor/checks/token-freshness.ts`: UNMODIFIED (Plan 02-06 contract preserved)
- `src/mcp/sanitize.ts` / `src/mcp/register.ts`: UNMODIFIED (D-18 attestation preserved across Plans 02-07 + 02-02 + 02-03 + 02-04 + 02-05 + 02-06 + this plan)
- `scripts/ci-grep-gates.sh`: UNMODIFIED (Plan 02-06's Gate E preserved)

Commits verified in git log:
- `19104de` (Task 0 — build): FOUND
- `a7c77da` (Task 1 — test): FOUND

Acceptance grep checks (from plan `<acceptance_criteria>`):
- `tests/integration/auth-concurrency.test.ts` exists with describe block: PASS
- `tests/integration/helpers/child-get-token.mjs` exists with `dist/infrastructure/whoop/token-store.mjs` import: PASS
- `tsup.config.ts` includes `src/infrastructure/whoop/token-store`: PASS (`grep -nE "src/infrastructure/whoop/token-store" tsup.config.ts` returns 1 match)
- `dist/infrastructure/whoop/token-store.mjs` exists after `npm run build`: PASS (8.70 KB emitted)
- `.github/workflows/ci.yml` matrix includes ubuntu-latest: PASS (`grep -nE 'ubuntu-latest' .github/workflows/ci.yml` returns 3 matches)
- `.github/workflows/ci.yml` sets `RECOVERY_LEDGER_FORCE_FILE_STORE` for ubuntu-latest: PASS
- `npm run build` exits 0: PASS
- `npm run test -- --run tests/integration/auth-concurrency.test.ts` exits 0 with 7 tests: PASS (7/7)
- `expect(count).toBe(1)` appears in the test file (load-bearing AUTH-05 assertion): PASS (line 436)
- FORBIDDEN regex literal `Bearer.*Authorization` appears in the test file: PASS (line 58 + line 506)
- `console.(log|info|warn|error|debug|trace)` in the test file == 0: PASS
- D-17 runtime attestation in G-03 (`tools/list` AND `whoop_doctor` references): PASS (9 matches in the file)
- `npm run test` (full suite) exits 0: PASS (238/238 across 20 files)
- `bash scripts/ci-grep-gates.sh` exits 0: PASS
- `npm run lint` exits 0: PASS
- D-17 source-grep attestation: `grep -rEn 'server.registerTool' src/mcp/` shows exactly one production call site (register.ts line 81) for the Phase 1 `whoop_doctor` tool; ZERO new Phase 2 registrations: PASS

## Threat Flags

None. All threats listed in the plan's `<threat_model>` register (T-02.08-01 through T-02.08-09) are addressed by the implementation as planned:

- **T-02.08-01 (Repudiation / DoS — refresh-token-family revocation under real concurrency)** -> mitigated by Test I-01 asserting exactly one POST across 10 forked children. ADR-0002 §Enforcement contract verified.
- **T-02.08-02 (Information Disclosure — token material in subprocess stderr)** -> mitigated by Test G-01 asserting captured stderr does NOT match FORBIDDEN. The child helper deliberately prints only `err.kind`, never `err.message`.
- **T-02.08-03 (Information Disclosure — token material in MCP error returns)** -> mitigated by Test G-03 asserting the tools/call response (JSON.stringify) does not match FORBIDDEN. Phase 1's register.ts sanitizer + Plan 02-07 fixtures cover the leak shapes; G-03 is the end-to-end proof. D-17 attestation: tools/list returns exactly one tool.
- **T-02.08-04 (Tampering — partial write under cross-process contention)** -> mitigated by Test I-02 asserting `tokens.json.tmp` does NOT exist after the test AND `tokens.json` mode is 0o600.
- **T-02.08-05 (DoS — stale lockfile from killed child)** -> mitigated by `proper-lockfile` `stale: 5000` (Plan 02-02) + afterEach cleanup. Test I-03 verifies the lock was released.
- **T-02.08-06 (Spoofing — hostile token endpoint via env-var override)** -> ACCEPTED. WHOOP_TOKEN_URL override is test-only; production CI never sets it.
- **T-02.08-07 (Tampering — CI matrix bypass)** -> mitigated by the matrix.os list including BOTH `macos-latest` AND `ubuntu-latest`. The first post-merge GitHub Actions run is the external acceptance gate.
- **T-02.08-08 (Information Disclosure — npm build artifact leaks token-store internals)** -> ACCEPTED. dist/ files are not committed; they are CI-build outputs.
- **T-02.08-09 (Tampering — child helper imports a stale dist/ file)** -> mitigated by `beforeAll` running `npm run build` AND asserting `existsSync(BUILD_OUTPUT_PATH)`. Test B-01 fast-fails with a useful error if tsup.config.ts is mis-configured.

No threat flags to surface for downstream plans. The new files do not introduce surface that wasn't already in the threat register.

## TDD Gate Compliance

Task 1 (`tdd="true"`) follows the regression-lock TDD variant (same precedent as Plan 02-07 — see that plan's SUMMARY for the canonical description):

- **RED:** N/A — the production code is from Plans 02-01..02-06. The RED gate would only trip if the cross-process gate didn't already work, which would be a phase-2 research-vs-actual delta requiring escalation to the planner (per the plan's `<action>` guidance: "If a fixture fails to produce the expected redaction... STOP and document the failure"). No such trip occurred.
- **GREEN:** `a7c77da` (`test(02-08): cross-process auth-concurrency + grep -v Bearer end-to-end + CI matrix`) — single commit; all 7 tests pass against unchanged production code from Plans 02-01..02-06.
- **REFACTOR:** N/A — no production code touched.

The commit is typed `test(...)` rather than `feat(...)` because no new behavior is added; the tests + CI wiring lock in CI coverage of existing behavior. Task 0 (`tdd` not set) is a pure build-config change typed `build(...)`.

The plan-level TDD gate is satisfied per the regression-lock pattern. The RED -> GREEN -> REFACTOR cycle does not apply when the system under test is already implemented; the load-bearing question is "does the existing implementation cover the new test cases?" and the answer is yes, verified by 7/7 green.

---
*Phase: 02-oauth-token-store-single-flight-refresh*
*Plan: 02-08-cross-process-integration*
*Completed: 2026-05-12*
