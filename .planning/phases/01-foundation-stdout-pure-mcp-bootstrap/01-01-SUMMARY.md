---
phase: 01-foundation-stdout-pure-mcp-bootstrap
plan: 01
subsystem: infra
tags: [bootstrap, typescript, npm, tsup, vitest, biome, esm, node22]

requires: []
provides:
  - npm-managed ESM repo on Node 22 LTS with package-lock.json checked in
  - Strict TypeScript 5.7 + NodeNext compiler settings (noUncheckedIndexedAccess, exactOptionalPropertyTypes)
  - tsup config with two ESM entries (cli, mcp), shebang banner, native modules externalized
  - Vitest config with pool 'forks' (mandatory per CLAUDE.md for native-module isolation)
  - Biome lint/format with noConsole globally as 'error' plus src/cli and *.test.ts overrides
  - Repo metadata (.nvmrc=22, .gitignore, .gitattributes LF-pinned)
affects: [01-02-logger, 01-03-mcp-skeleton, 01-04-sanitizer-lint, 01-05-cli-doctor, 01-06-ci-integration, all-phase-2-plus]

tech-stack:
  added:
    - "@modelcontextprotocol/sdk@1.29.0"
    - "better-sqlite3@12.10.0 (caret ^12.9 accepts 12.10.x)"
    - "@napi-rs/keyring@1.3.0"
    - "commander@14.0.3"
    - "pino@10.3.1"
    - "zod@4.4.3"
    - "typescript@5.9.3 (caret ^5.7 — STACK.md pins 5.7 line; 5.9 is the latest within that range; NOT 6.x per A4)"
    - "@types/node@22.19.19"
    - "@types/better-sqlite3@7.6.13"
    - "tsx@4.21.0"
    - "tsup@8.5.1"
    - "vitest@4.1.6"
    - "pino-pretty@13.1.3"
    - "@biomejs/biome@2.4.15"
  patterns:
    - "Two-entry tsup ESM build with shebang banner and native externals"
    - "Vitest fork-pool for native-module isolation"
    - "Biome noConsole globally + per-directory overrides (precedent for FND-05 enforcement)"
    - "Verbatim version pins from STACK.md; any drift is a separate ADR per A4"

key-files:
  created:
    - "package.json — bin entries, ESM type, engines >=22.11, scripts matching CLAUDE.md Bash section"
    - "package-lock.json — deterministic install record (npm ci validated)"
    - "tsconfig.json — strict + NodeNext + verbatimModuleSyntax + noUncheckedIndexedAccess + exactOptionalPropertyTypes"
    - "tsup.config.ts — two-entry ESM bundle config"
    - "vitest.config.ts — pool 'forks' + passWithNoTests"
    - "biome.json — noConsole global error, src/cli + *.test.ts overrides, single-quote formatter"
    - ".nvmrc — 22"
    - ".gitignore — node_modules, dist, coverage, logs, .env, .DS_Store"
    - ".gitattributes — LF eol for .ts/.json/.mjs"
  modified: []

key-decisions:
  - "Honored D-01 npm (no pnpm, no bun) — package-lock.json committed; npm ci reproduces install in 2s"
  - "Honored A4 in 01-RESEARCH.md Assumptions Log: pinned typescript to ^5.7 (resolved 5.9.3, NOT 6.x)"
  - "Honored CLAUDE.md §Testing: vitest pool 'forks' (not threads) — native-module handles don't cross worker threads"
  - "Set biome javascript.formatter.quoteStyle: 'single' so RESEARCH.md verbatim templates and the must_haves grep patterns (e.g., pool: 'forks') round-trip through biome check unmodified"
  - "Set vitest.config.ts passWithNoTests: true so the empty source tree's npm run test exits 0 without changing the must_haves \"test\": \"vitest run\" key_link pattern"
  - "Deferred MSW to Phase 4 per 01-RESEARCH.md §Supporting — Phase 1 has no fetch calls to mock"

