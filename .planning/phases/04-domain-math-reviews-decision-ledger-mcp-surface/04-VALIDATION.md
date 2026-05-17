---
phase: 4
slug: domain-math-reviews-decision-ledger-mcp-surface
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-05-16
---

# Phase 4 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution. Derived from `04-RESEARCH.md` §Validation Architecture, refined by post-research decisions D-34/D-35/D-36 in `04-CONTEXT.md`.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest 4.1.6 (Phase 3 carry-forward, `pool: 'forks'`) |
| **Config file** | `vitest.config.ts` (existing) |
| **Quick run command** | `npx vitest run <file>` |
| **Full suite command** | `npm test` (alias for `vitest run`) |
| **Estimated runtime** | < 90 seconds full suite (Phase 3 baseline ≈ 35s; Phase 4 adds ~50s of new test files; budget cap = 90s per D-33 carry-forward) |

---

## Sampling Rate

- **After every task commit:** Run `npx vitest run <changed-file>` (targeted quick run, < 5s)
- **After every plan wave:** Run `npx vitest run src/` (domain + services + infrastructure, < 60s)
- **Before `/gsd:verify-work`:** Full suite must be green via `npm test`
- **Max feedback latency:** 90 seconds (full suite)

---

## Per-Task Verification Map

> Tasks are not yet assigned to plans — the planner will populate per-plan task IDs in `*-PLAN.md`. This table records the REQ-ID → test mapping the planner MUST honor when assigning `<automated>` blocks.

| Req ID | Behavior | Threat Ref | Test Type | Automated Command | File | Status |
|--------|----------|------------|-----------|-------------------|------|--------|
| REV-01 | Trailing-30 median + MAD over SCORED-only non-DST-excluded entities; MAD scaled by 1.4826 | — | unit | `npx vitest run src/domain/baselines src/domain/stats/median src/domain/stats/mad` | ❌ W0: `src/domain/baselines/baseline.test.ts`, `src/domain/stats/median.test.ts`, `src/domain/stats/mad.test.ts` | ⬜ pending |
| REV-02 | Confidence-tier gate (insufficient < 10, weak ≥ 10, strong ≥ 20 + ≥ 70% coverage; Z refused < 14 days) | — | unit | `npx vitest run src/domain/confidence` | ❌ W0: `src/domain/confidence/index.test.ts` | ⬜ pending |
| REV-03 | `getDailyReview` returns the full D-03 slot map (data_status, today_state, anomalies, patterns, actions, confidence, insufficient_reason) | — | integration | `npx vitest run src/services/review/daily.test.ts` | ❌ W0 | ⬜ pending |
| REV-04 | Daily review leads with data-freshness (latest sync, baseline window, missing/stale resources) | — | contract | `npx vitest run tests/contract/daily-review-shape.test.ts` | ❌ W0 | ⬜ pending |
| REV-05 | Insufficient data: 8 SCORED days → `confidence.tier === 'insufficient'`, all `ZAnalysis.kind === 'refused'`, `anomalies/actions = []`, `insufficient_reason` populated | — | unit | `npx vitest run src/services/review/daily.test.ts -t "insufficient"` (fixture `daily-insufficient-days.json`) | ❌ W0 | ⬜ pending |
| REV-06 | Weekly review surfaces worst-day window + runs all 5 pre-registered candidate factors (D-11) | — | integration | `npx vitest run src/services/review/weekly.test.ts` | ❌ W0 | ⬜ pending |
| REV-07 | BH FDR @ q=0.10, m=5; load-bearing fixture `[0.05, 0.20, 0.30, 0.45, 0.60]` → 0 rejections → typed `{kind: 'no_pattern_detected'}` (D-35); secondary fixture `[0.01, 0.04, 0.05, 0.20, 0.50]` → 3 rejections at kStar=3 → `Pattern` with `pattern_confidence` (D-34) | T-04-S1 | unit + contract | `npx vitest run src/domain/stats/fdr.test.ts src/domain/patterns/pattern.test.ts` (fixtures `bh_downgrades_marginal.fixture.json` + `bh_partial_rejection.fixture.json`) | ❌ W0 | ⬜ pending |
| REV-08 | Banned-word lint over rendered formatter output across every fixture (D-26 extends ADR-0005 §Enforcement) | — | contract | `npx vitest run tests/contract/formatter-tone.test.ts` + existing `scripts/ci-grep-gates.sh` Gate A | ❌ W0 | ⬜ pending |
| DEC-01 | `decision add "<text>"` happy-path one-liner with ULID id + default follow-up window + default expected effect (D-19) | T-04-S2 | integration | `npx vitest run src/cli/commands/decision-add.test.ts` | ❌ W0 | ⬜ pending |
| DEC-02 | Decisions persist with `status` (open/followed_up/abandoned) + `outcome_notes` (D-20, schema already shipped Phase 3) | — | unit | `npx vitest run src/infrastructure/db/repositories/decisions.repo.test.ts` | ⚠️ extend existing | ⬜ pending |
| DEC-03 | `decision review` lists open decisions with elapsed-vs-window framing + `decision update <id-prefix>` records outcome (D-21 dual-mode) | — | integration | `npx vitest run src/cli/commands/decision-review.test.ts src/cli/commands/decision-update.test.ts` | ❌ W0 | ⬜ pending |
| DEC-04 | Weekly review surfaces typed `decision_prompt` slot when no decision recorded in prior 7 days (D-22) | — | unit | `npx vitest run src/services/review/weekly.test.ts -t "decision prompt"` (fixture `weekly-decision-prompt-none-this-week.json`) | ❌ W0 | ⬜ pending |
| MCP-01 | 8 tools registered: `whoop_sync`, `whoop_daily_review`, `whoop_weekly_review`, `whoop_query_cache`, `whoop_add_decision`, `whoop_review_decisions`, `whoop_api_gap`, `whoop_doctor` (D-29 breaks Phase 3 D-33 `tools.length === 1`) | T-04-S3 | runtime attestation | `npx vitest run tests/integration/mcp-runtime.test.ts -t "tools"` | ⚠️ extend Phase 1/3 attestation | ⬜ pending |
| MCP-02 | Every tool returns `{structuredContent, content}` dual shape (compact text fallback in `content`) | — | contract | `npx vitest run tests/contract/mcp-tool-shape.test.ts` | ❌ W0 | ⬜ pending |
| MCP-03 | Every MCP tool body ≤ 5 non-blank non-comment lines (static-analysis attestation over `src/mcp/tools/*.ts`) | — | static analysis | `npx vitest run tests/contract/mcp-shim-loc.test.ts` | ❌ W0 | ⬜ pending |
| MCP-04 | 6 resources registered: `whoop://summary/today`, `whoop://summary/week`, `whoop://baseline/30d`, `whoop://data-quality`, `whoop://api-gaps`, `whoop://decisions/open`; all flow through `register-resource.ts` wrapper (D-36); each refreshes from cache on read | T-04-S4 | runtime attestation + contract | `npx vitest run tests/integration/mcp-runtime.test.ts -t "resources" tests/contract/mcp-resource-shape.test.ts` | ❌ W0 | ⬜ pending |
| MCP-05 | 4 prompts registered: `whoop_daily_decision_brief`, `whoop_weekly_recovery_investigation`, `whoop_experiment_designer`, `whoop_deload_or_train`; each returns `messages: [{role: 'user', content: {type: 'text', text}}]` (D-27); all flow through `register-prompt.ts` wrapper (D-36) | — | runtime attestation + contract | `npx vitest run tests/integration/mcp-runtime.test.ts -t "prompts" tests/contract/mcp-prompt-shape.test.ts` | ❌ W0 | ⬜ pending |
| MCP-06 | Every MCP tool error path is sanitized via Phase 1 `sanitize.ts` pipeline (no `Bearer`, no token material, no internal stack) | T-04-S5 | contract | extends existing `src/mcp/sanitize.test.ts` + adds Phase 4 tool-specific fixtures | ⚠️ extend existing | ⬜ pending |

