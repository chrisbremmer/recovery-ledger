# Phase 4 Patterns Map

**Mapped:** 2026-05-16
**Phase:** 04 — domain-math-reviews-decision-ledger-mcp-surface
**Files classified:** ~52 new + 6 extended (8 layers)
**Analogs found:** 38 / 52 strong; 14 in "no analog exists" categories (pure stats + MCP resources + MCP prompts)

---

## Summary

Phase 4 introduces ~52 new source files + 6 extensions, spanning eight layers:

| Layer | New files | Extended | Closest single analog |
|------|-----------|----------|-----------------------|
| `src/domain/stats/*` (pure math) | 4 | — | **none** — first pure-math modules under `src/domain/`; closest shape precedent is `src/domain/dst-tz/detect.ts` (pure function, typed-input/typed-output, no I/O) |
| `src/domain/baselines/anomalies/patterns/confidence/actions/review/*` | 14 | — | `src/domain/dst-tz/detect.ts` (pure-function shape) + `src/domain/types/score.ts` (closed-tuple discriminator) + `src/domain/types/sync.ts` (typed enum + result shapes) |
| `src/services/*` (review/decision/cache/api-gap) | 10 | 2 | `src/services/sync/index.ts` (orchestrator with `runX(input, deps)` shape) + `src/services/bootstrap.ts` (composition root) |
| `src/mcp/register-resource.ts`, `register-prompt.ts` (D-36 wrappers) | 2 | — | `src/mcp/register.ts` (the canonical sanitize-wrapped-register wrapper) |
| `src/mcp/tools/*` (7 new) | 7 | 1 (index.ts) | `src/mcp/tools/whoop-doctor.ts` (≤5-line shim verbatim) |
| `src/mcp/resources/*` (6 new) | 6 | — | **none** — first resources in the project; pattern derived from research §MCP Surface + register.ts wrapper discipline |
| `src/mcp/prompts/*` (5 new) | 5 | — | **none** — first prompts in the project; pattern derived from research §MCP Surface §registerPrompt |
| `src/cli/commands/*` (7 new) | 7 | 1 (index.ts) | `src/cli/commands/sync.ts` (validation arms → bootstrap → service → format → stdout → exit) |
| `src/formatters/*` (5 new) | 5 | — | `src/formatters/sync.txt.ts` (column padding + exhaustive `statusSuffix` switch + pure function) |
| `src/infrastructure/db/repositories/decisions.repo.ts` extension | — | 1 | `src/infrastructure/db/repositories/cycles.repo.ts` (default-filter discipline + `db.transaction({behavior:'immediate'})` write pattern + row-to-entity mapper) |
| Contract tests (D-26 tone, MCP shape, shim-LOC, daily-shape) | 6 | — | `src/formatters/sync.txt.test.ts` (one assertion-per-banned-word loop already in place) |
| Runtime attestation tests (D-29 transition) | — | 1 (mcp-stdout-purity extension) | `tests/integration/mcp-stdout-purity.test.ts` (spawn-dist-mcp + JSON-RPC fixtures) |

**The four load-bearing analogs the planner must keep in front of mind:**

1. **`src/mcp/register.ts`** — the sanitize-wrapped registration wrapper. Phase 4's `register-resource.ts` + `register-prompt.ts` must mirror this verbatim (try → handler → sanitizeResult → return; catch → sanitize(serializeError(err)) → isError:true).
2. **`src/mcp/tools/whoop-doctor.ts`** — the ≤5-line MCP shim shape. All 7 new tools are pasted-and-renamed variants of this file: `toStructuredContent` helper + `TOOL_DESCRIPTION` const + `register(server, 'name', {description, inputSchema}, async (input) => { ... })` with a 4-statement body.
3. **`src/cli/commands/sync.ts`** — the canonical ≤5-line CLI shim shape with exit-code constants, parsed-input validation arms, bootstrap arm, service-call try/catch, stdout-write-then-exit pattern.
4. **`src/services/bootstrap.ts`** — the composition root. Every Phase 4 service is wired into `Bootstrapped.services` here; the addition is purely additive (no Phase 3 breakage).

There is **no existing analog** for the pure-statistics modules (median/MAD/Mann-Whitney/BH-FDR), the MCP resource handlers, or the MCP prompt handlers — these are introduced fresh in Phase 4. The planner should use the patterns sketched in §Pure-math precedent and §No-analog templates below.

---

## Shared Patterns

### Shared Pattern 1 — Pure-domain module shape (zero I/O)

**Source:** `src/domain/dst-tz/detect.ts` lines 41-86 — the canonical pure-domain-module precedent.

**Apply to:** every file under `src/domain/stats/`, `src/domain/baselines/`, `src/domain/anomalies/`, `src/domain/patterns/`, `src/domain/confidence/`, `src/domain/actions/`, `src/domain/review/` — i.e., every domain file in Phase 4.

**The shape (the load-bearing 4 lines):**

```ts
import { tzOffset } from '@date-fns/tz';      // import deps at top; NO I/O imports (fs/db/fetch)

export interface DstDetectInput { ... }        // typed input
export interface DstDetectOutput { ... }       // typed output (consider discriminated union for ADR-0004)

export function detectExclusion(input: DstDetectInput): DstDetectOutput {
  // body is pure: no logger, no I/O, no Date.now(), no module-level state
  // ...
}
```

**Discipline carried forward:**
- No `console.*` (ADR-0001 / Gate B).
- No `drizzle-orm` imports (Gate G — domain code consumes entity types from `src/domain/types/`, never row types).
- All non-determinism (clock, tz) is INJECTED — never read inside the function (`ianaZone` is passed in, NOT read from `Intl.DateTimeFormat()...` inside the body).
- Discriminated-union output where the "no-result" path matters (ADR-0004 — Phase 4 uses this for `ZAnalysis`, `WeeklyPattern`, etc.).

### Shared Pattern 2 — Closed-tuple discriminator + runtime Set

**Source:** `src/domain/types/score.ts` lines 36-61 — the `as const` tuple + derived type + derived runtime Set pattern.

**Apply to:** `src/domain/patterns/candidates.ts` (5-tuple `CANDIDATE_FACTORS`), `src/domain/anomalies/direction.ts` (per-metric direction map as a `Record` over a closed metric tuple), `src/domain/actions/catalog.ts` (catalog entries with stable `id`s), `src/domain/actions/decision-prompts.ts`, `src/services/cache/types.ts` (resource discriminator), `src/services/api-gap/data.ts` (entry tuple).

**The shape:**

```ts
// src/domain/patterns/candidates.ts
export const CANDIDATE_FACTORS = [
  'sleep_duration_prior_night',
  'sleep_debt_3d_rolling',
  'day_strain_prior_day',
  'workout_timing_late_evening',
  'hrv_delta_prior_day',
] as const;
export type CandidateName = (typeof CANDIDATE_FACTORS)[number];
export const CANDIDATE_FACTORS_SET: ReadonlySet<CandidateName> = new Set(CANDIDATE_FACTORS);
```

**Why it's load-bearing:** A 6th candidate added to the tuple updates the type and the runtime check from a single edit. The BH FDR test in `pattern.ts` asserts `CANDIDATE_FACTORS.length === 5` (D-11 lock); adding a 6th candidate flips that assertion at compile time AND at the test boundary.

### Shared Pattern 3 — `db.transaction({behavior: 'immediate'})` repo writes

**Source:** `src/infrastructure/db/repositories/cycles.repo.ts` lines 79-121 — the `upsertBatch` pattern with `BEGIN IMMEDIATE`.

**Apply to:** every new write surface in the Phase 4 `decisions.repo.ts` extension (`updateOutcome`).

**The shape:**

```ts
updateOutcome(id: string, status: 'open'|'followed_up'|'abandoned', notes: string | null): void {
  db.transaction(
    (tx) => {
      tx.update(decisionsTable)
        .set({ status, outcome_notes: notes })
        .where(eq(decisionsTable.id, id))
        .run();
    },
    { behavior: 'immediate' },
  );
}
```

**Why:** Pitfall 13 — deferred BEGIN can upgrade mid-flight and defeat `busy_timeout`. Every Phase 3 write uses BEGIN IMMEDIATE; Phase 4 extensions follow suit.

### Shared Pattern 4 — Default SCORED-only filter + opt-in escape

**Source:** `src/infrastructure/db/repositories/cycles.repo.ts` lines 123-138 — the `ByRangeOpts` default-filter discipline.

**Apply to:** every domain read in Phase 4 (`baselines/index.ts`, `patterns/pattern.ts`) — they read via the default `byRange()` and AUTOMATICALLY get SCORED-only + non-DST-excluded rows. Only `services/cache/index.ts` (the `whoop_query_cache` service) plumbs `{includeUnscored, includeExcluded}` per D-24 escape hatches.

**Excerpt to copy verbatim into Phase 4 reading code:**

