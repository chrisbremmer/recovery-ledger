---
phase: 07-db-integrity-gate
plan: 04
req_ids: [DBIN-04]
github_issue: "#88"
status: complete
completed: 2026-06-01
---

# Plan 07-04 Summary — DBIN-04 decisions.updateOutcome typed not-found (#88)

## Result

Closed issue #88. `decisionsRepo.updateOutcome` returns `{ changed: 0 | 1 }`; the service layer throws a typed `DecisionNotFound` when 0. Pre-DBIN-04 a missing id silently no-op'd at the repo layer, and the caller detected the miss via a racy `byId` roundtrip — an irreplaceable user write (Pitfall 7) could be discarded under the wrong sequence.

## Changes

- **NEW** `src/domain/errors/decision.ts` — `DecisionNotFound` class with `kind: 'decision_not_found'` and `id` field; `isDecisionNotFound` type guard.
- `src/infrastructure/db/repositories/decisions.repo.ts` — `updateOutcome` return type changed from `void` to `{ changed: number }`; implementation returns `{ changed: result.changes }` from the transaction.
- `src/services/decision/index.ts` — `reviewDecisions(mode='update', …)` checks `result.changed === 0` and throws `DecisionNotFound(id)`. The byId roundtrip is preserved (needed to return the post-update entity) but its throw arm is also a typed `DecisionNotFound` for symmetry.
- `src/infrastructure/db/repositories/decisions.repo.test.ts` — Test 5 updated to assert `{ changed: 0 }` return; Test 5a added for the `{ changed: 1 }` case.
- `src/services/decision/index.test.ts` — Test 8a added: verifies the throw is `DecisionNotFound`, carries the right `id`, and `isDecisionNotFound` narrows.

## Acceptance

- `npm run test`: 1345 passed / 1 skipped / 0 failed (+2 from DBIN-04 repo + service tests).
- `npm run typecheck`: clean.
- `npm run lint`: clean.
- `npm run build`: clean.
- `bash scripts/ci-grep-gates.sh`: all gates passed.
- `npm run check:circular`: ✔ No circular dependency found.
