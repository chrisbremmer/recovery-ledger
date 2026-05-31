# Roadmap: Recovery Ledger

**Defined:** 2026-05-11
**Granularity:** standard
**Mode:** yolo
**Core Value:** Turn WHOOP data into a daily and weekly review loop that ends in 3 concrete decisions and a record of whether they helped — useful enough that Chris keeps using it.

## Phases

- [x] **Phase 1: Foundation & Stdout-Pure MCP Bootstrap** - Bootstrapped TypeScript repo, empty CLI + MCP stdio shells, stderr-only logging, MCP error-sanitizer contract, native-module load verification
- [x] **Phase 2: OAuth, Token Store & Single-Flight Refresh** - WHOOP OAuth flow, keychain-backed token store with chmod 600 fallback, in-process + cross-process single-flight refresh, MCP error sanitizer wired through
- [x] **Phase 3: Data Model, DB Layer & Sync Loop** - Three-layer types with discriminated-union Score, Drizzle schema + atomic migrator with pre-migration backup, WHOOP HTTP client with rate limiting + pagination, idempotent sync with DST/tz flagging and partial-failure reporting
- [x] **Phase 4: Domain Math, Reviews, Decision Ledger & MCP Surface** — completed 2026-05-20 - Median+MAD baselines, confidence-tier gating, FDR-corrected weekly patterns, daily + weekly reviews, decision ledger, 8 MCP tools + 6 resources + 4 prompts, banned-word tone lint
- [x] **Phase 5: Doctor Polish, Install Guide & <20-Minute Setup Validation** — completed 2026-05-29 - Full doctor checks, per-client install guides, API-gap docs, launchd template, CI stopwatch test asserting clean-clone-to-first-review under 20 minutes

## Phase Details

### Phase 1: Foundation & Stdout-Pure MCP Bootstrap
**Goal**: Cross-cutting safety nets (stdout purity, error sanitization, native-module load verification, lint discipline) are locked as tested behaviors before any application code is written.
**Depends on**: Nothing (first phase)
**Requirements**: FND-01, FND-02, FND-03, FND-04, FND-05, FND-06, FND-07
**Success Criteria** (what must be TRUE):
  1. `npx recovery-ledger` and `npx recovery-ledger-mcp` both launch from the published `bin` entries with shebangs intact and report a version banner (CLI to stdout, MCP via JSON-RPC `initialize`).
  2. A CI-enforced fixture round-trip against the empty MCP stdio server confirms stdout contains only valid JSON-RPC frames — no Pino logs, no `console.*` output, no library warnings (stdout-purity contract).
  3. A lint rule fails the build on any bare `console.*` call outside `src/cli/`, and a CI gate fails on any non-JSON-RPC byte written to stdout from the MCP server path.
  4. The MCP error-sanitizer contract strips `Authorization` headers and JWT-shaped strings from any error surfaced to a tool result, verified by a fixture of "errors that historically leak" (Node `fetch` failure shapes, undici TypeError variants).
  5. A stub `recovery-ledger doctor` command reports `better-sqlite3` and `@napi-rs/keyring` native-module load status; build is run against compiled `dist/` (not `tsx`) at least once in CI.
**Plans**: 6 plans
- [x] 01-01-bootstrap-PLAN.md — Bootstrap npm + TS strict + tsup + Vitest + Biome config files (FND-01) — completed 2026-05-12 (3m 32s, 9 files)
- [x] 01-02-logger-PLAN.md — Pino stderr-only logger + programmatic destination assertion (FND-04 unit half) — completed 2026-05-12 (4m 56s, 2 src files + 1 modified config)
- [x] 01-03-mcp-skeleton-PLAN.md — MCP stdio server + register() wrapper + sanitize.ts + whoop_doctor shim (FND-03, FND-06)
- [x] 01-04-sanitizer-lint-PLAN.md — Sanitizer unit tests + scripts/ci-grep-gates.sh (FND-05, FND-06)
- [x] 01-05-cli-doctor-PLAN.md — Commander CLI + real runDoctor() + three checks + formatter (FND-02, FND-03, FND-07)
- [x] 01-06-ci-integration-PLAN.md — Subprocess round-trip test + macOS-latest GitHub Actions workflow (FND-01..07 cross-cut)
**UI hint**: no

### Phase 2: OAuth, Token Store & Single-Flight Refresh
**Goal**: Concurrent CLI + MCP processes can refresh WHOOP tokens without ever burning the refresh-token family; tokens never appear in plaintext at rest or in error returns.
**Depends on**: Phase 1 (MCP error-sanitizer contract and stdout-pure logger must exist before any WHOOP error can be surfaced to a tool result; native-module load verification from Phase 1 is the precondition for keychain access)
**Requirements**: AUTH-01, AUTH-02, AUTH-03, AUTH-04, AUTH-05, AUTH-06
**Success Criteria** (what must be TRUE):
  1. `recovery-ledger init` walks the user through configuring BYO WHOOP developer credentials and `recovery-ledger auth` completes the OAuth Authorization Code flow on a dynamically-chosen loopback port, exchanges the code for tokens, and reports success.
  2. Under a concurrent-load test injecting 10 parallel 401 responses across CLI + MCP processes, exactly one WHOOP refresh request is issued and the resulting token tuple is written atomically (temp-file-and-rename) — the single-flight contract (in-process `Promise<Tokens> | null` + cross-process file advisory lock) holds.
  3. OAuth tokens are stored via `@napi-rs/keyring` when available, falling back to a `chmod 600` file when no keychain backend is present; `doctor` reports `auth: keychain` vs `auth: file` so regressions are visible.
  4. A grep of the entire log directory, stderr capture, and any MCP tool error return after an induced WHOOP 401/500 surface yields zero matches for `Bearer`, the JWT shape, or the `Authorization` substring.
