// `whoop_daily_decision_brief` MCP prompt — Plan 04-10 Task 3 + D-27.
//
// Renders the daily review (text form) and asks the LLM for 1-3
// concrete decisions for today. The instruction constant is EXPORTED so
// the formatter-tone contract test (tests/contract/formatter-tone.test.ts)
// can iterate the 4 prompt instructions and lint each against the
// ADR-0005 banned-tone-word list (D-26 layer 2 extension).
//
// MCP-05 + D-27: returns exactly one user-role message via the shared
// buildPromptMessage helper.

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { renderDailyReview } from '../../formatters/daily-review.txt.js';
import type { Services } from '../../services/index.js';
import { registerPrompt } from '../register-prompt.js';
import { buildPromptMessage } from './build.js';

export const DAILY_DECISION_BRIEF_INSTRUCTION =
  "Based on this review, suggest 1-3 concrete decisions for today. Each decision: verb-first single sentence, scoped to today's strain/sleep/recovery picture. Do not invent data.";

export function registerDailyDecisionBrief(server: McpServer, services: Services): void {
  registerPrompt(
    server,
    'whoop_daily_decision_brief',
    {
      description: 'Renders the daily review and asks for 1-3 concrete decisions.',
      argsSchema: { date: z.string().optional() },
    },
    async (args) => {
      const a = (args ?? {}) as { date?: string };
      const result = await services.getDailyReview(a.date === undefined ? {} : { date: a.date });
      const text = `${renderDailyReview(result)}\n\nInstruction: ${DAILY_DECISION_BRIEF_INSTRUCTION}`;
      return buildPromptMessage(text);
    },
  );
}
