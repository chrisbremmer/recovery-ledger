// MCP error sanitizer (D-07 pattern catalog + D-08 cause-chain walker).
//
// This module is pure string transformation: no I/O, no logger, no stdout/stderr writes.
// `register.ts` is the single consumer; every tool handler's caught error funnels
// through `sanitize(serializeError(err))` before being returned to the MCP client.
// See PITFALLS.md Pitfall 17 (token leakage via errors) for motivation.

// Order is non-obvious and load-bearing: more-specific patterns run first so the
// bare-Bearer rule (#4) cannot pre-empt the Authorization-header rule (#1), and
// JSON token-key redaction (#2) runs before the bare-Bearer fallback so JSON
// payloads keep their auditable keys.
export const PATTERNS: ReadonlyArray<{ pattern: RegExp; replacement: string }> = [
  // 1. Authorization header — `gi` because HTTP header names are case-insensitive
  //    but stored token case is preserved verbatim. Bounded by `[^\s,;]+` so it
  //    stops at the first whitespace/comma/semicolon (Pitfall 8).
  {
    pattern: /Authorization:\s*Bearer\s+[^\s,;]+/gi,
    replacement: 'Authorization: Bearer <redacted>',
  },
  // 2. JSON token-key values — keep the key, redact the value via `$1`
  //    back-reference. Auditable: a reader can see *which* secret leaked without
  //    seeing the value itself.
  {
    pattern: /("(?:access_token|refresh_token|client_secret)"\s*:\s*")[^"]+/g,
    replacement: '$1<redacted>',
  },
  // 2a. URL query-parameter token leaks: `?access_token=…`, `&refresh_token=…`,
  //     `&code=…`, `&client_secret=…`. WHOOP OAuth callbacks and any logged
  //     fetch URL or redirect can carry these verbatim (PITFALLS.md Pitfall 17,
  //     AUTH-06). Stops at `&`, whitespace, or quote — same boundary class as
  //     URL-encoded values. The `i` flag covers `?Access_Token=` casing seen
  //     from some upstreams.
  {
    pattern: /([?&](?:access_token|refresh_token|code|client_secret)=)[^&\s"']+/gi,
    replacement: '$1<redacted>',
  },
  // 2b. Form-encoded body fields: `grant_type=refresh_token&refresh_token=…`,
  //     `&access_token=…`, `&client_secret=…`. WHOOP's OAuth token endpoint
  //     accepts `application/x-www-form-urlencoded`; undici/native fetch
  //     surface the request body in error messages on connection errors.
  //     Distinct from 2a because form bodies do not require a `?`/`&` prefix
  //     on the first key. Order: runs AFTER 2a so URL queries get their key
  //     prefix preserved (`?access_token=` → `?access_token=<redacted>`) while
  //     standalone body framings still redact.
  {
    pattern: /\b(access_token|refresh_token|client_secret)=([^&\s"']+)/gi,
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
  {
    pattern: /Bearer\s+[A-Za-z0-9._-]{10,}/gi,
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
export function serializeError(err: unknown): string {
  if (!(err instanceof Error)) return String(err);
  const parts: string[] = [err.message];
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
