# Architecture Research

**Domain:** Local-first TypeScript CLI + MCP stdio server over a personal SQLite cache of WHOOP API v2 data
**Researched:** 2026-05-11
**Confidence:** HIGH

The architecture below is a deliberate, opinionated answer to the 13 questions in the brief. It is shaped by three non-negotiable forces from `PROJECT.md`:

1. **Two transports, one product.** CLI and MCP must expose the same behavior; duplicating logic between them is the single fastest way to kill maintainability of a personal tool.
2. **Single-user, single-process, single-machine.** No multi-tenant concerns, no horizontal scaling, no remote DB. The architecture should be boring and direct — every layer that does not earn its keep should be deleted.
3. **Transparent uncertainty is a product feature.** Baseline and pattern detection must be a first-class, testable layer with explicit confidence tiers — not a side-effect of query code.

The recommendation is a **ports-and-adapters (hexagonal) shape, lite edition**: a pure-TypeScript application core (services + domain), with two driving adapters (CLI, MCP) and three driven adapters (WHOOP HTTP client, SQLite/Drizzle store, filesystem/keychain config). This is the smallest layering that lets CLI and MCP share 100% of behavior, lets baselines be unit-tested against fixtures, and lets the WHOOP client be swapped for a fixture in CI.

## Standard Architecture

### System Overview

```
┌──────────────────────────────────────────────────────────────────────────┐
│                          Driving Adapters (entry points)                 │
│  ┌──────────────────────────┐         ┌──────────────────────────────┐   │
│  │ CLI (commander/citty)    │         │ MCP stdio server             │   │
│  │  - recovery-ledger sync  │         │  - whoop_sync                │   │
│  │  - review daily/weekly   │         │  - whoop_daily_review        │   │
│  │  - decision add/review   │         │  - whoop_weekly_review       │   │
│  │  - doctor, api-gap       │         │  - whoop_add_decision ...    │   │
│  └────────────┬─────────────┘         └────────────────┬─────────────┘   │
│               │                                        │                 │
│               │  both call the SAME functions          │                 │
│               ▼                                        ▼                 │
├──────────────────────────────────────────────────────────────────────────┤
│                       Application Layer (services/)                      │
│  ┌────────────────────────────────────────────────────────────────────┐  │
│  │ runSync · getDailyReview · getWeeklyReview · addDecision ·         │  │
│  │ reviewDecisions · queryCache · runDoctor · getApiGap               │  │
│  │ — orchestrates domain + infrastructure; returns plain data         │  │
│  └────────────┬───────────────────────────────────────────┬───────────┘  │
│               │                                           │              │
│               ▼                                           ▼              │
├──────────────────────────────────────────────────────────────────────────┤
│              Domain Layer (pure)            │   Formatting Layer         │
│  ┌─────────────────────────────────┐        │  ┌──────────────────────┐  │
│  │ baselines/ (30-day stats)       │        │  │ formatters/          │  │
│  │ anomalies/ (z-score, deltas)    │        │  │  text/  json/        │  │
│  │ patterns/ (worst-day rules)     │        │  │ (JSON → compact text │  │
│  │ confidence/ (tiers, gating)     │        │  │  fallback for MCP)   │  │
│  │ types/ + schemas/ (Zod)         │        │  └──────────────────────┘  │
│  └────────────┬────────────────────┘        │                            │
│               │                             │                            │
├───────────────┴─────────────────────────────┴────────────────────────────┤
│                        Driven Adapters (infrastructure/)                 │
│  ┌──────────────────┐  ┌──────────────────┐  ┌──────────────────────┐    │
│  │ whoop/           │  │ db/              │  │ config/              │    │
│  │  - oauth client  │  │  - drizzle conn  │  │  - paths             │    │
│  │  - resource APIs │  │  - schema.ts     │  │  - env overrides     │    │
│  │  - rate limiter  │  │  - migrations/   │  │  - keychain (opt)    │    │
│  │  - retry/backoff │  │  - repositories  │  │  - logger (stderr)   │    │
│  └────────┬─────────┘  └────────┬─────────┘  └──────────┬───────────┘    │
└───────────┼─────────────────────┼───────────────────────┼────────────────┘
            │                     │                       │
            ▼                     ▼                       ▼
   ┌─────────────────┐   ┌──────────────────┐   ┌──────────────────────┐
   │ WHOOP API v2    │   │ ~/.recovery-     │   │ ~/.recovery-ledger/  │
   │ (HTTPS)         │   │ ledger/db.sqlite │   │ config.json, tokens  │
   └─────────────────┘   └──────────────────┘   └──────────────────────┘
```

### Component Responsibilities

| Component | Owns | Talks to |
|-----------|------|----------|
| `cli/` | Argv parsing, exit codes, stdout text rendering, error → human message | `services/` only |
| `mcp/` | Tool/resource/prompt registration, Zod input schemas, returning `{content: [...], structuredContent: ...}` | `services/` and `formatters/` only |
| `services/` | Use-case orchestration: composes domain + infrastructure, returns plain typed result objects (no I/O formatting) | `domain/`, `infrastructure/` |
| `domain/baselines/`, `anomalies/`, `patterns/` | Pure functions over already-fetched rows; statistics, confidence gating, rule firing | nothing (pure) |
| `domain/types/`, `schemas/` | Zod schemas for raw WHOOP responses, normalized rows, and derived view models | nothing |
| `infrastructure/whoop/` | OAuth + REST against `api.prod.whoop.com`, token storage, single-flight refresh, retries | `infrastructure/config/` |
| `infrastructure/db/` | Drizzle schema, migrator, repository functions, transactions | filesystem |
| `infrastructure/config/` | Path resolution, env overrides, structured stderr logger | filesystem / OS keychain (optional) |
| `formatters/` | Render a domain result object as compact text (for `--text` CLI and MCP text fallback); the JSON path is just `JSON.stringify` of the structured result | nothing |

## Recommended Project Structure

