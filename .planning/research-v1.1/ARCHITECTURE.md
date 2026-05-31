# Architecture Research — v1.1 Quality Hardening

**Scope:** Issues #84 (layer violation), #85 (module-load singletons), tracker #95 placement debates.
**Authority:** `agent_docs/conventions.md` + `.planning/research/ARCHITECTURE.md` (lite hexagonal). Generic hexagonal theory is **not** the tiebreaker — repo conventions are.
**Confidence:** HIGH on #84 (single import, obvious fix). HIGH on #85 (singletons enumerated below). MEDIUM on #95 placement debates (judgement calls, but precedent exists in repo).

## The lite-hexagonal layering rule (one sentence)

`cli/` + `mcp/` → `services/` → (`domain/` ∪ `infrastructure/`). `domain/` imports nothing from below it. `infrastructure/` may import `domain/` types but **never** `services/`. `services/` is the only layer permitted to compose `domain/` + `infrastructure/`. (See `ARCHITECTURE.md` lines 76–82 + 911–919.)

---

## Issue #84 — `client.ts` imports from `services/` (single offender, easy fix)

**Today** (`src/infrastructure/whoop/client.ts:25`):

```ts
import { callWithAuth } from '../../services/refresh-orchestrator.js';
```

The only upward import is `callWithAuth`. Used at line 87 inside `httpGet`:

```ts
response = await callWithAuth(async (accessToken) =>
  fetch(url, { headers: { Authorization: `Bearer ${accessToken}` }, ... }),
);
```

**Why this is a violation:** `infrastructure/whoop/client.ts` is a driven adapter. `services/refresh-orchestrator.ts` is application-layer policy. The dependency arrow points the wrong way — and would block any future "swap WhoopClient for a Fake at the factory boundary" test seam (`ARCHITECTURE.md` line 747), because the fake would also drag the orchestrator in.

**Target shape:** invert via dependency injection (preferred) **or** move the orchestrator down (acceptable, weaker).

### Recommended fix: invert via injection at the `httpGet` boundary

`httpGet` already has a parameter list. Add an `authedCall` parameter, defaulting to the production-bound orchestrator wired in `bootstrap.ts`. Resource modules (`src/infrastructure/whoop/resources/*.ts`) currently call `httpGet(path, query, schema)` — they receive `authedCall` from the same composition root.

Target `client.ts`:

```ts
export type AuthedCall = <T extends { status: number }>(
  op: (accessToken: string) => Promise<T>,
) => Promise<T>;

export async function httpGet<T>(
  path: string, query: HttpGetQuery, schema: z.ZodSchema<T>,
  authedCall: AuthedCall,                       // <- new param
): Promise<T> { /* uses authedCall instead of imported callWithAuth */ }
```

Wiring at `bootstrap.ts:261-270`: pass `refreshOrchestrator.callWithAuth` into each resource-module factory (or partially apply at bootstrap time so resource modules keep their existing `(path, query, schema)` arity).

