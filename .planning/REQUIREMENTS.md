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
- [ ] **AUTH-06**: Token-leak prevention: error messages and MCP tool error returns never expose token material (covered by FND-06)

### Data Model & DB

- [ ] **DATA-01**: SQLite database opens in WAL mode with `busy_timeout=5000`, `journal_size_limit=64MB`, `wal_autocheckpoint=1000` pragmas at default `~/.recovery-ledger/recovery-ledger.sqlite`
- [ ] **DATA-02**: Drizzle schema for `oauth_tokens`, `sync_runs`, `cycles`, `recoveries`, `sleeps`, `workouts`, `daily_summaries`, `decisions` with hybrid normalized columns + `raw_json` per entity
- [ ] **DATA-03**: Index on `(score_state, start)` on each scored entity to support the SCORED-only baseline queries
- [ ] **DATA-04**: Drizzle migrator runs at every connection inside `BEGIN IMMEDIATE`, takes a pre-migration backup of `.sqlite`/`-wal`/`-shm`, and fails closed on partial migration
- [ ] **DATA-05**: Three-layer types — raw WHOOP responses (Zod), normalized entities (Drizzle), and view types for review outputs — with `Score = discriminatedUnion('score_state', …)` enforcing `SCORED` discipline in domain code
- [ ] **DATA-06**: DST / time-zone-shift detection during sync flags affected cycles for baseline exclusion while keeping them visible in raw views

### Sync

- [ ] **SYNC-01**: `recovery-ledger sync --days N` (default 30) fetches profile, body measurements, cycles, recovery, sleep, and workouts for the requested window
- [ ] **SYNC-02**: WHOOP HTTP client honors pagination, normalizes snake_case → camelCase, and enforces a semaphore-of-4 concurrent-request limit
- [ ] **SYNC-03**: 429 responses back off honoring `Retry-After` / `X-RateLimit-Reset`; rate-limit state is reported on the CLI
- [ ] **SYNC-04**: Sync is idempotent via `ON CONFLICT DO UPDATE`; deltas use `updated_at` with a 7-day re-window to catch late-scored cycles
- [ ] **SYNC-05**: Partial-failure reporting — sync exit reports which resources succeeded, failed, or were skipped, recorded in a `sync_runs` row
- [ ] **SYNC-06**: Sync issues a `wal_checkpoint(TRUNCATE)` at the end of a successful run
- [ ] **SYNC-07**: Fixture-based contract tests cover every WHOOP resource (cycles, recovery, sleep, workouts, profile, body measurements); no live API calls in the default test run

### Review

- [ ] **REV-01**: Baseline calculator computes trailing-30-day weighted baselines for HRV (median + MAD), RHR (median + MAD), sleep duration, sleep efficiency, day strain, and respiratory rate from `SCORED` entities only, excluding DST/tz-flagged cycles
- [ ] **REV-02**: Confidence-tier gating — `insufficient` when < 10 SCORED days, `weak` ≥ 10, `strong` ≥ 20 with ≥ 70% baseline-window coverage; Z-score refused when < 14 days available
- [ ] **REV-03**: `recovery-ledger review daily` returns the documented daily-review schema (data_status, today_state, anomalies, patterns, actions ≤ 3) with text-fallback rendering
- [ ] **REV-04**: Daily review surfaces data freshness (latest sync, baseline window, missing/stale resources) at the top of every brief
- [ ] **REV-05**: When data is insufficient, the daily review states what is missing and declines to make confident recommendations
- [ ] **REV-06**: `recovery-ledger review weekly` identifies the lowest-recovery days of the week and runs pattern checks on preceding sleep duration / sleep debt / strain / workout timing / HRV delta / RHR delta / respiratory-rate anomaly
- [ ] **REV-07**: Weekly review applies Benjamini-Hochberg FDR correction at q = 0.10 across ≤ 5 pre-registered candidate factors and returns "no reliable pattern detected" as a typed positive output when nothing crosses threshold
- [ ] **REV-08**: Review output tone passes a banned-word CI lint (no coach-y / hype / moralizing language) and renders actions as verb-first single sentences

### Decision Ledger

- [ ] **DEC-01**: `recovery-ledger decision add` accepts category, decision, rationale, confidence, expected effect, and follow-up date (ULID id, smart defaults for date and follow-up window) with a one-line happy path
- [ ] **DEC-02**: Decisions persist with `status` (open / followed_up / abandoned) and `outcome_notes`
- [ ] **DEC-03**: `recovery-ledger decision review` lists open decisions with elapsed time vs. expected effect window and prompts for outcome capture
- [ ] **DEC-04**: Weekly review prompts for at least one new decision when none has been recorded in the prior week

