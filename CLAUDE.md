<!-- GSD:project-start source:PROJECT.md -->
## Project

**Recovery Ledger**

Recovery Ledger is a local-first personal operating system for recovery-aware training and sleep decisions, built on top of the official WHOOP API v2. It syncs WHOOP data into a local SQLite cache and exposes structured daily/weekly review tools through a CLI and MCP server so Chris — and any technically inclined WHOOP user — can turn raw recovery data into a small set of concrete decisions and a ledger of whether those decisions helped.

Not affiliated with or endorsed by WHOOP. Bring your own WHOOP developer app.

**Core Value:** Turn WHOOP data into a daily and weekly review loop that ends in 3 concrete decisions and a record of whether they helped — useful enough that Chris keeps using it.

### Constraints

- **Tech stack**: TypeScript on Node 22+ (Bun-compatible) — Chris's primary language; optimizes for personal-tool retention and iteration speed over the wider Python data-science ecosystem
- **MCP**: `@modelcontextprotocol/sdk` (TypeScript) — Anthropic's reference SDK; first-class support in Claude Code and Claude Desktop
- **Database**: SQLite in WAL mode via `better-sqlite3` — synchronous, embedded, zero-config; matches the local-first principle
- **Query layer**: Drizzle ORM — typed schema + migrations; lightweight enough to not become an abstraction tax
- **Validation**: Zod — runtime validation for WHOOP API responses, CLI input, and MCP tool I/O
- **HTTP**: native `fetch` / `undici` — no extra HTTP client dependency
- **Tests**: Vitest with fixture-based contract tests; no live WHOOP API calls in the default suite; suite must run in under 60 seconds locally
- **Lint/format**: Biome (or ESLint + Prettier if Biome causes friction)
- **WHOOP**: BYO developer app and OAuth credentials in v1 — no shared relay, no proxy
- **Read-only API access**: No write endpoints, no scopes beyond what's required for sync
- **Setup target**: Fresh clone → first successful sync in under 20 minutes; first daily review in under 2 minutes after sync
- **Maintenance**: A new contributor (or future Chris after 3 months away) can add one derived metric or one review rule by following a single documented pattern
<!-- GSD:project-end -->

<!-- GSD:stack-start source:research/STACK.md -->
## Technology Stack

