// Connection introspection tests (Plan 03-05 Task 1). Locks the six-pragma
// D-30 contract per connection and the canonical `drizzle` re-export that
// Plan 03-07 + Plan 03-11 depend on. No migrator under test here — that
// surface is exercised in migrate.test.ts + the integration suite.
//
// Uses a real on-disk file (not `:memory:`) for the WAL assertion path, plus
// one `:memory:` test to confirm openDb doesn't throw when WAL isn't
// available (SQLite silently keeps in-memory journaling — the call returns
// cleanly).

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { drizzle, type OpenDbResult, openDb } from './connection.js';

describe('openDb — D-30 pragmas + factory shape', () => {
  let tmpDir: string;
  let dbPath: string;
  let handle: OpenDbResult | null = null;

  beforeEach(() => {
    tmpDir = mkdtempSync(path.join(tmpdir(), 'rl-connection-'));
    dbPath = path.join(tmpDir, 'test.sqlite');
    handle = null;
  });

  afterEach(() => {
    if (handle !== null) {
      try {
        handle.sqlite.close();
      } catch {
        // already closed
      }
      handle = null;
    }
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns a { db, sqlite } pair and openDb is a function', () => {
    expect(typeof openDb).toBe('function');
    handle = openDb(dbPath);
    expect(handle.db).toBeDefined();
    expect(handle.sqlite).toBeDefined();
    expect(typeof handle.sqlite.prepare).toBe('function');
  });

  it('applies journal_mode = WAL on a real file', () => {
    handle = openDb(dbPath);
    expect(handle.sqlite.pragma('journal_mode', { simple: true })).toBe('wal');
  });

  it('applies busy_timeout = 5000', () => {
    handle = openDb(dbPath);
    expect(handle.sqlite.pragma('busy_timeout', { simple: true })).toBe(5000);
  });

  it('applies journal_size_limit = 67108864 (64 MB)', () => {
    handle = openDb(dbPath);
    expect(handle.sqlite.pragma('journal_size_limit', { simple: true })).toBe(67108864);
  });

  it('applies wal_autocheckpoint = 1000', () => {
    handle = openDb(dbPath);
    expect(handle.sqlite.pragma('wal_autocheckpoint', { simple: true })).toBe(1000);
  });

  it('applies synchronous = NORMAL (encoded as integer 1)', () => {
    handle = openDb(dbPath);
    expect(handle.sqlite.pragma('synchronous', { simple: true })).toBe(1);
  });

  it('applies foreign_keys = ON (encoded as integer 1)', () => {
    handle = openDb(dbPath);
    expect(handle.sqlite.pragma('foreign_keys', { simple: true })).toBe(1);
  });

  it('openDb(":memory:") returns a usable handle without throwing — WAL falls back silently', () => {
    handle = openDb(':memory:');
    // SQLite silently keeps in-memory journaling for :memory: databases;
    // the journal_mode = WAL call does not raise. Mode reports as 'memory'.
    expect(handle.sqlite.pragma('journal_mode', { simple: true })).toBe('memory');
    // The other pragmas still apply normally.
    expect(handle.sqlite.pragma('busy_timeout', { simple: true })).toBe(5000);
    expect(handle.sqlite.pragma('foreign_keys', { simple: true })).toBe(1);
  });
});

describe('drizzle re-export — canonical import surface for Plan 03-07 + Plan 03-11', () => {
  it('exposes drizzle as a function that wraps a better-sqlite3 handle into a usable Drizzle DB', () => {
    expect(typeof drizzle).toBe('function');
    // Smoke check: drizzle(sqlite) should not throw on a fresh handle.
    // Plan 03-07 in-memory-db.ts and Plan 03-11 bootstrap.ts both rely on
    // this re-export so Gate G can forbid `from 'drizzle-orm'` outside
    // src/infrastructure/db/.
    const result = openDb(':memory:');
    try {
      const wrapped = drizzle(result.sqlite);
      expect(wrapped).toBeDefined();
    } finally {
      result.sqlite.close();
    }
  });
});
