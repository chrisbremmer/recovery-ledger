// OAuth Authorization-Code surface for `recovery-ledger auth` (Plan 02-03).
//
// Public exports:
//   - WHOOP_AUTHORIZE_URL           — D-13 hardcoded authorize endpoint
//   - buildAuthorizeUrl(input)      — URL build with D-13 scopes + 256-bit state
//   - listenForCallback(opts)       — loopback server on 127.0.0.1:port
//   - exchangeCode(input)           — POST to WHOOP_TOKEN_URL, returns Tokens
//   - runOAuth(opts)                — composes the three above
//
// Decisions encoded here:
//   - D-09: success/failure HTML pages are inline verbatim — no CSS, no JS,
//     no external assets. Failure detail runs through sanitize() →
//     escapeHtml() (defense-in-depth — Pitfall C).
//   - D-10: 5-min default timeout, configurable via opts.timeoutMs.
//   - D-11: state is 32 bytes of crypto.randomBytes base64url-encoded.
//     Plain `===` compare is fine (RESEARCH Threat Patterns — equality
//     for opaque random strings; timingSafeEqual not required).
//   - D-13: scope set is the D13_SCOPES tuple from
//     src/infrastructure/config/schema.ts (single source of truth).
//     Callers pass `scopes`; the seven-string default lives in the
//     schema module, not here.
//   - A1 / D-12 / Pitfall I: PKCE is OFF by default. WHOOP's PKCE
//     support is unconfirmed; a flag-gated path threads challenge+verifier
//     when `usePkce: true` is set.
//   - Pitfall G: EADDRINUSE → AuthError({kind: 'auth_port_in_use'}). The
//     kind is owned by Plan 02-01 (Wave 0); this module consumes
//     errors.ts unchanged.
//   - BLOCKER 4 / OPEN-Q-01: the OAuth error-code response policy is
//     narrowed by error-code semantics — invalid_scope /
//     invalid_request / unsupported_response_type render the
//     error_description verbatim (after sanitize+escapeHtml) so the
//     user can diff against D-13's hardcoded scope strings; opaque
//     codes (server_error / access_denied / unauthorized_client /
//     temporarily_unavailable / default) strip the description as
//     defense-in-depth.
//
// ADR-0001 (stdout purity): this module is reachable from src/mcp/ via
// the eventual src/services/auth/ wiring (Plan 02-05). No console calls,
// no direct stdout writes — logger goes to stderr only. process.stderr.write
// is allowed for the --no-browser URL print arm (the user needs to see it
// in their terminal; stderr is the correct fd per ADR-0001).
//
// ADR-0007 (read-only WHOOP): exchangeCode POSTs to the token endpoint
// only — that POST is the one explicit exception ADR-0007 §Enforcement
// permits (the token endpoint is auth-only, not a content-write path).
// No PUT/PATCH/DELETE; no other POST destinations.
//
// Cross-layer import: this module imports `sanitize` from src/mcp/. The
// planner-level note PLAN-03-CROSS-LAYER documents the deferral of a
// cleaner refactor (move sanitize to src/infrastructure/observability/)
// to a later hardening pass. ADR-0001 §Consequences endorses one
// sanitizer module, cross-layer.

import { createHash, randomBytes } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { z } from 'zod';
import { sanitize } from '../../mcp/sanitize.js';
import { logger } from '../config/logger.js';
import { AuthError } from './errors.js';
import { type Tokens, WHOOP_TOKEN_URL } from './token-store.js';

// ---------------------------------------------------------------------------
// Constants — the authorize URL + the verbatim D-09 HTML pages.
// ---------------------------------------------------------------------------

/** D-13: WHOOP's authorize endpoint. Hardcoded here as the single source
 *  for the entire phase (Gate E-class invariant — only this module
 *  references the path under src/). */
export const WHOOP_AUTHORIZE_URL = 'https://api.prod.whoop.com/oauth/oauth2/auth';

/** D-13: WHOOP client-id charset — URL-safe characters only. Anything
 *  else is rejected before URLSearchParams build (RESEARCH Threat
 *  Patterns — defense against hostile clientId smuggling URL controls
 *  into the authorize URL). */
const CLIENT_ID_SHAPE = /^[A-Za-z0-9._~-]+$/;

/** D-09 success page — verbatim (no CSS, no JS, no external assets). */
const SUCCESS_HTML =
  '<!doctype html><meta charset="utf-8"><title>Recovery Ledger — auth complete</title><h1>Authorization complete.</h1><p>You can close this window and return to your terminal.</p>';

