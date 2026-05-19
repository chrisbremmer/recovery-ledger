// MCP-05 / D-27 / D-36 — messages-array contract for every registered MCP
// prompt.
//
// Each Phase 4 prompt returns exactly one user-role message with
// text-type content (D-27). Wave 0 (Plan 04-01) ships the scaffold —
// Plan 04-12 (MCP prompts wave) fills the describe.each loop over the 4
// registered prompts.

import { describe, it } from 'vitest';

describe('Phase 4 MCP prompt messages-array contract — MCP-05', () => {
  it.todo(
    'every registered MCP prompt (whoop_daily_decision_brief, whoop_weekly_recovery_investigation, whoop_experiment_designer, whoop_deload_or_train) returns {messages: [{role: "user", content: {type: "text", text: string}}]} — D-27 (exactly one user-role message) + 04-RESEARCH.md §registerPrompt',
  );

  it.todo(
    'D-36 attestation: every prompt went through src/mcp/register-prompt.ts (Gate J covers static enforcement; this runtime check inspects a thrown-handler fixture and asserts isError:true)',
  );

  it.todo('prompts.length === 4 with the canonical name set per the D-29 attestation update');
});

// MCP-05 surface name `messages` is referenced inside the describe block
// + it.todo descriptions above — anchored in prose so static reviewers
// can grep this file by purpose (Biome's noExportsInTest rule forbids
// exports from *.test.ts).
