# v1.1 Pitfalls — Patching Defensive Code on a Working v1.0

**Scope:** Failure modes specific to landing fixes for issues #75–#95 without regressing the validated 50/50 v1.0 behavior.
**Researched:** 2026-05-31
**Overall confidence:** HIGH (every pitfall keyed to a specific issue + ADR or external source)

---

## ADR-collision risks

Defensive patches frequently brush the rule they are supposed to defend. These are the high-likelihood collisions.

### P1 — Sanitizer fix leaks to stdout (#79, ADR-0001)
**Failure mode:** #79 adds `sanitize(err.message)` inside `whoop-roundtrip.ts`. The CLI surface writes via `process.stdout.write(JSON.stringify(result))`. If the sanitizer is moved or imported from `src/infrastructure/observability/` (already flagged in #95 "transports import sanitize directly"), and the **MCP** code path picks up a path that ever calls `console.error` on the sanitized message, every connected MCP client breaks per ADR-0001. The probe itself is fine; the *refactor that consolidates sanitize* (#95 OAuth/logger hygiene bullet) is the risk.
**Prevention:** Keep `sanitize()` pure (no I/O). Add a Biome import-restriction rule that forbids `console.*` and `process.stdout.write` inside any file under `src/services/doctor/`. Cite ADR-0001 in the PR's "For Agents" section. **Phase:** with #79.

### P2 — Token-store refactor breaks single-flight (#87, ADR-0002)
**Failure mode:** The proposed fix for #87 (surface `refresh_failed` AuthError or write to a side-file) must remain *inside* `writeUnderLock`'s critical section. If the new error path is added *after* the lock is released, two processes can race the side-file. ADR-0002 §2 sets the `stale` timeout at 60s — any new code that holds the lock longer than `TOKEN_REQUEST_TIMEOUT_MS` (30s) re-introduces the family-revocation window flagged in #31.
**Prevention:** All new logic in `doRefresh` must execute inside `writeUnderLock`. Add a contract test asserting `proper-lockfile.lock()` is held for the entire window between `callRefreshEndpoint` resolving and the new error/recovery branch returning. Cite ADR-0002 in the PR. **Phase:** with #87 (highest stakes).

### P3 — DB CHECK constraints throw inside SCORED narrowing (#77, ADR-0003)
**Failure mode:** #77 adds `CHECK ((score_state='SCORED' AND strain IS NOT NULL) OR …)`. If the migration runs against a DB containing legacy rows where the mapper wrote `0` instead of `NULL` for a pending/unscorable row, the migration aborts mid-run and Drizzle's transactional DDL leaves the user in an unknown state. The ADR-0003 invariant is meant to be enforced at write-time, not retroactively destroy existing data.
**Prevention:** Migration must run a `SELECT COUNT(*) WHERE NOT (<check expression>)` pre-flight; if non-zero, log the offending row count and either (a) backfill `NULL`s via a forward migration step, or (b) abort with a clear "run `recovery-ledger doctor --fix` first" error. Never let the CHECK fire mid-migration. **Phase:** with #77.

### P4 — Test refactor accidentally calls live WHOOP (#83, #91, ADR-0006)
**Failure mode:** #83 adds a watchdog regression test; #91 adds an AbortSignal-plumbing test. Both touch the WHOOP HTTP client. If either test does **not** route through MSW (because the test imports `httpGet` after `setupServer` is torn down, or `vi.resetModules()` reorders the MSW handler registration), `fetch` reaches the wire. ADR-0006 mandates fixture-only by default.
**Prevention:** Every new test under `tests/integration/` must import MSW handlers and call `server.use()` in `beforeEach`. The `tests/setup/no-live-whoop.ts` setup file already asserts the env-var guard; extend it to also assert MSW is **active** at the start of each test file (poll `server.listHandlers().length > 0`). **Phase:** with #83 and #91.

### P5 — None of the v1.1 issues add WHOOP writes (ADR-0007)
**Failure mode:** No collision identified. #79's sanitizer fix and #87's refresh fix both stay within GET semantics. Listed here only so the planner can confirm.

### P6 — Banned tone words in new error messages (#88, #95 init.ts catch, ADR-0005)
**Failure mode:** #88 introduces `DecisionNotFound` error text; #95's init.ts catch wraps `String(err)`. Either could pick up coaching/emoji language inherited from copy-pasted patterns. Gate A regex (#95) already misses morphology ("crushed", "optimizing").
**Prevention:** Run `npm run lint` + the ci-grep-gates locally before commit. Use the L0005 substitution table when commenting near gates. **Phase:** with #88 and #95.

---

## Migration risks (#77)

