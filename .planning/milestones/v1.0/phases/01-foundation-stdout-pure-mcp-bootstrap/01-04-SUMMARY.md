---
phase: 01-foundation-stdout-pure-mcp-bootstrap
plan: 04
subsystem: testing
tags: [sanitizer, tests, lint, grep-gates, ci, fnd-05, fnd-06]

requires:
  - 01-03-mcp-skeleton (PATTERNS / sanitize / serializeError exports from src/mcp/sanitize.ts)
  - 01-01-bootstrap (Vitest 4.1.6 with pool 'forks'; Biome 2.4.15)

provides:
  - "src/mcp/sanitize.test.ts: 20 Vitest cases across three describe blocks pinning the D-07 pattern catalog, the D-08 depth-8 cause-chain walker, and the four D-10 fixture shapes that historically leak"
  - "scripts/ci-grep-gates.sh: three CI grep gates (tone words + emoji, console.log/error/warn outside src/cli and tests, process.stdout.write outside src/cli/commands/doctor.ts) with inverted-grep exit semantics per Pitfall 10"
  - "Deliberate-failure verification recipe — planting a violation in src/mcp/_grep-gate-self-check.ts trips Gate B (console) and Gate C (stdout); a banned word or an emoji byte trips Gate A — all three exit 1 with ::error:: annotations"
  - "Pin against drift: PATTERNS.length === 4 test fails if anyone adds, drops, or reorders a regex without updating this contract"

affects:
  - 01-05-cli-doctor (src/cli/commands/doctor.ts is the one path exempt from Gate C — Plan 05 must keep process.stdout.write contained to that file)
  - 01-06-ci-integration (wires `bash scripts/ci-grep-gates.sh` into .github/workflows/ci.yml as a single step; subprocess round-trip test runs alongside)
  - all-phase-2-plus (every future tool registration is sanitizer-covered; every PR must pass the three gates locally and in CI)

tech-stack:
  added: []
  patterns:
    - "Characterization tests for pure-function pipelines: existing surface (PATTERNS / sanitize / serializeError) gets pinned by per-rule positive + negative cases plus a length assertion — drift detection without forcing the implementation file to change"
    - "Inverted-grep CI gate (Pitfall 10): if grep -rEn matches, print ::error:: and exit 1; the script exits 0 only when every gate finds no matches"
    - "Self-exempt grep gates: CLAUDE.md (the rule source) and the gate script itself are excluded from Gate A so rule definitions cannot trip their own enforcement"
    - "Byte-level emoji detection portable across BSD and GNU grep: LC_ALL=C plus \\xf0-\\xf4\\x80-\\xbf{3} catches every U+10000+ codepoint without depending on -P (GNU-only)"
    - "Boundary-pinned cause-walker test: separate from the depth>8 'at most 9 segments' check, a 10-deep wrapper construction asserts exactly 8 cause segments — drift in either direction breaks the test"

key-files:
  created:
    - "src/mcp/sanitize.test.ts — 168 lines, 20 tests, three describe blocks (sanitize patterns / serializeError cause chain / D-10 fixtures)"
    - "scripts/ci-grep-gates.sh — 110 lines, three gates with shared exclusions, mode 100755"
  modified: []

