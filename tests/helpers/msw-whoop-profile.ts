// MSW helper for the WHOOP `/v2/user/profile/basic` endpoint. Sibling to
// `msw-whoop-cycles.ts`; same shape, different endpoint + fixtures dir.
// The profile endpoint returns a single record (NOT wrapped in
// `{records, next_token}`) per A4 — fixtures and the schema both reflect
// that. See `msw-whoop-cycles.ts` for the full rationale.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { type HttpHandler, HttpResponse, http, type JsonBodyType } from 'msw';
import { type SetupServer, setupServer } from 'msw/node';

export const PROFILE_URL = 'https://api.prod.whoop.com/v2/user/profile/basic';

const FIXTURES_DIR = join(process.cwd(), 'tests', 'fixtures', 'whoop', 'profile');
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

export interface WhoopProfileHelper {
  server: SetupServer;
  getHitCount(): number;
  resetHitCount(): void;
  setNextResponse(body: unknown, status?: number, headers?: Record<string, string>): void;
  getLastRequestUrl(): URL | null;
}

export function createWhoopProfileHelper(): WhoopProfileHelper {
  let hitCount = 0;
  let nextResponse: NextResponse | null = null;
  let lastRequestUrl: URL | null = null;

  const handler: HttpHandler = http.get(PROFILE_URL, ({ request }) => {
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