```
recovery-ledger/
├── package.json
├── tsconfig.json
├── drizzle.config.ts                 # points at infrastructure/db/schema.ts + migrations/
├── biome.json
├── vitest.config.ts
├── bin/
│   ├── recovery-ledger.js            # CLI shim: imports dist/cli/index.js
│   └── recovery-ledger-mcp.js        # MCP shim: imports dist/mcp/index.js
├── src/
│   ├── cli/                          # Driving adapter #1
│   │   ├── index.ts                  # Commander/citty wiring + global flags
│   │   ├── commands/
│   │   │   ├── sync.ts               # recovery-ledger sync
│   │   │   ├── review-daily.ts
│   │   │   ├── review-weekly.ts
│   │   │   ├── decision-add.ts
│   │   │   ├── decision-review.ts
│   │   │   ├── doctor.ts
│   │   │   ├── api-gap.ts
│   │   │   └── auth.ts               # one-time OAuth bootstrap
│   │   └── render/
│   │       └── exit-codes.ts         # maps service errors → exit codes
│   │
│   ├── mcp/                          # Driving adapter #2
│   │   ├── index.ts                  # StdioServerTransport + Server instance
│   │   ├── tools/
│   │   │   ├── whoop-sync.ts
│   │   │   ├── whoop-daily-review.ts
│   │   │   ├── whoop-weekly-review.ts
│   │   │   ├── whoop-query-cache.ts
│   │   │   ├── whoop-add-decision.ts
│   │   │   ├── whoop-review-decisions.ts
│   │   │   ├── whoop-api-gap.ts
│   │   │   └── whoop-doctor.ts
│   │   ├── resources/
│   │   │   ├── summary-today.ts      # whoop://summary/today
│   │   │   ├── summary-week.ts
│   │   │   ├── baseline-30d.ts
│   │   │   ├── data-quality.ts
│   │   │   ├── api-gaps.ts
│   │   │   └── decisions-open.ts
│   │   └── prompts/
│   │       ├── daily-decision-brief.ts
│   │       ├── weekly-recovery-investigation.ts
│   │       ├── experiment-designer.ts
│   │       └── deload-or-train.ts
│   │
│   ├── services/                     # Application layer — shared by CLI + MCP
│   │   ├── index.ts                  # createServices(deps): Services
│   │   ├── sync.service.ts           # runSync()
│   │   ├── review.service.ts         # getDailyReview(), getWeeklyReview()
│   │   ├── decision.service.ts       # addDecision(), reviewDecisions()
│   │   ├── cache.service.ts          # queryCache()
│   │   ├── doctor.service.ts         # runDoctor()
│   │   ├── api-gap.service.ts        # getApiGap()
│   │   └── types.ts                  # ServiceResult<T> + ServiceError union
│   │
│   ├── domain/                       # Pure logic, no I/O
│   │   ├── types/
│   │   │   ├── raw.ts                # Zod-inferred types for raw WHOOP responses
│   │   │   ├── entities.ts           # Cycle, Recovery, Sleep, Workout (normalized)
│   │   │   ├── views.ts              # DailyReviewView, WeeklyReviewView, etc.
│   │   │   └── confidence.ts         # ConfidenceTier = 'strong' | 'weak' | 'insufficient'
│   │   ├── schemas/                  # Zod schemas (mirror DB tables + API responses)
│   │   │   ├── whoop-api.ts
│   │   │   ├── entities.ts
│   │   │   └── views.ts
│   │   ├── baselines/
│   │   │   ├── rolling-30d.ts        # pure: rows in → BaselineStats out
│   │   │   ├── stats.ts              # mean, stdev, median, IQR
│   │   │   └── gating.ts             # min-sample rules → confidence tier
│   │   ├── anomalies/
│   │   │   ├── z-score.ts
│   │   │   └── deltas.ts             # today vs baseline
│   │   ├── patterns/
│   │   │   ├── worst-recovery-days.ts
│   │   │   └── preceding-factors.ts  # correlate strain/sleep/wake-time on prior days
│   │   └── normalize/
│   │       ├── cycles.ts             # raw API → entity row
│   │       ├── recovery.ts
│   │       ├── sleep.ts
│   │       └── workouts.ts
│   │
│   ├── infrastructure/
│   │   ├── whoop/
│   │   │   ├── client.ts             # WhoopClient class (uses fetch)
│   │   │   ├── oauth.ts              # authorize URL, exchange code, refresh
│   │   │   ├── token-store.ts        # read/write tokens; single-flight refresh
│   │   │   ├── resources/
│   │   │   │   ├── cycles.ts
│   │   │   │   ├── recovery.ts
│   │   │   │   ├── sleep.ts
│   │   │   │   ├── workouts.ts
│   │   │   │   ├── profile.ts
│   │   │   │   └── body-measurements.ts
│   │   │   ├── rate-limit.ts         # in-process limiter, honors 429 Retry-After
│   │   │   ├── retry.ts              # exponential backoff with jitter
│   │   │   └── errors.ts             # WhoopApiError taxonomy
│   │   ├── db/
│   │   │   ├── connection.ts         # better-sqlite3, WAL pragma, busy_timeout
│   │   │   ├── schema.ts             # Drizzle table defs (single source of truth)
│   │   │   ├── migrate.ts            # runs drizzle migrator on startup
│   │   │   ├── migrations/           # generated SQL + _journal.json
│   │   │   └── repositories/
│   │   │       ├── cycles.repo.ts
│   │   │       ├── recovery.repo.ts
│   │   │       ├── sleep.repo.ts
│   │   │       ├── workouts.repo.ts
│   │   │       ├── decisions.repo.ts
│   │   │       ├── sync-runs.repo.ts
│   │   │       └── daily-summaries.repo.ts
│   │   └── config/
│   │       ├── paths.ts              # ~/.recovery-ledger/ resolver + env override
│   │       ├── env.ts                # validated env schema (Zod)
│   │       └── logger.ts             # pino to stderr (MCP-safe)
│   │
│   ├── formatters/                   # JSON result → compact text
│   │   ├── daily-review.txt.ts
│   │   ├── weekly-review.txt.ts
│   │   ├── sync.txt.ts
│   │   ├── doctor.txt.ts
│   │   └── decision.txt.ts
│   │
│   └── shared/
│       ├── result.ts                 # Result<T, E> helper (no throw at boundary)
│       ├── time.ts                   # date math, day boundaries in user's TZ
│       └── id.ts                     # ULID/UUID helper for decisions
│
├── test/
│   ├── fixtures/
│   │   └── whoop-api/                # JSON captures per endpoint + scenario
│   │       ├── cycles.page1.json
│   │       ├── recovery.empty.json
│   │       ├── sleep.gap.json
│   │       └── ...
│   ├── unit/                         # domain/ tests, no I/O
│   ├── integration/                  # services with in-memory SQLite + fake WhoopClient
│   └── e2e/                          # spawn CLI + MCP stdio against fixtures
```

### Structure Rationale

- **`cli/` and `mcp/` are siblings, not nested.** Both are driving adapters. Neither imports the other. They each import only `services/` and `formatters/`. This is the structural enforcement that keeps logic from drifting into a single transport.
- **`services/` is the only place orchestration lives.** Every CLI command is roughly four lines: parse args, call a service, render result, set exit code. Every MCP tool is roughly four lines: validate input with Zod, call a service, build structured + text content, return.
- **`domain/` has zero imports from `infrastructure/`.** Baselines and patterns operate on row arrays already in memory. This is what makes them trivially unit-testable with fixtures, and what makes "add one derived metric" a single-file change (per the maintenance constraint in PROJECT.md).
- **`infrastructure/db/repositories/` over leaking Drizzle queries into services.** Repositories return domain entity types, not Drizzle row types. Services never touch Drizzle directly. This is the seam that lets us swap in `better-sqlite3` in-memory mode for tests.
- **`formatters/` separated from both transports.** The CLI uses them directly for stdout; MCP tools embed their output as the `text` fallback. Same renderer, same output, zero duplication.
- **`bin/` shims are tiny.** They exist so `npx recovery-ledger` and the MCP `command` in `claude_desktop_config.json` can point at stable paths without TypeScript baggage.

