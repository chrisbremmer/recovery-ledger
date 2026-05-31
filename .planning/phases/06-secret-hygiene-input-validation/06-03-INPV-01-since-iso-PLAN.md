---
phase: 06-secret-hygiene-input-validation
plan: 03
type: execute
wave: 1
depends_on: []
files_modified:
  - src/cli/commands/sync.ts
  - src/cli/commands/sync.test.ts
  - src/infrastructure/db/repositories/decisions.repo.ts
  - src/infrastructure/db/repositories/decisions.repo.test.ts
  - CHANGELOG.md
autonomous: true
requirements:
  - INPV-01
github_issue: "#80 (+ #95 findByPrefix min-length guard)"
target_branch: feat/inpv-01-since-iso
target_pr_title: "fix(sync,decisions): strict ISO --since via z.iso.date(), findByPrefix min-length guard (#80)"
tags:
  - input-validation
  - cli
  - zod
  - breaking-change
  - v1.1
must_haves:
  truths:
    - "`--since` validated by `z.iso.date()` ∪ `z.iso.datetime()` (Zod v4); rejects 03/01/2026, yesterday, 2026-13-01, 2026-02-30 with a clear error naming YYYY-MM-DD"
    - "`--since 2026-05-31` and `--since 2026-05-31T00:00:00Z` still succeed"
    - "`decisionsRepo.findByPrefix(prefix)` returns [] for prefix.length < 4 (no SQL issued; caller already arms on empty)"
    - "CHANGELOG.md at repo root with v1.1 entry naming #80 as the only user-visible breaking change"
  artifacts:
    - path: "src/cli/commands/sync.ts"
      provides: "parseSinceFlag swapped from `new Date + isNaN` to `z.iso.date()` ∪ `z.iso.datetime()`; error names YYYY-MM-DD"
      contains: "z.iso"
    - path: "src/cli/commands/sync.test.ts"
      provides: "INPV-01 negative (03/01/2026, yesterday, 2026-02-30, 2026-13-01) + positive (full-ISO datetime)"
      contains: "INPV-01"
    - path: "src/infrastructure/db/repositories/decisions.repo.ts"
      provides: "findByPrefix early-return [] when prefix.length < 4"
      contains: "prefix.length < 4"
    - path: "CHANGELOG.md"
      provides: "v1.1 entry — #80 breaking change + #78/#79 fixed"
      contains: "#80"
  key_links:
    - from: "src/cli/commands/sync.ts"
      to: "zod"
      via: "import { z } from 'zod' (zod@^4.4.3 already pinned; sync.ts does not currently import zod — verified at plan-write time)"
      pattern: "from\\s+['\"]zod['\"]"
---

<objective>
Close #80 (INPV-01) + the #95 `findByPrefix` min-length fold-in. `parseSinceFlag` (sync.ts:116–132) uses `new Date(raw) + Number.isNaN(parsed.getTime())` — coercive: silently accepts `03/01/2026` (locale-ambiguous) and other JS-`Date.parse`-friendly shapes. Phase 6 criterion #3 requires strict rejection of `2026-02-30`, `03/01/2026`, `yesterday` with a clear `YYYY-MM-DD` error; `2026-05-31` and `2026-05-31T00:00:00Z` still pass.

Swap to Zod v4 `z.iso.date()` ∪ `z.iso.datetime()` (regex-based, no Date.parse fallback — STACK.md verdict). `zod@^4.4.3` is already pinned. Fold in #95's `findByPrefix` length-4 floor (decisions.repo.ts:131–143). Create CHANGELOG.md (does not exist today — verified) with the v1.1 breaking-change note.

Output: 4 source edits + 1 new file. No new deps.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/PROJECT.md
@.planning/ROADMAP.md
@.planning/REQUIREMENTS.md
@.planning/phases/06-secret-hygiene-input-validation/06-CONTEXT.md
@.planning/research-v1.1/SUMMARY.md
@.planning/research-v1.1/STACK.md
@CLAUDE.md
@src/cli/commands/sync.ts
@src/cli/commands/sync.test.ts
@src/cli/index.ts
@src/infrastructure/db/repositories/decisions.repo.ts
@src/infrastructure/db/repositories/decisions.repo.test.ts

<interfaces>
// sync.ts:116–132 current (the bug):
function parseSinceFlag(raw: string | undefined): { ok: true } | { ok: false; message: string } {
  if (raw === undefined) return { ok: true };
  const parsed = new Date(raw);                // <-- coercive
  if (Number.isNaN(parsed.getTime())) { ... }
  if (parsed.getTime() > Date.now()) { ... }   // future-guard stays
  return { ok: true };
}

