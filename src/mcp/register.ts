// MCP tool registration wrapper (D-09).
//
// This file is the ONLY place in the codebase that calls `server.registerTool`.
// Every tool definition in `src/mcp/tools/` must register through this wrapper so
// the try/catch/sanitize contract applies uniformly. The Plan 04 grep gate
// (`grep -rEn "server\.registerTool" src/mcp/ | grep -v "src/mcp/register.ts"`)
// enforces this at CI time.
//
// SDK import path resolved from RESEARCH Open Question 4: STACK.md pins
// `@modelcontextprotocol/sdk/server/mcp.js`. The SDK's `./*` wildcard exports
// map resolves that to `dist/esm/server/mcp.js` which exports `McpServer`.

import type { McpServer, ToolCallback } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import type { ZodRawShape } from 'zod';
import { sanitize, serializeError } from './sanitize.js';

interface ToolConfig<I extends ZodRawShape> {
  title?: string;
  description: string;
  inputSchema: I;
}

export function register<I extends ZodRawShape>(
  server: McpServer,
  name: string,
  config: ToolConfig<I>,
  handler: ToolCallback<I>,
): void {
  // IMPORTANT: this is the ONLY call to server.registerTool in the codebase (D-09).
  // The SDK 1.29's ToolCallback<I> resolves to (args, extra) => CallToolResult; we
  // forward both arguments to the inner handler and wrap in try/catch so any throw
  // is funneled through the sanitizer before the response leaves this process.
  const wrapped = (async (...args: Parameters<ToolCallback<I>>): Promise<CallToolResult> => {
    try {
      return await (handler as (...a: Parameters<ToolCallback<I>>) => Promise<CallToolResult>)(
        ...args,
      );
    } catch (err) {
      return {
        content: [{ type: 'text', text: sanitize(serializeError(err)) }],
        isError: true,
      } satisfies CallToolResult;
    }
  }) as ToolCallback<I>;
  server.registerTool(name, config, wrapped);
}
