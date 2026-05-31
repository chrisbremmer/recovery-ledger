# Feature Landscape: v1.1 Quality Hardening

**Domain:** Personal local-first WHOOP CLI/MCP tool (single user, Chris)
**Researched:** 2026-05-31
**Source:** GitHub issues #75-#95 (all `code-review`-labelled)
**Framing:** No new features — every "feature" below is a hardening of an existing v1.0 surface. Categories framed as **user-visible** (Chris notices on next use) vs **invisible-but-load-bearing** (enables future work, prevents latent failure).

---

## Per-Issue User Impact Map

| # | Sev | User-observable failure mode | Observable? | Behavioural change of fix? |
|---|-----|------------------------------|-------------|----------------------------|
| 75 | HIGH | `whoop_query_cache resource=sync_runs status=aborted` throws Zod type error instead of returning the crash-recovered row. Doctor/MCP silently report empty for the row Chris is trying to investigate. | yes (latent) | invisible until first aborted row is queried; then visible (rows appear instead of error) |
| 76 | HIGH | Silent corruption: baselines/medians for sleep efficiency + workout strain include DST-straddling rows the schema promised to exclude. Daily review's "trailing 30d baseline" is subtly wrong. | yes (silent) | yes — medians shift after fix |
| 77 | HIGH | One hand-crafted/migration-corrupt row makes the entire `byRange` query throw, blanking the daily/weekly review table. | yes (catastrophic when triggered) | yes — bad writes rejected at SQL layer instead of read time |
| 78 | HIGH (security) | Camel-case tokens (`accessToken`, `refreshToken`, `clientSecret`) emitted verbatim in any error containing the stored-tokens blob — landing in CLI stderr, MCP responses, or pasted bug reports. | yes (when an error path fires) | invisible on happy path; redaction visible only in error output |
| 79 | HIGH (security) | `recovery-ledger doctor` prints a raw `Bearer <live-token>` excerpt on `whoop_roundtrip` failure. `doctor 2>&1 \| jq` or screenshot leaks the live token. | yes (on probe failure) | output redacted |
| 80 | HIGH (correctness) | `--since "2026-02-30"` or `"03/01/2026"` silently misinterpreted; sync fetches wrong window, mis-classifies WHOOP 400 as `partial_5xx`. | yes (silent wrong data) | yes — previously-accepted inputs now rejected with clear error |
| 81 | HIGH (reliability) | Doctor → fix → retry loop after a migration failure sees `SQLITE_BUSY` until process exit. Today masked because MCP `process.exit(1)`s. | invisible today, visible to retry callers | invisible to current CLI; enables retry semantics |
| 82 | HIGH (correctness) | Long backfill sync gets flipped to `aborted` mid-flight by an MCP server bootstrap; daily review shows hollow data and inconsistent history after laptop sleep/wake or NTP drift. | yes (silent wrong data after suspend/resume) | yes — fewer false aborts; clock-injection actually works in tests |
| 83 | HIGH (reliability) | `recovery-ledger doctor --stress` wedges indefinitely on hung child; only ^C escapes. CI hangs to 10-min timeout. | yes (UX hang) | yes — bounded failure with `fail` status within ~35s |
| 84 | HIGH (arch) | None to user. Tests cannot instantiate WHOOP client without dragging in production token-store singleton (reads keyring/lockfile at module load). | invisible | none to user |
| 85 | HIGH (arch) | None to user. Same shape as #84 — singletons constructed at import time bypass `bootstrap()` composition root. | invisible | none to user |
| 86 | HIGH (testing) | None today. Future regression: removed `aborted`-skip filter from `latestFinished()` passes all tests; user sees a non-outcome on review the morning after a crash. Or: broken `.node` binary install gets green doctor check. | invisible until regression slips | none directly; reduces future regression risk |
| 87 | MED (sec/rel) | Single disk-full / EROFS / keyring-flake during refresh permanently revokes the refresh family → user must re-run `recovery-ledger auth`. | yes (rare, catastrophic when it bites) | yes — clearer error message ("re-auth needed"); no silent re-presentation of stale token |
| 88 | MED (data) | A `decision update` against a typo'd id silently no-ops; Chris thinks the follow-up is recorded. Decisions are explicitly irreplaceable. | yes (silent) | yes — typed `DecisionNotFound` surfaces missing id |
| 89 | MED (correctness) | `AuthError` vs `WhoopApiError` produce two different remediation strings ("run auth" vs "roundtrip failed") for the same "token dead" condition. Chris has to read both possibilities to diagnose. | yes (mild confusion) | yes — uniform remediation message |
| 90 | MED (sec/std) | None to user today. Risk: a future module bypasses `callWithAuth` via `const f = globalThis.fetch` and emits raw GETs without rate-limit/refresh discipline (ADR-0007 violation). | invisible today | none to user; tightens CI gate |
| 91 | MED (reliability) | Under MCP-up + CLI-sync + doctor concurrency, 5th caller blocks behind 4 stuck pre-aborts: 30s + N·30s before its fetch starts. | yes (rare hang under fanout) | yes — bounded slot-wait |
| 92 | MED (arch) | Latent: someone adds an `AuthError.kind` in one path and forgets the other; `instanceof` fails silently. | invisible until it bites | none today; eliminates a future foot-gun |
| 93 | MED (arch) | None to user. ~200 LOC of duplicated bootstrap-error boilerplate across 8 CLI commands; new bootstrap-failure modes require 8-file edits. | invisible | none to user |
| 94 | MED (reliability) | WAL grows toward 64 MiB ceiling silently under MCP-up + CLI-sync; `db_wal_size` doctor probe surfaces consequence but user has to correlate. | yes (eventual) | yes — flag bubbles up via `sync_runs.flags` |
| 95 | LOW (tracker) | Mixed bag — see breakdown below. Several items security/data-integrity, others pure refactor. | mixed | mixed |

