---
phase: 02-oauth-token-store-single-flight-refresh
plan: 05
subsystem: cli
tags: [cli-shims, init, auth, oauth, dry-fix, gate-c-broadening, auth-error-duck-type, errors-ts-bug-fix]

# Dependency graph
requires:
  - phase: 02-oauth-token-store-single-flight-refresh
    provides: src/infrastructure/config/schema.ts (canonical ConfigSchema + D13_SCOPES + InitConfig — single source of truth, DRY-fix per PLAN-05-DRY-VIOLATION); src/infrastructure/config/paths.ts (paths.configFile + paths.configDir); src/infrastructure/whoop/oauth.ts (runOAuth + RunOAuthOptions); src/infrastructure/whoop/token-store.ts (tokenStore.write + Tokens); src/infrastructure/whoop/errors.ts (AuthError union FROZEN at 6 kinds + formatAuthError)
  - phase: 01-foundation-stdout-pure-mcp-bootstrap
    provides: src/cli/commands/doctor.ts (Phase 1 shim shape mirrored verbatim); src/cli/commands/doctor.test.ts (vi.doMock + mock process.exit + process.stdout.write test harness); src/cli/index.ts (Commander program extended with init/auth subcommands); scripts/ci-grep-gates.sh (Gate C broadened from doctor.ts to src/cli/commands/**/*.ts)
