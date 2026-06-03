// <20-minute setup stopwatch (DOC-06) — the load-bearing forcing function
// for the Phase 5 success criterion: "a new clone reaches the first daily
// review in under 20 minutes."
//
// ENV GATE (D-13): this file is wrapped in `describe.skipIf(!RUN_STOPWATCH)`
// where RUN_STOPWATCH is `process.env.VITEST_INCLUDE_STOPWATCH === '1'`. The
// default `npm test` does NOT set the env var, so the describe block is
// SKIPPED and the default suite adds zero runtime. The dedicated
// `.github/workflows/setup-stopwatch.yml` workflow sets the env var and runs
// this file in isolation on a PR path filter.
//
// 20-MINUTE BUDGET (Specifics line 267): STOPWATCH_BUDGET_MS is a top-of-file
// const so a future tightening to 15 minutes edits exactly one line. The
// budget has ample headroom on macOS (typically 3-6 min); the assertion
// exists to catch a regression that crosses the boundary, not to measure a
// tight margin.
//
// ADR-0006 (fixture-only tests): NO real WHOOP traffic. An in-process MSW
// server composes the handlers from all 7 existing tests/helpers/msw-whoop-*
// helpers and intercepts every undici fetch. `listen({onUnhandledRequest:
// 'error'})` fails the test if any request escapes the mock.
//
// D-12 BOUNDARY (authoritative): the stopwatch wraps `npm install` (the
// dominant native-module-compile cost) + `npm run build` (tsup) + the WHOOP-
// touching steps (init, auth, sync, review daily). The clone-equivalent
// `cpSync` of the repo into a tmp dir is done BEFORE the stopwatch starts and
// is NOT counted — a real user clones once and the clone cost is not part of
// the "time to first review" friction the budget protects.
//
// D-14 REALISM TRADE-OFF (documented): MSW intercepts undici fetch IN-PROCESS
// only. A spawned child process does NOT inherit the interception. The CLI
// command shims (init/auth/sync/review-daily) each call `process.exit()`
// internally (init 4x, auth 5x, sync 8x, review-daily 4x), so invoking them
// in-process would terminate the vitest worker. Per the plan's Task 1 adapter
// note, the WHOOP-touching steps are exercised at the SERVICE layer instead:
//   - init  — write a valid config.json into RECOVERY_LEDGER_HOME (init's
//              only job; the env-var-precedence arm of runInitCommand writes
//              the same file shape via ConfigSchema).
//   - auth  — direct token exchange via `exchangeCode` against the MSW token
//              endpoint, then persist via `tokenStore.write`. This is the
//              researcher's recommended path: it drives a real HTTP POST
//              through the mock (honest to the OAuth flow) without standing up
//              a loopback callback server in-process.
//   - sync  — `bootstrap().services.runSync({...})` (opens the DB, runs the
//              migrator, fetches the MSW-mocked resource endpoints).
//   - review daily — `bootstrap().services.getDailyReview({})`. The result is
//              asserted on shape only (NOT content): an empty/insufficient
//              fixture set yields `confidence.tier === 'insufficient'`, which
//              is a typed positive output per ADR-0004 + Pitfall 5.
// The dominant cost (npm install + build, both real subprocesses in the tmp
// repo) is unchanged — that is what keeps the boundary honest to D-12.
// Service-layer invocation for the WHOOP steps adds seconds, not minutes, and
// is the only way MSW interception works.
//
// Gate B/C note: this file uses `process.stderr.write` for the timing
// diagnostic. stderr is the load-bearing escape hatch per ADR-0001; the grep
// gates exempt test files.

