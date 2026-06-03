---
phase: 10-architecture-refactor-cluster
plan: 03
type: execute
wave: 3
branch: refactor/10-arch-06-doctor-wiring-extract
depends_on: [10-02]
files_modified:
  - src/services/doctor/wiring.ts
  - src/services/doctor/wiring.test.ts
  - src/services/bootstrap.ts
  - scripts/ci-grep-gates.sh
autonomous: true
requirements: [ARCH-06]
must_haves:
  truths:
    - "`src/services/doctor/wiring.ts` exists and exports `createProductionDoctorDeps(input)` returning a pre-bound `runDoctor` of the same shape `bootstrap()` currently surfaces"
    - "`productionWhoopFetcher`, `whoopErrorKindToStatus`, and `services_runDoctor` no longer live in `bootstrap.ts` — they live in `wiring.ts`"
    - "`bootstrap.ts` shrinks by ≥ 80 lines (post-10-02 starting line count − post-10-03 line count ≥ 80) per amended ROADMAP SC5; the 250-line target is deferred to Phase 12 per Q2-RESOLVED"
    - "A new unit test `src/services/doctor/wiring.test.ts` exercises `createProductionDoctorDeps` with fake sqlite + repos + authedCall + RefreshOrchestrator; asserts the returned `runDoctor` honors user-supplied opts and falls back to production deps"
    - "A new grep gate forbids `productionWhoopFetcher` from reappearing in `bootstrap.ts`"
    - "Existing bootstrap.test.ts + doctor.test.ts tests pass unchanged (the `services.runDoctor` surface is byte-identical from the consumer's POV)"
  artifacts:
    - path: src/services/doctor/wiring.ts
      provides: createProductionDoctorDeps factory — owns productionWhoopFetcher + whoopErrorKindToStatus + the runDoctorImpl pre-binding
    - path: src/services/doctor/wiring.test.ts
      provides: unit coverage for the factory; asserts opts-win-over-defaults and production-deps-as-fallback
    - path: scripts/ci-grep-gates.sh
      provides: new gate forbidding `productionWhoopFetcher` in bootstrap.ts
  key_links:
    - from: src/services/bootstrap.ts
      to: src/services/doctor/wiring.ts
      via: import + factory call
      pattern: "createProductionDoctorDeps\\("
    - from: src/services/doctor/wiring.ts
      to: src/infrastructure/whoop/client.ts
      via: AuthedCall type + httpGet usage
      pattern: "httpGet\\("
---

<objective>
Extract the doctor production-wiring block (`productionWhoopFetcher` + `whoopErrorKindToStatus` + `services_runDoctor`) from `bootstrap.ts` lines 362-444 into a new module `src/services/doctor/wiring.ts` exporting `createProductionDoctorDeps(input)`. Bootstrap shrinks by ≥ 80 lines. A new unit test covers the factory. A new CI grep gate pins `productionWhoopFetcher`'s new home.

Purpose: bootstrap.ts is the composition root, but its 479 lines today (post-10-02 still ~470+) carry per-service production wiring that should live next to the service it wires. Doctor is the largest of these — 63 lines of fetcher + status mapper + pre-bound `runDoctorImpl` closure. Moving it makes bootstrap.ts shorter and easier to reason about, and gives doctor its own composition seam that plan 10-04 (ARCH-07) will lean on.

Q2-RESOLVED + ROADMAP SC5 amendment: the original "bootstrap stays under 250 lines" target is now a guideline, not a hard gate. The measurable target for this plan is **bootstrap.ts shrinks by ≥ 80 lines** (from the post-10-02 baseline). The residual ~395-405 LOC is the documented Phase 10 outcome; further extraction (`resolveMigrationsDir`, stale-running reclassification, dep-shape helpers) is deferred to Phase 12.

Output: 2 new files (`wiring.ts` + `wiring.test.ts`), `bootstrap.ts` edited to delete the 3 blocks + add 1 import + 1 factory call, 1 new grep gate. PR `refactor/10-arch-06-doctor-wiring-extract` lands on its own branch off the latest `main`, merged via GitHub PR with explicit user approval.

Scope: this is a pure extract-method refactor. No behavior change. The `services.runDoctor` surface bootstrap returns is byte-identical from the consumer's POV (CLI doctor command and MCP whoop_doctor tool consume `app.services.runDoctor(opts)` — that signature does not change).
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