**Plans**: 8 plans
- [x] 02-01-wave0-infra-PLAN.md — Install proper-lockfile/open/msw deps + paths.ts + errors.ts (AuthError) + MSW WHOOP helper + OAuth test fixtures
- [x] 02-02-token-store-PLAN.md — Three-layer single-flight gate (in-process Promise + proper-lockfile + atomic write); keyring + file backends; AUTH-05 unit-half concurrency test
- [x] 02-03-oauth-round-trip-PLAN.md — buildAuthorizeUrl + listenForCallback (127.0.0.1 loopback + D-09 HTML pages) + exchangeCode + runOAuth; AuthError gets `auth_port_in_use` kind
- [x] 02-04-refresh-orchestrator-PLAN.md — callWithAuth() 401-reactive retry orchestrator (budget=1); services barrel exports refreshOrchestrator
- [x] 02-05-cli-shims-PLAN.md — `recovery-ledger init` (config bootstrap) + `recovery-ledger auth` (runOAuth+tokenStore.write); Commander wiring; Gate C broadened to src/cli/commands/**/*.ts
- [x] 02-06-doctor-extensions-PLAN.md — probeAuth + probeTokenFreshness (offline-safe); CHECK_NAMES extended to 5; Gate E added (only token-store.ts may reference oauth/oauth2/token)
- [x] 02-07-sanitizer-fixtures-PLAN.md — sanitize.test.ts F6 positional matrix + F7 D-20 OAuth-cause-chain fixture; ZERO production-code changes (Phase 1 SECRET_KEY_NAMES already covers code+client_secret)
- [x] 02-08-cross-process-integration-PLAN.md — tests/integration/auth-concurrency.test.ts (10 forked children + real HTTP mock; AUTH-05 load-bearing); CI matrix expanded to macos+ubuntu (ubuntu sets FORCE_FILE_STORE=1)
**UI hint**: no

### Phase 3: Data Model, DB Layer & Sync Loop
**Goal**: The local SQLite cache holds normalized WHOOP entities with `score_state` discipline, DST/tz exclusion, and `updated_at`-based idempotent sync — fast, fixture-tested, and recoverable from mid-flight migration failure.
**Depends on**: Phase 2 (every WHOOP API call needs the single-flight refresh path and the keychain-backed token store; without those, the first concurrent sync would burn the token family)
**Requirements**: DATA-01, DATA-02, DATA-03, DATA-04, DATA-05, DATA-06, SYNC-01, SYNC-02, SYNC-03, SYNC-04, SYNC-05, SYNC-06, SYNC-07
**Success Criteria** (what must be TRUE):
  1. `recovery-ledger sync --days N` fetches profile, body measurements, cycles, recovery, sleep, and workouts; honors WHOOP pagination (snake↔camel translation) and the 4-concurrent-request semaphore; backs off on 429 honoring `X-RateLimit-Reset`; re-running the same sync is idempotent via `ON CONFLICT DO UPDATE` and produces zero new rows.
  2. Domain code consumes WHOOP scores through `Score = discriminatedUnion('score_state', …)` — the type system refuses to let `PENDING_SCORE` or `UNSCORABLE` masquerade as `SCORED`; baseline queries filter on `score_state = 'SCORED'` at the SQL level by default and the `(score_state, start)` index is in place.
  3. Cycles whose `start`/`end` straddle a DST transition or differ in `timezone_offset` from the adjacent cycle are flagged as excluded from baseline aggregation while remaining visible in raw views.
  4. The Drizzle migrator runs inside `BEGIN IMMEDIATE`, takes a pre-migration backup of `.sqlite`/`-wal`/`-shm`, and a crash-mid-migration test (process killed between statements) is recoverable from the auto-backup; the `__drizzle_migrations` table matches the on-disk schema.
  5. A partial-failure sync (e.g., workouts 429s but cycles succeed) records per-resource success/fail/skipped counts in a `sync_runs` row, exits with `status: 'partial'`, and runs `wal_checkpoint(TRUNCATE)` after every successful run; the fixture-based contract test suite covers every WHOOP resource with zero live API calls and finishes in under 60 seconds.
**Plans**: 13 plans
- [x] 03-01-wave0-infra-PLAN.md — Wave-0 precondition: 5 npm deps + drizzle.config.ts + paths.ts extension + WhoopApiError union + Gate F + Gate G
- [x] 03-02-schema-PLAN.md — Drizzle schema for 9 tables + drizzle-kit generate + introspection tests (DATA-02 / DATA-03 / DATA-05 / DATA-06)
- [x] 03-03-domain-types-PLAN.md — ScoreState + entity types + raw Zod schemas + page wrappers + DU forcing-function tests (DATA-05 / DATA-06)
- [x] 03-04-sync-types-cursor-PLAN.md — RunSyncInput/Result/Outcome + RESOURCES tuple + computeWindow pure function (SYNC-01 / SYNC-04) — completed 2026-05-16 (4m 24s, 3 src files + 11 unit tests)
- [x] 03-05-db-connection-migrator-PLAN.md — openDb + hand-rolled BEGIN IMMEDIATE migrator + pre-migration backup + migration-crash + pragma-roundtrip integration tests (DATA-01 / DATA-04 / SYNC-06)
- [x] 03-06-whoop-client-PLAN.md — httpGet chokepoint + paginateAll + rate-limit semaphore-of-4 + 429-Reset-honoring retry (SYNC-02 / SYNC-03)
- [x] 03-07-msw-fixtures-PLAN.md — 6 MSW helpers + 15+ fixtures including DST/tz set + in-memory-db helper (SYNC-07 / DATA-06)
- [x] 03-08-repositories-PLAN.md — 9 repositories with SCORED-only default filter + ON CONFLICT idempotency + sync_runs lifecycle + body-measurements append-on-change (DATA-02 / DATA-03 / DATA-05 / DATA-06 / SYNC-04 / SYNC-05)
- [x] 03-09-resources-normalizers-dst-PLAN.md — 6 per-resource modules + 6 normalizers + DST/tz detector with two OR-ed rules (SYNC-01 / SYNC-02 / SYNC-04 / DATA-05 / DATA-06)
- [x] 03-10-contract-tests-PLAN.md — 6 fixture-based contract tests anchoring Pitfall G + Pitfall H + idempotency per resource (SYNC-07 / DATA-05 / DATA-06)
- [x] 03-11-sync-orchestration-PLAN.md — runSync orchestrator + bootstrap composition root + idempotency/partial-failure/DST integration tests (SYNC-01..06 / DATA-01 / DATA-04 / DATA-06)
- [x] 03-12-cli-sync-formatter-PLAN.md — Commander `recovery-ledger sync` shim + formatter; D-33 + D-34 attestation preserved (SYNC-01 / SYNC-05)
- [x] 03-13-phase-close-PLAN.md — full-suite green + 7 grep gates + attestation matrix + STATE/REQUIREMENTS/ROADMAP/VALIDATION updates (all 13 REQ-IDs) — completed 2026-05-16
**UI hint**: no

