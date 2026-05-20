// `whoop_daily_review` MCP tool — ≤5-line shim over
// `services.getDailyReview` per Plan 04-10 Task 1 + 04-PATTERNS.md
// §Shared Pattern 9.
//
// MCP-02 dual-shape: rendered narrative in `content[0]` (via
// renderDailyReview) + JSON in `structuredContent`. Optional `date`
// argument overrides the default "today" anchor per D-02 — re-running
// with `--date 2026-03-15` next month gives identical numbers.

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { renderDailyReview } from '../../formatters/daily-review.txt.js';
import type { DailyReviewResult, Services } from '../../services/index.js';
import { register } from '../register.js';

function toStructuredContent(r: DailyReviewResult): { [k: string]: unknown } {
  return JSON.parse(JSON.stringify(r)) as { [k: string]: unknown };
}

const TOOL_DESCRIPTION =
  'Today vs trailing-30 baseline. Returns anomalies, suggested actions, confidence tier, and data-freshness lead.';

export function registerWhoopDailyReview(server: McpServer, services: Services): void {
  register(
    server,
    'whoop_daily_review',
    {
      description: TOOL_DESCRIPTION,
      inputSchema: { date: z.string().optional() },
    },
    async (input) => {
      const result = await services.getDailyReview(
        input as Parameters<Services['getDailyReview']>[0],
      );
      return {
        content: [{ type: 'text', text: renderDailyReview(result) }],
        structuredContent: toStructuredContent(result),
      };
    },
  );
}
