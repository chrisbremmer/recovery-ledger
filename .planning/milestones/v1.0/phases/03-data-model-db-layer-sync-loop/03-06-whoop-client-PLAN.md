---
phase: 03-data-model-db-layer-sync-loop
plan: 06
type: execute
wave: 2
depends_on: ["03-01", "03-03"]
files_modified:
  - src/infrastructure/whoop/client.ts
  - src/infrastructure/whoop/pagination.ts
  - src/infrastructure/whoop/rate-limit.ts
  - src/infrastructure/whoop/retry.ts
  - src/infrastructure/whoop/errors.ts
  - src/infrastructure/whoop/client.test.ts
  - src/infrastructure/whoop/pagination.test.ts
  - src/infrastructure/whoop/rate-limit.test.ts
  - src/infrastructure/whoop/retry.test.ts
autonomous: true
requirements: [SYNC-02, SYNC-03]
tags: [whoop, http, pagination, rate-limit, semaphore, retry, callwithauth]
user_setup: []

must_haves:
  truths:
    - "D-17: per-resource modules over a shared httpGet — src/infrastructure/whoop/client.ts owns the single chokepoint that resource modules under src/infrastructure/whoop/resources/ consume; no resource module calls fetch directly"
    - "src/infrastructure/whoop/client.ts exports httpGet<T>(path, query, schema): Promise<T> — wraps callWithAuth EXACTLY ONCE per call (D-18)"
    - "WHOOP_API_BASE pinned to 'https://api.prod.whoop.com' per ADR-0007 / D-21 (GET-only)"
    - "Gate E preserved: callWithAuth and tokenStore.getValidAccessToken are unchanged; only token-store.ts references oauth/oauth2/token"
    - "Gate F satisfied: client.ts is the third fetch( call site (alongside token-store.ts + oauth.ts)"
    - "pagination.ts exports paginateAll<T>(fetchPage, keyFn?: (row: T) => string) — keyFn defaults to String(row.id) for resources with a scalar id; recovery passes a compound-key keyFn `(row) => row.cycle_id + ':' + row.sleep_id`. paginateAll asserts no duplicate keys across consecutive pages, throws WhoopApiError({kind: 'validation'}) on dup (D-19 + Pitfall 10)"
    - "rate-limit.ts exports acquire() + release(remainingHeader) — module-level semaphore of 4 + X-RateLimit-Remaining<10 throttle (D-20)"
    - "retry.ts handles 429 by sleeping X-RateLimit-Reset seconds (delta seconds per A5; cap at 60s ceiling defense-in-depth) and 5xx with jittered exp backoff, retry budget 1"
    - "All errors thrown from httpGet are either AuthError (passed through from callWithAuth) or WhoopApiError (mapped from response status)"
    - "ADR-0002 chokepoint preserved: callWithAuth is the SOLE consumer of tokenStore.getValidAccessToken; httpGet is the SOLE consumer of callWithAuth in src/infrastructure/whoop/"
    - "ADR-0001: no console.* / process.stdout.write; structured Pino logs only ({event: 'rate_limit_throttle', remaining: N})"
  artifacts:
    - path: "src/infrastructure/whoop/client.ts"
      provides: "httpGet auth-wrapped + rate-limited + retry-wrapped + Zod-validated WHOOP GET"
      contains: "callWithAuth"
    - path: "src/infrastructure/whoop/pagination.ts"
      provides: "paginateAll utility owning snake_case next_token → camelCase nextToken translation; optional keyFn supports compound-key resources (recoveries)"
      contains: "paginateAll"
    - path: "src/infrastructure/whoop/rate-limit.ts"
      provides: "Module-level semaphore-of-4 + throttle-when-remaining<10"
      contains: "SEMAPHORE_SIZE"
    - path: "src/infrastructure/whoop/retry.ts"
      provides: "429 X-RateLimit-Reset-honoring + 5xx jittered exp backoff"
      contains: "RATE_LIMIT_RESET_SLEEP_CAP_MS"
  key_links:
    - from: "src/infrastructure/whoop/client.ts"
      to: "src/services/refresh-orchestrator.ts (Plan 02-04 callWithAuth)"
      via: "named import callWithAuth"
      pattern: "from '../../services/refresh-orchestrator"
    - from: "src/infrastructure/whoop/client.ts"
      to: "https://api.prod.whoop.com"
      via: "WHOOP_API_BASE constant"
      pattern: "api\\.prod\\.whoop\\.com"
    - from: "src/infrastructure/whoop/client.ts"
      to: "src/infrastructure/whoop/rate-limit.ts acquire/release"
      via: "imports"
      pattern: "acquire|release"
---

