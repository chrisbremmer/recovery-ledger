# Stack Research — Recovery Ledger

**Domain:** Local-first TypeScript CLI + MCP stdio server, WHOOP API v2 client, SQLite cache, single-developer personal tool
**Researched:** 2026-05-11
**Confidence:** HIGH (all core picks verified against current npm registry + official docs)

---

## Executive Summary

The PROJECT.md-locked picks (`@modelcontextprotocol/sdk`, `better-sqlite3` + Drizzle, Zod, native `fetch`, Vitest, Biome) are the right call as of 2026-05-11 — they are all on current major releases with active maintenance and direct ecosystem fit. The decisions that needed to be filled in are:

1. **CLI framework:** Commander 14 (smallest, zero-dep, most boring; Citty is the runner-up if you want UnJS ergonomics)
2. **Date library:** date-fns v4 with explicit IANA tz support (`@date-fns/tz`) — defer Temporal until the polyfill stabilises further
3. **OAuth helper:** roll-your-own thin wrapper around `fetch` + a single-flight refresh mutex; Arctic 3.x is the fallback if the hand-rolled code grows beyond ~80 lines. **Do not** use `simple-oauth2` (heavy, callback-era ergonomics) or `openid-client` (overkill — WHOOP is OAuth2, not OIDC).
4. **HTTP mocking:** MSW 2.x with the Node setup — handler-based fixtures map cleanly to per-resource WHOOP contract tests
5. **Build:** `tsx` for dev, `tsup` for production builds; the entry script gets a shebang and `package.json` `bin` field; `npx recovery-ledger` works for free once published
6. **Secrets at rest:** `@napi-rs/keyring` (keytar drop-in, actively maintained Rust binding) for the OAuth refresh token, with an AES-256-GCM passphrase-derived fallback file for environments without a system keychain
7. **Logging:** Pino with `pino-pretty` in dev, JSON to a rotating file in prod — critically, **stdout must stay clean for the MCP stdio transport**, so all logs go to stderr or a file, never stdout
8. **Scheduling:** ship a launchd `.plist` template (P1) and document `node-cron` as an in-process fallback; do not run an embedded scheduler by default on a personal tool

The biggest WHOOP-specific footgun this stack must defuse: **refresh tokens are single-use and any concurrent refresh kills the losing request's token**. The token store needs a single-writer mutex (in-process mutex + SQLite advisory lock for cross-process safety between CLI and MCP server).

---

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

---

## Installation

```bash
# Core
npm install \
  @modelcontextprotocol/sdk@^1.29.0 \
  better-sqlite3@^12.9.0 \
  drizzle-orm@^0.45.2 \
  zod@^4.4.3 \
  commander@^14.0.3 \
  date-fns@^4.1.0 \
  @date-fns/tz@^1 \
  pino@^10.3.1 \
  @napi-rs/keyring@^1.3.0

# Dev dependencies
npm install -D \
  typescript@^5.7 \
  @types/node@^22 \
  @types/better-sqlite3@^7 \
  tsx@^4.21 \
  tsup@^8.5 \
  drizzle-kit@^0.31.10 \
  vitest@^4.1.6 \
  msw@^2.14.6 \
  pino-pretty@^13 \
  @biomejs/biome@^2.4.15
```

`package.json` additions:

```jsonc
{
  "type": "module",
  "bin": {
    "recovery-ledger": "./dist/cli.mjs",
    "recovery-ledger-mcp": "./dist/mcp.mjs"
  },
  "engines": { "node": ">=22.11" },
  "files": ["dist", "src/db/migrations"]
}
```

`tsup.config.ts`:

```ts
import { defineConfig } from 'tsup';
export default defineConfig({
  entry: { cli: 'src/cli.ts', mcp: 'src/mcp.ts' },
  format: ['esm'],
  target: 'node22',
  outDir: 'dist',
  outExtension: () => ({ js: '.mjs' }),
  banner: { js: '#!/usr/bin/env node' },
  external: ['better-sqlite3', '@napi-rs/keyring'],
  clean: true,
  sourcemap: true,
});
```

---

## OAuth2 + WHOOP-Specific Patterns

### Token refresh — concurrency-protected, single-writer

WHOOP's docs explicitly warn: simultaneous refresh requests race, the first wins, the second's refresh token is **already invalidated** by the time it arrives. This is the dominant failure mode for this project. The contract is:

