// Unit coverage for AuthError discriminated union + formatAuthError
// exhaustive switch (MR-21 forcing function).
//
// All six kinds are exercised including auth_port_in_use, which was moved
// into Wave 0 per checker BLOCKER 1 so errors.ts is stable across
// Wave 2 plans (02-02 token-store + 02-03 oauth).

import { describe, expect, test } from 'vitest';
import { sanitize, serializeError } from '../../mcp/sanitize.js';
import {
  AUTH_ERROR_KINDS,
  AuthError,
  type AuthErrorKind,
  formatAuthError,
  formatWhoopApiError,
  isAuthError,
  isWhoopApiError,
  WHOOP_API_ERROR_KINDS,
  WhoopApiError,
  type WhoopApiErrorKind,
} from './errors.js';

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

describe('isAuthError (WR-C)', () => {
  test('IS-01: real AuthError instance is detected', () => {
    const err = new AuthError({ kind: 'auth_missing' });
    expect(isAuthError(err)).toBe(true);
  });

  test('IS-02: structurally-shaped AuthError (resetModules-cross-graph) is detected', () => {
    // Simulate the cross-module-graph scenario: an object with the same
    // shape an AuthError carries, but NOT actually `instanceof AuthError`
    // from THIS module's class identity. Under vi.resetModules() this is
    // the literal failure mode that motivated WR-C.
    const shaped = { name: 'AuthError', kind: 'refresh_failed' };
    expect(isAuthError(shaped)).toBe(true);
    expect(shaped).not.toBeInstanceOf(AuthError);
  });

  test('IS-03: plain Error is rejected', () => {
    expect(isAuthError(new Error('plain'))).toBe(false);
  });

  test('IS-04: null / undefined / non-object are rejected', () => {
    expect(isAuthError(null)).toBe(false);
    expect(isAuthError(undefined)).toBe(false);
    expect(isAuthError('AuthError')).toBe(false);
    expect(isAuthError(42)).toBe(false);
  });

  test('IS-05: object with name=AuthError but invalid kind is rejected', () => {
    // Defense-in-depth: a synthesized object claiming to be AuthError but
    // with a non-union kind value must not pass the guard. Without this,
    // formatAuthError would hit its default arm with an "unknown auth
    // error" string -- silent green-check failure mode.
    const fake = { name: 'AuthError', kind: 'not_a_real_kind' };
    expect(isAuthError(fake)).toBe(false);
  });

  test('IS-06: AUTH_ERROR_KINDS tuple is the single source of truth for the union', () => {
    // The static type AuthErrorKind is derived from
    // `(typeof AUTH_ERROR_KINDS)[number]`. This test pins the tuple
    // contents so adding a kind to the union (which requires editing
    // AUTH_ERROR_KINDS) intentionally trips here AND the formatAuthError
    // exhaustive switch -- the MR-21 forcing function.
    expect([...AUTH_ERROR_KINDS]).toEqual([
      'auth_missing',
      'auth_expired',
      'auth_state_mismatch',
      'auth_timeout',
      'auth_port_in_use',
      'refresh_failed',
    ]);
    // Every kind in the tuple is constructible AND surfaces a non-empty
    // remediation string via formatAuthError. This mirrors Test 7 but
    // pulls the kind list from the canonical source instead of a
    // duplicated tuple literal.
    for (const kind of AUTH_ERROR_KINDS) {
      const err = new AuthError({ kind });
      expect(isAuthError(err)).toBe(true);
      expect(formatAuthError(err).length).toBeGreaterThan(0);
    }
  });

  test('IS-07: AUTH_ERROR_KINDS is exported as a readonly tuple', () => {
    // `as const` makes the array deeply readonly at the type level.
    // Pin at runtime: it must be array-shaped (length 6) and every
    // element must be a string. We do NOT freeze it at runtime --
    // `as const` is a type-system contract; a freeze() would also be
    // fine but is not required for the guard's correctness.
    expect(Array.isArray(AUTH_ERROR_KINDS)).toBe(true);
    expect(AUTH_ERROR_KINDS.length).toBe(6);
    for (const k of AUTH_ERROR_KINDS) {
      expect(typeof k).toBe('string');
    }
  });
});

// ---------------------------------------------------------------------------
// Phase 3 D-22: WhoopApiError sibling discriminated union. Mirrors the
// AuthError test shape exactly so a future refactor that touches one
// without the other surfaces here.
// ---------------------------------------------------------------------------

