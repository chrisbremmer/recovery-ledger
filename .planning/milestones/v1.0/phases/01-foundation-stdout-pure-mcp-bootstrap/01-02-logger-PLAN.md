---
phase: 01-foundation-stdout-pure-mcp-bootstrap
plan: 02
type: execute
wave: 2
depends_on:
  - 01
files_modified:
  - src/infrastructure/config/logger.ts
  - src/infrastructure/config/logger.test.ts
autonomous: true
requirements:
  - FND-04
requirements_addressed:
  - FND-04
tags:
  - logger
  - pino
  - stderr
  - stdout-purity
must_haves:
  truths:
    - "D-02 (a): Programmatic Vitest unit asserts that Pino's destination resolves to file descriptor 2 (stderr) in both dev and prod logger configurations (subprocess round-trip is owned by Plan 06)"
    - "Pino logger writes exclusively to file descriptor 2 (stderr) in both prod and dev"
    - "Dev mode uses pino-pretty as a transport whose rendered output ALSO goes to fd 2"
    - "A Vitest unit asserts the prod logger's destination is fd 2"
    - "Importing `src/infrastructure/config/logger.ts` produces no output to stdout under any NODE_ENV"
  artifacts:
    - path: "src/infrastructure/config/logger.ts"
      provides: "Named export `logger` — Pino instance bound to fd 2 (stderr) only"
      exports: ["logger"]
      contains: "pino.destination"
    - path: "src/infrastructure/config/logger.test.ts"
      provides: "Vitest assertion that prod logger destination is fd 2 (D-02a programmatic check)"
      contains: "expect(dest.fd).toBe(2)"
  key_links:
    - from: "src/infrastructure/config/logger.ts"
      to: "Node fd 2 (stderr)"
      via: "pino.destination({ dest: 2 })"
      pattern: "pino\\.destination\\(\\s*\\{[^}]*dest:\\s*2"
    - from: "src/infrastructure/config/logger.ts"
      to: "pino-pretty transport (dev only)"
      via: "transport.options.destination: 2"
      pattern: "destination:\\s*2"
---

<objective>
Land the single source of truth for logging: a Pino logger that writes ONLY to fd 2 (stderr) under both `NODE_ENV=production` and `NODE_ENV=development`. The whole codebase from Phase 2 forward will import this `logger` and nothing else. The unit test in this plan is D-02a — the programmatic half of the stdout-purity assertion; D-02b (the load-bearing subprocess round-trip) lands in Plan 06.

Purpose: FND-04 declares Pino → stderr only with a CI-enforced assertion. This plan delivers the logger and the cheap programmatic check. CLAUDE.md §Critical Rules names MCP stdout purity as the single most load-bearing constraint in the codebase — Pitfall 1 of PITFALLS.md elevates it to "single most common failure mode in real-world stdio MCP servers." Three layers of defense (Biome noConsole, grep gates, subprocess test) all rest on this file being correct.

Output: One source file, one test file. The logger is pure — no I/O on import beyond constructing a Pino instance pointing at fd 2.
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
@tsconfig.json
@vitest.config.ts
@biome.json

<interfaces>
<!-- Pino public API surface for this plan. Verified from RESEARCH.md Pattern 1 + Assumptions A1. -->
import { pino } from 'pino';                       // named export, ESM
pino.destination(2)                                  // shorthand → fd 2
pino.destination({ dest: 2, sync: false })          // documented, prod-recommended
pino.destination({ dest: 2, sync: true })           // documented, synchronous (test-friendly)
// pino-pretty (dev transport) — options.destination: 2 routes prettified output to stderr
// per RESEARCH §Pattern 1 example.

