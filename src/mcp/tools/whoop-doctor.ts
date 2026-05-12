import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { DoctorResult, Services } from '../../services/index.js';
import { register } from '../register.js';

// Inline stub for the doctor formatter; Plan 05 replaces with an import from
// `../../formatters/doctor.txt.js` once that file exists.
function renderDoctor(r: DoctorResult): string {
  return JSON.stringify(r);
}

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