```ts
// Domain or service code reads SCORED-only by DEFAULT:
const cycles = bootstrap.repos.cycles.byRange(start, end);  // no opts → SCORED + non-excluded

// Phase 4 query-cache service is the ONLY caller that opts out:
const allCycles = bootstrap.repos.cycles.byRange(start, end, {
  includeUnscored: input.includeUnscored ?? false,
  includeExcluded: input.includeExcluded ?? false,
});
```

### Shared Pattern 5 — Pure formatter `(typedResult) => string`

**Source:** `src/formatters/sync.txt.ts` lines 44-93 — column-padding constants at module scope, `statusSuffix(status)` exhaustive switch, pure function.

**Apply to:** all 5 new formatters (`daily-review.txt.ts`, `weekly-review.txt.ts`, `decision.txt.ts`, `query-cache.txt.ts`, `api-gap.txt.ts`).

**The skeleton:**

```ts
const RESOURCE_COL_WIDTH = 20;
const STATUS_COL_WIDTH = 15;

// Exhaustive switch — adding a new status kind to the domain type breaks
// this at compile time, the MR-21 forcing-function pattern.
function statusSuffix(status: ResourceSyncStatus): string {
  switch (status) {
    case 'success':       return '';
    case 'partial_429':   return ' (rate-limited; retried)';
    // ... every case must be enumerated; no `default:` clause
  }
}

export function formatSyncResult(result: RunSyncResult): string {
  const lines: string[] = [`Status: ${result.status}`];
  for (const resource of RESOURCES) { lines.push(formatOutcomeLine(...)); }
  return lines.join('\n');
}
```

**Tone discipline (D-26 layer 1 — source-level Gate A; layer 2 — formatter contract test):** every formatter passes the banned-word lint at source level (Gate A) AND its rendered output passes the new `tests/contract/formatter-tone.test.ts`. The list verbatim from `scripts/ci-grep-gates.sh:97`:

```sh
TONE_WORDS_RE='\b(optimize|wellness|honor|journey|crush|nail|tune|vibe|unlock)\b|\bdial in\b'
```

The Phase 4 contract test SHOULD re-implement this list inline — `scripts/ci-grep-gates.sh` does NOT export a callable function; it's a shell script that exits non-zero on hits. The contract test's `BANNED_WORDS` array must be kept in lockstep with the regex above (a Wave 0 task can add a CI gate that compares the two sources).

### Shared Pattern 6 — `<NAME>_EXIT_CODES` Object.freeze constants per CLI command

**Source:** `src/cli/commands/sync.ts` lines 42-51.

**Apply to:** every new CLI command (`review-daily`, `review-weekly`, `decision-add`, `decision-review`, `decision-update`, `query`, `api-gap`).

**Excerpt:**

```ts
export const SYNC_EXIT_CODES: Readonly<Record<string, number>> = Object.freeze({
  ok: 0,
  partial: 0,           // SOFT success — per-resource lines flag the issue
  failed: 1,
  invalid_input: 1,
  bootstrap_failed: 1,
});
```

Pair every constant with `.addHelpText('after', ...)` in `src/cli/index.ts` (sync.ts in `src/cli/index.ts:143-156` is the precedent).

### Shared Pattern 7 — ≤5-line CLI shim composition

**Source:** `src/cli/commands/sync.ts` lines 146-209 — the canonical orchestration shim with validation arms, bootstrap arm, service-call try/catch, stdout-write-then-exit.

**Apply to:** every new CLI command in `src/cli/commands/`. The CORE composition is always:

```
1. validate input → exit invalid_input on failure
2. bootstrap()    → exit bootstrap_failed on MigrationError
3. services.X(input)
4. format + process.stdout.write
5. process.exit(<NAME>_EXIT_CODES[outcome])
```

Body weighs ~150-250 LOC because of validation + catch arms; the CORE is 5 lines.

### Shared Pattern 8 — Sanitize-wrapped MCP registration

**Source:** `src/mcp/register.ts` lines 60-82 (the `register()` wrapper) + lines 84-121 (the recursive `sanitizeResult` walker).

**Apply to:** the two NEW wrappers `src/mcp/register-resource.ts` + `src/mcp/register-prompt.ts` (D-36 — extending the discipline to all 18 MCP surfaces).

**The wrapper skeleton (paste-and-rename verbatim):**

```ts
export function register<I extends ZodRawShape>(
  server: McpServer,
  name: string,
  config: ToolConfig<I>,
  handler: ToolCallback<I>,
): void {
  const wrapped = (async (...args: Parameters<ToolCallback<I>>): Promise<CallToolResult> => {
    try {
      const result = await (handler as WrappedHandler<I>)(...args);
      return sanitizeResult(result) satisfies CallToolResult;
    } catch (err) {
      return {
        content: [{ type: 'text', text: sanitize(serializeError(err)) }],
        isError: true,
      } satisfies CallToolResult;
    }
  }) as ToolCallback<I>;
  server.registerTool(name, config, wrapped);
}
```

Resource and prompt wrappers vary only in: (a) SDK call (`server.registerResource` / `server.registerPrompt`); (b) return shape (resources: `{contents: [{uri, text, mimeType}]}`; prompts: `{messages: [{role: 'user', content: {type: 'text', text}}]}`); (c) sanitize walker target (`contents[].text` for resources; `messages[].content.text` for prompts). Same try/catch/sanitize/return-isError discipline applies.

**Phase 4 also adds Gate I + Gate J to `scripts/ci-grep-gates.sh`:**

- Gate I: `\bserver\.registerResource\b` banned outside `src/mcp/register-resource.ts`.
- Gate J: `\bserver\.registerPrompt\b` banned outside `src/mcp/register-prompt.ts`.

### Shared Pattern 9 — `toStructuredContent` JSON-roundtrip cast

**Source:** `src/mcp/tools/whoop-doctor.ts` lines 23-25.

**Apply to:** every new MCP tool handler.

```ts
function toStructuredContent(result: DailyReviewResult): { [k: string]: unknown } {
  return JSON.parse(JSON.stringify(result)) as { [k: string]: unknown };
}
```

**Why:** validates JSON-serializability at runtime (a future field that adds a Date / function / Map fails loudly through the sanitizer, not silently on the wire). Costs tens of microseconds. The cast through `unknown` is the canonical narrowing for `JSON.parse`-returned values.

---

## File-by-file map

### Domain layer

#### `src/domain/stats/median.ts` (new, ~10 LOC, layer: domain/stats)

**Closest analog:** none — first pure-stats module in the project.
**Shape precedent:** `src/domain/dst-tz/detect.ts` (pure-function shape — typed-input/typed-output, no I/O).
**Pattern:** re-export `simple-statistics.median` with a domain-layer wrapper that throws on empty.

**Excerpt template (write to mimic this shape):**

```ts
// src/domain/stats/median.ts
import { median as ssmedian } from 'simple-statistics';
export function median(values: number[]): number {
  if (values.length === 0) throw new Error('median: empty array');
  return ssmedian(values);
}
```

#### `src/domain/stats/mad.ts` (new, ~15 LOC, layer: domain/stats)

**Closest analog:** none.
**Pattern:** `simple-statistics.medianAbsoluteDeviation` wrapper applying the 1.4826 consistency factor; MAD=0 edge case returns 0 (caller is responsible for refusing the Z-analysis).

**Excerpt template:**

```ts
import { medianAbsoluteDeviation } from 'simple-statistics';
const MAD_CONSISTENCY = 1.4826;   // Rousseeuw & Croux (1993) — consistency factor
export function robustSigma(values: number[]): number {
  if (values.length === 0) throw new Error('robustSigma: empty array');
  return MAD_CONSISTENCY * medianAbsoluteDeviation(values);
}
```

#### `src/domain/stats/mann-whitney.ts` (new, ~40 LOC, layer: domain/stats)

**Closest analog:** none.
**Pattern:** wraps `simple-statistics.wilcoxonRankSum` to return both `U` and a two-sided p-value via normal approximation with continuity correction (using `simple-statistics.cumulativeStdNormalProbability`).

**Excerpt template:**

```ts
import { wilcoxonRankSum, cumulativeStdNormalProbability } from 'simple-statistics';
export function mannWhitney(sampleX: number[], sampleY: number[]): { U: number; p: number } {
  const n1 = sampleX.length, n2 = sampleY.length;
  if (n1 < 2 || n2 < 2) throw new Error('mannWhitney: each sample needs n >= 2');
  const R1 = wilcoxonRankSum(sampleX, sampleY);          // rank-sum for sampleX
  const U  = R1 - (n1 * (n1 + 1)) / 2;
  const mu = (n1 * n2) / 2;
  const sigma = Math.sqrt((n1 * n2 * (n1 + n2 + 1)) / 12);
  const z = (Math.abs(U - mu) - 0.5) / sigma;            // continuity correction
  const p = 2 * (1 - cumulativeStdNormalProbability(z));
  return { U, p };
}
```

#### `src/domain/stats/fdr.ts` (new, ~30 LOC, layer: domain/stats)

