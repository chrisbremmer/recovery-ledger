---
phase: 02-oauth-token-store-single-flight-refresh
plan: 03
type: execute
wave: 2
depends_on: ['02-01']
files_modified:
  - src/infrastructure/whoop/oauth.ts
  - src/infrastructure/whoop/oauth.test.ts
autonomous: true
requirements:
  - AUTH-01
  - AUTH-02
user_setup: []

note: "Checker WARNING PLAN-03-CROSS-LAYER (DEFER) — oauth.ts (under src/infrastructure/) imports `sanitize` from `src/mcp/sanitize.ts` (Phase 1). This is a layering inversion. We DEFER the cleaner refactor (move sanitize to `src/infrastructure/observability/`) because it would (a) touch the Phase 1 public surface that ADR-0001 §Decision binds to `src/mcp/`, (b) add a small task to Plan 02-01 with downstream churn through Plans 02-02 and 02-07, and (c) is not load-bearing for a single-developer project with no team-wide layering enforcement. ADR-0001 §Consequences line 35 already endorses cross-cutting from sanitize.ts (`one Pino, one transport, one sanitizer`). Acceptable risk; revisit if a third infrastructure module needs sanitize."

must_haves:
  truths:
    - "D-11: CSRF state is a 32-byte random value (base64url-encoded) generated per attempt via crypto.randomBytes; mismatch on callback raises oauth_state_mismatch and the code is not exchanged."
    - "buildAuthorizeUrl produces a WHOOP authorize URL with response_type=code, the registered redirect_uri, the D-13 scope set, and a 32-byte base64url state."
    - "PKCE is OFF by default (per A1 / D-12) — `code_challenge` is absent from the authorize URL unless `usePkce: true` is explicitly passed."
    - "exchangeCode POSTs to WHOOP_TOKEN_URL with grant_type=authorization_code, returns Tokens with expiresAt = obtainedAt + expires_in*1000."
    - "listenForCallback resolves with {code} on a matching state, rejects with AuthError({kind: 'auth_state_mismatch'}) on state mismatch, rejects with AuthError({kind: 'auth_timeout'}) after timeoutMs."
    - "The loopback server binds 127.0.0.1 only (NOT 0.0.0.0) — no LAN reach."
    - "Success and failure HTML pages render the verbatim D-09 content; failure detail runs through sanitize() before HTML insertion."
    - "On EADDRINUSE, listenForCallback rejects with `AuthError({kind: 'auth_port_in_use', detail: 'port <N>'})` — the kind is FROZEN at Wave 0 (Plan 02-01) so this plan does NOT mutate errors.ts (checker BLOCKER 1 fix: per-wave file ownership)."
    - "OPEN-Q-01 (RESEARCH Open Question 1) is honored: `?error=invalid_scope` / `invalid_request` / `unsupported_response_type` callbacks render the verbatim `error_description` query parameter (after sanitize+escapeHtml) so the user can diff against D-13's hardcoded scope strings. Other OAuth error codes strip the description as defense-in-depth."
  artifacts:
    - path: "src/infrastructure/whoop/oauth.ts"
      provides: "buildAuthorizeUrl, listenForCallback, exchangeCode, runOAuth — the OAuth state machine + loopback server for `recovery-ledger auth`."
      contains: "buildAuthorizeUrl"
    - path: "src/infrastructure/whoop/oauth.test.ts"
      provides: "Unit tests for URL build, loopback round-trip (happy path + state mismatch + timeout + EADDRINUSE + invalid_scope error_description render), code exchange (200 + 400)."
      contains: "state_mismatch"
  key_links:
    - from: "src/infrastructure/whoop/oauth.ts"
      to: "src/infrastructure/whoop/token-store.ts"
      via: "imports WHOOP_TOKEN_URL constant for exchangeCode POST"
      pattern: "from './token-store.js'"
    - from: "src/infrastructure/whoop/oauth.ts"
      to: "src/infrastructure/whoop/errors.ts"
      via: "throws AuthError on state mismatch / timeout / EADDRINUSE / non-2xx — errors.ts is FROZEN at Wave 0 (Plan 02-01), oauth.ts does NOT mutate it"
      pattern: "AuthError"
    - from: "src/infrastructure/whoop/oauth.ts"
      to: "src/mcp/sanitize.ts (Phase 1)"
      via: "failureHtml(redactedDetail) runs detail through sanitize() before HTML insertion (D-09 defense-in-depth); cross-layer import documented as acceptable per ADR-0001 §Consequences"
      pattern: "sanitize"
    - from: "src/infrastructure/whoop/oauth.ts"
      to: "open (npm package)"
      via: "browser auto-launch with try/catch fallback to copy-paste print"
      pattern: "import.*from 'open'"
---

<objective>
Implement the OAuth Authorization Code flow surface: `buildAuthorizeUrl`, `listenForCallback` (loopback HTTP server on 127.0.0.1:port), and `exchangeCode` (POST to WHOOP token endpoint). Wire them together in `runOAuth(opts)` — the function Plan 05's `auth` CLI command will call.

Per checker BLOCKER 1 (DEP-CONFLICT-01): this plan no longer mutates `errors.ts`. The `auth_port_in_use` AuthErrorKind was moved into Wave 0 (Plan 02-01) so Plan 02-02 (also Wave 2) and this plan both consume a stable errors.ts surface.

