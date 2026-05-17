// Plan 03-12 Task 2 sync.txt.ts unit tests — 10 assertions per the plan
// acceptance criteria. Pure-function tests; no fs / no DB / no fixtures
// loaded from disk. Test 7 iterates the full ADR-0005 banned-tone-word
// list as a runtime guard layered ON TOP of the source-file Gate A grep.

import { describe, expect, test } from 'vitest';
import type { RunSyncResult } from '../domain/types/sync.js';
import { MigrationError } from '../infrastructure/db/migrate.js';
import { AuthError } from '../infrastructure/whoop/errors.js';
import { formatBootstrapError, formatSyncResult } from './sync.txt.js';

// Common fixture builder — every test starts from this and overlays the
// fields under assertion.
function makeResult(overrides: Partial<RunSyncResult> = {}): RunSyncResult {
  return {
    status: 'ok',
    perResource: {
      profile: { status: 'success', fetched: 1, upserted: 1, durationMs: 10 },
      body_measurements: { status: 'success', fetched: 1, upserted: 1, durationMs: 8 },
      cycles: { status: 'success', fetched: 42, upserted: 42, durationMs: 120 },
      recoveries: { status: 'success', fetched: 42, upserted: 42, durationMs: 180 },
      sleeps: { status: 'success', fetched: 14, upserted: 14, durationMs: 90 },
      workouts: { status: 'success', fetched: 10, upserted: 10, durationMs: 200 },
    },
    syncRunId: 17,
    gapsDetected: 0,
    ...overrides,
  };
}

describe('formatSyncResult', () => {
  test('Test 1: ok status — header + 6 resource lines + footer', () => {
    const output = formatSyncResult(makeResult());
    expect(output.startsWith('Status: ok\n')).toBe(true);
    // Six resource lines (one per RESOURCES entry).
    for (const r of [
      'profile',
      'body_measurements',
      'cycles',
      'recoveries',
      'sleeps',
      'workouts',
    ]) {
      expect(output).toContain(r);
    }
    expect(output).toContain('syncRunId: 17');
    expect(output).toContain('gapsDetected: 0');
  });

  test('Test 2: partial_429 line includes "(rate-limited; retried)" suffix', () => {
    const output = formatSyncResult(
      makeResult({
        status: 'partial',
        perResource: {
          profile: { status: 'success', fetched: 1, upserted: 1 },
          body_measurements: { status: 'success', fetched: 1, upserted: 1 },
          cycles: { status: 'success', fetched: 42, upserted: 42 },
          recoveries: { status: 'success', fetched: 42, upserted: 42 },
          sleeps: { status: 'success', fetched: 14, upserted: 14 },
          workouts: { status: 'partial_429', fetched: 10, upserted: 10 },
        },
      }),
    );
    expect(output).toContain('Status: partial');
    const workoutsLine = output.split('\n').find((l) => l.startsWith('workouts'));
    expect(workoutsLine).toBeDefined();
    expect(workoutsLine).toContain('partial_429');
    expect(workoutsLine).toContain('(rate-limited; retried)');
  });

  test('Test 3: failed status renders verbatim', () => {
    const output = formatSyncResult(
      makeResult({
        status: 'failed',
        perResource: {
          profile: { status: 'failed_auth' },
          body_measurements: { status: 'failed_auth' },
          cycles: { status: 'failed_auth' },
          recoveries: { status: 'failed_auth' },
          sleeps: { status: 'failed_auth' },
          workouts: { status: 'failed_auth' },
        },
      }),
    );
    expect(output).toContain('Status: failed');
    // failed_auth should surface the re-auth remediation hint.
    expect(output).toContain('recovery-ledger auth');
  });

  test('Test 4: omits dur= when durationMs is undefined', () => {
    const output = formatSyncResult(
      makeResult({
        perResource: {
          profile: { status: 'success', fetched: 1, upserted: 1 },
          body_measurements: { status: 'success', fetched: 1, upserted: 1 },
          cycles: { status: 'success', fetched: 1, upserted: 1 },
          recoveries: { status: 'success', fetched: 1, upserted: 1 },
          sleeps: { status: 'success', fetched: 1, upserted: 1 },
          workouts: { status: 'success', fetched: 1, upserted: 1 },
        },
      }),
    );
    expect(output.includes('dur=')).toBe(false);
  });

  test('Test 5: zero counts render fetched=0 upserted=0', () => {
    const output = formatSyncResult(
      makeResult({
        perResource: {
          profile: { status: 'success', fetched: 0, upserted: 0 },
          body_measurements: { status: 'success', fetched: 0, upserted: 0 },
          cycles: { status: 'success', fetched: 0, upserted: 0 },
          recoveries: { status: 'success', fetched: 0, upserted: 0 },
          sleeps: { status: 'success', fetched: 0, upserted: 0 },
          workouts: { status: 'success', fetched: 0, upserted: 0 },
        },
      }),
    );
    expect(output).toContain('fetched=0 upserted=0');
  });

  test('Test 6: alignment — body_measurements padded to 20; partial_429 padded to 15', () => {
    const output = formatSyncResult(
      makeResult({
        perResource: {
          profile: { status: 'success', fetched: 1, upserted: 1 },
          body_measurements: { status: 'success', fetched: 1, upserted: 1 },
          cycles: { status: 'success', fetched: 1, upserted: 1 },
          recoveries: { status: 'success', fetched: 1, upserted: 1 },
          sleeps: { status: 'success', fetched: 1, upserted: 1 },
          workouts: { status: 'partial_429', fetched: 10, upserted: 10 },
        },
      }),
    );
    // body_measurements (16 chars) + 4 padding spaces → "body_measurements   "
    const bmLine = output.split('\n').find((l) => l.startsWith('body_measurements'));
    expect(bmLine).toBeDefined();
    // The status column begins after the resource column (width 20).
    expect(bmLine?.slice(0, 20)).toBe('body_measurements   ');
    // partial_429 (11 chars) padded to 15 → "partial_429    " (4 trailing spaces).
    const wLine = output.split('\n').find((l) => l.startsWith('workouts'));
    expect(wLine).toBeDefined();
    expect(wLine?.slice(20, 35)).toBe('partial_429    ');
  });

  test('Test 7: ADR-0005 banned-tone-word check — every word absent', () => {
    // Use a result that exercises every resource + every status arm so the
    // suffix paths are all included in the rendered string. If a banned
    // word were ever to slip into statusSuffix(), this test catches it
    // before the source-file Gate A grep does.
    const output = formatSyncResult(
      makeResult({
        status: 'partial',
        perResource: {
          profile: { status: 'partial_5xx', fetched: 1, upserted: 0, errors: 1 },
          body_measurements: { status: 'failed_network' },
          cycles: { status: 'partial_429', fetched: 5, upserted: 5 },
          recoveries: { status: 'failed_auth' },
          sleeps: { status: 'skipped' },
          workouts: { status: 'success', fetched: 1, upserted: 1 },
        },
      }),
    );
    const banned = [
      'optimize',
      'wellness',
      'honor',
      'journey',
      'crush',
      'nail',
      'dial in',
      'tune',
      'vibe',
      'unlock',
    ];
    const lower = output.toLowerCase();
    for (const word of banned) {
      expect(lower.includes(word)).toBe(false);
    }
  });
});

