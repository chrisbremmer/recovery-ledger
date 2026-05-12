// Doctor composition unit tests — exercise the `overall` precedence rule
// (D-06: any fail wins; else any warn wins; else pass). Tests run against
// the exported `deriveOverall` helper so no native modules are spawned and
// no subprocess driver fires. `runDoctor()` itself is exercised end-to-end
// by Plan 06's integration test.

import { describe, expect, test } from 'vitest';
import { type DoctorCheck, deriveOverall, runDoctor } from './index.js';

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

// CR-01 regression guard — `runDoctor({ skipSubprocessChecks: true })` must
// NOT cause the mcp_stdout_purity probe to spawn `dist/mcp.mjs`. The MCP
// `whoop_doctor` tool passes this flag; without it, the tool would recursively
// respawn the MCP server every time it ran inside an MCP transport.
//
// We can't easily mock `node:child_process.spawn` from a sibling module
// (Node's ESM bindings are read-only and `vi.mock` of a built-in requires
// hoisting that's brittle here). Instead, the assertion is observable from
// the probe's return shape: when subprocess is skipped, it returns synchronously
// with detail "skipped (running inside MCP transport)" — a string that NO
// real subprocess outcome produces. A regression that removed the skip-arm
// would either return a real "JSON-RPC stream valid (N frames)" pass or a
// spawn-related failure, never the literal skip detail.
//
// To keep the test deterministic and fast (no real spawn), we also assert
// the call completes in well under one frame-settle interval (200ms × 4 +
// 300ms drain = ~1100ms minimum for a real probe).
describe('runDoctor — CR-01 skipSubprocessChecks contract', () => {
  test('runDoctor({ skipSubprocessChecks: true }) returns the skip detail without spawning', async () => {
    const start = Date.now();
    const result = await runDoctor({ skipSubprocessChecks: true });
    const elapsed = Date.now() - start;

    const mcpCheck = result.checks.find((c) => c.name === 'mcp_stdout_purity');
    expect(mcpCheck).toBeDefined();
    expect(mcpCheck?.status).toBe('pass');
    // Exact-string match on the literal skip detail. Any code path that does
    // not return early would produce a different detail string.
    expect(mcpCheck?.detail).toBe('skipped (running inside MCP transport)');

    // A real subprocess probe needs ≥1.1s (4 × 200ms frame settle + 300ms
    // drain). The skip arm must complete in a few milliseconds. 500ms is a
    // generous ceiling that still proves no spawn ran.
    expect(elapsed).toBeLessThan(500);
  });

  test('runDoctor() honours RL_INSIDE_MCP=1 env even without explicit option', async () => {
    const prev = process.env.RL_INSIDE_MCP;
    process.env.RL_INSIDE_MCP = '1';
    try {
      const start = Date.now();
      const result = await runDoctor();
      const elapsed = Date.now() - start;

      const mcpCheck = result.checks.find((c) => c.name === 'mcp_stdout_purity');
      expect(mcpCheck?.detail).toBe('skipped (running inside MCP transport)');
      expect(elapsed).toBeLessThan(500);
    } finally {
      if (prev === undefined) delete process.env.RL_INSIDE_MCP;
      else process.env.RL_INSIDE_MCP = prev;
    }
  });
});