## Architectural Patterns

### Pattern 1: Ports & Adapters (Hexagonal), Lite Edition

**What:** Application core is pure TypeScript that depends on interfaces. Both CLI and MCP are *driving adapters* that call into the core. WHOOP HTTP and SQLite are *driven adapters* that the core calls through repository/client interfaces.

**Why this fits Recovery Ledger:**
- Two transports (CLI + MCP) exposing identical behavior is the textbook hexagonal use case. Anything less and the two surfaces will drift.
- The domain layer (`baselines/`, `anomalies/`, `patterns/`) is genuinely pure math over arrays of rows — exactly what hexagonal optimizes for.
- The lite part: we do not build a DI container, separate "ports" packages, or formal interface segregation. We just wire concrete dependencies in a single `createServices(deps)` factory.

**Trade-offs:**
- Pro: CLI and MCP cannot duplicate behavior even if a contributor wanted them to — there is no behavior in those folders to duplicate.
- Pro: Tests can substitute `WhoopClient` and `DbConnection` at the factory boundary; no mocking framework needed.
- Con: One extra layer of indirection vs. a script-style codebase. Acceptable given the dual-transport requirement.

**Example: the application-layer factory**

```typescript
// src/services/index.ts
export interface ServiceDeps {
  whoop: WhoopClient;
  db: DbConnection;            // wraps Drizzle instance + repositories
  clock: () => Date;           // for testability
  config: ResolvedConfig;
  logger: Logger;
}

export interface Services {
  runSync: (opts: RunSyncInput) => Promise<RunSyncResult>;
  getDailyReview: (opts: DailyReviewInput) => Promise<DailyReviewResult>;
  getWeeklyReview: (opts: WeeklyReviewInput) => Promise<WeeklyReviewResult>;
  addDecision: (input: AddDecisionInput) => Promise<AddDecisionResult>;
  reviewDecisions: (opts: ReviewDecisionsInput) => Promise<ReviewDecisionsResult>;
  queryCache: (opts: QueryCacheInput) => Promise<QueryCacheResult>;
  runDoctor: () => Promise<DoctorResult>;
  getApiGap: () => Promise<ApiGapResult>;
}

export function createServices(deps: ServiceDeps): Services { /* ... */ }
```

CLI: `const services = createServices(buildProdDeps())` then dispatch.
MCP: same line, same services. No second implementation.

### Pattern 2: Repository Returns Domain Entities, Not Rows

**What:** `infrastructure/db/repositories/*.repo.ts` exposes functions like `getRecoveriesByRange(start, end): Recovery[]` where `Recovery` is the domain entity type from `domain/types/entities.ts`. Drizzle queries and column-to-field mapping never leave the repository file.

**When to use:** Any time domain code wants to consume data without coupling to Drizzle's row shape.

**Trade-offs:**
- Pro: We can change the DB schema (e.g., split a JSON blob into columns) without touching `services/` or `domain/`.
- Pro: Tests for `domain/baselines/` use plain `Recovery[]` arrays from fixtures, never a database.
- Con: A small amount of mapping boilerplate. Worth it — and trivial with Drizzle's typed selects.

### Pattern 3: Result Objects with Confidence Tiers (No Exceptions Across Boundaries)

**What:** Services return `Result<T, ServiceError>` (discriminated union), never throw across the service boundary. Domain review results carry a `confidence: ConfidenceTier` field. CLI maps `ServiceError` → exit code + stderr message; MCP maps it to `isError: true` + structured error in `content`.

**Why this fits:** PROJECT.md is explicit: "transparent uncertainty" is a product feature. We model it in the type system. CLI and MCP get a uniform shape for errors, so the user experience is identical across transports.

```typescript
// src/domain/types/confidence.ts
export type ConfidenceTier = 'strong' | 'weak' | 'insufficient';

export interface ConfidenceGate {
  tier: ConfidenceTier;
  reason: string;             // "Only 4 of last 30 days have recovery data"
  sampleSize: number;
  minRequired: number;
}

// src/domain/types/views.ts
export interface DailyReviewView {
  date: string;               // ISO yyyy-mm-dd
  today: TodayMetrics;
  baseline: BaselineSnapshot;
  anomalies: Anomaly[];
  actions: SuggestedAction[]; // length 0..3
  confidence: ConfidenceGate;
}
```

The renderer prints `"No reliable pattern detected (only 4/30 days of data)"` when `tier === 'insufficient'`. This is enforced by the type — `actions` is empty unless `tier !== 'insufficient'`.

### Pattern 4: Single-Flight Token Refresh

**What:** A module-level `Promise<Tokens> | null` cached inside `infrastructure/whoop/token-store.ts`. When any caller needs a fresh token and the in-flight promise exists, they `await` it. Only one HTTP refresh per refresh event, even under N concurrent MCP tool calls.

**Why this matters here:** MCP clients (Claude Code, Claude Desktop) can fire multiple tools in parallel. Without single-flight, a token nearing expiry triggers a refresh stampede; WHOOP's rotating refresh token means only the first response is valid and the others 401, then race to "refresh" with already-invalidated tokens. This is a known class of bug, including in the MCP TypeScript SDK itself (issue #1760).

```typescript
// src/infrastructure/whoop/token-store.ts
let inFlightRefresh: Promise<Tokens> | null = null;

export async function getValidAccessToken(deps: { /* ... */ }): Promise<string> {
  const current = await deps.readTokens();
  if (current && !isExpiringSoon(current, deps.clock())) {
    return current.accessToken;
  }
  if (inFlightRefresh === null) {
    inFlightRefresh = doRefresh(current, deps).finally(() => {
      inFlightRefresh = null;
    });
  }
  const refreshed = await inFlightRefresh;
  return refreshed.accessToken;
}
```

The token file itself is guarded with an `O_EXCL` write to a temp file + rename, so the on-disk write is atomic. A second process (e.g., CLI + MCP at the same time) won't see a half-written token file.

### Pattern 5: Centralized Error Taxonomy → Uniform Surfacing

**What:** `infrastructure/whoop/errors.ts` defines a discriminated `WhoopApiError` union: `unauthorized`, `rate_limited`, `network`, `validation`, `server`, `unknown`. Services translate these to `ServiceError`. CLI's `render/exit-codes.ts` and MCP's tool wrappers map `ServiceError` to a uniform surface.

| ServiceError kind | CLI behavior | MCP behavior |
|---|---|---|
| `auth_expired` | exit 2; "Run `recovery-ledger auth`" | `isError: true`, structured `{ kind: 'auth_expired', remediation }` |
| `rate_limited` | exit 4; "WHOOP rate limit, retry in Ns" | structured with `retryAfterSeconds` |
| `network` | exit 5; "Network unreachable" | structured network kind |
| `data_quality` | exit 6; "Insufficient data — sync first?" | confidence tier = `insufficient` in result |
| `config_missing` | exit 7; "No WHOOP credentials — run setup" | structured `{ kind: 'config_missing' }` |

The user sees the same diagnosis whether they used CLI or asked Claude. That is the point.

## Data Flow

