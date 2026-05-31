# Phase 3: Data Model, DB Layer & Sync Loop - Context

**Gathered:** 2026-05-16
**Status:** Ready for planning

<domain>
## Phase Boundary

Stand up the local SQLite cache, the WHOOP HTTP client, and the sync loop so future review/decision phases can read normalized, `score_state`-disciplined, DST/tz-aware entities out of the on-disk database. By the end of Phase 3:

- `recovery-ledger sync --days N` (default 30) fetches profile + body_measurement + cycles + recovery + sleep + workouts; honors WHOOP pagination + the 4-concurrent-request semaphore; backs off on 429 honoring `X-RateLimit-Reset`; re-runs are idempotent via `ON CONFLICT(id) DO UPDATE` and produce zero new rows.
- Drizzle schema + `BEGIN IMMEDIATE`-wrapped migrator with pre-migration backup + fails-closed-on-partial-migration are in place.
- `Score = z.discriminatedUnion('score_state', …)` is enforced by the type system; baseline queries default to `WHERE score_state = 'SCORED'`; index `(score_state, start)` exists on every scored entity.
- DST/tz-shift cycles are flagged at upsert time and excluded from baseline aggregation while remaining visible in raw views.
- Partial-failure sync (workouts 429s but cycles succeed) records per-resource success/fail/skipped counts in a `sync_runs` row, exits with `status: 'partial'`, and runs `wal_checkpoint(TRUNCATE)` after every successful run.
- Fixture-based contract tests cover every WHOOP resource with zero live API calls; full suite under 60 seconds.

**Out of scope here** (later phases own them):
- Baseline math, anomaly detection, FDR correction, review CLI/MCP tools, decision ledger — Phase 4.
- `whoop_sync` / `whoop_query_cache` / `whoop_api_gap` MCP tools and their resources — Phase 4. Phase 3 ships the sync **service** consumed by the future MCP shim; it adds **zero new MCP tools** (D-17 attestation continues: `tools/list` returns exactly one tool — `whoop_doctor`).
- Full `doctor` battery (WHOOP roundtrip, DB integrity, last-sync recency, data-quality counts) — Phase 5. Phase 3 may add lightweight offline-safe doctor probes (`db_open`, `schema_version`, `wal_size`) but the heavy live-API checks stay deferred.
- Real WHOOP API calls in tests — ADR-0006; everything goes through MSW fixtures.

</domain>

<decisions>
## Implementation Decisions

### Drizzle schema scope (DATA-02)
- **D-01:** Nine tables in v1: `sync_runs`, `cycles`, `recoveries`, `sleeps`, `workouts`, `daily_summaries`, `decisions`, `profile`, `body_measurements`. (`oauth_tokens` was considered but rejected — see D-02.) Per-entity hybrid shape — normalized columns for hot-path fields (`score_state`, `start`, `end`, `timezone_offset`, `updated_at`, plus the SCORED-only numeric scores) **plus** a `raw_json TEXT NOT NULL` column for every WHOOP-sourced row. `profile` is a single-row low-volume table; `body_measurements` is a history table (one row per WHOOP-returned measurement) — both have a mostly-raw_json shape. `decisions` is irreplaceable user data — separate backup posture per Pitfall 7.
- **D-02:** **`oauth_tokens` is NOT a SQLite table.** Phase 2 already stores tokens in `@napi-rs/keyring` + `~/.recovery-ledger/tokens.json` file fallback per ADR-0002 / 02-CONTEXT.md D-04. ARCHITECTURE.md §Configuration / Paths line 802 explicitly rejects the `oauth_tokens` table for v1 ("tokens are read on every WHOOP call; coupling token-read to DB readiness is wrong"). Drop the table from the schema; remove it from the requirement traceability when execution lands.

### Score discriminated union shape (DATA-05 / ADR-0003)
- **D-03:** `domain/types/score.ts` exports `Score = z.discriminatedUnion('score_state', [ScoredSchema, PendingScoreSchema, UnscorableSchema])`. The `SCORED` variant carries all numeric scores (e.g., `RecoveryScored` has `recovery_score`, `resting_heart_rate`, `hrv_rmssd_milli`, `spo2_percentage`, `skin_temp_celsius`). `PENDING_SCORE` and `UNSCORABLE` carry NO score fields — the type system refuses any code path that reads `.recovery_score` without first narrowing on `score_state === 'SCORED'`. Sync flow re-fetches `PENDING_SCORE` records on next run (they get a score within minutes-to-hours per Pitfall 3).
- **D-04:** Repositories' default WHERE clause = `score_state = 'SCORED'`. Opt-in `{ includeUnscored: true }` parameter for the future `whoop_data_quality` resource (Phase 4) and the per-resource doctor checks (Phase 5). The opt-in is a parameter, not a separate method — domain code that forgets it gets SCORED-only by default.
- **D-05:** Index `(score_state, start)` per scored entity (cycles, recoveries, sleeps, workouts) is created in the same migration that adds the table. Composite covering this query shape is the workhorse index per Pitfall 16; defer additional indexes until query-perf testing shows need.