## Executive Summary
## Recommended Stack
### Core Technologies
| Technology | Version | Purpose | Why Recommended |
|------------|---------|---------|-----------------|
| Node.js | 22.x LTS (>=22.11) | Runtime | LTS, native `fetch`, native test runner available, supported by `better-sqlite3` prebuilds. Bun-compatible per the constraint, but Node is the documented target. |
| TypeScript | 5.7.x | Type system | Current stable; supports `--isolatedDeclarations`, the modern moduleResolution `"nodenext"`, and Zod v4's static type extraction without quirks. |
| `@modelcontextprotocol/sdk` | 1.29.0 | MCP server SDK (stdio) | Anthropic's reference SDK; first-class in Claude Code / Claude Desktop. The v1.x line is the recommended production track — v2 is pre-alpha. Provides `McpServer`, `StdioServerTransport`, tool/resource/prompt registration. (HIGH confidence — verified npm + official repo) |
| `better-sqlite3` | 12.9.0 | Embedded SQLite | Synchronous, fastest Node SQLite binding, prebuilt binaries for Node 22 LTS, ergonomic prepared statements. Aligns with the local-first "no external server" principle. (HIGH) |
| `drizzle-orm` | 0.45.2 (stable) — *plan to track 1.0 once it leaves RC, currently 1.0.0-rc.2* | Typed query layer + schema | Type-safe, SQL-first, zero runtime overhead, native better-sqlite3 driver. Migrations via `drizzle-kit`. Lighter than Prisma; more typed than Kysely. (HIGH) |
| `drizzle-kit` | 0.31.10 | Migration tooling | Generates SQL migrations from schema diffs; `drizzle-kit push` for local-first iteration; `drizzle-kit generate` for committed migrations once schema stabilises. (HIGH) |
| `zod` | 4.4.3 | Runtime validation | Standard Schema-compatible (works directly with MCP SDK tool registration), excellent inference, mature ecosystem. v4 has a smaller bundle and faster validation than v3. (HIGH) |
| `undici` | 7.9.0 (built into Node 22) | HTTP transport | Already powers Node's native `fetch`. Only pull in as an explicit dep if you need `Agent`/`Pool` for connection reuse or retry interceptors. (HIGH) |
| `commander` | 14.0.3 | CLI framework | Smallest, most boring, zero-dep, well-known. Mature subcommand model fits `sync` / `review daily` / `decision add` / `doctor` cleanly. (HIGH — see Alternatives Considered for Citty rationale) |
| `vitest` | 4.1.6 | Test runner | Fast, Vite-powered, native ESM, parallel by default, snapshot + inline-snapshot support. Stays under the 60-second suite budget. (HIGH) |
| `@biomejs/biome` | 2.4.15 | Lint + format | Single binary, fast, handles both. The constraint flagged ESLint+Prettier as the fallback if Biome causes friction; as of 2.x Biome covers the rule set we need for this project. (HIGH) |
### Supporting Libraries
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `date-fns` | 4.1.0 | Date math | Calendar-day arithmetic on WHOOP cycles, sleep windows, trailing-30-day baseline windows. Tree-shakeable, immutable, no global locale. |
| `@date-fns/tz` | (latest 1.x) | IANA timezone support | WHOOP timestamps are ISO-8601 with offsets, but cycles/sleep cross midnight — you need IANA-zone aware "calendar day" math, which date-fns alone doesn't do without this companion. |
| `pino` | 10.3.1 | Structured logging | Fast JSON logger. Configure to write to `stderr` or a rotating file — **never stdout** (MCP stdio transport uses stdout). |
| `pino-pretty` | 13.x | Dev log rendering | Pretty-print Pino's JSON during local dev; not bundled in prod. |
| `@napi-rs/keyring` | 1.3.0 | OS keychain access | Encrypt OAuth refresh token at rest. Drop-in keytar replacement, actively maintained (keytar was archived 2022-12). Falls back to an encrypted file if no system keychain is available. |
| `msw` | 2.14.6 | HTTP mocking in tests | Fixture-based contract tests for each WHOOP resource. Handler-per-resource pattern maps 1:1 to `cycles`, `recovery`, `sleep`, `workouts`, `profile`, `body_measurement`. |
| `tsx` | 4.21.0 | Dev runner / TS execution | Run TS directly during dev (`tsx watch src/cli.ts`). Faster than `ts-node`, no tsconfig pain. |
| `tsup` | 8.5.1 | Production bundler | esbuild-powered, zero-config, produces a single ESM file with shebang preserved for the CLI binary. |
| `node-cron` | 4.2.1 | In-process scheduler (optional) | Only if user opts in to long-running daemon mode. Default scheduling path is system launchd, not in-process cron. |
### Development Tools
| Tool | Purpose | Notes |
|------|---------|-------|
| `tsx` | Dev runtime | `tsx watch src/cli.ts` for the CLI; `tsx src/mcp.ts` for the MCP server. Bun-compatible (Bun can also run TS directly). |
| `tsup` | Build | Outputs to `dist/`. Config: `format: ['esm']`, `target: 'node22'`, `banner: { js: '#!/usr/bin/env node' }` on the CLI entry, `external: ['better-sqlite3']` so the native module is loaded via Node, not bundled. |
| `drizzle-kit` | Migrations | `drizzle-kit generate` produces SQL files committed to `src/db/migrations/`. `drizzle-kit push` only for early iteration; never in user-facing flows. |
| `vitest` | Tests | `vitest run` for CI / pre-commit; `vitest` (watch) for dev. Configure `pool: 'forks'` so better-sqlite3 native handles don't cross worker threads. |
| `biome` | Lint + format | `biome check --write .` Single config (`biome.json`). |
| MCP Inspector | MCP debugging | `npx @modelcontextprotocol/inspector` against the built CLI to verify tool/resource/prompt registration without spinning up Claude Code. |
## Installation
# Core
# Dev dependencies
## OAuth2 + WHOOP-Specific Patterns
### Token refresh — concurrency-protected, single-writer
### Pattern: hand-rolled (RECOMMENDED for v1)
### Anti-recommendation: do not use `simple-oauth2` or `openid-client`
- `simple-oauth2` — Heavy, callback-era ergonomics, doesn't help with the WHOOP concurrency rule. Use `fetch` directly.
- `openid-client` — Overkill for OAuth 2.0 authorization-code flow without OIDC. WHOOP isn't an OIDC provider.
- `arctic` (3.7.0, actively maintained) — Reasonable fallback if the hand-rolled token plumbing grows past ~80 LOC or if we add additional providers later. Its generic `OAuth2Client` would work, but it doesn't solve the single-use refresh-token concurrency problem for you, so you still need the mutex. (LOW priority — keep on the bench)
## Date Handling — WHOOP timestamps
### Recommendation: `date-fns` v4 + `@date-fns/tz`
- **date-fns** wins on tree-shaking, immutability, and a function-per-operation API that's grep-friendly.
- **@date-fns/tz** gives you `tzDate()` and `tzOffset()` for IANA-zone-aware arithmetic without dragging in all of Luxon.
### Alternatives Considered
| Option | Verdict | Reasoning |
|--------|---------|-----------|
| Luxon | Strong second choice | Excellent IANA TZ support, well-tested, but heavier and class-based (less ergonomic in pure-function codebase). Pick this if you find yourself fighting `@date-fns/tz` interop. |
| Temporal polyfill (`@js-temporal/polyfill`) | Defer | Right answer eventually, but: not yet shipped in stable Node 22; the polyfill is large; ergonomic but `ZonedDateTime` etc. still has rough edges. Revisit when Temporal lands natively (Node 24+ likely). |
| Day.js | Skip | Mutable, weaker types, plugin sprawl. |
## Logging — MUST NOT pollute stdout
### Recommendation: Pino → stderr in MCP mode, configurable file in CLI mode
### Alternatives Considered
- **consola** — Pretty CLI output, weak structured logging, slower. Use for *user-facing* CLI output (progress, summaries) but not as the diagnostic logger.
- **No logger** — Tempting for a one-user tool, but the doctor command and the post-mortem story for failed syncs need structured logs to be useful.
## Secrets at Rest — OAuth refresh token
### Recommendation: `@napi-rs/keyring` with encrypted-file fallback
- **Primary:** `@napi-rs/keyring` writes the refresh token to the macOS Keychain (or Windows Credential Manager / Linux Secret Service). The SQLite DB only stores the *access token* (short-lived) and `expires_at`. On refresh, read the refresh token from the keychain, exchange it, write the new refresh token back to the keychain. (HIGH confidence — keyring-node is actively maintained, drop-in for keytar, and `keytar` itself was archived 2022-12 so should not be used for new code.)
- **Fallback (for headless / CI / Docker / Linux-without-secret-service):** AES-256-GCM with a key derived from a user passphrase via `crypto.scrypt`. File at `~/.recovery-ledger/secrets.enc`, 0600 permissions. Prompt for passphrase at sync time and cache in memory for the process lifetime.
### Anti-recommendation: keytar
## Tests — fixture-based contract tests
### Recommendation: Vitest + MSW 2.x
- **Vitest** for the test runner — fast, native ESM, fork-pool to keep better-sqlite3 native handles isolated.
- **MSW 2.x** in Node mode for HTTP mocking. One handler file per WHOOP resource, each handler loads its fixture from `tests/fixtures/whoop/<resource>/<scenario>.json`. Fixtures committed to the repo.
- **Per-resource contract test** that: (a) starts MSW with that resource's handler, (b) runs the sync code, (c) asserts the SQLite cache contains the expected normalized rows, (d) asserts the Zod schema accepts the fixture (catches API drift if the fixture is updated from a real WHOOP response).
### Pattern
### Alternatives Considered
- **nock** — Older, request-recording focused, less ergonomic for the fixture-per-scenario pattern.
- **Hand-rolled fetch mock** — Tempting but you lose MSW's network-level interception, which catches "we accidentally called WHOOP for real" bugs.
## CLI Framework — Commander vs alternatives
### Recommendation: Commander 14.0.3
- Zero-dep, mature (>10 years), well-known by anyone reading the code.
- Subcommand model fits `recovery-ledger sync`, `recovery-ledger review daily|weekly`, `recovery-ledger decision add|review`, `recovery-ledger doctor`.
- No fighting the framework for a tool that has ~10 commands.
### Alternatives Considered
| Option | When it would win |
|--------|-------------------|
| **Citty** 0.2.2 (UnJS) | If you already use Nitro/Nuxt/Unbuild and want consistency. Nicer TS ergonomics but smaller community and the changelog is less stable (0.2 jump from 0.1.6 was recent). |
| **Yargs** 18.0.0 | If you need very rich help formatting or middleware. Heavier than necessary here. |
| **Clipanion** 4.0.0-rc.4 | Class-based, used by Yarn Berry. Pre-1.0 RC and TS-decorator-heavy — not worth the complexity. |
| **oclif** | Overkill — designed for plugin-rich CLIs with autogenerated docs (Salesforce, Heroku scale). |
## MCP Framework — SDK vs fastmcp
### Recommendation: `@modelcontextprotocol/sdk` directly
### When `fastmcp` is worth it
- Built-in OAuth proxy (we don't need — WHOOP OAuth is between Recovery Ledger and WHOOP, not between the MCP client and the server)
- Multi-transport (SSE / Streamable HTTP) — we don't need; stdio only
- Simpler `addTool({ name, parameters, execute })` ergonomics
### Canonical stdio server skeleton (current SDK 1.29.x)
## Distribution — `npx recovery-ledger`
### Recommendation
### Anti-recommendation: bundlers we don't need
- **webpack / rollup** — `tsup` (esbuild) covers everything we need. No need for the complexity.
- **pkg / nexe** — single-binary packers. Not worth it for a tool whose users have Node anyway.
## Scheduling — launchd template, optional in-process cron
### Recommendation
- **Primary:** Ship a `templates/launchd/com.recovery-ledger.sync.plist` template that runs `recovery-ledger sync --days 1` every 4 hours. Document `launchctl load`/`unload`. This is the macOS-native, survives-reboot answer. Linux equivalent: a systemd user timer template.
- **Secondary (optional flag):** `recovery-ledger daemon --interval 4h` using `node-cron` 4.2.1 in-process. Only for users who want a foreground daemon (e.g., running in `tmux`). Default install does **not** start a daemon.
## Validation — Zod vs Valibot vs ArkType
### Recommendation: Zod 4.4.3 (no change from PROJECT.md)
### When alternatives would win
- **Valibot 1.4.0** — Smaller bundle (~70% smaller than Zod). Worth it for browser/edge. Not a meaningful win for a Node CLI.
- **ArkType 2.2.0** — Faster validation, type-syntax-first. Smaller community, more cognitive load for new contributors.
## What NOT to Use
| Avoid | Why | Use Instead |
|-------|-----|-------------|
| `axios` | Adds a dep when native `fetch` works fine on Node 22, has its own gotchas (auto-JSON parsing, transformResponse). | Native `fetch`; reach for `undici` only if you need `Agent`/`Pool`. |
| `prisma` | Heavy, generates a client, owns the schema, runs its own engine binary. Wrong abstraction tax for a local SQLite cache. | Drizzle. |
| `keytar` | Atom org archived 2022-12; unmaintained. | `@napi-rs/keyring`. |
| `simple-oauth2` | Callback-era ergonomics, doesn't solve WHOOP's single-use refresh-token concurrency rule. | Hand-rolled `fetch` + mutex; or `arctic` as fallback. |
| `openid-client` | OIDC-heavy; WHOOP is plain OAuth2. | Hand-rolled or `arctic`. |
| `dotenv` | Node 20.6+ has `--env-file=.env` built in; or pull config from `~/.recovery-ledger/config.json`. | Native `--env-file` or a config file. |
| `nodemon` | `tsx watch` is faster and TS-native. | `tsx watch`. |
| `ts-node` | Slower than `tsx`, more tsconfig friction. | `tsx`. |
| `jest` | Heavier, slower, ESM story is still painful. | Vitest. |
| `webpack` / `rollup` | Bundler overkill for a Node CLI. | `tsup`. |
| `pkg` / `nexe` | Users have Node; single-binary packaging adds maintenance burden. | npm publish + `npx`. |
| Day.js | Mutable, weaker types, plugin sprawl. | date-fns v4 + `@date-fns/tz`. |
| `console.log` in the MCP server | **Breaks the stdio protocol.** Every byte on stdout must be a JSON-RPC message. | Pino → stderr or file. |
| Embedded scheduler enabled by default | Surprise daemons annoy users; resource use during sleep mode; battery impact. | launchd `.plist` template, opt-in. |
## Version Compatibility Notes
| Pair | Compatible? | Notes |
|------|-------------|-------|
| `better-sqlite3@12.9.0` + Node 22 LTS | Yes | Prebuilt binaries available; verify on `npm install`. |
| `better-sqlite3@12.9.0` + Bun | Mostly | Bun has its own native `bun:sqlite` that's typically used instead — if you target Bun, swap drivers via a thin abstraction. For Node 22, no change needed. |
| `drizzle-orm@0.45.x` + `drizzle-kit@0.31.x` | Yes | Keep both on the stable line for now; do not mix stable + 1.0-rc. |
| `@modelcontextprotocol/sdk@1.29.x` + Zod v4 | Yes | SDK uses Standard Schema, Zod v4 is Standard Schema compatible out of the box. Zod v3 also works but v4 is preferred. |
| `tsup@8.5.x` + `better-sqlite3` | Mark external | `better-sqlite3` is a native binding — list it in `tsup` `external` and ship as a real dep, not a bundled module. Same for `@napi-rs/keyring`. |
| `vitest@4.x` + better-sqlite3 | Yes, with `pool: 'forks'` | Native modules don't cross worker threads cleanly; use forks. |
| `msw@2.14.x` + Node 22 native fetch | Yes | MSW 2.x intercepts fetch in Node via `setupServer`. |
## Stack Patterns by Variant
- Drop `tsx` (Bun runs TS natively).
- Consider swapping `better-sqlite3` for `bun:sqlite` behind an interface; both expose synchronous APIs. For v1, sticking with `better-sqlite3` keeps a single code path.
- Everything else works as-is.
- `@napi-rs/keyring` will fail to find a backend. Fall back to encrypted-file mode with a user passphrase.
- No keychain — same fallback as above.
- Use `--env-file` for OAuth credentials in CI tests; never commit real tokens.
## Confidence Summary
| Recommendation | Confidence | Verification |
|----------------|------------|--------------|
| MCP SDK v1.29.x for stdio | HIGH | npm registry (released 2026-03-30), official repo |
| better-sqlite3 12.9.0 | HIGH | npm, prebuilt binaries for Node 22 confirmed |
| Drizzle 0.45.x (stable) | HIGH | npm latest tag; 1.0 still in RC.2 |
| Zod 4.4.3 | HIGH | npm, MCP SDK example uses Zod v4 |
| Commander 14 | HIGH | npm, mature |
| date-fns 4.1 + `@date-fns/tz` | MEDIUM | Pick between date-fns and Luxon is genuinely close |
| Pino 10.3.1 → stderr/file | HIGH | Pino docs explicit on destination targeting |
| `@napi-rs/keyring` 1.3.0 | HIGH | Active maintenance; keytar archived 2022-12 |
| MSW 2.14.6 + Vitest 4.1.6 | HIGH | De facto standard 2025-2026 |
| tsx + tsup for build | HIGH | UnJS / esbuild ecosystem standard |
| Hand-rolled OAuth + mutex over Arctic/simple-oauth2 | MEDIUM-HIGH | WHOOP's concurrency rule means no library saves you from writing the mutex |
| launchd template + opt-in node-cron | MEDIUM | Depends on Chris's preference; ship both, default off |
| Skip fastmcp for v1 | HIGH | Raw SDK is small enough |
## Sources
- npm registry queries on 2026-05-11 for all packages above (versions, release dates)
- [@modelcontextprotocol/sdk on npm](https://www.npmjs.com/package/@modelcontextprotocol/sdk) — version 1.29.0, released 2026-03-30
- [modelcontextprotocol/typescript-sdk](https://github.com/modelcontextprotocol/typescript-sdk) — current canonical stdio pattern, v2 confirmed pre-alpha
- [WHOOP OAuth 2.0 docs](https://developer.whoop.com/docs/developing/oauth) — auth code flow, `offline` scope, single-use refresh-token rotation, concurrency warning
- [WiseLibs/better-sqlite3](https://github.com/WiseLibs/better-sqlite3) — WAL pragma, Node 22 LTS support, prebuilt binaries
- [Drizzle ORM v1 Roadmap](https://orm.drizzle.team/roadmap) — 1.0-rc.2 status as of early May 2026; stable line is 0.45.x
- [Brooooooklyn/keyring-node](https://github.com/Brooooooklyn/keyring-node) — `@napi-rs/keyring`, drop-in keytar replacement, v1.3.0 released 2026-04-30
- [atom/node-keytar](https://github.com/atom/node-keytar) — archived 2022-12-15 (avoid)
- [Arctic v3 docs](https://arcticjs.dev/) — fallback OAuth2 client, generic provider support, v3.7.0
- [Pino docs](https://getpino.io/) — destination targeting (stderr / file)
- [MSW docs](https://mswjs.io/) — Node setup, handler-per-resource pattern
- [punkpeye/fastmcp](https://github.com/punkpeye/fastmcp) — comparison vs raw SDK
- [Vitest docs](https://vitest.dev/) — `pool: 'forks'` for native modules
- [tsup docs](https://tsup.egoist.dev/) — `banner` for shebang, `external` for native modules
<!-- GSD:stack-end -->

<!-- GSD:conventions-start source:CONVENTIONS.md -->
## Conventions

Conventions not yet established. Will populate as patterns emerge during development.
<!-- GSD:conventions-end -->

<!-- GSD:architecture-start source:ARCHITECTURE.md -->
## Architecture

Architecture not yet mapped. Follow existing patterns found in the codebase.
<!-- GSD:architecture-end -->

<!-- GSD:skills-start source:skills/ -->
## Project Skills

No project skills found. Add skills to any of: `.claude/skills/`, `.agents/skills/`, `.cursor/skills/`, `.github/skills/`, or `.codex/skills/` with a `SKILL.md` index file.
<!-- GSD:skills-end -->

<!-- GSD:workflow-start source:GSD defaults -->
## GSD Workflow Enforcement

Before using Edit, Write, or other file-changing tools, start work through a GSD command so planning artifacts and execution context stay in sync.

Use these entry points:
- `/gsd-quick` for small fixes, doc updates, and ad-hoc tasks
- `/gsd-debug` for investigation and bug fixing
- `/gsd-execute-phase` for planned phase work

Do not make direct repo edits outside a GSD workflow unless the user explicitly asks to bypass it.
<!-- GSD:workflow-end -->



<!-- GSD:profile-start -->
## Developer Profile

> Profile not yet configured. Run `/gsd-profile-user` to generate your developer profile.
> This section is managed by `generate-claude-profile` -- do not edit manually.
<!-- GSD:profile-end -->