<objective>
Build the WHOOP HTTP client chokepoint — the SINGLE place WHOOP GETs are issued, the SOLE consumer of `callWithAuth` from Plan 02-04, and the only file (alongside `token-store.ts` and `oauth.ts`) where `fetch(` may appear per new Gate F. Compose four utilities: `client.ts` (orchestrator), `pagination.ts` (snake↔camel + dup-key with optional keyFn for compound keys), `rate-limit.ts` (semaphore-of-4 + throttle), `retry.ts` (429 + 5xx with header-honoring backoff).

Purpose: Every Phase 3 resource module (Plan 03-09) and Phase 4's `whoop_sync` tool will route through this client. Plan 02-06's Gate E (only token-store.ts references the OAuth refresh URL) plus Plan 02-04's "callWithAuth is the SOLE consumer of getValidAccessToken outside token-store" plus the new Gate F (only 3 files do fetch) all converge here — this client is what makes the chokepoint pattern enforceable at CI-grep time.

This plan owns the `paginateAll` signature including the optional `keyFn` parameter that Plan 03-09 recovery resource module depends on for compound-key (cycle_id + sleep_id) duplicate detection. The signature is locked here so 03-09 does NOT need to mutate `pagination.ts`.

Output: 4 source files (~450 LOC total) + 4 unit-test files. MSW helpers + fixtures live in Plan 03-07; this plan stubs MSW inline where needed.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/PROJECT.md
@.planning/phases/03-data-model-db-layer-sync-loop/03-CONTEXT.md
@.planning/phases/03-data-model-db-layer-sync-loop/03-RESEARCH.md
@.planning/phases/03-data-model-db-layer-sync-loop/03-PATTERNS.md
@.planning/research/PITFALLS.md
@agent_docs/decisions/0001-mcp-stdout-purity.md
@agent_docs/decisions/0002-single-flight-oauth-refresh.md
@agent_docs/decisions/0007-whoop-read-only.md
@src/infrastructure/whoop/errors.ts
@src/services/refresh-orchestrator.ts
@src/infrastructure/whoop/oauth.ts
@src/infrastructure/config/logger.ts
@src/domain/schemas/whoop-api.ts

<interfaces>
<!-- httpGet — single chokepoint (D-17 + D-18 + D-21 + ADR-0007) -->

  import { z } from 'zod';
  export const WHOOP_API_BASE = 'https://api.prod.whoop.com';

  export async function httpGet<T>(
    path: string,
    query: Record<string, string | number | boolean | undefined | null>,
    schema: z.ZodSchema<T>,
  ): Promise<T>;

<!-- paginateAll — D-19 + Pitfall 10 + compound-key support for recoveries -->

  export interface WhoopPage<T> {
    records: T[];
    next_token: string | null;
  }

  /**
   * Aggregate every page from a paginated WHOOP endpoint, asserting no duplicate
   * keys across consecutive pages. The optional `keyFn` lets compound-key resources
   * (recoveries, keyed by cycle_id + sleep_id) provide a deterministic dedup key.
   *
   * Default: `keyFn = (row) => String((row as any).id)` — works for cycles (int64 id),
   * sleeps (UUID id), workouts (UUID id), and any future single-scalar-id resource.
   *
   * Recovery resource module (Plan 03-09) passes:
   *   paginateAll(fetcher, (row) => row.cycle_id + ':' + row.sleep_id)
   */
  export async function paginateAll<T>(
    fetchPage: (nextToken: string | null) => Promise<WhoopPage<T>>,
    keyFn?: (row: T) => string,
  ): Promise<T[]>;

<!-- rate-limit — D-20 -->

  export async function acquire(): Promise<void>;
  export function release(remainingHeader: string | null): void;
  // Test-only seam:
  export function _resetForTest(): void;  // resets semaphore + pending queue + sleep timer state

<!-- retry — D-20 + A5 -->

  export interface RetryDeps {
    sleep?: (ms: number) => Promise<void>;
    jitter?: () => number;
  }
  export async function withRetry<T>(
    fn: () => Promise<{ status: number; headers: Headers; body: T }>,
    deps?: RetryDeps,
  ): Promise<{ status: number; headers: Headers; body: T }>;

<!-- error mapping -->

  export function classifyHttpError(res: { status: number; statusText?: string }): WhoopApiError;
  // 401 → 'unauthorized', 429 → 'rate_limited', 5xx → 'server', network → 'network', zod throw → 'validation', else → 'unknown'
</interfaces>
</context>

<tasks>

