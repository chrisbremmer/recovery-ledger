# Troubleshooting Recovery Ledger

Each section below maps 1:1 to a check name printed by `recovery-ledger doctor`. When a check shows `[fail]` or `[warn]`, search this file for the literal check name (e.g., `Ctrl+F db_schema_version`). The order matches `recovery-ledger doctor`'s output.

## better_sqlite3_load

**Symptom:** `[fail] better_sqlite3_load — failed to load: ... — try \`npm rebuild better-sqlite3\``.

**Likely cause:** The native `better-sqlite3` binding did not load under the current Node ABI — prebuilt binaries are missing for your Node version, or a `node-gyp` compile failed during install.

**Fix:**

- Confirm Node 22.x: `node --version`.
- Rebuild the binding: `npm rebuild better-sqlite3`.
- If that fails, reinstall from clean: `rm -rf node_modules && npm install`.
- On a Linux box that compiles from source: install build deps (`sudo apt install build-essential python3` or your distro equivalent), then re-run `npm rebuild better-sqlite3`.

**See also:** [INSTALL.md](../../INSTALL.md) Prerequisites, [agent_docs/decisions/0006-fixture-only-tests.md](../../agent_docs/decisions/0006-fixture-only-tests.md).

## napi_keyring_load

**Symptom:** `[fail] napi_keyring_load — failed to load: ...`.

**Likely cause:** The `@napi-rs/keyring` native binding did not load. On Linux this is usually a missing `libsecret-1-dev`; on macOS it is a failed native-module compile.

**Fix:**

- macOS: `npm rebuild @napi-rs/keyring`.
- Linux: `sudo apt install libsecret-1-dev` then reinstall.
- If a system keychain is unavailable, fall back to the `chmod 600` file store — Recovery Ledger writes tokens to `~/.recovery-ledger/tokens.json` (mode 0600) per the file-fallback path.

**See also:** [agent_docs/decisions/0002-single-flight-oauth-refresh.md](../../agent_docs/decisions/0002-single-flight-oauth-refresh.md).

## mcp_stdout_purity

**Symptom:** `[fail] mcp_stdout_purity — non-JSON-RPC byte on stdout: ...`, `non-JSON-RPC frame on stdout: ...`, or `subprocess emitted no stdout frames before drain elapsed`.

**Likely cause:** A code path writes to `process.stdout` somewhere reachable from the MCP server, corrupting the JSON-RPC stream. Usually a stray `console.log` or `process.stdout.write` introduced in a recent change. The probe spawns `dist/mcp.mjs`, drives the JSON-RPC handshake, and asserts every line parses as JSON-RPC 2.0.

**Fix:**

- Run `bash scripts/ci-grep-gates.sh` and inspect Gate B (console.* outside `src/cli/**`) plus Gate C (`process.stdout.write` outside `src/cli/commands/**`). A failing gate is the regression.
- Rebuild and re-check: `npm run build` then `recovery-ledger doctor`.

**See also:** [agent_docs/decisions/0001-mcp-stdout-purity.md](../../agent_docs/decisions/0001-mcp-stdout-purity.md).

## auth

**Symptom:** `[fail] auth — no tokens — run \`recovery-ledger auth\`` or `[fail] auth — mode=<keychain|file> but tokens missing — run \`recovery-ledger auth\``.

**Likely cause:** No tokens are stored yet, or the token store reports a backend but the token blob is gone (deleted or moved). This check reads the store without contacting WHOOP, so it never triggers a refresh.

**Fix:**

- If config is also missing, run `recovery-ledger init` first.
- Run `recovery-ledger auth` and complete the browser authorization flow.
- On Linux without a system keychain, the file fallback path is `~/.recovery-ledger/tokens.json` (mode 0600).

**See also:** [docs/install/whoop-app.md](whoop-app.md), [INSTALL.md](../../INSTALL.md).

## token_freshness

**Symptom:** `[warn] token_freshness — expires in 4m` or `[fail] token_freshness — expired 2h 5m ago — run \`recovery-ledger auth\``.

**Likely cause:** The access token is close to or past expiry and no refresh has run recently. A refresh fires through the single-flight gate the next time a sync or roundtrip runs.

