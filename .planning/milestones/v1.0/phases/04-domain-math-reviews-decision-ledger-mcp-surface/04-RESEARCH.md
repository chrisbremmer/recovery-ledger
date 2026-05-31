# Phase 4 Research

**Researched:** 2026-05-16
**Domain:** Domain math (robust statistics + FDR) + MCP tool/resource/prompt surface + CLI subcommands + formatter tone-lint
**Confidence:** HIGH on stack/SDK/library claims (verified against npm + SDK docs); MEDIUM on a few negative claims (no library ships a complete BH-FDR + Mann-Whitney-with-p-value bundle for Node — confirmed via npm survey)

## Summary

Phase 4 is small in net new infrastructure (one new npm dep, `ulid@^3.0.2`; zero new migrations) but large in net new logic: ~6 new domain modules (`stats/`, `baselines/`, `anomalies/`, `patterns/`, `confidence/`, `actions/`), 4 new services, 7 new MCP tools + 6 resources + 4 prompts, 5 new CLI subcommands, 5 new formatters, and one new contract-test gate (D-26 banned-word lint on rendered output).

The locked-CONTEXT decision set is dense (D-01..D-33). The work the planner needs is mechanical *given* the right scaffolding: this research identifies the scaffolding shapes so plans can be transcribed cleanly. The four loadbearing pieces:

1. **Statistical engine.** `simple-statistics@^7.8.9` covers median, MAD, and rank-sum statistic; we hand-roll the U→p-value conversion (~40 LOC, exact-only-for-tiny is impractical, normal approximation with continuity correction is the standard call here per the literature) and BH step-up (~25 LOC). Total ~90 LOC of pure math, all under `src/domain/stats/`.
2. **MCP surface.** `McpServer` in `@modelcontextprotocol/sdk@^1.29.0` has `registerResource(name, uriString, metadata, handler)` for static URIs and `registerPrompt(name, config, handler)` returning `{messages: [{role: 'user', content: {type: 'text', text}}]}`. Both follow the same `register*` symmetry as `registerTool`, but ADR-0001 + D-09 + Gate D currently restrict only `server.registerTool` to `src/mcp/register.ts` — Phase 4 must decide whether to extend the wrapper pattern to resources + prompts (recommended: yes, mirrors the sanitizer discipline).
3. **CLI surface.** Commander 14's `.command().command()` nested-subcommand pattern is the canonical idiom for `recovery-ledger decision add`, `recovery-ledger review daily`, etc. Phase 3's `sync.ts` shim is the canonical ≤5-line precedent.
4. **Decision schema audit.** The Phase 3 schema already covers all DEC-01..04 fields (`id`, `created_at`, `category`, `decision`, `rationale`, `confidence`, `expected_effect`, `follow_up_date`, `status`, `outcome_notes`). **Zero new migrations** required in Phase 4.

**Primary recommendation:** Use `simple-statistics` for the median/MAD/rank-sum statistic primitives; hand-roll the U→p-value conversion and the BH FDR step-up procedure with worked-example fixtures. Extend `src/mcp/register.ts` with parallel `registerResource()` and `registerPrompt()` wrappers (same try/catch/sanitize discipline as the existing tool wrapper; same Gate D enforcement model). Reuse the Phase 3 `sync.ts` shim shape verbatim for the 5 new CLI commands. Zero new migrations; Phase 4 schema is already shipped.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Median + MAD + Mann-Whitney + BH-FDR math | `src/domain/stats/` (pure) | — | Pure functions, zero I/O, fixture-tested; ADR-0001 prohibits stdout from this layer anyway |
| Baseline computation over SCORED-only entities | `src/domain/baselines/` | repos (data source) | Pure; consumes repo results, never queries directly |
| Anomaly detection (Z-score per metric → typed `Anomaly[]`) | `src/domain/anomalies/` | baselines (input) | Pure transformation; D-06 direction map is a module-load constant |
| Pattern detection (worst-day grouping + MW + BH) | `src/domain/patterns/` | stats, repos | Pure; the only domain module that consumes 28-day history |
| Confidence-tier gate | `src/domain/confidence/` | — | Pure decision function over `{scoredDays, coverage}` |
| Action selection (D-08 catalog) | `src/domain/actions/` | anomalies (input) | Pure; catalog is module-load const |
| Decision ledger orchestration | `src/services/decision/` | `decisions.repo` | Service composes ULID gen + repo writes + Result types |
| Review orchestration (daily + weekly) | `src/services/review/` | baselines, anomalies, patterns, repos | Service composes all domain modules + repos; returns typed `Result<DailyReviewResult>` |
| Query-cache orchestration | `src/services/cache/` | typed repos | Service maps `{resource, filters}` → repo call |
| API-gap data | `src/services/api-gap/` | — | Pure data + accessor; Phase 5 generates markdown from this |
| MCP tool/resource/prompt shims | `src/mcp/tools/` + `resources/` + `prompts/` | `services/` | ≤5-line shims; zero business logic per MCP-03 |
| CLI subcommand shims | `src/cli/commands/` | `services/`, `formatters/` | ≤5-line shims; same precedent as `sync.ts` |
| Formatters (5 new) | `src/formatters/` | — | Pure: typed result → string |
| Banned-word contract test | `tests/contract/formatter-tone.test.ts` | every formatter × every fixture | Defence-in-depth layer per ADR-0005 §Enforcement bullet 3 |

## Standard Stack

### Core (already in package.json — Phase 3 carry-forward)

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `@modelcontextprotocol/sdk` | ^1.29.0 | MCP server SDK — tools + resources + prompts via `McpServer.registerTool/registerResource/registerPrompt` | Pinned in Phase 1; latest released 2026-03-30 [VERIFIED: npm `npm view @modelcontextprotocol/sdk version` returned `1.29.0` on 2026-05-16] |
| `commander` | ^14.0.3 | CLI framework with nested subcommand support | Pinned in Phase 1; canonical `recovery-ledger <cmd> <subcmd>` pattern via `.command('review').command('daily')` [VERIFIED: in package.json] |
| `zod` | ^4.4.3 | Input schemas for MCP tools + Commander option validators | Pinned in Phase 1; Standard Schema compatible with `@modelcontextprotocol/sdk` [VERIFIED: in package.json] |
| `drizzle-orm` | ^0.45.2 | Query layer over existing `decisions` + `daily_summaries` + scored tables | Pinned in Phase 1; Phase 4 adds zero new tables [VERIFIED: in package.json] |
| `@date-fns/tz` | ^1 | IANA-zone-aware "trailing-30-days from reviewed_date" arithmetic | Pinned in Phase 1; D-01 reviewed_date + D-02 trailing-30 + D-17 trailing-7 all consume `subDays` / `format` [VERIFIED: in package.json] |
| `pino` | ^10.3.1 | stderr-only structured logging from services + domain | Pinned in Phase 1; ADR-0001 mandate [VERIFIED: in package.json] |

### Supporting (new in Phase 4)

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `ulid` | ^3.0.2 | ULID generation for `decisions.id` per D-19 | Phase 4 only; called from `src/services/decision/index.ts` before `decisionsRepo.insert()`. Zero runtime deps. [VERIFIED: npm `npm view ulid version` returned `3.0.2` on 2026-05-16; published 2025-11-30; `npm view ulid dependencies` returned empty (zero deps)] |
| `simple-statistics` | ^7.8.9 | `median`, `medianAbsoluteDeviation`, `wilcoxonRankSum` (returns rank-sum STATISTIC; we hand-roll the p-value conversion) | Phase 4 only; called from `src/domain/stats/` modules. ~90KB unpacked, zero deps, pure ESM. [VERIFIED: npm `npm view simple-statistics version` returned `7.8.9` on 2026-05-16; published 2026-03-10; docs at simple-statistics.github.io confirm `median`, `medianAbsoluteDeviation`, and `wilcoxonRankSum` exports] |

### Alternatives Considered

| Instead of | Could Use | Tradeoff / Why Rejected |
|------------|-----------|-------------------------|
| `simple-statistics` for stats primitives | Hand-roll median + MAD + rank-sum | ~50 LOC saved + fixture-tested-at-source; tradeoff is one more dep, but it's zero-dep and 90KB unpacked. [ASSUMED: dep size — verify exact installed footprint at plan time] |
| `simple-statistics` | `mathjs` | mathjs is multi-MB, includes a parser/expression engine, way over-scoped [CITED: mathjs README claims 600KB+ minified] |
| `simple-statistics` | `jstat` | jstat covers everything but is class-based, less ergonomic for pure-function codebase; unmaintained-looking (last npm release > 12 months) [ASSUMED — verify at plan time] |
| `simple-statistics` | `@stdlib/stats` | `@stdlib/stats` is the most complete numeric stack on npm but installs as ~50 individual sub-packages and total install is huge; over-scoped for our 3 primitives [ASSUMED — verify at plan time] |
| `ulid` npm | Hand-rolled Crockford Base32 ULID encoder | The spec is small (~80 LOC) but `ulid` v3 has zero deps + monotonic generator + worked benchmarks; risk-reward favors the lib [VERIFIED: ulid@3.0.2 has zero dependencies per `npm view`] |
| Native `crypto.randomUUID()` (UUID-v4) | — | D-19 explicitly says ULID for lexicographic-sortability (decision lists ordered by id are time-ordered). UUIDv4 doesn't sort. UUIDv7 would work but not as widely supported. |
| Build BH FDR into `simple-statistics` | Hand-roll BH step-up (~25 LOC) | No npm package ships BH-FDR; the algorithm is one nested loop over sorted p-values. Hand-roll [CITED: confirmed via WebSearch — `statsmodels.stats.multitest.fdrcorrection` is the canonical reference in scipy; no Node equivalent ships a complete FDR module per npm survey on 2026-05-16] |
| Hand-roll p-value from rank-sum | Compute via normal approximation with continuity correction | Standard textbook formula: `z = (|U - n1·n2/2| - 0.5) / sqrt(n1·n2·(n1+n2+1)/12)`; two-sided p ≈ 2·(1 - Φ(z)). Sample sizes at n1≈5 vs n2≈15 are at the edge where exact computation is justified but normal approx + continuity correction is the established practice for n≥4-5 each [CITED: Wikipedia Mann-Whitney U test article, accessed 2026-05-16] |

**Installation:**

```bash
npm install ulid@^3.0.2 simple-statistics@^7.8.9
```

**Version verification (run at plan time):**

```bash
npm view ulid version              # expect ^3.0.2 (published 2025-11-30)
npm view simple-statistics version # expect ^7.8.9 (published 2026-03-10)
```

## Package Legitimacy Audit

| Package | Registry | Age (at 2026-05-16) | Downloads | Source Repo | Postinstall? | Disposition |
|---------|----------|---------------------|-----------|-------------|--------------|-------------|
| `ulid` | npm | First publish 2016-08-01; v3.0.2 published 2025-11-30 (≈6 mo old; 10 yrs total) | Very high (canonical TS ULID — historical npm weekly ≥ 500k) [ASSUMED — verify at plan time] | github.com/ulid/javascript | None expected | Approved |
| `simple-statistics` | npm | First publish 2012; v7.8.9 published 2026-03-10 (≈2 mo old; 14 yrs total) | Very high (~3M weekly historically) [ASSUMED — verify at plan time] | github.com/simple-statistics/simple-statistics | None expected | Approved |

**slopcheck status:** Not run in this research session — both packages are well-known long-tenured ecosystem staples (ulid since 2016, simple-statistics since 2012). Both verified live on npm registry on 2026-05-16. Recommend the planner run `slopcheck install ulid simple-statistics` as a Wave 0 task to satisfy the standard gate.

**Packages removed due to slopcheck [SLOP] verdict:** none
**Packages flagged as suspicious [SUS]:** none expected

## MCP Surface

### `McpServer.registerTool` (already used; precedent in `src/mcp/register.ts`)