**Failure mode A — CHECK rejects existing rows:** SQLite's `ALTER TABLE` with new CHECK constraints requires the constraint to hold against all existing rows. If even one v1.0 row violates it, the `CREATE TABLE … rename` rebuild aborts.
**Failure mode B — No rollback:** SQLite migrations are transactional, so a failed migration rolls back schema. But Drizzle Kit's metadata table (`__drizzle_migrations`) can be left inconsistent if the migration partially applied DDL across multiple statements.
**Prevention:**
1. Pre-flight `SELECT COUNT(*)` check inside the migration runner (`src/infrastructure/db/migrate.ts`) before applying #77's migration.
2. Backfill `NULL`s for pending/unscorable rows in a **separate prior migration** (data migration), so the CHECK migration only fires after data is clean.
3. Add a doctor probe that re-validates CHECK satisfiability after each migration completes.
4. Document the manual rollback (`sqlite3 db .backup; restore from .backup`) in the user-facing CHANGELOG.
**Phase:** with #77.

---

## Observable behavior changes (surprise to existing users)

### B1 — #80 ISO-date strictness
**Failure mode:** Tightening `parseSinceFlag` to `/^\d{4}-\d{2}-\d{2}…Z?$/` rejects every input Chris previously used: `"yesterday"`, `"03/01/2026"`, `"March 1"`. Validated v1.0 may have inadvertently accepted these in manual usage even if no test covered them.
**Prevention:** Add a friendly error: `"--since must be ISO 8601 (e.g. 2026-05-31 or 2026-05-31T00:00:00Z). Got: \"<raw>\". Did you mean YYYY-MM-DD?"`. Do **not** silently coerce — that re-introduces #80. **Phase:** with #80.

### B2 — #88 `updateOutcome` throws instead of no-op
**Failure mode:** Current behavior: missing id silently no-ops (caller verifies via `byId`). Proposed: throw `DecisionNotFound`. Any caller relying on the no-op semantics (none in v1.0, but a future MCP tool authored against v1.0 docs) now sees an unhandled exception.
**Prevention:** Return `{ changed: 0 | 1 }` per #88's suggested fix, **not** throw — the *service* layer throws, the *repo* returns the count. This preserves repo-as-data-layer semantics. Document the change in the CHANGELOG under "Breaking for direct repo callers". **Phase:** with #88.

### B3 — #91 AbortSignal cancels semaphore waiters
**Failure mode:** v1.0 semaphore waits forever; v1.1 honors AbortSignal. A long-running sync that previously completed (because slot-wait + fetch each completed within their own timers eventually) now aborts at the 30s mark with a less-friendly error. Also #95 bullet "abort-during-deferred-throttle leaks an inFlight decrement" must be fixed in the **same** patch or the new abort path leaks slots.
**Prevention:** Land #91 *and* the #95 inFlight-leak bullet together; their tests overlap. Error message: `"Aborted while waiting for rate-limit slot (held >30s)"` so the user knows what happened. **Phase:** with #91.

### B4 — #75 `aborted` status surfaces in cache queries
**Failure mode:** Once `'aborted'` flows through `SyncRunEntitySchema`, the MCP `whoop_query_cache` tool starts returning rows it previously dropped. A user filtering sync runs by status may see a step-change in row count.
**Prevention:** CHANGELOG entry + a doctor probe that counts aborted rows and surfaces "<N> sync runs were recovered from crashes". **Phase:** with #75.

---

## Test brittleness (regression tests for #77, #83, #87, #91)

### T1 — Fake-timers mis-used for watchdog test (#83)
**Failure mode:** Asserting a 30s watchdog fires correctly with `vi.useFakeTimers()` requires advancing both the watchdog timer **and** the child-process `'exit'` event microtask. Calling `vi.advanceTimersByTime(30_000)` alone leaves the SIGKILL fallback un-fired and the test flakes.
**Prevention:** Use `await vi.advanceTimersByTimeAsync(30_000)` (returns a Promise that drains microtasks). Add a *real-timer* smoke test as belt-and-suspenders that sleeps a stub worker for 35s and asserts fail within ~40s.

### T2 — Leaking better-sqlite3 handles (#77)
**Failure mode:** CHECK-constraint tests open an in-memory DB per test; if the test throws between `new Database(':memory:')` and `db.close()`, the handle leaks. better-sqlite3 holds native memory; vitest's per-fork pool eventually OOMs.
**Prevention:** Wrap every DB-opening test in `afterEach(() => db.close())` using a top-level `let db: Database`. Add an `--isolate=true` flag to the relevant vitest project so a leaked handle doesn't poison sibling tests.

### T3 — MSW handler drift for #87 atomicity test
**Failure mode:** The refresh-failure regression test mocks WHOOP returning rotated tokens and then forces `writeFileAtomic` to throw. If MSW is reset between the rotation response and the write-failure simulation, a retry can hit a *second* rotation response and burn the same token in the test.
**Prevention:** Use `server.use(http.post(...).intercept(once: true))` so the rotated-token response fires exactly once; any retry surfaces an explicit MSW miss rather than a phantom second rotation.

