---
phase: 01-foundation-stdout-pure-mcp-bootstrap
plan: 05
type: execute
wave: 3
depends_on:
  - 03
files_modified:
  - src/cli/index.ts
  - src/cli/commands/doctor.ts
  - src/services/index.ts
  - src/services/doctor/index.ts
  - src/services/doctor/checks/native-modules.ts
  - src/services/doctor/checks/mcp-stdout-purity.ts
  - src/services/doctor/checks/native-modules.test.ts
  - src/services/doctor/index.test.ts
  - src/formatters/doctor.txt.ts
  - src/formatters/doctor.txt.test.ts
autonomous: true
requirements:
  - FND-02
  - FND-03
  - FND-07
requirements_addressed:
  - FND-02
  - FND-03
  - FND-07
tags:
  - cli
  - doctor
  - native-modules
  - formatter
must_haves:
  truths:
    - "D-05: `recovery-ledger doctor` runs three checks — (1) `better-sqlite3` native-module load probe, (2) `@napi-rs/keyring` native-module load probe, (3) `mcp_stdout_purity` self-test that spawns its own `dist/mcp.mjs` subprocess and runs the D-02 JSON-RPC fixture sequence; the self-test is the same code as the Plan 06 integration test, factored into `src/services/doctor/checks/mcp-stdout-purity.ts`"
    - "`node dist/cli.mjs --version` prints `0.1.0` to stdout and exits 0"
    - "`node dist/cli.mjs doctor` writes a `{checks, overall}` JSON object to stdout and exits 0 when all three checks pass"
    - "`node dist/cli.mjs doctor --text` writes a compact plaintext rendering of the same result and exits 0"
    - "`better-sqlite3` load probe returns `pass` after opening `:memory:` and closing"
    - "`@napi-rs/keyring` load probe returns `pass` after constructing a no-op `Entry`"
    - "`mcp-stdout-purity` check spawns `dist/mcp.mjs` as a subprocess, drives the four JSON-RPC fixtures, and returns `pass` if stdout contains only valid JSON-RPC frames"
    - "`createServices()` returns a Services struct whose `runDoctor()` composes all three checks and derives `overall` per D-06"
    - "`process.stdout.write` appears in `src/cli/commands/doctor.ts` and NOWHERE ELSE in `src/`"
  artifacts:
    - path: "src/cli/index.ts"
      provides: "Commander entry — `--version` and `doctor` subcommand with `--text` option (OVERWRITES Plan 03's one-line `export {};` stub)"
      contains: "program.command('doctor')"
    - path: "src/cli/commands/doctor.ts"
      provides: "5-line shim: `runDoctor()` → JSON or plaintext via process.stdout.write"
      exports: ["runDoctorCommand"]
    - path: "src/services/doctor/index.ts"
      provides: "Real `runDoctor()` composing three checks; replaces the Plan 03 stub"
      exports: ["runDoctor", "DoctorCheck", "DoctorResult"]
    - path: "src/services/doctor/checks/native-modules.ts"
      provides: "Two load probes — `probeBetterSqlite3` and `probeKeyring`"
      exports: ["probeBetterSqlite3", "probeKeyring"]
    - path: "src/services/doctor/checks/mcp-stdout-purity.ts"
      provides: "Subprocess driver — `probeMcpStdoutPurity()`; reused by Plan 06's integration test"
      exports: ["probeMcpStdoutPurity"]
    - path: "src/formatters/doctor.txt.ts"
      provides: "Named export `renderDoctor(result): string` — compact plaintext rendering"
      exports: ["renderDoctor"]
  key_links:
    - from: "src/cli/index.ts"
      to: "src/cli/commands/doctor.ts"
      via: "program.command('doctor').action(runDoctorCommand)"
      pattern: "\\.action\\(runDoctorCommand\\)"
    - from: "src/cli/commands/doctor.ts"
      to: "src/services/doctor/index.ts"
      via: "import { runDoctor } from '../../services/doctor/index.js'"
      pattern: "from\\s+['\"]\\.\\.\\/\\.\\.\\/services\\/doctor"
    - from: "src/services/index.ts"
      to: "src/services/doctor/index.ts"
      via: "createServices() returns { runDoctor }"
      pattern: "runDoctor"
    - from: "src/services/doctor/index.ts"
      to: "src/services/doctor/checks/*"
      via: "Promise.all([probeBetterSqlite3(), probeKeyring(), probeMcpStdoutPurity()])"
      pattern: "Promise\\.all"
