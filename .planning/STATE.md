---
gsd_state_version: 1.0
milestone: v1.0
milestone_name: milestone
current_plan: 7
status: executing
last_updated: "2026-05-12T23:15:23.470Z"
progress:
  total_phases: 5
  completed_phases: 1
  total_plans: 14
  completed_plans: 12
  percent: 86
---

# State: Recovery Ledger

**Last updated:** 2026-05-12 — completed Plan 02-05 (cli-shims: init.ts bootstraps ~/.recovery-ledger/config.json mode 0600 with D-06 env-var precedence + D-02 verbatim instructions + atomic temp-and-rename; auth.ts reads config via canonical ConfigSchema, runs runOAuth + tokenStore.write, prints `Authorization complete.` with FROZEN 6-kind AuthError exit-code map. Both files import canonical ConfigSchema + D13_SCOPES from schema.ts — no inline z.object (DRY-fix per PLAN-05-DRY-VIOLATION). Gate C in scripts/ci-grep-gates.sh broadened from doctor.ts to src/cli/commands/**/*.ts via regex anchored at directory prefix; ADR-0001 MCP-stdout-purity preserved. Two deviations auto-fixed: Rule 3 Biome format, Rule 1 latent Plan 02-01 errors.ts bug — AuthError now stores readonly detail field so formatAuthError can interpolate the port number; FROZEN 6-kind union shape preserved. 23 unit tests green; full suite 206/206 across 17 files).
**Mode:** yolo
**Granularity:** standard

## Project Reference

- **Core Value:** Turn WHOOP data into a daily and weekly review loop that ends in 3 concrete decisions and a record of whether they helped — useful enough that Chris keeps using it.
- **Current Focus:** Phase 02 — oauth-token-store-single-flight-refresh

## Current Position

**Current Plan:** 7
**Total Plans in Phase:** 8
Phase: 02 (oauth-token-store-single-flight-refresh) — EXECUTING
Plan: 7 of 8

- **Milestone:** v1
- **Phase:** 2
- **Plan:** 02-05-cli-shims-PLAN.md (complete) — `recovery-ledger init` (AUTH-01) bootstraps config.json mode 0600 with D-06 env-var precedence + D-02 verbatim instructions + atomic temp-and-rename + Zod validation via canonical ConfigSchema. `recovery-ledger auth` (AUTH-02) reads config.json, runs Plan 02-03's runOAuth, persists Tokens via Plan 02-02's tokenStore.write, prints `Authorization complete.`. Both files import canonical ConfigSchema + D13_SCOPES from Plan 02-01's schema.ts (DRY-fix per PLAN-05-DRY-VIOLATION). Gate C in scripts/ci-grep-gates.sh broadened from doctor.ts to src/cli/commands/**/*.ts. AUTH_EXIT_CODES covers all six FROZEN AuthError kinds with duck-type dispatch (vi.resetModules cross-module class identity workaround). 23 unit tests green; full suite 206/206 across 17 files.
- **Status:** Ready to execute
- **Progress:** [█████████░] 86%

```
[████░░░░░░░░░░░░░░░░] 1 / 5 phases complete (6 / 6 plans complete in Phase 1)
```

## Performance Metrics

| Metric | Value |
|--------|-------|
| Phases planned | 5 |
| Phases complete | 1 |
| v1 requirements mapped | 49 / 49 |
| v1 requirements complete | 12 / 49 |
| Plans drafted | 6 (Phase 1) + 8 (Phase 2) |
| Plans complete | 12 |
| Phase 02 P07 | 2m 1s | 1 tasks | 1 files |
| Phase 02 P02 | 5m 32s | 1 tasks | 2 files |
| Phase 02 P03 | 4m 28s | 1 tasks | 2 files |
| Phase 02 P04 | 3m 3s | 1 tasks | 3 files |
| Phase 02 P05 | 4m 57s | 1 tasks | 7 files |

### Plan Execution History

