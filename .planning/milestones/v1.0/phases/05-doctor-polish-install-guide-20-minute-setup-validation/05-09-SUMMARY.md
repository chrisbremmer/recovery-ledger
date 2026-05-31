---
phase: 05-doctor-polish-install-guide-20-minute-setup-validation
plan: 09
subsystem: docs-install
tags: [docs, install, troubleshooting, contract-test, doc-02, doc-04]
requires:
  - 05-01  # CHECK_NAMES registry extended to 14 (Wave 0)
  - 05-08  # INSTALL.md + docs/install/* link forward to troubleshooting.md
provides:
  - docs/install/troubleshooting.md  # 14 H2 sections keyed by check.name
  - tests/contract/troubleshooting-coverage.test.ts  # 1:1 coverage contract
affects: []
tech-stack:
  added: []
  patterns:
    - "D-01: troubleshooting keyed by check NAME (not exit code) — fine-grained map per check.name, exit-code floor stays 0/1/2"
    - "D-08 per-section template: Symptom + Likely cause + Fix + See also, H2 anchor is the literal check.name string"
    - "D-09 load-bearing contract test: zero-dep /^## (\\S+)$/gm regex diff against Object.values(CHECK_NAMES) — coverage + order + no-extras"
key-files:
  created:
    - docs/install/troubleshooting.md
    - tests/contract/troubleshooting-coverage.test.ts
  modified: []
decisions:
  - "Followed CHECK_NAMES *declaration* order for the 14 H2 sections (auth/token_freshness/whoop_roundtrip before db_*), matching the contract test's `filtered.toEqual(Object.values(CHECK_NAMES))` assertion and the plan must_haves — NOT the runDoctor PROBE_NAMES emission order, which interleaves db_* between mcp_stdout_purity and auth."
  - "Symptom strings copied verbatim from each probe's actual `detail` output (read from src/services/doctor/checks/*.ts) so the searchable text matches what users see on their terminal."
metrics:
  duration: ~20m
  completed: 2026-05-29
---

# Phase 5 Plan 09: Troubleshooting Map Summary

Shipped the DOC-02 / DOC-04 troubleshooting map (`docs/install/troubleshooting.md`, 14 H2 sections keyed 1:1 off each doctor `check.name`) plus the load-bearing contract test that pins the doc to the `CHECK_NAMES` registry forever — coverage, declaration order, and no-extras — all passing the ADR-0005 tone gate with zero new tsc errors.

## What shipped

| File | Purpose |
|------|---------|
| `docs/install/troubleshooting.md` | 14 `## <check_name>` H2 sections, one per `CHECK_NAMES` value, in declaration order. Each follows the D-08 template (Symptom + Likely cause + Fix + See also). |
| `tests/contract/troubleshooting-coverage.test.ts` | 3-test contract: every `CHECK_NAMES` value has a matching H2; H2s appear in `Object.values(CHECK_NAMES)` order; no extra check-like H2s. Zero-dep `/^## (\S+)$/gm` regex — no markdown parser. |

## The 14 sections (in order)

`better_sqlite3_load`, `napi_keyring_load`, `mcp_stdout_purity`, `auth`, `token_freshness`, `whoop_roundtrip`, `db_open`, `db_integrity`, `db_schema_version`, `db_wal_size`, `last_sync_recency`, `most_recent_scored_day`, `data_quality_counts`, `concurrent_writers_stress`.

This is **CHECK_NAMES declaration order** (`src/services/doctor/checks/check-names.ts`), which is what the contract test asserts (`filtered.toEqual(Object.values(CHECK_NAMES))`) and what the plan must_haves require. It differs from `runDoctor`'s `PROBE_NAMES` emission order (which interleaves `db_open..db_wal_size` between `mcp_stdout_purity` and `auth`); the contract test is the load-bearing arbiter, so the doc tracks declaration order.

## Symptom strings cross-checked against probe source

Every Symptom line mirrors the real `detail` string the probe emits — read directly from source, not invented:

