#!/usr/bin/env bash
# PreToolUse hook for Bash. Refuses any `git push` whose refspec resolves to
# main/master. Defence in depth — GitHub branch protection is the real fence,
# but this catches the agent before the request leaves the laptop.
#
# Tokenizes the args after `git push` and checks each one against the set
# of refspecs that resolve to main/master. Branch names that *contain* the
# word "main" (e.g. `chore/main-thing`) are not affected.
#
# See agent_docs/workflows/contributing.md for the worktree+PR workflow.
set -euo pipefail

input=$(cat)
cmd=$(printf '%s' "$input" | jq -r '.tool_input.command // ""')

# Walk each `git push ...` invocation in the command string. We support
# compound commands joined by `;`, `&&`, `||` or `|` — each is checked
# independently.
blocked=0
while IFS= read -r segment; do
  # Extract args after the first `git push` token in this segment.
  push_args=$(printf '%s' "$segment" | awk '
    {
      for (i = 1; i <= NF; i++) {
        if ($i == "git" && $(i+1) == "push") {
          for (j = i + 2; j <= NF; j++) printf "%s\n", $j
          exit
        }
      }
    }
  ')

  if [ -z "$push_args" ]; then continue; fi

  while IFS= read -r tok; do
    [ -z "$tok" ] && continue
    # Strip a leading '+' (force-push refspec marker).
    case "$tok" in +*) tok="${tok#+}" ;; esac

    case "$tok" in
      main|master)
        blocked=1
        break 2
        ;;
      *:main|*:master)
        blocked=1
        break 2
        ;;
    esac
  done <<< "$push_args"
done < <(printf '%s' "$cmd" | awk 'BEGIN{RS="[;&|]"} {print}')

if [ "$blocked" -eq 1 ]; then
  cat >&2 <<'MSG'
Blocked: `git push` refspec targets main/master.

Use the worktree + PR flow:

  git fetch origin main
  git worktree add .worktrees/<branch> -b <branch> origin/main
  cd .worktrees/<branch>
  # edits + commits
  git push -u origin <branch>
  gh pr create

Branch policy: AGENTS.md § Branch policy
Full rules: agent_docs/workflows/contributing.md
MSG
  exit 2
fi

exit 0
