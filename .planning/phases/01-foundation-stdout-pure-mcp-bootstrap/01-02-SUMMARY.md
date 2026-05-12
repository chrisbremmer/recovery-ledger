---
phase: 01-foundation-stdout-pure-mcp-bootstrap
plan: 02
subsystem: infra
tags: [logger, pino, stderr, stdout-purity, fnd-04]

requires:
  - 01-01-bootstrap (Pino 10.3.1 in node_modules, vitest 4.1.6 pool 'forks', biome 2.4.15 noConsole rule)

provides:
  - "src/infrastructure/config/logger.ts: named export `logger` — Pino instance bound to fd 2 (stderr) in both prod (sync: false SonicBoom) and dev (pino-pretty transport with options.destination: 2)"
  - "D-02a programmatic destination assertion (Vitest unit) — green on Pino 10.3.1"
  - "Stable answer to RESEARCH Open Question 1 (sync vs async destination) — async (sync: false) chosen for prod"
  - "A1 resolution: pino.symbols.streamSym DOES expose the underlying SonicBoom destination on Pino 10.3.1; symbol-based introspection is reliable"

affects:
  - 01-03-mcp-skeleton (imports logger; sanitizer + register.ts will route caught errors through logger.error)
  - 01-04-sanitizer-lint (Biome noConsole gate validated against a real src/infrastructure/ file)
  - 01-05-cli-doctor (doctor service will log status via logger)
  - 01-06-ci-integration (subprocess round-trip in Plan 06 picks up `logger destination` as the existing describe block name to avoid collision)
  - all-phase-2-plus

tech-stack:
  added: []
  patterns:
    - "Default-import for CJS-with-`export =` third-party modules (pino) — named import omits namespace-attached members"
    - "Two-tier Pino destination assertion: load-bearing fallback (pino.destination({dest:2}).fd) + best-effort symbol introspection (pino.symbols.streamSym), wrapped in try/catch with expect.fail fallback"
    - "Cast through unknown for SonicBoom .fd (omitted from public .d.ts but present at runtime)"

key-files:
  created:
    - "src/infrastructure/config/logger.ts — named export `logger`; NODE_ENV branch; prod uses pino.destination({ dest: 2, sync: false }); dev uses pino-pretty transport with options.destination: 2"
    - "src/infrastructure/config/logger.test.ts — Vitest spec with two tests under `describe('logger destination', ...)`"
  modified:
    - "biome.json — added `!.worktrees` to files.includes (Rule 3 deviation: stale harness worktree biome.json was breaking lint)"

key-decisions:
  - "Chose async destination (sync: false) for prod — RESEARCH Open Question 1. Performance > flush determinism in normal operation; Pino's exit hook + MCP stdio drain handle shutdown."
  - "Switched named import `import { pino } from 'pino'` to default import `import pino from 'pino'` — Rule 1 deviation. pino@10.3.1 ships `export = pino` (CJS); .destination/.symbols are namespace-attached only on the default callable."
  - "A1 (symbol introspection brittleness) is RESOLVED — verified pino.symbols.streamSym resolves to Symbol('pino.stream') on Pino 10.3.1 and logger[streamSym].fd === 2 at runtime. Plan 06 may rely on this without a fallback."
  - "Kept logger.test.ts to two tests (action prescribed) instead of the three behaviors enumerated — Test 3 (post-import NODE_ENV switching) requires module-cache busting that adds noise; the structural read of logger.ts source plus the subprocess test in Plan 06 cover the prod path."

requirements-completed:
  - FND-04 (programmatic half — D-02a)

duration: 4m 56s
started: 2026-05-12T17:35:57Z
completed: 2026-05-12T17:40:53Z
---

# Phase 01 Plan 02: Pino Stderr-Only Logger Summary

**Single named-export Pino logger bound exclusively to fd 2 (stderr) in both prod and dev codepaths, with a Vitest unit (D-02a) asserting the destination resolves to fd 2 — the cheap programmatic pre-check for the load-bearing subprocess round-trip in Plan 06.**

