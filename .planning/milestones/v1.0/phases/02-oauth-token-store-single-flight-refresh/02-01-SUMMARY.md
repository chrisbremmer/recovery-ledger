---
phase: 02-oauth-token-store-single-flight-refresh
plan: 01
subsystem: infra
tags: [oauth, msw, zod, proper-lockfile, fixtures, paths, discriminated-union]

# Dependency graph
requires:
  - phase: 01-foundation-stdout-pure-mcp-bootstrap
    provides: src/infrastructure/config/logger.ts (factory+singleton shape mirrored by paths.ts); src/services/doctor/index.ts (MR-21 closed-union voice mirrored by AuthError); scripts/ci-grep-gates.sh (Gates B/C verify the three new src/ modules); test/fixtures/ convention (extended to test/fixtures/oauth/)
provides:
  - src/infrastructure/config/paths.ts — resolvePaths + paths singleton (five derived paths)
  - src/infrastructure/config/schema.ts — canonical ConfigSchema + D13_SCOPES + InitConfig
  - src/infrastructure/whoop/errors.ts — AuthError discriminated union over 6 kinds + formatAuthError
  - tests/helpers/msw-whoop-oauth.ts — shared MSW token-endpoint helper + per-call hit counter
  - test/fixtures/oauth/ — token-200.json, token-400-invalid-grant.json, authorize-callback-state-mismatch.html
  - npm deps: proper-lockfile@^4.1.2, open@^11.0.0, msw@^2.14.6, @types/proper-lockfile
affects: [02-02-token-store, 02-03-oauth-round-trip, 02-04-refresh-orchestrator, 02-05-cli-shims, 02-06-doctor-extensions, 02-07-sanitizer-fixtures, 02-08-cross-process-integration]

# Tech tracking
tech-stack:
  added: [proper-lockfile@4.1.2, open@11.0.0, msw@2.14.6, "@types/proper-lockfile@4.1.4"]
  patterns:
    - "Factory+singleton path resolver (mirrors logger.ts): pure resolvePaths(env) + module-load-bound paths constant"
    - "Discriminated-union error carrier (mirrors DoctorCheck.status MR-21 voice): closed union forces switch-arm updates at compile time"
    - "Single-source-of-truth schema (DRY-fix): canonical ConfigSchema imported by every downstream consumer"
    - "Shared MSW helper factory: caller owns server.listen/close lifecycle; per-call hit counter for the single-flight assertion (D-23.1)"
    - "OAuth fixture convention: test/fixtures/oauth/ for one-off OAuth scope (separate from tests/fixtures/whoop/<resource>/ which Phase 3 will own)"

key-files:
  created:
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
  modified:
    - package.json
    - package-lock.json

key-decisions:
  - "auth_port_in_use kind shipped in Wave 0 (was Wave 2 in original plan) — checker BLOCKER 1 fix keeps errors.ts stable across Plan 02-02 and Plan 02-03 same-wave consumers"
  - "Canonical ConfigSchema lives in src/infrastructure/config/schema.ts — checker WARNING PLAN-05-DRY-VIOLATION fix; init.ts and auth.ts both import from this single source in Plan 02-05"
  - "WHOOP_TOKEN_URL hard-coded inside tests/helpers/msw-whoop-oauth.ts as the single source for the entire phase — T-02.01-04 mitigation prevents a future test from accidentally pointing MSW at a different host"
  - "resolvePaths throws when neither HOME nor RECOVERY_LEDGER_HOME is set — no implicit fallback to process.cwd() (fail loudly per the unit suite's Test 5)"
  - "Formatter rebroke long super(...) call into one line and split paths.ts configDir assignment across two lines (Biome auto-fix); accepted verbatim — no rationale to override"

patterns-established:
  - "Pattern: factory(env)+singleton for any infra module that reads global env at module load — paths.ts mirrors logger.ts; future config modules (token-store paths, db paths) follow the same shape"
  - "Pattern: discriminated-union Error carrier with formatX(err) exhaustive switch — AuthError follows the DoctorCheck precedent; the switch is the compile-time forcing function for new kinds"
  - "Pattern: shared MSW helper factory with caller-owned lifecycle — each test file controls when server.listen / server.close runs (per RESEARCH §Test-Mechanism Recipes 982-984)"
  - "Pattern: ES2022 Error cause threading — pass { cause } only when defined so 'no cause' and '{ cause: undefined }' are not conflated by serializers"

requirements-completed: [AUTH-01, AUTH-02, AUTH-03, AUTH-04, AUTH-05]

