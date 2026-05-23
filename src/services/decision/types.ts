// Decision-service type contracts — D-19 (`decision add` field surface),
// D-20 (`decision review`/`decision update` flows), D-21 (MCP
// `whoop_review_decisions` dual-mode). Pure type file; no imports
// beyond the Phase 3 `Decision` entity; no runtime behavior.
//
// `ReviewDecisionsInput` + `ReviewDecisionsResult` are the MCP-shaped
// shapes returned by `services.reviewDecisions(input)`. The CLI shim
// constructs the same shape from `decision review` + `decision update`
// flag parsing before calling the service.

import type { Decision } from '../../domain/types/entities.js';

/**
 * `decision add` input per D-19. Single required positional `decision`
 * (the action text); all other fields optional. Defaults documented in
 * the CLI shim:
 *   - `category` defaults to `'general'` at the CLI layer
 *   - `confidence` defaults to `null` (not user-asserted)
 *   - `rationale` / `expectedEffect` default to `null`
 *   - `followUpDate` defaults to `now() + 7d` at the CLI layer
 *
 * `followUpDate` is the already-resolved ISO `yyyy-mm-dd` string. The
 * `--follow-up "in 7d"` syntax-sugar parser lives in
 * `src/cli/commands/decision-add.ts` (RESEARCH §CLI Surface) and
 * returns the resolved ISO date BEFORE calling
 * `services.addDecision(input)` — the service never sees the raw flag.
 *
 * The service ulid-generates the `id` field internally (via the
 * `ulid` npm package installed in Plan 04-01) before calling
 * `decisionsRepo.insert(...)` per Phase 3 D-01.
 */
export interface AddDecisionInput {
  decision: string;
  category?: string;
  rationale?: string | null;
  confidence?: 'low' | 'medium' | 'high' | null;
  expectedEffect?: string | null;
  followUpDate?: string;
}

/**
 * MCP `whoop_review_decisions` dual-mode input per D-21. The single
 * tool serves both list + update; the `mode` discriminator narrows the
 * payload shape:
 *
 * - `mode: 'list'` — list open decisions (or all when `includeAll`).
 *   No mutation, no required fields beyond the discriminator.
 * - `mode: 'update'` — mutate one decision's status + optional notes.
 *   `id` is the full ULID (CLI prefix-resolution happens BEFORE the
 *   MCP boundary — MCP clients pass the full id).
 *
 * Same ADR-0004 forcing-function pattern: the consumer narrows on
 * `mode` before reading mode-specific fields; trying to read
 * `input.status` on a `'list'`-mode payload is a compile error.
 *
 * Why one tool, not two: D-21 holds the MCP-01 tool count at exactly 8.
 * Adding `whoop_update_decision` as a sibling would ship the 9th tool
 * and break the lock.
 */
export type ReviewDecisionsInput =
  | { mode: 'list'; includeAll?: boolean }
  | {
      mode: 'update';
      id: string;
      status: 'open' | 'followed_up' | 'abandoned';
      notes?: string | null;
    };

/**
 * MCP `whoop_review_decisions` dual-mode result per D-21. Mirrors the
 * input discriminator — the consumer narrows on `mode` before reading
 * the payload.
 *
 * - `mode: 'list'` carries the array of matching decisions; empty when
 *   no decisions exist or the filter excluded everything.
 * - `mode: 'update'` carries the SINGLE updated decision row (the new
 *   state after the write).
 */
export type ReviewDecisionsResult =
  | { mode: 'list'; decisions: Decision[] }
  | { mode: 'update'; decision: Decision };

// Removed unused `UpdateDecisionInput` and `updateDecision`
// convenience surfaces. The CLI shim and MCP tool both build a
// `ReviewDecisionsInput.mode: 'update'` payload directly; the separate
// type was a phantom API exported through src/services/index.ts with no
// runtime caller.