### Flow A: `recovery-ledger sync --days 30`

```
argv ──► cli/commands/sync.ts
            │ parse, validate via Zod
            ▼
        services.runSync({ days: 30 })
            │
            ▼  ┌───────────────────────────────────────────────────┐
        sync.service.ts                                            │
            │  1. begin sync_runs row (status='running')           │
            │  2. for each resource [cycles, recovery, sleep,      │
            │     workouts, profile, body_measurements]:           │
            │       a. whoop.<resource>.list({ since, until })     │
            │          ├─► token-store.getValidAccessToken         │
            │          │   ├─► single-flight refresh if needed     │
            │          │   └─► writes new tokens atomically        │
            │          ├─► rate-limit gate (honors 429 + jitter)   │
            │          ├─► retry on 5xx / network (exp backoff)    │
            │          └─► Zod validate response                   │
            │       b. domain/normalize/<resource>.ts (raw→entity) │
            │       c. repositories/<resource>.repo.upsert(rows)   │
            │       d. record per-resource success/fail counts     │
            │  3. recompute daily_summaries for affected days      │
            │  4. write sync_runs row (status, counts, gaps)       │
            ▼
        RunSyncResult { perResource, totalNew, gaps, durationMs }
            │
            ▼
        formatters/sync.txt.ts (if --text or MCP fallback) ──► stdout / MCP content
```

Notes:
- **Partial failure is normal.** If `workouts` 429s but `cycles` succeed, the run is marked `partial`, not failed. Per-resource error appears in result.
- **Idempotent upserts.** Repositories upsert by WHOOP's stable IDs. Re-running `sync` is safe.
- **No live API in tests.** The integration test injects a `FakeWhoopClient` that reads `test/fixtures/whoop-api/*.json`.

### Flow B: `recovery-ledger review daily`

```
argv ──► cli/commands/review-daily.ts
            ▼
        services.getDailyReview({ date: today, days: 30 })
            │
            ▼  ┌───────────────────────────────────────────────────┐
        review.service.ts (pure orchestration — NO HTTP)           │
            │  1. repositories.recovery.byRange(today-30d, today)  │
            │     repositories.sleep.byRange(...)                  │
            │     repositories.workouts.byRange(...)               │
            │     repositories.cycles.byRange(...)                 │
            │  2. domain/baselines/rolling-30d.ts                  │
            │       → BaselineStats { mean, stdev, n }             │
            │  3. domain/baselines/gating.ts                       │
            │       → ConfidenceGate (strong/weak/insufficient)    │
            │  4. domain/anomalies/deltas.ts(today, baseline)      │
            │       → Anomaly[]                                    │
            │  5. if confidence != 'insufficient':                 │
            │        derive up to 3 SuggestedAction               │
            │     else: actions = []                               │
            ▼
        DailyReviewView { today, baseline, anomalies, actions, confidence }
            │
            ▼
        formatters/daily-review.txt.ts ──► stdout (or JSON if --json)
```

The service does zero I/O against WHOOP. A daily review is *always* against cached data. This means it's fast, offline-capable, and the answer is deterministic for the same input.

### Flow C: MCP `whoop_daily_review`

```
stdin (JSON-RPC) ──► mcp/index.ts (StdioServerTransport)
            ▼
        mcp/tools/whoop-daily-review.ts handler
            │  1. validate input { date?: string } via Zod
            │  2. const result = await services.getDailyReview({ date })
            │  3. return {
            │       content: [{
            │         type: 'text',
            │         text: formatters.dailyReview(result)
            │       }],
            │       structuredContent: result,   // same object, untransformed
            │       isError: false
            │     }
            ▼
        stdout (JSON-RPC) ──► client
```

The structured field is the raw `DailyReviewView`. The text field is the same renderer the CLI uses. This is the entire reason `formatters/` lives outside both transports.

Critically: **the MCP handler imports the same `services.getDailyReview` the CLI does.** No second code path.

### Flow D: `decision add` (CLI or MCP)

```
CLI:  recovery-ledger decision add \
        --action "Zone 2, 45m" \
        --rationale "Recovery 41, sleep 6h2m, two reds last week" \
        --expected "Recovery >60 tomorrow" \
        --followup 2026-05-13

MCP:  whoop_add_decision { action, rationale, expected, followupDate }

both ──► services.addDecision(input)
            │  1. Zod validate input
            │  2. (optional) snapshot today's DailyReviewView for context
            │  3. repositories.decisions.insert({
            │       id: ulid(),
            │       createdAt: clock(),
            │       action, rationale, expected, followupDate,
            │       contextSnapshot: { recovery, sleep, strain } | null,
            │       outcome: null
            │     })
            ▼
        AddDecisionResult { id, createdAt }
            ▼
        formatters/decision.txt.ts ──► same text on both transports
```

`decision review` is symmetric: services.reviewDecisions reads ledger rows, joins to current cache state for "outcome so far", and returns a list. The same `formatters/decision.txt.ts` renders for both.

### State Management

The "state" is the SQLite file. There's no in-memory store, no event bus. Each command/tool opens (or reuses) a Drizzle connection, executes, and returns. This is appropriate for a single-user, single-process tool.

Two processes (CLI and MCP) may run simultaneously. SQLite WAL mode handles this: multiple readers + one writer, both processes safe. We set `PRAGMA journal_mode=WAL`, `PRAGMA busy_timeout=5000`, `PRAGMA synchronous=NORMAL` on connection.

## Application Layer Interface (Contract)

This is the *only* surface CLI and MCP know about. Stable, narrow, total.

```typescript
// src/services/index.ts — abbreviated signatures

interface RunSyncInput {
  days?: number;              // default 7
  since?: string;             // ISO date, overrides days
  resources?: ResourceName[]; // default: all
}
interface RunSyncResult {
  status: 'ok' | 'partial' | 'failed';
  perResource: Record<ResourceName, ResourceSyncOutcome>;
  totalNew: number;
  gaps: ApiGap[];             // detected during this run
  durationMs: number;
  syncRunId: string;
}

interface DailyReviewInput  { date?: string; baselineDays?: number; }
interface DailyReviewResult extends DailyReviewView {}

interface WeeklyReviewInput { weekOf?: string; }
interface WeeklyReviewResult extends WeeklyReviewView {
  worstDays: WorstDay[];
  precedingPatterns: PrecedingPattern[]; // each carries its own ConfidenceGate
  confidence: ConfidenceGate;
}

interface AddDecisionInput {
  action: string;
  rationale: string;
  expected: string;
  followupDate: string;       // ISO date
  tags?: string[];
}
interface AddDecisionResult { id: string; createdAt: string; }

interface ReviewDecisionsInput {
  status?: 'open' | 'due' | 'closed' | 'all';
  since?: string;
}
interface ReviewDecisionsResult { decisions: DecisionWithOutcome[]; }

interface QueryCacheInput {
  resource: ResourceName;
  since?: string;
  until?: string;
  limit?: number;
}
interface QueryCacheResult<T = unknown> { rows: T[]; count: number; }

interface DoctorResult {
  checks: Array<{ name: string; status: 'pass' | 'warn' | 'fail'; detail: string }>;
  overall: 'pass' | 'warn' | 'fail';
}

interface ApiGapResult {
  unavailable: Array<{ feature: string; reason: string; suggestion?: string }>;
}
```

