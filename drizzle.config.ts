// Drizzle Kit configuration (H2 per 03-PATTERNS.md, D-01 / D-04 / D-06).
//
// Consumed by `drizzle-kit generate` (Wave 1 Plan 03-02) to diff the schema
// against the prior migration and emit a new versioned SQL file under
// `src/infrastructure/db/migrations/`. The hand-rolled migrator
// (Wave 2 Plan 03-05) reads `meta/_journal.json` from the same directory.
//
// `drizzle-kit push` is FORBIDDEN outside dev experimentation per
// ARCHITECTURE.md Anti-Pattern 7 — the workflow is generate-then-commit.

import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  schema: './src/infrastructure/db/schema.ts',
  out: './src/infrastructure/db/migrations',
  dialect: 'sqlite',
  verbose: true,
  strict: true,
});
