// Schema introspection tests (Plan 03-02 Task 2). Pure declarative assertions:
// no DB connection, no `better-sqlite3` instance, no migrator. The point is to
// lock the table count, the four covering-index names, the cycles
// baseline_excluded + exclusion_reason columns, the decisions status enum, and
// the drizzle-kit-generate output shape that Plan 03-05's hand-rolled migrator
// (Wave 2) parses verbatim. If any of these drift, this suite breaks at CI
// before the migrator does at runtime.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { getTableConfig } from 'drizzle-orm/sqlite-core';
import { describe, expect, it } from 'vitest';
import * as schema from './schema.js';

const MIGRATIONS_DIR = join(__dirname, 'migrations');

// The 9-table list from D-01. Order is not load-bearing here — the assertion
// is on the set of named exports.
const EXPECTED_TABLES = [
  'cycles',
  'recoveries',
  'sleeps',
  'workouts',
  'profile',
  'body_measurements',
  'sync_runs',
  'daily_summaries',
  'decisions',
] as const;

// The four scored entities per D-05. Recoveries indexes on (score_state,
// created_at) — same intent; the wire shape has no `start` field.
const SCORED_TABLES = ['cycles', 'recoveries', 'sleeps', 'workouts'] as const;

describe('schema named-export surface (D-01)', () => {
  it('exposes exactly 9 sqliteTable named exports', () => {
    const tableNames = EXPECTED_TABLES.filter((name) => {
      // biome-ignore lint/suspicious/noExplicitAny: schema is a wildcard import; checked names exist as named exports
      const exported = (schema as any)[name];
      return exported !== undefined && typeof exported === 'object';
    });
    expect(tableNames).toHaveLength(9);
    expect(new Set(tableNames)).toEqual(new Set(EXPECTED_TABLES));
  });

  it('every expected table is a Drizzle SQLiteTable accessible to getTableConfig', () => {
    for (const tableName of EXPECTED_TABLES) {
      // biome-ignore lint/suspicious/noExplicitAny: see above
      const table = (schema as any)[tableName];
      expect(() => getTableConfig(table)).not.toThrow();
      expect(getTableConfig(table).name).toBe(tableName);
    }
  });
});

describe('covering indexes — (score_state, start) per D-05', () => {
  it.each(
    SCORED_TABLES,
  )('scored table `%s` has exactly one <table>_score_state_start_idx index', (tableName) => {
    // biome-ignore lint/suspicious/noExplicitAny: schema named export resolved by string key
    const table = (schema as any)[tableName];
    const { indexes } = getTableConfig(table);
    const expectedName = `${tableName}_score_state_start_idx`;
    const match = indexes.filter((i) => i.config.name === expectedName);
    expect(match).toHaveLength(1);
  });

  it('cycles + sleeps + workouts cover (score_state, start); recoveries covers (score_state, created_at)', () => {
    for (const tableName of ['cycles', 'sleeps', 'workouts'] as const) {
      // biome-ignore lint/suspicious/noExplicitAny: schema named export resolved by string key
      const table = (schema as any)[tableName];
      const idx = getTableConfig(table).indexes.find(
        (i) => i.config.name === `${tableName}_score_state_start_idx`,
      );
      expect(idx, `${tableName} index missing`).toBeDefined();
      const cols = idx?.config.columns ?? [];
      const colNames = cols
        // biome-ignore lint/suspicious/noExplicitAny: Drizzle IndexColumn is SQLiteColumn | SQL
        .map((c) => (c as any).name)
        .filter((n: unknown): n is string => typeof n === 'string');
      expect(colNames).toEqual(['score_state', 'start']);
    }
    const recIdx = getTableConfig(schema.recoveries).indexes.find(
      (i) => i.config.name === 'recoveries_score_state_start_idx',
    );
    expect(recIdx).toBeDefined();
    const recCols = (recIdx?.config.columns ?? [])
      // biome-ignore lint/suspicious/noExplicitAny: Drizzle IndexColumn shape
      .map((c) => (c as any).name)
      .filter((n: unknown): n is string => typeof n === 'string');
    expect(recCols).toEqual(['score_state', 'created_at']);
  });
});

describe('cycles DST/tz columns (D-14)', () => {
  it('cycles has baseline_excluded (boolean-mode integer, NOT NULL) and exclusion_reason (text, nullable)', () => {
    const { columns } = getTableConfig(schema.cycles);
    const baselineExcluded = columns.find((c) => c.name === 'baseline_excluded');
    const exclusionReason = columns.find((c) => c.name === 'exclusion_reason');

    expect(baselineExcluded, 'baseline_excluded column missing').toBeDefined();
    expect(baselineExcluded?.notNull).toBe(true);
    expect(baselineExcluded?.dataType).toBe('boolean');

    expect(exclusionReason, 'exclusion_reason column missing').toBeDefined();
    expect(exclusionReason?.notNull).toBe(false);
    expect(exclusionReason?.dataType).toBe('string');
  });
});

describe('decisions status enum (D-01 / DEC-01)', () => {
  it('decisions.status enum is exactly ["open", "followed_up", "abandoned"]', () => {
    const { columns } = getTableConfig(schema.decisions);
    const statusCol = columns.find((c) => c.name === 'status');
    expect(statusCol, 'status column missing').toBeDefined();
    // biome-ignore lint/suspicious/noExplicitAny: enumValues isn't on the base column type
    const values = (statusCol as any)?.enumValues as string[] | undefined;
    expect(values).toEqual(['open', 'followed_up', 'abandoned']);
    expect(statusCol?.notNull).toBe(true);
  });
});

describe('drizzle-kit generate output (A1 / A2 / A10 / A11)', () => {
  it('meta/_journal.json entries[0].tag === "0000_initial"', () => {
    const journal = JSON.parse(readFileSync(join(MIGRATIONS_DIR, 'meta', '_journal.json'), 'utf8'));
    expect(journal.entries).toBeInstanceOf(Array);
    expect(journal.entries.length).toBeGreaterThanOrEqual(1);
    expect(journal.entries[0].tag).toBe('0000_initial');
    expect(journal.entries[0].idx).toBe(0);
    expect(journal.dialect).toBe('sqlite');
  });

  it('0000_initial.sql contains exactly 9 CREATE TABLE statements (A2 + D-01)', () => {
    const sql = readFileSync(join(MIGRATIONS_DIR, '0000_initial.sql'), 'utf8');
    const matches = sql.match(/^CREATE TABLE/gm) ?? [];
    expect(matches).toHaveLength(9);
  });

  it('0000_initial.sql contains exactly 4 CREATE INDEX statements (D-05)', () => {
    const sql = readFileSync(join(MIGRATIONS_DIR, '0000_initial.sql'), 'utf8');
    const matches = sql.match(/CREATE INDEX/g) ?? [];
    expect(matches).toHaveLength(4);
  });

  it('0000_initial.sql contains only DDL — no VACUUM / DELETE / UPDATE / INSERT (A10)', () => {
    const sql = readFileSync(join(MIGRATIONS_DIR, '0000_initial.sql'), 'utf8');
    expect(sql).not.toMatch(/^(VACUUM|DELETE|UPDATE|INSERT)/m);
  });

  it('meta/0000_snapshot.json parses as JSON', () => {
    const snap = readFileSync(join(MIGRATIONS_DIR, 'meta', '0000_snapshot.json'), 'utf8');
    expect(() => JSON.parse(snap)).not.toThrow();
  });
});
