# Phase 3: Data Model, DB Layer & Sync Loop - Pattern Map

**Mapped:** 2026-05-16
**Files analyzed:** ~75 new/modified files (excludes generated migrations and per-resource fixture JSON; ~9 resource-shaped patterns are encoded once)
**Analogs found:** 65 / 75 (10 files have no in-repo analog — flagged below)

This PATTERNS.md is downstream of `03-CONTEXT.md` (34 D-* decisions locked) and `03-RESEARCH.md` (7-wave plan; 10 named patterns). It is the planner's analog index — every new file maps to the closest existing shipped file plus the load-bearing excerpt to copy.

---

## File Classification

Phase 3 ships across six directories. Roles are clustered; each cluster shares one analog plus minor deltas.

### Cluster A — DB Layer (`src/infrastructure/db/`)

| New File | Role | Data Flow | Closest Analog | Match Quality |
|---|---|---|---|---|
| `src/infrastructure/db/connection.ts` | infrastructure-bootstrap | one-shot resource open | `src/infrastructure/config/paths.ts` (singleton + factory pattern) | role-match |
| `src/infrastructure/db/schema.ts` | schema-DSL | declarative | no analog (greenfield) | none |
| `src/infrastructure/db/migrate.ts` | infrastructure-chokepoint | transactional batch | `src/services/refresh-orchestrator.ts` (three-layer-gate / chokepoint discipline) | role-match (gate shape) |
| `src/infrastructure/db/migrations/0000_*.sql` + `meta/_journal.json` + `meta/0000_snapshot.json` | generated artifact | n/a | no analog (drizzle-kit output) | none |
| `src/infrastructure/db/repositories/cycles.repo.ts` | repository | CRUD | no in-repo analog (first repository in the project) | none |
| `src/infrastructure/db/repositories/recovery.repo.ts` | repository | CRUD | sibling: `cycles.repo.ts` (Cluster A self-reference) | self |
| `src/infrastructure/db/repositories/sleep.repo.ts` | repository | CRUD | sibling: `cycles.repo.ts` | self |
| `src/infrastructure/db/repositories/workouts.repo.ts` | repository | CRUD | sibling: `cycles.repo.ts` | self |
| `src/infrastructure/db/repositories/profile.repo.ts` | repository | CRUD (single-row) | sibling: `cycles.repo.ts` with single-row delta | self |
| `src/infrastructure/db/repositories/body-measurements.repo.ts` | repository | CRUD (append-on-change) | sibling: `cycles.repo.ts` with append-on-change delta | self |
| `src/infrastructure/db/repositories/sync-runs.repo.ts` | repository | CRUD (lifecycle row) | sibling: `cycles.repo.ts` | self |
| `src/infrastructure/db/repositories/decisions.repo.ts` | repository | CRUD | sibling: `cycles.repo.ts` (table created Phase 3, surface Phase 4) | self |
| `src/infrastructure/db/repositories/daily-summaries.repo.ts` | repository | CRUD (Phase 4 writes; Phase 3 reads) | sibling: `cycles.repo.ts` | self |

### Cluster B — WHOOP HTTP Client (`src/infrastructure/whoop/`)

| New / Modified File | Role | Data Flow | Closest Analog | Match Quality |
|---|---|---|---|---|
| `src/infrastructure/whoop/client.ts` (NEW) | infrastructure-chokepoint | request-response (`fetch` + Zod-parse) | `src/infrastructure/whoop/oauth.ts` (`exchangeCode`: Zod-validated token-endpoint POST) | exact (transport + validation shape) |
| `src/infrastructure/whoop/pagination.ts` (NEW) | utility | iterator-over-pages | no exact analog (greenfield); duplicate-ID assertion mirrors `tests/helpers/msw-whoop-oauth.ts`'s hit-counter pattern conceptually | none |
| `src/infrastructure/whoop/rate-limit.ts` (NEW) | utility (in-process state) | semaphore | no exact analog (greenfield); module-singleton shape mirrors `src/infrastructure/config/paths.ts` | role-match |
| `src/infrastructure/whoop/retry.ts` (NEW) | utility | wrap + retry | `src/services/refresh-orchestrator.ts` (retry-budget=1 chokepoint) | role-match |
| `src/infrastructure/whoop/resources/cycles.ts` (NEW) | resource adapter | request-response (paginated) | `src/infrastructure/whoop/oauth.ts` (TokenResponseSchema + parse-at-boundary) | role-match |
| `src/infrastructure/whoop/resources/recovery.ts` (NEW) | resource adapter | request-response (paginated) | sibling: `cycles.ts` | self |
| `src/infrastructure/whoop/resources/sleep.ts` (NEW) | resource adapter | request-response (paginated) | sibling: `cycles.ts` | self |
| `src/infrastructure/whoop/resources/workouts.ts` (NEW) | resource adapter | request-response (paginated) | sibling: `cycles.ts` | self |
| `src/infrastructure/whoop/resources/profile.ts` (NEW) | resource adapter | request-response (single) | `src/infrastructure/whoop/oauth.ts` (single-shot) | role-match |
| `src/infrastructure/whoop/resources/body-measurements.ts` (NEW) | resource adapter | request-response (single) | `src/infrastructure/whoop/oauth.ts` (single-shot) | role-match |
| `src/infrastructure/whoop/errors.ts` (EXTEND) | error-union | type-system | `src/infrastructure/whoop/errors.ts` (`AuthError` FROZEN — sibling union pattern) | exact (file self-reference) |

### Cluster C — Domain (`src/domain/`)

| New File | Role | Data Flow | Closest Analog | Match Quality |
|---|---|---|---|---|
| `src/domain/types/score.ts` (NEW) | domain type | type-system | `src/infrastructure/whoop/errors.ts` `AUTH_ERROR_KINDS` discriminated-tuple pattern | role-match |
| `src/domain/types/entities.ts` (NEW) | domain type | type-system | no analog (first domain types) | none |
| `src/domain/types/sync.ts` (NEW) | domain type | type-system | `src/services/doctor/index.ts` (`DoctorCheck` / `DoctorResult` shapes) | role-match |
| `src/domain/schemas/whoop-api.ts` (NEW) | Zod schema | validation | `src/infrastructure/whoop/oauth.ts` `TokenResponseSchema` (snake_case passthrough) | exact |
| `src/domain/schemas/score.ts` (NEW) | Zod schema | validation (discriminated-union) | `src/infrastructure/whoop/oauth.ts` `CallbackQuerySchema` + `TokenResponseSchema` (Zod shape, no DU yet in repo) | role-match |
| `src/domain/schemas/entities.ts` (NEW) | Zod schema | validation | sibling: `whoop-api.ts` | self |
| `src/domain/normalize/cycles.ts` (NEW) | pure transform | input → output | no analog (first normalizer) | none |
| `src/domain/normalize/recovery.ts` (NEW) | pure transform | input → output | sibling: `cycles.ts` | self |
| `src/domain/normalize/sleep.ts` (NEW) | pure transform | input → output | sibling: `cycles.ts` | self |
| `src/domain/normalize/workouts.ts` (NEW) | pure transform | input → output | sibling: `cycles.ts` | self |
| `src/domain/normalize/profile.ts` (NEW) | pure transform | input → output | sibling: `cycles.ts` | self |
| `src/domain/normalize/body-measurements.ts` (NEW) | pure transform | input → output | sibling: `cycles.ts` | self |
| `src/domain/dst-tz/detect.ts` (NEW) | pure function | input → output | `src/services/doctor/index.ts` `deriveOverall` (pure rule + exhaustive narrowing) | role-match |

### Cluster D — Services (`src/services/`)

| New / Modified File | Role | Data Flow | Closest Analog | Match Quality |
|---|---|---|---|---|
| `src/services/sync/index.ts` (NEW) | service-orchestrator | sequential-batch | `src/services/doctor/index.ts` `runDoctor` (parallel composition with status precedence) | role-match (orchestrator shape) |
| `src/services/sync/per-resource.ts` (NEW) | service-helper | wrap + classify-error | `src/services/refresh-orchestrator.ts` `callWithAuth` (single try / classify / wrap) | role-match |
| `src/services/sync/cursor.ts` (NEW) | pure function | input → output | `src/services/doctor/index.ts` `deriveOverall` (pure unit-testable function) | role-match |
| `src/services/bootstrap.ts` (NEW) | service-bootstrap | initialization side-effect | `src/services/index.ts` `createServices` (factory shape) | role-match |
| `src/services/index.ts` (EXTEND) | services barrel | composition root | `src/services/index.ts` self (Phase 2 extension pattern) | exact (file self-reference) |

### Cluster E — CLI + Formatters (`src/cli/`, `src/formatters/`)

| New File | Role | Data Flow | Closest Analog | Match Quality |
|---|---|---|---|---|
| `src/cli/commands/sync.ts` (NEW) | CLI shim | argv → service → stdout | `src/cli/commands/auth.ts` (≤5-line shim shape; flag handling) | exact |
| `src/formatters/sync.txt.ts` (NEW) | formatter | structured → text | no in-repo analog (Phase 3 is first formatter); shape implied by conventions.md §Code style | none |

### Cluster F — Config Extension (`src/infrastructure/config/`)

| Modified File | Role | Data Flow | Closest Analog | Match Quality |
|---|---|---|---|---|
| `src/infrastructure/config/paths.ts` (EXTEND) | config-derived-paths | computed | `src/infrastructure/config/paths.ts` self (Plan 02-01 additions) | exact (file self-reference) |

