---
phase: 5
slug: doctor-polish-install-guide-20-minute-setup-validation
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-05-26
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

> Populated by planner during plan creation. Wave-0 placeholders below.

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| _planner will populate_ | – | – | – | – | – | – | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

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

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < ~10s for default suite
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending (planner fills task map; checker validates)
