# Phase 4: Domain Math, Reviews, Decision Ledger & MCP Surface - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-05-16
**Phase:** 04-domain-math-reviews-decision-ledger-mcp-surface
**Areas discussed:** Daily review composition, Weekly review machinery, Decision ledger ergonomics, MCP surface composition

---

## Initial gray-area selection

| Option | Description | Selected |
|--------|-------------|----------|
| Daily review composition | `today_state` / `anomalies` / `actions ≤ 3` shape; anomaly threshold; action source; Z-score "refused" representation; `review daily` default date | ✓ |
| Weekly review machinery | 5-of-7 pre-registered candidates; per-candidate statistical test; "worst day" definition; week boundary semantics | ✓ |
| Decision ledger ergonomics | DEC-01 one-liner syntax; smart defaults; `decision review` interactive vs read-only; DEC-04 weekly-prompt mechanism | ✓ |
| MCP surface composition | `whoop_query_cache` filter shape; resource freshness model; 4 prompts content + inputs; tool rollout; `whoop_api_gap` data source | ✓ |

**User's choice:** "Discuss them all amongst yourself, come to me if there isn't a clear winner." (Same delegation pattern as Phases 1, 2, 3.)
**Notes:** All four areas selected. Claude worked through each area; landed clear winners on all 33 decisions; no escalation.

---

## Area A: Daily review composition

### A1. `reviewed_date` default

| Option | Description | Selected |
|--------|-------------|----------|
| Latest SCORED day in DB | Avoids today-is-PENDING_SCORE returning insufficient every morning (Pitfall 3); actionable when sync is stale; `--date <iso>` overrides | ✓ |
| Wall-clock today | Most literal; broken every morning until WHOOP scores yesterday | |

**Rationale:** D-01. Pitfall 3 makes wall-clock today actively harmful. The `data_status.staleness_days` field surfaces the lag transparently.

### A2. Baseline window anchor

| Option | Description | Selected |
|--------|-------------|----------|
| Trailing 30d from `reviewed_date` | Reproducible across time — same numbers next month | ✓ |
| Trailing 30d from wall-clock today | Couples baseline to runtime; harder to test | |

**Rationale:** D-02. Reproducibility wins; tests don't depend on `clock()` injection beyond `reviewed_date` resolution.

### A3. `today_state` vs `anomalies` split

| Option | Description | Selected |
|--------|-------------|----------|
| `today_state` carries raw measurements; `anomalies[]` carries Z analysis | Clean SRP — slot scope matches name | ✓ |
| `today_state` inlines per-metric Z fields | Tighter but conflates "what are today's numbers" with "are any of them notable" | |

**Rationale:** D-04. SRP-driven; renderer + agent both benefit from the split.

### A4. Z-score "refused" representation

| Option | Description | Selected |
|--------|-------------|----------|
| Discriminated union `{kind: 'computed'} \| {kind: 'refused', reason, days_available, days_required}` | Matches ADR-0004 forcing function + Phase 3 D-03 Score precedent | ✓ |
| Nullable value with separate `z_unavailable_reason` field | Two fields to keep in sync; consumer can forget the reason check | |
| Throws on insufficient | Breaks the no-exception-across-boundary discipline | |

**Rationale:** D-05. Tagged unions force consumer to handle absence — same forcing function that Phase 3's Score union proved out.

### A5. Anomaly firing rule

| Option | Description | Selected |
|--------|-------------|----------|
| `|z| ≥ 2.0` + per-metric direction map (HRV/recovery/sleep ↓ = bad; RHR/resp ↑ = bad; strain bidirectional informational) | Standard 2-sigma; direction map prevents informational-only fires | ✓ |
| `|z| ≥ 1.5` | Too noisy at n=30 (≈ 13% baseline false-positive rate per metric) | |
| `|z| ≥ 2.5` | Too conservative; misses meaningful 2-sigma deviations | |
| Adaptive threshold via percentile gating | Premature complexity; defer to V2-10 | |

**Rationale:** D-06. 2-sigma is the standard MAD-scaled outlier threshold; tunability deferred to V2-10.

### A6. Action source

| Option | Description | Selected |
|--------|-------------|----------|
| Fixed action catalog keyed off anomaly tags | Testable; lintable; ADR-0004/0005 compliant by construction | ✓ |
| Templated free-form text | More natural-sounding but harder to lint; drift risk toward coachy tone | |
| Rules engine + selectable templates | Premature complexity for ~10-15 actions | |

