#!/usr/bin/env bash
# PreToolUse hook for Edit / Write / MultiEdit / NotebookEdit. Refuses
# any change that introduces stdout writes into code reachable from the
# MCP server — that corrupts JSON-RPC stdout.
#
# Scoped to src/{mcp,services,domain,infrastructure,formatters}/, excluding
# .test.ts files. Code under src/cli/ is allowed to use stdout freely.
# Matched stdout writes:
#   - console.<any method>(  — log, error, warn, info, debug, trace, dir,
#     table, group, etc.
#   - process.stdout.write(
#
# Rationale: agent_docs/decisions/0001-mcp-stdout-purity.md
#
# Known limitations:
#   - Pure text match: a `console.log(` inside a string literal or comment
#     will false-positive. Restructure the literal (extract to a constant)
#     or ask for user authorization to bypass.
#   - Bash file writes (cat > file, sed -i) are NOT matched. Phase 1's
#     Biome rule + CI grep are the canonical enforcement; this hook is
#     defense in depth for the Edit/Write/MultiEdit path.
set -euo pipefail

command -v jq >/dev/null 2>&1 || {
  echo "guard-mcp-stdout: jq not installed; allowing tool call. Install jq to enable this guard." >&2
  exit 0
}

input=$(cat)
tool=$(printf '%s' "$input" | jq -r '.tool_name // ""')
file=$(printf '%s' "$input" | jq -r '.tool_input.file_path // ""')

case "$tool" in
  Edit|Write|MultiEdit|NotebookEdit) ;;
  *) exit 0 ;;
esac

# Normalize the file path: drop leading "./", treat as absolute against
# repo-relative match. We match both absolute paths (containing /src/...)
# and bare relative paths (src/...).
file_norm="${file#./}"

# Test files are exempt — colocated *.test.ts may use console.* for
# legitimate debug output and aren't part of the MCP runtime surface.
case "$file_norm" in
  *.test.ts|*.test.tsx|*.spec.ts|*.spec.tsx) exit 0 ;;
esac

# Match MCP-reachable paths in either absolute (*/src/...) or relative
# (src/...) form.
in_scope=0
case "$file_norm" in
  */src/mcp/*|*/src/services/*|*/src/domain/*|*/src/infrastructure/*|*/src/formatters/*) in_scope=1 ;;
  src/mcp/*|src/services/*|src/domain/*|src/infrastructure/*|src/formatters/*) in_scope=1 ;;
esac
[ "$in_scope" -eq 1 ] || exit 0

# Pull the candidate new content out. Edit uses new_string, Write uses
# content, NotebookEdit uses new_source, MultiEdit packs N edits into
# tool_input.edits[*].new_string — concatenate them.
new=$(printf '%s' "$input" | jq -r '
  .tool_input.new_string //
  .tool_input.content //
  .tool_input.new_source //
  (.tool_input.edits // [] | map(.new_string // "") | join("\n"))
  // ""')

# Match any console.<method>( or process.stdout.write(.
if printf '%s' "$new" | grep -qE '(\bconsole\.[a-zA-Z_]+|\bprocess\.stdout\.write)[[:space:]]*\('; then
  cat >&2 <<MSG
Blocked: stdout write in MCP-reachable code corrupts JSON-RPC stdout.

File: $file
Tool: $tool

The MCP server speaks JSON-RPC on stdout. Any stray write to stdout
breaks every connected client. Use Pino → stderr instead.

See: agent_docs/decisions/0001-mcp-stdout-purity.md

If this is a false positive (console.* inside a string literal or
comment), extract the literal into a constant so the substring is
unambiguous, or ask the user to authorize a one-off bypass.
MSG
  exit 2
fi

exit 0
