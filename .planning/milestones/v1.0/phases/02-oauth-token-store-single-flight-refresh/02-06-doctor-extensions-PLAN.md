---
phase: 02-oauth-token-store-single-flight-refresh
plan: 06
type: execute
wave: 5
depends_on: ['02-02', '02-05']
files_modified:
  - src/services/doctor/checks/check-names.ts
  - src/services/doctor/checks/auth.ts
  - src/services/doctor/checks/auth.test.ts
  - src/services/doctor/checks/token-freshness.ts
  - src/services/doctor/checks/token-freshness.test.ts
  - src/services/doctor/index.ts
  - src/services/doctor/index.test.ts
  - scripts/ci-grep-gates.sh
autonomous: true
requirements:
  - AUTH-03
user_setup: []

must_haves:
  truths:
    - "D-21: Phase 2 adds two doctor checks — `auth` (reports `auth: keychain | file | missing`) and `token-freshness` (compares expires_at to now; pass/warn/fail)."
    - "doctor check `auth` reports `pass` with detail `auth: keychain` when storage-mode='keychain' and tokens are readable; `pass` with detail `auth: file (mode 0600)` when storage-mode='file'; `fail` with `no tokens — run \\`recovery-ledger auth\\`` when storage-mode is absent."
    - "doctor check `token_freshness` reports `pass` with `expires in <Xm>` when expiresAt > now + 5min, `warn` with `expires in <Xm>` when within 5min, `fail` with `expired <X> ago` when expired, `fail` with `no tokens` when tokens are absent."
    - "Neither auth check nor token-freshness check ever calls the WHOOP refresh endpoint — both are OFFLINE-SAFE (D-22)."
    - "runDoctor() now runs 5 probes (better_sqlite3_load, napi_keyring_load, mcp_stdout_purity, auth, token_freshness) with PROBE_NAMES kept in positional alignment with Promise.allSettled."
    - "Gate E (new in ci-grep-gates.sh): `grep -rEn 'oauth/oauth2/token' src/` finds matches ONLY in src/infrastructure/whoop/token-store.ts (ADR-0002 §Enforcement)."
    - "Gate E is a STRING-LITERAL gate (greps for the literal `oauth/oauth2/token`). URL construction via concatenation (e.g., `'oauth' + '/oauth2/token'` or `'/' + 'oauth/oauth2' + '/' + 'token'`) would bypass it. This bypass surface is documented as out-of-scope for this phase and acceptable risk per checker WARNING PLAN-06-SCOPE-DRIFT option (b): Recovery Ledger is a single-user personal tool; a developer attempting to bypass ADR-0002 by string-concatenating the endpoint URL would be deliberately bypassing a phase-level constraint they themselves wrote. The Biome-based `noRestrictedImports` rule documented in ADR-0002 §Enforcement is the in-source-tree complement; Gate E is the belt-and-suspenders CI complement; neither needs to defend against deliberately obfuscated concatenations."
  artifacts:
    - path: "src/services/doctor/checks/check-names.ts"
      provides: "Extended with AUTH and TOKEN_FRESHNESS frozen-const entries (frozen-const + derived-type pattern)."
      contains: "AUTH"
    - path: "src/services/doctor/checks/auth.ts"
      provides: "probeAuth — reads storage-mode cache + verifies token presence; returns DoctorCheck with status pass/fail and detail string."
      contains: "probeAuth"
    - path: "src/services/doctor/checks/token-freshness.ts"
      provides: "probeTokenFreshness — reads tokens, compares expiresAt to now; pass/warn/fail with human-readable detail."
      contains: "probeTokenFreshness"
    - path: "src/services/doctor/index.ts"
      provides: "Extended PROBE_NAMES + Promise.allSettled call to include the two new probes."
      contains: "AUTH"
    - path: "scripts/ci-grep-gates.sh"
      provides: "Gate E added — only token-store.ts may reference oauth/oauth2/token endpoint."
      contains: "oauth/oauth2/token"
  key_links:
    - from: "src/services/doctor/checks/auth.ts"
      to: "src/infrastructure/whoop/token-store.ts"
      via: "imports readStorageMode + a token-presence helper; never imports getValidAccessToken (offline-safe)"
      pattern: "readStorageMode"
    - from: "src/services/doctor/checks/token-freshness.ts"
      to: "src/infrastructure/whoop/token-store.ts"
      via: "imports tokenStore.read() — reads token blob without triggering refresh"
      pattern: "tokenStore.read"
    - from: "src/services/doctor/index.ts"
      to: "src/services/doctor/checks/auth.ts and token-freshness.ts"
      via: "Promise.allSettled call appended with probeAuth() and probeTokenFreshness()"
      pattern: "probeAuth"
    - from: "scripts/ci-grep-gates.sh Gate E"
      to: "src/infrastructure/whoop/token-store.ts"
      via: "grep -rEn 'oauth/oauth2/token' src/ | grep -v token-store.ts must produce zero output"
      pattern: "Gate E"
