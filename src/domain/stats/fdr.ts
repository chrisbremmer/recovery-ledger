// Benjamini-Hochberg FDR step-up procedure — pure-function multi-
// comparison correction (REV-07 anchor; the weekly review's gate against
// fishing-expedition false positives across the 5 candidate factors).
//
// Algorithm transcribed verbatim from 04-RESEARCH section Statistical
// Engine 5; canonical against Benjamini and Hochberg (1995) "Controlling
// the false discovery rate" J.R.Statist.Soc.B 57(1), 289-300 and against
// the statsmodels reference implementation:
//
//   1. Pair each p-value with its original input position.
//   2. Sort ascending by p-value (stable order).
//   3. Walk k from m down to 1; find the largest k where p_(k) <= (k/m) q.
//      Call this kStar.
//   4. Reject every hypothesis at sorted rank <= kStar; map back to
//      original positions.
//   5. Compute BH-adjusted p-values: for each sorted rank k from m to 1,
//      adj_(k) = min(1, (m/k) p_(k)); apply a running-minimum sweep to
//      enforce monotonicity downward (a smaller-rank adjusted value can
//      never exceed a larger-rank adjusted value).
//   6. Map the monotonized adjusted-p back to original positions and
//      return.
//
// ADR-0004 typed-positive-output forcing function: the return shape is
// structurally complete even when 0 hypotheses are rejected. The
// rendering code in the next plan consumes both `rejected[]` and
// `adjusted[]` to surface "no factor cleared the multiple-comparison
// correction" with the adjusted-p values as diagnostic context, never as
// a recommendation.
//
// Pure function: no I/O, no clock, no logger. No imports — the algorithm
// is pure JavaScript over number arrays.

export interface BenjaminiHochbergResult {
  /** One boolean per input position: true if that hypothesis is rejected. */
  readonly rejected: boolean[];
  /** BH-adjusted p-values in input order; each in [0, 1] and monotone in sorted-p order. */
  readonly adjusted: number[];
}

export function benjaminiHochberg(pvalues: number[], q: number): BenjaminiHochbergResult {
  const m = pvalues.length;
  if (m === 0) {
    return { rejected: [], adjusted: [] };
  }

  // Pair each p-value with its original input position; sort ascending by p.
  const indexed = pvalues.map((p, i) => ({ p, i }));
  indexed.sort((a, b) => a.p - b.p);

  // Walk k = m down to 1, find the largest k where p_(k) <= (k/m) * q.
  const rejected = new Array<boolean>(m).fill(false);
  let kStar = -1;
  for (let k = m; k >= 1; k--) {
    const entry = indexed[k - 1];
    if (entry !== undefined && entry.p <= (k / m) * q) {
      kStar = k;
      break;
    }
  }

  // Reject every hypothesis at sorted rank <= kStar; remap to input order.
  if (kStar > 0) {
    for (let k = 0; k < kStar; k++) {
      const entry = indexed[k];
      if (entry !== undefined) {
        rejected[entry.i] = true;
      }
    }
  }

  // BH-adjusted p-values: adj_(k) = min(1, (m/k) * p_(k)); running-min
  // sweep from k = m down to k = 1 enforces monotonicity. Map back to
  // input positions.
  const adjusted = new Array<number>(m).fill(0);
  let runningMin = 1;
  for (let k = m; k >= 1; k--) {
    const entry = indexed[k - 1];
    if (entry === undefined) {
      continue;
    }
    const raw = Math.min(1, (m / k) * entry.p);
    runningMin = Math.min(runningMin, raw);
    adjusted[entry.i] = runningMin;
  }

  return { rejected, adjusted };
}
