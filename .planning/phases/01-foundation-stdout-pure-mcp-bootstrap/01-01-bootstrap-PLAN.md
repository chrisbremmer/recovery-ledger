---
phase: 01-foundation-stdout-pure-mcp-bootstrap
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - package.json
  - package-lock.json
  - tsconfig.json
  - tsup.config.ts
  - vitest.config.ts
  - biome.json
  - .nvmrc
  - .gitattributes
  - .gitignore
autonomous: true
requirements:
  - FND-01
requirements_addressed:
  - FND-01
tags:
  - bootstrap
  - typescript
  - tooling
must_haves:
  truths:
    - "D-01: Repo can install with `npm ci` against a committed `package-lock.json` on Node 22 LTS (npm is the v1 package manager — pnpm/bun rejected)"
    - "TypeScript strict + NodeNext + ESM compiles with `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes` on"
    - "`tsup` is configured with two entries (cli, mcp), shebang banner, and native modules externalized"
    - "Vitest is configured with `pool: 'forks'` and the include glob covers src + test"
    - "D-04: Biome `noConsole` rule is enabled globally with no `allow` list; overrides for `src/cli/**/*.ts` and `**/*.test.ts` are wired (CI grep gate on `biome-ignore.*noConsole` lands in Plan 04)"
    - "D-11: Source layout scaffolds only the Phase 1 directories listed in CONTEXT.md D-11 — no empty placeholder directories for Phases 2+, no `.gitkeep` files"
    - "Running `npm run lint` and `npm run test` on the empty repo exits 0 (no source files yet, no errors)"
  artifacts:
    - path: "package.json"
      provides: "npm-managed ESM project with bin entries, scripts, engines"
      contains: "\"type\": \"module\""
    - path: "tsconfig.json"
      provides: "Strict TS + NodeNext + ESM compiler settings"
      contains: "\"strict\": true"
    - path: "tsup.config.ts"
      provides: "Two-entry ESM bundler config with shebang banner and native external list"
      contains: "external: ['better-sqlite3', '@napi-rs/keyring']"
    - path: "vitest.config.ts"
      provides: "Vitest config with pool: 'forks' for native-module isolation"
      contains: "pool: 'forks'"
    - path: "biome.json"
      provides: "Biome lint/format with noConsole rule (overrides come in Plan 04)"
      contains: "\"noConsole\""
    - path: ".nvmrc"
      provides: "Node version pin"
      contains: "22"
    - path: ".gitignore"
      provides: "Ignore node_modules, dist, coverage, logs, .env"
      contains: "node_modules"
    - path: ".gitattributes"
      provides: "LF line-endings for TS/JSON/MJS"
      contains: "*.ts text eol=lf"
  key_links:
    - from: "package.json"
      to: "tsup.config.ts"
      via: "scripts.build = 'tsup'"
      pattern: "\"build\":\\s*\"tsup\""
    - from: "package.json"
      to: "vitest.config.ts"
      via: "scripts.test = 'vitest run'"
      pattern: "\"test\":\\s*\"vitest run\""
    - from: "package.json"
      to: "biome.json"
      via: "scripts.lint = 'biome check'"
      pattern: "\"lint\":\\s*\"biome check\""
    - from: "package.json"
      to: "dist/cli.mjs + dist/mcp.mjs"
      via: "bin field maps published names to compiled artifacts"
      pattern: "\"recovery-ledger\":\\s*\"\\./dist/cli\\.mjs\""
---

<objective>
Bootstrap the TypeScript repo with npm, ESM, strict TS, tsup, Vitest, and Biome — the discipline-phase configuration files that every subsequent plan and every later phase depend on. No source code, no tests with bodies; this plan only lays the configuration substrate so Plans 02-05 can drop in `src/` files that compile, lint, and run on the first try.

Purpose: FND-01 declares that the bootstrapped TypeScript repo (Node 22 LTS, ESM, tsup build, tsx dev, Biome, Vitest) is configured. This plan delivers exactly that, no more, no less. Pin every version verbatim to STACK.md (no auto-bump to TypeScript 6.x — that is a separate ADR).

Output: Eight committed config files; `npm ci`, `npm run build`, `npm run lint`, and `npm run test` all run successfully on an empty `src/` and `test/` tree (lint and test on zero files is a successful no-op).
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/PROJECT.md
@.planning/ROADMAP.md
@.planning/STATE.md
@.planning/REQUIREMENTS.md
@.planning/research/STACK.md
@.planning/research/ARCHITECTURE.md
@.planning/research/PITFALLS.md
@.planning/phases/01-foundation-stdout-pure-mcp-bootstrap/01-CONTEXT.md
@.planning/phases/01-foundation-stdout-pure-mcp-bootstrap/01-RESEARCH.md
@.planning/phases/01-foundation-stdout-pure-mcp-bootstrap/01-VALIDATION.md
@CLAUDE.md

