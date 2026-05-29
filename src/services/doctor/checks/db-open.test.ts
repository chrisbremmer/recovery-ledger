// Unit coverage for the `db_open` doctor probe (Plan 05-03, D-02 #2).
//
// The probe is the "DB layer is alive" signal: it reads `journal_mode` as a
// no-op pragma against an injected better-sqlite3 handle. Tests use the
// `createInMemoryDb()` helper (ADR-0006 — no real WHOOP calls; these are
// DB-only checks so the constraint is naturally satisfied) for the live-handle
// case, and a hand-rolled throwing stub for the error path.
//
// Note: an in-memory DB reports `journal_mode=memory` (WAL is unsupported for
// `:memory:` — see connection.ts), so the pass-case assertion accepts either
// the WAL detail or the observed journal_mode rather than pinning a single
// string. The production handle from openDb() is WAL.

import type Database from 'better-sqlite3';
import { describe, expect, test } from 'vitest';
import { createInMemoryDb } from '../../../../tests/helpers/in-memory-db.js';
import { CHECK_NAMES } from './check-names.js';
import { probeDbOpen } from './db-open.js';

describe('probeDbOpen (db_open)', () => {
  test('returns fail when no handle injected', async () => {
    const result = await probeDbOpen({});
    expect(result.name).toBe(CHECK_NAMES.DB_OPEN);
    expect(result.status).toBe('fail');
    expect(result.detail).toContain('no DB handle injected');
  });

  test('returns pass when handle responds to pragma', async () => {
    const { sqlite, close } = createInMemoryDb();
    try {
      const result = await probeDbOpen({ sqlite });
      expect(result.name).toBe(CHECK_NAMES.DB_OPEN);
      expect(result.status).toBe('pass');
      // Accept either the WAL-confirmed detail (production handle) or the
      // observed journal_mode detail (in-memory handle reports `memory`).
      expect(result.detail).toMatch(/WAL journal mode confirmed|DB open, journal_mode=/);
    } finally {
      close();
    }
  });

  test('returns fail when pragma throws', async () => {
    const throwingHandle = {
      pragma: () => {
        throw new Error('test-error');
      },
    } as unknown as Database.Database;
    const result = await probeDbOpen({ sqlite: throwingHandle });
    expect(result.name).toBe(CHECK_NAMES.DB_OPEN);
    expect(result.status).toBe('fail');
    expect(result.detail).toContain('pragma probe threw');
    expect(result.detail).toContain('test-error');
  });
});
