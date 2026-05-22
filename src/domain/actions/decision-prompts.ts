// DECISION_PROMPT_CATALOG — fixed decision-prompt catalog per D-23.
//
// Surfaces in the weekly review's `decision_prompt` slot (D-22 typed
// positive output: `{ kind: 'silent' } | { kind: 'none_this_week';
// suggested_text }`). The service layer (Plan 04-07's weekly orchestrator)
// reads this catalog to pick a `suggested_text` when no decision was
// recorded in the trailing 7 days AND a pattern was detected (per-factor
// entry) OR no pattern was detected (generic entry).
//
// Exactly 6 entries per D-23:
//   - 1 generic `no_pattern` entry (when the weekly pattern test returned
//     `kind: 'no_pattern'` and the decision ledger is empty for the week).
//   - 5 per-factor `pattern_detected` entries — one for each D-11
//     candidate (sleep_duration_prior_night, sleep_debt_3d_rolling,
//     day_strain_prior_day, workout_timing_late_evening,
//     hrv_delta_prior_day).
//
// D-26 + ADR-0005 source-layer banned-word lint: the sibling test iterates
// every entry and asserts `containsBannedToneToken(entry.text).hit === false`
// at module load. Same defence-in-depth posture as `ACTION_CATALOG`.
//
// Pure data file: no I/O, no logger, no runtime side effects.

import type { CandidateName } from '../patterns/types.js';

export interface DecisionPromptCatalogEntry {
  readonly id: string;
  readonly trigger: 'no_pattern' | 'pattern_detected';
  readonly factor?: CandidateName;
  readonly text: string;
}

/**
 * Frozen 6-entry decision-prompt catalog. The CLI quoting style mirrors
 * Plan 04-11's `decision add` shim: `recovery-ledger decision add "<text>"`
 * with an optional `--category` flag. Entries are written so the suggested
 * text remains a behavioral framing (REQUIREMENTS Out of Scope: no medical
 * advice).
 */
export const DECISION_PROMPT_CATALOG: readonly DecisionPromptCatalogEntry[] = Object.freeze([
  {
    id: 'no-pattern-generic',
    trigger: 'no_pattern',
    text: 'Record a decision: recovery-ledger decision add "<your action>".',
  },
  {
    id: 'sleep-duration-shorter',
    trigger: 'pattern_detected',
    factor: 'sleep_duration_prior_night',
    text: 'Sleep on worst-recovery days was shorter. Record a decision: recovery-ledger decision add "sleep at least seven hours on training days" --category sleep.',
  },
  {
    id: 'sleep-debt-rolling',
    trigger: 'pattern_detected',
    factor: 'sleep_debt_3d_rolling',
    text: 'Sleep debt over the prior three days tracked with worst-recovery days. Record a decision: recovery-ledger decision add "cap nightly sleep debt under sixty minutes" --category sleep.',
  },
  {
    id: 'day-strain-prior-day',
    trigger: 'pattern_detected',
    factor: 'day_strain_prior_day',
    text: 'Strain on the prior day tracked with worst-recovery days. Record a decision: recovery-ledger decision add "cap prior-day strain under fourteen" --category training.',
  },
  {
    id: 'workout-timing-late-evening',
    trigger: 'pattern_detected',
    factor: 'workout_timing_late_evening',
    text: 'Late-evening workouts tracked with worst-recovery days. Record a decision: recovery-ledger decision add "move evening sessions before seven pm" --category training.',
  },
  {
    id: 'hrv-delta-prior-day',
    trigger: 'pattern_detected',
    factor: 'hrv_delta_prior_day',
    text: 'Prior-day HRV drop tracked with worst-recovery days. Record a decision: recovery-ledger decision add "use a low-HRV day as an easy day" --category recovery.',
  },
] as const) satisfies readonly DecisionPromptCatalogEntry[];
