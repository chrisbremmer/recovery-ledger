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
import type { QueryCacheInput, Services } from '../../services/index.js';
import { register } from '../register.js';
import { toStructuredContent } from './utils.js';

// Per-arm union of resource discriminators + per-arm filter sets carrying
// the D-24 escape hatches (includeUnscored / includeExcluded) and
// per-resource fields (minRecoveryScore / sportId / status / category).
// MCP `inputSchema` is a `ZodRawShape` (key→ZodType), so we flatten the
// discriminated union to top-level fields (Review #7) for parity with the
// other six tools. The 8-arm narrowing still lives in `services.queryCache`
// — the SDK boundary just admits the superset of fields here.
const QUERY_CACHE_SHAPE = {
  resource: z.enum([
    'cycles',
    'recoveries',
    'sleeps',
    'workouts',
    'profile',
    'body_measurements',
    'sync_runs',
    'decisions',
  ]),
  since: z.string().optional(),
  until: z.string().optional(),
  includeUnscored: z.boolean().optional(),
  includeExcluded: z.boolean().optional(),
  minRecoveryScore: z.number().optional(),
  maxRecoveryScore: z.number().optional(),
  sportId: z.number().int().optional(),
  // `status` is shared between sync_runs (ok|partial|failed|running) and
  // decisions (open|followed_up|abandoned). Admit both at the SDK boundary
  // — the service-layer narrowing rejects mismatched combinations.
  status: z
    .enum(['ok', 'partial', 'failed', 'running', 'open', 'followed_up', 'abandoned'])
    .optional(),
  category: z.string().optional(),
  limit: z.number().int().positive().optional(),
};

const TOOL_DESCRIPTION =
  'Query the local cache for one of 8 resources (cycles, recoveries, sleeps, workouts, profile, body_measurements, sync_runs, decisions). Default limit 100, hard cap 500. Flat-field input: callers pass {resource, since?, until?, limit?, ...per-resource filters} at the top level.';

// #49: per-resource flag-set guard. The flat Zod shape above admits
// `includeExcluded` on every resource arm, but the typed
// `QueryCacheInput` discriminated union only declares it on `cycles`.
// Without this guard, a payload like `{resource:'recoveries', includeExcluded:true}`
// silently lands as SCORED-only rows with no error — agents have no way
// to learn the flag is ignored. The CLI rejects this combination via
// `unsupported()` in `query.ts`; this is the MCP-side mirror.
type QueryCacheFlatInput = QueryCacheInput & {
  includeExcluded?: boolean;
};

function rejectUnsupportedFlags(input: QueryCacheFlatInput): void {
  if (input.includeExcluded !== undefined && input.resource !== 'cycles') {
    throw new Error(
      `includeExcluded is only supported on the 'cycles' arm, not '${input.resource}'.`,
    );
  }
}

export function registerWhoopQueryCache(server: McpServer, services: Services): void {
  register(
    server,
    'whoop_query_cache',
    { description: TOOL_DESCRIPTION, inputSchema: QUERY_CACHE_SHAPE },
    async (input) => {
      rejectUnsupportedFlags(input as QueryCacheFlatInput);
      const result = await services.queryCache(input as QueryCacheInput);
      return {
        content: [{ type: 'text', text: renderQueryCache(result) }],
        structuredContent: toStructuredContent(result),
      };
    },
  );
}
