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
import type { Services, WeeklyReviewResult } from '../../services/index.js';
import { register } from '../register.js';

function toStructuredContent(r: WeeklyReviewResult): { [k: string]: unknown } {
  return JSON.parse(JSON.stringify(r)) as { [k: string]: unknown };
}

const TOOL_DESCRIPTION =
  'Weekly story: trailing-7 narrative (best/worst day, avg strain, total sleep) plus trailing-28 pattern detection with FDR-controlled candidates.';

export function registerWhoopWeeklyReview(server: McpServer, services: Services): void {
  register(
    server,
    'whoop_weekly_review',
    {
      description: TOOL_DESCRIPTION,
      inputSchema: { date: z.string().optional() },
    },
    async (input) => {
      const result = await services.getWeeklyReview(
        input as Parameters<Services['getWeeklyReview']>[0],
      );
      return {
        content: [{ type: 'text', text: renderWeeklyReview(result) }],
        structuredContent: toStructuredContent(result),
      };
    },
  );
}
