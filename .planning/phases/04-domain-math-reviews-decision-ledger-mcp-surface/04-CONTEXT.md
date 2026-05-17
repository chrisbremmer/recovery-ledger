# Phase 4: Domain Math, Reviews, Decision Ledger & MCP Surface - Context

**Gathered:** 2026-05-16
**Status:** Ready for planning

<domain>
## Phase Boundary

Stand up the full review-and-decision product surface — daily + weekly reviews backed by confidence-tier-disciplined statistics, a one-line decision ledger, and the complete MCP tool/resource/prompt set — exposed identically through CLI and MCP with tone enforced by lint. By the end of Phase 4:

- `recovery-ledger review daily` + `recovery-ledger review weekly` return typed result objects rendered through banned-word-linted formatters; both lead with data-freshness status; both honor the confidence-tier discipline (insufficient < 10 SCORED days, weak ≥ 10, strong ≥ 20 with ≥ 70% coverage; Z refused < 14 days).
- Weekly review applies Benjamini-Hochberg FDR @ q=0.10 across exactly 5 pre-registered candidate factors over a trailing-28-day pattern-test window with bottom-quartile worst-day grouping; returns `pattern = null` with a typed `no_pattern_reason` whenever nothing clears threshold (ADR-0004).
- `recovery-ledger decision add "<text>"` is a one-liner; `recovery-ledger decision review` lists open decisions with elapsed-vs-window framing; `recovery-ledger decision update <id-or-prefix>` records outcome status + notes.
- Weekly review surfaces a typed `decision_prompt` slot when no decision was added in the prior 7 days (DEC-04), tailored to the surfaced pattern when one exists.
- The MCP server exposes all 8 tools, 6 resources, 4 prompts from MCP-01/04/05; every tool body is ≤ 5 lines of shim over a `services.*` function; every tool returns both `structuredContent` and `content` text fallback (MCP-02/03); every error flows through the existing Phase 1 sanitizer pipeline (MCP-06, D-34 carry-forward).
- The banned-word lint extends from Phase 1's source-level grep gate to a contract test that runs every formatter on every fixture and re-checks rendered output for banned tokens (ADR-0005 §Enforcement defence-in-depth).
- A `whoop_api_gap` MCP tool returns an in-source `ApiGapEntry[]` catalog covering the 6 named WHOOP features unavailable via v2 API (Healthspan, ECG, BP, journal, continuous HR, hormonal insights) plus any others surfaced during execution; Phase 5 promotes the catalog to bundled markdown + install-guide cross-refs (DOC-03/04).

**Out of scope here** (later phases own them):
- Full `doctor` battery (auth roundtrip, DB integrity, schema version, WAL size, data-quality counts, last-sync recency, concurrent-writers stress, MCP transport stdout-purity self-test) — Phase 5 (DOC-01). Phase 4 reuses the existing 5-check doctor from Phases 1/2/3 unchanged.
- Install guide + per-client sections + WHOOP setup checklist + launchd `.plist` template + troubleshooting map — Phase 5 (DOC-04/05).
- <20-minute clean-clone CI stopwatch — Phase 5 (DOC-06).
- Live WHOOP API calls in tests — ADR-0006; everything goes through MSW fixtures.
- Daily-review `patterns` slot computation — Phase 4 ships the slot as `Pattern[]` typed empty (V2 expansion); REV-06 explicitly scopes pattern detection to weekly review.
- WHOOP roundtrip check in doctor — Phase 5 (carries forward Phase 2 D-22, Phase 3 deferred-ideas).
- Configurable baseline window beyond 30d, tunable confidence thresholds, tunable FDR q-value, decision tags, prompt-pack for travel/alcohol/etc. — V2 (REQUIREMENTS V2-05/V2-08/V2-09/V2-10).

</domain>

<decisions>
## Implementation Decisions

### Daily review composition (REV-01 through REV-05)

- **D-01:** **Default `reviewed_date` = `MAX(start) FROM cycles WHERE score_state = 'SCORED' AND baseline_excluded = 0`** (the latest fully-scored, non-DST/tz-excluded day in the cache). NOT wall-clock today. Reasons: (a) today's cycle is often `PENDING_SCORE` for hours after close per Pitfall 3 — reviewing wall-clock today before a score lands returns `insufficient` every morning; (b) if the user hasn't synced recently, "latest SCORED day in DB" still returns actionable data; (c) `data_status.reviewed_date` + `data_status.staleness_days = today − reviewed_date` surface the lag transparently. CLI `--date <iso>` flag overrides (mirrors `--days` / `--since` precedent on sync; `--days` from sync is NOT reused here — `review` uses `--date` for a single-day pin).
- **D-02:** **Baseline window anchor = trailing 30 days from `reviewed_date`** (NOT from wall-clock today). Re-running `review daily --date 2026-03-15` next month gives the same numbers. Tests don't depend on a `clock()` injection beyond `reviewed_date` resolution.
- **D-03:** **`DailyReviewResult` schema (REV-03 slot map):**
  ```ts
  type DailyReviewResult = {
    data_status: {
      reviewed_date: string;            // ISO yyyy-mm-dd (D-01)
      latest_sync_at: string | null;    // sync_runs.finished_at MAX
      latest_sync_status: 'ok' | 'partial' | 'failed' | null;
      staleness_days: number;           // today - reviewed_date
      baseline_window: { start: string; end: string; scored_day_count: number; coverage_pct: number };
      missing_resources: ResourceName[]; // not present in latest 7d
    };
    today_state: TodayMetrics;           // raw measurements (D-04)
    anomalies: Anomaly[];                // per-metric Z analysis (D-05/D-06)
    patterns: Pattern[];                 // EMPTY in v1 per scope; slot reserved (D-07)
    actions: SuggestedAction[];          // ≤3, from fixed catalog (D-09)
    confidence: ConfidenceGate;          // tier + reason + sampleSize + minRequired
    insufficient_reason: string | null;  // populated when tier === 'insufficient' (REV-05)
  };
  ```
