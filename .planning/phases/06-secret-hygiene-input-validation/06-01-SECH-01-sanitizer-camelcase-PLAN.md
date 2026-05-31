---
phase: 06-secret-hygiene-input-validation
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - src/infrastructure/observability/sanitize.ts
  - src/infrastructure/observability/sanitize.test.ts
autonomous: true
requirements:
  - SECH-01
github_issue: "#78"
target_branch: feat/sech-01-sanitizer-camelcase
target_pr_title: "fix(sanitizer): cover camelCase token keys (#78)"
tags:
  - sanitizer
  - secret-hygiene
  - v1.1
must_haves:
  truths:
    - "sanitize() redacts camelCase token-key values (accessToken, refreshToken, clientSecret, clientId, idToken, apiKey, bearerToken) across JSON, URL-query, form-body, and JS-literal shapes"
    - "A property-style fixture matrix (≥ 50 token-key shape rows) drives a single table-driven test; every row goes input → sanitize() → assert no raw value substring remains"
    - "Snake_case behavior (already shipped in v1.0) is unchanged — no test removed, no regex weakened"
    - "Pattern count and SECRET_KEY_NAMES membership are pinned (regression locks)"
  artifacts:
    - path: "src/infrastructure/observability/sanitize.ts"
      provides: "SECRET_KEY_NAMES extended with camelCase entries; PATTERNS array length unchanged"
      contains: "accessToken"
    - path: "src/infrastructure/observability/sanitize.test.ts"
      provides: "Table-driven property-style matrix covering ≥ 50 token-key shapes"
      contains: "SECH-01 matrix"
  key_links:
    - from: "src/infrastructure/observability/sanitize.test.ts"
      to: "src/infrastructure/observability/sanitize.ts"
      via: "import { SECRET_KEY_NAMES, sanitize } from './sanitize.js'"
      pattern: "from\\s+['\"]\\.\\/sanitize\\.js['\"]"
---

<objective>
Close issue #78 (SECH-01): the v1.0 `SECRET_KEY_NAMES` constant only covers snake_case spellings (`access_token`, `refresh_token`, `client_secret`, ...). Real-world WHOOP SDK wrappers, third-party HTTP middleware, and `util.inspect` output regularly surface camelCase variants (`accessToken`, `refreshToken`, `clientSecret`). The `/i` flag on PATTERNS 2/2a/2b/2c handles letter-case folding but NOT the missing underscore separator — `"accessToken":"..."` slips through every regex today.

Purpose: extend the canonical key list so a single edit lands in all four pattern shapes (PATTERNS 2, 2a, 2b, 2c) and ship a ≥ 50-row property-style matrix that makes silent regression impossible.

Output: one production change (extend `SECRET_KEY_NAMES`), one test surface extension (table-driven matrix + membership pins + PATTERNS-length assertion bump). No new dependencies; no new files.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/PROJECT.md
@.planning/ROADMAP.md
@.planning/REQUIREMENTS.md
@.planning/STATE.md
@.planning/phases/06-secret-hygiene-input-validation/06-CONTEXT.md
@.planning/phases/06-secret-hygiene-input-validation/06-RESEARCH.md
@.planning/research-v1.1/SUMMARY.md
@.planning/research-v1.1/PITFALLS.md
@agent_docs/decisions/0001-mcp-stdout-purity.md
@CLAUDE.md
@src/infrastructure/observability/sanitize.ts
@src/infrastructure/observability/sanitize.test.ts

<interfaces>
<!-- Live surface (verified at plan-write time). -->
export const SECRET_KEY_NAMES: readonly string[];   // snake_case-only as of v1.0
export const SECRET_KEY_ALT: string;                  // built from SECRET_KEY_NAMES.join('|')
export const PATTERNS: ReadonlyArray<{ pattern: RegExp; replacement: string }>; // length 7
export function sanitize(input: string): string;
export function serializeError(err: unknown): string;

