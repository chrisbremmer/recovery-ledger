---
phase: 01-foundation-stdout-pure-mcp-bootstrap
plan: 03
subsystem: mcp
tags: [mcp, stdio, sanitizer, register, whoop-doctor, stub-then-replace]

requires:
  - 01-01-bootstrap (tsup two-entry config, biome noConsole, vitest)
  - 01-02-logger (no direct import yet — Phase 2 will be the first consumer from src/mcp/)

provides:
  - "src/mcp/sanitize.ts: named exports `PATTERNS`, `sanitize(input)`, and `serializeError(err)` — pure string transformations; the only source of MCP error redaction"
  - "src/mcp/register.ts: named export `register()` — the ONLY caller of `server.registerTool` across the codebase (D-09 chokepoint)"
  - "src/mcp/tools/whoop-doctor.ts: named export `registerWhoopDoctor(server, services)` — thin shim through register() that calls `services.runDoctor()`"
  - "src/mcp/index.ts: MCP stdio server entry; `serverInfo = { name: 'recovery-ledger', version: '0.1.0' }`; built artifact is `dist/mcp.mjs` with shebang banner"
  - "src/services/index.ts: stable `Services`/`DoctorCheck`/`DoctorResult` types + STUB `createServices()` returning `{ checks: [], overall: 'pass' }` — Plan 05 overwrites the stub"
  - "src/cli/index.ts: one-line `export {};` stub so tsup produces both dist/cli.mjs and dist/mcp.mjs from this wave forward — Plan 05 overwrites with the real Commander wiring"
  - "Open Question 4 RESOLVED: `@modelcontextprotocol/sdk/server/mcp.js` import path works under SDK 1.29.0's `./*` wildcard exports (no fallback needed)"
  - "Confirmed integration smoke: built `dist/mcp.mjs` responds to initialize / tools/list / tools/call(whoop_doctor) with valid JSON-RPC on stdout, zero stderr noise during normal startup"

affects:
  - 01-04-sanitizer-lint (consumes `PATTERNS` + `sanitize` + `serializeError` for unit tests; the `server.registerTool` chokepoint becomes the CI grep gate)
  - 01-05-cli-doctor (OVERWRITES `src/cli/index.ts` stub with real Commander wiring; REPLACES `services/index.ts` `runDoctor` stub with the real three-check composition; REPLACES inline `renderDoctor` in `whoop-doctor.ts` with import from `formatters/doctor.txt.js`)
  - 01-06-ci-integration (subprocess round-trip test: `dist/mcp.mjs` boots and responds — the verbatim smoke already validated locally during this plan)
  - all-phase-2-plus (every future MCP tool must register via `register()`; every error path through the wrapper is automatically sanitized)

tech-stack:
  added: []
  patterns:
    - "Single-chokepoint MCP tool registration: register.ts owns the only `server.registerTool` call; all tools call register() — enables uniform try/catch/sanitize without per-tool boilerplate"
    - "Four-pattern error sanitizer with cause-chain walker: ordered regex pipeline (most-specific first) + WeakSet-cycle-guarded depth-8 Error.cause traversal"
    - "Stub-then-replace seam for cross-wave parallelism: services/index.ts ships a stub `runDoctor` and cli/index.ts ships `export {};` so this plan does not block on Plan 05's CLI/doctor implementation; Plan 05 will overwrite both stubs"
    - "View-layer types (DoctorCheck/DoctorResult) declared once in services/index.ts and re-imported across MCP tool, CLI shim, and formatters in later plans — locks the wire shape early"

key-files:
  created:
    - "src/mcp/sanitize.ts — PATTERNS catalog (4 D-07 regex), sanitize(), serializeError() with WeakSet+depth-8 cause walker (D-08)"
    - "src/mcp/register.ts — register<I extends ZodRawShape>(server, name, config, handler) wrapping the single server.registerTool call (D-09)"
    - "src/mcp/tools/whoop-doctor.ts — registerWhoopDoctor(server, services); inline renderDoctor stub (replaced in Plan 05)"
    - "src/mcp/index.ts — McpServer + StdioServerTransport entry with top-level `await server.connect(transport)`"
    - "src/services/index.ts — Services interface + DoctorCheck/DoctorResult view types + createServices() stub"
    - "src/cli/index.ts — one-line `export {};` stub (Plan 05 OVERWRITES)"
  modified: []