### MCP Surface

- [ ] **MCP-01**: MCP server exposes tools `whoop_sync`, `whoop_daily_review`, `whoop_weekly_review`, `whoop_query_cache` (typed per-resource filters, not free-form SQL), `whoop_add_decision`, `whoop_review_decisions`, `whoop_api_gap`, `whoop_doctor`
- [ ] **MCP-02**: Every tool returns structured JSON (`structuredContent`) plus compact text (`content`) so weaker clients still work
- [ ] **MCP-03**: All MCP tools are ≤ 5-line shims over services — zero business logic in `src/mcp/`; identical behavior to the CLI equivalents
- [ ] **MCP-04**: MCP resources `whoop://summary/today`, `whoop://summary/week`, `whoop://baseline/30d`, `whoop://data-quality`, `whoop://api-gaps`, `whoop://decisions/open` are exposed and refresh from the cache
- [ ] **MCP-05**: MCP prompts `whoop_daily_decision_brief`, `whoop_weekly_recovery_investigation`, `whoop_experiment_designer`, `whoop_deload_or_train` are registered with documented inputs
- [ ] **MCP-06**: MCP tool error returns are sanitized via the FND-06 contract — no token material, no internal stack traces

### Diagnostics & Setup

- [ ] **DOC-01**: `recovery-ledger doctor` checks: auth state, token freshness + WHOOP roundtrip, DB integrity + schema version + WAL file size, last-sync recency + most-recent SCORED day, MCP transport stdout-purity self-test, data-quality counts, native-module load, concurrent-writers stress
- [ ] **DOC-02**: Doctor emits structured exit codes that map to documented troubleshooting steps
- [ ] **DOC-03**: API-gap documentation lists every WHOOP consumer-app feature not available via the public API (Healthspan, ECG, BP, journal, continuous HR, etc.) with a clear "unavailable via API" explanation surfaced through `whoop_api_gap`
- [ ] **DOC-04**: Install guide includes per-client sections for Claude Code, Claude Desktop, and Cursor; WHOOP developer-app setup checklist; and a troubleshooting map keyed to doctor exit codes
- [ ] **DOC-05**: launchd `.plist` template for macOS is shipped as documentation (not auto-installed) for users who want a scheduled local sync
- [ ] **DOC-06**: Clean-clone-to-first-daily-review measured at < 20 minutes on a fresh macOS image, asserted by a CI stopwatch test

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
| AUTH-06 | Phase 2 | Pending |
| DATA-01 | Phase 3 | Pending |
| DATA-02 | Phase 3 | Pending |
| DATA-03 | Phase 3 | Pending |
| DATA-04 | Phase 3 | Pending |
| DATA-05 | Phase 3 | Pending |
| DATA-06 | Phase 3 | Pending |
| SYNC-01 | Phase 3 | Pending |
| SYNC-02 | Phase 3 | Pending |
| SYNC-03 | Phase 3 | Pending |
| SYNC-04 | Phase 3 | Pending |
| SYNC-05 | Phase 3 | Pending |
| SYNC-06 | Phase 3 | Pending |
| SYNC-07 | Phase 3 | Pending |
| REV-01 | Phase 4 | Pending |
| REV-02 | Phase 4 | Pending |
| REV-03 | Phase 4 | Pending |
| REV-04 | Phase 4 | Pending |
| REV-05 | Phase 4 | Pending |
| REV-06 | Phase 4 | Pending |
| REV-07 | Phase 4 | Pending |
| REV-08 | Phase 4 | Pending |
| DEC-01 | Phase 4 | Pending |
| DEC-02 | Phase 4 | Pending |
| DEC-03 | Phase 4 | Pending |
| DEC-04 | Phase 4 | Pending |
| MCP-01 | Phase 4 | Pending |
| MCP-02 | Phase 4 | Pending |
| MCP-03 | Phase 4 | Pending |
| MCP-04 | Phase 4 | Pending |
| MCP-05 | Phase 4 | Pending |
| MCP-06 | Phase 4 | Pending |
| DOC-01 | Phase 5 | Pending |
| DOC-02 | Phase 5 | Pending |
| DOC-03 | Phase 5 | Pending |
| DOC-04 | Phase 5 | Pending |
| DOC-05 | Phase 5 | Pending |
| DOC-06 | Phase 5 | Pending |

**Coverage:**
- v1 requirements: 49 total
- Mapped to phases: 49
- Unmapped: 0 ✓
- Complete: 2 / 49 (FND-01, FND-04)

---
*Requirements defined: 2026-05-11*
*Last updated: 2026-05-12 — FND-04 complete via Plan 01-02 (unit half); 2 / 49 requirements done*
