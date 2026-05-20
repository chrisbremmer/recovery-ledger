# Learnings — The Self-Healing Doc

This is Recovery Ledger's institutional memory for agents. **Every
recurring issue, every PR-review pattern that comes up twice, every "wait,
didn't we already hit this?" moment — capture it here.**

The rule: if you (an agent or a human) catch yourself solving the same
problem twice, the second time you must add it here so the third time it
can't happen.

## How self-healing works

When an issue, bug, or piece of PR feedback recurs:

1. **Catch it.** Reviewer or author notices: "this is the same thing as
   last week's PR / debugging session."
2. **Pin it.** Add an entry in the right category below. The entry must
   include the recurrence, the root cause, and the rule that prevents it.
3. **Wire it.** If the rule belongs in another doc
   ([`workflows/contributing.md`](./workflows/contributing.md),
   [`workflows/pr-review.md`](./workflows/pr-review.md),
   [`conventions.md`](./conventions.md), a Biome config, a husky hook, a
   CI workflow, a Claude Code hook), add it there too and link both ways.
4. **Mention it in the PR.** The PR that adds the learning gets a line in
   its agent-context section: "Adds learning #NN to prevent recurrence
   of X." That closes the loop — the next reviewer sees it and treats
   it as load-bearing.

> A learning is not "we should be more careful." A learning is a
> **specific, checkable rule** that catches the failure mode automatically
> — by lint, by test, by hook, by checklist item, by template change.

## Entry template

```markdown
### LNNNN — Short title (YYYY-MM-DD)

- **Symptom:** what the agent / reviewer / user actually saw
- **Root cause:** the real reason it happened (not the surface bug)
- **Rule:** the durable rule that now prevents it
- **Where the rule lives:** link(s) to the file(s) where the rule was
  added (lint config, doc section, test, template field, hook)
- **Triggered by:** PR # / commit / conversation date
- **Recurrences before pinning:** how many times we hit this before
  writing it down (so we know which categories drift)
- **Status:** active | absorbed-by-automation | superseded-by [LNNNN]
```

Number entries `L0001`, `L0002`, … — like ADRs, immutable. If a learning
turns out to be wrong, write a new one that supersedes it.

---

## Active learnings

### Category: Git / branching / worktrees

_(empty)_

### Category: WHOOP API integration

_(empty)_

### Category: MCP protocol (stdout purity, tool schema, prompts)

### L0001 — MCP doctor self-recursion via subprocess spawn (2026-05-12)

- **Symptom:** the `whoop_doctor` MCP tool spawned `dist/mcp.mjs` as a
  subprocess to drive the stdout-purity probe. Inside that subprocess,
  `whoop_doctor` ran again, which spawned another subprocess, which
  ran the tool again, and so on. The chain bottomed out only when the
  parent's read timer fired and the orphaned descendants were SIGTERMed
  by SIGKILL. CR-01 caught this in code review.
- **Root cause:** the probe assumed it ran from the CLI; when invoked
  from the MCP tool handler, the spawn loop had no terminator. Both
  call sites (`recovery-ledger doctor`, `whoop_doctor` tool) share the
  same `runDoctor()` orchestrator, so a flag was needed to signal
  intent.
- **Rule:** any service that spawns a subprocess to self-test must
  gate the spawn on an explicit option set by the MCP entry point.
  The env-var fallback that previously honored `RL_INSIDE_MCP=1`
  alone was removed in MR-14 — a stale env var in the user's shell
  would have silently skipped the CLI's subprocess check.
- **Where the rule lives:**
  [`src/services/doctor/checks/mcp-stdout-purity.ts`](../src/services/doctor/checks/mcp-stdout-purity.ts)
  (`opts.skipSubprocess`),
  [`src/services/doctor/index.ts`](../src/services/doctor/index.ts)
  (`RunDoctorOptions.skipSubprocessChecks`),
  [`src/mcp/tools/whoop-doctor.ts`](../src/mcp/tools/whoop-doctor.ts)
  (explicit `skipSubprocessChecks: true`).