**Error contract:** every method may resolve to a typed result OR throw `ServiceError` (discriminated union). CLI wrappers and MCP wrappers each have a single `handle(err)` translator. We do not surface raw `WhoopApiError` past the service boundary — services convert at their boundary.

**Idempotency:** `runSync`, `getDailyReview`, `getWeeklyReview`, `runDoctor`, `getApiGap`, `queryCache`, `reviewDecisions` are all safe to call repeatedly. `addDecision` is not idempotent by design — multiple identical calls create multiple ledger entries (this matches user intent: re-running the command should not silently merge).

## Domain Model (Tables → TS Types → Zod Schemas)

Three kinds of types, all under `src/domain/`:

1. **Raw API types** — `domain/types/raw.ts`. These are exactly what WHOOP returns. Zod-inferred. They die at the normalization boundary.
2. **Entity types** — `domain/types/entities.ts`. Normalized, snake_case → camelCase, durations stored as seconds (numbers), timestamps as ISO strings. These mirror Drizzle table rows 1:1. Repositories return these.
3. **View types** — `domain/types/views.ts`. Derived shapes (`DailyReviewView`, `WeeklyReviewView`, `Anomaly`, `BaselineStats`, etc.). Services return these. Never persisted.

Schema map:

| Drizzle table | Entity type | Zod schema | Notes |
|---|---|---|---|
| `cycles` | `Cycle` | `CycleSchema` | strain.score, day strain. |
| `recoveries` | `Recovery` | `RecoverySchema` | recovery_score, resting_hr, hrv_rmssd_ms. |
| `sleeps` | `Sleep` | `SleepSchema` | stages, durations in sec, performance %. |
| `workouts` | `Workout` | `WorkoutSchema` | sport, strain, kJ, HR zones. |
| `daily_summaries` | `DailySummary` | `DailySummarySchema` | Pre-aggregated per local day — derived, regenerated on sync. |
| `decisions` | `Decision` | `DecisionSchema` | id (ULID), action, rationale, expected, followup_date, context_snapshot (JSON), outcome (nullable). |
| `oauth_tokens` | `Tokens` | `TokensSchema` | Single-row table or single JSON file — see "Configuration / Paths". |
| `sync_runs` | `SyncRun` | `SyncRunSchema` | id, started_at, finished_at, status, per_resource (JSON), gaps (JSON). |

**Why three layers and not just one:**
- Raw API can change shape per WHOOP versioning; normalization centralizes that pain.
- Entities track the DB; view types track product surface. Mixing them couples DB changes to MCP tool output shape, which is a bad coupling for a public-ish surface (LLM clients).

**Why Zod everywhere:**
- WHOOP API responses are validated at the boundary — corrupt responses fail loudly, not silently.
- MCP tool inputs use Zod schemas; the MCP SDK accepts them directly for `inputSchema`.
- CLI args validated with the same schemas.

## Migrations (Drizzle for a Personal Local DB)

This is the right shape for a single-user local DB where data is precious:

1. **Schema is the source of truth.** `infrastructure/db/schema.ts` defines all tables in Drizzle DSL.
2. **`drizzle-kit generate` produces versioned SQL.** Committed to `infrastructure/db/migrations/`. Includes `_journal.json`.
3. **App runs migrator at startup, every time.** In `infrastructure/db/migrate.ts`:

```typescript
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import Database from 'better-sqlite3';

export function openDb(path: string) {
  const sqlite = new Database(path);
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('busy_timeout = 5000');
  sqlite.pragma('synchronous = NORMAL');
  sqlite.pragma('foreign_keys = ON');
  const db = drizzle(sqlite);
  migrate(db, { migrationsFolder: pathToMigrations() });
  return { db, sqlite };
}
```

Drizzle tracks applied migrations in `__drizzle_migrations`. On a schema bump, the user runs the CLI or MCP and the migration applies automatically — no separate `migrate` subcommand required (though `recovery-ledger doctor` should report current schema version and pending migrations as a sanity check).

**Migration discipline for a personal tool:**
- Never edit a shipped migration. Always generate a new one.
- For breaking changes (e.g., renaming columns), generate a multi-step migration: add new column → backfill in SQL → drop old → constraint adjustments. Drizzle Kit prompts for this during generation; we accept the prompts and commit.
- `drizzle-kit push` is **forbidden** outside dev — it does not produce a migration file and would diverge user DBs from the team's.
- Tag the DB file with `PRAGMA user_version` matching app major version so `doctor` can warn if an old binary opens a newer DB.

**Data preservation rule:** because the DB *is* the user's data (the cache rebuilds, but `decisions` is irreplaceable), `doctor` performs a "would auto-backup" check before any migration that drops columns. The migrator runs against a copy of `db.sqlite` at `~/.recovery-ledger/backups/db.<timestamp>.sqlite` when a destructive migration is about to apply. Cheap insurance for a personal tool.

## Baselines and Review Logic (Pure Functions Over Query Results)

All baseline and pattern code lives in `domain/baselines/` and `domain/patterns/`. They take arrays of entity rows and return result objects. No DB, no HTTP.

```typescript
// src/domain/baselines/rolling-30d.ts
export interface BaselineStats {
  metric: string;             // "recovery", "rhr", "hrv", "sleep_performance"
  mean: number;
  stdev: number;
  median: number;
  n: number;                  // actual non-null sample count
  windowDays: number;         // requested window (e.g., 30)
}

export function rolling30d(
  rows: Array<{ date: string; value: number | null }>,
  asOf: Date,
  windowDays = 30
): BaselineStats { /* ... */ }

// src/domain/baselines/gating.ts
export function gateConfidence(
  stats: BaselineStats,
  rule: { minSamples: number; minCoverageRatio: number }
): ConfidenceGate {
  if (stats.n < rule.minSamples) {
    return { tier: 'insufficient', reason: `Only ${stats.n}/${stats.windowDays} days have data`, sampleSize: stats.n, minRequired: rule.minSamples };
  }
  const coverage = stats.n / stats.windowDays;
  if (coverage < rule.minCoverageRatio) {
    return { tier: 'weak', reason: `Sparse data (${Math.round(coverage * 100)}%)`, sampleSize: stats.n, minRequired: rule.minSamples };
  }
  return { tier: 'strong', reason: 'Sufficient data', sampleSize: stats.n, minRequired: rule.minSamples };
}
```

**Confidence-tier rules** (proposed defaults; tunable in config):

| Tier | Condition |
|---|---|
| `strong` | n ≥ 20 of last 30 days AND coverage ≥ 70% AND stdev > 0 |
| `weak`   | n ≥ 10 AND < strong threshold; reported but no `actions` |
| `insufficient` | n < 10 OR stdev == 0 (degenerate); produces "no reliable pattern detected" |

