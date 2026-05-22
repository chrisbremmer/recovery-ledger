// `whoop_weekly_review` MCP tool — ≤5-line shim over
// `services.getWeeklyReview` per Plan 04-10 Task 1 + 04-PATTERNS.md
// §Shared Pattern 9.
//
// MCP-02 dual-shape: rendered narrative in `content[0]` (via
// renderWeeklyReview) + JSON in `structuredContent`. The optional
// `date` argument anchors both the trailing-28 pattern-test window
// (D-12) and the trailing-7 week_summary window (D-17) at the same
// reviewed_date per D-16.

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { renderWeeklyReview } from '../../formatters/weekly-review.txt.js';
import type { Services } from '../../services/index.js';
import { register } from '../register.js';
import { toStructuredContent } from './utils.js';

const TOOL_DESCRIPTION =
  'Weekly story: trailing-7 narrative (best/worst day, avg strain, total sleep) plus trailing-28 pattern detection with FDR-controlled candidates.';

// Review #34: hoist the Zod shape so its inferred type is the single
// source of truth for the handler input — drift between schema and
// service signature now fails at compile time.
const WEEKLY_REVIEW_SHAPE = { date: z.string().optional() };
type WeeklyReviewInput = z.infer<z.ZodObject<typeof WEEKLY_REVIEW_SHAPE>>;

export function registerWhoopWeeklyReview(server: McpServer, services: Services): void {
  register(
    server,
    'whoop_weekly_review',
    { description: TOOL_DESCRIPTION, inputSchema: WEEKLY_REVIEW_SHAPE },
    async (input) => {
      const i = input as WeeklyReviewInput;
      const result = await services.getWeeklyReview(i.date === undefined ? {} : { date: i.date });
      return {
        content: [{ type: 'text', text: renderWeeklyReview(result) }],
        structuredContent: toStructuredContent(result),
      };
    },
  );
}
