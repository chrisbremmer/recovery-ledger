// Doctor composition unit tests — exercise the `overall` precedence rule
// (D-06: any fail wins; else any warn wins; else pass). Tests run against
// the exported `deriveOverall` helper so no native modules are spawned and
// no subprocess driver fires. `runDoctor()` itself is exercised end-to-end
// by Plan 06's integration test.

import { describe, expect, test, vi } from 'vitest';
import { CHECK_NAMES } from './checks/check-names.js';
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

  // MR-27 — defense-in-depth: an unknown status at runtime (impossible per the
  // static type but possible after a JSON round-trip or a schema drift) must
  // bucket into `fail`, not silently pass through. The pre-MR-27 implementation
  // used `some(c => c.status === 'fail')`/`some(c => c.status === 'warn')` and
  // fell through to `'pass'` for any unrecognized status — silent green-check.
  test('MR-27 — returns fail when a check has an unknown status (defense-in-depth)', () => {
    const checks: DoctorCheck[] = [
      stub('a', 'pass'),
      // @ts-expect-error — testing the runtime arm; the type union forbids this at compile time.
      { name: 'b', status: 'unknown', detail: 'malformed' },
      stub('c', 'pass'),
    ];
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

  // MR-07 — a probe that throws must surface as a synthesized `fail` check,
  // not as a rejected runDoctor() promise that escapes to the caller. The MCP
  // and CLI surfaces both consume DoctorResult verbatim and assume every probe
  // returns a structured check; a throw was previously a load-bearing bug.
  test('MR-07 — runDoctor synthesizes a fail check when a probe throws', async () => {
    // Mock probeBetterSqlite3 to throw. The other two probes return normally,
    // so we expect three checks total with one synthesized-from-throw entry.
    vi.resetModules();
    vi.doMock('./checks/native-modules.js', () => ({
      probeBetterSqlite3: async () => {
        throw new Error('synthetic probe explosion');
      },
      probeKeyring: async () => ({
        name: 'napi_keyring_load',
        status: 'pass' as const,
        detail: 'native binding loaded',
      }),
    }));
    try {
      // Dynamic import after the mock so the runDoctor under test resolves
      // the mocked probeBetterSqlite3 binding.
      const { runDoctor: runDoctorMocked } = await import('./index.js');
      const result = await runDoctorMocked({ skipSubprocessChecks: true });

      expect(result.overall).toBe('fail');
      const failed = result.checks.find((c) => c.name === 'better_sqlite3_load');
      expect(failed).toBeDefined();
      expect(failed?.status).toBe('fail');
      expect(failed?.detail).toContain('probe threw');
      expect(failed?.detail).toContain('synthetic probe explosion');
    } finally {
      vi.doUnmock('./checks/native-modules.js');
      vi.resetModules();
    }
  });

  // MR-36 — every probe surfaces under its canonical CHECK_NAMES literal.
  // A rename in CHECK_NAMES propagates to every consumer; this test catches
  // a probe that hardcoded the old string after a rename.
  //
  // Plan 02-06: grown from three to five canonical names. The new probes
  // (`auth` + `token_freshness`) are offline-safe and always emit checks
  // regardless of `skipSubprocessChecks`.
  test('MR-36 — runDoctor() result includes all five canonical CHECK_NAMES', async () => {
    const result = await runDoctor({ skipSubprocessChecks: true });
    const names = result.checks.map((c) => c.name);
    expect(names).toContain(CHECK_NAMES.BETTER_SQLITE3_LOAD);
    expect(names).toContain(CHECK_NAMES.NAPI_KEYRING_LOAD);
    expect(names).toContain(CHECK_NAMES.MCP_STDOUT_PURITY);
    expect(names).toContain(CHECK_NAMES.AUTH);
    expect(names).toContain(CHECK_NAMES.TOKEN_FRESHNESS);
    // No stray probe names that lost their CHECK_NAMES reference.
    const canonical = new Set<string>(Object.values(CHECK_NAMES));
    for (const name of names) {
      expect(canonical.has(name)).toBe(true);
    }
  });

  // D-02 / D-03: the two new probes are wired into runDoctor and the auth
  // probe surfaces a deterministic fail when no tokens exist on disk.
  test('D-02 — runDoctor surfaces the auth probe output (no tokens -> fail)', async () => {
    const result = await runDoctor({ skipSubprocessChecks: true });
    const authCheck = result.checks.find((c) => c.name === CHECK_NAMES.AUTH);
    expect(authCheck).toBeDefined();
    // With no `storage-mode` file under the test-env tmpdir-or-home, the
    // probe must report fail. We don't pin the exact detail here — that
    // contract lives in auth.test.ts — but we do pin the status.
    expect(authCheck?.status).toBe('fail');
  });

  test('D-03 — runDoctor surfaces the token_freshness probe output', async () => {
    const result = await runDoctor({ skipSubprocessChecks: true });
    const freshness = result.checks.find((c) => c.name === CHECK_NAMES.TOKEN_FRESHNESS);
    expect(freshness).toBeDefined();
    // With no tokens on disk the freshness probe must report fail.
    expect(freshness?.status).toBe('fail');
  });

  test('D-04 — auth=fail collapses overall to "fail" (precedence preserved with 5 probes)', async () => {
    const result = await runDoctor({ skipSubprocessChecks: true });
    // The auth probe fails when no tokens exist; overall must be fail
    // regardless of the other probes' status. This pins the precedence
    // rule across the broader 5-probe set.
    expect(result.overall).toBe('fail');
  });

  // MR-14: the RL_INSIDE_MCP env-var fallback was removed from runDoctor()
  // because a stale env var in the user's shell would silently skip the
  // subprocess check when they invoked `recovery-ledger doctor` — they
  // explicitly asked for the doctor's full surface and would have gotten a
  // hollow pass instead. The MCP tool handler always passes
  // `skipSubprocessChecks: true` explicitly, so the recursion-break still
  // works through the trusted option path. This test pins the new contract:
  // RL_INSIDE_MCP alone is NOT enough to skip; the option must be explicit.
  test('runDoctor() ignores RL_INSIDE_MCP=1 env without explicit skipSubprocessChecks option (MR-14)', async () => {
    const prev = process.env.RL_INSIDE_MCP;
    process.env.RL_INSIDE_MCP = '1';
    try {
      // With the env var set but NO explicit option, the subprocess check
      // should still attempt to run. We can't run the full spawn in this
      // unit test (no `dist/mcp.mjs` in the test environment necessarily),
      // but the detail must NOT match the "skipped" string the skip arm
      // returns. The actual probe will fail or pass for other reasons
      // (spawn / stdin / drain) — we only assert that the env var did not
      // silently short-circuit.
      const result = await runDoctor();
      const mcpCheck = result.checks.find((c) => c.name === 'mcp_stdout_purity');
      expect(mcpCheck?.detail).not.toBe('skipped (running inside MCP transport)');
    } finally {
      if (prev === undefined) delete process.env.RL_INSIDE_MCP;
      else process.env.RL_INSIDE_MCP = prev;
    }
  });

  test('runDoctor({ skipSubprocessChecks: true }) honors the explicit flag (MR-14)', async () => {
    const start = Date.now();
    const result = await runDoctor({ skipSubprocessChecks: true });
    const elapsed = Date.now() - start;
    const mcpCheck = result.checks.find((c) => c.name === 'mcp_stdout_purity');
    expect(mcpCheck?.detail).toBe('skipped (running inside MCP transport)');
    expect(elapsed).toBeLessThan(500);
  });

  // Phase 5 Wave 0 (Plan 05-01) — the RunDoctorOptions type extension
  // (offline / stress / sqlite) must compile + be accepted at the type
  // level WITHOUT altering the existing 5-check surface. runDoctor()'s body
  // is unchanged in Wave 0 (no new probes ship until Plan 05-06), so this is
  // a deliberately weak smoke test: it proves the wider options type does
  // not break the existing checks. Deeper assertions about each option's
  // effect land with the probes they gate.
  test('runDoctor accepts the Phase 5 options without affecting the existing 5-check surface', async () => {
    const result = await runDoctor({ offline: true, stress: false, skipSubprocessChecks: true });
    expect(result.checks).toHaveLength(5);
    expect(['pass', 'warn', 'fail']).toContain(result.overall);
  });
});
