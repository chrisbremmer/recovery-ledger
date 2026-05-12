# Project Research Summary

**Project:** Recovery Ledger
**Domain:** Local-first personal recovery analytics (WHOOP API v2 → TypeScript CLI + MCP stdio server)
**Researched:** 2026-05-11
**Confidence:** HIGH

## Executive Summary

Recovery Ledger is a single-user, single-machine, two-transport (CLI + MCP stdio) tool that turns a personal WHOOP API v2 stream into a daily/weekly review ritual and a decision ledger with outcome tracking. The locked stack (Node 22 LTS, `@modelcontextprotocol/sdk` 1.29.x, `better-sqlite3` 12.x + Drizzle 0.45.x, Zod 4.x, native `fetch`, Vitest 4 + MSW 2, Biome 2, tsx + tsup) is HIGH-confidence current as of 2026-05-11. Open gaps in the original stack resolve cleanly to Commander 14 for the CLI, date-fns 4 + `@date-fns/tz` for IANA-zone-aware day math, `@napi-rs/keyring` (with `chmod 600` file fallback) for OAuth-token secrets at rest, Pino-to-stderr for logging, and a launchd `.plist` template (no in-process daemon by default).

The architectural answer is **lite hexagonal**: a pure-TS application core (`services/` + `domain/`) with two driving adapters (`cli/`, `mcp/`) that share 100% of behavior, and three driven adapters (WHOOP HTTP, Drizzle/SQLite, filesystem/keychain). Both transports import the same services and the same `formatters/`, so structured JSON and text fallback never drift. Baselines, anomalies, and pattern detection live as pure functions in `domain/` over normalized entity rows — trivially unit-testable with array literals, and satisfying PROJECT.md's "add one derived metric in one documented pattern" maintenance promise.

The risks are concentrated and known. Five cross-cutting concerns must be locked as **tested behaviors**, not assumed properties: (1) **stdout purity** on the MCP server — a single `console.log` corrupts JSON-RPC; (2) **single-flight OAuth refresh** in-process and across CLI+MCP processes — WHOOP rotates refresh tokens and a stampede revokes the whole token family; (3) **`score_state` discipline** — `SCORED` only by default, never silently consume `PENDING_SCORE` / `UNSCORABLE` as zero; (4) **confidence-tier discipline** — median + MAD, hard minimum samples, Benjamini-Hochberg FDR; (5) **"no reliable pattern detected" as a tested positive output**, not an absence of output. Retention threats (coach-y tone, >20-minute setup, decision-form friction) are higher-severity than most technical pitfalls and warrant test enforcement of their own — banned-word lints on formatter output, a clean-clone stopwatch test, and a one-line happy-path for `decision add`.

## Key Findings

### Recommended Stack

The handoff's locked stack is fully verified for late-2025/early-2026 use and supplemented with current picks for the originally unspecified slots. See `.planning/research/STACK.md` for full versions, rationale, and anti-recommendations.

**Core technologies:**
- **TypeScript on Node 22 LTS** — Chris's primary language; retention beats library breadth for a personal tool
- **`@modelcontextprotocol/sdk` 1.29.x** — first-class Anthropic SDK; stdio transport for Claude Code / Desktop / Cursor; raw SDK over `fastmcp` (its OAuth-proxy and multi-transport features are irrelevant locally)
- **`better-sqlite3` 12.x in WAL mode** — synchronous, embedded, zero-config; matches local-first principle
- **Drizzle ORM 0.45.x with `drizzle-kit`** — typed schema + versioned SQL migrations; lightweight; `migrate()` runs on startup
- **Zod 4.x** — runtime validation for WHOOP responses, CLI input, MCP tool I/O
- **Native `fetch` / `undici`** — no axios; hand-rolled OAuth client (under 80 LOC)
- **`@napi-rs/keyring` 1.3.x** — drop-in replacement for archived `keytar`; `chmod 600` file fallback for headless environments
- **Commander 14** — mature, zero-dep CLI framework; fits the verb/object command shape
- **date-fns 4 + `@date-fns/tz`** — IANA-zone-aware day math (cycles cross calendar boundaries; DST matters)
- **Pino with stderr-only transport** — critical for MCP stdio correctness
- **Vitest 4 + MSW 2** — TS-standard test stack; MSW for fixture-based WHOOP contract tests with zero live API calls
- **Biome 2** — single binary for lint + format
- **tsx (dev) + tsup (build)** — keep `better-sqlite3` and `@napi-rs/keyring` `external` in tsup config
- **launchd `.plist` template (macOS-primary)** — opt-in only; no in-process daemon in v1

