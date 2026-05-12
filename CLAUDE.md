<!-- GSD:project-start source:PROJECT.md -->
## Project

**Recovery Ledger** — a local-first TypeScript CLI + MCP stdio server that syncs WHOOP API v2 data into SQLite and turns it into a daily/weekly review ritual plus a decision ledger. Single-user personal tool (Chris). Not affiliated with WHOOP. BYO OAuth.

**Core value:** Turn WHOOP data into a daily and weekly review loop that ends in 3 concrete decisions and a record of whether they helped — useful enough that Chris keeps using it.

**Status:** Planning artifacts committed (`.planning/PROJECT.md`, `REQUIREMENTS.md`, `ROADMAP.md`, `research/`). Implementation has not started — Phase 1 is next.

Canonical project context: [`.planning/PROJECT.md`](./.planning/PROJECT.md). Do not duplicate its contents here.
<!-- GSD:project-end -->

<!-- GSD:stack-start source:research/STACK.md -->
## Stack

TypeScript on Node 22 LTS (Bun-compatible). MCP via `@modelcontextprotocol/sdk` (stdio). SQLite via `better-sqlite3` + Drizzle ORM. Zod for validation. Native `fetch`. Tokens at rest in `@napi-rs/keyring` with `chmod 600` file fallback. CLI on Commander. Tests on Vitest + MSW (fixture-only). Lint/format on Biome. Build with `tsup`; dev with `tsx`. Logs via Pino → stderr.

Full versions, rationale, anti-recommendations, and version-compatibility notes: [`.planning/research/STACK.md`](./.planning/research/STACK.md).
<!-- GSD:stack-end -->

<!-- GSD:conventions-start source:CONVENTIONS.md -->
## Conventions

Conventions not yet established. Will populate as patterns emerge during development.
<!-- GSD:conventions-end -->

<!-- GSD:architecture-start source:ARCHITECTURE.md -->
## Architecture

Target shape (lite hexagonal): `src/cli/` and `src/mcp/` are ≤5-line shims over `src/services/` (orchestration), which compose pure `src/domain/` (baselines, anomaly detection, confidence-tier gating, FDR), backed by `src/infrastructure/` (WHOOP HTTP, Drizzle, token store, config) and rendered through `src/formatters/`. No business logic in transport code, ever.

Full module layout, data flows, build order, and testing seams: [`.planning/research/ARCHITECTURE.md`](./.planning/research/ARCHITECTURE.md).
<!-- GSD:architecture-end -->

<!-- GSD:skills-start source:skills/ -->
## Project Skills

No project skills found. Add skills to `.claude/skills/` with a `SKILL.md` index if needed.
<!-- GSD:skills-end -->

<!-- GSD:workflow-start source:GSD defaults -->
## GSD Workflow Enforcement

Before using Edit, Write, or other file-changing tools, start work through a GSD command so planning artifacts and execution context stay in sync.

Entry points:
- `/gsd-quick` — small fixes, doc updates, ad-hoc tasks
- `/gsd-debug` — investigation and bug fixing
- `/gsd-execute-phase` — planned phase work

Do not make direct repo edits outside a GSD workflow unless the user explicitly asks to bypass it.
<!-- GSD:workflow-end -->

<!-- BEGIN: hand-maintained sections (survive GSD regeneration) -->

## Critical Rules

These are the rules that will silently break the product if violated. Treat them as load-bearing constraints, not stylistic preferences.

**IMPORTANT — MCP stdout purity.** The MCP server speaks JSON-RPC on stdout. Anything else on stdout corrupts the protocol and breaks every connected client. Use Pino → stderr only. Never `console.log` / `console.error` / `console.warn` anywhere in code reachable from `src/mcp/`, `src/services/`, `src/domain/`, `src/infrastructure/`, or `src/formatters/`. The lint rule + CI assertion in Phase 1 enforces this; do not disable them.

**IMPORTANT — Single-flight OAuth refresh.** WHOOP rotates refresh tokens and treats reuse as a security event that revokes the whole token family. Concurrent CLI + MCP processes refreshing in parallel will burn auth and force the user back through `init`. Every refresh path must go through the in-process `Promise<Tokens> | null` single-flight + cross-process file advisory lock + atomic temp-and-rename token write. Do not add a "simpler" refresh path that bypasses the mutex.

**IMPORTANT — `score_state` discipline.** WHOOP cycles, recovery, sleep, and workouts emit one of `SCORED` / `PENDING_SCORE` / `UNSCORABLE`. Baselines, anomalies, and patterns must use `SCORED`-only by default. Never treat `PENDING_SCORE` or `UNSCORABLE` as zero, low, or missing data — that is the fastest way to destroy user trust. Domain code consumes scores through `Score = discriminatedUnion('score_state', …)`; the type system enforces this.

**IMPORTANT — "No reliable pattern detected" is a positive output.** When sample sizes are too small, when MAD-scaled deltas don't clear threshold, or when FDR correction kills every candidate factor, the weekly review must explicitly state "no reliable pattern detected." Never invent a pattern to fill the slot. Confidence-tier rules: `insufficient` for < 10 SCORED days, `weak` ≥ 10, `strong` ≥ 20 with ≥ 70% baseline coverage. Z-scores refused below 14 days.

**IMPORTANT — Banned tone words.** Review output is direct, non-hype, verb-first. The CI lint will fail the build on: `optimize`, `wellness`, `honor`, `journey`, `crush`, `nail`, `dial in`, `tune`, `vibe`, `unlock`, and any emoji. "Do Zone 2 or mobility today" beats "optimize recovery." "Sleep-debt signal, not a moral failure" beats guilt.

