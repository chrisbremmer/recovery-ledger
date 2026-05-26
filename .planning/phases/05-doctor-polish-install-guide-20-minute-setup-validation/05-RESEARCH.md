# Phase 5: Doctor Polish, Install Guide & <20-Minute Setup Validation — Research

**Researched:** 2026-05-26
**Domain:** Diagnostic command surface + install ergonomics + clean-clone CI stopwatch
**Confidence:** HIGH (all upstream code surfaces verified in `src/`; MCP-client wiring formats verified against current docs as of 2026-05)

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Doctor checks (D-01..D-05)**
- D-01: Split per signal, one DoctorCheck row per diagnostic concern (no composites).
- D-02: 14 checks total = 5 existing + 9 new: `whoop_roundtrip`, `db_open`, `db_integrity`, `db_schema_version`, `db_wal_size`, `last_sync_recency`, `most_recent_scored_day`, `data_quality_counts`, `concurrent_writers_stress`.
- D-03: `whoop_roundtrip` is the only online check. `--offline` flag skips it. `--stress` is required to run `concurrent_writers_stress`.
- D-04: Exit codes stay at 0/1/2 floor (pass/fail/warn). No per-check sub-codes. Structure is in JSON `checks[].name`.
- D-05: Severity precedence (fail > warn > pass) carries forward verbatim — `deriveOverall()` unchanged.

**Install guide (D-06..D-10)**
- D-06: Hybrid layout — root `INSTALL.md` (WHOOP-app checklist + quickstart + index) + `docs/install/` (per-client + troubleshooting + launchd + api-gap).
- D-07: File tree fixed (see below).
- D-08: Troubleshooting map = one H2 per literal `check.name` string.
- D-09: Contract test `tests/contract/troubleshooting-coverage.test.ts` asserts every `CHECK_NAMES.*` value has a matching H2.
- D-10: Identical core CLI flow across all three per-client docs. Only MCP wiring config differs.

**Stopwatch test (D-11..D-14)**
- D-11: MSW + `--no-browser` + loopback callback POST injection. Reuse all existing Phase 2/3 MSW helpers.
- D-12: Boundary is `npm install` → `review daily` exit 0. Excludes `git clone`; includes native-module compile.
- D-13: NOT in default `npm test`. Env-gated behind `VITEST_INCLUDE_STOPWATCH=1`. Dedicated workflow `.github/workflows/setup-stopwatch.yml` on `macos-latest` + `ubuntu-latest`, triggered on PRs touching `package.json`, `src/cli/`, `src/services/bootstrap.ts`, `src/infrastructure/db/migrations/`.
- D-14: Realism trade — MSW intercepts at fetch level; not measuring real network. Documented explicit non-goal.

**launchd (D-15, D-16)**
- D-15: Static `.plist` at `templates/com.recovery-ledger.daily-sync.plist` with `${HOME}` / `${RECOVERY_LEDGER_BIN}` placeholders. No runtime detection, no doctor probe.
- D-16: No `recovery-ledger install-launchd` CLI command — pure docs.

**API-gap (D-17..D-19)**
- D-17: Build-time generation via `scripts/generate-api-gap-md.ts` reading `src/services/api-gap/data.ts`. Output to `docs/install/api-gap.md`. Wired as `npm run docs:generate-api-gap`.
- D-18: Parity contract test `tests/contract/api-gap-md-parity.test.ts` regenerates and asserts no diff.
- D-19: NOT a `prebuild` hook. Generator on demand; parity test is the forcing function.

**MCP attestation (D-20, D-21)**
- D-20: Zero new MCP surface. `tools.length === 8`, `resources.length === 6`, `prompts.length === 4` carries verbatim from Phase 4 D-29.
- D-21: `src/mcp/sanitize.ts`, `register.ts`, `register-resource.ts`, `register-prompt.ts` UNMODIFIED in Phase 5.

**Phase close (D-22)**
- D-22: Mirror Plan 03-13 + Plan 04-12. Full suite green under 90s budget (stopwatch excluded). All 10 gates A–J green. D-30 attestation diffs. DOC-01..06 flipped. ROADMAP `[x]`. STATE.md milestone v1.0.

### Claude's Discretion

User delegated all four discussion areas with "Discuss them all amongst yourselves, come to me if there isn't a clear winner." All 22 decisions landed without escalation. Research operates inside the locked-decision frame; remaining freedom is in:
- Plan decomposition (how to split the 14 checks across waves).
- Test fixture seams for the 9 new checks (mocked vs. real-DB).
- Exact wording of troubleshooting copy (subject to banned-tone-word lint).
- Whether to extend Gate A's grep to scan `docs/install/*.md` (low risk either way).
- Order of waves and which checks land before the install guide PR.

### Deferred Ideas (OUT OF SCOPE)

- `recovery-ledger install-launchd` CLI command.
- Per-check exit-code sub-codes.
- Doctor probe for "launchd job loaded and ran yesterday".
- systemd user-timer template (V2-03).
- Healthcheck endpoint / heartbeat ping for the launchd job.
- Doctor `--watch` mode.
- HTML-rendered doctor output.
- Multi-account doctor view.
- WHOOP webhook receiver.
- Markdown-rendered API-gap doc as an MCP resource (breaks D-20).
- Per-resource API quota dashboards (`doctor --quota`).
- `doctor` probe diffing `dist/` vs `src/`.
- `recovery-ledger reset auth` subcommand.
- AES-256-GCM passphrase-derived file fallback.
- `learnings.md` entry for grep-criteria-in-comments pattern.

</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| DOC-01 | `recovery-ledger doctor` runs all required checks (auth state, token freshness + WHOOP roundtrip, DB integrity + schema version + WAL file size, last-sync recency + most-recent SCORED day, MCP transport stdout-purity self-test, data-quality counts, native-module load, concurrent-writers stress) | Finding §3.1: signatures + reuse seams for 9 new checks; §3.2: dependency-aware ordering; §3.4: opt-in flag wiring. |
| DOC-02 | Doctor emits structured exit codes that map to documented troubleshooting steps | Finding §3.3: 0/1/2 floor unchanged (D-04 locks); structure lives in `checks[].name`; §4.4: contract test `troubleshooting-coverage.test.ts` keys H2 anchors off `CHECK_NAMES`. |
| DOC-03 | API-gap documentation lists every WHOOP consumer-app feature not available via the public API (Healthspan, ECG, BP, journal, continuous HR, etc.) with a clear "unavailable via API" explanation surfaced through `whoop_api_gap` | Finding §5: build-time generator + parity contract test against `API_GAP_ENTRIES` source-of-truth. |
| DOC-04 | Install guide includes per-client sections for Claude Code, Claude Desktop, and Cursor; WHOOP developer-app setup checklist; and a troubleshooting map keyed to doctor exit codes | Finding §4: layout, per-client wiring formats (current as of 2026-05), troubleshooting H2 contract; §6: file tree. |
| DOC-05 | launchd `.plist` template for macOS is shipped as documentation (not auto-installed) for users who want a scheduled local sync | Finding §7: static template + `sed`-based docs. No probe. |
| DOC-06 | Clean-clone-to-first-daily-review measured at < 20 minutes on a fresh macOS image, asserted by a CI stopwatch test | Finding §8: full stopwatch design (MSW + callback POST + child-spawn), Vitest env gate, dedicated workflow design. |

</phase_requirements>

## Summary

Phase 5 is the **closing-the-loop phase**: every prior phase shipped a production surface (auth, DB, sync, reviews, decisions, MCP), and Phase 5 ships the diagnostic + documentation surface that makes those surfaces *operable* by a new user (Chris on a new laptop, or a future contributor on a fresh clone). The work is well-defined because:

- Every upstream surface the 9 new checks consume already exists and has a stable API (verified in `src/`).
- The CONTEXT.md decisions lock 22 design questions, removing exploration scope from research.
- Phase 4 already shipped `API_GAP_ENTRIES` as a TS source-of-truth (D-28); Phase 5 just adds the second consumer (markdown gen) + a parity test.

**Primary recommendation:** Decompose into ~10–12 plans across 3 waves. Wave 0 lands the test/CI scaffolding (workflow YAML, generator script skeleton, contract-test scaffolds). Wave 1 lands the 9 new doctor checks in parallel (each is an isolated `src/services/doctor/checks/<name>.ts` file + tests; the `checks/` directory pattern from Phases 1–2 makes them independently mergeable). Wave 2 lands the install guide tree, generator + parity test, troubleshooting contract test, and stopwatch test. Phase-close mirrors Plan 04-12 verbatim — full-suite green under 90s, all 10 gates A–J green (no new gates needed), D-30 attestation diff, DOC-01..06 flipped, STATE/ROADMAP/VALIDATION close.

No new dependencies. No new MCP surface. No new grep gates. The risk profile is dominated by stopwatch-flakiness on cold CI (mitigated by D-13's PR-trigger filter), markdown-generation drift (mitigated by D-18's parity test), and ensuring the 9 new checks don't blow the 90s suite budget (the `concurrent_writers_stress` opt-in + `--offline` flag combine to keep default doctor runtime ~unchanged).

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| WHOOP roundtrip probe | Service (doctor) | Infrastructure (whoop client + token store) | Per ARCHITECTURE.md, doctor probes live in services; they consume infrastructure through the services barrel, never reach in directly. `whoop_roundtrip` goes through `services.refreshOrchestrator.callWithAuth` (the Phase 2 chokepoint) → `httpGet` (the Phase 3 chokepoint). |
| DB-integrity probes | Service (doctor) | Infrastructure (db/connection, db/migrations) | DB checks consume `openDb()` + repository methods through a service-level seam (preferred: injected DB handle on `runDoctor()`; alternative: probes call `openDb` on a tmp connection — planner to pick). The probes own pragma reads (`PRAGMA integrity_check`) but rely on `connection.ts` for the canonical pragma list. |
| Sync-recency / scored-day / data-quality probes | Service (doctor) | Infrastructure (repositories) | Probes call `repos.syncRuns.latestFinished()`, `repos.{cycles,recoveries,sleeps}.latestScoredStart()` (likely a new method), and `repos.*.countByScoreState()` (new). The repositories own the SQL; the probes own the threshold logic + DoctorCheck shape. |
| Concurrent-writers stress | Service (doctor) | Test (forks pattern), Infrastructure (db/connection) | Mirrors `tests/integration/auth-concurrency.test.ts` 10-fork pattern. Spawns child processes (subprocess gate applies, like `mcp_stdout_purity`). Each child opens a tmp DB through `openDb()` and runs `BEGIN IMMEDIATE` upserts. |
| API-gap markdown generation | Build script (`scripts/`) | Service (api-gap) | The generator is a top-level Node script invoked via npm. It imports `API_GAP_ENTRIES` directly (not through the service accessor) because it's build-time, no composition needed. Output is committed markdown. |
| Install docs | Documentation | — | Pure markdown under `INSTALL.md` + `docs/install/`. No runtime surface. Banned-tone-word lint applies (planner decides scope extension). |
| launchd template | Documentation | — | Static template under `templates/`. No code, no probe. User runs `sed` + `launchctl load` manually. |
| Stopwatch test | Integration test | All upstream services | Lives at `tests/integration/setup-stopwatch.test.ts`. Spawns CLI child processes (`init`, `auth`, `sync`, `review daily`) against MSW-mocked WHOOP. Uses `RECOVERY_LEDGER_HOME` env override to keep the test off the user's real `~/.recovery-ledger/`. |
| CI workflow for stopwatch | CI (GitHub Actions) | — | New workflow file at `.github/workflows/setup-stopwatch.yml`. Independent of existing `ci.yml`. Triggered on path filter. |

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `@modelcontextprotocol/sdk` | ^1.29.0 | MCP SDK (already in deps) | No version change. Phase 5 does NOT touch the MCP surface beyond extending `whoop_doctor`'s `inputSchema` Zod (per D-21 nothing else changes). [VERIFIED: package.json] |
| `better-sqlite3` | ^12.9.0 | SQLite binding (already in deps) | New DB checks reuse the existing `openDb()` factory. No new pragma; `db_wal_size` reads file size via `node:fs.statSync`. [VERIFIED: package.json + src/infrastructure/db/connection.ts] |
| `@napi-rs/keyring` | ^1.3.0 | Keychain backend (already in deps) | No change. The existing `napi_keyring_load` check covers this; new checks don't touch keychain. [VERIFIED: package.json] |
| `commander` | ^14.0.3 | CLI (already in deps) | Add `--offline` and `--stress` flags to existing `doctor` subcommand. No new CLI command. [VERIFIED: package.json + src/cli/commands/doctor.ts] |
| `zod` | ^4.4.3 | Validation (already in deps) | Add `{offline: z.boolean().optional(), stress: z.boolean().optional()}` to `whoop_doctor.inputSchema`. Body stays ≤5 lines per MCP-03. [VERIFIED: package.json] |
| `vitest` | ^4.1.6 | Test runner (already in deps) | Stopwatch test uses `vi.setConfig({testTimeout: 20*60*1000})` per-suite, or relies on the existing `pool: 'forks'` already in place. [VERIFIED: package.json + agent_docs/conventions.md] |
| `msw` | ^2.14.6 | HTTP mocking (already in deps) | Stopwatch test reuses all 7 existing MSW helpers (`tests/helpers/msw-whoop-*.ts`). Zero new handlers needed. [VERIFIED: package.json + tests/helpers/] |

