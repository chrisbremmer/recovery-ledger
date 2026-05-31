---
phase: 03-data-model-db-layer-sync-loop
plan: 01
type: execute
wave: 0
depends_on: []
files_modified:
  - package.json
  - package-lock.json
  - drizzle.config.ts
  - src/infrastructure/config/paths.ts
  - src/infrastructure/config/paths.test.ts
  - src/infrastructure/whoop/errors.ts
  - src/infrastructure/whoop/errors.test.ts
  - scripts/ci-grep-gates.sh
  - tests/fixtures/whoop/.gitkeep
autonomous: true
requirements: [DATA-01, DATA-04, SYNC-02]
tags: [drizzle, sqlite, whoop, ci, infrastructure]
user_setup: []

must_haves:
  truths:
    - "package.json declares better-sqlite3@^12.9.0, drizzle-orm@^0.45.2, @date-fns/tz@^1, drizzle-kit@^0.31.10, @types/better-sqlite3@^7"
    - "drizzle.config.ts at repo root points drizzle-kit at src/infrastructure/db/schema.ts + src/infrastructure/db/migrations"
    - "ResolvedPaths exposes dbFile, dbWalFile, dbShmFile, backupsDir resolved under configDir"
    - "src/infrastructure/whoop/errors.ts exports WhoopApiError class + WHOOP_API_ERROR_KINDS tuple of exactly 6 kinds + isWhoopApiError guard, sibling of FROZEN AuthError"
    - "scripts/ci-grep-gates.sh enforces Gate F (no fetch( outside client.ts + token-store.ts + oauth.ts) and Gate G (no drizzle-orm/* import outside src/infrastructure/db/)"
    - "bash scripts/ci-grep-gates.sh runs Gates A-G in order; final 'All grep gates passed.' line preserved"
    - "AuthError union remains FROZEN at 6 kinds (Plan 02-01 contract preserved; D-22 / D-34 attestation)"
    - "ADR-0001: no console.* / process.stdout.write in any new file under src/infrastructure/whoop/"
    - "ADR-0006: tests/fixtures/whoop/ directory scaffolded (placeholder commit only; real fixtures land Wave 2)"
    - "D-27: no new config.json keys this phase — semaphore size (4), rate-limit throttle threshold (<10 remaining), retry caps, and page-size pins (25) all land as hard-coded constants at the top of client.ts / rate-limit.ts / pagination.ts; ConfigSchema is NOT extended; V2-05 + V2-10 own the make-tunable-via-config deferred work"
  artifacts:
    - path: "drizzle.config.ts"
      provides: "drizzle-kit generate config (sqlite dialect)"
      contains: "schema: './src/infrastructure/db/schema.ts'"
    - path: "src/infrastructure/whoop/errors.ts"
      provides: "AuthError (FROZEN) + WhoopApiError discriminated unions"
      contains: "WHOOP_API_ERROR_KINDS"
    - path: "scripts/ci-grep-gates.sh"
      provides: "Gates A-G grep enforcement"
      contains: "Gate F"
    - path: "src/infrastructure/config/paths.ts"
      provides: "Extended ResolvedPaths with DB-layer paths"
      contains: "dbFile"
  key_links:
    - from: "scripts/ci-grep-gates.sh"
      to: "src/infrastructure/whoop/{client,token-store,oauth}.ts allowlist"
      via: "grep -Ev allowlist lines"
      pattern: "Gate F"
    - from: "scripts/ci-grep-gates.sh"
      to: "src/infrastructure/db/ exclusion"
      via: "grep -Ev directory prefix"
      pattern: "Gate G"
---

<objective>
Wave-0 infrastructure precondition for Phase 3. Land the five new packages (3 prod + 2 dev), extend `ResolvedPaths` with DB-layer paths, add `WhoopApiError` as a sibling of the FROZEN `AuthError` union, extend `scripts/ci-grep-gates.sh` with Gate F + Gate G, and scaffold the `tests/fixtures/whoop/` directory so later waves don't race the same `package.json`.

