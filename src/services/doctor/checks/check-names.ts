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
} as const;

export type CheckName = (typeof CHECK_NAMES)[keyof typeof CHECK_NAMES];