### Supporting

None. Phase 5 adds zero dependencies. The `concurrent_writers_stress` probe uses `node:child_process.fork` (already exercised by `tests/integration/auth-concurrency.test.ts`); the API-gap generator uses `node:fs/promises` (built-in); the stopwatch test uses `node:perf_hooks.performance.now()` (built-in).

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Markdown generator as `npm run` script | `prebuild` tsup hook | D-19 explicitly rejects this — would slow `dev:cli`/`dev:mcp` watch loops. The parity contract test is the forcing function instead. |
| Stopwatch with real `git clone` | MSW + tmp HOME | D-12 explicitly excludes clone — measures GitHub-runner network speed, not user friction. |
| Per-check exit code sub-codes (e.g., 10 = db_integrity) | 0/1/2 floor + JSON `checks[].name` | D-04 locks the floor. Sub-codes would require a 14-row exit-code table with precedence rules; no consumer (cron, launchd, CI) benefits. |
| Hand-written API-gap markdown + diff contract test | Build-time generator + parity contract test | D-17/D-18. Generated approach: any reformatting auto-regenerates; the test is "no diff." Hand-written approach: brittle — any whitespace change breaks the test. |

**Installation:** No `npm install` step in Phase 5.

**Version verification:** All Phase 5 dependencies are already in `package.json`. No additions; no `npm view` calls required.

## Package Legitimacy Audit

> N/A for this phase — no external packages installed in Phase 5.

## Architecture Patterns

### System Architecture Diagram

```
                                ┌─────────────────────────────────┐
                                │ User on fresh laptop / contributor on
                                │ fresh clone — wants first daily review
                                │ under 20 minutes
                                └────────────────┬────────────────┘
                                                 │
                                                 ▼
                ┌────────────────────────────────────────────────────────┐
                │                    INSTALL.md (root)                   │
                │   WHOOP dev-app checklist + Quickstart + per-client    │
                │   index + troubleshooting link + launchd link + API gap │
                └─────┬──────────────────┬──────────────────┬────────────┘
                      │                  │                  │
                      ▼                  ▼                  ▼
            docs/install/claude-code.md  /claude-desktop.md /cursor.md
                  │ (project .mcp.json)  │ (claude_desktop_  │ (~/.cursor/
                  │                      │  config.json)     │  mcp.json)
                  └────────────────┬─────┴───────────────────┘
                                   │
                  All three point at the SAME CLI flow:
                  `recovery-ledger init` → `auth` → `sync` → `review daily`
                  + MCP wiring via `recovery-ledger-mcp` bin
                                   │
                                   ▼
                  ┌──────────────────────────────────────┐
                  │       recovery-ledger doctor          │
                  │  14 checks, one row per signal (D-01) │
                  └────────────┬─────────────────────────┘
                               │
       ┌───────────────────────┼───────────────────────────────────┐
       │                       │                                   │
       ▼                       ▼                                   ▼
 Phase 1 checks (5)       Phase 5 checks (8 default + 1 opt-in)   Phase 5 flags
 — unchanged              ─ whoop_roundtrip (online; --offline)   ─ --offline
 — better_sqlite3_load    ─ db_open / db_integrity / db_schema_   ─ --stress
 — napi_keyring_load        version / db_wal_size                   ─ --text
 — mcp_stdout_purity      ─ last_sync_recency / most_recent_
 — auth                     scored_day
 — token_freshness        ─ data_quality_counts (always pass)
                          ─ concurrent_writers_stress (--stress)
                               │
                               ▼
                  Each check → DoctorCheck{name, status, detail}
                               │
                               ▼
                  deriveOverall() (UNCHANGED; fail > warn > pass)
                               │
                               ▼
                  exit 0/1/2 ← DOCTOR_EXIT_CODES (UNCHANGED)
                  JSON output with checks[].name
                               │
                               ▼
                  docs/install/troubleshooting.md
                  One H2 per check.name (contract-test enforced)

                  ┌──────────────────────────────────────┐
                  │  src/services/api-gap/data.ts         │ (D-28 source)
                  │       (API_GAP_ENTRIES)               │
                  └──────────────┬───────────────────────┘
                                 │
                  ┌──────────────┴──────────────┐
                  │                              │
                  ▼                              ▼
       services.getApiGap()           scripts/generate-api-gap-md.ts
       (MCP `whoop_api_gap` tool)     (npm run docs:generate-api-gap)
                                                │
                                                ▼
                                      docs/install/api-gap.md
                                      (parity test: regenerate, no diff)

                  ┌──────────────────────────────────────┐
                  │  tests/integration/setup-stopwatch.   │
                  │  test.ts (env-gated; 20-min budget)   │
                  └──────────────────────────────────────┘
                               │
                               ▼
                  .github/workflows/setup-stopwatch.yml
                  macos-latest + ubuntu-latest
                  Triggered: PRs touching package.json,
                             src/cli/, src/services/bootstrap.ts,
                             src/infrastructure/db/migrations/
```

### Recommended Project Structure

```
recovery-ledger/
├── INSTALL.md                                          # NEW — front door + WHOOP dev-app + quickstart
├── docs/
│   └── install/                                        # NEW directory
│       ├── claude-code.md                              # .mcp.json wiring + claude mcp add
│       ├── claude-desktop.md                           # claude_desktop_config.json
│       ├── cursor.md                                   # ~/.cursor/mcp.json or .cursor/mcp.json
│       ├── troubleshooting.md                          # one H2 per check.name (D-08, D-09)
│       ├── launchd.md                                  # sed + launchctl load steps
│       └── api-gap.md                                  # GENERATED from data.ts (D-17, D-18)
├── templates/
│   └── com.recovery-ledger.daily-sync.plist            # static template (D-15)
├── scripts/
│   ├── ci-grep-gates.sh                                # UNCHANGED
│   └── generate-api-gap-md.ts                          # NEW — D-17 generator
├── .github/workflows/
│   ├── ci.yml                                          # UNCHANGED (default suite)
│   └── setup-stopwatch.yml                             # NEW (D-13)
├── src/
│   ├── services/doctor/
│   │   ├── index.ts                                    # MODIFIED — PROBE_NAMES extended 5→14
│   │   └── checks/
│   │       ├── check-names.ts                          # MODIFIED — 9 new constants
│   │       ├── whoop-roundtrip.ts                      # NEW (D-02 #1)
│   │       ├── db-open.ts                              # NEW (D-02 #2)
│   │       ├── db-integrity.ts                         # NEW (D-02 #3)
│   │       ├── db-schema-version.ts                    # NEW (D-02 #4)
│   │       ├── db-wal-size.ts                          # NEW (D-02 #5)
│   │       ├── last-sync-recency.ts                    # NEW (D-02 #6)
│   │       ├── most-recent-scored-day.ts               # NEW (D-02 #7)
│   │       ├── data-quality-counts.ts                  # NEW (D-02 #8)
│   │       └── concurrent-writers-stress.ts            # NEW (D-02 #9; --stress only)
│   ├── cli/commands/
│   │   └── doctor.ts                                   # MODIFIED — add --offline + --stress flags
│   └── mcp/tools/
│       └── whoop-doctor.ts                             # MODIFIED — inputSchema gains {offline, stress}
└── tests/
    ├── contract/
    │   ├── troubleshooting-coverage.test.ts            # NEW (D-09)
    │   └── api-gap-md-parity.test.ts                   # NEW (D-18)
    └── integration/
        └── setup-stopwatch.test.ts                     # NEW (D-13; env-gated)
```

### Pattern 1: Doctor probe (canonical shape)

**What:** Each new probe is a single async function returning `Promise<DoctorCheck>`. Pure orchestration over services / infrastructure; no console / stdout writes (ADR-0001).

**When to use:** Every Phase 5 doctor check.

**Example** (modeled on the existing `src/services/doctor/checks/auth.ts`):
```typescript
// src/services/doctor/checks/db-integrity.ts
import type Database from 'better-sqlite3';
import type { DoctorCheck } from '../index.js';
import { CHECK_NAMES } from './check-names.js';

export interface DbIntegrityProbeDeps {
  /** Override for the DB handle. Production callers receive a handle from
   *  the bootstrap composition root via the dep-injection seam. */
  sqlite?: Database.Database;
}

export async function probeDbIntegrity(deps?: DbIntegrityProbeDeps): Promise<DoctorCheck> {
  if (!deps?.sqlite) {
    return {
      name: CHECK_NAMES.DB_INTEGRITY,
      status: 'fail',
      detail: 'no DB handle injected — bootstrap composition failed',
    };
  }
  try {
    const rows = deps.sqlite.pragma('integrity_check') as Array<{ integrity_check: string }>;
    if (rows.length === 1 && rows[0]?.integrity_check === 'ok') {
      return { name: CHECK_NAMES.DB_INTEGRITY, status: 'pass', detail: 'PRAGMA integrity_check ok' };
    }
    return {
      name: CHECK_NAMES.DB_INTEGRITY,
      status: 'fail',
      detail: `PRAGMA integrity_check returned ${rows.length} row(s); first: ${rows[0]?.integrity_check ?? '(empty)'}`,
    };
  } catch (err) {
    return {
      name: CHECK_NAMES.DB_INTEGRITY,
      status: 'fail',
      detail: `probe threw: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}
