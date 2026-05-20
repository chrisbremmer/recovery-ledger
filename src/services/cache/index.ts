// `whoop_query_cache` orchestrator — D-24 typed-discriminated-union dispatch
// over the 8 Phase 3 + Plan 04-06 tables (cycles, recoveries, sleeps,
// workouts, profile, body_measurements, sync_runs, decisions). The MCP tool
// (Wave 4 Plan 04-10) and the CLI `query` command (Wave 4 Plan 04-11) both
// call this function unchanged; the Zod input schema at the MCP boundary
// mirrors `QueryCacheInput` verbatim so untrusted callers cannot widen the
// contract.
//
// T-04-S4 (Plan 04-02 threat register) — Information Disclosure:
//  (a) The typed-union refuses free-form SQL at the type system; an
//      untrusted MCP payload that doesn't narrow into one of the 8 arms
//      fails at the Zod boundary before reaching this function.
//  (b) Per-arm dispatch maps each resource to its own repository method;
//      the dispatch table is fixed, so adding a 9th arm to QueryCacheInput
//      forces a compile error here (exhaustive switch).
//  (c) `limit` is clamped at 500 to keep an untrusted MCP request from
//      egressing an unbounded slice. Truncation is observable to the
//      caller via `truncated: true`.
//
// D-24 carry-forward of Phase 3 D-04 / D-16 (SCORED-only default + DST-
// exclusion default): `includeUnscored` and `includeExcluded` are explicit
// opt-ins per resource arm. The defaults (false) propagate through the
// repo `byRange` calls unchanged from Phase 3. ADR-0003 discipline holds:
// PENDING_SCORE / UNSCORABLE rows are NOT silently consumed as zeros —
// they are returned as discriminated-union variants only when the caller
// explicitly opts in (Pitfall 7).
//
// ADR-0001 (MCP stdout purity): no console.*; no process.stdout.write.
// Pino logger threads through `deps.logger`; the payload carries
// {event, resource, count, truncated} — NEVER decision text, NEVER any
// PII (Pitfall 17). The decisions arm logs the count + truncated flag,
// not the individual rows.
//
// Limit semantics (D-24 §last paragraph + Pitfall 7):
//   - Caller supplies no limit → 100.
//   - Caller supplies limit ≤ 0 → 100 (defensive treat-as-default).
//   - Caller supplies 1 ≤ limit ≤ 500 → use as-is.
//   - Caller supplies limit > 500 → clamp to 500.
// Truncation detection: read `effectiveLimit + 1` rows from the repo, then
// slice to `effectiveLimit`. If the read returned more than `effectiveLimit`
// rows, set `truncated: true` and `count = effectiveLimit + 1`. Otherwise
// `count = rows.length` and `truncated: false`. The +1 read trick keeps
// the cap honest without a second COUNT(*) round-trip.

import type { Logger } from 'pino';
import type { BodyMeasurementsRepo } from '../../infrastructure/db/repositories/body-measurements.repo.js';
import type { CyclesRepo } from '../../infrastructure/db/repositories/cycles.repo.js';
import type { DecisionsRepo } from '../../infrastructure/db/repositories/decisions.repo.js';
import type { ProfileRepo } from '../../infrastructure/db/repositories/profile.repo.js';
import type { RecoveryRepo } from '../../infrastructure/db/repositories/recovery.repo.js';
import type { SleepsRepo } from '../../infrastructure/db/repositories/sleep.repo.js';
import type { SyncRunsRepo } from '../../infrastructure/db/repositories/sync-runs.repo.js';
import type { WorkoutsRepo } from '../../infrastructure/db/repositories/workouts.repo.js';
import type { QueryCacheInput, QueryCacheResult } from './types.js';

// ----------------------------------------------------------------------------
// Wide bounds for unbounded range queries. The repo `byRange` methods take
// an inclusive [start, end] ISO range; queryCache supplies these defaults
// when the caller omits `since` / `until` (D-24 — empty filter means
// "everything in the cache").
// ----------------------------------------------------------------------------
const MIN_ISO = '0000-01-01T00:00:00.000Z';
const MAX_ISO = '9999-12-31T23:59:59.999Z';

const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 500;

export interface QueryCacheDeps {
  repos: {
    cycles: CyclesRepo;
    recoveries: RecoveryRepo;
    sleeps: SleepsRepo;
    workouts: WorkoutsRepo;
    profile: ProfileRepo;
    bodyMeasurements: BodyMeasurementsRepo;
    syncRuns: SyncRunsRepo;
    decisions: DecisionsRepo;
  };
  logger: Logger;
}

/** Clamp the requested limit to [1, 500]; treat invalid / undefined input as
 *  the D-24 default (100). The clamp is silent — callers detect that they
 *  hit the cap via `result.truncated === true` (which is set by the
 *  +1-read trick below, not by the clamp itself). */
function clampLimit(raw: number | undefined): number {
  if (raw === undefined || !Number.isFinite(raw) || raw <= 0) return DEFAULT_LIMIT;
  return Math.min(Math.floor(raw), MAX_LIMIT);
}

/** Truncation detection (Review #38): most arms read `limit + 1` rows
 *  from the repo; `applyTruncation` slices to `limit` and sets `truncated`
 *  accordingly. When truncation fires, `count` is set to `limit + 1` as a
 *  sentinel — it is NOT the total dataset size. Callers wanting the true
 *  count must over-read with a separate query or run a COUNT. The +1-read
 *  trick keeps the cap honest without a second round-trip. */
function applyTruncation<T>(
  rows: readonly T[],
  limit: number,
): { rows: T[]; count: number; truncated: boolean } {
  if (rows.length > limit) {
    return { rows: rows.slice(0, limit), count: limit + 1, truncated: true };
  }
  return { rows: rows.slice(), count: rows.length, truncated: false };
}

