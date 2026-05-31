# Stack Research — Recovery Ledger v1.1 (quality hardening)

**Domain:** Subsequent milestone on a shipped v1.0 TS Node 22 CLI + MCP stdio server. Pure quality work, 21 GitHub issues (#75-#95). No user-facing features.
**Researched:** 2026-05-31
**Confidence:** HIGH on additions, HIGH on "use existing" verdicts.
**Verdict in one line:** v1.0's stack already has everything needed; **zero new runtime deps, zero replacements**. Two _existing_ APIs (Drizzle `check()`, Zod `z.iso.datetime/date`) cover the only headline issues that look like "library decisions."

---

## Recommended additions

### Runtime dependencies: NONE.

The 21 issues sort into the existing v1.0 stack with no new runtime packages. The fixes are code-level (composition root, sanitizer extension, sentinel-aware refresh, error class consolidation) and the few that touch the schema layer are covered by Drizzle features already on disk.

### Dev dependencies: NONE strictly required.

Optional: `fast-check@^3.23` for property-based testing of the sanitizer (#78, #79, #95). Already considered for v1.0 doctor tests; still optional. **Recommendation: defer.** A targeted matrix of token-shape fixtures in MSW is cheaper than learning a new test framework for one PR.

---

## Recommended replacements: NONE expected, NONE found.

No existing v1.0 pick is the wrong tool for any of the v1.1 fixes. Specifically verified:

- **`@napi-rs/keyring` + `proper-lockfile`** (ADR-0002 stack) remains correct for #87 (refresh-family crash recovery). The fix is a sentinel-write pattern (write `{pending_refresh: true, prev_refresh_token}` _before_ the HTTP call, reconcile on next start) — pure code change.
- **Pino + custom `sanitize.ts`** remains correct for #78/#79. Pino's built-in `redact` uses `fast-redact` paths (e.g. `*.token`, `*.accessToken`); we _already_ have a structured sanitizer and the gap is camelCase key coverage, not the tool. **Do not** swap to `pino-noir` (deprecated, last meaningful release 2018) or pull `fast-redact` directly — the existing module just needs additional key patterns. ([Pino redaction docs](https://github.com/pinojs/pino/blob/main/docs/redaction.md))
- **Commander** remains correct for #80, #93. The CLI shim duplication (#93) is a refactor (`withBootstrap(fn)` higher-order helper), not a framework change.
- **Drizzle + better-sqlite3** remains correct for #75, #77, #81. See "Use existing" below.
- **Vitest + MSW** remains correct for #83, #86, #95.

---

## Use existing — no change needed

Per-issue mapping. All confidence HIGH unless flagged.

### #77 — DB CHECK constraints for `score_state` (ADR-0003)
**Use:** Drizzle's `check()` helper, available in `drizzle-orm/sqlite-core` and stable since v0.34. Syntax verified on the current 0.45.x line:

```ts
import { check, sql } from 'drizzle-orm/sqlite-core';
// inside sqliteTable's 3rd-arg builder
(table) => [
  check('score_state_valid',
    sql`${table.score_state} IN ('SCORED','PENDING_SCORE','UNSCORABLE')`),
  check('score_state_scored_has_fields',
    sql`${table.score_state} != 'SCORED' OR (${table.recovery_score} IS NOT NULL AND ${table.hrv_rmssd_milli} IS NOT NULL)`),
]
```

Migration generated via `drizzle-kit generate` (already installed). No new dep. ([Drizzle indexes-constraints docs](https://orm.drizzle.team/docs/indexes-constraints))

### #75 — `'aborted'` enum drift
**Use:** Zod source-of-truth pattern already used elsewhere. Define the enum once in a shared `db/enums.ts`, derive both the Drizzle column (`text({ enum: SYNC_STATUS })`) and the Zod schema (`z.enum(SYNC_STATUS)`) from it. Pure refactor.

### #80 — `--since` non-ISO date parsing
**Use:** Zod **`z.iso.date()`** (v4, regex-validated, strict per [Zod v4 docs](https://zod.dev/api#iso-dates)). The current v1.0 stack pins `zod@^4.4.3` which has this. No `date-fns/parseISO` needed — Zod rejects locale-dependent strings before they reach business logic, then `parseISO` (already in v1.0) does the conversion on the now-validated input. **Two-line fix** in the Commander option's `argParser`.

### #76 — `byRange` JOIN gap
**Use:** Drizzle query builder (`leftJoin` + `where(isNull(...))`). Pure SQL fix.

### #78, #79 — Sanitizer camelCase + doctor unsanitized output
**Use:** Extend the existing `src/infrastructure/sanitize.ts`. Add patterns for `accessToken`, `refreshToken`, `clientSecret`, and any header `authorization`/`x-api-key`. Add a single `sanitizeError(err)` call site in `whoop_roundtrip` and the CLI doctor's catch blocks. **Add property test** with `fast-check`-style hand-rolled generator (no new dep) covering 50+ shapes.

### #81 — SQLite handle leak on migrate() throw
**Use:** Plain `try/finally` with `db.close()`. **Considered but rejected:** TS 5.2 `using` + `Symbol.dispose`. `better-sqlite3` does **not** ship a `[Symbol.dispose]` method (verified via repo — issue WiseLibs/better-sqlite3#580 still open). Bun's `bun:sqlite` does; better-sqlite3 does not. A `using` statement would silently no-op the close. Use the boring `try { … } finally { db.close() }`.

### #82 — `reclassifyStaleRunning` clock skew
**Use:** Existing `Clock` interface (already injected for testability). The injected `nowIso` is being ignored — pass-through fix.

### #83 — `concurrent_writers_stress` watchdog
**Use:** Native **`AbortSignal.timeout(ms)`** (Node 22 built-in, stable). **Do not** combine with `AbortSignal.any()` in tests — there's an open Node bug ([nodejs/node#57736](https://github.com/nodejs/node/issues/57736)) where `AbortSignal.any()` can fail to fire timeouts; for the watchdog we just need a single `AbortSignal.timeout(30_000)`. For #91 (rate-limit semaphore plumbing) the fix is propagating the signal we already have through `acquire()`, not combining signals.

### #84, #85 — Layer violation + module-load singletons
**Use:** Composition root pattern (`src/composition.ts`). Pure refactor — no DI container needed. Considered and rejected: `tsyringe`/`awilix` — overkill for a single-file boot.

### #87 — Refresh crash between WHOOP response and disk-write
**Use:** Existing `proper-lockfile` + atomic write + new sentinel column on `oauth_tokens`. Schema change via existing `drizzle-kit generate`. Logic-only fix layered on ADR-0002's three-layer refresh.

### #88, #89, #90, #92, #94 — silent no-ops / dual error paths / regex evadable / dual import / warn-only checkpoint
All **pure code changes** in existing modules. No deps.

### #91 — AbortSignal not propagated
**Use:** Existing `AbortSignal` already created in `fetchWithRetry`. Thread it through `RateLimitSemaphore.acquire(signal)`. Built-in.

### #93 — CLI command shim duplication
**Use:** Existing Commander. Extract a `withBootstrap<T>(fn: (deps: Deps) => Promise<T>)` helper in `src/cli/_bootstrap.ts`. ~30 lines once, deleted from 8 files. Pure refactor.

### #95 (tracker) — small defensive items
All triaged into the buckets above. Spot-check: none introduce a new external library.

---

## Verification notes

| Claim | Source | Confidence |
|---|---|---|
| Drizzle `check()` available on 0.45.x for SQLite | [Drizzle indexes-constraints](https://orm.drizzle.team/docs/indexes-constraints) | HIGH |
| Zod 4 `z.iso.date()` / `z.iso.datetime()` strict by default | [Zod v4 API docs](https://zod.dev/api) | HIGH |
| `AbortSignal.timeout` stable in Node 22 | [Node globals docs](https://nodejs.org/api/globals.html) | HIGH |
| `AbortSignal.any()` has open reliability bug | [nodejs/node#57736](https://github.com/nodejs/node/issues/57736) | HIGH — avoid in test harness |
| `better-sqlite3` Database lacks `Symbol.dispose` | [WiseLibs/better-sqlite3#580](https://github.com/WiseLibs/better-sqlite3/issues/580) (still open as of 2026-05) | HIGH — use try/finally |
| `proper-lockfile@4.1.2` still latest, still maintained pattern | [npm registry](https://www.npmjs.com/package/proper-lockfile) | HIGH — already on disk |
| Pino `redact` via `fast-redact` covers nested + wildcard paths | [Pino redaction docs](https://github.com/pinojs/pino/blob/main/docs/redaction.md) | HIGH — but our gap is in `sanitize.ts`, not Pino |
| `pino-noir` is dormant; do not adopt | npm last-publish ≫ 5y | HIGH |

**Net effect on `package.json`:** no `dependencies` change, no `devDependencies` change. Every v1.1 issue is reachable with the v1.0 stack as-pinned.

**Re-check trigger:** If during execution any phase planner finds itself reaching for a 3rd-party crypto/sanitizer/DI library, escalate — that's a signal the fix has scoped beyond "quality hardening" into "redesign" and should be flagged for milestone-level review, not silently adopted.
