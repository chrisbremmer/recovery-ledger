# Recovery Ledger

Local-first WHOOP data reviews for recovery-aware training and sleep decisions.

Recovery Ledger syncs your official WHOOP API v2 data into a local SQLite cache and exposes structured daily and weekly review tools through a CLI and an MCP server. It is built for people who want a private, repeatable way to turn WHOOP data into decisions — not another endpoint wrapper.

> **Status:** Pre-v1, in active development. Phases 1–4 of the five-phase v1 roadmap are complete: foundation + stdout-pure MCP bootstrap, BYO OAuth with single-flight refresh, the SQLite data model + idempotent sync loop, and the full domain-math/review/decision-ledger/MCP surface (Phase 4 closed 2026-05-20). The CLI and MCP server expose the complete daily/weekly review and decision-ledger workflow today. Phase 5 — `doctor` polish, per-client install guides, and a CI-enforced sub-20-minute setup — is in planning. See [`.planning/STATE.md`](.planning/STATE.md) and [`.planning/ROADMAP.md`](.planning/ROADMAP.md).
>
> **Not affiliated with or endorsed by WHOOP.** Bring your own WHOOP developer app.

## What it does

The core loop is small and deliberate:

1. **Sync** WHOOP API v2 data (cycles, recovery, sleep, workouts, profile, body measurements) into a local SQLite cache.
2. **Review** today's state against your trailing 30-day baseline, plus this week's worst-recovery days against plausible precursors.
3. **Decide** — every daily review ends in at most three concrete actions.
4. **Record** the decision in a local ledger with rationale, expected effect, and a follow-up date.
5. **Re-review** later to see whether the decision actually helped.

If a feature does not improve sync reliability, review quality, or repeat usage, it doesn't ship.

## Principles

- **Local-first.** Your WHOOP data and derived insights live on your machine.
- **BYO OAuth.** You create your own WHOOP developer app. No shared relay, no proxy.
- **Read-only.** Recovery Ledger never writes back to WHOOP.
- **Transparent uncertainty.** Insights distinguish "strong pattern," "weak signal," and "insufficient data." Small samples return "no reliable pattern detected" rather than inventing one.
- **Decision-oriented.** Output ends with concrete today/tomorrow actions, not generic coaching.
- **Small loops beat big dashboards.** No dashboard, no BLE companion, no hosted service in v1.
- **API-gap honesty.** WHOOP features not exposed by the public API (Healthspan, ECG, BP, journal, continuous HR) are surfaced explicitly through `whoop_api_gap`, never silently dropped.

## Stack

