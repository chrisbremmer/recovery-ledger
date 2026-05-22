// `whoop://data-quality` MCP resource — D-25 fresh-from-cache discipline.
//
// Projects the data-status slot of getDailyReview into a standalone
// resource. Surfaces:
//   - latest_sync_at + latest_sync_status (from sync_runs.latestFinished)
//   - staleness_days (today - reviewed_date)
//   - baseline window scored-day count + coverage_pct
//   - missing_resources list (trailing-7 freshness scan)
//
// Same projection-over-services discipline as baseline-30d.ts: no new
// service helper introduced; the daily-review service is the single
// source. Every read is fresh per D-25.

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { Services } from '../../services/index.js';
import { registerResource } from '../register-resource.js';

export function registerDataQuality(server: McpServer, services: Services): void {
  registerResource(
    server,
    'data_quality',
    'whoop://data-quality',
    {
      title: 'Data quality and freshness',
      description:
        'Latest sync timestamp + per-resource freshness + baseline scored-day count. Read fresh on every call (D-25).',
      mimeType: 'application/json',
    },
    async (uri) => {
      const daily = await services.getDailyReview({});
      return {
        contents: [
          {
            uri: uri.href,
            text: JSON.stringify(daily.data_status),
            mimeType: 'application/json',
          },
        ],
      };
    },
  );
}
