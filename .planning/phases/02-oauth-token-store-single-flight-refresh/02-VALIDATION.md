---
phase: 2
slug: oauth-token-store-single-flight-refresh
status: ready
nyquist_compliant: true
wave_0_complete: true
created: 2026-05-12
updated: 2026-05-12 (revision iteration 1 — populated per-task map; flipped frontmatter flags per checker BLOCKER 2)
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

> Populated per checker BLOCKER 2 (revision iteration 1). Each row maps a single task to its requirement, threat reference, secure behavior, test type, automated command, and whether the verification target file already exists at plan-execute time. File-existence indicators: ✅ exists in current tree (Phase 1 baseline) / ❌ W0 created by Wave 0 of this phase / ❌ Wn created by a higher wave of this phase.
>
> Threat references use the IDs from each plan's `<threat_model>` STRIDE register (T-02.NN-MM where NN is the plan number and MM is the row).

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 02-01.T1 | 02-01 | 1 | AUTH-01..05 (Wave-0 deps) | T-02.01-03, T-02.01-04, T-02.01-05, T-02.01-06 | install pinned npm deps + ship MSW helper with single source of truth for WHOOP_TOKEN_URL + ship 3 fixture files | gate | `npm ls proper-lockfile open msw @types/proper-lockfile --depth=0 && test -f test/fixtures/oauth/token-200.json && node -e "JSON.parse(require('node:fs').readFileSync('test/fixtures/oauth/token-200.json','utf8'))"` | ❌ W0 (T1 creates the fixtures + MSW helper) | ⬜ pending |
| 02-01.T2 | 02-01 | 1 | AUTH-01..05 (Wave-0 contracts) | T-02.01-01, T-02.01-02, T-02.01-07 | resolvePaths fails loudly when both HOME and RECOVERY_LEDGER_HOME absent; AuthError discriminated union frozen at 6 kinds (including auth_port_in_use moved into Wave 0 per BLOCKER 1); canonical ConfigSchema + D13_SCOPES extracted (DRY-fix per WARNING PLAN-05-DRY-VIOLATION) | unit | `npm run test -- --run src/infrastructure/config/paths.test.ts src/infrastructure/config/schema.test.ts src/infrastructure/whoop/errors.test.ts` | ❌ W0 (T2 creates paths.ts, schema.ts, errors.ts + tests) | ⬜ pending |
| 02-02.T1 | 02-02 | 2 | AUTH-03, AUTH-04, AUTH-05 (unit half) | T-02.02-01, T-02.02-02, T-02.02-03, T-02.02-04, T-02.02-05, T-02.02-07, T-02.02-08, T-02.02-09 | three-layer single-flight gate (in-process Promise + proper-lockfile + atomic temp-and-rename); 10 parallel → exactly one POST + identical access_token; AuthError({kind: 'refresh_failed'}) on non-2xx with status-only detail; tokens.json mode 0o600; retry budget = 0 on refresh | unit | `npm run test -- --run src/infrastructure/whoop/token-store.test.ts` | ❌ W2 (T1 creates token-store.ts + tests; depends on Wave-0 paths.ts + errors.ts + MSW helper) | ⬜ pending |
| 02-03.T1 | 02-03 | 2 | AUTH-01, AUTH-02 | T-02.03-01, T-02.03-02, T-02.03-03, T-02.03-04, T-02.03-05, T-02.03-06, T-02.03-08, T-02.03-09, T-02.03-12, T-02.03-13 | buildAuthorizeUrl with URLSearchParams (no string concat); loopback bound 127.0.0.1 only; 32-byte CSRF state; D-09 verbatim HTML; failureHtml runs detail through sanitize() before escapeHtml; OAuth error-code policy (RENDER for invalid_scope/invalid_request/unsupported_response_type, STRIP for opaque codes per BLOCKER 4); EADDRINUSE → auth_port_in_use (kind consumed from Wave 0, NOT mutated here per BLOCKER 1) | unit | `npm run test -- --run src/infrastructure/whoop/oauth.test.ts` | ❌ W2 (T1 creates oauth.ts + tests; consumes Wave-0 errors.ts and Wave-2 token-store.ts) | ⬜ pending |
| 02-04.T1 | 02-04 | 3 | AUTH-04, AUTH-05 (orchestrator half) | T-02.04-01, T-02.04-02, T-02.04-03, T-02.04-06 | callWithAuth retry budget = 1; sibling-refreshed re-read before force-refresh; AuthError({kind: 'auth_expired'}) on refresh failure; services barrel exports refreshOrchestrator + Phase 3 sync consumes through createServices() (auth.ts does NOT — corrected per WARNING PLAN-04-CIRCULAR-NOTE) | unit | `npm run test -- --run src/services/refresh-orchestrator.test.ts` | ❌ W3 (T1 creates refresh-orchestrator.ts + tests + extends services barrel; depends on Wave-2 token-store.ts) | ⬜ pending |
| 02-05.T1 | 02-05 | 4 | AUTH-01, AUTH-02, AUTH-03 | T-02.05-01, T-02.05-02, T-02.05-03, T-02.05-04, T-02.05-05, T-02.05-06, T-02.05-07, T-02.05-09, T-02.05-10 | init.ts atomic temp-and-rename config.json mode 0o600; env-var precedence per D-06; verbatim D-02 instructions; auth.ts wires runOAuth → tokenStore.write → "Authorization complete." → exit 0; AUTH_EXIT_CODES covers all 6 AuthErrorKinds; Gate C broadened from doctor.ts to src/cli/commands/**/*.ts; BOTH files import canonical ConfigSchema from src/infrastructure/config/schema.ts (DRY-fix per WARNING PLAN-05-DRY-VIOLATION) | unit + gate | `npm run test -- --run src/cli/commands/init.test.ts src/cli/commands/auth.test.ts && bash scripts/ci-grep-gates.sh` | ❌ W4 (T1 creates init.ts, auth.ts + tests; modifies src/cli/index.ts + scripts/ci-grep-gates.sh) | ⬜ pending |
| 02-06.T1 | 02-06 | 5 | AUTH-03 | T-02.06-01, T-02.06-02, T-02.06-03, T-02.06-03b, T-02.06-04, T-02.06-05 | probeAuth + probeTokenFreshness offline-safe (no getValidAccessToken import); detail strings constant-form, never interpolate token fields; runDoctor emits 5 canonical checks; Gate E (CI grep) enforces ADR-0002 §Enforcement at the string-literal level (URL-concatenation bypass acknowledged as out-of-scope per WARNING PLAN-06-SCOPE-DRIFT option b) | unit + gate | `npm run test -- --run src/services/doctor/ && bash scripts/ci-grep-gates.sh` | ❌ W5 (T1 creates auth.ts, token-freshness.ts probes + tests; extends check-names.ts, runDoctor wiring, index.test.ts MR-36; appends Gate E to ci-grep-gates.sh) | ⬜ pending |
| 02-07.T1 | 02-07 | 1 | AUTH-06 | T-02.07-01, T-02.07-02, T-02.07-03, T-02.07-04, T-02.07-05, T-02.07-06, T-02.07-07 | F7 D-20 verbatim cause-chain fixture redacts both `code=eyJ...` and `client_secret=hunter2`; F6 Bearer/JWT/refresh_token/access_token positional matrix (URL/JSON/form/header); 3 negative cases (length-guard, word-boundary, decoded); NO production-code changes (sanitize.ts + register.ts both untouched — D-18 attestation per WARNING D-COV-17-18) | unit | `npm run test -- --run src/mcp/sanitize.test.ts` | ✅ sanitize.test.ts exists from Phase 1; T1 extends it. sanitize.ts + register.ts are unchanged. | ⬜ pending |
| 02-08.T0 | 02-08 | 6 | (build prereq for AUTH-05 cross-process test) | T-02.08-09 | tsup.config.ts emits dist/infrastructure/whoop/token-store.mjs as an explicit entry; the integration test's child fork can `import` from that path without ERR_MODULE_NOT_FOUND (per checker WARNING PLAN-08-BUILD-DEP) | gate | `npm run build && test -f dist/infrastructure/whoop/token-store.mjs` | ✅ tsup.config.ts exists from Phase 1; T0 extends the `entry` array. dist/ is a build output, not checked in. | ⬜ pending |
| 02-08.T1 | 02-08 | 6 | AUTH-05 (cross-process), AUTH-06 (end-to-end) | T-02.08-01, T-02.08-02, T-02.08-03, T-02.08-04, T-02.08-05, T-02.08-07, T-02.08-09 | 10 forked children with shared HTTP-mock parent → exactly one POST; all children read same fresh access_token; tokens.json.tmp absent + tokens.json mode 0o600; lockfile released; FORBIDDEN regex matches ZERO across stderr + induced-refresh-failure stderr + MCP whoop_doctor tools/call response; CI matrix expanded to macos-latest + ubuntu-latest with RECOVERY_LEDGER_FORCE_FILE_STORE=1 on the Linux row (D-25); D-17 runtime-attested by G-03's tools/list assertion (only whoop_doctor present) | integration + gate | `npm run build && test -f dist/infrastructure/whoop/token-store.mjs && npm run test -- --run tests/integration/auth-concurrency.test.ts` | ❌ W6 (T1 creates auth-concurrency.test.ts + child-get-token.mjs + extends .github/workflows/ci.yml; depends on Task 0 of this plan emitting the dist path AND on all Wave 1-5 outputs being present) | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