describe('WhoopApiError', () => {
  test('WAE-01: kind is preserved and the instance is an Error subclass', () => {
    const err = new WhoopApiError({ kind: 'unauthorized' });
    expect(err.kind).toBe('unauthorized');
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe('WhoopApiError');
    expect(typeof err.stack).toBe('string');
  });

  test('WAE-02: optional detail is stored on the instance', () => {
    const err = new WhoopApiError({ kind: 'rate_limited', detail: 'reset in 12s' });
    expect(err.detail).toBe('reset in 12s');
    expect(err.message).toBe('reset in 12s');
  });

  test('WAE-03: cause chain is preserved for the sanitize.ts walker', () => {
    const inner = new Error('upstream');
    const err = new WhoopApiError({ kind: 'server', cause: inner });
    expect(err.cause).toBeInstanceOf(Error);
    expect((err.cause as Error).message).toBe('upstream');
  });

  test('WAE-04: WhoopApiError without cause has no own `cause` property (mirrors AuthError WR-11)', () => {
    // Same carrier-shape invariant as AuthError: the conditional-spread
    // in the constructor avoids synthesizing `{ cause: undefined }`. The
    // sanitizer's cause-walker checks `err.cause` truthiness; both "no
    // cause property" and "cause: undefined" produce identical truthiness,
    // but a `{ cause: null }` would not. Pin literal absence.
    const err = new WhoopApiError({ kind: 'network' });
    expect('cause' in err).toBe(false);
    expect(err.cause).toBeUndefined();
  });

  test('WAE-05: WhoopApiError with cause has the cause as an own property', () => {
    const inner = new Error('inner');
    const err = new WhoopApiError({ kind: 'network', cause: inner });
    expect('cause' in err).toBe(true);
    expect(err.cause).toBe(inner);
  });

  test('WAE-06: JSON.stringify of a WhoopApiError does NOT leak the cause message', () => {
    // Same defense-in-depth pin as AuthError Test 9. The load-bearing
    // sanitizer pipeline lives in src/mcp/sanitize.ts; this assertion
    // pins Error.toJSON's default behavior so a future override surfaces.
    const inner = new Error('secret-token-leak');
    const err = new WhoopApiError({ kind: 'server', cause: inner });
    expect(JSON.stringify(err)).not.toContain('secret-token-leak');
  });

  test('WAE-07: WhoopApiError flows through serializeError + sanitize unchanged (D-34 attestation)', () => {
    // Phase 3 D-34: src/mcp/sanitize.ts is UNMODIFIED. Pin that a
    // Bearer-bearing cause message routes through the existing pipeline
    // and lands redacted, identical to AuthError Test 9b.
    const inner = new Error('Authorization: Bearer abc123.def456.ghi789xyzlong');
    const err = new WhoopApiError({ kind: 'unauthorized', cause: inner });
    const serialized = serializeError(err);
    expect(serialized).toContain('Authorization');
    const sanitized = sanitize(serialized);
    expect(sanitized).toContain('<redacted>');
    expect(sanitized).not.toContain('abc123.def456.ghi789xyzlong');
  });
});

describe('formatWhoopApiError', () => {
  test('WAE-08: exhaustive switch over all six kinds returns a non-empty remediation string', () => {
    const kinds: readonly WhoopApiErrorKind[] = [
      'unauthorized',
      'rate_limited',
      'network',
      'validation',
      'server',
      'unknown',
    ] as const;
    for (const kind of kinds) {
      const err = new WhoopApiError({ kind });
      const msg = formatWhoopApiError(err);
      expect(msg.length).toBeGreaterThan(0);
    }
  });
});

describe('isWhoopApiError', () => {
  test('IWAE-01: real WhoopApiError instance is detected', () => {
    const err = new WhoopApiError({ kind: 'unauthorized' });
    expect(isWhoopApiError(err)).toBe(true);
  });

  test('IWAE-02: structurally-shaped WhoopApiError (resetModules-cross-graph) is detected', () => {
    // Same vi.resetModules() cross-module identity scenario as
    // isAuthError IS-02. Duck-typing on name + kind membership is the
    // load-bearing contract.
    const shaped = { name: 'WhoopApiError', kind: 'rate_limited' };
    expect(isWhoopApiError(shaped)).toBe(true);
    expect(shaped).not.toBeInstanceOf(WhoopApiError);
  });

  test('IWAE-03: AuthError instance is rejected (name mismatch disambiguates the two unions)', () => {
    // Even though AuthError and WhoopApiError share the same field
    // shape (kind, detail, cause), the `name` field disambiguates. An
    // AuthError must NOT pass isWhoopApiError, and vice versa.
    const auth = new AuthError({ kind: 'auth_missing' });
    expect(isWhoopApiError(auth)).toBe(false);
    expect(isAuthError(auth)).toBe(true);
    const wae = new WhoopApiError({ kind: 'unauthorized' });
    expect(isAuthError(wae)).toBe(false);
    expect(isWhoopApiError(wae)).toBe(true);
  });

  test('IWAE-04: null / undefined / non-object are rejected', () => {
    expect(isWhoopApiError(null)).toBe(false);
    expect(isWhoopApiError(undefined)).toBe(false);
    expect(isWhoopApiError('WhoopApiError')).toBe(false);
    expect(isWhoopApiError(42)).toBe(false);
  });

  test('IWAE-05: object with name=WhoopApiError but invalid kind is rejected', () => {
    const fake = { name: 'WhoopApiError', kind: 'not_a_real_kind' };
    expect(isWhoopApiError(fake)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Tuple-length locks — pin the FROZEN contract for both unions so a future
// addition to either tuple surfaces here AND fails the exhaustive switch
// in the matching formatter. MR-21 forcing function preserved across the
// AuthError/WhoopApiError pair.
// ---------------------------------------------------------------------------

describe('discriminated-union tuple length locks', () => {
  test('TLL-01: AUTH_ERROR_KINDS is FROZEN at 6 (Phase 2 Plan 02-01 Wave 0 contract)', () => {
    expect(AUTH_ERROR_KINDS.length).toBe(6);
    expect([...AUTH_ERROR_KINDS]).toEqual([
      'auth_missing',
      'auth_expired',
      'auth_state_mismatch',
      'auth_timeout',
      'auth_port_in_use',
      'refresh_failed',
    ]);
  });

  test('TLL-02: WHOOP_API_ERROR_KINDS is exactly 6 (Phase 3 D-22 contract)', () => {
    expect(WHOOP_API_ERROR_KINDS.length).toBe(6);
    expect([...WHOOP_API_ERROR_KINDS]).toEqual([
      'unauthorized',
      'rate_limited',
      'network',
      'validation',
      'server',
      'unknown',
    ]);
  });
});