## Performance

- **Duration:** 4m 56s
- **Started:** 2026-05-12T17:35:57Z
- **Completed:** 2026-05-12T17:40:53Z
- **Tasks:** 2 (plus one upstream deviation commit)
- **Files created:** 2 (`src/infrastructure/config/logger.ts`, `src/infrastructure/config/logger.test.ts`)
- **Files modified:** 1 (`biome.json` — environment fix)

## Accomplishments

- `src/infrastructure/config/logger.ts` exports a Pino instance bound to fd 2 in both `NODE_ENV=production` (default — `pino.destination({ dest: 2, sync: false })`) and `NODE_ENV=development` (pino-pretty transport with `options.destination: 2`).
- `src/infrastructure/config/logger.test.ts` carries two tests under one describe block — a Pino-internals-independent fallback assertion (`pino.destination({ dest: 2, sync: true }).fd === 2`) plus a symbol-based introspection of the exported logger (`logger[pino.symbols.streamSym].fd === 2`).
- Manual stdout-purity smoke verified: `node --import tsx/esm` importing the prod logger and emitting one `logger.info` writes **0 bytes to stdout, 109 bytes of valid JSON to stderr**.
- `npm run test`, `npm run lint`, and `npx tsc --noEmit` all exit 0; the logger.ts file contains zero `console.*` calls (Biome `noConsole` gate green).
- FND-04's programmatic half (D-02a) is now in CI.

## Task Commits

1. **Pre-task chore: ignore .worktrees in biome scan** — `cea4221` (chore)
2. **Task 1: logger.ts (Pino → fd 2)** — `5efbbf8` (feat)
3. **Task 2: logger.test.ts (D-02a assertion)** — `d7b110a` (test)

**Plan metadata:** _to be added by final metadata commit_

## Open Questions Resolved

### RESEARCH Open Question 1 — sync vs async Pino destination (prod)

**Resolution: async (sync: false).** Prod uses `pino.destination({ dest: 2, sync: false })` — Pino's buffered SonicBoom path. Justification documented inline in `logger.ts` (the non-obvious flushing-on-shutdown tradeoff). Tests construct synchronous destinations explicitly for deterministic fd inspection without touching the prod path.

### A1 (RESEARCH Assumptions Log) — pino.symbols.streamSym stability

**Resolution: stable on Pino 10.3.1.** Verified by direct introspection:

- `node_modules/pino/lib/symbols.js` declares `const streamSym = Symbol('pino.stream')` (a per-version unique Symbol, not Symbol.for).
- Runtime test confirms `pino.symbols.streamSym` is defined and `logger[pino.symbols.streamSym].fd === 2` evaluates true.
- Plan 06's subprocess round-trip remains the load-bearing test (this unit is the pre-check), but Plan 06 does NOT need to add a fallback path for symbol drift; the symbol is exposed and Pino's `inc-version.sh` in the package suggests deliberate version-locking.

## Test Case Names (for Plan 06 collision avoidance)

Plan 06 (subprocess round-trip integration test, D-02b) will land at `test/integration/mcp-stdout-purity.test.ts` with its own describe block. The names in this plan are:

- `describe('logger destination', ...)`
  - `test('pino.destination({ dest: 2 }) returns a stream with fd === 2', ...)`
  - `test('exported logger is bound to fd 2 via pino.symbols.streamSym', ...)`

Plan 06 should use a distinct top-level describe such as `describe('MCP stdout purity (dist smoke)', ...)` (the RESEARCH §Pattern 5(b) heading) — no collision risk.

## Files Created/Modified

### Created

- `src/infrastructure/config/logger.ts` — 34 lines including 3 comment blocks (non-obvious rationale only, per CLAUDE.md §Code Style):
  1. Why default import for pino (CJS `export =` interop).
  2. Why this file routes to fd 2 only (MCP stdio purity).
  3. Why `sync: false` for prod (buffered SonicBoom tradeoff).