# Metrics
duration: 5m 17s
completed: 2026-05-12
---

# Phase 2 Plan 01: Wave-0 Infrastructure Summary

**OAuth-phase infrastructure surface: path resolver + canonical config schema + AuthError discriminated union (6 kinds, frozen from Wave 0) + shared MSW WHOOP-token helper + three committed OAuth fixtures + four npm deps installed.**

## Performance

- **Duration:** 5 min 17 sec
- **Started:** 2026-05-12T22:16:14Z
- **Completed:** 2026-05-12T22:21:31Z
- **Tasks:** 2 (Task 1 install + scaffold; Task 2 TDD modules)
- **Files modified:** 12 (10 created + 2 modified — package.json/package-lock.json)
- **Tests added:** 16 unit tests across paths/schema/errors

## Accomplishments

- Installed Phase 2's four new packages at the pinned versions from RESEARCH §Standard Stack (proper-lockfile@4.1.2, open@11.0.0, msw@2.14.6, @types/proper-lockfile@4.1.4) — every Wave-1+ plan can now `npm install` cleanly.
- Landed three new TypeScript modules with co-located test files (16 tests, all green): paths.ts (5 tests), schema.ts (5 tests), errors.ts (6 tests).
- Shipped the shared MSW WHOOP-token helper (`tests/helpers/msw-whoop-oauth.ts`) with per-call hit counter and setNextResponse one-shot override — the load-bearing test seam for Plan 02-04's "10 parallel callers hit refresh exactly once" assertion (D-23.1).
- Committed three OAuth fixtures under `test/fixtures/oauth/` so Plan 02-03's oauth.test.ts state-mismatch arm and Plan 02-02's token-store refresh-reuse arm can both consume them verbatim.
- Closed two checker findings: BLOCKER 1 (auth_port_in_use moved into Wave 0; errors.ts now FROZEN at 6 kinds) and WARNING PLAN-05-DRY-VIOLATION (ConfigSchema centralized).

## Task Commits

Each task was committed atomically. Task 2 used the RED → GREEN cycle (no REFACTOR needed):

1. **Task 1: Install deps + scaffold MSW + fixtures** — `ded9836` (chore)
2. **Task 2 RED: failing tests for paths/schema/errors** — `dbee5a1` (test)
3. **Task 2 GREEN: implement paths/schema/errors** — `0705a09` (feat)

_Note: Task 2 had `tdd="true"`; REFACTOR phase skipped — the GREEN implementation matched the planned shape without cleanup needed._

## Files Created/Modified

### Created (10)

- `src/infrastructure/config/paths.ts` — factory `resolvePaths(env)` + module-load `paths` singleton; five derived paths (configFile, tokensFile, tokensLockFile, storageModeFile); throws when neither HOME nor RECOVERY_LEDGER_HOME is set.
- `src/infrastructure/config/paths.test.ts` — 5 tests (default home, env override, all five derived paths, tokens.json.lock basename D-07, throw-on-empty-env).
- `src/infrastructure/config/schema.ts` — canonical Zod ConfigSchema (clientId regex, clientSecret non-empty, redirectPort positive int, scopes nonempty) + D13_SCOPES frozen tuple + InitConfig type.
- `src/infrastructure/config/schema.test.ts` — 5 tests (happy-path, clientId rejection, redirectPort=0 rejection, empty scopes rejection, D13_SCOPES frozen + order).
- `src/infrastructure/whoop/errors.ts` — AuthError discriminated-union class over 6 AuthErrorKind variants (auth_missing, auth_expired, auth_state_mismatch, auth_timeout, auth_port_in_use, refresh_failed); formatAuthError exhaustive switch with defense-in-depth default arm.
- `src/infrastructure/whoop/errors.test.ts` — 6 tests (kind preservation, cause-chain preserved, JSON.stringify carrier shape, auth_port_in_use construction, exhaustive switch over all six kinds, auth_port_in_use arm references init/port).
- `tests/helpers/msw-whoop-oauth.ts` — `createWhoopOauthHelper()` factory exports `{server, getRefreshHitCount, resetRefreshHitCount, setNextResponse}`; default handler reads `test/fixtures/oauth/token-200.json` and increments the closure counter on every hit. WHOOP_TOKEN_URL is the single source for the entire phase.
- `test/fixtures/oauth/token-200.json` — happy-path token-endpoint response (synthetic at-1/rt-1 — ADR-0006 fake-credential pattern).
- `test/fixtures/oauth/token-400-invalid-grant.json` — refresh-reuse / family-revocation response (Pitfall A).
- `test/fixtures/oauth/authorize-callback-state-mismatch.html` — D-09 failure HTML body for oauth.test.ts state-mismatch arm.