**Rationale:** D-08 / D-09. Fixed catalog wins because ADR-0005 banned-word lint can run once over the source; contract test = "fire anomaly set X → emit catalog entries [A1, A2, A3]" is deterministic; ADR-0004 forcing function ("no invented filler") is enforced structurally.

### A7. Daily `patterns` slot

| Option | Description | Selected |
|--------|-------------|----------|
| Typed `Pattern[]` empty in v1; renderer omits when empty | Slot reserved for V2 expansion; REV-06 scopes patterns to weekly | ✓ |
| Fill with multi-day patterns (e.g., 3-day sleep debt) | Scope creep into weekly-pattern territory; REV-06 explicitly assigns this to weekly | |
| Drop the slot entirely | Schema churn risk for V2 | |

**Rationale:** D-07. REV-06 is explicit — pattern detection is weekly's job. Schema slot stays for V2 forward-compat.

---

## Area B: Weekly review machinery

### B1. 5-of-7 pre-registered candidate factors

| Option | Description | Selected |
|--------|-------------|----------|
| sleep_duration + sleep_debt_3d + day_strain + workout_timing_late_evening + hrv_delta | Drops rhr_delta (multicollinear with HRV → BH FDR independence violated) + respiratory_rate_anomaly (rare events → low power) | ✓ |
| Include rhr_delta, drop hrv_delta | RHR is overnight WHOOP → strongly correlated with HRV (autonomic state). Keep the more sensitive of the two; HRV wins | |
| Include respiratory_rate_anomaly, drop something else | Rare events; under MAD scaling, anomaly fires <5% of cycles → poor power regardless of window | |
| All 7 with relaxed FDR q-value | Defeats the multiple-comparisons discipline that REV-07 explicitly invokes | |

**Rationale:** D-11. Multicollinearity (HRV/RHR) and low-power (respiratory) are technical reasons; the dropped factors are still surfaced as DAILY red-flag anomalies via D-06.

### B2. Per-candidate statistical test

| Option | Description | Selected |
|--------|-------------|----------|
| Mann-Whitney U (rank-sum, nonparametric, 2-sample) | Worst-day-vs-rest is a 2-group comparison; rank-based is robust to extremes; composes cleanly with BH FDR | ✓ |
| Spearman correlation across all days (factor → recovery) | Tests "is there a monotonic trend" — different question; we want "is the worst-day set systematically different" | |
| Two-sample t-test (parametric) | Assumes normality; with n=20 daily metrics this is a leap | |

**Rationale:** D-14. Mann-Whitney matches the question being asked. Spearman noted as deferred — different question family; revisit if Mann-Whitney misses patterns the user notices anecdotally.

### B3. Pattern-test window

| Option | Description | Selected |
|--------|-------------|----------|
| Trailing 28 days from reviewed_date with bottom-quartile worst-days | Statistical power; REV-07 fixture forces this — Mann-Whitney min p ≈ 0.286 at n=7, unreachable for q=0.10 | ✓ |
| Trailing 7 days (literal "this week") | Mathematically impossible for FDR to ever reject — fails REV-07 success criterion | |
| Trailing 14 days | Borderline (min p ≈ 0.143); doesn't satisfy "p=0.05 false positive that FDR correctly downgrades" fixture | |

**Rationale:** D-12. The REV-07 success criterion is the forcing function — it requires the test window to be statistically capable of producing p=0.05 results. Trailing-28 is the smallest window that satisfies this while preserving meaningful weekly framing. Week_summary stays trailing-7 per D-17 (the two windows serve different narrative roles).

### B4. "Worst days" definition + tie-break

| Option | Description | Selected |
|--------|-------------|----------|
| Bottom-quartile of SCORED days in pattern window, floor of 2; tie-break = chronologically earlier | Deterministic; gives ~5-7 worst-days at typical 70% SCORED coverage of 28d → sufficient for Mann-Whitney power | ✓ |
| Single lowest recovery_score day | n_total - 1 = "rest" gives min p too high for FDR | |
| Bottom-tertile | More worst-days but pulls in more medium recovery — dilutes the "bad days" signal | |

**Rationale:** D-13. Quartile balances signal vs. statistical power.

### B5. Week boundary semantics

