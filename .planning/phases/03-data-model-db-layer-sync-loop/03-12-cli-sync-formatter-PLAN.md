---
phase: 03-data-model-db-layer-sync-loop
plan: 12
type: execute
wave: 5
depends_on: ["03-11"]
files_modified:
  - src/cli/commands/sync.ts
  - src/cli/commands/sync.test.ts
  - src/cli/index.ts
  - src/formatters/sync.txt.ts
  - src/formatters/sync.txt.test.ts
autonomous: true
requirements: [SYNC-01, SYNC-05]
tags: [cli, commander, formatter, sync, no-mcp-tool]
user_setup: []

must_haves:
  truths:
    - "src/cli/commands/sync.ts exports runSyncCommand(opts): ≤5-line shim per CLI policy + ARCHITECTURE.md (no business logic; calls bootstrap() + services.runSync() + formatter)"
    - "Commander program in src/cli/index.ts registers 'sync' subcommand with --days <n>, --since <iso>, --resources <list> flags per D-26"
    - "SYNC_EXIT_CODES per Plan 02-05 precedent: ok=0, partial=0 (per-resource lines flag the issue; partial is not a process failure), failed=1, auth=1"
    - "Formatter src/formatters/sync.txt.ts renders one line per resource + a summary footer; verb-first language; no banned-tone words"
    - "D-33 attestation: NO new MCP tool registered in Phase 3 — sync is a CLI command + services function ONLY; whoop_sync MCP tool lands in Phase 4"
    - "D-34 attestation: src/mcp/sanitize.ts + src/mcp/register.ts UNMODIFIED in this plan (no changes to either file)"
    - "ADR-0001: no console.* in src/cli/commands/sync.ts (Gate B exempts src/cli/**); use process.stdout.write for human-facing output (Gate C exempts src/cli/commands/**/*.ts since Plan 02-05)"
    - "ADR-0001 / Gate B preserved: src/services/sync/ + src/infrastructure/whoop/ remain console-free"
    - "Sanitize errors at the CLI boundary: import sanitize from '../../mcp/sanitize.js' (Plan 02-05 precedent in auth.ts) before writing to stdout"
  artifacts:
    - path: "src/cli/commands/sync.ts"
      provides: "Commander shim — bootstrap() + services.runSync() + formatSyncResult() + process.exit"
      contains: "runSyncCommand"
    - path: "src/cli/index.ts"
      provides: "Extended Commander program with 'sync' subcommand (alongside init, auth, doctor)"
      contains: "program.command('sync')"
    - path: "src/formatters/sync.txt.ts"
      provides: "Structured RunSyncResult → compact text for CLI exit"
      contains: "formatSyncResult"
  key_links:
    - from: "src/cli/commands/sync.ts"
      to: "src/services/index.ts bootstrap"
      via: "named import"
      pattern: "import { bootstrap }"
    - from: "src/cli/commands/sync.ts"
      to: "src/formatters/sync.txt.ts formatSyncResult"
      via: "named import"
      pattern: "from.*formatters/sync"
    - from: "src/mcp/register.ts"
      to: "(no change)"
      via: "D-33 + D-34 attestation"
      pattern: "registerTool"
---

<objective>
Land the `recovery-ledger sync` Commander subcommand and the structured-to-text formatter. The CLI shim is ≤ 5 lines of orchestration over `bootstrap() → services.runSync() → formatSyncResult() → exit(code)`. NO new MCP tool — D-33 attestation continues. The sync surface is reachable via CLI only in Phase 3; Phase 4 will add a 5-line MCP shim against the same service.

Purpose: Phase 3's payoff at the user-facing layer. The CLI shim plus the formatter convert structured RunSyncResult to actionable per-resource lines + exit codes. The plan also extends src/cli/index.ts to register the subcommand alongside init / auth / doctor (Plans 02-05 / 01-05).

Output: 2 source files + 2 test files + 1 modification to src/cli/index.ts.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/PROJECT.md
@.planning/phases/03-data-model-db-layer-sync-loop/03-CONTEXT.md
@.planning/phases/03-data-model-db-layer-sync-loop/03-RESEARCH.md
@.planning/phases/03-data-model-db-layer-sync-loop/03-PATTERNS.md
@agent_docs/decisions/0001-mcp-stdout-purity.md
@agent_docs/conventions.md
@src/services/index.ts
@src/services/sync/index.ts
@src/services/bootstrap.ts
@src/cli/index.ts
@src/cli/commands/auth.ts
@src/cli/commands/doctor.ts
@src/mcp/sanitize.ts
@src/mcp/register.ts
@src/domain/types/sync.ts

