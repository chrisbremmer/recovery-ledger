# 0004. "No reliable pattern detected" is a positive output

- **Status:** Accepted
- **Date:** 2026-05-12
- **Decider(s):** CB

## Context

The weekly review is the highest-value surface of Recovery Ledger:
"what changed this week, and why might it have changed." That output
runs through MAD-scaled delta detection, a FDR-corrected significance
test, and a confidence-tier gate
([`ADR-0003`](./0003-score-state-discipline.md)).

Three failure modes look identical to a naive renderer:

1. Sample size too small to compute (< 10 scored days).
2. Deltas exist but don't clear the MAD-scaled threshold.
3. Candidate factors exist but FDR correction kills them all.

The temptation is to fill the slot anyway — pick the largest delta,
the loudest factor, the closest-to-significant correlation — and hand
the user *something*. That's the failure mode that ends the product:
the user reads "your sleep dropped 8% because of late workouts" when
the data didn't actually support that claim, acts on it, and stops
trusting future reviews.

## Decision

**When the data does not support a claim, the review explicitly says
so.** The string "No reliable pattern detected this week" (or the
JSON equivalent `{ "pattern": null, "reason": "<one-of-the-three-modes>" }`)
is a valid, expected, well-formed output. It is shipped, not hidden.

Specifically:

- If scored-day count < 10 → output reports `confidence: insufficient`
  and explains "fewer than 10 scored days this week."
- If MAD-scaled delta < threshold → output reports
  `confidence: weak` (if ≥ 10 days) or skips the section with reason
  "no metric moved by a notable amount."
- If FDR-corrected candidate set is empty → output explicitly states
  "no factor cleared the multiple-comparison correction" and lists
  the unranked candidates as context, not as a recommendation.

The renderer never invents content to fill a slot. It either reports a
reliable pattern or it reports the absence with the reason.

## Consequences

- Review templates must include the "no pattern" branch as a
  first-class case, not a fallback string.
- Tests assert that fixtures designed to produce empty FDR sets
  *return* the empty-state output, not an arbitrary nearest miss.
- The user develops calibrated trust: when Recovery Ledger says
  something, it means it.

## Alternatives considered

- **Always rank-and-report top factor.** Rejected: encourages the
  user to over-fit to noise.
- **Lower the FDR threshold until something passes.** Rejected:
  defeats the purpose of FDR correction.
- **Hide the section when empty.** Rejected: the silence is worse
  than the explicit absence; the user can't tell whether nothing
  was analysed or nothing reached significance.

## Enforcement

- Domain functions return `Result<Pattern, NoPatternReason>` (or
  equivalent) — the type system forces the caller to handle the empty
  case.
- Contract test with a "noisy week" fixture asserts the renderer
  emits the empty-state output, not a top-ranked invented pattern.
- Review-rendering unit tests cover each of the three empty modes
  explicitly.

## Cross-references

- [`0003-score-state-discipline.md`](./0003-score-state-discipline.md)
  — confidence-tier inputs
- [`0005-banned-tone-words.md`](./0005-banned-tone-words.md) — the
  empty-state copy must still meet the tone rules
- [`../../.planning/PROJECT.md`](../../.planning/PROJECT.md) —
  product-level rationale (trust loop)
