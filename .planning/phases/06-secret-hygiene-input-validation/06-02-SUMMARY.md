---
phase: 06-secret-hygiene-input-validation
plan: 02
req_ids: [SECH-02]
github_issue: "#79 (+ #95 init/Pino-fatal/token-store mkdir)"
status: complete
completed: 2026-05-31
---

# Plan 06-02 Summary — SECH-02 doctor/init/MCP sanitize + token-store mkdir 0o700 (#79 + #95)

## Result

Closed issue #79 and three #95 fold-ins (init outer-catch, Pino-fatal sanitize, token-store mkdir mode). CLI doctor, MCP `whoop_doctor`, and CLI init now emit identically-sanitized error text on every failure path. Token-store config-dir creation now matches the `mode: 0o700` parity established by init.ts.

## Changes

### Production (5 files)
- `src/services/doctor/checks/whoop-roundtrip.ts`
  - Added `import { sanitize } from '../../../infrastructure/observability/sanitize.js'`.
  - Catch-arm `detail` string now wraps `err.message` in `sanitize()`.
  - Rewrote the 14–19 module comment — the probe sanitizes here BECAUSE the CLI doctor's outer catch serializes this detail directly to stdout via `renderDoctor`/`JSON.stringify`. Double-sanitize is idempotent (locked by F-SECH-02-05).
- `src/cli/commands/doctor.ts`
  - Added `import { sanitize }` from observability.
  - Outer catch `String(err)` now wraps in `sanitize()` for parity with `sync.ts`/`auth.ts`/`init.ts`.
  - Updated 87–94 comment — dropped the stale "CLI errors NOT routed through the MCP sanitizer" claim.
- `src/cli/commands/init.ts`
  - Added `import { sanitize }` from observability.
  - Outer catch `${String(err)}` now wraps in `sanitize()`. Updated 112–114 comment.
- `src/mcp/index.ts`
  - Extended line-21 import to `import { sanitize, serializeError } from '../infrastructure/observability/sanitize.js'`.
  - Both `logger.fatal({ err: serializeError(err) }, ...)` sites (lines 64 and 70) now pass `err: sanitize(serializeError(err))`.
- `src/infrastructure/whoop/token-store.ts`
  - Three `mkdir(resolvedPaths.configDir, { recursive: true })` sites (lines 222, 239, 313) now pass `{ recursive: true, mode: 0o700 }`. POSIX honors the mode on creation; Windows silently ignores. Parity with `init.ts:102`.

### Tests (3 files)
- `src/infrastructure/observability/sanitize.test.ts`
  - New `describe('SECH-02 error-path fixtures — doctor/init/MCP/token-store (#79)', ...)` block with 5 tests: F-SECH-02-01 whoop-roundtrip 401 cause chain, F-SECH-02-02 init mkdir EACCES, F-SECH-02-03 MCP fatal MigrationError cause chain, F-SECH-02-04 token-store doRefresh body excerpt, F-SECH-02-05 sanitize-idempotence lock.
- `src/services/doctor/checks/whoop-roundtrip.test.ts`
  - New `it('SECH-02 — catch-arm detail string is sanitize()-wrapped (#79)')` — fetcher rejects with `Error('upstream 401: Authorization: Bearer leaked_token_xxxxxxxxxx')`; asserts `status === 'fail'`, detail excludes the leak, includes `'Bearer <redacted>'`.
- `src/cli/commands/init.test.ts`
  - New `test('I-11 SECH-02 — outer-catch sanitizes thrown error message (#79)')` — mocks `node:fs/promises` so `mkdir` throws `'accessToken=secret_value_xyz'`; asserts stdout excludes the leak and contains `'accessToken=<redacted>'`.

## Acceptance

- `npm run test`: 1324 passed / 1 skipped / 0 failed (+7 from SECH-02; baseline 1317 on this branch's `main`).
- `npm run test` targeted (`whoop-roundtrip` + `init` + `sanitize`): 206 passed.
- `npm run lint`: clean (1 pre-existing `useTemplate` info on `recovery.ts:59` unrelated).
- `bash scripts/ci-grep-gates.sh`: all grep gates passed.
- `npm run build`: clean ESM build; `mcp-stdout-purity` integration test green (no `process.stdout.write` introduced in `src/mcp/`).
- `npm run format`: auto-formatted `init.test.ts` for trailing-comma style; behaviour unchanged.

## Net LOC

| File | Δ |
|---|---|
| `whoop-roundtrip.ts` | +8 / -6 |
| `doctor.ts` | +4 / -3 |
| `init.ts` | +5 / -2 |
| `mcp/index.ts` | +3 / -2 |
| `token-store.ts` | +5 / -3 |
| **Production total** | **~+25 / -16** (≤ ~30 budget per plan) |

## Deviations from PLAN.md

- **Format pass auto-applied** to `init.test.ts` after the test addition (Biome trailing-comma style). No behaviour change.
- **No snapshot test regressed** — Plan called out the possibility; verified false in this run.

## Phase 6 success criteria advanced

- ✅ Criterion #1 (≥ 50 token-key shapes covered): SECH-01 matrix (112 rows) + SECH-02 fixtures (5 rows) ≫ 50.
- ✅ Criterion #2: CLI doctor and MCP `whoop_doctor` emit identically-sanitized error text on `whoop_roundtrip` failure — locked by F-SECH-02-01 + the new probe test + the existing MCP register sanitize chain.
- ✅ #95 fold-ins shipped: init outer-catch (T-06-05), token-store mkdir 0o700 × 3 (T-06-07), MCP fatal sanitize (T-06-06).