// Pino symbol introspection (A1 — flagged as brittle; fall back to constructing
// pino.destination({dest:2}) directly and asserting .fd === 2):
pino.symbols.streamSym                              // accesses the underlying destination
</interfaces>
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: Create logger.ts with NODE_ENV-aware Pino → fd 2 binding</name>
  <files>src/infrastructure/config/logger.ts</files>
  <read_first>
    - .planning/phases/01-foundation-stdout-pure-mcp-bootstrap/01-RESEARCH.md (Pattern 1 — prod and dev logger code; Pitfall 1 — pino-pretty transport bundling; Open Question 1 — sync vs async destination)
    - .planning/phases/01-foundation-stdout-pure-mcp-bootstrap/01-CONTEXT.md (D-04 — no console anywhere outside src/cli/)
    - .planning/research/STACK.md §Logging — MUST NOT pollute stdout
    - .planning/research/PITFALLS.md Pitfall 1 (stdout-corrupted MCP stdio transport)
    - CLAUDE.md §Critical Rules (MCP stdout purity), §Code Style (no default exports, ESM only, strict TS)
    - tsup.config.ts (so the executor sees `external: ['better-sqlite3', '@napi-rs/keyring']` — pino-pretty is NOT external, dev path imports it conditionally)
  </read_first>
  <behavior>
    - Test 1: In `NODE_ENV=production`, the exported `logger` is a Pino instance whose destination's `.fd` equals 2.
    - Test 2: Constructing `pino.destination({ dest: 2, sync: true })` directly and inspecting `.fd` returns 2 — fallback assertion if symbol introspection is fragile (A1).
    - Test 3: Loading the module under `NODE_ENV=production` produces zero bytes on stdout (introspection only; importing must not write).
    - (Dev-mode behavior — `transport.options.destination: 2` routing pino-pretty to stderr — is established structurally; the load-bearing assertion for the dev path is the subprocess test in Plan 06.)
  </behavior>
  <action>
    Create `src/infrastructure/config/logger.ts` as a named-export ESM TypeScript module (per CLAUDE.md §Code Style: no default exports). Lift the source verbatim from 01-RESEARCH.md §Pattern 1 (prod example). Import `pino` as a named export — `import { pino } from 'pino';` — to match Commander's pattern (Pitfall 3 documents ESM named-export convention). Read `process.env['NODE_ENV']` and `process.env['LOG_LEVEL']` (bracket access because tsconfig sets `noUncheckedIndexedAccess: true`). For prod (default): `pino({ level: process.env['LOG_LEVEL'] ?? 'info' }, pino.destination({ dest: 2, sync: false }))`. For `NODE_ENV === 'development'`: `pino({ level: process.env['LOG_LEVEL'] ?? 'debug', transport: { target: 'pino-pretty', options: { destination: 2 } } })`. Export the resulting instance as a NAMED export `logger`. Per Open Question 1 in RESEARCH.md, default to `sync: false` for prod (perf) and add an inline comment justifying it (CLAUDE.md §Code Style comments policy: only when the *why* is non-obvious — flushing-on-shutdown behavior is non-obvious here, so the comment is warranted). Per CLAUDE.md §Critical Rules, this file must never `console.*` anything — Biome `noConsole` will catch any attempt, but write the file so there's nothing to catch.
  </action>
  <verify>
    <automated>npx tsc --noEmit && grep -q "pino.destination" src/infrastructure/config/logger.ts && grep -q "dest: 2" src/infrastructure/config/logger.ts && grep -q "export const logger" src/infrastructure/config/logger.ts && ! grep -E "(^|[^a-zA-Z])console\\." src/infrastructure/config/logger.ts && ! grep "export default" src/infrastructure/config/logger.ts && echo OK</automated>
  </verify>
  <done>
    `src/infrastructure/config/logger.ts` exists, compiles under strict TS, exports `logger` as a named export, binds Pino to fd 2 via `pino.destination({ dest: 2, ... })`, branches on `NODE_ENV` for the dev pino-pretty transport (still routed to fd 2), and contains zero `console.*` calls.
  </done>
  <acceptance_criteria>
    - Source: `src/infrastructure/config/logger.ts` contains `pino.destination(` AND `dest: 2`.
    - Source: contains `export const logger` (named export per CLAUDE.md §Code Style).
    - Source: does NOT contain `export default`.
    - Source: contains `NODE_ENV` reference AND `destination: 2` (pino-pretty options) for the dev branch.
    - Source: contains zero matches of `/(^|[^a-zA-Z])console\./` (no console.* anywhere).
    - Behavior: `npx tsc --noEmit` exits 0 (file compiles under strict TS + noUncheckedIndexedAccess + exactOptionalPropertyTypes).
    - Behavior: `node -e "process.env.NODE_ENV='production'; const {logger} = await import('./dist-temp/logger.js'); logger.info('hello')"` (after `npx tsc src/infrastructure/config/logger.ts --outDir dist-temp --module nodenext --target es2023`) writes to stderr but NOT to stdout — verifiable by `node ... 1>/tmp/out 2>/tmp/err && [ ! -s /tmp/out ]`.
    - Source: file uses bracket-notation `process.env['NODE_ENV']` (required by `noUncheckedIndexedAccess: true`).
  </acceptance_criteria>
</task>

