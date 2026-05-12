#!/usr/bin/env bash
# PreToolUse hook for Bash. Refuses obvious `git push` refspecs that
# resolve to main/master. Branch protection on `main` is the actual
# fence; this hook is a cheap first-line guard that catches the
# straightforward mistakes before they reach git.
#
# Scope (matched and refused):
#   - explicit refspec: `git push origin main` / `master` / quoted forms
#   - destination side: `*:main`, `*:master`, `*:refs/heads/main`,
#     `*:refs/heads/master`
#   - bare ref: `refs/heads/main`, `refs/heads/master`
#   - force refspec: leading `+` is stripped before matching
#   - --all, --mirror (push all branches including main)
#   - chained commands (split on `;`, `&&`, `||`, `|`)
#   - comments (`#`) and backslash-newline continuations are stripped
#     before tokenization
#
# Out of scope (relies on branch protection):
#   - shell indirection: `sh -c "git push origin main"`, `eval "..."`,
#     `$(...)`, `bash -c ...`
#   - bare `git push` whose upstream tracks main
#
# See agent_docs/workflows/contributing.md.
set -euo pipefail

command -v jq >/dev/null 2>&1 || {
  echo "guard-git-push-main: jq not installed; allowing tool call. Install jq to enable this guard." >&2
  exit 0
}

input=$(cat)
cmd=$(printf '%s' "$input" | jq -r '.tool_input.command // ""')

# Normalize: strip backslash-newline continuations and # comments per
# segment, fold all whitespace (incl. newlines) to single spaces so the
# awk tokenizer sees one logical line per segment.
normalize() {
  printf '%s' "$1" \
    | sed -E 's/\\$//;s/#.*$//' \
    | tr '\n\r\t\v\f' '     ' \
    | tr -s ' '
}

# Test a single push-args list (whitespace-separated tokens after
# `git push`) and return 0 if main/master is targeted.
push_targets_main() {
  local args="$1"
  local tok
  for tok in $args; do
    # Strip surrounding single/double quotes
    tok="${tok#\"}"; tok="${tok%\"}"
    tok="${tok#\'}"; tok="${tok%\'}"
    # Strip leading '+' (force-push refspec marker)
    tok="${tok#+}"
    # Strip leading ':' (deletion refspec marker for legacy git)
    tok="${tok#:}"
    case "$tok" in
      --all|--mirror)
        return 0
        ;;
      main|master|refs/heads/main|refs/heads/master)
        return 0
        ;;
      *:main|*:master|*:refs/heads/main|*:refs/heads/master)
        return 0
        ;;
    esac
  done
  return 1
}

# Walk each segment of the command (split on ; && || |). For each segment,
# find the first `git push` and extract the args after it.
normalized=$(normalize "$cmd")
blocked=0
while IFS= read -r segment; do
  push_args=$(printf '%s' "$segment" | awk '
    {
      for (i = 1; i <= NF; i++) {
        if ($i == "git" && $(i+1) == "push") {
          for (j = i + 2; j <= NF; j++) printf "%s ", $j
          exit
        }
      }
    }
  ')
  [ -z "$push_args" ] && continue
  if push_targets_main "$push_args"; then
    blocked=1
    break
  fi
done < <(printf '%s' "$normalized" | awk 'BEGIN{RS="[;]|&&|\\|\\||\\|"} {print}')

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

Note: this hook is best-effort. Branch protection on `main` (GitHub) is
the actual fence and catches shell indirection (sh -c, eval) that this
hook does not see.
MSG
  exit 2
fi

exit 0
