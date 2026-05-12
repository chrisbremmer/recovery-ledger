import { defineConfig } from 'tsup';

export default defineConfig({
  // CLI + MCP are the runtime entries. `infrastructure/whoop/token-store` is
  // added per checker WARNING PLAN-08-BUILD-DEP (Phase 2 Plan 08): the
  // cross-process auth-concurrency integration test forks a child helper that
  // imports the compiled tokenStore. With the default `splitting: false`,
  // tsup only emits bundles for top-level entries — internal modules are not
  // emitted under `dist/<original-path>.mjs` unless explicitly listed here.
  // After `npm run build`, `dist/infrastructure/whoop/token-store.mjs` MUST
  // exist; the integration test fast-fails if missing.
  entry: {
    cli: 'src/cli/index.ts',
    mcp: 'src/mcp/index.ts',
    'infrastructure/whoop/token-store': 'src/infrastructure/whoop/token-store.ts',
  },
  format: ['esm'],
  target: 'node22',
  outDir: 'dist',
  outExtension: () => ({ js: '.mjs' }),
  banner: { js: '#!/usr/bin/env node' },
  external: ['better-sqlite3', '@napi-rs/keyring'],
  clean: true,
  sourcemap: true,
  splitting: false,
  treeshake: true,
});
