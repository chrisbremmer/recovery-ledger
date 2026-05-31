---
phase: 05-doctor-polish-install-guide-20-minute-setup-validation
plan: 10
subsystem: testing
tags: [stopwatch, msw, ci, github-actions, integration-test, doc-06, setup-friction]

# Dependency graph
requires:
  - phase: 02-auth
    provides: runInitCommand / runAuthCommand / exchangeCode / tokenStore.write / ConfigSchema / RECOVERY_LEDGER_HOME relocation seam
  - phase: 03-sync
    provides: bootstrap() composition root + services.runSync + the 6 MSW resource helpers
  - phase: 04-review
    provides: services.getDailyReview + DailyReviewResult typed positive-output (insufficient) path
  - phase: 05-doctor-polish-install-guide-20-minute-setup-validation
    provides: "05-06 bootstrap()-bound runDoctor surface; 05-08 install-guide scope this stopwatch protects"
provides:
  - "Env-gated <20-minute setup stopwatch integration test (DOC-06 forcing function)"
  - "Dedicated PR-path-filtered GitHub Actions workflow running the stopwatch on macos-latest + ubuntu-latest"
affects: [phase-close, ci, install-guide, doc-06]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "describe.skipIf(env-gate) so an expensive integration test ships in-tree but adds zero default-suite runtime"
    - "Compose ONE MSW setupServer from N single-handler helpers via helper.server.listHandlers() flatMap (zero new handlers)"
    - "Service-layer invocation (bootstrap().services + exchangeCode + tokenStore.write) instead of process.exit()-calling CLI shims so in-process MSW interception holds"
    - "Dedicated PR-path-filtered workflow mirroring test-coverage scope, action SHAs pinned in lockstep with ci.yml"

key-files:
  created:
    - tests/integration/setup-stopwatch.test.ts
    - .github/workflows/setup-stopwatch.yml
  modified: []

key-decisions:
  - "Auth step uses DIRECT token exchange via exchangeCode against the MSW token endpoint (researcher's recommended path), then tokenStore.write — NOT a loopback callback POST"
  - "init step writes config.json directly via ConfigSchema rather than calling runInitCommand (which calls process.exit() internally and would kill the vitest worker)"
  - "sync + review-daily steps use bootstrap().services.runSync / getDailyReview directly for the same process.exit()-avoidance + MSW-interception reason"
  - "cpSync clone additionally excludes .git (19M) and coverage for speed; clone is NOT timed per D-12"

patterns-established:
  - "Env-gated stopwatch: describe.skipIf(!RUN_STOPWATCH) keeps DOC-06 in-tree with zero default-suite cost"
  - "MSW multi-helper composition via listHandlers() flatMap"

requirements-completed: [DOC-06]

# Metrics
duration: ~35min
completed: 2026-05-29
---

# Phase 5 Plan 10: <20-Minute Setup Stopwatch + Dedicated CI Workflow Summary

**Env-gated integration test asserting npm install to first `review daily` completes under a 20-minute budget (measured 5s locally on a warm cache), plus a PR-path-filtered macOS+Ubuntu GitHub Actions workflow — the DOC-06 forcing function for the Phase 5 "new clone reaches first review in under 20 minutes" criterion.**

## Performance

- **Duration:** ~35 min
- **Started:** 2026-05-29 (local)
- **Completed:** 2026-05-29
- **Tasks:** 2
- **Files created:** 2

## Accomplishments

