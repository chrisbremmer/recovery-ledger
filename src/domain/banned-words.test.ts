// Banned-tone-words constant — ADR-0005 code-callable source of truth.
//
// The shell-side enforcement lives in scripts/ci-grep-gates.sh Gate A
// (TONE_WORDS_RE inline regex). This TS export exists so D-26's
// defence-in-depth contract test in tests/contract/formatter-tone.test.ts
// can iterate over the same word list without re-declaring it. Wave 1 adds
// a parity test asserting the shell regex + this constant stay in lockstep.
//
// Per ADR-0005 §Enforcement bullet 3: the contract test runs every formatter
// on every fixture and re-checks the rendered output for banned tokens. This
// file is the constant that test imports.

import { describe, expect, test } from 'vitest';
import {
  BANNED_TONE_WORDS,
  BANNED_TONE_WORDS_SET,
  EMOJI_RE,
  containsBannedToneToken,
} from './banned-words.js';

describe('BANNED_TONE_WORDS — ADR-0005 single source of truth', () => {
  test('tuple has exactly 10 entries (matches Gate A TONE_WORDS_RE)', () => {
    expect(BANNED_TONE_WORDS).toHaveLength(10);
  });

  test('tuple membership matches the canonical 10 words verbatim', () => {
    const expected = [
      'optimize',
      'wellness',
      'honor',
      'journey',
      'crush',
      'nail',
      'tune',
      'vibe',
      'unlock',
      'dial in',
    ];
    expect(Array.from(BANNED_TONE_WORDS)).toEqual(expected);
  });

  test('BANNED_TONE_WORDS_SET has exactly 10 unique members', () => {
    expect(BANNED_TONE_WORDS_SET.size).toBe(10);
  });

  test('every entry is lowercase (callers normalize via .toLowerCase())', () => {
    for (const w of BANNED_TONE_WORDS) {
      expect(w).toBe(w.toLowerCase());
    }
  });
});

describe('EMOJI_RE — Gate A byte-range mirror', () => {
  // The Vitest sanity exercise here mirrors the shell-side $EMOJI_RE byte
  // class. We pick one codepoint that is unambiguously emoji-class
  // (U+2713 CHECK MARK — outside the 4-byte UTF-8 prefix the shell uses,
  // but inside the U+2600-U+27BF dingbat range this TS regex covers).
  test('matches a dingbat-range codepoint', () => {
    expect(EMOJI_RE.test('✓')).toBe(true);
  });

  test('does not match a plain ASCII letter', () => {
    expect(EMOJI_RE.test('x')).toBe(false);
  });
});

describe('containsBannedToneToken — word-boundary semantics matching Gate A', () => {
  test('finds a single-word banned token + reports word + index', () => {
    const r = containsBannedToneToken('we should optimize sleep');
    expect(r).toEqual({ hit: true, word: 'optimize', index: 10 });
  });

  test('clean prose returns hit:false', () => {
    expect(containsBannedToneToken('we should sleep more')).toEqual({ hit: false });
  });

  test('matches the two-word phrase "dial in" at start of string', () => {
    const r = containsBannedToneToken('dial in the experiment');
    expect(r).toEqual({ hit: true, word: 'dial in', index: 0 });
  });

  test('matches "journey" inside a sentence', () => {
    const r = containsBannedToneToken('the journey home');
    expect(r).toEqual({ hit: true, word: 'journey', index: 4 });
  });

  test('does not match underscored metric names (Pitfall 13 — word boundaries)', () => {
    // `respiratory_rate` legitimately contains no banned token; the `_`
    // serves as a word boundary so callers can safely log metric names.
    expect(containsBannedToneToken('respiratory_rate')).toEqual({ hit: false });
  });
});
