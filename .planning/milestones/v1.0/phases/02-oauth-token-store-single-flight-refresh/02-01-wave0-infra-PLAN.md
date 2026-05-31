---
phase: 02-oauth-token-store-single-flight-refresh
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - package.json
  - package-lock.json
  - src/infrastructure/config/paths.ts
  - src/infrastructure/config/paths.test.ts
  - src/infrastructure/config/schema.ts
  - src/infrastructure/config/schema.test.ts
  - src/infrastructure/whoop/errors.ts
  - src/infrastructure/whoop/errors.test.ts
  - tests/helpers/msw-whoop-oauth.ts
  - test/fixtures/oauth/token-200.json
  - test/fixtures/oauth/token-400-invalid-grant.json
  - test/fixtures/oauth/authorize-callback-state-mismatch.html
autonomous: true
requirements:
  - AUTH-01
  - AUTH-02
  - AUTH-03
  - AUTH-04
  - AUTH-05
user_setup: []

must_haves:
  truths:
    - "Phase 2 runtime deps (proper-lockfile@^4.1.2, open@^11.0.0) installed and resolved in node_modules."
    - "Phase 2 dev deps (msw@^2.14.6, @types/proper-lockfile) installed and resolved in node_modules."
    - "src/infrastructure/config/paths.ts exports resolvePaths(env) and a singleton paths bound to process.env."
    - "src/infrastructure/whoop/errors.ts exports AuthError as a discriminated union over {auth_missing, auth_expired, auth_state_mismatch, auth_timeout, auth_port_in_use, refresh_failed} — the 6th kind (auth_port_in_use) is added in Wave 0 so Wave 2 plans (02-02 token-store and 02-03 oauth) both consume a stable errors.ts surface."
    - "src/infrastructure/config/schema.ts exports the canonical ConfigSchema (Zod) + InitConfig type — the single source of truth that Plan 02-05's init.ts AND auth.ts both import, eliminating the duplicate-schema DRY violation flagged by the checker."
    - "tests/helpers/msw-whoop-oauth.ts exports a setupServer factory keyed to api.prod.whoop.com/oauth/oauth2/token with a per-call hit counter."
    - "test/fixtures/oauth/ contains token-200.json, token-400-invalid-grant.json, authorize-callback-state-mismatch.html."
  artifacts:
    - path: "src/infrastructure/config/paths.ts"
      provides: "Resolver for ~/.recovery-ledger/ paths with RECOVERY_LEDGER_HOME override (D-03/D-06/D-07)."
      contains: "export function resolvePaths"
    - path: "src/infrastructure/config/paths.test.ts"
      provides: "Unit coverage for the resolver — default home, env override, all five derived paths."
      contains: "configDir"
    - path: "src/infrastructure/config/schema.ts"
      provides: "Canonical ConfigSchema (Zod) + InitConfig type re-used by init.ts AND auth.ts (Plan 02-05). DRY-fix per checker WARNING PLAN-05-DRY-VIOLATION."
      contains: "ConfigSchema"
    - path: "src/infrastructure/config/schema.test.ts"
      provides: "Unit coverage for ConfigSchema parse — happy path + clientId regex rejection + redirectPort coercion."
      contains: "ConfigSchema"
    - path: "src/infrastructure/whoop/errors.ts"
      provides: "AuthError discriminated-union module (Auth/OAuth error contract for the phase) — 6 kinds including auth_port_in_use (moved into Wave 0 to keep Wave 2's errors.ts stable; see checker BLOCKER 1)."
      contains: "export type AuthError"
    - path: "src/infrastructure/whoop/errors.test.ts"
      provides: "Exhaustive-switch test on AuthError kinds (forcing function per MR-21 voice). Covers all 6 kinds including auth_port_in_use."
      contains: "auth_missing"
    - path: "tests/helpers/msw-whoop-oauth.ts"
      provides: "Shared MSW WHOOP token-endpoint handler + per-call counter for unit tests."
      contains: "api.prod.whoop.com/oauth/oauth2/token"
    - path: "test/fixtures/oauth/token-200.json"
      provides: "Happy-path WHOOP token-endpoint response fixture."
      contains: "access_token"
    - path: "test/fixtures/oauth/token-400-invalid-grant.json"
      provides: "Refresh-token reuse / family revocation fixture."
      contains: "invalid_grant"
    - path: "test/fixtures/oauth/authorize-callback-state-mismatch.html"
      provides: "Static HTML fixture used by oauth.test.ts state-mismatch arm."
      contains: "Authorization failed"
  key_links:
    - from: "src/infrastructure/config/paths.ts"
      to: "process.env.RECOVERY_LEDGER_HOME"
      via: "factory accepts a PathsEnv arg, singleton constructed from process.env"
      pattern: "resolvePaths\\(process\\.env\\)"
    - from: "src/infrastructure/config/schema.ts"
      to: "src/cli/commands/init.ts + src/cli/commands/auth.ts (Plan 02-05)"
      via: "Plan 02-05's init.ts and auth.ts both `import { ConfigSchema, type InitConfig } from '../../infrastructure/config/schema.js'` — single source of truth"
      pattern: "from '../../infrastructure/config/schema"
    - from: "src/infrastructure/whoop/errors.ts"
      to: "src/mcp/sanitize.ts (Phase 1)"
      via: "AuthError carries .cause; serializeError walks the cause chain through sanitize()"
      pattern: "kind: 'refresh_failed'"
    - from: "tests/helpers/msw-whoop-oauth.ts"
      to: "msw/node setupServer"
      via: "http.post handler with a closure-scoped counter"
      pattern: "refreshHitCount"
