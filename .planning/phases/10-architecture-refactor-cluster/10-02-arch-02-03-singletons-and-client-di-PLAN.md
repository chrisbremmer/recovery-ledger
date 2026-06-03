---
phase: 10-architecture-refactor-cluster
plan: 02
type: execute
wave: 2
branch: refactor/10-arch-02-03-singletons-and-client-di
depends_on: [10-01]
files_modified:
  - src/infrastructure/whoop/token-store.ts
  - src/services/refresh-orchestrator.ts
  - src/services/bootstrap.ts
  - src/services/index.ts
  - src/infrastructure/whoop/client.ts
  - src/infrastructure/whoop/client.test.ts
  - src/infrastructure/whoop/resources/cycles.ts
  - src/infrastructure/whoop/resources/recovery.ts
  - src/infrastructure/whoop/resources/sleep.ts
  - src/infrastructure/whoop/resources/workouts.ts
  - src/infrastructure/whoop/resources/profile.ts
  - src/infrastructure/whoop/resources/body-measurements.ts
  - src/cli/commands/auth.ts
  - src/services/doctor/checks/auth.ts
  - src/services/doctor/checks/token-freshness.ts
  - tests/contract/cycles.test.ts
  - tests/contract/recovery.test.ts
  - tests/contract/sleep.test.ts
  - tests/contract/workouts.test.ts
  - tests/contract/profile.test.ts
  - tests/contract/body-measurements.test.ts
  - tests/integration/sync/idempotency.test.ts
  - tests/integration/sync/partial-failure.test.ts
  - tests/integration/sync/dst-fixture.test.ts
  - tests/integration/auth-concurrency.test.ts
  - tests/integration/setup-stopwatch.test.ts
  - agent_docs/decisions/0002-single-flight-oauth-refresh.md
  - scripts/ci-grep-gates.sh
autonomous: true
requirements: [ARCH-02, ARCH-03, ARCH-04, ARCH-05]
must_haves:
  truths:
    - "`export const tokenStore` is gone from token-store.ts (was line 521)"
    - "`export const refreshOrchestrator` and `export const callWithAuth` are gone from refresh-orchestrator.ts (were lines 132, 141)"
    - "`bootstrap()` constructs `tokenStore` and `refreshOrchestrator` exactly once and threads them through `Bootstrapped.services`"
    - "`src/infrastructure/whoop/client.ts` no longer imports from `src/services/`; `httpGet` takes `authedCall: AuthedCall` as its 4th parameter"
    - "The 6 WHOOP resource modules are factories (`createListCycles({authedCall})`, etc.); bootstrap.ts wires them at the current 301-310 line block"
    - "`productionWhoopFetcher` (bootstrap.ts 396-419) receives `authedCall` and uses it in `httpGet`"
    - "`src/cli/commands/auth.ts` constructs its own `createTokenStore()` directly (documented two-construction-sites exception per Q7-RESOLVED; OAuth flow does not need DB)"
    - "ADR-0002 §Enforcement gains the 'exactly one tokenStore per process for DB-coupled flows; OAuth-login flow is the sole documented exception' rule"
    - "ARCH-02 + ARCH-03 ship in ONE atomic PR — no broken-main runtime window, no transitional `callWithAuth` bridge (per Q5-RESOLVED)"
    - "ARCH-04 closed-state holds: `rg \"from '.*infrastructure/whoop/errors'\" src tests` returns no matches for `AuthError|MigrationError`"
    - "ARCH-05 closed-state holds: every CLI shim except `auth.ts`, `doctor.ts`, `init.ts` uses `tryBootstrap`"
    - "Two new grep gates pin the new shape (forbid singleton exports; forbid `services/` import from infrastructure)"
  artifacts:
    - path: src/services/bootstrap.ts
      provides: composition root — owns tokenStore + refreshOrchestrator + authedCall construction; wires resource module factories
    - path: src/infrastructure/whoop/client.ts
      provides: AuthedCall type + httpGet signature widened with authedCall parameter; no services/ imports
    - path: src/infrastructure/whoop/resources/{cycles,recovery,sleep,workouts,profile,body-measurements}.ts
      provides: factory exports (createListCycles, createListRecovery, etc.) capturing authedCall via closure
    - path: agent_docs/decisions/0002-single-flight-oauth-refresh.md
      provides: §Enforcement amendment locking the "exactly one tokenStore per process for DB-coupled flows" invariant with the auth.ts exception
    - path: scripts/ci-grep-gates.sh
      provides: two new gates pinning the singleton-deletion + layering rule
  key_links:
    - from: src/services/bootstrap.ts
      to: src/infrastructure/whoop/resources/cycles.ts (and 5 siblings)
      via: createListCycles({ authedCall })
      pattern: "createList(Cycles|Recovery|Sleep|Workouts)\\(\\{\\s*authedCall"
    - from: src/services/bootstrap.ts
      to: src/services/refresh-orchestrator.ts
      via: createRefreshOrchestrator(tokenStore)
      pattern: "createRefreshOrchestrator\\("
    - from: src/cli/commands/auth.ts
      to: src/infrastructure/whoop/token-store.ts
      via: createTokenStore() direct construction (documented exception)
      pattern: "createTokenStore\\(\\)"
---

<objective>
Atomically drop the three module-load singletons (`tokenStore`, `refreshOrchestrator`, `callWithAuth`), make `bootstrap()` the sole construction site for DB-coupled flows, and invert the last `infrastructure → services` import by injecting `authedCall` as a parameter to `httpGet`. The 6 WHOOP resource modules become factories. `src/cli/commands/auth.ts` constructs its own `createTokenStore()` directly because the OAuth flow does not need DB (documented exception). ADR-0002 §Enforcement gains the new "exactly one tokenStore per process for DB-coupled flows" rule. Two new CI grep gates pin the new shape.

Purpose: enforce the lite-hexagonal layering rule (`cli/+mcp/ → services/ → domain/ ∪ infrastructure/`) end-to-end. Today `client.ts:25` imports `callWithAuth` from `services/refresh-orchestrator.js` — the last upward import from infrastructure to services. Today three module-load singletons construct collaborators at import time, which makes bootstrap composition implicit and creates the ADR-0002 risk of "more than one `tokenStore` in a single process." Both go away in one PR.

Q5-RESOLVED: ARCH-02 (singleton drop) and ARCH-03 (client DI invert) collapse into a single PR. The previously-proposed `callWithAuth` deprecated re-export bridge is no longer needed — combining the PRs eliminates the broken-main runtime window between the two changes. The combined diff is larger but reviewable in one pass; the alternative (sequential PRs with a one-line bridge) was rejected because the bridge IS the runtime window.

Q7-RESOLVED: `auth.ts` is a CLI shim for the OAuth login flow. It does not bootstrap because bootstrap opens the DB and runs migrations — work that the OAuth flow does not need and which would slow login + surface migration errors during a DB-independent action. Post-singleton-drop, `auth.ts` constructs `createTokenStore()` directly with a justification comment. ADR-0002 §Enforcement is phrased to accommodate this exception: "exactly one `tokenStore` per process **for DB-coupled flows**; the OAuth-login flow (`src/cli/commands/auth.ts`) constructs its own `createTokenStore()` and is the sole documented exception."

Output: 28 files modified across infrastructure, services, CLI, contract tests, integration tests, ADR docs, and the CI grep-gate script. Net code delta is mildly negative (singletons + bridge import lines deleted; factory boilerplate is offset by the simpler test mocks). PR `refactor/10-arch-02-03-singletons-and-client-di` lands on its own branch off the latest `main`, merged via GitHub PR with explicit user approval per the branch policy.

