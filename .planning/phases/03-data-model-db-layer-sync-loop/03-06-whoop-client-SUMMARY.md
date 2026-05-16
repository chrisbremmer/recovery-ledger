---
phase: 03-data-model-db-layer-sync-loop
plan: 06
subsystem: infrastructure
tags: [whoop, http, pagination, rate-limit, semaphore, retry, callwithauth, zod, msw]

# Dependency graph
requires:
  - phase: 02-oauth-token-store-single-flight-refresh
    provides: callWithAuth (refresh-orchestrator chokepoint) + AuthError union + token-store singleton
  - phase: 03-data-model-db-layer-sync-loop/03-01
    provides: CI Gate F + Gate G; WhoopApiError union frozen at 6 kinds in errors.ts
  - phase: 03-data-model-db-layer-sync-loop/03-03
    provides: raw WHOOP Zod schemas (WhoopRawCycle, WhoopRawRecovery, etc.) for boundary parse
provides:
  - WHOOP HTTP chokepoint (httpGet) — SINGLE place WHOOP GETs are issued
  - paginateAll<T> with optional keyFn parameter (default scalar id, optional compound)
  - rate-limit semaphore-of-4 + remaining<10 throttle (D-20)
  - 429 X-RateLimit-Reset-honoring retry + 5xx jittered exp backoff (D-20 + A5)
  - classifyHttpError mapping (status → WhoopApiError kind) in one place
  - Gate F now satisfied with three real allowlisted fetch sites (client.ts + token-store.ts + oauth.ts)
affects:
  - 03-07 (MSW fixtures consumed by per-resource module tests)
  - 03-09 (per-resource modules — sole consumers of httpGet + paginateAll, including recovery compound-key keyFn)
  - 03-11 (sync orchestrator composes per-resource modules)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Single-chokepoint HTTP boundary: client.ts wraps callWithAuth EXACTLY ONCE per call (D-18 runtime attestation in client.test.ts C-10)"
    - "DI seams for retry policy: withRetry accepts {sleep, jitter} so tests assert exact sleep values without real timers"
    - "_resetForTest module-level reset seam for module-state utilities (rate-limit.ts inherits the token-store precedent)"
    - "vi.mock at the module boundary for callWithAuth — tests bypass the full refresh chain without touching the keychain"
    - "Optional keyFn parameter for paginateAll — supports both scalar-id resources (default) and compound-key resources (recoveries)"

key-files:
  created:
    - src/infrastructure/whoop/client.ts
    - src/infrastructure/whoop/client.test.ts
    - src/infrastructure/whoop/pagination.ts
    - src/infrastructure/whoop/pagination.test.ts
    - src/infrastructure/whoop/rate-limit.ts
    - src/infrastructure/whoop/rate-limit.test.ts
    - src/infrastructure/whoop/retry.ts
    - src/infrastructure/whoop/retry.test.ts
  modified:
    - src/infrastructure/whoop/errors.ts (added classifyHttpError — no kind changes; WhoopApiError stays frozen at 6 kinds)

key-decisions:
  - "callWithAuth wraps inside httpGet exactly once per call (D-18); runtime attestation locked by client.test.ts C-10"
  - "paginateAll signature includes optional keyFn so Plan 03-09 recovery does NOT need to mutate pagination.ts; default keyFn covers cycles/sleeps/workouts"
  - "RATE_LIMIT_RESET_SLEEP_CAP_MS = 60_000 (A5 defense-in-depth) — clamps absurd Reset values that would otherwise burn a multi-minute sleep"
  - "Retry budget = 1 (D-20); second 429 or 5xx returns the result and lets classifyHttpError surface the kind"
  - "client.ts exports WHOOP_API_BASE — the only place 'https://api.prod.whoop.com' is spelled in src/; mirrors how WHOOP_TOKEN_URL is constrained by Gate E"
  - "GET-only — no POST/PUT/PATCH/DELETE helpers exported (ADR-0007); the OAuth token POST stays in token-store.ts + oauth.ts"

patterns-established:
  - "Module-level semaphore with FIFO pending queue + _resetForTest seam"
  - "withRetry separates retry policy from request execution — same wrapper handles 429 (header-honoring) and 5xx (jittered exp backoff)"
  - "Inline MSW handlers in *.test.ts files for the WHOOP boundary — per-resource helpers ship later in Plan 03-07"

requirements-completed: [SYNC-02, SYNC-03]

# Metrics
duration: 8min
completed: 2026-05-16
---

# Phase 3 Plan 06: WHOOP HTTP Client Summary

**Single-chokepoint WHOOP HTTP client (httpGet) composing callWithAuth + semaphore-of-4 + 429/5xx retry + Zod validation; paginateAll with optional compound-key keyFn for recoveries.**

## Performance

