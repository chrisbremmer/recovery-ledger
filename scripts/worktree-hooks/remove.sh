#!/usr/bin/env bash
# Claude Code WorktreeRemove hook.
#
# Stdin: JSON with { worktree_path, branch, isolation_id, cwd, ... }.
# Exit code is ignored by the harness, so this script is "best effort":
# remove the worktree, delete the branch, log any residual on stderr.
#
# Pairs with scripts/worktree-hooks/create.sh.
set -uo pipefail

command -v jq >/dev/null 2>&1 || {
  echo "worktree-hooks/remove: jq not installed; skipping cleanup" >&2
  exit 0
}

input=$(cat)
worktree_path=$(printf '%s' "$input" | jq -r '.worktree_path // ""')
branch=$(printf '%s' "$input" | jq -r '.branch // ""')
cwd=$(printf '%s' "$input" | jq -r '.cwd // ""')

[ -n "$cwd" ] && cd "$cwd" || exit 0

if [ -n "$worktree_path" ]; then
  if ! git worktree remove "$worktree_path" --force >/dev/null 2>&1; then
    if [ -d "$worktree_path" ]; then
      rm -rf "$worktree_path" || echo "worktree-hooks/remove: could not remove $worktree_path" >&2
    fi
  fi
fi

if [ -n "$branch" ]; then
  git branch -D "$branch" >/dev/null 2>&1 || true
fi

git worktree prune >/dev/null 2>&1 || true

exit 0
