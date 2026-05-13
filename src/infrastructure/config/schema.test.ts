// Unit coverage for the canonical ConfigSchema (DRY-fix per checker
// WARNING PLAN-05-DRY-VIOLATION).
//
// Plan 02-05's init.ts AND auth.ts will both import ConfigSchema and
// D13_SCOPES from this module — the test pins the contract so a drift
// in either consumer is caught here first.

import { describe, expect, test } from 'vitest';
import { ConfigSchema, D13_SCOPES } from './schema.js';

describe('ConfigSchema', () => {
  test('SC-01: parses a well-formed config object', () => {
    const parsed = ConfigSchema.parse({
      clientId: 'abc-123',
      clientSecret: 'sec',
      redirectPort: 4321,
      scopes: ['offline'],
    });
    expect(parsed).toEqual({
      clientId: 'abc-123',
      clientSecret: 'sec',
      redirectPort: 4321,
      scopes: ['offline'],
    });
  });

  test('SC-02: rejects clientId containing characters outside [A-Za-z0-9._~-]', () => {
    expect(() =>
      ConfigSchema.parse({
        clientId: 'bad/value',
        clientSecret: 'sec',
        redirectPort: 4321,
        scopes: ['offline'],
      }),
    ).toThrow();
  });

  test('SC-03: rejects redirectPort=0 (positive int constraint)', () => {
    expect(() =>
      ConfigSchema.parse({
        clientId: 'abc-123',
        clientSecret: 'sec',
        redirectPort: 0,
        scopes: ['offline'],
      }),
    ).toThrow();
  });

  test('SC-04: rejects empty scopes array (nonempty constraint)', () => {
    expect(() =>
      ConfigSchema.parse({
        clientId: 'abc-123',
        clientSecret: 'sec',
        redirectPort: 4321,
        scopes: [],
      }),
    ).toThrow();
  });

  test('SC-05: D13_SCOPES is frozen and contains the 7 D-13 strings in canonical order', () => {
    expect(Object.isFrozen(D13_SCOPES)).toBe(true);
    expect([...D13_SCOPES]).toEqual([
      'offline',
      'read:recovery',
      'read:sleep',
      'read:workout',
      'read:cycles',
      'read:profile',
      'read:body_measurement',
    ]);
  });
});
