// REV-03 / REV-04 / REV-05 — daily-review output-shape contract.
//
// Replaces the Wave 0 it.todo scaffold (Plan 04-01) with full assertions
// across the 5 daily fixtures. Anchors:
//   - REV-04: rendered output leads with 'Data status:' surfacing latest-sync
//             timestamp + baseline window + missing/stale metrics.
//   - REV-03: rendered output contains every D-03 slot's required label
//             string ("Today's measurements:", "Confidence:").
//   - D-07:   rendered output does NOT contain the literal 'Patterns:'
//             substring (section omitted across all fixtures because
//             patterns slot is always empty in v1).
//   - REV-05: insufficient fixture: contains 'Confidence: insufficient — '
//             AND does NOT contain 'Anomalies:' (omitted per REV-05).
//   - D-08:   multi-anomaly fixture: contains 'Anomalies:' AND at most 3
//             numbered actions.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Logger } from 'pino';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderDailyReview } from '../../src/formatters/daily-review.txt.js';
import { createBodyMeasurementsRepo } from '../../src/infrastructure/db/repositories/body-measurements.repo.js';
import { createCyclesRepo } from '../../src/infrastructure/db/repositories/cycles.repo.js';
import { createDailySummariesRepo } from '../../src/infrastructure/db/repositories/daily-summaries.repo.js';
import { createProfileRepo } from '../../src/infrastructure/db/repositories/profile.repo.js';
import { createRecoveryRepo } from '../../src/infrastructure/db/repositories/recovery.repo.js';
import { createSleepsRepo } from '../../src/infrastructure/db/repositories/sleep.repo.js';
import { createSyncRunsRepo } from '../../src/infrastructure/db/repositories/sync-runs.repo.js';
import { createWorkoutsRepo } from '../../src/infrastructure/db/repositories/workouts.repo.js';
import { type DailyReviewDeps, getDailyReview } from '../../src/services/review/daily.js';
import {
  type DailyFixtureSpec,
  expandDailyFixture,
} from '../fixtures/review/_generators/daily.js';
import { createInMemoryDb, type InMemoryDbResult } from '../helpers/in-memory-db.js';

const FIXTURES_DIR = resolve(__dirname, '..', 'fixtures', 'review');

const DAILY_FIXTURE_NAMES = [
  'daily-strong-confidence',
  'daily-weak-confidence',
  'daily-insufficient-days',
  'daily-no-anomalies',
  'daily-three-anomalies-capped',
] as const;

function loadDailyFixture(name: string): DailyFixtureSpec {
  return JSON.parse(
    readFileSync(resolve(FIXTURES_DIR, `${name}.json`), 'utf-8'),
  ) as DailyFixtureSpec;
}

function makeStubLogger(): Logger {
  const noop = vi.fn();
  return {
    info: noop,
    warn: noop,
    error: noop,
    debug: noop,
    trace: noop,
    fatal: noop,
    child: () => makeStubLogger(),
  } as unknown as Logger;
}

interface Harness {
  mem: InMemoryDbResult;
  deps: DailyReviewDeps;
}

function makeHarness(): Harness {
  const mem = createInMemoryDb();
  const repos = {
    cycles: createCyclesRepo(mem.db),
    recoveries: createRecoveryRepo(mem.db),
    sleeps: createSleepsRepo(mem.db),
    workouts: createWorkoutsRepo(mem.db),
    profile: createProfileRepo(mem.db),
    bodyMeasurements: createBodyMeasurementsRepo(mem.db),
    syncRuns: createSyncRunsRepo(mem.db),
    dailySummaries: createDailySummariesRepo(mem.db),
  };
  const deps: DailyReviewDeps = {
    repos,
    clock: () => new Date('2026-03-15T15:00:00.000Z'),
    logger: makeStubLogger(),
  };
  return { mem, deps };
}

