---
phase: 01-foundation-stdout-pure-mcp-bootstrap
plan: 03
type: execute
wave: 2
depends_on:
  - 01
files_modified:
  - src/mcp/index.ts
  - src/mcp/register.ts
  - src/mcp/sanitize.ts
  - src/mcp/tools/whoop-doctor.ts
  - src/services/index.ts
  # src/cli/index.ts ships here as a one-line `export {};` stub so tsup's two-entry build
  # (cli + mcp) is green from Wave 2 forward. Plan 05 REPLACES the stub with the real
  # Commander wiring — same stub-then-replace pattern as src/services/index.ts above.
  - src/cli/index.ts
autonomous: true
requirements:
  - FND-03
  - FND-06
requirements_addressed:
  - FND-03
  - FND-06
tags:
  - mcp
  - stdio
  - sanitizer
  - register
must_haves:
  truths:
    - "A built `dist/mcp.mjs` starts an MCP stdio server when invoked via `node dist/mcp.mjs`"
    - "The MCP server's `initialize` response advertises `serverInfo.name = 'recovery-ledger'` and `serverInfo.version = '0.1.0'`"
    - "Exactly one tool — `whoop_doctor` — is registered, via the `register()` wrapper"
    - "`server.registerTool` is called exactly once across the codebase: inside `src/mcp/register.ts`"
    - "`src/mcp/sanitize.ts` exports a pure `sanitize(input: string): string` function applying the four D-07 regex patterns"
    - "The sanitizer walks `Error.cause` chains depth ≤ 8 with WeakSet cycle protection (D-08)"
    - "Tool handler errors are caught by `register()`, sanitized, and returned as `{content: [...], isError: true}`"
    - "`src/cli/index.ts` exists as a one-line stub `export {};` so the tsup two-entry build is green (Plan 05 replaces it)"
  artifacts:
    - path: "src/mcp/index.ts"
      provides: "MCP stdio server entry — McpServer + StdioServerTransport + tool registration"
      contains: "StdioServerTransport"
    - path: "src/mcp/register.ts"
      provides: "Named export `register()` — the ONLY place `server.registerTool` is called (D-09)"
      exports: ["register"]
      contains: "server.registerTool"
    - path: "src/mcp/sanitize.ts"
      provides: "Named exports `sanitize` and `PATTERNS` — the D-07 regex catalog + cause-chain walker"
      exports: ["sanitize", "PATTERNS"]
      contains: "eyJ[A-Za-z0-9_-]"
    - path: "src/mcp/tools/whoop-doctor.ts"
      provides: "5-line shim that calls `services.runDoctor()` via the register wrapper"
      exports: ["registerWhoopDoctor"]
    - path: "src/services/index.ts"
      provides: "Phase 1 Services barrel — exports `createServices()` returning `{ runDoctor }` (real impl wired in Plan 05)"
      exports: ["Services", "createServices"]
    - path: "src/cli/index.ts"
      provides: "One-line stub `export {};` so the tsup CLI entry resolves; Plan 05 replaces it with the real Commander wiring"
      contains: "export {};"
  key_links:
    - from: "src/mcp/index.ts"
      to: "src/mcp/tools/whoop-doctor.ts"
      via: "registerWhoopDoctor(server, services)"
      pattern: "registerWhoopDoctor\\("
    - from: "src/mcp/tools/whoop-doctor.ts"
      to: "src/mcp/register.ts"
      via: "import { register } from '../register.js'"
      pattern: "from\\s+['\"]\\.\\.\\/register\\.js['\"]"
    - from: "src/mcp/register.ts"
      to: "src/mcp/sanitize.ts"
      via: "import { sanitize } from './sanitize.js'"
      pattern: "from\\s+['\"]\\.\\/sanitize\\.js['\"]"
    - from: "src/mcp/index.ts"
      to: "src/services/index.ts"
      via: "createServices() returning a Services struct"
      pattern: "createServices\\(\\)"
---

