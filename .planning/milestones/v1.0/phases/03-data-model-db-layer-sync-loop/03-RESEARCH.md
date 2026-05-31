# Phase 3: Data Model, DB Layer & Sync Loop — Research

**Researched:** 2026-05-16
**Domain:** Local-first SQLite cache + WHOOP API v2 HTTP client + idempotent sync loop
**Confidence:** HIGH (all open WHOOP-doc items resolved against authoritative sources; all locked decisions cross-checked against existing code on disk)

## Phase Overview

**Goal (from ROADMAP.md):** "The local SQLite cache holds normalized WHOOP entities with `score_state` discipline, DST/tz exclusion, and `updated_at`-based idempotent sync — fast, fixture-tested, and recoverable from mid-flight migration failure."

**Depends on:** Phase 2 (single-flight refresh + keychain token store). Every WHOOP API call in Phase 3 routes through `callWithAuth` from `src/services/refresh-orchestrator.ts` — Phase 3 is the FIRST runtime consumer of that orchestrator.

**Primary recommendation:** Build in the strict wave order under "Wave Dependency Analysis" below. The HTTP client and the DB layer share zero files and zero imports — they can be developed in parallel after Wave 0. The sync service joins them in Wave 4. Every plan in Phase 3 must preserve Plan 02-06's Gate E single-consumer invariant (only `token-store.ts` references `oauth/oauth2/token`) and must not modify `src/mcp/sanitize.ts` or `src/mcp/register.ts` (D-33 + D-34 attestation).

## User Constraints (from 03-CONTEXT.md)

> **The 34 D-* decisions in 03-CONTEXT.md are LOCKED.** Per universal-anti-patterns rule 11, research and planning MUST NOT re-litigate them. Discretion was delegated to Claude across all four discussion areas in 03-CONTEXT.md; the resulting decisions are immovable inputs to this phase.

### Locked Decisions (verbatim summary from 03-CONTEXT.md)

**Schema scope (D-01, D-02).** Nine v1 tables: `sync_runs`, `cycles`, `recoveries`, `sleeps`, `workouts`, `daily_summaries`, `decisions`, `profile`, `body_measurements`. `oauth_tokens` is NOT a SQLite table — tokens stay in keyring/file per Phase 2 ADR-0002 + ARCHITECTURE.md line 802. Per-entity hybrid shape: normalized hot-path columns (`score_state`, `start`, `end`, `timezone_offset`, `updated_at`, SCORED-only scores) PLUS `raw_json TEXT NOT NULL` per WHOOP-sourced row. `profile` and `body_measurements` are mostly-raw_json; `decisions` is irreplaceable user data.

**Score discriminated union (D-03, D-04, D-05).** `domain/types/score.ts` exports `Score = z.discriminatedUnion('score_state', [ScoredSchema, PendingScoreSchema, UnscorableSchema])`. SCORED variant carries numeric scores; PENDING_SCORE and UNSCORABLE carry no score fields. Repositories default to `WHERE score_state = 'SCORED'`; opt-in `{ includeUnscored: true }`. Index `(score_state, start)` per scored entity, created in the same migration that adds the table.

**Migration crash-recovery (D-06, D-07, D-08).** HAND-ROLLED migrator in `src/infrastructure/db/migrate.ts` — NOT Drizzle's default `migrate()` (which uses `BEGIN DEFERRED`, banned by Pitfall 13). Wrapper reads `__drizzle_migrations`, computes pending list, takes pre-migration backup of `.sqlite` + `-wal` + `-shm` to `~/.recovery-ledger/backups/db.<ISO>-pre-<tag>.sqlite` at `chmod 600`, runs each pending migration inside `BEGIN IMMEDIATE` via `db.exec()` (multi-statement-aware), commits, inserts `__drizzle_migrations` row. Retention: 3 most recent backups (sort by mtime desc, unlink the rest including `-wal`/`-shm` companions). Fails-closed: on inconsistent state, throw `MigrationError({kind, backupPath, latestSafeMigration})`. **No auto-restore** — CLI doctor prints `cp <backupPath> ~/.recovery-ledger/db.sqlite` remediation; user-initiated step.

**`updated_at` delta + 7-day re-window (D-09, D-10, D-11).** Per-resource cursor = `MAX(updated_at) FROM <resource_table>` (no separate cursor table; no JSON cursor blob). Trailing-7d re-window in addition: `since = min(cursor, now() - 7d)`. `--days N` overrides the 7d default; `--since <ISO>` overrides everything. Idempotency via `ON CONFLICT(id) DO UPDATE SET <all-cols-except-id> = excluded.<col>` per Pitfall 10. Pagination utility asserts no duplicate IDs across consecutive pages.

**DST/tz-shift exclusion (D-13, D-14, D-15, D-16).** Two detection sub-rules OR'd: (1) `dst_straddle` — read IANA zone at sync-start (`Intl.DateTimeFormat().resolvedOptions().timeZone`); compute `tzOffset(zone, cycle.start)` vs `tzOffset(zone, cycle.end)` via `@date-fns/tz`; flag if differ. (2) `tz_drift` — cycle's `timezone_offset` differs from prior cycle's. Storage: `baseline_excluded INTEGER NOT NULL DEFAULT 0` + `exclusion_reason TEXT` ('dst_straddle' | 'tz_drift' | NULL) on cycles ONLY; recovery/sleep/workouts inherit via cycle_id FK. Computed at upsert time; re-evaluated on retroactive updates via D-11 upsert. Fixtures: `200-dst-spring-forward.json`, `200-dst-fall-back.json`, `200-tz-trip-sfo-jfk.json`. Default baseline filter: `WHERE baseline_excluded = 0 AND score_state = 'SCORED'`.

**WHOOP client structure (D-17 through D-22).** Per-resource modules over shared `httpGet` in `src/infrastructure/whoop/client.ts`. `callWithAuth` wraps inside `httpGet` exactly once. `paginateAll` utility owns snake↔camel translation. Semaphore-of-4 + `X-RateLimit-Remaining<10` throttle + 429 `X-RateLimit-Reset` sleep. Pinned to `https://api.prod.whoop.com` per ADR-0007 (GET-only). New `WhoopApiError` union (unauthorized | rate_limited | network | validation | server | unknown) joins FROZEN `AuthError` as a sibling in `src/infrastructure/whoop/errors.ts`.

**Sync orchestration (D-23, D-24, D-25).** Sequential across the 6 resources (profile → body_measurements → cycles → recoveries → sleeps → workouts); parallel-within-resource bound by the semaphore. `sync_runs` row: insert at start with `status='running'`, finalize with `status='ok' | 'partial' | 'failed'`, `finished_at`, `per_resource` JSON, `gaps_detected` count. `wal_checkpoint(TRUNCATE)` after successful or partial sync only (not after failed — leave WAL for diagnostics).

**Configuration knobs (D-26, D-27).** v1 sync flags: `--days N` (default 30), `--since <ISO-date>`, `--resources <list>`. No new `config.json` keys this phase; semaphore size, throttle threshold, retry caps, page-size pins all live as hard-coded constants.

**Repository + raw_json (D-28, D-29).** Repositories return domain entity types, never Drizzle row types. `raw_json` is hidden from entity types; separate `getRawJson(id): Promise<string | null>` diagnostic method per repository. Domain code never calls `getRawJson`.

**SQLite pragmas + WAL hygiene (D-30, D-31, D-32).** Per-connection: `journal_mode=WAL`, `busy_timeout=5000`, `journal_size_limit=67108864` (64 MB), `wal_autocheckpoint=1000`, `synchronous=NORMAL`, `foreign_keys=ON`. All write transactions use `BEGIN IMMEDIATE`; read transactions use default `BEGIN DEFERRED`. `wal_checkpoint(TRUNCATE)` after every successful/partial sync.

**MCP attestation (D-33, D-34).** Zero new MCP tools in Phase 3. `src/mcp/sanitize.ts` + `src/mcp/register.ts` UNMODIFIED. `tools/list` continues to return EXACTLY one tool (`whoop_doctor`).

### Claude's Discretion (resolved in 03-CONTEXT.md)

All four discussion areas were delegated to Claude's discretion and resolved into 34 D-* decisions. Single residual research item: D-12 — does WHOOP v2 accept an `updated_since` filter parameter? **Answered in §Technical Research item 1 below.**

### Deferred Ideas (OUT OF SCOPE, copied from 03-CONTEXT.md)

- Concurrent across resources (sequential at resource level locked by D-23; revisit post-Phase-3 if backfill perf is bottlenecked).
- WHOOP roundtrip check in `doctor` — deferred to Phase 5; Phase 3 may add offline-safe `db_open` + `schema_version` + `wal_size` probes.
- Webhook receiver — PERMANENTLY deferred per scope guardrail.
- Daily-quota counter persistence — not load-bearing for v1 single-user volumes.
- `daily_summaries` aggregation logic — table created empty in Phase 3; Phase 4 baseline service writes to it.
- Configurable baseline window > 30 days — REQUIREMENTS.md V2-05; schema accommodates but not active.
- Export to CSV / JSONL / Parquet — REQUIREMENTS.md V2-04. `getRawJson(id)` is the v1 forward-compat path.
- AES-256-GCM passphrase fallback for file backend — Phase 2 deferred; inherited.
- Southern-hemisphere DST fixtures — works via `@date-fns/tz` for free but not fixture-tested.

## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| DATA-01 | SQLite DB in WAL mode with `busy_timeout=5000`, `journal_size_limit=64MB`, `wal_autocheckpoint=1000` at default `~/.recovery-ledger/recovery-ledger.sqlite` | §Standard Stack, §Pattern 1 (Connection bootstrap); pragmas tier-pinned per D-30 [CITED: better-sqlite3 docs/api.md] |
| DATA-02 | Drizzle schema for the 9 tables with hybrid normalized columns + `raw_json` per entity | §Pattern 2 (Drizzle schema as source of truth); D-01 + D-02 lock the table list; ARCHITECTURE.md lines 590-624 |
| DATA-03 | Index on `(score_state, start)` on each scored entity to support SCORED-only baseline queries | D-05; PITFALLS.md Pitfall 16; §Pattern 2 |
| DATA-04 | Drizzle migrator runs at every connection inside `BEGIN IMMEDIATE`, takes pre-migration backup of `.sqlite`/`-wal`/`-shm`, fails-closed on partial migration | §Pattern 3 (Hand-rolled migrator); D-06 + D-07 + D-08; PITFALLS.md Pitfall 7 + 13 |
| DATA-05 | Three-layer types (raw Zod / Drizzle entity / view) with `Score = discriminatedUnion('score_state', …)` | §Pattern 4 (Score discriminator); D-03; ADR-0003; PITFALLS.md Pitfall 3 |
| DATA-06 | DST / tz-shift detection during sync flags affected cycles for baseline exclusion while keeping them visible in raw views | §Pattern 5 (DST/tz exclusion); D-13 + D-14 + D-15 + D-16; PITFALLS.md Pitfall 6 |
| SYNC-01 | `recovery-ledger sync --days N` (default 30) fetches profile, body measurements, cycles, recovery, sleep, workouts | §Pattern 6 (Sequential sync orchestration); D-23 + D-26 |
| SYNC-02 | WHOOP HTTP client honors pagination, normalizes snake_case → camelCase, enforces semaphore-of-4 | §Pattern 7 (Pagination utility), §Pattern 8 (Semaphore); D-17 + D-19 + D-20; PITFALLS.md Pitfall 10 |
| SYNC-03 | 429 responses back off honoring `X-RateLimit-Reset`; rate-limit state reported on the CLI | §Pattern 8 (Rate-limit semaphore + retry); D-20; §Technical Research item 5 |
| SYNC-04 | Sync is idempotent via `ON CONFLICT DO UPDATE`; deltas use `updated_at` with 7-day re-window | §Pattern 9 (Cursor + 7d re-window); D-09 + D-10 + D-11 |
| SYNC-05 | Partial-failure reporting — sync exit reports per-resource success/fail/skipped, recorded in `sync_runs` | §Pattern 6 (Sync orchestration); D-24 + D-25 |
| SYNC-06 | Sync issues `wal_checkpoint(TRUNCATE)` at end of successful run | §Pattern 1 (Connection bootstrap); D-32; PITFALLS.md Pitfall 12 |
| SYNC-07 | Fixture-based contract tests cover every WHOOP resource; no live API calls in default test run | §Pattern 10 (MSW per-resource); ADR-0006; conventions.md §Testing |

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| HTTPS to api.prod.whoop.com | infrastructure/whoop/ | — | Driven adapter; only `client.ts` + `token-store.ts` + `oauth.ts` may call `fetch` (new Gate F) |
| Token refresh handling | infrastructure/whoop/token-store.ts (Phase 2) via `callWithAuth` (Phase 2 refresh-orchestrator) | — | Phase 3 is the FIRST runtime consumer; ADR-0002 chokepoint preserved |
| Pagination + snake↔camel | infrastructure/whoop/pagination.ts | — | One utility owns the translation per Pitfall 10 |
| Rate-limit semaphore + 429 backoff | infrastructure/whoop/rate-limit.ts + retry.ts | — | In-process state; semaphore-of-4 |
| Zod parse of WHOOP responses | infrastructure/whoop/resources/<name>.ts | domain/schemas/whoop-api.ts | Validation at the boundary only (conventions.md) |
| SQLite connection + pragmas | infrastructure/db/connection.ts | — | One place sets all 6 pragmas per D-30 |
| Drizzle schema (single source of truth) | infrastructure/db/schema.ts | — | ARCHITECTURE.md Migrations section |
| Hand-rolled migrator | infrastructure/db/migrate.ts | — | D-06; runs at bootstrap; not consumed by services |
| Repository (entity ↔ row mapping) | infrastructure/db/repositories/<name>.repo.ts | — | Repositories return domain entities; only file allowed to import drizzle-orm/* under new Gate G |
| Score discriminator | domain/types/score.ts | domain/schemas/score.ts | Pure type; ADR-0003 |
| DST/tz detection (pure rule) | domain/dst-tz/detect.ts | infrastructure/whoop/resources/cycles.ts (calls into it at upsert) | Pure function on `start` + `end` + `timezone_offset` + prior cycle's offset + IANA zone |
| Sync orchestration | services/sync/index.ts | infrastructure/whoop/* + infrastructure/db/repositories/* | Use-case layer; sequential across resources (D-23) |
| CLI subcommand `sync` | cli/commands/sync.ts | services/sync/index.ts | ≤5-line shim per CLI policy |
| MCP `whoop_sync` tool | (PHASE 4) | — | Zero new MCP tools in Phase 3 per D-33 |
| Sanitizer / register wrapper | (PHASE 1 + 2 already locked) | — | UNMODIFIED in Phase 3 per D-34 |
| CI grep enforcement | scripts/ci-grep-gates.sh | — | Add Gate F (fetch outside whoop client/token-store/oauth) and Gate G (drizzle-orm/* outside infrastructure/db) |

## Standard Stack

All packages are pinned by `.planning/research/STACK.md` and the existing `package.json`. Phase 3 adds two production deps and zero dev deps; everything else is already on disk from Phases 1-2.

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `better-sqlite3` | `^12.9.0` | Embedded SQLite, synchronous, prebuilt for Node 22 | [VERIFIED: existing package.json; STACK.md §Core Technologies] — already declared as future dep in STACK; Phase 3 is the first install site |
| `drizzle-orm` | `^0.45.2` | Typed schema + Drizzle row types | [VERIFIED: STACK.md] — pinned stable line; 1.0-rc.2 deliberately NOT used |
| `drizzle-kit` | `^0.31.10` | Generates SQL migrations from schema diffs | [VERIFIED: STACK.md] — `drizzle-kit generate` (committed) only; `push` is ANTI-PATTERN 7 |
| `@date-fns/tz` | `^1` | IANA-zone-aware `tzOffset()` for DST straddle detection | [VERIFIED: STACK.md] — `date-fns@^4.1.0` already in stack |
| `zod` | `^4.4.3` | Runtime validation at the boundary | [VERIFIED: existing package.json] — already installed |
| `msw` | `^2.14.6` | HTTP mocking; per-resource handlers in tests | [VERIFIED: existing package.json] — already installed (Phase 2) |

### Supporting (already present)
| Library | Purpose | Where it's used in Phase 3 |
|---------|---------|----------------------------|
| `pino@^10.3.1` | Structured logger → stderr | All warn/info from `httpGet`, `rate-limit.ts`, sync service. Never inline response bodies or tokens (ADR-0001 + Pitfall 17) |
| `commander@^14.0.3` | CLI subcommand routing | `recovery-ledger sync` shim joins `init`, `auth`, `doctor` under `src/cli/commands/sync.ts` |
| `date-fns@^4.1.0` | Calendar/duration math (paired with `@date-fns/tz`) | Cursor windowing (`now() - 7d`, `now() - N*24h`) |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `drizzle-orm/better-sqlite3/migrator` default | Hand-rolled `BEGIN IMMEDIATE` wrapper | LOCKED by D-06 — default uses `BEGIN DEFERRED` per Pitfall 13 |
| Hand-rolled pagination per resource | Single `paginateAll<T>` utility | LOCKED by D-19 — utility owns snake↔camel + duplicate-ID assertion |
| `axios` / `got` | Native `fetch` via `httpGet` | LOCKED by STACK.md §What NOT to Use — native fetch is sufficient on Node 22 |
| `prisma` | `drizzle-orm` | LOCKED by STACK.md — Drizzle is lighter; Prisma owns its own engine binary |

### Installation (additions only; everything else is already in package.json)
```bash
npm install better-sqlite3@^12.9.0 drizzle-orm@^0.45.2 @date-fns/tz@^1
npm install -D drizzle-kit@^0.31.10 @types/better-sqlite3@^7
```

**Version verification:** Already pinned in `.planning/research/STACK.md` (Researched 2026-05-11, HIGH confidence). The planner SHOULD verify via `npm view better-sqlite3 version` etc. at Wave 0 time and pin the latest patch within the major; do not bump majors silently.

## Package Legitimacy Audit

slopcheck is not on this machine and the working directory is offline-by-policy for new tool installs. All recommended packages are taken from `.planning/research/STACK.md` (researched 2026-05-11, HIGH confidence) and from the existing `package.json` (Phase 1/2 already installed and CI-green). Disposition below reflects the in-repo evidence.

| Package | Registry | Already installed? | Source repo | slopcheck | Disposition |
|---------|----------|---------------------|-------------|-----------|-------------|
| `better-sqlite3@^12.9.0` | npm | No (Phase 3 first install) | github.com/WiseLibs/better-sqlite3 | NOT RUN | Approved — pinned by STACK.md; major TypeScript ecosystem dep; prebuilt binaries documented |
| `drizzle-orm@^0.45.2` | npm | No (Phase 3 first install) | github.com/drizzle-team/drizzle-orm | NOT RUN | Approved — pinned by STACK.md; stable line, NOT 1.0-rc |
| `drizzle-kit@^0.31.10` | npm | No (Phase 3 first install) | github.com/drizzle-team/drizzle-orm | NOT RUN | Approved — companion to drizzle-orm; pinned by STACK.md |
| `@date-fns/tz@^1` | npm | No (Phase 3 first install) | github.com/date-fns/utc / github.com/date-fns/tz | NOT RUN | Approved — pinned by STACK.md; companion to `date-fns@^4.1.0` already installed |
| `@types/better-sqlite3@^7` | npm | No (Phase 3 first install) | github.com/DefinitelyTyped/DefinitelyTyped | NOT RUN | Approved — DefinitelyTyped umbrella |

**Packages removed due to slopcheck [SLOP] verdict:** none.
**Packages flagged as suspicious [SUS]:** none.

> Because slopcheck was unavailable at research time, the planner SHOULD gate each install behind a `checkpoint:human-verify` task in Wave 0 (or run slopcheck if available). Each name above appears verbatim in `.planning/research/STACK.md`'s pinned-versions table, which was researched against the live npm registry on 2026-05-11. [CITED: STACK.md §Core Technologies + §Confidence Summary]

## Architecture Patterns

### System Architecture Diagram

```
                           ┌──────────────────────────────────┐
   CLI: recovery-ledger    │  src/cli/commands/sync.ts        │  ≤5-line shim
   sync --days N           │  (Commander subcommand)          │
                           └──────────────┬───────────────────┘
                                          │  services.runSync({days, since?, resources?})
                                          ▼
┌──────────────────────────────────────────────────────────────────────────┐
│  src/services/sync/index.ts  (orchestration; sequential across resources)│
│   1. insert sync_runs row (status='running')                              │
│   2. for resource in [profile, body_measurements, cycles, recoveries,     │
│                       sleeps, workouts]:                                   │
│        cursor = MAX(updated_at) FROM <resource_table>                     │
│        since  = min(cursor, now() - 7d)  (or --days override)             │
│        result = resources[resource].listAll({since, until})               │
│        repo.upsertBatch(result.rows)  // BEGIN IMMEDIATE per resource     │
│        update sync_runs.per_resource[resource]                            │
│   3. finalize sync_runs (status, finished_at, gaps_detected)              │
│   4. db.pragma('wal_checkpoint(TRUNCATE)') on ok|partial only             │
└──────────────────────────────────────────────────────────────────────────┘
              │                                                  │
              ▼                                                  ▼
┌─────────────────────────────────────┐         ┌──────────────────────────────┐
│  infrastructure/whoop/              │         │  infrastructure/db/          │
│   resources/cycles.ts ──┐           │         │   repositories/<name>.repo.ts│
│   resources/recovery.ts │           │         │   ON CONFLICT(id) DO UPDATE  │
│   resources/sleep.ts    │ paginate  │         │   returns domain entities    │
│   resources/workouts.ts │ via       │         │   getRawJson(id) diagnostic  │
│   resources/profile.ts  │ pagination│         │                              │
│   resources/body-meas.ts┘ .ts       │         │   schema.ts (Drizzle DSL)    │
│                                     │         │   migrate.ts (hand-rolled    │
│   pagination.ts (snake↔camel,       │         │     BEGIN IMMEDIATE wrapper, │
│     dup-ID assertion)               │         │     pre-migration backup)    │
│                                     │         │   connection.ts (pragmas)    │
│   client.ts: httpGet<T>(            │         │                              │
│     path, query, schema             │         │  ALL writes use             │
│   )                                 │         │  BEGIN IMMEDIATE per D-31   │
│     ─ wraps callWithAuth ONCE       │         └──────────────┬───────────────┘
│     ─ rate-limit gate (sem of 4)    │                        │
│     ─ retry on 5xx + 429 honoring   │                        ▼
│         X-RateLimit-Reset           │           ~/.recovery-ledger/db.sqlite
│     ─ Zod parse                     │                  + db.sqlite-wal
│     ─ GET-only (ADR-0007)           │                  + db.sqlite-shm
│                                     │                  + backups/db.<ISO>-pre-
│   rate-limit.ts: semaphore-of-4 +   │                          <tag>.sqlite
│     X-RateLimit-Remaining<10 throt  │
│   retry.ts: 429 sleep(Reset s)      │
│   errors.ts (Phase 2): + WhoopApiError union
│   oauth.ts (Phase 2): UNCHANGED     │
│   token-store.ts (Phase 2): UNCHANGED│
└─────────────────────────────────────┘
              │
              ▼
   callWithAuth (services/refresh-orchestrator.ts, Plan 02-04)
              │
              ▼
   tokenStore.getValidAccessToken() (Plan 02-02)
              │
              ▼
   https://api.prod.whoop.com  (GET-only)
```

**Read path (Phase 4 will consume this):**
```
review.service.ts (Phase 4) ──► repositories.recovery.byRange(start, end, {
                                  includeUnscored: false,   // default per D-04
                                  includeExcluded: false,    // default per D-16
                                })
                                returns Recovery[] (SCORED + non-DST/tz only)
```

### Recommended Project Structure

Verbatim file layout for Phase 3. Lines marked **NEW** are net-new in Phase 3; **EXTEND** means Phase 3 adds code/columns to an existing Phase 1/2 file; **UNCHANGED** is load-bearing attestation.

```
src/
├── cli/
│   └── commands/
│       └── sync.ts                                  # NEW (≤5-line shim)
├── domain/
│   ├── types/
│   │   ├── score.ts                                 # NEW (Score discriminated union per D-03)
│   │   ├── entities.ts                              # NEW (Cycle, Recovery, Sleep, Workout, Profile, BodyMeasurement, Decision, SyncRun, DailySummary)
│   │   └── sync.ts                                  # NEW (RunSyncInput, RunSyncResult, ResourceSyncOutcome, etc.)
│   ├── schemas/
│   │   ├── whoop-api.ts                             # NEW (Zod schemas for raw WHOOP responses, snake_case)
│   │   ├── score.ts                                 # NEW (z.discriminatedUnion('score_state', ...))
│   │   └── entities.ts                              # NEW (Zod schemas matching Drizzle row types)
│   ├── normalize/
│   │   ├── cycles.ts                                # NEW (raw → Cycle entity)
│   │   ├── recovery.ts                              # NEW
│   │   ├── sleep.ts                                 # NEW
│   │   ├── workouts.ts                              # NEW
│   │   ├── profile.ts                               # NEW
│   │   └── body-measurements.ts                     # NEW
│   └── dst-tz/
│       └── detect.ts                                # NEW (pure: cycle + prior + IANA zone → {baseline_excluded, exclusion_reason})
├── infrastructure/
│   ├── config/
│   │   ├── paths.ts                                 # EXTEND (add dbFile, dbWalFile, dbShmFile, backupsDir, migrationsDir to ResolvedPaths)
│   │   ├── schema.ts                                # UNCHANGED unless config.json gains keys (D-27 says none in Phase 3)
│   │   └── logger.ts                                # UNCHANGED
│   ├── whoop/
│   │   ├── client.ts                                # NEW (httpGet<T>(path, query, schema) — auth-wrapped, rate-limited, Zod-validated)
│   │   ├── pagination.ts                            # NEW (paginateAll<T>(fetchPage) — snake↔camel + dup-ID assertion)
│   │   ├── rate-limit.ts                            # NEW (semaphore-of-4 + X-RateLimit-Remaining<10 throttle)
│   │   ├── retry.ts                                 # NEW (jittered exp backoff on 5xx + 429 X-RateLimit-Reset sleep)
│   │   ├── resources/
│   │   │   ├── cycles.ts                            # NEW
│   │   │   ├── recovery.ts                          # NEW
│   │   │   ├── sleep.ts                             # NEW
│   │   │   ├── workouts.ts                          # NEW
│   │   │   ├── profile.ts                           # NEW (single-shot GET)
│   │   │   └── body-measurements.ts                 # NEW (single-shot GET)
│   │   ├── errors.ts                                # EXTEND (+ WhoopApiError union; AuthError FROZEN)
│   │   ├── oauth.ts                                 # UNCHANGED (D-34 attestation)
│   │   └── token-store.ts                           # UNCHANGED (Plan 02-06 Gate E)
│   └── db/
│       ├── connection.ts                            # NEW (openDb(path): {db, sqlite}; sets all 6 pragmas per D-30)
│       ├── schema.ts                                # NEW (Drizzle DSL for 9 tables; (score_state, start) index per scored entity)
│       ├── migrate.ts                               # NEW (hand-rolled BEGIN IMMEDIATE wrapper + pre-migration backup + retention-3)
│       ├── migrations/
│       │   ├── 0000_initial.sql                     # NEW (generated by drizzle-kit, committed)
│       │   └── meta/
│       │       ├── _journal.json                    # NEW (generated)
│       │       └── 0000_snapshot.json               # NEW (generated)
│       └── repositories/
│           ├── cycles.repo.ts                       # NEW
│           ├── recovery.repo.ts                     # NEW
│           ├── sleep.repo.ts                        # NEW
│           ├── workouts.repo.ts                     # NEW
│           ├── profile.repo.ts                      # NEW
│           ├── body-measurements.repo.ts            # NEW
│           ├── sync-runs.repo.ts                    # NEW
│           ├── decisions.repo.ts                    # NEW (table exists; decisions are Phase 4 surface)
│           └── daily-summaries.repo.ts              # NEW (table empty in Phase 3; Phase 4 populates)
├── services/
│   ├── sync/
│   │   ├── index.ts                                 # NEW (runSync())
│   │   ├── per-resource.ts                          # NEW (helper that wraps one resource through the cursor logic)
│   │   └── cursor.ts                                # NEW (pure: derive {since, until} from cursor + flags + clock)
│   ├── bootstrap.ts                                 # NEW (createServices() side effect: openDb + run migrator)
│   ├── refresh-orchestrator.ts                      # UNCHANGED
│   └── index.ts                                     # EXTEND (services barrel + Services interface gains runSync)
├── formatters/
│   └── sync.txt.ts                                  # NEW (per-resource one-line summary for CLI exit)
└── mcp/
    ├── sanitize.ts                                  # UNCHANGED (D-34 attestation)
    ├── register.ts                                  # UNCHANGED (D-34 attestation)
    └── tools/
        └── whoop-doctor.ts                          # UNCHANGED (D-33 attestation: zero new MCP tools)

tests/
├── fixtures/
│   ├── oauth/                                       # UNCHANGED (Phase 2)
│   ├── mcp/                                         # UNCHANGED (Phase 1)
│   └── whoop/                                       # NEW root
│       ├── cycles/
│       │   ├── 200-ok.json                          # NEW (one-page SCORED)
│       │   ├── 200-paginated.json                   # NEW (two-page; second page has next_token=null)
│       │   ├── 200-dst-spring-forward.json          # NEW (cycle straddling Mar DST)
│       │   ├── 200-dst-fall-back.json               # NEW (cycle straddling Nov DST)
│       │   ├── 200-tz-trip-sfo-jfk.json             # NEW (three consecutive cycles, offset -08 → -05 → -05)
│       │   ├── 200-mixed-score-states.json          # NEW (one of each SCORED/PENDING_SCORE/UNSCORABLE)
│       │   ├── 429-rate-limited.json                # NEW (response body) + headers fixture
│       │   └── 500-server-error.json                # NEW
│       ├── recovery/*.json                          # NEW (per-resource scenarios; same shape)
│       ├── sleep/*.json                             # NEW
│       ├── workouts/*.json                          # NEW
│       ├── profile/200-ok.json                      # NEW (single-record)
│       └── body-measurements/200-ok.json            # NEW (single-record)
├── helpers/
│   ├── msw-whoop-oauth.ts                           # UNCHANGED (Plan 02-01)
│   ├── msw-whoop-cycles.ts                          # NEW
│   ├── msw-whoop-recovery.ts                        # NEW
│   ├── msw-whoop-sleep.ts                           # NEW
│   ├── msw-whoop-workouts.ts                        # NEW
│   ├── msw-whoop-profile.ts                         # NEW
│   ├── msw-whoop-body-measurements.ts               # NEW
│   └── in-memory-db.ts                              # NEW (better-sqlite3 :memory: + migrator)
├── setup/
│   └── no-live-whoop.ts                             # UNCHANGED (ADR-0006)
├── contract/                                        # NEW dir per conventions.md
│   ├── cycles.test.ts
│   ├── recovery.test.ts
│   ├── sleep.test.ts
│   ├── workouts.test.ts
│   ├── profile.test.ts
│   └── body-measurements.test.ts
└── integration/
    ├── auth-concurrency.test.ts                     # UNCHANGED (Plan 02-08)
    └── sync/
        ├── idempotency.test.ts                      # NEW (re-run yields 0 new rows)
        ├── partial-failure.test.ts                  # NEW (workouts 429s, cycles succeed → status='partial')
        ├── migration-crash.test.ts                  # NEW (kill mid-statement → backup is restorable)
        ├── dst-fixture.test.ts                      # NEW (DST + tz-shift exclusion end-to-end)
        └── pragma-roundtrip.test.ts                 # NEW (asserts all 6 pragmas land after openDb)

scripts/
└── ci-grep-gates.sh                                 # EXTEND (+ Gate F + Gate G; existing Gates A-E unchanged)

drizzle.config.ts                                    # NEW (points at infrastructure/db/schema.ts + migrations/)
```

### Pattern 1: SQLite Connection Bootstrap (D-30 + D-32)
**What:** Single `openDb(path)` in `src/infrastructure/db/connection.ts` sets all 6 pragmas in fixed order before any query runs.
**When to use:** Every connection — CLI, MCP server, tests (memory DB still pragmas).
**Example:**
```typescript
// Source: better-sqlite3 docs/api.md (verified 2026-05-16) — db.pragma() normalizes PRAGMA
//         result handling; db.exec() is multi-statement-aware for migrations.
// [CITED: github.com/WiseLibs/better-sqlite3/blob/master/docs/api.md]
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';

export function openDb(path: string) {
  const sqlite = new Database(path);
  // Fixed order per D-30. journal_mode must run first; it's the only
  // pragma that switches the DB into a different journaling shape.
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('busy_timeout = 5000');
  sqlite.pragma('journal_size_limit = 67108864'); // 64 MB
  sqlite.pragma('wal_autocheckpoint = 1000');
  sqlite.pragma('synchronous = NORMAL');
  sqlite.pragma('foreign_keys = ON');
  return { db: drizzle(sqlite), sqlite };
}

// At sync end (services/sync/index.ts):
//   if (result.status === 'ok' || result.status === 'partial') {
//     sqlite.pragma('wal_checkpoint(TRUNCATE)');
//   }
```

### Pattern 2: Drizzle Schema as Single Source of Truth (D-01)
**What:** `src/infrastructure/db/schema.ts` is the only place table shapes live; `drizzle-kit generate` produces committed SQL in `src/infrastructure/db/migrations/`.
**When to use:** Any schema change. `drizzle-kit push` is FORBIDDEN (ARCHITECTURE.md Anti-Pattern 7).
**Example (excerpt):**
```typescript
// Source: ARCHITECTURE.md §Recommended Project Structure (lines 83-225) + D-01
import { sqliteTable, text, integer, real, index } from 'drizzle-orm/sqlite-core';

export const cycles = sqliteTable('cycles', {
  id: integer('id').primaryKey(),                    // int64 per WHOOP v2 docs (cycle is int64; sleep/workout are UUIDs)
  user_id: integer('user_id').notNull(),
  created_at: text('created_at').notNull(),
  updated_at: text('updated_at').notNull(),
  start: text('start').notNull(),
  end: text('end'),                                  // optional per WHOOP cycle schema
  timezone_offset: text('timezone_offset').notNull(),
  score_state: text('score_state', { enum: ['SCORED', 'PENDING_SCORE', 'UNSCORABLE'] }).notNull(),
  strain: real('strain'),                            // SCORED-only fields nullable at the column level;
  kilojoule: real('kilojoule'),                      // discriminated-union types enforce at app boundary
  average_heart_rate: integer('average_heart_rate'),
  max_heart_rate: integer('max_heart_rate'),
  baseline_excluded: integer('baseline_excluded', { mode: 'boolean' }).notNull().default(false),
  exclusion_reason: text('exclusion_reason'),        // 'dst_straddle' | 'tz_drift' | null
  raw_json: text('raw_json').notNull(),
}, (t) => ({
  byScoreStateStart: index('cycles_score_state_start_idx').on(t.score_state, t.start),  // D-05 workhorse
}));
```

### Pattern 3: Hand-Rolled Migrator with Pre-Migration Backup (D-06 + D-07 + D-08)
**What:** Migrator in `src/infrastructure/db/migrate.ts` reads `__drizzle_migrations`, takes a backup, runs each pending migration in one `BEGIN IMMEDIATE` transaction using `db.exec()` (multi-statement aware), commits, inserts `__drizzle_migrations` row. On failure → rollback → leave backup → throw `MigrationError`.
**When to use:** Every CLI + MCP process startup, called from `services/bootstrap.ts`.
**Example (skeleton):**
```typescript
// Source: ARCHITECTURE.md lines 590-624 + D-06; better-sqlite3 docs (db.exec is multi-statement)
//         [CITED: better-sqlite3 docs/api.md, drizzle-orm migrations docs]
// Drizzle Kit generate output (verified 2026-05-16):
//   migrations/
//     0000_<name>.sql
//     meta/
//       _journal.json
//       0000_snapshot.json
// __drizzle_migrations columns: id (integer PK), hash (text), created_at (numeric).
// The hand-rolled wrapper reads _journal.json for the canonical pending list rather than
// hashing migration files itself, so a future Drizzle Kit version change to hash semantics
// does not invalidate the gate.
//
// [CITED: orm.drizzle.team/docs/drizzle-kit-generate; deepwiki.com/drizzle-team/drizzle-orm/3.2-migration-system]
import { readFileSync } from 'node:fs';
import { copyFileSync, existsSync, mkdirSync, readdirSync, statSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import type Database from 'better-sqlite3';

export class MigrationError extends Error {
  readonly kind: 'inconsistent_state' | 'apply_failed';
  readonly backupPath: string | null;
  readonly latestSafeMigration: string | null;
  // ...
}

export function migrate(
  sqlite: Database.Database,
  opts: { migrationsDir: string; backupsDir: string; dbFile: string }
): void {
  // 1. ensure __drizzle_migrations exists
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS __drizzle_migrations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      hash TEXT NOT NULL,
      created_at NUMERIC
    );
  `);

  // 2. read meta/_journal.json (canonical migration list, not directory scan)
  const journal = JSON.parse(readFileSync(join(opts.migrationsDir, 'meta', '_journal.json'), 'utf8'));
  // journal.entries: [{idx, when, tag, breakpoints}, ...]

  // 3. find pending
  const appliedHashes = new Set(
    sqlite.prepare('SELECT hash FROM __drizzle_migrations').all().map((r: any) => r.hash)
  );

  for (const entry of journal.entries) {
    const sqlPath = join(opts.migrationsDir, `${entry.tag}.sql`);
    const sql = readFileSync(sqlPath, 'utf8');
    const hash = hashSql(sql);                       // simple sha256 or md5
    if (appliedHashes.has(hash)) continue;

    // 4. PRE-MIGRATION BACKUP (D-07): .sqlite + -wal + -shm to backupsDir
    //    chmod 600; retention 3 (delete oldest by mtime)
    const backupPath = takeBackup(opts.dbFile, opts.backupsDir, entry.tag);

    // 5. BEGIN IMMEDIATE + exec whole file + insert __drizzle_migrations row + COMMIT
    //    Statement breakpoint `--> statement-breakpoint` is treated as a parsing aid
    //    only; the whole .sql payload is one atomic transaction. exec() is
    //    multi-statement-aware per better-sqlite3 docs.
    sqlite.exec('BEGIN IMMEDIATE');
    try {
      sqlite.exec(sql);
      sqlite.prepare(
        'INSERT INTO __drizzle_migrations (hash, created_at) VALUES (?, ?)'
      ).run(hash, Date.now());
      sqlite.exec('COMMIT');
    } catch (err) {
      sqlite.exec('ROLLBACK');
      throw new MigrationError({
        kind: 'apply_failed',
        backupPath,
        latestSafeMigration: entry.tag,
        cause: err,
      });
    }

    // 6. wal_checkpoint(PASSIVE) so a follow-up backup sees the WAL folded back
    sqlite.pragma('wal_checkpoint(PASSIVE)');
  }
}
```

### Pattern 4: Score Discriminated Union (D-03 + ADR-0003)
**What:** Three Zod variants on `score_state`. The type system refuses any code path that reads `.recovery_score` without narrowing.
**Example:**
```typescript
// Source: PITFALLS.md Pitfall 3 + ADR-0003 + D-03
import { z } from 'zod';

const ScoredRecovery = z.object({
  score_state: z.literal('SCORED'),
  recovery_score: z.number().int(),
  resting_heart_rate: z.number().int(),
  hrv_rmssd_milli: z.number(),
  spo2_percentage: z.number(),
  skin_temp_celsius: z.number(),
  user_calibrating: z.boolean(),
});
const PendingRecovery = z.object({ score_state: z.literal('PENDING_SCORE') });
const UnscorableRecovery = z.object({ score_state: z.literal('UNSCORABLE') });

export const RecoveryScore = z.discriminatedUnion('score_state', [
  ScoredRecovery, PendingRecovery, UnscorableRecovery,
]);
// Repositories default to WHERE score_state = 'SCORED'; opt-in {includeUnscored: true}.
```

### Pattern 5: DST/tz-shift Detection (D-13 + D-14 + D-16)
**What:** Pure function in `src/domain/dst-tz/detect.ts` takes the cycle's `start` + `end` + `timezone_offset`, the prior cycle's `timezone_offset`, and the IANA zone resolved at sync start. Returns `{baseline_excluded: 0 | 1, exclusion_reason: 'dst_straddle' | 'tz_drift' | null}`.
**Example:**
```typescript
// Source: STACK.md §Date Handling + D-13/14; @date-fns/tz README
import { tzOffset } from '@date-fns/tz';

export function detectExclusion(input: {
  ianaZone: string;                  // resolved once at sync start
  cycle: { start: string; end: string | null; timezone_offset: string };
  priorCycle: { timezone_offset: string } | null;
}): { baseline_excluded: boolean; exclusion_reason: 'dst_straddle' | 'tz_drift' | null } {
  // Rule 1: dst_straddle
  if (input.cycle.end !== null) {
    const startOffset = tzOffset(input.ianaZone, new Date(input.cycle.start));
    const endOffset = tzOffset(input.ianaZone, new Date(input.cycle.end));
    if (startOffset !== endOffset) return { baseline_excluded: true, exclusion_reason: 'dst_straddle' };
  }
  // Rule 2: tz_drift
  if (input.priorCycle !== null && input.cycle.timezone_offset !== input.priorCycle.timezone_offset) {
    return { baseline_excluded: true, exclusion_reason: 'tz_drift' };
  }
  return { baseline_excluded: false, exclusion_reason: null };
}
```

### Pattern 6: Sync Orchestration — Sequential Across Resources (D-23 + D-24 + D-25)
**What:** `services/sync/index.ts` walks the 6 resources in order. Each resource is its own try/catch — a 429 on workouts does NOT block cycles. Per-resource outcomes recorded in `sync_runs.per_resource`. Status finalized to `ok` | `partial` | `failed`.
**Skeleton:**
```typescript
// Source: D-23 + D-24 + D-25; ARCHITECTURE.md §Flow A
const RESOURCES = ['profile', 'body_measurements', 'cycles', 'recoveries', 'sleeps', 'workouts'] as const;

export async function runSync(opts: RunSyncInput): Promise<RunSyncResult> {
  const syncRunId = await deps.repos.syncRuns.insertRunning();
  const perResource: Record<typeof RESOURCES[number], ResourceSyncOutcome> = {} as any;

  for (const resource of opts.resources ?? RESOURCES) {
    try {
      const cursor = await deps.repos[resource].cursor();                  // MAX(updated_at)
      const since = computeSince(cursor, opts, deps.clock());               // min(cursor, now()-7d) | --days | --since
      const result = await deps.whoop.resources[resource].listAll({since});
      const upsert = await deps.repos[resource].upsertBatch(result.rows);   // BEGIN IMMEDIATE inside
      perResource[resource] = { status: 'success', fetched: result.rows.length, upserted: upsert.changed };
    } catch (err) {
      perResource[resource] = classifyOutcome(err);                         // 'partial_429' | 'partial_5xx' | etc.
    }
  }

  const status = computeStatus(perResource);                                // 'ok' | 'partial' | 'failed'
  await deps.repos.syncRuns.finalize(syncRunId, status, perResource);
  if (status === 'ok' || status === 'partial') deps.sqlite.pragma('wal_checkpoint(TRUNCATE)');
  return { status, perResource, syncRunId, /* ... */ };
}
```

### Pattern 7: Pagination Utility — snake↔camel + Dup-ID Assertion (D-19 + Pitfall 10)
**What:** Single `paginateAll<T>` in `src/infrastructure/whoop/pagination.ts`. Owns the asymmetric translation: response is `next_token` (snake), request param is `nextToken` (camel). Asserts no duplicate WHOOP IDs across consecutive pages — signals mid-pagination re-ordering as a loud `WhoopApiError({kind: 'validation'})`.
**Verified shape:**
- Response field: `next_token` [CITED: developer.whoop.com/docs/developing/pagination/]
- Request param: `nextToken` [CITED: developer.whoop.com/docs/developing/pagination/]
- Empty `next_token` (null or absent) signals end of pages.

```typescript
// Source: §Technical Research item 4 (verified WHOOP docs) + D-19
export interface WhoopPage<T> { records: T[]; next_token: string | null }

