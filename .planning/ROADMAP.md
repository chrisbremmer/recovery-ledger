# Roadmap: Recovery Ledger

**Defined:** 2026-05-11
**Granularity:** standard
**Mode:** yolo
**Core Value:** Turn WHOOP data into a daily and weekly review loop that ends in 3 concrete decisions and a record of whether they helped — useful enough that Chris keeps using it.

## Phases

- [ ] **Phase 1: Foundation & Stdout-Pure MCP Bootstrap** - Bootstrapped TypeScript repo, empty CLI + MCP stdio shells, stderr-only logging, MCP error-sanitizer contract, native-module load verification
- [ ] **Phase 2: OAuth, Token Store & Single-Flight Refresh** - WHOOP OAuth flow, keychain-backed token store with chmod 600 fallback, in-process + cross-process single-flight refresh, MCP error sanitizer wired through
- [ ] **Phase 3: Data Model, DB Layer & Sync Loop** - Three-layer types with discriminated-union Score, Drizzle schema + atomic migrator with pre-migration backup, WHOOP HTTP client with rate limiting + pagination, idempotent sync with DST/tz flagging and partial-failure reporting
- [ ] **Phase 4: Domain Math, Reviews, Decision Ledger & MCP Surface** - Median+MAD baselines, confidence-tier gating, FDR-corrected weekly patterns, daily + weekly reviews, decision ledger, 8 MCP tools + 6 resources + 4 prompts, banned-word tone lint
- [ ] **Phase 5: Doctor Polish, Install Guide & <20-Minute Setup Validation** - Full doctor checks, per-client install guides, API-gap docs, launchd template, CI stopwatch test asserting clean-clone-to-first-review under 20 minutes

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
**Plans**: TBD
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
**Plans**: TBD
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
**Plans**: TBD
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
**Plans**: TBD
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
**Plans**: TBD
**UI hint**: no

## Progress

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Foundation & Stdout-Pure MCP Bootstrap | 0/? | Not started | - |
| 2. OAuth, Token Store & Single-Flight Refresh | 0/? | Not started | - |
| 3. Data Model, DB Layer & Sync Loop | 0/? | Not started | - |
| 4. Domain Math, Reviews, Decision Ledger & MCP Surface | 0/? | Not started | - |
| 5. Doctor Polish, Install Guide & <20-Minute Setup Validation | 0/? | Not started | - |

## Coverage

- **v1 requirements:** 49 total
- **Mapped to phases:** 49
- **Unmapped:** 0

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
*Last updated: 2026-05-11 after roadmap derivation*