1. **Single in-process mutex** around the refresh code path (use a tiny promise-based mutex or a `let pending: Promise<Tokens> | null` pattern — no library needed).
2. **Cross-process safety** between the CLI and the MCP stdio server (which can both run simultaneously on the same machine) via a SQLite advisory lock or a `BEGIN IMMEDIATE` transaction on a `tokens` row. The CLI sync command and the MCP server both call the same `getValidAccessToken()` function, which reads from the DB, checks `expires_at`, and if within (say) 60s of expiry calls a refresh path that holds the SQLite write lock.
3. **Atomic write** of the new `{access_token, refresh_token, expires_at}` tuple to SQLite inside the same transaction that releases the lock. If the refresh response is malformed, do not commit.
4. **Retry budget** of 0 for refresh — never retry a failed refresh automatically. A failed refresh means the user must re-auth, and silently retrying just burns the refresh token chain.

### Pattern: hand-rolled (RECOMMENDED for v1)

```ts
// Pseudocode — ~50 LOC total
async function getValidAccessToken(db: Database): Promise<string> {
  const tx = db.transaction(() => {
    const row = db.prepare('SELECT * FROM oauth_tokens WHERE id = 1').get();
    if (!row) throw new AuthRequiredError();
    if (Date.now() < row.expires_at - 60_000) return { fresh: row.access_token };
    return { stale: row };
  });
  const result = tx();
  if ('fresh' in result) return result.fresh;
  // Holds a single-writer guarantee via WAL + BEGIN IMMEDIATE on the next tx
  return refreshWithLock(db, result.stale);
}
```

### Anti-recommendation: do not use `simple-oauth2` or `openid-client`

- `simple-oauth2` — Heavy, callback-era ergonomics, doesn't help with the WHOOP concurrency rule. Use `fetch` directly.
- `openid-client` — Overkill for OAuth 2.0 authorization-code flow without OIDC. WHOOP isn't an OIDC provider.
- `arctic` (3.7.0, actively maintained) — Reasonable fallback if the hand-rolled token plumbing grows past ~80 LOC or if we add additional providers later. Its generic `OAuth2Client` would work, but it doesn't solve the single-use refresh-token concurrency problem for you, so you still need the mutex. (LOW priority — keep on the bench)

---

## Date Handling — WHOOP timestamps

WHOOP returns ISO-8601 with offsets like `"2026-04-12T07:30:00.000+02:00"`. The two real challenges:

1. **"Today" in the user's timezone** — a recovery that came back at 04:00 local time still belongs to today's review. `date-fns` alone uses the system local TZ; for portability and testability, pin an IANA zone (read from `Intl.DateTimeFormat().resolvedOptions().timeZone` once at startup, store in config).
2. **Sleep crossing midnight** — sleep starts 22:00 day N, ends 07:00 day N+1, but WHOOP assigns it to a "cycle" — preserve WHOOP's cycle assignment; do not re-derive day boundaries.

### Recommendation: `date-fns` v4 + `@date-fns/tz`

- **date-fns** wins on tree-shaking, immutability, and a function-per-operation API that's grep-friendly.
- **@date-fns/tz** gives you `tzDate()` and `tzOffset()` for IANA-zone-aware arithmetic without dragging in all of Luxon.

### Alternatives Considered

| Option | Verdict | Reasoning |
|--------|---------|-----------|
| Luxon | Strong second choice | Excellent IANA TZ support, well-tested, but heavier and class-based (less ergonomic in pure-function codebase). Pick this if you find yourself fighting `@date-fns/tz` interop. |
| Temporal polyfill (`@js-temporal/polyfill`) | Defer | Right answer eventually, but: not yet shipped in stable Node 22; the polyfill is large; ergonomic but `ZonedDateTime` etc. still has rough edges. Revisit when Temporal lands natively (Node 24+ likely). |
| Day.js | Skip | Mutable, weaker types, plugin sprawl. |

(MEDIUM confidence — the choice between date-fns+tz and Luxon is a coin flip. Either works.)

---

## Logging — MUST NOT pollute stdout

The MCP stdio transport multiplexes JSON-RPC over stdin/stdout. **Anything written to stdout that is not a JSON-RPC message breaks the protocol.** This is the single most common cause of broken MCP servers.

### Recommendation: Pino → stderr in MCP mode, configurable file in CLI mode

