// Unit coverage for the `db_wal_size` doctor probe (Plan 05-03, D-02 #5).
//
// Approach: real fixture WAL files in an isolated tmp directory (mkdtempSync),
// written with Buffer.alloc of the target size, then statSync'd through the
// probe's real path-resolution + threshold logic. This is heavier than a
// `vi.spyOn(fs, 'statSync')` stub but gives honest end-to-end coverage of the
// statSync(`${dbFile}-wal`) read — including the throwIfNoEntry:false
// missing-file arm — at the cost of allocating a 70MB buffer in the fail case.
// statSync reads inode metadata only (O(1)), so the read itself is cheap; the
// cost is the one-time write. Vitest's default 5s timeout is ample on any
// modern disk (T-05-D2: the large buffer lives only in this test). The choice
// is documented in 05-03-SUMMARY.md.

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { CHECK_NAMES } from './check-names.js';
import { probeDbWalSize } from './db-wal-size.js';

let tmp: string;

beforeAll(() => {
  tmp = mkdtempSync(join(tmpdir(), 'rl-walsize-'));
});

afterAll(() => {
  rmSync(tmp, { recursive: true, force: true });
});

describe('probeDbWalSize (db_wal_size)', () => {
  test('returns pass when no WAL file present', async () => {
    // dbFile points at a path whose `-wal` companion does not exist.
    const dbFile = join(tmp, 'no-wal.sqlite');
    const result = await probeDbWalSize({ dbFile });
    expect(result.name).toBe(CHECK_NAMES.DB_WAL_SIZE);
    expect(result.status).toBe('pass');
    expect(result.detail).toContain('no -wal file');
  });

  test('returns pass for small WAL (<32MB)', async () => {
    const dbFile = join(tmp, 'small.sqlite');
    writeFileSync(`${dbFile}-wal`, Buffer.alloc(100));
    const result = await probeDbWalSize({ dbFile });
    expect(result.name).toBe(CHECK_NAMES.DB_WAL_SIZE);
    expect(result.status).toBe('pass');
    expect(result.detail).toContain('KB');
    expect(result.detail).toContain('<32MB');
  });

  test('returns warn for WAL in 32MB-64MB range', async () => {
    const dbFile = join(tmp, 'medium.sqlite');
    writeFileSync(`${dbFile}-wal`, Buffer.alloc(40 * 1024 * 1024));
    const result = await probeDbWalSize({ dbFile });
    expect(result.name).toBe(CHECK_NAMES.DB_WAL_SIZE);
    expect(result.status).toBe('warn');
    expect(result.detail).toContain('MB');
    expect(result.detail).toContain('checkpoint is lagging');
  });

  test('returns fail for WAL above 64MB', async () => {
    const dbFile = join(tmp, 'large.sqlite');
    writeFileSync(`${dbFile}-wal`, Buffer.alloc(70 * 1024 * 1024));
    const result = await probeDbWalSize({ dbFile });
    expect(result.name).toBe(CHECK_NAMES.DB_WAL_SIZE);
    expect(result.status).toBe('fail');
    expect(result.detail).toContain('exceeds journal_size_limit=64MB');
    expect(result.detail).toContain('wal_checkpoint(TRUNCATE)');
  });
});