The Phase 1 wrapper `register(server, name, {description, inputSchema}, handler)` is the **only** call site of `server.registerTool` in the codebase (Gate D enforcement). Phase 4 adds 7 new tool registrations through this same wrapper. **No modification to `register.ts` required** for tool wiring; D-30 attestation extends.

**Signature (from `src/mcp/register.ts:60-82`):**

```ts
export function register<I extends ZodRawShape>(
  server: McpServer,
  name: string,
  config: { title?: string; description: string; inputSchema: I },
  handler: ToolCallback<I>,
): void
```

**Return shape (already enforced by wrapper):**

```ts
{
  content: [{ type: 'text', text: string }],     // human-readable, formatter output
  structuredContent: { [k: string]: unknown },   // JSON-roundtrip from typed result
}
```

The wrapper recursively sanitizes string leaves in `content[].text` AND `structuredContent` before returning (lines 90-121). Phase 4 tools get this for free.

### `McpServer.registerResource` — static URI signature

The MCP SDK exposes a second overload for static URIs (no template):

```ts
server.registerResource(
  name: string,
  uriString: string,           // e.g., 'whoop://summary/today'
  metadata: { title?: string; description: string; mimeType: string },
  handler: (uri: URL) => Promise<{
    contents: Array<{ uri: string; text: string; mimeType?: string }>
  }>,
): void;
```

[CITED: github.com/modelcontextprotocol/typescript-sdk/blob/main/docs/server.md confirms static-URI form `server.registerResource('config', 'config://app', {title, description, mimeType}, async uri => ({contents: [{uri: uri.href, text: 'App configuration here'}]}))`]

**Recommended Phase 4 pattern:** the 6 resources in MCP-04 (`whoop://summary/today`, `whoop://summary/week`, `whoop://baseline/30d`, `whoop://data-quality`, `whoop://api-gaps`, `whoop://decisions/open`) are **all static URIs**, NOT templated — there is no per-user dimension. Use the static-URI form for all 6.

**Resource read response shape:**

```ts
{
  contents: [
    {
      uri: 'whoop://summary/today',
      text: JSON.stringify(result),  // or formatter output, depending on resource
      mimeType: 'application/json',  // or 'text/plain' for text-rendered resources
    }
  ]
}
```

**RECOMMENDATION (cross-cuts D-09):** Mirror the `register.ts` wrapper for resources. Create `src/mcp/register-resource.ts` exporting `registerResource(server, name, uri, meta, handler)` that wraps the SDK call in the same try/catch/sanitize discipline. Add Gate D' to `ci-grep-gates.sh`: `\bserver\.registerResource\b` is banned outside `src/mcp/register-resource.ts`. Reasons: (a) consistency with the tool wrapper; (b) resource errors flow through the same sanitizer; (c) future Phase 5 additions follow the same pattern. Planner should weigh this against scope.

### `McpServer.registerPrompt` — argsSchema signature

```ts
server.registerPrompt(
  name: string,
  config: {
    title?: string;
    description: string;
    argsSchema?: z.ZodObject<...>,  // optional input args
  },
  handler: (args) => {
    messages: Array<{
      role: 'user' | 'assistant',
      content: { type: 'text', text: string }
        | { type: 'image', data: string, mimeType: string }
    }>
  },
): void;
```

[CITED: github.com/modelcontextprotocol/typescript-sdk/blob/main/docs/server.md and WebSearch results confirmed by multiple SDK example sources on 2026-05-16]

**Per-D-27, each Phase 4 prompt returns EXACTLY 1 user-role message:**

```ts
{
  messages: [
    {
      role: 'user' as const,
      content: { type: 'text' as const, text: assembledPromptString }
    }
  ]
}
```

**`as const` is load-bearing** for TS narrowing — the SDK types `role` as a literal union, not `string`.

### Recommended Phase 4 file layout for MCP surface

```
src/mcp/
├── index.ts                      # MODIFIED: wires 7 new tools + 6 resources + 4 prompts
├── register.ts                   # UNMODIFIED (D-30); existing tool wrapper
├── register-resource.ts          # NEW: parallel wrapper for resources (recommended)
├── register-prompt.ts            # NEW: parallel wrapper for prompts (recommended)
├── sanitize.ts                   # UNMODIFIED (D-30)
├── tools/
│   ├── whoop-doctor.ts           # UNMODIFIED (Phase 1)
│   ├── whoop-sync.ts             # NEW: ≤5-line shim over services.runSync
│   ├── whoop-daily-review.ts     # NEW
│   ├── whoop-weekly-review.ts    # NEW
│   ├── whoop-query-cache.ts      # NEW: D-24 typed discriminated-union filters
│   ├── whoop-add-decision.ts     # NEW
│   ├── whoop-review-decisions.ts # NEW: D-21 dual-mode (list + update)
│   └── whoop-api-gap.ts          # NEW
├── resources/
│   ├── summary-today.ts          # NEW: whoop://summary/today
│   ├── summary-week.ts           # NEW: whoop://summary/week
│   ├── baseline-30d.ts           # NEW: whoop://baseline/30d
│   ├── data-quality.ts           # NEW: whoop://data-quality
│   ├── api-gaps.ts               # NEW: whoop://api-gaps
│   └── decisions-open.ts         # NEW: whoop://decisions/open
└── prompts/
    ├── build.ts                  # NEW: buildPromptMessage(text) helper per CONTEXT specifics
    ├── daily-decision-brief.ts   # NEW
    ├── weekly-recovery-investigation.ts  # NEW
    ├── experiment-designer.ts    # NEW
    └── deload-or-train.ts        # NEW
```

### MCP-02 dual-shape contract (`structuredContent` + `content`)

**Confirmed by Phase 1 precedent** (`src/mcp/tools/whoop-doctor.ts:24` — `JSON.parse(JSON.stringify(result))` round-trip validates serializability). Every Phase 4 tool MUST return both slots. The pattern:

```ts
return {
  content: [{ type: 'text', text: formatXxx(result) }],   // formatter call
  structuredContent: toStructuredContent(result),         // JSON-roundtrip cast
};
```

Resources return `contents[].text` (NOT `content[].text` — note the plural "contents"). Prompts return `messages[].content.text`. These are three distinct shape contracts; the contract tests in `tests/contract/mcp-{tool,resource,prompt}-shape.test.ts` must check each one separately.

### D-29 attestation update

Phase 3's runtime attestation `tools.length === 1` (only `whoop_doctor`) **must** flip in Phase 4's first MCP plan. New attestations:

```ts
// In tests/integration/mcp-runtime.test.ts (extends Phase 3 G-03 pattern)
expect(toolsListResult.tools).toHaveLength(8);
expect(new Set(toolsListResult.tools.map(t => t.name))).toEqual(new Set([
  'whoop_doctor', 'whoop_sync', 'whoop_daily_review', 'whoop_weekly_review',
  'whoop_query_cache', 'whoop_add_decision', 'whoop_review_decisions', 'whoop_api_gap',
]));
expect(resourcesListResult.resources).toHaveLength(6);
expect(new Set(resourcesListResult.resources.map(r => r.uri))).toEqual(new Set([
  'whoop://summary/today', 'whoop://summary/week', 'whoop://baseline/30d',
  'whoop://data-quality', 'whoop://api-gaps', 'whoop://decisions/open',
]));
expect(promptsListResult.prompts).toHaveLength(4);
expect(new Set(promptsListResult.prompts.map(p => p.name))).toEqual(new Set([
  'whoop_daily_decision_brief', 'whoop_weekly_recovery_investigation',
  'whoop_experiment_designer', 'whoop_deload_or_train',
]));
```

Per CONTEXT §integration_points, Phase 4 ALSO adds Gate H: `\btools\.length\s*===\s*1\b` is banned outside `tests/__legacy__/` — enforces the transition.

## Statistical Engine

This section consolidates every formula the planner needs to transcribe into a plan. All claims [VERIFIED] against either the Benjamini & Hochberg (1995) original paper, the Rousseeuw & Croux (1993) consistency-scaling paper, or standard nonparametric stats references via Wikipedia (accessed 2026-05-16).

### 1. Median + MAD

**Median:** `simple-statistics.median(values)` — uses the standard `(n+1)/2`-th value for odd n, midpoint for even n.

**Median Absolute Deviation (MAD):** `simple-statistics.medianAbsoluteDeviation(values)` returns:

```
MAD = median(|x_i - median(x)|)
```

**Consistency scaling for normal data (REV-01 explicit requirement):**

```
robust_sigma = 1.4826 × MAD
```

[VERIFIED: Rousseeuw & Croux (1993) "Alternatives to the Median Absolute Deviation" JASA 88(424), pp. 1273-1283 — the 1.4826 factor is `1 / Φ⁻¹(0.75)`, making MAD a consistent estimator of σ for normal distributions]

**`simple-statistics.medianAbsoluteDeviation` does NOT apply the 1.4826 factor.** It returns the raw median absolute deviation. The 1.4826 multiplication happens in our `src/domain/stats/mad.ts` wrapper:

```ts
import { median, medianAbsoluteDeviation } from 'simple-statistics';
const MAD_CONSISTENCY = 1.4826;
export function robustSigma(values: number[]): number {
  return MAD_CONSISTENCY * medianAbsoluteDeviation(values);
}
```

**Edge case: MAD = 0 (constant-value window).** If all values in a baseline window are identical (rare but possible — e.g., respiratory_rate frozen at WHOOP's quantization), MAD = 0 and `z = (x - median) / 0` is undefined. **Required handling:** the Z-score machinery must return `{kind: 'refused', reason: 'baseline_mad_zero'}` (extend D-05's discriminated union with a third refused-variant, OR roll it into a single 'insufficient' tier with reason field). RECOMMEND: extend D-05 with a `baseline_mad_zero` refused variant — distinct from `insufficient_days` so the renderer can surface "metric is flat — no anomaly signal" rather than "not enough data."

### 2. Two-sided Z-score

```
z = (x - baseline_median) / (1.4826 × baseline_mad)
```

Where `x` is today's measurement, `baseline_median` and `baseline_mad` come from the trailing-30-day SCORED-only window.

**Anomaly threshold:** `|z| ≥ 2.0` per D-06 (≈ 2.5% per tail under normal-approximation; symmetric to "outside the central 95%").

**D-06 direction map (per-metric, hardcoded constant in `src/domain/anomalies/direction.ts`):**

| Metric | Bad when |
|--------|----------|
| `hrv_rmssd_milli` | `z ≤ -2` (low HRV = autonomic stress) |
| `recovery_score` | `z ≤ -2` |
| `sleep_duration_minutes` | `z ≤ -2` |
| `sleep_efficiency_percent` | `z ≤ -2` |
| `resting_heart_rate` | `z ≥ +2` (elevated RHR = stress) |
| `respiratory_rate` | `z ≥ +2` (elevated respiration = illness signal) |
| `day_strain` | bidirectional — surface as **informational**, NOT actionable per D-06 |

### 3. Confidence-Tier Gating

Per REV-02 + D-05 + D-13:

```ts
export type ConfidenceTier = 'insufficient' | 'weak' | 'strong';

export function confidenceFromCounts(opts: {
  scoredDays: number;       // count of SCORED non-DST-excluded days in trailing-30 window
  windowDays: number;       // total calendar days in window (30 for baselines, 28 for pattern test)
}): { tier: ConfidenceTier; coveragePct: number; minRequired: 10 | 20 } {
  const coveragePct = (opts.scoredDays / opts.windowDays) * 100;
  if (opts.scoredDays < 10) return { tier: 'insufficient', coveragePct, minRequired: 10 };
  if (opts.scoredDays >= 20 && coveragePct >= 70) {
    return { tier: 'strong', coveragePct, minRequired: 20 };
  }
  return { tier: 'weak', coveragePct, minRequired: 10 };
}
```

