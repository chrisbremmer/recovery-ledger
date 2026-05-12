# PR review

> Status: stub. Fills in as `/ce-code-review` usage patterns settle.
> Today this file documents the intended shape; once we've reviewed
> ≥ 3 PRs, the patterns get pinned here.

## How review runs

Every PR gets `/ce-code-review` run on it before requesting human
approval. The skill spawns a parallel multi-agent reviewer team
(correctness, testing, maintainability, project-standards, plus
conditional reviewers based on diff content) and merges their findings
into a single severity-ordered report.

```sh
# In a session with the PR branch checked out (or via the worktree)
/ce-code-review <PR-number-or-URL>
```

Modes:

- Default (interactive) — best for solo self-review; Claude walks
  through findings in conversation.
- `mode:report-only` — read-only; doesn't switch the checkout.
- `mode:headless` — structured text output, no follow-up questions.
- `mode:autofix` — applies only `safe_auto` fixes, no questions.

## What reviewers look for

> Fill in as patterns emerge. Anchor categories below mirror the
> reviewer-agent set and the project's critical rules.

### Correctness

- Boundary conditions on baselines (< 10 SCORED days → `insufficient`;
  ≥ 10 → `weak`; ≥ 20 with ≥ 70% coverage → `strong`; Z-scores
  refused < 14 days). See [`ADR-0003`](../decisions/0003-score-state-discipline.md).
- FDR correction applied before any pattern claim
  (see [`ADR-0004`](../decisions/0004-no-reliable-pattern-positive-output.md)).
- `score_state` handled as a discriminated union, never coerced to
  zero / null / missing.

### Reliability

- OAuth refresh paths go through the in-process single-flight + file
  advisory lock + atomic temp-and-rename write
  (see [`ADR-0002`](../decisions/0002-single-flight-oauth-refresh.md)).
- Rate-limit responses (429) backed off with jitter, not retried hot.

### MCP protocol safety

- Nothing on stdout in code reachable from `src/mcp/` (or any path it
  imports). Pino logs go to stderr. See
  [`ADR-0001`](../decisions/0001-mcp-stdout-purity.md).
- MCP tool registrations stay ≤ 5 lines (orchestration in
  `src/services/`).

### Tests

- No new test reaches the live WHOOP API without `VITEST_LIVE_WHOOP=1`
  guarding it. See
  [`ADR-0006`](../decisions/0006-fixture-only-tests.md).
- Every WHOOP resource added has a contract test
  (fixture → service → SQLite row → Zod re-parse).

### Tone and copy

- No banned words / emoji in review output. See
  [`ADR-0005`](../decisions/0005-banned-tone-words.md).
- "No reliable pattern detected" is the correct output when sample
  sizes are too small — not an empty string, not invented filler.

## What lands in [`../learnings.md`](../learnings.md)

If `/ce-code-review` flags the same kind of issue twice across separate
PRs, the second occurrence pins it as `LNNNN` and wires the rule into
the cheapest mechanical layer (Biome, husky, CI, or Claude Code hook).

## Cross-references

- [`contributing.md`](./contributing.md) — branch + commit + PR rules
- [`../skills.md`](../skills.md) — full `/ce-code-review` invocation
  surface
- [`../decisions/`](../decisions/) — ADRs reviewers cite
- [`../learnings.md`](../learnings.md) — recurrence log
