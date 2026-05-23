// CLI `decision update <id-or-prefix>` command shim (Plan 04-11 Task 2;
// DEC-02 + D-20 anchor; Pitfall 11 prefix-lookup ambiguity).
//
// The CLI accepts an ID prefix (D-20) and resolves it via
// `decisionsRepo.findByPrefix` BEFORE calling services.reviewDecisions —
// the service only ever sees a full ULID. Three prefix-lookup arms per
// Pitfall 11:
//   - 0 matches    → exit no_match with "no decision matches prefix X"
//   - 1 match      → reviewDecisions({mode:'update', id, status, notes})
//   - ≥2 matches   → exit ambiguous_prefix with a 5-line list of matches
//                    (decision text excluded from the listing per
//                    Pitfall 17 — only the id-prefix + category).
//
// D-32 exit codes:
//   ok               = 0
//   ambiguous_prefix = 1
//   no_match         = 1
//   invalid_input    = 1
//   bootstrap_failed = 1

import { renderDecisionUpdate } from '../../formatters/decision.txt.js';
import { formatBootstrapError } from '../../formatters/sync.txt.js';
import { paths } from '../../infrastructure/config/paths.js';
import { isMigrationError } from '../../infrastructure/db/migrate.js';
import { sanitize } from '../../infrastructure/observability/sanitize.js';
import { type Bootstrapped, bootstrap } from '../../services/index.js';

export const DECISION_UPDATE_EXIT_CODES: Readonly<Record<string, number>> = Object.freeze({
  ok: 0,
  ambiguous_prefix: 1,
  no_match: 1,
  invalid_input: 1,
  bootstrap_failed: 1,
});

/** Number of ambiguous matches to render before truncating. The user
 *  pastes a longer prefix to disambiguate; we don't need to dump the
 *  whole table. */
const AMBIGUOUS_LIST_CAP = 5;

export interface RunDecisionUpdateCommandOpts {
  /** Required --status; one of open / followed_up / abandoned. */
  status: string;
  /** Optional --notes; passed through verbatim to the service. */
  notes?: string;
}

/**
 * Parse --status; must be one of open / followed_up / abandoned (D-20).
 * Undefined or other strings → invalid_input. Commander declares this
 * as a requiredOption so undefined would already produce a Commander
 * error — the guard here is defence-in-depth for direct callers.
 */
export function parseStatus(
  raw: string | undefined,
): { ok: true; value: 'open' | 'followed_up' | 'abandoned' } | { ok: false; message: string } {
  if (raw === 'open' || raw === 'followed_up' || raw === 'abandoned') {
    return { ok: true, value: raw };
  }
  return {
    ok: false,
    message: `Invalid --status: ${sanitize(raw ?? '<missing>')} (allowed: open | followed_up | abandoned)`,
  };
}

/**
 * Orchestration shim:
 *   1. parseStatus → exit invalid_input on failure (BEFORE bootstrap so
 *      a typo doesn't open the DB)
 *   2. bootstrap() → exit bootstrap_failed
 *   3. findByPrefix → arms for 0 / >1 / 1
 *   4. services.reviewDecisions({mode:'update', ...})
 *   5. renderDecisionUpdate + write + exit
 */
export async function runDecisionUpdateCommand(
  idOrPrefix: string,
  opts: RunDecisionUpdateCommandOpts,
): Promise<void> {
  // 1. Validate --status FIRST so a typo never reaches the DB layer.
  const parsedStatus = parseStatus(opts.status);
  if (!parsedStatus.ok) {
    process.stdout.write(`${parsedStatus.message}\n`, () => {
      process.exit(DECISION_UPDATE_EXIT_CODES.invalid_input);
    });
    return;
  }

  // 2. Bootstrap.
  let app: Bootstrapped;
  try {
    app = bootstrap();
  } catch (err) {
    const body = isMigrationError(err)
      ? formatBootstrapError(err, paths.dbFile)
      : `Bootstrap failed: ${sanitize(String(err))}`;
    process.stdout.write(`${body}\n`, () => {
      process.exit(DECISION_UPDATE_EXIT_CODES.bootstrap_failed);
    });
    return;
  }

  // 3. Prefix lookup arms (Pitfall 11). The repo `findByPrefix` normalizes
  // the input to upper-case before the LIKE-scan (ULID alphabet is upper-
  // case Crockford Base32); case insensitivity is handled at the repo.
  const matches = app.repos.decisions.findByPrefix(idOrPrefix);

  if (matches.length === 0) {
    app.close();
    process.stdout.write(`No decision matches prefix ${sanitize(idOrPrefix)}.\n`, () =>
      process.exit(DECISION_UPDATE_EXIT_CODES.no_match),
    );
    return;
  }

  if (matches.length > 1) {
    app.close();
    const listed = matches.slice(0, AMBIGUOUS_LIST_CAP);
    const lines: string[] = [
      `Ambiguous prefix ${sanitize(idOrPrefix)} — ${matches.length} decisions match:`,
    ];
    for (const m of listed) {
      // Render the FULL id + category so the user can copy-paste the
      // unambiguous form into the retry. Decision text excluded per
      // Pitfall 17 (PII-adjacent — never log; never echo into stdout
      // alongside an error message). The user already has the text
      // from when they ran `decision review`.
      lines.push(`  ${m.id}  ${m.category}`);
    }
    if (matches.length > AMBIGUOUS_LIST_CAP) {
      lines.push(`  ...and ${matches.length - AMBIGUOUS_LIST_CAP} more.`);
    }
    process.stdout.write(`${lines.join('\n')}\n`, () => {
      process.exit(DECISION_UPDATE_EXIT_CODES.ambiguous_prefix);
    });
    return;
  }

  // 4 & 5. Single match → update + render. The repo guarantees
  // matches[0] when matches.length === 1; the non-null assertion below
  // is the canonical narrow over the matches.length check.
  const target = matches[0];
  if (target === undefined) {
    app.close();
    process.stdout.write('Prefix lookup returned undefined match.\n', () => {
      process.exit(DECISION_UPDATE_EXIT_CODES.no_match);
    });
    return;
  }

  try {
    const result = await app.services.reviewDecisions({
      mode: 'update',
      id: target.id,
      status: parsedStatus.value,
      ...(opts.notes !== undefined && { notes: opts.notes }),
    });
    if (result.mode !== 'update') {
      // Defensive — reviewDecisions returns 'update' mode for the
      // 'update' input. Surface the unexpected shape as a no_match
      // (the only other arm that returns is 'list', which we never
      // request here).
      app.close();
      process.stdout.write('Decision update returned unexpected shape.\n', () => {
        process.exit(DECISION_UPDATE_EXIT_CODES.no_match);
      });
      return;
    }
    const body = renderDecisionUpdate(result.decision);
    process.stdout.write(`${body}\n`, () => {
      app.close();
      process.exit(DECISION_UPDATE_EXIT_CODES.ok);
    });
  } catch (err) {
    app.close();
    process.stdout.write(`Decision update failed: ${sanitize(String(err))}\n`, () => {
      process.exit(DECISION_UPDATE_EXIT_CODES.no_match);
    });
  }
}