key-decisions:
  - "Open Question 4 RESOLVED: `@modelcontextprotocol/sdk/server/mcp.js` is the working import path on SDK 1.29.0 — the `./*` wildcard in the SDK's exports map resolves to `dist/esm/server/mcp.js` which exports `McpServer`. No fallback to `./server/index.js` needed."
  - "Inline `renderDoctor` stub in whoop-doctor.ts STAYS — deferred to Plan 05 to swap for `../../formatters/doctor.txt.js` import. The stub returns `JSON.stringify(r)`. This keeps Plan 03 self-contained (does not require Plan 05's formatter file to exist) and matches the stub-then-replace pattern already used for services/index.ts."
  - "src/cli/index.ts confirmed body: exactly `export {};` (one line plus trailing newline). Verified by `grep -qx 'export {};' src/cli/index.ts` — exit 0."
  - "Services interface shape locked: `{ runDoctor: () => Promise<DoctorResult> }`. DoctorResult is `{ checks: DoctorCheck[]; overall: 'pass' | 'warn' | 'fail' }`. DoctorCheck is `{ name: string; status: 'pass' | 'warn' | 'fail'; detail: string }`. Plan 05's real `createServices()` must produce this exact contract — the MCP tool's `structuredContent` carries `DoctorResult` directly so any drift breaks downstream consumers."
  - "register()'s handler parameter typed as the SDK's `ToolCallback<I>` rather than the RESEARCH.md verbatim `(input) => Promise<{ content; structuredContent? }>` — SDK 1.29's `CallToolResult` is stricter than the RESEARCH template anticipated (`structuredContent: Record<string, unknown> | undefined`, content items carry optional annotations/_meta). Using ToolCallback<I> lets future tools with non-empty `inputSchema` type-check cleanly without changing register.ts."

requirements-completed:
  - FND-03
  - FND-06

duration: 4m 42s
started: 2026-05-12T17:46:09Z
completed: 2026-05-12T17:50:51Z
---

# Phase 01 Plan 03: MCP Skeleton + register() + Sanitizer Summary

**MCP stdio server skeleton wired up — McpServer + StdioServerTransport entry, a single `register()` wrapper monopolizing `server.registerTool` (D-09 chokepoint), the four-pattern D-07 sanitizer with WeakSet-cycle-guarded depth-8 cause-chain walker (D-08), and a thin `whoop_doctor` tool delegating to a stub services barrel — all six files compile under strict TS, lint clean, and the built `dist/mcp.mjs` round-trips real JSON-RPC traffic locally.**

## Performance

- **Duration:** 4m 42s
- **Started:** 2026-05-12T17:46:09Z
- **Completed:** 2026-05-12T17:50:51Z
- **Tasks:** 3
- **Files created:** 6 (sanitize.ts, register.ts, whoop-doctor.ts, mcp/index.ts, services/index.ts, cli/index.ts)
- **Files modified:** 0

## Accomplishments

- `src/mcp/sanitize.ts` exports `PATTERNS` (the four D-07 regex tuples in load-bearing order), `sanitize(input)` (pipeline pass), and `serializeError(err)` (cause-chain walker, depth ≤ 8, WeakSet cycle guard).
- `src/mcp/register.ts` is the ONLY caller of `server.registerTool` in the codebase. Every handler is wrapped in try/catch with `sanitize(serializeError(err))` in the catch path; success path returns through unchanged.
- `src/mcp/tools/whoop-doctor.ts` registers `whoop_doctor` via `register()` — the function body delegates to `services.runDoctor()` and returns `{ content: [text], structuredContent: result }`.
- `src/mcp/index.ts` constructs `new McpServer({ name: 'recovery-ledger', version: '0.1.0' })`, calls `createServices()` (Phase 1 stub), registers the tool, and connects to `new StdioServerTransport()` via top-level await.
- `src/services/index.ts` defines `Services`, `DoctorCheck`, `DoctorResult` and stubs `createServices()` returning `runDoctor: async () => ({ checks: [], overall: 'pass' })`. Plan 05 will overwrite.
- `src/cli/index.ts` is the one-line `export {};` stub; tsup's two-entry build now produces both `dist/cli.mjs` and `dist/mcp.mjs` (the cli stub bundles to 85 bytes — just the shebang and module marker; tree-shaking emits an empty chunk).
- Live JSON-RPC smoke: `node dist/mcp.mjs` over stdin processes `initialize` → `notifications/initialized` → `tools/list` → `tools/call(whoop_doctor)`, returns three valid JSON-RPC frames on stdout, and emits **zero bytes on stderr** during normal startup. Server advertises `serverInfo.name = 'recovery-ledger'`, `serverInfo.version = '0.1.0'`, capabilities `tools.listChanged: true`. The tools list contains exactly one tool — `whoop_doctor` — and the tool call returns the stub `{ checks: [], overall: 'pass' }` structured content.

