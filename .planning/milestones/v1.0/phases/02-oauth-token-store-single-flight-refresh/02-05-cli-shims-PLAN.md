---
phase: 02-oauth-token-store-single-flight-refresh
plan: 05
type: execute
wave: 4
depends_on: ['02-01', '02-02', '02-03']
files_modified:
  - src/cli/commands/init.ts
  - src/cli/commands/init.test.ts
  - src/cli/commands/auth.ts
  - src/cli/commands/auth.test.ts
  - src/cli/index.ts
  - scripts/ci-grep-gates.sh
autonomous: true
requirements:
  - AUTH-01
  - AUTH-02
  - AUTH-03
user_setup:
  - service: whoop
    why: "OAuth flow requires the user to have a WHOOP developer app with client_id/client_secret registered."
    env_vars:
      - name: WHOOP_CLIENT_ID
        source: "WHOOP Developer Dashboard → Applications → your app → Client ID. Optional — `init` also writes config.json. Env-var wins per D-06."
      - name: WHOOP_CLIENT_SECRET
        source: "WHOOP Developer Dashboard → Applications → your app → Client Secret. Optional — env-var wins per D-06."
    dashboard_config:
      - task: "Register the loopback redirect URI"
        location: "WHOOP Developer Dashboard → Applications → Redirect URIs → add `http://127.0.0.1:<redirect_port>/callback`"

must_haves:
  truths:
    - "D-01: `recovery-ledger init` and `recovery-ledger auth` are two separate commands with no auto-chain; init is idempotent config bootstrap, auth performs the OAuth round-trip."
    - "`recovery-ledger init` writes ~/.recovery-ledger/config.json mode 0600 from prompts (client_id, client_secret, redirect_port)."
    - "`init` is idempotent — running it twice with the same prompts produces the same file content."
    - "`init` prints the verbatim D-02 instructions: the WHOOP developer-portal URL, the constructed redirect URI, and the D-13 scope set."
    - "If WHOOP_CLIENT_ID and WHOOP_CLIENT_SECRET are both in the env at init time, init skips the prompt and writes a minimal config (env-var precedence — D-06 + Specifics line 163)."
    - "`recovery-ledger auth` reads config.json, runs runOAuth, persists tokens via tokenStore.write, prints `Authorization complete.` to stdout."
    - "`auth --no-browser` skips the browser open and prints the authorize URL to stdout (per D-08)."
    - "`auth --timeout <seconds>` overrides D-10's 5-min default."
    - "`auth` exit codes: 0 (success), 1 (auth_missing/state_mismatch/timeout/port_in_use/refresh_failed/auth_expired), 2 (warn — not used in this phase but reserved per the doctor convention)."
    - "Gate C (ci-grep-gates.sh) is broadened from `src/cli/commands/doctor.ts` to `src/cli/commands/**/*.ts` so init.ts and auth.ts can use process.stdout.write without violating the gate."
    - "init.ts AND auth.ts both `import { ConfigSchema, type InitConfig, D13_SCOPES } from '../../infrastructure/config/schema.js'` — the canonical Zod schema lives in Plan 02-01's schema.ts (DRY-fix per checker WARNING PLAN-05-DRY-VIOLATION). Neither file defines its own ConfigSchema."
  artifacts:
    - path: "src/cli/commands/init.ts"
      provides: "Commander subcommand — config bootstrap with interactive prompts + env-var precedence. Imports ConfigSchema + D13_SCOPES from the canonical schema.ts (Plan 02-01)."
      contains: "runInitCommand"
    - path: "src/cli/commands/auth.ts"
      provides: "Commander subcommand — runs runOAuth(), writes Tokens via tokenStore. Imports ConfigSchema from the canonical schema.ts (Plan 02-01)."
      contains: "runAuthCommand"
    - path: "src/cli/index.ts"
      provides: "Commander program — extended with .command('init') and .command('auth')."
      contains: "init"
    - path: "scripts/ci-grep-gates.sh"
      provides: "Gate C broadened to allow process.stdout.write from any file under src/cli/commands/."
      contains: "src/cli/commands"
  key_links:
    - from: "src/cli/commands/init.ts"
      to: "src/infrastructure/config/paths.ts + src/infrastructure/config/schema.ts"
      via: "imports `paths` to write config.json at paths.configFile; imports `ConfigSchema` and `D13_SCOPES` (DRY-fix — canonical schema lives in schema.ts from Plan 02-01)"
      pattern: "from '../../infrastructure/config/schema"
    - from: "src/cli/commands/auth.ts"
      to: "src/infrastructure/whoop/oauth.ts"
      via: "imports runOAuth and calls it with config + flags"
      pattern: "runOAuth"
    - from: "src/cli/commands/auth.ts"
      to: "src/infrastructure/config/schema.ts"
      via: "imports `ConfigSchema` and validates the on-disk config.json via the canonical Zod schema (DRY-fix per checker WARNING PLAN-05-DRY-VIOLATION)"
      pattern: "from '../../infrastructure/config/schema"
    - from: "src/cli/commands/auth.ts"
      to: "src/infrastructure/whoop/token-store.ts"
      via: "imports `tokenStore` and calls tokenStore.write(tokens) on success"
      pattern: "tokenStore.write"
    - from: "src/cli/index.ts"
      to: "src/cli/commands/init.ts and auth.ts"
      via: ".command('init').action(runInitCommand)` and `.command('auth').action(runAuthCommand)`"
      pattern: "\\.command\\('init'\\)"
