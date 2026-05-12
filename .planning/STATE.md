---
gsd_state_version: 1.0
milestone: v1.0
milestone_name: milestone
current_plan: 5
status: executing
last_updated: "2026-05-12T18:14:46.565Z"
progress:
  total_phases: 5
  completed_phases: 0
  total_plans: 6
  completed_plans: 5
  percent: 83
---

# State: Recovery Ledger

**Last updated:** 2026-05-12 — completed Plan 01-05 (CLI Commander wiring + real doctor service)
**Mode:** yolo
**Granularity:** standard

## Project Reference

- **Core Value:** Turn WHOOP data into a daily and weekly review loop that ends in 3 concrete decisions and a record of whether they helped — useful enough that Chris keeps using it.
- **Current Focus:** Phase 01 — foundation-stdout-pure-mcp-bootstrap

## Current Position

**Current Plan:** 5
**Total Plans in Phase:** 6
Phase: 01 (foundation-stdout-pure-mcp-bootstrap) — EXECUTING
Plan: 5 of 6

- **Milestone:** v1
- **Phase:** 1 — Foundation & Stdout-Pure MCP Bootstrap
- **Plan:** 01-06-ci-integration-PLAN.md (next) — GitHub Actions workflow + dist/mcp.mjs subprocess round-trip integration test
- **Status:** Ready to execute
- **Progress:** [████████░░] 83%

```
[█░░░░░░░░░░░░░░░░░░░] 0 / 5 phases complete (5 / 6 plans complete in Phase 1)
```

## Performance Metrics

| Metric | Value |
|--------|-------|
| Phases planned | 5 |
| Phases complete | 0 |
| v1 requirements mapped | 49 / 49 |
| v1 requirements complete | 7 / 49 |
| Plans drafted | 6 (Phase 1) |
| Plans complete | 5 |

### Plan Execution History

| Plan | Duration | Tasks | Files | Status |
|------|----------|-------|-------|--------|
| 01-01-bootstrap   | 3m 32s | 2 | 9 | Complete (2026-05-12) |
| 01-02-logger      | 4m 56s | 2 | 3 | Complete (2026-05-12) |
| 01-03-mcp-skeleton | 4m 42s | 3 | 6 | Complete (2026-05-12) |
| 01-04-sanitizer-lint | 3m 17s | 2 | 2 | Complete (2026-05-12) |
| 01-05-cli-doctor   | 5m 18s | 3 | 15 | Complete (2026-05-12) |

## Accumulated Context

### Decisions

