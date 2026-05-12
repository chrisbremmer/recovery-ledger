#!/usr/bin/env bash
# PreToolUse hook for Edit / Write / MultiEdit / NotebookEdit. Refuses
# changes to .claude/settings.json and .claude/hooks/** without explicit
# user authorization.
#
# Why: the hooks defend the project. An agent that can silently edit
# .claude/settings.json or a hook script can disable every other guard
# in this directory. Self-protection closes that one-Edit-disables-the-
# chain hole (review finding #4 / P0).
#
# Bypass: the user can either (a) edit these files manually outside the
# agent session, or (b) authorize the agent in conversation, after which
# the agent should re-attempt the edit. There is no silent bypass.
set -euo pipefail

command -v jq >/dev/null 2>&1 || {
  echo "guard-settings-edit: jq not installed; allowing tool call. Install jq to enable this guard." >&2
  exit 0
}

input=$(cat)
tool=$(printf '%s' "$input" | jq -r '.tool_name // ""')
file=$(printf '%s' "$input" | jq -r '.tool_input.file_path // ""')

case "$tool" in
  Edit|Write|MultiEdit|NotebookEdit) ;;
  *) exit 0 ;;
esac

file_norm="${file#./}"

case "$file_norm" in
  */.claude/settings.json|.claude/settings.json) ;;
  */.claude/hooks/*.sh|.claude/hooks/*.sh) ;;
  *) exit 0 ;;
esac

cat >&2 <<MSG
Blocked: this edit targets the hook configuration itself.

File: $file
Tool: $tool

.claude/settings.json and .claude/hooks/** are the project's defense in
depth. The agent does not silently edit them.

If the change is intentional (adding a new guard, refining a regex,
updating the plugin pin):

  1. Ask the user to confirm in conversation.
  2. The user authorizes by saying "edit the hook" or similar.
  3. Re-attempt the Edit / Write — the user's authorization is recorded
     in the conversation and this hook can be bypassed by checking out
     the worktree and editing manually if the agent block persists.

If you arrived here unintentionally: investigate why the edit was
proposed. A renamed-file refactor that swept this directory is usually
a planning bug, not a real intent.
MSG
exit 2