### Modified (2)

- `package.json` — added proper-lockfile@^4.1.2 + open@^11.0.0 to `dependencies`; msw@^2.14.6 + @types/proper-lockfile@^4.1.4 to `devDependencies`.
- `package-lock.json` — 68 packages added (16 runtime + 52 dev including msw transitive graph).

## Decisions Made

- **auth_port_in_use shipped in Wave 0 (not Wave 2):** Per checker BLOCKER 1, leaving the kind for Plan 02-03 to add would have meant Plan 02-02 (token-store) and Plan 02-03 (oauth) both touching errors.ts in the same wave — a same-wave file-overlap safety violation. Moving the kind into Wave 0 freezes errors.ts at 6 kinds from this plan onward; no Wave-2 plan mutates this file. Rationale captured in errors.ts module-leading doc comment.
- **Canonical ConfigSchema in a dedicated module:** Per checker WARNING PLAN-05-DRY-VIOLATION, Plan 02-05's init.ts and auth.ts would otherwise both define a `ConfigSchema` locally. Centralizing in `src/infrastructure/config/schema.ts` eliminates the drift surface — both consumers will `import { ConfigSchema, type InitConfig } from '../../infrastructure/config/schema.js'`.
- **WHOOP_TOKEN_URL hard-coded inside the helper:** T-02.01-04 mitigation. The helper is the single source for the URL string; token-store.ts and oauth.ts will import the same constant. A future test that wanted to point MSW at a different host would have to edit the helper, which makes the change visible at code-review time.
- **No implicit cwd() fallback in resolvePaths:** Throw mentioning HOME and RECOVERY_LEDGER_HOME (Test 5) so a misconfigured shell is caught at startup, not after a token write silently lands in the working directory. Decided over a "soft fall back to ~/.recovery-ledger anyway" alternative — failing loudly matches the rest of the codebase's MR-21 voice.
- **Biome line-break style accepted as-is:** Formatter wanted two specific reflows in paths.ts (configDir = ... split across two lines) and errors.ts (super() collapsed to one line). Both accepted verbatim — no rationale to override the project's auto-formatter.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Biome formatter wanted reflows on paths.ts and errors.ts**
- **Found during:** Task 2 GREEN, immediately after writing paths.ts and errors.ts.
- **Issue:** `npm run lint` flagged two format-only violations: paths.ts's long `configDir = env.RECOVERY_LEDGER_HOME ?? ...` single line needed splitting, and errors.ts's `super(init.detail ?? init.kind, init.cause === undefined ? undefined : { cause: init.cause })` multi-line construct needed collapsing.
- **Fix:** Ran `npm run format` to apply Biome's `--write` auto-fix.
- **Files modified:** `src/infrastructure/config/paths.ts`, `src/infrastructure/whoop/errors.ts`.
- **Verification:** `npm run lint` re-runs clean (0 errors); 16 tests still pass.
- **Committed in:** `0705a09` (same Task 2 GREEN commit — fix made before staging).

**2. [Rule 1 - Doc-comment regression in plan acceptance criterion] paths.ts comments mentioned `process.env`**
- **Found during:** Task 2 verification, when running `grep -nE 'process\.env' src/infrastructure/config/paths.ts` to satisfy the plan's acceptance criterion ("returns exactly one line, and that line matches `export const paths`").
- **Issue:** Two doc-comment occurrences of `process.env` (lines 36 and 60 — purely descriptive prose) caused the grep to return 3 lines instead of 1. The plan's intent was to verify resolvePaths' body contains no `process.env` reads; the comments were drift from that intent.
- **Fix:** Edited both doc-comment occurrences to "env-global" / "global env" while preserving the doc meaning. The body remains unchanged.
- **Files modified:** `src/infrastructure/config/paths.ts` (comment-only).
- **Verification:** `grep -nE 'process\.env' src/infrastructure/config/paths.ts` now returns exactly one line (line 64, `export const paths = resolvePaths(process.env)`).
- **Committed in:** `0705a09` (same Task 2 GREEN commit — fix made before staging).