---

<objective>
Land the CLI entry and the real doctor service: three checks composed into a `DoctorResult`, rendered as JSON-by-default to stdout (the one place in the codebase where `process.stdout.write` is allowed), with a `--text` plaintext fallback. This plan replaces Plan 03's stub `createServices()` AND the one-line `src/cli/index.ts` stub with the real composition, and gives Phase 4's MCP tools a precedent for the JSON+text dual-output shape (MCP-02).

Purpose: FND-02 (CLI bin entry runnable), FND-03 (CLI version banner — the MCP version banner is the `initialize` response handled in Plan 06), and FND-07 (native-module load verification via doctor) all close here. D-05 prescribes exactly three checks; D-06 prescribes the output shape and that JSON is default with `--text` for plaintext.

Output: Ten files (six source + four test). Split across three tasks for context discipline: Task 1a lands the doctor service core (six files — checks, composition, services barrel, fixtures), Task 1b lands the formatter + three test files (four files), and Task 2 lands the CLI entry pair. The `mcp-stdout-purity` check is factored exactly as D-05 dictates: one implementation, used by both `runDoctor()` and Plan 06's integration test. After this plan, `npm run build && node dist/cli.mjs doctor` produces a real `DoctorResult` JSON; Plan 06 will use the same code path from inside an integration test.
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
@.planning/research/ARCHITECTURE.md
@.planning/research/PITFALLS.md
@.planning/phases/01-foundation-stdout-pure-mcp-bootstrap/01-CONTEXT.md
@.planning/phases/01-foundation-stdout-pure-mcp-bootstrap/01-RESEARCH.md
@.planning/phases/01-foundation-stdout-pure-mcp-bootstrap/01-VALIDATION.md
@CLAUDE.md
@package.json
@tsup.config.ts
@biome.json
@src/mcp/index.ts
@src/services/index.ts

<interfaces>
<!-- The interfaces this plan creates and the upstream contracts it honors. -->

// From Plan 03 (services/index.ts STUB — to be REPLACED by Task 1a here):
export interface Services { runDoctor: () => Promise<DoctorResult>; }
export interface DoctorCheck { name: string; status: 'pass'|'warn'|'fail'; detail: string; }
export interface DoctorResult { checks: DoctorCheck[]; overall: 'pass'|'warn'|'fail'; }
export function createServices(): Services;

// New surface this plan creates:
export async function runDoctor(): Promise<DoctorResult>;        // services/doctor/index.ts
export async function probeBetterSqlite3(): Promise<DoctorCheck>; // services/doctor/checks/native-modules.ts
export async function probeKeyring(): Promise<DoctorCheck>;       // services/doctor/checks/native-modules.ts
export async function probeMcpStdoutPurity(): Promise<DoctorCheck>; // services/doctor/checks/mcp-stdout-purity.ts
export function renderDoctor(r: DoctorResult): string;            // formatters/doctor.txt.ts
export async function runDoctorCommand(opts: { text?: boolean }): Promise<void>; // cli/commands/doctor.ts

// Commander 14 surface (Pitfall 3 — use named export):
import { Command } from 'commander';
// new Command(); .name(); .version(); .description(); .command(name); .option(); .action(); .parseAsync(argv);

