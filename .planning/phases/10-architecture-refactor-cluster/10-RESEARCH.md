# Phase 10 Research — Architecture Refactor Cluster

**Researched:** 2026-06-03
**Domain:** Brownfield architectural refactor (lite-hexagonal layering enforcement, composition-root ownership, DI cleanup)
**Confidence:** HIGH — milestone-level research already settled the substantive analysis at `.planning/research-v1.1/ARCHITECTURE.md`. This file translates that into phase-scoped, plannable units.

## Goal restatement + build-order summary

Phase 10 lands the v1.1 architecture cluster: enforce the layering rule, drop module-load singletons so `bootstrap()` is the one place every runtime collaborator is constructed, invert the `client.ts → services/` arrow via DI, and clean up the doctor wiring. Build order is non-negotiable per `.planning/research-v1.1/ARCHITECTURE.md` §Recommended build order, because **#85 unlocks #84's clean fix** (fixing #85 first means `bootstrap()` already owns the orchestrator when `authedCall` DI plumbing needs a place to land — doing #84 first would require fixing `callWithAuth` twice).

Order: **ARCH-01 → ARCH-02 → ARCH-03 → ARCH-06 → ARCH-07 → ARCH-08**. ARCH-04 (single import path for `AuthError`/`MigrationError`) and ARCH-05 (`withBootstrap` helper) are **already closed** (see §ARCH-04 and §ARCH-05 below) — they shipped pre-Phase 10 in earlier PRs and the planner can skip plans for them. ADR-0002 §Enforcement gets a one-sentence amendment in ARCH-02.

Authority for everything below: `.planning/research-v1.1/ARCHITECTURE.md` + `.planning/research/ARCHITECTURE.md` (lite-hexagonal canonical) + `agent_docs/conventions.md`. This file does not re-derive those; it cites them. [CITED: `.planning/research-v1.1/ARCHITECTURE.md`]

## Project Constraints (from CLAUDE.md / AGENTS.md)

- **ADR-0001 (MCP stdout purity):** no `console.*` in MCP-reachable code; structured Pino → stderr only. Every refactored file must preserve this. [CITED: `agent_docs/decisions/0001-mcp-stdout-purity.md`]
- **ADR-0002 (single-flight OAuth refresh):** three-layer gate (in-process Promise, file lock, atomic write). ARCH-02 amends §Enforcement to lock the "exactly one tokenStore per process" invariant. [CITED: `agent_docs/decisions/0002-single-flight-oauth-refresh.md`]
- **ADR-0007 (read-only WHOOP):** GET-only `httpGet`; ARCH-03's DI invert must preserve this. [CITED: `agent_docs/decisions/0007-whoop-read-only.md`]
- **Module layout (lite hexagonal):** `cli/ + mcp/ → services/ → domain/ ∪ infrastructure/`. `domain/` imports nothing from below. `infrastructure/` never imports `services/`. [CITED: `agent_docs/conventions.md` §"Module layout"]
- **TypeScript strict, no default exports, ESM only.** All new/moved files must conform. [CITED: `agent_docs/conventions.md` §"Code style"]
- **Branch policy:** every code change goes through worktree + branch + PR + explicit user approval; never push to `main`. Phase 10 = 6 PRs in build order. [CITED: `AGENTS.md` §"Branch policy"]
- **Conventional commits:** `refactor(10): ...` for non-behavior-changing PRs; `docs(10): ...` for the ADR-0002 amendment. [CITED: `agent_docs/workflows/contributing.md`]

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Layering enforcement | `domain/` ← `infrastructure/` ← `services/` ← `cli/`+`mcp/` | n/a | Pure rule from `agent_docs/conventions.md`. The whole phase exists to enforce it. |
| Sanitization (`sanitize`, `serializeError`) | `domain/` | n/a | Pure string transform, no I/O — ARCH-01 moves it here. Transports stop reaching into `infrastructure/`. |
| Token storage construction | `services/bootstrap.ts` (composition) | `infrastructure/whoop/token-store.ts` (factory only) | ARCH-02 — `bootstrap()` is the one place tokenStore is constructed; `createTokenStore()` stays as factory. |
| Refresh-orchestrator construction | `services/bootstrap.ts` (composition) | `services/refresh-orchestrator.ts` (factory only) | ARCH-02 — `bootstrap()` owns construction; factory stays in services because retry policy is policy, not wire-protocol. |
| WHOOP HTTP call site (auth threading) | `infrastructure/whoop/client.ts` (HTTP) | `bootstrap.ts` (injects `authedCall`) | ARCH-03 — `httpGet` receives `authedCall` as a parameter; bootstrap wires it. No upward import. |
| Doctor production wiring | `services/doctor/wiring.ts` (NEW) | `services/bootstrap.ts` (composes wiring helper) | ARCH-06 — bootstrap shouldn't define per-service production wiring; the doctor module owns its own. |
| Doctor probe DI shape | `services/doctor/checks/*.ts` (required deps) | `bootstrap.ts` / `wiring.ts` (passes deps) | ARCH-07 — drop `deps?.x ?? tokenStore.x()` fallbacks; required deps only, mirroring non-doctor services. |
| api-gap catalog | `domain/api-gap/catalog.ts` (NEW, pure data) | `services/api-gap.ts` (single-file accessor) | ARCH-08 — frozen 6-element constant is pure data, belongs in domain. Service wrapper collapses to one file. |

---

## ARCH-01 — `sanitize` → `domain/observability/`

**Verbatim from REQUIREMENTS.md §ARCH-01:** "`sanitize` and `serializeError` live under `src/domain/observability/` (pure string transforms; no I/O) — transports stop importing from `infrastructure/observability/`."

### Current state

- **File:** `src/infrastructure/observability/sanitize.ts` (10.5 KB, 254 lines). `sanitize.test.ts` (40.5 KB) is its co-located test suite. [VERIFIED: `ls -la src/infrastructure/observability/`]
- **Importers — 23 source files reach `infrastructure/observability/sanitize`:** [VERIFIED: `grep -rln "from.*observability/sanitize" src tests --include="*.ts"`]
  - 4 transport files: `src/mcp/index.ts`, `register.ts`, `register-prompt.ts`, `register-resource.ts`
  - 8 CLI commands: `auth.ts`, `decision-add.ts`, `decision-review.ts`, `decision-update.ts`, `doctor.ts`, `init.ts`, `query.ts`, `review-daily.ts`, `review-weekly.ts`, `sync.ts`
  - 6 doctor checks under `src/services/doctor/checks/`: `auth.ts`, `data-quality-counts.ts`, `last-sync-recency.ts`, `most-recent-scored-day.ts`, `token-freshness.ts`, `whoop-roundtrip.ts`
  - 2 infrastructure: `oauth.ts`, `errors.test.ts`
  - 1 lib: `src/cli/lib/with-bootstrap.ts`
- **Layering violation today:** the 4 MCP files and 6 doctor checks (services-layer) all reach `import { sanitize } from '...infrastructure/observability/sanitize.js'`. This is the direction the layering rule forbids — transports/services should not import from infrastructure for a pure string-transform utility. [CITED: `.planning/research-v1.1/ARCHITECTURE.md` §P3 "sanitize location"]

### Target state

- **New file:** `src/domain/observability/sanitize.ts` (mechanical move; same content). `sanitize.test.ts` moves with it.
- **Updated importers:** 23 import paths rewritten from `'.../infrastructure/observability/sanitize.js'` → `'.../domain/observability/sanitize.js'`.
- **Architecturally clean:** transports and services now import from domain — the layering rule holds.

```ts
// Before (services/doctor/checks/auth.ts:28):
import { sanitize } from '../../../infrastructure/observability/sanitize.js';
// After:
import { sanitize } from '../../../domain/observability/sanitize.js';
```

**Note on `serializeError`:** the REQ-text mentions `serializeError` alongside `sanitize`. As of 2026-06-03 there is no `serializeError` function in `src/infrastructure/observability/`. The directory contains exactly `sanitize.ts` + `sanitize.test.ts`. [VERIFIED: `ls -la src/infrastructure/observability/`] The REQ mentions a sibling that doesn't exist; the planner should treat it as forward-looking or strike it from the success criteria.

### Why this ordering position (1st)