**Per-metric Z-score gate (D-05 `ZAnalysis.refused` when `daysAvailable < 14`).** This is a PER-METRIC gate, not the overall confidence tier — see Pitfalls §Mixed-recency Z-refusal below.

### 4. Mann-Whitney U

`simple-statistics.wilcoxonRankSum(sampleX, sampleY)` returns the **rank-sum statistic for sampleX only** — NOT a U statistic, NOT a p-value. [VERIFIED: github.com/simple-statistics/simple-statistics/blob/main/src/wilcoxon_rank_sum.js confirms it returns the rank-sum scalar; docstring "return rank sum for sampleX"]

**To convert to U:**

```
U_1 = R_1 - n_1·(n_1 + 1) / 2
```

Where `R_1` = rank sum returned by simple-statistics and `n_1` = `sampleX.length`. [CITED: Wikipedia Mann–Whitney U test, accessed 2026-05-16]

**Two-sided p-value via normal approximation with continuity correction** (recommended at n1≈5, n2≈15, where exact would require ~15504 permutations — borderline feasible but normal-approx is the textbook standard for n ≥ 4):

```
mu_U   = n_1 · n_2 / 2
sigma_U = sqrt(n_1 · n_2 · (n_1 + n_2 + 1) / 12)
z       = (|U - mu_U| - 0.5) / sigma_U          # continuity correction
p_two   = 2 · (1 - Phi(z))                       # two-sided
```

`Phi(z)` is the standard-normal CDF. **No npm dep gives us Phi directly without a heavier stats dep**, so hand-roll using the **Abramowitz & Stegun rational approximation** (~10 LOC, accuracy 7.5e-8) OR use `simple-statistics`'s `cumulativeStdNormalProbability` if it exists. [VERIFIED via WebSearch on simple-statistics docs: `cumulativeStdNormalProbability(z)` is exported — confirmed at simple-statistics.github.io/docs/]

Recommend: use `simple-statistics.cumulativeStdNormalProbability(z)`; total Mann-Whitney + p-value is ~30 LOC pure code.

**Edge cases:**

- **Ties in ranks:** `simple-statistics.wilcoxonRankSum` uses standard mid-rank averaging for ties. Document but no special action needed.
- **`n_1 < 4` or `n_2 < 4`:** normal approximation degrades sharply. The D-13 floor (`floor(N_scored/4)`, min 2 worst days; refuse if `N_scored < 14`) means the smallest sample is `n_1 = 2` (from `N=8`), but D-13 ALSO refuses entirely when `N_scored < 14`, so the smallest n_1 that actually reaches MW is `floor(14/4) = 3` worst vs 11 other. **At n_1=3 vs n_2=11, normal approximation is on the edge of validity.** Document: planner should consider whether to bump the D-13 floor to `N_scored ≥ 20` (mirroring "strong" tier), OR accept the approximation.
- **All values identical in one sample:** rank sum collapses to `n_1·(n+1)/2`; U = 0 or n_1·n_2; p ≈ 1 (no rejection). Behaviorally correct — no pattern detected.

### 5. Benjamini-Hochberg FDR Step-Up Procedure

No npm package ships a complete BH-FDR implementation. Hand-roll under `src/domain/stats/fdr.ts`:

```ts
/** Benjamini-Hochberg step-up procedure at false-discovery rate q.
 *  Returns { rejected: boolean[], adjusted: number[] }
 *  ordered to match the input p-values' positions. */
export function benjaminiHochberg(
  pvalues: number[],
  q: number,
): { rejected: boolean[]; adjusted: number[] } {
  const m = pvalues.length;
  // Pair each p-value with its original position
  const indexed = pvalues.map((p, i) => ({ p, i }));
  // Sort ascending by p-value
  indexed.sort((a, b) => a.p - b.p);
  // Walk from largest to smallest, find the largest k where p_(k) <= (k/m)·q
  const rejected = new Array(m).fill(false);
  let kStar = -1;
  for (let k = m; k >= 1; k--) {
    if (indexed[k - 1].p <= (k / m) * q) { kStar = k; break; }
  }
  // Reject all hypotheses with rank ≤ kStar
  if (kStar > 0) {
    for (let k = 0; k < kStar; k++) {
      rejected[indexed[k].i] = true;
    }
  }
  // Compute BH-adjusted p-values: min over k' >= k of (m/k')·p_(k')
  const adjusted = new Array(m).fill(0);
  let runningMin = 1;
  for (let k = m; k >= 1; k--) {
    const adj = Math.min(1, (m / k) * indexed[k - 1].p);
    runningMin = Math.min(runningMin, adj);
    adjusted[indexed[k - 1].i] = runningMin;
  }
  return { rejected, adjusted };
}
```

[VERIFIED: algorithm matches Benjamini & Hochberg (1995) "Controlling the false discovery rate: a practical and powerful approach to multiple testing" J.R.Statist.Soc.B 57(1), 289-300 — accessed via the canonical statsmodels reference implementation]

**REV-07 worked-example fixture** (canonical BH test from the worked example in the original paper, adapted to k=5):

Inputs: `pvalues = [0.01, 0.04, 0.05, 0.20, 0.50]`, `q = 0.10`.

Sorted: `[0.01, 0.04, 0.05, 0.20, 0.50]` (already sorted).

BH thresholds: `(k/m)·q` for k=1..5 = `[0.02, 0.04, 0.06, 0.08, 0.10]`.

Walk from k=5 down: `0.50 > 0.10` ✗ ; `0.20 > 0.08` ✗ ; `0.05 ≤ 0.06` ✓ → kStar=3, REJECT positions 1,2,3.

But wait — the CONTEXT spec says: "the BH cutoff rejects the smallest p-value but downgrades the p=0.05." With **5 candidates** and `q=0.10`, the BH critical value at the smallest position is `(1/5)·0.10 = 0.02`. Only `p=0.01 ≤ 0.02` passes. The naive step-up walks down from largest and finds that the threshold IS met at k=3 (p=0.05 ≤ 0.06), so the standard BH step-up REJECTS all three.

**This is a conflict between the spec's D-15 description ("p=0.05 false positive that FDR correctly downgrades") and the standard BH step-up procedure.** The standard step-up at k=3 IS rejection — so the fixture as described doesn't actually exercise BH downgrading.

**RECOMMENDATION TO PLANNER:** Use a different fixture for REV-07 that genuinely exercises the BH "no-cleared" path:

- `pvalues = [0.05, 0.20, 0.30, 0.40, 0.80]`, `q = 0.10` → step-up finds no k where `p_(k) ≤ (k/5)·0.10`: at k=1 threshold=0.02, p=0.05 > 0.02 ✗; at k=2 threshold=0.04 ✗; etc. → kStar = -1, NONE rejected.
- The smallest p (0.05) WOULD have been "significant" at α=0.05 unadjusted; FDR correctly suppresses it.

This is the genuinely load-bearing REV-07 fixture. Update D-15 mental model accordingly: with k=5 and q=0.10, the most-significant p must be ≤ 0.02 to clear.

### 6. Pattern-test data flow (D-12 / D-13 / D-14 / D-15)

```
1. Read SCORED + non-baseline-excluded cycles in trailing-28-day window.
   IF count < 14 → return { kind: 'no_pattern', reason: 'insufficient_window_days' }

2. Sort by day_recovery_score ASC; pick bottom-quartile worst_days = first floor(N/4) (min 2).
   Tie-break: chronologically earlier wins ascending position (deterministic).

3. For each of 5 candidate factors (D-11):
   a. Build sampleWorst[]: the factor's value for each worst-day cycle's prior-day data.
   b. Build sampleOther[]: the factor's value for each non-worst-day cycle's prior-day data.
   c. Drop any cycles where the factor value is null (PENDING / UNSCORABLE / DST-excluded
      cycle preceding the test cycle).
   d. IF sampleWorst.length < 2 OR sampleOther.length < 4 → record p_raw = NaN, cleared=false,
      mark candidate 'refused'.
   e. ELSE: rankSum = wilcoxonRankSum(sampleWorst, sampleOther);
        U = rankSum - n1·(n1+1)/2;
        z = (|U - n1·n2/2| - 0.5) / sqrt(n1·n2·(n1+n2+1)/12);
        p_raw = 2 · (1 - cumulativeStdNormalProbability(z))
      Record direction by comparing medians.

4. Pass the 5 p_raw values (skipping NaN-refused candidates) into benjaminiHochberg(ps, 0.10).

5. IF all candidates refused → return { kind: 'no_pattern', reason: 'all_candidates_refused' }
   IF no candidate.rejected → return { kind: 'no_pattern', reason: 'no_factor_cleared_fdr' }
   ELSE → return { kind: 'detected', factor: <smallest p_adjusted>, ... }
```

## CLI Surface

### Commander 14 nested-subcommand idiom

[VERIFIED: `commander@^14.0.3` in package.json; the chained `.command()` pattern is canonical and stable across major versions]

```ts
const program = new Command().name('recovery-ledger').version('0.1.0');

// Top-level groups:
const reviewCmd = program.command('review').description('Run daily or weekly review');
reviewCmd
  .command('daily')
  .description('Daily review (today vs trailing-30 baseline)')
  .option('--date <iso>', 'override reviewed_date (defaults to latest SCORED day in cache)')
  .action(runReviewDailyCommand);
reviewCmd
  .command('weekly')
  .description('Weekly review (trailing-7 narrative + 28d pattern test)')
  .option('--date <iso>', 'override reviewed_date')
  .action(runReviewWeeklyCommand);

const decisionCmd = program.command('decision').description('Manage the decision ledger');
decisionCmd
  .command('add <text>')
  .description('Record a new decision (one-line happy path)')
  .option('--category <c>', 'category name', 'general')
  .option('--rationale <r>', 'why this decision')
  .option('--confidence <level>', 'low | medium | high')
  .option('--expected-effect <text>', 'what we expect to see')
  .option('--follow-up <date>', 'ISO date or "in 7d" / "in 14d"')
  .action(runDecisionAddCommand);
decisionCmd
  .command('review')
  .description('List open decisions; --interactive prompts past-window outcomes')
  .option('--all', 'include followed_up + abandoned')
  .option('--interactive', 'prompt for outcome on past-window decisions')
  .action(runDecisionReviewCommand);
decisionCmd
  .command('update <id-or-prefix>')
  .description('Record outcome for a decision')
  .requiredOption('--status <s>', 'open | followed_up | abandoned')
  .option('--notes <text>', 'outcome notes')
  .action(runDecisionUpdateCommand);

program
  .command('query <resource>')
  .description('Read typed slice of the local cache')
  .option('--since <iso>', 'lower bound')
  .option('--until <iso>', 'upper bound')
  .option('--limit <n>', 'cap rows (default 100, max 500)', parseIntStrict, 100)
  // Per-resource flags are added conditionally via .hook('preAction') or parsed in the handler
  .action(runQueryCommand);

program
  .command('api-gap')
  .description('List WHOOP consumer-app features unavailable via v2 API')
  .action(runApiGapCommand);
```

**Positional vs. flag for `decision add "<text>"`:** Commander accepts the angle-bracket form `decision add <text>` as a REQUIRED positional. The signature `.command('add <text>')` makes `<text>` required; an empty positional triggers Commander's standard "missing required argument" error (exit 2 by default — override via `.exitOverride()` if we want exit 1 like `decision update`).

### `--follow-up "in <N>d"` parser

Per CONTEXT specifics — `src/cli/commands/decision-add.ts` exports `parseFollowUp(raw, now)`:

