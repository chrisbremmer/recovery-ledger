// Doctor service composition (D-05 / D-06).
//
// `runDoctor()` runs the three Phase 1 checks in parallel and derives a single
// `overall` status: any `fail` wins; otherwise any `warn` wins; otherwise `pass`.
// Pure orchestration — no I/O of its own, no logger. The MCP tool shim and the
// CLI `doctor` command both consume `DoctorResult` verbatim.
//
// `deriveOverall` is exported so the unit suite can exercise the precedence
// rule with array literals (no native-module spawns, no subprocess driver).
// `runDoctor()` calls it internally.
//
// CR-01 + MR-14: `RunDoctorOptions.skipSubprocessChecks` is set by the
// `whoop_doctor` MCP tool handler so the subprocess stdout-purity probe
// does NOT recurse: outer MCP → whoop_doctor tool → runDoctor →
// probeMcpStdoutPurity → spawn dist/mcp.mjs → inner MCP → whoop_doctor
// tool → runDoctor → ... The flag terminates the chain at the first
// inner runDoctor invocation. The env-var fallback that previously also
// honored `RL_INSIDE_MCP=1` was removed (MR-14) — a stale env var in the
// user's shell would have silently skipped the subprocess check when
// they invoked `recovery-ledger doctor` from the CLI.
//
// Plan 05-06: extended from 5 to 14 probes. Phase 5 D-02 + Finding 2
// dependency ordering — load -> db -> auth -> online -> recency -> quality
// -> stress. The whoop_roundtrip probe degrades to 'skipped' when
// refreshOrchestrator / whoopFetcher deps are absent (createServices()
// lightweight path); production bootstrap() supplies both. The db_* and
// recency / scored-day / data-quality probes consume the injected sqlite
// handle + repos from bootstrap(); absent those deps they surface their
// "no handle injected" / "no repos injected" structured fail rather than
// silently green-checking.

import type Database from 'better-sqlite3';
import type { RefreshOrchestrator } from '../refresh-orchestrator.js';
import { probeAuth } from './checks/auth.js';
import { CHECK_NAMES } from './checks/check-names.js';
import { probeConcurrentWritersStress } from './checks/concurrent-writers-stress.js';
import { probeDataQualityCounts } from './checks/data-quality-counts.js';
import { probeDbIntegrity } from './checks/db-integrity.js';
import { probeDbOpen } from './checks/db-open.js';
import { probeDbSchemaVersion } from './checks/db-schema-version.js';
import { probeDbWalSize } from './checks/db-wal-size.js';
import { probeLastSyncRecency } from './checks/last-sync-recency.js';
import { probeMcpStdoutPurity } from './checks/mcp-stdout-purity.js';
import { probeMostRecentScoredDay } from './checks/most-recent-scored-day.js';
import { probeBetterSqlite3, probeKeyring } from './checks/native-modules.js';
import { probeTokenFreshness } from './checks/token-freshness.js';
import { probeWhoopRoundtrip } from './checks/whoop-roundtrip.js';

export interface DoctorCheck {
  name: string;
  /**
   * Three-status union. INTENTIONALLY CLOSED (MR-21): a future sub-status
   * (e.g., `skipped`, `unknown`, `degraded`) must be added to this type
   * AND to `DOCTOR_EXIT_CODES` in src/cli/commands/doctor.ts so the
   * shell-level contract stays in sync. The exhaustive switch in
   * `deriveOverall` will fail to compile if a new variant is added
   * without updating the precedence rule — that compile error is the
   * forcing function.
   */
  status: 'pass' | 'warn' | 'fail';
  detail: string;
}

export interface DoctorResult {
  checks: DoctorCheck[];
  /**
   * Three-status union. INTENTIONALLY CLOSED (MR-21): same extensibility
   * rule as `DoctorCheck.status`. The CLI exit-code map
   * (`DOCTOR_EXIT_CODES`) and the MR-22 --help block both rely on this
   * shape; a fourth status would need to land in all three places.
   */
  overall: 'pass' | 'warn' | 'fail';
}

