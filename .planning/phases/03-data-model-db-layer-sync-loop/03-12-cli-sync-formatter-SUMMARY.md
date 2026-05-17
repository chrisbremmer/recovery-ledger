---
phase: 03-data-model-db-layer-sync-loop
plan: 12
subsystem: cli-sync-formatter
tags: [cli, commander, formatter, sync, no-mcp-tool, d-26, d-33, d-34, sync-01, sync-05]

# Dependency graph
requires:
  - phase: 03-data-model-db-layer-sync-loop (Wave 1a)
    provides: D-26 CLI flag surface + RESOURCE_NAMES_SET (Plan 03-04)
  - phase: 03-data-model-db-layer-sync-loop (Wave 2b)
    provides: MigrationError + D-08 backup-path remediation surface (Plan 03-05)
  - phase: 03-data-model-db-layer-sync-loop (Wave 5b)
    provides: bootstrap() composition root + services.runSync (Plan 03-11)
  - phase: 02-oauth-token-store-single-flight-refresh (Wave 5)
    provides: AuthError + formatAuthError + sanitize at the CLI boundary (Plan 02-05 auth.ts analog)
  - phase: 03-data-model-db-layer-sync-loop (Wave 0)
    provides: WhoopApiError union + formatWhoopApiError (Plan 03-01)
provides:
  - src/cli/commands/sync.ts — ≤5-line orchestration shim (bootstrap → runSync → formatSyncResult → stdout → exit)
  - src/cli/commands/sync.test.ts — 15 tests covering exit-code mapping + happy paths + input validation + bootstrap failure + service failure + Commander wiring
  - src/formatters/sync.txt.ts — pure-function formatter for RunSyncResult + MigrationError
  - src/formatters/sync.txt.test.ts — 10 tests covering header/lines/footer + suffix + alignment + ADR-0005 + purity
  - src/cli/index.ts (extended) — buildProgram(): Command helper + sync subcommand registration; parseIntStrict; gated top-level parseAsync
affects: [Phase 04 (whoop_sync MCP tool — 5-line shim against the same services.runSync; reuses formatSyncResult verbatim for content[0].text)]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Pattern (Plan 03-12 §1): buildProgram(): Command export pattern — Commander program construction extracted into a pure factory so unit tests can drive parseAsync() with synthetic argv. Top-level parseAsync is gated by an entry-point check (import.meta.url === pathToFileURL(process.argv[1]).href) so importing buildProgram from tests does not fire the parseAsync."
    - "Pattern (Plan 03-12 §2): ≤5-line shim over services — CLI commands are flat `validate → bootstrap → call service → format → write → exit` chains. Each step has its own typed-error catch arm; sanitize() applies at the boundary for unknown error shapes (Plan 02-05 auth.ts analog)."
    - "Pattern (Plan 03-12 §3): pure formatter as the CLI-MCP reuse seam — formatSyncResult is a pure function with no I/O; the caller decides where the string lands (CLI: process.stdout.write; future Phase 4 MCP: content[0].text). ADR-0001 stays clean across both transports."
    - "Pattern (Plan 03-12 §4): partial-as-soft-success exit-code mapping — SYNC_EXIT_CODES.partial === 0 mirrors Plan 02-05 AUTH_EXIT_CODES; per-resource lines surface the issue; cron wrappers do not page on routine WHOOP 429 backoff (T-03.12-04)."
    - "Pattern (Plan 03-12 §5): local duck-type guard for cross-layer error shapes — the formatter defines its own isMigrationErrorShape() rather than importing isMigrationError from the migrator module, so the formatter stays free of infrastructure dependencies."

key-files:
  created:
    - src/cli/commands/sync.ts (196 LOC)
    - src/cli/commands/sync.test.ts (337 LOC)
    - src/formatters/sync.txt.ts (178 LOC)
    - src/formatters/sync.txt.test.ts (217 LOC)
  modified:
    - src/cli/index.ts (extracted buildProgram(): Command + parseIntStrict; added sync subcommand wiring + gated top-level parseAsync)