```ts
export function parseFollowUp(
  raw: string | undefined,
  now: () => Date,
): { ok: true; value: string } | { ok: false; message: string } {
  if (raw === undefined) {
    // Default: now + 7 days, ISO yyyy-mm-dd
    const d = new Date(now().getTime() + 7 * 86_400_000);
    return { ok: true, value: d.toISOString().slice(0, 10) };
  }
  const m = /^in\s+(\d+)d$/i.exec(raw);
  if (m && m[1]) {
    const n = Number.parseInt(m[1], 10);
    if (n > 365) return { ok: false, message: `Invalid --follow-up: ${n} exceeds 365 days.` };
    const d = new Date(now().getTime() + n * 86_400_000);
    return { ok: true, value: d.toISOString().slice(0, 10) };
  }
  // ISO date form
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) {
    return { ok: false, message: `Invalid --follow-up: ${raw} not "in Nd" or ISO 8601.` };
  }
  return { ok: true, value: parsed.toISOString().slice(0, 10) };
}
```

Same shape as `parseSinceFlag` in `src/cli/commands/sync.ts` (Phase 3 precedent).

### `bootstrap()` integration

Every Phase 4 CLI shim follows the `sync.ts` precedent at `src/cli/commands/sync.ts:146-209`:

```ts
export async function runReviewDailyCommand(opts: { date?: string }): Promise<void> {
  // 1. (No validation needed for --date alone; resolveReviewedDate handles missing/null.)
  // 2. bootstrap
  let app: Bootstrapped;
  try { app = bootstrap(); } catch (err) {
    process.stdout.write(`${formatBootstrapError(err)}\n`, () =>
      process.exit(REVIEW_EXIT_CODES.bootstrap_failed));
    return;
  }
  // 3. services.getDailyReview()
  try {
    const result = await app.services.getDailyReview({ date: opts.date });
    // 4. format + write
    process.stdout.write(`${renderDailyReview(result)}\n`, () => {
      app.close();
      process.exit(REVIEW_EXIT_CODES.ok);
    });
  } catch (err) {
    app.close();
    process.stdout.write(`Review failed: ${sanitize(String(err))}\n`, () =>
      process.exit(REVIEW_EXIT_CODES.failed));
  }
}
```

### `Bootstrapped.services` extension

Phase 4 extends the interface at `src/services/bootstrap.ts:104-108`:

```ts
services: {
  runSync(input: RunSyncInput): Promise<RunSyncResult>;
  // Phase 4 additions:
  getDailyReview(input: { date?: string }): Promise<DailyReviewResult>;
  getWeeklyReview(input: { date?: string }): Promise<WeeklyReviewResult>;
  addDecision(input: AddDecisionInput): Promise<Decision>;
  reviewDecisions(input: { mode: 'list' | 'update'; ... }): Promise<ReviewDecisionsResult>;
  queryCache(input: QueryCacheInput): Promise<QueryCacheResult>;
  getApiGap(): Promise<ApiGapResult>;
};
```

Additive change — no Phase 3 breakage. The MCP entry (`src/mcp/index.ts`) currently calls `createServices()` (lightweight, no DB); **Phase 4 MUST switch the MCP entry to `bootstrap()`** so the new services have a DB handle. This is a one-line change but it's load-bearing: pin in a Phase 4 plan.

### Exit-code constants

Mirror Plan 02-05 / 03-12 precedent — every new command exports `<NAME>_EXIT_CODES`:

```ts
export const REVIEW_EXIT_CODES: Readonly<Record<string, number>> = Object.freeze({
  ok: 0, failed: 1, bootstrap_failed: 1,
});
export const DECISION_ADD_EXIT_CODES: Readonly<Record<string, number>> = Object.freeze({
  ok: 0, invalid_input: 1, bootstrap_failed: 1, db_write_failed: 1,
});
export const DECISION_REVIEW_EXIT_CODES: Readonly<Record<string, number>> = Object.freeze({
  ok: 0, bootstrap_failed: 1,
});
export const DECISION_UPDATE_EXIT_CODES: Readonly<Record<string, number>> = Object.freeze({
  ok: 0, ambiguous_prefix: 1, no_match: 1, invalid_input: 1, bootstrap_failed: 1,
});
export const QUERY_EXIT_CODES: Readonly<Record<string, number>> = Object.freeze({
  ok: 0, invalid_input: 1, bootstrap_failed: 1,
});
export const API_GAP_EXIT_CODES: Readonly<Record<string, number>> = Object.freeze({
  ok: 0, bootstrap_failed: 1,
});
```

## Formatter Architecture

### Precedent

`src/formatters/sync.txt.ts` (~150 LOC) and `src/formatters/doctor.txt.ts` are the canonical formatter shape: a pure function `formatXxx(typedResult): string` with column-padding constants at module scope, a `statusSuffix(status)` exhaustive switch (forcing-function pattern for new status kinds), and zero I/O.

### 5 new formatters

| File | Input | Output rendered surface |
|------|-------|-------------------------|
| `src/formatters/daily-review.txt.ts` | `DailyReviewResult` | Multi-section: `Data status:` header (reviewed_date, latest sync, baseline window) → `Today's measurements:` table (one line per metric, narrowed through Score union) → `Anomalies:` section (one line per fired anomaly with Z-value + tier) → `Patterns:` section (omitted in v1 per D-07) → `Actions:` numbered list (≤3) → `Confidence: <tier>` footer with reason when insufficient |
| `src/formatters/weekly-review.txt.ts` | `WeeklyReviewResult` | `Week (Mar 9 - Mar 15):` narrative → worst-days list → `Pattern over trailing 28 days: …` section OR `Pattern: no reliable pattern detected. Reason: <one-of-three>` → `candidate_results` ranked context list → `Decision prompt:` final line when `decision_prompt.kind === 'none_this_week'` |
| `src/formatters/decision.txt.ts` | `Decision[] | Decision | DecisionUpdateResult` (dispatched on shape) | List form: padded columns `<id-prefix> | <category> | <truncated decision> | <elapsed_days>/<expected_window_days> | <over_window?>`; single-decision form: detail block; update form: `decision <id-prefix> updated to <status>` |
| `src/formatters/query-cache.txt.ts` | `QueryCacheResult` | Resource-specific table: cycles/recoveries/sleeps/workouts each have a 2-3 column compact rendering; profile is a single block; sync_runs uses the existing per-resource line format from sync.txt.ts; decisions reuses decision.txt.ts list rendering |
| `src/formatters/api-gap.txt.ts` | `ApiGapResult` | One line per `ApiGapEntry`: `<feature>: <whoop_consumer_path> — <notes>; closest proxy: <alternative_via_v2 or "none">` |

### D-26 contract test — banned-word lint on rendered output

The two-layer defense per ADR-0005 §Enforcement:

**Layer 1 (already in place):** `scripts/ci-grep-gates.sh` Gate A scans source files in `src/formatters/` + `src/cli/` + `tests/fixtures/review/`. Catches banned words at the source level.

**Layer 2 (NEW in Phase 4):** `tests/contract/formatter-tone.test.ts` runs each formatter on every fixture and re-checks the rendered output. Catches **generated content** that source-grep can't see (a catalog string concatenated into a template; a sanitized error message inadvertently echoing a banned token).

**Shape (Vitest + table-driven):**

```ts
const BANNED_WORDS = ['optimize','wellness','honor','journey','crush','nail','dial in','tune','vibe','unlock'];
const EMOJI_RE = /[\u{1F000}-\u{1FFFF}\u{2600}-\u{27BF}]/u;

const cases = [
  { formatter: renderDailyReview, fixtureDir: 'tests/fixtures/review/daily-*.json' },
  { formatter: renderWeeklyReview, fixtureDir: 'tests/fixtures/review/weekly-*.json' },
  { formatter: renderDecisionList, fixtureDir: 'tests/fixtures/decisions/decision-*.json' },
  // ... plus query-cache, api-gap, doctor, sync (existing formatters get retroactive coverage)
];

describe.each(cases)('formatter tone', ({ formatter, fixtureDir }) => {
  const fixtures = glob.sync(fixtureDir);
  it.each(fixtures)('%s renders without banned tokens', async (fixturePath) => {
    const input = JSON.parse(await fs.readFile(fixturePath, 'utf8'));
    const rendered = formatter(input);
    for (const word of BANNED_WORDS) {
      expect(rendered.toLowerCase()).not.toMatch(new RegExp(`\\b${word}\\b`));
    }
    expect(rendered).not.toMatch(EMOJI_RE);
  });
});
```

**Catalog lint extension** (D-09 + D-23): the same test file also iterates `actionCatalog` and `decisionPromptCatalog` entries and asserts each `entry.text` passes the same checks. This catches a future PR that adds a catalog entry with a banned word.

### MCP prompt instruction-copy lint

Per D-26 + D-27 — the 4 prompt instruction strings (the hardcoded "Based on this review, suggest..." text in each prompt file) must also pass banned-word lint. Add to the formatter-tone test:

```ts
const PROMPT_INSTRUCTIONS = [
  DAILY_DECISION_BRIEF_INSTRUCTION,
  WEEKLY_RECOVERY_INVESTIGATION_INSTRUCTION,
  EXPERIMENT_DESIGNER_INSTRUCTION,
  DELOAD_OR_TRAIN_INSTRUCTION,
];
it.each(PROMPT_INSTRUCTIONS)('prompt instruction %s passes tone lint', (text) => {
  // same banned-word + emoji checks
});
```

## Decision Ledger Persistence

### Phase 3 schema audit — does it satisfy DEC-01/02/03/04?

Read of `src/infrastructure/db/schema.ts:252-267`:

```ts
export const decisions = sqliteTable('decisions', {
  id: text('id').primaryKey(),                                    // ULID ✓ DEC-01
  created_at: text('created_at').notNull(),                       // timestamp ✓
  category: text('category').notNull(),                           // ✓ DEC-01
  decision: text('decision').notNull(),                           // ✓ DEC-01
  rationale: text('rationale'),                                   // ✓ DEC-01
  confidence: text('confidence', { enum: ['low','medium','high'] }), // ✓ DEC-01
  expected_effect: text('expected_effect'),                       // ✓ DEC-01
  follow_up_date: text('follow_up_date'),                         // ✓ DEC-01
  status: text('status', { enum: ['open','followed_up','abandoned'] })
    .notNull().default('open'),                                   // ✓ DEC-02
  outcome_notes: text('outcome_notes'),                           // ✓ DEC-02
});
```

**Verdict: SCHEMA IS COMPLETE.** Every DEC-01/02 column already shipped in Phase 3 Plan 03-02. CONTEXT D-22 ("Phase 4 adds zero new migrations") is correct.

**Repo audit:**

`src/infrastructure/db/repositories/decisions.repo.ts` ships with:
- `insert(d)` — DEC-01 ✓
- `byId(id)` ✓
- `listOpen()` — DEC-03 ✓ (newest-first ordering)

**Phase 4 must extend the repo** with:
- `updateOutcome(id: string, status: 'open'|'followed_up'|'abandoned', notes: string | null): void` — DEC-02 + D-20
- `countSince(date: string): number` — D-22 (returns count of decisions with `created_at >= date`)
- `findByPrefix(prefix: string): Decision[]` — D-20 (ULID prefix lookup for `decision update <id-or-prefix>`)
- `listAll(): Decision[]` — D-20 `--all` flag

All extensions follow the existing `db.transaction({behavior: 'immediate'})` pattern. **Type declaration:** extend `DecisionsRepo` interface in `src/infrastructure/db/repositories/decisions.repo.ts:18-36`.

**`findByPrefix` implementation note:** SQLite supports `WHERE id LIKE 'PREFIX%'` cheaply for primary-key prefix scans. Pass the prefix uppercased (ULID is uppercase Base32). Example:

```ts
findByPrefix(prefix: string): Decision[] {
  return db.select().from(decisionsTable)
    .where(sql`id LIKE ${prefix.toUpperCase() + '%'}`)
    .all().map(rowToDecision);
}
```

### Migration verdict

**Zero new migrations in Phase 4.** The CONTEXT D-22 caveat about a hypothetical `notes` column is moot — `outcome_notes` already exists in the shipped schema.

### `daily_summaries` first use

