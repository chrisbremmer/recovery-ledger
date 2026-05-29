// `db_schema_version` doctor probe — the migration-drift signal (Plan 05-03,
// D-02 #4).
//
// Phase 3's hand-rolled migrator (src/infrastructure/db/migrate.ts) records
// one row per applied migration in the `__drizzle_migrations` table
// (id, hash, created_at — line 139-140). This probe compares that row count
// against the number of `.sql` files committed under
// src/infrastructure/db/migrations/. The three outcomes:
//
//   - dbCount === fileCount → pass: schema is at the expected version.
//   - dbCount  <  fileCount → fail: a pending migration was never applied
//       (or the DB was rolled back). Phase 3 D-06/D-07/D-08 keep the migrator
//       fails-closed and NEVER auto-restore — so the probe SURFACES the
//       remediation (the most-recent pre-migration backup under
//       paths.backupsDir) but does NOT execute it.
//   - dbCount  >  fileCount → fail: an orphaned migration record (a row with
//       no corresponding .sql file). The detail carries the
//       `db_schema_version` troubleshooting anchor (Plan 05-09 H2).
//
// The literal `__drizzle_migrations` is the source of truth and must match
// src/infrastructure/db/migrate.ts. The probe COUNTS only top-level `.sql`
// files — not the `meta/` journal, not recursively.
//
// ADR-0001 (CLAUDE.md §Critical Rules): no console calls, no stdout writes.
// Gate G: raw better-sqlite3 prepare()/get() for the COUNT query — mirrors
// migrate.ts:169 + 262 — no `drizzle-orm` import in the services layer.

import { readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type Database from 'better-sqlite3';
import { paths } from '../../../infrastructure/config/paths.js';
import type { DoctorCheck } from '../index.js';
import { CHECK_NAMES } from './check-names.js';

export interface DbSchemaVersionProbeDeps {
  /** Override for the DB handle. Production callers receive a handle from the
   *  bootstrap composition root via the dep-injection seam. */
  sqlite?: Database.Database;
  /** Override for the migrations directory. Test-only seam; production callers
   *  leave this undefined and the resolved package-relative path is used. */
  migrationsDir?: string;
}

// Mirror the path resolution bootstrap.ts uses for the migrator. The relative
// depth from src/services/doctor/checks/db-schema-version.ts down to
// src/infrastructure/db/migrations/ is `../../../infrastructure/db/migrations`;
// this holds in dev (tsx + vitest read src/) AND in built dist/ where the
// same relative layout is emitted.
function resolveDefaultMigrationsDir(): string {
  return resolve(
    dirname(fileURLToPath(import.meta.url)),
    '..',
    '..',
    '..',
    'infrastructure',
    'db',
    'migrations',
  );
}

// Most-recent pre-migration backup under paths.backupsDir, or null when the
// directory is absent / empty. Lexicographic sort works because the migrator
// names backups with a sortable timestamp prefix.
function findLatestBackup(): string | null {
  try {
    const files = readdirSync(paths.backupsDir)
      .filter((f) => f.endsWith('.sqlite'))
      .sort()
      .reverse();
    return files[0] ? resolve(paths.backupsDir, files[0]) : null;
  } catch {
    return null;
  }
}

export async function probeDbSchemaVersion(
  deps?: DbSchemaVersionProbeDeps,
): Promise<DoctorCheck> {
  if (!deps?.sqlite) {
    return {
      name: CHECK_NAMES.DB_SCHEMA_VERSION,
      status: 'fail',
      detail: 'no DB handle injected — run from CLI to exercise db checks',
    };
  }
  try {
    const dir = deps.migrationsDir ?? resolveDefaultMigrationsDir();
    const fileCount = readdirSync(dir).filter((f) => f.endsWith('.sql')).length;
    const row = deps.sqlite
      .prepare('SELECT COUNT(*) AS c FROM __drizzle_migrations')
      .get() as { c: number } | undefined;
    const dbCount = row?.c ?? 0;

    if (dbCount === fileCount) {
      return {
        name: CHECK_NAMES.DB_SCHEMA_VERSION,
        status: 'pass',
        detail: `schema at migration ${dbCount}/${fileCount}`,
      };
    }
    if (dbCount < fileCount) {
      const backup = findLatestBackup();
      const hint = backup ? `restore from ${backup}: cp ${backup} ${paths.dbFile}` : '(no backup found)';
      return {
        name: CHECK_NAMES.DB_SCHEMA_VERSION,
        status: 'fail',
        detail: `schema at migration ${dbCount}/${fileCount} — ${hint}`,
      };
    }
    return {
      name: CHECK_NAMES.DB_SCHEMA_VERSION,
      status: 'fail',
      detail: `schema at migration ${dbCount}/${fileCount} — extra rows in __drizzle_migrations (orphaned migration record); see docs/install/troubleshooting.md#db_schema_version`,
    };
  } catch (err) {
    return {
      name: CHECK_NAMES.DB_SCHEMA_VERSION,
      status: 'fail',
      detail: `probe threw: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}
