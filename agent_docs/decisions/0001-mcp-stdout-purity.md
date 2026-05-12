# 0001. MCP stdout purity

- **Status:** Accepted
- **Date:** 2026-05-12
- **Decider(s):** CB

## Context

Recovery Ledger ships an MCP server that speaks JSON-RPC over stdio. The
protocol assumes stdout is a clean stream of JSON-RPC frames. Any
non-protocol bytes on stdout — a stray `console.log`, a Pino target
misconfigured, a library that prints a banner — corrupts the frame the
client is parsing and breaks every connected client until the process
restarts.

The CLI and MCP server share code through `src/services/`, `src/domain/`,
`src/infrastructure/`, and `src/formatters/`. Anything reachable from
`src/mcp/` therefore has to honour the same constraint, even if it's also
used from `src/cli/` (where stdout is for humans).

## Decision

**Code reachable from `src/mcp/` — directly or transitively — must never
write to stdout.** Logging goes through Pino, configured to write to
stderr only. Every `console.*` method (`log`, `error`, `warn`, `info`,
`debug`, `trace`) — and `process.stdout.write` — are forbidden in
`src/mcp/`, `src/services/`, `src/domain/`, `src/infrastructure/`, and
`src/formatters/`. CLI-only
output (human-facing tables, progress) is restricted to `src/cli/` and
must not be imported back into shared code.

## Consequences

- One Pino logger, one transport (stderr), one configuration. Multiple
  loggers are not allowed.
- The MCP server can be smoke-tested with `npx @modelcontextprotocol/inspector`
  without log noise corrupting the inspector's parser.
- CLI surfaces that want pretty output handle formatting locally in
  `src/cli/`. The `src/formatters/` module returns structured strings;
  it does not print.

## Alternatives considered

- **Multi-transport logger.** Pino → stdout for CLI, stderr for MCP,
  toggled by env var. Rejected: every shared call site would need to
  know which transport is active, and a single mistake breaks MCP
  silently.
- **Discipline via review only.** Rejected: the failure is silent and
  the bytes already shipped; a CI gate has to catch it before merge.

## Enforcement

- Biome rule banning `console.*` in the named directories (lands with
  Phase 1).
- CI grep assertion as defence in depth.
- Claude Code PreToolUse hook in
  [`.claude/settings.json`](../../.claude/settings.json) refuses Edit /
  Write operations that introduce `console.*` into MCP-reachable paths.

## Cross-references

- [`../workflows/debugging.md`](../workflows/debugging.md) — "MCP stdio
  corruption" runbook entry
- [`../../.planning/research/ARCHITECTURE.md`](../../.planning/research/ARCHITECTURE.md)
  — module layout
- [`../conventions.md`](../conventions.md) — module rules
