// CLI `decision add` command shim (Plan 04-11 Task 2; DEC-01 + D-19 anchor).
//
// Per ARCHITECTURE.md "lite hexagonal" + the sync.ts precedent: this file
// is an orchestration shim over
//   bootstrap() → services.addDecision() → renderDecisionDetail() → stdout → exit(code).
// The validator weight (parseFollowUp + parseConfidence) lives at the CLI
// boundary so the service never sees raw flag strings.
//
// D-19 smart defaults (CLI-applied):
//   - category   → 'general' (Commander provides via .option(..., 'general'))
//   - confidence → null      (the parseConfidence undefined arm)
//   - follow-up  → now() + 7 days (parseFollowUp undefined arm)
//
// D-32 exit codes per Plan 02-05 AUTH_EXIT_CODES + Plan 03-12 SYNC_EXIT_CODES
// precedent:
//   ok                = 0   decision written + readback rendered
//   invalid_input     = 1   parseConfidence or parseFollowUp rejected the flag
//   bootstrap_failed  = 1   openDb / migrate threw
//   db_write_failed   = 1   addDecision threw during the repo insert
//
// T-04-S2 mitigations (Plan 04-02 threat register):
//   (a) Commander parses argv as an array — no shell expansion.
//   (b) drizzle prepared statements at the repo layer — no string interp.
//   (c) Error messages echo user input only through sanitize() so a token
//       pattern in a malformed flag never reaches stdout.
// The decision-add.test.ts T-04-S2 fixtures verify (a) + (b) by asserting
// the decision text round-trips through the service unchanged.

import { renderDecisionDetail } from '../../formatters/decision.txt.js';
import { formatBootstrapError } from '../../formatters/sync.txt.js';
import { paths } from '../../infrastructure/config/paths.js';
import { isMigrationError } from '../../infrastructure/db/migrate.js';
import { sanitize } from '../../mcp/sanitize.js';
import { type Bootstrapped, bootstrap } from '../../services/index.js';

export const DECISION_ADD_EXIT_CODES: Readonly<Record<string, number>> = Object.freeze({
  ok: 0,
  invalid_input: 1,
  bootstrap_failed: 1,
  db_write_failed: 1,
});

// D-19 smart-default cap. 365d is the upper sanity bound on a follow-up
// window — a year-out follow-up is almost certainly a flag typo. Matches
// Commander's --days <n> sanity cap shape from src/cli/index.ts.
const MAX_FOLLOW_UP_DAYS = 365;
const MS_PER_DAY = 86_400_000;

export interface RunDecisionAddCommandOpts {
  /** Optional --category; Commander default is 'general' so this is
   *  always populated when invoked through the binary. Tests may
   *  omit and rely on the service-layer default. */
  category?: string;
  /** Optional --rationale. */
  rationale?: string;
  /** Optional --confidence; parsed by parseConfidence(). */
  confidence?: string;
  /** Optional --expected-effect. */
  expectedEffect?: string;
  /** Optional --follow-up; parsed by parseFollowUp() into yyyy-mm-dd. */
  followUp?: string;
}

/**
 * Parse the --follow-up flag per RESEARCH §CLI Surface §--follow-up parser.
 * Three accepted shapes:
 *   - undefined        → D-19 default: now() + 7d
 *   - "in <N>d"        → now() + N days (capped at 365 per the sanity bound)
 *   - ISO yyyy-mm-dd   → that exact date
 * Anything else (free-form English, garbled ISO, etc.) is rejected with a
 * sanitized message; the caller wires the failure arm to stdout + exit
 * invalid_input.
 *
 * `clock` is injected so the test can pin a deterministic now() without
 * mucking with Date.now() globally.
 */