---

<objective>
Extend Phase 1's doctor surface with two new offline-safe checks: `auth` (which backend stores tokens — keychain/file/missing) and `token_freshness` (how close to expiry). Also add Gate E to ci-grep-gates.sh to enforce ADR-0002's "token-store.ts is the sole consumer of the refresh endpoint" rule.

Purpose: AUTH-03 (storage backend surfaced by `doctor`) — Phase 2 success criterion #3. Gate E is the load-bearing enforcement of ADR-0002 §Enforcement (the Biome import-restriction approach won't catch raw URL strings; the grep gate does).

Per checker WARNING PLAN-06-SCOPE-DRIFT (option b): Gate E is intentionally a string-literal grep; URL-construction-via-concatenation bypass is documented as out-of-scope for this phase. Rationale: Recovery Ledger is a single-user personal tool; a developer would be deliberately bypassing their own constraint to write `'oauth' + '/oauth2/token'`. Acceptable risk; Biome's `noRestrictedImports` (per ADR-0002 §Enforcement) is the in-source-tree complement.

Output: Two new probe files + co-located tests; check-names.ts extended; runDoctor wiring extended; index.test.ts MR-36 canonical-name assertion grown from 3 to 5 names; one new gate in ci-grep-gates.sh.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/PROJECT.md
@.planning/REQUIREMENTS.md
@.planning/phases/02-oauth-token-store-single-flight-refresh/02-CONTEXT.md
@.planning/phases/02-oauth-token-store-single-flight-refresh/02-RESEARCH.md
@.planning/phases/02-oauth-token-store-single-flight-refresh/02-PATTERNS.md
@CLAUDE.md
@agent_docs/conventions.md
@agent_docs/decisions/0001-mcp-stdout-purity.md
@agent_docs/decisions/0002-single-flight-oauth-refresh.md
@src/services/doctor/index.ts
@src/services/doctor/checks/check-names.ts
@src/services/doctor/checks/native-modules.ts
@src/services/doctor/checks/native-modules.test.ts
@scripts/ci-grep-gates.sh

<interfaces>
<!-- The doctor surface is the ONLY MCP-reachable channel that exposes the Phase 2 auth state. -->

From Plan 02:
- `src/infrastructure/whoop/token-store.ts` → `tokenStore.read()`, `tokenStore.readStorageMode()`, `type Tokens`

Phase 1 contracts (unchanged):
- `DoctorCheck = { name: string; status: 'pass' | 'warn' | 'fail'; detail: string; }`
- `CHECK_NAMES` is a frozen const with derived `CheckName` type.
- `runDoctor(opts)` runs Promise.allSettled over the PROBE_NAMES-aligned probes. The fall-through arm synthesizes a fail DoctorCheck for any probe that throws.

check-names.ts extension (per PATTERNS lines 254-262):
```typescript
export const CHECK_NAMES = {
  BETTER_SQLITE3_LOAD: 'better_sqlite3_load',
  NAPI_KEYRING_LOAD: 'napi_keyring_load',
  MCP_STDOUT_PURITY: 'mcp_stdout_purity',
  AUTH: 'auth',
  TOKEN_FRESHNESS: 'token_freshness',
} as const;
```