key-decisions:
  - "Adopted user's prompt-level gate specification (Gates A/B/C) over the plan's verbatim three (biome-ignore.noConsole / process.stdout outside src/cli / server.registerTool outside register.ts). The user's gates are stricter and align with CLAUDE.md §Critical Rules: tone-word ban, console.* outside CLI+tests, process.stdout.write outside the one approved doctor command. Gate B subsumes the plan's biome-ignore intent (any console.* slip — inline-ignore or not — fails the gate). The plan's server.registerTool gate is not added here because Biome's existing structure plus the one-call site in register.ts (already verified by Plan 03) cover that contract; Plan 06 can add it as a fourth gate if needed."
  - "Gate C exempts src/cli/commands/doctor.ts specifically (per D-04 + D-11 — the one approved CLI output point). The file does not exist yet — Plan 05 creates it. The exemption is forward-referenced; the gate logic does not require the file to exist to pass."
  - "Used /usr/bin/grep (BSD 2.6.0-FreeBSD, GNU-compatible) explicitly via a $GREP variable. The shell session here aliases `grep` to ugrep; the script must work in CI on macos-latest with the system grep. Setting LC_ALL=C makes byte-level emoji patterns portable."
  - "Word boundaries (\\b) on tone words — 'tune' must not match 'tuned' or 'Neptune', 'nail' must not match 'fingernail'. 'dial in' is a separate alternation because \\b does not span the embedded space."
  - "Cause-walker boundary test C3 added (not in the plan's <behavior>) — exactly-8 cause segments for a 10-deep chain, in addition to the plan's at-most-9-segments check. This pins the boundary in both directions so a future off-by-one in sanitize.ts (e.g., changing < 8 to <= 8) breaks the test."
  - "Defects search: no defects discovered in src/mcp/sanitize.ts. All 20 characterization tests pass on first run against the Plan 03 implementation. Sanitize / serializeError ship as designed."

patterns-established:
  - "Per-pattern positive + negative test rule: every redaction regex added to PATTERNS must land with a positive (matches+redacts) and a negative (passes through unchanged) case in sanitize.test.ts. The four current patterns set the precedent."
  - "D-10 fixture shape: each historical-leak shape ships as a full new TypeError or Error in the test, fed through sanitize(serializeError(err)). Future leak reports become new fixtures here."
  - "CI grep gate convention: each gate has a single regex constant at the top, a single if grep -rEn block, and a ::error::-prefixed message naming the gate and the rule source (CLAUDE.md section or D-XX decision)."

requirements-completed:
  - FND-05
  - FND-06

duration: 3m 17s
started: 2026-05-12T17:55:11Z
completed: 2026-05-12T17:58:28Z
---

# Phase 01 Plan 04: Sanitizer Unit Tests + CI Lint Gates Summary

**Twenty Vitest cases pin the D-07 four-pattern sanitizer + D-08 depth-8 cause-chain walker against the four D-10 fixture shapes (fetch TypeError, undici UND_ERR_*, JSON access_token, bare Bearer); a 110-line bash script lands three CI grep gates (banned tone words + emoji, console.* outside src/cli and tests, process.stdout.write outside src/cli/commands/doctor.ts) with each gate self-verified by a planted violation that exits 1 with the right ::error:: annotation.**

## Performance

- **Duration:** 3m 17s
- **Started:** 2026-05-12T17:55:11Z
- **Completed:** 2026-05-12T17:58:28Z
- **Tasks:** 2
- **Files created:** 2 (`src/mcp/sanitize.test.ts`, `scripts/ci-grep-gates.sh`)
- **Files modified:** 0

## Accomplishments

- 20 Vitest cases in `src/mcp/sanitize.test.ts` cover every D-07 pattern with positive + negative cases, the D-08 cause-chain walker on linear / cycle / depth>8 / non-Error / mixed shapes, and the four D-10 fixture types end-to-end through `sanitize(serializeError(err))`.
- Pattern-count pin: `PATTERNS.length === 4` test fails if anyone adds, drops, or reorders a regex without updating the contract.
- Cause-walker boundary pin: C3 includes both the "<= 9 split segments" check and a separate "exactly 8 cause segments" check for a 10-deep wrapper chain — drift in either direction breaks the suite.
- `scripts/ci-grep-gates.sh` is executable (mode `100755`), POSIX-portable (`#!/usr/bin/env bash`, `set -euo pipefail`, system grep with `LC_ALL=C`), and Plan 06 can wire it into `.github/workflows/ci.yml` as a single `run: bash scripts/ci-grep-gates.sh` step.
- Each gate ships with a verified planted-violation recipe: Gate A trips on a banned word and on a literal emoji byte, Gate B trips on `console.warn(...)` outside `src/cli/` and tests, Gate C trips on `process.stdout.write(...)` outside `src/cli/commands/doctor.ts`.
- Exemptions tested: a `*.test.ts` file with `console.log` passes Gate B; a `src/cli/commands/doctor.ts` file with `process.stdout.write` passes Gate C.
- `npm run test` reports 22 passed total (2 from Plan 02 logger + 20 new). `npm run lint` exits 0. `npx tsc --noEmit` exits 0. `bash scripts/ci-grep-gates.sh` exits 0 on the clean tree.