describe('formatBootstrapError', () => {
  test('Test 8: MigrationError surfaces `cp <backupPath> <dbFile>` remediation per D-08', () => {
    const err = new MigrationError({
      kind: 'inconsistent_state',
      backupPath: '/home/chris/.recovery-ledger/backups/db.2026-05-16-pre-0001.sqlite',
      latestSafeMigration: '0000_initial',
    });
    const dbFile = '/home/chris/.recovery-ledger/db.sqlite';
    const output = formatBootstrapError(err, dbFile);
    expect(output).toContain('cp ');
    expect(output).toContain('/home/chris/.recovery-ledger/backups/db.2026-05-16-pre-0001.sqlite');
    expect(output).toContain('/home/chris/.recovery-ledger/db.sqlite');
    // No auto-restore — surface the "does not auto-restore" stance so
    // the user understands the contract.
    expect(output.toLowerCase()).toContain('does not auto-restore');
  });

  test('Test 9: AuthError defers to formatAuthError prose', () => {
    const err = new AuthError({ kind: 'auth_expired' });
    const output = formatBootstrapError(err, '/dev/null');
    expect(output).toContain('Bootstrap failed');
    // formatAuthError(auth_expired) returns "WHOOP tokens have expired —
    // run `recovery-ledger auth` to re-authorize."
    expect(output).toContain('recovery-ledger auth');
  });
});

describe('formatSyncResult purity', () => {
  test('Test 10: identical input → identical output (no internal state)', () => {
    const input = makeResult();
    const a = formatSyncResult(input);
    const b = formatSyncResult(input);
    expect(a).toBe(b);
  });
});