provides:
  - src/cli/commands/init.ts — runInitCommand + INIT_EXIT_CODES + re-export type InitConfig (3 exports)
  - src/cli/commands/auth.ts — runAuthCommand + AUTH_EXIT_CODES (2 exports)
  - src/cli/index.ts (modified) — Commander program now registers `init` and `auth` subcommands with MR-22 --help exit-code blocks
  - scripts/ci-grep-gates.sh (modified) — Gate C broadened to allow process.stdout.write from any src/cli/commands/*.ts file
  - src/infrastructure/whoop/errors.ts (modified) — AuthError now stores `init.detail` on the instance as a readonly field so formatAuthError can interpolate it (Plan 02-01 latent bug fix; Rule 1 deviation)
affects: [02-06-doctor-extensions (probeAuth will read paths.configFile + paths.tokensFile populated by init+auth), 02-08-cross-process-integration (cross-process integration test will exercise auth.ts end-to-end alongside the token-store concurrency assertion), Phase 3 WHOOP sync (consumes the tokens auth.ts persists; refresh orchestrator wraps the actual GETs)]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Canonical-schema import pattern (DRY-fix): every consumer of the on-disk config.json shape imports `{ConfigSchema, type InitConfig, D13_SCOPES}` from `src/infrastructure/config/schema.ts`. No file outside schema.ts declares a `z.object({clientId: ...})` literal. Tests I-10 and A-10 grep the source to lock the contract."
    - "Duck-type AuthError detection in CLI catch arms: `err.name === 'AuthError' && AUTH_ERROR_KINDS.has(err.kind)` survives Vitest's `vi.resetModules()` cross-module class identity issue (the foreign-module AuthError class is not `instanceof` the local AuthError class — same shape as Plan 02-04 deviation 1). Production behavior identical; tests robust without dynamic-importing the class symbol in every test body."
    - "Gate C scoped to a directory (not a file): `^src/cli/commands/[A-Za-z0-9._/-]+\\.ts:` exclusion regex matches any CLI command file, present or future. ADR-0001's MCP-stdout-purity invariant is preserved because the src/cli/commands/ directory is not reachable from src/mcp/."
    - "Phase 1 doctor.ts shim shape replicated verbatim: outer try/catch + MR-05 callback-exit + Object.freeze() exit-code map + named-exports-only. Each subcommand owns its own *_EXIT_CODES map; the maps are independent because each subcommand documents its own failure modes."
    - "Co-located test harness: per-test `process.exit` and `process.stdout.write` mocks (capture exitCode + writtenBody) + `RECOVERY_LEDGER_HOME=$tmpdir` for filesystem isolation + `vi.doMock` for module-level dependencies (readline, runOAuth, tokenStore). vi.resetModules() before each `import('./init.js' | './auth.js')` so the `paths` singleton picks up the tmpdir override."

key-files:
  created:
    - src/cli/commands/init.ts
    - src/cli/commands/init.test.ts
    - src/cli/commands/auth.ts
    - src/cli/commands/auth.test.ts
  modified:
    - src/cli/index.ts
    - scripts/ci-grep-gates.sh
    - src/infrastructure/whoop/errors.ts

key-decisions:
  - "AuthError catch-arm dispatch via duck-type, not instanceof — same precedent as Plan 02-04 deviation 1. Tests construct AuthError instances via dynamic imports that resolve to a different module-graph than the one auth.ts loaded; `instanceof AuthError` returns false; check `name === 'AuthError' && kind ∈ AUTH_ERROR_KINDS` instead. Production code only ever throws AuthError from within auth.ts's module-graph so the duck-type is safe; tests get robust dispatch."
  - "Plan 02-01 latent bug in errors.ts fixed (Rule 1 deviation) — AuthError constructor never assigned `init.detail` to the instance, so `formatAuthError`'s `err.detail ?? 'unknown port'` always fell back. Plan 02-01's test 11 only matched `/init|port/` and passed against the 'unknown port' fallback string. Test A-04 in this plan forced the port number into the assertion, which surfaced the bug. Fix: store `init.detail` as a readonly instance field when defined. AuthError's 6-kind union shape remains FROZEN."
  - "REFACTOR phase skipped — GREEN matched planned shape on first run. Module-leading comments, exit-code maps, atomic write helper, ENOENT detection, duck-type AuthError dispatch, MR-22 --help blocks, and Gate C scope regex all matched the plan's `<interfaces>` and `<action>` verbatim. Same precedent as Plan 02-01 Task 2, Plan 02-04, Plan 02-07."
  - "Gate C scope regex uses `[A-Za-z0-9._/-]+` rather than a glob — the script uses POSIX grep, not bash globbing. Regex is anchored at `^src/cli/commands/` so a hypothetical `src/services/test-violator.ts` with `process.stdout.write` still fails the gate. Verified by running `bash scripts/ci-grep-gates.sh` against the new init.ts + auth.ts (which both use process.stdout.write) — exit 0."
  - "open package wired only when --no-browser is NOT set — `openBrowser` callback passed to runOAuth is `undefined` in --no-browser mode, which keeps runOAuth's stderr-print arm clean. The plan's <interfaces> said `auth.ts: imports open and passes it as openBrowser`; this implementation refines that to a conditional pass so the --no-browser arm doesn't import or invoke open at all."

patterns-established:
  - "Pattern: CLI command shim shape (Phase 1 doctor.ts → init.ts + auth.ts). Outer try/catch + MR-05 callback-exit + Object.freeze() exit-code map + named-exports-only + ≤ ~130 LOC including doc comments. Future Phase 3 CLI subcommands (sync, review, decision) follow the same shape."
  - "Pattern: per-test process.exit + process.stdout.write mocks for CLI test harness. Capture exitCode + writtenBody as locals; restore originals in afterEach; combine with vi.resetModules() + vi.doMock for module-level dependency injection. Mirrors src/cli/commands/doctor.test.ts MR-08 / MR-42 patterns."
  - "Pattern: duck-type cross-module error dispatch — `err.name === 'ClassName' && SHAPE.has(err.kind)`. Use in CLI catch arms and any other place a foreign-module error class might cross a vi.resetModules() boundary. Pairs with the planner-template note from Plan 02-04 deviation 1."

requirements-completed: [AUTH-01, AUTH-02, AUTH-03]

# Metrics
duration: 4m 57s
completed: 2026-05-12
---

# Phase 2 Plan 05: CLI Shims Summary

**`recovery-ledger init` (AUTH-01) bootstraps ~/.recovery-ledger/config.json mode 0600 with D-06 env-var precedence + D-02 verbatim instructions + atomic temp-and-rename write + Zod validation via the canonical ConfigSchema. `recovery-ledger auth` (AUTH-02) reads config.json, runs Plan 02-03's runOAuth, persists Tokens via Plan 02-02's tokenStore.write, prints `Authorization complete.` Both files import the canonical ConfigSchema from Plan 02-01's schema.ts — no inline z.object declarations (DRY-fix per checker WARNING PLAN-05-DRY-VIOLATION). Gate C in scripts/ci-grep-gates.sh broadened from a single file to the entire src/cli/commands/ directory; ADR-0001's MCP-stdout-purity rule is preserved because the directory is not reachable from src/mcp/. 23 unit tests green; full suite 206/206 across 17 files. Two deviations auto-fixed: one Biome format auto-fix (Rule 3) and one Plan 02-01 latent bug in errors.ts where AuthError never stored `init.detail` on the instance — fixed under Rule 1 because Plan 05's test A-04 forces the port number into the assertion.**

## Performance

- **Duration:** 4 min 57 sec
- **Started:** 2026-05-12T23:07:22Z
- **Completed:** 2026-05-12T23:12:19Z
- **Tasks:** 1 (TDD: RED → GREEN; REFACTOR skipped — implementation matched planned shape)
- **Files modified:** 7 (4 created + 3 modified)
- **Tests added:** 23 (I-01..I-10 + A-01..A-10 + INIT_EXIT_CODES frozen + AUTH_EXIT_CODES frozen + Commander wiring C-01/C-02)
- **Total suite:** 183 → 206 tests across 15 → 17 files; all green

## Accomplishments

- Shipped `recovery-ledger init` (AUTH-01): writes ~/.recovery-ledger/config.json mode 0600 from interactive prompts OR from WHOOP_CLIENT_ID/WHOOP_CLIENT_SECRET env vars (D-06 precedence; Specifics line 163). D-02 verbatim instructions print BEFORE prompts (WHOOP dashboard URL + constructed redirect URI + D-13 scope string). Idempotent — two runs with the same env vars produce identical bytes. Atomic temp-and-rename write mirrors token-store.ts Pattern 2 (open with mode 0o600 → writeFile → sync → close → rename).
- Shipped `recovery-ledger auth` (AUTH-02): reads config.json via canonical ConfigSchema.parse, applies D-06 env-var precedence at auth time (env vars override config values), runs Plan 02-03's runOAuth with the resolved credentials, persists Tokens via Plan 02-02's tokenStore.write, prints `Authorization complete.` to stdout, exits 0. AUTH_EXIT_CODES covers all six FROZEN AuthError kinds; --no-browser passes through to runOAuth's stderr-print arm; --timeout converts seconds → milliseconds before passing as runOAuth's timeoutMs.
- DRY-fix verified — `grep -nE "from '\.\./\.\./infrastructure/config/schema'" src/cli/commands/init.ts src/cli/commands/auth.ts` returns matches; `grep -cE 'z\.object\(' src/cli/commands/{init,auth}.ts` returns 0 in both files. Both Tests I-10 and A-10 read the source and assert these greps at unit-test time.
- Gate C in scripts/ci-grep-gates.sh broadened from `src/cli/commands/doctor.ts` (Phase 1 single-file scope) to `src/cli/commands/**/*.ts` (any CLI command file). ADR-0001's MCP-stdout-purity invariant preserved — the src/cli/commands/ directory is not reachable from src/mcp/.
- src/cli/index.ts registers `init` and `auth` subcommands with MR-22 --help blocks documenting exit codes (init: 0 success / 1 invalid input / 1 write failed; auth: six 1-codes mapped to the FROZEN AuthError kinds + 0 success).
- Plan 02-01 latent bug in errors.ts fixed (Rule 1 deviation) — AuthError constructor now stores `init.detail` on the instance as a readonly field so formatAuthError can interpolate the colliding port number in the auth_port_in_use remediation. AuthError union remains FROZEN at 6 kinds.
- Build succeeds: `node dist/cli.mjs --help` lists `init` and `auth` subcommands; lint clean; CI grep gates pass.

## Task Commits

Single TDD task — two commits (RED → GREEN; REFACTOR skipped):

1. **Task 1 RED:** `ed5c455` — `test(02-05): add failing RED tests for init.ts and auth.ts (23 tests)` — all 23 tests fail with `Cannot find module './init.js'` or `'./auth.js'` before init.ts and auth.ts are written.
2. **Task 1 GREEN:** `0f7a60d` — `feat(02-05): implement init.ts and auth.ts CLI shims (GREEN — 23 tests pass)` — modules + Commander wiring + Gate C broadening + errors.ts bug fix; 23/23 tests pass; full suite 206/206 across 17 files; lint clean; CI grep gates pass; build succeeds.

_REFACTOR skipped — GREEN matched planned shape. Same precedent as Plan 02-01 Task 2, Plan 02-04, Plan 02-07._

## Files Created/Modified

### Created (4)

- `src/cli/commands/init.ts` (131 LOC, 3 named exports: `runInitCommand`, `INIT_EXIT_CODES`, type re-export `InitConfig`). Module-leading comment cites D-01, D-02, D-06, the DRY-fix per PLAN-05-DRY-VIOLATION, and the Gate C broadening rationale. Body: env-var precedence arm + prompt arm + Zod-via-canonical-schema validation + mkdir mode 0o700 + writeConfigAtomic with mode 0o600 + MR-05 callback-exit pattern. Outer try/catch surfaces failures via String(err) to stdout with exit 1.
- `src/cli/commands/init.test.ts` (235 LOC, 11 tests). Per-test process.exit + process.stdout.write mocks + RECOVERY_LEDGER_HOME tmpdir + vi.doMock('node:readline/promises') + vi.resetModules() before each `import('./init.js')`. Covers I-01 (happy path with prompts), I-02 (env-var skip), I-03 (idempotency byte-equal), I-04 (D-02 verbatim), I-05 (mkdir mode 0o700), I-06 (config.json mode 0o600), I-07 (atomic write — no .tmp file), I-08 (exit code 0), I-09 (Zod rejects hostile clientId — no echo of bad input), I-10 (canonical-schema import grep), INIT_EXIT_CODES frozen.
- `src/cli/commands/auth.ts` (132 LOC, 2 named exports: `runAuthCommand`, `AUTH_EXIT_CODES`). Module-leading comment cites D-01, D-08, D-10, D-11, the DRY-fix, the cross-module class identity decision, and the corrected consumer scope (auth.ts does NOT consume refreshOrchestrator — corrected per Plan 02-04 PLAN-04-CIRCULAR-NOTE). Body: read config via canonical ConfigSchema + D-06 env precedence + runOAuth + tokenStore.write + duck-type AuthError dispatch in catch arm + MR-05 callback-exit pattern.
- `src/cli/commands/auth.test.ts` (293 LOC, 12 tests). Same harness shape as init.test.ts + vi.doMock for oauth.js and token-store.js. Covers A-01..A-10 + AUTH_EXIT_CODES frozen + Commander wiring (C-01/C-02 — substring-grep src/cli/index.ts for `.command('init')` and `.command('auth')` + --no-browser + --timeout). Test A-04 verifies the port number is in the remediation string (forces the errors.ts bug fix).

### Modified (3)

- `src/cli/index.ts` (42 → 73 LOC). Adds `runInitCommand` and `runAuthCommand` imports; registers `.command('init')` and `.command('auth')` with MR-22 `.addHelpText('after', ...)` blocks listing each subcommand's exit codes. `--no-browser` is `--no-browser` (Commander short form for `boolean` toggle); `--timeout <seconds>` parses via `parseInt(v, 10)`.
- `scripts/ci-grep-gates.sh` (Gate C scope broadened). Comment header updated from "outside `src/cli/commands/doctor.ts`" to "outside `src/cli/commands/**/*.ts`" with rationale citing Plan 05 + ADR-0001 §Consequences (the src/cli/commands/ directory is not reachable from src/mcp/, so widening here doesn't break MCP framing). The grep exclusion changed from `'^src/cli/commands/doctor\.ts:'` to `'^src/cli/commands/[A-Za-z0-9._/-]+\.ts:'` — a regex (not a glob) anchored at the directory prefix.
- `src/infrastructure/whoop/errors.ts` (AuthError constructor + class field). Adds `readonly detail?: string;` field; assigns `this.detail = init.detail` when defined. The 6-kind union shape remains FROZEN — only the carrier's instance fields gained a property that `formatAuthError` already referenced. Plan 02-01 latent bug fix; Rule 1 deviation.

### Not Modified (asserted by `git diff --name-only HEAD~2..HEAD`)

- `src/infrastructure/whoop/oauth.ts` — runOAuth consumed unchanged.
- `src/infrastructure/whoop/token-store.ts` — tokenStore consumed unchanged.
- `src/infrastructure/config/schema.ts` — canonical ConfigSchema + D13_SCOPES consumed unchanged.
- `src/infrastructure/config/paths.ts` — paths.configFile + paths.configDir consumed unchanged.
- `src/services/refresh-orchestrator.ts` — NOT consumed by auth.ts (corrected per Plan 02-04 PLAN-04-CIRCULAR-NOTE; auth-code grant has no 401-reactive boundary).
- `src/mcp/sanitize.ts` / `src/mcp/register.ts` — D-18 attestation preserved across Plan 02-07 + Plan 02-02 + Plan 02-03 + Plan 02-04 + this plan.

## Decisions Made

- **Duck-type AuthError detection in auth.ts catch arm** — `err.name === 'AuthError' && AUTH_ERROR_KINDS.has(err.kind)` rather than `err instanceof AuthError`. Vitest's `vi.resetModules()` + dynamic `import('./auth.js')` produces a fresh module-graph for errors.js; the test's `import { AuthError }` from a different point in the lifecycle gets a different class identity. `instanceof` returns false; duck-typing structural shape works. Production code only ever throws AuthError from within auth.ts's module-graph, so the duck-type is safe; tests get robust dispatch regardless of resetModules timing. Same precedent as Plan 02-04 deviation 1 — planner-template note now applies to BOTH CLI shim files and the refresh orchestrator test file.
- **errors.ts bug fix under Rule 1** — Plan 02-01's AuthError constructor passed `init.detail` to `super()` but never assigned it to the instance, so `err.detail` was always undefined and `formatAuthError`'s `err.detail ?? 'unknown port'` always fell back to the placeholder. Plan 02-01 errors.test.ts test 11 only matched `/init|port/` so the bug passed silently. Plan 05's test A-04 forces the port number into the assertion (the user needs to know which port collided to fix `recovery-ledger init`). Fix: `readonly detail?: string;` field + conditional assignment. AuthError's 6-kind union shape FROZEN; only the carrier's instance shape changed by adding a documented field. errors.test.ts and other consumers remain green.
- **REFACTOR skipped — GREEN matched the planned shape**. Module-leading comments, exit-code maps, MR-05 callback-exit pattern, atomic write helper, mkdir-with-mode pattern, Zod-via-canonical-schema validation, duck-type AuthError dispatch, Gate C scope regex, and Commander --help blocks all matched the plan's `<interfaces>` and `<action>` verbatim. Same precedent as Plan 02-01 Task 2, Plan 02-04, Plan 02-07.
- **`open` package only imported & invoked when --no-browser is NOT set**. The plan's `<interfaces>` line 183 said "auth.ts will compose `await runOAuth({...opts, openBrowser: open})`"; this implementation passes `openBrowser: undefined` in --no-browser mode so runOAuth's stderr-print fallback runs cleanly without trying to spawn a process. Functionally equivalent to the plan; semantically cleaner.
- **MR-22 --help block on init and auth subcommands**. Each subcommand documents its exit codes inline so scripted wrappers (cron, launchd, CI) can react without reading source — mirrors the Phase 1 doctor subcommand pattern.
- **Gate C regex uses `[A-Za-z0-9._/-]+`** rather than `*.ts` (POSIX grep uses regex, not bash globs). Anchored at `^src/cli/commands/` so a hypothetical `src/services/test-violator.ts` with `process.stdout.write` still fails the gate. Verified via `bash scripts/ci-grep-gates.sh` against the new init.ts + auth.ts (both use process.stdout.write) — exit 0.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 — Blocking lint] Biome formatter auto-fixed import-sort + line-collapse on init.ts/auth.ts/init.test.ts/auth.test.ts**

- **Found during:** Task 1 GREEN verification (`npm run lint` after writing the four files).
- **Issue:** Biome flagged five format-only violations across the four files — `import { stat, mkdtemp, ... }` order in init.test.ts wanted `mkdtemp, readFile, rm, stat`, the `import { ... } from '../../infrastructure/config/schema.js'` import in init.ts wanted to collapse onto a single line, and similar reshapes in auth.ts/auth.test.ts.
- **Fix:** Ran `npm run format` to apply Biome's `--write` auto-fix. No semantic change.
- **Files modified:** `src/cli/commands/init.ts`, `src/cli/commands/init.test.ts`, `src/cli/commands/auth.ts`, `src/cli/commands/auth.test.ts`.
- **Verification:** `npm run lint` exits 0; 23 tests still pass.
- **Committed in:** `0f7a60d` (Task 1 GREEN — fix made before staging).

**2. [Rule 1 — Bug: Plan 02-01 latent errors.ts bug] AuthError constructor never assigned `init.detail` to the instance**

- **Found during:** Task 1 GREEN first run of `npm run test src/cli/commands/auth.test.ts` — Test A-04 (port-in-use remediation must contain `4321`) failed with `expected 'Loopback port already in use (unknown port) — re-run \`recovery-ledger init\` ...' to contain '4321'`.
- **Issue:** Plan 02-01's AuthError class shape passes `init.detail` to `super()` (which sets `this.message`), but never assigns it to an instance field. `formatAuthError` in errors.ts references `err.detail ?? 'unknown port'` on line 76. Since `err.detail` is always `undefined`, the formatter always renders the placeholder. Plan 02-01's errors.test.ts test 11 (`auth_port_in_use arm references init or port`) only matches `/init|port/` so it passes against the literal 'unknown port' fallback — the bug was hidden by a weak assertion. Plan 05's test A-04 forces the actual port number into the assertion which surfaced it.
- **Fix:** Added `readonly detail?: string;` field to AuthError class; assigned `this.detail = init.detail` when defined. AuthError's 6-kind union shape (`AuthErrorKind`) remains FROZEN; only the carrier's instance shape gained a documented property that `formatAuthError` already referenced.
- **Files modified:** `src/infrastructure/whoop/errors.ts` (one new field + one conditional assignment).
- **Verification:** Test A-04 now passes; `formatAuthError({kind: 'auth_port_in_use', detail: 'port 4321'})` returns "Loopback port already in use (port 4321) — re-run `recovery-ledger init` ...". Plan 02-01's errors.test.ts test 11 still passes (the matcher is permissive enough to accept either rendering). Full suite 206/206 green.
- **Committed in:** `0f7a60d` (Task 1 GREEN — same commit as the CLI shims; fix made before staging).
- **Planner-template note:** Plan-authored acceptance assertions should be strict enough to catch the bug they describe. Plan 02-01's test 11 (`/init|port/`) was permissive on purpose to allow either remediation phrasing, but it accidentally hid a real bug for an entire plan-wave. When a plan ships a contract test for a class with an `init.detail` field that the formatter reads back, the test should pin the exact value, not just a regex-class.

---

**Total deviations:** 2 auto-fixed (1 Rule-3 blocking-lint format, 1 Rule-1 plan-02-01 latent bug surfaced by this plan's stricter assertion).

**Impact on plan:** None functional. The Biome format pass is mechanical; the errors.ts bug fix is correctly scoped (one field + conditional assignment) and preserves the FROZEN 6-kind union shape. The Plan 02-05 `<interfaces>` and `<acceptance_criteria>` blocks pass verbatim. The errors.ts change is documented as a Plan 02-01 retroactive fix rather than a new feature; AuthError consumers (Plan 02-02 token-store, Plan 02-03 oauth, Plan 02-04 refresh-orchestrator) see no behavior change because they never read `err.detail` themselves — only formatAuthError does, and the formatter's rendering improves rather than regresses.

## Issues Encountered

- Plan 02-01's errors.test.ts test 11 was permissive enough to hide a latent bug in the AuthError class. Recommend a planner-template note for any error-class plan: when the formatter consumes a constructor argument as a renderable detail (`err.detail` → `formatAuthError` → user-visible string), the contract test should pin the exact rendered substring rather than a regex-class that would match the placeholder fallback too.
- The `instanceof AuthError` cross-module class identity issue is now confirmed in BOTH the refresh orchestrator test (Plan 02-04 deviation 1) AND this plan's auth.ts catch arm. Two different code paths, two different vi.resetModules() configurations, same root cause. Worth a planner-template entry under Test Mechanism: "if your CLI command catches a class-based error from a module that may be hot-reloaded under `vi.resetModules()`, use duck-typing on `err.name + err.kind` in the production catch arm; do not rely on `instanceof` across module-graph boundaries."

## User Setup Required

This plan delivers the CLI surface for BYO OAuth setup. The first end-user encounters the surface as follows:

1. **Create a WHOOP developer app** at https://developer.whoop.com/dashboard/applications. Note the Client ID and Client Secret.
2. **Register the loopback redirect URI** in the WHOOP developer dashboard: `http://127.0.0.1:4321/callback` (default; configurable via `init`). The port number must match the `redirectPort` in `~/.recovery-ledger/config.json`.
3. **Optionally set env vars** `WHOOP_CLIENT_ID` and `WHOOP_CLIENT_SECRET` before running `recovery-ledger init` to skip the interactive prompts (D-06 precedence). Env vars also override the on-disk config at `recovery-ledger auth` time.
4. **Run** `recovery-ledger init` → prints D-02 instructions + prompts for client_id, client_secret, redirect_port → writes config.json mode 0600.
5. **Run** `recovery-ledger auth` → opens browser to WHOOP authorize URL (or prints to stderr with --no-browser) → user grants consent → loopback callback exchanges the code for tokens → tokens written via tokenStore.write (keychain or file fallback) → prints `Authorization complete.`

