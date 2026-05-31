# Recovery Ledger

## What This Is

Recovery Ledger is a local-first personal operating system for recovery-aware training and sleep decisions, built on top of the official WHOOP API v2. It syncs WHOOP data into a local SQLite cache and exposes structured daily/weekly review tools through a CLI and MCP server so Chris — and any technically inclined WHOOP user — can turn raw recovery data into a small set of concrete decisions and a ledger of whether those decisions helped.

Not affiliated with or endorsed by WHOOP. Bring your own WHOOP developer app.

## Core Value

Turn WHOOP data into a daily and weekly review loop that ends in 3 concrete decisions and a record of whether they helped — useful enough that Chris keeps using it.

## Current Milestone: v1.1 quality hardening

**Goal:** Ship code fixes for all 21 open GitHub issues surfaced by the post-v1.0 deep-review pass — defensive hardening across security/sanitizer, OAuth/refresh, DB/schema, doctor probes, CLI/UX, architecture, and testing — without regressing v1.0's 50/50 requirement validation.

**Target features:**
- 10 HIGH-severity bug fixes (one PR per HIGH issue)
- 10 MEDIUM-severity bug fixes (grouped into themed PRs)
- Tracker #95 v1.1 quality-hardening backlog (~28 small items)

**Source:** GitHub issues #75-#95, all labeled `code-review`. No new user-facing features; pure quality work.

## Requirements

### Validated

<!-- Shipped and confirmed valuable. -->

- [x] BYO WHOOP OAuth setup with safe token refresh (concurrency-protected) — Validated in Phase 2: `recovery-ledger init` + `recovery-ledger auth` ship; three-layer single-flight refresh (in-process Promise + proper-lockfile + atomic write) ADR-0002 implementation; keychain-primary + chmod-600 file fallback; cross-process integration test (10-fork concurrency) green; sanitizer covers all OAuth leak shapes.

### Active

<!-- Current scope. Building toward these. -->

- [ ] Local-first SQLite cache for WHOOP API v2 cycles, recovery, sleep, workouts, profile, body measurements
- [ ] `recovery-ledger sync --days N` command with partial-failure reporting and rate-limit backoff
- [ ] `recovery-ledger review daily` — today vs trailing 30-day baseline + anomalies + top 3 actions
- [ ] `recovery-ledger review weekly` — worst-recovery days this week + plausible preceding patterns (or "no reliable pattern detected")
- [ ] Decision ledger: `decision add` / `decision review` to record intended actions, rationale, expected effect, follow-up date
- [ ] `recovery-ledger doctor` — auth, token, DB, sync, MCP, and data-quality status checks
- [ ] MCP stdio server exposing: `whoop_sync`, `whoop_daily_review`, `whoop_weekly_review`, `whoop_query_cache`, `whoop_add_decision`, `whoop_review_decisions`, `whoop_api_gap`, `whoop_doctor`
- [ ] MCP resources: `whoop://summary/today`, `whoop://summary/week`, `whoop://baseline/30d`, `whoop://data-quality`, `whoop://api-gaps`, `whoop://decisions/open`
- [ ] MCP prompts: `whoop_daily_decision_brief`, `whoop_weekly_recovery_investigation`, `whoop_experiment_designer`, `whoop_deload_or_train`
- [ ] Every tool returns structured JSON plus compact text fallback for weaker clients
- [ ] Fixture-based contract tests for each WHOOP API resource (no live API calls in default test run)
- [ ] API-gap documentation listing unsupported WHOOP metrics (Healthspan, ECG, BP, journal, continuous HR, etc.) with clear "unavailable via API" responses
- [ ] Install guide for Claude Code and Claude Desktop; compatibility note for Cursor

### Out of Scope

<!-- Firm exclusions. Gated behind the handoff's hard guardrail. -->

- Web dashboard — Defer until daily/weekly review loop is sticky (see Guardrail below)
- BLE companion — Defer until core loop is sticky
- Hosted SaaS / shared OAuth relay — v1 is local-first, BYO OAuth only
- Consumer / private WHOOP endpoint scraping — Read-only, official API v2 only; respects WHOOP ToS
- Healthspan, ECG, blood pressure, hormonal insights, journal, continuous HR — Not exposed via official WHOOP API; surfaced through `whoop_api_gap` instead
- Mobile app — Web/CLI only; no mobile in roadmap
- Multi-user coaching / shared team views — Single-user personal tool
- Medical advice or diagnosis — Decision support only, no clinical claims
- Cross-source integrations (Apple Health, calendar, nutrition) — Deferred per guardrail
- Write operations to WHOOP — Read-only

**Hard scope guardrail.** Dashboard, BLE companion, hosted connector, and cross-source integrations stay out of scope until all of these are true:
1. Chris has used the daily review at least 12 times
2. Chris has completed at least 3 weekly reviews
3. The decision ledger has at least 8 recorded decisions
4. The core tests are stable
5. Setup no longer feels fragile