key-decisions:
  - "buildProgram() factory + entry-point gate — refactored src/cli/index.ts to expose Commander construction as an exported helper. The top-level `await buildProgram().parseAsync(process.argv)` runs ONLY when this module is the process entry (import.meta.url === pathToFileURL(process.argv[1]).href). This is what makes Test 11 (Commander wiring) possible without process-level side effects under vitest."
  - "Local duck-type guard for MigrationError inside the formatter — formatBootstrapError defines its own isMigrationErrorShape() rather than importing from src/infrastructure/db/migrate.js. Keeps the formatter's import graph free of infrastructure dependencies. The guard mirrors the canonical isMigrationError() in migrate.ts (same `name === 'MigrationError'` + kind-membership check) and is type-pinned to `err is MigrationError` via the imported type-only `MigrationError`."
  - "Sanitization at the CLI boundary, not in the formatter — formatBootstrapError takes raw err.message verbatim (no sanitize call inside). sync.ts wraps unknown error paths with sanitize() before invoking the formatter. This keeps the formatter pure (testable without sanitize as a dependency); the caller owns the secret-redaction contract."
  - "parseIntStrict for --days — Commander's default parser is `Number.parseInt`-tolerant of NaN; surfaces silently. Replaced with a strict variant that throws InvalidArgumentError, so a `--days abc` call fails fast with a Commander error rather than silently passing `NaN` through to the action handler (which would route to `days: NaN` in the input shape, leaking through computeWindow downstream)."
  - "Partial-as-zero exit-code mapping — SYNC_EXIT_CODES.partial === 0 mirrors Plan 02-05 AUTH_EXIT_CODES.success === 0. A partial sync is a SOFT success: per-resource lines flag the issue. Mapping partial → 1 would page cron on routine WHOOP 429 backoff (rate-limit retry is informational, not a process failure). T-03.12-04 in the plan's threat register pinned this contract; sync.test.ts Test 7 locks it at runtime."
  - "Test 11 uses configureOutput to capture --help text — Commander's `helpInformation()` returns the Commander-built usage + options block but does NOT include `addHelpText('after', ...)`; that text is emitted via the `afterAll`/`after` event handlers and only surfaces through `outputHelp()`. The test patches `configureOutput` to redirect writeOut/writeErr into a string buffer so the after-help (exit-code table + examples) can be asserted without writing to real stdout."

patterns-established:
  - "Pattern (Plan 03-12 §1): pure-function formatter as the CLI-MCP reuse seam — formatSyncResult lives in src/formatters/ and takes RunSyncResult → string with NO I/O. Phase 4 whoop_sync MCP tool will consume the same function for content[0].text."
  - "Pattern (Plan 03-12 §2): buildProgram(): Command export — the Commander construction sits in a pure factory so unit tests can drive parseAsync() with synthetic argv. The top-level parseAsync is entry-point-gated."
  - "Pattern (Plan 03-12 §3): partial-as-soft-success exit-code mapping — SYNC_EXIT_CODES.partial === 0. Future review/decision CLI commands inherit the same shape (verbatim copy of the Object.freeze block)."

requirements-completed: [SYNC-01, SYNC-05]

# Metrics
duration: 25min
completed: 2026-05-16
---

# Phase 3 Plan 12: CLI Sync Subcommand + Formatter Summary

**Recovery Ledger sync ships at the user-facing layer. recovery-ledger sync wired into Commander with the three D-26 flags (--days N default 30, --since ISO, --resources subset); ≤5-line orchestration shim over bootstrap → runSync → formatSyncResult → stdout → exit. NO new MCP tool — D-33 + D-34 attestation continues (sanitize.ts + register.ts UNMODIFIED across Phase 3). 25 new tests green; full suite 549/549.**

## What landed

**Task 1 — CLI shim + Commander wiring (commit `94539bb`)**

`src/cli/commands/sync.ts` is the canonical ≤5-line orchestration over the Plan 03-11 composition root. The core composition is the 5-line chain `validate → bootstrap → services.runSync → formatSyncResult → process.stdout.write + process.exit`. File weight (~196 LOC) lives in the validation + sanitization catch arms, mirroring Plan 02-05 auth.ts's ~150 LOC.

Three runtime-validated inputs:
- **`--resources`** is parsed via `parseResourcesFlag`, which splits on `,`, trims whitespace, and rejects any token not in `RESOURCE_NAMES_SET` (T-03.12-02). Rejected with `SYNC_EXIT_CODES.invalid_input` (1) + a sanitized stdout message.
- **`--since`** is parsed via `parseSinceFlag` using `new Date()` + `Number.isNaN(getTime())` (T-03.12-03). Rejected with the same exit code.
- **`--days`** defaults to 30 inside `runSyncCommand` (`opts.days ?? 30`) but ALSO at the Commander layer via `.option('--days <n>', '...', parseIntStrict, 30)`. The Commander parser uses a new `parseIntStrict` helper that throws `InvalidArgumentError` on NaN so `--days abc` fails fast with a Commander error rather than silently passing NaN through.