No part of this is automatable; the user has to grant consent in their own browser. Plan 02-06's `doctor` extensions will surface auth state to the user without re-running auth.

## Next Phase Readiness

Phase 2 Wave 4 is now done. The CLI surface is complete; only doctor extensions (Plan 02-06) and the cross-process integration test (Plan 02-08) remain in Phase 2.

**Plan 02-06 (doctor-extensions) input notes:**
- `paths.configFile` + `paths.tokensFile` are now populated end-to-end via the `init` → `auth` flow. probeAuth can read either of these files (or absence-detect them) without further wiring.
- Gate E in scripts/ci-grep-gates.sh should be added per the input notes recorded across Plans 02-02, 02-03, 02-04: `oauth/oauth2/token` outside `src/infrastructure/whoop/token-store.ts` must be 0 with `--exclude='*.test.ts'`; `oauth/oauth2/auth` outside `src/infrastructure/whoop/oauth.ts` must be 0 with the same exclusion; `tokenStore\.getValidAccessToken` outside `src/infrastructure/whoop/token-store.ts` and `src/services/refresh-orchestrator.ts` must be 0 with the same exclusion.
- The MR-22 --help block convention is now applied consistently across all three subcommands (doctor, init, auth). Plan 02-06 should add `--help` block content to doctor for the new auth/token-freshness exit codes it adds.

