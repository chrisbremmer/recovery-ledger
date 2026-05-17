// Shared repository types — the small surface that every scored-resource
// repo declares identically. Lifted into the domain layer so the cycles /
// recovery / sleep / workouts repos import a single definition instead of
// re-declaring the same interface 4×.
//
// Layer 1 of the three-layer type system (conventions.md): no I/O, no
// logger, no infrastructure imports. Pure type declarations.

/**
 * Options accepted by each scored-resource repo's `byRange(start, end)`.
 *
 * - `includeUnscored` — include `PENDING_SCORE` + `UNSCORABLE` rows.
 *   Default: false (ADR-0003 — domain code consumes SCORED-only by
 *   default).
 * - `includeExcluded` — include rows whose parent cycle has
 *   `baseline_excluded = 1` (D-14 DST/tz exclusion). Default: false.
 *   For repos without a `baseline_excluded` column of their own (sleeps,
 *   workouts) the flag is accepted for API symmetry but is a no-op in
 *   Phase 3 — cycle-based exclusion happens at the review-query layer
 *   in Phase 4.
 */
export interface ByRangeOpts {
  includeUnscored?: boolean;
  includeExcluded?: boolean;
}
