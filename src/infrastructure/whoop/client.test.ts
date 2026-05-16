// Unit coverage for `httpGet` (D-17 + D-18 + D-21 + ADR-0007 +
// 03-PATTERNS.md §B1). The tests stand up MSW inline because the
// per-resource helpers ship in Plan 03-07; this file declares the
// handlers it needs in `beforeEach`. The `callWithAuth` chokepoint is
// mocked at the module boundary via `vi.mock(...)` so a real refresh
// chain (which would call into `token-store.ts` and the OS keychain)
// never runs. Test 10 spies the mock to enforce the D-18 runtime
// attestation: callWithAuth fires exactly once per `httpGet` call.

import { HttpResponse, http } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';
import { z } from 'zod';

// vi.mock factory — the production `callWithAuth` reaches into
// `tokenStore.getValidAccessToken()`, which reads OS keychain state. The
// mock returns a fixed access token by simply invoking the supplied
// operation, so `fetch` runs through MSW with `Authorization: Bearer
// test-token-123` and the rest of the orchestrator chain is bypassed.
// Test 10 inspects the call count on this mock.
const callWithAuthSpy = vi.fn();
vi.mock('../../services/refresh-orchestrator.js', () => ({
  callWithAuth: (op: (token: string) => Promise<unknown>) => callWithAuthSpy(op),
}));

// Imported AFTER the mock so the client picks up the fake.
const { httpGet, WHOOP_API_BASE } = await import('./client.js');
const { _resetForTest: resetRateLimit } = await import('./rate-limit.js');
const { WhoopApiError } = await import('./errors.js');

const server = setupServer();

beforeAll(() => {
  server.listen({ onUnhandledRequest: 'error' });
});

afterAll(() => {
  server.close();
});

beforeEach(() => {
  resetRateLimit();
  callWithAuthSpy.mockReset();
  // Default callWithAuth behavior: invoke the operation once with the
  // fixed access token. Tests can override before each call when they
  // need to exercise a different path.
  callWithAuthSpy.mockImplementation(async (op: (token: string) => Promise<unknown>) =>
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

    const result = await httpGet('/v2/cycle', { limit: 25 }, okSchema);

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

    await httpGet('/v2/cycle', {}, okSchema);
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

    await httpGet('/v2/cycle', {}, okSchema);
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

    await httpGet('/v2/cycle', { nextToken: 'abc' }, okSchema);
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

    await httpGet('/v2/cycle', { keep: 'yes', drop1: undefined, drop2: null }, okSchema);
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
    callWithAuthSpy.mockImplementationOnce(async (op: (token: string) => Promise<Response>) => {
      const first = await op('stale-token');
      if (first.status === 401) {
        return op('fresh-token');
      }
      return first;
    });

    const result = await httpGet('/v2/cycle', {}, okSchema);
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

    const result = await httpGet('/v2/cycle', {}, okSchema);
    expect(result).toEqual({ ok: true });
    expect(calls).toBe(2);
  });

  test('C-08: 500 retried via withRetry — second attempt also 500 → throws WhoopApiError({kind: server})', async () => {
    server.use(
      http.get(`${WHOOP_API_BASE}/v2/cycle`, () => HttpResponse.json({}, { status: 500 })),
    );

    let captured: unknown;
    try {
      await httpGet('/v2/cycle', {}, okSchema);
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
      await httpGet('/v2/cycle', {}, okSchema);
    } catch (err) {
      captured = err;
    }
    expect(captured).toBeInstanceOf(WhoopApiError);
    expect((captured as InstanceType<typeof WhoopApiError>).kind).toBe('validation');
  });

  test('C-10: callWithAuth is invoked EXACTLY ONCE per httpGet call (D-18 runtime attestation)', async () => {
    server.use(http.get(`${WHOOP_API_BASE}/v2/cycle`, () => HttpResponse.json({ ok: true })));

    callWithAuthSpy.mockClear();
    await httpGet('/v2/cycle', {}, okSchema);
    expect(callWithAuthSpy).toHaveBeenCalledTimes(1);
  });

  test('C-11: fetch is invoked at least once (smoke — load-bearing assertions live in C-01..C-05)', async () => {
    let hits = 0;
    server.use(
      http.get(`${WHOOP_API_BASE}/v2/cycle`, () => {
        hits += 1;
        return HttpResponse.json({ ok: true });
      }),
    );

    await httpGet('/v2/cycle', {}, okSchema);
    expect(hits).toBeGreaterThanOrEqual(1);
  });
});