export async function paginateAll<T extends { id: string | number }>(
  fetchPage: (nextToken: string | null) => Promise<WhoopPage<T>>,
): Promise<T[]> {
  const all: T[] = [];
  const seenIds = new Set<string>();
  let nextToken: string | null = null;
  do {
    const page = await fetchPage(nextToken);
    for (const row of page.records) {
      const key = String(row.id);
      if (seenIds.has(key)) {
        throw new WhoopApiError({
          kind: 'validation',
          detail: `duplicate id ${key} across consecutive pages (signals mid-pagination reordering)`,
        });
      }
      seenIds.add(key);
      all.push(row);
    }
    nextToken = page.next_token;
  } while (nextToken !== null);
  return all;
}
```

### Pattern 8: Rate-Limit Semaphore + 429 Backoff (D-20 + Pitfall 11)
**What:** Module-level semaphore-of-4 in `src/infrastructure/whoop/rate-limit.ts`. Every `httpGet` acquires + releases. After each response, read `X-RateLimit-Remaining`; if `< 10`, delay the next acquire. On 429, sleep `X-RateLimit-Reset` SECONDS (per verified WHOOP docs — delta seconds, NOT epoch).
**Verified headers (case-sensitive):** [CITED: developer.whoop.com/docs/developing/rate-limiting/]
- `X-RateLimit-Limit` — "current rate-limit values and their time windows" (e.g., `window=60`)
- `X-RateLimit-Remaining` — "number of requests available before hitting the limit"
- `X-RateLimit-Reset` — **delta seconds** until window resets (NOT epoch)
- No `Retry-After` header documented.
- Documented budgets: **100 req/min** and **10,000 req/day**.

```typescript
// Source: §Technical Research item 5 (verified)
const SEMAPHORE_SIZE = 4;
const REMAINING_THROTTLE_THRESHOLD = 10;