export interface RunDoctorOptions {
  /**
   * Skip checks that spawn subprocesses (currently: mcp_stdout_purity).
   * Set by the MCP tool handler so a `whoop_doctor` invocation from inside
   * an MCP transport does not recursively respawn `dist/mcp.mjs`. The CLI
   * doctor command leaves this unset so the subprocess check still runs
   * end-to-end. See CR-01 in 01-REVIEW.md.
   */
  skipSubprocessChecks?: boolean;
  /**
   * Skip whoop_roundtrip (the only online check per D-03). Defaults to false.
   * Read by the whoop_roundtrip probe added in Plan 05-02..05-06; the
   * runDoctor() body is unchanged in Wave 0 so this field has no effect yet.
   */
  offline?: boolean;
  /**
   * Run concurrent_writers_stress (off by default per D-02 #9). Defaults to
   * false. Read by the concurrent_writers_stress probe in a later Wave 1
   * plan; the runDoctor() body is unchanged in Wave 0.
   */
  stress?: boolean;
  /**
   * Optional injected DB handle. When present, db_* probes use it; when
   * absent, db_* probes return {status:'fail', detail:'no DB handle
   * injected'} per RESEARCH §Open Questions §1 recommendation. Consumed by
   * the db_* probes added in Plan 05-03..05-06; unused in Wave 0.
   */
  sqlite?: Database.Database;
  /**
   * Optional migrations directory for the db_schema_version probe. bootstrap()
   * supplies its already-resolved path (which probes the dev vs. bundled-dist
   * layout) so the probe never re-derives it from import.meta.url — that
   * re-derivation breaks once the probe is flattened into dist/cli.mjs. When
   * absent, the probe falls back to its own location-probing resolver.
   */
  migrationsDir?: string;
  /**
   * Plan 05-06: optional injected repos for the recency / scored-day /
   * data-quality probes. The inline shape is the structural union of
   * `LastSyncRecencyDeps['repos']` + `MostRecentScoredDayDeps['repos']` +
   * `DataQualityCountsDeps['repos']`. When absent, those probes return their
   * "no repos injected" structured fail. The bootstrap() composition root
   * (src/services/bootstrap.ts) supplies the production repos; the bootstrap
   * `Repos` type satisfies this structurally.
   */
  repos?: {
    syncRuns: {
      latestFinished(): { finished_at: string; status: 'ok' | 'partial' | 'failed' } | null;
    };
    cycles: {
      latestScoredDate(): string | null;
      countByScoreState(): {
        scored: number;
        pending: number;
        unscorable: number;
        excluded: number;
      };
    };
    recovery: {
      latestScoredDate(): string | null;
      countByScoreState(): {
        scored: number;
        pending: number;
        unscorable: number;
        excluded: number;
      };
    };
    sleep: {
      latestScoredDate(): string | null;
      countByScoreState(): {
        scored: number;
        pending: number;
        unscorable: number;
        excluded: number;
      };
    };
  };
  /**
   * Plan 05-06: the single-flight refresh orchestrator the whoop_roundtrip
   * probe routes its one GET through (ADR-0002 chokepoint). Supplied by
   * bootstrap(); absent in the createServices() lightweight path, in which
   * case whoop_roundtrip degrades to the same 'skipped (--offline)' pass as
   * an explicit --offline run.
   */
  refreshOrchestrator?: RefreshOrchestrator;
  /**
   * Plan 05-06: the production fetcher the whoop_roundtrip probe invokes via
   * `refreshOrchestrator.callWithAuth`. Constructed in bootstrap() to wrap
   * `httpGet('/v2/user/profile/basic')` with performance.now timing (Gate F:
   * the wrapper goes through the allowlisted httpGet chokepoint, never a bare
   * fetch). When omitted, whoop_roundtrip is skipped (see refreshOrchestrator).
   */
  whoopFetcher?: (accessToken: string) => Promise<{ status: number; durationMs: number }>;
}

// MR-27: exhaustive status switch with defense-in-depth fail arm. The
// TypeScript type union (`'pass' | 'warn' | 'fail'`) already prevents any
// other status at compile time; the runtime arm exists so a future schema
// drift, a JSON.parse cast, or a probe that synthesizes a check from
// unchecked input still surfaces as `fail` instead of silently bucketing
// into pass. A unit test exercises this via a `@ts-expect-error` literal.
export function deriveOverall(checks: ReadonlyArray<DoctorCheck>): DoctorResult['overall'] {
  let sawWarn = false;
  for (const c of checks) {
    switch (c.status) {
      case 'fail':
        return 'fail';
      case 'warn':
        sawWarn = true;
        break;
      case 'pass':
        break;
      default:
        // Unknown status at runtime (impossible per the static type union).
        // Defense-in-depth: never treat unknown as pass. A drift here is a
        // load-bearing protocol failure; we surface it as fail so the doctor
        // surfaces the bug instead of silently green-checking the user.
        return 'fail';
    }
  }
  return sawWarn ? 'warn' : 'pass';
}

