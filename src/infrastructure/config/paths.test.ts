// Unit coverage for resolvePaths (D-03 / D-06 / D-07).
//
// The factory takes a typed env arg (PathsEnv) so the suite can exercise
// the default-home arm AND the RECOVERY_LEDGER_HOME override arm with
// literal objects — no process.env mutation, no tmpdir, no fs reads. The
// singleton `paths` bound at module load is exercised implicitly: importing
// this test would crash if the module-level `resolvePaths(process.env)`
// throws on a clean CI shell, so a green test is also evidence the singleton
// resolves.

import { describe, expect, test } from 'vitest';
import { resolvePaths } from './paths.js';

describe('resolvePaths', () => {
  test('default home derives configDir under HOME/.recovery-ledger', () => {
    const p = resolvePaths({ HOME: '/home/u' });
    expect(p.configDir).toBe('/home/u/.recovery-ledger');
  });

  test('RECOVERY_LEDGER_HOME wins over HOME (env override)', () => {
    const p = resolvePaths({ HOME: '/home/u', RECOVERY_LEDGER_HOME: '/tmp/r' });
    expect(p.configDir).toBe('/tmp/r');
  });

  test('returns all five derived paths joined under configDir', () => {
    const p = resolvePaths({ HOME: '/home/u' });
    expect(p.configFile).toBe('/home/u/.recovery-ledger/config.json');
    expect(p.tokensFile).toBe('/home/u/.recovery-ledger/tokens.json');
    expect(p.tokensLockFile).toBe('/home/u/.recovery-ledger/tokens.json.lock');
    expect(p.storageModeFile).toBe('/home/u/.recovery-ledger/storage-mode');
  });

  test('tokensLockFile basename is exactly tokens.json.lock (D-07)', () => {
    const p = resolvePaths({ HOME: '/home/u' });
    expect(p.tokensLockFile).toBe('/home/u/.recovery-ledger/tokens.json.lock');
  });

  test('throws when both HOME and RECOVERY_LEDGER_HOME are undefined', () => {
    // Empty PathsEnv — no implicit fallback to process.cwd(). Fail loudly so
    // a misconfigured environment is caught at startup, not after a token
    // write silently lands in the wrong directory.
    expect(() => resolvePaths({})).toThrowError(/HOME|RECOVERY_LEDGER_HOME/);
  });
});