All Wave-0 prerequisites are satisfied by Plan 02-01 (Wave 1) and Plan 02-07 (Wave 1, parallel — no file overlap). Plan 02-08 introduces a SECONDARY build-dep Wave-0 prerequisite (Task 0) that runs at the start of the Wave-6 integration test rather than at phase start.

- [x] `src/infrastructure/whoop/oauth.ts` + `oauth.test.ts` — covered by Plan 02-03 (Wave 2; consumes Wave-0 contracts)
- [x] `src/infrastructure/whoop/token-store.ts` + `token-store.test.ts` — covered by Plan 02-02 (Wave 2)
- [x] `src/services/refresh-orchestrator.ts` + `refresh-orchestrator.test.ts` — covered by Plan 02-04 (Wave 3)
- [x] `tests/integration/auth-concurrency.test.ts` — covered by Plan 02-08 (Wave 6)
- [x] `src/mcp/sanitize.test.ts` extensions (F6 + F7 fixtures, 3 negatives) — covered by Plan 02-07 (Wave 1, parallel to 02-01)
- [x] `src/cli/commands/init.test.ts` + `auth.test.ts` — covered by Plan 02-05 (Wave 4)
- [x] `src/services/doctor/checks/auth.test.ts` + `token-freshness.test.ts` — covered by Plan 02-06 (Wave 5)
- [x] `tests/helpers/msw-whoop-oauth.ts` + 3 fixture files (`test/fixtures/oauth/{token-200.json,token-400-invalid-grant.json,authorize-callback-state-mismatch.html}`) — covered by Plan 02-01 Task 1 (Wave 1)
- [x] `src/infrastructure/config/paths.ts` + `paths.test.ts` — covered by Plan 02-01 Task 2 (Wave 1)
- [x] `src/infrastructure/config/schema.ts` + `schema.test.ts` (canonical ConfigSchema + D13_SCOPES; added per WARNING PLAN-05-DRY-VIOLATION) — covered by Plan 02-01 Task 2 (Wave 1)
- [x] `src/infrastructure/whoop/errors.ts` + `errors.test.ts` (all 6 AuthErrorKinds including auth_port_in_use moved to Wave 0 per BLOCKER 1) — covered by Plan 02-01 Task 2 (Wave 1)
- [x] `tsup.config.ts` extended to emit `dist/infrastructure/whoop/token-store.mjs` (per WARNING PLAN-08-BUILD-DEP) — covered by Plan 02-08 Task 0 (Wave 6 prerequisite)

