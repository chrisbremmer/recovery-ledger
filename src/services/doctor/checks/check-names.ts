// Canonical check-name registry (MR-36).
//
// Each DoctorCheck.name was previously a string literal duplicated across
// the probe modules, the test suite, and the runDoctor orchestrator. Three
// copies of `'mcp_stdout_purity'` (one in production, one in the index
// fallback, one in tests) is one too many — renaming required hunting down
// every literal. Centralize the names in a frozen const so every consumer
// references the same string and the TypeScript `typeof CHECK_NAMES` type
// gives autocomplete + rename support across the module graph.
//
// Adding a new check: declare its name here, reference CHECK_NAMES.NEW_NAME
// in the probe and in any test that asserts on the name field. The
// runDoctor() orchestrator's PROBE_NAMES fallback (index.ts) keys off the
// same literal values so a synthesized-from-throw check uses the canonical
// name too.

export const CHECK_NAMES = {
  BETTER_SQLITE3_LOAD: 'better_sqlite3_load',
  NAPI_KEYRING_LOAD: 'napi_keyring_load',
  MCP_STDOUT_PURITY: 'mcp_stdout_purity',
  // Plan 02-06: two new offline-safe probes surface the Phase 2 auth state.
  // `auth` reports which backend stores tokens (keychain / file / missing);
  // `token_freshness` reports how close to expiry. Neither calls the WHOOP
  // refresh endpoint — see D-22 + agent_docs/decisions/0002.
  AUTH: 'auth',
  TOKEN_FRESHNESS: 'token_freshness',
  // Phase 5 D-02: 9 new checks — see 05-CONTEXT.md for the per-check
  // rationale. Order mirrors the Plan 05-06 PROBE_NAMES dependency
  // ordering (load -> db -> auth -> roundtrip -> recency -> counts ->
  // stress). The constants land here in Wave 0; the probe files + the
  // runDoctor() orchestrator wiring arrive in Plans 05-02..05-06. The
  // matching troubleshooting H2 per name lands in Wave 2 (D-08 + D-09).
  WHOOP_ROUNDTRIP: 'whoop_roundtrip',
  DB_OPEN: 'db_open',
  DB_INTEGRITY: 'db_integrity',
  DB_SCHEMA_VERSION: 'db_schema_version',
  DB_WAL_SIZE: 'db_wal_size',
  LAST_SYNC_RECENCY: 'last_sync_recency',
  MOST_RECENT_SCORED_DAY: 'most_recent_scored_day',
  DATA_QUALITY_COUNTS: 'data_quality_counts',
  CONCURRENT_WRITERS_STRESS: 'concurrent_writers_stress',
} as const;

export type CheckName = (typeof CHECK_NAMES)[keyof typeof CHECK_NAMES];
