// `whoop_api_gap` MCP tool — ≤5-line shim over `services.getApiGap`
// per Plan 04-10 Task 1 + 04-PATTERNS.md §Shared Pattern 9 + D-28.
//
// Zero-arg tool: the catalog is module-load constant (no filtering, no
// pagination). MCP-02 dual-shape: rendered table in `content[0]` (via
// renderApiGap) + `{entries: ApiGapEntry[]}` JSON in `structuredContent`.

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { renderApiGap } from '../../formatters/api-gap.txt.js';
import type { ApiGapResult, Services } from '../../services/index.js';
import { register } from '../register.js';

function toStructuredContent(r: ApiGapResult): { [k: string]: unknown } {
  return JSON.parse(JSON.stringify(r)) as { [k: string]: unknown };
}

const TOOL_DESCRIPTION =
  'List WHOOP consumer-app features that are NOT exposed via the public v2 API, with the closest v2 alternative when one exists.';

export function registerWhoopApiGap(server: McpServer, services: Services): void {
  register(
    server,
    'whoop_api_gap',
    { description: TOOL_DESCRIPTION, inputSchema: {} },
    async () => {
      const result = await services.getApiGap();
      return {
        content: [{ type: 'text', text: renderApiGap(result) }],
        structuredContent: toStructuredContent(result),
      };
    },
  );
}
