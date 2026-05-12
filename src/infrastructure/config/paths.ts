// Path resolver for the on-disk Recovery Ledger home (D-03 / D-06 / D-07).
//
// Layout (default): `~/.recovery-ledger/`
//   ├── config.json        # InitConfig (Plan 02-05) — mode 0600
//   ├── tokens.json        # encrypted tokens — mode 0600 — file-fallback path
//   ├── tokens.json.lock   # proper-lockfile target (D-07, ADR-0002)
//   └── storage-mode       # one-line marker: "keychain" | "file"
//
// `RECOVERY_LEDGER_HOME` env var fully overrides the home directory (D-06).
// Used by the test suite to point at a tmpdir and by power users who want
// the data tree somewhere other than `$HOME` (T-02.01-01 — the override is
// intentional; a local attacker with shell access already owns the process).
//
// MR-21 voice: this module is the ONLY source of the five derived paths.
// token-store.ts, init.ts, auth.ts (Plans 02-02, 02-05) all import from
// here. Mirrors the factory+singleton shape of logger.ts so the test seam
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
