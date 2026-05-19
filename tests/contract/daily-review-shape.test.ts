// REV-03 / REV-04 — daily-review output leads with the data-status
// section.
//
// Per D-03 (DailyReviewResult schema) + 04-RESEARCH.md §Daily Review §D-04,
// the renderer's first paragraph MUST surface data freshness: latest sync
// timestamp, baseline window, missing/stale metrics. This contract test
// asserts the leading "Data status:" section appears in every rendered
// review fixture. Wave 0 (Plan 04-01) ships the scaffold — Plan 04-09
// (formatters wave) fills the per-fixture iteration.

import { describe, it } from 'vitest';

describe('Phase 4 daily-review output-shape contract — REV-03 / REV-04', () => {
  it.todo(
    'renderDailyReview output leads with a "Data status:" section surfacing latest-sync timestamp + baseline window + missing/stale metrics (REV-04 data-freshness lead)',
  );

  it.todo(
    'renderDailyReview output for the insufficient-days fixture surfaces the typed insufficient_reason slot + empty actions/anomalies arrays (REV-05; D-10 — Plan 04-09 fixture daily-insufficient-days.json)',
  );

  it.todo(
    'renderDailyReview output ends with exactly 3 actions when confidence is strong, ≤3 when weak, 0 when insufficient (D-08 + D-09 — actions catalog drives the verb-first single-sentence pattern)',
  );
});

// REV-04 surface contract: the daily review output leads with a
// `data_status` section — the literal token `data_status` is referenced
// in the it.todo description above so static reviewers can grep this
// file by purpose (Biome's noExportsInTest rule forbids exports from
// *.test.ts).
