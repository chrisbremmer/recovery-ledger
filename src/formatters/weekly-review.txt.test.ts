// renderWeeklyReview tests — loads each of the 5 weekly fixtures (Plan
// 04-07), runs getWeeklyReview against the in-memory DB, then renders.
// Anchors:
//   - REV-04: rendered output starts with 'Data status:'.
//   - D-17 + D-12: 'Week summary (This week: ...)' header carries the
//                  trailing-7 date range AND 'Pattern over trailing 28
//                  days (...)' header carries the trailing-28 date range,
//                  TWO DISTINCT labeled sections with the two date ranges
//                  drawn from data_status.{week_start,week_end} and
//                  data_status.pattern_test_window.{start,end}.
//   - REV-07: pattern.kind === 'no_pattern' fixtures render the typed
//             reason verbatim ("Reason: no_factor_cleared_fdr" or
//             "insufficient_window_days").
//   - D-34: pattern_confidence === 'weak' triggers the small-sample
//           caveat line; 'strong' suppresses it.
//   - D-22: decision_prompt 'none_this_week' renders as the FINAL section;
//           'silent' omits it.
//   - ADR-0005 / D-26 per-formatter sanity sweep: NO banned tokens in
//     rendered output.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Logger } from 'pino';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  expandWeeklyFixture,
  type WeeklyFixtureSpec,
} from '../../tests/fixtures/review/_generators/weekly.js';
import { createInMemoryDb, type InMemoryDbResult } from '../../tests/helpers/in-memory-db.js';
import { containsBannedToneToken, EMOJI_RE } from '../domain/banned-words.js';
import type { WeeklyReviewResult } from '../domain/review/types.js';
import { createBodyMeasurementsRepo } from '../infrastructure/db/repositories/body-measurements.repo.js';
import { createCyclesRepo } from '../infrastructure/db/repositories/cycles.repo.js';
import { createDailySummariesRepo } from '../infrastructure/db/repositories/daily-summaries.repo.js';
import { createDecisionsRepo } from '../infrastructure/db/repositories/decisions.repo.js';
import { createProfileRepo } from '../infrastructure/db/repositories/profile.repo.js';
import { createRecoveryRepo } from '../infrastructure/db/repositories/recovery.repo.js';
import { createSleepsRepo } from '../infrastructure/db/repositories/sleep.repo.js';
import { createSyncRunsRepo } from '../infrastructure/db/repositories/sync-runs.repo.js';
import { createWorkoutsRepo } from '../infrastructure/db/repositories/workouts.repo.js';
import { getWeeklyReview, type WeeklyReviewDeps } from '../services/review/weekly.js';
import { renderWeeklyReview } from './weekly-review.txt.js';

const FIXTURES_DIR = resolve(__dirname, '../../tests/fixtures/review');

const WEEKLY_FIXTURE_NAMES = [
  'weekly-pattern-clears-fdr',
  'weekly-pattern-fdr-suppression',
  'weekly-pattern-partial-rejection',
  'weekly-no-pattern-insufficient-window',
  'weekly-decision-prompt-none-this-week',
] as const;

function loadWeeklyFixture(name: string): WeeklyFixtureSpec {
  return JSON.parse(
    readFileSync(resolve(FIXTURES_DIR, `${name}.json`), 'utf-8'),
  ) as WeeklyFixtureSpec;
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
  deps: WeeklyReviewDeps;
  repos: {
    decisions: ReturnType<typeof createDecisionsRepo>;
  };
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
    decisions: createDecisionsRepo(mem.db),
    dailySummaries: createDailySummariesRepo(mem.db),
  };
  const deps: WeeklyReviewDeps = {
    repos,
    clock: () => new Date('2026-03-15T15:00:00.000Z'),
    ianaZone: () => 'America/Los_Angeles',
    logger: makeStubLogger(),
  };
  return { mem, deps, repos: { decisions: repos.decisions } };
}

function loadIntoDb(h: Harness, spec: WeeklyFixtureSpec): void {
  const { cycles, recoveries, sleeps, workouts } = expandWeeklyFixture(spec);
  const repos = h.deps.repos;
  repos.cycles.upsertBatch(cycles);
  repos.recoveries.upsertBatch(recoveries);
  repos.sleeps.upsertBatch(sleeps);
  repos.workouts.upsertBatch(workouts);
}

describe('renderWeeklyReview — REV-04 data-status leads', () => {
  let h: Harness;
  beforeEach(() => {
    h = makeHarness();
  });
  afterEach(() => h.mem.close());

  for (const name of WEEKLY_FIXTURE_NAMES) {
    it(`fixture ${name} → rendered output starts with 'Data status:'`, async () => {
      const spec = loadWeeklyFixture(name);
      loadIntoDb(h, spec);
      const result = await getWeeklyReview({ date: spec.reviewed_date }, h.deps);
      const rendered = renderWeeklyReview(result);
      expect(rendered.startsWith('Data status:')).toBe(true);
    });
  }
});