Current bootstrap.ts doctor wiring block (verified 2026-06-03 by reading lines 362-444 of src/services/bootstrap.ts):

Line ~395-419: `productionWhoopFetcher` body — after plan 10-02 lands, this function calls `httpGet('/v2/user/profile/basic', {}, WhoopRawProfile, authedCall)`. It uses `isAuthError`, `WhoopApiError`, the local `whoopErrorKindToStatus` helper, and `performance.now()` from `node:perf_hooks`.

Line ~382-395: `whoopErrorKindToStatus` — small helper mapping `WhoopApiError['kind']` to an HTTP status code. Used only by `productionWhoopFetcher`.

Line ~428-444: `services_runDoctor` — the closure that pre-binds production deps into `runDoctorImpl`:
```ts
const services_runDoctor = (opts: RunDoctorOptions = {}): Promise<DoctorResult> =>
  runDoctorImpl({
    ...opts,
    sqlite: opts.sqlite ?? sqlite,
    repos: opts.repos ?? {
      syncRuns: repos.syncRuns,
      cycles: repos.cycles,
      recovery: repos.recoveries,
      sleep: repos.sleeps,
    },
    refreshOrchestrator: opts.refreshOrchestrator ?? refreshOrchestrator,
    whoopFetcher: opts.whoopFetcher ?? productionWhoopFetcher,
    migrationsDir: opts.migrationsDir ?? migrationsDir,
  });
```

Plus the ~20 lines of inline comments above `whoopErrorKindToStatus` (lines 362-381 explain its rationale).

Total to remove from bootstrap.ts: ~83 lines (comments + 3 blocks). The `services.runDoctor` reference at the return statement (currently around line 467) keeps the same key but points at the factory's return value instead of the inline closure.

Target wiring.ts shape (the file does NOT exist yet — verified by `ls src/services/doctor/wiring* 2>&1` returning "no matches"):

```ts
// src/services/doctor/wiring.ts
import { performance } from 'node:perf_hooks';
import type Database from 'better-sqlite3';
import { isAuthError } from '../../domain/errors/auth.js';
import { WhoopRawProfile } from '../../domain/schemas/whoop-api.js';
import { type AuthedCall, httpGet } from '../../infrastructure/whoop/client.js';
import { WhoopApiError } from '../../infrastructure/whoop/errors.js';
import type { RefreshOrchestrator } from '../refresh-orchestrator.js';
import { type DoctorResult, type RunDoctorOptions, runDoctor as runDoctorImpl } from './index.js';

export interface ProductionDoctorDepsInput {
  sqlite: Database.Database;
  repos: {
    syncRuns: /* type from bootstrap */;
    cycles: /* type */;
    recoveries: /* type */;
    sleeps: /* type */;
  };
  refreshOrchestrator: RefreshOrchestrator;
  authedCall: AuthedCall;
  migrationsDir: string;
}

export function createProductionDoctorDeps(
  input: ProductionDoctorDepsInput,
): (opts?: RunDoctorOptions) => Promise<DoctorResult> {
  const whoopErrorKindToStatus = (kind: WhoopApiError['kind']): number => {
    /* moved verbatim from bootstrap.ts:382-395 */
  };

  const productionWhoopFetcher = async (
    _accessToken: string,
  ): Promise<{ status: number; durationMs: number }> => {
    const start = performance.now();
    try {
      await httpGet('/v2/user/profile/basic', {}, WhoopRawProfile, input.authedCall);
      return { status: 200, durationMs: performance.now() - start };
    } catch (err) {
      if (isAuthError(err)) {
        return { status: 401, durationMs: performance.now() - start };
      }
      const status = err instanceof WhoopApiError ? whoopErrorKindToStatus(err.kind) : 0;
      return { status, durationMs: performance.now() - start };
    }
  };

  return (opts: RunDoctorOptions = {}) =>
    runDoctorImpl({
      ...opts,
      sqlite: opts.sqlite ?? input.sqlite,
      repos: opts.repos ?? {
        syncRuns: input.repos.syncRuns,
        cycles: input.repos.cycles,
        recovery: input.repos.recoveries,
        sleep: input.repos.sleeps,
      },
      refreshOrchestrator: opts.refreshOrchestrator ?? input.refreshOrchestrator,
      whoopFetcher: opts.whoopFetcher ?? productionWhoopFetcher,
      migrationsDir: opts.migrationsDir ?? input.migrationsDir,
    });
}
```