/**
 * Dispatch on `input.resource` (D-24 8-arm exhaustive switch — adding a
 * 9th arm to `QueryCacheInput` produces a compile-time error at the
 * `default: const _: never` site below).
 *
 * Pre-truncation read-ahead (`limit + 1`) per arm where a meaningful
 * caller-side limit applies (every arm except `profile`, which is
 * single-row). In-memory filters (sportId / category / recovery-score
 * range) run AFTER the repo read because the datasets are small at
 * personal-tool scale and a per-resource SQL-builder would inflate the
 * surface area without observable gain.
 */
export async function queryCache(
  input: QueryCacheInput,
  deps: QueryCacheDeps,
): Promise<QueryCacheResult> {
  const result = await dispatch(input, deps);
  deps.logger.info({
    event: 'query_cache',
    resource: result.resource,
    count: result.count,
    truncated: result.truncated,
  });
  return result;
}

async function dispatch(input: QueryCacheInput, deps: QueryCacheDeps): Promise<QueryCacheResult> {
  switch (input.resource) {
    case 'cycles': {
      const limit = clampLimit(input.limit);
      const rows = deps.repos.cycles.byRange(input.since ?? MIN_ISO, input.until ?? MAX_ISO, {
        includeUnscored: input.includeUnscored ?? false,
        includeExcluded: input.includeExcluded ?? false,
      });
      const truncated = applyTruncation(rows, limit);
      return { resource: 'cycles', ...truncated };
    }
    case 'recoveries': {
      const limit = clampLimit(input.limit);
      // Repo read uses the SCORED + non-excluded filter per Phase 3 D-04/D-16.
      const repoRows = deps.repos.recoveries.byRange(
        input.since ?? MIN_ISO,
        input.until ?? MAX_ISO,
        { includeUnscored: input.includeUnscored ?? false },
      );
      // In-memory per-score filter — recoveries datasets are small (one row
      // per cycle, capped by physical days the user has worn the strap).
      const filtered = repoRows.filter((r) => {
        if (r.scoreState !== 'SCORED') return true;
        if (input.minRecoveryScore !== undefined && r.recoveryScore < input.minRecoveryScore) {
          return false;
        }
        if (input.maxRecoveryScore !== undefined && r.recoveryScore > input.maxRecoveryScore) {
          return false;
        }
        return true;
      });
      const truncated = applyTruncation(filtered, limit);
      return { resource: 'recoveries', ...truncated };
    }
    case 'sleeps': {
      const limit = clampLimit(input.limit);
      const rows = deps.repos.sleeps.byRange(input.since ?? MIN_ISO, input.until ?? MAX_ISO, {
        includeUnscored: input.includeUnscored ?? false,
      });
      const truncated = applyTruncation(rows, limit);
      return { resource: 'sleeps', ...truncated };
    }
    case 'workouts': {
      const limit = clampLimit(input.limit);
      const repoRows = deps.repos.workouts.byRange(input.since ?? MIN_ISO, input.until ?? MAX_ISO, {
        includeUnscored: input.includeUnscored ?? false,
      });
      const filtered =
        input.sportId === undefined
          ? repoRows
          : repoRows.filter((w) => w.sportId === input.sportId);
      const truncated = applyTruncation(filtered, limit);
      return { resource: 'workouts', ...truncated };
    }
    case 'profile': {
      // Single-row table — wrap in 0/1 row array; limit not applicable.
      const row = deps.repos.profile.getCurrent();
      const rows = row === null ? [] : [row];
      return { resource: 'profile', rows, count: rows.length, truncated: false };
    }
    case 'body_measurements': {
      const limit = clampLimit(input.limit);
      // No SCORED filter here — body measurements are append-on-change history
      // (D-35) with no score_state column. Pass through to repo.byRange.
      // Slice to `limit + 1` so applyTruncation can detect spillover the same
      // way every other arm does (avoids a misleading count when the repo
      // returns far more than `limit + 1` rows).
      const rawRows = deps.repos.bodyMeasurements.byRange(input.since, input.until);
      const rows = rawRows.slice(0, limit + 1);
      const truncated = applyTruncation(rows, limit);
      return { resource: 'body_measurements', ...truncated };
    }
    case 'sync_runs': {
      const limit = clampLimit(input.limit);
      // Read `limit + 1` so applyTruncation can detect spillover (the repo
      // itself enforces the LIMIT — we widen by one to observe truncation).
      const rows = deps.repos.syncRuns.byStatus(input.status, input.since, limit + 1);
      const truncated = applyTruncation(rows, limit);
      return { resource: 'sync_runs', ...truncated };
    }
    case 'decisions': {
      const limit = clampLimit(input.limit);
      // Status dispatch: `'open'` reuses the existing listOpen() shortcut;
      // any other status (or undefined) reads listAll() and filters in
      // memory. Decisions arm is the only one where the repo already
      // surfaces a status-specific shortcut; everything else goes through
      // the generic listAll path.
      const repoRows =
        input.status === 'open' ? deps.repos.decisions.listOpen() : deps.repos.decisions.listAll();
      const filtered = repoRows.filter((d) => {
        if (input.status !== undefined && input.status !== 'open' && d.status !== input.status) {
          return false;
        }
        if (input.category !== undefined && d.category !== input.category) return false;
        return true;
      });
      const truncated = applyTruncation(filtered, limit);
      return { resource: 'decisions', ...truncated };
    }
    default: {
      // Exhaustive-switch forcing function — adding a 9th arm to
      // QueryCacheInput without extending dispatch above is a compile error
      // here (the `never` type forbids any assignment).
      const _: never = input;
      throw new Error(`queryCache: unreachable resource arm — ${String(_)}`);
    }
  }
}