Scope: ARCH-02 + ARCH-03 atomic landing; ARCH-04 + ARCH-05 are already closed (RESEARCH §ARCH-04, §ARCH-05) — this plan only re-verifies their closed-state with one grep each. No new behavior changes beyond the DI restructuring; refresh semantics are byte-for-byte preserved (ADR-0002 three-layer single-flight gate is unchanged).
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
@.planning/research/ARCHITECTURE.md
@agent_docs/conventions.md
@agent_docs/workflows/contributing.md
@agent_docs/decisions/0002-single-flight-oauth-refresh.md
@CLAUDE.md

<interfaces>
<!-- Key types and contracts the executor needs. Extracted from the live tree on 2026-06-03. -->
<!-- Executor should use these directly — no codebase exploration needed. -->

From src/infrastructure/whoop/token-store.ts (singleton lives at line 521):
```ts
export function createTokenStore(opts?: { paths?: Paths; now?: () => number }): TokenStore;
export interface TokenStore {
  read(): Promise<Tokens | null>;
  write(tokens: Tokens): Promise<void>;
  readStorageMode(): Promise<'keychain' | 'file' | null>;
  // ...other methods unchanged
}
// DELETE this line (521):
export const tokenStore: TokenStore = createTokenStore();
```

From src/services/refresh-orchestrator.ts (singletons live at lines 132, 141):
```ts
export function createRefreshOrchestrator(tokenStore: TokenStore): RefreshOrchestrator;
export interface RefreshOrchestrator {
  callWithAuth: AuthedOperation;
  // ...
}
// DELETE these lines (130-141):
export const refreshOrchestrator: RefreshOrchestrator =
  createRefreshOrchestrator(defaultTokenStore);
export const callWithAuth = refreshOrchestrator.callWithAuth.bind(refreshOrchestrator);
```

From src/infrastructure/whoop/client.ts (line 25 is the singleton import to delete; line 100 is the usage):
```ts
// DELETE line 25:
import { callWithAuth } from '../../services/refresh-orchestrator.js';

// ADD: new exported type AuthedCall
export type AuthedCall = <T extends { status: number }>(
  op: (accessToken: string) => Promise<T>,
) => Promise<T>;

// WIDEN httpGet signature (4th positional param):
export async function httpGet<T>(
  path: string,
  query: HttpGetQuery,
  schema: z.ZodSchema<T>,
  authedCall: AuthedCall,
): Promise<T>;
```

Bootstrap wiring shape (target — bootstrap.ts will own these constructions):
```ts
// Near top of bootstrap() function body, after opts spread:
const tokenStore = opts.tokenStore ?? createTokenStore();
const refreshOrchestrator = opts.refreshOrchestrator ?? createRefreshOrchestrator(tokenStore);
const authedCall: AuthedCall = refreshOrchestrator.callWithAuth.bind(refreshOrchestrator);

// At the current line-301-310 resource block:
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

// Widen BootstrapOptions:
export interface BootstrapOptions {
  dbFile?: string;
  migrationsDir?: string;
  logger?: Logger;
  tokenStore?: TokenStore;                  // NEW — defaults to createTokenStore()
  refreshOrchestrator?: RefreshOrchestrator; // existing — already in shape
}

// Widen services on the Bootstrapped return:
return {
  // ...
  services: {
    // ...existing keys
    refreshOrchestrator,
    tokenStore,  // NEW — needed so any future consumer can pull it from the Bootstrapped surface
  },
};
```

From src/cli/commands/auth.ts (current line 40 imports the singleton; line 117 calls .write()):
```ts
// DELETE line 40:
import { tokenStore } from '../../infrastructure/whoop/token-store.js';

// REPLACE with direct factory construction (Q7-RESOLVED documented exception):
import { createTokenStore } from '../../infrastructure/whoop/token-store.js';

// At the top of the command handler, BEFORE the OAuth flow:
// ADR-0002 §Enforcement: the OAuth-login flow is the sole documented exception
// to the "exactly one tokenStore per process for DB-coupled flows" rule. This
// command does not bootstrap because bootstrap opens the DB and runs the
// migrator — work that login does not need. Routing auth.ts through
// bootstrap() would slow login and surface migration errors during a
// DB-independent action. See RESEARCH §ARCH-05 (auth.ts is correctly
// excluded from tryBootstrap) and 10-RESEARCH.md Q7-RESOLVED.
const tokenStore = createTokenStore();

// Line 117 unchanged in behavior:
await tokenStore.write(tokens);
```

Resource module factory shape (target — applies identically to all 6):
```ts
// src/infrastructure/whoop/resources/cycles.ts
import { httpGet, type AuthedCall } from '../client.js';

export interface ListCyclesDeps {
  authedCall: AuthedCall;
}

export function createListCycles(deps: ListCyclesDeps) {
  return async function listCycles(opts: ListCyclesOpts): Promise<ListCyclesResult> {
    // existing body, but every httpGet(path, query, schema) becomes:
    // httpGet(path, query, schema, deps.authedCall)
  };
}
```

Contract test mock simplification (target — applies to all 5 contract tests + 3 integration sync tests):
```ts
// BEFORE (today, in tests/contract/cycles.test.ts:32):
vi.mock('../../src/services/refresh-orchestrator.js', () => ({
  callWithAuth: (op: (token: string) => Promise<unknown>) => op('test-token-123'),
}));

// AFTER: mock disappears entirely. Compose the factory with a fake authedCall:
const authedCall: AuthedCall = (op) => op('test-token-123');
const listCycles = createListCycles({ authedCall });
```

ADR-0002 §Enforcement amendment (insert as a new bullet after the existing
ERRC-02 paragraph at line ~83-90, verbatim text):