Target bootstrap.ts diff (post-10-03):
```ts
// At the top of bootstrap.ts (with other imports):
import { createProductionDoctorDeps } from './doctor/wiring.js';

// In the bootstrap() body, AFTER the resource module factory wiring (currently ~line 310 post-10-02):
const runDoctor = createProductionDoctorDeps({
  sqlite,
  repos,         // the bootstrap-local repos object — destructure shape matches input.repos
  refreshOrchestrator,
  authedCall,
  migrationsDir,
});

// In the return statement (currently ~line 467):
services: {
  // ...existing keys
  runDoctor,   // now the factory's return; same shape from the consumer's POV
  // ...other keys
}
```

DELETE from bootstrap.ts:
- Lines ~362-381: comments explaining whoopErrorKindToStatus
- Lines ~382-395: whoopErrorKindToStatus function
- Lines ~396-419: productionWhoopFetcher function
- Lines ~420-427: any intermediate blank lines + the `// Plan 05-06: pre-bind...` comment block
- Lines ~428-444: services_runDoctor closure
- Any now-unused imports (performance, isAuthError, WhoopRawProfile, WhoopApiError if they were imported only for the doctor block — verify with `grep -n "performance\|isAuthError\|WhoopRawProfile\|WhoopApiError" src/services/bootstrap.ts` before removing)

Test file shape (target — does NOT exist yet; verified by `ls src/services/doctor/wiring* 2>&1`):

```ts
// src/services/doctor/wiring.test.ts
import { describe, expect, it, vi } from 'vitest';
import type Database from 'better-sqlite3';
import type { AuthedCall } from '../../infrastructure/whoop/client.js';
import type { RefreshOrchestrator } from '../refresh-orchestrator.js';
import { createProductionDoctorDeps } from './wiring.js';

describe('createProductionDoctorDeps', () => {
  it('returns a runDoctor function that calls runDoctorImpl with bound production deps', async () => {
    // Construct fakes for sqlite + repos + refreshOrchestrator + authedCall
    // Invoke the factory; invoke the returned function with no opts
    // Assert the wiring uses the production deps
  });

  it('honors user-supplied opts over production defaults', async () => {
    // Construct two distinct fake sqlite handles
    // Invoke the factory with sqlite=A; invoke the returned function with opts.sqlite=B
    // Assert runDoctorImpl received B, not A
  });

  it('productionWhoopFetcher maps WhoopApiError kinds to HTTP statuses', async () => {
    // Construct a fake authedCall that throws WhoopApiError({kind: 'unauthorized'})
    // Invoke the factory; invoke the returned function with whoopFetcher unspecified
    // Assert the fetcher returns {status: 401, durationMs: <number>}
  });

  it('productionWhoopFetcher maps AuthError to status 401', async () => {
    // Construct a fake authedCall that throws AuthError({kind: 'auth_expired'})
    // Same assertion path; status 401 + durationMs
  });
});
```

Current bootstrap.ts line count (verified 2026-06-03 via `wc -l src/services/bootstrap.ts`): **479 lines**. Plan 10-02 may add or remove a few lines (net negative — three singleton imports deleted + three local constructions added + bootstrap options widening + barrel cleanup), but a reasonable post-10-02 estimate is **~470-475 lines**. This plan must reduce that by ≥ 80, landing bootstrap.ts at **~390-395 lines** post-10-03.

Current ci-grep-gates.sh status (verified 2026-06-03): gates A-J live in the script for OTHER concerns; plan 10-01 added one more; plan 10-02 will add two more. By the time this plan runs, the latest gate letter is likely L (10-01 added one + 10-02 added two = +3 from J). This plan adds ONE more — call it the next-available letter at execution time. The gate's identity is its purpose, not its letter.
</interfaces>
</context>

<tasks>

