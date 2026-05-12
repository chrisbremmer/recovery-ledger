#!/usr/bin/env bash
# Claude Code WorktreeCreate hook.
#
# Stdin: JSON with { branch, base_path, isolation_id, cwd, ... }.
# Stdout (success): absolute path to the created worktree.
# Exit 0 on success; any non-zero exit aborts agent worktree creation.
#
# Why this exists: the harness can't always autodetect a git repo (e.g. when
# Claude Code is launched under cmux), so its built-in `git worktree add`
# pathway short-circuits with "not in a git repository." This hook performs
# the equivalent setup itself and hands the resulting path back to the
# harness so agent isolation actually works.
#
# Branch is forked from the *current* HEAD of the orchestrator checkout.
# That matches the EXPECTED_BASE assertion the orchestrator uses to verify
# the worktree was forked from the right commit before it lets the executor
# touch anything.
set -euo pipefail

command -v jq >/dev/null 2>&1 || {
  echo "worktree-hooks/create: jq not installed" >&2
  exit 1
}

input=$(cat)
branch=$(printf '%s' "$input" | jq -r '.branch // ""')
base_path=$(printf '%s' "$input" | jq -r '.base_path // ""')
cwd=$(printf '%s' "$input" | jq -r '.cwd // ""')

if [ -z "$branch" ] || [ -z "$base_path" ] || [ -z "$cwd" ]; then
  echo "worktree-hooks/create: missing required fields (branch=$branch base_path=$base_path cwd=$cwd)" >&2
  exit 1
fi

# Sanitize the branch into a path-safe leaf so multiple isolation_ids
# coexist under the same base_path without collisions.
safe_branch=$(printf '%s' "$branch" | tr '/' '-' | tr ' :' '--')
worktree_path="$base_path/$safe_branch"

mkdir -p "$base_path"

cd "$cwd"

# Refuse to fork off a protected ref so the executor's own HEAD assertion
# isn't the only line of defense.
head_branch=$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "")
case "$head_branch" in
  main|master|develop|trunk|release/*)
    echo "worktree-hooks/create: refusing to fork worktree from protected branch '$head_branch'" >&2
    exit 1
    ;;
esac

# Avoid colliding with an existing worktree directory from a previous run.
if [ -e "$worktree_path" ]; then
  # If git considers the existing path a worktree, reuse it; otherwise blow up.
  if git worktree list --porcelain | awk -v p="$worktree_path" '$1=="worktree" && $2==p { found=1 } END { exit found?0:1 }'; then
    printf '%s\n' "$worktree_path"
    exit 0
  fi
  echo "worktree-hooks/create: $worktree_path exists but is not a registered worktree" >&2
  exit 1
fi

# Create branch-and-worktree atomically. Fork from HEAD so the orchestrator's
# EXPECTED_BASE matches the worktree starting commit.
if ! git worktree add -b "$branch" "$worktree_path" HEAD >/dev/null 2>&1; then
  # Branch might already exist (rare, but possible on retry); reuse it.
  if ! git worktree add "$worktree_path" "$branch" >/dev/null 2>&1; then
    echo "worktree-hooks/create: failed to create worktree at $worktree_path on branch $branch" >&2
    exit 1
  fi
fi

printf '%s\n' "$worktree_path"
exit 0
