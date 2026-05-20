// Decision-service orchestration — D-19 (smart defaults on add), D-20
// (review/update flows), D-21 (dual-mode reviewDecisions discriminated on
// `mode`). This is the composition seam between the CLI / MCP surfaces and
// the decisions repository; the ULID id is generated HERE, before the repo
// insert, per Phase 3 D-01 + Plan 04-06 D-19.
//
// ADR-0001 (MCP stdout purity): no console.*; structured logs flow through
// Pino into stderr only. ADR-0003 + Pitfall 17: decision TEXT must never
// appear in log payloads — only the ULID id (non-PII) and the category
// label.
//
// Transport-agnostic: the same service is consumed by `recovery-ledger
// decision add` (CLI Plan 04-11) and the `whoop_add_decision` MCP tool
// (Plan 04-10). The CLI shim resolves any "in 7d"-style follow-up syntax
// BEFORE calling here — the service only sees the resolved ISO date.

import type { Logger } from 'pino';
import { ulid } from 'ulid';
import type { Decision } from '../../domain/types/entities.js';
import type { DecisionsRepo } from '../../infrastructure/db/repositories/decisions.repo.js';
import type {
  AddDecisionInput,
  ReviewDecisionsInput,
  ReviewDecisionsResult,
} from './types.js';

// ----------------------------------------------------------------------------
// Dependency-injection surfaces. Each service function takes the narrowest
// `deps` shape it needs — `addDecision` reads the clock; `reviewDecisions`
// does not. Production wiring (Plan 04-08 bootstrap) supplies both from
// the same root.
// ----------------------------------------------------------------------------

export interface AddDecisionDeps {
  repos: { decisions: DecisionsRepo };
  clock: () => Date;
  logger: Logger;
}

export interface ReviewDecisionsDeps {
  repos: { decisions: DecisionsRepo };
  logger: Logger;
}

/**
 * Add a new decision. Generates a ULID id, applies D-19 smart defaults
 * (category defaults to `'general'`; optional fields default to `null`),
 * persists via the repo's BEGIN-IMMEDIATE write path, then reads back
 * through `byId` to return the freshly-persisted row (including the
 * schema-defaulted `status='open'` + `outcome_notes=null` columns).
 *
 * Pitfall 17: the decision text is PII-adjacent and never appears in the
 * structured log payload — `{ event, id, category }` only.
 */
export async function addDecision(
  input: AddDecisionInput,
  deps: AddDecisionDeps,
): Promise<Decision> {
  const id = ulid();
  const createdAt = deps.clock().toISOString();
  deps.repos.decisions.insert({
    id,
    createdAt,
    category: input.category ?? 'general',
    decision: input.decision,
    rationale: input.rationale ?? null,
    confidence: input.confidence ?? null,
    expectedEffect: input.expectedEffect ?? null,
    followUpDate: input.followUpDate ?? null,
  });
  const created = deps.repos.decisions.byId(id);
  if (created === null) {
    throw new Error(`addDecision: insert succeeded but byId returned null for ${id}`);
  }
  deps.logger.info({ event: 'decision_added', id, category: created.category });
  return created;
}

/**
 * D-21 dual-mode dispatch. The single tool serves both the list and the
 * outcome-write flows; the consumer narrows on `mode` to read the
 * mode-specific payload (input.includeAll vs input.id+status+notes).
 *
 * `mode='list'` returns `listAll()` when `includeAll === true`, else
 * `listOpen()`. `mode='update'` writes via `updateOutcome`, reads back
 * via `byId`, and throws when the id does not resolve (a 0-rows-changed
 * update + a still-null byId is the only ambiguity surface).
 */
export async function reviewDecisions(
  input: ReviewDecisionsInput,
  deps: ReviewDecisionsDeps,
): Promise<ReviewDecisionsResult> {
  if (input.mode === 'list') {
    const decisions =
      input.includeAll === true ? deps.repos.decisions.listAll() : deps.repos.decisions.listOpen();
    return { mode: 'list', decisions };
  }
  // input.mode === 'update'
  deps.repos.decisions.updateOutcome(input.id, input.status, input.notes ?? null);
  const decision = deps.repos.decisions.byId(input.id);
  if (decision === null) {
    throw new Error(`reviewDecisions: decision not found after update: ${input.id}`);
  }
  deps.logger.info({ event: 'decision_updated', id: input.id, status: input.status });
  return { mode: 'update', decision };
}