### Phase 4: Domain Math, Reviews, Decision Ledger & MCP Surface
**Goal**: The full review-and-decision product surface — daily + weekly reviews backed by confidence-tier-disciplined statistics, a one-line decision ledger, and the complete MCP tool/resource/prompt set — is exposed identically through CLI and MCP, with tone enforced by lint.
**Depends on**: Phase 3 (reviews are pure functions over cached entities; they cannot run before `score_state` discipline, DST exclusion, and `updated_at` deltas are real)
**Requirements**: REV-01, REV-02, REV-03, REV-04, REV-05, REV-06, REV-07, REV-08, DEC-01, DEC-02, DEC-03, DEC-04, MCP-01, MCP-02, MCP-03, MCP-04, MCP-05, MCP-06
**Success Criteria** (what must be TRUE):
  1. Baseline calculation uses median + MAD (scaled by 1.4826) over `SCORED`-only entities with DST/tz-flagged cycles excluded; confidence-tier gating returns `insufficient` for < 10 SCORED days, `weak` for ≥ 10, `strong` for ≥ 20 with ≥ 70% coverage; Z-scores are refused on fewer than 14 days.
  2. Weekly review applies Benjamini-Hochberg FDR correction at q = 0.10 across ≤ 5 pre-registered candidate factors and returns "no reliable pattern detected" as a typed positive output (not absence of output) whenever nothing crosses threshold — verified by a fixture designed to trigger a p=0.05 false positive that FDR correctly downgrades.
  3. `recovery-ledger review daily` and `review weekly` lead with data freshness (latest sync, baseline window, missing/stale resources), render actions as verb-first single sentences, and a CI lint on every formatter output fails the build on any banned tone word (`optimize`, `wellness`, `honor`, `journey`, `crush`, `nail`, `dial in`, `tune`, `vibe`, `unlock`, emoji).
  4. `recovery-ledger decision add` accepts a happy-path one-liner with smart defaults (ULID id, default follow-up window, default expected effect) and persists with `status` (open / followed_up / abandoned) + `outcome_notes`; `decision review` lists open decisions with elapsed time vs. expected effect window; the weekly review prompts for at least one new decision when none has been recorded in the prior week.
  5. The MCP server exposes all 8 tools (`whoop_sync`, `whoop_daily_review`, `whoop_weekly_review`, `whoop_query_cache`, `whoop_add_decision`, `whoop_review_decisions`, `whoop_api_gap`, `whoop_doctor`), all 6 resources (`whoop://summary/today`, `whoop://summary/week`, `whoop://baseline/30d`, `whoop://data-quality`, `whoop://api-gaps`, `whoop://decisions/open`), and all 4 prompts (`whoop_daily_decision_brief`, `whoop_weekly_recovery_investigation`, `whoop_experiment_designer`, `whoop_deload_or_train`); every tool returns both `structuredContent` and a compact `content` text fallback; every MCP tool body is ≤ 5 lines of shim over a service function — zero business logic lives in `src/mcp/`.
**Plans**: 12 plans
- [x] 04-01-PLAN.md — Wave 0 deps install + D-36 wrappers + Gates H/I/J + 6 contract scaffolds (REV-08, MCP-02/03/04/05/06)
- [x] 04-02-PLAN.md — Type contracts (8 type files + 4 narrowing tests) (REV-01/02/03/06/07, DEC-01/02/03)
- [x] 04-03-PLAN.md — Stats primitives (median + MAD + Mann-Whitney + BH-FDR + REV-07 fixtures) (REV-01, REV-07) — completed 2026-05-19
- [x] 04-04-PLAN.md — Baseline + anomaly + confidence pure-domain layer (REV-01, REV-02, REV-05)
- [x] 04-05-PLAN.md — Patterns + action/decision-prompt catalogs + select (REV-06, REV-07, REV-08, DEC-04)
- [x] 04-06-PLAN.md — Decisions repo extension + decision service + api-gap data (DEC-01, DEC-02, DEC-03, MCP-01)
- [x] 04-07-PLAN.md — Review services (daily + weekly orchestrators) + 10 fixtures (REV-01..07, DEC-04)
- [x] 04-08-PLAN.md — queryCache + bootstrap composition root extension (DEC-01..04, REV-01..07, MCP-01)
- [x] 04-09-PLAN.md — Formatters + D-26 tone contract test (REV-03, REV-04, REV-08, DEC-03, MCP-04)
- [x] 04-10-PLAN.md — MCP surface (8 tools + 6 resources + 4 prompts + D-29 attestation) (MCP-01..06)
- [x] 04-11-PLAN.md — CLI commands (7 new subcommands) (REV-03, REV-04, REV-08, DEC-01..03)
- [x] 04-12-PLAN.md — Phase close (full-suite green + 10 gates + REQ flips + STATE/ROADMAP/VALIDATION close) (all 18 REQ-IDs) — completed 2026-05-20
**UI hint**: no