// decisions.repo.ts:131–143 current — no length floor.
// decision-update.ts:102–105 caller already arms on `matches.length === 0` — empty array preserves UX.

// Zod v4 (^4.4.3 pinned) API:
z.iso.date()                                  // strict YYYY-MM-DD regex
z.iso.datetime()                              // full ISO 8601 with time (Z + offsets)
z.union([z.iso.date(), z.iso.datetime()]).safeParse(raw)
</interfaces>
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: Replace parseSinceFlag with z.iso.date() ∪ z.iso.datetime()</name>
  <files>
    src/cli/commands/sync.ts
    src/cli/commands/sync.test.ts
  </files>
  <read_first>
    - src/cli/commands/sync.ts:116–132 (parseSinceFlag) + :156–163 (caller arm)
    - src/cli/commands/sync.test.ts:142 (Test 3 positive ISO), :183 (Test 6 negative), :213 (Test 6d future)
    - .planning/research-v1.1/STACK.md § #80 ("two-line fix ... use `z.iso.date()` from pinned zod@^4.4.3")
    - .planning/research-v1.1/PITFALLS.md #80 — do NOT silently coerce
    - Zod v4 docs (offline knowledge): `z.iso.date()` is regex-only — no Date.parse fallback; `z.iso.datetime()` accepts `Z` + `+HH:MM` offsets
  </read_first>
  <action>
    **Edits to sync.ts:**
    1. Add `import { z } from 'zod';` (sync.ts does NOT currently import zod — verified at plan-write time; preserve sort order).
    2. Module-scope const between imports and `SYNC_EXIT_CODES`:
       ```
       // INPV-01 (#80): strict YYYY-MM-DD or full ISO 8601 — no locale-dependent coercion
       const SinceSchema = z.union([z.iso.date(), z.iso.datetime()]);
       ```
    3. Rewrite `parseSinceFlag` body. Keep `if (raw === undefined) return { ok: true };`. Replace the `new Date + isNaN` block with:
       ```
       const parsed = SinceSchema.safeParse(raw);
       if (!parsed.success) {
         return { ok: false, message: `Invalid --since value: ${raw} — must be YYYY-MM-DD or full ISO 8601 (e.g., 2026-05-31 or 2026-05-31T00:00:00Z).` };
       }
       ```
       Keep the future-guard (was lines 125–130). It now builds `new Date(raw)` AFTER Zod proved the shape, so `getTime()` is safe. Update message to: `\`Invalid --since value: ${raw} is in the future (since must be <= now).\``.

    **Calendar-invalidity probe + defense:** Zod v4's `z.iso.date()` validates month 01–12 and day 01–31 via regex; regex cannot reject Feb 30 / Apr 31. Before writing tests, run:
    ```
    node -e "const {z} = require('zod'); console.log(z.iso.date().safeParse('2026-02-30'))"
    ```
    If Zod accepts (`success: true`), add a round-trip post-check after Zod success:
    ```
    if (raw.length === 10) {
      const d = new Date(raw);
      if (d.toISOString().slice(0, 10) !== raw) {
        return { ok: false, message: <same shape as above> };
      }
    }
    ```
    If Zod rejects, drop the post-check. Record outcome in SUMMARY. Test 6c locks final behavior.

    **Edits to sync.test.ts:**
    - Update Test 6 assertion to look for `'YYYY-MM-DD'` substring (robust to small wording shifts).
    - Add (mirroring the existing Test 6/6d mock pattern):
      - `Test 6a` — `{since: '03/01/2026'}` → invalid_input
      - `Test 6b` — `{since: 'yesterday'}` → invalid_input
      - `Test 6c` — `{since: '2026-02-30'}` → invalid_input
      - `Test 6e` — `{since: '2026-13-01'}` → invalid_input
      - `Test 6f` — `{since: '2026-05-31T00:00:00Z'}` succeeds (full-ISO positive)
    - Test 6d (future ISO) stays; bump assertion to confirm message includes the offending value.

    Comment discipline (conventions.md): ONE comment above SinceSchema. No per-test annotations.
  </action>
  <verify>
    <automated>npm run test -- src/cli/commands/sync.test.ts --reporter=basic 2>&1 | tee /tmp/inpv01.log && grep -E "INPV-01|Test 6[abcef]" /tmp/inpv01.log | head -10 && grep -c "z\.iso" src/cli/commands/sync.ts | grep -qE '^[1-9]' && npm run lint && echo OK</automated>
  </verify>
  <done>
    parseSinceFlag uses Zod v4 strict ISO; four reject cases exit non-zero with `YYYY-MM-DD` in the message; two positive cases pass; future-guard intact; full suite green.
  </done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: findByPrefix min-length guard — #95 fold-in</name>
  <files>
    src/infrastructure/db/repositories/decisions.repo.ts
    src/infrastructure/db/repositories/decisions.repo.test.ts
  </files>
  <read_first>
    - src/infrastructure/db/repositories/decisions.repo.ts:131–143 (findByPrefix body)
    - src/infrastructure/db/repositories/decisions.repo.test.ts § "decisions repo — findByPrefix (D-20 short-prefix lookup)" (line ~182)
    - src/cli/commands/decision-update.ts:102–105 (caller arms on `matches.length === 0` already — empty array preserves UX)
  </read_first>
  <action>
    Add early-return at top of findByPrefix body, BEFORE the LIKE-escape (so a 0-length input never reaches SQL):
    ```
    // #95: min-length guard — short prefixes match too many rows; caller (decision-update.ts) arms on [] for "no match".
    if (prefix.length < 4) return [];
    ```

    Behavior: `findByPrefix('')` / `findByPrefix('abc')` return `[]` without SQL; `findByPrefix('abcd')` (length ≥ 4) executes unchanged. Repo stays data-only — no thrown error. Caller's existing "no decision matched" UX is preserved.

    Tests added inside the existing findByPrefix describe block:
    - `it('#95 — rejects prefix.length < 4 with empty array (no SQL issued)')` — seed two rows, `findByPrefix('abc')` → `[]`.
    - `it('#95 — rejects empty prefix with empty array')` — `findByPrefix('')` → `[]`.
    - `it('#95 — prefix.length === 4 executes (boundary)')` — seed a row with id starting `ABCD`, assert it's returned.

    Do NOT change decision-update.ts — empty-array handling already exists there.
  </action>
  <verify>
    <automated>npm run test -- src/infrastructure/db/repositories/decisions.repo.test.ts --reporter=basic && grep -c "prefix\.length < 4" src/infrastructure/db/repositories/decisions.repo.ts | grep -q "^1$" && echo OK</automated>
  </verify>
  <done>
    findByPrefix early-returns `[]` for length < 4; three new tests pass; existing tests pass unchanged.
  </done>
