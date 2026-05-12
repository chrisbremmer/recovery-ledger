// Unit coverage for AuthError discriminated union + formatAuthError
// exhaustive switch (MR-21 forcing function).
//
// All six kinds are exercised including auth_port_in_use, which was moved
// into Wave 0 per checker BLOCKER 1 so errors.ts is stable across
// Wave 2 plans (02-02 token-store + 02-03 oauth).

import { describe, expect, test } from 'vitest';
import { AuthError, type AuthErrorKind, formatAuthError } from './errors.js';

describe('AuthError', () => {
  test('Test 6: kind is preserved and the instance is an Error subclass', () => {
    const err = new AuthError({ kind: 'auth_missing' });
    expect(err.kind).toBe('auth_missing');
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe('AuthError');
    expect(typeof err.stack).toBe('string');
  });

  test('Test 8: cause chain is preserved for serializeError walker', () => {
    const inner = new Error('network');
    const err = new AuthError({ kind: 'refresh_failed', cause: inner });
    expect(err.cause).toBeInstanceOf(Error);
    expect((err.cause as Error).message).toBe('network');
  });

  test('Test 9: JSON.stringify of an AuthError does NOT leak the cause message', () => {
    // Error toJSON returns {} by default; the Phase 1 sanitizer is invoked
    // separately. This test pins the carrier shape so a future override of
    // toJSON that emits cause.message would break this assertion.
    const inner = new Error('secret-token-leak');
    const err = new AuthError({ kind: 'refresh_failed', cause: inner });
    const serialized = JSON.stringify(err);
    expect(serialized).not.toContain('secret-token-leak');
  });

  test('Test 10: auth_port_in_use kind is constructible (moved from Plan 02-03)', () => {
    const err = new AuthError({ kind: 'auth_port_in_use', detail: 'port 4321' });
    expect(err.kind).toBe('auth_port_in_use');
  });
});

describe('formatAuthError', () => {
  test('Test 7: exhaustive switch over all six kinds returns a non-empty remediation string', () => {
    // Exercise every kind so a future kind added without updating the
    // switch arms surfaces here AND fails to typecheck at the call site.
    const kinds: readonly AuthErrorKind[] = [
      'auth_missing',
      'auth_expired',
      'auth_state_mismatch',
      'auth_timeout',
      'auth_port_in_use',
      'refresh_failed',
    ] as const;
    for (const kind of kinds) {
      const err = new AuthError({ kind });
      const msg = formatAuthError(err);
      expect(msg.length).toBeGreaterThan(0);
    }
  });

  test('Test 11: auth_port_in_use arm references init or port (moved from Plan 02-03)', () => {
    const err = new AuthError({ kind: 'auth_port_in_use', detail: 'port 4321' });
    const msg = formatAuthError(err);
    expect(msg).toMatch(/init|port/);
  });
});