### T4 — AbortSignal listener leak in #91's test
**Failure mode:** The Node event-emitter `signal.addEventListener('abort', …)` registers a listener that `acquire()` is supposed to remove on resolve. If the test doesn't trigger the resolve path, the listener leaks and `MaxListenersExceededWarning` pollutes other tests. (This is exactly #95's "abort-during-deferred-throttle leaks an inFlight decrement" sibling.)
**Prevention:** Assert `signal.eventNames().length === 0` after each `acquire()` test. Combine #91 and the #95 leak fix in one PR.

---

## Refactor regressions (#84, #85, #92, #93)

Top 5 typical failure modes when refactoring imports/singletons in a working TypeScript system:

### R1 — Circular import surfaces at runtime, not compile time (#84, #92)
**Failure mode:** #84 inverts the `infrastructure → services` edge. If the new abstract type lives in `src/domain/`, both `client.ts` and `refresh-orchestrator.ts` must import from `domain/` only — but if either accidentally still imports a concrete singleton from `infrastructure/`, the cycle moves but doesn't disappear. ESM modules silently return `undefined` for the first-loaded side.
**Prevention:** Run `madge --circular src/` in CI. Land the type extraction (#84 option b) before the import flip.

### R2 — Dual import paths produce two class identities (#92)
**Failure mode:** Already documented in #92. After the codemod, a stale import in a test file (or in `dist/` from a partial rebuild) creates two `AuthError` classes; `instanceof` returns false; `isAuthError()` duck-type guard masks it; a control-flow branch that depends on the error kind silently takes the wrong path.
**Prevention:** Run `rg "from '.*infrastructure/whoop/errors'" src tests` after codemod and assert 0 matches for `AuthError|MigrationError`. Delete the re-exports in the same commit as the codemod, not later.

### R3 — Test-only imports leak into `dist/` (#85, #93)
**Failure mode:** `withBootstrap` helper (#93) and test-DI factories (#85) often import test utilities. If `tsup` includes them, MCP clients see test-only banners or the published binary pulls in vitest as a runtime dep.
**Prevention:** Keep all test-only code under `tests/`. Add a CI gate: `node -e "require('./dist/cli.js')" 2>&1 | grep -q vitest && exit 1`. Enforce `src/` cannot import from `tests/` via tsconfig `paths` + Biome.

### R4 — Tree-shaking breaks for singletons consumed via property access (#85)
**Failure mode:** Moving `tokenStore`/`refreshOrchestrator` into `bootstrap()` removes the module-load side effect that registered process-exit cleanup handlers. If signal handlers were attached during singleton construction, they no longer fire.
**Prevention:** Audit `process.on('SIGTERM' | 'SIGINT')` registrations during the singleton move. Re-attach in `bootstrap()` and document teardown in `app.dispose()`.

### R5 — DI factory parameters drift from singleton defaults (#85, #93)
**Failure mode:** `withBootstrap` (#93) accepts an options bag. If a caller forgets a field, the default falls back to the singleton — and tests pass because the singleton is fine, but production uses the wrong wired dependency.
**Prevention:** Make `withBootstrap` options *required* via TypeScript's `Required<T>` on the parameter type. No `?` optional fields on the public signature.

---

## Single-flight refresh atomicity (#87) — the highest-stakes bug

WebSearch findings (last 24 months):

- **Atomicity is non-negotiable:** "In accessing the data storage layer, issuing a new refresh token and invalidating the old refresh token should be atomic … concurrent requests that both load the token before either writes can lead to the same double-read/double-use problem" ([Serverion, 2026](https://www.serverion.com/uncategorized/refresh-token-rotation-best-practices-for-developers/)).
- **HTTP-response-fails-before-persist is the unsolvable case:** "When the HTTP response with the rotated token fails, the client has no way to recover other than to force the user to login again, since every rotation necessarily involves deleting or marking as consumed the used token … when the HTTP response fails, the network is unreliable" ([hhow09 blog, 2025](https://hhow09.github.io/blog/oauth2-refresh-token/)). #87's window (after response, before disk-write) is the *same* unsolvable shape: tokens are rotated server-side, we must either persist or re-auth.
- **Grace windows / overlap:** Some providers allow a short re-use window. WHOOP does **not** ([better-auth #8512, 2026](https://github.com/better-auth/better-auth/issues/8512); cited in ADR-0002).
- **Established pattern:** "Persist the newly-issued RT from each refresh response and discard the old one" and "always have a fallback to re-authentication when refresh tokens expire" ([Auth0 docs, 2025](https://auth0.com/docs/secure/tokens/refresh-tokens/refresh-token-rotation); [Okta dev, 2025](https://developer.okta.com/docs/guides/refresh-tokens/main/)).

**Recommendation for #87 (Option A from the issue):** Surface a distinct loud `AuthError({kind: 'refresh_failed', detail: 'rotated tokens received but write failed — run \`recovery-ledger auth\`'})`. The in-flight request returns the rotated access token (which works for ~1 hour). The next process invocation hits the explicit re-auth message rather than silently presenting the stale on-disk token. This matches the industry pattern: when persist fails, force re-auth; do not retry with the stale token.

Option B (side-file) is *not* recommended for v1.1 — it doubles the surface area of "where the canonical refresh token lives" and breaks the ADR-0002 single-source guarantee.

**Phase:** highest priority in v1.1; do this first so subsequent phases can rely on the explicit-re-auth signal.

---

## Concurrency pitfalls (#83, #91)

### C1 — Watchdog timer captures stale reference (#83)
**Failure mode:** `setTimeout(() => child.kill('SIGTERM'), 30_000)` closes over `child`. If the worker promise resolves before 30s, the timer still fires and SIGTERMs a now-dead pid (which may have been recycled in long-running tests).
**Prevention:** Clear the timer in the resolve/reject path; track `cleared` boolean inside the timer callback. In-repo precedent: `mcp-stdout-purity.ts:143-167`.

### C2 — SIGKILL fallback fires during slow CI (#83)
**Failure mode:** CI runners (especially GitHub Actions free tier) can pause a process for >2s during snapshot-mount or noisy-neighbor scheduling. The SIGKILL fallback then kills a worker that was about to exit cleanly, producing false-positive "fail" classifications.
**Prevention:** Make the SIGKILL delay configurable; default 5s in CI, 2s locally. Detect CI via `process.env.CI === 'true'`.

### C3 — AbortSignal listener accumulation in long-lived sessions (#91)
**Failure mode:** MCP server is long-lived. If `acquire(signal)` adds a listener and the signal never aborts (request completes normally), the listener must be removed in the resolve path — otherwise N requests accumulate N listeners on the same long-lived AbortController.
**Prevention:** Always pair `signal.addEventListener('abort', handler)` with `signal.removeEventListener('abort', handler)` in a `finally`. Use `AbortSignal.any([per-request, long-lived])` (Node 20+) so the per-request signal is GC-collectable.

### C4 — Cancellation lost across async-iterator boundary (#91)
**Failure mode:** Sync pagination uses async iteration. If the iterator yields between fetches, an abort signal that fires mid-yield may be observed *after* the next page request starts.
**Prevention:** Check `signal.aborted` at the **top** of each iteration, not only inside `fetch()`. Add a regression test that aborts mid-pagination and asserts the next page is never requested.

### C5 — DB lock held across await (#83)
**Failure mode:** Stress test forks 4 writers; if any acquires `BEGIN IMMEDIATE` then `await`s a network call before `COMMIT`, the lock is held for the network latency. Other workers see SQLITE_BUSY.
**Prevention:** Forbid `await` between `BEGIN IMMEDIATE` and `COMMIT`. Add a Biome rule (custom; or grep gate) inside `src/infrastructure/db/repositories/**`.

---

## Sources

- [Refresh Token Rotation: Best Practices for Developers — Serverion](https://www.serverion.com/uncategorized/refresh-token-rotation-best-practices-for-developers/)
- [OAuth 2.0 — Refresh Token and Rotation — hhow09 blog](https://hhow09.github.io/blog/oauth2-refresh-token/)
- [Refresh Token Rotation Grace Period — better-auth #8512](https://github.com/better-auth/better-auth/issues/8512)
- [Refresh Token Rotation — Auth0 Docs](https://auth0.com/docs/secure/tokens/refresh-tokens/refresh-token-rotation)
- [Refresh access tokens and rotate refresh tokens — Okta Developer](https://developer.okta.com/docs/guides/refresh-tokens/main/)
- [Refresh Token Security: Best Practices — Obsidian Security](https://www.obsidiansecurity.com/blog/refresh-token-security-best-practices)
- [How to Handle Token Refresh in OAuth2 — OneUptime, 2026](https://oneuptime.com/blog/post/2026-01-24-oauth2-token-refresh/view)
- ADR-0001 (`agent_docs/decisions/0001-mcp-stdout-purity.md`)
- ADR-0002 (`agent_docs/decisions/0002-single-flight-oauth-refresh.md`)
- ADR-0003 (`agent_docs/decisions/0003-score-state-discipline.md`)
- ADR-0006 (`agent_docs/decisions/0006-fixture-only-tests.md`)
- ADR-0007 (`agent_docs/decisions/0007-whoop-read-only.md`)
- Learnings: L0001 (MCP self-recursion), L0002 (cwd subprocess paths), L0005 (grep-gate phrasing)
