# Phase 5: Doctor Polish, Install Guide & <20-Minute Setup Validation - Context

**Gathered:** 2026-05-26
**Status:** Ready for planning

<domain>
## Phase Boundary

Close the v1 loop. By the end of Phase 5:

- `recovery-ledger doctor` runs **14 checks** total (the 5 existing from Phases 1–2 plus 9 new ones added here), each emitting `{name, status: 'pass'|'warn'|'fail', detail}` per the Phase 1 D-06 shape. Every `name` maps 1:1 to a documented troubleshooting row, asserted by a contract test.
- An **install guide** ships at `INSTALL.md` (root entry + WHOOP-app setup checklist) plus `docs/install/` (per-client wiring for Claude Code, Claude Desktop, Cursor; a troubleshooting map keyed by check name; a launchd how-to; the API-gap reference doc).
- The **API-gap markdown** at `docs/install/api-gap.md` is **build-time generated** from `src/services/api-gap/data.ts` (Phase 4 D-28 source-of-truth) — same data backs the `whoop_api_gap` MCP tool and the doc. Contract test asserts parity.
- A **launchd `.plist` template** ships statically under `templates/com.recovery-ledger.daily-sync.plist` with documented placeholders. **Zero runtime auto-install** and **zero doctor probe** for it — DOC-05 reads literally as documentation.
- A **`< 20-minute setup-stopwatch test`** lives at `tests/integration/setup-stopwatch.test.ts`, env-gated behind `VITEST_INCLUDE_STOPWATCH=1` so it does NOT run under default `npm test`. A dedicated CI workflow runs it on `macos-latest` + `ubuntu-latest`. Boundary: `npm install` → `init` → `auth --no-browser` (with MSW + callback POST injection) → `sync` → `review daily` — under 20 minutes wall clock.
- Phase 5 adds **zero new MCP surface**. `tools.length === 8`, `resources.length === 6`, `prompts.length === 4` per Phase 4 D-29 — no new tools/resources/prompts. Gates H/I/J remain green.
- All 6 DOC-* requirements flip to Complete; ROADMAP Phase 5 flips to `[x]`; phase-close mirrors Phase 3 03-13 + Phase 4 04-12 (full-suite green, all grep gates green, REQ-IDs flipped, STATE recorded).

**Out of scope here** (deferred / never):
- New MCP tools, resources, or prompts — D-29 attestation extends.
- Web dashboard / BLE companion / hosted SaaS / cross-source integrations — `.planning/PROJECT.md` hard scope guardrail (5 preconditions must be met before any of these reopen).
- Real-WHOOP-account-burning checks in CI — ADR-0006 (MSW fixture-only) extends through the stopwatch test.
- Hooks into the user's `~/Library/LaunchAgents/` — DOC-05 ships the template, not the install action. User copies and `launchctl load`s it themselves.
- Sub-codes per check in the exit-code map. The 0/1/2 (pass/fail/warn) floor is what scripts care about; per-check structure lives in the JSON `checks[].name` field.

</domain>

<decisions>
## Implementation Decisions

### Doctor check granularity (DOC-01 / DOC-02)

- **D-01:** **Split per signal, not composite.** Every diagnostic concern is its own `DoctorCheck` row with its own `name`. A composite "db_integrity" check that aggregates 3 sub-signals (integrity, schema version, WAL size) into one row defeats DOC-02's 1:1 mapping from `check.name` to troubleshooting step. Detail strings stay short; users see a flat list of named signals.

- **D-02:** **Final check set = 14 total (5 existing + 9 new).** New checks added here, each registered in `src/services/doctor/checks/check-names.ts`:
  1. `whoop_roundtrip` — calls `GET /v2/user/profile/basic` via the Phase 2 `callWithAuth` orchestrator + Phase 3 `httpGet` chokepoint. **Pass** on 200, **warn** on 4xx that is NOT 401 (signals scope drift or revoked app), **fail** on 401 or network error. This is the D-22 deferral from Phase 2 02-CONTEXT.
  2. `db_open` — `openDb()` succeeds and pragmas are applied. Loud "DB layer is alive" signal; precedes every other db_* check.
  3. `db_integrity` — `PRAGMA integrity_check` returns `ok`.
  4. `db_schema_version` — `__drizzle_migrations` row count equals the count of `.sql` files under `src/infrastructure/db/migrations/`. Detects manually-applied or skipped migrations.
  5. `db_wal_size` — byte size of `<db>-wal`. **Warn at > 32 MB, fail at > 64 MB.** Thresholds match Phase 3 D-30's `journal_size_limit=67108864` cap — a WAL approaching the cap signals checkpoint starvation (Pitfall 12).
  6. `last_sync_recency` — `MAX(finished_at) FROM sync_runs WHERE status IN ('ok','partial')`. **Pass** ≤ 36h, **warn** ≤ 7d, **fail** > 7d. "No syncs yet" → fail. The 36h threshold is intentional: a daily-sync user who missed yesterday should see a warn; a user who missed the last week needs a fail.
  7. `most_recent_scored_day` — most-recent date with any `score_state='SCORED'` row across cycles/recoveries/sleeps. Same thresholds as #6. Distinct from #6 because sync can succeed with all-PENDING data (e.g., last-night cycle not yet scored).
  8. `data_quality_counts` — counts of `PENDING_SCORE` / `UNSCORABLE` / `baseline_excluded` rows per resource. **Always status: 'pass'** — informational visibility per Pitfall 19 (silent missing days). Detail string lists per-resource counts.
  9. `concurrent_writers_stress` — **opt-in via `--stress` CLI flag**, NOT in the default doctor surface. Spawns 4 child processes each doing a `BEGIN IMMEDIATE` upsert against a tmp DB; asserts no `SQLITE_BUSY` escapes. Mirrors the 10-fork pattern from Phase 2 D-23. Subprocess-skip gate (`skipSubprocessChecks`) plus `--stress` requirement → does NOT run from MCP and does NOT add 800ms+ to every CLI doctor invocation.

