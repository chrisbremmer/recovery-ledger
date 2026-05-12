#!/usr/bin/env bash
# PreToolUse hook for Bash. Refuses git invocations that bypass hooks or
# GPG signing. Fix the underlying failure instead — these flags exist for
# emergency user use, not for the agent.
#
# Scoped to git commands only (the command's first token, or the token
# after a leading `sudo`/`time`/`env`, must be `git`). This prevents
# false-positives on commit messages that mention `--no-verify` in a
# `-m` body, on docs that reference the flags, on grep/sed against
# strings containing the flag.
set -euo pipefail

command -v jq >/dev/null 2>&1 || {
  echo "guard-hook-bypass: jq not installed; allowing tool call. Install jq to enable this guard." >&2
  exit 0
}

input=$(cat)
cmd=$(printf '%s' "$input" | jq -r '.tool_input.command // ""')

# For each segment (split on ; && || |), determine if the first non-prefix
# word is `git`. If yes, check the segment for bypass flags. Prefix words
# we tolerate: sudo, time, env, command, exec, builtin.
is_git_command() {
  local seg="$1"
  local first
  # shellcheck disable=SC2086
  set -- $seg
  while [ $# -gt 0 ]; do
    first="$1"
    case "$first" in
      sudo|time|env|command|exec|builtin) shift ;;
      git) return 0 ;;
      *) return 1 ;;
    esac
  done
  return 1
}

check_bypass() {
  local seg="$1"
  # Strip "double-quoted" and 'single-quoted' substrings so flags
  # mentioned inside a `-m "message"` body don't trigger.
  seg=$(printf '%s' "$seg" | sed -E 's/"[^"]*"//g; s/'\''[^'\'']*'\''//g')

  # --no-verify
  if printf '%s' "$seg" | grep -qE '(^|[^A-Za-z0-9_-])--no-verify($|[^A-Za-z0-9_-])'; then
    cat >&2 <<'MSG'
Blocked: --no-verify bypasses pre-commit/pre-push hooks.

If a hook is failing, fix the underlying issue. The bypass flag is
reserved for explicit user authorization, not the agent.

See agent_docs/workflows/contributing.md § Hook bypass and destructive operations.
MSG
    return 2
  fi

  # GPG signing bypasses
  if printf '%s' "$seg" | grep -qE '(^|[^A-Za-z0-9_-])(--no-gpg-sign|--gpg-sign=(false|no|0))($|[^A-Za-z0-9_-])'; then
    cat >&2 <<'MSG'
Blocked: do not bypass GPG signing.

If signing is misconfigured, fix the git config (or ask the user) — the
agent does not skip signatures.
MSG
    return 2
  fi

  if printf '%s' "$seg" | grep -qE -- '-c[[:space:]]+commit\.gpgsign=(false|no|0)\b'; then
    cat >&2 <<'MSG'
Blocked: `-c commit.gpgsign=...` overrides signing config.

Fix the git config (or ask the user) — the agent does not skip signatures.
MSG
    return 2
  fi

  if printf '%s' "$seg" | grep -qE -- '-c[[:space:]]+core\.hooksPath=(/dev/null|""|"")'; then
    cat >&2 <<'MSG'
Blocked: `-c core.hooksPath=/dev/null` disables all git hooks for this command.

If a hook is failing, fix the underlying issue.
MSG
    return 2
  fi

  return 0
}

# Iterate over each segment.
exit_code=0
while IFS= read -r segment; do
  [ -z "$segment" ] && continue
  if is_git_command "$segment"; then
    if ! check_bypass "$segment"; then
      exit_code=2
      break
    fi
  fi
done < <(printf '%s' "$cmd" | awk 'BEGIN{RS="[;]|&&|\\|\\||\\|"} {print}')

exit "$exit_code"