**Closest analog:** none.
**Pattern:** hand-rolled BH step-up procedure with adjusted p-values; pure function over `number[]` + `q`. See research §Statistical Engine §5 for the canonical implementation.

**Excerpt template (verbatim from research):**

```ts
export function benjaminiHochberg(
  pvalues: number[],
  q: number,
): { rejected: boolean[]; adjusted: number[] } {
  const m = pvalues.length;
  const indexed = pvalues.map((p, i) => ({ p, i }));
  indexed.sort((a, b) => a.p - b.p);
  const rejected = new Array(m).fill(false);
  let kStar = -1;
  for (let k = m; k >= 1; k--) {
    if (indexed[k - 1].p <= (k / m) * q) { kStar = k; break; }
  }
  if (kStar > 0) for (let k = 0; k < kStar; k++) rejected[indexed[k].i] = true;
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

#### `src/domain/baselines/index.ts` (new, ~80 LOC, layer: domain)

**Closest analog:** `src/domain/dst-tz/detect.ts` (pure-function shape).
**Pattern:** consumes `Cycle[] | Recovery[] | Sleep[]` (already-SCORED, already-non-excluded — see Shared Pattern 4), returns per-metric `BaselineStats { median, mad, n, coverage_pct }`. Memoization to `daily_summaries` via repo `upsertOneDay` lives at the SERVICE layer, not here.

**Excerpt template:**

```ts
import type { Cycle, Recovery, Sleep } from '../types/entities.js';
import { median } from '../stats/median.js';
import { robustSigma } from '../stats/mad.js';

export interface BaselineStats {
  metric: MetricName;
  median: number;
  mad: number;          // raw MAD; baseline gating layer applies 1.4826 via robustSigma()
  n: number;
  coverage_pct: number;
}

export function computeBaseline(
  values: number[],
  windowDays: number,
): BaselineStats { /* pure */ }
```

#### `src/domain/baselines/types.ts` (new, ~30 LOC, layer: domain/types)

**Closest analog:** `src/domain/types/score.ts` (closed-tuple discriminator pattern — see Shared Pattern 2).
**Pattern:** export `BaselineStats` + the closed `METRIC_NAMES` tuple + `MetricName` type.

#### `src/domain/anomalies/anomaly.ts` (new, ~60 LOC, layer: domain)

**Closest analog:** `src/domain/dst-tz/detect.ts` (pure function with typed-input/typed-output).
**Pattern:** consumes `today: TodayMetrics` + `baseline: BaselineStats[]`; returns `Anomaly[]` filtered by D-06 firing rule (`kind === 'computed'` AND `|z| ≥ 2.0` AND direction is unfavorable per `direction.ts`).

#### `src/domain/anomalies/direction.ts` (new, ~30 LOC, layer: domain)

**Closest analog:** `src/domain/types/score.ts` (closed-tuple module-load constant).
**Pattern:** module-load constant `Record<MetricName, 'low' | 'high' | 'bidirectional'>` per D-06. The direction map is the source of truth for per-metric anomaly firing direction.

**Excerpt template:**

```ts
import type { MetricName } from '../baselines/types.js';

/** D-06 direction map. 'low' = bad when z ≤ -2; 'high' = bad when z ≥ +2;
 *  'bidirectional' = surface as informational (not actionable). */
export const ANOMALY_DIRECTION: Readonly<Record<MetricName, 'low' | 'high' | 'bidirectional'>> = Object.freeze({
  hrv_rmssd_milli: 'low',
  recovery_score: 'low',
  sleep_duration_minutes: 'low',
  sleep_efficiency_percent: 'low',
  resting_heart_rate: 'high',
  respiratory_rate: 'high',
  day_strain: 'bidirectional',
});
```

#### `src/domain/anomalies/types.ts` (new, ~40 LOC, layer: domain/types)

**Closest analog:** `src/domain/types/score.ts` (discriminated-union pattern with `as const`).
**Pattern:** D-05 `ZAnalysis` discriminated union (`computed` vs `refused`).

**Excerpt template:**

```ts
export type ZAnalysis =
  | { kind: 'computed'; value: number; baseline_median: number; baseline_mad: number; tier: 'weak' | 'strong' }
  | { kind: 'refused'; reason: 'insufficient_days' | 'baseline_mad_zero'; days_available: number; days_required: 14 };

export interface Anomaly {
  metric: MetricName;
  z: number;
  direction: 'low' | 'high';   // bidirectional is never an Anomaly — surfaced separately
}
```

#### `src/domain/patterns/pattern.ts` (new, ~120 LOC, layer: domain)

**Closest analog:** `src/domain/dst-tz/detect.ts` (pure function with ADR-0004 typed positive output for absence).
**Pattern:** consumes 28-day cycle history + the 5 candidate factors; per-candidate Mann-Whitney → BH FDR → returns `WeeklyPattern` discriminated union per ADR-0004.

**Excerpt template (the discriminated union is the load-bearing piece):**

```ts
export type WeeklyPattern =
  | { kind: 'detected'; factor: CandidateName; statistic: { U: number; p_raw: number; p_adjusted: number }; direction: 'worst_days_had_lower' | 'worst_days_had_higher' }
  | { kind: 'no_pattern'; reason: 'insufficient_window_days' | 'no_factor_cleared_fdr' | 'all_candidates_refused' };
```

#### `src/domain/patterns/candidates.ts` (new, ~50 LOC, layer: domain)

**Closest analog:** `src/domain/types/score.ts` (closed-tuple pattern — Shared Pattern 2).
**Pattern:** `CANDIDATE_FACTORS as const` 5-tuple + derived type. The list is **load-bearing** for D-11; the test asserts `length === 5`.

#### `src/domain/patterns/types.ts` (new, ~40 LOC, layer: domain/types)

**Closest analog:** `src/domain/types/score.ts`.
**Pattern:** export `WeeklyPattern`, `CandidateResult`, `WorstDay` types.

#### `src/domain/confidence/index.ts` (new, ~40 LOC, layer: domain)

**Closest analog:** `src/domain/dst-tz/detect.ts` (pure function).
**Pattern:** D-13 confidence-tier gate; `confidenceFromCounts({scoredDays, windowDays}): {tier, coveragePct, minRequired}`.

**Excerpt template (verbatim from research):**

```ts
export type ConfidenceTier = 'insufficient' | 'weak' | 'strong';

export function confidenceFromCounts(opts: {
  scoredDays: number;
  windowDays: number;
}): { tier: ConfidenceTier; coveragePct: number; minRequired: 10 | 20 } {
  const coveragePct = (opts.scoredDays / opts.windowDays) * 100;
  if (opts.scoredDays < 10) return { tier: 'insufficient', coveragePct, minRequired: 10 };
  if (opts.scoredDays >= 20 && coveragePct >= 70) return { tier: 'strong', coveragePct, minRequired: 20 };
  return { tier: 'weak', coveragePct, minRequired: 10 };
}
```

#### `src/domain/confidence/types.ts` (new, ~20 LOC, layer: domain/types)

**Closest analog:** `src/domain/types/score.ts`.
**Pattern:** export `ConfidenceTier` + `ConfidenceGate` interface.

#### `src/domain/actions/catalog.ts` (new, ~80 LOC, layer: domain)

**Closest analog:** none — first catalog module. Closest precedent: `src/domain/types/score.ts` (module-load constant).
**Pattern:** `ActionCatalogEntry[]` with `(metric, direction)` → text mapping. Catalog itself is load-bearing for the tone lint (D-09 + D-26 — every entry's `text` must pass the banned-word check).

#### `src/domain/actions/decision-prompts.ts` (new, ~60 LOC, layer: domain)

**Closest analog:** none.
**Pattern:** same shape as `actions/catalog.ts`; D-23 catalog with `trigger` → `text` entries.

#### `src/domain/actions/select.ts` (new, ~30 LOC, layer: domain)

**Closest analog:** `src/domain/dst-tz/detect.ts`.
**Pattern:** pure function `selectActions(anomalies: Anomaly[]): SuggestedAction[]` returning ≤3 entries; lookup against catalog + rank by priority. Returns `[]` when no anomalies (ADR-0004 typed positive output).

#### `src/domain/review/types.ts` (new, ~80 LOC, layer: domain/types)

**Closest analog:** `src/domain/types/sync.ts` (typed result shapes — `RunSyncInput`, `RunSyncResult`).
**Pattern:** export `DailyReviewResult` (D-03 schema), `WeeklyReviewResult` (D-16 schema), `TodayMetrics`, `DataStatus`, `WeekSummary`, `DecisionPrompt` discriminated unions.

**Excerpt from analog (`src/domain/types/sync.ts` lines 31-78) — the typed-result + discriminated-status shape Phase 4 mimics:**

```ts
export const RESOURCES = ['profile', 'body_measurements', 'cycles', 'recoveries', 'sleeps', 'workouts'] as const;
export type ResourceName = (typeof RESOURCES)[number];
export type ResourceSyncStatus =
  | 'success' | 'partial_429' | 'partial_5xx' | 'failed_auth' | 'failed_network'
  | 'failed_db' | 'failed_parse' | 'failed_unknown' | 'skipped';