**Plan 02-08 (cross-process integration) input notes:**
- The full `init` → `auth` round-trip is now driveable from a test harness without modification — test can shell out to `recovery-ledger init` (with env vars set), then shell out to `recovery-ledger auth` against an MSW-mocked WHOOP authorize endpoint, then verify tokenStore.read() returns the expected tokens.
- However, the cross-process AUTH-05 load-bearing test is specifically about the refresh path (10 forked children → exactly one POST to the token endpoint), not the initial auth-code grant. The auth.ts shim is not load-bearing for AUTH-05; the orchestrator + token-store from Plans 02-02/02-04 already cover it.

**Phase 3 (WHOOP sync) input note:** the auth.ts shim is the user-facing one-time entry point. Phase 3's sync service consumes `tokens` via `callWithAuth(op)` (Plan 02-04's orchestrator) and never invokes `runOAuth` directly. If Phase 3's sync hits a refresh failure that wraps as `auth_expired`, the CLI surface is to print the formatAuthError remediation and direct the user to re-run `recovery-ledger auth` — same exit-code map auth.ts ships here.

No blockers. No open todos surfaced by this plan.

## Self-Check: PASSED

Files verified to exist:
- `src/cli/commands/init.ts`: FOUND (131 LOC; 3 named exports; no console.*; uses process.stdout.write — Gate C now permits; no export default; imports canonical schema; no inline z.object)
- `src/cli/commands/init.test.ts`: FOUND (235 LOC; 11 tests)
- `src/cli/commands/auth.ts`: FOUND (132 LOC; 2 named exports; no console.*; uses process.stdout.write — Gate C now permits; no export default; imports canonical schema; no inline z.object; duck-type AuthError dispatch)
- `src/cli/commands/auth.test.ts`: FOUND (293 LOC; 12 tests including Commander wiring grep)
- `.planning/phases/02-oauth-token-store-single-flight-refresh/02-05-SUMMARY.md`: FOUND (this file, after Write)