let pending: Array<() => void> = [];
let inFlight = 0;

export async function acquire(): Promise<void> { /* classic semaphore */ }
export function release(remainingHeader: string | null): void {
  const remaining = remainingHeader === null ? null : Number(remainingHeader);
  if (remaining !== null && remaining < REMAINING_THROTTLE_THRESHOLD) {
    // delay the next acquire by some jitter to give the window time to reset
    setTimeout(actuallyRelease, 250 + Math.random() * 250);
  } else {
    actuallyRelease();
  }
}
// retry.ts on 429:
//   const resetSec = Number(res.headers.get('X-RateLimit-Reset') ?? '1');
//   await sleep(resetSec * 1000 + jitter());
//   retry once (capped attempts).
```

### Pattern 9: Cursor + 7-day Re-Window (D-09 + D-10)
**What:** `services/sync/cursor.ts` derives `{since, until}` from clock + flags + per-resource cursor. Pure function — fully unit-testable.
**Cursor query:** `SELECT COALESCE(MAX(updated_at), '1970-01-01T00:00:00Z') FROM <table>`. SQLite's `MAX()` ignores NULL inputs and returns NULL on empty table; the `COALESCE` fallback means an empty/all-NULL state falls back to "fetch everything."

**Edge case (verified against §Technical Research item 1 below):** WHOOP v2 endpoints do NOT accept `updated_since` (or any `since`-on-update variant). The endpoints accept `start` and `end` filters on the cycle/recovery/sleep/workout `start` time. So:

```typescript
// Source: D-09, D-10, D-12 (now resolved); §Technical Research item 1
export function computeWindow(opts: {
  cursor: string;                  // MAX(updated_at) coalesced to epoch-zero
  clock: Date;
  flagSinceISO?: string | null;    // --since
  flagDaysN?: number | null;       // --days N
}): { since: string; until: string } {
  const now = opts.clock;
  if (opts.flagSinceISO) return { since: opts.flagSinceISO, until: now.toISOString() };
  if (opts.flagDaysN) {
    const since = new Date(now.getTime() - opts.flagDaysN * 86_400_000).toISOString();
    return { since, until: now.toISOString() };
  }
  // Default: min(cursor, now() - 7d)
  const sevenDaysAgo = new Date(now.getTime() - 7 * 86_400_000).toISOString();
  const since = opts.cursor < sevenDaysAgo ? opts.cursor : sevenDaysAgo;
  return { since, until: now.toISOString() };
}
```

**HTTP query plumbing:** The resource module passes `start=<since>&end=<until>` to WHOOP (NOT `updated_since`). After fetching the full page, the upsert is keyed on `id` with `ON CONFLICT(id) DO UPDATE` so a record whose `start` is older than `since` but whose `updated_at` is newer (retroactive update inside the 7-day window) still lands correctly. **The 7-day re-window is what catches retroactive updates** — exactly the D-10 intent.

### Pattern 10: MSW per-Resource Helpers (D-15, ADR-0006, conventions.md §Testing)
**What:** One helper file per resource under `tests/helpers/msw-whoop-<resource>.ts`, mirroring Plan 02-01's `msw-whoop-oauth.ts`. Each is a thin wrapper around `http.get` returning fixture JSON from `tests/fixtures/whoop/<resource>/<scenario>.json`. One-shot override hooks for 429 / 5xx scenarios per Plan 02-01's `setNextResponse` precedent.

```typescript
// Source: tests/helpers/msw-whoop-oauth.ts (existing) + conventions.md §Testing
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';

