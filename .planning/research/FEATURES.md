# Feature Research

**Domain:** Local-first personal recovery analytics (WHOOP API v2 + MCP)
**Researched:** 2026-05-11
**Confidence:** HIGH

> The PROJECT.md "Active" list already enumerates v1. This research does **not** propose new
> features — it categorizes the existing list, fills in "what good looks like" detail per
> feature, locates each item on the v1 / P1 / P2 / out-of-scope axis, and surfaces dependencies
> the roadmapper needs to phase the work.

---

## Feature Landscape

### Table Stakes (v1 loop fails without these)

These are the features in PROJECT.md's Active list that constitute the minimum closed loop of
**sync → review → decision → outcome**. Every line below maps 1:1 to a PROJECT.md Active
bullet. Missing any one of them breaks the daily/weekly review ritual and the project's Core
Value ("Turn WHOOP data into a daily and weekly review loop that ends in 3 concrete decisions
and a record of whether they helped").

| Feature | Why Table Stakes | Complexity | Category | Notes |
|---------|------------------|------------|----------|-------|
| **Local SQLite cache** for cycles, recovery, sleep, workouts, profile, body measurements | Local-first principle; no review/baseline math works without persistent data; every other feature reads from it | MEDIUM | Sync | WAL mode via `better-sqlite3`; Drizzle schema with one table per WHOOP resource + a `sync_runs` audit table. Idempotent upserts keyed on WHOOP IDs. |
| **BYO WHOOP OAuth** with concurrency-safe token refresh | Without working auth, nothing else runs. WHOOP API v2 requires OAuth 2.0 (six `read:*` scopes). Concurrency safety prevents the classic "two MCP tools call refresh simultaneously, one wins, the other 401s" race. | MEDIUM | Sync | Single-flight refresh (mutex/promise-coalescing); tokens at-rest in OS keychain or `~/.recovery-ledger/credentials.json` with 0600 perms. Setup wizard generates the dev app instructions. |
| **`recovery-ledger sync --days N`** with partial-failure reporting + rate-limit backoff | The "fill the cache" command. v2 returns 429s and webhooks were removed; clients must poll. Partial failure (e.g., recovery for day 3 of 30 fails) must complete the run and report what's missing, not abort the whole sync. | MEDIUM | Sync | Resource-by-resource pagination via `nextToken`. 25-record page max per WHOOP docs. Exponential backoff on 429. Output: per-resource counts + a "gaps" list. |
| **`recovery-ledger review daily`** — today vs trailing-30d baseline + anomalies + top-3 actions | The morning ritual. The whole project exists for this command. Must run in <2 min after sync per Constraint. | LARGE | Review | Outputs: today's recovery/sleep/strain, deltas vs personal 30d baseline (WHOOP itself uses a weighted-28d baseline — match that pattern), flagged anomalies (>1σ from baseline AND minimum sample size met), three concrete action suggestions, confidence label per insight ("strong pattern" / "weak signal" / "insufficient data"). |
| **`recovery-ledger review weekly`** — worst-recovery days + preceding patterns OR "no reliable pattern detected" | The retrospective half of the loop. Must explicitly refuse to invent patterns when n is too small — this is the project's transparent-uncertainty principle made operational. | LARGE | Review | Rank the week's days by recovery, surface the worst 1–3, look back 24–72h for sleep debt / late workouts / late caffeine signals (where data exists), and **emit "no reliable pattern detected" when sample size or effect size is below threshold**. This is a differentiator disguised as a table-stake. |
| **Decision ledger: `decision add` / `decision review`** — intended action + rationale + expected effect + follow-up date | The loop has no closing edge without it. This is where Recovery Ledger stops being a viewer and becomes a learning tool. The Farnam Street decision-journal pattern (date / decision / expected outcome / confidence / factors / alternatives / follow-up) is the standard template — adopt it minus the bits that don't fit. | MEDIUM | Decision Ledger | Schema: `id, created_at, decision_text, rationale, expected_effect, confidence, follow_up_date, outcome_text, outcome_recorded_at, linked_cycle_ids`. `decision review` lists open decisions whose `follow_up_date <= today` and prompts for outcome. No streaks, no scores, no gamification (see anti-features). |
| **`recovery-ledger doctor`** — auth, token, DB, sync, MCP, data-quality checks | The "setup feels fragile" killer. `npm doctor` / `react-native doctor` pattern: run a battery of checks, print pass/fail with remediation hints, exit nonzero on hard failures. Without it, every setup hiccup becomes a support ticket Chris files to himself. | SMALL | Diagnostics | Checks: OAuth credentials present & valid, token refreshable, DB writable + schema current, last sync timestamp, MCP stdio handshake works, data-quality flags (e.g., "3 of last 14 days missing recovery"). |
| **MCP stdio server** exposing `whoop_sync`, `whoop_daily_review`, `whoop_weekly_review`, `whoop_query_cache`, `whoop_add_decision`, `whoop_review_decisions`, `whoop_api_gap`, `whoop_doctor` | PROJECT.md's Context says "MCP-first interaction model. Claude Code is the expected primary client; the CLI is a power-user backup." Without the MCP surface, the product's primary UX doesn't exist. | LARGE | MCP Surface | Every tool returns **structured JSON content block + a TextContent fallback** for clients that can't parse structured output (this is the MCP spec's documented backward-compat pattern). Zod schemas drive both input validation and output shape. |
| **MCP resources**: `whoop://summary/today`, `whoop://summary/week`, `whoop://baseline/30d`, `whoop://data-quality`, `whoop://api-gaps`, `whoop://decisions/open` | Resources let the LLM pull context without spending a tool call. Critical for the "Claude, what should I do today?" UX — Claude reads `whoop://summary/today` + `whoop://decisions/open` in one shot. | MEDIUM | MCP Surface | Each resource is a read-only snapshot rendered as JSON. Cache invalidation: regenerate on demand from SQLite (cheap; no precomputation cron needed in v1). |
| **MCP prompts**: `whoop_daily_decision_brief`, `whoop_weekly_recovery_investigation`, `whoop_experiment_designer`, `whoop_deload_or_train` | Prompts are the "structured rituals" — they encode the project's opinionated review questions so Chris doesn't have to remember them. This is what turns the MCP surface from a data feed into a coaching loop. | SMALL | MCP Surface | Each prompt accepts a small typed argument set (e.g., `date` for the daily brief), composes a multi-part message referencing the right resources, and ends with a directive ("End with three concrete actions"). |
| **Structured JSON + compact text fallback** on every tool | Per MCP spec: structured content tools "should also return serialized JSON in a TextContent block" for older/weaker clients. Without this, Cursor or any non-Claude client breaks. PROJECT.md Key Decisions explicitly commits to this. | SMALL | MCP Surface | One shared response builder utility; never let a tool return only structured content or only text. |
| **Fixture-based contract tests** per WHOOP resource (no live API in default suite) | Without these, the WHOOP API is the silent partner that breaks the build on a random Tuesday. PROJECT.md Constraint: tests run in <60s, no live calls in default suite. | MEDIUM | Diagnostics | One canonical fixture per resource shape. A separate, opt-in `test:live` task hits the real API monthly. Zod schemas double as the contract surface — if WHOOP changes a field, validation fails loudly. |
| **API-gap documentation + `whoop_api_gap` tool/resource** for unsupported metrics (Healthspan, ECG, BP, journal, continuous HR) | This is honesty as a feature. PROJECT.md Context: "must be surfaced as 'unavailable via API' — never silently dropped." It's also a UX shield: when Claude is asked "what does my ECG show?", the system has a clean, sourced answer instead of hallucinating. | SMALL | MCP Surface / Docs | One markdown file enumerating each unsupported metric, the reason (not in v2 API), and the link to WHOOP's public docs. The `whoop_api_gap` tool surfaces the same data programmatically. |
| **Install guide** for Claude Code + Claude Desktop (+ Cursor compat note) | PROJECT.md target: "Fresh clone → first successful sync in under 20 minutes." If install is fragile, the loop never starts. | SMALL | Documentation/Setup | One README section per client. Screenshots of the MCP config block. Troubleshooting checklist that maps to `doctor` exit codes. |

---

### Differentiators (why this exists vs. opening the WHOOP app or hand-rolling a notebook)

Research finding: the existing WHOOP MCP servers on GitHub — [JedPattersonn/whoop-mcp](https://github.com/JedPattersonn/whoop-mcp), [nissand/whoop-mcp-server-claude](https://github.com/nissand/whoop-mcp-server-claude), [shashankswe2020-ux/whoop-mcp](https://github.com/shashankswe2020-ux/whoop-mcp) — are uniformly **thin REST wrappers**. None offers a daily review, none has baselines, none has a decision ledger, none has API-gap honesty, none has structured weekly retrospection. The differentiation surface is wide open.

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| **Decision ledger with outcome tracking** | This is the headline differentiator. WHOOP shows you a number; a notebook shows you a number with a label. Recovery Ledger shows you a number, asks "what will you do about it?", and 7 days later asks "did it help?". No other WHOOP tool surveyed does this. | MEDIUM | Adopts the Farnam Street decision-journal structure (decision / rationale / expected effect / follow-up). Outcome is free-text plus a coarse "helped / neutral / hurt / inconclusive" tag. |
| **"No reliable pattern detected" as a first-class output** | Most personal-analytics tools invent narratives from n=3. Refusing to do so is countercultural and trustworthy. It's also the project's stated tone ("direct, non-hype"). | SMALL (logic) / MEDIUM (calibration) | Threshold rules per insight type: minimum sample size, minimum effect size, minimum baseline stability. Each insight carries a confidence enum. The weekly review will frequently emit this — and that is the point. |
| **MCP-first UX over CLI-first** | Claude Code as the primary client means Chris talks to his recovery data in natural language and the tool returns structured rituals (the four prompts). The CLI is the power-user escape hatch, not the centerpiece. None of the surveyed WHOOP MCP servers ship prompts at all. | MEDIUM | Already covered in table stakes; called out here because the *combination* — tools + resources + prompts — is the differentiator, not any single piece. |
| **Personal baselines with WHOOP-style weighted recency** | WHOOP itself uses a weighted-28-day average with greater weight on recent days. Matching this means insights are interpretable next to the WHOOP app instead of contradicting it. | MEDIUM | Trailing 30d with exponential decay (configurable). Recompute on every sync; cache in a `baselines` table. |
| **API-gap honesty surface** | When Claude asks about ECG or journal data, the system says "WHOOP doesn't expose this via the v2 API" instead of either failing silently or hallucinating. This converts a limitation into a trust signal. | SMALL | Already listed in table stakes — repeated here because its differentiating value is high. |
| **Structured rituals as MCP prompts** | The four prompts (`daily_decision_brief`, `weekly_recovery_investigation`, `experiment_designer`, `deload_or_train`) bake the GTD-style weekly review pattern into the tool. Users don't need to remember "what should I ask?" — the prompts ask for them. | SMALL | Each prompt is ~20–50 lines of templated message construction. |
| **Doctor command with remediation hints** | The npm/RN doctor pattern is unusually rare in personal tools. Combined with the <20-min setup target, this is what makes the tool actually start vs. dying during install. | SMALL | Already listed in table stakes. Differentiating because the comparable tools surveyed all leave OAuth troubleshooting as an exercise to the user. |
| **Read-only + BYO OAuth + no consumer-endpoint scraping** | A negative differentiator: deliberately less convenient than scraping the consumer app, but durable against WHOOP ToS changes, rate-limit clamps, and account bans. PROJECT.md Key Decision codifies this. | SMALL (it's a constraint, not a build) | Mention in README under "Why so manual?" |

---

### Anti-Features (deliberately NOT building)

Sourced 1:1 from PROJECT.md's Out of Scope list and the Hard Scope Guardrail. Preserved here with rationale so the roadmapper can reject scope-creep requests with a single link.

| Anti-Feature | Why Tempting | Why We Refuse | What To Do Instead |
|--------------|--------------|---------------|-------------------|
| **Web dashboard** | Charts are sexy; "make it pretty" is the easiest unfocused work. | The daily review loop must be sticky first. Dashboard before habit = pretty zombie. Guardrail-gated. | Ship CLI + MCP. Re-evaluate when guardrail preconditions hit (12 daily reviews / 3 weekly reviews / 8 decisions / stable tests / non-fragile setup). |
| **BLE companion (live HR / strain)** | Real-time is shiny; "I want it now" is a natural ask. | WHOOP API is poll-based; live data needs a second data path and a UI. Doubles surface area before the core loop works. | Use WHOOP app for live data. Recovery Ledger is a review tool, not a live dashboard. |
| **Hosted SaaS / shared OAuth relay** | Removes the BYO friction; obvious distribution win. | Multi-tenant secrets management, WHOOP ToS exposure, hosting cost, abuse vectors. PROJECT.md commits to local-first. | Keep BYO. Improve the install wizard until BYO setup is <20 min. |
| **Consumer / private WHOOP endpoint scraping** | Unlocks journal, ECG, BP, continuous HR — the data the official API hides. | ToS violation; WHOOP can revoke; account-risk for the user; brittle (private endpoints change without notice). | `whoop_api_gap` surfaces honestly that this data isn't available. |
| **Healthspan / ECG / BP / hormonal insights / journal / continuous HR** | Users will ask for these because they see them in the app. | Not exposed by WHOOP API v2 (confirmed against the developer docs). Building requires scraping (see above) or fabrication. | Surface through `whoop_api_gap` with a one-line explanation per metric. |
| **Mobile app** | "I'd use this on my phone." | Doubles platform surface; PROJECT.md commits to CLI/MCP only. | Claude mobile + MCP via desktop bridge is the path if mobile becomes important. |
| **Multi-user / shared team views** | Coaching, friends, "send my recovery to my trainer." | Auth, sharing model, privacy story, and the loop hasn't been proven for one user yet. | Stay single-user. Export-to-markdown is the v2+ escape hatch if asked. |
| **Medical advice / diagnosis** | LLMs sound confident; users will infer diagnosis from any output. | Liability + accuracy + regulatory. PROJECT.md Out of Scope. | All prompts and tool descriptions say "decision support, not medical advice." Add a one-liner disclaimer in the daily review output. |
| **Cross-source integrations (Apple Health, calendar, nutrition)** | "If you had my calendar you could correlate sleep with travel." | Each integration is its own OAuth + schema + sync cadence. Guardrail-gated. | Defer. Re-evaluate post-guardrail. |
| **Write operations to WHOOP** | "Auto-log my workouts." | WHOOP API is treated as read-only by Recovery Ledger; reduces risk surface and ToS exposure. | Out of scope permanently in v1. |
| **Streaks, scores, gamification, push notifications** | Habit-tracker conventions. | Research is unambiguous: streaks turn the tool into the goal and create shame-cycles that drive abandonment ([Medium: Why Most Habit Trackers Fail](https://medium.com/the-intentional-life/why-most-habit-trackers-fail-and-what-actually-works-4481602de878), [Sage: QS scope creep](https://sk.sagepub.com/hnbk/edvol/the-sage-handbook-of-data-and-society/chpt/19-quantified-self-beyond-situated-data-practices)). PROJECT.md's tone principle ("sleep-debt signal, not a moral failure") rules this out. | The decision ledger's outcome tracking is the substitute reward loop. |
| **Auto-actions / scheduled syncs / cron in v1** | "Just sync overnight." | Cron + token refresh + error reporting is a bigger ask than it looks, and Chris running `sync` manually is the forcing function that triggers the daily review. Make sync trivial, not invisible. | Document a one-line launchd/cron recipe in the install guide for power users; don't ship it. |
| **Telemetry / usage analytics** | "I'd like to know what I use." | Local-first + privacy commitment. PROJECT.md Context: "No telemetry, no sync to external servers." | If retention insight is needed, query the local SQLite (e.g., a `usage` table) — it stays on the machine. |

---

## Feature Dependencies

```
[OAuth + token refresh]
        │
        ▼
[SQLite cache + schema]
        │
        ├──> [recovery-ledger sync]
        │            │
        │            ▼
        │     [baselines (trailing 30d weighted)]
        │            │
        │            ├──> [recovery-ledger review daily]
        │            │            │
        │            │            ▼
        │            │     [whoop_daily_review tool + whoop://summary/today resource
        │            │      + whoop_daily_decision_brief prompt]
        │            │
        │            └──> [recovery-ledger review weekly]
        │                         │
        │                         ▼
        │                  [whoop_weekly_review tool + whoop://summary/week resource
        │                   + whoop_weekly_recovery_investigation prompt]
        │
        └──> [decision ledger schema]
                     │
                     ├──> [decision add / decision review CLI]
                     └──> [whoop_add_decision + whoop_review_decisions tools
                          + whoop://decisions/open resource]

[Fixture contract tests] ──supports──> [everything above]
[whoop_api_gap]          ──independent──> [shippable in parallel]
[recovery-ledger doctor] ──depends on──> [OAuth + DB + MCP all exist]
[Install guide]          ──depends on──> [doctor command exists]
```

### Dependency Notes

- **OAuth + token refresh** must land before the SQLite cache work is observable end-to-end, because every sync test needs a token in hand. Fixture tests can unblock schema work in parallel, but real-API smoke tests block on OAuth.
- **SQLite cache + schema** blocks every downstream feature. Get the Drizzle schema right early; migrations are a tax later.
- **`sync` command** must land before `review daily`/`review weekly` can be tested with real data shapes. Review logic can be prototyped against fixtures earlier.
- **Baselines** are required by daily review's "vs trailing-30d" deltas and by weekly review's anomaly detection. They are not required by `sync` itself.
- **Daily review must work before the daily MCP tool/resource/prompt set is meaningful** — the prompt's value comes from the resource's value comes from the tool's value comes from the underlying review logic.
- **Decision ledger schema is independent of sync** — it can be built in parallel with sync work. The dependency is at the MCP-tool level (`whoop_add_decision` depends on both the schema existing and the MCP stdio server existing).
- **`doctor`** is the integration capstone: it can only be useful once OAuth, DB, sync, and MCP all exist in at least a stub form. Build it after all four have first-pass implementations.
- **Install guide** depends on `doctor` because the troubleshooting section maps doctor's exit codes / failure messages to remediations.
- **`whoop_api_gap`** has no dependencies. Ship it whenever — it's the easiest "useful thing first" feature and the friendliest demo of API-gap honesty.
- **Fixture contract tests** can and should land alongside each resource schema, not in a single batch at the end. Treat them as a Definition-of-Done item per resource.

---

## MVP Definition

### Launch With (v1 — closed loop, in PROJECT.md priority order)

Every item below is in PROJECT.md's Active list. v1 = all of them.

- [ ] **OAuth + token refresh** — without auth, no sync, no anything
- [ ] **SQLite cache + Drizzle schema** for cycles, recovery, sleep, workouts, profile, body measurements — the data substrate
- [ ] **`recovery-ledger sync --days N`** — populates the cache
- [ ] **Trailing-30d weighted baselines** — required for both reviews
- [ ] **`recovery-ledger review daily`** — the morning ritual
- [ ] **`recovery-ledger review weekly`** — the retrospective; emits "no reliable pattern detected" honestly
- [ ] **Decision ledger** (`decision add` / `decision review`) — closes the loop
- [ ] **MCP stdio server** with 8 tools (`whoop_sync`, `whoop_daily_review`, `whoop_weekly_review`, `whoop_query_cache`, `whoop_add_decision`, `whoop_review_decisions`, `whoop_api_gap`, `whoop_doctor`)
- [ ] **MCP resources** (6) — `whoop://summary/today`, `whoop://summary/week`, `whoop://baseline/30d`, `whoop://data-quality`, `whoop://api-gaps`, `whoop://decisions/open`
- [ ] **MCP prompts** (4) — `whoop_daily_decision_brief`, `whoop_weekly_recovery_investigation`, `whoop_experiment_designer`, `whoop_deload_or_train`
- [ ] **Structured JSON + text fallback** on every tool — non-Claude client compatibility
- [ ] **Fixture contract tests** per resource — <60s suite, no live API
- [ ] **`whoop_api_gap`** + API-gap documentation — honesty surface
- [ ] **`recovery-ledger doctor`** — diagnostics + remediation
- [ ] **Install guide** — Claude Code + Claude Desktop + Cursor compat note

### Add After Validation (P1 — once the guardrail preconditions clear)

These are the items PROJECT.md lists in Out of Scope **behind the guardrail** (12 daily reviews / 3 weekly reviews / 8 decisions / stable tests / non-fragile setup). They are deliberately not v2-numbered yet — they unlock when usage clears the gate, not on a calendar.

- [ ] **Web dashboard (read-only)** — *trigger:* guardrail cleared + a concrete question Chris can't answer from CLI/MCP output alone
- [ ] **Cross-source integration: calendar (read-only)** — *trigger:* recurring weekly-review finding of "travel/late meetings correlated with bad recovery" that the LLM can't currently quantify
- [ ] **Habit retention metrics** (3 weekdays/week, 2 decisions/week, etc., per PROJECT.md Key Decision #2) — *trigger:* v1 stable; track to inform whether the loop is sticky

### Future Consideration (P2 — explicitly Out of Scope until further notice)

These remain Out of Scope under the Hard Scope Guardrail and should be **refused, not roadmapped**, in v1 reviews:

- BLE companion (live HR)
- Hosted SaaS / shared OAuth relay
- Consumer-endpoint scraping (forever, not just deferred)
- Apple Health / nutrition / additional cross-source integrations
- Healthspan / ECG / BP / journal / continuous HR / hormonal insights (forever — they're not in the API)
- Mobile app
- Multi-user / coaching / team views
- Medical advice / diagnosis (forever)
- Write operations to WHOOP (forever)

---

## Feature Prioritization Matrix

| Feature | User Value | Implementation Cost | Priority |
|---------|------------|---------------------|----------|
| OAuth + token refresh | HIGH | MEDIUM | P1 |
| SQLite cache + schema | HIGH | MEDIUM | P1 |
| `sync --days N` | HIGH | MEDIUM | P1 |
| Baselines (weighted 30d) | HIGH | MEDIUM | P1 |
| `review daily` | HIGH | HIGH | P1 |
| `review weekly` | HIGH | HIGH | P1 |
| Decision ledger | HIGH | MEDIUM | P1 |
| MCP stdio server (8 tools) | HIGH | HIGH | P1 |
| MCP resources (6) | HIGH | MEDIUM | P1 |
| MCP prompts (4) | MEDIUM | LOW | P1 |
| Structured JSON + text fallback | MEDIUM | LOW | P1 |
| Fixture contract tests | HIGH (durability) | MEDIUM | P1 |
| `whoop_api_gap` + docs | MEDIUM | LOW | P1 |
| `doctor` | HIGH (retention) | LOW | P1 |
| Install guide | HIGH (adoption) | LOW | P1 |
| Web dashboard | MEDIUM | HIGH | P2 (gated) |
| Calendar integration | MEDIUM | MEDIUM | P2 (gated) |
| Habit retention metrics | LOW (meta) | LOW | P2 |
| Everything else in Out of Scope | varies | n/a | P3 / never |

**Priority key:**
- P1 — In v1. All required for the closed loop.
- P2 — After v1 *and* after the Hard Scope Guardrail preconditions are met.
- P3 / never — Out of scope per PROJECT.md, including permanent exclusions (medical advice, scraping, writes).

---

## Competitor Feature Analysis

Surveyed three representative WHOOP MCP servers on GitHub. Pattern is consistent: thin REST wrappers, no analytical layer.

| Feature | JedPattersonn/whoop-mcp | nissand/whoop-mcp-server-claude | shashankswe2020-ux/whoop-mcp | Recovery Ledger |
|---------|--------------------------|----------------------------------|-------------------------------|------------------|
| OAuth | Yes | Yes (full flow tools) | Yes (browser-based) | Yes (BYO + concurrency-safe refresh) |
| Local cache | No (live API per call) | No | No | **Yes — SQLite, local-first** |
| Daily review | No (raw overview only) | No | No | **Yes — vs 30d baseline + 3 actions** |
| Weekly review | No | No | No | **Yes — with "no pattern" honesty** |
| Decision ledger | No | No | No | **Yes — with outcome tracking** |
| Baselines | No | No | No | **Yes — weighted 30d** |
| API-gap honesty | No | No | No | **Yes — `whoop_api_gap` tool + resource** |
| MCP resources | No | No | No | **Yes — 6 resources** |
| MCP prompts | No | No | No | **Yes — 4 structured prompts** |
| Doctor / diagnostics | No | No | No | **Yes** |
| Tools count | 5 | 18+ raw endpoints | 6 raw endpoints | 8 (composed, not raw) |
| Surface philosophy | API mirror | API mirror | API mirror | **Ritual layer over cached data** |

The competitive observation: every other WHOOP MCP server lets the LLM call the WHOOP API. Recovery Ledger lets the LLM **read the user's recovery story**. That gap — composed insights vs. raw endpoints — is the entire moat.

---

## Open Questions / Likely Feature Requests Within 4 Weeks

These are features I'd expect a user of a tool like this to ask for within a month. **Flagged, not added to v1.** Each one is a candidate for the post-guardrail P1 list, or an explicit decline.

- **Export to markdown / Day One / Obsidian** — likely ask within 2 weeks (users will want decisions + weekly summaries in their PKM). Cheap to add (read SQLite → format). Candidate for early P1-after-guardrail.
- **Configurable baseline window** (e.g., 14d vs 30d vs 60d) — likely ask once Chris notices the 30d window is wrong for travel weeks. Cheap; defer until asked.
- **Per-decision tags / categories** — likely ask after ~10 decisions exist ("show me all my caffeine decisions"). Cheap. Defer until the schema friction is real.
- **Comparison mode: "this week vs last week"** — likely ask once weekly reviews start surfacing patterns. Medium cost. Defer.
- **Sleep debt tracking specifically** — likely ask because it's the most actionable WHOOP-derived metric. v1's daily review will surface it implicitly via the sleep delta, but a named "sleep debt" output may be wanted. Medium cost. Defer.
- **An "experiment" object** distinct from a decision (e.g., "for 2 weeks, no caffeine after 2pm") — likely ask once Chris notices decisions are often actually multi-day experiments. The `whoop_experiment_designer` prompt partially covers this but doesn't persist. Medium cost. Defer; revisit when the friction surfaces.
- **Configurable confidence thresholds** for "no pattern detected" — likely ask if Chris feels the system is either too pessimistic or too confident. Small cost. Defer.
- **Recurring decision review reminders** (cron / launchd) — likely ask within 4 weeks if Chris forgets follow-up dates. PROJECT.md and this doc both push back on auto-actions in v1; revisit only if friction is observed.
- **Per-day notes / context capture** — likely ask because users will want to log "slept badly because storm" type context that explains anomalies. This blurs into the "journal" anti-feature; tread carefully. Defer with intent.

None of these are in v1. The roadmapper should treat this list as the **first place to look** when post-v1 priorities are debated, not as latent scope for the current milestone.

---

## Sources

- [PROJECT.md (Active + Out of Scope + Context + Constraints)](/Users/chris.bremmer/recovery-ledger/.planning/PROJECT.md) — source of truth for the feature list and guardrail
- [WHOOP Developer Platform — API v2 docs](https://developer.whoop.com/api/) — endpoints, scopes, pagination, rate limits
- [WHOOP v1→v2 Migration Guide](https://developer.whoop.com/docs/developing/v1-v2-migration/) — webhooks removed; polling required
- [WHOOP — Health Monitor & 28-day weighted baseline](https://support.whoop.com/s/article/Heart-Rate-Variability-HRV-Insights-WHOOP-Metrics) — confirms baseline window pattern
- [JedPattersonn/whoop-mcp](https://github.com/JedPattersonn/whoop-mcp) — competitor: thin API wrapper, 5 tools, no review layer
- [nissand/whoop-mcp-server-claude](https://github.com/nissand/whoop-mcp-server-claude) — competitor: 18+ raw endpoints, no caching, no review layer
- [shashankswe2020-ux/whoop-mcp](https://github.com/shashankswe2020-ux/whoop-mcp) — competitor: 6 raw endpoints, OAuth-only
- [MCP Specification — Tools](https://modelcontextprotocol.io/specification/draft/server/tools) — structured content + text fallback pattern
- [MCP Best Practices](https://modelcontextprotocol.info/docs/best-practices/) — one-clear-purpose-per-server, graceful degradation
- [Farnam Street decision journal template](https://blog.mylifenote.ai/decision-journal-template-track-outcomes-improve-choices/) — decision / rationale / expected / follow-up schema
- [GTD weekly review pattern](https://loggd.life/tools/weekly-review) — structure for the weekly review prompt
- [Medium: Why Most Habit Trackers Fail](https://medium.com/the-intentional-life/why-most-habit-trackers-fail-and-what-actually-works-4481602de878) — supports the no-streaks anti-feature stance
- [Sage Handbook: Quantified Self scope creep](https://sk.sagepub.com/hnbk/edvol/the-sage-handbook-of-data-and-society/chpt/19-quantified-self-beyond-situated-data-practices) — scope-creep failure mode reference
- [npm doctor](https://docs.npmjs.com/cli/v11/commands/npm-doctor/) — `doctor` command UX pattern
- [@react-native-community/cli-doctor](https://www.npmjs.com/package/@react-native-community/cli-doctor) — `doctor` command UX pattern

---
*Feature research for: Recovery Ledger (local-first WHOOP API v2 personal review tool)*
*Researched: 2026-05-11*
