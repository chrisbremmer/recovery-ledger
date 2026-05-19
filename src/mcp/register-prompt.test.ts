// D-36 — unit tests for registerPrompt() prompt-handler wrapper.
//
// Mirrors src/mcp/register.test.ts shape: a minimal McpServer-compatible
// mock captures the wrapped handler the wrapper registers, then we invoke
// it with synthetic args and inspect the returned shape. The wrapper
// funnels every prompt handler's throw AND return path through sanitize()
// before returning to the SDK. Prompt success-path sanitization walks
// `messages[].content.text` for text-type content (image content has no
// string field and passes through).

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { describe, expect, test } from 'vitest';
import { registerPrompt } from './register-prompt.js';

type TextContent = { type: 'text'; text: string };
type ImageContent = { type: 'image'; data: string; mimeType: string };
interface PromptMessage {
  role: 'user' | 'assistant';
  content: TextContent | ImageContent;
}
interface PromptResult {
  messages: PromptMessage[];
  isError?: boolean;
}
type Wrapped = (args: unknown) => Promise<PromptResult>;

interface CapturedRegistration {
  name: string;
  config: unknown;
  wrapped: Wrapped;
}

function makeMockServer(): { server: McpServer; captured: CapturedRegistration[] } {
  const captured: CapturedRegistration[] = [];
  const mock = {
    registerPrompt: (name: string, config: unknown, wrapped: unknown): void => {
      captured.push({ name, config, wrapped: wrapped as Wrapped });
    },
  };
  return { server: mock as unknown as McpServer, captured };
}

describe('registerPrompt() — D-36 sanitize-wrapped prompt registration', () => {
  test('success path: Bearer in text content is redacted', async () => {
    const { server, captured } = makeMockServer();
    registerPrompt(
      server,
      'leaky_prompt',
      { description: 'embeds a Bearer token in the user message' },
      async () => ({
        messages: [
          {
            role: 'user' as const,
            content: {
              type: 'text' as const,
              text: 'Daily review for today — Authorization: Bearer fake_token_1234567890 leaked.',
            },
          },
        ],
      }),
    );

    expect(captured).toHaveLength(1);
    const reg = captured[0];
    if (!reg) throw new Error('unreachable');

    const result = await reg.wrapped({});
    expect(result.isError).toBeUndefined();
    const msg = result.messages[0];
    expect(msg?.role).toBe('user');
    if (msg?.content.type !== 'text') throw new Error('expected text content');
    expect(msg.content.text).not.toContain('fake_token_1234567890');
    expect(msg.content.text).toContain('<redacted>');
    // Non-secret payload preserved verbatim.
    expect(msg.content.text).toContain('Daily review');
  });

  test('error path: thrown error returns sanitized user message with isError=true', async () => {
    const { server, captured } = makeMockServer();
    registerPrompt(
      server,
      'throws_prompt',
      { description: 'throws a Bearer token in the message' },
      async () => {
        throw new Error('Bearer fake_thrown_token_xxxxxxxxxx failed assembly');
      },
    );

    const reg = captured[0];
    if (!reg) throw new Error('unreachable');
    const result = await reg.wrapped({});
    expect(result.isError).toBe(true);
    const msg = result.messages[0];
    expect(msg?.role).toBe('user');
    if (msg?.content.type !== 'text') throw new Error('expected text content');
    expect(msg.content.text).not.toContain('fake_thrown_token_xxxxxxxxxx');
    expect(msg.content.text).toContain('Bearer <redacted>');
  });

  test('image content passes through (no string field to sanitize)', async () => {
    const { server, captured } = makeMockServer();
    registerPrompt(
      server,
      'image_prompt',
      { description: 'returns an image content message' },
      async () => ({
        messages: [
          {
            role: 'user' as const,
            content: {
              type: 'image' as const,
              data: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
              mimeType: 'image/png',
            },
          },
        ],
      }),
    );

    const reg = captured[0];
    if (!reg) throw new Error('unreachable');
    const result = await reg.wrapped({});
    expect(result.isError).toBeUndefined();
    const msg = result.messages[0];
    if (msg?.content.type !== 'image') throw new Error('expected image content');
    expect(msg.content.mimeType).toBe('image/png');
    // base64 image payload is preserved verbatim.
    expect(msg.content.data).toContain('iVBORw0KGgo');
  });

  test('clean text passes through unchanged', async () => {
    const { server, captured } = makeMockServer();
    registerPrompt(server, 'clean_prompt', { description: 'clean payload' }, async () => ({
      messages: [
        {
          role: 'user' as const,
          content: {
            type: 'text' as const,
            text: 'Summarize recovery 73 and 4.5h sleep.',
          },
        },
      ],
    }));

    const reg = captured[0];
    if (!reg) throw new Error('unreachable');
    const result = await reg.wrapped({});
    expect(result.isError).toBeUndefined();
    const msg = result.messages[0];
    if (msg?.content.type !== 'text') throw new Error('expected text content');
    expect(msg.content.text).toBe('Summarize recovery 73 and 4.5h sleep.');
  });
});