Independent — depends on nothing, unblocks nothing. Cleanest first PR. Ratchets the layering rule and creates an early measurable result (transports stop importing from `infrastructure/observability/`). Lowest risk in the phase. [CITED: `.planning/research-v1.1/ARCHITECTURE.md` §"Recommended build order" step 1]

### Files modified

- **Created:** `src/domain/observability/sanitize.ts`, `src/domain/observability/sanitize.test.ts`
- **Deleted:** `src/infrastructure/observability/sanitize.ts`, `src/infrastructure/observability/sanitize.test.ts`
- **Imports rewritten (23 files, listed above)**

### Test impact

- `sanitize.test.ts` moves with the source; no logic changes; existing coverage stays intact.
- Every importer's existing tests pass unchanged (mechanical path swap; behavior identical).
- **No fixtures break.**

### Closed? **NO.** Verified 2026-06-03: `src/infrastructure/observability/sanitize.ts` exists; `src/domain/observability/` does not exist. ARCH-01 stands. [VERIFIED: `ls -la src/infrastructure/observability/ src/domain/observability/`]

---

## ARCH-02 — Drop `tokenStore` + `refreshOrchestrator` singletons

**Verbatim from REQUIREMENTS.md §ARCH-02:** "Module-load singletons (`tokenStore` in `token-store.ts:496`, `refreshOrchestrator`/`callWithAuth` in `refresh-orchestrator.ts:131,140`) are removed; `bootstrap()` constructs each exactly once and threads them via DI; `logger`/`paths`/`rate-limit` retain module state with justification comments."

### Current state

- **`src/infrastructure/whoop/token-store.ts:521`** [VERIFIED: `grep -n "export const tokenStore"` — note: REQ cites line 496; **actual current line is 521**, the file has grown since the milestone research]:
  ```ts
  export const tokenStore: TokenStore = createTokenStore();
  ```
- **`src/services/refresh-orchestrator.ts:132,141`** [VERIFIED: same grep — note: REQ cites lines 131,140; **actual current lines are 132,141**]:
  ```ts
  export const refreshOrchestrator: RefreshOrchestrator =
    createRefreshOrchestrator(defaultTokenStore);
  // ...
  export const callWithAuth = refreshOrchestrator.callWithAuth.bind(refreshOrchestrator);
  ```
- **`src/services/refresh-orchestrator.ts:33`** imports `tokenStore as defaultTokenStore` from token-store.ts — this is the only consumer of the singleton-via-rename, and it's used solely to bind the deleted `export const refreshOrchestrator`. Both die together.
- **`src/services/bootstrap.ts:121`** has `import { refreshOrchestrator } from './refresh-orchestrator.js';` — used at line 438 (`opts.refreshOrchestrator ?? refreshOrchestrator`) and line 468 (`services.refreshOrchestrator: refreshOrchestrator`).
- **3 remaining `tokenStore` importers (outside bootstrap)** [VERIFIED: `grep -rn "import.*tokenStore" src --include="*.ts"`]:
  - `src/cli/commands/auth.ts:40` — calls `tokenStore.write(tokens)` after OAuth code exchange
  - `src/services/doctor/checks/auth.ts:29` — calls `tokenStore.readStorageMode()` / `tokenStore.read()` as defaults for injected `deps.read*` (the ARCH-07 pattern)
  - `src/services/doctor/checks/token-freshness.ts:24` — same pattern: `deps?.read ?? (() => tokenStore.read())`

### Target state

`bootstrap()` constructs both collaborators exactly once; consumers receive them via deps; the production singletons disappear.

```ts
// src/services/bootstrap.ts — new fragment near top of bootstrap()
const tokenStore = opts.tokenStore ?? createTokenStore();
const refreshOrchestrator = createRefreshOrchestrator(tokenStore);
// ... later in the return:
return {
  // ...
  services: {
    // ...
    refreshOrchestrator,  // already in Bootstrapped surface (line 468)
    tokenStore,           // NEW — needed so auth.ts CLI can call .write()
  },
};
```

```ts
// src/infrastructure/whoop/token-store.ts — DELETE line 521:
- export const tokenStore: TokenStore = createTokenStore();
// (createTokenStore stays exported as the factory.)

// src/services/refresh-orchestrator.ts — DELETE lines 32-36 + 132-141:
- import { tokenStore as defaultTokenStore, ... } from '../infrastructure/whoop/token-store.js';
+ import { REFRESH_BUFFER_MS, type TokenStore } from '../infrastructure/whoop/token-store.js';
- export const refreshOrchestrator: RefreshOrchestrator =
-   createRefreshOrchestrator(defaultTokenStore);
- export const callWithAuth = refreshOrchestrator.callWithAuth.bind(refreshOrchestrator);
// (createRefreshOrchestrator stays exported as the factory.)
```

```ts
// src/cli/commands/auth.ts — receive tokenStore from bootstrap:
- import { tokenStore } from '../../infrastructure/whoop/token-store.js';
+ // tokenStore now comes from the bootstrap() return — already invoked by tryBootstrap
+ // line 117: await tokenStore.write(tokens) → await app.services.tokenStore.write(tokens)
```

```ts
// src/services/doctor/checks/auth.ts + token-freshness.ts — required deps
// (also lands in ARCH-07; doing it here saves a round trip):
- read?: () => Promise<Tokens | null>;
+ read: () => Promise<Tokens | null>;
- const read = deps?.read ?? (() => tokenStore.read());
+ const read = deps.read;
```

### Bootstrap-options surface change

```ts
export interface BootstrapOptions {
  dbFile?: string;
  migrationsDir?: string;
  logger?: Logger;
  tokenStore?: TokenStore;        // NEW — defaults to createTokenStore()
}
```

### Why this ordering position (2nd)

