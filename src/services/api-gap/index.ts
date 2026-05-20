// API-gap service accessor — D-28 trivial wrapper around the in-source
// `API_GAP_ENTRIES` constant. Async return for uniformity with the rest
// of the service layer (the MCP boundary expects `Promise<...>` from
// every tool body); the underlying data is module-load constant, so no
// async work happens.
//
// Phase 4 callers: `whoop_api_gap` MCP tool (Plan 04-10), the
// `whoop://api-gaps` MCP resource (Plan 04-10). Phase 5 (DOC-03/04)
// reads `API_GAP_ENTRIES` directly to generate the markdown — no
// duplication.

import { API_GAP_ENTRIES } from './data.js';
import type { ApiGapResult } from './types.js';

export async function getApiGap(): Promise<ApiGapResult> {
  return { entries: API_GAP_ENTRIES as ApiGapResult['entries'] };
}
