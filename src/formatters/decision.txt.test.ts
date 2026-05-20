// renderDecisionList / renderDecisionDetail / renderDecisionUpdate tests
// — pure (typedResult) => string assertions over the 3 decision fixtures.
// Anchors:
//   - D-20 column widths + ellipsis truncation + over-window asterisk.
//   - D-21 update form: 'decision <ulid-prefix> updated to <status>'.
//   - Detail form: multi-line all-fields block.
//   - Shape dispatch: list / detail / update narrow via input shape.
//   - ADR-0005 / D-26 per-formatter sanity sweep: NO banned tokens in
//     rendered output.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { containsBannedToneToken, EMOJI_RE } from '../domain/banned-words.js';
import type { Decision } from '../domain/types/entities.js';
import type { ReviewDecisionsResult } from '../services/decision/types.js';
import {
  renderDecisionDetail,
  renderDecisionList,
  renderDecisionUpdate,
} from './decision.txt.js';

const FIXTURES_DIR = resolve(__dirname, '../../tests/fixtures/decisions');

function loadFixture<T>(name: string): T {
  return JSON.parse(readFileSync(resolve(FIXTURES_DIR, `${name}.json`), 'utf-8')) as T;
}

const FIXED_NOW = new Date('2026-03-15T15:00:00.000Z');

describe('renderDecisionList — list mode (Decision[])', () => {
  it('renders 3 decisions from the review-list fixture with column headers', () => {
    const fx = loadFixture<{ decisions: Decision[] }>('decision-review-list');
    const rendered = renderDecisionList(fx.decisions, FIXED_NOW);
    expect(rendered).toContain('ID');
    expect(rendered).toContain('Category');
    expect(rendered).toContain('Decision');
    expect(rendered).toContain('Elapsed/Window');
    expect(rendered).toContain('Status');
    // Three id prefixes (first 8 chars of each ULID).
    expect(rendered).toContain('01HK7XYZ');
    expect(rendered).toContain('01HK7ABC');
    expect(rendered).toContain('01HK7PQR');
  });

  it('over-window decision renders the asterisk suffix on elapsed column', () => {
    const fx = loadFixture<{ decisions: Decision[] }>('decision-review-list');
    const rendered = renderDecisionList(fx.decisions, FIXED_NOW);
    // The 'deload week' decision was created 2026-03-03 with followUp 2026-03-10
    // → 12 elapsed days vs 7d window → over_window.
    expect(rendered).toMatch(/12d\/7d\*/);
  });

  it('within-window decision renders elapsed without asterisk', () => {
    const fx = loadFixture<{ decisions: Decision[] }>('decision-review-list');
    const rendered = renderDecisionList(fx.decisions, FIXED_NOW);
    // 'sleep at least seven hours' was created 2026-03-12 → 3d / 7d window.
    expect(rendered).toMatch(/3d\/7d(?!\*)/);
  });

  it('empty array renders "No decisions recorded."', () => {
    const rendered = renderDecisionList([], FIXED_NOW);
    expect(rendered).toBe('No decisions recorded.');
  });

  it('long decision text truncates to ellipsis at the column width', () => {
    const long: Decision = {
      id: '01HK7XYZABCD0001234567890A',
      createdAt: '2026-03-12T00:00:00.000Z',
      category: 'sleep',
      decision: 'a very long decision text that absolutely exceeds the forty character cap',
      rationale: null,
      confidence: null,
      expectedEffect: null,
      followUpDate: null,
      status: 'open',
      outcomeNotes: null,
    };
    const rendered = renderDecisionList([long], FIXED_NOW);
    expect(rendered).toContain('...');
    // The full text must NOT appear.
    expect(rendered).not.toContain('forty character cap');
  });
});