export type ResourceSyncOutcome = { status: ResourceSyncStatus; fetched?: number; upserted?: number; ... };
```

---

### Services layer

#### `src/services/review/daily.ts` (new, ~150 LOC, layer: services)

**Closest analog:** `src/services/sync/index.ts` lines 76-271 — the `runX(input, deps)` orchestrator shape with typed `Deps` interface and typed `Result` return.

**Pattern:** compose repos (`cycles`, `recoveries`, `sleeps`, `workouts`, `dailySummaries`) + domain (`baselines`, `anomalies`, `actions`, `confidence`) + return typed `DailyReviewResult`. The function consumes a `Deps` shape (repos + clock + logger) — no I/O outside repo calls; no WHOOP HTTP.

**Excerpt from analog (`src/services/sync/index.ts:76-135`) — the typed-deps + typed-result shape:**

```ts
export interface RunSyncDeps {
  repos: { syncRuns: SyncRunsRepo; cycles: CyclesRepo; recoveries: RecoveryRepo; ... };
  whoop: { resources: { ... } };
  sqlite: Database.Database;
  clock: () => Date;
  ianaZone: () => string;
  logger: Logger;
}

export async function runSync(input: RunSyncInput, deps: RunSyncDeps): Promise<RunSyncResult> {
  const startedAt = deps.clock();
  // 1. insertRunning (first DB write)
  // 2. for each resource: pipeline + record outcome
  // 3. finalize + wal_checkpoint
  // 4. return typed result
}
```

**Phase 4 equivalent shape:**

```ts
export interface DailyReviewDeps {
  repos: { cycles: CyclesRepo; recoveries: RecoveryRepo; sleeps: SleepsRepo; workouts: WorkoutsRepo;
            dailySummaries: DailySummariesRepo; syncRuns: SyncRunsRepo };
  clock: () => Date;
  logger: Logger;
}

export async function getDailyReview(
  input: { date?: string },
  deps: DailyReviewDeps,
): Promise<DailyReviewResult> {
  const reviewedDate = await resolveReviewedDate(input.date, deps);
  const baselineWindow = computeWindow(reviewedDate, 30);
  const cycles = deps.repos.cycles.byRange(baselineWindow.start, baselineWindow.end);
  // ... compose domain layer
  // memoize via deps.repos.dailySummaries.upsertOneDay(...)
  // return typed DailyReviewResult per D-03
}
```

#### `src/services/review/weekly.ts` (new, ~180 LOC, layer: services)

**Closest analog:** `src/services/sync/index.ts` — same orchestrator shape.
**Pattern:** same `Deps`/`Input`/`Result` triple as `daily.ts`; composes `patterns/pattern.ts` (28-day window) + `decisions.repo.countSince()` (D-22 prompt gating) + `confidence/index.ts`.

#### `src/services/review/resolve-date.ts` (new, ~50 LOC, layer: services)

**Closest analog:** none directly (but `src/services/sync/cursor.ts` is a similar "resolve a date from repo state" pattern).
**Pattern:** `resolveReviewedDate(input?: string, deps): Promise<string>` — implements D-01: `MAX(start) FROM cycles WHERE score_state = 'SCORED' AND baseline_excluded = 0`. Wraps `cycles.repo.byRange()` with a small `.slice(-1)` to read the latest SCORED row.

#### `src/services/review/data-status.ts` (new, ~80 LOC, layer: services)

**Closest analog:** none.
**Pattern:** assembles the `data_status` slot of `DailyReviewResult` / `WeeklyReviewResult`. Reads `sync_runs.repo.latestFinished()` + counts missing resources.

#### `src/services/decision/index.ts` (new, ~100 LOC, layer: services)

**Closest analog:** `src/services/sync/index.ts` (orchestrator shape, lighter weight).
**Pattern:** `addDecision(input, deps): Promise<Decision>`, `reviewDecisions(input, deps)`, `updateDecision(input, deps)` — each consumes `decisions.repo` + ULID gen.

**Excerpt template (the load-bearing ULID line + repo call):**

```ts
import { ulid } from 'ulid';
import type { DecisionsRepo } from '../../infrastructure/db/repositories/decisions.repo.js';

export interface AddDecisionInput {
  decision: string;
  category?: string;
  rationale?: string | null;
  confidence?: 'low' | 'medium' | 'high' | null;
  expectedEffect?: string | null;
  followUpDate?: string;        // ISO yyyy-mm-dd
}