## Task Commits

1. **Task 1 (sanitize.ts) — `7b16220`** — `feat(01-03): add MCP error sanitizer (D-07 patterns + D-08 cause walker)`
2. **Task 2 (register.ts) — `dea5e61`** — `feat(01-03): add register() wrapper monopolizing server.registerTool (D-09)`
3. **Task 3 (services/index.ts, cli/index.ts, mcp/tools/whoop-doctor.ts, mcp/index.ts) — `4cd6e3d`** — `feat(01-03): land MCP stdio entry, whoop_doctor shim, services + cli stubs`

**Plan metadata commit:** _to be added after this SUMMARY lands_

## Open Questions Resolved

### RESEARCH Open Question 4 — `@modelcontextprotocol/sdk/server/mcp.js` vs `./server/index.js`

**Resolution: STACK.md's `./server/mcp.js` path works on SDK 1.29.0; no fallback needed.** Verified by:

1. Reading `node_modules/@modelcontextprotocol/sdk/package.json` `exports` map: the `./*` wildcard resolves `./server/mcp.js` to `dist/esm/server/mcp.js`.
2. Confirming `dist/esm/server/mcp.d.ts` exports `class McpServer` and `type ToolCallback<Args>`.
3. `npx tsc --noEmit` exits 0 against `import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'` in both `register.ts` (type-only) and `index.ts` (runtime).
4. Live round-trip on `node dist/mcp.mjs` confirms runtime resolution.

The RESEARCH-suggested fallback to `./server/index.js` is not required and is not documented anywhere in the shipped code.

## Decisions Made

- **Open Question 4 import path:** Use `@modelcontextprotocol/sdk/server/mcp.js`. See above.
- **Inline `renderDoctor` stub stays in whoop-doctor.ts** (Plan 05 will swap for `../../formatters/doctor.txt.js` import). Keeps Plan 03 self-contained so Plan 04's unit tests can run against the sanitizer/register pair without waiting on Plan 05's formatter file.
- **`src/cli/index.ts` body is exactly `export {};` plus trailing newline.** Verified by `grep -qx "export {};" src/cli/index.ts` — exit 0. Plan 05 OVERWRITES.
- **Services shape locked early** so Plan 05's real `createServices()` and Plan 04's tests don't bikeshed. `runDoctor: () => Promise<DoctorResult>` is the contract; `DoctorResult` is `{ checks: DoctorCheck[]; overall: 'pass'|'warn'|'fail' }` per D-06.
- **`register()` handler typed via SDK's `ToolCallback<I>` instead of RESEARCH verbatim:** Rule 1 deviation — see below.

## Deviations from Plan

Two Rule 1 deviations encountered, both for SDK 1.29's stricter typing vs. the RESEARCH.md verbatim template. None required architectural changes.

### Auto-fixed Issues

**1. [Rule 1 — Bug] SDK 1.29.0's `registerTool` callback signature does not match the RESEARCH verbatim handler shape**

- **Found during:** Task 2 — `npx tsc --noEmit` after first write of register.ts
- **Issue:** The RESEARCH.md Pattern 2 template uses
  `handler: (input: Record<string, unknown>) => Promise<{ content: Array<{ type: 'text'; text: string }>; structuredContent?: unknown }>`
  and assigns the wrapper's result to `server.registerTool(name, config, async (input) => ...)`.
  Under SDK 1.29.0, `McpServer.registerTool` requires a `ToolCallback<Args>` whose shape branches on the `inputSchema` type:
  - `Args extends ZodRawShapeCompat` → `(args: ShapeOutput<Args>, extra: RequestHandlerExtra) => CallToolResult`
  - `Args = undefined` → `(extra: RequestHandlerExtra) => CallToolResult`
  Two errors flagged: (a) the handler missed the `extra` parameter, (b) `structuredContent: unknown` is not assignable to SDK's `Record<string, unknown> | undefined`.
