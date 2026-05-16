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

> This table is populated by `gsd-planner` once PLAN.md files exist. Per-anchor coverage is sourced from the `## Validation Architecture` section of `03-RESEARCH.md`. Every Phase 3 requirement (DATA-01..06, SYNC-01..07) must map to at least one row before `nyquist_compliant: true` flips.

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 3-01-01 | 01 | 0 | infra precondition | — | CI gates F + G refuse drift | grep gate | `bash scripts/ci-grep-gates.sh` | ❌ W0 | ⬜ pending |

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
| Mid-migration crash recovery from real disk-level kill | DATA-04 | Process-kill behavior is timing-sensitive; CI integration test simulates via `process.kill(SIGKILL)` mid-`db.exec()` — full real-disk-power-loss is left to manual smoke | Insert a `console.log` after the first `INSERT` in a migration `.sql`; trigger and `kill -9` the process between statements; rerun migrator; confirm backup-cited remediation message and `cp <backup> ~/.recovery-ledger/db.sqlite` restores cleanly |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references (Gates F + G, drizzle.config.ts, fixture scaffold, WhoopApiError)
- [ ] No watch-mode flags
- [ ] Feedback latency < 15s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