describe('renderWeeklyReview — D-17 + D-12 two-distinct-sections anchor', () => {
  let h: Harness;
  beforeEach(() => {
    h = makeHarness();
  });
  afterEach(() => h.mem.close());

  for (const name of WEEKLY_FIXTURE_NAMES) {
    it(`fixture ${name} → trailing-7 week_summary header + trailing-28 pattern header BOTH present with distinct date ranges`, async () => {
      const spec = loadWeeklyFixture(name);
      loadIntoDb(h, spec);
      const result = await getWeeklyReview({ date: spec.reviewed_date }, h.deps);
      const rendered = renderWeeklyReview(result);

      // D-17 — Week summary header with the trailing-7 range.
      const expectedWeekHeader = `Week summary (This week: ${result.data_status.week_start} to ${result.data_status.week_end}):`;
      expect(rendered).toContain(expectedWeekHeader);

      // D-12 — Pattern header with the trailing-28 range.
      const expectedPatternHeader = `Pattern over trailing 28 days (${result.data_status.pattern_test_window.start} to ${result.data_status.pattern_test_window.end}):`;
      expect(rendered).toContain(expectedPatternHeader);

      // The two ranges must differ — trailing-7 vs trailing-28.
      expect(result.data_status.week_start).not.toBe(result.data_status.pattern_test_window.start);
    });
  }
});

describe('renderWeeklyReview — REV-07 no_pattern arm renders typed reason', () => {
  let h: Harness;
  beforeEach(() => {
    h = makeHarness();
  });
  afterEach(() => h.mem.close());

  it('weekly-pattern-fdr-suppression → "Reason: no_factor_cleared_fdr"', async () => {
    const spec = loadWeeklyFixture('weekly-pattern-fdr-suppression');
    loadIntoDb(h, spec);
    const result = await getWeeklyReview({ date: spec.reviewed_date }, h.deps);
    const rendered = renderWeeklyReview(result);
    expect(rendered).toContain('No reliable pattern detected. Reason: no_factor_cleared_fdr');
  });

  it('weekly-no-pattern-insufficient-window → "Reason: insufficient_window_days"', async () => {
    const spec = loadWeeklyFixture('weekly-no-pattern-insufficient-window');
    loadIntoDb(h, spec);
    const result = await getWeeklyReview({ date: spec.reviewed_date }, h.deps);
    const rendered = renderWeeklyReview(result);
    expect(rendered).toContain('No reliable pattern detected. Reason: insufficient_window_days');
  });
});

describe('renderWeeklyReview — REV-06 detected arm + D-34 pattern_confidence', () => {
  let h: Harness;
  beforeEach(() => {
    h = makeHarness();
  });
  afterEach(() => h.mem.close());

  it('weekly-pattern-clears-fdr (N=22, strong) → no small-sample caveat', async () => {
    const spec = loadWeeklyFixture('weekly-pattern-clears-fdr');
    loadIntoDb(h, spec);
    const result = await getWeeklyReview({ date: spec.reviewed_date }, h.deps);
    expect(result.pattern.kind).toBe('detected');
    if (result.pattern.kind !== 'detected') throw new Error('narrow');
    expect(result.pattern.pattern_confidence).toBe('strong');

    const rendered = renderWeeklyReview(result);
    expect(rendered).toContain('Detected: sleep_duration_prior_night');
    expect(rendered).toContain('Confidence: strong');
    expect(rendered).not.toContain('Small sample');
  });

  it('synthetic weak-confidence result (N=18) → renders D-34 caveat', () => {
    // Direct (typedResult) => string assertion — the formatter is pure and
    // doesn't require a full DB pipeline. The weak path requires a SCORED
    // count in [14, 20); 16 cleared candidates + sleep clears FDR is hard
    // to engineer at the fixture layer (would need a separate synthetic
    // generator) but trivial to assert at the formatter level. Plan 04-09
    // explicitly recommends this approach for the D-34 weak case.
    const weakResult: WeeklyReviewResult = {
      data_status: {
        reviewed_date: '2026-03-15',
        latest_sync_at: '2026-03-15T11:02:14Z',
        latest_sync_status: 'ok',
        staleness_days: 0,
        baseline_window: {
          start: '2026-02-16',
          end: '2026-03-15',
          scored_day_count: 16,
          coverage_pct: 57.1,
        },
        missing_resources: [],
        week_start: '2026-03-09',
        week_end: '2026-03-15',
        pattern_test_window: {
          start: '2026-02-16',
          end: '2026-03-15',
          scored_day_count: 16,
        },
      },
      week_summary: {
        scored_day_count: 6,
        worst_days: [],
        best_day: null,
        avg_strain: null,
        total_sleep_hours: null,
      },
      pattern: {
        kind: 'detected',
        factor: 'sleep_duration_prior_night',
        statistic: { U: 18, p_raw: 0.024, p_adjusted: 0.09 },
        direction: 'worst_days_had_lower',
        pattern_confidence: 'weak',
      },
      candidate_results: [
        {
          factor: 'sleep_duration_prior_night',
          p_raw: 0.024,
          p_adjusted: 0.09,
          cleared: true,
          refused: false,
        },
      ],
      decision_prompt: { kind: 'silent' },
      confidence: { tier: 'weak', coveragePct: 57.1, minRequired: 10, sampleSize: 16 },
    };

    const rendered = renderWeeklyReview(weakResult);
    expect(rendered).toContain('Confidence: weak');
    expect(rendered).toContain('Small sample — effect estimates are imprecise.');
  });
});

