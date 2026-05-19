// Median primitive — wrapper over simple-statistics.median with an
// empty-input guard (T-04-S1 STRIDE mitigation per this plan's threat
// register). Pure function: no I/O, no clock, no logger. The strictest
// layer in the codebase — only allowed import is `simple-statistics`
// (ADR-0001 + agent_docs/conventions.md §Module layout).
//
// `simple-statistics.median` uses the standard (n+1)/2-th value for odd
// n and the midpoint of the two middle values for even n (RESEARCH §1).
// It returns NaN for an empty array; we throw instead so callers cannot
// silently propagate NaN through the baseline / anomaly stack.

import { median as ssMedian } from 'simple-statistics';

export function median(values: number[]): number {
  if (values.length === 0) {
    throw new Error('median: input array is empty');
  }
  return ssMedian(values);
}