---

## Quality-Feature Categories

### 1. Secret hygiene — *user-visible: no live tokens leak into terminal / bug reports*

| Issue | Surface |
|-------|---------|
| #78 | Sanitizer covers camelCase token keys |
| #79 | `whoop_roundtrip` probe sanitizes `err.message` before render |
| #95: `init.ts` raw `String(err)` | Init failure error path |
| #95: token-store `mkdir` mode 0o700 | Token dir perms hardened |
| #95: Pino fatal in mcp/index.ts | `serializeError` output sanitized |
| #95: Gate A tone regex morphology | (tangential — ADR-0005 enforcement) |

**Dependencies:** #79 is independent of #78. Both should land before #87 (refresh-burn error message) which surfaces sanitized output.

### 2. Data integrity at the DB layer — *user-visible: medians / baselines / `aborted` rows actually match what the schema promises*

| Issue | Guarantee |
|-------|-----------|
| #75 | `aborted` carried end-to-end in Zod entity + cache types |
| #76 | sleeps/workouts `byRange` actually honour `baseline_excluded` via cycle JOIN |
| #77 | CHECK constraints enforce `score_state` discriminated union at SQL write time |
| #88 | `decisions.updateOutcome` surfaces missing-id instead of silent no-op |
| #94 | `wal_checkpoint(TRUNCATE)` failures escalate to sync-run flag |
| #95: body_measurements REAL == | Quantize floats to avoid duplicate inserts |
| #95: decisions/sync_runs indexes | Covering indexes for hot queries |
| #95: DST detector silent bail | Either exclude-as-suspect or contract test |

**Dependencies (load-bearing):**
- **#77 (CHECK constraints) depends on #75 (`aborted` enum drift)** — adding a CHECK that references `score_state` while the enum and Zod surface still disagree on `aborted` invites a migration that rejects valid v1.0 rows. Fix #75 first.
- **#76 (baseline JOIN) and #95 recovery-includeExcluded item are siblings** — the includeExcluded opt-in path should still JOIN the cycles table; touch both in the same PR.
- **#88 is independent.**

### 3. Error-message coherence — *user-visible: one condition → one remediation string*

| Issue | Improvement |
|-------|-------------|
| #87 | Refresh-write failure → loud "rotated tokens received but write failed — run `recovery-ledger auth`" |
| #89 | `AuthError` and `WhoopApiError(401)` produce the same "run auth" doctor branch |

**Dependencies:** #87 and #89 both surface auth-failure messages; align wording in the same pass. Both depend on #78 / #79 (sanitizer) being correct so the harmonised messages don't leak tokens.

### 4. Lifecycle / resource safety — *user-visible: no hangs, no leaked handles, no false-aborted in-flight syncs*

| Issue | Failure removed |
|-------|-----------------|
| #81 | SQLite handle closed on migrate failure |
| #82 | Stale-running reclassify uses injected clock + safer threshold; PID-liveness gate |
| #83 | `concurrent_writers_stress` watchdog + parent SIGINT propagation + regression test |
| #91 | `AbortSignal` propagated to rate-limit `acquire()` |
| #95: rate-limit abort-during-throttle leak | `granted` gate on listener |
| #95: rate-limit inFlight pre-bump | Move increment after wait/resolve decision |
| #95: bootstrap try/catch around reclassifyStaleRunning | Non-fatal sweep |
| #95: OAuth callback server `.unref()` | SIGINT between listen and callback frees loop |
| #95: Pino `flush()` at sync start + signal handlers | Buffered logs survive SIGKILL/OOM |

**Dependencies:** #91 (AbortSignal) conflicts with nothing. #82 depends on #75 being resolved (the `aborted` status type drift must be fixed before reclassifyStaleRunning's reclassification semantics are tightened, or the test seam can't assert on Zod-parsed rows).

### 5. CLI input validation — *user-visible: previously-accepted inputs now rejected with a clear error*

