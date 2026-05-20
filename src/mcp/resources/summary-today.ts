// `whoop://summary/today` MCP resource — D-25 fresh-from-cache discipline.
//
// Every `resources/read` call triggers a fresh `services.getDailyReview`
// invocation. NO in-memory cache, NO module-level memo map, NO setInterval
// refresh, NO list_changed notifications. Reasons (D-25):
//   (a) Indexed better-sqlite3 reads are microseconds-fast — caching adds
//       complexity without measurable benefit at single-user scale.
//   (b) WAL + busy_timeout handles concurrent reads cleanly.
//   (c) Cross-process invalidation (CLI sync writes → MCP refresh) would
//       need a fs-watcher or signal channel — complexity for ~0 perf
//       benefit. The SQLite cache file IS the shared state.
//   (d) MCP-04 "refresh from the cache" wording is specifically
//       distinguishing from "refresh from the WHOOP API" — every read is
//       fresh from the SQLite cache (on-disk file).
//
// Returns the daily-review result as JSON in `contents[0].text`,
// `mimeType: 'application/json'`. The static URI string forecloses the
// T-04-S4 attacker-controlled-path-segment threat (D-36 + Plan 04-02).

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { Services } from '../../services/index.js';
import { registerResource } from '../register-resource.js';

export function registerSummaryToday(server: McpServer, services: Services): void {
  registerResource(
    server,
    'summary_today',
    'whoop://summary/today',
    {
      title: "Today's review summary",
      description:
        'Daily review result as JSON. Read fresh from the SQLite cache on every call (D-25).',
      mimeType: 'application/json',
    },
    async (uri) => {
      const result = await services.getDailyReview({});
      return {
        contents: [{ uri: uri.href, text: JSON.stringify(result), mimeType: 'application/json' }],
      };
    },
  );
}