**Worst-day pattern check (weekly):** in `domain/patterns/worst-recovery-days.ts`, given a week's `Recovery[]`, return the lowest 1-2 days; in `preceding-factors.ts`, examine prior 24-48h sleep duration, sleep performance, prior day strain, late workouts. Return a `PrecedingPattern[]` where each pattern carries its own `ConfidenceGate` — *one* "no reliable pattern" answer per investigation, not a single global flag.

**Why pure functions:**
- Each rule is one file. Adding a new derived metric is one file in `domain/baselines/` + one line in `review.service.ts`. This is the maintenance promise in PROJECT.md.
- Tests live next door: `domain/baselines/rolling-30d.test.ts` calls the function with array literals.

## MCP Tool Shape (Structured JSON + Text Fallback)

Each tool follows the same skeleton:

```typescript
// src/mcp/tools/whoop-daily-review.ts
import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { Services } from '../../services';
import { renderDailyReview } from '../../formatters/daily-review.txt';

export function registerDailyReview(server: McpServer, services: Services) {
  server.registerTool(
    'whoop_daily_review',
    {
      title: 'Daily recovery review',
      description: 'Today vs 30-day baseline, anomalies, and up to 3 suggested actions.',
      inputSchema: { date: z.string().optional() },
    },
    async ({ date }) => {
      const result = await services.getDailyReview({ date });
      return {
        content: [{ type: 'text', text: renderDailyReview(result) }],
        structuredContent: result,
      };
    },
  );
}
```

**Where does JSON→text live?** In `src/formatters/`, shared with the CLI. Not in each MCP tool. One formatter per result type. The CLI imports them for `--text`/default rendering; MCP tools import them for the `text` content fallback. This is the structural enforcement that prevents drift between CLI output and MCP text output.

**Stdio safety:** MCP tools must never write to stdout (it corrupts JSON-RPC). The shared logger writes to stderr only. CLI uses the same logger for debug output; user-facing stdout is reserved for the rendered text.

**Resources:** `whoop://summary/today` etc. follow the same pattern but return only `text` and `mimeType: 'application/json'`. Same services, same formatters.

**Prompts:** `whoop_daily_decision_brief` etc. live in `src/mcp/prompts/`. They are short templated message lists referencing the resources by URI; they do *not* call services directly. This keeps prompts cacheable and side-effect-free.

## Build Order

Strict dependency order. Each item is independently testable when the one above it is in place.

| Step | Component | Unblocks | Verification |
|---|---|---|---|
| 1 | `infrastructure/config/paths.ts` + `env.ts` + `logger.ts` | Everything | Unit test: paths resolve, env override works, logger writes to stderr |
| 2 | `domain/types/` + `domain/schemas/` (raw + entities + views) | DB layer, WHOOP client, services | Type-check + Zod round-trip tests on fixtures |
| 3 | `infrastructure/db/schema.ts` + `connection.ts` + `migrate.ts` | Repositories | Open in-memory SQLite, run migrate, assert tables exist |
| 4 | `infrastructure/db/repositories/*.repo.ts` | Services | Insert + read with fixture entities |
| 5 | `infrastructure/whoop/client.ts` + `oauth.ts` + `token-store.ts` (with single-flight) | Sync service | Unit tests with `fetch` mocked; concurrency test for refresh |
| 6 | `infrastructure/whoop/resources/*.ts` + `rate-limit.ts` + `retry.ts` | Sync service | Contract tests with `test/fixtures/whoop-api/*.json` |
| 7 | `domain/normalize/*.ts` | Sync service | Pure: raw fixture → entity, snapshot-test |
| 8 | `domain/baselines/*` + `domain/anomalies/*` + `domain/patterns/*` | Review services | Pure unit tests on array literals |
| 9 | `services/sync.service.ts` | CLI/MCP sync | Integration test with FakeWhoopClient + in-memory SQLite |
| 10 | `services/cache.service.ts` + `services/api-gap.service.ts` | doctor, query-cache tool | Unit |
| 11 | `services/review.service.ts` (daily, then weekly) | review CLI/MCP | Integration with seeded DB |
| 12 | `services/decision.service.ts` | decision CLI/MCP | Integration |
| 13 | `services/doctor.service.ts` | doctor CLI/MCP | Integration; intentionally break things to assert warnings |
| 14 | `formatters/*` | CLI rendering, MCP text fallback | Snapshot tests |
| 15 | `cli/` (commands + bin shim) | First end-to-end use | E2E: spawn CLI against fixture stack |
| 16 | `mcp/` (tools + resources + prompts + bin shim) | First Claude Code call | E2E: spawn MCP server, send JSON-RPC, assert responses |

**Rationale for the order:** types unblock everything (changing them later is expensive); DB before WHOOP because sync writes are validated by reading them back; normalize before baselines because baselines consume normalized entities; services before transports because both transports are thin; CLI before MCP because CLI is faster to iterate against (no JSON-RPC ceremony) and shakes out service issues that would otherwise show up at the MCP tool level.

**Parallelizable forks:** step 8 (domain math) can proceed in parallel with steps 5-6 (WHOOP client), since they don't share files. Step 14 (formatters) can begin once view types exist (step 2) and a couple of services have shapes locked.

## Testing Seams

The architecture is designed so tests *never* require live WHOOP calls and *never* require a real filesystem DB beyond a temp path.

| Seam | Where injected | What gets swapped |
|---|---|---|
| `WhoopClient` interface | `createServices({ whoop, ... })` factory | `FakeWhoopClient` that reads `test/fixtures/whoop-api/*.json`; can be programmed to return 401, 429, 5xx for failure scenarios |
| `DbConnection` | `createServices({ db, ... })` factory | In-memory `better-sqlite3` (`:memory:`) with same migrations applied |
| `clock` | `createServices({ clock, ... })` factory | `() => new Date('2026-05-11T07:00:00Z')` for deterministic baselines |
| `config.paths` | `paths.ts` reads `RECOVERY_LEDGER_HOME` env var | Tests set this to a `tmpdir()` |
| Token store | `infrastructure/whoop/token-store.ts` accepts `readTokens` and `writeTokens` injected | In-memory implementation in tests |
| `fetch` (last-resort for whoop client unit tests) | `infrastructure/whoop/client.ts` accepts `fetchImpl` | `vitest`'s `vi.fn()` for fine-grained HTTP scenarios |

**Contract test pattern** (per WHOOP resource):

```typescript
// test/integration/sync.cycles.test.ts
test('sync upserts cycles and dedupes', async () => {
  const whoop = new FakeWhoopClient({
    cycles: [
      readFixture('cycles.page1.json'),
      readFixture('cycles.page2.json'),
      { records: [], next_token: null },
    ],
  });
  const services = createServices({ whoop, db: openMemoryDb(), clock: fixedClock, ... });
  const r1 = await services.runSync({ days: 7, resources: ['cycles'] });
  const r2 = await services.runSync({ days: 7, resources: ['cycles'] });
  expect(r1.perResource.cycles.newRows).toBeGreaterThan(0);
  expect(r2.perResource.cycles.newRows).toBe(0);
});
```