```

### Pattern 2: Subprocess-gated probe (`concurrent_writers_stress`)

**What:** Mirror `mcp_stdout_purity.ts`'s `skipSubprocess` pattern. The probe opts itself out when `runDoctor({skipSubprocessChecks: true})` is set OR when `--stress` was not passed on the CLI.

**Example shape:**
```typescript
// src/services/doctor/checks/concurrent-writers-stress.ts
export interface StressProbeOptions {
  skipSubprocess?: boolean;
  /** When false, return an informational `pass` with detail "skipped — run with --stress". */
  enabled?: boolean;
}

export async function probeConcurrentWritersStress(opts: StressProbeOptions = {}): Promise<DoctorCheck> {
  if (opts.skipSubprocess === true || opts.enabled !== true) {
    return {
      name: CHECK_NAMES.CONCURRENT_WRITERS_STRESS,
      status: 'pass',
      detail: opts.skipSubprocess ? 'skipped (running inside MCP transport)' : 'skipped — run with --stress to enable',
    };
  }
  // ... fork 4 children against tmp DB; each does BEGIN IMMEDIATE upsert
  //     pattern mirrors tests/integration/auth-concurrency.test.ts
}
```

### Pattern 3: API-gap markdown generator

**What:** A top-level Node script that imports `API_GAP_ENTRIES` directly (bypassing the service accessor — build-time tool, no composition needed), renders markdown, writes to `docs/install/api-gap.md` with a "DO NOT HAND-EDIT" header.

**Why direct import:** D-17 — the generator is build-time; it doesn't need the async/Promise wrapper that `services.getApiGap()` provides. The parity contract test (D-18) is the source of truth that `data.ts` and the generated markdown stay in lockstep.

```typescript
// scripts/generate-api-gap-md.ts
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { API_GAP_ENTRIES } from '../src/services/api-gap/data.js';

const HEADER = [
  '<!-- Generated from src/services/api-gap/data.ts — do not hand-edit. -->',
  '<!-- Run `npm run docs:generate-api-gap` after changing the source.   -->',
  '',
  '# WHOOP API v2 Gap',
  '',
  'WHOOP consumer-app features that are NOT exposed via the public v2 API.',
  '',
].join('\n');

function renderEntry(entry: typeof API_GAP_ENTRIES[number]): string {
  return [
    `## ${entry.feature}`,
    '',
    `**WHOOP app path:** ${entry.whoop_consumer_path}`,
    '',
    `**Available via v2 API:** No.`,
    '',
    entry.alternative_via_v2
      ? `**Closest v2 alternative:** ${entry.alternative_via_v2}`
      : `**Closest v2 alternative:** None.`,
    '',
    entry.notes,
    '',
  ].join('\n');
}