*Each Wave-0 entry is now traceable to a specific plan task in the Per-Task Verification Map above.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Real WHOOP OAuth round-trip on a live browser | AUTH-01 | Requires user consent + live WHOOP credentials; ADR-0006 forbids real WHOOP calls in tests | Run `recovery-ledger init` then `recovery-ledger auth` interactively against the developer-portal client; verify `doctor` reports `auth: keychain` (macOS) or `auth: file` (no-keychain Linux). |
| macOS keychain unlock prompt | AUTH-03 | OS-level UX cannot be CI-asserted | Run `recovery-ledger auth` on macOS with locked keychain; confirm unlock prompt; confirm token written. |
| First post-merge GitHub Actions run on `main` (matrix green) | AUTH-05 cross-process + D-25 Linux fallback | CI matrix can only be exercised after commits land on `main`; Phase 1 STATE.md precedent line 124 | After Plan 02-08 commits land via PR, observe the first post-merge Actions run on `main` and confirm BOTH `macos-latest` and `ubuntu-latest` matrix rows are green. |

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies — confirmed by inspecting each plan's `<verify><automated>` block; every task has at least one automated command, and Wave-0 dependencies are listed in the Per-Task Verification Map above.
- [x] Sampling continuity: no 3 consecutive tasks without automated verify — confirmed; every task across all 8 plans carries an automated verify.
- [x] Wave 0 covers all MISSING references — confirmed; Plan 02-01 (Wave 1) supplies paths.ts, schema.ts, errors.ts, MSW helper, and 3 fixture files. Plan 02-07 (Wave 1, parallel) supplies sanitizer test-fixture extensions. Plan 02-08 Task 0 (Wave 6 prerequisite) supplies the tsup build-entry for the cross-process integration test (per WARNING PLAN-08-BUILD-DEP).
- [x] No watch-mode flags — confirmed; every `<verify><automated>` uses `--run` or a one-shot shell command. No `vitest watch` or `vitest --watch` anywhere.
- [x] Feedback latency < 30s — confirmed for unit tests (typical ~2-5s per test file). The Plan 02-08 integration test budget is < 15s and runs once per wave merge; the per-task quick-run command scopes to the changed file's test.
- [x] `nyquist_compliant: true` set in frontmatter — flipped from `false` per checker BLOCKER 2.

**Approval:** ✅ approved (revision iteration 1, 2026-05-12)
