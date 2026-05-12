// ADR-0006 enforcement (MR-09).
//
// Tests must never call the live WHOOP API in the default `vitest run`.
// MSW-served fixtures are the canonical surface; live tests are gated
// behind `VITEST_LIVE_WHOOP=1` AND must live under `tests/live/`.
//
// This setup file runs once per test worker (Vitest `setupFiles`). It
// asserts at process start that:
//   1. `VITEST_LIVE_WHOOP` is unset (the default `vitest run` shape), OR
//   2. `VITEST_LIVE_WHOOP=1` AND the current vitest run is configured to
//      include tests under `tests/live/` (operator opt-in).
//
// If `VITEST_LIVE_WHOOP=1` is set in the environment for a run that is
// NOT explicitly targeting `tests/live/`, the setup throws — this catches
// the failure mode where a developer leaves the env var set in their
// shell and accidentally points the default suite at the live WHOOP API.
//
// Phase 1 has no `tests/live/` directory yet; Phase 2 will add it
// alongside the WHOOP HTTP client. The exact opt-in shape is documented
// in ADR-0006 § Enforcement.

const FLAG = 'VITEST_LIVE_WHOOP';

if (process.env[FLAG] !== undefined && process.env[FLAG] !== '') {
  // Live mode is opt-in. The only sanctioned shape is `VITEST_LIVE_WHOOP=1`
  // AND a vitest invocation that limits the run to files under
  // `tests/live/` (typically `vitest run tests/live/...`). The CLI argv
  // is inspected for an explicit `tests/live` token because Vitest does
  // not expose the resolved include glob to setupFiles.
  const argv = process.argv.join(' ');
  const targetsLive = argv.includes('tests/live') || argv.includes('tests\\live');
  if (!targetsLive) {
    throw new Error(
      [
        `[ADR-0006] VITEST_LIVE_WHOOP=${process.env[FLAG]} is set but the run is`,
        'not scoped to tests/live/. The default test suite must never call the',
        'live WHOOP API. Either unset VITEST_LIVE_WHOOP or invoke vitest with',
        'an explicit `tests/live/...` filter. See agent_docs/decisions/',
        '0006-fixture-only-tests.md.',
      ].join(' '),
    );
  }
}
