// MCP error sanitizer (D-07 pattern catalog + D-08 cause-chain walker).
//
// This module is pure string transformation: no I/O, no logger, no stdout/stderr writes.
// `register.ts` is the single consumer; every tool handler's caught error funnels
// through `sanitize(serializeError(err))` before being returned to the MCP client.
// See PITFALLS.md Pitfall 17 (token leakage via errors) for motivation.

// MR-11 / MR-03 / MR-24: canonical list of secret-bearing key names. Patterns
// 2, 2a, 2b, and 2c all draw from this list so a single edit lands in every
// shape. Underscored spellings (`access_token`) only — the `i` flag handles
// case variation, but the underscore separator is verbatim. Real-world
// upstreams emit additional shapes (`id_token`, `session_token`, `api_key`,
// `api_token`, `secret`, `password`, `private_key`) that the Phase 1 pattern
// catalog did not cover. `code` belongs here for the OAuth authorization-code
// grant body (the URL-query case is also covered in pattern 2a). Each rule
// builds the alternation from this constant via a string-join; tests below
// pin the alternation count and the new positive cases.
export const SECRET_KEY_NAMES = [
  'access_token',
  'refresh_token',
  'client_secret',
  'id_token',
  'session_token',
  'api_key',
  'api_token',
  'secret',
  'password',
  'private_key',
  'code',
] as const;

const SECRET_KEY_ALT = SECRET_KEY_NAMES.join('|');

