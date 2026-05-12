# Pitfalls Research

**Domain:** Local-first TypeScript CLI + MCP server consuming WHOOP API v2 (single-user personal recovery analytics)
**Researched:** 2026-05-11
**Confidence:** HIGH for WHOOP API, MCP, SQLite, OAuth pitfalls (Context7 + official docs + multiple corroborating community sources); MEDIUM for behavioral / retention pitfalls (peer-reviewed reviews + community evidence, but Chris-specific factors unknowable in advance); MEDIUM for small-sample statistics (textbook math is settled, but the "right" thresholds for HRV/RHR are project judgment calls).

This document lists pitfalls SPECIFIC to Recovery Ledger. Generic "write tests" / "handle errors" advice is omitted — assume that's already covered by the Vitest fixture-based contract test requirement and the `doctor` command. Pitfalls are ordered by severity within each section, and every pitfall maps to a roadmap phase that owns its prevention.

---

## Critical Pitfalls

### Pitfall 1: stdout-corrupted MCP stdio transport

**Severity:** HIGH
**What goes wrong:**
The MCP stdio transport multiplexes the protocol over stdin/stdout. A single stray `console.log("syncing day 3...")` corrupts the JSON-RPC stream and the server appears broken in Claude Desktop and Claude Code with no useful error — just "server disconnected" or a cryptic JSON parse failure. This is the single most common failure mode in real-world stdio MCP servers.