patterns-established:
  - "Verbatim-from-RESEARCH config templates with explicit deviation comments when reality (Biome schema, Vitest 4 API) forces drift"
  - "Per-task atomic commit with conventional-commit prefix (chore for config) — Plans 02-06 will follow"
  - "Configuration-only plan ships ZERO source files — D-11 directory layout deferred to Plan 02 onward"

requirements-completed:
  - FND-01

duration: 3m 32s
completed: 2026-05-12
---

# Phase 01 Plan 01: Bootstrap npm + TypeScript strict + tsup + Vitest + Biome Summary

**npm-managed ESM TypeScript repo on Node 22 LTS with strict compiler settings, two-entry tsup build, fork-pool Vitest, and Biome noConsole linting — the configuration substrate every subsequent Phase 1 plan depends on.**

## Performance

- **Duration:** 3m 32s
- **Started:** 2026-05-12T17:27:31Z
- **Completed:** 2026-05-12T17:31:03Z
- **Tasks:** 2
- **Files created:** 9 (package.json, package-lock.json, tsconfig.json, tsup.config.ts, vitest.config.ts, biome.json, .nvmrc, .gitignore, .gitattributes)

## Accomplishments

- npm-managed ESM project (D-01) with 14 production + dev deps installed, all within STACK.md caret ranges; `npm ci` from scratch is reproducible in 2s
- Strict TypeScript 5.9.3 (within ^5.7 line per A4 — explicitly NOT bumped to 6.x) with NodeNext + verbatimModuleSyntax + noUncheckedIndexedAccess + exactOptionalPropertyTypes — every Phase 1+ source file inherits these constraints from compile-zero
- tsup configured with two entries (`src/cli/index.ts`, `src/mcp/index.ts`), shebang banner `#!/usr/bin/env node`, ESM-only, node22 target, and `external: ['better-sqlite3', '@napi-rs/keyring']` (Pitfall 4 mitigation)
- Vitest configured with `pool: 'forks'` per CLAUDE.md §Testing — native-module handles don't survive worker threads; `passWithNoTests: true` so the empty source tree exits 0
- Biome configured with `noConsole: 'error'` globally and `src/cli/**/*.ts` + `**/*.test.ts` overrides (D-04 spec) — the lint half of the Phase 1 stdout-purity defense
- `.nvmrc` pins Node 22, `.gitignore` covers all generated outputs, `.gitattributes` enforces LF on .ts/.json/.mjs (Pitfall 22 defense)

## Task Commits

Each task was committed atomically:

1. **Task 1: package.json, tsconfig.json, .nvmrc, .gitignore, .gitattributes** — `e52c860` (chore)
2. **Task 2: tsup.config.ts, vitest.config.ts, biome.json** — `31ad0c7` (chore)

**Plan metadata:** _to be added by final metadata commit_

## Files Created/Modified

### Created

- `package.json` — npm-managed ESM project; `recovery-ledger` → `./dist/cli.mjs` and `recovery-ledger-mcp` → `./dist/mcp.mjs` bin entries; engines `>=22.11`; scripts (`build`, `dev:cli`, `dev:mcp`, `test`, `lint`, `format`, `migrate:generate`) match CLAUDE.md §Bash; 6 production deps + 8 dev deps pinned per STACK.md
- `package-lock.json` — deterministic install record; `npm ci` from a fresh clone reproduces 240 packages
- `tsconfig.json` — target ES2023, module/moduleResolution NodeNext, strict + noUncheckedIndexedAccess + exactOptionalPropertyTypes + verbatimModuleSyntax, outDir `dist`, includes `src/**/*`, `test/**/*`, `*.ts`
- `tsup.config.ts` — two-entry ESM bundle with shebang banner and native externals
- `vitest.config.ts` — `pool: 'forks'` + `passWithNoTests: true` + 10s timeouts
- `biome.json` — global `noConsole: 'error'`, two overrides (`src/cli/**/*.ts`, `**/*.test.ts`) set `noConsole: 'off'`, single-quote formatter, 2-space indent, 100-col width
- `.nvmrc` — `22`
- `.gitignore` — `node_modules/`, `dist/`, `coverage/`, `*.log`, `.env`, `.env.local`, `.DS_Store`
- `.gitattributes` — LF line endings for `.ts`, `.json`, `.mjs`

