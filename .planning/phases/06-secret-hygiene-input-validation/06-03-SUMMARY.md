---
phase: 06-secret-hygiene-input-validation
plan: 03
req_ids: [INPV-01]
github_issue: "#80 (+ #95 findByPrefix min-length)"
status: complete
completed: 2026-05-31
---

# Plan 06-03 Summary — INPV-01 strict ISO `--since` + findByPrefix min-length (#80 + #95)

## Result

Closed issue #80 and the #95 `findByPrefix` min-length item. `--since` validation swapped from `new Date + isNaN` to Zod v4 `z.iso.date()` ∪ `z.iso.datetime()`; locale-dependent and calendar-invalid inputs are rejected at the CLI boundary with a clear `YYYY-MM-DD`-naming error.

## Calendar-invalidity probe

`node -e "z.iso.date().safeParse('2026-02-30')"` returned `success: false` — Zod v4's `z.iso.date()` rejects calendar-invalid dates natively via its built-in regex (`^...|02-(0[1-9]|1\d|2[0-8])$` etc., with explicit leap-year handling). **The round-trip post-check defense from PLAN.md was NOT needed.** Test 6h locks the behavior end-to-end.

## Changes

### Production
- `src/cli/commands/sync.ts`
  - Added `import { z } from 'zod'`.
  - New module-scope `SinceSchema = z.union([z.iso.date(), z.iso.datetime()])`.
  - `parseSinceFlag` swapped from coercive `new Date + isNaN` to `SinceSchema.safeParse`. Future-guard preserved (now safe because Zod proved the shape first).
  - Error message names the rejected value and the supported format.
- `src/infrastructure/db/repositories/decisions.repo.ts`
  - `findByPrefix` early-returns `[]` for `prefix.length < 4` (no SQL issued).

### New file
- `CHANGELOG.md` (Keep-a-Changelog format) — v1.1 entry naming #80 as the only user-visible breaking change; #78 + #95 under Fixed. Repo-owner placeholder resolved to `chrisbremmer`.

### Tests
- `src/cli/commands/sync.test.ts`
  - Test 6: assertion tightened to check for `YYYY-MM-DD` substring and rejected value.
  - Test 6a (`03/01/2026`), 6g (`yesterday`), 6h (`2026-02-30`), 6i (`2026-13-01`): new negative cases.
  - Test 6j (`2026-05-31`): new positive case proving runSync is reached with the date threaded through.
  - Test 6d (future ISO): tightened to assert the offending value appears in the message.
- `src/infrastructure/db/repositories/decisions.repo.test.ts`
  - Test 16c (`abc` length < 4): returns `[]`.
  - Test 16d (empty string): returns `[]`.
  - Test 16e (`01HK` length 4 boundary): executes SQL, returns matches.

## Acceptance

- `npm run test`: 1325 passed / 1 skipped / 0 failed (+8 from INPV-01).
- `npm run test -- src/cli/commands/sync.test.ts src/infrastructure/db/repositories/decisions.repo.test.ts`: 46 passed.
- `npm run lint`: clean (1 pre-existing `useTemplate` info on `recovery.ts:59` unrelated).
- `bash scripts/ci-grep-gates.sh`: all grep gates passed.
- `npm run build`: clean ESM build.

## Deviations from PLAN.md

- **Round-trip calendar-invalidity defense was NOT added** because Zod v4 rejected `2026-02-30` natively (probe result above). Plan called for conditional defense.
- **Test labels** — used `6a/6g/6h/6i/6j` instead of `6a/6b/6c/6e/6f` because `6b/6c` are already in use for resources tests. Sequence keeps adjacent so reviewers can scan.

## Phase 6 success criteria advanced

- ✅ Criterion #3: `2026-02-30` / `03/01/2026` / `yesterday` reject with `YYYY-MM-DD` in error; `2026-05-31` / `2026-05-31T00:00:00Z` succeed.
- ✅ Criterion #4: CHANGELOG names #80 as the only user-visible breaking change.