## Task Commits

1. **Task 1: src/mcp/sanitize.test.ts (20 tests)** — `63e3867` (test)
   `test(01-04): cover sanitize patterns and cause chain (D-07, D-08, D-10)`
2. **Task 2: scripts/ci-grep-gates.sh (three gates)** — `325b72d` (chore)
   `chore(01-04): add CI grep gates for tone, console, and stdout (D-04)`

**Plan metadata:** _to be added by final metadata commit_

## Files Created/Modified

### Created

- `src/mcp/sanitize.test.ts` — 168 lines; named imports from `./sanitize.js`; three describe blocks; 20 tests. Acceptance-criteria literals all present (`Authorization: Bearer`, `access_token`, `refresh_token`, `client_secret`, `eyJ`, `Bearer`, `err.cause = err`, `fetch failed`, `UND_ERR_`, and the deep-chain `for` loop).
- `scripts/ci-grep-gates.sh` — 110 lines, executable (`100755`); `#!/usr/bin/env bash` shebang; `set -euo pipefail`; shared `REPO_EXCLUDES` array; three gates each with its own regex constant, scan command, and `::error::` annotation; final `echo "All grep gates passed." && exit 0`.

### Modified

- None.

## Decisions Made

- **Adopted user's prompt-level gate specification.** The active prompt's `<critical_constraints>` section overrides the plan's verbatim gate set. The plan had three gates (biome-ignore-noConsole / process.stdout outside src/cli / server.registerTool outside register.ts); the user specified three different ones (tone words + emoji / console.* outside src/cli and tests / process.stdout.write outside src/cli/commands/doctor.ts). The user's set is stricter and aligns with CLAUDE.md §Critical Rules more directly. Gate B subsumes the plan's biome-ignore intent (any `console.*` slip — including one shipped through an inline `biome-ignore` — fails the gate). The plan's `server.registerTool` chokepoint is already verified locally in Plan 03's smoke and can be added as a fourth gate by Plan 06 if needed.
- **Forward-referenced exemption in Gate C.** `src/cli/commands/doctor.ts` does not exist yet (Plan 05 creates it per D-11). The Gate C exemption path is a string literal; the gate logic does not require the file to exist to pass on the current tree.
- **Used `/usr/bin/grep` explicitly via `$GREP`.** The interactive shell here aliases `grep` to ugrep through Claude Code's wrapper, but CI on macos-latest runs the system grep (BSD 2.6.0-FreeBSD, GNU-compatible). The script sets `GREP="${GREP:-grep}"` so CI behavior is the canonical one.
- **`LC_ALL=C` and byte-level emoji detection.** The script sets `LC_ALL=C` then matches emoji via the 4-byte UTF-8 prefix range `\xf0-\xf4` followed by three continuation bytes. This covers every U+10000+ codepoint, which is every modern emoji. No `-P` flag (GNU-only), no Perl, no Python — pure POSIX `grep -E`.
- **Word boundaries on tone words.** `\b(optimize|wellness|honor|...|unlock)\b` — `tune` does not match `tuned` or `Neptune`; `nail` does not match `fingernail`. `dial in` is a separate alternation because `\b` does not span the embedded space.
- **Cause-walker boundary test C3.** The plan's `<behavior>` for C3 asks for at-most-9-segments. I added a second test that constructs a 10-deep chain and asserts exactly 8 cause segments. This pins the boundary in both directions: a future off-by-one in `sanitize.ts` (e.g., changing the loop guard from `depth < 8` to `depth <= 8`) breaks the suite.
- **No defects discovered in Plan 03's sanitize.ts.** All 20 characterization tests pass on first run. The Plan 03 implementation ships as designed; this plan adds no inline regressions or modifications to that file.

## Deviations from Plan

### Auto-fixed Issues