<interfaces>
CLI subcommand surface (D-26):
  Usage: recovery-ledger sync [options]
  Options:
    --days <n>            Window size in days (default 30 per SYNC-01)
    --since <iso>         Override --days with explicit ISO 8601 start (backfill mode)
    --resources <list>    Comma-separated subset: cycles,recoveries,sleeps,workouts,profile,body_measurements
    -h, --help            Show help with exit codes

Exit codes (mirror Plan 02-05 AUTH_EXIT_CODES pattern):
  0  ok or partial (partial is informational; per-resource lines flag issues)
  1  failed (whole sync errored; no resources succeeded)

Formatter output shape:
  Status: ok | partial | failed
  cycles            success     fetched=42 upserted=42 dur=120ms
  recoveries        success     fetched=42 upserted=42 dur=180ms
  sleeps            success     fetched=14 upserted=14 dur=90ms
  workouts          partial_429 fetched=10 upserted=10 errors=0 dur=2400ms
  profile           success     fetched=1  upserted=1  dur=50ms
  body_measurements success     fetched=1  upserted=0  dur=40ms     (no change)
  --
  syncRunId: 17  gapsDetected: 0
</interfaces>
</context>

<tasks>

<task type="auto">
  <name>Task 1: Implement src/cli/commands/sync.ts + extend src/cli/index.ts</name>
  <files>src/cli/commands/sync.ts, src/cli/commands/sync.test.ts, src/cli/index.ts</files>
  <read_first>
    - .planning/phases/03-data-model-db-layer-sync-loop/03-CONTEXT.md decisions D-26 (CLI flags: --days N default 30, --since ISO, --resources list), D-33 (zero new MCP tools; whoop_sync lands Phase 4), D-34 (sanitize.ts/register.ts UNMODIFIED)
    - .planning/phases/03-data-model-db-layer-sync-loop/03-RESEARCH.md §Configuration knobs lines 96-101 (only 3 sync flags), §System Architecture Diagram lines 156-160 (CLI shim shape)
    - .planning/phases/03-data-model-db-layer-sync-loop/03-PATTERNS.md §E1 lines 1063-1119 (sync.ts shim shape + auth.ts analog)
    - src/cli/commands/auth.ts (Plan 02-05 — canonical ≤5-line shim shape, AUTH_EXIT_CODES, isAuthError catch arm, sanitize import)
    - src/cli/index.ts (existing Commander program — Plan 02-05 registers init + auth + Plan 01-05 registers doctor)
    - src/services/index.ts (Plan 03-11 — extends Services with runSync; export bootstrap)
    - src/services/bootstrap.ts (Plan 03-11 — composition root)
    - src/mcp/sanitize.ts (D-34: UNMODIFIED in Phase 3; import for CLI-side error sanitization)
    - src/domain/types/sync.ts (Plan 03-04 — RunSyncInput, ResourceName, RESOURCE_NAMES_SET for --resources parsing)
  </read_first>
  <action>
    Create `src/cli/commands/sync.ts`. Leading comment cites D-26 + D-33 + D-34 + ARCHITECTURE.md "≤5-line shim". Use the "console calls" / "direct stdout writes" phrasing in any doc comment per the learnings.

    Imports:
      - `import { bootstrap } from '../../services/index.js'` (Plan 03-11 re-export)
      - `import { formatSyncResult } from '../../formatters/sync.txt.js'` (Task 2)
      - `import { sanitize } from '../../mcp/sanitize.js'` — D-34 attestation: imported FROM but NOT modified
      - `import { isAuthError, formatAuthError } from '../../infrastructure/whoop/errors.js'` (Plan 02-01 surface + Plan 02-05 precedent)
      - `import { isWhoopApiError, formatWhoopApiError } from '../../infrastructure/whoop/errors.js'` (Plan 03-01 surface)
      - `import { RESOURCE_NAMES_SET } from '../../domain/types/sync.js'` (Plan 03-04 — for --resources parsing validation)
      - `import type { ResourceName } from '../../domain/types/sync.js'`

    Export SYNC_EXIT_CODES (mirror Plan 02-05 AUTH_EXIT_CODES Object.freeze pattern):
      ```typescript
      export const SYNC_EXIT_CODES = Object.freeze({
        ok: 0,
        partial: 0,           // partial is a soft success — per-resource lines surface the issue
        failed: 1,            // hard sync failure
        invalid_input: 1,     // bad --resources name or unparseable --since
        bootstrap_failed: 1,  // openDb / migrate threw
      });
      ```

    Export `RunSyncCommandOpts` interface: `{days?: number; since?: string; resources?: string;}` (the Commander option type before parsing).

    Export `runSyncCommand(opts: RunSyncCommandOpts): Promise<void>`:
      1. Validate --resources if provided: parse `opts.resources?.split(',').map(s => s.trim())` into a ResourceName[]; if any token is not in RESOURCE_NAMES_SET, write a sanitized error to stdout and process.exit(SYNC_EXIT_CODES.invalid_input). Otherwise pass as input.resources.
      2. Validate --since if provided: try `new Date(opts.since)` — if Number.isNaN(date.getTime()), error + exit invalid_input.
      3. Bootstrap: `let app: Bootstrapped | null = null; try { app = bootstrap(); } catch (err) { process.stdout.write(formatBootstrapError(err) + '\\n'); process.exit(SYNC_EXIT_CODES.bootstrap_failed); }`. If bootstrap throws MigrationError, the formatter should include the `cp <backupPath>` remediation per D-08.
      4. Run: `let result; try { result = await app.services.runSync({days: opts.days ?? 30, since: opts.since, resources: parsedResources}); } catch (err) { const sanitized = sanitize(err); ... write + exit failed; }`. Use `isAuthError` / `isWhoopApiError` arms for type-safe error formatting; sanitize() handles unknown error shapes.
      5. Format + write: `process.stdout.write(formatSyncResult(result) + '\\n', () => { app.close(); process.exit(SYNC_EXIT_CODES[result.status]); });`. The async write callback ensures the buffer flushes before process.exit. Plan 01-06 establishes this pattern for stdout-flush before exit.
      6. Exit codes map: result.status === 'ok' → 0; 'partial' → 0; 'failed' → 1.

    The shim is ≤ ~30 lines of TypeScript (the ≤5-line policy refers to the orchestration logic INSIDE the shim, not the file's total LOC including imports + error handling — Plan 02-05 auth.ts is ~130 LOC but its core composition is 5 lines).

    Use `process.stdout.write` for human-facing output (Gate C exempts src/cli/commands/**/*.ts since Plan 02-05). No `console.*` (Gate B).

    Extend `src/cli/index.ts`:
      - Existing program has `init`, `auth`, `doctor` subcommands.
      - Add:
        ```typescript
        program
          .command('sync')
          .description('Sync WHOOP data into the local cache.')
          .option('--days <n>', 'Window in days (default 30)', parseIntStrict, 30)
          .option('--since <iso>', 'Backfill from this ISO 8601 date (overrides --days)')
          .option('--resources <list>', 'Comma-separated subset of: cycles,recoveries,sleeps,workouts,profile,body_measurements')
          .addHelpText('after', `\nExit codes:\n  0  sync ok (or partial — see per-resource lines)\n  1  sync failed / invalid input / bootstrap error\n\nExamples:\n  recovery-ledger sync\n  recovery-ledger sync --days 7\n  recovery-ledger sync --resources cycles,recoveries\n`)
          .action(runSyncCommand);
        ```
      - Define `parseIntStrict(value, _prev): number` helper that uses `Number.parseInt(value, 10)` and throws Commander's `InvalidArgumentError` on NaN.

    Create `src/cli/commands/sync.test.ts`:
      - Mock `bootstrap()` to return a fake services object with a fake runSync that resolves to a deterministic RunSyncResult.
      - Mock `process.stdout.write` and `process.exit` via vi.spyOn.
      - Test 1: runSyncCommand({days: 30}) — calls services.runSync once with {days: 30}, writes formatted output, exits 0.
      - Test 2: runSyncCommand({days: 7}) — passes 7 through to runSync.
      - Test 3: runSyncCommand({since: '2026-01-01T00:00:00.000Z'}) — passes since through; days defaults are irrelevant when since is set (computeWindow in Plan 03-04 prioritizes since).
      - Test 4: runSyncCommand({resources: 'cycles,recoveries'}) — parsed into ['cycles', 'recoveries']; passes through.
      - Test 5: runSyncCommand({resources: 'invalid,cycles'}) — exits with SYNC_EXIT_CODES.invalid_input; stdout contains a sanitized error message.
      - Test 6: runSyncCommand({since: 'not-a-date'}) — exits with invalid_input.
      - Test 7: result.status === 'partial' → exit code 0 (soft success).
      - Test 8: result.status === 'failed' → exit code 1.
      - Test 9: bootstrap throws MigrationError({kind: 'inconsistent_state', backupPath: '/foo/backups/db.X.sqlite'}) — error message via formatBootstrapError or sanitize contains the backup path and the "cp" remediation hint per D-08. Exit code 1.
      - Test 10: services.runSync throws AuthError({kind: 'auth_expired'}) — caught arm calls formatAuthError; sanitized; exit code 1.
      - Test 11: Commander wiring — programmatically invoke `program.parseAsync(['node', 'recovery-ledger', 'sync', '--days', '7'])`; verify runSyncCommand was called with `{days: 7}`. Use vi.mock to spy.
      - Test 12: --help text mentions --days, --since, --resources, and exit codes 0 / 1.

    D-34 attestation: src/mcp/sanitize.ts and src/mcp/register.ts are NEVER touched in this plan. The Wave 6 close plan locks this via `git diff` smoke.
  </action>
  <verify>
    <automated>npm run test -- src/cli/commands/sync.test.ts</automated>
  </verify>
  <acceptance_criteria>
    - grep -c "SYNC_EXIT_CODES" src/cli/commands/sync.ts returns at least 2 (export + uses)
    - grep -c "import { bootstrap }" src/cli/commands/sync.ts returns 1 (D-33 attestation: sync is CLI-only; bootstrap is the composition root)
    - grep -c "import { sanitize }" src/cli/commands/sync.ts returns 1 (D-34 import-but-do-not-modify)
    - grep -c "RESOURCE_NAMES_SET" src/cli/commands/sync.ts returns at least 1 (validates --resources tokens)
    - grep -cE "program\\.command\\(['\"]sync['\"]\\)" src/cli/index.ts returns 1 (sync subcommand registered)
    - grep -cE "--days|--since|--resources" src/cli/index.ts returns at least 3 (all three D-26 flags registered)
    - grep -c "process.stdout.write" src/cli/commands/sync.ts returns at least 1 (Gate C exempts src/cli/commands/**/*.ts)
    - grep -v '^\s*//' src/cli/commands/sync.ts | grep -v '^\s*\*' | grep -c "console\\." returns 0 (Gate B)
    - D-34 attestation runtime test: git diff --name-only origin/main src/mcp/sanitize.ts src/mcp/register.ts returns empty (zero lines)
    - npm run test -- src/cli/commands/sync.test.ts shows at least 12 assertions passing
    - bash scripts/ci-grep-gates.sh exits 0
    - npm run lint exits 0; npx tsc --noEmit exits 0
  </acceptance_criteria>
  <done>recovery-ledger sync subcommand wired into Commander program; ≤5-line orchestration shim around bootstrap + services.runSync + formatSyncResult; D-33 + D-34 attestation preserved.</done>
</task>

<task type="auto">
  <name>Task 2: Implement src/formatters/sync.txt.ts + banned-tone-lint-safe text rendering</name>
  <files>src/formatters/sync.txt.ts, src/formatters/sync.txt.test.ts</files>
  <read_first>
    - .planning/phases/03-data-model-db-layer-sync-loop/03-PATTERNS.md §E2 lines 1123-1146 (formatter contract)
    - src/services/doctor/checks/* (Plan 01-05 — formatter precedent; src/services/doctor/index.ts has a similar status-result shape)
    - src/cli/commands/doctor.ts (Plan 01-05 — DoctorResult → text rendering)
    - .planning/research/REQUIREMENTS.md REV-08 (banned-tone-word CI lint — Phase 4 cross-cut; Phase 3 formatters MUST already pass)
    - scripts/ci-grep-gates.sh Gate A (banned tone words; verify the list)
    - agent_docs/decisions/0005-banned-tone-words.md (the canonical list)
    - src/domain/types/sync.ts (RunSyncResult shape from Plan 03-04)
    - agent_docs/conventions.md §Code style (verb-first, no banned tone words)
  </read_first>
  <action>
    Create `src/formatters/sync.txt.ts`. Leading comment cites E2 + REV-08 + ADR-0005.

    Imports: `import type { RunSyncResult, ResourceName, ResourceSyncOutcome, ResourceSyncStatus } from '../domain/types/sync.js'`.

    Export `formatSyncResult(result: RunSyncResult): string`:
      - Renders one header line with overall status (`Status: ok` / `Status: partial` / `Status: failed`).
      - Renders one line per resource in the order from `result.perResource` keys. For each resource:
        - Resource name left-aligned to 20 columns: `resource.padEnd(20)`.
        - Status code: `outcome.status.padEnd(15)`.
        - Counts: `fetched=N upserted=N` where N defaults to 0 if undefined.
        - Optional `errors=N` if outcome.errors > 0.
        - Optional `dur=Nms` if outcome.durationMs is set.
      - Renders a separator: `--`.
      - Renders summary footer: `syncRunId: N  gapsDetected: N`.
      - No banned tone words (per ADR-0005 list — these are auto-checked by Gate A on the formatter output via Phase 4 banned-word CI lint, but the formatter must already be clean): no `optimize`, `wellness`, `honor`, `journey`, `crush`, `nail`, `dial in`, `tune`, `vibe`, `unlock`, emoji.
      - Verb-first language only where natural — descriptive lines like `cycles success fetched=42` are fine; the per-action recommendation lines (Phase 4 review formatters) are where verb-first matters most.
      - Optional Phase 3 affordance: if `outcome.status === 'partial_429'`, append `(rate-limited; retried)` clue. If `partial_5xx`, append `(server error; retried)`. If `failed_auth`, append `(run \`recovery-ledger auth\`)`. These are remediation hints, not coach-y prose.

    Export `formatBootstrapError(err: unknown): string`:
      - If isMigrationError(err): return a multi-line message including the backup path + the `cp <backupPath> ~/.recovery-ledger/db.sqlite` remediation per D-08.
      - If isAuthError(err): use the existing formatAuthError helper.
      - Else: return a sanitized error message (call sanitize() if available; here sanitize is imported in sync.ts not the formatter, so formatBootstrapError takes err and returns a string with err.message — sanitize() is called at the caller).
      - Add helper-export decisions to the leading comment; do NOT inline `sanitize()` into the formatter (keeps formatter pure).

    Pure function — no logger, no DB, no I/O. Array-literal-testable per conventions.md.

    Create `src/formatters/sync.txt.test.ts`:
      - Test 1: ok status — input has all 6 resources with status='success'; formatSyncResult returns a string starting with `Status: ok\n` and containing 6 resource lines + `syncRunId:` footer.
      - Test 2: partial status — input has cycles success + workouts partial_429; output `Status: partial` + workouts line contains `partial_429` AND `(rate-limited; retried)`.
      - Test 3: failed status — input has all resources failed; output `Status: failed`.
      - Test 4: missing optional fields — outcome with no durationMs → output line does NOT contain `dur=`.
      - Test 5: zero counts — outcome with fetched=0 upserted=0 → output contains `fetched=0 upserted=0`.
      - Test 6: alignment — resource name `body_measurements` (16 chars) is padded to 20; status code `partial_429` (11 chars) padded to 15.
      - Test 7: banned-tone-word check on formatSyncResult output — for each banned word in `['optimize', 'wellness', 'honor', 'journey', 'crush', 'nail', 'dial in', 'tune', 'vibe', 'unlock']`, assert `output.toLowerCase().includes(word) === false`. Iterate via test.each. Future-proofs against accidental drift.
      - Test 8: formatBootstrapError(MigrationError) — output contains the backupPath AND the literal `cp ` substring AND the `~/.recovery-ledger/db.sqlite` destination.
      - Test 9: formatBootstrapError(AuthError) — output contains the kind + the existing formatAuthError prose.
      - Test 10: pure function — `formatSyncResult(r) === formatSyncResult(r)` (identical output across calls; no internal state).

    No console.* anywhere in the formatter or its tests. The formatter is pure; the test asserts string outputs.
  </action>
  <verify>
    <automated>npm run test -- src/formatters/sync.txt.test.ts</automated>
  </verify>
  <acceptance_criteria>
    - grep -c "formatSyncResult" src/formatters/sync.txt.ts returns at least 2 (export + usage)
    - grep -c "formatBootstrapError" src/formatters/sync.txt.ts returns at least 1
    - npm run test -- src/formatters/sync.txt.test.ts shows at least 10 assertions passing
    - test 7 (banned-tone-word check) passes — the formatter output is free of all banned words from ADR-0005
    - test 8 — MigrationError formatter contains `cp ` AND the destination path (D-08 user-initiated remediation)
    - grep -v '^\s*//' src/formatters/sync.txt.ts | grep -v '^\s*\*' | grep -c "console\\." returns 0
    - grep -rE "from ['\"]drizzle-orm" src/formatters/ returns 0 (Gate G — formatters never touch the DB layer)
    - bash scripts/ci-grep-gates.sh exits 0 (including Gate A banned-tone enforcement)
    - npm run lint exits 0; npx tsc --noEmit exits 0
  </acceptance_criteria>
  <done>formatSyncResult + formatBootstrapError shipped; banned-tone-word-clean per ADR-0005; locks D-08 remediation surface for migrator failures; pure functions array-literal-testable.</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| CLI flags → runSyncCommand validation | --resources / --since validated before bootstrap; invalid input fails fast with exit 1 |
| Uncaught error → sanitize() → stdout | The CLI sanitizer at the boundary catches any error that escapes services.runSync (D-34 attestation: sanitize.ts UNMODIFIED) |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-03.12-01 | Information disclosure | Uncaught error containing Bearer token written to stdout | mitigate | sanitize() called at the catch arm (Plan 02-05 precedent); D-34 attestation means existing patterns cover Bearer/JWT/Authorization/code=/client_secret/oauth_url shapes. |
| T-03.12-02 | Tampering | --resources accepts unknown resource name → runtime error | mitigate | RESOURCE_NAMES_SET validates at the CLI boundary; runSyncCommand exits invalid_input before bootstrap is called. |
| T-03.12-03 | Tampering | --since accepts garbage string → WHOOP HTTP 400 | mitigate | Date.parse validation at the CLI boundary catches NaN; exits invalid_input before any HTTP. |
| T-03.12-04 | Repudiation | A sync run completes successfully but the user sees a failed exit | mitigate | SYNC_EXIT_CODES.partial === 0 — partial is soft success; per-resource lines surface the issue. Tests 7 + 8 lock the mapping. |
| T-03.12-05 | Tampering | A banned tone word slips into the formatter output | mitigate | formatter test 7 iterates the full ADR-0005 list; Phase 4 banned-word CI lint cross-cuts here. |
| T-03.12-06 | Information disclosure | MigrationError exposes the backup path which could be an arbitrary filesystem location | accept | The backup path resolves under ~/.recovery-ledger/backups/ (Plan 03-05 helper); the user owns the directory; chmod 600 keeps other users out. D-08 by design surfaces the path to the user for remediation. |
</threat_model>

<verification>
- npm run test -- src/cli/commands/sync.test.ts src/formatters/sync.txt.test.ts all ≥ 22 assertions green
- bash scripts/ci-grep-gates.sh all 7 gates green
- npm run lint 0 errors
- npx tsc --noEmit 0 errors
- D-34 attestation: git diff origin/main src/mcp/sanitize.ts src/mcp/register.ts returns empty
- D-33 attestation: grep -rEn "server\\.registerTool" src/mcp/register.ts returns exactly 1 line (whoop_doctor from Plan 01-03)
</verification>

<success_criteria>
- recovery-ledger sync subcommand registered in Commander with --days / --since / --resources per D-26
- 5-line orchestration shim: bootstrap → runSync → formatSyncResult → stdout → exit(code)
- Sanitizer-at-boundary catch arm mirrors Plan 02-05 auth.ts precedent
- SYNC_EXIT_CODES: ok=0, partial=0, failed=1, invalid_input=1, bootstrap_failed=1
- Formatter renders structured RunSyncResult → compact text; one line per resource + summary footer; banned-tone-word-clean
- D-33 attestation: zero new MCP tools; sync is CLI + service-fn only
- D-34 attestation: sanitize.ts + register.ts UNMODIFIED across Phase 3
- Plan 02-08 G-03 runtime attestation (tools.length === 1) remains green
</success_criteria>

<output>
Create .planning/phases/03-data-model-db-layer-sync-loop/03-12-SUMMARY.md when done.
</output>
