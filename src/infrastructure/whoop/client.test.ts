// Unit coverage for `httpGet` (D-17 + D-18 + D-21 + ADR-0007 +
// 03-PATTERNS.md §B1). The tests stand up MSW inline because the
// per-resource helpers ship in Plan 03-07; this file declares the
// handlers it needs in `beforeEach`.
//
// Phase 10 ARCH-03: `httpGet` now takes `authedCall` as its 4th positional
// parameter. The test constructs a per-test `authedCallSpy` (a vi.fn that
// invokes the supplied op with a fixed access token), so `fetch` runs
// through MSW with `Authorization: Bearer test-token-123` and no real
// refresh chain runs. C-10 inspects the call count on the spy to enforce
// the D-18 runtime attestation: authedCall fires exactly once per `httpGet`
// call. There is no longer any `vi.mock('refresh-orchestrator')` block —
// client.ts no longer imports from `src/services/`.

import { HttpResponse, http } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';
import { z } from 'zod';
import { type AuthedCall, httpGet, WHOOP_API_BASE } from './client.js';
import { WhoopApiError } from './errors.js';
import { _resetForTest as resetRateLimit } from './rate-limit.js';

// Per-test authedCall spy. Default behavior: invoke `op` with the fixed
// fake access token. Tests can override via `mockImplementationOnce` to
// exercise the 401-retry path (C-06). The spy is intentionally untyped at
// the vi.fn boundary so individual tests can narrow the op's response
// shape; `AuthedCall` is generic over `<T extends {status: number}>` and
// vi.fn cannot encode that quantifier directly.
const authedCallSpy = vi.fn();
// biome-ignore lint/suspicious/noExplicitAny: see comment above the spy
const authedCall: AuthedCall = ((op: (token: string) => Promise<any>) =>
  authedCallSpy(op)) as AuthedCall;

const server = setupServer();

beforeAll(() => {
  server.listen({ onUnhandledRequest: 'error' });
});

afterAll(() => {
  server.close();
});

beforeEach(() => {
  resetRateLimit();
  authedCallSpy.mockReset();
  // Default authedCall behavior: invoke the operation once with the
  // fixed access token. Tests can override before each call when they
  // need to exercise a different path.
  authedCallSpy.mockImplementation(async (op: (token: string) => Promise<{ status: number }>) =>
    op('test-token-123'),
  );
});

afterEach(() => {
  server.resetHandlers();
});

const okSchema = z.object({ ok: z.boolean() });

describe('httpGet — URL + headers + method', () => {
  test('C-01: 200 + valid JSON parses through the Zod schema and the result is returned', async () => {
    let observedUrl = '';
    server.use(
      http.get(`${WHOOP_API_BASE}/v2/cycle`, ({ request }) => {
        observedUrl = request.url;
        return HttpResponse.json({ ok: true });
      }),
    );

    const result = await httpGet('/v2/cycle', { limit: 25 }, okSchema, authedCall);

    expect(result).toEqual({ ok: true });
    expect(observedUrl).toContain(`${WHOOP_API_BASE}/v2/cycle`);
    expect(observedUrl).toContain('limit=25');
  });

  test('C-02: Authorization header on the outgoing request is `Bearer test-token-123` (proves callWithAuth threading)', async () => {
    let observedAuth: string | null = null;
    server.use(
      http.get(`${WHOOP_API_BASE}/v2/cycle`, ({ request }) => {
        observedAuth = request.headers.get('Authorization');
        return HttpResponse.json({ ok: true });
      }),
    );

    await httpGet('/v2/cycle', {}, okSchema, authedCall);
    expect(observedAuth).toBe('Bearer test-token-123');
  });

  test('C-03: request method is GET — locks ADR-0007 / D-21 read-only contract', async () => {
    let observedMethod: string | null = null;
    server.use(
      http.get(`${WHOOP_API_BASE}/v2/cycle`, ({ request }) => {
        observedMethod = request.method;
        return HttpResponse.json({ ok: true });
      }),
    );

    await httpGet('/v2/cycle', {}, okSchema, authedCall);
    expect(observedMethod).toBe('GET');
  });

  test('C-04: camelCase query params land verbatim in the URL (`nextToken=abc`)', async () => {
    let observedUrl = '';
    server.use(
      http.get(`${WHOOP_API_BASE}/v2/cycle`, ({ request }) => {
        observedUrl = request.url;
        return HttpResponse.json({ ok: true });
      }),
    );

    await httpGet('/v2/cycle', { nextToken: 'abc' }, okSchema, authedCall);
    expect(observedUrl).toContain('nextToken=abc');
  });

  test('C-05: undefined and null query values are omitted from the URL (not serialized)', async () => {
    let observedUrl = '';
    server.use(
      http.get(`${WHOOP_API_BASE}/v2/cycle`, ({ request }) => {
        observedUrl = request.url;
        return HttpResponse.json({ ok: true });
      }),
    );

    await httpGet(
      '/v2/cycle',
      { keep: 'yes', drop1: undefined, drop2: null },
      okSchema,
      authedCall,
    );
    expect(observedUrl).toContain('keep=yes');
    expect(observedUrl).not.toContain('drop1');
    expect(observedUrl).not.toContain('drop2');
    expect(observedUrl).not.toContain('undefined');
  });
});