auth.ts behavior (per D-21.1):
- Read storage-mode cache via `tokenStore.readStorageMode()`.
- If null (no file): return `{name: 'auth', status: 'fail', detail: 'no tokens — run `recovery-ledger auth`'}`.
- If `'keychain'`: verify tokens are present via `tokenStore.read()` (which respects the cache). On null/empty, return `{status: 'fail', detail: 'mode=keychain but tokens missing — run `recovery-ledger auth`'}`.
- If `'file'`: verify tokens are present via `tokenStore.read()`. On null/empty, return `{status: 'fail', detail: 'mode=file but tokens missing — run `recovery-ledger auth`'}`.
- On present: return `{status: 'pass', detail: 'auth: keychain'}` or `{status: 'pass', detail: 'auth: file (mode 0600)'}`.
- NEVER call `tokenStore.getValidAccessToken()` — offline-safe per D-22.

token-freshness.ts behavior (per D-21.2):
- Read tokens via `tokenStore.read()`. On null: return `{status: 'fail', detail: 'no tokens'}`.
- Compute `delta = tokens.expiresAt - now`.
- If `delta > 5 * 60 * 1000`: return `{status: 'pass', detail: \`expires in ${formatDuration(delta)}\`}` (e.g., `expires in 47m`).
- If `0 < delta <= 5 * 60 * 1000`: return `{status: 'warn', detail: \`expires in ${formatDuration(delta)}\`}` (e.g., `expires in 4m`).
- If `delta <= 0`: return `{status: 'fail', detail: \`expired ${formatDuration(-delta)} ago — run \`recovery-ledger auth\``}`.
- `formatDuration(ms)` helper: returns `${minutes}m` for < 60min, `${hours}h ${minutes}m` for >= 60min. Pure function; unit-tested.

runDoctor extension (per PATTERNS lines 268-286):
- Append `CHECK_NAMES.AUTH` and `CHECK_NAMES.TOKEN_FRESHNESS` to `PROBE_NAMES` array (in that order — auth before freshness because auth gates freshness; doctor output prefers the more-fundamental check first).
- Append `probeAuth()` and `probeTokenFreshness()` to the `Promise.allSettled([...])` call in the SAME order.
- Both probes are offline-safe so they do NOT need the `skipSubprocess` gate.

index.test.ts MR-36 canonical-name assertion (per PATTERNS lines 298-308):
- Grow the assertion from "three" to "five" canonical names — `result.checks.map(c => c.name)` MUST contain all five.

Gate E (ci-grep-gates.sh, per PATTERNS lines 622-630) — STRING-LITERAL gate (see plan-level note on PLAN-06-SCOPE-DRIFT):
- Append to the bottom of the script, after Gate D. Pattern:
  ```sh
  # ----------------------------------------------------------------------------
  # Gate E — only token-store.ts may reference the WHOOP refresh endpoint.
  # ADR-0002 §Enforcement: "Token-store module is the only consumer of the
  # refresh endpoint." Biome's noRestrictedImports operates on import paths,
  # not URL strings, so this grep gate is the load-bearing enforcement for
  # literal URL references. URL-construction-via-concatenation bypass is
  # documented as out-of-scope (see Plan 02-06 must_haves.truths) — Recovery
  # Ledger is a single-user personal tool and a developer would be
  # deliberately bypassing their own constraint to obfuscate.
  # ----------------------------------------------------------------------------
  if "$GREP" -rEn 'oauth/oauth2/token' src/ \
      --exclude-dir=node_modules \
      | "$GREP" -v 'token-store\.ts' \
      > /tmp/gate-e.$$ 2>/dev/null; then
    echo "::error::Gate E — non-token-store file references the WHOOP refresh endpoint:"
    cat /tmp/gate-e.$$
    rm -f /tmp/gate-e.$$
    exit 1
  fi
  rm -f /tmp/gate-e.$$
  ```
</interfaces>
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: auth.ts + token-freshness.ts probes, check-names + runDoctor extension, Gate E</name>
  <files>
    src/services/doctor/checks/check-names.ts,
    src/services/doctor/checks/auth.ts,
    src/services/doctor/checks/auth.test.ts,
    src/services/doctor/checks/token-freshness.ts,
    src/services/doctor/checks/token-freshness.test.ts,
    src/services/doctor/index.ts,
    src/services/doctor/index.test.ts,
    scripts/ci-grep-gates.sh
  </files>
  <read_first>
    - src/services/doctor/checks/check-names.ts (Phase 1 — current CHECK_NAMES frozen const + derived type; extend, don't replace)
    - src/services/doctor/checks/native-modules.ts (Phase 1 analog — DoctorCheck producer shape; lines 13-54 verbatim pattern; remediation phrase convention)
    - src/services/doctor/checks/native-modules.test.ts (Phase 1 analog — happy-path probe test shape; lines 14-30)
    - src/services/doctor/index.ts (Phase 1 — PROBE_NAMES + Promise.allSettled wiring; lines 95-120 for the pattern to extend)
    - src/services/doctor/index.test.ts (Phase 1 — MR-36 canonical-name assertion; extend from 3 to 5)
    - src/services/doctor/checks/mcp-stdout-purity.test.ts (Phase 1 — ProbeOptions + mkdtemp temp-RECOVERY_LEDGER_HOME pattern; lines 16-18 imports)
    - src/infrastructure/whoop/token-store.ts (Plan 02 — readStorageMode() and read() signatures)
    - scripts/ci-grep-gates.sh (current Gates A/B/C/D — Plan 06 appends Gate E at the bottom)
    - .planning/phases/02-oauth-token-store-single-flight-refresh/02-CONTEXT.md (D-21, D-22, D-25)
    - .planning/phases/02-oauth-token-store-single-flight-refresh/02-RESEARCH.md (lines 789-818 doctor auth check sketch; Pitfall E — storage-mode caching; Pitfall F — read-after-write verification)
    - .planning/phases/02-oauth-token-store-single-flight-refresh/02-PATTERNS.md (lines 185-220 for probe DoctorCheck shape; lines 250-262 for check-names extension; lines 266-286 for runDoctor extension; lines 298-308 for the index.test.ts MR-36 extension; lines 622-630 for Gate E sketch)
    - agent_docs/decisions/0002-single-flight-oauth-refresh.md (line 68-75 §Enforcement — Gate E is the load-bearing rule)
  </read_first>
  <behavior>
    check-names.ts:
    - Test N-01: `CHECK_NAMES.AUTH === 'auth'` and `CHECK_NAMES.TOKEN_FRESHNESS === 'token_freshness'`.
    - Test N-02: the derived `CheckName` type accepts the new values (verify by assigning literal `'auth'` to a `CheckName` variable in a compile-time test — no runtime expect needed; just ensure tsc doesn't error).

    auth.ts probe:
    - Test AU-01 (no storage-mode file): with empty `RECOVERY_LEDGER_HOME` tmpdir, `probeAuth()` returns `{name: 'auth', status: 'fail', detail: <contains "no tokens"> }`.
    - Test AU-02 (keychain mode, tokens present): write storage-mode='keychain', mock `tokenStore.read()` to return a valid Tokens object. probeAuth returns `{status: 'pass', detail: 'auth: keychain'}`.
    - Test AU-03 (file mode, tokens present): write storage-mode='file' + a valid tokens.json. probeAuth returns `{status: 'pass', detail: 'auth: file (mode 0600)'}`.
    - Test AU-04 (mode present, tokens absent): write storage-mode='keychain' but mock `tokenStore.read()` to return null. probeAuth returns `{status: 'fail', detail: <contains "mode=keychain" and "tokens missing">}`.
    - Test AU-05 (offline-safe): probeAuth must NOT call tokenStore.getValidAccessToken (spy assertion — getValidAccessToken is never invoked). No MSW server is started in this test file; if probeAuth tried to refresh, the fetch would fail loudly.
    - Test AU-06 (remediation phrase): every fail detail ends with a remediation phrase matching either `run \`recovery-ledger auth\`` or `run \`recovery-ledger init\`` per the native-modules.ts MR-22 convention.

    token-freshness.ts probe:
    - Test TF-01 (fresh): tokens with `expiresAt = now + 60 * 60 * 1000` → status=pass, detail matches `/expires in \d+m/` (no exact minute pin — use a regex to tolerate clock jitter in CI).
    - Test TF-02 (within buffer): tokens with `expiresAt = now + 4 * 60 * 1000` → status=warn, detail matches `/expires in \dm/`.
    - Test TF-03 (expired): tokens with `expiresAt = now - 2 * 60 * 60 * 1000` → status=fail, detail matches `/expired \d+h \d+m ago/` AND contains `recovery-ledger auth`.
    - Test TF-04 (no tokens): tokenStore.read returns null → status=fail, detail === 'no tokens'.
    - Test TF-05 (offline-safe): probeTokenFreshness never invokes getValidAccessToken (spy).
    - Test TF-06 (formatDuration helper): export as a named function (allows unit testing); `formatDuration(0)` returns `'0m'`, `formatDuration(45*60*1000)` returns `'45m'`, `formatDuration(125*60*1000)` returns `'2h 5m'`, `formatDuration(-1)` is undefined-result territory — the probe always passes positive `ms` so we don't pin negative behavior.

    runDoctor + canonical-name assertion:
    - Test D-01: with no tokens at all, `runDoctor({skipSubprocessChecks: true})` returns a result with exactly 5 checks; `result.checks.map(c=>c.name).sort()` contains `'auth'`, `'better_sqlite3_load'`, `'mcp_stdout_purity'`, `'napi_keyring_load'`, `'token_freshness'` — wait, MCP_STDOUT_PURITY is skipped under `skipSubprocessChecks: true`, so the canonical-name check needs to assert 5 names WITHOUT requiring the subprocess check to run (the canonical set is always 5, but the subprocess check is gated). Re-spec: with `skipSubprocessChecks: true`, runDoctor still emits a check for mcp_stdout_purity (the existing Phase 1 behavior is that it emits a `pass` placeholder check — see src/services/doctor/checks/mcp-stdout-purity.ts. If that's NOT the existing behavior, then the assertion adjusts to 4 names with subprocess skipped + 5 with subprocess on). Reading the Phase 1 code: mcp-stdout-purity.ts probe returns a skip-marked check when `skipSubprocess: true` per CR-01/MR-14 — it emits `{status: 'pass', name: 'mcp_stdout_purity', detail: 'skipped'}` or similar. The MR-36 test must verify all 5 canonical names appear regardless. ADJUST the test to read the actual Phase 1 behavior at test-write time.
    - Test D-02: `result.checks.find(c => c.name === 'auth')` is present and is the auth probe's output (status=fail/pass as appropriate to the test fixture state).
    - Test D-03: `result.checks.find(c => c.name === 'token_freshness')` is present.
    - Test D-04 (overall precedence): when auth=fail AND others=pass, `result.overall === 'fail'`. Verifies that adding the new probes doesn't break the existing precedence rule.

    Gate E:
    - Test E-G1: `bash scripts/ci-grep-gates.sh` exits 0 with the current src/ tree (token-store.ts is the only file referencing oauth/oauth2/token; oauth.ts references oauth/oauth2/auth but NOT oauth/oauth2/token).
    - Test E-G2: temporarily add a file `src/services/violator.ts` with content containing `oauth/oauth2/token` — running the script returns exit code 1 with `::error::Gate E` in stderr. Remove the temp file. Verifies the gate is load-bearing.
    - NOTE: there is intentionally NO test for the URL-concatenation bypass case. Per the plan-level note on PLAN-06-SCOPE-DRIFT, that surface is out-of-scope for this phase; Biome's noRestrictedImports rule (per ADR-0002 §Enforcement) covers in-source-tree imports as the complementary layer.
  </behavior>
  <action>
    Step 1 — Modify `src/services/doctor/checks/check-names.ts`:
    - Add two new entries: `AUTH: 'auth'`, `TOKEN_FRESHNESS: 'token_freshness'`. Maintain the `as const` and the derived `CheckName` type.

    Step 2 — Create `src/services/doctor/checks/auth.ts`. Named exports only. ~50 LOC.
    1. Imports: `'../index.js'` (type DoctorCheck), `'./check-names.js'` (CHECK_NAMES), `'../../../infrastructure/whoop/token-store.js'` (`tokenStore`, but also export an `AuthProbeDeps` test seam — see Step 3).
    2. `export interface AuthProbeDeps { readStorageMode?: () => Promise<'keychain' | 'file' | null>; readTokens?: () => Promise<Tokens | null>; }` — test seam mirroring ProbeOptions from mcp-stdout-purity.ts.
    3. `export async function probeAuth(deps?: AuthProbeDeps): Promise<DoctorCheck>`:
       - `const readStorageMode = deps?.readStorageMode ?? tokenStore.readStorageMode;`
       - `const readTokens = deps?.readTokens ?? tokenStore.read;`
       - Implement the behavior table above. Wrap each call in try/catch — on throw, return `{name: 'auth', status: 'fail', detail: \`probe threw: ${err.message}\`}`.
       - NEVER call `tokenStore.getValidAccessToken` — not imported.
       - NEVER use `console.*` or `process.stdout.write`.

    Step 3 — Create `src/services/doctor/checks/token-freshness.ts`. Named exports only. ~50 LOC.
    1. Imports: `'../index.js'`, `'./check-names.js'`, `'../../../infrastructure/whoop/token-store.js'` (`tokenStore`, `REFRESH_BUFFER_MS`, `type Tokens`).
    2. `export function formatDuration(ms: number): string` — pure helper.
    3. `export interface TokenFreshnessProbeDeps { read?: () => Promise<Tokens | null>; now?: () => number; }`
    4. `export async function probeTokenFreshness(deps?: TokenFreshnessProbeDeps): Promise<DoctorCheck>`:
       - `const read = deps?.read ?? tokenStore.read;`
       - `const now = deps?.now ?? Date.now;`
       - Behavior per the table. Use `REFRESH_BUFFER_MS` constant (5 min) imported from token-store.ts.
       - NEVER call `tokenStore.getValidAccessToken`.

    Step 4 — Modify `src/services/doctor/index.ts`:
    - Import `probeAuth` and `probeTokenFreshness`.
    - Extend `PROBE_NAMES` array (append `CHECK_NAMES.AUTH` and `CHECK_NAMES.TOKEN_FRESHNESS`).
    - Extend `Promise.allSettled([probeBetterSqlite3(), probeKeyring(), probeMcpStdoutPurity({skipSubprocess}), probeAuth(), probeTokenFreshness()])` — preserve positional alignment with PROBE_NAMES (MR-36 ordering rule). Update the comment block at lines 97-99 if needed.

    Step 5 — Modify `src/services/doctor/index.test.ts`:
    - Update the MR-36 canonical-name test to assert all 5 names. Change the test name from "three" to "five" or similar.

    Step 6 — Create co-located test files for auth.ts and token-freshness.ts. Pattern from native-modules.test.ts + mcp-stdout-purity.test.ts:
    - `mkdtemp(tmpdir() + '/rl-')` per test for `RECOVERY_LEDGER_HOME` isolation.
    - vi.doMock the `@napi-rs/keyring` module per the recipe in RESEARCH lines 1044-1057.
    - For probeAuth, inject `AuthProbeDeps` to control storage-mode + token presence without touching real disk.
    - For probeTokenFreshness, inject `TokenFreshnessProbeDeps` with controlled `now` and `read` returns.
    - All AU-01..06, TF-01..06, N-01..02 tests per <behavior>.

    Step 7 — Modify `scripts/ci-grep-gates.sh`:
    - Append the Gate E block at the bottom (after Gate D). Use the pattern from <interfaces>.
    - Add to the comment-block header at the top of the script: "Gate E: only src/infrastructure/whoop/token-store.ts may reference the WHOOP refresh endpoint (ADR-0002 §Enforcement). Note: literal-string gate; URL-construction-via-concatenation bypass is out-of-scope for this phase per Plan 02-06 plan-level note."
    - Add a one-line in-script test: run the gate as part of the script's own self-check. (Not strictly required — the gate's exit code is the test.)

    Step 8 — Verify locally:
    - `npm run test -- --run src/services/doctor/` — all probe tests + index.test.ts MR-36 extension pass.
    - `bash scripts/ci-grep-gates.sh` — exits 0 with no violator file present.
    - Temporarily add a violator file (`src/services/violator.ts` containing `oauth/oauth2/token`) and confirm the gate exits 1. Remove the violator file before committing.
  </action>
  <verify>
    <automated>npm run test -- --run src/services/doctor/ &amp;&amp; bash scripts/ci-grep-gates.sh</automated>
  </verify>
  <acceptance_criteria>
    - `src/services/doctor/checks/check-names.ts` contains AUTH and TOKEN_FRESHNESS entries: `grep -nE "AUTH:\s*'auth'" src/services/doctor/checks/check-names.ts` returns 1 match; `grep -nE "TOKEN_FRESHNESS:\s*'token_freshness'" src/services/doctor/checks/check-names.ts` returns 1 match.
    - `src/services/doctor/checks/auth.ts` exports `probeAuth`, `AuthProbeDeps`. Grep `grep -cE '^export ' src/services/doctor/checks/auth.ts` returns >= 2.
    - `src/services/doctor/checks/token-freshness.ts` exports `probeTokenFreshness`, `formatDuration`, `TokenFreshnessProbeDeps`. Grep returns >= 3.
    - `src/services/doctor/index.ts` PROBE_NAMES now contains 5 entries: `grep -nE 'CHECK_NAMES\.AUTH|CHECK_NAMES\.TOKEN_FRESHNESS' src/services/doctor/index.ts` returns >= 4 matches (1 import + 1 in PROBE_NAMES + 2 in the allSettled call's positional alignment — at minimum).
    - `scripts/ci-grep-gates.sh` Gate E block is present: `grep -nE 'Gate E' scripts/ci-grep-gates.sh` returns >= 2 matches (header comment + section header).
    - `grep -nE 'oauth/oauth2/token' scripts/ci-grep-gates.sh` returns at least 1 match (the gate's grep pattern).
    - `grep -nE 'tokenStore\.getValidAccessToken|getValidAccessToken' src/services/doctor/checks/auth.ts src/services/doctor/checks/token-freshness.ts` returns NO matches (offline-safe enforcement).
    - `grep -nE 'console\.(log|info|warn|error|debug|trace)|process\.stdout\.write' src/services/doctor/checks/auth.ts src/services/doctor/checks/token-freshness.ts` returns no matches.
    - `npm run test -- --run src/services/doctor/checks/auth.test.ts` exits 0 with >= 6 passing tests.
    - `npm run test -- --run src/services/doctor/checks/token-freshness.test.ts` exits 0 with >= 6 passing tests.
    - `npm run test -- --run src/services/doctor/index.test.ts` exits 0 with the MR-36 test now asserting 5 canonical names.
    - `bash scripts/ci-grep-gates.sh` exits 0 (with no violator file present).
    - Run the Gate-E violator self-check: `echo "// oauth/oauth2/token violator" > src/services/_gate-e-test.ts && (bash scripts/ci-grep-gates.sh; echo "exit=$?"); rm src/services/_gate-e-test.ts` — the script must print `::error::Gate E` and exit with code 1.
    - `npm run lint` exits 0.
  </acceptance_criteria>
  <done>
    Two new doctor probes ship offline-safe; check-names + runDoctor wiring extended; index.test.ts MR-36 grown to 5; Gate E enforces ADR-0002 §Enforcement at CI time (string-literal gate; URL-concatenation bypass acknowledged as out-of-scope per plan-level note); 12+ probe tests green plus existing doctor tests still pass.
  </done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| tokenStore.readStorageMode() / read() → probes | trusted internal API; probes never call refresh endpoint |
| DoctorCheck.detail string → MCP error sanitizer | detail strings flow into MCP via runDoctor → whoop_doctor tool → register.ts; Phase 1 sanitizer covers any token-shape that might slip in (but probes never include token material in detail) |
| CI grep scan → src/ tree | filesystem scan; gate's grep is the load-bearing enforcement of ADR-0002 §Enforcement for literal URL references |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-02.06-01 | Information Disclosure | doctor detail string leaks token material | mitigate | probeAuth detail is constant strings only: `'auth: keychain'`, `'auth: file (mode 0600)'`, `'no tokens — run \`recovery-ledger auth\`'`, etc. probeTokenFreshness detail is `formatDuration` output (purely numeric) + remediation. NEVER interpolate token fields. Tests AU-04, TF-01..04 assert detail format. ASVS V7. |
| T-02.06-02 | Repudiation | doctor accidentally refreshes tokens | mitigate | Neither probe imports `tokenStore.getValidAccessToken` (verified by grep). D-22 keeps Phase 2 doctor offline-safe. ASVS V11. |
| T-02.06-03 | Tampering | bypass of ADR-0002 single-consumer rule | mitigate | Gate E in ci-grep-gates.sh: `grep -rEn 'oauth/oauth2/token' src/ | grep -v token-store.ts` must return zero. Verified by an inline violator-test. CI fails the build on any new file that hits the refresh endpoint via the literal string. ASVS V11. |
| T-02.06-03b | Tampering | bypass of Gate E via URL string concatenation | accept | Per plan-level note (PLAN-06-SCOPE-DRIFT option b): single-user personal tool; a developer concatenating the endpoint URL to bypass Gate E is deliberately working around their own constraint. ADR-0002 §Enforcement names Biome's `noRestrictedImports` as the in-source-tree complement (which catches concatenations that re-export the URL through another module). Acceptable risk for a single-developer project. |
| T-02.06-04 | Spoofing | hostile storage-mode file value | mitigate | tokenStore.readStorageMode validates the file contents to one of `'keychain' | 'file' | null`. A hostile string (e.g., `https://attacker.com`) is treated as null per the unit tests in Plan 02 (B-01..04). ASVS V5. |
| T-02.06-05 | Information Disclosure | probe throws and leaks via runDoctor synthesized check | mitigate | runDoctor's catch arm formats `probe threw: ${reason}` where `reason` is `err.message`. probeAuth/probeTokenFreshness wrap their internals in try/catch and never let raw errors with token material escape. Defense-in-depth: Phase 1 sanitizer covers the MCP path. ASVS V7. |
| T-02.06-06 | DoS | filesystem stat blocks the doctor | mitigate | probes are async + Promise.allSettled — a hung stat in one probe does not block others. macOS/Linux fs stat is sub-ms in practice. ASVS V11. |
</threat_model>

<verification>
- `check-names.ts` extended with AUTH and TOKEN_FRESHNESS.
- `auth.ts` and `token-freshness.ts` ship with co-located tests covering all 12+ behavior cases.
- `runDoctor()` emits 5 canonical checks (the MR-36 assertion now asserts 5).
- `bash scripts/ci-grep-gates.sh` exits 0 normally, exits 1 with a violator file present.
- `npm run test -- --run src/services/doctor/` exits 0 with all probe + index + check-names tests green.
- `npm run lint` exits 0.
</verification>

<success_criteria>
- AUTH-03 doctor surface satisfied: `auth: keychain` vs `auth: file (mode 0600)` vs `no tokens` reported.
- token_freshness reports pass/warn/fail per 5-min buffer policy (D-14 + D-21.2).
- Both probes offline-safe (D-22): no refresh endpoint hits during doctor runs.
- ADR-0002 §Enforcement now CI-enforced via Gate E (string-literal gate; URL-concatenation bypass acknowledged as out-of-scope for a single-user tool — see plan-level note + truths line).
- MR-36 canonical-set assertion grown from 3 to 5 — any future drift across the probe-name <-> Promise.allSettled mapping fails the build.
</success_criteria>

<output>
After completion, create `.planning/phases/02-oauth-token-store-single-flight-refresh/02-06-SUMMARY.md`.
</output>