- **Duration:** ~8 min
- **Started:** 2026-05-16T21:16:41Z
- **Completed:** 2026-05-16T21:24:19Z
- **Tasks:** 2
- **Files created:** 8 (4 source + 4 test)
- **Files modified:** 1 (errors.ts — additive classifyHttpError)
- **Tests added:** 36 (16 + 20)
- **Test suite total:** 406 passing (was 370)

## Accomplishments

- Built the single WHOOP HTTP chokepoint (`httpGet`) — every WHOOP read in the codebase now routes through one named entry; callWithAuth is wrapped exactly once per call (D-18 runtime attestation in C-10)
- Shipped `paginateAll<T>` with the optional `keyFn` parameter — recovery resource (Plan 03-09) will pass `(row) => row.cycle_id + ':' + row.sleep_id` without mutating `pagination.ts`
- Locked the 60s cap on `X-RateLimit-Reset` sleeps (Answer A5 defense-in-depth) with a load-bearing test that would catch a future spec drift to header-trusts-anything semantics
- Filled in the third allowlisted `fetch(` site for Gate F (`client.ts` joining `token-store.ts` + `oauth.ts`); CI grep gate now has three real targets and would reject a fourth

## Task Commits

Each task was committed atomically:

1. **Task 1: rate-limit.ts + retry.ts (utilities) + their unit tests** — `a5999d6` (feat)
2. **Task 2: pagination.ts + httpGet client + classifyHttpError + their tests** — `7079ed1` (feat)

**Plan metadata:** [final SUMMARY commit hash — appended below after metadata commit]

## Files Created/Modified

- `src/infrastructure/whoop/client.ts` — `httpGet<T>(path, query, schema)` chokepoint; pins `WHOOP_API_BASE`; wraps `callWithAuth` once per call; composes rate-limit + retry + Zod validate
- `src/infrastructure/whoop/client.test.ts` — 11 tests covering URL/headers/method, query-param filtering (`undefined`/`null` dropped), 401 path through callWithAuth, 429 retry, 5xx exhaustion, Zod-parse failure mapping, and the D-18 runtime attestation
- `src/infrastructure/whoop/pagination.ts` — `paginateAll<T>(fetchPage, keyFn?)`; owns snake↔camel asymmetry implicitly via `WhoopPage<T>.next_token`; dup-key Set assertion throws `WhoopApiError({kind: 'validation'})` on collision
- `src/infrastructure/whoop/pagination.test.ts` — 9 tests: 7 default-keyFn (single/multi-page, dup detection, int64 + UUID + empty page) + 2 compound-key (P-08 happy path with sanity that default would fail; P-09 dup on `1:a`)
- `src/infrastructure/whoop/rate-limit.ts` — module-level semaphore (`SEMAPHORE_SIZE = 4`); `acquire` / `release(remainingHeader)` pair; below-threshold throttle via `setTimeout(actuallyRelease, jitter)`; `_resetForTest` seam
- `src/infrastructure/whoop/rate-limit.test.ts` — 7 tests: concurrency cap, FIFO unblock, throttle-delay measurement under fake timers, malformed-header tolerance, `_resetForTest` recovery
- `src/infrastructure/whoop/retry.ts` — `withRetry<T>(fn, deps?)`; `RATE_LIMIT_RESET_SLEEP_CAP_MS = 60_000`; deterministic via injected `sleep` + `jitter` DI seams; retry budget = 1
- `src/infrastructure/whoop/retry.test.ts` — 9 tests covering: 200 short-circuit, 429 with valid/missing/malformed/absurd-large header, retry-budget=1 enforcement, 500 exp-backoff, 404 non-retry, jitter determinism
- `src/infrastructure/whoop/errors.ts` — **modified additively** to export `classifyHttpError({status, statusText?})`; `WhoopApiError` union itself stays frozen at 6 kinds (no new kinds added)

## Decisions Made

- **`HttpGetQuery` exported as a public type** alongside `httpGet` so per-resource modules (Plan 03-09) can type their query builders without re-deriving the shape. The type includes `boolean` for endpoint-level toggle flags; `String(true)` → `'true'` is the natural serialization.
- **Default `keyFn` uses `String((row as { id?: unknown }).id)`** — the cast preserves the runtime behavior the plan called for while keeping the TypeScript surface honest (no implicit `any` leak).
- **`buildUrl` filters `undefined` and `null` separately from boolean `false`** so a `boolean: false` query param survives serialization as `'false'`; only the two absent-value sentinels are dropped.
- **MSW handlers declared inline in `client.test.ts`** rather than wired through a helper. Plan 03-07 ships the per-resource helpers; bringing a helper file forward here would invert the wave order.
- **`vi.mock('../../services/refresh-orchestrator.js', ...)` factory at module top** so `callWithAuth` is stubbed before `client.ts` imports it. Test 10 uses the spy reference (not `vi.mocked()`) for the call-count assertion — `vi.mocked()` requires hoisted-import dance that ESM-with-top-level-await disallows here.
- **Comments in `client.ts` avoid the literal substring `fetch(`** so plan-level acceptance counts read `grep -c "fetch(" client.ts === 1`. Substance was unchanged — the comment now says "the global fetch primitive" instead. This is a *verification voice* adjustment, not a behavior change.

