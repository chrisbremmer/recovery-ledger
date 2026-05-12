# agent_docs/

Long-form context for Claude Code (and any other agent reading
[`agents.md`](https://agents.md/)-style files) working on Recovery Ledger.

The root [`AGENTS.md`](../AGENTS.md) is the canonical entry point and stays
short. This directory holds the depth it links to. `CLAUDE.md` is a symlink
to `AGENTS.md` — edit `AGENTS.md`, not `CLAUDE.md`.

## Layout

```
agent_docs/
├── README.md            ← you are here
├── conventions.md       ← code style, testing, file-layout rules
├── skills.md            ← project slash-command catalog (stub until skills land)
├── learnings.md         ← self-healing log: numbered LNNNN rules captured on recurrence
├── decisions/           ← ADRs — immutable architectural decisions
│   ├── README.md        ← template + when to write one
│   └── NNNN-<slug>.md   ← one file per decision, numbered sequentially
└── workflows/
    ├── contributing.md  ← worktree + PR + commit + hook rules every agent must follow
    ├── pr-review.md     ← how /ce-code-review is run + what reviewers check
    └── debugging.md     ← investigation workflow (stub)
```

## How `AGENTS.md` uses this directory

`AGENTS.md` carries the rules and pointers an agent needs at a glance, then
links here for depth. The split exists so that:

- The entry-point file stays readable in one pass (~200 lines).
- Detail lives where it's edited most often — conventions evolve, ADRs are
  immutable, learnings accumulate.
- `agent_docs/` has a different change cadence than `.planning/`: planning
  artifacts move per phase; agent-working context outlives any phase.

If you're an agent and you need detail beyond what `AGENTS.md` shows,
follow the link to the relevant file in this tree.

## Self-healing

[`learnings.md`](./learnings.md) is the durable institutional memory.
Every recurring issue, every PR-review pattern that comes up twice, gets
captured there as a checkable rule. Reviewers scan it before reviewing;
authors update it when something recurs.

A learning is not "we should be more careful." A learning is a specific,
checkable rule — a lint config, a hook, a test, a checklist row, a
template field — that prevents the next recurrence mechanically.

## When to add a new file

Prefer extending an existing file. Add a new top-level file only when a
new domain emerges (e.g., `security.md`, `evaluation.md`) that doesn't fit
into conventions / workflows / decisions / learnings.

When in doubt, add a section instead of a file. Links from `AGENTS.md`
should stay predictable.