export async function addDecision(
  input: AddDecisionInput,
  deps: { repos: { decisions: DecisionsRepo }; clock: () => Date },
): Promise<Decision> {
  const id = ulid();
  const createdAt = deps.clock().toISOString();
  deps.repos.decisions.insert({
    id, createdAt,
    category: input.category ?? 'general',
    decision: input.decision,
    rationale: input.rationale ?? null,
    confidence: input.confidence ?? null,
    expectedEffect: input.expectedEffect ?? null,
    followUpDate: input.followUpDate ?? null,
  });
  const created = deps.repos.decisions.byId(id);
  if (created === null) throw new Error(`addDecision: insert succeeded but byId returned null for ${id}`);
  return created;
}
```

#### `src/services/decision/types.ts` (new, ~40 LOC, layer: services/types)

**Closest analog:** `src/domain/types/sync.ts` (typed I/O shapes).
**Pattern:** export `AddDecisionInput`, `ReviewDecisionsInput`, `ReviewDecisionsResult`, `UpdateDecisionInput` discriminated unions.

#### `src/services/cache/index.ts` (new, ~120 LOC, layer: services)

**Closest analog:** `src/services/sync/index.ts` (orchestrator dispatch shape).
**Pattern:** D-24 8-resource dispatch — `switch (input.resource) { case 'cycles': ...; case 'recoveries': ...; ... }` with `{includeUnscored, includeExcluded}` plumbed through to the repo `byRange()` for opt-out. Returns `{resource, rows, count, truncated}`.

#### `src/services/cache/types.ts` (new, ~80 LOC, layer: services/types)

**Closest analog:** `src/domain/types/sync.ts` (closed-tuple resource discriminator + per-resource typed shapes).
**Pattern:** D-24 typed discriminated union per resource (8 arms).

#### `src/services/api-gap/index.ts` (new, ~30 LOC, layer: services)

**Closest analog:** `src/services/sync/index.ts` (typed return shape).
**Pattern:** trivial accessor — `getApiGap(deps): Promise<ApiGapResult>` returns `{ entries: ApiGapEntry[] }` from the module-load constant in `data.ts`.

#### `src/services/api-gap/data.ts` (new, ~80 LOC, layer: services)

**Closest analog:** `src/domain/types/sync.ts` (the `RESOURCES as const` module-load constant pattern).
**Pattern:** `API_GAP_ENTRIES: readonly ApiGapEntry[] = [...] as const` with 6+ entries per D-28.

#### `src/services/index.ts` (EXTEND, ~30 LOC added, layer: services barrel)

**Source (analog == self):** `src/services/index.ts` (existing).
**Pattern:** add type re-exports + `Services` interface fields for the 6 new services. Keep the `createServices()` factory throwing-on-undefined for DB-dependent services (matches existing `runSync` throw at lines 80-83).

**Excerpt to extend (current shape):**

```ts
export interface Services {
  runDoctor: typeof runDoctor;
  refreshOrchestrator: typeof refreshOrchestrator;
  runSync: (input: RunSyncInput) => Promise<RunSyncResult>;
  // Phase 4 ADDITIONS:
  getDailyReview: (input: { date?: string }) => Promise<DailyReviewResult>;
  getWeeklyReview: (input: { date?: string }) => Promise<WeeklyReviewResult>;
  addDecision: (input: AddDecisionInput) => Promise<Decision>;
  reviewDecisions: (input: ReviewDecisionsInput) => Promise<ReviewDecisionsResult>;
  queryCache: (input: QueryCacheInput) => Promise<QueryCacheResult>;
  getApiGap: () => Promise<ApiGapResult>;
}
```

The `createServices()` lightweight factory continues to throw for every DB-dependent method (`runSync` precedent at lines 80-85 — paste-and-rename per new service).

#### `src/services/bootstrap.ts` (EXTEND, ~20 LOC added, layer: services)

**Source (analog == self):** `src/services/bootstrap.ts` lines 87-216.
**Pattern:** extend `Bootstrapped.services` (lines 105-107) and wire the 6 new services in the return block (lines 200-216).

**Excerpt of the existing `services` slot (line 105):**

```ts
services: {
  runSync(input: RunSyncInput): Promise<RunSyncResult>;
  // Phase 4 ADDITIONS:
  getDailyReview(input: { date?: string }): Promise<DailyReviewResult>;
  getWeeklyReview(input: { date?: string }): Promise<WeeklyReviewResult>;
  addDecision(input: AddDecisionInput): Promise<Decision>;
  reviewDecisions(input: ReviewDecisionsInput): Promise<ReviewDecisionsResult>;
  queryCache(input: QueryCacheInput): Promise<QueryCacheResult>;
  getApiGap(): Promise<ApiGapResult>;
};
```

Wiring at the return block (existing line 204):

```ts
return {
  db, sqlite, repos,
  services: {
    runSync: (input) => runSync(input, syncDeps),
    // Phase 4 ADDITIONS:
    getDailyReview: (input) => getDailyReview(input, reviewDeps),
    getWeeklyReview: (input) => getWeeklyReview(input, reviewDeps),
    addDecision: (input) => addDecision(input, decisionDeps),
    reviewDecisions: (input) => reviewDecisions(input, decisionDeps),
    queryCache: (input) => queryCache(input, cacheDeps),
    getApiGap: () => getApiGap(),
  },
  close: ...
};
```

The `reviewDeps`, `decisionDeps`, `cacheDeps` shapes are constructed above the `return` block; each composes a subset of `repos` + `clock` + `logger`.

---

### MCP layer

#### `src/mcp/index.ts` (EXTEND, ~40 LOC added, layer: mcp entry)

**Source (analog == self):** `src/mcp/index.ts` (existing 18 lines).
**Pattern:** SWITCH from `createServices()` to `bootstrap()` (research §CLI Surface §`Bootstrapped.services` extension — load-bearing 1-line change so the new services have a DB handle); register 7 new tools + 6 new resources + 4 new prompts via the wrapper-pattern.

**Excerpt of the current entry (load-bearing) at lines 12-14:**

```ts
const server = new McpServer({ name: 'recovery-ledger', version: '0.1.0' });
const services = createServices();      // ← REPLACE WITH bootstrap()
registerWhoopDoctor(server, services);
```

**Phase 4 target shape:**

```ts
const server = new McpServer({ name: 'recovery-ledger', version: '0.1.0' });
const app = bootstrap();                 // ← opens DB + runs migrator
registerWhoopDoctor(server, app.services);
registerWhoopSync(server, app.services);
registerWhoopDailyReview(server, app.services);
registerWhoopWeeklyReview(server, app.services);
registerWhoopQueryCache(server, app.services);
registerWhoopAddDecision(server, app.services);
registerWhoopReviewDecisions(server, app.services);
registerWhoopApiGap(server, app.services);
// 6 resources
registerSummaryToday(server, app.services);  // ... ×6
// 4 prompts
registerDailyDecisionBrief(server, app.services);  // ... ×4
```

#### `src/mcp/register.ts` (UNMODIFIED per D-30)

**Source:** see Shared Pattern 8 above for the full wrapper excerpt.

#### `src/mcp/register-resource.ts` (new, ~60 LOC, layer: mcp wrapper)

**Closest analog:** `src/mcp/register.ts` lines 60-121.
**Pattern:** parallel wrapper for resources. Mirrors the existing `register()` try/catch/sanitize discipline; calls `server.registerResource(name, uri, metadata, handler)`; sanitizes `contents[].text` on the success path.

**Excerpt to mirror (from `register.ts:60-82`):**

```ts
export function registerResource(
  server: McpServer,
  name: string,
  uri: string,
  metadata: { title?: string; description: string; mimeType: string },
  handler: (uri: URL) => Promise<{ contents: Array<{ uri: string; text: string; mimeType?: string }> }>,
): void {
  const wrapped = async (uri: URL) => {
    try {
      const result = await handler(uri);
      return sanitizeResourceResult(result);
    } catch (err) {
      return {
        contents: [{ uri: uri.href, text: sanitize(serializeError(err)), mimeType: 'text/plain' }],
        isError: true,
      };
    }
  };
  server.registerResource(name, uri, metadata, wrapped);
}
```

**New gate (Gate I):** `\bserver\.registerResource\b` banned outside `src/mcp/register-resource.ts`.

#### `src/mcp/register-prompt.ts` (new, ~60 LOC, layer: mcp wrapper)

**Closest analog:** `src/mcp/register.ts` lines 60-121.
**Pattern:** parallel wrapper for prompts. Same try/catch/sanitize discipline; handler returns `{messages: [{role: 'user', content: {type: 'text', text}}]}`; sanitizer walks `messages[].content.text`.

**New gate (Gate J):** `\bserver\.registerPrompt\b` banned outside `src/mcp/register-prompt.ts`.

#### `src/mcp/sanitize.ts` (UNMODIFIED per D-30)

D-30 attestation extends — sanitize.ts + register.ts UNMODIFIED across Phases 1+2+3+4.

#### `src/mcp/tools/whoop-sync.ts` (new, ~50 LOC, layer: mcp/tools)

**Closest analog:** `src/mcp/tools/whoop-doctor.ts` lines 1-70 — the canonical ≤5-line MCP tool shim.

**Excerpt from analog (`whoop-doctor.ts:55-70`) to mimic verbatim:**

```ts
function toStructuredContent(result: DoctorResult): { [k: string]: unknown } {
  return JSON.parse(JSON.stringify(result)) as { [k: string]: unknown };
}

const TOOL_DESCRIPTION = [
  'Run diagnostic checks against the local install.',
  // ...
].join(' ');

export function registerWhoopDoctor(server: McpServer, services: Services): void {
  register(server, 'whoop_doctor', { description: TOOL_DESCRIPTION, inputSchema: {} }, async () => {
    const result = await services.runDoctor({ skipSubprocessChecks: true });
    return {
      content: [{ type: 'text', text: renderDoctor(result) }],
      structuredContent: toStructuredContent(result),
    };
  });
}
```

**Phase 4 paste-and-rename for `whoop-sync.ts`:**

```ts
import { z } from 'zod';
const TOOL_DESCRIPTION = 'Sync WHOOP API v2 into the local cache. Returns per-resource outcomes.';
export function registerWhoopSync(server: McpServer, services: Services): void {
  register(server, 'whoop_sync', {
    description: TOOL_DESCRIPTION,
    inputSchema: { days: z.number().int().positive().max(365).optional(), since: z.string().optional() },
  }, async (input) => {
    const result = await services.runSync(input);
    return { content: [{ type: 'text', text: formatSyncResult(result) }], structuredContent: toStructuredContent(result) };
  });
}
```

The body has ≤5 non-blank non-comment statements (the `const result = ...` line + the `return { ... }` block).

#### `src/mcp/tools/whoop-daily-review.ts` (new, ~50 LOC, layer: mcp/tools)

**Closest analog:** `src/mcp/tools/whoop-doctor.ts`.
**Pattern:** same shim shape as above; calls `services.getDailyReview(input)` + `formatDailyReview(result)`.

#### `src/mcp/tools/whoop-weekly-review.ts` (new, ~50 LOC, layer: mcp/tools)

**Closest analog:** `src/mcp/tools/whoop-doctor.ts`.
**Pattern:** shim over `services.getWeeklyReview(input)` + `formatWeeklyReview(result)`.

#### `src/mcp/tools/whoop-query-cache.ts` (new, ~80 LOC, layer: mcp/tools)

**Closest analog:** `src/mcp/tools/whoop-doctor.ts` — but the input schema is a D-24 discriminated union, so the schema declaration is fatter (~30 LOC of Zod). The handler body still stays ≤5 lines.

#### `src/mcp/tools/whoop-add-decision.ts` (new, ~50 LOC, layer: mcp/tools)

**Closest analog:** `src/mcp/tools/whoop-doctor.ts`.

#### `src/mcp/tools/whoop-review-decisions.ts` (new, ~60 LOC, layer: mcp/tools)

**Closest analog:** `src/mcp/tools/whoop-doctor.ts`.
**Pattern:** D-21 dual-mode — when `input.updateId` is provided, dispatch to update-path; otherwise dispatch to list-path. Body branches once but stays ≤5 lines (the branch is a single ternary).

#### `src/mcp/tools/whoop-api-gap.ts` (new, ~40 LOC, layer: mcp/tools)

**Closest analog:** `src/mcp/tools/whoop-doctor.ts`.

#### `src/mcp/resources/summary-today.ts` (new, ~30 LOC, layer: mcp/resources)

**Closest analog:** none — first resource in the codebase.
**Pattern:** wires through `registerResource(server, 'summary_today', 'whoop://summary/today', metadata, handler)`. Handler calls `services.getDailyReview({})` and serializes as JSON in `contents[].text`.

**Template (derived from research §MCP Surface):**

```ts
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { Services } from '../../services/index.js';
import { registerResource } from '../register-resource.js';

