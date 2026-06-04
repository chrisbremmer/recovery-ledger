// API-gap service tests — D-28 in-source catalog (≥ 6 entries covering the
// six features named in REQUIREMENTS §Out of Scope), Object.freeze
// immutability, and the D-26 banned-tone-word lint over every string field.
//
// Phase 5 (DOC-03/04) reads the same `API_GAP_ENTRIES` module to generate
// markdown; these tests pin the contract the doc-gen step depends on.
//
// Phase 10 ARCH-08 (#86): renamed from the prior per-directory test file
// when the api-gap directory collapsed into a single file. The constant
// now lives in `src/domain/api-gap/catalog.js`; the async accessor lives
// in the sibling `./api-gap.js`.

import { describe, expect, it } from 'vitest';
import { API_GAP_ENTRIES } from '../domain/api-gap/catalog.js';
import { containsBannedToneToken } from '../domain/banned-words.js';
import { getApiGap } from './api-gap.js';

describe('services/api-gap — getApiGap()', () => {
  it('Test 1: returns the in-source API_GAP_ENTRIES array', async () => {
    const result = await getApiGap();
    expect(result.entries).toBe(API_GAP_ENTRIES);
  });

  it('Test 2: catalog has at least 6 entries (D-28 v1 floor)', async () => {
    const result = await getApiGap();
    expect(result.entries.length).toBeGreaterThanOrEqual(6);
  });

  it('Test 3: every entry has available_via_v2_api === false (literal type lock)', async () => {
    const result = await getApiGap();
    for (const entry of result.entries) {
      expect(entry.available_via_v2_api).toBe(false);
    }
  });

  it('Test 4: catalog array is frozen (mutation prevention)', () => {
    expect(Object.isFrozen(API_GAP_ENTRIES)).toBe(true);
  });

  it.each([
    'Healthspan',
    'ECG',
    'Blood Pressure',
    'Journal',
    'Continuous Heart Rate',
    'Hormonal Insights',
  ])('Test 5: catalog covers the named feature "%s"', (named) => {
    const matches = API_GAP_ENTRIES.filter((e) =>
      e.feature.toLowerCase().includes(named.toLowerCase()),
    );
    expect(matches.length).toBeGreaterThanOrEqual(1);
  });
});

describe('services/api-gap — D-26 banned-tone-word lint over every string field', () => {
  for (let i = 0; i < API_GAP_ENTRIES.length; i += 1) {
    const entry = API_GAP_ENTRIES[i];
    if (entry === undefined) continue;
    describe(`entry ${i}: ${entry.feature}`, () => {
      it('feature is free of banned tone tokens', () => {
        expect(containsBannedToneToken(entry.feature).hit).toBe(false);
      });
      it('whoop_consumer_path is free of banned tone tokens', () => {
        expect(containsBannedToneToken(entry.whoop_consumer_path).hit).toBe(false);
      });
      it('notes is free of banned tone tokens', () => {
        expect(containsBannedToneToken(entry.notes).hit).toBe(false);
      });
      if (entry.alternative_via_v2 !== null) {
        it('alternative_via_v2 is free of banned tone tokens', () => {
          const alt = entry.alternative_via_v2;
          if (alt === null) return; // narrow for TS — re-checked at runtime above
          expect(containsBannedToneToken(alt).hit).toBe(false);
        });
      }
    });
  }
});
