import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { renderDoctor } from '../../formatters/doctor.txt.js';
import type { Services } from '../../services/index.js';
import { register } from '../register.js';

// CR-01: pass `skipSubprocessChecks: true` so the doctor service does NOT
// spawn another `dist/mcp.mjs` from inside the MCP transport. The CLI doctor
// command (`recovery-ledger doctor`) leaves the option unset so the
// subprocess check still runs end-to-end against the live binary.
export function registerWhoopDoctor(server: McpServer, services: Services): void {
  register(
    server,
    'whoop_doctor',
    { description: 'Run diagnostic checks against the local install.', inputSchema: {} },
    async () => {
      const result = await services.runDoctor({ skipSubprocessChecks: true });
      return {
        content: [{ type: 'text', text: renderDoctor(result) }],
        structuredContent: result as unknown as Record<string, unknown>,
      };
    },
  );
}