- **D-04:** **`TodayMetrics`** carries only raw measurements (one numeric or null per metric, narrowed through ADR-0003's discriminated-union ScoreState): `recovery_score`, `hrv_rmssd_milli`, `resting_heart_rate`, `spo2_percentage`, `skin_temp_celsius`, `day_strain`, `sleep_duration_minutes`, `sleep_efficiency_percent`, `respiratory_rate`. Z-score analysis is NOT inlined here — it lives in `anomalies[]` (D-05). Keeps the slot's responsibility narrow ("what are today's numbers") separate from "are any of them notable."
- **D-05:** **`ZAnalysis` is a discriminated union** that mirrors ADR-0004's positive-output-for-absence pattern:
  ```ts
  type ZAnalysis =
    | { kind: 'computed'; value: number; baseline_median: number; baseline_mad: number; tier: 'weak' | 'strong' }
    | { kind: 'refused'; reason: 'insufficient_days'; days_available: number; days_required: 14 };
  ```
  REV-02's "Z-scores are refused on fewer than 14 days" maps to the `refused` variant. Domain code that tries to read `.value` without narrowing on `kind === 'computed'` fails at compile time — same forcing-function discipline as Phase 3 D-03's Score union.
- **D-06:** **Anomaly firing rule.** An `Anomaly` is emitted per metric when: `(a)` `ZAnalysis.kind === 'computed'`, `(b)` `|z| ≥ 2.0` (≈ 2-sigma; standard threshold for "outside the central 95%" under MAD scaling), and `(c)` direction is unfavorable per a per-metric direction map (HRV/recovery_score/sleep_duration/sleep_efficiency: bad when z ≤ -2; RHR/respiratory_rate: bad when z ≥ +2; day_strain: bidirectional — surface as informational, NOT actionable). Per-metric direction map lives at module-load constant in `domain/anomalies/direction.ts`. Threshold (`2.0`) and direction map are hardcoded in v1 — V2-10 owns tunability.
- **D-07:** **`patterns` slot on daily review is `Pattern[]` typed empty in v1.** REV-06 scopes pattern detection to the WEEKLY review (preceding-factor analysis over a multi-day window — incoherent at single-day scope). Slot stays in the schema so V2 can fill it ("3-day sleep-debt accumulation pattern observed"); the renderer omits the section when empty. Keeps Phase 4 scope tight; one fewer subsystem.
- **D-08:** **`actions ≤ 3` come from a fixed action catalog**, NOT free-form templating. Catalog lives at `domain/actions/catalog.ts` as `ActionCatalogEntry[]`:
  ```ts
  type ActionCatalogEntry = {
    id: string;                          // stable id, used in tests
    trigger: {                           // when does this action fire?
      anomaly_metric: MetricName;        // 'hrv_rmssd_milli' | 'sleep_duration_minutes' | …
      direction: 'low' | 'high';
    };
    text: string;                        // verb-first single sentence (REV-08)
    priority: number;                    // for ≤3 cap selection
  };
  ```
  Selection algorithm: for each fired `Anomaly`, look up matching catalog entries by `(metric, direction)`; rank by `priority` ascending; take top 3 across all fired anomalies. Returns `[]` when no anomalies fired (mirrors ADR-0004 — "no anomaly → no actions" is a positive output, NOT an invented filler line).
- **D-09:** **Why fixed catalog (vs. free-form templates):** (a) ADR-0005 banned-word lint runs once over the catalog instead of having to re-lint generated strings; (b) contract test = "fire anomaly set X → renderer must emit exactly catalog entries [A1, A2, A3]" — deterministic; (c) ADR-0004 forcing function "no invented filler" is enforced structurally (the only strings shippable are catalog strings); (d) verb-first single-sentence per REV-08 is enforced by a string-validation test ON the catalog itself (one assert per entry: `/^[A-Z][a-z]+\s/.test(text)` + length < 120 chars + no banned words). The catalog ships with ~10-15 entries covering the directional anomaly cases — Plan in Phase 4 will write the initial set; future-Chris can extend via PR (each PR re-runs the catalog lint).
- **D-10:** **REV-05 "insufficient → states what is missing and declines"** surfaces via `confidence.tier === 'insufficient'` + populated `insufficient_reason` (free-text from the gating layer, e.g., "8 SCORED days in baseline window — need 10 minimum") + `actions = []` + `anomalies = []`. Same forcing-function discipline as ADR-0004: insufficient is a typed positive output, not an empty review.

### Weekly review machinery (REV-06 / REV-07)

- **D-11:** **5 pre-registered candidate factors (locked at module-load constant `domain/patterns/candidates.ts`):**
  1. `sleep_duration_prior_night` — prior cycle's `sleep.duration_minutes`
  2. `sleep_debt_3d_rolling` — prior 3 cycles' summed (need − actual) duration
  3. `day_strain_prior_day` — prior cycle's `cycle.day_strain`
  4. `workout_timing_late_evening` — count of workouts in prior cycle's 18:00-23:59 user-local window
  5. `hrv_delta_prior_day` — prior cycle's HRV Z-score vs trailing-30 baseline (delta lens)

  **Dropped from REV-06's 7-factor list (with rationale):**
  - `rhr_delta_prior_day` — WHOOP's RHR is overnight (lowest 30s during sleep) → strongly correlated with HRV (both reflect autonomic state). Including both creates multicollinearity that BH FDR doesn't account for (BH assumes test independence; correlated tests inflate false-positive rates). `hrv_delta_prior_day` is the more sensitive of the two; keep one, drop the other.
  - `respiratory_rate_anomaly_prior_day` — rare events; under MAD scaling, the anomaly fires < 5% of cycles → statistical power is poor regardless of window size. Better surfaced as a current-day red-flag anomaly in the DAILY review (D-06) than as a weekly preceding factor.

  Comments in `candidates.ts` cite the dropped 2 + the rationale so a future reader doesn't ask the same question.

- **D-12:** **Pattern-test window = trailing 28 days** (NOT trailing 7). The REV-07 success criterion ("fixture designed to trigger a p=0.05 false positive that FDR correctly downgrades") forces this — with n=7 SCORED days, Mann-Whitney's minimum achievable p-value is ~0.286 (single worst-day vs 6 others, two-sided), so FDR @ q=0.10 is mathematically unreachable on weekly-window data. With 28d × ~70% SCORED coverage ≈ 20 SCORED days, bottom-quartile gives ~5 worst vs ~15 other → min Mann-Whitney p ≈ 0.001 → FDR is meaningful. Trailing-28 anchors from `reviewed_date` (mirrors D-02 trailing-30 anchor).
- **D-13:** **"Worst days" = bottom-quartile of SCORED days in pattern-test window** by `cycle.day_recovery_score` ascending. Quartile size = `floor(N_scored / 4)` with floor of 2 days (so n=8 SCORED → 2 worst; n=20 → 5 worst). Tie-break on `recovery_score` equality: keep the chronologically-earlier day in the worst set (deterministic). If `N_scored < 14` in pattern-test window → returns `pattern = null` with `no_pattern_reason = 'insufficient_window_days'` (matches REV-02 Z-score min; same gating constant).
- **D-14:** **Per-candidate statistical test = two-sided Mann-Whitney U (rank-sum).** Worst-days vs other-days as the two samples; non-parametric (no normality assumption — robust to single-day extremes that DST exclusion at the row level didn't catch); composes cleanly with BH FDR (each test returns a p-value independently). Implemented via `domain/stats/mann-whitney.ts` (pure function `mannWhitney(sample1, sample2): {U: number; p: number}`); fixture-tested against known values from a standard nonparametric stats reference. Spearman rejected (tests "is there a monotonic trend across all days" — different question; we want "is the worst-day set systematically different"). t-test rejected (assumes normality; with n=20 daily metrics, this is a leap).
- **D-15:** **FDR procedure = Benjamini-Hochberg at q=0.10 across the 5 candidate p-values.** Implemented via `domain/stats/fdr.ts` (`benjaminiHochberg(pvalues: number[], q: number): {rejected: boolean[]; adjusted: number[]}`). Fixture test: feed `[0.01, 0.04, 0.05, 0.20, 0.50]` with q=0.10 → assert which positions reject (the BH cutoff rejects the smallest p-value but downgrades the p=0.05; matches REV-07's "p=0.05 false positive that FDR correctly downgrades"). Pure function; no I/O.
- **D-16:** **`WeeklyReviewResult` schema (REV-06/07 slot map):**
  ```ts
  type WeeklyReviewResult = {
    data_status: {                       // mirrors D-03 daily, scoped to week + pattern window
      reviewed_date: string;
      week_start: string;                // reviewed_date - 6d (D-17)
      week_end: string;                  // reviewed_date
      pattern_test_window: { start: string; end: string; scored_day_count: number };
      latest_sync_at: string | null;
      latest_sync_status: 'ok' | 'partial' | 'failed' | null;
    };
    week_summary: {                      // 7-day calendar narrative
      scored_day_count: number;
      worst_days: { date: string; recovery_score: number }[];   // bottom-quartile chronologically sorted
      best_day: { date: string; recovery_score: number } | null;
      avg_strain: number | null;
      total_sleep_hours: number | null;
    };
    pattern:                              // FDR-corrected; positive-output-for-absence (ADR-0004)
      | { kind: 'detected'; factor: CandidateName; statistic: { U: number; p_raw: number; p_adjusted: number }; direction: 'worst_days_had_lower' | 'worst_days_had_higher' }
      | { kind: 'no_pattern'; reason: 'insufficient_window_days' | 'no_factor_cleared_fdr' | 'all_candidates_refused' };
    candidate_results: { factor: CandidateName; p_raw: number; p_adjusted: number; cleared: boolean }[];  // unranked context per ADR-0004 §If FDR set empty
    decision_prompt:                     // D-22
      | { kind: 'silent' }
      | { kind: 'none_this_week'; suggested_text: string };
    confidence: ConfidenceGate;
  };
  ```
- **D-17:** **"This week" = trailing 7 days from `reviewed_date`** (NOT Mon-Sun, NOT ISO-week). Continuous (works any day; no "wait until Sunday"); matches the trailing-baseline pattern (Phase 3 D-09/D-10 trailing-cursor + this phase's trailing-30 baseline anchor); avoids Mon-Sun vs Sun-Sat cultural ambiguity. `--date <iso>` overrides (mirrors `--date` on daily review). The 7-day window drives `week_summary` only; the pattern test runs on 28-day per D-12 — keep these two windows distinct in the result + in the formatter rendering ("This week (Mar 9-Mar 15): … / Pattern over trailing 28 days: …").
- **D-18:** **Multi-detection policy.** If multiple candidates clear FDR, `pattern` reports the candidate with the smallest `p_adjusted`. The full ranked list lives in `candidate_results` per ADR-0004 §Consequences ("lists the unranked candidates as context, not as a recommendation"). Avoids over-recommendation; the user sees one headline pattern + the full picture for self-vetting.

### Decision ledger ergonomics (DEC-01 through DEC-04)

- **D-19:** **`decision add` one-line happy path = `recovery-ledger decision add "<text>"`** (single positional `<text>`; all other fields optional flags). Full surface:
  - `recovery-ledger decision add "<text>" [--category <c>] [--rationale <r>] [--confidence <low|medium|high>] [--expected-effect <text>] [--follow-up <iso-date|"in <N>d">]`
  - Defaults: `--category general`, `--rationale` null, `--confidence` null, `--expected-effect` null, `--follow-up` = `now() + 7 days` (smart default per DEC-01).
  - `--follow-up "in 14d"` syntax sugar = `now() + 14 days`; ISO-date form for explicit dates.
  - ULID generation lives in `services/decision/index.ts` (uses `ulid` from npm) before the service calls `decisionsRepo.insert()` — matches the existing repo contract in `src/infrastructure/db/repositories/decisions.repo.ts` (caller passes id).
  - CLI exit codes: `0` on success (prints `decision <ulid-prefix> recorded`); `1` on invalid input (bad confidence value, malformed follow-up date); `1` on bootstrap failure (DB unreachable — flows through the same `bootstrap()` + `MigrationError` path as `sync`).
- **D-20:** **`decision review` is a non-interactive listing by default; sibling `decision update` handles mutation.** Three CLI surfaces:
  - `recovery-ledger decision review [--all]` — lists open decisions by default (status='open'); `--all` includes followed_up + abandoned. Columns: `<ulid-prefix> | <category> | <decision text trunc> | <elapsed_days> / <expected_window_days> | <over_window>`.
  - `recovery-ledger decision review --interactive` — lists past-window open decisions (elapsed_days > expected_window_days) and prompts one at a time for `status` + `notes` via Node `readline` (stderr-safe prompts; stdout reserved for the structured rendering — Phase 1 ADR-0001 still holds for CLI). NOT exposed through MCP.
  - `recovery-ledger decision update <ulid-or-prefix> --status <open|followed_up|abandoned> [--notes "<text>"]` — scriptable + MCP-friendly. Short-prefix lookup: if the prefix matches exactly one decision, use it; otherwise error "ambiguous prefix" with the list of matches OR "no match." Exit codes match `decision add`.
- **D-21:** **MCP `whoop_review_decisions` is dual-mode** — single tool serves both list and update. Input schema:
  ```ts
  { updateId?: string; status?: 'open' | 'followed_up' | 'abandoned'; notes?: string; includeAll?: boolean }
  ```
  When `updateId` is provided, the tool calls the update service path (`services.reviewDecisions({mode: 'update', ...})`) and returns the updated decision; when omitted, it lists open (or all when `includeAll`) decisions. Keeps the MCP-01 tool count at exactly 8 (no `whoop_update_decision` sibling); satisfies agent-native parity (any CLI mutation has an MCP counterpart) without ballooning the surface.
- **D-22:** **DEC-04 "weekly prompts for decision when none in prior week" → typed `decision_prompt` slot on `WeeklyReviewResult`.** When `decisionsRepo.countSince(reviewed_date - 7d) === 0`: `decision_prompt = { kind: 'none_this_week', suggested_text: <from catalog, D-23> }`; otherwise `decision_prompt = { kind: 'silent' }`. CLI renderer emits the prompt as the FINAL line of weekly output when `kind === 'none_this_week'`; MCP returns it verbatim in `structuredContent`. NO interactive readline in either transport — matches MCP's non-interactive contract and avoids surprising the CLI user mid-render. The agent (Claude Code / Claude Desktop) decides whether to surface the prompt as a follow-up question.
- **D-23:** **`decision_prompt.suggested_text` content comes from a fixed template catalog** (mirrors D-08 action catalog discipline). Catalog at `domain/actions/decision-prompts.ts` as `DecisionPromptCatalogEntry[]`:
  - Generic entry: `{trigger: 'no_pattern', text: "Add a decision: `recovery-ledger decision add \"<your action>\"`"}` — used when `WeeklyReviewResult.pattern.kind === 'no_pattern'`
  - Per-factor entries: one per pre-registered candidate (5 total per D-11) — `{trigger: 'pattern_detected', factor: 'sleep_duration_prior_night', text: "Sleep on worst-recovery days was meaningfully shorter. Add a decision: `recovery-ledger decision add \"sleep ≥7h on training days\" --category sleep`"}` etc.
  - Banned-word lint covers the catalog (D-26 contract test loop catches catalog drift).

### MCP surface composition (MCP-01 through MCP-06)

- **D-24:** **`whoop_query_cache` filter shape = typed-discriminated-union per resource** (NEVER free-form SQL — REQUIREMENTS Out of Scope locks this). Zod input:
  ```ts
  type QueryCacheInput =
    | { resource: 'cycles'; since?: string; until?: string; includeUnscored?: boolean; includeExcluded?: boolean; limit?: number }
    | { resource: 'recoveries'; since?: string; until?: string; includeUnscored?: boolean; minRecoveryScore?: number; maxRecoveryScore?: number; limit?: number }
    | { resource: 'sleeps'; since?: string; until?: string; includeUnscored?: boolean; limit?: number }
    | { resource: 'workouts'; since?: string; until?: string; includeUnscored?: boolean; sportId?: number; limit?: number }
    | { resource: 'profile' }            // single-row, no filters
    | { resource: 'body_measurements'; since?: string; until?: string; limit?: number }
    | { resource: 'sync_runs'; status?: 'ok' | 'partial' | 'failed' | 'running'; since?: string; limit?: number }
    | { resource: 'decisions'; status?: 'open' | 'followed_up' | 'abandoned'; category?: string; limit?: number };
  ```
  `limit` default = 100; hard-cap = 500 (prevents accidentally-huge MCP `structuredContent` payloads that would blow agent context windows). `includeUnscored` / `includeExcluded` carry forward from Phase 3 D-04/D-16 (`{includeUnscored: true, includeExcluded: true}` opt-in escape hatches). Service surface: `services.queryCache(input): QueryCacheResult` returns `{ resource, rows, count, truncated }` where `truncated = true` when count would have exceeded `limit`.
- **D-25:** **Resource freshness model = always read fresh from DB on every resource read.** MCP resources MCP-04 ("refresh from the cache") interpreted as: every `resources/read` is a fresh better-sqlite3 query against the cache. NO in-memory server-state cache; NO `resources/list_changed` notifications. Reasons: (a) DB reads via better-sqlite3 + indexed queries are microseconds; (b) Phase 3 WAL + `busy_timeout=5000` setup handles concurrent reads cleanly; (c) cross-process invalidation (CLI sync → MCP resource refresh) would need a fs-watcher or signal — complexity for ~0 perf benefit at single-user scale; (d) "refresh from the cache" wording specifically distinguishes from "refresh from the WHOOP API" — every read is fresh from the SQLite cache, not the in-memory copy. The 6 resources (`whoop://summary/today`, `whoop://summary/week`, `whoop://baseline/30d`, `whoop://data-quality`, `whoop://api-gaps`, `whoop://decisions/open`) all wire through `services.*` thin functions — same ≤ 5-line shim discipline as tools.
- **D-26:** **Banned-word lint defence-in-depth = two layers.** Layer 1: Phase 1's source-grep gate (`scripts/ci-grep-gates.sh` Gate A) already covers `src/formatters/` source. Layer 2: new contract test `tests/contract/formatter-tone.test.ts` runs EVERY formatter (`renderDoctor`, `formatSyncResult`, `renderDailyReview`, `renderWeeklyReview`, `renderDecisionList`) on EVERY fixture in `tests/fixtures/review/` + `tests/fixtures/decisions/`, then greps the rendered output for the banned-word list + emoji codepoints. Catches generated content that source-grep can't see (e.g., a catalog string concatenated into a template). Per ADR-0005 §Enforcement bullet 3 ("Contract test that runs the renderer on every fixture and re-checks the rendered output for banned tokens"). Test name pattern + glob make Phase 5 extensions trivial.
- **D-27:** **MCP prompts (MCP-05): each = 1 user-role message return; server-side data assembly via `services.*` + `formatters.*`.** Per-prompt input schemas + behaviors:
  - `whoop_daily_decision_brief({date?: string})` → calls `services.getDailyReview({date})`, renders via `formatters/daily-review.txt.ts`, returns 1 user-role message: `[rendered review]\n\nInstruction: Based on this review, suggest 1-3 concrete decisions for today. Each decision: verb-first single sentence, scoped to today's strain/sleep/recovery picture. Do not invent data.`
  - `whoop_weekly_recovery_investigation({weekEnding?: string})` → calls `services.getWeeklyReview({reviewed_date: weekEnding})`, returns 1 user-role message: `[rendered weekly review]\n\nInstruction: Investigate the pattern surfaced (or absence of pattern). Ask 1-2 clarifying questions about lifestyle factors not captured by WHOOP. Then propose a single experiment.`
  - `whoop_experiment_designer({hypothesis: string, durationDays?: number})` → returns 1 user-role message: `Hypothesis: <hypothesis>\nDuration: <durationDays default 14>\n\nUser baselines:\n[rendered baseline-30d resource for HRV, RHR, sleep duration, recovery, day strain]\n\nInstruction: Design an experiment with a clear pre-registered metric (one of: HRV, RHR, sleep duration, recovery score, day strain) and a stop condition.`
  - `whoop_deload_or_train({date?: string})` → calls `services.getDailyReview({date})` + `services.queryCache({resource: 'cycles', since: <date - 7d>, until: <date>})`, returns 1 user-role message: `[daily review]\n\n7-day strain trend:\n[strain per day, last 7 days]\n\nInstruction: Recommend one of: deload, easy training, normal training, push. Cite the specific data points that drove your recommendation.`

  Prompts are NOT formatters — they assemble data + instruction copy. The instruction copy passes the banned-word lint (D-26 contract test extends to prompt-returned text). Each prompt's body in `src/mcp/prompts/*.ts` is a thin wrapper over the corresponding `services.*` call + a `buildPromptMessage()` helper in `src/mcp/prompts/build.ts` — ≤5 lines of MCP wiring per file (matches the tool shim discipline).
- **D-28:** **`whoop_api_gap` data source = in-source `ApiGapEntry[]` constant in Phase 4.** Lives at `src/services/api-gap/data.ts`:
  ```ts
  type ApiGapEntry = {
    feature: string;                     // 'Healthspan' | 'ECG' | …
    whoop_consumer_path: string;         // 'WHOOP app → Health Monitor → Healthspan'
    available_via_v2_api: false;         // always false in v1; future entries may flip
    alternative_via_v2: string | null;   // 'closest proxy: recovery_score' | null
    notes: string;                       // short why-unavailable rationale
  };
  ```
  v1 list = the 6 named in REQUIREMENTS §Out of Scope (Healthspan, ECG, BP, journal, continuous HR, hormonal insights) + any others discovered during execution (the planner should review WHOOP's public consumer-feature list against the v2 API endpoints). Service surface: `services.getApiGap(): ApiGapResult` returns `{ entries: ApiGapEntry[] }`. Phase 5 (DOC-03/04) promotes the constant to bundled markdown + install-guide cross-refs; the constant remains the source of truth (markdown is generated from it). Avoids the chicken-and-egg of MCP-01 (`whoop_api_gap` ships Phase 4) vs DOC-03 (markdown lands Phase 5) — Phase 4's tool returns real content from day one.
- **D-29:** **`tools/list` transition.** Phase 3 D-33 attestation (`tools.length === 1`, only `whoop_doctor` registered) BREAKS INTENTIONALLY in Phase 4 — exactly as Phase 3 D-33 documented. New target: `tools.length === 8` (the 7 new tools + `whoop_doctor` carry-forward). Plan 02-08's G-03 runtime attestation gets updated in Phase 4's first MCP-touching plan to assert `tools.length === 8` and the full tool-name set; same defence pattern as Phase 3's Gate F + Gate G additions.
- **D-30:** **`src/mcp/sanitize.ts` and `src/mcp/register.ts` remain UNMODIFIED in Phase 4.** Phase 3 D-34 carry-forward extends — the 4 D-07 patterns + D-08 cause walker + Phase 2 D-19's `code=` / `client_secret` patterns already cover every error shape Phase 4 produces (`WhoopApiError` flow-through via `whoop_sync`/`whoop_query_cache`; `AuthError` flow-through via the same path; baseline / pattern / decision domain errors are pure value-error types that carry no secrets). New target: D-34 attestation extends as D-30 in Phase 4 ("sanitize.ts + register.ts UNMODIFIED across Phases 1+2+3+4"). MCP-06 (error returns sanitized via FND-06 contract) is satisfied by the existing pipeline — no new patterns needed.

### CLI surface composition

- **D-31:** **New Commander subcommands in Phase 4** (mirroring Phase 3 D-26's "three flags only" discipline — each subcommand ships with the minimum surface):
  - `recovery-ledger review daily [--date <iso>]` — defaults `reviewed_date` per D-01.
  - `recovery-ledger review weekly [--date <iso>]` — defaults `reviewed_date` per D-01; week = trailing 7 days per D-17.
  - `recovery-ledger decision add "<text>" [--category <c>] [--rationale <r>] [--confidence <low|medium|high>] [--expected-effect <text>] [--follow-up <iso|in Nd>]` per D-19.
  - `recovery-ledger decision review [--all] [--interactive]` per D-20.
  - `recovery-ledger decision update <id-or-prefix> --status <s> [--notes "<n>"]` per D-20.
  - `recovery-ledger query <resource> [resource-specific flags...] [--limit N]` per D-24 (typed per-resource; CLI mirror of the MCP tool surface).
  - `recovery-ledger api-gap` per D-28.
  - All subcommands wire through `bootstrap()` + their `services.*` function + a formatter — same ≤5-line shim discipline as Phase 3's `sync` (`src/cli/commands/sync.ts` is the canonical precedent).
- **D-32:** **Exit codes mirror Phase 3 precedent.** Each new CLI command exports a `<NAME>_EXIT_CODES: Readonly<Record<...,number>>` constant (Plan 03-12 / Plan 02-05 pattern). Reviews + query + api-gap: `0` on ok, `1` on bootstrap failure, `1` on data-fetch error. `decision add` / `decision update`: `0` on success, `1` on invalid input, `1` on bootstrap failure. `decision review --interactive`: `0` on clean exit (including user `^C` mid-prompt); `1` on bootstrap failure. Doctored exit-code help text per Plan 02-05's `addHelpText('after', ...)` precedent.

### Phase-close discipline (matches Phase 3 03-13 pattern)

- **D-33:** **Phase 4 closes with a phase-close plan** mirroring Plan 03-13: full-suite green (Vitest under 60s — may grow to 90s budget given the new domain math + contract tests; planner to verify); all 7 grep gates (Phase 1 A/B/C + Phase 2 E + Phase 3 F/G; D-26 contract test is a new Vitest contract suite, not a grep gate) + 1 new grep gate (Gate H: no `tools.length === 1` assertion outside `tests/__legacy__/`, enforcing the D-29 transition); D-30 attestation matrix (sanitize.ts + register.ts unchanged); REQUIREMENTS flip 18 REQ-IDs (REV-01..08, DEC-01..04, MCP-01..06) to Complete; ROADMAP flip Phase 4 to `[x]`; STATE record close; VALIDATION row per new test file.

### Claude's Discretion

The user delegated all four discussion areas at once: "Discuss them all amongst yourself, come to me if there isn't a clear winner." Same pattern as Phases 1, 2, 3. Worked through each area; landed clear winners on all 33 decisions; no escalation.

Key resolution moments where I had to do real thinking (vs. mechanical application of prior decisions):
1. **D-12 (pattern-test window must be 28d, not 7d)** — the REV-07 success-criterion fixture ("p=0.05 false positive that FDR correctly downgrades") is mathematically impossible with n=7 (Mann-Whitney's minimum achievable p ≈ 0.286 for 1-vs-6). The criterion FORCES a longer window; trailing-28 with bottom-quartile worst-day grouping is the smallest window that gives statistical power while preserving the weekly-narrative framing (week_summary stays trailing-7 per D-17). No user escalation needed — the spec itself dictates the resolution.
2. **D-11 (5-of-7 candidates: dropped rhr_delta + respiratory_rate_anomaly)** — both drops have clear technical rationales (multicollinearity with HRV; low power for rare events). Captured the rationale in code comments per the candidates.ts module per the spec's "pre-registered" stats-best-practice term (declare candidates in advance to prevent p-hacking).
3. **D-21 (`whoop_review_decisions` is dual-mode)** — keeps MCP tool count at exactly 8 per MCP-01 lock while preserving agent-native parity (any CLI mutation has an MCP path).
4. **D-28 (`whoop_api_gap` data source: in-source constant)** — resolves the MCP-01-vs-DOC-03 chicken-and-egg without scope-creeping Phase 4 into Phase 5's markdown / install-guide work.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Architectural Decision Records (load-bearing)
- `agent_docs/decisions/0001-mcp-stdout-purity.md` — no `console.*`, no `process.stdout.write` from any MCP-reachable path; every Phase 4 review/decision/query error that surfaces through an MCP tool goes through `src/mcp/sanitize.ts` + `src/mcp/register.ts` (the D-30 attestation extends from Phase 3 — both files stay UNMODIFIED in Phase 4)
- `agent_docs/decisions/0002-single-flight-oauth-refresh.md` — token-store + `callWithAuth` chokepoint; `whoop_sync` MCP tool is the Phase 4 entry point that re-uses the same refresh path (no new refresh code in Phase 4)
- `agent_docs/decisions/0003-score-state-discipline.md` — `Score = discriminatedUnion('score_state', …)`; SCORED-only domain by default; load-bearing for ALL baseline + Z-score code; D-04 `TodayMetrics` numeric fields are narrowed through this union before reaching the renderer
- `agent_docs/decisions/0004-no-reliable-pattern-positive-output.md` — THE Phase 4 ADR; D-05 `ZAnalysis.refused`, D-07 empty-`patterns` slot, D-08 empty-`actions[]`, D-10 `insufficient_reason`, D-16 `WeeklyReviewResult.pattern.kind === 'no_pattern'`, D-18 ranked `candidate_results` all hew to this ADR
- `agent_docs/decisions/0005-banned-tone-words.md` — THE other Phase 4 ADR; D-08 action catalog, D-23 decision-prompt catalog, D-26 defence-in-depth contract test ALL enforce this; banned-word list is the source of truth (no duplication of the list in code)
- `agent_docs/decisions/0006-fixture-only-tests.md` — MSW fixture-only; pattern-test fixtures + decision-add fixtures + MCP-tool-round-trip fixtures all go under `tests/fixtures/review/`, `tests/fixtures/decisions/`, `tests/fixtures/mcp/`
- `agent_docs/decisions/0007-whoop-read-only.md` — GET-only client carries forward; `whoop_sync` MCP tool wraps the existing Phase 3 `services.runSync` (no new WHOOP HTTP code in Phase 4)

### Project policy
- `CLAUDE.md` §Critical Rules — table rows 1, 3, 4, 5, 6 all apply directly to Phase 4 code; row 2 (single-flight) and row 7 (read-only) carry forward via the `whoop_sync` shim
- `CLAUDE.md` §Branch policy — every Phase 4 change goes through worktree + branch + PR + explicit user approval (Phase 0 `.planning/**` carve-out expired at start of Phase 1)
- `.planning/PROJECT.md` §Key Decisions — "Transparent uncertainty is a product feature" + "Local-first by default" motivate the confidence-tier discipline + the no-telemetry / no-LLM-coach posture
- `.planning/REQUIREMENTS.md` §Review — REV-01 through REV-08 (this phase's eight review requirements)
- `.planning/REQUIREMENTS.md` §Decision Ledger — DEC-01 through DEC-04 (this phase's four decision requirements)
- `.planning/REQUIREMENTS.md` §MCP Surface — MCP-01 through MCP-06 (this phase's six MCP requirements)
- `.planning/REQUIREMENTS.md` §Out of Scope — "Free-form SQL pass-through MCP tool" stays out (D-24 typed per-resource filters honor this); "Streaks / gamification" stays out (D-22 decision_prompt avoids gamified language); "Medical advice or clinical diagnosis" stays out (D-08 action catalog + D-23 decision-prompt catalog must avoid clinical/medical claims)

### Architecture & stack
- `.planning/research/STACK.md` §Core Technologies — versions pinned in Phase 3; Phase 4 adds: `ulid@^2.x` for D-19 decision IDs (npm latest at planning time; planner pins version)
- `.planning/research/STACK.md` §Date Handling — date-fns v4 + `@date-fns/tz`; D-01 reviewed_date defaults + D-17 trailing-7-day window arithmetic uses these
- `.planning/research/STACK.md` §What NOT to Use — no `axios`, no `prisma`, no `drizzle-kit push`; confirms no new HTTP stack in Phase 4 (review/decision are pure domain math + DB reads)
- `.planning/research/ARCHITECTURE.md` §Component Responsibilities — `services/` owns orchestration, `domain/` is pure, `formatters/` renders domain results to compact text, `mcp/` is ≤5-line shims
- `.planning/research/ARCHITECTURE.md` §Recommended Project Structure (lines 83-225) — verbatim file layout for `src/domain/baselines/`, `domain/anomalies/`, `domain/patterns/`, `domain/confidence/`, `services/review.service.ts`, `services/decision.service.ts`, `services/cache.service.ts`, `services/api-gap.service.ts`, `mcp/resources/`, `mcp/prompts/`, `formatters/daily-review.txt.ts`, `formatters/weekly-review.txt.ts`, `formatters/decision.txt.ts`
- `.planning/research/ARCHITECTURE.md` §Pattern 3: Result Objects with Confidence Tiers — D-03 `DailyReviewResult.confidence` + D-16 `WeeklyReviewResult.confidence` match this verbatim; both surfaces return `Result<T, ServiceError>` shapes
- `.planning/research/ARCHITECTURE.md` §Pattern 2: Repository Returns Domain Entities — D-21 `whoop_review_decisions` dual-mode wires through `services.reviewDecisions` which calls `decisionsRepo.listOpen()` + (extended) `decisionsRepo.updateOutcome()`; service never touches Drizzle directly
- `.planning/research/PITFALLS.md` §Pitfall 1 (Forced ranking when nothing changed) — D-08 action catalog + D-18 multi-detection policy + ADR-0004 forcing function all defend against this; the most common Phase 4 failure mode
- `.planning/research/PITFALLS.md` §Pitfall 3 (silent PENDING_SCORE consumption) — D-01 `reviewed_date = latest SCORED day` directly mitigates (today's cycle is often PENDING for hours; default to latest SCORED)
- `.planning/research/PITFALLS.md` §Pitfall 14 (Sample-size discipline / Z-score gating) — D-05 `ZAnalysis.refused` + D-13 N<14 gate match this verbatim; confidence-tier thresholds align with the Pitfall's recommendations
- `.planning/research/PITFALLS.md` §Pitfall 17 (Token logging) — D-30 carry-forward (sanitize.ts + register.ts unchanged) prevents new Phase 4 paths from inlining auth state into logs
- `.planning/research/SUMMARY.md` §Risks — "small-sample patterns" is the Phase 4 risk top-row; D-12 (28d window) + D-15 (BH FDR) + ADR-0004 ("no pattern" as positive output) all mitigate

### Roadmap context
- `.planning/ROADMAP.md` §Phase 4 — Goal, success criteria (5 of them), depends-on (Phase 3: SCORED-discipline + DST exclusion + `updated_at` deltas are pure-function preconditions)
- `.planning/ROADMAP.md` §Cross-Cutting Concerns rows "MAD + FDR + 'no reliable pattern detected' as positive output" + "Banned-word tone lint" — Phase 4 origin, tests stay in CI from this phase forward
- `.planning/phases/01-foundation-stdout-pure-mcp-bootstrap/01-CONTEXT.md` §Decisions — D-05/D-06 lock the doctor JSON shape; Phase 4 new tools follow the same `{structuredContent, content}` dual-shape pattern
- `.planning/phases/02-oauth-token-store-single-flight-refresh/02-CONTEXT.md` §Decisions — D-17 (zero new MCP tools, broken by Phase 4 D-29 — `tools.length` transitions from 1 → 8); D-18 (sanitize.ts + register.ts unchanged — extended as Phase 3 D-34, now Phase 4 D-30)
- `.planning/phases/03-data-model-db-layer-sync-loop/03-CONTEXT.md` §Decisions — D-04 SCORED-only default with `{includeUnscored}` opt-in (Phase 4 D-24 honors); D-16 baseline_excluded + `{includeExcluded}` opt-in (Phase 4 D-24 honors); D-23 sequential resource order (carries through `whoop_sync`); D-25 per-resource outcome enum (`whoop_sync` `structuredContent.perResource` surfaces this); D-28 repos return domain entities not Drizzle rows (Phase 4 services never import drizzle-orm — Gate G stays green); D-29 `getRawJson(id)` boundary method (Phase 4 `whoop_query_cache` may expose `getRawJson` as a per-resource action under D-24's typed shape, but defer unless the use case appears in execution); D-33 `tools.length === 1` attestation (Phase 4 D-29 breaks intentionally); D-34 sanitize.ts + register.ts unchanged (Phase 4 D-30 extends)
- `.planning/STATE.md` (current) — confirms Phase 3 closed clean; 26/49 REQ-IDs done; 549 tests in 10.06s; 7 grep gates green; Phase 4 picks up from `status: ready-for-next-phase`

### Conventions (project-local)
- `agent_docs/conventions.md` — TS strict, no default exports, lite hexagonal, validation at boundaries only, comments only when the *why* isn't obvious; D-08 action catalog + D-23 decision-prompt catalog comments document WHY each entry exists (the trigger condition + the rationale for the wording)
- `agent_docs/conventions.md` §Testing — `pool: 'forks'` for Vitest (Phase 4 contract tests don't need forks; integration tests for MCP transport via subprocess do); fixtures under `tests/fixtures/review/<scenario>.json`, `tests/fixtures/decisions/<scenario>.json`, `tests/fixtures/mcp/<tool-name>/<scenario>.json`; one helper file per MCP tool under `tests/helpers/mcp-<tool>.ts` (mirrors Phase 3's `msw-whoop-<resource>.ts` pattern)
- `agent_docs/workflows/contributing.md` — branch + PR + commit rules; every Phase 4 plan lands as its own branch + PR with `/ce-code-review` per `agent_docs/workflows/pr-review.md`

### External (consulted during discussion; researcher confirms or refines)
- WHOOP for Developers — Cycle (`https://developer.whoop.com/docs/developing/user-data/cycle/`) — `day_strain` field on cycles, `day_recovery_score` derivation; used in D-04 + D-13 + D-22 + D-27. Already canonized in 03-CONTEXT.md; carry-forward.
- WHOOP for Developers — Recovery (`https://developer.whoop.com/docs/developing/user-data/recovery/`) — `recovery_score`, `hrv_rmssd_milli`, `resting_heart_rate`, `spo2_percentage`, `skin_temp_celsius` field names + units; used in D-04. Already canonized; carry-forward.
- WHOOP for Developers — Sleep (`https://developer.whoop.com/docs/developing/user-data/sleep/`) — `sleep_duration_minutes`, `sleep_efficiency_percent`, `respiratory_rate`; used in D-04 + D-11. Already canonized; carry-forward.
- MCP Specification — Tools (`https://modelcontextprotocol.io/specification/server/tools`) — `inputSchema` Zod shape, `content` + `structuredContent` dual-return, error contract; used in D-21 + D-29.
- MCP Specification — Resources (`https://modelcontextprotocol.io/specification/server/resources`) — `resources/read` API, URI scheme conventions (`whoop://...`); used in D-25.
- MCP Specification — Prompts (`https://modelcontextprotocol.io/specification/server/prompts`) — `prompts/get` API, message-list return shape; used in D-27.
- Benjamini & Hochberg (1995) "Controlling the false discovery rate" — Journal of the Royal Statistical Society B; canonical reference for the BH procedure in D-15. Implementation tested against the worked example from the paper.
- Rousseeuw & Croux (1993) "Alternatives to the Median Absolute Deviation" — Journal of the American Statistical Association 88(424); justifies the MAD × 1.4826 scaling factor (consistency for normal distributions) named verbatim in REV-01.
- Mann & Whitney (1947) "On a Test of Whether One of Two Random Variables is Stochastically Larger than the Other" — canonical reference for the U test in D-14. Implementation tested against worked examples from a standard nonparametric stats reference (e.g., Hollander & Wolfe, "Nonparametric Statistical Methods").
- ULID specification (`https://github.com/ulid/spec`) — lexicographically-sortable 128-bit identifier format; D-19 uses the `ulid` npm package for decision IDs.
- date-fns `addDays` / `subDays` / format` documentation — D-01 reviewed_date arithmetic, D-17 trailing-7-day window arithmetic.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- **`src/services/bootstrap.ts`** (Plan 03-11, ~80 LOC) — `bootstrap(): Bootstrapped` opens DB + runs migrator + wires resource modules + repos; returns `{ services: { runSync, … }, close() }`. Every Phase 4 CLI shim (review, decision, query, api-gap) uses this — mirrors Plan 03-12 `sync.ts`'s `bootstrap()` call. The `Bootstrapped.services` interface needs to extend to include `getDailyReview`, `getWeeklyReview`, `addDecision`, `reviewDecisions`, `queryCache`, `getApiGap` — additive change, no Phase 3 breakage.
- **`src/services/index.ts`** (Plan 02-04 + 03-11, services barrel) — exports `createServices` (lightweight, no DB; used by Phase 1/2 doctor + Phase 4 MCP `whoop_doctor` carry-forward) AND `bootstrap` (DB-heavy; used by Phase 3 sync + Phase 4 reviews/decisions/queries). Phase 4 adds `getDailyReview`, `getWeeklyReview`, `addDecision`, `reviewDecisions`, `queryCache`, `getApiGap` as same-pattern barrel exports. `createServices()` continues to throw on `runSync` (and now `getDailyReview` etc.) — only `bootstrap()` wires the DB-dependent services.
- **`src/infrastructure/db/repositories/decisions.repo.ts`** (Plan 03-08, ~110 LOC) — Phase 3 stub shipped with `insert`, `byId`, `listOpen`. Phase 4 extends with `updateOutcome(id, status, notes)`, `countSince(date)` (for D-22 weekly-prompt gating), and short-prefix lookup `findByPrefix(prefix): Decision[]` (for D-20 CLI ergonomics). All extensions follow the existing `db.transaction({behavior: 'immediate'})` pattern from `insert()`. Repo type ships in `src/domain/types/repos.ts`.
- **`src/infrastructure/db/repositories/daily-summaries.repo.ts`** (Plan 03-08, ~100 LOC) — Phase 3 stub shipped with `upsertOneDay`, `byDateRange`, `latestComputedAt`. Phase 4 baseline service is the FIRST caller — writes one row per SCORED day during `getDailyReview` / `getWeeklyReview` (memoizes the median + MAD + scored_day_count + coverage for the trailing-30 window ending on that day; idempotent re-computation is a no-op via the PK upsert).
- **`src/infrastructure/db/repositories/cycles.repo.ts`** + **`recovery.repo.ts`** + **`sleep.repo.ts`** + **`workouts.repo.ts`** (Plan 03-08) — all default-filter on `score_state = 'SCORED' AND baseline_excluded = 0` per Phase 3 D-04/D-16. Phase 4 baseline service reads via the default filter (gets SCORED-only non-DST-excluded rows automatically); `whoop_query_cache` opts in via `{ includeUnscored: true, includeExcluded: true }` per D-24.
- **`src/cli/commands/sync.ts`** (Plan 03-12, ~250 LOC) — canonical precedent for the ≤5-line shim pattern with validation arms + error-formatting arms + `process.stdout.write` + exit-code constants. Phase 4 CLI commands (review, decision, query, api-gap) mirror this layout exactly: `<NAME>_EXIT_CODES` constant, `parse*Flag` validators, `<NAME>Command(opts)` orchestration shim, error-formatting catch with `sanitize()` fall-through. Same level of weight (~150-250 LOC per command); core composition stays ≤5 lines.
- **`src/cli/index.ts`** (Plan 03-12) — Commander wiring; Phase 4 extends with `review`, `decision` (with subcommands `add`, `review`, `update`), `query`, `api-gap` commands. Subcommand wiring follows Commander's `.command('decision').command('add')` pattern; documented exit codes via `.addHelpText('after', ...)` per Plan 02-05 / 03-12 precedent.
- **`src/mcp/register.ts`** (Plan 01-03, UNMODIFIED through Phases 2 + 3) — try/catch/sanitizer wrapper. Phase 4 tools use it verbatim; D-30 attestation extends. Each new tool registration in `src/mcp/tools/<tool>.ts` calls `register(server, '<tool_name>', {description, inputSchema}, async (input) => {...})`. The body is ≤5 lines per MCP-03 — wires `services.*` + builds `{content, structuredContent}` response.
- **`src/mcp/sanitize.ts`** (Plan 01-03 + Plan 02-07 fixtures, UNMODIFIED through Phases 2 + 3) — D-30 attestation extends: 4 D-07 patterns + D-08 cause walker + Phase 2 D-19's `code=` / `client_secret` patterns already cover every Phase 4 error shape.
- **`src/mcp/tools/whoop-doctor.ts`** (Plan 01-03 + Plan 02-06 enhancements) — canonical precedent for an MCP tool shim. Phase 4's 7 new tools (`whoop_sync`, `whoop_daily_review`, `whoop_weekly_review`, `whoop_query_cache`, `whoop_add_decision`, `whoop_review_decisions`, `whoop_api_gap`) follow the same shape: `toStructuredContent` JSON-roundtrip helper + `TOOL_DESCRIPTION` constant + `register(...)` body returning `{content, structuredContent}`. The Phase 3 `services.runSync` return type already shapes `structuredContent` per D-25 (`{status, perResource, …}`).
- **`src/formatters/sync.txt.ts`** (Plan 03-12) + **`doctor.txt.ts`** (Plan 01-05) — canonical formatter precedent. Phase 4 adds `daily-review.txt.ts`, `weekly-review.txt.ts`, `decision.txt.ts`, `query-cache.txt.ts`, `api-gap.txt.ts`. Each takes a typed result object and returns a `string` for stdout / MCP `content` fallback. Banned-word lint (`scripts/ci-grep-gates.sh` Gate A) covers the source; D-26 contract test extends the coverage to the RENDERED output across all formatters + all fixtures.
- **`src/infrastructure/config/logger.ts`** (Plan 01-02) — Pino → stderr fd 2. Phase 4 domain math + services use this for structured logging (`logger.warn({event: 'fdr_no_pattern_detected', candidates: 5})`). Never inline raw user data or decision text (ADR-0001 + Pitfall 17).
- **`tests/helpers/in-memory-db.ts`** (Plan 03-07) — in-memory SQLite helper for fixture-based integration tests. Phase 4 review + decision + query tests reuse this verbatim.
- **`tests/helpers/msw-whoop-*.ts`** (Plan 03-07, 6 helpers) — Phase 4 doesn't add MSW helpers (no new WHOOP endpoints) but reuses them for `whoop_sync` round-trip MCP tests.

### Established Patterns
- **Strict TS + ESM, no default exports** (conventions.md) — all Phase 4 code follows.
- **Lite hexagonal** (research/ARCHITECTURE.md) — `domain/` is pure (baselines, anomalies, patterns, confidence, stats); `services/` orchestrates (composes domain + repos + returns typed results); `mcp/` is ≤5-line shims; `cli/` is ≤5-line shims; `formatters/` renders results to compact text. ALL Phase 4 code respects this layering; the new Gate H (D-33) doesn't add a layering check (existing Gate G covers drizzle-orm leak; Gate F covers fetch leak — both still suffice).
- **Discriminated-union returns for optionality** (Phase 3 D-03 Score + this phase's D-05 ZAnalysis + D-16 WeeklyReviewResult.pattern + D-22 decision_prompt) — every "maybe-absent" result is a tagged union, not a nullable / optional field. Forces the consumer to handle absence; matches ADR-0004 philosophy.
- **Fixed catalogs over free-form templating** (D-08 actions + D-23 decision prompts + D-28 api gaps) — three places in Phase 4 where data lives as a typed `<Catalog>Entry[]` constant in `src/domain/actions/` or `src/services/api-gap/`. Each catalog is module-load static; banned-word lint runs over the catalog source. Future extension = add a row + ship a test asserting the new row's text passes the catalog lint.
- **`{structuredContent, content}` dual-return for MCP tools** (Plan 01-03 + Plan 02-06 precedent) — JSON.parse(JSON.stringify(result)) round-trip for `structuredContent` (validates serializability at runtime); formatter call for `content` text fallback. Phase 4 tools repeat this pattern verbatim.
- **`<NAME>_EXIT_CODES` constant + `addHelpText('after', ...)` exit-code documentation in CLI** (Plan 02-05 + Plan 03-12 precedent) — every new Phase 4 CLI command exports an `Object.freeze`d exit-code table and documents the table under `--help`.
- **Test fixtures as JSON** (Phases 1-3 D-02 / D-23 / D-15 precedent) — Phase 4 fixtures under `tests/fixtures/review/<scenario>.json` (e.g., `daily-strong-confidence.json`, `daily-insufficient-days.json`, `weekly-no-pattern-detected.json`, `weekly-pattern-fdr-downgrade.json`, `weekly-pattern-clears.json`); `tests/fixtures/decisions/<scenario>.json`; `tests/fixtures/mcp/<tool-name>/<scenario>.json`. The weekly-pattern-fdr-downgrade fixture is the load-bearing one for REV-07.
- **Vitest contract suite (extending Phase 3's contract pattern)** — new `tests/contract/formatter-tone.test.ts` per D-26; new `tests/contract/mcp-tool-shape.test.ts` asserting all 8 tools return `{content: Array, structuredContent: object}` against fixtures (MCP-02); new `tests/contract/mcp-resource-shape.test.ts` for the 6 resources; new `tests/contract/mcp-prompt-shape.test.ts` for the 4 prompts. Contract suite stays under 60s of total Vitest runtime (90s if needed; planner verifies).
- **Comment style — no plan-grep-criterion collisions** (Phases 1-3 precedent) — Phase 4 doc comments avoid literal `console.*`, `process.stdout.write`, the OAuth-token URL substring (outside `token-store.ts`), `drizzle-orm` (outside `infrastructure/db/`), and `fetch(` (outside `infrastructure/whoop/`). Phrase as "direct stdout writes" / "the OAuth refresh endpoint" / "the ORM" / "HTTP requests" instead. (5th-time-in-a-row deviation across Phases 1-4 — recommend `agent_docs/learnings.md` entry as part of Phase 4 close, low-priority.)

### Integration Points
- **CI matrix stays `[macos-latest, ubuntu-latest]`** (Plan 02-08 D-25) — Phase 4 inherits. Linux row continues to run `RECOVERY_LEDGER_FORCE_FILE_STORE=1`. No matrix change in Phase 4.
- **`recovery-ledger review` + `recovery-ledger decision` + `recovery-ledger query` + `recovery-ledger api-gap`** — net-new Commander subcommand groups; sit alongside `init`, `auth`, `doctor`, `sync` under `src/cli/commands/`. Same ≤5-line shim discipline.
- **`tools/list` returns 8 tools** — D-29 transition; Plan 02-08 G-03 runtime attestation gets updated to assert `tools.length === 8` and the full name set.
- **`resources/list` returns 6 resources + `prompts/list` returns 4 prompts** — new runtime attestations added per the same G-03 precedent (one assertion per surface).
- **Migrator runs at every CLI + MCP startup** (Phase 3 D-06) — Phase 4 adds zero new migrations (decisions + daily_summaries tables already shipped Phase 3). If a Phase 4 plan does need a column (e.g., a `notes` column on decisions to support D-20), that's a new generated migration following Phase 3's hand-rolled migrator contract verbatim.
- **`scripts/ci-grep-gates.sh`** — Phase 4 adds Gate H (no `tools.length === 1` outside `tests/__legacy__/`) per D-33. Plus a Gate I candidate the planner should weigh: no `Math.random()` in `src/domain/` (D-15 BH FDR test fixtures use deterministic p-values; any randomness in domain code would defeat the determinism that contract tests rely on). Defer Gate I to execution if a use-case appears; not load-bearing for planning.

</code_context>

<specifics>
## Specific Ideas

- **Pure-domain math layout.** `src/domain/stats/` is the new home for `mann-whitney.ts`, `fdr.ts`, `median.ts`, `mad.ts`. Each is a tiny pure function with a sibling `*.test.ts` of worked-example fixtures from a standard reference. `src/domain/baselines/` consumes `stats/` to produce `BaselineStats`. `src/domain/anomalies/` consumes `BaselineStats` + today's measurements to produce `Anomaly[]`. `src/domain/patterns/` consumes 28-day cycle/recovery/sleep/workout history + `stats/mann-whitney` + `stats/fdr` to produce the typed `pattern` field. Strict one-way data flow: stats ← baselines ← anomalies + patterns ← services.
- **Action catalog + decision-prompt catalog live near `domain/`.** Path: `src/domain/actions/catalog.ts` for the D-08 action catalog; `src/domain/actions/decision-prompts.ts` for the D-23 decision-prompt catalog. Each module exports a `Catalog[]` constant + a small `select(triggers): Entry[]` helper. Catalog modules import zero infrastructure (pure data + pure selection logic) — the strictest layer in the codebase.
- **`whoop_api_gap` data lives in `src/services/api-gap/data.ts`** per D-28, NOT under `domain/`. Reason: the catalog is documentation, not domain logic. Phase 5 will read this same module from a markdown-generation script for the install guide — same source of truth, two surfaces.
- **MCP prompt assembly helper.** `src/mcp/prompts/build.ts` exports `buildPromptMessage(text: string): {messages: [{role: 'user', content: {type: 'text', text: string}}]}` — one helper used by all 4 prompt files; keeps each prompt body to ≤5 lines per MCP-03 discipline.
- **Decision-add `--follow-up "in <N>d"` parser.** A tiny pure function `parseFollowUp(raw: string | undefined, now: () => Date): string` — accepts ISO date OR `"in 7d"` / `"in 14d"` syntax; returns ISO yyyy-mm-dd. Lives next to D-19's CLI shim under `src/cli/commands/decision-add.ts` (mirrors `parseSinceFlag` in `sync.ts`).
- **`reviewed_date` resolution is its own pure function.** `src/services/review/resolve-date.ts` exports `resolveReviewedDate(input: { date?: string }, latestScoredDayFn: () => string | null, clock: () => Date): { date: string, source: 'cli_flag' | 'latest_scored' | 'fallback_today' }`. Returns `'fallback_today'` only when the DB has zero SCORED days (Phase 4 first-run case; `data_status.staleness_days` is 0 + `confidence.tier === 'insufficient'` flows from there).
- **Contract-test fixture naming convention.** `<surface>-<scenario>.json` under each `tests/fixtures/<surface>/` directory. Examples: `daily-strong-confidence.json`, `daily-insufficient-days.json`, `daily-no-anomalies.json`, `daily-three-anomalies-capped.json`, `weekly-pattern-fdr-downgrade.json` (the REV-07 success-criterion fixture), `weekly-pattern-clears-fdr.json`, `weekly-no-pattern-insufficient-window.json`, `weekly-decision-prompt-none-this-week.json`, `decision-add-happy-path.json`, `decision-review-interactive-update.json`.

</specifics>

<deferred>
## Deferred Ideas

- **`Pattern[]` on daily review filled with multi-day patterns** (e.g., 3-day sleep-debt accumulation) — D-07 scopes daily-`patterns` to empty in v1; REV-06 explicitly assigns pattern detection to weekly. V2 expansion (REQUIREMENTS V2-06 "week-over-week trend comparison" is the closest existing v2 hook; a separate v2 entry for "daily preceding-factor patterns" may be worth adding).
- **Tunable FDR q-value / confidence thresholds / Z-score threshold / candidate factor list via config** — REQUIREMENTS V2-10. Phase 4 hard-codes per D-11 + D-13 + D-15. The config schema doesn't gain any keys in Phase 4.
- **Free-form text query of decision rationale + notes** — `whoop_query_cache` exposes typed filters per D-24; substring search across decision text is a natural extension but not load-bearing for v1. Revisit when a real use case appears.
- **`whoop_update_decision` as a separate MCP tool** — D-21 collapses update into `whoop_review_decisions` to hold the 8-tool count. If MCP tool discoverability becomes an issue (agents don't realize `whoop_review_decisions` is dual-mode), revisit and add an additional tool. Tracked as a post-Phase-4 observation, not a v1 fork.
- **Spearman correlation as a second weekly-review test family** — D-14 picks Mann-Whitney for the "worst-day-vs-rest" question. Spearman tests a different question ("monotonic trend across the week") and could complement BH FDR results. Defer; if Mann-Whitney misses patterns the user notices anecdotally, revisit.
- **rhr_delta_prior_day and respiratory_rate_anomaly_prior_day as additional candidates** — D-11 drops both with rationale. If post-Phase-4 use reveals one of them surfacing patterns the chosen 5 missed, swap one in via the V2-10 tunable-candidates path.
- **`recovery-ledger review monthly` / `review yearly`** — V2-06 ("week-over-week trend comparison") is the existing v2 hook. Monthly/yearly aggregations are NOT in Phase 4 scope; the trailing-30 baseline window is the only multi-week aggregation that ships.
- **LLM-judge tone-scorer for review output** — ADR-0005 §Alternatives rejected. Banned-word lint catches 90%+ of failures for zero runtime cost; defer LLM judging until a real failure mode appears that the lint can't catch.
- **Email brief generation as a local script** — REQUIREMENTS V2-02. Not in v1; `services.getDailyReview` returns the structured result that V2 can render to email.
- **Export to CSV / JSONL / Parquet** — REQUIREMENTS V2-04. Phase 3 D-29's `getRawJson(id)` is the forward-compat path; Phase 4 doesn't add export.
- **Decision tags + named experiments** — REQUIREMENTS V2-08. Phase 4 ships `--category` flat-string; tags are a different relational shape.
- **Prompt pack for travel, alcohol, caffeine, deload, illness suspicion, race week** — REQUIREMENTS V2-09. Phase 4 ships exactly 4 prompts per MCP-05 (`whoop_daily_decision_brief`, `whoop_weekly_recovery_investigation`, `whoop_experiment_designer`, `whoop_deload_or_train`); domain-specific prompt packs are deferred.
- **`learnings.md` entry for the 5th-time-in-a-row comment-vs-grep-criterion collision** — observation from Phase 4 code_context; non-load-bearing; recommend adding during Phase 4 close (mirrors the recommendation in Phase 3 D-15 specifics). Truly low priority — the convention is now clear and codified in conventions.md.

</deferred>

<decisions_addendum>
## Decisions Addendum (Post-Research, 2026-05-16)

Three open questions surfaced by `04-RESEARCH.md` were resolved after the user delegated each to the recommended option. These decisions are load-bearing for planning and extend the original D-01..D-33 set without contradicting any locked decision.

- **D-34:** **`pattern_confidence: 'weak' | 'strong'` slot on `WeeklyReviewResult.pattern`.** D-13's N_scored ≥ 14 floor stays as-is; when 14 ≤ N_scored < 20, the weekly result carries `pattern_confidence: 'weak'` so the formatter can render a "small sample — effect estimates imprecise" warning. When N_scored ≥ 20, `pattern_confidence: 'strong'`. Schema-additive; the existing `Pattern | { kind: 'no_pattern', reason }` discriminated union (ADR-0004) gains a non-discriminator annotation field on the `Pattern` arm. **Resolves Research Open Question 1.** Rationale: preserves the spec floor while signaling small-sample uncertainty (Mann-Whitney normal approximation degrades at n_1=3 vs n_2=11).

- **D-35:** **REV-07 load-bearing fixture is `[0.05, 0.20, 0.30, 0.45, 0.60]`; original D-15 numbers `[0.01, 0.04, 0.05, 0.20, 0.50]` move to a separate test case.** Under BH step-up at q=0.10/m=5, the original fixture rejects positions 1–3 (since 3·0.10/5 = 0.06 ≥ 0.05) — incompatible with the REV-07 success criterion "p=0.05 false positive that FDR correctly downgrades." The corrected fixture has zero rejections (smallest p=0.05 vs critical 0.02), making the "downgrade" assertion exercisable. **Two test cases:**
  1. **`bh_downgrades_marginal.fixture.json`** (REV-07 load-bearing, corrected) — p-values `[0.05, 0.20, 0.30, 0.45, 0.60]` → 0 rejections → weekly result = `{ kind: 'no_pattern', reason: 'no_factor_cleared_fdr' }` (matches D-16 locked schema).
  2. **`bh_partial_rejection.fixture.json`** (D-15 original numbers preserved as a separate path) — p-values `[0.01, 0.04, 0.05, 0.20, 0.50]` → 3 rejections at kStar=3 → weekly result returns the strongest-effect Pattern with `pattern_confidence` per D-34. Exercises the "BH rejects some but not all" path.

  **Resolves Research Open Question 2.** Both fixtures live in `tests/fixtures/weekly-fdr/`.

- **D-36:** **MCP resource + prompt sanitizer wrappers ship in Phase 4 scope.** Extend the Phase 1 `register.ts` wrapper discipline to two new files:
  - `src/mcp/register-resource.ts` — wraps `server.registerResource(...)` calls in the same try-catch + `sanitize.ts` error pipeline tools already use.
  - `src/mcp/register-prompt.ts` — same for `server.registerPrompt(...)`.

  All 6 resources (`whoop://summary/today`, `whoop://summary/week`, `whoop://baseline/30d`, `whoop://data-quality`, `whoop://api-gaps`, `whoop://decisions/open`) and all 4 prompts (`whoop_daily_decision_brief`, `whoop_weekly_recovery_investigation`, `whoop_experiment_designer`, `whoop_deload_or_train`) flow through these wrappers. Adds 2 source files (~120 LOC combined) and 2 new grep gates to `scripts/ci-grep-gates.sh`:
  - **Gate I (resource):** outside `src/mcp/register-resource.ts`, no direct `server.registerResource(`.
  - **Gate J (prompt):** outside `src/mcp/register-prompt.ts`, no direct `server.registerPrompt(`.

  D-33's `tools.length === 1` attestation (Phase 3 carry-forward) breaks intentionally in Phase 4 anyway (D-29) — the analog attestations become `resources.length === 6` + `prompts.length === 4` + `tools.length === 8`, all enforced via the wrapper layer. **Resolves Research Open Question 3.**

These three decisions are now locked alongside D-01..D-33.

</decisions_addendum>

---

*Phase: 04-domain-math-reviews-decision-ledger-mcp-surface*
*Context gathered: 2026-05-16*