**Why it happens:**
Standard TypeScript habits (`console.log`, `process.stdout.write`, libraries that log to stdout by default — undici warnings, deprecation notices, source-map-support, `dotenv`, `debug` if `DEBUG_FD=1`, even Node's `--inspect` banner) all silently corrupt the protocol. Worse, the corruption is intermittent and depends on which tools are called.

**How to avoid:**
- Centralize logging through a `logger` module that writes to stderr only (`console.error` or pino with `destination: 2`).
- Add a lint rule (`no-console` allowing only `console.error`) and a Vitest assertion that the server's stdout, during a fixture round-trip, contains only valid JSON-RPC frames.
- In `doctor`, run a self-check: spawn the MCP server as a subprocess, send a `tools/list` request, and assert stdout contains nothing but well-formed JSON-RPC.
- Suppress noisy library logs explicitly: set `NODE_NO_WARNINGS=1` and route `undici` / `better-sqlite3` verbose output to stderr.
- Never call `dotenv.config()` without `{ debug: false }`; never use `node --inspect` for MCP entrypoint.

**Warning signs:**
- Claude Desktop shows "Server crashed" or the tool list is empty when the server "looks fine" running standalone.
- `npx @modelcontextprotocol/inspector` shows unparseable lines in the message log.
- The server works on first call but breaks after a tool runs that triggers a deprecation warning.

**Phase to address:** Phase 1 (MCP server skeleton) — bake the logger + stdout-purity test in BEFORE writing any tool.

---

### Pitfall 2: Concurrent OAuth refresh corrupting the refresh-token family

**Severity:** HIGH
**What goes wrong:**
WHOOP rotates refresh tokens — every call to `/oauth/oauth2/token` invalidates the prior access token AND the prior refresh token. If two concurrent requests (e.g., `whoop_sync` running in the CLI while Claude calls `whoop_daily_review` via MCP) both detect 401 and refresh, the second refresh uses an already-consumed refresh token. WHOOP treats this as RFC 6819 §5.2.2.3 reuse detection and may revoke the entire token family. The user gets a forced re-OAuth and loses trust ("the auth is brittle").

**Why it happens:**
Two processes (CLI + MCP server) can hold the same token file open. Even within one process, two parallel `fetch` calls to different WHOOP resources can race. The official WHOOP docs explicitly warn: "Existing access tokens are invalidated once your app uses the refresh token to generate a new access token. Implement background refresh jobs to avoid concurrent refresh request failures."

**How to avoid:**
- **Single-flight refresh inside one process**: cache the in-flight refresh `Promise` in a module-level variable; concurrent callers `await` the same promise.
- **Cross-process single-flight via SQLite advisory lock**: before refreshing, acquire a row-level lock (`BEGIN IMMEDIATE` + write to `oauth_refresh_lock` table with timestamp + holder PID). Other processes wait up to N seconds, then re-read the token file (the holder will have written the new tokens before releasing).
- **Grace window after refresh**: persist `last_refreshed_at`. If another process sees `last_refreshed_at < now - 5s`, do NOT refresh — just re-read the on-disk tokens and try again.
- **Refresh proactively, not reactively**: refresh at ~80% of `expires_in` from a single owner (the sync flow), not lazily on 401.

**Warning signs:**
- `invalid_grant` or `refresh_token_reused` error from WHOOP.
- The user is forced to re-OAuth more than once a week.
- Two simultaneous syncs both succeed but only one is authenticated afterward.

**Phase to address:** Phase 2 (OAuth + token storage). This MUST be in place before MCP tools that call WHOOP exist, otherwise the first concurrent invocation will burn the token family.

---

### Pitfall 3: Silently consuming PENDING_SCORE / UNSCORABLE records as if they were scored

**Severity:** HIGH
**What goes wrong:**
WHOOP recovery, sleep, and workout records carry a `score_state` field with three values: `SCORED`, `PENDING_SCORE`, `UNSCORABLE`. A `PENDING_SCORE` record has no score yet — it will get one in minutes-to-hours. An `UNSCORABLE` record (e.g., the watch was off the wrist during the night) will NEVER get a score. If the analytics pipeline reads `record.score.recovery_score` without checking `score_state`, it reads `null` / `undefined` (or worse, a zero) and treats that as a 0% recovery day. The daily brief now says "your recovery is catastrophic" — which destroys trust faster than any other failure mode.

**Why it happens:**
Field nullability is easy to miss in Zod schemas that mark `score` as optional. Most tutorial code paths only show `SCORED` examples.

**How to avoid:**
- Zod schemas treat `score` as `discriminatedUnion('score_state', …)` so the type system forces handling all three states.
- The local SQLite cache stores `score_state` as a first-class indexed column, not buried inside a JSON blob.
- The sync flow re-fetches records still in `PENDING_SCORE` on the next sync (don't assume immutability for non-SCORED records).
- All review/baseline queries filter on `score_state = 'SCORED'` at the SQL level, never in TS — make it a default in a query helper, with a separate `includeUnscored: true` opt-in for data-quality views.
- The `data-quality` resource surfaces counts of PENDING / UNSCORABLE days transparently.
- Daily review text: when fewer than N SCORED days exist in the trailing window, output "insufficient scored data" — never invent a number.

**Warning signs:**
- A user-visible "recovery score: 0%" with no warning context.
- Trailing-30-day average that drops sharply when a single UNSCORABLE day is included.
- Test suite passes because fixtures contain only SCORED records.

**Phase to address:** Phase 3 (data model + sync). The score_state discriminator must be in the schema before any analytics code touches recovery/sleep/workout records.

---

### Pitfall 4: Storing OAuth tokens in plaintext SQLite

**Severity:** HIGH
**What goes wrong:**
WHOOP access + refresh tokens land in `~/.recovery-ledger/db.sqlite` as plaintext columns. Any process running as Chris's user (a malicious npm postinstall script, an MCP server from a different project, the Time Machine backup he forgets about) can read them. Refresh tokens grant 30+ days of full WHOOP read access; they don't expire on the user's session ending.

**Why it happens:**
"Local-first" gets conflated with "secure" — but local-first only means the data lives on the user's machine, not that the data is protected from other local processes. Plaintext SQLite is the path of least resistance.

**How to avoid:**
- Use the OS keychain via `keytar` (or its maintained fork `@napi-rs/keyring`): macOS Keychain, Linux libsecret, Windows Credential Vault. Tokens live OUTSIDE the SQLite file.
- Fall back to a file with restrictive permissions (`chmod 600`) only if the keychain is genuinely unavailable (CI, headless Linux without libsecret) — and warn loudly in `doctor`.
- Never log tokens. Add a redaction layer in the logger that masks anything matching the WHOOP token shape and the `Authorization:` header pattern, applied at log-emit time, not at log-call time.
- Make MCP tool error returns sanitize before serializing — a stack trace from `fetch` can leak `Authorization` headers via Node's `--enable-source-maps` output.
- `doctor` reports `auth: keychain` vs `auth: plaintext-file` so a regression is visible.

**Warning signs:**
- Token-shaped strings in log files (`grep -r 'eyJ' ~/.recovery-ledger/logs`).
- An MCP tool error message that contains the full request URL with embedded auth.
- A token file readable by `chmod 644`.

**Phase to address:** Phase 2 (OAuth + token storage). Must precede any phase that issues a real API call.

---

### Pitfall 5: Inventing patterns from too-small samples (the "fake insight" trap)

**Severity:** HIGH
**What goes wrong:**
Chris had three "bad recovery" days this month, and on two of them he drank wine the night before. Recovery Ledger reports: "Pattern detected: alcohol reduces your recovery." That's a fake correlation from N=3 — and once Chris sees one of these and verifies it's nonsense, the entire tool's credibility collapses. This is the single biggest threat to retention.

**Why it happens:**
- Small samples + many candidate predictors (sleep, alcohol, late training, screen time, food, stress, illness) → multiple-comparisons problem. With 20 candidate predictors at p=0.05, P(≥1 false positive) ≈ 64%.
- HRV and RHR are heavy-tailed and noisy; Z-scores assume normality and inflate "anomaly" rates.
- 30 days has fewer than 5 weekends, so any weekend-vs-weekday split is statistically empty.

**How to avoid:**
- **Hard minimums for "pattern detected" language**: require ≥14 SCORED days in baseline AND ≥6 paired observations of the candidate factor (i.e., 6 nights with the supposed cause AND 6 without). Below that, output "no reliable pattern detected — insufficient paired observations."
- **Median + MAD over mean + SD** for baselines on HRV, RHR, sleep-onset latency, sleep-need-met. These are heavy-tailed; SD is dominated by 1-2 outliers (a stomach bug, a flight). MAD scaled by 1.4826 is the robust analogue and resists outliers natively.
- **Restrict candidate-factor scanning**: weekly review should NOT scan an open-ended factor list. Pick ≤5 pre-registered factors at design time (sleep duration, sleep consistency, prior-day strain, time-since-last-rest-day, day-of-week). Anything else is hypothesis-generating only, gated behind explicit phrasing ("possible signal, not confirmed").
- **Apply a Benjamini-Hochberg FDR correction** when multiple factors are tested in a single review, even cheaply. q=0.10 is fine for this domain.
- **Phrase three tiers consistently across the codebase**:
  - "strong pattern" → ≥6 paired obs, effect ≥1.5 MAD, FDR-adjusted q<0.10
  - "weak signal" → meets effect threshold but fails sample or FDR
  - "no reliable pattern detected" → everything else
- **Refuse to compute Z-scores on <14 days** of baseline. Surface "establishing baseline (day X of 14)."
- **Treat travel / DST / illness gaps as exclusions**, not anomalies (see Pitfall 6).

**Warning signs:**
- The daily brief uses the word "because" anywhere it isn't followed by a sample-size citation.
- A "pattern" appears one day, disappears the next, reappears a week later.
- Chris reads a recommendation and his honest reaction is "that's not why."
- Test fixtures produce "strong pattern" results from <14-day samples.

**Phase to address:** Phase 4 (analytics + review). Build the sample-size guards BEFORE the first review tool exists, not bolted on later.

---

### Pitfall 6: DST, travel, and time-zone shifts corrupting "day strain" and "sleep duration" comparisons

**Severity:** HIGH
**What goes wrong:**
WHOOP organizes data into Physiological Cycles, not calendar days. A cycle can span a DST boundary or a time-zone change while traveling. Naively grouping cycles by `calendar_date_local` produces 23-hour or 25-hour days, and naive sleep-duration arithmetic on the cycle's start/end produces phantom +/- 60 minutes. Chris flies SFO→JFK once and the next four days show "sleep deficit accumulating."

**Why it happens:**
The cycle object's `timezone_offset` captures the offset *at recording time*. If the user crossed time zones mid-cycle, the offset on one cycle doesn't match the next. Plus, WHOOP says "past cycle start and end times may change for a few days as WHOOP learns more about what the member is doing" — so historical cycles aren't immutable.

**How to avoid:**
- Store `start`, `end`, AND `timezone_offset` as raw fields. Compute durations from the UTC instants (`Date(end) - Date(start)`), never from local-time arithmetic.
- When grouping by "day," default to the cycle's `timezone_offset` (the local calendar day at the time of measurement) and document this. Add a "force UTC" alternate for users who want it.
- Flag any cycle where `start` and `end` straddle a DST transition or differ in offset from the adjacent cycle by >0; surface in the data-quality resource as "tz-shift day."
- Treat tz-shift / DST cycles as **excluded** from the baseline pool, but visible in raw views. Chris's normal baseline shouldn't be polluted by travel.
- Always re-fetch records modified within the trailing 14 days (use `updated_at` from WHOOP). Don't trust historical cycles to be frozen.

**Warning signs:**
- "Sleep duration" on the second Sunday in March or the first Sunday in November looks anomalous by exactly ±60 minutes.
- A trip across ≥3 time zones produces a multi-day "recovery anomaly" cluster.
- Two consecutive cycles with the same `start_date` but different durations.

**Phase to address:** Phase 3 (data model + sync) for storage, Phase 4 (analytics) for exclusion logic.

---

### Pitfall 7: SQLite migration that fails mid-flight leaves an undiagnosable broken DB

**Severity:** HIGH
**What goes wrong:**
Drizzle Kit generates SQL migrations. SQLite has limited `ALTER TABLE` support, so non-trivial migrations expand into multi-step table-rename-and-copy patterns. If the migration crashes mid-step (power loss, OOM, the user `Ctrl-C`'s, or a Node version mismatch breaks `better-sqlite3` partway through), the database is in a half-migrated state. The next launch fails with `no such column` or `table X already exists`, and Chris has no recovery path.

**Why it happens:**
- Drizzle by default emits `--> statement-breakpoint` markers and runs each statement separately — only adjacent statements within a `BEGIN`/`COMMIT` are atomic.
- The WHOOP cache is large enough (months of history) that a rebuild-from-scratch sync is slow and re-burns rate limits.
- The user's first instinct is to delete the DB — losing the decision ledger, which is irreplaceable.

**How to avoid:**
- Wrap every migration in an explicit `BEGIN IMMEDIATE` … `COMMIT` so it's atomic, even when Drizzle splits statements.
- Before every migration, copy the SQLite file (with its `-wal` and `-shm` companions) to `db.sqlite.pre-<migration-id>.bak`. Keep the last 3 backups.
- Migrations must be idempotent at the schema level: use `IF NOT EXISTS` / `IF EXISTS` so partial application can be retried.
- Use Drizzle's migration tracking table (`__drizzle_migrations`) as the source of truth; the `doctor` command verifies it matches the on-disk schema.
- Separate the WHOOP cache (recoverable via re-sync) from the decision ledger (irreplaceable). Different tables in the same DB is fine; the backup strategy treats decisions as gold and cache as silver.
- On startup, if `__drizzle_migrations` is inconsistent with the schema (orphaned rows, missing rows), refuse to run and tell the user how to restore from the backup.

**Warning signs:**
- A user report of "I closed the terminal during sync and now it won't start."
- A migration test that drops mid-way works in isolation but not after `npm rebuild`.
- The `-wal` file is multiple GB after a crash (see Pitfall 12).

**Phase to address:** Phase 3 (data model + sync). Establish the migration discipline + backup-before-migrate before there's anything worth backing up.

---

### Pitfall 8: "Coach-y" tone destroys retention faster than bugs

**Severity:** HIGH (this is a product pitfall, not a technical one — but it's the single largest threat to retention)
**What goes wrong:**
The daily brief reads: "Your body is asking for rest 🧘 — listen to it! Today's a great day to prioritize self-care." Chris reads this three times, then stops opening the tool. Recovery Ledger fails not because the data is wrong but because the prose feels condescending.

**Why it happens:**
LLM-generated text drifts toward wellness-app cadence by default. "Optimize your recovery," "honor your body," and emoji-led headlines all sound polished but signal a tool that doesn't respect the reader.

**How to avoid:**
- Style charter (live in code, not in docs): no emoji in brief output. No second-person imperatives that aren't directly actionable ("do Zone 2 today" yes; "listen to your body" no). No words on the banned list: `optimize`, `wellness`, `honor`, `journey`, `crush`, `nail`, `dial in`, `tune`, `vibe`, `unlock`.
- All "decisions" are concrete and verb-first: "Do Zone 2 or mobility today" / "Cap strain at 12" / "Sleep target: 8:15 in bed by 22:30."
- Frame deficits non-morally: "sleep-debt signal, not a moral failure."
- Add a lint test on the LLM-prompt templates AND on the deterministic text outputs that fails on banned-word matches.
- Show, don't preach: include the actual numbers next to the recommendation. "HRV down 18% vs trailing 14-day median; do Zone 2" is better than any adjective-led version.

**Warning signs:**
- Chris's gut reaction to a daily brief is "ugh."
- Any output paragraph contains zero numbers.
- A test reviewer says "this sounds like a wellness app."

**Phase to address:** Phase 4 (review tool prompts + deterministic text outputs). Lock the style charter as a test, not a doc.

---

### Pitfall 9: Setup friction > 20 minutes = silent abandonment

**Severity:** HIGH (retention threat)
**What goes wrong:**
WHOOP requires the user to register a developer app, configure a redirect URI, copy a client ID and secret, run an OAuth dance via a local callback server, and complete a first sync. If any of those steps takes more than ~5 minutes to debug, Chris postpones, comes back two days later having forgotten where he was, and never finishes.

**Why it happens:**
- Each step has its own failure modes (redirect URI mismatch, scope error, callback port already in use, firewall blocking the loopback).
- The error messages from each layer (WHOOP, Node, the browser, the keychain) don't tell the user which step they're in.

**How to avoid:**
- `recovery-ledger init` runs a guided OAuth flow with a single command. It uses the loopback flow with a free local port (chosen at runtime, not hardcoded), pops the browser, and shows step-by-step status in the terminal ("✓ tokens stored, syncing…").
- `recovery-ledger doctor` is the universal "what's wrong" tool. It runs auth, token freshness, DB integrity, last-sync recency, MCP-server stdout purity, and data-quality checks; each has a one-line fix suggestion.
- The very first daily review runs AUTOMATICALLY at the end of `init`, so the success path includes seeing the value of the tool, not just "setup complete."
- Document the WHOOP developer app creation as a single-page checklist with screenshots, scoped to "the only fields you need to touch."
- A `--smoke-test` mode runs an end-to-end fixture sync (no live calls) so the user can verify install before OAuth.

**Warning signs:**
- A first-time user message that contains "I gave up" or "I'll try later."
- More than 3 doctor checks fail on a fresh install.
- Time from `git clone` to first daily review > 20 minutes (test this on a clean machine).

**Phase to address:** Phase 5 (UX polish) but the `init` + `doctor` commands need an MVP in Phase 1.

---

## Moderate Pitfalls

### Pitfall 10: WHOOP API pagination — cursor confusion, missing pages, ordering not guaranteed

**Severity:** MEDIUM
**What goes wrong:**
WHOOP's v2 pagination returns `next_token` (snake) in responses but expects `nextToken` (camel) as the request param. Code that round-trips the field name without translating misses every page after the first. Separately, ordering isn't documented as deterministic, so a naive "page until empty" loop can produce duplicates if records are inserted mid-pagination (rare but possible for recent days). Maximum page size is per-endpoint, not global.

**How to avoid:**
- Wrap pagination in a single utility that owns the snake↔camel translation, asserts on duplicate IDs across pages (signals a re-order mid-pagination), and respects per-endpoint max limits (look these up in `developer.whoop.com/api` per endpoint and pin them).
- Always paginate with a fixed `start`/`end` window; never combine open-ended pagination with "live" data.
- Deduplicate inserts via `INSERT … ON CONFLICT(id) DO UPDATE` keyed on UUID.

**Warning signs:**
- Sync claims success but trailing-day count is short.
- `__drizzle` query for duplicate UUIDs returns rows.

**Phase to address:** Phase 3 (sync).

---

### Pitfall 11: 429 rate limiting without honoring Retry-After / X-RateLimit headers

**Severity:** MEDIUM
**What goes wrong:**
WHOOP's documented limits are 100 req/min and 10,000 req/day. A naive `sync --days 180` fanning out parallel `fetch` calls across cycles, recovery, sleep, and workout endpoints can saturate the per-minute window. WHOOP returns 429 with no documented `Retry-After` header (per their docs page) — they DO provide `X-RateLimit-Remaining` and `X-RateLimit-Reset` (in seconds). Code that retries on a fixed backoff burns more quota than necessary and may incorrectly trip the daily limit.

**How to avoid:**
- Read `X-RateLimit-Remaining` after every successful response; throttle the next request when remaining < 10. On 429, sleep `X-RateLimit-Reset` seconds, then retry with jittered exponential backoff (capped attempts).
- Concurrency: keep a single in-process semaphore of, e.g., 4 simultaneous WHOOP fetches. Don't fire 200 cycles in parallel from `Promise.all`.
- Sync emits a structured progress report including remaining quota — the daily review can mention "WHOOP API quota: 8200/10000 used" in `doctor`.
- Persist a daily-quota counter locally so the sync can refuse to start if it would clearly overshoot.

**Warning signs:**
- A backfill operation gets ~50% through and stops with 429s.
- The daily-quota counter shows >9000 after a routine sync.

**Phase to address:** Phase 3 (sync).

---

### Pitfall 12: WAL file growing unboundedly (checkpoint starvation)

**Severity:** MEDIUM
**What goes wrong:**
SQLite's WAL file (`db.sqlite-wal`) appends every write transaction. Checkpoints fold the WAL back into the main DB but require a moment when no readers hold the WAL open. A long-running MCP server holds at least one read connection most of the time; the WAL file grows without bound. Eventually disk space or query performance degrades, and a `.bak` operation that copies the DB but not the WAL produces a corrupted backup.

**How to avoid:**
- Set `PRAGMA journal_size_limit = 67108864` (64 MB) and `PRAGMA wal_autocheckpoint = 1000` on every connection.
- After every sync, explicitly run `db.pragma('wal_checkpoint(TRUNCATE)')` to force the WAL back to size zero.
- Backups: always copy `db.sqlite`, `db.sqlite-wal`, AND `db.sqlite-shm` together, OR use SQLite's online backup API (`db.backup(path)` in `better-sqlite3`). Never `cp` just the `.sqlite` file.
- `doctor` checks WAL file size and warns if > 32 MB.

**Warning signs:**
- A `db.sqlite-wal` file larger than the main DB.
- Query times degrade over a session.

**Phase to address:** Phase 3 (DB layer).

---

### Pitfall 13: Multi-process writer contention — CLI sync running while MCP server is queried

**Severity:** MEDIUM
**What goes wrong:**
The CLI `recovery-ledger sync` is writing while Claude calls `whoop_daily_review` via the MCP server (which only reads). WAL handles reader-while-writer fine. BUT if the MCP server *also* writes (e.g., recording a decision via `whoop_add_decision` during sync), one of them gets `SQLITE_BUSY`. The MCP tool returns an opaque error to Claude; the user sees "tool failed."

**How to avoid:**
- Every connection: `PRAGMA busy_timeout = 5000` (5 seconds). This is necessary; it is not sufficient.
- All write transactions use `BEGIN IMMEDIATE`, never `BEGIN DEFERRED` (which is the default in better-sqlite3 and can upgrade mid-transaction, defeating the busy_timeout).
- Keep write transactions short. Sync should batch its writes per-resource, commit, release, repeat — not hold a single transaction across an entire backfill.
- MCP tools that write (decision ledger only) retry once on `SQLITE_BUSY` after a short jittered delay before surfacing the error.
- `doctor` includes a "sync-while-querying" stress test.

**Warning signs:**
- An MCP tool error with `SQLITE_BUSY` in the stack.
- A `whoop_add_decision` call that fails sporadically during sync.

**Phase to address:** Phase 3 (DB layer).

---

### Pitfall 14: Zod-to-JSON-Schema conversion issues breaking MCP tool schemas

**Severity:** MEDIUM
**What goes wrong:**
The MCP TS SDK converts Zod schemas to JSON Schema for tool input descriptions. Known issues: (a) the SDK emits JSON Schema draft-07, while some clients expect draft-2020-12 — this can cause silent validation mismatches; (b) Zod 4 `.describe()` calls have been intermittently dropped, so Claude doesn't see parameter descriptions; (c) Zod transforms (`z.string().transform(...)`) are lost in conversion — they execute server-side but the schema Claude sees is the post-transform shape, leading to confusion.

**How to avoid:**
- Pin a known-good `@modelcontextprotocol/sdk` + Zod major version pair; document the combination in `package.json` resolutions. Don't auto-bump.
- Avoid Zod transforms in tool input schemas. Use `.refine()` for validation, then transform inside the tool body.
- Add a schema regression test that calls `tools/list` and asserts every parameter has a non-empty `description`.
- For complex schemas, drop to raw JSON Schema rather than relying on Zod conversion fidelity.
- Avoid `z.discriminatedUnion` in tool *inputs* (it doesn't always survive conversion); use it freely in internal validation.

**Warning signs:**
- Claude calls a tool with parameter names matching nothing the server defined.
- Tool descriptions in `tools/list` are empty strings.
- A unit test passes but Claude reports the tool's schema as "object with no properties."

**Phase to address:** Phase 1 (MCP skeleton) — bake the regression test in early.

---

### Pitfall 15: Webhooks-vs-polling decision: false economy of "real-time" for a daily-review tool

**Severity:** MEDIUM
**What goes wrong:**
WHOOP supports webhooks (`recovery.updated`, `sleep.updated`, etc.). It's tempting to build a webhook receiver for "real-time" data. But Recovery Ledger is local-first — there's no public HTTPS endpoint to deliver to. Adding ngrok/Cloudflare-tunnel to receive webhooks introduces infrastructure complexity, a new auth surface (webhook signatures), and a third-party dependency. For a once-or-twice-daily review loop, polling is correct.

**How to avoid:**
- v1: poll on `recovery-ledger sync`, called explicitly by the user or on cron/launchd. No webhook receiver.
- Use `updated_at` deltas: only re-fetch records whose `updated_at` is newer than the last sync. Always re-window the last 7 days regardless (catches retroactive WHOOP updates).
- Document the webhook option in the architecture doc as a deferred-with-rationale, not as a missing feature.

**Warning signs:**
- The roadmap acquires a "webhook receiver" task before the core loop is sticky.
- Discussion of "real-time" anywhere in product copy.

**Phase to address:** Phase 0 / scope guardrail — webhooks stay out of v1 by decision, not by accident.

---

### Pitfall 16: Storing WHOOP responses as opaque JSON blobs prevents efficient queries

**Severity:** MEDIUM
**What goes wrong:**
The temptation is to store each WHOOP record as `(id, raw_json TEXT)` and parse on read. This is fast to build but every analytics query becomes a full-table scan + JSON parse. Worse, schema evolution (a new WHOOP field appears, an old one disappears) is invisible — bugs surface only when a query happens to need the changed field.

**How to avoid:**
- Hybrid model: normalized columns for the fields used by analytics (`score_state`, `recovery_score`, `hrv_rmssd_milli`, `resting_heart_rate`, `sleep_performance_percentage`, `start`, `end`, `timezone_offset`, `updated_at`), PLUS a `raw_json` column for forward compatibility.
- Index the normalized columns used by review queries: `(score_state, start)` is the workhorse index.
- The Zod schema is the source of truth for what gets normalized; new fields surface as Zod validation warnings, not silent drops.
- For body composition / profile (low-volume, queried rarely), opaque JSON is fine.

**Warning signs:**
- Daily review query takes >100ms.
- A WHOOP-side field rename causes silent missing data instead of a loud failure.

**Phase to address:** Phase 3 (data model).

---

### Pitfall 17: Token leakage via MCP tool error returns and source-mapped stack traces

**Severity:** MEDIUM
**What goes wrong:**
A WHOOP fetch fails. The thrown `Error` has a `cause` containing the full `Request` including the `Authorization: Bearer …` header. The MCP tool returns the error message verbatim. Claude now has the token in its context — and in any logs Claude itself writes, and potentially in any subsequent conversation summary that gets shared. This is the worst case of token leakage because the attack surface includes the model.

**How to avoid:**
- All MCP tool error returns pass through a sanitizer that strips `Authorization` headers, request URLs containing tokens, and known token regex patterns.
- Errors returned to MCP clients are bounded — no full stack traces by default. Stack traces go to stderr (logs) only.
- The sanitizer is tested against a fixture of "errors that historically leak" (Node's `fetch` failure shapes, undici TypeError variants).
- Never include the raw HTTP request/response in error metadata for MCP returns.

**Warning signs:**
- An MCP tool error includes a URL with a query-string `access_token`.
- A stack trace returned to Claude contains the substring `Bearer`.

**Phase to address:** Phase 2 (OAuth) for the sanitizer, Phase 1 (MCP skeleton) for the error-shape contract.

---

### Pitfall 18: Decision ledger becomes a chore — friction kills the differentiator

**Severity:** MEDIUM (retention threat)
**What goes wrong:**
The decision ledger is the only thing Recovery Ledger has that WHOOP's own app doesn't. If recording a decision takes >30 seconds — pick a category, write a rationale, set a follow-up date, fill expected effect, etc. — Chris stops doing it. The tool then has nothing to evaluate decisions against and degenerates into a fancier WHOOP viewer.

**How to avoid:**
- One-shot decision form: `recovery-ledger decision add "do Zone 2 today" --because "HRV down 18%"` and that's it. Everything else is optional with smart defaults (follow-up = 3 days, expected effect = "improved next-day recovery").
- The daily brief proposes up to 3 candidate decisions and lets the user accept with single-key confirms via the MCP tool ("approve decision 1, edit decision 2, skip 3").
- Weekly review surfaces open decisions FROM Chris, not asks for new ones. "You said you'd do Zone 2 on Monday — did it help?"
- Track time-to-decision-add as an internal metric. If it ever exceeds 60s median, it's a bug.

**Warning signs:**
- A week with 0 decisions logged.
- A decision form with >3 required fields.

**Phase to address:** Phase 4 (review tools, decision UX).

---

### Pitfall 19: Subtle data wrong-ness from silent missing days

**Severity:** MEDIUM (retention threat)
**What goes wrong:**
Sync ran today but the laptop slept during the 2 AM cron, so yesterday's recovery score wasn't yet available — it's now `PENDING_SCORE` and the sync didn't re-fetch it. Tomorrow's daily review shows "yesterday: no data," with no explanation. Chris assumes the tool is broken.

**How to avoid:**
- Always re-sync the trailing N days (7 is a safe number) regardless of whether sync "ran today." Use `updated_at` deltas to keep this cheap.
- The data-quality resource (`whoop://data-quality`) lists missing/pending/unscorable days for the last 30 with one-line explanations.
- The daily brief leads with data freshness: "Synced 4 minutes ago. 30 of 30 trailing days scored." If any day is missing, say so before any insight.
- `doctor` flags "most-recent SCORED day > 36 hours old" as a sync-staleness warning.

**Warning signs:**
- A daily review that says "no data" without explaining why.
- Sync claims success but trailing-day SCORED count drops.

**Phase to address:** Phase 3 (sync) + Phase 4 (data-quality surfacing).

---

## Minor Pitfalls

### Pitfall 20: ESM/CJS + native-module rebuild combinatorics

**Severity:** LOW–MEDIUM
**What goes wrong:**
`better-sqlite3` is a native module. It's compiled against a specific Node ABI. If Chris installs with Bun and runs with Node (or vice versa), the ABI mismatches and the module fails to load. Also: a Node minor-version bump can require a rebuild. The project is ESM (Node 22, declared in `package.json`), and ESM imports of CJS-only types can be flaky.

**How to avoid:**
- Pin Node version in `.nvmrc` and `engines` in `package.json`. Document Bun compatibility separately if it's claimed.
- A `postinstall` script runs `npx --no-install electron-rebuild`-style rebuild or `npm rebuild better-sqlite3` to ensure ABI match.
- `doctor` checks the native module loads.
- All imports use `node:` prefix and explicit `.js` extensions; treat the project as pure ESM.

**Warning signs:**
- `Error: The module 'better_sqlite3.node' was compiled against a different Node.js version.`
- `ERR_MODULE_NOT_FOUND` on a relative import.

**Phase to address:** Phase 1 (project setup).

---

### Pitfall 21: tsx in dev vs compiled JS in prod divergence

**Severity:** LOW
**What goes wrong:**
Dev runs `tsx src/cli.ts`. Production install runs the compiled output from `dist/`. tsx is forgiving about a missing `.js` extension or top-level await; the compiled JS may not be. Bug works in dev, breaks for the user.

**How to avoid:**
- The default `npm test` runs against compiled output (`npm run build && node dist/...`), not tsx, at least for the entrypoint smoke test.
- Lock strict TS config: `"moduleResolution": "NodeNext"`, `"module": "NodeNext"`, no `tsx` magic resolutions allowed.

**Phase to address:** Phase 1 (project setup).

---

### Pitfall 22: Windows EOL / shebang issues on a `bin` entrypoint

**Severity:** LOW (Chris is on macOS; Windows support is post-v1)
**What goes wrong:**
The CLI shebang `#!/usr/bin/env node` is fine on macOS/Linux, breaks on Windows without `.cmd` shims, and a Git checkout on Windows that converts to CRLF mangles the shebang line.

**How to avoid:**
- Decision: defer Windows to post-v1 unless a real user appears.
- Add `.gitattributes`: `*.ts text eol=lf`, `bin/* text eol=lf`.
- `npm install -g` generates the proper `.cmd` shim; don't ship a hand-rolled one.

**Phase to address:** Phase 5 (UX polish) — only if Windows support is added.

---

## Technical Debt Patterns

Shortcuts that seem reasonable but create long-term problems.

| Shortcut | Immediate Benefit | Long-term Cost | When Acceptable |
|----------|-------------------|----------------|-----------------|
| Plaintext tokens in SQLite | "Ship today" | Token leakage, broken user trust | Never — keychain or restrictive-perm file from day one |
| Skip single-flight refresh | One fewer module | Token-family revocation, forced re-OAuth | Never |
| Store WHOOP records as opaque JSON only | Schema evolution "free" | Every query is full-scan + JSON parse | For low-volume tables (profile, body measurements) |
| Compute Z-scores on <14 days | Reviews work on day 1 | Phantom anomalies destroy trust | Never — show "establishing baseline" instead |
| Mean + SD instead of median + MAD | "Standard" statistics | Skewed by single outliers | Never for HRV/RHR/sleep |
| `console.log` to "see what's happening" in MCP code | Quick debugging | stdout corruption, mystery server crashes | Never — `console.error` only |
| Hand-roll the OAuth flow with a hardcoded port | Slightly less code | Port conflicts, abandoned init | Use a dynamically-selected free port |
| Skip `score_state` filtering "since it's usually SCORED" | One fewer WHERE clause | "Recovery: 0%" days destroy trust | Never — make filtering the default |
| Use Drizzle without atomic-migration wrapper | Faster prototype | Half-migrated DB = unrecoverable | Never for migrations that touch user data |
| Polling without honoring `X-RateLimit-Remaining` | One fewer header parse | 429s mid-backfill | Acceptable only if total sync size is bounded < 100 records |
| Single MCP tool returning "everything" | One fewer schema | Token blowout, slow tool calls | Acceptable only if outputSchema bounds the size |
| Use `BEGIN DEFERRED` (the better-sqlite3 default) | No code change | Mid-transaction upgrades cause `SQLITE_BUSY` | Read-only transactions only |

## Integration Gotchas

| Integration | Common Mistake | Correct Approach |
|-------------|----------------|------------------|
| WHOOP OAuth | Storing tokens in `.env` or plaintext file | OS keychain via `keytar` / `@napi-rs/keyring`; fallback to `chmod 600` file with loud warning |
| WHOOP pagination | Round-trip `next_token` as the request param | Translate to `nextToken` in a single utility |
| WHOOP score states | Read `record.score.recovery_score` unconditionally | Discriminated union on `score_state`; SQL filter on `'SCORED'` by default |
| WHOOP rate limits | Fixed-backoff retry on 429 | Honor `X-RateLimit-Reset` + in-process semaphore, max 4 parallel |
| WHOOP webhooks | Building a receiver for "real-time" | Skip in v1; poll with `updated_at` deltas + 7-day re-window |
| WHOOP v1→v2 IDs | Treat workout / sleep IDs as integers | UUIDs in v2; use the v1-migration endpoint to map historical IDs if needed |
| MCP stdio | Any `console.log` or stdout write | Stderr-only logging, lint rule, stdout-purity test |
| MCP tool schemas | Rely on Zod transforms surviving JSON-Schema conversion | Avoid transforms in inputs; pin SDK+Zod versions; assert descriptions in `tools/list` |
| MCP tool errors | Return raw Error.message | Sanitize before serializing (strip `Authorization`, token regexes) |
| MCP across clients | Assume Claude Code = Claude Desktop = Cursor | Test prompts in each; structured-content + text fallback is mandatory |
| Drizzle migrations | Run as Drizzle Kit emits them | Wrap in `BEGIN IMMEDIATE`; back up `.sqlite` + `-wal` + `-shm` before; assert `__drizzle_migrations` matches schema |
| better-sqlite3 across Node versions | Assume binary is portable | `npm rebuild` in postinstall; `doctor` verifies; pin Node via `.nvmrc` |
| Keychain access | Synchronous on hot path | Cache tokens in-process; only hit keychain on refresh |

## Performance Traps

| Trap | Symptoms | Prevention | When It Breaks |
|------|----------|------------|----------------|
| Unbounded WAL growth | `db.sqlite-wal` > main DB; slow queries late in session | `wal_autocheckpoint = 1000`; explicit `wal_checkpoint(TRUNCATE)` after sync | After ~10K writes if MCP server holds a long-lived read connection |
| JSON-blob-only storage | Daily review query > 100ms | Hybrid: normalize hot-path fields, keep raw_json for forward compat | After ~6 months of history (~180 records per resource × 4 resources) |
| Pagination without max-parallel | 429 storms; partial backfills | In-process semaphore (4 concurrent), honor `X-RateLimit-Remaining` | First time the user runs `sync --days 365` |
| Synchronous keychain on every request | Each MCP tool call latency +40ms | In-process token cache with `expires_at` check | Immediately — visible in any tool that makes >1 WHOOP call |
| Re-fetching all history on every sync | 429s; minutes-long sync | `updated_at` delta + bounded 7-day re-window | When history > 14 days |
| Unbounded structured content responses | Slow Claude tool calls; context blowout | `outputSchema` enforces bounded shapes; pagination on list-style tools | When trailing window > 90 days returned in one call |
| Open-ended candidate-factor scanning in weekly review | Tens of factors × tens of comparisons = false positives + slow review | Pre-registered factor list (≤5), FDR correction | Even at small scale — multiple comparisons starts at ~5 |

## Security Mistakes

| Mistake | Risk | Prevention |
|---------|------|------------|
| Plaintext tokens in SQLite | Any local process (npm postinstall script, malicious package, sibling MCP server) reads tokens | OS keychain; sensitive data outside the DB |
| Logging tokens by accident | Tokens in log files persist across re-OAuth | Redaction layer in logger; assertion test against token regex in stderr capture |
| Tokens in MCP tool error returns | Tokens enter the model's context, conversation logs, shared transcripts | Sanitizer on every MCP error path; bounded error messages |
| Tokens in stack traces with source maps | `--enable-source-maps` includes Request objects in cause chains | Strip `cause` from errors returned outside the process |
| Webhook signatures (if added later) not verified | Forged events corrupt state | HMAC-SHA256 timestamp + body check; reject if timestamp > 5 min old |
| OAuth callback on a fixed port | Port collision with another tool; or a different process listening | Bind to `127.0.0.1:0`, read the OS-assigned port, register that as the redirect URI dynamically — OR use `whoop://` deep-link redirect |
| Decision-ledger text logged to stderr | Personal health context in shared logs | Redact decision rationale fields before stderr emit |
| `doctor` output including tokens | User pastes diagnostic into a GitHub issue | Mask token-shaped strings in doctor output by default; explicit `--include-secrets` for local use |
| Backup file with same permissions as DB | World-readable history | `chmod 600` on `.bak` files; never `/tmp` backups |

## UX Pitfalls

| Pitfall | User Impact | Better Approach |
|---------|-------------|-----------------|
| Coach-y wellness-app tone | Chris loses respect for the tool; stops opening it | Style charter as test: banned-word list, no emoji, verb-first decisions, numbers next to every claim |
| Daily brief > 2 minutes to read | Brief becomes work; abandoned within a week | Hard length budget: ~120 tokens for the brief itself; expandable sections behind a follow-up tool call |
| "No data" without explanation | Tool feels broken | Always lead with data freshness; data-quality resource explains every gap |
| Setup > 20 minutes | Silent abandonment | Single `init` command, guided, with automatic smoke test on completion |
| Decision form with >3 required fields | Decisions stop being logged | One-line decision-add; smart defaults; daily brief proposes candidates |
| Spurious patterns from small samples | "This thing lies" — terminal trust loss | Hard minimums (≥14 SCORED days, ≥6 paired obs); MAD over SD; FDR correction; explicit three-tier confidence language |
| Hidden retroactive WHOOP changes | "I saw 84% yesterday, now it shows 79%" | Surface `updated_at` deltas in data-quality; re-window last 7 days on every sync |
| Tool returns walls of JSON to Claude in conversational mode | Claude's response gets crowded out by raw data | Text-fallback content is concise prose; structuredContent carries the data for programmatic flows |
| DST-day anomalies surfaced as "patterns" | Confidence-destroying false positives twice a year | Tag DST and tz-shift cycles as excluded from baseline |
| Decision review asks "did this work?" without context | Cognitive load; skipped | Pre-fill with the trailing-3-day recovery delta and link back to the original rationale |

## "Looks Done But Isn't" Checklist

Things that appear complete but are missing critical pieces. Each item is a verification gate, not a development task.

- [ ] **MCP server starts**: Boots in Claude Desktop AND Claude Code AND the MCP Inspector — three separate clients, each verified. Don't trust one client.
- [ ] **stdio stdout is JSON-only**: Run server under `mcp inspector` and confirm zero unparseable lines under load (sync + 5 tool calls).
- [ ] **OAuth flow**: Survives a forced refresh under concurrent CLI + MCP load — actually trigger two refreshes within 100ms in a test.
- [ ] **Token refresh single-flight**: Inject a 401 into a fake WHOOP and confirm exactly one refresh happens across 10 parallel callers.
- [ ] **Token storage**: Keychain on macOS by default; `doctor` reports it; never seen as plaintext in `db.sqlite`.
- [ ] **Token leakage**: Grep the entire log directory and stderr capture for `Bearer`, the token shape, the `Authorization` substring — must be zero matches.
- [ ] **score_state handling**: Test fixture includes one record of each state; baseline excludes non-SCORED; data-quality surfaces counts.
- [ ] **DST / tz-shift handling**: Fixture day on Mar / Nov DST boundary doesn't produce a phantom anomaly; tz-shift across 3+ zones marks cycles as excluded.
- [ ] **Retroactive WHOOP updates**: Fixture with a record whose `updated_at` is newer than its `created_at` round-trips through sync and updates the cache.
- [ ] **Pagination**: Fixture with >1 page exercises `next_token` → `nextToken` round-trip; duplicate-ID assertion fires when fixtures inject overlap.
- [ ] **Rate limiting**: Fixture returns 429 + `X-RateLimit-Reset`; sync sleeps the right duration; doesn't retry on a fixed backoff.
- [ ] **Migrations**: A test that crashes mid-migration (kill -9 between statements) is recoverable from the auto-backup.
- [ ] **WAL hygiene**: After 1000 fixture writes, `db.sqlite-wal` size < 32 MB; `doctor` warns if not.
- [ ] **Concurrent writers**: Test that runs sync + decision-add simultaneously — neither fails; busy_timeout + IMMEDIATE work.
- [ ] **Small-sample guard**: A fixture with 10 SCORED days produces "establishing baseline (day 10 of 14)" — not Z-scores.
- [ ] **Multiple-comparisons guard**: A fixture designed to trigger a false positive at p=0.05 is correctly downgraded by FDR.
- [ ] **Style charter**: Lint test on review output fails on any banned word; CI gates this.
- [ ] **Setup time**: Fresh-clone test on a stock macOS image (or container) hits a first daily review in <20 minutes.
- [ ] **Doctor**: Each documented failure mode produces a one-line diagnosis with a concrete fix.
- [ ] **API gap responses**: A query for ECG / BP / Healthspan / Journal returns a structured "unavailable via API" response, not a generic "not implemented."
- [ ] **MCP tool schemas in `tools/list`**: All parameters have descriptions; output schema validates; tested against draft-2020-12 if the client requires it.
- [ ] **MCP error sanitization**: An induced WHOOP 500 returns an MCP-side error that contains no auth headers, no URL with tokens, no source-mapped stack.

## Recovery Strategies

When pitfalls occur despite prevention, how to recover.

| Pitfall | Recovery Cost | Recovery Steps |
|---------|---------------|----------------|
| Token family revoked (concurrent refresh) | LOW | Force re-OAuth via `init`; document in `doctor` so user understands what happened |
| Plaintext tokens leaked to logs | MEDIUM | Revoke via WHOOP dashboard; rotate; redact / delete affected log files; ship a logger patch |
| stdout corruption breaks MCP server | LOW | Identify offender via inspector, replace with `console.error`; ship hotfix |
| Half-migrated DB | LOW–MEDIUM | Restore from auto-backup; re-run migration; if cache lost, re-sync (decisions are in a separately-backed-up area) |
| WAL file unbounded | LOW | `PRAGMA wal_checkpoint(TRUNCATE)`; tune autocheckpoint; document |
| Phantom anomalies in daily brief | HIGH (user trust) | Audit the rule that fired; raise the sample-size threshold; surface a self-correction in the next brief ("yesterday's 'pattern detected' was below threshold and should not have been shown") |
| Spurious DST-related "recovery drop" | MEDIUM | Tag the affected cycles as excluded; backfill the next baseline calc; explain to user in data-quality |
| WHOOP API schema change (new field, removed field) | LOW–MEDIUM | Zod schema flags it; surface in `api-gaps` resource; ship update without breaking historical data because raw_json is preserved |
| Sync gets stuck mid-backfill (429 or crash) | LOW | Resume from `last_synced_id` per resource; the next sync is idempotent via `ON CONFLICT DO UPDATE` |
| Decision ledger corrupted | HIGH (irreplaceable) | Restore from the decisions-only backup (separate from cache backup); investigate root cause; ship migration |
| Native-module ABI mismatch | LOW | `npm rebuild better-sqlite3`; `doctor` instructs user |

## Pitfall-to-Phase Mapping

How roadmap phases should address these pitfalls. Phase numbers correspond to a likely 5–6 phase split: Phase 0 (scope), Phase 1 (skeleton), Phase 2 (auth), Phase 3 (sync+data), Phase 4 (review+analytics), Phase 5 (UX+polish).

| # | Pitfall | Prevention Phase | Verification |
|---|---------|------------------|--------------|
| 1 | stdout-corrupted MCP transport | Phase 1 | Lint rule + Inspector-based stdout-purity test in CI |
| 2 | Concurrent OAuth refresh | Phase 2 | Fixture test: 10 parallel 401 responses trigger exactly one refresh |
| 3 | Silent PENDING/UNSCORABLE consumption | Phase 3 | Discriminated-union Zod schema + SQL filter test |
| 4 | Plaintext token storage | Phase 2 | `doctor` reports `auth: keychain`; grep test for tokens in `db.sqlite` |
| 5 | Fake-insight small-sample patterns | Phase 4 | Sample-size guards + FDR test + style-charter banned-word test |
| 6 | DST / tz-shift corruption | Phase 3 (storage) + Phase 4 (exclusion) | Fixture day on DST boundary + multi-tz trip — neither triggers anomaly |
| 7 | Mid-flight migration failure | Phase 3 | Crash-test mid-migration; auto-backup restores |
| 8 | Coach-y tone | Phase 4 | Banned-word lint on review templates; CI gate |
| 9 | >20-minute setup | Phase 1 (init MVP) + Phase 5 (polish) | Stopwatch test on clean machine; <20 min to first review |
| 10 | Pagination round-trip / ordering | Phase 3 | Multi-page fixture + duplicate-ID assertion |
| 11 | Rate limit handling | Phase 3 | Fixture with `X-RateLimit-Reset`; semaphore limits parallelism |
| 12 | WAL growth | Phase 3 | Post-sync WAL size assertion |
| 13 | SQLITE_BUSY under concurrent writers | Phase 3 | Stress test sync + decision-add simultaneously |
| 14 | Zod-to-JSON-Schema fidelity | Phase 1 | `tools/list` description assertion test; pinned versions |
| 15 | Webhooks complexity creep | Phase 0 / scope guardrail | Webhooks listed as deferred with rationale; not in active scope |
| 16 | JSON-blob-only storage | Phase 3 | Hybrid schema; query-performance test |
| 17 | Token leakage via errors | Phase 1 (error contract) + Phase 2 (sanitizer) | Induced error fixtures; token-regex grep |
| 18 | Decision ledger friction | Phase 4 | One-line decision-add; time-to-decision metric |
| 19 | Silent missing days | Phase 3 (sync) + Phase 4 (data-quality) | Trailing-day SCORED count surfaced in daily brief |
| 20 | ESM/CJS + native-module rebuild | Phase 1 | `doctor` loads native modules; `.nvmrc` pinned |
| 21 | tsx-vs-compiled divergence | Phase 1 | Smoke test runs compiled output |
| 22 | Windows EOL / shebang | Phase 5 (if Windows scope added) | `.gitattributes` + cross-platform CI |

## Sources

### WHOOP API (HIGH confidence)
- [WHOOP API Rate Limiting docs](https://developer.whoop.com/docs/developing/rate-limiting/) — 100 req/min, 10,000 req/day, X-RateLimit-* headers, no documented Retry-After.
- [WHOOP OAuth 2.0 docs](https://developer.whoop.com/docs/developing/oauth/) — token rotation behavior, "implement background refresh jobs to avoid concurrent refresh request failures."
- [WHOOP Pagination docs](https://developer.whoop.com/docs/developing/pagination/) — `next_token` returned vs `nextToken` parameter, cursor-based with per-endpoint max limits.
- [WHOOP Cycle docs](https://developer.whoop.com/docs/developing/user-data/cycle/) — Physiological Cycles vs calendar days, `timezone_offset`, retroactive updates via `updated_at`.
- [WHOOP v1→v2 Migration Guide](https://developer.whoop.com/docs/developing/v1-v2-migration/) — UUID vs integer IDs, endpoint path changes, score_state semantics.
- [WHOOP API Changelog](https://developer.whoop.com/docs/api-changelog/) — v1 webhooks removed; v2 GA July 2025.
- [WHOOP Webhooks docs](https://developer.whoop.com/docs/developing/webhooks/) — HMAC-SHA256 signatures, 5-retry-over-1-hour, event notifications only (must fetch data separately).
- [WHOOP Recovery docs](https://developer.whoop.com/docs/developing/user-data/recovery/) — score_state values, sleep-id UUID basis in v2.

### MCP (HIGH confidence)
- [MCP Specification 2025-06-18 — Tools](https://modelcontextprotocol.io/specification/2025-06-18/server/tools) — outputSchema, structuredContent + content array backwards compatibility.
- [MCP Debugging docs](https://modelcontextprotocol.io/docs/tools/debugging) — stderr logging requirement, stdout corruption.
- [MCP TS SDK GitHub Issues #745, #1143, #702](https://github.com/modelcontextprotocol/typescript-sdk/issues/745) — Zod-to-JSON-Schema draft mismatch, lost `.describe()`, lost transforms.
- [Claude Code MCP docs](https://code.claude.com/docs/en/mcp) — server spawn / teardown, prompts as slash commands.
- [MCP TS SDK Issue #1760](https://github.com/modelcontextprotocol/typescript-sdk/issues/1760) — refresh-token race condition.

### SQLite + Drizzle (HIGH confidence)
- [SQLite WAL docs](https://sqlite.org/wal.html) — checkpoint mechanics, recovery, auxiliary files.
- [better-sqlite3 WAL performance docs](https://github.com/WiseLibs/better-sqlite3/blob/master/docs/performance.md) — checkpoint starvation, multi-process usage.
- [SQLite "database is locked" guide](https://tenthousandmeters.com/blog/sqlite-concurrent-writes-and-database-is-locked-errors/) — `BEGIN IMMEDIATE`, busy_timeout.
- [Drizzle ORM Migrations docs](https://orm.drizzle.team/docs/migrations) — statement-breakpoint, SQLite-specific recreation patterns.
- [Drizzle casing issues #4392, #3094](https://github.com/drizzle-team/drizzle-orm/issues/4392) — camelCase/snake_case mapping bugs.

### OAuth / Security (HIGH confidence)
- [Auth0: Refresh Tokens and Reuse Detection](https://auth0.com/blog/refresh-tokens-what-are-they-and-when-to-use-them/) — single-flight, family revocation.
- [keytar GitHub](https://github.com/atom/node-keytar) — OS keychain bindings; macOS Keychain / libsecret / Credential Vault.

### Statistics (MEDIUM confidence — math is settled, project thresholds are judgment)
- [Wikipedia: Multiple comparisons problem](https://en.wikipedia.org/wiki/Multiple_comparisons_problem) — 5% per-test → 99.4% family-wise with 100 independent tests.
- [Wikipedia: Median absolute deviation](https://en.wikipedia.org/wiki/Median_absolute_deviation) — robust scale; 1.4826 scaling factor.
- [Caveats of using MAD (Akinshin)](https://aakinshin.net/posts/mad-caveats/) — small-sample bias correction.
- [PMC: Why and When to Avoid Z-scores](https://pmc.ncbi.nlm.nih.gov/articles/PMC12239870/) — normality assumption.
- [Kubios: HRV Normal Range](https://www.kubios.com/blog/heart-rate-variability-normal-range/) — ±10% of 30-day average heuristic.

### Retention / Behavioral (MEDIUM confidence)
- [PMC: Quantified Self Systematic Review](https://pmc.ncbi.nlm.nih.gov/articles/PMC8493454/) — abandonment patterns.
- [ScienceDirect: Wearable Activity Tracking Attrition](https://www.sciencedirect.com/science/article/abs/pii/S0747563219303127) — ~1/3 abandonment after a few months; motivation loss.

### Node / CLI / native modules (HIGH confidence)
- [TypeScript ESM/CJS Interop docs](https://www.typescriptlang.org/docs/handbook/modules/appendices/esm-cjs-interop.html)
- [better-sqlite3 issue #1015 (global CLI)](https://github.com/WiseLibs/better-sqlite3/issues/1015) — ABI mismatch via shebang.

---
*Pitfalls research for: Recovery Ledger (local-first TS CLI + MCP server on WHOOP API v2)*
*Researched: 2026-05-11*
