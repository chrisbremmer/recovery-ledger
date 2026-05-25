// ScoreState closed tuple — D-03 + ADR-0003. Three-layer type system (Layer 2):
// the discriminator literal that every scored WHOOP entity carries on the wire
// (snake_case) and in the domain (camelCase). The discriminated unions in
// `src/domain/types/entities.ts` (camelCase `scoreState`) and
// `src/domain/schemas/whoop-api.ts` (snake_case `score_state`) both derive
// from this tuple.
//
// ADR-0003 is LOAD-BEARING: domain code MUST narrow on the discriminator
// before reading any score-only field. Reading `.recoveryScore` off a
// `Recovery` union without first narrowing on `scoreState === 'SCORED'` is
// a compile error — the field exists only on the `ScoredRecovery` variant.
// This forcing function defends Pitfall 3 (silent PENDING_SCORE / UNSCORABLE
// consumption as zero, which destroys baselines).
//
// Pure type file: no imports, no Zod, no I/O. Consumed by:
//   - src/domain/types/entities.ts (Wave 1b — same plan, this file)
//   - src/domain/schemas/whoop-api.ts (Wave 1b — same plan, this file)
//   - src/domain/schemas/entities.ts (Wave 1b — same plan, this file)
//   - future repository files (Wave 3) for the default
//     `WHERE score_state = 'SCORED'` clause per D-04
//   - future baseline service (Phase 4) for confidence-tier gating
//     against the SCORED count per ADR-0003 §Consequences

/**
 * Closed three-literal tuple of WHOOP `score_state` values. The tuple form
 * (instead of a bare enum) lets `ScoreState` derive via `(typeof
 * SCORE_STATES)[number]` AND lets `SCORE_STATES_SET` provide a runtime
 * membership check from the same single source — adding a fourth literal
 * (if WHOOP ever extends the wire format) requires only this one edit.
 *
 * Same pattern as `AUTH_ERROR_KINDS` in `src/infrastructure/whoop/errors.ts`
 * (closed-set discriminator with type + duck-type set derived from one
 * tuple). The convention is established Phase 2 (Plan 02-01) and reused
 * here for the score-state discriminator.
 */
export const SCORE_STATES = ['SCORED', 'PENDING_SCORE', 'UNSCORABLE'] as const;

/**
 * Domain-layer discriminator literal. Used as the `scoreState` field type on
 * `Cycle | Recovery | Sleep | Workout` discriminated unions in
 * `src/domain/types/entities.ts`. The raw Zod schemas in
 * `src/domain/schemas/whoop-api.ts` discriminate on `score_state`
 * (snake_case, matching the wire); domain entities discriminate on
 * `scoreState` (camelCase). The normalizer at the boundary maps one to
 * the other.
 */
export type ScoreState = (typeof SCORE_STATES)[number];

/**
 * Runtime membership check for duck-typing at boundaries (e.g., when a
 * caller has an `unknown` value and needs to check `'SCORED' | 'PENDING_SCORE'
 * | 'UNSCORABLE'` membership without first parsing through Zod). The
 * construction is computed once at module load — `SCORE_STATES` is
 * `readonly`, so the set is structurally immutable.
 *
 * Use cases:
 *   - Validating user-provided filter flags (future `--include-unscored`
 *     style CLI option, Phase 4 / Phase 5).
 *   - Repository assertions on row data before narrowing the union.
 */
export const SCORE_STATES_SET: ReadonlySet<ScoreState> = new Set(SCORE_STATES);

/**
 * #16 — Branded type for collections that have been narrowed to
 * `score_state === 'SCORED'` only. ADR-0003 §Enforcement promised this
 * type plus a `filterScored` helper as the only legal path to a SCORED-
 * only collection. The default `byRange()` filter on the four scored
 * repos already returns SCORED-only rows at runtime; this brand puts
 * the invariant on the type level so a Phase 4 baseline math caller
 * that takes `ScoredOnly<Cycle>[]` is statically prevented from being
 * handed a list that includes PENDING_SCORE / UNSCORABLE rows.
 *
 * The brand is structural-only at runtime — it does not allocate or
 * change row identity. The cast inside `filterScored` is the single
 * narrowing site.
 */
export type ScoredOnly<T extends { scoreState: ScoreState }> = T & {
  readonly __brand: 'ScoredOnly';
};

/**
 * #16 — Cast a heterogeneous entity collection to its SCORED-only
 * brand. Filters out any row whose `scoreState !== 'SCORED'`, then
 * applies the brand. Downstream type signatures that accept
 * `ScoredOnly<T>[]` document the upstream-filter dependency at the
 * type level; the only legal way to produce a value of that type is
 * to go through this helper or the SCORED-default repo `byRange()`.
 */
export function filterScored<T extends { scoreState: ScoreState }>(items: T[]): ScoredOnly<T>[] {
  return items.filter((i) => i.scoreState === 'SCORED') as ScoredOnly<T>[];
}
