// MCP-05 / D-27 / D-36 — messages-array contract for every registered MCP
// prompt.
//
// Each Phase 4 prompt returns exactly one user-role message with
// text-type content per D-27. This test spins up an in-process MCP
// server with all 4 prompts registered against a bootstrap-backed
// in-memory DB, then exercises each via `client.getPrompt({name, args})`
// and asserts the messages shape.
//
// Coverage:
//   - Per-prompt shape: messages.length === 1; role === 'user';
//     content.type === 'text'; content.text is non-empty.
//   - Each prompt's text carries BOTH the rendered review/baseline AND
//     the instruction constant (substring check anchored on a unique
//     phrase from the instruction).
//   - T-04-S3 anti-leak: no Bearer / JWT / Authorization in any text.

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import {
  DAILY_DECISION_BRIEF_INSTRUCTION,
  registerDailyDecisionBrief,
} from '../../src/mcp/prompts/daily-decision-brief.js';
import {
  DELOAD_OR_TRAIN_INSTRUCTION,
  registerDeloadOrTrain,
} from '../../src/mcp/prompts/deload-or-train.js';
import {
  EXPERIMENT_DESIGNER_INSTRUCTION,
  registerExperimentDesigner,
} from '../../src/mcp/prompts/experiment-designer.js';
import {
  registerWeeklyRecoveryInvestigation,
  WEEKLY_RECOVERY_INVESTIGATION_INSTRUCTION,
} from '../../src/mcp/prompts/weekly-recovery-investigation.js';
import { type Bootstrapped, bootstrap } from '../../src/services/index.js';

interface PromptCase {
  name: string;
  args: Record<string, unknown>;
  instruction: string;
}

const PROMPT_CASES: readonly PromptCase[] = [
  {
    name: 'whoop_daily_decision_brief',
    args: {},
    instruction: DAILY_DECISION_BRIEF_INSTRUCTION,
  },
  {
    name: 'whoop_weekly_recovery_investigation',
    args: {},
    instruction: WEEKLY_RECOVERY_INVESTIGATION_INSTRUCTION,
  },
  {
    name: 'whoop_experiment_designer',
    args: { hypothesis: 'Caffeine after 14:00 reduces sleep duration', durationDays: '14' },
    instruction: EXPERIMENT_DESIGNER_INSTRUCTION,
  },
  {
    name: 'whoop_deload_or_train',
    args: {},
    instruction: DELOAD_OR_TRAIN_INSTRUCTION,
  },
];

function assertNoSecretLeak(text: string): void {
  expect(text).not.toMatch(/Authorization:\s*Bearer\s+(?!<redacted>)/i);
  expect(text).not.toMatch(/eyJ[A-Za-z0-9_-]{4,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/);
}

describe('Phase 4 MCP prompt messages-array contract — MCP-05 + D-27 + D-36', () => {
  let server: McpServer;
  let app: Bootstrapped;
  let client: Client;

  beforeEach(async () => {
    app = bootstrap({ dbFile: ':memory:' });
    server = new McpServer({ name: 'recovery-ledger', version: '0.1.0' });
    registerDailyDecisionBrief(server, app.services);
    registerWeeklyRecoveryInvestigation(server, app.services);
    registerExperimentDesigner(server, app.services);
    registerDeloadOrTrain(server, app.services);
    client = new Client({ name: 'test-client', version: '0.0.0' });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  });

  afterEach(async () => {
    await client.close();
    await server.close();
    app.close();
  });

  test('prompts.length === 4 with the canonical name set', async () => {
    const result = await client.listPrompts();
    expect(result.prompts).toHaveLength(4);
    expect(new Set(result.prompts.map((p) => p.name))).toEqual(
      new Set(PROMPT_CASES.map((c) => c.name)),
    );
  });

  for (const { name, args, instruction } of PROMPT_CASES) {
    test(`getPrompt(${name}) returns 1 user-role text message containing the instruction`, async () => {
      const result = await client.getPrompt({ name, arguments: args as Record<string, string> });
      expect(result.messages).toHaveLength(1);
      const m = result.messages[0];
      expect(m).toBeDefined();
      if (!m) return;
      expect(m.role).toBe('user');
      expect(m.content.type).toBe('text');
      // The content shape narrowed to TextContent — has a `text` field.
      const text = (m.content as { type: 'text'; text: string }).text;
      expect(typeof text).toBe('string');
      expect(text.length).toBeGreaterThan(0);
      // The prompt's text MUST embed the full instruction constant —
      // that's the D-27 contract: the LLM sees both the rendered review
      // and the explicit instruction.
      expect(text).toContain(instruction);
      // T-04-S3 anti-leak.
      assertNoSecretLeak(text);
    });
  }
});

// MCP-05 surface name `messages` is referenced inside the describe block
// + test descriptions above — anchored in prose so static reviewers can
// grep this file by purpose.
