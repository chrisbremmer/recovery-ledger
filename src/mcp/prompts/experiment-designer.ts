// `whoop_experiment_designer` MCP prompt — Plan 04-10 Task 3 + D-27.
//
// Renders the daily-review baseline snapshot + the user-supplied
// hypothesis and asks the LLM to design a pre-registered experiment.
// Instruction is EXPORTED for the formatter-tone test.

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { renderDailyReview } from '../../formatters/daily-review.txt.js';
import type { Services } from '../../services/index.js';
import { registerPrompt } from '../register-prompt.js';
import { buildPromptMessage } from './build.js';

export const EXPERIMENT_DESIGNER_INSTRUCTION =
  'Design an experiment with a clear pre-registered metric (one of: HRV, RHR, sleep duration, recovery score, day strain) and a stop condition.';

// Parse the wire-string duration arg. MCP wire types coerce all prompt
// args to strings; we accept a numeric-string and fall back to 14 days
// for anything unparseable. Pulled out of the handler body to keep the
// shim at ≤ 5 statements (MCP-03).
function parseDuration(raw: string | undefined): number {
  if (raw === undefined) return 14;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : 14;
}

export function registerExperimentDesigner(server: McpServer, services: Services): void {
  registerPrompt(
    server,
    'whoop_experiment_designer',
    {
      description: 'Render the baseline snapshot and ask for an experiment design.',
      argsSchema: { hypothesis: z.string(), durationDays: z.string().optional() },
    },
    async (args) => {
      const a = (args ?? {}) as { hypothesis?: string; durationDays?: string };
      const result = await services.getDailyReview({});
      const header = `Hypothesis: ${a.hypothesis ?? '(none supplied)'}\nProposed duration: ${parseDuration(a.durationDays)} days`;
      const text = `${header}\n\n${renderDailyReview(result)}\n\nInstruction: ${EXPERIMENT_DESIGNER_INSTRUCTION}`;
      return buildPromptMessage(text);
    },
  );
}
