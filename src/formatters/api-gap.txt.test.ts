// renderApiGap tests — pure (ApiGapResult) => string. Anchors:
//   - Every entry from Plan 04-06's API_GAP_ENTRIES renders (call
//     getApiGap() then renderApiGap).
//   - 'Not available via WHOOP v2 API' line present on every entry.
//   - 'No closest proxy.' suffix on entries with alternative_via_v2 === null.
//   - ADR-0005 / D-26 per-formatter sanity sweep: NO banned tokens in
//     rendered output.

import { describe, expect, it } from 'vitest';
import { containsBannedToneToken, EMOJI_RE } from '../domain/banned-words.js';
import { API_GAP_ENTRIES } from '../services/api-gap/data.js';
import { getApiGap } from '../services/api-gap/index.js';
import { renderApiGap } from './api-gap.txt.js';

describe('renderApiGap', () => {
  it('renders every API_GAP_ENTRIES feature name', async () => {
    const result = await getApiGap();
    const rendered = renderApiGap(result);
    for (const entry of result.entries) {
      expect(rendered).toContain(entry.feature);
      expect(rendered).toContain(entry.whoop_consumer_path);
    }
  });

  it("every entry surfaces 'Not available via WHOOP v2 API'", async () => {
    const result = await getApiGap();
    const rendered = renderApiGap(result);
    // Count occurrences of the canonical phrase — at least one per entry.
    const matches = rendered.match(/Not available via WHOOP v2 API/g) ?? [];
    expect(matches.length).toBeGreaterThanOrEqual(result.entries.length);
  });

  it("entries with null alternative_via_v2 render 'No closest proxy.'", async () => {
    const result = await getApiGap();
    const rendered = renderApiGap(result);
    const nullCount = result.entries.filter((e) => e.alternative_via_v2 === null).length;
    if (nullCount > 0) {
      const matches = rendered.match(/No closest proxy\./g) ?? [];
      expect(matches.length).toBeGreaterThanOrEqual(nullCount);
    }
  });

  it('renders notes on every entry', async () => {
    const result = await getApiGap();
    const rendered = renderApiGap(result);
    for (const entry of result.entries) {
      expect(rendered).toContain(entry.notes);
    }
  });

  it('empty entries → "No API gap entries registered."', () => {
    const rendered = renderApiGap({ entries: [] });
    expect(rendered).toBe('No API gap entries registered.');
  });

  it('preserves catalog order in output', async () => {
    const result = await getApiGap();
    const rendered = renderApiGap(result);
    let lastIdx = -1;
    for (const entry of result.entries) {
      const idx = rendered.indexOf(entry.feature);
      expect(idx).toBeGreaterThan(lastIdx);
      lastIdx = idx;
    }
  });

  it('Object.isFrozen(API_GAP_ENTRIES) — render must not mutate the catalog', async () => {
    const before = Object.isFrozen(API_GAP_ENTRIES);
    const result = await getApiGap();
    renderApiGap(result);
    expect(Object.isFrozen(API_GAP_ENTRIES)).toBe(before);
  });
});

describe('renderApiGap — ADR-0005 / D-26 per-formatter sanity sweep', () => {
  it('rendered output free of banned tokens + emoji', async () => {
    const result = await getApiGap();
    const rendered = renderApiGap(result);
    expect(containsBannedToneToken(rendered).hit).toBe(false);
    expect(EMOJI_RE.test(rendered)).toBe(false);
  });
});
