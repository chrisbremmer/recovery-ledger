# Research Summary — Recovery Ledger v1.1 (Quality Hardening)

**Synthesized from:** STACK.md, FEATURES.md, ARCHITECTURE.md, PITFALLS.md (all under `.planning/research-v1.1/`)
**Date:** 2026-05-31
**Confidence:** HIGH across all four streams.

---

## 1. Verdict

v1.1 is a **fix-only milestone**: 21 open issues (#75–#95) layered on top of the shipped v1.0 stack, with **zero new runtime dependencies, zero new dev dependencies, and no user-facing features**. STACK.md confirms every fix is reachable with the v1.0 `package.json` as-pinned; FEATURES.md confirms every "feature" is a hardening of an existing surface, not a new one. The work consolidates into roughly **10 themed PRs** across 5–7 phases. Risk concentrates in two issues: **#87 (single-flight OAuth refresh atomicity** — the unsolvable "HTTP response succeeded, disk write failed" window) and **#77 (DB CHECK constraints on `score_state`** — a migration that can abort mid-flight against legacy rows whose mapper wrote `0` instead of `NULL`). Everything else is mechanical refactor, additive validation, or pure code change in modules that already exist.

---

## 2. Stack Additions

**Short answer: none.** No new dependencies; no replacements. STACK.md verified each issue against the v1.0 pin set.

**Two existing-API leverages:**

- **#77 — DB CHECK constraints:** use Drizzle's `check()` helper from `drizzle-orm/sqlite-core` (stable since v0.34, working on the pinned 0.45.x). Migration generated via the already-installed `drizzle-kit`.
- **#80 — `--since` non-ISO date parsing:** use **`z.iso.date()`** from the already-pinned `zod@^4.4.3` (regex-validated, strict per Zod v4 docs). Two-line fix in the Commander `argParser`.

**Two rejected candidates** (STACK.md cites the open upstream bugs):

- **TS 5.2 `using` + `Symbol.dispose` for #81:** rejected — `better-sqlite3` does **not** ship `[Symbol.dispose]` (WiseLibs/better-sqlite3#580 still open as of 2026-05). A `using` statement would silently no-op the close. Use boring `try/finally` + `db.close()`.
- **`AbortSignal.any()` for #83 + #91:** rejected — nodejs/node#57736 documents an open bug where `AbortSignal.any()` can fail to fire timeouts. Use the single `AbortSignal.timeout(ms)` primitive (Node 22 built-in) for the watchdog; thread the existing signal through `RateLimitSemaphore.acquire()` for #91.

**Re-check trigger:** any phase planner reaching for a third-party crypto, sanitizer, or DI library is a signal the fix has scoped beyond "hardening" into "redesign" — escalate at milestone level.

---

## 3. Feature Categories

The 21 issues sort into 7 categories (FEATURES.md §Quality-Feature Categories).

| # | Category | Issues | User-visible? | Dependency notes |
|---|----------|--------|---------------|------------------|
| 1 | **Secret hygiene** | #78, #79 + #95 init/token-store/Pino-fatal items | yes, in error paths only | independent of each other; must land **before** #87/#89 so harmonised auth messages don't leak tokens |
| 2 | **Data integrity at DB layer** | #75, #76, #77, #88, #94 + #95 (float quantize, indexes, DST) | yes (medians shift; aborted rows surface) | **#77 depends on #75** (CHECK must reference the corrected enum); #76 ↔ #95 includeExcluded are siblings; #88 independent |
| 3 | **Error-message coherence** | #87, #89 | yes (one condition → one remediation) | both depend on #78/#79 landing first |
| 4 | **Lifecycle / resource safety** | #81, #82, #83, #91 + #95 (rate-limit leaks, OAuth callback `.unref()`, Pino flush) | yes (no hangs; no false aborts after suspend/resume) | #82 depends on #75; #91 must ship **with** #95 inFlight-leak fix |
| 5 | **CLI input validation** | #80 + #95 `findByPrefix` min-length | yes — behavioural break for previously-accepted inputs | independent; needs CHANGELOG note |
| 6 | **Architectural hygiene** | #84, #85, #92, #93 + #95 placement items | invisible | **#85 → #84 → P6 → P5** (see §4) |
| 7 | **Test coverage hardening** | #86, #90 + #95 test items | invisible | #86 depends on #75; #90 independent |

---

## 4. Architecture Work — #84, #85, and #95 Placement Debates

ARCHITECTURE.md's **load-bearing build order is #85 before #84**, against the issue numbering. Rationale: fixing #85's `tokenStore` singleton first means `bootstrap()` already owns the orchestrator when #84's DI plumbing (`authedCall` parameter through resource factories) needs a place to land. Doing #84 first leaves `callWithAuth` as a module-load export that bootstrap doesn't own — you'd fix it twice.

**Suggested 6-step phase ordering** (from ARCHITECTURE.md §Recommended build order):

1. **P3 — move `sanitize` to `domain/`** (~1 hr). Pure mechanical `git mv` + ~20 import rewrites. Ratchets the layering rule; transports stop reaching into `infrastructure/`.
2. **#85 — drop `tokenStore` + `refreshOrchestrator` singletons** (~2–3 hrs). `bootstrap()` constructs both from injected `tokenStore` default. Keep `logger`, `paths`, `rate-limit` module state (justified exceptions in S3/S4/S5).
3. **#84 — invert `client.ts` via `authedCall` DI** (~2 hrs). Resource modules become factories; `bootstrap.ts:261-270` wires them. Tests get a simpler fake (`(op) => op('test-token')`).
4. **P6 — extract doctor production wiring from bootstrap** (~1 hr). Move `productionWhoopFetcher`, `whoopErrorKindToStatus`, and `services_runDoctor` out of `bootstrap.ts:320-392` into `src/services/doctor/wiring.ts`.
5. **P5 — standardize doctor-check DI** (~1 hr). Drop `deps?.read ?? (() => tokenStore.read())` fallbacks; required deps only. Cleaner *after* #85 (no `tokenStore` to fall back to).
6. **P4 — inline `services/api-gap/`** (~15 min). Collapse 3 files + directory into one `src/services/api-gap.ts`.

P2 (barrel/factory split) is **deferable** — cosmetic, low value.

**ADR impact:** ADR-0002 §Enforcement gains one sentence ("production code constructs `tokenStore` exactly once via `bootstrap()`; module-load singletons forbidden"). No other ADR is broken.

---

## 5. Pitfall Headlines (Top 5)

Selected from PITFALLS.md, each keyed to specific issues:

1. **#87 — force re-auth, do NOT retry with stale token.** The HTTP-response-succeeded-but-disk-write-failed window is industry-unsolvable; the right answer is a loud `AuthError({kind:'refresh_failed'})` and a re-auth prompt. Option B (side-file) doubles the canonical-token surface — **rejected**.
2. **#77 — CHECK migration aborts on legacy rows.** Any v1.0 row with `0` instead of `NULL` for a pending/unscorable score will fail the new CHECK mid-migration. **Required prevention:** pre-flight `SELECT COUNT(*) WHERE NOT (<check>)`; if non-zero, backfill `NULL`s in a separate prior data migration before the CHECK migration fires.
3. **#91 + #95 inFlight-leak must ship together.** v1.1 honours AbortSignal in `acquire()` (#91), but #95's "abort-during-deferred-throttle leaks an inFlight decrement" is the sibling fix. Landing #91 alone creates a slot leak under the new abort path. One PR, overlapping tests.
4. **#75 — ESM circular import on the `aborted` enum dedup.** Defining the enum once in `db/enums.ts` and importing from both Drizzle column and Zod schema risks a cycle ESM resolves to `undefined` at runtime, not compile time. **Required prevention:** run `madge --circular src/` in CI; land the type extraction before the import flip.
5. **#83 — CI-aware watchdog or false-positive failures.** Free-tier GitHub Actions can pause a process >2s during snapshot-mount; the SIGKILL fallback then kills a worker about to exit cleanly. Make the SIGKILL delay env-aware: 5s in CI (`process.env.CI`), 2s locally. Use `await vi.advanceTimersByTimeAsync()` not the sync variant.

---

## 6. Phase Ordering — Consolidated Recommendation

Reconciling FEATURES.md's tier list with PITFALLS.md's risk ordering. One HIGH per phase where possible; MEDIUMs grouped by co-location; the refactor cluster is one phase.

1. **Phase 6 — Secret hygiene + input validation.** #78, #79, #80, plus #95 init/token-store/Pino-fatal items. Low risk, unblocks Phase 9's error-message rewrite. No DB or auth surface touched.
2. **Phase 7 — DB integrity gate.** #75 (enum dedup, ship first with `madge` gate), then #77 (CHECK + pre-flight data migration), then #76 (JOIN gap + #95 includeExcluded sibling), then #88 (returns `{changed: 0|1}`; service throws, not repo) and #94 (WAL flag escalation). Highest correctness surface in the milestone.
3. **Phase 8 — Refresh atomicity.** **#87 alone.** Highest-stakes bug; ADR-0002 §Enforcement update; all new logic inside `writeUnderLock`; lock-window contract test. Must follow Phase 6 so the new error message is sanitized; must follow Phase 7 so `aborted` rows already flow correctly.
4. **Phase 9 — Lifecycle + concurrency.** #81 (try/finally), #82 (Clock injection wired), #83 (watchdog with CI-aware SIGKILL), #91 + #95 inFlight-leak (paired). #89 (auth message coherence) lands here too — depends on #87's new error shape.
5. **Phase 10 — Architecture refactor cluster.** Single phase, six PRs in build order: P3 sanitize-move → #85 singletons → #84 DI invert → P6 doctor wiring extract → P5 doctor DI standardize → P4 api-gap inline. #92 (single import path for `AuthError`/`MigrationError`) and #93 (`withBootstrap` helper) fold in here because the codemod hits the same 8 CLI files.
6. **Phase 11 — Regression net.** #86 (`latestFinished()` aborted-skip + native-module tests) and #90 (Biome `noRestrictedGlobals` for `fetch` alias bypass). Final phase because #86 depends on #75 having landed (typed repo must accept `aborted`).
7. **Phase 12 (optional) — #95 backlog drain.** Opportunistic batching of any #95 items not folded into Phases 6–11: float quantize, decisions/sync_runs indexes, FDR↔weekly-review integration test, DST fixture hard-coded ids, stopwatch env-gate guard.

Note: phase numbers continue from v1.0 (which ended at Phase 5).

---

## 7. Phase-Planner Watch-Outs (Top 5)

Paste-ready callouts for discuss-phase briefs:

1. **#87's lock window is non-negotiable.** All new logic in `doRefresh` must execute inside `writeUnderLock`. Add a contract test asserting `proper-lockfile.lock()` is held continuously from `callRefreshEndpoint` resolution through the new error/recovery branch. Any code that holds the lock longer than 30s re-introduces the family-revocation window from #31.
2. **#77's migration must pre-flight, never CHECK-abort.** Two-step migration: (1) data backfill of `NULL`s for pending/unscorable rows, (2) CHECK constraint added. Add a post-migration doctor probe that re-validates CHECK satisfiability. Document the manual rollback (`sqlite3 .backup`) in the user CHANGELOG.
3. **#75 → #77 → #82 → #86 is a hard chain.** The `aborted` enum dedup must land first, with `madge --circular src/` gating in CI. #77's CHECK references the corrected enum. #82's reclassify tests insert `aborted` rows through the typed repo. #86's `latestFinished()` test does the same. Skip the chain order at your peril.
4. **#80 is a user-visible breaking change.** `--since 03/01/2026` and `--since yesterday` will now reject with a clear error. Surface this in the v1.1 release notes; do **not** silently coerce (re-introduces the bug).
5. **#92 codemod risk: dual class identity.** After dropping the `infrastructure/whoop/errors` re-exports for `AuthError`/`MigrationError`, run `rg "from '.*infrastructure/whoop/errors'" src tests` and assert zero matches in the same commit. ESM + partial-rebuild `dist/` can otherwise produce two class identities; `instanceof` returns false; control flow silently mis-routes.

---

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | Every "use existing" verdict cross-checked against upstream docs. Open bugs cited for both rejections. |
| Features | HIGH | All 21 issues retrieved 2026-05-31 and classified with user-impact notes. Dependency graph explicit. |
| Architecture | HIGH on #84/#85; MEDIUM on #95 placement debates. |
| Pitfalls | HIGH | Each pitfall keyed to issue + ADR + external source. |

**Gaps:** none flagged that block planning. The only judgement call is whether to fold #92/#93 into the architecture phase (recommended) or split them — purely a PR-sizing decision.

---

## Sources

- GitHub issues #75–#95 (retrieved 2026-05-31)
- `.planning/PROJECT.md`, `.planning/REQUIREMENTS.md`, `.planning/research/ARCHITECTURE.md`, `agent_docs/conventions.md`
- ADRs 0001–0007 (`agent_docs/decisions/`)
- Drizzle indexes-constraints docs; Zod v4 API; Node globals; Pino redaction
- WiseLibs/better-sqlite3#580 (no `Symbol.dispose`); nodejs/node#57736 (`AbortSignal.any` bug)
- Industry sources on refresh-token rotation atomicity (Serverion 2026, hhow09 2025, Auth0, Okta, Obsidian Security)
- Learnings L0001, L0002, L0005
