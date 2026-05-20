// `whoop_add_decision` MCP tool — ≤5-line shim over `services.addDecision`
// per Plan 04-10 Task 1 + 04-PATTERNS.md §Shared Pattern 9 + D-19.
//
// MCP-02 dual-shape: rendered single-decision detail in `content[0]`
// (via renderDecisionDetail) + the full Decision row in
// `structuredContent`. D-19 smart defaults are applied by the service —
// the schema only requires `decision`; every other field is optional.

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { Decision } from '../../domain/types/entities.js';
import { renderDecisionDetail } from '../../formatters/decision.txt.js';
import type { Services } from '../../services/index.js';
import { register } from '../register.js';

function toStructuredContent(d: Decision): { [k: string]: unknown } {
  return JSON.parse(JSON.stringify(d)) as { [k: string]: unknown };
}

const TOOL_DESCRIPTION =
  'Record a decision in the decision ledger. Required: decision text. Optional: category, rationale, confidence (low/medium/high), expectedEffect, followUpDate (ISO yyyy-mm-dd).';

export function registerWhoopAddDecision(server: McpServer, services: Services): void {
  register(
    server,
    'whoop_add_decision',
    {
      description: TOOL_DESCRIPTION,
      inputSchema: {
        decision: z.string(),
        category: z.string().optional(),
        rationale: z.string().nullable().optional(),
        confidence: z.enum(['low', 'medium', 'high']).nullable().optional(),
        expectedEffect: z.string().nullable().optional(),
        followUpDate: z.string().optional(),
      },
    },
    async (input) => {
      const created = await services.addDecision(input as Parameters<Services['addDecision']>[0]);
      return {
        content: [{ type: 'text', text: renderDecisionDetail(created) }],
        structuredContent: toStructuredContent(created),
      };
    },
  );
}
