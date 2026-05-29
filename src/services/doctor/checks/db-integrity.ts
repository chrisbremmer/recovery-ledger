// `db_integrity` doctor probe — the corruption signal (Plan 05-03, D-02 #3).
//
// SQLite's built-in `PRAGMA integrity_check` is the canonical, authoritative
// way to detect a damaged database file: a sound DB returns exactly one row
// `{integrity_check: 'ok'}`; a corrupt one emits one or more error rows on the
// same pragma. Per RESEARCH §Don't Hand-Roll we use the built-in rather than
// any bespoke page-walk — it is the documented, exhaustive check and the only
// one that stays correct across SQLite versions.
//
// The probe consumes the injected handle from db_open (Plan 05-06 threads the
// bootstrap-constructed handle via `RunDoctorOptions.sqlite`). Absent a handle
// it fails with a structured detail rather than opening its own connection.
//
// ADR-0001 (CLAUDE.md §Critical Rules): no console calls, no direct stdout
// writes. Gate G: raw better-sqlite3 `pragma()` only — no `drizzle-orm`
// import (read-only, integrity-check is not expressible in the Drizzle DSL).

import type Database from 'better-sqlite3';
import type { DoctorCheck } from '../index.js';
import { CHECK_NAMES } from './check-names.js';

export interface DbIntegrityProbeDeps {
  /** Override for the DB handle. Production callers receive a handle from
   *  the bootstrap composition root via the dep-injection seam. */
  sqlite?: Database.Database;
}

export async function probeDbIntegrity(deps?: DbIntegrityProbeDeps): Promise<DoctorCheck> {
  if (!deps?.sqlite) {
    return {
      name: CHECK_NAMES.DB_INTEGRITY,
      status: 'fail',
      detail: 'no DB handle injected — run from CLI to exercise db checks',
    };
  }
  try {
    const rows = deps.sqlite.pragma('integrity_check') as Array<{ integrity_check: string }>;
    if (rows.length === 1 && rows[0]?.integrity_check === 'ok') {
      return { name: CHECK_NAMES.DB_INTEGRITY, status: 'pass', detail: 'PRAGMA integrity_check ok' };
    }
    return {
      name: CHECK_NAMES.DB_INTEGRITY,
      status: 'fail',
      detail: `PRAGMA integrity_check returned ${rows.length} row(s); first: ${rows[0]?.integrity_check ?? '(empty)'}`,
    };
  } catch (err) {
    return {
      name: CHECK_NAMES.DB_INTEGRITY,
      status: 'fail',
      detail: `probe threw: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}
