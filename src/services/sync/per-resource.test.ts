// Per-resource sync outcome classification tests (Review #15).
//
// Plan 03-11 D-25: `classifyOutcome` maps a thrown error to a structured
// `ResourceSyncOutcome`. The happy-path catch arms (AuthError →
// failed_auth, WhoopApiError → kind-specific, SqliteError → failed_db,
// ZodError/TypeError → failed_parse) were previously implicit; this test
// pins them so a future error-class refactor doesn't silently re-route
// an error class into the wrong outcome bucket.

import { describe, expect, it } from 'vitest';
import { ZodError } from 'zod';
import { AuthError, WhoopApiError } from '../../infrastructure/whoop/errors.js';
import { classifyOutcome, computeStatus } from './per-resource.js';

describe('classifyOutcome', () => {
  it('AuthError → {status: failed_auth, errors: 1}', () => {
    const err = new AuthError({ kind: 'auth_expired' });
    expect(classifyOutcome(err)).toEqual({ status: 'failed_auth', errors: 1 });
  });

  it('WhoopApiError(kind=unauthorized) defensively maps to failed_auth', () => {
    const err = new WhoopApiError({ kind: 'unauthorized' });
    expect(classifyOutcome(err)).toEqual({ status: 'failed_auth', errors: 1 });
  });

  it('WhoopApiError(kind=rate_limited) → partial_429', () => {
    const err = new WhoopApiError({ kind: 'rate_limited' });
    expect(classifyOutcome(err)).toEqual({ status: 'partial_429', errors: 1 });
  });

  it('WhoopApiError(kind=server) → partial_5xx', () => {
    const err = new WhoopApiError({ kind: 'server' });
    expect(classifyOutcome(err)).toEqual({ status: 'partial_5xx', errors: 1 });
  });

  it('WhoopApiError(kind=validation) → partial_5xx (treated like a server bug)', () => {
    const err = new WhoopApiError({ kind: 'validation', detail: 'bad wire shape' });
    expect(classifyOutcome(err)).toEqual({ status: 'partial_5xx', errors: 1 });
  });

  it('WhoopApiError(kind=network) → failed_network', () => {
    const err = new WhoopApiError({ kind: 'network' });
    expect(classifyOutcome(err)).toEqual({ status: 'failed_network', errors: 1 });
  });

  it('WhoopApiError(kind=unknown) → failed_network (defensive bucket)', () => {
    const err = new WhoopApiError({ kind: 'unknown' });
    expect(classifyOutcome(err)).toEqual({ status: 'failed_network', errors: 1 });
  });

  it('SqliteError-shaped error (code starts with SQLITE_) → failed_db', () => {
    const err = new Error('database is locked');
    (err as Error & { code?: string }).code = 'SQLITE_BUSY';
    expect(classifyOutcome(err)).toEqual({ status: 'failed_db', errors: 1 });
  });

  it('ZodError → failed_parse', () => {
    const err = new ZodError([]);
    expect(classifyOutcome(err)).toEqual({ status: 'failed_parse', errors: 1 });
  });

  it('TypeError → failed_parse', () => {
    const err = new TypeError('cannot read property of undefined');
    expect(classifyOutcome(err)).toEqual({ status: 'failed_parse', errors: 1 });
  });

  it('plain Error → failed_unknown (catch-all)', () => {
    const err = new Error('boom');
    expect(classifyOutcome(err)).toEqual({ status: 'failed_unknown', errors: 1 });
  });

  it('non-Error throw (string) → failed_unknown (catch-all)', () => {
    expect(classifyOutcome('something bad happened')).toEqual({
      status: 'failed_unknown',
      errors: 1,
    });
  });
});

describe('computeStatus', () => {
  it('every requested resource success → ok', () => {
    const status = computeStatus(
      {
        cycles: { status: 'success', errors: 0 },
        recoveries: { status: 'success', errors: 0 },
        sleeps: { status: 'success', errors: 0 },
        workouts: { status: 'success', errors: 0 },
        profile: { status: 'success', errors: 0 },
        body_measurements: { status: 'success', errors: 0 },
      },
      ['cycles', 'recoveries'],
    );
    expect(status).toBe('ok');
  });

  it('one success + one failure → partial', () => {
    const status = computeStatus(
      {
        cycles: { status: 'success', errors: 0 },
        recoveries: { status: 'failed_network', errors: 1 },
        sleeps: { status: 'success', errors: 0 },
        workouts: { status: 'success', errors: 0 },
        profile: { status: 'success', errors: 0 },
        body_measurements: { status: 'success', errors: 0 },
      },
      ['cycles', 'recoveries'],
    );
    expect(status).toBe('partial');
  });

  it('every requested resource failed → failed', () => {
    const status = computeStatus(
      {
        cycles: { status: 'failed_network', errors: 1 },
        recoveries: { status: 'failed_auth', errors: 1 },
        sleeps: { status: 'success', errors: 0 },
        workouts: { status: 'success', errors: 0 },
        profile: { status: 'success', errors: 0 },
        body_measurements: { status: 'success', errors: 0 },
      },
      ['cycles', 'recoveries'],
    );
    expect(status).toBe('failed');
  });

  it('Review #15: missing outcome for a requested resource defensively flips to failed', () => {
    const status = computeStatus(
      {
        cycles: { status: 'success', errors: 0 },
        recoveries: { status: 'success', errors: 0 },
        sleeps: { status: 'success', errors: 0 },
        workouts: { status: 'success', errors: 0 },
        profile: { status: 'success', errors: 0 },
        body_measurements: { status: 'success', errors: 0 },
        // intentionally NOT recording `decisions` outcome
      } as unknown as Parameters<typeof computeStatus>[0],
      ['cycles', 'decisions' as Parameters<typeof computeStatus>[1][number]],
    );
    expect(status).toBe('partial');
  });
});
