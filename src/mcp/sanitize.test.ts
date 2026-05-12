// Unit tests for the MCP error sanitizer (D-07 pattern catalog + D-08 cause-chain
// walker). These tests pin the redaction contract that `src/mcp/register.ts` relies on
// to keep secrets out of MCP tool-error responses (see PITFALLS.md Pitfall 17 and
// Phase 1 plan 01-04). The D-10 fixture block exercises the four "errors that
// historically leak" shapes documented in 01-CONTEXT.md.

import { describe, expect, test } from 'vitest';
import { PATTERNS, sanitize, serializeError } from './sanitize.js';

describe('sanitize patterns', () => {
  // Pattern catalog is the load-bearing surface; size drift is a contract change.
  test('PATTERNS exposes four ordered regex rules (D-07)', () => {
    expect(PATTERNS.length).toBe(4);
  });

  // Pattern 1 — Authorization: Bearer <token>
  test('P1+ redacts Authorization header with bearer token', () => {
    const out = sanitize('Header is Authorization: Bearer abc.def.ghi rest');
    expect(out).toContain('Authorization: Bearer <redacted>');
    expect(out).not.toContain('abc.def.ghi');
  });

  test('P1+ redacts lowercase authorization header (case-insensitive flag)', () => {
    const out = sanitize('authorization: bearer abc.def.ghi');
    expect(out).toContain('<redacted>');
    expect(out).not.toContain('abc.def.ghi');
  });

  // Pattern 2 — JSON token-key values (back-reference keeps the key visible)
  test('P2+ redacts JSON access_token value but keeps the key and siblings', () => {
    const out = sanitize('{"access_token":"abc123","other":"keep"}');
    expect(out).toContain('"access_token":"<redacted>"');
    expect(out).toContain('"other":"keep"');
    expect(out).not.toContain('abc123');
  });

  test('P2+ redacts JSON refresh_token value', () => {
    const out = sanitize('{"refresh_token":"xyz"}');
    expect(out).toContain('"refresh_token":"<redacted>"');
    expect(out).not.toContain('"xyz"');
  });

  test('P2+ redacts JSON client_secret value', () => {
    const out = sanitize('{"client_secret":"shh"}');
    expect(out).toContain('"client_secret":"<redacted>"');
    expect(out).not.toContain('"shh"');
  });

  // Pattern 3 — JWT shape (three base64url segments)
  test('P3+ redacts JWT-shaped tokens to <redacted-jwt>', () => {
    const out = sanitize('token=eyJabcdef.eyJxyzabcdef.signatureMoreChars');
    expect(out).toContain('<redacted-jwt>');
    expect(out).not.toContain('eyJxyzabcdef');
  });

  test('P3- leaves two-segment eyJ strings unchanged (JWT requires three segments)', () => {
    const input = 'eyJabc.eyJdef';
    expect(sanitize(input)).toBe(input);
  });

  // Pattern 4 — bare `Bearer <token>` outside an HTTP header
  test('P4+ redacts bare Bearer prefix with >=10 trailing chars', () => {
    expect(sanitize('Bearer abcdef1234567890')).toBe('Bearer <redacted>');
  });

  test('P4- leaves the word Bearer in prose unchanged (<10 trailing chars)', () => {
    const input = 'the word Bearer in prose';
    expect(sanitize(input)).toBe(input);
  });
});

