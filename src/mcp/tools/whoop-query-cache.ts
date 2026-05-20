// `whoop_query_cache` MCP tool — ≤5-line shim over `services.queryCache`
// per Plan 04-10 Task 1 + 04-PATTERNS.md §Shared Pattern 9.
//
// D-24 typed-discriminated-union input: an 8-arm Zod
// `discriminatedUnion('resource', [...])` that mirrors the
// `QueryCacheInput` type verbatim. The Zod schema is the boundary
// validation; the service receives an already-narrowed payload. Free-form
// SQL is unreachable at the type level (REQUIREMENTS Out of Scope).
//
// `inputSchema` is passed as a `ZodRawShape` here (per the register
// wrapper signature) — the discriminated union is the single field's
// type. The MCP SDK funnels the user-supplied JSON-RPC params through
// the schema; an arm that doesn't match fails with a sanitized error.

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { renderQueryCache } from '../../formatters/query-cache.txt.js';
import type { QueryCacheInput, QueryCacheResult, Services } from '../../services/index.js';
import { register } from '../register.js';

function toStructuredContent(r: QueryCacheResult): { [k: string]: unknown } {
  return JSON.parse(JSON.stringify(r)) as { [k: string]: unknown };
}

// 8 arms — one per QueryCacheInput resource. Per-arm filter sets carry
// the D-24 escape hatches (includeUnscored / includeExcluded) and
// per-resource fields (minRecoveryScore / sportId / status / category).
const QUERY_CACHE_INPUT = z.discriminatedUnion('resource', [
  z.object({
    resource: z.literal('cycles'),
    since: z.string().optional(),
    until: z.string().optional(),
    includeUnscored: z.boolean().optional(),
    includeExcluded: z.boolean().optional(),
    limit: z.number().int().positive().optional(),
  }),
  z.object({
    resource: z.literal('recoveries'),
    since: z.string().optional(),
    until: z.string().optional(),
    includeUnscored: z.boolean().optional(),
    minRecoveryScore: z.number().optional(),
    maxRecoveryScore: z.number().optional(),
    limit: z.number().int().positive().optional(),
  }),
  z.object({
    resource: z.literal('sleeps'),
    since: z.string().optional(),
    until: z.string().optional(),
    includeUnscored: z.boolean().optional(),
    limit: z.number().int().positive().optional(),
  }),
  z.object({
    resource: z.literal('workouts'),
    since: z.string().optional(),
    until: z.string().optional(),
    includeUnscored: z.boolean().optional(),
    sportId: z.number().int().optional(),
    limit: z.number().int().positive().optional(),
  }),
  z.object({ resource: z.literal('profile') }),
  z.object({
    resource: z.literal('body_measurements'),
    since: z.string().optional(),
    until: z.string().optional(),
    limit: z.number().int().positive().optional(),
  }),
  z.object({
    resource: z.literal('sync_runs'),
    status: z.enum(['ok', 'partial', 'failed', 'running']).optional(),
    since: z.string().optional(),
    limit: z.number().int().positive().optional(),
  }),
  z.object({
    resource: z.literal('decisions'),
    status: z.enum(['open', 'followed_up', 'abandoned']).optional(),
    category: z.string().optional(),
    limit: z.number().int().positive().optional(),
  }),
]);

const TOOL_DESCRIPTION =
  'Query the local cache for one of 8 resources (cycles, recoveries, sleeps, workouts, profile, body_measurements, sync_runs, decisions). Default limit 100, hard cap 500.';

export function registerWhoopQueryCache(server: McpServer, services: Services): void {
  register(
    server,
    'whoop_query_cache',
    { description: TOOL_DESCRIPTION, inputSchema: { input: QUERY_CACHE_INPUT } },
    async ({ input }) => {
      const result = await services.queryCache(input as QueryCacheInput);
      return {
        content: [{ type: 'text', text: renderQueryCache(result) }],
        structuredContent: toStructuredContent(result),
      };
    },
  );
}
