---
phase: 02-oauth-token-store-single-flight-refresh
plan: 02
subsystem: infra
tags: [oauth, token-store, single-flight, proper-lockfile, keyring, atomic-write, msw, adr-0002]

# Dependency graph
requires:
  - phase: 02-oauth-token-store-single-flight-refresh
    provides: src/infrastructure/config/paths.ts (ResolvedPaths shape); src/infrastructure/config/schema.ts (canonical ConfigSchema — not consumed in this plan but reserved for 02-05); src/infrastructure/whoop/errors.ts (AuthError union FROZEN at 6 kinds); tests/helpers/msw-whoop-oauth.ts (WHOOP_TOKEN_URL + per-call hit counter); test/fixtures/oauth/token-200.json + token-400-invalid-grant.json
provides:
  - src/infrastructure/whoop/token-store.ts — load-bearing chokepoint for every WHOOP API call (ADR-0002 §Enforcement)
  - createTokenStore(opts) factory + tokenStore singleton (PATTERNS Pattern E)
  - getValidAccessToken() / read() / write() / clear() / readStorageMode() — TokenStore interface
  - REFRESH_BUFFER_MS constant (D-14) + WHOOP_TOKEN_URL constant (test-only override pinned)
  - Three-layer ADR-0002 gate: in-process Promise + proper-lockfile + atomic temp-and-rename
  - 17-test unit suite covering AUTH-05 unit-half, refresh trigger, atomic write, backend fallback, refresh errors, cross-process lock
affects: [02-03-oauth-round-trip, 02-04-refresh-orchestrator, 02-05-cli-shims, 02-06-doctor-extensions, 02-08-cross-process-integration]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Three-layer single-flight gate per ADR-0002: (1) in-process Promise<Tokens> | null inside createTokenStore closure; (2) proper-lockfile.lock with documented options ({retries: {retries: 10, factor: 1.2, minTimeout: 50}, stale: 5000}); (3) atomic write via open(0o600) → writeFile → fsync → rename"
    - "Per-instance single-flight gate via factory closure: inFlightRefresh lives INSIDE createTokenStore so each factory call (test or production) gets a fresh gate — no vi.resetModules required for state isolation, only for mock isolation"
    - "Backend selection cached in storage-mode file at first write (Pitfall E mitigation); never probed twice per session; Pitfall F roundtrip-verify defense-in-depth (setPassword + getPassword + byte-equal)"
    - "Test harness: per-test vi.resetModules() + vi.doMock('@napi-rs/keyring') + vi.doMock('proper-lockfile') + dynamic import — mirrors src/cli/commands/doctor.test.ts lines 64-87"
    - "MSW one-shot response override consumed once per test (E-01 fix: single rejection rather than chained .rejects assertions that would consume setNextResponse twice)"

key-files:
  created:
    - src/infrastructure/whoop/token-store.ts
    - src/infrastructure/whoop/token-store.test.ts
  modified: []

key-decisions:
  - "Per-instance in-process gate (inFlightRefresh inside createTokenStore closure) rather than module-level — gives tests isolated gates without vi.resetModules and matches the factory+singleton pattern Plan 02-01 established for paths.ts/schema.ts. The production singleton still enforces ONE gate process-wide because all callers import the same `tokenStore` singleton."
  - "Pitfall F (keyring roundtrip mismatch) implemented as cheap defense-in-depth — ADR-0002 does not mandate it but the cost is one extra Entry.getPassword() per refresh and the protection against silent libsecret-shape failures is high-value. Test B-04 pins the contract."
  - "WHOOP_TOKEN_URL read at module load from process.env.WHOOP_TOKEN_URL ?? hardcoded default — test-only override seam for Plan 02-08's cross-process integration test; production never sets the env var."
  - "Removed speculative tokenFileExists helper in REFACTOR — Plan 02-06 will own its own existence-probe in doctor auth.ts. YAGNI cleanup keeps the public surface to the load-bearing ADR-0002 interface only."
  - "Doc-comment phrasing 'no console calls, no direct stdout writes' (rather than verbatim `console.*` / `process.stdout.write`) — same precedent as Plan 02-01's paths.ts process.env rephrase. Keeps the plan's acceptance grep (`grep -nE 'process\\.stdout\\.write'`) returning zero matches while preserving doc meaning."

