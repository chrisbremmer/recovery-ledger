# Debugging

> Status: stub. Fills in once Phase 1 produces code paths that actually
> need investigation.

## Entry point

Use `/gsd-debug` to start an investigation with persistent state across
context resets. The skill maintains a debug session, lets you record
hypotheses + outcomes, and resumes cleanly if the conversation runs out
of context.

## Categories likely to need patterns first

- **OAuth refresh failures.** Single-flight mutex contention, token
  family revocation after a botched refresh, file-lock timeouts. See
  [`../decisions/0002-single-flight-oauth-refresh.md`](../decisions/0002-single-flight-oauth-refresh.md).
- **MCP stdio corruption.** Client receives malformed JSON-RPC — almost
  always a stray `console.*` somewhere reachable from `src/mcp/`. See
  [`../decisions/0001-mcp-stdout-purity.md`](../decisions/0001-mcp-stdout-purity.md).
- **Score-state regressions.** A baseline flips from `strong` to
  `insufficient` after a sync — usually a `PENDING_SCORE` row got
  treated as scored somewhere. See
  [`../decisions/0003-score-state-discipline.md`](../decisions/0003-score-state-discipline.md).
- **WHOOP rate-limit floods.** 429s in a tight loop suggest a missing
  backoff or a paging bug.

## When debugging produces a learning

If an investigation reveals a pattern likely to recur, capture it in
[`../learnings.md`](../learnings.md) as `LNNNN` and wire the rule into
lint / hook / test / CI so the third occurrence can't happen.

## Cross-references

- [`contributing.md`](./contributing.md) — how the fix lands (worktree
  + PR)
- [`pr-review.md`](./pr-review.md) — what reviewers will check
- [`../learnings.md`](../learnings.md) — durable rule capture