---

## Wave 0 Requirements

### Domain math test stubs

- [ ] `src/domain/stats/median.test.ts` — median + edge cases (empty, single, even, odd, ties)
- [ ] `src/domain/stats/mad.test.ts` — MAD + 1.4826 consistency constant; MAD=0 fallback
- [ ] `src/domain/stats/mann-whitney.test.ts` — worked examples from canonical sources; exact-vs-asymptotic switchover at n=20
- [ ] `src/domain/stats/fdr.test.ts` — BH step-up worked examples from Benjamini & Hochberg 1995
- [ ] `src/domain/baselines/baseline.test.ts` — trailing-30 over SCORED + DST-excluded; coverage_pct computation
- [ ] `src/domain/confidence/index.test.ts` — tier-gating thresholds; Z refused < 14 days
- [ ] `src/domain/anomalies/anomaly.test.ts` — `|z| ≥ 2.0` firing + per-metric direction
- [ ] `src/domain/anomalies/direction.test.ts` — one assert per metric direction entry (no silent mis-mapping)
- [ ] `src/domain/patterns/pattern.test.ts` — bottom-quartile worst-day selection + tie-breaking + ADR-0004 typed positive output
- [ ] `src/domain/patterns/candidates.test.ts` — exactly 5 pre-registered candidate factors (D-11)
- [ ] `src/domain/actions/catalog.test.ts` — one assert per entry: verb-first + length cap + banned-word free
- [ ] `src/domain/actions/decision-prompts.test.ts` — one assert per prompt template

### Service test stubs