**Anti-recommendations:**
- ❌ axios — native fetch is sufficient
- ❌ Prisma — heavyweight for a personal local tool
- ❌ keytar — archived
- ❌ `fastmcp` — solves problems we don't have
- ❌ `console.log` anywhere in the MCP server path
- ❌ `drizzle-kit push` in non-dev environments

### Expected Features

See `.planning/research/FEATURES.md` for the full categorization. The handoff's Active list maps 1:1 to v1 table-stakes; no features were added or removed by research.

**Must have (table stakes for v1 — without these, the daily/weekly loop fails):**
- WHOOP OAuth (BYO developer app) + safe single-flight token refresh
- Local SQLite cache (cycles, recoveries, sleeps, workouts, profile, body measurements) with `score_state` discipline
- `recovery-ledger sync --days N` with partial-failure reporting and rate-limit backoff
- `recovery-ledger review daily` (today vs trailing-30d weighted baseline, anomalies, top 3 actions)
- `recovery-ledger review weekly` (worst-recovery days + preceding-pattern checks, OR an explicit "no reliable pattern detected")
- Decision ledger (`decision add` / `decision review`) with rationale, expected effect, follow-up date, outcome notes
- MCP stdio server exposing 8 tools, 6 resources, 4 prompts — structured JSON + text fallback for every tool
- `recovery-ledger doctor` end-to-end self-check
- Fixture-based contract tests (zero live API in default test run)
- API-gap documentation + `whoop_api_gap` tool surfacing every WHOOP feature not in the public API

**Should have (differentiators — why this exists vs. opening the WHOOP app):**
- Decision ledger with outcome tracking (no competitor MCP server has this)
- Composed insights (baseline + anomaly + action) rather than raw endpoint wrappers (no competitor has this)
- MCP prompts and resources, not just tools (no competitor has these)
- API-gap honesty as a feature, not a footnote
- "No reliable pattern detected" as a positive output — countercultural transparent-uncertainty

**Defer (v2+ / behind hard guardrail):**
- Web dashboard, BLE companion, hosted SaaS, mobile, multi-user — gated behind "≥12 daily reviews used + ≥3 weekly reviews + ≥8 decisions + stable tests + non-fragile setup"
- Cross-source integrations (Apple Health, calendar, nutrition)
- Healthspan, ECG, BP, journal, continuous HR — not exposed via official WHOOP API; surfaced via `whoop_api_gap`
- Streaks / gamification — anti-feature; erodes trust and conflicts with tone principle

### Architecture Approach

Lite hexagonal: a pure TS application core behind a single `Services` factory, with two driving adapters (CLI, MCP) and three driven adapters (WHOOP HTTP, Drizzle/SQLite, filesystem/keychain). CLI and MCP commands are four-to-five-line shims — no business logic in transport code, ever. See `.planning/research/ARCHITECTURE.md` for module layout, data flows, build order, and testing seams.

**Major components:**
1. **`src/cli/`** — Commander-based command shims; one file per command (`auth`, `sync`, `review`, `decision`, `doctor`)
2. **`src/mcp/`** — `@modelcontextprotocol/sdk` server + 8 tool registrations as shims over services + 6 resources + 4 prompts
3. **`src/services/`** — application orchestration: `runSync`, `getDailyReview`, `getWeeklyReview`, `addDecision`, `reviewDecisions`, `queryCache`, `runDoctor`, `getApiGap`. Single source of behavior — both transports call these.
4. **`src/domain/`** — pure functions: baselines (median + MAD), anomaly detection, confidence-tier gating, pattern detection with FDR correction, decision-outcome scoring. No I/O.
5. **`src/infrastructure/`** — WHOOP HTTP client (snake↔camel pagination, semaphore-of-4 rate limiter, retry on 429 honoring `X-RateLimit-Reset`), Drizzle schema + migrator + WAL pragmas, token store (file + `@napi-rs/keyring` with file fallback), config loader
6. **`src/formatters/`** — shared structured-JSON + compact-text formatters per tool; banned-word lint enforced in CI