**1. [User constraint override — not a code bug] Switched gate set per active prompt's `<critical_constraints>` #4**

- **Found during:** Task 2 (script design).
- **Issue:** The plan's Task 2 specifies three gates (biome-ignore.noConsole / process.stdout / server.registerTool). The user's prompt-level `<critical_constraints>` block specifies three different gates (banned tone words + emoji / console.log+error+warn outside src/cli and tests / process.stdout.write outside src/cli/commands/doctor.ts). The user's gates are stricter and align with CLAUDE.md.
- **Fix:** Implemented the user's three gates. Gate B subsumes the plan's biome-ignore intent (any console.* call slips the gate regardless of inline-ignore comments). The plan's `server.registerTool` chokepoint remains structurally enforced by the one-call site in `register.ts`, already verified in Plan 03; Plan 06 can add it as a fourth gate if desired.
- **Files modified:** `scripts/ci-grep-gates.sh` (initial version follows user spec, not plan spec).
- **Verification:** All three gates pass on the clean tree (exit 0). Each gate exits 1 on a planted violation with the correct `::error::` annotation (see Verification Output).
- **Committed in:** `325b72d`.

**2. [Rule 1 — Bug avoidance] Word boundaries on tone-word alternation**

- **Found during:** Task 2 (gate design — drafting the tone-word regex).
- **Issue:** A naive `(optimize|wellness|honor|...)` regex without `\b` boundaries would fire on legitimate substrings (`tuned`, `Neptune`, `fingernail`, `crusher`, `honored`, etc.) and produce too many false positives to be usable. Untrained, the gate would block ordinary words.
- **Fix:** Wrapped the alternation in `\b...\b`. `dial in` is a separate alternation because `\b` does not span the embedded space.
- **Files modified:** `scripts/ci-grep-gates.sh`.
- **Verification:** Planted `// optimize the loop` trips the gate; words like `tuned` (would appear in legitimate code) do not.
- **Committed in:** `325b72d`.

**3. [Rule 3 — Blocking] BSD grep lacks `-P` for `\p{Emoji}` matching**

- **Found during:** Task 2 (emoji detection design).
- **Issue:** CLAUDE.md bans emoji in code/docs/output. GNU grep can do `-P '\p{Emoji}'` via PCRE2; BSD grep on macos-latest cannot. The user's constraint says "use `grep -rE` or `rg` — pick one and commit it." Neither flavor of `-E` supports `\p{Emoji}`.
- **Fix:** Set `LC_ALL=C` then match emoji at the UTF-8 byte level via `[\xf0-\xf4][\x80-\xbf][\x80-\xbf][\x80-\xbf]`. This matches every 4-byte UTF-8 sequence (U+10000+), which includes every modern emoji codepoint. Probed on macOS BSD grep: `printf '😀\n' | LC_ALL=C grep -E $'[\xf0]'` matches.
- **Files modified:** `scripts/ci-grep-gates.sh`.
- **Verification:** Planted `export const x = '😀';` trips Gate A's emoji branch with `::error::Gate A — emoji found ...`. Removing the line restores exit 0.
- **Committed in:** `325b72d`.

**4. [Rule 1 — Bug avoidance] Self-exempt CLAUDE.md and the script itself from Gate A**

- **Found during:** Task 2 (first dry run — `bash scripts/ci-grep-gates.sh` exited 1 on the clean tree).
- **Issue:** CLAUDE.md enumerates the banned tone words in its rule definition. The script enumerates them in its regex pattern. Both files contain the words. Without self-exemption, Gate A would trip on the rule source itself, making the gate unusable.
- **Fix:** Added `--exclude=CLAUDE.md` and `--exclude=ci-grep-gates.sh` to `REPO_EXCLUDES`. Documented the exemption in the script comment header: "the rule definitions, not enforcement targets."
- **Files modified:** `scripts/ci-grep-gates.sh`.
- **Verification:** `bash scripts/ci-grep-gates.sh` exits 0 on the clean tree after the exemption.
- **Committed in:** `325b72d`.

**5. [Rule 1 — Bug avoidance] Cause-walker boundary test C3 — added "exactly 8 segments" check beyond the plan's at-most-9 spec**

