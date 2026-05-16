// Combined MSW server for sync integration tests. Bundles all 6 WHOOP v2
// resource endpoints into ONE `setupServer` instance — multiple
// `setupServer` instances in one process clobber each other because they
// share the underlying Node-level request interceptor. The existing
// per-resource helpers under `tests/helpers/msw-whoop-*.ts` are designed
// for unit/contract tests that touch a single endpoint at a time; the
// integration suite needs every endpoint live simultaneously.
//
// Each handler defaults to loading `tests/fixtures/whoop/<resource>/200-ok.json`
// at request time. Tests override per-resource scenarios via the
// `nextResponses` map keyed by resource name (mirrors the per-helper
// `setNextResponse` semantics).
//
// Hit counters live in this module so partial-failure + idempotency tests
// can assert per-resource fetch counts without scraping the request log.
//
// No direct stdout / no console — test helper under tests/ scope (Gate B
// exempt; constraint held as defense in depth).

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { type HttpHandler, HttpResponse, http, type JsonBodyType } from 'msw';
import { type SetupServer, setupServer } from 'msw/node';

const FIXTURES_BASE = join(process.cwd(), 'tests', 'fixtures', 'whoop');

const URLS = {
  cycles: 'https://api.prod.whoop.com/v2/cycle',
  recoveries: 'https://api.prod.whoop.com/v2/recovery',
  sleeps: 'https://api.prod.whoop.com/v2/activity/sleep',
  workouts: 'https://api.prod.whoop.com/v2/activity/workout',
  profile: 'https://api.prod.whoop.com/v2/user/profile/basic',
  body_measurements: 'https://api.prod.whoop.com/v2/user/measurement/body',
} as const;

const FIXTURE_SUBDIR = {
  cycles: 'cycles',
  recoveries: 'recovery',
  sleeps: 'sleep',
  workouts: 'workouts',
  profile: 'profile',
  body_measurements: 'body-measurements',
} as const;

export type ResourceKey = keyof typeof URLS;

const DEFAULT_HEADERS: Readonly<Record<string, string>> = {
  'X-RateLimit-Remaining': '95',
  'X-RateLimit-Reset': '60',
  'X-RateLimit-Limit': 'requests=100, window=60',
};

export interface NextResponse {
  body: JsonBodyType;
  status: number;
  headers?: Record<string, string> | undefined;
}

export interface AllResourcesMswHelper {
  server: SetupServer;
  getHitCount(resource: ResourceKey): number;
  resetHitCounts(): void;
  /** Override the next response for a specific resource. Queue depth = 1 per
   *  resource — after the override fires once it reverts to the default
   *  fixture-backed response. */
  setNextResponse(
    resource: ResourceKey,
    body: unknown,
    status?: number,
    headers?: Record<string, string>,
  ): void;
  /** Load a named fixture (e.g., '200-dst-spring-forward') as the next
   *  response for the given resource. Saves the readFileSync boilerplate
   *  at every test site. */
  setNextFixture(resource: ResourceKey, fixtureName: string): void;
}

function loadFixture(resource: ResourceKey, name: string): JsonBodyType {
  const path = join(FIXTURES_BASE, FIXTURE_SUBDIR[resource], `${name}.json`);
  const raw = readFileSync(path, 'utf8');
  return JSON.parse(raw) as JsonBodyType;
}

export function createAllResourcesMsw(): AllResourcesMswHelper {
  const hits: Record<ResourceKey, number> = {
    cycles: 0,
    recoveries: 0,
    sleeps: 0,
    workouts: 0,
    profile: 0,
    body_measurements: 0,
  };
  const nextResponses: Partial<Record<ResourceKey, NextResponse>> = {};

  function makeHandler(resource: ResourceKey): HttpHandler {
    return http.get(URLS[resource], () => {
      hits[resource] += 1;
      const queued = nextResponses[resource];
      if (queued !== undefined) {
        delete nextResponses[resource];
        return HttpResponse.json(queued.body, {
          status: queued.status,
          headers: { ...DEFAULT_HEADERS, ...(queued.headers ?? {}) },
        });
      }
      // Default arm: load `200-ok.json` from the resource's fixtures dir.
      const body = loadFixture(resource, '200-ok');
      return HttpResponse.json(body, { headers: DEFAULT_HEADERS });
    });
  }

  const handlers: HttpHandler[] = [
    makeHandler('cycles'),
    makeHandler('recoveries'),
    makeHandler('sleeps'),
    makeHandler('workouts'),
    makeHandler('profile'),
    makeHandler('body_measurements'),
  ];

  const server = setupServer(...handlers);

  return {
    server,
    getHitCount: (resource) => hits[resource],
    resetHitCounts: () => {
      for (const key of Object.keys(hits) as ResourceKey[]) {
        hits[key] = 0;
      }
      // Also clear pending overrides — every beforeEach should start clean.
      for (const key of Object.keys(nextResponses) as ResourceKey[]) {
        delete nextResponses[key];
      }
    },
    setNextResponse: (resource, body, status = 200, headers) => {
      nextResponses[resource] = { body: body as JsonBodyType, status, headers };
    },
    setNextFixture: (resource, fixtureName) => {
      nextResponses[resource] = {
        body: loadFixture(resource, fixtureName),
        status: 200,
      };
    },
  };
}
