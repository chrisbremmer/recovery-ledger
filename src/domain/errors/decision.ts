// DBIN-04 (#88): typed error for "decision id not found on update". Pre-DBIN-04
// `decisions.updateOutcome` silently no-op'd on a missing id, and the caller
// detected the miss via a racy `byId` roundtrip. The repo now returns
// `{ changed: 0 | 1 }`; the service layer throws this typed error when the
// repo reports 0 rows changed, so an irreplaceable decision update can never
// be silently lost.
//
// Decisions are explicitly irreplaceable user data per Pitfall 7.

export class DecisionNotFound extends Error {
  readonly kind: 'decision_not_found' = 'decision_not_found';
  readonly id: string;

  constructor(id: string, options?: { cause?: unknown }) {
    super(`Decision not found: ${id}`, options);
    this.name = 'DecisionNotFound';
    this.id = id;
  }
}

export function isDecisionNotFound(err: unknown): err is DecisionNotFound {
  return err instanceof DecisionNotFound;
}