| Concern | Choice |
|---|---|
| Language | TypeScript on Node 22 LTS (Bun-compatible) |
| MCP server | [`@modelcontextprotocol/sdk`](https://github.com/modelcontextprotocol/typescript-sdk) over stdio |
| Database | SQLite (WAL mode) via [`better-sqlite3`](https://github.com/WiseLibs/better-sqlite3) + [Drizzle ORM](https://orm.drizzle.team/) |
| Validation | [Zod](https://zod.dev/) |
| HTTP / OAuth | Native `fetch` + hand-rolled WHOOP OAuth client with single-flight refresh |
| Secrets at rest | [`@napi-rs/keyring`](https://github.com/Brooooooklyn/keyring-node) (with `chmod 600` file fallback) |
| CLI | [Commander](https://github.com/tj/commander.js) |
| Tests | [Vitest](https://vitest.dev/) + [MSW](https://mswjs.io/) (fixture-based contract tests; no live API calls) |
| Lint / format | [Biome](https://biomejs.dev/) |

## Roadmap (v1)

Five phases, layered to lock cross-cutting safety nets before any application code is written. Full detail in [`.planning/ROADMAP.md`](.planning/ROADMAP.md).

| # | Phase | Status | What it delivers |
|---|---|---|---|
| 1 | Foundation & Stdout-Pure MCP Bootstrap | Complete (2026-05-12) | Repo, CLI/MCP shells, stderr-only logging, MCP error sanitizer, native-module checks |
| 2 | OAuth, Token Store & Single-Flight Refresh | Complete (2026-05-12) | BYO WHOOP auth, keychain-backed tokens, concurrent CLI+MCP refresh without burning the token family |
| 3 | Data Model, DB Layer & Sync Loop | Complete (2026-05-16) | Drizzle schema with `score_state` discipline, DST/tz exclusion, idempotent sync with partial-failure reporting |
| 4 | Domain Math, Reviews, Decision Ledger & MCP Surface | Complete (2026-05-20) | Daily + weekly reviews (median + MAD baselines, FDR-corrected patterns), decision ledger, 8 tools + 6 resources + 4 prompts |
| 5 | Doctor Polish, Install Guide & <20-min Setup | In planning | `doctor` covering every prior phase; per-client install guides; CI stopwatch test |

## CLI surface

All commands below are implemented (Phases 1–4):

```sh
recovery-ledger init                     # bootstrap BYO WHOOP OAuth credentials → ~/.recovery-ledger/config.json
recovery-ledger auth                     # OAuth flow on a dynamic loopback port; tokens to keychain or chmod-600 file
recovery-ledger sync --days 30           # sync WHOOP data into the local SQLite cache (idempotent, partial-failure aware)
recovery-ledger review daily             # today vs trailing-30 baseline + up to 3 concrete actions
recovery-ledger review weekly            # trailing-7 narrative + FDR-corrected 28-day pattern test
recovery-ledger decision add "<text>"    # record a decision (--category, --rationale, --confidence, --follow-up)
recovery-ledger decision review          # list open decisions; --interactive prompts past-window outcomes
recovery-ledger decision update <id>     # record an outcome (--status followed_up|abandoned, --notes)
recovery-ledger query <resource>         # read a typed slice of the cache (cycles, recoveries, decisions, …)
recovery-ledger api-gap                  # list WHOOP features unavailable via the public v2 API
recovery-ledger doctor                   # auth, token, DB, sync, MCP, data-quality checks (exit 0 pass / 1 fail / 2 warn)
```

Phase 5 expands `doctor` to cover every prior phase's failure modes and ships the per-client install guide its exit codes map to.

## MCP surface

**Tools** — `whoop_sync`, `whoop_daily_review`, `whoop_weekly_review`, `whoop_query_cache`, `whoop_add_decision`, `whoop_review_decisions`, `whoop_api_gap`, `whoop_doctor`

**Resources** — `whoop://summary/today`, `whoop://summary/week`, `whoop://baseline/30d`, `whoop://data-quality`, `whoop://api-gaps`, `whoop://decisions/open`

**Prompts** — `whoop_daily_decision_brief`, `whoop_weekly_recovery_investigation`, `whoop_experiment_designer`, `whoop_deload_or_train`

Every tool returns structured JSON plus a compact text fallback for clients with weaker structured-output support.

### Environment

- `MCP_DB_FILE` — optional override for the SQLite path used by the MCP stdio server (defaults to the resolved `paths.dbFile` in `~/.recovery-ledger/`). Intended as a testability knob for smoke harnesses and CI; pass `:memory:` to route bootstrap at an in-memory DB. **Trust model:** the local process owner already has filesystem read/write to the data dir, so this variable does not weaken the security posture — it just lets test harnesses target a scratch DB without touching production state.

## Scope guardrail

Web dashboard, BLE companion, hosted service, mobile app, and cross-source integrations stay out of scope until all of these are true:

1. The daily review has been used at least 12 times
2. At least 3 weekly reviews are complete
3. The decision ledger has at least 8 recorded decisions
4. Core tests are stable
5. Setup no longer feels fragile

Consumer / private WHOOP endpoint scraping, write operations to WHOOP, medical advice, multi-user coaching, and streaks/gamification are **permanently** out of scope.

## Repository layout (current)

```
.
├── .planning/                # GSD planning artifacts (committed)
│   ├── PROJECT.md            # What this is, core value, requirements, decisions
│   ├── REQUIREMENTS.md       # 49 v1 requirements with REQ-IDs and traceability
│   ├── ROADMAP.md            # 5-phase plan with per-phase status
│   ├── STATE.md              # Current execution state
│   ├── phases/               # Per-phase PLAN / VALIDATION / REVIEW artifacts
│   ├── config.json           # GSD workflow config
│   └── research/             # STACK / FEATURES / ARCHITECTURE / PITFALLS / SUMMARY
├── src/
│   ├── cli/                  # Commander shims over services (≤ 5 lines each)
│   ├── mcp/                  # MCP stdio server + tool registration shims
│   ├── services/             # Orchestration (sync, auth, doctor)
│   ├── domain/               # Pure functions (score discipline, types)
│   ├── infrastructure/       # WHOOP HTTP, Drizzle, token store, config, paths
│   └── formatters/           # Text/JSON renderers
├── tests/
│   ├── contract/             # Fixture-based WHOOP contract tests (MSW, offline)
│   ├── integration/          # DB migrator, auth concurrency, sync orchestration
│   ├── fixtures/             # WHOOP API response fixtures
│   ├── helpers/              # MSW handlers + in-memory DB helpers
│   └── setup/                # Vitest setup
├── agent_docs/               # Agent-facing conventions, ADRs, workflows
│   ├── decisions/            # ADR-0001 … ADR-0007
│   ├── workflows/            # contributing, pr-review, debugging
│   ├── conventions.md
│   └── learnings.md
├── scripts/                  # CI grep gates, worktree hooks
├── .github/                  # Workflows + PR template
├── AGENTS.md                 # Canonical agent instructions (CLAUDE.md → symlink)
└── README.md
```

## Disclaimers

This project is independent of WHOOP, Inc. WHOOP is a trademark of WHOOP, Inc. Recovery Ledger consumes the public WHOOP API v2 with user-provided OAuth credentials and makes no claim of partnership or endorsement.

Recovery Ledger is **decision support, not clinical advice**. It does not diagnose, treat, or monitor medical conditions.