**E2E tests** spawn the actual CLI binary or MCP server subprocess against the fake-client services build (a dedicated `test` entry that wires `FakeWhoopClient` instead of `WhoopClient`). This validates `bin/` shims, exit codes, and JSON-RPC framing.

**Per the constraint in PROJECT.md:** suite must run under 60s. The above is consistent with that — no network, no real DB file, fixtures are bytes-on-disk.

## Configuration / Paths

```
~/.recovery-ledger/
├── config.json              # non-secret prefs (timezone override, baseline window default)
├── db.sqlite                # the cache + decisions ledger
├── db.sqlite-wal            # WAL companion (managed by SQLite)
├── db.sqlite-shm
├── tokens.json              # OAuth tokens (mode 0600) — see token store
├── backups/
│   └── db.<ISO-timestamp>.sqlite
└── logs/
    └── recovery-ledger.<date>.log
```

**Path resolution:**
- Default: `~/.recovery-ledger/`.
- Env override: `RECOVERY_LEDGER_HOME=/custom/path`. Tests use a tmpdir here.
- XDG fallback (optional, low priority): if `XDG_DATA_HOME` is set, use `$XDG_DATA_HOME/recovery-ledger/`.

**OAuth credentials** (WHOOP client id + secret) come from environment first (`WHOOP_CLIENT_ID`, `WHOOP_CLIENT_SECRET`), then `config.json`. The interactive `recovery-ledger auth` writes them to config if the user opts in; otherwise the user keeps them in their shell profile.

**Tokens** are stored in `tokens.json` with mode 0600. On macOS, an optional `--use-keychain` flag stores tokens in the OS keychain instead (via `node-keytar` or `child_process` to `security` — implementation detail; the abstraction is `TokenStore`). The token store interface is small: `read()`, `write(tokens)`, `clear()`. Single-flight refresh logic lives above this interface, not inside it.

**Why a single-row `oauth_tokens` table is NOT used (despite the handoff implying it):** tokens are read on every WHOOP call. Reading via Drizzle requires opening a DB connection just to read tokens, which couples WHOOP usage to DB readiness. A file is faster, simpler, and survives DB-rebuilds intact. If a future requirement (e.g., multi-account) emerges, a single-row table is a one-migration change. For v1: file. The `sync_runs`, `decisions`, and cache tables stay in SQLite.

## Concurrency (Token Refresh and DB Access)

**Token refresh:** single-flight pattern (Pattern 4 above). Works correctly *within* one process. Across processes (CLI and MCP simultaneously), a second process may issue its own refresh. We mitigate by:

1. **Atomic token writes** (write-temp-and-rename). No process ever reads a half-written file.
2. **Refresh-on-401, not just on expiry.** If a second process did a refresh that invalidated this process's refresh token, the next API call returns 401, we re-read tokens from disk (post-refresh by the other process), and retry once. Only if that also fails do we surface `auth_expired`.
3. **Cross-process advisory lock around refresh** via `fs.openSync` on `~/.recovery-ledger/tokens.lock` with `O_EXCL`. Short critical section: acquire lock → re-read tokens (someone else may have refreshed) → if still expired, refresh and write → release lock. Best-effort: stale locks (> 30s) are cleared.

**Database access:** SQLite WAL mode + `busy_timeout=5000` handles intra-process and cross-process contention. Repositories use Drizzle's transaction wrapper for multi-statement writes (sync's per-resource upsert batch is one transaction per resource). Reads do not block writes; one process writing (sync) does not stall the other process reading (`review daily`).

**Within a process:** `better-sqlite3` is synchronous; calls are serialized by the JS event loop. No connection pool needed.

## Error Handling (Uniform Surface Across CLI and MCP)

Already covered in Pattern 5 above. To restate the discipline:

1. **Adapters throw their own typed errors.** `WhoopApiError` from whoop adapter; `DbError` from db adapter.
2. **Services translate at their boundary** to `ServiceError` (discriminated union).
3. **CLI maps `ServiceError` → stderr message + exit code.** A small lookup table in `cli/render/exit-codes.ts`.
4. **MCP maps `ServiceError` → `{ isError: true, content: [...], structuredContent: { error: {...} } }`.** Same diagnosis text the CLI shows.
5. **`doctor` is the always-available debug surface.** It probes auth, token freshness, DB schema version, last sync, data quality, MCP transport readiness. CLI runs `doctor` interactively; MCP exposes `whoop_doctor`. Both call the same `services.runDoctor()`.

Rate limits (429): the WHOOP client honors `Retry-After`; the rate limiter in `infrastructure/whoop/rate-limit.ts` queues calls behind a soft cap to avoid hitting the limit at all. Sync reports a `partial` status when 429s couldn't be drained within the run budget — user sees "resume by re-running sync".

Expired tokens: surfaced once, with a single remediation: `recovery-ledger auth`. The MCP equivalent returns the same remediation string; Claude will then know to suggest the user run it.

Network failures: classified as `network` ServiceError with retry suggestion. `sync` resumes from `since` on next run (idempotent), so no data is lost.

## Scaling Considerations

This is a single-user, single-machine tool. The relevant "scale" is years of personal data and parallel MCP tool calls.

| Scale | Concerns | Approach |
|---|---|---|
| Day 1 — 30 days of data | None | SQLite trivially handles it |
| Year 1 — ~365 cycles + ~1000 workouts + ~365 recoveries + ~365 sleeps + decisions | Indexes on `(date)` and `(user_local_day)` columns | Add at schema time; Drizzle indexes |
| Year 3+ — ~1000 cycles, growing | Daily-summary table pre-aggregates queries | `daily_summaries` recomputed during sync from source tables; review services read summaries when possible |
| Parallel MCP tools (e.g., daily + weekly review fired together) | Token refresh stampede, DB write contention during sync | Single-flight refresh; WAL mode; sync holds writes, reviews are reads |
| Bulk historical sync (e.g., user backfills 2 years) | Rate limits, long runtime | Sync resumes from last successful timestamp; `--since` flag; rate limiter paces |

### Scaling Priorities

1. **First bottleneck (likely):** WHOOP API rate limits during historical backfill. Fix: respect 429 + Retry-After; budget per minute; resume from last cursor.
2. **Second bottleneck:** weekly review query latency once years of workouts accumulate. Fix: query through `daily_summaries`, not raw tables, for any aggregation older than 30 days.
3. **Non-bottleneck:** SQLite size. Per WHOOP v2 docs, a typical user generates ~hundreds of KB/year in raw JSON. After normalization, ~tens of KB/year. Years in, the DB is still tens of MB.

## Anti-Patterns

### Anti-Pattern 1: Business Logic in MCP Tool Handlers

**What people do:** Implement the daily review computation inside `mcp/tools/whoop-daily-review.ts` because "it's quick".
**Why it's wrong:** The CLI version must duplicate it, or worse, call the MCP server in a subprocess. Both transports drift. Tests must mock JSON-RPC.
**Do this instead:** Tool handlers are 5-line shims over `services.getDailyReview`. All logic lives in `services/review.service.ts`.

