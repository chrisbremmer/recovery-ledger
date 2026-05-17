// Contract test for the profile resource path (SYNC-07 anchor).
//
// Single-shot resource (A4 — no pagination, no since/until). Drives:
// MSW intercepts → getProfile() → normalizeProfile → profileRepo.upsert →
// profileRepo.getCurrent. ON CONFLICT(user_id) DO UPDATE per D-11 keeps
// the row count at 1 across repeated syncs.
//
// ADR-0006: onUnhandledRequest:'error' on MSW.

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';
import { createInMemoryDb, type InMemoryDbResult } from '../helpers/in-memory-db.js';
import { createWhoopProfileHelper, type WhoopProfileHelper } from '../helpers/msw-whoop-profile.js';

vi.mock('../../src/services/refresh-orchestrator.js', () => ({
  callWithAuth: (op: (token: string) => Promise<unknown>) => op('test-token-123'),
}));

const { getProfile } = await import('../../src/infrastructure/whoop/resources/profile.js');
const { createProfileRepo } = await import(
  '../../src/infrastructure/db/repositories/profile.repo.js'
);
const { _resetForTest: resetRateLimit } = await import(
  '../../src/infrastructure/whoop/rate-limit.js'
);

vi.setConfig({ testTimeout: 5_000 });

const FIXTURE_USER_ID = 100001;
const CLOCK = new Date('2026-05-15T12:00:00.000Z');

let helper: WhoopProfileHelper;
let mem: InMemoryDbResult;

beforeAll(() => {
  helper = createWhoopProfileHelper();
  helper.server.listen({ onUnhandledRequest: 'error' });
});

afterAll(() => {
  helper.server.close();
});

beforeEach(() => {
  resetRateLimit();
  helper.resetHitCount();
  helper.server.resetHandlers();
  mem = createInMemoryDb();
});

afterEach(() => {
  mem.close();
});

describe('profile contract — happy path', () => {
  test('Test 1: getProfile() returns the Profile entity with fixture-shaped fields', async () => {
    const { entity: profile } = await getProfile();
    expect(profile.userId).toBe(FIXTURE_USER_ID);
    expect(profile.email).toBe('chris@example.com');
    expect(profile.firstName).toBe('Chris');
    expect(profile.lastName).toBe('Bremmer');
    expect(typeof profile.fetchedAt).toBe('string');
  });

  test('Test 2: profileRepo.upsert + getCurrent round-trips the entity', async () => {
    const { entity: profile } = await getProfile();
    const repo = createProfileRepo(mem.db);
    repo.upsert(
      {
        userId: profile.userId,
        email: profile.email,
        firstName: profile.firstName,
        lastName: profile.lastName,
        rawJson: '{"user_id":100001}',
      },
      { clock: CLOCK },
    );

    const current = repo.getCurrent();
    expect(current).not.toBeNull();
    expect(current?.userId).toBe(FIXTURE_USER_ID);
    expect(current?.email).toBe('chris@example.com');
    expect(current?.fetchedAt).toBe(CLOCK.toISOString());
  });

  test('Test 2b: getProfile() raw payload is the snake_case wire format (D-29 diagnostic seam)', async () => {
    const { raw } = await getProfile();
    // Raw payload exposes WHOOP wire-shape fields (snake_case) — replaying
    // it through WhoopRawProfile.parse() must succeed.
    expect(raw.user_id).toBe(FIXTURE_USER_ID);
    expect(typeof raw.email).toBe('string');
  });
});

describe('profile contract — idempotency (D-11 / SYNC-04)', () => {
  test('Test 3: getProfile + upsert twice leaves row count at 1 (ON CONFLICT(user_id) DO UPDATE)', async () => {
    const repo = createProfileRepo(mem.db);
    const { entity: first } = await getProfile();
    repo.upsert(
      {
        userId: first.userId,
        email: first.email,
        firstName: first.firstName,
        lastName: first.lastName,
        rawJson: '{"user_id":100001}',
      },
      { clock: CLOCK },
    );
    const { entity: second } = await getProfile();
    repo.upsert(
      {
        userId: second.userId,
        email: second.email,
        firstName: second.firstName,
        lastName: second.lastName,
        rawJson: '{"user_id":100001,"updated":true}',
      },
      { clock: CLOCK },
    );

    const count = (mem.sqlite.prepare('SELECT COUNT(*) AS c FROM profile').get() as { c: number })
      .c;
    expect(count).toBe(1);
    expect(helper.getHitCount()).toBe(2);
  });
});

describe('profile contract — getRawJson diagnostic seam (D-29)', () => {
  test('Test 4: getRawJson(userId) returns the stored raw_json payload', async () => {
    const { entity: profile } = await getProfile();
    const repo = createProfileRepo(mem.db);
    const fixturePayload = '{"user_id":100001,"email":"chris@example.com"}';
    repo.upsert(
      {
        userId: profile.userId,
        email: profile.email,
        firstName: profile.firstName,
        lastName: profile.lastName,
        rawJson: fixturePayload,
      },
      { clock: CLOCK },
    );
    expect(repo.getRawJson(FIXTURE_USER_ID)).toBe(fixturePayload);
  });
});
