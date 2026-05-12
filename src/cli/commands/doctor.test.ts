// WR-06 regression guard — the doctor exit-code map must distinguish all
// three D-06 statuses. Scripted wrappers (cron, launchd, CI) depend on the
// shell-level signal; conflating warn into pass (the pre-fix behaviour)
// would silently hide partial-failure states.

import { afterEach, describe, expect, test, vi } from 'vitest';
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

// MR-08 regression guard — runDoctorCommand wraps its body in try/catch and
// surfaces a minimal {checks: [], overall: 'fail', error: ...} payload on an
// unexpected exception (e.g., runDoctor rejecting before MR-07's allSettled
// could intercept, or JSON.stringify throwing on a future cyclic field).
// Without the outer catch the CLI would crash with no output and a Node
// default exit code, which scripted wrappers cannot distinguish from a
// terminal kill.
describe('runDoctorCommand — MR-08 exception path', () => {
  // Each test below patches process.exit and process.stdout.write, then
  // re-imports doctor.js with a mocked runDoctor that throws. The mocks
  // capture the written body and the exit code without actually killing the
  // test process. afterEach restores the originals and clears the module
  // cache so the next test starts clean.
  const originalExit = process.exit;
  const originalWrite = process.stdout.write.bind(process.stdout);

  afterEach(() => {
    process.exit = originalExit;
    process.stdout.write = originalWrite;
    vi.resetModules();
    vi.doUnmock('../../services/doctor/index.js');
  });

  test('exception in runDoctor exits with DOCTOR_EXIT_CODES.fail and writes a fail body', async () => {
    vi.resetModules();
    vi.doMock('../../services/doctor/index.js', () => ({
      runDoctor: async () => {
        throw new Error('synthetic runDoctor explosion');
      },
    }));

    let exitCode: number | undefined;
    let writtenBody = '';
    // Mock process.exit to throw a sentinel — runDoctorCommand should not
    // continue after exit, and the throw lets us assert the exit code in
    // the catch block below.
    process.exit = ((code?: number) => {
      exitCode = code;
      throw new Error('__test_exit__');
    }) as never;
    // Mock stdout.write to capture the body and invoke the completion
    // callback synchronously (so the exit fires under our mock).
    process.stdout.write = ((
      chunk: string | Uint8Array,
      cbOrEncoding?: ((err?: Error | null) => void) | string,
      cb?: (err?: Error | null) => void,
    ) => {
      writtenBody += typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8');
      const finished = typeof cbOrEncoding === 'function' ? cbOrEncoding : cb;
      if (finished) finished();
      return true;
    }) as typeof process.stdout.write;

    const { runDoctorCommand } = await import('./doctor.js');

    await expect(runDoctorCommand({})).rejects.toThrow('__test_exit__');
    expect(exitCode).toBe(DOCTOR_EXIT_CODES.fail);
    // JSON body includes the structured fail shape and the error message.
    const parsed = JSON.parse(writtenBody) as {
      checks: unknown[];
      overall: string;
      error: string;
    };
    expect(parsed.checks).toEqual([]);
    expect(parsed.overall).toBe('fail');
    expect(parsed.error).toContain('synthetic runDoctor explosion');
  });

  test('exception in --text mode produces a one-line [fail] body', async () => {
    vi.resetModules();
    vi.doMock('../../services/doctor/index.js', () => ({
      runDoctor: async () => {
        throw new Error('synthetic text-mode explosion');
      },
    }));

    let exitCode: number | undefined;
    let writtenBody = '';
    process.exit = ((code?: number) => {
      exitCode = code;
      throw new Error('__test_exit__');
    }) as never;
    process.stdout.write = ((
      chunk: string | Uint8Array,
      cbOrEncoding?: ((err?: Error | null) => void) | string,
      cb?: (err?: Error | null) => void,
    ) => {
      writtenBody += typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8');
      const finished = typeof cbOrEncoding === 'function' ? cbOrEncoding : cb;
      if (finished) finished();
      return true;
    }) as typeof process.stdout.write;

    const { runDoctorCommand } = await import('./doctor.js');

    await expect(runDoctorCommand({ text: true })).rejects.toThrow('__test_exit__');
    expect(exitCode).toBe(DOCTOR_EXIT_CODES.fail);
    expect(writtenBody).toContain('[fail] cli');
    expect(writtenBody).toContain('overall: fail');
    expect(writtenBody).toContain('synthetic text-mode explosion');
  });
});
