# Phase 1: Foundation & Stdout-Pure MCP Bootstrap - Research

**Researched:** 2026-05-12
**Domain:** TypeScript repo bootstrap; MCP stdio server contract; stdout-purity test plumbing; lint + CI gates; native-module load verification
**Confidence:** HIGH (every stack version cross-verified against npm registry on 2026-05-12; MCP SDK patterns confirmed against the SDK's exports map and the official server docs; Pino destination semantics confirmed against pino docs)

---

## Summary

Phase 1 is a discipline phase, not a feature phase. The deliverables are: a working `npx recovery-ledger` and `npx recovery-ledger-mcp`, four CI-enforced safety nets (stdout purity, the `noConsole` Biome rule + grep gates, the MCP error sanitizer, the native-module load probe), and the exact source-layout scaffold D-11 prescribes. The product code that comes in Phase 2+ inherits these as preconditions — they are never bolted on later.

The technical "how" the planner needs to lock down divides into six concrete sub-domains: (1) repo bootstrap (`package.json`, `tsconfig.json`, `tsup.config.ts`, `biome.json`, `vitest.config.ts`, `.gitattributes`, `.nvmrc`); (2) the stdout-pure logger (Pino → fd 2 with a programmatic assertion and a subprocess fixture round-trip); (3) the MCP stdio server skeleton with `register.ts` wrapping `server.registerTool`; (4) the `sanitize.ts` regex pipeline with `Error.cause` walking; (5) the stub `doctor` command with three checks; (6) the macOS-latest GitHub Actions workflow with the two grep gates.

**Primary recommendation:** Plan Phase 1 as roughly seven plans — bootstrap config, logger + assertion, MCP skeleton + register wrapper, sanitizer + tests, doctor + native-module checks, CI + grep gates, and the cross-cutting subprocess round-trip + fixtures — each independently testable. Pin every version in STACK.md verbatim. Do not let any plan introduce code that depends on Phase 2+ surfaces (no token store, no Drizzle, no WHOOP client). If a task is not a safety net, it does not belong in this phase.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Package manager**
- **D-01:** **npm** is the v1 package manager. Lockfile is `package-lock.json`; CI scripts use `npm ci`; install docs say `npm install`.

**Stdout-purity assertion (FND-04 + FND-05)**
- **D-02:** Two complementary checks. (a) **Programmatic Vitest unit** asserts that Pino's destination resolves to file descriptor 2 (stderr) in both dev and prod logger configurations. (b) **Subprocess fixture round-trip** in `test/integration/mcp-stdout-purity.test.ts` spawns the built `dist/mcp.mjs` as a child process, sends a fixed JSON-RPC sequence over stdin (`initialize` → `notifications/initialized` → `tools/list` → one `whoop_doctor` tool call → graceful shutdown), captures stdout, parses line-by-line, and fails the build on any non-JSON-RPC byte. Captured stderr is logged but not asserted.
- **D-03:** The subprocess test doubles as the **`dist/` smoke test** required by ROADMAP Phase 1 success criterion 5. One test, two assertions: stdout purity AND build artifact runs.
- **D-04:** Lint enforcement is **Biome's `noConsole` rule, globally enabled, with no `allow` list**. Override only for `src/cli/**/*.ts`. Tests exempt (`**/*.test.ts`). Inline `biome-ignore` for this rule is banned: a sibling CI grep step fails on any match of `biome-ignore.*noConsole`. A second CI grep gate fails on `process\.stdout` references outside `src/cli/`.

**Stub `doctor` (FND-07)**
- **D-05:** Phase 1's `recovery-ledger doctor` runs three checks: (1) `better-sqlite3` native-module load probe, (2) `@napi-rs/keyring` native-module load probe, (3) `mcp_stdout_purity` self-test — spawns its own `recovery-ledger-mcp` subprocess and runs the same JSON-RPC fixture sequence from D-02 against live stdout. The self-test is factored into `src/services/doctor/checks/mcp-stdout-purity.ts` and called from both Vitest and the doctor service.
- **D-06:** Doctor output shape: `{checks: Array<{name, status: 'pass'|'warn'|'fail', detail}>, overall: 'pass'|'warn'|'fail'}`. Structured JSON to stdout by default; `--text` flag renders a compact plaintext fallback via `src/formatters/doctor.txt.ts`.

**MCP error-sanitizer (FND-06)**
- **D-07:** Pattern catalog — strip:
  1. `Authorization:\s*Bearer\s+[^\s,;]+` (case-insensitive)
  2. JWT shape `eyJ[A-Za-z0-9_-]{4,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}`
  3. Bare `Bearer\s+[A-Za-z0-9._-]{10,}`
  4. JSON token-key values: `("(?:access_token|refresh_token|client_secret)"\s*:\s*")[^"]+` → keep the key, redact the value
- **D-08:** Sanitization scope: `Error.message` plus the full stringified `Error.cause` chain (Node 22's native cause chain — walked iteratively, depth-limited to 8). Stack traces are never returned through MCP; if surfaced anywhere else, sanitize them too.
- **D-09:** Wiring — ship `src/mcp/register.ts` as a thin wrapper around `server.registerTool` that wraps every handler in `try` / `catch` / sanitizer / formatter contract. Raw `server.registerTool` calls are disallowed outside `src/mcp/register.ts` itself; enforced by a CI grep gate (`grep -rn "server\.registerTool" src/mcp/ | grep -v register.ts`).
- **D-10:** Unit-tested directly in `src/mcp/sanitize.test.ts` against fixtures of "errors that historically leak" — at minimum: Node `fetch` `TypeError: fetch failed` with `cause` carrying an `Authorization` header; an `undici` `UND_ERR_*` variant with a JWT; a JSON error body with `"access_token": "..."`; a manually-constructed `Error` whose message contains a bare `Bearer eyJ...`. The MCP integration test (D-02) additionally asserts that the `whoop_doctor` tool call's stdout response contains no `Bearer`, no `Authorization`, no JWT-shaped substring.

**Source-layout scaffold (D-11)**
```
src/
  cli/
    index.ts                       # commander entry; --version + `doctor` subcommand
    commands/doctor.ts             # 5-line shim → services.runDoctor()
  mcp/
    index.ts                       # StdioServerTransport wire-up
    register.ts                    # registerTool wrapper (D-09)
    sanitize.ts                    # error sanitizer regex set (D-07/D-08)
    tools/whoop-doctor.ts          # 5-line shim → services.runDoctor()
  services/
    doctor/
      index.ts                     # runDoctor()
      checks/
        native-modules.ts          # better-sqlite3 + @napi-rs/keyring load probes
        mcp-stdout-purity.ts       # subprocess fixture runner (D-05)
  infrastructure/
    config/
      logger.ts                    # Pino → stderr (fd 2); dev pino-pretty also to fd 2
  formatters/
    doctor.txt.ts                  # plaintext rendering (D-06)
```
No `.gitkeep` placeholders. Phase 2+ adds its own directories.

**CI platform**
- **D-12:** GitHub Actions, **macOS-latest runner**. Linux fallback-path tests land in Phase 2. Phase 1 CI runs: `npm ci`, `npm run lint`, `npm run build`, `npm run test`, plus the two grep gates (D-04 + D-09).

### Claude's Discretion

The user delegated the following to the discuss-phase analysis and accepted the locked answers above without escalation:
- Stdout-purity test structure (D-02, D-03)
- Lint scope + override + grep gates (D-04)
- Stub doctor checks + output shape (D-05, D-06)
- Sanitizer pattern catalog + scope + wiring (D-07 through D-10)
- Source layout scaffold (D-11)
- CI platform (D-12)

Only **package manager** (D-01) was escalated; user selected npm.

### Deferred Ideas (OUT OF SCOPE for Phase 1)

- Linux / Windows CI matrix (Linux fallback tests land Phase 2; Windows is permanently out of scope per REQUIREMENTS.md).
- `@modelcontextprotocol/inspector` smoke step in CI (revisit if Phase 4 finds the integration test missing real-world breakage).
- Doctor `--json` vs default JSON (D-06 ships JSON-by-default; Phase 5 may invert).
- Schema-version `PRAGMA user_version` checks in doctor (belongs Phase 3 with the DB layer).
- Single-flight refresh contract (Phase 2 concern; the sanitizer catalog is designed to handle the token shapes the refresh will produce).

</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| FND-01 | Bootstrapped TypeScript repo (Node 22 LTS, ESM, tsup build, tsx dev) with Biome lint/format and Vitest test runner configured | `### Repo bootstrap` (package.json, tsconfig, tsup, biome, vitest configs) |
| FND-02 | Empty CLI entry point (`recovery-ledger`) registered via `bin` and runnable via `npx recovery-ledger` | `### CLI shell (Commander 14)` + tsup `banner` shebang + `package.json` `bin` field |
| FND-03 | Empty MCP stdio server entry point (`recovery-ledger-mcp`) using `@modelcontextprotocol/sdk` and stdio transport | `### MCP stdio server skeleton` |
| FND-04 | Pino logger configured to write exclusively to stderr (never stdout) with a CI-enforced assertion that the MCP server's stdout contains only valid JSON-RPC frames under fixture load | `### Pino stderr-only logger` + `### Stdout-purity assertion mechanics` |
| FND-05 | Lint rule banning bare `console.*` outside `src/cli/` and CI gate that fails on stdout pollution | `### Biome noConsole config + grep gates` |
| FND-06 | MCP error-sanitizer contract that strips Authorization headers and JWT-shaped strings from any error surfaced to a tool result | `### MCP error sanitizer (D-07/D-08/D-09/D-10)` |
| FND-07 | Native-module load verification (`better-sqlite3`, `@napi-rs/keyring`) reported by a stub `doctor` command | `### Doctor stub + native-module load probes (D-05/D-06)` |

</phase_requirements>

## Architectural Responsibility Map

This phase has no application tiers in the conventional sense (no browser, no API server). The "tiers" are file-layer responsibilities from the lite-hexagonal architecture in `.planning/research/ARCHITECTURE.md`.

| Capability | Primary File-Layer | Secondary Layer | Rationale |
|------------|--------------------|-----------------|-----------|
| CLI argv parsing + dispatch (`--version`, `doctor`) | `src/cli/` | `src/services/` | Driving adapter — never owns logic |
| MCP stdio transport + tool registration | `src/mcp/` | `src/services/` | Driving adapter — `register.ts` wrapper is the only thing in `src/mcp/` that touches `server.registerTool` |
| `runDoctor()` orchestration | `src/services/doctor/` | `src/services/doctor/checks/` | Use-case orchestration; called identically from CLI and MCP per D-05 |
| Native-module load probe | `src/services/doctor/checks/native-modules.ts` | — | Pure probe; no DB open, no keychain read — just ABI/load verification |
| Stdout-purity self-test (in-process) | `src/services/doctor/checks/mcp-stdout-purity.ts` | — | Pure subprocess-driver; same code used by Vitest integration test and doctor's third check |
| Pino logger config | `src/infrastructure/config/logger.ts` | — | Driven adapter — destination fd 2 only |
| MCP error sanitizer regex catalog | `src/mcp/sanitize.ts` | — | Driven utility — no I/O; just `(input: string) => string` |
| Doctor JSON+text rendering | `src/formatters/doctor.txt.ts` | — | Formatting only — JSON path is `JSON.stringify(result)` in the CLI command |
| CI gates (`npm ci`, lint, build, test, grep×2) | `.github/workflows/ci.yml` | — | macOS-latest runner per D-12 |

## Standard Stack

All versions pinned verbatim to `.planning/research/STACK.md`. Drift from STACK.md is a separate ADR, not a planning decision.

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Node.js | 22.x LTS (>=22.11) | Runtime | [VERIFIED: STACK.md + npm view] LTS, native `fetch`, prebuilt `better-sqlite3` binaries available |
| TypeScript | `^5.7` | Type system | [CITED: STACK.md] strict + NodeNext; Zod v4 inference; latest tag now 6.0.3 but STACK pins 5.7 line |
| `@modelcontextprotocol/sdk` | `^1.29.0` | MCP server SDK (stdio) | [VERIFIED: npm view 2026-05-12 → 1.29.0, released 2026-03-30] Provides `McpServer`, `StdioServerTransport`, `registerTool` |
| `better-sqlite3` | `^12.9.0` | Embedded SQLite (load probe only in Phase 1) | [VERIFIED: npm view → 12.10.0; STACK.md pins ^12.9 which accepts 12.10.x via caret] Native module; Phase 1 only verifies it loads |
| `@napi-rs/keyring` | `^1.3.0` | OS keychain access (load probe only in Phase 1) | [VERIFIED: npm view → 1.3.0] Drop-in keytar replacement; Phase 1 only verifies it loads |
| `commander` | `^14.0.3` | CLI framework | [VERIFIED: npm view → 14.0.3] Zero-dep; named export `Command`; ESM compatible |
| `pino` | `^10.3.1` | Structured logging → stderr only | [VERIFIED: npm view → 10.3.1] Accepts `pino.destination(2)` for fd 2 |
| `zod` | `^4.4.3` | Runtime validation | [VERIFIED: npm view → 4.4.3] Standard Schema compatible (MCP SDK uses directly for `inputSchema`) |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `pino-pretty` | `^13` | Dev log rendering | Only when `NODE_ENV=development`; configured with `options.destination: 2` so even pretty-printed output goes to stderr |
| `tsx` | `^4.21.0` | Dev runner / TS execution | `npm run dev:cli`, `npm run dev:mcp` |
| `tsup` | `^8.5.1` | Production bundler | Outputs `dist/cli.mjs` + `dist/mcp.mjs`; ESM, target node22, banner shebang |
| `vitest` | `^4.1.6` | Test runner | `pool: 'forks'` mandatory per CLAUDE.md (native modules don't cross worker threads) |
| `@biomejs/biome` | `^2.4.15` | Lint + format | `noConsole` rule globally enabled per D-04 |
| `msw` | `^2.14.6` | HTTP mocking | Installed in Phase 1 but only configured in Phase 4 (no WHOOP calls yet); listing here so the planner adds it to `devDependencies` now to avoid a re-install in Phase 4 — OR defer entirely. **Recommendation: defer to Phase 4.** Phase 1 has no fetch calls to mock |
| `@types/node` | `^22` | Node typings | Match Node major |
| `@types/better-sqlite3` | `^7` | better-sqlite3 typings | Required even for the load probe (`Database` type) |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Commander 14 | Citty 0.2.x | UnJS ergonomics, but Commander is more boring + zero-dep; STACK.md picks Commander |
| Pino 10 | consola | consola is pretty but weak structured logging; Pino is the diagnostic logger; consola would be CLI-formatter territory |
| tsup | rollup / webpack / esbuild directly | tsup is esbuild + zero-config + banner support; chosen in STACK.md |
| Vitest | Jest | Jest's ESM story still painful; Vitest is the de facto standard 2025-2026 |
| Biome | ESLint + Prettier | Single binary, fast, covers our rule set; ESLint is the documented fallback per CLAUDE.md only if Biome causes friction |

### Installation

```bash
# Phase 1 production deps
npm install \
  @modelcontextprotocol/sdk@^1.29.0 \
  better-sqlite3@^12.9.0 \
  @napi-rs/keyring@^1.3.0 \
  commander@^14.0.3 \
  pino@^10.3.1 \
  zod@^4.4.3

# Phase 1 dev deps
npm install -D \
  typescript@^5.7 \
  @types/node@^22 \
  @types/better-sqlite3@^7 \
  tsx@^4.21 \
  tsup@^8.5 \
  vitest@^4.1.6 \
  pino-pretty@^13 \
  @biomejs/biome@^2.4.15
```

[VERIFIED: npm view on 2026-05-12 for every package above; all match STACK.md within caret tolerance]

### Version verification log (2026-05-12)

| Package | STACK.md pin | npm latest | Within caret? |
|---------|--------------|------------|----------------|
| `@modelcontextprotocol/sdk` | ^1.29.0 | 1.29.0 | exact |
| `better-sqlite3` | ^12.9.0 | 12.10.0 | yes |
| `@napi-rs/keyring` | ^1.3.0 | 1.3.0 | exact |
| `commander` | ^14.0.3 | 14.0.3 | exact |
| `pino` | ^10.3.1 | 10.3.1 | exact |
| `zod` | ^4.4.3 | 4.4.3 | exact |
| `tsup` | ^8.5 | 8.5.1 | yes |
| `vitest` | ^4.1.6 | 4.1.6 | exact |
| `@biomejs/biome` | ^2.4.15 | 2.4.15 | exact |
| `tsx` | ^4.21 | 4.21.0 | yes |
| `typescript` | ^5.7 | 6.0.3 (latest) | **caret excludes** — STACK pins to 5.7 line. Do NOT auto-bump to 6.x in Phase 1; that's a separate ADR. |

## Architecture Patterns

### System Architecture Diagram

```
                ┌────────────────────────────────────────────────────────┐
                │  Driving adapters (entry points written in Phase 1)    │
                │                                                        │
   ┌──────────┐ │   ┌──────────────────┐         ┌──────────────────┐   │
   │ argv     │─┼──►│ src/cli/index.ts │         │ src/mcp/index.ts │◄──┼── stdin (JSON-RPC)
   │ stdout   │◄┼───│ Commander 14     │         │ StdioServer-     │   │
   │ exit     │ │   │ --version        │         │   Transport      │───┼─► stdout (JSON-RPC ONLY)
   │ code     │ │   │ `doctor` cmd     │         │ register.ts      │   │
   └──────────┘ │   └────────┬─────────┘         └────────┬─────────┘   │
                │            │                            │             │
                │            ▼                            ▼             │
                │   ┌────────────────────────────────────────────────┐  │
                │   │   src/services/doctor/index.ts (runDoctor)     │  │
                │   │   ────────────────────────────────────────     │  │
                │   │   composes 3 checks → DoctorResult             │  │
                │   └──┬────────────┬───────────────────────┬────────┘  │
                │      │            │                       │           │
                │      ▼            ▼                       ▼           │
                │   ┌──────┐   ┌──────────┐         ┌───────────────┐   │
                │   │native│   │ keyring  │         │mcp-stdout-    │   │
                │   │mods  │   │ load     │         │purity         │   │
                │   │.ts   │   │ probe    │         │spawn subproc  │   │
                │   └───┬──┘   └────┬─────┘         │JSON-RPC seq   │   │
                │       │           │               │assert stdout  │   │
                │       │           │               └──┬────────────┘   │
                │       │           │                  │                │
                │       ▼           ▼                  ▼                │
                │   ┌──────────────────────────────────────────────┐    │
                │   │  Cross-cutting (always loaded)               │    │
                │   │  ──────────────────────────────────────────  │    │
                │   │  src/infrastructure/config/logger.ts         │    │
                │   │   → Pino destination fd 2 (stderr) ALWAYS    │    │
                │   │  src/mcp/sanitize.ts                         │    │
                │   │   → 4 regex patterns; cause-chain walk d≤8   │    │
                │   │  src/mcp/register.ts                         │    │
                │   │   → try/catch/sanitize wrapper around tools  │    │
                │   │  src/formatters/doctor.txt.ts                │    │
                │   │   → compact plaintext for --text             │    │
                │   └──────────────────────────────────────────────┘    │
                │                                                        │
                └────────────────────────────────────────────────────────┘
                                       │
                                       ▼
                  ┌────────────────────────────────────────────┐
                  │  CI invariants enforced from the first     │
                  │  commit that adds src/                     │
                  │  ─────────────────────────────────────     │
                  │  Biome `noConsole` (global, src/cli/ excl) │
                  │  grep `biome-ignore.*noConsole` → exit 1   │
                  │  grep `process\.stdout` outside src/cli/   │
                  │  grep `server\.registerTool` outside       │
                  │       src/mcp/register.ts                  │
                  │  Vitest: logger destination = fd 2         │
                  │  Vitest: dist/mcp.mjs subprocess round-    │
                  │          trip → stdout is line-by-line     │
                  │          valid JSON-RPC                    │
                  └────────────────────────────────────────────┘
```

### Recommended Project Structure

Verbatim from D-11. The planner MUST NOT invent intermediate barrel files.

```
recovery-ledger/
├── .github/
│   └── workflows/
│       └── ci.yml                            # macOS-latest, single job
├── .gitattributes                            # *.ts text eol=lf; bin/* text eol=lf
├── .nvmrc                                    # "22"
├── .gitignore                                # node_modules, dist, coverage, ~/-style locals
├── package.json                              # bin entries, scripts, engines, type:module
├── package-lock.json                         # checked in (npm)
├── tsconfig.json                             # strict, NodeNext, exactOptionalPropertyTypes
├── tsup.config.ts                            # two entries, ESM, banner, external native
├── vitest.config.ts                          # pool: 'forks'
├── biome.json                                # noConsole global + src/cli/ override
├── README.md                                 # exists already (planning artifact)
├── CLAUDE.md                                 # exists already (project policy)
├── .planning/                                # exists already (out of scope here)
├── src/
│   ├── cli/
│   │   ├── index.ts                          # commander wiring, version, dispatch
│   │   └── commands/
│   │       └── doctor.ts                     # 5-line shim → services.runDoctor()
│   ├── mcp/
│   │   ├── index.ts                          # McpServer + StdioServerTransport
│   │   ├── register.ts                       # registerTool wrapper (D-09)
│   │   ├── sanitize.ts                       # 4 regex patterns + cause-chain walk
│   │   ├── sanitize.test.ts                  # D-10 fixtures (lives next to source)
│   │   └── tools/
│   │       └── whoop-doctor.ts               # 5-line shim → services.runDoctor()
│   ├── services/
│   │   └── doctor/
│   │       ├── index.ts                      # runDoctor()
│   │       └── checks/
│   │           ├── native-modules.ts         # better-sqlite3 + @napi-rs/keyring load probes
│   │           └── mcp-stdout-purity.ts      # subprocess driver (shared with integration test)
│   ├── infrastructure/
│   │   └── config/
│   │       └── logger.ts                     # Pino → fd 2
│   └── formatters/
│       └── doctor.txt.ts                     # plaintext rendering of DoctorResult
└── test/
    ├── fixtures/
    │   └── mcp/
    │       ├── initialize.json               # JSON-RPC initialize request
    │       ├── initialized.json              # notifications/initialized
    │       ├── tools-list.json               # tools/list request
    │       └── whoop-doctor-call.json        # tools/call for whoop_doctor
    └── integration/
        └── mcp-stdout-purity.test.ts         # D-02 subprocess round-trip + D-03 dist smoke
```

### Pattern 1: Pino logger → stderr (fd 2) ALWAYS

**What:** Logger destination is hardcoded to fd 2 in both prod and dev. Dev uses pino-pretty as a transport but routes its rendered output to fd 2.

**When to use:** Every Phase 1+ module that needs to log. There is no "log to stdout" path in this codebase.

**Example (prod):**
```typescript
// src/infrastructure/config/logger.ts
// Source: https://getpino.io/#/docs/api?id=pino-destination
import { pino } from 'pino';

const isDev = process.env['NODE_ENV'] === 'development';

export const logger = isDev
  ? pino({
      level: process.env['LOG_LEVEL'] ?? 'debug',
      transport: {
        target: 'pino-pretty',
        options: { destination: 2 }, // fd 2 = stderr
      },
    })
  : pino(
      { level: process.env['LOG_LEVEL'] ?? 'info' },
      pino.destination({ dest: 2, sync: false }),
    );
```

[VERIFIED: pino docs — `pino.destination(2)` and `pino.destination({ dest: 2 })` both target fd 2; pino-pretty `destination: 2` option routes prettified output to stderr]

### Pattern 2: MCP stdio server with `register.ts` wrapper

**What:** A single `register()` function in `src/mcp/register.ts` is the only place `server.registerTool` is called. Every tool definition file calls `register(server, name, schema, handler)`. The wrapper installs try/catch/sanitize/formatter contract.

**When to use:** Every MCP tool from Phase 1 forward. Phase 1 ships exactly one: `whoop_doctor`.

**Example:**
```typescript
// src/mcp/register.ts
// Source: https://github.com/modelcontextprotocol/typescript-sdk/blob/main/docs/server.md
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import type { ZodRawShape } from 'zod';
import { sanitize } from './sanitize.js';

interface ToolConfig<I extends ZodRawShape> {
  title?: string;
  description: string;
  inputSchema: I;
}

export function register<I extends ZodRawShape>(
  server: McpServer,
  name: string,
  config: ToolConfig<I>,
  handler: (input: Record<string, unknown>) => Promise<{
    content: Array<{ type: 'text'; text: string }>;
    structuredContent?: unknown;
  }>,
): void {
  server.registerTool(name, config, async (input) => {
    try {
      const result = await handler(input);
      return result satisfies CallToolResult;
    } catch (err) {
      return {
        content: [{ type: 'text', text: sanitize(serializeError(err)) }],
        isError: true,
      } satisfies CallToolResult;
    }
  });
}

function serializeError(err: unknown): string {
  if (!(err instanceof Error)) return String(err);
  const parts: string[] = [err.message];
  let cause: unknown = err.cause;
  let depth = 0;
  const seen = new WeakSet<object>();
  while (cause && depth < 8) {
    if (typeof cause === 'object' && cause !== null) {
      if (seen.has(cause)) break;
      seen.add(cause);
    }
    if (cause instanceof Error) {
      parts.push(`caused by: ${cause.message}`);
      cause = cause.cause;
    } else {
      parts.push(`caused by: ${String(cause)}`);
      break;
    }
    depth += 1;
  }
  return parts.join(' — ');
}
```

[VERIFIED: MCP SDK exports map confirms `@modelcontextprotocol/sdk/server/mcp.js` import path. CITED: official server docs show the `try/catch → { content, isError: true }` pattern for tool error returns.]

**Tool file (Phase 1 ships exactly one):**
```typescript
// src/mcp/tools/whoop-doctor.ts
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { Services } from '../../services/index.js';
import { register } from '../register.js';
import { renderDoctor } from '../../formatters/doctor.txt.js';

export function registerWhoopDoctor(server: McpServer, services: Services): void {
  register(server, 'whoop_doctor',
    { description: 'Run diagnostic checks against the local install.', inputSchema: {} },
    async () => {
      const result = await services.runDoctor();
      return { content: [{ type: 'text', text: renderDoctor(result) }], structuredContent: result };
    });
}
```

### Pattern 3: MCP stdio server entry point

```typescript
// src/mcp/index.ts
// Source: https://github.com/modelcontextprotocol/typescript-sdk/blob/main/docs/server.md
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createServices } from '../services/index.js';
import { registerWhoopDoctor } from './tools/whoop-doctor.js';

const server = new McpServer({ name: 'recovery-ledger', version: '0.1.0' });
const services = createServices(); // Phase 1: zero injected deps
registerWhoopDoctor(server, services);

const transport = new StdioServerTransport();
await server.connect(transport);
```

### Pattern 4: Sanitizer regex pipeline + cause-chain walk

```typescript
// src/mcp/sanitize.ts
// Patterns from CONTEXT.md D-07. Order matters: more-specific patterns run first
// so the bearer-less JWT pattern doesn't pre-empt the Authorization header pattern.

const PATTERNS: ReadonlyArray<{ pattern: RegExp; replacement: string }> = [
  // 1. Authorization header (case-insensitive)
  { pattern: /Authorization:\s*Bearer\s+[^\s,;]+/gi, replacement: 'Authorization: Bearer <redacted>' },
  // 2. JSON token-key values — keep the key, redact the value
  { pattern: /("(?:access_token|refresh_token|client_secret)"\s*:\s*")[^"]+/g, replacement: '$1<redacted>' },
  // 3. JWT shape
  { pattern: /eyJ[A-Za-z0-9_-]{4,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g, replacement: '<redacted-jwt>' },
  // 4. Bare Bearer token in error messages
  { pattern: /Bearer\s+[A-Za-z0-9._-]{10,}/g, replacement: 'Bearer <redacted>' },
];

export function sanitize(input: string): string {
  let out = input;
  for (const { pattern, replacement } of PATTERNS) {
    out = out.replace(pattern, replacement);
  }
  return out;
}
```

**Regex gotchas (verified):**
- All patterns use the `g` flag — multiple matches per string are scrubbed.
- Pattern 1 uses `i` (case-insensitive) per D-07; HTTP header names are case-insensitive but tokens stored verbatim case-sensitive.
- Pattern 2 uses a back-reference `$1` to keep the JSON key visible — auditable redaction.
- Pattern 3 uses `[A-Za-z0-9_-]` (base64url alphabet) deliberately; do NOT add `+` `/` `=` because those aren't valid in JWT base64url encoding and a token containing them is malformed.
- Pattern 4's `{10,}` minimum length prevents stripping the literal word "Bearer" if it appears elsewhere in prose.
- **No `m` flag, no `s` flag.** Patterns must work on single-line stringified errors AND multiline cause chains; the `g` flag alone handles both because there's no `^`/`$`/`.` involved.

### Pattern 5: Stdout-purity assertion mechanics (D-02)

**(a) Programmatic Vitest unit — verify Pino destination = fd 2.**

The Pino docs note `pino.symbols` exposes internal state. The robust way to verify the destination is to construct the logger and inspect its destination via `pino.symbols.streamSym`:

```typescript
// src/infrastructure/config/logger.test.ts
import { describe, expect, test } from 'vitest';
import { pino } from 'pino';
import { logger } from './logger.js';

describe('logger destination', () => {
  test('writes to fd 2 (stderr) in prod', () => {
    // Pino exposes the underlying destination via pino.symbols
    const stream = (logger as unknown as Record<symbol, unknown>)[pino.symbols.streamSym] as
      | { fd?: number }
      | undefined;
    expect(stream?.fd).toBe(2);
  });
});
```

[ASSUMED] The exact symbol name `streamSym` is the documented Pino symbol for accessing the destination; the planner should verify the symbol name against the installed Pino version's `lib/symbols.js` during plan execution. **Fallback approach if symbol introspection is fragile:** construct the logger with an explicit `pino.destination({ dest: 2 })` and assert the returned destination's `.fd === 2` property directly without going through `pino.symbols`:

```typescript
test('pino.destination explicitly bound to fd 2', () => {
  const dest = pino.destination({ dest: 2, sync: true });
  expect(dest.fd).toBe(2);
});
```

This is brittle to Pino internals; the **subprocess round-trip is the load-bearing test** — the unit test is just a fast pre-check. The planner should treat the unit test as best-effort and let the integration test be the gate.

**(b) Subprocess fixture round-trip (load-bearing).**

```typescript
// test/integration/mcp-stdout-purity.test.ts
import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { describe, expect, test } from 'vitest';

const FIXTURES = ['initialize', 'initialized', 'tools-list', 'whoop-doctor-call'] as const;

describe('MCP stdout purity (dist smoke)', () => {
  test('dist/mcp.mjs stdout contains only valid JSON-RPC', async () => {
    const child = spawn(process.execPath, ['dist/mcp.mjs'], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, NODE_ENV: 'production' },
    });

    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    child.stdout.on('data', (b: Buffer) => stdoutChunks.push(b));
    child.stderr.on('data', (b: Buffer) => stderrChunks.push(b));

    for (const name of FIXTURES) {
      const json = await readFile(`test/fixtures/mcp/${name}.json`, 'utf8');
      child.stdin.write(json.trim() + '\n');
      // Allow round-trip; resolved on next response
      await new Promise<void>((r) => setTimeout(r, 100));
    }
    child.stdin.end();
    const exitCode = await new Promise<number>((r) => child.on('close', (c) => r(c ?? -1)));

    const stdout = Buffer.concat(stdoutChunks).toString('utf8');
    const stderr = Buffer.concat(stderrChunks).toString('utf8');

    // ASSERTION 1: every non-empty line on stdout MUST parse as JSON-RPC
    for (const line of stdout.split('\n').filter(Boolean)) {
      const parsed = JSON.parse(line); // throws if not JSON — that's the assertion
      expect(parsed).toHaveProperty('jsonrpc', '2.0');
    }
    // ASSERTION 2: no token-shaped strings on stdout (sanitizer integration check)
    expect(stdout).not.toMatch(/Bearer\s/);
    expect(stdout).not.toMatch(/Authorization:/i);
    expect(stdout).not.toMatch(/eyJ[A-Za-z0-9_-]{4,}\./);

    // Diagnostic: stderr is logged but NOT asserted
    if (stderr) console.error('[mcp stderr]:', stderr); // only used in test debug, allowed
    expect(exitCode).toBeLessThanOrEqual(0); // 0 on graceful close
  });
});
```

[VERIFIED: `node:child_process spawn` returns Buffer streams; line-delimited JSON-RPC is the stdio framing per the MCP spec.]

**Critical: this test depends on `dist/mcp.mjs` existing.** The CI workflow MUST run `npm run build` before `npm run test`, or the test must `await build()` itself. **Recommendation:** order steps in CI as `npm ci → npm run lint → npm run build → npm run test → grep gates`. Do not skip build before test.

**JSON-RPC fixture content (Phase 1 — exact wire payloads):**

```json
// test/fixtures/mcp/initialize.json
{ "jsonrpc": "2.0", "id": 1, "method": "initialize",
  "params": { "protocolVersion": "2025-06-18", "capabilities": {},
              "clientInfo": { "name": "stdout-purity-test", "version": "0.0.0" } } }
```
```json
// test/fixtures/mcp/initialized.json
{ "jsonrpc": "2.0", "method": "notifications/initialized" }
```
```json
// test/fixtures/mcp/tools-list.json
{ "jsonrpc": "2.0", "id": 2, "method": "tools/list" }
```
```json
// test/fixtures/mcp/whoop-doctor-call.json
{ "jsonrpc": "2.0", "id": 3, "method": "tools/call",
  "params": { "name": "whoop_doctor", "arguments": {} } }
```

[CITED: MCP specification 2025-06-18 — current protocol version per https://modelcontextprotocol.io/specification/2025-06-18]

[ASSUMED] The `protocolVersion: "2025-06-18"` is the current spec version; the planner should verify against the installed SDK's `package.json` or the official spec URL at plan-time. If the SDK ships with a different default version, use whatever the SDK advertises in its own examples.

### Pattern 6: Native-module load probes (FND-07, D-05)

The cheapest "did the module load and bind to its native binary" assertion that does NOT open a real DB or hit the keychain:

```typescript
// src/services/doctor/checks/native-modules.ts
import type { DoctorCheck } from '../index.js';

export async function probeBetterSqlite3(): Promise<DoctorCheck> {
  try {
    const mod = await import('better-sqlite3');
    // Cheapest binding-touched assertion: open an in-memory DB and immediately close.
    // :memory: never touches disk; this only proves the .node binary loaded under the current ABI.
    const db = new mod.default(':memory:');
    db.close();
    return { name: 'better_sqlite3_load', status: 'pass', detail: 'native binding loaded' };
  } catch (err) {
    return {
      name: 'better_sqlite3_load',
      status: 'fail',
      detail: `failed to load: ${err instanceof Error ? err.message : String(err)} — try \`npm rebuild better-sqlite3\``,
    };
  }
}

export async function probeKeyring(): Promise<DoctorCheck> {
  try {
    const mod = await import('@napi-rs/keyring');
    // Construct an Entry without any read/write — proves the napi binding loaded.
    // The constructor does not touch the keychain.
    new mod.Entry('recovery-ledger', 'doctor-probe');
    return { name: 'napi_keyring_load', status: 'pass', detail: 'native binding loaded' };
  } catch (err) {
    return {
      name: 'napi_keyring_load',
      status: 'fail',
      detail: `failed to load: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}
```

**Why `:memory:` for better-sqlite3:**
- Triggers the native binding's full constructor path (proves the `.node` file loaded against the current ABI)
- Touches zero filesystem
- Closes synchronously
- Fast (sub-millisecond)

**Why `new Entry(...)` for `@napi-rs/keyring`:**
- The `Entry` constructor binds to the napi-rs Rust binary
- Does NOT issue any keychain syscalls until `.set_password()` / `.get_password()` is called
- Proves the binary loaded; defers the actual keychain-availability check to Phase 2

[ASSUMED] The `@napi-rs/keyring` v1.3.0 public API has `Entry(service, account)` as the named export constructor. Confirm at plan-time by `npm view @napi-rs/keyring exports` or by reading the package's `index.d.ts`. If the API has changed, fall back to `Object.keys(mod).length > 0` as a load-only assertion. **Phase 2 will replace this stub with a real keychain probe; Phase 1's contract is "the binary loads under the current Node ABI."**

### Pattern 7: Doctor service composition (D-05)

```typescript
// src/services/doctor/index.ts
import { probeBetterSqlite3, probeKeyring } from './checks/native-modules.js';
import { probeMcpStdoutPurity } from './checks/mcp-stdout-purity.js';

export interface DoctorCheck {
  name: string;
  status: 'pass' | 'warn' | 'fail';
  detail: string;
}

export interface DoctorResult {
  checks: DoctorCheck[];
  overall: 'pass' | 'warn' | 'fail';
}

export async function runDoctor(): Promise<DoctorResult> {
  const checks = await Promise.all([
    probeBetterSqlite3(),
    probeKeyring(),
    probeMcpStdoutPurity(),
  ]);
  const overall: DoctorResult['overall'] =
    checks.some((c) => c.status === 'fail') ? 'fail' :
    checks.some((c) => c.status === 'warn') ? 'warn' : 'pass';
  return { checks, overall };
}
```

### Pattern 8: CLI shim (FND-02)

```typescript
// src/cli/index.ts
// Source: https://github.com/tj/commander.js
import { Command } from 'commander';
import { runDoctorCommand } from './commands/doctor.js';

const program = new Command();
program
  .name('recovery-ledger')
  .version('0.1.0')  // wired from package.json in Phase 2+
  .description('Local-first WHOOP review + decision ledger');

program
  .command('doctor')
  .description('Run diagnostic checks')
  .option('--text', 'render plaintext instead of JSON')
  .action(runDoctorCommand);

await program.parseAsync(process.argv);
```

```typescript
// src/cli/commands/doctor.ts (5-line shim per D-11)
import { runDoctor } from '../../services/doctor/index.js';
import { renderDoctor } from '../../formatters/doctor.txt.js';

export async function runDoctorCommand(opts: { text?: boolean }): Promise<void> {
  const result = await runDoctor();
  process.stdout.write((opts.text ? renderDoctor(result) : JSON.stringify(result, null, 2)) + '\n');
  process.exit(result.overall === 'fail' ? 1 : 0);
}
```

**Note:** This is the ONLY place in the codebase that `process.stdout.write` is allowed. The grep gate confirms.

[VERIFIED: Commander 14 named export `Command` from default ESM export shape; npm view commander confirms ESM-compatible package.]

### Anti-Patterns to Avoid

- **`console.log` anywhere in `src/mcp/`, `src/services/`, `src/infrastructure/`, `src/formatters/`.** Biome catches it; grep gate catches `process.stdout`; subprocess test catches a leak that slips through. Three layers of defense per CLAUDE.md.
- **`server.registerTool` called outside `src/mcp/register.ts`.** Grep gate fails the build. Every tool from Phase 1 onward must go through `register()` so the try/catch/sanitize contract is non-bypassable.
- **`biome-ignore lint/suspicious/noConsole`** anywhere in the codebase. Grep gate fails the build. The override goes in `biome.json` for `src/cli/**/*.ts`, not inline.
- **Running tests before build.** The integration test requires `dist/mcp.mjs`. Order CI as `lint → build → test`. Locally, `npm test` can call `npm run build` as a pre-test hook if desired, but CI should be explicit.
- **Skipping `pool: 'forks'` in vitest.config.ts.** Native modules don't cross worker threads cleanly. CLAUDE.md is explicit about this — it's a load-bearing constraint, not a perf hint.
- **Loose tsconfig.** STACK.md and CLAUDE.md both pin `strict: true`, `noUncheckedIndexedAccess: true`, `exactOptionalPropertyTypes: true`. Any plan that disables one of these is a Phase 1 regression.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| MCP stdio framing | Manual JSON-RPC parser over stdin | `StdioServerTransport` from `@modelcontextprotocol/sdk/server/stdio.js` | SDK owns the framing, batching, error handling |
| Tool registration shape | Hand-rolled `JSON.stringify({content,...})` | `server.registerTool(name, config, handler)` | SDK validates inputSchema against Zod, builds the wire response correctly |
| Argv parsing | Manual `process.argv` slicing | Commander 14 `Command` | Built-in `--version`, `--help`, subcommands, type coercion |
| Bundler config for Node CLI | webpack / rollup | tsup `defineConfig` | esbuild speed, banner support, zero-config for our shape |
| Test runner watching native modules | Worker pool | Vitest `pool: 'forks'` | Better-sqlite3 native handles do not survive worker-thread boundaries |
| JSON logger to stderr | `console.error(JSON.stringify(...))` | Pino with `pino.destination(2)` | Async write, structured fields, child loggers, log levels |
| Shebang preservation through bundler | Post-build `sed`/`prepend` script | tsup `banner: { js: '#!/usr/bin/env node' }` | Built-in; survives `npx` |
| Linting + formatting + grep gates | ESLint + Prettier + Husky | Biome `noConsole` + bash grep in CI | Single binary; grep gates are intentionally outside the linter because they assert what the linter cannot (cross-file regex over file paths) |

**Key insight:** Phase 1 is a config phase, not an algorithm phase. Hand-rolling here means re-implementing protocol framing, argv parsing, or bundler logic — every one of which has a battle-tested library. The interesting custom code in Phase 1 is the sanitizer regex set and the subprocess driver — both deliberate, narrow, and tested.

## Runtime State Inventory

Not applicable — Phase 1 is greenfield. There is no pre-existing runtime state to migrate. The repo currently contains only `CLAUDE.md`, `README.md`, and the `.planning/` directory. **Nothing found in any category — verified by `ls /Users/chris.bremmer/recovery-ledger/` returning only `CLAUDE.md` and `README.md` in the working tree root.**

## Common Pitfalls

### Pitfall 1: Pino bundled by tsup loses its worker thread (pino-pretty transport breaks)
**What goes wrong:** Pino's transports run in worker threads. If `pino-pretty` is bundled into `dist/`, the transport spawn step looks for the module on disk and can't find it — the logger falls back silently or throws.
**Why it happens:** tsup defaults to bundling all imports. Pino + transports use a thread-loading pattern where the transport target must be resolvable at runtime, not bundled.
**How to avoid:** Add Pino transport modules to tsup `external` (or keep `pino-pretty` as a dev-only dep so it's only imported when `NODE_ENV=development`, never in the production `dist/mcp.mjs` path). Phase 1 ships with `NODE_ENV=production` in CI, so the pino-pretty path isn't exercised — but make sure the prod logger codepath doesn't import pino-pretty unconditionally.
**Warning signs:** Logger silently produces no output in dev; or a `Cannot find module 'pino-pretty'` warning when running `dist/mcp.mjs`.

[CITED: pino docs on transports — https://getpino.io/#/docs/transports]

### Pitfall 2: `better-sqlite3` prebuilt-binary ABI mismatch on Node 22 mac arm64
**What goes wrong:** `npm install` succeeds, but `import('better-sqlite3')` throws `Error: The module 'better_sqlite3.node' was compiled against a different Node.js version`. The doctor's native-module probe is the test that catches this.
**Why it happens:** The package ships prebuilt binaries for common platforms (Node 22 mac arm64 is supported). Edge cases: a user on Node 23/24/25 with no matching prebuild falls back to `node-gyp` compile — which requires Xcode CLT installed. CI runs on Node 22 (`.nvmrc`), so this should be silent there. Local dev is at risk; the box where this research was conducted runs Node 25.2.1.
**How to avoid:** `.nvmrc` pinned to `22`. `engines.node` set to `>=22.11`. Add `postinstall: "npm rebuild better-sqlite3"` as a defensive guard if Phase 1 CI shows ABI flakiness, but try without first — prebuilds exist for Node 22 mac arm64. Doctor's native-module probe surfaces failures with the `npm rebuild` suggestion.
**Warning signs:** `Error: The module 'better_sqlite3.node' was compiled against a different Node.js version` or `dlopen` errors on import. Doctor fails the `better_sqlite3_load` check.

[VERIFIED: pitfalls.md Pitfall 20; better-sqlite3 GitHub issue #1015]

### Pitfall 3: Commander 14 ESM import shape
**What goes wrong:** `import Commander from 'commander'` (default import) works in CJS but is brittle in ESM under NodeNext.
**How to avoid:** Use the named export: `import { Command } from 'commander';`. Commander 14 supports both, but the named export is the documented ESM pattern. Verified against npm — Commander 14's `package.json` has a proper `exports` map and `Command` is a named export.
**Warning signs:** `TypeError: Commander is not a constructor` or `Cannot read properties of undefined (reading 'Command')`.

[VERIFIED: npm view commander exports; STACK.md alternatives table]

### Pitfall 4: tsup `external` vs `noExternal` for native modules
**What goes wrong:** `better-sqlite3` (or `@napi-rs/keyring`) gets bundled into `dist/mcp.mjs`, but bundling can't include a `.node` binary. At runtime, the require resolution fails.
**How to avoid:** STACK.md prescribes `external: ['better-sqlite3', '@napi-rs/keyring']` in `tsup.config.ts`. This makes tsup leave the imports as `import` statements pointing at the installed npm package, where Node will load the native binding at runtime.
**Warning signs:** `dist/mcp.mjs` size jumps significantly; runtime error `Cannot find module 'better_sqlite3.node'`.

[CITED: STACK.md `tsup.config.ts` example + tsup docs on `external`]

### Pitfall 5: Vitest worker threads vs `pool: 'forks'` for native modules
**What goes wrong:** Default Vitest pool uses worker threads. Native modules (better-sqlite3, @napi-rs/keyring) hold C++ handles that don't survive worker-thread context boundaries — tests crash with cryptic native errors.
**How to avoid:** `vitest.config.ts` MUST set `pool: 'forks'`. This is in CLAUDE.md as a Testing rule.
**Warning signs:** Tests fail with `SIGSEGV`, `Database is closed`, or cryptic `Could not locate the bindings file` errors when run in parallel but pass when run with `--no-file-parallelism`.

[CITED: CLAUDE.md §Testing; Vitest docs — https://vitest.dev/config/#pool]

### Pitfall 6: tsup `banner: '#!/usr/bin/env node'` preserved but missing exec bit
**What goes wrong:** tsup writes the shebang correctly, but the file is `chmod 644`. `npx recovery-ledger` works (it invokes via `node`) but a direct invocation `./dist/cli.mjs` doesn't.
**How to avoid:** Either add a `chmod +x` step to the build script (`tsup && chmod +x dist/cli.mjs dist/mcp.mjs`), or rely on `npm install -g` to fix permissions when the package is installed via the `bin` field (it does, automatically). FND-02 only requires `npx` to work, which `npm publish` + `npx` arrange.
**Warning signs:** A user running `./dist/cli.mjs` directly gets "Permission denied".

[VERIFIED: tsup docs — `banner` injects but doesn't `chmod`; npm `bin` field handles `chmod +x` at install time]

### Pitfall 7: JSON-RPC `protocolVersion` mismatch between fixture and SDK
**What goes wrong:** The fixture sends `protocolVersion: "2025-06-18"`. The installed SDK negotiates a different version. The subprocess test gets unexpected error responses on stdout — which still parse as JSON-RPC, so the test "passes" but doesn't exercise a tool call.
**How to avoid:** When implementing, verify the fixture's `protocolVersion` matches what the SDK advertises. If they disagree, the SDK returns an `initialize` error response (still valid JSON-RPC), which the test's first assertion passes — but the `tools/call` step then returns an error and the test never reaches the actual tool. Catch this by also asserting in the test that the response to `tools/call` has a non-error result.
**How the planner should encode this:** add a second assertion to the integration test — `expect(toolCallResponse).toHaveProperty('result')` (not `error`) — so a protocol mismatch fails loudly.

[ASSUMED] The specific protocol version in current SDK 1.29.0. Confirm at plan-time by sending `initialize` with `protocolVersion: "2025-06-18"` and inspecting the negotiated response — the SDK echoes the version it picked.

### Pitfall 8: Greedy match in sanitizer Pattern 1 across newlines
**What goes wrong:** `Authorization:\s*Bearer\s+[^\s,;]+` is bounded by `[^\s,;]+` so it stops at the first whitespace, comma, or semicolon. This is correct for typical headers. But a multiline error message with `Authorization: Bearer xyz<newline>Other-Header: ...` works because newline is in `\s`. **However:** if the error includes a JSON-stringified header value like `"Authorization":"Bearer xyz"`, Pattern 1 won't match because the trailing `"` isn't in the stop set.
**How to avoid:** Pattern 2 (the JSON-key pattern) is designed to catch JSON-escaped variants. The test fixtures in D-10 must include both raw-header and JSON-string-escaped forms. Add `"` to the stop set if Pattern 2 proves insufficient.
**Warning signs:** Sanitizer test passes against raw headers but a JSON-escaped header makes it through.

### Pitfall 9: Error.cause cycle protection
**What goes wrong:** A maliciously-or-accidentally-constructed error has `err.cause === err`, or `err.cause.cause === err`. The cause-chain walker loops forever.
**How to avoid:** The `serializeError` snippet in Pattern 2 uses a `WeakSet<object>` to break cycles and a depth limit of 8 per D-08. Both are required: the WeakSet handles the cycle case, the depth limit handles a long chain of distinct-but-deep causes.

### Pitfall 10: CI grep gates exit-code semantics
**What goes wrong:** `grep -r "server\.registerTool" src/mcp/ | grep -v register.ts` exits with 0 when there are matches and 1 when there are none. A naive `&& exit 1` is inverted.
**How to avoid:** The pattern is:
```bash
if grep -rn "server\.registerTool" src/mcp/ | grep -v register.ts; then
  echo "::error::server.registerTool used outside src/mcp/register.ts"
  exit 1
fi
```
The `if` clause is true when grep finds matches (exit 0). Same pattern for the two other gates. Document this in the CI workflow comments.

## Code Examples

### `package.json` (Phase 1)
```jsonc
{
  "name": "recovery-ledger",
  "version": "0.1.0",
  "type": "module",
  "bin": {
    "recovery-ledger": "./dist/cli.mjs",
    "recovery-ledger-mcp": "./dist/mcp.mjs"
  },
  "engines": { "node": ">=22.11" },
  "files": ["dist"],
  "scripts": {
    "build": "tsup",
    "dev:cli": "tsx watch src/cli/index.ts",
    "dev:mcp": "tsx src/mcp/index.ts",
    "test": "vitest run",
    "lint": "biome check",
    "format": "biome check --write"
  }
}
```

### `tsconfig.json`
```jsonc
{
  "compilerOptions": {
    "target": "ES2023",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "lib": ["ES2023"],
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "verbatimModuleSyntax": true,
    "outDir": "dist",
    "rootDir": ".",
    "declaration": false,
    "sourceMap": true
  },
  "include": ["src/**/*", "test/**/*", "*.ts"],
  "exclude": ["dist", "node_modules"]
}
```

[CITED: CLAUDE.md §Code Style requires `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, ESM only]

### `tsup.config.ts`
```typescript
import { defineConfig } from 'tsup';

export default defineConfig({
  entry: { cli: 'src/cli/index.ts', mcp: 'src/mcp/index.ts' },
  format: ['esm'],
  target: 'node22',
  outDir: 'dist',
  outExtension: () => ({ js: '.mjs' }),
  banner: { js: '#!/usr/bin/env node' },
  external: ['better-sqlite3', '@napi-rs/keyring'],
  clean: true,
  sourcemap: true,
  splitting: false,   // each entry is a self-contained file
  treeshake: true,
});
```

### `vitest.config.ts`
```typescript
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    pool: 'forks',              // MANDATORY per CLAUDE.md (native modules)
    poolOptions: { forks: { singleFork: false } },
    include: ['src/**/*.test.ts', 'test/**/*.test.ts'],
    testTimeout: 10_000,        // integration test spawns subprocess; bumping above default 5s
    hookTimeout: 10_000,
  },
});
```

### `biome.json` (D-04)
```jsonc
{
  "$schema": "https://biomejs.dev/schemas/2.4.15/schema.json",
  "files": {
    "includes": ["src/**/*.ts", "test/**/*.ts", "*.ts"],
    "ignore": ["dist/**", "node_modules/**"]
  },
  "linter": {
    "enabled": true,
    "rules": {
      "recommended": true,
      "suspicious": {
        "noConsole": "error"        // GLOBAL — no allow list
      }
    }
  },
  "formatter": {
    "enabled": true,
    "indentStyle": "space",
    "indentWidth": 2,
    "lineWidth": 100
  },
  "overrides": [
    {
      "includes": ["src/cli/**/*.ts"],
      "linter": { "rules": { "suspicious": { "noConsole": "off" } } }
    },
    {
      "includes": ["**/*.test.ts", "test/**/*.ts"],
      "linter": { "rules": { "suspicious": { "noConsole": "off" } } }
    }
  ]
}
```

[ASSUMED] The exact JSON path for the `noConsole` rule under `suspicious` matches the Biome 2.4.x schema. The planner should verify against `https://biomejs.dev/linter/rules/no-console/` during plan execution and adjust the schema path if Biome 2.4.15 has reorganized the rule's namespace. If the rule has moved to `complexity` or another category, update accordingly — the **intent** (no `console.*` outside `src/cli/`) is locked.

### CI workflow `.github/workflows/ci.yml`
```yaml
name: CI
on: [push, pull_request]

jobs:
  ci:
    runs-on: macos-latest                     # per D-12
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '22', cache: 'npm' }
      - run: npm ci
      - run: npm run lint
      - run: npm run build
      - run: npm run test

      # Grep gate 1: no inline noConsole silencer (D-04)
      - name: no-inline-biome-ignore-noConsole
        run: |
          if grep -rEn "biome-ignore.*noConsole" src/; then
            echo "::error::Inline biome-ignore for noConsole is banned. Use biome.json overrides."
            exit 1
          fi

      # Grep gate 2: no process.stdout outside src/cli/ (D-04)
      - name: no-process-stdout-outside-cli
        run: |
          if grep -rEn "process\.stdout" src/ --include="*.ts" | grep -v "^src/cli/"; then
            echo "::error::process.stdout used outside src/cli/."
            exit 1
          fi

      # Grep gate 3: no raw registerTool outside register.ts (D-09)
      - name: no-raw-registerTool
        run: |
          if grep -rEn "server\.registerTool" src/mcp/ --include="*.ts" | grep -v "src/mcp/register.ts"; then
            echo "::error::server.registerTool used outside src/mcp/register.ts. Use register() wrapper."
            exit 1
          fi
```

[VERIFIED: macOS-latest is a valid `runs-on` label; `actions/setup-node@v4` accepts `node-version: '22'`; grep -E uses POSIX extended regex on macOS by default]

### `.nvmrc`
```
22
```

### `.gitattributes`
```
*.ts text eol=lf
*.json text eol=lf
*.mjs text eol=lf
```
(Defensive against any future Windows contributor flipping line endings — Pitfall 22.)

### `.gitignore`
```
node_modules/
dist/
coverage/
*.log
.env
.env.local
.DS_Store
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Console.log debugging in MCP servers | Stderr-only logging with stdin/stdout reserved for JSON-RPC | MCP spec 2024+ | Required for stdio transport; any deviation breaks Claude Desktop / Code |
| `keytar` for OS keychain | `@napi-rs/keyring` | keytar archived 2022-12-15 | Drop-in replacement; Phase 1 already uses the maintained fork |
| ESLint + Prettier | Biome 2.x | 2024-2025 | Single binary, 10-100x faster; CLAUDE.md's documented fallback to ESLint is on the bench, not active |
| ts-node | tsx | 2023+ | Faster, no tsconfig friction; STACK.md prescribes tsx |
| Jest | Vitest | 2024+ | Native ESM, faster; CLAUDE.md uses Vitest as the test runner |
| Zod transforms in MCP tool input schemas | `.refine()` for validation, transform inside the tool body | per pitfalls.md Pitfall 14 | Zod-to-JSON-Schema conversion can drop transforms; not a Phase 1 hit (no tools have schemas yet) but a precedent the planner should encode in `register.ts` docs |

**Deprecated/outdated:**
- **keytar** — archived 2022-12; do not pull in even though it still installs.
- **`pkg`/`nexe` single-binary packers** — STACK.md anti-recommendation; rely on `npx`/`npm install -g`.
- **`drizzle-kit push` in user-facing flows** — only generated migrations in Phase 3; not a Phase 1 concern.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `pino.symbols.streamSym` is the documented internal symbol for accessing the logger's destination | Pattern 5 (stdout-purity unit test) | Unit test brittle; **fallback is the explicit `pino.destination({dest:2}).fd === 2` test, plus the load-bearing subprocess integration test** — phase still ships even if A1 is wrong |
| A2 | `protocolVersion: "2025-06-18"` matches what SDK 1.29.0 negotiates | Pattern 5 fixture content | Integration test still passes the "valid JSON-RPC" assertion but never exercises a tool call; mitigated by the second assertion `expect(toolCallResponse).toHaveProperty('result')` |
| A3 | `@napi-rs/keyring` 1.3.0's public API is `new Entry(service, account)` and the constructor binds-but-does-not-touch-keychain | Pattern 6 (keyring load probe) | Load probe is no-op or fails; planner must verify against the package's `index.d.ts` and adjust accordingly. Real keychain probe is Phase 2 work; Phase 1 only needs "binary loads" |
| A4 | Biome 2.4.15's `noConsole` rule is at JSON path `linter.rules.suspicious.noConsole` | `biome.json` example | Lint config doesn't load; planner verifies against Biome rule docs and updates the JSON path. The intent is locked, the spelling is not |
| A5 | tsup `external: ['better-sqlite3', '@napi-rs/keyring']` is sufficient to keep both out of the bundle and have Node load them at runtime | tsup.config.ts | If wrong, `dist/mcp.mjs` runtime fails to load native modules. STACK.md prescribes this; tsup docs confirm `external` is the right knob, but the planner should test by running `node dist/mcp.mjs` once after build and confirming the MCP server starts |
| A6 | Native macOS Keychain prompt does NOT fire on `new Entry(...)` (constructor only — no read/write) | Pattern 6 | If wrong, CI on macOS-latest might prompt for credentials (it won't on the headless runner, but local dev would). Phase 2 will replace with a fuller probe; Phase 1 is OK accepting a load-only check |

## Open Questions

1. **Should the prod logger use `sync: true` or `sync: false` for fd 2?**
   - What we know: Pino's `pino.destination({ dest: 2, sync: false })` is async (faster, buffers); `sync: true` flushes synchronously.
   - What's unclear: Whether an async logger can drop log lines on a fast shutdown (subprocess test ends the child quickly).
   - Recommendation: `sync: false` for prod (perf), `sync: true` only if Phase 1 test flakiness shows missed lines on graceful shutdown. Document the choice in `logger.ts`.

2. **Should the version banner go in `package.json` and be read at runtime, or hardcoded in `0.1.0` initially?**
   - What we know: Phase 1 ships `0.1.0`. The CLI advertises `--version`; the MCP advertises a `version` field in `initialize`.
   - What's unclear: Whether to wire `package.json` version read at runtime now or in Phase 5.
   - Recommendation: Hardcode `0.1.0` in two places (CLI `program.version('0.1.0')` and MCP `new McpServer({ name: 'recovery-ledger', version: '0.1.0' })`). Phase 5 can read from `package.json` once stable. Don't optimize this in Phase 1.

3. **Does the `dist/` smoke-test integration need to run `npm run build` itself (vitest globalSetup) or rely on CI ordering?**
   - What we know: CI runs `build` before `test`. Local `vitest` might not.
   - What's unclear: Whether developers running `vitest` locally without first running `npm run build` should get a clear error or have build run automatically.
   - Recommendation: Add a `vitest.config.ts` `globalSetup` that runs `tsup` once before the integration test, OR a clear precondition check in the test that says "run `npm run build` first." CI is unaffected either way. The simpler answer (precondition check) ships in Phase 1; auto-build can be a Phase 2 polish.

4. **`@modelcontextprotocol/sdk/server/mcp.js` vs `@modelcontextprotocol/sdk/server/index.js` for the `McpServer` import**
   - What we know: STACK.md uses `@modelcontextprotocol/sdk/server/mcp.js`. The SDK's exports map includes `./server` (resolving to `index.js`) and wildcard `./*` (resolving to `mcp.js` for `/server/mcp.js`).
   - What's unclear: Whether `McpServer` is reliably exported from both. STACK.md's import path is verbatim from the canonical example.
   - Recommendation: Use the STACK.md import path (`./server/mcp.js`). If the planner sees a TS error at implementation time, fall back to `./server/index.js` — both should expose `McpServer` per the SDK's documented surface.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js | Runtime | ✓ | 25.2.1 (dev box); CI uses 22 via `.nvmrc` | Pin via `.nvmrc` — CI is authoritative |
| npm | Package manager | ✓ | 11.13.0 | — |
| GitHub Actions macOS-latest runner | CI | Not in local env (cloud) | — | Phase 1 ships CI-first; local `npm run test` covers most of it |
| Xcode Command Line Tools (for `better-sqlite3` node-gyp fallback) | Native module build if prebuild missing | Not probed | — | Prebuilt binaries for Node 22 mac arm64 exist; CLT only matters if Node version drifts |

**Missing dependencies with no fallback:**
- None for Phase 1.

**Missing dependencies with fallback:**
- Local Node version is 25.2.1, project pins to 22 LTS. **Action:** the planner should include a task to verify the dev box has Node 22 available via nvm/fnm/asdf, OR be explicit that CI is the gate and local dev can run on 25.x but `.nvmrc` is canonical. **Recommendation:** add a sentence to the README setup section: "Run `nvm use` after clone to switch to Node 22."

## Validation Architecture

> Nyquist validation is **enabled** (config.json `workflow.nyquist_validation: true`). Section required.

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Vitest 4.1.6 |
| Config file | `vitest.config.ts` (created in Phase 1) |
| Quick run command | `npx vitest run --reporter=basic` |
| Full suite command | `npm run test` (alias for `vitest run`) |
| Pool mode | `forks` (mandatory per CLAUDE.md — native modules don't cross worker threads) |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|--------------|
| FND-01 | TypeScript ESM compiles with strict + NodeNext; `tsup` produces `dist/cli.mjs` and `dist/mcp.mjs`; Biome and Vitest configs load | build smoke | `npm run build && test -f dist/cli.mjs && test -f dist/mcp.mjs` | ❌ Wave 0 |
| FND-01 | Biome and Vitest run with zero errors on the empty repo | lint + test smoke | `npm run lint && npm run test` | ❌ Wave 0 |
| FND-02 | `npx recovery-ledger --version` prints `0.1.0` to stdout | CLI smoke | `npx --no-install recovery-ledger --version` (after `npm link` or local install) | ❌ Wave 0 |
| FND-02 | `dist/cli.mjs` has shebang `#!/usr/bin/env node` on line 1 | build artifact | `head -n 1 dist/cli.mjs` matches shebang | ❌ Wave 0 |
| FND-03 | `dist/mcp.mjs` starts as an MCP server and responds to `initialize` | subprocess unit | part of `test/integration/mcp-stdout-purity.test.ts` (fixture 1 of 4) | ❌ Wave 0 |
| FND-04 | Pino logger destination = fd 2 (programmatic) | unit | `vitest run src/infrastructure/config/logger.test.ts` | ❌ Wave 0 |
| FND-04 | `dist/mcp.mjs` stdout under JSON-RPC fixture load contains only valid JSON-RPC frames | integration (subprocess) | `vitest run test/integration/mcp-stdout-purity.test.ts` | ❌ Wave 0 |
| FND-05 | Biome `noConsole` rule fails on `console.log` in `src/mcp/`, `src/services/`, `src/infrastructure/`, `src/formatters/` | lint | `npm run lint` (with a temporary `console.log` injected to verify) — Wave 0 to add a deliberate-fail test in CI | ❌ Wave 0 |
| FND-05 | CI grep gate fails on `process\.stdout` outside `src/cli/` | CI gate | `grep -rEn "process\.stdout" src/ --include="*.ts" \| grep -v "^src/cli/"` returns no matches | ❌ Wave 0 |
| FND-05 | CI grep gate fails on `biome-ignore.*noConsole` | CI gate | `grep -rEn "biome-ignore.*noConsole" src/` returns no matches | ❌ Wave 0 |
| FND-06 | Sanitizer strips Pattern 1 (`Authorization: Bearer`) | unit | `vitest run src/mcp/sanitize.test.ts -t "Pattern 1"` | ❌ Wave 0 |
| FND-06 | Sanitizer strips Pattern 2 (JSON token-key values) | unit | `vitest run src/mcp/sanitize.test.ts -t "Pattern 2"` | ❌ Wave 0 |
| FND-06 | Sanitizer strips Pattern 3 (JWT shape) | unit | `vitest run src/mcp/sanitize.test.ts -t "Pattern 3"` | ❌ Wave 0 |
| FND-06 | Sanitizer strips Pattern 4 (bare Bearer) | unit | `vitest run src/mcp/sanitize.test.ts -t "Pattern 4"` | ❌ Wave 0 |
| FND-06 | Sanitizer walks `Error.cause` chain depth ≤ 8 with cycle protection | unit | `vitest run src/mcp/sanitize.test.ts -t "cause chain"` | ❌ Wave 0 |
| FND-06 | CI grep gate fails on `server\.registerTool` outside `src/mcp/register.ts` | CI gate | `grep -rEn "server\.registerTool" src/mcp/ \| grep -v "src/mcp/register.ts"` returns no matches | ❌ Wave 0 |
| FND-06 | Integration test: `whoop_doctor` tool call stdout contains no `Bearer`, no `Authorization`, no JWT shape | integration | part of `mcp-stdout-purity.test.ts` (assertions 2-4) | ❌ Wave 0 |
| FND-07 | `recovery-ledger doctor` returns a `DoctorResult` with three checks (`better_sqlite3_load`, `napi_keyring_load`, `mcp_stdout_purity`) | service unit | `vitest run src/services/doctor/index.test.ts` | ❌ Wave 0 |
| FND-07 | `better-sqlite3` load probe returns `pass` on macOS-latest + Node 22 | check unit | `vitest run src/services/doctor/checks/native-modules.test.ts -t "better-sqlite3"` | ❌ Wave 0 |
| FND-07 | `@napi-rs/keyring` load probe returns `pass` on macOS-latest + Node 22 | check unit | `vitest run src/services/doctor/checks/native-modules.test.ts -t "keyring"` | ❌ Wave 0 |
| FND-07 | Doctor `--text` flag renders compact plaintext | formatter unit | `vitest run src/formatters/doctor.txt.test.ts` | ❌ Wave 0 |

### Sampling Rate

- **Per task commit:** `npx vitest run --reporter=basic` (Vitest default, runs all tests; the suite is small enough in Phase 1 that there's no quick-vs-full split)
- **Per wave merge:** `npm run lint && npm run build && npm run test` + the three CI grep gates run locally
- **Phase gate:** Full GitHub Actions workflow green on macOS-latest before `/gsd-verify-work`

### Wave 0 Gaps

Every file below must be created in Phase 1. The first task in any plan must include the relevant scaffold.

**Test infrastructure (Wave 0 setup):**
- [ ] `vitest.config.ts` — pool forks, includes pattern
- [ ] `package.json` scripts (`test`, `lint`, `build`, `dev:cli`, `dev:mcp`)
- [ ] `test/fixtures/mcp/initialize.json`
- [ ] `test/fixtures/mcp/initialized.json`
- [ ] `test/fixtures/mcp/tools-list.json`
- [ ] `test/fixtures/mcp/whoop-doctor-call.json`

**Test files (one per requirement, co-located next to source per repo convention emerging from D-11):**
- [ ] `src/infrastructure/config/logger.test.ts` — Pino destination assertion (FND-04 unit)
- [ ] `src/mcp/sanitize.test.ts` — Four patterns + cause-chain walk + D-10 fixtures (FND-06 unit)
- [ ] `src/services/doctor/index.test.ts` — Composition + overall-status derivation (FND-07 unit)
- [ ] `src/services/doctor/checks/native-modules.test.ts` — Both load probes (FND-07 unit)
- [ ] `src/formatters/doctor.txt.test.ts` — Plaintext rendering (D-06 unit)
- [ ] `test/integration/mcp-stdout-purity.test.ts` — Subprocess round-trip (FND-04 integration + FND-06 integration + D-03 dist smoke)

**Framework install:** `npm install -D vitest@^4.1.6 @biomejs/biome@^2.4.15` — included in Phase 1 dev-deps install above.

## Security Domain

Security enforcement is **enabled** by default (no `security_enforcement: false` in `.planning/config.json`). Phase 1 is largely infrastructure, but two security-relevant controls originate here.

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|------------------|
| V2 Authentication | No (Phase 2) | — |
| V3 Session Management | No (Phase 2) | — |
| V4 Access Control | No (single-user local tool) | — |
| V5 Input Validation | Partial | Zod schemas at MCP tool input boundary (register.ts wraps every handler). Phase 1 ships one tool (`whoop_doctor`) with `inputSchema: {}` — no inputs to validate yet, but the seam is in place. |
| V6 Cryptography | No (Phase 2 — token store) | — |
| V7 Error Handling and Logging | **Yes** | The MCP error sanitizer (D-07/D-08) is exactly this: bound the error surface, redact secrets, never leak tokens through tool responses. Also: Pino → stderr (not stdout, not a file in Phase 1) means logs don't accidentally land in a world-readable place. |
| V8 Data Protection | Partial | Logs go to stderr only (no log file persistence in Phase 1); decision-ledger and token storage are Phase 2+ concerns. |
| V14 Configuration | Yes | Pinned versions in `package.json`; no `dotenv` dep (CLAUDE.md prescribes Node 20.6+ native `--env-file`); no secrets in repo. |

### Known Threat Patterns for {TypeScript MCP stdio server}

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Token leakage via MCP tool error returns | Information Disclosure | Sanitizer regex set + cause-chain walk (FND-06); CI grep for `Bearer` in test stdout |
| Token leakage via stderr → log file | Information Disclosure | Phase 1 ships no log file; Phase 2 adds the sanitizer to the log path too (per D-08 "stack traces if surfaced anywhere, sanitize them too") |
| Stdout corruption breaking MCP transport | Denial of Service (against the tool, not WHOOP) | Biome `noConsole` + grep gates + subprocess round-trip test (FND-04/05) |
| Malicious npm postinstall script reading future tokens | Information Disclosure | Phase 1 doesn't store tokens yet; Phase 2 keychain mitigates. **Phase 1 contribution:** the layout enforces that no Phase 1 code stores secrets in the filesystem in the first place. |
| ABI mismatch causing silent native-module no-op | Tampering (integrity) | Doctor's native-module load probes catch this on every invocation; CI runs doctor implicitly via the `whoop_doctor` tool call in the integration test |
| Inline `biome-ignore` silencing the `noConsole` rule | Defense bypass | CI grep gate (D-04) fails the build on any `biome-ignore.*noConsole` match |
| Raw `server.registerTool` bypassing the sanitizer | Defense bypass | CI grep gate (D-09) fails the build on any `server.registerTool` outside `register.ts` |

**Phase 1's specific security guarantee:** **no token material can leak through a Phase 1 MCP error response**, because the sanitizer is mandatory (regress-tested via integration), and **no `console.*` can corrupt the stdio transport**, because three layers of defense (Biome, grep gate, subprocess test) all catch it. Phase 2 inherits these guarantees the moment it ships real OAuth code.

## Project Constraints (from CLAUDE.md)

Extracted load-bearing directives the planner MUST honor:

1. **MCP stdout purity** — never `console.log`/`console.error`/`console.warn` anywhere reachable from `src/mcp/`, `src/services/`, `src/domain/`, `src/infrastructure/`, `src/formatters/`. (Phase 1's three layers of defense satisfy this.)
2. **TypeScript strict** — `strict: true`, `noUncheckedIndexedAccess: true`, `exactOptionalPropertyTypes: true`, ESM only, no default exports.
3. **Module layout** — Phase 1 D-11 layout matches CLAUDE.md §Code Style §Module layout 1:1.
4. **Validation at boundaries only** — Phase 1 has one boundary (`whoop_doctor` tool input, which is `{}` — empty schema). Future tools follow the same rule.
5. **Comments default to none** — only when *why* is non-obvious. Phase 1 sanitizer regexes warrant a comment per pattern (justifying choice of stop set, character class, flags).
6. **Testing** — `pool: 'forks'` mandatory; suite under 60 seconds; no live WHOOP calls (Phase 1 has zero WHOOP calls).
7. **Commit format** — Conventional Commits, lowercase prefix, no period (`feat:`, `fix:`, `test:`, `chore:`, `docs:`). Atomic commits, planning + code never mixed.
8. **GSD workflow enforcement** — direct edits outside a GSD workflow forbidden. Phase 1 plans execute under `/gsd-execute-phase 1`.
9. **No `--no-verify`, no skip-signing, no amending pushed commits.**
10. **Scope guardrail** — Phase 1 is foundation only; no review code, no decision ledger code, no WHOOP code, no DB schema beyond the load probe. If a task touches deferred scope, surface it before proceeding.

## Sources

### Primary (HIGH confidence)
- [`.planning/research/STACK.md`](../../research/STACK.md) — all version pins, install commands, tsup config, anti-recommendations
- [`.planning/research/ARCHITECTURE.md`](../../research/ARCHITECTURE.md) — lite hexagonal layout, build order, anti-patterns
- [`.planning/research/PITFALLS.md`](../../research/PITFALLS.md) — Pitfall 1 (stdout corruption), Pitfall 14 (Zod-to-JSON-Schema), Pitfall 17 (token leakage via errors), Pitfall 20 (ESM + native modules)
- [`CLAUDE.md`](../../../CLAUDE.md) — Critical Rules, Code Style, Testing
- npm registry queries on 2026-05-12 for every Phase 1 package — versions in the "Standard Stack" table
- MCP TypeScript SDK exports map (`npm view @modelcontextprotocol/sdk exports`) — confirmed subpath import paths
- [Pino docs — pino.destination](https://getpino.io/) — fd 2 routing, `pino.destination({ dest: 2 })` syntax
- [MCP TypeScript SDK server docs](https://github.com/modelcontextprotocol/typescript-sdk/blob/main/docs/server.md) — `registerTool` shape, `isError`, `structuredContent`

### Secondary (MEDIUM confidence)
- [pino-pretty README](https://github.com/pinojs/pino-pretty) — `destination: 2` option (WebFetch confirmed)
- [tsup docs](https://tsup.egoist.dev/) — `banner`, `external` semantics
- [Commander 14 npm](https://www.npmjs.com/package/commander) — named export `Command`, ESM compatibility (WebFetch + npm view)

### Tertiary (LOW confidence — flagged for plan-time verification)
- `pino.symbols.streamSym` for programmatic destination assertion (assumption A1; subprocess test is the load-bearing alternative)
- `protocolVersion: "2025-06-18"` matches SDK 1.29.0 negotiated version (assumption A2)
- `new Entry(service, account)` for `@napi-rs/keyring` 1.3.0 (assumption A3)
- Biome 2.4.15 JSON path `linter.rules.suspicious.noConsole` (assumption A4)

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — every version cross-verified against npm on research date; STACK.md is HIGH-confidence upstream
- Architecture: HIGH — D-11 layout is locked; lite-hexagonal pattern is well-trodden; no novelty
- Pitfalls: HIGH — pitfalls.md owns the breakdown; Phase 1 mitigations are explicit (lint + grep + test)
- Validation architecture: HIGH — every FND-* maps to a concrete vitest command or grep gate
- Security: MEDIUM — Phase 1's surface is small (one tool with empty inputs, no secrets stored yet); the sanitizer + stdout-purity are the load-bearing controls and they're tested
- Tooling specifics (Pino internals, Biome rule path, keyring API): MEDIUM — flagged in Assumptions Log

**Research date:** 2026-05-12
**Valid until:** 2026-06-11 (30 days — stack is stable; recheck if Phase 1 doesn't start by mid-June)
