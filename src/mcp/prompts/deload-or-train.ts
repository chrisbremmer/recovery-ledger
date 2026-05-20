// `whoop_deload_or_train` MCP prompt — Plan 04-10 Task 3 + D-27.
//
// Renders the daily review + the trailing-7 strain trend (via
// services.queryCache cycles) and asks the LLM to recommend
// deload/easy/normal/push. Instruction is EXPORTED for the
// formatter-tone test.

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { renderDailyReview } from '../../formatters/daily-review.txt.js';
import type { Services } from '../../services/index.js';
import { registerPrompt } from '../register-prompt.js';
import { buildPromptMessage } from './build.js';

export const DELOAD_OR_TRAIN_INSTRUCTION =
  'Recommend one of: deload, easy training, normal training, push. Cite the specific data points that drove your recommendation.';

export function registerDeloadOrTrain(server: McpServer, services: Services): void {
  registerPrompt(
    server,
    'whoop_deload_or_train',
    {
      description: 'Render the daily review + 7d strain trend, ask for a training recommendation.',
      argsSchema: { date: z.string().optional() },
    },
    async (args) => {
      const a = (args ?? {}) as { date?: string };
      const daily = await services.getDailyReview(a.date === undefined ? {} : { date: a.date });
      const strain = await services.queryCache({ resource: 'cycles', limit: 7 });
      const text = `${renderDailyReview(daily)}\n\nTrailing-7 cycles (count=${strain.count}, truncated=${strain.truncated})\n\nInstruction: ${DELOAD_OR_TRAIN_INSTRUCTION}`;
      return buildPromptMessage(text);
    },
  );
}
