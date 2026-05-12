// Plaintext renderer unit tests (D-06 format).
//
// `renderDoctor` produces one `[status] name — detail` line per check
// followed by an `overall: <status>` trailer. The MCP whoop_doctor tool's
// text fallback consumes this same renderer.

import { describe, expect, test } from 'vitest';
import type { DoctorResult } from '../services/doctor/index.js';
import { renderDoctor } from './doctor.txt.js';

const fixture: DoctorResult = {
  checks: [
    { name: 'better_sqlite3_load', status: 'pass', detail: 'native binding loaded' },
    { name: 'napi_keyring_load', status: 'pass', detail: 'native binding loaded' },
    { name: 'mcp_stdout_purity', status: 'warn', detail: 'one stale frame' },
  ],
  overall: 'warn',
};

describe('renderDoctor', () => {
  test('renders every check name, status, and detail', () => {
    const text = renderDoctor(fixture);
    for (const c of fixture.checks) {
      expect(text).toContain(c.name);
      expect(text).toContain(c.detail);
      expect(text).toContain(`[${c.status}]`);
    }
  });

  test('renders a final overall: line matching the result', () => {
    const text = renderDoctor(fixture);
    expect(text).toContain('overall: warn');
    // The overall line is the last non-empty line.
    const lines = text.split('\n').filter((l) => l.length > 0);
    expect(lines[lines.length - 1]).toBe('overall: warn');
  });

  // MR-41 — explicit fail-path coverage. The existing fixture exercises pass
  // and warn; a regression that mangled the fail emit (e.g., a future
  // formatter that special-cased the fail prefix) would slip through. Cover
  // every status independently so the table is contract-tested end-to-end.
  test('MR-41 — renders [fail] tag and overall: fail when a check fails', () => {
    const failFixture: DoctorResult = {
      checks: [
        { name: 'better_sqlite3_load', status: 'pass', detail: 'native binding loaded' },
        {
          name: 'mcp_stdout_purity',
          status: 'fail',
          detail: 'tools/call response (id=3) missing — 2 frames observed',
        },
      ],
      overall: 'fail',
    };
    const text = renderDoctor(failFixture);
    expect(text).toContain('[fail]');
    expect(text).toContain('mcp_stdout_purity');
    expect(text).toContain('tools/call response (id=3) missing');
    expect(text).toContain('overall: fail');
    // overall is the last non-empty line.
    const lines = text.split('\n').filter((l) => l.length > 0);
    expect(lines[lines.length - 1]).toBe('overall: fail');
  });
});
