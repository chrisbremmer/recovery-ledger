import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    pool: 'forks',
    // `scripts/**/*.test.ts` covers the build-tool unit tests (e.g. the
    // api-gap markdown generator's render-function tests, Plan 05-07). They
    // are pure + offline, so they belong in the default suite; without this
    // glob Vitest 4's positional file filter intersects with `include` and
    // silently finds zero tests for a `scripts/` path.
    include: ['src/**/*.test.ts', 'tests/**/*.test.ts', 'scripts/**/*.test.ts'],
    // MR-09: enforce ADR-0006 (fixture-only tests). The setup file throws
    // if VITEST_LIVE_WHOOP=1 is leaked into a default run that is not
    // explicitly scoped to tests/live/. The Phase 2 WHOOP HTTP client tests
    // depend on this precondition before they land.
    setupFiles: ['tests/setup/no-live-whoop.ts'],
    testTimeout: 10_000,
    hookTimeout: 10_000,
    passWithNoTests: true,
  },
});