// MR-07: switch from Promise.all to Promise.allSettled so a single probe
// throwing does not collapse the whole doctor result into a rejected promise
// (which would surface as a sanitized MCP error or an unhandled CLI exception
// rather than a structured `fail` check). Each rejection is synthesized into
// a DoctorCheck with status: 'fail' so the failing probe still appears in
// the user-facing output with a useful detail string.
// MR-36: positional names mirror the Promise.allSettled probe order below
// (probeBetterSqlite3, probeKeyring, probeMcpStdoutPurity, probeAuth,
// probeTokenFreshness). Reference the canonical CHECK_NAMES so a rename
// in one place propagates here.
//
// Plan 02-06: extended from 3 to 5 names. `auth` and `token_freshness`
// are offline-safe (D-22) — they do NOT receive the `skipSubprocess`
// gate. Auth is listed before freshness because auth gates freshness:
// when no tokens exist on disk, the doctor surface prefers the more
// fundamental "no tokens" remediation over the derived "expired ... ago"
// secondary signal.
//
// Plan 05-06: extended from 5 to 14 probes. Phase 5 D-02 + Finding 2
// dependency ordering — load -> db -> auth -> online -> recency -> quality
// -> stress. This first-fail-wins visual order surfaces the most
// fundamental remediation first (native load before DB before auth before
// the online roundtrip before the data-recency signals). The
// whoop_roundtrip probe degrades to 'skipped' when refreshOrchestrator /
// whoopFetcher deps are absent (createServices() lightweight path);
// production bootstrap() supplies both.
const PROBE_NAMES = [
  CHECK_NAMES.BETTER_SQLITE3_LOAD,
  CHECK_NAMES.NAPI_KEYRING_LOAD,
  CHECK_NAMES.MCP_STDOUT_PURITY,
  CHECK_NAMES.DB_OPEN,
  CHECK_NAMES.DB_INTEGRITY,
  CHECK_NAMES.DB_SCHEMA_VERSION,
  CHECK_NAMES.DB_WAL_SIZE,
  CHECK_NAMES.AUTH,
  CHECK_NAMES.TOKEN_FRESHNESS,
  CHECK_NAMES.WHOOP_ROUNDTRIP,
  CHECK_NAMES.LAST_SYNC_RECENCY,
  CHECK_NAMES.MOST_RECENT_SCORED_DAY,
  CHECK_NAMES.DATA_QUALITY_COUNTS,
  CHECK_NAMES.CONCURRENT_WRITERS_STRESS,
] as const;

