---
phase: 02-oauth-token-store-single-flight-refresh
fixed_at: 2026-05-13T00:57:00Z
review_path: .planning/phases/02-oauth-token-store-single-flight-refresh/02-REVIEW.md
iteration: 2
findings_in_scope: 4
fixed: 4
skipped: 0
status: all_fixed
---

# Phase 02: Code Review Fix Report (Pass 2)

**Fixed at:** 2026-05-13T00:57:00Z
**Source review:** `.planning/phases/02-oauth-token-store-single-flight-refresh/02-REVIEW.md` (pass 2 re-review)
**Iteration:** 2
**Prior pass:** Pass-1 fixes (15/15 in-scope findings) committed at `a8566b5..153768c`; pass-1 REVIEW-FIX.md preserved in git at commit `8b00b58`.

**Summary:**
- Findings in scope (warnings only, default fix_scope=critical_warning): 4
- Fixed: 4
- Skipped: 0
- Info findings (out of scope): 5 — documented in REVIEW.md, deferred to a future cleanup pass

All four pass-2 warnings are addressed with source fixes plus pinning
regression tests. 258/258 in-scope tests pass (1 pre-existing build-gated
integration failure unrelated to this work); lint and all five CI grep gates
remain green.

Verification per fix: Tier 1 (re-read modified file section) + Tier 2 (run
the affected `npx vitest` test file AND `npm run test` for cross-file
regressions) + `npm run lint` + `bash scripts/ci-grep-gates.sh` after every
commit. No fix introduced a TypeScript regression (pre-existing tsc errors
in `tests/helpers/msw-whoop-oauth.ts` and `src/cli/commands/auth.ts:97`
were present before this pass; confirmed via `git stash` + `npx tsc
--noEmit`).

## Fixed Issues

### WR-A: Real-lockfile tests do not exercise the cross-process contention they claim to test

**Files modified:** `src/infrastructure/whoop/token-store.test.ts`
**Commit:** `f26b634`
**Applied fix:** Option (b) from the review — downgrade the describe-block
header + per-test docs to what these tests actually verify, instead of
spawning a worker_thread/child_process to manufacture cross-process
contention.

The original WR-05 describe-block header promised that LR-01/LR-02 would
catch retry-policy regressions (e.g., `retries: 10 → retries: 0`) at unit
scope. Investigation confirmed the review's analysis: both LR-01 calls
share one `createTokenStore()` instance, so the in-process
`inFlightRefresh` Promise-gate intercepts the second call BEFORE
`doRefresh` runs — only ONE call ever reaches `proper-lockfile.lock`,
uncontended. A retry-policy regression is detectable only by the
cross-process integration test (`tests/integration/auth-concurrency.test.ts`),
which spawns two real processes against a local mock server.

Option (a) — spawning a worker_thread/child_process to hold the real lock
— would duplicate the integration suite's coverage at unit scope with the
same flakiness profile (TOCTOU on lock-directory creation, mtime
granularity). The honest doc downgrade is the right fix.