/** D-09 failure page template — `${escapedDetail}` substituted by
 *  failureHtml() AFTER detail is run through sanitize() + escapeHtml(). */
const FAILURE_HTML_PREFIX =
  '<!doctype html><meta charset="utf-8"><title>Recovery Ledger — auth failed</title><h1>Authorization failed</h1><pre>';
const FAILURE_HTML_SUFFIX =
  '</pre><p>Return to your terminal and run <code>recovery-ledger auth</code> again.</p>';

/** BLOCKER 4 / OPEN-Q-01: OAuth error codes whose `error_description` is
 *  rendered verbatim (after sanitize + escapeHtml) — these are the
 *  diagnosable codes where the description carries actionable signal the
 *  user can diff against D-13's hardcoded scope strings. All other error
 *  codes strip the description (failureHtml gets the code only). */
const RENDERABLE_OAUTH_ERROR_CODES = new Set([
  'invalid_scope',
  'invalid_request',
  'unsupported_response_type',
]);

/** D-10: default OAuth callback timeout. */
const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000;

// ---------------------------------------------------------------------------
// Types — public surface Plan 02-05's `auth.ts` consumes.
// ---------------------------------------------------------------------------

export interface BuildAuthorizeUrlInput {
  clientId: string;
  redirectUri: string;
  scopes: string[];
  state: string;
  challenge?: string | null;
}

export interface ListenForCallbackOptions {
  port: number;
  expectedState: string;
  timeoutMs: number;
  onListening?: (info: { port: number; address: string }) => void;
}

export interface ExchangeCodeInput {
  code: string;
  redirectUri: string;
  clientId: string;
  clientSecret: string;
  verifier?: string | null;
  fetch?: typeof globalThis.fetch;
}

export interface RunOAuthOptions {
  clientId: string;
  clientSecret: string;
  redirectPort: number;
  scopes: string[];
  noBrowser?: boolean;
  timeoutMs?: number;
  usePkce?: boolean;
  fetch?: typeof globalThis.fetch;
  openBrowser?: (url: string) => Promise<void>;
  onListening?: (info: { port: number; address: string }) => void;
}

// ---------------------------------------------------------------------------
// Validation — the token-endpoint response shape (Pitfall J passthrough).
// ---------------------------------------------------------------------------

const TokenResponseSchema = z
  .object({
    access_token: z.string(),
    refresh_token: z.string(),
    expires_in: z.number().int().positive(),
    scope: z.string(),
    token_type: z.literal('bearer'),
  })
  .passthrough();

// ---------------------------------------------------------------------------
// buildAuthorizeUrl — D-11 / D-13.
// ---------------------------------------------------------------------------

export function buildAuthorizeUrl(input: BuildAuthorizeUrlInput): string {
  if (!CLIENT_ID_SHAPE.test(input.clientId)) {
    // WR-B: kind is `auth_missing` (not `refresh_failed`) — a malformed
    // clientId in config is fixed by re-running `recovery-ledger init`,
    // not by re-authorizing tokens that do not exist yet. This check is
    // also a defense-in-depth duplicate of the canonical ConfigSchema
    // validation in init.ts; when it fires the schema has already let a
    // bad value through (config edited by hand, or schema weakened). The
    // remediation that points the user at `init` is the correct one.
    // (The FROZEN AuthErrorKind union has no `config_invalid` kind;
    // adding one would require updating formatAuthError, AUTH_EXIT_CODES,
    // and the --help block per MR-21 — out of scope for this fix.)
    throw new AuthError({
      kind: 'auth_missing',
      detail: 'invalid clientId in config; re-run recovery-ledger init',
    });
  }
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: input.clientId,
    redirect_uri: input.redirectUri,
    scope: input.scopes.join(' '),
    state: input.state,
  });
  if (input.challenge !== undefined && input.challenge !== null && input.challenge.length > 0) {
    params.set('code_challenge', input.challenge);
    params.set('code_challenge_method', 'S256');
  }
  return `${WHOOP_AUTHORIZE_URL}?${params.toString()}`;
}

// ---------------------------------------------------------------------------
// listenForCallback — D-09 / D-10 / D-11 / Pitfall G.
// ---------------------------------------------------------------------------

const CallbackQuerySchema = z.object({
  code: z.string().min(1).optional(),
  state: z.string().min(1).optional(),
  error: z.string().optional(),
  error_description: z.string().optional(),
});

