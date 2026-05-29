// Unit coverage for the `db_schema_version` doctor probe (Plan 05-03, D-02 #4).
//
// The probe compares the `__drizzle_migrations` row count (written by the
// Phase 3 hand-rolled migrator) against the count of `.sql` files under
// src/infrastructure/db/migrations/. createInMemoryDb() runs the real
// migrator (ADR-0006 — DB-only check), so a fresh in-memory DB has exactly
// the matching row count. The mismatch arms mutate the table directly; the
// missing-table arm opens a bare :memory: DB without the migrator so the
// COUNT SELECT throws.

import Database from 'better-sqlite3';
import { describe, expect, test } from 'vitest';
import { createInMemoryDb } from '../../../../tests/helpers/in-memory-db.js';
import { CHECK_NAMES } from './check-names.js';
import { probeDbSchemaVersion } from './db-schema-version.js';

describe('probeDbSchemaVersion (db_schema_version)', () => {
  test('returns fail when no handle injected', async () => {
    const result = await probeDbSchemaVersion({});
    expect(result.name).toBe(CHECK_NAMES.DB_SCHEMA_VERSION);
    expect(result.status).toBe('fail');
    expect(result.detail).toContain('no DB handle injected');
  });

  test('returns pass when counts match', async () => {
    const { sqlite, close } = createInMemoryDb();
    try {
      const result = await probeDbSchemaVersion({ sqlite });
      expect(result.name).toBe(CHECK_NAMES.DB_SCHEMA_VERSION);
      expect(result.status).toBe('pass');
      // The two numbers in "schema at migration N/M" must be equal.
      const match = result.detail.match(/^schema at migration (\d+)\/(\d+)$/);
      expect(match).not.toBeNull();
      expect(match?.[1]).toBe(match?.[2]);
    } finally {
      close();
    }
  });

  test('returns fail when dbCount < fileCount (missing migration)', async () => {
    const { sqlite, close } = createInMemoryDb();
    try {
      sqlite.prepare('DELETE FROM __drizzle_migrations').run();
      const result = await probeDbSchemaVersion({ sqlite });
      expect(result.name).toBe(CHECK_NAMES.DB_SCHEMA_VERSION);
      expect(result.status).toBe('fail');
      expect(result.detail).toContain('schema at migration 0/');
    } finally {
      close();
    }
  });

  test('returns fail when dbCount > fileCount (orphaned row)', async () => {
    const { sqlite, close } = createInMemoryDb();
    try {
      sqlite
        .prepare(
          "INSERT INTO __drizzle_migrations (hash, created_at) VALUES ('synthetic-hash', '2026-01-01')",
        )
        .run();
      const result = await probeDbSchemaVersion({ sqlite });
      expect(result.name).toBe(CHECK_NAMES.DB_SCHEMA_VERSION);
      expect(result.status).toBe('fail');
      expect(result.detail).toContain('extra rows');
      expect(result.detail).toContain('docs/install/troubleshooting.md#db_schema_version');
    } finally {
      close();
    }
  });

  test('returns fail when table does not exist', async () => {
    const sqlite = new Database(':memory:');
    try {
      const result = await probeDbSchemaVersion({ sqlite });
      expect(result.name).toBe(CHECK_NAMES.DB_SCHEMA_VERSION);
      expect(result.status).toBe('fail');
      expect(result.detail).toMatch(/^probe threw:/);
    } finally {
      sqlite.close();
    }
  });
});
