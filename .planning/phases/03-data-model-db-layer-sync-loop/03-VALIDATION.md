---
phase: 3
slug: data-model-db-layer-sync-loop
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-05-16
---

# Phase 3 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest 4.x (per `.planning/research/STACK.md` + `vitest.config.ts`) |
| **Config file** | `vitest.config.ts` (existing; Phase 2 already extended include glob to `tests/**/*.test.ts`) |
| **Quick run command** | `npm run test -- <pattern>` |
| **Full suite command** | `npm run test` |
| **Estimated runtime** | ~10–15 seconds (Phase 2 baseline: 266 tests in 5.86s; Phase 3 adds ~80–120 unit + ~10 fixture-based contract tests) |

---

## Sampling Rate

- **After every task commit:** Run `npm run test -- <touched path>`
- **After every plan wave:** Run `npm run test` + `bash scripts/ci-grep-gates.sh` + `npm run lint`
- **Before `/gsd:verify-work`:** Full suite + grep gates A–G must be green; `npm run build` emits 3 ESM entries
- **Max feedback latency:** 15 seconds

---

## Per-Task Verification Map

> Mirrored from `03-RESEARCH.md` `## Validation Architecture` § Phase Requirements → Test Map (13 rows for DATA-01..06 + SYNC-01..07) plus 4 attestation/gate rows. Status flips ⬜ → ✅ at phase close (Plan 03-13 Task 2).

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 3-DATA-01 | 03-05 | 2 | DATA-01 | T-03.05-04 | DB opens in WAL mode with all 6 pragmas at the default path | integration | `vitest run tests/integration/sync/pragma-roundtrip.test.ts` | ❌ Wave 2 | ⬜ pending |
| 3-DATA-02 | 03-02 | 1 | DATA-02 | T-03.02-01 | Drizzle schema for 9 tables; hybrid normalized + raw_json | unit (schema introspection) | `vitest run src/infrastructure/db/schema.test.ts` | ❌ Wave 1 | ⬜ pending |
| 3-DATA-03 | 03-02 | 1 | DATA-03 | T-03.02-04 | Index `(score_state, start)` on each scored entity | unit (introspection on schema) | `vitest run src/infrastructure/db/schema.test.ts` (assertion on indexes) | ❌ Wave 1 | ⬜ pending |
| 3-DATA-04 | 03-05 | 2 | DATA-04 | T-03.05-01 | Migrator wraps in BEGIN IMMEDIATE; pre-migration backup; fails-closed | integration | `vitest run tests/integration/sync/migration-crash.test.ts` | ❌ Wave 2 | ⬜ pending |
| 3-DATA-05 | 03-03 + 03-08 | 1 + 3 | DATA-05 | T-03.03-02 / T-03.08-01 | Three-layer types + Score discriminator enforces SCORED-only by default | unit (TS type tests + repo behavior) | `vitest run src/domain/types/score.test.ts src/infrastructure/db/repositories/recovery.repo.test.ts` | ❌ Wave 1 + Wave 3 | ⬜ pending |
| 3-DATA-06 | 03-09 + 03-11 | 3 + 4 | DATA-06 | T-03.09-04 / T-03.11-05 | DST + tz_drift cycles flagged; excluded from baseline default query; visible in raw views | unit + integration | `vitest run src/domain/dst-tz/detect.test.ts tests/integration/sync/dst-fixture.test.ts` | ❌ Wave 3 + Wave 4 | ⬜ pending |
| 3-SYNC-01 | 03-11 + 03-12 | 4 + 5 | SYNC-01 | T-03.11-02 | `recovery-ledger sync --days N` fetches all 6 resources for the requested window | integration (CLI subprocess) | `vitest run tests/integration/sync/idempotency.test.ts` (drives services.runSync) + manual CLI smoke | ❌ Wave 4 + Wave 5 | ⬜ pending |
| 3-SYNC-02 | 03-06 + 03-10 | 2 + 3 | SYNC-02 | T-03.06-04 / T-03.06-06 | Pagination, snake↔camel, semaphore-of-4 | unit (pagination + rate-limit) + contract | `vitest run src/infrastructure/whoop/pagination.test.ts src/infrastructure/whoop/rate-limit.test.ts tests/contract/cycles.test.ts` | ❌ Wave 2 + Wave 3 | ⬜ pending |
| 3-SYNC-03 | 03-06 + 03-11 | 2 + 4 | SYNC-03 | T-03.06-05 | 429 backoff honors X-RateLimit-Reset (NOT fixed); CLI surfaces rate-limit state | unit (retry) + integration | `vitest run src/infrastructure/whoop/retry.test.ts tests/integration/sync/partial-failure.test.ts` | ❌ Wave 2 + Wave 4 | ⬜ pending |
| 3-SYNC-04 | 03-04 + 03-08 + 03-11 | 1 + 3 + 4 | SYNC-04 | T-03.04-01 / T-03.11-03 | Idempotency via ON CONFLICT; updated_at delta + 7-day re-window | integration | `vitest run tests/integration/sync/idempotency.test.ts` | ❌ Wave 4 | ⬜ pending |
| 3-SYNC-05 | 03-08 + 03-11 | 3 + 4 | SYNC-05 | T-03.11-03 | Partial-failure reporting; per-resource counts in sync_runs; status='partial' | integration | `vitest run tests/integration/sync/partial-failure.test.ts` | ❌ Wave 4 | ⬜ pending |
| 3-SYNC-06 | 03-05 + 03-11 | 2 + 4 | SYNC-06 | T-03.11-04 / T-03.05-04 | wal_checkpoint(TRUNCATE) after successful run | integration | `vitest run tests/integration/sync/pragma-roundtrip.test.ts` (asserts WAL size drops to 0 after sync) | ❌ Wave 2 + Wave 4 | ⬜ pending |
| 3-SYNC-07 | 03-07 + 03-10 | 2 + 3 | SYNC-07 | T-03.07-01 | Fixture-based contract tests per resource; no live API; suite < 60s | contract (one per resource) | `vitest run tests/contract/` (all 6 contract files) | ❌ Wave 3 | ⬜ pending |
| 3-D-33 | 03-13 | 6 | D-33 attestation | T-03.13-01 | tools/list returns EXACTLY one tool (whoop_doctor) | integration (carried forward from Plan 02-08 G-03) | `vitest run tests/integration/auth-concurrency.test.ts` (G-03 sub-test) | ✅ exists; carries forward | ⬜ pending |
| 3-D-34 | 03-13 | 6 | D-34 attestation | T-03.13-04 | sanitize.ts + register.ts UNMODIFIED in Phase 3 | manual + git-diff check at phase-close | `git diff origin/main -- src/mcp/sanitize.ts src/mcp/register.ts` returns empty | ✅ enforced by review + Wave 6 | ⬜ pending |
| 3-GATE-F | 03-01 | 0 | Gate F | T-03.06-02 | No `fetch(` outside whoop/client.ts + token-store.ts + oauth.ts | CI grep gate | `bash scripts/ci-grep-gates.sh` (Gate F) | ❌ Wave 0 | ⬜ pending |
| 3-GATE-G | 03-01 | 0 | Gate G | T-03.07-04 | No `drizzle-orm/*` import outside `src/infrastructure/db/` | CI grep gate | `bash scripts/ci-grep-gates.sh` (Gate G) | ❌ Wave 0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `scripts/ci-grep-gates.sh` — extend with **Gate F** (no `fetch(` outside `src/infrastructure/whoop/client.ts` + `token-store.ts` + `oauth.ts`, exclude `*.test.ts`)
- [ ] `scripts/ci-grep-gates.sh` — extend with **Gate G** (no `drizzle-orm/*` import outside `src/infrastructure/db/`, exclude `*.test.ts`)
- [ ] `drizzle.config.ts` — repo-root config so `drizzle-kit generate` emits SQL + `_journal.json` into `src/infrastructure/db/migrations/`
- [ ] `tests/fixtures/whoop/<resource>/` — fixture directory scaffold per ADR-0006 (one helper per WHOOP resource extending the Phase 2 `tests/helpers/msw-whoop-oauth.ts` convention)
- [ ] `src/infrastructure/whoop/errors.ts` — add `WhoopApiError` discriminated union (6 kinds: unauthorized, rate_limited, network, validation, server, unknown) as sibling of FROZEN `AuthError`

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Real WHOOP OAuth round-trip + first live sync against api.prod.whoop.com | SYNC-* | Deferred to Phase 5 setup validation per scope; ADR-0006 forbids real WHOOP calls in tests | Run `recovery-ledger auth` then `recovery-ledger sync --days 7` against a real BYO OAuth token; verify `sync_runs.status = 'ok'` and row counts match WHOOP web app |
| Mid-migration crash recovery from real disk-level kill | DATA-04 | Process-kill behavior is timing-sensitive; CI integration test simulates via `process.kill(SIGKILL)` mid-`db.exec()` — full real-disk-power-loss is left to manual smoke | Insert a marker write after the first `INSERT` in a migration `.sql`; trigger and `kill -9` the process between statements; rerun migrator; confirm backup-cited remediation message and `cp <backup> ~/.recovery-ledger/db.sqlite` restores cleanly |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references (Gates F + G, drizzle.config.ts, fixture scaffold, WhoopApiError)
- [ ] No watch-mode flags
- [ ] Feedback latency < 15s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