Bootstrap arm catches `MigrationError` and routes it through `formatBootstrapError` for the D-08 `cp <backupPath> <dbFile>` remediation. Unknown bootstrap failures flow through `sanitize(String(err))`.

Sync arm has three branches: `isAuthError` → `formatAuthError`; `isWhoopApiError` → `formatWhoopApiError`; otherwise `sanitize(String(err))`. T-03.12-01: any Bearer / JWT / token pattern in the unknown error's message is redacted before stdout.

Exit codes are frozen (`Object.freeze`) per the Plan 02-05 `AUTH_EXIT_CODES` precedent:
- `ok` = 0
- `partial` = 0 (SOFT success — per-resource lines flag the issue; T-03.12-04)
- `failed` = 1
- `invalid_input` = 1
- `bootstrap_failed` = 1

`src/cli/index.ts` was extended to:
1. Extract Commander wiring into a `buildProgram(): Command` exported helper. Tests construct fresh program instances without process-level side effects.
2. Add a `parseIntStrict(value, _prev): number` helper that rejects NaN via `InvalidArgumentError`.
3. Register the `sync` subcommand with the three D-26 flags + an `addHelpText('after', ...)` block listing exit codes and 3 examples.
4. Gate the top-level `await buildProgram().parseAsync(process.argv)` behind an entry-point check (`import.meta.url === pathToFileURL(process.argv[1]).href`) so importing `buildProgram` from a test does NOT fire the parseAsync.

`src/cli/commands/sync.test.ts` ships 15 tests across 5 describe blocks:
- **SYNC_EXIT_CODES** (3 tests): map is frozen; partial === 0 (soft success); failed/invalid_input/bootstrap_failed all === 1.
- **Happy paths** (4 tests): `{days: 30}` calls runSync with days=30 + exits 0; `{days: 7}` passes through; `{since: ISO}` passes through (days defaults to 30); `{resources: 'cycles,recoveries'}` parses to the array.
- **Input validation** (2 tests): `{resources: 'invalid,cycles'}` exits invalid_input + stdout contains "invalid"; `{since: 'not-a-date'}` exits invalid_input + stdout mentions "iso".
- **Result mapping** (2 tests): `result.status === 'partial'` → exit 0; `'failed'` → exit 1.
- **Failure paths** (2 tests): bootstrap throws `MigrationError({inconsistent_state, backupPath, latestSafeMigration})` → exit 1 + stdout contains `cp ` + the backupPath; runSync throws `AuthError({auth_expired})` → exit 1 + stdout contains "recovery-ledger auth".
- **Commander wiring** (2 tests): `buildProgram().parseAsync(['node', 'recovery-ledger', 'sync', '--days', '7'])` drives the action handler with `{days: 7}`; `sync --help` (captured via `configureOutput`) contains `--days`, `--since`, `--resources`, `Exit codes`, `0  ok`, `1  failed`.

**Task 2 — Formatter (commit `e864f6d`)**

`src/formatters/sync.txt.ts` is a pure function — no I/O, no logger, no DB. Two exports:

- **`formatSyncResult(result: RunSyncResult): string`** renders:
  ```
  Status: ok|partial|failed
  profile              success        fetched=1 upserted=1 dur=10ms
  body_measurements    success        fetched=1 upserted=1 dur=8ms
  cycles               success        fetched=42 upserted=42 dur=120ms
  recoveries           success        fetched=42 upserted=42 dur=180ms
  sleeps               success        fetched=14 upserted=14 dur=90ms
  workouts             partial_429    fetched=10 upserted=10 dur=2400ms (rate-limited; retried)
  --
  syncRunId: 17  gapsDetected: 0
  ```
  Resource names pad to 20 cols (`body_measurements` is 16 chars, the widest); status codes pad to 15 cols (`partial_429` is 11 chars). Per-status remediation suffix is an exhaustive switch on `ResourceSyncStatus` — `partial_429` → "(rate-limited; retried)", `partial_5xx` → "(server error; retried)", `failed_auth` → "(run \`recovery-ledger auth\`)", `failed_network` → "(check network and re-run)", `success`/`skipped` add nothing.

- **`formatBootstrapError(err: unknown, dbFile: string): string`** has three arms:
  1. `MigrationError({inconsistent_state | apply_failed, backupPath, latestSafeMigration})` → multi-line message with the D-08 `cp <backupPath> <dbFile>` remediation. Closes with "Recovery Ledger does not auto-restore — the decisions ledger is irreplaceable."
  2. `AuthError` → defers to existing `formatAuthError(err)`.
  3. Unknown error shape → returns the bare err.message; the CLI caller already runs sanitize() at the boundary.