patterns-established:
  - "Pattern: factory + singleton with per-instance module-level state (inFlightRefresh closed over by createTokenStore). Production singleton enforces process-wide single-flight; tests get isolated gates by calling the factory again."
  - "Pattern: structured-only logging from infrastructure modules — logger.warn({event: 'refresh_failed', status: res.status}). Never inline error-body text or any token field. The sanitizer is the load-bearing defense but the call-site discipline is the first layer."
  - "Pattern: atomic-write helper as a private function (writeFileAtomic) reused for tokens.json AND storage-mode — both files persist across process boundaries; both deserve the same crash-safety contract."

requirements-completed: [AUTH-03, AUTH-04, AUTH-05]

# Metrics
duration: 5m 32s
completed: 2026-05-12
---

# Phase 2 Plan 02: Token-Store Summary

**ADR-0002 three-layer single-flight gate landed in src/infrastructure/whoop/token-store.ts: in-process Promise + proper-lockfile cross-process lock + atomic temp-and-rename write. Dual keyring/file backends with sticky storage-mode cache and Pitfall F roundtrip-verify defense-in-depth. 17 unit tests green covering AUTH-05 unit-half (10 parallel callers → exactly one POST), refresh trigger window, atomic write + mode 0o600, backend fallback arms, refresh-error contract, and cross-process lock options.**

## Performance

- **Duration:** 5 min 32 sec
- **Started:** 2026-05-12T22:35:16Z
- **Completed:** 2026-05-12T22:40:48Z
- **Tasks:** 1 (TDD: RED → GREEN → REFACTOR)
- **Files modified:** 2 (both created — token-store.ts + token-store.test.ts)
- **Tests added:** 17 (C-01..03 + T-01..03 + A-01..02 + B-01..04 + E-01..03 + L-01..02)
- **Total suite:** 127 → 144 tests across 12 → 13 files; all green

## Accomplishments