<interfaces>
<!-- Versions pinned verbatim from STACK.md + 01-RESEARCH.md "Standard Stack" table.
     Any version drift is a new ADR, not a silent change. -->

Production deps (Phase 1):
- @modelcontextprotocol/sdk@^1.29.0
- better-sqlite3@^12.9.0
- @napi-rs/keyring@^1.3.0
- commander@^14.0.3
- pino@^10.3.1
- zod@^4.4.3

Dev deps (Phase 1):
- typescript@^5.7      # do NOT bump to 6.x — STACK.md pins 5.7 line
- @types/node@^22
- @types/better-sqlite3@^7
- tsx@^4.21
- tsup@^8.5
- vitest@^4.1.6
- pino-pretty@^13
- @biomejs/biome@^2.4.15

Note: MSW is deferred to Phase 4 per RESEARCH.md "Supporting" table — do NOT install it in Phase 1.
</interfaces>
</context>

<tasks>

<task type="auto">
  <name>Task 1: Write package.json, tsconfig.json, .nvmrc, .gitignore, .gitattributes</name>
  <files>package.json, tsconfig.json, .nvmrc, .gitignore, .gitattributes</files>
  <read_first>
    - .planning/research/STACK.md (versions, install commands)
    - .planning/phases/01-foundation-stdout-pure-mcp-bootstrap/01-RESEARCH.md (Standard Stack table; Code Examples §`package.json (Phase 1)`, §`tsconfig.json`, §`.nvmrc`, §`.gitattributes`, §`.gitignore`)
    - .planning/phases/01-foundation-stdout-pure-mcp-bootstrap/01-CONTEXT.md (D-01 npm; D-11 source layout — bin entries point at dist/cli.mjs and dist/mcp.mjs)
    - CLAUDE.md §Stack, §Code Style, §Bash
  </read_first>
  <action>
    Create five top-level files anchored to the exact templates in 01-RESEARCH.md §Code Examples. `package.json`: `"name": "recovery-ledger"`, `"version": "0.1.0"`, `"type": "module"`, `"engines": { "node": ">=22.11" }`, `"files": ["dist"]`, `bin` map with `recovery-ledger` → `./dist/cli.mjs` and `recovery-ledger-mcp` → `./dist/mcp.mjs`, scripts: `build` = `tsup`, `dev:cli` = `tsx watch src/cli/index.ts`, `dev:mcp` = `tsx src/mcp/index.ts`, `test` = `vitest run`, `lint` = `biome check`, `format` = `biome check --write`. Install deps in the two `npm install` blocks from the RESEARCH §Installation (production then dev). Use the caret-pinned versions from the Standard Stack table — do NOT bump TypeScript to 6.x (STACK.md pins 5.7 line per A4 in Assumptions Log). After install, `package-lock.json` is generated by npm — commit it. Do NOT install MSW (deferred to Phase 4 per RESEARCH §Supporting). `tsconfig.json`: copy the RESEARCH example verbatim — `target: ES2023`, `module: NodeNext`, `moduleResolution: NodeNext`, `strict: true`, `noUncheckedIndexedAccess: true`, `exactOptionalPropertyTypes: true`, `esModuleInterop: true`, `skipLibCheck: true`, `verbatimModuleSyntax: true`, `outDir: dist`, `rootDir: .`, `include: ["src/**/*", "test/**/*", "*.ts"]`, `exclude: ["dist", "node_modules"]`. `.nvmrc`: single line `22`. `.gitignore`: per RESEARCH §`.gitignore` — `node_modules/`, `dist/`, `coverage/`, `*.log`, `.env`, `.env.local`, `.DS_Store`. `.gitattributes`: per RESEARCH §`.gitattributes` — LF eol for `*.ts`, `*.json`, `*.mjs`.
  </action>
  <verify>
    <automated>npm ci && test -f package-lock.json && node -e "const p=require('./package.json'); if(p.type!=='module'||!p.bin['recovery-ledger']||!p.bin['recovery-ledger-mcp']||p.engines.node!=='>=22.11') process.exit(1)" && node -e "const t=require('./tsconfig.json').compilerOptions; if(!t.strict||!t.noUncheckedIndexedAccess||!t.exactOptionalPropertyTypes||t.module!=='NodeNext') process.exit(1)" && grep -q "^22$" .nvmrc && grep -q "^node_modules/$" .gitignore && grep -q "^\*\.ts text eol=lf" .gitattributes && echo OK</automated>
  </verify>
  <done>
    `npm ci` exits 0 and produces `node_modules/` + a committed `package-lock.json`; all six pinned production deps and all eight pinned dev deps resolve to versions within their caret ranges from RESEARCH.md (verifiable via `npm ls --depth=0`); `tsconfig.json` enables `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, and uses `NodeNext` module/resolution; `.nvmrc`, `.gitignore`, `.gitattributes` exist with the documented contents.
  </done>
  <acceptance_criteria>
    - Source: `package.json` contains `"type": "module"` AND `"recovery-ledger": "./dist/cli.mjs"` AND `"recovery-ledger-mcp": "./dist/mcp.mjs"` AND `"node": ">=22.11"` AND `"build": "tsup"` AND `"test": "vitest run"` AND `"lint": "biome check"`.
    - Source: `tsconfig.json` contains `"strict": true` AND `"noUncheckedIndexedAccess": true` AND `"exactOptionalPropertyTypes": true` AND `"module": "NodeNext"` AND `"verbatimModuleSyntax": true`.
    - Behavior: `npm ci` exits 0 against the committed lockfile.
    - Behavior: `node -e "require('@modelcontextprotocol/sdk/package.json')"` exits 0 (confirms the SDK was installed and resolvable).
    - Source: `.nvmrc` is exactly `22\n`.
    - Source: `.gitignore` contains `node_modules/` and `dist/`.
    - Source: `.gitattributes` contains `*.ts text eol=lf`.
    - Source: `package.json` does NOT contain `"msw"` (MSW deferred to Phase 4 per RESEARCH §Supporting).
    - Source: `package.json` `devDependencies.typescript` starts with `^5.` (not `^6.`) — A4 in Assumptions Log.
  </acceptance_criteria>
</task>

<task type="auto">
  <name>Task 2: Write tsup.config.ts, vitest.config.ts, biome.json</name>
  <files>tsup.config.ts, vitest.config.ts, biome.json</files>
  <read_first>
    - .planning/phases/01-foundation-stdout-pure-mcp-bootstrap/01-RESEARCH.md (Code Examples §`tsup.config.ts`, §`vitest.config.ts`, §`biome.json`; Pitfalls 4, 5; Assumptions A4-A5)
    - .planning/phases/01-foundation-stdout-pure-mcp-bootstrap/01-CONTEXT.md (D-04 noConsole rule with src/cli/** override; D-11 source layout — two entries are src/cli/index.ts and src/mcp/index.ts)
    - .planning/research/STACK.md §Logging — MUST NOT pollute stdout (motivation for noConsole)
    - .planning/research/PITFALLS.md Pitfall 1 (stdout corruption — motivates Biome + grep + test)
    - CLAUDE.md §Critical Rules (MCP stdout purity), §Testing (`pool: 'forks'` mandatory)
    - .planning/phases/01-foundation-stdout-pure-mcp-bootstrap/01-VALIDATION.md (Test Infrastructure table — quick-run + full-suite commands)
    - The just-written package.json (so the configs match the scripts they back)
  </read_first>
  <action>
    Create three config files anchored to the exact templates in 01-RESEARCH.md §Code Examples. `tsup.config.ts`: ESM TypeScript module, default export `defineConfig({ entry: { cli: 'src/cli/index.ts', mcp: 'src/mcp/index.ts' }, format: ['esm'], target: 'node22', outDir: 'dist', outExtension: () => ({ js: '.mjs' }), banner: { js: '#!/usr/bin/env node' }, external: ['better-sqlite3', '@napi-rs/keyring'], clean: true, sourcemap: true, splitting: false, treeshake: true })`. The `external` array MUST contain both native modules verbatim (Pitfall 4). `vitest.config.ts`: ESM TypeScript module, default export `defineConfig({ test: { pool: 'forks', poolOptions: { forks: { singleFork: false } }, include: ['src/**/*.test.ts', 'test/**/*.test.ts'], testTimeout: 10_000, hookTimeout: 10_000 } })`. The `pool: 'forks'` setting is mandatory per CLAUDE.md §Testing — native modules don't cross worker threads (Pitfall 5). `biome.json`: copy the RESEARCH example verbatim. `$schema` pinned to the 2.4.15 schema URL; `files.includes` covers `src/**/*.ts`, `test/**/*.ts`, `*.ts`; `files.ignore` covers `dist/**`, `node_modules/**`; `linter.rules.recommended: true` AND `linter.rules.suspicious.noConsole: "error"` (globally on — no allow list per D-04); `formatter` enabled with 2-space indent and lineWidth 100. **Important:** Plan 01 sets the *initial* biome.json. The `src/cli/**/*.ts` and `**/*.test.ts` overrides for `noConsole: off` are also included now per D-04 — A4 in Assumptions Log warns the planner should verify the JSON path against Biome 2.4.15 schema at exec time. If `npm run lint` rejects the path, fall back to whichever path Biome 2.4.15 documents for noConsole (`linter.rules.suspicious.noConsole` is the documented path per RESEARCH §Code Examples).
  </action>
  <verify>
    <automated>node -e "require('./tsup.config.ts')" 2>/dev/null || npx tsx -e "import('./tsup.config.ts').then(m => { const c=m.default; if(!c.entry?.cli||!c.entry?.mcp||!c.external?.includes('better-sqlite3')||!c.external?.includes('@napi-rs/keyring')||c.banner?.js!=='#!/usr/bin/env node') process.exit(1); })" && grep -q "pool: 'forks'" vitest.config.ts && grep -q "\"noConsole\"" biome.json && grep -q "src/cli/\*\*/\*\.ts" biome.json && npm run lint && echo OK</automated>
  </verify>
  <done>
    `tsup.config.ts` declares two entries (cli, mcp), shebang banner, ESM/node22, and both native modules in `external`; `vitest.config.ts` declares `pool: 'forks'`; `biome.json` enables `noConsole` globally with `src/cli/**/*.ts` and `**/*.test.ts` overrides; `npm run lint` exits 0 on the empty source tree.
  </done>
  <acceptance_criteria>
    - Source: `tsup.config.ts` contains `entry: { cli: 'src/cli/index.ts', mcp: 'src/mcp/index.ts' }`.
    - Source: `tsup.config.ts` contains `external: ['better-sqlite3', '@napi-rs/keyring']`.
    - Source: `tsup.config.ts` contains `banner: { js: '#!/usr/bin/env node' }`.
    - Source: `tsup.config.ts` contains `format: ['esm']` AND `target: 'node22'`.
    - Source: `vitest.config.ts` contains `pool: 'forks'`.
    - Source: `biome.json` contains `"noConsole": "error"` (per RESEARCH §Code Examples).
    - Source: `biome.json` contains override targeting `src/cli/**/*.ts` with `noConsole: "off"`.
    - Source: `biome.json` contains override targeting `**/*.test.ts` with `noConsole: "off"`.
    - Behavior: `npm run lint` exits 0 against the empty source tree.
    - Behavior: `npx tsc --noEmit` exits 0 (tsconfig.json loads cleanly even with no source files).
  </acceptance_criteria>