| Option | Description | Selected |
|--------|-------------|----------|
| Trailing 7 days from reviewed_date | Continuous (works any day); avoids Mon-Sun vs Sun-Sat ambiguity; matches trailing-baseline pattern | ✓ |
| Mon-Sun calendar week | Cultural ambiguity (US vs ISO); user must wait until Sunday | |
| ISO week (year-week notation) | Adds notation complexity; doesn't gain anything at single-user scope | |

**Rationale:** D-17.

---

## Area C: Decision ledger ergonomics

### C1. `decision add` happy-path syntax

| Option | Description | Selected |
|--------|-------------|----------|
| Single positional `<text>` + all-optional flags; default `--category general` + `--follow-up = now()+7d` | One-liner works: `decision add "go zone 2 today"`; full surface available via flags | ✓ |
| Two positionals: `<category> <text>` | Forces a `general` category-arg for one-liner case (extra word); less natural | |
| All-interactive (no positional) | Slow for the happy path; breaks one-liner ergonomics REQ explicitly calls for | |
| Free-form unstructured | Loses category for `decision review` filtering | |

**Rationale:** D-19. DEC-01's "one-line happy path" literally describes the chosen shape.

### C2. `decision review` interactive vs read-only

| Option | Description | Selected |
|--------|-------------|----------|
| Read-only default + `--interactive` flag + sibling `decision update <id-or-prefix>` for scripted use | Scriptable + MCP-friendly + interactive available; readline stays stderr-safe; MCP `whoop_review_decisions` is dual-mode | ✓ |
| Always interactive | Breaks scripting; broken in MCP context (no stdin) | |
| Never interactive; force `decision update <id>` for all mutations | Loses the "prompt me to follow up on stale decisions" ergonomic that DEC-03 invokes | |

**Rationale:** D-20. Three modes serve three use cases (humans CLI; humans MCP; scripts/cron). MCP dual-mode keeps tool count at exactly 8 per MCP-01 lock.

### C3. DEC-04 weekly-prompt mechanism

| Option | Description | Selected |
|--------|-------------|----------|
| Typed `decision_prompt` slot on `WeeklyReviewResult`; CLI renders as final line; MCP returns in structuredContent | Both CLI + MCP surface it; non-interactive; agent decides how to react | ✓ |
| Interactive readline prompt in CLI weekly review only | Breaks MCP parity; surprising mid-render in CLI | |
| Extra section in weekly output text (no structured slot) | Loses agent-readability; agent can't tell prompt from review body | |

**Rationale:** D-22. Typed slot composes with ADR-0004 (positive output for absence) and preserves transport parity.

### C4. `decision_prompt.suggested_text` source

| Option | Description | Selected |
|--------|-------------|----------|
| Fixed template catalog (`DecisionPromptCatalogEntry[]`) keyed off surfaced pattern | Mirrors D-08 action catalog; ADR-0005 lintable in one place | ✓ |
| Free-form generation | Drift risk; harder to lint | |
| Always-generic ("Add a decision: …") | Misses opportunity to tailor when a pattern WAS detected | |

**Rationale:** D-23.

---

## Area D: MCP surface composition

### D1. `whoop_query_cache` filter shape

| Option | Description | Selected |
|--------|-------------|----------|
| Discriminated union per resource with typed filters + limit cap 500 | Matches REQUIREMENTS Out of Scope lock (typed filters, never free-form SQL); type safety at MCP boundary | ✓ |
| Free-form SQL pass-through | Explicitly out of scope per REQUIREMENTS | |
| One-shape filter with optional fields per resource | Less type-safe; consumer can pass `sportId` for `cycles` | |

**Rationale:** D-24. Direct quote of REQUIREMENTS Out of Scope row.

### D2. Resource freshness model

| Option | Description | Selected |
|--------|-------------|----------|
| Always read fresh from DB on every `resources/read` | better-sqlite3 indexed query is microseconds; WAL handles concurrent reads | ✓ |
| In-memory cache with TTL-based revalidation | Invalidation complexity for ~0 perf benefit at single-user scale | |
| `resources/list_changed` notifications on sync_runs insert | Cross-process coordination; over-engineered for v1 | |

**Rationale:** D-25.

### D3. 4 prompts' content + inputs

| Option | Description | Selected |
|--------|-------------|----------|
| Per-prompt: 1 user-role message return; server-side data assembly via `services.*` + thin instruction copy | Composes with existing service layer; tone-lint covers the instruction copy via D-26 | ✓ |
| Multi-message conversation seed | Over-engineered; prompts are templates not chats | |
| LLM-generated prompt body | Defeats the deterministic content + lintability discipline | |

