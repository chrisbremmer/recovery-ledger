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
});
