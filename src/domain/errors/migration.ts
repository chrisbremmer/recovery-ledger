// MigrationError — typed failure shape from the hand-rolled SQLite
// migrator (src/infrastructure/db/migrate.ts). Lives in the domain layer
// per #18 so formatters + cli command shims can `import type` against the
// error contract without reaching across the lite-hexagonal boundary into
// `src/infrastructure/`. The migrator itself re-exports these symbols
// verbatim so the existing `import { MigrationError } from '.../db/migrate.js'`
// continues to work — domain is the new source of truth, infrastructure
// is the re-export layer for historical-import compatibility.

export const MIGRATION_ERROR_KINDS = [
  // Schema state disagrees with __drizzle_migrations (orphaned rows,
  // broken hash chain). D-08 surfaces this with the most-recent backup
  // path so the user can restore manually if needed.
  'inconsistent_state',
  // Journal entry references a tag whose `.sql` payload is missing on
  // disk. Distinct from inconsistent_state so the remediation message
  // can tell the user "DB is fine, restore the missing file" instead
  // of "DB state is ambiguous, restore from backup."
  'journal_missing_payload',
  // BEGIN IMMEDIATE → exec(sql) threw → ROLLBACK. WAL recovery on next
  // open is consistent with __drizzle_migrations.
  'apply_failed',
] as const;

export type MigrationErrorKind = (typeof MIGRATION_ERROR_KINDS)[number];

const MIGRATION_ERROR_KINDS_SET: ReadonlySet<string> = new Set(MIGRATION_ERROR_KINDS);

export interface MigrationErrorInit {
  kind: MigrationErrorKind;
  /** Absolute path to the pre-migration backup (or null when no backup was
   *  taken — first-ever migration on an empty $HOME, or `:memory:` DB). */
  backupPath: string | null;
  /** Tag of the most-recent migration that completed cleanly before this
   *  one threw; null when the failure is at startup before any apply. */
  latestSafeMigration: string | null;
  /** Short human-readable detail; surfaces into the Error message. */
  detail?: string;
  /** Original cause; preserved through the ES2022 Error `cause` option so
   *  the sanitize.ts walker can traverse it. Mirrors AuthError. */
  cause?: unknown;
}

export class MigrationError extends Error {
  readonly kind: MigrationErrorKind;
  readonly backupPath: string | null;
  readonly latestSafeMigration: string | null;
  readonly detail?: string;

  constructor(init: MigrationErrorInit) {
    // Same conditional-spread shape as AuthError: only pass the second arg
    // when cause is defined so we do not synthesize a `{ cause: undefined }`
    // literal that diverges from the AuthError carrier shape.
    super(init.detail ?? init.kind, init.cause === undefined ? undefined : { cause: init.cause });
    this.kind = init.kind;
    this.backupPath = init.backupPath;
    this.latestSafeMigration = init.latestSafeMigration;
    if (init.detail !== undefined) {
      this.detail = init.detail;
    }
    this.name = 'MigrationError';
  }
}

/**
 * Duck-type guard for MigrationError. `instanceof MigrationError` is
 * unreliable under `vi.resetModules()` (two module-graph copies of this
 * file produce different class identities for the same logical type).
 * The guard checks `name === 'MigrationError'` plus `kind` membership in
 * the tuple, so a structurally-equivalent error from a different module-
 * graph copy still narrows correctly.
 */
export function isMigrationError(err: unknown): err is MigrationError {
  if (typeof err !== 'object' || err === null) return false;
  const e = err as { name?: unknown; kind?: unknown };
  return (
    e.name === 'MigrationError' &&
    typeof e.kind === 'string' &&
    MIGRATION_ERROR_KINDS_SET.has(e.kind)
  );
}