- `tests/integration/setup-stopwatch.test.ts`: env-gated (`VITEST_INCLUDE_STOPWATCH=1`) stopwatch that clones the repo into a tmp dir (untimed), then times `npm install` + `npm run build` + init + auth + sync + review-daily against an in-process MSW server composed from all 7 existing helpers. `STOPWATCH_BUDGET_MS = 20 * 60 * 1000` is a top-of-file const. Default `npm test` skips it (verified: 1 skipped, 0 tests run).
- **Gated run genuinely passes end-to-end** — measured elapsed **5 seconds** against the 1200s budget. The sync log shows all 6 WHOOP resources fetched through MSW (`status: success`) and `getDailyReview` computed `confidence_tier: insufficient` (the ADR-0004 typed positive output), proving the full code path executed.
- `.github/workflows/setup-stopwatch.yml`: runs on `macos-latest` + `ubuntu-latest` (`fail-fast: false`), PR-path-filtered to `package.json`, `package-lock.json`, `src/cli/**`, `src/services/bootstrap.ts`, `src/infrastructure/db/migrations/**`; sets `VITEST_INCLUDE_STOPWATCH=1` always and `RECOVERY_LEDGER_FORCE_FILE_STORE=1` on ubuntu only; `timeout-minutes: 30`; concurrency group with `cancel-in-progress`. Action SHAs copied verbatim from `ci.yml`.

## Task Commits

Both tasks shipped in a single atomic commit (no parallel agents; the test + workflow + this summary are one logical unit):

1. **Task 1: setup-stopwatch integration test** + **Task 2: dedicated CI workflow** — see plan metadata commit below.

**Plan metadata + artifacts:** committed together as `test(05): <20min setup stopwatch + dedicated CI workflow (05-10)`.

## Files Created/Modified

- `tests/integration/setup-stopwatch.test.ts` — env-gated <20-min stopwatch; composes 7 MSW helpers; service-layer invocation; `performance.now()` timing; `process.stderr.write` diagnostic; 25-min Vitest timeout.
- `.github/workflows/setup-stopwatch.yml` — dedicated macOS+Ubuntu workflow; PR path filter; pinned action SHAs from ci.yml.

## Decisions Made

### Auth-flow choice: DIRECT token exchange via MSW token endpoint (NOT loopback callback POST)

The plan authorized either path. I chose **direct token exchange** per the researcher's recommendation:

```
const tokens = await exchangeCode({ code, redirectUri, clientId, clientSecret });
await tokenStore.write(tokens);
```

`exchangeCode` POSTs to `WHOOP_TOKEN_URL` (the oauth helper mocks the production URL since no env override is set), so this drives a **real HTTP POST through MSW** — honest to the OAuth flow — without standing up an in-process loopback callback server (which would add a 127.0.0.1 listener + browser-redirect simulation for no measurable budget benefit). The token-200 fixture's `expires_in: 3600` puts `expiresAt` ~1h out, so the subsequent sync's `getValidAccessToken()` returns the stored token **without a second refresh fetch** — keeping the auth HTTP cost negligible versus the install/build cost the budget actually protects (D-12).

### Service-layer invocation instead of CLI shims (verified codebase constraint)