### Phase 5: Doctor Polish, Install Guide & <20-Minute Setup Validation
**Goal**: A new clone reaches the first daily review in under 20 minutes, with `doctor` diagnosing every prior phase's failure modes and the install guide answering them one-to-one.
**Depends on**: Phase 4 (doctor depends on auth, DB, sync, reviews, decisions, and the MCP surface all existing; the <20-minute target is end-to-end behavior that requires the full product to be in place)
**Requirements**: DOC-01, DOC-02, DOC-03, DOC-04, DOC-05, DOC-06
**Success Criteria** (what must be TRUE):
  1. `recovery-ledger doctor` runs all required checks (auth state, token freshness + WHOOP roundtrip, DB integrity + schema version + WAL file size, last-sync recency + most-recent SCORED day, MCP transport stdout-purity self-test, data-quality counts, native-module load, concurrent-writers stress test) and emits structured exit codes that map one-to-one to the troubleshooting map in the install guide.
  2. The install guide ships per-client sections for Claude Code, Claude Desktop, and Cursor, plus a WHOOP developer-app setup checklist and a troubleshooting map keyed to every documented doctor exit code; a launchd `.plist` template is shipped as documentation (not auto-installed) for users who want scheduled local sync.
  3. `whoop_api_gap` and the bundled API-gap markdown list every WHOOP consumer-app feature not available via the public v2 API (Healthspan, ECG, BP, journal, continuous HR, hormonal insights, etc.) with a clear "unavailable via API" explanation per item.
  4. A CI stopwatch test on a fresh macOS image (or clean-clone container) asserts that the path from `git clone` through `init` → `auth` → first `sync` → first `review daily` completes in under 20 minutes.
