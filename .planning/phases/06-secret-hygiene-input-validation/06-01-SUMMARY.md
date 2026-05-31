---
phase: 06-secret-hygiene-input-validation
plan: 01
req_ids: [SECH-01]
github_issue: "#78"
status: complete
completed: 2026-05-31
---

# Plan 06-01 Summary — SECH-01 sanitizer camelCase coverage (#78)

## Result

Closed issue #78. `SECRET_KEY_NAMES` now covers camelCase token-key variants in addition to v1.0's snake_case entries; a property-style matrix (112 rows) drives a single table-driven test that locks the coverage contract.

## Changes

### Production
- `src/infrastructure/observability/sanitize.ts`
  - `SECRET_KEY_NAMES` extended from 11 entries (snake_case) to 18 entries (snake_case + 7 camelCase: `accessToken`, `refreshToken`, `clientSecret`, `clientId`, `idToken`, `apiKey`, `bearerToken`).
  - `PATTERNS` array length unchanged (still 7) — patterns 2/2a/2b/2c re-build from `SECRET_KEY_ALT = SECRET_KEY_NAMES.join('|')` per the MR-11 design, so the alternation extends in lockstep with no regex edits.

### Tests
- `src/infrastructure/observability/sanitize.test.ts`
  - Added 7-key membership pin (`SECRET_KEY_NAMES includes camelCase token-key variants (SECH-01 #78)`).
  - Added `SECH-01 matrix` describe block: 112 fixture rows (7 camelCase + 4 snake_case + 3 mixed-case keys × 4 shapes (json / urlquery / formbody / jsliteral) × 2 fixture values each) driven by `test.each`.
  - Matrix-length regression lock: `expect(SECH_01_MATRIX.length).toBeGreaterThanOrEqual(50)`.

## Acceptance

- `npm run test -- src/infrastructure/observability/sanitize.test.ts`: 183 tests pass (was 71 before SECH-01; +112 matrix rows).
- `npm run test`: 1317 passed / 1 skipped / 0 failed across 114 test files.
- `npm run lint`: clean (1 pre-existing `useTemplate` info on `src/infrastructure/whoop/resources/recovery.ts:59` is unrelated to this PR).
- `bash scripts/ci-grep-gates.sh`: `All grep gates passed.`
- `npm run build`: clean ESM build.

## Final counts

| Metric | Value |
|---|---|
| `SECRET_KEY_NAMES.length` | 18 (was 11) |
| `PATTERNS.length` | 7 (unchanged) |
| `SECH_01_MATRIX.length` | 112 (≥ 50 floor) |
| New tests added | 113 (1 membership pin + 1 length lock + 111 `test.each` rows) |

## Deviations from PLAN.md

None. Plan called for ≥ 50 matrix rows; delivered 112 by using 14 keys (7 camelCase + 4 snake_case anchors + 3 mixed-case anchors) × 4 shapes × 2 fixtures. This is over the floor but stays declarative (single `buildMatrix()` builder, single `test.each`, single assertion shape) per PITFALLS.md "Sanitize property-test sprawl".

## What advances toward Phase 6 success criterion #1

> A grep of stderr capture + log dir after inducing every error path … yields zero matches for `Bearer`, JWT shape, `accessToken`, `refreshToken`, or `clientSecret` — verified by a property-test-style fixture matrix covering ≥ 50 token-key shapes.

This PR delivers the floor for ≥ 50 shapes. Sub-PR B (SECH-02, Plan 06-02) adds the error-path fixtures (CLI doctor outer-catch, MCP fatal, init.ts outer-catch, token-store mkdir) that close the criterion end-to-end.