- **D-03:** **`whoop_roundtrip` is the only online check.** Auth + token-freshness from Phase 2 stay offline-safe per D-22; only `whoop_roundtrip` consumes API quota. It runs through the existing `callWithAuth` orchestrator, so a stale token triggers exactly one refresh through the single-flight gate. Skip it when `--offline` is passed (planner adds the flag alongside `--stress`). The MCP `whoop_doctor` tool inherits both flags through its existing `RunDoctorOptions` extension.

- **D-04:** **Exit codes stay at the 0/1/2 floor (pass/fail/warn).** No per-check sub-codes. "Structured" in DOC-02 refers to the JSON `checks[].name` field — every check has a stable name that the troubleshooting map keys off of. Cron / launchd / shell wrappers only branch on `!= 0`; finer structure comes from the JSON output. This rescinds the comment at `src/cli/commands/doctor.ts:25` that reserved Phase 5 for sub-codes; lock the three-status floor as the v1 contract. **Why not bitmap:** debuggable for power users but no consumer (cron, launchd, CI scripts) actually decodes a bitmask — the cost-to-benefit doesn't earn the surface area.

- **D-05:** **Severity precedence carries forward verbatim.** `deriveOverall(checks)` already implements fail > warn > pass (Phase 1 D-06); no change. The MR-21 exhaustive switch + MR-27 defense-in-depth `default` arm both extend automatically to the new checks.

### Install guide structure (DOC-04)

- **D-06:** **Hybrid layout — root `INSTALL.md` + `docs/install/` tree.** The README's "Install" link points to `INSTALL.md`; `INSTALL.md` contains:
  - **WHOOP developer-app setup checklist** (shared across all clients): create app at developer.whoop.com/dashboard/applications, register redirect URI `http://localhost:4321/oauth/callback` (or whatever port `init` printed), select scopes per Phase 2 D-13.
  - **Quickstart** (3-line happy path: `npx recovery-ledger init` → `auth` → `sync`).
  - **Per-client links** to `docs/install/claude-code.md`, `claude-desktop.md`, `cursor.md`.
  - **Troubleshooting link** to `docs/install/troubleshooting.md`.
  - **launchd link** to `docs/install/launchd.md`.
  - **API-gap link** to `docs/install/api-gap.md`.

- **D-07:** **File tree:**
  ```
  INSTALL.md                                   # WHOOP-app setup + quickstart + index
  docs/install/
    claude-code.md                             # claude_desktop_config.json snippet, MCP wiring
    claude-desktop.md                          # same shape, Claude Desktop specifics
    cursor.md                                  # compatibility note (Cursor v1 caveat → V2-01 deferred)
    troubleshooting.md                         # one H2 per check.name, contract-test-enforced
    launchd.md                                 # cp + sed + launchctl load + verification
    api-gap.md                                 # GENERATED from src/services/api-gap/data.ts
  templates/
    com.recovery-ledger.daily-sync.plist       # static template with ${HOME} / ${RECOVERY_LEDGER_BIN} placeholders
  ```

- **D-08:** **Troubleshooting map shape — one H2 per `check.name`.** Each section:
  ```markdown
  ## <check_name>
  **Symptom:** <what the user sees in doctor output / what failure looks like>
  **Likely cause:** <one-line diagnosis>
  **Fix:**
  <concrete shell commands or remediation steps>
  **See also:** <link to ADR / canonical doc>
  ```
  Sections appear in the same order as `CHECK_NAMES` is declared. New checks added to `CHECK_NAMES` MUST land alongside a new troubleshooting section in the same PR.

- **D-09:** **Contract test for troubleshooting coverage.** New `tests/contract/troubleshooting-coverage.test.ts`: imports `CHECK_NAMES`, reads `docs/install/troubleshooting.md`, asserts every `CHECK_NAMES.*` value appears as an `## <value>` H2 in the markdown. This is the load-bearing test for DOC-02's "documented troubleshooting steps" clause. Same idea as Phase 4 D-26 banned-tone contract test (assertion over rendered doc, not just source).

