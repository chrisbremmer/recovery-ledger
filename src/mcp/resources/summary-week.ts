// `whoop://summary/week` MCP resource — D-25 fresh-from-cache discipline.
// See summary-today.ts for the rationale. Every read is a fresh
// `services.getWeeklyReview` invocation.

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { Services } from '../../services/index.js';
import { registerResource } from '../register-resource.js';

export function registerSummaryWeek(server: McpServer, services: Services): void {
  registerResource(
    server,
    'summary_week',
    'whoop://summary/week',
    {
      title: 'Weekly review summary',
      description:
        'Weekly review result as JSON (trailing-7 narrative + trailing-28 pattern detection). Read fresh on every call (D-25).',
      mimeType: 'application/json',
    },
    async (uri) => {
      const result = await services.getWeeklyReview({});
      return {
        contents: [{ uri: uri.href, text: JSON.stringify(result), mimeType: 'application/json' }],
      };
    },
  );
}