**Plans**: 11 plans
- [x] 05-01-PLAN.md — Wave 0 scaffolding: CHECK_NAMES (5→14) + RunDoctorOptions + CLI --offline/--stress + MCP inputSchema + recoveries/sleeps latestScoredDate + cycles/recoveries/sleeps countByScoreState + reserved directories (DOC-01, DOC-02)
- [x] 05-02-PLAN.md — whoop_roundtrip probe + 5 test cases (online check via callWithAuth + httpGet) (DOC-01)
- [x] 05-03-PLAN.md — 4 DB probes: db_open, db_integrity, db_schema_version, db_wal_size + 16 test cases (DOC-01)
- [x] 05-04-PLAN.md — 3 sync-recency/data-quality probes: last_sync_recency, most_recent_scored_day, data_quality_counts + 14 test cases (DOC-01)
- [x] 05-05-PLAN.md — concurrent_writers_stress probe + worker entry + 3 test cases (--stress + subprocess-skip gates) (DOC-01)
- [x] 05-06-PLAN.md — runDoctor() extended 5→14 probes + bootstrap composition wiring + CLI switch to bootstrap() + 14-check smoke (DOC-01, DOC-02)
- [x] 05-07-PLAN.md — API-gap markdown generator + parity contract test + docs:generate-api-gap npm script (DOC-03)
- [x] 05-08-PLAN.md — INSTALL.md + 5 docs/install/*.md + launchd .plist template + README link (DOC-04, DOC-05)
- [x] 05-09-PLAN.md — troubleshooting.md (14 H2 sections) + 3-test contract enforcement (DOC-02, DOC-04)
- [x] 05-10-PLAN.md — env-gated tests/integration/setup-stopwatch.test.ts + dedicated CI workflow on macos-latest + ubuntu-latest (DOC-06)
- [x] 05-11-PLAN.md — Phase close + v1.0 milestone (full-suite green + 10 gates + D-29 + D-21 + REQ flips + STATE/ROADMAP/VALIDATION) (all 6 REQ-IDs)
**UI hint**: no

## Progress

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Foundation & Stdout-Pure MCP Bootstrap | 6/6 | Complete | 2026-05-12 |
| 2. OAuth, Token Store & Single-Flight Refresh | 8/8 | Complete | 2026-05-12 |
| 3. Data Model, DB Layer & Sync Loop | 13/13 | Complete | 2026-05-16 |
| 4. Domain Math, Reviews, Decision Ledger & MCP Surface | 12/12 | Complete | 2026-05-20 |
| 5. Doctor Polish, Install Guide & <20-Minute Setup Validation | 11/11 | Complete | 2026-05-29 |

## Coverage

- **v1 requirements:** 50 total (FND=7, AUTH=6, DATA=6, SYNC=7, REV=8, DEC=4, MCP=6, DOC=6)
- **Mapped to phases:** 50
- **Unmapped:** 0
- **Complete:** 50 / 50 (Phases 1+2+3+4+5 closed — milestone v1.0 complete)

## Cross-Cutting Concerns (Test Origin Map)

Concerns originate in the phase where the first vulnerable code is introduced; tests live permanently in CI from that phase forward.

| Concern | Originates In | How It's Tested From Then On |
|---------|---------------|------------------------------|
| Stdout purity (MCP JSON-RPC frame integrity) | Phase 1 | CI assertion that MCP server stdout under fixture load contains only valid JSON-RPC frames; lint rule banning bare `console.*` outside `src/cli/` |
| MCP error-sanitizer contract (no token material in tool errors) | Phase 1 | Fixture of "errors that historically leak" run against every MCP tool error path; grep-for-`Bearer` test against stderr + log dir |
| Single-flight OAuth refresh | Phase 2 | Concurrent-load test: 10 parallel 401 responses across CLI + MCP processes trigger exactly one refresh; atomic token-write test |
| `score_state` discriminated-union enforcement | Phase 3 | Type-system test (Score must be discriminated union); SQL filter test that baseline queries refuse non-`SCORED` rows by default |
| DST / tz-shift exclusion | Phase 3 | Fixture day on DST boundary + multi-tz trip — neither triggers anomaly; flagged cycles visible in raw views, excluded from baseline aggregation |
| MAD + FDR + "no reliable pattern detected" as positive output | Phase 4 | Fixture designed to trigger p=0.05 false positive correctly downgraded by FDR; small-sample fixture (10 SCORED days) returns `insufficient` and refuses Z-scores |
| Banned-word tone lint | Phase 4 | CI lint on every formatter output fails the build on any banned word |
| <20-minute clean-clone stopwatch | Phase 5 | CI stopwatch test on fresh macOS image asserts `git clone` → first `review daily` completes under 20 minutes |

---
*Roadmap created: 2026-05-11*
*Last updated: 2026-05-29 — Phase 5 closed (11/11 plans executed across 5 waves). 50 / 50 plans complete across Phases 1+2+3+4+5. 50 / 50 v1 requirements complete — milestone v1.0 complete.*

---

## v1.1 Roadmap

**Defined:** 2026-05-31
**Milestone:** v1.1 quality hardening
**Granularity:** standard
**Mode:** yolo
**Source research:** `.planning/research-v1.1/SUMMARY.md` (FEATURES, STACK, ARCHITECTURE, PITFALLS streams)
**Scope:** 21 GitHub issues (#75-#95) surfaced by the post-v1.0 `/ce-code-review` deep-review pass. Zero new user-facing features; defensive correctness only. No new runtime or dev dependencies.

> **Numbering continues from v1.0** (Phases 1-5 closed). v1.1 starts at Phase 6.

### Phases

- [ ] **Phase 6: Secret Hygiene & Input Validation** - Sanitizer covers camelCase token keys, doctor catches harmonised, `--since` strict ISO 8601 (#78, #79, #80, plus #95 init/Pino-fatal items)
- [ ] **Phase 7: DB Integrity Gate** - `aborted` enum dedup with `madge` CI gate, score-state CHECK constraints with two-step migration, JOIN gap closed, decisions/WAL silent failures escalated (#75, #76, #77, #88, #94)
- [ ] **Phase 8: Refresh Atomicity** - Refresh-orchestrator crash between WHOOP response and disk-write surfaces typed `AuthError({kind:'refresh_failed'})`; ADR-0002 §Enforcement updated (#87)
- [ ] **Phase 9: Lifecycle & Concurrency** - Bootstrap try/finally on `openDb()`, Clock injection for `reclassifyStaleRunning`, stress-probe watchdog with CI-aware SIGKILL, `AbortSignal` plumbed through rate-limit semaphore, single-message auth-failure routing (#81, #82, #83, #91, #89, plus #95 inFlight-leak)
- [ ] **Phase 10: Architecture Refactor Cluster** - 6-step build order: sanitize→domain, drop singletons, invert client.ts DI, extract doctor wiring, standardize doctor DI, inline api-gap; single import path for AuthError/MigrationError; `withBootstrap` helper (#84, #85, #92, #93, plus #95 placement items)
- [ ] **Phase 11: Regression Net** - Doctor `latestFinished()` aborted-skip + native-modules failure-path tests; Gate F hardened against `fetch` alias bypass via Biome `noRestrictedGlobals` (#86, #90)
- [ ] **Phase 12: Backlog Drain** - Remaining #95 residual items folded into one final quality-sweep PR: indexes, float quantize, FDR↔weekly integration, DST fixture ids, stopwatch env-gate guard, refresh-orchestrator behavioral assertions (#95 residual)

### Phase Details

#### Phase 6: Secret Hygiene & Input Validation
**Goal**: Land defensive fixes for #78, #79, #80 (and the #95 init.ts outer-catch + token-store mkdir 0o700 + Pino-fatal sanitize items) so no live token material reaches stderr/stdout and `--since` rejects locale-dependent dates with a clear error. Ships as **3 sub-PRs**: (a) SECH-01 sanitizer camelCase + property tests, (b) SECH-02 doctor catches + #95 init/Pino-fatal hygiene, (c) INPV-01 `--since` strict ISO.
**Depends on**: Phase 5 (v1.0 closed — all touched files exist; no v1.0 requirement regresses)
**Requirements**: SECH-01, SECH-02, INPV-01
**Success Criteria** (what must be TRUE):
  1. A grep of stderr capture + log dir after inducing every error path that walks a stored-tokens blob (WHOOP 401/500, `init` failure, `doctor` roundtrip failure, MCP transport fatal) yields zero matches for `Bearer`, JWT shape, `accessToken`, `refreshToken`, or `clientSecret` — verified by a property-test-style fixture matrix covering ≥ 50 token-key shapes.
  2. `recovery-ledger doctor` (CLI) and `whoop_doctor` (MCP) emit identically-sanitized error text on `whoop_roundtrip` failure; the CLI doctor's outer catch wraps `sanitize()` consistently with `auth.ts`/`sync.ts`/`init.ts`.
  3. `recovery-ledger sync --since 2026-02-30` and `--since 03/01/2026` and `--since yesterday` exit non-zero with a clear error pointing at `YYYY-MM-DD` ISO format; previously-valid `--since 2026-05-31` and `--since 2026-05-31T00:00:00Z` still succeed.
  4. CHANGELOG entry calls out #80 as the only user-visible breaking change in v1.1.
**Plans**: TBD
**PR boundaries**: 3 PRs (one per HIGH issue + #95 hygiene fold-ins)
**UI hint**: no

#### Phase 7: DB Integrity Gate
**Goal**: Land defensive fixes for #75, #76, #77, #88, #94 (and the #95 recovery.byRange JOIN sibling) so `score_state` discriminated-union invariants are enforced at the SQL layer, `aborted` rows flow correctly through Zod/Drizzle/QueryCache, and silent data-integrity failures (JOIN gap, decisions no-op, WAL checkpoint failures) escalate visibly. Ships as **5 sub-PRs in build order**: DBIN-01 (#75 enum dedup + `madge --circular` CI gate) → DBIN-03 (#77 CHECK + two-step migration) → DBIN-02 (#76 JOIN gap + #95 includeExcluded sibling) → DBIN-04 (#88 changed:0|1 surfaced) → DBIN-05 (#94 WAL escalation). CRITICAL: the `madge --circular src/` gate must land with DBIN-01 — ESM cycles in the `aborted` enum dedup surface at runtime as `undefined`, not at compile time.
**Depends on**: Phase 6 (any new error messages from #77 migration aborts or #88 service-layer throws must be sanitized; landing this after Phase 6 means the sanitizer is already in place)
**Requirements**: DBIN-01, DBIN-02, DBIN-03, DBIN-04, DBIN-05
**Success Criteria** (what must be TRUE):
  1. `whoop_query_cache resource=sync_runs status=aborted` returns aborted rows through the typed repo without Zod errors; the enum is defined ONCE in a single source-of-truth module imported by Drizzle column, Zod schema, and `QueryCache` input, with `madge --circular src/` green in CI.
  2. Inserting a row with `score_state='SCORED'` and any score column NULL (or `score_state='PENDING_SCORE'`/`'UNSCORABLE'` with any score column NOT NULL) is rejected at SQL write-time by a CHECK constraint; the migration ran in two steps (data-cleanup backfill of legacy NULLs, then CHECK add) with a pre-flight count-violators assertion documented in the user CHANGELOG.
  3. `sleeps.byRange` and `workouts.byRange` exclude DST/tz-flagged rows by default via FK JOIN on `cycle_id`; the `includeExcluded` opt-in path round-trips the same rows; medians and baseline aggregations shift accordingly in fixture tests.
  4. `recovery-ledger decision update --id <typo>` exits non-zero with a typed `DecisionNotFound` error surfaced by the service layer; the repo returns `{changed: 0 | 1}` (no throw at the data layer) so repo semantics stay data-only.
  5. A `wal_checkpoint(TRUNCATE)` failure during sync appends a flag to the `sync_runs` partial-failure manifest; `recovery-ledger doctor` surfaces the flag.
**Plans**: TBD
**PR boundaries**: 5 PRs in build order (DBIN-01 → DBIN-03 → DBIN-02 → DBIN-04 → DBIN-05)
**UI hint**: no

#### Phase 8: Refresh Atomicity
**Goal**: Land defensive fix for #87 (refresh-orchestrator crash between WHOOP refresh-response and disk-write) so the user is loudly forced to re-auth instead of silently retrying with a stale token; ADR-0002 §Enforcement is updated to make this rule explicit. Ships as **1 sub-PR** (#87 alone — highest-stakes correctness work in the milestone; isolated so the contract test surface stays small). ERRC-01 (#89) is deferred to Phase 9 because it depends on this phase's new typed error shape.
**Depends on**: Phase 6 (the new `refresh_failed` AuthError message must be sanitized — no token material in the user-visible re-auth prompt) and Phase 7 (`aborted` rows from earlier crash-recovery paths already flow through the typed repo by the time this lands)
**Requirements**: ERRC-02
**Success Criteria** (what must be TRUE):
  1. A contract test forces `writeFileAtomic` to throw after WHOOP returns rotated tokens (MSW `once: true`); the call site surfaces `AuthError({kind:'refresh_failed', detail:'rotated tokens received but write failed — run \`recovery-ledger auth\`'})`; the next process invocation receives the same error rather than presenting the stale on-disk token.
  2. All new logic inside `doRefresh` executes inside `writeUnderLock`'s critical section; a `proper-lockfile.lock()` held-continuously assertion gates the test.
  3. ADR-0002 §Enforcement contains a new sentence: "A refresh response that succeeds at the HTTP layer but fails to persist MUST surface `AuthError({kind:'refresh_failed'})` and force re-auth — silent retry with the stale on-disk token is forbidden."
  4. The "1-hour grace" behavior (in-flight request continues with the rotated access token even though disk write failed) is documented and tested.
**Plans**: TBD
**PR boundaries**: 1 PR (#87)
**UI hint**: no

#### Phase 9: Lifecycle & Concurrency
**Goal**: Land defensive fixes for #81, #82, #83, #91 (and the #95 inFlight-leak sibling) plus #89 (auth-failure message coherence — depends on Phase 8's new error shape) so SQLite handles never leak on migration failure, in-flight syncs are not falsely flipped to `aborted` after laptop sleep, the stress probe always bounds-fails within ~35s, and the rate-limit semaphore honours cancellation without leaking slots. Ships as **5 sub-PRs**: LIFE-01 (#81 try/finally), LIFE-02 (#82 Clock wiring), LIFE-03 (#83 watchdog), LIFE-04 (#91 + #95 inFlight-leak paired — landing #91 alone creates a slot leak under the new abort path), ERRC-01 (#89 single-message routing for AuthError vs WhoopApiError(401)).
**Depends on**: Phase 8 (ERRC-01 references Phase 8's `refresh_failed` AuthError kind in its classification table; #82 also depends on Phase 7's `aborted` enum dedup having landed via Phase 7)
**Requirements**: LIFE-01, LIFE-02, LIFE-03, LIFE-04, ERRC-01
**Success Criteria** (what must be TRUE):
  1. A regression test forces `migrate()` to throw mid-flight; no leftover `.sqlite-wal`/`-shm` handles exist after the test; bootstrap pairs `openDb()` with `try/finally db.close()`.
  2. A clock-skew test injects a stale `nowIso` and asserts in-flight `sync_runs` rows are NOT flipped to `aborted` by `reclassifyStaleRunning` — the injected `Clock` is honoured on every code path.
  3. `recovery-ledger doctor --stress` bounds-fails within ~35s (5s SIGKILL in `process.env.CI`, 2s local) even when a stuck worker would otherwise hang; the watchdog regression test uses `await vi.advanceTimersByTimeAsync(...)` to exercise the SIGKILL path.
  4. `RateLimitSemaphore.acquire(signal)` rejects in-flight slot waits with `AbortError` when the signal aborts; the abort-during-deferred-throttle path does NOT leak an `inFlight` decrement (verified by a listener-count assertion after the test); the `granted` boolean gate on the listener is exercised.
  5. `recovery-ledger doctor` and `whoop_doctor` emit one classification message for "token dead" regardless of whether the underlying error is `AuthError` or `WhoopApiError({status:401})`; the classification table is single-sourced.
**Plans**: TBD
**PR boundaries**: 5 PRs (LIFE-01, LIFE-02, LIFE-03, LIFE-04, ERRC-01)
**UI hint**: no

#### Phase 10: Architecture Refactor Cluster
**Goal**: Land architectural-hygiene fixes for #84, #85, #92, #93 (and the #95 placement debates) in the 6-step build order from `.planning/research-v1.1/ARCHITECTURE.md` §Recommended build order so the composition root `bootstrap()` owns every runtime collaborator and the layering rule (`transports → services → domain ∪ infrastructure`) is enforceable by codemod assertion. Ships as a **coordinated cluster of 6 sub-PRs**: ARCH-01 (sanitize→domain mechanical move) → ARCH-02 (drop tokenStore + refreshOrchestrator singletons; bootstrap owns construction) → ARCH-03 (invert client.ts via `authedCall` DI; resource modules become factories) → ARCH-06 (extract doctor production wiring from bootstrap.ts:320-392 into `src/services/doctor/wiring.ts`) → ARCH-07 (drop `deps?.read ?? (() => tokenStore.read())` fallbacks; required deps only) → ARCH-08 (inline `src/services/api-gap/` into single file; promote catalog to `src/domain/api-gap/catalog.ts`). ARCH-04 (#92 single-import-path codemod for AuthError/MigrationError) and ARCH-05 (#93 `withBootstrap` helper) fold in here because the codemod hits the same 8 CLI files as ARCH-02/03.
**Depends on**: Phase 9 (the DI surface defined here makes future lifecycle tests cleaner; landing it after Phase 9 means no lifecycle regression rides on a refactored composition root)
**Requirements**: ARCH-01, ARCH-02, ARCH-03, ARCH-04, ARCH-05, ARCH-06, ARCH-07, ARCH-08
**Success Criteria** (what must be TRUE):
  1. `src/domain/observability/sanitize.ts` exists; no file under `src/cli/`, `src/mcp/`, or `src/services/` imports from `src/infrastructure/observability/`; the layering rule is enforceable via grep.
  2. `bootstrap()` constructs `tokenStore` and `refreshOrchestrator` exactly once via injected defaults; `export const tokenStore` (token-store.ts:496) and `export const refreshOrchestrator`/`callWithAuth` (refresh-orchestrator.ts:131,140) are deleted; `logger`/`paths`/`rate-limit` retain documented module-state exceptions; ADR-0002 §Enforcement adds the "exactly one tokenStore per process, wired by bootstrap" rule.
  3. `src/infrastructure/whoop/client.ts` no longer imports from `src/services/`; `httpGet`'s signature includes an `authedCall: AuthedCall` parameter; resource modules are factories wired in `bootstrap.ts:261-270`; test fakes simplify to `(op) => op('test-token')`.
  4. `rg "from '.*infrastructure/whoop/errors'" src tests` returns zero matches for `AuthError|MigrationError`; the codemod ran in the same commit as the re-export deletion; CLI command shims share one `withBootstrap(handler)` helper and ~30 lines of duplicated bootstrap-error handling × 8 files collapses to a single source.
  5. `bootstrap.ts` is under 250 lines; `productionWhoopFetcher`, `whoopErrorKindToStatus`, and `services_runDoctor` live in `src/services/doctor/wiring.ts`; doctor checks use required-deps DI matching non-doctor services; `src/services/api-gap.ts` is a single file (no directory) and `API_GAP_ENTRIES` lives at `src/domain/api-gap/catalog.ts`.
**Plans**: TBD
**PR boundaries**: 6 PRs in build order (ARCH-01 → ARCH-02 → ARCH-03 → ARCH-06 → ARCH-07 → ARCH-08; ARCH-04 + ARCH-05 fold into ARCH-02/03)
**UI hint**: no

#### Phase 11: Regression Net
**Goal**: Land defensive fixes for #86 and #90 so the doctor `latestFinished()` aborted-skip filter and `native_modules` failure-path are covered by tests (closing Phase 5 gaps), and Gate F's `fetch` enforcement cannot be silently bypassed by an alias re-export. Ships as **2 sub-PRs**: TSTC-01 (#86 doctor tests — depends on DBIN-01 having landed because the test inserts an `aborted` row through the typed repo), TSTC-02 (#90 Biome `noRestrictedGlobals` + stronger Gate F regex).
**Depends on**: Phase 10 (refactored DI surface lets the new doctor tests use the same factory shape as production wiring) and Phase 7 (DBIN-01 must have landed for TSTC-01's typed-repo insert to compile)
**Requirements**: TSTC-01, TSTC-02
**Success Criteria** (what must be TRUE):
  1. `services/doctor/checks/last-sync-recency.test.ts` includes a regression test that inserts an `aborted` `sync_runs` row through the typed repo and asserts `latestFinished()` skips it (i.e. uses the row PRIOR to the aborted one); the test compiles only after DBIN-01's enum widening.
  2. `services/doctor/checks/native-modules.test.ts` includes a failure-path test that simulates a `better-sqlite3`/`@napi-rs/keyring` load failure and asserts the probe surfaces `status: fail` with the expected error class (not a swallowed exception).
  3. A new Biome `noRestrictedGlobals` rule on `fetch` aliases (`const f = globalThis.fetch`, `const f = global.fetch`) fails CI on import; `scripts/ci-grep-gates.sh` Gate F regex is hardened to match `globalThis.fetch`/`global.fetch`/`(fetch)` patterns; the test suite includes a positive-control file that intentionally violates the rule (under `tests/fixtures/`) to prove the rule fires.
**Plans**: TBD
**PR boundaries**: 2 PRs (TSTC-01, TSTC-02)
**UI hint**: no

#### Phase 12: Backlog Drain
**Goal**: Land remaining #95 residual items (those NOT folded into Phases 6-11) as a final coordinated quality-sweep PR: decisions/sync_runs covering indexes; `decisions.findByPrefix` min-length guard; body_measurements REAL == quantize tolerance; cycles.cursor() score-state-aware comment; token-store `mkdir` 0o700; OAuth callback server `.unref()`; Pino `flush()` on signals + start-of-sync. Plus TSTC-03 (the #95 testing backlog: FDR↔weekly-review fixture integration; DST fixture hard-coded ids; stopwatch env-gate polarity guard; auth-concurrency I-01 typed assertion; concurrent_writers_stress detail regex; doctor/index integration detail regex; body_measurements concurrent-readers test; refresh-orchestrator behavioral assertions). Ships as **1 omnibus PR** (low-risk, all-or-nothing — backlog drain is opportunistic but useful).
**Depends on**: Phase 11 (regression-net tests are in place, so the final sweep cannot regress an uncovered surface) and Phase 10 (architecture refactor done, so no #95 item is invalidated mid-flight by a layering move)
**Requirements**: TSTC-03, BACK-01
**Success Criteria** (what must be TRUE):
  1. All #95 residual items (decisions/sync_runs indexes; `findByPrefix` min-length guard; body_measurements float quantize; cycles.cursor() comment; token-store mkdir 0o700; OAuth callback `.unref()`; Pino flush signal handlers) ship in one PR; CHANGELOG enumerates each.
  2. All #95 testing backlog items (FDR↔weekly integration, DST fixture hard-coded ids, stopwatch env-gate polarity guard, auth-concurrency I-01 typed assertion, concurrent_writers_stress detail regex, doctor/index integration detail regex, body_measurements concurrent-readers test, refresh-orchestrator behavioral assertions) land in the same PR; full-suite green; suite still finishes under 60 seconds locally.
  3. Phase-close gate: every one of the 26 v1.1 REQ-IDs is flipped to Complete in the REQUIREMENTS.md v1.1 Traceability table; milestone v1.1 close is appended to STATE.md.
**Plans**: TBD
**PR boundaries**: 1 PR (residual + TSTC-03 fold-in)
**UI hint**: no

### Progress (v1.1)

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 6. Secret Hygiene & Input Validation | 0/? | Not started | - |
| 7. DB Integrity Gate | 0/? | Not started | - |
| 8. Refresh Atomicity | 0/? | Not started | - |
| 9. Lifecycle & Concurrency | 0/? | Not started | - |
| 10. Architecture Refactor Cluster | 0/? | Not started | - |
| 11. Regression Net | 0/? | Not started | - |
| 12. Backlog Drain | 0/? | Not started | - |

### Coverage (v1.1)

- **v1.1 requirements:** 26 total (SECH=2, DBIN=5, ERRC=2, LIFE=4, INPV=1, ARCH=8, TSTC=3, BACK=1)
- **Mapped to phases:** 26
- **Unmapped:** 0
- **Complete:** 0 / 26 (Phase 6-12 not yet started)

### Cross-Phase Dependency Graph

```
Phase 6 (sanitizer + ISO) ──► Phase 7 (DB integrity) ──► Phase 8 (refresh atomicity)
                                          │                            │
                                          ▼                            ▼
                                Phase 9 (lifecycle + ERRC-01) ◄────────┘
                                          │
                                          ▼
                                Phase 10 (architecture refactor)
                                          │
                                          ▼
                                Phase 11 (regression net)
                                          │
                                          ▼
                                Phase 12 (backlog drain)
```

Key cross-phase chains (from PITFALLS.md):
- `DBIN-01 → DBIN-03 → LIFE-02 → TSTC-01` — `aborted` enum dedup must land first; CHECK references the corrected enum; reclassify tests insert through typed repo; doctor `latestFinished()` test does the same.
- `SECH-01/02 → ERRC-02 → ERRC-01` — sanitizer first so refresh-failed message stays clean; refresh-failed AuthError surfaces in Phase 8; Phase 9's ERRC-01 routing depends on the Phase 8 shape.
- `ARCH-01 → ARCH-02 → ARCH-03` — sanitize-move ratchets the layering rule; singletons drop so bootstrap owns construction; client.ts DI invert lands cleanly because bootstrap already owns the orchestrator.

### v1.1 Cross-Cutting Concerns (Test Origin Map)

| Concern | Originates In | How It's Tested From Then On |
|---------|---------------|------------------------------|
| Sanitizer property-test matrix (camelCase coverage) | Phase 6 | Fixture matrix ≥ 50 token-key shapes against every error path; grep-for-`Bearer`/JWT against stderr + log dir |
| `madge --circular src/` ESM cycle gate | Phase 7 | CI gate runs on every PR; required-green branch protection |
| SQL-layer score_state CHECK enforcement | Phase 7 | Two-step migration + pre-flight count-violators assertion + post-migration doctor probe |
| `proper-lockfile` held-continuously contract | Phase 8 | Contract test asserts lock held from `callRefreshEndpoint` resolution through `AuthError({kind:'refresh_failed'})` surface |
| CI-aware SIGKILL watchdog (5s CI, 2s local) | Phase 9 | `process.env.CI` branch + `await vi.advanceTimersByTimeAsync(...)` test |
| AbortSignal listener cleanup invariant | Phase 9 | Listener-count assertion after each `acquire(signal)` test |
| Composition-root single-construction invariant | Phase 10 | `rg "import.*tokenStore"` zero-matches in `src/` outside `bootstrap.ts` + ADR-0002 §Enforcement update |
| Biome `noRestrictedGlobals` on `fetch` aliases | Phase 11 | Positive-control fixture file under `tests/fixtures/` that intentionally violates the rule |

---
*v1.1 roadmap created: 2026-05-31 — 7 phases (Phase 6-12), 26 v1.1 requirements mapped, 0 unmapped. Continues numbering from v1.0 (Phases 1-5 closed).*
