// `db_wal_size` doctor probe — the unbounded-WAL signal (Plan 05-03, D-02 #5;
// RESEARCH §Pitfall §12).
//
// SQLite WAL mode writes go to a `<dbFile>-wal` companion file that is folded
// back into the main DB at each checkpoint. If checkpoints lag (a long-lived
// reader holding the WAL open, or `wal_autocheckpoint` not firing), the WAL
// can grow without bound. Phase 3 D-30 caps it with
// `journal_size_limit = 67108864` (= 64 MiB) at
// src/infrastructure/db/connection.ts:77; this probe reports how close the WAL
// is to that ceiling.
//
// Thresholds are file-level consts so they are easy to find and keep in lock-
// step with the Phase 3 D-30 cap:
//   - size <= 32 MiB → pass
//   - 32 MiB < size <= 64 MiB → warn (checkpoint lagging)
//   - size > 64 MiB → fail (over the journal_size_limit cap)
// A missing `-wal` file means no WAL writes since the last checkpoint — a
// healthy pass, not a fail.
//
// The read is `statSync` (inode metadata only — O(1) regardless of WAL size),
// matching Phase 3's existing fs-stat patterns. ADR-0001 (CLAUDE.md §Critical
// Rules): no console calls, no stdout writes. No `drizzle-orm` import, and no
// network calls — this is a pure local-filesystem read.

import { statSync } from 'node:fs';
import { paths } from '../../../infrastructure/config/paths.js';
import type { DoctorCheck } from '../index.js';
import { CHECK_NAMES } from './check-names.js';

const WAL_WARN_BYTES = 32 * 1024 * 1024; // 32 MiB
const WAL_FAIL_BYTES = 64 * 1024 * 1024; // 64 MiB (matches journal_size_limit = 67108864)

export interface DbWalSizeProbeDeps {
  /** Override for the on-disk DB path. Test-only seam; production callers
   *  leave this undefined and `paths.dbFile` is used. The probe reads the
   *  `<dbFile>-wal` companion of this path. */
  dbFile?: string;
}

export async function probeDbWalSize(deps?: DbWalSizeProbeDeps): Promise<DoctorCheck> {
  try {
    const walPath = `${deps?.dbFile ?? paths.dbFile}-wal`;
    const stat = statSync(walPath, { throwIfNoEntry: false });
    if (stat === undefined) {
      return {
        name: CHECK_NAMES.DB_WAL_SIZE,
        status: 'pass',
        detail: 'no -wal file (no WAL writes since last checkpoint)',
      };
    }
    const sizeMB = Math.round(stat.size / 1024 / 1024);
    if (stat.size <= WAL_WARN_BYTES) {
      return {
        name: CHECK_NAMES.DB_WAL_SIZE,
        status: 'pass',
        detail: `WAL ${Math.round(stat.size / 1024)}KB (<32MB threshold)`,
      };
    }
    if (stat.size <= WAL_FAIL_BYTES) {
      return {
        name: CHECK_NAMES.DB_WAL_SIZE,
        status: 'warn',
        detail: `WAL ${sizeMB}MB (>32MB; checkpoint is lagging)`,
      };
    }
    return {
      name: CHECK_NAMES.DB_WAL_SIZE,
      status: 'fail',
      detail: `WAL ${sizeMB}MB exceeds journal_size_limit=64MB; run \`recovery-ledger sync\` to force a wal_checkpoint(TRUNCATE)`,
    };
  } catch (err) {
    return {
      name: CHECK_NAMES.DB_WAL_SIZE,
      status: 'fail',
      detail: `wal size probe threw: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}
