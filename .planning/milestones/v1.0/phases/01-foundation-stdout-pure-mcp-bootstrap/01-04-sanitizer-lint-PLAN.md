---
phase: 01-foundation-stdout-pure-mcp-bootstrap
plan: 04
type: execute
wave: 3
depends_on:
  - 02
  - 03
files_modified:
  - src/mcp/sanitize.test.ts
  - scripts/ci-grep-gates.sh
autonomous: true
requirements:
  - FND-05
  - FND-06
requirements_addressed:
  - FND-05
  - FND-06
tags:
  - tests
  - sanitizer
  - lint
  - grep-gates
must_haves:
  truths:
    - "Every D-07 regex pattern has at least one positive (matches+redacts) and one negative (passes through unchanged) test case"
    - "The cause-chain walker is verified for: linear chain, cycle, depth > 8, mixed Error + non-Error causes"
    - "D-10 'errors that historically leak' fixture set is exercised: fetch TypeError with Authorization cause, undici UND_ERR_* with JWT, JSON body with access_token, Error with bare Bearer prefix"
    - "`scripts/ci-grep-gates.sh` runs three gates and exits 0 on the clean tree"
    - "Each gate exits 1 when a violation is planted (deliberate-failure verification step)"
  artifacts:
    - path: "src/mcp/sanitize.test.ts"
      provides: "Vitest unit test for `sanitize()` + `serializeError()` covering all four patterns and the cause-chain walker"
      contains: "describe('sanitize'"
    - path: "scripts/ci-grep-gates.sh"
      provides: "Three CI grep gates — biome-ignore-noConsole, process.stdout outside cli, server.registerTool outside register.ts"
      contains: "biome-ignore.*noConsole"
  key_links:
    - from: "src/mcp/sanitize.test.ts"
      to: "src/mcp/sanitize.ts"
      via: "import { sanitize, serializeError, PATTERNS } from './sanitize.js'"
      pattern: "from\\s+['\"]\\.\\/sanitize\\.js['\"]"
    - from: "scripts/ci-grep-gates.sh"
      to: "src/mcp/, src/cli/"
      via: "grep -rEn over the source tree with exit-1-on-match semantics"
      pattern: "grep -rEn"
---

<objective>
Lock the sanitizer behavior with unit tests and lock the lint discipline with three CI grep gates. This is the Plan that turns FND-05 and FND-06 from "code exists" into "code is regression-tested and a future contributor can't silently break the contract."