export function listenForCallback(opts: ListenForCallbackOptions): Promise<{ code: string }> {
  return new Promise<{ code: string }>((resolve, reject) => {
    const server = createServer((req, res) => {
      // WR-01 defense-in-depth: only `GET /callback` resolves the OAuth flow.
      // A local-process scanner that hits the loopback port (`curl
      // http://127.0.0.1:4321/`, a POST from a stray service) would otherwise
      // drive the state-mismatch check as the SOLE filter. The 256-bit
      // `state` makes a guess-and-hit attack impractical, but the loopback
      // server should refuse to consider non-callback URLs at all. Method/path
      // mismatches return a plain status and DO NOT settle the promise — the
      // 5-minute window stays open for a legitimate browser redirect.
      if (req.method !== 'GET') {
        res.writeHead(405, { 'content-type': 'text/plain; charset=utf-8' });
        res.end('method not allowed');
        return;
      }
      let pathname: string;
      try {
        pathname = new URL(req.url ?? '/', 'http://127.0.0.1').pathname;
      } catch {
        res.writeHead(400, { 'content-type': 'text/plain; charset=utf-8' });
        res.end('bad request');
        return;
      }
      if (pathname !== '/callback') {
        res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
        res.end('not found');
        return;
      }
      handleCallback(req, res, opts.expectedState, finaliseResolve, finaliseReject);
    });

    let settled = false;
    let timer: NodeJS.Timeout | null = null;

    const finalise = (action: () => void): void => {
      if (settled) return;
      settled = true;
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      try {
        server.close();
      } catch {
        // best-effort
      }
      action();
    };

    function finaliseResolve(code: string): void {
      finalise(() => resolve({ code }));
    }
    function finaliseReject(err: unknown): void {
      finalise(() => reject(err));
    }

    server.on('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'EADDRINUSE') {
        finaliseReject(new AuthError({ kind: 'auth_port_in_use', detail: `port ${opts.port}` }));
      } else {
        finaliseReject(err);
      }
    });

    server.listen(opts.port, '127.0.0.1', () => {
      const addr = server.address() as AddressInfo | null;
      if (addr === null) {
        finaliseReject(new AuthError({ kind: 'refresh_failed', detail: 'no server address' }));
        return;
      }
      logger.info({ event: 'auth_started', port: addr.port });
      opts.onListening?.({ port: addr.port, address: '127.0.0.1' });
    });

    timer = setTimeout(() => {
      finaliseReject(new AuthError({ kind: 'auth_timeout' }));
    }, opts.timeoutMs);
    timer.unref();
  });
}

function handleCallback(
  req: IncomingMessage,
  res: ServerResponse,
  expectedState: string,
  onCode: (code: string) => void,
  onError: (err: unknown) => void,
): void {
  let parsed: z.infer<typeof CallbackQuerySchema>;
  try {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    const rawQuery: Record<string, string> = {};
    url.searchParams.forEach((v, k) => {
      rawQuery[k] = v;
    });
    parsed = CallbackQuerySchema.parse(rawQuery);
  } catch (err) {
    writeFailure(res, 'invalid callback');
    onError(new AuthError({ kind: 'refresh_failed', detail: 'invalid callback', cause: err }));
    return;
  }

  // OAuth error-code policy (BLOCKER 4 / OPEN-Q-01).
  if (parsed.error !== undefined && parsed.error.length > 0) {
    const code = parsed.error;
    const desc = parsed.error_description;
    const renderable = RENDERABLE_OAUTH_ERROR_CODES.has(code);
    const displayDetail =
      renderable && desc !== undefined && desc.length > 0 ? `${code}: ${desc}` : code;
    logger.warn({
      event: 'oauth_error',
      code,
      hasDescription: desc !== undefined && desc.length > 0,
      descriptionRendered: renderable,
    });
    writeFailure(res, displayDetail);
    onError(new AuthError({ kind: 'refresh_failed', detail: displayDetail }));
    return;
  }

  if (parsed.state !== expectedState) {
    writeFailure(res, 'state mismatch');
    onError(new AuthError({ kind: 'auth_state_mismatch' }));
    return;
  }

  if (parsed.code === undefined) {
    writeFailure(res, 'missing code');
    onError(new AuthError({ kind: 'refresh_failed', detail: 'missing code' }));
    return;
  }

  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  res.end(SUCCESS_HTML);
  logger.info({ event: 'callback_received', hasCode: true });
  onCode(parsed.code);
}

function writeFailure(res: ServerResponse, detail: string): void {
  res.writeHead(400, { 'content-type': 'text/html; charset=utf-8' });
  res.end(failureHtml(detail));
}