import { spawnSync } from 'node:child_process';
import { cpSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import { setupServer } from 'msw/node';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { createWhoopBodyMeasurementsHelper } from '../helpers/msw-whoop-body-measurements.js';
import { createWhoopCyclesHelper } from '../helpers/msw-whoop-cycles.js';
import { createWhoopOauthHelper } from '../helpers/msw-whoop-oauth.js';
import { createWhoopProfileHelper } from '../helpers/msw-whoop-profile.js';
import { createWhoopRecoveryHelper } from '../helpers/msw-whoop-recovery.js';
import { createWhoopSleepHelper } from '../helpers/msw-whoop-sleep.js';
import { createWhoopWorkoutsHelper } from '../helpers/msw-whoop-workouts.js';

// 20-minute budget. Single top-of-file const so a future tightening to 15min
// (Specifics line 267) edits exactly this line.
const STOPWATCH_BUDGET_MS = 20 * 60 * 1000;

// D-13 env gate. Default `npm test` leaves this unset → describe is skipped.
const RUN_STOPWATCH = process.env.VITEST_INCLUDE_STOPWATCH === '1';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const REPO_ROOT = resolve(HERE, '..', '..');

// 25-minute Vitest timeout — gives a meaningful "exceeded 20-min budget"
// assertion failure rather than a vague timeout if a regression overshoots.
const TEST_TIMEOUT_MS = 25 * 60 * 1000;

// The cpSync clone + npm install can exceed Vitest's default 10s hook/test
// budget; size the hook budget generously so the (untimed) clone in beforeAll
// never trips the hook timeout.
const HOOK_TIMEOUT_MS = 5 * 60 * 1000;

describe.skipIf(!RUN_STOPWATCH)('setup stopwatch — npm install to first review daily', () => {
  let tmpHome: string;
  let tmpRepo: string;
  let msw: ReturnType<typeof setupServer>;

  beforeAll(() => {
    tmpHome = mkdtempSync(join(tmpdir(), 'rl-stopwatch-home-'));
    tmpRepo = mkdtempSync(join(tmpdir(), 'rl-stopwatch-repo-'));

    // Compose ONE MSW server from all 7 existing helpers (zero new handlers
    // per D-11). Each helper builds its own single-handler `setupServer`; we
    // lift the handlers out via `listHandlers()` and merge them into one
    // server so a single `listen()` covers the OAuth token endpoint plus the
    // six WHOOP resource endpoints.
    const helpers = [
      createWhoopOauthHelper(),
      createWhoopProfileHelper(),
      createWhoopBodyMeasurementsHelper(),
      createWhoopCyclesHelper(),
      createWhoopRecoveryHelper(),
      createWhoopSleepHelper(),
      createWhoopWorkoutsHelper(),
    ];
    const handlers = helpers.flatMap((h) => h.server.listHandlers());
    msw = setupServer(...handlers);
    msw.listen({ onUnhandledRequest: 'error' });

    // RECOVERY_LEDGER_HOME relocates the entire home dir so the user's real
    // ~/.recovery-ledger/ is never touched. WHOOP_CLIENT_ID/SECRET drive the
    // env-var-precedence arm so `init` is non-interactive (Phase 2 D-06).
    process.env.RECOVERY_LEDGER_HOME = tmpHome;
    process.env.WHOOP_CLIENT_ID = 'test_client';
    process.env.WHOOP_CLIENT_SECRET = 'test_secret';

    // Clone-equivalent copy of the live src tree into tmpRepo. NOT timed
    // (D-12): a real user clones once and the clone cost is not part of the
    // time-to-first-review friction. Exclude node_modules, dist, .git, and
    // coverage so the copy is fast and the subsequent `npm install` builds the
    // dependency tree from scratch (the dominant, honest cost).
    cpSync(REPO_ROOT, tmpRepo, {
      recursive: true,
      filter: (src) =>
        !src.includes(`${REPO_ROOT}/node_modules`) &&
        !src.includes(`${REPO_ROOT}/dist`) &&
        !src.includes(`${REPO_ROOT}/.git`) &&
        !src.includes(`${REPO_ROOT}/coverage`),
    });
  }, HOOK_TIMEOUT_MS);

  afterAll(() => {
    msw?.close();
    try {
      rmSync(tmpHome, { recursive: true, force: true });
    } catch {
      // best-effort cleanup
    }
    try {
      rmSync(tmpRepo, { recursive: true, force: true });
    } catch {
      // best-effort cleanup
    }
    delete process.env.RECOVERY_LEDGER_HOME;
    delete process.env.WHOOP_CLIENT_ID;
    delete process.env.WHOOP_CLIENT_SECRET;
  });

  test(
    'completes under 20 minutes',
    async () => {
      const start = performance.now();

      // STOPWATCH START.

      // Step 1: npm install in the cloned repo (dominant cost — native-module
      // compile of better-sqlite3 + @napi-rs/keyring).
      const installResult = spawnSync('npm', ['install', '--silent'], {
        cwd: tmpRepo,
        stdio: 'pipe',
        encoding: 'utf8',
      });
      expect(installResult.status, `npm install failed:\n${installResult.stderr}`).toBe(0);

      // Step 2: npm run build (tsup → dist/).
      const buildResult = spawnSync('npm', ['run', 'build', '--silent'], {
        cwd: tmpRepo,
        stdio: 'pipe',
        encoding: 'utf8',
      });
      expect(buildResult.status, `npm run build failed:\n${buildResult.stderr}`).toBe(0);

      // Steps 3-6 run IN-PROCESS so the MSW server intercepts every fetch
      // (D-14 realism trade). The imports below resolve the live `src/`
      // modules (the same code the just-built dist/ bundles) — MSW shares the
      // parent worker's undici-fetch global interceptor with them.

      // Step 3 (init): write a valid config.json into RECOVERY_LEDGER_HOME.
      // This is init's only job; the env-var-precedence arm of runInitCommand
      // writes this same file shape via ConfigSchema. We write it directly to
      // avoid runInitCommand's internal process.exit().
      const { mkdir, writeFile } = await import('node:fs/promises');
      const { ConfigSchema, D13_SCOPES } = await import(
        '../../src/infrastructure/config/schema.js'
      );
      const config = ConfigSchema.parse({
        clientId: process.env.WHOOP_CLIENT_ID,
        clientSecret: process.env.WHOOP_CLIENT_SECRET,
        redirectPort: 4321,
        scopes: Array.from(D13_SCOPES),
      });
      await mkdir(tmpHome, { recursive: true, mode: 0o700 });
      await writeFile(join(tmpHome, 'config.json'), `${JSON.stringify(config, null, 2)}\n`, {
        mode: 0o600,
      });

      // Step 4 (auth): direct token exchange via the MSW token endpoint, then
      // persist via tokenStore.write. exchangeCode POSTs to WHOOP_TOKEN_URL
      // (the oauth helper mocks the production URL); the token-200 fixture's
      // expires_in (3600s) puts expiresAt ~1h out, so the subsequent sync's
      // getValidAccessToken returns the stored token WITHOUT a refresh.
      const { exchangeCode } = await import('../../src/infrastructure/whoop/oauth.js');
      // Phase 10 ARCH-02 (#85): the module-load `tokenStore` singleton is
      // gone; this stopwatch step constructs its own instance because it
      // runs BEFORE bootstrap (mirroring the CLI auth.ts flow exactly —
      // see ADR-0002 §Enforcement and the OAuth-login exception).
      const { createTokenStore } = await import('../../src/infrastructure/whoop/token-store.js');
      const tokenStore = createTokenStore();
      const tokens = await exchangeCode({
        code: 'test_auth_code',
        redirectUri: `http://127.0.0.1:${config.redirectPort}/callback`,
        clientId: config.clientId,
        clientSecret: config.clientSecret,
      });
      await tokenStore.write(tokens);

      // Step 5 (sync) + Step 6 (review daily): bootstrap opens the DB, runs the
      // migrator, wires repos + resource modules, and returns the services map.
      const { bootstrap } = await import('../../src/services/index.js');
      const { services, close } = bootstrap();
      try {
        // Small window — the fixtures are a single page per resource; a small
        // --days keeps the window tight while still exercising all six
        // resource fetches through MSW.
        const syncResult = await services.runSync({ days: 7 });
        expect(['ok', 'partial', 'failed']).toContain(syncResult.status);

        // Pitfall 5: assert SHAPE only, never content. An empty/insufficient
        // fixture set yields a typed `data_status` block (ADR-0004 positive
        // output); the daily review resolves rather than throwing.
        const review = await services.getDailyReview({});
        expect(review).toBeDefined();
        expect(review).toHaveProperty('data_status');
        expect(review).toHaveProperty('confidence');
      } finally {
        close();
      }

      // STOPWATCH END.
      const elapsed = performance.now() - start;
      process.stderr.write(
        `Stopwatch elapsed: ${Math.round(elapsed / 1000)}s (budget ${STOPWATCH_BUDGET_MS / 1000}s)\n`,
      );
      expect(elapsed).toBeLessThan(STOPWATCH_BUDGET_MS);
    },
    TEST_TIMEOUT_MS,
  );
});
