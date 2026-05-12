# AGENTS.md

> Canonical agent instructions for Recovery Ledger. Follows the
> [agents.md](https://agents.md/) philosophy: short root file, depth in
> [`agent_docs/`](./agent_docs/). `CLAUDE.md` is a symlink to this file —
> **edit `AGENTS.md`**, not `CLAUDE.md`.

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

Code style, testing rules, and file-layout patterns live in [`agent_docs/conventions.md`](./agent_docs/conventions.md). Summary: TypeScript strict, no default exports, lite hexagonal layout, validation at boundaries only, comments only when the *why* isn't obvious.
<!-- GSD:conventions-end -->

<!-- GSD:architecture-start source:ARCHITECTURE.md -->
## Architecture

Target shape (lite hexagonal): `src/cli/` and `src/mcp/` are ≤5-line shims over `src/services/` (orchestration), which compose pure `src/domain/` (baselines, anomaly detection, confidence-tier gating, FDR), backed by `src/infrastructure/` (WHOOP HTTP, Drizzle, token store, config) and rendered through `src/formatters/`. No business logic in transport code, ever.

Full module layout, data flows, build order, and testing seams: [`.planning/research/ARCHITECTURE.md`](./.planning/research/ARCHITECTURE.md).
<!-- GSD:architecture-end -->

<!-- GSD:skills-start source:skills/ -->
## Project Skills

No project skills yet. Catalog + plugin pin live in [`agent_docs/skills.md`](./agent_docs/skills.md). The `compound-engineering` plugin is pinned via [`.claude/settings.json`](./.claude/settings.json) — first-time setup per machine: `/plugin marketplace add EveryInc/compound-engineering-plugin`.
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

Each rule below is articulated as an ADR. Treat them as load-bearing
constraints, not stylistic preferences. The ADR has the *why* and the
*enforcement*; this table is the at-a-glance index.

| # | Rule | ADR |
|---|------|-----|
| 1 | MCP stdout purity — no `console.*` in MCP-reachable code | [ADR-0001](./agent_docs/decisions/0001-mcp-stdout-purity.md) |
| 2 | Single-flight OAuth refresh — in-process + file lock + atomic write | [ADR-0002](./agent_docs/decisions/0002-single-flight-oauth-refresh.md) |
| 3 | `score_state` discipline — discriminated union, SCORED-only domain | [ADR-0003](./agent_docs/decisions/0003-score-state-discipline.md) |
| 4 | "No reliable pattern detected" is a positive output | [ADR-0004](./agent_docs/decisions/0004-no-reliable-pattern-positive-output.md) |
| 5 | Banned tone words — CI-enforced list, no emoji in review output | [ADR-0005](./agent_docs/decisions/0005-banned-tone-words.md) |
| 6 | Tests never call WHOOP for real — MSW + fixture-only by default | [ADR-0006](./agent_docs/decisions/0006-fixture-only-tests.md) |
| 7 | Read-only with respect to WHOOP — GET-only HTTP client | [ADR-0007](./agent_docs/decisions/0007-whoop-read-only.md) |

If a change brushes against any of these, surface the ADR in the PR's
Section 2 (For Agents) so reviewers know what to check.

## Scope Guardrail

Web dashboard, BLE companion, hosted SaaS, cross-source integrations, and mobile are **out of scope** until: (1) the daily review has been used ≥ 12 times, (2) ≥ 3 weekly reviews are complete, (3) the decision ledger has ≥ 8 recorded decisions, (4) core tests are stable, (5) setup no longer feels fragile.

Permanently out of scope (do not reopen): consumer / private WHOOP endpoint scraping, write operations to WHOOP, medical advice, multi-user coaching, streaks / gamification, mobile app, free-form SQL pass-through tool.

Full list with reasons: [`.planning/PROJECT.md` § Out of Scope](./.planning/PROJECT.md), [`.planning/REQUIREMENTS.md` § Out of Scope](./.planning/REQUIREMENTS.md).

## Branch policy

> **From Phase 1 onward: never push directly to `main`.** All code changes go through a worktree + branch + PR + explicit user approval.

Two-layer enforcement:

1. **GitHub branch protection on `main`** — the actual fence. Refuses non-PR pushes, force-pushes, and deletions at the API level. This is the load-bearing layer.
2. **Best-effort PreToolUse guards** in [`.claude/settings.json`](./.claude/settings.json) — refuse the obvious mistakes (`git push origin main`, `--no-verify`, `--gpg-sign=false`) before the request reaches git. These do **not** plug every shell indirection (`sh -c`, `eval`, `$(…)`, heredoc-driven file writes). Branch protection catches what slips past them. Treat the hooks as cheap first-line guards, not a sufficient defense.

Carve-out (Phase 0 only): `.planning/**`-only edits may land directly on `main`. The carve-out expires the moment any `src/` content is tracked. Check with:

```sh
git ls-tree -r --name-only origin/main | grep -q '^src/' && echo "carve-out EXPIRED" || echo "carve-out ACTIVE"
```

If expired, this section gets updated to drop the carve-out.

Full rules (branch naming, commit format, hook scope, bypass policy): [`agent_docs/workflows/contributing.md`](./agent_docs/workflows/contributing.md).

## Bash

Once `package.json` content lands in Phase 1, the standard commands are:

```sh
npm install
npm run dev:cli                   # tsx watch src/cli/index.ts
npm run dev:mcp                   # tsx src/mcp/index.ts  (do NOT pipe stdout to terminal)
npm run build                     # tsup → dist/
npm run test                      # vitest run  (fixture-only; offline)
npm run lint                      # biome check
npm run format                    # biome check --write
npm run migrate:generate          # drizzle-kit generate
```

MCP Inspector:

```sh
npx @modelcontextprotocol/inspector node dist/mcp.js
```

GSD planning:

```sh
gsd-sdk query <handler>
/gsd-plan-phase <N>
/gsd-execute-phase <N>
/gsd-progress
```

## Where to look

| Need | Go to |
|------|-------|
| Project shape (mission, scope, status) | [`.planning/PROJECT.md`](./.planning/PROJECT.md) |
| Requirements + out-of-scope list | [`.planning/REQUIREMENTS.md`](./.planning/REQUIREMENTS.md) |
| Roadmap and current phase | [`.planning/ROADMAP.md`](./.planning/ROADMAP.md), [`.planning/STATE.md`](./.planning/STATE.md) |
| Stack versions + anti-recommendations | [`.planning/research/STACK.md`](./.planning/research/STACK.md) |
| Architecture (module layout, data flows) | [`.planning/research/ARCHITECTURE.md`](./.planning/research/ARCHITECTURE.md) |
| Code style, testing, file layout | [`agent_docs/conventions.md`](./agent_docs/conventions.md) |
| Worktree + PR + commit rules | [`agent_docs/workflows/contributing.md`](./agent_docs/workflows/contributing.md) |
| PR review (`/ce-code-review` usage) | [`agent_docs/workflows/pr-review.md`](./agent_docs/workflows/pr-review.md) |
| Debugging workflow | [`agent_docs/workflows/debugging.md`](./agent_docs/workflows/debugging.md) |
| Architectural decisions (immutable) | [`agent_docs/decisions/`](./agent_docs/decisions/) |
| Recurring-issue rules (self-healing log) | [`agent_docs/learnings.md`](./agent_docs/learnings.md) |
| Project skill catalog + plugin pin | [`agent_docs/skills.md`](./agent_docs/skills.md) |
| PR template (both sections required) | [`.github/pull_request_template.md`](./.github/pull_request_template.md) |
| Claude Code settings + hooks | [`.claude/settings.json`](./.claude/settings.json) |

<!-- END: hand-maintained sections -->

<!-- GSD:profile-start -->
## Developer Profile

> Profile not yet configured. Run `/gsd-profile-user` to generate your developer profile.
> This section is managed by `generate-claude-profile` -- do not edit manually.
<!-- GSD:profile-end -->
