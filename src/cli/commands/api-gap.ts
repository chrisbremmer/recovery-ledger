// CLI `api-gap` command shim (Plan 04-11 Task 1; D-28 anchor).
//
// Lists WHOOP consumer-app features unavailable via v2 API. The simplest
// of the Wave 4 CLI shims — getApiGap() has no DB write path; the catalog
// is an in-source constant. The only failure arm is bootstrap (the DB
// must still open because every Bootstrapped surface goes through the
// same composition root).
//
// ADR-0001: this file lives under src/cli/commands/, so Gate B/C exempt
// it from the console.* / process.stdout.write prohibitions.

import { renderApiGap } from '../../formatters/api-gap.txt.js';
// ARCH-05 (#93): shared bootstrap-error rendering.
import { tryBootstrap } from '../lib/with-bootstrap.js';

export const API_GAP_EXIT_CODES: Readonly<Record<string, number>> = Object.freeze({
  ok: 0,
  bootstrap_failed: 1,
});

/**
 * The ≤5-line shim — bootstrap, getApiGap, format, write, exit. No
 * service-throw catch arm: getApiGap reads an in-source constant + has
 * no DB or HTTP dependency. If bootstrap succeeds, the render succeeds.
 */
export async function runApiGapCommand(): Promise<void> {
  const boot = tryBootstrap(API_GAP_EXIT_CODES.bootstrap_failed ?? 1);
  if (!boot.ok) {
    process.stdout.write(`${boot.body}\n`, () => {
      process.exit(boot.exitCode);
    });
    return;
  }
  const app = boot.app;
  const result = await app.services.getApiGap();
  const body = renderApiGap(result);
  process.stdout.write(`${body}\n`, () => {
    app.close();
    process.exit(API_GAP_EXIT_CODES.ok);
  });
}
