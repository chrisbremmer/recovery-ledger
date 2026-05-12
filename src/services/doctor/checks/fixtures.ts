// JSON-RPC fixture constants for the mcp_stdout_purity subprocess check (D-05).
//
// Vendored as TypeScript literals (not read from disk) so the check works
// from any cwd — particularly under `npx recovery-ledger` from outside the
// source tree (CR-02 in 01-REVIEW.md). The on-disk fixtures under
// test/fixtures/mcp/*.json remain the canonical artifacts driving the Plan 06
// integration test; this module is their runtime mirror.
//
// Shapes must match the on-disk fixtures after JSON canonicalization
// (parse → stringify), so a drift between the two sources would surface as
// a wire-protocol mismatch in either the unit suite (which exercises this
// constant) or the integration test (which reads the JSON files).

export interface JsonRpcFixture {
  readonly name: string;
  readonly frame: Record<string, unknown>;
}

export const JSONRPC_FIXTURES: readonly JsonRpcFixture[] = [
  {
    name: 'initialize',
    frame: {
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2025-06-18',
        capabilities: {},
        clientInfo: { name: 'stdout-purity-test', version: '0.0.0' },
      },
    },
  },
  {
    name: 'initialized',
    frame: { jsonrpc: '2.0', method: 'notifications/initialized' },
  },
  {
    name: 'tools-list',
    frame: { jsonrpc: '2.0', id: 2, method: 'tools/list' },
  },
  {
    name: 'whoop-doctor-call',
    frame: {
      jsonrpc: '2.0',
      id: 3,
      method: 'tools/call',
      params: { name: 'whoop_doctor', arguments: {} },
    },
  },
] as const;