**IMPORTANT — Tests never call WHOOP for real.** The default test run is fixture-only via MSW. Live API calls must require an explicit opt-in flag (e.g., `VITEST_LIVE_WHOOP=1`) and are not part of CI. Fixtures live in `tests/fixtures/whoop/<resource>/<scenario>.json` and are committed.

**IMPORTANT — Read-only with respect to WHOOP.** Recovery Ledger never writes to WHOOP. No write endpoints, no scopes beyond what sync requires. The decision ledger is a separate local concept.

## Scope Guardrail

Web dashboard, BLE companion, hosted SaaS, cross-source integrations, and mobile are **out of scope** until: (1) the daily review has been used ≥ 12 times, (2) ≥ 3 weekly reviews are complete, (3) the decision ledger has ≥ 8 recorded decisions, (4) core tests are stable, (5) setup no longer feels fragile. If a task touches any of these, surface this guardrail before proceeding.

Permanently out of scope (do not reopen): consumer / private WHOOP endpoint scraping, write operations to WHOOP, medical advice, multi-user coaching, streaks / gamification, mobile app, free-form SQL pass-through tool.

Full list with reasons: [`.planning/PROJECT.md` § Out of Scope](./.planning/PROJECT.md) and [`.planning/REQUIREMENTS.md` § Out of Scope](./.planning/REQUIREMENTS.md).

## Bash

Source code lands during Phase 1. Once `package.json` exists, the standard commands will be:

```sh
npm install                       # or pnpm install / bun install — pick one and stick
npm run dev:cli                   # tsx watch src/cli/index.ts
npm run dev:mcp                   # tsx src/mcp/index.ts  (do NOT pipe stdout to terminal)
npm run build                     # tsup → dist/
npm run test                      # vitest run  (fixture-only; offline)
npm run lint                      # biome check
npm run format                    # biome check --write
npm run migrate:generate          # drizzle-kit generate
```

MCP Inspector (for debugging tool/resource/prompt registration without spinning up Claude Code):

```sh
npx @modelcontextprotocol/inspector node dist/mcp.js
```

GSD planning (already in use):

```sh
gsd-sdk query <handler>           # see .planning/ artifacts and config
/gsd-plan-phase <N>               # plan the next phase
/gsd-execute-phase <N>            # execute the planned phase
/gsd-progress                     # situational status
```

## Code Style

- **TypeScript strict.** `strict: true`, `noUncheckedIndexedAccess: true`, `exactOptionalPropertyTypes: true`. ESM only.
- **No default exports.** Named exports throughout — easier to grep, easier to refactor.
- **Module layout** (lite hexagonal — see `.planning/research/ARCHITECTURE.md`):
  - `src/cli/` — Commander shims, one file per command
  - `src/mcp/` — MCP tool/resource/prompt registrations, ≤ 5 lines each
  - `src/services/` — orchestration; the surface CLI and MCP both call
  - `src/domain/` — pure functions, no I/O, fully unit-testable with array literals
  - `src/infrastructure/` — WHOOP HTTP client, Drizzle schema + migrator, token store, config
  - `src/formatters/` — structured JSON + compact text per tool; banned-word lint enforced
- **WHOOP types live in three layers:** raw (Zod, snake_case as wire format), entity (Drizzle row types, snake_case columns / camelCase TS), view (review output shapes). Do not collapse the layers.
- **Dates** via `date-fns` v4 + `@date-fns/tz`. Never use `Date` arithmetic across midnight or DST boundaries without explicit zone handling.
- **Validation at boundaries only.** Zod-parse WHOOP responses, CLI flags, and MCP tool inputs. Inside domain code, trust the types.
- **Comments:** default to none. Add only when the *why* is non-obvious (a workaround, a subtle invariant, a known WHOOP quirk).

## Testing

- `vitest run` is the canonical test entry. `vitest` (watch) for dev.
- `pool: 'forks'` is mandatory — `better-sqlite3` native handles do not cross worker threads cleanly.
- MSW 2 intercepts `fetch`. One handler file per WHOOP resource; each handler reads from `tests/fixtures/whoop/<resource>/<scenario>.json`.
- Every WHOOP resource has at least one contract test: handler loads fixture → service runs → SQLite rows match expected → Zod schema accepts the fixture (drift detection).
- Suite budget: under 60 seconds locally. If a test needs longer, split it or move it to a separate `vitest run --project slow` config.
- "No live WHOOP" assertion: any test that hits the real WHOOP API must require `VITEST_LIVE_WHOOP=1` and is skipped by default.

## Repo Etiquette

- **Commit format:** Conventional-Commits-style, lower-case prefix, no period: `docs: define v1 requirements`, `chore: add project config`, `feat: implement sync service`, `fix: refresh-token race`, `test: add cycles contract fixture`. Match the style already in `git log`.
- **Atomic commits.** One concern per commit. Planning artifacts and code do not mix in the same commit.
- **Branch policy:** `main` is the only branch in v1. Direct commits to main are fine for now (single contributor, planning phase). Revisit when implementation produces real code paths to review.
- **Pushes:** push after each meaningful chunk of work; do not let local history outpace the remote by more than a session.
- **Planning artifacts** belong in `.planning/`. Do not write planning docs to `docs/` or the repo root.
- **Never bypass git hooks** (`--no-verify`) or skip GPG signing. Fix the underlying issue.
- **Do not amend pushed commits.** Add a follow-up.

<!-- END: hand-maintained sections -->


<!-- GSD:profile-start -->
## Developer Profile

> Profile not yet configured. Run `/gsd-profile-user` to generate your developer profile.
> This section is managed by `generate-claude-profile` -- do not edit manually.
<!-- GSD:profile-end -->
