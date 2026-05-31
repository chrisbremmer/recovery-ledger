---
phase: 04-domain-math-reviews-decision-ledger-mcp-surface
plan: 06
subsystem: services/decision+api-gap, infrastructure/db/repositories/decisions
tags: [decision-ledger, repository-extension, api-gap, ulid, tdd, wave-2, dec-01, dec-02, dec-03, mcp-01]

requires:
  - phase: 03-data-model-db-sync-loop (Plan 03-08)
    provides: createDecisionsRepo with Phase 3 stub surface (insert / byId / listOpen); db.transaction({behavior:'immediate'}) precedent; rowToDecision mapper; in-memory-db.ts test helper
  - phase: 04-domain-math-reviews-decision-ledger-mcp-surface (Plan 04-01)
    provides: containsBannedToneToken(text) + BANNED_TONE_WORDS (banned-words.ts) — used by api-gap tests for D-26 source-layer lint
  - phase: 04-domain-math-reviews-decision-ledger-mcp-surface (Plan 04-02)
    provides: AddDecisionInput, ReviewDecisionsInput, ReviewDecisionsResult, UpdateDecisionInput type contracts (services/decision/types.ts); ApiGapEntry + ApiGapResult (services/api-gap/types.ts)
  - npm package: ulid@^3.0.2 (installed Plan 04-01)
    provides: ulid() — 26-char uppercase Crockford Base32 lexicographically-sortable id

provides:
  - src/infrastructure/db/repositories/decisions.repo.ts — EXTENDED with 4 methods (updateOutcome / countSince / findByPrefix / listAll); the DecisionsRepo interface grew from 3 to 7 methods; all writes flow through db.transaction({behavior:'immediate'}) (Pitfall 13); ORM prepared statements neutralize T-04-S2 (SQL-injection / shell-metacharacter payloads).
  - src/infrastructure/db/repositories/decisions.repo.test.ts — NEW; 18 tests covering Phase 3 carry-forward (insert/byId/listOpen) plus the 4 new methods; pins idempotency, silent no-op on missing id, case-insensitive prefix, includes Phase 4 + Phase 3 surface end-to-end.
  - src/services/decision/index.ts — NEW; addDecision / reviewDecisions / updateDecision orchestration. ULID generated at the SERVICE layer before repo.insert (D-19). reviewDecisions dual-mode dispatch on `mode` discriminator (D-21). Pitfall 17 + ADR-0001 compliant — no console.*; structured logs carry id + category only (no decision text).
  - src/services/decision/index.test.ts — NEW; 11 tests including 2 T-04-S2 fixtures (SQL-injection `'; DROP TABLE decisions; --` and shell-metacharacters `$(rm -rf /)`) that confirm payloads round-trip unchanged through service → repo → ORM.
  - src/services/api-gap/data.ts — NEW; API_GAP_ENTRIES frozen module-load const with 6 entries covering the named features in REQUIREMENTS §Out of Scope (Healthspan, ECG, Blood Pressure, Journal, Continuous Heart Rate, Hormonal Insights). available_via_v2_api locked to literal `false` via the type system.
  - src/services/api-gap/index.ts — NEW; getApiGap() trivial async accessor returning { entries: API_GAP_ENTRIES }. Async-uniform with the rest of the service layer.
  - src/services/api-gap/index.test.ts — NEW; 30 tests across 2 describe blocks: the catalog contract (length, literal type, immutability, named-feature coverage) plus per-entry per-field banned-tone-word lint.