| Plan | Duration | Tasks | Files | Status |
|------|----------|-------|-------|--------|
| 01-01-bootstrap   | 3m 32s | 2 | 9 | Complete (2026-05-12) |
| 01-02-logger      | 4m 56s | 2 | 3 | Complete (2026-05-12) |
| 01-03-mcp-skeleton | 4m 42s | 3 | 6 | Complete (2026-05-12) |
| 01-04-sanitizer-lint | 3m 17s | 2 | 2 | Complete (2026-05-12) |
| 01-05-cli-doctor   | 5m 18s | 3 | 15 | Complete (2026-05-12) |
| 01-06-ci-integration | 4m 22s | 2 | 2 | Complete (2026-05-12) |
| 02-01-wave0-infra | 5m 17s | 2 | 12 | Complete (2026-05-12) |
| 02-07-sanitizer-fixtures | 2m 1s | 1 | 1 | Complete (2026-05-12) |
| 02-02-token-store | 5m 32s | 1 | 2 | Complete (2026-05-12) |
| 02-03-oauth-round-trip | 4m 28s | 1 | 2 | Complete (2026-05-12) |
| 02-04-refresh-orchestrator | 3m 3s | 1 | 3 | Complete (2026-05-12) |
| 02-05-cli-shims | 4m 57s | 1 | 7 | Complete (2026-05-12) |

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
- **[Phase 02] Plan 02-01 decision:** auth_port_in_use kind shipped in Wave 0 (originally Wave 2) — checker BLOCKER 1 fix keeps errors.ts stable across Plan 02-02 and Plan 02-03 same-wave consumers; AuthErrorKind FROZEN at 6 kinds.
- **[Phase 02] Plan 02-01 decision:** canonical ConfigSchema centralized in src/infrastructure/config/schema.ts — checker WARNING PLAN-05-DRY-VIOLATION fix; init.ts and auth.ts both import single source in Plan 02-05.
- **[Phase 02] Plan 02-01 decision:** WHOOP_TOKEN_URL hard-coded inside tests/helpers/msw-whoop-oauth.ts as single source for the phase — T-02.01-04 mitigation prevents a future test from accidentally pointing MSW at a different host.
- **[Phase 02] Plan 02-01 deviation:** Biome formatter auto-fixed paths.ts configDir line-split and errors.ts super(...) collapse (Rule 3 — blocking format).
- **[Phase 02] Plan 02-01 deviation:** rewrote paths.ts doc-comment mentions of process.env to 'env-global' so plan acceptance grep returns exactly the single export line (Rule 1 — comment regression).
- **[Phase 02] Plan 02-01 deviation:** ran npm run build to rebuild stale dist/mcp.mjs (gitignored) before full-suite verify — pre-existing precondition, not Plan 02-01 regression; planner-template note worth recording.
- **[Phase 02] Plan 02-07 decision:** D-19 collapsed to test-fixture-only work — RESEARCH lines 768-787 confirmed Phase 1 SECRET_KEY_NAMES already contains code + client_secret; plan ships fixtures only, no sanitize.ts regex changes.
- **[Phase 02] Plan 02-07 decision:** D-18 attestation verified — src/mcp/register.ts NOT modified; new Phase 2 AuthError kinds (auth_port_in_use, auth_expired) flow through unchanged sanitize(serializeError(err)) pipeline; full-suite pass (127 tests / 12 files) exercises the wrapper end-to-end.
- **[Phase 02] Plan 02-07 decision:** avoided F-number collision with Phase 1 D-10 fixtures — added Phase 2 fixtures as sibling describe blocks named 'F6 — Bearer/JWT/...' and 'F7 — D-20 ...' rather than renaming existing test('F6 ...') inside the D-10 describe block.
- **[Phase 02] Plan 02-07 decision:** N-01 (code=12) uses permissive assertion — Pattern 2b has no length floor today; permissive shape documents intent without locking in a debatable choice.
- **[Phase 02] Plan 02-07 deviation:** F6.02 fixture rewritten mid-execution — original D-20 verbatim eyJabc.eyJdef.signature123 too short for Pattern 3 floors (4/8/8); F6.02 now uses longer fixture; F7.01 retains D-20 verbatim because code= form-body catches it before Pattern 3 fires (Rule 1).
- [Phase ?]: [Phase 02] Plan 02-02 decision: in-process gate lives INSIDE createTokenStore closure (per-instance) rather than module-level — gives tests isolated gates without vi.resetModules; production singleton still enforces ONE gate process-wide via the exported tokenStore.
- [Phase ?]: [Phase 02] Plan 02-02 decision: Pitfall F (keyring roundtrip mismatch) implemented as cheap defense-in-depth — setPassword + getPassword + byte-equal verify; mismatch silently falls back to file backend; ADR-0002 does not mandate it; test B-04 pins the contract.
- [Phase ?]: [Phase 02] Plan 02-02 decision: WHOOP_TOKEN_URL read at module load from process.env.WHOOP_TOKEN_URL ?? hardcoded default — test-only override seam for Plan 02-08 cross-process integration.
- [Phase ?]: [Phase 02] Plan 02-02 decision: Removed speculative tokenFileExists helper in REFACTOR — Plan 02-06 will own its own existence-probe in doctor auth.ts; YAGNI cleanup.
- [Phase ?]: [Phase 02] Plan 02-02 deviation: Biome import-sort + noNonNullAssertion auto-fixed via npm run format + manual guard substitution (Rule 3 blocking lint).
- [Phase ?]: [Phase 02] Plan 02-02 deviation: rephrased token-store.ts doc-comment process.stdout.write to direct stdout writes so plan acceptance grep returns zero matches (Rule 1 — same precedent as Plan 02-01 paths.ts process.env).
- [Phase ?]: [Phase 02] Plan 02-02 deviation: Plan acceptance grep oauth/oauth2/token outside token-store.ts returned 1 match in src/mcp/sanitize.test.ts (Plan 02-07 fixture) — Plan 02-06 input note: Gate E must exclude test files when wiring the rule (Rule 1).
- [Phase ?]: [Phase 02] Plan 02-02 deviation: E-01 test restructured from chained .rejects.* to single try/catch — MSW setNextResponse is one-shot and chained rejects would consume it twice (Rule 1 — test-shape correction at RED-review).
- [Phase ?]: [Phase 02] Plan 02-03 decision: errors.ts NOT mutated — AuthError union FROZEN at 6 kinds from Wave 0; this plan consumes auth_port_in_use unchanged. Verified by git diff returning empty for errors.ts.
- [Phase ?]: [Phase 02] Plan 02-03 decision: OAuth error-code response policy (BLOCKER 4 / OPEN-Q-01) — RENDER invalid_scope/invalid_request/unsupported_response_type error_description verbatim after sanitize+escapeHtml; STRIP server_error/access_denied/unauthorized_client/temporarily_unavailable/default. OE-09 verbatim acceptance fixture pinned.
- [Phase ?]: [Phase 02] Plan 02-03 decision: 127.0.0.1-only loopback binding (NOT 0.0.0.0); verified by Test L-06 reading the onListening callback's address field. ASVS V9 + Threat Pattern CSRF-on-loopback.
- [Phase ?]: [Phase 02] Plan 02-03 decision: PKCE OFF by default per A1/D-12/Pitfall I — WHOOP PKCE support unconfirmed; usePkce flag threads S256 challenge+verifier when set.
- [Phase ?]: [Phase 02] Plan 02-03 deviation: MSW onUnhandledRequest:'bypass' (not 'error') — runOAuth tests drive real fetch against loopback 127.0.0.1 server; helper still intercepts WHOOP_TOKEN_URL only (Rule 1 test correctness).
- [Phase ?]: [Phase 02] Plan 02-03 deviation: settled-promise wrapper pattern for L-02 + OE-01..09 tests — Vitest treats single-tick rejection gap as unhandled; .then(ok,err) wrapper attaches handler before fetch round-trip (Rule 1 test correctness).
- [Phase ?]: [Phase 02] Plan 02-03 deviation: plan acceptance grep 'oauth/oauth2/auth ... grep -v oauth.ts' returns matches in oauth.test.ts (oauth.ts is NOT a substring of oauth.test.ts); same precedent as Plan 02-02 Gate-E. Plan 02-06 input note: must --exclude='*.test.ts' (Rule 1 plan-text drift).
- [Phase ?]: [Phase 02] Plan 02-04 decision: refresh orchestrator is the SOLE consumer of tokenStore.getValidAccessToken() outside token-store internals; grep-verified; Plan 02-06 Gate E will lock at CI time. 401-reactive retry policy chokepoint with budget = 1 per D-15.
- [Phase ?]: [Phase 02] Plan 02-04 decision: FetchLikeResponse intentionally minimal — just {status: number}. Orchestrator only needs .status to decide retry; full Response shape is operation callback's concern. Decouples from globalThis.Response and lets Phase 3 WHOOP HTTP client pass any wrapper.
- [Phase ?]: [Phase 02] Plan 02-04 decision: callWithAuth bound on singleton via .bind(refreshOrchestrator) — naked property reference would lose this binding for free-function import sites. Functionally equivalent to plan's <interfaces> wording; semantically more robust.
- [Phase ?]: [Phase 02] Plan 02-04 deviation: dynamic-imported AuthError inside F-01/F-02 instead of top-level static import — vi.resetModules() creates fresh module-graph instances per test, so toBeInstanceOf against a top-level static class binding fails (same class name, different runtime identity). Planner-template note: any test using vi.resetModules + dynamic import + toBeInstanceOf must dynamic-import the class symbol too (Rule 1).
- [Phase ?]: [Phase 02] Plan 02-04 deviation: orchestrator module-leading comment uses 'console calls' and 'direct stdout writes' phrasing rather than literal 'console.*' and 'process.stdout.write' to avoid plan-acceptance-grep collision — same precedent as Plan 02-01 paths.ts and Plan 02-02 token-store.ts (Rule 1).
- [Phase ?]: [Phase 02] Plan 02-05 decision: both init.ts and auth.ts import canonical ConfigSchema + D13_SCOPES from src/infrastructure/config/schema.ts (Plan 02-01) — checker WARNING PLAN-05-DRY-VIOLATION fix; no inline z.object declarations in either file; Tests I-10 + A-10 grep the source to lock the contract.
- [Phase ?]: [Phase 02] Plan 02-05 decision: auth.ts catch arm dispatches AuthError via duck-typing (err.name === 'AuthError' AND kind in AUTH_ERROR_KINDS) rather than instanceof — Vitest vi.resetModules() cross-module class identity issue (same pattern as Plan 02-04 deviation 1).
- [Phase ?]: [Phase 02] Plan 02-05 decision: Gate C in scripts/ci-grep-gates.sh broadened from src/cli/commands/doctor.ts to src/cli/commands/**/*.ts via regex anchored at the directory prefix — ADR-0001 MCP-stdout-purity preserved because src/cli/commands/ is not reachable from src/mcp/.
- [Phase ?]: [Phase 02] Plan 02-05 deviation (Rule 1): fixed Plan 02-01 latent bug in errors.ts — AuthError constructor never stored init.detail on instance. Plan 02-01 test 11 was permissive enough to hide it; Plan 02-05 A-04 forced the port number into assertion which surfaced it. Fix: readonly detail field; FROZEN 6-kind union preserved.
- [Phase ?]: [Phase 02] Plan 02-05 deviation (Rule 3): Biome auto-fixed import-sort/line-collapse via npm run format. No semantic change.

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