**Migration steps:**
1. Add `authedCall` parameter + `AuthedCall` type export in `src/infrastructure/whoop/client.ts`. Remove the `services/refresh-orchestrator` import (line 25).
2. Convert resource modules to factories (`src/infrastructure/whoop/resources/{cycles,recovery,sleep,workouts,profile,body-measurements}.ts`) — each becomes `createListCycles(deps) => (input) => httpGet(..., deps.authedCall)`.
3. Wire in `src/services/bootstrap.ts:261-270` — pass `{ authedCall: refreshOrchestrator.callWithAuth }` into each `createList*` factory. The `whoop.resources` map keeps its current shape.
4. Update `src/services/bootstrap.ts:361` (the doctor's `productionWhoopFetcher`) to also receive `authedCall` — it currently calls `httpGet('/v2/user/profile/basic', {}, WhoopRawProfile)` and inherits the bad import transitively.
5. Update tests: `src/infrastructure/whoop/client.test.ts`, the six `resources/*.test.ts`, and any contract tests. Each test now passes a fake `authedCall: (op) => op('test-token')` — which is actually *simpler* than today's MSW + token-store mocking.

**ADR impact:**
- **ADR-0002 (single-flight refresh):** UNCHANGED. The production singleton (`refreshOrchestrator` in `refresh-orchestrator.ts:131`) is still the only `callWithAuth` wired in production. Tests get an injection seam; production still has a chokepoint.
- **ADR-0007 (read-only WHOOP):** UNCHANGED. `httpGet` remains GET-only; the auth wrapper is orthogonal.
- **ADR-0001 (MCP stdout purity):** UNCHANGED.

### Alternative (rejected): move `refresh-orchestrator.ts` to `infrastructure/whoop/`

This eliminates the upward import without DI plumbing. Rejected because the orchestrator is *policy* (1-retry budget, 401→re-read→retry decision tree per `refresh-orchestrator.ts:78-126`), not a wire-protocol concern. Policy lives in `services/` per `ARCHITECTURE.md` line 75 ("Use-case orchestration… composes domain + infrastructure"). Moving it down would invert the more important coupling. Use DI.

---

## Issue #85 — Module-load singletons bypassing the composition root

`bootstrap.ts` is supposed to be "the ONE place every runtime collaborator is wired together" (its own header, line 1). Today, several `export const x = new X()` or `export const x = createY()` lines at module-load time create collaborators that **predate** `bootstrap()` running. Listed below in priority order:

### S1. `tokenStore` — `src/infrastructure/whoop/token-store.ts:496`

```ts
export const tokenStore: TokenStore = createTokenStore();
```

**Why this matters:** every refresh path goes through this singleton (ADR-0002 three-layer gate). Tests today must reach into `createTokenStore({ paths, now })` and *not* import the singleton — but the singleton is what production code references through transitive imports. The `bootstrap()` call signature has no test-seam knob for it.

**Target shape:** keep `createTokenStore()` as the factory; let `bootstrap()` accept an optional `tokenStore?: TokenStore` (defaulting to a fresh `createTokenStore()`); thread it to `refreshOrchestrator` via `createRefreshOrchestrator(store)` (already exported at `refresh-orchestrator.ts:72`). Drop the `export const tokenStore` and the `export const refreshOrchestrator` (next item).

### S2. `refreshOrchestrator` + `callWithAuth` — `src/services/refresh-orchestrator.ts:131,140`

```ts
export const refreshOrchestrator: RefreshOrchestrator =
  createRefreshOrchestrator(defaultTokenStore);
export const callWithAuth = refreshOrchestrator.callWithAuth.bind(refreshOrchestrator);
```

These are *only* still here because `client.ts` imports `callWithAuth` directly (issue #84). Once #84 is fixed via DI, both can be deleted; `bootstrap()` constructs the orchestrator from its `tokenStore` and exposes it on `services`.

### S3. `logger` — `src/infrastructure/config/logger.ts:92`

```ts
export const logger = createLogger(process.env);
```

**Keep this one.** Logger is a leaf utility; making it bootstrap-only would force every error path (including `paths.ts` failures *before* `bootstrap()` returns) to thread a logger param. Cost > benefit. Keep as a singleton, document the exception. Bootstrap already accepts an override (`BootstrapOptions.logger`, `bootstrap.ts:173`) for tests.

### S4. `paths` — `src/infrastructure/config/paths.ts:112`

```ts
export const paths: ResolvedPaths = new Proxy({} as ResolvedPaths, { ... });
```

**Keep.** Same rationale as logger — leaf, lazy-resolved, already env-overridable for tests via `RECOVERY_LEDGER_HOME`. Not in the same risk class as `tokenStore`.

### S5. `rate-limit.ts` module-level state — `src/infrastructure/whoop/rate-limit.ts:44-54`

```ts
let pending: Array<() => void> = [];
let inFlight = 0;
let nextAllowedAcquireAt = 0;
```

**Keep.** The comment block (lines 14–18) explicitly justifies this: "multiple `httpGet` call sites… share the same in-process budget." Bootstrap is per-process; the semaphore is per-process; there's no test seam needed beyond `_resetForTest()` which already exists (line 170). If reframing for clarity, expose a `createRateLimiter()` factory + module singleton — but functionally equivalent.

### Migration steps for #85 (S1 + S2 together)

1. Delete `export const tokenStore` from `src/infrastructure/whoop/token-store.ts:496`. Keep `createTokenStore` exported.
2. Delete `export const refreshOrchestrator` + `export const callWithAuth` from `src/services/refresh-orchestrator.ts:131,140`. Keep `createRefreshOrchestrator`.
3. Update `src/services/bootstrap.ts`:
   - Construct `const tokenStore = opts.tokenStore ?? createTokenStore();` at the top.
   - Construct `const refreshOrchestrator = createRefreshOrchestrator(tokenStore);` next.
   - Expose both on `Bootstrapped.services` (the `refreshOrchestrator` is already exposed at line 416 — change source).
4. Audit imports — every `import { tokenStore }` or `import { callWithAuth, refreshOrchestrator }` outside `bootstrap.ts` must move to receiving the value via deps. Known sites:
   - `src/services/refresh-orchestrator.ts:34` (`defaultTokenStore` import) — only used by the deleted singleton; remove with it.
   - `src/services/doctor/checks/token-freshness.ts:57` and `auth.ts:44-45` — these read `tokenStore.read()` as a default for an injected `deps.read`. Switch the default to "skip if no tokenStore passed" *or* receive `tokenStore` via the doctor's deps shape (cleaner).
   - `src/services/bootstrap.ts:116` (`refreshOrchestrator` import) — replaced by the local construction above.

**Blast radius:** roughly 6 files change in `src/`, plus ~10 test files that previously relied on the singleton existing at module load. None of the production callers care about identity — they call `.read()` / `.callWithAuth()`.

**ADR impact:**
- **ADR-0002:** UNCHANGED in behavior. The three-layer gate (in-process promise, file lock, atomic write) lives inside `createTokenStore()` — making it bootstrap-injected doesn't dilute the chokepoint as long as `bootstrap()` only constructs one. Worth adding a sentence to ADR-0002 §Enforcement: "Production code constructs `tokenStore` exactly once via `bootstrap()`; the singleton-at-module-load pattern is forbidden."
- **ADR-0001:** UNCHANGED.

---

## Tracker #95 placement debates — resolutions

### P1. `refresh-orchestrator.ts` location

**Today:** `src/services/refresh-orchestrator.ts`.
**Resolution:** **Stay in `services/`**. It's policy (retry budget = 1, 401 decision tree). The orchestrator's only *direct* infrastructure dependency is `TokenStore` (`refresh-orchestrator.ts:35`), and that's an interface — exactly the dependency direction lite hexagonal wants. The reason it *feels* infrastructural is the broken arrow from `client.ts` (issue #84). Fix #84 first; the placement question dissolves.

### P2. `services/index.ts` is barrel + policy

**Today:** `index.ts` defines `ServicesBase` and `Services` *interfaces* AND re-exports `runDoctor`, `refreshOrchestrator`, type unions, and `createServices()` factory (`services/index.ts:36-156`).
**Resolution:** This is fine. The "policy" is *which methods belong on the public service surface* — and that belongs with the barrel because the barrel **is** the public surface. Splitting into `index.ts` (barrel) + `policy.ts` (interfaces) would buy zero clarity. The one cleanup: move `createServices()` (the no-DB compatibility factory at line 151) into its own `services/factory.ts` so the barrel is *only* re-exports + type interfaces. Low priority.

### P3. `sanitize` location

**Today:** `src/infrastructure/observability/sanitize.ts` — imported from 20+ transport + service sites (see grep above).
**Resolution:** **Move to `domain/observability/sanitize.ts`** (or `src/shared/sanitize.ts`). The sanitizer is pure string transformation with no I/O — it has no business being in `infrastructure/`. The current placement is the reason transports (`src/mcp/register.ts:17`, `register-prompt.ts:20`, `register-resource.ts:25`, `src/cli/commands/*.ts`) reach across into `infrastructure/` — a direction the layering rule forbids (transports → services only, per `ARCHITECTURE.md` line 74).

Migration: `git mv src/infrastructure/observability/sanitize.ts src/domain/sanitize.ts` + rewrite ~20 import paths. Pure mechanical. Risk: near zero.

### P4. `services/api-gap/` is over-structured

**Today:** 3 files (`index.ts`, `data.ts`, `types.ts`) for what's effectively `getApiGap(): Promise<{ entries: ApiGapEntry[] }>` returning a frozen 6-element constant.
**Resolution:** **Inline.** Move the `API_GAP_ENTRIES` constant + `ApiGapEntry` type into a single `src/services/api-gap.ts` (no directory). The "Phase 5 reads `API_GAP_ENTRIES` directly to generate markdown" justification in `data.ts:6-7` is preserved — it still exports the constant. Saves 2 files + 1 directory.

### P5. Doctor probes use ad-hoc DI inconsistent with services

**Today:** `deps?.read ?? (() => tokenStore.read())` pattern in `src/services/doctor/checks/token-freshness.ts:57`, `auth.ts:44-45`, and 7 others (see grep above).
**Resolution:** **Standardize to required deps** (no `?`-optional, no `??` defaults), construct production deps in `bootstrap.ts:376-392` (already done for the doctor as a whole — `services_runDoctor` pre-binds). The per-check defaults are vestigial from before `bootstrap()` existed. Tightening probes' deps shape is low-risk — the call site (`runDoctorImpl` at `bootstrap.ts:377`) already passes everything.

This becomes much cleaner *after* #85 lands (no `tokenStore` import to fall back to anymore).

### P6. `bootstrap.ts:320-392` carries production WHOOP probe wiring

**Today:** `productionWhoopFetcher` (lines 356-367) and `whoopErrorKindToStatus` (lines 342-355) and `services_runDoctor` (376-392) all live in `bootstrap.ts`. That's 70 lines of doctor-specific construction in the composition root.
**Resolution:** **Move to `src/services/doctor/wiring.ts`** (or `src/services/doctor/production-deps.ts`). Export a single `createProductionDoctorDeps({ sqlite, repos, refreshOrchestrator, migrationsDir })` → returns the deps object. `bootstrap.ts` then calls it and passes the result into `runDoctorImpl`.

**Why:** the composition root should compose; it should not *define* per-service production wiring. The current shape couples bootstrap to WHOOP HTTP details (the `httpGet` call at line 361, the error-kind mapping). Pulling it out makes bootstrap thinner and gives the doctor team a place to evolve probe wiring without touching the composition root.

---

## Recommended build order

**Why this order:** #85 unlocks #84's clean fix. Fixing #85's `tokenStore` singleton first means the DI plumbing for #84 (passing `authedCall` through resource factories) has a natural place to land — `bootstrap()` already constructs the orchestrator from the injected `tokenStore`. Doing #84 first leaves `callWithAuth` as a module-load export that bootstrap doesn't own; you'd fix it twice.

1. **P3 (move sanitize to `domain/`)** — pure mechanical, unblocks no one, but it's the cleanest first PR and ratchets the layering rule. 1 hour.
2. **#85 (drop `tokenStore` + `refreshOrchestrator` singletons)** — bootstrap now owns the auth-related collaborators. ~6 source files + ~10 test files. 2–3 hours.
3. **#84 (inject `authedCall` into resource factories)** — straightforward once `bootstrap()` owns the orchestrator. ~8 files. 2 hours.
4. **P6 (extract doctor production wiring from bootstrap)** — 70 lines move out; bootstrap shrinks. 1 hour.
5. **P5 (standardize doctor-check DI)** — depends on #85 (no more `tokenStore` fallback to remove). 1 hour.
6. **P4 (inline `api-gap/`)** — cosmetic. Last. 15 minutes.
7. **P2 (split barrel/factory)** — optional cosmetic; defer or skip.

**Blast radius for #85** (largest concern in the question): bootstrap edits touch every test file that constructs a `Bootstrapped` instance. Mitigation: keep `bootstrap()`'s default behavior identical — `opts.tokenStore` defaults to `createTokenStore()`, so callers that pass no options see no change. Only callers that previously imported `tokenStore` directly need touching. Grep `src/` for `import.*tokenStore` after the change to confirm zero residual upstream-of-bootstrap singletons.

## ADR impact summary

| Change | ADR-0001 | ADR-0002 | ADR-0007 | Other |
|---|---|---|---|---|
| #84 invert via DI | unchanged | unchanged | unchanged | none |
| #85 drop singletons | unchanged | tighten §Enforcement to forbid module-load singletons | unchanged | none |
| P3 move sanitize to domain | unchanged | unchanged | unchanged | tightens layering rule (worth a learnings.md entry) |
| P6 move doctor wiring out of bootstrap | unchanged | unchanged | unchanged | none |

No ADR is broken by these changes. ADR-0002 is the only one that benefits from a textual update — to make the "exactly one tokenStore per process, wired by bootstrap" rule explicit.