Phase 3 shipped the table empty (`createDailySummariesRepo` with `upsertOneDay` / `byDateRange` / `latestComputedAt`). **Phase 4 baseline service is the first writer.** Per the repo comment at line 1-13, "Phase 4 baseline service will call upsertOneDay() once per day at review-computation time."

Recommended pattern: the baseline service writes one row per SCORED non-DST-excluded day in the trailing-30 window as a memoization layer. Re-running `review daily` for the same `reviewed_date` is idempotent via the PK upsert. The table caches `recovery_score, sleep_efficiency_percentage, day_strain, respiratory_rate, hrv_rmssd_milli, resting_heart_rate, computed_at` — exactly the input slate for baseline aggregation.

**Performance check:** `byDateRange(start, end)` returns rows sorted by date ASC. Median + MAD computation is `O(N log N)` per metric × 6 metrics × N≈30 days = trivial (< 1ms). The daily_summaries cache is an optimization, not a correctness requirement — Phase 4 plans MAY skip writing to daily_summaries and compute directly from cycles+recovery+sleep repos. RECOMMEND: write to daily_summaries anyway for Phase 5 doctor data-quality signals + future export.

## ULID + Dependency Audit

### Does `ulid` need adding?

**Yes.** Not in current `package.json` (verified — see Read of `/Users/chris.bremmer/recovery-ledger/package.json:27-38` returns 10 dependencies, none are `ulid`).

### Pinned version

`ulid@^3.0.2` — latest published 2025-11-30, zero dependencies, ESM-compatible. [VERIFIED: `npm view ulid version` returned `3.0.2` on 2026-05-16; `npm view ulid dependencies` returned empty]

### Usage shape (per D-19)

```ts
// src/services/decision/index.ts
import { ulid } from 'ulid';
// or for monotonic-within-millisecond:
import { monotonicFactory } from 'ulid';
const ulidMonotonic = monotonicFactory();

// In addDecision service:
const id = ulid();  // crypto-strong randomness in the random component
// pass id to decisionsRepo.insert({ id, ... })
```

**Why `ulid` and not `crypto.randomUUID()`:** D-19 locked ULID. Lexicographic sortability is the load-bearing property — listing decisions by id is the same as listing by creation time. ULIDs are also URL-safe Crockford Base32, which prefix-matching against (D-20 short-prefix lookup) is easy: ULID time-component is the first 10 chars, so any 4-8 char prefix uniquely identifies a decision in any reasonably-sized ledger.

### Other dependency adds

| Need | Action |
|------|--------|
| Statistical primitives (median, MAD, rank-sum, normal CDF) | `simple-statistics@^7.8.9` (NEW) |
| BH-FDR | Hand-roll in `src/domain/stats/fdr.ts` (~25 LOC) |
| Mann-Whitney p-value | Hand-roll in `src/domain/stats/mann-whitney.ts` (~30 LOC) on top of `simple-statistics.wilcoxonRankSum` + `cumulativeStdNormalProbability` |
| ULID generation | `ulid@^3.0.2` (NEW) |
| Interactive readline for `decision review --interactive` | Node built-in `node:readline/promises` (NO new dep) |

### Total Phase 4 npm deps added: 2 (`ulid`, `simple-statistics`).

## Validation Architecture

> This section is REQUIRED — `.planning/config.json` has `workflow.nyquist_validation: true`.

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Vitest 4.1.6 (Phase 3 carry-forward, `pool: 'forks'`) |
| Config file | `vitest.config.ts` (existing) |
| Quick run command | `npx vitest run <file>` |
| Full suite command | `npm test` (alias for `vitest run`) |
| Suite-time budget | < 60 seconds (may grow to 90s per D-33; planner verifies) |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File |
|--------|----------|-----------|-------------------|------|
| REV-01 | Trailing-30 median + MAD over SCORED-only non-DST-excluded entities | unit | `npx vitest run src/domain/baselines` | ❌ Wave 0 — `src/domain/baselines/baseline.test.ts` |
| REV-02 | Confidence-tier gate (insufficient < 10, weak ≥ 10, strong ≥ 20+70%; Z refused < 14) | unit | `npx vitest run src/domain/confidence` | ❌ Wave 0 — `src/domain/confidence/index.test.ts` |
| REV-03 | `getDailyReview` returns documented schema with all D-03 slots | integration | `npx vitest run src/services/review/daily.test.ts` | ❌ Wave 0 |
| REV-04 | Daily review leads with data freshness (latest sync, baseline window, missing/stale) | contract | `npx vitest run tests/contract/daily-review-shape.test.ts` | ❌ Wave 0 |
| REV-05 | Insufficient data → states what's missing + declines | unit | `npx vitest run src/services/review/daily.test.ts` (fixture `daily-insufficient-days.json`) | ❌ Wave 0 |
| REV-06 | Weekly review surfaces worst-days + runs 5 candidate factors | integration | `npx vitest run src/services/review/weekly.test.ts` | ❌ Wave 0 |
| REV-07 | BH FDR @ q=0.10 across 5 candidates; "no reliable pattern" typed positive output | unit + contract | `npx vitest run src/domain/stats/fdr.test.ts src/domain/patterns/pattern.test.ts` | ❌ Wave 0 — load-bearing fixture `weekly-pattern-fdr-suppression.json` (see fixture sketch below) |
| REV-08 | Output tone passes banned-word CI lint; actions are verb-first single sentences | contract | `npx vitest run tests/contract/formatter-tone.test.ts` | ❌ Wave 0 |
| DEC-01 | `decision add` one-line happy path with ULID + smart defaults | integration | `npx vitest run src/cli/commands/decision-add.test.ts` | ❌ Wave 0 |
| DEC-02 | Decisions persist with `status` + `outcome_notes` | unit | `npx vitest run src/infrastructure/db/repositories/decisions.repo.test.ts` | ❌ Wave 0 — extend existing repo test file (currently empty) |
| DEC-03 | `decision review` lists open + elapsed-vs-window framing | integration | `npx vitest run src/cli/commands/decision-review.test.ts` | ❌ Wave 0 |
| DEC-04 | Weekly review prompts for decision when none in prior 7 days | unit | `npx vitest run src/services/review/weekly.test.ts` (fixture `weekly-decision-prompt-none-this-week.json`) | ❌ Wave 0 |
| MCP-01 | 8 tools registered (whoop_sync + 6 new + carry-forward whoop_doctor) | runtime attestation | `npx vitest run tests/integration/mcp-runtime.test.ts` | ❌ Wave 0 (extends existing Phase 3 attestation) |
| MCP-02 | Every tool returns `{structuredContent, content}` dual shape | contract | `npx vitest run tests/contract/mcp-tool-shape.test.ts` | ❌ Wave 0 |
| MCP-03 | Every MCP tool body ≤ 5 lines | static analysis | `npx vitest run tests/contract/mcp-shim-loc.test.ts` (NEW: parses tool files, counts non-blank non-comment lines in handler bodies) | ❌ Wave 0 |
| MCP-04 | 6 resources registered, refresh fresh from cache | runtime attestation + contract | `npx vitest run tests/integration/mcp-runtime.test.ts tests/contract/mcp-resource-shape.test.ts` | ❌ Wave 0 |
| MCP-05 | 4 prompts registered with `messages[]` shape | runtime attestation + contract | `npx vitest run tests/integration/mcp-runtime.test.ts tests/contract/mcp-prompt-shape.test.ts` | ❌ Wave 0 |
| MCP-06 | MCP tool error returns sanitized via FND-06 contract | contract | existing `src/mcp/sanitize.test.ts` covers; add Phase 4 specific fixtures | ⚠️ Existing file — extend in Wave 0 |

### Sampling Rate

- **Per task commit:** quick targeted run (`npx vitest run <changed-file>`)
- **Per wave merge:** full domain/services suite (`npx vitest run src/`)
- **Phase gate:** full suite green via `npm test` before `/gsd:verify-work`; runtime budget 60-90s per D-33

### Wave 0 Gaps (test files to create)

- `tests/fixtures/review/daily-strong-confidence.json`
- `tests/fixtures/review/daily-weak-confidence.json`
- `tests/fixtures/review/daily-insufficient-days.json` (REV-05 fixture: 8 SCORED days)
- `tests/fixtures/review/daily-no-anomalies.json`
- `tests/fixtures/review/daily-three-anomalies-capped.json` (D-08 catalog selection cap)
- `tests/fixtures/review/weekly-pattern-clears-fdr.json`
- `tests/fixtures/review/weekly-pattern-fdr-suppression.json` (REV-07 load-bearing — see fixture sketch below)
- `tests/fixtures/review/weekly-no-pattern-insufficient-window.json` (n < 14 in pattern test window)
- `tests/fixtures/review/weekly-decision-prompt-none-this-week.json` (D-22 / DEC-04)
- `tests/fixtures/decisions/decision-add-happy-path.json`
- `tests/fixtures/decisions/decision-review-list.json`
- `tests/fixtures/decisions/decision-review-interactive-update.json`
- `tests/fixtures/mcp/whoop-daily-review/<scenario>.json` × 4
- `tests/fixtures/mcp/whoop-weekly-review/<scenario>.json` × 4
- `tests/fixtures/mcp/whoop-query-cache/<resource>-<scenario>.json` × 8
- `tests/fixtures/mcp/whoop-add-decision/<scenario>.json` × 3
- `tests/fixtures/mcp/whoop-review-decisions/<mode>-<scenario>.json` × 4
- `tests/fixtures/mcp/whoop-api-gap/<scenario>.json` × 1
- `tests/contract/formatter-tone.test.ts` (D-26)
- `tests/contract/mcp-tool-shape.test.ts` (MCP-02)
- `tests/contract/mcp-resource-shape.test.ts` (MCP-04)
- `tests/contract/mcp-prompt-shape.test.ts` (MCP-05)
- `tests/contract/mcp-shim-loc.test.ts` (MCP-03)
- `tests/contract/daily-review-shape.test.ts` (REV-03/04)
- `src/domain/stats/median.test.ts`
- `src/domain/stats/mad.test.ts` (worked examples; 1.4826 consistency)
- `src/domain/stats/mann-whitney.test.ts` (worked examples from Hollander & Wolfe / Wikipedia table)
- `src/domain/stats/fdr.test.ts` (worked examples from Benjamini & Hochberg 1995)
- `src/domain/baselines/baseline.test.ts`
- `src/domain/anomalies/anomaly.test.ts`
- `src/domain/anomalies/direction.test.ts` (one assert per metric direction entry)
- `src/domain/patterns/pattern.test.ts`
- `src/domain/patterns/candidates.test.ts`
- `src/domain/actions/catalog.test.ts` (one assert per entry: verb-first + length + banned-word)
- `src/domain/actions/decision-prompts.test.ts`
- `src/domain/confidence/index.test.ts`
- `src/services/review/daily.test.ts`
- `src/services/review/weekly.test.ts`
- `src/services/review/resolve-date.test.ts`
- `src/services/decision/index.test.ts`
- `src/services/cache/index.test.ts`
- `src/services/api-gap/index.test.ts`
- `src/cli/commands/review-daily.test.ts`
- `src/cli/commands/review-weekly.test.ts`
- `src/cli/commands/decision-add.test.ts`
- `src/cli/commands/decision-review.test.ts`
- `src/cli/commands/decision-update.test.ts`
- `src/cli/commands/query.test.ts`
- `src/cli/commands/api-gap.test.ts`
- `src/formatters/daily-review.txt.test.ts`
- `src/formatters/weekly-review.txt.test.ts`
- `src/formatters/decision.txt.test.ts`
- `src/formatters/query-cache.txt.test.ts`
- `src/formatters/api-gap.txt.test.ts`

### REV-07 fixture sketch (the load-bearing one)

**Goal:** 5 candidate factors → 5 p-values where the smallest p_raw ≈ 0.05 (unadjusted-significant) but BH @ q=0.10 with m=5 → critical value at smallest position is `(1/5)·0.10 = 0.02` → NO candidates clear FDR → returns `{pattern: {kind: 'no_pattern', reason: 'no_factor_cleared_fdr'}}`.

