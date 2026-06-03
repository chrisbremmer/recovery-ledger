// Child helper for tests/integration/auth-concurrency.test.ts.
//
// Spawned via child_process.fork(). Imports the compiled
// `createTokenStore` factory from `dist/infrastructure/whoop/token-store.mjs`
// (a top-level tsup entry added per checker WARNING PLAN-08-BUILD-DEP — see
// tsup.config.ts), constructs ONE tokenStore per child process, calls
// `getValidAccessToken()`, prints `{accessToken, storageMode}` as a single
// JSON line to stdout, exits 0.
//
// Phase 10 ARCH-02 (#85): the historical `export const tokenStore` module-
// load singleton is gone. Each forked child constructs its own
// `createTokenStore()` instance. The ADR-0002 cross-process file lock and
// atomic-write contract are unchanged — they live at the OS level
// (`proper-lockfile` + temp-and-rename), not in-process. The "exactly one
// WHOOP refresh across 10 children" assertion in the parent test still
// holds: the OS-level lock is the chokepoint, and the in-process Promise
// single-flight gate is per-process either way.
//
// Env injected by the parent test:
//   - WHOOP_TOKEN_URL                  parent mock HTTP server URL
//   - RECOVERY_LEDGER_HOME             shared tmpdir for all children
//   - RECOVERY_LEDGER_FORCE_FILE_STORE=1 force file backend on every OS (D-25)
//
// stdout is fine here — the child is NOT an MCP server (ADR-0001 scope is
// `src/`-reachable code, not test-harness helpers). The parent collects the
// stdout JSON line and asserts on it.
//
// stderr deliberately does NOT echo the error message verbatim — only
// `err.kind` is printed if the failure shape is an AuthError. The integration
// test asserts no token-material appears in stderr regardless; this is
// belt-and-suspenders.

import { createTokenStore } from '../../../dist/infrastructure/whoop/token-store.mjs';

async function main() {
  // Phase 10 ARCH-02: construct a fresh tokenStore per child (the OS
  // file lock + atomic write is the cross-process gate, not a shared
  // module-level singleton).
  const tokenStore = createTokenStore();
  try {
    const accessToken = await tokenStore.getValidAccessToken();
    const storageMode = await tokenStore.readStorageMode();
    // WR-09: await stdout drain via the write callback before exiting. On
    // macOS Node 22 with `silent: true` IPC pipes, `process.exit()` can fire
    // before the kernel drains the stdout pipe — the parent's `child.stdout
    // .on('data')` listener then receives an empty buffer and the test
    // flakes. The CLI shims (auth.ts, init.ts) follow the same pattern.
    process.stdout.write(
      `${JSON.stringify({ ok: true, accessToken, storageMode })}\n`,
      () => process.exit(0),
    );
  } catch (err) {
    const kind =
      err !== null && typeof err === 'object' && 'kind' in err ? String(err.kind) : 'unknown';
    process.stderr.write(`${JSON.stringify({ ok: false, kind })}\n`, () => process.exit(1));
  }
}

void main();
