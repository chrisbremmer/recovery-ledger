# Requirements: Recovery Ledger

**Defined:** 2026-05-11
**Core Value:** Turn WHOOP data into a daily and weekly review loop that ends in 3 concrete decisions and a record of whether they helped — useful enough that Chris keeps using it.

## v1 Requirements

Requirements for the initial release. Each maps to roadmap phases.

### Foundation

- [x] **FND-01**: Bootstrapped TypeScript repo (Node 22 LTS, ESM, tsup build, tsx dev) with Biome lint/format and Vitest test runner configured
- [x] **FND-02**: Empty CLI entry point (`recovery-ledger`) registered via `bin` and runnable via `npx recovery-ledger`
- [x] **FND-03**: Empty MCP stdio server entry point (`recovery-ledger-mcp`) using `@modelcontextprotocol/sdk` and stdio transport
- [x] **FND-04**: Pino logger configured to write exclusively to stderr (never stdout) with a CI-enforced assertion that the MCP server's stdout contains only valid JSON-RPC frames under fixture load
- [x] **FND-05**: Lint rule banning bare `console.*` outside `src/cli/` and CI gate that fails on stdout pollution
- [x] **FND-06**: MCP error-sanitizer contract that strips `Authorization` headers and JWT-shaped strings from any error surfaced to a tool result
- [x] **FND-07**: Native-module load verification (`better-sqlite3`, `@napi-rs/keyring`) reported by a stub `doctor` command

### Authentication

- [x] **AUTH-01**: BYO WHOOP developer credentials configured via `recovery-ledger init` with dynamic loopback-port OAuth callback
- [x] **AUTH-02**: `recovery-ledger auth` initiates OAuth Authorization Code flow, opens browser, exchanges code for tokens, and reports success
- [x] **AUTH-03**: OAuth tokens stored at rest via `@napi-rs/keyring` with `chmod 600` file fallback when keychain is unavailable, surfaced clearly by `doctor`
- [x] **AUTH-04**: Token-refresh wrapper transparently refreshes expired access tokens and retries the originating request on 401
- [x] **AUTH-05**: Single-flight refresh: in-process module-level `Promise<Tokens> | null` plus cross-process file advisory lock plus atomic temp-file-and-rename token write — concurrent CLI + MCP refresh never burns the refresh-token family
- [x] **AUTH-06**: Token-leak prevention: error messages and MCP tool error returns never expose token material (covered by FND-06)

### Data Model & DB

- [x] **DATA-01**: SQLite database opens in WAL mode with `busy_timeout=5000`, `journal_size_limit=64MB`, `wal_autocheckpoint=1000` pragmas at default `~/.recovery-ledger/recovery-ledger.sqlite`
- [x] **DATA-02**: Drizzle schema for `oauth_tokens`, `sync_runs`, `cycles`, `recoveries`, `sleeps`, `workouts`, `daily_summaries`, `decisions` with hybrid normalized columns + `raw_json` per entity
- [x] **DATA-03**: Index on `(score_state, start)` on each scored entity to support the SCORED-only baseline queries
- [x] **DATA-04**: Drizzle migrator runs at every connection inside `BEGIN IMMEDIATE`, takes a pre-migration backup of `.sqlite`/`-wal`/`-shm`, and fails closed on partial migration
- [x] **DATA-05**: Three-layer types — raw WHOOP responses (Zod), normalized entities (Drizzle), and view types for review outputs — with `Score = discriminatedUnion('score_state', …)` enforcing `SCORED` discipline in domain code
- [x] **DATA-06**: DST / time-zone-shift detection during sync flags affected cycles for baseline exclusion while keeping them visible in raw views

### Sync

