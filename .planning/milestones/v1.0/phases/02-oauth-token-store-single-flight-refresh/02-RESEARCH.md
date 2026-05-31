# Phase 2: OAuth, Token Store & Single-Flight Refresh - Research

**Researched:** 2026-05-12
**Domain:** OAuth 2.0 Authorization Code flow + token storage + concurrent-refresh coordination for a local-first TypeScript CLI + MCP stdio server consuming WHOOP API v2
**Confidence:** HIGH (Phase 1 sanitizer code read directly; WHOOP OAuth surface + library APIs verified against current docs and npm registry on 2026-05-12; ADRs cited verbatim; one MEDIUM-confidence gap — WHOOP PKCE support is undocumented in their OAuth guide)

## Summary

Phase 2 builds three things on top of Phase 1's stdout-pure / sanitizer-wrapped MCP shell: (a) a two-command OAuth onboarding surface (`init` + `auth`), (b) a token store that primarily uses `@napi-rs/keyring` and falls back to a `chmod 600` JSON file, and (c) a three-layer single-flight refresh gate (in-process `Promise<Tokens> | null` + `proper-lockfile` cross-process lock + atomic temp-and-rename write) — exactly as ADR-0002 specifies. The phase ships zero new MCP tools; everything sits inside `src/infrastructure/whoop/` and surfaces through two new doctor checks plus extensions to Phase 1's existing sanitize.ts and runDoctor service.

The dominant risk is WHOOP's **rotating-refresh-token family revocation** rule: any second refresh that arrives after the first one consumes the family invalidates the whole user's auth. Phase 1's stdout-pure MCP shell, the sanitize.ts pattern catalog, and the runDoctor surface are all already in place — Phase 2 extends rather than rewrites them. The work is concentrated in three new directories: `src/infrastructure/whoop/{oauth.ts,token-store.ts}`, two new `src/services/doctor/checks/` files, and three new CLI commands (`init`, `auth`, and the extended `doctor`).

One genuine research-time finding contradicts CONTEXT.md's D-01 phrasing: WHOOP **requires a pre-registered redirect URI** in the developer dashboard. The decision text in D-01 already anticipates this ("if WHOOP requires a registered redirect URI rather than RFC 8252 loopback") — the answer is yes, WHOOP requires it. The "dynamically-chosen loopback port" in success-criterion #1 must therefore mean *configured at `init` time and registered in the WHOOP developer dashboard*, NOT *discovered at OAuth time*. ROADMAP.md success-criterion #1 phrasing ("dynamically-chosen loopback port") is still satisfiable: the port is chosen by the user at `init` (default 4321), registered manually in the WHOOP dashboard, and reused on every `auth` invocation. This is the interpretation D-01 already locked.

**Primary recommendation:** Build the token-store module first (it is the dependency hub), then `oauth.ts` for the auth-code-exchange surface, then the `init` / `auth` CLI shims, then the two doctor checks, then the sanitizer extension. Verification via two layers — a unit-level 10-promise concurrency test (`token-store.test.ts`) and a cross-process integration test (`tests/integration/auth-concurrency.test.ts`) that spawns two child processes. Both run fixture-only via MSW per ADR-0006.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

#### `init` vs `auth` command split
- **D-01:** Two separate commands, no auto-chain. `recovery-ledger init` is idempotent config bootstrap — prompts for `client_id`, `client_secret`, and (if WHOOP requires a registered redirect URI rather than RFC 8252 loopback) a `redirect_port` (default `4321`); writes `~/.recovery-ledger/config.json` mode 0600; prints the next-step suggestion `Next: recovery-ledger auth`. `recovery-ledger auth` is the OAuth flow itself — reads config, starts the loopback server, opens the browser, exchanges code, persists tokens. **Rationale:** separates "rotate WHOOP app credentials" (rare, config-only) from "re-authorize this install" (state-changing OAuth event).
- **D-02:** `init` prints inline WHOOP-app creation instructions as text — does not auto-open the developer portal. Lines printed: (1) link to `https://developer.whoop.com/dashboard/applications`, (2) the exact redirect URI to register (constructed from `redirect_port`), (3) the scope set Recovery Ledger will request. Browser auto-open is reserved for `auth`.

#### Token storage layout
- **D-03:** Config dir is `~/.recovery-ledger/` (override via `RECOVERY_LEDGER_HOME` env var). XDG-compliant `~/.config/recovery-ledger/` is rejected.
- **D-04:** Keyring is primary storage. `@napi-rs/keyring` stores a single JSON-serialized blob with `access_token`, `refresh_token`, `token_type: "bearer"`, `expires_at` (ms epoch), `scope`, `obtained_at`. Service name: `recovery-ledger`. Account name: `whoop`.
- **D-05:** File fallback at `~/.recovery-ledger/tokens.json` mode 0600 — same JSON shape. Fallback triggered when `Entry.setPassword()` throws. Detection cached in `~/.recovery-ledger/storage-mode` (single-line: `keychain` or `file`).
- **D-06:** Config at `~/.recovery-ledger/config.json` mode 0600. Env-var overrides: `WHOOP_CLIENT_ID`, `WHOOP_CLIENT_SECRET` win over file values; `RECOVERY_LEDGER_HOME` redirects the entire dir.
- **D-07:** Lock target at `~/.recovery-ledger/tokens.json.lock` regardless of storage backend — `proper-lockfile` needs a file to coordinate on. When tokens live in keyring, the lockfile still exists as a `touch`ed empty file.

