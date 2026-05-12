# Claude Code hooks

Defence-in-depth guards that run before risky tool calls. Each hook is a
standalone bash script that reads the tool-call JSON on stdin and either
exits 0 (allow) or exits 2 with stderr text (block, feed message back to
Claude). Hooks are wired up in [`../settings.json`](../settings.json).

## Active hooks

| Script | Triggers on | Refuses |
|--------|-------------|---------|
| [`guard-git-push-main.sh`](./guard-git-push-main.sh) | Bash | `git push` refspecs that resolve to `main` / `master` |
| [`guard-hook-bypass.sh`](./guard-hook-bypass.sh) | Bash | `--no-verify`, `--no-gpg-sign`, `-c commit.gpgsign=false` |
| [`guard-mcp-stdout.sh`](./guard-mcp-stdout.sh) | Edit / Write / NotebookEdit | `console.*` writes into `src/{mcp,services,domain,infrastructure,formatters}/` |

## How to add a new hook

1. Drop the script in this directory. Pattern:
   - `set -euo pipefail` at the top.
   - Read stdin once: `input=$(cat)`.
   - Parse with `jq` from the captured input, not from stdin again.
   - Exit 0 to allow; exit 2 with a clear stderr message to block.
   - Reference the relevant ADR / learning / convention in the block message.
2. Wire it in [`../settings.json`](../settings.json) under
   `hooks.PreToolUse` with the appropriate `matcher` regex.
3. Add a row to the **Active hooks** table above.
4. If the hook codifies a new rule, also write or update the ADR /
   learning that backs it. The hook is the *enforcement*, not the
   *decision*.

## What hooks should not do

- **Modify state.** Hooks are read-only side-effect-free guards. If a
  hook needs to write a file, it's actually a different feature
  (`SessionStart`, post-commit, etc.).
- **Run slow tooling.** Hooks fire on every matching tool call. A 1-second
  hook adds 1 second to every tool call.
- **Be silently quiet on block.** A hook that exits 2 with no stderr
  leaves Claude guessing why. Always emit a clear, actionable message.

## False-positive policy

If a hook fires on something legitimate (e.g. `console.log` inside a
string literal in `src/formatters/`), the right fix is:

1. Restructure the code so the literal is unambiguous (extract to a
   constant, escape the substring).
2. If that's not possible, capture an `LNNNN` learning entry, refine the
   regex, and update the hook.

Disabling the hook to ship a one-off change defeats the point. Personal,
machine-specific overrides go in `.claude/settings.local.json`
(gitignored) — that file is for "this one machine, right now," not for
loosening the project's checked-in policy.
