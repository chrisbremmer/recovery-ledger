// `db_open` doctor probe — the loud "DB layer is alive" signal (Plan 05-03,
// D-02 #2). It precedes every other db_* check: if the injected handle does
// not respond to a no-op pragma, the corruption / schema / WAL probes have
// nothing meaningful to report.
//
// Phase 3 D-30 establishes the six load-bearing pragmas at the
// `src/infrastructure/db/connection.ts:openDb()` chokepoint (journal_mode=WAL
// first). This probe does NOT open its own connection — per RESEARCH §Open
// Questions §1 the bootstrap composition root (Plan 05-06) constructs the
// production handle and threads it through `RunDoctorOptions.sqlite`. Absent
// an injected handle the probe returns a structured fail so a CLI-only run
// surfaces the gap instead of silently green-checking.
//
// `journal_mode` is the probe's no-op pragma proxy: reading it touches the
// better-sqlite3 binding + the open SQLite connection without mutating state.
// A WAL result confirms the D-30 pragma block ran; a non-WAL result (e.g.
// `:memory:` reports `memory`) is still a live handle, so the probe passes
// with the observed mode rather than failing — db_integrity is the corruption
// check, db_open is only the "handle is alive" signal.
//
// ADR-0001 (CLAUDE.md §Critical Rules): no console calls, no direct stdout
// writes from this module — structured DoctorCheck results only.
//
// Gate G: this probe uses the raw better-sqlite3 handle via `pragma()`, NOT
// the Drizzle query builder. No `drizzle-orm` import — consistent with
// native-modules.ts, which also bypasses Drizzle for native-level probes.

import type Database from 'better-sqlite3';
import type { DoctorCheck } from '../index.js';
import { CHECK_NAMES } from './check-names.js';

export interface DbOpenProbeDeps {
  /** Override for the DB handle. Production callers receive a handle from the
   *  bootstrap composition root via the dep-injection seam; absent the seam
   *  the probe fails with a "no DB handle injected" detail. */
  sqlite?: Database.Database;
}

export async function probeDbOpen(deps?: DbOpenProbeDeps): Promise<DoctorCheck> {
  if (!deps?.sqlite) {
    return {
      name: CHECK_NAMES.DB_OPEN,
      status: 'fail',
      detail: 'no DB handle injected — run from CLI to exercise db checks',
    };
  }
  try {
    const rows = deps.sqlite.pragma('journal_mode') as Array<{ journal_mode?: string }>;
    if (rows.length === 1 && rows[0]?.journal_mode?.toLowerCase() === 'wal') {
      return {
        name: CHECK_NAMES.DB_OPEN,
        status: 'pass',
        detail: 'WAL journal mode confirmed',
      };
    }
    return {
      name: CHECK_NAMES.DB_OPEN,
      status: 'pass',
      detail: `DB open, journal_mode=${rows[0]?.journal_mode ?? 'unknown'}`,
    };
  } catch (err) {
    return {
      name: CHECK_NAMES.DB_OPEN,
      status: 'fail',
      detail: `pragma probe threw: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}
