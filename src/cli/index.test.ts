// CLI argument parser tests. Validates `parseDaysFlag` rejects the values
// that the prior implementation silently coerced — negative ints, zero, and
// absurd futures. The action handler never sees an invalid --days value
// because Commander short-circuits via InvalidArgumentError before reaching
// it (Commander surfaces these as exit code 2 in process exit terms; the
// unit test asserts the throw itself).

import { InvalidArgumentError } from 'commander';
import { describe, expect, test } from 'vitest';
import { parseDaysFlag, parseIntStrict } from './index.js';

describe('parseDaysFlag', () => {
  test('accepts positive integers in the supported range', () => {
    expect(parseDaysFlag('1', undefined)).toBe(1);
    expect(parseDaysFlag('30', undefined)).toBe(30);
    expect(parseDaysFlag('365', undefined)).toBe(365);
  });

  test('rejects non-integers with InvalidArgumentError', () => {
    expect(() => parseDaysFlag('abc', undefined)).toThrow(InvalidArgumentError);
  });

  test('rejects zero', () => {
    expect(() => parseDaysFlag('0', undefined)).toThrow(InvalidArgumentError);
  });

  test('rejects negative integers — the value that previously silently fell through to the default re-window', () => {
    expect(() => parseDaysFlag('-1', undefined)).toThrow(InvalidArgumentError);
    expect(() => parseDaysFlag('-30', undefined)).toThrow(InvalidArgumentError);
  });

  test('rejects values above the 365-day sanity cap', () => {
    expect(() => parseDaysFlag('366', undefined)).toThrow(InvalidArgumentError);
    expect(() => parseDaysFlag('9999', undefined)).toThrow(InvalidArgumentError);
  });
});

describe('parseIntStrict (covers --timeout-style flags)', () => {
  test('accepts a valid integer string', () => {
    expect(parseIntStrict('42', undefined)).toBe(42);
  });

  test('rejects NaN', () => {
    expect(() => parseIntStrict('not-a-number', undefined)).toThrow(InvalidArgumentError);
  });
});
