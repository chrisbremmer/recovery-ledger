// MR-23 — unit tests for register() error-sanitization + success-path sanitization.
//
// The register() wrapper is the load-bearing chokepoint that funnels every MCP
// tool's throw AND return path through the sanitizer. Phase 1 had no direct
// unit coverage for either path; integration tests asserted the end-to-end
// transport behaviour but a future refactor of register.ts could break the
// throw/return contract without a clear localized failure.
//
// We mount a minimal McpServer-compatible mock that captures the wrapped
// handler register() registers, then invoke it with synthetic args and
// inspect the returned CallToolResult. No transport, no SDK plumbing.

import type { McpServer, ToolCallback } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { describe, expect, test } from 'vitest';
import { register } from './register.js';

type Wrapped = (...args: unknown[]) => Promise<CallToolResult>;

interface CapturedRegistration {
  name: string;
  config: unknown;
  wrapped: Wrapped;
}

// Minimal mock — register() only calls `server.registerTool(name, config, wrapped)`.
// We capture (name, config, wrapped) and forget everything else the SDK does.
// The double-cast through `unknown` is justified: McpServer is a concrete class
// with many private fields; constructing one solely to wire registerTool would
// pull in transport plumbing this test deliberately avoids.
function makeMockServer(): { server: McpServer; captured: CapturedRegistration[] } {
  const captured: CapturedRegistration[] = [];
  const mock = {
    registerTool: (name: string, config: unknown, wrapped: unknown): void => {
      captured.push({ name, config, wrapped: wrapped as Wrapped });
    },
  };
  return { server: mock as unknown as McpServer, captured };
}

// The handler signature register() accepts is ToolCallback<ZodRawShape>; for
// tests we cast through `unknown` so the inner functions can return whatever
// shape the test scenario requires (a throw, a partial CallToolResult, etc.).
type AnyToolHandler = (...a: unknown[]) => Promise<unknown>;
function asHandler<I extends Record<string, never>>(fn: AnyToolHandler): ToolCallback<I> {
  return fn as unknown as ToolCallback<I>;
}

describe('register() — MR-23 sanitization wrapper', () => {
  test('thrown error is sanitized + isError=true on return', async () => {
    const { server, captured } = makeMockServer();
    register(
      server,
      'throws_tool',
      { description: 'throws a Bearer token', inputSchema: {} },
      asHandler(async () => {
        throw new Error('Authorization: Bearer fake_token_1234567890');
      }),
    );

    expect(captured).toHaveLength(1);
    const reg = captured[0];
    if (!reg) throw new Error('unreachable');

    const result = await reg.wrapped({}, {});
    expect(result.isError).toBe(true);
    const text =
      Array.isArray(result.content) && result.content[0] && 'text' in result.content[0]
        ? result.content[0].text
        : '';
    expect(text).not.toContain('fake_token_1234567890');
    expect(text).toContain('<redacted>');
  });

  test('thrown error with bare Bearer in message is redacted', async () => {
    const { server, captured } = makeMockServer();
    register(
      server,
      'bare_bearer_tool',
      { description: 'throws bare Bearer', inputSchema: {} },
      asHandler(async () => {
        throw new Error('Bearer fake_bare_token_xxxxxxxx');
      }),
    );

    const reg = captured[0];
    if (!reg) throw new Error('unreachable');
    const result = await reg.wrapped({}, {});
    expect(result.isError).toBe(true);
    const text =
      Array.isArray(result.content) && result.content[0] && 'text' in result.content[0]
        ? result.content[0].text
        : '';
    expect(text).not.toContain('fake_bare_token_xxxxxxxx');
    expect(text).toContain('Bearer <redacted>');
  });

  // MR-12 — the success path must ALSO be sanitized. A handler whose
  // detail string happens to carry a token shape should not leak it on
  // the wire even though it returned cleanly.
  test('MR-12: success-path content[].text is sanitized', async () => {
    const { server, captured } = makeMockServer();
    register(
      server,
      'leaky_success_tool',
      { description: 'returns a token in text', inputSchema: {} },
      asHandler(async () => ({
        content: [{ type: 'text', text: 'Bearer fake_token_1234567890 leaked here' }],
      })),
    );

    const reg = captured[0];
    if (!reg) throw new Error('unreachable');
    const result = await reg.wrapped({}, {});
    expect(result.isError).toBeUndefined();
    const text =
      Array.isArray(result.content) && result.content[0] && 'text' in result.content[0]
        ? result.content[0].text
        : '';
    expect(text).not.toContain('fake_token_1234567890');
    expect(text).toContain('Bearer <redacted>');
  });

  test('MR-12: success-path structuredContent string leaves are sanitized', async () => {
    const { server, captured } = makeMockServer();
    register(
      server,
      'leaky_structured_tool',
      { description: 'returns a token in structuredContent', inputSchema: {} },
      asHandler(async () => ({
        content: [{ type: 'text', text: 'ok' }],
        structuredContent: {
          overall: 'fail',
          checks: [
            {
              name: 'mock_check',
              status: 'fail',
              detail: 'Authorization: Bearer fake_token_in_detail_field',
            },
          ],
        },
      })),
    );

    const reg = captured[0];
    if (!reg) throw new Error('unreachable');
    const result = await reg.wrapped({}, {});
    expect(result.isError).toBeUndefined();
    const serialized = JSON.stringify(result.structuredContent);
    expect(serialized).not.toContain('fake_token_in_detail_field');
    expect(serialized).toContain('<redacted>');
    // Non-secret structural fields are preserved.
    expect(serialized).toContain('"overall":"fail"');
    expect(serialized).toContain('"name":"mock_check"');
  });

  test('MR-12: success-path with no structuredContent passes through unchanged', async () => {
    const { server, captured } = makeMockServer();
    register(
      server,
      'clean_tool',
      { description: 'clean return', inputSchema: {} },
      asHandler(async () => ({
        content: [{ type: 'text', text: 'nothing sensitive' }],
      })),
    );

    const reg = captured[0];
    if (!reg) throw new Error('unreachable');
    const result = await reg.wrapped({}, {});
    expect(result.isError).toBeUndefined();
    const text =
      Array.isArray(result.content) && result.content[0] && 'text' in result.content[0]
        ? result.content[0].text
        : '';
    expect(text).toBe('nothing sensitive');
  });
});
