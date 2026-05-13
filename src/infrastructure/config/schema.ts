// Canonical ConfigSchema + InitConfig type (D-01 / D-06 / D-13).
//
// SINGLE source of truth for the shape of `~/.recovery-ledger/config.json`.
// Plan 02-05's init.ts AND auth.ts will both
// `import { ConfigSchema, D13_SCOPES, type InitConfig } from
// '../../infrastructure/config/schema.js'` — no duplicate schema
// definitions, no drift surface (DRY-fix per checker WARNING
// PLAN-05-DRY-VIOLATION).
//
// Pure module: no side effects, no logger imports, no `process.env` reads.
// Pin the schema here so the validation contract is a single CODEOWNERS
// touch-point — any future change to the on-disk config shape lands in
// exactly one file and the test in schema.test.ts is the forcing function
// that catches regressions.
//
// D-13 scope set is exported as a frozen tuple. Both init.ts (prompts the
// user with these as the default) and auth.ts (passes them to
// buildAuthorizeUrl) consume D13_SCOPES verbatim.

import { z } from 'zod';

/**
 * The seven D-13 OAuth scopes Recovery Ledger requests at `init` time.
 * Frozen so a downstream caller cannot accidentally mutate the array.
 * The order is canonical — `offline` first per RFC 6749 § 6 (refresh
 * tokens), followed by the six read-* scopes in resource-id alphabetical
 * order. Pinning the order makes the diff at consent-time deterministic.
 */
export const D13_SCOPES = Object.freeze([
  'offline',
  'read:recovery',
  'read:sleep',
  'read:workout',
  'read:cycles',
  'read:profile',
  'read:body_measurement',
] as const);

/**
 * Canonical Zod schema for `~/.recovery-ledger/config.json`.
 *
 * `clientId` regex (T-02.01-07 mitigation): WHOOP client IDs are issued
 * from the URL-safe charset; rejecting anything else at parse time is
 * defense-in-depth against a hostile config.json that smuggles
 * URL-control bytes into the authorize URL. Plan 02-03's
 * buildAuthorizeUrl re-validates as a second layer.
 *
 * `redirectPort` is constrained to positive integers — D-01's default is
 * 4321 but any positive port is acceptable.
 *
 * `scopes` is constrained to a nonempty array; D-13's seven scopes are
 * the default but a power user could narrow to a subset.
 */
export const ConfigSchema = z.object({
  clientId: z.string().regex(/^[A-Za-z0-9._~-]+$/),
  clientSecret: z.string().min(1),
  redirectPort: z.number().int().positive(),
  scopes: z.array(z.string()).nonempty(),
});

export type InitConfig = z.infer<typeof ConfigSchema>;
