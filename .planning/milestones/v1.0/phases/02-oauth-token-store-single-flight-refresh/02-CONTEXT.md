# Phase 2: OAuth, Token Store & Single-Flight Refresh - Context

**Gathered:** 2026-05-12
**Status:** Ready for planning

<domain>
## Phase Boundary

Stand up the WHOOP OAuth flow end to end and the token-store machinery that protects it from concurrency. By the end of Phase 2, `recovery-ledger init` walks the user through configuring BYO WHOOP developer credentials, `recovery-ledger auth` completes the OAuth Authorization Code flow on a loopback redirect and persists tokens, and any combination of concurrent CLI + MCP processes can call `getValidAccessToken()` without ever burning the refresh-token family. Phase 1's MCP error-sanitizer wraps every WHOOP-derived error surfaced through MCP so no token material can leak. Two `doctor` checks (auth backend, token freshness) extend the Phase 1 doctor JSON.

**Out of scope here** (later phases own them): WHOOP REST client + pagination + rate limiting (Phase 3), SQLite schema and migrations (Phase 3), sync loop (Phase 3), baselines / reviews / decisions (Phase 4), full `doctor` battery (Phase 5). Phase 2 ships exactly the surface the rest of the product needs to call the WHOOP API safely.

</domain>

<decisions>
## Implementation Decisions

### `init` vs `auth` command split
- **D-01:** Two separate commands, no auto-chain. `recovery-ledger init` is idempotent config bootstrap — prompts for `client_id`, `client_secret`, and (if WHOOP requires a registered redirect URI rather than RFC 8252 loopback) a `redirect_port` (default `4321`); writes `~/.recovery-ledger/config.json` mode 0600; prints the next-step suggestion `Next: recovery-ledger auth`. `recovery-ledger auth` is the OAuth flow itself — reads config, starts the loopback server, opens the browser, exchanges code, persists tokens. **Rationale:** separates "rotate WHOOP app credentials" (rare, config-only) from "re-authorize this install" (state-changing OAuth event). Same separation that `git init` vs `git remote set-url` enforce — both are reusable on their own, and a personal-tool user re-running `init` after a credential rotation should NOT also trigger a fresh OAuth dance.
- **D-02:** `init` prints inline WHOOP-app creation instructions as text — does not auto-open the developer portal. Lines printed: (1) link to `https://developer.whoop.com/dashboard/applications`, (2) the exact redirect URI to register (constructed from `redirect_port`), (3) the scope set Recovery Ledger will request (so the user sees the consent screen content in advance). Eliminates "wait, what redirect URI?" friction. Browser auto-open is reserved for `auth`.

### Token storage layout
- **D-03:** Config dir is `~/.recovery-ledger/` (override via `RECOVERY_LEDGER_HOME` env var). Honors the path already drafted in `research/ARCHITECTURE.md` §Configuration / Paths. XDG-compliant `~/.config/recovery-ledger/` is rejected because (a) the project ships on macOS-first where XDG is non-standard, (b) a top-level `~/.recovery-ledger/` is more discoverable for a single-user personal tool, (c) ARCHITECTURE.md already documents this path.
- **D-04:** Keyring is primary storage. `@napi-rs/keyring` stores a single JSON-serialized blob:
  ```json
  {
    "access_token": "...",
    "refresh_token": "...",
    "token_type": "bearer",
    "expires_at": 1762956000000,
    "scope": "offline read:recovery ...",
    "obtained_at": 1762952400000
  }
  ```
  - **Service name:** `recovery-ledger`
  - **Account name:** `whoop`
  - Future multi-account would migrate to `whoop:<user-id>` but v1 is single-account.
