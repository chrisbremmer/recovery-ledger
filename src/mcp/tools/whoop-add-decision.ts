// `whoop_add_decision` MCP tool — ≤5-line shim over `services.addDecision`
// per Plan 04-10 Task 1 + 04-PATTERNS.md §Shared Pattern 9 + D-19.
//
// MCP-02 dual-shape: rendered single-decision detail in `content[0]`
// (via renderDecisionDetail) + the full Decision row in
// `structuredContent`. D-19 smart defaults are applied by the service —
// the schema only requires `decision`; every other field is optional.

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { renderDecisionDetail } from '../../formatters/decision.txt.js';
import type { Services } from '../../services/index.js';
import { register } from '../register.js';
import { toStructuredContent } from './utils.js';

const TOOL_DESCRIPTION =
  'Record a decision in the decision ledger. Required: decision text. Optional: category, rationale, confidence (low/medium/high), expectedEffect, followUpDate (ISO yyyy-mm-dd).';

// Review #34: hoist the Zod shape so its inferred type is the single
// source of truth for the handler input. Review #48: cap free-text fields
// so an over-large agent payload is rejected at the boundary instead of
// pushed to the DB.
const ADD_DECISION_SHAPE = {
  decision: z.string().min(1).max(500),
  category: z.string().max(100).optional(),
  rationale: z.string().max(2000).nullable().optional(),
  confidence: z.enum(['low', 'medium', 'high']).nullable().optional(),
  expectedEffect: z.string().max(500).nullable().optional(),
  followUpDate: z.string().optional(),
};
type AddDecisionInput = z.infer<z.ZodObject<typeof ADD_DECISION_SHAPE>>;

export function registerWhoopAddDecision(server: McpServer, services: Services): void {
  register(
    server,
    'whoop_add_decision',
    { description: TOOL_DESCRIPTION, inputSchema: ADD_DECISION_SHAPE },
    async (input) => {
      const i = input as AddDecisionInput;
      const created = await services.addDecision(i as Parameters<Services['addDecision']>[0]);
      return {
        content: [{ type: 'text', text: renderDecisionDetail(created) }],
        structuredContent: toStructuredContent(created),
      };
    },
  );
}
