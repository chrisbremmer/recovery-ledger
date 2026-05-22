// D-29 MCP runtime attestation (Phase 4 Plan 04-10 — replaces Phase 3 D-33).
//
// Spins up the Phase 4 MCP server in-process via the SDK's
// InMemoryTransport and asserts the runtime surface counts and name-sets.
// The Phase 3 attestation asserted `toHaveLength(1)` for tools (only
// whoop_doctor); Phase 4 broadens it to:
//
//   - tools.length === 8 (whoop_doctor + 7 new)
//   - resources.length === 6
//   - prompts.length === 4
//
// This file is the load-bearing runtime evidence for MCP-01 (8 tools),
// MCP-04 (6 resources), MCP-05 (4 prompts). Gate H from
// `scripts/ci-grep-gates.sh` is the static regression guard for the
// tool-count shrink path (any `tools.length` strict-equality of 1 in
// non-legacy tests); this test is the runtime guard for the 8/6/4
// expansion.
//
// The test path uses an injected in-memory DB (via the bootstrap()
// `dbFile` override) so the assertion does not touch the user's home
// directory or require migrations to be applied to a real file.

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { registerDailyDecisionBrief } from '../../src/mcp/prompts/daily-decision-brief.js';
import { registerDeloadOrTrain } from '../../src/mcp/prompts/deload-or-train.js';
import { registerExperimentDesigner } from '../../src/mcp/prompts/experiment-designer.js';
import { registerWeeklyRecoveryInvestigation } from '../../src/mcp/prompts/weekly-recovery-investigation.js';
import { registerApiGaps } from '../../src/mcp/resources/api-gaps.js';
import { registerBaseline30d } from '../../src/mcp/resources/baseline-30d.js';
import { registerDataQuality } from '../../src/mcp/resources/data-quality.js';
import { registerDecisionsOpen } from '../../src/mcp/resources/decisions-open.js';
import { registerSummaryToday } from '../../src/mcp/resources/summary-today.js';
import { registerSummaryWeek } from '../../src/mcp/resources/summary-week.js';
import { registerWhoopAddDecision } from '../../src/mcp/tools/whoop-add-decision.js';
import { registerWhoopApiGap } from '../../src/mcp/tools/whoop-api-gap.js';
import { registerWhoopDailyReview } from '../../src/mcp/tools/whoop-daily-review.js';
import { registerWhoopDoctor } from '../../src/mcp/tools/whoop-doctor.js';
import { registerWhoopQueryCache } from '../../src/mcp/tools/whoop-query-cache.js';
import { registerWhoopReviewDecisions } from '../../src/mcp/tools/whoop-review-decisions.js';
import { registerWhoopSync } from '../../src/mcp/tools/whoop-sync.js';
import { registerWhoopWeeklyReview } from '../../src/mcp/tools/whoop-weekly-review.js';
import { type Bootstrapped, bootstrap } from '../../src/services/index.js';

const EXPECTED_TOOL_NAMES = new Set([
  'whoop_doctor',
  'whoop_sync',
  'whoop_daily_review',
  'whoop_weekly_review',
  'whoop_query_cache',
  'whoop_add_decision',
  'whoop_review_decisions',
  'whoop_api_gap',
]);

const EXPECTED_RESOURCE_URIS = new Set([
  'whoop://summary/today',
  'whoop://summary/week',
  'whoop://baseline/30d',
  'whoop://data-quality',
  'whoop://api-gaps',
  'whoop://decisions/open',
]);

const EXPECTED_PROMPT_NAMES = new Set([
  'whoop_daily_decision_brief',
  'whoop_weekly_recovery_investigation',
  'whoop_experiment_designer',
  'whoop_deload_or_train',
]);

// Build the Phase 4 server with all 18 surfaces registered, backed by an
// in-memory DB via the bootstrap()'s `dbFile: ':memory:'` override.
function buildServer(): { server: McpServer; app: Bootstrapped } {
  const app = bootstrap({ dbFile: ':memory:' });
  const server = new McpServer({ name: 'recovery-ledger', version: '0.1.0' });
  registerWhoopDoctor(server, app.services);
  registerWhoopSync(server, app.services);
  registerWhoopDailyReview(server, app.services);
  registerWhoopWeeklyReview(server, app.services);
  registerWhoopQueryCache(server, app.services);
  registerWhoopAddDecision(server, app.services);
  registerWhoopReviewDecisions(server, app.services);
  registerWhoopApiGap(server, app.services);
  registerSummaryToday(server, app.services);
  registerSummaryWeek(server, app.services);
  registerBaseline30d(server, app.services);
  registerDataQuality(server, app.services);
  registerApiGaps(server, app.services);
  registerDecisionsOpen(server, app.services);
  registerDailyDecisionBrief(server, app.services);
  registerWeeklyRecoveryInvestigation(server, app.services);
  registerExperimentDesigner(server, app.services);
  registerDeloadOrTrain(server, app.services);
  return { server, app };
}

describe('D-29 MCP runtime attestation — tools/resources/prompts surface counts', () => {
  let server: McpServer;
  let app: Bootstrapped;
  let client: Client;

  beforeEach(async () => {
    const built = buildServer();
    server = built.server;
    app = built.app;
    client = new Client({ name: 'test-client', version: '0.0.0' });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  });

  afterEach(async () => {
    await client.close();
    await server.close();
    app.close();
  });

  test('tools.length === 8 with the canonical name set (whoop_doctor + 7 new)', async () => {
    const result = await client.listTools();
    expect(result.tools).toHaveLength(8);
    expect(new Set(result.tools.map((t) => t.name))).toEqual(EXPECTED_TOOL_NAMES);
  });

  test('resources.length === 6 with the canonical URI set', async () => {
    const result = await client.listResources();
    expect(result.resources).toHaveLength(6);
    expect(new Set(result.resources.map((r) => r.uri))).toEqual(EXPECTED_RESOURCE_URIS);
  });

  test('prompts.length === 4 with the canonical name set', async () => {
    const result = await client.listPrompts();
    expect(result.prompts).toHaveLength(4);
    expect(new Set(result.prompts.map((p) => p.name))).toEqual(EXPECTED_PROMPT_NAMES);
  });
});
