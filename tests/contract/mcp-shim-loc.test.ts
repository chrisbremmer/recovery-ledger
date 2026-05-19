// MCP-03 — ≤5-line shim discipline for every src/mcp/tools/*.ts handler.
//
// Per agent_docs/conventions.md §Module layout and CLAUDE.md, MCP tool
// modules must be ≤5-line shims over the services layer. This contract
// test parses each tool file's `register(...)` body and counts non-blank
// non-comment statements — Plan 04-11 (MCP tools wave) fills in the
// AST/regex implementation. Wave 0 (Plan 04-01) ships the scaffold only.

import { describe, it } from 'vitest';

describe('Phase 4 MCP tool shim LOC contract — MCP-03', () => {
  it.todo(
    'every src/mcp/tools/*.ts file has a register() handler body of 5 or fewer non-blank non-comment statements (per the lite-hexagonal discipline — transport code is a shim over services orchestration)',
  );

  it.todo(
    'every src/mcp/resources/*.ts handler body is similarly ≤5 lines (extends MCP-03 to the Phase 4 resource surface; same shim discipline as tools)',
  );

  it.todo(
    'every src/mcp/prompts/*.ts handler body is similarly ≤5 lines (extends MCP-03 to the Phase 4 prompt surface)',
  );
});

// The MCP-03 LOC ceiling is 5 lines. The literal `5` is anchored in the
// it.todo descriptions above so static reviewers can grep this file by
// purpose (Biome's noExportsInTest rule forbids exports from *.test.ts).