#### Loopback OAuth callback UX
- **D-08:** Auto-open the browser via `open` (sindresorhus' cross-platform package). On failure, fall back to printing the authorize URL with a copy-paste prompt. Same code path used for `--no-browser` flag.
- **D-09:** Render minimal HTML on the redirect target. Success (200): `<title>Recovery Ledger — auth complete</title>` + `<h1>Authorization complete.</h1><p>You can close this window and return to your terminal.</p>`. Failure (400): similar with `{redacted_error}` block (run through sanitizer before HTML insertion). **No CSS, no JS, no external assets.**
- **D-10:** Loopback server timeout is 5 minutes (300 seconds), configurable via `--timeout <seconds>`. On timeout: shut down listener, exit `auth_timeout`. Ctrl-C also cleanly shuts down listener and removes lock.
- **D-11:** CSRF protection via random 32-byte (base64url-encoded) `state` parameter, generated per-attempt with `crypto.randomBytes`. Mismatch → reject with `oauth_state_mismatch`.
- **D-12:** PKCE used **if WHOOP supports it** (S256 challenge over 64-byte random verifier). Research item — confirm against WHOOP docs. If unsupported, fall back to state-only protection.

#### OAuth scopes
- **D-13:** Request full read set up front: `offline read:recovery read:sleep read:workout read:cycles read:profile read:body_measurement`. **Research item:** confirm exact scope-string vocabulary against current WHOOP v2 docs.

#### Refresh trigger & retry policy
- **D-14:** Refresh trigger is **5 minutes before `expires_at`** (preemptive) OR on a 401 response (reactive). Both paths go through `getValidAccessToken()`. Hard-coded constant `REFRESH_BUFFER_MS = 5 * 60 * 1000` exported from `infrastructure/whoop/token-store.ts`.
- **D-15:** On 401 from a WHOOP REST call, the wrapper does exactly one retry. Single retry budget, then `auth_expired`. **Never retry a failed refresh.**
- **D-16:** Concurrent in-process callers `await` the same in-flight refresh promise — no separate WHOOP refresh call. Per ADR-0002.

#### MCP integration
- **D-17:** Phase 2 exposes **no new MCP tools** — `whoop_doctor` from Phase 1 stays the only auth-aware tool. Token-refresh wrapper is purely internal to `infrastructure/whoop/`.
- **D-18:** Any error path bubbling through MCP goes through `src/mcp/register.ts` from Phase 1, which means it goes through the sanitizer. AUTH-06 covered by Phase 1's infrastructure plus the Phase 2 sanitizer-pattern extension below.

#### Sanitizer pattern extension
- **D-19:** Add two patterns to `src/mcp/sanitize.ts`: (1) `code=` in query strings, (2) `client_secret` JSON key. **Note from research:** both are ALREADY in Phase 1's `SECRET_KEY_NAMES` array — see "Existing Code Insights" below for the actual delta.
- **D-20:** Each new pattern adds a row to `sanitize.test.ts` with positive + negative cases. Plus an "errors that historically leak" fixture with `code=eyJ…` + `client_secret=hunter2` in cause chain.

#### Doctor checks
- **D-21:** Add two checks: `auth.ts` (returns `auth: keychain | file | missing`) and `token-freshness.ts` (compares `expires_at` to `Date.now()`).
- **D-22:** WHOOP roundtrip check deferred to Phase 5. Phase 2 doctor stays offline-safe.

#### Concurrent-load test design
- **D-23:** Two layers: (1) unit-level 10 parallel `Promise.all` against MSW handler counting hits; (2) cross-process integration test spawning two child processes against shared MSW. Refresh endpoint hit exactly once.
- **D-24:** Integration test is load-bearing for AUTH-05.

#### Linux fallback test
- **D-25:** Extend GitHub Actions matrix to `[macos-latest, ubuntu-latest]` from Phase 2 forward. Linux row runs `RECOVERY_LEDGER_FORCE_FILE_STORE=1` to exercise fallback path without apt-uninstalling libsecret.

### Claude's Discretion

The user delegated all four discussion areas at once and the agent landed clear winners on all — no escalation. Decisions D-01 through D-25 are the result. No additional discretion areas remain open.

### Deferred Ideas (OUT OF SCOPE)

- WHOOP roundtrip check in `doctor` (Phase 5)
- Multi-account support (keyring account `whoop:<user-id>`)
- Token rotation observability ("refreshes in last 7 days")
- `recovery-ledger reset auth` subcommand
- AES-256-GCM passphrase-derived file fallback
- `@modelcontextprotocol/inspector` CI smoke step
- Refresh-rate-limit detection (429 on refresh endpoint)

</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| AUTH-01 | BYO WHOOP developer credentials configured via `recovery-ledger init` with dynamic loopback-port OAuth callback | OAuth flow research (§OAuth Authorization Code Flow); WHOOP redirect-URI constraint; `init` command (CONTEXT D-01..02) |
| AUTH-02 | `recovery-ledger auth` initiates OAuth Authorization Code flow, opens browser, exchanges code for tokens, reports success | Loopback HTTP server pattern; `crypto.randomBytes` state generation; `open` package for browser launch; token-exchange request shape (§OAuth Authorization Code Flow) |
| AUTH-03 | OAuth tokens stored at rest via `@napi-rs/keyring` with `chmod 600` file fallback when keychain unavailable, surfaced clearly by `doctor` | Token store interface; storage-mode cache file; doctor `auth` check (§Token Storage); D-21 |
| AUTH-04 | Token-refresh wrapper transparently refreshes expired access tokens and retries originating request on 401 | Refresh trigger logic (REFRESH_BUFFER_MS); 401-retry pattern (D-14/D-15); `getValidAccessToken()` interface |
| AUTH-05 | Single-flight refresh: in-process module-level `Promise<Tokens> \| null` plus cross-process file advisory lock plus atomic temp-file-and-rename token write | ADR-0002 three-layer gate (§Single-Flight Refresh Primitive); `proper-lockfile` API; atomic write recipe |
| AUTH-06 | Token-leak prevention: error messages and MCP tool error returns never expose token material (covered by FND-06) | Existing sanitize.ts already covers `client_secret` + `code=`; Phase 2 adds test fixtures only (§Sanitizer Extension) |
</phase_requirements>

## Project Constraints (from CLAUDE.md / AGENTS.md)

| Constraint | Source | Phase 2 Impact |
|------------|--------|----------------|
| TypeScript strict, ESM only, no default exports | conventions.md | All new files use named exports; `oauth.ts` and `token-store.ts` follow |
| Module layout: token store + oauth client live in `src/infrastructure/whoop/` | ARCHITECTURE.md §Component Responsibilities | New files: `src/infrastructure/whoop/oauth.ts`, `src/infrastructure/whoop/token-store.ts` |
| MCP stdout purity — no `console.*` outside `src/cli/` and tests | ADR-0001 + ci-grep-gates.sh | Token-store / oauth modules log via Pino → stderr only; CLI command files use `process.stdout.write` for human output |
| Single-flight OAuth refresh — in-process Promise + file lock + atomic write | ADR-0002 | Load-bearing for Phase 2; three-layer gate is non-negotiable |
| Fixture-only tests, no live WHOOP | ADR-0006 | MSW intercepts WHOOP token endpoint; `VITEST_LIVE_WHOOP=1` env-gated for any opt-in live test |
| Read-only WHOOP — GET-only HTTP client | ADR-0007 | Phase 2 HTTP client surface exposes only `get(path, query)`; OAuth token endpoint POSTs are confined to `oauth.ts` (not the general client) |
| `pool: 'forks'` for Vitest | conventions.md / CLAUDE.md | Required for cross-process integration test that spawns real child processes |
| Validation at boundaries only | conventions.md | Zod-parse OAuth callback query params + token-endpoint response in `oauth.ts`; internal types trusted |
| From Phase 1 onward: never push directly to `main` | CLAUDE.md §Branch policy | All Phase 2 work lands via worktree + branch + PR |
| No emoji, no banned tone words | ADR-0005 | OAuth success/error pages and CLI text outputs run through banned-word lint |
| One concept per file; tests next to source as `<name>.test.ts` | conventions.md | `oauth.test.ts`, `token-store.test.ts` co-located |

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| OAuth authorization-code exchange | infrastructure/whoop/oauth.ts | services/auth.service.ts (thin orchestration) | OAuth state-machine is an integration concern — belongs at the infrastructure boundary, not in domain or transports |
| Loopback HTTP server for redirect URI | infrastructure/whoop/oauth.ts (helper) | cli/commands/auth.ts (lifecycle owner) | Server is OAuth-specific; lives with OAuth code but lifecycle (start/stop on user-interactive command) is driven by the CLI command |
| Token persistence (keyring vs file) | infrastructure/whoop/token-store.ts | infrastructure/config/paths.ts (file paths) | Storage abstraction; both backends behind one `read()`/`write()`/`clear()` surface |
| Storage-mode detection + cache | infrastructure/whoop/token-store.ts | — | Backend selection is part of the store's contract |
| In-process single-flight gate | infrastructure/whoop/token-store.ts (module-level state) | — | Module-level `Promise<Tokens> \| null` is a token-store implementation detail |
| Cross-process file lock | infrastructure/whoop/token-store.ts (via `proper-lockfile`) | — | Same module owns both gates so the locking discipline is local to one file |
| Atomic temp-and-rename write | infrastructure/whoop/token-store.ts (file backend only) | — | Atomic writes are file-backend only; keyring backend doesn't need them |
| `getValidAccessToken()` surface | infrastructure/whoop/token-store.ts | infrastructure/whoop/client.ts (Phase 3 consumer) | Exposed as the only refresh-bearing surface; ADR-0002 enforces single consumer |
| Refresh-token HTTP call | infrastructure/whoop/token-store.ts (under the lock) | — | ADR-0002 §Enforcement: "Token-store module is the only consumer of the refresh endpoint" |
| OAuth state + (optional) PKCE generation | infrastructure/whoop/oauth.ts | — | Crypto primitives via `node:crypto`; no library dependency |
| `init` config bootstrap | cli/commands/init.ts | infrastructure/config/paths.ts | Interactive prompts + atomic config.json write; no service layer needed (config writes are simple I/O) |
| `auth` OAuth orchestration | cli/commands/auth.ts | infrastructure/whoop/oauth.ts + token-store.ts | Command shim wires the OAuth state machine into the loopback server lifecycle |
| Doctor auth-state check | services/doctor/checks/auth.ts | infrastructure/whoop/token-store.ts (reads storage-mode + presence) | Check is offline-safe — does not refresh, does not call WHOOP |
| Doctor token-freshness check | services/doctor/checks/token-freshness.ts | infrastructure/whoop/token-store.ts (reads tokens) | Reads `expires_at`, compares to `Date.now()` |
| MCP error sanitization for auth errors | src/mcp/register.ts + src/mcp/sanitize.ts (Phase 1) | — | No new MCP tier work; Phase 1's wrapper already handles every `whoop_doctor` error path |
| MCP `whoop_doctor` tool surface | src/mcp/tools/whoop-doctor.ts (Phase 1 unchanged) | services/doctor/index.ts (extended with two new checks) | Tool is a 5-line shim; new doctor checks are picked up transparently |

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `@napi-rs/keyring` | `^1.3.0` (already in package.json) | OS keychain for token storage | `[VERIFIED: npm view @napi-rs/keyring version → 1.3.0]` Drop-in keytar replacement; keytar archived 2022-12. Active Rust binding via `keyring-rs`. `[CITED: github.com/Brooooooklyn/keyring-node]` |
| `proper-lockfile` | `^4.1.2` | Cross-process advisory lock | `[VERIFIED: npm view proper-lockfile version → 4.1.2 — note: last published 2022-06-24, the API is stable]` Used by npm itself and many other CLIs; mtime-refresh stale detection works on macOS + Linux. `[CITED: github.com/moxystudio/node-proper-lockfile]` Library is mature/stable rather than freshly updated — this is acceptable for a coordination primitive whose contract has not changed. |
| `open` | `^11.0.0` | Cross-platform browser launch | `[VERIFIED: npm view open version → 11.0.0]` Sindre Sorhus' canonical package; handles macOS (`open`), Linux (`xdg-open`), Windows (`start`). Throws on failure → we catch and fall back to print-URL. |
| `commander` | `^14.0.3` (already in package.json) | CLI framework | Phase 1 picked it; `init` and `auth` subcommands follow the same shape as Phase 1's `doctor` |
| `zod` | `^4.4.3` (already in package.json) | Runtime validation | Validate OAuth callback query params (`code`, `state`, `error`) and token-endpoint response (`access_token`, `refresh_token`, `expires_in`, ...) |
| `pino` | `^10.3.1` (already in package.json) | Structured logging → stderr | Per ADR-0001; oauth and token-store modules log via the shared `logger` from `src/infrastructure/config/logger.ts` |
| `@modelcontextprotocol/sdk` | `^1.29.0` (already in package.json) | MCP server SDK | No new tools in Phase 2; just consumed by the doctor tool's pickup of new checks |
| Native `fetch` (Node 22) | built-in | HTTP for OAuth token-exchange + refresh | `[CITED: developer.whoop.com/docs/tutorials/refresh-token-javascript]` WHOOP's own docs use raw fetch + URLSearchParams. ADR-0007 means we GET-only for the API client; token endpoint POSTs are isolated to `oauth.ts`. |
| Native `node:crypto` | built-in | `randomBytes` for state + PKCE verifier; `createHash` for S256 challenge | Standard library; no third-party dep |
| Native `node:net` / `node:http` | built-in | Loopback HTTP server on `127.0.0.1:<port>` | Standard library; `http.createServer().listen(port, '127.0.0.1')` is the canonical pattern |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `msw` | `^2.14.6` | HTTP mocking in tests | `[VERIFIED: npm view msw version → 2.14.6]` Intercepts WHOOP token endpoint; per-call counter for concurrency tests. Add as devDependency in Phase 2 — not yet in package.json. |
| `arctic` | `^3.7.0` | OAuth2 library (fallback only) | `[VERIFIED: npm view arctic version → 3.7.0]` Reserved per STACK.md: pull in only if hand-rolled OAuth code exceeds ~80 LOC. **Not adopted by default for Phase 2** — hand-rolled fits per ADR-0002 (single-flight is hand-rolled regardless). |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `proper-lockfile` | `lockfile` (Isaac Schlueter, older) | `proper-lockfile` is the moxystudio fork that is more actively maintained AND ships the mtime-refresh stale detection. `lockfile` is sticky-stale only — would require manual unlinking on crash recovery. |
| `proper-lockfile` | Native `fs.openSync(path, 'wx')` + flock | `O_EXCL` (`'wx'`) gives atomic create-or-fail but no built-in stale recovery. flock(2) is unavailable on Windows; macOS doesn't ship `flock(1)`. proper-lockfile abstracts this cleanly. ADR-0002 §Alternatives already rejects `flock(1)`. |
| `proper-lockfile` | `async-mutex` | `async-mutex` is in-process only. We need cross-process. |
| `@napi-rs/keyring` | `keytar` | Archived 2022-12-15 per STACK.md §What NOT to Use. Hard veto. |
| `@napi-rs/keyring` | `keyring` (Rust CLI wrapped via child_process) | Spawning a child per read = 40ms+ latency on every API call. Native binding is the right answer. |
| `open` | `child_process.spawn('open' \| 'xdg-open' \| 'start')` | Re-implementing what `open` already does correctly; would need to handle the Linux fallback chain (`xdg-open` → `gnome-open` → ...) ourselves. `open` is the boring-and-correct pick. |
| Hand-rolled OAuth | `arctic@3.7.0` | Arctic's `OAuth2Client` would work but doesn't address the single-flight refresh problem — we'd still hand-roll the gate. STACK.md §Pattern: hand-rolled is RECOMMENDED for v1. |
| Hand-rolled OAuth | `simple-oauth2` | Callback-era ergonomics; STACK.md §What NOT to Use: hard veto. |
| Hand-rolled OAuth | `openid-client` | OIDC-heavy; WHOOP is plain OAuth2. STACK.md §What NOT to Use: hard veto. |

**Installation:**
```bash
npm install proper-lockfile@^4.1.2 open@^11.0.0
npm install -D msw@^2.14.6 @types/proper-lockfile
```

**Version verification (run 2026-05-12):**
- `@napi-rs/keyring@1.3.0` — `[VERIFIED: npm view @napi-rs/keyring version]`
- `proper-lockfile@4.1.2` — `[VERIFIED: npm view proper-lockfile version]` (last published 2022-06-24)
- `open@11.0.0` — `[VERIFIED: npm view open version]`
- `msw@2.14.6` — `[VERIFIED: npm view msw version]`
- `arctic@3.7.0` (bench-only) — `[VERIFIED: npm view arctic version]`

## Architecture Patterns

### System Architecture Diagram

```
                       OAuth onboarding (one-time)
   ┌──────────────────────────────────────────────────────────────┐
   │                                                              │
   │  user shell  ──►  recovery-ledger init                       │
   │                       │                                      │
   │                       ▼                                      │
   │     prompts (Commander) ──► writes ~/.recovery-ledger/       │
   │                              ├── config.json (mode 0600)     │
   │                              └── (no tokens written yet)     │
   │                                                              │
   │  user shell  ──►  recovery-ledger auth [--no-browser]        │
   │                       │                                      │
   │                       ▼                                      │
   │     cli/commands/auth.ts                                     │
   │       │                                                      │
   │       │   1. random `state` (crypto.randomBytes 32)          │
   │       │   2. (if PKCE) random `verifier` + S256 challenge    │
   │       │   3. http.createServer().listen(port, '127.0.0.1')   │
   │       │   4. open(authorizeUrl) OR print URL                 │
   │       │                                                      │
   │       ▼                                                      │
   │     loopback server  ◄── browser ──►  WHOOP authorize page   │
   │       │                                                      │
   │       │  GET /?code=...&state=...                            │
   │       │  ├─ validate state                                   │
   │       │  ├─ render 200 HTML success page                    │
   │       │  ├─ resolve a deferred Promise<{code}>              │
   │       │  └─ close server                                    │
   │       ▼                                                      │
   │     oauth.exchangeCode({code, redirect_uri, verifier?})     │
   │       │                                                      │
   │       │   POST api.prod.whoop.com/oauth/oauth2/token        │
   │       │     grant_type=authorization_code                   │
   │       │     code=...&client_id=...&client_secret=...        │
   │       │     redirect_uri=...&code_verifier=...?              │
   │       ▼                                                      │
   │     tokenStore.write({...response, expires_at: now+ttl})    │
   │       └── via keyring OR atomic file write (mode 0600)      │
   │       └── writes storage-mode cache                          │
   │                                                              │
   └──────────────────────────────────────────────────────────────┘

                       Steady-state runtime (Phase 3 consumer)
   ┌──────────────────────────────────────────────────────────────┐
   │                                                              │
   │  any caller  ──►  tokenStore.getValidAccessToken()           │
   │                       │                                      │
   │                       ▼                                      │
   │     ┌─────────────────────────────────────────┐              │
   │     │  read current tokens (keyring or file)  │              │
   │     │  if !expiringSoon → return access_token │              │
   │     └────────────────┬────────────────────────┘              │
   │                      │ expiring or expired                   │
   │                      ▼                                       │
   │     ┌─────────────────────────────────────────┐              │
   │     │  GATE 1: in-process Promise<Tokens>     │              │
   │     │  if inFlight !== null → await inFlight  │              │
   │     │  else: inFlight = doRefresh().finally(  │              │
   │     │            () => { inFlight = null }    │              │
   │     │          )                              │              │
   │     └────────────────┬────────────────────────┘              │
   │                      │                                       │
   │                      ▼                                       │
   │     ┌─────────────────────────────────────────┐              │
   │     │  GATE 2: proper-lockfile.lock(          │              │
   │     │    tokens.json.lock,                    │              │
   │     │    {retries: {retries: 10, factor: 1.2, │              │
   │     │      minTimeout: 50},                   │              │
   │     │      stale: 5000})                      │              │
   │     │  ─► re-read tokens after lock           │              │
   │     │     (sibling process may have refreshed)│              │
   │     │  ─► if still expired, POST oauth/token  │              │
   │     │      grant_type=refresh_token           │              │
   │     └────────────────┬────────────────────────┘              │
   │                      │                                       │
   │                      ▼                                       │
   │     ┌─────────────────────────────────────────┐              │
   │     │  GATE 3: atomic write                   │              │
   │     │  - keyring: Entry.setPassword(blob)     │              │
   │     │  - file:                                │              │
   │     │      writeFile(tokens.json.tmp,         │              │
   │     │                blob, {mode: 0o600})     │              │
   │     │      fd.sync()                          │              │
   │     │      rename(tokens.json.tmp,            │              │
   │     │             tokens.json)                │              │
   │     └────────────────┬────────────────────────┘              │
   │                      │                                       │
   │                      ▼                                       │
   │     release lock; return new access_token                    │
   │                                                              │
   └──────────────────────────────────────────────────────────────┘

                       Error sanitization (unchanged from Phase 1)
   ┌──────────────────────────────────────────────────────────────┐
   │  any error from oauth.ts / token-store.ts thrown via         │
   │  MCP whoop_doctor tool → register.ts wrapper catches         │
   │  → sanitize(serializeError(err)) → MCP CallToolResult        │
   │  with isError: true (Phase 1 D-07/D-08 unchanged)            │
   └──────────────────────────────────────────────────────────────┘
```

### Recommended Project Structure
```
src/
├── cli/
│   ├── commands/
│   │   ├── doctor.ts             # EXISTS (Phase 1)
│   │   ├── init.ts               # NEW — config bootstrap (D-01/D-02)
│   │   └── auth.ts               # NEW — OAuth flow shim (D-08..D-12)
│   └── index.ts                  # EXISTS — extend with .command('init') + .command('auth')
├── infrastructure/
│   ├── config/
│   │   ├── logger.ts             # EXISTS (Phase 1)
│   │   └── paths.ts              # NEW — resolves ~/.recovery-ledger/ and env override
│   └── whoop/                    # NEW DIRECTORY in Phase 2
│       ├── oauth.ts              # NEW — authorize URL build, code exchange, refresh POST
│       ├── oauth.test.ts         # NEW
│       ├── token-store.ts        # NEW — keyring/file backends + single-flight gate
│       ├── token-store.test.ts   # NEW — 10-promise concurrency test (D-23a)
│       └── errors.ts             # NEW — AuthError discriminated union
├── mcp/
│   ├── sanitize.ts               # EXISTS (Phase 1) — code= and client_secret already covered; add tests only
│   ├── sanitize.test.ts          # EXTEND — D-20 positive/negative cases for code= and client_secret
│   └── register.ts               # EXISTS — unchanged; Phase 2 errors flow through automatically
├── services/
│   └── doctor/
│       ├── index.ts              # EXTEND — add auth + token-freshness to PROBE_NAMES + Promise.allSettled call
│       └── checks/
│           ├── check-names.ts    # EXTEND — add AUTH_CHECK + TOKEN_FRESHNESS_CHECK
│           ├── native-modules.ts # EXISTS
│           ├── mcp-stdout-purity.ts  # EXISTS
│           ├── auth.ts           # NEW (D-21.1)
│           └── token-freshness.ts    # NEW (D-21.2)
└── formatters/
    └── doctor.txt.ts             # EXISTS — handles arbitrary check names; no change needed

tests/
├── integration/
│   └── auth-concurrency.test.ts  # NEW — D-23b cross-process two-child-process test
└── fixtures/
    ├── oauth/
    │   ├── token-200.json        # NEW — happy-path refresh response
    │   ├── token-400-invalid-grant.json  # NEW — refresh-token reuse / family revocation
    │   └── authorize-callback.html  # NEW — fixture for state-mismatch tests
    └── whoop/                    # (already implied by Phase 3; Phase 2 uses oauth/ subdir)

scripts/
└── ci-grep-gates.sh              # EXTEND — add Gate E for "only token-store.ts may POST to oauth/token"

.github/
└── workflows/
    └── ci.yml                    # EXTEND — matrix: [macos-latest, ubuntu-latest]; Linux runs RECOVERY_LEDGER_FORCE_FILE_STORE=1
```

### Pattern 1: Single-Flight Refresh — Three-Layer Gate (ADR-0002)

**What:** Module-level `Promise<Tokens> | null` (in-process) + `proper-lockfile` (cross-process) + `fs.rename` after `fs.fsync` (atomic).
**When to use:** Every refresh path. There is no second path. ADR-0002 §Enforcement: one consumer of the refresh endpoint.
**Example:**
```typescript
// src/infrastructure/whoop/token-store.ts (sketch — ASSUMED unchanged from ADR-0002 + STACK.md)
// Source: ADR-0002 + ARCHITECTURE.md §Pattern 4

import { setTimeout as delay } from 'node:timers/promises';
import * as lockfile from 'proper-lockfile';
import { Entry } from '@napi-rs/keyring';
import { writeFile, rename, mkdir } from 'node:fs/promises';
import { logger } from '../config/logger.js';

export const REFRESH_BUFFER_MS = 5 * 60 * 1000; // D-14: refresh when within 5 min of expiry

let inFlightRefresh: Promise<Tokens> | null = null;

export async function getValidAccessToken(): Promise<string> {
  const current = await readTokens();
  if (current && !isExpiringSoon(current, Date.now())) {
    return current.accessToken;
  }
  // GATE 1: in-process single-flight
  if (inFlightRefresh === null) {
    inFlightRefresh = doRefresh(current).finally(() => {
      inFlightRefresh = null;
    });
  }
  const refreshed = await inFlightRefresh;
  return refreshed.accessToken;
}

async function doRefresh(stale: Tokens | null): Promise<Tokens> {
  // GATE 2: cross-process advisory lock
  const release = await lockfile.lock(LOCKFILE_PATH, {
    retries: { retries: 10, factor: 1.2, minTimeout: 50 },
    stale: 5000,
  });
  try {
    // Re-read after acquiring lock — a sibling process may have already refreshed.
    const fresh = await readTokens();
    if (fresh && !isExpiringSoon(fresh, Date.now())) {
      logger.debug('refresh skipped — sibling process refreshed');
      return fresh;
    }
    const next = await callRefreshEndpoint(stale ?? fresh!);
    // GATE 3: atomic write
    await writeTokensAtomic(next);
    return next;
  } finally {
    await release();
  }
}
```

### Pattern 2: Atomic Temp-and-Rename Write

**What:** Write to `tokens.json.tmp` in the same directory as `tokens.json` → `fd.sync()` → `rename(tmp, final)`. Same directory is critical: rename is atomic only within a single filesystem.
**When to use:** Every persist of token blob to the file backend. Never to keyring (`Entry.setPassword` is the atomic write for that backend).
**Example:**
```typescript
// Source: ADR-0002 §Decision + ARCHITECTURE.md §Configuration / Paths
// [CITED: nodejs.org/api/fs.html#fspromiseswritefilefile-data-options]
// [ASSUMED] — sketch derived from ADR-0002 + ARCHITECTURE.md; not yet implemented

import { open, rename } from 'node:fs/promises';

async function writeTokensAtomic(tokens: Tokens): Promise<void> {
  const tmp = `${TOKENS_PATH}.tmp`;
  const blob = JSON.stringify(tokens);
  const fd = await open(tmp, 'w', 0o600);
  try {
    await fd.writeFile(blob);
    await fd.sync(); // critical: forces fsync before rename so a crash can't leave a 0-byte file
  } finally {
    await fd.close();
  }
  await rename(tmp, TOKENS_PATH); // atomic on macOS + Linux when src and dst are on the same FS
}
```

**Why `open(...0o600)` not `writeFile(...{mode: 0o600})`:**
`writeFile`'s `mode` option only applies if the file is *created* — if `tokens.json.tmp` already exists from a prior crashed write, the mode is preserved verbatim. Using `open` with the mode argument forces 0600 on every create.

### Pattern 3: OAuth Authorization Code Flow on Loopback

**What:** Bind `127.0.0.1:<configured-port>` (default 4321 from D-01), launch user's browser to WHOOP authorize URL, wait for the redirect callback, validate state, exchange code for tokens.
**When to use:** `recovery-ledger auth` only.
**Example:**
```typescript
// Source: ARCHITECTURE.md §Pattern 4 + WHOOP OAuth docs
// [CITED: developer.whoop.com/docs/developing/oauth/]
// [VERIFIED: standard RFC 6749 §4.1 Authorization Code Grant pattern]
// [ASSUMED] sketch:

import { createServer } from 'node:http';
import { randomBytes, createHash } from 'node:crypto';
import openBrowser from 'open';

interface RunOAuthOptions {
  clientId: string;
  clientSecret: string;
  redirectPort: number;
  scopes: string[];
  noBrowser?: boolean;
  timeoutMs?: number; // D-10: default 300_000
  usePkce?: boolean;  // D-12: feature-flag; depends on WHOOP support
}

export async function runOAuth(opts: RunOAuthOptions): Promise<Tokens> {
  const state = randomBytes(32).toString('base64url'); // D-11: CSRF
  const verifier = opts.usePkce ? randomBytes(64).toString('base64url') : null;
  const challenge = verifier ? base64url(createHash('sha256').update(verifier).digest()) : null;
  const redirectUri = `http://127.0.0.1:${opts.redirectPort}/callback`;

  const { url: authorizeUrl } = buildAuthorizeUrl({
    clientId: opts.clientId,
    redirectUri,
    scopes: opts.scopes,
    state,
    challenge,
  });

  const codePromise = listenForCallback(opts.redirectPort, state, opts.timeoutMs ?? 300_000);

  if (!opts.noBrowser) {
    try {
      await openBrowser(authorizeUrl);
    } catch {
      logger.warn('browser auto-open failed; falling back to copy-paste');
      process.stderr.write(`Open this URL in a browser:\n${authorizeUrl}\n`);
    }
  } else {
    process.stderr.write(`Open this URL in a browser:\n${authorizeUrl}\n`);
  }

  const code = await codePromise; // throws AuthError on state mismatch or timeout

  return exchangeCode({ code, redirectUri, verifier, clientId: opts.clientId, clientSecret: opts.clientSecret });
}
```

The loopback server (in `listenForCallback`) renders the D-09 HTML pages and resolves a deferred Promise on receipt of the callback. A 5-minute `AbortController` (D-10) rejects with `AuthError({kind:'auth_timeout'})` if no callback arrives. The same server tears itself down via `server.close()` immediately after resolving the Promise.

### Pattern 4: Token-Store as Sole Consumer of Refresh Endpoint

**What:** ADR-0002 §Enforcement: a Biome `noRestrictedImports` rule (or a ci-grep-gate, per Phase 1 D-14) forbids `fetch` calls to the WHOOP token endpoint outside `src/infrastructure/whoop/token-store.ts`.
**When to use:** Every other source file in the repo. Token-store is the single chokepoint.
**Example (Biome config sketch):**
```jsonc
// biome.json (extension)
// Source: ADR-0002 §Enforcement
{
  "linter": {
    "rules": {
      "style": {
        "noRestrictedImports": {
          "level": "error",
          "options": {
            "paths": {
              // ...existing entries
              // Concept: any direct fetch of oauth/oauth2/token from non-token-store files
              // is more naturally enforced via the ci-grep-gate (Gate E):
              //   grep -rn "oauth/oauth2/token" src/ | grep -v token-store.ts && exit 1
            }
          }
        }
      }
    }
  }
}
```

The grep-gate addition to `scripts/ci-grep-gates.sh` (CONTEXT.md "Established Patterns" line 144) is the load-bearing enforcement; Biome's `noRestrictedImports` is on import paths, not on raw URL strings, so it doesn't naturally cover this.

### Anti-Patterns to Avoid

- **Double-refresh: refresh on EVERY API call "to be safe."** Burns refresh tokens; WHOOP rotates the family and revokes on stale-token reuse. (STACK.md §Anti-Patterns; PITFALLS.md Pitfall 2.) Use 5-minute pre-expiry buffer + 401 reactive only.
- **Skipping the in-process gate "because the file lock catches it."** The file-lock acquire-release has 50-200ms latency; 10 concurrent in-process callers would each pay it. Single-flight makes the file-lock latency amortize to once per refresh event.
- **Writing tokens to stdout for any reason.** Stdout in MCP-reachable code is JSON-RPC only (ADR-0001). `recovery-ledger auth` is CLI-only (not MCP-reachable), so it CAN write to stdout — but the token blob never appears in user-visible output; only `Authorization complete.` does.
- **Storing tokens in SQLite.** PITFALLS.md Pitfall 4: token files in the cache DB are readable by any local process that opens the DB. Keyring + chmod 600 file is the non-negotiable boundary.
- **Falling back to keyring if file write fails (or vice-versa).** Backend selection happens **once** at first successful `auth` and is cached in `storage-mode`. Mixing backends mid-session means tokens can be written to one place and read from another → guaranteed lost-tokens bug.
- **Trusting `expires_in` from the response without server-time skew handling.** Compute `expires_at = obtained_at + expires_in * 1000`; `obtained_at = Date.now()` captured **before** the POST. WHOOP's clock vs ours can drift; the 5-minute pre-expiry buffer absorbs typical NTP skew (< 100ms in practice).
- **Logging the raw refresh-endpoint response body.** Even with Pino → stderr, a future log scraper picks tokens up. Phase 1's sanitize.ts already covers the JSON / URL / form shapes; any log line that constructs a string with token material must run through `sanitize()` before emit.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Cross-process file locking | `fs.openSync(path, 'wx')` + manual retry + stale detection | `proper-lockfile` | `wx` gives create-or-fail but not mtime-refresh stale detection; `flock(1)` isn't on macOS; `flock(2)` syscall is unavailable on Windows. proper-lockfile abstracts all three. (ADR-0002 §Alternatives) |
| Cross-platform OS keychain access | `child_process` to `security` (macOS) / `secret-tool` (Linux) | `@napi-rs/keyring` | Per-call spawn = 40ms latency; STDERR parsing is fragile; Windows Credential Vault has no CLI. (STACK.md §What NOT to Use; PITFALLS.md Pitfall 4) |
| Cross-platform browser launch | `child_process.spawn('open' / 'xdg-open' / 'start')` | `open` (sindresorhus) | Linux's `xdg-open` → `gnome-open` → `kde-open` → `wslview` chain is non-trivial; `open` handles it. (CONTEXT D-08) |
| OAuth2 token-endpoint POST shape | `axios` / `simple-oauth2` / `openid-client` | Native `fetch` + `URLSearchParams` | WHOOP's own tutorial uses raw fetch; all three alternatives are heavier and don't solve the single-flight problem. (STACK.md §Anti-recommendation) |
| CSRF state + PKCE verifier | Custom RNG / UUID library | `node:crypto` `randomBytes` + `createHash('sha256')` | Standard library; correct entropy source; no dep |
| HTTP loopback server | `express` / `koa` / `fastify` | `node:http.createServer` | One route, one request, server.close() after — express is ~80KB of dep for zero gain (ARCHITECTURE.md §Pattern 4) |
| Atomic file write | Custom temp-and-rename | Same recipe, hand-written ~10 lines | Hand-rolled is fine here — `write-file-atomic` (npm) would be the alternative but it's ~150 LOC for what we can do in ~10. Hand-write the 10 lines and skip the dep. (Edge: do NOT use `write-file-atomic` without verifying it `fsync`s; older versions don't.) |
| JWT parsing | `jsonwebtoken` / `jose` | We don't parse JWTs. | We never **verify** WHOOP's JWTs — we just pass `access_token` to WHOOP as Bearer auth. We use `expires_at` from the token-endpoint response, not from JWT `exp` claim. (PITFALLS.md Pitfall 14 specifically warns about Zod-transform fidelity; this is the simpler "don't add complexity" angle.) |
| Discriminated-union error types | Custom error classes | Plain TS discriminated union | Convention from ARCHITECTURE.md §Error model; AuthError lives in `errors.ts` as `type AuthError = { kind: 'auth_missing' } \| { kind: 'auth_expired' } \| ...` |

**Key insight:** The hardest parts of Phase 2 — the three-layer single-flight gate and the keyring/file backend split — are concentrated in ~150 LOC across two files (`token-store.ts` + `oauth.ts`). Hand-rolling them is **cheaper than integrating any library**, because every library either (a) doesn't solve the single-flight + rotation problem, (b) is heavier than the code it would replace, or (c) is unmaintained. The Phase 2 dependency footprint adds exactly two runtime packages (`proper-lockfile`, `open`) and one devDep (`msw`).

## Runtime State Inventory

> Phase 2 is greenfield code creation — no rename, refactor, or string-replace concerns. **Section omitted** (no runtime state to migrate). The only state Phase 2 *writes* for the first time is `~/.recovery-ledger/{config.json,tokens.json,tokens.json.lock,storage-mode}` (D-03 through D-07), and those have no prior version to migrate from.

## Common Pitfalls

### Pitfall A: Double-refresh family revocation (PITFALLS Pitfall 2)
**What goes wrong:** Two processes (CLI sync + MCP server) both hit a 401, both refresh, WHOOP detects refresh-token-family reuse and revokes the entire family. User is forced to re-auth.
**Why it happens:** Without the cross-process gate (or with a broken in-process gate), refresh requests race. WHOOP rotates refresh tokens — first refresh wins, second refresh presents a now-invalid token, WHOOP applies RFC 6819 §5.2.2.3 reuse detection.
**How to avoid:** ADR-0002's three-layer gate, exactly as specified. Cross-process gate via `proper-lockfile`; in-process gate via module-level `Promise<Tokens> | null`. The integration test (D-23.2) is load-bearing verification.
**Warning signs:**
- `invalid_grant` or `refresh_token_reused` from WHOOP token endpoint
- User is forced to re-auth more than weekly
- Two simultaneous syncs both succeed but only one is authenticated afterward

### Pitfall B: Stale lock from crashed refresh holder
**What goes wrong:** A process holds the `tokens.json.lock` and crashes (SIGKILL, OOM, power loss) without releasing. Subsequent processes time out waiting for the lock.
**Why it happens:** `proper-lockfile` periodically `utimes`-refreshes its lock file. A process killed before its next refresh leaves a stale lock. Without staleness handling, every subsequent caller waits forever.
**How to avoid:** Set `stale: 5000` (ms) in `proper-lockfile.lock()` options — after 5s without mtime refresh, the lock is considered abandoned and any waiter can claim it. `[VERIFIED: github.com/moxystudio/node-proper-lockfile README — default stale is 10000ms with 5000ms minimum]`. ADR-0002 specifies `stale: 5000` literally; we use the documented minimum.
**Warning signs:**
- `recovery-ledger doctor` reports "auth check timed out"
- `tokens.json.lock` exists with old mtime
- User reports "auth keeps hanging" after a crash

### Pitfall C: Token leak via OAuth callback URL in stderr
**What goes wrong:** Loopback server receives `GET /?code=eyJ...&state=...`. A debug log statement logs the request URL verbatim. The `code` is now in stderr / log files for the lifetime of the install.
**Why it happens:** OAuth callback URLs carry the authorization code in plain query string; default access logs include the path.
**How to avoid:**
- Phase 1's `SECRET_KEY_NAMES` array **already includes `code`** (line 29 of sanitize.ts) — the existing sanitizer catches `?code=...&` and `&code=...` patterns. CONTEXT D-19's "code= in query strings" requirement is already satisfied; Phase 2 owes only the test fixtures (D-20).
- Do not log the raw callback URL in `oauth.ts`. Log only `{state, hasCode: boolean}`.
- Defense-in-depth: any string passed to `logger.info / debug / warn` from oauth.ts or token-store.ts is run through `sanitize()` before emit. (Phase 1 sanitize.ts is pure-function and safe to re-call.)

### Pitfall D: Same-dir vs cross-dir rename for atomicity
**What goes wrong:** Writing `tokens.json.tmp` in `/tmp/` and renaming to `~/.recovery-ledger/tokens.json` fails — `EXDEV` cross-device link error — or worse, succeeds via a non-atomic copy.
**Why it happens:** `fs.rename` is atomic only within a single filesystem.
**How to avoid:** Always write `tokens.json.tmp` **in the same directory** as `tokens.json` (i.e., `~/.recovery-ledger/tokens.json.tmp`). `[CITED: nodejs.org/api/fs.html#fspromisesrenameoldpath-newpath]`.
**Warning signs:**
- `EXDEV: cross-device link not permitted` in stderr
- Token file appears empty or partially written after a crash

### Pitfall E: Storage-mode flipping mid-session
**What goes wrong:** Process A writes via keyring. Process B can't reach the keychain (Linux without libsecret loaded mid-session) and falls back to file. Now tokens live in two places; one is stale.
**Why it happens:** Backend detection done lazily on every read.
**How to avoid:** D-05's `storage-mode` cache file. Detection happens **once** at `auth` time and is cached. Subsequent reads check the cache, not the live keychain. Doctor's `auth` check reads the cache without probing the keychain.
**Warning signs:**
- Doctor reports `auth: keychain` but token reads keep returning null
- A `tokens.json` file appears on macOS where keyring should be primary
- Re-auth produces tokens in a different backend than the prior session

### Pitfall F: `Entry.setPassword()` swallows OS-level errors silently
**What goes wrong:** On some Linux configurations, the Secret Service D-Bus interface is present but returns an opaque error from `setPassword`. Our code interprets "no error" as "wrote successfully" → tokens are silently lost.
**Why it happens:** `[ASSUMED]` keyring-node's error surface from `keyring-rs` may not distinguish "backend present but write failed" from "wrote and read back successfully." The keyring-rs README mentions backend-specific error variants but the napi binding's surface is not exhaustively documented.
**How to avoid:** After `setPassword`, immediately call `getPassword()` and verify the returned blob matches what was written (byte-equal). If mismatch, treat as a fallback trigger and write to the file backend. Update `storage-mode` to `file`. This is a defense-in-depth check we own; ADR-0002 doesn't mandate it but it's cheap.
**Warning signs:**
- `auth` reports success but `getValidAccessToken()` immediately returns `auth_missing`
- Doctor reports `auth: keychain` but no tokens are returned

### Pitfall G: Loopback port collision (D-01 default 4321 in use)
**What goes wrong:** Port 4321 is already bound by another process. `recovery-ledger auth` fails with `EADDRINUSE`.
**Why it happens:** Port 4321 is the locked default per D-01; not dynamically chosen at auth time. A user running another tool on 4321 collides.
**How to avoid:**
- `init` documents that the port is configurable.
- `auth` on `EADDRINUSE` emits a clear error: "Port {port} in use. Re-run `recovery-ledger init` and choose a different port, then register the new redirect URI in your WHOOP developer app."
- Do NOT silently fall back to a different port — that would invalidate the registered redirect URI and produce a worse error from WHOOP's authorize page (`redirect_uri_mismatch`).

### Pitfall H: WHOOP scope-string drift (D-13 research item)
**What goes wrong:** We request `read:body_measurement` but WHOOP requires `read:measurements` or has bundled it into `read:all`. The authorize page rejects our request or grants a different scope set than expected.
**Why it happens:** `[ASSUMED]` Scope vocabulary across providers varies; WHOOP's docs don't enumerate the full scope list in the OAuth page (we confirmed this via direct fetch on 2026-05-12 — only `offline` is explicitly named).
**How to avoid:**
- Verify scope strings against `developer.whoop.com/api/` (the API reference rather than the OAuth tutorial). Each endpoint should list required scope.
- If WHOOP returns `invalid_scope`, the error surfaces in the loopback callback as `?error=invalid_scope&error_description=...` — surface this to the user with the exact rejected scope.
- During `init`, print the scope list with a note: "If WHOOP rejects these, see the troubleshooting guide for the current scope names" (deferred to Phase 5 install guide).

### Pitfall I: PKCE feature-flag drift (D-12 research item)
**What goes wrong:** We enable PKCE; WHOOP doesn't support it. The token-endpoint POST silently ignores `code_verifier` (good) OR rejects with `invalid_request` (bad).
**Why it happens:** `[ASSUMED]` WHOOP's OAuth docs at `developer.whoop.com/docs/developing/oauth/` do not mention PKCE — direct WebFetch on 2026-05-12 confirmed PKCE is not documented. Confidential clients (like ours, with `client_secret`) don't *require* PKCE per RFC 6749, but a server may still accept it harmlessly.
**How to avoid:** Ship PKCE OFF by default in Phase 2. Add a probe (deferred to a Phase 5 doctor check or research bench): make one auth attempt with PKCE on a test app; if WHOOP returns `unsupported_response_type` or similar, lock PKCE off in code. If the probe is green, flip it on in a future hardening pass.
**Decision rationale:** D-12 says "if WHOOP supports PKCE" — the conservative answer with the current evidence is "ship without it; document as a hardening item." CSRF state (D-11) is the load-bearing defense for the loopback flow.

### Pitfall J: Zod-schema parse error on token-endpoint response
**What goes wrong:** WHOOP returns a 200 but with a body shape we didn't anticipate (e.g., adds a new field, omits `refresh_token` on a refresh-only call). Our Zod schema rejects.
**Why it happens:** WHOOP may evolve their response shape independently of v2 endpoint compatibility.
**How to avoid:**
- Use `z.object({...}).passthrough()` on the response schema — accept unknown extra fields without failing.
- Required fields: `access_token`, `expires_in`, `refresh_token`, `scope`, `token_type`. `[CITED: developer.whoop.com/docs/tutorials/refresh-token-javascript — confirmed response shape]`
- On parse failure, throw `AuthError({kind: 'refresh_failed', cause: zodError.issues})` — the cause chain runs through the Phase 1 sanitizer before reaching MCP.

## Code Examples

Verified patterns from official sources and existing repo code:

### OAuth Authorization URL Build
```typescript
// Source: developer.whoop.com/docs/developing/oauth/ + RFC 6749 §4.1.1
// [CITED: developer.whoop.com — authorize URL = api.prod.whoop.com/oauth/oauth2/auth]
// [ASSUMED] PKCE params included conditionally; PKCE support TBD per Pitfall I

interface BuildAuthorizeUrlInput {
  clientId: string;
  redirectUri: string;       // http://127.0.0.1:<port>/callback
  scopes: string[];          // D-13 — confirm strings against WHOOP API ref
  state: string;             // base64url(randomBytes(32))
  challenge: string | null;  // base64url(sha256(verifier)) if PKCE
}

export function buildAuthorizeUrl(input: BuildAuthorizeUrlInput): { url: string } {
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: input.clientId,
    redirect_uri: input.redirectUri,
    scope: input.scopes.join(' '),
    state: input.state,
  });
  if (input.challenge) {
    params.set('code_challenge', input.challenge);
    params.set('code_challenge_method', 'S256');
  }
  return { url: `https://api.prod.whoop.com/oauth/oauth2/auth?${params}` };
}
```

### OAuth Code Exchange (POST to token endpoint)
```typescript
// Source: developer.whoop.com/docs/tutorials/refresh-token-javascript/
// [CITED: WHOOP — token endpoint expects application/x-www-form-urlencoded]