<!-- The four pattern shapes that consume SECRET_KEY_NAMES via SECRET_KEY_ALT: -->
<!-- 2 : `"<KEY>":"<value>"`            (double-quoted JSON)               -->
<!-- 2a: `[?&]<KEY>=<value>`            (URL query)                        -->
<!-- 2b: `\b<KEY>=<value>`              (form body)                        -->
<!-- 2c: `\b<KEY>\s*[:=]\s*['"]?<value>` (util.inspect / single-quoted JS) -->
</interfaces>
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: Extend SECRET_KEY_NAMES with camelCase variants</name>
  <files>
    src/infrastructure/observability/sanitize.ts
    src/infrastructure/observability/sanitize.test.ts
  </files>
  <read_first>
    - src/infrastructure/observability/sanitize.ts (full file — SECRET_KEY_NAMES on lines 18–30, PATTERNS 2/2a/2b/2c on lines 38–104)
    - src/infrastructure/observability/sanitize.test.ts (lines 16–36 for PATTERNS length + SECRET_KEY_NAMES membership pins — these tests must keep passing AND gain camelCase entries)
    - .planning/phases/06-secret-hygiene-input-validation/06-CONTEXT.md § "Sub-PR A — SECH-01 (#78)"
  </read_first>
  <behavior>
    - SECRET_KEY_NAMES gains the following entries (in addition to the 11 already present): `accessToken`, `refreshToken`, `clientSecret`, `clientId`, `idToken`, `apiKey`, `bearerToken`. Existing snake_case entries (`access_token`, `refresh_token`, `client_secret`, `id_token`, `session_token`, `api_key`, `api_token`, `secret`, `password`, `private_key`, `code`) are NOT removed and NOT reordered.
    - PATTERNS array length stays at 7 (the same four key-consuming patterns rebuild from the extended SECRET_KEY_ALT alternation; no new regex rule is added).
    - sanitize('{"accessToken":"abc123"}') contains '"accessToken":"<redacted>"' and NOT 'abc123'.
    - sanitize('?refreshToken=xyz&user=me') contains '?refreshToken=<redacted>' and NOT 'xyz'; sibling 'user=me' is preserved.
    - sanitize('grant_type=authorization_code&clientSecret=hunter2') contains 'clientSecret=<redacted>' and NOT 'hunter2'; the non-secret 'grant_type=authorization_code' marker is preserved.
    - sanitize("{ accessToken: 'abc' }") (util.inspect shape) contains 'accessToken=<redacted>' and NOT 'abc'.
    - Membership pins in sanitize.test.ts gain 7 new `expect(SECRET_KEY_NAMES).toContain('<camelCase>')` lines, one per added key.
    - Spot-checks: existing snake_case tests (P2+ access_token, P2a+ refresh_token, P2b+ client_secret, P2c+ access_token) keep passing — proof that the alternation re-build did not regress.
  </behavior>
  <action>
    Update `SECRET_KEY_NAMES` (sanitize.ts:18–30) by appending the seven camelCase entries listed above to the `as const` tuple, AFTER all existing snake_case entries (preserve order — readers scan top-to-bottom and existing entries are load-bearing for git-blame). PATTERNS lines 38–104 require zero edits because they reference `SECRET_KEY_ALT` (sanitize.ts:32), which is `SECRET_KEY_NAMES.join('|')` — extending the source array extends every consumer pattern in lockstep (this is the MR-11 design from Phase 1 Plan 01-03; preserve it).

    Update `sanitize.test.ts` by (a) appending 7 `expect(SECRET_KEY_NAMES).toContain('<camelCase>')` lines inside the existing `test('SECRET_KEY_NAMES includes the canonical OAuth + auth-token keys (MR-11)', …)` block (lines 24–36), and (b) inserting the new top-level `describe('SECH-01 matrix — camelCase token-key coverage (#78)', …)` block defined in Task 2 below.

    Do NOT touch the cause-chain walker (`serializeError`) — out of scope for #78.

    Comment discipline: per agent_docs/conventions.md § Code style, no `what`-comments. The only comment to add is a brief `// SECH-01 (#78): camelCase variants` annotation immediately above the new entries so a future reader sees the issue link without `git blame`.
  </action>
  <verify>
    <automated>npm run test -- src/infrastructure/observability/sanitize.test.ts --reporter=basic && npm run lint && grep -c "accessToken\|refreshToken\|clientSecret\|clientId\|idToken\|apiKey\|bearerToken" src/infrastructure/observability/sanitize.ts | grep -qE '^[7-9]|^[1-9][0-9]+$' && echo OK</automated>
  </verify>
  <done>
    `SECRET_KEY_NAMES` contains the 11 v1.0 snake_case keys AND the 7 new camelCase keys. The PATTERNS length pin (`expect(PATTERNS.length).toBeGreaterThanOrEqual(7)`) still holds. All v1.0 sanitize tests pass unchanged.
  </done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: Add SECH-01 property-style fixture matrix (≥ 50 rows)</name>
  <files>src/infrastructure/observability/sanitize.test.ts</files>
  <read_first>
    - src/infrastructure/observability/sanitize.test.ts § lines 471–565 (existing F6 positional matrix is the closest table-driven analog — match its shape but expand to ≥ 50 rows)
    - .planning/research-v1.1/PITFALLS.md "Sanitize property-test sprawl" — keep declarative / table-driven; one describe block, one for-loop, one assertion shape
    - CLAUDE.md § Testing — `pool: 'forks'` mandatory; tests must stay deterministic + offline
  </read_first>
  <behavior>
    - A new `describe('SECH-01 matrix — camelCase token-key coverage (#78)', …)` block contains exactly one `test.each(MATRIX)` (or equivalent for-loop over a const array) iterating over ≥ 50 fixture rows.
    - Each row is `{ key: string; shape: 'json' | 'urlquery' | 'formbody' | 'jsliteral'; rawValue: string; rendered: string }` where `rendered` is the input string fed to `sanitize()`.
    - 7 camelCase keys × 4 shapes × at least 2 fixture values per (key, shape) pair = ≥ 56 rows. Snake_case keys can also appear in the matrix as regression coverage; total ≥ 50 is the floor.
    - For each row, the test asserts: (a) `out !== rendered` (something was redacted), (b) `out` does NOT contain `rawValue` (no leak), (c) `out` contains either `<redacted>` or `<redacted-jwt>` (one of the known markers).
    - Matrix is declared as a top-level `const` so its `.length` can be asserted: `expect(MATRIX.length).toBeGreaterThanOrEqual(50)` — regression lock against a future PR silently shrinking the matrix.
    - Matrix shapes cover the four pattern entry points end-to-end:
      - json: `'{"<key>":"<rawValue>"}'`
      - urlquery: `'https://api.example.com/cb?<key>=<rawValue>&state=x'`
      - formbody: `'grant_type=refresh_token&<key>=<rawValue>&client_id=c'`
      - jsliteral: `"context: { <key>: '<rawValue>' }"`
    - Negative anchor: the matrix MUST include at least one snake_case row per shape (re-asserts v1.0 behavior) and at least one mixed-case row per shape (re-asserts the /i flag).
  </behavior>
  <action>
    Insert the new describe block AFTER the existing F7 OAuth-callback block (around line 583) and BEFORE the Phase 4 tool-error fixtures block. Declare the matrix as `const SECH_01_MATRIX: ReadonlyArray<{ key: string; shape: 'json' | 'urlquery' | 'formbody' | 'jsliteral'; rawValue: string; rendered: string }> = [...]` at the top of the describe scope, then drive `test.each(SECH_01_MATRIX)('%s shape %s redacts %s', ({ key, shape, rawValue, rendered }) => { ... })`. Use a unique `rawValue` per row (e.g., `sech01_${key}_${shape}_${i}`) so a single row's failure produces a debuggable assertion.

    Build the matrix programmatically OR via a literal array — both are acceptable, but the assertion code must NOT loop inside a single `test()` (that would produce one failure for many rows). Use `test.each` so each row gets its own test name in Vitest output.

    Do NOT add new patterns to sanitize.ts as a side effect of failing matrix rows. If a row fails, the correct response is to extend SECRET_KEY_NAMES (Task 1) — patterns are frozen. Surface any unexpected failure as a deviation in the SUMMARY.

    Add one matrix-length assertion: `test('SECH-01 matrix has at least 50 rows (#78 — regression lock)', () => { expect(SECH_01_MATRIX.length).toBeGreaterThanOrEqual(50); });`.
  </action>
  <verify>
    <automated>npm run test -- src/infrastructure/observability/sanitize.test.ts --reporter=basic 2>&1 | tee /tmp/sech01.log && grep -E "SECH-01 matrix" /tmp/sech01.log | head -5 && grep -cE "test.each|SECH_01_MATRIX" src/infrastructure/observability/sanitize.test.ts | grep -qE '^[2-9]' && echo OK</automated>
  </verify>
  <done>
    `npm run test -- src/infrastructure/observability/sanitize.test.ts` exits 0 with ≥ 50 SECH-01 matrix assertions passing. The matrix is declared as a `const` array and is reachable from the length-lock assertion.
  </done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| WHOOP HTTP response → error message | Token values in undici/UND_ERR_* bodies, JSON parse errors, JS literal shapes from `util.inspect` |