- `better_sqlite3_load` / `napi_keyring_load` — `native-modules.ts` (`failed to load: ... — try \`npm rebuild better-sqlite3\``).
- `mcp_stdout_purity` — `mcp-stdout-purity.ts` (`non-JSON-RPC byte on stdout`, `subprocess emitted no stdout frames before drain elapsed`).
- `auth` — `auth.ts` (`no tokens — run \`recovery-ledger auth\``, `mode=... but tokens missing`).
- `token_freshness` — `token-freshness.ts` (`expires in 4m`, `expired ... ago — run \`recovery-ledger auth\``).
- `whoop_roundtrip` — `whoop-roundtrip.ts` (`WHOOP returned 401 after refresh — run \`recovery-ledger auth\``, `WHOOP returned 403 — scopes may have drifted`).
- `db_open` / `db_integrity` — `db-open.ts`, `db-integrity.ts` (`no DB handle injected`, `pragma probe threw`, `PRAGMA integrity_check returned N row(s)`).
- `db_schema_version` — `db-schema-version.ts` (`schema at migration N/M — restore from <backup>: cp <backup> <dbFile>`, `extra rows in __drizzle_migrations`).
- `db_wal_size` — `db-wal-size.ts` (`WAL <N>MB (>32MB; checkpoint is lagging)`, `exceeds journal_size_limit=64MB`).
- `last_sync_recency` / `most_recent_scored_day` — `last-sync-recency.ts`, `most-recent-scored-day.ts` (`last sync 3d ago`, `most recent SCORED day <date>`).
- `data_quality_counts` — `data-quality-counts.ts` (`cycles: N scored, N pending, N unscorable, N excluded`).
- `concurrent_writers_stress` — `concurrent-writers-stress.ts` (`skipped — run with --stress to enable`, `<W> of 4 workers failed`).

## Verification gates

| Gate | Result |
|------|--------|
| `npx tsc --noEmit` | **6 known baseline errors, zero new** — `diff` against pre-change baseline is identical (auth.ts ×1, sync-runs.repo.ts ×3, msw-whoop-oauth.ts ×2; all in deferred-items.md). |
| `npx vitest run tests/contract/troubleshooting-coverage.test.ts` | **PASS** — 3/3 tests green (coverage + order + no-extras). |
| `bash scripts/ci-grep-gates.sh` | **PASS** — "All grep gates passed." exit 0 (Gate A tone words + emoji clean on troubleshooting.md). |
| `grep -c "^## " docs/install/troubleshooting.md` | **14** — exactly one H2 per CHECK_NAMES value. |
| `npm test` (full suite) | **PASS** — 114 files / 1203 tests green; no regressions. |

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Hardened the H2-extraction map against `noUncheckedIndexedAccess`**
- **Found during:** Task 2 (first `npx tsc --noEmit` after writing the test).
- **Issue:** The plan's draft `[...md.matchAll(/^## (\S+)$/gm)].map((m) => m[1])` types `h2s` as `(string | undefined)[]` under the project's `noUncheckedIndexedAccess`, producing 3 NEW tsc errors where `h` flowed into `.includes(h)` / `.test(h)`. That would violate the zero-new-errors gate.
- **Fix:** Appended `.filter((h): h is string => h !== undefined)` to narrow `h2s` to `string[]` (the capture group is always present on a match, so runtime values are unchanged). Documented with a comment.
- **Files modified:** `tests/contract/troubleshooting-coverage.test.ts`.

**2. [Rule 1 - Bug] Added `0-9` to the no-extras regex character classes**
- **Found during:** Task 2 authoring.
- **Issue:** The plan's draft no-extras filter used `/^[a-z_]+$/`. The valid check name `better_sqlite3_load` contains a `3`, so under the literal draft regex that name would NOT be classified as "check-like" and would be silently exempt from the no-extras assertion — weakening the guard the test exists to provide.
- **Fix:** Used `/^[a-z0-9_]+$/` so all 14 real check names (including digit-bearing ones) are correctly covered by the no-extras check.
- **Files modified:** `tests/contract/troubleshooting-coverage.test.ts`.

## Known Stubs

None. The doc is complete content; the contract test passes against the committed doc.

## Threat Flags

None. No new security-relevant surface — this plan adds documentation + a test. The `cp <backup> <dbFile>` remediation paths are local to the user's machine (T-05-I9, accepted in the plan's threat register).

## TDD Gate Compliance

Task 2 carried `tdd="true"`, but the artifact under test (`troubleshooting.md`) is created by Task 1 in the same plan, so the test was authored to pass against the already-complete doc rather than RED-first against absent content. The doc-and-test pairing IS the contract; both land in one atomic commit. The test is verified to fail loudly if a `CHECK_NAMES` value lacks an H2 (the must_haves "future-check" requirement) — its three assertions enforce coverage, order, and no-extras.

## Handoff

- Committed as a single atomic commit on `feat/phase-5` (2 files + this SUMMARY). Not pushed.
- The DOC-04 install tree's forward link `docs/install/troubleshooting.md` (left dangling by Plan 05-08) now resolves.
- DOC-02's "structured exit codes that map to documented troubleshooting steps" promise is verified end-to-end: doctor `check.name` → `## <name>` H2 lookup, contract-tested for 1:1 alignment.

## Self-Check: PASSED

- `docs/install/troubleshooting.md` — verified present on disk, 14 H2 sections in CHECK_NAMES order.
- `tests/contract/troubleshooting-coverage.test.ts` — verified present, 3/3 tests green.
- tsc baseline unchanged at 6 errors (zero new); Gate A green; full suite green.
- Commit: `4aa341b` on `feat/phase-5` (verified present via `git log`; not pushed).