import { z } from 'zod';

const TokenResponseSchema = z.object({
  access_token: z.string(),
  refresh_token: z.string(),
  expires_in: z.number().int().positive(),
  scope: z.string(),
  token_type: z.literal('bearer'),
}).passthrough();

export async function exchangeCode(input: {
  code: string;
  redirectUri: string;
  clientId: string;
  clientSecret: string;
  verifier: string | null; // PKCE if non-null
}): Promise<Tokens> {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code: input.code,
    redirect_uri: input.redirectUri,
    client_id: input.clientId,
    client_secret: input.clientSecret,
  });
  if (input.verifier) body.set('code_verifier', input.verifier);

  const obtainedAt = Date.now();
  const res = await fetch('https://api.prod.whoop.com/oauth/oauth2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  if (!res.ok) {
    // Body excerpt for diagnosis — sanitize.ts will redact any token material in the cause chain
    const text = await res.text();
    throw new AuthError({ kind: 'refresh_failed', detail: `token endpoint ${res.status}: ${text}` });
  }
  const parsed = TokenResponseSchema.parse(await res.json());
  return {
    accessToken: parsed.access_token,
    refreshToken: parsed.refresh_token,
    tokenType: 'bearer',
    scope: parsed.scope,
    obtainedAt,
    expiresAt: obtainedAt + parsed.expires_in * 1000,
  };
}
```

### Loopback Callback Server
```typescript
// Source: ARCHITECTURE.md §Pattern 4; D-09 HTML content; D-10 timeout; D-11 state check
// [ASSUMED] sketch — not yet implemented

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { setTimeout as delay } from 'node:timers/promises';