Files verified MODIFIED by this plan:
- `src/cli/index.ts`: MODIFIED (42 → 73 LOC; .command('init') + .command('auth') + --no-browser + --timeout + MR-22 help blocks)
- `scripts/ci-grep-gates.sh`: MODIFIED (Gate C scope broadened — both comment header AND regex updated; rationale citing Plan 05 + ADR-0001 §Consequences in the comment)
- `src/infrastructure/whoop/errors.ts`: MODIFIED (AuthError gained readonly `detail?: string` field + conditional assignment; FROZEN 6-kind union shape preserved)

Files verified NOT modified by this plan (D-18 attestation preserved):
- `src/mcp/sanitize.ts`: UNMODIFIED
- `src/mcp/register.ts`: UNMODIFIED
- `src/services/refresh-orchestrator.ts`: UNMODIFIED (auth.ts does NOT consume — Plan 02-04 PLAN-04-CIRCULAR-NOTE preserved)
- `src/infrastructure/whoop/token-store.ts`: UNMODIFIED (tokenStore.write consumed unchanged)
- `src/infrastructure/whoop/oauth.ts`: UNMODIFIED (runOAuth consumed unchanged)

Commits verified in git log:
- `ed5c455` (Task 1 RED — test): FOUND — 23 tests fail with `Cannot find module './init.js'` or `'./auth.js'` before init.ts and auth.ts are written
- `0f7a60d` (Task 1 GREEN — feat): FOUND — 23 tests pass after the CLI shims + Gate C broadening + errors.ts bug fix

