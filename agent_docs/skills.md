# Project skills

> Slash commands defined inside this repo for Claude Code. They live under
> `.claude/skills/<name>/SKILL.md` and are auto-discovered when an agent
> opens this directory.

## Discovery model

Skills come from two places:

- **Project skills** live under `.claude/skills/<name>/SKILL.md`, are
  checked into this repo, and are auto-discovered by Claude Code on
  session start.
- **Plugin-installed skills** come from Claude Code plugins enabled in
  [`.claude/settings.json`](../.claude/settings.json). They live under
  `~/.claude/plugins/` per machine; Claude Code installs them
  automatically on first session because the project pins them.

A project skill is any directory under `.claude/skills/` containing a
`SKILL.md` file with this frontmatter:

```yaml
---
name: <skill-name>
description: <when should Claude invoke it? — end with explicit triggers>
---
```

Claude Code surfaces them via the Skill tool and as `/<skill-name>` slash
commands. The `description` is the only thing Claude sees when deciding
whether to invoke — write it so the triggers are explicit
("Use when the user says … or invokes /…").

## Active project skills

> No project skills yet. Naming guidance below for when the first one
> lands.

When a project skill is added, append a row here:

| Skill | Role | Side effects |
|-------|------|--------------|
| `/<name>` | one-line role description | what it touches |

## Plugin-installed skills

Recovery Ledger pins one Claude Code plugin in
[`.claude/settings.json`](../.claude/settings.json):

| Plugin | Source | What it gives |
|--------|--------|---------------|
| `compound-engineering@compound-engineering-plugin` | [`EveryInc/compound-engineering-plugin`](https://github.com/EveryInc/compound-engineering-plugin) | Multi-agent code review (`/ce-code-review`), debugging, planning, and simplification skills, plus the `compound-engineering:ce-*` reviewer-agent namespace. |

### One-time setup per machine

```
/plugin marketplace add EveryInc/compound-engineering-plugin
```

After that, opening this repo with Claude Code auto-installs the plugin
because of the project pin.

### Primary entry point: `/ce-code-review`

**Trigger:** "review PR #N", "do a code review on this branch", or
`/ce-code-review <PR-number-or-URL>`.

**Behaviour:** Spawns a parallel multi-agent review team (correctness,
testing, maintainability, project-standards, plus conditional reviewers
for security, performance, reliability, etc.) chosen from the diff
content. Returns a single severity-ordered report.

**Convention:** Run it on every PR before requesting merge approval. The
PR template's "Section 2 — For Agents" feeds the reviewers their context
budget. See [`workflows/pr-review.md`](./workflows/pr-review.md).

### Persona-agent namespace

If you ever dispatch plugin reviewer agents directly via the Agent tool,
use the `compound-engineering:ce-*` prefix
(`compound-engineering:ce-correctness-reviewer`, etc.). Bare names like
`ce-correctness-reviewer` fail with `Agent type not found`. The
`/ce-code-review` skill handles namespacing for you.

## Where to add new skills

Project skills go under `.claude/skills/<skill-name>/SKILL.md`. Naming:

- `gsd-*` for skills that wrap or extend GSD workflows.
- Short verbs (`/sync`, `/baseline`, `/review`) for top-level shortcuts.
- Avoid plugin namespacing (`vercel:*`, `pr-review-toolkit:*`) for project
  skills — those prefixes are reserved for installed plugins.

When you add one, append a row to the **Active project skills** table
above and document its trigger / args / side effects in the same shape.

## Cross-references

- [`workflows/pr-review.md`](./workflows/pr-review.md) — `/ce-code-review`
  usage patterns
- [`learnings.md`](./learnings.md) — capture skill-related gotchas here
