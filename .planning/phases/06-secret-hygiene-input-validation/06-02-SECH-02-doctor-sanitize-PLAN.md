---
phase: 06-secret-hygiene-input-validation
plan: 02
type: execute
wave: 2
depends_on:
  - 06-01
files_modified:
  - src/services/doctor/checks/whoop-roundtrip.ts
  - src/services/doctor/checks/whoop-roundtrip.test.ts
  - src/cli/commands/doctor.ts
  - src/cli/commands/init.ts
  - src/cli/commands/init.test.ts
  - src/infrastructure/whoop/token-store.ts
  - src/mcp/index.ts
  - src/infrastructure/observability/sanitize.test.ts
autonomous: true
requirements:
  - SECH-02
github_issue: "#79 (+ #95 init/Pino-fatal/token-store mkdir)"
target_branch: feat/sech-02-doctor-sanitize
target_pr_title: "fix(doctor,init,mcp,token-store): sanitize error paths + mkdir 0o700 (#79)"
tags:
  - sanitizer
  - doctor
  - secret-hygiene
  - v1.1
must_haves:
  truths:
    - "probeWhoopRoundtrip catch arm wraps inner err.message in sanitize() before returning DoctorCheck.detail"
    - "doctor.ts:86–104 outer catch wraps String(err) in sanitize() (parity with sync.ts/auth.ts/init.ts)"
    - "init.ts:111–117 outer catch wraps String(err) in sanitize() (parity with auth.ts/sync.ts)"
    - "token-store.ts:222,239,313 mkdir calls all pass `{ recursive: true, mode: 0o700 }` (parity with init.ts:102)"
    - "mcp/index.ts:64,70 logger.fatal `err` field receives sanitize(serializeError(err))"
    - "sanitize.test.ts gains ≥ 4 error-path fixtures for the new call sites + 1 idempotence lock"
  artifacts:
    - path: "src/services/doctor/checks/whoop-roundtrip.ts"
      provides: "sanitize() wrap on catch-arm DoctorCheck.detail"
      contains: "sanitize"
    - path: "src/cli/commands/doctor.ts"
      provides: "outer-catch String(err) → sanitize(String(err))"
      contains: "sanitize"
    - path: "src/cli/commands/init.ts"
      provides: "outer-catch String(err) → sanitize(String(err))"
      contains: "sanitize"
    - path: "src/infrastructure/whoop/token-store.ts"
      provides: "three mkdir sites pass { recursive: true, mode: 0o700 }"
      contains: "mode: 0o700"
    - path: "src/mcp/index.ts"
      provides: "logger.fatal err = sanitize(serializeError(err))"
      contains: "sanitize(serializeError"
  key_links:
    - from: "src/cli/commands/doctor.ts"
      to: "src/infrastructure/observability/sanitize.ts"
      via: "import { sanitize } from '../../infrastructure/observability/sanitize.js'"
      pattern: "from\\s+['\"].*observability/sanitize\\.js['\"]"
    - from: "src/cli/commands/init.ts"
      to: "src/infrastructure/observability/sanitize.ts"
      via: "import { sanitize } from '../../infrastructure/observability/sanitize.js'"
      pattern: "from\\s+['\"].*observability/sanitize\\.js['\"]"
    - from: "src/services/doctor/checks/whoop-roundtrip.ts"
      to: "src/infrastructure/observability/sanitize.ts"
      via: "import { sanitize } from '../../../infrastructure/observability/sanitize.js'"
      pattern: "from\\s+['\"].*observability/sanitize\\.js['\"]"
    - from: "src/mcp/index.ts"
      to: "src/infrastructure/observability/sanitize.ts"
      via: "extend existing line-21 import to include sanitize alongside serializeError"
      pattern: "sanitize\\s*\\("
---

<objective>
Close #79 (SECH-02) + four #95 fold-ins. Existing leak/permission sites:
- `whoop-roundtrip.ts:76–82` catch returns raw `err.message` in `DoctorCheck.detail`.
- `doctor.ts:86–104` outer catch routes raw `String(err)` to stdout (bypasses sanitize; sync.ts/auth.ts wrap it).
- `init.ts:111–117` outer catch has the same gap.
- `token-store.ts:222,239,313` mkdir sites miss `mode: 0o700` (init.ts:102 has it — MCP-driven first-write gets default umask).
- `mcp/index.ts:64,70` passes raw `serializeError(err)` to Pino fatal — no sanitize.