export function createWhoopCyclesHelper() {
  let hitCount = 0;
  let nextResponse: { body: unknown; status: number; headers?: Record<string, string> } | null = null;
  // Per-scenario fixture loader: tests pass scenario name; helper reads from disk on each request.
  const handler = http.get('https://api.prod.whoop.com/v2/cycle', ({ request }) => {
    hitCount += 1;
    if (nextResponse !== null) {
      const r = nextResponse;
      nextResponse = null;
      return HttpResponse.json(r.body, { status: r.status, headers: r.headers });
    }
    const url = new URL(request.url);
    const scenarioFromQuery = url.searchParams.get('__test_scenario') ?? '200-ok';
    const fixture = readFixture(`whoop/cycles/${scenarioFromQuery}.json`);
    return HttpResponse.json(fixture, {
      headers: {
        'X-RateLimit-Remaining': '95',
        'X-RateLimit-Reset': '60',
        'X-RateLimit-Limit': 'window=60',
      },
    });
  });

  return {
    server: setupServer(handler),
    getHitCount: () => hitCount,
    setNextResponse: (body: unknown, status = 200, headers?: Record<string, string>) => {
      nextResponse = { body, status, headers };
    },
  };
}
```

### Anti-Patterns to Avoid

- **ARCHITECTURE.md Anti-Pattern 3 — Drizzle row types in domain or services.** Repositories return domain entity types; `domain/` and `services/` never import from `drizzle-orm/*`. **Enforced by new CI Gate G** (no `drizzle-orm/` import outside `src/infrastructure/db/`).
- **ARCHITECTURE.md Anti-Pattern 7 — `drizzle-kit push`.** FORBIDDEN outside throwaway dev experimentation. Always `drizzle-kit generate` + commit + run hand-rolled migrator at startup.
- **PITFALLS.md Pitfall 13 — `BEGIN DEFERRED` for writes.** Deferred transactions can upgrade mid-flight and defeat `busy_timeout`. Writes use `BEGIN IMMEDIATE`; reads use the default (`BEGIN DEFERRED`).
- **PITFALLS.md Pitfall 7 — Migration without backup.** Pre-migration backup is the cheap insurance; D-07 keeps last 3 at `chmod 600`. Never depend on the user's filesystem snapshot.
- **PITFALLS.md Pitfall 15 — Webhooks.** Not in v1 by decision. Polling + `updated_at` deltas + 7-day re-window is the v1 contract.
- **PITFALLS.md Pitfall 16 — JSON-blob-only storage.** Hybrid model only; normalized hot-path columns + `raw_json` for forward compat.
- **`console.*` inside `src/infrastructure/whoop/` or `src/services/`.** ADR-0001. Pino → stderr exclusively. Existing Gate B catches this.
- **`fetch(` outside the WHOOP boundary modules.** Enforced by new Gate F — only `src/infrastructure/whoop/client.ts`, `src/infrastructure/whoop/token-store.ts`, and `src/infrastructure/whoop/oauth.ts` may call `fetch`.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| OAuth refresh + retry | Custom 401 handler in `client.ts` | Wrap operation via existing `callWithAuth` from `src/services/refresh-orchestrator.ts` (Plan 02-04) | Phase 2 already locked the single-flight chokepoint; bypassing it burns the token family per Pitfall 2 + ADR-0002 |
| Pagination cursor handling | Per-resource loop with hardcoded next_token | One `paginateAll<T>` utility (Pattern 7) | Snake↔camel asymmetry + duplicate-ID assertion (Pitfall 10) belongs in one place |
| Rate-limit semaphore | `Promise.all(...)` with no cap | Module-level semaphore-of-4 (Pattern 8) | `Promise.all` over 200 cycles will hit the 100 req/min limit in seconds (Pitfall 11) |
| 429 retry | Fixed exponential backoff | Sleep `X-RateLimit-Reset` seconds, then exponential thereafter (Pattern 8) | WHOOP documents Reset; fixed backoff burns extra quota (Pitfall 11) |
| Migration runner | `drizzle-orm/better-sqlite3/migrator` default | Hand-rolled `BEGIN IMMEDIATE` wrapper (Pattern 3) | Default uses `BEGIN` (DEFERRED) per Pitfall 13 — locked by D-06 |
| Pre-migration backup | `cp db.sqlite db.bak` | `copyFileSync` on `.sqlite` + `-wal` + `-shm` together (Pattern 3 + D-07) | A backup of just `.sqlite` without `-wal`/`-shm` is corrupted (Pitfall 7) |
| Connection pool | Multi-handle pool | Single synchronous `better-sqlite3` handle | better-sqlite3 is synchronous; the JS event loop serializes writes within a process; WAL handles inter-process (ARCHITECTURE.md §Concurrency) |
| DST/tz detection | Hand-rolled timezone math | `@date-fns/tz` `tzOffset()` (Pattern 5) | Cross-DST arithmetic is the textbook calendar bug (Pitfall 6) |
| Idempotent upserts | `INSERT OR REPLACE` (loses non-mapped columns) | `INSERT … ON CONFLICT(id) DO UPDATE SET <col> = excluded.<col>` (Pitfall 10 + D-11) | `INSERT OR REPLACE` rewrites the whole row including columns the new payload doesn't carry; `ON CONFLICT(id) DO UPDATE` is column-selective |
| Cursor table | Separate `sync_cursors` table | `MAX(updated_at) FROM <table>` (Pattern 9 + D-09) | One fewer surface to migrate; the resource table itself is the source of truth |
| MSW server-per-test | Global MSW setup | One helper per resource with `setupServer()` lifecycle owned by the test file (Pattern 10) | Mirrors `msw-whoop-oauth.ts`; per-call counter resettable per test |
| Sanitizer extension for new error shapes | New regex patterns | Phase 1 sanitizer already covers WHOOP shapes (D-34) | Plan 01-04 (4 D-07 patterns) + Plan 02-07 (`code=` + `client_secret`) already cover every Authorization/Bearer/code-grant/token-key/JWT pattern Phase 3 produces |

**Key insight:** Phase 3 is mostly composition over Phase 1/2 chokepoints. Hand-rolling at the boundary (HTTP client, migrator) is intentional and lives in one named file each; hand-rolling inside that boundary (custom retry, custom pagination) is anti-pattern. Plan 02-04's orchestrator and Plan 02-06's Gate E are load-bearing — bypassing them is the failure mode the CI grep gates protect against.

## Runtime State Inventory

Phase 3 is a **greenfield** phase with respect to runtime state (no rename, no refactor). Categories below are filled with explicit "None" so the planner knows nothing was skipped.

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | None — Phase 3 is the first phase to write to `~/.recovery-ledger/db.sqlite`; no prior schema exists | Initial migration creates all 9 tables |
| Live service config | None — no external service registrations carry phase-specific strings | No action |
| OS-registered state | None — Phase 3 does not register launchd/systemd/cron (deferred to Phase 5 docs) | No action |
| Secrets / env vars | None new — `WHOOP_CLIENT_ID` + `WHOOP_CLIENT_SECRET` consumed unchanged from Phase 2; no new env vars in Phase 3 per D-27 | No action |
| Build artifacts | tsup must learn new entries if MCP shim arrives (Phase 4, not Phase 3); Phase 3 ships new files all under existing `src/cli/index.ts` and `src/mcp/index.ts` entry points already declared in `tsup.config.ts`. NEW: `dist/infrastructure/db/migrate.mjs` is NOT needed as a top-level entry — the migrator is imported by `services/bootstrap.ts` which is reachable from `dist/cli.mjs` and `dist/mcp.mjs`. Plan 02-08's `dist/infrastructure/whoop/token-store.mjs` precedent is the model: only add an explicit tsup entry if a test or external consumer needs to import the compiled module directly. Phase 3 does not need one. | None — no tsup change needed |

**Conclusion:** No runtime-state migration tasks required. The phase ships fresh tables, fresh files, fresh fixtures.

## Common Pitfalls

### Pitfall A: Phase-3-specific — Drizzle row types leak into services
**What goes wrong:** A service or domain file does `import { cyclesTable } from '../infrastructure/db/schema.js'` and uses `cyclesTable.$inferSelect` as a function signature. Now the domain math is coupled to the DB schema; renaming a column breaks pure functions.
**Why it happens:** Drizzle types are convenient and the import is short.
**How to avoid:** Enforce ARCHITECTURE.md Anti-Pattern 3 via new **Gate G**: no `drizzle-orm/*` import outside `src/infrastructure/db/`. Repositories return `Cycle`, `Recovery`, etc. from `domain/types/entities.ts`. Map at the repository boundary.
**Warning signs:** Any TS error mentioning `$inferSelect` outside `infrastructure/db/`. CI Gate G fails.

### Pitfall B: Phase-3-specific — `fetch(` slips outside the WHOOP boundary modules
**What goes wrong:** A future helper or test calls `fetch('https://api.prod.whoop.com/v2/cycle')` directly, bypassing `httpGet` and therefore bypassing `callWithAuth`, the rate-limit semaphore, retry, and Zod validation.
**How to avoid:** New **Gate F** — no `fetch(` outside `src/infrastructure/whoop/client.ts`, `src/infrastructure/whoop/token-store.ts`, `src/infrastructure/whoop/oauth.ts`. Test files exempt (mirrors Gate E's pattern).
**Warning signs:** Gate F failure.

### Pitfall C: Migration crashes between statements leave inconsistent `__drizzle_migrations`
**Verbatim from PITFALLS.md Pitfall 7.**
**How to avoid (D-06 + D-07 + D-08):** Wrap each migration in `BEGIN IMMEDIATE`; back up `.sqlite`/`-wal`/`-shm` before; on inconsistent state, throw `MigrationError({kind: 'inconsistent_state', backupPath})` and let the user restore manually with `cp <backupPath> ~/.recovery-ledger/db.sqlite`.
**Verification anchor:** `tests/integration/sync/migration-crash.test.ts` — kill the process mid-migration with `SIGKILL`, verify backup restores cleanly.

### Pitfall D: WAL file grows unboundedly (Pitfall 12)
**How to avoid (D-30 + D-32):** `journal_size_limit = 67108864` + `wal_autocheckpoint = 1000` on every connection; explicit `wal_checkpoint(TRUNCATE)` after every successful/partial sync.
**Verification anchor:** `tests/integration/sync/pragma-roundtrip.test.ts` — after openDb, `PRAGMA journal_mode` returns 'wal'; after a fixture sync, `PRAGMA wal_checkpoint(TRUNCATE)` returns `(0, X, X)` and `db.sqlite-wal` file size goes to zero.

### Pitfall E: Token leakage through `WhoopApiError.cause` (Pitfall 17)
**What goes wrong:** A WHOOP 401 wraps the failed fetch Request in `cause`, which includes `Authorization: Bearer …`. The MCP error path serializes it, the model sees the token.
**How to avoid:** D-34 attestation — `src/mcp/sanitize.ts` is UNMODIFIED. Phase 1's 4 D-07 patterns + Plan 02-07's `code=` + `client_secret` patterns already redact every shape Phase 3 produces. New `WhoopApiError` kinds flow through the existing sanitizer pipeline via `register.ts`'s try/catch wrapper.
**Verification anchor:** integration test that induces a 401 and asserts `grep -E '(Bearer|access_token=)' <stderr-capture> == 0`.

### Pitfall F: Concurrent CLI sync + MCP read = SQLITE_BUSY (Pitfall 13)
**How to avoid (D-31):** All write transactions use `BEGIN IMMEDIATE`. Reads use the default (`BEGIN DEFERRED`). `busy_timeout=5000` covers contention bursts. Keep write transactions short — one resource batch per `BEGIN IMMEDIATE`.
**Verification anchor:** integration test runs sync + a separate read (e.g., repository.byRange) concurrently and asserts neither fails.

### Pitfall G: PENDING_SCORE records silently masquerade as SCORED (Pitfall 3 + ADR-0003)
**How to avoid (D-03 + D-04 + D-05):** Discriminated union enforced at the type system; default repo filter is `WHERE score_state = 'SCORED'`; index `(score_state, start)` makes the filter cheap.
**Verification anchor:** contract test loads `tests/fixtures/whoop/recovery/200-mixed-score-states.json`, runs sync, asserts: (a) all 3 rows are upserted, (b) `repositories.recovery.byRange()` with default opts returns only the SCORED row, (c) with `{includeUnscored: true}` returns all 3.

### Pitfall H: DST/tz cycles pollute baselines (Pitfall 6 + DATA-06)
**How to avoid (D-13 + D-14 + D-15 + D-16):** Two-rule OR'd detection at upsert time; `baseline_excluded INTEGER NOT NULL DEFAULT 0` + `exclusion_reason TEXT` on cycles; recovery/sleep/workouts inherit via `cycle_id` at query time.
**Verification anchor:** contract test loads `tests/fixtures/whoop/cycles/200-dst-spring-forward.json` → cycle is flagged `baseline_excluded=1, exclusion_reason='dst_straddle'`. Same for fall-back and SFO→JFK fixtures.

### Pitfall I: Re-flag stops working after retroactive WHOOP updates
**What goes wrong:** WHOOP retroactively shifts a cycle's `start` past a DST boundary on the next sync. If `baseline_excluded` is computed only once (at first insert), the re-flag never fires.
**How to avoid (D-14 + D-11):** `baseline_excluded` is computed at every upsert — the cycle's current `start`, `end`, and `timezone_offset` drive the detection, not cached state. The `ON CONFLICT(id) DO UPDATE SET <all-cols-except-id>` clause includes `baseline_excluded` and `exclusion_reason` columns, so a retroactive update re-flags on the spot.
**Verification anchor:** integration test does two passes — pass 1 inserts a non-DST cycle, pass 2 returns the same cycle with a shifted `start` straddling a DST boundary, asserts `baseline_excluded` flipped from 0 to 1.

## Code Examples

### Plumbing `callWithAuth` inside `httpGet` (D-18)

```typescript
// Source: existing src/services/refresh-orchestrator.ts + D-18
// PRESERVES Plan 02-06 Gate E: only token-store.ts may reference 'oauth/oauth2/token'.
// The orchestrator's contract: callWithAuth(operation) where operation accepts
// the access token and returns Promise<{status: number, ...}>. The orchestrator
// only inspects res.status to decide retry.
import { callWithAuth } from '../../services/refresh-orchestrator.js';
import { acquire, release } from './rate-limit.js';

export async function httpGet<T>(
  path: string,
  query: Record<string, string | number | undefined>,
  schema: z.ZodSchema<T>,
): Promise<T> {
  await acquire();                                  // semaphore-of-4
  try {
    const url = buildUrl(path, query);
    const res = await callWithAuth(async (accessToken) => {
      // The orchestrator handles 401 → re-read tokens → force refresh → retry once.
      return fetch(url, {
        method: 'GET',
        headers: { Authorization: `Bearer ${accessToken}` },
      });
    });
    // 429 / 5xx handled by retry.ts wrapping this fetch (composed in client.ts);
    // here we only handle the success / final-failure shapes.
    if (!res.ok) {
      throw classifyError(res);                     // → WhoopApiError({kind: ...})
    }
    const json = await res.json();
    return schema.parse(json);                      // Zod validation at the boundary
  } finally {
    // ESLint: pass X-RateLimit-Remaining so release() can throttle the next acquire
    release(/* peek headers from the last response */);
  }
}
```

### `paginateAll` consumer in cycles.ts

```typescript
// Source: D-19 + verified snake/camel asymmetry [CITED: WHOOP pagination docs]
const CYCLES_PAGE_SIZE = 25;                        // verified max per §Technical Research item 2

