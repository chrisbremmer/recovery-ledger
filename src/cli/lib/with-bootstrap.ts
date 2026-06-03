// ARCH-05 (#93): shared bootstrap-error rendering for CLI command shims.
//
// Pre-ARCH-05 each of the 8 CLI shims duplicated ~10 lines of identical
// bootstrap-failure handling (try { bootstrap() } catch { isMigrationError
// ? formatBootstrapError : sanitize(String(err)) ; write ; exit}). Adding
// a new bootstrap-failure mode required editing 8 files; the "transport
// must not import from infrastructure" boundary eroded through these
// duplicated infra imports.
//
// `tryBootstrap(bootstrapFailedExitCode)` runs bootstrap() and returns
// either the live `Bootstrapped` or a rendered error body + exit code the
// shim can route through its existing stdout-write + exit() flow. The
// helper does NOT call process.exit itself: control flow stays in the
// shim, mirroring the rest of the shim's exit-on-write pattern.
//
// ADR-0001 compliance: this file does not write to stdout/stderr; the
// caller still owns the single stdout write call.

import { isMigrationError } from '../../domain/errors/migration.js';
import { sanitize } from '../../domain/observability/sanitize.js';
import { formatBootstrapError } from '../../formatters/sync.txt.js';
import { paths } from '../../infrastructure/config/paths.js';
import { type Bootstrapped, bootstrap } from '../../services/index.js';

export type TryBootstrapResult =
  | { ok: true; app: Bootstrapped }
  | { ok: false; body: string; exitCode: number };

/**
 * Run `bootstrap()` and return either the live app or a rendered error
 * body + exit code. The shim wires `body` into a `process.stdout.write`
 * callback and calls `process.exit(exitCode)`. On `MigrationError` the
 * body carries the `cp <backupPath>` remediation; on any other throw
 * the body is `Bootstrap failed: ${sanitize(String(err))}` with the
 * standard sanitize gate.
 */
export function tryBootstrap(bootstrapFailedExitCode: number): TryBootstrapResult {
  try {
    const app = bootstrap();
    return { ok: true, app };
  } catch (err) {
    const body = isMigrationError(err)
      ? formatBootstrapError(err, paths.dbFile)
      : `Bootstrap failed: ${sanitize(String(err))}`;
    return { ok: false, body, exitCode: bootstrapFailedExitCode };
  }
}