The MigrationError check uses a local `isMigrationErrorShape(err): err is MigrationError` duck-type guard rather than importing `isMigrationError` from `src/infrastructure/db/migrate.js` — keeps the formatter's import graph free of infrastructure runtime dependencies (type-only `MigrationError` import is fine).

`src/formatters/sync.txt.test.ts` ships 10 tests across 3 describe blocks:
- **formatSyncResult** (7 tests): ok-status header + 6 lines + footer; partial_429 suffix; failed status surfaces re-auth hint; `dur=` omitted when undefined; zero counts render `fetched=0 upserted=0`; padding alignment for `body_measurements` (20 cols) + `partial_429` (15 cols); banned-tone-word iteration (10 words, all absent).
- **formatBootstrapError** (2 tests): MigrationError surfaces `cp ` + backupPath + dbFile + "does not auto-restore"; AuthError defers to formatAuthError prose.
- **Purity** (1 test): identical input → identical output across two calls.

## Verification

- `npm test` — 52 files, 549 tests passing (was 524 baseline + 25 new = 549).
- `npm run lint` — 0 errors, 1 pre-existing info-level hint on `src/infrastructure/whoop/resources/recovery.ts` (not introduced here; deferred).
- `bash scripts/ci-grep-gates.sh` — All 7 gates passed.
- `npm run build` — Build success; `dist/cli.mjs` produced (119 KB).
- `node dist/cli.mjs sync --help` — Returns full help block including `--days`, `--since`, `--resources`, exit codes, examples.
- `git diff origin/main --stat src/mcp/sanitize.ts src/mcp/register.ts` — Empty (D-34 attestation).
- `grep -rEn "server\\.registerTool" src/mcp/register.ts` — 1 line (the wrapper function definition); the only `whoop_doctor` registration sits inside it. D-33 attestation: zero new MCP tools in Phase 3.

## Threat model — runtime confirmation

| Threat ID | Disposition | How verified |
|---|---|---|
| T-03.12-01 | mitigate | sync.ts catch arm runs `sanitize(String(err))` for any non-typed error; existing sanitize.ts covers Bearer/JWT/Authorization/code/client_secret/oauth_url shapes (D-34). |
| T-03.12-02 | mitigate | sync.test.ts Test 5 — `{resources: 'invalid,cycles'}` rejected pre-bootstrap with `invalid_input` exit. |
| T-03.12-03 | mitigate | sync.test.ts Test 6 — `{since: 'not-a-date'}` rejected pre-bootstrap with `invalid_input` exit. |
| T-03.12-04 | mitigate | sync.test.ts Test 7 — `result.status === 'partial'` exits 0; `SYNC_EXIT_CODES.partial === 0` pinned via the frozen Object. |
| T-03.12-05 | mitigate | sync.txt.test.ts Test 7 — iterates the full 10-word ADR-0005 list against a rendered output exercising every status suffix. |
| T-03.12-06 | accept | Backup path is the user's own filesystem location under `~/.recovery-ledger/backups/` (chmod 600); D-08 by design surfaces the path. No code change required. |

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 — Blocking] Banned-tone-word leak in source comment**

- **Found during:** Final CI grep-gate run.
- **Issue:** The leading docstring in `src/formatters/sync.txt.ts` enumerated the full ADR-0005 banned-tone-word list verbatim ("no `optimize`, `wellness`, `honor`, `journey`, `crush`, `nail`, `dial in`, `tune`, `vibe`, `unlock`"). Gate A's grep flagged the words even inside a comment (the gate has no comment-aware exclusion — that's intentional, per the wordlist + `CLAUDE.md` self-exemption design).
- **Fix:** Replaced the inline list with a pointer reference: "ADR-0005 banned-tone-word list applies (see agent_docs/decisions/0005-banned-tone-words.md for the canonical list)."
- **Files modified:** `src/formatters/sync.txt.ts` (one comment block).
- **Commit:** Folded into `e864f6d` before commit (no separate fix commit).

### Plan adjustments

**1. buildProgram() factory + entry-point gate (vs. inline parseAsync at module load)**

The plan's Task 1 spec did not pre-specify a refactor of `src/cli/index.ts`'s top-level await. The existing `await program.parseAsync(process.argv)` at module load worked for the binary entry but would fire on any test import of the module. To enable Test 11 (Commander wiring — programmatically driving `program.parseAsync(['node', 'recovery-ledger', 'sync', '--days', '7'])`), I extracted the Commander construction into an exported `buildProgram(): Command` helper and gated the top-level parseAsync with an entry-point check (`import.meta.url === pathToFileURL(process.argv[1]).href`). The binary entry remains untouched at runtime; the refactor is purely additive for testability.

