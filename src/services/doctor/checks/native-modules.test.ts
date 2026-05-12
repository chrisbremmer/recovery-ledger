// Native-module probe unit tests (D-05 happy-path).
//
// Per Pitfall 2, CI runs on macOS-latest with prebuilds available — both
// probes return `pass` on the happy path. Error-path assertions are deferred
// to Phase 2 once the keyring code lands a real backend; Phase 1's contract
// is "the .node binary loads under the current Node ABI." The probes
// themselves catch errors and surface them through DoctorCheck — so a missing
// prebuild on a dev box shows up as a soft `fail` from this test, not a
// thrown exception, which is the entire point of FND-07.

import { describe, expect, test } from 'vitest';
import { probeBetterSqlite3, probeKeyring } from './native-modules.js';

describe('probeBetterSqlite3', () => {
  test('returns status=pass when the native binding loads', async () => {
    const check = await probeBetterSqlite3();
    expect(check.name).toBe('better_sqlite3_load');
    expect(check.status).toBe('pass');
    expect(check.detail).toBe('native binding loaded');
  });
});

describe('probeKeyring', () => {
  test('returns status=pass when the napi binding loads', async () => {
    const check = await probeKeyring();
    expect(check.name).toBe('napi_keyring_load');
    expect(check.status).toBe('pass');
    expect(check.detail).toBe('native binding loaded');
  });
});
