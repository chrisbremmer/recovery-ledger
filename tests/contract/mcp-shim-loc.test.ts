// MCP-03 — ≤5-line shim discipline for every src/mcp/tools/*.ts handler.
//
// Per agent_docs/conventions.md §Module layout + CLAUDE.md, MCP tool
// modules MUST be ≤5-line shims over the services layer. This contract
// test reads each tool file from disk, locates the `register(server,
// '<name>', {...}, async (input) => { ... })` call, and counts non-blank
// non-comment statements between the arrow `=> {` and the matching `}`.
//
// The 5-statement ceiling is the MCP-03 discipline. Tools that breach
// it indicate business logic has leaked from the services layer into
// the transport shim.
//
// Implementation: regex finds the `register(` body via balanced-brace
// walking, then splits the body lines on `;`/newline and counts
// statements after filtering blanks + line-comments + block-comment
// closers. AST parsing would be cleaner but adds a heavy dev dep for
// a low-volume scan; the regex is sufficient for the ≤5-LOC discipline.
//
// This same approach extends to src/mcp/resources/*.ts (handler bodies
// are similarly tight) and src/mcp/prompts/*.ts (build-prompt-message +
// formatter call + return — usually 3 statements).

import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const TOOLS_DIR = resolve(__dirname, '..', '..', 'src', 'mcp', 'tools');
const RESOURCES_DIR = resolve(__dirname, '..', '..', 'src', 'mcp', 'resources');
const PROMPTS_DIR = resolve(__dirname, '..', '..', 'src', 'mcp', 'prompts');

// 5-statement MCP-03 ceiling. Anchored as a literal `5` in the test
// descriptions below so a static reviewer can grep this file.
const MCP_03_LOC_CEILING = 5;

function listTsFiles(dir: string): string[] {
  try {
    return readdirSync(dir)
      .filter((n) => n.endsWith('.ts') && !n.endsWith('.test.ts'))
      .sort();
  } catch {
    return [];
  }
}

// Locate the body of a `register(...)`, `registerResource(...)`, or
// `registerPrompt(...)` call's final-arg arrow function and count
// non-blank non-comment statements.
//
// The call signature is `registerX(server, name, config, async (...) => { BODY })`
// where BODY is a TS block. We walk forward from the call site, track
// brace depth, and return the BODY text between the outermost `{` and
// matching `}`.
function findHandlerBody(source: string, registerFn: string): string | null {
  const callStart = source.indexOf(`${registerFn}(`);
  if (callStart < 0) return null;
  // Walk forward to the first `=>` after the call site.
  const arrowIdx = source.indexOf('=>', callStart);
  if (arrowIdx < 0) return null;
  // Find the opening brace of the arrow function body.
  let i = arrowIdx + 2;
  while (i < source.length && source[i] !== '{') i += 1;
  if (i >= source.length) return null;
  const bodyStart = i + 1;
  // Walk the balanced braces.
  let depth = 1;
  let j = bodyStart;
  while (j < source.length && depth > 0) {
    const ch = source[j];
    if (ch === '{') depth += 1;
    else if (ch === '}') depth -= 1;
    if (depth === 0) break;
    j += 1;
  }
  if (depth !== 0) return null;
  return source.slice(bodyStart, j);
}

// Count non-blank non-comment STATEMENTS in a TS block body. We count
// top-level `;` terminators at brace-depth zero (i.e., the statement
// terminators of the body itself — not the `;` inside object literals or
// nested function bodies). A handler with `const result = ...; return
// {...};` reports 2 statements regardless of how the Biome formatter
// wraps the long argument list across lines.
function countStatements(body: string): number {
  // Remove block comments + line comments — both can carry stray `;`.
  const noBlock = body.replace(/\/\*[\s\S]*?\*\//g, '');
  const noLine = noBlock.replace(/\/\/[^\n]*/g, '');
  // Strip template-literal and quoted-string contents — `;` inside a
  // string literal is not a statement terminator.
  const noStrings = noLine
    .replace(/`(?:\\.|[^`\\])*`/g, '""')
    .replace(/'(?:\\.|[^'\\])*'/g, '""')
    .replace(/"(?:\\.|[^"\\])*"/g, '""');
  let depth = 0;
  let count = 0;
  for (let i = 0; i < noStrings.length; i += 1) {
    const ch = noStrings[i];
    if (ch === '{' || ch === '(' || ch === '[') depth += 1;
    else if (ch === '}' || ch === ')' || ch === ']') depth -= 1;
    else if (ch === ';' && depth === 0) count += 1;
  }
  return count;
}

describe('Phase 4 MCP tool shim LOC contract — MCP-03 (handler body has 5 or fewer statements)', () => {
  const toolFiles = listTsFiles(TOOLS_DIR);

  it('discovered at least 8 tool files (whoop_doctor + 7 new)', () => {
    expect(toolFiles.length).toBeGreaterThanOrEqual(8);
  });

  for (const file of toolFiles) {
    it(`${file} register() handler body has 5 or fewer statements`, () => {
      const source = readFileSync(resolve(TOOLS_DIR, file), 'utf-8');
      const body = findHandlerBody(source, 'register');
      expect(body, `${file}: register() call not found`).not.toBeNull();
      if (body === null) return;
      const count = countStatements(body);
      expect(
        count,
        `${file}: register() handler body has ${count} statements (limit ${MCP_03_LOC_CEILING})\nBODY:\n${body}`,
      ).toBeLessThanOrEqual(MCP_03_LOC_CEILING);
    });
  }
});

describe('Phase 4 MCP resource shim LOC contract — extends MCP-03 (handler body 5 or fewer)', () => {
  const resourceFiles = listTsFiles(RESOURCES_DIR);

  for (const file of resourceFiles) {
    it(`${file} registerResource() handler body has 5 or fewer statements`, () => {
      const source = readFileSync(resolve(RESOURCES_DIR, file), 'utf-8');
      const body = findHandlerBody(source, 'registerResource');
      // Wave 0 + Task 1 stubs have no registerResource call yet; skip.
      if (body === null) return;
      const count = countStatements(body);
      expect(
        count,
        `${file}: registerResource() handler body has ${count} statements (limit ${MCP_03_LOC_CEILING})\nBODY:\n${body}`,
      ).toBeLessThanOrEqual(MCP_03_LOC_CEILING);
    });
  }
});

describe('Phase 4 MCP prompt shim LOC contract — extends MCP-03 (handler body 5 or fewer)', () => {
  const promptFiles = listTsFiles(PROMPTS_DIR);

  for (const file of promptFiles) {
    if (file === 'build.ts') continue; // build helper has no register* call.
    it(`${file} registerPrompt() handler body has 5 or fewer statements`, () => {
      const source = readFileSync(resolve(PROMPTS_DIR, file), 'utf-8');
      const body = findHandlerBody(source, 'registerPrompt');
      // Task 1 stubs have no registerPrompt call yet; skip.
      if (body === null) return;
      const count = countStatements(body);
      expect(
        count,
        `${file}: registerPrompt() handler body has ${count} statements (limit ${MCP_03_LOC_CEILING})\nBODY:\n${body}`,
      ).toBeLessThanOrEqual(MCP_03_LOC_CEILING);
    });
  }
});