Collapse all five into one PR so CLI doctor and MCP `whoop_doctor` emit identically sanitized text on every failure. Load-bearing for Phase 6 criterion #2.

Output: 5 source edits, 3 test extensions, 0 new files, 0 new deps.
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
@agent_docs/decisions/0001-mcp-stdout-purity.md
@agent_docs/decisions/0002-single-flight-oauth-refresh.md
@CLAUDE.md
@src/infrastructure/observability/sanitize.ts
@src/cli/commands/doctor.ts
@src/cli/commands/init.ts
@src/cli/commands/sync.ts
@src/cli/commands/auth.ts
@src/services/doctor/checks/whoop-roundtrip.ts
@src/services/doctor/checks/whoop-roundtrip.test.ts
@src/infrastructure/whoop/token-store.ts
@src/mcp/index.ts

<interfaces>
// Existing surface:
export function sanitize(input: string): string;
export function serializeError(err: unknown): string;

// Positive precedents in repo:
// sync.ts:33,174,216  — cross-layer import + sanitize(String(err))
// auth.ts:36,145       — same pattern
// init.ts:102          — mkdir(..., { recursive: true, mode: 0o700 })

// Closing these sites:
// whoop-roundtrip.ts:80      detail: `roundtrip failed: ${err.message}`
// doctor.ts:95               const message = String(err);
// init.ts:115                `init failed: ${String(err)}\n`
// token-store.ts:222,239,313 mkdir(..., { recursive: true })   // mode missing
// mcp/index.ts:64,70         err: serializeError(err)           // sanitize missing
</interfaces>
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: Wrap sanitize() at the four doctor/init/MCP/probe call sites</name>
  <files>
    src/services/doctor/checks/whoop-roundtrip.ts
    src/cli/commands/doctor.ts
    src/cli/commands/init.ts
    src/mcp/index.ts
    src/services/doctor/checks/whoop-roundtrip.test.ts
    src/cli/commands/init.test.ts
    src/infrastructure/observability/sanitize.test.ts
  </files>
  <read_first>
    - src/services/doctor/checks/whoop-roundtrip.ts:14–19 (module comment claims "deliberately does NOT call sanitize() itself" — correct for MCP, wrong for CLI; rewrite); :76–82 (catch arm)
    - src/cli/commands/doctor.ts:86–104 (outer catch); lines 92–94 comment claims "CLI errors NOT routed through MCP sanitizer" — the SECH-02 bug; rewrite
    - src/cli/commands/init.ts:111–117 (outer catch)
    - src/cli/commands/sync.ts:33,172,216 and src/cli/commands/auth.ts:36,145 (positive precedents)
    - src/mcp/index.ts:21 (existing import, extend); :54–75 (two logger.fatal sites)
    - .planning/research-v1.1/PITFALLS.md "MCP stdout purity collision"
  </read_first>
  <action>
    **Edits:**

    1. **whoop-roundtrip.ts:** add `import { sanitize } from '../../../infrastructure/observability/sanitize.js';`. Catch arm becomes `detail: \`roundtrip failed: ${sanitize(err instanceof Error ? err.message : String(err))}\``. Rewrite the 14–19 module comment: probe sanitizes BECAUSE CLI doctor's outer-catch serializes this detail directly to stdout via renderDoctor/JSON.stringify; double-sanitize is idempotent (locked by the new test in step 5).

    2. **doctor.ts:** add `import { sanitize } from '../../infrastructure/observability/sanitize.js';`. Replace `const message = String(err);` with `const message = sanitize(String(err));`. Rewrite the 92–94 comment — drop the "NOT routed through the MCP sanitizer" claim.

    3. **init.ts:** add `import { sanitize } from '../../infrastructure/observability/sanitize.js';`. Replace `\`init failed: ${String(err)}\\n\`` with `\`init failed: ${sanitize(String(err))}\\n\``. Rewrite 112–114 comment to mirror auth.ts:138–144.

    4. **mcp/index.ts:** extend line-21 import: `import { sanitize, serializeError } from '../infrastructure/observability/sanitize.js';`. At lines 64 and 70, replace `err: serializeError(err)` with `err: sanitize(serializeError(err))`.

    5. **Tests added:**
       - `whoop-roundtrip.test.ts`: `it('SECH-02 — catch-arm detail string is sanitize()-wrapped (#79)')` — fetcher rejects with `Error('upstream 401: Authorization: Bearer leaked_token_xxxxxxxxxx')`; assert `status === 'fail'`, detail excludes `'leaked_token_xxxxxxxxxx'`, includes `'Bearer <redacted>'`.
       - `init.test.ts`: `test('I-11 SECH-02 — outer-catch sanitizes thrown error message (#79)')` — mock mkdir or writeConfigAtomic to throw with `'accessToken=secret_value_xyz'`; capture stdout; assert no `'secret_value_xyz'` AND contains `'<redacted>'`.
       - `sanitize.test.ts` idempotence lock — append in the existing `'sanitize patterns'` describe: `test('sanitize is idempotent — double-wrap matches single-wrap (SECH-02 defense)', () => { for (const c of ['Bearer abcdef1234567890', '{"accessToken":"sec"}', '?refresh_token=rt&x=1']) expect(sanitize(sanitize(c))).toBe(sanitize(c)); });`

    Comment discipline (conventions.md): only update where prose is now wrong. Single `// SECH-02 (#79)` annotation per file at the import site.

    **MCP stdout-purity check:** after editing mcp/index.ts confirm `grep -rEn 'process\.stdout' src/mcp/` returns empty. sanitize() returns a string; passing it to logger.fatal() keeps writes on stderr by construction.

    If a snapshot/exact-text test regressed because sanitize altered output shape, fix it in the SAME commit and surface in SUMMARY.
  </action>
  <verify>
    <automated>npm run test -- src/services/doctor/checks/whoop-roundtrip.test.ts src/cli/commands/init.test.ts src/infrastructure/observability/sanitize.test.ts --reporter=basic && npm run lint && bash scripts/ci-grep-gates.sh && grep -c "sanitize" src/cli/commands/doctor.ts src/cli/commands/init.ts src/services/doctor/checks/whoop-roundtrip.ts src/mcp/index.ts | grep -v ':0$' && echo OK</automated>
  </verify>
  <done>
    All four call sites import sanitize and wrap their error strings. Three new tests pass. Full suite green. `grep -rEn 'String\(err\)' src/cli/commands/{doctor,init}.ts | grep -v 'sanitize'` returns empty. `grep -rEn 'process\.stdout' src/mcp/` returns empty.
  </done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: Token-store mkdir 0o700 — three call sites (#95 fold-in)</name>
  <files>src/infrastructure/whoop/token-store.ts</files>
  <read_first>
    - src/infrastructure/whoop/token-store.ts:222 (public write), :239 (writeUnderLock), :313 (doRefresh)
    - src/cli/commands/init.ts:102 (reference: `mkdir(..., { recursive: true, mode: 0o700 })`)
    - ADR-0002 — none of these sites sit inside the lock window; metadata-only change
  </read_first>
  <action>
    Three line edits — change `mkdir(resolvedPaths.configDir, { recursive: true })` to `mkdir(resolvedPaths.configDir, { recursive: true, mode: 0o700 })` at lines 222, 239, 313. POSIX honors mode-on-creation (0o700 = drwx------); Windows silently ignores. mkdir-recursive does NOT chmod an existing dir — same semantics as init.ts:102; retroactive chmod is out of scope. `git diff` should show exactly 3 hunks.

    Add ONE comment above line 222: `// SECH-02 / #95: mkdir mode parity with init.ts:102 so MCP-driven config-dir creation matches CLI-driven`. No new tests — asserting mode on Linux CI is umask-fragile; the grep below is the verification.
  </action>
  <verify>
    <automated>grep -cE "mkdir\(resolvedPaths\.configDir,\s*\{\s*recursive:\s*true,\s*mode:\s*0o700\s*\}\)" src/infrastructure/whoop/token-store.ts | grep -q "^3$" && npm run test -- src/infrastructure/whoop/token-store.test.ts --reporter=basic && echo OK</automated>
  </verify>
  <done>
    Grep above returns exactly 3. Existing tokenStore tests pass unchanged.
  </done>
</task>

<task type="auto" tdd="true">
  <name>Task 3: sanitize.test.ts — error-path fixtures for the four new call sites</name>
  <files>src/infrastructure/observability/sanitize.test.ts</files>
  <read_first>
    - src/infrastructure/observability/sanitize.test.ts (existing F1–F7 fixture blocks shape these new ones)
    - Plan 06-01's SECH_01_MATRIX block (depends_on: 06-01 ensures it's already present in the file)
  </read_first>
  <action>
    Add a new `describe('SECH-02 error-path fixtures — doctor/init/MCP/token-store (#79)', …)` AFTER Plan 06-01's `'SECH-01 matrix'` block and BEFORE the Phase 4 tool-error fixtures, with ≥ 4 tests:

    - **F-SECH-02-01 whoop-roundtrip 401:** `new Error('outer', { cause: new Error('Authorization: Bearer leaked_token_xxxxxxxxxx') })` → `sanitize(serializeError(err))` strips it; contains `'Bearer <redacted>'`.
    - **F-SECH-02-02 init outer-catch:** `new Error("EACCES: permission denied, mkdir '/home/user/.recovery-ledger': accessToken=leaked")` → `sanitize(String(err))` strips `accessToken=leaked` to `accessToken=<redacted>` (synthetic — defense-in-depth).
    - **F-SECH-02-03 MCP fatal MigrationError:** `Object.assign(new Error('migrate failed'), { kind: 'migration_failed', backupPath: '/tmp/x', cause: new Error('schema drift: clientSecret=hunter2') })` → `sanitize(serializeError(err))` strips `hunter2`.
    - **F-SECH-02-04 token-store doRefresh body excerpt:** `new Error('UND_ERR_CONNECT_TIMEOUT — body: grant_type=refresh_token&refreshToken=rt_xyz&clientSecret=cs_xyz')` → strips both `rt_xyz` AND `cs_xyz`; non-secret `grant_type=refresh_token` literal survives. NOTE: `refreshToken`/`clientSecret` are camelCase — REQUIRES SECH-01 (Plan 06-01) landed first.

    Reuse the top-of-file `import { sanitize, serializeError } from './sanitize.js'`. One `expect()` per assertion so failures pinpoint the leak shape. Idempotence test from Task 1 lives in the `'sanitize patterns'` describe; do NOT duplicate here.
  </action>
  <verify>
    <automated>npm run test -- src/infrastructure/observability/sanitize.test.ts --reporter=basic 2>&1 | tee /tmp/sech02.log && grep -E "SECH-02 error-path|F-SECH-02-0[1-4]" /tmp/sech02.log | head -10 && echo OK</automated>
  </verify>
  <done>
    sanitize.test.ts includes the SECH-02 describe with ≥ 4 fixture tests, all passing. Combined SECH-01 matrix (06-01) + SECH-02 fixtures (here) exceed 50 assertions total.
  </done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| WHOOP HTTP → probeWhoopRoundtrip → DoctorCheck.detail → CLI stdout | Output reaches user terminal; pasted into bug reports/agent context |