- **D-10:** **No per-client deviation from the core CLI flow.** Each per-client file documents the SAME commands (`init` / `auth` / `sync` / `review daily`); the only client-specific section is the MCP wiring configuration (the JSON snippet for Claude Code's settings, Claude Desktop's `claude_desktop_config.json`, Cursor's MCP config). Reason: the product is identical across clients; only the transport-config differs. Avoids three diverging install paths the user has to keep in sync.

### Stopwatch test mechanics (DOC-06)

- **D-11:** **MSW-intercepted WHOOP + `--no-browser` auth + loopback-callback POST injection.** Test machinery:
  1. Sets `RECOVERY_LEDGER_HOME=<tmp-dir>` so the test does not touch the user's real `~/.recovery-ledger/`.
  2. Sets `WHOOP_CLIENT_ID=test_client` and `WHOOP_CLIENT_SECRET=test_secret` in the env so `init` skips the interactive prompts (Phase 2 02-CONTEXT.md specifics: "init is not interactive when env-var creds are present").
  3. Starts an MSW server with the existing `tests/helpers/msw-whoop-oauth.ts` + the 6 resource helpers (cycles/recovery/sleep/workouts/profile/body-measurements) — all already exist from Phase 2 + 3.
  4. Spawns `recovery-ledger init` as a child process — completes non-interactively because of env-var creds.
  5. Spawns `recovery-ledger auth --no-browser` — captures the authorize URL printed to stderr (per Phase 2 D-08 fallback behavior), parses out the `state` param.
  6. Fires `fetch(http://localhost:<port>/oauth/callback?code=fake&state=<extracted-state>)` against the loopback callback server the child is listening on. The child's existing callback handler validates state and exchanges the code through the MSW-mocked token endpoint.
  7. Spawns `recovery-ledger sync` — pulls fixture data through MSW.
  8. Spawns `recovery-ledger review daily` — renders the review, exits 0.
  9. Wraps everything in `performance.now()` start/end and asserts elapsed < 20 minutes.

- **D-12:** **Stopwatch boundary = `npm install` → `review daily` exit 0.** Excludes `git clone` (network-bound on GitHub-provided runners; not user-felt friction once the cache is warm). Includes `npm install` because that is the actual long-tail cost of a fresh clone — native-module compile (`better-sqlite3`, `@napi-rs/keyring`) dominates real-world setup time. The 20-minute budget is comfortable on macOS (typically 3–6 min); the test exists to catch a regression that crosses the budget.

- **D-13:** **NOT in the default `npm test` suite.** Env-gated behind `VITEST_INCLUDE_STOPWATCH=1`. A dedicated GitHub Actions workflow (`.github/workflows/setup-stopwatch.yml`) runs it on `macos-latest` + `ubuntu-latest` on every PR that touches `package.json`, `src/cli/`, `src/services/bootstrap.ts`, or `src/infrastructure/db/migrations/`. Reason: 20 min × 2 platforms × every PR = burnt CI minutes without proportional value; gate it to changes that actually move the needle. The default `npm test` runs in ~10s and stays cheap.

- **D-14:** **Realism trade — explicit.** MSW intercepts at the undici-fetch level in-process, so the test does not measure real network latency / TLS / DNS. That is correct: what makes setup slow is `npm install` + native-module compile + migrator + tests, not WHOOP API roundtrips. If a future regression makes the WHOOP client slow (e.g., a synchronous DNS lookup on every fetch), it would not show up here — but it would show up in user-reported sync timing, where it belongs. The stopwatch tests the friction users feel, not the friction network simulates.

### launchd template (DOC-05)

- **D-15:** **Static `.plist` file with documented placeholders, zero runtime detection.** `templates/com.recovery-ledger.daily-sync.plist` ships in the repo with `${HOME}` and `${RECOVERY_LEDGER_BIN}` placeholders. `docs/install/launchd.md` documents `sed` + `launchctl load` + `launchctl list | grep` for verification. No doctor probe for "is launchd loaded" — that's user-tier scheduling state, not product state. Verification path: a user who set up launchd checks `recovery-ledger doctor` the next day; `last_sync_recency` (D-02 #6) shows whether the scheduled sync ran. The signal is in the data, not in a launchd-specific probe.

- **D-16:** **No `recovery-ledger install-launchd` CLI command.** DOC-05 reads "shipped as documentation (not auto-installed)" — verbatim. A CLI that writes into `~/Library/LaunchAgents/` is a surprising side effect (cf. ADR-style "doctor stays diagnostic, never mutating"). Future v2 (V2-03 systemd user timers, V2-something macOS launchctl helper) can revisit; v1 keeps it docs-only.

### API-gap markdown generation (DOC-03)

- **D-17:** **Build-time generation from `src/services/api-gap/data.ts`.** New script `scripts/generate-api-gap-md.ts`:
  - Imports `API_GAP_ENTRIES` from `src/services/api-gap/data.ts`.
  - Renders a markdown table + per-entry detail sections.
  - Writes `docs/install/api-gap.md` (head comment: "Generated from `src/services/api-gap/data.ts` — do not hand-edit; run `npm run docs:generate-api-gap` after changing the source.").
  - Wired as `npm run docs:generate-api-gap`. The committed markdown is the source of truth for human readers; the TS module is the source of truth for the MCP `whoop_api_gap` tool.

- **D-18:** **Parity contract test.** `tests/contract/api-gap-md-parity.test.ts` runs the generator into a tmp buffer and asserts no diff against the committed `docs/install/api-gap.md`. Same pattern as `drizzle-kit generate` regeneration checks. A PR that edits `data.ts` without regenerating the markdown fails CI loudly. The error message tells the user to run `npm run docs:generate-api-gap`.

- **D-19:** **`prebuild` hook does NOT regenerate.** The generator is callable on demand (`npm run docs:generate-api-gap`); the parity test is what enforces freshness. Reason: `prebuild` would run on every `tsup` invocation, including `npm run dev:cli`/`dev:mcp` watch loops — slow and unnecessary. The contract test is the forcing function; the script is the convenience.

### MCP attestation (Phase 4 D-29 carry-forward)

- **D-20:** **Zero new MCP surface in Phase 5.** `tools.length === 8`, `resources.length === 6`, `prompts.length === 4` carries from Phase 4 verbatim. The `whoop_doctor` tool surfaces the new checks automatically because its body is a 5-line shim over `services.runDoctor()` — the orchestrator's check list expansion is transparent to the MCP surface. Gates H/I/J stay green; the runtime attestation in `tests/integration/mcp-runtime.test.ts` does not change.

- **D-21:** **`src/mcp/sanitize.ts` + `src/mcp/register.ts` + `register-resource.ts` + `register-prompt.ts` all UNMODIFIED in Phase 5.** D-30 attestation (Phase 4) extends — the new `whoop_roundtrip` check produces `WhoopApiError` shapes already covered by the sanitizer patterns; new `MigrationError`-shaped failures from `db_schema_version` are sanitizer-covered via the existing Phase 3 cause-walker.

### Phase-close discipline (mirrors 03-13 + 04-12)

- **D-22:** **Phase 5 closes with a phase-close plan** (likely `05-NN-phase-close-PLAN.md`):
  - Full Vitest suite green under the 90s D-33 budget (stopwatch test EXCLUDED from default suite per D-13 — it has its own workflow).
  - All 10 grep gates green (A through J — no new gates needed; Phase 5 adds no new MCP surface).
  - D-30 attestation matrix: `sanitize.ts` + `register.ts` + `register-resource.ts` + `register-prompt.ts` unmodified diffs vs Phase 4 HEAD.
  - DOC-01..DOC-06 flipped to Complete in REQUIREMENTS.md with VALIDATION.md test-file references.
  - ROADMAP Phase 5 flipped to `[x]` with completion date.
  - STATE.md recorded close, milestone v1.0 complete.
  - README updated to reference `INSTALL.md` as the front door + a "Status" badge if CI's setup-stopwatch workflow has produced a recent green run.
  - Final attestation: clean-clone-to-first-review measured under 20 minutes on both `macos-latest` and `ubuntu-latest`.

### Claude's Discretion

The user delegated all four discussion areas at once: "Discuss them all amongst yourselves, come to me if there isn't a clear winner." Same pattern as Phases 1, 2, 3, 4 (5-for-5). Worked through every gray area; landed clear winners on all 22 decisions; no escalation.

Key resolution moments where real thinking happened (vs. mechanical application of prior decisions):
1. **D-01 / D-04 (split-per-signal + 0/1/2 exit code floor)** — these two together encode the load-bearing reading of DOC-02 "structured exit codes that map to documented troubleshooting steps." The structure lives in the JSON `checks[].name` field + the troubleshooting map keyed by that name; the exit code carries only the gross severity. A naive reading would have spawned a per-check exit code table (14 codes plus a precedence rule) — much more surface, no consumer that benefits.
2. **D-02 #9 + D-03 (opt-in `--stress` + `--offline` flags)** — `concurrent_writers_stress` is diagnostic, expensive, and infrequent. Putting it on every `doctor` invocation costs 800ms+ for no day-to-day value. Flag-gating preserves its existence (the stress test is real, runnable, documented) without polluting the daily-use surface. `--offline` does the inverse for `whoop_roundtrip` — a user without network can still run doctor and get every other check.
3. **D-11 + D-12 (stopwatch boundary = npm install → review daily; OAuth via MSW + callback POST)** — DOC-06's "git clone to first daily review" wording invites two readings. Including `git clone` measures GitHub-runner network speed (not user friction). Excluding `npm install` ignores the actual long pole. The chosen boundary measures what the user feels. The MSW + `--no-browser` + callback POST trick is the only way to exercise the real auth code path without burning a WHOOP account in CI — and Phase 2's existing MSW helpers already cover every endpoint needed.
4. **D-17 + D-18 (build-time API-gap markdown + parity contract test)** — Phase 4 D-28 deliberately put `API_GAP_ENTRIES` in a TS module so two surfaces (the MCP tool, the markdown doc) could share a source. Phase 5 ships the second surface as generated output, with a contract test enforcing the sync. Hand-writing the markdown + a contract test that diffs the TS module's text representation is more brittle (any reformatting breaks the test); generating the markdown means the test is just "regenerate and assert no diff."

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Architectural Decision Records (load-bearing)
- `agent_docs/decisions/0001-mcp-stdout-purity.md` — no `console.*`, no `process.stdout.write` from any MCP-reachable path; doctor's CLI shim at `src/cli/commands/doctor.ts` is the ONE exempt site for `process.stdout.write`. Every new doctor probe's logging goes to stderr via Pino.
- `agent_docs/decisions/0002-single-flight-oauth-refresh.md` — `whoop_roundtrip` check (D-02 #1, D-03) calls through `callWithAuth` so its 401 path triggers exactly one refresh through the single-flight gate; no new auth code in Phase 5.
- `agent_docs/decisions/0003-score-state-discipline.md` — `most_recent_scored_day` check (D-02 #7) reads through repositories' default SCORED-only filter; `data_quality_counts` (D-02 #8) opts in to non-SCORED counts via `{includeUnscored: true, includeExcluded: true}` per Phase 3 D-04 / D-16.
- `agent_docs/decisions/0006-fixture-only-tests.md` — MSW fixture-only extends through the stopwatch test (D-11) and every doctor-check unit test.
- `agent_docs/decisions/0007-whoop-read-only.md` — `whoop_roundtrip` calls `GET /v2/user/profile/basic` only; no write methods anywhere in Phase 5.

### Project policy
- `CLAUDE.md` §Critical Rules — rows 1, 6, 7 apply directly; row 2 (single-flight refresh) carries forward via `whoop_roundtrip`; row 5 (banned tone words) covers any new strings in install docs + troubleshooting + the rendered api-gap markdown.
- `CLAUDE.md` §Branch policy — every Phase 5 PR follows worktree + branch + PR + explicit approval; `.planning/**` carve-out expired at Phase 1.
- `CLAUDE.md` §Scope Guardrail — the dashboard / BLE / hosted / cross-source list stays out; Phase 5 explicitly does NOT unlock any of these. The 5 preconditions (12 daily reviews / 3 weekly reviews / 8 decisions / stable tests / non-fragile setup) become measurable AFTER Phase 5 ships.
- `.planning/PROJECT.md` §Out of Scope — "Streaks / gamification" stays out (no install-guide language that frames the daily review as a streak); "Medical advice or diagnosis" stays out (troubleshooting docs avoid clinical framing).
- `.planning/REQUIREMENTS.md` §Diagnostics & Setup — DOC-01 through DOC-06 (this phase's six requirements). All `[ ]` today; all become `[x]` at phase close.
- `.planning/REQUIREMENTS.md` §Out of Scope — confirms the API-gap entries: Healthspan, ECG, BP, Journal, Continuous HR, Hormonal Insights (six entries already in `data.ts`).

### Architecture & stack
- `.planning/research/STACK.md` §Core Technologies — no new deps in Phase 5. The generator script uses Node's built-in fs + the existing TS module; the stopwatch test reuses MSW from Phase 3.
- `.planning/research/ARCHITECTURE.md` §Component Responsibilities — doctor probes live in `src/services/doctor/checks/`; `whoop_roundtrip` is the FIRST check that depends on `infrastructure/whoop/client.ts` (preserving the layering — checks consume infrastructure through services, never reach in).
- `.planning/research/ARCHITECTURE.md` §Configuration / Paths (lines 786–810) — `~/.recovery-ledger/` layout that the stopwatch test relocates via `RECOVERY_LEDGER_HOME`.
- `.planning/research/PITFALLS.md` §Pitfall 7 (mid-flight migration) — `db_schema_version` check exposes the orphaned-row case from Phase 3 D-08; troubleshooting row directs user to `cp <backup>.sqlite db.sqlite` per the D-08 remediation.
- `.planning/research/PITFALLS.md` §Pitfall 12 (unbounded WAL) — `db_wal_size` thresholds (32MB warn / 64MB fail) align with Phase 3 D-30's `journal_size_limit=64MB`; warn means "checkpoint is lagging," fail means "WAL is at the cap."
- `.planning/research/PITFALLS.md` §Pitfall 17 (token logging) — new doctor probes never inline tokens; the existing sanitizer pipeline covers any error that bubbles through MCP `whoop_doctor`.
- `.planning/research/PITFALLS.md` §Pitfall 19 (silent missing days) — `last_sync_recency` + `most_recent_scored_day` + `data_quality_counts` together make missing days visible. The product's PITFALLS reading is "missing days that the user notices later" — three checks surface this proactively.
- `.planning/research/SUMMARY.md` §Risks — "setup friction" is the Phase 5 risk row; the stopwatch test is the load-bearing mitigation.

### Roadmap context
- `.planning/ROADMAP.md` §Phase 5 — Goal, the 4 success criteria, depends-on (Phase 4: requires the full product surface before doctor can probe it; specifically requires the `services.runDoctor()` composition root from Phase 1/2 + Phase 4's MCP shims).
- `.planning/ROADMAP.md` §Cross-Cutting Concerns row "<20-minute clean-clone stopwatch" — Phase 5 origin; test stays in CI from this phase forward (DOC-06 anchors it).
- `.planning/phases/01-foundation-stdout-pure-mcp-bootstrap/01-CONTEXT.md` §Decisions D-05/D-06 — doctor JSON shape every new Phase 5 check follows; CLI exit-code precedent.
- `.planning/phases/02-oauth-token-store-single-flight-refresh/02-CONTEXT.md` §Decisions D-21/D-22 — `auth` + `token_freshness` checks already shipped offline-safe; D-22 explicitly defers `whoop_roundtrip` to here. Plus Phase 2 D-23 (10-fork concurrent-load test pattern) is the precedent for `concurrent_writers_stress`.
- `.planning/phases/03-data-model-db-layer-sync-loop/03-CONTEXT.md` §Decisions D-06/D-07/D-08 — migration crash-recovery contract; `db_schema_version` check is the runtime probe for the D-08 "fails-closed, no auto-restore" posture. D-30 pragmas + D-32 wal_checkpoint underwrite `db_wal_size` thresholds.
- `.planning/phases/04-domain-math-reviews-decision-ledger-mcp-surface/04-CONTEXT.md` §Decisions D-28 — `src/services/api-gap/data.ts` source-of-truth; Phase 5 D-17 generates from this same module. D-29 + D-30 MCP-surface attestation extends verbatim.
- `.planning/STATE.md` — Phase 4 close attestation matrix; Phase 5 begins from `current_plan: 12, status: verifying` for milestone v1.0.

### Conventions (project-local)
- `agent_docs/conventions.md` — TS strict, no default exports, lite hexagonal, validation at boundaries only, comments only when the *why* isn't obvious.
- `agent_docs/conventions.md` §Testing — `pool: 'forks'` for Vitest (needed for `concurrent_writers_stress` probe's child-fork pattern + the stopwatch test's child-spawn pattern); contract tests under `tests/contract/<scenario>.test.ts`; integration tests under `tests/integration/<scenario>.test.ts`.
- `agent_docs/workflows/contributing.md` — branch + PR + commit rules; every Phase 5 plan lands as its own branch + PR with `/ce-code-review` per `agent_docs/workflows/pr-review.md`.

### Existing source-of-truth modules (load-bearing for Phase 5)
- `src/services/doctor/index.ts` — orchestrator + `DoctorCheck` / `DoctorResult` types + `deriveOverall()`; extends additively to 14 checks.
- `src/services/doctor/checks/check-names.ts` — `CHECK_NAMES` const registry; new check name constants added here.
- `src/services/api-gap/data.ts` — `API_GAP_ENTRIES` source-of-truth for both the MCP tool (Phase 4) and the generated markdown (Phase 5 D-17).
- `src/cli/commands/doctor.ts` — `DOCTOR_EXIT_CODES` + the one Gate-C-exempt `process.stdout.write` site. Phase 5 adds `--stress` and `--offline` flag wiring; no exit-code expansion (D-04 locks 0/1/2 floor).
- `src/mcp/tools/whoop-doctor.ts` — MCP shim; gains the `--stress` / `--offline` equivalent via Zod schema additions to its `inputSchema`. Body stays ≤ 5 lines per MCP-03.

### External references (researcher confirms / refines)
- WHOOP for Developers — `/v2/user/profile/basic` endpoint (`https://developer.whoop.com/docs/developing/user-data/profile/`) — used by `whoop_roundtrip` (D-02 #1). Smallest payload of any v2 endpoint; minimum quota cost.
- Apple — `launchd.plist(5)` man page + `launchctl(1)` (`man launchd.plist`, `man launchctl`) — `.plist` schema + load semantics; canonical reference for the template in D-15. Key keys: `Label`, `ProgramArguments`, `StartCalendarInterval`, `StandardOutPath`, `StandardErrorPath`, `EnvironmentVariables`.
- Model Context Protocol Specification (`https://modelcontextprotocol.io/specification`) — confirms zero new MCP surface in Phase 5; no new conformance work.
- Anthropic — Claude Code MCP setup (`https://docs.claude.com/en/docs/claude-code/mcp`) — canonical reference for the `claude-code.md` per-client install section.
- Anthropic — Claude Desktop MCP setup (`https://modelcontextprotocol.io/quickstart/user`) — canonical reference for `claude-desktop.md`.
- Cursor — MCP documentation (researcher to locate current URL; Cursor MCP support was beta as of Phase 4) — used by `cursor.md`; if support has regressed, the per-client doc says so and V2-01 stays the forward fix.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- **`src/services/doctor/index.ts`** (Plans 01-03, 02-06; ~165 LOC) — `runDoctor()` orchestrator with `Promise.allSettled` + `deriveOverall()` + intentionally-closed `'pass'|'warn'|'fail'` status union. Phase 5 extends `PROBE_NAMES` from 5 to 14 entries (or 12 + 2 conditional on `--offline`/`--stress`) and adds 9 new probe files under `checks/`. Zero changes to `deriveOverall()` or the `DoctorCheck` shape.
- **`src/services/doctor/checks/check-names.ts`** (Plan 01-03 + 02-06) — single source of truth for check name strings. Phase 5 adds 9 constants: `WHOOP_ROUNDTRIP`, `DB_OPEN`, `DB_INTEGRITY`, `DB_SCHEMA_VERSION`, `DB_WAL_SIZE`, `LAST_SYNC_RECENCY`, `MOST_RECENT_SCORED_DAY`, `DATA_QUALITY_COUNTS`, `CONCURRENT_WRITERS_STRESS`.
- **`src/services/doctor/checks/auth.ts`** + **`token-freshness.ts`** (Plan 02-06) — canonical precedent for an offline-safe check. Each is a small async function returning `Promise<DoctorCheck>`. Phase 5's 8 default checks follow this shape verbatim; the 9th (`concurrent_writers_stress`) needs a subprocess gate similar to `mcp-stdout-purity.ts`.
- **`src/services/doctor/checks/mcp-stdout-purity.ts`** (Plan 01-04) — canonical precedent for a subprocess-spawning check with a skip gate. `concurrent_writers_stress` mirrors the `skipSubprocess` parameter pattern.
- **`src/services/doctor/checks/native-modules.ts`** (Plan 01-04) — precedent for a check that exercises a native module's load path. The probe is intentionally narrow ("does it load?") rather than testing full functionality; same posture for the new probes.
- **`src/services/api-gap/data.ts`** (Plan 04-06) — `API_GAP_ENTRIES` typed const + `Object.freeze` + banned-tone contract test at module load. Phase 5 D-17 generator imports this verbatim. The `ApiGapEntry` type forces `available_via_v2_api: false` at the type level for v1, so the markdown generator can hard-code "Unavailable via API" framing.
- **`src/services/api-gap/index.ts`** — service that exposes `getApiGap()` to the MCP tool and the CLI; the markdown generator does NOT use this — it imports `API_GAP_ENTRIES` directly because it's a build-time tool that doesn't need the bootstrap composition.
- **`src/services/bootstrap.ts`** — DB-heavy composition root; the doctor stops short of full bootstrap for the offline-safe checks (uses `createServices()` instead). The 4 new DB-touching checks (`db_open`, `db_integrity`, `db_schema_version`, `db_wal_size`, `last_sync_recency`, `most_recent_scored_day`, `data_quality_counts`) need DB access; planner decides whether `runDoctor()` accepts an injected DB handle (preferred — keeps the surface lazy) or whether the probes call `openDb()` themselves with a tmp connection (alternative — more isolation, less efficient).
- **`src/cli/commands/doctor.ts`** (Plan 01-05 + 02-06; ~80 LOC) — Gate-C-exempt CLI site. Phase 5 adds `--stress` and `--offline` to the Commander option list; passes them through to `services.runDoctor({stress, offline})`. The exit-code map stays as-is (D-04 locks 0/1/2 floor); no `DOCTOR_EXIT_CODES` extension.
- **`src/mcp/tools/whoop-doctor.ts`** (Plan 01-03 + 02-06) — MCP shim. Phase 5 extends its `inputSchema` Zod object with `{stress: z.boolean().optional(), offline: z.boolean().optional()}` and threads both into the `runDoctor()` call. Body stays ≤ 5 lines per MCP-03.
- **`src/formatters/doctor.txt.ts`** + **`doctor.txt.test.ts`** — plain-text renderer; already handles arbitrary `name`+`status`+`detail`. No formatter changes needed for the new checks — they render automatically.
- **`tests/integration/auth-concurrency.test.ts`** (Plan 02-08) — 10-fork cross-process precedent; `concurrent_writers_stress` mirrors the spawn pattern + the assertion shape ("no `SQLITE_BUSY` escapes" instead of "no double-refresh").
- **`tests/helpers/msw-whoop-oauth.ts`** + **`tests/helpers/msw-whoop-*.ts`** (Plans 02-01, 03-07; 7 helpers total) — MSW handler suite for the entire WHOOP API surface. The stopwatch test (D-11) imports all of them — zero new MSW handlers needed in Phase 5.
- **`tests/helpers/in-memory-db.ts`** (Plan 03-07) — in-memory SQLite helper. Used by the new DB-check unit tests; the stopwatch test uses a real on-disk DB in the tmp dir (more realistic for the full-path measurement).

### Established Patterns
- **`{name, status, detail}` DoctorCheck shape** (Phase 1 D-06) — 14 checks share this exactly. The `name` field is the troubleshooting-map key (D-08); the `detail` field is the human-readable signal (free-form, but banned-tone-lint-covered).
- **`deriveOverall()` precedence: fail > warn > pass** (Phase 1 D-06, Phase 2 D-21) — extends to 14 checks unchanged; the MR-21 exhaustive switch + MR-27 default arm both inherit the new probes without modification.
- **Subprocess gate via `skipSubprocessChecks`** (`mcp-stdout-purity.ts`) — `concurrent_writers_stress` reuses the gate (set by the MCP tool shim to prevent recursion + by `--stress` absence on CLI invocations).
- **CLI exit codes as `Object.freeze`d const + `addHelpText('after', ...)`** (Plans 02-05, 03-12, 04-11) — `--stress` and `--offline` flags get documented in the help text alongside the exit codes.
- **MSW handler-per-resource** (Phase 2 D-25 + Phase 3 D-15) — zero new handlers in Phase 5; the existing 7 helpers cover everything the stopwatch test needs.
- **Fixture-based contract tests** (Phases 3 + 4 precedent) — Phase 5 adds 2 new contract tests: `troubleshooting-coverage.test.ts` (D-09) and `api-gap-md-parity.test.ts` (D-18). Both run under default `npm test`.
- **Banned-tone-word lint coverage on rendered docs** (Phase 4 D-26) — extends to the generated `docs/install/api-gap.md` automatically (generator output is just rendered TS data + static framing strings, all already lint-covered). Free-form docs under `docs/install/*.md` (claude-code, claude-desktop, cursor, troubleshooting, launchd) are NOT covered by the existing lint, which targets `src/formatters/*` and `src/services/api-gap/data.ts`. Planner decides whether to extend `scripts/ci-grep-gates.sh` Gate A to also scan `docs/install/*.md` or whether to add a separate contract test asserting banned-word absence on the install docs (low risk either way — they're under direct authorial control).
- **`pool: 'forks'` for Vitest** — needed for `concurrent_writers_stress` probe tests + the stopwatch test's child-process spawns.

### Integration Points
- **`recovery-ledger doctor`** gains 8 new default checks + 1 opt-in via `--stress`; existing 5 checks unchanged. `--offline` skips `whoop_roundtrip`. JSON output gains 8 new `checks[]` rows; text output gains 8 lines.
- **`whoop_doctor` MCP tool** transparently picks up the new checks via the same `services.runDoctor()` call; `inputSchema` extends with `{stress, offline}` Zod fields. The D-29 attestation that `tools.length === 8` is unaffected.
- **`scripts/ci-grep-gates.sh`** — no new gates needed in Phase 5; existing 10 gates (A–J) cover everything.
- **`.github/workflows/`** — Phase 5 adds one new workflow: `setup-stopwatch.yml`, triggered on PRs touching `package.json`, `src/cli/`, `src/services/bootstrap.ts`, or `src/infrastructure/db/migrations/`. The existing CI workflow stays unchanged.
- **`README.md`** — Phase 5 close updates the "Install" section to point at `INSTALL.md`; existing per-section content (Stack, Status, Architecture) stays.
- **`package.json`** — Phase 5 adds two scripts: `docs:generate-api-gap` (runs the D-17 generator) and `test:stopwatch` (runs the stopwatch suite with the env-gate set). Convenience aliases; no new dependencies.

</code_context>

<specifics>
## Specific Ideas

- **Doctor check ORDER in `runDoctor()` matters for first-fail-wins UX.** Existing Phase 1/2 order is: `better_sqlite3_load`, `napi_keyring_load`, `mcp_stdout_purity`, `auth`, `token_freshness`. Phase 5 inserts the new checks in dependency order: load → db open → db integrity / schema / wal → auth → token → whoop_roundtrip (depends on auth+token) → sync recency / scored day → data quality counts. A user with no tokens sees `auth: fail` before any sync-recency check fires — the more fundamental remediation comes first in the visual output. (`deriveOverall` doesn't care about order; this is purely UX.)

- **Troubleshooting H2 headings use the literal `check.name` string.** Not a humanized version. Reason: the contract test (D-09) asserts exact-match; the user's doctor output prints the literal name; the search path from "I see this in doctor output" to "I open troubleshooting.md and Ctrl-F it" is shortest if the strings are identical. Each section can have a humanized H3 subtitle if needed (e.g., `## last_sync_recency\n### Sync is stale`), but the H2 anchor stays literal.

- **launchd template uses `${RECOVERY_LEDGER_BIN}` not `$(which recovery-ledger)`.** Reason: launchd does NOT shell-expand `$( )`; the user must substitute the literal path themselves. `docs/install/launchd.md` documents `RECOVERY_LEDGER_BIN=$(which recovery-ledger) sed -e "s|\${RECOVERY_LEDGER_BIN}|$RECOVERY_LEDGER_BIN|g" templates/com.recovery-ledger.daily-sync.plist > ~/Library/LaunchAgents/com.recovery-ledger.daily-sync.plist`.

- **Stopwatch test asserts < 20 min but the budget is `STOPWATCH_BUDGET_MS = 20 * 60 * 1000`** as a top-of-file constant. Easy to find, easy to lower if Phase 5 close shows we have 5x headroom and want a tighter regression gate (cf. Phase 4 D-33's 60s → 90s suite-budget escalation pattern).

- **`whoop_roundtrip` detail string is `"profile fetched in <Nms>"` on pass.** Surfaces real WHOOP API latency at doctor time — a soft signal that "WHOOP API itself feels slow today" without making the check fail. Same posture as the existing `token_freshness` detail string (`expires in 12m` etc.).

- **`db_schema_version` detail string formats as `"schema at migration <N>/<expected>"`** on pass. On fail (the orphaned-row case), includes the path to the most-recent backup and the remediation command verbatim — same pattern as Phase 3 D-08's `MigrationError({backupPath, latestSafeMigration})`. The troubleshooting row (D-08) tells the user to run `cp <backup> ~/.recovery-ledger/recovery-ledger.sqlite` (matches Phase 3 D-08 "user-initiated, documented step instead").

- **`data_quality_counts` detail string is short — one line per resource with counts.** Format: `cycles: 142 scored, 3 pending, 0 unscorable, 2 excluded; recoveries: ...`. Multiline detail strings are fine (the formatter `doctor.txt.ts` already handles them); MCP `structuredContent` carries the same string verbatim.

- **`tests/contract/troubleshooting-coverage.test.ts` reads `docs/install/troubleshooting.md` at test time.** Uses Node's `fs.readFileSync`; no markdown parser needed — a regex `^## (\w+)$` is enough to extract H2 headings. Compare set against `Object.values(CHECK_NAMES)`. Reason: a markdown parser dep would be the only new dep in Phase 5; regex on H2s is sufficient and zero-dep.

</specifics>

<deferred>
## Deferred Ideas

- **`recovery-ledger install-launchd` CLI command** — D-16 keeps Phase 5 to docs-only. If post-v1 user feedback shows the `sed` + `launchctl load` dance is too fiddly, revisit. The probe layer is already in place (`last_sync_recency`) so reading "did yesterday's sync run" doesn't require new infrastructure.
- **Per-check exit-code sub-codes** — D-04 locks 0/1/2 floor. Revisit if a real consumer emerges (a launchd wrapper that wants to branch on "DB failed" vs "auth failed" without parsing JSON). None observed in practice.
- **Doctor probe for "launchd job loaded and ran yesterday"** — explicit `launchctl list | grep` probe. Currently subsumed by `last_sync_recency`; revisit if v2 launchd-helper command lands.
- **systemd user-timer template (Linux)** — REQUIREMENTS V2-03. Phase 5 ships macOS launchd only because the platform target is macOS-first; Linux users run cron or the systemd template lands in V2.
- **Healthcheck endpoint / heartbeat ping for the launchd job** — call a user-provided URL after each successful sync to feed a HealthChecks.io-style watchdog. Pure observability surface; defer until a user asks.
- **Doctor `--watch` mode** that re-runs every N seconds. Phase 5 stays one-shot; agent invocations + cron + ad-hoc CLI runs are the only patterns observed.
- **HTML-rendered doctor output** (`doctor --html`) for embedding in a dashboard. Web dashboard is out of scope per the hard scope guardrail; revisit only after the 5 preconditions are met.
- **Multi-account doctor view** (per-keychain-account check sets). Phase 2 D-04 lists multi-account as a v2 migration; doctor surface waits for the multi-account migration.
- **WHOOP webhook receiver as an alternative to polling sync** — Phase 3 D-12 ruled webhooks out of v1 per scope guardrail. Doctor probe for "is the webhook endpoint reachable" would only matter if v2 adopts webhooks.
- **Markdown-rendered API-gap doc as an MCP resource** (`whoop://api-gap/markdown`) — Phase 4 already exposes `whoop_api_gap` as a tool returning structured data; a markdown-rendered resource is a thin extension but adds MCP surface (breaks D-20). Defer; the install-guide doc covers human-readers.
- **Per-resource API quota dashboards** — `whoop_doctor` could surface "you've used X/100 req/min, Y/10000 req/day" from `X-RateLimit-*` headers cached during sync. Not in DOC-01; defer to a `doctor --quota` future flag.
- **Doctor probe that diffs `dist/` vs `src/`** to catch the stale-dist case the `mcp_stdout_purity.test.ts` already protects against. Currently covered by Plan 01-06 / Plan 01-03's `BUILD_BEFORE_TESTS` check; not needed as a doctor surface.
- **`recovery-ledger reset auth`** — explicit subcommand to clear tokens and prompt for re-auth (Phase 2 deferred-item). Phase 5 install guide documents `rm ~/.recovery-ledger/tokens.json` (file mode) and Keychain Access steps (keyring mode); add the subcommand only if the manual steps surface as confusing in real use.
- **AES-256-GCM passphrase-derived file fallback for tokens** — Phase 2 deferred item; still deferred. Phase 5 docs note the `chmod 600` posture for the file fallback.
- **`learnings.md` entry** — recurring observation from Phase 1–4 that grep-criteria literals in comments break gates. Phase 4 04-CONTEXT noted "5th-time-in-a-row deviation"; if Phase 5 makes it 6, the `learnings.md` entry becomes load-bearing. Low priority — the convention is now well-established.

</deferred>

---

*Phase: 05-doctor-polish-install-guide-20-minute-setup-validation*
*Context gathered: 2026-05-26*