**Fix:**

- Run `recovery-ledger sync` — it routes through the refresh chokepoint and refreshes the token if needed.
- If the refresh itself fails, re-authorize: `recovery-ledger auth`.

**See also:** [agent_docs/decisions/0002-single-flight-oauth-refresh.md](../../agent_docs/decisions/0002-single-flight-oauth-refresh.md).

## whoop_roundtrip

**Symptom:** `[fail] whoop_roundtrip — WHOOP returned 401 after refresh — run \`recovery-ledger auth\`` or `[warn] whoop_roundtrip — WHOOP returned 403 — scopes may have drifted; check developer.whoop.com/dashboard/applications`.

**Likely cause:** The token is invalid even after a refresh (re-authorization required), or the WHOOP dashboard scope list was edited and no longer matches what `init` registered. This is the one online check — a single read-only GET against your WHOOP profile.

**Fix:**

- On 401: `recovery-ledger auth` to re-authorize.
- On a non-401 4xx: visit https://developer.whoop.com/dashboard/applications and confirm the scope list matches [docs/install/whoop-app.md](whoop-app.md) Step 4.
- To skip this check while diagnosing the rest of the surface offline: `recovery-ledger doctor --offline`.

**See also:** [docs/install/whoop-app.md](whoop-app.md), [agent_docs/decisions/0007-whoop-read-only.md](../../agent_docs/decisions/0007-whoop-read-only.md).

## db_open

**Symptom:** `[fail] db_open — no DB handle injected — run from CLI to exercise db checks` or `[fail] db_open — pragma probe threw: ...`.

**Likely cause:** The "no handle injected" detail means the check ran without a database (for example from a lightweight non-CLI path) — run it from the CLI. A pragma throw means the database could not be opened: a filesystem permission problem, a full disk, or corruption that blocks the journal-mode pragma.

**Fix:**

- Run the check from the CLI: `recovery-ledger doctor`.
- Confirm `~/.recovery-ledger/recovery-ledger.sqlite` exists and is readable.
- Check free disk space: `df -h ~`.
- If the file is damaged, see the `db_integrity` section below.

**See also:** [agent_docs/decisions/0006-fixture-only-tests.md](../../agent_docs/decisions/0006-fixture-only-tests.md).

## db_integrity

**Symptom:** `[fail] db_integrity — PRAGMA integrity_check returned N row(s); first: ...`.

**Likely cause:** The database file is corrupt — power loss mid-write, disk failure, or external editing. SQLite's built-in `integrity_check` returns one or more error rows instead of a single `ok`.

**Fix:**

- List available pre-migration backups: `ls -1 ~/.recovery-ledger/backups/`.
- Restore the most recent: `cp ~/.recovery-ledger/backups/<latest>.sqlite ~/.recovery-ledger/recovery-ledger.sqlite`.
- Re-run `recovery-ledger doctor` to confirm the restore is clean.

**See also:** the `db_schema_version` section below (both surface migration-state issues).

## db_schema_version

**Symptom:** `[fail] db_schema_version — schema at migration N/M — restore from <backup>: cp <backup> <dbFile>` or `... — extra rows in __drizzle_migrations (orphaned migration record); see docs/install/troubleshooting.md#db_schema_version`.

**Likely cause:** The applied-migration count in `__drizzle_migrations` does not match the number of committed `.sql` migration files. Fewer applied than committed means a pending migration never ran (or the database was rolled back); more applied than committed means an orphaned migration record with no corresponding `.sql` file. The migrator fails closed and never auto-restores, so the doctor surfaces the remediation rather than running it.

**Fix:**

- If the detail string includes a backup-path remediation, copy the backup over the current database exactly as shown.
- If no backup exists, file an issue — the fails-closed migrator means manual recovery is required.
- Re-run `recovery-ledger doctor` to confirm the count matches.

**See also:** [agent_docs/decisions/0006-fixture-only-tests.md](../../agent_docs/decisions/0006-fixture-only-tests.md).

## db_wal_size

