// Parity contract — DOC-03 / D-18. The committed docs/install/api-gap.md
// MUST stay byte-identical to `renderApiGapMarkdown(API_GAP_ENTRIES)`.
//
// Forcing function: a developer who edits src/domain/api-gap/catalog.ts
// (adds a feature, fixes a typo) without re-running
// `npm run docs:generate-api-gap` loses this test in CI. The failure
// message points straight at the regeneration command (RESEARCH §Pitfall 2).
//
// This test imports the PURE render function directly and diffs strings —
// no `tsx` subprocess (RESEARCH §Open Questions §5, recommendation (b)).
// It is deterministic + offline, so it runs in the default `npm test`
// suite (vitest.config.ts include glob covers tests/**/*.test.ts).

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, test } from 'vitest';
import { renderApiGapMarkdown } from '../../scripts/generate-api-gap-md.js';
import { API_GAP_ENTRIES } from '../../src/domain/api-gap/catalog.js';

describe('api-gap.md parity', () => {
  test('committed docs/install/api-gap.md matches renderApiGapMarkdown(API_GAP_ENTRIES)', () => {
    const generated = renderApiGapMarkdown(API_GAP_ENTRIES);
    // __dirname is tests/contract/; up two levels reaches the repo root.
    const committedPath = resolve(__dirname, '..', '..', 'docs', 'install', 'api-gap.md');
    const committed = readFileSync(committedPath, 'utf8');
    expect(
      committed,
      'docs/install/api-gap.md is out of sync with src/domain/api-gap/catalog.ts. Run `npm run docs:generate-api-gap` and commit the result.',
    ).toBe(generated);
  });
});
