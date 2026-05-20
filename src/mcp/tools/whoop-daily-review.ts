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
import type { Services } from '../../services/index.js';
import { register } from '../register.js';
import { toStructuredContent } from './utils.js';

const TOOL_DESCRIPTION =
  'Today vs trailing-30 baseline. Returns anomalies, suggested actions, confidence tier, and data-freshness lead.';

// Review #34: hoist the Zod shape so its inferred type can be checked
// against the service input contract at compile time. The cast in the
// handler body now flows through the Zod-derived type instead of the
// service signature, so a schema drift fails here instead of silently
// at runtime. exactOptionalPropertyTypes forces an undefined-stripping
// pass before handing to the service (which uses `{ date?: string }`).
const DAILY_REVIEW_SHAPE = { date: z.string().optional() };
type DailyReviewInput = z.infer<z.ZodObject<typeof DAILY_REVIEW_SHAPE>>;

export function registerWhoopDailyReview(server: McpServer, services: Services): void {
  register(
    server,
    'whoop_daily_review',
    { description: TOOL_DESCRIPTION, inputSchema: DAILY_REVIEW_SHAPE },
    async (input) => {
      const i = input as DailyReviewInput;
      const result = await services.getDailyReview(i.date === undefined ? {} : { date: i.date });
      return {
        content: [{ type: 'text', text: renderDailyReview(result) }],
        structuredContent: toStructuredContent(result),
      };
    },
  );
}
