// MSW helper for the WHOOP `/v2/cycle` endpoint. Mirrors the shape of
// `tests/helpers/msw-whoop-oauth.ts` (Plan 02-01) verbatim so every test
// file shares one mental model for WHOOP HTTP fakes. One helper file per
// resource (conventions.md §Testing).
//
// The handler uses `http.get` (D-21 GET-only + ADR-0007 — read-only WHOOP).
// `CYCLES_URL` is the SINGLE source of truth for the cycles endpoint URL;
// resource modules (Plan 03-09) and contract tests both pin against the
// same `WHOOP_API_BASE` constant. The default response loads
// `tests/fixtures/whoop/cycles/200-ok.json` lazily per-request — a test
// that edits the fixture mid-run sees the updated bytes (same pattern as
// Phase 1's doctor fixtures + Plan 02-01's oauth helper).
//
// `setNextResponse` is the one-shot override seam for 429 / 5xx / custom
// scenarios. After the override fires, the handler reverts to the default
// fixture-backed response.
//
// Default response headers include the WHOOP-realistic rate-limit trio
// (X-RateLimit-Remaining=95, X-RateLimit-Reset=60, X-RateLimit-Limit per
// A5) — required for `rate-limit.ts` test coverage from Plan 03-06.
//
// No direct stdout writes / no console calls — test file under `tests/`
// (Gate B exemption covers test code), constraint held as defense in
// depth.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { type HttpHandler, HttpResponse, http, type JsonBodyType } from 'msw';
import { type SetupServer, setupServer } from 'msw/node';

export const CYCLES_URL = 'https://api.prod.whoop.com/v2/cycle';

const FIXTURES_DIR = join(process.cwd(), 'tests', 'fixtures', 'whoop', 'cycles');
const DEFAULT_FIXTURE_PATH = join(FIXTURES_DIR, '200-ok.json');

const DEFAULT_HEADERS: Readonly<Record<string, string>> = {
  'X-RateLimit-Remaining': '95',
  'X-RateLimit-Reset': '60',
  'X-RateLimit-Limit': 'requests=100, window=60',
};

interface NextResponse {
  body: JsonBodyType;
  status: number;
  headers?: Record<string, string> | undefined;
}

export interface WhoopCyclesHelper {
  server: SetupServer;
  getHitCount(): number;
  resetHitCount(): void;
  /**
   * Override the next single response from the cycles endpoint. After the
   * one-shot fires, the handler reverts to the default fixture-backed
   * response. Used by 429 / 5xx scenario tests (Plan 03-06 retry coverage).
   */
  setNextResponse(body: unknown, status?: number, headers?: Record<string, string>): void;
  /**
   * Returns the URL of the most recent GET against the cycles endpoint,
   * or `null` if no request has been made since the last reset. Used by
   * pagination tests to assert the `nextToken` query param landed.
   */
  getLastRequestUrl(): URL | null;
}

export function createWhoopCyclesHelper(): WhoopCyclesHelper {
  let hitCount = 0;
  let nextResponse: NextResponse | null = null;
  let lastRequestUrl: URL | null = null;

  const handler: HttpHandler = http.get(CYCLES_URL, ({ request }) => {
    hitCount += 1;
    lastRequestUrl = new URL(request.url);
    if (nextResponse !== null) {
      const r = nextResponse;
      nextResponse = null;
      return HttpResponse.json(r.body, {
        status: r.status,
        headers: { ...DEFAULT_HEADERS, ...(r.headers ?? {}) },
      });
    }
    // Optional scenario-by-query-param seam: tests can append
    // `?__test_scenario=200-paginated-page1` to a request URL and the
    // helper loads `tests/fixtures/whoop/cycles/<scenario>.json` instead
    // of the default. Same pattern as the oauth helper's
    // `setNextResponse` for ergonomics across pagination + DST scenarios.
    const scenarioParam = lastRequestUrl.searchParams.get('__test_scenario');
    const fixturePath = scenarioParam
      ? join(FIXTURES_DIR, `${scenarioParam}.json`)
      : DEFAULT_FIXTURE_PATH;
    const raw = readFileSync(fixturePath, 'utf8');
    const parsed = JSON.parse(raw) as JsonBodyType;
    return HttpResponse.json(parsed, { headers: DEFAULT_HEADERS });
  });

  const server = setupServer(handler);

  return {
    server,
    getHitCount: () => hitCount,
    resetHitCount: () => {
      hitCount = 0;
      lastRequestUrl = null;
    },
    setNextResponse: (body, status = 200, headers) => {
      nextResponse = { body: body as JsonBodyType, status, headers };
    },
    getLastRequestUrl: () => lastRequestUrl,
  };
}