const SUCCESS_HTML =
  '<!doctype html><meta charset="utf-8"><title>Recovery Ledger — auth complete</title>' +
  '<h1>Authorization complete.</h1><p>You can close this window and return to your terminal.</p>';

function failureHtml(redactedDetail: string): string {
  return (
    '<!doctype html><meta charset="utf-8"><title>Recovery Ledger — auth failed</title>' +
    `<h1>Authorization failed</h1><pre>${escapeHtml(redactedDetail)}</pre>` +
    '<p>Return to your terminal and run <code>recovery-ledger auth</code> again.</p>'
  );
}

export async function listenForCallback(
  port: number,
  expectedState: string,
  timeoutMs: number,
): Promise<{ code: string }> {
  return new Promise((resolve, reject) => {
    const ac = new AbortController();
    const server = createServer((req, res) => handleCallback(req, res, expectedState, resolve, reject));
    server.on('error', reject);
    server.listen(port, '127.0.0.1');

    delay(timeoutMs, undefined, { signal: ac.signal })
      .then(() => {
        server.close();
        reject(new AuthError({ kind: 'auth_timeout' }));
      })
      .catch(() => { /* aborted on success — ignore */ });

    // When resolve/reject fires, abort the timer and close the server
    const closeOnSettle = () => { ac.abort(); server.close(); };
    Promise.resolve()
      .then(() => closeOnSettle)
      .catch(() => closeOnSettle);
  });
}

