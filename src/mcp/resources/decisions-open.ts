// `whoop://decisions/open` MCP resource — D-25 fresh-from-cache discipline.
//
// Calls services.reviewDecisions({mode: 'list'}) which lists open
// decisions (status === 'open') by default. T-04-S4 anti-leak: the
// decisions table schema has no access_token / refresh_token columns;
// the contract test asserts the rendered text carries no token shapes
// as defence-in-depth.

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { Services } from '../../services/index.js';
import { registerResource } from '../register-resource.js';

export function registerDecisionsOpen(server: McpServer, services: Services): void {
  registerResource(
    server,
    'decisions_open',
    'whoop://decisions/open',
    {
      title: 'Open decisions',
      description:
        'All decisions with status=open (recorded but not yet followed-up or abandoned). Read fresh on every call (D-25).',
      mimeType: 'application/json',
    },
    async (uri) => {
      const result = await services.reviewDecisions({ mode: 'list' });
      return {
        contents: [{ uri: uri.href, text: JSON.stringify(result), mimeType: 'application/json' }],
      };
    },
  );
}
