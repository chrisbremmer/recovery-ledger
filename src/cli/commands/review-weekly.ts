// CLI `review weekly` command shim (Plan 04-11 Task 1; REV-04 anchor).
//
// Mirrors review-daily.ts verbatim — same ≤5-line composition over
//   bootstrap() → services.getWeeklyReview() → renderWeeklyReview() → stdout → exit(code).
//
// A distinct REVIEW_WEEKLY_EXIT_CODES constant ships even though the
// arms are identical to REVIEW_EXIT_CODES (Plan 02-05 D-32 discipline
// per-command typed exit-code constants give each --help block its own
// table without import-coupling between sibling command files).
//
// ADR-0001: this file lives under src/cli/commands/, so Gate B/C exempt
// it from the console.* / process.stdout.write prohibitions.

import { formatBootstrapError } from '../../formatters/sync.txt.js';
import { renderWeeklyReview } from '../../formatters/weekly-review.txt.js';
import { paths } from '../../infrastructure/config/paths.js';
import { isMigrationError } from '../../infrastructure/db/migrate.js';
import { sanitize } from '../../infrastructure/observability/sanitize.js';
import { type Bootstrapped, bootstrap } from '../../services/index.js';

export const REVIEW_WEEKLY_EXIT_CODES: Readonly<Record<string, number>> = Object.freeze({
  ok: 0,
  failed: 1,
  bootstrap_failed: 1,
});

export interface RunReviewWeeklyCommandOpts {
  /** ISO yyyy-mm-dd override for the reviewed date. Defaults to the latest
   *  SCORED day in the cache (resolved by the service). */
  date?: string;
}

/**
 * The ≤5-line shim — bootstrap, getWeeklyReview, format, write, exit.
 * Catch arms mirror review-daily.ts.
 */
export async function runReviewWeeklyCommand(opts: RunReviewWeeklyCommandOpts): Promise<void> {
  let app: Bootstrapped;
  try {
    app = bootstrap();
  } catch (err) {
    const body = isMigrationError(err)
      ? formatBootstrapError(err, paths.dbFile)
      : `Bootstrap failed: ${sanitize(String(err))}`;
    process.stdout.write(`${body}\n`, () => {
      process.exit(REVIEW_WEEKLY_EXIT_CODES.bootstrap_failed);
    });
    return;
  }

  try {
    const result = await app.services.getWeeklyReview({
      ...(opts.date !== undefined && { date: opts.date }),
    });
    const body = renderWeeklyReview(result);
    process.stdout.write(`${body}\n`, () => {
      app.close();
      process.exit(REVIEW_WEEKLY_EXIT_CODES.ok);
    });
  } catch (err) {
    app.close();
    process.stdout.write(`Review failed: ${sanitize(String(err))}\n`, () => {
      process.exit(REVIEW_WEEKLY_EXIT_CODES.failed);
    });
  }
}
