// CLI `review daily` command shim (Plan 04-11 Task 1; REV-03 anchor).
//
// Per ARCHITECTURE.md "lite hexagonal" + the sync.ts precedent: this file
// is a ≤5-line orchestration shim over
//   bootstrap() → services.getDailyReview() → renderDailyReview() → stdout → exit(code).
// The catch arms add file weight but the CORE composition stays ≤5 lines.
//
// ADR-0001: this file lives under src/cli/commands/, so Gate B exempts
// it from the console.* prohibition and Gate C exempts it from the
// process.stdout.write prohibition. Output goes to stdout via
// process.stdout.write; structured operational logging continues to flow
// through Pino → stderr inside services.getDailyReview(). No direct
// console calls here either — Gate B's exemption is a license, not an
// instruction.
//
// D-32 exit-code constants (per Plan 02-05 AUTH_EXIT_CODES + Plan 03-12
// SYNC_EXIT_CODES precedent):
//   ok                = 0   daily review rendered successfully
//   failed            = 1   getDailyReview threw after bootstrap succeeded
//   bootstrap_failed  = 1   openDb / migrate threw before service ran

import { renderDailyReview } from '../../formatters/daily-review.txt.js';
import { sanitize } from '../../infrastructure/observability/sanitize.js';
// ARCH-05 (#93): shared bootstrap-error rendering.
import { tryBootstrap } from '../lib/with-bootstrap.js';

export const REVIEW_EXIT_CODES: Readonly<Record<string, number>> = Object.freeze({
  ok: 0,
  failed: 1,
  bootstrap_failed: 1,
});

export interface RunReviewDailyCommandOpts {
  /** ISO yyyy-mm-dd override for the reviewed date. Defaults to the latest
   *  SCORED day in the cache (resolved by the service). Commander passes
   *  the raw string through unchanged. */
  date?: string;
}

/**
 * The ≤5-line orchestration shim per Plan 04-11 + ARCHITECTURE.md CLI policy:
 *   1. bootstrap()           → exit bootstrap_failed on MigrationError / generic
 *   2. services.getDailyReview()
 *   3. renderDailyReview() + process.stdout.write
 *   4. process.exit(REVIEW_EXIT_CODES.ok)
 *
 * The function body weighs more than 5 lines because of the catch arms +
 * sanitization wiring (mirrors sync.ts). The CORE composition — bootstrap,
 * getDailyReview, format, write, exit — is 5 lines.
 */
export async function runReviewDailyCommand(opts: RunReviewDailyCommandOpts): Promise<void> {
  const boot = tryBootstrap(REVIEW_EXIT_CODES.bootstrap_failed ?? 1);
  if (!boot.ok) {
    process.stdout.write(`${boot.body}\n`, () => {
      process.exit(boot.exitCode);
    });
    return;
  }
  const app = boot.app;

  try {
    const result = await app.services.getDailyReview({
      ...(opts.date !== undefined && { date: opts.date }),
    });
    const body = renderDailyReview(result);
    process.stdout.write(`${body}\n`, () => {
      app.close();
      process.exit(REVIEW_EXIT_CODES.ok);
    });
  } catch (err) {
    app.close();
    process.stdout.write(`Review failed: ${sanitize(String(err))}\n`, () => {
      process.exit(REVIEW_EXIT_CODES.failed);
    });
  }
}