export async function runDoctor(opts: RunDoctorOptions = {}): Promise<DoctorResult> {
  // `RL_INSIDE_MCP=1` is set on the spawned MCP subprocess in
  // probeMcpStdoutPurity. The env-var fallback is intentionally narrower
  // than the explicit `opts.skipSubprocessChecks` flag (MR-14):
  //
  //   - explicit flag: trusted, set only by the MCP tool handler in
  //     src/mcp/tools/whoop-doctor.ts. ALWAYS honored.
  //   - env var: trusted only when the caller is itself a spawned MCP
  //     subprocess. Honored ONLY when `opts.skipSubprocessChecks` is
  //     explicitly undefined (i.e., the caller did not make a deliberate
  //     decision either way).
  //
  // Why narrow it: a user invoking `recovery-ledger doctor` from a shell
  // where they have RL_INSIDE_MCP=1 lingering (e.g., a stale launchctl
  // env, a Claude Code subshell, a docker-compose .env spillover) would
  // otherwise see the subprocess check silently skip — they explicitly
  // asked for the doctor's full surface and got a hollow pass instead.
  // The MCP tool handler always sets `skipSubprocessChecks: true`
  // explicitly, so it is unaffected. The probe's own RL_INSIDE_MCP=1
  // injection into the spawned child still works because the child's
  // outer `runDoctor` is invoked via the MCP tool handler, which sets
  // the explicit flag.
  const skipSubprocess = opts.skipSubprocessChecks === true;
  // Plan 05-06: whoop_roundtrip degrades to a 'skipped (--offline)' pass when
  // the orchestrator + fetcher deps are absent (createServices() lightweight
  // path) OR when --offline is explicitly requested. We compute the offline
  // gate once: explicit --offline, or either dep missing. The dummy deps in
  // the else-arm only satisfy the type contract — the offline arm guarantees
  // the probe never actually invokes them.
  const haveRoundtripDeps = opts.refreshOrchestrator != null && opts.whoopFetcher != null;
  const roundtripOffline = opts.offline === true || !haveRoundtripDeps;
  // Under `exactOptionalPropertyTypes: true` an explicit `{ sqlite: undefined }`
  // is NOT assignable to `sqlite?: Database`. Build the dep objects with
  // conditional spreads so the key is OMITTED when the option is absent —
  // which is exactly the "no handle injected" / "no repos injected" path each
  // probe's `if (!deps?.sqlite)` / `if (!deps?.repos)` guard expects.
  const sqliteDeps = opts.sqlite != null ? { sqlite: opts.sqlite } : {};
  const reposDeps = opts.repos != null ? { repos: opts.repos } : {};
  // db_schema_version also needs the migrations dir; bootstrap injects the
  // already-resolved path. Omit the key when absent so the probe's own
  // location-probing fallback runs (createServices / test path).
  const schemaVersionDeps =
    opts.migrationsDir != null ? { ...sqliteDeps, migrationsDir: opts.migrationsDir } : sqliteDeps;
  const settled = await Promise.allSettled([
    probeBetterSqlite3(),
    probeKeyring(),
    probeMcpStdoutPurity({ skipSubprocess }),
    // Plan 05-06: db_* probes consume the injected handle from bootstrap();
    // absent the handle each returns its structured "no DB handle injected"
    // fail. db_wal_size reads paths.dbFile directly (no injected handle).
    probeDbOpen(sqliteDeps),
    probeDbIntegrity(sqliteDeps),
    probeDbSchemaVersion(schemaVersionDeps),
    probeDbWalSize({}),
    // Plan 02-06: offline-safe probes — no subprocess gate needed.
    probeAuth(),
    probeTokenFreshness(),
    // Plan 05-06: the ONE online probe. When deps are present and --offline
    // is not set, it routes a single GET through callWithAuth; otherwise it
    // short-circuits to the 'skipped (--offline)' pass.
    probeWhoopRoundtrip(
      opts.refreshOrchestrator != null && opts.whoopFetcher != null
        ? { refreshOrchestrator: opts.refreshOrchestrator, fetcher: opts.whoopFetcher }
        : {
            refreshOrchestrator: {
              callWithAuth: async () => {
                throw new Error('no orchestrator');
              },
            } as unknown as RefreshOrchestrator,
            fetcher: async () => ({ status: 0, durationMs: 0 }),
          },
      { offline: roundtripOffline },
    ),
    // Plan 05-06: recency / scored-day / data-quality probes consume the
    // injected repos; absent the repos each returns its "no repos injected"
    // structured fail.
    probeLastSyncRecency(reposDeps),
    probeMostRecentScoredDay(reposDeps),
    probeDataQualityCounts(reposDeps),
    // Plan 05-06: opt-in stress probe — only --stress (opts.stress === true)
    // enables the 4-worker fork; skipSubprocess gates it out of the MCP path.
    probeConcurrentWritersStress({ skipSubprocess, enabled: opts.stress === true }),
  ]);
  const checks: DoctorCheck[] = settled.map((r, i) => {
    if (r.status === 'fulfilled') return r.value;
    // Synthesize a fail check for a probe that threw rather than returning
    // a structured DoctorCheck. `probeName` falls back to a positional name
    // if PROBE_NAMES drifts out of sync — defense in depth, not contract.
    const probeName = PROBE_NAMES[i] ?? `probe_${i}`;
    const reason = r.reason instanceof Error ? r.reason.message : String(r.reason);
    return {
      name: probeName,
      status: 'fail',
      detail: `probe threw: ${reason}`,
    };
  });
  return { checks, overall: deriveOverall(checks) };
}