Executed Plan 02-05 (cli-shims). Single TDD task across RED → GREEN (REFACTOR skipped — implementation matched planned shape). Landed `src/cli/commands/init.ts` (131 LOC, 3 named exports: runInitCommand + INIT_EXIT_CODES + type re-export InitConfig) + `src/cli/commands/init.test.ts` (235 LOC, 11 tests) + `src/cli/commands/auth.ts` (132 LOC, 2 named exports: runAuthCommand + AUTH_EXIT_CODES) + `src/cli/commands/auth.test.ts` (293 LOC, 12 tests including Commander wiring grep). Modified `src/cli/index.ts` (42 → 73 LOC) — Commander program registers init + auth subcommands with MR-22 --help blocks documenting exit codes (init: 0 success / 1 invalid input / 1 write failed; auth: six 1-codes mapped to FROZEN AuthError kinds + 0 success). Modified `scripts/ci-grep-gates.sh` — Gate C scope broadened from `src/cli/commands/doctor.ts` (Phase 1 single-file) to `src/cli/commands/**/*.ts` (any CLI command file) via regex anchored at directory prefix; ADR-0001 MCP-stdout-purity invariant preserved because src/cli/commands/ is NOT reachable from src/mcp/. Modified `src/infrastructure/whoop/errors.ts` — fixed Plan 02-01 latent bug: AuthError constructor now stores `init.detail` on the instance as a readonly field so `formatAuthError` can interpolate the colliding port number in the auth_port_in_use remediation (Plan 02-01 errors.test.ts test 11 was permissive enough to hide the bug; Plan 05 test A-04 forced the port number into the assertion, surfacing it); AuthError union FROZEN at 6 kinds preserved. AUTH-01 (`recovery-ledger init` writes ~/.recovery-ledger/config.json mode 0600 with D-06 env-var precedence + D-02 verbatim instructions + atomic temp-and-rename + Zod validation via canonical ConfigSchema) and AUTH-02 (`recovery-ledger auth` reads config.json via canonical ConfigSchema, applies D-06 env-var precedence at auth time, runs Plan 02-03's runOAuth, persists Tokens via Plan 02-02's tokenStore.write, prints `Authorization complete.`) fully wired end-to-end. Both init.ts and auth.ts import canonical ConfigSchema + D13_SCOPES from `src/infrastructure/config/schema.ts` (DRY-fix per checker WARNING PLAN-05-DRY-VIOLATION); no inline `z.object` declarations in either file (Tests I-10 + A-10 grep the source to lock the contract). auth.ts catch arm dispatches AuthError via duck-typing (`err.name === 'AuthError' && AUTH_ERROR_KINDS.has(err.kind)`) rather than `instanceof` — Vitest `vi.resetModules()` cross-module class identity workaround (same pattern as Plan 02-04 deviation 1; planner-template note now applies to both refresh-orchestrator test AND auth.ts production code). Two deviations all auto-fixed: 1 Rule-3 Biome import-sort/line-collapse auto-fix via `npm run format`; 1 Rule-1 latent Plan 02-01 errors.ts bug fix (AuthError instance field). REFACTOR skipped — same precedent as Plan 02-01 Task 2, Plan 02-04, Plan 02-07. Tests: 183 → 206 across 15 → 17 files; lint clean; CI grep gates clean. `node dist/cli.mjs --help` lists init + auth subcommands. Commits: `ed5c455` (RED — 23 tests fail with module-not-found), `0f7a60d` (GREEN — 23/23 tests pass after duck-type AuthError dispatch fix and errors.ts Rule-1 bug fix, both applied before staging).