---

<objective>
Land the Wave-0 infrastructure that every other Phase 2 plan depends on: install the four new npm dependencies, scaffold the path resolver, define the AuthError discriminated union (all 6 kinds including auth_port_in_use — moved into Wave 0 per checker BLOCKER 1 so Wave 2 plans both consume a stable errors.ts), extract the canonical ConfigSchema (per checker WARNING PLAN-05-DRY-VIOLATION), and stand up the shared MSW WHOOP token-endpoint helper plus committed JSON/HTML test fixtures.

Purpose: Plans 02, 03, 04, 05, 06, 07, 08 all import from these modules or use these fixtures. Until paths, errors, schema, the MSW helper, and the fixtures exist, nothing else in Phase 2 can compile or run. This plan is the precondition for all Wave-1+ work.

Output: Three new TS modules (paths.ts, schema.ts, errors.ts) with co-located tests, one shared MSW helper, three committed test fixtures, and four new npm dependencies recorded in package.json + package-lock.json.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/PROJECT.md
@.planning/REQUIREMENTS.md
@.planning/ROADMAP.md
@.planning/STATE.md
@.planning/phases/02-oauth-token-store-single-flight-refresh/02-CONTEXT.md
@.planning/phases/02-oauth-token-store-single-flight-refresh/02-RESEARCH.md
@.planning/phases/02-oauth-token-store-single-flight-refresh/02-PATTERNS.md
@CLAUDE.md
@agent_docs/conventions.md
@agent_docs/decisions/0001-mcp-stdout-purity.md
@agent_docs/decisions/0002-single-flight-oauth-refresh.md
@agent_docs/decisions/0006-fixture-only-tests.md
@agent_docs/decisions/0007-whoop-read-only.md
@src/infrastructure/config/logger.ts
@src/services/doctor/index.ts

<interfaces>
<!-- Module conventions Wave-0 must mirror. Copy the factory+singleton shape verbatim from logger.ts. -->

From src/infrastructure/config/logger.ts (Phase 1 — closest analog for paths.ts):
- Pattern: factory `resolveLoggerOptions(env: LoggerEnv): ResolvedLoggerOptions` PLUS a singleton bound to `process.env`.
- Exports are named only (no default exports — see conventions.md line 14).
- Imports `pino` and writes to stderr (fd 2) — but the paths module has no logger; it is pure.

From src/services/doctor/index.ts (Phase 1 — closest analog for the AuthError MR-21 closed-union voice):
- DoctorCheck.status `'pass' | 'warn' | 'fail'` is INTENTIONALLY CLOSED — comment explains the cross-reference forcing function.
- Copy this comment voice verbatim onto AuthError, citing src/cli/commands/auth.ts AUTH_EXIT_CODES (Plan 05) and src/formatters/doctor.txt.ts (Phase 1) as the consumers that must stay in sync.