## Context

- **Personal tool, single user.** Chris is the primary user and only target user for v1. A secondary "self-quantified developer with WHOOP" persona may emerge later but does not shape v1 tradeoffs.
- **Habit formation is the real product.** The success of this project is whether Chris keeps using it. Builder velocity, low friction, and a short morning brief matter more than feature breadth.
- **WHOOP API v2 is the only data source in v1.** All consumer-app features that aren't in the public API (journal, ECG, BP, continuous HR, Healthspan) must be surfaced as "unavailable via API" with a clean explanation — never silently dropped.
- **Local-first by default.** WHOOP data and derived insights live on Chris's machine. No telemetry, no sync to external servers.
- **Read-only.** Recovery Ledger never writes back to WHOOP. The decision ledger is a separate local concept, not a WHOOP entity.
- **Transparent uncertainty.** Every insight distinguishes "strong pattern," "weak signal," and "insufficient data." Confidence requires minimum sample counts; small samples must say "no reliable pattern detected" rather than invent one.
- **Direct, non-hype tone.** "Do Zone 2 or mobility today" beats "optimize recovery." "Sleep-debt signal, not a moral failure" beats guilt.
- **MCP-first interaction model.** Claude Code is the expected primary client; the CLI is a power-user backup, not the centerpiece.

## Constraints

- **Tech stack**: TypeScript on Node 22+ (Bun-compatible) — Chris's primary language; optimizes for personal-tool retention and iteration speed over the wider Python data-science ecosystem
- **MCP**: `@modelcontextprotocol/sdk` (TypeScript) — Anthropic's reference SDK; first-class support in Claude Code and Claude Desktop
- **Database**: SQLite in WAL mode via `better-sqlite3` — synchronous, embedded, zero-config; matches the local-first principle
- **Query layer**: Drizzle ORM — typed schema + migrations; lightweight enough to not become an abstraction tax
- **Validation**: Zod — runtime validation for WHOOP API responses, CLI input, and MCP tool I/O
- **HTTP**: native `fetch` / `undici` — no extra HTTP client dependency
- **Tests**: Vitest with fixture-based contract tests; no live WHOOP API calls in the default suite; suite must run in under 60 seconds locally
- **Lint/format**: Biome (or ESLint + Prettier if Biome causes friction)
- **WHOOP**: BYO developer app and OAuth credentials in v1 — no shared relay, no proxy
- **Read-only API access**: No write endpoints, no scopes beyond what's required for sync
- **Setup target**: Fresh clone → first successful sync in under 20 minutes; first daily review in under 2 minutes after sync
- **Maintenance**: A new contributor (or future Chris after 3 months away) can add one derived metric or one review rule by following a single documented pattern

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| TypeScript instead of handoff-recommended Python | Chris is most fluent in TS; retention (continued use and iteration) is the real success metric, and language friction is the silent killer of personal tools. MCP SDK, SQLite tooling, and Zod cover the Python equivalents (FastMCP, SQLModel, Pydantic) with no meaningful capability gap for this scope. | — Pending |
| Done bar = working loop, not retention numerics | Retention metrics (3 weekdays/week, 2 decisions/week, etc.) measure adoption, not whether v1 is built. v1 done = sync + daily review + weekly review + decision ledger + Claude Code can call MCP tools end-to-end. Habit metrics tracked post-v1 as a separate milestone. | — Pending |
| Firm scope guardrail with explicit preconditions | Personal tools die from scope creep before the core loop sticks. Locking dashboard/BLE/hosted/integrations behind concrete usage preconditions prevents drift even when novelty wears off. | — Pending |
| Read-only + BYO OAuth + no consumer-endpoint scraping | Keeps Recovery Ledger on the right side of WHOOP's ToS and avoids WHOOP-platform risk (terms changes, rate limits, approval). Trades convenience for durability. | — Pending |
| MCP stdio + structured JSON with text fallback | Matches the supported MCP client matrix (Claude Code, Claude Desktop, Cursor). Text fallback keeps weaker clients usable without inventing a second tool surface. | — Pending |

## Evolution

This document evolves at phase transitions and milestone boundaries.

**After each phase transition** (via `/gsd-transition`):
1. Requirements invalidated? → Move to Out of Scope with reason
2. Requirements validated? → Move to Validated with phase reference
3. New requirements emerged? → Add to Active
4. Decisions to log? → Add to Key Decisions
5. "What This Is" still accurate? → Update if drifted

**After each milestone** (via `/gsd-complete-milestone`):
1. Full review of all sections
2. Core Value check — still the right priority?
3. Audit Out of Scope — reasons still valid? Guardrail preconditions met?
4. Update Context with current state

---
*Last updated: 2026-05-31 — milestone v1.1 (quality hardening) started after v1.0 close (50/50 reqs validated)*
