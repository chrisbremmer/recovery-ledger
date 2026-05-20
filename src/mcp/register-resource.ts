// MCP resource registration wrapper (D-36, Phase 4 Wave 0).
//
// This file is the ONLY place in the codebase that performs the raw
// resource registration SDK call. Every resource definition in
// `src/mcp/resources/` must register through this wrapper so the
// try/catch/sanitize contract applies uniformly — the same discipline the
// Phase 1 tool wrapper (`./register.ts`) enforces. The MR-style grep gate
// (Gate I) across `src/**/*.ts` with this file as the sole exception
// lands in `scripts/ci-grep-gates.sh` later in this same plan (Task 5)
// and enforces the chokepoint at CI time.
//
// Why mirror the tool wrapper instead of skipping the indirection: resource
// handlers can throw on auth/DB failures whose error messages legitimately
// carry Bearer tokens or refresh-token shapes (Phase 2 D-08 cause-chain).
// Without this funnel, a thrown handler error would surface verbatim to the
// MCP client and corrupt the audit trail. The sanitizer wraps both the
// success-path text leaves AND the error-path serialized cause chain so
// neither path can leak token material on the wire.

import type {
  McpServer,
  ReadResourceCallback,
  ResourceMetadata,
} from '@modelcontextprotocol/sdk/server/mcp.js';
import { sanitize, serializeError } from './sanitize.js';

export interface ResourceContent {
  uri: string;
  text: string;
  mimeType?: string;
}

export interface ResourceResult {
  contents: ResourceContent[];
  isError?: boolean;
}

export type ResourceHandler = (uri: URL) => Promise<ResourceResult>;

/**
 * Register an MCP resource through the central try/catch/sanitize wrapper.
 *
 * D-36 — this is the sole call site of the raw resource-registration SDK
 * method (Gate I enforced at CI). The wrapper:
 *
 * - Runs the inner handler under try/catch.
 * - Funnels thrown errors through `sanitize(serializeError(err))` before
 *   returning `{contents: [{uri, text, mimeType: 'text/plain'}], isError: true}`.
 *   Tokens never escape via stack traces.
 * - Walks `contents[].text` on the success path and sanitizes each string
 *   leaf in place (mirrors `register.ts` MR-12 discipline for tool content).
 */
// Concrete SDK return type for ReadResourceCallback. Awaiting the
// callback's return type yields the same union the SDK accepts at
// runtime; naming it locally (Review #9) keeps the SDK contract visible
// at the cast site, and a `Promise<infer R>` extends-clause that fails
// to infer would otherwise silently resolve to `never`.
type ReadResourceResult = Awaited<ReturnType<ReadResourceCallback>>;

export function registerResource(
  server: McpServer,
  name: string,
  uri: string,
  metadata: ResourceMetadata,
  handler: ResourceHandler,
): void {
  const wrapped: ReadResourceCallback = async (uriArg) => {
    try {
      const result = await handler(uriArg);
      sanitizeContents(result.contents);
      // Cast satisfies the SDK's ReadResourceResult union (contents[] +
      // optional isError); our ResourceResult is a strict subset.
      return result as unknown as ReadResourceResult;
    } catch (err) {
      return {
        contents: [
          {
            uri: uriArg.href,
            text: sanitize(serializeError(err)),
            mimeType: 'text/plain',
          },
        ],
        isError: true,
      } as unknown as ReadResourceResult;
    }
  };
  server.registerResource(name, uri, metadata, wrapped);
}

// Walks `contents[]` and sanitizes every `text` field in place. Mirrors
// `register.ts` `sanitizeResult` discipline but over the resource shape
// (plural `contents`, not singular `content`). Non-string `text` fields
// are skipped (defence in depth — the SDK contract requires `text: string`,
// but a buggy handler returning `text: undefined` should not crash here).
function sanitizeContents(contents: ResourceContent[]): void {
  for (const item of contents) {
    if (item && typeof item.text === 'string') {
      item.text = sanitize(item.text);
    }
  }
}