<task type="auto">
  <name>Task 1: rate-limit.ts + retry.ts (utilities) + their unit tests</name>
  <files>src/infrastructure/whoop/rate-limit.ts, src/infrastructure/whoop/rate-limit.test.ts, src/infrastructure/whoop/retry.ts, src/infrastructure/whoop/retry.test.ts</files>
  <read_first>
    - .planning/phases/03-data-model-db-layer-sync-loop/03-CONTEXT.md decisions D-20 (semaphore of 4 + throttle when remaining<10 + 429 honors X-RateLimit-Reset) + D-22 (WhoopApiError union shipped Wave 0)
    - .planning/phases/03-data-model-db-layer-sync-loop/03-RESEARCH.md §Pattern 8 lines 627-658 (rate-limit + retry code), §Technical Research item 5 lines 1102-1110 (verified headers: X-RateLimit-Reset is delta seconds NOT epoch; cap at 60s ceiling per A5)
    - .planning/phases/03-data-model-db-layer-sync-loop/03-PATTERNS.md §B3 lines 539-567 (rate-limit) + §B4 lines 571-617 (retry)
    - .planning/research/PITFALLS.md Pitfall 11 (X-RateLimit-Reset is delta seconds; fixed backoff burns quota)
    - src/infrastructure/whoop/errors.ts (Wave 0 added WhoopApiError; classifyHttpError will use these kinds)
  </read_first>
  <action>
    Create `src/infrastructure/whoop/rate-limit.ts`. Leading comment cites D-20 + Pattern 8 + Pitfall 11.
      - Constants at top: `SEMAPHORE_SIZE = 4` (D-20), `REMAINING_THROTTLE_THRESHOLD = 10` (D-20), `THROTTLE_DELAY_MIN_MS = 250` + `THROTTLE_DELAY_MAX_MS = 500` (jittered).
      - Module-level state: `let pending: Array<() => void> = []`, `let inFlight = 0`.
      - `export async function acquire(): Promise<void>` — classic semaphore: if `inFlight < SEMAPHORE_SIZE`, increment + return; else push a resolver onto `pending` and return the Promise. The semaphore is FIFO.
      - `function actuallyRelease(): void` — decrements `inFlight`, shifts the next pending resolver if any. Internal helper.
      - `export function release(remainingHeader: string | null): void` — main release path:
        - Parse remaining: `const remaining = remainingHeader === null ? null : Number(remainingHeader); if (Number.isNaN(remaining)) remaining = null;`
        - If `remaining !== null && remaining < REMAINING_THROTTLE_THRESHOLD`: log `logger.warn({event: 'rate_limit_throttle', remaining})` and `setTimeout(actuallyRelease, THROTTLE_DELAY_MIN_MS + Math.random() * (THROTTLE_DELAY_MAX_MS - THROTTLE_DELAY_MIN_MS))`. The next acquire is delayed by ~250-500ms.
        - Else: `actuallyRelease()` immediately.
      - `export function _resetForTest(): void` — clears `pending`, sets `inFlight = 0`. Test-only seam (Phase 2 token-store precedent: similar internal reset patterns).
      - Log via Pino (S2 logger discipline): `import { logger } from '../config/logger.js'`.

    Create `src/infrastructure/whoop/rate-limit.test.ts`:
      - Test 1: 4 concurrent acquires resolve immediately (no waiting).
      - Test 2: 5th acquire blocks; releasing one of the first 4 unblocks it.
      - Test 3: After release with remaining='5' header, the next acquire is delayed by at least THROTTLE_DELAY_MIN_MS. Use `vi.useFakeTimers()` and advance the clock to verify.
      - Test 4: After release with remaining='95' header, the next acquire is NOT delayed (immediate).
      - Test 5: After release with null header (missing), no throttle delay.
      - Test 6: After release with malformed header ('foo'), no throttle delay (Number.isNaN → null branch).
      - Test 7: `_resetForTest()` returns to clean state; subsequent 4 acquires resolve immediately even after a stuck pending queue.
      - Tests use `beforeEach(_resetForTest)` to avoid bleeding state across tests in the same process.

    Create `src/infrastructure/whoop/retry.ts`. Leading comment cites D-20 + Pattern 8 + A5.
      - Constants: `RATE_LIMIT_RESET_SLEEP_CAP_MS = 60_000` (A5 defense-in-depth), `RETRY_BUDGET = 1`, `EXP_BACKOFF_BASE_MS = 500`, `EXP_BACKOFF_MAX_MS = 5_000`.
      - `export interface RetryDeps { sleep?: (ms: number) => Promise<void>; jitter?: () => number; clock?: () => number; }` — DI seams for tests.
      - `function defaultSleep(ms: number): Promise<void> { return new Promise(r => setTimeout(r, ms)); }`
      - `function defaultJitter(): number { return Math.random(); }`
      - `export async function withRetry<T>(fn, deps?)`:
        - Resolve `sleep`, `jitter` from deps or defaults.
        - First attempt: `result = await fn()`. If `result.status < 400`, return result.
        - If `result.status === 429`:
          - Read `X-RateLimit-Reset` header (delta seconds per A5). Parse: `const resetSec = Number(result.headers.get('X-RateLimit-Reset') ?? '1'); if (Number.isNaN(resetSec) || resetSec <= 0) resetSec = 1;`
          - `const sleepMs = Math.min(resetSec * 1000 + jitter() * 250, RATE_LIMIT_RESET_SLEEP_CAP_MS);` — cap at 60s ceiling per A5.
          - `logger.warn({event: 'rate_limit_429', resetSeconds: resetSec, sleepMs})`.
          - `await sleep(sleepMs)`, then retry exactly once. If still 429 → return result (caller's WhoopApiError classifyHttpError handles).
        - If `result.status >= 500 && result.status < 600`:
          - `const sleepMs = Math.min(EXP_BACKOFF_BASE_MS + EXP_BACKOFF_BASE_MS * jitter(), EXP_BACKOFF_MAX_MS);`
          - `logger.warn({event: 'server_5xx_retry', status: result.status, sleepMs})`.
          - `await sleep(sleepMs)`, retry once. Return whatever the second call returns.
        - Else (4xx other than 429): return result immediately (don't retry; the caller's classifyHttpError will throw appropriate WhoopApiError).
      - Retry budget is 1 (D-20).
      - No console.*; structured Pino warns only.

    Create `src/infrastructure/whoop/retry.test.ts`:
      - Test 1: 200 response returns immediately; sleep not called.
      - Test 2: 429 with X-RateLimit-Reset=3 → sleep(~3000 + jitter cap 60_000), retried once. Verify via fake `sleep` spy on `deps.sleep`.
      - Test 3: 429 retried; second attempt also 429 → return result (no third attempt; budget=1).
      - Test 4: 429 with missing X-RateLimit-Reset header → defaults to 1s sleep.
      - Test 5: 429 with malformed X-RateLimit-Reset='abc' → defaults to 1s sleep.
      - Test 6: 429 with absurd X-RateLimit-Reset=999999 (header lies / WHOOP changes semantic) → sleep clamped to RATE_LIMIT_RESET_SLEEP_CAP_MS = 60_000. THIS IS LOAD-BEARING per A5.
      - Test 7: 500 response → sleep(EXP_BACKOFF_BASE_MS + jitter) then retry once. On second 500, return result (no third).
      - Test 8: 404 response → no retry, return immediately.
      - Test 9: jitter is deterministic via injected `jitter: () => 0.5` → asserts exact sleep value.

    Inject `sleep` and `jitter` in tests as a spy; no real timers.
  </action>
  <verify>
    <automated>npm run test -- src/infrastructure/whoop/rate-limit.test.ts src/infrastructure/whoop/retry.test.ts</automated>
  </verify>
  <acceptance_criteria>
    - `grep -c "SEMAPHORE_SIZE = 4" src/infrastructure/whoop/rate-limit.ts` returns 1
    - `grep -c "REMAINING_THROTTLE_THRESHOLD = 10" src/infrastructure/whoop/rate-limit.ts` returns 1
    - `grep -c "RATE_LIMIT_RESET_SLEEP_CAP_MS = 60_000\|RATE_LIMIT_RESET_SLEEP_CAP_MS = 60000" src/infrastructure/whoop/retry.ts` returns 1
    - `grep -c "X-RateLimit-Reset" src/infrastructure/whoop/retry.ts` returns at least 1
    - `npm run test -- src/infrastructure/whoop/rate-limit.test.ts src/infrastructure/whoop/retry.test.ts` shows ≥ 16 assertions passing (7 + 9)
    - Cap-at-60s test (Test 6 in retry.test.ts) passes
    - `grep -v '^\s*//' src/infrastructure/whoop/{rate-limit,retry}.ts | grep -v '^\s*\*' | grep -c "console\." ` returns 0
    - `bash scripts/ci-grep-gates.sh` exits 0 (Gate F still satisfied — no fetch( in rate-limit.ts or retry.ts)
  </acceptance_criteria>
  <done>Rate-limit semaphore-of-4 + remaining-throttle shipped; retry handles 429 with cap-at-60s + 5xx jittered backoff at budget=1; both utilities exercised by 16+ unit tests.</done>
</task>

<task type="auto">
  <name>Task 2: pagination.ts (with optional keyFn for compound keys) + httpGet client + classifyHttpError + their tests</name>
  <files>src/infrastructure/whoop/pagination.ts, src/infrastructure/whoop/pagination.test.ts, src/infrastructure/whoop/client.ts, src/infrastructure/whoop/client.test.ts, src/infrastructure/whoop/errors.ts</files>
  <read_first>
    - .planning/phases/03-data-model-db-layer-sync-loop/03-CONTEXT.md decisions D-17 (per-resource modules over shared httpGet), D-18 (callWithAuth wraps inside httpGet EXACTLY ONCE), D-19 (paginateAll owns snake↔camel + duplicate-ID assertion), D-21 (WHOOP_API_BASE pinned + GET-only), D-22 (WhoopApiError union for non-auth WHOOP errors)
    - .planning/phases/03-data-model-db-layer-sync-loop/03-RESEARCH.md §Pattern 7 lines 591-625 (paginateAll code), §Code Examples lines 821-858 (httpGet code verbatim), §Technical Research item 1 (no updated_since), item 4 (next_token snake/camel asymmetry), item 5 (verified headers)
    - .planning/phases/03-data-model-db-layer-sync-loop/03-PATTERNS.md §B1 lines 409-496 (client.ts pattern + token-endpoint POST analog), §B2 lines 499-535 (pagination.ts)
    - .planning/research/PITFALLS.md Pitfall 10 (pagination cursor confusion / dup-ID across pages), Pitfall 17 (token leakage through cause chain — handled by D-34 sanitize.ts UNMODIFIED + S3 pattern)
    - .planning/phases/03-data-model-db-layer-sync-loop/03-CONTEXT.md A12 (recoveries are keyed by compound (cycle_id, sleep_id) — they have NO single `id` field; paginateAll's default keyFn would crash on `String(undefined)`. The optional keyFn parameter exists specifically for this case.)
    - src/services/refresh-orchestrator.ts lines 39-90 (callWithAuth signature + retry policy)
    - src/infrastructure/whoop/oauth.ts lines 364-410 (exchangeCode — Zod-validated HTTP call pattern to mirror)
    - src/infrastructure/whoop/errors.ts (Wave 0 added WhoopApiError; this task adds classifyHttpError helper)
    - src/infrastructure/whoop/rate-limit.ts (Task 1 output — acquire/release contract)
    - src/infrastructure/whoop/retry.ts (Task 1 output — withRetry contract)
  </read_first>
  <action>
    Create `src/infrastructure/whoop/pagination.ts`. Leading comment cites D-19 + Pattern 7 + Pitfall 10 + A12 (compound-key support).
      - Imports: `import { WhoopApiError } from './errors.js'`. Nothing else.
      - Export `WhoopPage<T>` interface: `{records: T[]; next_token: string | null}` per A4 + verified WHOOP docs.
      - Export `paginateAll<T>(fetchPage: (nextToken: string | null) => Promise<WhoopPage<T>>, keyFn?: (row: T) => string): Promise<T[]>`:
        - `const resolveKey = keyFn ?? ((row: T) => String((row as { id?: unknown }).id));`
        - Note in the leading function doc: callers MUST pass an explicit `keyFn` when the row has no scalar `id` field (compound-PK resources). Default behavior covers cycles (int64 id → stringified), sleeps (UUID), workouts (UUID).
        - `const all: T[] = [], seenKeys = new Set<string>(); let nextToken: string | null = null;`
        - Do-while loop: `const page = await fetchPage(nextToken); for (const row of page.records) { const key = resolveKey(row); if (seenKeys.has(key)) throw new WhoopApiError({kind: 'validation', detail: 'duplicate key ' + key + ' across consecutive pages (signals mid-pagination reordering)'}); seenKeys.add(key); all.push(row); } nextToken = page.next_token; while (nextToken !== null);`
        - Return `all`. Loop terminates when `next_token` is null per WHOOP doc.

    Create `src/infrastructure/whoop/pagination.test.ts`:
      - Test 1: single-page (next_token=null first call) returns records as-is, no dup check fires (default keyFn on `id`).
      - Test 2: two pages (page 1 next_token='abc', page 2 next_token=null) merges records (default keyFn).
      - Test 3: three pages with unique IDs across all → final length is sum of records (default keyFn).
      - Test 4: page 2 contains an ID that appeared in page 1 → throws WhoopApiError, kind='validation', detail mentions 'duplicate key'. Lock the dup-key assertion (Pitfall 10).
      - Test 5: integer IDs (e.g., WHOOP cycle int64) are stringified for the Set key (default keyFn).
      - Test 6: UUID string IDs work (sleeps, workouts; default keyFn).
      - Test 7: empty first page (records=[], next_token=null) returns empty array (zero-result query).
      - Test 8 (compound-key keyFn, recovery shape — load-bearing for Plan 03-09 recovery resource module): paginateAll called with rows `[{cycle_id: 1, sleep_id: 'a'}, {cycle_id: 2, sleep_id: 'b'}]` on page 1 and `[{cycle_id: 3, sleep_id: 'c'}]` on page 2, with `keyFn = (row) => row.cycle_id + ':' + row.sleep_id` → all 3 rows returned, no error. Verify default keyFn would have failed (rows have no `id` field, so `String(undefined)` would collide on the second row).
      - Test 9 (compound-key dup detection): same setup as Test 8, but page 2 returns `[{cycle_id: 1, sleep_id: 'a'}]` (duplicate of page 1 row). paginateAll throws WhoopApiError({kind: 'validation'}), detail mentions key '1:a'. This is the recovery resource's dup-detection guarantee.

    Extend `src/infrastructure/whoop/errors.ts` (Wave 0 added WhoopApiError class; add the classifier here):
      - Add `export function classifyHttpError(res: { status: number; statusText?: string }): WhoopApiError`:
        - 401 → `new WhoopApiError({kind: 'unauthorized', detail: 'WHOOP returned 401 — token may have been revoked'})` — note: 401 normally never reaches here because callWithAuth retries on 401; a 401 escaping callWithAuth means refresh failed (already an AuthError({kind: 'auth_expired'})).
        - 429 → `new WhoopApiError({kind: 'rate_limited', detail: 'WHOOP rate-limited (429); sync retried once'})`.
        - 500-599 → `new WhoopApiError({kind: 'server', detail: 'WHOOP returned ' + res.status})`.
        - 400, 403, 404, 422 etc → `new WhoopApiError({kind: 'unknown', detail: 'WHOOP returned ' + res.status})`.
        - This is the SOLE place response-status → WhoopApiError mapping happens.

    Create `src/infrastructure/whoop/client.ts`. Leading comment cites D-17 + D-18 + D-21 + ADR-0001 + ADR-0007.
      - Imports:
        - `import { z } from 'zod'`
        - `import { callWithAuth } from '../../services/refresh-orchestrator.js'` (Plan 02-04 chokepoint — D-18 says "exactly once")
        - `import { logger } from '../config/logger.js'`
        - `import { acquire, release } from './rate-limit.js'`
        - `import { withRetry } from './retry.js'`
        - `import { classifyHttpError, WhoopApiError } from './errors.js'`
      - Export `WHOOP_API_BASE = 'https://api.prod.whoop.com'` (D-21 + ADR-0007).
      - Export `httpGet<T>(path: string, query, schema: z.ZodSchema<T>): Promise<T>`:
        - Build URL: `buildUrl(path, query)` helper at module scope — joins `WHOOP_API_BASE + path` and appends `URLSearchParams` from `query` (filtering out `undefined`/`null` values).
        - Acquire semaphore: `await acquire()`.
        - Inside try/finally: 
          - Wrap the fetch in `withRetry`: `const result = await withRetry(async () => { return await callWithAuth(async (accessToken) => { const response = await fetch(url, { method: 'GET', headers: { Authorization: 'Bearer ' + accessToken, Accept: 'application/json' } }); return { status: response.status, headers: response.headers, body: response }; }); });`
          - NOTE: `callWithAuth` returns the operation's return value; the operation returns `{status, headers, body}` per `withRetry`'s expected signature. `body` is the raw Response object so we can `.json()` after retry decides we're done.
          - If `result.status === 429` (retry exhausted): `release(result.headers.get('X-RateLimit-Remaining')); throw classifyHttpError(result);`
          - If `!result.body.ok`: `release(result.headers.get('X-RateLimit-Remaining')); throw classifyHttpError(result);`
          - Else: parse JSON + Zod validate: `const json = await result.body.json(); try { return schema.parse(json); } catch (zerr) { throw new WhoopApiError({kind: 'validation', detail: 'Zod parse failed on WHOOP response', cause: zerr}); }`
        - Finally: `release(remainingHeader)` — already invoked in success branch; the finally ONLY releases on the network-error path where withRetry threw. Track via try/catch pattern: cleaner to release inside the `try` once you have headers, and on exception path call `release(null)` to advance the semaphore without throttling info.
      - GET-only per ADR-0007 + D-21. Do NOT export POST/PUT/PATCH helpers. The token-endpoint POST stays in token-store.ts + oauth.ts only (Gate E preserved; Gate F satisfied because client.ts is the third allowlisted fetch site).
      - Module-leading doc-comment uses learnings phrasing to avoid Gate B / C / E plan-grep collisions (use "console calls" / "direct stdout writes" / "the OAuth refresh endpoint" rather than literal substrings).

    Create `src/infrastructure/whoop/client.test.ts`:
      - Use MSW inline (`import { http, HttpResponse } from 'msw'; import { setupServer } from 'msw/node';`). Plan 03-07 will land the per-resource helpers; here, declare inline handlers in beforeEach/afterEach.
      - Mock the token-store to provide a fixed `accessToken: 'test-token-123'` so callWithAuth proceeds without hitting the refresh path.
      - Test 1: GET succeeds with 200 + valid JSON → Zod parse succeeds → returns parsed object. Verify the request URL includes `WHOOP_API_BASE + path` and query params.
      - Test 2: Authorization header on the outgoing request is `'Bearer test-token-123'` (proves callWithAuth threading).
      - Test 3: Request method is GET (lock D-21 / ADR-0007).
      - Test 4: query param `nextToken: 'abc'` lands as `?nextToken=abc` in the URL (camelCase per A4 + verified docs).
      - Test 5: `undefined` and `null` query values are omitted from the URL (not serialized as `=undefined`).
      - Test 6: 401 response — callWithAuth handles internally; mock the token-store to refresh once and resolve with a fresh token; verify httpGet returns success.
      - Test 7: 429 response with X-RateLimit-Reset=2 → after withRetry sleeps, second response 200 → httpGet returns success. Mock `withRetry`'s sleep via DI seam or override the MSW handler after the first 429 to return 200.
      - Test 8: 500 response → after one retry still 500 → throws WhoopApiError({kind: 'server'}).
      - Test 9: 200 response with body that fails Zod parse → throws WhoopApiError({kind: 'validation'}).
      - Test 10: callWithAuth is invoked EXACTLY ONCE per httpGet call (Gate E + D-18 attestation at runtime). Spy on the imported callWithAuth (or use vi.mock partial).
      - Test 11: `fetch` is invoked at least once. (Smoke; the load-bearing assertion is the URL+method+headers above.)

    Notes for the runtime D-18 attestation (Test 10): grep can't prove "exactly once per call" — only the runtime test can. The CI grep gate (Gate E) proves only token-store.ts references oauth/oauth2/token; new Gate F proves client.ts is one of only 3 fetch sites. Test 10 proves the call-count semantic.

    All four files: NO default exports. NO console.*. Use `logger.warn({event: ...})` pattern only.
  </action>
  <verify>
    <automated>npm run test -- src/infrastructure/whoop/pagination.test.ts src/infrastructure/whoop/client.test.ts</automated>
  </verify>
  <acceptance_criteria>
    - `grep -c "import { callWithAuth }" src/infrastructure/whoop/client.ts` returns 1 (D-18 attestation: callWithAuth imported here and nowhere else in src/infrastructure/whoop/; verify the inverse with `grep -rEc 'callWithAuth' src/infrastructure/whoop/` returning the count of usages — client.ts owns all WHOOP-layer usage)
    - `grep -c "https://api.prod.whoop.com" src/infrastructure/whoop/client.ts` returns 1 (WHOOP_API_BASE pinned constant per ADR-0007)
    - `grep -c "fetch(" src/infrastructure/whoop/client.ts` returns 1 (Gate F: client.ts is the third file with one fetch call site)
    - `grep -c "method: 'POST'\|method: 'PUT'\|method: 'PATCH'\|method: 'DELETE'" src/infrastructure/whoop/client.ts` returns 0 (D-21 / ADR-0007 GET-only)
    - `grep -c "duplicate key" src/infrastructure/whoop/pagination.ts` returns 1 (Pitfall 10 + D-19 dup-detection lock; phrased as "duplicate key" to cover both `id` and compound-key callers)
    - `grep -cE "keyFn\?:" src/infrastructure/whoop/pagination.ts` returns at least 1 (optional keyFn parameter in the paginateAll signature — load-bearing for Plan 03-09 recovery resource module)
    - `grep -c "classifyHttpError" src/infrastructure/whoop/errors.ts` returns at least 2 (export + signature)
    - `grep -c "schema.parse" src/infrastructure/whoop/client.ts` returns 1 (Zod boundary validation)
    - `npm run test -- src/infrastructure/whoop/pagination.test.ts src/infrastructure/whoop/client.test.ts` shows ≥ 20 assertions passing (9 + 11)
    - pagination.test.ts Test 8 (compound-key keyFn happy path) AND Test 9 (compound-key dup detection) both pass — locks the recovery resource contract
    - `bash scripts/ci-grep-gates.sh` exits 0 — Gates E + F now both satisfied with real allowlisted files (client.ts is the third fetch site; token URL still only in token-store.ts)
    - `grep -v '^\s*//' src/infrastructure/whoop/{client,pagination}.ts | grep -v '^\s*\*' | grep -c "console\." ` returns 0
  </acceptance_criteria>
  <done>httpGet chokepoint shipped with single callWithAuth wrap (D-18), Gate F satisfied, Zod-validated boundary, paginateAll dup-key lock with optional keyFn (covers cycles/sleeps/workouts default + recoveries compound key); Pitfall 10 + ADR-0007 + ADR-0002 + Plan 02-06 Gate E all preserved at runtime.</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| WHOOP API response (untrusted) → Zod schema parse in httpGet | All bodies validated at the WHOOP boundary; passthrough() in schemas allows unknown fields without unsafe acceptance |
| Access token in Authorization header | Passed through callWithAuth (Plan 02-04) which is the SOLE consumer of tokenStore.getValidAccessToken (Plan 02-06 Gate E) |
| 401 response | Routed through callWithAuth's retry budget=1 logic; refresh failure surfaces as AuthError({kind: 'auth_expired'}) not WhoopApiError |
| Bearer token in error cause chains | Sanitized by D-34 src/mcp/sanitize.ts UNMODIFIED — Phase 1 patterns cover Bearer / JWT / Authorization shapes |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-03.06-01 | Information disclosure | Bearer token logged via Pino structured fields | mitigate | logger.warn payloads use {event, status, ...metadata} only — no token fields. Verified by Plan 03-11 integration test asserting `grep -E '(Bearer|access_token=)' <stderr-capture> === 0`. |
| T-03.06-02 | Tampering | A future helper calls fetch() outside client.ts/token-store.ts/oauth.ts | mitigate | Gate F (Wave 0 Plan 03-01) enforces at CI grep time. The chokepoint is the load-bearing pattern. |
| T-03.06-03 | Tampering | A future per-resource module calls callWithAuth directly, bypassing httpGet | mitigate | D-18 attestation: client.test.ts Test 10 asserts callWithAuth invoked once per httpGet; reviewer + plan-grep ensures no other src/infrastructure/whoop/* file imports callWithAuth. |
| T-03.06-04 | Denial of service | Promise.all(...) over 1000 pages saturates WHOOP rate limit | mitigate | rate-limit.ts semaphore-of-4 (D-20) is module-level — Promise.all over N pages of httpGet still gates to 4 concurrent. Pitfall 11 mitigation. |
| T-03.06-05 | Denial of service | Malicious 429 response with X-RateLimit-Reset=999999 causes runaway sleep | mitigate | retry.ts caps sleepMs at RATE_LIMIT_RESET_SLEEP_CAP_MS = 60_000 per A5 defense-in-depth. retry.test.ts Test 6 locks this. |
| T-03.06-06 | Tampering | WHOOP response with duplicate IDs across pages causes silent dup-then-overwrite | mitigate | pagination.ts asserts no-dup-key per Set<seenKeys>; throws WhoopApiError({kind: 'validation'}); optional keyFn covers both scalar-id resources (cycles/sleeps/workouts default) and compound-key resources (recoveries explicit keyFn). Pitfall 10 + D-19. |
| T-03.06-07 | Information disclosure | WhoopApiError.cause chain carries a Response object containing Bearer | mitigate | classifyHttpError accepts only {status, statusText} — Response not passed through. If an integration test ever does pass through, D-34 sanitize.ts catches at MCP boundary. |
</threat_model>

<verification>
- `npm run test -- src/infrastructure/whoop/` → all ≥ 36 new assertions green (7 + 9 + 9 + 11)
- `npm run lint` → 0 errors
- `bash scripts/ci-grep-gates.sh` → all 7 gates green (Gate F satisfied with client.ts as 3rd allowlisted fetch site; Gate E still green — no new oauth/oauth2/token strings outside token-store.ts)
- `npx tsc --noEmit` → 0 errors
- Runtime D-18 attestation: client.test.ts Test 10 asserts callWithAuth called exactly once per httpGet
- Compound-key contract: pagination.test.ts Test 8 + Test 9 pass; Plan 03-09 recovery resource module can call `paginateAll(fetcher, (r) => r.cycle_id + ':' + r.sleep_id)` without modifying pagination.ts
</verification>

<success_criteria>
- httpGet wraps callWithAuth exactly once per call (D-18 runtime attestation + D-17 single-chokepoint)
- WHOOP_API_BASE pinned to api.prod.whoop.com (ADR-0007 / D-21)
- GET-only — no POST/PUT/PATCH/DELETE exports
- paginateAll asserts no duplicate keys across consecutive pages (D-19 + Pitfall 10) — default keyFn covers scalar-id resources; optional keyFn supports compound-key recoveries
- rate-limit.ts: semaphore-of-4 + remaining<10 throttle (D-20)
- retry.ts: 429 honors X-RateLimit-Reset (delta seconds; cap 60s per A5) + 5xx jittered exp backoff at budget=1 (D-20 + Pitfall 11)
- classifyHttpError maps status → WhoopApiError kind in one place (D-22)
- Gate F satisfied: client.ts joins token-store.ts + oauth.ts as the 3 allowlisted fetch sites
- AuthError FROZEN at 6 kinds; WhoopApiError stays at 6 kinds; sibling unions in errors.ts
- ADR-0002 chokepoint preserved end-to-end: tokenStore.getValidAccessToken → callWithAuth → httpGet → resource module
</success_criteria>

<output>
Create `.planning/phases/03-data-model-db-layer-sync-loop/03-06-SUMMARY.md` when done.
</output>
