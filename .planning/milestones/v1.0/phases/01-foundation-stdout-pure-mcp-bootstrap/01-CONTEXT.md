# Phase 1: Foundation & Stdout-Pure MCP Bootstrap - Context

**Gathered:** 2026-05-12
**Status:** Ready for planning

<domain>
## Phase Boundary

Bootstrap the TypeScript repo and lock the cross-cutting safety nets — stdout purity, MCP error sanitization, native-module load verification, and lint discipline — as tested behaviors **before any application code is written**. Phase 1 delivers an empty CLI binary, an empty MCP stdio server (one stub `whoop_doctor` tool), and the CI gates that every subsequent phase will rely on.

Out of scope here (later phases own them): OAuth flow, token store, SQLite schema, WHOOP HTTP client, sync, baselines, reviews, decision ledger, full MCP surface. Phase 1 is infrastructure-only; if a task is not a safety net, it does not belong in this phase.

</domain>

<decisions>
## Implementation Decisions

### Package manager
- **D-01:** **npm** is the v1 package manager. Lockfile is `package-lock.json`; CI scripts use `npm ci`; install docs say `npm install`. Reason: boring-and-correct default for a single-user personal tool; ships with Node 22 LTS so contributor onboarding (and future-Chris on a fresh machine) needs zero extra tooling; `npx recovery-ledger` and `npx -y recovery-ledger-mcp` paths work without flag flips; matches the "retention beats library breadth" principle that drove TS-over-Python. Bun-compatibility remains a property (Bun can install + run an npm-managed project), but Bun is not the install target. pnpm rejected as second choice — strict-isolation wins are not worth the contributor-step cost for a one-person tool.

### Stdout-purity assertion (FND-04 + FND-05)
- **D-02:** Two complementary checks. (a) **Programmatic Vitest unit** asserts that Pino's destination resolves to file descriptor 2 (stderr) in both dev and prod logger configurations. Cheap, runs every test. (b) **Subprocess fixture round-trip** in `test/integration/mcp-stdout-purity.test.ts` spawns the built `dist/mcp.mjs` as a child process, sends a fixed JSON-RPC sequence over stdin (`initialize` → `notifications/initialized` → `tools/list` → one `whoop_doctor` tool call → graceful shutdown), captures stdout, parses line-by-line, and fails the build on any non-JSON-RPC byte. Captured stderr is logged but not asserted (Pino + library warnings are expected there).
- **D-03:** The subprocess test doubles as the **`dist/` smoke test** required by ROADMAP Phase 1 success criterion 5 ("build is run against compiled `dist/` (not `tsx`) at least once in CI"). One test, two assertions: stdout purity AND build artifact runs.
- **D-04:** Lint enforcement is **Biome's `noConsole` rule, globally enabled, with no `allow` list**. CLAUDE.md is stricter than FND-05 — it bans `console.error` outside `src/cli/` too, not just `console.log`. Honor the stricter rule. Override only for `src/cli/**/*.ts`. Tests exempt (`**/*.test.ts`). Inline `biome-ignore` for this rule is banned: a sibling CI grep step fails on any match of `biome-ignore.*noConsole`. A second CI grep gate fails on `process\.stdout` references outside `src/cli/` (Biome's `noConsole` can't catch that).

### Stub `doctor` (FND-07)
- **D-05:** Phase 1's `recovery-ledger doctor` runs three checks: (1) `better-sqlite3` native-module load probe, (2) `@napi-rs/keyring` native-module load probe, (3) `mcp_stdout_purity` self-test — spawns its own `recovery-ledger-mcp` subprocess and runs the same JSON-RPC fixture sequence from D-02 against live stdout. The self-test is the same code as the integration test, factored into `src/services/doctor/checks/mcp-stdout-purity.ts` and called from both Vitest and the doctor service.
- **D-06:** Doctor output shape: `{checks: Array<{name, status: 'pass'|'warn'|'fail', detail}>, overall: 'pass'|'warn'|'fail'}`. Structured JSON to stdout by default; `--text` flag renders a compact plaintext fallback via `src/formatters/doctor.txt.ts`. This is the same JSON+text-fallback contract that MCP-02 mandates for every later tool — Phase 1 sets the precedent.

### MCP error-sanitizer (FND-06, also covers AUTH-06)
- **D-07:** Pattern catalog — strip:
  1. `Authorization:\s*Bearer\s+[^\s,;]+` (case-insensitive)
  2. JWT shape `eyJ[A-Za-z0-9_-]{4,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}`
  3. Bare `Bearer\s+[A-Za-z0-9._-]{10,}` (covers tokens in error messages without a header)
  4. JSON token-key values: `("(?:access_token|refresh_token|client_secret)"\s*:\s*")[^"]+` → keep the key, redact the value