Acceptance grep checks (from plan `<acceptance_criteria>`):
- `^export ` count in init.ts >= 3: **3** — PASS
- `^export ` count in auth.ts >= 2: **2** — PASS
- init.ts imports `from '../../infrastructure/config/schema'`: **1 match** — PASS (DRY-fix verified)
- auth.ts imports `from '../../infrastructure/config/schema'`: **1 match** — PASS (DRY-fix verified)
- `z\.object\(` in init.ts: **0** — PASS (no inline schema)
- `z\.object\(` in auth.ts: **0** — PASS (no inline schema)
- `.command('init')` in src/cli/index.ts: **1 match** — PASS
- `.command('auth')` in src/cli/index.ts: **1 match** — PASS
- Gate C broadened scope in ci-grep-gates.sh: comment header + regex updated to `src/cli/commands/[A-Za-z0-9._/-]+\.ts:` — PASS
- `bash scripts/ci-grep-gates.sh` exits 0 with new init.ts/auth.ts present: PASS
- `console.(log|info|warn|error|debug|trace)` in init.ts + auth.ts: **0** — PASS
- `^export default` in init.ts + auth.ts: **0** — PASS
- `npm run test -- --run src/cli/commands/init.test.ts` >= 10 tests: **11** — PASS
- `npm run test -- --run src/cli/commands/auth.test.ts` >= 10 tests: **12** — PASS
- I-10 + A-10 canonical-schema-import tests present and pass: **both PASS**
- `npm run lint` exits 0: PASS
- `npm run build` exits 0: PASS
- `node dist/cli.mjs --help` lists `init` and `auth` subcommands: PASS
- Full suite: 183 → 206 tests across 15 → 17 files — PASS

