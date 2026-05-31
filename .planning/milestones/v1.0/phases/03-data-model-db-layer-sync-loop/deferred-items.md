# Phase 3 — Deferred Items

Out-of-scope discoveries logged by executors. Not fixed inline because they
predate the executing plan and live outside its scope.

## TypeScript strict-mode errors (3 pre-existing)

**Logged by:** Plan 03-04 executor (2026-05-16)
**Verification:** `git stash -u && npx tsc --noEmit` on the pre-03-04 HEAD
(`7a8f051 docs(03-02): complete schema plan`) reproduces all three errors.
Both files exist on `origin/main` and are NOT touched by Plan 03-04.

```
src/cli/commands/auth.ts(97,35): TS2379 — `RunOAuthOptions.timeoutMs`
  with `exactOptionalPropertyTypes: true` rejects `undefined`. The
  spread call site passes `timeoutMs: number | undefined`.
tests/helpers/msw-whoop-oauth.ts(74,32): TS2345 — JsonBodyType mismatch
  on MSW HttpResponse.json arg (msw 2.x type tightening).
tests/helpers/msw-whoop-oauth.ts(82,30): TS2345 — same as above.
```

**Why not auto-fixed in Plan 03-04:** Scope-boundary rule. These errors live
in files Plan 03-04 does not modify (`src/cli/commands/auth.ts`,
`tests/helpers/msw-whoop-oauth.ts`). Auto-fixing would expand the diff
beyond Plan 03-04's `files_modified` frontmatter.

**Why CI does not catch them today:** The project's gate set is `npm run lint`
+ `npm run test` + `bash scripts/ci-grep-gates.sh`. There is no
`tsc --noEmit` gate in CI. Plans 02-* shipped while these errors existed.
Vitest + Biome do not surface them because vitest runs via tsx (transpile-
only) and Biome's TS checker does not enforce `exactOptionalPropertyTypes`
in the same way.

**Recommended owner:** A near-term cleanup plan (or a Phase 5 setup-doctor
plan) should add `npx tsc --noEmit` to `scripts/ci-grep-gates.sh` (or
make it a sibling CI step) AFTER fixing these three sites. Until that
happens, executors should run `npx tsc --noEmit src/<changed-files>`
on just their own changes to verify isolated type-correctness.