| Issue | Change |
|-------|--------|
| #80 | `--since` requires strict ISO 8601 (`YYYY-MM-DD` or `…Z`) with calendar round-trip |
| #95: `decisions.findByPrefix` min-length | Reject `prefix.length < 4` |

**Dependencies:** #80 is independent. **Note:** behavioural break — any user (Chris) who's been passing `2026-02-30` or `03/01/2026` will see a new error. Acceptable for v1.1; surface in release notes.

### 6. Architectural hygiene — *invisible to user; enables future test seams and Phase-N work*

| Issue | Refactor |
|-------|----------|
| #84 | `client.ts` no longer imports from `services/`; DI for `callWithAuth` |
| #85 | `tokenStore` + `refreshOrchestrator` wired inside `bootstrap()` |
| #92 | Single import path for `AuthError` / `MigrationError` (domain only); drop infra re-exports |
| #93 | `withBootstrap()` helper consolidates ~200 LOC of CLI shim boilerplate |
| #95: bootstrap.ts WHOOP probe wiring | Relocate `productionWhoopFetcher` |
| #95: services/index.ts barrel/policy split | `contracts.ts` + `factory.ts` |
| #95: doctor required-deps DI | Match non-doctor services |
| #95: transports → domain/observability sanitize | Layer fix |
| #95: api-gap promote catalog to domain | De-over-structuring |
| #95: RunDoctorOptions split | Flags vs deps vs seams |
| #95: refresh-orchestrator placement | Resolves if #84 lands first |

**Dependencies (load-bearing):**
- **#85 depends on #84** — inverting `client.ts`'s dependency on services is a prereq for moving `refreshOrchestrator` into bootstrap-wired DI. Land #84 first.
- **#92 depends on neither but is cheaper after #93** — codemodding imports while `withBootstrap` is being introduced lets both passes hit the same 8 CLI files once.
- **#95's "refresh-orchestrator placement" item explicitly notes it resolves after #84.**

### 7. Test coverage hardening — *invisible; regression net for the categories above*

| Issue | Regression covered |
|-------|--------------------|
| #86 | `latestFinished()` `aborted`-skip test + `native_modules` failure-path tests |
| #90 | Gate F regex / Biome `noRestrictedGlobals` for `fetch` alias bypass |
| #95: FDR no-reliable-pattern end-to-end | Integration gap fdr.test ↔ weekly-review |
| #95: refresh-orchestrator behavioral assertions | Soften call-count coupling |
| #95: DST fixture hard-coded ids | Drop dynamic lookup |
| #95: stopwatch env-gate guard | "at least one test ran" |
| #95: auth-concurrency tighter assertion | `toMatch(/^fresh-\d+$/)` |
| #95: concurrent_writers_stress regex | Decouple from literal constants |
| #95: doctor/index.test detail regex | Assert detail, not just status |
| #95: body_measurements concurrent-readers test | BEGIN IMMEDIATE serialization invariant |

**Dependencies:** #86's `latestFinished()` test depends on #75 (cannot insert an `aborted` row through the typed repo until the Zod enum is widened). #90 depends on nothing. The rest of #95 testing items are independent.

---

## Anti-Features (do NOT build in v1.1)

| Anti-feature | Why avoid |
|--------------|-----------|
| New WHOOP endpoints / resources | v1.1 is hardening only; scope guardrail is unmet |
| New MCP tools or prompts | Same — quality only |
| Telemetry / usage metrics | Local-first principle; not a v1.1 ask |
| Auto-rotation of OAuth on schedule | #87 fix is the *message*, not silent recovery; user should re-auth |
| Multi-process locking beyond proper-lockfile | ADR-0002 is sufficient for single-user |

---

## MVP-equivalent priority for v1.1 (for the roadmapper)

**Tier 1 — security/correctness must-ship (block release):** #78, #79, #80, #75, #76, #77, #82, #87
**Tier 2 — reliability gates:** #81, #83, #91, #94, #88, #89
**Tier 3 — architectural unlocks (one-time pain):** #84 → then #85, #92, #93
**Tier 4 — regression net:** #86, #90, #95-test-items
**Tier 5 — #95 backlog drain:** opportunistic, batched into theme PRs

---

## Cross-category dependency summary

```
#75 (enum drift) ──► #77 (CHECK constraints)
                 ╰─► #82 (reclassify tests)
                 ╰─► #86 (latestFinished test)
#84 (layer)      ──► #85 (singletons)
                 ╰─► #95 refresh-orchestrator placement
#78, #79 (sanitize) ──► #87, #89 (auth message coherence)
```

All other issue pairs are independent and can ship in any order.

---

## Sources

- GitHub issues #75-#95 (all retrieved via `gh issue view` 2026-05-31)
- `/Users/chris.bremmer/recovery-ledger/.planning/PROJECT.md`
- ADRs 0001-0007 (`/Users/chris.bremmer/recovery-ledger/agent_docs/decisions/`)