- [ ] `src/services/review/resolve-date.test.ts` — D-01 `reviewed_date` resolution (MAX(start) over SCORED + non-excluded)
- [ ] `src/services/review/daily.test.ts` — happy path + insufficient + no-anomalies + capped-anomalies
- [ ] `src/services/review/weekly.test.ts` — pattern-clears-fdr + fdr-suppression (REV-07) + decision-prompt-injection (DEC-04)
- [ ] `src/services/decision/index.test.ts` — add + review + update orchestration
- [ ] `src/services/cache/index.test.ts` — `whoop_query_cache` typed filters
- [ ] `src/services/api-gap/index.test.ts` — `whoop_api_gap` catalog return

### CLI / formatter test stubs

- [ ] `src/cli/commands/review-daily.test.ts`
- [ ] `src/cli/commands/review-weekly.test.ts`
- [ ] `src/cli/commands/decision-add.test.ts`
- [ ] `src/cli/commands/decision-review.test.ts`
- [ ] `src/cli/commands/decision-update.test.ts`
- [ ] `src/cli/commands/query.test.ts`
- [ ] `src/cli/commands/api-gap.test.ts`
- [ ] `src/formatters/daily-review.txt.test.ts`
- [ ] `src/formatters/weekly-review.txt.test.ts`
- [ ] `src/formatters/decision.txt.test.ts`
- [ ] `src/formatters/query-cache.txt.test.ts`
- [ ] `src/formatters/api-gap.txt.test.ts`

### Contract tests (new)

- [ ] `tests/contract/daily-review-shape.test.ts` — REV-03/04 schema + data-freshness lead
- [ ] `tests/contract/formatter-tone.test.ts` — D-26 banned-word lint over rendered output × all fixtures
- [ ] `tests/contract/mcp-tool-shape.test.ts` — MCP-02 dual-shape contract over all 8 tools
- [ ] `tests/contract/mcp-resource-shape.test.ts` — MCP-04 resource read return shape
- [ ] `tests/contract/mcp-prompt-shape.test.ts` — MCP-05 `messages[]` shape over all 4 prompts
- [ ] `tests/contract/mcp-shim-loc.test.ts` — MCP-03 ≤ 5-line shim static analysis

### Fixture corpus (Wave 0 + per-plan adds)

- [ ] `tests/fixtures/review/daily-strong-confidence.json`
- [ ] `tests/fixtures/review/daily-weak-confidence.json`
- [ ] `tests/fixtures/review/daily-insufficient-days.json` (REV-05 — 8 SCORED days)
- [ ] `tests/fixtures/review/daily-no-anomalies.json`
- [ ] `tests/fixtures/review/daily-three-anomalies-capped.json` (D-08 catalog cap)
- [ ] `tests/fixtures/review/weekly-pattern-clears-fdr.json`
- [ ] `tests/fixtures/review/weekly-pattern-fdr-suppression.json` (REV-07 load-bearing per D-35; built by deterministic generator under `tests/fixtures/review/_generators/`)
- [ ] `tests/fixtures/review/weekly-pattern-partial-rejection.json` (D-35 secondary path — preserved D-15 original numbers)
- [ ] `tests/fixtures/review/weekly-no-pattern-insufficient-window.json` (n_scored < 14)
- [ ] `tests/fixtures/review/weekly-decision-prompt-none-this-week.json` (DEC-04 / D-22)
- [ ] `tests/fixtures/decisions/decision-add-happy-path.json`
- [ ] `tests/fixtures/decisions/decision-review-list.json`
- [ ] `tests/fixtures/decisions/decision-review-interactive-update.json`
- [ ] `tests/fixtures/mcp/whoop-daily-review/<scenario>.json` × 4
- [ ] `tests/fixtures/mcp/whoop-weekly-review/<scenario>.json` × 4
- [ ] `tests/fixtures/mcp/whoop-query-cache/<resource>-<scenario>.json` × 8
- [ ] `tests/fixtures/mcp/whoop-add-decision/<scenario>.json` × 3
- [ ] `tests/fixtures/mcp/whoop-review-decisions/<mode>-<scenario>.json` × 4
- [ ] `tests/fixtures/mcp/whoop-api-gap/<scenario>.json` × 1
- [ ] `tests/fixtures/mcp/whoop-doctor/<scenario>.json` × 1 (Phase 1 carry-forward)

### CI gate extensions

- [ ] `scripts/ci-grep-gates.sh` Gate H — `\btools\.length\s*===\s*1\b` does NOT appear outside `tests/__legacy__/` (D-33 anti-regression)
- [ ] `scripts/ci-grep-gates.sh` Gate I — outside `src/mcp/register-resource.ts`, no direct `server.registerResource(` (D-36)
- [ ] `scripts/ci-grep-gates.sh` Gate J — outside `src/mcp/register-prompt.ts`, no direct `server.registerPrompt(` (D-36)

