---
phase: 10-architecture-refactor-cluster
plan: 05
subsystem: services/api-gap
tags: [refactor, ARCH-08, structural, lite-hexagonal, grep-gate]
requires:
  - 10-02
provides:
  - src/domain/api-gap/catalog.ts: API_GAP_ENTRIES (6-entry frozen readonly array) + ApiGapEntry interface, pure data in domain tier
  - src/services/api-gap.ts: getApiGap() async accessor + ApiGapResult interface (single flat file, replaces the 3-file directory)
  - scripts/ci-grep-gates.sh: new Gate P (filesystem check) forbidding src/services/api-gap/ from reappearing as a directory
affects:
  - src/formatters/api-gap.txt.ts
  - src/formatters/api-gap.txt.test.ts
  - src/cli/commands/api-gap.test.ts
  - src/services/bootstrap.ts
  - src/services/index.ts
  - tests/contract/api-gap-md-parity.test.ts
  - tests/contract/formatter-tone.test.ts
  - scripts/generate-api-gap-md.ts
  - scripts/generate-api-gap-md.test.ts
  - docs/install/api-gap.md
tech-stack:
  added: []
  patterns:
    - "lite-hexagonal: pure constants move to domain tier (no I/O, no upward arrows); thin async accessor stays in services"
    - "filesystem-gate over grep-gate when the invariant is directory non-existence (precise + immune to comment-substring matches)"
key-files:
  created:
    - src/domain/api-gap/catalog.ts
    - src/services/api-gap.ts
    - src/services/api-gap.test.ts
  modified:
    - src/services/bootstrap.ts
    - src/services/index.ts
    - src/formatters/api-gap.txt.ts
    - src/formatters/api-gap.txt.test.ts
    - src/cli/commands/api-gap.test.ts
    - tests/contract/api-gap-md-parity.test.ts
    - tests/contract/formatter-tone.test.ts
    - scripts/generate-api-gap-md.ts
    - scripts/generate-api-gap-md.test.ts
    - scripts/ci-grep-gates.sh
    - docs/install/api-gap.md
  deleted:
    - src/services/api-gap/index.ts
    - src/services/api-gap/data.ts
    - src/services/api-gap/types.ts
    - src/services/api-gap/index.test.ts
    - src/services/api-gap/ (the empty directory itself)
decisions:
  - "Promote API_GAP_ENTRIES + ApiGapEntry to src/domain/api-gap/catalog.ts. Pure data with zero I/O belongs in the domain tier per the lite-hexagonal layering rule (domain has no upward arrows). The services-layer accessor (getApiGap) imports the catalog from domain."
  - "Re-export ApiGapEntry from src/services/api-gap.ts so call sites that previously pulled the type from the per-types file can land on the flat services file without a second domain-tier import."
  - "Gate P is a filesystem check (`[ -d src/services/api-gap ]`), not a grep. Filesystem checks are precise + immune to comment-substring matches in source — exactly the L0005 anti-pattern we want to avoid for an invariant that is fundamentally about directory presence/absence."
  - "Scrubbed literal mentions of the deleted per-feature paths (data.ts, types.ts, index.ts) from all in-tree comments (catalog.ts, api-gap.ts, api-gap.test.ts, api-gap.txt.ts, api-gap-md-parity.test.ts). Comments now point at the new home (src/domain/api-gap/catalog.ts) so future contributors get the right destination — and so a future grep gate of the matching shape would not trip on stale comments (L0005)."
  - "Regenerated docs/install/api-gap.md via `npm run docs:generate-api-gap`. Only the source-path header comment changed; the 6 entries are byte-identical (verified via the parity test)."
metrics:
  duration: "~6 minutes"
  completed: 2026-06-03
---

# Phase 10 Plan 05: ARCH-08 collapse `src/services/api-gap/` directory Summary

Collapsed the over-structured 3-file `src/services/api-gap/` directory into a single flat `src/services/api-gap.ts`, and promoted the pure-data 6-entry `API_GAP_ENTRIES` constant + `ApiGapEntry` interface to `src/domain/api-gap/catalog.ts`. Rewrote 8 importers, added a filesystem-based Gate P to prevent regression, and confirmed the load-bearing markdown parity test still passes — the 6 catalog entries survived the move byte-for-byte.

## Files Created