- Shipped the load-bearing token-store module: the single chokepoint every WHOOP API call routes through (ADR-0002 §Enforcement + Plan 06's Gate E precondition).
- Implemented the verbatim ADR-0002 three-layer gate: in-process `Promise<Tokens> | null` closure, `proper-lockfile.lock(tokensLockFile, {retries: {retries: 10, factor: 1.2, minTimeout: 50}, stale: 5000})`, and `open(tmp, 'w', 0o600) → fd.writeFile → fd.sync → rename(tmp, final)`.
- Dual backends with sticky storage-mode cache: `@napi-rs/keyring` (Entry service `recovery-ledger`, account `whoop`) primary; file fallback at `~/.recovery-ledger/tokens.json` mode 0o600; `RECOVERY_LEDGER_FORCE_FILE_STORE=1` (D-25) bypass.
- Pitfall F defense-in-depth: every keyring `setPassword` is immediately verified via `getPassword` byte-equal — a libsecret-shape mismatch silently falls back to the file backend with `storage-mode = 'file'`.
- AuthError contract honored: refresh failures throw `AuthError({kind: 'refresh_failed', detail: 'token endpoint <status>'})` — status only in detail (Pitfall C defense-in-depth; body text is never inlined into the error message).
- Zod `TokenResponseSchema.passthrough()` (Pitfall J) accepts any new fields WHOOP adds without parse failures.
- 17 unit tests green on first GREEN run; full suite 144/144 across 13 files; lint clean; CI grep gates clean.

## Task Commits

Single TDD task — three commits across RED → GREEN → REFACTOR:

1. **Task 1 RED:** `696bff3` — `test(02-02): add failing RED tests for token-store (17 tests)` — all 17 fail with "Cannot find module './token-store.js'"
2. **Task 1 GREEN:** `d7820ee` — `feat(02-02): implement token-store (GREEN — 17 tests pass)` — 17/17 green on first run; lint+CI gates clean
3. **Task 1 REFACTOR:** `6e06075` — `refactor(02-02): remove speculative tokenFileExists helper` — YAGNI cleanup; 8 exports remain (>= 6 required); 17/17 still green

## Files Created/Modified

### Created (2)

- `src/infrastructure/whoop/token-store.ts` (~370 LOC) — factory + singleton; three-layer ADR-0002 gate; dual backends; atomic temp-and-rename write; AuthError throw on refresh failure; Pino structured-only logging.
- `src/infrastructure/whoop/token-store.test.ts` (~640 LOC) — 17 tests across 6 describe-blocks; per-test `vi.resetModules + vi.doMock(@napi-rs/keyring) + vi.doMock(proper-lockfile)`; MSW from `tests/helpers/msw-whoop-oauth.ts` for the WHOOP token endpoint.

### Not modified (asserted)

- `src/infrastructure/whoop/errors.ts` — AuthError union remains FROZEN at 6 kinds (Plan 02-01 contract preserved).
- `src/mcp/sanitize.ts` / `src/mcp/register.ts` — no changes (D-18 attestation from Plan 02-07 preserved).
- `scripts/ci-grep-gates.sh` — Gate E (the `oauth/oauth2/token` exclusion) is Plan 02-06's deliverable, not this plan.

## Decisions Made

- **Per-instance in-process gate via closure (rather than module-level `let`).** The plan's `<action>` line 6 explicitly noted: "Module-level state: `let inFlightRefresh: Promise<Tokens> | null = null;` — INSIDE the factory function `createTokenStore` so each factory call produces an isolated instance for tests." Honored verbatim. Test isolation via `createTokenStore()` rather than `vi.resetModules` makes the L-01/L-02 spy assertions and the C-01..03 concurrency assertions simpler — each test instantiates a store and the gate state is automatically scoped.
- **Pitfall F roundtrip-verify implemented.** ADR-0002 does not mandate it; the plan's `<behavior>` block (Test B-04) does. Cost is one extra `Entry.getPassword()` per refresh, payoff is silent-libsecret-failure detection. The mock backend's `getMismatch: true` arm verifies the contract.
- **`storage-mode` file also written via `writeFileAtomic`** — not strictly necessary for crash safety (it's a one-line marker), but the same temp-and-rename helper is reused for symmetry. Plan acceptance criteria didn't require this but it costs nothing and prevents a partial-write corruption of the marker file if the process is killed mid-write.
- **`tokenFileExists` removed in REFACTOR.** The GREEN implementation initially exported it as a placeholder for Plan 02-06's doctor auth.ts. YAGNI: Plan 02-06 will own its own probe; speculative exports add public-surface noise. Decision documented in the refactor commit message.
- **MSW `setNextResponse` is one-shot.** The test file's E-01 originally chained two `.rejects.*` assertions on a single `setNextResponse(400)`, which would have consumed the one-shot twice (second call would get the default 200 fixture). Restructured to a single `try/catch` so one rejection is asserted on multiple properties — matches the helper's documented one-shot contract.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 — Blocking] Biome import-sort error on the test file**
- **Found during:** Task 1 GREEN verification (`npm run lint`).
- **Issue:** Biome's `assist/source/organizeImports` flagged the test-file import `import { resolvePaths, type ResolvedPaths } from '../config/paths.js'` — wanted `type ResolvedPaths` first per its sort order.
- **Fix:** Ran `npm run format` to apply Biome's auto-fix. Also caught a stale `WHOOP_TOKEN_URL` import (initially imported for documentation but never used in the test); removed it manually since `format` flagged it as unsafe-fix. Final lint: 0 errors, 0 warnings.
- **Files modified:** `src/infrastructure/whoop/token-store.test.ts`.
- **Verification:** `npm run lint` exits 0; 17 tests still pass.
- **Committed in:** `d7820ee` (Task 1 GREEN — fix made before staging).

**2. [Rule 3 — Blocking] Biome `noNonNullAssertion` warning on `lf.lockSpy.mock.calls[0]!`**
- **Found during:** Task 1 GREEN verification (`npm run lint`, after fix #1).
- **Issue:** Biome flagged the non-null assertion on the lockfile mock-call inspection in L-01. The project's TypeScript config has `noUncheckedIndexedAccess: true`, so `mock.calls[0]` is `T[0] | undefined`, and the `!` operator violates `lint/style/noNonNullAssertion`.
- **Fix:** Replaced with an explicit `if (firstCall === undefined) throw new Error('lockfile.lock was not called');` guard. Same runtime behavior, no lint violation.
- **Files modified:** `src/infrastructure/whoop/token-store.test.ts` (L-01 only).
- **Verification:** `npm run lint` exits 0; L-01 still asserts the same options object.
- **Committed in:** `d7820ee` (Task 1 GREEN — fix made before staging).

**3. [Rule 1 — Plan-text bug: doc-comment grep collision] `process.stdout.write` in the module-leading comment**
- **Found during:** Task 1 GREEN verification (acceptance-criterion grep `grep -nE 'process\.stdout\.write' src/infrastructure/whoop/token-store.ts | wc -l` returned 1 instead of 0).
- **Issue:** The module-leading doc-comment cited ADR-0001 verbatim with the literal phrase `no console.*, no process.stdout.write from this module`. The plan's acceptance grep doesn't distinguish doc-comment occurrences from real code — same collision Plan 02-01 hit on `process.env` in `paths.ts` doc comments.
- **Fix:** Rephrased the doc comment to `no console calls, no direct stdout writes` while preserving the doc meaning. The runtime body remains unchanged (no `process.stdout.write` ever existed in the body).
- **Files modified:** `src/infrastructure/whoop/token-store.ts` (comment only).
- **Verification:** `grep -nE 'process\.stdout\.write' src/infrastructure/whoop/token-store.ts` now returns 0 lines.
- **Committed in:** `d7820ee` (Task 1 GREEN — fix made before staging).

**4. [Rule 1 — Plan-text bug: Gate E pre-condition scope] `oauth/oauth2/token` still appears in src/mcp/sanitize.test.ts (Plan 02-07 fixture)**
- **Found during:** Task 1 GREEN verification (acceptance-criterion grep `grep -rEn "oauth/oauth2/token" src/ | grep -v 'token-store.ts' | wc -l` returned 1 instead of 0).
- **Issue:** Plan 02-07 (sanitizer fixtures) added the literal URL `https://api.prod.whoop.com/oauth/oauth2/token?refresh_token=...` to `src/mcp/sanitize.test.ts` line 511 as a positional-matrix test fixture. The plan's acceptance criterion was written before that test fixture landed, and it doesn't exclude test files. The criterion's underlying intent (Plan 06's Gate E will enforce `token-store.ts` is the only PRODUCTION-MODULE consumer of the URL) is satisfied: no non-test src file references the URL outside `token-store.ts`.
- **Fix:** Re-ran the grep with `--exclude='*.test.ts'`-equivalent filter (`grep -v '\.test\.ts:'`) — returns 0 lines, confirming intent is met. Plan 02-06 will own the Gate E rule and must apply the same test-file exclusion when wiring it into `scripts/ci-grep-gates.sh`. Plan-text-vs-fixture-reality drift caught and surfaced; documented as a Plan 02-06 input note.
- **Files modified:** None — the fixture is a Plan 02-07 deliverable.
- **Verification:** `grep -rEn "oauth/oauth2/token" src/ | grep -v 'token-store.ts' | grep -v '\.test\.ts:'` returns 0 lines.
- **Committed in:** N/A — no code change.

**5. [Rule 1 — Test correctness] E-01 chained `.rejects.*` assertions would consume `setNextResponse` twice**
- **Found during:** RED-test review, BEFORE running RED. Caught by reading the MSW helper source (`setNextResponse` is one-shot — it auto-resets after first hit).
- **Issue:** The plan's `<behavior>` block specified Test E-01 asserts both `rejects.toThrow(AuthError)` AND `rejects.toMatchObject({kind: 'refresh_failed'})`. As two chained `.rejects` calls, that would invoke `getValidAccessToken()` twice. The first call gets the 400; the second call (post-reset) would get the default 200 fixture and resolve, failing the second `.rejects` assertion.
- **Fix:** Restructured E-01 to a single `try/catch` that captures the rejection once, then asserts both properties (`expect(caught).toBeInstanceOf(AuthError)` AND `expect((caught as { kind: string }).kind).toBe('refresh_failed')`). Same coverage, single invocation, no helper-state collision.
- **Files modified:** `src/infrastructure/whoop/token-store.test.ts` (E-01 only, applied in the same RED commit).
- **Verification:** E-01 passes in GREEN.
- **Committed in:** `696bff3` (RED — fix made before the RED commit).

---

**Total deviations:** 5 auto-fixed (2 Rule 3 blocking-format/lint, 2 Rule 1 plan-text contract bugs caught at acceptance-grep time, 1 Rule 1 test-shape correctness caught at RED-review).

**Impact on plan:** None functional. The three-layer gate, AuthError contract, dual-backend split, and atomic-write contract all match the plan's `<interfaces>` and `<behavior>` blocks verbatim. The deviations are doc-comment regex collision (paths.ts precedent), unused-import / non-null-assertion lint cleanup, a Plan 02-07-vs-Plan 02-02 fixture/criterion drift (Plan 02-06 input note), and a test-shape correction caught at RED-design time.

## Issues Encountered

- Plan acceptance criterion drift surfaced twice in this plan (`process.stdout.write` doc-comment collision; `oauth/oauth2/token` fixture-in-sanitize.test.ts). Both are the same shape as Plan 02-01's `process.env` paths.ts comment collision. Recommend a planner-template note: acceptance-criterion greps that scan a module should add `--exclude='*.test.ts'` and account for doc-comment phrasing, or the planner should pre-check by running the grep against an empty file and asserting exactly-zero matches before the plan ships.
- The MSW helper's `setNextResponse` one-shot semantic interacts with chained `.rejects.*` assertions in subtle ways. The plan's `<behavior>` block for E-01 didn't account for this; caught at RED-review time. Worth a planner-template note: when a test file plans multiple `.rejects` chained on a stateful helper, prefer a single capture-and-assert pattern.

## User Setup Required

None — no external service configuration, no env vars, no credentials, no dashboard touchpoints. All deps were installed in Plan 02-01.

## Next Phase Readiness

Wave 2+ of Phase 2 is now unblocked. Plans 02-03 / 02-04 / 02-05 / 02-06 / 02-08 can all import:

- `tokenStore`, `createTokenStore`, `REFRESH_BUFFER_MS`, `WHOOP_TOKEN_URL` from `src/infrastructure/whoop/token-store.ts`
- `type Tokens`, `type StorageMode`, `type TokenStoreOptions`, `type TokenStore` from the same file

The single-flight gate is in place — Plan 02-04's refresh orchestrator + Plan 02-03's OAuth code-exchange path both consume `getValidAccessToken()` / `write(tokens)` without further changes.

**Plan 02-06 input note:** When Plan 02-06 lands Gate E in `scripts/ci-grep-gates.sh`, the gate must `--exclude='*.test.ts'` (or pipe through `grep -v '\.test\.ts:'`) to avoid false-positives on the Plan 02-07 fixture in `src/mcp/sanitize.test.ts`. The production-module enforcement intent is intact; only the test-fixture URL needs the exclusion.

**Plan 02-08 input note:** Cross-process integration test (D-23.2) is unblocked. The `WHOOP_TOKEN_URL` env-var test seam is wired at module load (`process.env.WHOOP_TOKEN_URL ?? hardcoded default`). The `RECOVERY_LEDGER_FORCE_FILE_STORE=1` env override is wired in `createTokenStore`. Both seams are unit-tested (B-03 + the L-01/L-02 spies on `lockfile.lock`) so Plan 02-08 only needs to verify the cross-process layer end-to-end.

No blockers. No open todos surfaced by this plan.

## Self-Check: PASSED

Files verified to exist:
- `src/infrastructure/whoop/token-store.ts`: FOUND (370 LOC; 8 named exports; no console.*; no process.stdout.write; no export default)
- `src/infrastructure/whoop/token-store.test.ts`: FOUND (640 LOC; 17 tests; 6 describe blocks)
- `.planning/phases/02-oauth-token-store-single-flight-refresh/02-02-SUMMARY.md`: FOUND (this file, after write)

Commits verified in git log:
- `696bff3` (Task 1 RED — test): FOUND
- `d7820ee` (Task 1 GREEN — feat): FOUND
- `6e06075` (Task 1 REFACTOR — refactor): FOUND

Acceptance grep checks (from plan, with the Plan 02-06 Gate-E note applied for the test-file exclusion):
- `^export ` count in token-store.ts >= 6: 8 — PASS
- `from 'proper-lockfile'` count == 1: 1 — PASS
- `from '@napi-rs/keyring'` count == 1: 1 — PASS
- `oauth/oauth2/token` outside token-store.ts AND excluding *.test.ts == 0: 0 — PASS (with the test-file exclusion noted for Plan 02-06's Gate E)
- `^export default` count == 0: 0 — PASS
- `console\.(log|info|warn|error|debug|trace)` count == 0: 0 — PASS
- `process\.stdout\.write` count == 0: 0 — PASS (doc-comment rephrased)
- `retries: { retries: 10, factor: 1.2, minTimeout: 50 }` literal present: line 262 — PASS
- `stale: 5000` literal present: line 263 — PASS
- `REFRESH_BUFFER_MS = 5 * 60 * 1000` literal present: line 41 — PASS
- Test count >= 15: 17 — PASS
- 10-parallel concurrency test asserts `helper.getRefreshHitCount() === 1` AND `new Set(results).size === 1`: C-01 + C-02 — PASS
- `npm run lint` exits 0: PASS
- `bash scripts/ci-grep-gates.sh` exits 0: PASS
- `npm run test` full suite: 144/144 across 13 files — PASS

## Threat Flags

None. All threats in the plan's `<threat_model>` register (T-02.02-01 through T-02.02-10) are addressed by the implementation as planned. The new files do not introduce surface that wasn't already in the threat register:

- T-02.02-01 (concurrent refresh race) → mitigated by ADR-0002 three-layer gate; verified by C-01..03
- T-02.02-02 (token material in stack traces) → mitigated by `detail: \`token endpoint ${status}\`` only; verified by E-03
- T-02.02-03 (tokens.json readable by other users) → mitigated by `open(tmp, 'w', 0o600)` at create-time; verified by A-01
- T-02.02-04 (partial write from crash) → mitigated by `fd.sync()` before rename + same-dir rename (Pitfall D); structural
- T-02.02-05 (stale lock) → mitigated by `stale: 5000`; verified by L-01
- T-02.02-06 (tokens written to SQLite) → mitigated by SQLite never being touched in this module; structural
- T-02.02-07 (backend flipping mid-session) → mitigated by `storage-mode` cache + Pitfall F roundtrip; verified by B-01..04
- T-02.02-08 (hostile WHOOP response shape) → mitigated by `TokenResponseSchema.passthrough()`; structural (the parse path is tested via the 200 fixture in C-01..03)
- T-02.02-09 (retry burn) → mitigated by retry budget 0; verified by E-02
- T-02.02-10 (callback URL in logs) → mitigated by structured-only logging in this module; token-store.ts has no callback-URL handling (oauth.ts owns that — Plan 02-03)

## TDD Gate Compliance

Task 1 (`tdd="true"`) followed the full RED → GREEN → REFACTOR cycle:

- **RED:** `696bff3` (`test(02-02): add failing RED tests for token-store (17 tests)`) — all 17 tests fail with `Cannot find module './token-store.js'` before any production code lands.
- **GREEN:** `d7820ee` (`feat(02-02): implement token-store (GREEN — 17 tests pass)`) — module ships with the three-layer ADR-0002 gate; 17/17 tests pass on first run; lint + CI gates clean.
- **REFACTOR:** `6e06075` (`refactor(02-02): remove speculative tokenFileExists helper`) — YAGNI cleanup; 17/17 tests still green; 8 exports remain (>= 6 required).

---
*Phase: 02-oauth-token-store-single-flight-refresh*
*Plan: 02-02-token-store*
*Completed: 2026-05-12*
