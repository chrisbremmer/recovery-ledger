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

// Production singleton — bound at module load to the current global env.
// Token-store / init / auth import this directly; tests construct their
// own ResolvedPaths via `resolvePaths({ HOME: tmpdir() })` to avoid the
// process-level env and the home directory.
export const paths = resolvePaths(process.env);
