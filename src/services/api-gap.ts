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
//
// Phase 10 ARCH-08 (#86): this file replaces the over-structured
// `src/services/api-gap/` directory (3 source files for a one-line async
// accessor over a frozen 6-element constant). The catalog + `ApiGapEntry`
// interface moved to `src/domain/api-gap/catalog.ts` per the
// lite-hexagonal layering rule (pure data belongs in domain). This file
// re-exports `ApiGapEntry` so callers that previously pulled it from the
// types module can land on this file instead, keeping the service-layer
// barrel re-export shape unchanged.

import { API_GAP_ENTRIES, type ApiGapEntry } from '../domain/api-gap/catalog.js';

// Re-export the catalog entry interface so consumers that previously
// imported it from the per-types module can switch to this file without
// a second domain-tier import.
export type { ApiGapEntry };

/**
 * `whoop_api_gap` result shape. Single field — the catalog array.
 * Plan 04-10 `services.getApiGap()` returns the in-source constant
 * verbatim; no filtering, no pagination, no I/O.
 */
export interface ApiGapResult {
  // `readonly` so the cast in getApiGap() drops out — the backing
  // `API_GAP_ENTRIES` is an `Object.freeze`-d array annotated
  // `readonly ApiGapEntry[]`, and exposing it as a mutable array was a lie.
  entries: readonly ApiGapEntry[];
}

export async function getApiGap(): Promise<ApiGapResult> {
  return { entries: API_GAP_ENTRIES };
}
