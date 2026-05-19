// ADR-0005 banned-tone-words constant — single TS-callable source of truth.
//
// scripts/ci-grep-gates.sh Gate A is the load-bearing repository-wide
// enforcement (inline TONE_WORDS_RE regex). This module exists so any
// runtime code-path that needs the same list (notably the D-26 contract
// test in tests/contract/formatter-tone.test.ts that re-checks rendered
// formatter output) imports it from one place. The tuple order matches
// the Gate A regex order verbatim. Wave 1 adds a parity test asserting
// the shell regex and this constant stay in lockstep.

// The 10 banned tokens per ADR-0005 §Decision. Order matches the Gate A
// alternation. Each entry is lowercase; callers normalize input via
// `.toLowerCase()` before lookup against BANNED_TONE_WORDS_SET. The
// `as const` is load-bearing — it gives the tuple a precise literal type
// so BannedToneWord narrows to the exact 10-member union.
export const BANNED_TONE_WORDS = [
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
] as const;

export type BannedToneWord = (typeof BANNED_TONE_WORDS)[number];

// Runtime Set for O(1) membership checks. Constructed from the tuple so
// any future tuple edit re-derives the set on module load.
export const BANNED_TONE_WORDS_SET: ReadonlySet<BannedToneWord> = new Set(BANNED_TONE_WORDS);

// Emoji byte-range regex matching the same code-point classes scripts/
// ci-grep-gates.sh Gate A flags via its UTF-8 byte pattern. The shell-side
// gate uses `[\xf0-\xf4][\x80-\xbf]{3}` (any 4-byte UTF-8 sequence with a
// 0xF0-0xF4 prefix = U+10000+). At the TS level we additionally cover the
// dingbat / miscellaneous-symbol range U+2600-U+27BF, which contains
// common 3-byte UTF-8 emoji-class glyphs (✓ ✗ ☀ ☁ ★ etc.) that the
// shell byte pattern does not match. This makes the TS regex strictly
// stricter than Gate A — never weaker — so the D-26 contract test cannot
// pass content the source-grep gate would have caught.
export const EMOJI_RE = /[\u{1F000}-\u{1FFFF}\u{2600}-\u{27BF}]/u;

// Lazily-built regex matching the Gate A alternation case-insensitively
// with word-boundary semantics. `dial in` is matched as a literal whitespace-
// bounded substring; the other 9 tokens are surrounded by `\b` so
// underscored or letter-extended substrings (e.g., `tuned`, `respiratory_rate`)
// do NOT trip. JS `\b` treats `_` as a word character so the underscore
// boundary works without special handling.
//
// Built once at module load; no I/O, no side effects.
const SINGLE_WORD_RE = new RegExp(
  `\\b(${BANNED_TONE_WORDS.filter((w) => !w.includes(' ')).join('|')})\\b`,
  'i',
);
const DIAL_IN_RE = /\bdial in\b/i;

interface NoHit {
  readonly hit: false;
}
interface Hit {
  readonly hit: true;
  readonly word: BannedToneWord;
  readonly index: number;
}

// Returns the first banned-token match in `text`. Order: single-word match
// first, then the `dial in` substring. When both would hit, the earliest
// `index` wins. Pure function — no I/O.
export function containsBannedToneToken(text: string): Hit | NoHit {
  const singleMatch = SINGLE_WORD_RE.exec(text);
  const dialMatch = DIAL_IN_RE.exec(text);

  if (singleMatch === null && dialMatch === null) {
    return { hit: false };
  }

  const singleIdx = singleMatch?.index ?? Number.POSITIVE_INFINITY;
  const dialIdx = dialMatch?.index ?? Number.POSITIVE_INFINITY;

  if (dialIdx < singleIdx) {
    return { hit: true, word: 'dial in', index: dialIdx };
  }
  // singleMatch[1] is the captured alternation group; lower-cased to map
  // back to the tuple's canonical lowercase entry.
  const word = (singleMatch?.[1] ?? '').toLowerCase() as BannedToneWord;
  return { hit: true, word, index: singleIdx };
}
