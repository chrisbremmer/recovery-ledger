import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { renderDoctor } from '../../formatters/doctor.txt.js';
import type { DoctorResult, Services } from '../../services/index.js';
import { register } from '../register.js';

// WR-05: convert DoctorResult to MCP's `structuredContent` shape via a
// JSON round-trip rather than a double-cast (`as unknown as Record<string,
// unknown>`). The round-trip:
//   1. Validates JSON serializability at runtime — a future DoctorResult
//      field that adds a Date, function, Map, or Buffer triggers a
//      JSON.stringify failure that surfaces as a sanitized MCP error
//      response, NOT a silent serialization mismatch on the wire.
//   2. Returns a value whose runtime shape is already what the MCP transport
//      will serialize, eliminating the `as unknown as` escape hatch.
//   3. Costs ~tens of microseconds for the doctor result (3 checks, fixed
//      shape) — negligible compared to the underlying native-module probes.
//
// Static typing: the result is typed as `{ [k: string]: unknown }`, the
// MCP SDK's `structuredContent` slot type. The single-step cast through
// `unknown` is required because JSON.parse returns `unknown`; this is the
// canonical narrowing for parsed JSON and is materially safer than the
// double-cast it replaces.
function toStructuredContent(result: DoctorResult): { [k: string]: unknown } {
  return JSON.parse(JSON.stringify(result)) as { [k: string]: unknown };
}

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
        structuredContent: toStructuredContent(result),
      };
    },
  );
}
