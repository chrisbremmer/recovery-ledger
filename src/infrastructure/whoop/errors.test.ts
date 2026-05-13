// Unit coverage for AuthError discriminated union + formatAuthError
// exhaustive switch (MR-21 forcing function).
//
// All six kinds are exercised including auth_port_in_use, which was moved
// into Wave 0 per checker BLOCKER 1 so errors.ts is stable across
// Wave 2 plans (02-02 token-store + 02-03 oauth).

import { describe, expect, test } from 'vitest';
import { sanitize, serializeError } from '../../mcp/sanitize.js';
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

  test('Test 9b (WR-10): the load-bearing defense is the sanitizer pipeline, not Error.toJSON defaults', () => {
    // WR-10: Test 9 pins a "fragile by design" property — Error.toJSON
    // returning {} by default. A future ES change, polyfill, or framework
    // (e.g., a pino transport) that adds toJSON would silently invalidate it.
    // The real defense is the serializeError + sanitize pipeline that
    // register.ts runs every tool result through. This test pins the
    // pipeline directly: serializeError DOES emit cause.message (the walker
    // reads it; that's the whole point), AND `sanitize()` then redacts any
    // token-bearing shape inside that message. The layered defense is what
    // matters; defaults are a distant secondary.
    const inner = new Error('Authorization: Bearer abc123.def456.ghi789xyzlong');
    const err = new AuthError({ kind: 'refresh_failed', cause: inner });
    const serialized = serializeError(err);
    // The walker exposes the cause message — that is the contract.
    expect(serialized).toContain('Authorization');
    // sanitize then redacts the secret-bearing portion.
    const sanitized = sanitize(serialized);
    expect(sanitized).toContain('<redacted>');
    expect(sanitized).not.toContain('abc123.def456.ghi789xyzlong');
  });

  test('Test 10: auth_port_in_use kind is constructible (moved from Plan 02-03)', () => {
    const err = new AuthError({ kind: 'auth_port_in_use', detail: 'port 4321' });
    expect(err.kind).toBe('auth_port_in_use');
  });

  test('Test 12 (WR-11): AuthError without cause has no own `cause` property', () => {
    // WR-11: the Error constructor conditional `init.cause === undefined ?
    // undefined : { cause: init.cause }` avoids synthesizing `{ cause:
    // undefined }`. Pin the carrier shape so a future Node version that
    // materializes the option differently — or a refactor that drops the
    // conditional — surfaces here. The sanitizer's cause-walker checks
    // `err.cause` truthiness; both "no cause property" and "cause:
    // undefined" produce identical truthiness, but a `{ cause: null }`
    // would not. This test pins the literal absence.
    const err = new AuthError({ kind: 'auth_missing' });
    expect('cause' in err).toBe(false);
    expect(err.cause).toBeUndefined();
  });

  test('Test 13 (WR-11): AuthError with cause has the cause as an own property', () => {
    // Mirror assertion: when cause IS supplied, `'cause' in err` must be
    // true and the value must round-trip.
    const inner = new Error('inner');
    const err = new AuthError({ kind: 'refresh_failed', cause: inner });
    expect('cause' in err).toBe(true);
    expect(err.cause).toBe(inner);
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
