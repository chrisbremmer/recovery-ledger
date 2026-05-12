// WR-06 regression guard — the doctor exit-code map must distinguish all
// three D-06 statuses. Scripted wrappers (cron, launchd, CI) depend on the
// shell-level signal; conflating warn into pass (the pre-fix behaviour)
// would silently hide partial-failure states.

import { describe, expect, test } from 'vitest';
import { DOCTOR_EXIT_CODES } from './doctor.js';

describe('DOCTOR_EXIT_CODES — WR-06 three-status mapping', () => {
  test('pass exits 0 (POSIX success)', () => {
    expect(DOCTOR_EXIT_CODES.pass).toBe(0);
  });

  test('warn exits 2 (POSIX warning convention)', () => {
    expect(DOCTOR_EXIT_CODES.warn).toBe(2);
  });

  test('fail exits 1 (POSIX generic failure)', () => {
    expect(DOCTOR_EXIT_CODES.fail).toBe(1);
  });

  test('warn and fail produce distinct exit codes (no silent conflation)', () => {
    expect(DOCTOR_EXIT_CODES.warn).not.toBe(DOCTOR_EXIT_CODES.pass);
    expect(DOCTOR_EXIT_CODES.warn).not.toBe(DOCTOR_EXIT_CODES.fail);
    expect(DOCTOR_EXIT_CODES.fail).not.toBe(DOCTOR_EXIT_CODES.pass);
  });

  test('exit-code map is frozen — accidental mutation throws in strict mode', () => {
    expect(Object.isFrozen(DOCTOR_EXIT_CODES)).toBe(true);
  });
});
