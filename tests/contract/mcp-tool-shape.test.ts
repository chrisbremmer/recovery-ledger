// MCP-02 / D-29 — dual-shape contract for every registered MCP tool.
//
// Every Phase 4 tool MUST return both `content: Array<{type, text}>` and
// `structuredContent: object` per ARCHITECTURE.md MCP-02 + 04-RESEARCH.md
// §MCP-02. The shape contract catches a future tool that forgets one slot.
//
// Wave 0 (Plan 04-01) ships the scaffold — Plan 04-11 (MCP tools wave)
// fills the describe.each loop over the 8 registered tools.

import { describe, it } from 'vitest';

describe('Phase 4 MCP tool dual-shape contract — MCP-02', () => {
  it.todo(
    'every registered MCP tool returns {content: Array<{type:"text", text:string}>, structuredContent: object} (Wave 4 — tools/list contains 8 names; iterate each tools/call response)',
  );

  it.todo(
    'D-29 attestation: tools.length === 8 with the canonical name set (whoop_doctor + whoop_sync + whoop_daily_review + whoop_weekly_review + whoop_query_cache + whoop_add_decision + whoop_review_decisions + whoop_api_gap)',
  );
});

// MCP-02 surface name `structuredContent` is referenced inside the
// describe block + it.todo descriptions above — anchored in prose so
// static reviewers can grep this file by purpose without needing an
// export (Biome's noExportsInTest rule forbids exports from *.test.ts).
