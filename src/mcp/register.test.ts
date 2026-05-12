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

import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { describe, expect, test } from 'vitest';
import { register } from './register.js';

// Minimal mock — register() only calls `server.registerTool(name, config, wrapped)`.
// We capture (name, config, wrapped) and forget everything else the SDK does.
interface CapturedRegistration {
  name: string;
  config: unknown;
  wrapped: (...args: unknown[]) => Promise<CallToolResult>;
}

function makeMockServer(): { server: unknown; captured: CapturedRegistration[] } {
  const captured: CapturedRegistration[] = [];
  const server = {
    registerTool: (name: string, config: unknown, wrapped: unknown) => {
      captured.push({
        name,
        config,
        wrapped: wrapped as (...a: unknown[]) => Promise<CallToolResult>,
      });
    },
  };
  return { server, captured };
}

describe('register() — MR-23 sanitization wrapper', () => {
  test('thrown error is sanitized + isError=true on return', async () => {
    const { server, captured } = makeMockServer();
    register(
      // biome-ignore lint/suspicious/noExplicitAny: minimal mock for unit test
      server as any,
      'throws_tool',
      { description: 'throws a Bearer token', inputSchema: {} },
      // biome-ignore lint/suspicious/noExplicitAny: minimal mock for unit test
      (async () => {
        throw new Error('Authorization: Bearer fake_token_1234567890');
      }) as any,
    );

    expect(captured).toHaveLength(1);
    const reg = captured[0];
    expect(reg).toBeDefined();
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
      // biome-ignore lint/suspicious/noExplicitAny: minimal mock for unit test
      server as any,
      'bare_bearer_tool',
      { description: 'throws bare Bearer', inputSchema: {} },
      // biome-ignore lint/suspicious/noExplicitAny: minimal mock for unit test
      (async () => {
        throw new Error('Bearer fake_bare_token_xxxxxxxx');
      }) as any,
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
      // biome-ignore lint/suspicious/noExplicitAny: minimal mock for unit test
      server as any,
      'leaky_success_tool',
      { description: 'returns a token in text', inputSchema: {} },
      // biome-ignore lint/suspicious/noExplicitAny: minimal mock for unit test
      (async () => ({
        content: [{ type: 'text', text: 'Bearer fake_token_1234567890 leaked here' }],
      })) as any,
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
      // biome-ignore lint/suspicious/noExplicitAny: minimal mock for unit test
      server as any,
      'leaky_structured_tool',
      { description: 'returns a token in structuredContent', inputSchema: {} },
      // biome-ignore lint/suspicious/noExplicitAny: minimal mock for unit test
      (async () => ({
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
      })) as any,
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
      // biome-ignore lint/suspicious/noExplicitAny: minimal mock for unit test
      server as any,
      'clean_tool',
      { description: 'clean return', inputSchema: {} },
      // biome-ignore lint/suspicious/noExplicitAny: minimal mock for unit test
      (async () => ({
        content: [{ type: 'text', text: 'nothing sensitive' }],
      })) as any,
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