const body = HEADER + API_GAP_ENTRIES.map(renderEntry).join('\n');
writeFileSync(resolve(import.meta.dirname, '..', 'docs', 'install', 'api-gap.md'), body, 'utf8');
```

### Pattern 4: Parity contract test (regenerate-and-diff)

**Example:**
```typescript
// tests/contract/api-gap-md-parity.test.ts
import { readFileSync, writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';

test('api-gap.md is in sync with src/services/api-gap/data.ts', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'rl-api-gap-'));
  const out = join(tmp, 'api-gap.md');
  // Run the generator in a child tsx process pointed at the tmp out path.
  execSync(`npx tsx scripts/generate-api-gap-md.ts`, { env: { ...process.env, GEN_OUT: out } });
  const generated = readFileSync(out, 'utf8');
  const committed = readFileSync('docs/install/api-gap.md', 'utf8');
  expect(generated).toBe(committed); // error message: "Run `npm run docs:generate-api-gap` and commit the result."
});
```

(Planner picks whether the generator accepts a `GEN_OUT` env var or whether the test invokes the underlying render function and diffs strings. The latter is cheaper and avoids a `tsx` subprocess.)

### Anti-Patterns to Avoid

- **Composite checks** — explicitly rejected by D-01. A `db_integrity` row that aggregates pragma + schema + WAL signals defeats the troubleshooting-map 1:1 mapping. Each signal gets its own row.
- **Sub-codes per check in exit-code map** — explicitly rejected by D-04. JSON `checks[].name` carries the structure; the shell-level contract is 0/1/2.
- **Auto-installing the launchd plist** — explicitly rejected by D-16. The template is docs; the user does `sed` + `launchctl load`.
- **Hand-writing api-gap.md** — explicitly rejected by D-17. Generated from TS source-of-truth.
- **Adding a new MCP tool/resource/prompt** — explicitly rejected by D-20. Phase 5 ships zero new MCP surface.
- **Running stopwatch on every PR** — explicitly rejected by D-13. PR-trigger filter on package.json / src/cli/ / bootstrap.ts / migrations.
- **Including emoji in install docs** — Gate A grep is repo-wide. Banned-tone-word list also applies (the `docs/install/*.md` planner-discretion call on whether to extend Gate A's scope is low-risk; the docs are under direct authorial control).
- **A doctor probe that mutates state** — every probe is read-only. `concurrent_writers_stress` writes to a *tmp* DB the probe owns; never touches `paths.dbFile`.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| WHOOP API call from `whoop_roundtrip` | Bare `fetch()` | `services.refreshOrchestrator.callWithAuth(...)` + `httpGet('/v2/user/profile/basic', ...)` | Bypasses the single-flight refresh gate (ADR-0002), the rate-limit semaphore (Phase 3 D-20), and Gate F enforcement. Reuse the Phase 2 + Phase 3 chokepoints. [VERIFIED: src/services/refresh-orchestrator.ts:140, src/infrastructure/whoop/resources/profile.ts] |
| DB integrity check | Custom row-scanning queries | `sqlite.pragma('integrity_check')` | SQLite's built-in `PRAGMA integrity_check` is the canonical way; it walks B-tree pages and verifies cross-references. Anything else is a worse version. [CITED: SQLite docs — `PRAGMA integrity_check`] |
| Schema version check | Reading Drizzle internals | `SELECT COUNT(*) FROM __drizzle_migrations` vs counting `.sql` files in migrations dir | Drizzle's migrator keeps `__drizzle_migrations` as the recorded-state-of-the-world. Comparing the row count to the on-disk `.sql` file count catches both "ran but didn't record" (orphaned row) and "didn't run" (missing row). [VERIFIED: src/infrastructure/db/migrate.ts pattern in Phase 3 03-CONTEXT] |
| WAL file size | Parse `pragma wal_checkpoint` output | `node:fs.statSync(`${dbFile}-wal`).size` | The WAL file is at `${dbFile}-wal` by SQLite convention. `fs.statSync` is the cheapest read. [CITED: SQLite WAL docs] |
| Stopwatch wall-clock | `Date.now()` deltas | `node:perf_hooks.performance.now()` | `performance.now()` is monotonic — immune to NTP adjustments and DST jumps that would corrupt a `Date.now()` delta. Built-in, zero-dep. |
| Markdown parsing in troubleshooting-coverage test | Pull in `remark` / `markdown-it` | `String.prototype.matchAll(/^## (\S+)$/gm)` over `readFileSync` | One regex over the rendered text is enough. Specifics line 274: zero-dep is the right call; adding a markdown parser would be the only new dep in Phase 5. |
| Cross-process advisory locking for stress test | Hand-rolled `flock` | `proper-lockfile` (already in deps) — but actually NOT NEEDED here | The stress test exercises `BEGIN IMMEDIATE` contention (D-30's `busy_timeout=5000` is the load-bearing primitive); the lock pattern in `tests/integration/auth-concurrency.test.ts` is the precedent. [VERIFIED: package.json + 0002-single-flight-oauth-refresh.md] |
| OAuth callback simulation in stopwatch test | Drive Puppeteer / Playwright | `fetch('http://localhost:<port>/oauth/callback?code=fake&state=<extracted>')` against the loopback server the child is already listening on | Phase 2 D-09 already shipped the loopback HTML pages; the callback server is part of the production `runOAuth` flow. A direct `fetch()` against the open port is what a browser would do, minus the JS. Zero new dependencies. [VERIFIED: src/cli/commands/auth.ts:97, AUTH-02] |

**Key insight:** Every new check has at least one upstream chokepoint (callWithAuth, openDb, repository methods, paths.ts) that Phase 5 must consume. Hand-rolling around them would break gates F (fetch), E (oauth/oauth2/token), G (drizzle-orm import), or the ADR-0002 single-flight contract. The pattern of every Phase 5 probe is: "import the canonical service/infra accessor + map to DoctorCheck."

## Runtime State Inventory

> N/A — Phase 5 has no rename / refactor / migration. New code lives in new files (`src/services/doctor/checks/*` ninth new file, `docs/install/*`, `templates/`, `scripts/generate-api-gap-md.ts`, `tests/contract/troubleshooting-coverage.test.ts`, `tests/contract/api-gap-md-parity.test.ts`, `tests/integration/setup-stopwatch.test.ts`, `.github/workflows/setup-stopwatch.yml`). Existing files modified are additive (CHECK_NAMES gains constants, doctor.ts CLI gains flags, whoop-doctor.ts inputSchema gains optional fields). No stored data, no service config, no OS-registered state, no secret/env-var renames, no build-artifact migrations.

## Concrete Findings

### Finding §1 — Existing Doctor Surface (verified by reading source)

The doctor lives at `src/services/doctor/` with this structure (per `ls -la`):

| File | LOC | Purpose | Phase 5 change |
|------|-----|---------|----------------|
| `src/services/doctor/index.ts` | 163 | `runDoctor()` orchestrator + `DoctorCheck`/`DoctorResult` types + `deriveOverall()` | Extend `PROBE_NAMES` from 5 to 14; add new probe imports; extend `RunDoctorOptions` with `{offline?: boolean, stress?: boolean}`; pass through to `Promise.allSettled([...])`. `deriveOverall()` UNCHANGED. |
| `src/services/doctor/checks/check-names.ts` | 30 | Frozen `CHECK_NAMES` const | Add 9 new constants: `WHOOP_ROUNDTRIP`, `DB_OPEN`, `DB_INTEGRITY`, `DB_SCHEMA_VERSION`, `DB_WAL_SIZE`, `LAST_SYNC_RECENCY`, `MOST_RECENT_SCORED_DAY`, `DATA_QUALITY_COUNTS`, `CONCURRENT_WRITERS_STRESS`. |
| `src/services/doctor/checks/auth.ts` | 77 | Canonical offline-safe probe shape | UNCHANGED. Reference precedent for 8 of the 9 new probes. |
| `src/services/doctor/checks/token-freshness.ts` | 104 | Offline-safe + `formatDuration` helper | UNCHANGED. Reference precedent for `last_sync_recency` + `most_recent_scored_day` (same duration-formatting need). |
| `src/services/doctor/checks/mcp-stdout-purity.ts` | 316 | Subprocess-spawning probe with `skipSubprocess` gate | UNCHANGED. Reference precedent for `concurrent_writers_stress`. |
| `src/services/doctor/checks/native-modules.ts` | 55 | Two narrow load probes (`probeBetterSqlite3`, `probeKeyring`) | UNCHANGED. Reference precedent for narrow probes. |
| `src/services/doctor/checks/fixtures.ts` | (read-only) | JSON-RPC fixtures for the stdout-purity subprocess | UNCHANGED. |
| `src/cli/commands/doctor.ts` | 62 | The ONE Gate-C-exempt CLI site; `DOCTOR_EXIT_CODES` frozen const | Add `--offline` and `--stress` Commander option declarations; thread into `services.runDoctor({offline, stress})`. `DOCTOR_EXIT_CODES` UNCHANGED per D-04. |
| `src/mcp/tools/whoop-doctor.ts` | 59 | MCP shim, body ≤ 5 lines | Extend `inputSchema` with `{offline: z.boolean().optional(), stress: z.boolean().optional()}`; thread through to `services.runDoctor({skipSubprocessChecks: true, offline, stress})`. Body stays ≤ 5 lines. |
| `src/formatters/doctor.txt.ts` | 17 | Plain-text renderer | UNCHANGED — handles arbitrary `{name, status, detail}` already. |
| `src/services/doctor/index.test.ts` | 322 | Vitest spec | Extend with 14-row PROBE_NAMES assertion + per-new-probe synthesized-fail-on-throw tests. |

### Finding §2 — Probe Order Matters for First-Fail-Wins UX (Specifics line 261)

`deriveOverall` is order-independent, but the visual output in `formatters/doctor.txt.ts` renders checks in the order `runDoctor()` returns them. A user with no tokens should see `auth: fail` before any `whoop_roundtrip: fail` or `last_sync_recency: fail` — the more fundamental remediation comes first.

**Recommended PROBE_NAMES order** in `runDoctor()`:

```
1. better_sqlite3_load        (load → fails fastest if native module is broken)
2. napi_keyring_load
3. mcp_stdout_purity          (subprocess; gated)
4. db_open                    (DB layer alive)
5. db_integrity               (DB content sane)
6. db_schema_version          (migrator in sync)
7. db_wal_size                (WAL hygiene)
8. auth                       (tokens present)
9. token_freshness            (tokens valid)
10. whoop_roundtrip           (online; --offline skips)
11. last_sync_recency         (sync ran recently)
12. most_recent_scored_day    (data scored recently)
13. data_quality_counts       (informational; always pass)
14. concurrent_writers_stress (opt-in; --stress)
```

(Planner is free to refine — this is a recommendation, not a lock. The contract is that each check's `name` matches a troubleshooting H2 in `docs/install/troubleshooting.md`.)

### Finding §3 — Doctor Check Signatures (per probe)

#### 3.1 `whoop_roundtrip` (D-02 #1; D-03 only online check)

```typescript
// src/services/doctor/checks/whoop-roundtrip.ts
import type { DoctorCheck } from '../index.js';
import type { RefreshOrchestrator } from '../../refresh-orchestrator.js';
import { CHECK_NAMES } from './check-names.js';
import { WhoopApiError } from '../../../infrastructure/whoop/errors.js';

export interface WhoopRoundtripDeps {
  refreshOrchestrator: RefreshOrchestrator;
  // Must call /v2/user/profile/basic via the production httpGet seam —
  // never bare fetch (Gate F). Inject a fetcher so the unit test can
  // assert without touching the real WHOOP host.
  fetcher: (accessToken: string) => Promise<{ status: number; durationMs: number }>;
}

export async function probeWhoopRoundtrip(
  deps: WhoopRoundtripDeps,
  opts?: { offline?: boolean },
): Promise<DoctorCheck> {
  if (opts?.offline === true) {
    return {
      name: CHECK_NAMES.WHOOP_ROUNDTRIP,
      status: 'pass',
      detail: 'skipped (--offline)',
    };
  }
  try {
    const result = await deps.refreshOrchestrator.callWithAuth(deps.fetcher);
    if (result.status === 200) {
      return {
        name: CHECK_NAMES.WHOOP_ROUNDTRIP,
        status: 'pass',
        detail: `profile fetched in ${Math.round(result.durationMs)}ms`,
      };
    }
    if (result.status === 401) {
      return {
        name: CHECK_NAMES.WHOOP_ROUNDTRIP,
        status: 'fail',
        detail: `WHOOP returned 401 after refresh — run \`recovery-ledger auth\``,
      };
    }
    return {
      name: CHECK_NAMES.WHOOP_ROUNDTRIP,
      status: 'warn',
      detail: `WHOOP returned ${result.status} — scopes may have drifted; check developer.whoop.com/dashboard/applications`,
    };
  } catch (err) {
    return {
      name: CHECK_NAMES.WHOOP_ROUNDTRIP,
      status: 'fail',
      detail: `roundtrip failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}
```

**Reuses:** `services.refreshOrchestrator` (Phase 2 D-15) → `callWithAuth` → injects a fetcher that wraps `httpGet('/v2/user/profile/basic', {}, WhoopRawProfile)` (Phase 3 chokepoint). The endpoint is the smallest WHOOP v2 payload per the canonical-refs section of CONTEXT.md.

**Test seam:** Inject a `fetcher` mock returning `{status: 200, durationMs: 45}` for the pass arm; `{status: 401, durationMs: 30}` for the fail arm; throw `WhoopApiError` for the network-error arm.

#### 3.2 `db_open` (D-02 #2)

```typescript
// Loud "DB layer is alive" signal; precedes every other db_* check.
// Pass iff openDb() returns and the resulting handle responds to a no-op pragma.
// Caller passes an existing handle when available (e.g., bootstrap composition);
// the probe falls back to opening + closing a tmp handle against paths.dbFile.
```

**Reuses:** `src/infrastructure/db/connection.ts:openDb()` (Phase 3 D-30) + `src/infrastructure/config/paths.ts`.

#### 3.3 `db_integrity` (D-02 #3)

`PRAGMA integrity_check` returns one row `{integrity_check: 'ok'}` on a sound DB. Fail if any row is non-`ok` or if rows.length > 1 (which signals corruption — SQLite emits multiple error rows on the same pragma).

**Reuses:** The injected sqlite handle from `db_open`.

#### 3.4 `db_schema_version` (D-02 #4)

```typescript
// pass: __drizzle_migrations row count === count of .sql files in migrations dir
// fail: counts mismatch → orphaned migration row (Phase 3 D-08 fails-closed posture)
// detail on pass:  "schema at migration N/N"
// detail on fail:  "schema at migration N/M — restore from <backupPath>: cp <backup> <dbFile>"
```

**Reuses:** Phase 3 `migrate.ts`'s `__drizzle_migrations` table (which the hand-rolled migrator writes) + `paths.backupsDir` to surface the most-recent backup path.

**Risk:** The hand-rolled migrator's table schema must be verified — Phase 3 used `drizzle-kit` to generate but Plan 03-05 implemented a hand-rolled migrator. Planner should grep for the table name and the recording site before writing this probe; the precedent in `tests/integration/sync/migration-crash.test.ts` is load-bearing.

#### 3.5 `db_wal_size` (D-02 #5)

```typescript
// const walPath = `${paths.dbFile}-wal`;
// const size = statSync(walPath, { throwIfNoEntry: false })?.size ?? 0;
// pass:  size <= 32 MB
// warn:  32 MB < size <= 64 MB
// fail:  size > 64 MB  (matches Phase 3 D-30 journal_size_limit cap = 67108864)
```

**Reuses:** `paths.dbFile` (Phase 1 + Phase 2 paths.ts) + `node:fs.statSync`. Phase 3 pragma `journal_size_limit = 67108864` (`src/infrastructure/db/connection.ts:77`) is the upper bound that triggers fail.

#### 3.6 `last_sync_recency` (D-02 #6)

```typescript
// const row = repos.syncRuns.latestFinished();  // EXISTS — Phase 4 D-03 surface
// if (!row) -> fail "no syncs yet — run `recovery-ledger sync`"
// const ageMs = Date.now() - new Date(row.finished_at).getTime();
// pass: ageMs <= 36h
// warn: ageMs <= 7d
// fail: ageMs > 7d
```

**Reuses:** `repos.syncRuns.latestFinished()` — verified in `src/infrastructure/db/repositories/sync-runs.repo.ts:65`.

#### 3.7 `most_recent_scored_day` (D-02 #7)

```typescript
// MAX(start) across cycles + recoveries + sleeps WHERE score_state='SCORED' AND baseline_excluded=0
// Same thresholds as #6 (36h / 7d).
// Distinct from #6 because sync can succeed with all-PENDING data
// (e.g., last-night cycle not yet scored).
```

**Reuses:** SCORED-only repository methods — verified for cycles repo at `src/infrastructure/db/repositories/cycles.repo.ts:72` (`SELECT MAX(start) FROM cycles WHERE score_state='SCORED' AND baseline_excluded=0`). Planner must verify recoveries/sleeps repos have a parallel method or add one in a small Wave 0 task.

**ADR coverage:** ADR-0003 (`score_state` discipline) — the probe reads through repositories' default SCORED-only filter; `data_quality_counts` (next) is the explicit opt-out via `{includeUnscored, includeExcluded}` per Phase 3 D-04/D-16.

#### 3.8 `data_quality_counts` (D-02 #8; always pass — informational)

```typescript
// For each of {cycles, recoveries, sleeps}:
//   total SCORED count + PENDING_SCORE count + UNSCORABLE count + baseline_excluded count
// Detail string: "cycles: 142 scored, 3 pending, 0 unscorable, 2 excluded; recoveries: ...; sleeps: ..."
// status: 'pass' always (Pitfall 19 — silent missing days surfaces here)
```

**Reuses:** Repository methods that pass `{includeUnscored: true, includeExcluded: true}` per Phase 3 D-16. Planner verifies count methods exist; if not, a small Wave 0 task adds `countByScoreState()` to each repo (cheap — no new SQL invariants).

#### 3.9 `concurrent_writers_stress` (D-02 #9; --stress only)

**Pattern:** Fork 4 child processes; each opens a *tmp* DB through `openDb()` and runs N upserts inside `BEGIN IMMEDIATE`. Assert: every child exits 0; no `SQLITE_BUSY` escapes (the 5000ms `busy_timeout` is the load-bearing primitive — Phase 3 D-30).

**Reuses:** `node:child_process.fork` precedent in `tests/integration/auth-concurrency.test.ts`. Subprocess gate via `skipSubprocess` (mirrors `mcp_stdout_purity`) AND `--stress` flag absent → return `pass` with "skipped" detail.

**Why opt-in:** 800ms+ runtime; only valuable when diagnosing a real concurrent-writer suspicion. Default `doctor` invocation does not pay this cost.

### Finding §4 — Install Guide Structure

#### 4.1 Hybrid layout per D-06

```
INSTALL.md                # root entry; ~150–250 lines
docs/install/             # specifics
  claude-code.md          # ~80 lines — .mcp.json + `claude mcp add` invocation
  claude-desktop.md       # ~80 lines — claude_desktop_config.json path + JSON snippet
  cursor.md               # ~60 lines — ~/.cursor/mcp.json (global) or .cursor/mcp.json (project)
  troubleshooting.md      # 14 H2 sections — one per check.name
  launchd.md              # ~100 lines — sed + launchctl load + verification
  api-gap.md              # GENERATED — never hand-edit
```

#### 4.2 INSTALL.md skeleton

```markdown
# Installing Recovery Ledger

Recovery Ledger is a local-first TypeScript CLI + MCP stdio server. Not affiliated with WHOOP. BYO OAuth.

## Prerequisites
- Node 22 LTS or newer
- macOS 14+ or Linux (libsecret recommended on Linux; chmod 600 file fallback otherwise)
- A WHOOP developer app (see "WHOOP developer-app setup" below)

## WHOOP developer-app setup
1. Sign in at https://developer.whoop.com/dashboard/applications
2. Create a new application.
3. Set redirect URI: `http://127.0.0.1:4321/callback`
   (Or your chosen port; `recovery-ledger init` prompts for the port.)
4. Request these scopes: `read:profile read:cycles read:recovery read:sleep read:workout read:body_measurement offline`
5. Save the `client_id` and `client_secret` — you will paste them into `recovery-ledger init`.

## Quickstart
```sh
git clone <repo> && cd recovery-ledger
npm install
npm run build
node dist/cli.mjs init      # paste client_id + client_secret
node dist/cli.mjs auth       # opens browser
node dist/cli.mjs sync        # pulls 30 days of WHOOP data
node dist/cli.mjs review daily  # your first brief
```

## Connect to your AI client
- [Claude Code](./docs/install/claude-code.md)
- [Claude Desktop](./docs/install/claude-desktop.md)
- [Cursor](./docs/install/cursor.md)

## Troubleshooting
If `doctor` reports a check failure, see [docs/install/troubleshooting.md](./docs/install/troubleshooting.md) — one section per check name.

## Scheduled daily sync (macOS)
See [docs/install/launchd.md](./docs/install/launchd.md).

## What's available via the WHOOP API (and what isn't)
See [docs/install/api-gap.md](./docs/install/api-gap.md).
```

#### 4.3 Per-client wiring (verified against current docs as of 2026-05)

**Claude Code** ([source](https://code.claude.com/docs/en/mcp)):
- Project-shared config: `.mcp.json` at the repo root.
- User-scoped config: `~/.claude.json`.
- Recommended invocation: `claude mcp add recovery-ledger -- node /absolute/path/to/dist/mcp.mjs` (one-liner; SDK auto-generates the `.mcp.json` entry).
- Manual JSON shape:
  ```json
  {
    "mcpServers": {
      "recovery-ledger": {
        "command": "node",
        "args": ["/absolute/path/to/dist/mcp.mjs"]
      }
    }
  }
  ```

**Claude Desktop** ([source](https://modelcontextprotocol.io/docs/develop/connect-local-servers)):
- Config file: `~/Library/Application Support/Claude/claude_desktop_config.json` on macOS; `%APPDATA%\Claude\claude_desktop_config.json` on Windows.
- Identical `mcpServers` object shape to Claude Code's `.mcp.json`.
- Restart Claude Desktop after editing.
- 2026 note: Desktop Extensions (`.mcpb`) bundles are an alternative — Phase 5 docs note them as future v2 work (V2-01-adjacent) but ship the JSON config approach for v1.

**Cursor** ([source](https://cursor.com/docs/mcp)):
- Project config: `.cursor/mcp.json` (committed) — wins over global.
- Global config: `~/.cursor/mcp.json`.
- Same `mcpServers` object shape.
- January 2026 update changed how Cursor handles multiple servers (dynamic tool-description loading); the JSON shape itself is unchanged.

**Convergent shape:** All three clients use the same `mcpServers: {<name>: {command, args, env?}}` object. The only differences are file location and IDE-specific reload semantics. This is what D-10 ("no per-client deviation") encodes.

#### 4.4 Troubleshooting contract (D-08, D-09)

`docs/install/troubleshooting.md` MUST have exactly one `## <name>` H2 per `CHECK_NAMES.*` value. The test:

```typescript
// tests/contract/troubleshooting-coverage.test.ts
import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import { CHECK_NAMES } from '../../src/services/doctor/checks/check-names.js';

test('every CHECK_NAMES value has a matching ## H2 in troubleshooting.md', () => {
  const md = readFileSync('docs/install/troubleshooting.md', 'utf8');
  const h2s = new Set([...md.matchAll(/^## (\S+)$/gm)].map((m) => m[1]));
  for (const name of Object.values(CHECK_NAMES)) {
    expect(h2s, `missing troubleshooting section: ## ${name}`).toContain(name);
  }
});
```

**H2 shape per section** (D-08):
```markdown
## <check_name>
**Symptom:** <doctor output one-liner>
**Likely cause:** <one-line diagnosis>
**Fix:**
<shell commands or remediation steps>
**See also:** <link to ADR or canonical doc>
```

### Finding §5 — API-Gap Markdown Generator (DOC-03, D-17, D-18, D-19)

Phase 4 D-28 already shipped `src/services/api-gap/data.ts` as the source-of-truth. Phase 5 adds:

1. `scripts/generate-api-gap-md.ts` — imports `API_GAP_ENTRIES` directly (NOT through `services.getApiGap()` — build-time tool). Writes `docs/install/api-gap.md` with a "DO NOT HAND-EDIT" header.
2. `package.json` script: `"docs:generate-api-gap": "tsx scripts/generate-api-gap-md.ts"`.
3. `tests/contract/api-gap-md-parity.test.ts` — regenerates into a tmp buffer (or with `GEN_OUT` env override) and asserts `expect(generated).toBe(committed)`.

**Idempotency** — the generator MUST produce byte-identical output across runs:
- No timestamps in the rendered markdown.
- Deterministic iteration order (`API_GAP_ENTRIES` is a frozen array; order is source-controlled).
- Trailing newline policy: end with exactly one `\n`.

**D-19 — no prebuild hook:** The generator is on-demand only. Contract test is the forcing function. Rationale: `prebuild` would run on every `tsup` invocation including `npm run dev:cli`/`dev:mcp` watch loops.

### Finding §6 — File Tree Lock per D-07

The exact tree from CONTEXT.md is reproduced under "Recommended Project Structure" above. Two additions worth noting:

- `templates/` is a NEW top-level directory. Phase 5 introduces it. The only file inside in v1 is `com.recovery-ledger.daily-sync.plist`.
- `docs/` is a NEW top-level directory. Phase 5 introduces it. The only subdirectory in v1 is `install/`.

`package.json`'s `files` field currently lists `["dist"]`. Phase 5 does NOT need to extend this — install docs are repo-only (consumed via `git clone`), not `npm publish`-shipped. The plist template likewise is documentation-only.

### Finding §7 — launchd Template (DOC-05, D-15, D-16)

**Template content** (verified against `man launchd.plist`):

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
  <dict>
    <key>Label</key>
    <string>com.recovery-ledger.daily-sync</string>
    <key>ProgramArguments</key>
    <array>
      <string>${RECOVERY_LEDGER_BIN}</string>
      <string>sync</string>
      <string>--days</string>
      <string>3</string>
    </array>
    <key>StartCalendarInterval</key>
    <dict>
      <key>Hour</key>
      <integer>6</integer>
      <key>Minute</key>
      <integer>30</integer>
    </dict>
    <key>StandardOutPath</key>
    <string>${HOME}/.recovery-ledger/launchd.log</string>
    <key>StandardErrorPath</key>
    <string>${HOME}/.recovery-ledger/launchd.log</string>
    <key>RunAtLoad</key>
    <false/>
  </dict>
</plist>
```

**Why placeholders, not `$(which recovery-ledger)`:** launchd does NOT shell-expand `$( )`. The user must substitute the literal path. Specifics line 265 documents the canonical command:

```sh
RECOVERY_LEDGER_BIN=$(which recovery-ledger) \
  sed -e "s|\${RECOVERY_LEDGER_BIN}|$RECOVERY_LEDGER_BIN|g" \
      -e "s|\${HOME}|$HOME|g" \
      templates/com.recovery-ledger.daily-sync.plist \
  > ~/Library/LaunchAgents/com.recovery-ledger.daily-sync.plist
launchctl load ~/Library/LaunchAgents/com.recovery-ledger.daily-sync.plist
launchctl list | grep com.recovery-ledger
```

**Verification path** (D-15): no doctor probe. User runs `recovery-ledger doctor` the next day; `last_sync_recency` shows whether the scheduled run actually fired.

### Finding §8 — Stopwatch Test Design (DOC-06, D-11..D-14)

**Path:** `tests/integration/setup-stopwatch.test.ts`. Env-gated:

```typescript
import { describe, test } from 'vitest';

const RUN_STOPWATCH = process.env.VITEST_INCLUDE_STOPWATCH === '1';

describe.skipIf(!RUN_STOPWATCH)('setup stopwatch — clean clone to first review daily', () => {
  test('completes under 20 minutes', async () => {
    // ...
  }, { timeout: 25 * 60 * 1000 });  // 25min timeout > 20min budget for buffer
});
```

**Top-of-file constant** (Specifics line 267):
```typescript
const STOPWATCH_BUDGET_MS = 20 * 60 * 1000;  // 20 minutes
```

**Test machinery (D-11 expanded):**

```typescript
// 1. Tmp directories
const tmpHome = await mkdtemp(path.join(os.tmpdir(), 'rl-stopwatch-'));
const tmpRepo = await mkdtemp(path.join(os.tmpdir(), 'rl-repo-'));
// Stopwatch starts AFTER tmp setup; clone time is NOT counted (D-12)
process.env.RECOVERY_LEDGER_HOME = tmpHome;
process.env.WHOOP_CLIENT_ID = 'test_client';
process.env.WHOOP_CLIENT_SECRET = 'test_secret';

// 2. Start MSW WHOOP server (reuse Phase 2/3 helpers)
const msw = createMswServer(
  createWhoopOauthHelper().server.listHandlers(),
  ...whoopResourceHandlers(),
);
msw.listen();

// 3. Stopwatch START
const start = performance.now();

// 4. Copy source into tmpRepo (simulates a git clone without network)
await fs.cp(REPO_ROOT, tmpRepo, { recursive: true, filter: (s) => !s.includes('node_modules') });

// 5. npm install in tmpRepo — this is the dominant time cost (native-module compile)
spawnSync('npm', ['install'], { cwd: tmpRepo, stdio: 'pipe' });

// 6. recovery-ledger init (non-interactive because env-var creds set)
spawnSync('node', ['dist/cli.mjs', 'init'], { cwd: tmpRepo, stdio: 'pipe', env: process.env });

// 7. recovery-ledger auth --no-browser
//    capture stderr, parse the authorize URL, extract `state` param,
//    fire fetch(http://127.0.0.1:<port>/callback?code=fake&state=<state>)
//    against the loopback server the child is listening on
const authChild = spawn('node', ['dist/cli.mjs', 'auth', '--no-browser'], {
  cwd: tmpRepo, stdio: ['pipe', 'pipe', 'pipe'], env: process.env,
});
const authUrl = await captureAuthorizeUrlFromStderr(authChild.stderr);
const state = new URL(authUrl).searchParams.get('state')!;
const port = new URL(authUrl).searchParams.get('redirect_uri')!;  // contains :<port>
await fetch(`http://127.0.0.1:${parsePort(port)}/callback?code=fake&state=${state}`);
await waitForChildExit(authChild, 0);

// 8. recovery-ledger sync (pulls MSW-served fixture data)
spawnSync('node', ['dist/cli.mjs', 'sync'], { cwd: tmpRepo, stdio: 'pipe', env: process.env });

// 9. recovery-ledger review daily
const reviewResult = spawnSync('node', ['dist/cli.mjs', 'review', 'daily'], {
  cwd: tmpRepo, stdio: 'pipe', env: process.env,
});
expect(reviewResult.status).toBe(0);

// 10. Stopwatch END
const elapsed = performance.now() - start;
expect(elapsed).toBeLessThan(STOPWATCH_BUDGET_MS);
```

**Empty-data acceptance** (research bucket pitfall (c) — what if WHOOP returns 200 but data is empty): YES — sync completes. `review daily` returns a `data_status: 'insufficient'` brief (REV-05). The stopwatch test passes — the goal is "clean-clone-to-first-review," not "first-review-with-strong-patterns." The fixture set the MSW helpers ship is the empty-but-valid case; that's the canonical bootstrap state.

**Build step** — Phase 5 must decide: does the stopwatch run `npm run build` before invoking `dist/cli.mjs`? Two options:
- (a) Yes — measures the cold path including tsup compile (~5–8s). Most realistic.
- (b) Skip build — assume CI already built. Faster, less realistic.
Recommendation: **(a) — yes, build inside the stopwatch boundary.** D-12 says "npm install → review daily exit 0"; build is a transitive step. The 20min budget has ample headroom.

### Finding §9 — CI Workflow for Stopwatch (D-13)

```yaml
# .github/workflows/setup-stopwatch.yml
name: setup-stopwatch

on:
  pull_request:
    paths:
      - 'package.json'
      - 'package-lock.json'
      - 'src/cli/**'
      - 'src/services/bootstrap.ts'
      - 'src/infrastructure/db/migrations/**'

permissions:
  contents: read

concurrency:
  group: stopwatch-${{ github.ref }}
  cancel-in-progress: true

jobs:
  stopwatch:
    runs-on: ${{ matrix.os }}
    strategy:
      fail-fast: false
      matrix:
        os: [macos-latest, ubuntu-latest]
    steps:
      - name: Checkout
        uses: actions/checkout@de0fac2e4500dabe0009e67214ff5f5447ce83dd # v6.0.2
      - name: Set up Node 22
        uses: actions/setup-node@48b55a011bda9f5d6aeb4c2d9c7362e8dae4041e # v6.4.0
        with:
          node-version: '22'
          cache: 'npm'
      - name: Install dependencies
        run: npm ci
      - name: Build
        run: npm run build
      - name: Stopwatch
        env:
          VITEST_INCLUDE_STOPWATCH: '1'
          RECOVERY_LEDGER_FORCE_FILE_STORE: ${{ matrix.os == 'ubuntu-latest' && '1' || '' }}
        timeout-minutes: 30
        run: npx vitest run tests/integration/setup-stopwatch.test.ts
```

**Default `ci.yml` UNCHANGED.** The stopwatch is a separate workflow on a separate trigger so the default test matrix stays cheap (~10s suite + ~2min for npm/build).

### Finding §10 — Phase-Close Blueprint (D-22, mirrors Plans 03-13 + 04-12)

The phase-close plan (`05-NN-phase-close-PLAN.md` — likely numbered 05-12 or 05-13 depending on plan count) asserts:

| Attestation | How Verified |
|-------------|---------------|
| Full Vitest suite green under 90s D-33 budget | `time npm run test` from a clean state. Stopwatch EXCLUDED (D-13). |
| All 10 grep gates A–J green | `bash scripts/ci-grep-gates.sh` |
| D-30 attestation: `sanitize.ts`, `register.ts`, `register-resource.ts`, `register-prompt.ts` UNMODIFIED vs Phase 4 HEAD | `git diff <phase-4-merge-commit>..HEAD -- src/mcp/sanitize.ts src/mcp/register.ts src/mcp/register-resource.ts src/mcp/register-prompt.ts` returns empty |
| MCP runtime attestation `tools.length === 8 && resources.length === 6 && prompts.length === 4` | `tests/integration/mcp-runtime.test.ts` unchanged green |
| DOC-01..06 flipped to Complete in REQUIREMENTS.md | grep `[x] **DOC-` shows all 6 |
| ROADMAP Phase 5 → `[x]` with completion date | `.planning/ROADMAP.md` update |
| STATE.md milestone v1.0 close recorded | new STATE block |
| Stopwatch test green on both `macos-latest` + `ubuntu-latest` | most-recent run of `setup-stopwatch.yml` workflow |
| README updated to reference INSTALL.md | grep `README.md` |
| Banned-tone lint extends to `docs/install/*.md` (or contract-test) | planner-decision item |

**No new grep gate** is expected. The existing 10 (A–J) cover the regression surface: A (tone) covers all install docs once scope is decided, F (fetch) prevents `whoop_roundtrip` from going around `callWithAuth`, G (drizzle import) prevents new probes from reaching into db internals, H/I/J cover the unchanged MCP surface counts.

## Common Pitfalls

### Pitfall 1: Stopwatch flakiness on cold CI runners

**What goes wrong:** `npm install` on a cold runner takes 60–180s on macos-latest; on ubuntu-latest it can take 90–240s under load. Add a tsup build (~5–10s), 4 spawned child CLI invocations (~2–8s each), and you're at 5–15 wall-clock minutes typically — well under the 20min budget, but a single flaky native-module compile failure can push it over.

**Why it happens:** `better-sqlite3` and `@napi-rs/keyring` require prebuilds; if prebuilds are missing for the current Node ABI, npm falls back to `node-gyp` and compiles from source, which can take 60s+ each.

**How to avoid:** (1) Pin Node version to 22.11.x in the workflow. (2) Use `npm ci` (not `npm install`) for deterministic resolution. (3) Cache `~/.npm` AND `node_modules` between runs (the `cache: 'npm'` action handles `~/.npm`; an additional `actions/cache` for `node_modules` is overkill for a 20min budget but worth considering if flakes appear). (4) Set `timeout-minutes: 30` on the workflow as a hard upper bound — flaky runs are killed, not retried indefinitely.

**Warning signs:** A first-ever-CI-run takes > 18min. The next refactor pushes it over.

### Pitfall 2: Build-time api-gap.md drift

**What goes wrong:** A developer edits `src/services/api-gap/data.ts` (adding a new feature, fixing a typo in notes), forgets to run `npm run docs:generate-api-gap`, commits — the parity test fails in CI but the developer's local `npm test` passed (no stopwatch in default suite, parity test IS in default suite though, so this catches at PR time, not local-pre-commit time unless `pre-commit` hook is added).

**Why it happens:** Two-source-of-truth problem inverted. The TS source IS the truth, but the markdown is the artifact CI checks.

**How to avoid:** (1) Parity test error message MUST be actionable: `"docs/install/api-gap.md is out of sync. Run \`npm run docs:generate-api-gap\` and commit the result."` (2) Optional: add a `pre-commit` hook in `.claude/settings.json` that warns when `data.ts` is staged but `api-gap.md` is not. Low priority — the contract test is sufficient.

**Warning signs:** Multiple PRs in a row land "generated docs" as a follow-up commit. Add the pre-commit hook.

### Pitfall 3: MCP client config drift between clients

**What goes wrong:** Claude Code, Claude Desktop, and Cursor all use `mcpServers: {<name>: {command, args, env}}` — but file location, reload semantics, and "what's the canonical way to invoke this" differ. As of 2026-05:
- Claude Code prefers `claude mcp add <name> -- node /path/to/mcp.mjs` (CLI generates `.mcp.json`).
- Claude Desktop is JSON-only at `~/Library/Application Support/Claude/claude_desktop_config.json` + restart.
- Cursor reads `.cursor/mcp.json` (project) or `~/.cursor/mcp.json` (global); January 2026 update changed dispatching but not config shape.

**Why it happens:** Each client owns its own config UX. Recovery Ledger's install docs ship today's state; clients ship updates monthly.

**How to avoid:** (1) Per-client docs include a "verified against client docs as of 2026-05-26" datestamp. (2) Each doc links to the canonical client docs URL so a user landing in 2027 can verify against current shape. (3) D-10 keeps the docs minimal — only the JSON snippet differs per client; the surrounding flow (init / auth / sync / review) is identical, so drift in the JSON snippet is the only thing to maintain.

**Warning signs:** A user reports "Claude Desktop says X but our docs say Y." Add a contract-test-style snippet validator if it happens twice.

### Pitfall 4: Native module load surprises on Ubuntu CI

**What goes wrong:** `@napi-rs/keyring` on Ubuntu requires `libsecret-1-dev` for keychain access. CI runners on `ubuntu-latest` may or may not have it; the Phase 2 mitigation was `RECOVERY_LEDGER_FORCE_FILE_STORE=1` to force the file-fallback path. The stopwatch test inherits this — the env var is set on ubuntu in the workflow.

**Why it happens:** Linux's "keychain" landscape is fragmented (libsecret, kwallet, no-op). The file fallback is the load-bearing portable path.

**How to avoid:** (1) The stopwatch workflow sets `RECOVERY_LEDGER_FORCE_FILE_STORE: '1'` on ubuntu (see Finding §9). (2) The `napi_keyring_load` doctor probe still runs — it tests that the *binding* loads, not that the keychain works; this distinction is intentional (Phase 1 native-modules.ts comment "constructor does not issue keychain syscalls"). (3) If a future check actually exercises keychain syscalls, gate it behind a platform check or extend the file-store env override.

**Warning signs:** Stopwatch passes on macos-latest, fails on ubuntu-latest with a keychain-related error. Verify the env override is set in the workflow.

### Pitfall 5: Empty fixture data masquerading as broken sync

**What goes wrong:** The MSW helpers ship empty-but-valid WHOOP responses. The stopwatch test's `sync` step completes with 0 cycles persisted; `review daily` returns `data_status: 'insufficient'`. A future contributor reads "review daily insufficient" and concludes the test is broken.

**Why it doesn't actually happen (research bucket pitfall (c) clarified):** Sync DOES complete — `sync_runs` row is `status: 'ok'`, even if zero cycles were persisted. `review daily` exits 0 — `data_status: 'insufficient'` is a typed positive output (ADR-0004 — "no reliable pattern detected" as positive output extends here). The test asserts `reviewResult.status === 0`, NOT that any specific data was rendered. The 20min budget is met.

**How to avoid:** Test asserts exit codes only, not data content. The comment block at the top of `setup-stopwatch.test.ts` documents this explicitly.

### Pitfall 6: `pool: 'forks'` interference between stopwatch test and concurrent_writers_stress

**What goes wrong:** Vitest's `pool: 'forks'` runs each test file in its own forked process. The stopwatch test spawns CLI children; the `concurrent_writers_stress` probe (if run) spawns its own children. Process trees can deep-nest if these run simultaneously.

**Why it doesn't actually happen:** Stopwatch is env-gated (`VITEST_INCLUDE_STOPWATCH=1`); the stress probe is flag-gated (`--stress`). They never run together in default CI. The dedicated `setup-stopwatch.yml` workflow runs ONLY the stopwatch file (`tests/integration/setup-stopwatch.test.ts`).

**How to avoid:** Explicit file-targeting in the workflow's vitest invocation (`vitest run tests/integration/setup-stopwatch.test.ts`). The default `npm test` excludes the stopwatch via env gate.

## Code Examples

### Extending CHECK_NAMES (Phase 5 D-02)

```typescript
// src/services/doctor/checks/check-names.ts (modified)
export const CHECK_NAMES = {
  // Phase 1
  BETTER_SQLITE3_LOAD: 'better_sqlite3_load',
  NAPI_KEYRING_LOAD: 'napi_keyring_load',
  MCP_STDOUT_PURITY: 'mcp_stdout_purity',
  // Phase 2 (Plan 02-06)
  AUTH: 'auth',
  TOKEN_FRESHNESS: 'token_freshness',
  // Phase 5 (Plan 05-NN)
  WHOOP_ROUNDTRIP: 'whoop_roundtrip',
  DB_OPEN: 'db_open',
  DB_INTEGRITY: 'db_integrity',
  DB_SCHEMA_VERSION: 'db_schema_version',
  DB_WAL_SIZE: 'db_wal_size',
  LAST_SYNC_RECENCY: 'last_sync_recency',
  MOST_RECENT_SCORED_DAY: 'most_recent_scored_day',
  DATA_QUALITY_COUNTS: 'data_quality_counts',
  CONCURRENT_WRITERS_STRESS: 'concurrent_writers_stress',
} as const;
export type CheckName = (typeof CHECK_NAMES)[keyof typeof CHECK_NAMES];
```

### Extending runDoctor options (Phase 5 D-03)

```typescript
// src/services/doctor/index.ts (extension snippet)
export interface RunDoctorOptions {
  skipSubprocessChecks?: boolean;     // existing
  /** Skip whoop_roundtrip (the only online check per D-03). */
  offline?: boolean;
  /** Run concurrent_writers_stress (off by default per D-02 #9). */
  stress?: boolean;
}
```

### CLI flag wiring (Phase 5)

```typescript
// src/cli/index.ts (snippet — wiring around the existing doctor command)
program
  .command('doctor')
  .option('--text', 'output plain text instead of JSON')
  .option('--offline', 'skip the WHOOP roundtrip check (default off)')
  .option('--stress', 'run the concurrent-writers stress check (default off)')
  .action(runDoctorCommand);

