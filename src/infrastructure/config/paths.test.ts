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

  test('WR-04 regression: module-load succeeds under empty env; throw deferred to first access', async () => {
    // Pre-fix: `export const paths = resolvePaths(process.env)` threw at
    // module load if neither HOME nor RECOVERY_LEDGER_HOME was set. That
    // crashed the entire module graph before any test runner could catch and
    // report it. Post-fix: paths is a Proxy; the throw is deferred to first
    // property access, so the import itself always succeeds.
    const { resetModules } = await import('vitest').then((m) => ({
      resetModules: m.vi.resetModules.bind(m.vi),
    }));
    resetModules();

    // Scrub the env so the lazy bind sees no HOME or RECOVERY_LEDGER_HOME.
    const originalHome = process.env.HOME;
    const originalRlHome = process.env.RECOVERY_LEDGER_HOME;
    delete process.env.HOME;
    delete process.env.RECOVERY_LEDGER_HOME;
    try {
      // Import must NOT throw, even with an empty env.
      const mod = await import('./paths.js');
      expect(mod.paths).toBeDefined();
      // First property access surfaces the throw with the same message.
      expect(() => mod.paths.configDir).toThrowError(/HOME|RECOVERY_LEDGER_HOME/);
    } finally {
      if (originalHome !== undefined) process.env.HOME = originalHome;
      if (originalRlHome !== undefined) process.env.RECOVERY_LEDGER_HOME = originalRlHome;
      resetModules();
    }
  });
});
