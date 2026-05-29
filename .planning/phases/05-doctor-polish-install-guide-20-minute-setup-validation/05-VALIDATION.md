---
phase: 5
slug: doctor-polish-install-guide-20-minute-setup-validation
status: complete
nyquist_compliant: true
wave_0_complete: true
created: 2026-05-26
closed: 2026-05-29
---

# Phase 5 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest |
| **Config file** | `vitest.config.ts` (existing) |
| **Quick run command** | `npm run test -- --run <pattern>` |
| **Full suite command** | `npm run test` |
| **Estimated runtime** | ~10s (default suite); ~3–6 min (env-gated stopwatch) |

---

## Sampling Rate

- **After every task commit:** Run scoped quick command (e.g., `npm run test -- --run doctor`)
- **After every plan wave:** Run `npm run test`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** ~10s for default suite; stopwatch run sits behind `VITEST_INCLUDE_STOPWATCH=1` and only runs in its own CI workflow

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | Status |
|---------|------|------|-------------|-----------|-------------------|--------|
| 05-01 | 05-01 | 0 | DOC-01/02 | unit | `npx vitest run src/services/doctor/ src/infrastructure/db/repositories/` | ✅ green |
| 05-02 | 05-02 | 1 | DOC-01 | unit | `npx vitest run src/services/doctor/checks/whoop-roundtrip.test.ts` | ✅ green |
| 05-03 | 05-03 | 1 | DOC-01 | unit | `npx vitest run src/services/doctor/checks/db-{open,integrity,schema-version,wal-size}.test.ts` | ✅ green |
| 05-04 | 05-04 | 1 | DOC-01 | unit | `npx vitest run src/services/doctor/checks/{last-sync-recency,most-recent-scored-day,data-quality-counts}.test.ts` | ✅ green |
| 05-05 | 05-05 | 1 | DOC-01 | unit (fork) | `npx vitest run src/services/doctor/checks/concurrent-writers-stress.test.ts` | ✅ green |
| 05-06 | 05-06 | 2 | DOC-01/02 | unit + smoke | `npx vitest run src/services/doctor/index.test.ts tests/integration/mcp-runtime.test.ts` + `node dist/cli.mjs doctor --offline` (14 checks) | ✅ green |
| 05-07 | 05-07 | 2 | DOC-03 | contract | `npx vitest run scripts/generate-api-gap-md.test.ts tests/contract/api-gap-md-parity.test.ts` | ✅ green |
| 05-08 | 05-08 | 2 | DOC-04/05 | file-existence + lint | `bash scripts/ci-grep-gates.sh` (Gate A) + `plutil -lint templates/com.recovery-ledger.daily-sync.plist` | ✅ green |
| 05-09 | 05-09 | 2 | DOC-02/04 | contract | `npx vitest run tests/contract/troubleshooting-coverage.test.ts` | ✅ green |
| 05-10 | 05-10 | 3 | DOC-06 | integration (env-gated) | `VITEST_INCLUDE_STOPWATCH=1 npx vitest run tests/integration/setup-stopwatch.test.ts` (5s vs 1200s budget) | ✅ green |
| 05-11 | 05-11 | 4 | all DOC | attestation | `npm test` + `bash scripts/ci-grep-gates.sh` + D-29 + D-21 git-diff | ✅ green |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky · Verified 2026-05-29*

---

## Wave 0 Requirements

- [ ] Optional new repo helpers (`repos.recoveries.latestScoredStart()`, `countByScoreState()` etc.) — planner verifies and adds if missing before Wave 1 lands.
- [ ] `tests/integration/setup-stopwatch.test.ts` skeleton stub (planner attaches MSW fixtures + env gate)
- [ ] `.github/workflows/stopwatch.yml` skeleton stub

*Existing infrastructure (vitest + MSW + bootstrap composition root) covers everything else.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| launchd `.plist` template loads on a real macOS Ventura+ machine | DOC-05 | Cannot exercise `launchctl load` in headless CI without elevated entitlements; template is documentation only | After Phase 5 ships, copy `templates/com.recovery-ledger.daily-sync.plist` to `~/Library/LaunchAgents/`, edit placeholders, `launchctl load`, verify `journalctl`-equivalent log appears at configured `StandardOutPath`. |
| Each MCP client (Claude Code, Claude Desktop, Cursor) connects via the install-guide snippets | DOC-02 / DOC-03 | Each client is a separate desktop app outside CI scope | Follow `docs/install/<client>.md` step-by-step from a fresh checkout; confirm `whoop_doctor` tool returns `pass` for all 14 checks. |

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references (05-01 added the repo helpers; no MISSING remaining)
- [x] No watch-mode flags
- [x] Feedback latency < ~10s for default suite (full suite ~10s; stopwatch env-gated out)
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** approved on 2026-05-29; phase closed per 05-11-PLAN.md. Milestone v1.0 complete (50/50 v1 requirements).