// Order is non-obvious and load-bearing: more-specific patterns run first so the
// bare-Bearer rule (#4) cannot pre-empt the Authorization-header rule (#1), and
// JSON token-key redaction (#2) runs before the bare-Bearer fallback so JSON
// payloads keep their auditable keys.
export const PATTERNS: ReadonlyArray<{ pattern: RegExp; replacement: string }> = [
  // 1. Authorization header — `gi` because HTTP header names are case-insensitive
  //    but stored token case is preserved verbatim. Bounded by `[^\s,;]+` so it
  //    stops at the first whitespace/comma/semicolon (Pitfall 8). MR-02:
  //    separator after `Bearer` extends to the zero-width / NBSP class so a
  //    formatter that injects a ZWSP between `Bearer` and the token cannot
  //    bypass the rule.
  {
    // Alternation (not a char class) for the zero-width sequence \u2014 Biome's
    // noMisleadingCharacterClass rule rejects ZWJ inside a class because it
    // can form joined emoji; alternation is the documented escape hatch.
    pattern:
      /Authorization:[\s ]*Bearer(?:\s|\u00A0|\u200B|\u200C|\u200D|\u2060|\u2063|\uFEFF)+[^\s,;]+/gi,
    replacement: 'Authorization: Bearer <redacted>',
  },
  // 2. JSON token-key values — keep the key, redact the value via `$1`
  //    back-reference. Auditable: a reader can see *which* secret leaked without
  //    seeing the value itself. The `i` flag (MR-25) matches mixed-case keys
  //    like `"AccessToken"`, `"Refresh_Token"`, etc. — some upstreams and
  //    log-formatters normalize case differently from the wire spec, and
  //    pattern 2a/2b already carry `/gi` for the same reason. MR-11: key
  //    list now sourced from SECRET_KEY_NAMES so the four shapes stay in
  //    lockstep.
  {
    pattern: new RegExp(`("(?:${SECRET_KEY_ALT})"\\s*:\\s*")[^"]+`, 'gi'),
    replacement: '$1<redacted>',
  },
  // 2a. URL query-parameter token leaks: `?access_token=…`, `&refresh_token=…`,
  //     `&code=…`, `&client_secret=…`. WHOOP OAuth callbacks and any logged
  //     fetch URL or redirect can carry these verbatim (PITFALLS.md Pitfall 17,
  //     AUTH-06). Stops at `&`, whitespace, or quote — same boundary class as
  //     URL-encoded values. The `i` flag covers `?Access_Token=` casing seen
  //     from some upstreams.
  {
    pattern: new RegExp(`([?&](?:${SECRET_KEY_ALT})=)[^&\\s"']+`, 'gi'),
    replacement: '$1<redacted>',
  },
  // 2b. Form-encoded body fields: `grant_type=refresh_token&refresh_token=…`,
  //     `&access_token=…`, `&client_secret=…`, `code=…` (auth-code grant body
  //     — MR-24). WHOOP's OAuth token endpoint accepts
  //     `application/x-www-form-urlencoded`; undici/native fetch surface the
  //     request body in error messages on connection errors. Distinct from 2a
  //     because form bodies do not require a `?`/`&` prefix on the first key.
  //     Order: runs AFTER 2a so URL queries get their key prefix preserved
  //     (`?access_token=` → `?access_token=<redacted>`) while standalone body
  //     framings still redact.
  {
    pattern: new RegExp(`\\b(${SECRET_KEY_ALT})=([^&\\s"']+)`, 'gi'),
    replacement: '$1=<redacted>',
  },
  // 2c. Unquoted / single-quoted JS literal token shapes (MR-03). Catches
  //     `util.inspect` output (`{ access_token: 'abc' }`) and bare `key:value`
  //     log assignments outside the form-body framing (e.g., logs that render
  //     a config object via `Object.entries(...).map(...).join(':')`). Runs
  //     AFTER 2/2a/2b so the more-specific quoted-JSON / URL-query / form-body
  //     patterns hit first and preserve their key-prefix shape. The value
  //     class must INCLUDE `&` and `<` as terminators so this pattern cannot
  //     consume across an already-redacted `<redacted>` marker into the next
  //     form-body field — without that guard, 2c would re-eat the
  //     `refresh_token=<redacted>&client_secret=...` pair emitted by 2b and
  //     drop the second field entirely. Boundary class: `'`, `"`, `,`, `&`,
  //     `<`, `>`, whitespace, `}`, `]`. The `i` flag covers mixed-case keys
  //     like `AccessToken:`.
  {
    pattern: new RegExp(`\\b(${SECRET_KEY_ALT})\\s*[:=]\\s*['"]?([^'",&<>\\s}\\]]+)`, 'gi'),
    replacement: '$1=<redacted>',
  },
  // 3. JWT shape — three base64url segments. The `[A-Za-z0-9_-]` class is
  //    deliberate: `+`, `/`, `=` are NOT base64url and a token containing them
  //    is malformed. Minimum-length guards on each segment avoid false positives
  //    on short eyJ-prefixed strings that aren't actually JWTs.
  {
    pattern: /eyJ[A-Za-z0-9_-]{4,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g,
    replacement: '<redacted-jwt>',
  },
  // 4. Bare `Bearer <token>` in error messages without an `Authorization:` prefix.
  //    The `{10,}` minimum length prevents stripping the literal word "Bearer"
  //    if it appears in prose (e.g., "the Bearer token expired"). The `i` flag
  //    catches `bearer abc…` / `BEARER abc…` — some servers and log-formatters
  //    lowercase header values, and undici's `UND_ERR_*` body excerpts do not
  //    normalize case. Pattern 1 still pre-empts this rule for the
  //    `Authorization:` form via earlier-rule precedence.
  //
  //    MR-02: separator class includes zero-width Unicode codepoints (ZWSP
  //    U+200B, ZWNJ U+200C, ZWJ U+200D, word-joiner U+2060, invisible
  //    separator U+2063, BOM U+FEFF) AND non-breaking space (NBSP U+00A0).
  //    Without these, a log line carrying `Bearer​<token>` slips past
  //    the `\s+` boundary class (which only matches ASCII whitespace + a
  //    handful of Unicode whitespace categories — NOT the zero-width set).
  //    Threat model: a malicious upstream or a benign formatter that
  //    normalizes whitespace into NBSP can break sanitization silently. We
  //    treat any of these as the same kind of "gap between Bearer and token"
  //    that a real Authorization header could legitimately contain.
  //
  //    MR-26: value class extended to include `+`, `/`, `=` so standard
  //    base64 tokens (not just base64url) are matched. WHOOP uses base64url
  //    for its access tokens, but Phase 2 may surface OAuth tokens from
  //    upstreams that use std base64 in body excerpts. Minimum length
  //    remains 10 chars — short enough to catch a 12-char API key, long
  //    enough to avoid stripping the literal word `Bearer` followed by a
  //    short non-secret identifier in prose.
  {
    // Alternation (not a char class) for the zero-width sequence \u2014 Biome's
    // noMisleadingCharacterClass rule rejects ZWJ inside a class.
    pattern:
      /Bearer(?:\s|\u00A0|\u200B|\u200C|\u200D|\u2060|\u2063|\uFEFF)+[A-Za-z0-9._\-+/=]{10,}/gi,
    replacement: 'Bearer <redacted>',
  },
];

export function sanitize(input: string): string {
  let out = input;
  for (const { pattern, replacement } of PATTERNS) {
    out = out.replace(pattern, replacement);
  }
  return out;
}

// Walks Node's native `Error.cause` chain, joining each level's message with
// `" — caused by: "`. Depth-limited to 8 per D-08; a `WeakSet` guards against
// `err.cause === err` cycles (Pitfall 9). Both guards are required: WeakSet
// covers cycles, depth covers deep-but-distinct chains. Non-Error causes are
// stringified once and the walk terminates (they have no `.cause` to follow).
//
// MR-15: include `String(err)` for the top-level error so a custom toJSON
// or toString that surfaces non-`.message` fields (undici's `.body`,
// `.headers`, or a class that overrides Symbol.toPrimitive) still gets
// sanitized. Without this, an error whose load-bearing context lives on
// `.body` (e.g., `{ body: 'access_token=...' }`) would leak when the SDK
// or a downstream log formatter calls `.toString()` later. Phase 2 HTTP
// client code must still keep tokens off non-`.message` Error fields as
// a primary defense; this is the secondary net.
export function serializeError(err: unknown): string {
  if (!(err instanceof Error)) return String(err);
  // String(err) includes the message AND honors a custom toString / toJSON
  // that some Error subclasses ship (notably undici's connection errors).
  // We concatenate the explicit message first so a class without overrides
  // still produces the original D-08 cause-chain shape verbatim.
  const stringified = String(err);
  const parts: string[] = [err.message];
  if (stringified !== `Error: ${err.message}` && !stringified.endsWith(err.message)) {
    parts.push(`(string form: ${stringified})`);
  }
  let cause: unknown = err.cause;
  let depth = 0;
  const seen = new WeakSet<object>();
  while (cause && depth < 8) {
    if (typeof cause === 'object' && cause !== null) {
      if (seen.has(cause)) break;
      seen.add(cause);
    }
    if (cause instanceof Error) {
      parts.push(`caused by: ${cause.message}`);
      cause = cause.cause;
    } else {
      parts.push(`caused by: ${String(cause)}`);
      break;
    }
    depth += 1;
  }
  return parts.join(' — ');
}