- **`src/domain/api-gap/catalog.ts`** — pure-data home for `API_GAP_ENTRIES` (6 frozen entries) + `ApiGapEntry` interface. Zero imports; no I/O. Domain tier per lite-hexagonal.
- **`src/services/api-gap.ts`** — single flat file replacing the directory. Imports `{ API_GAP_ENTRIES, type ApiGapEntry }` from `../domain/api-gap/catalog.js`, re-exports `ApiGapEntry`, defines `ApiGapResult`, exports the async `getApiGap()` accessor.
- **`src/services/api-gap.test.ts`** — renamed from `src/services/api-gap/index.test.ts`; assertions byte-identical, imports updated to `../domain/api-gap/catalog.js` (constant) + `./api-gap.js` (accessor).

## Files Deleted

The entire `src/services/api-gap/` directory plus its 4 files:

- `src/services/api-gap/index.ts` (the accessor — now at `src/services/api-gap.ts`)
- `src/services/api-gap/data.ts` (the catalog — now at `src/domain/api-gap/catalog.ts`)
- `src/services/api-gap/types.ts` (the interfaces — `ApiGapEntry` to `catalog.ts`, `ApiGapResult` to the flat `api-gap.ts`)
- `src/services/api-gap/index.test.ts` (the test — renamed to `src/services/api-gap.test.ts`)

## Importers Rewritten (8 total)

| # | File | Old import | New import |
|---|------|------------|------------|
| 1 | `src/formatters/api-gap.txt.ts` | `import type { ApiGapEntry, ApiGapResult } from '../services/api-gap/types.js'` | `import type { ApiGapEntry, ApiGapResult } from '../services/api-gap.js'` |
| 2 | `src/formatters/api-gap.txt.test.ts` | `API_GAP_ENTRIES` from `../services/api-gap/data.js`; `getApiGap` from `../services/api-gap/index.js` | `API_GAP_ENTRIES` from `../domain/api-gap/catalog.js`; `getApiGap` from `../services/api-gap.js` (split into two tier-correct imports) |
| 3 | `src/cli/commands/api-gap.test.ts` | `import type { ApiGapResult } from '../../services/api-gap/types.js'` | `import type { ApiGapResult } from '../../services/api-gap.js'` |
| 4 | `tests/contract/api-gap-md-parity.test.ts` | `import { API_GAP_ENTRIES } from '../../src/services/api-gap/data.js'` | `import { API_GAP_ENTRIES } from '../../src/domain/api-gap/catalog.js'` |
| 5 | `tests/contract/formatter-tone.test.ts` | `API_GAP_ENTRIES` from `../../src/services/api-gap/data.js`; `getApiGap` from `../../src/services/api-gap/index.js` | `API_GAP_ENTRIES` from `../../src/domain/api-gap/catalog.js`; `getApiGap` from `../../src/services/api-gap.js` (split into two tier-correct imports) |
| 6 | `src/services/bootstrap.ts` | `getApiGap` from `./api-gap/index.js`; `ApiGapResult` from `./api-gap/types.js` (two lines) | `import { getApiGap, type ApiGapResult } from './api-gap.js'` (collapsed to one line; biome auto-sorted to `{ type ApiGapResult, getApiGap }`) |
| 7 | `src/services/index.ts` | `export type { ApiGapEntry, ApiGapResult } from './api-gap/types.js'` AND `import type { ApiGapResult } from './api-gap/types.js'` (both lines) | both rewritten to `./api-gap.js` |
| 8 | `scripts/generate-api-gap-md.ts` and `scripts/generate-api-gap-md.test.ts` | `API_GAP_ENTRIES` from `../src/services/api-gap/data.js`; `ApiGapEntry` from `../src/services/api-gap/types.js` | both rewritten to `../src/domain/api-gap/catalog.js` (the .ts source now uses a single combined import line; the .test.ts only needs the constant) |

