// Median primitive — pure-function test surface (REV-01 anchor).
//
// `median(values)` is a thin wrapper over `simple-statistics.median` that
// rejects empty input with a thrown error. Throwing on degenerate input
// is the T-04-S1 mitigation (STRIDE threat register, this plan's frontmatter)
// — silent NaN propagation through the baseline / anomaly stack would
// corrupt downstream Z-scores instead of surfacing the empty-window case.

import { describe, expect, it } from 'vitest';
import { median } from './median.js';

describe('median', () => {
  it('throws on empty array', () => {
    expect(() => median([])).toThrow();
  });

  it('returns the single element for a one-element array', () => {
    expect(median([42])).toBe(42);
  });

  it('returns the midpoint for a two-element array', () => {
    expect(median([1, 3])).toBe(2);
  });

  it('returns the middle value for an odd-length array', () => {
    expect(median([3, 1, 2])).toBe(2);
  });

  it('returns the midpoint of the two middle values for an even-length array', () => {
    expect(median([1, 2, 3, 4])).toBe(2.5);
  });

  it('handles ties (all-identical values)', () => {
    expect(median([2, 2, 2, 2])).toBe(2);
  });
});