Must land before ARCH-03 (#84). ARCH-03 inverts `client.ts → services/refresh-orchestrator.ts` via DI, and the cleanest place for that DI to land is "the orchestrator bootstrap already constructed." Doing ARCH-03 first leaves `callWithAuth` as a module-load export that bootstrap doesn't own; you'd fix it twice. [CITED: `.planning/research-v1.1/ARCHITECTURE.md` §"Recommended build order" — explicit rationale]

### Files modified

- **`src/infrastructure/whoop/token-store.ts`** — delete line 521
- **`src/services/refresh-orchestrator.ts`** — delete imports + singletons (lines 32-36, 132-141)
- **`src/services/bootstrap.ts`** — add `tokenStore`/`refreshOrchestrator` construction; thread through; widen `BootstrapOptions`; surface `tokenStore` on `services`
- **`src/cli/commands/auth.ts`** — drop direct import; use `app.services.tokenStore.write()`
- **`src/services/doctor/checks/auth.ts`** — drop default fallback; required deps (also part of ARCH-07)
- **`src/services/doctor/checks/token-freshness.ts`** — drop default fallback; required deps (also part of ARCH-07)
- **`agent_docs/decisions/0002-single-flight-oauth-refresh.md`** — §Enforcement amendment (see cross-cutting §ADR-0002 amendment text)

### Test impact

- **`src/infrastructure/whoop/token-store.test.ts`** — already uses `createTokenStore({ paths, now })` for unit tests; only the integration smoke that imports `tokenStore` directly needs touching.
- **`src/services/refresh-orchestrator.test.ts`** — already uses `createRefreshOrchestrator(mockStore)`; deleting the singleton means deleting the (now-unused) singleton import.
- **`src/services/bootstrap.test.ts`** — gains a "passing custom tokenStore is honored" test case.
- **`src/services/doctor/checks/auth.test.ts` + `token-freshness.test.ts`** — already pass `deps.read` explicitly; only the unit cases that relied on the singleton default need updating.
- **`tests/integration/auth-concurrency.test.ts`** — at line 33 the test imports the singleton in forked children to assert the cross-process lock. **This is the load-bearing test for ADR-0002.** The fix: each forked child constructs `createTokenStore()` once at the top of its worker entry. The single-flight contract is preserved because the OS-level file lock + atomic write are still the chokepoint; the in-process Promise singleton is per-process either way. [VERIFIED: read `tests/integration/auth-concurrency.test.ts` lines 30-45]
- **`src/infrastructure/whoop/client.test.ts:22`** — `vi.mock('../../services/refresh-orchestrator.js', ...)` mocks the deleted `callWithAuth` export. **Pre-ARCH-03 this test will break.** Resolution: ARCH-02's PR includes a guard test that pins the new shape; ARCH-03's PR rewrites this test entirely to inject `authedCall`. Land them in adjacent PRs without an intervening main rebase.

### Closed? **NO.** Verified 2026-06-03: both singletons live. [VERIFIED: `grep -n "export const tokenStore\|export.*refreshOrchestrator\|export.*callWithAuth" src/infrastructure/whoop/token-store.ts src/services/refresh-orchestrator.ts`]

---

## ARCH-03 — Invert `client.ts` via `authedCall` DI

**Verbatim from REQUIREMENTS.md §ARCH-03:** "`src/infrastructure/whoop/client.ts` no longer imports from `src/services/`; `authedCall` is injected at `httpGet`'s signature; resource modules become factories wired in `bootstrap.ts:261-270`."

### Current state

- **`src/infrastructure/whoop/client.ts:25`** [VERIFIED: read file]:
  ```ts
  import { callWithAuth } from '../../services/refresh-orchestrator.js';
  ```
  Used at line 100 inside `httpGet`:
  ```ts
  response = await callWithAuth(async (accessToken) =>
    fetch(url, { method: 'GET', headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' }, signal: controller.signal }),
  );
  ```
- This is the **last** `infrastructure → services` import. Removing it makes the layering rule grep-enforceable. [CITED: `.planning/research-v1.1/ARCHITECTURE.md` §#84]
- **Resource modules** (`src/infrastructure/whoop/resources/{cycles,recovery,sleep,workouts,profile,body-measurements}.ts`) call `httpGet(path, query, schema)` directly — they receive no auth dep today. [VERIFIED: read `cycles.ts`]
- **Note on line numbers:** REQ cites `bootstrap.ts:261-270` for the wiring location. **Current actual line is 301-310** — the file has grown since the milestone research. The relevant block today:
  ```ts
  // src/services/bootstrap.ts:301-310
  const whoop: RunSyncDeps['whoop'] = {
    resources: {
      cycles: listCycles,
      recoveries: listRecovery,
      sleeps: listSleep,
      workouts: listWorkouts,
      profile: getProfile,
      body_measurements: getBodyMeasurement,
    },
  };
  ```

### Target state

`httpGet` receives `authedCall` as a parameter. Resource modules become factories (`createListCycles(deps) => (input) => httpGet(..., deps.authedCall)`). Bootstrap constructs the factories with `{ authedCall: refreshOrchestrator.callWithAuth }`.

```ts
// src/infrastructure/whoop/client.ts — target
- import { callWithAuth } from '../../services/refresh-orchestrator.js';

export type AuthedCall = <T extends { status: number }>(
  op: (accessToken: string) => Promise<T>,
) => Promise<T>;

export async function httpGet<T>(
  path: string,
  query: HttpGetQuery,
  schema: z.ZodSchema<T>,
  authedCall: AuthedCall,           // NEW parameter
): Promise<T> {
  // ...
  response = await authedCall(async (accessToken) =>
    fetch(url, { /* ... */ }),
  );
  // ...
}
```

```ts
// src/infrastructure/whoop/resources/cycles.ts — factory
export interface ListCyclesDeps {
  authedCall: AuthedCall;
}

export function createListCycles(deps: ListCyclesDeps) {
  return async function listCycles(opts: ListCyclesOpts): Promise<ListCyclesResult> {
    // ... unchanged body, but uses httpGet(path, query, schema, deps.authedCall)
  };
}
```

```ts
// src/services/bootstrap.ts — wire at the (now) line 301-310 block:
const authedCall = refreshOrchestrator.callWithAuth;
const whoop: RunSyncDeps['whoop'] = {
  resources: {
    cycles: createListCycles({ authedCall }),
    recoveries: createListRecovery({ authedCall }),
    sleeps: createListSleep({ authedCall }),
    workouts: createListWorkouts({ authedCall }),
    profile: createGetProfile({ authedCall }),
    body_measurements: createGetBodyMeasurement({ authedCall }),
  },
};
```

```ts
// productionWhoopFetcher (currently bootstrap.ts:396-419) also gets authedCall:
const productionWhoopFetcher = async (_accessToken: string) => {
  // ...
  await httpGet('/v2/user/profile/basic', {}, WhoopRawProfile, authedCall);
  // ...
};
```

### Why this ordering position (3rd)

Depends on ARCH-02 — bootstrap must own the orchestrator construction before this DI plumbing can land cleanly. After ARCH-02, the wiring location (`const authedCall = refreshOrchestrator.callWithAuth`) is sitting right there in bootstrap, waiting. [CITED: `.planning/research-v1.1/ARCHITECTURE.md` §"Recommended build order" step 3]

### Files modified

- **`src/infrastructure/whoop/client.ts`** — drop services import; add `AuthedCall` type; widen `httpGet` signature
- **`src/infrastructure/whoop/resources/cycles.ts`** — convert to factory
- **`src/infrastructure/whoop/resources/recovery.ts`** — convert to factory
- **`src/infrastructure/whoop/resources/sleep.ts`** — convert to factory
- **`src/infrastructure/whoop/resources/workouts.ts`** — convert to factory
- **`src/infrastructure/whoop/resources/profile.ts`** — convert to factory
- **`src/infrastructure/whoop/resources/body-measurements.ts`** — convert to factory
- **`src/services/bootstrap.ts`** — wire factories + `authedCall` at line 301-310; update `productionWhoopFetcher` at line ~401

### Test impact

- **`src/infrastructure/whoop/client.test.ts`** — currently mocks `vi.mock('../../services/refresh-orchestrator.js', ...)` at line 22. **Rewrite to inject `authedCall` directly** — simpler than the mock (`(op) => op('test-token-123')` per milestone research §#84). Mock disappears entirely.
- **6 resource tests under `src/infrastructure/whoop/resources/*.test.ts`** — each updates to pass `authedCall: (op) => op('test-token')` into the factory. Simpler than today's MSW + token-store mocking.
- **6 contract tests under `tests/contract/{cycles,recovery,sleep,workouts,profile,body-measurements}.test.ts`** — update to compose the factory with a fake `authedCall`. [VERIFIED: each currently imports `WhoopApiError` from `infrastructure/whoop/errors.js`]
- **`tests/integration/sync/*.test.ts`** (3 files) — wire through `bootstrap()`; should work unchanged because `runSync` consumes `whoop.resources` via the same shape.
- **`src/services/sync/index.ts`** — no changes (consumes `resources` map, not factories).

### Closed? **NO.** Verified 2026-06-03: line 25 of `client.ts` still imports `callWithAuth` from services. [VERIFIED: `grep -n "from.*services/refresh-orchestrator" src/infrastructure/whoop/client.ts`]

---

## ARCH-04 — Single import path for `AuthError` / `MigrationError`

**Verbatim from REQUIREMENTS.md §ARCH-04:** "`AuthError` and `MigrationError` have a single canonical import path — `infrastructure/whoop/errors` re-exports removed; codemod assertion `rg \"from '.*infrastructure/whoop/errors'\" src tests` returns zero for AuthError|MigrationError."

### Closed? **YES.** [VERIFIED: read `src/infrastructure/whoop/errors.ts` lines 1-6]

Top of file as of 2026-06-03:

```ts
// ARCH-04 (#92): AuthError + helpers used to re-export from here for
// historical-import compatibility; ARCH-04 codemodded every consumer to
// `from '.../domain/errors/auth.js'` directly. The re-exports are deleted
// so future contributors cannot accidentally reintroduce the dual-import
// drift hazard. This file now owns only WhoopApiError.
```

Verification queries:

```bash
# Returns only WhoopApiError-related lines, no AuthError/MigrationError:
$ grep -rn "from.*infrastructure/whoop/errors" src tests --include="*.ts"
# (5 hits, all for WhoopApiError / formatWhoopApiError / isWhoopApiError)
```

`src/domain/errors/{auth.ts,decision.ts,migration.ts}` exist. [VERIFIED: `ls src/domain/errors/`]

### Files modified (none — already done)

The planner should **not** create a plan for ARCH-04. Mark CLOSED in the v1.1 traceability table when Phase 10 closes.

### Residual delta vs. spec

None. Confirmed by grep + inspection.

---

## ARCH-05 — `withBootstrap` helper

**Verbatim from REQUIREMENTS.md §ARCH-05:** "CLI command shims share one `withBootstrap(handler)` helper (in `src/cli/run.ts` or `src/cli/lib/`); ~30 lines of duplicated bootstrap-error handling × 8 files collapsed to a single source."

### Closed? **YES — but with a small naming delta.** [VERIFIED: read `src/cli/lib/with-bootstrap.ts`]

The helper ships at `src/cli/lib/with-bootstrap.ts` (PR #114 / Phase 5–ish — file timestamp 2026-06-01) under the name **`tryBootstrap`**, not `withBootstrap`. The function signature returns a discriminated `{ok: true, app}` / `{ok: false, body, exitCode}` result that the shim wires into its existing stdout-write-then-exit pattern.

```ts
// src/cli/lib/with-bootstrap.ts — exists today
export type TryBootstrapResult =
  | { ok: true; app: Bootstrapped }
  | { ok: false; body: string; exitCode: number };

export function tryBootstrap(bootstrapFailedExitCode: number): TryBootstrapResult {
  try {
    const app = bootstrap();
    return { ok: true, app };
  } catch (err) {
    const body = isMigrationError(err)
      ? formatBootstrapError(err, paths.dbFile)
      : `Bootstrap failed: ${sanitize(String(err))}`;
    return { ok: false, body, exitCode: bootstrapFailedExitCode };
  }
}
```

**Consumer status (8 CLI shims):** [VERIFIED: `grep -l "tryBootstrap" src/cli/commands/*.ts`]

| Shim | Uses `tryBootstrap`? |
|------|---------------------|
| `sync.ts` | ✅ |
| `query.ts` | ✅ |
| `review-daily.ts` | ✅ |
| `review-weekly.ts` | ✅ |
| `decision-add.ts` | ✅ |
| `decision-review.ts` | ✅ |
| `decision-update.ts` | ✅ |
| `api-gap.ts` | ✅ |
| `auth.ts` | ❌ — does not bootstrap (OAuth-only flow, no DB) |
| `doctor.ts` | ❌ — uses a different DB-optional path |
| `init.ts` | ❌ — pre-bootstrap (creates config) |

All 8 shims that need it use `tryBootstrap`. The 3 outliers (`auth`, `doctor`, `init`) genuinely don't bootstrap a DB in the same way — they're correctly excluded.

### Residual delta vs. spec

- **Naming:** REQ says `withBootstrap`; actual helper is `tryBootstrap`. Behavior matches the spec exactly; this is a cosmetic rename question for the discuss-phase to settle. Recommendation: **keep `tryBootstrap`** — the name is clearer (returns a `Result`, doesn't wrap a handler). Update REQUIREMENTS.md prose to match if the planner agrees.
- **Location:** REQ allows `src/cli/run.ts` or `src/cli/lib/`. Actual is `src/cli/lib/with-bootstrap.ts`. Matches.

The planner should **not** create a plan for ARCH-05. Mark CLOSED in the v1.1 traceability table.

---

## ARCH-06 — Extract doctor production wiring from bootstrap

**Verbatim from REQUIREMENTS.md §ARCH-06:** "Doctor production wiring (`productionWhoopFetcher`, `whoopErrorKindToStatus`, `services_runDoctor`) extracted from `bootstrap.ts:320-392` into `src/services/doctor/wiring.ts`; bootstrap stays under 250 lines."

### Current state

[VERIFIED: read `src/services/bootstrap.ts` lines 362-444]

`bootstrap.ts` is currently **479 lines**. The doctor wiring block spans:

| Block | Current lines | Description |
|-------|--------------|-------------|
| `whoopErrorKindToStatus` | 382-395 | Maps `WhoopApiError['kind']` → HTTP status for the probe's branch logic |
| `productionWhoopFetcher` | 396-419 | The `(accessToken) → {status, durationMs}` probe fetcher |
| `services_runDoctor` | 428-444 | Pre-binds production deps into `runDoctorImpl` |

Total: ~63 lines of doctor-specific construction in the composition root. Plus a chunky comment block (lines 362-381) explaining `whoopErrorKindToStatus`'s rationale.

**Note:** REQ cites `bootstrap.ts:320-392` for the wiring location. **Current actual range is 362-444** — file has grown since milestone research.

### Target state

New module `src/services/doctor/wiring.ts` exporting a single factory:

```ts
// src/services/doctor/wiring.ts
import { performance } from 'node:perf_hooks';
import type Database from 'better-sqlite3';
import { isAuthError } from '../../domain/errors/auth.js';
import { WhoopRawProfile } from '../../domain/schemas/whoop-api.js';
import type { AuthedCall } from '../../infrastructure/whoop/client.js';
import { httpGet } from '../../infrastructure/whoop/client.js';
import { WhoopApiError } from '../../infrastructure/whoop/errors.js';
import type { RefreshOrchestrator } from '../refresh-orchestrator.js';
import type { DoctorResult, RunDoctorOptions, runDoctor } from './index.js';
import { runDoctor as runDoctorImpl } from './index.js';
// + repo types

export interface ProductionDoctorDepsInput {
  sqlite: Database.Database;
  repos: { syncRuns, cycles, recoveries, sleeps };  // exact shape from bootstrap
  refreshOrchestrator: RefreshOrchestrator;
  authedCall: AuthedCall;  // post-ARCH-03
  migrationsDir: string;
}

export function createProductionDoctorDeps(input: ProductionDoctorDepsInput): typeof runDoctor {
  const whoopErrorKindToStatus = (kind: WhoopApiError['kind']): number => { /* moved verbatim */ };
  const productionWhoopFetcher = async (_accessToken: string) => { /* moved verbatim */ };
  return (opts: RunDoctorOptions = {}) =>
    runDoctorImpl({
      ...opts,
      sqlite: opts.sqlite ?? input.sqlite,
      repos: opts.repos ?? { /* shape from input.repos */ },
      refreshOrchestrator: opts.refreshOrchestrator ?? input.refreshOrchestrator,
      whoopFetcher: opts.whoopFetcher ?? productionWhoopFetcher,
      migrationsDir: opts.migrationsDir ?? input.migrationsDir,
    });
}
```

Then `bootstrap.ts`:

```ts
import { createProductionDoctorDeps } from './doctor/wiring.js';
// ...
const runDoctor = createProductionDoctorDeps({
  sqlite, repos, refreshOrchestrator, authedCall, migrationsDir,
});
// services.runDoctor = runDoctor
```

**Net:** bootstrap.ts loses ~63 lines + ~20 lines of inline comments = ~83 lines. Target "under 250" requires bootstrap to also slim elsewhere (the singleton block from ARCH-02 doesn't shrink it materially). Reality check: with ARCH-02 (small) + ARCH-03 (resource factories add a few lines but not many) + ARCH-06, bootstrap should land **~395-405 lines, not under 250**. The "under 250" target in the REQ appears aspirational. **Recommendation for planner:** confirm with user during discuss-phase whether 250 is a real gate or a guideline.

### Why this ordering position (4th)

Depends on ARCH-03 — `productionWhoopFetcher` needs to receive `authedCall` (post-ARCH-03 it can no longer rely on the deleted `callWithAuth` import). Doing this after ARCH-03 means the extracted wiring already knows about `authedCall` as a dep. [CITED: `.planning/research-v1.1/ARCHITECTURE.md` §"Recommended build order" step 4]

### Files modified

- **Created:** `src/services/doctor/wiring.ts`, `src/services/doctor/wiring.test.ts`
- **`src/services/bootstrap.ts`** — delete lines 362-444; add import + single factory call

### Test impact

- **New:** `src/services/doctor/wiring.test.ts` — unit test for `createProductionDoctorDeps()` with fake sqlite + repos + authedCall + RefreshOrchestrator. Asserts the returned `runDoctor` honors user-supplied opts and falls back to production deps.
- **`src/services/bootstrap.test.ts`** — existing tests should pass unchanged; bootstrap still returns a `services.runDoctor` with the same surface.
- **`src/cli/commands/doctor.test.ts`** — existing tests should pass unchanged (consumes `app.services.runDoctor`).
- **No fixtures break.**

### Closed? **NO.** Verified 2026-06-03: doctor wiring lives in `bootstrap.ts` lines 362-444. [VERIFIED: read `src/services/bootstrap.ts`]

---

## ARCH-07 — Standardize doctor-check DI

**Verbatim from REQUIREMENTS.md §ARCH-07:** "Doctor checks use required-deps DI matching the non-doctor services; `deps?.read ?? (() => tokenStore.read())` fallbacks removed."

### Current state

[VERIFIED: `grep -rn "tokenStore\." src/services/doctor --include="*.ts"`]

The `deps?.x ?? tokenStore.x()` pattern lives in **2 doctor checks**:

```ts
// src/services/doctor/checks/auth.ts:44-45
const readStorageMode = deps?.readStorageMode ?? (() => tokenStore.readStorageMode());
const readTokens = deps?.readTokens ?? (() => tokenStore.read());

// src/services/doctor/checks/token-freshness.ts:57
const read = deps?.read ?? (() => tokenStore.read());
```

In both cases the `deps?` is optional and the `??` defaults to the singleton. Production callers (`runDoctorImpl` at `bootstrap.ts:428-444`) **already pass these deps explicitly** — the fallback is vestigial from before `bootstrap()` existed. [CITED: `.planning/research-v1.1/ARCHITECTURE.md` §P5]

Note: ARCH-02 will already touch both files (because the `tokenStore` import goes away with the singleton). ARCH-07 finishes the job by tightening the type — `deps?` becomes `deps`, `read?` becomes `read`. **ARCH-07 effectively folds into ARCH-02's diff for these two files** — the planner can either land it in ARCH-02's PR or as a separate cleanup PR. Recommendation: split it. Cleaner reviews; one concern per PR.

### Target state

```ts
// src/services/doctor/checks/auth.ts — target
export interface AuthProbeDeps {
  readStorageMode: () => Promise<'keychain' | 'file' | null>;
  readTokens: () => Promise<Tokens | null>;
}

export async function probeAuth(deps: AuthProbeDeps): Promise<DoctorCheck> {
  // No `??` fallback. No optional `deps?`.
  try {
    const mode = await deps.readStorageMode();
    // ...
  }
}
```

```ts
// src/services/doctor/checks/token-freshness.ts — target
export interface TokenFreshnessProbeDeps {
  read: () => Promise<Tokens | null>;
  now: () => number;
}

export async function probeTokenFreshness(deps: TokenFreshnessProbeDeps): Promise<DoctorCheck> {
  try {
    const tokens = await deps.read();
    // ...
  }
}
```

Then `runDoctorImpl` (or post-ARCH-06: `createProductionDoctorDeps`) constructs the deps explicitly:

```ts
// in wiring.ts (post-ARCH-06):
const authDeps: AuthProbeDeps = {
  readStorageMode: () => input.tokenStore.readStorageMode(),
  readTokens: () => input.tokenStore.read(),
};
const tokenFreshnessDeps: TokenFreshnessProbeDeps = {
  read: () => input.tokenStore.read(),
  now: Date.now,
};
```

### Why this ordering position (5th)

Depends on ARCH-02 (no more `tokenStore` singleton to fall back to) and naturally pairs with ARCH-06 (the new `wiring.ts` is the right place to construct the explicit deps). [CITED: `.planning/research-v1.1/ARCHITECTURE.md` §"Recommended build order" step 5]

### Files modified

- **`src/services/doctor/checks/auth.ts`** — required deps; drop `tokenStore` import (overlaps with ARCH-02)
- **`src/services/doctor/checks/token-freshness.ts`** — required deps; drop `tokenStore` import (overlaps with ARCH-02)
- **`src/services/doctor/wiring.ts`** (post-ARCH-06) — construct `AuthProbeDeps` + `TokenFreshnessProbeDeps` explicitly
- **Possibly: 7 other doctor checks** — the milestone research mentions "9 others" exist with similar `deps?` patterns. [CITED: `.planning/research-v1.1/ARCHITECTURE.md` §P5 "auth.ts:44-45, and 7 others"] Verification needed during planning — grep `deps\?` in `src/services/doctor/checks/`. Recommendation: planner audits during plan creation; tighten any optional-deps shape that exists today.

### Test impact

- **`src/services/doctor/checks/auth.test.ts`** — every test already passes deps explicitly; type change is invisible. Adds 1-2 cases pinning that `deps` is no longer optional (the type system enforces it; a TS error is the contract).
- **`src/services/doctor/checks/token-freshness.test.ts`** — same pattern.

### Closed? **NO.** Verified 2026-06-03: both checks still have the `deps?.x ?? tokenStore.x()` pattern. [VERIFIED: read both files]

---

## ARCH-08 — Inline `src/services/api-gap/` into single file

**Verbatim from REQUIREMENTS.md §ARCH-08:** "`src/services/api-gap/` collapsed into a single `src/services/api-gap.ts`; `API_GAP_ENTRIES` promoted to `src/domain/api-gap/catalog.ts`."

### Current state

[VERIFIED: `ls src/services/api-gap/`]

Three files for what is effectively a frozen 6-element constant:

| File | Lines | Purpose |
|------|-------|---------|
| `src/services/api-gap/index.ts` | 17 | `getApiGap()` accessor — async wrapper returning `{ entries: API_GAP_ENTRIES }` |
| `src/services/api-gap/data.ts` | 67 | `API_GAP_ENTRIES` constant (6 frozen entries) |
| `src/services/api-gap/types.ts` | 53 | `ApiGapEntry` + `ApiGapResult` interfaces |
| `src/services/api-gap/index.test.ts` | (test) | covers `getApiGap()` |

**Importers** [VERIFIED: `grep -rn "from.*services/api-gap"`]:
- `src/formatters/api-gap.txt.ts:20` — `import type { ApiGapEntry, ApiGapResult } from '../services/api-gap/types.js'`
- `src/formatters/api-gap.txt.test.ts:11-12` — imports both `API_GAP_ENTRIES` and `getApiGap`
- `src/cli/commands/api-gap.test.ts:4` — `import type { ApiGapResult } from '../../services/api-gap/types.js'`
- `tests/contract/api-gap-md-parity.test.ts:18` — `import { API_GAP_ENTRIES } from '.../services/api-gap/data.js'`
- `tests/contract/formatter-tone.test.ts:64-65` — both
- `src/services/bootstrap.ts:105-106` — `getApiGap` + `ApiGapResult` type

7 import sites total; all rewrite to the new flat path.

### Target state

```
src/
├── domain/
│   └── api-gap/
│       └── catalog.ts          # API_GAP_ENTRIES + ApiGapEntry type (pure data)
└── services/
    └── api-gap.ts              # getApiGap() accessor + ApiGapResult type
```

```ts
// src/domain/api-gap/catalog.ts — NEW (pure data, no I/O, belongs in domain)
export interface ApiGapEntry {
  feature: string;
  whoop_consumer_path: string;
  available_via_v2_api: false;
  alternative_via_v2: string | null;
  notes: string;
}

export const API_GAP_ENTRIES: readonly ApiGapEntry[] = Object.freeze<ApiGapEntry[]>([
  // ... 6 entries verbatim from data.ts
]);
```

```ts
// src/services/api-gap.ts — NEW (single file, no directory)
import { API_GAP_ENTRIES, type ApiGapEntry } from '../domain/api-gap/catalog.js';

export interface ApiGapResult {
  entries: readonly ApiGapEntry[];
}

export async function getApiGap(): Promise<ApiGapResult> {
  return { entries: API_GAP_ENTRIES };
}
```

### Why this ordering position (6th, last)

Cosmetic. Depends on nothing in the cluster; could go first in principle but conventionally goes last because (a) it's the smallest change, (b) it doesn't unblock anything else, (c) leaving it for last gives the cluster a clean "we shrunk something" closing note. [CITED: `.planning/research-v1.1/ARCHITECTURE.md` §"Recommended build order" step 6 — "Cosmetic. Last. 15 minutes."]

### Files modified

- **Created:** `src/domain/api-gap/catalog.ts`
- **Created:** `src/services/api-gap.ts` (single file)
- **Deleted:** `src/services/api-gap/index.ts`, `data.ts`, `types.ts`, `index.test.ts` (4 files + the directory)
- **7 importers rewritten** to use the new paths

### Test impact

- **`src/services/api-gap/index.test.ts`** → renamed to **`src/services/api-gap.test.ts`** (move with the source). One-line content change for the import path.
- **`src/formatters/api-gap.txt.test.ts`** — update 2 import paths
- **`tests/contract/api-gap-md-parity.test.ts`** — update 1 import path; this is the load-bearing parity test that asserts the markdown matches `API_GAP_ENTRIES` — its assertions don't change, only the import path
- **`tests/contract/formatter-tone.test.ts`** — update 2 import paths
- **No fixtures break.** (The 6-entry constant is the fixture; it moves intact.)

### Closed? **NO.** Verified 2026-06-03: `src/services/api-gap/` directory exists with all 3 files; `src/domain/api-gap/` does not exist. [VERIFIED: `ls src/services/api-gap/ src/domain/api-gap/`]

---

## Cross-cutting concerns

### The `bootstrap.ts:301-310` resource-module wiring block (current line numbers)

The milestone research repeatedly cites `bootstrap.ts:261-270` for the resource-wiring location. **As of 2026-06-03 this block lives at lines 301-310**:

```ts
// src/services/bootstrap.ts:301-310 (CURRENT)
const whoop: RunSyncDeps['whoop'] = {
  resources: {
    cycles: listCycles,
    recoveries: listRecovery,
    sleeps: listSleep,
    workouts: listWorkouts,
    profile: getProfile,
    body_measurements: getBodyMeasurement,
  },
};
```

**What ARCH-03 changes:** each `listCycles` / `listRecovery` / etc. becomes a factory call:

```ts
// src/services/bootstrap.ts:301-310 (POST-ARCH-03)
const authedCall = refreshOrchestrator.callWithAuth;
const whoop: RunSyncDeps['whoop'] = {
  resources: {
    cycles: createListCycles({ authedCall }),
    recoveries: createListRecovery({ authedCall }),
    sleeps: createListSleep({ authedCall }),
    workouts: createListWorkouts({ authedCall }),
    profile: createGetProfile({ authedCall }),
    body_measurements: createGetBodyMeasurement({ authedCall }),
  },
};
```

The `RunSyncDeps['whoop'].resources` consumer shape doesn't change — `runSync` still calls `whoop.resources.cycles(opts)`. Sync orchestrator stays untouched.

**Planner note:** when writing plans, **use current line numbers** (301-310), not the milestone research's (261-270). The research was written when bootstrap was ~70 lines smaller.

### The 8 CLI shims — duplication pattern after ARCH-05

After ARCH-05 (already shipped) the duplicated bootstrap-error handling collapsed to a single `tryBootstrap(exitCode)` call per shim. Each shim retains its OWN:
- Input validation (Zod schemas — different per command)
- Exit-code constant (`SYNC_EXIT_CODES`, `QUERY_EXIT_CODES`, etc. — different per command)
- Per-command formatter call
- Per-command catch arm

That residual ~30-50 lines per shim is **necessary per-command logic**, not duplication. ARCH-05 closed the duplication that was actually shared (bootstrap error rendering). The planner should NOT propose further consolidation — the pattern is intentional.

If any shim is found NOT to use `tryBootstrap` despite needing it (none today), that's the only follow-up ARCH-05 would care about.

### ADR-0002 §Enforcement amendment (draft text — ~3 sentences)

**Verbatim draft for the planner's docs deliverable:**

> **ARCH-02 (#85) — single tokenStore per process:** production code MUST construct `tokenStore` exactly once via `bootstrap()`. The historical `export const tokenStore = createTokenStore()` module-load singleton in `src/infrastructure/whoop/token-store.ts` is forbidden — bootstrap is the only sanctioned construction site, and consumers receive the instance through the `Bootstrapped` surface. Tests construct fresh stores via `createTokenStore(...)`; nothing imports the (deleted) singleton. Enforced by `rg "import.*tokenStore" src` returning zero matches outside `bootstrap.ts`.

Insert location: `agent_docs/decisions/0002-single-flight-oauth-refresh.md` §Enforcement, after the existing ERRC-02 paragraph (current line ~83-90), as a new bullet.

The amendment is a **docs deliverable**, not a code change. It MUST land in the same PR as ARCH-02's code so the enforcement rule and the code that satisfies it are atomic. Conventional commit: `docs(10): ADR-0002 §Enforcement — exactly one tokenStore per process (ARCH-02)`.

---

## Risk + landmines

### R1. Doctor wiring lifecycle (ARCH-06)

`createProductionDoctorDeps()` returns a closure capturing `sqlite`, `repos`, `refreshOrchestrator`, `authedCall`, `migrationsDir`. If `bootstrap.close()` runs while a doctor probe is still mid-flight (long `whoop_roundtrip` over a slow network), the captured `sqlite` handle is now invalid. **Today this is already a risk** — bootstrap's `services_runDoctor` captures the same handles — so ARCH-06 doesn't add risk, but it makes the closure boundary explicit. Mitigation: no change needed (existing CLI shim pattern is `bootstrap → await runDoctor → close`).

### R2. MCP startup latency (ARCH-02 + ARCH-03)

Today `tokenStore` is constructed at module load (line 521 of token-store.ts) — by the time `bootstrap()` runs, the keyring backend has been initialized. Post-ARCH-02, `bootstrap()` calls `createTokenStore()`, which probes the keychain on first `read()`. **Net effect on MCP cold start:** likely ~0ms. `createTokenStore()` itself is a constructor; the keychain probe happens lazily inside `read()`. But the planner should pin this with a smoke test on the MCP startup path (already covered by `tests/integration/setup-stopwatch.test.ts` — failure here would surface as the <20-minute setup budget drifting).

### R3. Test fakes that rely on the singleton (ARCH-02)

`src/infrastructure/whoop/client.test.ts:22` does:
```ts
vi.mock('../../services/refresh-orchestrator.js', () => ({
  callWithAuth: (op) => callWithAuthSpy(op),
}));
```
This mocks the **deleted** `callWithAuth` export. Pre-ARCH-03 this test will silently mock-undefined (vi.mock against a non-existent export is a no-op). ARCH-02 lands without breaking this test only because client.ts still imports the deleted export — TypeScript catches it; vitest collapses; PR fails CI.

**Mitigation:** ARCH-02 and ARCH-03 should land in sequential PRs without an intervening main rebase, AND ARCH-03's PR must rewrite `client.test.ts` to inject `authedCall` directly. Alternatively: keep `callWithAuth` as a **deprecated** re-export from refresh-orchestrator.ts during ARCH-02 (one extra line, marked `// REMOVE in ARCH-03`), drop it in ARCH-03. This eliminates the cross-PR coupling risk. Recommend the planner pick the second option.

### R4. `tests/integration/auth-concurrency.test.ts` load-bearing for ADR-0002

This test spawns 10 forked children, each importing the **compiled** `tokenStore` from `dist/`, asserting that exactly one WHOOP refresh occurs across all 10. Post-ARCH-02 the children must each invoke `createTokenStore()` once at the top of the worker entry (the in-process Promise singleton is per-process anyway; the cross-process lock + atomic write are doing the load-bearing work). This is the single most important test to inspect during ARCH-02's PR — if it breaks subtly, the family-revocation contract degrades silently. [VERIFIED: read `tests/integration/auth-concurrency.test.ts` lines 30-45]

### R5. `bootstrap.ts` under 250 lines (ARCH-06)

REQ-text says "bootstrap stays under 250 lines." Current size: 479. After ARCH-02 (-15 lines for singleton-related additions) + ARCH-06 (-83 lines for doctor wiring extract) + ARCH-08 (-2 lines for api-gap import): **~380 lines**. The 250 target is aspirational and unlikely to land in Phase 10 without aggressive additional inlining (e.g., extracting `resolveMigrationsDir`, the stale-running reclassification block, the `reviewDeps`/`decisionDeps`/`cacheDeps` shapes into helpers). **Recommendation:** planner asks user during discuss-phase whether 250 is a hard gate or a guideline. If hard, scope a "bootstrap-decomposition" sub-PR. If guideline, mark "under 400" as the practical Phase 10 outcome and document the residual decomposition as Phase 12 backlog.

### R6. ESM circular import on `domain/api-gap/catalog.ts` (ARCH-08)

The catalog has no imports of its own (pure data), so the cycle risk is minimal. But the milestone learning from DBIN-01 (#75) is that `madge --circular src/` should be green — and Phase 7 will land the `madge` gate in CI. By Phase 10, the gate exists; ARCH-08 will inherit its protection automatically. **No special mitigation needed.**

### R7. `services/index.ts` barrel (cross-cutting)

`src/services/index.ts:37` imports `refreshOrchestrator` from `./refresh-orchestrator.js` as a barrel re-export. Post-ARCH-02 the singleton is deleted; the barrel import must move to "import the *type* `RefreshOrchestrator`, export nothing" or be deleted entirely (consumers go through `bootstrapped.services.refreshOrchestrator`). [VERIFIED: read line 37 of `src/services/index.ts`] **Action:** ARCH-02's PR includes the barrel cleanup.

---

## Recommended PR boundaries

Six PRs in build order. ARCH-04 + ARCH-05 already shipped (no PR needed). LOC budget is rough — count is "lines touched," not net delta.

| PR | REQs | Concern | LOC budget | Notes |
|----|------|---------|------------|-------|
| **PR 1** | ARCH-01 | Move `sanitize` to `domain/observability/` | ~250 LOC across 25 files (mostly 1-line import path swaps) | Pure mechanical. Highest confidence, lowest risk. First because it's clean. |
| **PR 2** | ARCH-02 + ADR-0002 §Enforcement amendment | Drop `tokenStore` + `refreshOrchestrator` singletons; bootstrap owns construction; **keep `callWithAuth` deprecated re-export** (one line, removed in PR 3) | ~400 LOC across 8 files | Highest-touch PR. Includes test updates for `auth-concurrency.test.ts` worker. Docs deliverable lands here too (`agent_docs/decisions/0002-...md`). |
| **PR 3** | ARCH-03 | Invert `client.ts` via `authedCall` DI; resource modules become factories; **drop the deprecated `callWithAuth` re-export** | ~500 LOC across 8 source + 13 test files | Largest test churn (12 affected test files: 1 client, 6 resources, 6 contract). Tests SIMPLIFY (no MSW token-store mock); LOC counts overstate complexity. |
| **PR 4** | ARCH-06 | Extract doctor production wiring to `src/services/doctor/wiring.ts` | ~150 LOC | New `wiring.ts` (~100 LOC) + `wiring.test.ts` (~80 LOC) + bootstrap.ts diff (-83 LOC, +5 LOC). |
| **PR 5** | ARCH-07 | Tighten doctor-check DI (required deps; no `??` fallback); audit `deps?` across all 14 doctor checks | ~80 LOC | Small. Type-system enforced. May surface other doctor checks with optional `deps?` — handle in same PR if mechanical. |
| **PR 6** | ARCH-08 | Inline `api-gap/` to single file; promote catalog to `domain/api-gap/catalog.ts` | ~120 LOC across 8 files | Cosmetic. ~15 minutes of substantive work. |

**Total budget:** ~1500 LOC touched across ~50 files in 6 PRs. Net code delta is **negative** (we're consolidating, not adding).

**Branching:** per `AGENTS.md` §"Branch policy", each PR lands on its own branch (`gsd/phase-10-arch-01-sanitize-move`, etc.). Phase 10 itself is the umbrella branch (`feat/phase-10` or similar — check existing convention in `gsd/{milestone}-{slug}`).

---

## Open questions for planner (RESOLVED 2026-06-03)

All six questions resolved by user during plan-checker revision loop (iteration 1).

### Q1. Should `authedCall` be a parameter to `httpGet` or curried at factory time?

**Recommendation:** parameter (composes cleanly; resource modules' factory closures already capture `deps.authedCall`).
**RESOLVED:** parameter. Confirmed in planner spawn prompt (Q1 default = parameter).

### Q2. Is the "bootstrap.ts under 250 lines" target in ARCH-06 a hard gate or a guideline?

**Recommendation:** ask user. Reality is ~395-405 lines post-Phase-10. If hard gate, scope additional extractions.
**RESOLVED:** **guideline**. ROADMAP Phase 10 Success Criterion 5 is being amended to read "bootstrap.ts shrinks by ≥ 80 lines (target ≤ 250 deferred to Phase 12)." Residual at ~395-405 LOC is accepted; Phase 12 will optionally extract `resolveMigrationsDir`, stale-running reclassification, and dep-shape helpers if further reduction is desired.

### Q3. Naming: rename `tryBootstrap` → `withBootstrap` to match REQ spec?

**Recommendation:** keep `tryBootstrap` (name reflects the discriminated `Result` return shape; not a handler wrapper).
**RESOLVED:** keep `tryBootstrap`. REQ-ARCH-05 prose will be updated in REQUIREMENTS.md to match shipped reality. No rename.

### Q4. Should ARCH-07's audit cover ALL 14 doctor checks, or only the two with `tokenStore` fallback?

**Recommendation:** all 14.
**RESOLVED:** all 14. Confirmed in planner spawn prompt (Q4 default = all 14 + check helpers in `src/services/doctor/`).

### Q5. Should the deprecated `callWithAuth` re-export bridge (PR 2 → PR 3) be a public deprecation marker or a quiet internal placeholder?

**Recommendation:** quiet internal placeholder.
**RESOLVED — SUPERSEDED:** the bridge is no longer needed. PR 2 (ARCH-02) and PR 3 (ARCH-03) are being **collapsed into a single PR** to eliminate the broken-main runtime window (`productionWhoopFetcher` + `client.ts:httpGet` would throw between PR2 and PR3 merges per RESEARCH §R3). The combined PR drops the singletons AND inverts `client.ts` atomically — no transitional bridge required. Plans 10-02 and 10-03 are merged into a single plan `10-02-arch-02-03-singletons-and-client-di-PLAN.md`.

### Q6. Are there additional `services_runDoctor` consumers besides `bootstrap.ts:467` that ARCH-06 needs to handle?

**Recommendation:** none expected. [VERIFIED via grep]
**RESOLVED:** none. Confirmed in planner spawn prompt (Q6 default = none).

### Q7. (new — from plan-checker iteration 1) How does `auth.ts` obtain a `tokenStore` after the singleton drop?

**RESOLVED:** construct `createTokenStore()` directly in `auth.ts` as a documented two-construction-sites exception. Rationale: the OAuth flow does not need DB; routing `auth.ts` through `bootstrap()` would slow login and surface migration errors during an action that should be DB-independent. Add a comment in `auth.ts` referencing this resolution and the trade-off rationale (RESEARCH §ARCH-05 already flags auth.ts as correctly excluded from `tryBootstrap`). ADR-0002 §Enforcement rule must accommodate this exception by phrasing as "exactly one `tokenStore` per process **for DB-coupled flows**; OAuth-login flow constructs its own `createTokenStore()` instance and is documented as the sole exception."

---

## Sources

### Primary (HIGH confidence)

- `.planning/research-v1.1/ARCHITECTURE.md` — milestone-level analysis of #84, #85, #95 placement debates; **authoritative for build order, ADR impact, and target shapes**. Read in full.
- `.planning/research-v1.1/SUMMARY.md` §4 "Architecture Work" — synthesis of milestone research; confirms 6-step ordering.
- `.planning/REQUIREMENTS.md` §"Architectural hygiene" — verbatim REQ-text for ARCH-01..08.
- `.planning/ROADMAP.md` §"Phase 10" — phase goal, dependency, success criteria, PR boundaries.
- `.planning/research/ARCHITECTURE.md` §"Standard Architecture" + §"Component Responsibilities" — canonical lite-hexagonal layering rule.
- `agent_docs/conventions.md` — code-style, module-layout, testing rules.
- `agent_docs/decisions/0002-single-flight-oauth-refresh.md` — ADR that gets the §Enforcement amendment.
- `src/services/bootstrap.ts` — composition root (479 lines, primary refactor target).
- `src/infrastructure/whoop/token-store.ts:521` — `tokenStore` singleton location (verified live).
- `src/services/refresh-orchestrator.ts:132,141` — `refreshOrchestrator` + `callWithAuth` singleton locations (verified live).
- `src/infrastructure/whoop/client.ts:25,100` — `callWithAuth` import + usage (verified live).
- `src/infrastructure/whoop/errors.ts` lines 1-6 — confirms ARCH-04 already closed.
- `src/cli/lib/with-bootstrap.ts` — confirms ARCH-05 already closed (as `tryBootstrap`).

### Secondary (MEDIUM — context, not primary claims)

- `src/cli/commands/sync.ts` — sample shim showing `tryBootstrap` usage post-ARCH-05.
- `tests/integration/auth-concurrency.test.ts` — load-bearing ADR-0002 test (post-ARCH-02 risk).

### Tertiary

- None — no LOW-confidence findings in this research. Everything was verified against the live source tree on 2026-06-03.

---

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | "bootstrap.ts under 250 lines" is aspirational, not a hard gate | ARCH-06, Risk R5 | Phase 10 closes with bootstrap ~380 lines; if hard gate, additional decomposition PR needed before close. |
| A2 | The `callWithAuth` deprecated re-export bridge between ARCH-02 and ARCH-03 is acceptable | Risk R3, PR 2 | If rejected, ARCH-02 + ARCH-03 must land as a single PR (larger, harder to review). |
| A3 | Renaming `tryBootstrap` → `withBootstrap` is purely cosmetic | ARCH-05, Open Q3 | If user wants the rename, it's a mechanical follow-up; nothing depends on the current name. |
| A4 | ARCH-07's audit will find ≤3 additional optional-deps checks beyond auth + token-freshness | ARCH-07, Open Q4 | If many more, ARCH-07's PR grows; still mechanical, no design rework. |
| A5 | `serializeError` in REQ-01 prose doesn't exist in the codebase | ARCH-01 | If the REQ-text means "future work covered later," no change. If it implies a function that should exist, scope unclear — discuss-phase should clarify. |

---

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Vitest 3.x (per `package.json` — pinned to ^3 series) |
| Config file | `vitest.config.ts` |
| Quick run command | `npm test -- <pattern>` (vitest filters by file/name) |
| Full suite command | `npm test` (`vitest run`, pool: 'forks') |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| ARCH-01 | `sanitize` lives in `src/domain/observability/` | grep gate | `! rg "from.*infrastructure/observability" src tests` | ❌ Wave 0 (new gate) |
| ARCH-01 | Transports/services import sanitize from domain | unit (existing) | `npm test -- src/services/doctor/checks/auth.test.ts` | ✅ |
| ARCH-02 | `tokenStore` singleton deleted | grep gate | `! rg "^export const tokenStore" src` | ❌ Wave 0 (new gate) |
| ARCH-02 | `refreshOrchestrator`/`callWithAuth` singletons deleted | grep gate | `! rg "^export const (refreshOrchestrator\|callWithAuth)" src` | ❌ Wave 0 (new gate) |
| ARCH-02 | `bootstrap()` accepts injected `tokenStore` | unit | `npm test -- src/services/bootstrap.test.ts` | ✅ (extend existing) |
| ARCH-02 | Single-flight refresh contract holds | integration | `npm test -- tests/integration/auth-concurrency.test.ts` | ✅ (load-bearing, update worker) |
| ARCH-03 | `client.ts` does not import from `services/` | grep gate | `! rg "from.*services/" src/infrastructure/whoop/client.ts` | ❌ Wave 0 (new gate) |
| ARCH-03 | `httpGet` accepts `authedCall` parameter | unit | `npm test -- src/infrastructure/whoop/client.test.ts` | ✅ (rewrite) |
| ARCH-03 | Resource factories work with fake `authedCall` | unit | `npm test -- src/infrastructure/whoop/resources/cycles.test.ts` | ✅ (rewrite) |
| ARCH-06 | `wiring.ts` produces a working `runDoctor` | unit | `npm test -- src/services/doctor/wiring.test.ts` | ❌ Wave 0 |
| ARCH-06 | bootstrap.ts no longer contains `productionWhoopFetcher` | grep gate | `! rg "productionWhoopFetcher" src/services/bootstrap.ts` | ❌ Wave 0 (new gate) |
| ARCH-07 | Doctor checks use required deps | type-check | `npm run lint` / `tsc --noEmit` | ✅ (TS catches it) |
| ARCH-08 | `src/services/api-gap/` directory does not exist | filesystem check | `[ ! -d src/services/api-gap ]` | ❌ Wave 0 (new gate) |
| ARCH-08 | `API_GAP_ENTRIES` lives at `src/domain/api-gap/catalog.ts` | filesystem check | `[ -f src/domain/api-gap/catalog.ts ]` | ❌ Wave 0 (new gate) |
| ARCH-08 | api-gap markdown still matches catalog | contract | `npm test -- tests/contract/api-gap-md-parity.test.ts` | ✅ |

### Sampling Rate

- **Per task commit:** `npm test -- <touched-file-pattern>` (Vitest filter)
- **Per wave merge:** `npm test` (full suite, < 60s budget per conventions)
- **Phase gate:** Full suite green + `scripts/ci-grep-gates.sh` green + the new layering grep gates (added in Wave 0)

### Wave 0 Gaps

- [ ] `scripts/ci-grep-gates.sh` — add new gate H "no `infrastructure/observability` imports outside the (deleted) directory" (ARCH-01); add gate I "no `export const tokenStore|refreshOrchestrator|callWithAuth`" (ARCH-02); add gate J "no `services/` imports in `client.ts`" (ARCH-03); add gate K "no `api-gap/` directory" (ARCH-08)
- [ ] `src/services/doctor/wiring.test.ts` — new test file for ARCH-06
- [ ] Possibly: pin the bootstrap.ts LOC ceiling via a CI assertion if user wants the 250 gate enforced (Open Q2)

---

## Security Domain

> Default: `security_enforcement` not set → treat as enabled.

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | yes (refactoring auth path) | ADR-0002 three-layer single-flight gate; preserved unchanged (ARCH-02 only changes construction site, not refresh mechanics) |
| V3 Session Management | partial (token storage) | `@napi-rs/keyring` with `chmod 600` fallback (existing); ARCH-02 preserves both backends |
| V4 Access Control | n/a | Single-user local tool |
| V5 Input Validation | n/a for this phase | Refactor only; INPV-01 already shipped in Phase 6 |
| V6 Cryptography | n/a | No new crypto |
| V7 Error Handling | yes | Sanitize → domain (ARCH-01) ratchets the existing redaction surface; FND-06 contract preserved |

### Known Threat Patterns for `services/refresh-orchestrator.ts` refactor (ARCH-02)

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Multiple `tokenStore` instances racing the WHOOP refresh family revocation | Information Disclosure / Denial of Service | ADR-0002 cross-process file lock (`proper-lockfile`) — survives the singleton removal because the lock is OS-level, not process-level. **Critical contract:** ARCH-02's PR MUST include the `auth-concurrency.test.ts` regression run + the new "exactly one tokenStore per process" enforcement clause in ADR-0002 §Enforcement. |
| Stale token re-use after bootstrap close | Tampering | `bootstrap.close()` only closes sqlite; tokenStore's keyring/file handles are stateless reads — no stale-handle risk. |
| Token leak via error path (post-refactor) | Information Disclosure | Sanitizer (now in `domain/observability/`) covers every error path — including `init.ts`, `auth.ts`, `sync.ts`, doctor probes. FND-06 + SECH-01/02 already in place; ARCH-01 doesn't change the redaction patterns, only the import path. |

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — no new dependencies; v1.0 + v1.1 pin set already verified by `.planning/research-v1.1/STACK.md`.
- Architecture: HIGH — milestone research is authoritative; this file translates without re-deriving.
- Build order: HIGH — milestone research provides explicit rationale for each dependency edge.
- Line numbers: MEDIUM — milestone research's line citations are stale (file growth between research and Phase 10 planning); this file pins current line numbers via `grep -n` verification on 2026-06-03.
- Pitfalls: HIGH — R3 (test mock crossing PR 2 ↔ PR 3) and R4 (load-bearing concurrency test) are the only non-mechanical risks; both have stated mitigations.
- Closed-flag verification: HIGH for ARCH-04 (single grep + file inspection) and ARCH-05 (grep all 8 shims + file inspection).

**Research date:** 2026-06-03
**Valid until:** 2026-07-03 (line numbers may drift if Phase 6/7/8/9 land in the interim; planner should re-verify with `grep -n` before each ARCH-XX plan creation)

## RESEARCH COMPLETE

Phase 10 lands 6 architectural-hygiene PRs in build order (ARCH-01 → ARCH-02 → ARCH-03 → ARCH-06 → ARCH-07 → ARCH-08); ARCH-04 and ARCH-05 already shipped and are marked CLOSED — the planner skips plans for both.