Purpose: Subsequent waves depend on packages being installed, paths being resolved, error types being declared, and CI gates being in place. The new gates are deliberately green-on-empty — they catch drift the moment Wave 2 code lands.

Output: 9 files modified/created; `npm run lint` clean; `npm run test` green (baseline preserved through Task 1; Task 2 adds ~12 new tests for the path + WhoopApiError extensions); `bash scripts/ci-grep-gates.sh` green; `npx drizzle-kit --help` exits 0.
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
@.planning/phases/03-data-model-db-layer-sync-loop/03-CONTEXT.md
@.planning/phases/03-data-model-db-layer-sync-loop/03-RESEARCH.md
@.planning/phases/03-data-model-db-layer-sync-loop/03-PATTERNS.md
@.planning/research/STACK.md
@.planning/research/ARCHITECTURE.md
@CLAUDE.md
@agent_docs/decisions/0001-mcp-stdout-purity.md
@agent_docs/decisions/0006-fixture-only-tests.md
@agent_docs/decisions/0007-whoop-read-only.md
@agent_docs/conventions.md
@src/infrastructure/whoop/errors.ts
@src/infrastructure/config/paths.ts
@scripts/ci-grep-gates.sh
@package.json

<interfaces>
<!-- Key contracts the executor must preserve. Extracted from the existing code. -->

From src/infrastructure/whoop/errors.ts (FROZEN — DO NOT MUTATE):
  export const AUTH_ERROR_KINDS = [
    'auth_missing', 'auth_expired', 'auth_state_mismatch',
    'auth_timeout', 'auth_port_in_use', 'refresh_failed',
  ] as const;
  export type AuthErrorKind = (typeof AUTH_ERROR_KINDS)[number];
  export interface AuthErrorInit { kind: AuthErrorKind; detail?: string; cause?: unknown; }
  export class AuthError extends Error { readonly kind: AuthErrorKind; readonly detail?: string; ... }
  export function isAuthError(err: unknown): err is AuthError
  export function formatAuthError(err: AuthError): string

From src/infrastructure/config/paths.ts (EXTEND only — do not remove fields):
  export interface ResolvedPaths {
    configDir: string;
    configFile: string;
    tokensFile: string;
    tokensLockFile: string;
    storageModeFile: string;
  }
  export function resolvePaths(env: PathsEnv): ResolvedPaths
  export const paths: ResolvedPaths   // lazy Proxy

