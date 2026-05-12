---
phase: 2
slug: oauth-token-store-single-flight-refresh
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-05-12
---

# Phase 2 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest 3.x |
| **Config file** | vitest.config.ts (Phase 1) |
| **Quick run command** | `npm run test -- --run --reporter=dot` |
| **Full suite command** | `npm run test` |
| **Estimated runtime** | ~30 seconds (target) |

---

## Sampling Rate

- **After every task commit:** Run quick run command (scoped to changed file's test)
- **After every plan wave:** Run full suite command
- **Before `/gsd-verify-work`:** Full suite must be green
- **Max feedback latency:** 30 seconds

---

## Per-Task Verification Map

> Populated by gsd-planner during planning. Each plan's tasks are mapped here with their REQ/threat/test pairings before execution starts.

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| TBD | — | — | AUTH-01..AUTH-06 | — | — | — | — | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `tests/infrastructure/auth/oauth.test.ts` — OAuth Authorization Code flow stubs
- [ ] `tests/infrastructure/auth/token-store.test.ts` — keyring + file fallback stubs
- [ ] `tests/services/refresh-orchestrator.test.ts` — single-flight unit (10 concurrent callers)
- [ ] `tests/integration/single-flight-cross-process.test.ts` — real-HTTP-mock cross-process gate
- [ ] `tests/mcp/sanitize.test.ts` — extend with Bearer/JWT/refresh_token fixtures
- [ ] `tests/cli/doctor.test.ts` — `auth: keychain` vs `auth: file` reporting
- [ ] `tests/helpers/msw-whoop-oauth.ts` — MSW fixtures for WHOOP token endpoint

*Resolved during planning — listed file paths are placeholders the planner refines.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Real WHOOP OAuth round-trip on a live browser | AUTH-01 | Requires user consent + live WHOOP credentials; ADR-0006 forbids real WHOOP calls in tests | Run `recovery-ledger init` then `recovery-ledger auth` interactively against the developer-portal client; verify `doctor` reports `auth: keychain` (macOS) or `auth: file` (no-keychain Linux). |
| macOS keychain unlock prompt | AUTH-03 | OS-level UX cannot be CI-asserted | Run `recovery-ledger auth` on macOS with locked keychain; confirm unlock prompt; confirm token written. |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 30s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
