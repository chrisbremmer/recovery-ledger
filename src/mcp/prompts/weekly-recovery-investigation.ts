// `whoop_weekly_recovery_investigation` MCP prompt — Plan 04-10 Task 3
// + D-27.
//
// Renders the weekly review (text form) and asks the LLM to investigate
// the pattern surfaced (or the typed `no_pattern` ADR-0004 positive
// output). Instruction is EXPORTED for the formatter-tone test.

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { renderWeeklyReview } from '../../formatters/weekly-review.txt.js';
import type { Services } from '../../services/index.js';
import { registerPrompt } from '../register-prompt.js';
import { buildPromptMessage } from './build.js';

export const WEEKLY_RECOVERY_INVESTIGATION_INSTRUCTION =
  'Investigate the pattern surfaced (or absence of pattern). Ask 1-2 clarifying questions about lifestyle factors not captured by WHOOP. Then propose a single experiment.';

export function registerWeeklyRecoveryInvestigation(server: McpServer, services: Services): void {
  registerPrompt(
    server,
    'whoop_weekly_recovery_investigation',
    {
      description: 'Renders the weekly review and asks for a pattern investigation.',
      argsSchema: { weekEnding: z.string().optional() },
    },
    async (args) => {
      const a = (args ?? {}) as { weekEnding?: string };
      const result = await services.getWeeklyReview(
        a.weekEnding === undefined ? {} : { date: a.weekEnding },
      );
      const text = `${renderWeeklyReview(result)}\n\nInstruction: ${WEEKLY_RECOVERY_INVESTIGATION_INSTRUCTION}`;
      return buildPromptMessage(text);
    },
  );
}
