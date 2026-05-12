#!/usr/bin/env bash
# PreToolUse hook for Bash. Refuses git invocations that bypass hooks or
# GPG signing. Fix the underlying failure instead — these flags exist for
# emergency user use, not for the agent.
set -euo pipefail

input=$(cat)
cmd=$(printf '%s' "$input" | jq -r '.tool_input.command // ""')

# --no-verify: skips pre-commit / pre-push hooks
if printf '%s' "$cmd" | grep -qE '(^|[[:space:]])--no-verify\b'; then
  cat >&2 <<'MSG'
Blocked: --no-verify bypasses pre-commit/pre-push hooks.

If a hook is failing, fix the underlying issue. The bypass flag is
reserved for explicit user authorization, not the agent.

See agent_docs/workflows/contributing.md § Hook bypass and destructive operations.
MSG
  exit 2
fi

# --no-gpg-sign / -c commit.gpgsign=false: skips signing
if printf '%s' "$cmd" | grep -qE '(^|[[:space:]])(--no-gpg-sign\b|-c[[:space:]]+commit\.gpgsign=false\b)'; then
  cat >&2 <<'MSG'
Blocked: do not bypass GPG signing.

If signing is misconfigured, fix the git config (or ask the user) — the
agent does not skip signatures.
MSG
  exit 2
fi

exit 0
