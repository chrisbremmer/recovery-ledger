// `whoop_sync` MCP tool — ≤5-line shim over `services.runSync` (Plan
// 04-10 Task 1). Mirrors `whoop-doctor.ts` shape verbatim per
// 04-PATTERNS.md §Shared Pattern 9.
//
// MCP-02 dual-shape: text in `content[0]` (rendered via formatSyncResult)
// + JSON in `structuredContent` (round-tripped per the WR-05 discipline
// used in whoop-doctor.ts). MCP-03 ≤5-line shim discipline: the handler
// body is exactly 2 statements.
//
// ADR-0001: no `console.*`; the underlying service threads through Pino
// → stderr. ADR-0005: the description string passes the tone lint.
//
// Per D-26 input: `days` is an int 1..365, `since` is an optional ISO
// date string, `resources` is the optional whitelist subset. The Zod
// validation at the boundary refuses any other key (additionalProperties
// rejection is implicit in zod.object).

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { formatSyncResult } from '../../formatters/sync.txt.js';
import type { Services } from '../../services/index.js';
import { register } from '../register.js';
import { toStructuredContent } from './utils.js';

const TOOL_DESCRIPTION =
  'Sync WHOOP API v2 into the local cache. Returns per-resource outcomes (success / partial / failed) and the sync run id.';

export function registerWhoopSync(server: McpServer, services: Services): void {
  register(
    server,
    'whoop_sync',
    {
      description: TOOL_DESCRIPTION,
      inputSchema: {
        days: z.number().int().positive().max(365).optional(),
        since: z.string().optional(),
        resources: z
          .array(
            z.enum(['cycles', 'recoveries', 'sleeps', 'workouts', 'profile', 'body_measurements']),
          )
          .optional(),
      },
    },
    async (input) => {
      const result = await services.runSync(input as Parameters<Services['runSync']>[0]);
      return {
        content: [{ type: 'text', text: formatSyncResult(result) }],
        structuredContent: toStructuredContent(result),
      };
    },
  );
}
