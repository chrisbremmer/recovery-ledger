import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { renderDoctor } from '../../formatters/doctor.txt.js';
import type { Services } from '../../services/index.js';
import { register } from '../register.js';
import { toStructuredContent } from './utils.js';

// WR-05 + Review #45: `toStructuredContent` is the shared JSON round-trip
// helper in `./utils.ts`. It validates JSON serializability at runtime
// (a future DoctorResult field that adds a Date, function, Map, or
// Buffer triggers a JSON.stringify failure that surfaces as a sanitized
// MCP error response, NOT a silent serialization mismatch on the wire)
// and returns a value whose runtime shape is already what the MCP
// transport will serialize.

// CR-01: pass `skipSubprocessChecks: true` so the doctor service does NOT
// spawn another `dist/mcp.mjs` from inside the MCP transport. The CLI doctor
// command (`recovery-ledger doctor`) leaves the option unset so the
// subprocess check still runs end-to-end against the live binary.
//
// MR-43: the tool returns BOTH a human-readable text summary in `content`
// (rendered via formatters/doctor.txt.ts — one `[status] name — detail` line
// per check + an `overall: <status>` trailer) AND a machine-readable
// {checks, overall} object in `structuredContent`. Document this dual shape
// in the description so an MCP client knows which slot to read for which
// use.
//
// MR-45: the `mcp_stdout_purity` check is SKIPPED when invoked via MCP
// (the `skipSubprocessChecks: true` flag prevents the doctor service from
// recursively spawning another dist/mcp.mjs from inside the MCP transport).
// To validate stdout purity end-to-end, invoke via the CLI:
// `recovery-ledger doctor`. Surface this asymmetry in the tool description
// so a user wondering why mcp_stdout_purity shows `skipped` knows where to
// run the live check.
const TOOL_DESCRIPTION = [
  'Run diagnostic checks against the local install.',
  'Returns a human-readable text summary in `content` and a',
  'machine-readable {checks, overall} object in `structuredContent`.',
  'The `mcp_stdout_purity` check is skipped when invoked via MCP',
  '(to prevent self-recursion); to validate stdout purity, invoke',
  'via the CLI: `recovery-ledger doctor`.',
].join(' ');

export function registerWhoopDoctor(server: McpServer, services: Services): void {
  // MR-35: `inputSchema: {}` declares zero arguments — the whoop_doctor
  // tool is a zero-arg invocation. Any future argument MUST be added as
  // an OPTIONAL Zod field. A required field would silently break existing
  // MCP clients (Claude Code, future agents) that call the tool with no
  // arguments — the SDK's schema validator would reject the call with a
  // schema error that bypasses the register() try/catch (MR-13 advisory
  // applies here too).
  register(server, 'whoop_doctor', { description: TOOL_DESCRIPTION, inputSchema: {} }, async () => {
    const result = await services.runDoctor({ skipSubprocessChecks: true });
    return {
      content: [{ type: 'text', text: renderDoctor(result) }],
      structuredContent: toStructuredContent(result),
    };
  });
}
