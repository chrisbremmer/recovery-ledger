// renderDailyReview tests — loads each of the 5 daily fixtures (Plan
// 04-07), runs getDailyReview against the in-memory DB, then renders.
// Anchors:
//   - REV-04: rendered output starts with 'Data status:' (data-freshness lead).
//   - ADR-0004 / D-07: NO 'Patterns:' substring in any rendered output
//                       (section omitted across every fixture in v1).
//   - REV-05 + D-10: insufficient fixture renders 'Confidence: insufficient — ' + reason.
//   - REV-05 + ADR-0004: insufficient fixture omits Anomalies + Actions sections.
//   - D-08: actions capped at 3 (rendered as 3 numbered lines).
//   - ADR-0005 / D-26 (per-formatter sanity sweep): NO banned tokens in rendered output.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Logger } from 'pino';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  type DailyFixtureSpec,
  expandDailyFixture,
} from '../../tests/fixtures/review/_generators/daily.js';
import { createInMemoryDb, type InMemoryDbResult } from '../../tests/helpers/in-memory-db.js';
import { containsBannedToneToken, EMOJI_RE } from '../domain/banned-words.js';
import { createBodyMeasurementsRepo } from '../infrastructure/db/repositories/body-measurements.repo.js';
import { createCyclesRepo } from '../infrastructure/db/repositories/cycles.repo.js';
import { createDailySummariesRepo } from '../infrastructure/db/repositories/daily-summaries.repo.js';
import { createProfileRepo } from '../infrastructure/db/repositories/profile.repo.js';
import { createRecoveryRepo } from '../infrastructure/db/repositories/recovery.repo.js';
import { createSleepsRepo } from '../infrastructure/db/repositories/sleep.repo.js';
import { createSyncRunsRepo } from '../infrastructure/db/repositories/sync-runs.repo.js';
import { createWorkoutsRepo } from '../infrastructure/db/repositories/workouts.repo.js';
import { type DailyReviewDeps, getDailyReview } from '../services/review/daily.js';
import { renderDailyReview } from './daily-review.txt.js';

const FIXTURES_DIR = resolve(__dirname, '../../tests/fixtures/review');

const DAILY_FIXTURE_NAMES = [
  'daily-strong-confidence',
  'daily-weak-confidence',
  'daily-insufficient-days',
  'daily-no-anomalies',
  'daily-three-anomalies-capped',
] as const;

