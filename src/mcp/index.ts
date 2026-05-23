// MCP stdio server entry point.
//
// Speaks JSON-RPC on stdout; everything else (including any logging) MUST go to
// stderr via the Pino logger in `src/infrastructure/config/logger.ts`. See
// CLAUDE.md §Critical Rules — MCP stdout purity (ADR-0001).
//
// Phase 4 Plan 04-10 — switched from `createServices()` (lightweight, no DB)
// to `bootstrap()` so the new DB-backed services (review/decision/cache)
// have an open SQLite handle. Per RESEARCH A10 this adds ~10ms to MCP
// startup; bounded and amortized over the long-running stdio session.
//
// Process lifecycle: the MCP server runs until stdin closes (StdioServerTransport
// resolves its read loop). SIGINT + SIGTERM both call `app.close()` so the
// SQLite handle is released cleanly before exit — mirrors the Plan 03-12
// CLI sync shim discipline.

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { logger } from '../infrastructure/config/logger.js';
import { isMigrationError } from '../infrastructure/db/migrate.js';
import { bootstrap } from '../services/index.js';
import { registerDailyDecisionBrief } from './prompts/daily-decision-brief.js';
import { registerDeloadOrTrain } from './prompts/deload-or-train.js';
import { registerExperimentDesigner } from './prompts/experiment-designer.js';
import { registerWeeklyRecoveryInvestigation } from './prompts/weekly-recovery-investigation.js';
import { registerApiGaps } from './resources/api-gaps.js';
import { registerBaseline30d } from './resources/baseline-30d.js';
import { registerDataQuality } from './resources/data-quality.js';
import { registerDecisionsOpen } from './resources/decisions-open.js';
import { registerSummaryToday } from './resources/summary-today.js';
import { registerSummaryWeek } from './resources/summary-week.js';
import { serializeError } from '../infrastructure/observability/sanitize.js';
import { registerWhoopAddDecision } from './tools/whoop-add-decision.js';
import { registerWhoopApiGap } from './tools/whoop-api-gap.js';
import { registerWhoopDailyReview } from './tools/whoop-daily-review.js';
import { registerWhoopDoctor } from './tools/whoop-doctor.js';
import { registerWhoopQueryCache } from './tools/whoop-query-cache.js';
import { registerWhoopReviewDecisions } from './tools/whoop-review-decisions.js';
import { registerWhoopSync } from './tools/whoop-sync.js';
import { registerWhoopWeeklyReview } from './tools/whoop-weekly-review.js';

const server = new McpServer({ name: 'recovery-ledger', version: '0.1.0' });
// Phase 4 Plan 04-10: support a `MCP_DB_FILE` env override so the
// stdout-purity dist roundtrip test (and any future smoke harness) can
// route bootstrap at a `:memory:` DB without touching the user's
// ~/.recovery-ledger directory. Production callers leave the env unset
// and pay the normal paths.dbFile resolution.
const dbFileOverride = process.env.MCP_DB_FILE;
// Review #20: bootstrap can throw MigrationError (corrupt DB, missing
// migration dir, schema-version skew). An unhandled throw at this
// top-level site exits the process with a stack trace on stderr that
// agents see as a generic "MCP startup failed" with no remediation hint.
// Surface a structured log with backupPath when present, then exit 1.
let app: ReturnType<typeof bootstrap>;
try {
  app = bootstrap(dbFileOverride === undefined ? {} : { dbFile: dbFileOverride });
} catch (err) {
  if (isMigrationError(err)) {
    logger.fatal(
      {
        event: 'bootstrap_failed',
        kind: err.kind,
        backupPath: err.backupPath,
        err: serializeError(err),
      },
      'MCP startup failed (migration error); pre-migration backup at the path above. Run `recovery-ledger doctor` for diagnostics.',
    );
  } else {
    logger.fatal(
      { event: 'bootstrap_failed', err: serializeError(err) },
      'MCP startup failed; run `recovery-ledger doctor` for diagnostics.',
    );
  }
  process.exit(1);
}

// 8 tools (MCP-01 + D-29)
registerWhoopDoctor(server, app.services);
registerWhoopSync(server, app.services);
registerWhoopDailyReview(server, app.services);
registerWhoopWeeklyReview(server, app.services);
registerWhoopQueryCache(server, app.services);
registerWhoopAddDecision(server, app.services);
registerWhoopReviewDecisions(server, app.services);
registerWhoopApiGap(server, app.services);

// 6 resources (MCP-04 + D-25 fresh-from-cache discipline)
registerSummaryToday(server, app.services);
registerSummaryWeek(server, app.services);
registerBaseline30d(server, app.services);
registerDataQuality(server, app.services);
registerApiGaps(server, app.services);
registerDecisionsOpen(server, app.services);

// 4 prompts (MCP-05 + D-27)
registerDailyDecisionBrief(server, app.services);
registerWeeklyRecoveryInvestigation(server, app.services);
registerExperimentDesigner(server, app.services);
registerDeloadOrTrain(server, app.services);

// Lifecycle: clean SQLite close on SIGINT/SIGTERM. `process.once` so a
// second signal does not double-close (better-sqlite3 swallows the second
// close, but we keep the contract clean). Mirrors Plan 03-12.
process.once('SIGINT', () => {
  app.close();
  process.exit(0);
});
process.once('SIGTERM', () => {
  app.close();
  process.exit(0);
});

const transport = new StdioServerTransport();
await server.connect(transport);
