// `whoop://api-gaps` MCP resource — D-25 fresh-from-cache discipline.
//
// The api-gap catalog is module-load constant (no DB), but the handler
// still calls services.getApiGap() fresh on every read per the D-25
// principle (no resource handler short-circuits its services.* call,
// even when the underlying data is static — uniform discipline keeps
// future cache-introduction temptation out).

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { Services } from '../../services/index.js';
import { registerResource } from '../register-resource.js';

export function registerApiGaps(server: McpServer, services: Services): void {
  registerResource(
    server,
    'api_gaps',
    'whoop://api-gaps',
    {
      title: 'WHOOP v2 API gaps catalog',
      description:
        'WHOOP consumer-app features unavailable via the public v2 API, with v2 alternatives when one exists.',
      mimeType: 'application/json',
    },
    async (uri) => {
      const result = await services.getApiGap();
      return {
        contents: [{ uri: uri.href, text: JSON.stringify(result), mimeType: 'application/json' }],
      };
    },
  );
}
