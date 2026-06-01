---
phase: 08-refresh-atomicity
plan: 01
req_ids: [ERRC-02]
github_issue: "#87"
status: complete
completed: 2026-06-01
---

# Plan 08-01 Summary — ERRC-02 refresh-write atomicity (#87)

## Result

Closed issue #87. `doRefresh` now wraps `writeUnderLock(next)` in try/catch and throws `AuthError({kind: 'refresh_failed', cause: writeErr})` if the rotated pair landed in memory but persistence failed (mkdir EACCES, EROFS, disk full, keyring setPassword threw, atomic rename error). Pre-ERRC-02 the in-memory token was returned but the OLD refreshToken stayed on disk — the next process invocation would re-present it to WHOOP and burn the token family per ADR-0002 §Context.

## Changes

- `src/infrastructure/whoop/token-store.ts` — try/catch around `writeUnderLock(next)`; rethrows as typed `AuthError({kind:'refresh_failed'})` carrying the original write error as `cause`.
- `agent_docs/decisions/0002-single-flight-oauth-refresh.md` — §Enforcement extended with the explicit "refresh response succeeded + write failed → force re-auth" rule, citing the new R-01 regression test.
- `src/infrastructure/whoop/token-store.test.ts` — R-01 regression: mocks `fs/promises.rename` to throw for the canonical tokens.json path; asserts AuthError(refresh_failed) is thrown, cause is set, and the WHOOP refresh endpoint WAS hit (i.e., the rotated pair was consumed but never persisted — the race the bug describes).

## Acceptance

- npm run test: 1352 passed / 1 skipped / 0 failed (+1 from ERRC-02).
- typecheck/lint/build/check:circular/grep-gates: all green.

Closes #87. Phase 8 complete.