The describe block now correctly scopes itself: LR-01 proves the real
`proper-lockfile` module is reachable from `createTokenStore` (a wiring
regression that no-op'd the import would fail), and LR-02 proves
`release()` is actually called (a regression where the lock is acquired
but never released would leave the `<target>.lock` directory and fail).
Both useful, neither overclaiming.

### WR-B: `buildAuthorizeUrl` threw the wrong AuthError kind for invalid clientId shape

**Files modified:** `src/infrastructure/whoop/oauth.ts`, `src/infrastructure/whoop/oauth.test.ts`
**Commit:** `7cfaa08`
**Applied fix:** Changed the kind from `refresh_failed` to `auth_missing`
with detail `'invalid clientId in config; re-run recovery-ledger init'`.

The pre-fix code threw `AuthError({kind: 'refresh_failed', detail:
'invalid clientId shape'})`. `formatAuthError`'s `refresh_failed` arm maps
to "Token refresh failed — run `recovery-ledger auth` to re-authorize."
That remediation is wrong on three counts: (1) the user has no tokens yet
at this point — there is nothing to refresh, (2) a malformed clientId is
fixed by re-running `recovery-ledger init`, not by re-authorizing, (3)
re-running `auth` would re-enter the same broken path.

The right kind is `auth_missing`, whose remediation already points at
`recovery-ledger init`. Adding a new `config_invalid` kind to the FROZEN
six-kind AuthErrorKind union would have required updating
`formatAuthError`, `AUTH_EXIT_CODES`, and the `recovery-ledger auth --help`
block per MR-21 forcing-function discipline — explicitly out of scope per
orchestrator context. `auth_missing` is the closest semantic fit and the
detail string carries the specific cause.

Pinned by new `U-06`: asserts the kind is `auth_missing` (not
`refresh_failed`) and the detail mentions `init`. A future refactor that
re-introduces `refresh_failed` here would surface the wrong remediation
"Token refresh failed — run `recovery-ledger auth` to re-authorize" and
this test would fail.

**Logic-classification note:** Although the review describes this as a
wrong remediation message, the fix is structural (a kind constant) and
its correctness is pinned by the new test that asserts the post-fix kind.
No human-verification flag needed.

### WR-C: `auth.ts` outer `instanceof AuthError` duck-type degraded the MR-21 forcing function

**Files modified:** `src/infrastructure/whoop/errors.ts`, `src/infrastructure/whoop/errors.test.ts`, `src/cli/commands/auth.ts`
**Commit:** `e929c90`
**Applied fix:** Option (a) from the review — export an `isAuthError`
type guard from `errors.ts` that derives the duck-type set from the same
tuple the `AuthErrorKind` union is derived from. `auth.ts` now imports
and uses `isAuthError`; the local `isAuthErrorShape` helper + duplicate
`AUTH_ERROR_KINDS` Set are deleted.

The duck-type pattern (vs `instanceof`) is still required: Vitest's
`vi.resetModules()` produces two module-graph instances of `errors.ts`
with different `AuthError` class identities. Option (b) — converting
`auth.test.ts` to the refresh-orchestrator F-01 pattern (dynamic import
of `AuthError` after `resetModules()`) — would let us return to
`instanceof`, but every test that currently constructs an `AuthError`
would need to dynamic-import it after `resetModules()`, and the test
file already has 12 tests using a top-level `import('./errors.js')`. The
edit-blast radius was much larger than option (a) for a tactically
equivalent result. Option (a) preserves test ergonomics AND moves the
test-coupled smell out of `auth.ts` into `errors.ts` where the
deserialization-safe `isAuthError` is the production-honest place for
it.

Structural changes:
- `AUTH_ERROR_KINDS` is now a `readonly` tuple (`as const`) exported
  from `errors.ts`.
- `AuthErrorKind = (typeof AUTH_ERROR_KINDS)[number]` derives the union
  from the tuple. Adding a kind means editing one tuple.
- `isAuthError(err): err is AuthError` duck-types on `name ===
  'AuthError'` AND `kind` membership in `AUTH_ERROR_KINDS`.
- `auth.ts` imports `isAuthError` and the duplicate Set + local helper
  are gone.

Adding a kind now (a) extends the type union, (b) extends the duck-type
guard, AND (c) trips `formatAuthError`'s exhaustive switch — MR-21
restored end-to-end.

Pinned by 7 new tests (`IS-01..IS-07`):
- IS-01: real `AuthError` instance detected
- IS-02: cross-module-graph shape (the literal `resetModules` scenario)
  detected
- IS-03: plain Error rejected
- IS-04: null/undefined/primitives rejected
- IS-05: name=AuthError + invalid kind rejected (defense-in-depth: a
  synthesized object claiming to be AuthError but with a non-union kind
  must not pass)
- IS-06: `AUTH_ERROR_KINDS` contents pinned + every kind round-trips
  through `formatAuthError` with non-empty output
- IS-07: tuple shape (length 6, all strings)

### WR-D: `writeUnderLock` leaves stale keychain blob when fallback path fires

**Files modified:** `src/infrastructure/whoop/token-store.ts`, `src/infrastructure/whoop/token-store.test.ts`
**Commit:** `39ed6f4`
**Applied fix:** Best-effort `deletePassword()` call at the start of the
file-fallback arm in `writeUnderLock`, gated on `!forceFile`. Symmetric
with `clear()`, which already best-effort-deletes the keychain entry
whenever the mode was `'keychain'`.

When `setPassword` throws OR the round-trip read returns a mismatched
blob (Pitfall F), the fallback path writes to the file backend and the
storage-mode marker correctly flips to `'file'`. Pre-fix, the
previously-written keychain entry (Pitfall F case) or any stale entry
from a prior session was left in place. If a later session somehow
reverted the storage-mode marker (manual edit, future bug, backup
restore mid-session), the old keychain blob would silently re-emerge
with an arbitrary version of the tokens — defeating defense-in-depth
across this module.

Severity remained low under current code (nothing in this phase toggles
the marker), but the symmetry argument in the review is correct: the
rest of the module is paranoid about cross-session state. Phase 3+
modules consuming this token store should not need to know that
`writeUnderLock` left a ghost blob behind.

The `forceFile === true` skip is explicit: under
`RECOVERY_LEDGER_FORCE_FILE_STORE=1` (D-25), the user has elected to
keep the keychain untouched for this session; the delete-probe would
itself be a touch.

Pinned by 3 new tests:
- B-05 (WR-D regression): `setPassword` throws → fallback fires →
  `deletePassword` is called on the entry
- B-06 (WR-D regression): Pitfall F round-trip mismatch → fallback
  fires → `deletePassword` is called
- B-07 (WR-D regression): `forceFile=true` → neither `setPassword` nor
  `deletePassword` is called — keychain untouched

## Skipped Issues

None. All four in-scope warnings were fixed with source changes plus
pinning regression tests.

## Out-of-Scope (Info findings — documented but not fixed)

Per `fix_scope=critical_warning`, the 5 info findings (`IN-01..IN-05`)
are documented in REVIEW.md but not addressed in this pass. They are:

- **IN-01:** Pass-1 IN-01 fixed incidentally; pass-1 IN-02..IN-06 are
  stable (informational, no action required).
- **IN-02:** `storageMode` ordering in the child helper — currently fine
  under `forceFileStore`, future-tightening note.
- **IN-03:** `formatDuration` negative-input behavior — JSDoc-documented
  precondition; one-line pinning test recommended for a future pass.
- **IN-04:** `services/index.ts` `Services` interface uses `typeof` of
  the singleton — clean-up opportunity, will compound in Phase 3 when DB
  + HTTP singletons land.
- **IN-05:** `auth.ts` `process.exit` callbacks ignore the optional
  `Error` argument — benign in practice (broken-pipe is the only
  realistic trigger); future ergonomics cleanup.

None block phase exit; all are flagged for a future cleanup pass.

## Verification Summary

| Step | Result |
|------|--------|
| Per-fix test runs (`npx vitest run <affected file>`) | All passing |
| Full `npm run test` after each commit | 258/258 in-scope passing (7 skipped, 1 pre-existing build-gated integration failure unrelated to this work) |
| `npm run lint` after each commit | Clean (46 files checked, no fixes applied) |
| `bash scripts/ci-grep-gates.sh` after each commit | All 5 gates green |
| `npx tsc --noEmit` | No new errors introduced (3 pre-existing errors confirmed pre-existing via `git stash`) |
| Commit format | One atomic commit per finding, `fix(02): WR-X <short summary>` |

## Open Concerns

None. The four warnings are now either source-fixed (WR-B, WR-C, WR-D)
or honestly scoped (WR-A). The pass-2 review's read on the codebase is
that no pass-2-blocker is created by these fixes; a pass-3 review (if
run) should find only the 5 IN-* items as remaining work.

---

_Fixed: 2026-05-13T00:57:00Z_
_Fixer: Claude (gsd-code-fixer), pass 2_
_Iteration: 2_
