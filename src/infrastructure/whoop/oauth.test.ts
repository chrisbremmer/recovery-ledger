// Unit coverage for the OAuth authorization-code surface (Plan 02-03).
//
// Test groups (per <behavior> in 02-03-oauth-round-trip-PLAN.md):
//   buildAuthorizeUrl              — U-01..U-03
//   listenForCallback              — L-01..L-06
//   oauth error-code response      — OE-01..OE-09 (BLOCKER 4 / OPEN-Q-01)
//   exchangeCode                   — X-01..X-06
//   runOAuth                       — R-01..R-03
//
// Pattern: per-test isolation via `port: 0` (OS-assigned) — the
// `onListening` callback surfaces the chosen port so the test can drive a
// real `fetch` against the loopback server. The exchangeCode tests drive
// MSW via `createWhoopOauthHelper()` from `tests/helpers/msw-whoop-oauth.ts`.

import { createServer, type Server } from 'node:http';
import { afterAll, afterEach, beforeAll, describe, expect, test, vi } from 'vitest';
import {
  createWhoopOauthHelper,
  WHOOP_TOKEN_URL,
  type WhoopOauthHelper,
} from '../../../tests/helpers/msw-whoop-oauth.js';
import { AuthError } from './errors.js';
import {
  buildAuthorizeUrl,
  exchangeCode,
  listenForCallback,
  runOAuth,
  WHOOP_AUTHORIZE_URL,
} from './oauth.js';

// ---------------------------------------------------------------------------
// buildAuthorizeUrl — U-01..U-03
// ---------------------------------------------------------------------------

describe('buildAuthorizeUrl', () => {
  test('U-01: returns a WHOOP-shape authorize URL with required params', () => {
    const url = buildAuthorizeUrl({
      clientId: 'cid',
      redirectUri: 'http://127.0.0.1:4321/callback',
      scopes: ['offline', 'read:recovery'],
      state: 'st',
    });
    const parsed = new URL(url);
    expect(parsed.host).toBe('api.prod.whoop.com');
    expect(parsed.pathname).toBe('/oauth/oauth2/auth');
    expect(parsed.searchParams.get('response_type')).toBe('code');
    expect(parsed.searchParams.get('client_id')).toBe('cid');
    expect(parsed.searchParams.get('redirect_uri')).toBe('http://127.0.0.1:4321/callback');
    expect(parsed.searchParams.get('scope')).toBe('offline read:recovery');
    expect(parsed.searchParams.get('state')).toBe('st');
  });

  test('U-02: without challenge, NO code_challenge param (PKCE off by default)', () => {
    const url = buildAuthorizeUrl({
      clientId: 'cid',
      redirectUri: 'http://127.0.0.1:4321/callback',
      scopes: ['offline'],
      state: 'st',
    });
    const parsed = new URL(url);
    expect(parsed.searchParams.has('code_challenge')).toBe(false);
    expect(parsed.searchParams.has('code_challenge_method')).toBe(false);
  });

  test('U-03: with challenge, code_challenge + code_challenge_method=S256 are present', () => {
    const url = buildAuthorizeUrl({
      clientId: 'cid',
      redirectUri: 'http://127.0.0.1:4321/callback',
      scopes: ['offline'],
      state: 'st',
      challenge: 'abc',
    });
    const parsed = new URL(url);
    expect(parsed.searchParams.get('code_challenge')).toBe('abc');
    expect(parsed.searchParams.get('code_challenge_method')).toBe('S256');
  });

  test('U-04: exports WHOOP_AUTHORIZE_URL as the authorize endpoint constant', () => {
    expect(WHOOP_AUTHORIZE_URL).toBe('https://api.prod.whoop.com/oauth/oauth2/auth');
  });

  test('U-05: hostile clientId shape is rejected with AuthError', () => {
    expect(() =>
      buildAuthorizeUrl({
        clientId: 'cid&injected=evil',
        redirectUri: 'http://127.0.0.1:4321/callback',
        scopes: ['offline'],
        state: 'st',
      }),
    ).toThrow(AuthError);
  });
});

// ---------------------------------------------------------------------------
// listenForCallback — L-01..L-06
// ---------------------------------------------------------------------------

interface ListeningInfo {
  port: number;
  address: string;
}

