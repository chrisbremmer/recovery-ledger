// Doctor composition unit tests — exercise the `overall` precedence rule
// (D-06: any fail wins; else any warn wins; else pass). Tests run against
// the exported `deriveOverall` helper so no native modules are spawned and
// no subprocess driver fires. `runDoctor()` itself is exercised end-to-end
// by Plan 06's integration test.

import { describe, expect, test } from 'vitest';
import { type DoctorCheck, deriveOverall } from './index.js';

const stub = (name: string, status: DoctorCheck['status']): DoctorCheck => ({
  name,
  status,
  detail: `${name}:${status}`,
});

describe('deriveOverall', () => {
  test('returns pass when every check is pass', () => {
    const checks = [stub('a', 'pass'), stub('b', 'pass'), stub('c', 'pass')];
    expect(deriveOverall(checks)).toBe('pass');
  });

  test('returns warn when any check is warn and none fail', () => {
    const checks = [stub('a', 'pass'), stub('b', 'warn'), stub('c', 'pass')];
    expect(deriveOverall(checks)).toBe('warn');
  });

  test('returns fail when any check is fail, regardless of warns', () => {
    const checks = [stub('a', 'fail'), stub('b', 'warn'), stub('c', 'pass')];
    expect(deriveOverall(checks)).toBe('fail');
  });
});
