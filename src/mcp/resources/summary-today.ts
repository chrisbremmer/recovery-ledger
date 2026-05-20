// `whoop://summary/today` MCP resource — Plan 04-10 Task 2 will populate
// the registerResource() body. Task 1 ships this file as an importable
// stub so the runtime attestation test (tests/integration/mcp-runtime.test.ts)
// can import it without breaking the build. Task 2 will overwrite this
// file with the real fresh-from-cache (D-25) handler.
//
// Empty body: no resource is registered yet (resourcesList returns 0
// from this surface during Task 1).

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { Services } from '../../services/index.js';

export function registerSummaryToday(_server: McpServer, _services: Services): void {
  // Task 2 fills this in.
}