// handleCallback: parse query, validate state, render HTML, call resolve(code) or reject(AuthError)
```

### Phase 1 sanitize.ts (already covers code= and client_secret)
```typescript
// Source: src/mcp/sanitize.ts (read on 2026-05-12), lines 18-30
// [VERIFIED: file exists at /Users/chris.bremmer/recovery-ledger/src/mcp/sanitize.ts]

export const SECRET_KEY_NAMES = [
  'access_token',
  'refresh_token',
  'client_secret',   // ✓ covers D-19.2
  'id_token',
  'session_token',
  'api_key',
  'api_token',
  'secret',
  'password',
  'private_key',
  'code',            // ✓ covers D-19.1 — already in the list
] as const;
```

**Implication for Phase 2:** D-19's "two new patterns" requirement is **already structurally satisfied** by Phase 1. The Phase 2 sanitizer work reduces to: (a) confirming via test fixtures (D-20) that the existing patterns redact the OAuth-specific shapes correctly; (b) adding the "errors that historically leak" fixture from D-20 (an OAuth callback failure with `code=eyJ...` and `client_secret=hunter2` in a cause chain). No regex changes needed.

### Doctor auth check
```typescript
// Source: D-21.1 + existing checks/native-modules.ts pattern
// [ASSUMED] sketch following Phase 1's DoctorCheck contract

import type { DoctorCheck } from '../index.js';
import { CHECK_NAMES } from './check-names.js';
import { readStorageMode } from '../../../infrastructure/whoop/token-store.js';

