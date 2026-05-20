// `whoop://baseline/30d` MCP resource — D-25 fresh-from-cache discipline.
//
// Returns the trailing-30 baseline subset of the daily review result
// (baseline_window + the implicit per-metric baseline carriers in
// today_state / anomalies). The daily-review service is the single
// source for this projection — running getDailyReview() and surfacing
// just the baseline-relevant slice keeps the resource as a thin
// projection over the existing service surface (no new repo reads, no
// service helper invented for a single resource).

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { Services } from '../../services/index.js';
import { registerResource } from '../register-resource.js';

export function registerBaseline30d(server: McpServer, services: Services): void {
  registerResource(
    server,
    'baseline_30d',
    'whoop://baseline/30d',
    {
      title: 'Trailing-30 baseline window snapshot',
      description:
        'Baseline window + scored-day coverage + per-metric anomaly z-scores for the trailing-30 window. Read fresh on every call (D-25).',
      mimeType: 'application/json',
    },
    async (uri) => {
      const daily = await services.getDailyReview({});
      const snapshot = {
        baseline_window: daily.data_status.baseline_window,
        today_state: daily.today_state,
        anomalies: daily.anomalies,
        confidence: daily.confidence,
      };
      return {
        contents: [{ uri: uri.href, text: JSON.stringify(snapshot), mimeType: 'application/json' }],
      };
    },
  );
}
