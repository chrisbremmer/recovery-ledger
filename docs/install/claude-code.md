# Claude Code — Recovery Ledger MCP Setup

Verified against Claude Code docs as of 2026-05-26.

## Prerequisites

- Recovery Ledger installed and built (`npm install && npm run build`) per [INSTALL.md](../../INSTALL.md).
- `recovery-ledger init` and `recovery-ledger auth` complete. Verify with `node dist/cli.mjs doctor` — every check should be `pass` or a documented warning.

## One-liner setup

```sh
claude mcp add recovery-ledger -- node /absolute/path/to/dist/mcp.mjs
```

Replace `/absolute/path/to/dist/mcp.mjs` with the result of `realpath dist/mcp.mjs` from the recovery-ledger repo root. The CLI writes the entry into `.mcp.json` for you.

## Manual config

For users who prefer hand-editing: Claude Code reads project-shared config from `.mcp.json` at the repo root, and user-scoped config from `~/.claude.json`. Either file uses the same shape:

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

## Verifying

Open Claude Code. Type `/mcp` and confirm `recovery-ledger` appears with 8 tools. Try the `whoop_doctor` tool; the response should list 14 checks.

## Troubleshooting

If the tool list is empty, confirm `dist/mcp.mjs` exists (run `npm run build`). If a tool fails on invocation, run `node dist/cli.mjs doctor --text` to see which check is failing. Cross-reference [`docs/install/troubleshooting.md`](troubleshooting.md).

Reference: [Claude Code MCP docs](https://code.claude.com/docs/en/mcp).