export function parseFollowUp(
  raw: string | undefined,
  clock: () => Date,
): { ok: true; value: string } | { ok: false; message: string } {
  if (raw === undefined) {
    const d = new Date(clock().getTime() + 7 * MS_PER_DAY);
    return { ok: true, value: d.toISOString().slice(0, 10) };
  }
  const inNd = /^in\s+(\d+)d$/i.exec(raw);
  if (inNd?.[1]) {
    const n = Number.parseInt(inNd[1], 10);
    if (n > MAX_FOLLOW_UP_DAYS) {
      return {
        ok: false,
        message: `Invalid --follow-up: ${n} exceeds ${MAX_FOLLOW_UP_DAYS} days.`,
      };
    }
    const d = new Date(clock().getTime() + n * MS_PER_DAY);
    return { ok: true, value: d.toISOString().slice(0, 10) };
  }
  // Strict yyyy-mm-dd ISO check (Review #12). `new Date(raw)` happily
  // accepts MM/DD/YYYY, "March 15 2026", etc. — implementation-defined
  // shapes that silently round-trip to a non-NaN Date. We only want the
  // explicit ISO date form.
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    return {
      ok: false,
      message: `Invalid --follow-up: ${sanitize(raw)} is not "in Nd" or yyyy-mm-dd.`,
    };
  }
  const parsed = new Date(`${raw}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime())) {
    return {
      ok: false,
      message: `Invalid --follow-up: ${sanitize(raw)} is not a valid date.`,
    };
  }
  return { ok: true, value: parsed.toISOString().slice(0, 10) };
}

/**
 * Parse the --confidence flag — must be one of low / medium / high (D-19).
 * undefined → null (the service-level default). Anything else → invalid.
 */
export function parseConfidence(
  raw: string | undefined,
): { ok: true; value: 'low' | 'medium' | 'high' | null } | { ok: false; message: string } {
  if (raw === undefined) return { ok: true, value: null };
  if (raw === 'low' || raw === 'medium' || raw === 'high') {
    return { ok: true, value: raw };
  }
  return {
    ok: false,
    message: `Invalid --confidence: ${sanitize(raw)} (allowed: low | medium | high)`,
  };
}

/**
 * Orchestration shim:
 *   1. validate --confidence + --follow-up  → exit invalid_input on failure
 *   2. bootstrap()                          → exit bootstrap_failed
 *   3. services.addDecision()               → exit db_write_failed on throw
 *   4. renderDecisionDetail + write + exit  → exit 0
 *
 * The CORE composition is the bootstrap → service → format → write → exit
 * 5-line core (mirrors sync.ts).
 */
export async function runDecisionAddCommand(
  text: string,
  opts: RunDecisionAddCommandOpts,
): Promise<void> {
  // 1. Validate --confidence.
  const parsedConfidence = parseConfidence(opts.confidence);
  if (!parsedConfidence.ok) {
    process.stdout.write(`${parsedConfidence.message}\n`, () => {
      process.exit(DECISION_ADD_EXIT_CODES.invalid_input);
    });
    return;
  }

  // 2. Validate --follow-up against a live clock (D-19 default).
  const parsedFollowUp = parseFollowUp(opts.followUp, () => new Date());
  if (!parsedFollowUp.ok) {
    process.stdout.write(`${parsedFollowUp.message}\n`, () => {
      process.exit(DECISION_ADD_EXIT_CODES.invalid_input);
    });
    return;
  }

  // 3. Bootstrap.
  let app: Bootstrapped;
  try {
    app = bootstrap();
  } catch (err) {
    const body = isMigrationError(err)
      ? formatBootstrapError(err, paths.dbFile)
      : `Bootstrap failed: ${sanitize(String(err))}`;
    process.stdout.write(`${body}\n`, () => {
      process.exit(DECISION_ADD_EXIT_CODES.bootstrap_failed);
    });
    return;
  }

  // 4. Service call + render. addDecision throws on repo errors only;
  // a Drizzle UNIQUE violation (ULID collision) is the only realistic
  // surface, and the message is opaque enough to pass through sanitize
  // unchanged.
  try {
    const created = await app.services.addDecision({
      decision: text,
      category: opts.category ?? 'general',
      ...(opts.rationale !== undefined && { rationale: opts.rationale }),
      ...(parsedConfidence.value !== null && { confidence: parsedConfidence.value }),
      ...(opts.expectedEffect !== undefined && { expectedEffect: opts.expectedEffect }),
      followUpDate: parsedFollowUp.value,
    });
    const body = renderDecisionDetail(created);
    process.stdout.write(`${body}\n`, () => {
      app.close();
      process.exit(DECISION_ADD_EXIT_CODES.ok);
    });
  } catch (err) {
    app.close();
    process.stdout.write(`Decision write failed: ${sanitize(String(err))}\n`, () => {
      process.exit(DECISION_ADD_EXIT_CODES.db_write_failed);
    });
  }
}
