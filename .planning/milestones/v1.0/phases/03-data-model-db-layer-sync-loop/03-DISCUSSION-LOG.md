# Phase 3: Data Model, DB Layer & Sync Loop - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-05-16
**Phase:** 03-data-model-db-layer-sync-loop
**Areas discussed:** Migration crash-recovery contract, `updated_at` delta + 7-day re-window, DST/tz-shift exclusion, WHOOP client structure

---

## Gray-Area Selection

| Option | Description | Selected |
|--------|-------------|----------|
| Migration crash-recovery contract | Per-statement vs per-file BEGIN IMMEDIATE; backup retention/location/perms; fails-closed at startup (refuse-to-open vs auto-restore vs print steps). Flagged in STATE.md as research-deepening. | ✓ |
| updated_at delta + 7-day re-window shape | Global vs per-resource cursor; cursor storage (sync_runs vs sync_cursors vs MAX(updated_at)); re-window = `min(cursor, now()-7d)` vs trailing-7d in addition. Also flagged in STATE.md. | ✓ |
| DST/tz-shift exclusion rule + flag storage | Detection rule semantics; flag on row vs computed at query time; fixture design for DST + multi-tz trip. | ✓ |
| WHOOP client structure + per-resource shape | One client class vs per-resource modules; pagination + snake↔camel + rate-limit location; where `callWithAuth` wires in. | ✓ |

**User's choice:** Free-text response: "Discuss them all amongst yourself, come to me if there isn't a clear winner" — same delegation pattern as Phases 1 and 2.

**Notes:** Treated all four areas as Claude's Discretion. Worked through each, landed clear winners on all 34 numbered decisions plus seven sub-decisions, no escalation needed.

---

## Area 1 — Migration Crash-Recovery Contract

| Option | Description | Selected |
|--------|-------------|----------|
| Drizzle default migrator | `migrate()` from `drizzle-orm/better-sqlite3/migrator` runs each migration in `BEGIN` (DEFERRED). Less code. | |
| Hand-rolled `BEGIN IMMEDIATE` wrapper | Whole `.sql` file as one atomic unit; rollback on throw; structured MigrationError; manual `__drizzle_migrations` update. | ✓ |

**Notes:** Pitfall 13 explicitly bans `BEGIN DEFERRED` (the better-sqlite3 default) because it can upgrade mid-transaction and defeat `busy_timeout`. Drizzle's default uses DEFERRED, so the hand-rolled wrapper is the only way to honor Pitfall 13 + DATA-04's "BEGIN IMMEDIATE" verbiage. `--> statement-breakpoint` markers in Drizzle SQL are treated as SQLite-API parsing aids, not transactional boundaries.

| Option | Description | Selected |
|--------|-------------|----------|
| Keep all backups indefinitely | Disk grows over time; user has full history. | |
| Keep last 3 backups | Sort by mtime desc, unlink rest including `-wal`/`-shm` companions. | ✓ |
| Keep most recent backup only | Cheapest, but only one rollback target. | |

**Notes:** Pitfall 7 names "last 3" explicitly. Location `~/.recovery-ledger/backups/db.<ISO>-pre-<tag>.sqlite`, `chmod 600` per Security Mistakes table.

| Option | Description | Selected |
|--------|-------------|----------|
| Auto-restore from latest backup on partial-migration detect | Fast recovery; risk silent decision-ledger overwrite. | |
| Refuse to open + print restore steps | User runs `cp <backupPath> ~/.recovery-ledger/db.sqlite` manually; explicit. | ✓ |

**Notes:** Auto-restore on a personal tool whose decision ledger is irreplaceable is too dangerous. Explicit user-initiated restore is the safe default.

## Area 2 — `updated_at` Delta + 7-Day Re-Window

| Option | Description | Selected |
|--------|-------------|----------|
| Single global high-water-mark | One cursor across all resources. | |
| Per-resource cursor in `sync_cursors` table | New dedicated table. | |
| Per-resource cursor stored as JSON in `sync_runs` | Cursor lives in the latest successful sync row. | |
| Per-resource cursor = `MAX(updated_at) FROM <resource_table>` | Computed at sync-start; no separate cursor storage. | ✓ |