- **Fix:** Imported the SDK's `ToolCallback` type, typed the handler parameter as `ToolCallback<I>` (Plan 04's future tools with non-empty `inputSchema` get correct `args` typing automatically), forwarded `...args: Parameters<ToolCallback<I>>` through the try/catch so we don't take a position on whether the inner handler wants `args` or just `extra`. The wrapped function is cast to `ToolCallback<I>` once at the registration site.
- **Files modified:** `src/mcp/register.ts`
- **Verification:** `npx tsc --noEmit` exits 0; `npm run lint` exits 0.
- **Committed in:** `dea5e61`

**2. [Rule 1 — Bug] `structuredContent` strict typing requires explicit cast in whoop-doctor.ts**

- **Found during:** Task 3 — initial write of whoop-doctor.ts hit TS error on `structuredContent: result` where `result: DoctorResult`.
- **Issue:** SDK 1.29's `CallToolResult.structuredContent` is `Record<string, unknown> | undefined` (a Zod record schema). A typed interface like `DoctorResult` (`{ checks: DoctorCheck[]; overall: ... }`) is structurally compatible at runtime but not by TS's strict assignability rules — TS won't auto-widen a typed interface to `Record<string, unknown>` because exactOptionalPropertyTypes treats them as different shapes.
- **Fix:** Cast through `unknown`: `structuredContent: result as unknown as Record<string, unknown>`. Behavioral identity is preserved (JSON.stringify produces the same bytes); the cast is documented at the call site by the fact that `DoctorResult` is the canonical wire shape (D-06) and downstream consumers parse the structured content back into a `DoctorResult`.
- **Files modified:** `src/mcp/tools/whoop-doctor.ts`
- **Verification:** `npx tsc --noEmit` exits 0; live round-trip confirms `structuredContent: { checks: [], overall: 'pass' }` arrives at the client correctly.
- **Committed in:** `4cd6e3d`

---

