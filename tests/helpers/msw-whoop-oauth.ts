// Shared MSW WHOOP token-endpoint helper (D-23.1 + RESEARCH §Test-Mechanism
// Recipes lines 962-994). One handler file per WHOOP resource (conventions.md
// §Testing). Each test that needs the token endpoint imports
// `createWhoopOauthHelper()` and runs its own `server.listen()` /
// `server.close()` lifecycle — the helper is not a global setup, so a test
// file can decide whether the per-call counter resets per test, per file, or
// per suite.
//
// `WHOOP_TOKEN_URL` is the SINGLE source of truth for the token-endpoint URL
// across the entire phase. token-store.ts (Plan 02-02) and oauth.ts (Plan
// 02-03) will import the same constant. A future test cannot accidentally
// point MSW at a different host because the helper is the only place the
// URL is spelled (T-02.01-04 mitigation).
//
// No `console.*` and no `process.stdout.write` — this file lives under
// `tests/` which Gate B's exemption covers, but the constraint is held
// anyway as defense in depth.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { http, HttpResponse, type HttpHandler } from 'msw';
import { setupServer, type SetupServer } from 'msw/node';

export const WHOOP_TOKEN_URL = 'https://api.prod.whoop.com/oauth/oauth2/token';

const TOKEN_200_FIXTURE_PATH = join(
  process.cwd(),
  'test',
  'fixtures',
  'oauth',
  'token-200.json',
);

interface NextResponse {
  body: unknown;
  status: number;
}

export interface WhoopOauthHelper {
  server: SetupServer;
  getRefreshHitCount(): number;
  resetRefreshHitCount(): void;
  /**
   * Override the next single response from the token endpoint. After the
   * one-shot fires, the handler reverts to the default fixture-backed
   * response. Useful for the invalid_grant / 400 arm in oauth.test.ts and
   * token-store.test.ts.
   */
  setNextResponse(body: object, status?: number): void;
}

export function createWhoopOauthHelper(): WhoopOauthHelper {
  let hitCount = 0;
  let nextResponse: NextResponse | null = null;

  const handler: HttpHandler = http.post(WHOOP_TOKEN_URL, () => {
    hitCount += 1;
    if (nextResponse !== null) {
      const { body, status } = nextResponse;
      nextResponse = null;
      return HttpResponse.json(body, { status });
    }
    // Default arm: return the committed token-200 fixture verbatim. Reading
    // it at handler-invocation time (not at module load) means a test that
    // edits the fixture mid-run will see the updated bytes — this is the
    // same pattern Phase 1's doctor fixtures use.
    const raw = readFileSync(TOKEN_200_FIXTURE_PATH, 'utf8');
    const parsed = JSON.parse(raw) as unknown;
    return HttpResponse.json(parsed);
  });

  const server = setupServer(handler);

  return {
    server,
    getRefreshHitCount: () => hitCount,
    resetRefreshHitCount: () => {
      hitCount = 0;
    },
    setNextResponse: (body, status = 200) => {
      nextResponse = { body, status };
    },
  };
}