*Existing infrastructure (vitest + biome + grep-gates + fixture-only ADR-0006) is in place; no framework install needed.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| MCP Inspector roundtrip for all 8 tools | MCP-01 | Inspector is a TTY tool; auto-launch in CI is brittle. The runtime attestation test covers the registration; visual inspection is the human gate. | `npm run build && npx @modelcontextprotocol/inspector node dist/mcp.js` — click each of the 8 tools, confirm `structuredContent` + `content` render in the right pane. |
| MCP Inspector roundtrip for all 6 resources + 4 prompts | MCP-04 / MCP-05 | Same as above. | Same inspector session — switch to the Resources tab + Prompts tab. |
| Banned-word lint visual spot-check on a synthetic weak-confidence review | REV-08 | The lint catches the 12 banned tokens; a human catches phrasings that pattern-match the spirit of the lint without matching a literal token. | Run `recovery-ledger review weekly --fixture weekly-no-pattern-insufficient-window.json` and read the output for "vibey" language even if the lint passes. |

---

## Threat Model Refs (ASVS L1)

> Per `workflow.security_enforcement` (default = enabled). Phase 4 inherits Phase 1's `sanitize.ts` + Phase 2's token-store discipline; new threats specific to Phase 4 listed below. The planner MUST emit a `<threat_model>` block in every PLAN.md that touches MCP, CLI input, or DB writes.

| Threat ID | Description | Phase 4 surface | Mitigation | Test |
|-----------|-------------|-----------------|------------|------|
| T-04-S1 | Statistical engine fed adversarial / malformed cycle data (NaN, Infinity, negative durations) | `src/domain/baselines`, `src/domain/stats` | Zod schema at the boundary (`Bootstrapped.services.getDailyReview` input is `{ reviewed_date?: string }`; cycle data is internal — boundary is the WHOOP fetch in Phase 3). Stats functions assume finite numbers; NaN/Infinity must be filtered upstream. | unit assertions in `median.test.ts` / `mad.test.ts` that NaN inputs throw a typed error |
| T-04-S2 | CLI `decision add "<text>"` shell-escape / command injection via unquoted text | `src/cli/commands/decision-add.ts` | Commander passes argv as an array; we never `exec()` user input. SQL parameters are bound via drizzle's parameterized queries. Repo write goes through `decisions.repo.ts` which uses prepared statements. | `decision-add.test.ts` includes a fixture with shell metacharacters and SQL-injection-style payloads (`'; DROP TABLE decisions; --`) and asserts the raw text round-trips through DB unchanged |
| T-04-S3 | MCP tool error path leaks token material (Bearer prefix, refresh-token suffix) through `content` or `structuredContent` | `src/mcp/register.ts`, `src/mcp/register-resource.ts`, `src/mcp/register-prompt.ts`, `src/mcp/sanitize.ts` | All 18 surfaces (8 tools + 6 resources + 4 prompts) flow through the Phase 1 sanitizer wrapper. The wrappers are the single line of defense; D-36 extends the discipline. Gates I + J refuse direct `server.registerResource` / `server.registerPrompt` outside the wrappers. | extends `sanitize.test.ts` with Phase 4 tool/resource/prompt error fixtures; runtime attestation that every registered surface goes through the wrapper |
| T-04-S4 | MCP resource read returns sensitive data (raw OAuth token, refresh token, full decision text with PII) under an attacker-controlled URI | `src/mcp/resources/*.ts` | All 6 resources have static URIs (D-36, no `ResourceTemplate` with attacker-controlled path segments). Each resource handler reads from the typed service layer (no raw DB rows). `whoop://decisions/open` returns only `id, created_at, decision, status, follow_up_date` — never tokens. | `mcp-resource-shape.test.ts` asserts no resource return contains `Bearer`, `refresh_token`, or `access_token` substrings |
| T-04-S5 | Sanitizer regression: a new tool/resource/prompt is added but doesn't go through the wrapper | `src/mcp/tools/*`, `src/mcp/resources/*`, `src/mcp/prompts/*` | Gates H/I/J refuse the regression at lint time. The runtime attestation tests count registered surfaces and re-assert the wrapper layer is exercised. | `scripts/ci-grep-gates.sh` (Gates H/I/J) + `mcp-runtime.test.ts` |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies (planner enforces)
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify (plan-checker enforces)
- [ ] Wave 0 covers all MISSING references in the per-task verification map above
- [ ] No watch-mode flags in any `<automated>` command (Vitest `run` mode only)
- [ ] Feedback latency < 90 seconds (full suite)
- [ ] `nyquist_compliant: true` set in frontmatter after plan-checker pass

**Approval:** pending — flips to approved after gsd-plan-checker emits `## VERIFICATION PASSED`.