Purpose: D-10 prescribes a unit-tested sanitizer against fixtures of "errors that historically leak." D-04 prescribes Biome `noConsole` PLUS sibling grep gates (Biome can't see `process.stdout`, can't see `biome-ignore` comments at the file level, and can't enforce file-path rules for `server.registerTool`). D-09 prescribes the third grep gate forcing `server.registerTool` to live in `register.ts` only. Plan 06 wires these into GitHub Actions; this plan creates the test + the script. Pitfall 10 documents the exact exit-code semantics for grep gates (matches found = exit 0 = bad; the script must invert).

Output: One test file with at least 12 test cases (one per D-07 pattern × positive/negative, plus the 4 D-10 fixtures, plus the 3 cause-chain edge cases), one bash script with three guarded gates and inline comments referencing the D-IDs.
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
@.planning/research/PITFALLS.md
@.planning/phases/01-foundation-stdout-pure-mcp-bootstrap/01-CONTEXT.md
@.planning/phases/01-foundation-stdout-pure-mcp-bootstrap/01-RESEARCH.md
@.planning/phases/01-foundation-stdout-pure-mcp-bootstrap/01-VALIDATION.md
@CLAUDE.md
@src/mcp/sanitize.ts
@src/mcp/register.ts
@biome.json

<interfaces>
<!-- Surface available from Plan 03's sanitize.ts (verified at plan-write time): -->
export const PATTERNS: ReadonlyArray<{ pattern: RegExp; replacement: string }>;
export function sanitize(input: string): string;
export function serializeError(err: unknown): string;
</interfaces>
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: Create src/mcp/sanitize.test.ts — D-10 fixtures + four-pattern coverage + cause-chain edges</name>
  <files>src/mcp/sanitize.test.ts</files>
  <read_first>
    - src/mcp/sanitize.ts (Plan 03 output — the exact regex set and serializeError signature)
    - .planning/phases/01-foundation-stdout-pure-mcp-bootstrap/01-CONTEXT.md (D-07 — pattern catalog; D-08 — depth ≤ 8 + cycle protection; D-10 — minimum fixture set)
    - .planning/phases/01-foundation-stdout-pure-mcp-bootstrap/01-RESEARCH.md (Pattern 4 — regex specifics; Pitfall 8 — JSON-escaped header edge; Pitfall 9 — cycle protection; Validation Architecture table rows for FND-06)
    - .planning/phases/01-foundation-stdout-pure-mcp-bootstrap/01-VALIDATION.md (sanitizer-unit row — `npm run test -- src/mcp/sanitize.test.ts`)
    - CLAUDE.md §Testing (`pool: 'forks'`)
    - biome.json (so executor confirms `**/*.test.ts` override exempts tests from noConsole — though the tests should not log)
  </read_first>
  <behavior>
    - **Four-pattern positive cases:**
      - Test P1+: `sanitize('Header is Authorization: Bearer abc.def.ghi rest')` returns a string containing `'Authorization: Bearer <redacted>'` and NOT containing `'abc.def.ghi'`.
      - Test P1+ (case-insensitive): `sanitize('authorization: bearer abc.def.ghi')` is also redacted (the `i` flag).
      - Test P2+: `sanitize('{"access_token":"abc123","other":"keep"}')` contains `'"access_token":"<redacted>"'` AND `'"other":"keep"'` (back-reference keeps key visible).
      - Test P2+ (refresh_token): `sanitize('{"refresh_token":"xyz"}')` contains `'"refresh_token":"<redacted>"'`.
      - Test P2+ (client_secret): `sanitize('{"client_secret":"shh"}')` contains `'"client_secret":"<redacted>"'`.
      - Test P3+: `sanitize('token=eyJabcdef.eyJxyzabcdef.signatureMoreChars')` contains `'<redacted-jwt>'`.
      - Test P4+: `sanitize('Bearer abcdef1234567890')` returns `'Bearer <redacted>'` (≥ 10 trailing chars).
    - **Four-pattern negative cases:**
      - Test P4-: `sanitize('the word Bearer in prose')` is unchanged (< 10 trailing chars).
      - Test P3-: `sanitize('eyJabc.eyJdef')` (only two segments) is unchanged (JWT requires three).
    - **D-10 fixture set (errors that historically leak):**
      - Test F1: `const err = new TypeError('fetch failed', { cause: new Error('Authorization: Bearer eyJabc.eyJdef.signature123') });` — `sanitize(serializeError(err))` contains neither `'Bearer eyJ'` nor `'Authorization:'` followed by anything other than `' Bearer <redacted>'`.
      - Test F2: `const err = new Error('UND_ERR_HEADERS_TIMEOUT — body: "Bearer eyJxxx.eyJyyy.zzz"');` — sanitized output contains neither `'Bearer eyJ'` nor `'eyJxxx.eyJyyy'`.
      - Test F3: `const err = new Error('Response body: {"access_token":"secret_value","expires_in":3600}');` — sanitized output contains `'"access_token":"<redacted>"'` AND `'"expires_in":3600'` AND does NOT contain `'secret_value'`.
      - Test F4: `const err = new Error('Bearer eyJabcdef.eyJghijkl.mnopqrst — leaked');` — sanitized output does NOT contain `'Bearer eyJ'` and does NOT contain the full JWT shape.
    - **Cause-chain edge cases:**
      - Test C1 (linear): `new Error('outer', { cause: new Error('middle', { cause: new Error('inner') }) })` → `serializeError` returns `'outer — caused by: middle — caused by: inner'`.
      - Test C2 (cycle): `const err = new Error('boom'); err.cause = err;` → `serializeError(err)` returns within a bounded time (no infinite loop); contains `'boom'`.
      - Test C3 (depth > 8): a 20-deep chain → `serializeError` includes at most 9 segments (1 root + 8 causes — interpret D-08 as "depth-limited to 8 cause links").
      - Test C4 (non-Error cause): `new Error('outer', { cause: 'just a string' })` → output contains `'caused by: just a string'`.
  </behavior>
  <action>
    Create `src/mcp/sanitize.test.ts` as a Vitest spec co-located with `sanitize.ts`. Use `import { describe, expect, test } from 'vitest';` and `import { sanitize, serializeError, PATTERNS } from './sanitize.js';`. Group tests in three `describe()` blocks: `describe('sanitize patterns', ...)`, `describe('serializeError cause chain', ...)`, and `describe('D-10 fixtures', ...)`. Each test should be a single `expect()` assertion focused on ONE property (positive match or negative non-match) to keep failure messages crisp. Per the behavior block above, ship AT LEAST 12 test cases (4 patterns positive + 2 negative + 4 D-10 fixtures + 4 cause-chain cases = 14 minimum). For C3 (depth limit), build the chain with a `for` loop: `let err = new Error('depth20'); for (let i = 19; i >= 0; i--) err = new Error(`depth${i}`, { cause: err });` then assert `serializeError(err).split('caused by:').length <= 9`. Per CLAUDE.md §Code Style: no default exports, ESM, named imports. Tests are exempt from `noConsole` per `biome.json`, but should not log — assertions are silent.
  </action>
  <verify>
    <automated>npm run test -- src/mcp/sanitize.test.ts --reporter=basic && echo OK</automated>
  </verify>
  <done>
    `src/mcp/sanitize.test.ts` exists with at least 12 passing tests covering all four D-07 patterns (positive + negative), the four D-10 fixtures, and the four cause-chain edges (linear, cycle, depth > 8, non-Error cause). `npm run test -- src/mcp/sanitize.test.ts` exits 0.
  </done>
  <acceptance_criteria>
    - Source: `src/mcp/sanitize.test.ts` imports `sanitize`, `serializeError`, `PATTERNS` from `./sanitize.js`.
    - Source: contains the strings `'Authorization: Bearer'` AND `'access_token'` AND `'refresh_token'` AND `'client_secret'` AND `'eyJ'` AND `'Bearer'` (each pattern is exercised).
    - Source: contains `WeakSet`-cycle test setup `err.cause = err` (Pitfall 9).
    - Source: contains a `for` loop building a chain of at least 9 nested causes (depth limit test).
    - Source: contains `'fetch failed'` (D-10 fixture F1 — Node fetch TypeError shape).
    - Source: contains `'UND_ERR_'` (D-10 fixture F2 — undici variant).
    - Behavior: `npm run test -- src/mcp/sanitize.test.ts --reporter=basic` exits 0.
    - Behavior: test output shows >= 12 passing assertions.
    - Behavior: file ends in `.test.ts` (Vitest include glob picks it up; Biome `**/*.test.ts` override applies).
  </acceptance_criteria>
</task>

<task type="auto">
  <name>Task 2: Create scripts/ci-grep-gates.sh — three CI grep gates per D-04 + D-09</name>
  <files>scripts/ci-grep-gates.sh</files>
  <read_first>
    - .planning/phases/01-foundation-stdout-pure-mcp-bootstrap/01-RESEARCH.md (CI workflow §`.github/workflows/ci.yml` — the three grep blocks; Pitfall 10 — grep exit-code semantics)
    - .planning/phases/01-foundation-stdout-pure-mcp-bootstrap/01-CONTEXT.md (D-04 — two grep gates beyond noConsole; D-09 — register.ts is the only registerTool site)
    - .planning/phases/01-foundation-stdout-pure-mcp-bootstrap/01-VALIDATION.md (Wave 0 Requirements row for scripts/ci-grep-gates.sh; ci-grep-gates row in Per-Task Verification Map)
    - src/mcp/register.ts (Plan 03 output — confirm this is the ONE place server.registerTool is allowed)
    - src/cli/ existence (Plan 03 created a one-line stub `src/cli/index.ts = "export {};\n"`; Plan 05 will flesh it out — the grep gate operates on whatever `src/` looks like at run time)
  </read_first>
  <action>
    Create `scripts/ci-grep-gates.sh` as a bash script with `#!/usr/bin/env bash` shebang and `set -euo pipefail` for strict failure semantics. Three gates, in order, each implementing the inverted-grep pattern from Pitfall 10 (matches = exit 1; no matches = exit 0). **Gate 1** (D-04, line-numbered grep over src/): `if grep -rEn 'biome-ignore.*noConsole' src/; then echo "::error::Inline biome-ignore for noConsole is banned. Use biome.json overrides."; exit 1; fi`. **Gate 2** (D-04): `if grep -rEn 'process\.stdout' src/ --include='*.ts' | grep -v '^src/cli/'; then echo "::error::process.stdout used outside src/cli/."; exit 1; fi`. **Gate 3** (D-09): `if grep -rEn 'server\.registerTool' src/mcp/ --include='*.ts' | grep -v 'src/mcp/register.ts'; then echo "::error::server.registerTool used outside src/mcp/register.ts. Use register() wrapper."; exit 1; fi`. Each gate's `echo "::error::..."` uses the GitHub Actions error annotation syntax verbatim from RESEARCH §CI workflow. End the script with `echo "All grep gates passed."` and `exit 0`. **Important:** the script lifts from RESEARCH.md verbatim except for being repackaged as a sibling bash script so Plan 06's CI workflow can shell out to it (`bash scripts/ci-grep-gates.sh`) instead of inlining three workflow steps. This keeps `.github/workflows/ci.yml` short and lets developers run the gates locally without GitHub Actions. After writing, `chmod +x scripts/ci-grep-gates.sh`.

    **Self-check (deliberate-failure verification):** to prove the script's correctness without mutating any file owned by another plan (Plan 05 is also in Wave 3 and touches `src/mcp/` adjacent files), the verification step creates a NEW file `src/mcp/_grep-gate-self-check.ts` containing exactly one line of body — `process.stdout.write('planted-violation');` — runs the gate script, asserts exit code 1 AND the Gate 2 `::error::` message, then DELETES the self-check file in the same step. The leading underscore in the filename signals "internal/temporary"; tsup doesn't auto-include files this way (entries are explicit in `tsup.config.ts`), so creating it briefly cannot corrupt any build output. Plan 05 does NOT touch `src/mcp/_grep-gate-self-check.ts` — there is zero file overlap with any other Wave 3 plan, so this self-check cannot race with parallel-wave plans.
  </action>
  <verify>
    <automated>chmod +x scripts/ci-grep-gates.sh && bash scripts/ci-grep-gates.sh && echo "GATES_PASS_CLEAN" && printf "process.stdout.write('planted-violation');\n" > src/mcp/_grep-gate-self-check.ts && OUTPUT=$(bash scripts/ci-grep-gates.sh 2>&1; echo "EXIT=$?") && rm -f src/mcp/_grep-gate-self-check.ts && echo "$OUTPUT" | grep -q "EXIT=1" && echo "$OUTPUT" | grep -q "::error::process.stdout used outside src/cli/" && echo "GATE_2_CATCHES_PLANT" && bash scripts/ci-grep-gates.sh && echo OK</automated>
  </verify>
  <done>
    `scripts/ci-grep-gates.sh` exists, is executable, exits 0 on the clean tree, and exits 1 when a `process.stdout` violation is planted in a freshly-created `src/mcp/_grep-gate-self-check.ts` (the self-check file is deleted at the end of the verification step — the working tree is clean afterwards). All three gates are present and each prints a `::error::`-prefixed message on failure. The self-check does NOT touch any file owned by another Wave 3 plan, so Plan 05's `npm run build` cannot race against a planted violation.
  </done>
  <acceptance_criteria>
    - Source: `scripts/ci-grep-gates.sh` starts with `#!/usr/bin/env bash` AND contains `set -euo pipefail`.
    - Source: contains all three gate patterns: `biome-ignore.*noConsole` AND `process\.stdout` AND `server\.registerTool`.
    - Source: each gate uses the `if grep ...; then ... exit 1; fi` inverted pattern (Pitfall 10).
    - Source: each error message starts with `::error::` (GitHub Actions annotation).
    - Source: Gate 2 excludes `src/cli/` (per D-04: process.stdout is allowed there); Gate 3 excludes `src/mcp/register.ts` (per D-09: registerTool is allowed there).
    - Behavior: file is executable (`test -x scripts/ci-grep-gates.sh` exits 0).
    - Behavior: `bash scripts/ci-grep-gates.sh` exits 0 on the current clean tree (after Plans 01-03 ran).
    - Behavior: planting `process.stdout.write('x')` into a freshly-created `src/mcp/_grep-gate-self-check.ts` causes the script to exit 1 with the Gate 2 `::error::` message; deleting the self-check file restores exit 0 (verified in the automated step above).
    - Behavior: after the verification step completes, `test -e src/mcp/_grep-gate-self-check.ts` returns false (the temporary self-check file is gone — the working tree is clean).
    - Behavior: at no point during the self-check is `src/mcp/index.ts` (or any other file shared with another Wave 3 plan) mutated. This is structurally guaranteed because the self-check uses a freshly-created file rather than appending to an existing one.
  </acceptance_criteria>
</task>

</tasks>

<verification>
1. `npm run test -- src/mcp/sanitize.test.ts` exits 0 with ≥ 12 passing assertions.
2. `bash scripts/ci-grep-gates.sh` exits 0 on the clean tree.
3. The planted-violation round-trip in Task 2's automated check confirms each gate fires (the script catches a real violation, not just no-ops). The self-check is contained in a freshly-created `src/mcp/_grep-gate-self-check.ts` that is deleted in the same step — no file shared with any other Wave 3 plan is touched.
4. `npm run lint && npm run test && bash scripts/ci-grep-gates.sh` exits 0 end-to-end after this plan completes.
5. Plan 06 will integrate `scripts/ci-grep-gates.sh` into `.github/workflows/ci.yml` as a single `run: bash scripts/ci-grep-gates.sh` step.

**Note on Wave 3 parallelism:** Plan 04 (this plan) and Plan 05 (CLI + doctor) have no file overlap (`src/mcp/sanitize.test.ts` + `scripts/` + a transient `src/mcp/_grep-gate-self-check.ts` vs `src/cli/**` + `src/services/doctor/**` + `src/formatters/**`) and can run in parallel. The Task 2 self-check creates AND deletes `src/mcp/_grep-gate-self-check.ts` within the same step — no race with Plan 05's `npm run build`.
</verification>

<success_criteria>
- All four D-07 regex patterns are covered by positive + negative tests.
- All four D-10 fixture types (fetch TypeError, undici UND_ERR_*, JSON access_token, bare Bearer) pass through `sanitize(serializeError(err))` redacted.
- The cause-chain walker handles linear, cyclic, deep, and non-Error causes.
- Three grep gates land in a single bash script that Plan 06 can wire into GitHub Actions with one line.
- The script catches at least one planted violation in the automated verify step (deliberate-failure confirmation), using a freshly-created `src/mcp/_grep-gate-self-check.ts` so no file shared with Plan 05 is mutated.
- `npm run test && npm run lint && bash scripts/ci-grep-gates.sh` exits 0.
</success_criteria>

<output>
After completion, create `.planning/phases/01-foundation-stdout-pure-mcp-bootstrap/01-04-SUMMARY.md` documenting: the final test count in sanitize.test.ts, which D-10 fixtures revealed bugs in the regex set (if any required tightening), which grep-gate adjustments were needed (e.g., if `--include='*.ts'` had to be replaced with `--include="*.ts"` for macOS bash quoting), and confirmation that the `src/mcp/_grep-gate-self-check.ts` self-check file was cleaned up at the end of Task 2.
</output>
</content>
</invoke>