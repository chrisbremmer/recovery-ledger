// Build-time API-gap markdown generator — DOC-03 / D-17 / D-18 / D-19.
//
// Turns the Phase 4 D-28 source-of-truth `API_GAP_ENTRIES` array (in
// `src/services/api-gap/data.ts`) into the human-readable markdown file at
// `docs/install/api-gap.md`. The install guide links that file; this script
// is the single place the markdown is produced.
//
// Two surfaces:
//   1. `renderApiGapMarkdown(entries)` — a PURE function (no I/O, no side
//      effects, deterministic per input). The parity contract test imports
//      it directly and diffs against the committed markdown — no `tsx`
//      subprocess (RESEARCH §Open Questions §5, recommendation (b)).
//   2. A thin CLI wrapper (the `if (isMain)` block) that resolves the repo
//      root, renders `API_GAP_ENTRIES`, and writes `docs/install/api-gap.md`.
//
// Direct import of `API_GAP_ENTRIES` (NOT `services.getApiGap()`): this is a
// build-time tool, so the async/Promise service wrapper buys nothing (D-17).
//
// `process.stdout.write` is used for the CLI confirmation line. This file
// lives under `scripts/`, which is NOT MCP-reachable and is OUTSIDE the
// scope of grep Gate B/Gate C (both scan `src/` only — see
// scripts/ci-grep-gates.sh) and outside ADR-0001's stdout-purity boundary.

import { writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { API_GAP_ENTRIES } from '../src/services/api-gap/data.js';
import type { ApiGapEntry } from '../src/services/api-gap/types.js';

/**
 * Render the API-gap catalog to markdown. Pure: deterministic per input,
 * no side effects. Output ends with EXACTLY one trailing newline so that
 * regenerating over an already-correct file is a no-op (idempotency per
 * RESEARCH §Finding 5).
 */
export function renderApiGapMarkdown(entries: readonly ApiGapEntry[]): string {
  const header = [
    '<!-- Generated from src/services/api-gap/data.ts — do not hand-edit. -->',
    '<!-- Run `npm run docs:generate-api-gap` after changing the source.   -->',
    '',
    '# WHOOP API v2 Gap',
    '',
    'WHOOP consumer-app features that are NOT exposed via the public v2 API.',
    '',
  ];
  const body = entries.flatMap((entry) => [
    `## ${entry.feature}`,
    '',
    `**WHOOP app path:** ${entry.whoop_consumer_path}`,
    '',
    '**Available via v2 API:** No.',
    '',
    `**Closest v2 alternative:** ${entry.alternative_via_v2 ?? 'None.'}`,
    '',
    entry.notes,
    '',
  ]);
  // Join on \n, then collapse any trailing newlines to exactly one. The
  // per-entry block ends with a '' element (a blank separator line); the
  // final entry's trailing blank would otherwise produce a double newline
  // at EOF. The regex normalizes that to a single trailing newline.
  return [...header, ...body].join('\n').replace(/\n+$/, '') + '\n';
}

// CLI wrapper: runs ONLY when this file is invoked directly (tsx
// scripts/generate-api-gap-md.ts), not when imported by the parity test.
const isMain = import.meta.url === pathToFileURL(process.argv[1] ?? '').href;
if (isMain) {
  const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const outPath = resolve(repoRoot, 'docs', 'install', 'api-gap.md');
  const content = renderApiGapMarkdown(API_GAP_ENTRIES);
  writeFileSync(outPath, content, 'utf8');
  process.stdout.write(`Wrote ${outPath}\n`);
}
