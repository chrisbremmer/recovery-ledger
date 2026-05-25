// MCP tool registration wrapper (D-09).
//
// This file is the ONLY place in the codebase that calls `server.registerTool`.
// Every tool definition in `src/mcp/tools/` must register through this wrapper so
// the try/catch/sanitize contract applies uniformly. The MR-01 grep gate
// (`scripts/ci-grep-gates.sh` Gate D — `\bserver\.registerTool\s*\(` across
// src/mcp/**/*.ts with src/mcp/register.ts as the sole exception) enforces
// this at CI time.
//
// SDK import path resolved from RESEARCH Open Question 4: STACK.md pins
// `@modelcontextprotocol/sdk/server/mcp.js`. The SDK's `./*` wildcard exports
// map resolves that to `dist/esm/server/mcp.js` which exports `McpServer`.

import type { McpServer, ToolCallback } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import type { ZodRawShape } from 'zod';
import { sanitize, serializeError } from '../infrastructure/observability/sanitize.js';

interface ToolConfig<I extends ZodRawShape> {
  title?: string;
  description: string;
  inputSchema: I;
}

// MR-20: named type alias for the inner-handler shape. Centralizes the cast
// from the SDK's branded ToolCallback<I> to the concrete
// `(args, extra) => Promise<CallToolResult>` signature so a future SDK bump
// that tightens the return variance fails to compile at this single site.
type WrappedHandler<I extends ZodRawShape> = (
  ...a: Parameters<ToolCallback<I>>
) => Promise<CallToolResult>;

/**
 * Register an MCP tool through the central try/catch/sanitize wrapper.
 *
 * This is the ONLY site that calls `server.registerTool` in the codebase
 * (D-09 + MR-01 Gate D). The wrapper:
 *
 * - Runs the inner handler under try/catch.
 * - Funnels thrown errors through `sanitize(serializeError(err))` before
 *   returning `{ isError: true }`. Tokens never escape via stack traces.
 * - MR-12: walks the success-path return value and sanitizes every string
 *   leaf in `content[].text` and `structuredContent` (recursively, leaves
 *   only). A handler whose `detail` field happens to carry a Bearer token
 *   would otherwise emit the token verbatim on the wire — the sanitizer
 *   guards both throw AND return paths.
 *
 * MR-13 (advisory, deferred to Phase 2): Zod schema-parse errors bypass
 * the try/catch entirely because the SDK intercepts them in its own
 * decode path. Phase 1's `inputSchema: {}` shape is safe because there
 * is nothing to parse. Phase 2 must either (a) extend the sanitizer to
 * cover ZodError responses, (b) intercept the SDK error-response path,
 * or (c) restrict input schemas to types that never echo input values
 * in their error messages.
 *
 * MR-44 (advisory): MCP `isError` only fires for thrown errors, not for
 * a `warn` overall status. Agents inspecting only `isError` will miss
 * the warn signal — they must inspect `structuredContent.overall`.
 */
export function register<I extends ZodRawShape>(
  server: McpServer,
  name: string,
  config: ToolConfig<I>,
  handler: ToolCallback<I>,
): void {
  const wrapped = (async (...args: Parameters<ToolCallback<I>>): Promise<CallToolResult> => {
    try {
      const result = await (handler as WrappedHandler<I>)(...args);
      // MR-12: sanitize string leaves on the success path. Walks
      // `content[].text` and `structuredContent` recursively, replacing
      // strings only. Structural keys (array indices, object keys) are
      // preserved so the wire shape is unchanged.
      return sanitizeResult(result) satisfies CallToolResult;
    } catch (err) {
      return {
        content: [{ type: 'text', text: sanitize(serializeError(err)) }],
        isError: true,
      } satisfies CallToolResult;
    }
  }) as ToolCallback<I>;
  server.registerTool(name, config, wrapped);
}

// MR-12: recursively sanitize string leaves in a CallToolResult. Walks
// `content[].text` (the human-readable surface) and `structuredContent`
// (the machine-readable surface) so a handler whose detail field happens
// to carry a token shape is redacted on the wire. We mutate the result
// in-place rather than deep-cloning — the handler's return value is
// transient and not reused after register's wrapper consumes it.
function sanitizeResult(result: CallToolResult): CallToolResult {
  if (Array.isArray(result.content)) {
    for (const item of result.content) {
      if (item && typeof item === 'object' && 'text' in item && typeof item.text === 'string') {
        item.text = sanitize(item.text);
      }
    }
  }
  if (result.structuredContent !== undefined) {
    result.structuredContent = sanitizeLeaves(result.structuredContent) as Record<string, unknown>;
  }
  return result;
}

// Recursively walk a JSON-like value, applying `sanitize()` to every
// string leaf. Non-string leaves (numbers, booleans, null) pass through.
// Cycle guard: structuredContent must be JSON-serializable (the MCP
// transport will JSON.stringify it downstream), so cycles are impossible
// in well-formed handlers. A handler that emits a cycle here has a
// deeper bug and would crash at serialization anyway.
function sanitizeLeaves(value: unknown): unknown {
  if (typeof value === 'string') return sanitize(value);
  if (Array.isArray(value)) return value.map(sanitizeLeaves);
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = sanitizeLeaves(v);
    }
    return out;
  }
  return value;
}
