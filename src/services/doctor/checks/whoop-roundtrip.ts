// `whoop_roundtrip` doctor probe — the ONE online check (Plan 05-02).
//
// This is the D-22 deferred check from Phase 2: "your WHOOP credentials work
// and the API responds." It performs a single GET /v2/user/profile/basic
// (ADR-0007 read-only) routed through the Phase 2 callWithAuth orchestrator
// (ADR-0002 single-flight chokepoint), so a stale token triggers exactly one
// refresh through the three-layer gate. A revoked scope surfaces as a
// non-401 4xx warning.
//
// Per D-03 the probe honors --offline by short-circuiting to a pass with a
// 'skipped (--offline)' detail WITHOUT invoking the fetcher — every other
// doctor check is offline-safe, so this is the only one that needs gating.
//
// ADR-0001 (CLAUDE.md §Critical Rules): no console calls, no direct stdout
// writes from this module. The probe returns a structured DoctorCheck and
// nothing else. SECH-02 (#79): the catch-arm detail string is now wrapped
// in sanitize() here because CLI doctor's outer catch serializes the detail
// directly to stdout via renderDoctor/JSON.stringify — the MCP path keeps
// double-sanitizing (idempotent, locked by sanitize.test.ts).
//
// SECH-02 (#79): sanitize wrapper at the catch arm.
import { sanitize } from '../../../infrastructure/observability/sanitize.js';
import type { RefreshOrchestrator } from '../../refresh-orchestrator.js';
import type { DoctorCheck } from '../index.js';
import { CHECK_NAMES } from './check-names.js';

/**
 * Dependency-injection seam for the roundtrip probe.
 *
 * Production wiring (Plan 05-06's runDoctor extension) constructs `fetcher`
 * to call `httpGet('/v2/user/profile/basic', {}, WhoopRawProfile)` wrapped in
 * `performance.now()` start/end timing, and supplies the production
 * `refreshOrchestrator` singleton. The unit test injects a deterministic
 * mock fetcher + a mock orchestrator, which keeps the test pure (no httpGet,
 * no MSW) per ADR-0006 — the probe never imports infrastructure directly.
 */
export interface WhoopRoundtripDeps {
  refreshOrchestrator: RefreshOrchestrator;
  fetcher: (accessToken: string) => Promise<{ status: number; durationMs: number }>;
}

export async function probeWhoopRoundtrip(
  deps: WhoopRoundtripDeps,
  opts?: { offline?: boolean },
): Promise<DoctorCheck> {
  if (opts?.offline === true) {
    return {
      name: CHECK_NAMES.WHOOP_ROUNDTRIP,
      status: 'pass',
      detail: 'skipped (--offline)',
    };
  }

  try {
    const result = await deps.refreshOrchestrator.callWithAuth(deps.fetcher);

    if (result.status === 200) {
      return {
        name: CHECK_NAMES.WHOOP_ROUNDTRIP,
        status: 'pass',
        detail: `profile fetched in ${Math.round(result.durationMs)}ms`,
      };
    }

    if (result.status === 401) {
      return {
        name: CHECK_NAMES.WHOOP_ROUNDTRIP,
        status: 'fail',
        detail: 'WHOOP returned 401 after refresh — run `recovery-ledger auth`',
      };
    }

    return {
      name: CHECK_NAMES.WHOOP_ROUNDTRIP,
      status: 'warn',
      detail: `WHOOP returned ${result.status} — scopes may have drifted; check developer.whoop.com/dashboard/applications`,
    };
  } catch (err) {
    return {
      name: CHECK_NAMES.WHOOP_ROUNDTRIP,
      status: 'fail',
      detail: `roundtrip failed: ${sanitize(err instanceof Error ? err.message : String(err))}`,
    };
  }
}