// JSON-RPC fixtures (created in Plan 06 OR pre-staged here):
// test/fixtures/mcp/initialize.json, initialized.json, tools-list.json, whoop-doctor-call.json
// (the subprocess check needs them at runtime, not just at test time — the doctor self-test
//  reads from the same path. Plan 05 creates the fixtures so the doctor probe works standalone;
//  Plan 06 reuses them for the integration test. Plan 05 OWNS the fixtures.)
</interfaces>
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1a: Doctor service core — three checks + composition + Services barrel + fixtures</name>
  <files>src/services/doctor/index.ts, src/services/doctor/checks/native-modules.ts, src/services/doctor/checks/mcp-stdout-purity.ts, src/services/index.ts, test/fixtures/mcp/initialize.json, test/fixtures/mcp/initialized.json, test/fixtures/mcp/tools-list.json, test/fixtures/mcp/whoop-doctor-call.json</files>
  <read_first>
    - .planning/phases/01-foundation-stdout-pure-mcp-bootstrap/01-RESEARCH.md (Pattern 6 — native-module probes; Pattern 7 — runDoctor composition; Pattern 5(b) — subprocess driver; JSON-RPC fixture content lines 587-605; Assumption A3 — keyring API)
    - .planning/phases/01-foundation-stdout-pure-mcp-bootstrap/01-CONTEXT.md (D-05 — three checks; D-06 — output shape + JSON default + --text flag)
    - .planning/phases/01-foundation-stdout-pure-mcp-bootstrap/01-VALIDATION.md (native-load-probe + doctor-output-shape rows)
    - src/services/index.ts (Plan 03 STUB — replace `createServices` body to delegate to real `runDoctor`)
    - tsup.config.ts (so the executor knows `better-sqlite3` + `@napi-rs/keyring` are `external` and will be loaded at runtime from `node_modules/`, NOT bundled)
    - CLAUDE.md §Critical Rules (MCP stdout purity — even the subprocess driver must not log to stdout from the parent process)
  </read_first>
  <behavior>
    - **`probeBetterSqlite3()`** returns `{ name: 'better_sqlite3_load', status: 'pass', detail: 'native binding loaded' }` on success — verified by opening `:memory:` and closing immediately.
    - **`probeKeyring()`** returns `{ name: 'napi_keyring_load', status: 'pass', detail: 'native binding loaded' }` on success — verified by `new Entry('recovery-ledger', 'doctor-probe')` constructor only (no get/set; A3).
    - **`probeMcpStdoutPurity()`** spawns `node dist/mcp.mjs`, writes the four fixtures in order separated by newlines, captures stdout for 100ms each, asserts every non-empty stdout line parses as JSON-RPC, returns `pass` if all lines valid, `fail` with the offending line in `detail` if any line fails. (Re-used by Plan 06's integration test — DO NOT duplicate the driver.)
    - **`runDoctor()`** composes the three checks via `Promise.all`, derives `overall` per D-06: `'fail'` if any check is fail; else `'warn'` if any check is warn; else `'pass'`.
    - **`createServices()`** (replacing Plan 03 stub) returns `{ runDoctor }` — a one-line delegation.
    - **Fixtures** are committed at the exact paths in 01-RESEARCH.md lines 318-324: `test/fixtures/mcp/{initialize,initialized,tools-list,whoop-doctor-call}.json` with the verbatim JSON content from RESEARCH lines 587-605. `protocolVersion: "2025-06-18"` per A2 — verify against installed SDK at exec time; if SDK negotiates differently, update the fixture and surface in summary.
  </behavior>
  <action>
    **`src/services/doctor/checks/native-modules.ts`**: lift verbatim from RESEARCH §Pattern 6 lines 619-650 — `probeBetterSqlite3` (dynamic `import('better-sqlite3')`, `new mod.default(':memory:').close()`) and `probeKeyring` (dynamic `import('@napi-rs/keyring')`, `new mod.Entry('recovery-ledger', 'doctor-probe')`). Each returns a `DoctorCheck`. Per RESEARCH A3, if `@napi-rs/keyring` 1.3.0's API differs, fall back to `Object.keys(mod).length > 0` as a load-only assertion and document in SUMMARY.

    **`src/services/doctor/checks/mcp-stdout-purity.ts`**: implement `probeMcpStdoutPurity()` using `node:child_process spawn` + `node:fs/promises readFile`. The function spawns `process.execPath` with arg `dist/mcp.mjs`, env `NODE_ENV=production`, reads each of the four fixtures from `test/fixtures/mcp/*.json`, writes each as a newline-delimited JSON-RPC frame to stdin, waits ~100ms after each write, captures stdout, splits on `\n`, filters empty, parses each line as JSON, asserts `jsonrpc === '2.0'`. Return `{ name: 'mcp_stdout_purity', status: 'pass', detail: 'JSON-RPC stream valid' }` on full success, or `status: 'fail'` with `detail: 'non-JSON-RPC byte on stdout: <line>'` on first violation.

    **`src/services/doctor/index.ts`**: lift verbatim from RESEARCH §Pattern 7 lines 668-694. Re-export `DoctorCheck`, `DoctorResult`. Compose `Promise.all([probeBetterSqlite3(), probeKeyring(), probeMcpStdoutPurity()])`, derive `overall` per D-06.

    **`src/services/index.ts`**: REPLACE the Plan 03 stub body — re-export `Services`, `DoctorCheck`, `DoctorResult` from `./doctor/index.js`; `createServices()` returns `{ runDoctor }`.

    **Test fixtures**: write the four `test/fixtures/mcp/*.json` files verbatim from RESEARCH lines 587-605. Per A2, `protocolVersion: "2025-06-18"` — if at build time the SDK rejects it, update fixture and note in SUMMARY (Pitfall 7).

    No `console.*` anywhere in `src/services/` — Biome catches it.
  </action>
  <verify>
    <automated>npx tsc --noEmit && test -f test/fixtures/mcp/initialize.json && test -f test/fixtures/mcp/initialized.json && test -f test/fixtures/mcp/tools-list.json && test -f test/fixtures/mcp/whoop-doctor-call.json && grep -q "probeBetterSqlite3" src/services/doctor/checks/native-modules.ts && grep -q "new mod.Entry" src/services/doctor/checks/native-modules.ts && grep -q "probeMcpStdoutPurity" src/services/doctor/checks/mcp-stdout-purity.ts && grep -q "Promise.all" src/services/doctor/index.ts && grep -q "createServices" src/services/index.ts && ! grep -rE "(^|[^a-zA-Z])console\\." src/services/ && echo OK</automated>
  </verify>
  <done>
    Four source files + four fixtures committed. `createServices()` in `src/services/index.ts` now delegates to the real `runDoctor()`. The mcp-stdout-purity probe is implemented but NOT executed in unit tests (it requires `dist/mcp.mjs` — exercised in Plan 06's integration test). Tests for these checks land in Task 1b.
  </done>
  <acceptance_criteria>
    - Source: `src/services/doctor/checks/native-modules.ts` contains `import('better-sqlite3')` AND `':memory:'` AND `import('@napi-rs/keyring')` AND `new mod.Entry`.
    - Source: `src/services/doctor/checks/mcp-stdout-purity.ts` contains `spawn` AND `'dist/mcp.mjs'` AND `'jsonrpc'`.
    - Source: `src/services/doctor/index.ts` contains `Promise.all(` AND `'pass'` AND `'warn'` AND `'fail'`.
    - Source: `src/services/index.ts` contains `createServices` AND `runDoctor` (the body imports from `./doctor/index.js`, not the Plan 03 stub return).
    - Source: `test/fixtures/mcp/initialize.json` contains `"method": "initialize"` AND `"protocolVersion"`.
    - Source: `test/fixtures/mcp/whoop-doctor-call.json` contains `"name": "whoop_doctor"`.
    - Source: zero matches of `/(^|[^a-zA-Z])console\./` under `src/services/`.
    - Behavior: `npx tsc --noEmit` exits 0.
    - Behavior: `npm run lint` exits 0.
  </acceptance_criteria>
</task>

<task type="auto" tdd="true">
  <name>Task 1b: Doctor formatter + unit tests for service core</name>
  <files>src/formatters/doctor.txt.ts, src/services/doctor/checks/native-modules.test.ts, src/services/doctor/index.test.ts, src/formatters/doctor.txt.test.ts</files>
  <read_first>
    - .planning/phases/01-foundation-stdout-pure-mcp-bootstrap/01-RESEARCH.md (Pattern 7 lines 668-694 — DoctorResult shape; Pitfall 2 — macOS-latest prebuilt assumption)
    - .planning/phases/01-foundation-stdout-pure-mcp-bootstrap/01-CONTEXT.md (D-06 — `[status] name — detail` line + `overall: <status>` line plaintext rendering)
    - .planning/phases/01-foundation-stdout-pure-mcp-bootstrap/01-VALIDATION.md (per-task verification map rows for native-load-probe + doctor-output-shape)
    - src/services/doctor/index.ts (just created in Task 1a — for type imports in tests)
    - src/services/doctor/checks/native-modules.ts (just created in Task 1a — for unit-test imports)
    - CLAUDE.md §Testing (`pool: 'forks'`; suite under 60s; no live WHOOP)
    - biome.json (`**/*.test.ts` override exempts tests from `noConsole` — though tests should not log)
  </read_first>
  <behavior>
    - **`renderDoctor(result)`** returns a compact plaintext string: one line per check formatted as `[status] name — detail`, followed by a final `overall: <status>` line.
    - **`native-modules.test.ts`**: assert `probeBetterSqlite3()` returns `status: 'pass'`; assert `probeKeyring()` returns `status: 'pass'`. Per Pitfall 2, CI runs on macOS-latest with prebuilds available — both probes should pass on the happy path. Error-path assertions can be omitted in Phase 1 (covered by manual smoke if a prebuild is ever unavailable).
    - **`doctor/index.test.ts`**: construct three stub `DoctorCheck` objects and assert the `overall` derivation: all pass → pass; any warn (none fail) → warn; any fail → fail. Inject the three check functions or build the `checks` array directly and call the small `deriveOverall` helper from `services/doctor/index.ts`.
    - **`doctor.txt.test.ts`**: render a fixture `DoctorResult` and assert the output contains every check's `name`, `status`, and `detail` plus an `overall:` line.
  </behavior>
  <action>
    **`src/formatters/doctor.txt.ts`**: named export `renderDoctor(r: DoctorResult): string` that returns a multi-line string. Compact form: `r.checks.map(c => `[${c.status}] ${c.name} — ${c.detail}`).join('\n') + '\noverall: ' + r.overall`. Per CLAUDE.md §Code Style: named exports only, ESM, no default exports. No `console.*` (Biome's global rule applies — `src/formatters/` is NOT in any override).

    **`src/services/doctor/checks/native-modules.test.ts`**: import `{ describe, expect, test } from 'vitest'` and `{ probeBetterSqlite3, probeKeyring } from './native-modules.js'`. Two happy-path tests, each asserting `status === 'pass'` and the expected `name` and `detail` fields. Per D-12 + Pitfall 2, both tests run on macOS-latest with prebuilds — if the executor sees a missing prebuild during local dev, the test surfaces it (the goal of FND-07).

    **`src/services/doctor/index.test.ts`**: import the doctor service. Three small test cases for `overall` derivation:
      - Test 1: three `pass` checks → `runDoctor`-equivalent (or `deriveOverall([...])`) returns `'pass'`.
      - Test 2: one `warn` + two `pass` → returns `'warn'`.
      - Test 3: one `fail` + one `warn` + one `pass` → returns `'fail'`.
    If `deriveOverall` is not separately exported by `services/doctor/index.ts`, the executor either exposes it as a named export for testability OR constructs `DoctorResult`-shaped inputs and tests via a small helper that mirrors the composition. Prefer exposing `deriveOverall` — keeps the test pure (no native module spawns).

    **`src/formatters/doctor.txt.test.ts`**: import `renderDoctor`. Build a fixture `DoctorResult`:
      ```
      { checks: [
          { name: 'better_sqlite3_load', status: 'pass', detail: 'native binding loaded' },
          { name: 'napi_keyring_load', status: 'pass', detail: 'native binding loaded' },
          { name: 'mcp_stdout_purity', status: 'warn', detail: 'one stale frame' }
        ], overall: 'warn' }
      ```
      Assert the output string contains: each check name, each detail substring, each status token, and an `overall: warn` line.

    All three test files end in `.test.ts` so Vitest's include glob picks them up and Biome's `**/*.test.ts` override applies. No `console.*` anywhere — assertions are silent.
  </action>
  <verify>
    <automated>npx tsc --noEmit && grep -q "export function renderDoctor" src/formatters/doctor.txt.ts && ! grep -rE "(^|[^a-zA-Z])console\\." src/formatters/ && npm run test -- src/services/doctor src/formatters --reporter=basic && echo OK</automated>
  </verify>
  <done>
    One source file (`renderDoctor`) + three test files committed. `npm run test -- src/services/doctor src/formatters` exits 0 with ≥ 3 test files green (native-modules, doctor index, doctor.txt formatter).
  </done>
  <acceptance_criteria>
    - Source: `src/formatters/doctor.txt.ts` contains `export function renderDoctor`.
    - Source: `src/services/doctor/checks/native-modules.test.ts` imports `probeBetterSqlite3` AND `probeKeyring` from `./native-modules.js`.
    - Source: `src/services/doctor/index.test.ts` exercises overall-status derivation for all three branches (`pass`, `warn`, `fail`).
    - Source: `src/formatters/doctor.txt.test.ts` asserts the output string contains an `overall:` token.
    - Source: zero matches of `/(^|[^a-zA-Z])console\./` under `src/formatters/`.
    - Behavior: `npx tsc --noEmit` exits 0.
    - Behavior: `npm run test -- src/services/doctor src/formatters --reporter=basic` exits 0 with ≥ 3 test files green.
    - Behavior: `npm run lint` exits 0.
  </acceptance_criteria>
</task>

<task type="auto">
  <name>Task 2: Land the CLI entry — Commander wiring + doctor command shim (OVERWRITES Plan 03 stub)</name>
  <files>src/cli/index.ts, src/cli/commands/doctor.ts</files>
  <read_first>
    - .planning/phases/01-foundation-stdout-pure-mcp-bootstrap/01-RESEARCH.md (Pattern 8 — CLI shim; Pitfall 3 — Commander ESM named import; Pitfall 6 — chmod on dist)
    - .planning/phases/01-foundation-stdout-pure-mcp-bootstrap/01-CONTEXT.md (D-06 — JSON default with --text flag; D-11 — file paths)
    - src/services/doctor/index.ts (Task 1a output)
    - src/formatters/doctor.txt.ts (Task 1b output)
    - src/cli/index.ts (the one-line `export {};` stub from Plan 03 — Task 2 OVERWRITES this file with the real Commander wiring; same stub-then-replace pattern as `src/services/index.ts`)
    - tsup.config.ts (entry `cli: 'src/cli/index.ts'`)
    - biome.json (`src/cli/**/*.ts` override allows console.* — but prefer `process.stdout.write`)
    - CLAUDE.md §Code Style (no default exports, ESM, named imports), §Critical Rules (CLI is the ONLY place stdout writes are allowed)
  </read_first>
  <action>
    **`src/cli/index.ts`**: OVERWRITE the Plan 03 one-line `export {};` stub. Lift verbatim from RESEARCH §Pattern 8 lines 700-718. Use `import { Command } from 'commander';` (named export — Pitfall 3). Construct `new Command()`, chain `.name('recovery-ledger')`, `.version('0.1.0')` (per RESEARCH Open Question 2 — hardcoded 0.1.0 for Phase 1; Phase 5 may wire from `package.json`), `.description('Local-first WHOOP review + decision ledger')`. Then `program.command('doctor').description('Run diagnostic checks').option('--text', 'render plaintext instead of JSON').action(runDoctorCommand);`. End with `await program.parseAsync(process.argv);` (top-level await; ESM, node22). **`src/cli/commands/doctor.ts`** (5-line shim per D-11): lift verbatim from RESEARCH §Pattern 8 lines 720-729. Import `runDoctor` from `../../services/doctor/index.js`, `renderDoctor` from `../../formatters/doctor.txt.js`. Export `async function runDoctorCommand(opts: { text?: boolean }): Promise<void>`. Body: `const result = await runDoctor(); process.stdout.write((opts.text ? renderDoctor(result) : JSON.stringify(result, null, 2)) + '\n'); process.exit(result.overall === 'fail' ? 1 : 0);`. **This is the ONLY `process.stdout.write` call allowed in the codebase per Plan 04's Gate 2.** The Biome `noConsole` override permits `console.*` here too — but `process.stdout.write` is the documented choice per RESEARCH §Pattern 8. After this lands, `npm run build` will produce `dist/cli.mjs`. Pitfall 6: tsup writes the shebang but does NOT chmod +x — Phase 1 does not require local exec bit (FND-02 says "runnable via `npx recovery-ledger`", which works through `bin` registration at install time). Local `node dist/cli.mjs doctor` works without chmod.
  </action>
  <verify>
    <automated>npx tsc --noEmit && grep -q "import { Command } from 'commander'" src/cli/index.ts && grep -q ".command('doctor')" src/cli/index.ts && grep -q ".option('--text'" src/cli/index.ts && grep -q "runDoctorCommand" src/cli/commands/doctor.ts && grep -q "process.stdout.write" src/cli/commands/doctor.ts && npm run build && test -f dist/cli.mjs && head -n 1 dist/cli.mjs | grep -q "^#!/usr/bin/env node" && node dist/cli.mjs --version | grep -q "^0\\.1\\.0$" && node dist/cli.mjs doctor | node -e "const c=[];process.stdin.on('data',d=>c.push(d));process.stdin.on('end',()=>{const r=JSON.parse(Buffer.concat(c).toString());if(!Array.isArray(r.checks)||!['pass','warn','fail'].includes(r.overall))process.exit(1)})" && node dist/cli.mjs doctor --text | grep -q "^overall: " && echo OK</automated>
  </verify>
  <done>
    `dist/cli.mjs` builds with shebang on line 1 (the Plan 03 stub is gone, replaced by the real wiring). `node dist/cli.mjs --version` prints `0.1.0`. `node dist/cli.mjs doctor` prints valid `{checks, overall}` JSON. `node dist/cli.mjs doctor --text` prints plaintext including an `overall:` line. No new `process.stdout.write` calls anywhere outside `src/cli/commands/doctor.ts`.
  </done>
  <acceptance_criteria>
    - Source: `src/cli/index.ts` contains `import { Command } from 'commander'` (named export per Pitfall 3) — the Plan 03 `export {};` stub is GONE, replaced by the real wiring.
    - Source: contains `.version('0.1.0')` (hardcoded per Open Question 2).
    - Source: contains `.command('doctor')` AND `.option('--text'` AND `.action(runDoctorCommand)`.
    - Source: contains `await program.parseAsync(process.argv)` (top-level await, ESM).
    - Source: `src/cli/commands/doctor.ts` contains `process.stdout.write` (the ONE allowed call site).
    - Source: contains `JSON.stringify(result, null, 2)` (D-06 JSON default).
    - Source: contains `renderDoctor(result)` (D-06 --text fallback).
    - Source: contains `process.exit(result.overall === 'fail' ? 1 : 0)` (exit-code mapping).
    - Behavior: `npm run build` produces `dist/cli.mjs` with shebang.
    - Behavior: `node dist/cli.mjs --version` writes `0.1.0\n` to stdout and exits 0.
    - Behavior: `node dist/cli.mjs doctor` writes a JSON object parseable as `{checks: [...], overall: 'pass'|'warn'|'fail'}` to stdout.
    - Behavior: `node dist/cli.mjs doctor --text` writes a string containing `overall:` to stdout.
    - Behavior: `bash scripts/ci-grep-gates.sh` STILL exits 0 (the new `process.stdout.write` is in `src/cli/`, exempt by Gate 2).
    - Source: zero `process.stdout.write` outside `src/cli/commands/doctor.ts` (verified by Plan 04 Gate 2).
  </acceptance_criteria>
</task>

</tasks>

<verification>
1. `npx tsc --noEmit` exits 0.
2. `npm run build` produces both `dist/cli.mjs` and `dist/mcp.mjs` with shebangs.
3. `npm run lint` exits 0.
4. `npm run test` exits 0 (Plans 02 + 03 + 04 + 05 tests all green; the mcp-stdout-purity check is implemented but only exercised end-to-end in Plan 06).
5. `bash scripts/ci-grep-gates.sh` exits 0 (the new `process.stdout.write` in `src/cli/commands/doctor.ts` is exempt by Gate 2's `src/cli/` exclusion).
6. `node dist/cli.mjs --version` writes `0.1.0\n` to stdout.
7. `node dist/cli.mjs doctor` writes a `{checks, overall}` JSON object to stdout.
8. Plan 06 will run `dist/cli.mjs doctor` AND the subprocess integration test against `dist/mcp.mjs` in CI.
</verification>

<success_criteria>
- All ten files committed across three tasks (Task 1a: 4 source + 4 fixtures; Task 1b: 1 source + 3 tests; Task 2: 2 source).
- `node dist/cli.mjs doctor` exits 0 with a valid JSON DoctorResult.
- `node dist/cli.mjs doctor --text` exits 0 with a plaintext rendering.
- `npm run test` exits 0 with at least three new test files (native-modules, doctor index, doctor.txt formatter) passing.
- The mcp-stdout-purity check is factored into a standalone reusable function — Plan 06 imports it without duplicating logic.
- `bash scripts/ci-grep-gates.sh` still exits 0 (no new violations).
- The Plan 03 stub `createServices()` is replaced by a real delegation; the Services barrel re-exports the doctor types so `src/mcp/tools/whoop-doctor.ts` can return real `DoctorResult` instances.
- The Plan 03 one-line `src/cli/index.ts` stub is OVERWRITTEN by Task 2 with the real Commander wiring.
</success_criteria>

<output>
After completion, create `.planning/phases/01-foundation-stdout-pure-mcp-bootstrap/01-05-SUMMARY.md` documenting: A3 resolution (did `new Entry('recovery-ledger', 'doctor-probe')` work or did the keyring 1.3.0 API force a fallback?), the actual `protocolVersion` value that worked in `initialize.json` (A2), and any deviation from Pattern 8's hardcoded `0.1.0` (Open Question 2 — should still be `0.1.0` per the recommendation).
</output>
</content>
</invoke>