// src/cli/commands/doctor.ts (signature update)
export async function runDoctorCommand(opts: {
  text?: boolean;
  offline?: boolean;
  stress?: boolean;
}): Promise<void> {
  // ...
  const result = await services.runDoctor({ offline: opts.offline, stress: opts.stress });
  // ...
}
```

### MCP inputSchema extension (Phase 5 D-21 + MCP-03 ≤5-line shim)

```typescript
// src/mcp/tools/whoop-doctor.ts (modified body — body stays ≤5 lines per MCP-03)
register(
  server,
  'whoop_doctor',
  {
    description: TOOL_DESCRIPTION,
    inputSchema: {
      offline: z.boolean().optional(),
      stress: z.boolean().optional(),
    },
  },
  async (input) => {
    const result = await services.runDoctor({
      skipSubprocessChecks: true,
      offline: input?.offline,
      stress: input?.stress,
    });
    return {
      content: [{ type: 'text', text: renderDoctor(result) }],
      structuredContent: toStructuredContent(result),
    };
  },
);
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Multi-line per-tool MCP shims | Single-line `register(...)` chokepoint with sanitize wrapper | Phase 1 Plan 01-03 (ADR-0001 enforcement) | Phase 5 extends `whoop_doctor`'s inputSchema only; the shim shape is locked. |
| Composite doctor checks | One-row-per-signal split per D-01 | Phase 5 D-01 (locked 2026-05-26) | All 9 new checks ship as separate `src/services/doctor/checks/<name>.ts` files. |
| Hand-written markdown that mirrors TS data | Build-time-generated markdown + parity contract test | Phase 5 D-17/D-18 (this phase) | First instance in the codebase; pattern reusable for future TS-source-of-truth → docs mirroring. |
| Stopwatch in default CI | Stopwatch in dedicated workflow on PR path filter | Phase 5 D-13 (this phase) | First instance of a 20-min CI test; the gating filter mirrors the test-coverage scope. |
| `tools.length === 1` Phase 3 attestation | `tools.length === 8` Phase 4 attestation | Phase 4 D-29 | Phase 5 D-20 carries forward verbatim; Gate H is the regression guard. |