### Modified

None.

## Decisions Made

- **Honored D-01 npm strictly.** No pnpm, no bun. `package-lock.json` committed.
- **Honored A4 (typescript ^5.7).** Resolved to 5.9.3 (caret-compatible). NOT bumped to 6.x — that would require a separate ADR per A4.
- **Honored CLAUDE.md §Testing.** `pool: 'forks'` is non-negotiable.
- **Honored Plan's "MSW deferred to Phase 4" guidance.** No `msw` in devDependencies; verified via grep.
- **Quote-style decision (Biome).** Set `javascript.formatter.quoteStyle: 'single'` so RESEARCH.md verbatim templates AND the Plan's must_haves grep patterns (e.g., `"pool: 'forks'"`) round-trip through `biome check` cleanly. Default Biome formatter wants double quotes — that would break verbatim acceptance.
- **passWithNoTests decision (Vitest).** Vitest 4 default behavior changed to exit 1 when no tests match the include glob; preserved the Plan's verbatim `"test": "vitest run"` script by moving the flag into `vitest.config.ts`. This keeps the must_haves key_link pattern exact.

## Deviations from Plan

Three deviations encountered during execution, all Rule 1 (bug — fixing inline) where the RESEARCH.md verbatim templates conflicted with actual library behavior. None required architectural changes (Rule 4).

### Auto-fixed Issues

**1. [Rule 1 - Bug] Biome 2.4.15 rejects trailing `/**` in negated folder globs**

- **Found during:** Task 2 (biome.json) — `npx biome check` flagged `lint/suspicious/useBiomeIgnoreFolder` on the `!dist/**` and `!node_modules/**` entries from RESEARCH §`biome.json`
- **Issue:** RESEARCH.md template predates Biome 2.2.0's glob normalization. Trailing `/**` on a negation glob is now a lint error.
- **Fix:** Collapsed `files.ignore` into `files.includes` with bare `!dist` and `!node_modules` (Biome 2.2+ pattern)
- **Files modified:** `biome.json`
- **Verification:** `npx biome check` exits 0; lint passes
- **Committed in:** `31ad0c7`

**2. [Rule 1 - Bug] Vitest 4 removed top-level `poolOptions`**

- **Found during:** Task 2 (vitest.config.ts) — `npx tsc --noEmit` raised `TS2769: 'poolOptions' does not exist in type 'InlineConfig'`; running `vitest run` printed `DEPRECATED: test.poolOptions was removed in Vitest 4`
- **Issue:** RESEARCH.md template anchored to Vitest 3.x API. Vitest 4 inlined all `poolOptions` into the top-level test config.
- **Fix:** Removed the `poolOptions: { forks: { singleFork: false } }` block entirely. `singleFork: false` is the default in Vitest 4's forks pool, so behavior is preserved.
- **Files modified:** `vitest.config.ts`
- **Verification:** `npx tsc --noEmit` exits 0; `npm run test` exits 0 with no deprecation warning
- **Committed in:** `31ad0c7`

**3. [Rule 1 - Bug] Vitest 4 exits 1 when no test files match the include glob**

- **Found during:** Task 2 (vitest.config.ts) — `npm run test` on the empty source tree exited 1 with `No test files found, exiting with code 1` (Vitest 4 changed this default)
- **Issue:** Plan success criterion #3 ("`npm run test` exits 0 ... — Vitest reports 'No test files found, exiting with code 0'") and the bootstrap-phase reality (no `src/`, no `test/`) require exit 0. The must_haves key_link pattern `"test":\s*"vitest run"` (no flags) also requires the script string to stay exactly `vitest run`.
- **Fix:** Added `passWithNoTests: true` inside `vitest.config.ts` (not as a CLI flag) — preserves the verbatim package.json script AND satisfies the empty-tree exit-0 requirement.
- **Files modified:** `vitest.config.ts`
- **Verification:** `npm run test` exits 0; package.json `scripts.test` is still `"vitest run"` (key_link pattern unchanged)
- **Committed in:** `31ad0c7`