- **Triggered by:** PR #2 review — CR-01 + MR-14.
- **Recurrences before pinning:** 1 (caught in first cross-review of
  Phase 1's doctor implementation).
- **Status:** active.

### L0004 — Case-sensitive Bearer regex misses mixed-case (2026-05-12)

- **Symptom:** `sanitize('bearer abc123…')` returned the input
  unchanged. The Authorization-header pattern carried `/gi`; the bare
  `Bearer` fallback (pattern 4) and the JSON token-key pattern
  (pattern 2) did not. Real-world upstreams (undici body excerpts,
  some load-balancer log formatters) lowercase or capitalize header
  names — a token in those shapes leaked while a casual reader
  assumed all token shapes were redacted.
- **Root cause:** the pattern set evolved by incremental addition. The
  earliest pattern (Authorization header) carried `/gi` from day one;
  later additions inherited only `/g` because they were copy-pasted
  from contexts where case had been the default.
- **Rule:** every sanitizer pattern matching a case-insensitive HTTP
  construct (Bearer, Authorization, content-type, etc.) MUST carry
  the `/i` flag. New patterns must include a positive test for the
  uppercase variant.
- **Where the rule lives:**
  [`src/mcp/sanitize.ts`](../src/mcp/sanitize.ts) (patterns 1, 2, 2a,
  2b, 2c, 4 all carry `/gi`),
  [`src/mcp/sanitize.test.ts`](../src/mcp/sanitize.test.ts) (P4 +
  P2a mixed-case positive tests, MR-25/MR-40).
- **Triggered by:** PR #2 review — MR-25.
- **Recurrences before pinning:** 1.
- **Status:** active.

### Category: Domain logic (baselines, anomalies, FDR, score_state)

_(empty)_

### Category: Tests / fixtures / MSW

### L0003 — OAuth form-body and URL-query tokens require dedicated sanitizer patterns (2026-05-12)

- **Symptom:** the sanitizer's JSON-token pattern (`"access_token":"…"`)
  redacted JSON payloads but left URL-query (`?access_token=…`) and
  form-body (`access_token=…`) shapes alone. WHOOP's OAuth refresh
  flow uses both shapes verbatim, and a connection-error message
  from native fetch / undici surfaces the request body inline.
- **Root cause:** the original Phase 1 pattern catalog covered
  `Authorization: Bearer`, JSON-keys, JWTs, and bare-Bearer — the
  four shapes documented in PITFALLS.md Pitfall 17. The OAuth wire
  shapes were absent because Phase 1 has no HTTP client yet; the
  catalog was scoped to error messages, not request bodies.
- **Rule:** extending the sanitizer pattern set MUST add a
  corresponding test fixture in
  [`sanitize.test.ts`](../src/mcp/sanitize.test.ts) that FAILS without
  the new pattern. The MR-03 / MR-11 / MR-24 expansion proved this
  by adding 14 positive tests against the unified `SECRET_KEY_NAMES`
  list; the alternation count (`PATTERNS.length >= 7`) is the
  floor pin.
- **Where the rule lives:**
  [`src/mcp/sanitize.ts`](../src/mcp/sanitize.ts) (`SECRET_KEY_NAMES`
  constant, patterns 2/2a/2b/2c),
  [`src/mcp/sanitize.test.ts`](../src/mcp/sanitize.test.ts) (D-10
  fixture block F5+F6 + the SECRET_KEY_NAMES membership test).
- **Triggered by:** PR #2 review — CR-03 + MR-03 + MR-11 + MR-24.
- **Recurrences before pinning:** 1.
- **Status:** active.

### Category: Tooling / CI / hooks

### L0002 — cwd-relative subprocess paths break `npx recovery-ledger` (2026-05-12)

- **Symptom:** the doctor's stdout-purity probe spawned
  `path.resolve('dist/mcp.mjs')` — fine from the repo root, but
  invoking `npx recovery-ledger doctor` from any other directory
  produced a misleading "ENOENT: no such file or directory" on
  whichever path `process.cwd()` happened to be.
- **Root cause:** subprocess + asset paths defaulted to
  cwd-relative because the prototype was built from the repo root.
  The packaged binary runs from arbitrary user directories.
- **Rule:** subprocess paths AND test fixture paths in installed
  CLI code MUST resolve via `import.meta.url` +
  `path.dirname(fileURLToPath(import.meta.url))`, never
  `process.cwd()`. The same rule applies to integration tests that
  spawn the built binary — `cd tests && vitest run integration/...`
  must work.
- **Where the rule lives:**
  [`src/services/doctor/checks/mcp-stdout-purity.ts`](../src/services/doctor/checks/mcp-stdout-purity.ts)
  (`HERE` constant via `import.meta.url`),
  [`tests/integration/mcp-stdout-purity.test.ts`](../tests/integration/mcp-stdout-purity.test.ts)
  (`HERE` + `REPO_ROOT` constants, MR-33).
- **Triggered by:** PR #2 review — CR-02 + MR-33.
- **Recurrences before pinning:** 1.
- **Status:** active.

### L0005 — Comment phrasing must not collide with grep gates (2026-05-20)

- **Symptom:** a doc-comment that explained why a grep gate exists used
  the literal grep target as part of its prose (e.g., `// ADR-0001 (MCP
  stdout purity): no console.*; no process.stdout.write.` in the same
  file where Gate B forbids `console.*` and Gate C forbids
  `process.stdout.write`). The grep gates are word-boundary literal
  checks with no comment-awareness, so the well-intentioned comment
  tripped CI at commit time across Phases 1, 2, 3, and 4.
- **Root cause:** the grep gates are intentionally not comment-aware —
  comment-stripping would silently exempt real violations hidden in
  block-comment strings. The cost is that comments referencing the
  enforced literal must use semantic phrasing instead.
- **Rule:** when writing a doc-comment that REFERENCES a grep-gate
  target, never inline the literal grep target. Use semantic phrasing
  per the substitution table:

  | Gate target | Semantic phrasing |
  |---|---|
  | `console.*` (Gate B) | "direct stdout writes" / "the console API" |
  | `process.stdout.write` (Gate C) | "stdout output" / "the write API" |
  | `server.registerTool(` (Gate D) | "the tool-registration boundary" / "the wrapper" |
  | `server.registerResource(` (Gate I) | "the resource-registration wrapper" |
  | `server.registerPrompt(` (Gate J) | "the prompt-registration wrapper" |
  | `drizzle-orm` (Gate G) | "the ORM" |
  | `fetch(` (Gate F) | "HTTP requests" / "the network boundary" |
  | OAuth-token URLs outside `token-store.ts` (Gate E) | "the refresh endpoint" |
  | `tools.length === 1` (Gate H) | "the legacy single-tool attestation" |

  This convention preserves explainability in comments without
  breaking CI.
- **Where the rule lives:**
  [`agent_docs/conventions.md`](./conventions.md) §Comments
  (added Phase 4 close); this learning is the canonical reference
  for why the rule exists.
- **Triggered by:** Plan 04-12 phase-close review — 5th-time-in-a-row
  occurrence across Phases 1+2+3+4 prompted codification per Phase 4
  CONTEXT.md §deferred / §learnings.md entry recommendation.
- **Recurrences before pinning:** 5 (one per phase: Plans 01-04, 02-08,
  03-09, 03-11, and the running observation captured in Phase 4
  CONTEXT before pinning here).
- **Status:** active.

### Category: Documentation / process

_(empty)_

---

## What does NOT belong here

- **One-off bug fixes.** If it can't recur, it doesn't need a learning.
  The commit message is enough.
- **Style preferences without a failure mode.** "I prefer named exports"
  is in [`conventions.md`](./conventions.md), not here.
- **Architectural decisions.** Those are ADRs, in
  [`decisions/`](./decisions/). A learning may *trigger* an ADR, but the
  ADR is where the decision lives.
- **Stack picks.** Those live in
  [`.planning/research/STACK.md`](../.planning/research/STACK.md).

## Audit cadence

Every 30–90 days, an agent or human should:

1. Re-read all entries.
2. Verify each `Where the rule lives` link still resolves and the rule
   is still present in the linked file.
3. Mark any learning that's been fully absorbed into automation
   (Biome rule, husky hook, CI gate, Claude Code hook) with
   `**Status:** absorbed-by-automation` so future readers know it's
   enforced without needing to remember it.

## Cross-references

- [`workflows/contributing.md`](./workflows/contributing.md) — where many
  rules end up living
- [`workflows/pr-review.md`](./workflows/pr-review.md) — reviewers scan
  this file before reviewing
- [`decisions/`](./decisions/) — ADRs (durable decisions, not learnings)
