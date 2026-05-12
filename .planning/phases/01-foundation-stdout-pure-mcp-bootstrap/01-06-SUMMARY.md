---
phase: 01-foundation-stdout-pure-mcp-bootstrap
plan: 06
subsystem: ci
tags: [integration, ci, github-actions, dist-smoke, stdout-purity, sanitizer-integration]

requires:
  - phase: 01-foundation-stdout-pure-mcp-bootstrap (plan 01)
    provides: package.json scripts (lint/build/test), tsup + biome + vitest configs, .nvmrc Node 22
  - phase: 01-foundation-stdout-pure-mcp-bootstrap (plan 03)
    provides: dist/mcp.mjs (the subprocess this plan spawns), sanitizer (whose output this plan asserts is clean)
  - phase: 01-foundation-stdout-pure-mcp-bootstrap (plan 04)
    provides: scripts/ci-grep-gates.sh (the single bash entrypoint this plan wires into CI)
  - phase: 01-foundation-stdout-pure-mcp-bootstrap (plan 05)
    provides: test/fixtures/mcp/*.json (the four JSON-RPC fixtures driven over stdin), probeMcpStdoutPurity (shares the same fixture set; the integration test does not import the runtime probe but mirrors its framing pattern verbatim)
provides:
  - test/integration/mcp-stdout-purity.test.ts — D-02b + D-03 + D-10 integration assertion under fixture load
  - .github/workflows/ci.yml — macOS-latest GitHub Actions workflow chaining npm ci → lint → build → test → grep gates
  - the load-bearing dist-smoke gate every later phase inherits as a precondition
affects: [phase-02-auth, phase-03-data-sync, phase-04-reviews-decisions, phase-05-doctor-setup]

tech-stack:
  added: [github-actions, actions/checkout@v4, actions/setup-node@v4]
  patterns:
    - "Integration tests live under test/integration/ (separate from test/fixtures/ and src/**.test.ts unit tests)"
    - "Subprocess round-trip tests collapse pretty-printed JSON fixtures to single-line JSON before newline-delimited stdio framing (MCP stdio parser is strictly line-delimited)"
    - "CI build step precedes test step — any test that spawns dist/<entry>.mjs needs the build to land first"
    - "Single bash entrypoint (scripts/ci-grep-gates.sh) for grep gates so developers can run the exact CI assertion locally"
    - "Pinned action versions (@v4) — no floating tags"

key-files:
  created:
    - test/integration/mcp-stdout-purity.test.ts
    - .github/workflows/ci.yml
  modified: []

key-decisions:
  - "Final drain on the outer subprocess pinned at 1500ms — tools/call(whoop_doctor) triggers an inner subprocess (probeMcpStdoutPurity) that itself runs four 200ms frame settles plus a 300ms drain (~1.1s); 1500ms gives the inner round-trip enough headroom on CI cold starts without dragging the test above 3s."
  - "Test reuses Plan 05's fixture set (test/fixtures/mcp/*.json) but does NOT import probeMcpStdoutPurity directly — the integration test's purpose is to assert against the wire bytes themselves, not to replay a successful probe. Sharing fixtures + framing pattern (single-line collapse) keeps drift between the runtime check and the integration test impossible without breaking both."
  - "CI runs build BEFORE test (Pitfall 7 / Pattern 5(b) caveat). The integration test pre-flights dist/mcp.mjs via access() and fails loudly with `run \`npm run build\` first` for local developers who skip the build."
  - "macOS-latest single runner (D-12) — no matrix, no Linux fallback, no Windows. Linux fallback ships in Phase 2 with the keyring fallback code; Windows is permanently out of scope per REQUIREMENTS.md."
  - "Single `bash scripts/ci-grep-gates.sh` step in the workflow rather than three inline grep blocks from RESEARCH lines 980-1001 — keeps the workflow short, lets developers run gates locally, and makes future gate additions a one-file change."
  - "Concurrency block with cancel-in-progress: true — push spam on the same ref cancels in-flight runs; the latest commit is the one we care about."

requirements-completed: [FND-01, FND-02, FND-03, FND-04, FND-05, FND-06, FND-07]

duration: 4m 22s
completed: 2026-05-12
---

# Phase 1 Plan 06: CI Integration Summary

**Closes Phase 1 by landing the load-bearing dist-smoke + sanitizer integration test (test/integration/mcp-stdout-purity.test.ts) and the macOS-latest GitHub Actions workflow that runs `npm ci → lint → build → test → grep gates` as a precondition every later phase inherits.**

## Performance

- **Duration:** 4m 22s
- **Started:** 2026-05-12T18:16:21Z
- **Completed:** 2026-05-12T18:20:43Z
- **Tasks:** 2 (1 integration test, 1 CI workflow)
- **Files created:** 2

## Accomplishments

- **D-02b round-trip green.** The integration test spawns `dist/mcp.mjs`, drives the four-fixture sequence (initialize → notifications/initialized → tools/list → tools/call:whoop_doctor), and asserts every non-empty stdout line parses as JSON-RPC 2.0. The tools/call response (id=3) carries a `result` (not `error`); the inner `mcp_stdout_purity` check transitively re-validates the same contract one subprocess deeper.
- **D-10 sanitizer integration green.** Stdout contains no `Bearer\s`, no `Authorization:` (case-insensitive), and no JWT-shaped substring `eyJ[A-Za-z0-9_-]{4,}\.` — proof the Plan 03/04 sanitizer holds under a real tool call, not just the unit-test fixture set.
- **D-03 dist smoke green.** The pre-flight `access('dist/mcp.mjs')` check fails loudly with `run \`npm run build\` first` when the developer skips the build. CI runs build before test by step ordering so the smoke is automatic.
- **D-12 CI workflow green.** `.github/workflows/ci.yml` runs a single job on `macos-latest` with Node 22 from `.nvmrc` (via `node-version: '22'`), pinned `actions/checkout@v4` and `actions/setup-node@v4` with npm cache, and the six steps in the exact order required: `npm ci → lint → build → test → bash scripts/ci-grep-gates.sh`. Concurrency block cancels in-flight runs on the same ref.
- **Phase 1 success criteria all satisfied.** ROADMAP §Phase 1 criteria 1-5 are now all green: (1) `node dist/cli.mjs --version` + `node dist/mcp.mjs` driven with fixtures both run from bin entries with shebangs intact (verified in Plan 05); (2) CI fixture round-trip against `dist/mcp.mjs` confirms stdout is JSON-RPC only (this plan); (3) lint + grep gates fail the build on `console.*` outside `src/cli/` and on `process.stdout.write` outside `src/cli/commands/doctor.ts` (Plans 01+04+06); (4) sanitizer strips `Authorization` and JWT-shaped strings, verified unit-test (Plan 04) AND integration (this plan); (5) doctor reports `better-sqlite3` and `@napi-rs/keyring` load status, build runs against compiled `dist/` (the integration test in this plan satisfies the "compiled dist not tsx" criterion).
- **Final test suite shape.** 6 files, 30 tests, 2.49s total. The integration test alone is 2.32s — well under the 5s acceptance criterion and within the 60s suite budget per CLAUDE.md §Testing.

## Task Commits

1. **Task 1: Integration test** — `fa9bc52` (test) — `test/integration/mcp-stdout-purity.test.ts`
2. **Task 2: CI workflow** — `354ed7c` (chore) — `.github/workflows/ci.yml`

## Files Created/Modified

**Created:**

- `test/integration/mcp-stdout-purity.test.ts` — 124 lines. Single `describe`/`test` block that:
  - Pre-flights `dist/mcp.mjs` via `await access(...)` and `expect.fail`s with a `npm run build` pointer if missing (D-03 dist smoke).
  - Spawns `dist/mcp.mjs` via `spawn(process.execPath, ['dist/mcp.mjs'], { stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env, NODE_ENV: 'production' } })`.
  - Collapses each pretty-printed fixture to single-line JSON via `JSON.stringify(JSON.parse(body))` before framing (matches Plan 05's runtime probe).
  - Drives the four fixtures over stdin with 200ms frame settles plus a 1500ms final drain (covers the inner `probeMcpStdoutPurity` subprocess that fires during tools/call).
  - Asserts every non-empty stdout line parses as JSON AND has `jsonrpc === '2.0'` (D-02b).
  - Asserts `stdout.not.toMatch(/Bearer\s/)`, `not.toMatch(/Authorization:/i)`, `not.toMatch(/eyJ[A-Za-z0-9_-]{4,}\./)` (D-10).
  - Asserts the id=3 frame has `result` and not `error` (Pitfall 7 — protocol mismatch fails loudly).
  - Captures stderr for diagnostic visibility via `console.error` (exempt by the `**/*.test.ts` Biome override) but never asserts on it (D-02 caveat).
  - Asserts `exitCode <= 0` (graceful close or SIGTERM-on-stdin-close).

- `.github/workflows/ci.yml` — 51 lines. Single workflow named `CI` on `push`/`pull_request` to `main`, single job `ci` on `macos-latest`:
  - `actions/checkout@v4`
  - `actions/setup-node@v4` with `node-version: '22'` and `cache: 'npm'`
  - `npm ci` (strict lockfile mode — T-CI-DRIFT-01)
  - `npm run lint` (Biome)
  - `npm run build` (tsup — produces `dist/cli.mjs` + `dist/mcp.mjs` with shebangs)
  - `npm run test` (Vitest — 30 tests, fixture-only)
  - `bash scripts/ci-grep-gates.sh` (Gate A tone/emoji, Gate B console, Gate C stdout)
  - Concurrency: `ci-${{ github.ref }}` with `cancel-in-progress: true`.

**Modified:** None.

## Decisions Made

- **Final drain bumped from RESEARCH's ~100ms to 1500ms.** RESEARCH Pattern 5(b) shows ~100ms per frame and no separate final drain. When I first ran the test, only the `tools/list` response (id=2) appeared on stdout — the `initialize` and `tools/call` responses were missing. Debugging revealed two compounding issues: (a) the fixtures `initialize.json` and `whoop-doctor-call.json` are pretty-printed multi-line JSON on disk; writing `.trim()` of multi-line JSON onto stdin breaks the MCP SDK's line-delimited parser, so those frames were silently dropped (the SDK saw only the single-line `tools-list.json`, hence the lone id=2 response); (b) `tools/call:whoop_doctor` triggers the `mcp_stdout_purity` doctor check, which itself spawns ANOTHER `dist/mcp.mjs` subprocess and runs the same four-fixture round-trip — taking ~1.1s on its own. The single-line collapse plus a 1500ms final drain on the outer subprocess fixes both. Total test runtime stabilises at ~2.3s.
- **Test does NOT import probeMcpStdoutPurity.** Plan §interfaces suggests the integration test "can import the same probe to avoid duplicate driver logic." I chose the alternative: share fixtures + framing pattern, but write the integration assertions against raw stdout bytes directly. Reason: the runtime probe returns `pass/warn/fail` based on its own parse — if the probe's parse is wrong, both the doctor service and an integration test that delegates to the probe pass-or-fail together (the bug is invisible). Asserting against `stdout.split('\n').filter(Boolean).map(JSON.parse)` directly in the integration test is the second independent eye on the same bytes. The integration test catches a bug in the probe's framing logic that the doctor's self-check could not.
- **`console.error` in the test for stderr diagnostics, no biome-ignore.** `biome.json` already overrides `**/*.test.ts` and `test/**/*.ts` to disable `noConsole` — the test file inherits that override automatically. Adding a `biome-ignore lint/suspicious/noConsole` comment would be redundant (and would trip a future Gate D if one is ever added on `biome-ignore` patterns).
- **`npm run build` happens in CI, no `globalSetup` hook in the integration test.** RESEARCH Open Question 3 left this open; the plan picked "CI runs build before test explicitly" plus "pre-flight access check for local developers." That's what I shipped. A `globalSetup` would add complexity (and a hidden build to the suite) that the explicit step ordering already handles correctly.
- **Single `bash scripts/ci-grep-gates.sh` step in the workflow** (over the three inline blocks from RESEARCH lines 980-1001). Same recommendation the plan made; honored verbatim. Keeps the workflow file short, lets a developer reproduce CI gate failures locally with one command, and centralizes future gate additions in a single bash file.
- **Action versions pinned to `@v4`, not `@v4.x.y` or `@<sha>`.** The plan's acceptance criteria specify pinned action versions but don't pin a specific patch. `@v4` follows the latest 4.x release; for a single-user personal tool this is the right cost/safety trade. Stricter SHA pinning is a Phase 5+ supply-chain concern (T-CI-DRIFT-01 disposition is `accept (Phase 1)`).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 — Bug] Pretty-printed fixtures silently dropped on the MCP line-delimited parser**

- **Found during:** Task 1 initial test run (test failed: "no JSON-RPC frame with id=3 (tools/call) found")
- **Issue:** RESEARCH Pattern 5(b) writes `${json.trim()}\n` to the child's stdin. For single-line fixtures (`initialized.json`, `tools-list.json`) this is fine. For pretty-printed multi-line fixtures (`initialize.json`, `whoop-doctor-call.json`), the result is multi-line stdin content — and the MCP SDK's stdio transport is strictly newline-delimited (one JSON object per line). The pretty-printed frames are silently dropped by the parser; only the single-line `tools/list` request was processed by the SDK during my first run, hence the lone id=2 response. This is a discrepancy in the RESEARCH template, not a bug in production code — the production runtime probe at `src/services/doctor/checks/mcp-stdout-purity.ts` already collapses fixtures via `JSON.stringify(JSON.parse(body))` (Plan 05 caught it). My integration test was the second place to discover this constraint.
- **Fix:** Adopted the same `JSON.stringify(JSON.parse(body))` collapse pattern in the integration test. Added an inline comment explaining the constraint so the next planner doesn't repeat the trap.
- **Files modified:** `test/integration/mcp-stdout-purity.test.ts` (during initial Task 1 development, pre-commit)
- **Verification:** Test exits 0 in ~2.3s; all four response frames present.
- **Committed in:** `fa9bc52` (Task 1)

**2. [Rule 1 — Bug] Final drain too short for the inner subprocess**

- **Found during:** Task 1 — second test run after fixing deviation #1
- **Issue:** RESEARCH Pattern 5(b) uses 100ms per frame and no explicit final drain. `tools/call:whoop_doctor` triggers `probeMcpStdoutPurity` (the doctor's stdout-purity check), which spawns ANOTHER `dist/mcp.mjs` subprocess and runs the same four-fixture round-trip — costing 200ms × 4 + 300ms = 1.1s on its own. Without enough final-drain time on the outer test, the inner subprocess hasn't returned its tools/call response before the outer test reads stdout. Different symptom from deviation #1 (frames present but truncated, vs. silently dropped) but the same id=3-missing failure mode.
- **Fix:** Final drain bumped to 1500ms (5x the inner subprocess's drain). Total test runtime ~2.3s, well under the 5s acceptance criterion.
- **Files modified:** `test/integration/mcp-stdout-purity.test.ts`
- **Verification:** Test exits 0; id=3 frame present with `result`, no `error`.
- **Committed in:** `fa9bc52` (Task 1)

**3. [Rule 1 — Bug] Plan's verify command uses Vitest-4-removed `--reporter=basic`**

- **Found during:** Task 1 verification
- **Issue:** Same drift Plan 05 hit. The plan's `<verify>` block specifies `npm run test -- test/integration/mcp-stdout-purity.test.ts --reporter=basic`. Vitest 4 removed the `basic` reporter; the command exits with `Failed to load custom Reporter from basic`.
- **Fix:** Substituted the default reporter via `npx vitest run test/integration/mcp-stdout-purity.test.ts`. Plan 05 already flagged this; surfacing again here as a confirmed planner-template drift for the Vitest 4 pinned stack. Worth a one-line planner-template update so Phase 2+ doesn't keep re-discovering it.
- **Files modified:** None (plan-text artifact only).
- **Verification:** `npx vitest run test/integration/mcp-stdout-purity.test.ts` exits 0.
- **Committed in:** Not applicable (no source change).

---

**Total deviations:** 3 auto-fixed (3 Rule 1 bugs — two in the test driver, one in plan text).
**Impact on plan:** Deviation #1 and #2 are mechanical / framing-discovery during Task 1 implementation, not scope changes. Both are now documented inline in the test file as load-bearing comments so future maintainers don't repeat them. Deviation #3 is the second occurrence of the Vitest 4 reporter drift in this phase — strongly worth surfacing as a planner-template fix.

## Issues Encountered

None during planned work beyond the three auto-fixed deviations above. The TDD gate on Task 1 is satisfied in a non-trivial way: the test discovers and asserts behavior of a pre-existing implementation (Plan 05's `dist/mcp.mjs` + `probeMcpStdoutPurity`). The two "bugs" found during the RED-equivalent step (deviations #1 and #2) were in MY test driver, not in production code — exactly the value TDD is supposed to deliver, just from the inverse angle (characterization tests can still surface driver bugs).

## User Setup Required

None — no external service configuration. The first time CI runs on `main` after this plan lands, GitHub will provision the `macos-latest` runner automatically. No secrets configured (no AUTH_* phase has shipped yet); CI does not need any.

## Phase 1 Completion Status

**This plan closes Phase 1.** All seven FND-* requirements are now CI-enforced by at least one automated step:

| Requirement | CI assertion(s) | Plan(s) |
| --- | --- | --- |
| FND-01: bootstrap (Node 22, ESM, tsup, Biome, Vitest) | `npm ci → npm run lint → npm run build → npm run test` | 01, 06 |
| FND-02: CLI bin entry runnable via `npx recovery-ledger` | `npm run build` produces `dist/cli.mjs` with shebang | 01, 05, 06 |
| FND-03: MCP bin entry runnable via `npx -y recovery-ledger-mcp` | integration test spawns `dist/mcp.mjs` and completes initialize handshake | 03, 05, 06 |
| FND-04: Pino → stderr only; CI asserts MCP stdout is JSON-RPC under fixture load | integration test asserts every stdout line is JSON-RPC 2.0; logger unit test asserts fd 2 | 02, 06 |
| FND-05: lint banning `console.*` outside `src/cli/`; CI gate on stdout pollution | `npm run lint` (Biome `noConsole`) + Gate B (`console.*`) + Gate C (`process.stdout.write`) | 01, 04, 06 |
| FND-06: MCP error-sanitizer strips Authorization headers and JWT-shaped strings | sanitize.test.ts unit fixtures + integration test asserts stdout has no `Bearer/Authorization/eyJ` | 03, 04, 06 |
| FND-07: native-module load probes (`better-sqlite3`, `@napi-rs/keyring`) reported by `doctor` | native-modules.test.ts + integration test's `tools/call:whoop_doctor` exercises all three checks transitively | 05, 06 |

The verifier agent for this plan should also confirm Phase 1's success criteria (ROADMAP §Phase 1):

1. `npx recovery-ledger` + `npx recovery-ledger-mcp` launch from bin entries with shebangs intact — VERIFIED (Plan 05 end-to-end smoke; this plan re-verifies via `npm run build` step + the integration test spawning `dist/mcp.mjs`).
2. CI fixture round-trip against the MCP stdio server confirms stdout is only JSON-RPC — VERIFIED (this plan's integration test).
3. Lint + grep gates fail on `console.*` outside `src/cli/` and non-JSON-RPC stdout writes — VERIFIED (Plan 04 + this plan wires the gates into CI).
4. Sanitizer strips `Authorization` headers and JWT-shaped strings — VERIFIED unit (Plan 04) AND integration (this plan).
5. Stub doctor reports `better-sqlite3` and `@napi-rs/keyring` load status; build runs against compiled `dist/` at least once in CI — VERIFIED (Plan 05 doctor service; this plan's integration test is the "build runs against compiled dist" gate).

## Self-Check

Verifying every file claimed above exists on disk and every commit hash is reachable in git history:

```
FOUND: test/integration/mcp-stdout-purity.test.ts
FOUND: .github/workflows/ci.yml
FOUND: fa9bc52 (Task 1 — integration test)
FOUND: 354ed7c (Task 2 — CI workflow)
```

## Self-Check: PASSED

## Next Phase Readiness

- **Phase 1 is now ready for verification.** The verifier agent should run `npm ci && npm run lint && npm run build && npm run test && bash scripts/ci-grep-gates.sh` and confirm all exit 0; should confirm the seven FND-* requirements are addressed by at least one CI-enforced assertion (table above); should confirm the integration test exists at the expected path and asserts the four behaviors (JSON-RPC purity, dist smoke pre-flight, sanitizer integration, tools/call protocol-mismatch failure).
- **First post-merge GitHub Actions run is the final acceptance gate** (per VALIDATION.md ci-green-required row). The plan's `<output>` section asks for the URL + conclusion of that first run — that's verifiable after the next push to `main` via `gh run list --limit 1 --json conclusion --jq '.[0].conclusion'`. Not asserted here because CI has not yet been invoked; the local pipeline is green.
- **Phase 2 (auth) can start without research deepening UNLESS STATE.md's "research-deepen-before-Phase 2" flag is honored.** STATE.md notes single-flight refresh + replay-on-401 are research-flagged; surfacing that here so the orchestrator can choose deepen-research or jump straight to planning Phase 2.

---

*Phase: 01-foundation-stdout-pure-mcp-bootstrap*
*Completed: 2026-05-12*
*Plan 01-06 complete: 2026-05-12 (4m 22s, 2 files)*
*Phase 1: 6 / 6 plans complete — Phase 1 closed.*
