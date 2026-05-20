// MCP prompt registration wrapper (D-36, Phase 4 Wave 0).
//
// This file is the ONLY place in the codebase that performs the raw
// prompt registration SDK call. Every prompt definition in
// `src/mcp/prompts/` must register through this wrapper so the
// try/catch/sanitize contract applies uniformly — the same discipline the
// Phase 1 tool wrapper (`./register.ts`) enforces. The MR-style grep gate
// (Gate J) across `src/**/*.ts` with this file as the sole exception
// lands in `scripts/ci-grep-gates.sh` later in this same plan (Task 5)
// and enforces the chokepoint at CI time.
//
// Prompt success-path sanitization walks `messages[].content.text` for
// text-type content. Image content has no string field; it passes through
// untouched (the `data` field is base64 and not subject to the token
// pattern catalog). Per D-27 each Phase 4 prompt returns exactly one
// user-role message, but the wrapper walks all messages so a future
// multi-message return shape is covered without changes.

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { sanitize, serializeError } from './sanitize.js';

export interface PromptConfig {
  title?: string;
  description: string;
  // The SDK accepts an optional `argsSchema` Zod schema; we type-erase to
  // `unknown` here so callers can pass any Zod shape without leaking the
  // SDK's internal generic across the wrapper. Phase 4 prompts ship
  // without input args (D-27) so the field is unused at this stage.
  argsSchema?: unknown;
}

export type TextContent = { type: 'text'; text: string };
export type ImageContent = { type: 'image'; data: string; mimeType: string };
export type PromptContent = TextContent | ImageContent;

export interface PromptMessage {
  role: 'user' | 'assistant';
  content: PromptContent;
}

export interface PromptResult {
  messages: PromptMessage[];
  isError?: boolean;
}

// The SDK's prompt-handler signature accepts an args object whose shape
// depends on the Zod schema. We type-erase at the wrapper boundary; the
// handler authoring the prompt narrows this internally.
export type PromptHandler = (args: unknown) => Promise<PromptResult>;

/**
 * Register an MCP prompt through the central try/catch/sanitize wrapper.
 *
 * D-36 — this is the sole call site of the raw prompt-registration SDK
 * method (Gate J enforced at CI). The wrapper:
 *
 * - Runs the inner handler under try/catch.
 * - Funnels thrown errors through `sanitize(serializeError(err))` before
 *   returning a single user-role text message with `isError: true`.
 *   Tokens never escape via stack traces.
 * - Walks `messages[]` on the success path; for each message whose
 *   `content.type === 'text'`, sanitizes `content.text` in place. Image
 *   content is passed through (no text field to walk).
 */
export function registerPrompt(
  server: McpServer,
  name: string,
  config: PromptConfig,
  handler: PromptHandler,
): void {
  const wrapped = async (...args: unknown[]): Promise<PromptResult> => {
    try {
      const result = await handler(args[0]);
      sanitizeMessages(result.messages);
      return result;
    } catch (err) {
      return {
        messages: [
          {
            role: 'user' as const,
            content: {
              type: 'text' as const,
              text: sanitize(serializeError(err)),
            },
          },
        ],
        isError: true,
      };
    }
  };
  // The SDK's PromptCallback union splits on whether argsSchema is
  // provided; without an argsSchema (Phase 4 D-27 — all 4 prompts ship
  // arg-less), the callback signature is `(extra) => ...`. We type-erase
  // the handler at the wrapper boundary; the success-path return is
  // structurally identical to GetPromptResult so the SDK accepts it.
  // The config also passes through `unknown` because the SDK's expected
  // shape uses `argsSchema?: ZodRawShapeCompat` (not the broader `unknown`
  // surface our PromptConfig declares), and TS's exactOptionalPropertyTypes
  // refuses the implicit-widening that would otherwise let `unknown` flow
  // into the SDK's narrower optional slot.
  // The SDK's PromptCallback union splits on whether `argsSchema` is
  // provided; without one (Phase 4 D-27 — all 4 prompts ship arg-less),
  // the callback signature is `(extra) => ...`. We narrow the cast to the
  // SDK's own parameter types (Review #10) instead of `as never` so the
  // SDK overload still gets parameter-count + structural-shape checks,
  // and a future SDK bump that adds/removes a parameter fails here at
  // compile time rather than silently accepting the call.
  server.registerPrompt(
    name,
    config as Parameters<typeof server.registerPrompt>[1],
    wrapped as Parameters<typeof server.registerPrompt>[2],
  );
}

// Walks `messages[]` and sanitizes each text-content `text` field in place.
// Mirrors `register.ts` `sanitizeResult` discipline but over the prompt
// shape (`messages[].content.text` instead of `content[].text`).
function sanitizeMessages(messages: PromptMessage[]): void {
  for (const msg of messages) {
    if (msg.content.type === 'text' && typeof msg.content.text === 'string') {
      msg.content.text = sanitize(msg.content.text);
    }
  }
}