---

<objective>
Wire the CLI surface for `recovery-ledger init` and `recovery-ledger auth`. The init command bootstraps config.json (idempotent, env-var precedence, mode 0600). The auth command runs the OAuth flow via Plan 03's runOAuth and persists tokens via Plan 02's tokenStore.write. Both files import the canonical `ConfigSchema` and `D13_SCOPES` from Plan 02-01's `src/infrastructure/config/schema.ts` (DRY-fix per checker WARNING PLAN-05-DRY-VIOLATION — neither command defines its own schema). Both follow the Phase 1 doctor.ts shim shape: ≤ ~80 LOC each, services-layer style. Also broaden Gate C in ci-grep-gates.sh so init.ts and auth.ts can emit human-facing output via process.stdout.write.

Purpose: AUTH-01 (init flow) and AUTH-02 (auth flow) — Phase 2 success criterion #1.

Output: Two new CLI command files + co-located tests; src/cli/index.ts extended; one-line edit to ci-grep-gates.sh. NO schema duplication — both files import from src/infrastructure/config/schema.ts.
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
@src/cli/commands/doctor.ts
@src/cli/commands/doctor.test.ts
@src/cli/index.ts
@scripts/ci-grep-gates.sh

<interfaces>
<!-- CLI command files follow the Phase 1 doctor.ts shim shape verbatim. Pattern excerpts in 02-PATTERNS.md lines 52-160. -->

From upstream plans:
- Plan 02-01 `src/infrastructure/config/paths.ts` → `paths.configFile`, `paths.configDir`
- Plan 02-01 `src/infrastructure/config/schema.ts` → `ConfigSchema`, `type InitConfig`, `D13_SCOPES` (DRY-fix canonical home for the Zod schema)
- Plan 02-02 `src/infrastructure/whoop/token-store.ts` → `tokenStore`, `type Tokens`
- Plan 02-03 `src/infrastructure/whoop/oauth.ts` → `runOAuth`, `type RunOAuthOptions`
- Plan 02-01 `src/infrastructure/whoop/errors.ts` → `AuthError`, `formatAuthError`, all 6 kinds including `auth_port_in_use`
- Phase 1 `src/cli/commands/doctor.ts` → analog: DOCTOR_EXIT_CODES freeze pattern, write-then-callback-exit MR-05 pattern, services composition root