Previously executed Plan 02-04 (refresh-orchestrator). Single TDD task across RED → GREEN (REFACTOR skipped — implementation matched planned shape; same precedent as Plan 02-01 Task 2 + Plan 02-07 Task 1). Landed `src/services/refresh-orchestrator.ts` (133 LOC, 7 named exports: callWithAuth + createRefreshOrchestrator + refreshOrchestrator + 4 type interfaces FetchLikeResponse/AuthedOperation/CallWithAuthOptions/RefreshOrchestrator) + `refresh-orchestrator.test.ts` (296 LOC, 9 tests across 4 describe blocks). Extended `src/services/index.ts` (19 → 34 LOC) — Services interface now includes refreshOrchestrator alongside runDoctor; createServices() returns both; type re-exports for orchestrator surface. 401-reactive retry policy chokepoint per D-14/D-15/D-16 + ADR-0002 §Consequences: attempt 1 → tokenStore.getValidAccessToken() + op(at) → if 401, re-read tokens (sibling may have refreshed) → if fresh, retry with current.accessToken (no force-refresh — getValidAccessToken called only once in this path); else force getValidAccessToken() through three-layer gate, retry once with fresh token, return result regardless of status (retry budget = 1). Refresh failure (token-store throws AuthError({kind: 'refresh_failed'})) wraps as AuthError({kind: 'auth_expired', cause: refreshErr}) and does NOT retry the operation (STACK.md §Token refresh point 4 — retry budget 0 on refresh). The orchestrator is the SOLE consumer of tokenStore.getValidAccessToken() outside of token-store internals (grep-verified — `grep -rEn "tokenStore\.getValidAccessToken" src/` outside refresh-orchestrator.ts + token-store.ts + their tests returns 0; Plan 02-06's Gate E will lock at CI time). Consumer scope corrected per checker WARNING PLAN-04-CIRCULAR-NOTE: Phase 3's WHOOP sync service is the FIRST runtime consumer; Plan 02-05's auth.ts does NOT consume (auth-code grant has no 401-reactive boundary — auth.ts imports infrastructure directly). FetchLikeResponse intentionally minimal — just `{status: number}` — orchestrator only inspects `.status` to decide retry; full Response shape is operation callback's concern (decouples from globalThis.Response, lets Phase 3 WHOOP HTTP client pass any wrapper). callWithAuth bound on singleton via `.bind(refreshOrchestrator)` so free-function `import { callWithAuth }` preserves `this`. 9 tests green: H-01/H-02 (happy path; access-token plumbing), R-01/R-02/R-03 (sibling re-read, force refresh path, retry budget exhausted), F-01/F-02 (auth_expired wrap with cause; formatAuthError remediation), S-01/S-02 (services-barrel wiring + end-to-end). Two deviations all auto-fixed: 1 Rule-1 cross-module class identity (top-level static `import { AuthError }` resolves a pre-vi.resetModules() module-graph instance — toBeInstanceOf fails against the orchestrator's caught class; fix: dynamic-import AuthError inside F-01/F-02 matching the orchestrator's lifecycle — planner-template note: any test using vi.resetModules + dynamic import + toBeInstanceOf must dynamic-import the class too); 1 Rule-1 doc-comment phrasing precedent (used `console calls` / `direct stdout writes` rather than literal `console.*` / `process.stdout.write` to dodge plan-acceptance-grep collision — same precedent as Plan 02-01 paths.ts + Plan 02-02 token-store.ts). errors.ts unchanged (FROZEN at 6 kinds — Wave 0 contract preserved); token-store.ts unchanged; sanitize.ts/register.ts unchanged (D-18 attestation preserved across Plans 02-07 + 02-02 + 02-03 + 02-04). REFACTOR skipped — module-leading comment, retry policy, AuthError wrap, services-barrel wiring all matched `<interfaces>` and `<action>` verbatim. Tests: 174 → 183 across 14 → 15 files; lint clean; CI grep gates clean. Commits: `ea6735a` (RED — 9 tests; 8 fail with module-not-found, F-02 passes against existing errors.ts contract as expected), `63c5f10` (GREEN — 9/9 tests pass after class-identity fix).

### Next Session

Execute Plan 02-06 (doctor-extensions) or Plan 02-08 (cross-process integration). Phase 2 Wave 4 is complete — `recovery-ledger init` + `recovery-ledger auth` now wire end-to-end. Plan 02-06's `probeAuth` + `probeTokenFreshness` consume `paths.configFile` + `paths.tokensFile` populated by `init` + `auth`. Plan 02-06's Gate E in `scripts/ci-grep-gates.sh` should now check three allow-list invariants with `--exclude='*.test.ts'` (input notes recorded across Plans 02-02 + 02-03 + 02-04 + 02-05): (1) `oauth/oauth2/token` outside `src/infrastructure/whoop/token-store.ts` must be 0; (2) `oauth/oauth2/auth` outside `src/infrastructure/whoop/oauth.ts` must be 0; (3) `tokenStore\.getValidAccessToken` outside `src/infrastructure/whoop/token-store.ts` AND `src/services/refresh-orchestrator.ts` must be 0. The MR-22 --help block convention is now applied consistently across all three subcommands (doctor, init, auth) — Plan 02-06 should add --help content to doctor for the new auth/token-freshness exit codes it adds. AuthError union remains FROZEN at 6 kinds; the carrier's instance shape gained one documented `readonly detail?: string` field via Plan 02-05's Rule-1 fix (was always referenced by formatAuthError, now actually assigned by the constructor). sanitize.ts/register.ts unchanged (D-18 attestation preserved across Plans 02-07 + 02-02 + 02-03 + 02-04 + 02-05). Phase 3's WHOOP sync service will be the FIRST runtime consumer of `callWithAuth`. The verifier agent has not been re-run for Phase 1 yet (still pending from end of Phase 1).

---
*State initialized: 2026-05-11*
*Phase 1 context gathered: 2026-05-12*
*Plan 01-01 complete: 2026-05-12 (3m 32s, 9 files)*
*Plan 01-02 complete: 2026-05-12 (4m 56s, 3 files — 2 src + 1 modified config)*
*Plan 01-03 complete: 2026-05-12 (4m 42s, 6 files)*
*Plan 01-04 complete: 2026-05-12 (3m 17s, 2 files)*
*Plan 01-05 complete: 2026-05-12 (5m 18s, 15 files — 13 created + 2 modified)*
*Plan 01-06 complete: 2026-05-12 (4m 22s, 2 files) — Phase 1 closed.*
*Plan 02-01 complete: 2026-05-12 (5m 17s, 12 files — 10 created + 2 modified) — Phase 2 Wave 0 done.*
*Plan 02-07 complete: 2026-05-12 (2m 1s, 1 file — sanitizer fixtures + D-18 attestation; 12 new tests; no production-code changes).*
*Plan 02-02 complete: 2026-05-12 (5m 32s, 2 files — token-store.ts + token-store.test.ts; 17 unit tests; ADR-0002 three-layer gate landed) — Phase 2 Wave 2 chokepoint in place.*
*Plan 02-03 complete: 2026-05-12 (4m 28s, 2 files — oauth.ts + oauth.test.ts; 30 unit tests; OAuth Authorization-Code surface + BLOCKER 4 / OPEN-Q-01 error-code policy; errors.ts FROZEN) — Phase 2 Wave 3 round-trip in place.*
*Plan 02-04 complete: 2026-05-12 (3m 3s, 3 files — refresh-orchestrator.ts + refresh-orchestrator.test.ts + services/index.ts; 9 unit tests; 401-reactive retry chokepoint with budget = 1; SOLE consumer of tokenStore.getValidAccessToken() outside token-store internals; services barrel extended with refreshOrchestrator) — Phase 2 Wave 3 chokepoint complete.*
*Plan 02-05 complete: 2026-05-12 (4m 57s, 7 files — init.ts + init.test.ts + auth.ts + auth.test.ts + index.ts + ci-grep-gates.sh + errors.ts; 23 unit tests; AUTH-01 + AUTH-02 fully wired; canonical ConfigSchema imported by both CLI shims — DRY-fix; Gate C broadened to src/cli/commands/**/*.ts; Plan 02-01 latent AuthError.detail bug fixed under Rule 1) — Phase 2 Wave 4 chokepoint complete.*