| MCP bootstrap failure → logger.fatal → stderr | Captured by host (Claude Code, Cursor) into agent context |
| init.ts mkdir failure → outer catch → stdout | Reaches user terminal |
| token-store.ts mkdir(configDir) → filesystem | Permissions visible to other local users on shared dev/CI runners |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-06-03 | Information disclosure | whoop-roundtrip.ts catch | mitigate | Wrap err.message in sanitize() before DoctorCheck.detail |
| T-06-04 | Information disclosure | doctor.ts outer catch | mitigate | Wrap String(err) in sanitize() — parity with sync.ts/auth.ts |
| T-06-05 | Information disclosure | init.ts outer catch | mitigate | Wrap String(err) in sanitize() — parity with auth.ts/sync.ts |
| T-06-06 | Information disclosure | mcp/index.ts logger.fatal | mitigate | Wrap serializeError(err) in sanitize() before Pino |
| T-06-07 | Information disclosure (local) | token-store.ts mkdir | mitigate | `mode: 0o700` at three sites — parity with init.ts:102 |
| T-06-08 | Tampering | npm/pip/cargo installs | n/a | No new installs |
</threat_model>

<verification>
1. `npm run test` exits 0 (any regressed snapshot fixed in same commit + recorded in SUMMARY).
2. `npm run lint && bash scripts/ci-grep-gates.sh` exits 0.
3. `grep -rEn 'process\.stdout' src/mcp/` empty (ADR-0001 preserved).
4. `grep -rEn 'String\(err\)' src/cli/commands/{doctor,init,sync,auth}.ts | grep -v 'sanitize'` empty.
5. `grep -cE "mkdir\(resolvedPaths\.configDir.*mode:\s*0o700" src/infrastructure/whoop/token-store.ts` returns 3.
6. Manual: `node dist/cli.mjs doctor --offline --text` exits 0; a forced failure emits a sanitized message.
</verification>