</task>

</tasks>

<verification>
1. `npm ci` from a clean clone produces a working `node_modules/` and the committed lockfile is consistent.
2. `npm run lint` exits 0 on the empty source tree.
3. `npm run test` exits 0 (no test files yet) — Vitest reports "No test files found, exiting with code 0" with the configured pool.
4. `node -e "..."` introspection confirms `package.json` has the bin entries, type module, engines, and scripts; `tsconfig.json` has the three strict flags; `tsup.config.ts` has the two entries and the native externals; `biome.json` has the noConsole rule.
5. No `src/`, `test/`, `dist/`, or `.github/` directories exist yet — those land in Plans 02-06.
</verification>

<success_criteria>
- All eight config files committed (`package.json`, `package-lock.json`, `tsconfig.json`, `tsup.config.ts`, `vitest.config.ts`, `biome.json`, `.nvmrc`, `.gitignore`, `.gitattributes`).
- Every pinned dep version from STACK.md / RESEARCH §Standard Stack is within the installed caret ranges.
- `npm ci && npm run lint && npm run test` exits 0 end-to-end on the empty source tree (the `build` step requires `src/` files and is exercised in Plans 03 + 05 + 06).
- No `src/`, `test/`, `dist/`, or `.github/` directories created — this plan is config-only.
</success_criteria>

<output>
After completion, create `.planning/phases/01-foundation-stdout-pure-mcp-bootstrap/01-01-SUMMARY.md` documenting: which configs landed verbatim from RESEARCH.md, any deviations forced by Biome 2.4.15 schema reality (A4), and the exact installed versions of the eleven dependencies pinned in STACK.md.
</output>
