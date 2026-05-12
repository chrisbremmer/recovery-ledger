# Project skills

Slash commands defined inside this repo for Claude Code. Each lives at
`.claude/skills/<name>/SKILL.md` and is auto-discovered when Claude Code
opens this directory.

## Naming

- `gsd-*` for skills that wrap or extend GSD workflows.
- Short verbs (`/sync`, `/baseline`, `/review`) for top-level shortcuts.
- Avoid plugin-style namespacing (`vendor:*`, `pack:*`) for project skills
  — those prefixes are reserved for installed plugins.

## Frontmatter

```yaml
---
name: <skill-name>
description: <when should Claude invoke it? — end with explicit triggers>
---
```

Claude Code only sees the `description` when deciding whether to invoke,
so make triggers explicit: "Use when the user says ... or invokes /…".

## Catalog

Full skill spec lives in [`agent_docs/skills.md`](../../agent_docs/skills.md)
— update both this directory and that catalog when you add or rename a
skill.

No project skills today.
