# Phase 1: Foundation & Stdout-Pure MCP Bootstrap - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-05-12
**Phase:** 1-foundation-stdout-pure-mcp-bootstrap
**Areas discussed:** Package manager (escalated); stdout-purity assertion + stub doctor (locked by Claude); MCP error-sanitizer scope + wiring (locked by Claude); `console.*` lint discipline (locked by Claude)

User invoked `/gsd-discuss-phase 1` with no flags. Mode: default. Advisor mode: off (no `~/.claude/get-shit-done/USER-PROFILE.md`). When presented with the four gray areas, user replied "Discuss all these amongst yourselves, come back to me if there isn't a clear winner" — so Claude resolved three internally against the locked context and escalated only the genuine preference call.

---

## Package manager

| Option | Description | Selected |
|--------|-------------|----------|
| npm (Recommended) | Ships with Node, zero install, every CI example assumes it, `npx recovery-ledger` works out of the box. Boring-and-correct for a single-user tool; matches the "retention beats library breadth" principle. Slightly looser dep hygiene than pnpm. | ✓ |
| pnpm | Strict isolation (no phantom deps), content-addressed store saves disk, faster than npm. `pnpm dlx` replaces `npx`. Excellent ESM + native-module story. Adds a one-line `npm install -g pnpm` step for new contributors. | |
| Defer to planner | Skip the question — let Claude pick during `/gsd-plan-phase 1` based on what's already on Chris's machine. | |

**User's choice:** npm (Recommended)
**Notes:** Bun was eliminated before the question reached the user — it would require swapping `better-sqlite3` for `bun:sqlite` (or maintaining a dual-driver path) and testing against two runtimes. v1 keeps a single Node 22 LTS code path. Bun-compatibility is a property of the resulting npm package, not a primary install target.

---

## Stdout-purity assertion + stub doctor

| Option | Description | Selected |
|--------|-------------|----------|
| Programmatic logger check only | Fast Vitest unit that asserts Pino's destination is fd 2. Cheap; runs every test. Catches misconfigured logger but cannot catch library warnings or stray `process.stdout.write`. | |
| Subprocess fixture round-trip only | Spawn `dist/mcp.mjs`, send JSON-RPC fixture, fail on any non-JSON-RPC byte on stdout. Catches the real-world failure mode; doubles as `dist/` build smoke. | |
| Both (Recommended) | Programmatic check as belt; subprocess round-trip as suspenders. Different failure modes; cheap to run both. PITFALLS.md §Pitfall 1 explicitly recommends both, plus a doctor self-check that re-uses the same subprocess driver. | ✓ |

**Claude's resolution:** Both. Programmatic check lives in a Vitest unit; subprocess round-trip lives in `test/integration/mcp-stdout-purity.test.ts` and reuses committed JSON-RPC fixture files (`test/fixtures/mcp/{initialize,tools-list,whoop-doctor-call}.json`). Subprocess test runs against built `dist/mcp.mjs`, so it doubles as the Phase 1 success-criterion-5 dist-smoke. Stub `doctor` factors the subprocess driver into `src/services/doctor/checks/mcp-stdout-purity.ts` and calls it from both the Vitest integration test and the doctor service — one piece of code, two callers. Doctor output shape `{checks: [...], overall}` sets the precedent for Phase 4's MCP tool responses.

---

## MCP error-sanitizer scope + wiring

| Option | Description | Selected |
|--------|-------------|----------|
| Transport-level interceptor | Wrap `StdioServerTransport.send()` to sanitize every outgoing JSON-RPC message. Cannot be forgotten. But mutates successful `structuredContent` too and lacks the per-tool error-shape context. | |
| Per-tool wrapper helper (Recommended) | Ship `src/mcp/register.ts` — a thin wrapper around `server.registerTool` that applies `try`/`catch`/sanitizer/formatter contract. Every tool registers through it; raw `server.registerTool` calls disallowed outside that file (CI grep gate). | ✓ |
| Explicit `sanitizeError()` utility at each call site | Tools call `try { ... } catch (e) { return sanitizeError(e); }` themselves. Maximally explicit but scatters logic; easy to forget when adding a new tool. | |