**3. [Rule 3 - Blocking — out-of-scope precondition] `dist/mcp.mjs` stale relative to `src/mcp/index.ts`**
- **Found during:** Full-suite `npm run test` between Task 2 GREEN write and Task 2 GREEN commit.
- **Issue:** The Phase 1 integration test (`test/integration/mcp-stdout-purity.test.ts`) checks that `dist/mcp.mjs` is no older than `src/mcp/index.ts` and fails the suite if it is. The local dist had been built in a Phase 1 session before the final Plan 01-05/01-06 src edits landed; `dist/` is gitignored so the staleness is local-machine only and not a Task-2 regression.
- **Fix:** Ran `npm run build` (tsup) — re-emits `dist/mcp.mjs` from the current src tree.
- **Files modified:** `dist/` only (gitignored — not committed).
- **Verification:** Full suite (115 tests including the integration test) passes after rebuild.
- **Committed in:** N/A — `dist/` is gitignored; this was a pre-existing local-machine precondition not caused by Task 2 code changes.

---

**Total deviations:** 3 auto-fixed (1 blocking-format Rule 3, 1 minor Rule 1 plan-grep-criterion contract, 1 out-of-scope Rule 3 build precondition)
**Impact on plan:** None functional — the three auto-fixes were format-only, comment-only, and a local-machine build precondition. All plan acceptance criteria pass on the committed code; the AuthError contract, paths.ts shape, and ConfigSchema shape match the plan's `<interfaces>` block verbatim.

## Issues Encountered

- Vitest 4's full-suite run on a fresh checkout requires `npm run build` first (the integration test enforces a dist freshness check). Same precondition observed in Plans 01-05 and 01-06; the per-task verify command in this plan only scoped to `src/infrastructure/` so the integration test was not exercised during Task-2 verification itself. Worth a planner-template note: any plan that lists a full-suite verify command needs to chain `npm run build &&` ahead of `npm run test`.

## User Setup Required

None — no external service configuration required for this plan. All deps install cleanly from `npm install`; no env vars, no credentials, no dashboard touchpoints.

## Next Phase Readiness

Wave 1+ of Phase 2 is now unblocked. Plans 02-02 through 02-08 can import:

- `paths`, `resolvePaths`, `ResolvedPaths`, `PathsEnv` from `src/infrastructure/config/paths.ts`
- `ConfigSchema`, `D13_SCOPES`, `InitConfig` from `src/infrastructure/config/schema.ts`
- `AuthError`, `AuthErrorKind`, `AuthErrorInit`, `formatAuthError` from `src/infrastructure/whoop/errors.ts`
- `WHOOP_TOKEN_URL`, `createWhoopOauthHelper`, `WhoopOauthHelper` from `tests/helpers/msw-whoop-oauth.ts`

Three fixtures under `test/fixtures/oauth/` are ready for consumption by oauth.test.ts and token-store.test.ts. The AuthError union is FROZEN at 6 kinds — no Wave-2 plan mutates errors.ts.

No blockers. No open todos surfaced by this plan.

## Self-Check: PASSED

Files verified to exist:
- `src/infrastructure/config/paths.ts`: FOUND
- `src/infrastructure/config/paths.test.ts`: FOUND
- `src/infrastructure/config/schema.ts`: FOUND
- `src/infrastructure/config/schema.test.ts`: FOUND
- `src/infrastructure/whoop/errors.ts`: FOUND
- `src/infrastructure/whoop/errors.test.ts`: FOUND
- `tests/helpers/msw-whoop-oauth.ts`: FOUND
- `test/fixtures/oauth/token-200.json`: FOUND
- `test/fixtures/oauth/token-400-invalid-grant.json`: FOUND
- `test/fixtures/oauth/authorize-callback-state-mismatch.html`: FOUND

Commits verified in git log:
- `ded9836` (Task 1 — chore deps + MSW + fixtures): FOUND
- `dbee5a1` (Task 2 RED — failing tests): FOUND
- `0705a09` (Task 2 GREEN — modules implementation): FOUND

## TDD Gate Compliance

Task 2 (`tdd="true"`) followed the RED → GREEN cycle:

- **RED:** `dbee5a1` (`test(02-01): add failing RED tests for paths.ts, schema.ts, errors.ts`) — confirmed all three test files fail with import errors before implementation lands.
- **GREEN:** `0705a09` (`feat(02-01): implement paths.ts, schema.ts, errors.ts (GREEN — 16 tests pass)`) — modules ship; 16/16 tests pass.
- **REFACTOR:** skipped — GREEN implementation matched the planned `<interfaces>` shape without cleanup needed.

Task 1 (`tdd` not set) did not require the RED gate.

---
*Phase: 02-oauth-token-store-single-flight-refresh*
*Plan: 02-01-wave0-infra*
*Completed: 2026-05-12*