describe('renderDecisionDetail — detail mode (single Decision)', () => {
  it('renders multi-line detail block for the happy-path fixture', () => {
    const fx = loadFixture<{ decision: Decision }>('decision-add-happy-path');
    const rendered = renderDecisionDetail(fx.decision);
    expect(rendered).toContain('Decision 01HK7XYZABCD0001234567890A');
    expect(rendered).toContain('Created: 2026-03-15T15:00:00.000Z');
    expect(rendered).toContain('Category: sleep');
    expect(rendered).toContain('Status: open');
    expect(rendered).toContain('Decision: sleep at least seven hours on training days');
    expect(rendered).toContain('Confidence: medium');
    expect(rendered).toContain('Expected effect: +5% HRV by next weekly review');
    expect(rendered).toContain('Follow-up date: 2026-03-22');
  });

  it('omits null fields from the detail block', () => {
    const fx = loadFixture<{ decision: Decision }>('decision-add-happy-path');
    const rendered = renderDecisionDetail(fx.decision);
    expect(rendered).not.toContain('Rationale:');
    expect(rendered).not.toContain('Outcome notes:');
  });
});

describe('renderDecisionUpdate — update mode (D-21 single-line)', () => {
  it("renders 'decision <prefix> updated to <status>' single-line confirmation", () => {
    const fx = loadFixture<{ result: ReviewDecisionsResult }>(
      'decision-review-interactive-update',
    );
    if (fx.result.mode !== 'update') throw new Error('fixture is not update-mode');
    const rendered = renderDecisionUpdate(fx.result.decision);
    expect(rendered).toBe('decision 01HK7XYZ updated to followed_up');
  });
});

describe('renderDecisionList — shape dispatch', () => {
  it('dispatches Decision[] → list table', () => {
    const fx = loadFixture<{ decisions: Decision[] }>('decision-review-list');
    const rendered = renderDecisionList(fx.decisions, FIXED_NOW);
    expect(rendered).toContain('Category');
  });

  it('dispatches ReviewDecisionsResult mode=list → list table', () => {
    const fx = loadFixture<{ decisions: Decision[] }>('decision-review-list');
    const result: ReviewDecisionsResult = { mode: 'list', decisions: fx.decisions };
    const rendered = renderDecisionList(result, FIXED_NOW);
    expect(rendered).toContain('Category');
  });

  it('dispatches ReviewDecisionsResult mode=update → D-21 confirmation', () => {
    const fx = loadFixture<{ result: ReviewDecisionsResult }>(
      'decision-review-interactive-update',
    );
    const rendered = renderDecisionList(fx.result, FIXED_NOW);
    expect(rendered).toBe('decision 01HK7XYZ updated to followed_up');
  });

  it('dispatches single Decision → detail block', () => {
    const fx = loadFixture<{ decision: Decision }>('decision-add-happy-path');
    const rendered = renderDecisionList(fx.decision, FIXED_NOW);
    expect(rendered).toContain('Decision 01HK7XYZABCD0001234567890A');
    expect(rendered).toContain('Category: sleep');
  });
});

describe('renderDecisionList — ADR-0005 / D-26 per-formatter sanity sweep', () => {
  it('list output free of banned tokens + emoji', () => {
    const fx = loadFixture<{ decisions: Decision[] }>('decision-review-list');
    const rendered = renderDecisionList(fx.decisions, FIXED_NOW);
    expect(containsBannedToneToken(rendered).hit).toBe(false);
    expect(EMOJI_RE.test(rendered)).toBe(false);
  });

  it('detail output free of banned tokens + emoji', () => {
    const fx = loadFixture<{ decision: Decision }>('decision-add-happy-path');
    const rendered = renderDecisionDetail(fx.decision);
    expect(containsBannedToneToken(rendered).hit).toBe(false);
    expect(EMOJI_RE.test(rendered)).toBe(false);
  });

  it('update output free of banned tokens + emoji', () => {
    const fx = loadFixture<{ result: ReviewDecisionsResult }>(
      'decision-review-interactive-update',
    );
    if (fx.result.mode !== 'update') throw new Error('fixture is not update-mode');
    const rendered = renderDecisionUpdate(fx.result.decision);
    expect(containsBannedToneToken(rendered).hit).toBe(false);
    expect(EMOJI_RE.test(rendered)).toBe(false);
  });
});
