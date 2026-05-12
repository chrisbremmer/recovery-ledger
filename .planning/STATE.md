---
gsd_state_version: 1.0
milestone: v1.0
milestone_name: milestone
current_plan: 6
status: ready_to_plan
last_updated: "2026-05-12T18:25:00.581Z"
progress:
  total_phases: 5
  completed_phases: 2
  total_plans: 6
  completed_plans: 6
  percent: 40
---

# State: Recovery Ledger

**Last updated:** 2026-05-12 — completed Plan 01-06 (CI integration test + GitHub Actions workflow) — Phase 1 closed.
**Mode:** yolo
**Granularity:** standard

## Project Reference

- **Core Value:** Turn WHOOP data into a daily and weekly review loop that ends in 3 concrete decisions and a record of whether they helped — useful enough that Chris keeps using it.
- **Current Focus:** Phase 01 — foundation-stdout-pure-mcp-bootstrap

## Current Position

**Current Plan:** Not started
**Total Plans in Phase:** 6
Phase: 01 (foundation-stdout-pure-mcp-bootstrap) — COMPLETE
Plan: 6 of 6

- **Milestone:** v1
- **Phase:** 2
- **Plan:** 01-06-ci-integration-PLAN.md (complete) — GitHub Actions workflow + dist/mcp.mjs subprocess round-trip integration test landed.
- **Status:** Ready to plan
- **Progress:** [██████████] 100%

```
[████░░░░░░░░░░░░░░░░] 1 / 5 phases complete (6 / 6 plans complete in Phase 1)
```

## Performance Metrics

| Metric | Value |
|--------|-------|
| Phases planned | 5 |
| Phases complete | 1 |
| v1 requirements mapped | 49 / 49 |
| v1 requirements complete | 7 / 49 |
| Plans drafted | 6 (Phase 1) |
| Plans complete | 6 |

### Plan Execution History

| Plan | Duration | Tasks | Files | Status |
|------|----------|-------|-------|--------|
| 01-01-bootstrap   | 3m 32s | 2 | 9 | Complete (2026-05-12) |
| 01-02-logger      | 4m 56s | 2 | 3 | Complete (2026-05-12) |
| 01-03-mcp-skeleton | 4m 42s | 3 | 6 | Complete (2026-05-12) |
| 01-04-sanitizer-lint | 3m 17s | 2 | 2 | Complete (2026-05-12) |
| 01-05-cli-doctor   | 5m 18s | 3 | 15 | Complete (2026-05-12) |
| 01-06-ci-integration | 4m 22s | 2 | 2 | Complete (2026-05-12) |

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
- **[Phase 01] Plan 01-06 decision:** final drain pinned at 1500ms (tools/call:whoop_doctor triggers an inner mcp_stdout_purity subprocess costing ~1.1s) — integration test total runtime ~2.3s, under the 5s acceptance criterion.
- **[Phase 01] Plan 01-06 decision:** integration test does NOT import probeMcpStdoutPurity — it asserts against raw stdout bytes directly so a bug in the probe's framing logic is caught by a second independent eye.
- **[Phase 01] Plan 01-06 deviation:** RESEARCH Pattern 5(b) writes `json.trim()` to stdin, but pretty-printed multi-line fixtures are silently dropped by the MCP line-delimited parser; adopted single-line collapse via `JSON.stringify(JSON.parse(body))` — same pattern as src/services/doctor/checks/mcp-stdout-purity.ts.
- **[Phase 01] Plan 01-06 deviation (repeat from 01-05):** Vitest 4 `--reporter=basic` was removed; planner-template fix needed for the Vitest 4 pinned stack.

### Open Todos

- Run the verifier on Phase 1 (all six Plan summaries + integration test green; FND-01..FND-07 CI-enforced). Reference table in `.planning/phases/01-foundation-stdout-pure-mcp-bootstrap/01-06-SUMMARY.md` § "Phase 1 Completion Status".
- Verify the first post-merge GitHub Actions run on `main` is green (`gh run list --limit 1 --json conclusion --jq '.[0].conclusion'`). Not yet runnable — CI has not been invoked yet; will land on the first push of these commits.
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

Executed Plan 01-06 (CI integration — closes Phase 1). Shipped 2 created files across two task commits. Created: `test/integration/mcp-stdout-purity.test.ts` (124 lines — spawns `dist/mcp.mjs`, drives the four-fixture JSON-RPC sequence, asserts every stdout line parses as JSON-RPC 2.0, asserts no `Bearer/Authorization/eyJ` substrings, asserts the id=3 tools/call response carries `result` not `error`, exit code ≤ 0). Created: `.github/workflows/ci.yml` (51 lines — single `macos-latest` job, Node 22, `actions/checkout@v4` + `actions/setup-node@v4` with npm cache, steps `npm ci → lint → build → test → bash scripts/ci-grep-gates.sh` in that exact order, concurrency block cancels in-flight runs on the same ref). Full local pipeline green: `npm ci → npm run lint → npm run build → npm run test → bash scripts/ci-grep-gates.sh` — 30 tests / 6 files, 2.49s; integration test alone 2.32s. Three Rule 1 deviations all auto-fixed before commit: (1) pretty-printed multi-line fixtures silently dropped by MCP line-delimited parser → adopted `JSON.stringify(JSON.parse(body))` collapse pattern; (2) final drain too short for the inner mcp_stdout_purity subprocess (~1.1s round-trip) → bumped to 1500ms; (3) plan's verify command uses Vitest-4-removed `--reporter=basic` → substituted default reporter (second occurrence — worth a planner-template fix). Commits: `fa9bc52` (test — integration test), `354ed7c` (chore — CI workflow). Phase 1 closed: all seven FND-* requirements now CI-enforced (see `01-06-SUMMARY.md` § "Phase 1 Completion Status" for the mapping table). Ready for verifier sign-off; first post-merge GitHub Actions run on `main` is the final acceptance gate.

### Next Session

Run the verifier agent on Phase 1 (six Plan summaries + integration test + CI workflow). Awaiting verifier sign-off before planning Phase 2 (auth). STATE.md flags two research-deepen-before-planning questions for Phase 2 — cross-process file-lock semantics for single-flight refresh + replay-on-401 contract — the orchestrator should choose deepen-research-or-skip before `/gsd-plan-phase 2`. First post-merge GitHub Actions run is the external acceptance gate (`gh run list --limit 1 --json conclusion --jq '.[0].conclusion'`); not yet runnable because CI has not been invoked.

---
*State initialized: 2026-05-11*
*Phase 1 context gathered: 2026-05-12*
*Plan 01-01 complete: 2026-05-12 (3m 32s, 9 files)*
*Plan 01-02 complete: 2026-05-12 (4m 56s, 3 files — 2 src + 1 modified config)*
*Plan 01-03 complete: 2026-05-12 (4m 42s, 6 files)*
*Plan 01-04 complete: 2026-05-12 (3m 17s, 2 files)*
*Plan 01-05 complete: 2026-05-12 (5m 18s, 15 files — 13 created + 2 modified)*
*Plan 01-06 complete: 2026-05-12 (4m 22s, 2 files) — Phase 1 closed.*