**2. Test 11 captures via `configureOutput` (vs. `helpInformation()`)**

The plan's Task 1 spec referenced "Test 12 — --help text mentions --days, --since, --resources, and exit codes 0 / 1." Commander's `helpInformation()` does NOT include `addHelpText('after', ...)` blocks — that text is emitted via the `afterAll`/`after` event handlers and only surfaces through `outputHelp()`. The test was rewired to patch `configureOutput({writeOut, writeErr})` to redirect Commander's help output into a string buffer for assertion. No semantic difference; same coverage of the exit-code block.

**3. Local duck-type guard `isMigrationErrorShape` inside the formatter**

The plan's Task 2 spec said "If isMigrationError(err): return …". Importing `isMigrationError` from `src/infrastructure/db/migrate.js` would have pulled the migrator's full module graph into `src/formatters/`, polluting the formatter's pure-function discipline (the formatter must remain testable without infrastructure setup). I inlined a local `isMigrationErrorShape(err): err is MigrationError` duck-type guard that mirrors the canonical check (`name === 'MigrationError'` + kind membership). The type-only import of `MigrationError` from migrate.ts pulls no runtime code, so the formatter still receives the precise type narrowing.

**4. acceptance grep — partial literal mismatch (not a code defect)**

Two of the plan's acceptance-criteria greps have stricter regexes than the resulting code can match after Biome reformatting:

- `grep -c "import { bootstrap }" src/cli/commands/sync.ts` returns 0 because Biome reorders the import to `import { type Bootstrapped, bootstrap } from '../../services/index.js'`. The bootstrap function IS imported; the literal pattern with no other names between the braces does not match.
- `grep -cE "program\\.command\\(['\"]sync['\"]\\)" src/cli/index.ts` returns 0 because the call site spans two lines (`program\n    .command('sync')`). The relaxed regex `\.command\(['"]sync['"]\)` returns 1.

Both criteria are semantically met (bootstrap is imported; sync subcommand is registered + a working `node dist/cli.mjs sync --help` confirms). The literal regexes in the plan were written before knowing Biome's exact formatting; the relaxed forms (and the `node dist/cli.mjs sync --help` smoke test) confirm intent.

## Files

- `/Users/chris.bremmer/recovery-ledger/src/cli/commands/sync.ts`
- `/Users/chris.bremmer/recovery-ledger/src/cli/commands/sync.test.ts`
- `/Users/chris.bremmer/recovery-ledger/src/formatters/sync.txt.ts`
- `/Users/chris.bremmer/recovery-ledger/src/formatters/sync.txt.test.ts`
- `/Users/chris.bremmer/recovery-ledger/src/cli/index.ts` (modified)

## Commits

| Task | Description                                                     | Commit  |
| ---- | --------------------------------------------------------------- | ------- |
| 2    | feat(03-12): add sync RunSyncResult formatter + bootstrap-error renderer | e864f6d |
| 1    | feat(03-12): add recovery-ledger sync CLI subcommand + ≤5-line shim     | 94539bb |

Task 2 landed before Task 1 so the formatter symbols were available at the moment the CLI shim landed; the dependency order reflects the import direction (sync.ts imports formatSyncResult + formatBootstrapError from the formatter).

## Self-Check: PASSED

- `src/cli/commands/sync.ts` — FOUND
- `src/cli/commands/sync.test.ts` — FOUND
- `src/formatters/sync.txt.ts` — FOUND
- `src/formatters/sync.txt.test.ts` — FOUND
- `src/cli/index.ts` — FOUND (modified, contains buildProgram + sync subcommand + parseIntStrict + entry-point gate)
- Commit `e864f6d` (formatter) — FOUND
- Commit `94539bb` (CLI shim) — FOUND
- `npm test` — 549/549 green
- `npm run lint` — clean (1 pre-existing info-level hint outside this plan's scope)
- `bash scripts/ci-grep-gates.sh` — all 7 gates green
- `git diff origin/main --stat src/mcp/sanitize.ts src/mcp/register.ts` — empty (D-34 attestation)
- D-33 attestation — `server.registerTool` returns 1 line (only the wrapper definition in register.ts)
- `node dist/cli.mjs sync --help` — returns help text with all three D-26 flags + exit codes
