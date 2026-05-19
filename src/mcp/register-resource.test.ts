// D-36 — unit tests for registerResource() resource-handler wrapper.
//
// Mirrors src/mcp/register.test.ts shape: a minimal McpServer-compatible
// mock captures the wrapped handler the wrapper registers, then we invoke
// it with synthetic args and inspect the returned shape. The wrapper
// funnels every resource handler's throw AND return path through
// sanitize() before returning to the SDK, matching the Phase 1 register.ts
// discipline for tools.

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { describe, expect, test } from 'vitest';
import { registerResource } from './register-resource.js';

interface ResourceContent {
  uri: string;
  text: string;
  mimeType?: string;
}
interface ResourceResult {
  contents: ResourceContent[];
  isError?: boolean;
}
type Wrapped = (uri: URL) => Promise<ResourceResult>;

interface CapturedRegistration {
  name: string;
  uri: string;
  metadata: unknown;
  wrapped: Wrapped;
}

function makeMockServer(): { server: McpServer; captured: CapturedRegistration[] } {
  const captured: CapturedRegistration[] = [];
  const mock = {
    registerResource: (name: string, uri: string, metadata: unknown, wrapped: unknown): void => {
      captured.push({ name, uri, metadata, wrapped: wrapped as Wrapped });
    },
  };
  return { server: mock as unknown as McpServer, captured };
}

describe('registerResource() — D-36 sanitize-wrapped resource registration', () => {
  test('success path: Bearer in handler text is redacted via sanitize walker', async () => {
    const { server, captured } = makeMockServer();
    registerResource(
      server,
      'leaky_resource',
      'whoop://test/leak',
      { description: 'returns text containing a Bearer token', mimeType: 'text/plain' },
      async (uri) => ({
        contents: [
          {
            uri: uri.href,
            text: 'today recovery 73 — Authorization: Bearer fake_token_1234567890 in audit log',
            mimeType: 'text/plain',
          },
        ],
      }),
    );

    expect(captured).toHaveLength(1);
    const reg = captured[0];
    if (!reg) throw new Error('unreachable');

    const result = await reg.wrapped(new URL('whoop://test/leak'));
    expect(result.isError).toBeUndefined();
    const text = result.contents[0]?.text ?? '';
    expect(text).not.toContain('fake_token_1234567890');
    expect(text).toContain('<redacted>');
    // Non-secret payload preserved verbatim.
    expect(text).toContain('today recovery 73');
  });

  test('error path: thrown error returns sanitized message with isError=true', async () => {
    const { server, captured } = makeMockServer();
    registerResource(
      server,
      'throws_resource',
      'whoop://test/throw',
      { description: 'throws a Bearer token in the message', mimeType: 'text/plain' },
      async () => {
        throw new Error('Authorization: Bearer fake_token_abcdefghij failed validation');
      },
    );

    const reg = captured[0];
    if (!reg) throw new Error('unreachable');
    const result = await reg.wrapped(new URL('whoop://test/throw'));
    expect(result.isError).toBe(true);
    const item = result.contents[0];
    expect(item?.uri).toBe('whoop://test/throw');
    expect(item?.mimeType).toBe('text/plain');
    expect(item?.text).not.toContain('fake_token_abcdefghij');
    expect(item?.text).toContain('<redacted>');
  });

  test('success path with multiple content entries: every text leaf is sanitized', async () => {
    const { server, captured } = makeMockServer();
    registerResource(
      server,
      'multi_resource',
      'whoop://test/multi',
      { description: 'returns multiple content entries', mimeType: 'text/plain' },
      async (uri) => ({
        contents: [
          { uri: uri.href, text: 'first: Bearer fake_token_1111111111', mimeType: 'text/plain' },
          { uri: uri.href, text: 'second: Bearer fake_token_2222222222', mimeType: 'text/plain' },
        ],
      }),
    );

    const reg = captured[0];
    if (!reg) throw new Error('unreachable');
    const result = await reg.wrapped(new URL('whoop://test/multi'));
    expect(result.isError).toBeUndefined();
    expect(result.contents[0]?.text).not.toContain('fake_token_1111111111');
    expect(result.contents[1]?.text).not.toContain('fake_token_2222222222');
    expect(result.contents[0]?.text).toContain('<redacted>');
    expect(result.contents[1]?.text).toContain('<redacted>');
  });

  test('clean success path passes through unchanged (no sanitizer side effects)', async () => {
    const { server, captured } = makeMockServer();
    registerResource(
      server,
      'clean_resource',
      'whoop://test/clean',
      { description: 'clean payload', mimeType: 'application/json' },
      async (uri) => ({
        contents: [
          {
            uri: uri.href,
            text: '{"recovery":73,"hrv_rmssd":42}',
            mimeType: 'application/json',
          },
        ],
      }),
    );

    const reg = captured[0];
    if (!reg) throw new Error('unreachable');
    const result = await reg.wrapped(new URL('whoop://test/clean'));
    expect(result.isError).toBeUndefined();
    expect(result.contents[0]?.text).toBe('{"recovery":73,"hrv_rmssd":42}');
  });
});