export function registerSummaryToday(server: McpServer, services: Services): void {
  registerResource(server, 'summary_today', 'whoop://summary/today',
    { title: "Today's review summary", description: 'Daily review result as JSON.', mimeType: 'application/json' },
    async (uri) => {
      const result = await services.getDailyReview({});
      return { contents: [{ uri: uri.href, text: JSON.stringify(result), mimeType: 'application/json' }] };
    });
}
```

#### `src/mcp/resources/summary-week.ts`, `baseline-30d.ts`, `data-quality.ts`, `api-gaps.ts`, `decisions-open.ts` (each new, ~30 LOC)

**Closest analog:** none.
**Pattern:** same template as `summary-today.ts` above; each wires its static URI to the corresponding `services.*` call.

#### `src/mcp/prompts/build.ts` (new, ~30 LOC, layer: mcp/prompts)

**Closest analog:** none.
**Pattern:** small helper `buildPromptMessage(text: string)` that returns the D-27 `{messages: [{role: 'user' as const, content: {type: 'text' as const, text}}]}` shape. The `as const` is load-bearing for SDK type narrowing.

**Template:**

```ts
export function buildPromptMessage(text: string): {
  messages: Array<{ role: 'user'; content: { type: 'text'; text: string } }>;
} {
  return { messages: [{ role: 'user' as const, content: { type: 'text' as const, text } }] };
}
```

#### `src/mcp/prompts/daily-decision-brief.ts`, `weekly-recovery-investigation.ts`, `experiment-designer.ts`, `deload-or-train.ts` (each new, ~40-50 LOC)

**Closest analog:** none.
**Pattern:** each wires through `registerPrompt(server, name, config, handler)`. Handler calls one or more `services.*`, renders via the corresponding formatter, concatenates the D-27 instruction-copy string, returns `buildPromptMessage(text)`.

**Template (daily-decision-brief):**

```ts
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { Services } from '../../services/index.js';
import { renderDailyReview } from '../../formatters/daily-review.txt.js';
import { registerPrompt } from '../register-prompt.js';
import { buildPromptMessage } from './build.js';

export const DAILY_DECISION_BRIEF_INSTRUCTION =
  'Based on this review, suggest 1-3 concrete decisions for today. Each decision: verb-first single sentence, scoped to today\'s strain/sleep/recovery picture. Do not invent data.';

export function registerDailyDecisionBrief(server: McpServer, services: Services): void {
  registerPrompt(server, 'whoop_daily_decision_brief',
    { description: '...', argsSchema: z.object({ date: z.string().optional() }) },
    async ({ date }) => {
      const result = await services.getDailyReview({ date });
      const text = `${renderDailyReview(result)}\n\nInstruction: ${DAILY_DECISION_BRIEF_INSTRUCTION}`;
      return buildPromptMessage(text);
    });
}
```

The instruction strings are exported (`DAILY_DECISION_BRIEF_INSTRUCTION`, etc.) so the D-26 contract test (`tests/contract/formatter-tone.test.ts`) can iterate them as additional banned-word-lint targets.

---

### CLI layer

#### `src/cli/index.ts` (EXTEND, ~80 LOC added, layer: cli entry)

**Source (analog == self):** `src/cli/index.ts` lines 66-161.
**Pattern:** wire `review`, `decision` (with `add`/`review`/`update` subcommands), `query`, `api-gap` commands following the `program.command('sync').description(...).option(...).addHelpText(...).action(runSyncCommand)` precedent.

**Excerpt from current `sync` wiring (lines 134-158) to mimic for each new top-level command:**

```ts
program
  .command('sync')
  .description('Sync WHOOP data into the local cache')
  .option('--days <n>', 'window in days (default 30, max 365)', parseDaysFlag, 30)
  .option('--since <iso>', 'backfill from this ISO 8601 date (overrides --days)')
  .option('--resources <list>', '...')
  .addHelpText('after', [
    '',
    'Exit codes:',
    '  0  ok      — sync succeeded',
    // ...
  ].join('\n'))
  .action(runSyncCommand);
```

**Nested subcommand idiom for `decision` (research §CLI Surface):**

```ts
const decisionCmd = program.command('decision').description('Manage the decision ledger');
decisionCmd.command('add <text>').description(...).option(...).action(runDecisionAddCommand);
decisionCmd.command('review').description(...).option(...).action(runDecisionReviewCommand);
decisionCmd.command('update <id-or-prefix>').description(...).action(runDecisionUpdateCommand);
```

#### `src/cli/commands/review-daily.ts` (new, ~120 LOC, layer: cli/commands)

**Closest analog:** `src/cli/commands/sync.ts` lines 1-209.
**Pattern:** ≤5-line shim shape — see Shared Pattern 7.

**Excerpt from analog (`sync.ts:146-209`) — the 5-step composition:**

```ts
export async function runSyncCommand(opts: RunSyncCommandOpts): Promise<void> {
  // 1. Validate input (parseResourcesFlag, parseSinceFlag)
  const parsed = parseResourcesFlag(opts.resources);
  if (!parsed.ok) { process.stdout.write(...); return; }
  // 2. Bootstrap
  let app: Bootstrapped;
  try { app = bootstrap(); } catch (err) { /* MigrationError arm */ return; }
  // 3-5. service call → format → write → exit
  try {
    const result = await app.services.runSync({...});
    const body = formatSyncResult(result);
    process.stdout.write(`${body}\n`, () => { app.close(); process.exit(SYNC_EXIT_CODES[result.status]); });
  } catch (err) { /* sanitize + write + exit failed */ }
}
```

**Phase 4 paste-and-rename (no `--resources` plumbing; just `--date`):**

```ts
export const REVIEW_EXIT_CODES: Readonly<Record<string, number>> = Object.freeze({
  ok: 0, failed: 1, bootstrap_failed: 1,
});

