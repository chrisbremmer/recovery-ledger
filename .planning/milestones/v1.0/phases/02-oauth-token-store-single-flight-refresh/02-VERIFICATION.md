---
phase: 02-oauth-token-store-single-flight-refresh
verified: 2026-05-12T17:10:00Z
status: passed
score: 4/4 must-haves verified
overrides_applied: 0
requirements_verified:
  - AUTH-01
  - AUTH-02
  - AUTH-03
  - AUTH-04
  - AUTH-05
  - AUTH-06
automated_checks:
  npm_test: { passed: 255, failed: 0, files: 20 }
  npm_lint: pass
  ci_grep_gates: pass (A/B/C/D/E)
  npm_build: pass (dist/cli.mjs, dist/mcp.mjs, dist/infrastructure/whoop/token-store.mjs)
code_review_fixes_verified:
  - CR-01: src/infrastructure/whoop/token-store.ts:326 sends `fresh ?? stale` refresh_token
  - CR-02: src/infrastructure/whoop/token-store.ts:349-354 omits `scope` from refresh body (RFC 6749 §6 documented in comment)
  - CR-03: src/services/refresh-orchestrator.ts:102 applies REFRESH_BUFFER_MS to post-401 re-read
  - CR-04: src/cli/commands/auth.ts:76-91 prefilters ZodError config-parse + sanitizes outer-catch String(err)
---

# Phase 2: OAuth, Token Store & Single-Flight Refresh — Verification Report

**Phase Goal:** Concurrent CLI + MCP processes can refresh WHOOP tokens without ever burning the refresh-token family; tokens never appear in plaintext at rest or in error returns.

**Verified:** 2026-05-12T17:10:00Z
**Status:** passed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths (from ROADMAP Success Criteria + plan must_haves)

| #   | Truth                                                                                                                                                                                                                                                            | Status     | Evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `recovery-ledger init` configures BYO WHOOP credentials and `recovery-ledger auth` completes the OAuth Authorization Code flow on a dynamically-chosen loopback port, exchanges the code for tokens, and reports success.                                       | VERIFIED   | `src/cli/commands/init.ts` writes config.json mode 0600 atomically with D-02 instructions printed verbatim. `src/cli/commands/auth.ts` runs `runOAuth` then `tokenStore.write(tokens)` and prints `Authorization complete.` `runOAuth` (oauth.ts:418) starts loopback server on 127.0.0.1, builds redirect_uri from OS-assigned port, exchanges code via `exchangeCode`. `node dist/cli.mjs --help` lists both `init` and `auth` subcommands. 20 tests pass for init.test.ts + auth.test.ts. |
| 2   | Under 10 parallel 401 responses across CLI + MCP processes, exactly one WHOOP refresh request is issued and the resulting token tuple is written atomically (temp-file-and-rename) — single-flight contract holds.                                              | VERIFIED   | `tests/integration/auth-concurrency.test.ts` Test I-01 forks 10 child processes against a shared HTTP mock; asserts `mock.getCount() === 1` and `new Set(tokens).size === 1`. Test I-02 asserts `tokens.json.tmp` does not exist (atomic rename completed) and `tokens.json` mode is `0o600`. Test I-03 asserts `proper-lockfile.check()` returns false (lock released). token-store.ts implements 3-layer gate: in-process Promise (line 140), proper-lockfile (line 288), atomic rename (line 400). |
| 3   | OAuth tokens stored via `@napi-rs/keyring` when available, falling back to a `chmod 600` file; `doctor` reports `auth: keychain` vs `auth: file`.                                                                                                                | VERIFIED   | token-store.ts `writeUnderLock` tries `Entry.setPassword`, validates with Pitfall F roundtrip, falls back to `writeFileAtomic(tokens.json, mode 0o600)` on throw/mismatch. storage-mode cache file records the decision (line 247). `src/services/doctor/checks/auth.ts:67` returns `'auth: keychain'` or `'auth: file (mode 0600)'`. `RECOVERY_LEDGER_FORCE_FILE_STORE=1` (line 129) bypasses keyring. 12 probe tests pass for auth.test.ts + token-freshness.test.ts.                       |
| 4   | Grep of log directory, stderr capture, and any MCP tool error return after induced WHOOP 401/500 yields zero matches for `Bearer`, JWT shape, or `Authorization`.                                                                                                | VERIFIED   | `tests/integration/auth-concurrency.test.ts` Test G-01 asserts concatenated stderr from 10 children does not match FORBIDDEN regex `/Bearer\s+[A-Za-z0-9._/+=-]{10,}\|eyJ[A-Za-z0-9._-]{20,}\|Authorization:/g`. Test G-02 induces 400 invalid_grant and asserts no token material in stderr. Test G-03 drives `whoop_doctor` MCP tool against expired-token state and asserts `JSON.stringify(toolsCallResponse)` doesn't match FORBIDDEN. Sanitize.test.ts has F6 (8 positional fixtures) + F7 (D-20 cause-chain fixture). |