Per checker BLOCKER 4 (OPEN-Q-01): the callback handler distinguishes OAuth error codes — `invalid_scope`, `invalid_request`, `unsupported_response_type` render the verbatim `error_description` so the user can diff against D-13 strings; `server_error`, `access_denied`, `unauthorized_client`, `temporarily_unavailable` strip the description as defense-in-depth.

Purpose: AUTH-01 (BYO credentials via init) and AUTH-02 (auth command exchanges code for tokens) — Phase 2 success criterion #1.

Output: One file `oauth.ts` (~150 LOC) + co-located unit tests (~260 LOC) covering happy path + state mismatch + timeout + EADDRINUSE + code-exchange 200/400 + PKCE-off-by-default verification + invalid_scope error_description rendering.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/PROJECT.md
@.planning/REQUIREMENTS.md
@.planning/phases/02-oauth-token-store-single-flight-refresh/02-CONTEXT.md
@.planning/phases/02-oauth-token-store-single-flight-refresh/02-RESEARCH.md
@.planning/phases/02-oauth-token-store-single-flight-refresh/02-PATTERNS.md
@CLAUDE.md
@agent_docs/conventions.md
@agent_docs/decisions/0001-mcp-stdout-purity.md
@agent_docs/decisions/0006-fixture-only-tests.md
@agent_docs/decisions/0007-whoop-read-only.md
@src/infrastructure/config/logger.ts
@src/mcp/sanitize.ts

<interfaces>
<!-- Module-level exports. Plan 05's auth.ts consumes runOAuth(); Plan 04's refresh-orchestrator does NOT consume oauth.ts (the orchestrator delegates to token-store.ts for refresh, oauth.ts only for the auth-code grant). -->

From Wave-0 (Plan 02-01):
- `src/infrastructure/whoop/errors.ts` → `AuthError` class with ALL 6 KINDS finalized at Wave 0, including `auth_port_in_use`. This plan does NOT mutate errors.ts (checker BLOCKER 1 fix).

From Wave-1 (Plan 02-02 — same wave as this plan):
- `src/infrastructure/whoop/token-store.ts` → `WHOOP_TOKEN_URL`, `type Tokens`

From Phase 1:
- `src/mcp/sanitize.ts` → `sanitize(input: string): string` — pure function, safe to call from any layer. Cross-layer import accepted (see plan-level note on PLAN-03-CROSS-LAYER deferral).

oauth.ts public surface (per 02-PATTERNS.md lines 357-407 + RESEARCH lines 430-484 + lines 635-715):
- `export const WHOOP_AUTHORIZE_URL = 'https://api.prod.whoop.com/oauth/oauth2/auth';` (RESEARCH §State of the Art)
- `export interface BuildAuthorizeUrlInput { clientId: string; redirectUri: string; scopes: string[]; state: string; challenge?: string | null; }`
- `export function buildAuthorizeUrl(input: BuildAuthorizeUrlInput): string`
- `export interface ListenForCallbackOptions { port: number; expectedState: string; timeoutMs: number; onListening?: (info: {port: number; address: string}) => void; }`
- `export function listenForCallback(opts: ListenForCallbackOptions): Promise<{ code: string }>`
- `export interface ExchangeCodeInput { code: string; redirectUri: string; clientId: string; clientSecret: string; verifier?: string | null; fetch?: typeof globalThis.fetch; }`
- `export function exchangeCode(input: ExchangeCodeInput): Promise<Tokens>`
- `export interface RunOAuthOptions { clientId: string; clientSecret: string; redirectPort: number; scopes: string[]; noBrowser?: boolean; timeoutMs?: number; usePkce?: boolean; fetch?: typeof globalThis.fetch; openBrowser?: (url: string) => Promise<void>; }`
- `export function runOAuth(opts: RunOAuthOptions): Promise<Tokens>`

PKCE policy (per A1 + D-12 + Pitfall I):
- `usePkce` defaults to **false**. WHOOP PKCE support is unconfirmed; conservative default per A1.
- When `usePkce: true`, generate 64-byte verifier via `randomBytes(64).toString('base64url')`, derive challenge `base64url(sha256(verifier))`, add `code_challenge` + `code_challenge_method=S256` to the authorize URL, and add `code_verifier` to the exchange body.

D-13 scope set (locked):
- `['offline', 'read:recovery', 'read:sleep', 'read:workout', 'read:cycles', 'read:profile', 'read:body_measurement']` — these are the strings concatenated with space into the `scope` URL param. Sourced from `D13_SCOPES` constant in Plan 02-01's `src/infrastructure/config/schema.ts`.

State (D-11):
- `randomBytes(32).toString('base64url')` — 256-bit CSRF protection. Plain `===` compare (RESEARCH §State of the Art Threat Patterns — equality for opaque random strings is fine; timingSafeEqual not required).

D-09 HTML pages (verbatim text — no CSS, no JS, no external assets):
- Success (200, content-type `text/html; charset=utf-8`):
  `<!doctype html><meta charset="utf-8"><title>Recovery Ledger — auth complete</title><h1>Authorization complete.</h1><p>You can close this window and return to your terminal.</p>`
- Failure (400, content-type `text/html; charset=utf-8`):
  `<!doctype html><meta charset="utf-8"><title>Recovery Ledger — auth failed</title><h1>Authorization failed</h1><pre>${escapeHtml(sanitize(detail))}</pre><p>Return to your terminal and run <code>recovery-ledger auth</code> again.</p>`