**Symptom:** `[warn] db_wal_size — WAL <N>MB (>32MB; checkpoint is lagging)` or `[fail] db_wal_size — WAL <N>MB exceeds journal_size_limit=64MB; run \`recovery-ledger sync\` to force a wal_checkpoint(TRUNCATE)`.

**Likely cause:** The write-ahead log has not been checkpointed and is growing toward (or past) the 64 MiB `journal_size_limit` cap. A sync that was interrupted before its final `wal_checkpoint(TRUNCATE)` leaves the WAL oversized.

**Fix:**

- Run `recovery-ledger sync` to completion — it ends with a TRUNCATE checkpoint that folds the WAL back into the main file.
- If sync cannot run, force a checkpoint directly: `sqlite3 ~/.recovery-ledger/recovery-ledger.sqlite "PRAGMA wal_checkpoint(TRUNCATE);"`.

**See also:** the WAL pragma block in `src/infrastructure/db/connection.ts` (Phase 3 D-30).

## last_sync_recency

**Symptom:** `[warn] last_sync_recency — last sync 3d ago — run \`recovery-ledger sync\` (status: ok)` or `[fail] last_sync_recency — last sync 10d ago — exceeds 7d threshold; run \`recovery-ledger sync\``. A recent failed sync shows `[warn] last sync failed 2h ago — run \`recovery-ledger sync\` to retry`.

**Likely cause:** Sync has not run recently, or the most recent finished sync failed. The threshold ladder is pass within 36h, warn within 7d, fail past 7d.

**Fix:**

- Run `recovery-ledger sync` to refresh.
- Set up a scheduled sync per [docs/install/launchd.md](launchd.md) so the gap does not recur.

**See also:** [docs/install/launchd.md](launchd.md).

## most_recent_scored_day

**Symptom:** `[warn] most_recent_scored_day — most recent SCORED day <date>, 3d ago — run \`recovery-ledger sync\` (cycles, recovery; sleep at <date>)` or `[fail] no SCORED data yet — run \`recovery-ledger sync\``.

**Likely cause:** Distinct from `last_sync_recency`: a sync can succeed while the data is still PENDING_SCORE (WHOOP has not scored last night's cycle yet), so fresh sync does not guarantee fresh SCORED data. This check reports the newest SCORED day across cycles, recovery, and sleep.

**Fix:**

- Wait 12–24h for WHOOP to score recent data, then re-run `recovery-ledger sync`.
- If `last_sync_recency` is also failing, resolve that first (see the section above).

**See also:** [agent_docs/decisions/0003-score-state-discipline.md](../../agent_docs/decisions/0003-score-state-discipline.md).

## data_quality_counts

**Symptom:** `[pass] data_quality_counts — cycles: 142 scored, 3 pending, 0 unscorable, 0 excluded; recovery: ...; sleep: ...`. This check is informational and always reports pass when data is present.

**Likely cause:** Not a failure surface — it is a visibility check that exposes silent missing or unscored days. Use the counts as a read on data health rather than a pass/fail signal.

**Fix:**

- Read the per-resource counts to spot resources with high pending or unscorable totals.
- High pending counts on recent days are expected — WHOOP takes time to score.
- High unscorable counts may point to a sensor issue worth checking in the WHOOP app.

**See also:** [agent_docs/decisions/0003-score-state-discipline.md](../../agent_docs/decisions/0003-score-state-discipline.md).

## concurrent_writers_stress

**Symptom:** `[pass] concurrent_writers_stress — skipped — run with --stress to enable` by default. When enabled and failing: `[fail] concurrent_writers_stress — <W> of 4 workers failed: exit 1 (SQLITE_BUSY ...)`.

**Likely cause:** This is an opt-in diagnostic for concurrent-writer contention. A failure means the `busy_timeout=5000` primitive is being beaten — two writers are racing past the `BEGIN IMMEDIATE` lock.

**Fix:**

- Confirm no other process is writing to `~/.recovery-ledger/recovery-ledger.sqlite` (for example a stale sync child).
- This is a power-user diagnostic. If it still fails, capture the doctor output and file an issue with the database file size and your hardware specs.

**See also:** [agent_docs/decisions/0002-single-flight-oauth-refresh.md](../../agent_docs/decisions/0002-single-flight-oauth-refresh.md).
