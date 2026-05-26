# Phase 5: Doctor Polish, Install Guide & <20-Minute Setup Validation - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in `05-CONTEXT.md` — this log preserves the alternatives considered.

**Date:** 2026-05-26
**Phase:** 05-doctor-polish-install-guide-20-minute-setup-validation
**Areas discussed:** Doctor check expansion + exit codes, Install guide structure + troubleshooting map, <20-minute stopwatch test mechanics, launchd template + API-gap markdown generation

---

## Doctor check expansion + exit codes

| Option | Description | Selected |
|--------|-------------|----------|
| Composite checks (one row per concern) | Single `db_integrity` check bundles PRAGMA integrity_check + schema version + WAL size | |
| Split per signal (one row per check) | Each diagnostic surface gets its own DoctorCheck row + name | ✓ |

**User's choice:** Delegated — "Discuss them all amongst yourselves, come to me if there isn't a clear winner."
**Notes:** Split-per-signal won because DOC-02's "1:1 mapping from check name to troubleshooting step" forces atomic check names. Composite would have required either per-sub-signal text parsing or per-check sub-exit-codes (D-04 rejected the latter).

### Concurrent-writers stress mechanics

| Option | Description | Selected |
|--------|-------------|----------|
| Spawn 4 child processes (forks) | Mirrors Phase 2 D-23 10-fork pattern; uses tmp DB | ✓ |
| In-process `Promise.all` on shared connection | Doesn't exercise contention (better-sqlite3 is single-threaded per connection) | |
| Worker threads, each with own connection | More isolation, more complexity | |

