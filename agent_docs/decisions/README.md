# Architecture Decision Records (ADRs)

Each meaningful technical decision lives here as an immutable record.
Once written, an ADR is **not edited** — if the decision changes, write
a new ADR that supersedes the old one.

## File naming

`NNNN-kebab-case-title.md` where `NNNN` is a zero-padded 4-digit
sequence:

```
0001-mcp-stdout-purity.md
0002-single-flight-oauth-refresh.md
0003-score-state-discipline.md
```

Numbers are sequential and never reused, even if an ADR is superseded.

## Template

```markdown
# NNNN. Title

- **Status:** Proposed | Accepted | Superseded by [NNNN](./NNNN-name.md)
- **Date:** YYYY-MM-DD
- **Decider(s):** initials

## Context

What is the issue we're seeing? What forces are at play? What constraints
already exist? Cite [`.planning/research/STACK.md`](../../.planning/research/STACK.md)
or [`ARCHITECTURE.md`](../../.planning/research/ARCHITECTURE.md) when
relevant.

## Decision

What did we decide? State it as a directive ("We will…") in one or two
short paragraphs.

## Consequences

What becomes easier? Harder? What did we explicitly trade away? What
follow-on work does this imply (lint rule, hook, CI gate)?

## Alternatives considered

Brief: what else we looked at and why we didn't pick it.

## Enforcement

Where the decision is enforced mechanically — Biome rule, husky hook,
CI workflow, Claude Code hook, type definition. If enforcement is only
"the doc says so," call that out.

## Cross-references

Links to related ADRs, learnings, conventions sections.
```

## When to write one

Write an ADR when the decision:

- Locks in a vendor, framework, or library that costs real time to swap
  later
- Defines a contract that other code will depend on (event schema, API
  shape, MCP tool surface)
- Establishes a non-obvious convention or load-bearing rule
- Resolves a debate where reasonable people disagreed
- Articulates a rule that, if silently violated, would break the
  product

Don't write one for trivial style choices, library version bumps, or
reversible config tweaks. Those live in
[`../conventions.md`](../conventions.md) or in commit messages.

## Cross-references

- [`../conventions.md`](../conventions.md) — code style / tests /
  layout (mutable)
- [`../learnings.md`](../learnings.md) — recurrence-driven rules
  (immutable but additive)
- [`.planning/research/STACK.md`](../../.planning/research/STACK.md) —
  current stack picks (some ADRs may override or formalise these)
- [`.planning/research/ARCHITECTURE.md`](../../.planning/research/ARCHITECTURE.md)
  — anchor invariants