```ts
import { pino } from 'pino';

export const logger = pino({
  level: process.env.LOG_LEVEL ?? 'info',
  // CRITICAL: write to stderr or a file, never stdout
  transport: process.env.NODE_ENV === 'development'
    ? { target: 'pino-pretty', options: { destination: 2 /* stderr */ } }
    : undefined,
}, pino.destination({ dest: 2 /* stderr */, sync: false }));
```

For the MCP server entrypoint, additionally pipe to a rotating file at `~/.recovery-ledger/logs/mcp-YYYY-MM-DD.log` so the user can debug without losing structured context.

### Alternatives Considered

- **consola** — Pretty CLI output, weak structured logging, slower. Use for *user-facing* CLI output (progress, summaries) but not as the diagnostic logger.
- **No logger** — Tempting for a one-user tool, but the doctor command and the post-mortem story for failed syncs need structured logs to be useful.

Recommendation: **Pino for diagnostics, raw `console.log` (well, `process.stdout.write`) only inside CLI commands that are explicitly producing human output (never inside the MCP server).**

---

## Secrets at Rest — OAuth refresh token

WHOOP refresh tokens are bearer credentials with long validity. A plaintext token in a SQLite file is unacceptable on a shared dev machine.

### Recommendation: `@napi-rs/keyring` with encrypted-file fallback

- **Primary:** `@napi-rs/keyring` writes the refresh token to the macOS Keychain (or Windows Credential Manager / Linux Secret Service). The SQLite DB only stores the *access token* (short-lived) and `expires_at`. On refresh, read the refresh token from the keychain, exchange it, write the new refresh token back to the keychain. (HIGH confidence — keyring-node is actively maintained, drop-in for keytar, and `keytar` itself was archived 2022-12 so should not be used for new code.)
- **Fallback (for headless / CI / Docker / Linux-without-secret-service):** AES-256-GCM with a key derived from a user passphrase via `crypto.scrypt`. File at `~/.recovery-ledger/secrets.enc`, 0600 permissions. Prompt for passphrase at sync time and cache in memory for the process lifetime.

### Anti-recommendation: keytar

`atom/node-keytar` was archived 2022-12-15 along with the rest of Atom. Don't pull it into a new project even though it still installs.

---

## Tests — fixture-based contract tests

The PROJECT.md success criterion is "fixture-based contract tests for each WHOOP API resource (no live API calls in default test run); suite must run in under 60 seconds locally."

### Recommendation: Vitest + MSW 2.x

- **Vitest** for the test runner — fast, native ESM, fork-pool to keep better-sqlite3 native handles isolated.
- **MSW 2.x** in Node mode for HTTP mocking. One handler file per WHOOP resource, each handler loads its fixture from `tests/fixtures/whoop/<resource>/<scenario>.json`. Fixtures committed to the repo.
- **Per-resource contract test** that: (a) starts MSW with that resource's handler, (b) runs the sync code, (c) asserts the SQLite cache contains the expected normalized rows, (d) asserts the Zod schema accepts the fixture (catches API drift if the fixture is updated from a real WHOOP response).

### Pattern

```
tests/
  fixtures/whoop/
    cycles/200-ok.json
    cycles/200-paginated.json
    cycles/429-rate-limited.json
    recovery/200-ok.json
    ...
  contract/
    cycles.test.ts        // imports cycles handlers, asserts normalized output
    recovery.test.ts
    ...
  integration/
    sync-end-to-end.test.ts  // uses all handlers together, drives the CLI
```

### Alternatives Considered

- **nock** — Older, request-recording focused, less ergonomic for the fixture-per-scenario pattern.
- **Hand-rolled fetch mock** — Tempting but you lose MSW's network-level interception, which catches "we accidentally called WHOOP for real" bugs.

(HIGH confidence on Vitest+MSW; this is the de facto standard in 2025-2026 TS testing.)

---

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

(HIGH confidence — Commander is the boring-and-correct pick.)

---

## MCP Framework — SDK vs fastmcp

### Recommendation: `@modelcontextprotocol/sdk` directly

The raw SDK is small enough that you don't need a wrapper for a single-developer tool with ~8 tools and ~6 resources. The PROJECT.md scope is bounded and the SDK gives you the cleanest mental model.

### When `fastmcp` is worth it

