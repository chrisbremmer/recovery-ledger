// Unit tests for the PURE `renderApiGapMarkdown` function (Plan 05-07 Task 1).
//
// These pin the render contract the parity test (tests/contract/
// api-gap-md-parity.test.ts) and the committed docs/install/api-gap.md
// depend on: determinism, exactly-one-trailing-newline (idempotency per
// RESEARCH §Finding 5), one H2 per entry, every feature name present, and
// the `None.` fallback when `alternative_via_v2` is null.
//
// The CLI `if (isMain)` branch is NOT exercised here — only the pure
// function. The end-to-end write is covered by Task 2's parity test +
// Task 3's npm-script invocation.
//
// Discovered by Vitest when invoked with an explicit file path
// (`npx vitest run scripts/generate-api-gap-md.test.ts`); the default
// `vitest.config.ts` include glob is src/ + tests/ only, so this file is
// intentionally outside the default `npm test` suite (the generator is a
// build tool, not a runtime surface — the parity test in tests/contract/
// is the forcing function in the default suite).

import { describe, expect, it } from 'vitest';
import { API_GAP_ENTRIES } from '../src/services/api-gap/data.js';
import { renderApiGapMarkdown } from './generate-api-gap-md.js';

describe('renderApiGapMarkdown', () => {
  it('produces deterministic output (byte-identical across two calls)', () => {
    const first = renderApiGapMarkdown(API_GAP_ENTRIES);
    const second = renderApiGapMarkdown(API_GAP_ENTRIES);
    expect(first).toBe(second);
  });

  it('ends with exactly one trailing newline', () => {
    const out = renderApiGapMarkdown(API_GAP_ENTRIES);
    expect(out.endsWith('\n')).toBe(true);
    expect(out.endsWith('\n\n')).toBe(false);
  });

  it('renders all entries as H2 sections', () => {
    const out = renderApiGapMarkdown(API_GAP_ENTRIES);
    const h2Count = (out.match(/^## /gm) ?? []).length;
    expect(h2Count).toBe(API_GAP_ENTRIES.length);
  });

  it('mentions every entry feature name', () => {
    const out = renderApiGapMarkdown(API_GAP_ENTRIES);
    for (const entry of API_GAP_ENTRIES) {
      expect(out).toContain(entry.feature);
    }
  });

  it('uses "None." when alternative_via_v2 is null', () => {
    const nullEntry = API_GAP_ENTRIES.find((entry) => entry.alternative_via_v2 === null);
    // Sanity: the v1 catalog has at least one such entry (ECG).
    expect(nullEntry).toBeDefined();
    const out = renderApiGapMarkdown(API_GAP_ENTRIES);
    expect(out).toContain('**Closest v2 alternative:** None.');
  });
});