<objective>
Land the MCP stdio server skeleton: `McpServer` + `StdioServerTransport` wired up, the `register()` wrapper that monopolizes `server.registerTool` (D-09), the four-pattern error sanitizer with cause-chain walk (D-07/D-08), and a 5-line `whoop_doctor` tool shim that delegates to a (still stub) `services.runDoctor()`. This is Wave 2 — depends only on Plan 01's configs.

Purpose: FND-03 (empty MCP stdio server runnable from a `bin` entry) + FND-06 (sanitizer contract) are the load-bearing safety nets. CLAUDE.md §Critical Rules names MCP stdout purity and lists sanitizer-style protections as non-negotiable. Plan 04 will land the unit tests against this sanitizer; Plan 06 will land the subprocess round-trip. This plan ships the production code.

Output: Six source files. A `services/index.ts` barrel exists to give `src/mcp/index.ts` a stable contract — its `runDoctor()` implementation is a stub that returns `{ checks: [], overall: 'pass' }`. A `src/cli/index.ts` one-line stub (`export {};`) ships so the tsup two-entry build resolves cleanly from Wave 2 forward. Plan 05 will replace both stubs with the real implementations; the seams are what matter here so Plans 04 and 06 can run without waiting on Plan 05.
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
@tsconfig.json
@tsup.config.ts
@biome.json

<interfaces>
<!-- MCP SDK surface used in this plan. Verified from RESEARCH.md Patterns 2-4. -->
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
// new McpServer({ name: string, version: string })
// server.registerTool(name: string, config: { title?, description, inputSchema }, handler)
// — RESTRICTED: only called inside src/mcp/register.ts per D-09

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
// CallToolResult = { content: Array<{type:'text',text:string}>, structuredContent?, isError? }

import type { ZodRawShape } from 'zod';
// inputSchema: ZodRawShape (an object of Zod schemas — empty {} for whoop_doctor in Phase 1)

<!-- Services barrel — Plan 03 ships a STUB; Plan 05 replaces the stub. -->
// src/services/index.ts
export interface Services {
  runDoctor: () => Promise<DoctorResult>;
}
export function createServices(): Services { /* Plan 05 wires the real impl */ }

<!-- DoctorResult shape (D-06) — landed in Plan 05's services/doctor/index.ts.
     Plan 03 either redeclares it locally or imports it from services/doctor (which is created stub-only here). -->
