// Path resolver for the on-disk Recovery Ledger home (D-03 / D-06 / D-07
// in Phase 2; Phase 3 D-14 / D-30 / D-32 extend with DB-layer paths).
//
// Layout (default): `~/.recovery-ledger/`
//   ├── config.json        # InitConfig (Plan 02-05) — mode 0600
//   ├── tokens.json        # encrypted tokens — mode 0600 — file-fallback path
//   ├── tokens.json.lock   # proper-lockfile target (D-07, ADR-0002)
//   ├── storage-mode       # one-line marker: "keychain" | "file"
//   ├── db.sqlite          # local cache, WAL mode (Plan 03-?? bootstrap)
//   ├── db.sqlite-wal      # SQLite write-ahead log (companion of db.sqlite)
//   ├── db.sqlite-shm      # SQLite shared memory file (companion of db.sqlite)
//   └── backups/           # pre-migration backups, mode 0600 (Phase 3 D-07)
//
// `RECOVERY_LEDGER_HOME` env var fully overrides the home directory (D-06).
// Used by the test suite to point at a tmpdir and by power users who want
// the data tree somewhere other than `$HOME` (T-02.01-01 — the override is
// intentional; a local attacker with shell access already owns the process).
//
// Phase 3 NOTE: `migrationsDir` is NOT resolved here. The hand-rolled
// migrator (Wave 2 Plan 03-05) computes it from `import.meta.url` so
// migrations travel inside the package (read from `dist/` at runtime),
// not from the user's writable home — different lifetime, different
// trust boundary. See 03-PATTERNS.md F1 for the resolution shape.
//
// MR-21 voice: this module is the ONLY source of the derived paths.
// token-store.ts, init.ts, auth.ts (Plans 02-02, 02-05) and the future
// db/connection.ts + db/migrate.ts (Phase 3) all import from here.
// Mirrors the factory+singleton shape of logger.ts so the test seam
// stays consistent across the infrastructure layer.

import { join } from 'node:path';

export interface PathsEnv {
  RECOVERY_LEDGER_HOME?: string;
  HOME?: string;
}

export interface ResolvedPaths {
  configDir: string;
  configFile: string;
  tokensFile: string;
  tokensLockFile: string;
  storageModeFile: string;
  // Phase 3 DB-layer additions (D-14 / D-30 / D-32). `dbFile` is the
  // canonical SQLite path; `-wal` and `-shm` are the two on-disk
  // companions that the migrator's pre-migration backup (D-07) must
  // capture alongside the main file. `backupsDir` houses the three
  // most-recent pre-migration backups at mode 0600.
  dbFile: string;
  dbWalFile: string;
  dbShmFile: string;
  backupsDir: string;
}

/**
 * Resolve the five Recovery Ledger paths from a typed env. Pure function —
 * no env-global reads, no fs touches, no logger. Exported so the unit
 * suite can exercise both the default-home and RECOVERY_LEDGER_HOME-override
 * arms with literal objects (WR-01 analogue from Phase 1's logger.ts).
 *
 * Throws an Error mentioning HOME and RECOVERY_LEDGER_HOME when neither is
 * set. No implicit fallback to `process.cwd()` — fail loudly so a
 * misconfigured environment is caught at startup, not after a token write
 * silently lands in the wrong directory.
 */
export function resolvePaths(env: PathsEnv): ResolvedPaths {
  const configDir =
    env.RECOVERY_LEDGER_HOME ?? (env.HOME ? join(env.HOME, '.recovery-ledger') : undefined);
  if (configDir === undefined) {
    throw new Error('RECOVERY_LEDGER_HOME or HOME must be set');
  }
  return {
    configDir,
    configFile: join(configDir, 'config.json'),
    tokensFile: join(configDir, 'tokens.json'),
    tokensLockFile: join(configDir, 'tokens.json.lock'),
    storageModeFile: join(configDir, 'storage-mode'),
    dbFile: join(configDir, 'db.sqlite'),
    dbWalFile: join(configDir, 'db.sqlite-wal'),
    dbShmFile: join(configDir, 'db.sqlite-shm'),
    backupsDir: join(configDir, 'backups'),
  };
}

// Production singleton — bound LAZILY on first property access (WR-04). The
// initial implementation resolved paths at module load (`export const paths =
// resolvePaths(process.env)`), which throws if neither HOME nor
// RECOVERY_LEDGER_HOME is set. That throw crashed the entire module graph
// before any test runner / CLI guard could catch and report it — a sandboxed
// CI container with no HOME env would fail at import time, before `beforeEach`
// could repair the env.
//
// Lazy binding via a Proxy: module load always succeeds; the missing-env
// throw surfaces on first `paths.X` access (which is the same load-bearing
// invariant — the error message and the failure mode are identical for
// production callers). Tests still call `resolvePaths({...})` directly for
// the unit suite seam; this singleton is the production-import path.
//
// Pinning behavior: `_resolved` memoizes the first successful resolution. A
// second access reads the cached value — re-running `process.env` lookups on
// every access would let a test that mutates env mid-test see inconsistent
// paths (subtle bug; not exercised today). Tests that need a different
// resolution path use `resolvePaths(env)` directly with their own ResolvedPaths.
let _resolved: ResolvedPaths | null = null;
function getResolved(): ResolvedPaths {
  if (_resolved === null) {
    _resolved = resolvePaths(process.env);
  }
  return _resolved;
}

export const paths: ResolvedPaths = new Proxy({} as ResolvedPaths, {
  get(_target, prop) {
    const resolved = getResolved();
    return resolved[prop as keyof ResolvedPaths];
  },
});
