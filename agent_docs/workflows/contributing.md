# Contributing

Rules every agent (and human) follows when changing code or planning
artifacts. [`AGENTS.md`](../../AGENTS.md) summarises; this file is
authoritative.

If a rule on this page is also enforced mechanically (Biome, husky, CI,
Claude Code hook, branch protection), the mechanical layer is the source
of truth — this page is the human-readable explanation.

## Branch policy

> **Never work or push directly on `main` once Phase 1 has started.**
> All code changes go through worktree + branch + PR + explicit user
> approval.

The only carve-out: while Phase 0 (planning) is still active,
`.planning/**`-only changes can land directly on `main` because the work
is faster than the gate is useful. The moment Phase 1 produces any `src/`
content, *every* change — including planning updates that ship alongside
code — goes through PR. Check with:

```sh
git ls-tree -r --name-only origin/main | grep -q '^src/' && echo "carve-out EXPIRED" || echo "carve-out ACTIVE"
```

Once expired, this section gets updated to drop the carve-out.

**Two enforcement layers, in order of importance:**

1. **GitHub branch protection on `main`** — refuses non-PR pushes,
   force-pushes, and deletions at the API level. This is the actual
   fence; everything else is best-effort.
2. **PreToolUse guards** in [`.claude/settings.json`](../../.claude/settings.json)
   — refuse the obvious mistakes before they reach git: literal `git push
   origin main`, `--no-verify`, `--gpg-sign=false`, `console.*` writes
   into MCP-reachable paths. The guards **do not** plug every shell
   indirection (`sh -c`, `eval`, `$(…)`, heredoc-driven file writes).
   Treat them as cheap first-line guards, not as a sufficient defense.

## Worktree + PR workflow

```sh
# 1. Sync
git fetch origin main

# 2. Create an isolated worktree on a topic branch
git worktree add .worktrees/<branch-name> -b <branch-name> origin/main

# 3. Work inside the worktree. Commit with conventional commits.
cd .worktrees/<branch-name>
# … edits, atomic commits …

# 4. Push and open the PR
git push -u origin <branch-name>
gh pr create  # template auto-loads from .github/pull_request_template.md

# 5. Run /ce-code-review on the PR (see workflows/pr-review.md)

# 6. Wait for explicit user approval. Squash-merge via GitHub.

# 7. Clean up
cd ../..
git worktree remove .worktrees/<branch-name>
git branch -d <branch-name>
```

`.worktrees/` is gitignored. The directory is the canonical place for
all branch checkouts so that `main` always reflects the merged state.

## Branch naming

`<type>/<short-slug>` — match the conventional-commit type prefix:

- `feat/oauth-init`
- `fix/refresh-token-race`
- `chore/agent-infrastructure`
- `docs/phase-02-context`
- `test/cycles-contract-fixture`
- `refactor/extract-baseline-coverage`

Keep the slug short and grep-able. Avoid issue numbers in branch names
(the PR carries them).

## Commits

- **Format.** Conventional Commits, lower-case prefix, no period:
  `docs: define v1 requirements`, `feat: implement sync service`,
  `fix: refresh-token race`. Match the style already in `git log`.
- **Atomic.** One concern per commit. Planning artifacts and code do not
  mix in the same commit.
- **Body when warranted.** Short subject + blank line + body when the
  *why* needs more than a line.
- **Never bypass hooks.** `--no-verify`, `--no-gpg-sign`, and similar are
  refused by the Claude Code hook. If a hook fails, fix the underlying
  issue. The hook bypass is reserved for the user, not the agent.
- **Never amend pushed commits.** Add a follow-up commit instead. The
  branch is short-lived; clean history comes from squash-merge, not from
  history rewriting.

## Pull request rules

- **PR template is mandatory.** Both Section 1 (Summary / Test plan) and
  Section 2 (For Agents) must be filled in. The reviewer agents read
  Section 2 — leaving it blank degrades the review.
- **One PR, one concern.** If the diff grows beyond one concern, split
  the branch.
- **Self-review with `/ce-code-review` before requesting human
  approval.** Even solo, the multi-agent reviewer catches things a
  single read misses. Interactive mode is fine; no posting required.
- **Merge strategy:** squash-merge from the GitHub UI. The PR title
  becomes the squashed commit subject.

## Hook bypass and destructive operations

The PreToolUse guards in [`.claude/settings.json`](../../.claude/settings.json)
**refuse** these patterns:

- `git push` whose refspec resolves to `main` / `master`
- `git commit --no-verify` (and quoted variants outside a `-m` message body)
- `--no-gpg-sign`, `-c commit.gpgsign=false`, `--gpg-sign=false`, and
  `GIT_CONFIG_PARAMETERS=...commit.gpgsign=…`
- `Edit` / `Write` / `MultiEdit` writes to `.claude/settings.json` or
  `.claude/hooks/**` (the hooks defend themselves)

The following are **not** machine-refused today; the agent simply
prefers safer alternatives:

- `git push --force` / `--force-with-lease` to `main` — caught at the
  branch-protection layer, not by the hook
- `git reset --hard` with uncommitted changes — agent should stash or
  branch first
- `git branch -D` on a branch with unpushed commits — agent should
  push or rebase first
- Shell indirection that wraps a refused command (`sh -c "git push origin main"`,
  `eval "..."`) — structurally outside the hook's scope; branch
  protection catches it

For destructive operations the agent prefers safer alternatives first
(stash, checkout, fix the failing hook). Bypass is the last resort and
requires explicit user authorization.

## Planning artifacts

- `.planning/**` is the project's contract. Don't mirror its content
  into `agent_docs/` or `README.md`.
- When a phase produces real code, the phase's `.planning/phases/0N-*/`
  documents update alongside the code in the same PR.
- `.planning/STATE.md` is updated at meaningful checkpoints — context
  resumes, phase completions, milestone hand-offs. Don't update it on
  every commit.

## Cross-references

- [`pr-review.md`](./pr-review.md) — `/ce-code-review` usage
- [`debugging.md`](./debugging.md) — investigation workflow
- [`../conventions.md`](../conventions.md) — code style, tests, file
  layout
- [`../decisions/`](../decisions/) — ADRs (durable architectural choices)
- [`../learnings.md`](../learnings.md) — recurrences-turned-rules
- [`../../.github/pull_request_template.md`](../../.github/pull_request_template.md)
  — PR template
