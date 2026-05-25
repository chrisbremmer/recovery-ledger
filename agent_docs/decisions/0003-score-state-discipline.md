# 0003. `score_state` discipline

- **Status:** Accepted
- **Date:** 2026-05-12
- **Decider(s):** CB

## Context

WHOOP API v2 returns scored entities (cycles, recovery, sleep, workouts)
with one of three `score_state` values:

- `SCORED` — score is final and trustworthy.
- `PENDING_SCORE` — entity exists, score is still being computed.
- `UNSCORABLE` — entity exists, will never be scored (insufficient data,
  hardware issue, etc.).

The naive approach — read the score field directly, treat missing as
zero — silently treats `PENDING_SCORE` and `UNSCORABLE` rows as low
scores. That destroys baselines (pulled toward zero), generates false
"low recovery" alerts, and pollutes anomaly detection. Worst of all, the
user can't tell why their baseline drifted because the data looks
plausible.

Trust in Recovery Ledger depends on the review output being correct.
A single "your recovery is trending low" message that turns out to be
two `PENDING_SCORE` rows treated as zeros is the end of the product.

## Decision

**Score values are consumed through a discriminated union:**

```ts
type Score =
  | { score_state: 'SCORED'; value: number }
  | { score_state: 'PENDING_SCORE' }
  | { score_state: 'UNSCORABLE' };
```

Domain code (baselines, anomalies, patterns, weekly review) operates on
`SCORED`-only collections by default. Filtering happens once, near the
service boundary, and the filtered count is reported alongside the
result. `PENDING_SCORE` and `UNSCORABLE` are never coerced to `0`,
`null`, or `undefined`.

Confidence-tier rules (see also
[`ADR-0004`](./0004-no-reliable-pattern-positive-output.md)) apply to
the `SCORED` count, not the row count:

- `insufficient` for < 10 `SCORED` days
- `weak` for ≥ 10 `SCORED` days
- `strong` for ≥ 20 `SCORED` days with ≥ 70% baseline coverage
- Z-scores refused below 14 `SCORED` days

## Consequences

- The type system enforces the rule: you can't read `.value` off a
  `Score` without narrowing through `score_state`.
- Every aggregate carries metadata: scored count, pending count,
  unscorable count. This is part of the JSON output schema, not
  optional.
- Review output explicitly says "based on N scored days" so the user
  knows what was actually used.

## Alternatives considered

- **`score: number | null`, null means missing.** Rejected: collapses
  `PENDING_SCORE` and `UNSCORABLE` into one bucket and loses the
  reason; also makes "0 vs null" subtle in arithmetic.
- **String column without a typed union.** Rejected: code paths will
  miss states; the discriminated union turns the rule into a compile
  error if you forget a case.

## Enforcement

- Type definition in `src/domain/types/score.ts` (landed in Phase 3).
- Branded `ScoredOnly<T>` + `filterScored(items)` helper also in
  `src/domain/types/score.ts` (landed #16). The brand can only be
  produced by passing through `filterScored` (or by an explicit
  cast at a repo boundary that has already filtered on
  `score_state = 'SCORED'` — the four scored-resource repos do this
  by default in `byRange()`). Domain functions that depend on the
  SCORED-only invariant accept `ScoredOnly<T>[]` so the upstream
  filter is documented at the type level.
- Contract test asserting baseline output excludes `PENDING_SCORE`
  and `UNSCORABLE` rows.

## Cross-references

- [`0004-no-reliable-pattern-positive-output.md`](./0004-no-reliable-pattern-positive-output.md)
  — confidence tiers + FDR rules
- [`../workflows/debugging.md`](../workflows/debugging.md) —
  "Score-state regressions" runbook entry
- [`../../.planning/research/ARCHITECTURE.md`](../../.planning/research/ARCHITECTURE.md)
  — domain module layout