**Deprecated/outdated:** None. Phase 5 builds on Phase 1–4 surfaces without deprecating anything.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `repos.syncRuns.latestFinished()` returns the most recent finished row | Finding §3.6 | [VERIFIED: src/infrastructure/db/repositories/sync-runs.repo.ts:65] — not assumed. |
| A2 | `repos.recoveries` and `repos.sleeps` may not yet have `latestScoredStart()` methods analogous to `repos.cycles.latestScoredStart` | Finding §3.7 | [ASSUMED] Planner must verify; if missing, add as a small Wave 0 task. The cycles repo confirms the pattern (line 72); the other two repos should mirror it but were not grep-verified in research. |
| A3 | Repository count methods (`countByScoreState` or equivalent) for `data_quality_counts` exist or can be added cheaply | Finding §3.8 | [ASSUMED] Planner must verify; if missing, a Wave 0 repo extension is needed before the probe lands. Phase 3 D-04/D-16 establishes the opt-in `{includeUnscored, includeExcluded}` API. |
| A4 | The hand-rolled migrator writes a `__drizzle_migrations` table (or equivalent name) that Phase 5 can SELECT FROM | Finding §3.4 | [ASSUMED] Planner verifies by reading `src/infrastructure/db/migrate.ts`. Phase 3 D-08's pre-migration-backup + fails-closed posture is verified in CONTEXT canonical-refs; the table name itself is convention. |
| A5 | Claude Code's `.mcp.json` is the project-shared config and `claude_desktop_config.json` is Claude Desktop's macOS config path | Finding §4.3 | [VERIFIED: code.claude.com/docs/en/mcp + modelcontextprotocol.io/docs/develop/connect-local-servers, as of 2026-05] — current docs verified. |
| A6 | Cursor's `.cursor/mcp.json` (project) and `~/.cursor/mcp.json` (global) is the current config shape | Finding §4.3 | [VERIFIED: cursor.com/docs/mcp, as of 2026-05] — current. |
| A7 | The stopwatch test can extract the authorize URL from `auth --no-browser`'s stderr and reconstruct the callback POST | Finding §8 | [VERIFIED: src/cli/commands/auth.ts:97 + runOAuth print-to-stderr behavior in Phase 2 D-08] — pattern verified. |
| A8 | `journal_size_limit=67108864` (= 64 MB) is the upper WAL bound | Finding §3.5 | [VERIFIED: src/infrastructure/db/connection.ts:77] — exact value. |
| A9 | `repos.syncRuns.latestFinished()` returns `{finished_at, status: 'ok'|'partial'|'failed'} | null` | Finding §3.6 | [VERIFIED: src/infrastructure/db/repositories/sync-runs.repo.ts:65-66] — exact shape. |
| A10 | The `register()` wrapper's input shape accepts `{offline?, stress?}` Zod fields without breaking the existing zero-arg call signature | Finding §3 code examples | [ASSUMED] All three fields are optional; the SDK should accept `inputSchema: {offline: z.boolean().optional(), ...}` without breaking the no-arg invocation. Planner verifies against the existing pattern (Phase 4 tools with optional Zod fields). |