<success_criteria>
- Phase 6 criterion #2: CLI `doctor` and MCP `whoop_doctor` emit identically-sanitized text on the same failure.
- Phase 6 criterion #1: ≥ 50 token-key shapes covered (06-01 matrix + 06-02 error-path fixtures).
- Three token-store mkdir sites pass `mode: 0o700`.
- Four sanitize call sites wired.
- Full suite + lint + grep gates green.
- No new dep, no new file.
</success_criteria>

<pr>
- **Branch:** `feat/sech-02-doctor-sanitize`
- **PR title:** `fix(doctor,init,mcp,token-store): sanitize error paths + mkdir 0o700 (#79)`
- **Base:** `main`
- **Closes:** #79 (+ #95 init outer-catch + token-store mkdir + Pino-fatal items)
- **Depends on:** Plan 06-01 (camelCase SECRET_KEY_NAMES) — F-SECH-02-04 asserts `refreshToken`/`clientSecret` redaction. Rebase this branch on merged 06-01.

**Section 2 (For Agents) hints:**
- **ADR brushed:** ADR-0001 (stdout purity preserved — sanitize() output stays on stderr via Pino); ADR-0002 (mkdir mode change is metadata-only, NOT inside the cross-process lock window); ADR-0006 (tests are deterministic + offline).
- **Attempted:** 5 sanitize wraps; `mode: 0o700` at 3 mkdir sites; ≥ 4 error-path fixtures + 1 idempotence lock.
- **Ruled out:** (a) moving sanitize.ts to `src/domain/` — that is ARCH-01, Phase 10; do NOT pre-empt. (b) retrying inside probeWhoopRoundtrip — out of scope. (c) retroactively chmod'ing existing config dirs — out of scope; #95 only asks for mode-on-creation parity. (d) per-call-site comments — single annotation per file.
- **Reviewers watch for:** idempotence claim (sanitize(sanitize(x)) === sanitize(x); locked by the new test); `grep -rEn 'process\.stdout' src/mcp/` stays empty; the two stale comments (doctor.ts:92–94 + whoop-roundtrip.ts:14–19) REWRITTEN not left in place; `mode: 0o700` is correct for POSIX, ignored on Windows; init.ts test must reach the OUTER catch — mock mkdir/writeConfigAtomic, not the readline/env-var paths (those hit the inner Zod arm).
</pr>

<estimated_effort>medium</estimated_effort>

<output>
Create `.planning/phases/06-secret-hygiene-input-validation/06-02-SUMMARY.md` documenting: total assertion delta in sanitize.test.ts (SECH-01 matrix + SECH-02 fixtures + idempotence), net LOC change across the 5 source files (should be ≤ ~30), and confirmation that `npm run test && npm run lint && bash scripts/ci-grep-gates.sh && grep -rEn 'process\.stdout' src/mcp/` all exited cleanly.
</output>
</content>