affects: [04-07 services/review/weekly.ts (will compose decisionsRepo.countSince for D-22 weekly decision_prompt gating; will compose decisions service for the decision_prompt slot), 04-08 services/bootstrap.ts (will wire createDecisionsRepo + decision service + api-gap service into createServices()), 04-10 MCP tools (whoop_add_decision → addDecision, whoop_review_decisions → reviewDecisions, whoop_api_gap → getApiGap, whoop://api-gaps + whoop://decisions/open resources), 04-11 CLI commands (decision add → addDecision, decision review → reviewDecisions{mode:'list'}, decision update → updateDecision via decisionsRepo.findByPrefix for short-prefix resolution)]

tech-stack:
  added: []
  patterns:
    - "Repository extension as additive surface — the Phase 3 stub (insert / byId / listOpen) lives untouched; the 4 new methods append to the DecisionsRepo interface and the createDecisionsRepo factory. The header comment is the only modified section. Zero schema changes — every DEC-01/02 column already existed (Phase 3 schema audit confirmed in 04-RESEARCH.md §Decision Ledger Persistence)."
    - "All writes flow through db.transaction({behavior:'immediate'}) — Pitfall 13 discipline. The explicit `behavior: 'immediate'` locks the BEGIN up front so a deferred upgrade cannot defeat the per-connection busy_timeout. updateOutcome on a missing id silently no-ops (0 rows changed); the caller (service layer) verifies via byId — fail-loud lives at the service, not the repo."
    - "SQLite prefix lookup via parameterized LIKE — findByPrefix normalizes the user's input to upper-case BEFORE building the LIKE pattern, because the ULID alphabet is upper-case Crockford Base32. The pattern is constructed via drizzle's sql`...` template (parameterized) so an attacker-controlled prefix cannot inject SQL. Case-insensitivity is enforced at the JS layer (toUpperCase), not at the SQLite collation layer — which keeps the index-friendly scan path available without depending on COLLATE NOCASE."
    - "Service-layer ULID generation per D-19 — ulid() is called at the SERVICE layer before repo.insert(). The repo trusts the caller to pass a valid ULID string (Phase 3 contract). This puts id allocation in the same composition unit as the smart-defaults logic (category ?? 'general', null for optional fields) — both are policy decisions and both live above the persistence boundary."
    - "Dual-mode discriminated-union dispatch (D-21) — reviewDecisions reads `input.mode` and dispatches to list or update arms; the result is a discriminated union with the SAME `mode` field so the caller narrows on a single discriminator across input and output. The MCP tool can wire input.mode through verbatim. updateDecision is a thin convenience wrapper that delegates and unwraps."
    - "ADR-0001 + Pitfall 17 discipline at the service layer — no console.*; structured logs flow through deps.logger (Pino, stderr-bound). Decision text NEVER appears in log payloads — only { event, id, category } for add and { event, id, status } for update. The id (ULID) is non-PII; the category is a short label."
    - "T-04-S2 mitigation via the ORM's prepared-statement boundary — SQL-injection-style payloads (`'; DROP TABLE decisions; --`) and shell-metacharacter payloads (`$(rm -rf /)`) round-trip through the service → repo → drizzle prepared-statement chain UNCHANGED. The test fixtures confirm both: the decision text stored matches the input verbatim AND the DB schema is intact after."
    - "Object.freeze on API_GAP_ENTRIES locks immutability at runtime to match the `readonly ApiGapEntry[]` type. The literal `available_via_v2_api: false` is enforced by ApiGapEntry's type signature (per services/api-gap/types.ts) — adding an entry with `true` is a compile error. Phase 5 (DOC-03/04) generates markdown by READING this module, so the catalog is the single source of truth."

key-files:
  created:
    - src/infrastructure/db/repositories/decisions.repo.test.ts (253 LOC — 18 tests across 5 describe blocks)
    - src/services/decision/index.ts (135 LOC — 3 service functions + 2 Deps shapes)
    - src/services/decision/index.test.ts (236 LOC — 11 tests across 6 describe blocks; 2 T-04-S2 fixtures)
    - src/services/api-gap/data.ts (60 LOC — frozen 6-entry catalog)
    - src/services/api-gap/index.ts (18 LOC — async accessor)
    - src/services/api-gap/index.test.ts (73 LOC — 30 tests across 2 describe blocks)
  modified:
    - src/infrastructure/db/repositories/decisions.repo.ts (95 LOC → 161 LOC — added 4 methods + interface signatures + import gte/sql; header comment updated)

key-decisions:
  - "ApiGapResult.entries typed as ApiGapEntry[] (mutable) at the type layer (Plan 04-02 contract) while API_GAP_ENTRIES is readonly ApiGapEntry[] frozen. getApiGap() returns the frozen array via a single `as ApiGapResult['entries']` cast at the service boundary so the runtime reference is preserved (test asserts `entries === API_GAP_ENTRIES` via `toBe`, reference equality). This matches the existing pattern from Plan 04-02 (the type intentionally allows mutable consumers — JSON-RPC serialization downstream doesn't preserve readonly). The cast is the ONE place that surface narrows; everywhere else inside the file stays strict-readonly."
  - "ApiGapEntry.feature value uses `ECG (electrocardiogram)` rather than the plan's `ECG`. The expanded form is more discoverable in the generated Phase 5 markdown; the test asserts `feature.toLowerCase().includes('ecg')` so coverage holds. Zero behavior change — purely a doc-readability improvement at the catalog data layer."
  - "Test file uses a typed Harness helper that holds mem + repo + logger + deps together. Tests that need a fresh DB call makeHarness() in beforeEach + h.mem.close() in afterEach. The Pino stub uses `as unknown as Logger` because Pino's Logger interface has 30+ methods and a typed double would dwarf the test fixtures. The service only calls logger.info; everything else on the stub is a vi.fn() noop that ignores arguments."
  - "Test 4 in services/decision asserts the structured-log payload via a fresh vi.fn() spy and reads `infoSpy.mock.calls[0]` for the payload. The test then asserts `JSON.stringify(payload).not.toContain('avoid late workouts')` — a defense-in-depth assertion that catches a future regression where someone adds a `text` field to the log payload. This is the runtime enforcement of Pitfall 17 (decision text never logged); ADR-0001 catches the console.* leak via grep gate B."
  - "Decision service `updateDecision` re-throws on an impossible list-mode result. The discriminator narrows the result type at compile time, but the runtime check (`if (result.mode !== 'update')`) is a defensive impossibility check — the same pattern Phase 3's rowToCycle uses for unknown score_state. If a future refactor of reviewDecisions accidentally returns the wrong arm, updateDecision throws with a precise message rather than returning a bare list."

decisions:
  - "Service-layer ULID generation is the policy boundary; the repo is purely persistence."
  - "updateOutcome is silent on missing id at the repo; the service layer surfaces it as `decision not found` after a follow-up byId returns null."
  - "Object.freeze + readonly + literal-false-type lock immutability at three layers for the API gap catalog."

requirements-completed: [DEC-01, DEC-02, DEC-03, MCP-01]
# DEC-01 (decision ledger persistence): repo.insert + service.addDecision wire the ULID
# + smart defaults + repo write end-to-end. The Phase 3 stub had the persistence shape;
# Plan 04-06 adds the orchestration. Final user-facing wiring closes in Plan 04-11 (CLI)
# + 04-10 (MCP tool); the service-layer contract is sealed here.
# DEC-02 (outcome record): repo.updateOutcome + service.reviewDecisions mode='update'
# +service.updateDecision wire the outcome-write path; the CLI surface lands in 04-11.
# DEC-03 (decision review listing): repo.listOpen / listAll + service.reviewDecisions
# mode='list' wire the read path; the CLI surface (decision review --all) lands in 04-11.
# MCP-01 (api-gap data): API_GAP_ENTRIES + getApiGap() ship the data layer; the MCP
# tool + resource surface lands in 04-10.

metrics:
  duration: 4min 12s
  tasks_completed: 3
  files_created: 5
  files_modified: 1
  test_files_added: 3
  tests_added: 59
  commits: 7
  full_suite_tests: 779 passed, 15 todos, 0 failures
  grep_gates: 10/10 green
  tsc_errors_introduced: 0
  tsc_errors_pre_existing: 3 (deferred — auth.ts + msw-whoop-oauth.ts)
completed: 2026-05-20
---

# Phase 4 Plan 06: Decisions Repo Extension + Decision Service + API Gap Data Summary

**One-liner:** Wave 2 anchor for the decision ledger — extends the Phase 3
decisions repo with updateOutcome / countSince / findByPrefix / listAll,
ships the decision-service orchestration layer with ULID generation and
smart defaults, and lands the in-source API-gap catalog with 6 entries
covering the named features in REQUIREMENTS §Out of Scope.

## What landed

### Task 1 — Decisions repo extension

`src/infrastructure/db/repositories/decisions.repo.ts` grew from 3 methods
to 7. The Phase 3 stub (`insert` / `byId` / `listOpen`) is unchanged; the
4 new methods append to the interface + factory:

| Method | Purpose | Pin |
|---|---|---|
| `updateOutcome(id, status, notes)` | Write the DEC-02 outcome (status + notes) | `db.transaction({behavior:'immediate'})` per Pitfall 13; silent no-op on missing id |
| `countSince(date)` | D-22 weekly-prompt gating | `gte()` + `COUNT(*)` over ISO-8601 strings |
| `findByPrefix(prefix)` | D-20 short-prefix lookup for `decision update <id-or-prefix>` | normalizes to upper-case before LIKE-scan (ULID is upper-case Crockford Base32) |
| `listAll()` | D-20 `--all` flag for `decision review` | `ORDER BY created_at DESC`; includes non-open rows |

The sibling test file (`decisions.repo.test.ts`) ships with 18 tests
across 5 describe blocks — Phase 3 carry-forward, updateOutcome (5 tests
covering idempotency + silent-no-op + clear-via-null + abandoned-removes-from-listOpen),
countSince (4 tests covering boundary inclusivity + future + epoch +
empty), findByPrefix (4 tests covering multi-match + case-insensitive +
no-match + unique), listAll (2 tests covering DESC ordering vs listOpen
+ empty-table).

### Task 2 — Decision service orchestration

`src/services/decision/index.ts` ships 3 functions:

- **`addDecision(input, deps)`** — ULID generated HERE (D-19), then
  `repo.insert()` with smart defaults (`category ?? 'general'`, null for
  optional fields), then `repo.byId(id)` for the round-trip return.
  Structured log carries `{ event: 'decision_added', id, category }`
  only — decision text never logged (Pitfall 17).
- **`reviewDecisions(input, deps)`** — D-21 dual-mode dispatch on
  `input.mode`. List mode picks `listOpen()` (default) or `listAll()`
  (when `includeAll === true`). Update mode calls `updateOutcome` + `byId`
  and throws when the id is unknown.
- **`updateDecision(input, deps)`** — CLI convenience wrapper that
  delegates to `reviewDecisions({mode:'update', ...})` and unwraps the
  discriminated-union result.

`Deps` is two narrow shapes — `AddDecisionDeps` (needs clock) +
`ReviewDecisionsDeps` (no clock). Both carry repos + logger.

The sibling test file ships 11 tests across 6 describe blocks including
2 T-04-S2 fixtures (SQL-injection + shell-metacharacters) that confirm
payloads round-trip unchanged through the service → repo → ORM.

### Task 3 — API gap catalog + service

`src/services/api-gap/data.ts` exports the 6-entry frozen catalog
covering the features named in REQUIREMENTS §Out of Scope:

| Feature | WHOOP consumer path | Proxy via v2 API |
|---|---|---|
| Healthspan | Health Monitor → Healthspan | long-run trends in recovery_score |
| ECG (electrocardiogram) | Heart → ECG | none |
| Blood Pressure | Heart → Blood Pressure | none |
| Journal | Journal | none |
| Continuous Heart Rate | Heart → Continuous HR | cycle.day_strain (HR-derived load) |
| Hormonal Insights | Health Monitor → Hormonal Insights | none |

`src/services/api-gap/index.ts` exports `getApiGap()` — a 4-line async
accessor returning `{ entries: API_GAP_ENTRIES }`. The async-uniform
return shape matches the rest of the service layer; the underlying data
is module-load constant.

The sibling test file ships 30 tests across 2 describe blocks — the
catalog contract (length, literal-false-type, Object.isFrozen,
named-feature coverage via `it.each`) and a per-entry × per-field
banned-tone-word lint that reads `containsBannedToneToken` from the
Wave 0 `src/domain/banned-words.ts` module.

## Deviations from Plan

Two minor text-layer choices documented for the verifier:

1. **`feature: 'ECG (electrocardiogram)'`** rather than the plan's
   `feature: 'ECG'`. Expanded form is more discoverable in the Phase 5
   generated markdown. Coverage test uses
   `feature.toLowerCase().includes('ecg')` so both forms satisfy the
   contract.
2. **`getApiGap()` returns `{ entries: API_GAP_ENTRIES as ApiGapResult['entries'] }`**
   to bridge the readonly catalog → mutable-typed result-shape gap that
   the Plan 04-02 `ApiGapResult.entries: ApiGapEntry[]` type imposes.
   Single cast at the service boundary; runtime reference is preserved
   (the test asserts `result.entries === API_GAP_ENTRIES`).

Neither affects requirements or downstream consumers.

## Threat Flags

None. The plan's `<threat_model>` covered T-04-S2 (injection) +
T-04-S3 (information disclosure) and both are mitigated as specified
(prepared statements + no-text-in-logs). No new surface introduced.

## Commits

| Hash | Subject |
|---|---|
| `387ba1f` | test(04-06): add failing tests for decisions repo extensions |
| `86fa729` | feat(04-06): extend decisions repo with updateOutcome, countSince, findByPrefix, listAll |
| `2190e52` | test(04-06): add failing tests for decision service orchestration |
| `e9efbc9` | feat(04-06): implement decision service (addDecision, reviewDecisions, updateDecision) |
| `978612c` | test(04-06): add failing tests for api-gap service + catalog |
| `3c8af0d` | feat(04-06): implement api-gap catalog + getApiGap() accessor |
| `438312c` | refactor(04-06): biome auto-fix formatting + import order on 04-06 sources |

## Verification

```sh
npx vitest run src/infrastructure/db/repositories/ src/services/decision/ src/services/api-gap/
# → 7 test files, 103 passed

npx vitest run
# → 77 passed, 5 skipped, 779 tests passed, 15 todo, 0 failures

bash scripts/ci-grep-gates.sh
# → All grep gates passed.

npx tsc --noEmit
# → 3 pre-existing errors in src/cli/commands/auth.ts + tests/helpers/msw-whoop-oauth.ts
#   (deferred per deferred-items.md; UNCHANGED by this plan)

npx biome check src/services/api-gap/ src/services/decision/ src/infrastructure/db/repositories/decisions.repo*
# → Checked 9 files in 6ms. No fixes applied.
```

## Self-Check: PASSED

- src/infrastructure/db/repositories/decisions.repo.ts — extended, 7 methods
- src/infrastructure/db/repositories/decisions.repo.test.ts — new, 18 tests
- src/services/decision/index.ts — new, 3 functions
- src/services/decision/index.test.ts — new, 11 tests
- src/services/api-gap/data.ts — new, 6 frozen entries
- src/services/api-gap/index.ts — new, getApiGap accessor
- src/services/api-gap/index.test.ts — new, 30 tests
- All 7 commits land on feat/phase-4-domain-math-mcp-surface
- DEC-01 + DEC-02 + DEC-03 + MCP-01 anchored at service layer
- Zero new migrations (schema audit confirmed: every column already exists)