async function waitFor<T>(probe: () => T | undefined, timeoutMs = 1000): Promise<T> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const v = probe();
    if (v !== undefined) return v;
    await new Promise((r) => setTimeout(r, 5));
  }
  throw new Error('waitFor timed out');
}

describe('listenForCallback', () => {
  test('L-01: happy path resolves with {code} and renders D-09 success HTML', async () => {
    let info: ListeningInfo | undefined;
    const callbackPromise = listenForCallback({
      port: 0,
      expectedState: 'st',
      timeoutMs: 5000,
      onListening: (i) => {
        info = i;
      },
    });
    const { port } = await waitFor(() => info);
    const res = await fetch(`http://127.0.0.1:${port}/callback?code=xyz&state=st`);
    const body = await res.text();
    const result = await callbackPromise;
    expect(result.code).toBe('xyz');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/^text\/html/);
    expect(body).toContain('Authorization complete');
    expect(body).toContain('You can close this window');
  });

  test('L-02: state mismatch rejects with AuthError({kind: auth_state_mismatch})', async () => {
    let info: ListeningInfo | undefined;
    // Wrap into a settled promise immediately — see `driveCallbackError`
    // rationale above (avoid unhandled-rejection warnings between fetch
    // completion and the consumer `await`).
    const settled = listenForCallback({
      port: 0,
      expectedState: 'st',
      timeoutMs: 5000,
      onListening: (i) => {
        info = i;
      },
    }).then(
      (v) => ({ ok: true as const, value: v }),
      (err: unknown) => ({ ok: false as const, err }),
    );
    const { port } = await waitFor(() => info);
    const res = await fetch(`http://127.0.0.1:${port}/callback?code=xyz&state=wrong`);
    const body = await res.text();
    const result = await settled;
    expect(result.ok).toBe(false);
    const caught = result.ok ? undefined : result.err;
    expect(caught).toBeInstanceOf(AuthError);
    expect((caught as AuthError).kind).toBe('auth_state_mismatch');
    expect(res.status).toBe(400);
    expect(body).toContain('Authorization failed');
    expect(body).toContain('state mismatch');
  });

  test('L-03: timeout rejects with AuthError({kind: auth_timeout}) and closes server', async () => {
    let info: ListeningInfo | undefined;
    const callbackPromise = listenForCallback({
      port: 0,
      expectedState: 'st',
      timeoutMs: 50,
      onListening: (i) => {
        info = i;
      },
    });
    const { port } = await waitFor(() => info);
    let caught: unknown;
    const t0 = Date.now();
    try {
      await callbackPromise;
    } catch (err) {
      caught = err;
    }
    const elapsed = Date.now() - t0;
    expect(caught).toBeInstanceOf(AuthError);
    expect((caught as AuthError).kind).toBe('auth_timeout');
    expect(elapsed).toBeLessThan(500);
    // Server is closed — a subsequent connection should fail
    await expect(fetch(`http://127.0.0.1:${port}/callback?code=xyz&state=st`)).rejects.toThrow();
  });

  test('L-04: server closes after success (subsequent fetch fails)', async () => {
    let info: ListeningInfo | undefined;
    const callbackPromise = listenForCallback({
      port: 0,
      expectedState: 'st',
      timeoutMs: 5000,
      onListening: (i) => {
        info = i;
      },
    });
    const { port } = await waitFor(() => info);
    await fetch(`http://127.0.0.1:${port}/callback?code=xyz&state=st`);
    await callbackPromise;
    // Server should be closed — subsequent fetch fails
    await expect(fetch(`http://127.0.0.1:${port}/callback?code=xyz&state=st`)).rejects.toThrow();
  });

  test('L-05: EADDRINUSE rejects with AuthError({kind: auth_port_in_use})', async () => {
    // Bind a sacrificial server first
    const sacrificial: Server = createServer();
    await new Promise<void>((resolve) => {
      sacrificial.listen(0, '127.0.0.1', () => resolve());
    });
    const addr = sacrificial.address();
    if (addr === null || typeof addr === 'string') {
      throw new Error('failed to obtain port');
    }
    const sacrificialPort = addr.port;
    try {
      let caught: unknown;
      try {
        await listenForCallback({
          port: sacrificialPort,
          expectedState: 'st',
          timeoutMs: 5000,
        });
      } catch (err) {
        caught = err;
      }
      expect(caught).toBeInstanceOf(AuthError);
      expect((caught as AuthError).kind).toBe('auth_port_in_use');
      expect((caught as AuthError).message).toContain(String(sacrificialPort));
    } finally {
      await new Promise<void>((resolve) => sacrificial.close(() => resolve()));
    }
  });

  test('L-06: onListening fires with address 127.0.0.1 (loopback-only binding)', async () => {
    let info: ListeningInfo | undefined;
    const callbackPromise = listenForCallback({
      port: 0,
      expectedState: 'st',
      timeoutMs: 5000,
      onListening: (i) => {
        info = i;
      },
    });
    const ready = await waitFor(() => info);
    expect(ready.address).toBe('127.0.0.1');
    expect(ready.address).not.toBe('0.0.0.0');
    // Drive the callback so the promise resolves and the server closes
    await fetch(`http://127.0.0.1:${ready.port}/callback?code=xyz&state=st`);
    await callbackPromise;
  });

  test('L-07 (WR-01 regression): non-GET methods on /callback are refused with 405 and DO NOT resolve the flow', async () => {
    // WR-01 defense-in-depth: only GET /callback resolves the OAuth flow. A
    // POST to /callback with valid-looking code+state must NOT resolve, even
    // if the attacker guessed the state value (the state is 256 bits so this
    // is impractical, but the layered defense is the contract).
    let info: ListeningInfo | undefined;
    const callbackPromise = listenForCallback({
      port: 0,
      expectedState: 'st',
      timeoutMs: 200,
      onListening: (i) => {
        info = i;
      },
    });
    const { port } = await waitFor(() => info);
    const res = await fetch(`http://127.0.0.1:${port}/callback?code=xyz&state=st`, {
      method: 'POST',
    });
    expect(res.status).toBe(405);

    // The flow should NOT have resolved on the POST. The timeout (200ms)
    // should fire instead, producing AuthError(auth_timeout). If the WR-01
    // fix regressed, the promise would resolve with code 'xyz'.
    let caught: unknown;
    try {
      await callbackPromise;
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(AuthError);
    expect((caught as AuthError).kind).toBe('auth_timeout');
  });

  test('L-08 (WR-01 regression): unknown paths return 404 and DO NOT resolve the flow', async () => {
    let info: ListeningInfo | undefined;
    const callbackPromise = listenForCallback({
      port: 0,
      expectedState: 'st',
      timeoutMs: 200,
      onListening: (i) => {
        info = i;
      },
    });
    const { port } = await waitFor(() => info);
    // Attacker probes the loopback port at any path that isn't /callback —
    // the state-mismatch check is no longer the sole filter.
    const res = await fetch(`http://127.0.0.1:${port}/literally-anything?code=xyz&state=st`);
    expect(res.status).toBe(404);

    let caught: unknown;
    try {
      await callbackPromise;
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(AuthError);
    expect((caught as AuthError).kind).toBe('auth_timeout');
  });
});

// ---------------------------------------------------------------------------
// OAuth error-code response policy — OE-01..OE-09 (BLOCKER 4 / OPEN-Q-01)
// ---------------------------------------------------------------------------

async function driveCallbackError(query: string): Promise<{ body: string; caught: unknown }> {
  let info: ListeningInfo | undefined;
  // Capture the rejection immediately into a settled-promise wrapper so the
  // unhandled-rejection guard does not fire between the fetch completing and
  // the `await caughtWrapper` below. Vitest treats a rejection observed after
  // a single tick gap as unhandled even when the caller will eventually
  // `await` the original promise.
  const caughtWrapper = listenForCallback({
    port: 0,
    expectedState: 'st',
    timeoutMs: 5000,
    onListening: (i) => {
      info = i;
    },
  }).then(
    (v) => ({ ok: true as const, value: v }),
    (err: unknown) => ({ ok: false as const, err }),
  );
  const { port } = await waitFor(() => info);
  const res = await fetch(`http://127.0.0.1:${port}/callback?${query}`);
  const body = await res.text();
  const settled = await caughtWrapper;
  const caught = settled.ok ? undefined : settled.err;
  return { body, caught };
}

describe('oauth error-code response policy', () => {
  test('OE-01: invalid_scope renders error_description verbatim (after sanitize+escapeHtml)', async () => {
    const { body, caught } = await driveCallbackError(
      'error=invalid_scope&error_description=read%3Abody_measurement+is+not+valid&state=st',
    );
    expect(body).toContain('read:body_measurement is not valid');
    expect(caught).toBeInstanceOf(AuthError);
    expect((caught as AuthError).message).toContain('invalid_scope');
  });

  test('OE-02: invalid_request renders error_description verbatim', async () => {
    const { body } = await driveCallbackError(
      'error=invalid_request&error_description=redirect_uri+mismatch&state=st',
    );
    expect(body).toContain('redirect_uri mismatch');
  });

  test('OE-03: unsupported_response_type renders error_description verbatim', async () => {
    const { body } = await driveCallbackError(
      'error=unsupported_response_type&error_description=only+code+supported&state=st',
    );
    expect(body).toContain('only code supported');
  });

  test('OE-04: server_error strips error_description', async () => {
    const { body, caught } = await driveCallbackError(
      'error=server_error&error_description=internal+session+abc123&state=st',
    );
    expect(body).not.toContain('internal session abc123');
    expect(body).toContain('server_error');
    expect(caught).toBeInstanceOf(AuthError);
    expect((caught as AuthError).message).toContain('server_error');
    expect((caught as AuthError).message).not.toContain('internal session abc123');
  });

  test('OE-05: access_denied strips error_description', async () => {
    const { body } = await driveCallbackError(
      'error=access_denied&error_description=user+sid+xyz&state=st',
    );
    expect(body).not.toContain('user sid xyz');
    expect(body).toContain('access_denied');
  });

  test('OE-06: unauthorized_client strips error_description', async () => {
    const { body } = await driveCallbackError(
      'error=unauthorized_client&error_description=client_id+xyz+invalid&state=st',
    );
    expect(body).not.toContain('client_id xyz invalid');
    expect(body).toContain('unauthorized_client');
  });

  test('OE-07: unknown error code strips error_description (default arm)', async () => {
    const { body } = await driveCallbackError(
      'error=some_unknown_code&error_description=opaque+detail&state=st',
    );
    expect(body).not.toContain('opaque detail');
    expect(body).toContain('some_unknown_code');
  });

  test('OE-08: sanitize still runs on render path (token-shaped substring redacted)', async () => {
    // The error_description carries a JWT-shaped string. Pattern 3 in
    // sanitize.ts catches the JWT shape; the render path must run it
    // through sanitize() before HTML insertion.
    const jwt = 'eyJabcdef.eyJxyzabcdef.signatureMoreChars';
    const { body } = await driveCallbackError(
      `error=invalid_scope&error_description=token-leaked-${jwt}&state=st`,
    );
    expect(body).not.toContain(jwt);
  });

  test('OE-09: BLOCKER 4 verbatim — error_description=foo renders foo', async () => {
    // The literal acceptance criterion from checker BLOCKER 4: a callback
    // with ?error=invalid_scope&error_description=foo must result in a
    // failureHtml body containing the substring "foo".
    const { body } = await driveCallbackError('error=invalid_scope&error_description=foo&state=st');
    expect(body).toContain('foo');
  });
});

// ---------------------------------------------------------------------------
// exchangeCode — X-01..X-06
// ---------------------------------------------------------------------------

describe('exchangeCode', () => {
  let helper: WhoopOauthHelper;

  beforeAll(() => {
    helper = createWhoopOauthHelper();
    helper.server.listen({ onUnhandledRequest: 'bypass' });
  });

  afterAll(() => {
    helper.server.close();
  });

  afterEach(() => {
    helper.resetRefreshHitCount();
    helper.server.resetHandlers();
  });

  test('X-01: happy path returns Tokens with expiresAt = obtainedAt + expires_in*1000', async () => {
    const t0 = Date.now();
    const tokens = await exchangeCode({
      code: 'c',
      redirectUri: 'http://127.0.0.1:4321/callback',
      clientId: 'cid',
      clientSecret: 'secret',
    });
    expect(tokens.accessToken).toBe('at-1');
    expect(tokens.refreshToken).toBe('rt-1');
    expect(tokens.tokenType).toBe('bearer');
    expect(tokens.scope).toContain('offline');
    expect(tokens.obtainedAt).toBeGreaterThanOrEqual(t0 - 100);
    expect(tokens.obtainedAt).toBeLessThanOrEqual(Date.now() + 100);
    expect(tokens.expiresAt).toBe(tokens.obtainedAt + 3600 * 1000);
  });

  test('X-02: invalid_grant 400 rejects with AuthError({kind: refresh_failed})', async () => {
    helper.setNextResponse({ error: 'invalid_grant' }, 400);
    let caught: unknown;
    try {
      await exchangeCode({
        code: 'c',
        redirectUri: 'http://127.0.0.1:4321/callback',
        clientId: 'cid',
        clientSecret: 'secret',
      });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(AuthError);
    expect((caught as AuthError).kind).toBe('refresh_failed');
    expect((caught as AuthError).message).toContain('400');
  });

  test('X-03: form body is application/x-www-form-urlencoded with required fields', async () => {
    let captured: { body: string; contentType: string | null } | null = null;
    helper.server.use(
      (await import('msw')).http.post(WHOOP_TOKEN_URL, async ({ request }) => {
        captured = {
          body: await request.text(),
          contentType: request.headers.get('content-type'),
        };
        return (await import('msw')).HttpResponse.json({
          access_token: 'at-1',
          refresh_token: 'rt-1',
          expires_in: 3600,
          scope: 'offline',
          token_type: 'bearer',
        });
      }),
    );
    await exchangeCode({
      code: 'c',
      redirectUri: 'http://127.0.0.1:4321/callback',
      clientId: 'cid',
      clientSecret: 'secret',
    });
    expect(captured).not.toBeNull();
    const cap = captured as unknown as { body: string; contentType: string | null };
    expect(cap.contentType).toContain('application/x-www-form-urlencoded');
    expect(cap.body).toContain('grant_type=authorization_code');
    expect(cap.body).toContain('code=c');
    expect(cap.body).toContain('client_id=cid');
    expect(cap.body).toContain('client_secret=secret');
    expect(cap.body).toContain(
      `redirect_uri=${encodeURIComponent('http://127.0.0.1:4321/callback')}`,
    );
  });

  test('X-04: when verifier is present, code_verifier appears in the form body', async () => {
    let bodyCapture = '';
    helper.server.use(
      (await import('msw')).http.post(WHOOP_TOKEN_URL, async ({ request }) => {
        bodyCapture = await request.text();
        return (await import('msw')).HttpResponse.json({
          access_token: 'at-1',
          refresh_token: 'rt-1',
          expires_in: 3600,
          scope: 'offline',
          token_type: 'bearer',
        });
      }),
    );
    await exchangeCode({
      code: 'c',
      redirectUri: 'http://127.0.0.1:4321/callback',
      clientId: 'cid',
      clientSecret: 'secret',
      verifier: 'v',
    });
    expect(bodyCapture).toContain('code_verifier=v');
  });

  test('X-05: Zod passthrough accepts extra_field without parse failure', async () => {
    helper.setNextResponse(
      {
        access_token: 'at-1',
        refresh_token: 'rt-1',
        expires_in: 3600,
        scope: 'offline',
        token_type: 'bearer',
        extra_field: 'noise',
      },
      200,
    );
    const tokens = await exchangeCode({
      code: 'c',
      redirectUri: 'http://127.0.0.1:4321/callback',
      clientId: 'cid',
      clientSecret: 'secret',
    });
    expect(tokens.accessToken).toBe('at-1');
  });

  test('X-06: missing required fields rejects with AuthError({kind: refresh_failed})', async () => {
    helper.setNextResponse({ access_token: 'at' }, 200);
    let caught: unknown;
    try {
      await exchangeCode({
        code: 'c',
        redirectUri: 'http://127.0.0.1:4321/callback',
        clientId: 'cid',
        clientSecret: 'secret',
      });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(AuthError);
    expect((caught as AuthError).kind).toBe('refresh_failed');
  });
});

// ---------------------------------------------------------------------------
// runOAuth — R-01..R-03
// ---------------------------------------------------------------------------

describe('runOAuth', () => {
  let helper: WhoopOauthHelper;

  beforeAll(() => {
    helper = createWhoopOauthHelper();
    helper.server.listen({ onUnhandledRequest: 'bypass' });
  });

  afterAll(() => {
    helper.server.close();
  });

  afterEach(() => {
    helper.resetRefreshHitCount();
    helper.server.resetHandlers();
  });

  test('R-01: orchestrates state generation, openBrowser call, callback, code exchange', async () => {
    let capturedUrl: string | null = null;
    const oauthPromise = runOAuth({
      clientId: 'cid',
      clientSecret: 'secret',
      redirectPort: 0,
      scopes: ['offline', 'read:recovery'],
      openBrowser: async (url) => {
        capturedUrl = url;
      },
    });
    // Wait for openBrowser to be called with the authorize URL
    const url = await waitFor(() => capturedUrl ?? undefined);
    const parsed = new URL(url);
    const state = parsed.searchParams.get('state');
    expect(state).not.toBeNull();
    expect(state).toMatch(/^[A-Za-z0-9_-]+$/);
    const redirectUri = parsed.searchParams.get('redirect_uri');
    expect(redirectUri).not.toBeNull();
    const callbackUrl = `${redirectUri}?code=xyz&state=${state}`;
    await fetch(callbackUrl);
    const tokens = await oauthPromise;
    expect(tokens.accessToken).toBe('at-1');
    expect(tokens.refreshToken).toBe('rt-1');
  });

  test('R-02: --no-browser path skips openBrowser and prints URL to stderr', async () => {
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const openSpy = vi.fn(async () => undefined);
    try {
      let info: ListeningInfo | undefined;
      const oauthPromise = runOAuth({
        clientId: 'cid',
        clientSecret: 'secret',
        redirectPort: 0,
        scopes: ['offline'],
        noBrowser: true,
        openBrowser: openSpy,
        onListening: (i) => {
          info = i;
        },
      });
      const ready = await waitFor(() => info);
      // Verify stderr received the authorize URL
      const writes = stderrSpy.mock.calls.map((c) => String(c[0])).join('');
      expect(writes).toContain('api.prod.whoop.com/oauth/oauth2/auth');
      // Extract state from the printed URL
      const urlMatch = writes.match(/https:\/\/[^\s]+/);
      expect(urlMatch).not.toBeNull();
      const matched = urlMatch as RegExpMatchArray;
      const printed = new URL(matched[0]);
      const state = printed.searchParams.get('state');
      expect(state).not.toBeNull();
      await fetch(`http://127.0.0.1:${ready.port}/callback?code=xyz&state=${state}`);
      const tokens = await oauthPromise;
      expect(tokens.accessToken).toBe('at-1');
      expect(openSpy).not.toHaveBeenCalled();
    } finally {
      stderrSpy.mockRestore();
    }
  });

  test('R-03: openBrowser throws → falls back to stderr-print path', async () => {
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    try {
      let info: ListeningInfo | undefined;
      const oauthPromise = runOAuth({
        clientId: 'cid',
        clientSecret: 'secret',
        redirectPort: 0,
        scopes: ['offline'],
        openBrowser: async () => {
          throw new Error('no display');
        },
        onListening: (i) => {
          info = i;
        },
      });
      const ready = await waitFor(() => info);
      const writes = stderrSpy.mock.calls.map((c) => String(c[0])).join('');
      expect(writes).toContain('api.prod.whoop.com/oauth/oauth2/auth');
      const urlMatch = writes.match(/https:\/\/[^\s]+/);
      const matched = urlMatch as RegExpMatchArray;
      const printed = new URL(matched[0]);
      const state = printed.searchParams.get('state');
      await fetch(`http://127.0.0.1:${ready.port}/callback?code=xyz&state=${state}`);
      const tokens = await oauthPromise;
      expect(tokens.accessToken).toBe('at-1');
    } finally {
      stderrSpy.mockRestore();
    }
  });
});

// Quieter test: ensure listenForCallback is invoked many times without leaking
// timers/handles — relies on the finalise() one-shot guard.
describe('listenForCallback cleanup', () => {
  test('multiple sequential rounds do not leak handles', async () => {
    for (let i = 0; i < 3; i++) {
      let info: ListeningInfo | undefined;
      const p = listenForCallback({
        port: 0,
        expectedState: `s${i}`,
        timeoutMs: 5000,
        onListening: (x) => {
          info = x;
        },
      });
      const { port } = await waitFor(() => info);
      await fetch(`http://127.0.0.1:${port}/callback?code=c${i}&state=s${i}`);
      const r = await p;
      expect(r.code).toBe(`c${i}`);
    }
  });
});