interface DoctorResult {
  checks: Array<{ name: string; status: 'pass'|'warn'|'fail'; detail: string }>;
  overall: 'pass'|'warn'|'fail';
}
</interfaces>
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: Create src/mcp/sanitize.ts — D-07 regex catalog + D-08 cause-chain walker</name>
  <files>src/mcp/sanitize.ts</files>
  <read_first>
    - .planning/phases/01-foundation-stdout-pure-mcp-bootstrap/01-RESEARCH.md (Pattern 4 — the verbatim regex set; Pitfall 8 — greedy match across newlines; Pitfall 9 — Error.cause cycle protection)
    - .planning/phases/01-foundation-stdout-pure-mcp-bootstrap/01-CONTEXT.md (D-07 — pattern catalog; D-08 — sanitize Error.message + cause chain, depth ≤ 8; D-09 — register.ts is the only consumer)
    - .planning/research/PITFALLS.md Pitfall 1 (motivation for layered defense)
    - CLAUDE.md §Critical Rules (MCP stdout purity), §Code Style (no default exports, no `console.*` in src/mcp/)
    - tsconfig.json (strict + noUncheckedIndexedAccess: bracket-access required where applicable)
  </read_first>
  <behavior>
    - Test 1 (in Plan 04): Pattern 1 — `"Authorization: Bearer abc.def.ghi"` becomes `"Authorization: Bearer <redacted>"`.
    - Test 2 (in Plan 04): Pattern 2 — `'{"access_token":"abc123"}'` becomes `'{"access_token":"<redacted>"}'`; same for `refresh_token`, `client_secret`.
    - Test 3 (in Plan 04): Pattern 3 — a JWT `"eyJabc.eyJdef.signature123"` becomes `"<redacted-jwt>"`.
    - Test 4 (in Plan 04): Pattern 4 — bare `"Bearer abcdef1234"` (≥ 10 chars after) becomes `"Bearer <redacted>"`; the literal word "Bearer" in prose with < 10-char trailing chars stays.
    - Test 5 (in Plan 04): A cause chain `new Error("outer", { cause: new Error("middle: Bearer eyJabc.eyJdef.signature123", { cause: new Error("inner") }) })` is fully traversed, redacted, and joined with `" — caused by: "` separators.
    - Test 6 (in Plan 04): Cyclic cause (`err.cause = err`) does not loop forever (WeakSet exits the loop).
    - Test 7 (in Plan 04): A 20-deep cause chain stops walking at depth 8.
  </behavior>
  <action>
    Create `src/mcp/sanitize.ts` as a named-export ESM TypeScript module. Lift the source structure verbatim from 01-RESEARCH.md §Pattern 4. Export TWO named symbols: `PATTERNS` (the readonly array — exported so Plan 04's unit tests can iterate and so Plan 06's integration test can re-use them) and `sanitize(input: string): string`. `PATTERNS` is an `as const`/`readonly` array of `{ pattern: RegExp, replacement: string }`: (1) `/Authorization:\s*Bearer\s+[^\s,;]+/gi` → `'Authorization: Bearer <redacted>'`; (2) `/("(?:access_token|refresh_token|client_secret)"\s*:\s*")[^"]+/g` → `'$1<redacted>'`; (3) `/eyJ[A-Za-z0-9_-]{4,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g` → `'<redacted-jwt>'`; (4) `/Bearer\s+[A-Za-z0-9._-]{10,}/g` → `'Bearer <redacted>'`. **Order matters per RESEARCH.md** — more-specific patterns first (Authorization-with-Bearer is matched before bare-Bearer so the bare-Bearer rule doesn't pre-empt). `sanitize(input)` loops through `PATTERNS` and runs `input.replace(pattern, replacement)` in sequence. Add ONE-LINE comments justifying each pattern (CLAUDE.md §Code Style: only when the *why* is non-obvious — character classes, flag choices, and ordering are non-obvious here). **Also export `serializeError(err: unknown): string`** — the cause-chain walker from RESEARCH §Pattern 2 lines 399-420 — for `register.ts` to consume. The walker uses `WeakSet<object>` to break cycles (Pitfall 9), depth-limited to 8 (D-08), joins with `' — caused by: '`. Keep this file free of all I/O: pure string transformations only.
  </action>
  <verify>
    <automated>npx tsc --noEmit && grep -q "export function sanitize" src/mcp/sanitize.ts && grep -q "export const PATTERNS" src/mcp/sanitize.ts && grep -q "Authorization:\\\\s\\*Bearer" src/mcp/sanitize.ts && grep -q "eyJ\\[A-Za-z0-9_-\\]{4," src/mcp/sanitize.ts && grep -q "access_token\\|refresh_token\\|client_secret" src/mcp/sanitize.ts && grep -q "WeakSet" src/mcp/sanitize.ts && grep -q "export function serializeError" src/mcp/sanitize.ts && ! grep -E "(^|[^a-zA-Z])console\\." src/mcp/sanitize.ts && echo OK</automated>
  </verify>
  <done>
    `src/mcp/sanitize.ts` exports `PATTERNS`, `sanitize`, and `serializeError`. The four regex patterns from D-07 are present verbatim with `g` (or `gi`) flags. The cause-chain walker has WeakSet cycle protection and a depth-8 limit. File compiles under strict TS and contains zero `console.*` calls.
  </done>
  <acceptance_criteria>
    - Source: `src/mcp/sanitize.ts` contains `export const PATTERNS` AND `export function sanitize` AND `export function serializeError`.
    - Source: contains `Authorization:\s*Bearer\s+[^\s,;]+` AND `gi` flag (Pattern 1).
    - Source: contains `("(?:access_token|refresh_token|client_secret)"\s*:\s*")[^"]+` (Pattern 2).
    - Source: contains `eyJ[A-Za-z0-9_-]{4,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}` (Pattern 3).
    - Source: contains `Bearer\s+[A-Za-z0-9._-]{10,}` (Pattern 4).
    - Source: contains `WeakSet` (Pitfall 9 cycle protection) AND `depth < 8` (or `depth <= 8` or `depth = 8`) (D-08 depth limit).
    - Source: zero matches of `/(^|[^a-zA-Z])console\./`.
    - Behavior: `npx tsc --noEmit` exits 0.
  </acceptance_criteria>
</task>

<task type="auto" tdd="true">
  <name>Task 2: Create src/mcp/register.ts — the ONLY caller of server.registerTool (D-09)</name>
  <files>src/mcp/register.ts</files>
  <read_first>
    - .planning/phases/01-foundation-stdout-pure-mcp-bootstrap/01-RESEARCH.md (Pattern 2 — full register.ts source including serializeError; Open Question 4 — SDK import path)
    - .planning/phases/01-foundation-stdout-pure-mcp-bootstrap/01-CONTEXT.md (D-09 — register.ts is the only place server.registerTool is called; D-10 — sanitizer wired through here)
    - src/mcp/sanitize.ts (just created — register.ts imports sanitize + serializeError)
    - CLAUDE.md §Code Style (no default exports, ESM, named exports)
    - .planning/research/PITFALLS.md Pitfall 1 (motivation)
  </read_first>
  <behavior>
    - Test (in Plan 04 integration assertion + Plan 06 subprocess test): When a tool handler throws an Error whose message contains `Bearer eyJabc.eyJdef.signature123`, the response returned by the wrapped handler is `{ content: [{ type: 'text', text: '...<redacted-jwt>...' }], isError: true }` — the JWT pattern is replaced and no Bearer/Authorization/JWT substring remains.
    - Test (in Plan 04): When a tool handler returns a `CallToolResult` successfully, `register()` passes the result through unchanged.
  </behavior>
  <action>
    Create `src/mcp/register.ts` as a named-export ESM TypeScript module. Lift the source verbatim from 01-RESEARCH.md §Pattern 2 lines 366-421 — the `ToolConfig` interface, the generic `register<I extends ZodRawShape>(server, name, config, handler)` function, and the call-through to `server.registerTool(name, config, handler)` with the try/catch wrapping the handler. The catch block returns `{ content: [{ type: 'text', text: sanitize(serializeError(err)) }], isError: true } satisfies CallToolResult`. Use `import type` for `McpServer`, `CallToolResult`, and `ZodRawShape`. Per RESEARCH §Open Question 4, use the import path `@modelcontextprotocol/sdk/server/mcp.js` for `McpServer` (STACK.md verbatim); if the build at exec time errors, fall back to `@modelcontextprotocol/sdk/server/index.js`. Import `sanitize` and `serializeError` from `./sanitize.js` (the `.js` extension is required for NodeNext ESM resolution per CLAUDE.md §Code Style). **This file is the ONLY file in `src/mcp/` allowed to call `server.registerTool`** — the CI grep gate in Plan 04 enforces this. Add a one-line comment at the call site explaining the contract for future contributors: `// IMPORTANT: this is the ONLY call to server.registerTool in the codebase (D-09)`.
  </action>
  <verify>
    <automated>npx tsc --noEmit && grep -q "export function register" src/mcp/register.ts && grep -q "server\\.registerTool" src/mcp/register.ts && grep -q "isError: true" src/mcp/register.ts && grep -q "sanitize(serializeError" src/mcp/register.ts && grep -q "from '\\./sanitize\\.js'" src/mcp/register.ts && ! grep -E "(^|[^a-zA-Z])console\\." src/mcp/register.ts && echo OK</automated>
  </verify>
  <done>
    `src/mcp/register.ts` exports `register()` as a named export, wraps every handler in try/catch with `sanitize(serializeError(err))` in the catch path, and is the only place in the codebase that calls `server.registerTool`. Compiles under strict TS.
  </done>
  <acceptance_criteria>
    - Source: `src/mcp/register.ts` contains `export function register` (NOT `export default`).
    - Source: contains `server.registerTool(` exactly once.
    - Source: contains `sanitize(serializeError(err))` inside a `catch` block.
    - Source: contains `isError: true`.
    - Source: contains `import { sanitize` AND `serializeError` (both from `./sanitize.js`).
    - Source: imports from `@modelcontextprotocol/sdk/server/mcp.js` (or `./index.js` if the first fails — Open Question 4).
    - Source: zero matches of `/(^|[^a-zA-Z])console\./`.
    - Behavior: `npx tsc --noEmit` exits 0.
    - Behavior: `grep -rEn "server\.registerTool" src/mcp/ | grep -v "src/mcp/register.ts"` returns no matches (will be the CI grep gate in Plan 04).
  </acceptance_criteria>
</task>

<task type="auto">
  <name>Task 3: Create src/services/index.ts (stub) + src/cli/index.ts (stub) + src/mcp/tools/whoop-doctor.ts + src/mcp/index.ts</name>
  <files>src/services/index.ts, src/cli/index.ts, src/mcp/tools/whoop-doctor.ts, src/mcp/index.ts</files>
  <read_first>
    - src/mcp/register.ts (just created — whoop-doctor.ts imports `register`)
    - src/mcp/sanitize.ts (just created)
    - .planning/phases/01-foundation-stdout-pure-mcp-bootstrap/01-RESEARCH.md (Pattern 2 lines 426-441 — whoop-doctor tool file; Pattern 3 lines 443-459 — mcp/index.ts entry; Pattern 7 lines 668-695 — DoctorCheck + DoctorResult shapes)
    - .planning/phases/01-foundation-stdout-pure-mcp-bootstrap/01-CONTEXT.md (D-05 — doctor checks; D-06 — output shape; D-11 — src/ layout)
    - .planning/research/ARCHITECTURE.md §Component Responsibilities (mcp/ is a driving adapter; tool bodies ≤ 5 lines per MCP-03 spec, anticipated)
    - CLAUDE.md §Code Style (no default exports), §Critical Rules (MCP stdout purity — no console.* anywhere in src/mcp/)
    - tsup.config.ts (entries point at src/cli/index.ts AND src/mcp/index.ts — both file paths must exist or the build fails)
  </read_first>
  <action>
    Four files, in this order:

    **Step 1 — `src/cli/index.ts` (one-line stub)**: create the file with exactly one line of body: `export {};`. The minimal `export {};` keeps TypeScript happy under `isolatedModules` and gives tsup's CLI entry a resolvable target so `npm run build` produces both `dist/cli.mjs` and `dist/mcp.mjs` from Wave 2 forward. Plan 05 will OVERWRITE this file with the real Commander wiring (`Command`, `program.command('doctor')`, etc.); the stub-then-replace pattern mirrors `src/services/index.ts`. Concretely: `echo 'export {};' > src/cli/index.ts` is sufficient.

    **Step 2 — `src/services/index.ts`** (the Phase 1 Services barrel — stub; Plan 05 wires the real `runDoctor`): export an `interface Services { runDoctor: () => Promise<DoctorResult>; }`; export `interface DoctorCheck { name: string; status: 'pass'|'warn'|'fail'; detail: string; }` and `interface DoctorResult { checks: DoctorCheck[]; overall: 'pass'|'warn'|'fail'; }` (shapes from RESEARCH §Pattern 7 lines 673-682, also D-06). Export `function createServices(): Services` returning a stub `{ runDoctor: async () => ({ checks: [], overall: 'pass' }) }`. Add a one-line comment: `// Stub — Plan 05 replaces this with the real composition over native-modules + mcp-stdout-purity checks.`

    **Step 3 — `src/mcp/tools/whoop-doctor.ts`** (≤ 5-line shim per D-11 anticipating MCP-03): lift verbatim from RESEARCH §Pattern 2 lines 426-441 — `export function registerWhoopDoctor(server: McpServer, services: Services): void { register(server, 'whoop_doctor', { description: 'Run diagnostic checks against the local install.', inputSchema: {} }, async () => { const result = await services.runDoctor(); return { content: [{ type: 'text', text: renderDoctor(result) }], structuredContent: result }; }); }`. `renderDoctor` is imported from `../../formatters/doctor.txt.js` (Plan 05 creates this file; for now, if Plan 05 hasn't run yet, import a stub: define `function renderDoctor(r: DoctorResult): string { return JSON.stringify(r); }` inline in this file — Plan 05 will replace the inline stub with the real import).

    **Step 4 — `src/mcp/index.ts`** (MCP stdio entry — pointed at by tsup): lift verbatim from RESEARCH §Pattern 3 lines 446-459 — `import { McpServer }`, `import { StdioServerTransport }`, `import { createServices }`, `import { registerWhoopDoctor }`, then `const server = new McpServer({ name: 'recovery-ledger', version: '0.1.0' });`, `const services = createServices();`, `registerWhoopDoctor(server, services);`, `const transport = new StdioServerTransport();`, `await server.connect(transport);` (top-level await is fine — ESM, target node22).

    NO `console.*` calls anywhere in steps 2-4 — CLAUDE.md §Critical Rules forbids it in src/mcp/, src/services/. NO `process.stdout.write` either — Plan 04's grep gate forbids it outside src/cli/. The cli stub file (Step 1) contains only `export {};` so neither rule fires there.
  </action>
  <verify>
    <automated>npx tsc --noEmit && test -f src/cli/index.ts && grep -qx "export {};" src/cli/index.ts && grep -q "export function createServices" src/services/index.ts && grep -q "export interface Services" src/services/index.ts && grep -q "export interface DoctorResult" src/services/index.ts && grep -q "registerWhoopDoctor" src/mcp/tools/whoop-doctor.ts && grep -q "register(server, 'whoop_doctor'" src/mcp/tools/whoop-doctor.ts && grep -q "StdioServerTransport" src/mcp/index.ts && grep -q "new McpServer({ name: 'recovery-ledger', version: '0.1.0' })" src/mcp/index.ts && ! grep -rE "(^|[^a-zA-Z])console\\." src/mcp/ src/services/ && ! grep -rE "process\\.stdout" src/mcp/ src/services/ && npm run build && test -f dist/mcp.mjs && test -f dist/cli.mjs && head -n 1 dist/mcp.mjs | grep -q "^#!/usr/bin/env node" && echo OK</automated>
  </verify>
  <done>
    Four source files committed (`src/cli/index.ts` as a one-line stub, `src/services/index.ts` as a stub barrel, `src/mcp/tools/whoop-doctor.ts`, `src/mcp/index.ts`). `npm run build` produces BOTH `dist/cli.mjs` and `dist/mcp.mjs` with shebangs on line 1. The bundled `dist/mcp.mjs` is valid (does not crash on `node --check`). No `console.*` or `process.stdout` calls anywhere in `src/mcp/` or `src/services/`.
  </done>
  <acceptance_criteria>
    - Source: `src/cli/index.ts` exists with body exactly `export {};` (one-line stub; Plan 05 will OVERWRITE).
    - Source: `src/services/index.ts` contains `export interface Services` AND `export interface DoctorResult` AND `export function createServices`.
    - Source: `src/mcp/tools/whoop-doctor.ts` contains `register(server, 'whoop_doctor'` AND imports `register` from `../register.js`.
    - Source: `src/mcp/index.ts` contains `new McpServer({ name: 'recovery-ledger', version: '0.1.0' })` AND `new StdioServerTransport()` AND `server.connect(transport)`.
    - Source: `grep -rE "(^|[^a-zA-Z])console\." src/mcp/ src/services/` returns no matches.
    - Source: `grep -rE "process\.stdout" src/mcp/ src/services/` returns no matches.
    - Source: `grep -rEn "server\.registerTool" src/mcp/ | grep -v "src/mcp/register.ts"` returns no matches (only register.ts may call it).
    - Behavior: `npm run build` exits 0 producing BOTH `dist/cli.mjs` and `dist/mcp.mjs` (the cli stub satisfies tsup's two-entry config).
    - Behavior: `dist/mcp.mjs` exists with first line exactly `#!/usr/bin/env node`.
    - Behavior: `dist/cli.mjs` exists with first line exactly `#!/usr/bin/env node` (tsup banner applied even to the stub).
    - Behavior: `node --check dist/mcp.mjs` exits 0 (valid JS syntax).
    - Behavior: `npm run lint` exits 0.
  </acceptance_criteria>
</task>

</tasks>

<verification>
1. `npx tsc --noEmit` exits 0 (all six files compile — five MCP/services source files + the one-line cli stub).
2. `npm run build` produces both `dist/cli.mjs` and `dist/mcp.mjs` with `#!/usr/bin/env node` shebangs. The cli stub (`export {};`) gives tsup a resolvable entry; Plan 05 will replace the stub with the real Commander wiring.
3. `npm run lint` exits 0 (Biome accepts all files; no `console.*` anywhere outside `src/cli/`).
4. `grep -rEn "server\.registerTool" src/mcp/ | grep -v "src/mcp/register.ts"` returns no matches.
5. The subprocess round-trip test in Plan 06 will be the load-bearing verification that this skeleton boots and responds to JSON-RPC; this plan ships the production code only.

**Note on Wave 2 parallelism:** Plan 02 (logger) and Plan 03 (MCP skeleton) have zero file overlap (`src/infrastructure/config/*` vs `src/mcp/*` + `src/services/*` + `src/cli/index.ts` stub) and can run in parallel. Plan 03's `src/mcp/index.ts` does NOT import the logger in Phase 1 (no logging on startup yet); Phase 2's auth code will be the first consumer of the logger from within `src/mcp/`.

**Note on Plan 05's overwrite of `src/cli/index.ts`:** This is intentional and matches the `src/services/index.ts` stub-then-replace pattern already in use. Plan 05 declares `src/cli/index.ts` in its `files_modified` knowing it OVERWRITES the Plan 03 one-line stub — no merge conflict because the stub has zero behavior.
</verification>

<success_criteria>
- All six files committed; `npx tsc --noEmit && npm run build && npm run lint` exits 0.
- `server.registerTool` appears exactly once across `src/`, inside `src/mcp/register.ts`.
- The four D-07 regex patterns are present in `src/mcp/sanitize.ts` verbatim (character classes, flags, replacement strings).
- The cause-chain walker has WeakSet cycle protection and a depth-8 limit per D-08.
- `dist/cli.mjs` AND `dist/mcp.mjs` build with `#!/usr/bin/env node` shebangs and are valid JS.
- Plan 04 can immediately consume `sanitize` from `src/mcp/sanitize.ts` and assert against the integration response shape from `register.ts`.
- Plan 05 can OVERWRITE the `src/cli/index.ts` stub with the real Commander wiring without merge conflict.
</success_criteria>

<output>
After completion, create `.planning/phases/01-foundation-stdout-pure-mcp-bootstrap/01-03-SUMMARY.md` documenting: which `McpServer` import path actually worked (Open Question 4), whether the inline `renderDoctor` stub stayed or was deferred to Plan 05, the confirmed contents of the `src/cli/index.ts` stub (should be exactly `export {};`), and the exact shape of the `Services` interface so Plan 05's `createServices()` implementation matches the contract.
</output>
</content>
</invoke>