**Rationale:** D-27. Per-prompt schemas in CONTEXT.md.

### D4. Tool rollout strategy

| Option | Description | Selected |
|--------|-------------|----------|
| Wave by sub-surface: services + formatters first, then all 8 MCP tools in one plan (each ≤5 lines), then 6 resources + 4 prompts in a separate plan | Matches Phase 3 wave discipline; service layer fully ready before any MCP work | ✓ |
| One tool per plan | Plan-count explosion (8+ plans just for tools); no value over batching | |
| All tools + resources + prompts in one plan | Too large; review burden | |

**Rationale:** D-33 outlines the close-discipline; the planner will refine the exact wave structure. ~13-16 plans expected (similar to Phase 3's 13).

### D5. `whoop_api_gap` data source

| Option | Description | Selected |
|--------|-------------|----------|
| In-source `ApiGapEntry[]` constant in `src/services/api-gap/data.ts`; Phase 5 promotes to bundled markdown | Avoids stub; tool returns real data Phase 4 day 1; Phase 5 (DOC-03/04) generates markdown from the same source of truth | ✓ |
| Move DOC-03 markdown work earlier into Phase 4 | Scope creeps Phase 5's install guide work into Phase 4 | |
| Ship a stub returning "content lands in Phase 5" | Tool registered but useless until Phase 5; bad agent UX | |
| Read from `.planning/research/` markdown | Couples runtime to planning artifacts; planning dir excluded from npm publish | |

**Rationale:** D-28. Resolves the MCP-01-vs-DOC-03 chicken-and-egg.

---

## Claude's Discretion

Same pattern as Phases 1, 2, 3. User delegated all four areas at once ("Discuss them all amongst yourself, come to me if there isn't a clear winner") — Claude worked through each area, landed clear winners on all 33 decisions (D-01 through D-33), no escalation.

Key resolution moments where the spec/ADRs forced a non-obvious choice:

1. **B3 / D-12 pattern-test window 28d (not 7d).** REV-07's success-criterion fixture ("p=0.05 false positive that FDR correctly downgrades") is mathematically unreachable at n=7 SCORED days — Mann-Whitney's minimum achievable p ≈ 0.286 (1-vs-6, two-sided). The spec itself dictates the longer window; no user input needed.

2. **B1 / D-11 5-of-7 candidate selection.** Multicollinearity (HRV ↔ RHR; both reflect overnight autonomic state) violates BH FDR's test-independence assumption — dropping the less-sensitive of the pair is the technically-correct call. Low statistical power at rare-event base rate (respiratory_rate_anomaly fires <5% of cycles under MAD scaling) is the technical reason to drop that one.

3. **C2 / D-21 `whoop_review_decisions` is dual-mode.** Keeps MCP tool count at exactly 8 per MCP-01 lock without sacrificing agent-native parity (any CLI mutation has an MCP path). Single tool with `{updateId?, status?, notes?}` input — list mode by default, update mode when `updateId` is provided.

4. **D5 / D-28 `whoop_api_gap` in-source constant.** Resolves the MCP-01-vs-DOC-03 chicken-and-egg without scope-creeping Phase 4 into Phase 5's markdown + install-guide work.

## Deferred Ideas

(Full list in `04-CONTEXT.md` `<deferred>`. Summary here for audit.)

- Daily `patterns[]` slot fill (multi-day patterns) — V2; REV-06 scopes patterns to weekly
- Tunable FDR q / confidence thresholds / Z threshold / candidate factor list via config — V2-10
- Free-form text query of decision rationale + notes — Phase 5+ if a real need appears
- `whoop_update_decision` as a separate tool — D-21 dual-mode held; revisit if discoverability becomes an issue
- Spearman correlation as a second weekly test family — revisit if Mann-Whitney misses anecdotal patterns
- rhr_delta + respiratory_rate_anomaly as candidates — V2-10 tunability path
- `recovery-ledger review monthly` / `review yearly` — V2-06 hook exists
- LLM-judge tone-scorer — ADR-0005 rejects; revisit only if banned-word lint fails to catch a real failure mode
- Email brief generation — V2-02
- Export to CSV / JSONL / Parquet — V2-04
- Decision tags + named experiments — V2-08
- Domain-specific prompt packs (travel, alcohol, caffeine, deload, illness, race week) — V2-09
- `learnings.md` entry for 5th-time-in-a-row comment-vs-grep collision — Phase 4 close housekeeping