PathsEnv + ResolvedPaths shape (per 02-PATTERNS.md lines 512-528):
- `interface PathsEnv { RECOVERY_LEDGER_HOME?: string; HOME?: string; }`
- `interface ResolvedPaths { configDir, configFile, tokensFile, tokensLockFile, storageModeFile: string; }`
- All five paths derived: configDir = `${RECOVERY_LEDGER_HOME ?? HOME + '/.recovery-ledger'}`, others by `path.join(configDir, '<basename>')`.

AuthError kinds (per 02-RESEARCH.md line 484 + 02-PATTERNS.md line 481-484, EXTENDED in revision to include auth_port_in_use per checker BLOCKER 1):
- `auth_missing | auth_expired | auth_state_mismatch | auth_timeout | auth_port_in_use | refresh_failed`
- `auth_port_in_use` was previously planned to be added in Plan 02-03 (Wave 2). The checker flagged this as DEP-CONFLICT-01 because Plan 02-02 (also Wave 2) imports `AuthError` from errors.ts; same-wave file overlap on errors.ts is a load-bearing safety property. Option A (chosen): move the kind into Wave 0 so errors.ts is stable from Wave 0 onward and Wave 2 plans both consume an unchanging surface. Plans 02-02, 02-03, 02-04, 02-05 all see the full 6-kind union.
- Carrier shape: Error subclass with discriminator field `kind` (per PATTERNS.md line 486 — "cleaner because it inherits stack traces and works through serializeError without special handling").

ConfigSchema canonical home (added in revision per checker WARNING PLAN-05-DRY-VIOLATION):
- `src/infrastructure/config/schema.ts` exports `ConfigSchema` (Zod) + `InitConfig` type.
- Plan 02-05's init.ts AND auth.ts both import from this module. NO duplicate schema definitions.
- Schema shape: `z.object({ clientId: z.string().regex(/^[A-Za-z0-9._~-]+$/), clientSecret: z.string().min(1), redirectPort: z.number().int().positive(), scopes: z.array(z.string()).nonempty() })`.
- D-13 scope set constant: `export const D13_SCOPES = Object.freeze(['offline', 'read:recovery', 'read:sleep', 'read:workout', 'read:cycles', 'read:profile', 'read:body_measurement'] as const);` — both init.ts and auth.ts use this as the default.

MSW WHOOP token-endpoint handler (per 02-RESEARCH.md lines 962-994):
- `http.post('https://api.prod.whoop.com/oauth/oauth2/token', ...)`
- Per-call counter incremented on each hit, returns JSON-shaped response from fixture file.
- Factory exports `{ server, getRefreshHitCount, resetRefreshHitCount }` so each test file can `import { ... }` and call `server.listen()`/`server.close()` in its own lifecycle.
</interfaces>
</context>

<tasks>