**Fixture construction (28 SCORED days, ~70% coverage of 28d window):**

- 28 SCORED + 12 PENDING/UNSCORABLE = 40 total cycles in window (illustrative; pattern code only consumes the 28 SCORED)
- Worst quartile: floor(28/4) = 7 worst days (recovery_score ≈ 30-45)
- Other: 21 days (recovery_score ≈ 55-85)

**Per-candidate engineered p-values** (constructed so MW with continuity correction lands at the target p):

| Candidate | Engineered direction | Target p_raw |
|-----------|---------------------|--------------|
| `sleep_duration_prior_night` | worst-day sleep 10-15 min shorter | ~0.05 |
| `sleep_debt_3d_rolling` | mild | ~0.20 |
| `day_strain_prior_day` | flat | ~0.45 |
| `workout_timing_late_evening` | rare events | ~0.60 |
| `hrv_delta_prior_day` | mild | ~0.30 |

Apply BH: sorted `[0.05, 0.20, 0.30, 0.45, 0.60]`; thresholds `[0.02, 0.04, 0.06, 0.08, 0.10]`. Walk down k=5..1: all p > threshold at every k. kStar = -1. **No factor clears.** Result: `{kind: 'no_pattern', reason: 'no_factor_cleared_fdr'}` with `candidate_results` listing all 5 in unranked-context per ADR-0004.

The fixture is a JSON serialization of the 28 cycles + 28 recoveries + 28 sleeps with engineered prior-night sleep durations on worst-vs-other days. Plan task should include a small script to **generate** the fixture deterministically from the engineering parameters above — easier to maintain than hand-edited JSON. RECOMMEND: fixture-generator under `tests/fixtures/review/_generators/` that writes the JSON; commit both the generator and the output JSON. Future tunability (e.g., a re-run with different q) reuses the generator.

### REV-05 fixture sketch (insufficient case)

**Goal:** 8 SCORED days in baseline window → all `ZAnalysis.kind === 'refused'` (because 8 < 14), no actions ([]), confidence === 'insufficient', `insufficient_reason` populated.

**Fixture:** 8 SCORED cycles with normal-looking recovery + 22 PENDING/UNSCORABLE cycles in the 30-day window. Today's measurement is one of the 8.

**Assertions:**

```ts
expect(result.confidence.tier).toBe('insufficient');
expect(result.confidence.sampleSize).toBe(8);
expect(result.confidence.minRequired).toBe(10);
expect(result.insufficient_reason).toMatch(/8 SCORED days/);
expect(result.anomalies).toEqual([]);
expect(result.actions).toEqual([]);
expect(result.today_state.recovery_score).toBeGreaterThan(0); // today's data is still surfaced
```

### MCP attestation tests (D-29 transition)

Phase 3 D-33 attestation `tools.length === 1` BREAKS in Phase 4. Plan 02-08's G-03 runtime attestation file (`tests/integration/...`) gets updated in Phase 4's first MCP plan:

```ts
// Before (Phase 3): expect(toolsListResult.tools).toHaveLength(1)
// After (Phase 4):
expect(toolsListResult.tools).toHaveLength(8);
// + name set assertion (see MCP Surface section above)
// + resourcesListResult.resources.length === 6
// + promptsListResult.prompts.length === 4
```

**Gate H** (NEW per D-33): `scripts/ci-grep-gates.sh` adds a check that `\btools\.length\s*===\s*1\b` does NOT appear outside `tests/__legacy__/`. Catches a regression that re-introduces the old assertion.

### MCP-03 ≤5-line shim attestation

Static-analysis test reads each `src/mcp/tools/<tool>.ts` file, finds the `register(...)` call, and asserts the arrow-function body (between `async (input) => {` and the matching `}`) contains ≤5 non-blank non-comment statements. Existing `whoop-doctor.ts:63-69` is the precedent — 4 statements (the `const result =` + the return).

Implementation hint: use TypeScript compiler API or just parse heuristically with regex + line-count of statements; the test file is throwaway, doesn't need to be robust to edge cases.

## Pitfalls & Landmines

### Pitfall 1: Tie-breaking in bottom-quartile selection (D-13)

**Risk:** Two days have identical `recovery_score`. Naive sort puts them in arbitrary order; chronological tie-break per D-13 ("keep the chronologically-earlier day in the worst set") is the spec.

**Mitigation:** explicit secondary sort key:

```ts
const ascending = cycles
  .slice()
  .sort((a, b) =>
    a.recoveryScore - b.recoveryScore ||  // primary: recovery ASC
    a.start.localeCompare(b.start)         // tie-break: chronologically earlier first
  );
const worst = ascending.slice(0, Math.max(2, Math.floor(N / 4)));
```

**Test:** fixture with two days at recovery_score=42; assert the earlier day is in `worst[]`.

### Pitfall 2: Mann-Whitney small-sample edge