export async function runReviewDailyCommand(opts: { date?: string }): Promise<void> {
  let app: Bootstrapped;
  try { app = bootstrap(); } catch (err) {
    const body = isMigrationError(err) ? formatBootstrapError(err, paths.dbFile) : `Bootstrap failed: ${sanitize(String(err))}`;
    process.stdout.write(`${body}\n`, () => process.exit(REVIEW_EXIT_CODES.bootstrap_failed));
    return;
  }
  try {
    const result = await app.services.getDailyReview({ date: opts.date });
    process.stdout.write(`${renderDailyReview(result)}\n`, () => { app.close(); process.exit(REVIEW_EXIT_CODES.ok); });
  } catch (err) {
    app.close();
    process.stdout.write(`Review failed: ${sanitize(String(err))}\n`, () => process.exit(REVIEW_EXIT_CODES.failed));
  }
}
```

#### `src/cli/commands/review-weekly.ts` (new, ~120 LOC)

**Closest analog:** `src/cli/commands/sync.ts` + `review-daily.ts` (above).
**Pattern:** same shape as `review-daily.ts`; calls `app.services.getWeeklyReview()`.

#### `src/cli/commands/decision-add.ts` (new, ~150 LOC)

**Closest analog:** `src/cli/commands/sync.ts`.
**Pattern:** same shape + `parseFollowUp(raw, now)` validator (research §CLI Surface §`--follow-up "in <N>d"` parser) following the `parseSinceFlag` precedent at `sync.ts:116-132`. Validates `--confidence` value via a closed-tuple membership check (mirrors `parseResourcesFlag`).

**Excerpt from `parseSinceFlag` (`sync.ts:116-132`) for the validator shape:**

```ts
function parseSinceFlag(raw: string | undefined): { ok: true } | { ok: false; message: string } {
  if (raw === undefined) return { ok: true };
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) {
    return { ok: false, message: `Invalid --since value: not parseable as ISO 8601.` };
  }
  if (parsed.getTime() > Date.now()) {
    return { ok: false, message: `Invalid --since value: ${raw} is in the future ...` };
  }
  return { ok: true };
}
```

#### `src/cli/commands/decision-review.ts` (new, ~180 LOC)

**Closest analog:** `src/cli/commands/sync.ts`.
**Pattern:** same shape but with `--interactive` flag that drives a `node:readline/promises` flow. **Stderr-safe prompts** (research §Pitfalls §10): the `readline` interface is configured with `output: process.stderr` so the structured rendering keeps stdout. NOT exposed through MCP (D-20).

#### `src/cli/commands/decision-update.ts` (new, ~120 LOC)

**Closest analog:** `src/cli/commands/sync.ts`.
**Pattern:** same shape; uses `decisions.repo.findByPrefix(prefix)` to resolve `<id-or-prefix>` (research §Pitfalls §11 — error arms for `length === 0` (no_match) and `length > 1` (ambiguous_prefix)).

#### `src/cli/commands/query.ts` (new, ~180 LOC)

**Closest analog:** `src/cli/commands/sync.ts`.
**Pattern:** same shape + per-resource flag dispatch (research §CLI Surface). The `--limit` flag uses `parseIntStrict` from `src/cli/index.ts:35-41`.

#### `src/cli/commands/api-gap.ts` (new, ~80 LOC)

**Closest analog:** `src/cli/commands/sync.ts`.
**Pattern:** simplest of the new commands — no flags, no validators. Just bootstrap → `services.getApiGap()` → `formatApiGap(result)` → stdout → exit.

---

### Formatters layer

#### `src/formatters/daily-review.txt.ts` (new, ~200 LOC, layer: formatters)

**Closest analog:** `src/formatters/sync.txt.ts` lines 1-112.
**Pattern:** column-padding constants at module scope, exhaustive switches for status / confidence-tier suffixes, pure function. Multi-section output per D-03 schema.

**Excerpt from analog (`sync.txt.ts:101-112`) — the typed-result → line-array → join pattern:**

```ts
export function formatSyncResult(result: RunSyncResult): string {
  const lines: string[] = [`Status: ${result.status}`];
  for (const resource of RESOURCES) {
    const outcome = result.perResource[resource];
    lines.push(formatOutcomeLine(resource, outcome));
  }
  lines.push('--');
  lines.push(`syncRunId: ${result.syncRunId}  gapsDetected: ${result.gapsDetected}`);
  return lines.join('\n');
}
```

**Phase 4 shape for `daily-review.txt.ts`:**

```ts
export function renderDailyReview(result: DailyReviewResult): string {
  const lines: string[] = [];
  lines.push(...renderDataStatus(result.data_status));   // multi-line header
  lines.push('');
  lines.push(...renderTodayMetrics(result.today_state));
  if (result.anomalies.length > 0) {
    lines.push(''); lines.push('Anomalies:');
    lines.push(...result.anomalies.map(formatAnomalyLine));
  }
  if (result.actions.length > 0) {
    lines.push(''); lines.push('Actions:');
    lines.push(...result.actions.map((a, i) => `  ${i + 1}. ${a.text}`));
  }
  lines.push('');
  lines.push(`Confidence: ${result.confidence.tier}${result.insufficient_reason ? ` — ${result.insufficient_reason}` : ''}`);
  return lines.join('\n');
}
```

#### `src/formatters/weekly-review.txt.ts` (new, ~250 LOC)

**Closest analog:** `src/formatters/sync.txt.ts`.
**Pattern:** same line-array shape with sections per D-16 schema. The `pattern` slot dispatches on `pattern.kind` (exhaustive switch — the ADR-0004 forcing function).

#### `src/formatters/decision.txt.ts` (new, ~180 LOC)

**Closest analog:** `src/formatters/sync.txt.ts`.
**Pattern:** dispatch on input shape (single decision / list / update-result). Column padding for list form (id-prefix | category | decision text | elapsed/window | over-window flag).

#### `src/formatters/query-cache.txt.ts` (new, ~200 LOC)

**Closest analog:** `src/formatters/sync.txt.ts`.
**Pattern:** per-resource sub-renderers (each follows a column-padding shape). Dispatch on `result.resource`.

#### `src/formatters/api-gap.txt.ts` (new, ~80 LOC)

**Closest analog:** `src/formatters/sync.txt.ts`.
**Pattern:** one line per `ApiGapEntry` — `<feature>: <whoop_consumer_path> — <notes>; closest proxy: <alternative or "none">`.

---

### Infrastructure layer

#### `src/infrastructure/db/repositories/decisions.repo.ts` (EXTEND, ~80 LOC added)

**Source (analog == self):** `src/infrastructure/db/repositories/decisions.repo.ts` lines 1-95.
**Pattern:** add 4 new methods (`updateOutcome`, `countSince`, `findByPrefix`, `listAll`) following the existing `insert` / `byId` / `listOpen` precedent.

**Excerpt of the existing `insert` (`decisions.repo.ts:42-62`) — the `db.transaction({behavior: 'immediate'})` pattern Phase 4 must mirror for `updateOutcome`:**

```ts
insert(d): void {
  db.transaction(
    (tx) => {
      tx.insert(decisionsTable).values({ ... }).run();
    },
    { behavior: 'immediate' },
  );
},
```

**Phase 4 new methods (all four follow the existing repo's `eq` + `desc` + `db.select()` idioms or the `db.transaction({behavior: 'immediate'})` write pattern):**

```ts
updateOutcome(id: string, status: 'open'|'followed_up'|'abandoned', notes: string | null): void {
  db.transaction(
    (tx) => {
      tx.update(decisionsTable)
        .set({ status, outcome_notes: notes })
        .where(eq(decisionsTable.id, id))
        .run();
    },
    { behavior: 'immediate' },
  );
},

countSince(date: string): number {
  const row = db
    .select({ n: sql<number>`COUNT(*)` })
    .from(decisionsTable)
    .where(gte(decisionsTable.created_at, date))
    .get();
  return row?.n ?? 0;
},

findByPrefix(prefix: string): Decision[] {
  const rows = db.select().from(decisionsTable)
    .where(sql`${decisionsTable.id} LIKE ${prefix.toUpperCase() + '%'}`)
    .all();
  return rows.map(rowToDecision);
},

listAll(): Decision[] {
  const rows = db.select().from(decisionsTable)
    .orderBy(desc(decisionsTable.created_at))
    .all();
  return rows.map(rowToDecision);
},
```

The `DecisionsRepo` interface at lines 18-36 gets 4 new method signatures appended.

---

### Tests + CI

#### `tests/contract/formatter-tone.test.ts` (new, ~120 LOC, layer: contract test)

**Closest analog:** `src/formatters/sync.txt.test.ts` lines 1-60 (Test 7 already loops ADR-0005 tone words against the formatter output — D-26 EXTENDS this pattern across every formatter × every fixture).

**The banned-word list is NOT callable from `scripts/ci-grep-gates.sh`** — that file is a shell script that hardcodes the regex at line 97 (`TONE_WORDS_RE='\b(optimize|wellness|honor|journey|crush|nail|tune|vibe|unlock)\b|\bdial in\b'`). The contract test MUST re-implement the list inline. RECOMMENDATION to the planner: add a Wave 0 sub-task to extract the list to a shared TS constant and have BOTH the shell script (via env-var injection at CI time) and this contract test consume it.

**Excerpt of the existing precedent (Test 7 in `sync.txt.test.ts`):**

```ts
test('Test 7: output is free of every banned tone word + emoji', () => {
  const output = formatSyncResult(makeResult());
  const BANNED_WORDS = ['optimize','wellness','honor','journey','crush','nail','dial in','tune','vibe','unlock'];
  for (const word of BANNED_WORDS) {
    expect(output.toLowerCase()).not.toMatch(new RegExp(`\\b${word.replace(/ /g, '\\s+')}\\b`));
  }
  expect(output).not.toMatch(/[\u{1F000}-\u{1FFFF}\u{2600}-\u{27BF}]/u);
});
```

**Phase 4 contract-test shape (extends this to all formatters × all fixtures, plus prompt instruction copy):**

```ts
const BANNED_WORDS = ['optimize','wellness','honor','journey','crush','nail','dial in','tune','vibe','unlock'];
const EMOJI_RE = /[\u{1F000}-\u{1FFFF}\u{2600}-\u{27BF}]/u;

const cases = [
  { formatter: renderDailyReview, fixtureGlob: 'tests/fixtures/review/daily-*.json' },
  { formatter: renderWeeklyReview, fixtureGlob: 'tests/fixtures/review/weekly-*.json' },
  // ... per-formatter cases for decision, query-cache, api-gap, sync, doctor
];

describe.each(cases)('formatter tone — $fixtureGlob', ({ formatter, fixtureGlob }) => {
  const fixtures = glob.sync(fixtureGlob);
  it.each(fixtures)('%s renders without banned tokens', async (fixturePath) => {
    const input = JSON.parse(await fs.readFile(fixturePath, 'utf8'));
    const rendered = formatter(input);
    for (const word of BANNED_WORDS) {
      expect(rendered.toLowerCase()).not.toMatch(new RegExp(`\\b${word.replace(/ /g, '\\s+')}\\b`));
    }
    expect(rendered).not.toMatch(EMOJI_RE);
  });
});