**Build order:** config → types (raw / entity / view) → DB schema + migrator → token store + WHOOP HTTP client → sync service → domain math → review services → decision service → formatters → CLI shims → MCP shims → doctor.

### Critical Pitfalls

Top five from `.planning/research/PITFALLS.md` — all should become tested behaviors, not assumed properties.

1. **MCP stdout pollution** — A single `console.log` anywhere in the MCP-reachable code path corrupts the JSON-RPC stream. *Prevention:* Pino → stderr only; CI assertion that the server's stdout under fixture load contains only valid JSON-RPC frames; lint rule banning bare `console.*` outside `cli/`.
2. **WHOOP refresh-token rotation race** — Concurrent refresh from CLI + MCP processes invalidates the whole token family (RFC 6819 reuse detection). *Prevention:* in-process module-level `Promise<Tokens> | null` single-flight + cross-process file advisory lock + atomic temp-file-and-rename token write; replay-on-401 wrapper around every WHOOP call; `auth` re-OAuth as the recovery path.
3. **`score_state` silently consumed as zero** — `PENDING_SCORE` / `UNSCORABLE` records masquerading as low recovery destroys trust on day one. *Prevention:* `Score = discriminatedUnion('score_state', …)` in domain types; baseline queries filter `SCORED` by default; index on `(score_state, start)`; explicit "not-yet-scored" surface in `today_state`.
4. **Small-sample false patterns** — Z-scores on noisy HRV/RHR with <14 days, or scanning many factors against few worst-recovery days, generates false patterns that erode trust faster than any technical bug. *Prevention:* median + MAD (1.4826) for HRV/RHR/sleep; `gateConfidence` rules (`insufficient` <10 SCORED days; `weak` ≥10; `strong` ≥20/30 + ≥70% coverage); Z-score refused on <14 days; Benjamini-Hochberg FDR at q=0.10 with ≤5 pre-registered factors; "no reliable pattern detected" as a typed view variant.
5. **DST / time-zone-shift phantom anomalies** — Cycles that span DST transitions or travel produce fake "day strain" and "sleep duration" anomalies. *Prevention:* detect tz/DST shifts during sync; flag affected cycles for baseline exclusion (but keep them visible in raw views); `@date-fns/tz` for IANA-zone-aware day math.

## Implications for Roadmap

Based on research, **suggested phase structure: 5 phases**.

### Phase 1 — Foundation, Skeleton, and Stdout-Pure MCP Bootstrap

**Rationale:** Cross-cutting safety nets are cheapest to lock when zero application code exists. Stdout purity, MCP error-sanitizer contract, banned-word lint, native-module rebuild, and Zod→JSON-Schema fidelity must be tested from commit one.
**Delivers:** Bootstrapped repo + lint/test/build CI gates + empty CLI shells + empty MCP server with stdio transport + Pino stderr logger + `doctor` self-test for stdout purity
**Uses:** Node 22 + ESM + tsup + Biome + Vitest + Pino + `@modelcontextprotocol/sdk` (empty server)
**Avoids:** Stdout pollution (Pitfall 1), MCP error leakage (Pitfall 17), Zod→JSON-Schema description loss, native-module load failures, premature `console.*`

### Phase 2 — OAuth, Token Store, Single-Flight Refresh, Keychain

**Rationale:** Every WHOOP API call depends on safe token handling. If concurrent CLI+MCP refresh isn't single-flighted before sync exists, the first development session will burn the token family. Build the auth foundation in isolation.
**Delivers:** Hand-rolled WHOOP OAuth client + single-flight refresh (in-process + cross-process) + atomic token write + `@napi-rs/keyring` with 0600 file fallback + `recovery-ledger init` (dynamic loopback port) + `auth` command + MCP error sanitizer
**Uses:** `@napi-rs/keyring`, native fetch, file advisory lock, atomic temp-and-rename
**Implements:** Token store + WHOOP HTTP base client
**Avoids:** Refresh-token rotation race (Pitfall 2), token leakage via error returns (Pitfall 17), OAuth callback port collision

### Phase 3 — Data Model, DB Layer, Sync Loop