D-01 config.json shape (canonical schema lives in Plan 02-01's schema.ts; this plan IMPORTS the schema, does NOT redefine it):
```
{ "clientId": "<from prompt or WHOOP_CLIENT_ID>",
  "clientSecret": "<from prompt or WHOOP_CLIENT_SECRET>",
  "redirectPort": <number, default 4321>,
  "scopes": ["offline","read:recovery","read:sleep","read:workout","read:cycles","read:profile","read:body_measurement"] }
```
- File written via atomic temp-and-rename (same recipe as token-store.ts Pattern 2 — Pitfall D) with mode 0o600.
- Validated on read via the canonical `ConfigSchema` from `src/infrastructure/config/schema.ts` (Plan 02-01).

D-02 verbatim text init prints (to stdout, before prompting):
```
Recovery Ledger uses a WHOOP developer app for BYO OAuth.

1. Create a WHOOP app:    https://developer.whoop.com/dashboard/applications
2. Redirect URI:          http://127.0.0.1:<redirect_port>/callback
3. Scopes Recovery Ledger will request:
   offline read:recovery read:sleep read:workout read:cycles read:profile read:body_measurement
```
(Wording is the planner's; the requirement is that it includes all three items from D-02. The scopes string is rendered by joining `D13_SCOPES` from schema.ts with `' '`.)

AUTH_EXIT_CODES (per PATTERNS lines 69-77):
```typescript
export const AUTH_EXIT_CODES: Readonly<Record<string, number>> = Object.freeze({
  success: 0,
  auth_missing: 1,
  auth_expired: 1,
  auth_state_mismatch: 1,
  auth_timeout: 1,
  auth_port_in_use: 1,
  refresh_failed: 1,
});
```

Commander hookup in src/cli/index.ts (per PATTERNS line 168-179):
- `.command('init').description('...').action(runInitCommand)`
- `.command('auth').description('...').option('--no-browser', 'print URL instead of opening').option('--timeout <seconds>', 'override 5-min default', parseInt).action(runAuthCommand)`
- Add help text with exit-code map for each subcommand (MR-22 convention).

D-08 / D-10 flag wiring:
- `--no-browser` → `noBrowser: true` passed to runOAuth.
- `--timeout 60` → `timeoutMs: 60_000` passed to runOAuth.

Gate C broadening:
- Current Gate C (per ci-grep-gates.sh comment line 14-15): "process.stdout.write banned outside src/cli/commands/doctor.ts".
- New scope: "process.stdout.write banned outside `src/cli/commands/**/*.ts`" — any CLI command file is allowed; nothing else.
- Update the script comment header AND the actual grep expression accordingly. Cite Plan 05 PATTERN lines 103-105 + 768 as the rationale.
</interfaces>
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: init.ts (config bootstrap) + auth.ts (OAuth runner) + Commander wiring + Gate C broadening — BOTH files import the canonical ConfigSchema from src/infrastructure/config/schema.ts</name>
  <files>
    src/cli/commands/init.ts,
    src/cli/commands/init.test.ts,
    src/cli/commands/auth.ts,
    src/cli/commands/auth.test.ts,
    src/cli/index.ts,
    scripts/ci-grep-gates.sh
  </files>
  <read_first>
    - src/cli/commands/doctor.ts (Phase 1 analog — lines 1-62, the exact shim shape to copy: DOCTOR_EXIT_CODES freeze, MR-05 write-then-callback-exit, outer try/catch)
    - src/cli/commands/doctor.test.ts (Phase 1 analog — lines 46-87 for vi.doMock/vi.resetModules pattern, mock process.exit + process.stdout.write)
    - src/cli/index.ts (Phase 1 — current Commander program; extend with .command('init') and .command('auth'))
    - scripts/ci-grep-gates.sh (current Gate A/B/C/D rules — Plan 05 modifies Gate C only)
    - src/infrastructure/config/paths.ts (Plan 02-01 — paths.configFile, paths.configDir)
    - src/infrastructure/config/schema.ts (Plan 02-01 — canonical ConfigSchema + InitConfig type + D13_SCOPES; this plan IMPORTS, does NOT redefine)
    - src/infrastructure/whoop/oauth.ts (Plan 02-03 — runOAuth signature)
    - src/infrastructure/whoop/token-store.ts (Plan 02-02 — tokenStore.write signature)
    - src/infrastructure/whoop/errors.ts (Plan 02-01 — AuthError kinds + formatAuthError; all 6 kinds finalized in Wave 0)
    - .planning/phases/02-oauth-token-store-single-flight-refresh/02-CONTEXT.md (D-01, D-02, D-06, D-08, D-10, D-11)
    - .planning/phases/02-oauth-token-store-single-flight-refresh/02-RESEARCH.md (D-06 env-var precedence; Specifics line 163 — init non-interactive when env-var creds present)
    - .planning/phases/02-oauth-token-store-single-flight-refresh/02-PATTERNS.md (lines 52-160 for init.ts/auth.ts shim shape; lines 168-179 for Commander wiring; lines 103-105 + 768 for Gate C broadening)
  </read_first>
  <behavior>
    init.ts:
    - Test I-01 (happy path with prompts): mock readline/Commander prompts to return `clientId='cid'`, `clientSecret='sec'`, `redirectPort='4321'`. After runInitCommand({}), `paths.configFile` exists with mode 0o600, parses as JSON matching `{clientId: 'cid', clientSecret: 'sec', redirectPort: 4321, scopes: [<7 strings>]}`.
    - Test I-02 (env-var precedence): set `WHOOP_CLIENT_ID='envid'` and `WHOOP_CLIENT_SECRET='envsec'` in test process.env. runInitCommand({}) writes config with `{clientId: 'envid', clientSecret: 'envsec', redirectPort: 4321, scopes: [...]}` WITHOUT prompting — prompt spy is never invoked.
    - Test I-03 (idempotency): runInitCommand({}) twice with same env vars → second run produces a config file with the same byte content as the first run.
    - Test I-04 (verbatim D-02 instructions): captured stdout from runInitCommand({}) contains the substrings `https://developer.whoop.com/dashboard/applications`, `http://127.0.0.1:4321/callback`, `offline read:recovery read:sleep read:workout read:cycles read:profile read:body_measurement`.
    - Test I-05 (config dir mkdir): when paths.configDir does not exist, runInitCommand creates it (mode 0o700 — defense-in-depth, the parent directory should also be private).
    - Test I-06 (file mode 0o600): `(await stat(paths.configFile)).mode & 0o777 === 0o600`.
    - Test I-07 (atomic write): after a successful runInitCommand, `${paths.configFile}.tmp` does NOT exist.
    - Test I-08 (exit code): runInitCommand resolves and process.exit is called with code 0.
    - Test I-09 (zod validation on clientId): with `WHOOP_CLIENT_ID='bad/value with spaces'` env var, runInitCommand rejects with a non-zero exit code and stdout contains a helpful error message (does NOT contain the bad value).
    - Test I-10 (canonical schema import): the init.ts module imports `ConfigSchema` and `D13_SCOPES` from `'../../infrastructure/config/schema.js'` — no inline `z.object({clientId: ...})` declaration in init.ts itself (DRY-fix verification).

    auth.ts:
    - Test A-01 (happy path): mock runOAuth to resolve with a synthetic Tokens object. Mock tokenStore.write to succeed. runAuthCommand({noBrowser: true, timeout: undefined}) writes the tokens, prints `Authorization complete.` to stdout, exits with code 0.
    - Test A-02 (state mismatch): mock runOAuth to reject with `AuthError({kind: 'auth_state_mismatch'})`. runAuthCommand exits with code 1; stdout contains a remediation phrase from formatAuthError(err) (does NOT contain the raw error message verbatim — uses formatAuthError to produce user-facing text).
    - Test A-03 (timeout): mock runOAuth to reject with `AuthError({kind: 'auth_timeout'})`. Exit code 1; stdout mentions `recovery-ledger auth` or `timed out`.
    - Test A-04 (port in use): mock runOAuth to reject with `AuthError({kind: 'auth_port_in_use', detail: 'port 4321'})`. Exit code 1; stdout mentions `recovery-ledger init` AND the port number `4321`.
    - Test A-05 (refresh_failed during code exchange): mock runOAuth to reject with `AuthError({kind: 'refresh_failed'})`. Exit code 1.
    - Test A-06 (--no-browser flag): runAuthCommand({noBrowser: true}) passes `noBrowser: true` to runOAuth (verified via spy).
    - Test A-07 (--timeout flag): runAuthCommand({timeout: 60}) passes `timeoutMs: 60000` to runOAuth.
    - Test A-08 (config missing): when paths.configFile does not exist, runAuthCommand exits with code 1 (auth_missing remediation) and stdout suggests `recovery-ledger init`.
    - Test A-09 (env-var override at auth time): when WHOOP_CLIENT_ID/SECRET are in env, auth.ts uses them even if config.json has different values (D-06 precedence). Spy on the args passed to runOAuth confirms env vars win.
    - Test A-10 (canonical schema import): the auth.ts module imports `ConfigSchema` from `'../../infrastructure/config/schema.js'` — no inline `z.object({clientId: ...})` declaration in auth.ts itself (DRY-fix verification).

    Commander wiring (src/cli/index.ts):
    - Test C-01: `recovery-ledger init` is registered (program.commands contains a command with name 'init').
    - Test C-02: `recovery-ledger auth` is registered with --no-browser and --timeout flags.

    Gate C broadening (scripts/ci-grep-gates.sh):
    - Gate C must accept process.stdout.write from any file under `src/cli/commands/` — i.e., the grep expression now excludes the whole directory, not just doctor.ts.
    - Running `bash scripts/ci-grep-gates.sh` against the new init.ts and auth.ts (which use process.stdout.write for user-facing output) MUST pass.
    - Adding a hypothetical `src/services/test-violator.ts` with `process.stdout.write(...)` MUST still fail Gate C — verified by an inline test that adds and removes the file in tmpdir-style or by asserting the gate's grep pattern shape via grep.
  </behavior>
  <action>
    Step 1 — Create `src/cli/commands/init.ts`. Named exports only. Module-leading comment cites D-01, D-02, D-06 and notes the canonical ConfigSchema lives in `src/infrastructure/config/schema.ts` (Plan 02-01 — DRY-fix per checker WARNING PLAN-05-DRY-VIOLATION). ~80 LOC. Structure:
    1. Imports: `node:fs/promises` (open, rename, mkdir, stat, writeFile), `node:path`, `node:readline/promises` (createInterface — for prompts; Commander doesn't have built-in prompts), `../../infrastructure/config/paths.js` (`paths`), `../../infrastructure/config/schema.js` (`ConfigSchema`, `type InitConfig`, `D13_SCOPES`). Do NOT import `zod` directly — schema.ts owns the Zod surface.
    2. Re-export the type for downstream consumers: `export type { InitConfig } from '../../infrastructure/config/schema.js';`. Do NOT define a local InitConfig interface.
    3. `export const INIT_EXIT_CODES = Object.freeze({success: 0, invalid_input: 1, write_failed: 1});`
    4. `export async function runInitCommand(opts: Record<string, unknown>): Promise<void>`:
       - `const envClientId = process.env.WHOOP_CLIENT_ID;`
       - `const envClientSecret = process.env.WHOOP_CLIENT_SECRET;`
       - If both env vars are present, build config minimally without prompting (Specifics line 163). Default `redirectPort: 4321`. Use `Array.from(D13_SCOPES)` for the `scopes` field (cloning the frozen import so the JSON serializer accepts it).
       - Else, print D-02 instructions to stdout (`scopes` line rendered as `D13_SCOPES.join(' ')`), then prompt via readline for missing fields. Default `redirectPort: 4321` if user just hits enter. coerce port input via `z.coerce.number().int().positive()` — BUT, do this via `ConfigSchema.shape.redirectPort` so the validation rule stays canonical. (If `ConfigSchema.shape.redirectPort.parse(value)` throws, prompt again or exit with INIT_EXIT_CODES.invalid_input.)
       - Validate the final assembled config via `ConfigSchema.parse(config)`. On Zod failure, write a remediation message to stdout (NEVER inline the bad value back — sanitization not strictly needed at this layer because Phase 1 stdout-purity gate is CLI-only, but defense-in-depth says don't echo bad input).
       - Ensure `paths.configDir` exists: `await mkdir(paths.configDir, { recursive: true, mode: 0o700 })` — recursive create + restrictive parent mode.
       - Atomic write the config: `open(paths.configFile + '.tmp', 'w', 0o600)` → `fd.writeFile(JSON.stringify(config, null, 2))` → `fd.sync()` → `fd.close()` → `rename(tmp, paths.configFile)`.
       - Write to stdout: `process.stdout.write(\`Config written to ${paths.configFile}.\nNext: recovery-ledger auth\n\`, () => process.exit(INIT_EXIT_CODES.success))` — MR-05 callback exit pattern.
       - Outer try/catch: on failure, print remediation to stdout (NEVER expose stack), exit with code 1.

    Step 2 — Create `src/cli/commands/auth.ts`. Named exports only. Module-leading comment cites D-01, D-08, D-10, D-11, AUTH-02 and notes the canonical ConfigSchema is imported from `src/infrastructure/config/schema.ts` (DRY-fix). ~80 LOC. Structure:
    1. Imports: `node:fs/promises` (readFile), `../../infrastructure/config/paths.js`, `../../infrastructure/config/schema.js` (`ConfigSchema`), `../../infrastructure/whoop/oauth.js` (runOAuth, type RunOAuthOptions), `../../infrastructure/whoop/token-store.js` (tokenStore), `../../infrastructure/whoop/errors.js` (AuthError, formatAuthError). auth.ts itself does NOT import `open` (runOAuth handles it internally) or `zod`.
    2. NO local schema definition. The DRY violation is fixed by importing `ConfigSchema` from the canonical location.
    3. `export const AUTH_EXIT_CODES = Object.freeze({success: 0, auth_missing: 1, auth_expired: 1, auth_state_mismatch: 1, auth_timeout: 1, auth_port_in_use: 1, refresh_failed: 1});`
    4. `export async function runAuthCommand(opts: { noBrowser?: boolean; timeout?: number }): Promise<void>`:
       - Read config: `await readFile(paths.configFile, 'utf8')` → `ConfigSchema.parse(JSON.parse(text))`.
       - On ENOENT: print remediation to stdout (`No config found. Run \`recovery-ledger init\` first.`), exit 1.
       - Apply env-var precedence: `const clientId = process.env.WHOOP_CLIENT_ID ?? config.clientId; const clientSecret = process.env.WHOOP_CLIENT_SECRET ?? config.clientSecret;`
       - Call `runOAuth({clientId, clientSecret, redirectPort: config.redirectPort, scopes: config.scopes, noBrowser: opts.noBrowser, timeoutMs: opts.timeout ? opts.timeout * 1000 : undefined})`.
       - On success: `await tokenStore.write(tokens)`. Print `Authorization complete.` to stdout. Exit 0.
       - On `AuthError`: print `formatAuthError(err)` to stdout. Exit `AUTH_EXIT_CODES[err.kind] ?? 1`.
       - On non-AuthError: print sanitized message; exit 1.
       - All exits via the MR-05 callback pattern.

    Step 3 — Modify `src/cli/index.ts`:
    - Import `runInitCommand` and `runAuthCommand`.
    - Add `.command('init')` and `.command('auth')` per <interfaces>. Include `.addHelpText('after', ...)` blocks (MR-22) listing each command's exit codes.

    Step 4 — Modify `scripts/ci-grep-gates.sh`:
    - Find Gate C section. Update the comment header from "outside src/cli/commands/doctor.ts" to "outside src/cli/commands/**/*.ts".
    - Update the grep expression: change the `--exclude` or path-filter to allow any `src/cli/commands/*.ts` file instead of just `doctor.ts`. The current implementation likely greps `src/` and excludes `src/cli/commands/doctor.ts`; change the exclusion to `src/cli/commands/*.ts` (or to a per-file walk that allows everything under `src/cli/commands/`).
    - Pin the rationale in a code comment: "Phase 2 Plan 05 broadens Gate C from a single file to the whole src/cli/commands/ directory; init.ts and auth.ts both emit human-facing output via process.stdout.write."
    - Run `bash scripts/ci-grep-gates.sh` locally to verify it still exits 0 with the new init.ts and auth.ts in place.

    Step 5 — Create the two co-located test files. Patterns from `src/cli/commands/doctor.test.ts`:
    - Mock process.exit + process.stdout.write per the harness in doctor.test.ts lines 64-87.
    - Mock readline/promises for init.ts prompt arms.
    - Use `vi.doMock('../../infrastructure/whoop/oauth.js', () => ({...}))` for auth.test.ts to stub runOAuth.
    - Use `mkdtemp` + `RECOVERY_LEDGER_HOME=tmpDir` for test isolation so paths.configFile points at a temp dir.
    - Cover all I-01..10 and A-01..10 + C-01..02 tests per <behavior>. I-10 and A-10 specifically verify the canonical schema import — `grep -nE "from '\\.\\./\\.\\./infrastructure/config/schema'" src/cli/commands/init.ts auth.ts` returns matches; `grep -nE 'z\\.object\\(' src/cli/commands/init.ts auth.ts` returns NO matches (no inline schema).

    No `console.*` anywhere in init.ts/auth.ts (use process.stdout.write for output, logger for any debug). The Gate B (console.* outside src/cli/**) already exempts src/cli/, so technically console.* would pass — but stick to process.stdout.write for consistency with doctor.ts.
  </action>
  <verify>
    <automated>npm run test -- --run src/cli/commands/init.test.ts src/cli/commands/auth.test.ts &amp;&amp; bash scripts/ci-grep-gates.sh</automated>
  </verify>
  <acceptance_criteria>
    - `src/cli/commands/init.ts` exists with exports `runInitCommand`, `INIT_EXIT_CODES`, type re-export of `InitConfig`. Grep `grep -cE '^export ' src/cli/commands/init.ts` returns >= 3.
    - `src/cli/commands/auth.ts` exists with exports `runAuthCommand`, `AUTH_EXIT_CODES`. Grep returns >= 2.
    - `src/cli/commands/init.ts` imports the canonical schema: `grep -nE "from '\\.\\./\\.\\./infrastructure/config/schema'" src/cli/commands/init.ts` returns >= 1 match. NO inline schema: `grep -nE 'z\\.object\\(' src/cli/commands/init.ts` returns no matches.
    - `src/cli/commands/auth.ts` imports the canonical schema: `grep -nE "from '\\.\\./\\.\\./infrastructure/config/schema'" src/cli/commands/auth.ts` returns >= 1 match. NO inline schema: `grep -nE 'z\\.object\\(' src/cli/commands/auth.ts` returns no matches.
    - `src/cli/index.ts` registers both subcommands: `grep -nE "\\.command\\('init'\\)" src/cli/index.ts` returns >= 1 match AND `grep -nE "\\.command\\('auth'\\)" src/cli/index.ts` returns >= 1 match.
    - `scripts/ci-grep-gates.sh` Gate C now scopes to `src/cli/commands/**/*.ts` (not just doctor.ts). Grep: `grep -nE 'src/cli/commands' scripts/ci-grep-gates.sh` returns matches that show the broadened scope; the older `doctor.ts`-only pattern is no longer present as a hard-coded exclusion.
    - `bash scripts/ci-grep-gates.sh` exits 0 with the new init.ts and auth.ts present.
    - `npm run test -- --run src/cli/commands/init.test.ts` exits 0 with >= 10 passing tests (including I-10).
    - `npm run test -- --run src/cli/commands/auth.test.ts` exits 0 with >= 10 passing tests (including A-10).
    - `grep -nE 'console\.(log|info|warn|error|debug|trace)' src/cli/commands/init.ts src/cli/commands/auth.ts` returns no matches.
    - `grep -c '^export default' src/cli/commands/init.ts src/cli/commands/auth.ts` returns `0` for each.
    - `npm run build` exits 0 (the new commands compile).
    - `node dist/cli.mjs --help` (after build) lists `init` and `auth` subcommands.
    - `npm run lint` exits 0.
  </acceptance_criteria>
  <done>
    init.ts writes config.json mode 0600 with env-var precedence and idempotency; auth.ts wires runOAuth→tokenStore.write→`Authorization complete.` plus the full AuthError exit-code map; BOTH files import the canonical ConfigSchema from Plan 02-01's schema.ts (DRY-fix); src/cli/index.ts registers both subcommands with help text; Gate C broadened to allow process.stdout.write from any src/cli/commands/*.ts file. 20+ tests green. Build + lint + grep gates clean.
  </done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| user input (CLI prompts, env vars) → init.ts | untrusted; Zod-validated via canonical ConfigSchema (clientId regex, redirectPort positive int) before write |
| readFile(paths.configFile) → auth.ts | file is owned by the user; canonical ConfigSchema re-validates on read (defense against on-disk tampering by another local process) |
| WHOOP_CLIENT_ID / WHOOP_CLIENT_SECRET env vars → auth.ts | env wins per D-06; same canonical ConfigSchema validation applies to env-derived values |
| process.stdout (CLI output) | human-facing; not MCP-reachable; Gate C exemption applies |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-02.05-01 | Information Disclosure | client_secret echoed back in error messages | mitigate | init.ts does NOT echo bad input — ConfigSchema parse failures produce field-name-only remediation (e.g., `clientId must match [A-Za-z0-9._~-]+`). Test I-09 verifies. ASVS V7. |
| T-02.05-02 | Information Disclosure | config.json mode permissive | mitigate | atomic write uses `open(tmp, 'w', 0o600)` (Pattern 2 from Plan 02). Test I-06 asserts stat returns 0o600. configDir gets 0o700 on mkdir. ASVS V8. |
| T-02.05-03 | Tampering | partial config write from crash | mitigate | Same atomic temp-and-rename recipe as token-store.ts: fsync before rename, same-directory. Test I-07 asserts tmp file absent after success. ASVS V8. |
| T-02.05-04 | Information Disclosure | env-var values leaked in logs | mitigate | init.ts and auth.ts do not log env-var values (no `logger` import). process.stdout.write outputs are constants + paths, never secrets. ASVS V7. |
| T-02.05-05 | Tampering | clientId URL injection | mitigate | Canonical `ConfigSchema` regex `/^[A-Za-z0-9._~-]+$/` on clientId in schema.ts (Plan 02-01) AND oauth.ts (Plan 03's buildAuthorizeUrl re-validates). DRY-fix means a single source of truth for the regex — no drift between init.ts and auth.ts. ASVS V5. |
| T-02.05-06 | DoS | hostile redirectPort value (e.g., 65536, -1) | mitigate | Canonical ConfigSchema enforces `z.number().int().positive()`; runOAuth's server.listen will throw on out-of-range ports → caught by auth.ts outer try/catch → exit 1. ASVS V5. |
| T-02.05-07 | Information Disclosure | `Authorization complete.` confirmation accidentally contains token | mitigate | The literal string is a constant — does not interpolate any token field. Test A-01 asserts the exact string is emitted. ASVS V7. |
| T-02.05-08 | Spoofing | malicious config.json planted by another local process | accept | Local-attacker model is out of scope (Threat T-02.03-11 / Threat Patterns §V4). A local attacker who can write to ~/.recovery-ledger/ already owns the process. Canonical ConfigSchema re-validation on read catches malformed files (not malicious-but-valid ones), which is the threat surface we can defend. ASVS V14. |
| T-02.05-09 | Information Disclosure | Gate C broadening allows process.stdout.write in a future hostile file under src/cli/commands/ | mitigate | The grep scope-broadening is per-directory, not whitelist-per-file. ADR-0001 §Decision still scopes the rule to "Code reachable from src/mcp/ ... must never write to stdout" — `src/cli/commands/` is NOT reachable from `src/mcp/` (the CLI command files are not imported by `src/mcp/`). Verified by Plan 05 not touching src/mcp/. ASVS V14. |
| T-02.05-10 | Tampering | DRY drift — init.ts and auth.ts validate different shapes | mitigate | NEW (checker WARNING PLAN-05-DRY-VIOLATION fix): both files import the canonical `ConfigSchema` from `src/infrastructure/config/schema.ts`. Tests I-10 and A-10 verify no inline `z.object({...})` declaration in either file. A future drift attempt would require modifying schema.ts (single source of truth) — both consumers stay in sync. ASVS V5. |
</threat_model>

<verification>
- `src/cli/commands/init.ts` and `src/cli/commands/auth.ts` exist with the expected exports.
- Both files import the canonical `ConfigSchema` from `src/infrastructure/config/schema.ts`; neither file contains an inline `z.object({...})` declaration.
- `src/cli/index.ts` registers both new subcommands.
- `scripts/ci-grep-gates.sh` Gate C scoped to `src/cli/commands/**/*.ts`.
- `bash scripts/ci-grep-gates.sh` exits 0 with the new files present.
- `npm run test -- --run src/cli/commands/init.test.ts src/cli/commands/auth.test.ts` exits 0 with >= 20 tests including the canonical-schema-import tests (I-10 + A-10).
- `npm run build` exits 0 (the new commands compile to dist/).
- `node dist/cli.mjs --help` includes `init` and `auth`.
- `npm run lint` exits 0.
</verification>

<success_criteria>
- AUTH-01 fully implemented end-to-end: `recovery-ledger init` writes config.json mode 0600 with env-var precedence, prints D-02 instructions verbatim, validates via canonical ConfigSchema.
- AUTH-02 fully implemented end-to-end: `recovery-ledger auth` runs runOAuth + tokenStore.write + prints success message, validates config via canonical ConfigSchema.
- AUTH-03 dual-backend reporting: when auth.ts writes via tokenStore.write, the storage-mode cache file is created (verified later by Plan 06's doctor check).
- Gate C broadening allows init.ts/auth.ts to emit user output while preserving ADR-0001 in MCP-reachable layers.
- AuthError exit-code mapping covers all six kinds (auth_missing/expired/state_mismatch/timeout/port_in_use/refresh_failed) with consistent exit code 1.
- DRY-fix (checker WARNING PLAN-05-DRY-VIOLATION): both init.ts and auth.ts import the canonical ConfigSchema from Plan 02-01's schema.ts; no duplicate Zod schema declarations.
</success_criteria>

<output>
After completion, create `.planning/phases/02-oauth-token-store-single-flight-refresh/02-05-SUMMARY.md`.
</output>
