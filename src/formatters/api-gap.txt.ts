// API-gap renderer — ApiGapResult → compact text per D-28. Pure function;
// no I/O, no logger, no DB. The caller (CLI `api-gap` command or MCP
// `whoop_api_gap` tool) writes the string to its own surface per
// ADR-0001 (formatters never call console.* or process.stdout.write).
//
// D-28 output shape: one paragraph per ApiGapEntry, format:
//
//   <feature>: <whoop_consumer_path>
//     Not available via WHOOP v2 API. <alternative or "No closest proxy.">
//     <notes>
//
// Each entry surfaces the full catalog context: where the user sees the
// feature in the WHOOP consumer app, the closest substitute (or that
// no substitute exists), and the free-form notes carrying the reasoning.
//
// ADR-0005 / D-26 banned-tone-words: catalog entries already pass the
// source-layer lint at Plan 04-06 (`src/services/api-gap/data.ts`). The
// D-26 contract test re-checks the rendered output here.

import type { ApiGapEntry, ApiGapResult } from '../services/api-gap/types.js';

const ENTRY_INDENT = '  ';

export function renderApiGap(result: ApiGapResult): string {
  if (result.entries.length === 0) {
    return 'No API gap entries registered.';
  }
  const paragraphs: string[] = result.entries.map(renderEntry);
  return paragraphs.join('\n\n');
}

function renderEntry(entry: ApiGapEntry): string {
  const lines: string[] = [`${entry.feature}: ${entry.whoop_consumer_path}`];
  if (entry.alternative_via_v2 === null) {
    lines.push(`${ENTRY_INDENT}Not available via WHOOP v2 API. No closest proxy.`);
  } else {
    lines.push(`${ENTRY_INDENT}Not available via WHOOP v2 API. ${entry.alternative_via_v2}.`);
  }
  lines.push(`${ENTRY_INDENT}${entry.notes}`);
  return lines.join('\n');
}