**Rationale:** Reviews are pure functions over cached entities; they cannot exist before `score_state`, DST handling, `updated_at` deltas, and pagination are correct. Largest phase by pitfall count and complexity.
**Delivers:** Three-layer types (raw / entity / view) with discriminated-union `Score`; Drizzle schema (hybrid normalized + `raw_json` columns + `(score_state, start)` index); WAL pragmas + migrator with `BEGIN IMMEDIATE` + pre-migration backup; per-resource WHOOP client with snake↔camel pagination + semaphore-of-4 rate limiter honoring `X-RateLimit-Reset`; `services/sync.service.ts` with `sync_runs` audit, `ON CONFLICT DO UPDATE` idempotency, `updated_at` deltas + 7-day re-window, partial-failure semantics, `wal_checkpoint(TRUNCATE)`; DST/tz detection flags excluded cycles; `recovery-ledger sync --days N` first end-to-end
**Uses:** Drizzle 0.45.x, better-sqlite3 12.x, MSW for contract tests against fixtures of each WHOOP resource
**Implements:** Domain types, DB layer, sync service, WHOOP HTTP client
**Avoids:** Score-state misuse (Pitfall 3), DST anomalies (Pitfall 5), migration corruption, rate-limit hammering, WAL hygiene issues, JSON-blob queryability traps, retroactive-update misses

### Phase 4 — Domain Math, Reviews, Decision Ledger, MCP Tool Surface

**Rationale:** This is the keystone — the entire product-value layer. Reviews, decisions, and MCP exposure share the `services/` and `formatters/` boundaries; splitting them forces drift across that boundary. Successful Phase 4 = first time `services.getDailyReview` flows identically through both transports.
**Delivers:** `domain/baselines/` (median + MAD, 1.4826); `gateConfidence` rules; FDR-corrected pattern detection with ≤5 pre-registered factors; `review.service.ts` (daily + weekly) leading with data freshness; `decision.service.ts` with ULID IDs + smart defaults; all 8 MCP tools as 5-line shims; all 6 resources; all 4 prompts; `whoop_api_gap` + API-gap markdown; banned-word CI lint on formatter output
**Uses:** `@modelcontextprotocol/sdk` tools + resources + prompts, ULID, Zod schemas for structured tool I/O
**Implements:** Domain math, review service, decision service, MCP transport, formatters
**Avoids:** Small-sample false patterns (Pitfall 4), coach-y tone, decision-form friction, MCP schema fidelity loss

### Phase 5 — Doctor Polish, Install Guide, <20-Minute Setup Validation

**Rationale:** Doctor checks every prior phase, and the <20-minute clean-clone-to-first-review target is end-to-end behavior, not a per-phase property. This is the integration capstone.
**Delivers:** `services/doctor.service.ts` covers auth state, token freshness + roundtrip, DB integrity + schema version + WAL size, last-sync recency + most-recent SCORED day, MCP transport stdout-purity self-test, data-quality counts, native-module load, concurrent-writers stress test; install guide with one section per MCP client (Claude Code, Claude Desktop, Cursor) + WHOOP developer-app checklist + troubleshooting map from doctor exit codes; launchd `.plist` template (macOS, not installed by default); CI stopwatch test on clean-room macOS image
**Uses:** Existing services; documentation tooling
**Implements:** Doctor service, install docs, scheduling templates, end-to-end setup-time CI validation
**Avoids:** Setup-friction retention threat, silent doctor regressions

### Phase Ordering Rationale

- **Phase 1 first** because cross-cutting safety nets (stdout-purity, MCP error sanitizer contract, banned-word lint) are cheapest to test when zero application code exists.
- **Phase 2 before Phase 3** so the first concurrent CLI+MCP invocation in development doesn't burn the refresh-token family.
- **Phase 3 before Phase 4** because reviews are pure functions over cached entities and cannot exist before `score_state`, DST exclusion, and `updated_at` deltas are real.
- **Phase 4 holds the entire product-value layer.** Splitting reviews from MCP tools from decisions would force drift across the shared `services/` and `formatters/` boundary — they're cohesive.
- **Phase 5 is the integration capstone** — doctor checks every prior phase, and the <20-minute setup target is end-to-end.
- **Cross-cutting tests live permanently in CI from the phase they originate:** stdout-purity from Phase 1, single-flight refresh from Phase 2, `score_state` from Phase 3, MAD + FDR + "no reliable pattern detected" + banned-word from Phase 4, stopwatch from Phase 5.