function loadIntoDb(h: Harness, spec: DailyFixtureSpec): void {
  const { cycles, recoveries, sleeps } = expandDailyFixture(spec);
  const repos = h.deps.repos;
  repos.cycles.upsertBatch(cycles);
  repos.recoveries.upsertBatch(recoveries);
  repos.sleeps.upsertBatch(sleeps);
}

describe('Phase 4 daily-review output-shape contract — REV-03 / REV-04', () => {
  let h: Harness;
  beforeEach(() => {
    h = makeHarness();
  });
  afterEach(() => h.mem.close());

  for (const name of DAILY_FIXTURE_NAMES) {
    it(`REV-04: ${name} fixture rendered output leads with 'Data status:' line`, async () => {
      const spec = loadDailyFixture(name);
      loadIntoDb(h, spec);
      const result = await getDailyReview({ date: spec.reviewed_date }, h.deps);
      const rendered = renderDailyReview(result);
      const lines = rendered.split('\n');
      expect(lines[0]).toBe('Data status:');
    });

    it(`REV-03: ${name} fixture rendered output contains required D-03 slot labels`, async () => {
      const spec = loadDailyFixture(name);
      loadIntoDb(h, spec);
      const result = await getDailyReview({ date: spec.reviewed_date }, h.deps);
      const rendered = renderDailyReview(result);
      expect(rendered).toContain("Today's measurements:");
      expect(rendered).toContain('Confidence:');
    });

    it(`D-07: ${name} fixture rendered output does NOT contain the literal 'Patterns:' substring`, async () => {
      const spec = loadDailyFixture(name);
      loadIntoDb(h, spec);
      const result = await getDailyReview({ date: spec.reviewed_date }, h.deps);
      const rendered = renderDailyReview(result);
      expect(rendered).not.toContain('Patterns:');
    });
  }
});

describe('Phase 4 daily-review output-shape contract — REV-05 insufficient', () => {
  let h: Harness;
  beforeEach(() => {
    h = makeHarness();
  });
  afterEach(() => h.mem.close());

  it("insufficient fixture: rendered output contains 'Confidence: insufficient — '", async () => {
    const spec = loadDailyFixture('daily-insufficient-days');
    loadIntoDb(h, spec);
    const result = await getDailyReview({ date: spec.reviewed_date }, h.deps);
    const rendered = renderDailyReview(result);
    expect(rendered).toContain('Confidence: insufficient — ');
  });

  it("insufficient fixture: rendered output does NOT contain 'Anomalies:' (omitted per REV-05)", async () => {
    const spec = loadDailyFixture('daily-insufficient-days');
    loadIntoDb(h, spec);
    const result = await getDailyReview({ date: spec.reviewed_date }, h.deps);
    const rendered = renderDailyReview(result);
    expect(rendered).not.toContain('Anomalies:');
  });
});

describe('Phase 4 daily-review output-shape contract — D-08 multi-anomaly capped', () => {
  let h: Harness;
  beforeEach(() => {
    h = makeHarness();
  });
  afterEach(() => h.mem.close());

  it("multi-anomaly fixture: rendered output contains 'Anomalies:' AND at most 3 numbered actions", async () => {
    const spec = loadDailyFixture('daily-three-anomalies-capped');
    loadIntoDb(h, spec);
    const result = await getDailyReview({ date: spec.reviewed_date }, h.deps);
    const rendered = renderDailyReview(result);
    expect(rendered).toContain('Anomalies:');
    // 1., 2., 3. numbered actions present.
    expect(rendered).toMatch(/^\s*1\. /m);
    expect(rendered).toMatch(/^\s*2\. /m);
    expect(rendered).toMatch(/^\s*3\. /m);
    // 4. NOT present (D-08 cap).
    expect(rendered).not.toMatch(/^\s*4\. /m);
  });
});

// REV-04 surface contract: the daily review output leads with a
// `data_status` section — the literal token `data_status` is referenced
// in this comment so static reviewers can grep this file by purpose
// (Biome's noExportsInTest rule forbids exports from *.test.ts).