- [x] **SYNC-01**: `recovery-ledger sync --days N` (default 30) fetches profile, body measurements, cycles, recovery, sleep, and workouts for the requested window
- [x] **SYNC-02**: WHOOP HTTP client honors pagination, normalizes snake_case → camelCase, and enforces a semaphore-of-4 concurrent-request limit
- [x] **SYNC-03**: 429 responses back off honoring `Retry-After` / `X-RateLimit-Reset`; rate-limit state is reported on the CLI
- [x] **SYNC-04**: Sync is idempotent via `ON CONFLICT DO UPDATE`; deltas use `updated_at` with a 7-day re-window to catch late-scored cycles
- [x] **SYNC-05**: Partial-failure reporting — sync exit reports which resources succeeded, failed, or were skipped, recorded in a `sync_runs` row
- [x] **SYNC-06**: Sync issues a `wal_checkpoint(TRUNCATE)` at the end of a successful run
- [x] **SYNC-07**: Fixture-based contract tests cover every WHOOP resource (cycles, recovery, sleep, workouts, profile, body measurements); no live API calls in the default test run

### Review

- [x] **REV-01**: Baseline calculator computes trailing-30-day weighted baselines for HRV (median + MAD), RHR (median + MAD), sleep duration, sleep efficiency, day strain, and respiratory rate from `SCORED` entities only, excluding DST/tz-flagged cycles
- [x] **REV-02**: Confidence-tier gating — `insufficient` when < 10 SCORED days, `weak` ≥ 10, `strong` ≥ 20 with ≥ 70% baseline-window coverage; Z-score refused when < 14 days available
- [x] **REV-03**: `recovery-ledger review daily` returns the documented daily-review schema (data_status, today_state, anomalies, patterns, actions ≤ 3) with text-fallback rendering
- [x] **REV-04**: Daily review surfaces data freshness (latest sync, baseline window, missing/stale resources) at the top of every brief
- [x] **REV-05**: When data is insufficient, the daily review states what is missing and declines to make confident recommendations
- [x] **REV-06**: `recovery-ledger review weekly` identifies the lowest-recovery days of the week and runs pattern checks on preceding sleep duration / sleep debt / strain / workout timing / HRV delta / RHR delta / respiratory-rate anomaly
- [x] **REV-07**: Weekly review applies Benjamini-Hochberg FDR correction at q = 0.10 across ≤ 5 pre-registered candidate factors and returns "no reliable pattern detected" as a typed positive output when nothing crosses threshold
- [x] **REV-08**: Review output tone passes a banned-word CI lint (no coach-y / hype / moralizing language) and renders actions as verb-first single sentences

### Decision Ledger

- [x] **DEC-01**: `recovery-ledger decision add` accepts category, decision, rationale, confidence, expected effect, and follow-up date (ULID id, smart defaults for date and follow-up window) with a one-line happy path
- [x] **DEC-02**: Decisions persist with `status` (open / followed_up / abandoned) and `outcome_notes`
- [x] **DEC-03**: `recovery-ledger decision review` lists open decisions with elapsed time vs. expected effect window and prompts for outcome capture
- [x] **DEC-04**: Weekly review prompts for at least one new decision when none has been recorded in the prior week

### MCP Surface

- [x] **MCP-01**: MCP server exposes tools `whoop_sync`, `whoop_daily_review`, `whoop_weekly_review`, `whoop_query_cache` (typed per-resource filters, not free-form SQL), `whoop_add_decision`, `whoop_review_decisions`, `whoop_api_gap`, `whoop_doctor`
- [x] **MCP-02**: Every tool returns structured JSON (`structuredContent`) plus compact text (`content`) so weaker clients still work
- [x] **MCP-03**: All MCP tools are ≤ 5-line shims over services — zero business logic in `src/mcp/`; identical behavior to the CLI equivalents
- [x] **MCP-04**: MCP resources `whoop://summary/today`, `whoop://summary/week`, `whoop://baseline/30d`, `whoop://data-quality`, `whoop://api-gaps`, `whoop://decisions/open` are exposed and refresh from the cache
- [x] **MCP-05**: MCP prompts `whoop_daily_decision_brief`, `whoop_weekly_recovery_investigation`, `whoop_experiment_designer`, `whoop_deload_or_train` are registered with documented inputs
- [x] **MCP-06**: MCP tool error returns are sanitized via the FND-06 contract — no token material, no internal stack traces