<task type="auto">
  <name>Task 1: Create src/services/doctor/wiring.ts with createProductionDoctorDeps factory + matching unit test file</name>
  <files>src/services/doctor/wiring.ts, src/services/doctor/wiring.test.ts</files>
  <read_first>
    src/services/bootstrap.ts,
    src/services/doctor/index.ts,
    src/services/refresh-orchestrator.ts,
    src/infrastructure/whoop/client.ts,
    src/infrastructure/whoop/errors.ts,
    src/domain/errors/auth.ts,
    src/domain/schemas/whoop-api.ts,
    .planning/phases/10-architecture-refactor-cluster/10-RESEARCH.md
  </read_first>
  <action>
Implements ARCH-06 (extract doctor production wiring to a dedicated module).

1. **Create `src/services/doctor/wiring.ts`** per the target shape in the `<interfaces>` block. Implement:
   - `ProductionDoctorDepsInput` interface with the 5 fields (`sqlite`, `repos`, `refreshOrchestrator`, `authedCall`, `migrationsDir`). Use the exact types referenced from the existing modules — read `src/services/bootstrap.ts` to extract the `repos` shape (the bootstrap-local `repos` object has `syncRuns`, `cycles`, `recoveries`, `sleeps` fields; mirror those types from `src/infrastructure/db/repos.ts` or the repos factory return type).
   - `createProductionDoctorDeps(input)` function that captures `input.authedCall` (post-10-02 the bootstrap-side `authedCall` const) and returns the pre-bound runDoctor closure.
   - Move `whoopErrorKindToStatus` and `productionWhoopFetcher` into the factory body. **Verbatim copy** from bootstrap.ts lines 382-419 — preserve all inline comments, all type annotations, all error-mapping branches.
   - The returned closure mirrors the current `services_runDoctor` shape: `(opts?: RunDoctorOptions) => Promise<DoctorResult>` with the same `opts.X ?? input.X` defaults.

2. **Imports for wiring.ts** (per the `<interfaces>` block target shape):
   - `import { performance } from 'node:perf_hooks';` — used by productionWhoopFetcher
   - `import type Database from 'better-sqlite3';` — for the `sqlite` field type
   - `import { isAuthError } from '../../domain/errors/auth.js';` — for the error branching
   - `import { WhoopRawProfile } from '../../domain/schemas/whoop-api.js';` — for the httpGet schema arg
   - `import { type AuthedCall, httpGet } from '../../infrastructure/whoop/client.js';` — the post-10-02 4-arg httpGet
   - `import { WhoopApiError } from '../../infrastructure/whoop/errors.js';` — for the error class
   - `import type { RefreshOrchestrator } from '../refresh-orchestrator.js';` — type-only; the singleton is gone post-10-02
   - `import { type DoctorResult, type RunDoctorOptions, runDoctor as runDoctorImpl } from './index.js';` — the actual doctor entry-point + types

3. **Verify the layering rule**: wiring.ts lives at `src/services/doctor/wiring.ts`. It imports from `domain/`, `infrastructure/`, and sibling `services/` modules. The arrow `services/doctor/wiring.ts → services/refresh-orchestrator.ts` is INTRA-services (allowed); the arrow `services/doctor/wiring.ts → infrastructure/whoop/client.ts` is the standard `services → infrastructure` direction (allowed). No upward import.

4. **Conventions** per `agent_docs/conventions.md`: ESM-only (use `.js` extensions in import specifiers), TypeScript strict, no default exports, no `any` (the `Database.Database` type is explicit; the closure return type is explicit). The new file is in the `services/` tier — orchestration code, not pure domain logic. This matches the Architectural Responsibility Map in RESEARCH §"Doctor production wiring".

5. **Create `src/services/doctor/wiring.test.ts`** with the 4 test cases listed in the `<interfaces>` block:
   - "returns a runDoctor function that calls runDoctorImpl with bound production deps"
   - "honors user-supplied opts over production defaults"
   - "productionWhoopFetcher maps WhoopApiError kinds to HTTP statuses"
   - "productionWhoopFetcher maps AuthError to status 401"

   Use `vi.fn()` for the fakes; do NOT mock the deleted singleton (it does not exist post-10-02). The third + fourth tests can extract the fetcher via the factory's return-value behavior — assert through `runDoctor`'s observable output (DoctorResult contains the whoop_roundtrip probe result; the probe's status field reflects the fetcher's status mapping).

