import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { renderDoctor } from '../../formatters/doctor.txt.js';
import type { Services } from '../../services/index.js';
import { register } from '../register.js';

export function registerWhoopDoctor(server: McpServer, services: Services): void {
  register(
    server,
    'whoop_doctor',
    { description: 'Run diagnostic checks against the local install.', inputSchema: {} },
    async () => {
      const result = await services.runDoctor();
      return {
        content: [{ type: 'text', text: renderDoctor(result) }],
        structuredContent: result as unknown as Record<string, unknown>,
      };
    },
  );
}