- **D-05:** File fallback at `~/.recovery-ledger/tokens.json` mode 0600 — same JSON shape as the keyring blob. The fallback is triggered when `Entry.setPassword()` throws — on Linux without libsecret, in Docker without a session bus, on SSH-only sessions on macOS, etc. `doctor` reports `auth: keychain` vs `auth: file` so regressions are visible. Detection happens once at `auth` time and is cached in `~/.recovery-ledger/storage-mode` (single-line: `keychain` or `file`) so subsequent reads don't probe the keyring on every call.
- **D-06:** Config at `~/.recovery-ledger/config.json` mode 0600 (client_secret is sensitive — keep it off-mode-644 even though it's not as exfiltratable as a token). Env-var overrides at runtime: `WHOOP_CLIENT_ID`, `WHOOP_CLIENT_SECRET` win over file values; `RECOVERY_LEDGER_HOME` redirects the entire dir.
- **D-07:** Lock target at `~/.recovery-ledger/tokens.json.lock` regardless of storage backend — `proper-lockfile` needs a file to coordinate on, and the lock file is just a coordination point, never read for content. When tokens live in keyring, the lockfile still exists; it's a `touch`ed empty file. Documented in ADR-0002 as the canonical location.

### Loopback OAuth callback UX
- **D-08:** Auto-open the browser via `open` (sindresorhus' cross-platform `open` package). On failure (no DISPLAY, headless SSH, `xdg-open` not found), gracefully fall back to printing the authorize URL with a copy-paste prompt. The fallback is the same code path used for `--no-browser` (a flag we ship for headless workflows on day one).
- **D-09:** Render minimal HTML on the redirect target. Success page (HTTP 200): `<title>Recovery Ledger — auth complete</title>` + `<h1>Authorization complete.</h1><p>You can close this window and return to your terminal.</p>`. Failure page (HTTP 400): `<title>Recovery Ledger — auth failed</title>` + `<h1>Authorization failed</h1><pre>{redacted_error}</pre><p>Return to your terminal and run <code>recovery-ledger auth</code> again.</p>`. **No CSS, no JS, no external assets.** The error block runs through the Phase 1 sanitizer before being inserted into HTML (defense-in-depth: even though the browser-facing error shouldn't contain token material, the sanitizer makes sure).
- **D-10:** Loopback server timeout is 5 minutes (300 seconds), configurable via `--timeout <seconds>` flag. On timeout: shut down the listener, exit with `auth_timeout` status and remediation "Run `recovery-ledger auth` again". Ctrl-C also cleanly shuts down the listener and removes the lock.
- **D-11:** CSRF protection via a random 32-byte (256-bit, base64url-encoded) `state` parameter, generated per-attempt with `crypto.randomBytes`. Validated on callback. Mismatch → reject with `oauth_state_mismatch` error (do NOT exchange the code) and instruct the user to re-run `auth`.
- **D-12:** PKCE is used **if WHOOP supports it** (S256 challenge over a 64-byte random verifier). Research item — confirm WHOOP v2 PKCE support against `developer.whoop.com/docs/developing/oauth/`. If WHOOP does NOT support PKCE for confidential clients with `client_secret`, document the gap and fall back to state-only protection (still acceptable for a loopback flow because the client_secret authenticates the code-exchange step).

### OAuth scopes
- **D-13:** Request the full read set up front on the consent screen — `offline read:recovery read:sleep read:workout read:cycles read:profile read:body_measurement`. Rationale: every Recovery Ledger feature needs the full set, and there is no UX gain from "least-privilege consent now, escalate later" for a single-user personal tool — WHOOP would re-prompt for consent on every scope change, which would be a worse experience than a one-time complete consent. `offline` is non-negotiable (required for refresh tokens). **Research item:** confirm the exact scope-string vocabulary against current WHOOP v2 docs — names above are my best inference from STACK.md + WHOOP API conventions; some providers spell `read:body_measurement` as `read:measurements` or expose a bundled `read:all` scope.

### Refresh trigger & retry policy (Claude's discretion → locked)
- **D-14:** Refresh trigger is **5 minutes before `expires_at`** (preemptive) OR on a 401 response (reactive). Both paths go through `getValidAccessToken()` which enforces the single-flight gate from ADR-0002. The 5-minute buffer comes from ARCHITECTURE.md §Anti-Patterns ("refresh when within 5 minutes of expiry OR after a 401"). Hard-coded constant `REFRESH_BUFFER_MS = 5 * 60 * 1000` exported from `infrastructure/whoop/token-store.ts`.
- **D-15:** On 401 from a WHOOP REST call, the wrapper does exactly one retry: re-reads tokens from storage (another process may have refreshed since), and if `expires_at` is now in the future, retries the original request with the fresh access token. If the re-read still shows the stale token, it forces a refresh through `getValidAccessToken()` and retries once more — single retry budget, then `auth_expired`. **Never retry a failed refresh** (per STACK.md §Token refresh, point 4 — retry budget of 0). A failed refresh exits with the `auth_expired` remediation; the user runs `recovery-ledger auth` again.
- **D-16:** When the in-process single-flight promise is already in-flight and a second caller arrives, it `await`s the same promise — no separate WHOOP refresh call. Per ADR-0002.

### MCP integration
- **D-17:** Phase 2 exposes **no new MCP tools** — `whoop_doctor` from Phase 1 is the only MCP-surfaced auth-aware tool, and it stays a 5-line shim over `services.runDoctor()`. The token-refresh wrapper is purely internal to `infrastructure/whoop/`. Future phases (Phase 3's `whoop_sync`, Phase 4's tool suite) consume the wrapper but Phase 2 does not add MCP tools.
- **D-18:** Any error path that bubbles through MCP (e.g., user invokes `whoop_doctor` when no tokens exist → `auth_missing` error; user invokes any tool after a refresh failure → `auth_expired` error) goes through `src/mcp/register.ts` from Phase 1, which means it goes through the sanitizer. AUTH-06 is therefore covered by Phase 1's infrastructure plus the Phase 2 sanitizer-pattern extension below.

### Sanitizer pattern extension (Phase 2 owns adding two patterns)
- **D-19:** Add two patterns to `src/mcp/sanitize.ts`:
  1. OAuth authorization code in query strings — `\bcode=([A-Za-z0-9._~-]{10,})` → keep `code=`, redact the value. Covers the case where a redirect URL or a debug log path mentions the callback URL after an OAuth failure.
  2. JSON key `client_secret` — `("client_secret"\s*:\s*")[^"]+` → keep the key, redact the value. Matches the existing `access_token` / `refresh_token` / `client_secret` pattern in Phase 1's D-07.4 (which already covers `client_secret` — verify when implementing; if Phase 1 truly listed `client_secret` in D-07.4, this becomes a no-op and only the `code=` pattern is new).
- **D-20:** Each new pattern adds a row to `sanitize.test.ts` with a positive case (token-shaped substring redacted) and a negative case (e.g., `?code=12` short enough to NOT match — the `{10,}` length guard prevents stripping the literal word `code` from natural English). Plus an "errors that historically leak" fixture: an `OAuth callback failed` error message containing both `code=eyJ...` and `client_secret=hunter2` in its `cause` chain, asserted to come out with both values redacted.

### Doctor checks added in Phase 2
- **D-21:** Add two checks to `src/services/doctor/checks/`:
  1. `auth.ts` — returns `auth: keychain | file | missing`. Status: `pass` if tokens are readable from either backend, `fail` if `missing`. Detail string mentions the backend path or keychain service name (never tokens).
  2. `token-freshness.ts` — reads tokens (without refreshing), compares `expires_at` to `Date.now()`. Status: `pass` if `expires_at > now + 5min`, `warn` if within 5min, `fail` if expired or no tokens. Detail string: `expires in 12m` / `expired 2h ago` / `no tokens`.
- **D-22:** A WHOOP roundtrip check (calls `/v2/user/profile/basic` against the real WHOOP API) is **deferred to Phase 5**. Phase 2 doctor stays offline-safe — running `doctor` cannot burn API quota or trigger a refresh as a side effect.

### Concurrent-load test design
- **D-23:** Two layers of test, both fixture-only:
  1. **Unit-level (`src/infrastructure/whoop/token-store.test.ts`):** 10 parallel `Promise.all([...])` calls to `getValidAccessToken()` against an MSW handler that counts `POST /oauth/oauth2/token` hits. Assertion: exactly one hit, all 10 promises resolve to the same `access_token` string, and the mocked refresh handler returns a *new* refresh token each call (so we can detect token-family burns).
  2. **Cross-process integration (`tests/integration/auth-concurrency.test.ts`):** spawn two child processes (one mock-CLI, one mock-MCP) that both call `getValidAccessToken()` against an MSW server running in a shared parent. Assert: refresh endpoint hit exactly once, both children read the same fresh access_token from disk (or keychain), and `proper-lockfile` held the cross-process lock for the duration of the refresh.
- **D-24:** The integration test is the load-bearing assertion for AUTH-05 and ROADMAP §Phase 2 success criterion #2. The unit test is fast feedback that runs on every `npm test`; the integration test runs in CI per phase.

### Linux fallback-path test (carried forward from Phase 1's deferred ideas)
- **D-25:** Phase 1 deferred the libsecret-less Linux test. Phase 2 owns it. Extend the GitHub Actions matrix to include `ubuntu-latest` for this phase forward, running the keyring-fallback-to-file path. The test forces fallback by setting `RECOVERY_LEDGER_FORCE_FILE_STORE=1` (an env override the storage layer respects) so we don't have to apt-uninstall libsecret in CI to exercise the fallback.

### Claude's Discretion
The user delegated all four discussion areas at once ("Discuss them all amongst yourself, come to me if there isn't a clear winner"). I worked through each and landed clear winners on all of them — no escalation. The locked decisions above (D-01 through D-25) are the result. Same pattern as Phase 1, where only the package manager (D-01) was escalated and everything else was Claude's Discretion.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Architectural Decision Records (load-bearing)
- `agent_docs/decisions/0001-mcp-stdout-purity.md` — governs how OAuth errors must NOT reach stdout from any MCP-reachable path
- `agent_docs/decisions/0002-single-flight-oauth-refresh.md` — **the** load-bearing ADR for this phase: three-layer single-flight gate (in-process Promise + `proper-lockfile` + atomic temp-and-rename), token-store module is the only refresh-endpoint consumer, no bypass code paths allowed
- `agent_docs/decisions/0006-fixture-only-tests.md` — MSW fixture-only, no live WHOOP calls in the default `npm test` run
- `agent_docs/decisions/0007-whoop-read-only.md` — informs scope set (no write scopes), informs error-handling posture

### Project policy
- `CLAUDE.md` §Critical Rules — table row 2 (single-flight OAuth refresh, ADR-0002), row 6 (fixture-only tests), row 7 (read-only WHOOP)
- `CLAUDE.md` §Branch policy — Phase 2 onward never pushes directly to `main`; PR-only flow; honored from the first commit of this phase forward (carve-out for `.planning/**`-only edits expires the moment any `src/` change lands)
- `.planning/PROJECT.md` §Key Decisions — "Read-only + BYO OAuth + no consumer-endpoint scraping" motivates BYO posture and scope set
- `.planning/REQUIREMENTS.md` §Auth — AUTH-01 through AUTH-06 verbatim (this phase's six requirements)

### Architecture & stack
- `.planning/research/STACK.md` §15-21 — `@napi-rs/keyring` 1.3.0 primary, AES-256-GCM file fallback; `arctic@3.x` fallback only if hand-rolled OAuth grows beyond ~80 LOC; **do not** use `simple-oauth2` or `openid-client`
- `.planning/research/STACK.md` §Token refresh — 4-point contract (mutex, cross-process lock, atomic write, retry budget 0 on refresh)
- `.planning/research/STACK.md` §Secrets at Rest — refresh-token-in-keychain rationale; AES-256-GCM-with-passphrase fallback shape
- `.planning/research/ARCHITECTURE.md` §Component Responsibilities — `infrastructure/whoop/` owns `oauth.ts`, `token-store.ts`, `client.ts`; `cli/` and `mcp/` are sibling driving adapters that share `services/`
- `.planning/research/ARCHITECTURE.md` §Single-flight token refresh (Anti-Pattern 1 + 2) — 5-minute pre-expiry buffer, refresh-on-401-then-retry pattern, lockfile coordination
- `.planning/research/ARCHITECTURE.md` §Configuration / Paths (lines 786-810) — `~/.recovery-ledger/` layout, atomic temp-and-rename writes, lockfile location
- `.planning/research/PITFALLS.md` (if it documents OAuth-specific pitfalls) — TBD by researcher; cited if it adds anything beyond ARCHITECTURE.md
- `.planning/research/SUMMARY.md` §Risks — concurrency #1 risk for this project; this phase owns the mitigation

### Roadmap context
- `.planning/ROADMAP.md` §Phase 2 — Goal, success criteria (4 of them), depends-on (Phase 1: sanitizer contract + native-module load verification)
- `.planning/ROADMAP.md` §Cross-Cutting Concerns row "Single-flight OAuth refresh" — Phase 2 origin, test stays in CI from Phase 2 forward
- `.planning/phases/01-foundation-stdout-pure-mcp-bootstrap/01-CONTEXT.md` — Phase 1's sanitizer wiring (D-07 through D-10), doctor JSON shape (D-06), CI platform (D-12); pattern Phase 2 extends without changing
- `.planning/STATE.md` §Decisions — confirms ADR-0002 supersedes STACK.md's earlier SQLite-advisory-lock proposal

### External references
- WHOOP for Developers — OAuth 2.0 (https://developer.whoop.com/docs/developing/oauth/) — authorization flow, scopes, refresh-token rotation rules. **Research must confirm:** (a) PKCE support, (b) exact scope-string vocabulary, (c) whether RFC 8252 loopback variable-port is accepted or a single registered redirect URI is required
- WHOOP for Developers — Refreshing Access Tokens (https://developer.whoop.com/docs/tutorials/refresh-token-javascript/) — refresh endpoint, `offline` scope requirement
- MCP TypeScript SDK — issue #1760 (https://github.com/modelcontextprotocol/typescript-sdk/issues/1760) — the canonical write-up of the refresh-token race motivating single-flight
- Nango — Concurrency with OAuth token refreshes (https://nango.dev/blog/concurrency-with-oauth-token-refreshes) — practical TS implementation patterns; consult only if hand-rolled code feels under-specified
- `proper-lockfile` README (https://github.com/moxystudio/node-proper-lockfile) — retry / stale / lockfile path API used in D-07

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- **`src/mcp/sanitize.ts`** (Phase 1, D-07) — pattern catalog of 4 regex/replacement tuples. Phase 2 extends it with 2 patterns (D-19) by adding to the exported array; no wrapping code changes.
- **`src/mcp/register.ts`** (Phase 1, D-09) — try/catch/sanitizer wrapper around every `server.registerTool` call. Phase 2 adds no new tools, but any auth-derived error that surfaces through Phase 1's `whoop_doctor` shim flows through this wrapper automatically.
- **`src/services/doctor/index.ts`** + `src/services/doctor/checks/*.ts` (Phase 1, D-05) — Phase 2 adds `checks/auth.ts` and `checks/token-freshness.ts` alongside the existing `native-modules.ts` and `mcp-stdout-purity.ts`. Same `{name, status, detail}` shape (D-06).
- **`src/services/doctor/checks/check-names.ts`** (Phase 1) — central name constants; Phase 2 adds `AUTH_CHECK` and `TOKEN_FRESHNESS_CHECK` entries.
- **`src/formatters/doctor.txt.ts`** (Phase 1, D-06) — plain-text doctor renderer. Already handles arbitrary `name`+`status`+`detail`; new checks render without formatter changes.
- **`src/infrastructure/config/logger.ts`** (Phase 1, Plan 01-02) — Pino → stderr fd 2. Token-store and oauth modules use this logger for any debug output; never write to stdout.

### Established Patterns
- **Strict TS + ESM, no default exports** (CLAUDE.md §Code Style + Phase 1) — `infrastructure/whoop/oauth.ts` and `token-store.ts` follow this verbatim.
- **Lite hexagonal** (research/ARCHITECTURE.md) — token store and OAuth client live in `src/infrastructure/whoop/`; services orchestrate; CLI and MCP shims call services only. Token-store interface is small: `getValidAccessToken()`, `clear()`, plus internals.
- **Discriminated-union errors** (research/ARCHITECTURE.md §Error model) — Phase 2 introduces `WhoopApiError` (kinds: `unauthorized`, `rate_limited`, `network`, `validation`, `server`, `unknown`) and the auth-shaped `AuthError` (kinds: `auth_missing`, `auth_expired`, `auth_state_mismatch`, `auth_timeout`, `refresh_failed`).
- **CI grep gates pattern** (Phase 1, D-04 + D-09) — Phase 2 adds a third grep gate: `grep -rn "fetch.*oauth.*token" src/ | grep -v token-store.ts` to enforce ADR-0002's "only token-store calls the refresh endpoint" rule. (ADR-0002 already specifies the Biome import-restriction rule as the primary enforcement; the grep is belt-and-suspenders.)
- **Test fixtures committed as JSON** (Phase 1, D-02 specifics §3) — Phase 2 fixtures live in `test/fixtures/oauth/` and `test/fixtures/whoop/` for token-refresh handlers + concurrent-load scenarios.
- **`pool: 'forks'` for Vitest** (Phase 1, CLAUDE.md §Testing) — needed for the cross-process integration test in `tests/integration/auth-concurrency.test.ts` to spawn real child processes without worker-thread bleed.

### Integration Points
- **CI grows a Linux row this phase** (D-25). GitHub Actions matrix: `[macos-latest, ubuntu-latest]`. Linux row runs `RECOVERY_LEDGER_FORCE_FILE_STORE=1` to exercise the fallback path; macOS row runs the keyring-primary path. Both rows run lint + build + test + the new auth-concurrency integration test.
- **`recovery-ledger doctor`** gains two checks but stays a thin CLI shim over `services.runDoctor()`. MCP's `whoop_doctor` tool transparently picks up the new checks via the same service call.
- **`recovery-ledger init`** and **`recovery-ledger auth`** are net-new Commander subcommands. They sit alongside `doctor` under `src/cli/commands/` — same 5-line-shim discipline.

</code_context>

<specifics>
## Specific Ideas

- **Storage-mode cache file (`~/.recovery-ledger/storage-mode`)** is intentionally separate from `config.json` — it's runtime-determined backend state, not user config. `init` does not write it; `auth` writes it on first successful token persist; `doctor`'s auth check reads it without probing the keychain.
- **`tokens.json.lock` location is fixed.** ADR-0002 names it; the lockfile path is hard-coded, not configurable. Reduces surface area for "lock at one path, refresh at another" bugs.
- **Sanitizer extension order matters.** New patterns (D-19) come *before* the existing JWT pattern in the array — `code=` matches before something that could look like a token-shaped substring. Document the ordering rule in `sanitize.ts` as a comment over the array.
- **`auth --no-browser` is a day-one flag**, not a deferred polish item. Required for SSH/headless workflows and for the CI integration test (which can't open a browser). Same code path as the auto-open fallback; just bypasses the `open()` call.
- **`init` is not interactive when env-var creds are present.** If both `WHOOP_CLIENT_ID` and `WHOOP_CLIENT_SECRET` are in the environment at `init` time, write a minimal config that defers to env-vars at runtime and skip the prompt. Same machine, different shells, different credentials — the env-var path wins. Document this in the install guide (Phase 5).

</specifics>

<deferred>
## Deferred Ideas

- **WHOOP roundtrip check in `doctor`** — calls `/v2/user/profile/basic` against real WHOOP. Burns API quota and requires a fresh access token. Phase 5 owns it as part of the full doctor battery; Phase 2 doctor stays offline-safe.
- **Multi-account support** — keyring account name `whoop:<user-id>` instead of `whoop`. Single migration when needed; v1 single-account.
- **Token rotation observability** — log a counter every time the refresh endpoint is hit; expose via `doctor` as "refreshes in last 7 days". Useful debugging signal but not load-bearing for v1.
- **`recovery-ledger reset auth`** — explicit subcommand to clear tokens and prompt for re-auth. v1 users can `rm ~/.recovery-ledger/tokens.json` (file mode) or use Keychain Access.app (keyring mode); Phase 5 install guide documents this. Add the subcommand if Phase 5 UX feedback shows the manual steps are confusing.
- **AES-256-GCM passphrase-derived file fallback** — STACK.md proposes encrypting the file-fallback tokens with a user passphrase. Phase 2 ships plaintext-in-`chmod 600` to honor the verbatim wording of AUTH-03 ("`chmod 600` file fallback"). Passphrase-encrypted fallback is a future hardening pass — open the ADR if a user reports the file mode feels unsafe.
- **`@modelcontextprotocol/inspector` CI smoke step** — Phase 1's deferred item, still deferred. Phase 2's integration test stays Vitest-driven; Inspector is a manual debugging aid.
- **Refresh-rate-limit detection** — if WHOOP starts returning 429 on the refresh endpoint, we'd want explicit backoff. Not observed in practice; revisit if it ever happens.

</deferred>

---

*Phase: 02-oauth-token-store-single-flight-refresh*
*Context gathered: 2026-05-12*