**Total deviations:** 2 auto-fixed (both Rule 1 — RESEARCH template predates SDK 1.29's strictening of `CallToolResult` and `ToolCallback`).
**Impact on plan:** All success criteria met. No D-XX decisions revisited, no architectural drift.

## Issues Encountered

None beyond the SDK-1.29 typing deviations above. The MCP SDK's import path resolved cleanly on first try (Open Question 4); the stub seams work as designed (services + cli stubs both bundle through tsup without error; Plan 05 can overwrite without merge conflict).

## Verification Output

End-to-end plan verification:

```
$ npx tsc --noEmit
exit 0

$ npm run lint
Checked 8 files in 3ms. No fixes applied.
exit 0

$ npm run test
 RUN  v4.1.6
 Test Files  1 passed (1)
 Tests       2 passed (2)
exit 0

$ npm run build
ESM dist/mcp.mjs     3.59 KB
ESM dist/cli.mjs     85.00 B
ESM ⚡️ Build success in 35ms
exit 0

$ head -n 1 dist/mcp.mjs
#!/usr/bin/env node

$ head -n 1 dist/cli.mjs
#!/usr/bin/env node

$ node --check dist/mcp.mjs
exit 0

$ grep -rE "(^|[^a-zA-Z])console\." src/mcp/ src/services/
(no matches — exit 1, expected)

$ grep -rE "process\.stdout" src/mcp/ src/services/
(no matches — exit 1, expected)

$ grep -rEn "server\.registerTool" src/mcp/ | grep -v "src/mcp/register.ts"
(no matches — exit 1, expected; only register.ts may call it)
```

Live JSON-RPC round-trip (manual MCP Inspector-style smoke):

```
stdin → 4 fixture frames (initialize / initialized notification / tools/list / tools/call whoop_doctor)
stdout ← {"result":{"protocolVersion":"2025-06-18","capabilities":{"tools":{"listChanged":true}},
          "serverInfo":{"name":"recovery-ledger","version":"0.1.0"}},"jsonrpc":"2.0","id":1}
stdout ← {"result":{"tools":[{"name":"whoop_doctor","description":"Run diagnostic checks against
          the local install.","inputSchema":{...},"execution":{"taskSupport":"forbidden"}}]},
          "jsonrpc":"2.0","id":2}
stdout ← {"result":{"content":[{"type":"text","text":"{\"checks\":[],\"overall\":\"pass\"}"}],
          "structuredContent":{"checks":[],"overall":"pass"}},"jsonrpc":"2.0","id":3}
stderr ← (empty)
```

Three frames out, three valid JSON-RPC envelopes, exactly one tool advertised, stub doctor result delivered through the register() wrapper, zero stderr noise.

## Next Phase Readiness

Plan 01-04 (sanitizer unit tests + lint enforcement) can now:

- `import { PATTERNS, sanitize, serializeError } from '../mcp/sanitize.js'` from `src/mcp/sanitize.test.ts` (Vitest test file path is exempt from `noConsole` per biome.json overrides).
- Iterate `PATTERNS` directly to write per-pattern test cases (D-10 fixtures: Authorization header with JWT, JSON token-key, bare Bearer, full cause chain).
- Assert against `register()`'s `{ content, isError: true }` shape by mocking `McpServer.registerTool` in a Vitest setup — the wrapper returns the same shape Plan 06's subprocess test will see.
- Wire the CI grep gate: `grep -rEn "server\.registerTool" src/mcp/ | grep -v "src/mcp/register.ts"` — already verified locally during this plan.

Plan 01-05 (CLI doctor) can:

- OVERWRITE `src/cli/index.ts` (currently `export {};`) with the real Commander wiring (`new Command()`, `program.version('0.1.0')`, `program.command('doctor')`, parse argv, call `services.runDoctor()` and render). No merge conflict — the stub has zero behavior.
- REPLACE the stub `createServices()` in `src/services/index.ts` with the real composition over `services/doctor/checks/native-modules.ts` + `services/doctor/checks/mcp-stdout-purity.ts`. The Services interface contract is locked, so the MCP tool and CLI shim need no changes.
- REPLACE the inline `renderDoctor` in `src/mcp/tools/whoop-doctor.ts` with `import { renderDoctor } from '../../formatters/doctor.txt.js'` once the formatter exists. The MCP tool body stays ≤ 5 lines.

Plan 01-06 (subprocess round-trip integration test) can:

- Use the four fixture frames already validated by this plan's manual smoke as the basis for `test/fixtures/mcp/{initialize,initialized,tools-list,whoop-doctor-call}.json` — protocol version `2025-06-18`, server name `recovery-ledger`, server version `0.1.0` all confirmed live.
- Use describe block `describe('MCP stdout purity (dist smoke)', ...)` per Plan 02's coordination note (no collision with `describe('logger destination', ...)`).
- Expect zero stderr bytes on the success path (confirmed by this plan's manual smoke).

## User Setup Required

None — this plan adds only source files.

## Self-Check: PASSED

- `src/mcp/sanitize.ts` exists (`grep -q "export function sanitize" src/mcp/sanitize.ts` → exit 0).
- `src/mcp/register.ts` exists (`grep -q "export function register" src/mcp/register.ts` → exit 0; `grep -c "server\.registerTool(" src/mcp/register.ts` → 1).
- `src/mcp/tools/whoop-doctor.ts` exists (`grep -q "registerWhoopDoctor" src/mcp/tools/whoop-doctor.ts` → exit 0).
- `src/mcp/index.ts` exists with `new McpServer({ name: 'recovery-ledger', version: '0.1.0' })`.
- `src/services/index.ts` exists with `Services`, `DoctorCheck`, `DoctorResult`, `createServices`.
- `src/cli/index.ts` exists with body `export {};`.
- `dist/cli.mjs` and `dist/mcp.mjs` built with shebangs (`#!/usr/bin/env node`).
- All three task commits exist in `git log`:
  - `7b16220 feat(01-03): add MCP error sanitizer (D-07 patterns + D-08 cause walker)`
  - `dea5e61 feat(01-03): add register() wrapper monopolizing server.registerTool (D-09)`
  - `4cd6e3d feat(01-03): land MCP stdio entry, whoop_doctor shim, services + cli stubs`
- No `console.*` matches in `src/mcp/` or `src/services/`.
- No `process.stdout` matches in `src/mcp/` or `src/services/`.
- `server.registerTool` chokepoint clean — only `register.ts` calls it.
- No discrepancies between claims in this summary and verifiable state.

---
*Phase: 01-foundation-stdout-pure-mcp-bootstrap*
*Completed: 2026-05-12*
