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

// WR-05 regression guard — DoctorResult must round-trip through JSON without
// loss. The MCP whoop_doctor tool serializes the result via
// `JSON.parse(JSON.stringify(result))` (see src/mcp/tools/whoop-doctor.ts),
// which guards against future fields that JSON cannot represent (Date,
// function, Map, Buffer, undefined). Adding such a field flips this test
// red before the cast-free conversion silently mangles MCP output.
describe('DoctorResult — WR-05 JSON serializability contract', () => {
  test('DoctorResult round-trips through JSON byte-for-byte', () => {
    const sample: import('./index.js').DoctorResult = {
      checks: [
        { name: 'better_sqlite3_load', status: 'pass', detail: 'native binding loaded' },
        { name: 'napi_keyring_load', status: 'warn', detail: 'optional fallback used' },
        { name: 'mcp_stdout_purity', status: 'fail', detail: 'stream invalid' },
      ],
      overall: 'fail',
    };
    const roundTripped = JSON.parse(JSON.stringify(sample)) as typeof sample;
    expect(roundTripped).toEqual(sample);
    // Deep-equal check above implies every field survived. Explicit checks
    // on the discriminator values too — a regression that changed `status`
    // to a non-string union would survive structural equality but not the
    // explicit type assertion below.
    expect(roundTripped.overall).toBe('fail');
    expect(roundTripped.checks[0]?.status).toBe('pass');
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
