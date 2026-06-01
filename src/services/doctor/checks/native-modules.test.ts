// Native-module probe unit tests (D-05 happy-path).
//
// Per Pitfall 2, CI runs on macOS-latest with prebuilds available — both
// probes return `pass` on the happy path. Error-path assertions are deferred
// to Phase 2 once the keyring code lands a real backend; Phase 1's contract
// is "the .node binary loads under the current Node ABI." The probes
// themselves catch errors and surface them through DoctorCheck — so a missing
// prebuild on a dev box shows up as a soft `fail` from this test, not a
// thrown exception, which is the entire point of FND-07.

import { afterEach, describe, expect, test, vi } from 'vitest';
import { probeBetterSqlite3, probeKeyring } from './native-modules.js';

afterEach(() => {
  vi.resetModules();
  vi.doUnmock('better-sqlite3');
  vi.doUnmock('@napi-rs/keyring');
});

describe('probeBetterSqlite3', () => {
  test('returns status=pass when the native binding loads', async () => {
    const check = await probeBetterSqlite3();
    expect(check.name).toBe('better_sqlite3_load');
    expect(check.status).toBe('pass');
    expect(check.detail).toBe('native binding loaded');
  });

  // TSTC-01 (#86): the catch arm — pre-TSTC-01 entirely uncovered. A
  // refactor that let an import throw escape would silently green-check.
  test('returns status=fail when better-sqlite3 constructor throws (#86)', async () => {
    // Mock the default export to a class whose constructor throws — mirrors
    // the real ABI-mismatch failure mode (the import resolves, but the
    // .node binding throws on first use). Catches the probe's try/catch.
    vi.doMock('better-sqlite3', () => ({
      default: class FailingDatabase {
        constructor() {
          throw new Error('native binding missing — ABI mismatch');
        }
      },
    }));
    vi.resetModules();
    const { probeBetterSqlite3: freshProbe } = await import('./native-modules.js');
    const check = await freshProbe();
    expect(check.name).toBe('better_sqlite3_load');
    expect(check.status).toBe('fail');
    expect(check.detail).toContain('failed to load');
    expect(check.detail).toContain('native binding missing');
    expect(check.detail).toContain('npm rebuild better-sqlite3');
  });
});

describe('probeKeyring', () => {
  test('returns status=pass when the napi binding loads', async () => {
    const check = await probeKeyring();
    expect(check.name).toBe('napi_keyring_load');
    expect(check.status).toBe('pass');
    expect(check.detail).toBe('native binding loaded');
  });

  // TSTC-01 (#86): the catch arm — pre-TSTC-01 entirely uncovered.
  test('returns status=fail when @napi-rs/keyring Entry constructor throws (#86)', async () => {
    vi.doMock('@napi-rs/keyring', () => ({
      Entry: class FailingEntry {
        constructor() {
          throw new Error('keyring napi binding missing — libsecret not installed');
        }
      },
    }));
    vi.resetModules();
    const { probeKeyring: freshProbe } = await import('./native-modules.js');
    const check = await freshProbe();
    expect(check.name).toBe('napi_keyring_load');
    expect(check.status).toBe('fail');
    expect(check.detail).toContain('failed to load');
    expect(check.detail).toContain('libsecret not installed');
  });
});