**Decision:** Forks; opt-in via `--stress` flag so the default `doctor` invocation stays fast (D-02 #9).

### Exit-code scheme

| Option | Description | Selected |
|--------|-------------|----------|
| Bitmap (auth=1, token=2, db=4, ...) | Power users can decode multi-failure runs from the exit code alone | |
| First-failure-wins named codes | exit 10 = db_integrity, 20 = wal, ... | |
| Three-tier (pass/warn/fail) + check.name in JSON | Keep current 0/1/2; troubleshooting map keys off `check.name` | ✓ |

**Decision (D-04):** Three-tier 0/1/2 floor; per-check structure lives in JSON. Cron/launchd only branch on `!= 0`; the structure consumers actually use is the JSON name field.

---

## Install guide structure + troubleshooting map

| Option | Description | Selected |
|--------|-------------|----------|
| Single `INSTALL.md` at repo root | ~500-800 lines; one file to find from README | |
| `docs/install/` tree with per-client + troubleshooting + launchd files | Per-client sections independently maintainable | |
| Hybrid — root `INSTALL.md` + `docs/install/` for specifics | README → INSTALL.md (overview + per-client links) → docs/install/*.md | ✓ |

**Decision (D-06, D-07):** Hybrid. Root `INSTALL.md` is the front door + WHOOP-app setup checklist (one shared step across all clients); per-client wiring + troubleshooting + launchd + api-gap under `docs/install/`.

### Troubleshooting map shape

| Option | Description | Selected |
|--------|-------------|----------|
| Table embedded in `INSTALL.md` | One markdown table mapping check.name → fix | |
| Dedicated `docs/install/troubleshooting.md` with H2-per-check | Symptom / Likely cause / Fix / See also per check | ✓ |
| Extended `doctor --help` text | All troubleshooting lives in CLI help | |

**Decision (D-08, D-09):** Dedicated doc with H2 per `check.name`. Contract test (`tests/contract/troubleshooting-coverage.test.ts`) asserts every `CHECK_NAMES.*` has a matching H2 heading. This is the load-bearing test for DOC-02's "documented troubleshooting steps" requirement.

### Per-client divergence

**Decision (D-10):** No per-client deviation in the core CLI flow (init/auth/sync/review). Only the MCP wiring config differs per client. Reason: avoids three diverging install paths the user has to keep in sync.

---

## <20-minute stopwatch test mechanics

| Option | Description | Selected |
|--------|-------------|----------|
| MSW for WHOOP + `--no-browser` auth + callback POST injection | Use existing Phase 2/3 MSW helpers; loopback callback POST simulates "user pasted URL" | ✓ |
| Pre-baked tokens injected into tmp `~/.recovery-ledger/tokens.json` | Fastest but bypasses AUTH-01..06 entirely | |
| Hand-rolled minimal OAuth server on loopback + base-URL override | Tests more of the auth path; new infrastructure to maintain | |

**Decision (D-11):** MSW + `--no-browser` + callback POST. All MSW helpers already exist from Phases 2-3; the test parses the authorize URL from stderr, extracts `state`, fires a `fetch()` against the loopback callback to simulate the user's browser redirect.

### Stopwatch boundary

| Option | Description | Selected |
|--------|-------------|----------|
| `git clone` → `review daily` | Includes network for clone | |
| `npm install` → `review daily` | Excludes clone (network-bound on runners); includes the long pole (npm install + native-module compile) | ✓ |
| `init` → `review daily` | Excludes npm install — too narrow | |

**Decision (D-12):** `npm install` → `review daily` exit 0. Captures the friction the user actually feels (native-module compile dominates real-world setup time).

### Test gating

| Option | Description | Selected |
|--------|-------------|----------|
| Default `npm test` includes stopwatch | Every `npm test` pays 20 minutes | |
| Env-gated behind `VITEST_INCLUDE_STOPWATCH=1` + dedicated GH workflow | Default suite stays ~10s; stopwatch runs on PRs touching key files | ✓ |

**Decision (D-13):** Env-gated. Separate `.github/workflows/setup-stopwatch.yml` triggers on PRs to `package.json`, `src/cli/`, `src/services/bootstrap.ts`, or `src/infrastructure/db/migrations/`. Avoids burning 20 min × 2 platforms × every PR.

---

## launchd template + API-gap markdown generation

### launchd

| Option | Description | Selected |
|--------|-------------|----------|
| Static `.plist` template under `templates/` + `docs/install/launchd.md` | Pure docs; user copies + sed + launchctl load | ✓ |
| `recovery-ledger install-launchd` CLI command | Writes customized .plist to `~/Library/LaunchAgents/` | |

**Decision (D-15, D-16):** Static template only. DOC-05 reads "shipped as documentation (not auto-installed)" verbatim; a CLI that writes into the user's LaunchAgents would be a surprising side effect and break doctor's diagnostic-not-mutating posture.

**Decision (D-15 cont.):** Zero runtime detection — no doctor probe for "is launchd loaded." The verification path is `last_sync_recency` (D-02 #6): a user who set up launchd checks doctor the next day and sees whether the scheduled sync ran.

### API-gap markdown

| Option | Description | Selected |
|--------|-------------|----------|
| Build-time generation from `src/services/api-gap/data.ts` + parity contract test | Single source of truth in TS; markdown regenerated automatically | ✓ |
| Hand-written markdown + contract test asserting parity with TS | More brittle (any reformatting breaks the test) | |
| Runtime generation by `recovery-ledger api-gap --markdown` | Not docs-shippable as a static file | |

**Decision (D-17, D-18):** Build-time generated via `scripts/generate-api-gap-md.ts`; committed at `docs/install/api-gap.md`. Contract test `tests/contract/api-gap-md-parity.test.ts` runs the generator and asserts no diff.

**Decision (D-19):** Generator is NOT a `prebuild` hook (would slow `npm run dev:*` watch loops). It's `npm run docs:generate-api-gap` + the parity contract test as the forcing function.

---

## Claude's Discretion

User delegated all four areas at once with the same wording used in Phases 1–4: "Discuss them all amongst yourselves, come to me if there isn't a clear winner."

Worked through every gray area; landed clear winners on all 22 locked decisions; no escalation needed.

Real-thinking moments (vs. mechanical application of prior decisions):
1. **D-01 + D-04 together encode DOC-02's "structured exit codes" clause** — the load-bearing reading is JSON-name-keyed troubleshooting, not per-check exit codes. Naive reading would have required a 14-code table.
2. **D-02 #9 + D-03 (opt-in flags for stress + offline)** — preserves diagnostic capability without polluting the daily-use surface. `--stress` adds 800ms+; `--offline` lets users without network still get every other check.
3. **D-11 + D-12 (MSW + callback POST + npm-install-onward boundary)** — DOC-06's wording invites two readings; chose the one that measures user-felt friction, not GitHub-runner network speed.
4. **D-17 + D-18 (build-time gen + parity test)** — the right pattern when two surfaces (MCP tool + markdown doc) share a TS source of truth.

## Deferred Ideas

13 deferred items captured in `05-CONTEXT.md` §Deferred Ideas. Highlights:
- `recovery-ledger install-launchd` CLI command (D-16 rationale; revisit post-v1 if `sed` dance is fiddly)
- Per-check exit-code sub-codes (D-04 rationale; revisit when a consumer emerges)
- systemd user-timer template — REQUIREMENTS V2-03
- Doctor `--watch` mode + HTML output (out of scope per scope guardrail)
- WHOOP webhook receiver (Phase 3 D-12 ruled webhooks out of v1)
- Per-resource API quota dashboards (`doctor --quota` future flag)
- `recovery-ledger reset auth` (Phase 2 deferred; still deferred)
- AES-256-GCM passphrase-derived file fallback (Phase 2 deferred; still deferred)
- `learnings.md` entry for the grep-criterion-in-comments pattern (5th time in a row across Phases 1–4; if Phase 5 makes it 6, it becomes load-bearing)