### Research Flags

**Phases likely needing deeper research during planning:**
- **Phase 2** — Cross-process single-flight file-lock semantics + stale-lock detection + replay-on-401 contract are not standard-library; a focused `/gsd-research-phase` pass before planning is worth it.
- **Phase 4 (analytics)** — Confidence-tier thresholds, MAD scaling for small samples, and FDR q-value defaults are project judgment calls. Tune defaults with a focused research pass before locking values.
- **Phase 4 (MCP schemas)** — Zod→JSON-Schema fidelity in the MCP TS SDK is the known-fragile boundary; confirm pinned SDK × Zod combination still emits `description` correctly under draft-2020-12.

**Phases with standard patterns (skip research-phase):**
- **Phase 1** — Node 22 + ESM + tsup + Biome + Vitest bootstrap is boring-and-correct.
- **Phase 3 (DB layer)** — SQLite WAL + Drizzle migration patterns are well-trodden; WHOOP-specific bits are documented in the WHOOP developer docs.
- **Phase 5** — Install guide + doctor + launchd template is documentation + glue.

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | All picks verified against npm registry + official docs on 2026-05-11. Only live judgment call is date-fns vs Luxon (both work). |
| Features | HIGH | PROJECT.md is the source of truth; competitor scan confirms composed-insights surface is uncontested. |
| Architecture | HIGH | Hexagonal-lite over two transports is textbook fit; single-flight refresh corroborated by MCP SDK issue #1760 and WHOOP's docs. |
| Pitfalls | HIGH for WHOOP / MCP / SQLite / OAuth; MEDIUM for behavioral/retention; MEDIUM for small-sample statistical thresholds. |

**Overall confidence: HIGH**

### Gaps to Address

- **Confidence-tier thresholds + FDR q-value defaults** are educated, not measured. Expose in `~/.recovery-ledger/config.json` after shipping defaults; tune once Chris has 30+ days of data.
- **Linux keychain availability without `libsecret`** — Doctor must surface clearly; 0600 file fallback is the explicit path.
- **Exact WHOOP refresh-family revocation behavior** is documented but not exhaustively tested; v1 mitigation is prevention, recovery is `init` re-OAuth.
- **Cross-platform parity** — macOS first-class; Windows deferred to post-v1; Linux works via `libsecret` + chmod 600 fallback but is not first-class tested.
- **Bun compatibility** is a constraint (don't break it) not a target (don't optimize for it); `better-sqlite3` is fine on Node 22.

## Sources

### Primary (HIGH confidence — first-party authoritative)
- WHOOP Developer Platform — API v2 reference (cycles, recovery, sleep, workouts, profile, body measurements)
- WHOOP Developer Platform — OAuth 2.0, refresh tokens, rate limiting, pagination, v1→v2 migration, webhooks, changelog
- `@modelcontextprotocol/sdk` TypeScript — server docs, tools/resources/prompts spec, GitHub issues (#745, #1143, #1760)
- MCP Specification 2025-06-18
- Drizzle ORM — migrations, drizzle-kit migrate, better-sqlite3 driver
- better-sqlite3 — performance, WAL configuration
- SQLite — Write-Ahead Logging documentation
- npm registry (verified versions as of 2026-05-11) for all listed packages

### Secondary (MEDIUM confidence — community consensus / multiple sources)
- Existing WHOOP MCP servers on GitHub (JedPattersonn, nissand, shashankswe2020-ux) — competitor scan
- Auth0 — refresh token rotation & reuse detection
- Nango — concurrency with OAuth token refreshes
- Hexagonal architecture + ports-and-adapters TypeScript references
- Single-flight pattern reference
- date-fns / `@date-fns/tz`, Commander, Vitest, MSW, Biome, Pino — official docs

### Tertiary (LOW / MEDIUM confidence — academic / behavioral, needs in-context validation)
- Wikipedia — Multiple comparisons problem; median absolute deviation
- PMC — Quantified Self Systematic Review
- ScienceDirect — Wearable activity tracker attrition
- Medium / Sage Handbook — quantified-self scope creep, habit-tracker retention

---
*Research completed: 2026-05-11*
*Ready for roadmap: yes*