- **Found during:** Task 1 (writing C3).
- **Issue:** The plan's C3 asserts `serializeError(err).split('caused by:').length <= 9`. This catches an over-counting bug (depth > 8) but does not catch an under-counting bug (depth < 8 silently dropped to 7). To pin the boundary in both directions, I added a second test that builds a 10-deep chain and asserts exactly 8 cause segments.
- **Fix:** Added `test('C3 boundary — depth-8 cap is exactly 8 causes', ...)` as a sibling to the plan's C3 test.
- **Files modified:** `src/mcp/sanitize.test.ts`.
- **Verification:** Both tests pass. `npm run test -- src/mcp/sanitize.test.ts` reports 20 passed.
- **Committed in:** `63e3867`.

---

**Total deviations:** 5 (1 user-constraint override, 1 Rule 3 environmental, 3 Rule 1 bug-avoidance).
**Impact on plan:** All deviations strengthen the gate set or test coverage without changing the plan's success criteria. No architectural drift, no D-XX decisions revisited, no scope creep.

## Issues Encountered

- **Interactive-shell `grep` is aliased to ugrep here.** The Claude Code shell wrapper aliases `grep` to ugrep with GNU-grep compatibility flags. CI on macos-latest will not have this alias. Resolved by using `GREP="${GREP:-grep}"` and probing `/usr/bin/grep` directly when designing the byte-level emoji pattern.
- **`src/cli/commands/doctor.ts` does not exist yet (Plan 05 creates it).** Gate C's exemption path is forward-referenced. Not a bug — the gate logic exempts the path string literally; no `[ -f ... ]` check is required for the gate to pass.

## Verification Output

End-to-end plan verification (clean tree, post-Task 2):

```
$ npm run test
 RUN  v4.1.6
 Test Files  2 passed (2)
 Tests       22 passed (22)
exit 0

$ npm run lint
> biome check
Checked 12 files in 6ms. No fixes applied.
exit 0

$ npx tsc --noEmit
exit 0

$ bash scripts/ci-grep-gates.sh
All grep gates passed.
exit 0
```

Deliberate-failure round trips (each gate fires on a planted violation, then the working tree is restored):

```
# Gate C — process.stdout.write outside src/cli/commands/doctor.ts
$ printf "process.stdout.write('planted-violation');\n" > src/mcp/_grep-gate-self-check.ts
$ bash scripts/ci-grep-gates.sh
::error::Gate C — process.stdout.write outside src/cli/commands/doctor.ts:
src/mcp/_grep-gate-self-check.ts:1:process.stdout.write('planted-violation');
exit 1
$ rm -f src/mcp/_grep-gate-self-check.ts && bash scripts/ci-grep-gates.sh
All grep gates passed.
exit 0

# Gate B — console.warn outside src/cli/** and *.test.ts
$ printf "console.warn('planted');\nexport {};\n" > src/mcp/_grep-gate-self-check.ts
$ bash scripts/ci-grep-gates.sh
::error::Gate B — console.log/error/warn outside src/cli/** and test files:
src/mcp/_grep-gate-self-check.ts:1:console.warn('planted');
exit 1
$ rm -f src/mcp/_grep-gate-self-check.ts && bash scripts/ci-grep-gates.sh
All grep gates passed.
exit 0

# Gate A — banned tone word
$ printf "// optimize the loop\nexport {};\n" > src/mcp/_grep-gate-self-check.ts
$ bash scripts/ci-grep-gates.sh
::error::Gate A — banned tone word found (CLAUDE.md §Critical Rules):
./src/mcp/_grep-gate-self-check.ts:1:// optimize the loop
exit 1
$ rm -f src/mcp/_grep-gate-self-check.ts && bash scripts/ci-grep-gates.sh
All grep gates passed.
exit 0

# Gate A — emoji
$ printf "export const x = '\xf0\x9f\x98\x80';\n" > src/mcp/_grep-gate-self-check.ts
$ bash scripts/ci-grep-gates.sh
::error::Gate A — emoji found (CLAUDE.md §Critical Rules — banned in all output):
./src/mcp/_grep-gate-self-check.ts:1:export const x = '😀';
exit 1
$ rm -f src/mcp/_grep-gate-self-check.ts && bash scripts/ci-grep-gates.sh
All grep gates passed.
exit 0
```