| MCP tool result → JSON-RPC stdout | Error strings returned to MCP clients (logged, persisted, surfaced in agent context) |
| Pino logger → stderr | Sanitized error text in `fatal`/`error` log frames |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-06-01 | Information disclosure | sanitize.ts SECRET_KEY_NAMES | mitigate | Extend canonical key list with camelCase variants; ≥ 50-row property-style matrix locks the contract |
| T-06-02 | Tampering | npm/pip/cargo installs | n/a | No new package installs in this plan; package legitimacy gate not required |
</threat_model>

<verification>
1. `npm run test -- src/infrastructure/observability/sanitize.test.ts` exits 0 with all v1.0 + new SECH-01 assertions passing (≥ 50 SECH-01 matrix rows + 7 new membership pins + unchanged PATTERNS-length pin).
2. `npm run test` exits 0 across the full suite (no other test depends on SECRET_KEY_NAMES.length staying at 11 — verified at plan-write time; if a regression surfaces, fix it in the same commit).
3. `npm run lint` exits 0.
4. `bash scripts/ci-grep-gates.sh` exits 0 (no new lint violations introduced).
5. Manual spot-check: `node -e "require('./dist/infrastructure/observability/sanitize.cjs')"` (if a dist exists) or `node --experimental-vm-modules -e "import('./src/infrastructure/observability/sanitize.ts').then(m => console.log(m.SECRET_KEY_NAMES))"` shows the extended array. (Optional — the test surface already proves this.)
</verification>

