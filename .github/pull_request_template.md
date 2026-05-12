<!--
Recovery Ledger PR template.

Both sections below are required. Section 1 is the human-facing summary.
Section 2 is the context budget for reviewer agents (/ce-code-review).
Skipping Section 2 degrades the review — reviewers re-derive the same
context from scratch every time, often badly.

The PR title should be a conventional-commit subject:
  feat: implement WHOOP sync service
  fix: refresh-token race in long-running MCP session
  docs: clarify score-state handling in baselines
  chore: bump drizzle-kit to 0.31
-->

## Section 1 — Summary

**What this PR does** (one or two sentences):

<!-- Plain-English description. The "why" matters more than the "what" — the diff already shows the what. -->

**Phase / plan ref:**

<!--
Link the in-flight plan this PR executes, e.g.:
  .planning/phases/01-foundation/01-02-PLAN.md

If the PR is out-of-band tooling/infrastructure (no phase), say so.
-->

**Test plan**

- [ ] `npm run lint` passes
- [ ] `npm run test` passes (fixture-only, no live WHOOP)
- [ ] If this touches WHOOP HTTP code: a new contract test exercises the path
- [ ] If this touches MCP code: `npx @modelcontextprotocol/inspector node dist/mcp.js` connects cleanly
- [ ] Manual verification (describe):

<!--
For UI-less projects "manual verification" is usually: I ran the relevant
CLI command / MCP tool against a fixture and inspected the output. Spell
out what you ran and what you saw.
-->

---

## Section 2 — For Agents

> Read this before running `/ce-code-review` on the PR. The reviewer
> team uses this section as its context budget.

**Critical rules touched** *(tick any the diff brushes against — full text in [AGENTS.md § Critical Rules](../AGENTS.md#critical-rules))*

- [ ] [ADR-0001](../agent_docs/decisions/0001-mcp-stdout-purity.md)
- [ ] [ADR-0002](../agent_docs/decisions/0002-single-flight-oauth-refresh.md)
- [ ] [ADR-0003](../agent_docs/decisions/0003-score-state-discipline.md)
- [ ] [ADR-0004](../agent_docs/decisions/0004-no-reliable-pattern-positive-output.md)
- [ ] [ADR-0005](../agent_docs/decisions/0005-banned-tone-words.md)
- [ ] [ADR-0006](../agent_docs/decisions/0006-fixture-only-tests.md)
- [ ] [ADR-0007](../agent_docs/decisions/0007-whoop-read-only.md)
- [ ] None — purely tooling, planning, or unrelated docs

**What was attempted**

<!--
The implementation path the agent took, in 2–5 bullet points. Reviewers
use this to judge whether the approach matches the plan.
-->

**What was ruled out**

<!--
Alternatives considered and rejected. This is the highest-leverage field
for review quality — without it, reviewers re-propose options the author
already discarded for reasons not visible in the diff.

Example:
  - Considered putting the refresh logic in the HTTP client retry path;
    rejected because it would skip the cross-process file lock.
  - Considered a Drizzle migration to widen the column; rejected because
    the WHOOP schema is the upstream source of truth and we adapt
    in Zod, not in SQL.
-->

**What reviewers should watch for**

<!--
Specific failure modes the author is uncertain about. Direct the
reviewer team at the risky bits. Reviewers are good at catching things
you point them at, less reliable at uncovering blind spots.

Example:
  - The retry-after parsing assumes seconds; WHOOP also emits HTTP-date
    format under rare conditions — please verify the branch.
  - This is the first place a domain function touches the file system;
    double-check the dependency direction (domain → infrastructure is
    backwards from the hexagonal layout).
-->

**Learnings referenced**

<!--
If this PR adds an LNNNN entry to agent_docs/learnings.md, link it here.
Format: "Adds learning L0001 to prevent recurrence of …"
-->

**Skip review?**

- [ ] This PR is trivial enough that `/ce-code-review` is overkill (typos, doc-only updates, dependency version bumps with no behavioural change). Author still must self-review.