## Threat Flags

None. All threats listed in the plan's `<threat_model>` register (T-02.05-01 through T-02.05-10) are addressed by the implementation as planned:

- **T-02.05-01 (Information Disclosure — client_secret echoed back in error messages)** → mitigated by `parsed.error.issues.map(i => i.path.join('.'))` — field-name-only remediation in the Zod failure arm; bad input never echoed. Test I-09 verifies (`writtenBody not contain 'bad/value with spaces'`). ASVS V7.
- **T-02.05-02 (Information Disclosure — config.json mode permissive)** → mitigated by `open(tmp, 'w', 0o600)` in writeConfigAtomic; configDir gets 0o700 on mkdir. Test I-05 + I-06 verify. ASVS V8.
- **T-02.05-03 (Tampering — partial config write from crash)** → mitigated by atomic temp-and-rename with `fd.sync()` before rename, same-directory. Test I-07 verifies no `.tmp` file after success. ASVS V8.
- **T-02.05-04 (Information Disclosure — env-var values leaked in logs)** → mitigated by neither init.ts nor auth.ts importing the logger; stdout outputs are constants + paths only, never secrets. ASVS V7.
- **T-02.05-05 (Tampering — clientId URL injection)** → mitigated by canonical `ConfigSchema` regex `/^[A-Za-z0-9._~-]+$/` on clientId in schema.ts (Plan 02-01) AND oauth.ts buildAuthorizeUrl re-validates (Plan 02-03). DRY-fix means a single source of truth — no drift between init.ts and auth.ts. ASVS V5.
- **T-02.05-06 (DoS — hostile redirectPort value)** → mitigated by canonical ConfigSchema enforcing `z.number().int().positive()`; runOAuth's server.listen would throw on out-of-range ports → caught by auth.ts outer try/catch → exit 1. ASVS V5.
- **T-02.05-07 (Information Disclosure — `Authorization complete.` confirmation accidentally contains token)** → mitigated by the literal string being a constant — does not interpolate any token field. Test A-01 verifies the exact string. ASVS V7.
- **T-02.05-08 (Spoofing — malicious config.json planted by another local process)** → ACCEPTED. Local-attacker model is out of scope (Threat T-02.03-11 / Threat Patterns §V4). The canonical ConfigSchema re-validation on read catches malformed files. ASVS V14.
- **T-02.05-09 (Information Disclosure — Gate C broadening allows process.stdout.write in a future hostile file under src/cli/commands/)** → mitigated by the scope being per-directory and src/cli/commands/ not being reachable from src/mcp/. Verified by Plan 05 not touching src/mcp/. ASVS V14.
- **T-02.05-10 (Tampering — DRY drift between init.ts and auth.ts schemas)** → mitigated by both files importing the canonical `ConfigSchema` from src/infrastructure/config/schema.ts (Plan 02-01). Tests I-10 and A-10 verify no inline `z.object({...})` declaration in either file. A future drift attempt would require modifying schema.ts — both consumers stay in sync. ASVS V5.

The new files do not introduce surface that wasn't already in the threat register. No threat flags to surface for downstream plans.

## TDD Gate Compliance

Task 1 (`tdd="true"`) followed the RED → GREEN cycle (REFACTOR skipped):

- **RED:** `ed5c455` (`test(02-05): add failing RED tests for init.ts and auth.ts (23 tests)`) — all 23 tests fail with `Cannot find module './init.js'` or `'./auth.js'` before init.ts and auth.ts are written.
- **GREEN:** `0f7a60d` (`feat(02-05): implement init.ts and auth.ts CLI shims (GREEN — 23 tests pass)`) — modules ship; 23/23 tests pass after duck-type AuthError dispatch fix (Decision 1) and errors.ts Rule-1 bug fix (Deviation 2), both applied before staging.
- **REFACTOR:** skipped — GREEN matched planned shape. Same precedent as Plan 02-01 Task 2, Plan 02-04, Plan 02-07.

The RED → GREEN gate is intact: a `test(...)` commit precedes a `feat(...)` commit in `git log --oneline | head`. The plan-level TDD gate is satisfied.

---
*Phase: 02-oauth-token-store-single-flight-refresh*
*Plan: 02-05-cli-shims*
*Completed: 2026-05-12*