describe('httpGet — retry + error mapping', () => {
  test('C-06: 401 is handled by callWithAuth; httpGet returns success when the mock supplies a fresh token retry', async () => {
    // Simulate the orchestrator's 401-recovery contract by having the
    // mock invoke `op` twice — first call returns a 401 we discard,
    // second call returns the eventual 200. This proves `httpGet` does
    // not try to handle 401s itself.
    let calls = 0;
    server.use(
      http.get(`${WHOOP_API_BASE}/v2/cycle`, () => {
        calls += 1;
        if (calls === 1) {
          return HttpResponse.json({}, { status: 401 });
        }
        return HttpResponse.json({ ok: true });
      }),
    );
    authedCallSpy.mockImplementationOnce(async (op: (token: string) => Promise<Response>) => {
      const first = await op('stale-token');
      if (first.status === 401) {
        return op('fresh-token');
      }
      return first;
    });

    const result = await httpGet('/v2/cycle', {}, okSchema, authedCall);
    expect(result).toEqual({ ok: true });
    expect(calls).toBe(2);
  });

  test('C-07: 429 retried via withRetry — second attempt returns 200 → httpGet returns success', async () => {
    let calls = 0;
    server.use(
      http.get(`${WHOOP_API_BASE}/v2/cycle`, () => {
        calls += 1;
        if (calls === 1) {
          return HttpResponse.json({}, { status: 429, headers: { 'X-RateLimit-Reset': '0' } });
        }
        return HttpResponse.json({ ok: true });
      }),
    );

    const result = await httpGet('/v2/cycle', {}, okSchema, authedCall);
    expect(result).toEqual({ ok: true });
    expect(calls).toBe(2);
  });

  test('C-08: 500 retried via withRetry — second attempt also 500 → throws WhoopApiError({kind: server})', async () => {
    server.use(
      http.get(`${WHOOP_API_BASE}/v2/cycle`, () => HttpResponse.json({}, { status: 500 })),
    );

    let captured: unknown;
    try {
      await httpGet('/v2/cycle', {}, okSchema, authedCall);
    } catch (err) {
      captured = err;
    }
    expect(captured).toBeInstanceOf(WhoopApiError);
    expect((captured as InstanceType<typeof WhoopApiError>).kind).toBe('server');
  });

  test('C-09: 200 with body that fails Zod parse throws WhoopApiError({kind: validation})', async () => {
    server.use(
      http.get(`${WHOOP_API_BASE}/v2/cycle`, () => HttpResponse.json({ not_ok: 'string' })),
    );

    let captured: unknown;
    try {
      await httpGet('/v2/cycle', {}, okSchema, authedCall);
    } catch (err) {
      captured = err;
    }
    expect(captured).toBeInstanceOf(WhoopApiError);
    expect((captured as InstanceType<typeof WhoopApiError>).kind).toBe('validation');
  });

  test('C-10: callWithAuth is invoked EXACTLY ONCE per httpGet call (D-18 runtime attestation)', async () => {
    server.use(http.get(`${WHOOP_API_BASE}/v2/cycle`, () => HttpResponse.json({ ok: true })));

    authedCallSpy.mockClear();
    await httpGet('/v2/cycle', {}, okSchema, authedCall);
    expect(authedCallSpy).toHaveBeenCalledTimes(1);
  });

  test('C-11: fetch is invoked at least once (smoke — load-bearing assertions live in C-01..C-05)', async () => {
    let hits = 0;
    server.use(
      http.get(`${WHOOP_API_BASE}/v2/cycle`, () => {
        hits += 1;
        return HttpResponse.json({ ok: true });
      }),
    );

    await httpGet('/v2/cycle', {}, okSchema, authedCall);
    expect(hits).toBeGreaterThanOrEqual(1);
  });
});