**Risk:** At n_1 = 3 worst-days vs n_2 = 11 other-days (the minimum allowed by D-13's N≥14 floor), normal approximation is questionable. Mean+std under H_0 still hold, but the discrete distribution of U has only ~120 possible values — p-values lie on a coarse grid.

**Mitigation:** document the floor decision (D-13's "N_scored ≥ 14" is the spec; bumping to ≥ 20 would buy statistical power but isn't in scope). Surface the sample size in `pattern.statistic` so the user can self-vet. Fixture test must use n ≥ 20 to ensure approximation validity.

**Recommend:** add a `confidence.tier === 'weak'` annotation to weekly results when 14 ≤ N_scored < 20 (pattern_test_window confidence, distinct from baseline confidence). Planner to decide whether to extend the `WeeklyReviewResult.confidence` slot or add a separate `pattern_confidence`.

### Pitfall 3: DST/tz exclusion contract

**Risk:** Phase 3 D-14 + D-16 ship `cycles.baseline_excluded` + `cycles.exclusion_reason`. Phase 4 baseline + pattern + anomaly code must filter these out by default. **The cycles repo already does this** (`includeExcluded: false` default per `src/domain/types/repos.ts:23`).

**Surface contract:** every Phase 4 read that goes through `cyclesRepo.byRange()` / `recoveriesRepo.byRange()` / `sleepsRepo.byRange()` / `workoutsRepo.byRange()` gets SCORED-only AND non-baseline-excluded automatically.

**Override:** only `whoop_query_cache` per D-24's `includeUnscored` / `includeExcluded` flags.

**Test:** baseline test fixture must include 1 cycle with `baseline_excluded = 1` AND assert it does NOT appear in the trailing-30 baseline numbers.

### Pitfall 4: `latest_synced_at` lookup for data-freshness lead

**Source:** `sync_runs.finished_at` MAX per `data_status.latest_sync_at` field (D-03 + D-16).

**Edge case:** if no sync has ever run (fresh install), `latest_sync_at = null`. The formatter must render this as "never synced" or similar — not crash.

**Repo:** `syncRunsRepo` is wired in `bootstrap.ts:154`. Extend with `latestFinished(): {finished_at: string, status: SyncStatus} | null` if not already present (audit at plan time).

### Pitfall 5: Mixed-recency Z-refusal (per-metric vs. per-window)

**Risk:** the trailing-30 baseline window has 22 SCORED days, but only 12 of them are in the last 14 days. Per REV-02 + D-13, Z-score for THAT metric must be refused (< 14 days).

**The gate is per-metric, not per-window.** Each metric (recovery_score, hrv_rmssd_milli, etc.) has its own `daysAvailable` count — it's possible for sleep to have 22 days available while HRV only has 12 (one row had `score_state = SCORED` but `hrv_rmssd_milli = null` per WHOOP — defensively null-check).

**Mitigation:** in `src/domain/anomalies/anomaly.ts`, per-metric data assembly:

```ts
// For each metric:
const metricDaysAvailable = trailing30Cycles
  .map(c => extractMetric(c, metric))
  .filter(v => v !== null && Number.isFinite(v))
  .length;
if (metricDaysAvailable < 14) {
  return { kind: 'refused', reason: 'insufficient_days', daysAvailable: metricDaysAvailable, daysRequired: 14 };
}
```

**Test:** fixture with 22 SCORED cycles where HRV is null on 10 of them → HRV `ZAnalysis.kind === 'refused'`; recovery_score (present on all 22) returns `kind: 'computed'`.

### Pitfall 6: "No reliable pattern" as typed result (ADR-0004 forcing function)

**Risk:** A future plan returns `pattern: null` or `pattern: undefined` from `getWeeklyReview` when no factor clears FDR. The forcing function from ADR-0004 + D-16 requires `{kind: 'no_pattern', reason: …}` — typed positive output.

**Mitigation:** TypeScript discriminated union in `src/domain/patterns/pattern.ts`:

```ts
export type WeeklyPattern =
  | { kind: 'detected'; factor: CandidateName; statistic: {U,p_raw,p_adjusted}; direction: 'worst_days_had_lower'|'worst_days_had_higher' }
  | { kind: 'no_pattern'; reason: 'insufficient_window_days' | 'no_factor_cleared_fdr' | 'all_candidates_refused' };
```

Domain code returning `null` doesn't compile. Renderer destructures via exhaustive switch — adding a fourth `kind` triggers a TS error at the renderer.

**Test:** the formatter test for `weekly-no-pattern-insufficient-window.json` asserts the rendered output contains the reason string, not an empty section.

### Pitfall 7: SCORED-only filter on `whoop_query_cache` opt-out

**Risk:** D-24's `includeUnscored: true` / `includeExcluded: true` are the only escape hatches. A future plan forgets to plumb these flags and silently returns SCORED-only data even when the user asked for everything.

**Mitigation:** the typed discriminated union per resource in D-24 has `includeUnscored?: boolean` only on resources where it applies (cycles, recoveries, sleeps, workouts) — `profile` and `body_measurements` don't have score_state. The Zod schema for `QueryCacheInput` enforces this.

**Test:** `tests/contract/mcp-tool-shape.test.ts` includes a `whoop_query_cache` fixture with `includeUnscored: true` AND asserts the result `count` ≥ the same fixture's SCORED-only count.

### Pitfall 8: `daily_summaries` upsert race

**Risk:** Two `review daily` invocations against the same `reviewed_date` concurrently. Phase 3 D-01 SQLite WAL + `busy_timeout=5000` handles concurrent writes, but the upsert pattern must be idempotent (`ON CONFLICT (date) DO UPDATE`).

**Mitigation:** the repo already uses `onConflictDoUpdate(target: dailySummariesTable.date, set: …)` per `daily-summaries.repo.ts:50-62`. Phase 4 baseline service just calls `upsertOneDay`; it's idempotent. **No special handling needed.**

### Pitfall 9: ADR-0001 stdout purity for MCP-reachable code

**Risk:** Phase 4 adds domain math + services + formatters — all MCP-reachable. A `console.log` for debug breaks stdio framing.

**Mitigation:** Gate B (existing) bans `console.*` outside `src/cli/**`. Phase 4 code uses Pino → stderr (`logger.warn(...)` etc.).

**Plan reminder:** every Phase 4 service file imports `logger` from `src/infrastructure/config/logger.js`; calls `logger.info({event, ...})` for structured ops logs; never inlines raw decision text or user data (Pitfall 17 carry-forward from earlier phases).

### Pitfall 10: ReadLine prompt corruption in `decision review --interactive`

**Risk:** `decision review --interactive` uses `node:readline/promises` to prompt for outcome status + notes. If we accidentally write prompts to stdout, they interleave with the structured rendering.

**Mitigation:** prompts go to stderr (`process.stderr.write` or readline configured with `output: process.stderr`); structured rendering goes to stdout. CLI is exempt from ADR-0001 but the discipline still matters for the `--interactive` flow specifically. NOT exposed through MCP (per D-20).

**Test:** stdin-injection test for the interactive flow — feed `followed_up\nworked well\n` to stdin, assert stdout contains the updated decision rendering, stderr contains the prompts.

### Pitfall 11: ULID prefix collision in `decision update <prefix>`

**Risk:** D-20 short-prefix lookup — if two decisions share a 4-char prefix, the command must error "ambiguous prefix".

**Mitigation:** `decisionsRepo.findByPrefix(prefix)` returns all matches. CLI:

```ts
const matches = repo.findByPrefix(prefix);
if (matches.length === 0) { /* exit 1 no_match */ }
if (matches.length > 1) {
  // print all matches; exit 1 ambiguous_prefix
}
const decision = matches[0];
```

**Test:** fixture with two decisions whose ids both start with `01HK7` → `decision update 01HK7 --status followed_up` exits 1 with the ambiguous-prefix message listing both.

### Pitfall 12: MAD = 0 (constant-value baseline)

Covered above in Statistical Engine §1. Add to `ZAnalysis` discriminated union a `baseline_mad_zero` refused variant. Document in domain code that this is rare but expected for low-variance metrics (respiratory_rate quantized to 0.1 bpm increments).

### Pitfall 13: Banned-word lint false positives on metric names

**Risk:** "respiratory_rate" or other column names contain substrings that overlap with banned words (none do for our list — verified). Future schema additions might.

**Mitigation:** the banned-word lint uses `\b<word>\b` word-boundary matching per `scripts/ci-grep-gates.sh:96`. Substrings inside `_` or camelCase don't match. **No action needed in Phase 4** for the locked metric set, but document the discipline for future additions.

## File Boundaries

> Canonical new-file list. Layer + LOC budget + Phase 1-3 analog.

### Domain layer (pure)

| File | Layer | LOC budget | Phase 1-3 analog |
|------|-------|-----------|-------------------|
| `src/domain/stats/median.ts` | domain/stats | ~10 LOC (re-export simple-statistics + types) | — |
| `src/domain/stats/mad.ts` | domain/stats | ~15 LOC | — |
| `src/domain/stats/mann-whitney.ts` | domain/stats | ~40 LOC | — |
| `src/domain/stats/fdr.ts` | domain/stats | ~30 LOC | — |
| `src/domain/baselines/index.ts` | domain | ~80 LOC | `src/domain/normalize/*` shape (Phase 3) |
| `src/domain/baselines/types.ts` | domain/types | ~30 LOC | `src/domain/types/score.ts` (Phase 3) |
| `src/domain/anomalies/anomaly.ts` | domain | ~60 LOC | — |
| `src/domain/anomalies/direction.ts` | domain | ~30 LOC (module-load constant per D-06) | `src/domain/dst-tz/index.ts` shape (Phase 3) |
| `src/domain/anomalies/types.ts` | domain/types | ~40 LOC | `src/domain/types/score.ts` (Phase 3) |
| `src/domain/patterns/pattern.ts` | domain | ~120 LOC | — |
| `src/domain/patterns/candidates.ts` | domain | ~50 LOC (module-load constant per D-11) | — |
| `src/domain/patterns/types.ts` | domain/types | ~40 LOC | — |
| `src/domain/confidence/index.ts` | domain | ~40 LOC | — |
| `src/domain/confidence/types.ts` | domain/types | ~20 LOC | — |
| `src/domain/actions/catalog.ts` | domain | ~80 LOC (D-08 + D-09 catalog data) | — |
| `src/domain/actions/decision-prompts.ts` | domain | ~60 LOC (D-23 catalog data) | — |
| `src/domain/actions/select.ts` | domain | ~30 LOC | — |
| `src/domain/review/types.ts` | domain/types | ~80 LOC (D-03 + D-16 result shapes) | `src/domain/types/sync.ts` (Phase 3) |

**Domain subtotal:** ~860 LOC across 18 files.

### Services layer (orchestration)

| File | Layer | LOC budget | Phase 1-3 analog |
|------|-------|-----------|-------------------|
| `src/services/review/daily.ts` | services | ~150 LOC | `src/services/sync/index.ts` (Phase 3) |
| `src/services/review/weekly.ts` | services | ~180 LOC | `src/services/sync/index.ts` (Phase 3) |
| `src/services/review/resolve-date.ts` | services | ~50 LOC | — |
| `src/services/review/data-status.ts` | services | ~80 LOC | — |
| `src/services/decision/index.ts` | services | ~100 LOC | — |
| `src/services/decision/types.ts` | services/types | ~40 LOC | — |
| `src/services/cache/index.ts` | services | ~120 LOC (8-resource dispatch) | — |
| `src/services/cache/types.ts` | services/types | ~80 LOC (D-24 typed union) | — |
| `src/services/api-gap/index.ts` | services | ~30 LOC | — |
| `src/services/api-gap/data.ts` | services | ~80 LOC (6+ entries per D-28) | — |
| `src/services/index.ts` | services barrel | EXTEND: ~30 LOC added (re-exports + types) | existing |
| `src/services/bootstrap.ts` | services | EXTEND: ~20 LOC added (wire 6 new services to Bootstrapped.services) | existing |

**Services subtotal:** ~960 LOC across 12 files (10 new + 2 extended).

### MCP layer (≤5-line shims)

| File | Layer | LOC budget | Phase 1-3 analog |
|------|-------|-----------|-------------------|
| `src/mcp/index.ts` | mcp entry | EXTEND: switch from createServices() to bootstrap() + register 7 tools + 6 resources + 4 prompts; ~40 LOC | existing |
| `src/mcp/register.ts` | mcp wrapper | UNMODIFIED (D-30) | existing |
| `src/mcp/register-resource.ts` | mcp wrapper | ~60 LOC (new — mirrors register.ts) | `register.ts` |
| `src/mcp/register-prompt.ts` | mcp wrapper | ~60 LOC | `register.ts` |
| `src/mcp/sanitize.ts` | mcp | UNMODIFIED (D-30) | existing |
| `src/mcp/tools/whoop-sync.ts` | mcp/tools | ~50 LOC | `whoop-doctor.ts` |
| `src/mcp/tools/whoop-daily-review.ts` | mcp/tools | ~50 LOC | `whoop-doctor.ts` |
| `src/mcp/tools/whoop-weekly-review.ts` | mcp/tools | ~50 LOC | `whoop-doctor.ts` |
| `src/mcp/tools/whoop-query-cache.ts` | mcp/tools | ~80 LOC (D-24 typed dispatch) | `whoop-doctor.ts` |
| `src/mcp/tools/whoop-add-decision.ts` | mcp/tools | ~50 LOC | `whoop-doctor.ts` |
| `src/mcp/tools/whoop-review-decisions.ts` | mcp/tools | ~60 LOC (dual-mode per D-21) | `whoop-doctor.ts` |
| `src/mcp/tools/whoop-api-gap.ts` | mcp/tools | ~40 LOC | `whoop-doctor.ts` |
| `src/mcp/resources/summary-today.ts` | mcp/resources | ~30 LOC | — |
| `src/mcp/resources/summary-week.ts` | mcp/resources | ~30 LOC | — |
| `src/mcp/resources/baseline-30d.ts` | mcp/resources | ~30 LOC | — |
| `src/mcp/resources/data-quality.ts` | mcp/resources | ~30 LOC | — |
| `src/mcp/resources/api-gaps.ts` | mcp/resources | ~30 LOC | — |
| `src/mcp/resources/decisions-open.ts` | mcp/resources | ~30 LOC | — |
| `src/mcp/prompts/build.ts` | mcp/prompts | ~30 LOC | — |
| `src/mcp/prompts/daily-decision-brief.ts` | mcp/prompts | ~40 LOC | — |
| `src/mcp/prompts/weekly-recovery-investigation.ts` | mcp/prompts | ~40 LOC | — |
| `src/mcp/prompts/experiment-designer.ts` | mcp/prompts | ~50 LOC | — |
| `src/mcp/prompts/deload-or-train.ts` | mcp/prompts | ~50 LOC | — |

**MCP subtotal:** ~960 LOC across 23 files (21 new + 2 extended).

### CLI layer (≤5-line shims)

| File | Layer | LOC budget | Phase 1-3 analog |
|------|-------|-----------|-------------------|
| `src/cli/index.ts` | cli entry | EXTEND: wire review/decision/query/api-gap subcommands; ~80 LOC added | existing |
| `src/cli/commands/review-daily.ts` | cli/commands | ~120 LOC | `sync.ts` |
| `src/cli/commands/review-weekly.ts` | cli/commands | ~120 LOC | `sync.ts` |
| `src/cli/commands/decision-add.ts` | cli/commands | ~150 LOC (parseFollowUp validator + parseConfidence) | `sync.ts` |
| `src/cli/commands/decision-review.ts` | cli/commands | ~180 LOC (readline --interactive flow) | `sync.ts` |
| `src/cli/commands/decision-update.ts` | cli/commands | ~120 LOC (prefix-lookup error arms) | `sync.ts` |
| `src/cli/commands/query.ts` | cli/commands | ~180 LOC (per-resource flag dispatch) | `sync.ts` |
| `src/cli/commands/api-gap.ts` | cli/commands | ~80 LOC | `sync.ts` |

**CLI subtotal:** ~1030 LOC across 8 files (7 new + 1 extended).

### Formatters layer (pure renderers)

| File | Layer | LOC budget | Phase 1-3 analog |
|------|-------|-----------|-------------------|
| `src/formatters/daily-review.txt.ts` | formatters | ~200 LOC | `sync.txt.ts` |
| `src/formatters/weekly-review.txt.ts` | formatters | ~250 LOC | `sync.txt.ts` |
| `src/formatters/decision.txt.ts` | formatters | ~180 LOC (3 dispatch shapes: list/detail/update) | `sync.txt.ts` |
| `src/formatters/query-cache.txt.ts` | formatters | ~200 LOC (per-resource sub-renderers) | `sync.txt.ts` |
| `src/formatters/api-gap.txt.ts` | formatters | ~80 LOC | `sync.txt.ts` |

**Formatters subtotal:** ~910 LOC across 5 files.

### Infrastructure layer (DB)

| File | Layer | LOC budget | Phase 1-3 analog |
|------|-------|-----------|-------------------|
| `src/infrastructure/db/repositories/decisions.repo.ts` | infra | EXTEND: add updateOutcome, countSince, findByPrefix, listAll; ~80 LOC added | existing |

**Infrastructure subtotal:** ~80 LOC added (1 extended).

### Tests + fixtures (Wave 0 + per-plan)

Already enumerated in Validation Architecture §Wave 0 Gaps — ~50 new test files + fixtures.

### Scripts + CI

| File | Layer | LOC budget | Notes |
|------|-------|-----------|-------|
| `scripts/ci-grep-gates.sh` | ci | EXTEND: Gate H (no `tools.length === 1` outside `tests/__legacy__/`); ~15 LOC added | existing |

### Project Constraints (from CLAUDE.md / AGENTS.md)

- **Branch policy:** every Phase 4 change goes through worktree + branch + PR + explicit user approval. Phase 0 `.planning/**` carve-out expired at Phase 1.
- **ADR-0001 stdout purity:** no `console.*` outside `src/cli/**`; no `process.stdout.write` outside `src/cli/commands/**/*.ts`.
- **ADR-0003 SCORED-only:** every Phase 4 domain read must filter `score_state = 'SCORED'` by default; only `whoop_query_cache` per D-24 opts out.
- **ADR-0004 typed no-pattern:** every "absent result" must be a tagged variant, not null / [].
- **ADR-0005 banned tone words:** `optimize wellness honor journey crush nail dial in tune vibe unlock`, no emoji — enforced source-level (Gate A) + rendered-output (D-26 contract test).
- **ADR-0006 fixture-only tests:** MSW for any WHOOP call; no live API.
- **ADR-0007 read-only WHOOP:** GET-only; carries forward via `whoop_sync` shim.
- **GSD workflow enforcement:** no direct repo edits outside a GSD command without explicit user approval.
- **No skipping hooks** unless user explicitly requests (`--no-verify` is banned).
- **No default exports** (conventions.md).
- **Strict TS** (conventions.md).
- **Vitest `pool: 'forks'`** for better-sqlite3 native handles (conventions.md).

## Sources

### Primary (HIGH confidence)

- `@modelcontextprotocol/sdk` v1.29.0 — npm registry verified 2026-05-16 [`npm view @modelcontextprotocol/sdk version`]
- `ulid` v3.0.2 — npm registry verified 2026-05-16; zero dependencies [`npm view ulid version` + `npm view ulid dependencies`]
- `simple-statistics` v7.8.9 — npm registry verified 2026-05-16; exports `median`, `medianAbsoluteDeviation`, `wilcoxonRankSum`, `cumulativeStdNormalProbability` [simple-statistics.github.io/docs/]
- MCP TypeScript SDK Server Guide — `registerResource` static-URI signature + `registerPrompt` messages-array shape [github.com/modelcontextprotocol/typescript-sdk/blob/main/docs/server.md, fetched 2026-05-16]
- Phase 3 schema (`src/infrastructure/db/schema.ts:252-267`) — verifies the `decisions` table has all DEC-01/02 columns shipped
- Phase 3 repos (`src/infrastructure/db/repositories/decisions.repo.ts` + `daily-summaries.repo.ts`) — verifies the repo surface gaps Phase 4 must fill
- Phase 1 `register.ts` (`src/mcp/register.ts`) — the canonical tool wrapper precedent (D-09 + Gate D)
- Phase 3 `sync.ts` CLI shim (`src/cli/commands/sync.ts:146-209`) — the canonical ≤5-line shim precedent with validation arms + exit-code constants

### Secondary (MEDIUM confidence)

- Mann-Whitney U test — Wikipedia, accessed 2026-05-16 — formulas for U conversion, normal approximation, continuity correction
- Benjamini-Hochberg FDR — Wikipedia + statsmodels reference implementation — step-up procedure + adjusted p-value computation
- Rousseeuw & Croux (1993) — JASA 88(424) — the 1.4826 MAD consistency-scaling factor (REV-01 explicit requirement)

### Tertiary (LOW confidence — flagged for plan-time verification)

- Exact npm download counts for `ulid` and `simple-statistics` — listed as "very high" without specific numbers
- `simple-statistics` install footprint — assumed ~90KB; verify with `du -sh node_modules/simple-statistics` post-install
- `mathjs` rejected as "multi-MB"; specific size not verified at research time

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `simple-statistics@^7.8.9` is ~90KB unpacked, zero deps | Standard Stack | Low — alternative is hand-rolling ~50 LOC of median/MAD/rank-sum primitives, no schedule impact |
| A2 | `simple-statistics` exports `cumulativeStdNormalProbability(z)` returning Phi(z) | Statistical Engine §4 | Medium — if absent, hand-roll Abramowitz & Stegun rational approximation (~10 LOC); verify at Wave 0 plan time |
| A3 | Commander 14's `.command('decision').command('add <text>')` nested-subcommand pattern is stable | CLI Surface | Low — Commander has supported this since v6+; v14 docs confirm |
| A4 | MCP SDK `registerResource` accepts static URI strings (not just `ResourceTemplate`) | MCP Surface | Medium — if only `ResourceTemplate` is accepted in v1.29.0, all 6 resources need wrapping in templates with empty parameter lists. Verify at Wave 0 by reading installed `node_modules/@modelcontextprotocol/sdk/dist/esm/server/mcp.d.ts` |
| A5 | MCP SDK `registerPrompt` `argsSchema` accepts a Zod schema directly | MCP Surface | Low — confirmed via the SDK README example; v1.29.0 behavior verified by reading example code |
| A6 | n_1 = 3, n_2 = 11 Mann-Whitney normal-approximation accuracy is "acceptable" | Pitfalls §2 | Medium — if planner decides this is too coarse, bump D-13 floor to N_scored ≥ 20. Decision rests with the user (this is a scope-touching choice). |
| A7 | `daily_summaries` memoization is an optimization, not a correctness requirement | Decision Ledger §`daily_summaries` first use | Low — plans MAY skip the cache; baseline math is O(N log N) over ~30 days = sub-ms |
| A8 | The REV-07 fixture in CONTEXT (`[0.01, 0.04, 0.05, 0.20, 0.50]` at q=0.10) does NOT actually exercise BH downgrading | Statistical Engine §5 | HIGH — recommend planner use the corrected fixture `[0.05, 0.20, 0.30, 0.45, 0.60]` instead. If the original fixture is intended, the REV-07 success criterion ("p=0.05 false positive that FDR correctly downgrades") is mathematically inconsistent with q=0.10/m=5. Flag for user confirmation. |
| A9 | Extending the `register.ts` wrapper pattern to resources + prompts (`register-resource.ts` + `register-prompt.ts`) is in-scope for Phase 4 | MCP Surface §RECOMMENDATION | Medium — adds 2 files + 2 grep gates to D-33 close. Planner should weigh against scope. Falling back to direct `server.registerResource` / `server.registerPrompt` calls still works but loses the sanitizer discipline. |
| A10 | Phase 4 MCP entry switches from `createServices()` to `bootstrap()` | CLI Surface §`Bootstrapped.services` extension | Low — additive change to `src/mcp/index.ts`; the only risk is the boot path now opens a DB handle (slows MCP startup by ~10ms; bounded). |

## Open Questions

1. **Should the D-13 N_scored floor stay at 14 or bump to 20?**
   - What we know: 14 is the spec floor; ≥20 is the "strong" baseline tier; at n_1=3 vs n_2=11 the MW normal approximation degrades.
   - What's unclear: whether the planner has authority to bump this without user re-discussion.
   - Recommendation: surface as an open question to the user in discuss-phase OR have the planner add a `pattern_confidence: weak|strong` slot that flags weak-tier pattern results (preserves spec floor while warning the user when n is small).

2. **REV-07 fixture: original numbers or corrected?**
   - What we know: the CONTEXT D-15 fixture `[0.01, 0.04, 0.05, 0.20, 0.50]` REJECTS at kStar=3 under standard BH step-up; "p=0.05 false positive correctly downgraded" doesn't match.
   - What's unclear: whether D-15 intended a different procedure (Bonferroni? per-comparison adjustment?) or the fixture numbers are illustrative-only and the real test should be hand-engineered.
   - Recommendation: planner uses the corrected fixture `[0.05, 0.20, 0.30, 0.45, 0.60]` for the load-bearing REV-07 test; keeps the CONTEXT D-15 numbers as a separate test case for the "BH-rejects-some-but-not-all" path.

3. **Resource + prompt sanitizer wrapper — in scope or defer?**
   - What we know: extending the wrapper pattern adds 2 files (~120 LOC) + 2 grep gates; without it, resources/prompts call `server.registerResource` / `server.registerPrompt` directly.
   - What's unclear: whether the consistency-with-tool-wrapper benefit outweighs the scope add.
   - Recommendation: include in the first MCP-touching plan as a wave-0 task; deferring it means re-doing the discipline in Phase 5+.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js ≥22.11 | runtime | ✓ | — | none — engines field |
| npm | install | ✓ | — | none |
| TypeScript ≥5.7 | dev/build | ✓ | — | none |
| Vitest ≥4.1.6 | test | ✓ | — | none |
| Biome ≥2.4.15 | lint | ✓ | — | none |
| @modelcontextprotocol/sdk@^1.29.0 | runtime | ✓ in package.json | 1.29.0 | none |
| commander@^14.0.3 | runtime | ✓ in package.json | 14.0.3 | none |
| drizzle-orm@^0.45.2 | runtime | ✓ in package.json | 0.45.2 | none |
| zod@^4.4.3 | runtime | ✓ in package.json | 4.4.3 | none |
| ulid@^3.0.2 | runtime | ✗ — NEW IN PHASE 4 | — | hand-roll Crockford Base32 encoder (~80 LOC) |
| simple-statistics@^7.8.9 | runtime | ✗ — NEW IN PHASE 4 | — | hand-roll median + MAD + rank-sum (~50 LOC) |

**Missing dependencies with no fallback:** none.
**Missing dependencies with fallback:** `ulid`, `simple-statistics` — both have viable hand-roll alternatives if any concern arises (slopcheck flag, license issue). Default plan: install both.

## Metadata

**Confidence breakdown:**

- Standard stack (ulid + simple-statistics + already-installed deps): HIGH — both new packages verified on npm registry with version + zero-deps confirmed
- Statistical math: HIGH on formulas (sourced from canonical papers + Wikipedia); MEDIUM on small-sample edge cases (A6 flagged)
- MCP SDK API: HIGH on tool wrapper (Phase 1 precedent); MEDIUM on resource + prompt APIs (verified via SDK docs but not by reading installed `.d.ts` directly — recommend Wave 0 task)
- CLI Commander idioms: HIGH (verified via Phase 3 sync.ts precedent + Commander v14 docs)
- Schema audit (DEC-01/02 already shipped): HIGH (direct read of `src/infrastructure/db/schema.ts`)
- Validation architecture: HIGH (matches Phase 3 D-33 contract pattern + nyquist_validation_enabled flag verified in config.json)
- REV-07 fixture math: HIGH (the corrected fixture math worked through by hand); the CONTEXT D-15 inconsistency is HIGH-CONFIDENCE flagged — see A8 / Open Q 2

**Research date:** 2026-05-16
**Valid until:** 2026-06-16 (30 days; stack is stable, no fast-moving deps in scope)

---

## RESEARCH COMPLETE

Phase 4 is well-bounded by 33 locked decisions and requires only 2 new npm dependencies (`ulid`, `simple-statistics`). The statistical engine is ~90 LOC of pure math wrapping `simple-statistics` primitives + hand-rolled BH-FDR; the MCP surface follows the Phase 1 `register.ts` precedent and should be extended with parallel resource + prompt wrappers; the CLI follows Phase 3's `sync.ts` shim shape verbatim across 7 new subcommands; the decision-ledger schema is already complete from Phase 3 with **zero new migrations** required. Two genuine ambiguities are flagged for the planner / user: the REV-07 fixture math in CONTEXT D-15 is internally inconsistent with the BH @ q=0.10 / m=5 specification (corrected fixture proposed) and the D-13 floor of N=14 for Mann-Whitney is on the edge of normal-approximation validity (recommend adding a `pattern_confidence: weak` annotation rather than bumping the floor). All 18 phase REQ-IDs map to concrete test files in the Wave 0 gap list; the D-26 banned-word contract test extends source-grep coverage to rendered formatter output; the D-29 MCP attestation transition (tools.length 1→8 + new resources.length===6 + prompts.length===4) is the single load-bearing breaking change with Gate H enforcing forward direction.

Sources:
- [Mann–Whitney U test (Wikipedia)](https://en.wikipedia.org/wiki/Mann%E2%80%93Whitney_U_test)
- [simple-statistics documentation](https://simple-statistics.github.io/docs/)
- [@modelcontextprotocol/sdk on npm](https://www.npmjs.com/package/@modelcontextprotocol/sdk)
- [ulid on npm](https://www.npmjs.com/package/ulid)
- [MCP TypeScript SDK Server Guide](https://github.com/modelcontextprotocol/typescript-sdk/blob/main/docs/server.md)
- [MCP TypeScript SDK README](https://github.com/modelcontextprotocol/typescript-sdk)
- [Benjamini-Hochberg Procedure (Statistics How To)](https://www.statisticshowto.com/benjamini-hochberg-procedure/)
- [Wilcoxon Rank-Sum Test (Gregor B. Karenitsch)](https://gregorkb.github.io/nonparm/wilcoxonranksum.html)
