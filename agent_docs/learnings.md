# Learnings — The Self-Healing Doc

This is Recovery Ledger's institutional memory for agents. **Every
recurring issue, every PR-review pattern that comes up twice, every "wait,
didn't we already hit this?" moment — capture it here.**

The rule: if you (an agent or a human) catch yourself solving the same
problem twice, the second time you must add it here so the third time it
can't happen.

## How self-healing works

When an issue, bug, or piece of PR feedback recurs:

1. **Catch it.** Reviewer or author notices: "this is the same thing as
   last week's PR / debugging session."
2. **Pin it.** Add an entry in the right category below. The entry must
   include the recurrence, the root cause, and the rule that prevents it.
3. **Wire it.** If the rule belongs in another doc
   ([`workflows/contributing.md`](./workflows/contributing.md),
   [`workflows/pr-review.md`](./workflows/pr-review.md),
   [`conventions.md`](./conventions.md), a Biome config, a husky hook, a
   CI workflow, a Claude Code hook), add it there too and link both ways.
4. **Mention it in the PR.** The PR that adds the learning gets a line in
   its agent-context section: "Adds learning #NN to prevent recurrence
   of X." That closes the loop — the next reviewer sees it and treats
   it as load-bearing.

> A learning is not "we should be more careful." A learning is a
> **specific, checkable rule** that catches the failure mode automatically
> — by lint, by test, by hook, by checklist item, by template change.

## Entry template

```markdown
### LNNNN — Short title (YYYY-MM-DD)

- **Symptom:** what the agent / reviewer / user actually saw
- **Root cause:** the real reason it happened (not the surface bug)
- **Rule:** the durable rule that now prevents it
- **Where the rule lives:** link(s) to the file(s) where the rule was
  added (lint config, doc section, test, template field, hook)
- **Triggered by:** PR # / commit / conversation date
- **Recurrences before pinning:** how many times we hit this before
  writing it down (so we know which categories drift)
- **Status:** active | absorbed-by-automation | superseded-by [LNNNN]
```

Number entries `L0001`, `L0002`, … — like ADRs, immutable. If a learning
turns out to be wrong, write a new one that supersedes it.

---

## Active learnings

> No learnings yet. Categories below are pre-seeded so the structure is
> stable; entries get added in date order as recurrences happen.

### Category: Git / branching / worktrees

_(empty)_

### Category: WHOOP API integration

_(empty)_

### Category: MCP protocol (stdout purity, tool schema, prompts)

_(empty)_

### Category: Domain logic (baselines, anomalies, FDR, score_state)

_(empty)_

### Category: Tests / fixtures / MSW

_(empty)_

### Category: Tooling / CI / hooks

_(empty)_

### Category: Documentation / process

_(empty)_

---

## What does NOT belong here

- **One-off bug fixes.** If it can't recur, it doesn't need a learning.
  The commit message is enough.
- **Style preferences without a failure mode.** "I prefer named exports"
  is in [`conventions.md`](./conventions.md), not here.
- **Architectural decisions.** Those are ADRs, in
  [`decisions/`](./decisions/). A learning may *trigger* an ADR, but the
  ADR is where the decision lives.
- **Stack picks.** Those live in
  [`.planning/research/STACK.md`](../.planning/research/STACK.md).

## Audit cadence

Every 30–90 days, an agent or human should:

1. Re-read all entries.
2. Verify each `Where the rule lives` link still resolves and the rule
   is still present in the linked file.
3. Mark any learning that's been fully absorbed into automation
   (Biome rule, husky hook, CI gate, Claude Code hook) with
   `**Status:** absorbed-by-automation` so future readers know it's
   enforced without needing to remember it.

## Cross-references

- [`workflows/contributing.md`](./workflows/contributing.md) — where many
  rules end up living
- [`workflows/pr-review.md`](./workflows/pr-review.md) — reviewers scan
  this file before reviewing
- [`decisions/`](./decisions/) — ADRs (durable decisions, not learnings)