- `src/infrastructure/config/logger.test.ts` — 39 lines; 2 tests under one describe; named imports throughout; D-02a fallback + symbol-introspection paths.

### Modified

- `biome.json` — added `"!.worktrees"` to `files.includes`. Pre-existing harness cruft (a leftover `.worktrees/chore-agent-infrastructure/biome.json` from a prior session) was shadowing the root config and breaking `npm run lint` with a nested-root-configuration error. `.gitignore` already excludes `.worktrees/` so git is unaffected; Biome doesn't auto-honor `.gitignore` for include scanning.

## Decisions Made

- **Default-import pino** (Rule 1 deviation from RESEARCH §Pattern 1 verbatim). Pino 10.3.1 is published with `export = pino` for CJS interop. The `.destination` and `.symbols` accessors are namespace-attached only on the default callable; the nested `pino.pino` named re-export only exposes `stdTimeFunctions`. Verified by reading `node_modules/pino/pino.d.ts` lines 875-910. CLAUDE.md §Code Style bans `export default` for our own modules; it does not constrain how we import third-party CJS modules. Default-import is the idiomatic resolution.
- **`sync: false` for prod.** RESEARCH Open Question 1 left this open. Performance is the deciding factor for normal operation; the rare-but-real shutdown-flush concern is handled by Pino's exit hook plus the MCP stdio transport draining stdio on close.
- **Symbol introspection is not skipped or marked `.skip`** in Test 2. A1 turned out fine on Pino 10.3.1, so the symbol-based test ships green. The try/catch + `expect.fail` fallback remains for future Pino versions.
- **Dot-notation `process.env.NODE_ENV`** instead of the plan's prescribed bracket form (acceptance criterion #7). Both yield `string | undefined` because `@types/node` declares `NODE_ENV` and `LOG_LEVEL` as optional named properties (NOT via index signature). Biome's `useLiteralKeys` rule mandates dot-notation; the plan's bracket-notation rationale ("required by `noUncheckedIndexedAccess`") is wrong for these particular env vars. Rationale documented inline in `logger.ts`.
- **`expect(dest.fd).toBe(2)` literal preserved** despite SonicBoom's `.d.ts` omitting the public `.fd` field. Cast through `unknown` to surface the runtime shape; the literal text required by the plan's must_haves grep pattern is preserved on the assertion line.
- **Two tests, not three.** The plan's `<behavior>` enumerated three test ideas but `<action>` only prescribed two; honored `<action>`. Test 3 (NODE_ENV switching post-import) needs module-cache busting that adds noise without strengthening the assertion. The structural source read plus Plan 06's subprocess test cover the prod path comprehensively.

## Deviations from Plan

Five deviations encountered; all Rule 1 or Rule 3 (auto-fixable inline). None required architectural changes (Rule 4).

### Auto-fixed Issues

**1. [Rule 3 — Blocking] Stale harness worktree biome.json broke `npm run lint`**