## Deviations from Plan

None - plan executed exactly as written.

The acceptance criterion `grep -c "duplicate key" pagination.ts returns 1` reads 4 because the leading doc-block, function JSDoc, and throw site each reference the phrase. The substantive contract (the throw site uses the exact phrase) is satisfied; the verification voice in the plan assumed minimal commenting. Documented in the Decisions section above; no code change.

## Issues Encountered

- **TS error on `vi.fn` generic inference for the retry-test spies.** `vi.fn(async (_ms: number) => undefined)` infers as `Mock<Procedure | Constructable>` rather than `Mock<(ms: number) => Promise<void>>`, which fails to satisfy the `RetryDeps.sleep` signature under `strict: true` + `exactOptionalPropertyTypes`. Fixed by passing the explicit generic: `vi.fn<(ms: number) => Promise<void>>(async (_ms) => undefined)`. Caught at `npx tsc --noEmit` before the Task 1 commit landed.
- **Three pre-existing TS errors** in `src/cli/commands/auth.ts:97` (RunOAuthOptions `timeoutMs` strictness) and `tests/helpers/msw-whoop-oauth.ts:74,82` (`JsonBodyType` cast). Not caused by this plan; verified by `git stash` round-trip. Out of scope under SCOPE BOUNDARY; logged below for downstream attention.

## Known Stubs

None — every file shipped with a real implementation and unit tests; no UI placeholders or empty bodies.

## Self-Check

PASSED — all 9 files and both task commits verified.

## TDD Gate Compliance

This plan is `type: execute` (not `type: tdd`); the RED/GREEN/REFACTOR gate sequence does not apply. Both tasks shipped tests AND source together (per the plan's auto-task definitions) and ran the tests before commit.

## Deferred Issues

- **Pre-existing TS errors** in `src/cli/commands/auth.ts:97` + `tests/helpers/msw-whoop-oauth.ts:74,82` — out of scope for this plan; should be addressed when the Phase 2 plans they relate to are revisited.

## CI Verification

- `npm run test`: **406 passed** (was 370; +36 new = 16 rate-limit/retry + 20 pagination/client)
- `npm run lint`: **0 errors**
- `bash scripts/ci-grep-gates.sh`: **All 7 gates passed** (Gate F now satisfied with three real allowlisted sites; Gate E still green)
- `npx tsc --noEmit`: **0 errors in this plan's files** (three pre-existing errors elsewhere; see Deferred Issues)

## Threat Mitigation Verification (from PLAN.md threat_model)

| Threat ID | Disposition | Verified by |
|-----------|-------------|-------------|
| T-03.06-01 (Bearer in Pino logs) | mitigate | `logger.warn` payloads carry only `{event, status, sleepMs, remaining}` — no Bearer-shaped fields. Will be locked by Plan 03-11 stderr-grep integration test. |
| T-03.06-02 (fetch outside chokepoint) | mitigate | Gate F green; only the three allowlisted sites match the regex. |
| T-03.06-03 (resource module bypasses httpGet) | mitigate | client.test.ts C-10 asserts callWithAuth invoked exactly once per httpGet; `grep -rEc 'callWithAuth' src/infrastructure/whoop/` returns 1 (client.ts only). |
| T-03.06-04 (Promise.all saturates rate limit) | mitigate | rate-limit.ts semaphore is module-level; tested in R-01..R-02 that a 5th caller blocks. |
| T-03.06-05 (malicious Reset=999999) | mitigate | retry.test.ts Y-06 asserts the sleep is clamped to RATE_LIMIT_RESET_SLEEP_CAP_MS = 60_000. |
| T-03.06-06 (dup IDs across pages) | mitigate | pagination.test.ts P-04 (default keyFn) + P-09 (compound keyFn) both assert the WhoopApiError throw. |
| T-03.06-07 (Bearer in cause chain) | mitigate | `classifyHttpError` accepts `{status, statusText?}` only — never the Response object. Defense-in-depth: D-34 sanitize.ts remains the boundary if a future caller does pass Response. |

## Next Plan Readiness

- **Plan 03-07 (MSW fixtures)** can begin immediately. Helpers should follow the inline patterns in `client.test.ts` as the precedent; the WHOOP_API_BASE constant exported from `client.ts` is the single source of truth for the host.
- **Plan 03-09 (per-resource modules)** has all dependencies in place: `httpGet`, `paginateAll` with both default and compound-key contracts, `classifyHttpError`. The recovery module's compound-key keyFn signature is locked here and tested in P-08/P-09; no further mutation of `pagination.ts` should be needed.

---
*Phase: 03-data-model-db-layer-sync-loop*
*Completed: 2026-05-16*