> **ARCH-02 (#85) — exactly one tokenStore per process for DB-coupled flows:**
> production code MUST construct `tokenStore` exactly once via `bootstrap()`.
> The historical `export const tokenStore = createTokenStore()` module-load
> singleton in `src/infrastructure/whoop/token-store.ts` is forbidden —
> bootstrap is the sanctioned construction site for DB-coupled flows, and
> consumers receive the instance through the `Bootstrapped` surface. The
> OAuth-login flow (`src/cli/commands/auth.ts`) is the sole documented
> exception: it constructs its own `createTokenStore()` instance because the
> login flow does not bootstrap (no DB needed; bootstrapping would slow login
> and surface migration errors during a DB-independent action). Tests
> construct fresh stores via `createTokenStore(...)`; nothing imports the
> (deleted) singleton. Enforced by `rg "^export const tokenStore" src`
> returning zero matches AND `rg "import.*tokenStore[^A-Za-z]" src` returning
> matches only in `src/services/bootstrap.ts` and `src/cli/commands/auth.ts`.

Test files that mock the deleted `callWithAuth` export (must be rewritten — verified live 2026-06-03):
- src/infrastructure/whoop/client.test.ts (the mock at line ~22 disappears entirely)
- tests/contract/cycles.test.ts:32
- tests/contract/recovery.test.ts:38
- tests/contract/sleep.test.ts:17
- tests/contract/workouts.test.ts:19
- tests/contract/profile.test.ts:15
- tests/contract/body-measurements.test.ts:22
- tests/integration/sync/idempotency.test.ts:34
- tests/integration/sync/partial-failure.test.ts:26
- tests/integration/sync/dst-fixture.test.ts:33
- tests/integration/auth-concurrency.test.ts (the forked workers import the singleton; rewrite to construct createTokenStore() per child — see RESEARCH §R4)
- tests/integration/setup-stopwatch.test.ts:214,221 (await import of compiled tokenStore singleton; rewrite to createTokenStore())

NOTE: `tests/contract/profile.test.ts` AND `tests/contract/body-measurements.test.ts` DO exist on the live tree (verified 2026-06-03 via `ls tests/contract/`). There is no `tests/contract/idempotency.test.ts` — the idempotency test lives at `tests/integration/sync/idempotency.test.ts`.

NOTE: there are NO co-located unit tests at `src/infrastructure/whoop/resources/{cycles,recovery,sleep,workouts,profile,body-measurements}.test.ts`. Verified 2026-06-03 via `ls src/infrastructure/whoop/resources/` — only the 6 source files exist; resource testing is done end-to-end via `tests/contract/`. DO NOT create new unit tests in this PR.

Current bootstrap.ts line ranges (verified 2026-06-03 via `wc -l src/services/bootstrap.ts` → 479 lines):
- Line 121: `import { refreshOrchestrator } from './refresh-orchestrator.js';` — DELETE; bootstrap will construct it
- Line 301-310: resource-wiring block (the `whoop: RunSyncDeps['whoop'] = { resources: { cycles: listCycles, ... } }` block) — REWRITE to call factories
- Line 396-419: `productionWhoopFetcher` body — INJECT `authedCall` and use it in the inner `httpGet` call (current code: `await httpGet('/v2/user/profile/basic', {}, WhoopRawProfile);` — becomes `await httpGet('/v2/user/profile/basic', {}, WhoopRawProfile, authedCall);`)
- Line 428-444: `services_runDoctor` closure — STILL captures `refreshOrchestrator` from the new local const (no change to consumer shape; only the source binding changes)

Current scripts/ci-grep-gates.sh status (verified 2026-06-03 via `grep -n "^# Gate" scripts/ci-grep-gates.sh`):
- Gates A through J are already implemented in the live tree for OTHER concerns (banned tone, console.log, process.stdout.write, server.registerTool, WHOOP refresh URL, fetch, drizzle-orm, tools.length, registerResource, registerPrompt).
- Plan 10-01 added one more gate for the sanitize-domain rule — the executor selected the next-available letter.
- This plan's two new gates ("no singleton exports" + "no services/ imports from infrastructure") should use the next TWO available letters after plan 10-01's addition. The ROADMAP refers to them as "Gates I + J" by REQ label, but the actual letters at execution time are whichever come next in the script (almost certainly K + L if plan 10-01 used the next-after-J slot). The executor MUST scan the existing script header and pick the next two free letters; the gate's identity is its purpose, not its letter.
</interfaces>
</context>

<tasks>

<task type="auto">
  <name>Task 1: Drop three module-load singletons + bootstrap owns construction + widen Bootstrapped surface + barrel cleanup</name>
  <files>src/infrastructure/whoop/token-store.ts, src/services/refresh-orchestrator.ts, src/services/bootstrap.ts, src/services/index.ts</files>
  <read_first>
    src/infrastructure/whoop/token-store.ts,
    src/services/refresh-orchestrator.ts,
    src/services/bootstrap.ts,
    src/services/index.ts,
    .planning/phases/10-architecture-refactor-cluster/10-RESEARCH.md,
    agent_docs/decisions/0002-single-flight-oauth-refresh.md
  </read_first>
  <action>
Implements ARCH-02 (drop singletons; bootstrap owns construction).

1. **token-store.ts:521** — delete the line `export const tokenStore: TokenStore = createTokenStore();`. Confirm via `grep -n "^export const tokenStore" src/infrastructure/whoop/token-store.ts` returning no matches after the edit. `createTokenStore` stays exported as the factory; no other changes to this file. Run `grep -c "^export const tokenStore" src/infrastructure/whoop/token-store.ts` and assert 0.

2. **refresh-orchestrator.ts:130-141** — delete the three exports per the RESEARCH §ARCH-02 diff:
   - Line ~33: change `import { tokenStore as defaultTokenStore, ... } from '../infrastructure/whoop/token-store.js';` to keep only the type + REFRESH_BUFFER_MS imports (or whatever non-singleton symbols are imported); the runtime binding `defaultTokenStore` goes away.
   - Lines 130-141 (the `export const refreshOrchestrator` + `export const callWithAuth` block, plus the surrounding comments referring to them as "convenience re-exports"): delete entirely.
   - `createRefreshOrchestrator` factory remains exported.
   - Confirm via `grep -nE "^export const (refreshOrchestrator|callWithAuth)" src/services/refresh-orchestrator.ts` returning no matches.

3. **bootstrap.ts** — add the three constructions near the top of the `bootstrap()` function body (after the `opts` spread but before any DB or repo wiring). See the `<interfaces>` block above for the exact shape. Widen `BootstrapOptions` to include `tokenStore?: TokenStore` (the existing `refreshOrchestrator?` opt is already on the interface per the line-121 import that's about to disappear — but trace the actual current interface and add the field if missing). Widen the `services` shape on the `Bootstrapped` return to include `tokenStore` so a future consumer can pull it from the surface (auth.ts is exempt and uses direct construction per Decision C, but other DB-coupled flows can use the surface). Delete the line-121 import `import { refreshOrchestrator } from './refresh-orchestrator.js';` because the local-const construction replaces it.

4. **bootstrap.ts** — the line-301-310 resource block: this task touches it only minimally (keep the existing `listCycles` / `listRecovery` / etc. references — they become factory calls in Task 2 once the factories exist). For THIS task, leave the resource wiring shape unchanged; the only edit here is that the `refreshOrchestrator` it references is now the local const, not the deleted singleton.

5. **bootstrap.ts:438** — `opts.refreshOrchestrator ?? refreshOrchestrator` still works because `refreshOrchestrator` is now a local const. **bootstrap.ts:468** — `services.refreshOrchestrator: refreshOrchestrator` still works. Both call sites stay byte-identical in shape.

6. **bootstrap.ts:396-419** — the `productionWhoopFetcher` body currently calls `httpGet('/v2/user/profile/basic', {}, WhoopRawProfile)` at line ~401. Add the 4th argument `authedCall` to that call. The local `authedCall` const (constructed in step 3) is in scope at this line. This is the ONLY change to `productionWhoopFetcher` in this task — the broader `authedCall`-threading into the resource modules is Task 2.

7. **src/services/index.ts:37** — currently `import { refreshOrchestrator } from './refresh-orchestrator.js';` and the `ServicesBase` interface re-exports `refreshOrchestrator: typeof refreshOrchestrator`. Post-singleton-drop the `import` line breaks. Options:
   a. Change the import to `import type { RefreshOrchestrator } from './refresh-orchestrator.js';` and change the `ServicesBase` interface field from `refreshOrchestrator: typeof refreshOrchestrator` to `refreshOrchestrator: RefreshOrchestrator`.
   b. The `createServices()` function at the bottom of `index.ts` currently returns `{ runDoctor, refreshOrchestrator }` where `refreshOrchestrator` is the deleted singleton. **Two paths**:
      - Path (b1): change `createServices()` to construct its own `createRefreshOrchestrator(createTokenStore())` inside the function — but this creates a SECOND construction site beyond auth.ts, which violates Q7-RESOLVED.
      - Path (b2): drop the `refreshOrchestrator` field from `ServicesBase` entirely; the lightweight `createServices()` no-DB path doesn't expose it. Consumers that need it use `bootstrap()`.
      - **Decision: Path (b2).** Justification: `createServices()` is the no-DB path used by doctor's lightweight check surface; nothing in that surface needs `refreshOrchestrator`. The full surface comes through `bootstrap()` which already exposes `refreshOrchestrator` on `services`. Removing the field from `ServicesBase` is type-safe (TS catches any consumer that relied on the field through `ServicesBase`) and is the only path consistent with Q7-RESOLVED.
   c. Update the `ServicesBase` interface (line ~95-100) to drop `refreshOrchestrator`. The `Services` interface (extends `ServicesBase`) keeps `refreshOrchestrator` because the `bootstrap()` return shape continues to expose it.
   d. Update `createServices()` (line ~155) to return only `{ runDoctor }` — drop the `refreshOrchestrator` key.

8. **Conventions** per `agent_docs/conventions.md`: ESM-only, no default exports, TS strict — all preserved. Conventional commit: `refactor(10): drop tokenStore/refreshOrchestrator/callWithAuth singletons; bootstrap owns construction (ARCH-02)`.

Do NOT touch the resource modules, `client.ts`, `auth.ts`, the test files, the ADR, or `ci-grep-gates.sh` in this task — those are split across Tasks 2-6.
  </action>
  <verify>
    <automated>grep -c "^export const tokenStore" src/infrastructure/whoop/token-store.ts | grep -q "^0$" && grep -cE "^export const (refreshOrchestrator|callWithAuth)" src/services/refresh-orchestrator.ts | grep -q "^0$" &amp;&amp; npm test -- src/services/bootstrap.test.ts &amp;&amp; npm test -- src/services/refresh-orchestrator.test.ts</automated>
  </verify>
  <acceptance_criteria>
    - `grep -c "^export const tokenStore" src/infrastructure/whoop/token-store.ts` returns `0`
    - `grep -cE "^export const (refreshOrchestrator|callWithAuth)" src/services/refresh-orchestrator.ts` returns `0`
    - `grep -n "from './refresh-orchestrator.js'" src/services/bootstrap.ts` returns no value-import line (only type imports if any)
    - `npm test -- src/services/bootstrap.test.ts` passes; existing tests still pass; ADD a new test case "passing custom tokenStore is honored" that asserts `bootstrap({ tokenStore: customStore }).services.refreshOrchestrator` uses the custom store
    - `npm test -- src/services/refresh-orchestrator.test.ts` passes; existing tests continue to use `createRefreshOrchestrator(mockStore)`
    - `npm run lint` passes (TS strict catches any consumer that relied on the deleted `ServicesBase.refreshOrchestrator` field — fix in this task if any surface)
    - `tsc --noEmit` passes (the CI gate added in commit cebc2f5 will reject any drift)
  </acceptance_criteria>
  <done>Three singletons deleted; bootstrap.ts constructs tokenStore + refreshOrchestrator + authedCall once; productionWhoopFetcher accepts authedCall via the new local const; services/index.ts barrel cleaned up; bootstrap test suite green including a new "honors injected tokenStore" case; lint + tsc green.</done>
</task>

<task type="auto">
  <name>Task 2: Invert client.ts via authedCall DI + convert 6 resource modules to factories + wire factories in bootstrap.ts</name>
  <files>src/infrastructure/whoop/client.ts, src/infrastructure/whoop/resources/cycles.ts, src/infrastructure/whoop/resources/recovery.ts, src/infrastructure/whoop/resources/sleep.ts, src/infrastructure/whoop/resources/workouts.ts, src/infrastructure/whoop/resources/profile.ts, src/infrastructure/whoop/resources/body-measurements.ts, src/services/bootstrap.ts</files>
  <read_first>
    src/infrastructure/whoop/client.ts,
    src/infrastructure/whoop/resources/cycles.ts,
    src/infrastructure/whoop/resources/recovery.ts,
    src/infrastructure/whoop/resources/sleep.ts,
    src/infrastructure/whoop/resources/workouts.ts,
    src/infrastructure/whoop/resources/profile.ts,
    src/infrastructure/whoop/resources/body-measurements.ts,
    src/services/bootstrap.ts,
    .planning/phases/10-architecture-refactor-cluster/10-RESEARCH.md
  </read_first>
  <action>
Implements ARCH-03 (client.ts DI invert + resource module factories).

1. **client.ts:25** — delete `import { callWithAuth } from '../../services/refresh-orchestrator.js';`. This is the last `infrastructure → services` import in the codebase; deleting it makes the layering rule grep-enforceable.

2. **client.ts** — add a new exported type `AuthedCall` near the top of the file (after the existing imports, before the `HttpGetQuery` type):
   ```ts
   export type AuthedCall = <T extends { status: number }>(
     op: (accessToken: string) => Promise<T>,
   ) => Promise<T>;
   ```

3. **client.ts** — widen `httpGet`'s signature to take `authedCall: AuthedCall` as its 4th positional parameter (after `path`, `query`, `schema`). At line ~100 (the body of `httpGet`), replace `response = await callWithAuth(async (accessToken) => fetch(...))` with `response = await authedCall(async (accessToken) => fetch(...))`. The fetch call inside the closure stays unchanged (still GET-only per ADR-0007). The retry/error handling around the call stays unchanged.

4. **resources/cycles.ts** — convert to factory shape per the `<interfaces>` block. Export a new `ListCyclesDeps` interface (`{ authedCall: AuthedCall }`), wrap the existing `listCycles` function body in `createListCycles(deps: ListCyclesDeps) { return async function listCycles(...) {...} }`. Inside the body, every call to `httpGet(path, query, schema)` becomes `httpGet(path, query, schema, deps.authedCall)`. **Delete the named export `listCycles`** because callers now use the factory. If any other module imports `listCycles` directly (search with `grep -rn "import.*listCycles\b" src tests --include='*.ts'`), update the importer to use the factory — `bootstrap.ts` is the only such importer per RESEARCH.

5. **resources/recovery.ts, sleep.ts, workouts.ts, profile.ts, body-measurements.ts** — apply the identical factory transformation to each. Each module exports a `createListRecovery` / `createListSleep` / `createListWorkouts` / `createGetProfile` / `createGetBodyMeasurement` factory plus a `{ResourceName}Deps` interface. The shape is mechanical and identical across all 6 modules.

6. **bootstrap.ts:301-310** — rewrite the resource-wiring block to call the factories:
   ```ts
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
   The local `authedCall` const was constructed in Task 1 step 3. Update the imports at the top of `bootstrap.ts` to bring in the factory names instead of the (now-deleted) bare `listCycles` etc.

7. **bootstrap.ts:396-419** — `productionWhoopFetcher` already received the `authedCall` argument addition in Task 1 step 6. **No further change here in Task 2** — the fetcher body still calls `httpGet('/v2/user/profile/basic', {}, WhoopRawProfile, authedCall)` which now type-checks cleanly because the new 4th parameter is honored.

8. **RunSyncDeps['whoop']** consumer shape: `runSync` at `src/services/sync/index.ts` consumes `whoop.resources.cycles(opts)` etc. — the consumer shape is unchanged (each resource is still a `(opts) => Promise<Result>` function); only the construction shape moved. RESEARCH §ARCH-03 confirms `runSync` needs no changes.

9. **Conventions** — TS strict, ESM, no defaults; preserved. Conventional commit (squashed with Task 1's commit at PR-create time or kept atomic depending on the executor's preference; per `agent_docs/workflows/contributing.md` Conventional Commits, two commits in one PR are fine): `refactor(10): invert client.ts via authedCall DI; resource modules become factories (ARCH-03)`.

Do NOT touch the test files, `auth.ts`, the ADR, or `ci-grep-gates.sh` in this task — those are Tasks 3-6.
  </action>
  <verify>
    <automated>grep -c "from.*services/" src/infrastructure/whoop/client.ts | grep -q "^0$" &amp;&amp; npm test -- src/infrastructure/whoop/client.test.ts &amp;&amp; tsc --noEmit</automated>
  </verify>
  <acceptance_criteria>
    - `grep -c "from.*services/" src/infrastructure/whoop/client.ts` returns `0` (the last infrastructure→services import is gone)
    - `grep -c "export type AuthedCall" src/infrastructure/whoop/client.ts` returns `1`
    - `grep -c "authedCall: AuthedCall" src/infrastructure/whoop/client.ts` returns at least `1` (the new 4th param)
    - `grep -lE "export function createList(Cycles|Recovery|Sleep|Workouts)" src/infrastructure/whoop/resources/` lists 4 files
    - `grep -lE "export function createGet(Profile|BodyMeasurement)" src/infrastructure/whoop/resources/` lists 2 files
    - `grep -cE "createList(Cycles|Recovery|Sleep|Workouts)\(\{\s*authedCall" src/services/bootstrap.ts` returns `4`
    - `grep -cE "createGet(Profile|BodyMeasurement)\(\{\s*authedCall" src/services/bootstrap.ts` returns `2`
    - `tsc --noEmit` passes — the test files still mock the deleted `callWithAuth` so they'll FAIL their tests until Task 3, but type-check should pass for src/ alone if the mocks tolerate type drift (vi.mock against a non-existent export is a no-op at runtime but does generate a TS error if the mock is typed against the import path; if the existing tests use `vi.mock` with a string literal path + an inline factory, TS does not check the factory shape, so this passes). If `tsc --noEmit` fails on a test file because it imports the deleted `callWithAuth` directly (not just via vi.mock), proceed to Task 3 in the same PR before running CI.
    - `npm test -- src/infrastructure/whoop/client.test.ts` is EXPECTED to fail until Task 3 rewrites the mock — note this in the task summary and proceed to Task 3
  </acceptance_criteria>
  <done>client.ts is services-free; 6 resource modules export factories; bootstrap.ts wires factories with authedCall; type-check passes for src/; the contract + client tests fail until Task 3 (expected — fixed in the next task of this same PR).</done>
</task>

<task type="auto">
  <name>Task 3: Rewrite all test mocks for the deleted callWithAuth export + auth-concurrency worker entry</name>
  <files>src/infrastructure/whoop/client.test.ts, tests/contract/cycles.test.ts, tests/contract/recovery.test.ts, tests/contract/sleep.test.ts, tests/contract/workouts.test.ts, tests/contract/profile.test.ts, tests/contract/body-measurements.test.ts, tests/integration/sync/idempotency.test.ts, tests/integration/sync/partial-failure.test.ts, tests/integration/sync/dst-fixture.test.ts, tests/integration/auth-concurrency.test.ts, tests/integration/setup-stopwatch.test.ts</files>
  <read_first>
    src/infrastructure/whoop/client.test.ts,
    tests/contract/cycles.test.ts,
    tests/contract/recovery.test.ts,
    tests/contract/sleep.test.ts,
    tests/contract/workouts.test.ts,
    tests/contract/profile.test.ts,
    tests/contract/body-measurements.test.ts,
    tests/integration/sync/idempotency.test.ts,
    tests/integration/sync/partial-failure.test.ts,
    tests/integration/sync/dst-fixture.test.ts,
    tests/integration/auth-concurrency.test.ts,
    tests/integration/setup-stopwatch.test.ts,
    .planning/phases/10-architecture-refactor-cluster/10-RESEARCH.md
  </read_first>
  <action>
Rewrites test mocks so the suite passes against the new shape. This task is the load-bearing test-update half of the combined PR.

1. **src/infrastructure/whoop/client.test.ts** — remove the `vi.mock('../../services/refresh-orchestrator.js', ...)` block entirely (currently at line ~22). The test no longer mocks the deleted module. Instead, every test case that exercises `httpGet` constructs a fake `authedCall` inline:
   ```ts
   const authedCall: AuthedCall = (op) => op('test-token-123');
   const result = await httpGet(path, query, schema, authedCall);
   ```
   This is strictly simpler than the prior mock — no `vi.mock` setup, no `callWithAuthSpy`, no module-mock leakage between test files.

2. **tests/contract/cycles.test.ts** (line 32 is the singleton mock per `grep`) — same transformation. Delete the `vi.mock('../../src/services/refresh-orchestrator.js', () => ({ callWithAuth: (op) => op('test-token-123') }))` block. Import the new factory `createListCycles` from `src/infrastructure/whoop/resources/cycles.js` and the type `AuthedCall` from `src/infrastructure/whoop/client.js`. Construct the fake at the top of the test: `const authedCall: AuthedCall = (op) => op('test-token-123');` and the factory inside each test: `const listCycles = createListCycles({ authedCall });`. The MSW handlers stay byte-identical (they intercept the actual `fetch` inside `httpGet`).

3. **tests/contract/recovery.test.ts** (line 38), **sleep.test.ts** (line 17), **workouts.test.ts** (line 19), **profile.test.ts** (line 15), **body-measurements.test.ts** (line 22) — apply the identical transformation per resource:
   - Delete the `vi.mock('.../refresh-orchestrator.js', ...)` block.
   - Import the factory (`createListRecovery` / `createListSleep` / `createListWorkouts` / `createGetProfile` / `createGetBodyMeasurement`) + `AuthedCall` type.
   - Construct the fake and the factory at the top of the test file or each test as appropriate.

4. **tests/integration/sync/idempotency.test.ts** (line 34), **partial-failure.test.ts** (line 26), **dst-fixture.test.ts** (line 33) — these tests wire through `runSync` via `bootstrap()`. Per RESEARCH §ARCH-03 Test impact, these should work unchanged because `runSync` consumes `whoop.resources` via the same shape — BUT the `vi.mock('.../refresh-orchestrator.js', ...)` blocks at the cited lines mock the deleted singleton. Two options:
   a. Delete the `vi.mock` block and instead pass a custom `refreshOrchestrator` (or `tokenStore`) to `bootstrap()` via the widened options — the simplest path because Task 1 step 3 added `tokenStore?: TokenStore` to `BootstrapOptions`.
   b. Construct a fake `refreshOrchestrator` per test that satisfies the `RefreshOrchestrator` interface with a `callWithAuth: (op) => op('test-token-123')` field, then pass it in via `bootstrap({ refreshOrchestrator: fake })`.
   **Decision: Path (b).** The tests assert sync behavior under controlled auth; constructing a fake orchestrator is more honest than mocking a module. Use `bootstrap({ refreshOrchestrator: { callWithAuth: (op) => op('test-token-123'), /* other methods if read */ } as RefreshOrchestrator })`.

5. **tests/integration/auth-concurrency.test.ts** — the LOAD-BEARING test for ADR-0002. Per RESEARCH §R4: this test spawns 10 forked children, each importing the **compiled** `tokenStore` from `dist/` to assert the cross-process lock prevents > 1 WHOOP refresh. **Fix**: in the worker entry (search for the `tokenStore.write` or `tokenStore.read` calls in forked children, currently around lines 33, 407), each forked child constructs `createTokenStore()` once at the top of its worker entry. The single-flight contract is preserved because the OS-level file lock + atomic write are still the chokepoint; the in-process Promise singleton is per-process either way. Carefully preserve:
   - The 10-fork structure
   - The MSW `once: true` interceptor that asserts exactly one refresh
   - All timing assertions
   Only change the `import { tokenStore } from ...` line in each child to `import { createTokenStore } from ...` followed by `const tokenStore = createTokenStore();` at the top of the worker function. This is the single most important diff in this PR — read the test top-to-bottom before editing.

6. **tests/integration/setup-stopwatch.test.ts:214,221** — currently does `const { tokenStore } = await import('../../src/infrastructure/whoop/token-store.js');` then `await tokenStore.write(tokens)`. Change to `const { createTokenStore } = await import(...); const tokenStore = createTokenStore(); await tokenStore.write(tokens);`. The stopwatch test asserts <20-minute setup budget; the change adds one constructor call (~0ms cost per RESEARCH §R2) and should not affect the budget.

7. **Run the relevant integration smoke locally before committing**:
   - `npm test -- tests/integration/auth-concurrency.test.ts` — the load-bearing ADR-0002 contract; failure here is a hard stop.
   - `npm test -- tests/integration/setup-stopwatch.test.ts` — confirms no MCP cold-start regression.
   - `npm test -- tests/contract/` — all 5 contract tests + the api-gap parity (parity is untouched here).
   - `npm test -- tests/integration/sync/` — all 3 sync integration tests.

8. **Conventions** — Vitest pool: 'forks' per `agent_docs/conventions.md`; the suite finishes under 60s. Conventional commit: `test(10): rewrite mocks to inject authedCall directly; auth-concurrency worker constructs createTokenStore() per child (ARCH-02, ARCH-03)`.
  </action>
  <verify>
    <automated>npm test -- src/infrastructure/whoop/client.test.ts &amp;&amp; npm test -- tests/contract/ &amp;&amp; npm test -- tests/integration/auth-concurrency.test.ts &amp;&amp; npm test -- tests/integration/setup-stopwatch.test.ts &amp;&amp; npm test -- tests/integration/sync/</automated>
  </verify>
  <acceptance_criteria>
    - `grep -rn "vi.mock.*refresh-orchestrator" src tests --include='*.ts'` returns no matches (every singleton mock has been replaced with direct DI)
    - `grep -rn "import.*tokenStore[^A-Za-z]" tests --include='*.ts'` shows only `createTokenStore`-style imports, not the deleted singleton
    - `npm test -- src/infrastructure/whoop/client.test.ts` passes
    - `npm test -- tests/contract/cycles.test.ts tests/contract/recovery.test.ts tests/contract/sleep.test.ts tests/contract/workouts.test.ts tests/contract/profile.test.ts tests/contract/body-measurements.test.ts` all pass
    - `npm test -- tests/integration/auth-concurrency.test.ts` passes (MSW asserts exactly 1 refresh across 10 forks; the cross-process lock contract holds)
    - `npm test -- tests/integration/setup-stopwatch.test.ts` passes (no startup budget regression)
    - `npm test -- tests/integration/sync/` (all 3 sync integration tests) pass
    - Full suite: `npm test` passes in <60s per conventions
  </acceptance_criteria>
  <done>All 12 test files rewritten to inject authedCall (or refreshOrchestrator on the bootstrap surface) directly; vi.mock for the deleted singleton is gone everywhere; auth-concurrency worker constructs createTokenStore() per child without breaking the ADR-0002 cross-process lock contract; full suite green in <60s.</done>
</task>

<task type="auto">
  <name>Task 4: Migrate auth.ts to direct createTokenStore() construction with documented exception comment + update the 2 doctor checks</name>
  <files>src/cli/commands/auth.ts, src/services/doctor/checks/auth.ts, src/services/doctor/checks/token-freshness.ts</files>
  <read_first>
    src/cli/commands/auth.ts,
    src/services/doctor/checks/auth.ts,
    src/services/doctor/checks/token-freshness.ts,
    .planning/phases/10-architecture-refactor-cluster/10-RESEARCH.md
  </read_first>
  <action>
Implements ARCH-02's auth.ts exception (Q7-RESOLVED) and the two-doctor-check overlap with ARCH-07 (auth.ts + token-freshness.ts singleton imports).

1. **src/cli/commands/auth.ts:40** — change `import { tokenStore } from '../../infrastructure/whoop/token-store.js';` to `import { createTokenStore } from '../../infrastructure/whoop/token-store.js';`. Then near the top of the command handler (before any logic that touches tokens; the OAuth flow currently runs `runOAuth(...)` then `tokenStore.write(tokens)` at line 117), construct the local instance:

   ```ts
   // ADR-0002 §Enforcement (post-ARCH-02): the OAuth-login flow is the sole
   // documented exception to the "exactly one tokenStore per process for
   // DB-coupled flows" rule. This command does not bootstrap because
   // bootstrap opens the DB and runs the migrator — work that login does
   // not need. Routing auth.ts through bootstrap() would slow login and
   // surface migration errors during a DB-independent action.
   // See RESEARCH §ARCH-05 (auth.ts is correctly excluded from tryBootstrap)
   // and 10-RESEARCH.md Q7-RESOLVED.
   const tokenStore = createTokenStore();
   ```

   The `await tokenStore.write(tokens)` call at line 117 stays unchanged (the local `tokenStore` const shadows nothing because the singleton import was deleted). Confirm via `grep -n "tokenStore" src/cli/commands/auth.ts` that the only references are: the import of `createTokenStore`, the local const construction with its justification comment, and the `tokenStore.write(tokens)` call.

2. **src/services/doctor/checks/auth.ts:29 + lines 43-45** — currently imports `tokenStore` from the singleton + uses `deps?.readStorageMode ?? (() => tokenStore.readStorageMode())` + same pattern for `deps?.readTokens ?? (() => tokenStore.read())`. **Two changes**:
   a. Delete the `import { type Tokens, tokenStore } from '../../../infrastructure/whoop/token-store.js';` line; replace with `import { type Tokens } from '../../../infrastructure/whoop/token-store.js';` (drop the runtime singleton import; keep the type).
   b. Tighten the function signature from `deps?: AuthProbeDeps` to `deps: AuthProbeDeps` (drop the `?`). Inside the body, change `const readStorageMode = deps?.readStorageMode ?? (() => tokenStore.readStorageMode());` to `const readStorageMode = deps.readStorageMode;` and the same transformation for `readTokens`. **This is ARCH-07's pattern landing in ARCH-02's PR for this file** — RESEARCH §ARCH-07 calls out that the two patterns naturally overlap for auth.ts + token-freshness.ts; doing them here saves a round trip. The remaining 12 doctor checks (those that don't import the singleton) wait for plan 10-04.

3. **src/services/doctor/checks/token-freshness.ts:24, 56-58** — same pattern:
   a. Delete the `tokenStore` import (line ~24); keep the `Tokens` type import.
   b. Tighten `deps?: TokenFreshnessProbeDeps` → `deps: TokenFreshnessProbeDeps`.
   c. Change `const read = deps?.read ?? (() => tokenStore.read());` to `const read = deps.read;` and `const now = deps?.now ?? Date.now;` to `const now = deps.now;`.

4. **Production callers of probeAuth + probeTokenFreshness** — `runDoctorImpl` (and post-ARCH-06, the new `createProductionDoctorDeps`) already passes these deps explicitly per RESEARCH §ARCH-07. Verify via `grep -rn "probeAuth\b\|probeTokenFreshness\b" src --include='*.ts'`. Update any caller that relied on the optional shape (none expected per RESEARCH; if any surface, fix here). The unit tests at `src/services/doctor/checks/auth.test.ts` and `src/services/doctor/checks/token-freshness.test.ts` already pass `deps` explicitly per RESEARCH; the type tightening surfaces no test churn.

5. **Conventions** — Conventional commit: `refactor(10): auth.ts uses direct createTokenStore() per Q7-RESOLVED; tighten 2 doctor checks to required deps (ARCH-02, ARCH-07)`.
  </action>
  <verify>
    <automated>grep -c "createTokenStore()" src/cli/commands/auth.ts | grep -q "^1$" &amp;&amp; grep -c "tokenStore" src/services/doctor/checks/auth.ts | grep -q "^0$" &amp;&amp; grep -c "tokenStore" src/services/doctor/checks/token-freshness.ts | grep -q "^0$" &amp;&amp; npm test -- src/cli/commands/auth.test.ts &amp;&amp; npm test -- src/services/doctor/checks/auth.test.ts &amp;&amp; npm test -- src/services/doctor/checks/token-freshness.test.ts</automated>
  </verify>
  <acceptance_criteria>
    - `grep -c "createTokenStore()" src/cli/commands/auth.ts` returns `1` (exactly one local construction; no module-load singleton import)
    - `grep -c "ADR-0002.*Enforcement\|Q7-RESOLVED" src/cli/commands/auth.ts` returns at least `1` (the justification comment is present and references the resolution)
    - `grep "tokenStore" src/services/doctor/checks/auth.ts` shows no runtime references (only type-position `Tokens` is allowed)
    - `grep "tokenStore" src/services/doctor/checks/token-freshness.ts` shows no runtime references
    - `grep -c "deps?: " src/services/doctor/checks/auth.ts` returns `0` (tightened to required `deps`)
    - `grep -c "deps?: " src/services/doctor/checks/token-freshness.ts` returns `0`
    - `npm test -- src/cli/commands/auth.test.ts` passes (the test may need a small update to construct its own `createTokenStore()` fake — handle in this task if so)
    - `npm test -- src/services/doctor/checks/auth.test.ts src/services/doctor/checks/token-freshness.test.ts` both pass
  </acceptance_criteria>
  <done>auth.ts uses direct createTokenStore() with the Q7-RESOLVED justification comment; the two doctor checks that imported the singleton no longer do so and use required deps; the relevant unit tests pass; the singleton has zero remaining importers in src/ outside bootstrap.ts.</done>
</task>

<task type="auto">
  <name>Task 5: ADR-0002 §Enforcement amendment landing in same PR as code changes</name>
  <files>agent_docs/decisions/0002-single-flight-oauth-refresh.md</files>
  <read_first>
    agent_docs/decisions/0002-single-flight-oauth-refresh.md,
    .planning/phases/10-architecture-refactor-cluster/10-RESEARCH.md
  </read_first>
  <action>
Implements the ADR-0002 §Enforcement amendment specified in RESEARCH §Cross-cutting "ADR-0002 §Enforcement amendment" + RESOLVED text from Q7.

1. Open `agent_docs/decisions/0002-single-flight-oauth-refresh.md` and navigate to the `## Enforcement` section (line 75). Identify the existing ERRC-02 paragraph (per RESEARCH, current line ~83-90). Insert a NEW bullet after that paragraph, using the verbatim Q7-RESOLVED-accommodating text below:

> **ARCH-02 (#85) — exactly one tokenStore per process for DB-coupled flows:** production code MUST construct `tokenStore` exactly once via `bootstrap()`. The historical `export const tokenStore = createTokenStore()` module-load singleton in `src/infrastructure/whoop/token-store.ts` is forbidden — bootstrap is the sanctioned construction site for DB-coupled flows, and consumers receive the instance through the `Bootstrapped` surface. The OAuth-login flow (`src/cli/commands/auth.ts`) is the sole documented exception: it constructs its own `createTokenStore()` instance because the login flow does not bootstrap (no DB needed; bootstrapping would slow login and surface migration errors during a DB-independent action). Tests construct fresh stores via `createTokenStore(...)`; nothing imports the (deleted) singleton. Enforced by `rg "^export const tokenStore" src` returning zero matches AND `rg "import.*tokenStore[^A-Za-z]" src` returning matches only in `src/services/bootstrap.ts` and `src/cli/commands/auth.ts`.

2. No other section of the ADR changes. Do NOT touch the `## Context` / `## Decision` / `## Consequences` / `## Alternatives considered` / `## Cross-references` sections.

3. Conventional commit (per `agent_docs/workflows/contributing.md`): `docs(10): ADR-0002 §Enforcement — exactly one tokenStore per process for DB-coupled flows (ARCH-02)`. The amendment MUST land in the SAME PR as the code changes (Tasks 1-4) — the enforcement rule and the code that satisfies it are atomic per RESEARCH §Cross-cutting.

4. Per CLAUDE.md ADR-0005 (banned tone words): the new bullet uses none of the banned words. Per ADR-0001 (MCP stdout purity): the ADR is documentation; it does not affect runtime stdout. No conflicts.
  </action>
  <verify>
    <automated>grep -c "ARCH-02 (#85) — exactly one tokenStore per process for DB-coupled flows" agent_docs/decisions/0002-single-flight-oauth-refresh.md | grep -q "^1$" &amp;&amp; grep -c "sole documented exception" agent_docs/decisions/0002-single-flight-oauth-refresh.md | grep -q "^1$"</automated>
  </verify>
  <acceptance_criteria>
    - `grep -c "ARCH-02 (#85) — exactly one tokenStore per process for DB-coupled flows" agent_docs/decisions/0002-single-flight-oauth-refresh.md` returns `1`
    - `grep -c "sole documented exception" agent_docs/decisions/0002-single-flight-oauth-refresh.md` returns `1` (the auth.ts exception is documented)
    - `grep -c "src/cli/commands/auth.ts" agent_docs/decisions/0002-single-flight-oauth-refresh.md` returns at least `1` (the exception names the file)
    - The new bullet appears AFTER the ERRC-02 paragraph in the `## Enforcement` section (manual eyeball confirmation via reading the section)
    - No banned tone words per CLAUDE.md ADR-0005 (`bash scripts/ci-grep-gates.sh` Gate A passes)
  </acceptance_criteria>
  <done>ADR-0002 §Enforcement contains the new ARCH-02 bullet with the auth.ts exception verbatim; rule and the code that satisfies it ship in the same PR.</done>
</task>

<task type="auto">
  <name>Task 6: Add 2 new grep gates pinning singleton-deletion + layering rule + verify ARCH-04 + ARCH-05 closed-state holds + full suite</name>
  <files>scripts/ci-grep-gates.sh</files>
  <read_first>
    scripts/ci-grep-gates.sh,
    .planning/phases/10-architecture-refactor-cluster/10-RESEARCH.md
  </read_first>
  <action>
Implements ARCH-02 + ARCH-03 CI enforcement (the new layering grep gates) + verifies ARCH-04 + ARCH-05 closed-state.

1. **Read `scripts/ci-grep-gates.sh` end to end.** Identify the highest gate letter currently in the script (gates A-J are listed in the live tree; plan 10-01 added one more — find the actual letter the executor of plan 10-01 used by reading the post-10-01 script). Call the next two unused letters `<L1>` and `<L2>` (likely `K` and `L` if plan 10-01 used `K`, but the gate's identity is its purpose, not its letter; confirm at execution time).

2. **Add gate <L1> — "no module-load singleton exports for tokenStore/refreshOrchestrator/callWithAuth"** immediately after the last existing gate, following the script's style (echo idioms, exit codes, `/tmp/gate-XX.$$` tmp file pattern). The gate scans `src/` for the three forbidden exports:

   - Pattern: `^export const (tokenStore|refreshOrchestrator|callWithAuth)\b`
   - Scope: `src/` only (test files exempt — they construct local fakes in test code, which is allowed)
   - Failure mode: print the offending file:line, exit non-zero

3. **Add gate <L2> — "no `src/services/` imports from `src/infrastructure/`"** (the layering rule for the infrastructure→services arrow). The gate scans `src/infrastructure/` for any import string referencing `from '.*services/'`:

   - Pattern: `from\s+['"](\.\.?/)+services/`
   - Scope: `src/infrastructure/**/*.ts` only
   - Exclude: `*.test.ts` (test files may construct production-shape fakes that briefly import service types; the gate is about runtime code)
   - Failure mode: print the offending file:line, exit non-zero

4. **Per `agent_docs/conventions.md` §Code style on grep-gate semantic phrasing** (L0005 substitution table): use semantic phrasing in any documentation comment ABOVE each gate so a future grep-gate audit doesn't trip on the script itself. Inline regex literals in the actual gate body are fine — the script's `^src/` and `src/infrastructure/` scope excludes itself.

5. **Verify ARCH-04 closed-state** (RESEARCH §ARCH-04 says it's already closed; verify with one grep run inside this task): `rg "from '.*infrastructure/whoop/errors'" src tests` MUST return zero matches for `AuthError|MigrationError`. The current `src/infrastructure/whoop/errors.ts` file lines 1-6 contain the explanatory comment confirming ARCH-04 already shipped pre-Phase-10. If the grep returns any AuthError/MigrationError match, this task fails — fix the rogue import before proceeding.

6. **Verify ARCH-05 closed-state** (RESEARCH §ARCH-05 says it's already closed): run `grep -l "tryBootstrap" src/cli/commands/*.ts` and confirm every shim except `auth.ts`, `doctor.ts`, `init.ts` uses `tryBootstrap`. RESEARCH lists 8 shims that need it + 3 that don't bootstrap. If the count drifts, this task fails — fix in this task or escalate.

7. **Run the full grep-gate script locally**: `bash scripts/ci-grep-gates.sh`. All existing gates plus the two new ones must pass.

8. **Run the full test suite**: `npm test`. Vitest pool: 'forks' per conventions; the suite finishes under 60s. Any failure here likely reflects a missed mock in Task 3 — fix in this PR, do not defer.

9. **Run `npm run lint` and `tsc --noEmit`** — both must pass. The TS strict gate (CI gate from commit cebc2f5) is now load-bearing.

10. **Commit + PR per `agent_docs/workflows/contributing.md`**. The PR contains 6 commits (one per task, or squashed at PR-create time per the project's commit policy). PR title: `refactor(10): drop singletons + invert client.ts via authedCall DI (ARCH-02, ARCH-03)`. PR body lists the 4 REQ IDs closed (ARCH-02, ARCH-03) + the 2 re-verified (ARCH-04, ARCH-05). Open the PR; await explicit user approval per branch policy; do NOT merge without it.
  </action>
  <verify>
    <automated>bash scripts/ci-grep-gates.sh &amp;&amp; npm test &amp;&amp; npm run lint &amp;&amp; tsc --noEmit &amp;&amp; rg "from '.*infrastructure/whoop/errors'" src tests | grep -E "AuthError|MigrationError" | wc -l | grep -q "^0$"</automated>
  </verify>
  <acceptance_criteria>
    - `bash scripts/ci-grep-gates.sh` exits 0 with all gates (the full A..L range or whatever the post-10-02 sequence is) passing
    - The two new gate sections in `scripts/ci-grep-gates.sh` are visible via `grep -nE "no module-load singleton exports|no services/ imports from infrastructure" scripts/ci-grep-gates.sh`
    - `rg "from '.*infrastructure/whoop/errors'" src tests` returns zero matches for `AuthError` or `MigrationError` (ARCH-04 closed-state holds)
    - `grep -l "tryBootstrap" src/cli/commands/*.ts | wc -l` returns `8` (ARCH-05 closed-state: 8 shims use tryBootstrap; auth, doctor, init are correctly excluded)
    - `npm test` (full suite) passes; suite finishes under 60s locally
    - `npm run lint` exits 0
    - `tsc --noEmit` exits 0
    - `git log -n 6 --pretty=%s` shows commits matching `refactor(10):` / `test(10):` / `docs(10):` / `chore(10):` patterns referencing ARCH-02 + ARCH-03
    - PR `refactor/10-arch-02-03-singletons-and-client-di` opened off latest main; awaiting user approval (NOT merged automatically)
  </acceptance_criteria>
  <done>Two new grep gates added and passing; ARCH-04 + ARCH-05 closed-state re-verified; full test suite green; lint + tsc green; PR opened on the combined branch; user approval pending per branch policy.</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| WHOOP HTTPS surface → callWithAuth/refreshOrchestrator | All token material flows through the orchestrator's three-layer single-flight gate (in-process Promise, file lock, atomic write — ADR-0002) |
| MCP tool error → stdout | sanitize (now in domain/observability per plan 10-01) redacts token material before any error reaches a tool result |
| OAuth-login flow → tokenStore.write | auth.ts constructs its own createTokenStore() and writes tokens directly; bypasses bootstrap because no DB is needed |
| forked test workers → keychain / file token store | auth-concurrency.test.ts forks 10 children; each child constructs createTokenStore() per Q7-RESOLVED — the OS file lock + atomic write hold across processes |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-10-02-01 | Tampering | Multiple `tokenStore` instances racing the WHOOP refresh family revocation | mitigate | ADR-0002 cross-process file lock (`proper-lockfile`) survives the singleton removal — the lock is OS-level, not process-level. New `auth-concurrency.test.ts` worker entry constructs `createTokenStore()` per child; the cross-process lock + atomic write are still the chokepoint. Re-verified in Task 3. |
| T-10-02-02 | Tampering | `auth.ts` direct `createTokenStore()` construction creates a SECOND construction site | accept | Q7-RESOLVED documents this as the sole exception; ADR-0002 §Enforcement amendment (Task 5) names the file by path; the OS-level file lock + atomic write across both construction sites (bootstrap + auth.ts) is unchanged; refresh-revocation contract is preserved. |
| T-10-02-03 | Information Disclosure | Token material leaks via error path during DI refactor | mitigate | All error paths still flow through `sanitize` (now in `domain/observability` per plan 10-01); FND-06 + SECH-01/02 redaction patterns unchanged; the test fixtures in `tests/contract/` exercise the redaction paths and remain green. |
| T-10-02-04 | Tampering | Test mock rewrite (Task 3) accidentally drops the ADR-0002 single-flight contract assertion | mitigate | `tests/integration/auth-concurrency.test.ts` is named explicitly as the load-bearing test in Task 3 step 5; the executor reads top-to-bottom before editing; the MSW `once: true` interceptor + 10-fork structure + cross-process lock are preserved byte-for-byte. |
| T-10-02-05 | Denial of Service | MCP startup latency regression from removing module-load singleton | accept | RESEARCH §R2 documents the expected impact as ~0ms (createTokenStore is a constructor; the keychain probe is lazy on first read). `tests/integration/setup-stopwatch.test.ts` enforces a <20-minute setup budget — any regression surfaces there. |
| T-10-02-06 | Tampering | New `httpGet(path, query, schema, authedCall)` signature is wired with the wrong `authedCall` (e.g., one that omits the file lock) | mitigate | The new authedCall comes ONLY from `refreshOrchestrator.callWithAuth.bind(refreshOrchestrator)` constructed in bootstrap.ts (or the auth.ts equivalent); both bind to the same ADR-0002 three-layer gate. Test mocks use `(op) => op('test-token')` which is acceptable in tests because MSW intercepts the actual fetch. |
| T-10-02-SC | Tampering | npm/pip/cargo installs during this PR | accept | No new packages installed in this plan — pure refactor of existing modules. RESEARCH §Stack confirms no new deps. Package legitimacy audit not applicable for this PR. |
</threat_model>

<verification>
- `grep -c "^export const tokenStore" src/infrastructure/whoop/token-store.ts` returns `0`
- `grep -cE "^export const (refreshOrchestrator|callWithAuth)" src/services/refresh-orchestrator.ts` returns `0`
- `grep -c "from.*services/" src/infrastructure/whoop/client.ts` returns `0`
- `grep -c "createTokenStore()" src/cli/commands/auth.ts` returns `1` with the Q7-RESOLVED justification comment present
- ADR-0002 §Enforcement contains the new ARCH-02 bullet naming auth.ts as the sole exception
- 2 new grep gates added to scripts/ci-grep-gates.sh; full grep-gate run green
- `rg "from '.*infrastructure/whoop/errors'" src tests` shows no AuthError/MigrationError matches (ARCH-04 closed-state holds)
- 8 CLI shims use `tryBootstrap` (ARCH-05 closed-state holds)
- `npm test` full suite green in <60s
- `npm run lint` + `tsc --noEmit` green
</verification>

<success_criteria>
- ARCH-02 closed: three module-load singletons deleted; bootstrap owns construction; ADR-0002 §Enforcement amendment landed in same PR
- ARCH-03 closed: client.ts no longer imports from services/; httpGet takes authedCall as 4th parameter; 6 resource modules are factories; bootstrap wires them at the current line-301-310 block
- ARCH-04 re-verified closed: codemod assertion `rg "from '.*infrastructure/whoop/errors'" src tests` returns zero AuthError/MigrationError matches
- ARCH-05 re-verified closed: 8 CLI shims share `tryBootstrap`; auth/doctor/init correctly excluded
- 2 new CI grep gates ratchet the layering rule (no singleton exports; no services/ imports from infrastructure)
- auth-concurrency.test.ts (load-bearing for ADR-0002) green; setup-stopwatch.test.ts (MCP cold-start budget) green
- PR `refactor/10-arch-02-03-singletons-and-client-di` opened off latest main; user approval pending per branch policy; PR ships atomically (no transitional bridge — per Q5-RESOLVED)
</success_criteria>

<output>
Create `.planning/phases/10-architecture-refactor-cluster/10-02-SUMMARY.md` when done.
</output>
