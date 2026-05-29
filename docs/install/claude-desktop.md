# Claude Desktop — Recovery Ledger MCP Setup

Verified against Claude Desktop docs as of 2026-05-26.

## Prerequisites

- Recovery Ledger installed and built (`npm install && npm run build`) per [INSTALL.md](../../INSTALL.md).
- `recovery-ledger init` and `recovery-ledger auth` complete. Verify with `node dist/cli.mjs doctor` — every check should be `pass` or a documented warning.

## Manual config

Claude Desktop is configured through a JSON file (there is no `claude mcp add` one-liner for Desktop). Edit the config file for your platform:

- macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`
- Windows: `%APPDATA%\Claude\claude_desktop_config.json` (this project is macOS-first; Windows support is tracked as a Phase 5+ deferral)

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

Replace `/absolute/path/to/dist/mcp.mjs` with the result of `realpath dist/mcp.mjs` from the recovery-ledger repo root. Restart Claude Desktop after editing — its reload semantics differ from Claude Code, which picks up `.mcp.json` per project.

2026 note: Desktop Extensions (`.mcpb`) bundles are an alternative we may ship in v2 (V2-01-adjacent); for v1 use the JSON config approach above.

## Verifying

Restart Claude Desktop. Confirm `recovery-ledger` appears in the MCP server list with 8 tools. Try the `whoop_doctor` tool; the response should list 14 checks.

## Troubleshooting

If the server does not appear, confirm `dist/mcp.mjs` exists (run `npm run build`) and that the JSON config parses (no trailing commas). If a tool fails on invocation, run `node dist/cli.mjs doctor --text` to see which check is failing. Cross-reference [`docs/install/troubleshooting.md`](troubleshooting.md).

Reference: [Claude Desktop MCP quickstart](https://modelcontextprotocol.io/quickstart/user).