- **D-08:** Sanitization scope: `Error.message` plus the full stringified `Error.cause` chain (Node 22's native cause chain — walked iteratively, depth-limited to 8). **Stack traces are never returned through MCP** (no `stack` field in tool error responses), but if they are surfaced anywhere (e.g., debug log paths in a future phase), sanitize them too.
- **D-09:** Wiring — ship `src/mcp/register.ts` as a thin wrapper around `server.registerTool` that wraps every handler in `try` / `catch` / sanitizer / formatter contract. Every tool from Phase 4 forward registers through `register()`. Raw `server.registerTool` calls are disallowed outside `src/mcp/register.ts` itself; enforced by a CI grep gate (`grep -rn "server\.registerTool" src/mcp/ | grep -v register.ts`).
- **D-10:** Unit-tested directly in `src/mcp/sanitize.test.ts` against a fixture set of "errors that historically leak" — at minimum: a Node `fetch` `TypeError: fetch failed` with `cause` chain carrying an `Authorization` header; an `undici` `UND_ERR_*` variant with a JWT in the message; a JSON error body with `"access_token": "..."`; a manually-constructed `Error` whose message contains a bare `Bearer eyJ...` token. The MCP integration test (D-02) also asserts that the `whoop_doctor` tool call's stdout response contains no `Bearer`, no `Authorization`, and no JWT-shaped substring.

### Source-layout scaffold for Phase 1
- **D-11:** Create only what Phase 1 needs (no empty placeholder directories for Phases 2+):
  ```
  src/
    cli/
      index.ts                         # commander entry; --version + `doctor` subcommand
      commands/doctor.ts               # 5-line shim → services.runDoctor()
    mcp/
      index.ts                         # StdioServerTransport wire-up
      register.ts                      # registerTool wrapper (D-09)
      sanitize.ts                      # error sanitizer regex set (D-07/D-08)
      tools/whoop-doctor.ts            # 5-line shim → services.runDoctor()
    services/
      doctor/
        index.ts                       # runDoctor()
        checks/
          native-modules.ts            # better-sqlite3 + @napi-rs/keyring load probes
          mcp-stdout-purity.ts         # subprocess fixture runner (D-05)
    infrastructure/
      config/
        logger.ts                      # Pino → stderr (fd 2); dev uses pino-pretty also to fd 2
    formatters/
      doctor.txt.ts                    # plaintext rendering (D-06)
  ```
  Phases 2-5 add their own directories as needed (`infrastructure/whoop/`, `infrastructure/db/`, `domain/`, etc.). No `.gitkeep` placeholders.

### CI platform
- **D-12:** GitHub Actions, macOS-latest runner (matches the documented setup target). Linux is *supported* per CLAUDE.md but not in the Phase 1 CI matrix — fallback-path tests (libsecret-less keychain, etc.) land in Phase 2 alongside the keyring code. Phase 1 CI runs: `npm ci`, `npm run lint`, `npm run build`, `npm run test`, plus the two grep gates (D-04 + D-09).

### Claude's Discretion
The user delegated the following to the discuss-phase analysis and accepted the locked answers above without escalation:
- Stdout-purity test structure (D-02, D-03)
- Lint scope + override + grep gates (D-04)
- Stub doctor checks + output shape (D-05, D-06)
- Sanitizer pattern catalog + scope + wiring (D-07 through D-10)
- Source layout scaffold (D-11)
- CI platform (D-12)

Only the **package manager** (D-01) was escalated as a genuine preference call; user selected npm.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Project policy (load-bearing constraints)
- `CLAUDE.md` §Critical Rules — **MCP stdout purity** rule (governs FND-04/05) and the banned-tone-words list (informs formatter design, but tone lint itself is Phase 4)
- `CLAUDE.md` §Code Style — `strict: true`, `noUncheckedIndexedAccess: true`, `exactOptionalPropertyTypes: true`, ESM only, no default exports
- `CLAUDE.md` §Testing — `pool: 'forks'` for Vitest, MSW 2 fixture-only, no live WHOOP calls
- `CLAUDE.md` §Repo Etiquette — conventional commit format, never `--no-verify`, never amend pushed commits
- `.planning/PROJECT.md` §Key Decisions — TypeScript-over-Python rationale and read-only WHOOP posture (motivates the sanitizer scope)
- `.planning/REQUIREMENTS.md` §Foundation — FND-01 through FND-07 (this phase's requirements verbatim)

### Architecture & stack
- `.planning/research/STACK.md` — Versions for `@modelcontextprotocol/sdk@^1.29.0`, Pino 10.3.1 → stderr config, `tsup` config with `banner: '#!/usr/bin/env node'` + `external: ['better-sqlite3', '@napi-rs/keyring']`, Commander 14.0.3
- `.planning/research/ARCHITECTURE.md` §Component Responsibilities — confirms `cli/` and `mcp/` are sibling driving adapters that share `services/` and `formatters/`; neither imports the other
- `.planning/research/ARCHITECTURE.md` §Build Order — Phase 1 maps to steps 1 + 15-prologue + 16-prologue (config + logger first, then empty CLI/MCP shims)
- `.planning/research/ARCHITECTURE.md` §Anti-Patterns — Anti-Pattern 6 (stdout writes from MCP server code) is the failure mode FND-04/05 prevents
- `.planning/research/PITFALLS.md` §Pitfall 1 — definitive treatment of stdout-corrupted MCP stdio transport; recommends both lint rule + Vitest assertion + doctor self-check (D-02 + D-04 + D-05 implement all three)
- `.planning/research/SUMMARY.md` §Risks — names the five cross-cutting concerns; #1 (stdout purity) is fully owned by this phase

### Roadmap context
- `.planning/ROADMAP.md` §Phase 1 — Goal, success criteria, depends-on (nothing)
- `.planning/ROADMAP.md` §Cross-Cutting Concerns — both rows "Stdout purity" and "MCP error-sanitizer contract" originate in Phase 1; tests live permanently in CI from this phase forward
- `.planning/STATE.md` §Decisions — lite-hexagonal architecture; 5-phase roadmap honored 1:1 from research

### External (consulted, not load-bearing for planning)
- WHOOP for Developers — OAuth 2.0 (https://developer.whoop.com/docs/developing/oauth/) — referenced only to anticipate the token-shape patterns the Phase 1 sanitizer must recognise (Phase 2 owns the actual OAuth code)
- MCP TypeScript SDK — Server docs (https://github.com/modelcontextprotocol/typescript-sdk/blob/main/docs/server.md) — current canonical `registerTool` + `StdioServerTransport` patterns

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- None — Phase 1 is greenfield. No `package.json`, `src/`, or `tests/` exist yet. The only non-planning files in the repo root are `CLAUDE.md` and `README.md`.

### Established Patterns
- **Planning artifacts in `.planning/` only** (CLAUDE.md §Repo Etiquette). Phase 1 must not write docs to `docs/` or the repo root.
- **`.planning/research/` is the source of truth for stack versions.** Phase 1 plans pin to STACK.md versions verbatim; any version bump is a new ADR, not a silent change.

### Integration Points
- **CI must be green from day one** of Phase 1. Every later phase relies on the stdout-purity gate, the `noConsole` lint, and the `register.ts` enforcement gate already running. The first commit that adds `src/` should land with CI passing — no "we'll add the gates later" path.

</code_context>

<specifics>
## Specific Ideas

- **Use the user's full directory layout pattern.** D-11 lists exact file paths the planner should target. Do not invent intermediate barrel files (`src/index.ts`, `src/cli/index.ts` are entry points, not re-export hubs).
- **Doctor JSON shape (D-06) is the precedent.** Phase 4's MCP tools will copy this shape for `structuredContent` + text-fallback. Lock it now so Phase 4 doesn't bikeshed.
- **Sanitizer regex set lives in one file** (`src/mcp/sanitize.ts`), exported as a constant array of `{pattern, replacement}` tuples. Easier to extend in Phase 2 if a new leak shape is discovered without re-touching the wrapping infrastructure.
- **Fixture for D-02 is committed JSON**, not generated. `test/fixtures/mcp/initialize.json`, `tools-list.json`, `whoop-doctor-call.json`. The subprocess driver reads them in order and writes them with newline-delimited JSON-RPC framing.

</specifics>

<deferred>
## Deferred Ideas

- **Linux / Windows CI matrix** — Phase 1 ships macOS-only CI. Linux fallback path (libsecret-less keychain → file with `chmod 600`) tests are owned by Phase 2 alongside the keyring code. Windows is permanently out of scope per REQUIREMENTS.md Out-of-Scope table.
- **`@modelcontextprotocol/inspector` smoke step in CI** — handy for manual debugging but not required for the FND-04 contract. Revisit if Phase 4 finds the integration test isn't catching real-world breakage.
- **Doctor `--json` vs default JSON** — D-06 ships JSON by default with `--text` flag. If Phase 5's full doctor wants the inverse (text default, `--json` opt-in) for human ergonomics, that's a Phase 5 decision; Phase 1 just establishes the shape.
- **Schema-version `PRAGMA user_version` checks in doctor** — ARCHITECTURE.md proposes this. Belongs in Phase 3 with the DB layer.
- **Single-flight refresh contract** — STATE.md flags this as research-deepen-before-Phase 2; not a Phase 1 concern, but the sanitizer pattern catalog (D-07) is designed to handle the token shapes the refresh flow will produce.

</deferred>

---

*Phase: 1-foundation-stdout-pure-mcp-bootstrap*
*Context gathered: 2026-05-12*