**Notes:** The table is the source of truth. Atomic upserts mean a partial-failure sync resumes from the right `MAX(updated_at)` automatically. One fewer surface to migrate or back up.

| Option | Description | Selected |
|--------|-------------|----------|
| Re-window = `since = max(cursor - 7d, oldest_in_window)` | Extends cursor window backward. | |
| Re-window = trailing 7 days IN ADDITION to cursor delta | `since = min(cursor, now() - 7d)`. | ✓ |

**Notes:** ARCHITECTURE.md anti-pattern 15 and Pitfall 15 both name interpretation B verbatim: "always re-window the last 7 days regardless."

**Research item flagged for the researcher:** confirm whether WHOOP v2 list endpoints accept an `updated_since` filter param. If yes, plumb directly; if no, post-filter client-side after paginating by `start >= since`.

## Area 3 — DST/Tz-Shift Exclusion Rule + Flag Storage

| Option | Description | Selected |
|--------|-------------|----------|
| Detect via `timezone_offset` only | One field; misses DST straddle. | |
| Detect via two sub-rules OR'd (DST + tz-drift) | DST: `@date-fns/tz` offset compare. Tz-drift: cycle vs prior `timezone_offset`. | ✓ |

**Notes:** Pitfall 6 names both shapes explicitly. User IANA zone read once at sync-start.

| Option | Description | Selected |
|--------|-------------|----------|
| Computed at query time | No new schema column; recompute per query. | |
| Flag column on cycles row (`baseline_excluded INTEGER NOT NULL DEFAULT 0` + reason) | Computed at upsert; cached. | ✓ |

**Notes:** Flag column is faster (no per-query DST recomputation), explainable (data-quality resource lists excluded days with reasons), and survives retroactive WHOOP updates (re-flag on upsert). Only `cycles` carries the flag; recovery/sleep/workouts inherit via `cycle_id`.

## Area 4 — WHOOP Client Structure

| Option | Description | Selected |
|--------|-------------|----------|
| Single `WhoopClient` class with methods per resource | Monolithic; method = resource. | |
| Per-resource module files over shared `httpGet` in `client.ts` | One file per resource; shared HTTP boundary. | ✓ |

**Notes:** Per-resource maps 1:1 to MSW handler files and fixture directories. Cross-cutting concerns (pagination, rate-limit, retry, callWithAuth) live in `client.ts` and siblings.

| Option | Description | Selected |
|--------|-------------|----------|
| `callWithAuth` at each per-resource call site | Explicit at the call site. | |
| `callWithAuth` inside `httpGet` exactly once | Per-resource modules don't see it; chokepoint preserved. | ✓ |

**Notes:** Preserves Plan 02-04's "callWithAuth is the SOLE consumer of `tokenStore.getValidAccessToken()`" contract at grep-time. Plan 02-06's Gate E stays green.

## Claude's Discretion

User delegated all four discussion areas at once with the same free-text response used in Phases 1 and 2. Claude landed on:
- 34 numbered decisions (D-01 through D-34) without escalation.
- Sub-decisions on schema scope (8 tables, oauth_tokens dropped per ARCHITECTURE.md), Score union shape, repository pattern, sync orchestration, config knobs, SQLite pragmas, and MCP attestation carry-forward.
- One research item flagged for the researcher (D-12, WHOOP v2 `updated_since` filter support) — not for the user.

Same Claude's Discretion outcome as Phase 1 (only D-01 package manager escalated) and Phase 2 (no escalation).

## Deferred Ideas

- Concurrent-across-resources sync (`--parallel` flag) — post-Phase-3 perf measurement
- WHOOP roundtrip in `doctor` — Phase 5
- Webhook receiver — permanently deferred per scope guardrail
- Daily-quota counter persistence — diagnostic-only, revisit on real overshoot
- `daily_summaries` aggregation logic — Phase 4 baseline service owns
- Configurable baseline window — V2-05
- Export to CSV / JSONL / Parquet — V2-04
- AES-256-GCM file fallback — Phase 2 deferred, Phase 3 inherits
- Southern-hemisphere DST fixtures — single-user (Chris in `America/Los_Angeles`); detection works for free via `@date-fns/tz`, just not fixture-tested in v1