- **Found during:** Task 1 (after writing logger.ts, first lint run)
- **Issue:** A `.worktrees/chore-agent-infrastructure/biome.json` shipped its own root-marked Biome config (from a prior harness session that aborted with "harness lacks worktree feature here"). Biome 2.4.15 detected both as competing roots and refused to run with "× Found a nested root configuration, but there's already a root configuration."
- **Fix:** Added `"!.worktrees"` to root `biome.json` `files.includes`. Did NOT remove the worktree itself (destructive-git rules; the branch+worktree wasn't created by this task).
- **Files modified:** `biome.json`
- **Verification:** `npm run lint` exits 0 against the post-Task-1 src/ tree
- **Committed in:** `cea4221`

**2. [Rule 1 — Bug] RESEARCH Pattern 1's named import `{ pino }` doesn't compile**

- **Found during:** Task 1 (`npx tsc --noEmit` after logger.ts initial write)
- **Issue:** `import { pino } from 'pino'` returns a callable but the nested `pino.pino` namespace only exposes `stdTimeFunctions` per the published `.d.ts`. Calling `pino.destination(...)` fails with TS2339 because `.destination` is only namespace-attached on the **default** export of the CJS `export = pino` module.
- **Fix:** Switched to `import pino from 'pino'` (default import); rationale documented inline in `logger.ts`. CLAUDE.md §Code Style bans `export default` in our code, not `import default` from third-party CJS.
- **Files modified:** `src/infrastructure/config/logger.ts`
- **Verification:** `npx tsc --noEmit` exits 0
- **Committed in:** `5efbbf8`

**3. [Rule 1 — Bug] Biome `useLiteralKeys` rejects `process.env['NODE_ENV']`**

- **Found during:** Task 1 (`npm run lint` after logger.ts write)
- **Issue:** Plan acceptance criterion #7 required `process.env['NODE_ENV']` bracket-notation citing `noUncheckedIndexedAccess`. But `@types/node` declares `NODE_ENV` and `LOG_LEVEL` as optional named properties (NOT via the env index signature), so both forms yield `string | undefined`. Biome's `useLiteralKeys` (`lint/complexity`) flagged the bracket form as unnecessary.
- **Fix:** Switched to dot-notation `process.env.NODE_ENV` / `process.env.LOG_LEVEL`. Behavioral type is identical. Rationale documented inline in `logger.ts`.
- **Files modified:** `src/infrastructure/config/logger.ts`
- **Verification:** `npm run lint` exits 0; `npx tsc --noEmit` exits 0 (the `??` defaults preserve the `string | undefined` narrowing as before)
- **Committed in:** `5efbbf8`

**4. [Rule 1 — Bug] Biome formatter prefers one-line prod-path call**

- **Found during:** Task 1 (post `useLiteralKeys` fix, lint surfaced a format diff)
- **Issue:** Biome's default formatter for `pino({ level: ... }, pino.destination(...))` collapsed to a single line when the multi-line form fits in `lineWidth: 100`.
- **Fix:** Ran `npm run format` (`biome check --write`). One-line form accepted.
- **Files modified:** `src/infrastructure/config/logger.ts`
- **Verification:** `npm run lint` exits 0
- **Committed in:** `5efbbf8`

**5. [Rule 1 — Bug] Vitest 4 removed `--reporter=basic`**

- **Found during:** Task 2 verification (the plan's `<verify>` runs `npm run test ... --reporter=basic`)
- **Issue:** Vitest 4.1.6 renamed/removed the `basic` reporter. Running with `--reporter=basic` exits 1 with "Failed to load custom Reporter from basic" before any test runs.
- **Fix:** Dropped the reporter flag; Vitest's default reporter is fine and equally terse for a 2-test file. The plan's `<verify>` command was written against Vitest 3.x conventions (Plan 01-01 SUMMARY already documents three other Vitest 4 API drifts).
- **Files modified:** None (verification command change only)
- **Verification:** `npm run test -- src/infrastructure/config/logger.test.ts` exits 0, "2 passed"
- **Committed in:** No code change

**6. [Rule 1 — Bug] SonicBoom .d.ts omits public `.fd` field**

- **Found during:** Task 2 (`npx tsc --noEmit` after first test file write)
- **Issue:** SonicBoom v4's `.d.ts` declares `fd` only inside the constructor opts type; the class itself does not publish `.fd` as a public field, even though every instance carries one at runtime. The plan's must_haves require the literal text `expect(dest.fd).toBe(2)` in the test file.
- **Fix:** Cast the destination through `unknown` to surface the runtime shape: `const dest = pino.destination({ dest: 2, sync: true }) as unknown as { fd: number };` — preserves the exact assertion text while satisfying strict TS.
- **Files modified:** `src/infrastructure/config/logger.test.ts`
- **Verification:** `npx tsc --noEmit` exits 0; `npm run test` reports 2 passed
- **Committed in:** `d7b110a`

---

**Total deviations:** 6 (1 Rule 3 environment unblocking + 5 Rule 1 fixes for stale RESEARCH templates / library-version drift)
**Impact on plan:** All fixes were essential to making `npm run lint`, `npm run test`, and `npx tsc --noEmit` pass simultaneously. No architectural drift; no D-XX decisions revisited; no scope creep. The deviations harden against the same template-vs-reality gap Plan 01-01 already documented for the config layer.

## Issues Encountered

- **`.worktrees/chore-agent-infrastructure` exists in the working tree.** Created at 10:37:27 (during this plan's session) by a harness setup step that subsequently disabled itself ("Sequential execution on main working tree — no worktree isolation, harness lacks the feature here", per the execution objective). The worktree is a clean checkout of the `chore/agent-infrastructure` branch at commit `abc9de4` — no uncommitted changes, no unique commits, just a literal copy of the project root including its own `biome.json`. Treated as environmental cruft; biome.json `!.worktrees` ignore is the non-destructive fix. The worktree itself was left in place per the destructive-git prohibition (it was not created by this task and may belong to an in-flight orchestrator step).

## Verification Output

End-to-end plan verification:

```
$ npm run test
 RUN  v4.1.6 /Users/chris.bremmer/recovery-ledger
 Test Files  1 passed (1)
 Tests       2 passed (2)
exit 0

$ npm run lint
Checked 5 files in 3ms. No fixes applied.
exit 0

$ npx tsc --noEmit
exit 0

$ grep -E "(^|[^a-zA-Z])console\." src/infrastructure/config/logger.ts
(no matches — exit 1, expected)

$ node --import tsx/esm -e \
    "process.env.NODE_ENV='production'; \
     import('./src/infrastructure/config/logger.ts') \
       .then(m => m.logger.info('plan-final-smoke'))" \
    1>/tmp/out 2>/tmp/err
stdout bytes: 0
stderr bytes: 109
[ ! -s /tmp/out ] && echo OK → OK
grep -q "plan-final-smoke" /tmp/err && echo OK → OK
```

## Next Phase Readiness

Plan 01-03 (MCP skeleton + register() wrapper) can now:

- `import { logger } from '../infrastructure/config/logger.js';` (resolves)
- Route caught errors via `logger.error({ err })` after sanitization — output goes to fd 2 without polluting the JSON-RPC stream on fd 1.
- Use `logger` from `src/services/doctor/` for status logging during the three doctor checks.

Plan 01-06 (subprocess round-trip integration test) can:

- Compose its describe block as `describe('MCP stdout purity (dist smoke)', ...)` without name collision with `describe('logger destination', ...)` from this plan.
- Rely on `pino.symbols.streamSym` being stable on Pino 10.3.1 — but the subprocess test itself doesn't need to introspect symbols; it asserts the externally-visible stdout byte stream.

## User Setup Required

None — this plan adds only logger source + a Vitest spec.

## Self-Check: PASSED

- `src/infrastructure/config/logger.ts` exists on disk (verified by `npx tsc --noEmit` succeeding and `grep` patterns matching).
- `src/infrastructure/config/logger.test.ts` exists on disk (verified by `npm run test` finding and running the file).
- `biome.json` modification on disk (verified by `git log -1 cea4221 --stat` showing `1 file changed, 1 insertion(+), 1 deletion(-)`).
- Commits `cea4221`, `5efbbf8`, `d7b110a` exist in `git log --oneline -5`:
  ```
  d7b110a test(01-02): assert Pino logger binds to fd 2 (D-02a)
  5efbbf8 feat(01-02): add Pino logger bound to fd 2 (stderr)
  cea4221 chore(01-02): ignore .worktrees in biome scan
  ```
- No discrepancies between claims in this summary and verifiable state.

---
*Phase: 01-foundation-stdout-pure-mcp-bootstrap*
*Completed: 2026-05-12*