</task>

<task type="auto" tdd="true">
  <name>Task 3: CHANGELOG.md — v1.1 entry calling out #80 as breaking change</name>
  <files>CHANGELOG.md</files>
  <read_first>
    - .planning/research-v1.1/PITFALLS.md "#80 user-visible breaking change"
    - .planning/ROADMAP.md § Phase 6 success criterion #4
    - `find . -name CHANGELOG* -not -path '*/node_modules/*' -not -path '*/.git/*'` returned empty at plan-write time — this file is NEW
  </read_first>
  <action>
    Create `CHANGELOG.md` at repo root using Keep-a-Changelog format (https://keepachangelog.com/en/1.1.0/). Structure:

    ```
    # Changelog

    All notable changes to this project will be documented in this file.

    The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
    and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

    ## [Unreleased] - v1.1

    ### Breaking Changes
    - **`recovery-ledger sync --since` now requires strict ISO 8601 (`YYYY-MM-DD` or full datetime).** Previously-accepted locale-dependent inputs (`03/01/2026`, `yesterday`) and calendar-invalid dates (`2026-02-30`) now exit non-zero with a clear error. Migration: use `YYYY-MM-DD` (e.g., `2026-05-31`) or full ISO 8601 with time. ([#80])

    ### Fixed
    - Sanitizer now redacts camelCase token keys in error output (`accessToken`, `refreshToken`, `clientSecret`, etc.). ([#78])
    - `recovery-ledger doctor` (CLI) now emits identically-sanitized error text to `whoop_doctor` (MCP) on failure. ([#79])

    [#78]: https://github.com/<owner>/recovery-ledger/issues/78
    [#79]: https://github.com/<owner>/recovery-ledger/issues/79
    [#80]: https://github.com/<owner>/recovery-ledger/issues/80
    ```

    Discover the repo owner via `git remote -v` at execute time. If the remote is configured, substitute the owner verbatim. If not, leave `<owner>` as a placeholder and note it in SUMMARY for PR-review resolution. No v1.0 backfill (out of scope; v1.0 shipped without one — verified).
  </action>
  <verify>
    <automated>test -f CHANGELOG.md && grep -c "#80\|#78\|#79" CHANGELOG.md | grep -qE '^[3-9]|^[1-9][0-9]+$' && grep -q "Breaking Changes" CHANGELOG.md && grep -q "YYYY-MM-DD" CHANGELOG.md && echo OK</automated>
  </verify>
  <done>
    CHANGELOG.md exists with v1.1 entry naming #80 as the breaking change + #78/#79 under Fixed; reference links resolved or `<owner>` placeholder noted in SUMMARY.
  </done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| CLI argv → parseSinceFlag → WHOOP API window | User-supplied `--since`; locale-coerced acceptance produces wrong-window sync silently |
| CLI argv → decisionsRepo.findByPrefix → SQL LIKE | User-supplied prefix; too-short prefix matches every decision — noisy UX foot-gun |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-06-09 | Tampering (input validation) | parseSinceFlag | mitigate | z.iso.date() ∪ z.iso.datetime() + calendar-invalidity round-trip defense; error names YYYY-MM-DD |
| T-06-10 | Denial of service (cheap) | findByPrefix on short prefix | mitigate | length-4 floor + early-return [] (no SQL) |
| T-06-11 | Tampering | npm/pip/cargo installs | n/a | No new installs; zod@^4.4.3 already on dep tree |
</threat_model>

<verification>
1. `npm run test -- src/cli/commands/sync.test.ts` exits 0; INPV-01 negatives + positives all pass.
2. `npm run test -- src/infrastructure/db/repositories/decisions.repo.test.ts` exits 0; three new tests pass.
3. `npm run test && npm run lint && bash scripts/ci-grep-gates.sh` exits 0 end-to-end.
4. Manual: `node dist/cli.mjs sync --since 03/01/2026` exits 1 with the new message; `--since 2026-05-31` passes date validation.
5. `grep -q "YYYY-MM-DD" CHANGELOG.md && grep -q "Breaking Changes" CHANGELOG.md` succeed.
</verification>

<success_criteria>
- Phase 6 criterion #3: `2026-02-30` / `03/01/2026` / `yesterday` reject with `YYYY-MM-DD` in error; `2026-05-31` / `2026-05-31T00:00:00Z` succeed.
- Phase 6 criterion #4: CHANGELOG names #80 as the only user-visible breaking change.
- findByPrefix UX foot-gun closed for prefix.length < 4.
- No new dependency.
- Full suite + lint + grep gates green.
</success_criteria>

<pr>
- **Branch:** `feat/inpv-01-since-iso`
- **PR title:** `fix(sync,decisions): strict ISO --since via z.iso.date(), findByPrefix min-length guard (#80)`
- **Base:** `main`
- **Closes:** #80 (+ #95 findByPrefix min-length)
- **Depends on:** none (independent — can ship parallel with Plan 06-01)

**Section 2 (For Agents) hints:**
- **ADR brushed:** none directly. Conventions.md § "Validation at boundaries only" — textbook Zod-parse at CLI boundary.
- **Attempted:** swap `new Date + isNaN` to `z.union([z.iso.date(), z.iso.datetime()]).safeParse(raw)`; calendar-invalidity round-trip defense (conditional on the `node -e` probe); error names YYYY-MM-DD + rejected value; tighten findByPrefix with length-4 floor; create CHANGELOG.md.
- **Ruled out:** (a) `date-fns/parseISO` — STACK.md verdict prefers Zod. (b) silent coercion with format-hinted fallback — PITFALLS.md rules this out. (c) throwing `DecisionPrefixTooShort` from the repo — repo stays data-only (conventions.md); caller already arms on empty. (d) v1.0 CHANGELOG backfill — out of scope.
- **Reviewers watch for:** calendar-invalidity probe outcome (SUMMARY records whether the round-trip defense was needed; Test 6c locks final behavior); error message contains BOTH the format AND the rejected value; Test 6 assertion was updated not deleted; `findByPrefix('abcd')` works (boundary — exactly 4 chars); CHANGELOG `<owner>` placeholder resolution.
</pr>

<estimated_effort>small</estimated_effort>

<output>
Create `.planning/phases/06-secret-hygiene-input-validation/06-03-SUMMARY.md` documenting: whether Zod v4's `z.iso.date()` natively rejects `2026-02-30` (probe outcome drives whether the round-trip defense was added), test-count delta in sync.test.ts + decisions.repo.test.ts, CHANGELOG.md `<owner>` placeholder status, and confirmation that `npm run test && npm run lint && bash scripts/ci-grep-gates.sh` exited 0.
</output>
</content>