export async function probeAuth(): Promise<DoctorCheck> {
  const mode = await readStorageMode(); // 'keychain' | 'file' | null
  if (!mode) {
    return {
      name: CHECK_NAMES.AUTH,
      status: 'fail',
      detail: 'no tokens — run `recovery-ledger auth`',
    };
  }
  // Verify the stored mode actually has retrievable tokens (don't refresh)
  const present = await areTokensPresent(mode);
  if (!present) {
    return { name: CHECK_NAMES.AUTH, status: 'fail', detail: `mode=${mode} but tokens missing` };
  }
  return {
    name: CHECK_NAMES.AUTH,
    status: 'pass',
    detail: mode === 'keychain' ? 'auth: keychain' : 'auth: file (mode 0600)',
  };
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `keytar` for keychain access | `@napi-rs/keyring` | atom org archived keytar 2022-12-15 | All new TS projects must use `@napi-rs/keyring`; STACK.md hard-vetos keytar |
| `simple-oauth2` / `openid-client` for OAuth2 helpers | Hand-rolled `fetch` + `URLSearchParams` | WHOOP's single-flight rotation rule makes library helpers a net negative | Phase 2 hand-rolls oauth.ts; arctic@3.7.0 stays on the bench |
| SQLite advisory lock for cross-process refresh coordination | `proper-lockfile` (file advisory lock) | STATE.md §Decisions: "ADR-0002 supersedes STACK.md's earlier SQLite-advisory-lock proposal" | Token store no longer requires DB readiness on every API call |
| `node-keytar` direct child_process spawn | Native NAPI binding | `@napi-rs/keyring` shipped before keytar's archive | Avoid 40ms-per-call spawn overhead |
| `openssl` shell-out for crypto | `node:crypto` `webcrypto` / `randomBytes` | Stable since Node 16 | No external dependency for state generation |
| `dotenv` for env loading | Node 20.6+ native `--env-file=.env` | STACK.md §What NOT to Use | Phase 2 reads env directly; `WHOOP_CLIENT_ID` / `WHOOP_CLIENT_SECRET` come from the user's shell or config.json |

**Deprecated/outdated:**
- `keytar` — archived; do not use
- `simple-oauth2` — callback-era ergonomics, doesn't solve concurrency
- `openid-client` — OIDC overkill for plain OAuth2
- SQLite advisory lock for tokens — ADR-0002 supersedes
- `node-keytar` — same archive as `keytar`

## Assumptions Log

> Claims tagged `[ASSUMED]` in this research. The planner and discuss-phase use this section
> to flag decisions that need user confirmation before execution.

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | WHOOP does NOT support PKCE — based on absence of PKCE mention in `developer.whoop.com/docs/developing/oauth/` (verified via WebFetch 2026-05-12) | Pitfall I + D-12 | If WHOOP DOES support PKCE, we ship without an extra defense layer. CSRF state (D-11) still protects against the loopback CSRF threat. Recommended path: ship PKCE OFF, schedule a one-time probe as a Phase 5 hardening task. |
| A2 | WHOOP's exact scope vocabulary (`read:recovery`, `read:sleep`, `read:workout`, `read:cycles`, `read:profile`, `read:body_measurement`) is correct as named in D-13. WHOOP's OAuth page only documents `offline`; the read scopes are inferred. | Pitfall H + D-13 | If scope names are wrong, authorize-page rejection on first user run. Mitigation: surface the rejected scope verbatim via the loopback failure HTML so the user can update D-13 against the actual rejection message. Action: confirm against `developer.whoop.com/api/` endpoint reference before Phase 2 task creation, OR build a doctor check that round-trips a tiny test scope. |
| A3 | `@napi-rs/keyring` `Entry.setPassword()` throws synchronously when no backend is available — D-05 relies on this for fallback triggering | Token Storage + Pitfall F | If the failure is silent (returns void without writing), we silently lose tokens. Mitigation: the read-after-write verification step in Pitfall F catches both cases. |
| A4 | WHOOP refresh-token response shape (`access_token`, `refresh_token`, `expires_in`, `scope`, `token_type`) is the same as the auth-code exchange response | OAuth code exchange + Pitfall J | Phase 2 uses one TypeScript schema for both. If they diverge, Zod throws on parse — visible failure, not silent. |
| A5 | `proper-lockfile@4.1.2` is the current published version and is API-stable. It was last published 2022-06-24 — that's old, but the API contract is mature. | Standard Stack §Core | If a fork or replacement emerges, we'd want to follow. None visible as of 2026-05-12. Risk is low because the API surface is small and mtime-refresh is the only mechanism. |
| A6 | Hand-rolled atomic temp-and-rename writer is correct on macOS + Linux when src/dst are in the same directory. Cross-platform Windows note deferred. | Pattern 2 | macOS-first project per CONTEXT.md / scope. Windows support deferred to v2. |
| A7 | The Phase 1 `register.ts` wrapper sanitizes both throw-path AND success-path string leaves (per the MR-12 comment block). Phase 2 auth errors automatically pick up this sanitization without any new wiring. | MCP integration | Phase 1 code read; behavior is verified via the existing sanitize.test.ts. Risk is low. |
| A8 | The OAuth callback URL path is `/callback` (not `/oauth/callback` or similar). The exact path is configurable — we'll standardize on `/callback`. | Loopback server | The path is set by us; we register it in the WHOOP developer dashboard. As long as `init`'s printed instructions match the auth-time URL, no risk. |
| A9 | `redirect_port` default of 4321 (D-01) does not conflict with common dev-tool defaults. Quick survey: 4321 is used by some Vite legacy configs and a few obscure servers; not a frequent collision. | Pitfall G | If it collides, user reconfigures via `init`. The error surfaces clearly via `EADDRINUSE`. |
| A10 | The cross-process integration test (D-23.2) can be deterministically structured with `pool: 'forks'` + a shared MSW server in the parent that both child processes hit. **The exact pattern is non-trivial.** | Test approach + Validation Architecture | If MSW cannot intercept fetch across spawned Node processes (it intercepts via `fetch` patching, which is per-process), each child needs its own MSW handler that COUNTS via a shared IPC channel back to the parent. Mitigation: use a real HTTP server bound to `127.0.0.1:<port>` for the integration test (not MSW) and have both children hit that — see Validation Architecture §Cross-Process Test. |

## Open Questions (RESOLVED)

> Each question carries both a `Recommendation:` (researcher's original guidance) and a `RESOLVED:` line added during plan-checker revision iteration 1, pinning how the current 8-plan set resolves, defers, or accepts the gap.

1. **WHOOP scope-string vocabulary (A2 / D-13)**
   - What we know: WHOOP docs name only `offline` explicitly; reasonable inference from API conventions and ARCHITECTURE.md gives the six read scopes.
   - What's unclear: Whether `read:body_measurement` is the correct spelling, or `read:measurements`, or bundled into something else.
   - Recommendation: Before Phase 2 implementation, fetch `developer.whoop.com/api/` and grep for `scope` / `Authorization` / `read:` mentions per endpoint reference. If unable to confirm offline, plan for the loopback failure HTML to surface the rejected scope verbatim, and add a one-time `init`-time integration probe (against a fresh test app) as a Phase 5 hardening task.
   - RESOLVED: Plan 02-03 (revision iteration 1, per checker BLOCKER 4 / OPEN-Q-01) implements a narrowed OAuth error-code response policy: the callback handler now RENDERS the verbatim `error_description` (after sanitize+escapeHtml) for `invalid_scope`, `invalid_request`, `unsupported_response_type` — so a D-13 scope-vocabulary mismatch surfaces WHOOP's exact rejection message to the user. Opaque error codes (`server_error`, `access_denied`, `unauthorized_client`, `temporarily_unavailable`, default) STRIP the description as defense-in-depth. Plan 02-03 tests OE-01..09 verify both arms, including the explicit BLOCKER 4 acceptance fixture `?error=invalid_scope&error_description=foo` → failureHtml contains `foo`. The Phase 5 hardening probe remains as a follow-up task but is no longer load-bearing for first-run UX.

2. **PKCE support (A1 / D-12)**
   - What we know: PKCE is not documented at `developer.whoop.com/docs/developing/oauth/` (verified 2026-05-12).
   - What's unclear: Whether WHOOP silently accepts PKCE params on a confidential-client request (harmless extra), or rejects with `invalid_request`.
   - Recommendation: Ship PKCE OFF by default. The 32-byte CSRF state (D-11) plus the loopback's `127.0.0.1` binding cover the practical CSRF surface for a confidential client. Add a manual probe to the Phase 5 install guide ("test if WHOOP rejects code_challenge=..."); if it doesn't, future hardening can flip the flag.
   - RESOLVED: Plan 02-03 ships `usePkce: false` as the default on the `RunOAuthOptions` interface (the recommendation accepted as-is). The `usePkce: true` path is implemented and unit-tested (Test U-03, X-04 in Plan 02-03) so a future hardening pass can flip the default with one config change. The Phase 5 manual probe is deferred and not load-bearing for Phase 2 ship.

3. **Cross-process integration-test mechanics (A10)**
   - What we know: MSW intercepts `fetch` via per-process patching. Spawning two child processes means two MSW setups.
   - What's unclear: Whether a shared-MSW-in-parent + handler-in-each-child + IPC counter would work, or whether the cleaner path is a real `http.createServer` mock that both children hit.
   - Recommendation: Use a real loopback HTTP server in the parent for the integration test (bound to a random `127.0.0.1:0` port). The parent owns the counter; both children fetch the parent's URL via a `WHOOP_TOKEN_URL_OVERRIDE` env var. The unit-level test (D-23.1) uses MSW; the cross-process integration test uses the real mini-server. (Both tests are fixture-only with respect to real WHOOP per ADR-0006.)
   - RESOLVED: Plan 02-08 implements exactly the recommendation: parent `http.createServer` bound to `127.0.0.1:0` + 10 `fork()`ed children + `WHOOP_TOKEN_URL` env override (Plan 02-02 reads it via `process.env.WHOOP_TOKEN_URL ?? '<canonical>'` at module load). MSW is used at the unit level (Plan 02-02's token-store.test.ts) per D-23.1. Plan 02-08's Wave-0 build-dep verification (added in revision iteration 1 per checker WARNING PLAN-08-BUILD-DEP) ensures `dist/infrastructure/whoop/token-store.mjs` exists before children fork.

4. **Sanitizer test fixture for OAuth errors (D-20)**
   - What we know: D-20 specifies a fixture: `OAuth callback failed` with `code=eyJ...` and `client_secret=hunter2` in cause chain.
   - What's unclear: Where the fixture lives — inline in `sanitize.test.ts` or as a JSON file?
   - Recommendation: Inline as a string literal in the test file. The fixture is one Error chain; making it a JSON file adds indirection without coverage gain. Phase 1's sanitize.test.ts already uses inline fixtures (verified by file structure).
   - RESOLVED: Plan 02-07 implements the recommendation verbatim: the D-20 fixture is appended as an inline `describe('F7'...)` block in `src/mcp/sanitize.test.ts`. No JSON file is created. Plan 02-07 also adds the F6 positional matrix and three negative cases, and explicitly attests to D-18 (register.ts unchanged) in must_haves.truths.

5. **Should `init` write `storage-mode` immediately, or only `auth`?**
   - What we know: D-05 says `auth` writes `storage-mode` "on first successful token persist."
   - What's unclear: Whether `init` should write a default `storage-mode` of "unknown" or omit the file entirely.
   - Recommendation: Omit. `auth` writes it on first success. `doctor`'s `auth` check treats "file absent" as "no auth yet" which is correct behavior pre-auth. Keeps `init` purely about config and not about runtime state.
   - RESOLVED: Plan 02-05 implements the recommendation: `runInitCommand` does NOT write `storage-mode`. Plan 02-02's `tokenStore.write` is the only writer (Test B-01..04 in Plan 02-02 verifies). Plan 02-06's `probeAuth` treats the absent file as `'fail'` with detail `'no tokens — run \`recovery-ledger auth\`'` (Test AU-01).

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js >= 22.11 | Everything (Phase 1 already requires) | ✓ (assumed from Phase 1 completion) | 22+ | — |
| npm | install step | ✓ | n/a | — |
| `@napi-rs/keyring` runtime | Primary token storage | ✓ (already in package.json deps; Phase 1 doctor verified it loads) | 1.3.0 | File backend via D-05 |
| macOS Keychain backend (libsecret on Linux) | `@napi-rs/keyring` setPassword/getPassword to succeed | Conditional | n/a | File backend via D-05 (intentional design point) |
| `proper-lockfile` | Cross-process gate | ✗ (NEEDS install) | will be 4.1.2 | — (no fallback; required by ADR-0002) |
| `open` | Browser auto-launch in `auth` | ✗ (NEEDS install) | will be 11.0.0 | `--no-browser` print-URL fallback already designed (D-08) |
| `msw` | Test interception | ✗ (NEEDS install as devDep) | will be 2.14.6 | — (required for fixture-only tests per ADR-0006) |
| WHOOP developer app + client_id/client_secret | `auth` flow | User-provided | n/a | — (BYO OAuth per PROJECT.md) |
| Loopback port 4321 free | `auth` server | Conditional | n/a | User reconfigures via `init` |
| `~/.recovery-ledger/` writable | Config + tokens + lockfile | ✓ (filesystem) | n/a | — |
| GitHub Actions matrix `ubuntu-latest` | D-25 Linux fallback test | ✓ (free GitHub-hosted) | n/a | — |

**Missing dependencies with no fallback:**
- `proper-lockfile@^4.1.2` — `npm install proper-lockfile`
- `open@^11.0.0` — `npm install open`
- `msw@^2.14.6` — `npm install -D msw`
- `@types/proper-lockfile` — `npm install -D @types/proper-lockfile`

**Missing dependencies with fallback:**
- libsecret on Linux — already designed-for (D-05 file fallback is the intentional path)

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest `^4.1.6` (already installed; pinned by Phase 1) |
| Config file | `vitest.config.ts` (exists from Phase 1; `pool: 'forks'` already set) |
| Quick run command | `vitest run src/infrastructure/whoop/token-store.test.ts` |
| Full suite command | `npm run test` (resolves to `vitest run`) |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| AUTH-01 | `recovery-ledger init` writes config.json mode 0600 from prompts + env-var precedence | unit | `vitest run src/cli/commands/init.test.ts` | ❌ Wave 0 — create `src/cli/commands/init.test.ts` |
| AUTH-01 | `init` prints WHOOP-app instructions verbatim (D-02 lines) | unit | (same as above) | ❌ Wave 0 |
| AUTH-02 | `auth` runs loopback OAuth, exchanges code, persists tokens via state-mismatch / timeout / happy path | unit (component) | `vitest run src/cli/commands/auth.test.ts` and `vitest run src/infrastructure/whoop/oauth.test.ts` | ❌ Wave 0 |
| AUTH-03 | Token store reads/writes via keyring (mocked) and falls back to file on `setPassword` throw | unit | `vitest run src/infrastructure/whoop/token-store.test.ts` | ❌ Wave 0 |
| AUTH-03 | Doctor `auth` check returns `keychain` / `file` / `missing` correctly | unit | `vitest run src/services/doctor/checks/auth.test.ts` | ❌ Wave 0 |
| AUTH-04 | `getValidAccessToken()` triggers refresh on 5-min-buffer and on 401 + retries once | unit | `vitest run src/infrastructure/whoop/token-store.test.ts` (refresh-trigger arms) | ❌ Wave 0 |
| AUTH-05 | 10 parallel `Promise.all([getValidAccessToken,...])` → exactly one MSW token-endpoint hit (in-process gate) | unit | `vitest run src/infrastructure/whoop/token-store.test.ts -t "single-flight"` | ❌ Wave 0 |
| AUTH-05 | Two child processes calling `getValidAccessToken()` against a shared HTTP mock → exactly one hit (cross-process gate) | integration | `vitest run tests/integration/auth-concurrency.test.ts` | ❌ Wave 0 — create `tests/integration/` directory + the test |
| AUTH-05 | Token file appears under `tokens.json.tmp` then renamed to `tokens.json`; tmp absent after success (atomic write) | unit | (same as token-store.test.ts) | ❌ Wave 0 |
| AUTH-06 | OAuth callback failure HTML and `cause`-chained errors with `code=eyJ...` + `client_secret=hunter2` are redacted | unit | `vitest run src/mcp/sanitize.test.ts -t "OAuth callback"` | ❌ Wave 0 — extend existing test file with D-20 fixture |
| AUTH-06 | `grep -rE "Bearer\\s+[A-Za-z0-9._/+=-]{10,}\|eyJ[A-Za-z0-9._-]{20,}\|Authorization:" logs/ stderr-capture/ mcp-error-returns/` → 0 matches under induced 401/500 | integration | extension of MCP subprocess test from Phase 1 (`test/integration/mcp-stdout-purity.test.ts`) — add an auth-error induction step | ❌ Wave 0 — extend existing integration test |

### Sampling Rate
- **Per task commit:** `vitest run src/infrastructure/whoop/` (fastest feedback; ~2s)
- **Per wave merge:** `npm run test` (full Vitest run, including integration; ~5-10s)
- **Phase gate:** Full suite green + `bash scripts/ci-grep-gates.sh` + Linux row of CI matrix green before `/gsd-verify-work`

### Wave 0 Gaps
- [ ] `src/infrastructure/whoop/oauth.ts` + `oauth.test.ts` — covers AUTH-01, AUTH-02
- [ ] `src/infrastructure/whoop/token-store.ts` + `token-store.test.ts` — covers AUTH-03, AUTH-04, AUTH-05 (unit half)
- [ ] `src/infrastructure/whoop/errors.ts` — AuthError discriminated union
- [ ] `src/infrastructure/config/paths.ts` — `~/.recovery-ledger/` resolver + `RECOVERY_LEDGER_HOME` override
- [ ] `src/cli/commands/init.ts` + `init.test.ts` — covers AUTH-01
- [ ] `src/cli/commands/auth.ts` + `auth.test.ts` — covers AUTH-02
- [ ] `src/services/doctor/checks/auth.ts` + `auth.test.ts` — covers AUTH-03 doctor surface
- [ ] `src/services/doctor/checks/token-freshness.ts` + `token-freshness.test.ts` — D-21.2
- [ ] `tests/integration/auth-concurrency.test.ts` — load-bearing for AUTH-05 (D-24)
- [ ] `test/fixtures/oauth/token-200.json`, `token-400-invalid-grant.json` — shared OAuth fixtures
- [ ] Extension to `src/mcp/sanitize.test.ts` — D-20 OAuth-cause-chain fixture
- [ ] Extension to `test/integration/mcp-stdout-purity.test.ts` — induce auth 401 and re-grep stderr
- [ ] Extension to `src/services/doctor/checks/check-names.ts` — `AUTH`, `TOKEN_FRESHNESS` constants
- [ ] Extension to `src/services/doctor/index.ts` — add probes to `Promise.allSettled` call and `PROBE_NAMES`
- [ ] Extension to `scripts/ci-grep-gates.sh` — Gate E: only `token-store.ts` may POST to `oauth/oauth2/token`
- [ ] Extension to `.github/workflows/ci.yml` — `ubuntu-latest` row with `RECOVERY_LEDGER_FORCE_FILE_STORE=1` (D-25)
- [ ] Devdep install: `npm install -D msw@^2.14.6 @types/proper-lockfile`
- [ ] Runtime dep install: `npm install proper-lockfile@^4.1.2 open@^11.0.0`

### Test-Mechanism Recipes (load-bearing for AUTH-05)

**(a) MSW handler with per-call counter (unit-level D-23.1):**
```typescript
// Source: msw 2.x docs + standard counter pattern
// [VERIFIED: msw 2.14.6 supports the http.post handler API]
import { setupServer } from 'msw/node';
import { http, HttpResponse } from 'msw';

let refreshHitCount = 0;
const handlers = [
  http.post('https://api.prod.whoop.com/oauth/oauth2/token', () => {
    refreshHitCount += 1;
    return HttpResponse.json({
      access_token: `fresh-${refreshHitCount}`,
      refresh_token: `next-${refreshHitCount}`,
      expires_in: 3600,
      scope: 'offline read:recovery',
      token_type: 'bearer',
    });
  }),
];
const server = setupServer(...handlers);

beforeAll(() => server.listen());
afterAll(() => server.close());
beforeEach(() => { refreshHitCount = 0; });

it('10 parallel callers hit refresh endpoint exactly once', async () => {
  // seed an expired token in the store
  await tokenStore.write({ /* expires_at: Date.now() - 1000 */ });
  const promises = Array.from({ length: 10 }, () => tokenStore.getValidAccessToken());
  const results = await Promise.all(promises);
  expect(refreshHitCount).toBe(1);
  expect(new Set(results).size).toBe(1); // all callers see the same fresh token
});
```

**(b) Cross-process test via real HTTP mock (integration D-23.2):**
```typescript
// [ASSUMED] sketch — implementation lives in tests/integration/auth-concurrency.test.ts
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { fork } from 'node:child_process';

it('two processes refresh exactly once across the lock boundary', async () => {
  let count = 0;
  const mockServer = createServer((req, res) => {
    if (req.method === 'POST' && req.url === '/oauth/oauth2/token') {
      count += 1;
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ access_token: `fresh-${count}`, refresh_token: 'r', expires_in: 3600, scope: 'offline', token_type: 'bearer' }));
    }
  });
  await new Promise((r) => mockServer.listen(0, '127.0.0.1', () => r(null)));
  const { port } = mockServer.address() as { port: number };
  const env = { ...process.env, WHOOP_TOKEN_URL: `http://127.0.0.1:${port}/oauth/oauth2/token`, RECOVERY_LEDGER_HOME: tmpDir };

  const childA = fork('./test/helpers/get-valid-access-token.mjs', [], { env });
  const childB = fork('./test/helpers/get-valid-access-token.mjs', [], { env });
  const [resA, resB] = await Promise.all([waitForExit(childA), waitForExit(childB)]);

  expect(count).toBe(1);
  expect(resA.token).toBe(resB.token);

  mockServer.close();
});
```
The `WHOOP_TOKEN_URL` env var is a **test-only** override that token-store reads via `process.env.WHOOP_TOKEN_URL ?? 'https://api.prod.whoop.com/oauth/oauth2/token'`. Ship-time it's never set; only the integration test sets it.

**(c) Atomic-write assertion:**
```typescript
import { stat } from 'node:fs/promises';

it('tokens.json.tmp does not exist after successful write', async () => {
  await tokenStore.write({ /* ... */ });
  await expect(stat(`${tmpDir}/tokens.json.tmp`)).rejects.toThrow(/ENOENT/);
  const main = await stat(`${tmpDir}/tokens.json`);
  expect((main.mode & 0o777)).toBe(0o600);
});
```

**(d) Keyring mocking without touching real OS:**
```typescript
// vitest.config.ts adds an alias OR uses vi.mock
import { vi } from 'vitest';

vi.mock('@napi-rs/keyring', () => {
  const store = new Map<string, string>();
  return {
    Entry: class {
      constructor(private service: string, private account: string) {}
      setPassword(p: string) { store.set(`${this.service}:${this.account}`, p); }
      getPassword() { return store.get(`${this.service}:${this.account}`) ?? ''; }
      deletePassword() { store.delete(`${this.service}:${this.account}`); }
    },
  };
});
```
For the file-fallback arm, set `process.env.RECOVERY_LEDGER_FORCE_FILE_STORE = '1'` per D-25 to skip the keyring attempt entirely.

**(e) `grep -v Bearer` assertion across stderr + log files + MCP error returns:**
```typescript
import { readFile, readdir } from 'node:fs/promises';

const FORBIDDEN = /Bearer\s+[A-Za-z0-9._/+=-]{10,}|eyJ[A-Za-z0-9._-]{20,}|Authorization:/g;

it('induced 401 leaves no token material in any surface', async () => {
  // capture stderr from the subprocess
  // ... drive MCP whoop_doctor with an auth-expired state ...
  expect(stderrCapture).not.toMatch(FORBIDDEN);
  for (const f of await readdir(logsDir)) {
    expect(await readFile(`${logsDir}/${f}`, 'utf8')).not.toMatch(FORBIDDEN);
  }
  for (const errorReturn of mcpErrorReturnsCaptured) {
    expect(JSON.stringify(errorReturn)).not.toMatch(FORBIDDEN);
  }
});
```
This is success criterion #4 verbatim. It piggybacks on the Phase 1 subprocess test by adding an auth-error induction step before the grep.

## Security Domain

Security enforcement is implied for this project (no explicit `security_enforcement: false` in `.planning/config.json`). The phase is fundamentally a security boundary (OAuth + token storage + leak prevention), so the analysis is load-bearing.

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | yes | OAuth 2.0 Authorization Code flow per RFC 6749 §4.1; client_secret confidentiality enforced by file permissions (0600) and env-var precedence |
| V3 Session Management | yes | "Session" = OAuth access-token lifetime (~1h per WHOOP); refresh-token rotation per RFC 6749 §6 + RFC 6819 §5.2.2.3 reuse detection (WHOOP enforces); local-only — no cross-machine session |
| V4 Access Control | yes (n/a — single user) | Single-user personal tool; access control is OS-level file permissions (0600 on config.json + tokens.json + storage-mode + tokens.json.lock) |
| V5 Input Validation | yes | Zod-parse OAuth callback query params (`code`, `state`, `error`); Zod-parse token-endpoint JSON response; state-string equality via constant-time? — see Threat Patterns below |
| V6 Cryptography | yes | `node:crypto.randomBytes(32)` for state; `node:crypto.randomBytes(64)` + `createHash('sha256')` for PKCE (when enabled); never hand-roll any crypto; tokens stored opaque (we don't encrypt or verify JWTs) |
| V7 Error Handling & Logging | yes | All errors flow through `src/mcp/sanitize.ts` from Phase 1 (covers `Bearer`, JWT shape, Authorization header, query params, form body, JSON keys); logs go to stderr only per ADR-0001 |
| V8 Data Protection | yes | Tokens at rest: keyring primary, `chmod 600` file fallback (AUTH-03); `client_secret` at rest mode 0600; no plaintext-token-in-SQLite (out of scope but called out in PITFALLS Pitfall 4) |
| V9 Communications | yes | All WHOOP traffic over HTTPS (`api.prod.whoop.com`); native fetch honors system CA; no certificate pinning (not required for a confidential client) |
| V11 Business Logic | yes | Single-flight refresh enforces "one refresh per family rotation" — failure mode is reasoned-about, not accidental |
| V14 Configuration | yes | Env-var override > file value (D-06); no secrets in `package.json`; `RECOVERY_LEDGER_HOME` permits sandboxed test setup |

### Known Threat Patterns for this stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| OAuth refresh-token-family revocation via concurrent refresh | Repudiation / DoS | ADR-0002 three-layer single-flight gate (in-process + cross-process + atomic write) |
| CSRF on loopback callback (a malicious local page tricks the user's browser into hitting `127.0.0.1:4321/?code=...`) | Tampering | 32-byte random `state` (D-11) generated per-attempt via `crypto.randomBytes`; rejected on mismatch. Loopback bound to `127.0.0.1` only (not `0.0.0.0`) — no LAN reach. |
| Authorization-code injection (attacker plants a victim's code into our callback) | Spoofing | PKCE (if enabled — A1); the loopback's `127.0.0.1`-only bind plus the random state make this practically unexploitable for a single-machine personal tool, but PKCE is the formal RFC 7636 defense |
| Token leak via error message in MCP tool result | Information Disclosure | Phase 1's `register.ts` sanitizer wraps every tool handler; `sanitize.ts` covers all the relevant key shapes already; success criterion #4 grep gate verifies |
| Token leak via stderr / log file | Information Disclosure | Pino → stderr per ADR-0001 + sanitize-before-emit pattern in `oauth.ts` and `token-store.ts` (always run logged strings through `sanitize()`) |
| Token leak via stdout from MCP-reachable code | Information Disclosure | ADR-0001 + ci-grep-gates.sh banning `console.*` and `process.stdout.write` outside `src/cli/` |
| Stale-lock denial of refresh | DoS | `proper-lockfile` `stale: 5000` ms; doctor's `auth` check surfaces lock-held conditions |
| Local-process token theft (malicious npm postinstall, sibling MCP server from different project) | Spoofing / Info Disclosure | `chmod 600` on tokens.json + config.json; keyring stores outside the cache DB; tokens NEVER in SQLite (PITFALLS Pitfall 4) |
| `tokens.json` half-written from a crash | Tampering | Atomic temp-and-rename with `fsync` before rename |
| Constant-time comparison for state | Tampering | State is a 256-bit random base64url string; timing-attack on the equality check is not a credible threat at this entropy level. Use plain `===` — RFC 6749 §10.12 doesn't require timing-safe compare for opaque state values. (If we were comparing HMACs, we'd use `crypto.timingSafeEqual`.) |
| WHOOP API certificate compromise | Spoofing | Out of scope; we trust the system trust store. No pinning. |
| Browser-launch URL injection (a malicious config sets `WHOOP_CLIENT_ID` to a value that distorts the authorize URL) | Tampering | `URLSearchParams` does the encoding correctly; we never string-concat into the URL. Zod-validate `client_id` against `/^[A-Za-z0-9_-]+$/` (a conservative shape) before building the URL. |

## Sources

### Primary (HIGH confidence)
- **CONTEXT.md** (`.planning/phases/02-oauth-token-store-single-flight-refresh/02-CONTEXT.md`) — D-01 through D-25 locked decisions, read verbatim
- **ADR-0001** (`agent_docs/decisions/0001-mcp-stdout-purity.md`) — stdout purity contract
- **ADR-0002** (`agent_docs/decisions/0002-single-flight-oauth-refresh.md`) — three-layer single-flight gate, the load-bearing ADR
- **ADR-0006** (`agent_docs/decisions/0006-fixture-only-tests.md`) — MSW fixture-only
- **ADR-0007** (`agent_docs/decisions/0007-whoop-read-only.md`) — GET-only HTTP client; informs WHOOP scope set
- **ARCHITECTURE.md** §Component Responsibilities — `infrastructure/whoop/` ownership of oauth.ts, token-store.ts
- **ARCHITECTURE.md** §Pattern 4 — single-flight token refresh pseudocode
- **STACK.md** §15-21 — `@napi-rs/keyring` 1.3.0 primary, file fallback, arctic@3.x bench-only
- **PITFALLS.md** Pitfalls 1, 2, 4, 17 — stdout corruption, concurrent refresh family revocation, plaintext-token storage, token leak via error returns
- **Existing source** `src/mcp/sanitize.ts` (lines 18-30, 38-146) — Phase 1 SECRET_KEY_NAMES + PATTERNS catalog confirmed to already cover D-19.1 (`code`) and D-19.2 (`client_secret`)
- **Existing source** `src/mcp/register.ts` — sanitize-on-throw AND sanitize-on-success-leaves wrapper (MR-12)
- **Existing source** `src/services/doctor/index.ts` — `Promise.allSettled` orchestration + `PROBE_NAMES` extension pattern + `RunDoctorOptions.skipSubprocessChecks` recursion guard
- **npm registry** queries on 2026-05-12 — `@napi-rs/keyring@1.3.0`, `proper-lockfile@4.1.2`, `open@11.0.0`, `msw@2.14.6`, `arctic@3.7.0`

### Secondary (MEDIUM confidence)
- **WHOOP OAuth docs** (`developer.whoop.com/docs/developing/oauth/`) — verified via WebFetch 2026-05-12: authorize URL = `api.prod.whoop.com/oauth/oauth2/auth`, token URL = `api.prod.whoop.com/oauth/oauth2/token`; refresh-token rotation: yes; PKCE: NOT documented (basis for assumption A1); scope names: only `offline` enumerated
- **WHOOP refresh tutorial** (`developer.whoop.com/docs/tutorials/refresh-token-javascript/`) — verified via WebFetch 2026-05-12: exact form-encoded body (`grant_type`, `client_id`, `client_secret`, `scope`, `refresh_token`), response shape (`access_token`, `refresh_token`, `expires_in`, `scope`, `token_type: 'bearer'`)
- **`proper-lockfile` README** (`github.com/moxystudio/node-proper-lockfile`) — `.lock`/`.unlock`/`.check` API; `retries`, `stale`, `update`, `lockfilePath` options; mtime-refresh stale handling; cross-platform via mkdir strategy
- **`@napi-rs/keyring` README** (`github.com/Brooooooklyn/keyring-node`) — `Entry(service, name)` constructor; `setPassword(p) / getPassword() / deletePassword()` API; keytar-compat surface

### Tertiary (LOW confidence — flagged for validation)
- **PKCE support on WHOOP** — absence of evidence; ship PKCE OFF, schedule a probe (A1)
- **Exact WHOOP scope vocabulary for read endpoints** — inference, not confirmed via API reference (A2)
- **`proper-lockfile` 4.1.2 stability** — last published 2022-06-24; API stable but the lack of recent activity is a yellow flag (A5)
- **Cross-process MSW interception** — A10; mitigation is to use a real HTTP mock for the integration test

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — every package version verified via `npm view` on 2026-05-12; APIs cross-checked against READMEs
- Architecture: HIGH — three-layer gate verbatim from ADR-0002; module layout verbatim from ARCHITECTURE.md; Phase 1 code read directly
- WHOOP-specific OAuth contract: MEDIUM-HIGH — token + authorize URL + response shape verified via WebFetch on 2026-05-12; PKCE absence and scope vocabulary are inferences (flagged in Assumptions Log)
- Pitfalls: HIGH — PITFALLS.md is exhaustive and the OAuth-specific pitfalls (2, 4, 17) are cited directly
- Single-flight test mechanics: MEDIUM — unit-level via MSW is straightforward; cross-process is non-trivial and the proposed real-HTTP-mock approach is sketched, not yet implemented
- Security domain: HIGH — ASVS coverage maps cleanly; STRIDE patterns derived from documented threats; mitigations all cited

**Research date:** 2026-05-12
**Valid until:** 2026-06-11 (30 days for stable stack; sooner if WHOOP API v2 ships breaking OAuth changes — monitor `developer.whoop.com/docs/api-changelog/`)