### Anti-Pattern 2: Throwing `WhoopApiError` Across the Service Boundary

**What people do:** Let `WhoopApiError` propagate from infrastructure all the way to the CLI/MCP, then catch it in two places with different handling.
**Why it's wrong:** Two surfaces, two error languages, drift. Also leaks WHOOP-specific terminology into the user-facing error.
**Do this instead:** Services catch infrastructure errors and translate to `ServiceError` (discriminated union). Transports map `ServiceError` once.

### Anti-Pattern 3: Drizzle Row Types in Service or Domain Code

**What people do:** Import `cyclesTable.$inferSelect` types into `domain/baselines/`.
**Why it's wrong:** Domain math is now coupled to DB schema; renaming a column breaks pure functions.
**Do this instead:** Repositories return `Cycle` entities (from `domain/types/entities.ts`). Drizzle types live only inside `infrastructure/db/repositories/`.

### Anti-Pattern 4: Token Refresh on Every API Call

**What people do:** "To be safe", refresh the token before every WHOOP call.
**Why it's wrong:** Burns the refresh token; WHOOP rotates refresh tokens, so this is doubly bad. Also slow.
**Do this instead:** Refresh when the token is within 5 minutes of expiry OR after a 401. Use single-flight to coalesce concurrent refreshes.

### Anti-Pattern 5: Computing Baselines Inside SQL

**What people do:** Write a CTE that returns "30-day baseline plus today's delta" because SQL feels powerful.
**Why it's wrong:** Confidence gating, anomaly thresholds, and pattern rules are product logic. Once they're in SQL, you can't unit-test them against array literals, you can't add a new metric in one file, and reviewing tests becomes reading SQL.
**Do this instead:** Repositories return rows. `domain/baselines/` computes in TypeScript. The maintenance constraint in PROJECT.md ("one derived metric in one documented pattern") is impossible to honor with SQL-side stats.

### Anti-Pattern 6: Writing to stdout from MCP Server Code

**What people do:** `console.log("synced")` inside an MCP tool handler.
**Why it's wrong:** Stdout is the JSON-RPC transport; logging there corrupts the protocol and silently breaks the client.
**Do this instead:** All logging via the shared logger which writes to stderr (or a file under `~/.recovery-ledger/logs/`). The CLI is free to write to stdout because it owns its own stdout; the MCP server is not.

### Anti-Pattern 7: Eager Schema Push Instead of Versioned Migrations

**What people do:** Use `drizzle-kit push` to keep the user's DB in sync with the latest schema.
**Why it's wrong:** No history, no auto-backup before destructive changes, no `__drizzle_migrations` provenance. A user who shipped two app versions and skipped one can end up in a divergent state.
**Do this instead:** Always generate migrations, ship them in the package, run `migrate()` at startup.

### Anti-Pattern 8: Inventing a Pattern When Data is Sparse

**What people do:** Return "low recovery is correlated with late workouts" from a 4-sample week.
**Why it's wrong:** Violates the "transparent uncertainty" product principle in PROJECT.md and erodes user trust on day one.
**Do this instead:** Confidence gating returns `insufficient`; the renderer prints "No reliable pattern detected (4/30 days)". This is enforced in types: `actions` is empty unless tier is not `insufficient`.

## Integration Points

### External Services

| Service | Integration Pattern | Notes |
|---|---|---|
| WHOOP API v2 (`api.prod.whoop.com`) | OAuth2 (BYO app); `offline` scope for refresh tokens; per-resource REST GETs paginated at 25 records | Read-only. Refresh endpoint at `/oauth/oauth2/token`. Rotating refresh tokens require single-flight + 401 retry strategy. |
| MCP clients (Claude Code, Claude Desktop, Cursor) | `StdioServerTransport`; tools registered via `server.registerTool` with Zod input schemas | Tools return `{ content, structuredContent, isError }`. No stdout logging. |
| OS Keychain (optional, macOS) | `node-keytar` or `security` CLI behind a `TokenStore` interface | Opt-in via `--use-keychain` flag; default is file. |

### Internal Boundaries

| Boundary | Communication | Notes |
|---|---|---|
| CLI ↔ services | direct function call | CLI passes parsed args; receives plain objects; renders via formatters |
| MCP ↔ services | direct function call | Tool handlers are shims; structured content is the service result; text content is formatter output |
| services ↔ domain | direct function call | Services pass entity arrays to pure domain functions and receive view objects |
| services ↔ infrastructure | through `WhoopClient`, `DbConnection`, `Logger`, `Clock` injected at `createServices` | The seam tests swap |
| infrastructure/whoop ↔ infrastructure/db | none direct | They do not import each other. Coordination happens in services. |
| formatters ↔ services | type imports only | Formatters consume view types; never call services. |

## Sources

- [Drizzle ORM — Migrations](https://orm.drizzle.team/docs/migrations) — versioned generate/migrate workflow; `__drizzle_migrations` table
- [Drizzle ORM — drizzle-kit migrate](https://orm.drizzle.team/docs/drizzle-kit-migrate) — programmatic migrator API; SQLite synchronous behavior
- [Drizzle ORM — Apply migrations from code](https://github.com/drizzle-team/drizzle-orm/discussions/4344) — `drizzle-orm/better-sqlite3/migrator` startup pattern
- [WHOOP for Developers — OAuth 2.0](https://developer.whoop.com/docs/developing/oauth/) — scopes and authorization flow
- [WHOOP for Developers — Refreshing Access Tokens](https://developer.whoop.com/docs/tutorials/refresh-token-javascript/) — refresh endpoint, `offline` scope requirement
- [WHOOP for Developers — v1 to v2 Migration](https://developer.whoop.com/docs/developing/v1-v2-migration/) — current resource paths and pagination
- [MCP TypeScript SDK — Server docs](https://github.com/modelcontextprotocol/typescript-sdk/blob/main/docs/server.md) — `registerTool`, `StdioServerTransport`, response shape
- [MCP TypeScript SDK — issue #1760](https://github.com/modelcontextprotocol/typescript-sdk/issues/1760) — known refresh-token race; motivates single-flight
- [better-sqlite3 — WAL mode and performance](https://github.com/WiseLibs/better-sqlite3/blob/master/docs/performance.md) — WAL pragma, single-writer, NORMAL synchronous default
- [SQLite — Write-Ahead Logging](https://sqlite.org/wal.html) — concurrent readers + single writer semantics
- [Single-Flight Pattern](https://luminary.blog/techs/04-single-flight-pattern/) — generic pattern reference
- [Nango — Concurrency with OAuth token refreshes](https://nango.dev/blog/concurrency-with-oauth-token-refreshes) — practical TS implementation patterns
- [Hexagonal Architecture & Clean Architecture (TypeScript)](https://dev.to/dyarleniber/hexagonal-architecture-and-clean-architecture-with-examples-48oi) — ports & adapters in TS for multi-transport apps

---
*Architecture research for: local-first TS CLI + MCP server (Recovery Ledger)*
*Researched: 2026-05-11*
