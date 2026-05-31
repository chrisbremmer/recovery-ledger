# Phase 7 Context: DB Integrity Gate

**Milestone:** v1.1 quality hardening
**Source roadmap:** `.planning/ROADMAP.md` § Phase 7
**Source research:** `.planning/research-v1.1/SUMMARY.md`
**GitHub issues:** #75, #76, #77, #88, #94 (all HIGH except #88/#94 which are MEDIUM but grouped here for build-order coherence)
**REQ-IDs:** DBIN-01..05

## Goal

Land defensive fixes for #75, #76, #77, #88, #94 (and the #95 `recovery.byRange includeExcluded` JOIN sibling) so `score_state` discriminated-union invariants are enforced at the SQL layer, `aborted` rows flow correctly through Zod/Drizzle/QueryCache, and silent data-integrity failures (JOIN gap, decisions no-op, WAL checkpoint failures) escalate visibly.

Ships as **5 sub-PRs in build order**:
- **Sub-PR A — DBIN-01** (#75): `aborted` enum dedup + `madge --circular` CI gate
- **Sub-PR B — DBIN-03** (#77): `score_state` CHECK constraints + two-step migration
- **Sub-PR C — DBIN-02** (#76): sleeps/workouts byRange FK JOIN gap + #95 includeExcluded sibling
- **Sub-PR D — DBIN-04** (#88): decisions.updateOutcome returns `{changed: 0|1}`
- **Sub-PR E — DBIN-05** (#94): wal_checkpoint(TRUNCATE) failure escalation

Order is load-bearing: DBIN-03's CHECK references the enum widened by DBIN-01; DBIN-02 + #95 sibling fix touch the same byRange JOIN logic; #75 must land first with the `madge --circular src/` CI gate (ESM cycles on enum dedup surface at runtime as `undefined`, not at compile time).

## In Scope (this phase, all 5 sub-PRs)

### DBIN-01 (#75) — first

Files touched:
- `src/domain/schemas/entities.ts:238` — Zod enum missing `'aborted'` (currently `['running', 'ok', 'partial', 'failed']`)
- `src/services/cache/types.ts:97` — QueryCacheInput status union missing `'aborted'`
- `src/infrastructure/db/schema.ts:223-226` — Drizzle column enum already includes `'aborted'`; will reference shared constant
- `src/domain/types/entities.ts:230` — type union already includes `'aborted'` (post-Phase 5)
- `src/infrastructure/db/repositories/sync-runs.repo.ts` — `byStatus()` parameter type follows the same shape; verify
- NEW: shared constant (likely `src/domain/types/sync-run-status.ts` or extension of `src/domain/types/sync.ts`)
- NEW: `madge` dev dep + CI workflow step (`npm run check:circular` or similar)
- Tests: round-trip insert→`SyncRunEntitySchema.parse()` with `'aborted'` row in `sync-runs.repo.test.ts`

Acceptance:
- A single `SYNC_RUN_STATUSES` (or equivalent) constant is the source of truth
- Drizzle column enum, Zod enum, and QueryCache input type ALL reference it
- `madge --circular src/` exits 0 in CI; the gate must catch cycles introduced by future imports
- Round-trip test: insert `status='aborted'` row, repo returns it, `SyncRunEntitySchema.parse()` succeeds

### Out of Scope (later sub-PRs in this phase)

- DBIN-03 (CHECK constraint migration) — depends on DBIN-01
- DBIN-02 (byRange JOIN) — independent of DBIN-01
- DBIN-04 (decisions.updateOutcome) — independent
- DBIN-05 (WAL checkpoint escalation) — independent

## Out of Scope (this PHASE)

- Phases 8-12 (refresh atomicity, lifecycle, architecture, regression net, backlog drain).
- Any new infrastructure beyond `madge` (dev-only dep).

## Dependencies

- Phase 6 complete (#78, #79, #80 merged). ✓

## Critical Rules Touched

- **ADR-0003 score_state discipline** — DBIN-03 strengthens it at the SQL layer with CHECK constraints (later sub-PR).
- **ADR-0006 fixture-only tests** — all round-trip tests stay offline.

## Success Criteria (from ROADMAP.md § Phase 7)

1. `whoop_query_cache resource=sync_runs status=aborted` returns aborted rows through the typed repo without Zod errors; the enum is defined ONCE in a single source-of-truth module imported by Drizzle column, Zod schema, and `QueryCache` input, with `madge --circular src/` green in CI.
2-5. (See ROADMAP — these are for DBIN-02..05 in later sub-PRs.)

## Test Plan

- `npm run test` passes (all 1324+ from post-Phase-6 baseline)
- New round-trip test in `sync-runs.repo.test.ts`
- New `npm run check:circular` (madge) gate green in CI

## Risks (from PITFALLS.md)

- **#75 ESM circular import on enum dedup** — if the shared enum constant ends up imported by Drizzle column AND `domain/schemas/entities.ts` AND `services/cache/types.ts`, a hidden cycle through `infrastructure/db/schema.ts` could resolve to `undefined` at runtime. **Required prevention:** `madge --circular src/` CI gate must land in the same PR.
- **DBIN-03 legacy-row CHECK abort** — later sub-PR will use a two-step migration with pre-flight count.

## References

- `.planning/research-v1.1/PITFALLS.md` Pitfalls #75, #77
- `agent_docs/decisions/0003-score-state-discipline.md`
- GitHub: #75 (+#15/#35 context for the original `'aborted'` widening)
