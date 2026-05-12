# 0006. Tests never call WHOOP for real

- **Status:** Accepted
- **Date:** 2026-05-12
- **Decider(s):** CB

## Context

The test suite needs to verify HTTP behaviour: pagination, 401 →
refresh → retry, 429 backoff, schema parsing, score-state handling.
There are two ways to do that:

1. **Live API.** Run tests against the real WHOOP endpoint with a
   service-account token.
2. **Recorded fixtures.** Capture real responses once, replay via MSW
   against a `fetch` interceptor.

Live testing is tempting (it catches API drift the moment it happens)
but has fatal practical problems for this project:

- WHOOP rate-limits the developer account. A CI run that hits the
  live API competes with the user's own usage.
- Test data is non-deterministic — the most recent cycle is whatever
  the user did last night.
- The user is the only "test account." There is no fixture user.
- Refresh-token rotation
  ([`ADR-0002`](./0002-single-flight-oauth-refresh.md)) means a CI run
  that fails mid-suite can leave the local environment without
  valid credentials.

## Decision

**The default test run is fixture-only.** MSW 2 intercepts `fetch` and
serves responses from
`tests/fixtures/whoop/<resource>/<scenario>.json`. Fixtures are
committed.

Live API calls are gated behind an explicit env var
(`VITEST_LIVE_WHOOP=1`) and:

- Are not part of the default `vitest run`.
- Are not part of CI.
- Run only in named files (e.g.,
  `tests/live/<resource>.live.test.ts`) so they can't be picked up
  by mistake.
- Skip with a clear message when the env var is absent.

Every WHOOP resource has at least one **contract test** that:

1. Loads a recorded fixture into MSW.
2. Runs the service path that consumes it.
3. Asserts the resulting SQLite rows match expectation.
4. Re-parses the fixture with the current Zod schema to catch drift
   between the recorded shape and the code's expectation.

## Consequences

- CI is fast, deterministic, offline-runnable.
- API drift is caught by the Zod re-parse step inside the contract
  test, not by talking to WHOOP. When WHOOP changes a shape, the
  developer re-records the fixture against the new shape.
- The default `vitest run` has zero outbound network calls. A failing
  request is a test setup bug, never an API outage.

## Alternatives considered

- **Recording proxy in CI.** Rejected: complicates CI setup, doesn't
  solve the rate-limit problem, and the cassette format adds another
  thing to maintain.
- **Mock library (`vi.mock`, `nock`).** Rejected: MSW is the most
  faithful to real `fetch` semantics; we want tests to exercise the
  same Request/Response objects the production code sees.

## Enforcement

- Vitest config `pool: 'forks'` and no global `fetch` polyfill —
  MSW is the only thing answering.
- A `tests/setup/no-live-whoop.ts` setup file asserts the
  `VITEST_LIVE_WHOOP` flag is absent unless the test file is under
  `tests/live/`.
- CI job runs `vitest run` without the env var; the build fails if a
  test reaches the network.

## Cross-references

- [`../conventions.md` § Testing](../conventions.md#testing)
- [`0002-single-flight-oauth-refresh.md`](./0002-single-flight-oauth-refresh.md)
- [`../../.planning/research/STACK.md`](../../.planning/research/STACK.md)
  — MSW + Vitest versions