From scripts/ci-grep-gates.sh (EXTEND only — Gates A-E must remain unchanged):
  Existing: Gate A (banned tone), Gate B (console.* outside cli/tests), Gate C (process.stdout.write outside cli/commands/**), Gate D (server.registerTool outside register.ts), Gate E (oauth/oauth2/token outside token-store.ts).
  Final line: `echo "All grep gates passed."` then `exit 0`.

New target (Phase 3) — Gate F + Gate G land green-on-empty because src/ has no fetch( and no drizzle-orm/* imports outside token-store.ts/oauth.ts (already allowlisted) yet.
</interfaces>
</context>

<tasks>

<task type="auto">
  <name>Task 1: Install Phase 3 deps + scaffold drizzle.config.ts + fixtures dir</name>
  <files>package.json, package-lock.json, drizzle.config.ts, tests/fixtures/whoop/.gitkeep</files>
  <read_first>
    - package.json (current dependencies and scripts — verify nothing already declared)
    - .planning/STATE.md §Performance Metrics (read the latest Phase 2 post-close test-count baseline; record as `baseline_count` for the acceptance criterion below)
    - .planning/research/STACK.md §Core Technologies (verifies pinned versions: better-sqlite3@^12.9.0, drizzle-orm@^0.45.2, drizzle-kit@^0.31.10, @date-fns/tz@^1, @types/better-sqlite3@^7)
    - .planning/phases/03-data-model-db-layer-sync-loop/03-RESEARCH.md §Standard Stack lines 100-134 (installation block + version verification)
    - .planning/phases/03-data-model-db-layer-sync-loop/03-PATTERNS.md §H2 lines 1517-1537 (drizzle.config.ts shape)
    - .planning/phases/03-data-model-db-layer-sync-loop/03-CONTEXT.md decisions D-01 + D-06 + D-07 (schema scope + hand-rolled migrator + backups dir)
  </read_first>
  <action>
    Before any other work in this task, read STATE.md `## Performance Metrics` and record the Phase 2 post-close test-count baseline (the most recent green `npm run test` count). Carry that number forward as `baseline_count` — both this task's acceptance criterion and Task 2's delta assertion are expressed relative to it.

    Run `npm install better-sqlite3@^12.9.0 drizzle-orm@^0.45.2 @date-fns/tz@^1` (prod deps) and `npm install -D drizzle-kit@^0.31.10 @types/better-sqlite3@^7` (dev deps). Verify each lands in package.json with the pinned major; do not bump majors.

    Create `drizzle.config.ts` at repo root using `defineConfig` from `drizzle-kit`. Set `schema: './src/infrastructure/db/schema.ts'`, `out: './src/infrastructure/db/migrations'`, `dialect: 'sqlite'`, `verbose: true`, `strict: true`. This config is read by `drizzle-kit generate` in Wave 1 Plan 03-02; do NOT run `drizzle-kit generate` here (no schema.ts yet).

    Create `tests/fixtures/whoop/.gitkeep` (empty file). The real per-resource fixtures land in Wave 2 Plan 03-07; the placeholder commits the directory now per ADR-0006 + conventions.md §Testing.

    Verify `npx drizzle-kit --help` exits 0 (confirms drizzle-kit installed and runs on Node 22). If `npm install` fails on `better-sqlite3` prebuilt binary, run `npm rebuild better-sqlite3` per Pitfall 20.
  </action>
  <verify>
    <automated>npm ls better-sqlite3 drizzle-orm drizzle-kit @date-fns/tz @types/better-sqlite3 --depth=0 2>&1 | grep -E "(better-sqlite3@12|drizzle-orm@0\.45|drizzle-kit@0\.31|@date-fns/tz@1|@types/better-sqlite3@7)"</automated>
  </verify>
  <acceptance_criteria>
    - `package.json` "dependencies" includes `better-sqlite3` matching `^12.9.0`, `drizzle-orm` matching `^0.45.2`, `@date-fns/tz` matching `^1`
    - `package.json` "devDependencies" includes `drizzle-kit` matching `^0.31.10`, `@types/better-sqlite3` matching `^7`
    - `drizzle.config.ts` exists at repo root, exports the default `defineConfig({ schema, out, dialect: 'sqlite', verbose: true, strict: true })` shape — verify with `grep -E "dialect:.*sqlite" drizzle.config.ts`
    - `tests/fixtures/whoop/.gitkeep` exists
    - `npx drizzle-kit --help` exits 0 within 5 seconds
    - `npm run test` exits 0; total test count matches the STATE.md `## Performance Metrics` Phase 2 post-close baseline recorded at task start (no new tests added in Task 1; nothing must regress). Capture the post-run total and reuse it as Task 2's `baseline_count`.
  </acceptance_criteria>
  <done>Five packages installed at pinned versions; `drizzle.config.ts` at repo root; fixtures placeholder committed; `drizzle-kit --help` runs.</done>
</task>

<task type="auto">
  <name>Task 2: Extend ResolvedPaths with DB-layer paths + add WhoopApiError union</name>
  <files>src/infrastructure/config/paths.ts, src/infrastructure/config/paths.test.ts, src/infrastructure/whoop/errors.ts, src/infrastructure/whoop/errors.test.ts</files>
  <read_first>
    - src/infrastructure/config/paths.ts (existing ResolvedPaths interface lines 26-31 + resolvePaths lines 45-58 — Phase 2 added tokensFile/tokensLockFile/storageModeFile; mirror that addition pattern)
    - src/infrastructure/config/paths.test.ts (existing assertion shape — extend with parallel cases for new fields)
    - src/infrastructure/whoop/errors.ts (FROZEN AuthError — read lines 29-95 to see the closed-tuple discriminated-union pattern; do NOT mutate AUTH_ERROR_KINDS)
    - src/infrastructure/whoop/errors.test.ts (existing 11+ test cases for AuthError — mirror shape for WhoopApiError)
    - .planning/phases/03-data-model-db-layer-sync-loop/03-PATTERNS.md §B6 lines 671-761 (WhoopApiError code verbatim) and §S1 lines 1541-1582 (discriminated-union pattern)
    - .planning/phases/03-data-model-db-layer-sync-loop/03-CONTEXT.md decisions D-22 (WhoopApiError = 6 kinds) + D-34 (sanitize.ts/register.ts UNMODIFIED, AuthError FROZEN)
    - agent_docs/decisions/0001-mcp-stdout-purity.md (no console.*; new file extension preserves Pino → stderr discipline)
  </read_first>
  <action>
    Extend `src/infrastructure/config/paths.ts`:
      - Add to `ResolvedPaths`: `dbFile: string`, `dbWalFile: string`, `dbShmFile: string`, `backupsDir: string`.
      - In `resolvePaths(env)`: add `dbFile: join(configDir, 'db.sqlite')`, `dbWalFile: join(configDir, 'db.sqlite-wal')`, `dbShmFile: join(configDir, 'db.sqlite-shm')`, `backupsDir: join(configDir, 'backups')`.
      - Do NOT add `migrationsDir` — it is resolved at runtime from `import.meta.url` inside `src/infrastructure/db/migrate.ts` (Wave 2 Plan 03-05) per 03-PATTERNS.md §F1 lines 1213-1221.
      - Do NOT remove any existing field. The Proxy at lines 87-93 remains unchanged.

    Extend `src/infrastructure/config/paths.test.ts`:
      - Add assertions that `resolvePaths({HOME: '/tmp/test'})` returns `dbFile === '/tmp/test/.recovery-ledger/db.sqlite'`, `dbWalFile === '/tmp/test/.recovery-ledger/db.sqlite-wal'`, `dbShmFile === '/tmp/test/.recovery-ledger/db.sqlite-shm'`, `backupsDir === '/tmp/test/.recovery-ledger/backups'`.
      - Add a parallel `RECOVERY_LEDGER_HOME` override case for the new fields.

    Extend `src/infrastructure/whoop/errors.ts` per D-22:
      - Add `WHOOP_API_ERROR_KINDS` as a `readonly` tuple of exactly: `'unauthorized'`, `'rate_limited'`, `'network'`, `'validation'`, `'server'`, `'unknown'`.
      - Add `WhoopApiErrorKind` type derived from the tuple.
      - Add `WHOOP_API_ERROR_KINDS_SET: ReadonlySet<string>` constant.
      - Add `WhoopApiErrorInit` interface mirroring `AuthErrorInit`.
      - Add `WhoopApiError` class extending `Error`, mirroring AuthError shape exactly (readonly `kind`, optional readonly `detail`, `name = 'WhoopApiError'`, cause via second `Error()` arg).
      - Add `isWhoopApiError(err)` duck-type guard mirroring `isAuthError` (uses `name === 'WhoopApiError'` and the new SET).
      - Add `formatWhoopApiError(err): string` with one arm per kind, returning short remediation strings (e.g., `'WHOOP returned 401 unauthorized — run `recovery-ledger auth`'`, `'WHOOP rate-limited (429) — sync will retry'`, etc.). Use exhaustive switch so adding a 7th kind is a compile error.
      - AUTH_ERROR_KINDS, AuthError class, isAuthError, formatAuthError — VERBATIM unchanged. Verify with `git diff` returning only additions below line 130, none above.

    Extend `src/infrastructure/whoop/errors.test.ts`:
      - Add a describe block `'WhoopApiError'` mirroring the existing `'AuthError'` shape: constructor stores `kind` + optional `detail` + cause chain via `Error.cause`; `name === 'WhoopApiError'`; `isWhoopApiError` returns true for instances and duck-typed objects, false for `AuthError` instances and plain objects; `formatWhoopApiError` returns a non-empty string for each of the 6 kinds.
      - Add a test asserting `WHOOP_API_ERROR_KINDS.length === 6` and the exact 6 kind strings (lock the tuple shape).
      - Add a test asserting `AUTH_ERROR_KINDS.length === 6` to lock the FROZEN AuthError contract from regressing.

    Count `N_new_tests` = the number of new test cases added in this task across the two test files (path-extension assertions + WhoopApiError describe block + length-locks). This count is consumed by the test-delta acceptance criterion below.

    All new file-level docs use the "console calls" / "direct stdout writes" phrasing per the learnings entry from Phase 2 (Plan 02-01 / 02-02 / 02-04 / 02-06 deviations) — do NOT use the literal `console.*` substring in doc comments.
  </action>
  <verify>
    <automated>npm run test -- src/infrastructure/config/paths.test.ts src/infrastructure/whoop/errors.test.ts</automated>
  </verify>
  <acceptance_criteria>
    - `grep -cE "^\s+dbFile:" src/infrastructure/config/paths.ts` returns 2 (one in interface, one in resolvePaths return)
    - `grep -c "WHOOP_API_ERROR_KINDS" src/infrastructure/whoop/errors.ts` returns at least 3 (declaration + type alias + SET + usage)
    - `git diff --unified=0 src/infrastructure/whoop/errors.ts | grep -E "^-\s+'(auth_missing|auth_expired|auth_state_mismatch|auth_timeout|auth_port_in_use|refresh_failed)'"` returns 0 lines (AuthError kinds unchanged — strictly additive diff)
    - `grep -v '^\s*//' src/infrastructure/whoop/errors.ts | grep -v '^\s*\*' | grep -c "console\." ` returns 0 (no literal console.* in file)
    - `npm run test -- src/infrastructure/config/paths.test.ts src/infrastructure/whoop/errors.test.ts` shows ≥ 4 new path assertions and ≥ 8 new WhoopApiError assertions, all passing
    - `npm run test` total count equals `baseline_count + N_new_tests` where `baseline_count` is the Task 1 captured baseline (STATE.md Phase 2 post-close metric) and `N_new_tests` is the count of new test cases added in this task. Document both numbers in the plan SUMMARY for traceability.
    - `npm run lint` exits 0
  </acceptance_criteria>
  <done>ResolvedPaths gains 4 DB-layer fields; errors.ts gains the WhoopApiError sibling union (6 kinds + class + guard + formatter); AuthError 6-kind tuple unchanged; all tests pass.</done>
</task>

<task type="auto">
  <name>Task 3: Add Gate F + Gate G to scripts/ci-grep-gates.sh + lock attestation tests</name>
  <files>scripts/ci-grep-gates.sh</files>
  <read_first>
    - scripts/ci-grep-gates.sh (full — read existing Gate A through Gate E; the new gates MUST mirror Gate E's structure lines 180-213 verbatim including the `/tmp/gate-X.$$` temp-file pattern and `grep -Ev '\.test\.ts:'` exclusion)
    - .planning/phases/03-data-model-db-layer-sync-loop/03-PATTERNS.md §H1 lines 1431-1515 (Gate F + Gate G code verbatim)
    - .planning/phases/03-data-model-db-layer-sync-loop/03-CONTEXT.md decisions D-17/D-18 (callWithAuth in client.ts exactly once) and D-28 (no drizzle-orm/* in domain or services)
    - .planning/research/ARCHITECTURE.md Anti-Pattern 3 (lines 864-868) + Anti-Pattern 7 (lines 888-892)
    - agent_docs/decisions/0002-single-flight-oauth-refresh.md §Enforcement (Gate F preserves the chokepoint by allowlisting client.ts as the third file)
    - agent_docs/decisions/0007-whoop-read-only.md (Gate F enforces single fetch( boundary)
  </read_first>
  <action>
    Append Gate F and Gate G to `scripts/ci-grep-gates.sh` after Gate E (line 213, just before `echo "All grep gates passed."`).

    Gate F: forbid `fetch(` outside the three permitted WHOOP files. The regex is `'\bfetch\s*\('`. Allowlist via per-line `grep -Ev` exactly three files: `src/infrastructure/whoop/client.ts`, `src/infrastructure/whoop/token-store.ts`, `src/infrastructure/whoop/oauth.ts`. Exclude `*.test.ts` (mirrors Gate E rationale). Write violations to `/tmp/gate-f.$$`; if non-empty, emit `::error::Gate F — fetch( outside src/infrastructure/whoop/{client,token-store,oauth}.ts:` then cat and exit 1; always rm the temp file.

    Gate G: forbid `drizzle-orm/*` imports outside `src/infrastructure/db/`. The regex is `"from\s+['\"]drizzle-orm"`. Allowlist via per-line `grep -Ev '^src/infrastructure/db/'`. Exclude `*.test.ts`. Use `/tmp/gate-g.$$`; emit `::error::Gate G — drizzle-orm/* imported outside src/infrastructure/db/:` on violation.

    Both gates use the `"$GREP"` variable (preserves the BSD-vs-GNU portability convention already in the script). The final `echo "All grep gates passed."` + `exit 0` lines stay at the end of the script.

    At this Wave-0 moment, both gates pass green-on-empty: there is no `fetch(` outside the existing allowlisted files (token-store.ts + oauth.ts), and there are zero `drizzle-orm/*` imports anywhere yet. The gates' value lands the moment Wave 2 Plan 03-06 writes `src/infrastructure/whoop/client.ts` with the third `fetch(` and Wave 1 Plan 03-02 writes `src/infrastructure/db/schema.ts` with the first `drizzle-orm/sqlite-core` import.
  </action>
  <verify>
    <automated>bash scripts/ci-grep-gates.sh 2>&1 | tail -5</automated>
  </verify>
  <acceptance_criteria>
    - `grep -c "^# Gate F" scripts/ci-grep-gates.sh` returns 1
    - `grep -c "^# Gate G" scripts/ci-grep-gates.sh` returns 1
    - `grep -c "FETCH_RE=" scripts/ci-grep-gates.sh` returns 1
    - `grep -c "DRIZZLE_IMPORT_RE=" scripts/ci-grep-gates.sh` returns 1
    - `grep -c "src/infrastructure/whoop/client\\\\.ts" scripts/ci-grep-gates.sh` returns at least 1 (Gate F allowlist line)
    - `bash scripts/ci-grep-gates.sh` exits 0 and prints `All grep gates passed.` as the final line
    - Re-run does not modify Gates A-E: `git diff scripts/ci-grep-gates.sh` shows only additions in the 180-213 range (after Gate E, before final echo)
    - Negative-test: temporarily `printf 'fetch(\\n' > /tmp/_probe.ts && cp /tmp/_probe.ts src/_gate_probe.ts && bash scripts/ci-grep-gates.sh` exits 1 with `Gate F` in stderr; remove the probe file. (Optional smoke; do not leave probe file committed.)
  </acceptance_criteria>
  <done>Gates F + G appended after Gate E; final echo preserved; `bash scripts/ci-grep-gates.sh` exits 0 with all 7 gates green.</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| developer machine → package registry (npm) | Five new packages installed; relies on package-lock integrity + STACK.md pinning |
| CI (Gates F + G) → src/ tree | Static-text guardrails; first line of defense against ADR-0001 / ADR-0002 / ADR-0007 / Anti-Pattern 3 drift |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-03.01-SC | Tampering | npm installs of better-sqlite3, drizzle-orm, drizzle-kit, @date-fns/tz, @types/better-sqlite3 | accept | All 5 packages were package-legitimacy-audited in 03-RESEARCH.md §Package Legitimacy Audit (slopcheck unavailable; pinned by STACK.md researched 2026-05-11 against live registry; ecosystem-major dependencies with documented prebuilt binaries). Disposition matches Plan 02-01's Wave-0 pattern. |
| T-03.01-01 | Tampering | scripts/ci-grep-gates.sh Gate F regex | mitigate | Regex `\bfetch\s*\(` is anchored with word boundary; allowlist is per-line `grep -Ev` against three exact file prefixes (no glob wildcards that could be bypassed). Test-file exclusion mirrors Gate E precedent. |
| T-03.01-02 | Tampering | scripts/ci-grep-gates.sh Gate G regex | mitigate | Regex `from\s+['\"]drizzle-orm` matches import-from-statements only (not bare identifiers); directory-prefix exclude is anchored at `^src/infrastructure/db/` so a sibling directory cannot match by substring. |
| T-03.01-03 | Information disclosure | WhoopApiError instances flowing through MCP error path | mitigate | D-34 attestation: src/mcp/sanitize.ts UNMODIFIED. Phase 1 SECRET_KEY_NAMES + 4 D-07 patterns + Plan 02-07 fixtures already cover Bearer / JWT / code= / client_secret / Authorization. WhoopApiError shape is named-field + cause chain — identical to AuthError, which has been sanitizer-covered since Phase 2. Verified later in Plan 03-11 partial-failure integration test. |
| T-03.01-04 | Elevation of privilege | New ResolvedPaths fields point at `~/.recovery-ledger/db.sqlite` | accept | Same dir as tokens.json (chmod 600 via tokenStore). Migrator (Plan 03-05) sets backup chmod 600 per D-07. No new env-var precedence change here; D-27 (no new config.json keys). |
</threat_model>

<verification>
- `npm run test` → baseline_count after Task 1; baseline_count + N_new_tests after Task 2 (Task 2 adds ~12 path + WhoopApiError extensions; Task 2 acceptance locks the exact delta)
- `npm run lint` → 0 errors
- `bash scripts/ci-grep-gates.sh` → all 7 gates green; final `All grep gates passed.` printed
- `npx drizzle-kit --help` → exits 0 within 5s (proves drizzle-kit is installed and Node-22 compatible)
- `git diff scripts/ci-grep-gates.sh` → only additions; Gates A-E unchanged
- `git diff src/infrastructure/whoop/errors.ts` → only additions below the AuthError block; AUTH_ERROR_KINDS / AuthError / isAuthError / formatAuthError byte-identical
</verification>

<success_criteria>
- All 5 packages installed at pinned versions per STACK.md
- `drizzle.config.ts` at repo root readable by `drizzle-kit generate` (Wave 1 will exercise this)
- `ResolvedPaths` gains `dbFile`, `dbWalFile`, `dbShmFile`, `backupsDir` and `resolvePaths()` returns them
- `WhoopApiError` declared as a sibling discriminated union of 6 kinds; `AuthError` FROZEN at 6 kinds (D-22 attestation)
- Gate F + Gate G appended to `scripts/ci-grep-gates.sh`; all 7 gates green
- `npm run lint` clean; full test suite green; `bash scripts/ci-grep-gates.sh` exits 0
- D-34 attestation preserved: `git diff origin/main -- src/mcp/sanitize.ts src/mcp/register.ts` returns empty
</success_criteria>

<output>
Create `.planning/phases/03-data-model-db-layer-sync-loop/03-01-SUMMARY.md` when done.
</output>
