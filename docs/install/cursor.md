# Cursor — Recovery Ledger MCP Setup

Verified against Cursor docs as of 2026-05-26.

## Prerequisites

- Recovery Ledger installed and built (`npm install && npm run build`) per [INSTALL.md](../../INSTALL.md).
- `recovery-ledger init` and `recovery-ledger auth` complete. Verify with `node dist/cli.mjs doctor` — every check should be `pass` or a documented warning.

## Manual config

Cursor reads MCP config from one of two locations:

- `.cursor/mcp.json` at the repo root (project-scoped; commit-worthy) — wins over the global file.
- `~/.cursor/mcp.json` (global, applies to every project).

Use the same `mcpServers` shape as the other clients:

```json
{
  "mcpServers": {
    "recovery-ledger": {
      "command": "node",
      "args": ["/absolute/path/to/dist/mcp.mjs"]
    }
  }
}
```

Replace `/absolute/path/to/dist/mcp.mjs` with the result of `realpath dist/mcp.mjs` from the recovery-ledger repo root.

January 2026 note: Cursor's January 2026 update changed how multiple MCP servers are dispatched (dynamic tool-description loading). The config shape is unchanged.

V2-01-deferral note: Cursor v1 had some MCP compatibility caveats. If you hit a regression, fall back to using Recovery Ledger through Claude Code or Claude Desktop while we track V2-01.

## Verifying

Reload Cursor (or restart it). Confirm `recovery-ledger` appears in the MCP server list with 8 tools. Try the `whoop_doctor` tool; the response should list 14 checks.

## Troubleshooting

If the server does not appear, confirm `dist/mcp.mjs` exists (run `npm run build`) and that the JSON config parses. If a tool fails on invocation, run `node dist/cli.mjs doctor --text` to see which check is failing. Cross-reference [`docs/install/troubleshooting.md`](troubleshooting.md).

Reference: [Cursor MCP docs](https://cursor.com/docs/mcp).
