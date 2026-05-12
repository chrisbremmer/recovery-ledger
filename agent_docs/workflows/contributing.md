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
code — goes through PR. Once that flip happens, this section gets
updated to drop the carve-out.

Branch protection on `main` enforces this at the GitHub layer (require
PR, require linear history, no force push). The Claude Code hook in
[`.claude/settings.json`](../../.claude/settings.json) is defence in
depth — it refuses `git push origin main` before it reaches GitHub.

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

The following are **refused** without an explicit, in-conversation user
authorization (the Claude Code hook will block them):

- `git push origin main` (or any direct push to `main` / `master`)
- `git commit --no-verify`
- `git commit --no-gpg-sign` / `-c commit.gpgsign=false`
- `git push --force` / `--force-with-lease` to `main`
- `git reset --hard` when there are uncommitted changes
- `git branch -D` on a branch with unpushed commits

For destructive operations the agent prefers safer alternatives first
(stash, checkout, fix the failing hook). Bypass is the last resort.

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
