// MCP stdio server entry point.
//
// Speaks JSON-RPC on stdout; everything else (including any logging) MUST go to
// stderr via the Pino logger in `src/infrastructure/config/logger.ts`. See
// CLAUDE.md §Critical Rules — MCP stdout purity.

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createServices } from '../services/index.js';
import { registerWhoopDoctor } from './tools/whoop-doctor.js';

const server = new McpServer({ name: 'recovery-ledger', version: '0.1.0' });
const services = createServices();
registerWhoopDoctor(server, services);

const transport = new StdioServerTransport();
await server.connect(transport);