6. **Do NOT touch bootstrap.ts yet** — Task 2 handles the bootstrap.ts edits + the grep gate + the LOC verification. Keeping the two tasks split makes the diff reviewable: one task adds the new module, the next removes the old block.

7. **Conventional commit**: `refactor(10): extract doctor production wiring to services/doctor/wiring.ts (ARCH-06)`.
  </action>
  <verify>
    <automated>test -f src/services/doctor/wiring.ts &amp;&amp; test -f src/services/doctor/wiring.test.ts &amp;&amp; grep -c "export function createProductionDoctorDeps" src/services/doctor/wiring.ts | grep -q "^1$" &amp;&amp; npm test -- src/services/doctor/wiring.test.ts &amp;&amp; tsc --noEmit</automated>
  </verify>
  <acceptance_criteria>
    - `test -f src/services/doctor/wiring.ts` exits 0
    - `test -f src/services/doctor/wiring.test.ts` exits 0
    - `grep -c "export function createProductionDoctorDeps" src/services/doctor/wiring.ts` returns `1`
    - `grep -c "productionWhoopFetcher\|whoopErrorKindToStatus" src/services/doctor/wiring.ts` returns at least `2`
    - `grep -c "from.*services/" src/services/doctor/wiring.ts` returns `1` (the type-only import of RefreshOrchestrator + the runDoctorImpl import — both intra-services, allowed)
    - `npm test -- src/services/doctor/wiring.test.ts` passes (all 4 cases green)
    - `tsc --noEmit` passes
    - `npm run lint` passes
  </acceptance_criteria>
  <done>wiring.ts + wiring.test.ts exist; the factory shape is correct; the 4 test cases pass; type-check + lint green. bootstrap.ts is untouched in this task — it still contains the doctor wiring block (which Task 2 will delete).</done>
</task>

<task type="auto">
  <name>Task 2: Delete doctor wiring block from bootstrap.ts + add factory call + add grep gate + verify ≥ 80 line shrink + full suite</name>
  <files>src/services/bootstrap.ts, scripts/ci-grep-gates.sh</files>
  <read_first>
    src/services/bootstrap.ts,
    src/services/doctor/wiring.ts,
    scripts/ci-grep-gates.sh,
    .planning/phases/10-architecture-refactor-cluster/10-RESEARCH.md
  </read_first>
  <action>
Implements ARCH-06 bootstrap-side: deletes the extracted block, wires the factory, adds the grep gate, verifies the line shrink.

1. **Capture the pre-edit bootstrap.ts line count**: run `wc -l src/services/bootstrap.ts` and record the value. Post-10-02 this is ~470-475 lines. Call this `PRE_LOC`.

2. **Delete the doctor wiring block from bootstrap.ts**:
   - The ~20-line inline comment block at lines 362-381 (the rationale for whoopErrorKindToStatus)
   - The `whoopErrorKindToStatus` function (lines 382-395)
   - The `productionWhoopFetcher` function (lines 396-419)
   - The `// Plan 05-06: pre-bind...` comment block (lines 420-427 or thereabouts)
   - The `services_runDoctor` closure (lines 428-444)
   - Use Edit/Read to identify the exact start + end of each block; the literal line numbers above are 2026-06-03 verified but may drift by ±2 lines depending on plan 10-02's edits

