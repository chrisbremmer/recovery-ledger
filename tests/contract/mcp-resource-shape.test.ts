// MCP-04 / D-36 — read-shape contract for every registered MCP resource.
//
// Resources return `contents: Array<{uri, text, mimeType}>` (note plural
// `contents`, distinct from tools' singular `content`). Wave 0 (Plan
// 04-01) ships the scaffold — Plan 04-12 (MCP resources wave) fills the
// describe.each loop over the 6 registered resources.

import { describe, it } from 'vitest';

describe('Phase 4 MCP resource read-shape contract — MCP-04', () => {
  it.todo(
    'every registered MCP resource (whoop://summary/today, whoop://summary/week, whoop://baseline/30d, whoop://data-quality, whoop://api-gaps, whoop://decisions/open) returns {contents: [{uri: string, text: string, mimeType: string}]} per the static-URI form documented in 04-RESEARCH.md §registerResource',
  );

  it.todo(
    'D-36 attestation: every resource went through src/mcp/register-resource.ts (Gate I covers static enforcement; this runtime check confirms the sanitizer wrapper actually ran by inspecting a fixture handler that throws and asserts isError:true)',
  );

  it.todo('resources.length === 6 with the canonical URI set per the D-29 attestation update');
});

// MCP-04 surface name `contents` (plural, distinct from tools' singular
// `content`) is referenced inside the describe block + it.todo
// descriptions above — anchored in prose so static reviewers can grep
// this file by purpose (Biome's noExportsInTest rule forbids exports).