The plan's pseudocode imported `runInitCommand` / `runAuthCommand` / `runSyncCommand` / `runReviewDailyCommand` in-process. Verified at execution time: **every one of those shims calls `process.exit()` internally** (init writes config then exits; auth runs runOAuth then exits; etc.), which would terminate the vitest worker. Also `src/cli/commands/review.ts` does not exist (it is `review-daily.ts`). The plan's Task 1 adapter note explicitly authorizes the service-layer fallback, so:
- **init** → write `config.json` directly via `ConfigSchema.parse(...)` (init's only real job).
- **auth** → `exchangeCode` + `tokenStore.write` (above).
- **sync** → `bootstrap().services.runSync({ days: 7 })`.
- **review daily** → `bootstrap().services.getDailyReview({})`, asserted on shape only (`data_status` + `confidence` present), never content.

This is the D-14 realism trade: MSW intercepts undici fetch in-process only, so the WHOOP-touching steps must run in the parent worker. The dominant cost (`npm install` + `npm run build` as real subprocesses in the tmp repo) is unchanged, which is what keeps the boundary honest.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Service-layer invocation replaces in-process CLI-shim calls**
- **Found during:** Task 1
- **Issue:** The plan's literal imports (`runInitCommand` etc.) all call `process.exit()` internally, which would kill the vitest worker; `review.ts` does not exist (`review-daily.ts` does). In-process invocation as written is impossible.
- **Fix:** Used the plan-authorized service-layer fallback — direct `ConfigSchema` write for init, `exchangeCode` + `tokenStore.write` for auth, `bootstrap().services.runSync` + `getDailyReview` for sync + review. Same end-to-end code path; MSW still intercepts.
- **Files modified:** tests/integration/setup-stopwatch.test.ts
- **Verification:** Gated run passes end-to-end (5s elapsed); sync log shows all 6 resources fetched via MSW; review computes insufficient (ADR-0004).
- **Committed in:** plan commit.

**2. [Rule 3 - Blocking] cpSync filter excludes .git + coverage in addition to node_modules/dist**
- **Found during:** Task 1
- **Issue:** `.git` is 19M; copying it (and `coverage/`) into the tmp clone is slow and pointless and could trip the default 10s hook timeout.
- **Fix:** Extended the cpSync filter to also skip `.git` and `coverage`; set an explicit 5-min `beforeAll` hook timeout. The clone is NOT timed (D-12), so this does not affect the measured boundary.
- **Files modified:** tests/integration/setup-stopwatch.test.ts
- **Verification:** beforeAll completes well under the hook budget; gated run passes.
- **Committed in:** plan commit.

---

**Total deviations:** 2 auto-fixed (both Rule 3 - blocking). Both are exactly the plan's documented adapter fallbacks made concrete against the verified codebase.
**Impact on plan:** No scope creep. The D-12 boundary and DOC-06 intent are preserved.

## Issues Encountered

- **5-second elapsed looked too fast for a "real npm install."** Investigated: a clean `npm install` from `package.json` in a fresh tmp dir takes ~3.3s here because `better-sqlite3` and `@napi-rs/keyring` ship **prebuilt `.node` binaries** (no source compile) and the npm cache is warm. Confirmed the prebuilt binary and `tsup` are both present in a fresh install. The 5s is a genuine, honest measurement of the full boundary on a warm-cache machine; cold CI (matrix `npm ci`) will be slower but stays far inside the 20-min budget. Not a stub — the build assertion (`buildResult.status === 0`) requires tsup to actually produce dist/.

## Verification Gates (final state)

1. `npx tsc --noEmit` — **PASS**: exactly the 6 documented baseline errors (auth.ts x1, sync-runs.repo.ts x3, msw-whoop-oauth.ts x2); **zero new**.
2. Default suite skips it — **PASS**: `npx vitest run tests/integration/setup-stopwatch.test.ts` (no env var) reports `1 skipped`, 0 tests run.
3. Gated run — **PASS**: `VITEST_INCLUDE_STOPWATCH=1 npx vitest run ...` passes end-to-end; **measured elapsed 5s** (budget 1200s); prints `Stopwatch elapsed: 5s (budget 1200s)`.
4. `python3 -c "import yaml; yaml.safe_load(open('.github/workflows/setup-stopwatch.yml'))"` — **PASS** (matrix = [macos-latest, ubuntu-latest]; VITEST_INCLUDE_STOPWATCH present).
5. `bash scripts/ci-grep-gates.sh` — **PASS** (all 10 grep gates green).

Additional: full default `npm test` — **PASS** (114 passed | 1 skipped files; 1203 passed | 1 skipped tests; 9.12s — runtime unchanged).

## User Setup Required

None - no external service configuration required. MSW serves fake credentials; no secrets needed by the test or the workflow.

## Next Phase Readiness

- DOC-06 is satisfied and CI-tracked. The stopwatch is the regression guard for the Phase 5 setup-friction success criterion.
- Phase-close note: the deferred 6 `tsc` baseline errors remain out of scope here; a future clean-up pass should address them if phase-close requires a clean `tsc --noEmit`.

---
*Phase: 05-doctor-polish-install-guide-20-minute-setup-validation*
*Completed: 2026-05-29*

## Self-Check: PASSED

- FOUND: `tests/integration/setup-stopwatch.test.ts`
- FOUND: `.github/workflows/setup-stopwatch.yml`
- FOUND: `.planning/phases/05-doctor-polish-install-guide-20-minute-setup-validation/05-10-SUMMARY.md`
- All 5 verification gates green; default suite unchanged.