**Claude's resolution:** Per-tool wrapper via `register.ts`. Pattern catalog: `Authorization: Bearer …` header strings, JWT shape (`eyJ…\.…\.…`), bare `Bearer …` tokens with `[A-Za-z0-9._-]{10,}`, and JSON token-key values (`"access_token"|"refresh_token"|"client_secret": "…"` — preserve key, redact value). Scope: `Error.message` plus full stringified `Error.cause` chain (depth-limited to 8); stacks never returned through MCP. Unit-tested in `src/mcp/sanitize.test.ts` against fixture set of "errors that historically leak" (`fetch` `TypeError`, `undici` cause-chain variants, JSON error bodies, bare-Bearer-in-message `Error`). Integration test (subprocess round-trip) additionally asserts no `Bearer` / `Authorization` / JWT-shaped substring in the `whoop_doctor` response.

---

## `console.*` lint discipline

| Option | Description | Selected |
|--------|-------------|----------|
| Biome `noConsole` with `allow: ['error']` globally | FND-05 literal reading — bans bare `console.log` everywhere outside `src/cli/`, allows `console.error` everywhere. | |
| Biome `noConsole` strict, override `src/cli/` only (Recommended) | CLAUDE.md is stricter than FND-05 — bans `console.error` outside `src/cli/` too. Globally enabled, no `allow` list. Override for `src/cli/**/*.ts` only. Tests exempt. Inline `biome-ignore` for this rule banned (CI grep gate). Sibling CI grep gate also fails on `process.stdout` outside `src/cli/`. | ✓ |
| Custom AST check instead of Biome rule | A bespoke linter that walks the AST and forbids both `console.*` and `process.stdout.*` in one rule. Heavier to maintain; loses Biome's built-in reporting. | |

**Claude's resolution:** Biome `noConsole` globally with no `allow` list (honor CLAUDE.md's stricter reading). Override for `src/cli/**/*.ts` only. Tests exempt. Inline `biome-ignore` for this specific rule banned (CI grep step fails on `biome-ignore.*noConsole`). Sibling CI grep gate for `process\.stdout` outside `src/cli/` — cheap insurance Biome's rule can't provide.

---

## Claude's Discretion

All of the following were resolved by Claude against the locked context (CLAUDE.md, REQUIREMENTS.md, ROADMAP.md, `.planning/research/`) without user escalation, per the user's "discuss amongst yourselves" instruction:

- Stdout-purity test structure (programmatic + subprocess, fixtures committed as JSON, subprocess doubles as dist-smoke)
- Stub doctor checks (native-module load probes + stdout-purity self-test via shared subprocess driver)
- Doctor output shape (`{checks, overall}` structured JSON, `--text` fallback via `src/formatters/doctor.txt.ts`)
- Error-sanitizer pattern catalog (Authorization / JWT / Bearer / JSON-token-key)
- Sanitizer scope (`message` + full `cause` chain to depth 8; no stack returns)
- Sanitizer wiring (`src/mcp/register.ts` wrapper; raw `server.registerTool` banned outside it via CI grep gate)
- Lint scope (Biome `noConsole` globally no `allow`; `src/cli/` override; tests exempt; `biome-ignore` for the rule banned; `process.stdout` sibling grep gate)
- Source-layout scaffold (file-list in CONTEXT.md D-11; no `.gitkeep` placeholders for future phases)
- CI platform (GitHub Actions, macOS-latest only for Phase 1; Linux fallback tests land in Phase 2)

## Deferred Ideas

- Linux / Windows CI matrix → Phase 2 (libsecret-less keychain fallback) for Linux; Windows permanently out of scope per REQUIREMENTS.md.
- `@modelcontextprotocol/inspector` smoke step in CI → revisit in Phase 4 if integration test isn't catching real-world breakage.
- Doctor `--json` vs default JSON → Phase 5 decision when full doctor lands; Phase 1 ships JSON-default + `--text` flag.
- `PRAGMA user_version` schema-version doctor checks → Phase 3, with the DB layer.
- Single-flight refresh contract → Phase 2 (and STATE.md flags it for a research deepen pass beforehand).
