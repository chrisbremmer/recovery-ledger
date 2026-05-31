# Plan 05-11 Summary — Phase 5 Close + v1.0 Milestone

**Completed:** 2026-05-29
**Type:** phase-close (attestation + 4-doc flip)

## Outcome

Phase 5 (Doctor Polish, Install Guide & <20-Minute Setup Validation) is CLOSED.
Milestone **v1.0 is COMPLETE** — 50 / 50 v1 requirements done across Phases 1+2+3+4+5.

## Requirements flipped (6)

| Req | Verified by |
|-----|-------------|
| DOC-01 | `src/services/doctor/index.test.ts` (14-check assertion) + 9 per-probe test files |
| DOC-02 | `tests/contract/troubleshooting-coverage.test.ts` + `DOCTOR_EXIT_CODES` {pass:0,fail:1,warn:2} (D-04 floor) |
| DOC-03 | `tests/contract/api-gap-md-parity.test.ts` + `scripts/generate-api-gap-md.test.ts` |
| DOC-04 | `tests/contract/troubleshooting-coverage.test.ts` + INSTALL.md + docs/install/*.md |
| DOC-05 | `templates/com.recovery-ledger.daily-sync.plist` (plutil -lint) + docs/install/launchd.md |
| DOC-06 | `tests/integration/setup-stopwatch.test.ts` (env-gated; 5s local run) + `.github/workflows/setup-stopwatch.yml` |

## Attestation matrix

1. **Full suite:** 1203 passed / 1 skipped across 114 files in ~10s (< 90s D-33 budget). The 1 skipped is the env-gated stopwatch (D-13).
2. **Grep gates:** all 10 (A–J) green — zero new gates added (D-22).
3. **D-29:** `tools.length===8` + `resources.length===6` + `prompts.length===4` (mcp-runtime.test.ts) — Phase 5 added zero MCP surface.
4. **D-21:** `git diff origin/main..HEAD -- src/mcp/register.ts src/mcp/register-resource.ts src/mcp/register-prompt.ts src/infrastructure/observability/sanitize.ts` → empty (0 lines). Sanitizer + 3 register wrappers byte-identical across Phases 4→5.
5. **14-check doctor (built dist):** `node dist/cli.mjs doctor --offline` emits 14 checks; `--stress` runs the forked worker (4×50 upserts, ~80ms, no SQLITE_BUSY).
6. **Stopwatch:** real local gated run completed in 5s vs the 1200s (20-min) budget — npm install + tsup build + config write + MSW OAuth token exchange + 6-resource sync + getDailyReview, full path executed.

## Mid-execution fixes folded into the phase

- **db_schema_version dist path:** probe resolved migrations dir from a fixed `../../../` import.meta.url depth that breaks once flattened into `dist/cli.mjs`. Fixed: bootstrap injects its already-resolved `migrationsDir` through `RunDoctorOptions`; the probe's own fallback now probes both dev + bundled layouts.
- **concurrent_writers_stress worker:** missing from `dist/` — added as a tsup top-level entry (`dist/concurrent-writers-stress.worker.mjs`).

## Stopwatch CI workflow

`.github/workflows/setup-stopwatch.yml` runs on macos-latest + ubuntu-latest, PR-path-filtered to package.json / src/cli/** / src/services/bootstrap.ts / src/infrastructure/db/migrations/**, env `VITEST_INCLUDE_STOPWATCH=1` (+ `RECOVERY_LEDGER_FORCE_FILE_STORE=1` on ubuntu). The CI run fires when the Phase 5 PR (touching those paths) is opened; the local gated run (5s) is the standing proof DOC-06 holds.

## Known v1.0 issue (deferred, non-blocking)

6 pre-existing `tsc --noEmit` errors (`auth.ts` ×1, `sync-runs.repo.ts` ×3, `msw-whoop-oauth.ts` ×2) predate Phase 5 (present on main; Phase 4 closed with them). The project's CI contract is `biome check` + `vitest run` + `scripts/ci-grep-gates.sh` — there is no `tsc` gate, and all three pass. The `sync-runs.repo.ts` trio needs a Phase-3 `'aborted'`-status domain decision (schema-enum widening #15/#35 left the repo return type narrower than the column enum). Recommend a follow-up `/gsd-debug` to reconcile before adding a `tsc --noEmit` CI gate. Tracked in `deferred-items.md`.

## Files modified

- `.planning/REQUIREMENTS.md` — 6 DOC-* flipped to Complete; coverage 50/50; v1.0 marker.
- `.planning/ROADMAP.md` — Phase 5 row `[x]`; 11 plans listed; Progress 11/11; Coverage 50/50.
- `.planning/STATE.md` — Phase 5 close paragraph + attestation matrix + learnings + frontmatter (completed_phases 5, total/completed_plans 50, status complete).
- `.planning/phases/05-.../05-VALIDATION.md` — frontmatter complete + nyquist_compliant: true + wave_0_complete: true; per-task map populated; sign-off checked.
