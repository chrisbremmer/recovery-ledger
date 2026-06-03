---
phase: 10-architecture-refactor-cluster
plan: 04
type: execute
wave: 4
branch: refactor/10-arch-07-doctor-required-deps
depends_on: [10-03]
files_modified:
  - src/services/doctor/checks/data-quality-counts.ts
  - src/services/doctor/checks/db-open.ts
  - src/services/doctor/checks/db-integrity.ts
  - src/services/doctor/checks/db-wal-size.ts
  - src/services/doctor/checks/db-schema-version.ts
  - src/services/doctor/checks/last-sync-recency.ts
  - src/services/doctor/checks/most-recent-scored-day.ts
  - src/services/doctor/wiring.ts
  - src/services/doctor/checks/data-quality-counts.test.ts
  - src/services/doctor/checks/db-open.test.ts
  - src/services/doctor/checks/db-integrity.test.ts
  - src/services/doctor/checks/db-wal-size.test.ts
  - src/services/doctor/checks/db-schema-version.test.ts
  - src/services/doctor/checks/last-sync-recency.test.ts
  - src/services/doctor/checks/most-recent-scored-day.test.ts
autonomous: true
requirements: [ARCH-07]
must_haves:
  truths:
    - "Every doctor check that previously had `deps?: X` optional signature now has `deps: X` required signature"
    - "Every `?? (() => tokenStore.X())` and `?? deps.repos`-equivalent fallback is gone — the type system requires the deps from the caller"
    - "`createProductionDoctorDeps` in `wiring.ts` constructs the explicit `AuthProbeDeps` + `TokenFreshnessProbeDeps` shapes (plus shapes for any other check that was tightened) and threads them into `runDoctorImpl`"
    - "All 14 doctor checks audited; the 7 unaudited-in-prior-plans checks (data-quality-counts, db-open, db-integrity, db-wal-size, db-schema-version, last-sync-recency, most-recent-scored-day) have their `deps?` signatures tightened where appropriate"
    - "All doctor check unit tests pass against the new required-deps shape"
  artifacts:
    - path: src/services/doctor/wiring.ts
      provides: explicit construction of AuthProbeDeps, TokenFreshnessProbeDeps, and any other tightened ProbeDeps shapes; threads them into runDoctorImpl
    - path: src/services/doctor/checks/*.ts
      provides: 7 doctor checks with required deps, no fallback patterns
  key_links:
    - from: src/services/doctor/wiring.ts
      to: src/services/doctor/checks/*.ts
      via: explicit construction of probe deps
      pattern: "AuthProbeDeps|TokenFreshnessProbeDeps|DbOpenProbeDeps|DataQualityCountsDeps"
---

<objective>
Audit all 14 doctor checks and tighten every optional `deps?: X` signature to required `deps: X`. Drop any remaining `??` fallback patterns. Wire explicit probe-deps shapes in `wiring.ts`. The two checks with `tokenStore` fallback (auth.ts + token-freshness.ts) were already tightened in plan 10-02 Task 4; this plan handles the remaining 12 doctor checks + helpers.

Purpose: today's doctor checks mix `deps?: X` (optional) signatures with `??` fallbacks to production singletons (per RESEARCH §ARCH-07). Post-ARCH-02 the singletons are gone; the fallbacks are dead code. Tightening to required `deps` makes the contract explicit, matches the DI shape of non-doctor services (RESEARCH §Architectural Responsibility Map "Doctor probe DI shape"), and lets the wiring module own the dep construction.

Q4-RESOLVED: the audit covers all 14 doctor checks (not just the 2 from RESEARCH §ARCH-07). The grep audit (Task 1) enumerates them; the tightening (Tasks 2-3) applies the pattern uniformly.

Output: 7 source files + 7 test files + 1 `wiring.ts` edit. Net code delta is mildly negative (fallback lines deleted; explicit type annotations are smaller than the `??` boilerplate). PR `refactor/10-arch-07-doctor-required-deps` lands on its own branch off the latest `main`, merged via GitHub PR with explicit user approval.

Scope: this is a pure type-tightening refactor. No runtime behavior change for production callers (they were already passing deps explicitly per RESEARCH); the type-system contract surfaces missed paths at compile time. The unit tests already pass deps explicitly per RESEARCH §ARCH-07; the diff is mostly mechanical.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/STATE.md
@.planning/ROADMAP.md
@.planning/REQUIREMENTS.md
@.planning/phases/10-architecture-refactor-cluster/10-RESEARCH.md
@.planning/research-v1.1/ARCHITECTURE.md
@agent_docs/conventions.md
@agent_docs/workflows/contributing.md
@CLAUDE.md

<interfaces>
<!-- Key types and contracts the executor needs. Extracted from the live tree on 2026-06-03. -->
<!-- Executor should use these directly — no codebase exploration needed. -->

Grep audit results from `grep -n "deps?" src/services/doctor/checks/*.ts` (verified 2026-06-03):

| File | Line | Pattern |
|------|------|---------|
| auth.ts | 43 | `export async function probeAuth(deps?: AuthProbeDeps)` — TIGHTENED in plan 10-02 Task 4 |
| auth.ts | 44, 45 | `deps?.readStorageMode ?? (() => tokenStore.readStorageMode())` — TIGHTENED in plan 10-02 Task 4 |
| token-freshness.ts | 56 | `export async function probeTokenFreshness(deps?: TokenFreshnessProbeDeps)` — TIGHTENED in plan 10-02 Task 4 |
| token-freshness.ts | 57, 58 | `?? (() => tokenStore.read())` + `?? Date.now` — TIGHTENED in plan 10-02 Task 4 |
| data-quality-counts.ts | 51 | `export async function probeDataQualityCounts(deps?: DataQualityCountsDeps)` |
| data-quality-counts.ts | 52 | `if (!deps?.repos) {` |
| db-open.ts | 39 | `export async function probeDbOpen(deps?: DbOpenProbeDeps)` |
| db-open.ts | 40 | `if (!deps?.sqlite) {` |
| db-integrity.ts | 28 | `export async function probeDbIntegrity(deps?: DbIntegrityProbeDeps)` |
| db-integrity.ts | 29 | `if (!deps?.sqlite) {` |
| db-wal-size.ts | 40 | `export async function probeDbWalSize(deps?: DbWalSizeProbeDeps)` |
| db-wal-size.ts | 42 | `const walPath = \`${deps?.dbFile ?? paths.dbFile}-wal\`;` |
| db-schema-version.ts | 84 | `export async function probeDbSchemaVersion(deps?: DbSchemaVersionProbeDeps)` |
| db-schema-version.ts | 85 | `if (!deps?.sqlite) {` |
| last-sync-recency.ts | 65 | `deps?: LastSyncRecencyDeps,` (multi-line signature) |
| last-sync-recency.ts | 68 | `if (!deps?.repos) {` |
| most-recent-scored-day.ts | 58 | `deps?: MostRecentScoredDayDeps,` (multi-line signature) |
| most-recent-scored-day.ts | 61 | `if (!deps?.repos) {` |

**Critical distinction:** the 7 checks below have an `if (!deps?.X)` early-return that emits a "no <X> injected" / "skipped" probe result, allowing the no-DB `createServices()` path (RESEARCH §"createServices is the lightweight no-DB path") to run them with degraded output. Tightening these to required `deps` would force the no-DB path to break.

**Resolution path** (per RESEARCH §ARCH-07 + the `createServices()` light-surface discipline in `src/services/index.ts:155`):

Two-tier signature:
- **`createServices()` path** (no DB, no repos): doctor checks emit a `status: 'skipped'` or `status: 'no <X> injected'` result. This path is what the lightweight `runDoctor` no-DB wrapper uses. Today this lives in the `if (!deps?.X)` early returns.
- **`bootstrap()` path** (full surface): production deps are always passed; the early-return branch is dead code at runtime but the type allows it.

The cleanest tightening that preserves the no-DB path:
1. Keep the `deps?: X` optional signature for the 7 checks that have `if (!deps?.X)` early returns. These early returns ARE the contract for `createServices()`-routed probes. Tightening would break that path.
2. Drop the `?? tokenStore.X()` fallback pattern wherever it appears (it's gone in auth.ts + token-freshness.ts post-10-02; verify it's gone everywhere else).
3. For checks WITHOUT an `if (!deps?.X)` early return — i.e., checks that genuinely require deps and just used `??` as a vestigial fallback — tighten to required `deps: X`.

**Audit verdict:** based on the grep above, ALL 7 unaudited checks have `if (!deps?.X)` early returns that ARE the createServices()-path contract. **Tightening the signatures would break the no-DB path** per `src/services/index.ts` §"createServices()" comment that asserts D-31 discipline (compile-time guarantee that `runSync` etc. are absent from `ServicesBase`, but `runDoctor` IS present and is expected to handle no-DB gracefully).

**Therefore the tightening must be:**
- Keep `deps?: X` optional signature for the 7 checks with early returns. These are the createServices()-path contract.
- Drop any `?? tokenStore.X()` runtime fallback (none in the 7 checks per the grep — already gone or never present).
- Tighten the `wiring.ts`-side production construction: `createProductionDoctorDeps` in `wiring.ts` MUST explicitly construct a `ProbeDeps` shape for EACH of the 14 checks and thread them into `runDoctorImpl`. No implicit production-default fallbacks at the call site — the wiring module owns the production-dep construction.

This is the actual ARCH-07 contract per RESEARCH:
> "Production callers (`runDoctorImpl` at `bootstrap.ts:428-444`) **already pass these deps explicitly** — the fallback is vestigial from before `bootstrap()` existed."

So ARCH-07's job is: (a) confirm no `?? tokenStore.X()` fallback survives (grep gate); (b) ensure `wiring.ts` constructs the deps explicitly; (c) update the runDoctor entry point (`src/services/doctor/index.ts`) to consume the explicit deps from wiring.ts.

**Pivot:** instead of tightening the `deps?` signatures (which would break createServices()), this plan focuses on the OTHER half of ARCH-07: ensure the production wiring path (`wiring.ts` post-10-03) explicitly constructs every probe-deps shape, and that runDoctorImpl threads them through. The `deps?` optionality stays for the no-DB createServices() path.

If during execution the executor determines the `deps?` signature CAN be tightened without breaking createServices() (e.g., by making `createServices().runDoctor` route through a no-DB variant that pre-constructs degraded deps), the executor should propose that as a design choice during the PR. The simplest safe path is the pivot above.

Current `src/services/doctor/index.ts` shape (verified by reading the file): `runDoctor(opts: RunDoctorOptions)` accepts an opts bag with `sqlite?, repos?, refreshOrchestrator?, whoopFetcher?, migrationsDir?` and internally calls each probe with `{ sqlite, repos, ... }`-derived deps. Each probe receives its own narrow deps shape derived from these top-level opts.

`AuthProbeDeps` (post-10-02 in auth.ts):
```ts
export interface AuthProbeDeps {
  readStorageMode: () => Promise<'keychain' | 'file' | null>;
  readTokens: () => Promise<Tokens | null>;
}
```

`TokenFreshnessProbeDeps` (post-10-02 in token-freshness.ts):
```ts
export interface TokenFreshnessProbeDeps {
  read: () => Promise<Tokens | null>;
  now: () => number;
}
```

`wiring.ts` (post-10-03) target post-this-plan:
```ts
export function createProductionDoctorDeps(input: ProductionDoctorDepsInput) {
  // ...productionWhoopFetcher + whoopErrorKindToStatus from plan 10-03...

  // NEW in plan 10-04: explicit probe-deps construction
  const authDeps: AuthProbeDeps = {
    readStorageMode: () => input.tokenStore.readStorageMode(),
    readTokens: () => input.tokenStore.read(),
  };
  const tokenFreshnessDeps: TokenFreshnessProbeDeps = {
    read: () => input.tokenStore.read(),
    now: Date.now,
  };
  // ...similar explicit shapes for the other 12 probes...

  return (opts: RunDoctorOptions = {}) =>
    runDoctorImpl({
      ...opts,
      // The existing top-level fields (sqlite, repos, refreshOrchestrator, etc.)
      // continue to be passed. Additionally, the explicit probe deps are
      // passed where runDoctorImpl threads them into individual probes.
    });
}
```

**NOTE on input.tokenStore:** plan 10-02 added `tokenStore` to the `Bootstrapped.services` surface, so plan 10-03's `ProductionDoctorDepsInput` might or might not have a `tokenStore` field. **Verify**: read `src/services/doctor/wiring.ts` post-10-03 and confirm the `ProductionDoctorDepsInput` interface; if `tokenStore` is missing, ADD it in this plan (the explicit AuthProbeDeps + TokenFreshnessProbeDeps need it). The bootstrap.ts call site (post-10-03) passes `tokenStore` into `createProductionDoctorDeps({...})` — verify or add.

**Run audit grep at the start of execution** to confirm the 7-file table above hasn't drifted since 2026-06-03: `grep -n "deps?" src/services/doctor/checks/*.ts src/services/doctor/index.ts`. If the audit surfaces files NOT in the table (e.g., a new doctor check added by an interim phase), include them in this plan.
</interfaces>
</context>

<tasks>

<task type="auto">
  <name>Task 1: Audit all 14 doctor checks; confirm tightening pivot vs. createServices() contract</name>
  <files>src/services/doctor/checks/data-quality-counts.ts, src/services/doctor/checks/db-open.ts, src/services/doctor/checks/db-integrity.ts, src/services/doctor/checks/db-wal-size.ts, src/services/doctor/checks/db-schema-version.ts, src/services/doctor/checks/last-sync-recency.ts, src/services/doctor/checks/most-recent-scored-day.ts</files>
  <read_first>
    src/services/doctor/checks/auth.ts,
    src/services/doctor/checks/token-freshness.ts,
    src/services/doctor/checks/data-quality-counts.ts,
    src/services/doctor/checks/db-open.ts,
    src/services/doctor/checks/db-integrity.ts,
    src/services/doctor/checks/db-wal-size.ts,
    src/services/doctor/checks/db-schema-version.ts,
    src/services/doctor/checks/last-sync-recency.ts,
    src/services/doctor/checks/most-recent-scored-day.ts,
    src/services/doctor/index.ts,
    src/services/index.ts,
    .planning/phases/10-architecture-refactor-cluster/10-RESEARCH.md
  </read_first>
  <action>
Implements ARCH-07 audit phase (Q4-RESOLVED: all 14 doctor checks).

1. **Re-run the grep audit** to confirm the table in the `<interfaces>` block hasn't drifted: `grep -n "deps?\." src/services/doctor/checks/*.ts src/services/doctor/index.ts` and `grep -n "tokenStore\." src/services/doctor src/services/doctor/checks`. Capture the output. Verify each check's signature shape (`deps?: X` vs `deps: X`) and presence/absence of `?? (() => tokenStore.X())` fallbacks.

2. **For each of the 7 unaudited checks** (data-quality-counts, db-open, db-integrity, db-wal-size, db-schema-version, last-sync-recency, most-recent-scored-day), READ the file end-to-end and classify:

   **Class A — has `if (!deps?.X)` early return** (the createServices()-path contract; signature MUST stay optional `deps?: X`):
   - The early-return branch produces a `status: 'skipped'` or `status: 'no <X> injected'` doctor check result. This branch IS the no-DB-path contract; tightening would break `src/services/index.ts:createServices()`.
   - **Action for Class A**: signature stays `deps?: X`. Inside the function body, drop any `?? (() => tokenStore.X())` fallback pattern (use the early-return + the deps.X.assert path; no implicit production default). Verify the `if (!deps?.X)` branch produces a sensible no-DB-path result.

   **Class B — no early return; `deps?` was vestigial** (uses `??` with a production singleton or computed default that should always come from the caller):
   - **Action for Class B**: tighten signature to `deps: X` (drop `?`). Drop the `??` fallback. The TS compiler now requires the caller (wiring.ts or test) to pass deps explicitly.

   Per the `<interfaces>` grep table, expect ALL 7 unaudited checks to be Class A (they all have `if (!deps?.X)` early returns at the top). Confirm via reading. If any turn out to be Class B, tighten them.

3. **For each Class A check, drop any `tokenStore.X()` fallback** that the singleton-drop in plan 10-02 has already broken at the import level. For Class A, the fallback pattern is `?? (() => tokenStore.X())`; since the singleton no longer exists post-10-02, the import is already gone for the 2 checks that used it (auth.ts + token-freshness.ts). For the other 5 — verify none of them imported the singleton at all. (Per RESEARCH §ARCH-07, only auth.ts + token-freshness.ts had the `tokenStore` import; the other 5 used `paths.dbFile`-style fallbacks or were already deps-required.)

4. **Special case — db-wal-size.ts:42** uses `${deps?.dbFile ?? paths.dbFile}-wal`. This is NOT a singleton fallback; `paths` is a justified module-state collaborator per RESEARCH §"`logger`/`paths`/`rate-limit` retain module state with justification comments". This pattern STAYS — it's a sensible default that doesn't reach into bootstrap-owned state. Do NOT tighten this one beyond confirming the `deps?` signature shape.

5. **Document the audit verdict** as a comment block at the top of THIS PR's commit message (NOT in a separate file). The audit verdict goes into the PR description body so the user can verify the classification before approval.

6. **No file edits in this task** if all 7 checks are Class A — Task 2 handles the explicit `wiring.ts` construction. If any are Class B, tighten them HERE in Task 1 (the signature + fallback drop).

7. **Conventional commit** (if any file changes — none expected if all Class A): `refactor(10): tighten Class B doctor check signatures to required deps (ARCH-07)`. If no changes, skip this commit; Task 2 carries the substantive diff.
  </action>
  <verify>
    <automated>grep -n "deps?\." src/services/doctor/checks/*.ts > /tmp/doctor-audit.txt &amp;&amp; test -s /tmp/doctor-audit.txt &amp;&amp; grep -c "tokenStore\." src/services/doctor/checks/*.ts | grep -E ":0$|^0$" || true &amp;&amp; npm test -- src/services/doctor/checks/</automated>
  </verify>
  <acceptance_criteria>
    - The audit output (the `/tmp/doctor-audit.txt` file or its equivalent captured at start) enumerates the `deps?` patterns across all 14 doctor checks
    - For each check in the 7-file table, the executor has classified it Class A (early-return preserves createServices()) or Class B (vestigial — tightened in this task)
    - `grep -c "tokenStore\." src/services/doctor/checks/*.ts` returns `0` across all checks (no runtime singleton references; the post-10-02 deletion holds)
    - All existing doctor check unit tests pass: `npm test -- src/services/doctor/checks/`
    - If any Class B checks exist, they are now `deps: X` (required, no `?`) and their tests still pass
  </acceptance_criteria>
  <done>Audit complete; classification documented; any Class B checks tightened in this task; the rest deferred to Task 2's wiring-side explicit-construction work. All doctor check unit tests green.</done>
</task>

<task type="auto">
  <name>Task 2: Construct explicit ProbeDeps shapes in wiring.ts and thread them through runDoctorImpl</name>
  <files>src/services/doctor/wiring.ts</files>
  <read_first>
    src/services/doctor/wiring.ts,
    src/services/doctor/index.ts,
    src/services/doctor/checks/auth.ts,
    src/services/doctor/checks/token-freshness.ts,
    src/services/doctor/checks/data-quality-counts.ts,
    src/services/doctor/checks/db-open.ts,
    src/services/doctor/checks/db-integrity.ts,
    src/services/doctor/checks/db-wal-size.ts,
    src/services/doctor/checks/db-schema-version.ts,
    src/services/doctor/checks/last-sync-recency.ts,
    src/services/doctor/checks/most-recent-scored-day.ts,
    src/services/doctor/checks/native-modules.ts,
    src/services/doctor/checks/whoop-roundtrip.ts,
    src/services/doctor/checks/mcp-stdout-purity.ts,
    src/services/doctor/checks/concurrent-writers-stress.ts,
    src/services/bootstrap.ts,
    .planning/phases/10-architecture-refactor-cluster/10-RESEARCH.md
  </read_first>
  <action>
Implements ARCH-07's main contract: `wiring.ts` explicitly constructs probe deps; no implicit production defaults at the call site.

1. **Read `src/services/doctor/wiring.ts` (post-10-03 shape)** and `src/services/doctor/index.ts`. Identify how `runDoctorImpl` consumes top-level opts (`sqlite`, `repos`, `refreshOrchestrator`, `whoopFetcher`, `migrationsDir`) and threads them into individual probes. The probes today receive narrow per-check deps derived inside `runDoctorImpl`.

2. **Determine the threading pattern** — two options for plumbing explicit probe deps from `wiring.ts` through to the probes:

   **Option A — explicit probeDeps bag on RunDoctorOptions**: extend `RunDoctorOptions` with optional fields like `authProbeDeps?: AuthProbeDeps`, `tokenFreshnessProbeDeps?: TokenFreshnessProbeDeps`, etc. `wiring.ts` constructs and passes these. `runDoctorImpl` prefers `opts.authProbeDeps ?? derived-from-top-level-opts`. Test seam is explicit.

   **Option B — wiring.ts is the only construction site; pass shapes inline via the existing top-level opts**: `runDoctorImpl` derives per-check deps from `opts.sqlite`, `opts.repos`, etc., internally. This is what's there today. `wiring.ts` doesn't need to construct ProbeDeps explicitly — it just passes the top-level opts, and `runDoctorImpl` does the per-check derivation. The "ARCH-07 explicit probe deps" contract is satisfied by ensuring no `?? tokenStore.X()` fallback survives anywhere.

   **Decision: Option B**, justified by simplicity. `runDoctorImpl`'s existing per-check derivation IS the explicit construction; the "drop the fallbacks" half of ARCH-07 was the substantive change (already mostly done in plan 10-02 Task 4 for auth.ts + token-freshness.ts). The "construct explicit ProbeDeps in wiring.ts" framing in RESEARCH §ARCH-07 is one valid implementation; Option B satisfies the same contract with less indirection. **If during execution Option A turns out cleaner (e.g., because runDoctorImpl's per-check derivation has its own fallbacks that need removal), pivot to Option A and document why.**

3. **For Option B**: open `src/services/doctor/index.ts` (the `runDoctorImpl` body). For each probe call inside, verify the per-check deps construction is purely from `opts.X` (no module-state reach-in). The post-10-02 state should already be clean for auth.ts + token-freshness.ts. Check the remaining 12 probes' invocation sites in `runDoctorImpl`:

   - `probeAuth(authDeps)` where `authDeps` is constructed from `opts.tokenStore` (post-10-02 `tokenStore` is on the `Bootstrapped.services` surface; verify `runDoctorImpl` receives it via `opts` or constructs it locally — if locally, that's a SECOND construction site beyond bootstrap + auth.ts, violating Q7-RESOLVED. **Fix**: route through `opts.tokenStore` only; the wiring.ts factory passes `input.tokenStore` into the opts).
   - Similar verification for `probeTokenFreshness(tokenFreshnessDeps)`.
   - For the 12 probes that don't use `tokenStore`, verify `runDoctorImpl` constructs their deps purely from `opts.sqlite`, `opts.repos`, etc., with no module-state references.

4. **Wiring.ts edit** (if needed per the audit): ensure `ProductionDoctorDepsInput` includes a `tokenStore: TokenStore` field. If plan 10-03's Task 1 didn't add it (because plan 10-03 focused on extracting the existing block byte-for-byte and the existing block didn't reference tokenStore directly), ADD the field now. The wiring.ts factory then passes `input.tokenStore` into the runDoctorImpl opts so `probeAuth` + `probeTokenFreshness` can construct their deps from it.

5. **Bootstrap.ts may need a one-line edit**: ensure the `createProductionDoctorDeps({...})` call site passes `tokenStore` from the local const that plan 10-02 Task 1 added. Verify with `grep -n "createProductionDoctorDeps" src/services/bootstrap.ts`. The call site should look like `createProductionDoctorDeps({ sqlite, repos, refreshOrchestrator, authedCall, tokenStore, migrationsDir })`. If `tokenStore` is missing, add it.

6. **Final grep gate**: `grep -rn "tokenStore\b" src/services/doctor --include='*.ts'` must show only TYPE references (`Tokens` type imports) and tokenStore-as-input parameter references in wiring.ts — NO direct singleton calls (no `tokenStore.read()`, `tokenStore.write()`, etc.) at any site inside src/services/doctor/.

7. **Run all doctor unit tests + integration smoke**: `npm test -- src/services/doctor/`. The diff is mostly the wiring.ts addition + a possible bootstrap.ts one-liner; existing tests should pass unchanged.

8. **Conventional commit**: `refactor(10): explicit probe deps construction in wiring.ts; thread tokenStore through ProductionDoctorDepsInput (ARCH-07)`.
  </action>
  <verify>
    <automated>grep -rn "tokenStore\." src/services/doctor --include='*.ts' | grep -v ".test.ts" | grep -v "wiring.ts" | wc -l | grep -q "^0$" &amp;&amp; npm test -- src/services/doctor/ &amp;&amp; tsc --noEmit</automated>
  </verify>
  <acceptance_criteria>
    - `grep -rn "tokenStore\." src/services/doctor --include='*.ts'` shows references ONLY in wiring.ts and *.test.ts files (no direct singleton calls in production check code)
    - `grep -c "tokenStore: TokenStore" src/services/doctor/wiring.ts` returns at least `1` (the field is on `ProductionDoctorDepsInput`)
    - `grep -c "tokenStore" src/services/bootstrap.ts` shows the call site passes `tokenStore` into `createProductionDoctorDeps({...})`
    - `npm test -- src/services/doctor/` (all doctor tests including the new wiring.test.ts from plan 10-03) passes
    - `tsc --noEmit` passes
    - `npm run lint` passes
  </acceptance_criteria>
  <done>wiring.ts has an explicit `tokenStore: TokenStore` field on ProductionDoctorDepsInput; bootstrap.ts passes it through; no doctor check production code reaches into the tokenStore singleton (it's gone); all doctor unit tests + integration smoke green; tsc + lint green.</done>
</task>

<task type="auto">
  <name>Task 3: Update doctor check unit tests for any tightened signatures + run full suite + open PR</name>
  <files>src/services/doctor/checks/data-quality-counts.test.ts, src/services/doctor/checks/db-open.test.ts, src/services/doctor/checks/db-integrity.test.ts, src/services/doctor/checks/db-wal-size.test.ts, src/services/doctor/checks/db-schema-version.test.ts, src/services/doctor/checks/last-sync-recency.test.ts, src/services/doctor/checks/most-recent-scored-day.test.ts</files>
  <read_first>
    src/services/doctor/checks/data-quality-counts.test.ts,
    src/services/doctor/checks/db-open.test.ts,
    src/services/doctor/checks/db-integrity.test.ts,
    src/services/doctor/checks/db-wal-size.test.ts,
    src/services/doctor/checks/db-schema-version.test.ts,
    src/services/doctor/checks/last-sync-recency.test.ts,
    src/services/doctor/checks/most-recent-scored-day.test.ts,
    .planning/phases/10-architecture-refactor-cluster/10-RESEARCH.md
  </read_first>
  <action>
Test-side updates for Task 1 + Task 2 changes.

1. **If Task 1 tightened any Class B checks** (`deps?: X` → `deps: X`), the corresponding test files must update calls that previously omitted `deps` entirely. Read each test file; identify calls like `await probeX()` (no args) and change to `await probeX(constructedDeps)`. Most tests already pass deps explicitly per RESEARCH §ARCH-07; this is a minor cleanup.

2. **If Task 1 left all 7 checks as Class A**: the test files are likely unchanged. Verify by running `npm test -- src/services/doctor/checks/` and confirming green.

3. **Update any test that previously relied on the `tokenStore` singleton default for production deps**: per the audit in Task 1, only auth.ts + token-freshness.ts had this pattern, and they were updated in plan 10-02. Confirm via `grep -rn "tokenStore" src/services/doctor/checks/*.test.ts` — references should be ONLY to local fakes constructed in the test, not the deleted singleton.

4. **Run full suite**: `npm test`. Vitest pool: 'forks' per conventions; under 60s.

5. **Run `npm run lint` and `tsc --noEmit`**.

6. **Open PR per `agent_docs/workflows/contributing.md`**. PR title: `refactor(10): doctor checks use required deps; explicit ProbeDeps construction in wiring.ts (ARCH-07)`. PR body cites Q4-RESOLVED (audit covered all 14 checks); names the Class A vs. Class B verdict; cites the wiring.ts `tokenStore` field addition. Open the PR; await explicit user approval per branch policy; do NOT merge.

7. **Conventional commit**: `test(10): update doctor check tests for required deps + tightened wiring (ARCH-07)`.
  </action>
  <verify>
    <automated>npm test &amp;&amp; npm run lint &amp;&amp; tsc --noEmit &amp;&amp; bash scripts/ci-grep-gates.sh</automated>
  </verify>
  <acceptance_criteria>
    - `npm test` (full suite) passes; under 60s
    - `npm run lint` exits 0
    - `tsc --noEmit` exits 0
    - `bash scripts/ci-grep-gates.sh` exits 0 (all prior gates green; no new gate added in this plan)
    - `grep -rn "tokenStore" src/services/doctor/checks/*.test.ts` shows ONLY local-fake references (no singleton imports)
    - PR `refactor/10-arch-07-doctor-required-deps` opened off latest main; PR body documents the audit verdict + Q4-RESOLVED + wiring.ts changes; awaiting user approval (NOT merged automatically)
  </acceptance_criteria>
  <done>All doctor check tests pass against the post-ARCH-07 shape; full suite + lint + tsc green; PR opened on dedicated branch awaiting user approval.</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| `createServices()` no-DB path → doctor probes | Probes with `if (!deps?.X)` early returns must continue to emit "skipped" / "no <X> injected" for the no-DB path; the createServices() compile-time D-31 discipline is preserved |
| `wiring.ts` → individual probe deps | `ProductionDoctorDepsInput` is the construction site; production probes receive deps explicitly via runDoctorImpl threading |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-10-04-01 | Tampering | Tightening `deps?` to `deps` breaks `createServices()` no-DB path | mitigate | Task 1's classification (Class A vs Class B) explicitly identifies which checks support the no-DB path. Class A checks keep optional `deps?`; only Class B (vestigial fallbacks) get tightened. The `src/services/index.ts` createServices() comment documents the D-31 compile-time discipline; this plan preserves it. |
| T-10-04-02 | Tampering | Direct `tokenStore` calls survive in doctor checks despite the singleton drop | mitigate | Task 2's grep gate asserts `tokenStore.X` calls exist only in wiring.ts + test files. If any survive in production check code, the PR fails CI. |
| T-10-04-03 | Information Disclosure | Doctor probe error path leaks tokens via wiring.ts construction | mitigate | The wiring.ts factory captures `input.tokenStore` and constructs read closures (`() => input.tokenStore.read()`); the read returns Tokens objects which probes pass through their own redaction logic. FND-06 + SECH-01/02 redaction (in domain/observability per plan 10-01) covers all error paths. |
| T-10-04-SC | Tampering | npm/pip/cargo installs during this PR | accept | No new packages — pure type-tightening refactor |
</threat_model>

<verification>
- All 14 doctor checks audited; classification (Class A vs Class B) documented in PR body
- No production check code (excluding wiring.ts + test files) imports or calls the deleted `tokenStore` singleton
- `wiring.ts` `ProductionDoctorDepsInput` includes `tokenStore: TokenStore`; bootstrap.ts passes it through
- All doctor unit tests pass; integration tests pass
- Full suite green in <60s; lint + tsc green
- `createServices()` no-DB path preserved (D-31 compile-time discipline holds)
</verification>

<success_criteria>
- ARCH-07 closed: doctor checks use required-deps DI where appropriate (Class B); Class A checks preserve their no-DB-path contract; `?? tokenStore.X()` fallbacks are gone everywhere
- `wiring.ts` explicitly constructs probe deps via `ProductionDoctorDepsInput.tokenStore`
- All 14 doctor checks audited per Q4-RESOLVED
- PR `refactor/10-arch-07-doctor-required-deps` opened off latest main; user approval pending per branch policy
</success_criteria>

<output>
Create `.planning/phases/10-architecture-refactor-cluster/10-04-SUMMARY.md` when done. The summary MUST include the Class A / Class B classification for each of the 7 audited checks and document any pivot from Option B → Option A that the executor made.
</output>
