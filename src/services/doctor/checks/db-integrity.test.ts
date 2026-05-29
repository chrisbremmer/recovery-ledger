// Unit coverage for the `db_integrity` doctor probe (Plan 05-03, D-02 #3).
//
// The probe runs SQLite's built-in `PRAGMA integrity_check` against an
// injected better-sqlite3 handle. The healthy-DB case uses createInMemoryDb()
// (ADR-0006 — DB-only check); the corruption + throw arms use hand-rolled
// stubs because a genuinely-corrupt :memory: DB cannot be constructed
// deterministically in-process.

import type Database from 'better-sqlite3';
import { describe, expect, test } from 'vitest';
import { createInMemoryDb } from '../../../../tests/helpers/in-memory-db.js';
import { CHECK_NAMES } from './check-names.js';
import { probeDbIntegrity } from './db-integrity.js';

describe('probeDbIntegrity (db_integrity)', () => {
  test('returns fail when no handle injected', async () => {
    const result = await probeDbIntegrity({});
    expect(result.name).toBe(CHECK_NAMES.DB_INTEGRITY);
    expect(result.status).toBe('fail');
    expect(result.detail).toContain('no DB handle injected');
  });

  test('returns pass on healthy DB', async () => {
    const { sqlite, close } = createInMemoryDb();
    try {
      const result = await probeDbIntegrity({ sqlite });
      expect(result.name).toBe(CHECK_NAMES.DB_INTEGRITY);
      expect(result.status).toBe('pass');
      expect(result.detail).toBe('PRAGMA integrity_check ok');
    } finally {
      close();
    }
  });

  test('returns fail when pragma returns multiple rows', async () => {
    const multiRowHandle = {
      pragma: () => [
        { integrity_check: 'database disk image is malformed' },
        { integrity_check: 'other' },
      ],
    } as unknown as Database.Database;
    const result = await probeDbIntegrity({ sqlite: multiRowHandle });
    expect(result.name).toBe(CHECK_NAMES.DB_INTEGRITY);
    expect(result.status).toBe('fail');
    expect(result.detail).toContain('2 row(s)');
    expect(result.detail).toContain('database disk image is malformed');
  });

  test('returns fail when pragma throws', async () => {
    const throwingHandle = {
      pragma: () => {
        throw new Error('disk I/O error');
      },
    } as unknown as Database.Database;
    const result = await probeDbIntegrity({ sqlite: throwingHandle });
    expect(result.name).toBe(CHECK_NAMES.DB_INTEGRITY);
    expect(result.status).toBe('fail');
    expect(result.detail).toMatch(/^probe threw:/);
    expect(result.detail).toContain('disk I/O error');
  });
});
