# Conventions

Code-style, testing, and file-layout rules for Recovery Ledger.
[`AGENTS.md`](../AGENTS.md) links here for depth; this file is where rules
actually live.

If you're adding a rule, also wire it into the cheapest mechanical layer
that can catch it (Biome config, husky hook, CI workflow, Claude Code
hook). The doc is only the rule's last line of defense.

## Code style

- **TypeScript strict.** `strict: true`, `noUncheckedIndexedAccess: true`,
  `exactOptionalPropertyTypes: true`. ESM only.
- **No default exports.** Named exports throughout — easier to grep, easier
  to refactor.
- **Module layout** (lite hexagonal — see
  [`.planning/research/ARCHITECTURE.md`](../.planning/research/ARCHITECTURE.md)):
  - `src/cli/` — Commander shims, one file per command
  - `src/mcp/` — MCP tool/resource/prompt registrations, ≤ 5 lines each
  - `src/services/` — orchestration; the surface CLI and MCP both call
  - `src/domain/` — pure functions, no I/O, fully unit-testable with
    array literals
  - `src/infrastructure/` — WHOOP HTTP client, Drizzle schema + migrator,
    token store, config
  - `src/formatters/` — structured JSON + compact text per tool;
    banned-word lint enforced
- **WHOOP types live in three layers:** raw (Zod, snake_case as wire
  format), entity (Drizzle row types, snake_case columns / camelCase TS),
  view (review output shapes). Do not collapse the layers.
- **Dates** via `date-fns` v4 + `@date-fns/tz`. Never use `Date` arithmetic
  across midnight or DST boundaries without explicit zone handling.
- **Validation at boundaries only.** Zod-parse WHOOP responses, CLI flags,
  and MCP tool inputs. Inside domain code, trust the types.
- **Comments:** default to none. Add only when the *why* is non-obvious
  (a workaround, a subtle invariant, a known WHOOP quirk). Never describe
  *what* — the code already does that. When a comment must REFERENCE a
  CI grep-gate target (e.g., `console.*`, `process.stdout.write`,
  `server.registerTool(`, `drizzle-orm`, `fetch(`), use semantic
  phrasing — never inline the literal substring, because the gates are
  word-boundary literal checks with no comment-awareness and will trip
  on the prose. See
  [`agent_docs/learnings.md`](./learnings.md) §L0005 for the full
  substitution table.

## Testing

- `vitest run` is the canonical test entry. `vitest` (watch) for dev.
- `pool: 'forks'` is mandatory — `better-sqlite3` native handles do not
  cross worker threads cleanly.
- MSW 2 intercepts `fetch`. One handler file per WHOOP resource; each
  handler reads from `tests/fixtures/whoop/<resource>/<scenario>.json`.
- Every WHOOP resource has at least one contract test: handler loads
  fixture → service runs → SQLite rows match expected → Zod schema
  accepts the fixture (drift detection).
- Suite budget: under 60 seconds locally. If a test needs longer, split
  it or move it to a separate `vitest run --project slow` config.
- **No live WHOOP** by default. See
  [`decisions/0006-fixture-only-tests.md`](./decisions/0006-fixture-only-tests.md).
  Any test that hits the real API must require `VITEST_LIVE_WHOOP=1` and
  is skipped by default.

## Files, names, structure

- One concept per file. If `src/domain/baselines.ts` outgrows itself,
  split by sub-concept (`baselines/median.ts`, `baselines/coverage.ts`)
  before splitting by layer.
- Tests live next to source as `<name>.test.ts`. Contract tests live
  under `tests/contract/<resource>.test.ts` so they're cleanly
  identifiable.
- Fixtures live under `tests/fixtures/whoop/<resource>/<scenario>.json`,
  committed. No `<scenario>` is "default" — name what it represents
  (`scored-only.json`, `mixed-states.json`, `429-burst.json`).

## Cross-references

- [`AGENTS.md`](../AGENTS.md) — entry point with rule summaries
- [`decisions/`](./decisions/) — ADRs that lock these conventions
- [`learnings.md`](./learnings.md) — durable rules captured on recurrence
- [`.planning/research/ARCHITECTURE.md`](../.planning/research/ARCHITECTURE.md)
  — full module layout and data flows
- [`.planning/research/STACK.md`](../.planning/research/STACK.md) —
  versions and anti-recommendations