3. **Remove now-unused imports from bootstrap.ts**:
   - `performance` from `node:perf_hooks` if it was imported only for the fetcher — verify with `grep -n "performance" src/services/bootstrap.ts` after the deletions
   - `isAuthError` from `domain/errors/auth.js` — same check
   - `WhoopRawProfile` from `domain/schemas/whoop-api.js` — same check
   - `WhoopApiError` from `infrastructure/whoop/errors.js` — same check
   - Keep `httpGet` + `AuthedCall` imports if bootstrap.ts still uses them for the `whoop.resources` wiring (it shouldn't — those moved into the resource factories during plan 10-02; verify with grep)

4. **Add the factory call**:
   - Import: `import { createProductionDoctorDeps } from './doctor/wiring.js';` near the other intra-services imports
   - In the bootstrap() body, AFTER the resource module factory wiring (the post-10-02 line ~310 block), construct the runDoctor:
     ```ts
     const runDoctor = createProductionDoctorDeps({
       sqlite,
       repos,
       refreshOrchestrator,
       authedCall,
       migrationsDir,
     });
     ```
   - In the return statement (the `services:` block currently around line 460+), replace the `runDoctor: services_runDoctor` (or whatever the current key references) with `runDoctor` — the local const constructed above. The exported `services.runDoctor` field shape is byte-identical from the consumer's POV.

5. **Capture the post-edit bootstrap.ts line count**: run `wc -l src/services/bootstrap.ts`. Call this `POST_LOC`. **Assert `PRE_LOC − POST_LOC ≥ 80`**. If the shrink is less than 80, investigate: did the executor accidentally leave a duplicate comment block? Did the new `createProductionDoctorDeps({...})` call add more lines than expected? Adjust by inlining the input object into a single multi-line expression. If the shrink is genuinely under 80 (i.e., the extracted block is smaller than RESEARCH estimated), DOCUMENT this in the task's SUMMARY commit — DO NOT add scope-reduction-prohibition-violating extra extractions to hit 80. The amended ROADMAP SC5 says "≥ 80 line shrink"; if reality lands at, say, 78, surface the discrepancy to the user for sign-off before claiming ARCH-06 closed. (Realistic expectation per RESEARCH: 83 lines deleted vs. ~5 lines added = ~78 net shrink. If 78 is the real number, the task fails the ≥ 80 acceptance criterion; the executor must either find 2 more lines of redundant boilerplate to drop in bootstrap.ts OR escalate to the user. Do NOT silently downgrade the SC.)

6. **Add a new grep gate to scripts/ci-grep-gates.sh** — find the next-available letter after the gates added by plans 10-01 and 10-02. The gate's purpose:
   - Pattern: `productionWhoopFetcher`
   - Scope: `src/services/bootstrap.ts` only
   - Failure mode: if `grep -n "productionWhoopFetcher" src/services/bootstrap.ts` returns any match, exit non-zero. The function lives in `wiring.ts` now; it must not be reintroduced to bootstrap.

7. **Run the full grep-gate script**: `bash scripts/ci-grep-gates.sh`. All gates including the new one must pass.

8. **Run the full test suite**: `npm test`. The existing bootstrap.test.ts cases should pass unchanged because the `services.runDoctor` surface shape is identical. The new wiring.test.ts cases (created in Task 1) cover the extracted module.

9. **Run `npm run lint` and `tsc --noEmit`**.

10. **Conventional commit**: `refactor(10): delete doctor wiring block from bootstrap.ts; wire createProductionDoctorDeps factory; add productionWhoopFetcher grep gate (ARCH-06)`.

11. **Commit + PR per `agent_docs/workflows/contributing.md`**. PR title: `refactor(10): extract doctor production wiring to services/doctor/wiring.ts (ARCH-06)`. PR body cites the LOC shrink delta (e.g., "bootstrap.ts: 472 → 389, -83 lines per amended ROADMAP SC5"). Open the PR; await explicit user approval per branch policy; do NOT merge without it.
  </action>
  <verify>
    <automated>PRE=$(git show HEAD:src/services/bootstrap.ts | wc -l); POST=$(wc -l &lt; src/services/bootstrap.ts); test "$((PRE - POST))" -ge 80 &amp;&amp; grep -c "productionWhoopFetcher" src/services/bootstrap.ts | grep -q "^0$" &amp;&amp; grep -c "createProductionDoctorDeps" src/services/bootstrap.ts | grep -q "^1$" &amp;&amp; bash scripts/ci-grep-gates.sh &amp;&amp; npm test &amp;&amp; npm run lint &amp;&amp; tsc --noEmit</automated>
  </verify>
  <acceptance_criteria>
    - `wc -l src/services/bootstrap.ts` shows at least 80 fewer lines than the pre-edit count (compare against `git show HEAD~1:src/services/bootstrap.ts | wc -l` or the value captured at task start)
    - `grep -c "productionWhoopFetcher\|whoopErrorKindToStatus\|services_runDoctor" src/services/bootstrap.ts` returns `0` (all three removed)
    - `grep -c "createProductionDoctorDeps" src/services/bootstrap.ts` returns `1`
    - `grep -c "from './doctor/wiring.js'" src/services/bootstrap.ts` returns `1`
    - `bash scripts/ci-grep-gates.sh` exits 0 with the new gate (forbidding `productionWhoopFetcher` in bootstrap.ts) green and all prior gates green
    - `npm test` (full suite) passes; under 60s; bootstrap.test.ts + doctor.test.ts + the new wiring.test.ts all green
    - `npm run lint` + `tsc --noEmit` both exit 0
    - PR `refactor/10-arch-06-doctor-wiring-extract` opened off latest main; PR body cites the LOC delta; awaiting user approval (NOT merged automatically)
  </acceptance_criteria>
  <done>bootstrap.ts is at least 80 lines shorter; the three extracted symbols live in wiring.ts; the new grep gate pins productionWhoopFetcher's new home; full suite + lint + tsc green; PR opened on the dedicated branch awaiting user approval.</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| Doctor probe → WHOOP HTTPS | `productionWhoopFetcher` is the boundary; it now lives in `wiring.ts` but the boundary semantics (single GET to `/v2/user/profile/basic`, status + durationMs return shape) are unchanged |
| `bootstrap.close()` → in-flight doctor probe | `createProductionDoctorDeps` captures `sqlite`, `repos`, `refreshOrchestrator`, `authedCall`, `migrationsDir` via closure; if bootstrap closes mid-flight, the captured `sqlite` handle is invalid (same risk as today's inline closure — RESEARCH §R1) |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-10-03-01 | Tampering | Extract-method refactor accidentally changes error-mapping semantics | mitigate | `whoopErrorKindToStatus` + `productionWhoopFetcher` bodies moved verbatim; the 4 unit tests in wiring.test.ts assert the status-mapping shape; the existing doctor.test.ts + bootstrap.test.ts continue to pass because the `services.runDoctor` consumer shape is byte-identical |
| T-10-03-02 | Denial of Service | `createProductionDoctorDeps` closure leaks captured handles after `bootstrap.close()` | accept | Same risk as today's inline closure (RESEARCH §R1); no change in risk profile. Existing CLI shim pattern is `bootstrap → await runDoctor → close`; the closure captures live handles only during the bootstrap lifetime |
| T-10-03-03 | Information Disclosure | `productionWhoopFetcher` error path leaks token material via sanitize bypass | mitigate | The fetcher catches all errors and maps to status codes; the actual error formatting happens in the doctor probe consumer, which goes through `sanitize` (now in domain/observability per plan 10-01). FND-06 + SECH-01/02 redaction patterns unchanged |
| T-10-03-SC | Tampering | npm/pip/cargo installs during this PR | accept | No new packages — pure extract-method refactor. RESEARCH confirms no new deps for ARCH-06 |
</threat_model>

<verification>
- `wc -l src/services/bootstrap.ts` is at least 80 less than the pre-edit count
- `src/services/doctor/wiring.ts` exists and exports `createProductionDoctorDeps`
- `src/services/doctor/wiring.test.ts` exists and 4 cases pass
- `grep -c "productionWhoopFetcher\|whoopErrorKindToStatus\|services_runDoctor" src/services/bootstrap.ts` returns `0`
- New grep gate forbidding `productionWhoopFetcher` in bootstrap.ts is green
- `npm test` full suite green in <60s
- `npm run lint` + `tsc --noEmit` green
- ROADMAP SC5 amended target (≥ 80 line shrink) met; 250-line target deferred to Phase 12 per Q2-RESOLVED
</verification>

<success_criteria>
- ARCH-06 closed: doctor production wiring lives at `src/services/doctor/wiring.ts`; bootstrap.ts shrinks by ≥ 80 lines (the amended ROADMAP SC5)
- The 250-line target stays deferred to Phase 12 per Q2-RESOLVED — no silent scope creep
- `createProductionDoctorDeps` is unit-tested for opts-win-over-defaults + production-deps-as-fallback + error mapping
- A new grep gate pins `productionWhoopFetcher` to its new home
- PR `refactor/10-arch-06-doctor-wiring-extract` opened off latest main; user approval pending per branch policy
</success_criteria>

<output>
Create `.planning/phases/10-architecture-refactor-cluster/10-03-SUMMARY.md` when done. The summary MUST record the actual `wc -l` delta of bootstrap.ts (pre vs. post) for traceability against the amended SC5.
</output>
