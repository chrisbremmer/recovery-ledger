// Child helper for tests/integration/auth-concurrency.test.ts.
//
// Spawned via child_process.fork(). Imports the compiled `tokenStore` from
// `dist/infrastructure/whoop/token-store.mjs` (a top-level tsup entry added
// per checker WARNING PLAN-08-BUILD-DEP — see tsup.config.ts), calls
// `getValidAccessToken()`, prints `{accessToken, storageMode}` as a single
// JSON line to stdout, exits 0.
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

import { tokenStore } from '../../../dist/infrastructure/whoop/token-store.mjs';

async function main() {
  try {
    const accessToken = await tokenStore.getValidAccessToken();
    const storageMode = await tokenStore.readStorageMode();
    process.stdout.write(`${JSON.stringify({ ok: true, accessToken, storageMode })}\n`);
    process.exit(0);
  } catch (err) {
    const kind =
      err !== null && typeof err === 'object' && 'kind' in err
        ? String(err.kind)
        : 'unknown';
    process.stderr.write(`${JSON.stringify({ ok: false, kind })}\n`);
    process.exit(1);
  }
}

void main();