The plan called out 7 importers; the 8th (`scripts/generate-api-gap-md.test.ts`) was discovered by the live `grep -rln "from.*services/api-gap"` sweep at the start of Task 2 (the plan's `<interfaces>` block flagged the `.ts` source file but not its sibling test). Both were rewritten as a single logical unit.

## Gate P — new CI grep gate

**Pattern (filesystem check, not grep):** `[ -d src/services/api-gap ]` — fail if the directory exists.

**Allowed:** the directory never exists in `main` after this PR. The canonical homes are:

- `src/domain/api-gap/catalog.ts` (the catalog + entry interface, pure data)
- `src/services/api-gap.ts` (the flat services-tier accessor)
- `src/services/api-gap.test.ts` (the unit test)

**Failure message:**

```
::error::Gate P — src/services/api-gap/ directory exists (ARCH-08: collapse to single flat src/services/api-gap.ts; catalog lives in src/domain/api-gap/catalog.ts):
```

**Why filesystem-side, not grep-side:** the invariant is fundamentally about directory presence/absence — a filesystem test is precise, fast (no `find`/`grep` walk), and immune to comment-substring matches in source (the L0005 anti-pattern: a doc comment that mentions the old path verbatim would otherwise trip a grep-shaped gate). This matches the spirit of Gate L (singleton export) and Gate N (call-site allow-list) — pick the cheapest enforcement shape that captures the rule.

**Header count update:** `fifteen (A-O)` → `sixteen (A-P)`.

## Parity test confirmation (byte-identity)

The 6 catalog entries moved byte-for-byte. Two pieces of evidence:

1. **Pre-deletion diff (Task 1 step):**
   ```sh
   diff <(awk '/Object.freeze<ApiGapEntry/,/^]\);$/' src/services/api-gap/data.ts) \
        <(awk '/Object.freeze<ApiGapEntry/,/^]\);$/' src/domain/api-gap/catalog.ts)
   # empty output → BYTE-IDENTICAL
   ```

2. **Post-rewrite parity test (Task 2 step 4):**
   ```sh
   npm test -- tests/contract/api-gap-md-parity.test.ts
   #  Test Files  1 passed (1)
   #       Tests  1 passed (1)
   ```

The parity test compares `renderApiGapMarkdown(API_GAP_ENTRIES)` against the committed `docs/install/api-gap.md`. Both sides were regenerated from the new `src/domain/api-gap/catalog.ts`; the only diff vs. the prior committed markdown is the header source-path comment (`<!-- Generated from src/services/api-gap/data.ts -->` → `<!-- Generated from src/domain/api-gap/catalog.ts -->`). The 6-entry content is unchanged.

## Verifications Run

| Check | Result |
|-------|--------|
| `bash scripts/ci-grep-gates.sh` | All 16 gates passed (A-P) |
| `npm run lint` (biome check) | Clean — 277 files checked, 0 errors |
| `npx tsc --noEmit` | Clean — exit code 0 |
| `npm run build` (tsup → dist/) | Build success in 388ms |
| `npm test` (full suite) | 1373 passed / 1 skipped / 1 skipped file, **9.68s** (well under the 60s budget) |
| `npm test -- tests/contract/api-gap-md-parity.test.ts` | 1 passed (the load-bearing parity assertion) |
| `npm test -- src/services/api-gap.test.ts` | 30 passed (the renamed test runs against the new sources) |
| `rg "from.*services/api-gap/(index|data|types)" src tests scripts` | Zero matches — no stale importers anywhere in code |

## Deviations from Plan

### 1. [Rule 3 — Blocking issue] Discovered an 8th importer not enumerated in the plan

- **Found during:** Task 2 start (pre-rewrite grep sweep)
- **Issue:** The plan's `<interfaces>` block enumerated 7 importers and flagged `scripts/generate-api-gap-md.ts` as a script-side importer to handle, but did not flag its sibling test file `scripts/generate-api-gap-md.test.ts` which also imports `API_GAP_ENTRIES` from the old path.
- **Fix:** Rewrote the sibling test's import in the same Task 2 pass (`API_GAP_ENTRIES` from `../src/services/api-gap/data.js` → `../src/domain/api-gap/catalog.js`).
- **Why blocking:** the test would have failed against the deleted path, breaking the explicit-path vitest invocation documented in its file header.
- **Commit:** included in Task 2 commit `8fee598`.

### 2. [Rule 2 — Critical missing functionality] Scrubbed comment-only references to the deleted per-feature paths (L0005)

- **Found during:** Task 2 step 3 grep sweep
- **Issue:** After rewriting the 8 importer lines, six in-tree comments still mentioned the deleted paths (`services/api-gap/data.ts`, `services/api-gap/types.ts`, `services/api-gap/index.test.ts`) literally. These are not importers — they are doc comments — but they violate L0005 (comment grep-gate avoidance): a future contributor reading those comments would be pointed at deleted files, and any future grep-shaped gate would have to add allow-list exceptions for them.
- **Fix:** Rephrased the six comments to point at the new home (`src/domain/api-gap/catalog.ts`) or to describe the move abstractly without spelling the deleted paths. Files touched: `src/domain/api-gap/catalog.ts`, `src/services/api-gap.ts`, `src/services/api-gap.test.ts`, `src/formatters/api-gap.txt.ts`, `tests/contract/api-gap-md-parity.test.ts`, `scripts/generate-api-gap-md.ts`.
- **Why critical:** Gate P is a filesystem check so this scrub is not technically required for the gate to fire correctly today, but if a future contributor changes Gate P to a grep-shaped form (e.g. to detect imports from `services/api-gap/` without requiring the directory to be physically present), they would inherit a clean source tree.
- **Commit:** included in Task 2 commit `8fee598`.

### 3. [Auto-fix — Tooling] Biome auto-fixed import ordering in 4 files

- **Found during:** Task 2 `npm run lint` step
- **Issue:** Splitting the original 2-import lines into 2 tier-correct imports (e.g. `API_GAP_ENTRIES` from domain + `getApiGap` from services) put the new imports out of alphabetical order vs. surrounding sibling imports. Biome's `useSortedImports` flagged 4 files: `formatter-tone.test.ts`, `api-gap.txt.test.ts`, `api-gap.test.ts`, `bootstrap.ts`.
- **Fix:** `npm run format` (= `biome check --write`) auto-sorted all 4. Verified with a re-run of `npm run lint` (0 errors).
- **Why tracked:** the auto-fix also reordered Biome's preferred form for the bootstrap.ts collapsed import — `{ getApiGap, type ApiGapResult }` became `{ type ApiGapResult, getApiGap }`. Both are equivalent; the auto-sorted form is what landed.
- **Commit:** included in Task 2 commit `8fee598`.

### 4. [Auto-edit — Documentation] Regenerated docs/install/api-gap.md

- **Found during:** Task 2 step 1 (after rewriting the generator script's header-comment string)
- **Issue:** The generator script's header comment hard-codes the source-path string `<!-- Generated from src/services/api-gap/data.ts -->`. I updated that string to point at the new home (`src/domain/api-gap/catalog.ts`). This made the committed `docs/install/api-gap.md` byte-different from what the script now produces — the parity test would have failed.
- **Fix:** Ran `npm run docs:generate-api-gap` to regenerate the committed markdown. Verified via `git diff docs/install/api-gap.md` that only the header comment changed; the 6-entry body is byte-identical.
- **Why correctness-required:** the parity test is the load-bearing assertion. Skipping the regeneration would have left a stale markdown file and broken the test.
- **Commit:** included in Task 2 commit `8fee598`.

## Known Stubs

None. Pure structural refactor — no placeholder data, no TODOs introduced.

## Threat Flags

None. Pure file move + import rewrite; no new network endpoints, auth paths, or trust boundaries introduced. The pre-existing T-10-05-* threats in the plan's threat model are all `mitigate` / `accept` and remain valid:

- **T-10-05-01 (Tampering — catalog entry drift):** Mitigated by the parity test (green; byte-identity verified twice — pre-deletion diff and post-rewrite test).
- **T-10-05-02 (Tampering — ESM circular import on catalog):** Catalog imports nothing; cycle risk is zero.
- **T-10-05-03 (Tampering — importer rewrite misses a `.test.ts` file):** Mitigated by the pre-rewrite grep sweep, which surfaced the 8th importer (`scripts/generate-api-gap-md.test.ts`) that the plan did not enumerate. Post-rewrite grep returns zero matches.
- **T-10-05-04 (Info Disclosure):** N/A — catalog is public-by-design.
- **T-10-05-SC (Supply-chain):** No new packages.

## Commits

1. `2590047 refactor(10): create domain/api-gap/catalog.ts + services/api-gap.ts; delete the api-gap directory (ARCH-08)` — Task 1: create the new shape, delete the directory.
2. `8fee598 refactor(10): rewrite 8 api-gap importers; add Gate P forbidding the api-gap directory (ARCH-08)` — Task 2: rewrite importers + Gate P + regenerate markdown + scrub L0005 comments.

Both on branch `refactor/10-arch-08-api-gap-inline`. Not pushed; PR not opened. The orchestrator handles push + PR + review + merge.

## Self-Check: PASSED

Verified:

- `test -f src/domain/api-gap/catalog.ts` → FOUND
- `test -f src/services/api-gap.ts` → FOUND
- `test -f src/services/api-gap.test.ts` → FOUND
- `test ! -d src/services/api-gap` → CONFIRMED (directory gone)
- `git log --oneline -2 | grep 2590047` → FOUND (Task 1 commit)
- `git log --oneline -2 | grep 8fee598` → FOUND (Task 2 commit)
- `bash scripts/ci-grep-gates.sh` → All 16 gates passed
- `npm test -- tests/contract/api-gap-md-parity.test.ts` → 1 passed (load-bearing parity)
- `rg "from.*services/api-gap/(index|data|types)" src tests scripts` → zero matches