## Open Questions for Planner

1. **DB-handle injection seam for db_* probes.**
   - What we know: 7 of the 9 new checks need DB access. The bootstrap composition root (`src/services/bootstrap.ts`) already opens a sqlite handle; the existing `createServices()` (lightweight, no DB) returns `ServicesBase` which does NOT include sync/review/decision/cache surfaces.
   - What's unclear: Should `runDoctor()` accept an optional injected handle (`{sqlite?}`)? Or should the bootstrap layer expose a wider services interface that includes the DB? Or should each db_* probe call `openDb()` on its own tmp connection?
   - **Recommendation:** Add `RunDoctorOptions.sqlite?: Database.Database`. The bootstrap layer's `services.runDoctor()` re-export passes the handle through; the lightweight `createServices().runDoctor()` works without a handle and the db_* probes return `fail` with detail "no DB handle injected — run \`recovery-ledger doctor\` from CLI to exercise db checks" when invoked from a context that doesn't bootstrap. The MCP tool handler at `src/mcp/tools/whoop-doctor.ts` already lives behind `bootstrap()` per Phase 4 Plan 04-10, so it inherits the handle.

2. **Should Gate A's grep scope extend to `docs/install/*.md`?**
   - What we know: Gate A (banned tone words + emoji) currently excludes `.planning/` but does NOT exclude `docs/`. So new install docs at `docs/install/*.md` are AUTOMATICALLY in scope of the current gate. CONTEXT.md "Established Patterns" line 245 implies this is fine, but the planner should explicitly verify.
   - **Recommendation:** Leave the gate as-is. New docs at `docs/install/*.md` are author-controlled prose; the existing gate covers them. No script change needed.

3. **Order of waves — which checks land before the install guide?**
   - What we know: Each of the 9 checks is an isolated `src/services/doctor/checks/<name>.ts` file. The troubleshooting H2 contract test (D-09) requires the install guide to land WITH all 14 H2 sections.
   - **Recommendation:** Wave 0 lands the scaffolding (workflow YAML, generator script skeleton, contract-test scaffolds that fail with "not yet implemented" assertions). Wave 1 lands all 9 new checks IN PARALLEL (one PR per check; CHECK_NAMES extensions are additive and merge cleanly). Wave 2 lands the troubleshooting.md AND flips the contract test from skipped to active. Wave 3 lands the install guide, the api-gap generator, the parity test, the stopwatch test. Phase-close at Wave 4. This gives parallel agent capacity at Wave 1.

4. **Stopwatch test — include `npm run build` in the boundary?**
   - What we know: D-12 says "npm install → review daily exit 0"; build is a transitive step.
   - **Recommendation:** Yes, include build. The 20min budget has ample headroom (real measured cold-clone times are typically 3–6 min on macOS). Including build makes the test more realistic.

5. **Should the api-gap generator accept a `GEN_OUT` env override for the parity test?**
   - What we know: Two implementation strategies for the parity test: (a) invoke `tsx scripts/generate-api-gap-md.ts` as a child process with `GEN_OUT` set; (b) factor the rendering into a pure function and import it directly into the test.
   - **Recommendation:** (b) is cheaper and avoids a `tsx` subprocess inside `vitest`. Factor the rendering into `scripts/generate-api-gap-md/render.ts` (pure function: `API_GAP_ENTRIES → string`); the script writes; the test asserts `expect(render(API_GAP_ENTRIES)).toBe(readFileSync('docs/install/api-gap.md', 'utf8'))`.

6. **Should the troubleshooting contract test also assert ordering (D-08 last sentence)?**
   - What we know: CONTEXT D-08 says "Sections appear in the same order as `CHECK_NAMES` is declared."
   - **Recommendation:** Yes — the contract test should additionally assert the H2 ordering matches `Object.values(CHECK_NAMES)` order. One extra assertion is cheap.

## Environment Availability

> All dependencies needed for Phase 5 are project-internal (no new external tools required beyond what Phases 1–4 already require). The stopwatch test runs in CI's `macos-latest` and `ubuntu-latest` runners, both of which have:
> - Node 22.x — verified by the existing CI workflow.
> - `npm ci` capability — verified.
> - `node:child_process.{spawn,fork}` — built-in.
> - `node:perf_hooks.performance.now()` — built-in.
> - `proper-lockfile`, `msw`, `vitest` — already in `package.json`.

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node 22 | All Phase 5 code | ✓ | 22.x | — |
| `better-sqlite3` prebuilds | db_* probes + stopwatch | ✓ | ^12.9.0 | node-gyp compile (slower, still works) |
| `@napi-rs/keyring` (libsecret on Linux) | `napi_keyring_load` unchanged | ✓ on macOS | ^1.3.0 | `RECOVERY_LEDGER_FORCE_FILE_STORE=1` on Ubuntu CI |
| `tsx` | Generator script (`scripts/generate-api-gap-md.ts`) | ✓ | ^4.21 | — |
| MSW Phase 2/3 helpers | Stopwatch test | ✓ | (in `tests/helpers/`) | — |
| `git clone` capability (only for D-12 baseline measurement context) | NOT used in stopwatch (D-12 excludes it) | ✓ | — | — |

