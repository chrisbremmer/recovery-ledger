// Unit tests for the MCP error sanitizer (D-07 pattern catalog + D-08 cause-chain
// walker). These tests pin the redaction contract that `src/mcp/register.ts` relies on
// to keep secrets out of MCP tool-error responses (see PITFALLS.md Pitfall 17 and
// Phase 1 plan 01-04). The D-10 fixture block exercises the four "errors that
// historically leak" shapes documented in 01-CONTEXT.md.

import { describe, expect, test } from 'vitest';
import { PATTERNS, sanitize, serializeError } from './sanitize.js';

describe('sanitize patterns', () => {
  // Pattern catalog is the load-bearing surface; behavioral tests below pin
  // the actual redaction contract. The length assertion is a soft lower bound
  // (MR-37) — adding a new rule should not require touching this test. After
  // CR-03: 4 base rules + 2 OAuth-wire-shape rules (URL query + form body) = 6.
  test('PATTERNS exposes at least six ordered regex rules (D-07 + CR-03)', () => {
    expect(PATTERNS.length).toBeGreaterThanOrEqual(6);
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

  // MR-25 — Pattern 2 must redact mixed-case JSON keys. Some upstreams emit
  // `"AccessToken"` / `"Access_Token"` / `"REFRESH_TOKEN"`; without /i the
  // value leaks while a casual reader assumes "we redact JSON token keys."
  test('P2+ redacts mixed-case JSON AccessToken key (MR-25 — /i flag)', () => {
    // Note: Pattern 2 keys are `access_token`/`refresh_token`/`client_secret`
    // with underscores; `/i` only flips alphabetic case, not the separator.
    // The realistic mixed-case shapes we see are `"Access_Token"`,
    // `"REFRESH_TOKEN"`, etc.
    const out = sanitize('{"Access_Token":"upper123","other":"keep"}');
    expect(out).toContain('"Access_Token":"<redacted>"');
    expect(out).toContain('"other":"keep"');
    expect(out).not.toContain('upper123');
  });

  test('P2+ redacts uppercase JSON REFRESH_TOKEN key (MR-25 — /i flag)', () => {
    const out = sanitize('{"REFRESH_TOKEN":"upper_rt"}');
    expect(out).toContain('"REFRESH_TOKEN":"<redacted>"');
    expect(out).not.toContain('upper_rt');
  });

  // Pattern 2a — URL query-parameter token leaks (CR-03)
  test('P2a+ redacts ?access_token=… URL query parameter', () => {
    const out = sanitize('error fetching https://api.whoop.com/v2?access_token=abc123xyz');
    expect(out).toContain('?access_token=<redacted>');
    expect(out).not.toContain('abc123xyz');
  });

  test('P2a+ redacts &refresh_token=… URL query parameter after another param', () => {
    const out = sanitize('https://example.com/cb?state=foo&refresh_token=secret_rt&x=1');
    expect(out).toContain('&refresh_token=<redacted>');
    expect(out).not.toContain('secret_rt');
    // Sibling non-secret parameters are preserved.
    expect(out).toContain('state=foo');
    expect(out).toContain('&x=1');
  });

  test('P2a+ redacts ?code=… OAuth authorization-code query parameter', () => {
    const out = sanitize('redirect https://app.example.com/cb?code=AUTHCODE123&state=s');
    expect(out).toContain('?code=<redacted>');
    expect(out).not.toContain('AUTHCODE123');
    expect(out).toContain('state=s');
  });

  test('P2a+ redacts &client_secret=… URL query parameter', () => {
    const out = sanitize('curl "https://api.whoop.com/oauth?id=1&client_secret=topsecret"');
    expect(out).toContain('&client_secret=<redacted>');
    expect(out).not.toContain('topsecret');
  });

  // MR-40 — Pattern 2a's /i flag is documented but was previously untested.
  // Real-world upstreams (Microsoft Entra, some load-balancer rewriters) emit
  // capitalized query keys; without /i the value would leak intact.
  test('P2a+ redacts mixed-case ?Access_Token=… URL query parameter (MR-40 — /i flag)', () => {
    const out = sanitize('https://api.example.com/cb?Access_Token=upper123&state=x');
    expect(out).toContain('?Access_Token=<redacted>');
    expect(out).not.toContain('upper123');
    expect(out).toContain('state=x');
  });

  test('P2a- leaves unrelated query parameters untouched', () => {
    const input = 'https://example.com/api?state=foo&name=bar';
    expect(sanitize(input)).toBe(input);
  });

  // Pattern 2b — Form-encoded OAuth body fields (CR-03)
  test('P2b+ redacts grant_type=refresh_token&refresh_token=… form body', () => {
    const input = 'POST body: grant_type=refresh_token&refresh_token=abc123&client_secret=xyz';
    const out = sanitize(input);
    // Both token-bearing fields redacted; non-secret grant_type preserved.
    expect(out).toContain('grant_type=refresh_token');
    expect(out).toContain('refresh_token=<redacted>');
    expect(out).toContain('client_secret=<redacted>');
    expect(out).not.toContain('abc123');
    expect(out).not.toContain('xyz');
  });

  test('P2b+ redacts access_token in form-encoded body framing (no ?/& prefix)', () => {
    const out = sanitize('body=access_token=mytoken123&expires_in=3600');
    expect(out).toContain('access_token=<redacted>');
    expect(out).toContain('expires_in=3600');
    expect(out).not.toContain('mytoken123');
  });

  test('P2b- leaves bare key names without =value unchanged', () => {
    // The word "access_token" appearing in prose without a `=value` suffix is
    // not a leak — the value is the secret, the key is documentation.
    const input = 'the access_token field is required';
    expect(sanitize(input)).toBe(input);
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

  // P4 case-insensitivity — lowercase `bearer` and uppercase `BEARER` must
  // redact identically to mixed-case `Bearer`. Pattern 1 only pre-empts when
  // the `Authorization:` prefix is present; bare lowercase Bearer tokens in
  // undici body excerpts or third-party log lines hit pattern 4 alone.
  test('P4+ redacts lowercase bare bearer prefix (case-insensitive)', () => {
    expect(sanitize('bearer abcdef1234567890')).toBe('Bearer <redacted>');
  });

  test('P4+ redacts uppercase bare BEARER prefix (case-insensitive)', () => {
    expect(sanitize('BEARER abcdef1234567890')).toBe('Bearer <redacted>');
  });

  test('P4+ redacts mixed-case bare Bearer prefix', () => {
    expect(sanitize('BeArEr abcdef1234567890')).toBe('Bearer <redacted>');
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

  // F5 — OAuth refresh form body surfaced via fetch/undici error (CR-03).
  // Reproduces the shape Phase 2's refresh flow will emit on a connection
  // error: the request body is included verbatim in the error message.
  test('F5 redacts grant_type=refresh_token form body in an undici-shaped error', () => {
    const err = new Error(
      'UND_ERR_CONNECT_TIMEOUT — request body: grant_type=refresh_token&refresh_token=rt_secret&client_secret=cs_secret',
    );
    const out = sanitize(serializeError(err));
    expect(out).not.toContain('rt_secret');
    expect(out).not.toContain('cs_secret');
    expect(out).toContain('refresh_token=<redacted>');
    expect(out).toContain('client_secret=<redacted>');
    // The non-secret grant_type=refresh_token marker survives — auditable.
    expect(out).toContain('grant_type=refresh_token');
  });

  // F6 — access_token in a URL query parameter (CR-03). Verifies the
  // canonical case from the review.
  test('F6 redacts ?access_token=… in a URL surfaced via error', () => {
    const err = new Error('error fetching https://api.whoop.com/v2?access_token=abc123xyz');
    const out = sanitize(serializeError(err));
    expect(out).not.toContain('abc123xyz');
    expect(out).toContain('?access_token=<redacted>');
  });
});
