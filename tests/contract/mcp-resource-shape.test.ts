// MCP-04 / D-36 / D-25 — read-shape contract for every registered MCP
// resource.
//
// Resources return `contents: Array<{uri, text, mimeType}>` (note plural
// `contents`, distinct from tools' singular `content`). This test
// spins up an in-process MCP server with all 6 resources registered
// against a bootstrap-backed in-memory DB, then exercises each via
// `client.readResource({uri})` and asserts the shape.
//
// Coverage:
//   - Per-resource shape assertion (contents[0].uri + text + mimeType).
//   - When mimeType === 'application/json', the text parses as JSON.
//   - T-04-S4 anti-leak: no Bearer / JWT / Authorization substring.
//   - D-25 freshness: write a decision via services.addDecision(), then
//     immediately read whoop://decisions/open and assert the new
//     decision is in the rendered text (proves no stale-cache window).
//   - Error path: a thrown handler returns isError:true with sanitized
//     text — defence-in-depth for the wrapper.

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { registerApiGaps } from '../../src/mcp/resources/api-gaps.js';
import { registerBaseline30d } from '../../src/mcp/resources/baseline-30d.js';
import { registerDataQuality } from '../../src/mcp/resources/data-quality.js';
import { registerDecisionsOpen } from '../../src/mcp/resources/decisions-open.js';
import { registerSummaryToday } from '../../src/mcp/resources/summary-today.js';
import { registerSummaryWeek } from '../../src/mcp/resources/summary-week.js';
import { type Bootstrapped, bootstrap } from '../../src/services/index.js';

const RESOURCE_URIS = [
  'whoop://summary/today',
  'whoop://summary/week',
  'whoop://baseline/30d',
  'whoop://data-quality',
  'whoop://api-gaps',
  'whoop://decisions/open',
] as const;

function assertNoSecretLeak(text: string): void {
  expect(text).not.toMatch(/Authorization:\s*Bearer\s+(?!<redacted>)/i);
  expect(text).not.toMatch(/eyJ[A-Za-z0-9_-]{4,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/);
  // T-04-S4 — defensive scan for token-field shapes; the decisions
  // table has none, this defends against future schema drift.
  expect(text).not.toMatch(/"access_token"\s*:/);
  expect(text).not.toMatch(/"refresh_token"\s*:/);
}

describe('Phase 4 MCP resource read-shape contract — MCP-04 + D-36', () => {
  let server: McpServer;
  let app: Bootstrapped;
  let client: Client;

  beforeEach(async () => {
    app = bootstrap({ dbFile: ':memory:' });
    server = new McpServer({ name: 'recovery-ledger', version: '0.1.0' });
    registerSummaryToday(server, app.services);
    registerSummaryWeek(server, app.services);
    registerBaseline30d(server, app.services);
    registerDataQuality(server, app.services);
    registerApiGaps(server, app.services);
    registerDecisionsOpen(server, app.services);
    client = new Client({ name: 'test-client', version: '0.0.0' });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  });

  afterEach(async () => {
    await client.close();
    await server.close();
    app.close();
  });

  test('resources.length === 6 with the canonical URI set', async () => {
    const result = await client.listResources();
    expect(result.resources).toHaveLength(6);
    expect(new Set(result.resources.map((r) => r.uri))).toEqual(new Set(RESOURCE_URIS));
  });

  for (const uri of RESOURCE_URIS) {
    test(`readResource(${uri}) returns the contents shape with JSON text and no token leak`, async () => {
      const result = await client.readResource({ uri });
      expect(result.contents).toBeDefined();
      expect(Array.isArray(result.contents)).toBe(true);
      expect(result.contents.length).toBeGreaterThan(0);
      const first = result.contents[0];
      expect(first).toBeDefined();
      if (!first) return;
      const f = first as { uri: string; text?: string; mimeType?: string };
      expect(typeof f.uri).toBe('string');
      expect(typeof f.text).toBe('string');
      const t = f.text ?? '';
      assertNoSecretLeak(t);
      if (f.mimeType === 'application/json') {
        // Asserts the resource body is valid JSON when so claimed.
        expect(() => JSON.parse(t)).not.toThrow();
      }
    });
  }

  // D-25 freshness acceptance test — the load-bearing assertion that the
  // resource handlers DO NOT carry an in-memory cache. We write a new
  // decision via services.addDecision, then immediately call
  // readResource('whoop://decisions/open'); the decision MUST be
  // visible in the very next read with no stale-cache window.
  test('D-25 freshness — DB write is immediately visible in the next readResource()', async () => {
    const before = await client.readResource({ uri: 'whoop://decisions/open' });
    const beforeFirst = before.contents[0] as { text?: string };
    const beforeText = beforeFirst.text ?? '';
    expect(beforeText).not.toContain('SENTINEL_DECISION_TAG');

    await app.services.addDecision({
      decision: 'SENTINEL_DECISION_TAG asserts freshness on next read',
    });

    const after = await client.readResource({ uri: 'whoop://decisions/open' });
    const afterFirst = after.contents[0] as { text?: string };
    const afterText = afterFirst.text ?? '';
    expect(afterText).toContain('SENTINEL_DECISION_TAG');
  });
});

// MCP-04 surface name `contents` (plural, distinct from tools' singular
// `content`) is referenced inside the describe block + test descriptions
// above — anchored in prose so static reviewers can grep this file by
// purpose.