### Migration crash-recovery contract (DATA-04, Pitfall 7, Pitfall 13)
- **D-06:** **Hand-rolled migrator** in `src/infrastructure/db/migrate.ts` — do NOT use Drizzle's default `migrate()` from `drizzle-orm/better-sqlite3/migrator`. Reason: Drizzle's default uses `BEGIN` (DEFERRED, the SQLite default), which Pitfall 13 explicitly bans because deferred transactions can upgrade mid-flight and defeat `busy_timeout`. The wrapper:
  1. Reads `__drizzle_migrations` to compute the pending list.
  2. For each pending migration: takes a backup (D-07), opens `BEGIN IMMEDIATE`, executes the whole `.sql` payload (using `better-sqlite3`'s `exec()`, which is multi-statement-aware), commits, and inserts a `__drizzle_migrations` row.
  3. On any throw → rollback → leave backup in place → re-throw as structured `MigrationError({kind, backupPath, latestSafeMigration})`.
  4. `--> statement-breakpoint` markers in Drizzle's emitted SQL are treated as parsing aids only — not transactional boundaries. The whole file is one atomic unit.
- **D-07:** **Pre-migration backup naming + retention.** Before each migration: copy `~/.recovery-ledger/db.sqlite` + `db.sqlite-wal` + `db.sqlite-shm` to `~/.recovery-ledger/backups/db.<ISO-timestamp>-pre-<migration-tag>.sqlite` (plus matching `-wal` / `-shm`), mode `chmod 600` per the Security Mistakes table in PITFALLS.md. Retention: keep the 3 most-recent backups (sort by mtime desc, unlink the rest including their `-wal`/`-shm` companions). Pre-migration backup is the cheap insurance Pitfall 7 names.
- **D-08:** **Fails-closed behavior, no auto-restore.** If at migrator-startup the schema is inconsistent with `__drizzle_migrations` (orphaned rows or missing rows), throw `MigrationError({kind: 'inconsistent_state', backupPath: <most-recent>, latestSafeMigration})`. The CLI doctor command prints a one-line `cp <backupPath> ~/.recovery-ledger/db.sqlite` remediation. **No auto-restore** — this is a personal tool whose decision ledger is irreplaceable; silent restore could destroy user-entered decisions. User-initiated, documented step instead.

### `updated_at` delta + 7-day re-window (SYNC-04)
- **D-09:** **Per-resource cursor = `MAX(updated_at) FROM <resource_table>`** computed at sync-start. No separate `sync_cursors` table; no JSON cursor blob in `sync_runs`. Reasons: (a) one fewer surface to migrate + back up, (b) atomic upserts mean a sync interrupted mid-resource resumes correctly from `MAX(updated_at)` of what landed, (c) the table itself is the source of truth — no risk of cursor-row drift from actual data.
- **D-10:** **Re-window shape (interpretation B per ARCHITECTURE.md anti-pattern 15 + Pitfall 15):** always fetch the trailing 7 days IN ADDITION to the cursor-based delta. Effective `since = min(cursor, now() - 7d)`. Catches WHOOP retroactive updates within 7 days (cycle.start/end can shift "for a few days as WHOOP learns more"). `--days N` flag sets `since = now() - N*24h` explicitly (overrides the trailing-7d default). `--since <ISO-date>` flag overrides everything (backfill mode).
- **D-11:** **Idempotency:** `ON CONFLICT(id) DO UPDATE SET <all-cols-except-id> = excluded.<col>` per Pitfall 10. UUID primary keys (WHOOP v2) — no sentinel value collisions. Pagination utility (D-19) asserts no duplicate IDs across consecutive pages — surfaces mid-pagination re-ordering as a loud failure rather than silent dup-then-overwrite.
- **D-12 [informational]:** **Resolved by 03-RESEARCH.md on 2026-05-16.** **Research items, both for `gsd-phase-researcher` against `developer.whoop.com/api`:**
  1. Confirm whether WHOOP v2 endpoints accept an `updated_since` (or equivalent) filter parameter on cycles, recovery, sleep, workouts. If yes → plumb directly into the HTTP query. If no → the resource client paginates from `start >= since` and post-filters in the resource module after parse. **Resolution:** WHOOP v2 does NOT accept `updated_since`. Pagination plumbs `start >= since` directly; the 7-day re-window (D-10) + `ON CONFLICT(id) DO UPDATE` (D-11) catches retroactive updates. No code path change vs other locked decisions.
  2. Pin current per-endpoint max page sizes for cycles, recovery, sleep, workouts (consumed by D-19 page-size constants). **Resolution:** `limit=25` (max) across all 4 list endpoints. Pinned in 03-RESEARCH.md item 2.

### DST/tz-shift exclusion (DATA-06, Pitfall 6)
- **D-13:** **Two detection sub-rules, OR'd:**
  1. **`dst_straddle`:** read user IANA zone once at sync-start (`Intl.DateTimeFormat().resolvedOptions().timeZone`). For each cycle, compute `tzOffset(zone, cycle.start)` and `tzOffset(zone, cycle.end)` via `@date-fns/tz`. Flag if they differ (DST transition happened mid-cycle).
  2. **`tz_drift`:** cycle's `timezone_offset` differs from the prior cycle's `timezone_offset` (prior = `MAX(start) WHERE start < cycle.start`). Travel detection.
- **D-14:** **Storage:** boolean column `baseline_excluded INTEGER NOT NULL DEFAULT 0` + `exclusion_reason TEXT` (nullable; `'dst_straddle'` | `'tz_drift'` | NULL) on the `cycles` row. ONLY `cycles` carries the flag — recovery/sleep/workouts inherit exclusion via `cycle_id` FK at query time. Flag is computed at upsert time (cycle.start and cycle.end are stable for non-recent cycles; re-evaluated on every retroactive WHOOP update via D-11's upsert).
- **D-15:** **Fixtures, committed under `tests/fixtures/whoop/cycles/`:**
  - `200-dst-spring-forward.json` — cycle straddling Mar 2026 2nd Sunday 02:00→03:00 in `America/Los_Angeles`.
  - `200-dst-fall-back.json` — cycle straddling Nov 2026 1st Sunday 02:00→01:00 in `America/Los_Angeles`.
  - `200-tz-trip-sfo-jfk.json` — three consecutive cycles with `timezone_offset` `-08:00 → -05:00 → -05:00`. Middle cycle is tz_drift-flagged; third cycle is NOT (its offset matches the prior cycle's).
- **D-16:** **Baseline-query default:** repositories used by Phase 4's baseline service add `WHERE baseline_excluded = 0` to the default filter alongside `score_state = 'SCORED'`. Same opt-in escape hatch as D-04 — `{ includeExcluded: true }` for the future `whoop_data_quality` resource and raw views.

### WHOOP client structure (SYNC-01 through SYNC-07)
- **D-17:** **Per-resource modules over a shared `httpGet`** in `src/infrastructure/whoop/client.ts`. File shape:
  ```
  src/infrastructure/whoop/
    client.ts            # httpGet<T>(path, query, schema) — auth-wrapped, rate-limited, Zod-validated
    pagination.ts        # paginateAll<T>(initialPath, query, fetchPage) — snake_case→camelCase translation
    rate-limit.ts        # in-process semaphore-of-4 + X-RateLimit-Remaining throttle
    retry.ts             # jittered exp backoff on 5xx + 429 honoring X-RateLimit-Reset
    resources/
      cycles.ts          # listCycles({since, until}) — typed via Zod
      recovery.ts
      sleep.ts
      workouts.ts
      profile.ts         # getProfile() — single-shot
      body-measurements.ts  # listBodyMeasurements() — single-shot history
    oauth.ts             # unchanged (Phase 2)
    token-store.ts       # unchanged (Phase 2)
    errors.ts            # extended with WhoopApiError union (Phase 2 AuthError FROZEN)
  ```
- **D-18:** **`callWithAuth` wraps inside `httpGet` exactly once.** Per-resource modules never reference `callWithAuth` directly — they call `httpGet`. This preserves Plan 02-04's "callWithAuth is the SOLE consumer of `tokenStore.getValidAccessToken()` outside token-store internals" contract. Plan 02-06's CI Gate E (only `src/infrastructure/whoop/token-store.ts` may reference the literal `'oauth/oauth2/token'` URL) stays green; D-18 attestation (`sanitize.ts` + `register.ts` UNMODIFIED across all Phase 2 plans) extends through Phase 3 — neither file changes here.
- **D-19:** **Pagination utility owns snake↔camel.** `paginateAll` consumes `next_token` (snake, as returned) and emits `nextToken` (camel, as the WHOOP request parameter) per Pitfall 10. Asserts on duplicate WHOOP IDs across consecutive pages (signals mid-pagination re-ordering); surfaces as `WhoopApiError({kind: 'validation', detail: 'duplicate id across pages'})`. Max per-page is endpoint-specific — pinned per-resource via `const PAGE_SIZE = …` constants in each resource module; values come from D-12's research item.
- **D-20:** **Rate-limit semaphore = 4 concurrent in-process.** Module-level state in `rate-limit.ts`; every `httpGet` call acquires + releases. Honors `X-RateLimit-Remaining` (throttle when `< 10` by delaying the next acquire) and on `429`, sleeps `X-RateLimit-Reset` seconds (NOT a fixed backoff — Pitfall 11). `--days 365` backfill respects both gates without burning quota.
- **D-21:** **HTTP base URL pinned to `https://api.prod.whoop.com`** at module-load constant in `client.ts`. ADR-0007 (read-only WHOOP): no write-method support exposed in `httpGet` — GET-only client. POST is reserved for token-endpoint refresh, which lives in `token-store.ts` and `oauth.ts` only (Plan 02-06 Gate E enforces).
- **D-22:** **Errors.** Extend `src/infrastructure/whoop/errors.ts` (Phase 2 file) with new `WhoopApiError = unauthorized | rate_limited | network | validation | server | unknown` discriminated union. `AuthError` FROZEN at 6 kinds since Plan 02-01 Wave 0 stays unmodified. Both unions live side-by-side in the same file with shared formatter helpers.

### Sync orchestration shape (SYNC-01, SYNC-05)
- **D-23:** **Sequential across the 6 resources, parallel-within-resource bound by the semaphore.** Resource order: profile → body_measurements → cycles → recoveries → sleeps → workouts. Reasons: (a) profile + body_measurements are lightest (one-shot, low-volume) — running them first surfaces auth/config errors before paginating through the heavy time-windowed resources; (b) sequential at the resource level makes partial-failure semantics obvious — a 429 on workouts doesn't block cycles; (c) within a resource, pagination iterates through `paginateAll`, which fires concurrent fetches bound by the semaphore-of-4 — gets backfill speed without rate-limit pressure across resources.
- **D-24:** **`sync_runs` row shape.** Insert at sync-start with `status='running'`, `started_at=now()`, `per_resource='{}'`. Update per-resource at completion of each resource. Finalize with `status='ok' | 'partial' | 'failed'` + `finished_at` + final `per_resource` JSON (`{cycles: {fetched, upserted, errors, durationMs}, recoveries: {...}, …}`) + `gaps_detected` count. `wal_checkpoint(TRUNCATE)` fires after a successful or partial sync (NOT after failed — leave WAL intact for diagnostics).
- **D-25:** **Per-resource outcome enum:** `success` | `partial_429` | `partial_5xx` | `failed_auth` | `failed_network` | `skipped`. The CLI prints a one-line summary per resource at exit. The MCP `whoop_sync` tool (Phase 4) will surface this verbatim through `structuredContent.perResource`.

### Configuration knobs surface (SYNC-01)
- **D-26:** **v1 ships three sync flags only:**
  - `--days N` (default `30` per SYNC-01) — sets `since = now() - N*24h`, overrides the trailing-7d default.
  - `--since <ISO-date>` — overrides `--days` and the cursor entirely; backfill mode.
  - `--resources <list>` (default all) — comma-separated subset of `cycles,recoveries,sleeps,workouts,profile,body_measurements`.
- **D-27:** **No new `config.json` keys this phase.** Semaphore size (`4`), rate-limit throttle threshold (`< 10 remaining`), retry caps, page-size pins all live as hard-coded constants at the top of `client.ts` / `rate-limit.ts` / `pagination.ts`. V2-05 + V2-10 own the "make these tunable via config" deferred work.

### Repository pattern + `raw_json` access (DATA-02, ARCHITECTURE.md Anti-Pattern 3)
- **D-28:** **Repositories return domain entity types**, never Drizzle row types. Mapping from Drizzle row → entity (snake_case columns → camelCase fields, JSON parse of typed sub-fields, score discriminator narrowing) lives inside the repository file. `domain/` and `services/` never import from `drizzle-orm/*`.
- **D-29:** **`raw_json` is hidden from the entity type.** Each repository exposes a separate diagnostic method:
  ```typescript
  getRawJson(id: string): Promise<string | null>
  ```
  for the future `whoop_query_cache` + `whoop_api_gap` tools (Phase 4) and forward-compat reparse paths (new Zod field → reparse from `raw_json` rather than re-sync). Domain code never calls `getRawJson` — it lives at the boundary.

### SQLite pragmas + WAL hygiene (DATA-01, Pitfall 12, Pitfall 13)
- **D-30:** **Pragmas on every connection:** `journal_mode=WAL`, `busy_timeout=5000`, `journal_size_limit=67108864` (64 MB), `wal_autocheckpoint=1000`, `synchronous=NORMAL`, `foreign_keys=ON`. Set in `infrastructure/db/connection.ts` before any query runs.
- **D-31:** **All write transactions use `BEGIN IMMEDIATE`** — Pitfall 13. Sync's per-resource upsert batch is one `BEGIN IMMEDIATE` transaction per resource (kept short — release between resources). The migrator uses `BEGIN IMMEDIATE` per D-06. Read transactions use `BEGIN DEFERRED` (default) — they don't take write locks.
- **D-32:** **`wal_checkpoint(TRUNCATE)` after every successful or partial sync** (SYNC-06). The doctor probe in Phase 5 warns if `db.sqlite-wal` size > 32 MB.

### MCP attestation (D-17 + D-18 carry-forward)
- **D-33:** **Zero new MCP tools in Phase 3.** `tools/list` continues to return EXACTLY one tool — `whoop_doctor` — from Plan 01-03. The `whoop_sync` tool lands in Phase 4. Phase 3 ships sync as a CLI command (`recovery-ledger sync`) and a service function (`services.runSync`) that Phase 4 will wrap in a 5-line MCP shim. The Plan 02-08 G-03 runtime attestation (`tools.length === 1`) remains correct throughout Phase 3 and breaks intentionally in Phase 4 when Plan 04-? adds the first new tool.
- **D-34:** **`src/mcp/sanitize.ts` and `src/mcp/register.ts` are UNMODIFIED in Phase 3.** D-18 attestation extends — Phase 1 sanitizer patterns (4 from D-07, plus Phase 2 D-19's `code=` + `client_secret`) cover every WHOOP-derived error shape Phase 3 produces. New `WhoopApiError` kinds flow through the existing sanitizer pipeline via `register.ts`'s try/catch wrapper.

### Claude's Discretion

The user delegated all four discussion areas at once: "Discuss them all amongst yourself, come to me if there isn't a clear winner." Same pattern as Phase 1 (only D-01 escalated) and Phase 2 (all areas resolved without escalation). Worked through each area; landed clear winners on all 34 decisions; no escalation. The single residual research item is D-12 (does WHOOP v2 accept an `updated_since` filter parameter on resource list endpoints) — flagged for the researcher, not for the user.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Architectural Decision Records (load-bearing)
- `agent_docs/decisions/0001-mcp-stdout-purity.md` — no `console.*`, no `process.stdout.write` from any MCP-reachable path; sync errors that bubble through MCP go through Phase 1's sanitizer/register pipeline
- `agent_docs/decisions/0002-single-flight-oauth-refresh.md` — token-store is the ONLY refresh consumer; `callWithAuth` from Plan 02-04 is the ONLY 401-reactive retry chokepoint; Phase 3's WHOOP client is the FIRST runtime consumer
- `agent_docs/decisions/0003-score-state-discipline.md` — `Score = discriminatedUnion('score_state', …)`; SCORED-only domain by default; load-bearing for Phase 3 schema + repositories
- `agent_docs/decisions/0006-fixture-only-tests.md` — MSW fixture-only, no live WHOOP calls in the default `npm test` run; suite under 60s
- `agent_docs/decisions/0007-whoop-read-only.md` — GET-only WHOOP HTTP client; pin to `api.prod.whoop.com`; no write methods

### Project policy
- `CLAUDE.md` §Critical Rules — table rows 1, 2, 3, 6, 7 all apply to Phase 3 code
- `CLAUDE.md` §Branch policy — every Phase 3 change goes through worktree + branch + PR + explicit approval (Phase 0 `.planning/**` carve-out has expired since `src/` is tracked on `origin/main`)
- `.planning/PROJECT.md` §Key Decisions — "Read-only + BYO OAuth + no consumer-endpoint scraping" + "Local-first by default" motivate the SQLite-only / no-telemetry / no-write-to-WHOOP posture
- `.planning/REQUIREMENTS.md` §Data Model & DB — DATA-01 through DATA-06 (this phase's six storage requirements)
- `.planning/REQUIREMENTS.md` §Sync — SYNC-01 through SYNC-07 (this phase's seven sync requirements)
- `.planning/REQUIREMENTS.md` §Out of Scope — "Free-form SQL pass-through MCP tool" stays out (Phase 4 `whoop_query_cache` uses typed per-resource filters)

### Architecture & stack
- `.planning/research/STACK.md` §Core Technologies — `better-sqlite3@^12.9.0`, `drizzle-orm@^0.45.2`, `drizzle-kit@^0.31.10`, `zod@^4.4.3`, `date-fns@^4.1.0`, `@date-fns/tz@^1`, `msw@^2.14.6` — versions pinned, do not bump silently
- `.planning/research/STACK.md` §Date Handling — date-fns v4 + `@date-fns/tz`; pin IANA zone at startup via `Intl.DateTimeFormat().resolvedOptions().timeZone`; preserve WHOOP's cycle assignment, do not re-derive day boundaries
- `.planning/research/STACK.md` §What NOT to Use — `axios`, `prisma`, `drizzle-kit push` in user-facing flows, JSON-blob-only storage for hot-path tables
- `.planning/research/ARCHITECTURE.md` §Component Responsibilities — `infrastructure/whoop/` owns the client + resources + rate-limit + retry; `infrastructure/db/` owns connection + schema + migrator + repositories; `domain/` is pure
- `.planning/research/ARCHITECTURE.md` §Recommended Project Structure (lines 83-225) — verbatim file layout for `src/infrastructure/whoop/`, `src/infrastructure/db/`, `src/domain/`, `tests/fixtures/whoop/`
- `.planning/research/ARCHITECTURE.md` §Pattern 2: Repository Returns Domain Entities, Not Rows — load-bearing for D-28
- `.planning/research/ARCHITECTURE.md` §Pattern 3: Result Objects with Confidence Tiers — services return typed results; errors translate at the service boundary
- `.planning/research/ARCHITECTURE.md` §Migrations (lines 590-624) — schema-as-source-of-truth; `drizzle-kit generate` for committed migrations; runs at every connection
- `.planning/research/ARCHITECTURE.md` §Concurrency (Token Refresh and DB Access) (lines 804-815) — WAL mode + `busy_timeout=5000`; reads do not block writes; `BEGIN IMMEDIATE` for writes
- `.planning/research/ARCHITECTURE.md` §Anti-Pattern 3 (lines 864-868) — Drizzle row types NEVER in `domain/` or `services/`
- `.planning/research/ARCHITECTURE.md` §Anti-Pattern 7 (lines 888-892) — `drizzle-kit push` is FORBIDDEN outside dev
- `.planning/research/PITFALLS.md` §Pitfall 3 — silent PENDING_SCORE / UNSCORABLE consumption; D-03 + D-04 mitigate
- `.planning/research/PITFALLS.md` §Pitfall 6 — DST/tz-shift corruption; D-13/14/15/16 mitigate
- `.planning/research/PITFALLS.md` §Pitfall 7 — mid-flight migration failure; D-06/07/08 mitigate
- `.planning/research/PITFALLS.md` §Pitfall 10 — pagination cursor confusion / ordering; D-19 mitigates
- `.planning/research/PITFALLS.md` §Pitfall 11 — 429 + X-RateLimit handling; D-20 mitigates
- `.planning/research/PITFALLS.md` §Pitfall 12 — unbounded WAL growth; D-30/32 mitigate
- `.planning/research/PITFALLS.md` §Pitfall 13 — `BEGIN IMMEDIATE` vs `BEGIN DEFERRED`; D-31 enforces
- `.planning/research/PITFALLS.md` §Pitfall 15 — webhook-vs-polling decision; webhooks stay out of v1 per scope guardrail
- `.planning/research/PITFALLS.md` §Pitfall 16 — hybrid storage (normalized + raw_json); D-01 + D-29 implement
- `.planning/research/PITFALLS.md` §Pitfall 19 — silent missing days; D-09 + D-10 + D-24 surface in `sync_runs`
- `.planning/research/SUMMARY.md` §Risks — concurrency #1 (Phase 2), then small-sample patterns (Phase 4), then setup friction (Phase 5)

### Roadmap context
- `.planning/ROADMAP.md` §Phase 3 — Goal, success criteria (5 of them), depends-on (Phase 2: single-flight refresh + keychain-backed token store)
- `.planning/ROADMAP.md` §Cross-Cutting Concerns rows "score_state discriminated-union enforcement" and "DST / tz-shift exclusion" — Phase 3 origin, tests stay in CI from this phase forward
- `.planning/phases/01-foundation-stdout-pure-mcp-bootstrap/01-CONTEXT.md` §Decisions — D-05/06 lock the doctor JSON shape Phase 3's lightweight DB probes will follow
- `.planning/phases/02-oauth-token-store-single-flight-refresh/02-CONTEXT.md` §Decisions — D-13 (scopes), D-14/15/16 (refresh trigger + retry budget), D-17 (zero new MCP tools — extended through Phase 3 as D-33), D-18 (sanitize.ts + register.ts unchanged — extended as D-34)
- `.planning/STATE.md` §Open Todos — flags D-12 (WHOOP v2 `updated_since` filter support) and D-06 (Drizzle migrator crash-recovery contract) as research-deepening candidates for Phase 3

### Conventions (project-local)
- `agent_docs/conventions.md` — TS strict, no default exports, lite hexagonal, validation at boundaries only
- `agent_docs/conventions.md` §Testing — `pool: 'forks'` for Vitest (needed for the cross-process migration crash test); fixtures live under `tests/fixtures/whoop/<resource>/<scenario>.json`; one MSW handler file per resource

### External (consulted during discussion; researcher confirms or refines)
- WHOOP for Developers — Pagination (`https://developer.whoop.com/docs/developing/pagination/`) — `next_token` in responses, `nextToken` as request param; per-endpoint max page sizes. **Research item:** confirm current max page sizes per resource (cycles, recovery, sleep, workouts) for D-19 page-size pins.
- WHOOP for Developers — Rate Limiting (`https://developer.whoop.com/docs/developing/rate-limiting/`) — 100 req/min, 10,000 req/day, `X-RateLimit-Remaining` + `X-RateLimit-Reset` headers, no documented `Retry-After`. Used in D-20.
- WHOOP for Developers — Cycle (`https://developer.whoop.com/docs/developing/user-data/cycle/`) — Physiological Cycles, `timezone_offset` field, retroactive updates via `updated_at`. Used in D-09/D-10.
- WHOOP for Developers — v1 to v2 Migration (`https://developer.whoop.com/docs/developing/v1-v2-migration/`) — UUID IDs (not integers), endpoint path changes, `score_state` semantics. Used in D-01/D-11.
- WHOOP for Developers — Recovery / Sleep / Workout resource docs — score_state values, sleep-id UUID basis, raw field shape. **Research item:** confirm `updated_at` is returned on cycles + recovery + sleep + workouts response shapes; if yes, confirm whether endpoints accept `updated_since` filter param (D-12).
- Drizzle ORM — Migrations (`https://orm.drizzle.team/docs/migrations`) — versioned generate/migrate workflow, `__drizzle_migrations` ledger, `--> statement-breakpoint` SQLite-specific recreation pattern. Used in D-06.
- Drizzle ORM — drizzle-kit migrate (`https://orm.drizzle.team/docs/drizzle-kit-migrate`) — programmatic migrator API; the default uses `BEGIN` not `BEGIN IMMEDIATE`, which is why D-06 hand-rolls.
- better-sqlite3 — WAL mode + performance (`https://github.com/WiseLibs/better-sqlite3/blob/master/docs/performance.md`) — WAL pragma semantics, checkpoint starvation. Used in D-30/D-32.
- SQLite — Write-Ahead Logging (`https://sqlite.org/wal.html`) — concurrent readers + single writer; backup must include `-wal` + `-shm`. Used in D-07.
- `@date-fns/tz` README — `tzDate()` / `tzOffset()` for IANA-zone arithmetic. Used in D-13.
- MSW 2.x docs (`https://mswjs.io/`) — Node setup, handler-per-resource pattern. Used in the fixture layout.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- **`src/services/refresh-orchestrator.ts`** (Plan 02-04, 133 LOC) — `callWithAuth<T>(operation, options?)`: 401-reactive retry policy chokepoint with budget = 1. `httpGet` in `infrastructure/whoop/client.ts` wraps every WHOOP fetch through this exactly once (D-18). The orchestrator's `FetchLikeResponse` type is intentionally minimal (`{status: number}`) so Phase 3's response wrapper can be whatever the WHOOP client returns — no coupling.
- **`src/infrastructure/whoop/token-store.ts`** (Plan 02-02, ~450 LOC) — `tokenStore.getValidAccessToken()`. Only consumed by `refresh-orchestrator.ts` outside the file (Gate E in `scripts/ci-grep-gates.sh` enforces). Phase 3 code calls `callWithAuth`, not `tokenStore.getValidAccessToken` directly.
- **`src/infrastructure/whoop/errors.ts`** (Plan 02-01, FROZEN at 6 kinds: `auth_missing`, `auth_expired`, `auth_state_mismatch`, `auth_timeout`, `refresh_failed`, `auth_port_in_use`) — Phase 3 extends this file with `WhoopApiError` (new discriminated union, sibling to `AuthError`). `AuthError` itself stays untouched (D-22).
- **`src/infrastructure/config/paths.ts`** (Plan 02-01) — `paths` resolves `~/.recovery-ledger/` + override via `RECOVERY_LEDGER_HOME`. Phase 3 extends ResolvedPaths with `dbFile`, `dbWalFile`, `dbShmFile`, `backupsDir`, `migrationsDir` — same pattern as Plan 02-01's `tokensFile` / `tokensLockFile` / `storageModeFile` additions.
- **`src/infrastructure/config/schema.ts`** (Plan 02-01) — canonical `ConfigSchema` + `D13_SCOPES`. Phase 3 may extend the Zod schema with v1 sync defaults if any survive D-26/D-27 (currently none — all knobs are CLI flags or hard-coded constants).
- **`src/infrastructure/config/logger.ts`** (Plan 01-02) — Pino → stderr fd 2. WHOOP client + migrator + sync service use this for any structured logging (`logger.warn({event: 'rate_limit_throttle', remaining: N})`). Never inline response bodies or tokens (ADR-0001 + Pitfall 17).
- **`src/mcp/sanitize.ts`** (Plan 01-03 + Plan 02-07 fixtures) — 4 D-07 patterns + D-08 cause walker + D-19 `code=` / `client_secret` patterns. Phase 3 adds NO new patterns; new `WhoopApiError` shapes flow through the existing sanitizer pipeline (D-34).
- **`src/mcp/register.ts`** (Plan 01-03) — try/catch/sanitizer wrapper. Phase 3 adds NO new MCP tools (D-33); `register.ts` stays UNMODIFIED.
- **`src/services/index.ts`** (Plan 02-04) — services barrel with `runDoctor` + `refreshOrchestrator`. Phase 3 extends with `runSync: typeof runSync` (declared here; defined in `src/services/sync/index.ts`); same wiring pattern as Phase 2's `refreshOrchestrator` addition.
- **`tests/helpers/msw-whoop-oauth.ts`** (Plan 02-01) — MSW helper for the OAuth token endpoint. Phase 3 adds sibling helpers per resource: `tests/helpers/msw-whoop-cycles.ts`, `msw-whoop-recovery.ts`, `msw-whoop-sleep.ts`, `msw-whoop-workouts.ts`, `msw-whoop-profile.ts`, `msw-whoop-body-measurements.ts`. Each is a thin wrapper around `http.get` returning fixture JSON; one-shot override hooks for 429 / 5xx scenarios per Plan 02-01's `setNextResponse` precedent.

### Established Patterns
- **Strict TS + ESM, no default exports** (conventions.md) — all Phase 3 code follows.
- **Lite hexagonal** (research/ARCHITECTURE.md) — `infrastructure/whoop/` (driven adapter) ↔ `services/sync/` (orchestration) ↔ `infrastructure/db/repositories/` (driven adapter). CLI shim in `src/cli/commands/sync.ts` is ≤5 lines; MCP `whoop_sync` shim arrives in Phase 4 also ≤5 lines.
- **Discriminated-union errors** (research/ARCHITECTURE.md §Error model + Phase 2 precedent) — `WhoopApiError` joins `AuthError` in `infrastructure/whoop/errors.ts` with the same shape (named field + cause chain).
- **Comment style — no plan-grep-criterion collisions** — Plan 02-01 / 02-02 / 02-04 / 02-06 all hit this. Phase 3 doc comments avoid literal `console.*`, `process.stdout.write`, and the OAuth-token URL substring outside `token-store.ts`. Phrase as "direct stdout writes" / "console calls" / "the OAuth refresh endpoint" instead. (4th-time-in-a-row Phase 2 deviation — recommend an `agent_docs/learnings.md` entry as part of Phase 3 cleanup, but not load-bearing.)
- **CI grep gates pattern** (Phase 1 Gate A/B/C, Phase 2 Gate E added) — Phase 3 adds two more gates to `scripts/ci-grep-gates.sh`:
  - **Gate F:** no `fetch(` outside `src/infrastructure/whoop/client.ts` AND `src/infrastructure/whoop/token-store.ts` AND `src/infrastructure/whoop/oauth.ts` — keeps HTTP boundary monolithic.
  - **Gate G:** no `drizzle-orm/*` import outside `src/infrastructure/db/` — enforces ARCHITECTURE.md Anti-Pattern 3.
  - Both follow Gate E's per-line `grep -v *.test.ts` exclusion pattern.
- **Test fixtures committed as JSON** (Phase 1 D-02, Phase 2 D-23) — Phase 3 fixtures under `tests/fixtures/whoop/<resource>/<scenario>.json` (cycles/200-ok, cycles/200-paginated, cycles/200-dst-spring-forward, cycles/429-rate-limited, cycles/500-server-error, etc.).
- **`pool: 'forks'` for Vitest** (Plan 01-01) — required for the migration crash-recovery integration test (D-06 mid-statement kill) and any sync integration test that spawns child processes.
- **Vitest include glob extension** (Plan 02-08) — `tests/**/*.test.ts` is already in the include glob; Phase 3 integration tests under `tests/integration/sync/*.test.ts` are discoverable without config change.

### Integration Points
- **CI matrix stays `[macos-latest, ubuntu-latest]`** (Plan 02-08 D-25). Phase 3 inherits the matrix; Linux row continues to run `RECOVERY_LEDGER_FORCE_FILE_STORE=1` for the file-fallback path. No matrix change in Phase 3.
- **`recovery-ledger sync`** is a net-new Commander subcommand. Sits alongside `init`, `auth`, `doctor` under `src/cli/commands/sync.ts` — same ≤5-line shim discipline.
- **No new MCP tools.** `src/mcp/tools/` continues to hold only `whoop-doctor.ts`. Phase 4's first plan adds `whoop-sync.ts` as a 5-line shim over `services.runSync`.
- **Migrator runs at every CLI + MCP startup** (DATA-04 + ARCHITECTURE.md line 614) — `src/infrastructure/db/migrate.ts` is called at the top of `services.createServices()` (or a sibling `bootstrap.ts`). Plan 01-05's `createServices()` interface contract stays compatible; the migrator is an internal side effect of bootstrap, not a service method.

</code_context>

<specifics>
## Specific Ideas

- **Drizzle schema as single source of truth** (D-01, ARCHITECTURE.md §Migrations). `src/infrastructure/db/schema.ts` is the only place tables are defined. `drizzle-kit generate` produces committed SQL in `src/infrastructure/db/migrations/` with `_journal.json`. `drizzle-kit push` is FORBIDDEN outside dev experimentation — ARCHITECTURE.md Anti-Pattern 7.
- **One MSW handler file per resource** under `tests/helpers/msw-whoop-<resource>.ts` (mirroring Plan 02-01's `msw-whoop-oauth.ts`). Each handler reads from `tests/fixtures/whoop/<resource>/` and supports a one-shot override seam for 429 / 5xx fixtures.
- **Pinned page-size constants live in the resource modules, not pagination.ts.** Each resource module declares `const PAGE_SIZE = ...` based on WHOOP's per-endpoint max. The pagination utility consumes the page size as a parameter; the constant is grep-able per resource.
- **`baseline_excluded` is the discriminator, not `score_state`.** Phase 4 baseline queries default-filter on BOTH (`score_state = 'SCORED' AND baseline_excluded = 0`). D-16's opt-in flag covers both axes via `{includeUnscored, includeExcluded}` — symmetric escape hatch.
- **Re-flag on every retroactive update.** D-14's `baseline_excluded` value is computed at upsert time using the current cycle.start + cycle.end + cycle.timezone_offset (NOT cached from the first sync). If WHOOP retroactively shifts cycle.start past a DST boundary, the next sync re-flags it on the spot.
- **Cursor query is `MAX(updated_at) FROM <resource_table>`** — no `WHERE updated_at IS NOT NULL` filter and no `WHERE` clause at all. SQLite's `MAX()` already ignores NULL inputs and returns NULL when the table is empty or all rows are NULL; the caller wraps the result in `COALESCE(?, 0)` so an empty / all-NULL state falls back to "fetch everything." Keep the query minimal.
- **`sync_runs.gaps_detected` is a count, not a JSON blob.** Detailed gap entries (`updated_at` deltas, missing days, partial-resource details) live in `per_resource[<resource>].gaps`. Keeping the top-level field a count keeps the WAL hot path narrow.
- **Migration files use `wal_checkpoint` after schema-touching DDL.** Drizzle Kit doesn't emit checkpoints; D-06's wrapper runs `pragma wal_checkpoint(PASSIVE)` after each successful migration commit so a follow-up backup sees the WAL folded back into the main DB.

</specifics>

<deferred>
## Deferred Ideas

- **Concurrent across resources** — D-23 chose sequential at the resource level for clean partial-failure semantics. If post-Phase-3 backfill perf measurements show this is the bottleneck on `--days 365`, revisit with a "concurrent across resources, semaphore-bound at HTTP" mode under a `--parallel` flag. Tracked as a Phase 3 post-mortem item, not as Phase 3 scope.
- **WHOOP roundtrip check in `doctor`** — calls `/v2/user/profile/basic`. Phase 2 D-22 deferred to Phase 5; Phase 3 keeps the deferral. Phase 3 may add an offline-safe `db_open` + `schema_version` + `wal_size` probe trio that follows the Plan 02-06 pattern.
- **Webhook receiver for "real-time" updates** — Pitfall 15 lists this as PERMANENTLY DEFERRED per the scope guardrail. Polling-only in v1. Not reopening.
- **Daily-quota counter persistence** — Pitfall 11 proposes a local daily-quota row to refuse syncs that would overshoot 10,000 req/day. Useful diagnostic but not load-bearing for v1 (sync uses semaphore-of-4 + X-RateLimit-Remaining gate; quota overflow is hypothetical at single-user volumes). Revisit if a real overshoot ever happens.
- **`daily_summaries` table aggregation logic** — D-01 declares the table for ARCHITECTURE.md §Scaling priorities (year 3+ aggregation perf). Phase 3 creates the table empty; Phase 4 baseline service writes to it during review computation. Phase 3 doesn't aggregate.
- **Configurable baseline window beyond 30 days** — REQUIREMENTS.md V2-05. Not in Phase 3 scope; the schema accommodates it (no hard-coded 30-day TTL on cycles).
- **Export to CSV / JSONL / Parquet** — REQUIREMENTS.md V2-04. Out of scope; `getRawJson(id)` (D-29) is the v1 forward-compat path.
- **AES-256-GCM passphrase-derived fallback for file backend** — Phase 2 deferred. Plaintext-in-chmod-600 stays per AUTH-03 verbatim. Phase 3 inherits the deferral.
- **DST-rule fixtures for the southern hemisphere** — D-15 ships northern-hemisphere fixtures (US DST). Single-user / single-target (Chris in `America/Los_Angeles`); southern-hemisphere DST detection works for free via `@date-fns/tz` but isn't fixture-tested in v1.

</deferred>

---

*Phase: 03-data-model-db-layer-sync-loop*
*Context gathered: 2026-05-16*