<task type="auto">
  <name>Task 1: Install Phase 2 dependencies and scaffold MSW + fixtures</name>
  <files>
    package.json,
    package-lock.json,
    tests/helpers/msw-whoop-oauth.ts,
    test/fixtures/oauth/token-200.json,
    test/fixtures/oauth/token-400-invalid-grant.json,
    test/fixtures/oauth/authorize-callback-state-mismatch.html
  </files>
  <read_first>
    - package.json (current dependency list — must extend, not replace)
    - .planning/phases/02-oauth-token-store-single-flight-refresh/02-RESEARCH.md (lines 168-179 for exact version pins; lines 962-994 for MSW handler shape; line 327-330 for fixture file list)
    - .planning/phases/02-oauth-token-store-single-flight-refresh/02-CONTEXT.md (D-03 to D-07 for path layout; D-23 for test mechanics)
    - .planning/phases/02-oauth-token-store-single-flight-refresh/02-PATTERNS.md (lines 606-616 — fixture path convention: `test/fixtures/oauth/` per RESEARCH; lines 745-746 for `pool: 'forks'` + `vi.resetModules` rationale)
    - agent_docs/conventions.md (line 45: MSW 2 intercepts fetch, one handler file per resource)
    - agent_docs/decisions/0006-fixture-only-tests.md (no live WHOOP)
    - src/services/doctor/checks/fixtures.ts (Phase 1 — vendored-as-TS JSON-RPC fixtures; NOT the pattern for OAuth fixtures, but useful precedent on fixture style)
  </read_first>
  <action>
    Install runtime deps and dev deps. Run exactly: `npm install proper-lockfile@^4.1.2 open@^11.0.0` then `npm install -D msw@^2.14.6 @types/proper-lockfile`. Do not bump any existing dep. Do not pass --no-save or --legacy-peer-deps.

    Create `tests/helpers/msw-whoop-oauth.ts` (named-export only, no `export default`). Module exports:
    - `export const WHOOP_TOKEN_URL = 'https://api.prod.whoop.com/oauth/oauth2/token'` (single source of truth; reused by token-store.ts later — but at install time it is only referenced from this file).
    - `export interface WhoopOauthHelper { server: SetupServer; getRefreshHitCount(): number; resetRefreshHitCount(): void; setNextResponse(body: object, status?: number): void; }`
    - `export function createWhoopOauthHelper(): WhoopOauthHelper` — uses `setupServer` from `msw/node` + `http.post(WHOOP_TOKEN_URL, handler)`. Default handler increments a closure counter, reads `test/fixtures/oauth/token-200.json` and returns it with `HttpResponse.json(...)`. `setNextResponse` overrides the next single response only.
    - Caller is responsible for `server.listen()` / `server.close()` (per RESEARCH line 982-984).

    Create the three fixtures at the paths in <files>:
    - `test/fixtures/oauth/token-200.json` — verbatim JSON object: `{"access_token":"at-1","refresh_token":"rt-1","expires_in":3600,"scope":"offline read:recovery read:sleep read:workout read:cycles read:profile read:body_measurement","token_type":"bearer"}`
    - `test/fixtures/oauth/token-400-invalid-grant.json` — verbatim: `{"error":"invalid_grant","error_description":"refresh token reused"}` (per Pitfall A — RESEARCH line 549-556).
    - `test/fixtures/oauth/authorize-callback-state-mismatch.html` — verbatim D-09 failure HTML body for the state-mismatch case: `<!doctype html><meta charset="utf-8"><title>Recovery Ledger — auth failed</title><h1>Authorization failed</h1><pre>state mismatch</pre><p>Return to your terminal and run <code>recovery-ledger auth</code> again.</p>` — used as the expected-output fixture in oauth.test.ts state-mismatch arm in Plan 03.

    The `test/fixtures/oauth/` path is chosen per RESEARCH line 614 (recommended project structure). Phase 2 standardizes on `test/fixtures/oauth/` (matching Phase 1's `test/fixtures/`) — agent_docs/conventions.md mentions `tests/fixtures/whoop/<resource>/` for the WHOOP-resource convention which Phase 3 will own; OAuth fixtures use `test/fixtures/oauth/` as a one-off scope and that decision is recorded here. Do NOT create both directories.

    No `console.*` in `tests/helpers/msw-whoop-oauth.ts` — it lives under tests/ so Gate B's exemption already covers it, but stay clean anyway.
  </action>
  <verify>
    <automated>npm ls proper-lockfile open msw @types/proper-lockfile --depth=0 &amp;&amp; test -f test/fixtures/oauth/token-200.json &amp;&amp; test -f test/fixtures/oauth/token-400-invalid-grant.json &amp;&amp; test -f test/fixtures/oauth/authorize-callback-state-mismatch.html &amp;&amp; node -e "JSON.parse(require('node:fs').readFileSync('test/fixtures/oauth/token-200.json','utf8'))" &amp;&amp; node -e "JSON.parse(require('node:fs').readFileSync('test/fixtures/oauth/token-400-invalid-grant.json','utf8'))"</automated>
  </verify>
  <acceptance_criteria>
    - `package.json` `dependencies` contains `proper-lockfile` matching `^4.1.2` (run `node -e "console.log(require('./package.json').dependencies['proper-lockfile'])"` and assert non-empty and matches `^4.1`).
    - `package.json` `dependencies` contains `open` matching `^11.0.0`.
    - `package.json` `devDependencies` contains `msw` matching `^2.14.6` and `@types/proper-lockfile`.
    - `npm ls proper-lockfile open msw @types/proper-lockfile --depth=0` exits 0.
    - `tests/helpers/msw-whoop-oauth.ts` exists with `export const WHOOP_TOKEN_URL`, `export function createWhoopOauthHelper`, `export interface WhoopOauthHelper`. No `export default` (run `grep -c '^export default' tests/helpers/msw-whoop-oauth.ts` returns `0`).
    - All three fixture files exist at the paths listed and parse cleanly (the two JSON files parse via `JSON.parse`; the HTML file is a non-empty file).
    - No `console.*` in `tests/helpers/msw-whoop-oauth.ts` (run `grep -nE 'console\.(log|info|warn|error|debug|trace)' tests/helpers/msw-whoop-oauth.ts` returns no matches).
    - `npm run lint` exits 0 (no Biome errors introduced).
  </acceptance_criteria>
  <done>
    All four packages installed and lock-file updated; MSW helper exports the three named symbols; three fixtures committed and parseable; lint clean.
  </done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: paths.ts resolver + schema.ts (canonical ConfigSchema) + AuthError discriminated union (with co-located tests)</name>
  <files>
    src/infrastructure/config/paths.ts,
    src/infrastructure/config/paths.test.ts,
    src/infrastructure/config/schema.ts,
    src/infrastructure/config/schema.test.ts,
    src/infrastructure/whoop/errors.ts,
    src/infrastructure/whoop/errors.test.ts
  </files>
  <read_first>
    - src/infrastructure/config/logger.ts (analog for paths.ts — copy the factory+singleton+env-arg shape verbatim, lines 56-92)
    - src/services/doctor/index.ts (analog for AuthError MR-21 closed-union voice — lines 26-50 doc-comment style)
    - src/services/doctor/checks/native-modules.test.ts (analog test shape — lines 11-30 import + happy-path pattern)
    - .planning/phases/02-oauth-token-store-single-flight-refresh/02-PATTERNS.md (lines 471-486 for AuthError shape and MR-21 voice; lines 489-531 for paths.ts shape)
    - .planning/phases/02-oauth-token-store-single-flight-refresh/02-CONTEXT.md (D-03 `~/.recovery-ledger/`; D-07 lockfile path; D-13 scope set; deferred ideas — no AES file fallback)
    - .planning/phases/02-oauth-token-store-single-flight-refresh/02-RESEARCH.md (Pitfall E — storage-mode flipping; section §Validation Architecture lines 919-955 for test mapping)
    - agent_docs/conventions.md (lines 13-14: TS strict, named exports only; line 33: validation at boundaries)
  </read_first>
  <behavior>
    paths.ts:
    - Test 1: `resolvePaths({HOME: '/home/u'}).configDir === '/home/u/.recovery-ledger'`.
    - Test 2: `resolvePaths({HOME: '/home/u', RECOVERY_LEDGER_HOME: '/tmp/r'}).configDir === '/tmp/r'` (env override wins).
    - Test 3: `resolvePaths({HOME: '/home/u'})` returns all five derived paths joined under configDir: configFile, tokensFile, tokensLockFile, storageModeFile.
    - Test 4: `resolvePaths({HOME: '/home/u'}).tokensLockFile === '/home/u/.recovery-ledger/tokens.json.lock'` — the lock file basename is exactly `tokens.json.lock` per D-07.
    - Test 5: when both HOME and RECOVERY_LEDGER_HOME are undefined, resolvePaths throws an Error mentioning either `HOME` or `RECOVERY_LEDGER_HOME` (no implicit fallback to `process.cwd()` — fail loudly).

    schema.ts (NEW — checker WARNING PLAN-05-DRY-VIOLATION fix):
    - Test SC-01: `ConfigSchema.parse({clientId: 'abc-123', clientSecret: 'sec', redirectPort: 4321, scopes: ['offline']})` returns the same object shape.
    - Test SC-02: `ConfigSchema.parse({clientId: 'bad/value', ...})` throws ZodError (clientId regex rejects `/`).
    - Test SC-03: `ConfigSchema.parse({...redirectPort: 0, ...})` throws ZodError (positive int constraint).
    - Test SC-04: `ConfigSchema.parse({...scopes: [], ...})` throws ZodError (nonempty array constraint).
    - Test SC-05: `D13_SCOPES` is frozen and contains exactly the 7 D-13 strings in the canonical order.

    errors.ts:
    - Test 6: `new AuthError({kind: 'auth_missing'}).kind === 'auth_missing'` and `instanceof Error` is true (preserves stack).
    - Test 7: an exhaustive `switch (err.kind)` over the SIX kinds compiles without a `default` arm (verified by a `formatAuthError` helper exported alongside; if a seventh kind is added without updating the switch, TS errors — that compile error IS the test).
    - Test 8: `new AuthError({kind: 'refresh_failed', cause: new Error('network')}).cause instanceof Error` — cause chain preserved for Phase 1's serializeError walker.
    - Test 9: `JSON.stringify` of an AuthError instance does NOT contain the raw cause's message (Error toJSON returns `{}` by default — Phase 1 sanitizer is invoked separately; this test pins the carrier shape).
    - Test 10 (NEW — moved from Plan 02-03 per checker BLOCKER 1): `new AuthError({kind: 'auth_port_in_use', detail: 'port 4321'}).kind === 'auth_port_in_use'`.
    - Test 11 (NEW — moved from Plan 02-03 per checker BLOCKER 1): `formatAuthError({kind: 'auth_port_in_use', detail: 'port 4321'} as AuthError)` returns a non-empty string mentioning `init` or `port`.
  </behavior>
  <action>
    Create `src/infrastructure/config/paths.ts`. Named exports only. Shape per PATTERNS.md lines 512-528:
    - `export interface PathsEnv { RECOVERY_LEDGER_HOME?: string; HOME?: string; }`
    - `export interface ResolvedPaths { configDir: string; configFile: string; tokensFile: string; tokensLockFile: string; storageModeFile: string; }`
    - `export function resolvePaths(env: PathsEnv): ResolvedPaths` — builds configDir as `env.RECOVERY_LEDGER_HOME ?? path.join(env.HOME, '.recovery-ledger')`. Throws an Error with message `'RECOVERY_LEDGER_HOME or HOME must be set'` when neither is defined.
    - Derived basenames (verbatim): `config.json`, `tokens.json`, `tokens.json.lock`, `storage-mode`. Use `node:path` join (not string concat).
    - `export const paths = resolvePaths(process.env)` — singleton bound at module load. No `process.env` reads inside the factory function.

    Create `src/infrastructure/config/schema.ts` (NEW per checker WARNING PLAN-05-DRY-VIOLATION). Named exports only. Module-leading doc comment cites D-01, D-06, D-13 and explains this is the canonical shape consumed by init.ts AND auth.ts in Plan 02-05.
    - `import { z } from 'zod';`
    - `export const D13_SCOPES = Object.freeze(['offline', 'read:recovery', 'read:sleep', 'read:workout', 'read:cycles', 'read:profile', 'read:body_measurement'] as const);`
    - `export const ConfigSchema = z.object({ clientId: z.string().regex(/^[A-Za-z0-9._~-]+$/), clientSecret: z.string().min(1), redirectPort: z.number().int().positive(), scopes: z.array(z.string()).nonempty() });`
    - `export type InitConfig = z.infer<typeof ConfigSchema>;`
    - Pure module — no side effects, no logger imports, no process.env reads.

    Create `src/infrastructure/whoop/errors.ts`. Named exports only. Shape per PATTERNS.md line 471-486, EXTENDED in revision to include auth_port_in_use:
    - Module-leading doc comment in the MR-21 voice — explain that `AuthErrorKind` is INTENTIONALLY CLOSED at SIX kinds; adding a seventh kind requires updating `AUTH_EXIT_CODES` in `src/cli/commands/auth.ts` (Plan 05) AND `formatAuthError` here. Cite ADR-0002. Also explicitly note that `auth_port_in_use` was moved into Wave 0 (revision iteration 1) per checker BLOCKER 1 to keep errors.ts stable across same-wave Plan 02-02 and Plan 02-03 consumers.
    - `export type AuthErrorKind = 'auth_missing' | 'auth_expired' | 'auth_state_mismatch' | 'auth_timeout' | 'auth_port_in_use' | 'refresh_failed';`
    - `export interface AuthErrorInit { kind: AuthErrorKind; detail?: string; cause?: unknown; }`
    - `export class AuthError extends Error { readonly kind: AuthErrorKind; constructor(init: AuthErrorInit) { super(init.detail ?? init.kind, init.cause === undefined ? undefined : { cause: init.cause }); this.kind = init.kind; this.name = 'AuthError'; } }` — uses ES2022 Error cause option.
    - `export function formatAuthError(err: AuthError): string` — exhaustive switch over the SIX kinds. Each arm returns a short remediation phrase (per native-modules.ts MR-22 convention: `try ...` / `run ...`). The `auth_port_in_use` arm returns a string referencing `recovery-ledger init` AND the port (use `err.detail` which carries `port <N>`). Add a defense-in-depth default arm that returns `'unknown auth error'` (the TS exhaustive check ensures the default is unreachable, but ADR-0001 forbids silent green-checks).

    Create the three co-located test files. Use vitest. Import `describe, test, expect` from `'vitest'`. For paths.test.ts, run `resolvePaths` with literal env objects — no real env reads, no tmpdir. For schema.test.ts, exercise ConfigSchema.parse with valid + invalid shapes. For errors.test.ts, exercise the switch via a `kind: AuthErrorKind` literal cast to verify formatAuthError covers all six kinds including auth_port_in_use.

    No `console.*`; no `process.stdout.write` (all three modules are under `src/` outside `src/cli/commands/`).
  </action>
  <verify>
    <automated>npm run test -- --run src/infrastructure/config/paths.test.ts src/infrastructure/config/schema.test.ts src/infrastructure/whoop/errors.test.ts</automated>
  </verify>
  <acceptance_criteria>
    - `src/infrastructure/config/paths.ts` exports `resolvePaths`, `paths`, `PathsEnv`, `ResolvedPaths` (run `grep -nE '^export (function|const|interface|type) ' src/infrastructure/config/paths.ts | wc -l` returns at least 4).
    - `src/infrastructure/config/schema.ts` exports `ConfigSchema`, `InitConfig` (type), `D13_SCOPES` (run `grep -nE '^export (const|type) ' src/infrastructure/config/schema.ts | wc -l` returns at least 3).
    - `src/infrastructure/whoop/errors.ts` exports `AuthError`, `AuthErrorKind`, `AuthErrorInit`, `formatAuthError` (grep returns at least 4).
    - `src/infrastructure/whoop/errors.ts` AuthErrorKind union contains EXACTLY 6 kinds including `'auth_port_in_use'`: `grep -nE "'auth_port_in_use'" src/infrastructure/whoop/errors.ts` returns at least 2 matches (union literal + formatAuthError switch arm).
    - `src/infrastructure/config/paths.ts` contains NO `process.env` reference inside the body of `resolvePaths` (only inside the singleton initializer line `export const paths = resolvePaths(process.env)`). Run `grep -nE 'process\.env' src/infrastructure/config/paths.ts` returns exactly one line, and that line matches `export const paths`.
    - `npm run test -- --run src/infrastructure/config/paths.test.ts` exits 0 with at least 5 passing tests.
    - `npm run test -- --run src/infrastructure/config/schema.test.ts` exits 0 with at least 5 passing tests.
    - `npm run test -- --run src/infrastructure/whoop/errors.test.ts` exits 0 with at least 6 passing tests (Tests 6–11 covering all six kinds).
    - `grep -nE 'console\.(log|info|warn|error|debug|trace)' src/infrastructure/config/paths.ts src/infrastructure/config/schema.ts src/infrastructure/whoop/errors.ts` returns no matches.
    - `grep -nE 'process\.stdout\.write' src/infrastructure/config/paths.ts src/infrastructure/config/schema.ts src/infrastructure/whoop/errors.ts` returns no matches.
    - `grep -c '^export default' src/infrastructure/config/paths.ts src/infrastructure/config/schema.ts src/infrastructure/whoop/errors.ts` returns `0` for each file.
    - `npm run lint` exits 0.
  </acceptance_criteria>
  <done>
    paths.ts resolves five paths with env override, throws when both HOME and RECOVERY_LEDGER_HOME are missing; schema.ts ships canonical ConfigSchema + D13_SCOPES constant (DRY-fix); errors.ts ships AuthError discriminated union with all 6 kinds (auth_port_in_use moved into Wave 0) and formatAuthError exhaustive switch. 16+ unit tests green; lint clean.
  </done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| process.env → resolvePaths | env input is unvalidated; resolvePaths trusts strings as path components — Pitfall G (port collision) and a hostile RECOVERY_LEDGER_HOME could redirect token writes |
| filesystem reads of fixtures | test/fixtures/oauth/ JSON files — read-only test inputs, parsed by JSON.parse |
| AuthError.cause chain | inputs from user-supplied data (OAuth callback failures, refresh errors) — flows into Phase 1 sanitize.ts via serializeError |
| ConfigSchema.parse inputs | flow from CLI prompts AND from on-disk config.json read by auth.ts — Plan 02-05's consumers Zod-validate at every read |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-02.01-01 | Tampering | paths.ts RECOVERY_LEDGER_HOME override | accept | env-var override is intentional (D-03/D-06); a local attacker with shell access already owns the process. Documented in 02-RESEARCH.md §V14 Configuration. |
| T-02.01-02 | Information Disclosure | errors.ts AuthError surface | mitigate | AuthError.cause flows through Phase 1's `register.ts` wrapper → `sanitize(serializeError(err))` before reaching MCP. ASVS V7. Tests in errors.test.ts assert cause is preserved (so sanitizer has something to walk) but never emit the cause to stdout. |
| T-02.01-03 | Information Disclosure | fixture token-200.json | accept | fixture contains synthetic `access_token=at-1` (not a real secret). ASVS V8 — committing fake credentials is the documented test pattern (ADR-0006). |
| T-02.01-04 | Tampering | tests/helpers/msw-whoop-oauth.ts | mitigate | helper hard-codes `WHOOP_TOKEN_URL = 'https://api.prod.whoop.com/oauth/oauth2/token'` — a future test cannot accidentally point MSW at a different host. Single source of truth for the URL. ASVS V9. |
| T-02.01-05 | Denial of Service | npm install network failure | accept | install is a one-time act per phase; package-lock.json checked in (deterministic resolution); Phase 1 already proved `npm ci` works in CI. ASVS V14. |
| T-02.01-06 | Spoofing | proper-lockfile package authenticity | mitigate | install uses package-lock.json integrity hashes; package version pinned with `^` minor (4.1.2) — Phase 2 plan-level decision per RESEARCH A5. ASVS V14. |
| T-02.01-07 | Tampering | ConfigSchema clientId regex bypass | mitigate | schema.ts ConfigSchema enforces `/^[A-Za-z0-9._~-]+$/` regex on clientId; defense-in-depth re-validation in oauth.ts buildAuthorizeUrl (Plan 02-03). ASVS V5. |
</threat_model>

<verification>
- Two new dependencies in `package.json` `dependencies`: `proper-lockfile`, `open`.
- Two new dependencies in `package.json` `devDependencies`: `msw`, `@types/proper-lockfile`.
- `npm run lint` exits 0.
- `npm run test -- --run src/infrastructure/` exits 0 with >= 16 passing tests across paths.test.ts + schema.test.ts + errors.test.ts.
- `bash scripts/ci-grep-gates.sh` exits 0 — no new violations introduced (Gate B verifies no console.* in src/, Gate C verifies no process.stdout.write outside src/cli/commands/doctor.ts).
- Three fixture files exist under `test/fixtures/oauth/`.
- One MSW helper exists under `tests/helpers/`.
- AuthErrorKind union contains exactly 6 kinds; the auth_port_in_use kind is present in Wave 0 (was previously a Wave 2 mutation in Plan 02-03 — moved here per checker BLOCKER 1).
</verification>

<success_criteria>
- Three new TS modules (paths.ts, schema.ts, errors.ts) ship with co-located unit tests.
- Four new npm packages installed with the exact pinned versions from RESEARCH §Standard Stack.
- The MSW helper is the SINGLE source of `WHOOP_TOKEN_URL` for the entire phase (Plan 02, 04 will import from it).
- AuthError discriminated union is the SINGLE error type thrown by every Phase 2 module (Plan 03, 04, 05 will use it). The kind set is FROZEN at 6 from Wave 0 onward — no Wave 2 plan mutates errors.ts.
- ConfigSchema is the SINGLE Zod schema for config.json (Plan 02-05's init.ts AND auth.ts both import it — no duplicate-schema DRY violation).
- ResolvedPaths is the SINGLE path source for the phase (Plan 02, 03, 06 will consume `paths.tokensFile`, `paths.tokensLockFile`, etc.).
- Plans 02-08 can compile against this surface without any further Wave-0 work.
</success_criteria>

<output>
After completion, create `.planning/phases/02-oauth-token-store-single-flight-refresh/02-01-SUMMARY.md`.
</output>