<success_criteria>
- `SECRET_KEY_NAMES` includes 7 camelCase entries on top of the 11 v1.0 entries (total ≥ 18).
- A property-style fixture matrix with ≥ 50 rows exercises every (key × shape) combination and exits 0.
- All v1.0 sanitize tests pass unchanged (no regression to snake_case behavior).
- PATTERNS array length is unchanged (still 7) — Task 1 modifies the data table, not the regex set.
- `bash scripts/ci-grep-gates.sh && npm run lint && npm run test` exits 0 end-to-end.
- Phase 6 success criterion #1 advances toward "≥ 50 token-key shapes covered" (this PR delivers the floor; Sub-PR B's doctor/init/Pino fold-ins add the error-path fixtures that complete the criterion).
</success_criteria>

<pr>
## Target

- **Branch:** `feat/sech-01-sanitizer-camelcase`
- **PR title:** `fix(sanitizer): cover camelCase token keys (#78)`
- **Base:** `main`
- **Closes:** #78
- **Depends on:** none (independent — first sub-PR in Phase 6)

## Template Section 2 (For Agents) hints

- **ADR brushed:** ADR-0001 (MCP stdout purity) — sanitize() output continues to flow only to stderr / serverError() payloads; no new stdout call sites added. ADR-0006 (fixture-only tests) — matrix is declarative, deterministic, offline.
- **What was attempted:** extending SECRET_KEY_NAMES with 7 camelCase entries; rebuilding PATTERNS via the existing `SECRET_KEY_ALT = SECRET_KEY_NAMES.join('|')` aggregation; adding a ≥ 50-row table-driven matrix.
- **What was ruled out:** (a) adding a new pattern rule for camelCase — unnecessary; the MR-11 design makes the existing alternation extension free. (b) Replacing the literal array with a generated list (e.g., from a JSON file) — adds indirection for no value. (c) Adding fuzz-style randomized inputs — sprawl risk per PITFALLS.md "Sanitize property-test sprawl"; kept declarative.
- **What reviewers should watch for:**
  - The PATTERNS length pin (`>= 7`) still holds — adding keys must not add patterns.
  - No snake_case entry was removed or reordered.
  - The matrix is driven by `test.each` (one assertion per row), not a single test with a for-loop (which would mask row-level failures).
  - No new dependency added.
</pr>

<estimated_effort>small</estimated_effort>

<output>
Create `.planning/phases/06-secret-hygiene-input-validation/06-01-SUMMARY.md` documenting: final SECRET_KEY_NAMES length, final MATRIX row count, any pattern that surprised the matrix (e.g., a camelCase key that needed a regex tweak — should be NONE, surface as deviation if present), and confirmation that `npm run test && npm run lint && bash scripts/ci-grep-gates.sh` exited 0 end-to-end.
</output>
</content>