**Score:** 4/4 truths verified

### Required Artifacts

| Artifact                                                      | Expected                                                                       | Status     | Details                                                                                                                                                                          |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------ | ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/infrastructure/whoop/token-store.ts`                     | ADR-0002 3-layer gate, dual backends, atomic write (~120 LOC target)           | VERIFIED   | 435 LOC (grew with CR/WR fixes). All exports present: `createTokenStore`, `tokenStore`, `REFRESH_BUFFER_MS`, `WHOOP_TOKEN_URL`, `Tokens`, `StorageMode`, `TokenStoreOptions`, `TokenStore`. Sole `oauth/oauth2/token` consumer (Gate E enforced). |
| `src/infrastructure/whoop/oauth.ts`                           | buildAuthorizeUrl + listenForCallback + exchangeCode + runOAuth                | VERIFIED   | 478 LOC. 127.0.0.1-only binding (line 256). PKCE off by default. WR-01 method/path dispatch added (line 202). OAuth error-code policy (line 94) for BLOCKER 4 / OPEN-Q-01.       |
| `src/services/refresh-orchestrator.ts`                        | 401-reactive retry, budget=1, sibling-aware re-read with REFRESH_BUFFER_MS     | VERIFIED   | 140 LOC. CR-03 fix verified (line 102 uses REFRESH_BUFFER_MS). Singleton + factory. Only consumer of `tokenStore.getValidAccessToken()` outside token-store internals (grep clean). |
| `src/cli/commands/init.ts`                                    | Config bootstrap, env-var precedence, idempotent, atomic write mode 0600       | VERIFIED   | 131 LOC (vs ~80 LOC target — slightly over but reasonable for D-02 instructions block + interactive prompts + atomic-write helper). Imports canonical `ConfigSchema` from schema.ts (DRY-fix). |
| `src/cli/commands/auth.ts`                                    | runOAuth → tokenStore.write → "Authorization complete.", AuthError exit codes | VERIFIED   | 168 LOC (vs ~80 LOC target — grew with CR-04 ZodError handling + duck-type AuthError detection comment). Sanitize() defense-in-depth in outer catch. Imports canonical ConfigSchema. |
| `src/services/doctor/checks/auth.ts`                          | probeAuth — offline-safe, reports keychain/file/missing                       | VERIFIED   | 76 LOC. Never imports `getValidAccessToken`. AuthProbeDeps test seam. WR-06 sanitize wrap on err.message.                                                                          |
| `src/services/doctor/checks/token-freshness.ts`               | probeTokenFreshness — offline-safe, pass/warn/fail per D-14 buffer            | VERIFIED   | 103 LOC. Exports `formatDuration`. REFRESH_BUFFER_MS-aware boundary (line 83).                                                                                                  |
| `tests/integration/auth-concurrency.test.ts`                  | 10-child cross-process AUTH-05 + AUTH-06 grep gate                            | VERIFIED   | 627 LOC. 7 tests: B-01, I-01, I-02, I-03, G-01, G-02, G-03. Uses `fork` + real HTTP mock; G-03 attests D-17 by asserting `tools/list` returns exactly one tool.                  |
| `scripts/ci-grep-gates.sh`                                    | Gates A-E, Gate E new for ADR-0002 §Enforcement                                | VERIFIED   | Gate E grep `oauth/oauth2/token` excludes token-store.ts + *.test.ts (documented exclusion for sanitize.test.ts URL fixture and oauth.test.ts). Gate C broadened to `src/cli/commands/**/*.ts`. |
| `.github/workflows/ci.yml`                                    | matrix os: [macos-latest, ubuntu-latest], ubuntu sets FORCE_FILE_STORE=1      | VERIFIED   | Lines 33-36 matrix block; lines 71-72 env: `RECOVERY_LEDGER_FORCE_FILE_STORE: ${{ matrix.os == 'ubuntu-latest' && '1' \|\| '' }}`.                                                |
| `tsup.config.ts`                                              | Emit `dist/infrastructure/whoop/token-store.mjs` as explicit entry             | VERIFIED   | Build output confirms: `dist/infrastructure/whoop/token-store.mjs (9.50 KB)` emitted after `npm run build`.                                                                       |
| `src/infrastructure/config/paths.ts` + `schema.ts` + `errors.ts` | Wave-0 infra: paths resolver, canonical ConfigSchema+D13_SCOPES, 6-kind AuthError | VERIFIED   | errors.ts line 21-27 ships exactly 6 AuthErrorKind values: auth_missing, auth_expired, auth_state_mismatch, auth_timeout, auth_port_in_use, refresh_failed. schema.ts canonical home for ConfigSchema (no inline `z.object` in init/auth — grep clean). paths.ts uses Proxy for lazy resolution (WR-04 fix). |

### Key Link Verification

| From                                          | To                                                | Via                                                                                              | Status | Details                                                                                                                                              |
| --------------------------------------------- | ------------------------------------------------- | ------------------------------------------------------------------------------------------------ | ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| auth.ts                                       | oauth.ts (runOAuth)                               | `import { runOAuth }`, called with redirectPort + scopes                                          | WIRED  | auth.ts:29, auth.ts:97.                                                                                                                              |
| auth.ts                                       | token-store.ts (tokenStore.write)                 | `import { tokenStore }`, `tokenStore.write(tokens)`                                              | WIRED  | auth.ts:30, auth.ts:112. tokenStore.write acquires the lock (WR-03 fix).                                                                              |
| auth.ts + init.ts                             | schema.ts (canonical ConfigSchema)                | `import { ConfigSchema, D13_SCOPES, type InitConfig }`                                            | WIRED  | DRY-fix verified — `grep z.object\(` returns no matches in init.ts/auth.ts.                                                                          |
| refresh-orchestrator.ts                       | token-store.ts (getValidAccessToken + REFRESH_BUFFER_MS) | `import { tokenStore, REFRESH_BUFFER_MS }`                                                  | WIRED  | line 32-35 + line 84 + line 102 + line 113. Only consumer outside token-store internals (grep clean).                                                |
| token-store.ts                                | proper-lockfile                                   | `lockfile.lock(paths.tokensLockFile, {retries:{retries:10, factor:1.2, minTimeout:50}, stale:5000})` | WIRED  | lines 206-209 (public write) + lines 288-291 (doRefresh) — both code paths use identical options.                                                  |
| token-store.ts                                | @napi-rs/keyring (Entry)                          | `Entry(KEYRING_SERVICE, KEYRING_ACCOUNT).setPassword` + roundtrip getPassword                    | WIRED  | lines 229-237 — Pitfall F roundtrip verification in place.                                                                                            |
| token-store.ts (doRefresh)                    | WHOOP token endpoint                              | `fetchFn(WHOOP_TOKEN_URL, {method:'POST', body: URLSearchParams})`                                | WIRED  | line 359; sends `fresh ?? stale` refresh_token (CR-01 fix line 326), omits `scope` (CR-02 fix lines 349-354).                                       |
| oauth.ts (failureHtml)                        | src/mcp/sanitize.ts                                | `failureHtml` runs detail through `sanitize()` before HTML insertion                              | WIRED  | line 336: `${escapeHtml(sanitize(detail))}` — cross-layer import accepted per ADR-0001 §Consequences.                                                |
| auth.ts (outer catch)                         | src/mcp/sanitize.ts (CR-04)                       | `process.stdout.write(\`auth failed: ${sanitize(String(err))}\`)`                                | WIRED  | line 140 — defense-in-depth for non-AuthError shapes.                                                                                                |
| doctor/checks/auth.ts + token-freshness.ts    | src/mcp/sanitize.ts (WR-06)                       | catch arm: `sanitize(err instanceof Error ? err.message : String(err))`                          | WIRED  | auth.ts:73 + token-freshness.ts:100.                                                                                                                 |
| doctor/index.ts (runDoctor)                   | probeAuth + probeTokenFreshness                   | `Promise.allSettled([..., probeAuth(), probeTokenFreshness()])`                                  | WIRED  | lines 141-148. PROBE_NAMES (lines 110-116) extended to 5 entries in positional alignment.                                                            |
| .github/workflows/ci.yml (ubuntu row)         | RECOVERY_LEDGER_FORCE_FILE_STORE=1                | matrix-conditional env on Test step                                                              | WIRED  | line 72: `${{ matrix.os == 'ubuntu-latest' && '1' \|\| '' }}`.                                                                                       |

### Data-Flow Trace (Level 4)

| Artifact                              | Data Variable                        | Source                                                                       | Produces Real Data | Status   |
| ------------------------------------- | ------------------------------------ | --------------------------------------------------------------------------- | ------------------ | -------- |
| token-store.ts (getValidAccessToken)  | `tokens.accessToken`                | Real WHOOP refresh POST → Zod-parsed TokenResponseSchema → write to disk    | Yes                | FLOWING  |
| auth.ts (runAuthCommand)              | `tokens` from runOAuth              | OAuth Authorization Code flow → exchangeCode POST → Zod-parsed response   | Yes                | FLOWING  |
| doctor/checks/auth.ts (probeAuth)     | `mode` (keychain/file/null)          | `tokenStore.readStorageMode()` reads on-disk marker file                    | Yes                | FLOWING  |
| doctor/checks/token-freshness.ts      | `tokens.expiresAt`                   | `tokenStore.read()` reads from disk + Zod parse                              | Yes                | FLOWING  |
| refresh-orchestrator.ts (callWithAuth)| `accessToken`                        | `store.getValidAccessToken()` triggers actual refresh through 3-layer gate  | Yes                | FLOWING  |
| init.ts (runInitCommand)              | `config.clientId/clientSecret`       | Env vars OR readline prompts → Zod-validated → JSON.stringify atomic write  | Yes                | FLOWING  |

### Behavioral Spot-Checks

| Behavior                                       | Command                                          | Result                                                                                          | Status |
| ---------------------------------------------- | ------------------------------------------------ | ----------------------------------------------------------------------------------------------- | ------ |
| `npm run build` emits all three entries        | `npm run build && ls dist/`                      | `dist/cli.mjs`, `dist/mcp.mjs`, `dist/infrastructure/whoop/token-store.mjs` all present          | PASS   |
| CLI lists init and auth subcommands            | `node dist/cli.mjs --help`                       | Output contains `init` and `auth` commands with descriptions                                    | PASS   |
| Test suite passes                              | `npm run test`                                   | 255/255 tests pass across 20 test files (5.84s)                                                  | PASS   |
| Lint passes                                    | `npm run lint`                                   | `Checked 46 files in 19ms. No fixes applied.`                                                   | PASS   |
| CI grep gates pass (A/B/C/D/E)                 | `bash scripts/ci-grep-gates.sh`                  | `All grep gates passed.`                                                                        | PASS   |
| token-store is sole `oauth/oauth2/token` consumer | `grep -rEn "oauth/oauth2/token" src/`         | Two matches: token-store.ts:47 + sanitize.test.ts:511 (test fixture — gate excludes *.test.ts) | PASS   |
| refresh-orchestrator is sole `getValidAccessToken` consumer | `grep -rEn "\.getValidAccessToken" src/` excluding token-store + test files | Only refresh-orchestrator.ts hits (lines 84 + 113); comments elsewhere       | PASS   |
| Only one MCP tool registered (D-17)            | grep `register\('whoop_` in src/mcp/             | Single hit: `register(server, 'whoop_doctor', ...)`                                             | PASS   |

### Requirements Coverage

| Requirement | Source Plan(s)                | Description                                                                                             | Status     | Evidence                                                                                                                                                                                                |
| ----------- | ----------------------------- | ------------------------------------------------------------------------------------------------------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| AUTH-01     | 02-01, 02-03, 02-05           | BYO WHOOP credentials via `recovery-ledger init` with dynamic loopback-port OAuth callback              | SATISFIED  | init.ts writes config.json with redirectPort; oauth.ts binds 127.0.0.1 with OS-assigned port (port 0 in tests); runOAuth uses `info.port` for redirect_uri (WR-07 pinning).                              |
| AUTH-02     | 02-03, 02-05                  | `recovery-ledger auth` initiates OAuth Authorization Code flow, exchanges code for tokens, reports success | SATISFIED | auth.ts:97-115 calls runOAuth, persists via tokenStore.write, prints `Authorization complete.` Test A-01 in auth.test.ts pins.                                                                          |
| AUTH-03     | 02-02, 02-06                  | Tokens stored via @napi-rs/keyring with chmod 600 file fallback, surfaced by `doctor`                   | SATISFIED  | token-store.ts dual backend with Pitfall F roundtrip + storage-mode cache; doctor/checks/auth.ts emits `auth: keychain` / `auth: file (mode 0600)` / `no tokens` per D-21.1.                            |
| AUTH-04     | 02-04                         | Token-refresh wrapper transparently refreshes expired tokens and retries on 401                          | SATISFIED  | token-store.ts preemptive (REFRESH_BUFFER_MS) + refresh-orchestrator.ts 401-reactive retry (budget=1). CR-03 fix makes post-401 re-read symmetric with preemptive check.                                |
| AUTH-05     | 02-02 (unit), 02-04 (orchestrator), 02-08 (cross-process) | Single-flight refresh: in-process Promise + cross-process file lock + atomic write | SATISFIED  | token-store.ts implements 3-layer gate. tests/integration/auth-concurrency.test.ts Test I-01: 10 forked children → `count === 1`. proper-lockfile options exactly match ADR-0002 spec.                  |
| AUTH-06     | 02-07 (fixtures), 02-08 (integration) | Token-leak prevention: error messages and MCP tool error returns never expose token material         | SATISFIED  | sanitize.test.ts F6 (8 positional fixtures) + F7 (D-20 cause-chain) all pass. tests/integration/auth-concurrency.test.ts G-01..G-03 assert FORBIDDEN regex never matches in stderr/MCP errors.        |

**REQUIREMENTS.md traceability table:** All six AUTH-* IDs marked "Complete" in lines 135-140. The pre-execution concern raised in the verifier brief — that Plan 02-01's executor marked AUTH-01..05 complete after only Wave-0 delivery — is materially addressed: the END STATE after all 8 plans landed satisfies each AUTH-* requirement, as evidenced by source artifacts + tests above. AUTH-01 (BYO credentials via init) requires init.ts (Plan 02-05) — present. AUTH-02 (auth code flow) requires oauth.ts (Plan 02-03) + auth.ts (Plan 02-05) — both present. AUTH-03 requires the doctor probes (Plan 02-06) — present. AUTH-04+05 require the refresh-orchestrator (Plan 02-04) and the cross-process integration (Plan 02-08) — both present.

### Anti-Patterns Found

| File                                          | Line | Pattern                                                                          | Severity | Impact                                                                                                                                              |
| --------------------------------------------- | ---- | -------------------------------------------------------------------------------- | -------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| (none)                                        | —    | No `TBD`, `FIXME`, or `XXX` debt markers in any Phase 2 source file              | INFO     | Verified via `grep -nE "TBD\|FIXME\|XXX"` across token-store.ts, refresh-orchestrator.ts, auth.ts, init.ts, oauth.ts, doctor/checks/auth.ts, token-freshness.ts. |
| `src/cli/commands/init.ts`                    | —    | 131 LOC vs plan's "~80 LOC" target                                               | INFO     | Cited in verifier brief as concern. Acceptable: extra LOC comes from D-02 instructions block (8 lines), `writeConfigAtomic` helper (10 lines), and interactive readline prompts. Not a deviation worth flagging — no debt, just longer-than-target. |
| `src/cli/commands/auth.ts`                    | —    | 168 LOC vs plan's "~80 LOC" target                                               | INFO     | Cited in verifier brief. The CR-04 ZodError pre-filter (lines 76-91, ~16 LOC) + duck-type AuthError detection helper (`isAuthErrorShape` + `AUTH_ERROR_KINDS`, ~15 LOC) account for the growth. All additions are documented (CR-04 comment block, Plan 02-04 deviation note for duck-typing under vi.resetModules). Not a deviation worth flagging — the target was advisory, not contractual. |

### Code-Review Fix Spot-Check (CR-01..CR-04)

The verifier brief explicitly asked for independent spot-checks of the four critical-review fixes:

| Fix    | Code Location                                          | Verification                                                                                                                                                                                                                  | Status   |
| ------ | ------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| CR-01  | `src/infrastructure/whoop/token-store.ts:326`         | `const next = await callRefreshEndpoint(fresh ?? stale);` — sends the post-lock fresh refresh_token (sibling-rotated) when available, falling back to pre-lock stale only when on-disk read returned null. Comment lines 319-325 document RFC-grade rationale. | VERIFIED |
| CR-02  | `src/infrastructure/whoop/token-store.ts:349-354`     | URLSearchParams body contains `grant_type=refresh_token`, `refresh_token`, `client_id`, `client_secret` only — `scope` is intentionally omitted. Comment lines 342-348 cite RFC 6749 §6 and mirror oauth.ts exchangeCode behavior. | VERIFIED |
| CR-03  | `src/services/refresh-orchestrator.ts:102`             | `if (current !== null && current.expiresAt > Date.now() + REFRESH_BUFFER_MS)` — symmetric with token-store.ts's preemptive check at line 267 (same constant imported from token-store). Comment lines 95-100 document why. | VERIFIED |
| CR-04  | `src/cli/commands/auth.ts:76-91`                       | ZodError prefiltered: `parseErr instanceof z.ZodError` → emit field-names-only remediation (no raw err.message). Non-Zod parse errors get generic "not valid JSON" message. Outer-catch at line 140 routes `String(err)` through `sanitize()`. | VERIFIED |

All four fixes are committed (a8566b5, 7a1cd82, cea871a, bf4b6f3 confirmed via `git log`). Each fix has a corresponding regression test (L-03 sibling-rotated, L-04/L-05 no-scope-on-wire, R-04 near-expiry-not-handed-back, A-11/A-12 clientSecret-fingerprint-not-leaked).

### Human Verification Required

(none — every must-have is verifiable programmatically and the test suite covers all paths)

### Gaps Summary

No gaps identified. The phase goal — "Concurrent CLI + MCP processes can refresh WHOOP tokens without ever burning the refresh-token family; tokens never appear in plaintext at rest or in error returns" — is achieved end-to-end:

1. **Single-flight contract holds** at three layers (in-process Promise + proper-lockfile + atomic write), verified by both the unit test (token-store.test.ts) and the cross-process integration test (auth-concurrency.test.ts I-01 with 10 forked children → exactly one POST).
2. **Tokens never leak in plaintext** at rest (keyring primary, file fallback chmod 600 via atomic temp-and-rename) or in errors (sanitize.test.ts F6/F7 + auth-concurrency.test.ts G-01/G-02/G-03 grep FORBIDDEN regex assertions).
3. **All four ROADMAP success criteria** are CI-enforced.
4. **All six AUTH-* requirements** are satisfied with implementation evidence + tests.
5. **All four critical code-review findings** (CR-01..CR-04) plus eleven warnings (WR-01..WR-11) are committed with pinning regression tests.
6. **Build + lint + 255 tests + grep gates** all pass.

The LOC overruns on init.ts (131 vs ~80) and auth.ts (168 vs ~80) are flagged as INFO only — the plan's target was advisory, and the overage is fully attributable to documented hardening additions (CR-04 ZodError handling, duck-type AuthError detection for Vitest module-reset robustness, D-02 instructions block). No debt markers exist in any modified source file.

---

_Verified: 2026-05-12T17:10:00Z_
_Verifier: Claude (gsd-verifier, sonnet)_