---

**Total deviations:** 3 auto-fixed (all Rule 1 — RESEARCH templates predating current library versions)
**Impact on plan:** All three fixes were essential to satisfying the Plan's own success criteria. No architectural drift, no scope creep, no D-XX decisions revisited.

## Issues Encountered

- **`npx tsc --noEmit` on a truly empty source tree raises TS18003 ("No inputs were found").** The `tsconfig.json` `include` of `["src/**/*", "test/**/*", "*.ts"]` matches nothing until at least one `.ts` file exists. Resolved in Task 2 — the moment `tsup.config.ts`, `vitest.config.ts`, and `biome.json` land (root `.ts` files match the `*.ts` glob), `tsc --noEmit` exits 0. This is why Task 2's `<verify>` block runs `tsc --noEmit` AFTER the configs are created, not after Task 1.

## Verification Output

End-to-end plan verification (run after Task 2 commit, from `node_modules` deleted state):

```
$ rm -rf node_modules && npm ci
added 240 packages in 2s
exit 0

$ npm run lint
Checked 3 files in 12ms. No fixes applied.
exit 0

$ npm run test
No test files found, exiting with code 0
exit 0

$ npx tsc --noEmit
exit 0
```

Plus directory-non-existence checks:

```
$ ls -d src test dist .github 2>/dev/null
(empty — none exist, per success criteria)
```

## Resolved Dependency Versions

| Package | Pinned (caret) | Installed | Within range? |
|---------|----------------|-----------|---------------|
| `@modelcontextprotocol/sdk` | ^1.29.0 | 1.29.0 | exact |
| `better-sqlite3` | ^12.9.0 | 12.10.0 | yes |
| `@napi-rs/keyring` | ^1.3.0 | 1.3.0 | exact |
| `commander` | ^14.0.3 | 14.0.3 | exact |
| `pino` | ^10.3.1 | 10.3.1 | exact |
| `zod` | ^4.4.3 | 4.4.3 | exact |
| `typescript` | ^5.7 | 5.9.3 | yes (NOT 6.x per A4) |
| `@types/node` | ^22 | 22.19.19 | yes |
| `@types/better-sqlite3` | ^7 | 7.6.13 | yes |
| `tsx` | ^4.21 | 4.21.0 | yes |
| `tsup` | ^8.5 | 8.5.1 | yes |
| `vitest` | ^4.1.6 | 4.1.6 | exact |
| `pino-pretty` | ^13 | 13.1.3 | yes |
| `@biomejs/biome` | ^2.4.15 | 2.4.15 | exact |

## Next Phase Readiness

Plan 01-02 (logger) can now:

- `import { pino } from 'pino';` (resolves)
- `import { defineConfig } from 'vitest/config';` (resolves)
- Write `src/infrastructure/config/logger.ts` and have it lint-clean against `noConsole` (no console.* in that path)
- Write `src/infrastructure/config/logger.test.ts` and have it run under `pool: 'forks'`

No blockers. The Phase 1 D-11 source-layout directories (`src/cli/`, `src/mcp/`, `src/services/`, `src/infrastructure/`, `src/formatters/`) will be created by Plans 02-06 as each plan needs them.

## User Setup Required

None — no external service configuration touched in this plan.

## Self-Check: PASSED

All 9 created config files exist on disk. Both task commits (`e52c860`, `31ad0c7`) exist in `git log --oneline --all`. No discrepancies between claims in this summary and verifiable state.

---
*Phase: 01-foundation-stdout-pure-mcp-bootstrap*
*Completed: 2026-05-12*
