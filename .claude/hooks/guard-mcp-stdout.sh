#!/usr/bin/env bash
# PreToolUse hook for Edit / Write / NotebookEdit. Refuses any change that
# introduces console.* (log, error, warn, info, debug, trace) into code
# reachable from the MCP server — that corrupts JSON-RPC stdout.
#
# Scoped to src/{mcp,services,domain,infrastructure,formatters}/. Code
# under src/cli/ is allowed to use stdout freely.
#
# Rationale: agent_docs/decisions/0001-mcp-stdout-purity.md
set -euo pipefail

input=$(cat)
tool=$(printf '%s' "$input" | jq -r '.tool_name // ""')
file=$(printf '%s' "$input" | jq -r '.tool_input.file_path // ""')

# Only inspect file-writing tools.
case "$tool" in
  Edit|Write|NotebookEdit) ;;
  *) exit 0 ;;
esac

# Only inspect MCP-reachable source paths.
case "$file" in
  */src/mcp/*|*/src/services/*|*/src/domain/*|*/src/infrastructure/*|*/src/formatters/*) ;;
  *) exit 0 ;;
esac

# Pull the candidate new content out of the input. Edit uses new_string,
# Write uses content. NotebookEdit uses new_source.
new=$(printf '%s' "$input" | jq -r '.tool_input.new_string // .tool_input.content // .tool_input.new_source // ""')

if printf '%s' "$new" | grep -qE '\bconsole\.(log|error|warn|info|debug|trace)[[:space:]]*\('; then
  cat >&2 <<MSG
Blocked: console.* in MCP-reachable code corrupts JSON-RPC stdout.

File: $file

The MCP server speaks JSON-RPC on stdout. Any stray write to stdout
breaks every connected client. Use Pino → stderr instead.

See: agent_docs/decisions/0001-mcp-stdout-purity.md

If this is a false positive (e.g. console.* inside a string literal or
a comment), restructure the edit so the literal lives in a constant, or
ask the user to authorize a one-off bypass.
MSG
  exit 2
fi

exit 0