function loadDailyFixture(name: string): DailyFixtureSpec {
  return JSON.parse(readFileSync(resolve(FIXTURES_DIR, `${name}.json`), 'utf-8')) as DailyFixtureSpec;
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

describe('renderDailyReview — REV-04 data-status leads', () => {
  let h: Harness;
  beforeEach(() => {
    h = makeHarness();
  });
  afterEach(() => h.mem.close());

  for (const name of DAILY_FIXTURE_NAMES) {
    it(`fixture ${name} → rendered output starts with 'Data status:'`, async () => {
      const spec = loadDailyFixture(name);
      loadIntoDb(h, spec);
      const result = await getDailyReview({ date: spec.reviewed_date }, h.deps);
      const rendered = renderDailyReview(result);
      expect(rendered.startsWith('Data status:')).toBe(true);
    });
  }
});

describe('renderDailyReview — D-07 Patterns section ALWAYS omitted in v1', () => {
  let h: Harness;
  beforeEach(() => {
    h = makeHarness();
  });
  afterEach(() => h.mem.close());

  for (const name of DAILY_FIXTURE_NAMES) {
    it(`fixture ${name} → rendered output contains NO 'Patterns:' substring`, async () => {
      const spec = loadDailyFixture(name);
      loadIntoDb(h, spec);
      const result = await getDailyReview({ date: spec.reviewed_date }, h.deps);
      const rendered = renderDailyReview(result);
      expect(rendered).not.toContain('Patterns:');
    });
  }
});

describe("renderDailyReview — REV-05 insufficient surface", () => {
  let h: Harness;
  beforeEach(() => {
    h = makeHarness();
  });
  afterEach(() => h.mem.close());

  it("insufficient fixture renders 'Confidence: insufficient — ' + reason", async () => {
    const spec = loadDailyFixture('daily-insufficient-days');
    loadIntoDb(h, spec);
    const result = await getDailyReview({ date: spec.reviewed_date }, h.deps);
    const rendered = renderDailyReview(result);
    expect(rendered).toContain('Confidence: insufficient — ');
    expect(rendered).toContain('8 SCORED days');
  });

  it('insufficient fixture omits Anomalies + Actions sections (ADR-0004 typed positive output)', async () => {
    const spec = loadDailyFixture('daily-insufficient-days');
    loadIntoDb(h, spec);
    const result = await getDailyReview({ date: spec.reviewed_date }, h.deps);
    const rendered = renderDailyReview(result);
    expect(rendered).not.toContain('Anomalies:');
    expect(rendered).not.toContain('Actions:');
  });
});

describe('renderDailyReview — ADR-0004 empty array → section omitted', () => {
  let h: Harness;
  beforeEach(() => {
    h = makeHarness();
  });
  afterEach(() => h.mem.close());

  it("daily-no-anomalies fixture: no 'Anomalies:' substring (no filler)", async () => {
    const spec = loadDailyFixture('daily-no-anomalies');
    loadIntoDb(h, spec);
    const result = await getDailyReview({ date: spec.reviewed_date }, h.deps);
    const rendered = renderDailyReview(result);
    expect(rendered).not.toContain('Anomalies:');
    expect(rendered).not.toContain('Actions:');
    expect(rendered).toContain('Confidence: strong');
  });

  it('daily-three-anomalies-capped fixture: Anomalies section present + 3 numbered actions', async () => {
    const spec = loadDailyFixture('daily-three-anomalies-capped');
    loadIntoDb(h, spec);
    const result = await getDailyReview({ date: spec.reviewed_date }, h.deps);
    const rendered = renderDailyReview(result);
    expect(rendered).toContain('Anomalies:');
    expect(rendered).toContain('Actions:');
    // Three numbered action lines (D-08 cap).
    expect(rendered).toMatch(/^\s*1\. /m);
    expect(rendered).toMatch(/^\s*2\. /m);
    expect(rendered).toMatch(/^\s*3\. /m);
    // NEVER a 4th line.
    expect(rendered).not.toMatch(/^\s*4\. /m);
  });
});

describe("renderDailyReview — Today's measurements section", () => {
  let h: Harness;
  beforeEach(() => {
    h = makeHarness();
  });
  afterEach(() => h.mem.close());

  it('strong-confidence fixture renders all 8 metric rows', async () => {
    const spec = loadDailyFixture('daily-strong-confidence');
    loadIntoDb(h, spec);
    const result = await getDailyReview({ date: spec.reviewed_date }, h.deps);
    const rendered = renderDailyReview(result);
    expect(rendered).toContain("Today's measurements:");
    expect(rendered).toContain('Recovery');
    expect(rendered).toContain('HRV (rMSSD)');
    expect(rendered).toContain('Resting HR');
    expect(rendered).toContain('Strain');
    expect(rendered).toContain('Sleep');
    expect(rendered).toContain('Resp. rate');
    expect(rendered).toContain('SpO2');
    expect(rendered).toContain('Skin temp');
  });
});

describe('renderDailyReview — ADR-0005 / D-26 per-formatter sanity sweep', () => {
  let h: Harness;
  beforeEach(() => {
    h = makeHarness();
  });
  afterEach(() => h.mem.close());

  for (const name of DAILY_FIXTURE_NAMES) {
    it(`fixture ${name} → rendered output free of banned tokens + emoji`, async () => {
      const spec = loadDailyFixture(name);
      loadIntoDb(h, spec);
      const result = await getDailyReview({ date: spec.reviewed_date }, h.deps);
      const rendered = renderDailyReview(result);
      const hit = containsBannedToneToken(rendered);
      expect(hit.hit).toBe(false);
      expect(EMOJI_RE.test(rendered)).toBe(false);
    });
  }
});