export async function listCycles(opts: { since: string; until: string }): Promise<Cycle[]> {
  const rows = await paginateAll(async (nextToken) => {
    const page = await httpGet(
      '/v2/cycle',
      {
        start: opts.since,
        end: opts.until,
        limit: CYCLES_PAGE_SIZE,
        nextToken: nextToken ?? undefined,           // omit if null on first call
      },
      WhoopCyclesPageSchema,                         // Zod schema for the page shape
    );
    return page;
  });
  return rows.map(normalizeCycle);                  // domain entity mapping
}
```

### Migrator retention cleanup (D-07)

```typescript
// Source: D-07 — keep 3 most-recent backups, delete the rest including -wal/-shm companions
import { readdirSync, statSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';

function pruneBackups(backupsDir: string, keep = 3): void {
  const files = readdirSync(backupsDir)
    .filter((name) => name.endsWith('.sqlite'))     // primary backup files only
    .map((name) => ({ name, mtime: statSync(join(backupsDir, name)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime);             // newest first
  for (const { name } of files.slice(keep)) {
    const base = name.slice(0, -'.sqlite'.length);
    for (const suffix of ['.sqlite', '.sqlite-wal', '.sqlite-shm']) {
      const path = join(backupsDir, base + suffix);
      try { unlinkSync(path); } catch { /* missing companion is fine */ }
    }
  }
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| WHOOP API v1 (integer IDs, `/v1/` paths, webhooks) | WHOOP API v2 (UUID IDs for Sleep/Workout, `int64` for Cycle, `/v2/` paths, polling only) | v2 GA July 2025; v1 retired EOL late 2025 [CITED: developer.whoop.com/docs/developing/v1-v2-migration/] | Cycle id stays `integer` in schema; Sleep / Workout ids are `text` (UUID). Both types coexist in v2; do not coerce both to one type. |
| Drizzle 1.0-rc | Drizzle stable line (0.45.x + drizzle-kit 0.31.x) | 1.0 still in RC.2 as of 2026-05-11; STACK.md pins 0.45.x [CITED: STACK.md] | No 1.0-mixing; planner must not bump majors |
| `keytar` | `@napi-rs/keyring` | keytar archived 2022-12; Phase 2 already on @napi-rs/keyring 1.3.0 | UNCHANGED in Phase 3 — tokens stay in keyring/file per D-02 |
| Drizzle default `migrate()` from `drizzle-orm/better-sqlite3/migrator` | Hand-rolled `BEGIN IMMEDIATE` wrapper in `src/infrastructure/db/migrate.ts` | D-06 locks this; Pitfall 13 explains why | Phase 3 deliberately uses Drizzle Kit for *generation* (`drizzle-kit generate` produces SQL + `meta/_journal.json`) but a hand-rolled runtime wrapper for *application* |

**Deprecated/outdated:**
- WHOOP API v1 — superseded by v2 [CITED: developer.whoop.com/docs/api-changelog/]; webhooks were removed (Pitfall 15)
- `drizzle-kit push` — forbidden outside dev (Anti-Pattern 7)
- `BEGIN DEFERRED` for write transactions — banned by Pitfall 13 + D-31

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `drizzle-kit generate@^0.31.10` produces a `meta/_journal.json` and `meta/<idx>_snapshot.json` structure [CITED: deepwiki + community examples] | Pattern 3 | Hand-rolled migrator's pending-list reader would need to scan SQL files by glob instead of reading `_journal.json`. Mitigation: Wave 0 includes a manual `drizzle-kit generate` smoke run to verify file structure before locking the migrator code. Low risk — multiple community sources confirm. |
| A2 | `__drizzle_migrations` table columns are `id INTEGER PRIMARY KEY AUTOINCREMENT`, `hash TEXT`, `created_at NUMERIC` [CITED: deepwiki.com/drizzle-team/drizzle-orm/3.2-migration-system] | Pattern 3 | The hand-rolled wrapper's `CREATE TABLE IF NOT EXISTS __drizzle_migrations` clause must match Drizzle Kit's expected shape exactly; a mismatch could cause Drizzle Kit's downstream tooling to disagree about applied state. Mitigation: keep the `CREATE TABLE IF NOT EXISTS` payload byte-for-byte identical to what Drizzle generates by reading from a freshly-generated migration. |
| A3 | The page-size max is **25** across all 4 list endpoints (cycles, recovery, sleep, workouts) [CITED: developer.whoop.com/api — verified 2026-05-16] | §Technical Research item 2 | If a single endpoint allows a higher limit, backfill latency on `--days 365` is suboptimal but correct. Mitigation: ship 25 as the constant; revisit if backfill perf becomes a complaint. |
| A4 | Profile (`/v2/user/profile/basic`) and body_measurements (`/v2/user/measurement/body`) are single-record GETs with no pagination [CITED: developer.whoop.com/api — verified 2026-05-16] | §Technical Research item 3 | If body_measurements is actually paginated (history), the sync would miss older measurements. Mitigation: WHOOP doc verification was explicit — these endpoints DO NOT accept query parameters. If a future user reports missing history, treat as a separate gap-to-API issue. **Note:** D-01 calls body_measurements a "history" table — but WHOOP returns one record. The planner should reconcile this: schema is a history table; the sync writes one row per fetch; gap detection is "did the row change vs prior sync"? |
| A5 | `X-RateLimit-Reset` returns **delta seconds** (NOT epoch seconds) [CITED: developer.whoop.com/docs/developing/rate-limiting/] | §Technical Research item 5 | If actually epoch seconds, `await sleep(resetSec * 1000)` would sleep ~1.7 billion ms (∞). Mitigation: sleep is capped at 60s ceiling regardless of header value, defending against this and any header drift. |
| A6 | Cycle id is `int64` (integer) but Sleep + Workout ids are UUIDs in v2 [CITED: developer.whoop.com/docs/developing/v1-v2-migration/ + verified per-resource docs] | Pattern 2 schema | Mixing integer and UUID PKs across tables is mildly awkward but matches the wire format. Mitigation: schema declares `cycles.id` as `integer` and `sleeps.id` / `workouts.id` / `recoveries.sleep_id` as `text`. The `recoveries` table is keyed by `(cycle_id, sleep_id)` per the WHOOP shape — sleep_id is the UUID, cycle_id is the int64 FK. |
| A7 | Phase 1 + Phase 2 sanitizer patterns cover every shape `WhoopApiError` produces (D-34 attestation) | Pitfall E + §Common Pitfalls | If a new WHOOP error format embeds tokens in a shape Phase 1/2 patterns don't match, tokens could leak through MCP. Mitigation: induced-401 grep test asserts `grep -E '(Bearer|access_token=)' <stderr-capture> == 0`. If a new shape surfaces, treat as a Plan-3-N regression and extend sanitize.ts under a deliberate revision; D-34 attestation moves to "extended" with a documented exception. |
| A8 | better-sqlite3 `db.exec()` is multi-statement-aware and works for the entire Drizzle-generated `.sql` payload [CITED: github.com/WiseLibs/better-sqlite3/blob/master/docs/api.md] | Pattern 3 | If a generated migration contains a statement type `db.exec` doesn't accept (highly unlikely for plain DDL), the migrator throws. Mitigation: covered by `tests/integration/sync/migration-crash.test.ts` which exercises the full migrator against a real Drizzle-generated SQL file. |
| A9 | The pre-migration backup retention of 3 is sufficient (D-07). | Pattern 3 | If a user runs multiple destructive migrations in quick succession and the pre-failure backup gets rotated out before the user notices, recovery is gone. Mitigation: this is a single-user personal tool; Chris running 3 migrations between sessions is unlikely. Retention can be tuned post-v1 if a real failure shows it's too tight. |
| A10 | Drizzle's `--> statement-breakpoint` markers are safe to treat as comments and execute the whole `.sql` file as one transaction (D-06). [CITED: Drizzle migrations docs + Pitfall 7] | Pattern 3 | If Drizzle generates a payload where a `--> statement-breakpoint` separates statements that MUST be in separate transactions (e.g., a CREATE INDEX after a CREATE TABLE inside a single multi-statement file), the wrapper's "one BEGIN IMMEDIATE per file" approach holds — SQLite supports indexes inside a transaction. The pattern's only risk is a future Drizzle Kit feature that emits a non-transactional statement (e.g., `VACUUM`). Mitigation: Wave 0 generates the first migration and inspects the output; if a non-transactional statement appears, document it and split. |
| A11 | The `meta/_journal.json` order (entries array) is the canonical pending-list order. [CITED: Migration system community refs] | Pattern 3 | If a journal entry's order disagrees with filesystem mtime, the wrapper applies in journal order. This matches Drizzle's own behavior. |
| A12 | `recoveries` has no independent primary key — it's keyed by `(cycle_id, sleep_id)` in WHOOP v2 [CITED: verified recovery doc] | Pattern 2 schema | If a recovery exists without a sleep_id (impossible per shape), the PK would fail. Mitigation: schema uses a compound primary key; integration test against `200-mixed-score-states.json` covers the path. |

> **These assumptions need confirmation only where flagged.** A1, A2, A11 will surface during Wave 0 when `drizzle-kit generate` runs against the schema for the first time — discrepancies are caught at that moment and the migrator code is adjusted before any plan locks. The WHOOP-doc citations (A3, A4, A5, A6) were verified live against `developer.whoop.com` on 2026-05-16 and are HIGH confidence.

## Open Questions

1. **`daily_summaries` table empty in Phase 3 — does the schema commit happen now, or in Phase 4?**
   - What we know: D-01 lists `daily_summaries` as one of the 9 v1 tables; Deferred Ideas says "Phase 3 creates the table empty; Phase 4 baseline service writes to it."
   - What's unclear: should Phase 3's initial migration include the `daily_summaries` schema (likely yes — one fewer migration in Phase 4) or defer the table altogether to a Phase 4 migration?
   - Recommendation: include `daily_summaries` in Phase 3's initial migration with whatever shape is reasonable to infer from REQ REV-01 (date PK + per-metric aggregated columns). Phase 4 can `ALTER` if needed; ARCHITECTURE.md §Scaling priorities #2 supports the table existing early.

2. **`decisions` table — Phase 3 creates the table; Phase 4 owns the CLI/MCP surface.**
   - What we know: D-01 lists `decisions` as one of the 9 tables; DEC-01/02/03/04 are all Phase 4 requirements.
   - What's unclear: should Phase 3 ship `decisions.repo.ts` as an empty stub, or skip it entirely until Phase 4?
   - Recommendation: ship a minimal `decisions.repo.ts` with `insert`, `byId`, `listOpen` — Phase 4's CLI/MCP surface is then a thin wrapper. Keeps Phase 4 plans focused on the math + review surface, not repository plumbing.

3. **`body_measurements` is described as "history" by D-01 but the endpoint returns a single record per call.**
   - What we know: `/v2/user/measurement/body` is a single GET (no pagination, no query params per verified docs).
   - What's unclear: D-01 calls it a "history table — one row per WHOOP-returned measurement." But each sync returns the same record — the WHOOP-current measurement. How does the history accumulate?
   - Recommendation: append-on-change. On each sync, if the fetched measurement differs (height/weight/max_hr) from the most-recent row, insert a new row keyed by `(user_id, captured_at = response.created_at)`. If identical, no-op. Surface as a Phase 3 sub-decision (D-35?) or document explicitly in the schema PR. Pitfall: WHOOP's response may not carry a stable `captured_at` for body measurements; if so, use sync-time epoch as the row key with deduplication on the (height, weight, max_hr) tuple.

4. **MCP attestation enforcement for `tools/list` count = 1.**
   - What we know: D-33 says no new MCP tools in Phase 3; Plan 02-08 G-03 already asserts `tools.length === 1` at runtime.
   - What's unclear: Phase 3 may extend `src/services/index.ts` to expose `runSync`. Does that break G-03?
   - Recommendation: G-03 asserts on the MCP `tools/list` response, not on the Services interface. Adding `runSync` to the services barrel does not register a tool — only `src/mcp/tools/<name>.ts` + a `register()` call does. G-03 stays green.

5. **`drizzle.config.ts` location.**
   - What we know: tsup, vitest, biome configs all live at repo root.
   - What's unclear: by convention `drizzle.config.ts` lives at repo root too; verify Drizzle Kit reads from there.
   - Recommendation: repo root. Path inside the config points at `./src/infrastructure/db/schema.ts` and `./src/infrastructure/db/migrations/`.

6. **Plan 02-04's `FetchLikeResponse` is `{status: number}` — does Phase 3 need more from the response?**
   - What we know: refresh-orchestrator.ts only inspects `.status`. After the orchestrator returns, the caller (Phase 3's `httpGet`) has full access to the Response.
   - What's unclear: where do we read response headers (X-RateLimit-Remaining, X-RateLimit-Reset) — inside the callWithAuth operation closure, or after the orchestrator returns?
   - Recommendation: read headers inside the closure (just before returning the response to the orchestrator). Stash on a per-call mutable that the outer `httpGet` reads to feed `release(remainingHeader)`. Or, simpler: have the operation closure return `{response, headers}` and reshape `FetchLikeResponse` minimally to expose what the orchestrator needs. **Simplest concrete shape:** the operation closure returns the raw `Response`; Phase 3's `httpGet` reads headers from the returned object after `callWithAuth` returns. The orchestrator only ever inspected `.status`, so passing through full `Response` is compatible with the existing contract.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node 22 LTS | Everything | ✓ (existing CI matrix `[macos-latest, ubuntu-latest]`) | per `.nvmrc` (>=22.11) | — |
| `better-sqlite3` prebuilt binary | DB layer | ✓ on macOS + Linux (Node 22 prebuilds shipped) [VERIFIED: STACK.md §Version Compatibility] | 12.9.0 | `npm rebuild` postinstall if ABI mismatch (Pitfall 20) |
| `@napi-rs/keyring` (Phase 2) | Token store | ✓ on macOS keychain; falls back on Linux when libsecret missing | 1.3.0 | File at `chmod 600` per AUTH-03 (Phase 2 already implements) |
| WHOOP API access | Live integration (NOT default test) | n/a in CI by design — ADR-0006 forbids live calls | — | MSW fixtures (Pattern 10) |
| MSW@2 (already installed) | Per-resource handlers | ✓ | 2.14.6 | — |
| Internet (for live `npm install` of new deps in Wave 0) | Only at install time, NEVER for tests | n/a in test run | — | If the new install fails, `package-lock.json` already pins; rerun `npm ci` |

**Missing dependencies with no fallback:** none.
**Missing dependencies with fallback:** none — everything is on-disk or has a documented fallback already wired by Phase 2.

## Wave Dependency Analysis

> Build order maps roughly to ARCHITECTURE.md §Build Order steps 1-9 (paths → types → db → repos → whoop client → resources → normalize → sync service). Each wave is independently testable; same-wave plans MUST NOT share files (or share files only with a documented file-overlap policy mirroring Phase 2 Plan 02-01's Wave-0 pattern).

**Wave 0 — Infrastructure precondition (single plan; all subsequent waves depend on it).**
Lands the install + the new file roots so subsequent waves don't all race the same `package.json`. Files: extend `package.json` (3 new prod deps + 2 new dev deps), `drizzle.config.ts` (new), extend `src/infrastructure/config/paths.ts` (add `dbFile`, `dbWalFile`, `dbShmFile`, `backupsDir`, `migrationsDir` to `ResolvedPaths`), extend `scripts/ci-grep-gates.sh` (Gate F + Gate G — but the rules grep only inside `src/`, which is empty for the new boundary modules at this point, so the gates pass trivially until later waves land).

**Wave 1 — Types + schemas + Score discriminator (parallelizable; no file overlap).**
Three plans:
- **Plan 1A:** Drizzle schema in `src/infrastructure/db/schema.ts` + a manual `drizzle-kit generate` run that emits `src/infrastructure/db/migrations/0000_*.sql` + `meta/_journal.json` + `meta/0000_snapshot.json`. Files committed.
- **Plan 1B:** `src/domain/types/score.ts` + `src/domain/types/entities.ts` + `src/domain/schemas/whoop-api.ts` + `src/domain/schemas/score.ts` + `src/domain/schemas/entities.ts`. Pure types; no Drizzle imports.
- **Plan 1C:** `src/domain/types/sync.ts` (RunSyncInput, RunSyncResult, ResourceSyncOutcome) + `src/services/sync/cursor.ts` (pure cursor logic with unit tests, no DB).

**Wave 2 — Boundary modules (parallelizable; no file overlap between sub-plans).**
- **Plan 2A:** `src/infrastructure/db/connection.ts` + `src/infrastructure/db/migrate.ts` + `tests/integration/sync/migration-crash.test.ts` + `tests/integration/sync/pragma-roundtrip.test.ts`. Depends on Wave 1 Plan 1A's schema + migrations committed.
- **Plan 2B:** `src/infrastructure/whoop/client.ts` + `src/infrastructure/whoop/rate-limit.ts` + `src/infrastructure/whoop/retry.ts` + `src/infrastructure/whoop/pagination.ts` + `src/infrastructure/whoop/errors.ts` (EXTEND with WhoopApiError, AuthError FROZEN). Depends on Wave 1 Plan 1B's schemas. Wires `callWithAuth` from Plan 02-04 exactly once.
- **Plan 2C:** `tests/helpers/in-memory-db.ts` + `tests/helpers/msw-whoop-cycles.ts` + `tests/helpers/msw-whoop-recovery.ts` + `tests/helpers/msw-whoop-sleep.ts` + `tests/helpers/msw-whoop-workouts.ts` + `tests/helpers/msw-whoop-profile.ts` + `tests/helpers/msw-whoop-body-measurements.ts` + the full `tests/fixtures/whoop/<resource>/<scenario>.json` set including the DST fixtures from D-15. Independent of 2A and 2B at the source-file level (one writes `src/`, the other writes `tests/`).

**Wave 3 — Repositories + Resources + Normalizers (parallelizable; one plan per resource group).**
- **Plan 3A:** `src/infrastructure/db/repositories/*.repo.ts` (one plan per repo file, or batched into 2-3 plans). Each repository returns domain entities; maps `raw_json` parse + score-state narrowing inside the file. Includes `getRawJson(id)` diagnostic.
- **Plan 3B:** `src/domain/normalize/*.ts` (one file per resource). Pure raw-Zod-output → entity. Wire-format `score_state` is preserved on the entity (it's the discriminator).
- **Plan 3C:** `src/infrastructure/whoop/resources/*.ts` (one file per resource). Each resource imports `httpGet` + `paginateAll` + its Zod schema. Single-shot for profile + body_measurements; paginated for the other four.
- **Plan 3D:** `src/domain/dst-tz/detect.ts` — pure function. Independent of all other plans except Wave 1 Plan 1B (entity types). Unit tests cover the 3 fixtures + clear-non-flag case.
- **Plan 3E:** `tests/contract/<resource>.test.ts` — one contract test per resource. Loads fixture → MSW intercepts → resource module fetches → in-memory DB upserts → repository read returns expected rows.

**Wave 4 — Sync orchestration (single plan).**
`src/services/sync/index.ts` + `src/services/sync/per-resource.ts` + `src/services/bootstrap.ts` (createServices side effect: openDb + run migrator) + `src/services/index.ts` (EXTEND barrel with `runSync`). Plus `tests/integration/sync/idempotency.test.ts` + `tests/integration/sync/partial-failure.test.ts` + `tests/integration/sync/dst-fixture.test.ts`. Depends on all of Waves 1-3.

**Wave 5 — CLI shim + formatter.**
`src/cli/commands/sync.ts` (≤5-line shim) + `src/formatters/sync.txt.ts`. Depends on Wave 4's services barrel `runSync`.

**Wave 6 — Phase close (single plan).**
Update STATE.md, update REQUIREMENTS.md traceability (DATA-01..06 + SYNC-01..07 flipped to "Complete"), update ROADMAP.md Phase 3 status.

### What Blocks What

| Wave | Blocks | Reason |
|------|--------|--------|
| 0 | All later waves | package.json + paths.ts + drizzle.config.ts must exist before any code can import |
| 1 | 2A, 2B, 3A, 3B, 3C, 3D | Types, schemas, and migrations are dependency inputs |
| 2A | 3A, 4 | Repositories need openDb + the schema applied |
| 2B | 3C, 4 | Resource modules need httpGet + pagination |
| 2C | 3E, 4 (integration tests) | MSW helpers + fixtures are test-only inputs |
| 3A, 3B, 3C, 3D | 4, 3E (contract tests) | Sync orchestration needs all four; contract tests need the resource modules they exercise |
| 4 | 5, 6 | CLI shim needs `services.runSync`; phase-close needs the full surface working |
| 5 | 6 | CLI runs end-to-end before phase-close |

**Parallelism summary:** Waves 1 (3 plans), 2 (3 plans), 3 (up to 5 plans) can all spread across multiple parallel agents. The phase ships ~13-17 plans total depending on how 3A is batched.

## Required Patterns (citations to existing project code)

| Pattern | Where the precedent lives | What Phase 3 mirrors |
|---------|---------------------------|----------------------|
| `callWithAuth` consumer shape | `src/services/refresh-orchestrator.ts` (Plan 02-04) | `httpGet` wraps the WHOOP fetch in `callWithAuth(async (accessToken) => fetch(...))`. The orchestrator handles 401 → re-read → force refresh → retry. Exactly once per `httpGet` call. |
| MSW helper shape | `tests/helpers/msw-whoop-oauth.ts` (Plan 02-01) | One file per resource, `createWhoopCyclesHelper()` exporting `{server, getHitCount, resetHitCount, setNextResponse}`. Fixture loaded from disk on each request (hot-reload friendly). |
| ConfigSchema extension | `src/infrastructure/config/schema.ts` (Plan 02-01) | D-27 says NO new config.json keys this phase. If a Phase 3 sub-plan needs one, follow the canonical pattern: extend the Zod schema in the canonical file, import via `D13_SCOPES`-style named exports. (Recommendation: stay with hard-coded constants per D-27.) |
| Pino logger usage | `src/infrastructure/config/logger.ts` (Plan 01-02) | `logger.warn({event: 'rate_limit_throttle', remaining: N})` — structured fields only. Never inline tokens or response bodies (ADR-0001 + Pitfall 17). |
| CI grep-gate pattern | `scripts/ci-grep-gates.sh` (Phases 1-2 + Gates A-E) | Gate F + Gate G follow Gate E's per-line exclude pattern: `grep -rEn ... src/ | grep -v *.test.ts | grep -v <allowed-files>`. |
| Discriminated error union | `src/infrastructure/whoop/errors.ts` (Plan 02-01 AuthError, FROZEN at 6 kinds) | `WhoopApiError` joins as a SIBLING union — not a mutation of `AuthError`. Shared `formatWhoopApiError` helper, same shape (named field + cause chain + readonly `kind`). |
| Vitest `pool: 'forks'` | `vitest.config.ts` (Plan 01-01) | Already configured; the migration-crash test (mid-statement kill) and any sync integration test that spawns child processes work without config change. |
| Vitest include glob | `vitest.config.ts` (Plan 02-08 extension) | `tests/**/*.test.ts` already covered; `tests/integration/sync/*.test.ts` discoverable without config change. |
| tsup config | `tsup.config.ts` (Plan 02-08) | No new top-level entry needed for Phase 3 — the migrator is imported by services/bootstrap.ts which is reachable from `dist/cli.mjs` and `dist/mcp.mjs`. (See Runtime State Inventory.) |

## Technical Research (Open Items Resolved)

### 1. WHOOP v2 `updated_since` filter support (D-12)

**Answer: NO.** WHOOP API v2 does **not** accept `updated_since` (or any variant — no `updatedSince`, no `since`-on-update) on the list endpoints. The accepted query params are: `limit`, `start`, `end`, `nextToken`. **Source:** `developer.whoop.com/api` (verified 2026-05-16) — full parameter listing table for `/v2/cycle`, `/v2/recovery`, `/v2/activity/sleep`, `/v2/activity/workout`. [CITED: developer.whoop.com/api]

**Implication for D-09/D-10/D-11:** The HTTP layer paginates by `start >= since` and `end <= until` (where `since = min(cursor, now() - 7d)` and `until = now()`). The 7-day re-window from D-10 is what catches WHOOP retroactive updates whose `updated_at` is newer than `cursor` but whose `start` is older than `cursor`. The `ON CONFLICT(id) DO UPDATE` clause at upsert time handles the re-write of any retroactively-modified row whose `start` falls within the re-window. Records modified retroactively *older than the 7-day re-window* will not be picked up by a routine `sync --days 30`; the user would need `sync --since <ISO>` (backfill mode) to catch them.

**No code path change vs locked decisions** — D-09/D-10 already anticipated this outcome (D-12 says "if no → the resource client paginates by `start >= since` and post-filters by `updated_at >= since` after fetch"). Post-fetch `updated_at`-filtering is unnecessary in the locked design because the 7-day re-window + `ON CONFLICT(id) DO UPDATE` already handles the retroactive case correctly.

### 2. Per-endpoint max page sizes (D-19)

**Answer:** **25** for all four list endpoints (`/v2/cycle`, `/v2/recovery`, `/v2/activity/sleep`, `/v2/activity/workout`). The `limit` parameter is `integer <int32>`, default `10`, max `25`. [CITED: developer.whoop.com/api — verified 2026-05-16]

Pinned constants per resource module:
```typescript
// src/infrastructure/whoop/resources/cycles.ts
const PAGE_SIZE = 25;
// src/infrastructure/whoop/resources/recovery.ts
const PAGE_SIZE = 25;
// src/infrastructure/whoop/resources/sleep.ts
const PAGE_SIZE = 25;
// src/infrastructure/whoop/resources/workouts.ts
const PAGE_SIZE = 25;
```

If WHOOP raises the limits in a future API revision, the constant is grep-able per resource (per D-19's design — pinned in resource modules, not in `pagination.ts`).

### 3. `/v2/user/profile/basic` + `/v2/user/measurement/body` semantics

**Answer:**
- **`/v2/user/profile/basic`** returns the authenticated user's name + email. Single record. No query parameters accepted. [CITED: developer.whoop.com/api — verified 2026-05-16]
- **`/v2/user/measurement/body`** returns height + weight + max heart rate. Single record. No query parameters accepted. [CITED: developer.whoop.com/api — verified 2026-05-16]
- Neither emits `updated_at` on the response shape. [ASSUMED based on absence in the documented schema] — neither doc page mentions `updated_at`. This is consistent with the response being "current state" rather than a time-versioned record.

**Implication for D-23 + Open Question 3:** Profile and body_measurements have no cursor. Sync re-fetches on every run; the repository deduplicates by content tuple (height, weight, max_hr for body; name, email for profile). The `body_measurements` "history" semantic from D-01 is implemented as **append-on-change**:
1. Fetch the current measurement.
2. Compare to the most-recent row in the table.
3. If different (or no row exists), insert a new row with `captured_at = response.created_at if present, else sync-time epoch`.
4. If identical, no-op.

The planner SHOULD surface this as a sub-decision (D-35 or similar) when locking the schema. If WHOOP's response carries a `created_at` for body_measurements, prefer that as the row's `captured_at`; otherwise fall back to sync-time epoch.

### 4. WHOOP pagination shape

**Answer:**
- **Response field:** `next_token` (snake_case) [CITED: developer.whoop.com/docs/developing/pagination/]
- **Request param:** `nextToken` (camelCase) [CITED: same]
- End of pages: `next_token` is null / absent.
- **Response JSON convention:** snake_case throughout (e.g., `cycle_id`, `timezone_offset`, `stage_summary`, `total_in_bed_time_milli`). [CITED: developer.whoop.com/docs/developing/user-data/sleep/]

**Implication for D-19:** The asymmetry is documented and intentional. `paginateAll` in `src/infrastructure/whoop/pagination.ts` is the single point of translation. Repositories and domain types camelCase via their own Zod transforms (or Zod's `.transform` per-field; conventions.md says no transforms in tool INPUT schemas, but transforms in INTERNAL Zod schemas are fine).

### 5. Rate-limit header names + values

**Answer:** [CITED: developer.whoop.com/docs/developing/rate-limiting/]
- **`X-RateLimit-Limit`** — current rate limits in window form, e.g., `"requests=100, window=60"` (string with window in seconds)
- **`X-RateLimit-Remaining`** — number of requests available before hitting the limit (integer-as-string)
- **`X-RateLimit-Reset`** — **delta seconds** (NOT epoch) until window resets
- **No `Retry-After` header** documented (confirmed verbatim — "The documentation does not mention a `Retry-After` header.")
- **Documented budgets:** 100 requests/min, 10,000 requests/day. Can be raised on request through the WHOOP support form.

**Defensive coding:** Even though the doc is explicit that `X-RateLimit-Reset` is delta seconds, cap the sleep at 60s ceiling regardless (defense-in-depth — if WHOOP changes the semantic to epoch, a runaway sleep is avoided). Pin the constant: `const RATE_LIMIT_RESET_SLEEP_CAP_MS = 60_000`.

### 6. better-sqlite3 + Drizzle integration details

**Answer:** [CITED: github.com/WiseLibs/better-sqlite3/blob/master/docs/api.md — verified 2026-05-16]
- **`db.pragma('wal_checkpoint(TRUNCATE)')`** is the correct invocation (D-30, D-32). `db.pragma()` normalizes PRAGMA result handling; `db.exec()` works too but doesn't return the structured result.
- **`Statement.run()`** returns `{changes: number, lastInsertRowid: number | bigint}`. The repository `upsertBatch` returns `{changed: number}` derived from `info.changes`.
- **Per-connection pragmas:** all 6 from D-30 are applied per connection. Each process that opens `~/.recovery-ledger/db.sqlite` runs its own `openDb(path)` and gets its own pragma settings. They are NOT persisted across processes — that's correct, by design. `journal_mode=WAL` is the one exception: once set, it persists in the file header and stays WAL until a process explicitly switches it. So a fresh process opening the file inherits WAL automatically; the explicit `pragma('journal_mode = WAL')` is idempotent.
- **`db.exec()` is multi-statement-aware** — the entire `.sql` migration payload runs as one call. ✓ Matches D-06's requirement.
- **Pragmas across processes:** `busy_timeout`, `synchronous`, `foreign_keys`, `wal_autocheckpoint`, `journal_size_limit` are NOT persisted — each process MUST set them on its own connection. Hence `openDb(path)` is the load-bearing single entry point.

### 7. Drizzle migration output format on 0.45.x

**Answer:** [CITED: orm.drizzle.team/docs/drizzle-kit-generate + community sources verified 2026-05-16]

`drizzle-kit generate` produces:
```
src/infrastructure/db/migrations/
├── 0000_<random_name>.sql          # the SQL payload — multiple statements separated by `--> statement-breakpoint`
└── meta/
    ├── _journal.json               # { entries: [{idx, when, tag, breakpoints}, ...] }
    └── 0000_snapshot.json          # serialized snapshot of the schema at this migration
```

**`__drizzle_migrations` table shape (in SQLite):**
```sql
CREATE TABLE IF NOT EXISTS __drizzle_migrations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  hash TEXT NOT NULL,
  created_at NUMERIC
);
```

The hand-rolled migrator reads `meta/_journal.json` for the canonical migration list (rather than glob-scanning `.sql` files), hashes each pending migration's SQL with sha256, and skips migrations whose hash already appears in `__drizzle_migrations.hash`. On apply, insert `(hash, created_at = Date.now())`.

> **Wave 0 verification step:** Run `npx drizzle-kit generate` once against a stub schema to confirm the exact file structure on disk before locking the migrator's parsing code. Mitigates A1, A2, A11.

### 8. MSW v2 fixture-server shape for per-resource WHOOP endpoints

**Answer:** Already locked by Pattern 10 above. The convention from `tests/helpers/msw-whoop-oauth.ts` extends verbatim — one `createWhoopXyzHelper()` function per resource, each returning `{server, getHitCount, resetHitCount, setNextResponse}`. The fixture path is `tests/fixtures/whoop/<resource>/<scenario>.json`; scenario is passed via a `__test_scenario` query string (or via `setNextResponse` for one-shot overrides).

The helper provides default headers (`X-RateLimit-Remaining: 95`, `X-RateLimit-Reset: 60`, `X-RateLimit-Limit: window=60`) so the rate-limit semaphore and the throttle threshold are exercised on every contract test. Scenarios that need 429 headers override via `setNextResponse(body, 429, {'X-RateLimit-Reset': '3'})`.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest 4.1.6 (already pinned) |
| Config file | `vitest.config.ts` (already in repo) |
| Quick run command | `npm run test` |
| Full suite command | `npm run test && bash scripts/ci-grep-gates.sh` |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|--------------|
| DATA-01 | DB opens in WAL mode with all 6 pragmas at the default path | integration | `vitest run tests/integration/sync/pragma-roundtrip.test.ts` | ❌ Wave 2A |
| DATA-02 | Drizzle schema for 9 tables; hybrid normalized + raw_json | unit (schema introspection) | `vitest run src/infrastructure/db/schema.test.ts` | ❌ Wave 1 Plan 1A |
| DATA-03 | Index `(score_state, start)` on each scored entity | unit (introspection on schema) | `vitest run src/infrastructure/db/schema.test.ts` (assertion on indexes) | ❌ Wave 1 Plan 1A |
| DATA-04 | Migrator wraps in BEGIN IMMEDIATE; pre-migration backup; fails-closed | integration | `vitest run tests/integration/sync/migration-crash.test.ts` | ❌ Wave 2A |
| DATA-05 | Three-layer types + Score discriminator enforces SCORED-only by default | unit (TS type tests + repo behavior) | `vitest run src/domain/types/score.test.ts src/infrastructure/db/repositories/recovery.repo.test.ts` | ❌ Wave 1 Plan 1B + Wave 3 |
| DATA-06 | DST + tz_drift cycles flagged; excluded from baseline default query; visible in raw views | unit + integration | `vitest run src/domain/dst-tz/detect.test.ts tests/integration/sync/dst-fixture.test.ts` | ❌ Wave 3 Plan 3D + Wave 4 |
| SYNC-01 | `recovery-ledger sync --days N` fetches all 6 resources for the requested window | integration (CLI subprocess) | `vitest run tests/integration/sync/idempotency.test.ts` (drives services.runSync) + manual CLI smoke | ❌ Wave 4 + Wave 5 |
| SYNC-02 | Pagination, snake↔camel, semaphore-of-4 | unit (pagination + rate-limit) + contract | `vitest run src/infrastructure/whoop/pagination.test.ts src/infrastructure/whoop/rate-limit.test.ts tests/contract/cycles.test.ts` | ❌ Wave 2B + Wave 3E |
| SYNC-03 | 429 backoff honors X-RateLimit-Reset (NOT fixed); CLI surfaces rate-limit state | unit (retry) + integration | `vitest run src/infrastructure/whoop/retry.test.ts tests/integration/sync/partial-failure.test.ts` | ❌ Wave 2B + Wave 4 |
| SYNC-04 | Idempotency via ON CONFLICT; updated_at delta + 7-day re-window | integration | `vitest run tests/integration/sync/idempotency.test.ts` | ❌ Wave 4 |
| SYNC-05 | Partial-failure reporting; per-resource counts in sync_runs; status='partial' | integration | `vitest run tests/integration/sync/partial-failure.test.ts` | ❌ Wave 4 |
| SYNC-06 | wal_checkpoint(TRUNCATE) after successful run | integration | `vitest run tests/integration/sync/pragma-roundtrip.test.ts` (asserts WAL size drops to 0 after sync) | ❌ Wave 2A + Wave 4 |
| SYNC-07 | Fixture-based contract tests per resource; no live API; suite < 60s | contract (one per resource) | `vitest run tests/contract/` (all 6 contract files) | ❌ Wave 3E |
| D-33 attestation | tools/list returns EXACTLY one tool (whoop_doctor) | integration (carried forward from Plan 02-08 G-03) | `vitest run tests/integration/auth-concurrency.test.ts` (G-03 sub-test) | ✅ exists; carries forward |
| D-34 attestation | sanitize.ts + register.ts UNMODIFIED in Phase 3 | manual + git-diff check at phase-close | `git diff origin/main -- src/mcp/sanitize.ts src/mcp/register.ts` returns empty | ✅ enforced by review + Wave 6 |
| Gate F | No `fetch(` outside whoop/client.ts + token-store.ts + oauth.ts | CI grep gate | `bash scripts/ci-grep-gates.sh` (Gate F) | ❌ Wave 0 |
| Gate G | No `drizzle-orm/*` import outside `src/infrastructure/db/` | CI grep gate | `bash scripts/ci-grep-gates.sh` (Gate G) | ❌ Wave 0 |

### Sampling Rate
- **Per task commit:** `npm run test -- --changed` (or full `npm run test` for small repos like this one)
- **Per wave merge:** `npm run test && npm run lint && bash scripts/ci-grep-gates.sh`
- **Phase gate:** Full suite green + Gate F + Gate G + Gates A-E + manual `git diff` check on sanitize.ts + register.ts before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `package.json` — add the 5 new packages (3 prod + 2 dev) per §Installation
- [ ] `drizzle.config.ts` — new file at repo root, points at `src/infrastructure/db/schema.ts` + `src/infrastructure/db/migrations/`
- [ ] Extend `src/infrastructure/config/paths.ts` `ResolvedPaths` interface with `dbFile`, `dbWalFile`, `dbShmFile`, `backupsDir`, `migrationsDir` and update `resolvePaths()` accordingly
- [ ] Extend `scripts/ci-grep-gates.sh` with Gate F (no `fetch(` outside the 3 whoop boundary files; exclude `*.test.ts`) and Gate G (no `drizzle-orm/` import outside `src/infrastructure/db/`; exclude `*.test.ts`)
- [ ] Confirm `npm view` for each new package returns the pinned version; flag any major drift since 2026-05-11
- [ ] Run `npx drizzle-kit generate` once against a stub schema to confirm output structure matches A1/A2/A11 assumptions

*(No framework install needed — Vitest, MSW, Biome are all already wired.)*

## Sources

### Primary (HIGH confidence)
- `.planning/phases/03-data-model-db-layer-sync-loop/03-CONTEXT.md` — 34 locked decisions; read in full
- `.planning/REQUIREMENTS.md` — DATA-01..06 + SYNC-01..07
- `.planning/STATE.md` — Phase 2 deltas; D-12 + page-size pins flagged as research items now resolved
- `.planning/ROADMAP.md` — Phase 3 goal + success criteria; cross-cutting concerns table
- `.planning/research/STACK.md` — pinned versions; what NOT to use
- `.planning/research/ARCHITECTURE.md` — lite hexagonal layout; lines 590-624 migrations; line 614 migrator-at-bootstrap; line 802 oauth_tokens-stays-in-keyring; Anti-Pattern 3 / 7
- `.planning/research/PITFALLS.md` — Pitfall 3, 6, 7, 10, 11, 12, 13, 15, 16, 17, 19
- `.planning/research/FEATURES.md` — table-stakes mapping for v1 review loop
- `agent_docs/conventions.md` — strict TS, no default exports, lite hexagonal, validation at boundaries, testing rules
- `agent_docs/decisions/0001-mcp-stdout-purity.md` — Pino → stderr
- `agent_docs/decisions/0002-single-flight-oauth-refresh.md` — `callWithAuth` chokepoint; only consumer of `tokenStore.getValidAccessToken()`
- `agent_docs/decisions/0003-score-state-discipline.md` — discriminated union
- `agent_docs/decisions/0006-fixture-only-tests.md` — MSW + fixtures; no live calls
- `agent_docs/decisions/0007-whoop-read-only.md` — GET-only WHOOP client
- `agent_docs/learnings.md` — L0001..L0004 from Phase 1+2
- Existing project code: `src/services/refresh-orchestrator.ts`, `src/infrastructure/whoop/errors.ts`, `src/infrastructure/whoop/token-store.ts`, `src/infrastructure/config/paths.ts`, `src/services/index.ts`, `scripts/ci-grep-gates.sh`, `tests/helpers/msw-whoop-oauth.ts`
- [developer.whoop.com/docs/developing/pagination/](https://developer.whoop.com/docs/developing/pagination/) — verified 2026-05-16: `next_token` (response) + `nextToken` (request); per-endpoint max in API docs
- [developer.whoop.com/docs/developing/rate-limiting/](https://developer.whoop.com/docs/developing/rate-limiting/) — verified 2026-05-16: 3 headers; X-RateLimit-Reset is delta seconds; no Retry-After; 100/min + 10K/day
- [developer.whoop.com/api](https://developer.whoop.com/api) — verified 2026-05-16: all 4 list endpoints accept `limit` (max 25, default 10), `start`, `end`, `nextToken`; NO `updated_since`
- [developer.whoop.com/docs/developing/user-data/cycle/](https://developer.whoop.com/docs/developing/user-data/cycle/) — verified 2026-05-16: cycle id is int64; full field list including timezone_offset, updated_at, score_state, CycleScore sub-object
- [developer.whoop.com/docs/developing/user-data/recovery/](https://developer.whoop.com/docs/developing/user-data/recovery/) — verified 2026-05-16: recovery keyed by (cycle_id int64, sleep_id UUID); score_state enum; ScoredRecovery field list
- [developer.whoop.com/docs/developing/user-data/sleep/](https://developer.whoop.com/docs/developing/user-data/sleep/) — verified 2026-05-16: sleep id is UUID; all expected fields present; v2 snake_case confirmed
- [developer.whoop.com/docs/developing/user-data/workout/](https://developer.whoop.com/docs/developing/user-data/workout/) — verified 2026-05-16: workout id is UUID; updated_at, start, end, timezone_offset, score_state; WorkoutScore sub-object
- [developer.whoop.com/docs/developing/v1-v2-migration/](https://developer.whoop.com/docs/developing/v1-v2-migration/) — verified 2026-05-16: IDs changed from long to UUID for some resources (Sleep, Workout)
- [github.com/WiseLibs/better-sqlite3/blob/master/docs/api.md](https://github.com/WiseLibs/better-sqlite3/blob/master/docs/api.md) — verified 2026-05-16: db.pragma('wal_checkpoint(TRUNCATE)') is correct; db.exec is multi-statement-aware; Statement.run() returns {changes, lastInsertRowid}
- [orm.drizzle.team/docs/drizzle-kit-generate](https://orm.drizzle.team/docs/drizzle-kit-generate) — verified 2026-05-16: generate produces .sql + meta/_journal.json + meta/<idx>_snapshot.json
- [orm.drizzle.team/docs/drizzle-kit-migrate](https://orm.drizzle.team/docs/drizzle-kit-migrate) — verified 2026-05-16: __drizzle_migrations is the canonical migrations log
- [deepwiki.com/drizzle-team/drizzle-orm/3.2-migration-system](https://deepwiki.com/drizzle-team/drizzle-orm/3.2-migration-system) — verified 2026-05-16: __drizzle_migrations columns (id, hash, created_at)

### Secondary (MEDIUM confidence — cross-verified)
- WHOOP API v2 docs above were each fetched live and cross-checked against community references and the v1→v2 migration guide
- Drizzle migration system shape cross-checked between official docs + DeepWiki + a Medium walkthrough on migrations folder structure
- `@date-fns/tz` README + STACK.md §Date Handling — the `tzOffset()` semantics are documented but unverified-in-code at this phase; Wave 3 Plan 3D will exercise them

### Tertiary (LOW confidence — flagged for in-Wave-0 verification)
- A1 / A2 / A11 — Drizzle Kit's exact output structure may have changed between minor versions of 0.31.x. Wave 0 includes a smoke `drizzle-kit generate` run to confirm.
- A4 — Body measurements "history table" semantic from D-01 vs WHOOP's single-record response. Open Question 3 surfaces this; planner should issue a sub-decision (D-35).

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all versions pinned by STACK.md; existing project code on disk uses Plan 02-* packages identically
- Architecture: HIGH — Pattern 1-10 directly mirror ARCHITECTURE.md + 03-CONTEXT.md decisions; no novel architecture
- WHOOP API specifics (items 1-5 of Technical Research): HIGH — every claim has a `[CITED]` tag with a live URL verified on the research date
- Drizzle migrator file structure (items 6-7): HIGH-MEDIUM — Drizzle Kit's output is documented across multiple sources but the wave-0 smoke run is the deterministic check
- Pitfalls catalog: HIGH — entries pulled verbatim from PITFALLS.md; new Phase-3-specific pitfalls A/B are derived from the new CI gates F/G
- Open questions: identified 6; none are blockers — all resolvable inside the first 1-2 plans

**Research date:** 2026-05-16
**Valid until:** 2026-06-15 (30 days for stable docs / pinned deps; revisit if WHOOP API ships a v2.x revision in the meantime)

## RESEARCH COMPLETE