`punkpeye/fastmcp` (the TypeScript package — distinct from the Python `FastMCP`) adds:
- Built-in OAuth proxy (we don't need — WHOOP OAuth is between Recovery Ledger and WHOOP, not between the MCP client and the server)
- Multi-transport (SSE / Streamable HTTP) — we don't need; stdio only
- Simpler `addTool({ name, parameters, execute })` ergonomics

Verdict: **skip fastmcp for v1.** Revisit if/when we expose a remote MCP server (out of scope per PROJECT.md). (HIGH confidence)

### Canonical stdio server skeleton (current SDK 1.29.x)

```ts
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

const server = new McpServer({ name: 'recovery-ledger', version: '0.1.0' });

server.registerTool(
  'whoop_daily_review',
  {
    description: 'Today vs trailing-30-day baseline + top 3 actions',
    inputSchema: z.object({ date: z.string().date().optional() }),
  },
  async ({ date }) => {
    const result = await runDailyReview(date ?? today());
    return {
      content: [{ type: 'text', text: result.text }],
      structuredContent: result.json,
    };
  },
);

await server.connect(new StdioServerTransport());
```

---

## Distribution — `npx recovery-ledger`

### Recommendation

1. Publish to npm as `recovery-ledger`.
2. `package.json` `bin` field maps `recovery-ledger` → `./dist/cli.mjs` and `recovery-ledger-mcp` → `./dist/mcp.mjs`.
3. Both entry files have `#!/usr/bin/env node` prepended by `tsup`'s `banner` config.
4. `npm publish` ships only `dist/` and `src/db/migrations/` (via `files` field).
5. End-user install paths, ranked:
   - `npx recovery-ledger@latest setup` — zero install, one command, works on any Node 22+ machine.
   - `npm install -g recovery-ledger` — for power users who want it always on PATH.
   - `git clone && npm link` — for development.
6. Claude Code / Desktop MCP config points at `npx -y recovery-ledger-mcp` so the server auto-installs on first use.

### Anti-recommendation: bundlers we don't need

- **webpack / rollup** — `tsup` (esbuild) covers everything we need. No need for the complexity.
- **pkg / nexe** — single-binary packers. Not worth it for a tool whose users have Node anyway.

---

## Scheduling — launchd template, optional in-process cron

PROJECT.md mentions a P1 "scheduled local runner template for macOS launchd."

### Recommendation

- **Primary:** Ship a `templates/launchd/com.recovery-ledger.sync.plist` template that runs `recovery-ledger sync --days 1` every 4 hours. Document `launchctl load`/`unload`. This is the macOS-native, survives-reboot answer. Linux equivalent: a systemd user timer template.
- **Secondary (optional flag):** `recovery-ledger daemon --interval 4h` using `node-cron` 4.2.1 in-process. Only for users who want a foreground daemon (e.g., running in `tmux`). Default install does **not** start a daemon.

(MEDIUM confidence — depends on whether Chris actually wants a daemon mode in v1 or punts to launchd-only.)

---

## Validation — Zod vs Valibot vs ArkType

### Recommendation: Zod 4.4.3 (no change from PROJECT.md)

Zod is the right choice. Direct integration with the MCP SDK (Standard Schema compatible), excellent inference, mature error messages, smallest learning curve for anyone reading the code.

### When alternatives would win

- **Valibot 1.4.0** — Smaller bundle (~70% smaller than Zod). Worth it for browser/edge. Not a meaningful win for a Node CLI.
- **ArkType 2.2.0** — Faster validation, type-syntax-first. Smaller community, more cognitive load for new contributors.

Stick with Zod. (HIGH confidence)

---

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

---

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

---

## Stack Patterns by Variant

**If the user is on Bun instead of Node 22:**
- Drop `tsx` (Bun runs TS natively).
- Consider swapping `better-sqlite3` for `bun:sqlite` behind an interface; both expose synchronous APIs. For v1, sticking with `better-sqlite3` keeps a single code path.
- Everything else works as-is.

**If Linux without a system keychain (no GNOME Keyring / KWallet):**
- `@napi-rs/keyring` will fail to find a backend. Fall back to encrypted-file mode with a user passphrase.

**If running inside Docker / CI:**
- No keychain — same fallback as above.
- Use `--env-file` for OAuth credentials in CI tests; never commit real tokens.

---

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

---

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

---

*Stack research for: local-first TypeScript CLI + MCP stdio server with WHOOP API v2 client*
*Researched: 2026-05-11*