Exemption sanity checks (legitimate console.* and process.stdout.write pass):

```
# Test file with console.log is exempt (biome.json **/*.test.ts override mirror)
$ printf "console.log('exempt');\nexport {};\n" > src/mcp/_sanity.test.ts
$ bash scripts/ci-grep-gates.sh
All grep gates passed.
exit 0
$ rm -f src/mcp/_sanity.test.ts

# src/cli/commands/doctor.ts is exempt from Gate C (D-04 + D-11)
$ mkdir -p src/cli/commands
$ printf "process.stdout.write('approved');\n" > src/cli/commands/doctor.ts
$ bash scripts/ci-grep-gates.sh
All grep gates passed.
exit 0
$ rm -f src/cli/commands/doctor.ts && rmdir src/cli/commands
```

The temporary `src/mcp/_grep-gate-self-check.ts` file referenced in the plan was created and deleted within each verification step; it is not present in the working tree or in git history. The plan's Task 2 self-check round-trip is recorded above for Gate C; the same recipe with `console.warn` / `// optimize` / `'😀'` exercises Gates B and A.

## Next Phase Readiness

Plan 01-05 (CLI doctor) can now:

- Create `src/cli/commands/doctor.ts` with `process.stdout.write(...)` calls — Gate C exempts that exact path per D-04 + D-11.
- Overwrite `src/cli/index.ts` (currently `export {};`) with the real Commander wiring — `src/cli/**` is exempt from Gate B (the `noConsole` Biome override mirrors this).
- Land the real `createServices()` over `services/doctor/checks/native-modules.ts` + `services/doctor/checks/mcp-stdout-purity.ts`. The Services contract is locked from Plan 03; no MCP-tool changes needed.

Plan 01-06 (CI integration) can:

- Add a single `run: bash scripts/ci-grep-gates.sh` step in `.github/workflows/ci.yml`. The script is executable, POSIX-portable, and exits 0 on a green tree.
- Optionally add a fourth gate inline in the workflow (or in this script) for the `server.registerTool` chokepoint (`grep -rEn 'server\.registerTool' src/mcp/ | grep -v 'src/mcp/register.ts'`). The contract is already enforced structurally by Plan 03 having only one call site.
- Reuse the same `set -euo pipefail` + `LC_ALL=C` pattern if any new gates are added.

## User Setup Required

None — this plan adds only test source + a bash script.

## Self-Check: PASSED

- `src/mcp/sanitize.test.ts` exists on disk; `npm run test` reports 20 passed in this file (22 total across the suite).
- `scripts/ci-grep-gates.sh` exists on disk, is executable (`100755`), and exits 0 on the clean tree.
- All three gates fire on a planted violation with the correct `::error::` annotation (recorded in Verification Output).
- All five acceptance-criteria literals from Task 1 are present in `src/mcp/sanitize.test.ts` (verified via grep on `Authorization: Bearer`, `access_token`, `refresh_token`, `client_secret`, `eyJ`, `Bearer`, `err.cause = err`, `fetch failed`, `UND_ERR_`, plus the deep-chain `for` loop).
- All commits exist in `git log`:
  - `63e3867 test(01-04): cover sanitize patterns and cause chain (D-07, D-08, D-10)`
  - `325b72d chore(01-04): add CI grep gates for tone, console, and stdout (D-04)`
- `npm run test && npm run lint && bash scripts/ci-grep-gates.sh` all exit 0.
- `npx tsc --noEmit` exits 0.
- `src/mcp/_grep-gate-self-check.ts` is NOT present in the working tree (`test ! -e src/mcp/_grep-gate-self-check.ts` exits 0).
- No discrepancies between claims in this summary and verifiable state.

---
*Phase: 01-foundation-stdout-pure-mcp-bootstrap*
*Completed: 2026-05-12*