function failureHtml(detail: string): string {
  return `${FAILURE_HTML_PREFIX}${escapeHtml(sanitize(detail))}${FAILURE_HTML_SUFFIX}`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ---------------------------------------------------------------------------
// exchangeCode — POST to WHOOP_TOKEN_URL.
// ---------------------------------------------------------------------------

export async function exchangeCode(input: ExchangeCodeInput): Promise<Tokens> {
  const fetchFn = input.fetch ?? globalThis.fetch;
  const params = new URLSearchParams({
    grant_type: 'authorization_code',
    code: input.code,
    redirect_uri: input.redirectUri,
    client_id: input.clientId,
    client_secret: input.clientSecret,
  });
  if (input.verifier !== undefined && input.verifier !== null && input.verifier.length > 0) {
    params.set('code_verifier', input.verifier);
  }

  // Capture obtainedAt BEFORE the fetch so a slow network does not push
  // expiresAt past the actual token lifetime.
  const obtainedAt = Date.now();
  const res = await fetchFn(WHOOP_TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: params,
  });
  if (!res.ok) {
    logger.warn({ event: 'exchange_failed', status: res.status });
    throw new AuthError({
      kind: 'refresh_failed',
      detail: `token endpoint ${res.status}`,
    });
  }

  let parsed: z.infer<typeof TokenResponseSchema>;
  try {
    const json = (await res.json()) as unknown;
    parsed = TokenResponseSchema.parse(json);
  } catch (err) {
    logger.warn({ event: 'exchange_parse_failed' });
    throw new AuthError({ kind: 'refresh_failed', cause: err });
  }

  return {
    accessToken: parsed.access_token,
    refreshToken: parsed.refresh_token,
    tokenType: 'bearer',
    scope: parsed.scope,
    obtainedAt,
    expiresAt: obtainedAt + parsed.expires_in * 1000,
  };
}

// ---------------------------------------------------------------------------
// runOAuth — full orchestration (state + PKCE + listen + open + exchange).
// ---------------------------------------------------------------------------

interface PkceMaterial {
  verifier: string;
  challenge: string;
}

function generatePkce(): PkceMaterial {
  const verifier = randomBytes(64).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  return { verifier, challenge };
}

function printAuthorizeUrlToStderr(url: string): void {
  process.stderr.write(`Open this URL in your browser to authorize:\n${url}\n`);
}

export async function runOAuth(opts: RunOAuthOptions): Promise<Tokens> {
  const state = randomBytes(32).toString('base64url');
  const pkce = opts.usePkce === true ? generatePkce() : null;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const fetchFn = opts.fetch ?? globalThis.fetch;

  // Resolve `listening` once the loopback server reports back via
  // `onListening`. listenForCallback's contract guarantees the callback
  // fires exactly once before the server accepts requests; the Promise
  // shape eliminates the previous busy-wait.
  let resolveListening: (info: { port: number; address: string }) => void = () => undefined;
  const listening = new Promise<{ port: number; address: string }>((r) => {
    resolveListening = r;
  });

  // Start the loopback server FIRST — it must be listening before the
  // browser hits the redirect URL.
  const callbackPromise = listenForCallback({
    port: opts.redirectPort,
    expectedState: state,
    timeoutMs,
    onListening: (info) => {
      resolveListening(info);
      opts.onListening?.(info);
    },
  });

  const info = await listening;
  const redirectUri = `http://127.0.0.1:${info.port}/callback`;
  const authorizeUrl = buildAuthorizeUrl({
    clientId: opts.clientId,
    redirectUri,
    scopes: opts.scopes,
    state,
    challenge: pkce !== null ? pkce.challenge : null,
  });

  // Browser-open arm or stderr-print fallback.
  if (opts.noBrowser === true || opts.openBrowser === undefined) {
    printAuthorizeUrlToStderr(authorizeUrl);
  } else {
    try {
      await opts.openBrowser(authorizeUrl);
    } catch {
      // Fall back to stderr print — same as --no-browser path. The
      // listenForCallback timer is still running, so the user has the
      // full D-10 budget to copy the URL into a browser.
      printAuthorizeUrlToStderr(authorizeUrl);
    }
  }

  const { code } = await callbackPromise;
  return exchangeCode({
    code,
    redirectUri,
    clientId: opts.clientId,
    clientSecret: opts.clientSecret,
    verifier: pkce !== null ? pkce.verifier : null,
    fetch: fetchFn,
  });
}