D-10 timeout (5 min default; configurable via opts):
- AbortController-style cleanup mirroring `src/services/doctor/checks/mcp-stdout-purity.ts` lines 134-168 finalise harness. On timeout, `server.close()` and reject with `AuthError({kind: 'auth_timeout'})`.

EADDRINUSE handling (Pitfall G):
- `server.on('error', ...)` catches EADDRINUSE. Reject with `AuthError({kind: 'auth_port_in_use', detail: \`port ${port}\`})`. The kind is already present in Plan 02-01's errors.ts (added there in revision); this plan does NOT mutate errors.ts.

OAuth error-code response policy (BLOCKER 4 / OPEN-Q-01 fix — RESEARCH Open Question 1):
- The OAuth callback URL may carry `?error=<code>&error_description=<text>`.
- The previous default policy ("always strip error_description as defense-in-depth") is too broad. Narrow it by error-code semantics:
  - **RENDER the error_description verbatim** (after sanitize → escapeHtml) for these codes:
    - `invalid_scope` — D-13 vocabulary mismatch; user needs to see WHOOP's exact rejection message to diff against the hardcoded scope strings.
    - `invalid_request` — typically a malformed parameter the user can correct (e.g., misregistered redirect URI).
    - `unsupported_response_type` — request shape mismatch the user can correct in init.ts.
  - **STRIP the error_description** (failureHtml gets the error code only) for these codes:
    - `server_error` — opaque WHOOP-side failure; description has no actionable signal for the user.
    - `access_denied` — user declined; description may carry session-shaped identifiers.
    - `unauthorized_client` — credentials issue; description may carry hints about the client_id or secret.
    - `temporarily_unavailable` — transient; description is noise.
  - **Default arm** (any other error code): strip — same as the conservative original policy.