<task type="auto" tdd="true">
  <name>Task 2: Create logger.test.ts — programmatic D-02a check</name>
  <files>src/infrastructure/config/logger.test.ts</files>
  <read_first>
    - src/infrastructure/config/logger.ts (just created)
    - .planning/phases/01-foundation-stdout-pure-mcp-bootstrap/01-RESEARCH.md (Pattern 5(a) — both the symbol-based and the fallback assertion)
    - .planning/phases/01-foundation-stdout-pure-mcp-bootstrap/01-CONTEXT.md (D-02 — two complementary checks)
    - .planning/phases/01-foundation-stdout-pure-mcp-bootstrap/01-VALIDATION.md (Per-Task Verification Map — stdout-purity-unit row)
    - CLAUDE.md §Testing (`pool: 'forks'`, no live WHOOP — irrelevant here, but tests exempt from noConsole per biome.json)
    - .planning/research/PITFALLS.md Pitfall 1 (motivation)
    - vitest.config.ts (so the executor knows the configured pool + include glob picks up this co-located test)
  </read_first>
  <behavior>
    - Test 1: `pino.destination({ dest: 2, sync: true }).fd` equals `2` — the FALLBACK assertion from RESEARCH.md Pattern 5(a), most robust against Pino internals shifting (A1).
    - Test 2: The exported `logger` from `./logger.js`, inspected via `pino.symbols.streamSym`, has `.fd === 2` — the symbol-based check. If A1 turns out wrong at exec time, mark this test `.skip` with a comment pointing at Pattern 5(a) and rely on Test 1 + the subprocess test in Plan 06.
    - Test 3: Setting `process.env.NODE_ENV = 'production'` then dynamically importing the logger produces a destination whose `.fd === 2`. (NODE_ENV cannot be reliably set after module load due to module caching; the test should set env before the first import, or use `await import('./logger.js?env=prod')` with cache busting if Vitest's module cache interferes — alternative: just construct a fresh `pino.destination({dest:2})` for the assertion and rely on the structural read of logger.ts source for the prod path.)
  </behavior>
  <action>
    Create `src/infrastructure/config/logger.test.ts` as a Vitest spec co-located with `logger.ts` (per RESEARCH §Recommended Project Structure: sibling test files). Use the named imports `import { describe, expect, test } from 'vitest'` and `import { pino } from 'pino'`. Implement two `test()` cases inside one `describe('logger destination', () => { ... })` block. Test 1 (load-bearing): `const dest = pino.destination({ dest: 2, sync: true }); expect(dest.fd).toBe(2);` — this is the fallback assertion that does not depend on Pino's internal symbols (A1). Test 2 (best-effort): import the project `logger`, read `(logger as unknown as Record<symbol, unknown>)[pino.symbols.streamSym]` and assert `.fd === 2`; wrap in a try/catch fallback that calls `expect.fail("pino.symbols.streamSym no longer exposes destination — fall back to Test 1 + subprocess test in Plan 06")` if introspection breaks. Tests are exempt from Biome `noConsole` per the override in `biome.json` — but the test should not log anything anyway; assertions are silent.
  </action>
  <verify>
    <automated>npm run test -- src/infrastructure/config/logger.test.ts --reporter=basic && echo OK</automated>
  </verify>
  <done>
    `src/infrastructure/config/logger.test.ts` exists; `npm run test -- src/infrastructure/config/logger.test.ts` exits 0 with at least one passing assertion that fd === 2.
  </done>
  <acceptance_criteria>
    - Source: `src/infrastructure/config/logger.test.ts` contains `expect(dest.fd).toBe(2)` (the fallback assertion — see RESEARCH §Pattern 5(a) lines 521-526).
    - Source: imports `pino` as named export AND `describe, expect, test` from `vitest`.
    - Source: includes a fallback path for the `pino.symbols.streamSym` introspection (A1 — symbol may not be stable).
    - Behavior: `npm run test -- src/infrastructure/config/logger.test.ts` exits 0.
    - Behavior: at least one passing test case asserts `.fd === 2`.
    - Source: file ends in `.test.ts` so Biome's `**/*.test.ts` override applies (noConsole off).
  </acceptance_criteria>
</task>

</tasks>

<verification>
1. `npm run test -- src/infrastructure/config/logger.test.ts` exits 0.
2. `npm run lint` exits 0 (no console.* in logger.ts; tests exempt).
3. `npx tsc --noEmit` exits 0 (logger.ts and logger.test.ts compile under strict TS).
4. `grep -E "(^|[^a-zA-Z])console\." src/infrastructure/config/logger.ts` returns no matches.
5. The subprocess round-trip test (D-02b) lands in Plan 06 and uses the dist-built logger; this plan only ships the unit-level check.
</verification>

<success_criteria>
- `src/infrastructure/config/logger.ts` exports `logger` as a named export, binds Pino to fd 2 in both prod and dev codepaths.
- `src/infrastructure/config/logger.test.ts` passes — at least the fallback `pino.destination({dest:2}).fd === 2` assertion is green.
- `npm run lint && npm run test` exits 0 with these files added (no regressions on Plan 01's empty-tree green).
- No other files created (sanitizer + register.ts + tool files land in Plan 03; doctor lands in Plan 05).
</success_criteria>

<output>
After completion, create `.planning/phases/01-foundation-stdout-pure-mcp-bootstrap/01-02-SUMMARY.md` documenting: which Pino destination form ended up in `logger.ts` (sync vs async — RESEARCH Open Question 1), whether `pino.symbols.streamSym` introspection works against Pino 10.3.1 in practice (A1 resolution), and the test case names so Plan 06 can compose the integration test's name without collision.
</output>