// Prompt instruction copy lint (D-26 + D-27)
const PROMPT_INSTRUCTIONS = [
  DAILY_DECISION_BRIEF_INSTRUCTION, WEEKLY_RECOVERY_INVESTIGATION_INSTRUCTION,
  EXPERIMENT_DESIGNER_INSTRUCTION, DELOAD_OR_TRAIN_INSTRUCTION,
];
it.each(PROMPT_INSTRUCTIONS)('prompt instruction passes tone lint', (text) => { /* same checks */ });
```

#### `tests/contract/mcp-tool-shape.test.ts`, `mcp-resource-shape.test.ts`, `mcp-prompt-shape.test.ts`, `mcp-shim-loc.test.ts`, `daily-review-shape.test.ts` (each new)

**Closest analog:** `tests/integration/mcp-stdout-purity.test.ts` (the dist-spawn + JSON-RPC fixture pattern) for the runtime-attestation shape; `src/formatters/sync.txt.test.ts` for the table-driven assertion shape for the shim-LOC + dual-shape contract tests.

**Pattern for `mcp-shim-loc.test.ts`:** reads each `src/mcp/tools/*.ts` file, extracts the body between the `async (input) => {` and the matching `}`, counts non-blank non-comment statements, asserts ≤ 5. Throwaway regex-heuristic parsing is acceptable (research §MCP-03 ≤5-line shim attestation).

#### `tests/integration/mcp-runtime.test.ts` (NEW — D-29 transition)

**Closest analog:** `tests/integration/mcp-stdout-purity.test.ts` lines 1-80 — the spawn-`dist/mcp.mjs` + JSON-RPC handshake pattern.

**Excerpt from analog (`mcp-stdout-purity.test.ts:36-54`) — the fixture-list + path-resolution + timeout pattern:**

```ts
const FIXTURES = ['initialize', 'initialized', 'tools-list', 'whoop-doctor-call'] as const;
const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '..', '..');
const DIST_MCP = path.resolve(REPO_ROOT, 'dist', 'mcp.mjs');
const FIXTURES_DIR = path.resolve(REPO_ROOT, 'tests', 'fixtures', 'mcp');
const TOOLS_CALL_TIMEOUT_MS = 5000;

describe('MCP runtime (dist smoke)', () => {
  test('tools/list returns 8 tools', async () => {
    // spawn dist/mcp.mjs + drive JSON-RPC fixtures + assert
    expect(toolsListResult.tools).toHaveLength(8);
    expect(new Set(toolsListResult.tools.map(t => t.name))).toEqual(new Set([
      'whoop_doctor', 'whoop_sync', 'whoop_daily_review', 'whoop_weekly_review',
      'whoop_query_cache', 'whoop_add_decision', 'whoop_review_decisions', 'whoop_api_gap',
    ]));
    // similar for resources/list (6) and prompts/list (4)
  });
});
```

**Note on D-29 transition:** Phase 3's existing `tools.length === 1` attestation BREAKS INTENTIONALLY here. Gate H (new in Phase 4): `\btools\.length\s*===\s*1\b` is banned outside `tests/__legacy__/`.

#### `scripts/ci-grep-gates.sh` (EXTEND, ~30 LOC added)

**Source (analog == self):** existing gate definitions at lines 117-296 (Gates B-G).
**Pattern:** add three new gates following the existing per-gate skeleton (heredoc match → echo `::error::` → exit 1).

```sh
# Gate H — no `tools.length === 1` outside tests/__legacy__/ (D-29 transition)
# Gate I — no `server.registerResource` outside src/mcp/register-resource.ts (D-36)
# Gate J — no `server.registerPrompt`   outside src/mcp/register-prompt.ts   (D-36)
```

---

## No Analog Found

Files with no close analog in the existing codebase. Planner should use the templates above plus the research patterns directly.

| File | Layer | Reason | Pattern Source |
|------|-------|--------|----------------|
| `src/domain/stats/median.ts` | domain/stats | First pure-statistics module | Research §Statistical Engine §1 + Shared Pattern 1 |
| `src/domain/stats/mad.ts` | domain/stats | First MAD module; 1.4826 scaling factor is project-specific | Research §Statistical Engine §1 |
| `src/domain/stats/mann-whitney.ts` | domain/stats | No existing analog; depends on `simple-statistics` API | Research §Statistical Engine §4 |
| `src/domain/stats/fdr.ts` | domain/stats | No npm package ships BH-FDR; hand-rolled | Research §Statistical Engine §5 (verbatim implementation) |
| `src/domain/actions/catalog.ts` | domain/actions | First catalog data file with banned-word lint coverage | D-08/D-09 + research §Decision Ledger Persistence |
| `src/domain/actions/decision-prompts.ts` | domain/actions | Same as actions/catalog.ts | D-23 |
| `src/mcp/resources/summary-today.ts` (× 6 resources) | mcp/resources | First MCP resource handlers in the codebase | Research §MCP Surface §registerResource |
| `src/mcp/prompts/daily-decision-brief.ts` (× 4 prompts + build helper) | mcp/prompts | First MCP prompt handlers in the codebase | Research §MCP Surface §registerPrompt + D-27 |

For all of the above, the **closest shape precedent** in the codebase remains:

- **For pure-math + catalog modules:** `src/domain/dst-tz/detect.ts` (pure function, typed-input/typed-output, no I/O) + `src/domain/types/score.ts` (closed-tuple module-load constant pattern).
- **For MCP resources/prompts:** the `register.ts` wrapper pattern (try/catch/sanitize/return) is the discipline; the call-sites mirror `tools/whoop-doctor.ts` but with the resource/prompt return shape.

---

## RECOMMENDED PATTERN MAPPING APPROACH

Wave assignment order the planner should produce mirrors Phase 3's bottom-up dependency order:

1. **Wave 0 — Test stubs + fixtures + npm deps.** Install `ulid@^3.0.2` + `simple-statistics@^7.8.9`. Create all 38 test stubs from VALIDATION.md. Build the load-bearing REV-07 FDR-suppression fixture via deterministic generator under `tests/fixtures/review/_generators/`. Add Gates H/I/J to `scripts/ci-grep-gates.sh`. Audit MCP SDK `.d.ts` for `registerResource` static-URI signature confirmation (Assumption A4).
2. **Wave 1 — Domain types + pure math.** `src/domain/review/types.ts`, `confidence/types.ts`, `confidence/index.ts`, `stats/*` (4 files), `baselines/types.ts`, `baselines/index.ts`, `patterns/candidates.ts`, `patterns/types.ts`, `anomalies/types.ts`, `anomalies/direction.ts`. All pure, all unit-tested in isolation. Pattern: Shared Patterns 1 + 2.
3. **Wave 2 — Domain compositional modules.** `patterns/pattern.ts`, `anomalies/anomaly.ts`, `actions/catalog.ts`, `actions/decision-prompts.ts`, `actions/select.ts`. All pure, all unit-tested with fixture arrays.
4. **Wave 3 — Repo extension.** Extend `decisions.repo.ts` with 4 new methods (`updateOutcome`, `countSince`, `findByPrefix`, `listAll`). Pattern: existing `decisions.repo.ts:42-62` + `cycles.repo.ts:79-121`.
5. **Wave 4 — Services.** `services/review/{daily, weekly, resolve-date, data-status}.ts`, `services/decision/index.ts`, `services/cache/index.ts`, `services/api-gap/{index, data}.ts`. Pattern: `src/services/sync/index.ts` (typed Deps + typed Result + composition over repos). Extend `services/index.ts` + `services/bootstrap.ts` (additive).
6. **Wave 5 — Formatters.** All 5 new formatters. Pattern: `src/formatters/sync.txt.ts` (Shared Pattern 5). Each formatter ships with its own `*.test.ts` running fixtures through it.
7. **Wave 6 — MCP wrappers + tools + resources + prompts.** Add `register-resource.ts` + `register-prompt.ts` (Shared Pattern 8). Add 7 new tools (Shared Pattern 9 + `whoop-doctor.ts` analog). Add 6 resources + 4 prompts (no-analog templates). Switch `src/mcp/index.ts` from `createServices()` to `bootstrap()`. Add the runtime attestation in `tests/integration/mcp-runtime.test.ts` that flips `tools.length` from 1 → 8.
8. **Wave 7 — CLI commands + index wiring.** 7 new commands following Shared Patterns 6 + 7. Wire into `src/cli/index.ts`.
9. **Wave 8 — Contract tests + phase close.** Add `tests/contract/formatter-tone.test.ts` (Shared Pattern 5 + the existing `sync.txt.test.ts` Test 7 precedent), `mcp-tool-shape.test.ts`, `mcp-resource-shape.test.ts`, `mcp-prompt-shape.test.ts`, `mcp-shim-loc.test.ts`, `daily-review-shape.test.ts`. Flip REQUIREMENTS REQ-IDs (18 of them) to Complete. Mirror Plan 03-13's close pattern.

This order ensures that every wave's outputs are testable against fixtures that already exist (Wave 0), every analog file is read before the new file is written (the planner emits explicit `Read <analog>` actions in each plan), and the highest-risk areas (Wave 1 — the new pure-math modules with no analog) land first so confidence-tier discipline and statistical correctness are pinned before any service consumes them.

---

## Metadata

**Analog search scope:** `src/**` (full source tree), `tests/integration/**`, `tests/contract/**`, `scripts/ci-grep-gates.sh`.
**Files scanned:** ~80 (every existing `src/` TypeScript module).
**Strong matches:** 38 / 52 new files; 14 in "no analog exists" categories.
**Pattern extraction date:** 2026-05-16.
**Phase output file:** `.planning/phases/04-domain-math-reviews-decision-ledger-mcp-surface/04-PATTERNS.md`.

## PATTERN MAPPING COMPLETE

Phase 4 has strong precedents for ~73% of new files: every MCP tool reuses `whoop-doctor.ts` verbatim, every CLI command reuses `sync.ts`, every formatter reuses `sync.txt.ts`, every service reuses the `runSync(input, deps)` shape, and every repo write reuses the `db.transaction({behavior: 'immediate'})` discipline. The 27% with no analog (pure stats, MCP resources, MCP prompts) follow the patterns sketched in research §Statistical Engine and §MCP Surface — the planner should treat those sections of `04-RESEARCH.md` as the load-bearing template, with the codebase patterns above providing the discipline (sanitizer-wrapped registration, pure-function shape, closed-tuple discriminators, ADR-0004 typed positive output).
