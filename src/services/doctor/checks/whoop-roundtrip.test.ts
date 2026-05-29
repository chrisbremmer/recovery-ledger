// Unit coverage for the `whoop_roundtrip` doctor probe (Plan 05-02).
//
// The ONE online doctor check. Per ADR-0006 / Gate F the test injects a mock
// fetcher + a mock RefreshOrchestrator and makes ZERO real HTTP calls — no
// MSW handlers are needed because the probe never exercises httpGet (that
// wiring lands in Plan 05-06's runDoctor extension). The five cases pin the
// five documented status arms: --offline short-circuit, 200 pass with
// timing, 401 fail with auth hint, non-401 4xx warn, and network-error fail.

import { describe, expect, it } from 'vitest';
import { WhoopApiError } from '../../../infrastructure/whoop/errors.js';
import type { RefreshOrchestrator } from '../../refresh-orchestrator.js';
import { CHECK_NAMES } from './check-names.js';
import type { WhoopRoundtripDeps } from './whoop-roundtrip.js';
import { probeWhoopRoundtrip } from './whoop-roundtrip.js';

// A mock orchestrator whose callWithAuth simply forwards to the operation
// (the probe's fetcher). The `as unknown as` cast is required because the
// real RefreshOrchestrator is generic over T extends FetchLikeResponse, and
// the test fetcher returns a plain `{status, durationMs}` object that is
// wider than FetchLikeResponse demands — the probe only reads `.status` and
// `.durationMs`, so the runtime contract is upheld.
function forwardingOrchestrator(): RefreshOrchestrator {
  return {
    callWithAuth: async (operation: (accessToken: string) => Promise<unknown>) =>
      operation('fake-access-token'),
  } as unknown as RefreshOrchestrator;
}

// A mock orchestrator whose callWithAuth rejects, simulating a refresh /
// network failure that escapes the single-flight gate. Same cast rationale
// as forwardingOrchestrator above.
function rejectingOrchestrator(err: unknown): RefreshOrchestrator {
  return {
    callWithAuth: async () => {
      throw err;
    },
  } as unknown as RefreshOrchestrator;
}

describe('probeWhoopRoundtrip', () => {
  it('returns pass with skipped detail when offline=true', async () => {
    const deps: WhoopRoundtripDeps = {
      // Both seams reject so the test fails loudly if the probe invokes them
      // instead of short-circuiting on the --offline flag.
      refreshOrchestrator: rejectingOrchestrator(new Error('should not be called')),
      fetcher: () => Promise.reject(new Error('should not be called')),
    };
    const check = await probeWhoopRoundtrip(deps, { offline: true });
    expect(check.name).toBe(CHECK_NAMES.WHOOP_ROUNDTRIP);
    expect(check.status).toBe('pass');
    expect(check.detail).toBe('skipped (--offline)');
  });

  it('returns pass with timing detail on 200', async () => {
    const deps: WhoopRoundtripDeps = {
      refreshOrchestrator: forwardingOrchestrator(),
      fetcher: async () => ({ status: 200, durationMs: 45.7 }),
    };
    const check = await probeWhoopRoundtrip(deps);
    expect(check.name).toBe(CHECK_NAMES.WHOOP_ROUNDTRIP);
    expect(check.status).toBe('pass');
    // Math.round(45.7) === 46
    expect(check.detail).toBe('profile fetched in 46ms');
  });

  it('returns fail with auth hint on 401', async () => {
    const deps: WhoopRoundtripDeps = {
      refreshOrchestrator: forwardingOrchestrator(),
      fetcher: async () => ({ status: 401, durationMs: 30 }),
    };
    const check = await probeWhoopRoundtrip(deps);
    expect(check.name).toBe(CHECK_NAMES.WHOOP_ROUNDTRIP);
    expect(check.status).toBe('fail');
    expect(check.detail).toContain('recovery-ledger auth');
  });

  it('returns warn on non-401 4xx', async () => {
    const deps: WhoopRoundtripDeps = {
      refreshOrchestrator: forwardingOrchestrator(),
      fetcher: async () => ({ status: 403, durationMs: 25 }),
    };
    const check = await probeWhoopRoundtrip(deps);
    expect(check.name).toBe(CHECK_NAMES.WHOOP_ROUNDTRIP);
    expect(check.status).toBe('warn');
    expect(check.detail).toContain('WHOOP returned 403');
    expect(check.detail).toContain('developer.whoop.com/dashboard/applications');
  });

  it('returns fail when callWithAuth throws', async () => {
    // WhoopApiError constructor takes a single WhoopApiErrorInit object
    // ({ kind, detail?, cause? }) — verified against
    // src/infrastructure/whoop/errors.ts. The plan's illustrative
    // {status, message} signature does not match the actual class, so the
    // fixture is adapted: kind 'network' + a detail that becomes err.message.
    const err = new WhoopApiError({ kind: 'network', detail: 'fetch failed' });
    const deps: WhoopRoundtripDeps = {
      refreshOrchestrator: rejectingOrchestrator(err),
      fetcher: async () => ({ status: 200, durationMs: 1 }),
    };
    const check = await probeWhoopRoundtrip(deps);
    expect(check.name).toBe(CHECK_NAMES.WHOOP_ROUNDTRIP);
    expect(check.status).toBe('fail');
    expect(check.detail).toMatch(/^roundtrip failed:/);
    expect(check.detail).toContain('fetch failed');
  });
});