describe('renderWeeklyReview — D-22 decision_prompt as FINAL section', () => {
  let h: Harness;
  beforeEach(() => {
    h = makeHarness();
  });
  afterEach(() => h.mem.close());

  it("none_this_week fixture: 'Decision prompt:' is the last section", async () => {
    const spec = loadWeeklyFixture('weekly-decision-prompt-none-this-week');
    loadIntoDb(h, spec);
    const result = await getWeeklyReview({ date: spec.reviewed_date }, h.deps);
    expect(result.decision_prompt.kind).toBe('none_this_week');
    const rendered = renderWeeklyReview(result);
    expect(rendered).toContain('Decision prompt:');
    // The decision prompt is the FINAL paragraph — `lastIndexOf` finds
    // the unique header line; nothing after the suggested_text line.
    const lines = rendered.split('\n');
    const headerIdx = lines.indexOf('Decision prompt:');
    expect(headerIdx).toBeGreaterThan(0);
    // The header line is followed by exactly one indented line (the
    // suggested_text) and then EOF (no trailing empty line at the
    // string boundary because sections.join('\n\n') does not append).
    expect(lines.length - headerIdx).toBe(2);
  });

  it("silent fixture: 'Decision prompt:' omitted entirely", async () => {
    const spec = loadWeeklyFixture('weekly-decision-prompt-none-this-week');
    loadIntoDb(h, spec);
    // Insert a decision dated 2026-03-13 to flip the kind to 'silent'.
    h.repos.decisions.insert({
      id: '01HK7XYZABCD0001234567890A',
      createdAt: '2026-03-13T10:00:00.000Z',
      category: 'sleep',
      decision: 'sleep at least seven hours on training days',
      rationale: null,
      confidence: null,
      expectedEffect: null,
      followUpDate: null,
    });
    const result = await getWeeklyReview({ date: spec.reviewed_date }, h.deps);
    expect(result.decision_prompt.kind).toBe('silent');
    const rendered = renderWeeklyReview(result);
    expect(rendered).not.toContain('Decision prompt:');
  });
});

describe('renderWeeklyReview — candidate_results table ALWAYS rendered', () => {
  let h: Harness;
  beforeEach(() => {
    h = makeHarness();
  });
  afterEach(() => h.mem.close());

  it('weekly-pattern-fdr-suppression: candidate_results header present even when no factor cleared', async () => {
    const spec = loadWeeklyFixture('weekly-pattern-fdr-suppression');
    loadIntoDb(h, spec);
    const result = await getWeeklyReview({ date: spec.reviewed_date }, h.deps);
    const rendered = renderWeeklyReview(result);
    expect(rendered).toContain('Candidate factors (ranked):');
  });

  it('insufficient-window fixture: candidate_results header present with "(no candidates tested)"', async () => {
    const spec = loadWeeklyFixture('weekly-no-pattern-insufficient-window');
    loadIntoDb(h, spec);
    const result = await getWeeklyReview({ date: spec.reviewed_date }, h.deps);
    const rendered = renderWeeklyReview(result);
    expect(rendered).toContain('Candidate factors (ranked):');
    expect(rendered).toContain('(no candidates tested)');
  });
});

describe('renderWeeklyReview — ADR-0005 / D-26 per-formatter sanity sweep', () => {
  let h: Harness;
  beforeEach(() => {
    h = makeHarness();
  });
  afterEach(() => h.mem.close());

  for (const name of WEEKLY_FIXTURE_NAMES) {
    it(`fixture ${name} → rendered output free of banned tokens + emoji`, async () => {
      const spec = loadWeeklyFixture(name);
      loadIntoDb(h, spec);
      const result = await getWeeklyReview({ date: spec.reviewed_date }, h.deps);
      const rendered = renderWeeklyReview(result);
      const hit = containsBannedToneToken(rendered);
      expect(hit.hit).toBe(false);
      expect(EMOJI_RE.test(rendered)).toBe(false);
    });
  }
});
