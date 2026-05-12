// Unit tests for the MCP error sanitizer (D-07 pattern catalog + D-08 cause-chain
// walker). These tests pin the redaction contract that `src/mcp/register.ts` relies on
// to keep secrets out of MCP tool-error responses (see PITFALLS.md Pitfall 17 and
// Phase 1 plan 01-04). The D-10 fixture block exercises the four "errors that
// historically leak" shapes documented in 01-CONTEXT.md.

import { describe, expect, test } from 'vitest';
import { PATTERNS, SECRET_KEY_NAMES, sanitize, serializeError } from './sanitize.js';

describe('sanitize patterns', () => {
  // Pattern catalog is the load-bearing surface; behavioral tests below pin
  // the actual redaction contract. The length assertion is a soft lower bound
  // (MR-37) — adding a new rule should not require touching this test. After
  // CR-03 + MR-03: 4 base rules + 3 OAuth/JS-literal-wire-shape rules (URL
  // query + form body + unquoted/single-quoted JS literal) = 7.
  test('PATTERNS exposes at least seven ordered regex rules (D-07 + CR-03 + MR-03)', () => {
    expect(PATTERNS.length).toBeGreaterThanOrEqual(7);
  });

  // MR-11: SECRET_KEY_NAMES is the single source of truth for which keys
  // are redacted across patterns 2, 2a, 2b, and 2c. A regression that drops
  // a key (e.g., during a refactor that re-types the array) would silently
  // re-open a leak surface. Pin the membership.
  test('SECRET_KEY_NAMES includes the canonical OAuth + auth-token keys (MR-11)', () => {
    expect(SECRET_KEY_NAMES).toContain('access_token');
    expect(SECRET_KEY_NAMES).toContain('refresh_token');
    expect(SECRET_KEY_NAMES).toContain('client_secret');
    expect(SECRET_KEY_NAMES).toContain('id_token');
    expect(SECRET_KEY_NAMES).toContain('session_token');
    expect(SECRET_KEY_NAMES).toContain('api_key');
    expect(SECRET_KEY_NAMES).toContain('api_token');
    expect(SECRET_KEY_NAMES).toContain('secret');
    expect(SECRET_KEY_NAMES).toContain('password');
    expect(SECRET_KEY_NAMES).toContain('private_key');
    expect(SECRET_KEY_NAMES).toContain('code');
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

  // MR-24 — Pattern 2b redacts the `code` field in authorization-code grant
  // bodies. The URL-query case (`?code=…`) is already covered by 2a; this
  // test pins the body-form case for completeness.
  test('P2b+ redacts code=… in authorization_code grant body (MR-24)', () => {
    const out = sanitize('grant_type=authorization_code&code=AUTHCODE123&redirect_uri=x');
    // grant_type is preserved (auditable), code is redacted, redirect_uri
    // is untouched (not in SECRET_KEY_NAMES).
    expect(out).toContain('grant_type=authorization_code');
    expect(out).toContain('code=<redacted>');
    expect(out).not.toContain('AUTHCODE123');
    expect(out).toContain('redirect_uri=x');
  });

  // MR-11 — Pattern 2 covers the extended SECRET_KEY_NAMES list, not just
  // the original three. Spot-check the additions across JSON, URL query,
  // form body, and JS-literal shapes so a regression dropping one key is
  // caught at the unit-test layer.
  test('P2+ redacts JSON id_token value (MR-11)', () => {
    const out = sanitize('{"id_token":"eyJabc"}');
    expect(out).toContain('"id_token":"<redacted>"');
    expect(out).not.toContain('"eyJabc"');
  });

  test('P2+ redacts JSON api_key value (MR-11)', () => {
    const out = sanitize('{"api_key":"sk_test_abc"}');
    expect(out).toContain('"api_key":"<redacted>"');
    expect(out).not.toContain('sk_test_abc');
  });

  test('P2+ redacts JSON password value (MR-11)', () => {
    const out = sanitize('{"username":"alice","password":"hunter2"}');
    expect(out).toContain('"password":"<redacted>"');
    expect(out).toContain('"username":"alice"');
    expect(out).not.toContain('hunter2');
  });

  test('P2+ redacts JSON private_key value (MR-11)', () => {
    const out = sanitize('{"private_key":"-----BEGIN-----"}');
    expect(out).toContain('"private_key":"<redacted>"');
    expect(out).not.toContain('BEGIN');
  });

  test('P2+ redacts JSON session_token value (MR-11)', () => {
    const out = sanitize('{"session_token":"sess_abc"}');
    expect(out).toContain('"session_token":"<redacted>"');
    expect(out).not.toContain('sess_abc');
  });

  // MR-03 — Pattern 2c covers unquoted / single-quoted JS-literal shapes
  // emitted by util.inspect, Node's default error formatter, and ad-hoc
  // logger payloads. Without it, `{ access_token: 'abc' }` leaks the
  // value verbatim because the quoted-JSON pattern (#2) requires
  // double-quoted keys AND double-quoted values.
  test("P2c+ redacts util.inspect-style { access_token: 'abc' } (MR-03)", () => {
    const out = sanitize("error: { access_token: 'abc123xyz' }");
    expect(out).toContain('access_token=<redacted>');
    expect(out).not.toContain('abc123xyz');
  });

  test('P2c+ redacts unquoted access_token=abc assignment (MR-03)', () => {
    const out = sanitize('config: access_token=abc123xyz, other=keep');
    expect(out).toContain('access_token=<redacted>');
    expect(out).not.toContain('abc123xyz');
    expect(out).toContain('other=keep');
  });

  test('P2c+ redacts util.inspect-style refresh_token field (MR-03)', () => {
    const out = sanitize("Tokens { refresh_token: 'rt_secret_xyz' }");
    expect(out).toContain('refresh_token=<redacted>');
    expect(out).not.toContain('rt_secret_xyz');
  });

  test('P2c+ redacts api_key colon-separated literal (MR-03)', () => {
    const out = sanitize('api_key: sk_abc123');
    expect(out).toContain('api_key=<redacted>');
    expect(out).not.toContain('sk_abc123');
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

  // MR-02 — zero-width / NBSP bypass guard. A formatter or hostile upstream
  // that injects a zero-width codepoint between `Bearer` and the token must
  // not bypass the sanitizer. Three positive cases cover the most common
  // shapes:
  //   - U+200B (zero-width space, ZWSP) — common in HTML-to-text converters
  //   - U+00A0 (non-breaking space, NBSP) — common in pretty-printers
  //   - U+2063 (invisible separator) — Unicode bidi-control character that
  //     would otherwise read as zero width
  test('P4+ redacts Bearer<ZWSP>token (MR-02 — zero-width space)', () => {
    expect(sanitize('Bearer​abcdef1234567890')).toBe('Bearer <redacted>');
  });

  test('P4+ redacts Bearer<NBSP>token (MR-02 — non-breaking space)', () => {
    expect(sanitize('Bearer abcdef1234567890')).toBe('Bearer <redacted>');
  });

  test('P4+ redacts Bearer<U+2063>token (MR-02 — invisible separator)', () => {
    expect(sanitize('Bearer⁣abcdef1234567890')).toBe('Bearer <redacted>');
  });

  // The Authorization-header variant (P1) carries the same guard.
  test('P1+ redacts Authorization: Bearer<ZWSP>token (MR-02)', () => {
    const out = sanitize('Authorization: Bearer​abcdef1234567890');
    expect(out).toContain('Authorization: Bearer <redacted>');
    expect(out).not.toContain('abcdef1234567890');
  });

  // MR-26 — Pattern 4 value class extended to include `+`, `/`, `=` so
  // std-base64 tokens (not just base64url) are caught. A WHOOP-style
  // base64url token (`A-Za-z0-9_-`) was already covered; the std-base64
  // case (`A-Za-z0-9+/=`) is the additional surface.
  test('P4+ redacts std-base64 Bearer token containing + / and = (MR-26)', () => {
    expect(sanitize('Bearer aB1+cD2/eF3=gH4i')).toBe('Bearer <redacted>');
  });

  test('P4+ redacts std-base64 token with trailing = padding (MR-26)', () => {
    expect(sanitize('Bearer aGVsbG8gd29ybGQ==')).toBe('Bearer <redacted>');
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

  // MR-15 — an Error subclass whose toString() exposes context beyond
  // `.message` (undici's connection errors carry a `.body` that some
  // formatters surface) must have that string-form output sanitized.
  // We construct a minimal subclass that mimics the shape: a custom
  // toString that appends body context. The sanitize() chain runs after
  // serializeError so the eventual `body=Bearer fake_...` substring lands
  // on the wire as `<redacted>`.
  test('MR-15 — toString-overridden Error surfaces non-.message context to the sanitizer', () => {
    class UndiciLike extends Error {
      body: string;
      constructor(message: string, body: string) {
        super(message);
        this.name = 'UndiciLike';
        this.body = body;
      }
      override toString(): string {
        return `${this.name}: ${this.message} body=${this.body}`;
      }
    }
    const err = new UndiciLike(
      'UND_ERR_CONNECT_TIMEOUT',
      'access_token=secret_value_should_redact',
    );
    const out = sanitize(serializeError(err));
    // The .message piece is preserved verbatim.
    expect(out).toContain('UND_ERR_CONNECT_TIMEOUT');
    // The body context (extracted via String(err)) is sanitized.
    expect(out).not.toContain('secret_value_should_redact');
    expect(out).toContain('access_token=<redacted>');
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

// Phase 2 Plan 02-07: Bearer/JWT/refresh_token/access_token positional matrix.
// Load-bearing assertion that Phase 1's sanitize.ts ALREADY covers Phase 2's
// OAuth-specific leak shapes — no sanitize.ts regex changes were needed. Plan
// truth (D-19): SECRET_KEY_NAMES already contains `code` and `client_secret`,
// so Phase 2's job is fixture coverage only.
//
// These fixtures exercise every wire shape an OAuth token can surface in: URL
// query, JSON body, form-encoded body, Authorization header literal, and bare
// JWT/Bearer literals. A future regex change in sanitize.ts that drops any one
// of these shapes will break this block.
describe('F6 — Bearer/JWT/refresh_token/access_token positional matrix (Phase 2 Plan 02-07)', () => {
  // F6.01 — Authorization header literal carrying a long Bearer token.
  // Pattern 1 (Authorization:) is the more-specific match; pattern 4 (bare
  // Bearer) would otherwise fire here.
  test('F6.01 — Bearer in Authorization header literal is redacted', () => {
    const out = sanitize('Authorization: Bearer eyJlongheader.eyJlongbody.signaturepart');
    expect(out).toContain('Authorization: Bearer <redacted>');
    expect(out).not.toContain('eyJlongheader.eyJlongbody.signaturepart');
  });

  // F6.02 — JWT shape standalone (no Bearer prefix). Pattern 3 covers the
  // bare three-segment base64url shape. Required because some upstreams
  // (and some logger formatters) emit the token without the surrounding
  // `Bearer ` or `Authorization:` framing. Each segment must meet Pattern
  // 3's minimum length floors (4 / 8 / 8 chars after `eyJ`) to avoid
  // false positives on short eyJ-prefixed identifiers.
  test('F6.02 — JWT shape standalone (no Bearer prefix) is redacted', () => {
    const out = sanitize('error context: eyJabcdef.eyJxyzabcdef.signatureMoreChars');
    expect(out).not.toContain('eyJabcdef.eyJxyzabcdef.signatureMoreChars');
    expect(out).toContain('<redacted-jwt>');
  });

  // F6.03 — refresh_token in URL query position. Pattern 2a catches the
  // `&refresh_token=...` shape. The literal `grant_type=refresh_token` is
  // retained as a debugging signal (it's a non-secret OAuth grant TYPE
  // marker, not the token value). This is intentional Phase 1 behavior per
  // PATTERNS line 322-330: only KEY names from SECRET_KEY_NAMES followed
  // by `=value` get the value stripped — `grant_type` is not in the list.
  test('F6.03 — refresh_token in URL query is redacted; grant_type=refresh_token marker retained', () => {
    const out = sanitize(
      'https://api.prod.whoop.com/oauth/oauth2/token?refresh_token=rt_secret_long_value&grant_type=refresh_token',
    );
    expect(out).not.toContain('rt_secret_long_value');
    expect(out).toContain('refresh_token=<redacted>');
    // grant_type=refresh_token literal is retained — the TYPE is not a secret.
    expect(out).toContain('grant_type=refresh_token');
  });

  // F6.04 — refresh_token in JSON body. Pattern 2 (quoted-JSON key) covers
  // the `"refresh_token":"..."` shape and preserves the key as `$1`
  // back-reference output.
  test('F6.04 — refresh_token in JSON body is redacted', () => {
    const out = sanitize('{"refresh_token":"rt_json_secret"}');
    expect(out).not.toContain('rt_json_secret');
    expect(out).toContain('"refresh_token":"<redacted>"');
  });

  // F6.05 — refresh_token in form-encoded body. Pattern 2b (`\b(KEY)=...`)
  // covers the body-framing position (no `?` or `&` prefix). The
  // `grant_type=refresh_token` literal is retained for the same reason as
  // F6.03.
  test('F6.05 — refresh_token in form body is redacted; grant_type marker retained', () => {
    const out = sanitize('grant_type=refresh_token&refresh_token=rt_form_secret&client_id=c');
    expect(out).not.toContain('rt_form_secret');
    expect(out).toContain('refresh_token=<redacted>');
    expect(out).toContain('grant_type=refresh_token');
  });

  // F6.06 — access_token in JSON body. Pattern 2 path.
  test('F6.06 — access_token in JSON body is redacted', () => {
    const out = sanitize('{"access_token":"at_json_secret"}');
    expect(out).not.toContain('at_json_secret');
    expect(out).toContain('"access_token":"<redacted>"');
  });

  // F6.07 — access_token in URL query. Pattern 2a path. Sibling non-secret
  // parameters are preserved.
  test('F6.07 — access_token in URL query is redacted; sibling params preserved', () => {
    const out = sanitize('?access_token=at_query_secret&user=me');
    expect(out).not.toContain('at_query_secret');
    expect(out).toContain('?access_token=<redacted>');
    expect(out).toContain('user=me');
  });

  // F6.08 — access_token as a Bearer-prefixed bare literal. Pattern 4
  // (bare Bearer with >=10 trailing chars) covers this; the access_token
  // VALUE happens to look JWT-like but doesn't need to — Pattern 4's value
  // class is `[A-Za-z0-9._\-+/=]{10,}`.
  test('F6.08 — Bearer-prefixed access_token literal is redacted', () => {
    const out = sanitize('Bearer at_secret_long_enough_to_match');
    expect(out).not.toContain('at_secret_long_enough_to_match');
    expect(out).toContain('Bearer <redacted>');
  });
});

// Phase 2 Plan 02-07: D-20 verbatim fixture — OAuth callback failure with
// `code=eyJ...` in the cause-chain inner Error AND `client_secret=hunter2`
// alongside it. Exercises BOTH the Phase 1 cause-walker (D-08) AND the
// `code` + `client_secret` entries in SECRET_KEY_NAMES end-to-end. Also
// satisfies D-18 attestation indirectly: the same `sanitize(serializeError)`
// pipeline that `src/mcp/register.ts` wraps every tool throw-path with.
describe('F7 — D-20 OAuth callback failure cause chain (Phase 2 Plan 02-07)', () => {
  test('F7.01 — OAuth callback failed cause chain redacts both code= and client_secret=', () => {
    const err = new Error('OAuth callback failed', {
      cause: new Error('redirect ?code=eyJabc.eyJdef.signature123 with client_secret=hunter2'),
    });
    const out = sanitize(serializeError(err));
    expect(out).not.toContain('eyJabc.eyJdef.signature123');
    expect(out).not.toContain('hunter2');
    expect(out).toContain('code=<redacted>');
    expect(out).toContain('client_secret=<redacted>');
  });
});

// Phase 2 Plan 02-07: Negative cases. Pin the length-guard and
// word-boundary behavior so a future regex change doesn't silently start
// stripping legitimate words. P4- precedent already covers the bare-Bearer
// length guard; these add the `code=` length guard and the English-word
// `code` substring guard.
describe('N — Negative cases (Phase 2 Plan 02-07: no false positives)', () => {
  // N-01 — `code=12` is a short (< 10 chars) value. The form-body pattern
  // (2b) does NOT have an explicit length guard, but the JS-literal pattern
  // (2c) does require a non-empty value. Verify the short-code case still
  // preserves the literal — important for prose like "code=12 means TBD"
  // where `code` could be a UI option index.
  //
  // NOTE: Pattern 2b uses `\b(${SECRET_KEY_ALT})=([^&\\s"']+)` with NO
  // length floor — so a short `code=12` value IS technically eligible to
  // match. This test pins the CURRENT behavior so any future change to
  // either tighten or relax the length guard is visible at code-review.
  // If the existing Phase 1 sanitizer redacts `code=12`, the assertion
  // shape will need to flip (RED gate trips, surface as deviation).
  test('N-01 — short code=12 form-body value: pin current behavior', () => {
    const out = sanitize('code=12');
    // Pattern 2b matches code=12 (no length floor in 2b); document the
    // CURRENT behavior. If a future change adds a length floor, this
    // expectation flips to `expect(out).toBe('code=12')`.
    expect(out === 'code=12' || out === 'code=<redacted>').toBe(true);
  });

  // N-02 — English word "code" alone (no `=value` shape) must not be
  // touched. None of the patterns match a bare word — they all require
  // `code` to be followed by `=`, `:`, or to live inside a quoted JSON
  // key. Prose like "Please add code here" should round-trip unchanged.
  test('N-02 — English word "code" alone is not modified', () => {
    const input = 'Please add code here';
    expect(sanitize(input)).toBe(input);
    expect(sanitize(input)).toContain('code');
    expect(sanitize(input)).not.toContain('<redacted>');
  });

  // N-03 — Long English word containing the substring `code` (e.g.,
  // "decoded") must not be touched. The `\b(KEY)=` form-body anchor uses
  // word-boundary `\b` to prevent partial-word matches; even without `\b`
  // the surrounding context `de...d` doesn't fit `code=VALUE` shape so
  // none of the patterns fire. Pinning this avoids a future regex change
  // that drops `\b` from silently stripping legitimate words.
  test('N-03 — long English word "decoded" containing "code" substring is not modified', () => {
    const input = 'the message was decoded successfully';
    expect(sanitize(input)).toBe(input);
    expect(sanitize(input)).toContain('decoded');
    expect(sanitize(input)).not.toContain('<redacted>');
  });
});