### Diagnostics & Setup

- [x] **DOC-01**: `recovery-ledger doctor` checks: auth state, token freshness + WHOOP roundtrip, DB integrity + schema version + WAL file size, last-sync recency + most-recent SCORED day, MCP transport stdout-purity self-test, data-quality counts, native-module load, concurrent-writers stress
- [x] **DOC-02**: Doctor emits structured exit codes that map to documented troubleshooting steps
- [x] **DOC-03**: API-gap documentation lists every WHOOP consumer-app feature not available via the public API (Healthspan, ECG, BP, journal, continuous HR, etc.) with a clear "unavailable via API" explanation surfaced through `whoop_api_gap`
- [x] **DOC-04**: Install guide includes per-client sections for Claude Code, Claude Desktop, and Cursor; WHOOP developer-app setup checklist; and a troubleshooting map keyed to doctor exit codes
- [x] **DOC-05**: launchd `.plist` template for macOS is shipped as documentation (not auto-installed) for users who want a scheduled local sync
- [x] **DOC-06**: Clean-clone-to-first-daily-review measured at < 20 minutes on a fresh macOS image, asserted by a CI stopwatch test

## v1.1 Requirements

Quality-hardening milestone surfaced by the post-v1.0 `/ce-code-review` deep-review pass. Each requirement maps to one or more GitHub issues (#75–#95). NO new user-facing features — pure defensive correctness. Source research: `.planning/research-v1.1/SUMMARY.md`.

### Secret hygiene

- [ ] **SECH-01**: Token sanitizer covers camelCase keys (`accessToken`, `refreshToken`, `clientSecret`, `clientId`, `idToken`) in addition to snake_case — every sanitized record path is property-test-covered (#78)
- [ ] **SECH-02**: `whoop_roundtrip` doctor probe sanitizes raw error messages on every code path; the CLI doctor's outer catch wraps `sanitize()` consistently with `auth.ts`/`sync.ts` (#79, plus #95 init.ts outer-catch + Pino-fatal sanitize)

### Data integrity at the DB layer

- [ ] **DBIN-01**: `'aborted'` sync-run status defined ONCE in a single source-of-truth module; Zod entity schema, Drizzle column type, and `QueryCache` input share that definition with `madge --circular src/` CI gate (#75)
- [ ] **DBIN-02**: `sleeps.byRange` and `workouts.byRange` inherit `baseline_excluded` via FK JOIN on `cycle_id`; opt-in `includeExcluded` flag preserves opt-out path (#76, plus #95 recovery.byRange JOIN sibling)
- [ ] **DBIN-03**: SQLite CHECK constraints on `cycles`/`recoveries`/`sleeps`/`workouts` enforce the `score_state` discriminated union (PENDING_SCORE ⇒ score columns NULL; UNSCORABLE ⇒ score columns NULL; SCORED ⇒ score columns NOT NULL); migration is two-step (data-cleanup backfill, then CHECK add) with pre-flight count assertion (#77, ADR-0003)
- [ ] **DBIN-04**: `decisions.updateOutcome` returns `{changed: 0 | 1}`; service layer throws on `changed === 0` so silently-discarded outcomes are impossible (#88)
- [ ] **DBIN-05**: `wal_checkpoint(TRUNCATE)` failures during sync are escalated — added to the partial-failure manifest in `sync_runs` and surfaced by `doctor` (#94)

### Error-message coherence

- [ ] **ERRC-01**: `whoop_roundtrip` produces ONE user-facing message per failure condition — `AuthError` and `WhoopApiError({status:401})` for the "token dead" case route through a shared classification so the CLI doctor and MCP probe say the same thing (#89)
- [ ] **ERRC-02**: Refresh-orchestrator crashes between WHOOP refresh-response and disk-write surface a typed `AuthError({kind:'refresh_failed'})` that triggers a re-auth prompt — no silent retry with stale tokens; ADR-0002 §Enforcement updated to make this rule explicit (#87)

### Lifecycle / resource safety

- [ ] **LIFE-01**: Bootstrap pairs `openDb()` with `try/finally db.close()` so a `migrate()` throw never leaks the SQLite handle; covered by a unit test that forces `migrate()` to throw and asserts no leftover wal/shm handles (#81)
- [ ] **LIFE-02**: `reclassifyStaleRunning` uses the injected `nowIso` (Clock) on every code path; clock-skew tests assert in-flight syncs are not falsely flipped to `aborted` (#82)
- [ ] **LIFE-03**: `concurrent_writers_stress` doctor probe has an `AbortSignal.timeout(30_000)` watchdog with CI-aware SIGKILL fallback (5s in `process.env.CI`, 2s local); regression test exercises the watchdog path (#83)
- [ ] **LIFE-04**: `RateLimitSemaphore.acquire()` accepts an `AbortSignal` and rejects in-flight slot waits with `AbortError`; the abort-during-deferred-throttle inFlight-leak (tracker #95) is fixed in the same PR via a `granted` boolean gate on the listener (#91 + #95 rate-limit semaphore leak)

### CLI input validation

- [ ] **INPV-01**: `--since` flag accepts only ISO-8601 (`YYYY-MM-DD`) dates via `z.iso.date()` — rejects locale-dependent inputs (`03/01/2026`, `yesterday`) with a clear error pointing at the supported format; CHANGELOG notes this as the only v1.1 user-visible breaking change (#80)

### Architectural hygiene

- [ ] **ARCH-01**: `sanitize` and `serializeError` live under `src/domain/observability/` (pure string transforms; no I/O) — transports stop importing from `infrastructure/observability/` (#95 sanitize placement)
- [ ] **ARCH-02**: Module-load singletons (`tokenStore` in `token-store.ts:496`, `refreshOrchestrator`/`callWithAuth` in `refresh-orchestrator.ts:131,140`) are removed; `bootstrap()` constructs each exactly once and threads them via DI; `logger`/`paths`/`rate-limit` retain module state with justification comments (#85, ADR-0002 §Enforcement update)
- [ ] **ARCH-03**: `src/infrastructure/whoop/client.ts` no longer imports from `src/services/`; `authedCall` is injected at `httpGet`'s signature; resource modules become factories wired in `bootstrap.ts:261-270` (#84)
- [ ] **ARCH-04**: `AuthError` and `MigrationError` have a single canonical import path — `infrastructure/whoop/errors` re-exports removed; codemod assertion `rg "from '.*infrastructure/whoop/errors'" src tests` returns zero (#92)
- [ ] **ARCH-05**: CLI command shims share one `withBootstrap(handler)` helper (in `src/cli/run.ts` or `src/cli/lib/`); ~30 lines of duplicated bootstrap-error handling × 8 files collapsed to a single source (#93)
- [ ] **ARCH-06**: Doctor production wiring (`productionWhoopFetcher`, `whoopErrorKindToStatus`, `services_runDoctor`) extracted from `bootstrap.ts:320-392` into `src/services/doctor/wiring.ts`; bootstrap stays under 250 lines (#95 doctor-wiring extract)
- [ ] **ARCH-07**: Doctor checks use required-deps DI matching the non-doctor services; `deps?.read ?? (() => tokenStore.read())` fallbacks removed (#95 doctor-DI ad-hoc)
- [ ] **ARCH-08**: `src/services/api-gap/` collapsed into a single `src/services/api-gap.ts`; `API_GAP_ENTRIES` promoted to `src/domain/api-gap/catalog.ts` (#95 api-gap over-structured)

### Test coverage hardening

- [ ] **TSTC-01**: Doctor `latestFinished()` aborted-skip regression test + `native_modules` failure-path test land; covers Phase 5 gaps (#86)
- [ ] **TSTC-02**: Gate F (`/scripts/ci-grep-gates.sh`) regex hardened against alias bypasses — `noRestrictedGlobals` Biome rule on `fetch` re-export aliases plus stronger pattern coverage prevents ADR-0007 enforcement evasion (#90)
- [ ] **TSTC-03**: #95 backlog test items folded in as scope allows: FDR↔weekly-review fixture integration; DST fixture hard-coded ids; stopwatch env-gate polarity guard; auth-concurrency I-01 typed assertion; concurrent_writers_stress detail regex; doctor/index integration detail regex; body_measurements concurrent-readers test; refresh-orchestrator behavioral assertions (#95 testing bucket)

### Backlog drain

- [ ] **BACK-01**: Remaining tracker #95 items NOT folded into the above (decisions/sync_runs indexes; decisions.findByPrefix min-length guard; body_measurements float tolerance; cycles.cursor() score-state-aware comment; token-store mkdir 0o700; OAuth callback `.unref()`; Pino flush on signals + start-of-sync) — landed as a final quality-sweep PR (#95 residual)

## v2 Requirements

Deferred to future release. Acknowledged but not in current roadmap.

### Reach

- **V2-01**: Cursor compatibility matrix beyond v1's basic install guide
- **V2-02**: Email brief generation as a local script
- **V2-03**: Scheduled local runner template for non-macOS platforms (systemd user timers)

### Analytics & UX

- **V2-04**: Export to CSV / JSONL / Parquet
- **V2-05**: Configurable baseline window beyond the default 30 days
- **V2-06**: Week-over-week trend comparison
- **V2-07**: Per-day notes attached to cycles
- **V2-08**: Decision tags and named experiments
- **V2-09**: Prompt pack for travel, alcohol, caffeine, deload, illness suspicion, race week
- **V2-10**: Tunable confidence thresholds and FDR q-value via config

## Out of Scope

Explicitly excluded. Gated behind the hard scope guardrail in PROJECT.md (≥ 12 daily reviews, ≥ 3 weekly reviews, ≥ 8 decisions, stable tests, non-fragile setup) before any may be reopened.

| Feature | Reason |
|---------|--------|
| Web dashboard | Defer until daily/weekly loop is sticky; small loops beat big dashboards |
| BLE companion | Defer until core loop is sticky; explicit handoff exclusion |
| Hosted SaaS / shared OAuth relay | v1 is local-first, BYO OAuth only; avoids WHOOP-platform risk and trust burden |
| Consumer / private WHOOP endpoint scraping | Respect WHOOP ToS; read-only official API v2 only |
| Healthspan, ECG, BP, hormonal insights, journal, continuous HR | Not exposed via official WHOOP API; surfaced via `whoop_api_gap` |
| Mobile app | Web/CLI/MCP only; no mobile in roadmap |
| Multi-user coaching / shared team views | Single-user personal tool |
| Medical advice or clinical diagnosis | Decision support only, no clinical claims |
| Cross-source integrations (Apple Health, calendar, nutrition) | Deferred per guardrail |
| Write operations to WHOOP | Read-only; WHOOP exposes no write surface and we make no claims |
| Streaks / gamification | Anti-feature: erodes trust per habit-tracker retention research and conflicts with the "no moralizing" tone principle |
| Windows-first support | macOS-first; Linux supported via libsecret + chmod 600 fallback; Windows deferred |
| Free-form SQL pass-through MCP tool | Risk of LLM-generated destructive queries; `whoop_query_cache` uses typed per-resource filters instead |

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| FND-01 | Phase 1 | Complete (Plan 01-01, 2026-05-12) |
| FND-02 | Phase 1 | Complete |
| FND-03 | Phase 1 | Complete |
| FND-04 | Phase 1 | Complete (Plan 01-02, 2026-05-12 — unit half D-02a; integration half D-02b lands Plan 01-06) |
| FND-05 | Phase 1 | Complete (Plan 01-04, 2026-05-12 — 20 Vitest cases pin sanitizer; scripts/ci-grep-gates.sh enforces tone + console.* + process.stdout.write rules) |
| FND-06 | Phase 1 | Complete (Plan 01-03, 2026-05-12 — 4 D-07 patterns + D-08 cause walker in src/mcp/sanitize.ts; Plan 01-04 added 20-case Vitest spec) |
| FND-07 | Phase 1 | Complete |
| AUTH-01 | Phase 2 | Complete |
| AUTH-02 | Phase 2 | Complete |
| AUTH-03 | Phase 2 | Complete |
| AUTH-04 | Phase 2 | Complete |
| AUTH-05 | Phase 2 | Complete |
| AUTH-06 | Phase 2 | Complete |
| DATA-01 | Phase 3 | Complete (Plan 03-05, 2026-05-16) |
| DATA-02 | Phase 3 | Complete (Plan 03-02, 2026-05-16) |
| DATA-03 | Phase 3 | Complete (Plan 03-02, 2026-05-16) |
| DATA-04 | Phase 3 | Complete (Plan 03-05, 2026-05-16) |
| DATA-05 | Phase 3 | Complete (Plan 03-03, 2026-05-16) |
| DATA-06 | Phase 3 | Complete (Plan 03-09, 2026-05-16) |
| SYNC-01 | Phase 3 | Complete (Plan 03-11, 2026-05-16) |
| SYNC-02 | Phase 3 | Complete (Plan 03-06, 2026-05-16) |
| SYNC-03 | Phase 3 | Complete (Plan 03-06, 2026-05-16) |
| SYNC-04 | Phase 3 | Complete (Plan 03-04, 2026-05-16) |
| SYNC-05 | Phase 3 | Complete (Plan 03-08, 2026-05-16) |
| SYNC-06 | Phase 3 | Complete (Plan 03-05, 2026-05-16) |
| SYNC-07 | Phase 3 | Complete (Plan 03-07, 2026-05-16) |
| REV-01 | Phase 4 | Complete (Plans 04-03 + 04-04, 2026-05-20 — Verified by `src/domain/stats/median.test.ts`, `src/domain/stats/mad.test.ts`, `src/domain/baselines/index.test.ts`) |
| REV-02 | Phase 4 | Complete (Plan 04-04, 2026-05-20 — Verified by `src/domain/confidence/index.test.ts`) |
| REV-03 | Phase 4 | Complete (Plan 04-07, 2026-05-20 — Verified by `src/services/review/daily.test.ts`, `tests/contract/daily-review-shape.test.ts`) |
| REV-04 | Phase 4 | Complete (Plans 04-07 + 04-09, 2026-05-20 — Verified by `tests/contract/daily-review-shape.test.ts`, `src/formatters/daily-review.txt.test.ts`) |
| REV-05 | Phase 4 | Complete (Plan 04-07, 2026-05-20 — Verified by `src/services/review/daily.test.ts` against fixture `daily-insufficient-days.json`) |
| REV-06 | Phase 4 | Complete (Plans 04-05 + 04-07, 2026-05-20 — Verified by `src/services/review/weekly.test.ts`, `src/domain/patterns/pattern.test.ts`) |
| REV-07 | Phase 4 | Complete (Plans 04-03 + 04-05 + 04-07, 2026-05-20 — Verified by `src/domain/stats/fdr.test.ts`, `src/domain/patterns/pattern.test.ts`, `src/services/review/weekly.test.ts` against fixtures `bh_downgrades_marginal.fixture.json` + `weekly-pattern-fdr-suppression.json`) |
| REV-08 | Phase 4 | Complete (Plans 04-01 + 04-09, 2026-05-20 — Verified by `tests/contract/formatter-tone.test.ts` + `scripts/ci-grep-gates.sh` Gate A) |
| DEC-01 | Phase 4 | Complete (Plans 04-06 + 04-11, 2026-05-20 — Verified by `src/cli/commands/decision-add.test.ts`, `src/services/decision/index.test.ts`) |
| DEC-02 | Phase 4 | Complete (Plan 04-06, 2026-05-20 — Verified by `src/infrastructure/db/repositories/decisions.repo.test.ts`) |
| DEC-03 | Phase 4 | Complete (Plan 04-11, 2026-05-20 — Verified by `src/cli/commands/decision-review.test.ts`, `src/cli/commands/decision-update.test.ts`) |
| DEC-04 | Phase 4 | Complete (Plans 04-05 + 04-07, 2026-05-20 — Verified by `src/services/review/weekly.test.ts` against fixture `weekly-decision-prompt-none-this-week.json`) |
| MCP-01 | Phase 4 | Complete (Plan 04-10, 2026-05-20 — Verified by `tests/integration/mcp-runtime.test.ts` (tools.length === 8, D-29 attestation)) |
| MCP-02 | Phase 4 | Complete (Plans 04-01 + 04-10, 2026-05-20 — Verified by `tests/contract/mcp-tool-shape.test.ts`) |
| MCP-03 | Phase 4 | Complete (Plans 04-01 + 04-10, 2026-05-20 — Verified by `tests/contract/mcp-shim-loc.test.ts`) |
| MCP-04 | Phase 4 | Complete (Plans 04-01 + 04-10, 2026-05-20 — Verified by `tests/integration/mcp-runtime.test.ts` (resources.length === 6), `tests/contract/mcp-resource-shape.test.ts`) |
| MCP-05 | Phase 4 | Complete (Plans 04-01 + 04-10, 2026-05-20 — Verified by `tests/integration/mcp-runtime.test.ts` (prompts.length === 4), `tests/contract/mcp-prompt-shape.test.ts`) |
| MCP-06 | Phase 4 | Complete (Plans 04-01 + 04-10, 2026-05-20 — Verified by `src/mcp/sanitize.test.ts` (extended Plan 04-10 Task 4 with Phase 4 fixtures)) |
| DOC-01 | Phase 5 | Complete (Plans 05-01..05-06, 2026-05-29 — Verified by `src/services/doctor/index.test.ts` (14-check assertion) + per-probe tests: `whoop-roundtrip.test.ts`, `db-{open,integrity,schema-version,wal-size}.test.ts`, `last-sync-recency.test.ts`, `most-recent-scored-day.test.ts`, `data-quality-counts.test.ts`, `concurrent-writers-stress.test.ts`) |
| DOC-02 | Phase 5 | Complete (Plans 05-01 + 05-09, 2026-05-29 — Verified by `tests/contract/troubleshooting-coverage.test.ts` (1:1 check-name ↔ troubleshooting section) + `DOCTOR_EXIT_CODES` {pass:0,fail:1,warn:2} in `src/cli/commands/doctor.ts` per D-04) |
| DOC-03 | Phase 5 | Complete (Plan 05-07, 2026-05-29 — Verified by `tests/contract/api-gap-md-parity.test.ts` + `scripts/generate-api-gap-md.test.ts`) |
| DOC-04 | Phase 5 | Complete (Plans 05-08 + 05-09, 2026-05-29 — Verified by `tests/contract/troubleshooting-coverage.test.ts` + `INSTALL.md` + `docs/install/{claude-code,claude-desktop,cursor,launchd,whoop-app,troubleshooting,api-gap}.md`) |
| DOC-05 | Phase 5 | Complete (Plan 05-08, 2026-05-29 — Verified by `templates/com.recovery-ledger.daily-sync.plist` (plutil -lint passes) + `docs/install/launchd.md`) |
| DOC-06 | Phase 5 | Complete (Plan 05-10, 2026-05-29 — Verified by `tests/integration/setup-stopwatch.test.ts` (env-gated; local gated run 5s vs 1200s budget) + `.github/workflows/setup-stopwatch.yml` on macos-latest + ubuntu-latest) |

**Coverage:**
- v1 requirements: 50 total (FND=7, AUTH=6, DATA=6, SYNC=7, REV=8, DEC=4, MCP=6, DOC=6)
- Mapped to phases: 50
- Unmapped: 0 ✓
- Complete: 50 / 50 (7 FND + 6 AUTH + 13 DATA/SYNC + 18 REV/DEC/MCP + 6 DOC; Phases 1 + 2 + 3 + 4 + 5 closed)
- Remaining: 0 / 50 (v1.0 complete)

> *v1.0 complete: 2026-05-29 — 50 / 50 v1 requirements done across Phases 1+2+3+4+5.*

> *Note:* prior coverage lines read "26/49" / "44/49"; the actual prefix-by-prefix sum is 50 (FND=7+AUTH=6+DATA=6+SYNC=7+REV=8+DEC=4+MCP=6+DOC=6). Corrected during Phase 4 close (Plan 04-12).


## v1.1 Traceability

| Requirement | Phase | Issue(s) | Status |
|-------------|-------|----------|--------|
| SECH-01 | Phase 6 | #78 | Planned |
| SECH-02 | Phase 6 | #79 (+ #95 init/Pino-fatal) | Planned |
| INPV-01 | Phase 6 | #80 | Planned |
| DBIN-01 | Phase 7 | #75 | Planned |
| DBIN-02 | Phase 7 | #76 (+ #95 includeExcluded) | Planned |
| DBIN-03 | Phase 7 | #77 | Planned |
| DBIN-04 | Phase 7 | #88 | Planned |
| DBIN-05 | Phase 7 | #94 | Planned |
| ERRC-02 | Phase 8 | #87 | Planned |
| LIFE-01 | Phase 9 | #81 | Planned |
| LIFE-02 | Phase 9 | #82 | Planned |
| LIFE-03 | Phase 9 | #83 | Planned |
| LIFE-04 | Phase 9 | #91 (+ #95 inFlight-leak) | Planned |
| ERRC-01 | Phase 9 | #89 | Planned |
| ARCH-01 | Phase 10 | #95 sanitize placement | Planned |
| ARCH-02 | Phase 10 | #85 | Planned |
| ARCH-03 | Phase 10 | #84 | Planned |
| ARCH-04 | Phase 10 | #92 | Planned |
| ARCH-05 | Phase 10 | #93 | Planned |
| ARCH-06 | Phase 10 | #95 doctor-wiring extract | Planned |
| ARCH-07 | Phase 10 | #95 doctor-DI ad-hoc | Planned |
| ARCH-08 | Phase 10 | #95 api-gap over-structured | Planned |
| TSTC-01 | Phase 11 | #86 | Planned |
| TSTC-02 | Phase 11 | #90 | Planned |
| TSTC-03 | Phase 12 | #95 testing bucket | Planned |
| BACK-01 | Phase 12 | #95 residual | Planned |

**v1.1 Coverage:**
- v1.1 requirements: 26 total (SECH=2, DBIN=5, ERRC=2, LIFE=4, INPV=1, ARCH=8, TSTC=3, BACK=1)
- Mapped to phases: 26
- Unmapped: 0 ✓
- Planned: 26 / 26 (Phase 6-12 not yet started)
- Complete: 0 / 26

> *v1.1 defined: 2026-05-31 — 26 REQ-IDs mapped 1:1 across 7 phases (6-12); numbering continues from v1.0.*


---
*Requirements defined: 2026-05-11*
*Last updated: 2026-05-31 — milestone v1.1 defined: 26 new REQ-IDs (SECH=2, DBIN=5, ERRC=2, LIFE=4, INPV=1, ARCH=8, TSTC=3, BACK=1) mapped 1:1 to GitHub issues #75–#95 across Phases 6-12; v1.1 traceability table appended*