### Cluster G — Tests (`tests/`)

| New File | Role | Data Flow | Closest Analog | Match Quality |
|---|---|---|---|---|
| `tests/helpers/msw-whoop-cycles.ts` (NEW) | test helper | fixture-server | `tests/helpers/msw-whoop-oauth.ts` (Plan 02-01) | exact |
| `tests/helpers/msw-whoop-recovery.ts` (NEW) | test helper | fixture-server | sibling: `msw-whoop-cycles.ts` | self |
| `tests/helpers/msw-whoop-sleep.ts` (NEW) | test helper | fixture-server | sibling: `msw-whoop-cycles.ts` | self |
| `tests/helpers/msw-whoop-workouts.ts` (NEW) | test helper | fixture-server | sibling: `msw-whoop-cycles.ts` | self |
| `tests/helpers/msw-whoop-profile.ts` (NEW) | test helper | fixture-server | sibling: `msw-whoop-cycles.ts` | self |
| `tests/helpers/msw-whoop-body-measurements.ts` (NEW) | test helper | fixture-server | sibling: `msw-whoop-cycles.ts` | self |
| `tests/helpers/in-memory-db.ts` (NEW) | test helper | in-memory bootstrap | no in-repo analog (Phase 3 first DB test helper) | none |
| `tests/fixtures/whoop/<resource>/<scenario>.json` (NEW; ~30 files) | test data | n/a | `tests/fixtures/oauth/token-200.json` (existing); `tests/fixtures/mcp/*.json` (Phase 1) | exact (shape) |
| `tests/contract/<resource>.test.ts` (NEW; 6 files) | contract test | fixture → service → assert | `src/services/refresh-orchestrator.test.ts` (Plan 02-04) for service composition; `tests/integration/auth-concurrency.test.ts` for fixture-driven shape | role-match |
| `tests/integration/sync/idempotency.test.ts` (NEW) | integration test | full-stack | `tests/integration/auth-concurrency.test.ts` | role-match |
| `tests/integration/sync/partial-failure.test.ts` (NEW) | integration test | full-stack | sibling: `idempotency.test.ts` | self |
| `tests/integration/sync/migration-crash.test.ts` (NEW) | integration test | subprocess-driven | `src/services/doctor/checks/mcp-stdout-purity.ts` (subprocess `spawn` discipline) | role-match (subprocess test pattern) |
| `tests/integration/sync/dst-fixture.test.ts` (NEW) | integration test | full-stack | sibling: `idempotency.test.ts` | self |
| `tests/integration/sync/pragma-roundtrip.test.ts` (NEW) | integration test | DB-level assert | sibling: `idempotency.test.ts` | self |

### Cluster H — Scripts + Config (root)

| New / Modified File | Role | Data Flow | Closest Analog | Match Quality |
|---|---|---|---|---|
| `scripts/ci-grep-gates.sh` (EXTEND — add Gate F + Gate G) | CI gate | grep | `scripts/ci-grep-gates.sh` self (Gate E shape, Plan 02-06) | exact (file self-reference) |
| `drizzle.config.ts` (NEW, repo root) | tool config | declarative | no analog (drizzle-kit specific) | none |
| `package.json` (EXTEND — 3 prod deps + 2 dev deps) | package manifest | declarative | n/a | n/a |

---

## Pattern Assignments

### Cluster A — DB Layer

#### A1. `src/infrastructure/db/connection.ts` (NEW)

**Role:** infrastructure-bootstrap. One factory function `openDb(path): {db, sqlite}` that sets six pragmas in fixed order.

**Analog:** `src/infrastructure/config/paths.ts` (factory + lazy singleton shape).

**Imports pattern** (analog lines 19, 87–93):

```typescript
// paths.ts (existing):
import { join } from 'node:path';
// ...
export const paths: ResolvedPaths = new Proxy({} as ResolvedPaths, {
  get(_target, prop) {
    const resolved = getResolved();
    return resolved[prop as keyof ResolvedPaths];
  },
});
```

**Connection bootstrap pattern** (from RESEARCH.md Pattern 1, lines 365–383 — exact code to write):

```typescript
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';

export function openDb(path: string) {
  const sqlite = new Database(path);
  // Fixed order per D-30. journal_mode must run first; it is the only
  // pragma that switches the DB into a different journaling shape.
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('busy_timeout = 5000');
  sqlite.pragma('journal_size_limit = 67108864'); // 64 MB
  sqlite.pragma('wal_autocheckpoint = 1000');
  sqlite.pragma('synchronous = NORMAL');
  sqlite.pragma('foreign_keys = ON');
  return { db: drizzle(sqlite), sqlite };
}
```

**Notes on deltas:** Unlike `paths.ts`'s lazy Proxy, `openDb` is called explicitly at bootstrap (no module-load singleton — every call returns a fresh handle). The pragma block is the load-bearing surface; the six lines must remain in this order.

---

#### A2. `src/infrastructure/db/schema.ts` (NEW)

**Role:** declarative Drizzle DSL. No analog — this is the first schema in the project.

**Skeleton to write** (from RESEARCH.md Pattern 2, lines 395–418 — code shape verbatim):

```typescript
import { sqliteTable, text, integer, real, index } from 'drizzle-orm/sqlite-core';

export const cycles = sqliteTable('cycles', {
  id: integer('id').primaryKey(),                       // int64 per WHOOP v2
  user_id: integer('user_id').notNull(),
  created_at: text('created_at').notNull(),
  updated_at: text('updated_at').notNull(),
  start: text('start').notNull(),
  end: text('end'),
  timezone_offset: text('timezone_offset').notNull(),
  score_state: text('score_state', { enum: ['SCORED', 'PENDING_SCORE', 'UNSCORABLE'] }).notNull(),
  strain: real('strain'),                               // SCORED-only — DU enforces at app boundary
  kilojoule: real('kilojoule'),
  average_heart_rate: integer('average_heart_rate'),
  max_heart_rate: integer('max_heart_rate'),
  baseline_excluded: integer('baseline_excluded', { mode: 'boolean' }).notNull().default(false),
  exclusion_reason: text('exclusion_reason'),           // 'dst_straddle' | 'tz_drift' | null
  raw_json: text('raw_json').notNull(),
}, (t) => ({
  byScoreStateStart: index('cycles_score_state_start_idx').on(t.score_state, t.start),  // D-05
}));
```

**Notes on deltas:** Nine tables total (D-01). Each scored entity (cycles, recoveries, sleeps, workouts) gets the `(score_state, start)` index per D-05 in the same migration that creates the table. `cycles.id` is `integer` (int64), `sleeps.id` / `workouts.id` are `text` (UUID) per A6 in RESEARCH.md. `recoveries` is keyed by `(cycle_id, sleep_id)` compound PK per A12.

---

#### A3. `src/infrastructure/db/migrate.ts` (NEW)

**Role:** infrastructure-chokepoint. Hand-rolled migrator (D-06 — NOT `drizzle-orm/better-sqlite3/migrator` because the default uses `BEGIN DEFERRED`, banned by Pitfall 13).

**Closest analog:** `src/services/refresh-orchestrator.ts` — the three-layer-gate / chokepoint discipline shape. The migrator is the DB-layer equivalent of the orchestrator: one named file owns the entire crash-recovery contract; everyone else calls it.

**Chokepoint discipline excerpt from analog** (`refresh-orchestrator.ts` lines 1–28):

```typescript
// Refresh orchestrator — the SINGLE chokepoint where the 401-reactive retry
// policy lives. token-store.ts owns refresh mechanics (the ADR-0002 three-layer
// gate); this module owns retry policy: attempt 1 → 401? → re-read tokens ...
//
// ADR-0002 §Consequences (single refresh consumer): "The token store is the
// only module that knows about refresh mechanics. ..."
```

**Migrator skeleton to write** (RESEARCH.md Pattern 3, lines 423–507 — code shape verbatim):