describe('serializeError cause chain', () => {
  // C1 — linear chain (D-08): each level joined by " — caused by: "
  test('C1 walks a linear cause chain top-down', () => {
    const err = new Error('outer', {
      cause: new Error('middle', { cause: new Error('inner') }),
    });
    expect(serializeError(err)).toBe('outer — caused by: middle — caused by: inner');
  });

  // C2 — cycle guard (Pitfall 9, WeakSet)
  test('C2 terminates on a self-referential cause within bounded time', () => {
    const err: Error & { cause?: unknown } = new Error('boom');
    err.cause = err;
    const start = Date.now();
    const out = serializeError(err);
    const elapsedMs = Date.now() - start;
    expect(elapsedMs).toBeLessThan(50);
    expect(out).toContain('boom');
  });

  // C3 — depth-limit (D-08 depth-8 cap)
  test('C3 caps depth at 8 cause links for chains deeper than 8', () => {
    // Build a 20-deep chain: depth0 -> depth1 -> ... -> depth19.
    let err: Error = new Error('depth20');
    for (let i = 19; i >= 0; i--) {
      err = new Error(`depth${i}`, { cause: err });
    }
    const out = serializeError(err);
    // Split on "caused by:" — root segment plus N cause segments. Cap is 8 causes,
    // so we expect at most 9 segments after the split.
    const segments = out.split('caused by:');
    expect(segments.length).toBeLessThanOrEqual(9);
  });

  // C3 boundary — exactly 8 causes is the boundary; the 9th cause is excluded.
  test('C3 boundary — depth-8 cap is exactly 8 causes', () => {
    let err: Error = new Error('inner');
    // 10 wrappers => 10 causes if uncapped; cap=8 means the deepest two are dropped.
    for (let i = 0; i < 10; i++) {
      err = new Error(`wrap${i}`, { cause: err });
    }
    const out = serializeError(err);
    const causeCount = out.split('caused by:').length - 1;
    expect(causeCount).toBe(8);
  });

  // C4 — non-Error cause is stringified and terminates the walk
  test('C4 stringifies a non-Error cause and stops walking', () => {
    const err = new Error('outer', { cause: 'just a string' });
    expect(serializeError(err)).toBe('outer — caused by: just a string');
  });

  test('C4 mixed Error then non-Error cause chain', () => {
    const err = new Error('outer', {
      cause: new Error('middle', { cause: 42 }),
    });
    expect(serializeError(err)).toBe('outer — caused by: middle — caused by: 42');
  });
});

describe('D-10 fixtures (errors that historically leak)', () => {
  // F1 — Node fetch TypeError with Authorization header in the cause
  test('F1 redacts Authorization header in a fetch TypeError cause chain', () => {
    const err = new TypeError('fetch failed', {
      cause: new Error('Authorization: Bearer eyJabc.eyJdef.signature123'),
    });
    const out = sanitize(serializeError(err));
    expect(out).not.toContain('Bearer eyJ');
    expect(out).not.toContain('eyJabc.eyJdef.signature123');
    expect(out).toContain('Authorization: Bearer <redacted>');
  });

  // F2 — undici UND_ERR_* with a JWT embedded in the message body
  test('F2 redacts JWT inside an undici UND_ERR_HEADERS_TIMEOUT message', () => {
    const err = new Error('UND_ERR_HEADERS_TIMEOUT — body: "Bearer eyJxxx.eyJyyy.zzz"');
    const out = sanitize(serializeError(err));
    expect(out).not.toContain('Bearer eyJ');
    expect(out).not.toContain('eyJxxx.eyJyyy');
  });

  // F3 — JSON error body with access_token alongside non-secret fields
  test('F3 redacts access_token value but preserves non-secret JSON fields', () => {
    const err = new Error('Response body: {"access_token":"secret_value","expires_in":3600}');
    const out = sanitize(serializeError(err));
    expect(out).toContain('"access_token":"<redacted>"');
    expect(out).toContain('"expires_in":3600');
    expect(out).not.toContain('secret_value');
  });

  // F4 — bare Bearer prefix in a manually-constructed Error message
  test('F4 redacts bare Bearer prefix in a free-form Error message', () => {
    const err = new Error('Bearer eyJabcdef.eyJghijkl.mnopqrst — leaked');
    const out = sanitize(serializeError(err));
    expect(out).not.toContain('Bearer eyJ');
    expect(out).not.toMatch(/eyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/);
  });
});