- The `error_description` is ALWAYS run through `sanitize()` before HTML insertion, even on the render path. The sanitizer's `code=` + JWT + Bearer patterns ensure no token-shaped substrings leak even if WHOOP returns one accidentally.
</interfaces>
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: oauth.ts — authorize URL build + code exchange + loopback callback server (with OAuth error-code policy)</name>
  <files>
    src/infrastructure/whoop/oauth.ts,
    src/infrastructure/whoop/oauth.test.ts
  </files>
  <read_first>
    - src/infrastructure/whoop/errors.ts (Plan 01 — FINAL 6-kind AuthErrorKind set including auth_port_in_use; this plan consumes, does NOT mutate)
    - src/infrastructure/whoop/token-store.ts (Plan 02 — WHOOP_TOKEN_URL re-export source)
    - src/services/doctor/checks/mcp-stdout-purity.ts (Phase 1 — analog for the lifecycle harness; lines 126-168 finalise pattern, lines 186-193 error-listener cleanup parity)
    - src/services/doctor/checks/mcp-stdout-purity.test.ts (Phase 1 — analog for subprocess-style test harness, mkdtemp pattern)
    - src/mcp/sanitize.ts (Phase 1 — `sanitize` is the pure function we call from `failureHtml`; verify the export name)
    - src/infrastructure/config/logger.ts (logger imports; no console.*)
    - tests/helpers/msw-whoop-oauth.ts (Plan 01 — MSW handler factory; reuse for exchangeCode tests)
    - test/fixtures/oauth/token-200.json (Plan 01 — happy-path response body)
    - test/fixtures/oauth/token-400-invalid-grant.json (Plan 01 — invalid-grant response)
    - test/fixtures/oauth/authorize-callback-state-mismatch.html (Plan 01 — expected failure HTML used as assertion fixture)
    - .planning/phases/02-oauth-token-store-single-flight-refresh/02-RESEARCH.md (lines 426-484 Pattern 3; lines 600-628 Pitfalls G/H/I/J; lines 634-715 Code Examples — buildAuthorizeUrl + exchangeCode; lines 719-765 Loopback Callback Server; Open Question 1 RESOLVED — see top of RESEARCH.md `## Open Questions (RESOLVED)`)
    - .planning/phases/02-oauth-token-store-single-flight-refresh/02-PATTERNS.md (lines 357-407 — oauth.ts has no strong analog; lifecycle harness mirrors mcp-stdout-purity)
    - .planning/phases/02-oauth-token-store-single-flight-refresh/02-CONTEXT.md (D-08 to D-13)
    - agent_docs/decisions/0007-whoop-read-only.md (lines 30-35 — HTTP client is GET-only; token-endpoint POSTs are isolated to oauth.ts + token-store.ts per ADR-0007 §Enforcement)
  </read_first>
  <behavior>
    URL build (AUTH-01):
    - Test U-01: `buildAuthorizeUrl({clientId: 'cid', redirectUri: 'http://127.0.0.1:4321/callback', scopes: ['offline', 'read:recovery'], state: 'st'})` returns a URL whose host is `api.prod.whoop.com`, path is `/oauth/oauth2/auth`, and query contains `response_type=code`, `client_id=cid`, `redirect_uri=http%3A%2F%2F127.0.0.1%3A4321%2Fcallback`, `scope=offline+read%3Arecovery` (URLSearchParams encoding), `state=st`.
    - Test U-02: without `challenge`, the URL has NO `code_challenge` param (PKCE off by default per A1).
    - Test U-03: with `challenge: 'abc'`, the URL has `code_challenge=abc&code_challenge_method=S256`.

    Loopback callback server (AUTH-02 — D-09/D-10/D-11):
    - Test L-01 (happy path): start `listenForCallback({port: 0, expectedState: 'st', timeoutMs: 5000})` (port 0 → OS chooses free port; read assigned port via `server.address()`). Open a `fetch('http://127.0.0.1:<port>/callback?code=xyz&state=st')`. Assert: promise resolves with `{code: 'xyz'}`, response body is the verbatim D-09 success HTML, status 200, content-type starts with `text/html`.
    - Test L-02 (state mismatch): same setup, `fetch('/callback?code=xyz&state=wrong')`. Assert: promise rejects with `AuthError`, `.kind === 'auth_state_mismatch'`. Response body matches `test/fixtures/oauth/authorize-callback-state-mismatch.html` (verbatim including the sanitized detail).
    - Test L-03 (timeout): start `listenForCallback({port: 0, expectedState: 'st', timeoutMs: 50})` and never fetch. Assert: promise rejects within 200ms with `AuthError({kind: 'auth_timeout'})`. Server is closed (subsequent connection attempt fails).
    - Test L-04 (server closed after success): after happy-path resolution, attempt a second `fetch('/callback?...')` to the same port — assertion: ECONNREFUSED (server.close() ran in `finally`).
    - Test L-05 (EADDRINUSE): bind a sacrificial `http.createServer().listen(port, '127.0.0.1')` on a chosen port, then call `listenForCallback({port: <same>, ...})`. Assert: promise rejects with `AuthError({kind: 'auth_port_in_use'})` whose `.message` contains the port number.
    - Test L-06 (binding security): after `listenForCallback` is running, `onListening` callback fires with `{address: '127.0.0.1'}` (NOT '0.0.0.0' — ASVS V9, Threat Pattern CSRF on loopback).

    OAuth error-code response policy (BLOCKER 4 / OPEN-Q-01):
    - Test OE-01 (invalid_scope renders description): fetch `/callback?error=invalid_scope&error_description=read%3Abody_measurement+is+not+valid&state=st`. Assert: response body (failureHtml) CONTAINS the substring `read:body_measurement is not valid` (URL-decoded, sanitized, escapeHtml'd). The promise rejects with AuthError whose detail mentions `invalid_scope`.
    - Test OE-02 (invalid_request renders description): fetch `/callback?error=invalid_request&error_description=redirect_uri+mismatch&state=st`. Assert: response body contains `redirect_uri mismatch`.
    - Test OE-03 (unsupported_response_type renders description): fetch `/callback?error=unsupported_response_type&error_description=only+code+supported&state=st`. Assert: response body contains `only code supported`.
    - Test OE-04 (server_error strips description): fetch `/callback?error=server_error&error_description=internal+session+abc123&state=st`. Assert: response body does NOT contain `internal session abc123` (description stripped) AND does contain the error code `server_error`. The promise rejects with AuthError whose detail mentions `server_error` but not the description.
    - Test OE-05 (access_denied strips description): fetch `/callback?error=access_denied&error_description=user+sid+xyz&state=st`. Assert: response body does NOT contain `user sid xyz`.
    - Test OE-06 (unauthorized_client strips description): fetch `/callback?error=unauthorized_client&error_description=client_id+xyz+invalid&state=st`. Assert: response body does NOT contain `client_id xyz invalid`.
    - Test OE-07 (unknown error code strips description, default arm): fetch `/callback?error=some_unknown_code&error_description=opaque+detail&state=st`. Assert: response body does NOT contain `opaque detail`.
    - Test OE-08 (sanitize still runs on render path): fetch `/callback?error=invalid_scope&error_description=token%3D[A-Za-z0-9._%2B%2F%3D-]long_jwt_shaped_string&state=st`. Assert: response body does NOT contain the long JWT-shaped substring (sanitizer redacted it even though we're on the render path).
    - Test OE-09 (the specific BLOCKER 4 acceptance fixture): fetch `/callback?error=invalid_scope&error_description=foo&state=st`. Assert: response body (failureHtml) contains the substring `foo`. This is the literal acceptance criterion stated in checker BLOCKER 4.

    Code exchange (AUTH-02):
    - Test X-01 (happy path): MSW intercepts WHOOP_TOKEN_URL POST, returns `token-200.json`. `exchangeCode({code: 'c', redirectUri, clientId, clientSecret})` returns `Tokens` with `accessToken === 'at-1'`, `refreshToken === 'rt-1'`, `tokenType === 'bearer'`, `scope` matches fixture, `obtainedAt` is a recent timestamp (within 5s of test start), `expiresAt === obtainedAt + 3600 * 1000`.
    - Test X-02 (invalid grant): MSW returns `token-400-invalid-grant.json` with status 400. `exchangeCode(...)` rejects with `AuthError({kind: 'refresh_failed'})` — same `kind` as token-store.ts uses for non-2xx (D-15 / Pitfall A).
    - Test X-03 (form body shape): spy on the MSW handler, assert request body is `application/x-www-form-urlencoded` and contains `grant_type=authorization_code`, `code=c`, `client_id=...`, `client_secret=...`, `redirect_uri=...`.
    - Test X-04 (PKCE verifier sent when present): `exchangeCode({..., verifier: 'v'})` — request body contains `code_verifier=v`.
    - Test X-05 (Zod parse passthrough): MSW returns `{...token-200.json, extra_field: 'noise'}` — `exchangeCode` succeeds (passthrough per Pitfall J), extra_field discarded.
    - Test X-06 (Zod parse rejection): MSW returns `{access_token: 'at'}` (missing required fields) — rejects with AuthError whose `.kind === 'refresh_failed'`.

    runOAuth orchestration (D-08 browser auto-open + fallback):
    - Test R-01: `runOAuth({clientId, clientSecret, redirectPort: 0, scopes: D13Scopes, openBrowser: (url) => { capturedUrl = url; return Promise.resolve(); }, fetch: mockFetch})` — flow: state is generated, openBrowser is called with an authorize URL containing the state, fetch on /callback?code=xyz&state=<gen> is simulated, exchangeCode is called, Tokens returned. **Test harness:** since `listenForCallback` waits for a real loopback fetch, the test orchestrates by (a) starting `runOAuth` in a Promise, (b) waiting for `openBrowser` to be invoked (which gives us the state), (c) firing `fetch('http://127.0.0.1:<port>/callback?code=xyz&state=<state>')` from the test, (d) awaiting the runOAuth promise. Use a port-0 binding in the harness; surface the chosen port through the `openBrowser` callback URL.
    - Test R-02 (--no-browser path): `runOAuth({..., noBrowser: true, openBrowser: spy})` — spy never called; the authorize URL is logged to stderr instead (use `process.stderr.write` from oauth.ts is allowed — it's stderr, not stdout, so ADR-0001 is satisfied). Test asserts captured stderr contains the URL.
    - Test R-03 (openBrowser throws): `runOAuth({..., openBrowser: () => Promise.reject(new Error('no display'))})` — flow falls back to the --no-browser code path (URL printed to stderr), then waits for the callback as normal.
  </behavior>
  <action>
    Create `src/infrastructure/whoop/oauth.ts`. Named exports only. Module-leading doc comment cites D-08 through D-13, ADR-0001 (stderr only), ADR-0007 (no other HTTP verbs against WHOOP), and notes that this module imports `sanitize` from `src/mcp/` (cross-layer per ADR-0001 §Consequences; the planner-level note on PLAN-03-CROSS-LAYER explains the deferral). ~150 LOC.

    NOTE: this plan does NOT modify `src/infrastructure/whoop/errors.ts`. The `auth_port_in_use` AuthErrorKind is already present in errors.ts as of Wave 0 (Plan 02-01). If the file does not contain that kind, Plan 02-01 has not landed yet and this plan should not execute.

    Structure:

    1. Imports: `node:http` (`createServer`, `type IncomingMessage`, `type ServerResponse`), `node:crypto` (`randomBytes`, `createHash`), `node:timers/promises` (`setTimeout as delay` for the test-friendly cancellation; or use AbortController directly), `zod` (`z`), `../config/logger.js`, `./errors.js` (consume only — do NOT modify), `./token-store.js` (re-import `WHOOP_TOKEN_URL`, `type Tokens`), `../../mcp/sanitize.js` (cross-layer import — documented in the module's leading doc comment; ADR-0001 §Consequences endorses this pattern).

    2. Constants: `export const WHOOP_AUTHORIZE_URL = 'https://api.prod.whoop.com/oauth/oauth2/auth';`. SUCCESS_HTML and FAILURE_HTML templates as private module-level constants (verbatim D-09 text from <interfaces>).

       OAuth error-code policy constants (BLOCKER 4 / OPEN-Q-01):
       - `const RENDERABLE_OAUTH_ERROR_CODES = new Set(['invalid_scope', 'invalid_request', 'unsupported_response_type']);` — error codes whose `error_description` is rendered (after sanitize+escapeHtml).
       - All other error codes strip the description (failureHtml gets the error code only).

    3. `buildAuthorizeUrl(input)`: returns `string`. Use `URLSearchParams` exclusively (no string concat — Threat Pattern: browser-launch URL injection). Validate `clientId` against `z.string().regex(/^[A-Za-z0-9._~-]+$/)` (RESEARCH Threat Patterns; reject `:` `/` `?` etc.). Throw `AuthError({kind: 'refresh_failed', detail: 'invalid clientId shape'})` on Zod parse failure.

    4. `listenForCallback(opts)`: returns `Promise<{code: string}>`. Pattern from mcp-stdout-purity.ts finalise (lines 126-168):
       - `http.createServer((req, res) => handleCallback(req, res, opts.expectedState, resolve, reject))`.
       - `server.on('error', (err) => { if (err.code === 'EADDRINUSE') reject(new AuthError({kind: 'auth_port_in_use', detail: \`port ${opts.port}\`})); else reject(err); })`. Note: `auth_port_in_use` already exists in errors.ts as of Wave 0 — this plan consumes it without mutating the file.
       - `server.listen(opts.port, '127.0.0.1')`.
       - On `listening`: invoke `opts.onListening?.({port: (server.address() as AddressInfo).port, address: '127.0.0.1'})` so tests can read the OS-assigned port.
       - AbortController + `setTimeout(timeoutMs)` for timeout reject. On timeout: `server.close()` + reject `AuthError({kind: 'auth_timeout'})`.
       - `finalise(result)` one-shot guard: `server.close()` + `ac.abort()` + `resolve(result)` or `reject(err)` exactly once.

    5. `handleCallback(req, res, expectedState, resolve, reject)`: parse query via `new URL(req.url, 'http://localhost')`. Zod parse query params: `z.object({code: z.string().min(1).optional(), state: z.string().min(1).optional(), error: z.string().optional(), error_description: z.string().optional()})`.

       Error-code policy (BLOCKER 4 / OPEN-Q-01):
       - If `error` is present:
         - Build `displayDetail`:
           - If `RENDERABLE_OAUTH_ERROR_CODES.has(error)` AND `error_description` is present → `displayDetail = \`${error}: ${error_description}\`` (the description IS included, and `failureHtml` will run it through `sanitize()` + `escapeHtml()` before HTML insertion).
           - Else → `displayDetail = error` (description stripped; only the error code reaches the user).
         - Respond 400 with `failureHtml(displayDetail)`.
         - Reject the promise with `AuthError({kind: 'refresh_failed', detail: displayDetail})` (the AuthError's detail can carry the same redacted string; it flows through Phase 1's sanitizer on the MCP side if it ever reaches that boundary).
       - Else if `state !== expectedState`: respond 400 with `failureHtml('state mismatch')`, reject `AuthError({kind: 'auth_state_mismatch'})`.
       - Else: respond 200 with SUCCESS_HTML, call resolve({code}).

    6. `failureHtml(detail: string): string`: returns FAILURE_HTML with `${escapeHtml(sanitize(detail))}` substituted. Tiny `escapeHtml` helper (replace `&` `<` `>` `"` — sufficient for the constrained surface). The sanitize step ALWAYS runs, even on the render-path for invalid_scope etc. — defense-in-depth against accidental token-shaped substrings.

    7. `exchangeCode(input)`: build `URLSearchParams` form body (grant_type, code, redirect_uri, client_id, client_secret, optionally code_verifier). Capture `const obtainedAt = Date.now()` before the fetch. POST to `WHOOP_TOKEN_URL` (re-imported from token-store.ts). Parse response via `TokenResponseSchema.passthrough()`. On non-2xx, throw `AuthError({kind: 'refresh_failed', detail: \`token endpoint ${res.status}\`})` (do NOT inline body text). Return `Tokens` per the type from token-store.ts. Allow `fetch` injection via `input.fetch ?? globalThis.fetch`.

    8. `runOAuth(opts)`: orchestrates state/PKCE generation, builds authorize URL, starts `listenForCallback` BEFORE opening the browser (the server must be listening when WHOOP redirects), opens browser (or skips if `noBrowser` / openBrowser throws — fallback prints to stderr), awaits the code, exchanges it. Returns Tokens. Note: writing tokens to storage is the CALLER's job (Plan 05's auth.ts wires tokenStore.write).

    9. PKCE OFF by default per A1. The opts type accepts `usePkce?: boolean`; when true, verifier+challenge are generated and threaded through buildAuthorizeUrl + exchangeCode.

    10. Logging: `logger.info({event: 'auth_started', port: opts.redirectPort})`, `logger.info({event: 'callback_received', hasCode: boolean})`, `logger.warn({event: 'oauth_error', code: error, hasDescription: !!error_description, descriptionRendered: RENDERABLE_OAUTH_ERROR_CODES.has(error)})` for the error-code arm. NEVER log the code, state, verifier, error_description text, or any token fields. NEVER log the raw URL with query (Pitfall C).

    11. No `console.*`. No `process.stdout.write`. `process.stderr.write` is acceptable for the URL print in --no-browser mode (it's stderr, not stdout — ADR-0001 forbids stdout only).

    Create `src/infrastructure/whoop/oauth.test.ts`. Pattern from mcp-stdout-purity.test.ts:
    - `mkdtemp` for any test that needs a temp dir.
    - MSW server from `tests/helpers/msw-whoop-oauth.ts` for the exchangeCode tests.
    - For `listenForCallback`, use `port: 0` (OS-assigned) — read `server.address().port` via the `onListening` callback exposed on `ListenForCallbackOptions`.
    - Test groups: `describe('buildAuthorizeUrl')`, `describe('listenForCallback')`, `describe('oauth error-code response policy')`, `describe('exchangeCode')`, `describe('runOAuth')`. Tests U-01..03, L-01..06, OE-01..09, X-01..06, R-01..03 per <behavior>.
    - For L-06 (binding security), assert the `onListening` callback fires with `address: '127.0.0.1'` not `'0.0.0.0'`.
    - For OE-09 (the BLOCKER 4 verbatim acceptance fixture): test name explicitly states the assertion is the `?error=invalid_scope&error_description=foo` → `'foo'` in failureHtml mapping, mirroring the checker's wording.
  </action>
  <verify>
    <automated>npm run test -- --run src/infrastructure/whoop/oauth.test.ts</automated>
  </verify>
  <acceptance_criteria>
    - `src/infrastructure/whoop/oauth.ts` exists with exports `buildAuthorizeUrl`, `listenForCallback`, `exchangeCode`, `runOAuth`, `WHOOP_AUTHORIZE_URL`. Grep `grep -cE '^export ' src/infrastructure/whoop/oauth.ts` returns >= 5.
    - `src/infrastructure/whoop/errors.ts` is NOT modified by this plan: `git diff --name-only HEAD~$N..HEAD -- src/infrastructure/whoop/errors.ts` (where `$N` is the commit count since Plan 02-01 landed) shows the file unchanged after this plan's commits. Locally: verify by running this plan's task with errors.ts already in place from Plan 02-01 — no errors.ts modification should occur.
    - `src/infrastructure/whoop/oauth.ts` has NO `console.*` calls (`grep -nE 'console\.(log|info|warn|error|debug|trace)' src/infrastructure/whoop/oauth.ts` returns no matches).
    - `src/infrastructure/whoop/oauth.ts` has NO `process.stdout.write` calls (`grep -nE 'process\.stdout\.write' src/infrastructure/whoop/oauth.ts` returns no matches). `process.stderr.write` IS allowed.
    - `src/infrastructure/whoop/oauth.ts` binds `127.0.0.1` explicitly: `grep -nE "'127\.0\.0\.1'" src/infrastructure/whoop/oauth.ts` returns at least one match (the `server.listen(port, '127.0.0.1')` line).
    - `src/infrastructure/whoop/oauth.ts` does NOT bind 0.0.0.0: `grep -nE "'0\.0\.0\.0'" src/infrastructure/whoop/oauth.ts` returns no matches.
    - `src/infrastructure/whoop/oauth.ts` contains the renderable-error-code set: `grep -nE "RENDERABLE_OAUTH_ERROR_CODES|invalid_scope" src/infrastructure/whoop/oauth.ts` returns at least 2 matches (constant declaration + the policy branch).
    - `grep -c '^export default' src/infrastructure/whoop/oauth.ts` returns `0`.
    - `npm run test -- --run src/infrastructure/whoop/oauth.test.ts` exits 0 with at least 27 passing tests (3 buildAuthorizeUrl + 6 listenForCallback + 9 oauth error-code + 6 exchangeCode + 3 runOAuth).
    - The OE-09 test exists with a fixture matching `?error=invalid_scope&error_description=foo` and asserts the failureHtml contains the literal `foo`: `grep -nE "error_description=foo" src/infrastructure/whoop/oauth.test.ts` returns >= 1 match AND `grep -nE "toContain\\(['\"]foo['\"]\\)" src/infrastructure/whoop/oauth.test.ts` returns >= 1 match.
    - `grep -rEn "oauth/oauth2/auth" src/ | grep -v 'oauth.ts'` returns no matches (the authorize-URL constant lives in oauth.ts only).
    - `npm run lint` exits 0.
    - `bash scripts/ci-grep-gates.sh` exits 0.
  </acceptance_criteria>
  <done>
    oauth.ts implements buildAuthorizeUrl + listenForCallback + exchangeCode + runOAuth with PKCE-off default, 127.0.0.1-only loopback binding, D-09 verbatim HTML pages, sanitized failure detail, EADDRINUSE → auth_port_in_use mapping (kind sourced from Wave 0), and the OAuth error-code response policy (RENDER for invalid_scope/invalid_request/unsupported_response_type; STRIP for server_error/access_denied/unauthorized_client/temporarily_unavailable/default). errors.ts is consumed unchanged. 27+ tests green including the BLOCKER 4 verbatim fixture.
  </done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| user-supplied clientId / clientSecret | from CLI prompts (Plan 05) — Zod-validated for shape before URL building |
| WHOOP authorize page | redirects browser back to our loopback with code+state in query — untrusted query data |
| loopback HTTP server (127.0.0.1) | local-only; no LAN reach because we bind 127.0.0.1 (not 0.0.0.0) |
| browser → loopback callback | request body is in the query string; both code and state are untrusted until validated |
| OAuth error_description query param | untrusted text from WHOOP; rendered for diagnosable error codes (invalid_scope/etc.) after sanitize, stripped for opaque error codes (server_error/etc.) |
| MSW WHOOP token endpoint | fixture-only — never live (ADR-0006) |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-02.03-01 | Tampering | CSRF on loopback callback | mitigate | 32-byte `randomBytes(32).toString('base64url')` state per D-11; loopback bound to 127.0.0.1 only (verified by Test L-06); state mismatch → `AuthError({kind: 'auth_state_mismatch'})`; do NOT exchange code on mismatch. ASVS V2/V5. |
| T-02.03-02 | Spoofing | Authorization-code injection (attacker plants victim's code) | mitigate | Loopback 127.0.0.1-only + 32-byte random state. PKCE off by default per A1 (Pitfall I) — when WHOOP confirms support, flip the flag. RFC 7636 §4 formal defense deferred to Phase 5 hardening. ASVS V2. |
| T-02.03-03 | Information Disclosure | OAuth code in stderr / logs (Pitfall C) | mitigate | logger calls log structured fields `{event, hasCode: boolean}` only — never `{url: req.url}` or `{code: ...}`. Phase 1 sanitize.ts (already covers `code=` per SECRET_KEY_NAMES line 29 of sanitize.ts) catches any downstream string-construction slip. Defense-in-depth: failureHtml runs detail through sanitize() before HTML insertion (D-09 + Pitfall C). ASVS V7. |
| T-02.03-04 | Information Disclosure | client_secret in URL / logs | mitigate | client_secret never appears in the authorize URL (it's only in the POST body of exchangeCode). exchangeCode does not log the body. Failure detail strings never contain body text. Phase 1 sanitize.ts covers `client_secret` key already. ASVS V8. |
| T-02.03-05 | Tampering | URL injection via hostile clientId | mitigate | clientId Zod-validated against `/^[A-Za-z0-9._~-]+$/` before URLSearchParams build (RESEARCH Threat Patterns). URLSearchParams handles escaping for trusted shape. ASVS V5. |
| T-02.03-06 | Information Disclosure | Token endpoint response body in error | mitigate | exchangeCode's non-2xx path throws `AuthError({kind: 'refresh_failed', detail: \`token endpoint ${status}\`})` — status only, never body text (Pitfall C defense-in-depth). ASVS V7. |
| T-02.03-07 | Tampering | hostile token-endpoint response shape (extra fields, missing fields) | mitigate | Zod schema `TokenResponseSchema.passthrough()` (Pitfall J) — accepts extra fields, rejects missing required fields. On reject: AuthError({kind: 'refresh_failed', cause: zodError.issues}). issues contain field paths + expected types, never raw values. ASVS V5. |
| T-02.03-08 | DoS | infinite wait on missing callback | mitigate | 5-min default timeoutMs (D-10) configurable via opts. AbortController + setTimeout cleanup. server.close() on timeout. Test L-03 verifies. ASVS V11. |
| T-02.03-09 | DoS | port collision (Pitfall G) | mitigate | EADDRINUSE → `AuthError({kind: 'auth_port_in_use', detail: \`port ${port}\`})` (kind sourced from Wave 0 errors.ts; this plan no longer mutates errors.ts per checker BLOCKER 1) with clear remediation in formatAuthError. Test L-05 verifies. ASVS V11. |
| T-02.03-10 | Information Disclosure | browser-auto-open invokes hostile URL via tampered clientId | mitigate | clientId Zod regex validation prevents `:` `/` `?` injection before URL build. `open(authorizeUrl)` only sees the URL we constructed via URLSearchParams. Cross-platform open package handles platform-specific shell escaping. ASVS V5/V14. |
| T-02.03-11 | Tampering | hostile localhost server (someone else binds 127.0.0.1:4321 first) | accept | A local attacker who can already bind 127.0.0.1 owns the user's shell; this is out of scope for a personal tool. EADDRINUSE detection means we fail fast rather than silently shipping codes to an attacker's server. RESEARCH §V4 — single-user personal tool, OS-level file permissions are the boundary. |
| T-02.03-12 | Information Disclosure | sanitize() bypass in failureHtml | mitigate | failureHtml ALWAYS pipes detail through `sanitize()` before `escapeHtml` (Phase 1 covers all known leak shapes including `code=` and `client_secret`). Defense-in-depth: even if a future caller passes a tokens-shaped string, sanitize() redacts before the browser sees it. Test OE-08 verifies sanitize runs even on the render path for invalid_scope. ASVS V7. |
| T-02.03-13 | Information Disclosure | error_description leaks session-shaped identifiers | mitigate | NEW (BLOCKER 4 / OPEN-Q-01): the error-code policy narrows description rendering to three diagnosable codes (invalid_scope/invalid_request/unsupported_response_type). Opaque error codes (server_error/access_denied/unauthorized_client/temporarily_unavailable/default) strip the description entirely. Tests OE-04..07 verify the strip path. ASVS V7. |
</threat_model>

<verification>
- `src/infrastructure/whoop/oauth.ts` exists.
- `src/infrastructure/whoop/errors.ts` is NOT modified by this plan (verified by per-task git diff or grep of the file's contents matching the Wave 0 6-kind union).
- `npm run test -- --run src/infrastructure/whoop/oauth.test.ts` exits 0 with >= 27 passing tests including OE-01..09.
- `grep -rEn "oauth/oauth2/auth" src/ | grep -v 'oauth.ts'` returns no matches.
- `grep -rEn "'0\.0\.0\.0'" src/infrastructure/whoop/` returns no matches.
- `bash scripts/ci-grep-gates.sh` exits 0.
- `npm run lint` exits 0.
</verification>

<success_criteria>
- AUTH-01: `buildAuthorizeUrl` produces a WHOOP-shape authorize URL with the D-13 scope set, response_type=code, redirect_uri matching the configured loopback, and a 256-bit CSRF state.
- AUTH-02: `runOAuth` orchestrates the loopback round-trip end-to-end against MSW + a simulated browser fetch — code exchanged for Tokens.
- D-09 verbatim HTML pages render exactly as specified; failure detail is sanitizer-clean before HTML insertion.
- D-11 state validation rejects with `auth_state_mismatch`; D-10 timeout rejects with `auth_timeout`; Pitfall G rejects with `auth_port_in_use` (kind sourced from Wave 0 errors.ts; this plan does NOT mutate errors.ts).
- PKCE OFF by default (A1); flag-gated for future hardening pass.
- 127.0.0.1-only binding verified by test.
- BLOCKER 4 / OPEN-Q-01 satisfied: invalid_scope callbacks render `error_description` verbatim so users can diff D-13 against WHOOP's rejection message; opaque error codes strip the description.
- Plan 05's auth.ts can `import { runOAuth }` and consume the result by calling `tokenStore.write(tokens)`.
</success_criteria>

<output>
After completion, create `.planning/phases/02-oauth-token-store-single-flight-refresh/02-03-SUMMARY.md`.
</output>
