// `whoop_review_decisions` MCP tool — D-21 dual-mode shim over
// `services.reviewDecisions` per Plan 04-10 Task 1 + 04-PATTERNS.md
// §Shared Pattern 9.
//
// Single tool serves both list + update flows. The branch is on the
// presence of `mode === 'update'` in the input — D-21 holds the MCP-01
// tool count at exactly 8 (a `whoop_update_decision` sibling would ship
// the 9th and break the lock).
//
// MCP-02 dual-shape: list mode renders via renderDecisionList (table
// form); update mode renders via renderDecisionUpdate (new-state
// detail). Both paths produce a discriminated-union ReviewDecisionsResult
// that round-trips through `structuredContent`.

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { renderDecisionList, renderDecisionUpdate } from '../../formatters/decision.txt.js';
import type {
  ReviewDecisionsInput,
  ReviewDecisionsResult,
  Services,
} from '../../services/index.js';
import { register } from '../register.js';

function toStructuredContent(r: ReviewDecisionsResult): { [k: string]: unknown } {
  return JSON.parse(JSON.stringify(r)) as { [k: string]: unknown };
}

function renderResult(r: ReviewDecisionsResult): string {
  return r.mode === 'list'
    ? renderDecisionList(r.decisions, new Date())
    : renderDecisionUpdate(r.decision);
}

// D-21 dual-mode: discriminator on optional `mode` literal. List mode
// defaults (`mode` omitted or 'list'); update mode requires `mode:
// 'update'` + `id` + `status`. The two-arm `z.union` is the right tool
// (not `discriminatedUnion`) because the 'list' arm makes the
// discriminator optional.
const REVIEW_DECISIONS_INPUT = z.union([
  z.object({ mode: z.literal('list').optional(), includeAll: z.boolean().optional() }),
  z.object({
    mode: z.literal('update'),
    id: z.string(),
    status: z.enum(['open', 'followed_up', 'abandoned']),
    notes: z.string().nullable().optional(),
  }),
]);

const TOOL_DESCRIPTION =
  'List open decisions (default) or update a decision (mode=update with id/status). Use includeAll=true to list every decision including followed_up/abandoned.';

function normalizeInput(input: z.infer<typeof REVIEW_DECISIONS_INPUT>): ReviewDecisionsInput {
  if ('mode' in input && input.mode === 'update') {
    return { mode: 'update', id: input.id, status: input.status, notes: input.notes ?? null };
  }
  // List mode: include `includeAll` only when defined (exactOptionalPropertyTypes
  // refuses an explicit `undefined` value in the optional slot).
  if ('includeAll' in input && input.includeAll !== undefined) {
    return { mode: 'list', includeAll: input.includeAll };
  }
  return { mode: 'list' };
}

export function registerWhoopReviewDecisions(server: McpServer, services: Services): void {
  register(
    server,
    'whoop_review_decisions',
    { description: TOOL_DESCRIPTION, inputSchema: { input: REVIEW_DECISIONS_INPUT } },
    async ({ input }) => {
      const result = await services.reviewDecisions(normalizeInput(input));
      return {
        content: [{ type: 'text', text: renderResult(result) }],
        structuredContent: toStructuredContent(result),
      };
    },
  );
}