- **TypeScript over Python (PROJECT.md Key Decision #1)** — retention beats library breadth for a personal tool.
- **Done bar = working loop, not retention numerics (PROJECT.md Key Decision #2)** — habit metrics tracked post-v1.
- **Firm scope guardrail (PROJECT.md Key Decision #3)** — Dashboard / BLE / hosted / cross-source integrations stay out until 12 daily reviews + 3 weekly reviews + 8 decisions + stable tests + non-fragile setup.
- **Read-only + BYO OAuth + no consumer-endpoint scraping (PROJECT.md Key Decision #4)** — durability over convenience.
- **MCP stdio + structured JSON with text fallback (PROJECT.md Key Decision #5)** — matches supported client matrix.
- **Lite-hexagonal architecture (research/ARCHITECTURE.md)** — pure-TS application core, two driving adapters (CLI, MCP), three driven adapters (WHOOP HTTP, Drizzle/SQLite, filesystem/keychain).
- **5-phase roadmap (research/SUMMARY.md, honored 1:1)** — Foundation → Auth → Data+Sync → Reviews+Decisions+MCP → Doctor+Setup.
- **Plan 01-01 deviation: Biome formatter quote style (single)** — Set `javascript.formatter.quoteStyle: 'single'` so RESEARCH.md verbatim templates and the Plan's must_haves grep patterns (e.g., `pool: 'forks'`) round-trip through `biome check` unmodified.
- **Plan 01-01 deviation: Vitest `passWithNoTests` in config (not CLI)** — Vitest 4 changed default behavior to exit 1 with no test files; moved the flag to `vitest.config.ts` so package.json `scripts.test` stays the verbatim `"vitest run"` required by must_haves.
- **Plan 01-01 deviation: TypeScript pinned to ^5.7 (resolved 5.9.3)** — Honored A4 in 01-RESEARCH.md Assumptions Log; explicitly NOT bumped to 6.x.
- **[Phase 01] Plan 01-02 decision:** chose Pino async destination (sync: false) for prod — RESEARCH Open Question 1 resolved by performance > shutdown-flush determinism.
- **[Phase 01] Plan 01-02 deviation:** switched RESEARCH Pattern 1's named import `{pino}` to default import — pino@10.3.1 ships CJS `export = pino`, so `.destination` / `.symbols` only attach to the default callable.
- **[Phase 01] Plan 01-02 decision:** A1 (pino.symbols.streamSym brittleness) RESOLVED — symbol is stable on Pino 10.3.1; symbol-based introspection ships green alongside the load-bearing fallback assertion.
- **[Phase 01] Plan 01-02 deviation:** `process.env.NODE_ENV` dot-notation (not bracket) — both forms equivalent under `noUncheckedIndexedAccess` for `@types/node` named optionals; Biome `useLiteralKeys` mandates dot.
- **[Phase 01] Plan 01-02 deviation (environmental):** Added `!.worktrees` to biome.json `files.includes` — stale harness worktree shadow-config was breaking lint.
- **[Phase 01] Plan 01-03 decision:** Open Question 4 RESOLVED — `@modelcontextprotocol/sdk/server/mcp.js` import path works on SDK 1.29.0 via the `./*` wildcard exports; no fallback to `./server/index.js` needed.
- **[Phase 01] Plan 01-03 deviation:** register() handler typed as SDK's `ToolCallback<I>` instead of RESEARCH verbatim — SDK 1.29 stricter `CallToolResult` shape (`structuredContent: Record<string, unknown>`) and per-Args branching callback signature required the precise SDK type.
- **[Phase 01] Plan 01-03 decision:** Services interface contract locked early — `runDoctor: () => Promise<DoctorResult>`; DoctorResult shape per D-06. Plan 05's real `createServices()` will overwrite the stub without changing the contract.
- **[Phase 01] Plan 01-04 decision:** adopted user's prompt-level gate set (tone words + emoji / console.* outside src/cli and tests / process.stdout.write outside src/cli/commands/doctor.ts) over the plan's verbatim set — stricter and more directly aligned with CLAUDE.md Critical Rules.
- **[Phase 01] Plan 01-04 decision:** byte-level emoji detection via LC_ALL=C plus 4-byte UTF-8 prefix range — portable across BSD and GNU grep without `-P` (GNU-only).
- **[Phase 01] Plan 01-04 decision:** cause-walker depth-8 cap pinned in both directions — `at most 9 split segments` plus `exactly 8 cause segments` on a 10-deep chain — drift in either direction breaks the suite.
- **[Phase 01] Plan 01-04 decision:** no defects discovered in Plan 03's sanitize.ts — all 20 characterization tests pass on first run; the Plan 03 implementation ships as designed.
- **[Phase 01] Plan 01-05 decision:** `deriveOverall` exported as a pure named function so the fail>warn>pass precedence rule is unit-tested without spawning native modules or the MCP subprocess.
- **[Phase 01] Plan 01-05 decision:** A2 / A3 RESOLVED — SDK 1.29.0 echoes the fixture's `protocolVersion: "2025-06-18"` verbatim in the initialize response (LATEST is `2025-11-25`; both are in SUPPORTED). `@napi-rs/keyring` 1.3.0 ships `Entry(service, username)` as the named-export class constructor per its `index.d.ts`; no fallback assertion needed.
- **[Phase 01] Plan 01-05 decision:** subprocess settle timing pinned at 200ms per-frame + 300ms final drain (vs Pattern 5b's ~100ms) — empirically required on the Node 25.2.1 dev box without dragging the doctor command above sub-second.
- **[Phase 01] Plan 01-05 deviation:** Biome import-order + line-collapsing required minor reshape of the doctor service core after first write (Rule 3 — blocking; auto-fixed inline).
- **[Phase 01] Plan 01-05 deviation:** plan's verify command uses Vitest 4-removed `--reporter=basic`; substituted the default reporter (Rule 1 — plan-text bug; no code change). Worth surfacing as a planner-template fix for the Vitest-4-pinned stack.

### Open Todos

- Execute Plan 01-06 (`01-06-ci-integration-PLAN.md`) — GitHub Actions workflow (`npm ci → npm run lint → npm run build → npm run test → bash scripts/ci-grep-gates.sh` on `macos-latest`) plus the Vitest integration test under `test/integration/` that imports `probeMcpStdoutPurity` (already factored as a reusable export by Plan 01-05) and asserts the subprocess round-trip against the four committed `test/fixtures/mcp/*.json` fixtures.
- Confirm whether to deepen research before Phase 2 planning (cross-process file-lock semantics + replay-on-401 contract are research-flagged).
- Confirm whether to deepen research before Phase 4 planning (confidence-tier thresholds, MAD scaling for small samples, FDR q-value defaults; Zod→JSON-Schema fidelity at the pinned SDK × Zod combination).

### Blockers

None.

### Notes

- Research is complete and HIGH-confidence (`research/SUMMARY.md`, `research/STACK.md`, `research/FEATURES.md`, `research/ARCHITECTURE.md`, `research/PITFALLS.md`).
- Cross-cutting concerns are explicitly mapped to the phase where they originate; tests live permanently in CI from that phase forward (see ROADMAP.md "Cross-Cutting Concerns" table).
- Project is a CLI + MCP stdio server — zero frontend. No UI phase applies.

## Session Continuity

### Last Session Summary

Executed Plan 01-05 (CLI Commander wiring + real doctor service). Shipped 13 created files + 2 modified across three task commits. Created: `src/services/doctor/index.ts` (real `runDoctor()` + exported `deriveOverall` precedence helper), `src/services/doctor/checks/native-modules.ts` (`probeBetterSqlite3` opens `:memory:` + closes; `probeKeyring` constructs `new Entry('recovery-ledger', 'doctor-probe')` only — touches zero disk, zero keychain), `src/services/doctor/checks/mcp-stdout-purity.ts` (spawns `dist/mcp.mjs`, writes the four newline-delimited fixtures, parses each captured stdout line as JSON-RPC 2.0 — the same reusable function Plan 06 will import into its integration test), `src/formatters/doctor.txt.ts` (compact `[status] name — detail` per check, trailing `overall: <status>`), `src/cli/index.ts` (overwrites the Plan 03 `export {};` stub with Commander 14: `name`, `version('0.1.0')`, `description`, `command('doctor').option('--text').action(runDoctorCommand)`, top-level `await parseAsync`), `src/cli/commands/doctor.ts` (the codebase's ONLY `process.stdout.write` call site; renders JSON by default or plaintext under `--text`; `process.exit(overall === 'fail' ? 1 : 0)`), three test files (5 → 7 tests added; suite now 29 tests across 5 files), and four `test/fixtures/mcp/*.json` JSON-RPC fixtures at `protocolVersion: "2025-06-18"`. Modified: `src/services/index.ts` (stub `createServices` replaced with one-line delegation), `src/mcp/tools/whoop-doctor.ts` (inline `renderDoctor` stub swapped for the real formatter import — D-06 parity between CLI `--text` and MCP `content[0].text`). End-to-end smoke verified: `node dist/cli.mjs --version` → `0.1.0`; `node dist/cli.mjs doctor` → 3-check `{checks, overall: "pass"}` JSON; `--text` → plaintext with `overall:` trailer; `node dist/mcp.mjs` driven with all four fixtures returns three JSON-RPC frames containing real probe data with zero stderr leakage. `npm run test && npm run lint && npx tsc --noEmit && npm run build && bash scripts/ci-grep-gates.sh` all exit 0. Three deviations all auto-fixed (Rule 3 Biome shape, Rule 1 self-tripping comment grep, Rule 1 Vitest 4 reporter removal). A2 + A3 both resolved positively against the installed SDK + keyring packages. Commits: `ed7e343` (service core + fixtures), `3032d0e` (formatter + tests), `67a2592` (CLI Commander wiring).

### Next Session

Execute Plan 01-06 (`01-06-ci-integration-PLAN.md`) — write `.github/workflows/ci.yml` (macos-latest, Node 22 from `.nvmrc`) sequencing `npm ci → npm run lint → npm run build → npm run test → bash scripts/ci-grep-gates.sh`, and land the Vitest integration test under `test/integration/` that imports the already-factored `probeMcpStdoutPurity` from Plan 01-05 and asserts the subprocess round-trip against the four committed `test/fixtures/mcp/*.json`. No new source modules required — Plan 01-05 shipped every reusable piece. The integration test doubles as Phase 1's "build runs against compiled `dist/`" assertion (success criterion 5 in ROADMAP §Phase 1).

---
*State initialized: 2026-05-11*
*Phase 1 context gathered: 2026-05-12*
*Plan 01-01 complete: 2026-05-12 (3m 32s, 9 files)*
*Plan 01-02 complete: 2026-05-12 (4m 56s, 3 files — 2 src + 1 modified config)*
*Plan 01-03 complete: 2026-05-12 (4m 42s, 6 files)*
*Plan 01-04 complete: 2026-05-12 (3m 17s, 2 files)*
*Plan 01-05 complete: 2026-05-12 (5m 18s, 15 files — 13 created + 2 modified)*
