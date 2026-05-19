// REV-08 / D-26 — banned-word lint on RENDERED formatter output.
//
// This is the defence-in-depth contract test referenced by ADR-0005
// §Enforcement bullet 3: "Contract test that runs the renderer on every
// fixture and re-checks the rendered output for banned tokens". The
// source-grep gate in scripts/ci-grep-gates.sh Gate A covers static
// source; this contract test covers generated output that source-grep
// cannot see (e.g., a catalog string concatenated into a template).
//
// Wave 0 (Plan 04-01) ships the scaffold — Plan 04-09 (formatters wave)
// fills the describe.each loop over every formatter × every fixture.

import { describe, expect, it } from 'vitest';
import {
  BANNED_TONE_WORDS,
  BANNED_TONE_WORDS_SET,
  containsBannedToneToken,
  EMOJI_RE,
} from '../../src/domain/banned-words.js';

describe('Phase 4 formatter tone contract — REV-08 / D-26', () => {
  // Wave 0 sanity: the constant other tests will iterate is well-formed.
  it('BANNED_TONE_WORDS exposes 10 entries (the ADR-0005 canonical list)', () => {
    expect(BANNED_TONE_WORDS).toHaveLength(10);
    expect(BANNED_TONE_WORDS_SET.size).toBe(10);
  });

  it('helpers are importable and shaped correctly', () => {
    expect(typeof containsBannedToneToken).toBe('function');
    expect(EMOJI_RE).toBeInstanceOf(RegExp);
  });

  it.todo(
    'every formatter (renderDoctor, formatSyncResult, renderDailyReview, renderWeeklyReview, renderDecisionList) on every fixture produces output with zero BANNED_TONE_WORDS hits + zero EMOJI_RE matches (Wave 3/Wave 4)',
  );
});