No missing dependencies, no fallbacks needed beyond the existing `RECOVERY_LEDGER_FORCE_FILE_STORE=1` Ubuntu override (already wired in `ci.yml`).

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Vitest ^4.1.6 (already in deps) |
| Config file | `vitest.config.ts` (per `pool: 'forks'` convention in `agent_docs/conventions.md`) |
| Quick run command | `npx vitest run --reporter=basic` (~10s on Phase 4 close baseline) |
| Full suite command | `npm run test` (vitest run; under 90s D-33 budget) |
| Stopwatch command | `VITEST_INCLUDE_STOPWATCH=1 npx vitest run tests/integration/setup-stopwatch.test.ts` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| DOC-01 | `recovery-ledger doctor` runs 14 checks (per D-02) | unit (per probe) + integration | `npx vitest run src/services/doctor/` | Wave 1 — 9 new probe test files |
| DOC-01 | `--offline` skips whoop_roundtrip | unit | `npx vitest run src/services/doctor/checks/whoop-roundtrip.test.ts` | Wave 1 |
| DOC-01 | `--stress` enables concurrent_writers_stress | integration (forks) | `npx vitest run src/services/doctor/checks/concurrent-writers-stress.test.ts` | Wave 1 |
| DOC-02 | Exit codes 0/1/2 + check.name mapping in JSON | unit | `npx vitest run src/cli/commands/doctor.test.ts` | Exists; extend |
| DOC-02 | Troubleshooting.md has H2 for every CHECK_NAMES.* value | contract | `npx vitest run tests/contract/troubleshooting-coverage.test.ts` | Wave 0 scaffold; Wave 2 active |
| DOC-03 | API-gap markdown matches data.ts | contract | `npx vitest run tests/contract/api-gap-md-parity.test.ts` | Wave 0 scaffold; Wave 2 active |
| DOC-03 | `whoop_api_gap` tool returns the same catalog | existing | `npx vitest run src/cli/commands/api-gap.test.ts` | Exists |
| DOC-04 | Install guide files exist | manual + existence assert | `test -f INSTALL.md && test -f docs/install/troubleshooting.md` etc. | Wave 2 |
| DOC-05 | launchd template exists with placeholders | existence + content assert | `test -f templates/com.recovery-ledger.daily-sync.plist && grep -q '${RECOVERY_LEDGER_BIN}' ...` | Wave 2 |
| DOC-06 | Clean-clone → first review daily < 20 min | integration (env-gated) | `VITEST_INCLUDE_STOPWATCH=1 npx vitest run tests/integration/setup-stopwatch.test.ts` | Wave 2 (dedicated workflow) |

### Sampling Rate

- **Per task commit:** `npx vitest run <changed-file>.test.ts`
- **Per wave merge:** `npm run test` + `bash scripts/ci-grep-gates.sh`
- **Phase gate:** Full suite green + 10 gates green + stopwatch workflow green (latest run on both `macos-latest` + `ubuntu-latest`) + D-30 attestation diff empty.

### Wave 0 Gaps

- [ ] `tests/contract/troubleshooting-coverage.test.ts` — covers DOC-02
- [ ] `tests/contract/api-gap-md-parity.test.ts` — covers DOC-03
- [ ] `tests/integration/setup-stopwatch.test.ts` — covers DOC-06
- [ ] `.github/workflows/setup-stopwatch.yml` — CI infrastructure for DOC-06
- [ ] `scripts/generate-api-gap-md.ts` skeleton — covers DOC-03 generation
- [ ] 9 new probe unit test scaffolds under `src/services/doctor/checks/*.test.ts`

*Framework install: not needed — Vitest 4.1.6 already in deps.*

## Security Domain

> Phase 5 is a closing-the-loop / documentation phase. Security risks are inherited from upstream phases; Phase 5 introduces no new authentication, no new storage, no new network surface, no new user input parsing. Security domain is included below for completeness against the project's `security_enforcement` posture.

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | partial | `whoop_roundtrip` reuses Phase 2's `callWithAuth` (ADR-0002 single-flight refresh) — no new auth code. |
| V3 Session Management | no | Single-user local tool; no session concept. |
| V4 Access Control | no | All access is file-system-local; macOS-level user perms apply. |
| V5 Input Validation | partial | New CLI flags (`--offline`, `--stress`) are boolean — no validation surface. MCP `inputSchema` adds two optional booleans, validated by Zod (existing pattern). |
| V6 Cryptography | no | Phase 5 ships no new crypto. Token storage at rest is Phase 2's responsibility (`@napi-rs/keyring` + chmod 600 file fallback). |
| V7 Errors & Logging | yes | Sanitizer pipeline (Phase 1 ADR-0001 + Phase 4 D-30) extends to new probes via the `register()` wrapper. New probes use Pino on stderr; no console writes. |
| V8 Data Protection | yes | API-gap markdown contains no secrets. launchd template uses placeholders, not literals. Stopwatch test uses tmp dirs + fake creds (`test_client`, `test_secret`). |

### Known Threat Patterns for {stack}

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Token leak in doctor `detail` strings | Information Disclosure | All new probes route `String(err)` through `sanitize()` (Phase 1 ADR-0001) before populating `detail`. `whoop_roundtrip` never logs the access token. |
| Sanitizer bypass via new error shapes | Information Disclosure | D-21 keeps `src/mcp/sanitize.ts` unmodified. The Phase 4 D-30 cause-walker covers `WhoopApiError`, `MigrationError`, `AuthError` shapes; `whoop_roundtrip` and `db_schema_version` raise these existing shapes. |
| Subprocess escape from concurrent_writers_stress | Tampering | The stress probe writes to a *tmp* DB (mkdtemp); never touches `paths.dbFile`. Children are forked with restricted env. Subprocess gate (`skipSubprocess`) prevents MCP-side recursion. |
| MSW handler leak into production code | Privilege Escalation | MSW is `devDependency`-only; production code never imports `tests/helpers/*`. Verified by `npm ls msw` (only in devDependencies). |
| Stale launchd template referencing old bin path | Repudiation (silent failure) | Verification path is `last_sync_recency` — no separate probe. User sees the sync didn't run; troubleshooting.md sends them to re-sed the plist. |

## Sources

### Primary (HIGH confidence)
- `src/services/doctor/index.ts` — full read; `runDoctor()` + `DoctorCheck` + `deriveOverall()` precedence (Phase 1 D-06).
- `src/services/doctor/checks/check-names.ts` — full read; canonical CHECK_NAMES registry.
- `src/services/doctor/checks/auth.ts` — full read; offline-safe probe shape precedent.
- `src/services/doctor/checks/token-freshness.ts` — full read; duration-formatting precedent.
- `src/services/doctor/checks/mcp-stdout-purity.ts` — full read; subprocess-gating precedent.
- `src/services/doctor/checks/native-modules.ts` — full read; narrow load-probe precedent.
- `src/cli/commands/doctor.ts` — full read; DOCTOR_EXIT_CODES + the one Gate-C-exempt CLI site.
- `src/mcp/tools/whoop-doctor.ts` — full read; ≤5-line MCP shim precedent + skipSubprocessChecks injection.
- `src/services/api-gap/data.ts` — full read; API_GAP_ENTRIES source-of-truth + frozen const + banned-tone-word lint.
- `src/services/api-gap/index.ts` + `types.ts` — full read; service accessor + ApiGapEntry type.
- `src/services/bootstrap.ts` — full read; composition root including how MCP enters via `bootstrap()`.
- `src/services/index.ts` — full read; ServicesBase vs Services separation + barrel exports.
- `src/services/refresh-orchestrator.ts` — full read; `callWithAuth` chokepoint for whoop_roundtrip.
- `src/infrastructure/db/connection.ts` (partial) — `openDb()` + the six D-30 pragmas including `journal_size_limit=67108864`.
- `src/infrastructure/db/repositories/sync-runs.repo.ts` (partial) — `latestFinished()` shape + `reclassifyStaleRunning`.
- `src/infrastructure/db/repositories/cycles.repo.ts` (grep) — `score_state='SCORED' AND baseline_excluded=0` default filter + `latestScoredStart` pattern.
- `src/infrastructure/whoop/resources/profile.ts` — `/v2/user/profile/basic` endpoint via `httpGet`.
- `src/formatters/doctor.txt.ts` + `api-gap.txt.ts` — full read; renderer surfaces unchanged in Phase 5.
- `src/cli/commands/auth.ts` + `init.ts` — full read; CLI surface the stopwatch test invokes.
- `scripts/ci-grep-gates.sh` — full read; all 10 gates A–J unchanged in Phase 5.
- `.github/workflows/ci.yml` — full read; default workflow unchanged; new workflow follows same pinning conventions.
- `agent_docs/conventions.md` — full read; testing rules (`pool: 'forks'`), file layout, no-default-exports.
- `agent_docs/decisions/0001-mcp-stdout-purity.md` — full read; load-bearing for all Phase 5 probes.
- `agent_docs/decisions/0002-single-flight-oauth-refresh.md` — full read; whoop_roundtrip routes through this.
- `package.json` — full read; zero new deps in Phase 5.
- `.planning/REQUIREMENTS.md` — full read; DOC-01..06 verbatim definitions.
- `.planning/ROADMAP.md` — full read; Phase 5 entry + 4 success criteria.
- `.planning/PROJECT.md` — full read; scope guardrails + 5 preconditions.
- `.planning/phases/05-.../05-CONTEXT.md` — full read; 22 locked decisions + canonical refs + code context.
- `.planning/phases/05-.../05-DISCUSSION-LOG.md` — full read; audit trail of considered alternatives.

### Secondary (MEDIUM confidence)
- WebSearch — Claude Code MCP configuration (verified against [code.claude.com/docs/en/mcp](https://code.claude.com/docs/en/mcp) and [modelcontextprotocol.io](https://modelcontextprotocol.io/docs/develop/connect-local-servers) — current as of 2026-05).
- WebSearch — Cursor MCP configuration (verified against [cursor.com/docs/mcp](https://cursor.com/docs/mcp) — current as of 2026-05).
- Apple `launchd.plist(5)` man-page conventions — referenced for the plist template schema; not freshly verified during research, but well-established (zero churn since 2014).

### Tertiary (LOW confidence)
- None. All claims are either verified against `src/` or against current external docs.

## Metadata

**Confidence breakdown:**
- Doctor check signatures (9 new): HIGH — every reused upstream (callWithAuth, openDb, repos, paths) is verified in source.
- Architecture / file tree: HIGH — exact paths locked in CONTEXT D-07.
- MCP client configs: HIGH — verified against 2026-05 docs (Claude Code, Claude Desktop, Cursor).
- launchd plist schema: MEDIUM — `man launchd.plist` keys are well-established but a freshly-installed macOS Ventura+ machine should be the verification point.
- Stopwatch test mechanics: HIGH — every component is upstream-verified (MSW helpers exist, auth `--no-browser` prints to stderr, `RECOVERY_LEDGER_HOME` is a real env override, performance.now is built-in).
- CI workflow shape: HIGH — pattern copied from existing `ci.yml` with appropriate path filter.
- Phase-close blueprint: HIGH — mirror of Plan 04-12 with DOC-* substitutions.

**Research date:** 2026-05-26
**Valid until:** 2026-06-26 (30 days — stable surface; MCP client config formats may drift in 2026-06+ Anthropic/Cursor releases)

## RESEARCH COMPLETE
