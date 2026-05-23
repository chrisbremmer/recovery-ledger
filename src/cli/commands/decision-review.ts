// CLI `decision review` command shim (Plan 04-11 Task 3; DEC-03 + D-20 +
// Pitfall 10 stderr-prompt discipline).
//
// Two modes:
//   - Non-interactive (default + --all): call services.reviewDecisions in
//     'list' mode, render the table to stdout, exit 0.
//   - --interactive: list past-window open decisions; for each, prompt
//     status + optional notes via node:readline/promises configured with
//     `output: process.stderr` (Pitfall 10 — prompts must NEVER touch
//     stdout because the final render reuses stdout for structured output).
//
// The MCP surface (whoop_review_decisions) is NON-interactive per D-20;
// only the CLI knows the readline flow. The service stays mode-agnostic —
// it just takes 'list' or 'update' inputs.
//
// D-32 exit codes:
//   ok               = 0   (also covers ^C during prompt; clean teardown)
//   bootstrap_failed = 1

import { createInterface } from 'node:readline/promises';
import type { Decision } from '../../domain/types/entities.js';
import { renderDecisionList } from '../../formatters/decision.txt.js';
import { formatBootstrapError } from '../../formatters/sync.txt.js';
import { paths } from '../../infrastructure/config/paths.js';
import { isMigrationError } from '../../infrastructure/db/migrate.js';
import { sanitize } from '../../mcp/sanitize.js';
import { type Bootstrapped, bootstrap } from '../../services/index.js';

export const DECISION_REVIEW_EXIT_CODES: Readonly<Record<string, number>> = Object.freeze({
  ok: 0,
  bootstrap_failed: 1,
});

const MS_PER_DAY = 86_400_000;
// D-19 default follow-up window. The interactive prompt fires when the
// decision's followUpDate is null AND the elapsed days exceeds this
// default, OR when followUpDate is non-null AND the date has passed.
const DEFAULT_FOLLOW_UP_DAYS = 7;

export interface RunDecisionReviewCommandOpts {
  /** --all: include followed_up + abandoned in the list. */
  all?: boolean;
  /** --interactive: prompt past-window open decisions for outcome. */
  interactive?: boolean;
}

/** Past-window predicate (D-20): an open decision is past-window when
 *  its followUpDate has elapsed (or, when followUpDate is null, when
 *  the elapsed days since createdAt exceeds the D-19 default 7d). */
function isPastWindow(d: Decision, now: Date): boolean {
  if (d.status !== 'open') return false;
  if (d.followUpDate !== null) {
    const followUp = Date.parse(`${d.followUpDate}T00:00:00.000Z`);
    if (!Number.isFinite(followUp)) return false;
    return now.getTime() > followUp;
  }
  const created = Date.parse(d.createdAt);
  if (!Number.isFinite(created)) return false;
  const elapsedDays = (now.getTime() - created) / MS_PER_DAY;
  return elapsedDays > DEFAULT_FOLLOW_UP_DAYS;
}

/**
 * Orchestration shim:
 *   1. bootstrap() → exit bootstrap_failed
 *   2. reviewDecisions({mode:'list', includeAll})
 *   3. if --interactive: prompt past-window decisions on stderr, update
 *      via reviewDecisions({mode:'update', ...}) per response
 *   4. renderDecisionList → stdout → exit 0
 */
export async function runDecisionReviewCommand(opts: RunDecisionReviewCommandOpts): Promise<void> {
  let app: Bootstrapped;
  try {
    app = bootstrap();
  } catch (err) {
    const body = isMigrationError(err)
      ? formatBootstrapError(err, paths.dbFile)
      : `Bootstrap failed: ${sanitize(String(err))}`;
    process.stdout.write(`${body}\n`, () => {
      process.exit(DECISION_REVIEW_EXIT_CODES.bootstrap_failed);
    });
    return;
  }

  const listResult = await app.services.reviewDecisions({
    mode: 'list',
    includeAll: opts.all === true,
  });
  if (listResult.mode !== 'list') {
    // Defensive — should never happen for a 'list' input.
    app.close();
    process.stdout.write('Decision review returned unexpected shape.\n', () => {
      process.exit(DECISION_REVIEW_EXIT_CODES.ok);
    });
    return;
  }

  let decisions = listResult.decisions;

  if (opts.interactive === true) {
    const now = new Date();
    const pastWindow = decisions.filter((d) => isPastWindow(d, now));
    if (pastWindow.length > 0) {
      // Pitfall 10: readline output stream is process.stderr — prompts
      // never touch stdout. The test asserts this explicitly via a
      // stubbed createInterface.
      const rl = createInterface({ input: process.stdin, output: process.stderr });
      try {
        const updated: Decision[] = [];
        for (const d of pastWindow) {
          const idPrefix = d.id.slice(0, 8);
          const statusAnswer = (
            await rl.question(
              `Status for decision ${idPrefix} (${d.category})? [followed_up / abandoned / skip]: `,
            )
          )
            .trim()
            .toLowerCase();
          if (statusAnswer === 'skip' || statusAnswer === '') continue;
          if (statusAnswer !== 'followed_up' && statusAnswer !== 'abandoned') {
            // Treat unrecognized as skip — no destructive default.
            continue;
          }
          const notesAnswer = (await rl.question('Notes (optional, ENTER to skip): ')).trim();
          const result = await app.services.reviewDecisions({
            mode: 'update',
            id: d.id,
            status: statusAnswer,
            ...(notesAnswer.length > 0 && { notes: notesAnswer }),
          });
          if (result.mode === 'update') {
            updated.push(result.decision);
          }
        }
        // Replace the past-window rows in `decisions` with their updated
        // versions so the final render shows the new state.
        if (updated.length > 0) {
          const updatedById = new Map(updated.map((u) => [u.id, u]));
          decisions = decisions.map((d) => updatedById.get(d.id) ?? d);
        }
      } finally {
        rl.close();
      }
    }
  }

  // pass `new Date()` explicitly to match the MCP tool. The
  // formatter's elapsed-day column uses `now` to compute time-since-decision;
  // omitting it falls back to the default the formatter ships with.
  const body = renderDecisionList(decisions, new Date());
  process.stdout.write(`${body}\n`, () => {
    app.close();
    process.exit(DECISION_REVIEW_EXIT_CODES.ok);
  });
}