```typescript
import { readFileSync } from 'node:fs';
import { copyFileSync, existsSync, mkdirSync, readdirSync, statSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import type Database from 'better-sqlite3';

export class MigrationError extends Error {
  readonly kind: 'inconsistent_state' | 'apply_failed';
  readonly backupPath: string | null;
  readonly latestSafeMigration: string | null;
  // ... mirror AuthError shape (errors.ts lines 54–75)
}

export function migrate(
  sqlite: Database.Database,
  opts: { migrationsDir: string; backupsDir: string; dbFile: string }
): void {
  // 1. ensure __drizzle_migrations exists (shape per A2 in RESEARCH.md)
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS __drizzle_migrations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      hash TEXT NOT NULL,
      created_at NUMERIC
    );
  `);

  // 2. read meta/_journal.json (canonical migration list, not directory scan)
  const journal = JSON.parse(readFileSync(join(opts.migrationsDir, 'meta', '_journal.json'), 'utf8'));

  // 3. find pending
  const appliedHashes = new Set(
    sqlite.prepare('SELECT hash FROM __drizzle_migrations').all().map((r: any) => r.hash)
  );

  for (const entry of journal.entries) {
    const sqlPath = join(opts.migrationsDir, `${entry.tag}.sql`);
    const sql = readFileSync(sqlPath, 'utf8');
    const hash = hashSql(sql);
    if (appliedHashes.has(hash)) continue;

    // 4. PRE-MIGRATION BACKUP (D-07): .sqlite + -wal + -shm to backupsDir
    //    chmod 600; retention 3 (delete oldest by mtime)
    const backupPath = takeBackup(opts.dbFile, opts.backupsDir, entry.tag);

    // 5. BEGIN IMMEDIATE + exec whole file + insert __drizzle_migrations row + COMMIT
    sqlite.exec('BEGIN IMMEDIATE');
    try {
      sqlite.exec(sql);                                  // db.exec is multi-statement-aware
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

**MigrationError shape — copy `AuthError` shape verbatim** (`src/infrastructure/whoop/errors.ts` lines 29–75):

```typescript
// AuthError pattern to mirror for MigrationError:
export const AUTH_ERROR_KINDS = ['auth_missing', /* ... 5 more */] as const;
export type AuthErrorKind = (typeof AUTH_ERROR_KINDS)[number];

export interface AuthErrorInit {
  kind: AuthErrorKind;
  detail?: string;
  cause?: unknown;
}

export class AuthError extends Error {
  readonly kind: AuthErrorKind;
  readonly detail?: string;
  constructor(init: AuthErrorInit) {
    super(init.detail ?? init.kind, init.cause === undefined ? undefined : { cause: init.cause });
    this.kind = init.kind;
    if (init.detail !== undefined) {
      this.detail = init.detail;
    }
    this.name = 'AuthError';
  }
}
```

**Retention helper** (RESEARCH.md lines 891–904 — verbatim):

```typescript
function pruneBackups(backupsDir: string, keep = 3): void {
  const files = readdirSync(backupsDir)
    .filter((name) => name.endsWith('.sqlite'))
    .map((name) => ({ name, mtime: statSync(join(backupsDir, name)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime);
  for (const { name } of files.slice(keep)) {
    const base = name.slice(0, -'.sqlite'.length);
    for (const suffix of ['.sqlite', '.sqlite-wal', '.sqlite-shm']) {
      const path = join(backupsDir, base + suffix);
      try { unlinkSync(path); } catch { /* missing companion is fine */ }
    }
  }
}
```

**Notes on deltas:** This is a hand-rolled module with no in-repo analog; the chokepoint discipline + closed error union shape are imported from Phase 2. Wave 0 must run `drizzle-kit generate` once against a stub schema to confirm `meta/_journal.json` and `0000_snapshot.json` structure on-disk before locking the migrator (A1+A2+A11 in RESEARCH.md assumptions log).

---

#### A4. `src/infrastructure/db/repositories/<resource>.repo.ts` (NEW — one per resource)

**Role:** repository. Returns domain entity types, never Drizzle row types (D-28, ARCHITECTURE.md Anti-Pattern 3). Exposes `getRawJson(id)` as a separate diagnostic method per D-29.

**Closest analog:** None (Phase 3 is the first repository in the project). Document the contract here so all 9 repository files share the same shape.

**Repository contract to encode** (no existing code; this is the canonical shape for D-28 + D-29):

```typescript
// Source: D-28 + D-29 + ARCHITECTURE.md Anti-Pattern 3
import type { Database } from 'better-sqlite3';
import type { Cycle } from '../../../domain/types/entities.js';
import { cycles as cyclesTable } from '../schema.js';
// Note: drizzle-orm/* imports allowed here per Gate G (only inside src/infrastructure/db/)

export interface CyclesRepo {
  cursor(): Promise<string>;                                // COALESCE(MAX(updated_at), '1970-01-01T00:00:00Z')
  upsertBatch(rows: Cycle[]): Promise<{ changed: number }>; // BEGIN IMMEDIATE inside (D-31)
  byRange(start: string, end: string, opts?: {
    includeUnscored?: boolean;                              // D-04 escape hatch
    includeExcluded?: boolean;                              // D-16 escape hatch
  }): Promise<Cycle[]>;
  getRawJson(id: number): Promise<string | null>;           // D-29 diagnostic — domain never calls this
}

export function createCyclesRepo(db: Database): CyclesRepo {
  return {
    async cursor(): Promise<string> {
      const row = db.prepare(
        "SELECT COALESCE(MAX(updated_at), '1970-01-01T00:00:00Z') AS cursor FROM cycles"
      ).get() as { cursor: string };
      return row.cursor;
    },
    async upsertBatch(rows: Cycle[]): Promise<{ changed: number }> {
      // BEGIN IMMEDIATE per D-31; ON CONFLICT(id) DO UPDATE per D-11.
      const tx = db.transaction((rs: Cycle[]) => {
        let changed = 0;
        for (const r of rs) {
          const info = db.prepare(/* INSERT ... ON CONFLICT(id) DO UPDATE SET col=excluded.col ... */).run(/* ... */);
          changed += info.changes;
        }
        return changed;
      });
      // better-sqlite3 transaction wraps BEGIN/COMMIT; for BEGIN IMMEDIATE use db.transaction.immediate()
      const changed = tx.immediate(rows);
      return { changed };
    },
    async byRange(start, end, opts) {
      // Default filter: score_state = 'SCORED' AND baseline_excluded = 0 per D-04 + D-16.
      // ...
    },
    async getRawJson(id) {
      const row = db.prepare('SELECT raw_json FROM cycles WHERE id = ?').get(id) as { raw_json: string } | undefined;
      return row?.raw_json ?? null;
    },
  };
}
```

**Notes on deltas:**
- `cycles.id` is `integer` (int64); `sleeps.id` / `workouts.id` are `text` (UUID) — adapt the PK type per resource (A6 in RESEARCH.md).
- `recoveries.repo.ts` keys upsert on compound `(cycle_id, sleep_id)` (A12).
- `profile.repo.ts` is single-row (no `cursor` method; use `getCurrent()` instead).
- `body-measurements.repo.ts` is append-on-change (RESEARCH.md Open Question 3): compare-then-insert, no `cursor`.
- `sync-runs.repo.ts` has lifecycle methods `insertRunning() / updatePerResource() / finalize()` instead of `upsertBatch / byRange`.
- `decisions.repo.ts` ships minimal `insert / byId / listOpen` per RESEARCH.md Open Question 2.
- `daily-summaries.repo.ts` empty in Phase 3; Phase 4 baseline service writes to it.

---

### Cluster B — WHOOP HTTP Client

#### B1. `src/infrastructure/whoop/client.ts` (NEW)

**Role:** infrastructure-chokepoint. `httpGet<T>(path, query, schema)` wraps every WHOOP fetch through `callWithAuth` from `src/services/refresh-orchestrator.ts` **exactly once** (D-18 — preserves Plan 02-06 Gate E single-consumer invariant).

**Analog:** `src/infrastructure/whoop/oauth.ts` (`exchangeCode` lines 364–410) — Zod-validated WHOOP HTTP call.

**Imports pattern** (analog lines 54–61):

```typescript
import { createHash, randomBytes } from 'node:crypto';
import { z } from 'zod';
import { sanitize } from '../../mcp/sanitize.js';
import { logger } from '../config/logger.js';
import { AuthError } from './errors.js';
import { type Tokens, WHOOP_TOKEN_URL } from './token-store.js';
```

**Plumbing `callWithAuth` inside `httpGet`** (RESEARCH.md lines 828–858 — verbatim shape to write):

```typescript
import { z } from 'zod';
import { callWithAuth } from '../../services/refresh-orchestrator.js';
import { acquire, release } from './rate-limit.js';
import { classifyHttpError } from './errors.js';

export const WHOOP_API_BASE = 'https://api.prod.whoop.com';   // D-21; ADR-0007

export async function httpGet<T>(
  path: string,
  query: Record<string, string | number | undefined>,
  schema: z.ZodSchema<T>,
): Promise<T> {
  await acquire();                                            // D-20 semaphore-of-4
  let remainingHeader: string | null = null;
  try {
    const url = buildUrl(path, query);
    const res = await callWithAuth(async (accessToken) => {
      // The orchestrator handles 401 → re-read tokens → force refresh → retry once.
      const response = await fetch(url, {
        method: 'GET',
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      remainingHeader = response.headers.get('X-RateLimit-Remaining');
      return response;
    });
    if (res.status === 429) {
      throw classifyHttpError(res);                           // → WhoopApiError({kind: 'rate_limited'})
    }
    if (!res.ok) {
      throw classifyHttpError(res);
    }
    const json = (await res.json()) as unknown;
    return schema.parse(json);                                // Zod boundary validation
  } finally {
    release(remainingHeader);                                 // throttle next acquire if < 10
  }
}
```

**Token-endpoint POST pattern from `oauth.ts` (analog lines 379–391) — what to copy for response handling:**

```typescript
const obtainedAt = Date.now();
const res = await fetchFn(WHOOP_TOKEN_URL, {
  method: 'POST',
  headers: { 'content-type': 'application/x-www-form-urlencoded' },
  body: params,
});
if (!res.ok) {
  logger.warn({ event: 'exchange_failed', status: res.status });
  throw new AuthError({ kind: 'refresh_failed', detail: `token endpoint ${res.status}` });
}
let parsed: z.infer<typeof TokenResponseSchema>;
try {
  const json = (await res.json()) as unknown;
  parsed = TokenResponseSchema.parse(json);
} catch (err) {
  logger.warn({ event: 'exchange_parse_failed' });
  throw new AuthError({ kind: 'refresh_failed', cause: err });
}
```

**Notes on deltas:**
- GET-only per ADR-0007 (D-21). No POST/PUT/PATCH/DELETE on this client; token-endpoint POST stays in `token-store.ts` + `oauth.ts` only.
- `fetch` here is ONE of the three permitted call sites under new Gate F (others: `token-store.ts`, `oauth.ts`).
- Wrap retry on 5xx + 429 in a sibling `retry.ts` (composed in `client.ts`); RESEARCH.md Open Question 6 resolves that the operation closure returns the raw `Response` and headers are read inside the closure.
- Cap `X-RateLimit-Reset` sleep at 60s ceiling per A5 (defense-in-depth).

---

#### B2. `src/infrastructure/whoop/pagination.ts` (NEW)

**Role:** utility. `paginateAll<T>(fetchPage)` — owns snake↔camel translation (`next_token` response → `nextToken` request) per D-19 and Pitfall 10. Asserts no duplicate WHOOP IDs across consecutive pages.

**Analog:** None exact. Closest in-repo conceptual mirror: `tests/helpers/msw-whoop-oauth.ts`'s hit-counter pattern (a stateful loop with assertion) — but the utility itself is greenfield.

**Pagination skeleton** (RESEARCH.md Pattern 7, lines 598–624 — verbatim):

```typescript
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

**Notes on deltas:** Per-resource `PAGE_SIZE = 25` constants live in the per-resource module files, not here (D-19 design — grep-able per resource).

---

#### B3. `src/infrastructure/whoop/rate-limit.ts` (NEW)

**Role:** utility (in-process state). Module-level semaphore-of-4 + `X-RateLimit-Remaining < 10` throttle (D-20).

**Closest analog:** `src/infrastructure/config/paths.ts` (module-level singleton + lazy initialization pattern lines 79–93).

**Skeleton** (RESEARCH.md Pattern 8, lines 636–657 — shape to expand):

```typescript
const SEMAPHORE_SIZE = 4;
const REMAINING_THROTTLE_THRESHOLD = 10;
const RATE_LIMIT_RESET_SLEEP_CAP_MS = 60_000;  // A5 defense-in-depth

let pending: Array<() => void> = [];
let inFlight = 0;

export async function acquire(): Promise<void> { /* classic semaphore */ }

export function release(remainingHeader: string | null): void {
  const remaining = remainingHeader === null ? null : Number(remainingHeader);
  if (remaining !== null && remaining < REMAINING_THROTTLE_THRESHOLD) {
    setTimeout(actuallyRelease, 250 + Math.random() * 250);
  } else {
    actuallyRelease();
  }
}
```

**Notes on deltas:** Headers verified: `X-RateLimit-Limit` ("requests=100, window=60"), `X-RateLimit-Remaining` (integer-as-string), `X-RateLimit-Reset` (delta seconds — NOT epoch). No `Retry-After` documented (A5).

---

#### B4. `src/infrastructure/whoop/retry.ts` (NEW)

**Role:** utility. Jittered exp backoff on 5xx + 429 honoring `X-RateLimit-Reset`.

**Closest analog:** `src/services/refresh-orchestrator.ts` (retry-budget=1 chokepoint).

**Retry pattern from analog (refresh-orchestrator.ts lines 78–126) — what to mirror conceptually:**

```typescript
async function callWithAuthImpl<T>(operation, store) {
  const accessToken = await store.getValidAccessToken();
  const res = await operation(accessToken);
  if (res.status !== 401) return res;

  // 401 → re-read tokens. A sibling process may have refreshed between
  // attempt 1 and now.
  logger.warn({ event: '401_received', retry: true });
  const current = await store.read();
  if (current !== null && current.expiresAt > Date.now() + REFRESH_BUFFER_MS) {
    return operation(current.accessToken);
  }
  // Force refresh + retry exactly once.
  let freshAccessToken: string;
  try {
    freshAccessToken = await store.getValidAccessToken();
  } catch (refreshErr) {
    throw new AuthError({
      kind: 'auth_expired',
      detail: 'refresh failed; run `recovery-ledger auth` to re-authorize',
      cause: refreshErr,
    });
  }
  return operation(freshAccessToken);
}
```

**Retry skeleton for 5xx + 429 (RESEARCH.md lines 654–658):**

```typescript
// retry.ts on 429:
const resetSec = Number(res.headers.get('X-RateLimit-Reset') ?? '1');
const sleepMs = Math.min(resetSec * 1000 + jitter(), RATE_LIMIT_RESET_SLEEP_CAP_MS);
await sleep(sleepMs);
// retry once (capped attempts)
```

**Notes on deltas:** Retry budget is 1 for 5xx (mirror refresh-orchestrator); 429 is also retried once after sleeping the documented `X-RateLimit-Reset`. Auth retry stays inside `callWithAuth` — retry.ts does NOT chain into auth.

---

#### B5. `src/infrastructure/whoop/resources/<resource>.ts` (NEW — 6 files)

**Role:** resource adapter. Each module imports `httpGet` + `paginateAll` + its Zod schema. Single-shot for `profile` + `body-measurements`; paginated for the other four.

**Analog:** `src/infrastructure/whoop/oauth.ts` — `TokenResponseSchema` + `exchangeCode`. The Zod-snake_case-passthrough + parse-at-boundary pattern is identical.

**Zod schema pattern from analog (oauth.ts lines 148–156):**

```typescript
const TokenResponseSchema = z
  .object({
    access_token: z.string(),
    refresh_token: z.string(),
    expires_in: z.number().int().positive(),
    scope: z.string(),
    token_type: z.literal('bearer'),
  })
  .passthrough();
```

**`listCycles` consumer pattern (RESEARCH.md lines 862–881 — verbatim):**

```typescript
const CYCLES_PAGE_SIZE = 25;                              // A3 verified max

export async function listCycles(opts: { since: string; until: string }): Promise<Cycle[]> {
  const rows = await paginateAll(async (nextToken) => {
    const page = await httpGet(
      '/v2/cycle',
      {
        start: opts.since,
        end: opts.until,
        limit: CYCLES_PAGE_SIZE,
        nextToken: nextToken ?? undefined,                // omit if null on first call
      },
      WhoopCyclesPageSchema,                              // Zod schema for the page shape
    );
    return page;
  });
  return rows.map(normalizeCycle);                        // domain entity mapping
}
```

**Notes on deltas:**
- Resource modules NEVER reference `callWithAuth` directly (D-18). They call `httpGet` only.
- Single-shot resources (`profile`, `body-measurements`) skip `paginateAll`; just one `httpGet` call.
- WHOOP v2 endpoints DO NOT accept `updated_since`; resources paginate by `start >= since` (RESEARCH.md §Technical Research item 1). The 7-day re-window + `ON CONFLICT(id) DO UPDATE` handles retroactive updates.

---

#### B6. `src/infrastructure/whoop/errors.ts` (EXTEND)

**Role:** error-union. Add `WhoopApiError` as a sibling discriminated union; `AuthError` stays FROZEN at 6 kinds (D-22).

**Self-analog:** `src/infrastructure/whoop/errors.ts` — the existing `AuthError` pattern.

**Closed-tuple discriminated-union pattern to mirror (errors.ts lines 29–75):**

```typescript
// Existing AuthError — pattern to mirror for WhoopApiError.
export const AUTH_ERROR_KINDS = [
  'auth_missing',
  'auth_expired',
  'auth_state_mismatch',
  'auth_timeout',
  'auth_port_in_use',
  'refresh_failed',
] as const;

export type AuthErrorKind = (typeof AUTH_ERROR_KINDS)[number];

const AUTH_ERROR_KINDS_SET: ReadonlySet<string> = new Set(AUTH_ERROR_KINDS);

export class AuthError extends Error {
  readonly kind: AuthErrorKind;
  readonly detail?: string;

  constructor(init: AuthErrorInit) {
    super(init.detail ?? init.kind, init.cause === undefined ? undefined : { cause: init.cause });
    this.kind = init.kind;
    if (init.detail !== undefined) {
      this.detail = init.detail;
    }
    this.name = 'AuthError';
  }
}

export function isAuthError(err: unknown): err is AuthError {
  if (typeof err !== 'object' || err === null) return false;
  const e = err as { name?: unknown; kind?: unknown };
  return e.name === 'AuthError' && typeof e.kind === 'string' && AUTH_ERROR_KINDS_SET.has(e.kind);
}
```

**New union to add (D-22):**

```typescript
export const WHOOP_API_ERROR_KINDS = [
  'unauthorized',
  'rate_limited',
  'network',
  'validation',
  'server',
  'unknown',
] as const;
export type WhoopApiErrorKind = (typeof WHOOP_API_ERROR_KINDS)[number];

const WHOOP_API_ERROR_KINDS_SET: ReadonlySet<string> = new Set(WHOOP_API_ERROR_KINDS);

export interface WhoopApiErrorInit {
  kind: WhoopApiErrorKind;
  detail?: string;
  cause?: unknown;
}

export class WhoopApiError extends Error {
  readonly kind: WhoopApiErrorKind;
  readonly detail?: string;
  constructor(init: WhoopApiErrorInit) {
    super(init.detail ?? init.kind, init.cause === undefined ? undefined : { cause: init.cause });
    this.kind = init.kind;
    if (init.detail !== undefined) {
      this.detail = init.detail;
    }
    this.name = 'WhoopApiError';
  }
}

export function isWhoopApiError(err: unknown): err is WhoopApiError {
  if (typeof err !== 'object' || err === null) return false;
  const e = err as { name?: unknown; kind?: unknown };
  return e.name === 'WhoopApiError' && typeof e.kind === 'string' && WHOOP_API_ERROR_KINDS_SET.has(e.kind);
}
```

**Notes on deltas:**
- `AuthError` is FROZEN — Phase 3 does NOT touch `AUTH_ERROR_KINDS` or `formatAuthError`. The two unions live side-by-side in the same file.
- The `name` field differs (`'AuthError'` vs `'WhoopApiError'`) — that disambiguates both guards.
- Add a `formatWhoopApiError(err): string` mirror of `formatAuthError` (errors.ts lines 108–125) with one arm per WHOOP kind.
- Surface MR-21 forcing function: a 7th `WhoopApiErrorKind` requires updating the `formatWhoopApiError` switch (compile fail) AND the duck-type set.

---

### Cluster C — Domain

#### C1. `src/domain/types/score.ts` + `src/domain/schemas/score.ts` (NEW)

**Role:** domain type + Zod schema. `Score = z.discriminatedUnion('score_state', [...])` (D-03, ADR-0003).

**Analog (closed-tuple discriminator pattern):** `src/infrastructure/whoop/errors.ts` — `AUTH_ERROR_KINDS` + `AuthError` (closed-set discriminator, exhaustive switch enforcement). The Score DU uses Zod's `discriminatedUnion` rather than a hand-rolled class hierarchy, but the closedness + exhaustive-switch obligation are identical.

**Score discriminated union (RESEARCH.md Pattern 4, lines 515–532 — verbatim):**

```typescript
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
```

**Notes on deltas:** Each scored entity (Cycle, Recovery, Sleep, Workout) gets its own DU with its own SCORED-only field set. SCORED-only fields are required on the `'SCORED'` variant only; `'PENDING_SCORE'` and `'UNSCORABLE'` carry no score fields. The type system refuses any code path that reads `.recovery_score` without narrowing on `score_state === 'SCORED'`.

---

#### C2. `src/domain/dst-tz/detect.ts` (NEW)

**Role:** pure function. Two-rule OR'd DST/tz detection.

**Closest analog:** `src/services/doctor/index.ts` `deriveOverall` (lines 71–91) — pure rule + exhaustive switch + array literal-testable.

**Pure-rule excerpt from analog (doctor/index.ts lines 71–91):**

```typescript
export function deriveOverall(checks: ReadonlyArray<DoctorCheck>): DoctorResult['overall'] {
  let sawWarn = false;
  for (const c of checks) {
    switch (c.status) {
      case 'fail':
        return 'fail';
      case 'warn':
        sawWarn = true;
        break;
      case 'pass':
        break;
      default:
        return 'fail';
    }
  }
  return sawWarn ? 'warn' : 'pass';
}
```

**DST/tz detect skeleton (RESEARCH.md Pattern 5, lines 540–558 — verbatim):**

```typescript
import { tzOffset } from '@date-fns/tz';

export function detectExclusion(input: {
  ianaZone: string;
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

**Notes on deltas:** Pure function. IANA zone resolved once at sync-start (`Intl.DateTimeFormat().resolvedOptions().timeZone`). Re-evaluated on every retroactive upsert per D-14 + Pitfall I.

---

#### C3. `src/domain/normalize/<resource>.ts` (NEW — 6 files)

**Role:** pure transform. Raw Zod-validated WHOOP shape → domain entity (snake_case → camelCase, JSON parse of typed sub-fields, score discriminator narrowing).

**Closest analog:** None (Phase 3 is the first normalizer). Document the contract.

**Normalizer contract:**

```typescript
// Source: D-28 — repositories return domain entities; mapping at the boundary.
// All normalizers are pure: raw input → entity output. No I/O, no logger, no DB.
import type { Cycle } from '../types/entities.js';
import type { z } from 'zod';
import type { WhoopRawCycle } from '../schemas/whoop-api.js';

export function normalizeCycle(raw: z.infer<typeof WhoopRawCycle>): Cycle {
  return {
    id: raw.id,
    userId: raw.user_id,
    createdAt: raw.created_at,
    updatedAt: raw.updated_at,
    start: raw.start,
    end: raw.end,
    timezoneOffset: raw.timezone_offset,
    scoreState: raw.score_state,
    // SCORED-only score fields conditionally narrowed on raw.score_state === 'SCORED'
    // ...
  };
}
```

**Notes on deltas:** One file per resource. Each consumes its own Zod schema from `domain/schemas/whoop-api.ts` and emits its own entity type from `domain/types/entities.ts`. Pure functions — fully unit-testable with array literals (conventions.md §Code style).

---

### Cluster D — Services

#### D1. `src/services/sync/index.ts` (NEW)

**Role:** service-orchestrator. Sequential across 6 resources; parallel-within-resource via the semaphore (D-23).

**Closest analog:** `src/services/doctor/index.ts` — `runDoctor` orchestrator with status precedence + Promise.allSettled error containment (lines 93–end). Doctor is parallel; sync is sequential per resource — but the orchestration shape (insert run row → iterate → finalize → derive status) mirrors `runDoctor` exactly.

**Doctor orchestrator excerpt (doctor/index.ts lines 28–63):**

```typescript
export interface DoctorCheck {
  name: string;
  status: 'pass' | 'warn' | 'fail';
  detail: string;
}

export interface DoctorResult {
  checks: DoctorCheck[];
  overall: 'pass' | 'warn' | 'fail';
}

export interface RunDoctorOptions {
  skipSubprocessChecks?: boolean;
}
```

**Sync orchestrator skeleton (RESEARCH.md Pattern 6, lines 565–588 — verbatim):**

```typescript
const RESOURCES = ['profile', 'body_measurements', 'cycles', 'recoveries', 'sleeps', 'workouts'] as const;

export interface RunSyncInput {
  days?: number;
  since?: string;
  resources?: ReadonlyArray<typeof RESOURCES[number]>;
}

export interface ResourceSyncOutcome {
  status: 'success' | 'partial_429' | 'partial_5xx' | 'failed_auth' | 'failed_network' | 'skipped';
  fetched?: number;
  upserted?: number;
  errors?: number;
  durationMs?: number;
}

export interface RunSyncResult {
  status: 'ok' | 'partial' | 'failed';
  perResource: Record<typeof RESOURCES[number], ResourceSyncOutcome>;
  syncRunId: number;
  gapsDetected: number;
}

export async function runSync(opts: RunSyncInput): Promise<RunSyncResult> {
  const syncRunId = await deps.repos.syncRuns.insertRunning();
  const perResource: Record<typeof RESOURCES[number], ResourceSyncOutcome> = {} as any;

  for (const resource of opts.resources ?? RESOURCES) {
    try {
      const cursor = await deps.repos[resource].cursor();                  // MAX(updated_at)
      const since = computeWindow({ cursor, clock: deps.clock(), flagSinceISO: opts.since, flagDaysN: opts.days });
      const result = await deps.whoop.resources[resource].listAll(since);
      const upsert = await deps.repos[resource].upsertBatch(result.rows);  // BEGIN IMMEDIATE inside
      perResource[resource] = { status: 'success', fetched: result.rows.length, upserted: upsert.changed };
    } catch (err) {
      perResource[resource] = classifyOutcome(err);
    }
  }

  const status = computeStatus(perResource);
  await deps.repos.syncRuns.finalize(syncRunId, status, perResource);
  if (status === 'ok' || status === 'partial') deps.sqlite.pragma('wal_checkpoint(TRUNCATE)');
  return { status, perResource, syncRunId, gapsDetected: 0 };
}
```

**Notes on deltas:**
- Resource order is load-bearing: profile → body_measurements → cycles → recoveries → sleeps → workouts (D-23 rationale: lightest first to surface auth/config errors before heavy paginated resources).
- Each resource is its own try/catch (Promise.allSettled-equivalent for the sequential case) — a 429 on workouts does NOT block cycles.
- `wal_checkpoint(TRUNCATE)` fires only on `ok | partial` (D-32 — leave WAL intact on `failed` for diagnostics).

---

#### D2. `src/services/sync/cursor.ts` (NEW)

**Role:** pure function. Derives `{since, until}` from cursor + flags + clock.

**Closest analog:** `src/services/doctor/index.ts` `deriveOverall` (pure unit-testable function with exhaustive narrowing).

**Cursor skeleton (RESEARCH.md Pattern 9, lines 668–685 — verbatim):**

```typescript
export function computeWindow(opts: {
  cursor: string;                                       // MAX(updated_at) coalesced to epoch-zero
  clock: Date;
  flagSinceISO?: string | null;                         // --since override
  flagDaysN?: number | null;                            // --days override
}): { since: string; until: string } {
  const now = opts.clock;
  if (opts.flagSinceISO) return { since: opts.flagSinceISO, until: now.toISOString() };
  if (opts.flagDaysN) {
    const since = new Date(now.getTime() - opts.flagDaysN * 86_400_000).toISOString();
    return { since, until: now.toISOString() };
  }
  // Default: min(cursor, now() - 7d) per D-10.
  const sevenDaysAgo = new Date(now.getTime() - 7 * 86_400_000).toISOString();
  const since = opts.cursor < sevenDaysAgo ? opts.cursor : sevenDaysAgo;
  return { since, until: now.toISOString() };
}
```

**Notes on deltas:** Pure function; no `Date.now()` reads, no env reads. Tests inject `clock: new Date(...)`. ISO-string lexical ordering matches chronological ordering only when both strings are full ISO-8601 with Z; the cursor is always emitted by SQLite `MAX(updated_at)` which preserves WHOOP's wire format.

---

#### D3. `src/services/index.ts` (EXTEND)

**Role:** services barrel + composition root.

**Self-analog:** existing `src/services/index.ts` — Phase 2 extension pattern (lines 1–34).

**Existing pattern to extend** (services/index.ts lines 16–34):

```typescript
import { runDoctor } from './doctor/index.js';
import { refreshOrchestrator } from './refresh-orchestrator.js';

export type { DoctorCheck, DoctorResult, RunDoctorOptions } from './doctor/index.js';
export type {
  AuthedOperation,
  CallWithAuthOptions,
  FetchLikeResponse,
  RefreshOrchestrator,
} from './refresh-orchestrator.js';

export interface Services {
  runDoctor: typeof runDoctor;
  refreshOrchestrator: typeof refreshOrchestrator;
}

export function createServices(): Services {
  return { runDoctor, refreshOrchestrator };
}
```

**Phase 3 extension:**

```typescript
import { runSync } from './sync/index.js';
// ...
export type { RunSyncInput, RunSyncResult, ResourceSyncOutcome } from './sync/index.js';

export interface Services {
  runDoctor: typeof runDoctor;
  refreshOrchestrator: typeof refreshOrchestrator;
  runSync: typeof runSync;
}

export function createServices(): Services {
  // Side effect per D-33 (alternative: services/bootstrap.ts owns openDb + migrate).
  return { runDoctor, refreshOrchestrator, runSync };
}
```

**Notes on deltas:** Migrator + `openDb` run at every CLI + MCP startup. Either:
- (a) `createServices()` calls `bootstrap()` internally (migrator side-effect at composition root), or
- (b) `src/services/bootstrap.ts` exposes a separate `bootstrap()` that the CLI + MCP entry points call before `createServices()`.

Plan 04 should lock which shape; the file layout in RESEARCH.md line 298 says `services/bootstrap.ts` exists, so prefer (b) for separation of concerns.

---

### Cluster E — CLI + Formatters

#### E1. `src/cli/commands/sync.ts` (NEW)

**Role:** CLI shim. ≤5-line shim over `services.runSync` per CLI policy.

**Analog:** `src/cli/commands/auth.ts` (existing).

**Shim shape from analog (auth.ts lines 51–115 — distilled):**

```typescript
export async function runAuthCommand(opts: {
  noBrowser?: boolean;
  timeout?: number;
}): Promise<void> {
  try {
    // 1. read config (Zod-validate)
    // 2. call infrastructure (runOAuth)
    // 3. persist (tokenStore.write)
    // 4. stdout success / exit 0
  } catch (err) {
    // sanitize + exit code per AUTH_EXIT_CODES
  }
}
```

**Phase 3 shim** (target — to be expanded in Plan 05):

```typescript
import { createServices } from '../../services/index.js';
import { formatSyncResult } from '../../formatters/sync.txt.js';

export const SYNC_EXIT_CODES = Object.freeze({
  ok: 0,
  partial: 0,                                 // partial-success is still exit 0; per-resource lines flag the issue
  failed: 1,
});

export async function runSyncCommand(opts: {
  days?: number;
  since?: string;
  resources?: string;                         // comma-separated → string[]
}): Promise<void> {
  const services = createServices();
  const result = await services.runSync({
    days: opts.days,
    since: opts.since,
    resources: opts.resources?.split(','),
  });
  process.stdout.write(formatSyncResult(result), () => {
    process.exit(SYNC_EXIT_CODES[result.status]);
  });
}
```

**Notes on deltas:**
- Flags from D-26: `--days N` (default 30), `--since <ISO>`, `--resources <list>`.
- `process.stdout.write` is the human-facing output channel — exempted under Gate C for `src/cli/commands/**/*.ts` (ci-grep-gates.sh lines 130–152).
- Same try/catch error handling as `auth.ts` lines 116–125 (`isAuthError` guard + sanitize). Add an `isWhoopApiError` arm for sync-specific failures.

---

#### E2. `src/formatters/sync.txt.ts` (NEW)

**Role:** formatter. Structured `RunSyncResult` → compact text (one line per resource).

**Closest analog:** None — Phase 3 ships the first formatter.

**Contract to encode:**

```typescript
import type { RunSyncResult } from '../services/sync/index.js';

export function formatSyncResult(result: RunSyncResult): string {
  // One line per resource:
  //   cycles      ok      fetched=42 upserted=42 errors=0 dur=120ms
  //   workouts    partial_429  fetched=10 upserted=10 errors=0 dur=2400ms
  // Summary footer:
  //   sync status: partial  gaps=0  syncRunId=17
  // ...
}
```

**Notes on deltas:**
- conventions.md §Code style — banned-word lint enforced on formatters.
- Use the existing Pino structure (event-name + fields) as the source of the text output — no inline tokens, no response bodies (ADR-0001).

---

### Cluster F — Config Extension

#### F1. `src/infrastructure/config/paths.ts` (EXTEND)

**Role:** add `dbFile`, `dbWalFile`, `dbShmFile`, `backupsDir`, `migrationsDir` to `ResolvedPaths`.

**Self-analog:** existing `paths.ts` (Plan 02-01 additions of `tokensFile` / `tokensLockFile` / `storageModeFile`).

**Existing shape to extend (paths.ts lines 26–58):**

```typescript
export interface ResolvedPaths {
  configDir: string;
  configFile: string;
  tokensFile: string;
  tokensLockFile: string;
  storageModeFile: string;
}

export function resolvePaths(env: PathsEnv): ResolvedPaths {
  const configDir =
    env.RECOVERY_LEDGER_HOME ?? (env.HOME ? join(env.HOME, '.recovery-ledger') : undefined);
  if (configDir === undefined) {
    throw new Error('RECOVERY_LEDGER_HOME or HOME must be set');
  }
  return {
    configDir,
    configFile: join(configDir, 'config.json'),
    tokensFile: join(configDir, 'tokens.json'),
    tokensLockFile: join(configDir, 'tokens.json.lock'),
    storageModeFile: join(configDir, 'storage-mode'),
  };
}
```

**Phase 3 additions:**

```typescript
export interface ResolvedPaths {
  configDir: string;
  configFile: string;
  tokensFile: string;
  tokensLockFile: string;
  storageModeFile: string;
  // NEW in Phase 3:
  dbFile: string;
  dbWalFile: string;
  dbShmFile: string;
  backupsDir: string;
  migrationsDir: string;
}

// In resolvePaths:
return {
  // ... existing fields
  dbFile: join(configDir, 'db.sqlite'),
  dbWalFile: join(configDir, 'db.sqlite-wal'),
  dbShmFile: join(configDir, 'db.sqlite-shm'),
  backupsDir: join(configDir, 'backups'),
  migrationsDir: /* absolute path to compiled migrations — resolved from import.meta.url in bootstrap */ '',
};
```

**Notes on deltas:**
- `migrationsDir` is tricky: at runtime under `dist/`, the migrations are sibling files; under `src/`-mode (tsx + vitest) they live at `src/infrastructure/db/migrations/`. The doctor's `mcp-stdout-purity.ts` analog resolves this via `import.meta.url + path.resolve`. Use the same pattern (see mcp-stdout-purity.ts lines 26–35):

```typescript
const HERE = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_MCP_ENTRY = path.resolve(HERE, 'mcp.mjs');
```

- A cleaner shape: `migrationsDir` is NOT on `ResolvedPaths` (it's not user-overridable via `RECOVERY_LEDGER_HOME`); it lives as a constant inside `migrate.ts` resolved via `import.meta.url`.
- Plan 04 should reconcile which approach.

---

### Cluster G — Tests

#### G1. `tests/helpers/msw-whoop-<resource>.ts` (NEW — 6 files)

**Role:** test helper. One MSW handler file per WHOOP resource (conventions.md §Testing).

**Analog:** `tests/helpers/msw-whoop-oauth.ts` (exact — verbatim shape to mirror).

**Full analog excerpt (msw-whoop-oauth.ts lines 19–99):**

```typescript
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { type HttpHandler, HttpResponse, http } from 'msw';
import { type SetupServer, setupServer } from 'msw/node';

export const WHOOP_TOKEN_URL = 'https://api.prod.whoop.com/oauth/oauth2/token';

const TOKEN_200_FIXTURE_PATH = join(process.cwd(), 'tests', 'fixtures', 'oauth', 'token-200.json');

interface NextResponse {
  body: unknown;
  status: number;
}

export interface WhoopOauthHelper {
  server: SetupServer;
  getRefreshHitCount(): number;
  resetRefreshHitCount(): void;
  getLastRequestBody(): URLSearchParams | null;
  setNextResponse(body: object, status?: number): void;
}

export function createWhoopOauthHelper(): WhoopOauthHelper {
  let hitCount = 0;
  let nextResponse: NextResponse | null = null;
  let lastRequestBody: URLSearchParams | null = null;

  const handler: HttpHandler = http.post(WHOOP_TOKEN_URL, async ({ request }) => {
    hitCount += 1;
    try {
      const raw = await request.text();
      lastRequestBody = new URLSearchParams(raw);
    } catch {
      lastRequestBody = null;
    }
    if (nextResponse !== null) {
      const { body, status } = nextResponse;
      nextResponse = null;
      return HttpResponse.json(body, { status });
    }
    const raw = readFileSync(TOKEN_200_FIXTURE_PATH, 'utf8');
    const parsed = JSON.parse(raw) as unknown;
    return HttpResponse.json(parsed);
  });

  const server = setupServer(handler);

  return {
    server,
    getRefreshHitCount: () => hitCount,
    resetRefreshHitCount: () => {
      hitCount = 0;
      lastRequestBody = null;
    },
    getLastRequestBody: () => lastRequestBody,
    setNextResponse: (body, status = 200) => {
      nextResponse = { body, status };
    },
  };
}
```

**Phase 3 per-resource helper (RESEARCH.md Pattern 10, lines 696–727 — verbatim):**

```typescript
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';

export function createWhoopCyclesHelper() {
  let hitCount = 0;
  let nextResponse: { body: unknown; status: number; headers?: Record<string, string> } | null = null;

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

**Notes on deltas:**
- One helper file per resource (cycles, recovery, sleep, workouts, profile, body-measurements). Endpoint URL per WHOOP docs (e.g., `/v2/recovery`, `/v2/activity/sleep`, `/v2/activity/workout`, `/v2/user/profile/basic`, `/v2/user/measurement/body`).
- Each helper emits `X-RateLimit-*` headers in default responses — required for `rate-limit.ts` test coverage.
- One-shot `setNextResponse` for 429 / 5xx scenarios (precedent: oauth helper's `setNextResponse`).
- `http.post` → `http.get` (D-21 GET-only).

---

#### G2. `tests/helpers/in-memory-db.ts` (NEW)

**Role:** test helper. `better-sqlite3` `:memory:` + run migrator.

**Closest analog:** None (Phase 3 ships the first DB test helper). Document the contract:

```typescript
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from '../../src/infrastructure/db/migrate.js';

export function createInMemoryDb(): { db: ReturnType<typeof drizzle>; sqlite: Database.Database } {
  const sqlite = new Database(':memory:');
  // Same pragmas as production (D-30) — minus journal_mode=WAL (memory DBs are not WAL).
  sqlite.pragma('busy_timeout = 5000');
  sqlite.pragma('foreign_keys = ON');
  // Run the same hand-rolled migrator against the in-memory DB.
  migrate(sqlite, {
    migrationsDir: /* resolved via import.meta.url */ '',
    backupsDir: '/tmp/never-written',  // memory DB has no file → no backup taken
    dbFile: ':memory:',
  });
  return { db: drizzle(sqlite), sqlite };
}
```

**Notes on deltas:** Contract tests + integration tests both consume this. Migrator must be a no-op on `:memory:` for the backup step (D-07) — flag a Wave 2A planning note.

---

#### G3. `tests/contract/<resource>.test.ts` (NEW — 6 files)

**Role:** contract test. Fixture → MSW intercepts → resource module fetches → in-memory DB upserts → repository read returns expected rows.

**Closest analog:** `src/services/refresh-orchestrator.test.ts` (Plan 02-04) for service-composition; `tests/integration/auth-concurrency.test.ts` (Plan 02-08) for fixture-driven full-stack.

**Shape from auth-concurrency analog (lines 39–53):**

```typescript
import { type ChildProcessWithoutNullStreams, fork, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'vitest';

const FORBIDDEN = /Bearer\s+[A-Za-z0-9._/+=-]{10,}|eyJ[A-Za-z0-9._-]{20,}|Authorization:/g;
```

**Notes on deltas:**
- Each contract test loads the resource's fixtures, drives MSW, invokes the resource module via `httpGet`, upserts via the repository, asserts the rows match expectations.
- `tests/contract/` is a new directory per conventions.md §Files, names, structure. Vitest include glob `tests/**/*.test.ts` already covers it (Plan 02-08 extension).
- Pitfall G verification anchor: load `tests/fixtures/whoop/recovery/200-mixed-score-states.json` → sync → assert (a) all 3 rows upserted, (b) `byRange()` returns only SCORED, (c) `byRange({includeUnscored: true})` returns all 3.

---

#### G4. `tests/integration/sync/migration-crash.test.ts` (NEW)

**Role:** integration test. Kill the process mid-statement; verify backup restores cleanly.

**Closest analog:** `src/services/doctor/checks/mcp-stdout-purity.ts` — subprocess `spawn` discipline.

**Subprocess shape from analog (mcp-stdout-purity.ts lines 19–35):**

```typescript
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
// ...
const HERE = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_MCP_ENTRY = path.resolve(HERE, 'mcp.mjs');
// ...
export const FRAME_SETTLE_MS = 200;
const FINAL_DRAIN_MS = 300;
```

**Notes on deltas:**
- Requires `pool: 'forks'` in vitest.config.ts (already configured per Plan 01-01).
- Spawn a child process running the migrator against a real on-disk SQLite file; `SIGKILL` mid-statement; reopen → assert backup file exists at `~/.recovery-ledger/backups/...` → restore from backup → assert DB is healthy.
- Backup verification: copy `<backupPath>.sqlite` + `<backupPath>.sqlite-wal` + `<backupPath>.sqlite-shm` → open with `better-sqlite3` → `PRAGMA integrity_check` returns `'ok'`.

---

### Cluster H — Scripts + Config

#### H1. `scripts/ci-grep-gates.sh` (EXTEND — add Gate F + Gate G)

**Role:** CI gate.

**Self-analog:** existing Gate E (lines 181–213) — single-consumer-of-URL-string enforcement with per-line `*.test.ts` exclusion.

**Gate E pattern verbatim (ci-grep-gates.sh lines 200–213):**

```bash
TOKEN_ENDPOINT_RE='oauth/oauth2/token'

if "$GREP" -rEn "$TOKEN_ENDPOINT_RE" --include='*.ts' src/ 2>/dev/null \
   | "$GREP" -Ev '^src/infrastructure/whoop/token-store\.ts:' \
   | "$GREP" -Ev '\.test\.ts:' \
   > /tmp/gate-e.$$; then
  if [ -s /tmp/gate-e.$$ ]; then
    echo "::error::Gate E — oauth/oauth2/token referenced outside src/infrastructure/whoop/token-store.ts:"
    cat /tmp/gate-e.$$
    rm -f /tmp/gate-e.$$
    exit 1
  fi
fi
rm -f /tmp/gate-e.$$
```

**Gate F to add (no `fetch(` outside the 3 permitted WHOOP files):**

```bash
# ----------------------------------------------------------------------------
# Gate F — no fetch( outside src/infrastructure/whoop/client.ts,
# src/infrastructure/whoop/token-store.ts, src/infrastructure/whoop/oauth.ts.
# D-21 + ADR-0007: HTTPS to api.prod.whoop.com is monolithic. Any other
# fetch( call site bypasses callWithAuth, the rate-limit semaphore, retry,
# and Zod validation. Test files exempt (mirrors Gate E).
# ----------------------------------------------------------------------------
FETCH_RE='\bfetch\s*\('

if "$GREP" -rEn "$FETCH_RE" --include='*.ts' src/ 2>/dev/null \
   | "$GREP" -Ev '^src/infrastructure/whoop/client\.ts:' \
   | "$GREP" -Ev '^src/infrastructure/whoop/token-store\.ts:' \
   | "$GREP" -Ev '^src/infrastructure/whoop/oauth\.ts:' \
   | "$GREP" -Ev '\.test\.ts:' \
   > /tmp/gate-f.$$; then
  if [ -s /tmp/gate-f.$$ ]; then
    echo "::error::Gate F — fetch( outside src/infrastructure/whoop/{client,token-store,oauth}.ts:"
    cat /tmp/gate-f.$$
    rm -f /tmp/gate-f.$$
    exit 1
  fi
fi
rm -f /tmp/gate-f.$$
```

**Gate G to add (no `drizzle-orm/*` imports outside `src/infrastructure/db/`):**

```bash
# ----------------------------------------------------------------------------
# Gate G — no drizzle-orm/* import outside src/infrastructure/db/.
# ARCHITECTURE.md Anti-Pattern 3 + D-28: Drizzle row types never in domain/
# or services/. Repositories return domain entities; mapping at the boundary.
# Test files exempt.
# ----------------------------------------------------------------------------
DRIZZLE_IMPORT_RE="from\s+['\"]drizzle-orm"

if "$GREP" -rEn "$DRIZZLE_IMPORT_RE" --include='*.ts' src/ 2>/dev/null \
   | "$GREP" -Ev '^src/infrastructure/db/' \
   | "$GREP" -Ev '\.test\.ts:' \
   > /tmp/gate-g.$$; then
  if [ -s /tmp/gate-g.$$ ]; then
    echo "::error::Gate G — drizzle-orm/* imported outside src/infrastructure/db/:"
    cat /tmp/gate-g.$$
    rm -f /tmp/gate-g.$$
    exit 1
  fi
fi
rm -f /tmp/gate-g.$$
```

**Notes on deltas:**
- Both gates follow Gate E's per-line `grep -Ev` exclusion pattern; the `--include='*.ts'` + `src/` scope is identical.
- Gate F includes 3 allowlisted files; Gate G uses a directory prefix exclude.
- Test files (`*.test.ts`) are excluded — mirrors Gate E rationale (a contract test for `client.ts` will naturally reference `fetch` in fixtures; a repository test will import `drizzle-orm`).
- Final `echo "All grep gates passed."` line stays at the end of the script.

---

#### H2. `drizzle.config.ts` (NEW, repo root)

**Role:** tool config. Points `drizzle-kit generate` at the schema + migrations directory.

**No analog.** Standard Drizzle Kit config shape:

```typescript
import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  schema: './src/infrastructure/db/schema.ts',
  out: './src/infrastructure/db/migrations',
  dialect: 'sqlite',
  verbose: true,
  strict: true,
});
```

**Notes on deltas:** Wave 0 verifies this against a stub schema before locking the migrator's `meta/_journal.json` parsing (RESEARCH.md assumption A1).

---

## Shared Patterns

### S1. Discriminated-Union Errors

**Source:** `src/infrastructure/whoop/errors.ts` (lines 29–95). Closed-tuple `KINDS` array + readonly-Set duck-type guard + class extending `Error` with `name`, `kind`, `detail`, `cause`.

**Apply to:**
- `src/infrastructure/whoop/errors.ts` extended with `WhoopApiError` (Cluster B)
- `src/infrastructure/db/migrate.ts` `MigrationError` (Cluster A)

**Excerpt (verbatim from analog):**

```typescript
export const AUTH_ERROR_KINDS = [
  'auth_missing', 'auth_expired', 'auth_state_mismatch',
  'auth_timeout', 'auth_port_in_use', 'refresh_failed',
] as const;

export type AuthErrorKind = (typeof AUTH_ERROR_KINDS)[number];

const AUTH_ERROR_KINDS_SET: ReadonlySet<string> = new Set(AUTH_ERROR_KINDS);

export class AuthError extends Error {
  readonly kind: AuthErrorKind;
  readonly detail?: string;

  constructor(init: AuthErrorInit) {
    super(init.detail ?? init.kind, init.cause === undefined ? undefined : { cause: init.cause });
    this.kind = init.kind;
    if (init.detail !== undefined) {
      this.detail = init.detail;
    }
    this.name = 'AuthError';
  }
}

export function isAuthError(err: unknown): err is AuthError {
  if (typeof err !== 'object' || err === null) return false;
  const e = err as { name?: unknown; kind?: unknown };
  return e.name === 'AuthError' && typeof e.kind === 'string' && AUTH_ERROR_KINDS_SET.has(e.kind);
}
```

---

### S2. Structured Logger Discipline (ADR-0001 + Pitfall 17)

**Source:** `src/services/refresh-orchestrator.ts` line 93 + `src/infrastructure/whoop/token-store.ts` lines 9–13.

**Apply to:** every new file under `src/infrastructure/whoop/`, `src/infrastructure/db/`, `src/services/sync/`.

**Excerpt (verbatim from refresh-orchestrator.ts line 93):**

```typescript
logger.warn({ event: '401_received', retry: true });
```

**Rule:** Structured fields only. Never inline tokens, response bodies, or PII into log strings. Pino writes to stderr (fd 2). `console.log` / `console.warn` are CI-banned by Gate B outside `src/cli/**`.

**Phase 3 log events to emit:**
- `rate_limit_throttle { remaining: N }`
- `rate_limit_429 { resetSeconds: N }`
- `sync_started { syncRunId, resources }`
- `sync_resource_done { syncRunId, resource, status, durationMs, fetched, upserted }`
- `sync_finished { syncRunId, status, gapsDetected }`
- `migration_apply { tag, hash, backupPath }`
- `migration_failed { tag, backupPath, kind }`

---

### S3. Sanitizer Pipeline (D-34 attestation)

**Source:** `src/mcp/sanitize.ts` + `src/mcp/register.ts` (UNMODIFIED in Phase 3 per D-34).

**Apply to:** every error emitted from Phase 3 code that flows through MCP. The existing sanitizer's 4 D-07 patterns + Plan 02-07's `code=` + `client_secret` patterns already cover every shape `WhoopApiError` produces (RESEARCH.md Pitfall E + assumption A7).

**Cross-layer import pattern (from `src/cli/commands/auth.ts` lines 31–39):**

```typescript
import { sanitize } from '../../mcp/sanitize.js';
```

**Rule:** Phase 3 CLI command files route uncaught error messages through `sanitize()` before writing to stdout. The MCP path is handled by `register.ts`'s wrapper (UNMODIFIED).

---

### S4. CLI Shim Shape (≤5-line discipline)

**Source:** `src/cli/commands/auth.ts` — try/catch outer wrapper, infrastructure-direct imports, exit-code map with one arm per error `kind`.

**Apply to:** `src/cli/commands/sync.ts`.

**Excerpt (auth.ts lines 41–49):**

```typescript
export const AUTH_EXIT_CODES: Readonly<Record<string, number>> = Object.freeze({
  success: 0,
  auth_missing: 1,
  auth_expired: 1,
  auth_state_mismatch: 1,
  auth_timeout: 1,
  auth_port_in_use: 1,
  refresh_failed: 1,
});
```

---

### S5. Test Helper Lifecycle (per-test, not global)

**Source:** `tests/helpers/msw-whoop-oauth.ts` — `createWhoopOauthHelper()` returns `{server, getHitCount, resetHitCount, setNextResponse}`. The test file owns the `server.listen()` / `server.close()` lifecycle.

**Apply to:** all 6 new MSW resource helpers + `tests/helpers/in-memory-db.ts`.

**Rule:** No global setup. Each test file decides when to start/stop MSW and the DB. Lets a test reset hit counters per case, per file, or per suite without leaking state.

---

### S6. Vitest `pool: 'forks'` (Plan 01-01)

**Source:** `vitest.config.ts` (Plan 01-01).

**Apply to:** all Phase 3 tests — required because `better-sqlite3` native handles do not cross worker threads cleanly (conventions.md §Testing).

**Rule:** Plan must not change `vitest.config.ts`'s `pool` setting. The migration-crash test specifically needs cross-process semantics (fork → SIGKILL → re-open) which `pool: 'forks'` enables.

---

## No Analog Found

The following files have no close analog in the existing codebase — planner should use RESEARCH.md patterns (Patterns 1–10) and assumption-log citations directly.

| File | Role | Data Flow | Reason |
|------|------|-----------|--------|
| `src/infrastructure/db/schema.ts` | schema-DSL | declarative | First schema in the project |
| `src/infrastructure/db/migrations/0000_*.sql` + `meta/*` | generated artifact | n/a | `drizzle-kit generate` output |
| `src/infrastructure/db/repositories/*.repo.ts` | repository | CRUD | First repositories — contract documented in A4 above |
| `src/infrastructure/whoop/pagination.ts` | utility | iterator | First pagination utility — code per RESEARCH.md Pattern 7 |
| `src/infrastructure/whoop/rate-limit.ts` | utility | semaphore | First in-process semaphore — code per RESEARCH.md Pattern 8 |
| `src/domain/types/entities.ts` | domain type | type-system | First domain types |
| `src/domain/normalize/<resource>.ts` | pure transform | input → output | First normalizers — contract in C3 |
| `src/formatters/sync.txt.ts` | formatter | structured → text | First formatter |
| `tests/helpers/in-memory-db.ts` | test helper | in-memory bootstrap | First DB test helper |
| `drizzle.config.ts` | tool config | declarative | drizzle-kit specific |

---

## Metadata

**Analog search scope:** `src/services/`, `src/infrastructure/whoop/`, `src/infrastructure/config/`, `src/cli/commands/`, `src/mcp/`, `tests/helpers/`, `tests/integration/`, `scripts/`.

**Files scanned (read in full or in load-bearing range):**
- `src/services/refresh-orchestrator.ts` (full — 141 LOC)
- `src/services/doctor/index.ts` (lines 1–100 — orchestrator shape)
- `src/services/doctor/checks/auth.ts` (lines 1–60 — service-with-state shape)
- `src/services/doctor/checks/mcp-stdout-purity.ts` (lines 1–80 — subprocess-driven test pattern)
- `src/services/index.ts` (full — barrel + composition root)
- `src/infrastructure/whoop/errors.ts` (full — closed-tuple DU pattern)
- `src/infrastructure/whoop/oauth.ts` (full — transport + Zod-validation pattern)
- `src/infrastructure/whoop/token-store.ts` (lines 1–80 — chokepoint discipline header)
- `src/infrastructure/config/paths.ts` (full — factory + lazy singleton)
- `src/cli/commands/auth.ts` (lines 1–120 — CLI shim shape)
- `tests/helpers/msw-whoop-oauth.ts` (full — MSW helper pattern)
- `tests/integration/auth-concurrency.test.ts` (lines 1–60 — integration test shape)
- `scripts/ci-grep-gates.sh` (full — Gate E + per-line exclude pattern)
- `.planning/phases/03-data-model-db-layer-sync-loop/03-CONTEXT.md` (full — 34 decisions)
- `.planning/phases/03-data-model-db-layer-sync-loop/03-RESEARCH.md` (sampled in 3 non-overlapping ranges: 1–350, 350–650, 650–1145)
- `.planning/research/ARCHITECTURE.md` (lines 83–225 — recommended project structure)
- `agent_docs/conventions.md` (full — code style + testing rules)

**Pattern extraction date:** 2026-05-16

## PATTERN MAPPING COMPLETE

Phase 3 pattern map written: 75 new/modified files classified, 65 mapped to in-repo analogs from Phases 1 + 2 (chokepoint discipline from `refresh-orchestrator.ts`, transport + Zod from `oauth.ts`, closed-tuple DU from `errors.ts`, MSW helper from `msw-whoop-oauth.ts`, CLI shim from `auth.ts`, CI gate pattern from `ci-grep-gates.sh`), 10 greenfield files documented with RESEARCH.md citations.
