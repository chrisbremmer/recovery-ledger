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
import { toStructuredContent } from './utils.js';

function renderResult(r: ReviewDecisionsResult): string {
  return r.mode === 'list'
    ? renderDecisionList(r.decisions, new Date())
    : renderDecisionUpdate(r.decision);
}

// D-21 dual-mode flattened to top-level fields so this tool
// uses the same flat-field calling convention as the other six (callers no
// longer have to wrap the payload under `{ input: ... }`). The discriminator
// is the optional `mode` literal — list mode defaults (`mode` omitted or
// 'list'); update mode requires `mode: 'update'` + `id` + `status`. The
// per-mode field requirements are checked in `normalizeInput` since Zod
// can't express the "id+status required when mode=update" constraint on
// flat fields without `superRefine` machinery.
const REVIEW_DECISIONS_SHAPE = {
  mode: z.enum(['list', 'update']).optional(),
  // ULIDs are exactly 26 characters (Crockford Base32). Tightening at the
  // schema rejects empty / truncated ids before they reach the repo's blind
  // WHERE id=<input> path, where they would surface as a misleading
  // "decision not found after update" rather than a clear validation error.
  id: z.string().length(26).optional(),
  status: z.enum(['open', 'followed_up', 'abandoned']).optional(),
  notes: z.string().nullable().optional(),
  includeAll: z.boolean().optional(),
};

type ReviewDecisionsRawInput = {
  mode?: 'list' | 'update';
  id?: string;
  status?: 'open' | 'followed_up' | 'abandoned';
  notes?: string | null;
  includeAll?: boolean;
};

const TOOL_DESCRIPTION =
  'List open decisions (default) or update a decision (mode=update with id/status). Use includeAll=true to list every decision including followed_up/abandoned. Update mode requires the full 26-character ULID (use mode=list or the whoop://decisions/open resource to discover the id; short-prefix lookup is CLI-only).';

function normalizeInput(raw: ReviewDecisionsRawInput): ReviewDecisionsInput {
  if (raw.mode === 'update') {
    if (raw.id === undefined) {
      throw new Error('whoop_review_decisions: mode=update requires `id`');
    }
    if (raw.status === undefined) {
      throw new Error('whoop_review_decisions: mode=update requires `status`');
    }
    return { mode: 'update', id: raw.id, status: raw.status, notes: raw.notes ?? null };
  }
  // List mode: include `includeAll` only when defined (exactOptionalPropertyTypes
  // refuses an explicit `undefined` value in the optional slot).
  if (raw.includeAll !== undefined) {
    return { mode: 'list', includeAll: raw.includeAll };
  }
  return { mode: 'list' };
}

export function registerWhoopReviewDecisions(server: McpServer, services: Services): void {
  register(
    server,
    'whoop_review_decisions',
    { description: TOOL_DESCRIPTION, inputSchema: REVIEW_DECISIONS_SHAPE },
    async (input) => {
      const result = await services.reviewDecisions(
        normalizeInput(input as ReviewDecisionsRawInput),
      );
      return {
        content: [{ type: 'text', text: renderResult(result) }],
        structuredContent: toStructuredContent(result),
      };
    },
  );
}
